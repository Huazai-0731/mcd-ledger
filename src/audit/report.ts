/**
 * 报告组装：把采集、定价、归因、检测、窗口五步的结果收敛成一份可渲染的 AuditReport。
 * 这里只做聚合，不做任何 IO —— 保证纯函数可测。
 */
import { money } from "../runtime/contract.ts";
import type {
  AuditReport,
  Campaign,
  Coupon,
  Degradation,
  Leak,
  MenuItem,
  Order,
  PointsAccount,
  PricedOrder,
  Profile,
} from "../model/types.ts";
import type { AttributionSummary } from "./attribution.ts";
import { totalSaved } from "./attribution.ts";
import { buildWindows } from "./windows.ts";

export interface ReportInput {
  orders: Order[];
  priced: PricedOrder[];
  attribution: AttributionSummary;
  leaks: Leak[];
  points: PointsAccount | null;
  coupons: Coupon[];
  campaigns: Campaign[];
  menu: Record<string, MenuItem>;
  degradations: Degradation[];
  now: Date;
  trace: { traceId: string; toolCalls: number; durationMs: number };
  pointsPerYuan: number;
  demo?: boolean;
}

export function buildReport(input: ReportInput): AuditReport {
  const completed = input.orders.filter((o) => o.status === "completed");
  const cancelled = input.orders.filter((o) => o.status === "cancelled");
  const saved = totalSaved(input.attribution);

  const times = completed.map((o) => o.createdAtMs);
  const from = times.length > 0 ? new Date(Math.min(...times)) : null;
  const to = times.length > 0 ? new Date(Math.max(...times)) : null;
  const days =
    from && to ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1) : 0;

  const totalItems = completed.reduce(
    (acc, o) => acc + o.lines.reduce((a, l) => a + l.quantity, 0),
    0,
  );

  const leakTotal = money(
    input.leaks.reduce((acc, l) => acc + (l.amount ?? 0), 0),
  );

  const report: AuditReport = {
    generatedAt: input.now.toISOString(),
    period: {
      from: from ? toDateKey(from) : null,
      to: to ? toDateKey(to) : null,
      days,
      orders: completed.length,
    },
    totals: {
      paid: money(completed.reduce((a, o) => a + o.paid, 0)),
      list: input.attribution.list,
      alaCarte: input.attribution.alaCarte,
      saved,
      savedRate:
        saved !== null && input.attribution.paid > 0
          ? saved / (input.attribution.paid + saved)
          : null,
      completedOrders: completed.length,
      cancelledOrders: cancelled.length,
      totalItems,
      calories: null,
    },
    attribution: {
      coupon: input.attribution.coupon,
      activity: input.attribution.activity,
      combo: input.attribution.combo,
      deliveryFee: input.attribution.deliveryFee,
      coverage: input.attribution.coverage,
      lowerBound: input.attribution.comboMissing > 0,
      reasons: input.attribution.reasons,
    },
    leaks: input.leaks,
    leakTotal,
    windows: buildWindows(input.coupons, input.campaigns, input.menu, input.now),
    profile: buildProfile(completed, input.attribution),
    points: input.points,
    coupons: input.coupons,
    quality: {
      coverage: input.attribution.coverage,
      resolvedOrders: input.priced.filter((p) => p.coverage === 1).length,
      unresolvedOrders: input.priced.filter((p) => p.coverage < 1).length,
      degradations: input.degradations,
      traceId: input.trace.traceId,
      toolCalls: input.trace.toolCalls,
      durationMs: input.trace.durationMs,
      demo: input.demo ?? false,
    },
    sources: [
      "麦当劳 MCP Server · order-list（历史订单）",
      "麦当劳 MCP Server · query-meals（门店菜单与划线价）",
      "麦当劳 MCP Server · query-my-coupons（卡包券）",
      "麦当劳 MCP Server · query-my-account（积分账户）",
      "麦当劳 MCP Server · campaign-calendar（活动日历）",
      "麦当劳 MCP Server · now-time-info（基准时间）",
    ],
  };

  return report;
}

export function buildProfile(completed: Order[], attribution: AttributionSummary): Profile {
  const mealPeriods: Record<string, number> = {};
  const channels: Record<string, number> = {};
  const storeMap = new Map<string, { orders: number; paid: number }>();
  const itemMap = new Map<string, number>();
  const weekdayHeatmap = new Array<number>(7).fill(0);
  const hourHeatmap = new Array<number>(24).fill(0);

  for (const o of completed) {
    const d = new Date(o.createdAtMs);
    const period = mealPeriod(d);
    mealPeriods[period] = (mealPeriods[period] ?? 0) + 1;
    channels[o.channel] = (channels[o.channel] ?? 0) + 1;
    weekdayHeatmap[d.getDay()] = (weekdayHeatmap[d.getDay()] ?? 0) + 1;
    hourHeatmap[d.getHours()] = (hourHeatmap[d.getHours()] ?? 0) + 1;

    const store = storeMap.get(o.storeName) ?? { orders: 0, paid: 0 };
    store.orders += 1;
    store.paid = money(store.paid + o.paid);
    storeMap.set(o.storeName, store);

    for (const line of o.lines) {
      itemMap.set(line.productName, (itemMap.get(line.productName) ?? 0) + line.quantity);
    }
  }

  const stores = [...storeMap.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5);

  const topItems = [...itemMap.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  const maxOrder = completed.reduce<Order | null>(
    (best, o) => (best === null || o.paid > best.paid ? o : best),
    null,
  );

  return {
    mealPeriods,
    channels,
    stores,
    topItems,
    weekdayHeatmap,
    hourHeatmap,
    avgTicket:
      completed.length > 0
        ? money(completed.reduce((a, o) => a + o.paid, 0) / completed.length)
        : 0,
    maxTicket: maxOrder
      ? {
          orderId: maxOrder.orderId,
          paid: maxOrder.paid,
          date: toDateKey(new Date(maxOrder.createdAtMs)),
        }
      : null,
  };
}

/** 时段划分贴合麦当劳真实销售节奏：早餐券基本只到 10:29 */
export function mealPeriod(d: Date): string {
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < 10 * 60 + 30) return "早餐";
  if (minutes < 14 * 60) return "午餐";
  if (minutes < 17 * 60) return "下午茶";
  if (minutes < 21 * 60) return "晚餐";
  return "夜宵";
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type { AttributionSummary };
