/**
 * 领域模型：把 MCP 返回的"业务字段"收敛成审计需要的稳定结构。
 *
 * 设计原则：
 * 1. 所有金额用 number（元，两位小数），避免字符串比较。
 * 2. 无法确定的字段一律用 null，不用 0 —— 0 和"不知道"在审计里是两件事。
 * 3. 每个实体都带 source 标记，便于在报告里说明数据来源与覆盖率。
 */

/** 订单履约渠道，来自 order-list 的 beType */
export type Channel = "pickup" | "delivery" | "drivethru" | "group" | "unknown";

/** 订单状态。已取消订单不计入消费，但会计入"取消率" */
export type OrderStatus = "completed" | "cancelled" | "unknown";

/** 套餐拆分后的子项，来自 order-list 的 comboItemList */
export interface ComboItem {
  code: string;
  name: string;
  quantity: number;
}

/** 订单中的一个商品行 */
export interface OrderLine {
  productCode: string;
  productName: string;
  quantity: number;
  comboItems: ComboItem[];
}

/** 订单详情（来自 query-order），是归因的权威来源 */
export interface OrderDetail {
  orderId: string;
  /** 原价合计 */
  totalAmount: number | null;
  /** 实付 */
  paid: number | null;
  /** 平台记录的总优惠金额 */
  discount: number | null;
  /** 配送费 */
  deliveryFee: number | null;
  /** 商品总价 */
  productPrice: number | null;
  /** 逐券优惠明细 */
  coupons: Array<{ name: string; amount: number }>;
  /** 取餐码 */
  pickupCode: string | null;
}

/** 一笔历史订单 */
export interface Order {
  orderId: string;
  /** 原始下单时间字符串，如 "2026-09-16 07:17:19" */
  createdAt: string;
  /** 解析后的本地时间（毫秒） */
  createdAtMs: number;
  channel: Channel;
  storeCode: string;
  storeName: string;
  status: OrderStatus;
  lines: OrderLine[];
  /** 实付总额（元） */
  paid: number;
  /** 订单详情，null 表示未取到 */
  detail?: OrderDetail | null;
}

/** 门店菜单中的一个 SKU */
export interface MenuItem {
  code: string;
  name: string;
  /** 销售价（元），null 表示该 SKU 无报价 */
  currentPrice: number | null;
  /** 划线价（元），null 表示无划线价 */
  originalPrice: number | null;
  /** 优惠类型，如 "促销优惠" / "随单购早餐卡优惠"，null 表示无优惠 */
  discountType: string | null;
  tags: string[];
  category: string | null;
  /** 是否可随单购早餐卡/麦金卡 */
  canWithOrder: boolean;
}

/** 某门店的菜单快照 */
export interface MenuSnapshot {
  storeCode: string;
  capturedAt: string;
  items: Record<string, MenuItem>;
  /** 用户在该店的"常点"SKU */
  frequentCode: string | null;
}

/** 优惠券 */
export interface Coupon {
  id: string;
  name: string;
  /** 用券价（元） */
  price: number | null;
  /** 有效期起止，ISO 字符串；解析失败为 null */
  validFrom: string | null;
  validTo: string | null;
  /** 生效星期，0=周日 … 6=周六；空数组表示每天 */
  weekdays: number[];
  /** 每日生效时段，如 "05:00" */
  startTime: string | null;
  endTime: string | null;
  /** 适用渠道，如 ["到店专用"] */
  channels: string[];
  /** 展示标签，如 ["今日到期"] */
  tags: string[];
}

/** 积分账户 */
export interface PointsAccount {
  available: number;
  accumulative: number;
  used: number;
  /** 已过期积分（这是真实发生的损失） */
  expired: number;
  /** 本月将过期 */
  expiringThisMonth: number;
  /** 下月将过期 */
  expiringNextMonth: number;
  frozen: number;
  /** 每元折合积分数，用于把积分换算成钱；null 表示无法确定 */
  pointsPerYuan: number | null;
  /** pointsPerYuan 是否为估算值 */
  ratioEstimated: boolean;
}

/** 活动日历条目 */
export interface Campaign {
  title: string;
  /** yyyy-MM-dd */
  date: string;
  summary: string;
  kind: "past" | "today" | "upcoming";
}

/** 一次工具调用的轨迹 */
export interface TraceCall {
  id: number;
  tool: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  attempt: number;
  /** 返回体字节数，用于识别异常小/大的响应 */
  bytes: number;
  error?: string;
}

/** 采集阶段的数据质量记录 */
export interface Degradation {
  module: string;
  reason: string;
  /** 该模块不可用时，报告里会显示"数据不足"而不是 0 */
  impact: string;
}

/** 三层价格模型中的一层 */
export type PriceResolution = "exact" | "combo-partial" | "missing";

/** 单个订单行的定价结果 */
export interface PricedLine {
  line: OrderLine;
  /** 价格来源：exact=菜单精确命中；missing=菜单已下架或换季 */
  resolution: PriceResolution;
  /** 优惠类型（来自菜单 discountType），用于归因分项 */
  reason: string | null;
  /** 单点合计：套餐子项按单品现价相加 */
  alaCarte: number | null;
  /** 划线价合计 */
  list: number | null;
  /** 销售价合计 */
  sale: number | null;
}

/** 一笔订单的定价与归因结果 */
export interface PricedOrder {
  order: Order;
  lines: PricedLine[];
  paid: number;
  /** 原价合计（订单详情 totalAmount） */
  list: number | null;
  /** 单点合计：把每个商品拆成单品按现价相加 */
  alaCarte: number | null;
  /** 券优惠合计 */
  coupon: number;
  /** 活动 / 卡权益优惠 */
  activity: number;
  /** 组合价值 = 单点合计 − 原价合计（需要菜单才能还原） */
  combo: number | null;
  /** 配送费 */
  deliveryFee: number;
  /** 0 或 1：是否拿到订单详情（拿到才算可精确归因） */
  coverage: number;
  /** 归因来源 */
  source: "detail" | "menu" | "none";
  /** 无法归因的实付金额 */
  gap: number;
  reasons: Record<string, number>;
}

/** 漏损类型 */
export type LeakKind =
  | "expired-points"
  | "expiring-coupon"
  | "window-mismatch"
  | "cancelled-order"
  | "attribution-gap";

export interface Leak {
  kind: LeakKind;
  /** 一句话结论，直接进报告 */
  title: string;
  /** 折算的金额损失（元）；为 null 表示无法折算 */
  amount: number | null;
  amountEstimated: boolean;
  /** 证据：具体到券名/订单号/积分数 */
  evidence: string[];
  /** 可执行建议 */
  action: string;
}

/** 最佳购买窗口 */
export interface PurchaseWindow {
  /** yyyy-MM-dd */
  date: string;
  weekday: string;
  startTime: string | null;
  endTime: string | null;
  label: string;
  /** 该窗口可用的券/活动 */
  offers: string[];
  /** 预估可省（元），null 表示未知 */
  saving: number | null;
}

/** 消费画像 */
export interface Profile {
  mealPeriods: Record<string, number>;
  channels: Record<string, number>;
  stores: Array<{ name: string; orders: number; paid: number }>;
  topItems: Array<{ name: string; quantity: number }>;
  /** 0=周日 … 6=周六 的订单数 */
  weekdayHeatmap: number[];
  /** 0–23 时的订单数 */
  hourHeatmap: number[];
  /** 平均单笔 */
  avgTicket: number;
  /** 最贵的一单 */
  maxTicket: { orderId: string; paid: number; date: string } | null;
}

/** 完整审计报告 */
export interface AuditReport {
  generatedAt: string;
  period: { from: string | null; to: string | null; days: number; orders: number };
  totals: {
    paid: number;
    list: number | null;
    alaCarte: number | null;
    saved: number | null;
    savedRate: number | null;
    completedOrders: number;
    cancelledOrders: number;
    totalItems: number;
    calories: number | null;
  };
  attribution: {
    /** 券优惠 */
    coupon: number;
    /** 活动 / 卡权益优惠 */
    activity: number;
    /** 组合价值，null 表示无法还原 */
    combo: number | null;
    deliveryFee: number;
    coverage: number;
    /** 省下的钱是否为下限（部分套餐价值无法还原） */
    lowerBound: boolean;
    reasons: Array<{ reason: string; amount: number; orders: number }>;
  };
  leaks: Leak[];
  /** 所有漏损折算总和（仅含可折算项） */
  leakTotal: number;
  windows: PurchaseWindow[];
  profile: Profile;
  points: PointsAccount | null;
  coupons: Coupon[];
  quality: {
    coverage: number;
    resolvedOrders: number;
    unresolvedOrders: number;
    degradations: Degradation[];
    traceId: string;
    toolCalls: number;
    durationMs: number;
    /** true 表示本次为合成数据演示，未调用 MCP */
    demo: boolean;
  };
  /** 数据来源声明，进报告页脚 */
  sources: string[];
}
