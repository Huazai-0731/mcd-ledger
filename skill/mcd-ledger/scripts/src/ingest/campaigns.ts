/**
 * 采集层：活动日历。
 *
 * campaign-calendar 返回的是"营销活动 + 日期"的混合文本，字段命名同样未公开，
 * 因此沿用宽容嗅探；但活动日期的价值很高：它是"下次什么时候买最划算"的唯一外部信号源。
 */
import { optStr } from "../runtime/contract.ts";
import type { Campaign, Degradation } from "../model/types.ts";

export interface CampaignsResult {
  campaigns: Campaign[];
  degradation: Degradation | null;
}

const TITLE_KEYS = [/^(title|activityname|name|campaignname|subject)$/i];
const DATE_KEYS = [/^(date|activitydate|startdate|day|time|begindate)$/i];
const BODY_KEYS = [/^(content|description|desc|intro|summary|detail|activitycontent)$/i];

export function parseCampaigns(payload: unknown, today: string): CampaignsResult {
  const rows = collectRows(payload);
  if (rows === null) {
    return {
      campaigns: [],
      degradation: {
        module: "活动日历",
        reason: "无法定位活动列表",
        impact: "「最佳购买窗口」只能依据券信息推断，缺少活动维度",
      },
    };
  }

  const campaigns: Campaign[] = [];
  for (const row of rows) {
    const title = pickString(row, TITLE_KEYS);
    if (!title) continue;
    const date =
      pickDate(row, DATE_KEYS) ??
      collectStrings(row).map((s) => normalizeDate(s)).find((d): d is string => d !== null) ??
      null;
    if (!date) continue;

    campaigns.push({
      title: title.slice(0, 80),
      date,
      summary: (pickString(row, BODY_KEYS) ?? "").slice(0, 300),
      kind: date === today ? "today" : date < today ? "past" : "upcoming",
    });
  }

  // 同一活动会出现在多个日期下，保留首条即可
  const seen = new Set<string>();
  const deduped = campaigns.filter((c) => {
    const key = `${c.date}|${c.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    campaigns: deduped.sort((a, b) => a.date.localeCompare(b.date)),
    degradation: null,
  };
}

/** 从活动正文里抽取"最佳购买窗口"，如 "10月8日 10:30 准时开售" */
export function extractSaleWindows(summary: string): string[] {
  const out: string[] = [];
  const re = /(\d{1,2}月\d{1,2}日)\s*(\d{1,2}:\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(summary)) !== null) {
    out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

function collectRows(payload: unknown): Record<string, unknown>[] | null {
  const arrays: unknown[][] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 5 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      if (v.some((x) => x && typeof x === "object" && !Array.isArray(x))) arrays.push(v);
      return;
    }
    for (const value of Object.values(v as Record<string, unknown>)) visit(value, depth + 1);
  };
  visit(payload, 0);

  const best = arrays.sort((a, b) => b.length - a.length)[0];
  if (!best) return null;
  return best
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
    .slice(0, 300);
}

function pickString(row: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (!patterns.some((p) => p.test(key))) continue;
    const s = optStr(value);
    if (s) return s;
  }
  return null;
}

function pickDate(row: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (!patterns.some((p) => p.test(key))) continue;
    const s = optStr(value);
    if (!s) continue;
    const d = normalizeDate(s);
    if (d) return d;
  }
  return null;
}

function collectStrings(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(row)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const i of v) if (typeof i === "string") out.push(i);
  }
  return out;
}

/** 统一成 yyyy-MM-dd，兼容 "2026年10月19日" / "2026-10-19" / "2026/10/19" */
export function normalizeDate(text: string): string | null {
  const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cn) return `${cn[1]}-${pad(cn[2] ?? "1")}-${pad(cn[3] ?? "1")}`;
  const iso = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(iso[2] ?? "1")}-${pad(iso[3] ?? "1")}`;
  return null;
}

function pad(v: string): string {
  return v.padStart(2, "0");
}
