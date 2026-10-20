/**
 * 采集层：历史订单。
 * 字段契约来自官方 order-list 返回结构，是所有下游计算的地基。
 */
import { arr, obj, optStr, toNum, unwrapBusiness } from "../runtime/contract.ts";
import type { Channel, ComboItem, Degradation, Order, OrderLine, OrderStatus } from "../model/types.ts";

export interface OrdersResult {
  orders: Order[];
  degradation: Degradation | null;
}

const CHANNEL_MAP: Record<string, Channel> = {
  "1": "pickup",
  "2": "delivery",
  "5": "drivethru",
  "6": "group",
};

export function parseOrders(payload: unknown): OrdersResult {
  const orders: Order[] = [];
  let root: unknown;
  try {
    root = unwrapBusiness(payload);
  } catch (err) {
    return {
      orders,
      degradation: {
        module: "历史订单",
        reason: err instanceof Error ? err.message : String(err),
        impact: "整份报告无法生成",
      },
    };
  }

  const record = obj(root, "$.data");
  const list = arr(record.list, "$.data.list");

  for (let i = 0; i < list.length; i += 1) {
    const raw = obj(list[i], `$.data.list[${i}]`);
    const orderId = optStr(raw.orderId);
    const createTime = optStr(raw.createTime);
    if (!orderId || !createTime) continue;

    const createdAtMs = parseLocalTime(createTime);
    if (createdAtMs === null) continue;

    const lines: OrderLine[] = [];
    const rawLines = Array.isArray(raw.orderProductList) ? raw.orderProductList : [];
    for (const rl of rawLines) {
      if (!rl || typeof rl !== "object") continue;
      const l = rl as Record<string, unknown>;
      const code = optStr(l.productCode);
      const name = optStr(l.productName);
      if (!code || !name) continue;

      const comboItems: ComboItem[] = [];
      if (Array.isArray(l.comboItemList)) {
        for (const ci of l.comboItemList) {
          if (!ci || typeof ci !== "object") continue;
          const c = ci as Record<string, unknown>;
          const cCode = optStr(c.productCode);
          const cName = optStr(c.name) ?? optStr(c.productName);
          if (!cCode || !cName) continue;
          comboItems.push({
            code: cCode,
            name: cName,
            quantity: toNum(c.quantity) ?? 1,
          });
        }
      }

      lines.push({
        productCode: code,
        productName: name,
        quantity: Math.max(1, Math.round(toNum(l.quantity) ?? 1)),
        comboItems,
      });
    }

    orders.push({
      orderId,
      createdAt: createTime,
      createdAtMs,
      channel: CHANNEL_MAP[optStr(raw.beType) ?? ""] ?? "unknown",
      storeCode: optStr(raw.storeCode) ?? "",
      storeName: optStr(raw.storeName) ?? "未知门店",
      status: mapStatus(optStr(raw.orderStatus)),
      lines,
      paid: Math.max(0, toNum(raw.realTotalAmount) ?? 0),
    });
  }

  // 官方按时间倒序返回，这里再排一次保证稳定
  orders.sort((a, b) => b.createdAtMs - a.createdAtMs);

  return {
    orders,
    degradation:
      orders.length === 0
        ? {
            module: "历史订单",
            reason: "接口返回 0 条订单",
            impact: "报告将为空，建议先用真实账号产生 1 笔订单",
          }
        : null,
  };
}

function mapStatus(s: string | null): OrderStatus {
  if (!s) return "unknown";
  if (s.includes("取消")) return "cancelled";
  if (s.includes("完成")) return "completed";
  return "unknown";
}

/** "2026-09-16 07:17:19" → 本地时间戳。手动解析以避免时区把日期推到前一天 */
export function parseLocalTime(text: string): number | null {
  const m = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const ms = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh ?? 0),
    Number(mm ?? 0),
    Number(ss ?? 0),
  ).getTime();
  return Number.isFinite(ms) ? ms : null;
}
