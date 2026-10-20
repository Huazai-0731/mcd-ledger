/**
 * 同构引擎：区间筛选 + 聚合 + 策略生成 + 片段渲染。
 *
 * 为什么是一个 .mjs？
 * ------------------------------------------------------------------
 * 账本页是**单文件、零请求、可离线**的 HTML。时间筛选不能靠"重新跑一遍 CLI"，
 * 必须在页面里就地重算。而重算的结果又必须与服务端渲染（SSR）的数字**完全一致**，
 * 否则用户切一次区间就会发现两套账。
 *
 * 所以这里只写一份实现：
 *   · Node 侧  → pipeline 用它解析区间，html.ts 用它渲染首屏
 *   · 浏览器侧 → 同一份源码被内联进 <script>，切区间时重新调用
 *
 * 唯一不允许出现的重复是"两套算法"。因此本文件不 import 任何东西，
 * 也不做任何 IO，所有输入（订单行、券、菜单价）都由调用方传入。
 *
 * 约定：金额一律用 number（元），聚合时逐步 money() 取两位小数，
 * 与 src/audit/attribution.ts 的口径保持同一套舍入，保证双端数字对得上。
 */

/* ============================ 0. 基础工具 ============================ */

export const ENGINE_VERSION = 1;

/** 两位小数，与 runtime/contract.ts 的 money() 完全一致 */
export function money(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function yuan(n) {
  return "¥" + n.toFixed(2);
}

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** SVG 坐标保留 1 位小数，减小体积 */
function r(n) {
  return String(Math.round(n * 10) / 10);
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

/** 本地时间字符串 → 毫秒。手写解析，避免各浏览器对 "YYYY-MM-DD HH:mm" 的解释差异 */
export function parseLocal(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    m[4] === undefined ? 0 : Number(m[4]),
    m[5] === undefined ? 0 : Number(m[5]),
  ).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function dateKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function hhmm(minutes) {
  return pad2(Math.floor(minutes / 60)) + ":" + pad2(minutes % 60);
}

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const CHANNEL_CN = {
  pickup: "到店自取",
  delivery: "外送",
  drivethru: "得来速",
  group: "团餐",
  unknown: "其他",
};

/** 时段划分与 src/audit/report.ts 的 mealPeriod 完全一致：早餐券基本只到 10:29 */
export function mealPeriod(minutes) {
  if (minutes < 10 * 60 + 30) return "早餐";
  if (minutes < 14 * 60) return "午餐";
  if (minutes < 17 * 60) return "下午茶";
  if (minutes < 21 * 60) return "晚餐";
  return "夜宵";
}

function pct(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/* ============================ 1. 时间区间 ============================ */

export const PRESETS = [
  { key: "7d", label: "近 7 天", days: 7 },
  { key: "30d", label: "近 30 天", days: 30 },
  { key: "90d", label: "近 90 天", days: 90 },
  { key: "all", label: "全部", days: null },
];

export const DEFAULT_RANGE = "30d";

/**
 * 决策页原型的相对入口（第一档：两页互通）。
 * 引擎是双端同构的，不能 import 渲染层，所以这里与 src/render/html.ts 的
 * PLAN_HREF 各存一份；两者同目录时可直接跳转，报告被单独拷走后为软链。
 */
const PLAN_HREF = "prototype-v2.html";

/** 跳到决策页时带的区间参数：自定义区间要原样带上起止日期 */
function planSpec(range) {
  return range.key === "custom" ? range.from + ".." + range.to : range.key;
}

/** 决策页链接：区间 + 策略类型一起带过去，对面才知道该先选哪个买法 */
function planHref(range, kind) {
  const q = ["from=ledger", "range=" + encodeURIComponent(planSpec(range))];
  if (kind) q.push("strat=" + encodeURIComponent(kind));
  return PLAN_HREF + "?" + q.join("&");
}

/**
 * 解析命令行 / URL 传入的区间描述。
 *   "7d" | "30d" | "90d" | "all" | "2026-09-01..2026-10-01"
 * 解析不出来时退回默认区间，而不是报错——一个筛选器不该让整份报告打不开。
 */
export function parseRangeSpec(spec) {
  if (typeof spec !== "string" || spec === "") return { key: DEFAULT_RANGE };
  const key = spec.trim();
  if (PRESETS.some((p) => p.key === key)) return { key };
  const m = key.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (m) return { key: "custom", from: m[1], to: m[2] };
  return { key: DEFAULT_RANGE };
}

/**
 * 求区间的毫秒边界。
 * 预设区间用**自然日**而非 24 小时倍数：「近 7 天」= 含今天在内的 7 个自然日，
 * 这样 00:10 与 23:50 打开页面看到的是同一批订单。
 */
export function resolveRange(spec, nowMs, rows) {
  const g = parseRangeSpec(spec);
  const preset = PRESETS.find((p) => p.key === g.key);

  if (preset) {
    const days = preset.days;
    if (days === null) {
      const times = rows.map((x) => x.ms).filter((v) => Number.isFinite(v));
      const fromMs = times.length > 0 ? startOfDay(Math.min(...times)) : startOfDay(nowMs);
      const span = Math.max(1, Math.round((nowMs - fromMs) / 86400000) + 1);
      return {
        key: "all",
        label: "全部",
        fromMs,
        toMs: nowMs,
        from: dateKey(fromMs),
        to: dateKey(nowMs),
        days: span,
        custom: false,
      };
    }
    const fromMs = startOfDay(nowMs) - (days - 1) * 86400000;
    return {
      key: preset.key,
      label: preset.label,
      fromMs,
      toMs: nowMs,
      from: dateKey(fromMs),
      to: dateKey(nowMs),
      days,
      custom: false,
    };
  }

  const fromRaw = parseLocal(g.from);
  const toRaw = parseLocal(g.to);
  let fromMs = fromRaw === null ? startOfDay(nowMs) : startOfDay(fromRaw);
  let toMs = toRaw === null ? nowMs : endOfDay(toRaw);
  if (fromMs > toMs) {
    const swap = fromMs;
    fromMs = startOfDay(toMs);
    toMs = endOfDay(swap);
  }
  const days = Math.max(1, Math.round((startOfDay(toMs) - fromMs) / 86400000) + 1);
  return {
    key: "custom",
    label: dateKey(fromMs) + " → " + dateKey(toMs),
    fromMs,
    toMs,
    from: dateKey(fromMs),
    to: dateKey(toMs),
    days,
    custom: true,
  };
}

export function filterRows(rows, range) {
  return rows.filter((x) => x.ms >= range.fromMs && x.ms <= range.toMs);
}

/* ============================ 2. 聚合 ============================ */

/**
 * 在选定区间内重算一遍汇总。口径与审计层一致：
 *   · 只有拿到订单详情的订单（cov=1）才参与「省了多少」
 *   · 组合价值 = 单点合计 − 原价合计，缺一项就整项留白，不补零
 */
export function summarize(rows, range) {
  const done = rows.filter((x) => x.status === "completed");
  const cancelled = rows.length - done.length;
  const covered = done.filter((x) => x.cov === 1);

  const paid = money(sum(done.map((x) => x.paid)));
  const attributablePaid = money(sum(covered.map((x) => x.paid)));

  const listVals = covered.map((x) => x.list);
  const alaVals = covered.map((x) => x.ala);
  const list =
    listVals.length > 0 && listVals.every((v) => v !== null) ? money(sum(listVals)) : null;
  const alaCarte =
    alaVals.length > 0 && alaVals.every((v) => v !== null) ? money(sum(alaVals)) : null;

  const comboKnown = covered.map((x) => x.cmb).filter((v) => v !== null);
  const comboMissing = covered.length - comboKnown.length;
  const combo =
    alaCarte !== null && list !== null
      ? money(Math.max(0, alaCarte - list))
      : comboKnown.length > 0
        ? money(sum(comboKnown))
        : null;

  const coupon = money(sum(covered.map((x) => x.cpn)));
  const activity = money(sum(covered.map((x) => x.act)));
  const delivery = money(sum(covered.map((x) => x.del)));
  const coverage = paid > 0 ? attributablePaid / paid : 0;
  const saved = coverage > 0 ? money(coupon + activity + (combo ?? 0)) : null;

  const mealPeriods = {};
  const channels = {};
  const storeMap = new Map();
  const itemMap = new Map();
  const weekday = new Array(7).fill(0);
  const hour = new Array(24).fill(0);
  let items = 0;

  for (const x of done) {
    const d = new Date(x.ms);
    const mp = mealPeriod(x.m);
    mealPeriods[mp] = (mealPeriods[mp] || 0) + 1;
    channels[x.ch] = (channels[x.ch] || 0) + 1;
    weekday[d.getDay()] += 1;
    hour[d.getHours()] += 1;

    const st = storeMap.get(x.st) || { orders: 0, paid: 0 };
    st.orders += 1;
    st.paid = money(st.paid + x.paid);
    storeMap.set(x.st, st);

    for (const it of x.items || []) {
      items += it[2];
      itemMap.set(it[1], (itemMap.get(it[1]) || 0) + it[2]);
    }
  }

  const stores = [...storeMap.entries()]
    .map(([name, v]) => ({ name, orders: v.orders, paid: v.paid }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 5);

  const topItems = [...itemMap.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  let maxTicket = null;
  for (const x of done) {
    if (maxTicket === null || x.paid > maxTicket.paid) {
      maxTicket = { orderId: x.id, paid: x.paid, date: dateKey(x.ms) };
    }
  }

  return {
    range,
    orders: done.length,
    cancelled,
    paid,
    list,
    alaCarte,
    coupon,
    activity,
    combo,
    saved,
    savedRate: saved !== null && paid + saved > 0 ? saved / (paid + saved) : null,
    lowerBound: comboMissing > 0,
    delivery,
    coverage,
    gap: money(paid - attributablePaid),
    resolved: done.filter((x) => x.cov === 1).length,
    unresolved: done.length - done.filter((x) => x.cov === 1).length,
    items,
    mealPeriods,
    channels,
    stores,
    topItems,
    weekday,
    hour,
    avgTicket: done.length > 0 ? money(paid / done.length) : 0,
    maxTicket,
  };
}

/* ============================ 3. 策略生成 ============================ */

/**
 * 策略 = 「基于所选区间的消费结构」×「当前可用的券 / 菜单价 / 活动」→ 一条能执行的动作。
 *
 * 硬约束（沿用账本的原则）：
 *   1. 每条策略必须带**能对回订单的证据**，不允许"猜你想吃"。
 *   2. 估不出来就留白（amount = null），不编一个好看的数字。
 *   3. 区间是策略的前提：7 天和 90 天看到的结构不同，结论就该不同。
 */

const CONF_LABEL = { high: "高置信", medium: "中置信", low: "低置信" };
const CONF_SCORE = { high: 26, medium: 18, low: 9 };
const KIND_LABEL = {
  window: "时段 × 券",
  price: "单价",
  delivery: "渠道",
  expiry: "券库存",
  timing: "择时",
};

/** 券的时段是否覆盖 [lo, hi]（分钟） */
function couponCoversTime(c, lo, hi) {
  const s = c.startTime ? toMin(c.startTime) : null;
  const e = c.endTime ? toMin(c.endTime) : null;
  if (s === null && e === null) return true;
  const a = s === null ? 0 : s;
  const b = e === null ? 24 * 60 - 1 : e;
  return a <= hi && b >= lo;
}

function toMin(hhmmText) {
  const m = String(hhmmText).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function couponExpired(c, now) {
  const t = parseLocal(c.validTo);
  return t !== null && t < now - 3600000;
}

/** 订单是否落在券的"星期 + 时段"内 */
function rowInCouponWindow(c, row) {
  if (c.weekdays && c.weekdays.length > 0) {
    const wd = new Date(row.ms).getDay();
    if (c.weekdays.indexOf(wd) < 0) return false;
  }
  return couponCoversTime(c, row.m, row.m);
}

function completed(rows) {
  return rows.filter((x) => x.status === "completed");
}

function groupByMeal(rows) {
  const map = new Map();
  for (const x of rows) {
    const k = mealPeriod(x.m);
    const arr = map.get(k) || [];
    arr.push(x);
    map.set(k, arr);
  }
  return map;
}

function dominantWeekday(rows) {
  const tally = new Map();
  for (const x of rows) {
    const wd = new Date(x.ms).getDay();
    tally.set(wd, (tally.get(wd) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [wd, n] of tally) {
    if (n > bestN) {
      best = wd;
      bestN = n;
    }
  }
  return best;
}

function makeStrat(o) {
  const amount = o.perMonth !== null ? o.perMonth : o.inRange;
  const score = Math.min(70, (amount === null ? 0 : amount) * 1.5) + CONF_SCORE[o.confidence];
  return {
    id: o.id,
    kind: o.kind,
    kindLabel: KIND_LABEL[o.kind],
    title: o.title,
    basis: o.basis,
    action: o.action,
    inRange: o.inRange,
    perMonth: o.perMonth,
    estimated: o.estimated !== false,
    confidence: o.confidence,
    confidenceLabel: CONF_LABEL[o.confidence],
    score: Math.round(score * 10) / 10,
  };
}

export function buildStrategies(summary, rows, data) {
  const ctx = {
    rows,
    done: completed(rows),
    range: summary.range,
    coupons: data.coupons || [],
    menu: data.menu || {},
    campaigns: data.campaigns || [],
    now: data.now,
    summary,
  };
  const found = [
    stratWindow(ctx),
    stratPrice(ctx),
    stratDelivery(ctx),
    stratExpiry(ctx),
    stratTiming(ctx),
  ].filter((x) => x !== null);
  return found.sort((a, b) => b.score - a.score).slice(0, 4);
}

/** 一句话说明策略规模：30 天区间里"月化"与"区间内"本来就相等，不必重复两遍 */
export function strategyCaption(totals) {
  const parts = [totals.count + " 条策略"];
  if (Math.abs(totals.perMonth - totals.inRangeAll) > 0.02 && totals.inRangeAll > 0) {
    parts.push("该区间内已发生 " + yuan(totals.inRangeAll));
  }
  if (totals.withAmount < totals.count) parts.push((totals.count - totals.withAmount) + " 条无法折算");
  return parts.join(" · ");
}

export function strategyTotals(strats) {
  let perMonth = 0;
  let oneOff = 0;
  let inRangeAll = 0;
  let withAmount = 0;
  for (const s of strats) {
    if (s.inRange !== null) inRangeAll = money(inRangeAll + s.inRange);
    if (s.perMonth !== null) {
      perMonth = money(perMonth + s.perMonth);
      withAmount += 1;
    } else if (s.inRange !== null) {
      oneOff = money(oneOff + s.inRange);
      withAmount += 1;
    }
  }
  return { perMonth, oneOff, inRangeAll, count: strats.length, withAmount };
}

/* ---- 3.1 时段 × 券：券在生效，订单却没用上 ---- */
function stratWindow(ctx) {
  const done = ctx.done;
  if (done.length < 3) return null;

  const buckets = groupByMeal(done);
  let period = null;
  let list = [];
  for (const [k, arr] of buckets) {
    if (arr.length > list.length) {
      period = k;
      list = arr;
    }
  }
  if (period === null || list.length < 3) return null;

  const mins = list.map((x) => x.m).sort((a, b) => a - b);
  const lo = pct(mins, 0.1);
  const hi = pct(mins, 0.9);
  const used = list.filter((x) => (x.coupons || []).length > 0).length;
  const missed = list.length - used;

  const wd = dominantWeekday(list);
  const covering = ctx.coupons.filter(
    (c) =>
      !couponExpired(c, ctx.now) &&
      couponCoversTime(c, lo, hi) &&
      (!c.weekdays || c.weekdays.length === 0 || (wd !== null && c.weekdays.indexOf(wd) >= 0)),
  );

  const basis = [
    period + "共 " + list.length + " 笔（占该区间 " + pct120(list.length, done.length) + "），集中在 " +
      hhmm(lo) + "–" + hhmm(hi),
  ];

  if (covering.length === 0) {
    basis.push("卡包里没有一张券的生效时段覆盖这段时间");
    if (used > 0) basis.push("这 " + used + " 笔用过券，说明券本身可用，是时段对不上");
    return makeStrat({
      id: "window",
      kind: "window",
      title: period + " " + list.length + " 笔都落在 " + hhmm(lo) + "–" + hhmm(hi) + "，券覆盖不到",
      basis,
      action:
        "两条路：把下单时间挪到券生效之后，或者直接找覆盖 " + hhmm(lo) + "–" + hhmm(hi) +
        " 的早餐卡 / 时段券——这是结构性缺口，靠单张券补不上",
      inRange: null,
      perMonth: null,
      confidence: "medium",
    });
  }

  if (missed === 0) return null;

  const worths = covering.map((c) => c.worth).filter((v) => typeof v === "number" && v > 0);
  const perOrder = worths.length > 0 ? money(sum(worths) / worths.length) : null;
  const inRange = perOrder !== null ? money(perOrder * missed) : null;
  const perMonth = inRange !== null ? money(inRange * (30 / ctx.range.days)) : null;
  basis.push(
    "卡包里有 " + covering.length + " 张券的生效时段正好覆盖这段时间：" +
      covering.slice(0, 2).map((c) => c.name).join("、"),
  );
  basis.push(
    "这 " + missed + " 笔订单没有用券记录（已用 " + used + " 笔）" +
      (perOrder !== null ? "，单张最多可省 " + yuan(perOrder) : ""),
  );
  if (perMonth !== null) basis.push("月化按「同类券可持续领取」推算——券本身是一次性的");
  return makeStrat({
    id: "window",
    kind: "window",
    title: period + " " + list.length + " 笔里有 " + missed + " 笔没用券",
    basis,
    action:
      "下单前先翻一遍卡包：" + covering[0].name +
      (covering[0].startTime ? " " + covering[0].startTime + "–" + covering[0].endTime : "") +
      " 正好落在你的" + period + "时段，把它变成点单前的固定动作",
    inRange,
    perMonth,
    confidence: "medium",
  });
}

/* ---- 3.2 单价：常点品的实付单价高于菜单现价 ---- */
function stratPrice(ctx) {
  const done = ctx.done;
  const agg = new Map();

  for (const row of done) {
    const items = row.items || [];
    if (items.length === 0) continue;
    if (!items.every((it) => typeof it[3] === "number" && it[3] > 0)) continue;
    const totalSale = sum(items.map((it) => it[3] * it[2]));
    if (!(totalSale > 0)) continue;
    const net = money(row.paid - (row.del || 0));
    for (const it of items) {
      const code = it[0];
      const cur = agg.get(code) || { name: it[1], qty: 0, alloc: 0 };
      cur.qty += it[2];
      cur.alloc += net * ((it[3] * it[2]) / totalSale);
      agg.set(code, cur);
    }
  }

  const gaps = [];
  for (const [code, v] of agg) {
    const m = ctx.menu[code];
    if (!m || typeof m.p !== "number" || v.qty < 2) continue;
    const unitPaid = money(v.alloc / v.qty);
    const gap = money(unitPaid - m.p);
    if (gap < 0.3) continue;
    gaps.push({ code, name: v.name, qty: v.qty, unitPaid, best: m.p, gap, total: money(gap * v.qty), tag: m.d });
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => b.total - a.total);

  const top = gaps.slice(0, 3);
  const inRange = money(sum(top.map((g) => g.total)));
  const perMonth = money(inRange * (30 / ctx.range.days));
  const head = top[0];
  const basis = top.map(
    (g) =>
      g.name + "：买了 " + g.qty + " 份，平均 " + yuan(g.unitPaid) + "/份，菜单现价 " + yuan(g.best) +
      (g.tag ? "（" + g.tag + "）" : ""),
  );
  basis.push("单价按订单实付总额按行拆分推算，属于估算");
  return makeStrat({
    id: "price",
    kind: "price",
    title: head.name + (top.length > 1 ? " 等 " + top.length + " 个常点品" : "") + "有更低的买法",
    basis,
    action:
      "点单时先走促销 / 卡权益入口，别在默认价上下单；如果同款在套餐里，换成套餐往往比单点再便宜一截",
    inRange,
    perMonth,
    confidence: "medium",
  });
}

/* ---- 3.3 渠道：配送费是硬支出 ---- */
function stratDelivery(ctx) {
  const withFee = ctx.done.filter((x) => (x.del || 0) > 0);
  if (withFee.length === 0) return null;
  const fee = money(sum(withFee.map((x) => x.del)));
  if (fee <= 0) return null;

  const deliveryTotal = ctx.done.filter((x) => x.ch === "delivery").length;
  const perMonth = money(fee * (30 / ctx.range.days));
  const basis = [
    "该区间 " + withFee.length + " 笔订单产生了配送费，合计 " + yuan(fee),
    "平均每笔 " + yuan(money(fee / withFee.length)) + "，这部分不属于优惠，是实打实的支出",
  ];
  const pickup = ctx.done.filter((x) => x.ch === "pickup").length;
  if (pickup > 0) basis.push("同期有 " + pickup + " 笔是到店自取，没有这笔成本");

  return makeStrat({
    id: "delivery",
    kind: "delivery",
    title: withFee.length + " 笔外送付了 " + yuan(fee) + " 配送费",
    basis,
    action:
      "把时间宽裕的那几单改成到店自取；必须外送时优先用「外送专用」券抵扣配送费，而不是让它原价叠加",
    inRange: fee,
    perMonth,
    confidence: "high",
  });
}

/* ---- 3.4 券库存：到期前按你的节奏用不用得完 ---- */
function stratExpiry(ctx) {
  const now = ctx.now;
  const soon = ctx.coupons.filter((c) => {
    const t = parseLocal(c.validTo);
    if (t === null) return false;
    const hours = (t - now) / 3600000;
    return hours > -1 && hours <= 7 * 24;
  });
  if (soon.length === 0) return null;

  const weeks = Math.max(ctx.range.days / 7, 0.5);

  // 同一时段（同星期、同时段）的多张券会互相挤占：你只会买一次早餐，
  // 却可能同时持有 3 张早餐券，所以可用次数要在同组内平摊。
  const groups = new Map();
  const keyOf = (c) => (c.startTime || "") + "-" + (c.endTime || "") + "|" + (c.weekdays || []).join(",");
  for (const c of soon) {
    const k = keyOf(c);
    groups.set(k, (groups.get(k) || 0) + 1);
  }

  const risk = [];
  for (const c of soon) {
    const t = parseLocal(c.validTo);
    const daysLeft = Math.max(0, (t - now) / 86400000);
    const fit = ctx.done.filter((x) => rowInCouponWindow(c, x)).length / weeks;
    const share = groups.get(keyOf(c)) || 1;
    const expected = (fit * (daysLeft / 7)) / share;
    if (expected < 0.9) risk.push({ coupon: c, expected, daysLeft, share });
  }

  if (risk.length > 0) {
    // 金额刻意留白：这些券的面值已经作为「漏损」记在 §04 了，
    // 策略这一节只回答"怎么办"，不把同一笔钱再算一次。
    const worths = risk.map((x) => x.coupon.worth).filter((v) => typeof v === "number" && v > 0);
    const basis = risk
      .slice(0, 3)
      .map(
        (x) =>
          x.coupon.name + "：还有 " + x.daysLeft.toFixed(1) + " 天到期，按你的节奏预计只能用上 " +
          x.expected.toFixed(2) + " 次" + (x.share > 1 ? "（同窗口共 " + x.share + " 张，互相挤占）" : ""),
      );
    basis.push("可用次数按「该券生效时段内的历史下单频率」外推，同窗口的券按张数平摊");
    if (worths.length > 0) basis.push("这些券面值合计 " + yuan(money(sum(worths))) + "，已计入 §04 的漏损，这里不重复折算");
    return makeStrat({
      id: "expiry",
      kind: "expiry",
      title: risk.length + " 张券按你的节奏用不完",
      basis,
      action:
        "到期前优先塞进最近一次同品类订单；确实用不完的话，下次别囤同类券——囤券本身就是一种沉没成本",
      inRange: null,
      perMonth: null,
      confidence: "medium",
    });
  }

  const basis = soon
    .slice(0, 3)
    .map((c) => c.name + (c.validTo ? "：至 " + String(c.validTo).replace("T", " ") : "：长期有效"));
  basis.push("按你在这些券生效时段的下单频率，到期前足够用掉");
  return makeStrat({
    id: "expiry",
    kind: "expiry",
    title: soon.length + " 张券到期前用得完",
    basis,
    action: "不用抢在最后一天：跟着你原本的" + mealPeriodOfCoupons(soon, ctx) + "节奏用掉就行",
    inRange: null,
    perMonth: null,
    confidence: "high",
  });
}

function mealPeriodOfCoupons(coupons, ctx) {
  const hit = ctx.done.filter((x) => coupons.some((c) => rowInCouponWindow(c, x)));
  if (hit.length === 0) return "下单";
  const buckets = groupByMeal(hit);
  let best = "下单";
  let n = 0;
  for (const [k, arr] of buckets) {
    if (arr.length > n) {
      best = k;
      n = arr.length;
    }
  }
  return best;
}

/* ---- 3.5 择时：活动日 × 你的节奏 ---- */
const MEAL_KEYWORDS = {
  早餐: ["早餐", "早安", "麦满分", "豆浆", "油条", "厚松饼"],
  午餐: ["午餐", "汉堡", "炸鸡", "套餐", "超值"],
  下午茶: ["下午茶", "咖啡", "麦咖啡", "甜品", "冰淇淋", "麦旋风"],
  晚餐: ["晚餐", "汉堡", "炸鸡", "套餐"],
  夜宵: ["夜宵", "宵夜", "炸鸡"],
};

function stratTiming(ctx) {
  const now = ctx.now;
  const upcoming = ctx.campaigns.filter((c) => {
    const t = parseLocal(c.date);
    if (t === null) return false;
    return t >= startOfDay(now) && t <= startOfDay(now) + 7 * 86400000;
  });
  if (upcoming.length === 0) return null;

  const buckets = groupByMeal(ctx.done);
  let period = null;
  let n = 0;
  for (const [k, arr] of buckets) {
    if (arr.length > n) {
      period = k;
      n = arr.length;
    }
  }
  if (period === null) return null;

  const kws = MEAL_KEYWORDS[period] || [];
  const topNames = ctx.summary.topItems.map((i) => i.name);
  const hit = upcoming.filter((c) => {
    const text = String(c.title) + String(c.summary || "");
    if (kws.some((k) => text.indexOf(k) >= 0)) return true;
    return topNames.some((name) => {
      const core = name.slice(0, 4);
      return core.length >= 3 && text.indexOf(core) >= 0;
    });
  });
  if (hit.length === 0) return null;
  const c = hit[0];

  return makeStrat({
    id: "timing",
    kind: "timing",
    title: String(c.date).slice(5) + " 的活动正好撞上你的" + period + "习惯",
    basis: [
      "活动：" + c.title,
      c.summary || "",
      "你在该区间的" + period + "订单最多（" + n + " 笔），活动日落在你的常规下单节奏上",
    ].filter((x) => x !== ""),
    action: "那一单先看活动细则再点——活动日叠券往往比平时多省一档，但没必要为了凑活动多买",
    inRange: null,
    perMonth: null,
    confidence: "low",
  });
}

function pct120(a, b) {
  if (!b) return "0%";
  return ((a / b) * 100).toFixed(0) + "%";
}

/* ============================ 4. 渲染：概览 ============================ */

function rangeTag(range) {
  return '<span class="sec-r">' + esc(range.label) + "</span>";
}

function emptyBlock(title, hint) {
  return '<div class="empty"><b>' + esc(title) + "</b><span>" + esc(hint) + "</span></div>";
}

export function renderOverview(s, strats, range) {
  const totals = strategyTotals(strats);
  const savedText = s.saved === null ? "—" : yuan(s.saved);
  const rateText = s.savedRate === null ? "—" : (s.savedRate * 100).toFixed(1) + "%";
  const oppo = totals.perMonth > 0 ? yuan(totals.perMonth) : totals.oneOff > 0 ? yuan(totals.oneOff) : "—";
  const oppoNote =
    totals.withAmount === 0
      ? "该区间没有可量化的改进点"
      : totals.perMonth > 0
        ? strategyCaption(totals)
        : "一次性机会 · " + strategyCaption(totals);

  return `
        <p class="cover-sub">
          ${esc(range.from)} <span class="arw">→</span> ${esc(range.to)}
          <span class="sep"></span>${range.days} 天
          <span class="sep"></span>${s.orders} 笔完成订单
          ${s.cancelled > 0 ? `<span class="sep"></span>${s.cancelled} 笔取消` : ""}
        </p>

        <div class="kpis">
          <div class="kpi">
            <div class="kpi-k">实付总额</div>
            <div class="kpi-v">${moneyCell(s.paid, 2)}</div>
            <div class="kpi-s">平均每笔 ${yuan(s.avgTicket)}</div>
          </div>
          <div class="kpi kpi-hl">
            <div class="kpi-k">省下来的钱</div>
            <div class="kpi-v"><span class="grad" ${countAttrs(s.saved)}>${esc(savedText)}</span></div>
            <div class="kpi-s">相当于原价的 ${rateText}${s.lowerBound ? ' <b class="tagline">下限</b>' : ""}</div>
          </div>
          <div class="kpi">
            <div class="kpi-k">还能再省 / 月</div>
            <div class="kpi-v gold">${esc(oppo)}</div>
            <div class="kpi-s">${esc(oppoNote)}</div>
          </div>
        </div>`;
}

/* ============================ 5. 渲染：三层价 ============================ */

export function renderFlow(s, range) {
  const raw = [
    { label: "单点合计", hint: "把套餐拆成单品、各买一份的价钱", value: s.alaCarte },
    { label: "划线价", hint: "平台记录的商品原价合计", value: s.list },
    { label: "实付", hint: "你真正付出的钱", value: s.paid },
  ];
  const steps = raw.filter((x) => x.value !== null && x.value > 0);
  const head =
    '<div class="sec-h"><span class="sec-n">§ 01</span><h2>同一顿饭的三个价格</h2>' +
    rangeTag(range) +
    "</div>";

  if (steps.length < 2) {
    return (
      '<section class="sec rv" id="flow">' +
      head +
      emptyBlock(
        "这个区间不够画出三层价",
        "需要至少两种价格口径（单点合计 / 划线价 / 实付）才能比较，换一个更长的区间试试。",
      ) +
      "</section>"
    );
  }

  const W = 760;
  const H = 282;
  const padX = 74;
  const top = 52;
  const base = 214;
  const span = Math.max(...steps.map((x) => x.value), 1);
  const max = span * 1.04;

  const x = (i) => padX + (i * (W - padX * 2)) / (steps.length - 1);
  const y = (v) => base - (v / max) * (base - top);

  const pts = steps.map((st, i) => ({ label: st.label, hint: st.hint, value: st.value, cx: x(i), cy: y(st.value) }));
  const lastPt = pts[pts.length - 1];

  let line = "";
  let prev = null;
  for (const pt of pts) {
    line += prev
      ? " L " + r(pt.cx) + " " + r(prev.cy) + " L " + r(pt.cx) + " " + r(pt.cy)
      : "M " + r(pt.cx) + " " + r(pt.cy);
    prev = pt;
  }
  line += " L " + (W - 26) + " " + r(lastPt.cy);

  const guides = pts
    .map((pt) => '<line class="svg-guide" x1="' + r(pt.cx) + '" y1="' + r(pt.cy) + '" x2="' + (W - 26) + '" y2="' + r(pt.cy) + '"/>')
    .join("");

  const ticks = pts
    .map((pt) => '<line class="svg-tick" x1="' + r(pt.cx) + '" y1="' + base + '" x2="' + r(pt.cx) + '" y2="' + (base + 7) + '"/>')
    .join("");

  const drops = [];
  let dropPrev = null;
  for (const pt of pts) {
    const before = dropPrev;
    dropPrev = pt;
    if (!before) continue;
    const save = before.value - pt.value;
    if (save <= 0.005) continue;
    const mx = (before.cx + pt.cx) / 2;
    const my = before.cy + Math.min(15, (pt.cy - before.cy) * 0.55);
    drops.push('<text class="svg-save" x="' + r(mx) + '" y="' + r(my) + '" text-anchor="middle">省 ' + yuan(save) + "</text>");
  }

  const nodes = pts
    .map(
      (pt, i) =>
        '<g class="svg-node" style="--d:' + (0.55 + i * 0.22).toFixed(2) + 's">' +
        '<circle class="svg-halo" cx="' + r(pt.cx) + '" cy="' + r(pt.cy) + '" r="13"/>' +
        '<circle class="svg-dot" cx="' + r(pt.cx) + '" cy="' + r(pt.cy) + '" r="' + (i === pts.length - 1 ? 5.5 : 4) + '"/>' +
        '<text class="svg-val' + (i === pts.length - 1 ? " svg-val-hl" : "") + '" x="' + r(pt.cx) + '" y="' + r(pt.cy - 22) + '" text-anchor="middle">' +
        yuan(pt.value) +
        "</text></g>",
    )
    .join("");

  const labels = pts
    .map(
      (pt) =>
        '<g><text class="svg-lb" x="' + r(pt.cx) + '" y="' + (base + 30) + '" text-anchor="middle">' +
        esc(pt.label) + '</text><text class="svg-hint" x="' + r(pt.cx) + '" y="' + (base + 50) + '" text-anchor="middle">' +
        esc(pt.hint) + "</text></g>",
    )
    .join("");

  return `<section class="sec rv" id="flow">
    ${head}
    <p class="lead">把三种口径摊开，才看得出“省”到底发生在哪一层。每一段落差都对应一类优惠。</p>

    <div class="chart brackets">
      <svg class="flowsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="单点合计、划线价与实付的阶梯对比">
        <defs>
          <linearGradient id="fg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#FFE7A8"/>
            <stop offset=".5" stop-color="#FFC72C"/>
            <stop offset="1" stop-color="#E8A200"/>
          </linearGradient>
        </defs>
        <line class="svg-base" x1="${padX - 26}" y1="${base}" x2="${W - 26}" y2="${base}"/>
        ${guides}
        ${ticks}
        <path class="svg-line draw" pathLength="100" d="${line}"/>
        ${drops.join("")}
        ${nodes}
        ${labels}
      </svg>
    </div>
  </section>`;
}

/* ============================ 6. 渲染：归因 ============================ */

export function renderAttr(s, range) {
  const head =
    '<div class="sec-h"><span class="sec-n">§ 02</span><h2>省的钱从哪来</h2>' + rangeTag(range) + "</div>";

  if (s.orders === 0) {
    return '<section class="sec rv" id="attr">' + head +
      emptyBlock("这个区间没有完成的订单", "换一个更长的区间，或从自定义里挑一段有消费的日期。") +
      "</section>";
  }

  const segs = [
    { label: "券与折扣", hint: "逐券金额，可对到具体订单", value: s.coupon, cls: "sA" },
    { label: "活动 / 卡权益", hint: "平台总优惠 − 券优惠", value: s.activity, cls: "sB" },
  ];
  if (s.combo !== null) {
    segs.push({ label: "套餐组合价值", hint: "单点合计 − 原价合计", value: s.combo, cls: "sC" });
  }
  const total = segs.reduce((acc, i) => acc + i.value, 0) || 1;

  const spectrum = segs
    .map(
      (x, i) =>
        '<span class="spec-seg ' + x.cls + '" style="flex:' + Math.max(x.value, 0.001).toFixed(3) +
        ";animation-delay:" + (0.08 * i).toFixed(2) + 's"></span>',
    )
    .join("");

  const rows = segs
    .map(
      (x) => `<div class="lg-row">
      <span class="lg-dot ${x.cls}"></span>
      <span class="lg-l">${esc(x.label)}<i>${esc(x.hint)}</i></span>
      <span class="lg-lead"></span>
      <span class="lg-v">${yuan(x.value)}</span>
      <span class="lg-p">${((x.value / total) * 100).toFixed(0)}%</span>
    </div>`,
    )
    .join("");

  const ghost =
    s.combo === null
      ? `<div class="lg-row lg-ghost">
      <span class="lg-dot dashed"></span>
      <span class="lg-l">套餐组合价值<i>该区间套餐商品已下架，单品现价无法还原</i></span>
      <span class="lg-lead"></span>
      <span class="lg-v">—</span>
      <span class="lg-p">未计入</span>
    </div>`
      : "";

  return `<section class="sec rv" id="attr">
    ${head}
    <p class="lead">三项互不重叠，合计等于“省下来的钱”。颜色深浅只表示层次，不代表好坏。</p>

    <div class="spec" role="img" aria-label="优惠构成占比">${spectrum}</div>
    <div class="legend">${rows}${ghost}</div>

    ${s.lowerBound ? `<p class="note">“省下来的钱”是<strong>下限</strong>：已计入的部分全部来自平台订单记录（原价合计 − 实付），可逐笔核对；未计入的是无法还原的套餐组合价值。</p>` : ""}
    ${s.delivery > 0 ? `<p class="note">另有 ${yuan(s.delivery)} 配送费计入实付，不属于优惠，未参与归因。</p>` : ""}
  </section>`;
}

/* ============================ 7. 渲染：策略 ============================ */

export function renderStrategy(strats, s, range) {
  const head =
    '<div class="sec-h"><span class="sec-n">§ 03</span><h2>下次怎么买</h2>' + rangeTag(range) + "</div>";

  if (s.orders === 0) {
    return '<section class="sec rv" id="strategy">' + head +
      emptyBlock("这个区间没有完成的订单", "策略需要订单结构做依据，先选一段有消费的区间。") +
      "</section>";
  }

  if (strats.length === 0) {
    return '<section class="sec rv" id="strategy">' + head +
      emptyBlock(
        "这个区间的买法已经接近最优",
        s.orders + " 笔订单里没有发现可量化的改进点：券用在了有效期内，单价也没有高于菜单现价。",
      ) +
      "</section>";
  }

  const totals = strategyTotals(strats);
  const headAmount =
    totals.perMonth > 0
      ? yuan(totals.perMonth) + '<i>/ 月</i>'
      : totals.oneOff > 0
        ? yuan(totals.oneOff) + "<i>/ 一次性</i>"
        : "—";

  const cards = strats
    .map((x, i) => {
      const amount =
        x.perMonth !== null
          ? '<span class="strat-v">' + yuan(x.perMonth) + '<i>/ 月</i></span>'
          : x.inRange !== null
            ? '<span class="strat-v">' + yuan(x.inRange) + "<i>/ 一次性</i></span>"
            : '<span class="strat-na">不折算</span>';
      return `<article class="strat">
        <span class="strat-n">${String(i + 1).padStart(2, "0")}</span>
        <div class="strat-b">
          <h3>${esc(x.title)}<span class="strat-k">${esc(x.kindLabel)}</span></h3>
          <ul class="strat-e">${x.basis.map((b) => "<li>" + esc(b) + "</li>").join("")}</ul>
          <p class="strat-a"><b>怎么做</b>${esc(x.action)}</p>
          <a class="strat-go" data-plan-link="1" data-strat="${esc(x.kind)}" href="${planHref(range, x.kind)}">按这个方案点 →</a>
        </div>
        <div class="strat-r">
          ${amount}
          <span class="strat-tag" data-conf="${x.confidence}">${esc(x.confidenceLabel)}</span>
          ${x.inRange !== null && x.perMonth !== null ? '<span class="strat-sub">该区间 ' + yuan(x.inRange) + "</span>" : ""}
        </div>
      </article>`;
    })
    .join("");

  return `<section class="sec rv" id="strategy">
    ${head}
    <p class="lead">不是泛泛的“多领券”，而是从你这段区间的订单结构里挑出还能改的地方。金额是该区间的可优化空间，月化为按同样节奏推算的一个月。</p>

    <div class="strat-head">
      <b>还可再省 ${headAmount}</b>
      <span>${strategyCaption(totals)}</span>
    </div>

    <div class="strats">${cards}</div>

    <p class="note">不同策略可能指向同一笔订单的不同环节（例如既没用券、单价也偏高），合计是<strong>上限估计</strong>；标注“一次性”的是券类机会，不做月化。</p>

    <p class="plan-link"><a data-plan-link="1" href="${planHref(range, null)}">这些方案落成订单是什么样 → 打开方案卡原型</a><span>原型用的是同一份账本数据：区间与策略一并带过去，价格按当前菜单现价估算，真实下单前须重新结算。</span></p>
  </section>`;
}

/* ============================ 8. 渲染：画像 ============================ */

function renderBars(title, entries, total) {
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return `<div class="mini">
    <div class="mini-h"><span>${esc(title)}</span><em>占比</em></div>
    <div class="rows">
      ${entries
        .map(
          ([k, v], i) => `<div class="row">
        <span class="row-k">${esc(k)}</span>
        <span class="row-t"><i style="--v:${(v / max).toFixed(3)};--d:${(i * 0.06).toFixed(2)}s"></i></span>
        <span class="row-v">${v}<em>${total > 0 ? ((v / total) * 100).toFixed(0) + "%" : ""}</em></span>
      </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

export function renderProfile(s, range) {
  const head =
    '<div class="sec-h"><span class="sec-n">§ 06</span><h2>你的消费画像</h2>' + rangeTag(range) + "</div>";

  if (s.orders === 0) {
    return '<section class="sec rv" id="profile">' + head +
      emptyBlock("这个区间没有完成的订单", "画像需要样本，换一个更长的区间。") +
      "</section>";
  }

  const total = s.orders || 1;
  const meal = Object.entries(s.mealPeriods).sort((a, b) => b[1] - a[1]);
  const channels = Object.entries(s.channels).sort((a, b) => b[1] - a[1]);
  const wdMax = Math.max(...s.weekday, 1);
  const hrMax = Math.max(...s.hour, 1);

  return `<section class="sec rv" id="profile">
    ${head}
    <p class="lead">不是给你贴标签，只是让前面的结论有依据。</p>

    <div class="cols cols-3">
      ${renderBars("时段分布", meal, total)}
      ${renderBars("渠道分布", channels.map(([k, v]) => [CHANNEL_CN[k] || k, v]), total)}

      <div class="mini">
        <div class="mini-h"><span>一周节奏</span><em>订单数</em></div>
        <div class="week">
          ${s.weekday
            .map(
              (v, i) => `<div class="wk">
            <span class="wk-bar" style="--h:${(v === 0 ? 2 : 10 + (v / wdMax) * 90).toFixed(1)}%;--d:${(i * 0.05).toFixed(2)}s"><i>${v}</i></span>
            <span class="wk-l">${WEEKDAY_SHORT[i] || ""}</span>
          </div>`,
            )
            .join("")}
        </div>
      </div>
    </div>

    <div class="cols cols-wide" style="margin-top:26px">
      <div class="mini">
        <div class="mini-h"><span>一天里什么时候下单</span><em>按小时</em></div>
        <div class="hours">
          ${s.hour
            .map(
              (v, i) =>
                '<span class="hr' + (v === 0 ? " hr0" : "") + '" style="--h:' +
                (v === 0 ? 0 : 8 + (v / hrMax) * 92).toFixed(1) + "%;--d:" + (i * 0.014).toFixed(2) + "s" +
                (v === hrMax && v > 0 ? ";--peak:1" : "") + '" title="' + i + ":00 · " + v + ' 笔"></span>',
            )
            .join("")}
        </div>
        <div class="hours-x"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
        ${s.maxTicket ? '<p class="mini-f">最贵的一单 ' + yuan(s.maxTicket.paid) + "　·　" + esc(s.maxTicket.date) + "</p>" : ""}
      </div>

      <div class="mini">
        <div class="mini-h"><span>最常点</span><em>份数</em></div>
        ${
          s.topItems.length === 0
            ? '<p class="muted" style="padding:12px 0">订单里还没有可识别的商品。</p>'
            : '<ol class="tops">' +
              s.topItems
                .map(
                  (it, idx) =>
                    '<li><span class="tops-i">' + String(idx + 1).padStart(2, "0") + '</span><span class="tops-n">' +
                    esc(it.name) + "</span><b>×" + it.quantity + "</b></li>",
                )
                .join("") +
              "</ol>"
        }
      </div>
    </div>
  </section>`;
}

/* ============================ 9. 渲染：分享 ============================ */

export function shareText(s, range) {
  const saved =
    s.saved === null
      ? ""
      : "，省下 " + yuan(s.saved) + (s.savedRate === null ? "" : "（原价的 " + (s.savedRate * 100).toFixed(0) + "%）");
  return (
    "麦麦账本 ｜ " + range.from + " 至 " + range.to + " ｜ " + s.orders + " 笔订单实付 " + yuan(s.paid) + saved + "。"
  );
}

export function renderShare(s, strats, range) {
  const totals = strategyTotals(strats);
  const canSave =
    totals.perMonth > 0 ? yuan(totals.perMonth) : totals.oneOff > 0 ? yuan(totals.oneOff) : "—";
  const text = shareText(s, range);

  return `<section class="sec rv" id="share">
    <div class="sec-h"><span class="sec-n">§ 08</span><h2>带走这张卡</h2>${rangeTag(range)}</div>
    <p class="lead">截图或复制文案都行。卡上只有汇总数字，不含任何订单明细。</p>

    <div class="share-lay">
      <div class="tilt">
        <div class="tilt-inner">
          <div class="card3d" id="card3d">
            <div class="card-hd">
              <span class="card-b">MCD LEDGER</span>
              <span class="card-p">${esc(range.from)} — ${esc(range.to)}</span>
            </div>
            <div class="card-main">
              <span class="card-l">这段时间省下来的钱</span>
              <span class="card-n">${s.saved === null ? "—" : yuan(s.saved)}</span>
              <span class="card-r">原价的 ${s.savedRate === null ? "—" : (s.savedRate * 100).toFixed(0) + "%"}</span>
            </div>
            <div class="card-row">
              <div><b>${yuan(s.paid)}</b><span>实付</span></div>
              <div><b>${s.orders}</b><span>笔订单</span></div>
              <div><b class="gold">${canSave}</b><span>还能再省</span></div>
            </div>
            <div class="card-f">
              <span class="card-sign">mcd-ledger · 非官方作品</span>
              <span class="stamp-mark">对账无误<i>AUDITED</i></span>
            </div>
          </div>
        </div>
      </div>

      <div class="share-act">
        <p class="share-tip">把鼠标移到卡片上，它会跟着倾斜——这是纯 CSS 3D 变换，没有 WebGL，也不额外加载任何东西。</p>
        <div class="share-btns">
          <button class="btn btn-gold" type="button" data-copy="${esc(text)}" data-ok="分享文案已复制">复制分享文案</button>
          <button class="btn" type="button" data-print="1">打印 / 存为 PDF</button>
        </div>
        <pre class="share-pre" aria-label="分享文案预览">${esc(text)}</pre>
      </div>
    </div>
  </section>`;
}

/* ============================ 10. 组装 ============================ */

function moneyCell(value, dec) {
  return '<span data-count="' + value.toFixed(2) + '" data-dec="' + dec + '" data-pre="¥">' + yuan(value) + "</span>";
}

function countAttrs(value) {
  if (value === null) return "";
  return 'data-count="' + value.toFixed(2) + '" data-dec="2" data-pre="¥"';
}

/* ============================ 5. 方案求解 ============================ */
/**
 * 把"过去常点什么"变成"下一单怎么买最省"。
 *
 * 为什么放在引擎里而不是渲染层：
 *   方案的每一个数字都随区间变——换区间就是换一批常点商品、换一批可用券、
 *   换一张回本线。如果这份逻辑只跑在服务端，原型页就只能展示固定数字；
 *   放在引擎里，浏览器切区间时调用的是同一段代码，不可能对不上。
 *
 * 口径声明（重要，别在别处重复解释）：
 *   — 所有价格来自账本事实表里的菜单现价（menu.p）与划线价（menu.o），
 *     原型**不联网、不调用 calculate-price**，所以它是"按当前菜单的估算"，
 *     真实下单前必须重算（界面上 S4 降级态讲的就是这件事）。
 *   — 券的抵扣额取 TS 侧算好的 worth（券名 × 菜单现价匹配只做一次，不留第二份）。
 */

/** 券名 → 商品关键词：去掉"11.9元"这类前缀和"券"字 */
function couponKeyword(name) {
  const s = String(name || "").replace(/^\s*\d+(\.\d+)?\s*元\s*/, "").replace(/券$/, "").trim();
  return s.length >= 2 ? s : null;
}

/** 关键词是否命中商品名：按顺序的覆盖度（"麦辣鸡腿堡" 能命中 "麦辣鸡腿汉堡"） */
function covers(key, name) {
  const k = String(key || "");
  const n = String(name || "");
  if (!k || !n) return 0;
  if (n.indexOf(k) >= 0) return 1;
  let i = 0;
  let hit = 0;
  for (const ch of k) {
    const at = n.indexOf(ch, i);
    if (at >= 0) {
      hit += 1;
      i = at + 1;
    }
  }
  return hit / k.length;
}

/** 券是否已过期（validTo 为空视为长期有效） */
function couponAlive(c, nowMs) {
  if (!c || !c.validTo) return true;
  const t = Date.parse(String(c.validTo).replace(" ", "T"));
  if (Number.isNaN(t)) return true;
  return t >= nowMs;
}

/** 单张券在这件商品上能省多少：优先用审计层算好的 worth，兜底用券面价差 */
function couponOff(c, unit) {
  if (unit === null || unit === undefined) return 0;
  const price = c && c.price !== null && c.price !== undefined ? c.price : null;
  const byPrice = price === null ? null : money(unit - price);
  const raw = c && c.worth !== null && c.worth !== undefined ? c.worth : byPrice;
  if (raw === null || raw === undefined) return 0;
  return Math.max(0, Math.min(money(raw), money(unit)));
}

/** 常点商品：区间内出现次数最多的前 n 个 SKU */
function topSkus(rows, menu, n) {
  const freq = new Map();
  for (const r of rows) {
    for (const it of r.items || []) {
      const code = it[0];
      const qty = it[2] || 1;
      const unit = it[3];
      const cur = freq.get(code) || { code, name: it[1], count: 0, qty: 0, unit: null };
      cur.count += 1;
      cur.qty += qty;
      if (cur.unit === null && unit !== null && unit !== undefined) cur.unit = unit;
      freq.set(code, cur);
    }
  }
  return [...freq.values()]
    .map((x) => {
      const m = menu[x.code] || {};
      const unit = x.unit !== null && x.unit !== undefined ? x.unit : m.p;
      const list = m.o !== null && m.o !== undefined ? m.o : unit;
      return { code: x.code, name: x.name, count: x.count, qty: x.qty, unit, list };
    })
    .filter((x) => x.unit !== null && x.unit !== undefined)
    .sort((a, b) => b.count - a.count || b.qty - a.qty || b.unit - a.unit)
    .slice(0, n);
}

/** 找更便宜的同类买法：订单里出现过的、名字互相包含且更便宜的 SKU */
function cheaperAlt(item, seen) {
  let best = null;
  for (const s of seen) {
    if (s.code === item.code) continue;
    const rel =
      s.name.indexOf(item.name) >= 0 || item.name.indexOf(s.name) >= 0 ? 1 : covers(item.name, s.name);
    if (rel < 0.7) continue;
    if (s.unit >= item.unit) continue;
    const save = money(item.unit - s.unit);
    if (!best || save > best.save) best = { code: s.code, name: s.name, unit: s.unit, save };
  }
  return best;
}

/**
 * 求解一篮子方案。
 * @returns 见 range.d.mts 的 PlanData
 */
export function buildPlan(data, spec) {
  const range = resolveRange(typeof spec === "string" && spec ? spec : DEFAULT_RANGE, data.now, data.rows);
  const rows = completed(filterRows(data.rows || [], range));
  const menu = data.menu || {};
  const coupons = data.coupons || [];
  const nowMs = data.now;
  const days = Math.max(1, range.days || 1);

  const out = {
    ok: false,
    reason: null,
    spec: range.key === "custom" ? range.key : range.key,
    rangeKey: range.key,
    label: range.label,
    from: dateKey(range.fromMs),
    to: dateKey(range.toMs),
    days,
    orders: rows.length,
    basket: [],
    seen: [],
    store: null,
    methods: [],
    best: null,
    split: null,
    card: null,
    degrade: null,
    provenance: [],
  };

  if (rows.length === 0) {
    out.reason = "这个区间还没有已完成订单，换一个区间再试";
    return out;
  }

  // ① 常点商品（方案的主语）
  const basket = topSkus(rows, menu, 3);
  if (basket.length === 0) {
    out.reason = "这个区间的订单里没有可定价的商品，换一个区间再试";
    return out;
  }

  // ② 见过的全部 SKU（用于找"更便宜的买法"和售罄替代）
  const seen = topSkus(rows, menu, 40);

  const listTotal = money(sum(basket.map((b) => b.list)));
  const curTotal = money(sum(basket.map((b) => b.unit)));
  const promoSave = money(listTotal - curTotal);

  // ③ 可用券 × 常点商品的命中
  const hits = [];
  for (const c of coupons) {
    if (!couponAlive(c, nowMs)) continue;
    const kw = couponKeyword(c.name);
    if (!kw) continue;
    let best = null;
    let bestScore = 0;
    for (const b of basket) {
      const s = covers(kw, b.name);
      if (s > bestScore) {
        bestScore = s;
        best = b;
      }
    }
    if (!best || bestScore < 0.7) continue;
    const off = couponOff(c, best.unit);
    if (off <= 0) continue;
    hits.push({ coupon: c, item: best, off });
  }
  hits.sort((a, b) => b.off - a.off);

  const topCount = basket[0] ? basket[0].count : 0;
  out.confidence = topCount >= 4 ? "high" : topCount >= 2 ? "medium" : "low";
  out.confidenceNote =
    out.confidence === "high"
      ? "这个组合在区间内出现了 " + topCount + " 次，是稳定的老样子"
      : out.confidence === "medium"
        ? "这个组合在区间内只出现 " + topCount + " 次，参考为主"
        : "区间内订单太少，每件都只出现过 1 次 —— 这是「最近点过」，还算不上老样子";

  out.ok = true;
  out.basket = basket.map((b) => ({
    code: b.code,
    name: b.name,
    count: b.count,
    unit: money(b.unit),
    list: money(b.list),
  }));
  out.seen = seen.map((s) => ({ code: s.code, name: s.name, unit: money(s.unit) }));

  // 常去门店：区间内订单数最多的那家
  const storeCount = new Map();
  for (const r of rows) {
    if (!r.st) continue;
    storeCount.set(r.st, (storeCount.get(r.st) || 0) + 1);
  }
  const storeTop = [...storeCount.entries()].sort((a, b) => b[1] - a[1])[0];
  out.store = storeTop ? { name: storeTop[0], orders: storeTop[1] } : null;

  const itemsOf = (list) => list.map((b) => ({ n: b.name + " ×1", p: money(b.unit) }));
  const meta = "外带 · 门店自取 · 约 10 分钟";

  // ④ 买法一：单点现价（不用券）
  out.methods.push({
    id: "plain",
    name: "常点组合 · 单点",
    meta,
    items: itemsOf(basket),
    coupon: null,
    original: listTotal,
    total: curTotal,
    saved: promoSave,
    badge: null,
    tip:
      promoSave > 0
        ? "菜单现价已含促销，这部分不需要你做任何操作"
        : "这几件商品当前没有促销价，省钱的唯一入口是券",
    points: [],
  });

  // ⑤ 买法二：合单用券（一单只能用一张券，取抵扣最大的那张）
  if (hits.length > 0) {
    const h = hits[0];
    const total = money(curTotal - h.off);
    out.methods.push({
      id: "coupon",
      name: "常点组合 · 用券",
      meta,
      items: itemsOf(basket),
      coupon: { name: "券 · " + h.coupon.name, off: h.off },
      original: listTotal,
      total,
      saved: money(listTotal - total),
      badge: null,
      tip: "券与商品绑定，替换这件商品后优惠失效",
      points: [
        "券「" + h.coupon.name + "」绑定在" + h.item.name + "上，券价 ¥" + h.coupon.price + "、现价 ¥" + money(h.item.unit),
        "一单只能用一张券；剩下的券要靠拆单才能用上",
      ],
    });

    /*
     * ⑥ 拆单：一单只能用一张券，所以"第二张券"只能靠第二单用掉。
     *   注意这里**不要求第二张券一定命中**——算出来不省也是结论，
     *   界面要能回答"我拆开到底图什么"，答案是"图不到，别拆"。
     */
    const second = hits.find((x) => x.item.code !== h.item.code) || null;
    const rest = basket.filter((b) => b.code !== h.item.code);
    if (rest.length > 0 && h.item.code !== null) {
      const o1Total = money(h.item.unit - h.off);
      const o2List = money(sum(rest.map((b) => b.unit)));
      const o2Total = money(o2List - (second ? second.off : 0));
      const total = money(o1Total + o2Total);
      const singleTotal = out.methods[out.methods.length - 1].total;
      const delta = money(singleTotal - total);
      out.split = {
        orders: [
          {
            label: "单 1 · " + h.item.name,
            items: [{ n: h.item.name + " ×1", p: money(h.item.unit) }],
            coupon: { name: "券 · " + h.coupon.name, off: h.off },
            total: o1Total,
          },
          {
            label: "单 2 · " + rest.map((b) => b.name).join(" + "),
            items: rest.map((b) => ({ n: b.name + " ×1", p: money(b.unit) })),
            coupon: second ? { name: "券 · " + second.coupon.name, off: second.off } : null,
            total: o2Total,
          },
        ],
        total,
        delta,
        worthy: delta >= 5,
        secondCoupon: !!second,
        note: !second
          ? "第二张券用不上这些商品，拆开不省，还多一个取餐码"
          : delta >= 5
            ? "多省 ¥" + delta.toFixed(2) + " · 代价是多 1 个取餐码"
            : delta > 0
              ? "只多省 ¥" + delta.toFixed(2) + "，不足 ¥5，不值得多跑一趟"
              : "拆开并不更省，还会多一个取餐码，建议合单",
      };
    }
  }

  // ⑦ 买法三：更便宜的同类买法（组合/套餐替代单品）
  for (const b of basket) {
    const alt = cheaperAlt(b, seen);
    if (!alt || alt.save < 0.5) continue;
    const items = basket.map((x) =>
      x.code === b.code
        ? { n: alt.name + " ×1 · 替代" + b.name, p: money(alt.unit), swapped: true }
        : { n: x.name + " ×1", p: money(x.unit) },
    );
    const total = money(curTotal - alt.save);
    out.methods.push({
      id: "alt:" + b.code,
      name: "换成" + alt.name,
      meta,
      items,
      coupon: null,
      original: listTotal,
      total,
      saved: money(listTotal - total),
      badge: "更便宜",
      tip: "同类商品里更低的买法，餐品会变，介意口感就别换",
      points: [alt.name + " ¥" + money(alt.unit) + " vs " + b.name + " ¥" + money(b.unit) + "，每件省 ¥" + alt.save.toFixed(2)],
    });
    break; // 只推最划算的一处替换，多了就变成菜单浏览
  }

  // ⑧ 买卡：只有"随单购权益价"的商品才谈得上买卡（否则是帮商家卖卡）
  const cardItem = basket.find((b) => {
    const d = (menu[b.code] || {}).d;
    return typeof d === "string" && d.indexOf("随单购") >= 0 && b.list > b.unit;
  });
  if (cardItem) {
    const perSave = money(cardItem.list - cardItem.unit);
    const cardFee = 19; // 麦金卡月卡 ¥19（2026-10 实测）
    const breakEven = Math.ceil(cardFee / perSave);
    const perMonth = (cardItem.count * 30) / days;
    const netMonth = money(perSave * perMonth - cardFee);
    const single = money(cardItem.list - (cardItem.unit + cardFee)); // >0 = 这一单买卡就更省
    out.card = {
      item: { n: cardItem.name + " ×1", p: money(cardItem.unit) },
      cardFee: { n: "麦金卡月卡（30 天）×1", p: cardFee },
      withCard: money(cardItem.unit + cardFee),
      noCard: money(cardItem.list),
      single,
      perSave,
      breakEven,
      perMonth: Math.round(perMonth * 10) / 10,
      netMonth,
      verdict: netMonth > 0 ? "值" : "不值",
      text:
        "单笔：买卡 ¥" + money(cardItem.unit + cardFee) + " vs 不买卡 ¥" + money(cardItem.list) +
        (single > 0 ? "（这一单就省 ¥" + single.toFixed(2) + "）" : "（这一单贵 ¥" + (-single).toFixed(2) + "）") +
        "；按月：回本线 " + breakEven + " 次，你月化 " + (Math.round(perMonth * 10) / 10) + " 次，净省 ¥" + netMonth.toFixed(2),
    };
  }

  // ⑨ 售罄降级（S4）：最贵的那件换成同类替代，价差超阈值会要求重新确认
  const priciest = basket.slice().sort((a, b) => b.unit - a.unit)[0];
  const alt = priciest ? cheaperAlt(priciest, seen) : null;
  if (priciest && alt) {
    const delta = money(alt.unit - priciest.unit);
    const prevTotal =
      (out.methods.find((m) => m.id === "coupon") || out.methods[0]).total;
    out.degrade = {
      from: priciest.name,
      to: alt.name,
      delta,
      items: basket.map((x) =>
        x.code === priciest.code
          ? { n: alt.name + " ×1 · 替代" + priciest.name, p: money(alt.unit), swapped: true }
          : { n: x.name + " ×1", p: money(x.unit) },
      ),
      prevTotal,
      total: money(prevTotal + delta),
      threshold: 0.5,
    };
  }

  // ⑩ 最省方案
  const ranked = out.methods.slice().sort((a, b) => a.total - b.total);
  out.best = ranked[0] ? ranked[0].id : null;
  if (ranked[0]) ranked[0].badge = "最省";
  out.methods = ranked;

  // ⑪ 数字从哪来（评审时最常被问的一栏）
  out.provenance = [
    "常点商品：区间内 " + rows.length + " 笔已完成订单里出现次数最多的 " + basket.length + " 个 SKU",
    "价格：账本事实表里的菜单现价 / 划线价，原型不联网，真实下单前须重算",
    hits.length > 0
      ? "券：" +
        hits
          .slice(0, 2)
          .map((h) => "「" + h.coupon.name + "」最多省 ¥" + h.off.toFixed(2))
          .join("、")
      : "券：当前没有券能命中这几件商品",
    out.card ? "买卡：卡价 ¥19（实测），回本线按「单笔省额」反推" : "买卡：常点商品里没有随单购权益价，不做推荐",
  ];

  return out;
}

/**
 * 账本里的某条策略 → 原型里应该默认选中哪个买法。
 * 这是"从诊断跳到决策"要带的那个参数：点「时段 × 券」进来，就该先看到用券的方案。
 */
export function planFocus(plan, kind) {
  if (!plan || !plan.ok) return null;
  const best = plan.best || (plan.methods[0] ? plan.methods[0].id : null);
  const alt = plan.methods.find((m) => String(m.id).indexOf("alt:") === 0);
  const has = (id) => plan.methods.some((m) => m.id === id);
  switch (kind) {
    case "window":
    case "expiry":
    case "timing":
      return has("coupon") ? "coupon" : best;
    case "price":
      return alt ? alt.id : best;
    case "delivery":
      return best;
    default:
      return best;
  }
}

/**
 * 一次算出整个页面的"区间视图"。
 * 服务端首屏与浏览器切换区间走的是同一个函数——这是双端数字一致的根本保证。
 */
export function buildView(data, spec) {
  const range = resolveRange(spec, data.now, data.rows);
  const rows = filterRows(data.rows, range);
  const summary = summarize(rows, range);
  const strats = buildStrategies(summary, rows, data);
  return {
    spec: typeof spec === "string" ? spec : DEFAULT_RANGE,
    range,
    summary,
    strats,
    totals: strategyTotals(strats),
    html: {
      cover: renderOverview(summary, strats, range),
      flow: renderFlow(summary, range),
      attr: renderAttr(summary, range),
      strategy: renderStrategy(strats, summary, range),
      profile: renderProfile(summary, range),
      share: renderShare(summary, strats, range),
    },
  };
}
