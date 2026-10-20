#!/usr/bin/env node
/**
 * sheet.mjs — 评审拼版图（零依赖，CDP）
 *
 * 把多张截图拼成一张带标签的评审大图。内部用 Chrome 本身排版：
 * 生成一个 base64 内联图片的 HTML 网格页，再整页截图，因此不引入任何图像库。
 *
 * 用法：
 *   node scripts/sheet.mjs <out.png> <scale> --tile "标签=图片路径" [--tile ...] [--cols N] [--tile-width N]
 *
 * 例：
 *   node scripts/sheet.mjs out/review.png 2 \
 *     --tile "浅色·主态=out/shots/light-normal.png" \
 *     --tile "深色·主态=out/shots/dark-normal.png" \
 *     --tile "浅色·售罄=out/shots/light-stockout.png" \
 *     --cols 2 --tile-width 900
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { withBrowser, navigate, evaluate, screenshot } from "./ui-cdp.mjs";

function parseArgs(argv) {
  const args = { out: null, scale: 2, tiles: [], cols: 2, tileWidth: 900 };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--tile") args.tiles.push(argv[++i] ?? "");
    else if (a === "--cols") args.cols = Number(argv[++i] ?? args.cols);
    else if (a === "--tile-width") args.tileWidth = Number(argv[++i] ?? args.tileWidth);
    else rest.push(a);
  }
  args.out = rest[0] ?? null;
  args.scale = Number(rest[1] ?? args.scale);
  return args;
}

function buildHtml(tiles, cols, tileWidth) {
  const cells = tiles
    .map(([label, path]) => {
      const data = readFileSync(path).toString("base64");
      return `<figure><figcaption>${label.replace(/</g, "&lt;")}</figcaption><img src="data:image/png;base64,${data}"></figure>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #101014; font: 14px/1.5 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(${cols}, ${tileWidth}px); gap: 20px; justify-content: center; }
    figure { margin: 0; background: #17171b; border: 1px solid #2a2a32; border-radius: 12px; overflow: hidden; }
    figcaption { padding: 10px 14px; color: #c9c9d4; border-bottom: 1px solid #2a2a32; }
    img { display: block; width: 100%; height: auto; }
  </style></head><body><div class="grid">${cells}</div></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out || args.tiles.length === 0) {
    process.stderr.write('用法：node scripts/sheet.mjs <out.png> <scale> --tile "标签=图片路径" [--tile ...] [--cols N] [--tile-width N]\n');
    process.exit(1);
  }
  const tiles = args.tiles.map((t) => {
    const i = t.indexOf("=");
    if (i < 0) throw new Error(`--tile 需为 "标签=路径" 形式：${t}`);
    return [t.slice(0, i), resolve(t.slice(i + 1))];
  });
  const htmlPath = resolve(dirname(resolve(args.out)), ".sheet-tmp.html");
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(htmlPath, buildHtml(tiles, args.cols, args.tileWidth), "utf8");

  await withBrowser({ width: args.cols * args.tileWidth + 120, height: 2400 }, async ({ page }) => {
    await navigate(page, `file:///${htmlPath.replace(/\\/g, "/")}`);
    const h = await evaluate(page, "document.body.scrollHeight");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: args.cols * args.tileWidth + 120,
      height: h,
      deviceScaleFactor: args.scale,
      mobile: false,
    });
    await screenshot(page, resolve(args.out), { format: "png" });
  });
  try {
    (await import("node:fs")).rmSync(htmlPath, { force: true });
  } catch {
    /* 临时文件清理失败不影响结果 */
  }
  process.stdout.write(`  拼版图 ${args.out}（${args.tiles.length} 张 × scale ${args.scale}）\n`);
}

main().catch((err) => {
  process.stderr.write(`\n  执行失败：${err.stack ?? err.message}\n\n`);
  process.exit(1);
});
