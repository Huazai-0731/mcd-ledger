/**
 * 渲染：CSV 导出（订单级明细，可自行二次核对）。
 * 导出的意义在于"可审计"：用户能用 Excel 复算报告里的任何一个汇总数字。
 */
import type { PricedOrder } from "../model/types.ts";

const HEADER = [
  "下单时间",
  "订单号",
  "门店",
  "渠道",
  "状态",
  "商品",
  "数量",
  "实付",
  "原价合计",
  "单点合计",
  "券优惠",
  "活动优惠",
  "组合价值",
  "配送费",
  "归因来源",
];

export function renderOrdersCsv(priced: PricedOrder[]): string {
  const rows: string[] = [HEADER.join(",")];

  for (const p of priced) {
    const base = [
      p.order.createdAt,
      p.order.orderId,
      p.order.storeName,
      p.order.channel,
      p.order.status,
    ];

    if (p.lines.length === 0) {
      rows.push(
        [...base, "", "", num(p.paid), "", "", "", "", "", "", p.source]
          .map(csvCell)
          .join(","),
      );
      continue;
    }

    p.lines.forEach((line, index) => {
      const first = index === 0;
      rows.push(
        [
          ...base.map((v) => (first ? v : "")),
          line.line.productName,
          String(line.line.quantity),
          first ? num(p.paid) : "",
          first ? num(p.list) : "",
          first ? num(p.alaCarte) : "",
          first ? num(p.coupon) : "",
          first ? num(p.activity) : "",
          first ? num(p.combo) : "",
          first ? (p.deliveryFee > 0 ? num(p.deliveryFee) : "") : "",
          first ? p.source : "",
        ]
          .map(csvCell)
          .join(","),
      );
    });
  }

  return "\uFEFF" + rows.join("\r\n");
}

function num(v: number | null): string {
  return v === null ? "" : v.toFixed(2);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
