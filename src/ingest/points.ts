/**
 * 采集层：积分账户与积分商城。
 *
 * query-my-account 的字段是清晰且稳定的（camelCase），
 * 其中 expiredPoint 是"已经发生、无法挽回"的损失——这是报告里最有说服力的数字之一。
 */
import { obj, optNum, unwrapBusiness } from "../runtime/contract.ts";
import type { Degradation, PointsAccount } from "../model/types.ts";

export interface PointsResult {
  account: PointsAccount | null;
  degradation: Degradation | null;
}

/** 无法从商城换算时的兜底比值：麦当劳中国常见口径约 100 积分 ≈ 1 元 */
export const DEFAULT_POINTS_PER_YUAN = 100;

export function parsePoints(payload: unknown): PointsResult {
  let data: Record<string, unknown>;
  try {
    data = obj(unwrapBusiness(payload), "$.data");
  } catch (err) {
    return {
      account: null,
      degradation: {
        module: "积分账户",
        reason: err instanceof Error ? err.message : String(err),
        impact: "「过期积分」漏损不计入，积分资产模块显示数据不足",
      },
    };
  }

  const available = optNum(data.availablePoint);
  if (available === null) {
    return {
      account: null,
      degradation: {
        module: "积分账户",
        reason: "响应缺少 availablePoint",
        impact: "积分资产模块不可用",
      },
    };
  }

  return {
    account: {
      available,
      accumulative: optNum(data.accumulativePoint) ?? 0,
      used: optNum(data.usedPoint) ?? 0,
      expired: optNum(data.expiredPoint) ?? 0,
      expiringThisMonth: optNum(data.currentMouthExpirePoint) ?? optNum(data.currentMonthExpirePoint) ?? 0,
      expiringNextMonth: optNum(data.nextMouthExpirePoint) ?? optNum(data.nextMonthExpirePoint) ?? 0,
      frozen: optNum(data.frozenPoint) ?? 0,
      pointsPerYuan: DEFAULT_POINTS_PER_YUAN,
      ratioEstimated: true,
    },
    degradation: null,
  };
}

/**
 * 从积分商城商品里推导"积分 → 元"的兑换比。
 *
 * 商城商品的定价形态不统一（有的只给积分、有的同时给现金价），
 * 所以取所有"同时具备积分与现金"的样本的中位数；样本不足则保留默认值并标记为估算。
 */
export function derivePointsRatio(
  payload: unknown,
): { pointsPerYuan: number; estimated: boolean; samples: number } {
  const samples: number[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    const rec = v as Record<string, unknown>;
    const points = pickNumeric(rec, /(point|points|integral|score)/i);
    const cash = pickNumeric(rec, /(price|amount|cash|money)/i);
    if (points !== null && cash !== null && points > 0 && cash > 0) {
      const ratio = points / cash;
      if (ratio > 1 && ratio < 100_000) samples.push(ratio);
    }
    for (const value of Object.values(rec)) visit(value, depth + 1);
  };
  visit(payload, 0);

  if (samples.length < 3) {
    return { pointsPerYuan: DEFAULT_POINTS_PER_YUAN, estimated: true, samples: samples.length };
  }
  samples.sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median =
    samples.length % 2 === 0
      ? ((samples[mid - 1] ?? 0) + (samples[mid] ?? 0)) / 2
      : (samples[mid] ?? DEFAULT_POINTS_PER_YUAN);
  return { pointsPerYuan: Math.round(median), estimated: false, samples: samples.length };
}

function pickNumeric(rec: Record<string, unknown>, pattern: RegExp): number | null {
  for (const [key, value] of Object.entries(rec)) {
    if (!pattern.test(key)) continue;
    const n = optNum(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}
