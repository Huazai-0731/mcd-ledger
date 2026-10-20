/**
 * 归因汇总：把逐单归因收敛成三个互不重叠的分项 + 一个诚实的覆盖率。
 *
 *   coupon   券优惠（逐券金额，来自 couponList）
 *   activity 活动 / 卡权益优惠（总优惠 − 券优惠）
 *   combo    组合价值（单点合计 − 原价合计，需要菜单支持）
 *
 * 「省下来的钱」= 三项之和。组合价值可能因商品下架而缺失，
 * 此时省下的钱是一个**下限**——报告里必须写明这一点，而不是悄悄补零。
 */
import { money } from "../runtime/contract.ts";
import type { PricedOrder } from "../model/types.ts";

export interface AttributionSummary {
  paid: number;
  list: number | null;
  alaCarte: number | null;
  coupon: number;
  activity: number;
  combo: number | null;
  deliveryFee: number;
  /** 可精确归因的实付占比 0–1 */
  coverage: number;
  /** 无法归因的实付金额 */
  gap: number;
  /** 组合价值缺失的订单数（此时 totalSaved 为下限） */
  comboMissing: number;
  reasons: Array<{ reason: string; amount: number; orders: number }>;
}

export function summarizeAttribution(priced: PricedOrder[]): AttributionSummary {
  const paid = money(sum(priced.map((p) => p.paid)));
  const covered = priced.filter((p) => p.coverage === 1 && p.source === "detail");
  const attributablePaid = money(sum(covered.map((p) => p.paid)));

  const listValues = covered.map((p) => p.list).filter((v): v is number => v !== null);
  const list = listValues.length > 0 && listValues.length === covered.length ? money(sum(listValues)) : null;

  const alaValues = covered.map((p) => p.alaCarte).filter((v): v is number => v !== null);
  const alaCarte =
    alaValues.length > 0 && alaValues.length === covered.length ? money(sum(alaValues)) : null;

  const comboValues = covered.map((p) => p.combo);
  const comboKnown = comboValues.filter((v): v is number => v !== null);
  const comboMissing = covered.length - comboKnown.length;

  // 汇总口径优先用"总额相减"（单点合计 − 原价合计），保证页面上的三个数字自洽：
  // 读者可以直接用 单点合计 − 原价合计 复算出组合价值。
  // 逐单相加会因单笔负数被 clamp 而略高于该差值——那会让页面自己打自己的脸。
  const combo =
    alaCarte !== null && list !== null
      ? money(Math.max(0, alaCarte - list))
      : comboKnown.length > 0
        ? money(sum(comboKnown))
        : null;

  const reasonMap = new Map<string, { amount: number; orders: number }>();
  for (const p of covered) {
    for (const [reason, amount] of Object.entries(p.reasons)) {
      const cur = reasonMap.get(reason) ?? { amount: 0, orders: 0 };
      cur.amount = money(cur.amount + amount);
      cur.orders += 1;
      reasonMap.set(reason, cur);
    }
  }

  return {
    paid,
    list,
    alaCarte,
    coupon: money(sum(covered.map((p) => p.coupon))),
    activity: money(sum(covered.map((p) => p.activity))),
    combo,
    deliveryFee: money(sum(covered.map((p) => p.deliveryFee))),
    coverage: paid > 0 ? attributablePaid / paid : 0,
    gap: money(paid - attributablePaid),
    comboMissing,
    reasons: [...reasonMap.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** 总节省 = 券 + 活动 + 组合价值（组合缺失时为下限） */
export function totalSaved(a: AttributionSummary): number | null {
  if (a.coverage <= 0) return null;
  return money(a.coupon + a.activity + (a.combo ?? 0));
}

/** 是否为一个"下限值"（有订单的套餐价值还原不出来） */
export function savedIsLowerBound(a: AttributionSummary): boolean {
  return a.comboMissing > 0;
}

function sum(values: number[]): number {
  return values.reduce((x, y) => x + y, 0);
}
