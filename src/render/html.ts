/**
 * 渲染：账本页（单文件 HTML，无外部依赖、无 CDN、可离线打开、可直接截图分享）。
 *
 * 视觉取向：「黄金档案 / Ledger Vault」。
 * - 结构是审计档案：分节编号、细线网格、刻度标注、盖章，而不是卡片堆。
 * - 品牌是线条的金拱门：以 stroke 画出拱形并做三层偏移伪造立体厚度，而非贴 logo 图。
 * - 颜色做减法：金（品牌）/ 骨白（数字）/ 红（只给"损失"），其余交给灰阶与透明度。
 * - 3D 只在分享卡上做：CSS transform 物理倾斜 + 背层纸，无 WebGL、无额外请求。
 * - 动效只碰 transform / opacity，统一走 IntersectionObserver 触发，尊重 prefers-reduced-motion。
 *
 * 时间区间（v0.2.0）：
 * 首屏由 Node 侧渲染，但**渲染函数来自 src/engine/range.mjs**——同一份代码被内联进页面，
 * 切换区间时浏览器再调用一次。因此"服务端写的数字"和"切区间后的数字"共用一套算法，
 * 不存在两套账。这个文件只负责页面骨架、静态分节（漏损 / 窗口 / 可信度）与交互脚本。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport, Leak, PurchaseWindow } from "../model/types.ts";
import type { LedgerData, View } from "../engine/range.mjs";
import { PRESETS, esc as escText, shareText } from "../engine/range.mjs";

const NAV: ReadonlyArray<readonly [string, string]> = [
  ["overview", "概览"],
  ["flow", "三层价"],
  ["attr", "省在哪"],
  ["strategy", "怎么省"],
  ["leak", "漏在哪"],
  ["window", "何时买"],
  ["profile", "画像"],
  ["trust", "可信度"],
];

/** 金拱门路径：两段圆弧构成的 m，底部平切成"站在地面"的形态 */
const ARCH_D =
  "M10 150C10 62 34 14 60 14C86 14 108 62 108 150C108 62 130 14 156 14C182 14 206 62 206 150";

/**
 * 账本页 → 决策页原型的相对入口。
 * 两者同目录（docs/）时可直接跳转；报告被单独拷走后该链接为软链（不会报错，只是 404）。
 *
 * 第二档之后这条链带上参数：range（当前区间）+ strat（策略类型），
 * 决策页据此用同一份引擎算出对应的买法，所以它是"带着结论跳过去"，不是换个页面。
 */
const PLAN_HREF = "prototype-v2.html";

/* ============================ 页面骨架 ============================ */

export function renderHtml(report: AuditReport, view: View, ledger: LedgerData): string {
  const q = report.quality;
  const demoTag = q.demo ? "演示数据" : "真实数据";
  const engine = engineRuntime();
  const spec =
    report.range.key === "custom" ? `${report.period.from}..${report.period.to}` : report.range.key;
  // 把"首屏用的是哪个区间"一起下发，页面的初始状态才和 SSR 对齐
  const dataJson = JSON.stringify({ ...ledger, defaultRange: spec }).replace(/</g, "\\u003c");
  const planHref = `${PLAN_HREF}?from=ledger&range=${encodeURIComponent(spec)}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="麦麦账本：麦当劳消费审计报告，${escText(report.period.from ?? "")} 至 ${escText(report.period.to ?? "")}（${escText(report.range.label)}），${report.period.orders} 笔订单，省下 ${escText(view.summary.saved === null ? "—" : "¥" + view.summary.saved.toFixed(2))}。">
<title>麦麦账本 · ${escText(report.period.from ?? "")} 至 ${escText(report.period.to ?? "")}</title>
<style>${STYLE}</style>
<noscript><style>
  /* 无 JS 时直接给出终态，避免依赖入场动画的内容永远不可见 */
  .rv{opacity:1;transform:none}
  .draw{stroke-dashoffset:0}
  .svg-node{opacity:1}
  .spec-seg{transform:scaleX(1)}
  .row-t i{transform:scaleX(var(--v,1))}
  .wk-bar{transform:scaleY(1)}
  .hr{transform:scaleY(1)}
  .track-band{transform:scaleX(1)}
  /* 没有 JS 就没有筛选：藏起筛选条，页面停在默认区间，而不是给一排按不动的按钮 */
  .flt{display:none}
</style></noscript>
</head>
<body>

<script type="application/json" id="ledger-data">${dataJson}</script>

<div class="bar" id="bar">
  <div class="bar-in">
    <a class="mark" href="#overview" aria-label="回到顶部">
      <svg class="mark-arch" viewBox="0 0 216 164" fill="none" aria-hidden="true">
        <path d="${ARCH_D}" stroke="currentColor" stroke-width="34" stroke-linecap="butt"/>
      </svg>
      <span class="mark-t">麦麦账本<em>McLedger</em></span>
    </a>
    <nav class="nav" aria-label="章节导航">
      ${NAV.map(([id, label]) => `<a href="#${id}" data-nav="${id}">${label}</a>`).join("")}
    </nav>
    <div class="bar-r">
      <span class="bar-sum"><i data-bar-k>${escText(report.range.label)} · 省下</i><b data-bar-v>${view.summary.saved === null ? "—" : yuan(view.summary.saved)}</b></span>
      <a class="btn btn-plan" data-plan-link="1" href="${planHref}">方案卡 →</a>
      <button class="btn btn-gold" type="button" data-copy="${escText(shareText(view.summary, view.range))}" data-ok="分享文案已复制">复制分享文案</button>
    </div>
  </div>
</div>

<main>
  <div class="wrap">

    <!-- ============================ 区间筛选 ============================ -->
    <div class="flt" id="flt" role="group" aria-label="时间范围筛选">
      <span class="flt-k">时间范围</span>
      <div class="flt-chips" id="fltChips">
        ${PRESETS.map(
          (p) =>
            `<button class="chip" type="button" data-range="${p.key}" aria-pressed="${p.key === report.range.key ? "true" : "false"}">${escText(p.label)}</button>`,
        ).join("")}
        <button class="chip" type="button" data-range="custom" aria-pressed="${report.range.custom ? "true" : "false"}">自定义</button>
      </div>
      <div class="flt-custom" id="fltCustom" hidden>
        <input type="date" id="fltFrom" aria-label="开始日期" value="${escText(report.period.from ?? "")}" min="${escText(ledger.meta.dataFrom)}" max="${escText(ledger.meta.dataTo)}">
        <span class="flt-arrow">→</span>
        <input type="date" id="fltTo" aria-label="结束日期" value="${escText(report.period.to ?? "")}" min="${escText(ledger.meta.dataFrom)}" max="${escText(ledger.meta.dataTo)}">
        <button class="btn btn-mini" type="button" id="fltApply">应用</button>
      </div>
      <span class="flt-span" id="fltSpan">${escText(report.period.from ?? "—")} → ${escText(report.period.to ?? "—")} · ${report.period.days} 天 · ${report.period.orders} 笔</span>
    </div>

    <!-- ============================ 概览 ============================ -->
    <section class="cover" id="overview">
      <div class="arches" aria-hidden="true">
        <svg viewBox="0 0 216 164" fill="none">
          <defs>
            <linearGradient id="ag" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#FFE7A8"/>
              <stop offset=".52" stop-color="#FFC72C"/>
              <stop offset="1" stop-color="#D08E00"/>
            </linearGradient>
          </defs>
          <g stroke="url(#ag)" stroke-linecap="butt" fill="none">
            <path d="${ARCH_D}" stroke-width="22" transform="translate(9,9)" opacity=".06"/>
            <path d="${ARCH_D}" stroke-width="22" transform="translate(4.5,4.5)" opacity=".14"/>
            <path class="draw" pathLength="100" d="${ARCH_D}" stroke-width="22" opacity=".9"/>
          </g>
        </svg>
      </div>
      <div class="gridfade" aria-hidden="true"></div>

      <div class="cover-in">
        <div class="eyebrow"><i></i>MCD LEDGER · 消费审计报告</div>
        <h1>你花在麦当劳的每一块钱，<br><em>都能对上账</em></h1>
        <div id="h-cover" data-host="cover">${view.html.cover}</div>

        <ol class="steps3" aria-label="阅读顺序">
          <li><b>01</b><span>先看省了多少</span><i>三项优惠互不重叠</i></li>
          <li><b>02</b><span>再看漏在哪</span><i>只列有证据的项</i></li>
          <li><b>03</b><span>最后看下次怎么买</span><i>按你选的区间给策略</i></li>
        </ol>
      </div>
    </section>

    <div id="h-flow" data-host="flow">${view.html.flow}</div>

    <div id="h-attr" data-host="attr">${view.html.attr}</div>

    <div id="h-strategy" data-host="strategy">${view.html.strategy}</div>

    ${renderLeaks(report)}

    ${renderWindows(report)}

    <div id="h-profile" data-host="profile">${view.html.profile}</div>

    ${renderTrust(report)}

    <div id="h-share" data-host="share">${view.html.share}</div>

    <footer class="ft">
      <div class="ft-top">
        <svg class="ft-arch" viewBox="0 0 216 164" fill="none" aria-hidden="true">
          <path d="${ARCH_D}" stroke="currentColor" stroke-width="30" stroke-linecap="butt" opacity=".35"/>
        </svg>
        <div>
          <p class="ft-strong">数据来源：麦当劳 MCP Server（mcp.mcd.cn）</p>
          <ul class="src">${report.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        </div>
      </div>
      <p class="ft-note">
        本项目为非官方作品，由开发者独立完成，与麦当劳无隶属关系。输出仅供参考，不构成财务、税务或投资建议；餐品价格与供应状态以麦当劳官方渠道实时结果为准。
      </p>
      <p class="ft-meta">
        <span>mcd-ledger v0.2.0</span>
        <span>${escText(demoTag)}</span>
        <span>数据覆盖 ${escText(ledger.meta.dataFrom)} → ${escText(ledger.meta.dataTo)}</span>
        <span>生成于 ${escText(report.generatedAt.slice(0, 19).replace("T", " "))}</span>
        <span>trace <code>${escText(report.quality.traceId)}</code></span>
      </p>
    </footer>

  </div>
</main>

<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${engine}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/**
 * 把引擎源码内联成一段可直接执行的脚本。
 *
 * 只做两件事：去掉行首的 `export `、用一个 IIFE 收集导出名。
 * 于是 Node 里 `import` 的那份代码，和页面里跑的这份**逐字节相同**——
 * 这是"切区间后的数字 = 报告里的数字"能成立的技术前提。
 */
let engineSource: string | null = null;
export function engineRuntime(): string {
  if (engineSource !== null) return engineSource;
  const src = readFileSync(join(import.meta.dirname, "../engine/range.mjs"), "utf8");
  const names = [...src.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1] ?? "");
  if (names.length === 0) throw new Error("引擎源码没有导出：路径可能不对");
  const body = src.replace(/^export /gm, "");
  engineSource = `window.MCD_LEDGER_ENGINE=(function(){${body}\nreturn {${names.join(",")}};})();`;
  return engineSource;
}

/* =========================== § 04 漏损（账户口径） =========================== */

/**
 * 漏损不随页面区间变化：过期积分、券到期、取消单都是账户级事实，
 * 用"最近 7 天"去截断它们只会得到一个假的 0。所以这里固定用全量数据，
 * 并在标题旁明写「账户口径」，避免和上面的区间数字混为一谈。
 */
function renderLeaks(report: AuditReport): string {
  const scope = '<span class="sec-r">账户口径 · 全程</span>';
  if (report.leaks.length === 0) {
    return `<section class="sec rv" id="leak">
      <div class="sec-h"><span class="sec-n">§ 04</span><h2>漏掉的钱</h2>${scope}</div>
      <div class="empty"><b>这一期没有发现漏损</b><span>券都用在了有效期内，积分也没有过期。</span></div>
    </section>`;
  }

  return `<section class="sec rv" id="leak">
    <div class="sec-h"><span class="sec-n">§ 04</span><h2>漏掉的钱</h2>${scope}</div>
    <p class="lead">只列有证据的项。时间筛选只影响「省了多少」与「还能再省」，这一节是按账户全程统计的既成损失，所以数字不随上方区间变化。</p>

    <div class="leaks">
      ${report.leaks
        .map((leak, i) => {
          const amount =
            leak.amount === null
              ? `<span class="leak-na">不折算</span>`
              : `<span class="leak-v">−${yuan(leak.amount)}${leak.amountEstimated ? '<i>估算</i>' : ""}</span>`;
          return `<article class="leak">
        <span class="leak-n">${String(i + 1).padStart(2, "0")}</span>
        <div class="leak-b">
          <h3>${esc(leak.title)}</h3>
          <ul class="leak-e">${leak.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
          <p class="leak-a"><b>怎么做</b>${esc(leak.action)}</p>
        </div>
        <div class="leak-r">${amount}</div>
      </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

/* =========================== § 05 购买窗口（未来 7 天） =========================== */

function renderWindows(report: AuditReport): string {
  const wins = report.windows;
  if (wins.length === 0) {
    return `<section class="sec rv" id="window">
      <div class="sec-h"><span class="sec-n">§ 05</span><h2>接下来 7 天，什么时候买最划算</h2><span class="sec-r">未来 · 与区间无关</span></div>
      <div class="empty"><b>未来 7 天没有识别到券或活动窗口</b><span>去卡包领券后再生成一次，这里会出现可用时段。</span></div>
    </section>`;
  }

  const maxSaving = Math.max(...wins.map((w) => w.saving ?? 0), 1);

  const rows = wins
    .map((w) => {
      const left = w.startTime ? (toMin(w.startTime) / 1440) * 100 : 0;
      const right = w.endTime ? (toMin(w.endTime) / 1440) * 100 : 100;
      const width = Math.min(Math.max(right - left, 3), 100 - left);
      const strength = w.saving !== null && w.saving > 0 ? Math.min(0.35 + (w.saving / maxSaving) * 0.65, 1) : 0.3;
      return `<div class="win">
        <div class="win-d"><b>${esc(w.label)}</b><span>${esc(w.date)} ${esc(w.weekday)}</span></div>
        <div class="win-b">
          <div class="track">
            <span class="track-base"></span>
            <span class="track-band" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;--s:${strength.toFixed(2)}"></span>
            <span class="track-h" style="left:0%"></span><span class="track-h" style="left:25%"></span>
            <span class="track-h" style="left:50%"></span><span class="track-h" style="left:75%"></span>
            <span class="track-h" style="left:100%"></span>
          </div>
          <div class="track-x"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
          <div class="win-o">${w.offers
            .map((o) => `<span class="of">${esc(o)}</span>`)
            .join('<span class="of-sep">·</span>')}</div>
        </div>
        <div class="win-s">${w.saving === null ? '<span class="muted">—</span>' : `省 ${yuan(w.saving)}`}</div>
      </div>`;
    })
    .join("");

  return `<section class="sec rv" id="window">
    <div class="sec-h"><span class="sec-n">§ 05</span><h2>接下来 7 天，什么时候买最划算</h2><span class="sec-r">未来 · 与区间无关</span></div>
    <p class="lead">横轴是一天 24 小时。金色区间越亮，说明这个时段能省得越多。</p>
    <div class="wins">
      <div class="win win-head"><span></span><span class="win-th">可用时段 · 可叠加的券</span><span class="win-th r">预估</span></div>
      ${rows}
    </div>
  </section>`;
}

/* =========================== § 07 可信度 =========================== */

function renderTrust(report: AuditReport): string {
  const a = report.attribution;
  const q = report.quality;
  return `<section class="sec rv" id="trust">
    <div class="sec-h"><span class="sec-n">§ 07</span><h2>这份账本有多可信</h2><span class="sec-r">全程口径</span></div>
    <p class="lead">审计的价值不在数字好看，而在于每个数字都能指回来源，算不出的地方敢留白。</p>

    <div class="trust">
      <div class="tr"><b>${(a.coverage * 100).toFixed(0)}<em>%</em></b><span>金额可精确归因</span></div>
      <div class="tr"><b>${q.resolvedOrders}<em>/${q.resolvedOrders + q.unresolvedOrders}</em></b><span>笔订单完整还原</span></div>
      <div class="tr"><b>${q.demo ? "演示" : q.toolCalls}${q.demo ? "" : "<em>次</em>"}</b><span>${q.demo ? "合成数据，未调用 MCP" : "MCP 工具调用"}</span></div>
      <div class="tr"><b>${q.demo ? "—" : `${(q.durationMs / 1000).toFixed(1)}<em>s</em>`}</b><span>审计耗时</span></div>
    </div>

    ${
      q.unresolvedOrders > 0
        ? `<p class="note">${q.unresolvedOrders} 笔订单含已下架商品，未参与归因；其金额仍计入实付总额。</p>`
        : ""
    }
    ${
      q.degradations.length > 0
        ? `<details class="disc"><summary>降级记录（${q.degradations.length} 项）</summary>
      <ul class="deg">${q.degradations
        .map((d) => `<li><b>${esc(d.module)}</b>${esc(d.reason)}<i>${esc(d.impact)}</i></li>`)
        .join("")}</ul></details>`
        : ""
    }

    <div class="trace">
      <span class="trace-k">TRACE</span>
      <code>${esc(q.traceId)}</code>
      <span class="trace-h">把 trace.jsonl 拖进 viewer 可逐步回放这次审计</span>
    </div>
  </section>`;
}

/* =========================== helpers =========================== */

function toMin(hhmm: string): number {
  const parts = hhmm.split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function yuan(n: number): string {
  return `¥${n.toFixed(2)}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================== 样式 =========================== */

const STYLE = `
*,*::before,*::after{box-sizing:border-box}
/* 口径源：docs/tokens.css。本块与其中「原型·深色」同值，打印块与「原型·浅色」同值。
   账本页要保持单文件自包含，所以内联而不外链 —— 改色时两处一起改。 */
:root{
  /* 卡片层级：#09090A 底 → #17171B 卡面 → #202026 内嵌块（与 docs/tokens.css 的 --surface/--surface-2 同值）。
     原来 --panel 是 #111113，与底色只差 2 级，叠在 0.075 白描边上整片糊成一团黑——
     这个结论先在原型里验证过，现在回流到账本页。 */
  --bg:#09090A;--bg2:#0C0C0E;--panel:#17171B;--panel2:#202026;
  --line:rgba(255,255,255,.12);--line2:rgba(255,255,255,.2);
  --gold:#FFC72C;--gold-d:#D9A200;--bone:#DCD6C8;
  /* 红：#E23B2E 只用于 18px 以上的大号数字；小字用 --red-t，否则深色底上达不到 4.5:1 */
  --red:#E23B2E;--red-t:#F4685B;--red-d:#9C2318;
  /* 灰阶三档按实测对比度定：ink 17.3:1 / ink2 8.3:1 / ink3 6.0:1（最暗处 #221F19 上） */
  --ink:#F3EFE6;--ink2:#C2BDB2;--ink3:#A29C90;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --r:16px;--maxw:1000px;
}
html{scroll-behavior:smooth}
body{
  margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.72 var(--sans);-webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
body::before{
  content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(860px 540px at 80% -14%,rgba(255,199,44,.13),transparent 62%),
    radial-gradient(680px 460px at 4% 2%,rgba(218,41,28,.10),transparent 58%),
    radial-gradient(900px 700px at 50% 118%,rgba(255,199,44,.05),transparent 60%);
}
::selection{background:rgba(255,199,44,.28);color:#fff}
a{color:inherit;text-decoration:none}
h1,h2,h3{margin:0;font-weight:700}
p{margin:0}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 30px;position:relative;z-index:1}

/* ---------- 顶栏 ---------- */
.bar{
  position:sticky;top:0;z-index:40;transition:background .35s,border-color .35s;border-bottom:1px solid transparent;
  background:linear-gradient(to bottom,rgba(9,9,10,.94),rgba(9,9,10,.55) 70%,transparent);
}
.bar.on{background:rgba(9,9,10,.86);border-bottom-color:var(--line);backdrop-filter:blur(16px) saturate(1.2)}
.bar-in{max-width:var(--maxw);margin:0 auto;padding:0 30px;height:60px;display:flex;align-items:center;gap:22px}
.mark{display:flex;align-items:center;gap:9px;flex:0 0 auto}
.mark-arch{width:19px;height:15px;color:var(--gold)}
.mark-t{font-size:13px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.mark-t em{font-style:normal;font:600 10.5px/1 var(--mono);letter-spacing:.16em;color:var(--ink3);margin-left:7px;text-transform:uppercase}
.nav{display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1 1 auto;min-width:0}
.nav::-webkit-scrollbar{display:none}
.nav a{
  position:relative;flex:0 0 auto;padding:6px 11px;border-radius:999px;
  font-size:12.5px;color:var(--ink3);transition:color .2s,background .2s;white-space:nowrap;
}
.nav a:hover{color:var(--ink);background:rgba(255,255,255,.05)}
.nav a.on{color:#1A1200;background-color:#FFC72C;background-image:linear-gradient(180deg,#FFD453,#FFB300);font-weight:600}
.bar-r{display:flex;align-items:center;gap:14px;flex:0 0 auto}
.bar-sum{display:flex;flex-direction:column;line-height:1.25;text-align:right}
.bar-sum i{font:600 10px/1 var(--mono);letter-spacing:.18em;color:var(--ink3);font-style:normal;text-transform:uppercase;white-space:nowrap}
.bar-sum b{font-size:14px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}

/* ---------- 按钮 ---------- */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  height:34px;padding:0 15px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line2);background:rgba(255,255,255,.04);color:var(--ink);
  font:600 12.5px/1 var(--sans);transition:transform .18s,background .2s,border-color .2s,box-shadow .2s;
}
.btn:hover{background:rgba(255,199,44,.13);border-color:rgba(255,199,44,.45);transform:translateY(-1px)}
.btn:active{transform:translateY(0) scale(.985)}
.btn-gold{background-color:#FFC72C;background-image:linear-gradient(180deg,#FFD453,#FFB300);color:#1A1200;border-color:transparent;box-shadow:0 6px 18px -8px rgba(255,199,44,.75)}
.btn-gold:hover{background:linear-gradient(180deg,#FFDE77,#FFBE22);box-shadow:0 10px 24px -10px rgba(255,199,44,.9)}
:focus-visible{outline:2px solid rgba(255,199,44,.75);outline-offset:3px;border-radius:4px}
.nav a:focus-visible,.btn:focus-visible{outline-offset:2px}

/* ---------- 区间筛选 ---------- */
.flt{
  position:sticky;top:60px;z-index:35;
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  margin:0 -30px;padding:9px 30px;
  background:rgba(9,9,10,.9);
  -webkit-backdrop-filter:blur(16px) saturate(1.15);
  backdrop-filter:blur(16px) saturate(1.15);
  border-bottom:1px solid var(--line);
}
.flt-k{font:600 10px/1 var(--mono);letter-spacing:.18em;color:var(--ink3);text-transform:uppercase;flex:0 0 auto}
.flt-chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{
  appearance:none;-webkit-appearance:none;cursor:pointer;height:28px;padding:0 12px;border-radius:999px;
  border:1px solid var(--line2);background:rgba(255,255,255,.03);color:var(--ink2);
  font:600 12px/1 var(--sans);
  transition:color .18s,background .18s,border-color .18s,box-shadow .18s;
}
.chip:hover{color:var(--ink);border-color:rgba(255,199,44,.45);background:rgba(255,199,44,.1)}
.chip[aria-pressed="true"]{
  color:#1A1200;background-color:#FFC72C;background-image:linear-gradient(180deg,#FFD453,#FFB300);
  border-color:transparent;box-shadow:0 6px 16px -8px rgba(255,199,44,.8);
}
.flt-custom{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.flt-custom[hidden]{display:none}
.flt-custom input[type="date"]{
  height:28px;padding:0 8px;border-radius:7px;
  border:1px solid var(--line2);background:rgba(255,255,255,.05);color:var(--ink);
  font:500 12px/1 var(--mono);color-scheme:dark;
}
.flt-custom input[type="date"]:focus-visible{outline:2px solid rgba(255,199,44,.7);outline-offset:1px}
.flt-arrow{color:var(--ink3);font-family:var(--mono);font-size:11px}
.btn-mini{height:28px;padding:0 12px;font-size:12px}
.flt-span{margin-left:auto;font:400 11px/1.5 var(--mono);color:var(--ink3);white-space:nowrap}
.flt-span b{color:var(--gold);font-weight:600}
.flt-warn{color:var(--red-t);font:500 11.5px/1.4 var(--mono)}

/* ---------- 封面 ---------- */
.cover{position:relative;padding:66px 0 44px;overflow:hidden;isolation:isolate}
.arches{
  position:absolute;right:-42px;top:-52px;width:392px;opacity:.42;z-index:-1;pointer-events:none;
  -webkit-mask-image:linear-gradient(to bottom,#000 34%,rgba(0,0,0,.35) 62%,transparent 88%);
  mask-image:linear-gradient(to bottom,#000 34%,rgba(0,0,0,.35) 62%,transparent 88%);
}
.arches svg{width:100%;height:auto;display:block}
.gridfade{
  position:absolute;left:-10%;right:-10%;bottom:-70px;height:250px;z-index:-1;pointer-events:none;
  background-image:
    linear-gradient(to right,rgba(255,199,44,.13) 1px,transparent 1px),
    linear-gradient(to bottom,rgba(255,199,44,.1) 1px,transparent 1px);
  background-size:46px 46px;
  transform:perspective(340px) rotateX(72deg);transform-origin:bottom center;
  -webkit-mask-image:linear-gradient(to bottom,#000,transparent 78%);
  mask-image:linear-gradient(to bottom,#000,transparent 78%);
  opacity:.55;
}
.cover-in{position:relative}
.eyebrow{display:flex;align-items:center;gap:10px;font:600 10.5px/1 var(--mono);letter-spacing:.24em;color:var(--gold);text-transform:uppercase}
.eyebrow i{width:30px;height:1px;background:linear-gradient(90deg,var(--gold),transparent)}
h1{
  font-size:clamp(29px,4.3vw,50px);line-height:1.14;letter-spacing:-.038em;
  margin:18px 0 16px;max-width:15em;font-weight:800;
}
h1 em{
  font-style:normal;color:#FFC72C;
  background:linear-gradient(100deg,#FFE7A8,#FFC72C 52%,#E8A200);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
.cover-sub{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:var(--ink2)}
.cover-sub .arw{color:var(--gold);font-family:var(--mono)}
.cover-sub .sep{width:1px;height:11px;background:var(--line2)}

.kpis{display:grid;grid-template-columns:1.1fr 1fr 1fr;margin-top:40px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.kpi{padding:22px 24px;border-left:1px solid var(--line);position:relative}
.kpi:first-child{border-left:none;padding-left:0}
.kpi-hl::before{
  content:"";position:absolute;left:0;right:0;top:-1px;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,199,44,.65),transparent);
}
.kpi-k{font:600 10px/1 var(--mono);letter-spacing:.18em;color:var(--ink3);text-transform:uppercase}
.kpi-v{font-size:clamp(25px,3vw,37px);font-weight:700;letter-spacing:-.035em;font-variant-numeric:tabular-nums;margin-top:11px;line-height:1.1}
.kpi-v.red{color:var(--red)}
.kpi-v.gold,.gold{color:var(--gold)}
.kpi-s{font-size:12px;color:var(--ink2);margin-top:9px;text-wrap:pretty;line-height:1.5}
.kpi-s .tagline{
  display:inline-block;font:600 10px/1 var(--mono);letter-spacing:.1em;color:var(--gold);
  border:1px solid rgba(255,199,44,.4);border-radius:3px;padding:2px 4px;margin-left:4px;vertical-align:1px;
}
.grad{
  color:#FFC72C;
  background:linear-gradient(100deg,#FFE7A8,#FFC72C 48%,#E8A200);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}

.steps3{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin:26px 0 0;padding:0;list-style:none;border-top:1px dashed rgba(255,255,255,.1)}
.steps3 li{display:flex;flex-direction:column;gap:3px;padding:14px 18px 0 0}
.steps3 b{font:600 10px/1 var(--mono);letter-spacing:.14em;color:var(--gold)}
.steps3 span{font-size:13px;font-weight:600;color:var(--ink)}
.steps3 i{font-style:normal;font-size:11.5px;color:var(--ink3)}

/* ---------- 分节 ---------- */
.sec{padding:48px 0;border-top:1px solid var(--line);position:relative;scroll-margin-top:116px}
.cover{scroll-margin-top:116px}
.sec-h{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:7px}
.sec-r{
  margin-left:auto;font:600 10px/1 var(--mono);letter-spacing:.12em;color:var(--ink3);
  text-transform:uppercase;flex:0 0 auto;
}
.sec-n{font:600 10.5px/1 var(--mono);letter-spacing:.16em;color:var(--gold);flex:0 0 auto}
h2{font-size:20px;letter-spacing:-.02em;font-weight:700}
.lead{font-size:12.5px;color:var(--ink2);max-width:74ch;margin:0 0 24px}
.note{font-size:12px;color:var(--ink2);max-width:70ch;margin-top:14px;padding-left:12px;border-left:1px solid rgba(255,199,44,.28)}
/* 策略区 → 决策页原型：一条出口链接，说明"这些数字下一步会变成什么" */
.plan-link{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-top:18px;padding-top:15px;border-top:1px solid var(--line)}
.plan-link a{font-size:12.5px;font-weight:600;color:var(--gold);border-bottom:1px solid rgba(255,199,44,.34)}
.plan-link a:hover{border-bottom-color:var(--gold)}
.plan-link span{font-size:11.5px;color:var(--ink3)}
.note strong{color:var(--bone);font-weight:600}
.muted{color:var(--ink3)}
.empty{padding:26px 0;display:flex;flex-direction:column;gap:5px}
.empty b{font-size:14px;font-weight:600}
.empty span{font-size:12.5px;color:var(--ink3)}

/* ---------- 图表容器 ---------- */
.chart{position:relative;padding:8px 4px 0}
.brackets{position:relative}
.brackets::after{
  content:"";position:absolute;inset:2px;pointer-events:none;opacity:.45;
  background:
    linear-gradient(var(--gold),var(--gold)) left top/11px 1px no-repeat,
    linear-gradient(var(--gold),var(--gold)) left top/1px 11px no-repeat,
    linear-gradient(var(--gold),var(--gold)) right top/11px 1px no-repeat,
    linear-gradient(var(--gold),var(--gold)) right top/1px 11px no-repeat,
    linear-gradient(var(--gold),var(--gold)) left bottom/11px 1px no-repeat,
    linear-gradient(var(--gold),var(--gold)) left bottom/1px 11px no-repeat,
    linear-gradient(var(--gold),var(--gold)) right bottom/11px 1px no-repeat,
    linear-gradient(var(--gold),var(--gold)) right bottom/1px 11px no-repeat;
}
.flowsvg{width:100%;height:auto;display:block;overflow:visible}
.svg-base{stroke:rgba(255,255,255,.16);stroke-width:1}
.svg-guide{stroke:rgba(255,255,255,.09);stroke-dasharray:2 5}
.svg-tick{stroke:rgba(255,255,255,.2);stroke-width:1}
.svg-line{fill:none;stroke:url(#fg);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.svg-halo{fill:none;stroke:rgba(255,199,44,.28);stroke-width:1}
.svg-dot{fill:#FFC72C}
.svg-val{fill:var(--bone);font:600 13px/1 var(--mono)}
.svg-val-hl{fill:#FFC72C}
/* 文字描一圈底色作为"挖空"，避免折线从数字中间穿过 */
.svg-val,.svg-save{paint-order:stroke;stroke:#0A0A0B;stroke-width:4px;stroke-linejoin:round}
.svg-save{stroke-width:2.4px}
.svg-lb{fill:var(--ink);font:600 13px/1 var(--sans)}
.svg-hint{fill:var(--ink3);font:400 10.5px/1 var(--sans)}
.svg-save{fill:#FFD046;font:600 12px/1 var(--mono)}
.svg-drop-line{stroke:rgba(255,199,44,.22);stroke-width:1;stroke-dasharray:3 4}
.svg-node{opacity:0}
.in .svg-node{animation:nodeIn .5s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d)}

/* ---------- 归因 ---------- */
.spec{display:flex;gap:3px;height:16px;margin:4px 0 8px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.03)}
.spec-seg{transform-origin:left;transform:scaleX(0);transition:transform .9s cubic-bezier(.2,.8,.2,1);animation:segIn .9s cubic-bezier(.2,.8,.2,1) forwards}
.sA{background:linear-gradient(180deg,#FFD453,#E8A200)}
.sB{background:linear-gradient(180deg,#B9822A,#7E5510)}
.sC{background:linear-gradient(180deg,#8B8578,#5D5950)}
.legend{display:flex;flex-direction:column}
.lg-row{display:flex;align-items:flex-start;gap:13px;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.055);transition:background .25s}
.lg-row:hover{background:linear-gradient(90deg,rgba(255,255,255,.025),transparent)}
.lg-dot{width:9px;height:9px;border-radius:2px;margin-top:5px;flex:0 0 auto}
.lg-dot.sA{background:#FFC72C}
.lg-dot.sB{background:#A9761F}
.lg-dot.sC{background:#807B6E}
.lg-dot.dashed{background:none;border:1px dashed rgba(255,255,255,.32)}
.lg-l{flex:0 1 auto;font-size:13px;font-weight:600;line-height:1.45}
.lg-l i{display:block;font-style:normal;font-size:11.5px;color:var(--ink3);font-weight:400;margin-top:2px}
.lg-lead{
  flex:1 1 40px;height:1px;margin-top:11px;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,.17) 0 1px,transparent 1px 6px);
}
.lg-v{font:600 14px/1.4 var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em;flex:0 0 auto;text-align:right}
.lg-p{font:400 11px/1.4 var(--mono);color:var(--ink3);flex:0 0 52px;text-align:right}
.lg-ghost .lg-l{color:var(--ink3);font-weight:400}
.lg-ghost .lg-v,.lg-ghost .lg-p{color:var(--ink3)}

.disc{margin-top:18px;border-top:1px solid rgba(255,255,255,.07)}
.disc summary{
  cursor:pointer;list-style:none;padding:12px 0;font-size:12.5px;color:var(--ink2);
  display:flex;align-items:center;gap:8px;transition:color .2s;
}
.disc summary::-webkit-details-marker{display:none}
.disc summary::before{content:"+";font:600 13px/1 var(--mono);color:var(--gold);width:12px}
.disc[open] summary::before{content:"−"}
.disc summary:hover{color:var(--ink)}
.tbl{width:100%;border-collapse:collapse;font-size:12.5px;margin:2px 0 4px}
.tbl th{text-align:left;font:600 10px/1 var(--mono);letter-spacing:.1em;color:var(--ink3);padding:9px 4px;border-bottom:1px solid var(--line);text-transform:uppercase}
.tbl td{padding:9px 4px;border-bottom:1px solid rgba(255,255,255,.045);color:var(--ink2)}
.tbl .r{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:12px}

/* ---------- 漏损 ---------- */
.leaks{border-top:1px solid var(--line)}
.leak{display:grid;grid-template-columns:46px 1fr auto;gap:20px;padding:22px 0;border-bottom:1px solid var(--line);transition:background .25s}
.leak:hover{background:linear-gradient(90deg,rgba(226,59,46,.045),transparent 70%)}
.leak-n{font:600 11px/1 var(--mono);letter-spacing:.1em;color:var(--red-t);padding-top:4px}
.leak-b h3{font-size:14.5px;letter-spacing:-.01em;font-weight:650;line-height:1.5}
.leak-e{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.leak-e li{position:relative;padding-left:15px;font-size:12.5px;color:var(--ink2)}
.leak-e li::before{content:"";position:absolute;left:0;top:.72em;width:6px;height:1px;background:var(--ink3)}
.leak-a{margin-top:11px;font-size:12.5px;color:var(--bone);display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.leak-a b{font:600 10px/1 var(--mono);letter-spacing:.14em;color:var(--gold);text-transform:uppercase;flex:0 0 auto;padding:3px 5px;border:1px solid rgba(255,199,44,.32);border-radius:3px}
.leak-r{text-align:right}
.leak-v{font:700 19px/1 var(--mono);color:var(--red);font-variant-numeric:tabular-nums;white-space:nowrap}
.leak-v i{display:block;font-style:normal;font:400 10.5px/1 var(--mono);color:var(--ink3);letter-spacing:.1em;margin-top:6px;text-align:right}
.leak-na{font:400 11.5px/1 var(--mono);color:var(--ink3);white-space:nowrap;border:1px dashed rgba(255,255,255,.18);border-radius:3px;padding:5px 7px}

/* ---------- 策略 ---------- */
.strat-head{
  display:flex;align-items:baseline;gap:6px 16px;flex-wrap:wrap;
  padding:16px 0 18px;margin-top:4px;border-top:1px solid var(--line);
}
.strat-head b{font-size:16px;font-weight:700;letter-spacing:-.015em}
.strat-head b i{font-style:normal;font:400 12px/1 var(--mono);color:var(--ink3);margin-left:4px}
.strat-head span{font:400 11px/1.6 var(--mono);color:var(--ink3)}
.strats{display:flex;flex-direction:column}
.strat{display:grid;grid-template-columns:46px 1fr auto;gap:20px;padding:22px 0;border-bottom:1px solid var(--line);transition:background .25s}
.strat:hover{background:linear-gradient(90deg,rgba(255,199,44,.045),transparent 72%)}
.strat-n{font:600 11px/1 var(--mono);letter-spacing:.1em;color:var(--gold);padding-top:4px}
.strat-b{min-width:0}
.strat-b h3{font-size:14.5px;letter-spacing:-.01em;font-weight:650;line-height:1.5;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.strat-k{
  font:600 9.5px/1 var(--mono);letter-spacing:.1em;color:var(--ink3);
  border:1px solid var(--line2);border-radius:3px;padding:3px 5px;white-space:nowrap;
}
.strat-e{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.strat-e li{position:relative;padding-left:15px;font-size:12.5px;color:var(--ink2)}
.strat-e li::before{content:"";position:absolute;left:0;top:.72em;width:6px;height:1px;background:var(--ink3)}
.strat-a{margin-top:11px;font-size:12.5px;color:var(--bone);display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.strat-go{
  display:inline-flex;align-items:center;gap:5px;margin-top:10px;
  font-size:12px;font-weight:600;color:var(--gold);text-decoration:none;
  border-bottom:1px solid rgba(255,199,44,.34);padding-bottom:2px;
}
.strat-go:hover{border-bottom-color:var(--gold)}
.strat-go::after{content:"→";font-weight:400}
.strat-a b{
  font:600 10px/1 var(--mono);letter-spacing:.14em;color:var(--gold);text-transform:uppercase;
  flex:0 0 auto;padding:3px 5px;border:1px solid rgba(255,199,44,.32);border-radius:3px;
}
.strat-r{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto}
.strat-v{font:700 17px/1 var(--mono);color:var(--gold);font-variant-numeric:tabular-nums;white-space:nowrap}
.strat-v i{font-style:normal;font:400 10px/1 var(--mono);color:var(--ink3);margin-left:3px}
.strat-sub{font:400 10.5px/1 var(--mono);color:var(--ink3);white-space:nowrap}
.strat-na{font:400 11.5px/1 var(--mono);color:var(--ink3);border:1px dashed rgba(255,255,255,.18);border-radius:3px;padding:5px 7px;white-space:nowrap}
.strat-tag{font:600 9.5px/1 var(--mono);letter-spacing:.08em;border-radius:3px;padding:3px 5px;white-space:nowrap;border:1px solid var(--line2);color:var(--ink3)}
.strat-tag[data-conf="high"]{color:var(--gold);border-color:rgba(255,199,44,.5)}
.strat-tag[data-conf="medium"]{color:var(--gold-d);border-color:rgba(255,199,44,.28)}

/* ---------- 窗口 ---------- */
.wins{border-top:1px solid var(--line)}
.win{display:grid;grid-template-columns:118px 1fr 92px;gap:20px;align-items:start;padding:16px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.win-head{padding:9px 0;border-bottom:1px solid var(--line);align-items:center}
.win-th{font:600 10px/1 var(--mono);letter-spacing:.14em;color:var(--ink3);text-transform:uppercase}
.win-th.r{text-align:right}
.win-d{padding-top:3px}
.win-d b{display:block;font-size:13px;font-weight:600}
.win-d span{font:400 11px/1.5 var(--mono);color:var(--ink3)}
.win-b{min-width:0}
.track{position:relative;height:22px}
.track-base{position:absolute;left:0;right:0;top:10px;height:1px;background:rgba(255,255,255,.1)}
.track-band{
  position:absolute;top:4px;height:13px;border-radius:2px;
  background:linear-gradient(90deg,rgba(255,199,44,calc(.3 + var(--s) * .62)),rgba(255,199,44,calc(.12 + var(--s) * .45)));
  border:1px solid rgba(255,199,44,calc(.28 + var(--s) * .52));
  transform-origin:left;animation:bandIn .8s cubic-bezier(.2,.8,.2,1) both;
}
.track-h{position:absolute;top:6px;width:1px;height:6px;background:rgba(255,255,255,.16)}
.track-x{display:flex;justify-content:space-between;font:400 10px/1 var(--mono);color:var(--ink3);margin-top:1px}
.win-o{display:flex;flex-wrap:wrap;gap:2px 7px;margin-top:10px;font-size:12px;color:var(--ink2);line-height:1.65}
.of{position:relative}
.of-sep{opacity:.35}
.win-s{text-align:right;font:600 12px/1.6 var(--mono);color:var(--gold);white-space:nowrap;padding-top:2px}

/* ---------- 画像 ---------- */
.cols{display:grid;gap:28px}
.cols-3{grid-template-columns:1fr 1fr 1fr}
.cols-wide{grid-template-columns:1.15fr 1fr}
.mini-h{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:9px;border-bottom:1px solid var(--line);margin-bottom:14px}
.mini-h span{font-size:12px;font-weight:600;color:var(--ink)}
.mini-h em{font:400 10px/1 var(--mono);letter-spacing:.12em;color:var(--ink3);font-style:normal;text-transform:uppercase}
.mini-f{font:400 11.5px/1.6 var(--mono);color:var(--ink3);margin-top:12px}
.rows{display:flex;flex-direction:column;gap:9px}
.row{display:grid;grid-template-columns:62px 1fr 64px;gap:10px;align-items:center}
.row-k{font-size:11.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-t{position:relative;height:6px;background:rgba(255,255,255,.07);border-radius:1px;overflow:hidden}
.row-t i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#FFC72C,#C98A12);transform-origin:left;transform:scaleX(0);border-radius:1px;transition:transform .9s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
.in .row-t i{transform:scaleX(var(--v,1))}
.row-v{font:600 11.5px/1 var(--mono);color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.row-v em{display:block;font-style:normal;font:400 10.5px/1 var(--mono);color:var(--ink3);margin-top:3px}
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end;height:88px}
.wk{display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.wk-bar{position:relative;width:100%;max-width:26px;height:var(--h);min-height:3px;border-radius:1px;background:linear-gradient(180deg,#FFD453,rgba(255,199,44,.22));transform:scaleY(0);transform-origin:bottom;transition:transform .7s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
.in .wk-bar{transform:scaleY(1)}
.wk-bar i{position:absolute;top:-16px;left:0;right:0;text-align:center;font:400 10px/1 var(--mono);color:var(--ink3);font-style:normal}
.wk-l{font:400 10px/1 var(--mono);color:var(--ink3)}
.hours{display:flex;justify-content:space-between;align-items:flex-end;height:64px;padding-top:14px}
.hr{width:3px;height:max(4px,var(--h));background:rgba(255,199,44,.52);border-radius:0;transform:scaleY(0);transform-origin:bottom;transition:transform .6s cubic-bezier(.2,.8,.2,1);transition-delay:var(--d,0s)}
.hr0{background:rgba(255,255,255,.24)}
.hr[style*="--peak:1"]{background:#FFC72C}
.in .hr{transform:scaleY(1)}
.hours-x{display:flex;justify-content:space-between;font:400 10px/1 var(--mono);color:var(--ink3);margin-top:6px;border-top:1px solid rgba(255,255,255,.06);padding-top:5px}
.tops{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.tops li{display:grid;grid-template-columns:26px 1fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px}
.tops-i{font:400 10px/1 var(--mono);color:var(--gold);letter-spacing:.06em}
.tops-n{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tops b{font:600 12px/1 var(--mono);font-variant-numeric:tabular-nums}

/* ---------- 可信度 ---------- */
.trust{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.tr{padding:20px 22px;border-left:1px solid var(--line)}
.tr:first-child{border-left:none;padding-left:0}
.tr b{display:block;font-size:26px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.1}
.tr b em{font-style:normal;font-size:13px;color:var(--ink3);font-weight:600;margin-left:1px}
.tr span{display:block;font-size:11.5px;color:var(--ink2);margin-top:7px}
.deg{list-style:none;margin:10px 0 0;padding:0}
.deg li{font-size:12px;color:var(--ink2);padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.deg li b{color:var(--bone);margin-right:8px;font-weight:600}
.deg li i{display:block;font-style:normal;color:var(--ink3);font-size:11.5px;margin-top:2px}
.trace{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px;font-size:11px;color:var(--ink3)}
.trace-k{font:600 10px/1 var(--mono);letter-spacing:.18em;color:var(--gold);border:1px solid rgba(255,199,44,.3);border-radius:3px;padding:3px 5px}
.trace code{font:400 11px/1 var(--mono);color:var(--ink2);background:rgba(255,255,255,.045);padding:4px 7px;border-radius:3px}
.trace-h{color:var(--ink3)}

/* ---------- 分享 ---------- */
.share-lay{display:grid;grid-template-columns:360px 1fr;gap:44px;align-items:start}
.tilt{perspective:1000px;perspective-origin:50% 45%}
.tilt-inner{transform-style:preserve-3d;transition:transform .55s cubic-bezier(.2,.8,.2,1);will-change:transform}
.card3d{
  position:relative;border-radius:20px;padding:28px 26px 22px;
  /* 底色单独给出，避免 background 简写把 background-color 重置为透明、
     让卡片看起来像是页面上的一个"洞"。
     金色光晕从左上角挪到卡片上边缘之外，只留一道边缘暖光——
     原来 .16 的金色压在左上角，会把那里抬到 #393222，
     灰字与红字在上面直接掉到 3:1 以下。 */
  background-color:#131317;
  background-image:
    radial-gradient(118% 74% at 52% -16%,rgba(255,199,44,.13),transparent 60%),
    linear-gradient(160deg,#1D1D22 0%,#111115 100%);
  border:1px solid rgba(255,255,255,.14);
  /* 用多层实心阴影伪造"下面还压着两张纸"，比额外 DOM 更省，也不会被 overflow 裁掉 */
  box-shadow:
    0 34px 64px -30px rgba(0,0,0,.95),
    0 13px 0 -7px #101014,
    0 13.5px 0 -7px rgba(255,255,255,.09),
    0 25px 0 -17px #0B0B0E,
    0 25.5px 0 -17px rgba(255,255,255,.06);
  overflow:hidden;
}
.card-hd{display:flex;justify-content:space-between;align-items:baseline;gap:10px;position:relative}
.card-b{font:600 10.5px/1 var(--mono);letter-spacing:.18em;color:var(--gold)}
.card-p{font:400 10.5px/1 var(--mono);color:var(--ink3)}
.card-main{position:relative;margin:30px 0 24px;display:flex;flex-direction:column;gap:7px}
.card-l{font-size:12px;color:var(--ink2);letter-spacing:.02em}
.card-n{
  font-size:40px;font-weight:800;letter-spacing:-.045em;line-height:1;font-variant-numeric:tabular-nums;
  color:#FFC72C;
  background:linear-gradient(100deg,#FFE7A8,#FFC72C 52%,#E8A200);
  -webkit-background-clip:text;background-clip:text;
}
@supports ((-webkit-background-clip:text) or (background-clip:text)){
  .card-n{-webkit-text-fill-color:transparent}
}
.card-r{font:400 11.5px/1 var(--mono);color:var(--ink3)}
.card-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;border-top:1px solid rgba(255,255,255,.14);padding-top:14px;position:relative}
.card-row b{display:block;font:700 15px/1 var(--mono);font-variant-numeric:tabular-nums}
.card-row b.red{color:var(--red-t)}
.card-row span{display:block;font-size:10.5px;color:var(--ink3);margin-top:5px;letter-spacing:.06em}
.card-f{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-top:24px;position:relative}
.card-sign{font:400 10px/1 var(--mono);color:var(--ink3);letter-spacing:.1em}
.stamp-mark{
  display:flex;flex-direction:column;align-items:center;gap:3px;flex:0 0 auto;
  border:1.5px solid rgba(255,199,44,.66);border-radius:4px;
  padding:7px 10px;color:var(--gold);font-size:12.5px;font-weight:700;letter-spacing:.08em;
  transform:rotate(-7deg);line-height:1.15;
  box-shadow:inset 0 0 0 1px rgba(255,199,44,.1),0 0 14px -6px rgba(255,199,44,.5);
}
.stamp-mark i{font-style:normal;font:600 8px/1 var(--mono);letter-spacing:.22em;opacity:.92}
.share-act{padding-top:4px}
.share-tip{font-size:12.5px;color:var(--ink2);max-width:44ch}
.share-btns{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 20px}
.share-pre{
  margin:0;padding:14px 16px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.022);
  font:400 12px/1.7 var(--mono);color:var(--ink2);white-space:pre-wrap;word-break:break-word;
}

/* ---------- 页脚 ---------- */
.ft{padding:38px 0 56px;border-top:1px solid var(--line)}
.ft-top{display:flex;gap:18px;align-items:flex-start}
.ft-arch{width:36px;height:28px;color:var(--gold);flex:0 0 auto;margin-top:2px}
.ft-strong{font-size:12px;font-weight:600;color:var(--ink2)}
.src{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px 16px;font:400 10.5px/1.6 var(--mono);color:var(--ink3)}
.src li{position:relative;padding-left:9px}
.src li::before{content:"";position:absolute;left:0;top:.68em;width:4px;height:1px;background:var(--ink3)}
.ft-note{font-size:11px;color:var(--ink3);line-height:1.8;margin-top:20px;max-width:78ch}
.ft-meta{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:14px;font:400 10.5px/1 var(--mono);color:var(--ink3);letter-spacing:.04em}
.ft-meta code{color:var(--ink3)}

/* ---------- 动效 ---------- */
.rv{opacity:0;transform:translateY(16px);transition:opacity .75s cubic-bezier(.2,.8,.2,1),transform .75s cubic-bezier(.2,.8,.2,1)}
.rv.in{opacity:1;transform:none}
.draw{stroke-dasharray:100;stroke-dashoffset:100}
.cover .draw{animation:draw 2s cubic-bezier(.3,.7,.2,1) .15s forwards}
.in .draw{animation:draw 1.7s cubic-bezier(.3,.7,.2,1) .1s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes nodeIn{from{opacity:0}to{opacity:1}}
@keyframes segIn{to{transform:scaleX(1)}}
@keyframes bandIn{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.toast{
  position:fixed;left:50%;bottom:34px;z-index:99;pointer-events:none;
  transform:translate(-50%,16px);opacity:0;transition:opacity .3s,transform .3s;
  background:rgba(22,22,26,.97);border:1px solid rgba(255,199,44,.35);color:var(--ink);
  font-size:12.5px;padding:10px 18px;border-radius:999px;box-shadow:0 16px 40px -16px #000;
}
.toast.on{opacity:1;transform:translate(-50%,0)}

/* ---------- 响应式 ---------- */
@media (max-width:980px){
  .cols-3{grid-template-columns:1fr 1fr}
  .cols-wide{grid-template-columns:1fr}
  .share-lay{grid-template-columns:1fr;gap:32px}
  .card3d{max-width:360px}
  .win{grid-template-columns:100px 1fr 84px;gap:14px}
  .win-head{display:none}
}
@media (max-width:760px){
  .wrap,.bar-in{padding:0 18px}
  .nav{display:none}
  .bar-sum{display:none}
  /* 窄屏顶栏三要素（字标 + 方案卡 + 复制）要挤进 360px：收紧间距、去字标英文名 */
  .bar-in{gap:10px}
  .bar-r{gap:8px}
  .mark-t em{display:none}
  .btn-plan{padding:0 9px;font-size:11px}
  .bar-r .btn{padding:0 11px;font-size:11.5px}
  .cover{padding:44px 0 34px}
  h1{font-size:25px;line-height:1.24;letter-spacing:-.03em;max-width:none}
  .arches{width:280px;right:-110px;top:-16px;opacity:.3}
  .kpis{grid-template-columns:1fr;border-bottom:none}
  .kpi{border-left:none;border-bottom:1px solid var(--line);padding:18px 0}
  .kpi:last-child{border-bottom:none}
  .steps3{grid-template-columns:1fr;gap:2px}
  .steps3 li{flex-direction:row;align-items:baseline;gap:8px;padding:9px 0;border-bottom:1px dashed rgba(255,255,255,.07)}
  .steps3 i{color:var(--ink3)}
  .cols-3{grid-template-columns:1fr}
  .sec{padding:40px 0}
  h2{font-size:18px}
  .leak{grid-template-columns:1fr auto;grid-template-areas:"n v" "b b";gap:6px 14px}
  .leak-n{grid-area:n;padding-top:3px}
  .leak-b{grid-area:b}
  .leak-r{grid-area:v;text-align:right}
  .leak-v{font-size:18px}
  .leak-v i{display:inline;margin-left:7px;text-align:left}
  .cover-sub{gap:4px 9px}
  .cover-sub .sep{width:3px;height:3px;border-radius:50%;background:var(--ink3);opacity:.55}
  .trust{grid-template-columns:1fr 1fr}
  .tr{padding:16px 14px}
  .tr:first-child{padding-left:14px}
  .tr:nth-child(odd){border-left:none;padding-left:0}
  .tr:nth-child(n+3){border-top:1px solid var(--line)}
  .lg-row{gap:10px}
  .lg-p{display:none}
  .svg-hint{display:none}
  .flt{position:static;margin:0 -18px;padding:8px 18px;row-gap:8px}
  .flt-span{margin-left:0;width:100%}
  .sec,.cover{scroll-margin-top:74px}
  .strat{grid-template-columns:1fr auto;grid-template-areas:"n r" "b b";gap:8px 14px}
  .strat-n{grid-area:n;padding-top:3px}
  .strat-b{grid-area:b}
  .strat-r{grid-area:r}
  .strat-v{font-size:15px}
  .sec-r{margin-left:0;width:100%}
  .win{grid-template-columns:1fr;gap:8px;padding:16px 0}
  .win-s{text-align:left;padding-top:0}
  .win-d{display:flex;align-items:baseline;gap:9px;padding-top:0}
}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition-duration:.001s!important}
  .rv{opacity:1;transform:none}
  .draw{stroke-dashoffset:0}
}
/* Windows 高对比度模式会丢弃背景色，渐变文字此时会变成"透明字"。
   这里回退成系统前景色，保证文字一定可见。 */
@media (forced-colors:active){
  .grad,h1 em,.card-n{background:none!important;-webkit-text-fill-color:currentColor!important;color:CanvasText}
  .btn-gold,.nav a.on{border:1px solid ButtonText}
}
@media print{
  /* 打印 = 浅色口径 + 纯白底（省墨）。品牌红已统一到 docs/tokens.css 的浅色值
     （#DA291C / 小字 #B0231A），不再保留第三个红。 */
  :root{--bg:#fff;--ink:#111;--ink2:#444;--ink3:#666;--line:rgba(0,0,0,.14);--line2:rgba(0,0,0,.22);--bone:#222;--gold:#9A6C00;--red:#DA291C;--red-t:#B0231A}
  body{background:#fff;color:#111}
  body::before,.gridfade,.arches,.bar,.toast,.flt{display:none!important}
  .tilt{perspective:none}
  .tilt-inner{transform:none!important}
  .wrap{max-width:none;padding:0 12px}
  .sec{padding:22px 0;break-inside:avoid}
  .rv{opacity:1!important;transform:none!important}
  .draw{stroke-dashoffset:0!important}
  .hours .hr,.week .wk-bar,.row-t i{transform:none!important}
  /* 挖空描边在浅底上会变成黑边，改成白描边 */
  .svg-val,.svg-save{stroke:#fff}
  /* 渐变文字依赖背景绘制，打印时必须回退成实色 */
  .grad,h1 em{background:none!important;-webkit-text-fill-color:#9A6C00;color:#9A6C00}
  /* 分享卡改为浅色票券，避免"不打印背景"时白字白底 */
  .card3d{background:#fff!important;border:1px solid #D9C58C!important;box-shadow:none!important;color:#111!important}
  .card-b,.card-r,.card-sign{color:#8A6400!important}
  .card-l,.card-row span{color:#555!important}
  .card-row{border-top:1px solid #DDD!important}
  .card-row b{color:#111!important}
  .card-row b.red{color:#B0231A!important}
  .card-n{background:none!important;-webkit-text-fill-color:#9A6C00!important;color:#9A6C00!important}
  .stamp-mark{color:#9A6C00!important;border-color:#C6A64E!important;box-shadow:none!important}
  .share-pre{background:#f7f7f5}
}
`;

/* =========================== 脚本 =========================== */

const SCRIPT = `
(function(){
  var doc = document;
  var R = window.MCD_LEDGER_ENGINE;
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e) {}

  /* 1. 滚动进入：一次观察，元素进入后立刻断开，避免长期持有 */
  var rvs = [].slice.call(doc.querySelectorAll('.rv'));
  var io = null;
  if (reduce || !('IntersectionObserver' in window)) {
    rvs.forEach(function(el){ el.classList.add('in'); });
  } else {
    io = new IntersectionObserver(function(list){
      list.forEach(function(en){
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.1 });
    rvs.forEach(function(el){ io.observe(el); });
  }

  /* 2. 数字滚动：只跑一次，用 rAF + 缓出，千分位手写避免正则开销 */
  function grp(s){
    var p = s.split('.');
    var n = p[0], out = '', c = 0;
    for (var i = n.length - 1; i >= 0; i--) {
      out = n.charAt(i) + out; c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return p.length > 1 ? out + '.' + p[1] : out;
  }
  function count(el){
    var target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var pre = el.getAttribute('data-pre') || '';
    var dur = 900, t0 = 0;
    function frame(ts){
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + grp((target * e).toFixed(dec));
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function animateCounts(root){
    var scope = root || doc;
    var nodes = [].slice.call(scope.querySelectorAll('[data-count]'));
    nodes.forEach(function(el){
      if (reduce) {
        var pre = el.getAttribute('data-pre') || '';
        var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
        el.textContent = pre + grp(parseFloat(el.getAttribute('data-count')).toFixed(dec));
      } else {
        count(el);
      }
    });
  }
  var nums = [].slice.call(doc.querySelectorAll('[data-count]'));
  if (reduce || !('IntersectionObserver' in window)) {
    animateCounts(doc);
  } else {
    var io2 = new IntersectionObserver(function(list){
      list.forEach(function(en){
        if (en.isIntersecting) { count(en.target); io2.unobserve(en.target); }
      });
    }, { threshold: 0.6 });
    nums.forEach(function(el){ io2.observe(el); });
  }

  /* 3. 顶栏状态 + 章节高亮（区间切换后需要重新挂载） */
  var bar = doc.getElementById('bar');
  var cover = doc.getElementById('overview');
  var links = [].slice.call(doc.querySelectorAll('[data-nav]'));
  var spy = null;
  function mountSpy(){
    if (!('IntersectionObserver' in window)) return;
    if (bar && cover) {
      new IntersectionObserver(function(list){
        bar.classList.toggle('on', !list[0].isIntersecting);
      }, { threshold: 0.18 }).observe(cover);
    }
    spy = new IntersectionObserver(function(list){
      list.forEach(function(en){
        if (!en.isIntersecting) return;
        var id = en.target.id;
        links.forEach(function(a){
          a.classList.toggle('on', a.getAttribute('data-nav') === id);
        });
      });
    }, { rootMargin: '-42% 0px -54% 0px' });
    spy.observe(cover);
    [].slice.call(doc.querySelectorAll('section[id]')).forEach(function(s){ spy.observe(s); });
  }
  mountSpy();

  /* 4. 分享卡 3D：指针驱动，rAF 合并，离开即复位 */
  function bindTilt(){
    var tilt = doc.querySelector('.tilt');
    var inner = doc.querySelector('.tilt-inner');
    if (!tilt || !inner || reduce) return;
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (tilt.getAttribute('data-tilt') === '1') return;
    tilt.setAttribute('data-tilt', '1');
    var raf = 0, tx = 0, ty = 0;
    var paint = function(){
      raf = 0;
      inner.style.transform = 'rotateY(' + (tx * 11).toFixed(2) + 'deg) rotateX(' + (-ty * 9).toFixed(2) + 'deg)';
    };
    tilt.addEventListener('pointermove', function(ev){
      var b = tilt.getBoundingClientRect();
      tx = ((ev.clientX - b.left) / b.width - 0.5) * 2;
      ty = ((ev.clientY - b.top) / b.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(paint);
    });
    tilt.addEventListener('pointerleave', function(){ inner.style.transform = ''; });
  }
  bindTilt();

  /* 5. 复制 / 打印 */
  var toast = doc.getElementById('toast');
  var toastTimer = 0;
  function say(msg){
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove('on'); }, 1800);
  }
  function fallbackCopy(text, done){
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); done(); } catch(e) {}
    doc.body.removeChild(ta);
  }
  doc.addEventListener('click', function(ev){
    var t = ev.target;
    if (!t || !t.closest) return;
    var copyBtn = t.closest('[data-copy]');
    if (copyBtn) {
      var text = copyBtn.getAttribute('data-copy') || '';
      var ok = copyBtn.getAttribute('data-ok') || '已复制';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function(){ say(ok); }, function(){ fallbackCopy(text, function(){ say(ok); }); });
      } else {
        fallbackCopy(text, function(){ say(ok); });
      }
      return;
    }
    if (t.closest('[data-print]')) window.print();
  });

  /* 6. 区间筛选：所有数字来自同一份引擎，见 src/engine/range.mjs */
  var raw = doc.getElementById('ledger-data');
  if (!R || !raw) return;
  var DATA = null;
  try { DATA = JSON.parse(raw.textContent || '{}'); } catch(e) { return; }
  if (!DATA || !DATA.rows) return;

  var HOSTS = ['cover', 'flow', 'attr', 'strategy', 'profile', 'share'];
  var hosts = {};
  HOSTS.forEach(function(k){ hosts[k] = doc.getElementById('h-' + k); });

  var chips = doc.getElementById('fltChips');
  var panel = doc.getElementById('fltCustom');
  var inFrom = doc.getElementById('fltFrom');
  var inTo = doc.getElementById('fltTo');
  var btnApply = doc.getElementById('fltApply');
  var spanEl = doc.getElementById('fltSpan');
  var barK = doc.querySelector('[data-bar-k]');
  var barV = doc.querySelector('[data-bar-v]');
  var copyTop = doc.querySelector('.bar-r [data-copy]');
  var KEY = 'mcd-ledger-range';
  var current = DATA.defaultRange || '30d';

  function money(v){ return R.yuan(v); }

  function paintChips(range){
    if (!chips) return;
    [].slice.call(chips.querySelectorAll('[data-range]')).forEach(function(b){
      var k = b.getAttribute('data-range');
      var on = range.custom ? k === 'custom' : k === range.key;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function paintMeta(view){
    if (spanEl) {
      spanEl.textContent =
        view.range.from + ' → ' + view.range.to + ' · ' + view.range.days + ' 天 · ' +
        view.summary.orders + ' 笔' + (view.summary.orders === 0 ? '（无订单）' : '');
    }
    if (barK) barK.textContent = (view.range.custom ? '自定义' : view.range.label) + ' · 省下';
    if (barV) barV.textContent = view.summary.saved === null ? '—' : money(view.summary.saved);
    if (copyTop) copyTop.setAttribute('data-copy', R.shareText(view.summary, view.range));
    doc.title = '麦麦账本 · ' + view.range.from + ' 至 ' + view.range.to;
  }

  function readStore(){
    try { return window.localStorage.getItem(KEY); } catch(e) { return null; }
  }
  function writeStore(spec){
    try { window.localStorage.setItem(KEY, spec); } catch(e) {}
  }

  function applyRange(spec, remember){
    var view;
    try {
      view = R.buildView(DATA, spec);
    } catch (e) {
      say('这个区间算不出来：' + (e && e.message ? e.message : '未知错误'));
      return;
    }
    HOSTS.forEach(function(k){
      var el = hosts[k];
      if (!el) return;
      el.innerHTML = view.html[k];
      [].slice.call(el.querySelectorAll('.rv')).forEach(function(x){ x.classList.add('in'); });
    });
    animateCounts(hosts.cover);
    bindTilt();
    if (spy) {
      spy.disconnect();
      spy.observe(cover);
      [].slice.call(doc.querySelectorAll('section[id]')).forEach(function(s){ spy.observe(s); });
    }
    paintChips(view.range);
    paintMeta(view);
    current = spec;
    syncPlanLinks(spec);
    if (remember) writeStore(spec);
  }

  /* 切区间后，账本页通往决策页的每个入口都要换参数：
     对面拿到的 range 与这里一致，才能算出同一批常点商品和同一批券 */
  function syncPlanLinks(spec){
    var base = '${PLAN_HREF}' + '?from=ledger&range=' + encodeURIComponent(spec);
    [].slice.call(doc.querySelectorAll('[data-plan-link]')).forEach(function(a){
      var st = a.getAttribute('data-strat');
      a.setAttribute('href', st ? base + '&strat=' + encodeURIComponent(st) : base);
    });
  }

  if (chips) {
    chips.addEventListener('click', function(ev){
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-range]') : null;
      if (!btn) return;
      var key = btn.getAttribute('data-range');
      if (key === 'custom') {
        if (panel) panel.hidden = false;
        paintChips({ key: '', custom: true });
        if (inFrom && !inFrom.value) inFrom.value = '';
        if (inTo && !inTo.value) inTo.value = '';
        if (inFrom) inFrom.focus();
        return;
      }
      if (panel) panel.hidden = true;
      applyRange(key, true);
    });
  }

  if (btnApply) {
    btnApply.addEventListener('click', function(){
      var a = inFrom ? inFrom.value : '';
      var b = inTo ? inTo.value : '';
      if (!a || !b) { say('请把起止日期都选上'); return; }
      if (a > b) { say('开始日期不能晚于结束日期'); return; }
      if (panel) panel.hidden = true;
      applyRange(a + '..' + b, true);
    });
  }

  /* 打印前展开所有折叠块，避免内容被吞 */
  window.addEventListener('beforeprint', function(){
    [].slice.call(doc.querySelectorAll('details')).forEach(function(d){ d.open = true; });
  });

  /* 记住上次的选择：下次打开直接落在他关心的区间上 */
  var saved = readStore();
  if (saved && saved !== current) {
    try {
      var probe = R.buildView(DATA, saved);
      if (probe.range.key === 'custom') {
        if (inFrom) inFrom.value = probe.range.from;
        if (inTo) inTo.value = probe.range.to;
      }
      applyRange(saved, false);
    } catch(e) {}
  }
})();
`;

