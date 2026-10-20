/**
 * 渲染：账本页（单文件 HTML，无外部依赖、无 CDN、可离线打开、可直接截图分享）。
 *
 * 设计取向：做成"对账单"而不是"数据大屏"。
 * 对账单的信任感来自三件事：口径写清楚、算不出的地方留白、每个数字都能指回来源。
 */
import type { AuditReport, Leak, PurchaseWindow } from "../model/types.ts";

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CHANNEL_CN: Record<string, string> = {
  pickup: "到店自取",
  delivery: "外送",
  drivethru: "得来速",
  group: "团餐",
  unknown: "其他",
};

export function renderHtml(report: AuditReport): string {
  const t = report.totals;
  const a = report.attribution;
  const savedText = t.saved === null ? "—" : yuan(t.saved);
  const rateText = t.savedRate === null ? "—" : `${(t.savedRate * 100).toFixed(1)}%`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>麦麦账本 · ${esc(report.period.from ?? "")} 至 ${esc(report.period.to ?? "")}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="sheet">

  <header class="hd">
    <div class="hd-l">
      <div class="brand">麦麦账本 <span class="dot"></span> McLedger</div>
      <h1>你的麦当劳消费对账单</h1>
      <p class="sub">${esc(report.period.from ?? "—")} 至 ${esc(report.period.to ?? "—")}　·　共 ${report.period.days} 天　·　${t.completedOrders} 笔完成订单</p>
    </div>
    <div class="hd-r">
      <div class="stamp">
        <span class="stamp-n">${t.completedOrders}</span>
        <span class="stamp-l">笔订单</span>
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="kpi">
      <div class="kpi-l">实付总额</div>
      <div class="kpi-v">${yuan(t.paid)}</div>
      <div class="kpi-s">平均每笔 ${yuan(report.profile.avgTicket)}</div>
    </div>
    <div class="kpi accent">
      <div class="kpi-l">省下来的钱</div>
      <div class="kpi-v">${savedText}${report.attribution.lowerBound ? '<span style="font-size:13px;color:#8b9099;font-weight:600"> 下限</span>' : ""}</div>
      <div class="kpi-s">相当于原价的 ${rateText}</div>
    </div>
    <div class="kpi">
      <div class="kpi-l">漏掉的钱</div>
      <div class="kpi-v warn">${report.leakTotal > 0 ? yuan(report.leakTotal) : "—"}</div>
      <div class="kpi-s">${report.leaks.length} 项可改进点</div>
    </div>
  </section>

  ${renderWaterfall(report)}

  <section class="block">
    <h2>省的钱从哪来</h2>
    <p class="note">三项互不重叠：促销直降、套餐组合价值、券与账户权益。合计等于「省下来的钱」。</p>
    ${renderAttribution(report)}
  </section>

  <section class="block">
    <h2>漏掉的钱</h2>
    <p class="note">只列有证据的项。已下架商品导致的归因缺口不折算金额——账本选择不估算，而不是编一个数字。</p>
    ${report.leaks.length === 0 ? '<p class="empty">这一期没有发现漏损。</p>' : report.leaks.map(renderLeak).join("")}
  </section>

  <section class="block">
    <h2>接下来 7 天，什么时候买最划算</h2>
    ${renderWindows(report.windows)}
  </section>

  <section class="block">
    <h2>你的消费画像</h2>
    <div class="grid2">
      ${renderBars("时段分布", Object.entries(report.profile.mealPeriods).sort((x, y) => y[1] - x[1]), t.completedOrders)}
      ${renderBars("渠道分布", Object.entries(report.profile.channels).map(([k, v]) => [CHANNEL_CN[k] ?? k, v] as [string, number]).sort((x, y) => y[1] - x[1]), t.completedOrders)}
    </div>
    <div class="grid2" style="margin-top:18px">
      ${renderWeekday(report)}
      ${renderTopItems(report)}
    </div>
  </section>

  <section class="block quality">
    <h2>这份账本有多可信</h2>
    <div class="qgrid">
      <div><span class="qn">${(a.coverage * 100).toFixed(0)}%</span><span class="ql">金额可精确归因</span></div>
      <div><span class="qn">${report.quality.resolvedOrders}</span><span class="ql">笔订单完整还原</span></div>
      <div><span class="qn">${report.quality.demo ? "演示" : report.quality.toolCalls}</span><span class="ql">${report.quality.demo ? "合成数据" : "次 MCP 工具调用"}</span></div>
      <div><span class="qn">${(report.quality.durationMs / 1000).toFixed(1)}s</span><span class="ql">审计耗时</span></div>
    </div>
    ${
      report.quality.unresolvedOrders > 0
        ? `<p class="note">${report.quality.unresolvedOrders} 笔订单含已下架商品，未参与归因；其金额仍计入实付总额。</p>`
        : ""
    }
    ${
      report.quality.degradations.length > 0
        ? `<ul class="deg">${report.quality.degradations
            .map((d) => `<li><b>${esc(d.module)}</b>：${esc(d.reason)}　→　${esc(d.impact)}</li>`)
            .join("")}</ul>`
        : ""
    }
    <p class="trace">trace：<code>${esc(report.quality.traceId)}</code>　·　把 trace.jsonl 拖进 viewer 可逐步回放这次审计</p>
  </section>

  ${renderShareCard(report)}

  <footer class="ft">
    <p class="ft-strong">数据来源：麦当劳 MCP Server（mcp.mcd.cn）</p>
    <ul class="src">${report.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <p class="ft-note">本项目为非官方作品，由开发者独立完成，与麦当劳无隶属关系。输出仅供参考，不构成财务、税务或投资建议；餐品价格与供应状态以麦当劳官方渠道实时结果为准。本页由 mcd-ledger v0.1.0 于 ${esc(report.generatedAt.slice(0, 19).replace("T", " "))} 生成。</p>
  </footer>

</main>
</body>
</html>`;
}

/* ------------------------------- 三层价格瀑布 ------------------------------- */

function renderWaterfall(report: AuditReport): string {
  const t = report.totals;
  if (t.alaCarte === null && t.list === null) return "";

  const rows: Array<{ label: string; value: number; hint: string; cls: string }> = [];
  if (t.alaCarte !== null) rows.push({ label: "单点合计", value: t.alaCarte, hint: "拆开单点要花多少", cls: "" });
  if (t.list !== null) rows.push({ label: "划线价", value: t.list, hint: "菜单标价合计", cls: "" });
  rows.push({ label: "实付", value: t.paid, hint: "你实际付出", cls: "paid" });

  const max = Math.max(...rows.map((r) => r.value), 1);

  return `<section class="block">
    <h2>同一顿饭的三个价格</h2>
    <p class="note">把三种口径摊开，才看得出"省"到底发生在哪一层。</p>
    <div class="wf">
      ${rows
        .map(
          (r) => `<div class="wf-row ${r.cls}">
        <div class="wf-l">${esc(r.label)}<span>${esc(r.hint)}</span></div>
        <div class="wf-bar"><i style="width:${((r.value / max) * 100).toFixed(1)}%"></i></div>
        <div class="wf-v">${yuan(r.value)}</div>
      </div>`,
        )
        .join("")}
    </div>
  </section>`;
}

/* -------------------------------- 归因分项 -------------------------------- */

function renderAttribution(report: AuditReport): string {
  const a = report.attribution;
  const cards: string[] = [];

  const base: Array<{ label: string; value: number; hint: string }> = [
    { label: "券优惠", value: a.coupon, hint: "逐券金额，可对到订单" },
    { label: "活动 / 卡权益", value: a.activity, hint: "总优惠 − 券优惠" },
  ];
  if (a.combo !== null) {
    base.push({ label: "套餐组合价值", value: a.combo, hint: "单点合计 − 原价合计" });
  }
  const total = base.reduce((s, i) => s + i.value, 0) || 1;

  for (const i of base) {
    cards.push(`<div class="attr-item">
      <div class="attr-top"><span>${esc(i.label)}</span><b>${yuan(i.value)}</b></div>
      <div class="attr-bar"><i style="width:${((i.value / total) * 100).toFixed(1)}%"></i></div>
      <div class="attr-hint">${esc(i.hint)}　·　占比 ${((i.value / total) * 100).toFixed(0)}%</div>
    </div>`);
  }

  if (a.combo === null) {
    cards.push(`<div class="attr-item attr-na">
      <div class="attr-top"><span>套餐组合价值</span><b>—</b></div>
      <div class="attr-hint">本期订单里的套餐商品已下架，单品现价无法还原，因此不给出组合价值——而不是填 0。</div>
    </div>`);
  }

  return `<div class="attr">${cards.join("")}</div>
  ${
    a.lowerBound
      ? `<p class="note">「省下来的钱」是<strong>下限</strong>：已计入的部分全部来自平台订单记录（原价合计 − 实付），可逐笔核对；未计入的是无法还原的套餐组合价值。</p>`
      : ""
  }
  ${
    a.reasons.length > 0
      ? `<table class="tbl"><thead><tr><th>优惠类型</th><th class="r">金额</th><th class="r">涉及订单</th></tr></thead><tbody>
    ${a.reasons
      .slice(0, 8)
      .map(
        (r) => `<tr><td>${esc(r.reason)}</td><td class="r">${yuan(r.amount)}</td><td class="r">${r.orders}</td></tr>`,
      )
      .join("")}
  </tbody></table>`
      : ""
  }
  ${
    a.deliveryFee > 0
      ? `<p class="note">另有 ${yuan(a.deliveryFee)} 配送费计入实付，不属于优惠。</p>`
      : ""
  }`;
}

/* --------------------------------- 漏损卡 --------------------------------- */

function renderLeak(leak: Leak): string {
  const amount =
    leak.amount === null
      ? '<span class="leak-na">不折算</span>'
      : `<span class="leak-amt">${yuan(leak.amount)}${leak.amountEstimated ? '<i>估算</i>' : ""}</span>`;
  return `<div class="leak">
    <div class="leak-h"><b>${esc(leak.title)}</b>${amount}</div>
    <ul>${leak.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
    <div class="leak-a">建议：${esc(leak.action)}</div>
  </div>`;
}

/* --------------------------------- 窗口 --------------------------------- */

function renderWindows(windows: PurchaseWindow[]): string {
  if (windows.length === 0) {
    return '<p class="empty">未来 7 天没有识别到券或活动窗口。可以去卡包领券后再生成一次。</p>';
  }
  return `<div class="win">
    ${windows
      .map(
        (w) => `<div class="win-row">
      <div class="win-d"><b>${esc(w.label)}</b><span>${esc(w.date)} ${esc(w.weekday)}</span></div>
      <div class="win-t">${w.startTime ? `${esc(w.startTime)}–${esc(w.endTime ?? "")}` : "全天"}</div>
      <div class="win-o">${w.offers.slice(0, 3).map((o) => `<span class="tag">${esc(o)}</span>`).join("")}${
        w.offers.length > 3 ? `<span class="tag more">+${w.offers.length - 3}</span>` : ""
      }</div>
      <div class="win-s">${w.saving === null ? "—" : `省 ${yuan(w.saving)}`}</div>
    </div>`,
      )
      .join("")}
  </div>`;
}

/* -------------------------------- 小图表 -------------------------------- */

function renderBars(title: string, entries: Array<[string, number]>, total: number): string {
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return `<div class="mini">
    <div class="mini-t">${esc(title)}</div>
    ${entries
      .map(
        ([k, v]) => `<div class="bar-row">
      <span class="bar-k">${esc(k)}</span>
      <span class="bar-t"><i style="width:${((v / max) * 100).toFixed(1)}%"></i></span>
      <span class="bar-v">${v}${total > 0 ? ` · ${((v / total) * 100).toFixed(0)}%` : ""}</span>
    </div>`,
      )
      .join("")}
  </div>`;
}

function renderWeekday(report: AuditReport): string {
  const max = Math.max(...report.profile.weekdayHeatmap, 1);
  return `<div class="mini">
    <div class="mini-t">一周节奏</div>
    <div class="heat">
      ${report.profile.weekdayHeatmap
        .map((v, i) => {
          const alpha = v === 0 ? 0.06 : 0.12 + (v / max) * 0.78;
          return `<div class="heat-c"><span class="heat-b" style="background:rgba(218,41,28,${alpha.toFixed(2)})">${v}</span><span class="heat-l">${WEEKDAY_CN[i]?.replace("周", "") ?? ""}</span></div>`;
        })
        .join("")}
    </div>
  </div>`;
}

function renderTopItems(report: AuditReport): string {
  if (report.profile.topItems.length === 0) return "";
  return `<div class="mini">
    <div class="mini-t">最常点</div>
    <ol class="tops">
      ${report.profile.topItems
        .map((i) => `<li><span>${esc(i.name)}</span><b>×${i.quantity}</b></li>`)
        .join("")}
    </ol>
  </div>`;
}

/* ------------------------------- 分享卡 ------------------------------- */

function renderShareCard(report: AuditReport): string {
  const t = report.totals;
  return `<section class="block share-wrap">
    <h2>分享卡</h2>
    <p class="note">截图这一块即可分享。数字来自本机审计结果，不含订单明细。</p>
    <div class="share">
      <div class="share-b">麦麦账本</div>
      <div class="share-per">${esc(report.period.from ?? "")} — ${esc(report.period.to ?? "")}</div>
      <div class="share-main">
        <div class="share-n">${t.saved === null ? "—" : yuan(t.saved)}</div>
        <div class="share-l">这段时间省下来的钱</div>
      </div>
      <div class="share-row">
        <div><b>${yuan(t.paid)}</b><span>实付</span></div>
        <div><b>${t.completedOrders}</b><span>笔订单</span></div>
        <div><b>${report.leakTotal > 0 ? yuan(report.leakTotal) : "—"}</b><span>还漏掉</span></div>
      </div>
      <div class="share-f">mcd-ledger · 非官方作品</div>
    </div>
  </section>`;
}

/* -------------------------------- helpers -------------------------------- */

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

const STYLE = `
:root{
  --ink:#17181a; --ink2:#5b6068; --ink3:#8b9099;
  --line:#e6e2d9; --paper:#fbfaf6; --card:#ffffff;
  --yellow:#ffc72c; --red:#da291c; --green:#1f7a45;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#efece4;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.65;-webkit-font-smoothing:antialiased;padding:28px 16px}
.sheet{max-width:900px;margin:0 auto;background:var(--paper);border-radius:14px;padding:44px 48px 36px;border:1px solid var(--line)}
h1{font-size:30px;line-height:1.25;letter-spacing:-.02em;font-weight:700;margin:10px 0 8px}
h2{font-size:15px;font-weight:700;letter-spacing:.02em;margin-bottom:6px}
.brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.brand .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin:0 4px 2px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:22px;border-bottom:2px solid var(--ink)}
.sub{color:var(--ink2);font-size:13.5px}
.stamp{text-align:center;border:1px solid var(--line);border-radius:10px;padding:10px 16px;background:#fff}
.stamp-n{display:block;font-size:22px;font-weight:700;line-height:1.2}
.stamp-l{font-size:11px;color:var(--ink3);letter-spacing:.08em}
.hero{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0 8px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 18px 16px}
.kpi.accent{background:#fffbee;border-color:#f0dfa8}
.kpi-l{font-size:12px;color:var(--ink3);letter-spacing:.06em}
.kpi-v{font-size:31px;font-weight:700;letter-spacing:-.02em;line-height:1.25;margin:4px 0 2px}
.kpi-v.warn{color:var(--red)}
.kpi-s{font-size:12px;color:var(--ink2)}
.block{padding:26px 0;border-bottom:1px solid var(--line)}
.note{font-size:12.5px;color:var(--ink2);margin-bottom:14px;max-width:660px}
.empty{font-size:13px;color:var(--ink3);padding:14px 0}
.wf-row{display:grid;grid-template-columns:150px 1fr 92px;gap:14px;align-items:center;margin-bottom:10px}
.wf-l{font-size:13px;color:var(--ink2)}
.wf-l span{display:block;font-size:11px;color:var(--ink3)}
.wf-bar{height:14px;background:#f0ede5;border-radius:3px;overflow:hidden}
.wf-bar i{display:block;height:100%;background:#c9c4b6;border-radius:3px}
.wf-row.paid .wf-bar i{background:var(--ink)}
.wf-row.paid .wf-l{color:var(--ink);font-weight:600}
.wf-v{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.attr{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}
.attr-item{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.attr-item.attr-na{background:#faf8f3;border-style:dashed}
.attr-item.attr-na .attr-hint{line-height:1.55}
.attr-top{display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink2);margin-bottom:8px}
.attr-top b{font-size:16px;color:var(--ink)}
.attr-bar{height:6px;background:#f0ede5;border-radius:3px;overflow:hidden;margin-bottom:7px}
.attr-bar i{display:block;height:100%;background:var(--yellow);border-radius:3px}
.attr-item:nth-child(2) .attr-bar i{background:#f0a03c}
.attr-item:nth-child(3) .attr-bar i{background:#e0703c}
.attr-hint{font-size:11px;color:var(--ink3)}
.tbl{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}
.tbl th{text-align:left;font-weight:600;color:var(--ink3);font-size:11px;letter-spacing:.06em;padding:8px 4px;border-bottom:1px solid var(--line)}
.tbl td{padding:8px 4px;border-bottom:1px solid #f2efe8;color:var(--ink2)}
.tbl .r{text-align:right;font-variant-numeric:tabular-nums}
.leak{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--red);border-radius:8px;padding:14px 16px;margin-bottom:10px}
.leak-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.leak-h b{font-size:14px}
.leak-amt{font-weight:700;color:var(--red);font-variant-numeric:tabular-nums;white-space:nowrap}
.leak-amt i{font-style:normal;font-size:10px;color:var(--ink3);margin-left:5px;border:1px solid var(--line);padding:0 4px;border-radius:3px;vertical-align:middle}
.leak-na{font-size:12px;color:var(--ink3);white-space:nowrap}
.leak ul{margin:8px 0 0;padding-left:16px;font-size:12.5px;color:var(--ink2)}
.leak li{margin-bottom:3px}
.leak-a{margin-top:9px;font-size:12.5px;color:var(--green);background:#f4faf6;border-radius:6px;padding:7px 10px}
.win-row{display:grid;grid-template-columns:82px 96px 1fr 76px;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #f2efe8}
.win-d b{display:block;font-size:13.5px}
.win-d span{font-size:11px;color:var(--ink3)}
.win-t{font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums}
.win-o{display:flex;flex-wrap:wrap;gap:5px}
.tag{font-size:11px;background:#fffbee;border:1px solid #f0dfa8;color:#7a5a12;padding:1px 7px;border-radius:4px}
.tag.more{background:#f4f2ec;border-color:var(--line);color:var(--ink3)}
.win-s{text-align:right;font-size:12px;font-weight:600;color:var(--green);white-space:nowrap}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.mini-t{font-size:12px;color:var(--ink3);letter-spacing:.04em;margin-bottom:10px}
.bar-row{display:grid;grid-template-columns:72px 1fr 76px;gap:10px;align-items:center;margin-bottom:6px}
.bar-k{font-size:12px;color:var(--ink2)}
.bar-t{height:8px;background:#f0ede5;border-radius:4px;overflow:hidden}
.bar-t i{display:block;height:100%;background:var(--ink);border-radius:4px;opacity:.75}
.bar-v{font-size:11.5px;color:var(--ink3);text-align:right;font-variant-numeric:tabular-nums}
.heat{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.heat-c{text-align:center}
.heat-b{display:block;border-radius:5px;padding:9px 0;font-size:12px;font-weight:600;color:#fff}
.heat-l{font-size:11px;color:var(--ink3);display:block;margin-top:3px}
.tops{list-style:none;counter-reset:i}
.tops li{display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink2);padding:6px 0;border-bottom:1px solid #f2efe8;counter-increment:i}
.tops li::before{content:counter(i);color:var(--ink3);font-size:11px;margin-right:8px}
.tops li span{flex:1}
.tops li b{font-weight:600;color:var(--ink)}
.quality{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 22px 18px;margin-top:26px;border-bottom:1px solid var(--line)}
.qgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0 14px}
.qgrid>div{text-align:center;border-right:1px solid var(--line)}
.qgrid>div:last-child{border-right:none}
.qn{display:block;font-size:22px;font-weight:700;letter-spacing:-.02em}
.ql{display:block;font-size:11px;color:var(--ink3);margin-top:2px}
.deg{margin:10px 0 0;padding-left:16px;font-size:12px;color:var(--ink2)}
.deg li{margin-bottom:4px}
.trace{font-size:11.5px;color:var(--ink3);margin-top:10px}
.trace code{background:#f4f2ec;padding:1px 6px;border-radius:4px;font-size:11px}
.share-wrap{border-bottom:none;padding-bottom:8px}
.share{width:320px;background:linear-gradient(160deg,#1d1f22 0%,#2b2e33 100%);color:#fff;border-radius:16px;padding:26px 24px;box-shadow:0 8px 24px rgba(0,0,0,.14)}
.share-b{font-size:11px;letter-spacing:.18em;color:var(--yellow);text-transform:uppercase}
.share-per{font-size:11px;color:#9aa0a8;margin-top:4px}
.share-main{margin:26px 0 20px}
.share-n{font-size:44px;font-weight:700;letter-spacing:-.03em;line-height:1.1}
.share-l{font-size:12px;color:#b9bfc7;margin-top:4px}
.share-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border-top:1px solid rgba(255,255,255,.14);padding-top:14px}
.share-row b{display:block;font-size:14px}
.share-row span{font-size:10.5px;color:#9aa0a8}
.share-f{margin-top:18px;font-size:10px;color:#71767d;letter-spacing:.04em}
.ft{margin-top:28px;padding-top:18px;border-top:1px solid var(--line)}
.ft-strong{font-size:12px;font-weight:600;color:var(--ink2)}
.src{margin:6px 0 12px;padding-left:16px;font-size:11.5px;color:var(--ink3);columns:2;column-gap:24px}
.ft-note{font-size:11px;color:var(--ink3);line-height:1.7}
@media (max-width:760px){
  .sheet{padding:26px 20px}
  .hero,.attr,.grid2,.qgrid{grid-template-columns:1fr}
  .qgrid>div{border-right:none;border-bottom:1px solid var(--line);padding-bottom:10px}
  .win-row{grid-template-columns:1fr 1fr;row-gap:6px}
  .src{columns:1}
  h1{font-size:23px}
  .kpi-v{font-size:26px}
}
@media print{
  body{background:#fff;padding:0}
  .sheet{border:none;border-radius:0;box-shadow:none;max-width:none}
  .block{break-inside:avoid}
}
`;
