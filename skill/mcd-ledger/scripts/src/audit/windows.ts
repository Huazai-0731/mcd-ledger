/**
 * 购买窗口：把"券的有效时段"和"活动日历"合并成未来 7 天的行动清单。
 *
 * 这是账本从"复盘"走向"决策"的那一步：不只告诉你过去省了多少，
 * 还告诉你明天早上 5:00–10:29 有一张 ¥9.9 的早餐券该用掉。
 */
import { money } from "../runtime/contract.ts";
import type { Campaign, Coupon, MenuItem, PurchaseWindow } from "../model/types.ts";
import { estimateCouponSaving } from "./detectors.ts";

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function buildWindows(
  coupons: Coupon[],
  campaigns: Campaign[],
  menu: Record<string, MenuItem>,
  now: Date,
  horizonDays = 7,
): PurchaseWindow[] {
  const windows: PurchaseWindow[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const date = toDateKey(day);
    const weekday = day.getDay();

    const offers: string[] = [];
    let saving = 0;
    let savingKnown = false;
    let startTime: string | null = null;
    let endTime: string | null = null;

    for (const c of coupons) {
      if (!couponUsableOn(c, day)) continue;
      offers.push(`${c.name}${c.price !== null ? ` ¥${c.price}` : ""}`);
      if (c.startTime && !startTime) startTime = c.startTime;
      if (c.endTime && !endTime) endTime = c.endTime;
      const s = estimateCouponSaving(c, menu);
      if (s !== null) {
        saving += s;
        savingKnown = true;
      }
    }

    for (const camp of campaigns) {
      if (camp.date !== date) continue;
      offers.push(camp.title);
    }

    if (offers.length === 0) continue;

    windows.push({
      date,
      weekday: WEEKDAY_CN[weekday] ?? "",
      startTime,
      endTime,
      label: offset === 0 ? "今天" : offset === 1 ? "明天" : `${WEEKDAY_CN[weekday] ?? ""}`,
      offers: dedupe(offers),
      saving: savingKnown ? money(saving) : null,
    });
  }

  return windows;
}

/** 券在某天是否可用：星期匹配 + 日期落在有效期内 */
export function couponUsableOn(c: Coupon, day: Date): boolean {
  const key = toDateKey(day);
  if (c.weekdays.length > 0 && !c.weekdays.includes(day.getDay())) return false;
  if (c.validFrom && toDateKey(new Date(c.validFrom.replace("T", " "))) > key) return false;
  if (c.validTo && toDateKey(new Date(c.validTo.replace("T", " "))) < key) return false;
  return true;
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
