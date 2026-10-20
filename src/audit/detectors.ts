/**
 * 漏损检测：账本的第二类结论——"你本可以省下但没省下的钱"。
 *
 * 五类漏损，全部基于可核对的证据，不做"猜你想要"式推测：
 *   1. 过期积分       —— 已发生，不可挽回，硬数据
 *   2. 即将过期券     —— 尚未损失，可挽回，硬数据 + 估算面额
 *   3. 券窗口错配     —— 在券可用时段下过单，券却没用上，估算
 *   4. 已取消订单     —— 决策成本，不折算金额
 *   5. 归因缺口       —— 透明性说明，不折算金额
 */
import { money } from "../runtime/contract.ts";
import type { Coupon, Leak, MenuItem, Order, PointsAccount } from "../model/types.ts";
import { looseMatch, parseCouponTitle } from "../model/text.ts";

export interface DetectorInput {
  orders: Order[];
  coupons: Coupon[];
  points: PointsAccount | null;
  menu: Record<string, MenuItem>;
  now: Date;
  attributionGap: number;
  unresolvedOrders: number;
}

export function detectLeaks(input: DetectorInput): Leak[] {
  return [
    detectExpiredPoints(input.points),
    detectExpiringCoupons(input.coupons, input.now, input.menu),
    detectWindowMismatch(input.coupons, input.orders, input.menu, input.now),
    detectCancelled(input.orders),
    detectAttributionGap(input.attributionGap, input.unresolvedOrders),
  ].filter((l): l is Leak => l !== null);
}

/* ------------------------------ 1. 过期积分 ------------------------------ */

function detectExpiredPoints(points: PointsAccount | null): Leak | null {
  if (!points || points.expired <= 0) return null;
  const perYuan = points.pointsPerYuan ?? 100;
  return {
    kind: "expired-points",
    title: `${fmt(points.expired)} 积分已过期作废`,
    amount: money(points.expired / perYuan),
    amountEstimated: points.ratioEstimated,
    evidence: [
      `累计 ${fmt(points.accumulative)} 积分，已用 ${fmt(points.used)}，过期 ${fmt(points.expired)}`,
      `可用余额 ${fmt(points.available)}，本月将过期 ${fmt(points.expiringThisMonth)}`,
    ],
    action: "把积分余额设成每月固定检查项；临近过期时优先兑换无门槛券，而不是攒着等大件",
  };
}

/* ---------------------------- 2. 即将过期的券 ---------------------------- */

function detectExpiringCoupons(
  coupons: Coupon[],
  now: Date,
  menu: Record<string, MenuItem>,
): Leak | null {
  const soon = coupons.filter((c) => {
    if (!c.validTo) return c.tags.some((t) => /今日到期|即将到期/.test(t));
    const end = new Date(c.validTo.replace("T", " ")).getTime();
    if (!Number.isFinite(end)) return false;
    const hours = (end - now.getTime()) / 3_600_000;
    return hours > -1 && hours <= 48;
  });

  if (soon.length === 0) return null;

  let amount = 0;
  let priced = 0;
  const evidence: string[] = [];

  for (const c of soon) {
    const save = estimateCouponSaving(c, menu);
    if (save !== null) {
      amount += save;
      priced += 1;
    }
    const window = [c.startTime, c.endTime].filter(Boolean).join("–");
    evidence.push(
      `${c.name}${c.price !== null ? `（¥${c.price}）` : ""}${window ? ` · ${window}` : ""}` +
        `${c.validTo ? ` · 至 ${c.validTo.replace("T", " ")}` : ""}`,
    );
  }

  return {
    kind: "expiring-coupon",
    title: `${soon.length} 张券将在 48 小时内到期`,
    amount: priced > 0 ? money(amount) : null,
    amountEstimated: true,
    evidence,
    action: "到期前用掉，或优先用在小额订单上——小额单用券的边际收益最高",
  };
}

/* ---------------------------- 3. 券窗口错配 ---------------------------- */

/**
 * 定义：券生效的日期 + 星期 + 时段内，用户下过单，但券仍在卡包里。
 * 这说明"有券、有时间、有需求"三者同时成立却没被用上，是最可惜的一类漏损。
 *
 * 金额口径：**一张券只能用一次**，所以损失按「券的张数 × 单张可省」算，
 * 不乘窗口内的订单数。乘订单数会把 3 张券说成 40 次机会，
 * 那是把"库存不足"算成"损失"，在账本里属于典型的虚增。
 */
function detectWindowMismatch(
  coupons: Coupon[],
  orders: Order[],
  menu: Record<string, MenuItem>,
  now: Date,
): Leak | null {
  const completed = orders.filter((o) => o.status === "completed");
  if (completed.length === 0) return null;

  const hits: Array<{ coupon: Coupon; orders: number; save: number | null }> = [];

  for (const c of coupons) {
    let count = 0;
    for (const o of completed) {
      if (!inCouponWindow(c, new Date(o.createdAtMs), now)) continue;
      count += 1;
    }
    if (count === 0) continue;
    hits.push({ coupon: c, orders: count, save: estimateCouponSaving(c, menu) });
  }

  if (hits.length === 0) return null;

  let amount = 0;
  let priced = 0;
  const evidence: string[] = [];
  for (const h of hits) {
    if (h.save !== null) {
      amount += h.save;
      priced += 1;
    }
    evidence.push(
      `${h.coupon.name}：窗口内有 ${h.orders} 笔订单，券未使用` +
        `${h.save !== null ? `，这张券最多可省 ¥${h.save.toFixed(2)}` : ""}`,
    );
  }

  return {
    kind: "window-mismatch",
    title: `${hits.length} 张券在可用时段内被错过`,
    amount: priced > 0 ? money(amount) : null,
    amountEstimated: true,
    evidence: evidence.slice(0, 6),
    action: "把券的有效时段当成点单提醒：券在 05:00–10:29 生效，就把它绑到早餐决策上",
  };
}

/* ---------------------------- 4. 已取消订单 ---------------------------- */

function detectCancelled(orders: Order[]): Leak | null {
  const cancelled = orders.filter((o) => o.status === "cancelled");
  if (cancelled.length === 0) return null;
  return {
    kind: "cancelled-order",
    title: `${cancelled.length} 笔订单被取消`,
    amount: null,
    amountEstimated: false,
    evidence: cancelled.slice(0, 5).map((o) => `${o.createdAt} · ${o.storeName} · ¥${o.paid.toFixed(2)}`),
    action: "取消多集中在同一门店时，先确认出餐时长再下单，比反复取消更省时间",
  };
}

/* ---------------------------- 5. 归因缺口 ---------------------------- */

function detectAttributionGap(gap: number, unresolvedOrders: number): Leak | null {
  if (gap <= 0.01 || unresolvedOrders === 0) return null;
  return {
    kind: "attribution-gap",
    title: `${unresolvedOrders} 笔订单未取到详情，¥${gap.toFixed(2)} 无法归因`,
    amount: null,
    amountEstimated: false,
    evidence: [
      "这些订单没有拿到 query-order 详情（接口失败或被限流），无法取得平台记录的优惠金额",
      "相关金额已计入实付总额，但未参与「省了多少」的计算",
    ],
    action: "重跑一次通常即可补齐——订单详情会永久缓存，第二次运行几乎不再消耗调用次数",
  };
}

/* -------------------------------- 工具函数 -------------------------------- */

function inCouponWindow(c: Coupon, at: Date, now: Date): boolean {
  if (c.validFrom) {
    const from = new Date(c.validFrom.replace("T", " ")).getTime();
    if (Number.isFinite(from) && at.getTime() < from) return false;
  }
  if (c.validTo) {
    const to = new Date(c.validTo.replace("T", " ")).getTime();
    if (Number.isFinite(to) && at.getTime() > to) return false;
  }
  if (c.weekdays.length > 0 && !c.weekdays.includes(at.getDay())) return false;

  if (c.startTime && c.endTime) {
    const minutes = at.getHours() * 60 + at.getMinutes();
    const start = toMinutes(c.startTime);
    const end = toMinutes(c.endTime);
    if (start !== null && end !== null && (minutes < start || minutes > end)) return false;
  }

  // 只回看 90 天，超过这个窗口的"错过"已经没有行动价值
  return now.getTime() - at.getTime() <= 90 * 86_400_000;
}

/** 估算一张券"最多能省多少"：券名里的用券价 vs 菜单里同名商品的现价 */
export function estimateCouponSaving(
  coupon: Coupon,
  menu: Record<string, MenuItem>,
): number | null {
  const { price, product } = parseCouponTitle(coupon.name);
  const couponPrice = coupon.price ?? price;
  if (couponPrice === null) return null;

  const candidates = Object.values(menu).filter(
    (m) => m.currentPrice !== null && m.currentPrice > couponPrice && looseMatch(product, m.name),
  );
  if (candidates.length === 0) return null;

  // 取最接近券价的同款商品，避免"组合装"把差额放大
  candidates.sort((a, b) => (a.currentPrice ?? 0) - (b.currentPrice ?? 0));
  const ref = candidates[0];
  if (!ref || ref.currentPrice === null) return null;
  const save = money(ref.currentPrice - couponPrice);
  return save > 0 ? save : null;
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
