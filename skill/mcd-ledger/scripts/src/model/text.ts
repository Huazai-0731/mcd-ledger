/**
 * 文本归一化：券名、商品名、菜单名来自三个不同的系统，
 * 同一个东西会有 "麦辣鸡腿堡" / "11.9元麦辣鸡腿堡" / "麦辣鸡腿汉堡" 三种写法。
 * 匹配靠"去掉修饰词 + 去掉规格词 + 双向包含"，并始终允许失败。
 */

const NOISE = /[™®\s·\-_/（）()【】\[\]「」"'’“”,，。.!！?？:：]/g;
const SIZE_WORDS = /(中杯|大杯|小杯|大份|中份|小份|单点|套餐|组合|三件套|二件套|四件套|两件套)/g;
const PRICE_PREFIX = /^\d+(?:\.\d+)?\s*元/;

export function normalizeName(text: string): string {
  return text
    .replace(PRICE_PREFIX, "")
    .replace(/汉堡/g, "堡")
    .replace(NOISE, "")
    .replace(SIZE_WORDS, "")
    .toLowerCase();
}

/** 双向包含即认为匹配；短名（<2 字）不参与，避免"派"匹配一切 */
export function looseMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length < 2 || nb.length < 2) return false;
  return na.includes(nb) || nb.includes(na);
}

/** 从券名里抽"用券价"，如 "11.9元麦辣鸡腿堡" → { price: 11.9, product: "麦辣鸡腿堡" } */
export function parseCouponTitle(name: string): { price: number | null; product: string } {
  const m = name.match(/^(\d+(?:\.\d+)?)\s*元\s*(.+)$/);
  if (m) return { price: Number(m[1]), product: (m[2] ?? "").trim() };
  const m2 = name.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*元$/);
  if (m2) return { price: Number(m2[2]), product: (m2[1] ?? "").trim() };
  return { price: null, product: name.trim() };
}
