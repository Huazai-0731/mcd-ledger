/**
 * contrast-fn.mjs — WCAG AA 对比度审计的页面侧函数（源码字符串）
 *
 * 由 audit-contrast.mjs（决策页）与 audit-ledger.mjs（账本页）共用：
 * 以 Runtime.evaluate 注入页面，遍历可见文本元素，按 WCAG 2.x
 * 计算文本色与有效背景色的对比度。
 *
 * 两处关键防误报设计（2026-10-20 据实测定稿）：
 *   1. 几何相交：只合成元素矩形真正压住的祖先背景。绝对定位元素
 *      （如 .wk-bar i 渲染在柱体上方）不会误把祖先背景算进来。
 *   2. 渐变文字：background-clip:text 的元素（.grad/.card-n/h1 em），
 *      字形颜色是渐变而非 color；改为把每个色停与底层背景逐一比对，
 *      并跳过该元素自身的块状背景（它只绘制字形，不绘制色块）。
 */
export const AUDIT_FN = `(() => {
  const parseColor = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  };
  const parseGradientStops = (bgImage) => {
    const stops = [];
    const re = /rgba?\\([^)]+\\)/g;
    let m;
    while ((m = re.exec(bgImage)) !== null) stops.push(parseColor(m[0]));
    return stops.filter(Boolean);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l[0] + 0.05) / (l[1] + 0.05);
  };
  const rectIntersects = (a, b) =>
    !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

  /**
   * 有效背景：从根往元素方向，只合成"元素矩形真正压住"的背景层。
   * skipOwnBg：跳过元素自身的背景（background-clip:text 的字形色场景）。
   */
  const effBg = (el, rect, skipOwnBg) => {
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    const chain = [];
    for (let n = el; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentElement) chain.push(n);
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const node = chain[i];
      if (skipOwnBg && i === 0) continue;
      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.width === 0 && nodeRect.height === 0) continue;
      if (!rectIntersects(rect, nodeRect)) continue;
      const cs = getComputedStyle(node);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) acc = over(c, acc);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        for (const s of parseGradientStops(cs.backgroundImage)) acc = over(s, acc);
      }
    }
    return acc;
  };

  const visible = (el) => {
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.display === 'contents') return false;
    if (Number(cs.opacity) === 0) return false;
    return true;
  };
  const hasOwnText = (el) => {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) return true;
    }
    return false;
  };
  const pathOf = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === Node.ELEMENT_NODE && i < 4; n = n.parentElement, i += 1) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (n.classList && n.classList.length) s += '.' + n.classList[0];
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const toHex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  const items = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || !hasOwnText(el)) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const fs = parseFloat(cs.fontSize) || 16;
    const fw = Number(cs.fontWeight) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const need = large ? 3 : 4.5;

    const clipText = /text/.test(cs.backgroundClip || '') || /text/.test(cs.webkitBackgroundClip || '');
    if (clipText) {
      // 渐变文字：字形色 = 渐变色停（或显式 text-fill-color），底层背景不含自身背景
      const fill = parseColor(cs.webkitTextFillColor);
      const stops = parseGradientStops(cs.backgroundImage || '');
      const inkCandidates = fill && fill.a > 0 ? [fill] : (stops.length ? stops : [parseColor(cs.color)].filter(Boolean));
      const bg = effBg(el, rect, true);
      if (!inkCandidates.length) continue;
      const worst = Math.min(...inkCandidates.map((ink) => ratio(ink, bg)));
      items.push({
        path: pathOf(el),
        text: (el.textContent || '').trim().slice(0, 24),
        mode: 'gradient-text',
        ink: inkCandidates.map(toHex).join('→'),
        bg: toHex(bg),
        fontSize: fs, weight: fw, large, ratio: Math.round(worst * 100) / 100, need,
        pass: worst >= need,
      });
      continue;
    }

    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = effBg(el, rect, false);
    const fgc = fg.a < 1 ? over(fg, bg) : fg;
    const r = ratio(fgc, bg);
    items.push({
      path: pathOf(el),
      text: (el.textContent || '').trim().slice(0, 24),
      mode: 'solid',
      color: toHex(fgc),
      bg: toHex(bg),
      fontSize: fs, weight: fw, large,
      ratio: Math.round(r * 100) / 100, need,
      pass: r >= need,
    });
  }
  return { total: items.length, violations: items.filter((i) => !i.pass) };
})()`;
