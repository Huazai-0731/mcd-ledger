/**
 * 采集层：订单详情。
 *
 * 这是整个项目的"证据链"：totalAmount / realTotalAmount / totalDiscountAmount / couponList
 * 全部来自平台自己的订单记录，因此账本里的每个数字都能被用户点开订单对得上。
 *
 * 详情一旦生成就不会变，所以按 orderId 永久缓存——第二次运行几乎零调用。
 */
import { obj, optNum, optStr, unwrapBusiness } from "../runtime/contract.ts";
import type { Degradation, OrderDetail } from "../model/types.ts";

export function parseOrderDetail(payload: unknown, orderId: string): OrderDetail | null {
  let data: Record<string, unknown>;
  try {
    data = obj(unwrapBusiness(payload), "$.data");
  } catch {
    return null;
  }

  const totalAmount = optNum(data.totalAmount);
  const paid = optNum(data.realTotalAmount);
  if (totalAmount === null && paid === null) return null;

  const coupons: Array<{ name: string; amount: number }> = [];
  if (Array.isArray(data.couponList)) {
    for (const raw of data.couponList) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      const amount = optNum(c.discountAmount) ?? 0;
      coupons.push({ name: optStr(c.couponName) ?? "优惠券", amount });
    }
  }

  return {
    orderId,
    totalAmount,
    paid,
    discount: optNum(data.totalDiscountAmount),
    deliveryFee: optNum(data.realDeliveryPrice) ?? optNum(data.deliveryPrice) ?? 0,
    productPrice: optNum(data.productPrice),
    coupons,
    pickupCode: optStr(data.pickupCode),
  };
}

export function detailDegradation(orderId: string, reason: string): Degradation {
  return {
    module: `订单详情 ${orderId.slice(-6)}`,
    reason: reason.slice(0, 160),
    impact: "该笔订单不计入节省统计，仅计入实付总额",
  };
}
