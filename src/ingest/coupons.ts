/**
 * 采集层：优惠券。
 *
 * query-my-coupons 的官方文档只说明了"返回用户拥有的券"，
 * 没有公开字段名，因此这里采用**字段嗅探 + 有效期字符串解析**的宽容策略：
 * 只要能识别出「券名 / 用券价 / 生效窗口 / 渠道」，就能进入漏损与窗口计算；
 * 识别失败时返回 degradation，而不是假装没有券（假装没券会把"漏损"算错）。
 */
import { optStr, toNum } from "../runtime/contract.ts";
import type { Coupon, Degradation } from "../model/types.ts";

export interface CouponsResult {
  coupons: Coupon[];
  degradation: Degradation | null;
}

const NAME_KEYS = [/^(couponname|couponnamecn|name|title|coupontitle|productname)$/i];
const PRICE_KEYS = [
  /^(couponprice|saleprice|discountprice|price|salenum|amount|value|parvalue)$/i,
];

export function parseCoupons(payload: unknown): CouponsResult {
  const rows = collectRows(payload);
  if (rows === null) {
    return {
      coupons: [],
      degradation: {
        module: "优惠券",
        reason: "无法从响应中定位券列表",
        impact: "不计入「即将过期券」漏损，购买窗口日历将缺少券信息",
      },
    };
  }

  const coupons: Coupon[] = [];
  rows.forEach((row, index) => {
    const strings = collectStrings(row);
    const name =
      pickString(row, NAME_KEYS) ??
      strings.find((s) => !isDateLike(s) && s.length >= 2 && s.length <= 40) ??
      null;
    if (!name) return;

    const window = strings.map(parseWindow).find((w) => w !== null) ?? null;
    const price = pickNumber(row, PRICE_KEYS) ?? pickPriceFromStrings(strings);

    coupons.push({
      id: `coupon-${index}`,
      name,
      price,
      validFrom: window?.from ?? null,
      validTo: window?.to ?? null,
      weekdays: window?.weekdays ?? [],
      startTime: window?.startTime ?? null,
      endTime: window?.endTime ?? null,
      channels: strings.filter((s) => /到店|外送|得来速|麦乐送/.test(s)).slice(0, 3),
      tags: strings.filter((s) => /今日到期|即将到期|限时|专享|新品/.test(s)).slice(0, 3),
    });
  });

  return {
    coupons,
    degradation:
      coupons.length === 0 && rows.length > 0
        ? {
            module: "优惠券",
            reason: `识别到 ${rows.length} 条记录但没有可用券名`,
            impact: "券相关漏损与窗口不可用",
          }
        : null,
  };
}

/* ------------------------------- 有效期解析 ------------------------------- */

const DATE_RANGE =
  /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2})\s*[-~～至]\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2})/;

interface Window {
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
}

/**
 * 例："2026-10-20 05:00-2026-10-20 10:29 周二 05:00-10:29"
 * 同时兼容 "周一、二、三、四、五 10:30-23:59" 这种只给星期的写法。
 */
export function parseWindow(text: string): Window | null {
  const m = text.match(DATE_RANGE);
  const weekdays = parseWeekdays(text);
  const dailyRange = text.match(/(\d{1,2}:\d{2})\s*[-~～至]\s*(\d{1,2}:\d{2})/);

  if (!m) {
    if (weekdays.length === 0) return null;
    return {
      from: "",
      to: "",
      startTime: dailyRange?.[1] ?? "00:00",
      endTime: dailyRange?.[2] ?? "23:59",
      weekdays,
    };
  }

  const [, y1, m1, d1, t1, y2, m2, d2, t2] = m;
  return {
    from: `${y1}-${m1}-${d1}T${pad(t1 ?? "0:0")}`,
    to: `${y2}-${m2}-${d2}T${pad(t2 ?? "0:0")}`,
    startTime: pad(t1 ?? "0:0"),
    endTime: pad(t2 ?? "0:0"),
    weekdays,
  };
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

export function parseWeekdays(text: string): number[] {
  const out = new Set<number>();
  const re = /周([一二三四五六日天])((?:[、,，][一二三四五六日天])*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const first = WEEKDAY_MAP[m[1] ?? ""];
    if (first !== undefined) out.add(first);
    const rest = m[2] ?? "";
    for (const ch of rest) {
      const idx = WEEKDAY_MAP[ch];
      if (idx !== undefined) out.add(idx);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function pad(t: string): string {
  const [h = "0", m = "0"] = t.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/* -------------------------------- 字段嗅探 -------------------------------- */

function collectRows(payload: unknown): Record<string, unknown>[] | null {
  const candidates: unknown[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      if (v.some((x) => x && typeof x === "object" && !Array.isArray(x))) {
        candidates.push(v);
      }
      return;
    }
    for (const value of Object.values(v as Record<string, unknown>)) {
      visit(value, depth + 1);
    }
  };
  visit(payload, 0);

  const best = candidates
    .map((c) => c as unknown[])
    .filter((c) => c.length > 0)
    .sort((a, b) => b.length - a.length)[0];

  if (!best) return null;
  return best
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
    .slice(0, 200);
}

function collectStrings(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(row)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "string") out.push(item);
    }
  }
  return out;
}

function pickString(row: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (!patterns.some((p) => p.test(key))) continue;
    const s = optStr(value);
    if (s) return s;
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, patterns: RegExp[]): number | null {
  for (const [key, value] of Object.entries(row)) {
    if (!patterns.some((p) => p.test(key))) continue;
    const n = toNum(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function pickPriceFromStrings(strings: string[]): number | null {
  for (const s of strings) {
    const m = s.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
    if (m?.[1]) return Number(m[1]);
  }
  return null;
}

function isDateLike(s: string): boolean {
  return /\d{4}-\d{2}-\d{2}|周[一二三四五六日天]|\d{1,2}:\d{2}/.test(s);
}
