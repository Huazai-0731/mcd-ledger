/**
 * 采集层：门店菜单。
 *
 * 这是整套归因的"价格字典"——query-meals 同时给出 currentPrice（销售价）与
 * originalPrice（划线价），加上 discountType（促销/早餐卡/麦金卡），
 * 使"省了多少、因为什么省的"可以精确归因，而不是靠猜。
 */
import { arr, obj, optStr, toNum, unwrapBusiness } from "../runtime/contract.ts";
import type { Degradation, MenuItem, MenuSnapshot } from "../model/types.ts";

export interface MenuResult {
  snapshot: MenuSnapshot | null;
  degradation: Degradation | null;
}

export function parseMenu(payload: unknown, storeCode: string): MenuResult {
  let root: unknown;
  try {
    root = unwrapBusiness(payload);
  } catch (err) {
    return {
      snapshot: null,
      degradation: {
        module: `门店菜单 ${storeCode}`,
        reason: err instanceof Error ? err.message : String(err),
        impact: "该门店订单只能按实付计价，无法归因套餐与促销",
      },
    };
  }

  const data = obj(root, "$.data");
  const mealsRaw = data.meals;
  if (!mealsRaw || typeof mealsRaw !== "object") {
    return {
      snapshot: null,
      degradation: {
        module: `门店菜单 ${storeCode}`,
        reason: "响应缺少 meals 字典",
        impact: "无法归因",
      },
    };
  }

  // 分类名反查，便于在报告里说"这笔是麦满分系列"
  const categoryOf = new Map<string, string>();
  if (Array.isArray(data.categories)) {
    for (const cat of data.categories) {
      if (!cat || typeof cat !== "object") continue;
      const c = cat as Record<string, unknown>;
      const catName = optStr(c.name)?.replace(/\s+/g, " ") ?? null;
      if (!catName || !Array.isArray(c.meals)) continue;
      for (const m of c.meals) {
        if (!m || typeof m !== "object") continue;
        const code = optStr((m as Record<string, unknown>).code);
        if (code && !categoryOf.has(code)) categoryOf.set(code, catName);
      }
    }
  }

  const items: Record<string, MenuItem> = {};
  for (const [code, value] of Object.entries(mealsRaw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const tags = Array.isArray(v.tags)
      ? v.tags.filter((t): t is string => typeof t === "string")
      : [];
    items[code] = {
      code,
      name: optStr(v.name) ?? code,
      currentPrice: toNum(v.currentPrice),
      originalPrice: toNum(v.originalPrice),
      discountType: optStr(v.discountType),
      tags,
      category: categoryOf.get(code) ?? null,
      canWithOrder: v.canWithOrder === true,
    };
  }

  const frequent = data.frequent;
  const frequentCode =
    frequent && typeof frequent === "object"
      ? optStr((frequent as Record<string, unknown>).code)
      : null;

  return {
    snapshot: {
      storeCode,
      capturedAt: new Date().toISOString(),
      items,
      frequentCode,
    },
    degradation:
      Object.keys(items).length === 0
        ? {
            module: `门店菜单 ${storeCode}`,
            reason: "菜单为空（可能该门店已歇业或不在当前时段）",
            impact: "该门店订单无法归因",
          }
        : null,
  };
}

/** 合并多门店菜单：同一 SKU 以最后采集为准，保证跨门店订单可查价 */
export function mergeMenus(snapshots: MenuSnapshot[]): Record<string, MenuItem> {
  const merged: Record<string, MenuItem> = {};
  for (const snap of snapshots) {
    for (const [code, item] of Object.entries(snap.items)) {
      if (!merged[code]) merged[code] = item;
    }
  }
  return merged;
}
