#!/usr/bin/env node
/**
 * cdp-shot.mjs — 无头 Chrome 截图（零依赖，CDP）
 *
 * 用法：
 *   node scripts/cdp-shot.mjs <url|相对路径> <out.png> [width] [height] [evalScript]
 *
 * 参数：
 *   width/height   视口尺寸（默认 1280×800）
 *   evalScript     截图前在页面里执行的 JS（可选），例如：
 *                  "document.documentElement.dataset.theme='dark'"
 *
 * 例：
 *   node scripts/cdp-shot.mjs docs/prototype-v2.html out/shot.png 900 640
 *   node scripts/cdp-shot.mjs docs/prototype-v2.html out/dark.png 1280 800 "document.documentElement.dataset.theme='dark'"
 */
import { resolve } from "node:path";
import { withBrowser, navigate, evaluate, screenshot, fileUrl } from "./ui-cdp.mjs";

async function main() {
  const [urlArg, outArg, wArg, hArg, evalScript] = process.argv.slice(2);
  if (!urlArg || !outArg) {
    process.stderr.write("用法：node scripts/cdp-shot.mjs <url|相对路径> <out.png> [width] [height] [evalScript]\n");
    process.exit(1);
  }
  const width = Number(wArg ?? 1280);
  const height = Number(hArg ?? 800);
  const url = urlArg.startsWith("http") ? urlArg : fileUrl(resolve(urlArg));
  const out = resolve(outArg);

  await withBrowser({ width, height }, async ({ page }) => {
    await navigate(page, url);
    if (evalScript) await evaluate(page, evalScript);
    await new Promise((r) => setTimeout(r, 250));
    await screenshot(page, out, { format: out.endsWith(".jpg") ? "jpeg" : "png" });
  });
  process.stdout.write(`  截图 ${out}（${width}×${height}）\n`);
}

main().catch((err) => {
  process.stderr.write(`\n  执行失败：${err.stack ?? err.message}\n\n`);
  process.exit(1);
});
