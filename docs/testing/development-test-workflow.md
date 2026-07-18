# 日常开发测试工作流

## 修改前：确定风险等级

| 等级 | 范围 | 必跑层级 |
|---|---|---|
| R0 | 纯展示、不涉及状态 | L0 |
| R1 | 单个规则或 validator | L0-L2 |
| R2 | 单领域权威状态 | L0-L4，运行相关场景 |
| R3 | 公共链路或跨领域合同 | L0-L4，全量长链和分布抽样 |
| R4 | 架构切换或发布 | L0-L5，全新真实 AI 五路线 |

R3 不代表每次都强制运行昂贵的真实浏览器路线；负责人需要根据公共链路影响决定是否提前运行。R4 必须运行新鲜的真实浏览器验收。

## 每次修改的最小记录

```text
修改目的：
现实规则：
涉及领域：
风险等级：
预期改善：
可能副作用：
新增或更新的回归场景：
```

## 日常快速门禁

```bash
pnpm lint
pnpm test
```

再运行受影响领域的定向测试和 1-3 条固定场景。财务领域可使用当前的 `test:financial-m2`、`test:financial-m5`、`test:financial-m7` 和 `test:financial-baseline`。

## 合并前门禁

```bash
pnpm lint
pnpm test
pnpm build
```

同时要求：

- 相关确定性长链场景通过；
- 世界审计 `blocking=0`；
- 小规模分布没有显著退化；
- 生产解析与重试路径没有被测试适配器替代；
- 失败种子、首次失败节点和状态差异得到保留。

## 阶段或发布验收

使用 `run-real-browser-ending-routes` 创建全新 2/2/1 运行。现有路线验证通过后，将统一世界审计器接到每条 case 的 `finalState.history`，最终分别生成：

1. 路线合约报告；
2. 世界不变量报告；
3. 因果证据报告；
4. 现实性评估报告。

在因果记录和统计规则尚未完成前，世界审计报告只能声明已经覆盖的规则，不能把“未发现”写成“现实正确”。

现有真实浏览器运行可以先只读试跑世界审计：

```bash
pnpm exec tsx scripts/audit-world-real-browser-run.ts --root <run-root> --dry-run
```

移除 `--dry-run` 后会在该运行目录生成 `world-invariant-report.json` 和 `world-invariant-report.md`。只有新鲜、完整且准备作为验收证据的运行才应写入正式报告。
