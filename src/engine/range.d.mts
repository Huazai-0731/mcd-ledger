/**
 * range.mjs 的类型契约。
 *
 * 引擎本身是 .mjs —— 因为它要同时跑在 Node 和浏览器里。
 * 这里用一份 d.mts 把它的边界钉住：TS 侧拿到的都是强类型，
 * 而 JS 侧不需要任何构建就能直接执行。
 *
 * 改动 range.mjs 的导出签名时，必须同步改这里。
 */

export interface LedgerRow {
  /** 下单时间（毫秒） */
  ms: number;
  /** 当天的分钟数，避免每次重算都 new Date */
  m: number;
  /** 订单号，只在站内用于定位，不上分享卡 */
  id: string;
  ch: string;
  st: string;
  paid: number;
  list: number | null;
  ala: number | null;
  /** 券优惠 */
  cpn: number;
  /** 活动 / 卡权益优惠 */
  act: number;
  /** 组合价值，null = 无法还原 */
  cmb: number | null;
  del: number;
  /** 1 = 拿到订单详情，可精确归因 */
  cov: 0 | 1;
  status: "completed" | "cancelled";
  /** [SKU 编码, 商品名, 数量, 菜单单价] —— 单价用于把订单实付拆到行 */
  items: Array<[string, string, number, number | null]>;
  /** 该单实际用掉的券名 */
  coupons: string[];
}

export interface LedgerCoupon {
  id: string;
  name: string;
  price: number | null;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  channels: string[];
  tags: string[];
  /** 审计层算好的"单张最多省多少"，null = 算不出。引擎不重复做名称匹配 */
  worth: number | null;
}

export interface LedgerCampaign {
  title: string;
  date: string;
  summary: string;
  kind: string;
}

export interface LedgerMenuItem {
  p: number | null;
  o: number | null;
  d: string | null;
}

export interface LedgerData {
  v: number;
  now: number;
  nowIso: string;
  defaultRange: string;
  rows: LedgerRow[];
  coupons: LedgerCoupon[];
  campaigns: LedgerCampaign[];
  menu: Record<string, LedgerMenuItem>;
  meta: {
    demo: boolean;
    traceId: string;
    dataFrom: string;
    dataTo: string;
  };
}

export interface RangeInfo {
  key: string;
  label: string;
  fromMs: number;
  toMs: number;
  from: string;
  to: string;
  days: number;
  custom: boolean;
}

export interface RangeSummary {
  range: RangeInfo;
  orders: number;
  cancelled: number;
  paid: number;
  list: number | null;
  alaCarte: number | null;
  coupon: number;
  activity: number;
  combo: number | null;
  saved: number | null;
  savedRate: number | null;
  lowerBound: boolean;
  delivery: number;
  coverage: number;
  gap: number;
  resolved: number;
  unresolved: number;
  items: number;
  mealPeriods: Record<string, number>;
  channels: Record<string, number>;
  stores: Array<{ name: string; orders: number; paid: number }>;
  topItems: Array<{ name: string; quantity: number }>;
  weekday: number[];
  hour: number[];
  avgTicket: number;
  maxTicket: { orderId: string; paid: number; date: string } | null;
}

export interface Strategy {
  id: string;
  kind: "window" | "price" | "delivery" | "expiry" | "timing";
  kindLabel: string;
  title: string;
  basis: string[];
  action: string;
  /** 该区间内已发生的可优化金额 */
  inRange: number | null;
  /** 月化估算；null 表示这是一次性机会（券类） */
  perMonth: number | null;
  estimated: boolean;
  confidence: "high" | "medium" | "low";
  confidenceLabel: string;
  score: number;
}

export interface StrategyTotals {
  perMonth: number;
  oneOff: number;
  inRangeAll: number;
  count: number;
  withAmount: number;
}

export interface View {
  spec: string;
  range: RangeInfo;
  summary: RangeSummary;
  strats: Strategy[];
  totals: StrategyTotals;
  html: {
    cover: string;
    flow: string;
    attr: string;
    strategy: string;
    profile: string;
    share: string;
  };
}

export declare const ENGINE_VERSION: number;
export declare const DEFAULT_RANGE: string;
export declare const PRESETS: ReadonlyArray<{ key: string; label: string; days: number | null }>;

export declare function money(n: number): number;
export declare function yuan(n: number): string;
export declare function esc(s: string): string;
export declare function parseLocal(s: string | null): number | null;
export declare function dateKey(ms: number): string;
export declare function mealPeriod(minutes: number): string;

export declare function parseRangeSpec(spec: string): { key: string; from?: string; to?: string };
export declare function resolveRange(spec: string, nowMs: number, rows: LedgerRow[]): RangeInfo;
export declare function filterRows(rows: LedgerRow[], range: RangeInfo): LedgerRow[];
export declare function summarize(rows: LedgerRow[], range: RangeInfo): RangeSummary;
export declare function buildStrategies(
  summary: RangeSummary,
  rows: LedgerRow[],
  data: LedgerData,
): Strategy[];
export declare function strategyTotals(strats: Strategy[]): StrategyTotals;
export declare function strategyCaption(totals: StrategyTotals): string;

export declare function renderOverview(s: RangeSummary, strats: Strategy[], range: RangeInfo): string;
export declare function renderFlow(s: RangeSummary, range: RangeInfo): string;
export declare function renderAttr(s: RangeSummary, range: RangeInfo): string;
export declare function renderStrategy(strats: Strategy[], s: RangeSummary, range: RangeInfo): string;
export declare function renderProfile(s: RangeSummary, range: RangeInfo): string;
export declare function renderShare(s: RangeSummary, strats: Strategy[], range: RangeInfo): string;
export declare function shareText(s: RangeSummary, range: RangeInfo): string;

export declare function buildView(data: LedgerData, spec: string): View;
