/**
 * 麦当劳 MCP Server 客户端（Streamable HTTP，零依赖）。
 *
 * 为什么不用官方 SDK：
 * 1. 审计场景只需要 initialize / tools/list / tools/call 三个方法；
 * 2. 零依赖意味着 `node src/cli.ts` 就能跑，不需要 build、不需要装包；
 * 3. 需要在 client 层直接记录 trace 与限流，SDK 反而多一层胶水。
 *
 * 协议要点（MCP 2025-06-18）：
 *   POST {url}
 *   headers: Authorization: Bearer <token> / Accept: application/json, text/event-stream
 *   首次 initialize 后，从响应头 `mcp-session-id` 取会话号，后续请求带上。
 */
import { HttpError, RateLimiter, withRetry } from "../runtime/retry.ts";
import { ContractError, arr, obj, optStr, parseMcpText, str } from "../runtime/contract.ts";
import type { TraceRecorder } from "../runtime/trace.ts";

export const MCD_MCP_URL = "https://mcp.mcd.cn";
const PROTOCOL_VERSION = "2025-06-18";

export interface McpClientOptions {
  url?: string;
  token: string;
  trace?: TraceRecorder;
  limiter?: RateLimiter;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpClient {
  private readonly url: string;
  private readonly token: string;
  private readonly trace: TraceRecorder | undefined;
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  private readonly verbose: boolean;

  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;
  private nextId = 1;
  private ready = false;

  constructor(opts: McpClientOptions) {
    this.url = opts.url ?? process.env.MCD_MCP_URL ?? MCD_MCP_URL;
    this.token = opts.token;
    this.trace = opts.trace;
    this.limiter = opts.limiter ?? new RateLimiter(500, 60_000);
    this.timeoutMs = opts.timeoutMs ?? 25_000;
    this.verbose = opts.verbose ?? false;
  }

  get session(): string | null {
    return this.sessionId;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    const result = obj(
      await this.rpc(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { roots: { listChanged: false } },
          clientInfo: { name: "mcd-ledger", version: "0.1.0" },
        },
        { traceAs: "initialize" },
      ),
      "$.result",
    );
    const negotiated = optStr(result.protocolVersion);
    if (negotiated) this.protocolVersion = negotiated;

    // 通知服务端初始化完成（无 id，不等待业务结果）
    await this.notify("notifications/initialized");
    this.ready = true;
    this.log(`已连接 ${this.url}（协议 ${this.protocolVersion}，会话 ${this.sessionId ?? "无"}）`);
  }

  async listTools(): Promise<ToolInfo[]> {
    await this.initialize();
    const result = obj(await this.rpc("tools/list", {}, { traceAs: "tools/list" }), "$.result");
    return arr(result.tools, "$.result.tools").map((t, i) => {
      const tool = obj(t, `$.result.tools[${i}]`);
      return { name: str(tool.name, "name"), description: optStr(tool.description) ?? "" };
    });
  }

  /** 调用工具并返回解析后的业务 JSON */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.initialize();
    const result = obj(
      await this.rpc("tools/call", { name, arguments: args }, { traceAs: name }),
      "$.result",
    );

    if (result.isError === true) {
      const msg = extractText(result) ?? "工具返回错误";
      throw new ContractError(name, msg.slice(0, 300));
    }

    // 优先结构化内容，其次文本
    const structured = result.structuredContent;
    if (structured && typeof structured === "object") return structured;

    const text = extractText(result);
    if (text === null) {
      throw new ContractError(name, "工具没有返回文本内容");
    }
    return parseMcpText(text);
  }

  /** 带重试与限流的工具调用 */
  async callToolSafe(
    name: string,
    args: Record<string, unknown> = {},
    attempts = 3,
  ): Promise<unknown> {
    return withRetry(
      async (attempt) => {
        await this.limiter.acquire();
        const end = this.trace?.begin(name, attempt);
        try {
          const data = await this.callTool(name, args);
          end?.({ ok: true, bytes: approximateBytes(data) });
          return data;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          end?.({ ok: false, error: error.message.slice(0, 200) });
          throw error;
        }
      },
      {
        attempts,
        onRetry: (info) => {
          this.trace?.note(
            "retry",
            `${name} 第 ${info.attempt} 次失败后 ${Math.round(info.delayMs)}ms 重试：${info.error.message.slice(0, 120)}`,
          );
          this.log(`重试 ${name}（${Math.round(info.delayMs)}ms 后，第 ${info.attempt + 1} 次）`);
        },
      },
    );
  }

  private async rpc(
    method: string,
    params: unknown,
    opts: { traceAs?: string; expectNoContent?: boolean } = {},
  ): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    const res = await this.post(body, opts.traceAs ?? method);
    if (res.status === 202 || res.status === 204) return {};

    const payload = await this.readPayload(res);
    const message = pickMessage(payload, id);

    if (message.error) {
      throw new ContractError(
        opts.traceAs ?? method,
        `JSON-RPC ${message.error.code}: ${message.error.message}`,
      );
    }
    // 只返回 result 载荷，调用方直接面对业务字段
    return message.result;
  }

  private async notify(method: string): Promise<void> {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params: {} });
    const res = await this.post(body, method, true);
    // 通知不保证有响应体，读掉避免连接悬挂
    await res.text().catch(() => "");
  }

  private async post(
    body: string,
    label: string,
    isNotification = false,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.token}`,
      "mcp-protocol-version": this.protocolVersion,
      "user-agent": "mcd-ledger/0.1.0",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpError(0, `请求 ${label} 失败：${msg}`);
    }

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const hint =
        res.status === 401
          ? "（MCP Token 无效或已过期，请检查 MCD_MCP_TOKEN）"
          : res.status === 429
            ? "（触发限流 600 次/分钟）"
            : "";
      throw new HttpError(
        res.status,
        `${label} 返回 HTTP ${res.status}${hint}：${text.slice(0, 200)}`,
        retryAfter,
      );
    }

    if (isNotification) return res;
    return res;
  }

  private async readPayload(res: Response): Promise<unknown> {
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();

    if (contentType.includes("text/event-stream")) {
      const messages = parseSse(raw);
      if (messages.length === 0) {
        throw new ContractError("sse", "事件流中没有 JSON-RPC 消息");
      }
      return messages;
    }

    if (raw.trim() === "") return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new ContractError("payload", `响应不是合法 JSON：${raw.slice(0, 120)}`);
    }
  }

  private log(msg: string): void {
    if (this.verbose) process.stderr.write(`  · ${msg}\n`);
  }
}

/** 从 SSE 文本中提取所有 data: 负载 */
function parseSse(raw: string): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const joined = dataLines.join("\n").trim();
    if (joined === "" || joined === "[DONE]") continue;
    try {
      out.push(JSON.parse(joined) as JsonRpcMessage);
    } catch {
      /* 非 JSON 事件（如 ping）直接忽略 */
    }
  }
  return out;
}

/** 在可能的多条消息里挑出与请求 id 匹配的那条 */
function pickMessage(payload: unknown, id: number): JsonRpcMessage {
  if (Array.isArray(payload)) {
    const list = payload as JsonRpcMessage[];
    const match = list.find((m) => m && m.id === id) ?? list.find((m) => m && m.id !== undefined);
    if (!match) throw new ContractError("sse", `未收到 id=${id} 的响应`);
    return match;
  }
  const single = payload as JsonRpcMessage;
  if (single && typeof single === "object" && "jsonrpc" in single) return single;
  return { result: payload };
}

function extractText(result: Record<string, unknown>): string | null {
  const content = result.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.text === "string") parts.push(c.text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function approximateBytes(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}
