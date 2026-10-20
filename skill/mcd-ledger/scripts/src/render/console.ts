/**
 * 渲染：终端摘要。这是用户第一次运行看到的东西，所以它必须"一眼看懂、立刻有结论"。
 * 所有可选信息（trace、降级、覆盖率）放在摘要之后，而不是挤在第一屏。
 */
import type { AuditReport } from "../model/types.ts";
import { strategyCaption } from "../engine/range.mjs";

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

export function renderConsole(report: AuditReport): string {
  const t = report.totals;
  const a = report.attribution;
  const line = c.dim("─".repeat(58));
  const out: string[] = [];

  out.push("");
  out.push(`  ${c.bold("麦麦账本")} ${c.dim("· 你的麦当劳消费对账单")}`);
  out.push("");
  out.push(
    `  期间   ${report.period.from ?? "—"} → ${report.period.to ?? "—"} ${c.dim(`· ${report.period.days} 天 · ${t.completedOrders} 笔 · ${report.range.label}`)}`,
  );
  out.push(`  实付   ${c.bold(yuan(t.paid))}   ${c.dim(`平均每笔 ${yuan(report.profile.avgTicket)}`)}`);
  out.push(
    `  省下   ${t.saved === null ? "—" : c.yellow(c.bold(yuan(t.saved)))}` +
      (a.lowerBound ? c.dim(" (下限)") : "") +
      (t.savedRate !== null ? c.dim(`   相当于原价 ${(t.savedRate * 100).toFixed(1)}%`) : ""),
  );
  out.push(
    `  漏掉   ${report.leakTotal > 0 ? c.red(c.bold(yuan(report.leakTotal))) : c.green("0.00")}   ${c.dim(`${report.leaks.length} 项 · 账户口径，不随区间变化`)}`,
  );
  const st = report.strategyTotals;
  out.push(
    `  再省   ${st.perMonth > 0 ? c.yellow(c.bold(yuan(st.perMonth))) + c.dim(" / 月（估算）") : c.dim("—")}   ${c.dim(strategyCaption(st))}`,
  );
  out.push(line);

  out.push(`  ${c.bold("省的钱从哪来")}`);
  const combo = a.combo ?? 0;
  const total = a.coupon + a.activity + combo || 1;
  const rows: Array<[string, string, number]> = [
    ["券优惠", yuan(a.coupon), a.coupon],
    ["活动 / 卡", yuan(a.activity), a.activity],
    ["套餐组合", a.combo === null ? "无法还原" : yuan(a.combo), combo],
  ];
  for (const [label, text, value] of rows) {
    const pct = (value / total) * 100;
    out.push(`  ${pad(label, 10)} ${pad(text, 11)} ${bar(pct)} ${pct.toFixed(0)}%`);
  }
  if (a.lowerBound) {
    out.push(c.dim("  （组合价值为下限：部分套餐商品已下架，单品价无法还原）"));
  }
  if (a.deliveryFee > 0) {
    out.push(c.dim(`  （另有 ${yuan(a.deliveryFee)} 配送费计入实付，不属优惠）`));
  }
  out.push(line);

  if (report.leaks.length > 0) {
    out.push(`  ${c.bold("漏掉的钱")}`);
    for (const leak of report.leaks) {
      const amt =
        leak.amount === null ? c.dim("不折算  ") : c.red(pad(yuan(leak.amount), 9));
      out.push(`  ${amt}  ${leak.title}${leak.amountEstimated ? c.dim("（估算）") : ""}`);
      const first = leak.evidence[0];
      if (first) out.push(c.dim(`             ${truncate(first, 74)}`));
    }
    out.push(line);
  }

  if (report.strategy.length > 0) {
    out.push(`  ${c.bold("下次怎么买")}  ${c.dim(report.range.label)}`);
    for (const item of report.strategy) {
      const amount =
        item.perMonth !== null
          ? c.yellow(pad(yuan(item.perMonth) + "/月", 13))
          : item.inRange !== null
            ? c.yellow(pad(yuan(item.inRange), 13))
            : c.dim(pad("不折算", 13));
      out.push(`  ${amount}  ${item.title}${c.dim("（" + item.confidenceLabel + "）")}`);
      out.push(c.dim(`                ${truncate(item.action, 72)}`));
    }
    out.push(line);
  }

  if (report.windows.length > 0) {
    out.push(`  ${c.bold("接下来 7 天")}`);
    for (const w of report.windows.slice(0, 5)) {
      const time = w.startTime ? `${w.startTime}–${w.endTime ?? ""}` : "全天";
      out.push(
        `  ${pad(w.label, 5)} ${c.dim(pad(w.date, 11))} ${pad(time, 12)} ${truncate(w.offers.join("、"), 34)}`,
      );
    }
    out.push(line);
  }

  out.push(
    `  ${c.dim(
      `可归因 ${(a.coverage * 100).toFixed(0)}% · ${
        report.quality.demo ? "合成数据（未调用 MCP）" : `${report.quality.toolCalls} 次 MCP 调用`
      } · ${(report.quality.durationMs / 1000).toFixed(1)}s · trace ${report.quality.traceId}`,
    )}`,
  );
  if (report.quality.degradations.length > 0) {
    out.push(`  ${c.dim("降级：")}${report.quality.degradations.map((d) => d.module).join("、")}`);
  }
  out.push("");

  return out.join("\n");
}

function bar(pct: number): string {
  const filled = Math.max(0, Math.min(14, Math.round((pct / 100) * 14)));
  return c.yellow("█".repeat(filled)) + c.dim("░".repeat(14 - filled));
}

function yuan(n: number): string {
  return `¥${n.toFixed(2)}`;
}

/** 按显示宽度补空格（中文按 2 宽计），避免终端表格错位 */
function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x2e80 ? 2 : 1;
  }
  return w;
}

function truncate(s: string, max: number): string {
  let w = 0;
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const cw = code > 0x2e80 ? 2 : 1;
    if (w + cw > max) return out + "…";
    w += cw;
    out += ch;
  }
  return out;
}
