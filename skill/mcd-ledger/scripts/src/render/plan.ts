/**
 * V2 决策页（方案卡 + 待支付确认页）渲染。
 *
 * 这一页和账本页走**同一套构建流程**：
 *   · 样式共用 docs/tokens.css
 *   · 数据就是账本页那份 ledger 事实表
 *   · 浏览器里的方案求解用的是同一份引擎（engineRuntime 注入的 range.mjs）
 * 因此它不再是"手工维护的静态原型"，而是 `mcd-ledger demo/audit` 的产物之一。
 *
 * 模板来自 docs/prototype-v2.html（已把数据层换成引擎驱动）。
 * 改交互就改模板；改算法就改 src/engine/range.mjs —— 不要两边各写一份。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineRuntime } from "./html.ts";
import type { LedgerData, PlanData, Strategy, View } from "../engine/range.mjs";
import { buildPlan } from "../engine/range.mjs";

const TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>麦麦账本 V2 · 方案卡与待支付确认页 · 可点击原型</title>
<link rel="stylesheet" href="tokens.css">
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--app-bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:14px;line-height:var(--lh-body);
  -webkit-font-smoothing:antialiased;
  transition:background var(--dur) var(--ease),color var(--dur) var(--ease);
}
button{font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer}
h1,h2,h3,p,ol,ul,dl,dd,dt{margin:0;padding:0}
ol,ul{list-style:none}
svg{display:block}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:4px}

/* ============ 顶部 ============ */
.top{
  display:flex;align-items:center;justify-content:space-between;gap:20px;
  padding:18px 28px;border-bottom:1px solid var(--border);
  background:var(--app-bg);position:sticky;top:0;z-index:30;
  backdrop-filter:blur(12px);
}
.top-l{display:flex;align-items:center;gap:14px;min-width:0}
/* 两页互通入口：回到账本诊断页 */
.back{
  display:flex;align-items:center;gap:3px;height:32px;padding:0 11px;border-radius:999px;
  border:1px solid var(--border);background:var(--surface);color:var(--text-2);
  font-size:12px;font-weight:500;flex:0 0 auto;text-decoration:none;
  transition:color var(--dur-fast) var(--ease),border-color var(--dur-fast) var(--ease);
}
.back:hover{border-color:var(--border-strong);color:var(--text)}
.back:active{transform:scale(.97)}
.logo{
  width:34px;height:34px;border-radius:10px;background:var(--brand);
  display:flex;align-items:center;justify-content:center;flex:0 0 auto;
  box-shadow:var(--shadow-brand);
}
.logo svg{width:20px;height:20px;color:var(--gold)}
.top h1{font-size:15px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.top p{font-size:11.5px;color:var(--text-3);margin-top:1px;white-space:nowrap}
.top-r{display:flex;align-items:center;gap:10px;flex:0 0 auto}
.seg-theme{display:flex;padding:3px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border)}
.seg-theme button{
  height:26px;padding:0 13px;border-radius:999px;font-size:11.5px;font-weight:500;
  color:var(--text-3);transition:all var(--dur) var(--ease);
}
.seg-theme button.on{background:var(--brand-soft);color:var(--brand-ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.tbtn{
  height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--border-strong);
  font-size:12px;font-weight:500;color:var(--text-2);background:var(--surface);
  transition:all var(--dur-fast) var(--ease);
}
.tbtn:hover{border-color:var(--text-3);color:var(--text)}
.tbtn:active{transform:scale(.97)}

/* ============ 舞台 ============ */
.stage{
  display:flex;align-items:flex-start;justify-content:center;gap:34px;
  padding:34px 28px 60px;max-width:1180px;margin:0 auto;
}
.device-col{display:flex;flex-direction:column;align-items:center;gap:12px;flex:0 0 auto}
.device{
  width:390px;height:844px;position:relative;overflow:hidden;
  background:var(--app-bg);border-radius:46px;
  box-shadow:0 0 0 1px var(--border),0 0 0 9px var(--bezel),0 0 0 10px var(--border-2),
             0 40px 70px -40px rgba(0,0,0,.45);
  display:flex;flex-direction:column;
  transition:background var(--dur) var(--ease);
}
.device-cap{font-size:11px;color:var(--text-4);text-align:center;max-width:390px;line-height:1.6}

/* 状态栏 */
.statusbar{
  height:44px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
  padding:0 22px;font-size:13px;font-weight:600;color:var(--text);position:relative;z-index:12;
}
.sb-r{display:flex;align-items:center;gap:5px}
.sb-r svg{width:16px;height:11px;color:var(--text)}

/* 屏幕 */
.screens{position:relative;flex:1;overflow:hidden}
.scr{
  position:absolute;inset:0;display:flex;flex-direction:column;
  opacity:0;pointer-events:none;transform:translateX(10px);
  transition:opacity var(--dur) var(--ease),transform var(--dur) var(--ease);
}
.scr.on{opacity:1;pointer-events:auto;transform:none;z-index:2}

.scr-body{flex:1;overflow-y:auto;padding:var(--gutter-top) 16px 12px;scrollbar-width:none;overscroll-behavior:contain}
.scr-body::-webkit-scrollbar{display:none}
.scr-foot{flex:0 0 auto;background:var(--surface);border-top:1px solid var(--border-2);
  padding:11px 16px max(16px,env(safe-area-inset-bottom))}

/* 导航行：.scr 的固定子项，不再参与滚动。
   正文从它下方 --gutter-top 处起算，导航下缘的渐隐带只落在空白呼吸位上，
   滚动时才扫过内容 —— 首屏永远不会被"阴影"压住。 */
.navrow{
  position:relative;z-index:6;flex:0 0 auto;
  height:36px;padding:0 16px;display:flex;align-items:center;gap:8px;
  background:var(--app-bg);
}
.navrow::after{content:"";position:absolute;left:0;right:0;bottom:calc(-1 * var(--fade-nav));
  height:var(--fade-nav);background:linear-gradient(var(--app-bg),transparent);pointer-events:none}
.nav-t{font-size:17px;font-weight:600;letter-spacing:-.01em;flex:1;text-align:center;margin-right:-24px}
.nav-t.left{text-align:left;margin-right:0}
.nav-back{width:24px;height:24px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.nav-back svg{width:20px;height:20px;color:var(--text)}
.nav-store{font-size:11px;color:var(--text-3);flex:0 0 auto}
.timer{
  display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:13px;
  background:var(--brand-soft);color:var(--brand-ink);font-size:12.5px;font-weight:600;
  font-variant-numeric:tabular-nums;
}
.timer svg{width:12px;height:12px;color:currentColor}
.timer.low{background:var(--warn-bg);color:var(--warn-text)}

/* ============ 通用组件 ============ */
.card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r-2xl);
  padding:16px;box-shadow:var(--shadow-card);
}
.stack{display:flex;flex-direction:column;gap:12px}
.stack.tight{gap:7px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.muted{color:var(--text-3);font-size:11px}
.divider{height:1px;background:var(--border-2);margin:0}
.strike{text-decoration:line-through;color:var(--text-4)}
.num{font-variant-numeric:tabular-nums;letter-spacing:-.01em}

.chip{
  display:inline-flex;align-items:center;height:21px;padding:0 7px;border-radius:6px;
  font-size:10px;font-weight:600;white-space:nowrap;
}
.chip-warn{background:var(--warn-bg);color:var(--warn-text)}
.chip-brand{background:var(--brand-soft);color:var(--brand-ink)}
.chip-gold{background:var(--gold);color:var(--gold-ink)}
.chip-neutral{background:var(--surface-3);color:var(--text-3)}
.chip-ok{background:var(--success-bg);color:var(--success)}
.chip-gray{background:var(--surface-3);color:var(--text-3)}

/* 按钮 */
.btn-primary{
  width:100%;height:50px;border-radius:999px;background:var(--brand-fill);color:var(--text-on-brand);
  font-size:15px;font-weight:600;letter-spacing:.01em;
  display:flex;align-items:center;justify-content:center;gap:8px;position:relative;
  box-shadow:var(--shadow-brand);
  transition:transform var(--dur-fast) var(--ease),filter var(--dur-fast) var(--ease),opacity var(--dur) var(--ease);
}
.btn-primary:hover{filter:brightness(1.06)}
.btn-primary:active{transform:scale(.985)}
.btn-primary[disabled]{opacity:.85;cursor:default;transform:none}
.btn-primary .spin{
  width:14px;height:14px;border-radius:50%;
  border:2px solid rgba(255,255,255,.4);border-top-color:var(--text-on-brand);
  animation:spin .7s linear infinite;flex:0 0 auto;
}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-ghost{
  height:50px;border-radius:999px;border:1px solid var(--border-strong);
  color:var(--text-2);font-size:13.5px;font-weight:500;background:transparent;
  display:flex;align-items:center;justify-content:center;transition:all var(--dur-fast) var(--ease);
}
.btn-ghost:hover{border-color:var(--text-3);color:var(--text)}
.btn-ghost:active{transform:scale(.985)}
/* 撤销是「安全绳」：必须常驻、必须一眼可见，但不能和主 CTA 争红色。
   描边走中性 --border-strong，只保留红字（--danger-ink 双主题均过 AA）。 */
.btn-danger{
  height:50px;border-radius:999px;border:1px solid var(--border-strong);color:var(--danger-ink);
  font-size:13.5px;font-weight:600;background:transparent;
  display:flex;align-items:center;justify-content:center;
  transition:border-color var(--dur-fast) var(--ease),background var(--dur-fast) var(--ease);
}
.btn-danger:hover{border-color:var(--danger-border);background:var(--brand-soft)}
.btn-danger:active{transform:scale(.985)}
.btn-sm{
  height:28px;padding:0 11px;border-radius:14px;background:var(--brand-fill);color:var(--text-on-brand);
  font-size:11px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;
}
.btn-sm[disabled]{background:var(--surface-3);color:var(--text-4)}
.btn-text{font-size:12.5px;color:var(--text-3);padding:10px;width:100%}
.btn-row{display:flex;gap:9px}
.btn-row .btn-primary{width:auto;flex:1}
.btn-row .btn-ghost,.btn-row .btn-danger{width:104px;flex:0 0 auto;height:50px}

/* 意图条 */
.intent{
  background:var(--intent-bg);color:var(--intent-text);border-radius:var(--r-xl);
  padding:11px 14px;display:flex;flex-direction:column;gap:4px;
}
.intent-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.intent-tag{font-size:11px;font-weight:500;color:var(--gold)}
.intent-sub{font-size:11px;color:var(--intent-sub)}
.intent-name{font-size:15.5px;font-weight:600;letter-spacing:-.01em}

/* 组卡 */
.grp{display:flex;gap:10px}
.gcard{
  flex:1;text-align:left;border-radius:var(--r-lg);padding:10px 11px;
  border:1px solid var(--border);background:var(--surface);
  display:flex;flex-direction:column;gap:3px;
  transition:all var(--dur-fast) var(--ease);
}
.gcard:hover{border-color:var(--border-strong)}
.gcard.on{background:var(--brand-soft);border-color:var(--brand);border-width:1.5px;padding:9.5px 10.5px}
.gcard[disabled]{opacity:.55;cursor:not-allowed}
.gcard-top{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%}
.gcard-k{font-size:10px;font-weight:500;color:var(--text-3)}
.gcard.on .gcard-k{color:var(--brand-ink)}
.gcard-v{font-size:10px;color:var(--text-4)}
.gcard.on .gcard-v{color:var(--brand-ink)}
.gcard-p{font-size:17px;font-weight:600;letter-spacing:-.02em;margin-top:1px}
.gcard.on .gcard-p{color:var(--brand-ink)}

/* 价格 */
.price-row{display:flex;align-items:flex-end;justify-content:space-between;gap:8px}
.price-l{font-size:11px;color:var(--text-3)}
.price-v{font-size:25px;font-weight:700;color:var(--brand);letter-spacing:-.02em;line-height:1.15}
.price-note{font-size:10.5px;color:var(--text-3)}
.item{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px}
.item-n{color:var(--text-2);min-width:0;overflow-wrap:anywhere}
.item-p{color:var(--text);font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}
.item-p.coupon{color:var(--brand-ink)}
.item.swapped .item-n{color:var(--warn-strong)}

/* 提示条 */
.tipbar{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:var(--r-md);background:var(--warn-bg)}
.tipbar svg{width:14px;height:14px;flex:0 0 auto;margin-top:1px;color:var(--gold-deep)}
.tipbar p{font-size:10.5px;color:var(--warn-text);line-height:1.55}
.rbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.rchip{
  height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--border);
  background:var(--surface);color:var(--text-2);font-size:11px;font-weight:500;cursor:pointer;
  transition:color var(--dur-fast) var(--ease),border-color var(--dur-fast) var(--ease),background var(--dur-fast) var(--ease);
}
.rchip:hover{border-color:var(--border-strong);color:var(--text)}
.rchip.on{background:var(--brand-fill);border-color:transparent;color:var(--text-on-brand);font-weight:600}
.rbar-n{font-size:10px;color:var(--text-4);margin-left:auto;font-variant-numeric:tabular-nums}
.banner.brand{background:var(--brand-soft);border-color:transparent}
.banner.brand svg{color:var(--brand-ink)}
.tipbar.brand{background:var(--brand-soft)}
.tipbar.brand svg{color:var(--brand-ink)}
.tipbar.brand p{color:var(--brand-ink)}
/* 方案要点（主卡内联，不另起卡片，省一屏高度） */
.pts-h{font-size:11px;font-weight:600;color:var(--text-2)}
.pts-inline{display:flex;flex-direction:column;gap:6px}
.pi{display:flex;gap:8px;font-size:11px;line-height:1.55;color:var(--text-2)}
.pi::before{content:'';width:4px;height:4px;border-radius:50%;background:var(--brand);flex:0 0 auto;margin-top:6px}

/* 其他买法：默认折叠，只留一行汇总 —— 主方案要点优先占首屏 */
.alt-card{padding:0;overflow:hidden}
.alt-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;text-align:left}
.alt-toggle .alt-p{font-size:10.5px;color:var(--text-3);display:flex;align-items:center;gap:4px;white-space:nowrap}
.chev{width:14px;height:14px;color:var(--text-3);transition:transform var(--dur-fast) var(--ease)}
.chev.up{transform:rotate(90deg)}
.alt-body{padding:0 14px 4px;border-top:1px solid var(--border-2)}

/* 其他买法 */
.alt-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.alt-head b{font-size:12px;font-weight:600}
.alt-head span{font-size:11px;color:var(--text-3)}
.alt-item{
  display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;
  padding:7px 0;text-align:left;border-bottom:1px solid var(--border-2);
}
.alt-item:last-child{border-bottom:0;padding-bottom:0}
.alt-item:hover .alt-n{color:var(--brand-ink)}
.alt-n{font-size:12px;color:var(--text-2);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color var(--dur-fast)}
.alt-p{display:flex;align-items:center;gap:7px;flex:0 0 auto;white-space:nowrap}
.alt-p b{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
.alt-p span{font-size:10px;color:var(--text-4);white-space:nowrap}
.alt-item .chev{width:12px;height:12px;color:var(--text-4);flex:0 0 auto}

/* 底栏 */
.foot-hint{font-size:10px;color:var(--text-4);text-align:center;margin-bottom:8px;line-height:1.5}

/* 提示/警示条 */
.banner{
  display:flex;align-items:flex-start;gap:9px;padding:12px;border-radius:var(--r-lg);
  background:var(--warn-bg);border:1px solid var(--warn-border);
}
.banner svg{width:15px;height:15px;flex:0 0 auto;margin-top:1px;color:var(--warn)}
.banner p{font-size:11px;color:var(--warn-text);line-height:1.6}
.notice{
  display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:var(--r-md);
  background:var(--surface-2);border:1px solid var(--border);
}
.notice p{font-size:10.5px;color:var(--text-3);flex:1}
.notice button{width:18px;height:18px;display:flex;align-items:center;justify-content:center;color:var(--text-4)}
.notice svg{width:12px;height:12px}

/* 订单卡 */
.ord-card{border:1px solid var(--border);border-radius:var(--r-xl);background:var(--surface);padding:13px 14px;display:flex;flex-direction:column;gap:8px}
.ord-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ord-head b{font-size:13px;font-weight:600}
.ord-line{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-3)}
.ord-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:1px}
.ord-total{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
.ord-total.small{font-size:13px;font-weight:600}
.code-inline{font-size:11px;color:var(--success);font-weight:600}

/* 支付页 */
.amount-card{display:flex;flex-direction:column;gap:10px}
.amount-big{font-size:32px;font-weight:700;color:var(--brand);letter-spacing:-.03em;line-height:1.1}
.amount-side{display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:10.5px}
.amount-side .save{color:var(--brand-ink);font-weight:600}
.amount-side .strike{font-size:10.5px}

.store-row{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--border)}
.store-row svg{width:16px;height:16px;color:var(--neutral-ink);flex:0 0 auto}
.store-row .t{font-size:12px;font-weight:500}
.store-row .s{font-size:10.5px;color:var(--text-3)}
.store-row .chev{width:14px;height:14px;color:var(--text-4);margin-left:auto}

.payway{padding:13px 14px;border-radius:var(--r-xl);background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;gap:9px}
.payway h3{font-size:11px;font-weight:500;color:var(--text-3)}
.pway{display:flex;align-items:center;gap:9px;width:100%;min-height:32px;text-align:left}
.pradio{width:16px;height:16px;border-radius:50%;border:1.4px solid var(--border-strong);flex:0 0 auto;position:relative;transition:all var(--dur-fast)}
.pway.on .pradio{border-color:var(--brand);border-width:5px}
.pway .nm{font-size:13px;color:var(--text-2);flex:1}
.pway.on .nm{color:var(--text);font-weight:500}
.pway .tag{font-size:10px;color:var(--text-4)}
.payway .note{font-size:10px;color:var(--text-4);line-height:1.5}

.qr-card{display:flex;gap:13px;padding:13px 14px;border-radius:var(--r-xl);background:var(--surface);border:1px solid var(--border)}
.qr-box{width:96px;height:96px;flex:0 0 auto;border-radius:8px;border:1px solid var(--border-2);padding:6px;background:#fff}
[data-theme="dark"] .qr-box{background:#F3EFE6;border-color:transparent}
.qr-box svg{width:100%;height:100%;color:#111}
.qr-txt{display:flex;flex-direction:column;gap:5px;justify-content:center}
.qr-txt b{font-size:12px;font-weight:600}
.qr-txt p{font-size:10.5px;color:var(--text-3);line-height:1.5}
.qr-warn{font-size:9.5px;color:var(--warn-strong);line-height:1.4}

/* 失效 / 成功 */
.big-card{border-radius:var(--r-4xl);background:var(--surface);border:1px solid var(--border);padding:20px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.fail-icon{width:54px;height:54px;border-radius:50%;background:var(--surface-3);display:flex;align-items:center;justify-content:center}
.fail-icon svg{width:54px;height:54px;color:var(--text-4)}
.ok-chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border-radius:13px;background:var(--success-bg);color:var(--success);font-size:11.5px;font-weight:600}
.ok-chip svg{width:13px;height:13px;color:currentColor}
.pickup{font-size:54px;font-weight:700;letter-spacing:.04em;line-height:1.05;font-variant-numeric:tabular-nums}
.barcode{width:230px;height:38px;color:var(--text)}
.kv{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.kv dt{color:var(--text-3)}
.kv dd{color:var(--text-2);font-weight:500;text-align:right}
.kv dd.brand{color:var(--brand-ink)}

/* 卡片面统一：表面色 + 描边 + 阴影走同一套 token。
   此前只有 .card 带阴影，ord-card / payway / qr-card / big-card / store-row
   是"裸描边"，深色下这些块读不出边界，和 .card 也不像同一个系统。 */
.card,.big-card,.ord-card,.payway,.qr-card,.store-row,.notice,.gcard{box-shadow:var(--shadow-card)}

/* toast */
.toast-wrap{position:absolute;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:40;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{
  display:flex;align-items:center;gap:8px;padding:10px 13px;border-radius:13px;
  background:var(--intent-bg);color:var(--intent-text);font-size:11.5px;line-height:1.45;
  box-shadow:0 12px 30px -12px rgba(0,0,0,.6);opacity:0;transform:translateY(8px);
  animation:toastIn 220ms var(--ease) forwards;
}
.toast.ok svg{color:var(--toast-ok)}
.toast.warn svg{color:var(--gold)}
.toast svg{width:14px;height:14px;flex:0 0 auto;color:currentColor}
.toast.out{animation:toastOut 200ms var(--ease) forwards}
@keyframes toastIn{to{opacity:1;transform:none}}
@keyframes toastOut{to{opacity:0;transform:translateY(6px)}}

/* sheet */
.sheet-wrap{position:absolute;inset:0;z-index:50}
.scrim{position:absolute;inset:0;background:var(--scrim);opacity:0;animation:fadeIn 180ms var(--ease) forwards}
.sheet{
  position:absolute;left:0;right:0;bottom:0;background:var(--surface);
  border-radius:22px 22px 0 0;padding:8px 18px 22px;
  box-shadow:var(--shadow-sheet);transform:translateY(100%);
  animation:sheetIn 260ms var(--ease) forwards;
  display:flex;flex-direction:column;gap:10px;
}
.sheet-grip{width:36px;height:4px;border-radius:2px;background:var(--border-strong);margin:0 auto 6px}
.sheet h3{font-size:16px;font-weight:600;text-align:center}
.sheet-sub{font-size:11.5px;color:var(--text-3);text-align:center;line-height:1.55}
.sheet-amount{font-size:30px;font-weight:700;color:var(--brand);text-align:center;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.sheet-actions{display:flex;gap:9px;margin-top:4px}
.sheet-actions .btn-ghost,.sheet-actions .btn-danger{flex:1}
@keyframes fadeIn{to{opacity:1}}
@keyframes sheetIn{to{transform:none}}
.sheet .btn-primary{margin-top:2px}
.paylist{display:flex;flex-direction:column;gap:2px;margin:2px 0 0}
.pitem{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 4px;border-bottom:1px solid var(--border-2);text-align:left}
.pitem:last-child{border-bottom:0}
.pitem .pradio{border-color:var(--border-strong)}
.pitem.on .pradio{border-color:var(--brand);border-width:5px}
.pitem .nm{font-size:14px;flex:1}
.pitem .tag{font-size:10px;color:var(--text-4)}
.sheet-note{font-size:10px;color:var(--text-4);line-height:1.5;text-align:center;margin-top:4px}
.paying{display:flex;flex-direction:column;align-items:center;gap:12px;padding:26px 0 30px}
.paying .spin{width:22px;height:22px;border-radius:50%;border:2.5px solid var(--border-strong);border-top-color:var(--brand);animation:spin .8s linear infinite}
.paying p{font-size:12px;color:var(--text-3)}

/* ============ 侧栏 ============ */
.panel{width:322px;flex:0 0 auto;display:flex;flex-direction:column;gap:14px;position:sticky;top:86px}
.pcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-2xl);padding:14px;box-shadow:var(--shadow-card)}
.pcard h2{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.pcard h2 em{font-style:normal;font-size:9.5px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--text-4)}
.seg2{display:flex;gap:6px}
.seg2 button{
  flex:1;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);
  font-size:11.5px;color:var(--text-3);transition:all var(--dur-fast);
}
.seg2 button.on{background:var(--brand-soft);border-color:var(--brand);color:var(--brand-ink);font-weight:600}
.jumps{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.jumps button{
  height:32px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);
  font-size:11px;color:var(--text-2);text-align:left;padding:0 9px;
  display:flex;align-items:center;gap:6px;transition:all var(--dur-fast);
}
.jumps button:hover{border-color:var(--border-strong);background:var(--surface)}
.jumps button.on{border-color:var(--brand);color:var(--brand-ink);background:var(--brand-soft);font-weight:600}
.jumps b{font-size:9.5px;font-weight:700;color:var(--text-4);font-variant-numeric:tabular-nums}
.jumps button.on b{color:var(--brand-ink)}
.state-dl{display:grid;grid-template-columns:78px 1fr;gap:5px 8px;font-size:11px}
.state-dl dt{color:var(--text-4)}
.state-dl dd{color:var(--text-2);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.logbox{max-height:236px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}
.logbox li{display:flex;gap:7px;font-size:10.5px;line-height:1.45;color:var(--text-2)}
.logbox time{color:var(--text-4);font-variant-numeric:tabular-nums;flex:0 0 auto;font-size:10px}
.logbox .dot{width:5px;height:5px;border-radius:50%;background:var(--text-4);flex:0 0 auto;margin-top:5px}
.logbox li.brand .dot{background:var(--brand)}
.logbox li.ok .dot{background:var(--success)}
.logbox li.warn .dot{background:var(--warn)}
.logbox .empty{color:var(--text-4);font-size:10.5px}
.pfoot{font-size:10px;color:var(--text-4);line-height:1.6;padding:0 2px}

@media (max-width:1000px){
  .stage{flex-direction:column;align-items:center;gap:24px;padding:20px 14px 50px}
  .panel{position:static;width:390px;max-width:100%}
  .top{padding:14px 16px}
  .top p{display:none}
}
/* 窄屏评审：手机中框跟随视口收窄，内容按 320 最小宽度重排 */
@media (max-width:520px){
  .device{width:min(390px,calc(100vw - 24px))}
  .device-col,.device-cap{max-width:100%}
  .top{gap:10px}
  .top-l{flex:1;min-width:0}
  .top-l>div{min-width:0}
  .top h1{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .top-r{gap:6px}
  .seg-theme button{padding:0 9px}
  .tbtn{padding:0 10px;font-size:11.5px}
  .back{padding:0 8px}
  .back-t{display:none}
}
</style>
</head>
<body>

<header class="top">
  <div class="top-l">
    <a class="back" href="demo-report.html" aria-label="返回账本诊断页"><span aria-hidden="true">←</span><span class="back-t">账本</span></a>
    <div class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M4 19V9.4c0-3.2 2.4-5.4 4.6-5.4 1.6 0 2.8.8 3.4 2 .6-1.2 1.8-2 3.4-2 2.2 0 4.6 2.2 4.6 5.4V19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
    </div>
    <div>
      <h1>方案卡 · 待支付确认页</h1>
      <p>V2 可点击原型 · 9 个界面状态 · 真实点击流</p>
    </div>
  </div>
  <div class="top-r">
    <div class="seg-theme" role="group" aria-label="主题">
      <button data-act="theme" data-val="light" class="on">浅色</button>
      <button data-act="theme" data-val="dark">深色</button>
    </div>
    <button class="tbtn" data-act="reset">重置原型</button>
  </div>
</header>

<main class="stage">
  <div class="device-col">
    <div class="device" id="device">
      <div class="statusbar">
        <span id="clock">14:11</span>
        <span class="sb-r" aria-hidden="true">
          <svg viewBox="0 0 17 12" fill="currentColor"><rect y="8" width="3" height="4" rx="1"/><rect x="4.7" y="5.5" width="3" height="6.5" rx="1"/><rect x="9.4" y="3" width="3" height="9" rx="1"/><rect x="14" width="3" height="12" rx="1"/></svg>
          <svg viewBox="0 0 16 12" fill="none"><path d="M1.6 3.4a9 9 0 0112.8 0M4.2 6.2a5.4 5.4 0 017.6 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="9.8" r="1.3" fill="currentColor"/></svg>
          <svg viewBox="0 0 25 12" fill="none"><rect x=".5" y=".5" width="21" height="11" rx="3.2" stroke="currentColor" stroke-opacity=".35"/><rect x="2" y="2" width="14" height="8" rx="2" fill="currentColor"/><path d="M23 4.2v3.6a2 2 0 000-3.6z" fill="currentColor" fill-opacity=".35"/></svg>
        </span>
      </div>

      <div class="screens" id="screens">
        <section class="scr on" data-scr="plan" aria-label="方案卡"></section>
        <section class="scr" data-scr="card" aria-label="买卡方案"></section>
        <section class="scr" data-scr="pay" aria-label="待支付确认页"></section>
        <section class="scr" data-scr="expired" aria-label="订单已失效"></section>
        <section class="scr" data-scr="fail" aria-label="支付未完成"></section>
        <section class="scr" data-scr="success" aria-label="支付成功"></section>
      </div>

      <div class="toast-wrap" id="toastWrap" aria-live="polite" aria-atomic="true"></div>
      <div class="sheet-wrap" id="sheetWrap" hidden>
        <div class="scrim" data-act="close-sheet"></div>
        <div class="sheet" id="sheet" role="dialog" aria-modal="true"></div>
      </div>
    </div>
    <p class="device-cap" id="cap">S1 · 方案卡 · 合单主态</p>
  </div>

  <aside class="panel">
    <section class="pcard">
      <h2>场景模拟 <em>用于走到分支状态</em></h2>
      <div class="seg2" role="group" aria-label="场景">
        <button data-act="scenario" data-val="normal" class="on">价格正常</button>
        <button data-act="scenario" data-val="stockout">提交时售罄</button>
        <button data-act="scenario" data-val="abort">支付中途退出</button>
      </div>
      <p class="pfoot" style="margin-top:8px">「提交时售罄」让生成订单前的重校验返回 60006，走到 S4 降级态；「支付中途退出」让支付回调不返回，走到 S9。</p>
    </section>

    <section class="pcard">
      <h2>直达界面</h2>
      <div class="jumps" id="jumps">
        <button data-act="jump" data-val="s1"><b>S1</b>合单主态</button>
        <button data-act="jump" data-val="s2"><b>S2</b>拆单对比</button>
        <button data-act="jump" data-val="s3"><b>S3</b>买卡双栏</button>
        <button data-act="jump" data-val="s4"><b>S4</b>重校验降级</button>
        <button data-act="jump" data-val="s5"><b>S5</b>待支付主态</button>
        <button data-act="jump" data-val="s6"><b>S6</b>拆单 2 单</button>
        <button data-act="jump" data-val="s7"><b>S7</b>已过期</button>
        <button data-act="jump" data-val="s9"><b>S9</b>支付未完成</button>
        <button data-act="jump" data-val="s8"><b>S8</b>支付成功</button>
      </div>
    </section>

    <section class="pcard">
      <h2>当前状态 <em id="scrTag">plan</em></h2>
      <dl class="state-dl">
        <dt>方案 / 组</dt><dd id="stPlan">—</dd>
        <dt>订单</dt><dd id="stOrders">—</dd>
        <dt>倒计时</dt><dd id="stTimer">—</dd>
        <dt>金额</dt><dd id="stMoney">—</dd>
      </dl>
    </section>

    <section class="pcard">
      <h2>事件日志 <em>最新在上</em></h2>
      <ol class="logbox" id="log"><li class="empty">还没有操作</li></ol>
    </section>
  </aside>
</main>

<script type="application/json" id="plan-data">__PLAN_DATA__</script>
<script>__ENGINE_RUNTIME__</script>
<script>
/* =========================================================================
   状态
   ========================================================================= */
const S = {
  theme:'light',
  scenario:'normal',      // normal | stockout
  screen:'plan',
  spec:'30d',             // 区间：与账本页同源，切区间即重算方案
  strat:null,             // 从账本跳进来时带的策略类型
  fromLedger:false,       // 是否来自账本页的某条策略
  srcOpen:false,          // 「这些数字怎么算的」是否展开
  group:'single',         // single | split
  altOpen:false,          // 其他买法是否展开
  planId:'plain',         // 当前选中的买法 id（= PLAN.methods[].id）
  degrade:false,
  buyCard:true,
  orders:[],
  remaining:900,
  notice:null,
  payTarget:null,
  payMethod:'wechat',
  log:[],
  toasts:[],
};
const CAPS = {
  'plan:single': 'S1 · 方案卡 · 合单主态',
  'plan:split': 'S2 · 方案卡 · 拆单对比',
  'plan:degrade': 'S4 · 方案卡 · 重校验降级',
  'card': 'S3 · 方案卡 · 买卡双栏',
  'pay:1': 'S5 · 待支付确认页 · 主态',
  'pay:2': 'S6 · 待支付 · 拆单 2 单',
  'expired': 'S7 · 待支付 · 已过期',
  'fail': 'S9 · 待支付 · 支付未完成',
  'success': 'S8 · 支付成功 · 取餐码',
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (n) => '¥' + Number(n).toFixed(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clockNow = () => new Date().toTimeString().slice(0, 8);
const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

/* =========================================================================
   图标
   ========================================================================= */
const I = {
  back: '<svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.1" stroke="currentColor" stroke-width="1.3"/><path d="M6 3.2V6l2 1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 15 15" fill="none"><path d="M7.5 1.6L14 13.2H1L7.5 1.6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.5 5.8v3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7.5" cy="11.1" r=".75" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.1" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2v3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="7" cy="10.1" r=".8" fill="currentColor"/></svg>',
  store: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 14.4s5-4.1 5-8a5 5 0 10-10 0c0 3.9 5 8 5 8z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><circle cx="8" cy="6.3" r="1.9" stroke="currentColor" stroke-width="1.35"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 14 14" fill="none"><path d="M5.2 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6.5" fill="currentColor"/><path d="M3.6 6.6l2 2 3.8-3.9" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  fail: '<svg viewBox="0 0 54 54" fill="none"><circle cx="27" cy="27" r="27" fill="var(--surface-3)"/><circle cx="27" cy="27" r="13" stroke="currentColor" stroke-width="2"/><path d="M27 20.5v7l4.8 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M13 41L41 13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  barcode: '<svg class="barcode" viewBox="0 0 230 38" fill="none"><g fill="currentColor"><rect x="4" width="3" height="38"/><rect x="11" width="2" height="38"/><rect x="17" width="5" height="38"/><rect x="26" width="2" height="38"/><rect x="32" width="4" height="38"/><rect x="41" width="2" height="38"/><rect x="47" width="3" height="38"/><rect x="55" width="5" height="38"/><rect x="64" width="2" height="38"/><rect x="70" width="4" height="38"/><rect x="79" width="2" height="38"/><rect x="85" width="3" height="38"/><rect x="93" width="2" height="38"/><rect x="99" width="5" height="38"/><rect x="108" width="2" height="38"/><rect x="114" width="4" height="38"/><rect x="123" width="3" height="38"/><rect x="131" width="2" height="38"/><rect x="137" width="5" height="38"/><rect x="146" width="2" height="38"/><rect x="152" width="3" height="38"/><rect x="160" width="4" height="38"/><rect x="169" width="2" height="38"/><rect x="175" width="5" height="38"/><rect x="184" width="2" height="38"/><rect x="190" width="3" height="38"/><rect x="198" width="4" height="38"/><rect x="207" width="2" height="38"/><rect x="213" width="5" height="38"/><rect x="222" width="2" height="38"/><rect x="228" width="3" height="38"/></g></svg>',
};

/* =========================================================================
   数据来源
   -------------------------------------------------------------------------
   这一页不再是写死的数字。构建时把账本的**事实表**注入进来
   （<script id="plan-data">），页面用与服务端同一份引擎（MCD_LEDGER_ENGINE）
   现场求解：切区间 → 换一批常点商品 → 换一批可用券 → 价格和结论跟着变。
   所有价格来自菜单现价/划线价，原型不联网；真实下单前必须重算（S4 讲的就是它）。
   ========================================================================= */
const RAW = (function () {
  const el = document.getElementById('plan-data');
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (e) { return null; }
})();
const E = window.MCD_LEDGER_ENGINE || null;
const LEDGER = RAW && RAW.ledger ? RAW.ledger : null;
let PLAN = RAW && RAW.plan ? RAW.plan : null;
let STRAT = RAW && RAW.strat ? RAW.strat : null;   // 从账本带过来的那条策略（会随区间重算）
const RANGES = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 90 天' },
  { key: 'all', label: '全部' },
];

/** 用引擎重算；没有引擎时退回构建期算好的那份 */
function recompute(keepPlan) {
  if (E && LEDGER) {
    PLAN = E.buildPlan(LEDGER, S.spec);
    /* 策略也按当前区间重算：账本在 90 天时点进来的，横幅就该是 90 天那条 */
    try {
      const v = E.buildView(LEDGER, S.spec);
      STRAT = (S.strat ? (v.strats || []).find((x) => x.kind === S.strat) : null) || (v.strats || [])[0] || STRAT;
    } catch (e) { /* 引擎算不出来时沿用注入的那条 */ }
  }
  if (!PLAN || !PLAN.ok) return;
  const ids = PLAN.methods.map((m) => m.id);
  if (!keepPlan || ids.indexOf(S.planId) < 0) {
    S.planId = (S.strat && E && E.planFocus ? E.planFocus(PLAN, S.strat) : null) || PLAN.best || (PLAN.methods[0] ? PLAN.methods[0].id : 'plain');
  }
  if (S.group === 'split' && !PLAN.split) S.group = 'single';
}

function method(id) {
  if (!PLAN || !PLAN.ok) return null;
  return PLAN.methods.find((m) => m.id === id) || PLAN.methods[0] || null;
}

function planData() {
  if (!PLAN || !PLAN.ok) {
    return { name: '没有可算的方案', meta: '', items: [], coupon: null, total: 0, original: 0, saved: 0, badge: null, tip: PLAN ? PLAN.reason : '缺少账本数据', points: [] };
  }
  const m = method(S.planId) || PLAN.methods[0];
  if (S.degrade && PLAN.degrade) {
    const d = PLAN.degrade;
    return {
      name: m.name, meta: '重校验后已替换 1 项', items: d.items, coupon: m.coupon,
      total: d.total, original: m.original, saved: money(m.original - d.total), badge: '已替换',
      prevTotal: d.prevTotal, delta: d.delta,
      tip: '替换的是' + d.from + '，券绑定的商品没动，优惠不受影响',
      points: [
        '把' + d.from + '换成了' + d.to + '，价差 ' + (d.delta >= 0 ? '+' : '-') + money(Math.abs(d.delta)),
        '价差绝对值 ≤ ¥' + d.threshold.toFixed(2) + ' 阈值时方案继续，超出会中断并要求你重新确认',
      ],
    };
  }
  return { ...m };
}

function splitData() {
  if (!PLAN || !PLAN.split) return [];
  return PLAN.split.orders;
}

/** 买卡建议：没有随单购权益价的商品就不给建议（避免变成帮商家卖卡） */
function cardData() {
  return PLAN && PLAN.card ? PLAN.card : null;
}

function storeName() {
  return (PLAN && PLAN.store ? PLAN.store.name : null) || (RAW && RAW.storeName ? RAW.storeName : '常去门店');
}

/* =========================================================================
   日志 / 提示
   ========================================================================= */
function logEvent(text, kind = '') {
  S.log.unshift({ t: clockNow(), text, kind });
  if (S.log.length > 40) S.log.pop();
  renderLog();
}
function renderLog() {
  const el = $('#log');
  if (!S.log.length) { el.innerHTML = '<li class="empty">还没有操作</li>'; return; }
  el.innerHTML = S.log.map((l) =>
    \`<li class="\${l.kind}"><span class="dot"></span><time>\${l.t}</time><span>\${l.text}</span></li>\`).join('');
}
function syncToastOffset() {
  const foot = document.querySelector('.scr.on .scr-foot');
  $('#toastWrap').style.bottom = ((foot ? foot.offsetHeight : 0) + 12) + 'px';
}
function toast(text, kind = '') {
  syncToastOffset();
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = (kind === 'ok' ? I.check : kind === 'warn' ? I.warn : I.info) + \`<span>\${text}</span>\`;
  wrap.appendChild(el);
  S.toasts.push(text);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 2600);
}

/* =========================================================================
   屏幕切换
   ========================================================================= */
function setScreen(id) {
  S.screen = id;
  $$('.scr').forEach((s) => s.classList.toggle('on', s.dataset.scr === id));
  $$('#jumps button').forEach((b) => b.classList.toggle('on', jumpIdFor() === b.dataset.val));
  const body = $('.scr.on .scr-body');
  if (body) body.scrollTop = 0;
  renderPanel();
}

function jumpIdFor() {
  if (S.screen === 'plan') return S.degrade ? 's4' : S.group === 'split' ? 's2' : 's1';
  if (S.screen === 'card') return 's3';
  if (S.screen === 'pay') return S.orders.length > 1 ? 's6' : 's5';
  if (S.screen === 'expired') return 's7';
  if (S.screen === 'fail') return 's9';
  if (S.screen === 'success') return 's8';
  return '';
}

/* =========================================================================
   渲染：方案卡
   ========================================================================= */
function navrow({ title, back, timer, chip }) {
  const right = timer
    ? \`<span class="timer \${timer <= 120 ? 'low' : ''}" id="timerChip">\${I.clock}<span id="timerText">\${mmss(timer)}</span></span>\`
    : chip || (back ? '' : '<span class="nav-store">' + storeName() + '</span>');
  return \`<div class="navrow">
    \${back ? \`<button class="nav-back" data-act="back-plan" aria-label="返回">\${I.back}</button>\` : ''}
    <div class="nav-t \${back || chip ? '' : 'left'}" \${chip ? 'style="margin-right:0"' : ''}>\${title}</div>
    \${right}
  </div>\`;
}

function renderPlan() {
  const p = planData();
  const split = S.group === 'split' && !S.degrade && !!(PLAN && PLAN.split);
  const canSplit = !S.degrade && !!(PLAN && PLAN.split);
  const out = [];
  const nav = navrow({ title: '今天中午 · 方案' });

  out.push(rangeBar());
  if (S.fromLedger) out.push(ledgerBanner());

  if (S.notice) {
    out.push(\`<div class="notice" style="margin-bottom:12px">
      <p>\${S.notice}</p>
      <button data-act="dismiss-notice" aria-label="关闭提示">\${I.close}</button>
    </div>\`);
  }

  if (S.degrade && PLAN && PLAN.degrade) {
    const d = PLAN.degrade;
    const more = d.delta > 0 ? '多付 ' + money(d.delta) : '少付 ' + money(-d.delta);
    out.push(\`<div class="banner" style="margin-bottom:12px;align-items:flex-start">
      \${I.warn}
      <div style="display:flex;flex-direction:column;gap:3px">
        <p style="font-weight:600">\${d.from} 刚刚售罄，已换成\${d.to}</p>
        <p style="color:var(--warn-text)">\${more}，仍在可接受范围内，方案继续</p>
      </div>
    </div>\`);
  }

  out.push(\`<div class="intent">
    <div class="intent-top">
      <span class="intent-tag">\${S.degrade ? '照旧 · 已调整' : '照旧 · 常点组合'}</span>
      <span class="intent-sub">\${S.degrade ? '重校验于 ' + clockNow() : (PLAN ? PLAN.label + ' · ' + PLAN.orders + ' 笔' : '')}</span>
    </div>
    <div class="intent-name">\${S.degrade ? p.name : '常点组合'}</div>
    \${PLAN && PLAN.ok ? \`<div style="margin-top:6px;font-size:11px;line-height:1.5;color:var(--intent-sub)">\${PLAN.basket.map((b2) => b2.name + ' ×' + b2.count).join(' · ')}</div>\` : ''}
  </div>\`);

  out.push(\`<div class="grp" style="margin-top:10px">
    <button class="gcard \${!split ? 'on' : ''}" data-act="group" data-val="single">
      <span class="gcard-top"><span class="gcard-k">合单 · 1 单</span><span class="gcard-v">用 1 张券</span></span>
      <span class="gcard-p num">\${money(p.total)}</span>
    </button>
    <button class="gcard \${split ? 'on' : ''}" data-act="group" data-val="split" \${canSplit ? '' : 'disabled'}>
      <span class="gcard-top"><span class="gcard-k">拆单 · 2 单</span><span class="gcard-v">\${PLAN && PLAN.split ? (PLAN.split.secondCoupon ? '用 2 张券' : '第 2 张券用不上') : '没有第二张可用券'}</span></span>
      <span class="gcard-p num">\${PLAN && PLAN.split ? money(PLAN.split.total) : '—'}</span>
    </button>
  </div>\`);

  out.push(split ? splitBlock() : mainBlock(p));
  /* 降级态只保留「处理这次变化」这一条主线，其他买法先收起，避免分心 */
  if (S.degrade) out.push(\`<button class="btn-text" data-act="revert-degrade" style="margin-top:6px">回到原方案（不替换）</button>\`);

  if (!split && !S.degrade) {
    const alts = (PLAN ? PLAN.methods : []).filter((m) => m.id !== S.planId);
    const lowest = alts.length ? Math.min.apply(null, alts.map((m) => m.total)) : 0;
    out.push(\`<div class="card alt-card" style="margin-top:10px">
    <button class="alt-toggle" data-act="toggle-alt" aria-expanded="\${S.altOpen}">
      <span class="alt-n">其他买法</span>
      <span class="alt-p"><span>\${alts.length} 种已算过\${alts.length ? ' · 最低 ' + money(lowest) : ''}</span>
        <svg class="chev \${S.altOpen ? 'up' : ''}" viewBox="0 0 14 14" fill="none"><path d="M5.2 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </button>
    \${S.altOpen ? \`<div class="alt-body">
      \${alts.map((m) => \`<button class="alt-item" data-act="pick-plan" data-val="\${m.id}">
        <span class="alt-n">\${m.name}</span>
        <span class="alt-p"><b>\${money(m.total)}</b><span>\${m.total > p.total ? '贵 ' + money(m.total - p.total) : m.coupon ? '用券省 ' + money(m.coupon.off) : '省 ' + money(m.saved)}</span>\${I.chev}</span>
      </button>\`).join('')}
      \${cardData() ? \`<button class="alt-item" data-act="open-card" style="border-bottom:0">
        <span class="alt-n">或：买麦金卡再下单（\${cardData().item.n.replace(' ×1', '')}）</span>
        <span class="alt-p"><b>\${money(cardData().withCard)}</b><span>\${cardData().single > 0 ? '省 ' + money(cardData().single) : '这次贵 ' + money(-cardData().single)}</span>\${I.chev}</span>
      </button>\` : ''}
    </div>\` : ''}
  </div>\`);
  }

  /* 数字从哪来：评审时最常被问的一栏，放在最后不影响首屏 */
  if (PLAN && PLAN.ok) out.push(srcCard());

  if (PLAN && PLAN.best && S.planId !== PLAN.best) {
    out.push(\`<button class="btn-text" data-act="restore" style="margin-top:6px">恢复推荐方案（\${money(method(PLAN.best).total)}）</button>\`);
  }

  const foot = [];
  foot.push(\`<div class="foot-hint">\${
    S.degrade ? '方案对象不可变：卡上显示多少，下单就是多少'
      : split ? '两单会依次生成，均需单独确认支付'
      : '生成后 15 分钟内未支付将自动失效，可随时撤销'
  }</div>\`);
  foot.push(\`<button class="btn-primary" data-act="make-order">
    <span>\${S.degrade ? '按新方案生成待支付订单' : split ? '生成 2 张待支付订单' : '生成待支付订单'}</span>
  </button>\`);


  const scr = $('[data-scr="plan"]');
  scr.innerHTML = \`\${nav}<div class="scr-body">\${out.join('')}</div><div class="scr-foot">\${foot.join('')}</div>\`;
  renderPanel();
}

/* 区间切换：与账本页同源。点一下 → 引擎重算 → 常点商品、券、价格全变 */
function rangeBar() {
  return \`<div class="rbar">
    \${RANGES.map((r) => \`<button class="rchip \${S.spec === r.key ? 'on' : ''}" data-act="range" data-val="\${r.key}">\${r.label}</button>\`).join('')}
    \${PLAN && PLAN.ok ? \`<span class="rbar-n">\${PLAN.from} → \${PLAN.to}</span>\` : ''}
  </div>\`;
}

/* 从账本某条策略跳进来时，先交代"为什么是这张卡" */
function ledgerBanner() {
  const st = STRAT;
  if (!st) return '';
  const amount = st.perMonth !== null && st.perMonth !== undefined ? '月化 ¥' + Number(st.perMonth).toFixed(2)
    : st.inRange !== null && st.inRange !== undefined ? '区间 ¥' + Number(st.inRange).toFixed(2) : '不计金额';
  return \`<div class="banner brand" style="margin-bottom:10px;align-items:flex-start">
    \${I.info}
    <div style="display:flex;flex-direction:column;gap:3px">
      <p style="font-weight:600">来自账本：\${st.title}</p>
      <p style="color:var(--brand-ink)">\${st.kindLabel || ''} · \${amount}\${st.action ? ' · ' + st.action : ''}</p>
    </div>
  </div>\`;
}

/* 数字从哪来 */
function srcCard() {
  return \`<div class="card" style="margin-top:10px;padding:0;overflow:hidden">
    <button class="alt-toggle" data-act="toggle-src" aria-expanded="\${S.srcOpen}">
      <span class="alt-n">这些数字怎么算的</span>
      <span class="alt-p"><span>\${PLAN.confidence === 'high' ? '样本充足' : PLAN.confidence === 'medium' ? '样本一般' : '样本偏少'}</span>
        <svg class="chev \${S.srcOpen ? 'up' : ''}" viewBox="0 0 14 14" fill="none"><path d="M5.2 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </button>
    \${S.srcOpen ? \`<div class="alt-body" style="padding-bottom:10px">
      <div class="pi" style="margin:10px 0 6px">\${PLAN.confidenceNote}</div>
      \${PLAN.provenance.map((t) => \`<div class="pi">\${t}</div>\`).join('')}
    </div>\` : ''}
  </div>\`;
}

function itemRows(p) {
  return p.items.map((it) => \`<div class="item \${it.swapped ? 'swapped' : ''}">
      <span class="item-n">\${it.n}\${it.sub ? \`<span class="muted" style="display:block">\${it.sub}</span>\` : ''}</span>
      <span class="item-p">\${money(it.p)}</span>
    </div>\`).join('');
}

function mainBlock(p) {
  return \`<div class="card" style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
    <div class="row" style="align-items:flex-start">
      <div style="min-width:0;flex:1">
        <div style="font-size:16px;font-weight:600;letter-spacing:-.01em">\${p.name}</div>
        <div class="muted" style="margin-top:2px">\${p.meta}</div>
      </div>
      \${p.badge ? \`<span class="chip \${p.badge === '已替换' ? 'chip-warn' : p.badge === '最省' ? 'chip-gold' : 'chip-neutral'}">\${p.badge}</span>\` : ''}
    </div>
    <div class="divider"></div>
    <div class="stack tight">\${itemRows(p)}</div>
    \${p.coupon ? \`<div class="item">
      <span class="item-n" style="color:var(--brand-ink)">\${p.coupon.name}</span>
      <span class="item-p coupon">-\${money(p.coupon.off)}</span>
    </div>\` : ''}
    <div class="tipbar">\${I.info}<p>\${p.tip}</p></div>
    \${p.points && p.points.length ? \`<div class="pts-inline">\${p.points.map((t) => \`<div class="pi">\${t}</div>\`).join('')}</div>\` : ''}
    <div class="divider"></div>
    <div class="price-row">
      <div>
        <div class="price-l">整单原价 <span class="strike">\${money(p.original)}</span></div>
        \${p.delta ? \`<div class="price-note" style="color:var(--warn-strong);margin-top:2px">原方案 \${money(p.prevTotal)} · 现多付 \${money(p.delta)}</div>\`
          : \`<div class="price-note" style="margin-top:2px">价格锁定至 \${lockTime()}</div>\`}
      </div>
      <div style="text-align:right">
        <div class="price-l">实付</div>
        <div class="price-v num">\${money(p.total)}</div>
      </div>
    </div>
    <div class="price-note" style="text-align:right">\${p.saved > 0 ? \`已省 \${money(p.saved)}\` : '未使用券'}</div>
  </div>\`;
}

function splitBlock() {
  const [o1, o2] = splitData();
  const order = (o) => \`<div style="display:flex;flex-direction:column;gap:7px">
      <div class="row"><b style="font-size:13px">\${o.label}</b><b style="font-size:13px;color:var(--brand-ink)">\${money(o.total)}</b></div>
      \${o.items.map((i) => \`<div class="row" style="font-size:12px"><span style="color:var(--text-2)">\${i.n}</span><span style="color:var(--text-3)">\${money(i.p)}</span></div>\`).join('')}
      \${o.coupon
        ? \`<div class="row" style="font-size:12px"><span style="color:var(--brand-ink)">\${o.coupon.name}</span><span style="color:var(--brand-ink);font-weight:500">-\${money(o.coupon.off)}</span></div>\`
        : \`<div class="row" style="font-size:12px"><span style="color:var(--text-3)">没有可用的第二张券</span><span style="color:var(--text-3)">-¥0.00</span></div>\`}
    </div>\`;
  return \`<div class="stack" style="margin-top:12px;gap:10px">
    <div class="tipbar">\${I.info}<p>一单只能用 1 张券。\${PLAN.split.secondCoupon
      ? (PLAN.split.delta > 0 ? '拆成 2 单可多省 ' + money(PLAN.split.delta) + '。' : '拆成 2 单并不更省。')
      : '第二张券用不上这些商品，拆开只会多一个取餐码。'}</p></div>
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      \${order(o1)}
      <div class="divider"></div>
      \${order(o2)}
    </div>
    <div class="row" style="background:var(--surface-2);border-radius:var(--r-md);padding:10px 12px">
      <span style="display:flex;align-items:baseline;gap:7px"><span class="muted">合计</span><b class="num" style="font-size:20px;font-weight:700">\${money(PLAN.split.total)}</b></span>
      <span style="font-size:10px;color:var(--brand-ink);font-weight:600">\${PLAN.split.note}</span>
    </div>
    <div class="card" style="padding:12px;display:flex;flex-direction:column;gap:5px;border-color:var(--warn-border)">
      <div style="font-size:11px;font-weight:600;color:var(--warn-strong)">拆单的代价</div>
      <div class="price-note" style="line-height:1.55">· \${splitData().length} 个取餐码，需分\${splitData().length}次取餐</div>
      <div class="price-note" style="line-height:1.55">· 两单分别支付，第 2 单失败不会影响第 1 单</div>
    </div>
  </div>\`;
}

function lockTime() {
  const d = new Date(Date.now() + 15 * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* =========================================================================
   渲染：买卡（S3）
   ========================================================================= */
function renderCard() {
  const C = cardData();
  if (!C) {
    const scr0 = $('[data-scr="card"]');
    scr0.innerHTML = \`\${navrow({ title: '今天中午 · 方案', back: true })}
      <div class="scr-body"><div class="card" style="margin-top:12px;padding:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">当前没有买卡建议</div>
        <div class="price-note" style="line-height:1.6">常点商品里没有"随单购权益价"，买卡不会更便宜。
        只有菜单价本身绑定了会员权益时，买卡才谈得上回本——否则这就是在帮商家卖卡。</div>
      </div></div>
      <div class="scr-foot"><button class="btn-primary" data-act="back-plan">回到方案</button></div>\`;
    return;
  }
  const total = S.buyCard ? C.withCard : C.noCard;
  const items = S.buyCard
    ? [C.item, C.cardFee]
    : [{ n: C.item.n, p: C.noCard }];
  const scr = $('[data-scr="card"]');
  scr.innerHTML = \`\${navrow({ title: '今天中午 · 方案', back: true })}
  <div class="scr-body">
    <div class="intent">
      <div class="intent-top"><span class="intent-tag">想吃这个 · 常点</span><span class="intent-sub">\${S.buyCard ? '含麦金卡月卡' : '按无卡价'}</span></div>
      <div class="intent-name">\${C.item.n.replace(' ×1', '')}</div>
    </div>
    <div class="grp" style="margin-top:12px">
      <button class="gcard \${!S.buyCard ? 'on' : ''}" data-act="card-buy" data-val="no">
        <span class="gcard-top"><span class="gcard-k">不买卡</span><span class="gcard-v">按无卡价</span></span>
        <span class="gcard-p num">\${money(C.noCard)}</span>
      </button>
      <button class="gcard \${S.buyCard ? 'on' : ''}" data-act="card-buy" data-val="yes">
        <span class="gcard-top"><span class="gcard-k">买卡 · ¥\${C.cardFee.p}/月</span><span class="gcard-v">\${C.single > 0 ? '这单省 ' + money(C.single) : '这单贵 ' + money(-C.single)}</span></span>
        <span class="gcard-p num">\${money(C.withCard)}</span>
      </button>
    </div>
    <div class="card" style="margin-top:12px;display:flex;flex-direction:column;gap:11px">
      <div style="font-size:13px;font-weight:600">结算明细</div>
      <div class="stack tight">
        \${items.map((i) => \`<div class="item"><span class="item-n">\${i.n}</span><span class="item-p">\${money(i.p)}</span></div>\`).join('')}
      </div>
      <div class="divider"></div>
      <div class="row"><span class="muted">此单实付\${S.buyCard ? ' · 卡价已计入' : ''}</span><b class="num" style="font-size:22px;font-weight:700;color:var(--brand)">\${money(total)}</b></div>
      <div class="price-note">麦金卡与商品在同一张单里，价格完全透明</div>
    </div>
    <div class="card" style="margin-top:10px;background:var(--warn-bg);border-color:transparent;padding:12px;display:flex;flex-direction:column;gap:5px">
      <div style="font-size:11px;font-weight:600;color:var(--warn-text)">这张卡值不值</div>
      <div class="price-note" style="line-height:1.55">\${C.text}</div>
      <div style="font-size:11.5px;font-weight:600;color:var(--warn-text)">结论：按月\${C.verdict}（净省 ¥\${C.netMonth.toFixed(2)}/月）；只买这一次则\${C.single > 0 ? '划算' : '不划算'}</div>
    </div>
    <div class="card" style="margin-top:10px;padding:12px 14px;display:flex;align-items:stretch">
      <div style="flex:1"><div style="font-size:9.5px;color:var(--text-4)">有效期</div><div style="font-size:11.5px;font-weight:500;margin-top:2px">30 天</div></div>
      <div style="width:1px;background:var(--border-2);margin:0 12px"></div>
      <div style="flex:1"><div style="font-size:9.5px;color:var(--text-4)">结算</div><div style="font-size:11.5px;font-weight:500;margin-top:2px">同单计入</div></div>
      <div style="width:1px;background:var(--border-2);margin:0 12px"></div>
      <div style="flex:1"><div style="font-size:9.5px;color:var(--text-4)">撤销</div><div style="font-size:11.5px;font-weight:500;margin-top:2px">卡费随单作废</div></div>
    </div>
  </div>
  <div class="scr-foot">
    <div class="foot-hint">卡与商品同单结算 · 生成后可撤销，卡费随单作废</div>
    <button class="btn-primary" data-act="make-card">生成待支付订单（\${S.buyCard ? '含麦金卡' : '不含卡'}）</button>
  </div>\`;
}

/* =========================================================================
   渲染：待支付（S5 / S6）
   ========================================================================= */
function renderPay() {
  if (!S.orders.length) { setScreen('plan'); renderPlan(); return; }
  const multi = S.orders.length > 1;
  const total = S.orders.reduce((a, o) => a + o.total, 0);
  const allPaid = S.orders.every((o) => o.status === 'paid');
  const next = S.orders.find((o) => o.status === 'pending');
  const out = [];
  const nav = navrow({ title: multi ? '待支付 · 2 单' : '待支付', back: true, timer: S.remaining });

  if (multi) {
    out.push(\`<div class="row" style="margin-bottom:12px;align-items:flex-end">
      <div><div class="muted">2 单合计</div><div class="num" style="font-size:28px;font-weight:700;color:var(--brand);letter-spacing:-.02em">\${money(total)}</div></div>
      <span style="font-size:10.5px;color:var(--brand-ink);font-weight:600">\${PLAN && PLAN.split ? PLAN.split.note : ''}</span>
    </div>\`);
    out.push('<div class="stack">' + S.orders.map((o, idx) => ordCard(o, idx)).join('') + '</div>');
    out.push(\`<div class="card" style="margin-top:10px;padding:12px;background:var(--surface-2);border-color:transparent;display:flex;flex-direction:column;gap:5px">
      <div class="price-note" style="line-height:1.55">· 两单独立支付、独立撤销，互不影响</div>
      <div class="price-note" style="line-height:1.55">· 第 2 单失败不会让第 1 单变成孤儿单</div>
    </div>\`);
    out.push(\`<div class="card" style="margin-top:10px;padding:14px;display:flex;flex-direction:column;gap:8px">
      <div class="muted" style="font-weight:500">金额构成</div>
      <div class="kv"><dt>商品小计</dt><dd>\${money(S.orders.reduce((a2, o) => a2 + o.original, 0))}</dd></div>
      <div class="kv"><dt>券抵扣 · \${S.orders.filter((o) => o.coupon).length} 张</dt><dd class="brand">-\${money(S.orders.reduce((a2, o) => a2 + (o.coupon ? o.coupon.off : 0), 0))}</dd></div>
      <div class="divider"></div>
      <div class="kv"><dt>两单实付</dt><dd style="font-weight:700;font-size:15px">\${money(total)}</dd></div>
    </div>\`);
  } else {
    const o = S.orders[0];
    out.push(\`<div class="card amount-card">
      <div class="row"><span class="muted">实付金额</span><span class="muted">待支付 · 15 分钟内有效</span></div>
      <div class="row" style="align-items:flex-end">
        <div class="amount-big num">\${money(o.total)}</div>
        <div class="amount-side">
          <span class="save">\${o.coupon ? '已省 ' + money(o.coupon.off) : '未使用券'}</span>
          <span class="strike">原价 \${money(o.original)}</span>
        </div>
      </div>
      <div class="divider"></div>
      <div class="row"><span class="price-note" style="color:var(--text-4)">订单号 · 尾号 \${o.tail}</span><span class="chip chip-warn">待支付</span></div>
      <div class="stack tight">
        \${o.items.map((i) => \`<div class="item"><span class="item-n">\${i.n}</span><span class="item-p">\${money(i.p)}</span></div>\`).join('')}
        \${o.coupon ? \`<div class="item"><span class="item-n" style="color:var(--brand-ink)">\${o.coupon.name}（已锁定）</span><span class="item-p coupon">-\${money(o.coupon.off)}</span></div>\` : ''}
      </div>
      <div class="price-note">共 \${o.items.length} 件商品\${o.coupon ? ' · 用券 1 张' : ''} · 外带自取</div>
    </div>\`);
    out.push(\`<div class="store-row" style="margin-top:10px">\${I.store}
      <div><div class="t">\${storeName()} · 外带自取</div><div class="s">支付成功后生成取餐码</div></div>
      \${I.chev}
    </div>\`);
    out.push(paywayCard());
    out.push(qrCard());
  }

  const foot = [];
  foot.push(\`<div class="foot-hint">未支付不产生费用 · 撤销后订单立即失效</div>\`);
  const cta = multi
    ? (next ? \`支付第 \${S.orders.indexOf(next) + 1} 单 \${money(next.total)}\` : '全部已支付')
    : \`去支付 \${money(S.orders[0].total)}\`;
  foot.push(\`<div class="btn-row">
    <button class="btn-danger" data-act="\${multi ? 'cancel-all' : 'cancel'}">\${multi ? '撤销全部' : '撤销订单'}</button>
    <button class="btn-primary" data-act="pay" \${next ? '' : 'disabled'}>\${cta}</button>
  </div>\`);
  if (multi) foot.push(\`<div class="foot-hint" style="margin:8px 0 0">按顺序支付更省心；也可以单独支付任意一单</div>\`);

  const scr = $('[data-scr="pay"]');
  scr.innerHTML = \`\${nav}<div class="scr-body">\${out.join('')}</div><div class="scr-foot">\${foot.join('')}</div>\`;
}

function ordCard(o, idx) {
  const paid = o.status === 'paid';
  return \`<div class="ord-card">
    <div class="ord-head">
      <b>第 \${idx + 1} 单 · \${o.short}</b>
      <span class="chip \${paid ? 'chip-ok' : 'chip-warn'}">\${paid ? '已支付' : '待支付'}</span>
    </div>
    \${o.items.map((i) => \`<div class="ord-line"><span>\${i.n}</span><span>\${money(i.p)}</span></div>\`).join('')}
    \${o.coupon
      ? \`<div class="ord-line"><span style="color:var(--brand-ink)">\${o.coupon.name}</span><span style="color:var(--brand-ink)">-\${money(o.coupon.off)}</span></div>\`
      : \`<div class="ord-line"><span style="color:var(--text-3)">没有可用的券</span><span style="color:var(--text-3)">-¥0.00</span></div>\`}
    <div class="ord-foot">
      <span class="price-note" style="color:var(--text-4)">\${paid ? \`取餐码 <b class="code-inline">\${o.code}</b>\` : '取餐码 支付后生成'}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <b class="ord-total">\${money(o.total)}</b>
        \${paid ? '' : \`<button class="btn-sm" data-act="pay" data-order="\${o.id}">去支付</button>\`}
      </span>
    </div>
  </div>\`;
}

function paywayCard() {
  const m = S.payMethod;
  return \`<div class="payway" style="margin-top:10px">
    <h3>支付方式 · 付款在麦当劳支付页完成</h3>
    <button class="pway \${m === 'wechat' ? 'on' : ''}" data-act="paymethod" data-val="wechat">
      <span class="pradio"></span><span class="nm">微信支付</span><span class="tag">系统默认</span>
    </button>
    <button class="pway \${m === 'alipay' ? 'on' : ''}" data-act="paymethod" data-val="alipay">
      <span class="pradio"></span><span class="nm">支付宝</span><span class="tag"></span>
    </button>
    <p class="note">这里只做展示与唤起，本产品不收集支付信息</p>
  </div>\`;
}

function qrCard() {
  return \`<div class="qr-card" style="margin-top:10px">
    <div class="qr-box">\${qrSvg()}</div>
    <div class="qr-txt">
      <b>扫码支付</b>
      <p>可用另一台设备扫码，或在 App 内支付</p>
      <p class="qr-warn">含订单号，一次性凭证，请勿截图分享</p>
    </div>
  </div>\`;
}

function qrSvg() {
  const N = 25, cell = 100 / N;
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const inFinder = (x, y) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
  let r = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (inFinder(x, y)) continue;
    if (rnd() > 0.52) r += \`<rect x="\${(x * cell).toFixed(2)}" y="\${(y * cell).toFixed(2)}" width="\${cell.toFixed(2)}" height="\${cell.toFixed(2)}"/>\`;
  }
  const finder = (px, py) => \`<rect x="\${px * cell}" y="\${py * cell}" width="\${7 * cell}" height="\${7 * cell}" fill="none" stroke="currentColor" stroke-width="\${cell}"/><rect x="\${(px + 2) * cell}" y="\${(py + 2) * cell}" width="\${3 * cell}" height="\${3 * cell}"/>\`;
  return \`<svg viewBox="0 0 100 100" fill="currentColor" shape-rendering="crispEdges">\${r}\${finder(0, 0)}\${finder(N - 7, 0)}\${finder(0, N - 7)}</svg>\`;
}

/* =========================================================================
   渲染：过期（S7）
   ========================================================================= */
function renderExpired() {
  if (!S.orders.length) { setScreen('plan'); renderPlan(); return; }
  const o = S.orders[0] || { total: 0, original: 0, items: [], tail: '6218' };
  const scr = $('[data-scr="expired"]');
  scr.innerHTML = \`\${navrow({ title: '待支付', back: true, chip: '<span class="chip chip-gray">已失效</span>' })}
  <div class="scr-body">
    <div class="card big-card" style="align-items:flex-start;text-align:left;flex-direction:row;gap:14px;align-items:center">
      <div class="fail-icon">\${I.fail}</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <div style="font-size:17px;font-weight:600">订单已失效</div>
        <div class="price-note" style="line-height:1.55">\${expireStamp()} 生成 · 15 分钟未支付</div>
        <div class="price-note" style="color:var(--text-4)">原订单已由系统置为「订单已取消」</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
      <div class="row"><span class="muted">原订单内容</span><span class="price-note" style="color:var(--text-4)">已失效</span></div>
      <div class="stack tight">
        \${(o.items || []).map((i) => \`<div class="item"><span class="item-n" style="color:var(--text-3)">\${i.n}</span><span class="item-p" style="color:var(--text-4)">\${money(i.p)}</span></div>\`).join('')}
      </div>
      <div class="divider"></div>
      <div class="row"><span class="muted">实付金额</span><span class="strike" style="font-size:18px;font-weight:600">\${money(o.total)}</span></div>
    </div>
    <div class="card" style="margin-top:10px;padding:13px 14px;display:flex;flex-direction:column;gap:6px">
      <div style="font-size:11px;font-weight:600">为什么不能直接复用这张单</div>
      <div class="price-note" style="line-height:1.55">· 15 分钟内价格、库存、券状态都可能变，复用旧单会给出错误的承诺</div>
      <div class="price-note" style="line-height:1.55">· 重新生成 = 重新跑 calculate-price → create-order，拿新的 expirePayTime</div>
      <div class="price-note" style="line-height:1.55">· 旧单已由系统置为已取消，不会重复扣费</div>
    </div>
  </div>
  <div class="scr-foot">
    <div class="foot-hint">重新结算后价格可能变化，会先在方案卡上展示</div>
    <button class="btn-primary" data-act="resettle">重新结算并生成</button>
    <button class="btn-ghost" data-act="back-plan" style="width:100%;margin-top:8px">返回方案卡</button>
  </div>\`;
}
function expireStamp() {
  const d = new Date(Date.now() - 15 * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* =========================================================================
   渲染：支付未完成（S9）
   —— 用户在 payH5Url 付款页中断或按返回，回调没有回来。订单还在、倒计时还在走。
      这一屏只回答两个问题：钱到底扣了没有、现在该点哪个按钮。
   ========================================================================= */
function renderPayFail() {
  if (!S.orders.length) { setScreen('plan'); renderPlan(); return; }
  const o = S.orders[0] || { total: 0, original: 0, items: [], tail: '6218', coupon: null };
  const scr = $('[data-scr="fail"]');
  scr.innerHTML = \`\${navrow({ title: '待支付', back: true, timer: S.remaining })}
  <div class="scr-body">
    <div class="card" style="display:flex;gap:13px;align-items:center">
      <div style="width:52px;height:52px;border-radius:50%;background:var(--warn-bg);color:var(--warn-strong);display:flex;align-items:center;justify-content:center;flex:0 0 auto">
        <svg viewBox="0 0 24 24" width="25" height="25" fill="none"><circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.2V12l3.5 2.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;min-width:0">
        <div style="font-size:17px;font-weight:600">支付未完成</div>
        <div class="price-note" style="line-height:1.55">付款页已关闭，没有收到支付结果</div>
        <div class="price-note" style="color:var(--warn-strong);font-weight:600">订单仍有效 · 剩 <span id="failLeft">\${mmss(S.remaining)}</span> 可付款</div>
      </div>
    </div>
    <div class="card" style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
      <div class="row"><span class="muted">这一单</span><span class="price-note" style="color:var(--text-4)">尾号 \${o.tail} · 未支付</span></div>
      <div class="stack tight">
        \${(o.items || []).map((i) => \`<div class="item"><span class="item-n" style="color:var(--text-2)">\${i.n}</span><span class="item-p">\${money(i.p)}</span></div>\`).join('')}
        \${o.coupon ? \`<div class="item"><span class="item-n" style="color:var(--brand-ink)">\${o.coupon.name}（仍锁定）</span><span class="item-p coupon">-\${money(o.coupon.off)}</span></div>\` : ''}
      </div>
      <div class="divider"></div>
      <div class="row"><span class="muted">应支付</span><b class="num" style="font-size:20px;font-weight:700;color:var(--brand)">\${money(o.total)}</b></div>
    </div>
    <div class="card" style="margin-top:10px;padding:13px 14px;display:flex;flex-direction:column;gap:9px">
      <div class="pts-h">先确认钱扣了没有</div>
      <div style="font-size:11.5px;line-height:1.6;color:var(--text-2)"><b style="display:block;color:var(--text);margin-bottom:2px">如果已经扣款</b>别重复支付。系统会自动核对，成功后这里直接变取餐码。</div>
      <div class="divider"></div>
      <div style="font-size:11.5px;line-height:1.6;color:var(--text-2)"><b style="display:block;color:var(--text);margin-bottom:2px">如果没扣款</b>点「继续支付」回到付款页。价格和券仍锁在这张单上，不会变。</div>
    </div>
  </div>
  <div class="scr-foot">
    <div class="foot-hint">倒计时结束仍未支付即自动失效，可随时撤销</div>
    <div class="btn-row">
      <button class="btn-danger" data-act="cancel">撤销订单</button>
      <button class="btn-primary" data-act="pay">继续支付 \${money(o.total)}</button>
    </div>
  </div>\`;
}

/* =========================================================================
   渲染：成功（S8）
   ========================================================================= */
function renderSuccess() {
  if (!S.orders.length) { setScreen('plan'); renderPlan(); return; }
  const multi = S.orders.length > 1;
  const first = S.orders[0];
  const out = [];
  const nav = navrow({ title: '订单详情', back: false });

  if (!multi) {
    out.push(\`<div class="card big-card">
      <span class="ok-chip">\${I.check}支付成功</span>
      <div class="price-note" style="margin-top:2px">取餐码</div>
      <div class="pickup num">\${first.code}</div>
      <div class="divider" style="width:100%"></div>
      <div style="font-size:12px;font-weight:500">\${storeName()} · 外带自取</div>
      <div class="price-note">请到取餐台出示此码 · 预计 10 分钟内出餐</div>
      \${I.barcode}
    </div>\`);
  } else {
    out.push(\`<div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div class="row"><span class="ok-chip">\${I.check}2 单均已支付</span><span class="price-note">共 2 个取餐码</span></div>
      \${S.orders.map((o, i) => \`<div class="row" style="align-items:flex-end">
        <div><div class="price-note">第 \${i + 1} 单 · \${o.short}</div><div class="pickup num" style="font-size:38px">\${o.code}</div></div>
        <span class="price-note" style="text-align:right">\${money(o.total)}<br>已支付</span>
      </div>\${i === 0 ? '<div class="divider"></div>' : ''}\`).join('')}
      <div class="price-note">两单各自出码，需分两次取餐</div>
    </div>\`);
  }

  const total = S.orders.reduce((a, o) => a + o.total, 0);
  out.push(\`<div class="card" style="margin-top:12px;display:flex;flex-direction:column;gap:9px">
    <div class="muted" style="font-weight:500">订单信息</div>
    <div class="kv"><dt>实付金额</dt><dd style="font-weight:600">\${money(total)}</dd></div>
    <div class="kv"><dt>支付方式</dt><dd>\${S.payMethod === 'wechat' ? '微信支付' : '支付宝'}</dd></div>
    <div class="kv"><dt>支付时间</dt><dd>\${new Date().toISOString().slice(0, 10)} \${clockNow().slice(0, 5)}</dd></div>
    <div class="kv"><dt>已使用券</dt><dd class="brand">\${multi ? '2 张（各 1 张）' : first.coupon ? first.coupon.name.replace('券 · ', '') : '未使用'}</dd></div>
    <div class="kv"><dt>订单号</dt><dd>…\${multi ? S.orders.map((o) => o.tail).join(' / ') : first.tail}</dd></div>
  </div>\`);

  const scr = $('[data-scr="success"]');
  scr.innerHTML = \`\${nav}<div class="scr-body">\${out.join('')}</div>
  <div class="scr-foot">
    <div class="foot-hint">取餐码在支付成功后生成，请勿提前到店</div>
    <div class="btn-row">
      <button class="btn-ghost" data-act="again">再来一单</button>
      <button class="btn-primary" data-act="save-code">保存取餐码</button>
    </div>
  </div>\`;
}

/* =========================================================================
   侧栏
   ========================================================================= */
function renderPanel() {
  const jump = jumpIdFor();
  $$('#jumps button').forEach((b) => b.classList.toggle('on', b.dataset.val === jump));
  $('#scrTag').textContent = S.screen;
  const p = planData();
  $('#stPlan').textContent = S.screen === 'card'
    ? \`买卡 \${S.buyCard ? money((cardData() || { withCard: 0 }).withCard) : money((cardData() || { noCard: 0 }).noCard)}\`
    : \`\${p.name} · \${S.group === 'split' ? '拆单' : '合单'}\${S.degrade ? ' · 降级' : ''}\`;
  $('#stOrders').textContent = S.orders.length
    ? S.orders.map((o) => o.status === 'paid' ? \`已支付 \${o.code}\` : o.status === 'pending' ? '待支付' : o.status === 'cancelled' ? '已撤销' : '已失效').join(' / ')
    : '无';
  $('#stTimer').textContent = S.screen === 'pay' ? mmss(S.remaining) : '—';
  $('#stMoney').textContent = S.screen === 'card' ? money(S.buyCard ? (cardData() || { withCard: 0 }).withCard : (cardData() || { noCard: 0 }).noCard)
    : S.orders.length ? money(S.orders.reduce((a, o) => a + o.total, 0)) : money(p.total);
  const key = S.screen === 'plan' ? (S.degrade ? 'plan:degrade' : S.group === 'split' ? 'plan:split' : 'plan:single')
    : S.screen === 'pay' ? (S.orders.length > 1 ? 'pay:2' : 'pay:1') : S.screen === 'card' ? 'card' : S.screen;
  $('#cap').textContent = CAPS[key] || key;
}

/* =========================================================================
   订单
   ========================================================================= */
let seq = 0;
function newId() {
  seq += 1;
  return '10302915700006619810534162' + String(10 + (seq % 80));
}
function createOrders(kind) {
  if (kind === 'split') {
    S.orders = splitData().map((o) => ({
      ...o, id: newId(), tail: newId().slice(-4), short: o.label.replace('单 1 · ', '').replace('单 2 · ', ''),
      status: 'pending', code: null, original: o.items.reduce((a, i) => a + i.p, 0),
    }));
  } else if (kind === 'card') {
    const C = cardData();
    if (!C) return;
    const t = S.buyCard ? C.withCard : C.noCard;
    const items = S.buyCard ? [C.item, C.cardFee] : [{ n: C.item.n, p: C.noCard }];
    const id = newId();
    S.orders = [{ id, tail: id.slice(-4), short: C.item.n.replace(' ×1', ''), items, coupon: null, total: t, original: t, status: 'pending', code: null }];
  } else {
    const p = planData();
    const id = newId();
    S.orders = [{
      id, tail: id.slice(-4), short: p.name, items: p.items, coupon: p.coupon,
      total: p.total, original: p.original, status: 'pending', code: null,
    }];
  }
  S.remaining = 900;
}

const CODES = ['A127', 'B043'];
function markPaid(order) {
  order.status = 'paid';
  const idx = S.orders.indexOf(order);
  order.code = CODES[idx] || 'C' + (120 + idx);
}

/* =========================================================================
   计时
   ========================================================================= */
let timer = null;
function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (S.screen !== 'pay' && S.screen !== 'fail') return;
    S.remaining = Math.max(0, S.remaining - 1);
    const t = $('#timerText'), chip = $('#timerChip'), fl = $('#failLeft');
    if (t) t.textContent = mmss(S.remaining);
    if (fl) fl.textContent = mmss(S.remaining);
    if (chip) chip.classList.toggle('low', S.remaining <= 120);
    const hint = document.querySelector('[data-scr="fail"] .foot-hint');
    if (S.remaining % 5 === 0) renderPanel();
    if (S.remaining === 0) expireOrders();
  }, 1000);
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

function expireOrders() {
  stopTimer();
  S.orders.forEach((o) => { if (o.status === 'pending') o.status = 'expired'; });
  logEvent('expirePayTime 到达 · 订单失效', 'warn');
  toast('订单已失效，未产生任何费用', 'warn');
  setScreen('expired');
}

/* =========================================================================
   动作
   ========================================================================= */
function setBusy(btn, text) {
  if (!btn) return;
  if (text === null) {
    if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    btn.disabled = false;
    delete btn.dataset.orig;
    return;
  }
  btn.dataset.orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = \`<span class="spin"></span><span>\${text}</span>\`;
}

async function makeOrder(btn, kind) {
  const split = kind === 'split';
  setBusy(btn, split ? '正在依次生成订单…' : '正在校验价格…');
  logEvent(split ? 'calculate-price ×2 · 串行' : 'calculate-price 重校验');
  await wait(split ? 1250 : 950);

  if (!split && kind === 'single' && S.scenario === 'stockout' && !S.degrade && !!(PLAN && PLAN.degrade)) {
    setBusy(btn, null);
    S.degrade = true;
    S.scenario = 'normal';
    renderPlan();
    syncScenarioUI();
    logEvent('60006 商品已售罄 → 同类替代，价差 +¥0.50', 'warn');
    toast('1 项商品已不可售，已替换同类并保留价差说明', 'warn');
    return;
  }

  createOrders(kind);
  logEvent(split ? 'create-order ×2 成功 · 待支付' : 'create-order 成功 · 待支付', 'ok');
  renderPay();
  startTimer();
  setScreen('pay');
  toast(split ? '已生成 2 张待支付订单，15 分钟内有效' : '已生成待支付订单，15 分钟内有效', 'ok');
}

function openSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheetWrap').hidden = false;
}
function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }

function cancelSheet() {
  const multi = S.orders.length > 1;
  openSheet(\`<div class="sheet-grip"></div>
    <h3>\${multi ? '撤销这 2 张订单？' : '撤销这张订单？'}</h3>
    <p class="sheet-sub">撤销后订单立即失效，不会产生任何费用；占用的券会释放回账户。</p>
    <div class="sheet-actions">
      <button class="btn-ghost" data-act="close-sheet">再想想</button>
      <button class="btn-danger" data-act="do-cancel">确认撤销</button>
    </div>\`);
}

function doCancel() {
  const n = S.orders.length;
  S.orders.forEach((o) => { if (o.status === 'pending') o.status = 'cancelled'; });
  stopTimer();
  closeSheet();
  S.notice = \`上一张\${n > 1 ? '（组）' : ''}待支付订单已撤销 · 未产生费用\`;
  S.orders = [];
  S.remaining = 900;
  logEvent(\`cancel-order(reasonCode=3) ×\${n} · 订单已取消\`, 'brand');
  renderPlan();
  setScreen('plan');
  toast('订单已撤销，未产生任何费用', 'ok');
}

function paySheet(order) {
  S.payTarget = order.id;
  const m = S.payMethod;
  openSheet(\`<div class="sheet-grip"></div>
    <h3>确认支付</h3>
    <p class="sheet-sub">订单 · 尾号 \${order.tail}\${S.orders.length > 1 ? ' · 第 ' + (S.orders.indexOf(order) + 1) + ' 单' : ''}</p>
    <div class="sheet-amount num">\${money(order.total)}</div>
    <div class="paylist">
      <button class="pitem \${m === 'wechat' ? 'on' : ''}" data-act="sheet-method" data-val="wechat">
        <span class="pradio"></span><span class="nm">微信支付</span><span class="tag">推荐</span>
      </button>
      <button class="pitem \${m === 'alipay' ? 'on' : ''}" data-act="sheet-method" data-val="alipay">
        <span class="pradio"></span><span class="nm">支付宝</span><span class="tag"></span>
      </button>
    </div>
    <button class="btn-primary" data-act="do-pay">确认支付 \${money(order.total)}</button>
    <p class="sheet-note">确认后跳转麦当劳支付页（payH5Url）完成付款，本产品不收集支付信息</p>\`);
}

async function doPay() {
  const order = S.orders.find((o) => o.id === S.payTarget);
  if (!order || order.status !== 'pending') return;
  const sheet = $('#sheet');
  sheet.innerHTML = \`<div class="sheet-grip"></div><div class="paying"><span class="spin"></span><p>支付确认中…</p></div>\`;
  logEvent('payH5Url 唤起支付 · 等待回调');
  await wait(1150);

  if (S.scenario === 'abort') {
    S.scenario = 'normal';
    syncScenarioUI();
    closeSheet();
    renderPayFail();
    setScreen('fail');
    logEvent('支付回调未返回 · 订单仍待支付', 'warn');
    toast('没有收到支付结果，订单仍然有效', 'warn');
    return;
  }

  markPaid(order);
  closeSheet();
  const allPaid = S.orders.every((o) => o.status === 'paid');
  logEvent(\`支付成功 · \${order.code}\`, 'ok');
  if (allPaid) {
    stopTimer();
    renderSuccess();
    setScreen('success');
    toast(S.orders.length > 1 ? '2 单均已支付，2 个取餐码已生成' : '支付成功，取餐码已生成', 'ok');
  } else {
    renderPay();
    const n = S.orders.filter((o) => o.status === 'paid').length;
    toast(\`第 \${n} 单已支付，继续支付第 \${n + 1} 单\`, 'ok');
  }
}

function jumpTo(id) {
  stopTimer();
  closeSheet();
  S.orders = [];
  S.degrade = false;
  S.notice = null;
  S.group = 'single';
  S.planId = (PLAN && PLAN.best) || 'plain';
  S.buyCard = true;
  S.remaining = 900;
  S.altOpen = false;

  if (id === 's1') { setScreen('plan'); renderPlan(); logEvent('直达 S1 · 合单主态'); }
  if (id === 's2') { S.group = 'split'; renderPlan(); setScreen('plan'); logEvent('直达 S2 · 拆单对比'); }
  if (id === 's3') { renderCard(); setScreen('card'); logEvent('直达 S3 · 买卡双栏'); }
  if (id === 's4') { S.degrade = true; renderPlan(); setScreen('plan'); logEvent('直达 S4 · 重校验降级', 'warn'); }
  if (id === 's5') { S.group = 'single'; createOrders('single'); renderPay(); setScreen('pay'); startTimer(); logEvent('直达 S5 · 待支付主态'); }
  if (id === 's6') { S.group = 'split'; createOrders('split'); renderPay(); setScreen('pay'); startTimer(); logEvent('直达 S6 · 拆单 2 单'); }
  if (id === 's7') { S.group = 'single'; createOrders('single'); S.orders.forEach((o) => (o.status = 'expired')); renderExpired(); setScreen('expired'); logEvent('直达 S7 · 已过期', 'warn'); }
  if (id === 's9') { S.group = 'single'; createOrders('single'); renderPayFail(); setScreen('fail'); startTimer(); logEvent('直达 S9 · 支付未完成', 'warn'); }
  if (id === 's8') { S.group = 'single'; createOrders('single'); S.orders.forEach((o) => markPaid(o)); renderSuccess(); setScreen('success'); logEvent('直达 S8 · 支付成功', 'ok'); }
  renderPanel();
}

function syncScenarioUI() {
  $$('[data-act="scenario"]').forEach((b) => b.classList.toggle('on', b.dataset.val === S.scenario));
}

/* =========================================================================
   事件委托
   ========================================================================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const val = el.dataset.val;

  switch (act) {
    case 'theme': {
      S.theme = val;
      document.documentElement.dataset.theme = val;
      $$('[data-act="theme"]').forEach((b) => b.classList.toggle('on', b.dataset.val === val));
      logEvent(\`切换主题 · \${val === 'dark' ? '深色' : '浅色'}\`);
      break;
    }
    case 'reset': {
      jumpTo('s1');
      S.log = [];
      renderLog();
      S.notice = null;
      logEvent('原型已重置');
      toast('已回到 S1');
      break;
    }
    case 'scenario': {
      S.scenario = val;
      syncScenarioUI();
      logEvent(\`场景 · \${val === 'stockout' ? '提交时售罄' : '价格正常'}\`);
      toast(val === 'stockout' ? '下一次生成订单会触发重校验降级' : '已恢复价格正常场景');
      break;
    }
    case 'jump': jumpTo(val); break;

    case 'range': {
      S.spec = val;
      recompute(false);
      try { history.replaceState(null, '', '?range=' + encodeURIComponent(val) + (S.strat ? '&strat=' + encodeURIComponent(S.strat) : '') + (S.fromLedger ? '&from=ledger' : '')); } catch (e) {}
      if (S.screen === 'plan') renderPlan(); else jumpTo('s1');
      logEvent('切换区间 · ' + (RANGES.find((r) => r.key === val) || {}).label + (PLAN && PLAN.ok ? ' · 常点：' + PLAN.basket.map((x) => x.name).join('/') : ''));
      toast('已按' + ((RANGES.find((r) => r.key === val) || {}).label || val) + '重算方案');
      break;
    }
    case 'toggle-src': {
      S.srcOpen = !S.srcOpen;
      renderPlan();
      break;
    }
    case 'group': {
      S.group = val;
      renderPlan();
      logEvent(val === 'split' ? '切换方案组 · 拆单 2 单' : '切换方案组 · 合单 1 单');
      break;
    }
    case 'toggle-alt': {
      S.altOpen = !S.altOpen;
      renderPlan();
      if (S.altOpen) {
        requestAnimationFrame(() => {
          const card = $('.alt-card');
          if (card) card.scrollIntoView({ block: 'end', behavior: 'smooth' });
        });
      }
      logEvent(S.altOpen ? '展开其他买法' : '收起其他买法');
      break;
    }
    case 'pick-plan': {
      S.planId = val;
      S.group = 'single';
      S.degrade = false;
      renderPlan();
      renderPanel();
      logEvent(\`切换主方案 · \${planData().name}\`);
      toast(\`已切换为「\${planData().name}」\`);
      break;
    }
    case 'restore': {
      S.planId = (PLAN && PLAN.best) || 'plain';
      S.group = 'single';
      renderPlan();
      renderPanel();
      logEvent('恢复推荐方案');
      break;
    }
    case 'dismiss-notice': { S.notice = null; renderPlan(); break; }

    case 'make-order': await makeOrder(el, S.group === 'split' ? 'split' : 'single'); break;
    case 'revert-degrade': {
      S.degrade = false;
      renderPlan();
      renderPanel();
      logEvent('放弃降级，回到原方案');
      toast('已回到原方案，可重新生成');
      break;
    }
    case 'open-card': {
      renderCard();
      setScreen('card');
      logEvent('打开买卡方案 · S3');
      break;
    }
    case 'card-buy': {
      S.buyCard = val === 'yes';
      renderCard();
      renderPanel();
      const C = cardData();
      logEvent(\`买卡选择 · \${S.buyCard ? '买卡 ' + money((C || { withCard: 0 }).withCard) : '不买卡 ' + money((C || { noCard: 0 }).noCard)}\`);
      break;
    }
    case 'make-card': await makeOrder(el, 'card'); break;
    case 'back-plan': {
      stopTimer();
      renderPlan();
      setScreen('plan');
      logEvent('返回方案卡');
      break;
    }

    case 'paymethod': {
      S.payMethod = val;
      renderPay();
      logEvent(\`支付方式 · \${val === 'wechat' ? '微信支付' : '支付宝'}\`);
      break;
    }
    case 'pay': {
      const order = el.dataset.order ? S.orders.find((o) => o.id === el.dataset.order) : S.orders.find((o) => o.status === 'pending');
      if (order) { paySheet(order); logEvent(\`申请支付 · 尾号 \${order.tail}\`); }
      break;
    }
    case 'sheet-method': {
      S.payMethod = val;
      $$('#sheet .pitem').forEach((b) => b.classList.toggle('on', b.dataset.val === val));
      break;
    }
    case 'close-sheet': closeSheet(); break;
    case 'cancel': case 'cancel-all': cancelSheet(); logEvent('点击撤销 · 二次确认'); break;
    case 'do-cancel': doCancel(); break;
    case 'do-pay': await doPay(); break;

    case 'resettle': {
      const btn = el;
      setBusy(btn, '正在重新结算…');
      logEvent('重新跑 calculate-price');
      await wait(1000);
      createOrders('single');
      renderPay();
      setBusy(btn, null);
      startTimer();
      setScreen('pay');
      toast('已重新结算并生成新订单，价格以本页为准', 'ok');
      logEvent('create-order 成功 · 新的 expirePayTime', 'ok');
      break;
    }
    case 'again': {
      S.orders = [];
      S.group = 'single';
      S.planId = (PLAN && PLAN.best) || 'plain';
      S.degrade = false;
      S.remaining = 900;
      renderPlan();
      setScreen('plan');
      logEvent('再来一单 · 回到方案卡');
      break;
    }
    case 'save-code': toast('取餐码已保存到相册（原型示意）', 'ok'); logEvent('保存取餐码'); break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* 时钟 */
function tickClock() {
  const d = new Date();
  $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
tickClock();
setInterval(tickClock, 30000);

/* 初始化：URL 参数决定初始状态
   ?range=30d           与账本页同一套区间
   ?strat=window        从账本某条策略进来，默认选中对应买法
   ?from=ledger         显示"来自账本"横幅 */
(function init() {
  const q = new URLSearchParams(location.search);
  S.spec = q.get('range') || (RAW && RAW.spec) || '30d';
  S.strat = q.get('strat') || (RAW && RAW.strat ? RAW.strat.kind : null);
  S.fromLedger = q.get('from') === 'ledger' || !!(RAW && RAW.strat);
  recompute(false);
})();

renderPlan();
renderPanel();
renderLog();
logEvent(PLAN && PLAN.ok
  ? '原型就绪 · ' + PLAN.label + ' · ' + PLAN.orders + ' 笔 · 推荐 ' + (method(PLAN.best) || {}).name
  : '原型就绪 · 该区间无可算方案');

/* 供自动化校验读取（非产品逻辑） */
window.__proto = {
  state: S,
  go: jumpTo,
  screen: () => S.screen,
  log: () => S.log.slice(),
  toasts: () => S.toasts.slice(),
  resetLog: () => { S.log = []; S.toasts = []; renderLog(); },
};
</script>
</body>
</html>
`;

export interface PlanOptions {
  /** 从账本某条策略跳进来时带上它：原型会默认选中对应的买法并显示来源横幅 */
  strat?: Strategy | null;
}

/**
 * tokens.css 的唯一口径在 docs/tokens.css；构建时**内联**进产物，
 * 而不是外链 —— 产物要能被单独拷走（离线评审、out/ 目录直接打开），
 * 内联由构建保证，两处永远不会漂移。
 */
const TOKENS = readFileSync(join(import.meta.dirname, "../../docs/tokens.css"), "utf8");

/** JSON 里出现 </script 会截断标签，统一转义 */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPlan(view: View, ledger: LedgerData, opts: PlanOptions = {}): string {
  const plan: PlanData = buildPlan(ledger, view.spec);
  const payload = {
    spec: view.spec,
    ledger,
    plan,
    strat: opts.strat
      ? {
          kind: opts.strat.kind,
          kindLabel: opts.strat.kindLabel,
          title: opts.strat.title,
          action: opts.strat.action,
          inRange: opts.strat.inRange,
          perMonth: opts.strat.perMonth,
          confidence: opts.strat.confidence,
        }
      : null,
  };
  return TEMPLATE.replace(
    '<link rel="stylesheet" href="tokens.css">',
    "<style>\n/* 内联自 docs/tokens.css（唯一口径），由构建保证同步 */\n" + TOKENS + "\n</style>",
  ).replace(
    "<head>",
    "<head>\n<!-- 本文件由 src/render/plan.ts 生成，请勿直接编辑；交互改模板、算法改 src/engine/range.mjs -->",
  ).replace("__PLAN_DATA__", safeJson(payload)).replace(
    "__ENGINE_RUNTIME__",
    engineRuntime().replace(/<\/script/gi, "<\\/script"),
  );
}
