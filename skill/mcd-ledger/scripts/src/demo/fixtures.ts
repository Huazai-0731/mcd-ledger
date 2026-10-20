/**
 * 演示数据（--demo）。
 *
 * 存在的理由：任何人 clone 下来都能立刻看到成品，而不需要先拥有一个吃了半年的账号。
 * 数据是**合成**的（SKU 编码与价格取自真实菜单，订单序列由固定种子生成），
 * 因此可与真实运行结果对比，但不含任何真实用户的订单或账户信息。
 */
import type { Campaign, Coupon, MenuItem, Order, PointsAccount } from "../model/types.ts";
import { toDateKey } from "../audit/windows.ts";

function m(
  code: string,
  name: string,
  currentPrice: number | null,
  originalPrice: number | null = null,
  discountType: string | null = null,
  category = "早餐",
): MenuItem {
  return {
    code,
    name,
    currentPrice,
    originalPrice: originalPrice ?? currentPrice,
    discountType,
    tags: [],
    category,
    canWithOrder: discountType === "随单购早餐卡优惠",
  };
}

/** 取自真实菜单的 SKU 与价格（2026-10 快照） */
export const DEMO_MENU: Record<string, MenuItem> = Object.fromEntries(
  [
    // 套餐 / 组合
    m("9900011872", "芝芝火腿扒堡组合", 9.9, 9.9, null, "超值早餐"),
    m("9900003458", "猪柳蛋麦满分套餐", 15.9, 26.5, "随单购早餐卡优惠"),
    m("9900003493", "原味板烧鸡腿麦满分组合", 10.8, 18, "随单购早餐卡优惠"),
    m("9900003449", "火腿扒麦满分套餐", 11.1, 18.5, "随单购早餐卡优惠"),
    m("9900003453", "吉士蛋麦满分套餐", 10.5, 17.5, "随单购早餐卡优惠"),
    m("9900003465", "猪柳炒双蛋堡套餐", 15.9, 26.5, "随单购早餐卡优惠"),
    m("9900013221", "一早现磨 超值二件套", 14.9, 29, null, "一早现磨"),
    m("9900003423", "猪柳麦满分组合", 10.5, 17.5, "随单购早餐卡优惠"),
    m("9900011709", "火腿扒麦满分组合", 7.8, 13, "随单购早餐卡优惠"),
    m("9900012729", "脆香油条组合", 6.6, 11, "随单购早餐卡优惠"),
    m("9900003431", "大脆鸡扒麦满分组合", 8.1, 13.5, "随单购早餐卡优惠"),
    m("9900008094", "吉士蛋麦满分组合", 7.2, 12, "随单购早餐卡优惠"),
    m("9900016524", "厚松饼猪柳蛋堡三件套", 17.94, 29.9, "随单购早餐卡优惠", "厚松饼堡系列"),
    // 单品
    m("5022", "猪柳蛋麦满分", 18, 18, null, "麦满分系列"),
    m("5024", "猪柳麦满分", 14.5, 14.5, null, "麦满分系列"),
    m("5888", "吉士蛋麦满分", 10, 10, null, "麦满分系列"),
    m("5889", "大脆鸡扒麦满分", 11.5, 11.5, null, "麦满分系列"),
    m("6800", "原味板烧鸡腿麦满分", 15, 15, null, "麦满分系列"),
    m("1254", "火腿扒麦满分", 11, 11, null, "麦满分系列"),
    m("502773", "猪柳炒双蛋堡", 18, 18, null, "炒双蛋堡系列"),
    m("521989", "枫糖风味厚松饼猪柳蛋堡", 22, 22, null, "厚松饼堡系列"),
    m("521315", "芝芝火腿扒堡", 13.5, 13.5, null, "超值早餐"),
    m("521316", "芝香脆鸡扒堡", 16.5, 16.5, null, "超值早餐"),
    m("521317", "高达芝士蛋堡", 15, 15, null, "超值早餐"),
    m("521884", "麦辣鸡腿汉堡", 24.5, 24.5, null, "人气热卖"),
    m("4825", "脆薯饼", 8, 8, null, "小食"),
    m("2631", "脆香油条", 8, 8, null, "小食"),
    m("4437", "玉米杯", 13, 13, null, "小食"),
    m("9900008752", "派", 8.5, 8.5, null, "小食"),
    m("1088", "优品豆浆", 10, 10, null, "饮品"),
    m("520689", "鲜萃咖啡", 10, 10, null, "麦咖啡™"),
    m("507368", "麦咖啡™热美式中杯", 11.9, 19, "促销优惠", "麦咖啡™"),
    m("507328", "麦咖啡™热奶铁中杯", 13.9, 21, "促销优惠", "麦咖啡™"),
    m("515946", "浓浓黑巧（冰/热）", 13.9, 21, "促销优惠", "麦咖啡™"),
    m("9900008754", "经典麦旋风", 15, 15, null, "小食甜品"),
    m("515837", "圆筒冰淇淋", 5, 5, null, "小食甜品"),
    m("3010", "雪碧", 9.5, 9.5, null, "饮品"),
    m("9900008751", "可乐", 9.5, 9.5, null, "饮品"),
  ].map((item) => [item.code, item]),
);

/** 套餐 → 子项，用于计算"单点合计" */
const COMBO_PARTS: Record<string, Array<[string, number]>> = {
  "9900011872": [["521315", 1], ["1088", 1]],
  "9900003458": [["5022", 1], ["520689", 1]],
  "9900003493": [["6800", 1], ["1088", 1]],
  "9900003449": [["1254", 1], ["1088", 1]],
  "9900003453": [["5888", 1], ["1088", 1]],
  "9900003465": [["502773", 1], ["520689", 1]],
  "9900013221": [["5022", 1], ["520689", 1]],
  "9900003423": [["5024", 1], ["1088", 1]],
  "9900011709": [["1254", 1], ["1088", 1]],
  "9900012729": [["2631", 1], ["1088", 1]],
  "9900003431": [["5889", 1], ["1088", 1]],
  "9900008094": [["5888", 1], ["1088", 1]],
  "9900016524": [["521989", 1], ["4825", 1], ["1088", 1]],
};

const BREAKFAST_POOL = [
  "9900011872",
  "9900003458",
  "9900003493",
  "9900003449",
  "9900003453",
  "9900003423",
  "9900011709",
  "9900012729",
  "9900003431",
  "9900008094",
  "9900013221",
];
const LUNCH_POOL = ["521884", "9900008754", "4437", "3010"];
const COFFEE_POOL = ["507368", "507328", "515946", "520689"];

const STORES = [
  { code: "1420955", name: "麦当劳东莞茶山万润得来速餐厅" },
  { code: "1420670", name: "麦当劳东莞松山湖总部二路餐厅" },
];

/** 固定种子 LCG，保证每次 demo 输出完全一致（便于截图与回归测试） */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

export function generateDemoOrders(now: Date, days = 96): Order[] {
  const rnd = lcg(20261024);
  const orders: Order[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  /*
   * 按"每天独立掷骰子"生成，而不是把 N 笔均匀撒在 N 天里。
   * 这样任何区间（7 天 / 30 天）都有足够的样本，且频次本身是真实信号——
   * 「早餐 4 次/周」这件事，正是策略层判断"券够不够用"的依据。
   */
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today - offset * 86_400_000);
    const weekday = day.getDay();
    const isWeekend = weekday === 0 || weekday === 6;

    const roll = rnd();
    const slots: Array<"breakfast" | "lunch" | "coffee"> = [];
    if (roll < (isWeekend ? 0.3 : 0.62)) slots.push("breakfast");
    if (rnd() < (isWeekend ? 0.46 : 0.22)) slots.push("lunch");
    if (rnd() < (isWeekend ? 0.16 : 0.12)) slots.push("coffee");

    for (const slot of slots) {
      const order = buildOrder(day, slot, rnd);
      if (order) orders.push(order);
    }
  }

  // 一笔取消订单（用于"取消率"检测）
  const cancelledDay = new Date(today - 12 * 86_400_000);
  orders.push({
    orderId: "1030246380000765751204635280",
    createdAt: `${toDateKey(cancelledDay)} 07:32:04`,
    createdAtMs: cancelledDay.getTime() + 7.5 * 3_600_000,
    channel: "drivethru",
    storeCode: STORES[0]!.code,
    storeName: STORES[0]!.name,
    status: "cancelled",
    lines: [
      {
        productCode: "9900011872",
        productName: "芝芝火腿扒堡组合",
        quantity: 1,
        comboItems: [
          { code: "521315", name: "芝芝火腿扒堡", quantity: 1 },
          { code: "1088", name: "优品豆浆", quantity: 1 },
        ],
      },
    ],
    paid: 9.9,
  });

  return orders.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function buildOrder(
  day: Date,
  slot: "breakfast" | "lunch" | "coffee",
  rnd: () => number,
): Order | null {
  const pool =
    slot === "breakfast" ? BREAKFAST_POOL : slot === "lunch" ? LUNCH_POOL : COFFEE_POOL;
  const productCode = pool[Math.floor(rnd() * pool.length)] ?? pool[0]!;
  const item = DEMO_MENU[productCode];
  if (!item || item.currentPrice === null) return null;

  const hour = slot === "breakfast" ? 7 : slot === "lunch" ? 12 : 15;
  const minute = Math.floor(rnd() * 50);
  const quantity = rnd() < 0.12 ? 2 : 1;

  const parts = COMBO_PARTS[productCode] ?? [];
  const comboItems = parts
    .map(([code, q]) => {
      const sub = DEMO_MENU[code];
      return sub ? { code, name: sub.name, quantity: q } : null;
    })
    .filter((x): x is { code: string; name: string; quantity: number } => x !== null);

  // 18% 用券，另有 30% 按原价买——真实的账本里这两种"可以更省"的情况都很常见，
  // 演示数据必须把它们造出来，否则策略层永远是空的。
  const useCoupon = rnd() < 0.18;
  const fullPrice = !useCoupon && rnd() < 0.3;
  const unit = fullPrice ? (item.originalPrice ?? item.currentPrice) : item.currentPrice;
  const couponCut = useCoupon ? Math.round(unit * 0.25 * 100) / 100 : 0;

  const isDelivery = slot !== "breakfast" && rnd() < 0.15;
  const deliveryFee = isDelivery ? 9 : 0;

  const createdAt = `${toDateKey(day)} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}`;
  const paid = Math.round((unit * quantity - couponCut + deliveryFee) * 100) / 100;
  const totalAmount = Math.round((item.originalPrice ?? item.currentPrice) * quantity * 100) / 100;

  return {
    orderId: `1030${String(20261000 + Math.floor(rnd() * 9_000_000)).slice(-8)}${String(Math.floor(rnd() * 1e8)).padStart(8, "0")}`,
    createdAt,
    createdAtMs: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime(),
    channel: isDelivery ? "delivery" : rnd() < 0.3 ? "drivethru" : "pickup",
    storeCode: STORES[Math.floor(rnd() * STORES.length)]?.code ?? STORES[0]!.code,
    storeName: STORES[Math.floor(rnd() * STORES.length)]?.name ?? STORES[0]!.name,
    status: "completed",
    lines: [
      { productCode, productName: item.name, quantity, comboItems },
    ],
    paid,
    detail: {
      orderId: "",
      totalAmount,
      paid,
      discount: Math.max(0, Math.round((totalAmount - (paid - deliveryFee)) * 100) / 100),
      deliveryFee,
      productPrice: Math.round((unit * quantity - couponCut) * 100) / 100,
      coupons: couponCut > 0 ? [{ name: "限时活动券", amount: couponCut }] : [],
      pickupCode: String(30000 + Math.floor(rnd() * 9000)),
    },
  };
}

export function demoCoupons(now: Date): Coupon[] {
  const today = toDateKey(now);
  const inDays = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return toDateKey(d);
  };
  const wd = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n).getDay();

  return [
    {
      id: "coupon-demo-1",
      // 到期时间刻意跨到明天同一时刻：这样"48 小时内到期"的判断不随打开页面的钟点漂移，
      // 演示数字才能稳定复现（原来写死在今天 10:29，下午跑就会少一项漏损）。
      name: "芝香脆鸡扒堡早餐两件套",
      price: 9.9,
      validFrom: `${today}T05:00`,
      validTo: `${inDays(1)}T10:29`,
      weekdays: [],
      startTime: "05:00",
      endTime: "10:29",
      channels: ["到店专用"],
      tags: ["即将到期"],
    },
    {
      id: "coupon-demo-2",
      name: "11.9元麦辣鸡腿堡",
      price: 11.9,
      validFrom: `${today}T10:30`,
      validTo: `${inDays(3)}T23:59`,
      weekdays: [],
      startTime: "10:30",
      endTime: "23:59",
      channels: ["到店专用", "外送专用"],
      tags: [],
    },
    {
      id: "coupon-demo-3",
      name: "19.9元王牌炸鸡任选2",
      price: 19.9,
      validFrom: `${today}T10:30`,
      validTo: `${inDays(3)}T23:59`,
      weekdays: [1, 2, 3, 4, 5],
      startTime: "10:30",
      endTime: "23:59",
      channels: ["到店专用"],
      tags: [],
    },
    {
      id: "coupon-demo-4",
      name: "高达芝士蛋堡早餐两件套",
      price: 9.9,
      validFrom: `${inDays(1)}T05:00`,
      validTo: `${inDays(1)}T10:29`,
      weekdays: [wd(1)],
      startTime: "05:00",
      endTime: "10:29",
      channels: ["到店专用"],
      tags: [],
    },
    {
      id: "coupon-demo-5",
      name: "9.9元猪柳蛋麦满分",
      price: 9.9,
      validFrom: `${inDays(-30)}T05:00`,
      validTo: `${inDays(1)}T10:29`,
      weekdays: [1, 2, 3, 4, 5],
      startTime: "05:00",
      endTime: "10:29",
      channels: ["到店专用"],
      tags: [],
    },
  ];
}

export function demoPoints(): PointsAccount {
  return {
    available: 320.5,
    accumulative: 3860.2,
    used: 1840,
    expired: 1860.4,
    expiringThisMonth: 120,
    expiringNextMonth: 0,
    frozen: 0,
    pointsPerYuan: 100,
    ratioEstimated: true,
  };
}

export function demoCampaigns(now: Date): Campaign[] {
  const inDays = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return toDateKey(d);
  };
  return [
    {
      title: "程序员节系列活动：趣味互动赢专属好券",
      date: inDays(3),
      summary: "10月23日-10月25日 参与趣味互动赢专属好券，还有机会解锁数字徽章",
      kind: "upcoming",
    },
    {
      title: "限定主题丝巾 10:45 开售",
      date: inDays(2),
      summary: "任意餐品消费加 39.9 元可得，10月22日10:45开售",
      kind: "upcoming",
    },
    {
      title: "超值 9.9 元早餐两件套",
      date: inDays(0),
      summary: "周一至周五早餐堡轮流上早班，凭券两件套 9.9 元",
      kind: "today",
    },
  ];
}
