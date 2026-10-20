#!/usr/bin/env node
/**
 * audit-contrast.mjs — WCAG AA 对比度审计（零依赖，CDP）
 *
 * 遍历页面上所有承载可见文本的元素，按 WCAG 2.x 公式计算文本颜色与
 * 有效背景色（沿祖先链做 alpha 合成；渐变取全部色停逐级合成）的对比度：
 *   正文 < 4.5:1 或大字（≥24px，或 ≥18.66px 且 ≥700）< 3:1 → 记违规。
 *
 * 用法：
 *   node scripts/audit-contrast.mjs [--url <相对路径>] [--themes light,dark]
 *                                   [--scenarios normal,stockout,abort]
 *                                   [--out out/contrast] [--width 1280] [--height 800]
 *
 * 默认审计 docs/prototype-v2.html 的 双主题 × 3 场景 共 6 个组合。
 * 账本页（深色单主题）用 audit-ledger.mjs。
 * 退出码：0 = 无违规；1 = 存在低于 AA 的文本。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { withBrowser, navigate, evaluate, fileUrl, sleep } from "./ui-cdp.mjs";
import { AUDIT_FN } from "./contrast-fn.mjs";

/** 注入页面的审计函数（序列化后经 Runtime.evaluate 执行） */

function parseArgs(argv) {
  const args = { url: "docs/prototype-v2.html", themes: ["light", "dark"], scenarios: ["normal", "stockout", "abort"], out: "out/contrast", width: 1280, height: 800 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i] ?? args.url;
    else if (a === "--themes") args.themes = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--scenarios") args.scenarios = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--out") args.out = argv[++i] ?? args.out;
    else if (a === "--width") args.width = Number(argv[++i] ?? args.width);
    else if (a === "--height") args.height = Number(argv[++i] ?? args.height);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const url = args.url.startsWith("http") ? args.url : fileUrl(resolve(args.url));
  const report = { url, at: new Date().toISOString(), combos: [], pass: true };

  await withBrowser({ width: args.width, height: args.height }, async ({ page }) => {
    await page.startCollecting();
    await navigate(page, url);

    // 禁用过渡/动画：激活态等样式常由 JS 切换，读到的会是过渡中间色
    await evaluate(
      page,
      `(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()`
    );

    for (const theme of args.themes) {
      await evaluate(page, `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      for (const scenario of args.scenarios) {
        await evaluate(
          page,
          `(() => { const b = document.querySelector('[data-act="scenario"][data-val="${scenario}"]'); if (b) b.click(); })()`
        );
        await sleep(350);
        const result = await evaluate(page, AUDIT_FN);
        report.combos.push({ theme, scenario, ...result });
        if (result.violations.length > 0) report.pass = false;
      }
    }
    // 还原浅色 normal，避免顺手截图时状态混乱
    await evaluate(page, `document.documentElement.dataset.theme = 'light'`);
    await evaluate(page, `(() => { const b = document.querySelector('[data-act="scenario"][data-val="normal"]'); if (b) b.click(); })()`);
  });

  writeFileSync(resolve(outDir, "contrast-report.json"), JSON.stringify(report, null, 2), "utf8");

  const lines = [];
  for (const c of report.combos) {
    lines.push(`  ${c.violations.length === 0 ? "✓" : "✗"} ${c.theme} × ${c.scenario}：${c.total} 处文本，${c.violations.length} 处低于 AA`);
    for (const v of c.violations.slice(0, 12)) {
      lines.push(`      ${v.ratio}:1（需 ${v.need}:1） ${v.path}  「${v.text}」 ${v.color} on ${v.bg}`);
    }
  }
  process.stdout.write(`\n  audit-contrast · ${url}\n\n${lines.join("\n")}\n\n  ${report.pass ? "0 处低于 AA" : "存在低于 AA 的文本"} · 报告 ${resolve(outDir, "contrast-report.json")}\n\n`);
  if (!report.pass) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`\n  执行失败：${err.stack ?? err.message}\n\n`);
  process.exit(1);
});
