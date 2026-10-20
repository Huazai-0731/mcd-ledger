#!/usr/bin/env node
/**
 * verify-ui.mjs — 页面结构断言 + 控制台异常巡检（零依赖，CDP）
 *
 * 用法：
 *   node scripts/verify-ui.mjs <url|相对路径> [outDir] [--profile prototype|ledger|generic]
 *
 * 检查项：
 *   1. 页面加载，readyState complete
 *   2. 零控制台 error、零未捕获异常、零请求失败（file:// 页面不应有任何外部请求）
 *   3. 结构断言（按 profile，见下）
 *   4. 决策页：切换 3 个场景（normal / stockout / abort）与双主题，全程零新异常
 *   5. 账本页：切换时间区间，全程零新异常
 *   6. 每步截图落 outDir
 *
 * 退出码：0 = 全部通过；1 = 有失败项。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { withBrowser, navigate, evaluate, screenshot, fileUrl, sleep } from "./ui-cdp.mjs";

function parseArgs(argv) {
  const args = { url: null, out: null, profile: "generic", width: 1280, height: 800 };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--profile") args.profile = argv[++i] ?? "generic";
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a === "--width") args.width = Number(argv[++i] ?? 1280);
    else if (a === "--height") args.height = Number(argv[++i] ?? 800);
    else rest.push(a);
  }
  args.url = rest[0] ?? null;
  args.out = args.out ?? rest[1] ?? null;
  return args;
}

/** 结构断言表：selector → 期望数量（null = 至少 1 个） */
const PROFILES = {
  prototype: {
    selectors: {
      ".scr": null,
      ".scr-body": null,
      '[data-act="theme"]': 2,
      '[data-act="scenario"]': 3,
      ".pcard": null,
    },
    scenarios: true,
    themeSwitch: true,
  },
  ledger: {
    selectors: {
      ".sec": null,
      ".sec-h": null,
      ".tr": null,
      ".win": null,
      ".chip": null,
    },
    rangeSwitch: true,
  },
  generic: { selectors: {}, scenarios: false },
  // 线上站点版（web/）：评审面板与顶栏开关都已摘除，只留产品流程本身
  site: {
    selectors: {
      ".scr": null,
      ".scr-body": null,
      '[data-act="scenario"]': 1,
      ".demo-strip": 1,
      ".demo-branch": 1,
      ".panel": 0,
      '[data-act="theme"]': 0,
      '[data-act="reset"]': 0,
    },
    scenarios: false,
    flow: true,
  },
};

async function assertSelectors(page, selectors, results) {
  for (const [sel, expected] of Object.entries(selectors)) {
    const count = await evaluate(page, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const ok = expected === null ? count >= 1 : count === expected;
    results.push({ check: `selector ${sel}`, expected: expected ?? ">=1", actual: count, pass: ok });
  }
}

/**
 * 站点版核心流程回归。
 *
 * 这里不是点一遍截图看热闹：线上版把评审用的「直达界面 / 重置原型 / 场景用尽」入口
 * 全摘了，流程只能靠真实按钮推进，任何一处断链都表现为「点了不跳」。所以每一步都
 * 断言**屏幕真的切过去了**，而不是断言「点了没报错」。
 *
 * 覆盖：主线（下单 → 支付 → 取餐码 → 再来一单）、撤销（二次确认）、支付中途退出分支。
 */
async function runFlow(page, results, outDir) {
  const screen = () =>
    evaluate(page, "document.querySelector('.scr.on') ? document.querySelector('.scr.on').dataset.scr : ''");
  const act = (sel) =>
    evaluate(page, `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
  const sheetOpen = () => evaluate(page, "!document.getElementById('sheetWrap').hidden");
  const waitScreen = async (want, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await screen()) === want) return true;
      await sleep(120);
    }
    return false;
  };
  const step = (name, pass, actual) =>
    results.push({ check: `流程 · ${name}`, expected: "通过", actual: pass ? "通过" : String(actual), pass });

  step("初始停在方案卡", await waitScreen("plan", 3000), await screen());

  // —— 主线：生成订单 → 支付 → 取餐码
  await act('[data-act="make-order"]');
  step("生成订单进入待支付", await waitScreen("pay"), await screen());
  await screenshot(page, resolve(outDir, "10-flow-pay.png"));

  await act('[data-act="pay"]');
  await sleep(300);
  step("支付弹层打开", await sheetOpen(), "未打开");
  await act('[data-act="do-pay"]');
  step("确认支付进入成功页", await waitScreen("success"), await screen());
  step(
    "成功页给出取餐码入口",
    await evaluate(page, "!!document.querySelector('[data-act=\"save-code\"]')"),
    "缺失",
  );
  await screenshot(page, resolve(outDir, "11-flow-success.png"));

  await act('[data-act="again"]');
  step("再来一单回到方案卡", await waitScreen("plan"), await screen());

  // —— 撤销：二次确认后订单失效
  await act('[data-act="make-order"]');
  await waitScreen("pay");
  await act('[data-act="cancel"]');
  await sleep(400);
  step("撤销先出二次确认", await sheetOpen(), "未打开");
  await act('[data-act="do-cancel"]');
  step("确认撤销回到方案卡", await waitScreen("plan"), await screen());

  // —— 折叠分支：支付中途退出
  await evaluate(page, "document.querySelector('.demo-branch').open = true");
  await act('[data-act="scenario"][data-val="abort"]');
  await sleep(200);
  await act('[data-act="make-order"]');
  await waitScreen("pay");
  await act('[data-act="pay"]');
  await sleep(300);
  await act('[data-act="do-pay"]');
  step("支付中途退出落到未完成态", await waitScreen("fail"), await screen());
  await screenshot(page, resolve(outDir, "12-flow-fail.png"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    process.stderr.write("用法：node scripts/verify-ui.mjs <url|相对路径> [outDir] [--profile prototype|ledger|generic]\n");
    process.exit(1);
  }
  const outDir = resolve(args.out ?? "out/verify-ui");
  mkdirSync(outDir, { recursive: true });
  const url = args.url.startsWith("http") ? args.url : fileUrl(resolve(args.url));
  const profile = PROFILES[args.profile] ?? PROFILES.generic;
  const results = [];

  await withBrowser({ width: args.width, height: args.height }, async ({ page }) => {
    await page.startCollecting();
    await navigate(page, url);

    const title = await evaluate(page, "document.title");
    const externalReqs = await evaluate(
      page,
      `performance.getEntriesByType('resource').map(r => r.name).filter(u => !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:'))`
    );
    results.push({ check: "title 非空", expected: "非空", actual: title || "(空)", pass: !!title });
    results.push({ check: "无外部请求（离线可用）", expected: 0, actual: (externalReqs ?? []).length, pass: (externalReqs ?? []).length === 0 });

    await assertSelectors(page, profile.selectors, results);
    await screenshot(page, resolve(outDir, "01-initial.png"));

    const baseErrors = page.consoleErrors.length + page.pageErrors.length;

    if (profile.scenarios) {
      for (const val of ["stockout", "abort", "normal"]) {
        await evaluate(
          page,
          `(() => { const b = document.querySelector('[data-act="scenario"][data-val="${val}"]'); if (b) b.click(); })()`
        );
        await sleep(400);
        const theme = await evaluate(page, "document.documentElement.dataset.theme");
        results.push({
          check: `场景切换 ${val} 后 DOM 存活`,
          expected: "theme 属性仍存在",
          actual: theme ?? "(无)",
          pass: !!theme,
        });
        await screenshot(page, resolve(outDir, `02-scenario-${val}.png`));
      }
      // 双主题往返（站点版没有主题开关，跳过）
      for (const theme of profile.themeSwitch ? ["dark", "light"] : []) {
        await evaluate(
          page,
          `(() => { const b = document.querySelector('[data-act="theme"][data-val="${theme}"]'); if (b) b.click(); })()`
        );
        await sleep(300);
        const actual = await evaluate(page, "document.documentElement.dataset.theme");
        results.push({ check: `主题切换到 ${theme}`, expected: theme, actual, pass: actual === theme });
        await screenshot(page, resolve(outDir, `03-theme-${theme}.png`));
      }
    }

    if (profile.rangeSwitch) {
      const chipCount = await evaluate(page, "document.querySelectorAll('.chip').length");
      if (chipCount > 0) {
        await evaluate(page, `document.querySelectorAll('.chip')[Math.min(2, ${chipCount} - 1)].click()`);
        await sleep(400);
        const secCount = await evaluate(page, "document.querySelectorAll('.sec').length");
        results.push({ check: "切换时间区间后区块仍在", expected: ">=1", actual: secCount, pass: secCount >= 1 });
        await screenshot(page, resolve(outDir, "02-range-switch.png"));
      }
    }

    if (profile.flow) {
      await runFlow(page, results, outDir);
    }

    const newErrors = page.consoleErrors.slice(baseErrors);
    const newPageErrors = page.pageErrors.slice(baseErrors);
    results.push({ check: "零控制台 error", expected: 0, actual: page.consoleErrors.length, pass: page.consoleErrors.length === 0, detail: newErrors.slice(0, 3) });
    results.push({ check: "零未捕获异常", expected: 0, actual: page.pageErrors.length, pass: page.pageErrors.length === 0, detail: newPageErrors.slice(0, 3) });
    results.push({ check: "零请求失败", expected: 0, actual: page.requestFailures.length, pass: page.requestFailures.length === 0, detail: page.requestFailures.slice(0, 3) });
  });

  // 汇总
  const failed = results.filter((r) => !r.pass);
  const lines = results.map((r) =>
    `  ${r.pass ? "✓" : "✗"} ${r.check}（期望 ${r.expected}，实际 ${r.actual}）` +
    (r.detail && r.detail.length ? `\n      ${r.detail.map((d) => String(d).split("\n")[0]).join("\n      ")}` : "")
  );
  const report = {
    url,
    profile: args.profile,
    at: new Date().toISOString(),
    pass: failed.length === 0,
    results,
  };
  writeFileSync(resolve(outDir, "verify-report.json"), JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`\n  verify-ui · ${args.profile} · ${url}\n\n${lines.join("\n")}\n\n  ${failed.length === 0 ? "全部通过" : `${failed.length} 项失败`} · 报告 ${resolve(outDir, "verify-report.json")}\n\n`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`\n  执行失败：${err.stack ?? err.message}\n\n`);
  process.exit(1);
});
