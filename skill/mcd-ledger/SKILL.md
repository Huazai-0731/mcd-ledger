---
name: mcd-ledger
description: 麦当劳消费审计/账本。当用户想审计、统计、复盘自己在麦当劳的消费（花了多少、省了多少、漏了多少、下次怎么买更划算）时使用。触发词：麦当劳账单、麦麦账本、麦当劳消费审计、消费复盘、优惠券是不是浪费了、麦当劳怎么点更划算、麦当劳漏损。支持无 Token 的合成数据演示（demo）与真实账号审计（需要 MCD_MCP_TOKEN）。只读，不修改任何账户状态。
description_zh: 麦当劳消费审计/账本：用麦当劳 MCP 只读接口把你的消费算清楚——省了多少、漏了多少、下次怎么买更划算，输出可核对的对账 HTML 报告。支持 demo 演示与真实账号审计。
description_en: Auditable ledger for your McDonald's China orders — how much you spent, saved, and missed, with actionable savings strategies. Read-only; demo mode requires no token.
version: 0.2.0
homepage: https://github.com/Huazai-0731/mcd-ledger
display_name: 麦麦账本
display_name_en: mcd-ledger
visibility: public
---

# 麦麦账本 · mcd-ledger

## 功能定位

把你的麦当劳订单变成一张**可核对**的对账单。回答三个问题：这半年到底花了多少、到底省了多少（券优惠 / 活动优惠 / 套餐组合价值三项互不重叠）、漏掉了多少（过期积分、临期券、有券却没在生效时段用上）。在此之上给出可执行的优惠策略，并按时间区间重算。

**它不做**：推荐吃什么、自动领券、下单支付。本 Skill 完全只读。

## 前置检查

1. 确认 Node 版本 ≥ 22.18（CLI 用 Node 原生运行 TypeScript，零运行时依赖，无需 npm install）：

   ```bash
   node --version
   ```

   版本过低时明确告知用户需要升级 Node，不要尝试用 npm install 修复。
2. 确定本 Skill 的安装根目录（下称 `<skill>`，即本 SKILL.md 所在目录），项目源码位于 `<skill>/scripts/`，入口是 `<skill>/scripts/src/cli.ts`。

## 模式选择

按以下决策树选择，**不要跳过检查直接 audit**：

```
用户请求
├─ 想先看效果 / 没有 Token / 明确说"演示一下"
│    └─ 模式 A：demo（合成数据，无需 Token）
├─ 提供 Token 或环境里已有 MCD_MCP_TOKEN
│    ├─ 第一次使用该账号 / 上次 audit 失败过
│    │    └─ 先跑 模式 C：doctor，再 模式 B：audit
│    └─ 直接 模式 B：audit
├─ "检查连接/工具是否可用" → 模式 C：doctor
└─ 改过源码 / 怀疑算错 → 模式 D：bench（23 条归因回归）
```

## 模式 A：demo 演示（无需 Token）

```bash
node <skill>/scripts/src/cli.ts demo --out <outDir>
```

- `<outDir>`：输出目录，见下方「输出目录约定」。demo 不读任何环境变量，不联网。
- 成功后会打印四个产物路径，同时 stdout 有完整的终端摘要（KPI、三层价格、归因、漏损、策略、未来 7 天窗口）。
- 向用户展示时**必须声明这是合成数据**（订单序列由固定种子生成，价格取自真实菜单），不要把 demo 数字说成用户的真实消费。

## 模式 B：真实账号审计

```bash
MCD_MCP_TOKEN=<token> node <skill>/scripts/src/cli.ts audit --out <outDir> [选项]
```

选项：

| 选项 | 说明 |
| --- | --- |
| `--days <n>` | 只拉最近 n 天订单，减少 MCP 调用。不知道用户历史量级时先给 `--days 90` |
| `--range <7d\|30d\|90d\|all\|YYYY-MM-DD..YYYY-MM-DD>` | 页面默认选中的区间，默认 30d。用户说"最近三个月"就传 `--range 90d` |
| `--max-stores <n>` | 最多查几个门店菜单（默认 3），控制调用量 |
| `--verbose` | 打印每一步 MCP 调用（排查时用） |
| `--json` | 只把报告 JSON 打到 stdout，不渲染终端摘要 |

Token 处理（硬约束）：

1. Token 只通过环境变量 `MCD_MCP_TOKEN` 传入，**不写入任何文件、不回显、不贴进输出**。
2. 用户没有 Token 时，给出去 https://open.mcd.cn/mcp 申请的指引，并主动提供 demo 作为等值替代，不要反复索要。
3. `MCD_MCP_URL` 可选，默认 `https://mcp.mcd.cn`，仅在用户自建代理时需要。

## 模式 C：doctor 体检

```bash
MCD_MCP_TOKEN=<token> node <skill>/scripts/src/cli.ts doctor
```

列出 MCP 全部工具并检查 6 个必需工具（order-list / query-meals / query-my-coupons / query-my-account / campaign-calendar / now-time-info）是否齐全。audit 失败（连接或鉴权类）时先用它定位。

## 模式 D：bench 回归

```bash
node <skill>/scripts/src/cli.ts bench
```

期望输出 23/23 通过。仅在改动过 `<skill>/scripts/src` 或用户质疑数字正确性时运行；失败时把失败用例名如实报告，不要静默继续 audit。

## 输出目录约定（防数据污染，必须遵守）

1. 输出目录**必须是独立的新目录**（如 `<工作区>/.mcd-runs/<日期时间>/`），每次运行建新目录或固定专用目录。
2. **禁止**把审计输出指向任何被 git 跟踪的目录（仓库里的 `docs/` 等）。真实订单数据一旦写进被跟踪文件就可能被提交泄露。
3. `<outDir>` 下会自动生成 `.cache/`（订单详情永久缓存，二次运行 MCP 调用从 17 次降到 4 次）和 `.trace/`（每次 MCP 调用的 jsonl 轨迹）。缓存可加速重复审计，不要手动删除后再问为什么变慢。

## 产物与呈现

一次成功运行固定产出四个文件：

| 文件 | 内容 | 呈现方式 |
| --- | --- | --- |
| `mcd-ledger-<日期>.html` | 账本页：KPI、三层价格、归因、策略、漏损、购买窗口、画像。页内可切时间区间，切区间与首屏同一份引擎计算结果 | **主交付物**，用 present_files 打开 |
| `mcd-ledger-<日期>.csv` | 订单级明细，供用户复算汇总数字 | 次要，随主文件一起给出 |
| `prototype-v2.html` | 方案卡原型：把"常点什么"求解成"下一单怎么买"，与账本页同源同引擎 | 用户问"下次怎么点/怎么买更划算"时给出 |
| `.trace/<id>.json` | MCP 调用轨迹 | 仅在排查问题时给；可拖进 `<skill>/scripts/viewer/trace-viewer.html` 回放 |

呈现规则：

1. 先给终端摘要里的关键数字（实付 / 省下 / 漏掉 / 再省），再打开 HTML 全文。
2. 数字必须带口径：「省下」是三项之和（券 + 活动 + 组合），「漏掉」含估算项，估算的要在汇报里点名。CSV 可与报告逐笔对上，主动告诉用户这一点。
3. 算不出的项（`组合价值` 为 null）原样表述为「下限」并解释原因，**不要填 0、不要编数**。
4. 汇报用中性记账口吻，不评判商家；「省」只用于已发生，未发生的写「可再省」。

## 硬约束（不可违背）

1. **只读**：本 Skill 不下单、不领券、不取消订单、不改任何账户状态。用户要求"帮我点一单"时，说明这超出当前范围，可展示方案卡原型作为下一步参考。
2. 界面与汇报文案**不得出现** MCP 错误码（60006 / 600022 等）与工程名词（`calculate-price`、`takeWayCode` 等）。
3. **menu 价 ≠ 结算价**：不要用菜单价推算任何差价结论；审计的全部口径来自订单记录。
4. **一单只能用一张券**：策略里的"多券"实为"选哪张 + 要不要拆单"。
5. **待支付单 15 分钟过期**、`payH5Url` 是一次性凭证（不可外传）——仅在回答用户相关问题时引用，本 Skill 不产生订单。
6. demo 输出≠真实数据，任何场景下都要把两者的区别说清楚。

## 常见问题速查

| 症状 | 处理 |
| --- | --- |
| `缺少 MCP Token` | 正常引导申请或切 demo，不要重试 |
| doctor 报缺失工具 | 把缺失工具名给用户，通常是 Token 权限范围问题 |
| audit 中途失败 | `--verbose` 重跑定位到具体调用；trace 在 `<outDir>/.trace/` |
| MCP 限流（600 次/分钟） | 客户端已内置退避；仍失败就加 `--days` 缩小范围 |
| 第二次运行变慢/变快 | 正常：订单详情永久缓存，命中后调用次数下降 |

更多细节：MCP 集成硬约束见 `references/mcp-constraints.md`；报告数字口径与策略解读见 `references/output-guide.md`。
