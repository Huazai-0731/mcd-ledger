/**
 * 编排层：把 6 次 MCP 调用串成一条可审计的流水线。
 *
 * 每一步的失败都有明确的降级路径——
 * 「菜单拉不到」不该让整份报告崩掉，只该让归因覆盖率下降，并在报告里说清楚。
 */
import { McpClient } from "../mcp/client.ts";
import { Cache } from "../mcp/cache.ts";
import { TraceRecorder } from "../runtime/trace.ts";
import { parseOrders } from "../ingest/orders.ts";
import { mergeMenus, parseMenu } from "../ingest/menu.ts";
import { parseCoupons } from "../ingest/coupons.ts";
import { parseOrderDetail } from "../ingest/orderDetail.ts";
import { derivePointsRatio, parsePoints } from "../ingest/points.ts";
import { parseCampaigns } from "../ingest/campaigns.ts";
import { priceOrder } from "../model/pricing.ts";
import { summarizeAttribution } from "../audit/attribution.ts";
import { detectLeaks } from "../audit/detectors.ts";
import { buildReport, toDateKey } from "../audit/report.ts";
import { demoCampaigns, demoCoupons, demoPoints, DEMO_MENU, generateDemoOrders } from "../demo/fixtures.ts";
import type {
  AuditReport,
  Campaign,
  Coupon,
  Degradation,
  MenuItem,
  MenuSnapshot,
  Order,
  OrderDetail,
  PointsAccount,
  PricedOrder,
} from "../model/types.ts";

export interface RunOptions {
  demo: boolean;
  token?: string;
  traceDir: string;
  cache: Cache;
  verbose: boolean;
  /** 只审计最近 N 天 */
  days?: number;
  /** 最多查几个门店的菜单（控制调用量） */
  maxStores?: number;
  /** 最多拉取多少笔订单详情（订单详情会永久缓存） */
  maxDetails?: number;
}

export interface RunResult {
  report: AuditReport;
  priced: PricedOrder[];
  orders: Order[];
  trace: TraceRecorder;
}

const MENU_TTL = 6 * 3600_000;
const CAMPAIGN_TTL = 2 * 3600_000;

export async function runAudit(opts: RunOptions): Promise<RunResult> {
  const trace = new TraceRecorder(opts.traceDir, opts.demo ? "demo" : "audit", opts.demo ? "demo" : "live");
  const degradations: Degradation[] = [];

  let orders: Order[] = [];
  let menu: Record<string, MenuItem> = {};
  let coupons: Coupon[] = [];
  let points: PointsAccount | null = null;
  let campaigns: Campaign[] = [];
  let now = new Date();

  if (opts.demo) {
    orders = generateDemoOrders(now);
    menu = DEMO_MENU;
    coupons = demoCoupons(now);
    points = demoPoints();
    campaigns = demoCampaigns(now);
    trace.note("demo", `使用合成数据：${orders.length} 笔订单，${Object.keys(menu).length} 个 SKU`);
  } else {
    if (!opts.token) throw new Error("缺少 MCP Token：请设置环境变量 MCD_MCP_TOKEN");
    const client = new McpClient({ token: opts.token, trace, verbose: opts.verbose });

    // 1) 基准时间：用服务端时间，避免本机时区/时钟漂移导致"今日券"判断错位
    now = await fetchServerTime(client, trace) ?? now;

    // 2) 历史订单（结论的主体，永不缓存）
    const ordersPayload = await callOrDegrade(client, trace, "order-list", {}, "历史订单", degradations);
    const parsedOrders = parseOrders(ordersPayload ?? {});
    orders = parsedOrders.orders;
    if (parsedOrders.degradation) degradations.push(parsedOrders.degradation);

    if (opts.days && opts.days > 0) {
      const cutoff = now.getTime() - opts.days * 86_400_000;
      orders = orders.filter((o) => o.createdAtMs >= cutoff);
    }

    // 2.5) 逐单详情：归因的权威来源。详情不会变化，按 orderId 永久缓存。
    const detailTargets = orders
      .filter((o) => o.status === "completed")
      .slice(0, opts.maxDetails ?? 60);
    let detailFetched = 0;
    let detailFailed = 0;
    for (const order of detailTargets) {
      const key = `order:${order.orderId}`;
      const cachedDetail = opts.cache.get<OrderDetail>(key, Number.MAX_SAFE_INTEGER);
      if (cachedDetail) {
        order.detail = cachedDetail;
        continue;
      }
      try {
        const payload = await client.callToolSafe("query-order", { orderId: order.orderId }, 2);
        const detail = parseOrderDetail(payload, order.orderId);
        if (detail) {
          order.detail = detail;
          opts.cache.set(key, detail);
          detailFetched += 1;
        } else {
          order.detail = null;
          detailFailed += 1;
        }
      } catch (err) {
        order.detail = null;
        detailFailed += 1;
        trace.note(
          "degraded",
          `query-order ${order.orderId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    trace.note("detail", `拉取 ${detailFetched} 笔，失败 ${detailFailed} 笔，命中缓存 ${detailTargets.length - detailFetched - detailFailed} 笔`);
    if (detailFailed > 0) {
      degradations.push({
        module: "订单详情",
        reason: `${detailFailed} 笔订单详情获取失败`,
        impact: "这些订单只计入实付总额，不参与「省了多少」统计",
      });
    }

    // 3) 门店菜单（价格字典）：只查最近消费过的门店，控制调用量
    const storeCodes = [...new Set(orders.filter((o) => o.status === "completed").map((o) => o.storeCode))]
      .filter((c) => c !== "")
      .slice(0, opts.maxStores ?? 3);

    const snapshots: MenuSnapshot[] = [];
    for (const storeCode of storeCodes) {
      const key = `menu:${storeCode}:1:1`;
      const cached = opts.cache.get<MenuSnapshot>(key, MENU_TTL);
      if (cached) {
        snapshots.push(cached);
        trace.note("cache-hit", `menu ${storeCode}`);
        continue;
      }
      const payload = await callOrDegrade(
        client,
        trace,
        "query-meals",
        { storeCode, orderType: 1, beType: 1 },
        `门店菜单 ${storeCode}`,
        degradations,
      );
      if (payload === null) continue;
      const parsed = parseMenu(payload, storeCode);
      if (parsed.snapshot) {
        snapshots.push(parsed.snapshot);
        opts.cache.set(key, parsed.snapshot);
      }
      if (parsed.degradation) degradations.push(parsed.degradation);
    }
    menu = mergeMenus(snapshots);

    // 4) 卡包券
    const couponPayload = await callOrDegrade(
      client,
      trace,
      "query-my-coupons",
      { page: "1", pageSize: "200" },
      "优惠券",
      degradations,
    );
    if (couponPayload !== null) {
      const parsed = parseCoupons(couponPayload);
      coupons = parsed.coupons;
      if (parsed.degradation) degradations.push(parsed.degradation);
    }

    // 5) 积分账户 + 商城（推导积分兑元比）
    const pointsPayload = await callOrDegrade(client, trace, "query-my-account", {}, "积分账户", degradations);
    if (pointsPayload !== null) {
      const parsed = parsePoints(pointsPayload);
      points = parsed.account;
      if (parsed.degradation) degradations.push(parsed.degradation);
    }

    const mallPayload = opts.cache.get<unknown>("mall", 24 * 3600_000) ??
      (await callOrDegrade(client, trace, "mall-points-products", {}, "积分商城", []));
    if (mallPayload && mallPayload !== null) {
      opts.cache.set("mall", mallPayload);
      const ratio = derivePointsRatio(mallPayload);
      if (points) {
        points.pointsPerYuan = ratio.pointsPerYuan;
        points.ratioEstimated = ratio.estimated;
      }
      trace.note("points-ratio", `${ratio.pointsPerYuan} 积分/元，样本 ${ratio.samples}，估算=${ratio.estimated}`);
    }

    // 6) 活动日历
    const cachedCampaigns = opts.cache.get<Campaign[]>("campaigns", CAMPAIGN_TTL);
    if (cachedCampaigns) {
      campaigns = cachedCampaigns;
      trace.note("cache-hit", "campaigns");
    } else {
      const payload = await callOrDegrade(client, trace, "campaign-calendar", {}, "活动日历", degradations);
      if (payload !== null) {
        const parsed = parseCampaigns(payload, toDateKey(now));
        campaigns = parsed.campaigns;
        opts.cache.set("campaigns", campaigns);
        if (parsed.degradation) degradations.push(parsed.degradation);
      }
    }
  }

  const priced = orders.map((o) => priceOrder(o, menu));
  const attribution = summarizeAttribution(priced.filter((p) => p.order.status === "completed"));

  const leaks = detectLeaks({
    orders,
    coupons,
    points,
    menu,
    now,
    attributionGap: attribution.gap,
    unresolvedOrders: priced.filter((p) => p.order.status === "completed" && p.coverage < 1).length,
  });

  const report = buildReport({
    orders,
    priced: priced.filter((p) => p.order.status === "completed"),
    attribution,
    leaks,
    points,
    coupons,
    campaigns,
    menu,
    degradations,
    now,
    trace: { traceId: trace.id, toolCalls: trace.toolCalls, durationMs: trace.durationMs },
    pointsPerYuan: points?.pointsPerYuan ?? 100,
    demo: opts.demo,
  });

  return { report, priced, orders, trace };
}

/** 工具调用失败 → 记录降级，返回 null，不中断流水线 */
async function callOrDegrade(
  client: McpClient,
  trace: TraceRecorder,
  tool: string,
  args: Record<string, unknown>,
  module: string,
  degradations: Degradation[],
): Promise<unknown> {
  try {
    return await client.callToolSafe(tool, args);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    trace.note("degraded", `${tool}: ${reason}`);
    degradations.push({ module, reason: reason.slice(0, 200), impact: "相关模块降级为「数据不足」" });
    return null;
  }
}

async function fetchServerTime(client: McpClient, trace: TraceRecorder): Promise<Date | null> {
  try {
    const payload = await client.callToolSafe("now-time-info", {});
    const text = JSON.stringify(payload);
    const m = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const ms = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ).getTime();
    return Number.isFinite(ms) ? new Date(ms) : null;
  } catch (err) {
    trace.note("degraded", `now-time-info: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
