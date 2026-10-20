/**
 * 契约校验：MCP 返回的是"业务 JSON"，字段可能缺失、可能是字符串数字、
 * 可能被包了一层 data.data。这一层的职责是：**要么得到干净数据，要么抛出带路径的错误**，
 * 绝不让 undefined 悄悄流进金额计算——那才是审计报告出错的真正来源。
 */

export class ContractError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ContractError";
    this.path = path;
  }
}

export function obj(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new ContractError(path, `期望 object，实际 ${describe(v)}`);
  }
  return v as Record<string, unknown>;
}

export function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ContractError(path, `期望 array，实际 ${describe(v)}`);
  return v;
}

export function str(v: unknown, path: string): string {
  if (typeof v !== "string") throw new ContractError(path, `期望 string，实际 ${describe(v)}`);
  return v;
}

export function optStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function num(v: unknown, path: string): number {
  const n = toNum(v);
  if (n === null) throw new ContractError(path, `期望 number，实际 ${describe(v)}`);
  return n;
}

export function optNum(v: unknown): number | null {
  return toNum(v);
}

/** 宽松数字解析：兼容 "9.9"、"¥9.9"、"9.90元"、"" */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[¥￥元,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 金额统一保留两位，避免 0.30000000000000004 这类浮点噪音进报告 */
export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 安全取子节点 */
export function dig(v: unknown, path: string[]): unknown {
  let cur: unknown = v;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") {
      throw new ContractError(path.join("."), "路径中断");
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * 解析 MCP 工具返回的文本。
 * 真实世界里的三种形态都要兜住：
 * 1. 纯 JSON
 * 2. ```json fenced 的 JSON
 * 3. 前后带说明文字、中间一段 JSON
 */
export function parseMcpText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") throw new ContractError("payload", "空响应");

  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试兜底路径 */
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* 继续 */
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = trimmed.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch {
      /* 落到抛错 */
    }
  }

  throw new ContractError("payload", `无法从响应中解析 JSON（前 80 字：${trimmed.slice(0, 80)}）`);
}

/**
 * 业务响应通常是 { success, code, message, data }。
 * 部分工具还会再包一层 data.data —— 统一在这里拆掉。
 */
export function unwrapBusiness(v: unknown): unknown {
  const root = obj(v, "$");
  if ("success" in root && root.success === false) {
    const msg = typeof root.message === "string" ? root.message : "业务失败";
    throw new ContractError("$.success", msg);
  }
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    // order-list 的形态：data.data.list
    if (d.data && typeof d.data === "object" && "list" in (d.data as object)) {
      return d.data;
    }
    if ("list" in d) return d;
  }
  return data ?? root;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
