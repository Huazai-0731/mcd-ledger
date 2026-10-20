# skill/ — WorkBuddy Skill 打包目录（维护者说明）

本目录把 mcd-ledger 打包成可安装的 WorkBuddy Skill。**`scripts/` 下是仓库主源码的副本**，改完 `src/` 后必须同步，否则 Skill 跑的是旧算法。

## 目录

```
skill/mcd-ledger/
├── SKILL.md                    # 技能说明（触发词、四种模式工作流、硬约束）
├── references/
│   ├── mcp-constraints.md      # MCP 十条实测硬约束 + 字段坑位
│   └── output-guide.md         # 三层价格 / 五类漏损 / 五类策略 / 区间口径
└── scripts/                    # ★ 主源码副本（打包、安装、运行都靠它）
    ├── src/  bench/  viewer/
    ├── docs/tokens.css         # renderPlan() 会读它，缺了 demo/audit 直接崩
    ├── package.json  tsconfig.json  mcp-config.example.json  LICENSE
```

## 改了 `src/` 之后的同步流程

```bash
# 1. 同步源码副本（只覆盖程序文件，不动 SKILL.md / references）
rm -rf skill/mcd-ledger/scripts/src && cp -r src skill/mcd-ledger/scripts/src
cp docs/tokens.css skill/mcd-ledger/scripts/docs/     # renderPlan 的依赖，别漏

# 2. 从 Skill 副本跑一次回归，确认副本本身是健康的
node skill/mcd-ledger/scripts/src/cli.ts bench        # 期望 23/23
node skill/mcd-ledger/scripts/src/cli.ts demo --out /tmp/skill-check   # 期望 4 个产物

# 3. 重新打包
python scripts/package_skill.py skill/mcd-ledger dist # 产出 dist/mcd-ledger.zip

# 4. 安装生效（本机）
rm -rf ~/.workbuddy/skills/mcd-ledger && cp -r skill/mcd-ledger ~/.workbuddy/skills/
```

## 硬约束

- **`scripts/docs/tokens.css` 必须跟着 `docs/tokens.css` 同步**：`src/render/plan.ts:1800` 按相对路径读它，缺失或过期都会让决策页样式/构建失败。
- **`scripts/build-site.mjs` 不进 Skill**：它把 `docs/` 的两个交付物派生成 `web/` 发布站点，而 Skill 包不带 `docs/*.html`，放进去也跑不起来——保持「仓库有、Skill 无」是有意为之。
- Skill 副本里**不允许出现**任何真实账号数据（`.cache/`、`.trace/`、真实 audit 产物一律不进包）。
- `SKILL.md` 的 `version` 与仓库 `package.json` 的 `version` 保持同号。
