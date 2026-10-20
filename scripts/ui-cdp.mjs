#!/usr/bin/env node
/**
 * ui-cdp.mjs — 共享 CDP（Chrome DevTools Protocol）助手
 *
 * 零运行时依赖（Node ≥ 22 内置 WebSocket 与 fetch）。供以下脚本复用：
 *   cdp-shot.mjs      截图
 *   verify-ui.mjs     结构断言 + 控制台异常巡检
 *   audit-contrast.mjs 对比度审计（决策页，双主题 × 场景）
 *   audit-ledger.mjs  对比度审计（账本页）
 *   sheet.mjs         评审拼版图
 *
 * 环境变量：
 *   CHROME_PATH   Chrome 可执行文件路径（缺省时按平台猜常见安装位置）
 *   CDP_PORT      调试端口（默认 9444）
 *
 * 用法（作为库）：
 *   import { withBrowser, navigate, evaluate, screenshot } from "./ui-cdp.mjs";
 *   await withBrowser({ width: 1280, height: 800 }, async ({ page }) => {
 *     await navigate(page, "file:///abs/path/prototype-v2.html");
 *     const title = await evaluate(page, "document.title");
 *     await screenshot(page, "out/shot.png");
 *   });
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/** 各平台 Chrome 常见安装位置（按序探测，第一个存在者胜出） */
const CHROME_CANDIDATES = {
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  ].filter(Boolean),
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(process.env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ].filter(Boolean),
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
};

export function resolveChrome() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH 指向的文件不存在：${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }
  const candidates = CHROME_CANDIDATES[process.platform] || CHROME_CANDIDATES.linux;
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  throw new Error(
    `未找到 Chrome。请设置 CHROME_PATH 环境变量指向 chrome 可执行文件（当前平台 ${process.platform}）。`
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等待 DevTools 端口就绪，返回 /json/version 信息 */
async function waitForDevTools(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await sleep(200);
  }
  throw new Error(`Chrome DevTools 端口 ${port} 未就绪：${lastErr?.message ?? "timeout"}`);
}

/**
 * 启动无头 Chrome 并连上第一个页面 target。
 * 返回 { port, kill, page }。page 是 CdpPage 实例。
 */
export async function launchChrome({
  port = Number(process.env.CDP_PORT || 9444),
  width = 1280,
  height = 800,
  extraArgs = [],
} = {}) {
  const chrome = resolveChrome();
  const userDataDir = mkdtempSync(join(tmpdir(), "mcd-cdp-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "about:blank",
    ...extraArgs,
  ];
  const child = spawn(chrome, args, { stdio: "ignore", detached: false });
  const kill = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* 已退出 */
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 目录清理失败不影响主流程 */
    }
  };
  process.once("exit", kill);

  try {
    await waitForDevTools(port);
    const page = await connectPage(port, { width, height });
    return { port, kill, page };
  } catch (err) {
    kill();
    throw err;
  }
}

/** 连接到已运行的 Chrome（launchChrome 的轻量替代） */
export async function connectChrome(port = Number(process.env.CDP_PORT || 9444)) {
  await waitForDevTools(port);
  const page = await connectPage(port, {});
  return { port, page };
}

/** 一个 CDP 页面会话：封装 send / on / 便捷方法 */
export class CdpPage {
  constructor(ws, sessionId, targetId) {
    this.ws = ws;
    this.sessionId = sessionId; // Target.attachToTarget 后的 sessionId（可为 null：旧式单 target）
    this.targetId = targetId;
    this._nextId = 1;
    this._pending = new Map();
    this._handlers = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
    this.requestFailures = [];
    this.ws.addEventListener("message", (ev) => this._onMessage(ev));
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return;
    }
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      const handlers = this._handlers.get(msg.method);
      if (handlers) for (const h of handlers) h(msg.params ?? {});
    }
  }

  /** 发送 CDP 命令 */
  send(method, params = {}) {
    const id = this._nextId++;
    const payload = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  /** 订阅 CDP 事件 */
  on(method, handler) {
    if (!this._handlers.has(method)) this._handlers.set(method, []);
    this._handlers.get(method).push(handler);
  }

  /** 打开常用域并开始收集控制台错误 / 未捕获异常 / 请求失败 */
  startCollecting() {
    this.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") {
        this.consoleErrors.push((p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "));
      }
    });
    this.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails || {};
      this.pageErrors.push(d.exception?.description || d.text || "unknown exception");
    });
    this.on("Network.loadingFailed", (p) => {
      this.requestFailures.push(`${p.type} ${p.errorText}`);
    });
    return this.send("Runtime.enable")
      .then(() => this.send("Page.enable"))
      .then(() => this.send("Network.enable"))
      .then(() => this.send("Log.enable"));
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      /* 忽略 */
    }
  }
}

async function connectPage(port, { width, height }) {
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await listRes.json();
  const page = targets.find((t) => t.type === "page") ?? targets[0];
  if (!page) throw new Error(`Chrome 没有可用的页面 target（port ${port}）`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")), { once: true });
  });
  const cdp = new CdpPage(ws, null, page.id);
  if (width && height) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  return cdp;
}

/** 导航到 URL 并等待 load 事件（file:// 亦可） */
export async function navigate(page, url, timeoutMs = 20000) {
  const loaded = new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    page.on("Page.loadEventFired", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await page.send("Page.navigate", { url });
  await loaded;
  // 双保险：等 readyState complete
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(page, "document.readyState");
    if (state === "complete") return;
    await sleep(100);
  }
}

/** 执行页面 JS，返回 returnByValue 结果 */
export async function evaluate(page, expression, { awaitPromise = true } = {}) {
  const res = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (res.exceptionDetails) {
    throw new Error(`页面 JS 异常：${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  }
  return res.result?.value;
}

/** 截图（png / jpeg / webp），自动创建输出目录 */
export async function screenshot(page, outPath, { format = "png", quality } = {}) {
  const dir = dirname(outPath);
  if (dir) mkdirSync(dir, { recursive: true });
  const params = { format, captureBeyondViewport: false };
  if (quality !== undefined && format !== "png") params.quality = quality;
  const res = await page.send("Page.captureScreenshot", params);
  writeFileSync(outPath, Buffer.from(res.data, "base64"));
  return outPath;
}

/**
 * 便捷入口：启动 Chrome → 执行 fn({ page }) → 保证退出。
 */
export async function withBrowser(opts, fn) {
  const { kill, page } = await launchChrome(opts);
  try {
    return await fn({ page, kill });
  } finally {
    await page.close().catch(() => {});
    kill();
  }
}

/** file:// URL 工具：把仓库相对路径转成绝对 file URL */
export function fileUrl(absPath) {
  let p = absPath.replace(/\\/g, "/");
  if (!/^[a-zA-Z]:\//.test(p) && !p.startsWith("/")) p = `${process.cwd()}/${p}`;
  if (/^[a-zA-Z]:\//.test(p)) p = `/${p}`;
  return `file://${p}`;
}

export { sleep };
