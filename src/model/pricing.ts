/**
 * 价格与归因模型 —— 整个账本的核心。
 *
 * 关键设计变更（v0.1.0 实测后重写）：
 * 最初只用 query-meals 的划线价反推，但真实账号里大量历史 SKU 已下架、菜单还随
 * 时段切换（10:00 前只有早餐菜单），导致归因覆盖率只有 8%。
 *
 * 因此改为**双源**：
 *   权威源 = query-order 的 totalAmount / totalDiscountAmount / couponList
 *            —— 平台自己记的账，任何时点都能取到，不受商品下架影响
 *   增强源 = query-meals 的单品现价
 *            —— 只用来额外回答"套餐比单点省了多少"，取不到就不给结论
 *
 * 于是三层口径变成：
 *   ① 单点合计 alaCarte = 逐个子项按单品现价相加（增强源，可能为 null）
 *   ② 原价合计 list     = 订单详情 totalAmount（权威源）
 *   ③ 实付     paid     = 订单详情 realTotalAmount（权威源）
 *
 * 节省 = 券优惠 + 活动/卡优惠 + 组合价值
 *   券优惠   = Σ couponList[].discountAmount
 *   活动优惠 = totalDiscountAmount − 券优惠
 *   组合价值 = ① − ②（仅在能还原时给出）
 */
import { money } from "../runtime/contract.ts";
import type { MenuItem, Order, PricedLine, PricedOrder } from "../model/types.ts";

export function priceOrder(order: Order, menu: Record<string, MenuItem>): PricedOrder {
  const lines = order.lines.map((line) => priceLine(line, menu));
  const allPriced = lines.length > 0 && lines.every((l) => l.alaCarte !== null);
  const alaCarte = allPriced ? money(sum(lines.map((l) => l.alaCarte ?? 0))) : null;

  const detail = order.detail ?? null;

  if (detail && detail.totalAmount !== null) {
    const list = money(detail.totalAmount);
    const paid = money(detail.paid ?? order.paid);
    const deliveryFee = money(detail.deliveryFee ?? 0);

    let discount = detail.discount;
    if (discount === null) {
      // 详情缺 totalDiscountAmount 时用恒等式倒推：原价 − 实付 + 配送费
      discount = Math.max(0, money(list - paid + deliveryFee));
    }
    discount = money(discount);

    const coupon = money(sum(detail.coupons.map((c) => Math.max(0, c.amount))));
    const activity = money(Math.max(0, discount - coupon));
    const combo = alaCarte !== null ? money(Math.max(0, alaCarte - list)) : null;

    const reasons: Record<string, number> = {};
    for (const c of detail.coupons) {
      if (c.amount <= 0) continue;
      const key = c.name.trim() === "" ? "优惠券" : c.name;
      reasons[key] = money((reasons[key] ?? 0) + c.amount);
    }
    if (activity > 0) reasons["活动 / 卡权益"] = activity;

    return {
      order,
      lines,
      paid,
      list,
      alaCarte,
      coupon,
      activity,
      combo,
      deliveryFee,
      coverage: 1,
      source: "detail",
      gap: 0,
      reasons,
    };
  }

  // 拿不到详情：只提供"信息"，不提供"归因"
  const listComplete = lines.length > 0 && lines.every((l) => l.list !== null);
  return {
    order,
    lines,
    paid: order.paid,
    list: listComplete ? money(sum(lines.map((l) => l.list ?? 0))) : null,
    alaCarte,
    coupon: 0,
    activity: 0,
    combo: null,
    deliveryFee: 0,
    coverage: 0,
    source: allPriced ? "menu" : "none",
    gap: order.paid,
    reasons: {},
  };
}

export function priceLine(
  line: Order["lines"][number],
  menu: Record<string, MenuItem>,
): PricedLine {
  const item = menu[line.productCode];

  if (!item || item.currentPrice === null) {
    return {
      line,
      resolution: "missing",
      reason: null,
      alaCarte: null,
      list: null,
      sale: null,
    };
  }

  const sale = money(item.currentPrice * line.quantity);
  const list = item.originalPrice !== null ? money(item.originalPrice * line.quantity) : sale;

  let alaCarte: number | null;
  if (line.comboItems.length === 0) {
    alaCarte = sale;
  } else {
    let total = 0;
    let complete = true;
    for (const ci of line.comboItems) {
      const sub = menu[ci.code];
      if (!sub || sub.currentPrice === null) {
        complete = false;
        break;
      }
      total += sub.currentPrice * ci.quantity;
    }
    alaCarte = complete ? money(total * line.quantity) : null;
  }

  return {
    line,
    resolution: alaCarte === null ? "combo-partial" : "exact",
    reason: item.discountType,
    alaCarte,
    list,
    sale,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
