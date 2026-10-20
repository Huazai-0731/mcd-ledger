# WorkBuddy 开发对话上下文

> 本文件记录 `mcd-ledger` 的开发过程，用于核验本项目真实使用腾讯 WorkBuddy 完成开发。
> 会话日期：2026-10-20　|　开发工具：WorkBuddy（Agent 模式）
> 环境：Windows / Node v22.22.2 / 麦当劳 MCP 通过 WorkBuddy 自定义连接器接入

---

## 1. 会话概述

| 阶段 | 用户意图 | WorkBuddy 动作 |
|---|---|---|
| 选题 | 基于大赛规则产出若干参赛方案 | 抓取官方 README / activityGuidelines / RANKING / mcd-mcp-server 文档，解构评审机制，输出 5 个方案并做加权对比 |
| 定题 | 选定「P3 + P4 混合」 | 确认技术路线：P3 的选题（消费审计）+ P4 的工程纪律（trace / 幂等 / 降级 / 回归用例） |
| 可行性 | 确认真实数据能否支撑 | 通过已连接的 MCP 实测 6 个工具，验证订单、菜单、券、积分字段 |
| 开发 | 实现完整项目 | 搭建 20+ 文件的 TypeScript 工程，零依赖、零构建 |
| 调试 | 修复真实调用中的问题 | 修复 JSON-RPC 结果解析、重构归因数据源、修正菜单时段导致的覆盖率问题 |
| 验证 | 确认真实账号可用 | 实时审计 9 笔真实订单，覆盖率 100%，缓存命中后调用数 17 → 4 |

---

## 2. 关键对话片段

### 2.1 选题阶段

**用户**
> 基于 https://github.com/M-China/mcd-developer-innovation-challenge 所列的参赛具体要求与评审标准，生成若干（建议3至5个）符合规范的参赛方案，每个方案须明确核心目标、整体实现思路及如何对应满足各项要求。

**WorkBuddy（要点）**
- 抓取 `activityGuidelines.md` 后发现关键事实：排名依据是 **GitHub 公开 Star 数**，不是代码评审；资格审核只是门槛。
- 发现 README 与规则的文件要求不一致：规则额外要求 `mcp-config.example.json`，而 README 只列了 5 个文件——这是最容易被漏掉的一条。
- 对当时榜单前 100 名做语义聚类，识别出 5 个空白赛道：企业团餐、钠/营养密度、订单复盘、Agent 可靠性基础设施、适老化。
- 输出 5 个方案，加权评分后推荐 P3（麦麦账本，4.42）+ 注入 P4 工程纪律。

### 2.2 需求确认

**用户**
> 1. P3 + P4混合
> 2. MCP Token已就绪，连接器已经连通
> 3. 暂没有，我还不确定仓库叫什么名字，方案定下来后我去创建

**WorkBuddy**
- 先做可行性闸门：实测 `order-list`、`query-my-coupons`、`query-meals`、`query-my-account`，确认字段是否够用。
- 实测结论：订单带 `comboItemList` 可拆套餐；菜单带 `currentPrice` + `originalPrice`；积分带 `expiredPoint`（已过期积分，真实损失）。

### 2.3 开发中的一次关键重构

**WorkBuddy（自查记录）**
> 真实账号首次审计结果：可归因覆盖率 **8%**，省下 ¥0.00。
> 原因：菜单随时段变化（10:05 只有早餐菜单），且历史订单中的季节性 SKU 已下架，无法用菜单反推归因。
> 处置：改用 `query-order` 的 `totalAmount / totalDiscountAmount / couponList` 作为归因权威源，菜单降级为"组合价值"的增强源。
> 结果：覆盖率 8% → **100%**，省下金额从 ¥0 变为 ¥48.00（标注为下限）。

这次重构是项目的转折点：从"用菜单猜价格"变成"用平台账本对账"。

---

## 3. 开发过程中的真实排错记录

| # | 现象 | 定位 | 修复 |
|---|---|---|---|
| 1 | `doctor` 报 `$.result.tools: 期望 array，实际 undefined` | `rpc()` 返回了整个 JSON-RPC 消息，而调用方按 `result` 取字段 | 改为返回 `message.result` |
| 2 | 真实审计覆盖率为 8% | 菜单随时段切换 + 历史 SKU 下架 | 引入 `query-order` 作为权威源，重写 `pricing.ts` 与 `attribution.ts` |
| 3 | 券名「麦辣鸡腿堡」匹配不到菜单「麦辣鸡腿汉堡」 | 名称归一未处理"汉堡/堡"差异 | `normalizeName()` 增加 `.replace(/汉堡/g,'堡')` |
| 4 | 报告第三个归因卡片显示 0%，像 bug | 组合价值全部为 null 时的渲染 | 改为虚线说明卡，明确写出"不填 0 的原因" |
| 5 | 第二次运行仍重复请求订单详情 | 未缓存 | 按 `orderId` 永久缓存，调用数 17 → 4 |

---

## 4. WorkBuddy 在本项目中承担的工作

- **信息检索**：读取大赛仓库 4 份文档 + MCP Server 文档，提取硬性要求与排行榜现状。
- **数据分析**：对榜单前 100 名做赛道聚类，识别红海与空白。
- **可行性验证**：通过已连接的麦当劳 MCP 连接器实际调用 6 个工具，确认字段可用性。
- **代码生成**：`src/` 下 18 个 TypeScript 文件、`bench/` 2 个文件、`viewer/` 1 个单文件应用。
- **自查与调试**：运行 `bench`（14/14 通过）、`demo`、真实 `audit`，发现并修复上表 5 个问题。
- **文档撰写**：README / MCP_INTEGRATION / 参赛声明 / 本文件。

---

## 5. 产物清单

```
mcd-ledger/
├── README.md                 项目介绍、安装、示例、目标用户
├── CONTEST_DECLARATION.md    参赛声明（官方文件，内容未改动）
├── MCP_INTEGRATION.md        工具、流程、字段级坑位、业务价值
├── mcp-config.example.json   脱敏配置（仅环境变量占位）
├── workbuddy.md              本文件
├── package.json / tsconfig.json / LICENSE / .gitignore
├── src/                      18 个 TypeScript 文件
├── bench/                    14 条回归用例
├── viewer/trace-viewer.html  trace 回放器
└── docs/demo-report.html     账本页报告样例（demo 模式生成）
```

---

## 6. 验证记录（本地实测）

```
$ node src/cli.ts bench
  14/14 通过

$ node src/cli.ts demo
  期间 2026-07-17 → 2026-10-18 · 94 天 · 26 笔
  实付 ¥335.21 · 省下 ¥242.69（42.0%）· 漏掉 ¥30.30

$ node src/cli.ts audit
  期间 2026-06-11 → 2026-09-16 · 98 天 · 9 笔
  实付 ¥119.00 · 省下 ¥48.00（下限）· 漏掉 ¥20.44
  可归因 100% · 17 次 MCP 调用 · 3.6s

$ node src/cli.ts audit   # 第二次，命中缓存
  可归因 100% · 4 次 MCP 调用 · 1.1s
```
