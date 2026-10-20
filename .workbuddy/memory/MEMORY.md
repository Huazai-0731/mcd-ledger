# mcd-ledger 项目长期记忆

## 项目定位
麦麦账本 = 麦当劳消费审计官。账本页（过去花得对不对）+ 方案卡页（现在该怎么点），同一份同构引擎 range.mjs。MIT，参赛麦当劳程序员创意开发大赛（定榜 2026-10-26，按 GitHub Star 排名）。

## Skill 打包约定（2026-10-20 追加会话建立）
- Skill 正典在仓库 `skill/mcd-ledger/`；分发件 `dist/mcd-ledger.zip` 由 `python scripts/package_skill.py skill/mcd-ledger dist` 生成；本机安装路径 `~/.workbuddy/skills/mcd-ledger/`。
- `skill/mcd-ledger/scripts/` 是主源码副本，**不是软链**：改完 `src/` 必须按 `skill/README.md` 流程同步，且必须连 `docs/tokens.css` 一起拷（`renderPlan()` 依赖它，缺失即崩）。
- `.gitignore` 放行 zip 的写法是 `dist/*` + `!dist/mcd-ledger.zip` 成对出现（git 不会进入被整体排除的目录）。

## 不可违背的产品边界
- 只读：不下单、不领券、不取消订单；写操作链路（calculate-price→create-order→cancel-order）技术上已验证可行但未接线、未授权。
- 汇报口径：「省」只用于已发生，未发生写「可再省」；算不出标「下限」不填 0；不出现 MCP 错误码与工程名词；demo 数据必须声明是合成数据。
- 数据安全：真实 audit 产物禁止 `--out docs/`（被跟踪文件）；Token 只走 `MCD_MCP_TOKEN` 环境变量，不写文件不外显。

## 环境
Node ≥22.18 直跑 TS，零运行时依赖；回归基线 bench 23/23；tsc 0 错误。远端 git@github.com:Huazai-0731/mcd-ledger.git。
