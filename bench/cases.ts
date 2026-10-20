/**
 * 回归用例：账本的数字必须能被断言，否则它就只是一张好看的图。
 * 覆盖三层价格模型、双源归因、降级路径、券窗口解析四类高风险逻辑。
 */
import { priceOrder } from "../src/model/pricing.ts";
import { summarizeAttribution, totalSaved } from "../src/audit/attribution.ts";
import { parseWindow, parseWeekdays } from "../src/ingest/coupons.ts";
import { parseOrders } from "../src/ingest/orders.ts";
import { parseOrderDetail } from "../src/ingest/orderDetail.ts";
import { normalizeName, parseCouponTitle, looseMatch } from "../src/model/text.ts";
import { detectLeaks } from "../src/audit/detectors.ts";
import { mealPeriod } from "../src/audit/report.ts";
import {
  buildStrategies,
  buildView,
  resolveRange,
  summarize,
  filterRows,
} from "../src/engine/range.mjs";
import type { LedgerData, LedgerRow } from "../src/engine/range.mjs";
import type { MenuItem, Order, OrderDetail } from "../src/model/types.ts";

export interface Case {
  name: string;
  run: () => void;
}

function item(
  code: string,
  name: string,
  currentPrice: number | null,
  originalPrice: number | null,
  discountType: string | null = null,
): MenuItem {
  return {
    code,
    name,
    currentPrice,
    originalPrice,
    discountType,
    tags: [],
    category: null,
    canWithOrder: false,
  };
}

const MENU: Record<string, MenuItem> = {
  "9900003458": item("9900003458", "猪柳蛋麦满分套餐", 15.9, 26.5, "随单购早餐卡优惠"),
  "5022": item("5022", "猪柳蛋麦满分", 18, 18),
  "520689": item("520689", "鲜萃咖啡", 10, 10),
  "4825": item("4825", "脆薯饼", 8, 8),
  "521884": item("521884", "麦辣鸡腿汉堡", 24.5, 24.5),
};

function detail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderId: "T1",
    totalAmount: 26.5,
    paid: 15.9,
    discount: 10.6,
    deliveryFee: 0,
    productPrice: 15.9,
    coupons: [],
    pickupCode: null,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    orderId: "T1",
    createdAt: "2026-09-16 07:17:19",
    createdAtMs: new Date(2026, 8, 16, 7, 17, 19).getTime(),
    channel: "pickup",
    storeCode: "1420955",
    storeName: "测试门店",
    status: "completed",
    lines: [
      {
        productCode: "9900003458",
        productName: "猪柳蛋麦满分套餐",
        quantity: 1,
        comboItems: [
          { code: "5022", name: "猪柳蛋麦满分", quantity: 1 },
          { code: "520689", name: "鲜萃咖啡", quantity: 1 },
        ],
      },
    ],
    paid: 15.9,
    detail: detail(),
    ...overrides,
  };
}

const near = (a: number, b: number, eps = 0.011): boolean => Math.abs(a - b) < eps;

export const CASES: Case[] = [
  {
    name: "套餐拆解：单点合计按子项现价相加（18+10=28）",
    run: () => {
      const p = priceOrder(order(), MENU);
      assert(p.alaCarte === 28, `alaCarte=${p.alaCarte}`);
      assert(p.list === 26.5, `list=${p.list}`);
      assert(p.paid === 15.9, `paid=${p.paid}`);
      assert(p.source === "detail", `source=${p.source}`);
    },
  },
  {
    name: "归因拆分：活动优惠 10.6 / 组合价值 1.5 / 券 0",
    run: () => {
      const p = priceOrder(order(), MENU);
      assert(near(p.activity, 10.6), `activity=${p.activity}`);
      assert(near(p.combo ?? 0, 1.5), `combo=${p.combo}`);
      assert(near(p.coupon, 0), `coupon=${p.coupon}`);
      assert(p.coverage === 1, "有详情时应可完整归因");
    },
  },
  {
    name: "逐券归因：券 4 + 活动 6.6，总数不变（16.1）",
    run: () => {
      const o = order({
        paid: 11.9,
        detail: detail({
          paid: 11.9,
          discount: 14.6,
          coupons: [{ name: "限时活动券", amount: 4 }],
        }),
      });
      const p = priceOrder(o, MENU);
      assert(near(p.coupon, 4), `coupon=${p.coupon}`);
      assert(near(p.activity, 10.6), `activity=${p.activity}`);
      assert(near(totalSaved(summarizeAttribution([p])) ?? 0, 16.1), "总节省应不变");
      assert(p.reasons["限时活动券"] === 4, "券名应出现在分项里");
    },
  },
  {
    name: "配送费：单独计入 deliveryFee，不污染优惠金额",
    run: () => {
      const o = order({
        paid: 24.9,
        channel: "delivery",
        detail: detail({ paid: 24.9, deliveryFee: 9 }),
      });
      const p = priceOrder(o, MENU);
      assert(near(p.deliveryFee, 9), `deliveryFee=${p.deliveryFee}`);
      assert(near(p.activity, 10.6), `activity=${p.activity}`);
    },
  },
  {
    name: "降级：没有订单详情时不猜归因，coverage=0 且 gap 等于实付",
    run: () => {
      const o = order({ detail: null });
      const p = priceOrder(o, MENU);
      assert(p.coverage === 0, "coverage 应为 0");
      assert(near(p.gap, 15.9), `gap=${p.gap}`);
      assert(p.activity === 0 && p.coupon === 0, "无详情不应产生优惠结论");
      const summary = summarizeAttribution([p]);
      assert(summary.coverage === 0, "整体覆盖率应为 0");
      assert(summary.gap === 15.9, `summary.gap=${summary.gap}`);
    },
  },
  {
    name: "缺 SKU：无法还原组合价值时 combo 为 null（省下的钱成下限）",
    run: () => {
      const p = priceOrder(order(), { "9900003458": MENU["9900003458"]!, "5022": MENU["5022"]! });
      assert(p.alaCarte === null, `alaCarte=${p.alaCarte}`);
      assert(p.combo === null, `combo=${p.combo}`);
      const summary = summarizeAttribution([p]);
      assert(summary.comboMissing === 1, `comboMissing=${summary.comboMissing}`);
      assert(near(summary.coupon + summary.activity, 10.6), "优惠部分仍应保留");
    },
  },
  {
    name: "订单解析：已取消订单被识别，beType=5 映射得来速",
    run: () => {
      const payload = {
        data: {
          list: [
            {
              orderId: "A",
              createTime: "2026-09-16 07:17:19",
              beType: "5",
              storeCode: "1",
              storeName: "S",
              orderStatus: "订单已完成",
              orderProductList: [{ productCode: "4825", productName: "脆薯饼", quantity: 1 }],
              realTotalAmount: "8",
            },
            {
              orderId: "B",
              createTime: "2026-09-15 07:17:19",
              beType: "1",
              storeCode: "1",
              storeName: "S",
              orderStatus: "订单已取消",
              orderProductList: [{ productCode: "4825", productName: "脆薯饼", quantity: 1 }],
              realTotalAmount: "8",
            },
          ],
        },
      };
      const { orders } = parseOrders(payload);
      assert(orders.length === 2, `orders=${orders.length}`);
      assert(orders.filter((o) => o.status === "cancelled").length === 1, "应有 1 笔取消");
      assert(orders.some((o) => o.channel === "drivethru"), "beType=5 应映射为得来速");
    },
  },
  {
    name: "订单详情解析：原价 / 实付 / 总优惠 / 券明细",
    run: () => {
      const d = parseOrderDetail(
        {
          data: {
            orderId: "X",
            totalAmount: "26.5",
            realTotalAmount: "15.9",
            totalDiscountAmount: "10.6",
            realDeliveryPrice: "0",
            couponList: [{ couponName: "早餐券", discountAmount: "4" }],
            pickupCode: "36011",
          },
        },
        "X",
      );
      assert(d !== null, "应解析成功");
      assert(d?.totalAmount === 26.5 && d?.paid === 15.9, "金额字段应正确");
      assert(d?.discount === 10.6 && d?.deliveryFee === 0, "优惠与配送费应正确");
      assert(d?.coupons.length === 1 && d?.coupons[0]?.amount === 4, "券明细应正确");
      assert(d?.pickupCode === "36011", "取餐码应保留");
    },
  },
  {
    name: "券窗口解析：日期范围 + 星期 + 每日时段",
    run: () => {
      const w = parseWindow("2026-10-20 05:00-2026-10-20 10:29 周二 05:00-10:29");
      assert(w !== null, "应解析成功");
      assert(w?.startTime === "05:00" && w?.endTime === "10:29", `窗口=${w?.startTime}-${w?.endTime}`);
      assert(w?.weekdays.length === 1 && w?.weekdays[0] === 2, `weekdays=${JSON.stringify(w?.weekdays)}`);
    },
  },
  {
    name: "券窗口解析：周一至周五简写",
    run: () => {
      assert(JSON.stringify(parseWeekdays("周一、二、三、四、五 10:30-23:59")) === "[1,2,3,4,5]", "应得到 1..5");
    },
  },
  {
    name: "券名解析：11.9元麦辣鸡腿堡 → 价格 11.9 + 品名可匹配",
    run: () => {
      const r = parseCouponTitle("11.9元麦辣鸡腿堡");
      assert(r.price === 11.9, `price=${r.price}`);
      assert(looseMatch(r.product, "麦辣鸡腿汉堡"), "「麦辣鸡腿堡」应匹配「麦辣鸡腿汉堡」");
    },
  },
  {
    name: "名称归一：去规格词与汉堡/堡差异",
    run: () => {
      assert(normalizeName("麦咖啡™热美式中杯") === "麦咖啡热美式", normalizeName("麦咖啡™热美式中杯"));
      assert(looseMatch("芝芝火腿扒堡组合", "芝芝火腿扒堡"), "组合应能匹配到单品");
    },
  },
  {
    name: "漏损检测：过期积分按兑元比折算",
    run: () => {
      const leaks = detectLeaks({
        orders: [],
        coupons: [],
        points: {
          available: 100,
          accumulative: 4000,
          used: 1000,
          expired: 2000,
          expiringThisMonth: 0,
          expiringNextMonth: 0,
          frozen: 0,
          pointsPerYuan: 100,
          ratioEstimated: false,
        },
        menu: MENU,
        now: new Date(2026, 9, 20),
        attributionGap: 0,
        unresolvedOrders: 0,
      });
      const expired = leaks.find((l) => l.kind === "expired-points");
      assert(expired !== undefined, "应检测到过期积分");
      assert(near(expired?.amount ?? 0, 20), `amount=${expired?.amount}`);
    },
  },
  {
    name: "时段划分：10:29 属早餐，10:30 属午餐，23:30 属夜宵",
    run: () => {
      assert(mealPeriod(new Date(2026, 9, 20, 10, 29)) === "早餐", "10:29 应为早餐");
      assert(mealPeriod(new Date(2026, 9, 20, 10, 30)) === "午餐", "10:30 应为午餐");
      assert(mealPeriod(new Date(2026, 9, 20, 23, 30)) === "夜宵", "23:30 应为夜宵");
    },
  },
  /* ---------------------- 区间筛选与策略引擎 ---------------------- */

  {
    name: "区间解析：近 7 天含今天，共 7 个自然日",
    run: () => {
      const now = new Date(2026, 9, 20, 14, 30).getTime();
      const r = resolveRange("7d", now, []);
      assert(r.days === 7, `days=${r.days}`);
      assert(r.from === "2026-10-14" && r.to === "2026-10-20", `${r.from}→${r.to}`);
      assert(r.fromMs <= new Date(2026, 9, 14, 0, 0).getTime(), "起点应为 14 日 00:00");
      assert(r.toMs >= now, "终点应包含当前时刻");
    },
  },
  {
    name: "区间解析：自定义区间反着填也能纠正",
    run: () => {
      const now = new Date(2026, 9, 20).getTime();
      const r = resolveRange("2026-10-10..2026-10-01", now, []);
      assert(r.key === "custom", `key=${r.key}`);
      assert(r.from === "2026-10-01" && r.to === "2026-10-10", `${r.from}→${r.to}`);
      assert(r.days === 10, `days=${r.days}`);
    },
  },
  {
    name: "区间解析：无法识别的写法退回默认区间而不是报错",
    run: () => {
      const r = resolveRange("上个月", new Date(2026, 9, 20).getTime(), []);
      assert(r.key === "30d", `key=${r.key}`);
    },
  },
  {
    name: "区间筛选：边界毫秒内的订单要算进来",
    run: () => {
      const now = new Date(2026, 9, 20, 12, 0).getTime();
      const range = resolveRange("7d", now, []);
      const rows = [
        row({ ms: range.fromMs }),
        row({ ms: range.toMs }),
        row({ ms: range.fromMs - 1 }),
        row({ ms: range.toMs + 1 }),
      ];
      const kept = filterRows(rows, range);
      assert(kept.length === 2, `kept=${kept.length}`);
    },
  },
  {
    name: "引擎聚合：区间内实付与节省和三段口径自洽",
    run: () => {
      const now = new Date(2026, 9, 20, 12, 0).getTime();
      const range = resolveRange("7d", now, []);
      const rows = [
        row({ ms: now - 3600_000, paid: 15.9, list: 26.5, ala: 28, act: 10.6, cpn: 0 }),
        row({ ms: now - 7200_000, paid: 24.5, list: 24.5, ala: 24.5, act: 0, cmb: 0 }),
      ];
      const s = summarize(rows, range);
      assert(near(s.paid, 40.4), `paid=${s.paid}`);
      // 省下 = 券 0 + 活动 10.6 + 组合价值 (28+24.5) − (26.5+24.5) = 1.5
      assert(near(s.saved ?? -1, 12.1), `saved=${s.saved}`);
      assert(near(s.combo ?? -1, 1.5), `combo=${s.combo}`);
      assert(s.orders === 2, `orders=${s.orders}`);
    },
  },
  {
    name: "引擎聚合：区间外订单不进入任何汇总",
    run: () => {
      const now = new Date(2026, 9, 20, 12, 0).getTime();
      const range = resolveRange("7d", now, []);
      const rows = [
        row({ ms: now - 3600_000, paid: 10 }),
        row({ ms: now - 40 * 86_400_000, paid: 999 }),
      ];
      const s = summarize(filterRows(rows, range), range);
      assert(near(s.paid, 10), `paid=${s.paid}`);
    },
  },
  {
    name: "策略：券覆盖了高频时段却没用上 → 给出时段×券建议",
    run: () => {
      const now = new Date(2026, 9, 20, 12, 0).getTime();
      const rows = [0, 1, 2].map((i) =>
        row({ ms: new Date(2026, 9, 18 + i, 7, 20).getTime(), paid: 15.9, del: 0, coupons: [] }),
      );
      const data = ledgerData(rows, now, [
        {
          id: "c1",
          name: "9.9元猪柳蛋麦满分",
          price: 9.9,
          validFrom: "2026-10-01T05:00",
          validTo: "2026-10-25T10:29",
          weekdays: [],
          startTime: "05:00",
          endTime: "10:29",
          channels: [],
          tags: [],
          worth: 8.1,
        },
      ]);
      const view = buildView(data, "7d");
      const hit = view.strats.find((x) => x.kind === "window");
      assert(hit !== undefined, "应命中 window 策略");
      assert(near(hit?.inRange ?? 0, 24.3), `inRange=${hit?.inRange}`);
      assert((hit?.basis.length ?? 0) >= 2, "策略必须带证据");
    },
  },
  {
    name: "策略：区间内没有订单时返回空集而不是报错",
    run: () => {
      const now = new Date(2026, 9, 20, 12, 0).getTime();
      const data = ledgerData([row({ ms: now - 200 * 86_400_000 })], now, []);
      const view = buildView(data, "7d");
      assert(view.summary.orders === 0, `orders=${view.summary.orders}`);
      assert(view.strats.length === 0, `strats=${view.strats.length}`);
      assert(view.html.strategy.indexOf("没有完成的订单") > 0, "应给出空状态");
    },
  },
  {
    name: "策略：只有单一区间才能算出月化，一次性券机会不月化",
    run: () => {
      const now = new Date(2026, 9, 20, 12, 0).getTime();
      const rows = [0, 1, 2, 3].map((i) =>
        row({ ms: new Date(2026, 9, 16 + i, 12, 10).getTime(), paid: 30, list: 24.5, del: 9 }),
      );
      const data = ledgerData(rows, now, []);
      const view = buildView(data, "7d");
      const del = view.strats.find((x) => x.kind === "delivery");
      assert(del !== undefined, "应命中配送费策略");
      assert(near(del?.inRange ?? 0, 36), `inRange=${del?.inRange}`);
      assert(near(del?.perMonth ?? 0, 36 * (30 / 7)), `perMonth=${del?.perMonth}`);
    },
  },
];

/** 造一行订单事实，默认可精确归因 */
function row(over: Partial<LedgerRow> = {}): LedgerRow {
  const ms = over.ms ?? new Date(2026, 9, 20, 7, 20).getTime();
  const d = new Date(ms);
  return {
    ms,
    m: d.getHours() * 60 + d.getMinutes(),
    id: "O1",
    ch: "pickup",
    st: "测试门店",
    paid: 15.9,
    list: 26.5,
    ala: 28,
    cpn: 0,
    act: 10.6,
    cmb: 1.5,
    del: 0,
    cov: 1,
    status: "completed",
    items: [["9900003458", "猪柳蛋麦满分套餐", 1, 15.9]],
    coupons: [],
    ...over,
  };
}

function ledgerData(
  rows: LedgerRow[],
  now: number,
  coupons: LedgerData["coupons"],
): LedgerData {
  return {
    v: 1,
    now,
    nowIso: new Date(now).toISOString(),
    defaultRange: "7d",
    rows,
    coupons,
    campaigns: [],
    menu: { "9900003458": { p: 15.9, o: 26.5, d: "随单购早餐卡优惠" } },
    meta: { demo: true, traceId: "t", dataFrom: "2026-07-01", dataTo: "2026-10-20" },
  };
}


export function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
