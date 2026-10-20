/**
 * build-site.mjs — 把 docs/ 下的两个单文件交付物派生成可发布的静态站点 web/
 *
 * 为什么需要这一步，而不是直接把 docs/*.html 传上去？
 * --------------------------------------------------------------------------
 * docs/ 下的两个页面是**评审产物**，带着评审用的装置：
 *   · prototype-v2.html 右侧有「场景模拟 / 直达界面 / 当前状态 / 事件日志」面板，
 *     顶栏有主题切换与「重置原型」——这些是给评审逐态巡检用的，不是给访客点的；
 *   · 两页之间的互链写的是 docs/ 里的文件名。
 *
 * 站点要的是**只留产品本身**：访客进来只会看到账本和方案卡，点到的每个按钮都是
 * 产品流程里真实存在的操作。所以这里做三件事，其余像素原样搬运：
 *   1. 摘掉评审面板与顶栏的主题/重置按钮（非核心操作）
 *   2. 修正互链（demo-report.html → ledger.html，prototype-v2.html → plan.html）
 *   3. 补一条演示声明 + 一个默认折叠的「分支」入口（让「支付中途退出」仍然可达，
 *      但不占据主界面）
 *
 * 为什么分支里只有「支付中途退出」：demo 数据下 PLAN.degrade 为 null，
 * 「提交时售罄」点了会照常生成订单——留在线上是误导，只保留实测可达的那条分支。
 *
 * 产物：
 *   web/ledger.html  ← docs/demo-report.html
 *   web/plan.html    ← docs/prototype-v2.html
 *   web/index.html   ← 手写落地页（不由本脚本生成，脚本只校验它在）
 *
 * 用法：node scripts/build-site.mjs
 *
 * 约定：本脚本对 docs/ 只读。任何一处标记找不到就抛错退出——宁可构建失败，
 * 也不要静默产出一个还带着评审面板的站点。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "web");

/** 摘掉一个平衡的标签块（含它前面的缩进），openTag/closeTag 用于数层数 */
function removeBalanced(html, startMarker, openTag, closeTag) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`未找到起始标记：${startMarker}`);

  let i = start;
  let depth = 0;
  while (i < html.length) {
    const nextOpen = html.indexOf(openTag, i);
    const nextClose = html.indexOf(closeTag, i);
    if (nextClose === -1) throw new Error(`标记不闭合：${startMarker}`);

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + openTag.length;
    } else {
      depth -= 1;
      i = nextClose + closeTag.length;
      if (depth === 0) {
        // 去掉块前面的行内缩进，避免留下只含空格的空行
        const lineStart = html.lastIndexOf("\n", start) + 1;
        const indent = html.slice(lineStart, start);
        const cutFrom = /^\s*$/.test(indent) ? lineStart : start;
        return html.slice(0, cutFrom) + html.slice(i);
      }
    }
  }
  throw new Error(`标记不闭合：${startMarker}`);
}

/** 断言替换命中，避免上游模板改名后静默失效 */
function replaceOnce(html, from, to, label) {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`「${label}」预期命中 1 次，实际 ${n} 次：${from.slice(0, 60)}`);
  return html.replace(from, to);
}

function tidy(html) {
  return html.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * 面板节点被摘掉后，原型的 renderLog / renderPanel 会往不存在的节点写内容而抛错，
 * 连带把按操作打断（实测：点「生成订单」屏幕不跳）。这里给两个函数补空值保护，
 * 让「没有评审面板」成为一种被支持的运行方式。
 */
function guardPanelless(html) {
  if (html.includes("站点版：没有评审面板")) return html;

  const logAnchor = "function renderLog() {\n  const el = $('#log');\n";
  const panelAnchor = "function renderPanel() {\n";

  if (!html.includes(logAnchor)) throw new Error("renderLog 结构已变更，空值保护需要重新定位");
  if (!html.includes(panelAnchor)) throw new Error("renderPanel 结构已变更，空值保护需要重新定位");

  html = html.replace(
    logAnchor,
    "function renderLog() {\n  const el = $('#log');\n  if (!el) return; // 站点版：没有评审面板\n",
  );
  html = html.replace(
    panelAnchor,
    "function renderPanel() {\n  if (!$('#scrTag')) return; // 站点版：没有评审面板\n",
  );
  return html;
}

/* ------------------------------------------------------------------ 方案卡页 */

const PLAN_STYLE = `
<style>
/* ---- 站点增量：只做减法与一条声明，不改原型任何既有样式 ---- */
.device-cap{display:none}                     /* 评审用的 S1/S4 状态标签，访客不需要 */

/* 右栏摘掉后补一列玩法说明：既是版面平衡，也是首次访问的操作指引 */
.site-guide{
  flex:0 0 248px;width:248px;position:sticky;top:88px;
  padding:18px 20px;border-radius:14px;
  background:var(--surface);border:1px solid var(--border);
}
.site-guide h2{margin:0;font-size:13px;font-weight:700;color:var(--text);letter-spacing:-.01em}
.site-guide ol{margin:10px 0 0;padding-left:17px;font-size:12px;line-height:1.66;color:var(--text-2)}
.site-guide li{margin-top:7px}
.site-guide li b{color:var(--text);font-weight:600}
.site-guide .note{
  margin:14px 0 0;padding-top:12px;border-top:1px solid var(--border-2);
  font-size:11px;line-height:1.6;color:var(--text-3);
}
@media (max-width:1000px){ .site-guide{display:none} }
.demo-strip{max-width:1180px;margin:0 auto;padding:0 28px 6px}
.demo-strip p{
  margin:0;padding:11px 16px;border-radius:12px;
  background:var(--surface-2);border:1px solid var(--border-2);
  color:var(--text-3);font-size:12px;line-height:1.6;text-align:center;
}
.demo-strip b{color:var(--text);font-weight:600}
.demo-branch{max-width:1180px;margin:14px auto 46px;padding:0 28px;font-size:12px;color:var(--text-3)}
.demo-branch summary{
  cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;
  padding:5px 0;color:var(--text-3);font-size:12px;
}
.demo-branch summary::-webkit-details-marker{display:none}
.demo-branch summary::before{content:"▸";color:var(--text-4)}
.demo-branch[open] summary::before{content:"▾"}
.demo-branch summary:hover{color:var(--text)}
.demo-branch .seg2{margin-top:10px}
.demo-branch p{margin:9px 0 0;color:var(--text-4);line-height:1.62;max-width:62ch}
@media (max-width:1000px){
  .demo-strip{padding:0 14px 4px}
  .demo-branch{padding:0 14px}
}
</style>
`;

const PLAN_EXTRA = `
<section class="demo-strip">
  <p><b>演示数据</b> · 订单为固定种子生成的合成数据，价格取真实菜单；页面不联网、不会真实下单，也不收集任何支付信息。</p>
</section>

<details class="demo-branch">
  <summary>看一个分支：支付中途退出</summary>
  <div class="seg2" role="group" aria-label="场景">
    <button data-act="scenario" data-val="abort">模拟支付中途退出</button>
  </div>
  <p>打开后，支付回调不返回，页面停在「支付未完成」——此时订单仍是待支付的，可以继续付，也可以撤销。默认关闭，走主线。</p>
</details>
`;

const PLAN_GUIDE = `
  <aside class="site-guide" aria-label="怎么玩">
    <h2>怎么玩</h2>
    <ol>
      <li><b>挑买法</b>：合单 / 拆单两张卡都能点，金额与"再省"即时重算。</li>
      <li><b>生成订单</b>：点底部主按钮，订单 15 分钟内有效，随时可撤销。</li>
      <li><b>支付拿码</b>：模拟收银台确认支付，成功后给出取餐码。</li>
    </ol>
    <p class="note">演示数据 · 不会真实下单，也不收集支付信息。</p>
  </aside>
`;

function buildPlan() {
  let html = readFileSync(join(DOCS, "prototype-v2.html"), "utf8");

  // 1. 摘掉右侧评审面板：场景模拟 / 直达界面 / 当前状态 / 事件日志
  html = removeBalanced(html, '<aside class="panel">', "<aside", "</aside>");

  // 2. 摘掉顶栏右侧：主题切换 + 重置原型（访客不需要，也不该看到「重置原型」）
  html = removeBalanced(html, '<div class="top-r">', "<div", "</div>");

  // 2.5 面板节点消失后，补上两个渲染函数的空值保护（否则点击流会中断）
  html = guardPanelless(html);

  // 3. 互链修正
  html = html.split('href="demo-report.html"').join('href="ledger.html"');

  // 4. 顶栏副标题从「评审口径」换成「访客口径」
  html = replaceOnce(
    html,
    "<p>V2 可点击原型 · 9 个界面状态 · 真实点击流</p>",
    "<p>点卡片走完整流程 · 演示数据 · 不会真实下单</p>",
    "方案卡副标题",
  );

  // 5. 注入站点增量样式、玩法说明、演示声明与折叠分支
  html = replaceOnce(html, "</head>", `${PLAN_STYLE}</head>`, "head 收口");
  html = replaceOnce(html, '<div class="device-col">', `${PLAN_GUIDE}\n  <div class="device-col">`, "device-col 起始");
  html = replaceOnce(html, "</main>", `</main>\n${PLAN_EXTRA}`, "main 收口");

  if (html.includes("data-act=\"reset\"")) throw new Error("重置原型按钮仍在页面上");
  if (html.includes('class="panel"')) throw new Error("评审面板仍在页面上");
  if (html.includes('href="demo-report.html"')) throw new Error("互链未改写");

  return tidy(html);
}

/* ------------------------------------------------------------------ 账本页 */

function buildLedger() {
  let html = readFileSync(join(DOCS, "demo-report.html"), "utf8");

  // 账本页本就是给用户看的单文件产物，只改互链
  html = html.split('href="prototype-v2.html').join('href="plan.html');

  if (html.includes('href="prototype-v2.html')) throw new Error("账本页互链未改写");
  return html;
}

/* --------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "plan.html"), buildPlan());
writeFileSync(join(OUT, "ledger.html"), buildLedger());

if (!existsSync(join(OUT, "index.html"))) {
  throw new Error("缺少手写落地页 web/index.html —— 本脚本不生成它，请先补上");
}

const kb = (p) => (readFileSync(p).length / 1024).toFixed(0) + " KB";
for (const f of ["index.html", "ledger.html", "plan.html"]) {
  console.log(`web/${f.padEnd(12)} ${kb(join(OUT, f))}`);
}
console.log("站点构建完成：node scripts/build-site.mjs");
