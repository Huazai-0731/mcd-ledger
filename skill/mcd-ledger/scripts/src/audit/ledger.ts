/**
 * 把审计结果压成一份**区间无关的事实表**，交给前端引擎按任意区间重算。
 *
 * 为什么不直接把 AuditReport 塞进页面？
 * ----------------------------------------------------------------
 * 因为 AuditReport 是"某一个区间"的结论，切区间时它没有用。
 * 真正需要下发的只有两类东西：
 *   ① 逐单的**已结算事实**（实付、原价、券/活动/组合各多少、买了什么）
 *   ② 与区间无关的账户上下文（卡包券、菜单现价、活动日历）
 * 剩下的聚合、策略、渲染全部由 src/engine/range.mjs 现场算——
 * 同一份引擎在 Node 里先算过一遍（首屏 SSR），在浏览器里再算一遍（切区间），
 * 两边用的是同一段代码，不可能对不上。
 *
 * 注意：这里不做任何"推断"，只把 priceOrder 已经算好的归因结果搬过去。
 * 券的"最多能省多少"也在这一侧算（estimateCouponSaving），
 * 引擎因此完全不需要做商品名匹配——那是账本里最容易出错的一段逻辑，只留一份。
 */
import { estimateCouponSaving } from "./detectors.ts";
import { toDateKey } from "./windows.ts";
import type { Campaign, Coupon, MenuItem, PricedOrder } from "../model/types.ts";
import type {
  LedgerCampaign,
  LedgerCoupon,
  LedgerData,
  LedgerMenuItem,
  LedgerRow,
} from "../engine/range.mjs";
import { DEFAULT_RANGE } from "../engine/range.mjs";

export interface LedgerInput {
  priced: PricedOrder[];
  coupons: Coupon[];
  campaigns: Campaign[];
  menu: Record<string, MenuItem>;
  now: Date;
  demo: boolean;
  traceId: string;
}

export function buildLedger(input: LedgerInput): LedgerData {
  const rows = input.priced.map(toRow).sort((a, b) => a.ms - b.ms);

  const usedCodes = new Set<string>();
  for (const row of rows) {
    for (const item of row.items) usedCodes.add(item[0]);
  }

  const menu: Record<string, LedgerMenuItem> = {};
  for (const code of usedCodes) {
    const item = input.menu[code];
    if (!item) continue;
    menu[code] = { p: item.currentPrice, o: item.originalPrice, d: item.discountType };
  }

  const coupons: LedgerCoupon[] = input.coupons.map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    validFrom: c.validFrom,
    validTo: c.validTo,
    weekdays: c.weekdays,
    startTime: c.startTime,
    endTime: c.endTime,
    channels: c.channels,
    tags: c.tags,
    // 券名 × 菜单现价的匹配只在这一侧做一次
    worth: estimateCouponSaving(c, input.menu),
  }));

  const campaigns: LedgerCampaign[] = input.campaigns.map((c) => ({
    title: c.title,
    date: c.date,
    summary: c.summary,
    kind: c.kind,
  }));

  const times = rows.map((r) => r.ms);
  const nowMs = input.now.getTime();

  return {
    v: 1,
    now: nowMs,
    nowIso: input.now.toISOString(),
    defaultRange: DEFAULT_RANGE,
    rows,
    coupons,
    campaigns,
    menu,
    meta: {
      demo: input.demo,
      traceId: input.traceId,
      dataFrom: times.length > 0 ? toDateKey(new Date(Math.min(...times))) : toDateKey(input.now),
      dataTo: times.length > 0 ? toDateKey(new Date(Math.max(...times))) : toDateKey(input.now),
    },
  };
}

function toRow(p: PricedOrder): LedgerRow {
  const order = p.order;
  const d = new Date(order.createdAtMs);

  return {
    ms: order.createdAtMs,
    m: d.getHours() * 60 + d.getMinutes(),
    id: order.orderId,
    ch: order.channel,
    st: order.storeName,
    paid: p.paid,
    list: p.list,
    ala: p.alaCarte,
    cpn: p.coupon,
    act: p.activity,
    cmb: p.combo,
    del: p.deliveryFee,
    cov: p.coverage === 1 ? 1 : 0,
    status: order.status === "cancelled" ? "cancelled" : "completed",
    items: p.lines.map((line) => [
      line.line.productCode,
      line.line.productName,
      line.line.quantity,
      line.sale === null || line.line.quantity <= 0
        ? null
        : Math.round((line.sale / line.line.quantity) * 100) / 100,
    ]),
    coupons: (order.detail?.coupons ?? []).filter((c) => c.amount > 0).map((c) => c.name),
  };
}
