#!/usr/bin/env node
/**
 * mcd-ledger CLI
 *
 *   mcd-ledger audit            对真实账号做一次消费审计
 *   mcd-ledger demo             用合成数据跑通全流程（无需 Token）
 *   mcd-ledger doctor           检查 MCP 连接与 Token 是否可用
 *   mcd-ledger bench            跑归因算法的回归用例
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAudit } from "./audit/pipeline.ts";
import { Cache } from "./mcp/cache.ts";
import { McpClient } from "./mcp/client.ts";
import { TraceRecorder } from "./runtime/trace.ts";
import { renderConsole } from "./render/console.ts";
import { renderHtml } from "./render/html.ts";
import { renderOrdersCsv } from "./render/csv.ts";
import { toDateKey } from "./audit/windows.ts";
import { DEFAULT_RANGE } from "./engine/range.mjs";
import type { AuditReport } from "./model/types.ts";

interface Args {
  command: string;
  demo: boolean;
  out: string | null;
  json: boolean;
  cache: boolean;
  verbose: boolean;
  days: number | undefined;
  range: string;
  maxStores: number;
}

const HELP = `
麦麦账本 mcd-ledger v0.2.0
你的麦当劳消费对账单：省了多少、漏了多少、下次何时买最划算。

用法
  mcd-ledger audit [选项]     对真实账号做审计（需要 MCD_MCP_TOKEN）
  mcd-ledger demo             用合成数据演示（不需要 Token）
  mcd-ledger doctor           检查 MCP 连接与工具可用性
  mcd-ledger bench            运行归因算法的回归用例

选项
  --out <dir>        输出目录（默认当前目录）
  --range <范围>     页面默认选中的区间：7d / 30d / 90d / all
                     也可以给自定义区间：2026-09-01..2026-10-01（默认 30d）
  --days <n>         只拉取最近 n 天的订单（减少 MCP 调用，与 --range 无关）
  --max-stores <n>   最多查询几个门店的菜单（默认 3，控制调用量）
  --json             把报告以 JSON 打印到 stdout
  --no-cache         禁用本地缓存
  --verbose          打印每一步 MCP 调用
  -h, --help         显示帮助

环境变量
  MCD_MCP_TOKEN      麦当劳 MCP Token（在 https://open.mcd.cn/mcp 申请）
  MCD_MCP_URL        自定义 MCP 地址（默认 https://mcp.mcd.cn）
  NO_COLOR           关闭彩色输出
`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "audit",
    demo: false,
    out: null,
    json: false,
    cache: true,
    verbose: false,
    days: undefined,
    range: DEFAULT_RANGE,
    maxStores: 3,
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case "-h":
      case "--help":
        args.command = "help";
        break;
      case "--json":
        args.json = true;
        break;
      case "--demo":
        args.demo = true;
        break;
      case "--no-cache":
        args.cache = false;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--out":
        args.out = argv[++i] ?? null;
        break;
      case "--days":
        args.days = Number(argv[++i] ?? "0") || undefined;
        break;
      case "--range":
        args.range = argv[++i] ?? DEFAULT_RANGE;
        break;
      case "--max-stores":
        args.maxStores = Math.max(1, Number(argv[++i] ?? "3") || 3);
        break;
      default:
        if (!a.startsWith("-")) rest.push(a);
    }
  }

  if (rest.length > 0) args.command = rest[0] ?? "audit";
  if (args.command === "demo") args.demo = true;
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    process.stdout.write(HELP);
    return;
  }

  if (args.command === "doctor") return doctor(args);
  if (args.command === "bench") return bench();

  if (args.command !== "audit" && args.command !== "demo") {
    process.stderr.write(`未知命令：${args.command}\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  if (!args.demo && !process.env.MCD_MCP_TOKEN) {
    process.stderr.write(
      [
        "",
        "  缺少 MCP Token。",
        "",
        "  1. 打开 https://open.mcd.cn/mcp 用手机号登录",
        "  2. 控制台 → 激活 → 复制 MCP Token",
        "  3. 设置环境变量：export MCD_MCP_TOKEN=<你的 token>",
        "",
        "  想先看看效果：mcd-ledger demo",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const outDir = resolve(args.out ?? process.cwd());
  const cache = new Cache(resolve(outDir, ".cache"), args.cache && !args.demo);

  const result = await runAudit({
    demo: args.demo,
    token: process.env.MCD_MCP_TOKEN,
    traceDir: resolve(outDir, ".trace"),
    cache,
    verbose: args.verbose,
    days: args.days,
    maxStores: args.maxStores,
    range: args.range,
  });

  const { report } = result;

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderConsole(report));
  }

  const stamp = toDateKey(new Date());
  const htmlPath = resolve(outDir, `mcd-ledger-${stamp}.html`);
  const csvPath = resolve(outDir, `mcd-ledger-${stamp}.csv`);
  const tracePath = result.trace.file;

  writeFileSync(htmlPath, renderHtml(report, result.view, result.ledger), "utf8");
  writeFileSync(csvPath, renderOrdersCsv(result.priced), "utf8");

  if (!args.json) {
    process.stdout.write(`  报告  ${htmlPath}\n`);
    process.stdout.write(`  明细  ${csvPath}\n`);
    process.stdout.write(`  轨迹  ${tracePath}\n\n`);
    process.stdout.write(`  ${summaryLine(report)}\n\n`);
  }
}

function summaryLine(report: AuditReport): string {
  const parts: string[] = [];
  parts.push(`${report.totals.completedOrders} 笔`);
  if (report.totals.saved !== null) parts.push(`省 ¥${report.totals.saved.toFixed(2)}`);
  if (report.leakTotal > 0) parts.push(`漏 ¥${report.leakTotal.toFixed(2)}`);
  return `完成：${parts.join(" · ")}　（trace ${report.quality.traceId}）`;
}

async function doctor(args: Args): Promise<void> {
  const token = process.env.MCD_MCP_TOKEN;
  if (!token) {
    process.stderr.write("MCD_MCP_TOKEN 未设置。\n");
    process.exitCode = 1;
    return;
  }

  const trace = new TraceRecorder(resolve(args.out ?? process.cwd(), ".trace"), "doctor", "live");
  const client = new McpClient({ token, trace, verbose: true });

  process.stdout.write("\n  正在检查麦当劳 MCP 连接…\n\n");

  const tools = await client.listTools();
  process.stdout.write(`  连接成功：${tools.length} 个工具可用\n\n`);
  const width = Math.max(...tools.map((t) => t.name.length));
  for (const tool of tools) {
    process.stdout.write(`  ${tool.name.padEnd(width)}  ${tool.description.slice(0, 60)}\n`);
  }

  const required = [
    "order-list",
    "query-meals",
    "query-my-coupons",
    "query-my-account",
    "campaign-calendar",
    "now-time-info",
  ];
  const available = new Set(tools.map((t) => t.name));
  const missing = required.filter((name) => !available.has(name));
  process.stdout.write("\n");
  if (missing.length > 0) {
    process.stdout.write(`  警告：缺失必需工具 ${missing.join("、")}\n\n`);
  } else {
    process.stdout.write("  必需工具齐全，可以运行 mcd-ledger audit\n\n");
  }
  process.stdout.write(`  轨迹 ${trace.file}\n\n`);
}

async function bench(): Promise<void> {
  const mod = await import("../bench/run.ts");
  const ok = await mod.runBench();
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`\n  执行失败：${msg}\n\n`);
  process.exitCode = 1;
});
