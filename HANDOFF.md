# mcd-ledger 开发交接文档

> 生成时间：2026-10-20 17:30（GMT+8）　|　仓库：`git@github.com:Huazai-0731/mcd-ledger.git`
> 本地路径：`D:/PROJECTS/mcd-skill/mcd-ledger`　|　版本：v0.2.0
> 追加会话：2026-10-20 20:00 —— 新增「WorkBuddy Skill 打包」（见 §1.7），改动已提交并推送（`5e4d334`）

---

## 结论先行（TL;DR）

| 项 | 状态 |
| --- | --- |
| 本次会话完成 | **第一档整合**（两页互链 + tokens 单一口径 + 门厅页）+ **第二档整合**（决策页从静态稿变成构建产物、引擎新增方案求解器、账本页层级回流、区间级联动） |
| 代码健康度 | `tsc --noEmit` 0 错误；`bench` 23/23；原型 9 态回归全绿、0 控制台异常；决策页与账本页对比度均 **0 处低于 AA** |
| 版本控制 | 追加会话（Skill 打包，`5e4d334`）已提交并推送，本地与 `origin/main` 同步 |
| 最大风险 | ① `out/` 下的校验/截图脚本被 `.gitignore` 忽略，换设备即丢失；② 若用 `--out docs` 跑真实 `audit`，真实订单数据会被写进**被 git 跟踪**的 `docs/*.html` |
| 未接线 | 真实的 `calculate-price` / `create-order` / `cancel-order` **一行代码都没写**（仅存在于原型的日志文案与注释里）。这是产品边界，不是遗漏 |

---

## 一、已完成的工作

### 1.1 引擎：新增方案求解器（第二档核心）

**文件：`src/engine/range.mjs`（1707 行，本次 +434）+ `src/engine/range.d.mts`（277 行，本次 +81）**

| 函数 / 位置 | 作用 | 关键决策 |
| --- | --- | --- |
| `buildPlan(data, spec)` @ `range.mjs:1375` | 把"过去常点什么"求解成"下一单怎么买"，返回 `PlanData` | **必须放在引擎里**：方案的每个数字都随区间变，放引擎才能让浏览器切区间时调用同一段代码，双端不可能对不上 |
| `planFocus(plan, kind)` @ `range.mjs:1664` | 策略类型（`window/price/delivery/expiry/timing`）→ 选中哪个买法 id | 粗映射即可：`window/expiry/timing` → `coupon`（无则 best）；`price` → `alt:*`；`delivery` → best |
| `topSkus(rows, menu, n)` @ `range.mjs:1347` | 常点 SKU = 区间内出现次数 Top3 | 按「出现次数」排序而非金额，因为"常点"是频次概念；单价回落到 `menu.p`，划线价取 `menu.o` |
| `couponKeyword()` / `covers()` @ `range.mjs:1286/1296` | 券名 → 商品名匹配 | 用**子序列覆盖度 ≥ 0.7** 而非子串：`"麦辣鸡腿堡"` 能命中 `"麦辣鸡腿汉堡"`。阈值硬编码在 `1363` 与 `1438` 两处 |
| `cheaperAlt(item, seen)` @ `range.mjs:1361` | 同类更便宜的买法 | 只在**订单里出现过**的 SKU 里找，避免凭空推荐没买过的东西 |
| `couponOff(c, unit)` @ `range.mjs:1330` | 单张券能抵多少 | 优先取审计层算好的 `worth`，兜底用券面价与现价之差，且 `min(worth, unit)` 不为负 |
| `couponAlive(c, nowMs)` @ `range.mjs:1322` | 券是否过期 | `validTo` 为空视为长期有效；`Date.parse` 解析失败也视为有效（保守，宁可多推不漏推） |
| 内部 `PLAN_HREF` @ `range.mjs:129`、`planHref()` @ `range.mjs:138` | 生成 `prototype-v2.html?from=ledger&range=<spec>[&strat=<kind>]` | 放在引擎里是因为**策略卡片 HTML 由引擎渲染**（`renderStrategy`），链接必须在服务端就带上当前区间 |
| 策略卡入口 @ `range.mjs:1076` | 每条策略渲染 `.strat-go`「按这个方案点 →」，带 `data-plan-link="1"` + `data-strat="${x.kind}"` | 让页面内切区间后能被 JS 批量改写 |
| 文末入口 @ `range.mjs:1100` | `.plan-link`「这些方案落成订单是什么样 → 打开方案卡原型」 | 无 strat 参数，跳过去看默认买法 |

**关键阈值（改算法前先看这里）**
- 拆单值得推荐：`delta >= 5`（`range.mjs:1546`），差额 < ¥5 只写"别拆，只多一个取餐码"
- 券名匹配覆盖度：`>= 0.7`（`1363`、`1438`）
- 麦金卡月卡价：`const cardFee = 19`（`range.mjs:1592`，注释写明"2026-10 实测"）→ **硬编码，会过期**
- 买卡只对"随单购权益价"商品推荐；回本线 = 卡价 / 单笔省额

**口径声明（不要在别处重复解释）**：所有价格来自账本事实表的菜单现价 / 划线价，**原型不联网、不调用 `calculate-price`**，所以是"按当前菜单的估算"，真实下单前必须重算（S4 降级态演示的就是这件事），并写入 `provenance` 数组。

### 1.2 决策页成为构建产物

**文件：`src/render/plan.ts`（新增，1835 行）**

- `const TEMPLATE`（`plan.ts:19` 起）是原型 HTML 的**唯一正典**；客户端函数都在模板里：`recompute()`（661）、`renderPlan()`（783）、`rangeBar()`（883）、`ledgerBanner()`（891）、`srcCard()`（906）、`renderCard()`（999）、`renderPay()`（1064）、`renderExpired()`（1195）、`renderPayFail()`（1240）、`renderSuccess()`（1284）、`createOrders()`（1363）、`makeOrder()`（1438）、`doCancel()`（1480）、`doPay()`（1513）、`syncScenarioUI()`（1572）。
- `renderPlan(view, ledger, opts)` @ `plan.ts:1807`：调 `buildPlan(ledger, view.spec)` 求 plan，替换模板里两个占位符 `__PLAN_DATA__`（`plan.ts:575`）与 `__ENGINE_RUNTIME__`（`plan.ts:576`）。
- **样式内联而非外链**：`plan.ts:1826` 把模板里的 `<link rel="stylesheet" href="tokens.css">` 换成 `<style>` + `docs/tokens.css` 全文（`plan.ts:1800` 读文件）。理由：产物要能单独拷走离线评审，外链在 `out/` 目录里必然 404。
- `safeJson()` @ `plan.ts:1803`：JSON 里的 `<` 统一转义成 `\u003c`，避免 `</script` 截断标签。
- 产物头部自动插入注释「本文件由 src/render/plan.ts 生成，请勿直接编辑」。

> ⚠️ **`docs/prototype-v2.html` 现在是生成物**（已验证：文件内含生成标记、不含 `__PLAN_DATA__` 占位符、内嵌 99 行 demo 数据）。改交互改 `plan.ts` 的 TEMPLATE，改算法改 `range.mjs`，不要手改 docs 副本。

### 1.3 账本页联动与层级回流

**文件：`src/render/html.ts`（1275 行，本次 +55/−）**

- 顶栏入口 `html.ts:98`：`<a class="btn btn-plan" data-plan-link="1" href="${planHref}">方案卡 →</a>`，`planHref` 由 `html.ts:56` 拼 `?from=ledger&range=<spec>`。
- `syncPlanLinks(spec)` @ `html.ts:1219`：切区间时把页面上所有 `[data-plan-link]` 的 href 重写一遍（有 `data-strat` 的补上），保证对面拿到的 range 与本页一致。它被 `applyRange()`（`html.ts:1188`）调用。
- 层级色值回流（第二档第 4 项）：`--panel #111113 → #17171B`、`--panel2 → #202026`、`--line .075 → .12`、`--line2 .14 → .2`（与 `docs/tokens.css` 同值）。
- 360px 窄屏回归修复：`html.ts:891` `.btn-plan{padding:0 9px;font-size:11px}`，顶栏 `.bar-in/.bar-r` 间距收紧、隐藏字标英文 `<em>`。
- `engineRuntime()` @ `html.ts:215`：读 `range.mjs` 源码 → 剥掉行首 `export ` → 正则抽导出名 → IIFE 挂 `window.MCD_LEDGER_ENGINE`。`plan.ts` 复用同一个函数，所以两页注入的是同一个引擎实例代码。

### 1.4 CLI 与产物

**文件：`src/cli.ts`（255 行，本次 +7）**

- `cli.ts:18` 引入 `renderPlan`；`cli.ts:185-192`：`demo` / `audit` 都会额外写出 `prototype-v2.html`（与账本 HTML、CSV 同目录），并在终端打印「决策页」路径。
- 四个产物：`mcd-ledger-<date>.html`、`mcd-ledger-<date>.csv`、`prototype-v2.html`、`.trace/<traceId>.json`。

### 1.5 文档与设计资产

| 文件 | 变更 |
| --- | --- |
| `docs/tokens.css`（新增 246 行） | 由 `docs/tokens-v2.css` **重命名**而来（旧文件已删除）。头部补注释：单一口径声明、色值分叉原因、账本页变量映射表（`--ink2 ↔ --text-2` 等）。两页共用这一份 |
| `docs/index.html`（新增 157 行） | 门厅页。两张入口卡（账本 / 方案卡）+ 4 条诚实的边界说明（带参数互通、同一份引擎、tokens 单一口径、下单仍是模拟） |
| `docs/DESIGN-L2.md` | 更新 tokens 引用路径 |
| `docs/style-fix-v2.md` | 更新 tokens 引用路径 |
| `README.md`（+7） | 新增「**原型不是静态稿，是产物**」一段：常点商品 / 买法求解 / 策略跳转 / 价格口径 |
| `docs/demo-report.html`（+567）、`docs/prototype-v2.html`（+2360） | 用 demo 数据重新生成的产物（内嵌 99 行订单、5 张券、18 个菜单项，`meta.demo=true`，**不含真实账号数据**） |

### 1.6 验证结果（本次实测，非推断）

| 校验 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc --noEmit` | 0 错误 |
| 归因回归 | `node src/cli.ts bench` | 23/23 通过 |
| 原型 9 态 + 区间联动 | `node out/verify-l2.mjs "file:///D:/PROJECTS/mcd-skill/mcd-ledger/out/prototype-v2.html" "out/l2"` | 全绿，结构断言 9/9，控制台异常「无」 |
| 决策页对比度 | `node out/audit-contrast.mjs` | 9 屏 + 弹层 + toast × 2 主题，**0 处低于 AA** |
| 账本页对比度 | `node out/audit-ledger.mjs` | **0 处低于 AA** |

### 1.7 WorkBuddy Skill 打包（追加会话：2026-10-20 20:00–20:30，提交 `5e4d334`）

把整个项目打包成可安装的 WorkBuddy Skill，让任何 WorkBuddy 用户说一句「审计我的麦当劳消费」即可跑通。

| 文件 | 作用 |
| --- | --- |
| `skill/mcd-ledger/SKILL.md` | 技能正典：触发词（麦当劳账单/消费复盘/券是不是浪费了）、前置检查（Node ≥ 22.18）、四模式决策树（demo / audit / doctor / bench）、输出目录防污染约定、产物呈现规则、只读硬约束 |
| `skill/mcd-ledger/references/mcp-constraints.md` | MCP 十条实测硬约束 + 字段坑位（双层 data、beType、恒等式、Mouth 拼写） |
| `skill/mcd-ledger/references/output-guide.md` | 三层价格 / 五类漏损 / 五类策略 / 区间口径的汇报解读规范 |
| `skill/mcd-ledger/scripts/` | **主源码副本**（src + bench + viewer + `docs/tokens.css` + package.json 等），装在 `~/.workbuddy/skills/mcd-ledger/` 后直接 `node scripts/src/cli.ts <cmd>` |
| `dist/mcd-ledger.zip` | 分发件（150 KB，`.gitignore` 用 `dist/*` + `!dist/mcd-ledger.zip` 白名单放行） |
| `scripts/package_skill.py`、`scripts/quick_validate.py` | 收编自 skill-creator 插件，仓库内可独立重新打包 |
| `skill/README.md` | 维护者说明：改完 `src/` 后如何同步副本、重跑回归、重打包、重安装 |

**关键坑（已写进 `skill/README.md`）**：`src/render/plan.ts:1800` 按相对路径读 `../../docs/tokens.css`，副本里缺这个文件 demo/audit 直接崩——同步源码时必须连它一起拷贝。

**副本验证（追加会话实测）**：

| 校验 | 命令 | 结果 |
| --- | --- | --- |
| 副本回归 | `node skill/mcd-ledger/scripts/src/cli.ts bench` | 23/23 通过 |
| 副本 demo | `node skill/mcd-ledger/scripts/src/cli.ts demo --out /tmp/mcd-skill-test` | 四产物齐全（HTML/CSV/决策页/trace），合成数据标记在位 |
| 安装态冒烟 | 装到 `~/.workbuddy/skills/mcd-ledger/` 后跑 bench | 23/23 通过 |
| Skill 结构校验 | `python scripts/quick_validate.py skill/mcd-ledger` | valid |

---

## 二、未完成的工作

| # | 事项 | 当前进度 | 卡在何处 | 剩余工作量 |
| --- | --- | --- | --- | --- |
| U1 | **提交并推送本次改动** | ✅ 已完成（追加会话 `5e4d334` 已推送，本地与 `origin/main` 同步） | — | 0 |
| U2 | **真实下单接线**（`calculate-price` → `create-order` → 支付 → `cancel-order`） | 0% | 产品边界未放开；代码中完全没有 `McpClient` 调用写操作 | 大。需 L2 授权确认 + 幂等/撤销设计 + 15 分钟过期处理 |
| U3 | **唤起麦当劳 App / 小程序** | 结论：**不可行，已判定不做** | `wx-open-launch-weapp` 需认证服务号 + 已关联小程序；URL Scheme / Link 需小程序 AppSecret（只有麦当劳能生成）；Universal Link 需在麦当劳自有域部署 AASA —— 第三方无法可靠唤起 | 0（结论已写入 `docs/PRODUCT-V2.md` 与记忆）。替代方案：`payH5Url` 是麦当劳自有域 H5 收银台，浏览器直开即可 |
| U4 | **`out/` 校验脚本纳入版本控制** | ✅ 已完成（追加会话 2）：5 个脚本已重写进 `scripts/`，CHROME 路径改为 `CHROME_PATH` 环境变量 + 平台自动探测，端口 `CDP_PORT` 可配（默认 9444）；package.json 增加 `verify:ui` / `audit:ui` / `audit:contrast-ledger` / `shot` / `sheet` 命令 | — | 0 |
| U5 | **确认 `docs/*.html` 不含真实数据** | 已确认当前为 demo 数据 | 但如果下次用 `--out docs` 跑 `audit`，真实订单会写进被跟踪文件 | 小（加一条约定或改 .gitignore） |
| U6 | **真机验证 `payH5Url`** | 0% | 需要手机 + 真实下单 | 中。唯一未验证的真实链路环节 |
| U7 | **`buildPlan` 在真实账号数据上的表现** | 0% | 目前只用 demo 数据（99 行）验证过 | 中。真实菜单/券的命名、`worth` 为空的情况未覆盖 |
| U8 | **README / PRODUCT-V2 / DESIGN-L2 同步第二档结论** | 部分（README 已加一段） | 原型九态 S1–S9、区间联动、方案求解口径尚未进设计文档 | 中 |
| U9 | **第三档及更高档位** | 未定义 | 用户只授权到第二档，未提出第三档范围 | 待用户决策 |

---

## 三、已知问题与待办（Bug / 边界 / 技术债 / workaround）

### 高风险

1. **【数据泄密风险】`--out docs` 会污染被跟踪文件**
   `docs/demo-report.html` 与 `docs/prototype-v2.html` 都在 git 跟踪范围内。若执行 `node src/cli.ts audit --out docs`，真实订单（含门店、金额、SKU）会被写进这两个文件并可能被提交。
   **Workaround**：只用 `--out out/` 跑真实审计；需要更新 docs 产物时用 `node src/cli.ts demo --out docs`。
   **待办**：把 `docs/demo-report.html`、`docs/prototype-v2.html` 加进 `.gitignore`（改为 CI 生成），或在 `cli.ts` 里加保护。

2. **【换设备即丢】`out/` 下 5 个脚本不进仓库**
   `out/verify-l2.mjs`、`out/audit-contrast.mjs`、`out/audit-ledger.mjs`、`out/cdp-shot.mjs`、`out/sheet.mjs` 被 `.gitignore` 的 `out/` 规则忽略。它们硬编码了 Windows 路径 `C:/Program Files/Google/Chrome/Application/chrome.exe` 和调试端口（9444 / 9333），**在 macOS / Linux 上必然跑不起来**。
   **待办**：优先搬到 `scripts/` 并参数化 `CHROME` 路径（`process.env.CHROME_PATH ||` 平台默认）。

3. **【双份正典风险】`plan.ts` TEMPLATE 与 `docs/prototype-v2.html`**
   虽然已确立「TEMPLATE 是正典、docs 是产物」，但 docs 那份在 git 里，很容易被误当源文件手改。本轮已发生过一次「先改 docs 再同步回 plan.ts」的返工。
   **待办**：在 `docs/prototype-v2.html` 顶部已有生成注释；可考虑加 pre-commit 检查（对比 `renderPlan()` 输出与 docs 副本是否一致）。

### 中风险（技术债 / 硬编码）

4. **硬编码常量会过期**：`cardFee = 19`（`range.mjs:1592`）、拆单阈值 `>= 5`（`1546`）、券匹配阈值 `0.7`（`1363`/`1438`）。全部散落在函数体内，改一个数字要翻代码。建议外提到文件头常量区并加注释说明来源。

5. **`couponAlive()` 的时区假设**：`Date.parse(validTo.replace(" ", "T"))` 不带时区后缀，按本地时区解析；券的 `validTo` 若来自服务端北京时间字符串，边界当天会有一小时级偏差。当前策略是"解析失败视为有效"（保守），可接受但未显式声明。

6. **`planFocus()` 映射过粗**：`window` / `expiry` / `timing` 三类策略都落到 `coupon` 买法，导致从"时段策略"点进去看到的是用券方案，语义不够贴。需要时再细化（例如 `timing` → 提示"换个时段"而非换买法）。

7. **账本页仍是深色单主题**（`meta color-scheme=dark`，无切换器），决策页是双主题可切（浅色为默认）。这是**有意识保留**的分叉（账本页是"档案"氛围），不是 bug；但如果后续要统一，改动面在 `html.ts` 的整个 STYLE 字符串。

8. **MCP `status` 数字编码与官方文档不符**（实测踩坑，写进长期记忆）：文档说 1=待支付、7=已取消、10=配餐中；**实测 10=待支付、60=订单已取消**。任何状态判断必须用 `orderStatus` 文本（`"待支付"` / `"订单已取消"`），用数字判断会写出永不触发的分支。

9. **`payH5Url` 是一次性凭证**：`https://m.mcd.cn/mcp/scanToPay?orderId=<id>` 带订单号，**不可写入日志、不可截图外传**。二维码需客户端自己把该 URL 编码成 QR（接口不返回图片字段）。

10. **待支付单 15 分钟过期**（`expirePayTime = 下单时间 + 15min`）；未支付时 `pickupCode` 为空串。原型里的倒计时（`startTimer`/`expireOrders`，`plan.ts:1398/1414`）是**模拟**的，与真实过期无关。

### 低风险 / 界面约定（改样式前必读）

11. **深底块陷阱**：`.intent` 块在**浅色主题下也是深底** `rgb(26,22,20)`。在里面用 `--text-3` 或 `.price-note` 会掉到 2.77:1。深底块内必须用 `--intent-sub`（5.9:1）。
12. **变量名坑**：没有 `--brand-on` 这个变量，实际叫 `--text-on-brand` / `--brand-fill`。
13. **原型视觉三条不变式**：① 导航必须留在滚动容器外（`.navrow` 是 `.scr` 的 flex 子项）；② `gap ≥ fade`（`.scr-body` 的 `padding-top` 12px ≥ 导航渐隐带 9px）；③ 深色卡片三级明度梯子 `--app-bg #09090A` → `--surface #17171B` → `--surface-2 #202026`，带 surface + border 的卡片必须共用 `--shadow-card`，不许"裸描边"。
14. **文案规范**：「省」只用于已发生；将发生的写「可再省」；支付回调未返回写「支付未完成」而非「支付失败」；界面不出现「购物车」（API 无购物车概念）；不出现接口错误码（60006 / 600022 / `calculate-price` 只进日志）。
15. **撤销按钮常驻但中性描边**（`--border-strong` + `--danger-ink`），绝不上品牌红实心，否则与主 CTA 争主次。
16. **价格区永远两栏**（整单原价划线 + 实付大号），因为菜单价 ≠ 结算价（实测：安格斯四件套菜单 ¥37，直接结算 ¥66.50；传 `withOrder` 后才是 ¥37）。

---

## 四、下一步行动建议（按优先级）

### P0 — 先做，否则换设备会失忆

1. **提交并推送**（对应 U1）
   - **前置**：确认 `docs/demo-report.html` / `docs/prototype-v2.html` 里 `meta.demo === true`（当前已确认，是 99 行 demo 数据）。若不确定，先跑一次 `node src/cli.ts demo --out docs` 覆盖它们。
   - 动作：`git add -A && git commit`（建议 message：`feat: 两页整合——决策页改为构建产物，引擎新增方案求解器与区间联动`），然后 `git push origin main`（注意 `f7ce33a` 也一起推）。
2. **把校验脚本搬进仓库**（对应 U4）
   - `out/verify-l2.mjs` / `audit-contrast.mjs` / `audit-ledger.mjs` → `scripts/`；把 `CHROME` 常量改成 `process.env.CHROME_PATH || 平台默认路径`；端口改成可配。
   - 在 `package.json` 补 `scripts.verify` / `scripts.audit:ui`，让换设备的人一条命令就能跑。
   - **这是「在另一台设备上无缝继续」的最大前置条件**——否则新设备没有任何回归手段。

### P1 — 稳定化

3. **消除数据泄密路径**（U5）：`.gitignore` 加 `docs/demo-report.html`、`docs/prototype-v2.html`，或在 `cli.ts` 里对 `--out` 指向 `docs/` 且非 demo 时告警。
4. **外提硬编码常量**（技术债 #4）：`cardFee`、拆单阈值、匹配阈值提到 `range.mjs` 头部常量区并注释来源日期。

### P2 — 功能深化（需先确认授权）

5. **真实接线（U2）** *前置：用户明确授权 L2 + 确认 `cancel-order` 可用性*
   - 第一步必须先验证 `cancel-order`（唯一可撤销的写操作），再动 `create-order`。
   - 已知链路（真实账号实测过）：`query-store-coupons`（只有它给 `couponId`/`couponCode`）→ `calculate-price`（返 `takeWayList`）→ `create-order`（传 `takeWayCode`）→ `payH5Url`。
   - **一单只能用一张券**（两张同单报 `600022`），所以"多券"问题实为"选哪张 + 要不要拆单"。
   - 接入时所有界面文案不得出现错误码与工程名词。
6. **`buildPlan` 真实数据验证**（U7）：用真实账号跑一次 `audit --out out/`，检查常点 SKU、券匹配、买卡结论是否仍然自洽（重点看 `worth` 为 null 的券）。

### P3 — 收尾

7. **真机验证 `payH5Url`**（U6）：手机浏览器打开支付链接，确认是 H5 收银台而非跳 App、确认支付后可回查订单状态（`orderStatus` 文本）。
8. **文档同步**（U8）：把九态编号 S1–S9、区间联动、方案求解口径补进 `docs/DESIGN-L2.md` / `docs/PRODUCT-V2.md`。
9. **与用户确认是否要第三档**（U9），再开工。

---

## 五、环境与上下文

### 5.1 依赖与运行时

| 项 | 值 |
| --- | --- |
| Node | **≥ 22.18.0**（本机 `v22.22.2`；`plan.ts` 用了 `import.meta.dirname`，低于 20.11 会挂） |
| 运行时依赖 | **零** |
| devDependencies | `typescript ^5.8.0`、`@types/node ^22.20.5`（已在 `node_modules` 装好） |
| 构建 | **零构建**。`node src/cli.ts <cmd>` 直跑 TS（Node 原生剥离类型）；`tsc` 只用于 `--noEmit` 类型检查 |
| 包管理器 | npm（`package-lock.json` 已提交） |

换设备恢复：`git clone` → `npm install`（只装 typescript + @types/node，几秒）。

### 5.2 命令速查

```bash
cd mcd-ledger

# —— 类型检查 / 回归
npx tsc --noEmit            # 或 npm run typecheck
node src/cli.ts bench       # 归因算法回归，23/23 为通过基线

# —— 生成产物（无需 Token）
node src/cli.ts demo                       # 输出到当前目录
node src/cli.ts demo --out docs            # 更新仓库里的两个 docs 产物（demo 数据，安全）
node src/cli.ts demo --range 90d           # 页面默认区间：7d / 30d / 90d / all / YYYY-MM-DD..YYYY-MM-DD

# —— 真实账号（需要 Token）
node src/cli.ts doctor                     # 检查 MCP 连接与 6 个必需工具
node src/cli.ts audit --out out/           # ⚠️ 不要 --out docs（会写进被跟踪文件）
node src/cli.ts audit --days 90 --max-stores 3 --verbose

# —— 视觉回归（脚本当前在 out/，未进仓库）
node out/verify-l2.mjs "file:///D:/PROJECTS/mcd-skill/mcd-ledger/out/prototype-v2.html" "out/l2"
node out/audit-contrast.mjs                # 决策页：9 屏 + 弹层 + toast × 2 主题
node out/audit-ledger.mjs                  # 账本页
node out/cdp-shot.mjs <url> <out.png> [w] [h] [evalScript]   # 无头 Chrome 截图（CDP 直连）
node out/sheet.mjs light|dark <out.png> <scale>              # 评审拼版图

# —— Skill 打包 / 安装（追加会话新增）
python scripts/quick_validate.py skill/mcd-ledger            # 结构校验
python scripts/package_skill.py skill/mcd-ledger dist        # 产出 dist/mcd-ledger.zip
rm -rf ~/.workbuddy/skills/mcd-ledger && cp -r skill/mcd-ledger ~/.workbuddy/skills/   # 安装生效
```

> `verify-l2.mjs` **必须带两个参数**（url + 输出目录），不带参数会在 CDP `Page.navigate` 处报 `Invalid parameters`。
> 截图/校验脚本 `agent-browser` 在本机不可用，只能走 CDP。

### 5.3 环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `MCD_MCP_TOKEN` | `audit` / `doctor` 必需 | 在 https://open.mcd.cn/mcp 申请；请求头 `Authorization: Bearer <token>` |
| `MCD_MCP_URL` | 可选 | 默认 `https://mcp.mcd.cn` |
| `NO_COLOR` | 可选 | 关闭彩色输出 |

配置示例见 `mcp-config.example.json`（脱敏占位）。`demo` 命令不需要任何环境变量。

### 5.4 目录结构

```
mcd-ledger/
├── src/
│   ├── cli.ts                 # 入口：audit / demo / doctor / bench
│   ├── engine/
│   │   ├── range.mjs          # ★ 同构引擎（Node + 浏览器共用），1707 行
│   │   └── range.d.mts        # ★ 引擎的 TS 契约（改导出签名必须同步改这里）
│   ├── render/
│   │   ├── html.ts            # 账本页（含 engineRuntime()）
│   │   ├── plan.ts            # ★ 决策页模板正典 + renderPlan()
│   │   ├── console.ts / csv.ts
│   ├── audit/                 # 归因管线：pipeline / ledger / attribution / detectors / report / windows
│   ├── ingest/                # orders / orderDetail / menu / coupons / campaigns / points
│   ├── mcp/                   # client.ts（JSON-RPC + SSE）、cache.ts
│   ├── model/ runtime/ demo/
├── bench/                     # 回归用例 cases.ts + run.ts
├── docs/
│   ├── tokens.css             # ★ 唯一色彩口径（246 行）
│   ├── index.html             # 门厅页
│   ├── prototype-v2.html      # 生成物（勿手改）
│   ├── demo-report.html       # 生成物（勿手改）
│   ├── DESIGN-L2.md / PRODUCT-V2.md / style-fix-v2.md
├── skill/                     # ★ WorkBuddy Skill 打包（追加会话新增）
│   ├── README.md              #   维护者说明：源码副本同步 + 重打包流程
│   └── mcd-ledger/            #   SKILL.md + references/ + scripts/（主源码副本）
├── scripts/                   # package_skill.py / quick_validate.py（重新打包用）
├── dist/mcd-ledger.zip        # Skill 分发件（白名单进仓库）
├── out/                       # 运行产物 + 临时脚本（被 .gitignore 忽略）
└── viewer/trace-viewer.html   # trace 可视化
```

父目录 `D:/PROJECTS/mcd-skill/.workbuddy/memory/` 存有本次会话的完整开发记录（`2026-10-20.md` 36KB、9 轮；`MEMORY.md` 长期约束），**换设备不会带走**，建议一并复制或随仓库归档。

### 5.5 恢复工作必须知道的背景

**产品定位**：麦麦账本 = 「你的麦当劳消费审计官」。两页一条线：
- **账本页**（`demo-report.html`）回答「我过去花得对不对」——省了多少、漏了多少、下次何时买最划算；
- **方案卡页**（`prototype-v2.html`）回答「现在该怎么点」——用同一份引擎求解买法，生成可撤销的待支付订单。

**决策页九态（编号固定，别改）**：S1 合单 / S2 拆单 / S3 买卡 / S4 降级（售罄换购）/ S5 待支付主态 / S6 拆单两单 / S7 已过期 / S8 成功 / **S9 支付未完成**（回调没回来但订单仍有效，必须写"已扣款别重复付"）。

**双端一致性机制**：`engineRuntime()` 把 `range.mjs` 源码剥掉 `export ` 后包成 IIFE 挂到 `window.MCD_LEDGER_ENGINE`；服务端 SSR 与浏览器切区间调用的是**同一个 `buildView` / `buildPlan`**。曾实测 SSR 与客户端 DOM 输出 2156 字符逐字一致。

**MCP 写操作硬约束（真实账号实测，别推翻重推）**
1. 一单只能用一张券（两张同单 `600022`）。
2. 菜单价 ≠ 结算价（安格斯四件套 ¥37 vs ¥66.50），任何从菜单价推差价的做法都错，必须以 `calculate-price` 为准。
3. 菜单 tags 不保证结算生效（圆筒标"第二份半价"，买 2 个结算 ¥10 无折扣）。
4. 商品随时段售罄（优品豆浆 10:15 可售、13:19 报 `60006`），方案执行前必须重校验。
5. 券 `couponId` 只有 `query-store-coupons` 给；`query-my-coupons` / `available-coupons` 只返回 markdown。
6. `status` 数字编码与文档不符（10=待支付、60=已取消），一律用 `orderStatus` 文本。
7. `payH5Url` 是 H5 链接不是二维码，带 orderId，属一次性凭证。
8. 待支付单 15 分钟过期；未支付时 `pickupCode` 为空串。
9. 无购物车概念，`create-order` 直接出待支付单 + 支付链接。
10. `auto-bind-coupons` 无参数，一键领全部可领券（唯一的低风险写操作）。

**L2 闭环已验证**：2026-10-20 13:43 用真实账号跑通 `calculate-price(¥5.00)` → `create-order` → `cancel-order(reason=3)` → `query-order("订单已取消")`，全程 11 秒，实际支付 ¥0，无残留。所以「生成待支付单 + 撤销」技术上完全可行——缺的只是接线决定。

**大赛背景**：定榜 2026-10-26 00:00，排名靠 GitHub Star；`workbuddy.md` 记录开发过程用于核验"真实使用 WorkBuddy 开发"。

### 5.6 换设备恢复清单

```
[ ] git clone git@github.com:Huazai-0731/mcd-ledger.git（当前远端只有 030fc57，先把本设备 push 上去）
[ ] npm install
[ ] npm run typecheck  → 期望 0 错误
[ ] node src/cli.ts bench → 期望 23/23
[ ] 复制 out/ 下 5 个 .mjs 校验脚本（或先按 P0-2 把它们提交进仓库）
[ ] node src/cli.ts demo --out out/ → 打开 out/index.html 之外的 out/prototype-v2.html 与 mcd-ledger-<date>.html
[ ] 直接双击 docs/index.html 可看门厅页（离线可用，无外部依赖）
```

---

## 附：本次会话的关键决策理由（一句话版）

| 决策 | 理由 |
| --- | --- |
| `buildPlan` 放进 `range.mjs` 而不是渲染层 | 方案数字随区间变，放引擎 = 浏览器切区间时调用同一段代码，双端不可能对不上 |
| tokens.css 构建时**内联**而非外链 | 产物要能单独拷走（离线评审 / `out/` 直接打开），外链必然 404 |
| 券名匹配用**子序列覆盖度 ≥0.7** 而非子串 | 真实数据里"麦辣鸡腿堡" vs "麦辣鸡腿汉堡"子串匹配必失败 |
| 拆单差额 ≥¥5 才推荐 | 差额太小只是多一个取餐码，不值得 |
| 买卡只对"随单购权益价"商品推荐，回本线按单笔省额反推 | 曾出现"卡价19 vs 再买1次回本"自相矛盾的文案 |
| 原型**不联网、不调 `calculate-price`** | 原型是离线评审物；真实价格必须执行前重算（S4 降级态就是在讲这件事） |
| 账本页层级回流到 `#17171B` / `#202026` | 原型的层级结论（tokens.css 注释里那句"#111113 与底只差 2 级，整片糊成一团黑"） |
| 不做 App / 小程序唤起 | 无官方合作时第三方无法可靠唤起；`payH5Url` 已是麦当劳自有域收银台，够用 |

### 1.8 大赛材料审核与报名（追加会话 2：2026-10-20 21:00–21:40，提交 `a1`）

对照官方仓库 M-China/mcd-developer-innovation-challenge 的参赛要求逐项核查（报名截止 2026-10-25 23:59，定榜 10-26 00:00）：

| 官方要求 | 本仓库状态 |
| --- | --- |
| `README.md`（介绍/安装/示例/目标用户，文件名不可改） | ✅ 本次显式补「目标用户」段 + 大赛徽章 |
| `CONTEST_DECLARATION.md`（**内容不可改动**） | ✅ 与官方 raw 文件 1522 字节 diff 完全一致 |
| `MCP_INTEGRATION.md（Server/Tool/流程/业务价值） | ✅ 8 节齐全（含业务价值专节） |
| 源代码 | ✅ |
| `workbuddy.md`（WorkBuddy 专项奖励必需） | ✅ 144 行导出 |
| 仓库 Public、创建时间 2025-12-25 之后 | ✅ 2026-10-20 创建，Public，MIT |
| 报名 Issue（官方格式） | ✅ **已提交 #927**（`【参赛申请】mcd-ledger 麦麦账本——麦当劳消费审计官`），系统自动校验回复待监控 |
| 不含真实 Token/个人信息 | ✅ 全仓扫描干净，`mcp-config.example.json` 仅 `${MCD_MCP_TOKEN}` 占位 |

**报名 Issue 格式纪律**（官方明确警告，重新提交时必须遵守）：标题与正文间不加换行；`项目名称`/`项目地址`/`项目简介` 各占一行且标签与内容同行；项目地址不用 Markdown 链接。

### 1.9 UI 校验工具重建（追加会话 2，U4 闭环）

`out/` 下 5 个脚本随换设备实际丢失（`D:/PROJECTS/mcd-skill/...` 旧路径不存在、本机无备份），已在 `scripts/` 重建为参数化版本：

| 文件 | 作用 |
| --- | --- |
| `ui-cdp.mjs` | 共享 CDP 助手（零依赖，Node 内置 WebSocket）：`CHROME_PATH` 环境变量 + 平台自动探测、`CDP_PORT` 可配、控制台异常/请求失败收集、截图自动建目录 |
| `verify-ui.mjs` | 结构断言 + 场景/主题切换巡检 + 控制台零异常（profile: prototype / ledger / generic） |
| `audit-contrast.mjs` + `contrast-fn.mjs` | WCAG AA 审计（决策页双主题 × 3 场景）；审计函数抽离共享 |
| `audit-ledger.mjs` | 账本页 AA 审计（深色单主题，`--full-page`） |
| `cdp-shot.mjs` | 无头截图（视口 + 前置 eval） |
| `sheet.mjs` | 评审拼版图（base64 内联 HTML 网格 + Chrome 整页截图，无图像库依赖） |

**重建时实测发现并修复的三类审计误报**（写进 `contrast-fn.mjs` 头注释，改算法前先读）：
1. `background-clip:text` 渐变文字（`.grad`/`.card-n`/`h1 em`）：字形色是渐变色停而非 `color`，改为色停逐一比对底层背景；
2. 绝对定位元素（`.wk-bar i` 渲染在柱体上方）：只合成元素矩形**真正压住**的祖先背景；
3. CSS 过渡中间色（`.nav a` 0.2s color 过渡）：审计前注入 `transition:none!important`。

**复现基线**：决策页 6 组合 ×0 违规；账本页 373 处文本 ×0 违规；原型结构断言 15/15、0 控制台异常、0 外部请求（离线）。

### 1.10 在线 Demo 上线（追加会话 3：2026-10-20 21:40–22:10）

线上地址：**https://mcd-ledger.app.workbuddy.host/?sharecode=5CJJI3OU5Z**（发布目录 `web/`，入口 `index.html`）

| 文件 | 来源 | 处理 |
| --- | --- | --- |
| `web/index.html` | 手写 | 入口页：主张 + 两个入口 + 三步玩法 + 演示声明 + 仓库链接 |
| `web/ledger.html` | `docs/demo-report.html` | 只改互链 |
| `web/plan.html` | `docs/prototype-v2.html` | 摘评审装置 + 补玩法列 + 折叠分支 |

**派生脚本** `scripts/build-site.mjs`（`npm run build:site`）：对 `docs/` 只读，标记找不到就抛错退出。

**摘掉（非核心操作）**：右侧「直达界面」9 态跳板、「场景模拟」、当前状态/事件日志、顶栏主题切换与「重置原型」、手机下方状态标签。

**为什么「提交时售罄」不在线上**：demo 数据下 `PLAN.degrade` 为 `null`，点它会照常生成订单——留在线上是误导。只保留实测可达的 `abort`（支付中途退出）分支，做成默认折叠。

**踩到的真坑**：面板摘掉后 `renderLog()` / `renderPanel()` 往已删除的节点写内容，抛 `TypeError`，表现为「点生成订单什么都不发生」。`build-site.mjs` 的 `guardPanelless()` 补了空值保护，并在模板结构变化时抛错。**结论：线上版不能只靠肉眼验收**——`npm run verify:site` 每一步断言屏幕真的切过去了。

**新增回归**：`verify-ui.mjs` 增加 `site` profile（结构 7 项 + 流程 9 步：下单→支付→取餐码→再来一单→撤销二次确认→支付中途退出）；`npm run build:site / verify:site / audit:site`。

**验收**：线上入口→方案卡→下单→支付→成功→返回账本，0 控制台异常；对比度 入口 37 / 方案卡 55 / 账本 373 处文本全 0 违规；三页外部请求 0。

**分享链接的机制**：链接带 `?sharecode=`，首访种 `__wb_rsc` Cookie，站内相对跳转靠它放行——所以站内链接必须是相对路径，别把 sharecode 写死。
