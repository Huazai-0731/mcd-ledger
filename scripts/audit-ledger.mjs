#!/usr/bin/env node
/**
 * audit-ledger.mjs — 账本页 WCAG AA 对比度审计（零依赖，CDP）
 *
 * 账本页是深色单主题（html.ts：meta color-scheme=dark，无主题切换器），
 * 因此只审计当前主题；如页面未来支持双主题，用 audit-contrast.mjs 替代。
 *
 * 用法：
 *   node scripts/audit-ledger.mjs [--url <相对路径>] [--out out/contrast-ledger]
 *                                 [--width 1280] [--height 800] [--full-page]
 *
 * 退出码：0 = 无违规；1 = 存在低于 AA 的文本。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { withBrowser, navigate, evaluate, fileUrl } from "./ui-cdp.mjs";
import { AUDIT_FN } from "./contrast-fn.mjs";

function parseArgs(argv) {
  const args = { url: "docs/demo-report.html", out: "out/contrast-ledger", width: 1280, height: 900, fullPage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i] ?? args.url;
    else if (a === "--out") args.out = argv[++i] ?? args.out;
    else if (a === "--width") args.width = Number(argv[++i] ?? args.width);
    else if (a === "--height") args.height = Number(argv[++i] ?? args.height);
    else if (a === "--full-page") args.fullPage = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const url = args.url.startsWith("http") ? args.url : fileUrl(resolve(args.url));
  const report = { url, at: new Date().toISOString(), pass: true };

  await withBrowser({ width: args.width, height: args.height }, async ({ page }) => {
    await page.startCollecting();
    await navigate(page, url);

    // 禁用过渡/动画：激活态等样式常由 JS 在加载后切换，读到的会是过渡中间色
    await evaluate(
      page,
      `(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(s); })()`
    );
    await new Promise((r) => setTimeout(r, 120));

    // 账本页较长：审计分两段——默认视口 + 滚到底部（按需截长图）
    const viewport = await evaluate(page, AUDIT_FN);
    report.combos = [{ scope: "viewport", ...viewport }];

    if (args.fullPage) {
      await evaluate(page, "window.scrollTo(0, document.body.scrollHeight)");
      await new Promise((r) => setTimeout(r, 300));
      const bottom = await evaluate(page, AUDIT_FN);
      report.combos.push({ scope: "bottom", ...bottom });
    }

    if (report.combos.some((c) => c.violations.length > 0)) report.pass = false;
    report.consoleErrors = page.consoleErrors.slice(0, 5);
  });

  writeFileSync(resolve(outDir, "ledger-contrast-report.json"), JSON.stringify(report, null, 2), "utf8");
  const lines = report.combos.map(
    (c) => `  ${c.violations.length === 0 ? "✓" : "✗"} ${c.scope}：${c.total} 处文本，${c.violations.length} 处低于 AA` +
      c.violations.slice(0, 12).map((v) => `\n      ${v.ratio}:1（需 ${v.need}:1） ${v.path}  「${v.text}」 ${v.color} on ${v.bg}`).join("")
  );
  if (report.consoleErrors?.length) lines.push(`  ⚠ 控制台 error × ${report.consoleErrors.length}`);
  process.stdout.write(`\n  audit-ledger · ${url}\n\n${lines.join("\n")}\n\n  ${report.pass ? "0 处低于 AA" : "存在低于 AA 的文本"} · 报告 ${resolve(outDir, "ledger-contrast-report.json")}\n\n`);
  if (!report.pass) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`\n  执行失败：${err.stack ?? err.message}\n\n`);
  process.exit(1);
});
