# 债务分支集成 `main` 前保留/排除清单与变更审查

状态：待清理确认，尚未删除文件、尚未创建安全提交、尚未集成 `main`。

## 1. 冻结范围

- 当前分支：`codex/financial-debt-distress`
- 当前提交：`dfc136f`
- 远端 `main`：`95a013e`
- merge-base：`dfc136f`
- 当前提交图：债务分支没有独立已提交提交，落后 `origin/main` 19 个提交；债务实现全部仍在工作区。
- 暂停新增债务功能；不修改、不合并 `financial-upgrade`。

## 2. 工作区实况

- 已修改受控文件：53 个，约 5,936 行新增、422 行删除。
- 未跟踪非验收文件：26 个。
- 债务修改与 `main` 同时改动的受控文件：26 个。
- `artifacts/report-invitation-browser` 下有 88 个运行目录。
- `artifacts` 当前约 486 MiB；未跟踪验收文件约 433.3 MiB。
- 最终集成前证据 `v7` 约 68 MiB；排除它后，可清理的未跟踪验收文件约 366.7 MiB。

## 3. 保留清单

### 3.1 源码、测试、脚本、CI 与 Spec

保留全部 53 个已修改受控文件，以及以下 26 个未跟踪非验收文件：

```text
.github/workflows/financial-debt.yml
docs/superpowers/specs/2026-07-20-debt-production-blocker-closure-spec.md
scripts/analyze-debt-real-browser-run.mjs
scripts/debt-real-browser-routes.mjs
scripts/financial-production-audit.test.mjs
scripts/lib/financial-production-audit.mjs
scripts/prepare-debt-pressure-browser-checkpoint.ts
scripts/real-browser-journey-runner.test.mjs
src/data/debtLifeEvents.test.ts
src/domain/finance/assetTransaction.test.ts
src/domain/finance/automaticShortfallRecovery.test.ts
src/domain/finance/debtDistressLedger.test.ts
src/domain/finance/debtHealth.test.ts
src/domain/finance/debtHealth.ts
src/domain/finance/financialFactEligibility.ts
src/domain/finance/migrateFinancialLedgerV2ToV3.test.ts
src/domain/finance/migrateFinancialLedgerV2ToV3.ts
src/domain/finance/openingFinancialAuthority.test.ts
src/services/simulation/selectedPersonalIncomeProposal.test.ts
src/utils/debtEventScheduling.ts
src/utils/debtHistoryAndTransaction.test.ts
src/utils/debtNarrativeAuthority.test.ts
src/utils/debtNarrativeAuthority.ts
src/utils/finalFinancialNarrativeAuthority.test.ts
src/utils/finalFinancialNarrativeAuthority.ts
src/utils/financialDebtArc.test.ts
```

本审查文件也保留并纳入安全提交。

### 3.2 集成前最终验收证据

完整保留：

```text
artifacts/report-invitation-browser/2026-07-24T18-00-00+08-00-financial-release-five-v7/
```

该目录是集成前证据，不得在集成后冒充最终发布证据。其当前机器审计结果为：五路线 5/5、2/2/1、161 个节点、不变量失败 0、发布阻断 0、海报与报告页重复 0。

### 3.3 既有受控验收文件

任何已经由 Git 跟踪的历史验收文件都不属于本轮清理范围。清理只针对未跟踪的中间诊断产物。

## 4. 排除清单

安全提交中排除、清理时删除：

```text
artifacts/financial-debt-browser/**
artifacts/report-invitation-browser/**
```

唯一例外：

```text
!artifacts/report-invitation-browser/2026-07-24T18-00-00+08-00-financial-release-five-v7/**
```

约束：

1. 只删除 `git ls-files --others --exclude-standard` 列出的未跟踪文件。
2. 不删除任何 Git 已跟踪文件。
3. 不删除 v7 下任何文件。
4. 执行删除前必须先保存精确路径清单，并核对其集合不包含保留项。
5. 不使用广义 `rm -rf artifacts` 或 `git clean -fdx`。

## 5. 变更范围审查

### A. 债务账本与迁移

主要内容：偿付瀑布、利息与本金分离、拖欠记录、单一自动缺口账户、缺口债恢复、正式违约、重组/减免守恒、V2→V3 迁移、DebtHealth 派生。

关键文件：

```text
src/domain/finance/accruePeriod.ts
src/domain/finance/reduceFinancialLedger.ts
src/domain/finance/ledgerMath.ts
src/domain/finance/types.ts
src/domain/finance/migrateFinancialLedgerV2ToV3.ts
src/domain/finance/debtHealth.ts
src/domain/finance/automaticShortfallRecovery.test.ts
src/domain/finance/debtDistressLedger.test.ts
src/domain/finance/debtHealth.test.ts
```

集成风险：极高。`main` 同时修改了 `accruePeriod`、`reduceFinancialLedger`、`ledgerMath`、`types` 与旧迁移入口；不能用整文件 ours/theirs 解决。

### B. 职业收入及公司/个人边界

主要内容：公司经营流不进入个人账本，工资/分红/业主提款进入个人账本，创业持股与个人出资配对，职业状态与收入源原子提交。

关键文件：

```text
src/domain/finance/businessLifecycle.test.ts
src/domain/finance/evidenceMatching.ts
src/domain/finance/normalizeFinancialProposals.ts
src/domain/finance/reconcileCareerIncomeAtomicity.ts
src/domain/finance/validateFinancialProposals.ts
src/services/simulation/selectedPersonalIncomeProposal.test.ts
```

集成风险：极高。`main` 的 19 个提交中已加入 personal-ledger boundary、career income replacement、late-life closure、opening ledger 与 option lifecycle；应保留 `main` 的新事实入口，再叠加债务分支更严格的边界和原子性门禁，禁止重复实现。

### C. 叙事与终局报告接地

主要内容：closing-ledger authority、债务 claims 封闭集合、局部修复、叙事化降级、终局标题数值白名单、占位符/长浮点/无事实清偿声明拦截。

关键文件：

```text
src/utils/debtNarrativeAuthority.ts
src/utils/financialNarrative.ts
src/utils/finalFinancialNarrativeAuthority.ts
src/utils/finalOutcomeFinancialSanitizer.ts
src/services/finalOutcome/finalOutcomeService.ts
src/services/finalOutcome/prompts.ts
src/services/simulation/prompts.ts
```

集成风险：高。`main` 同时修改 prompt、simulation pipeline 与 final-outcome sanitizer；冲突解决必须保持“代码拥有事实、模型只渲染”。

### D. 浏览器采集与审计

主要内容：journey identity、显式 resume、邀请/Arc 串线校验、海报与报告页独立截图、财务生产审计与图片重复门禁。

关键文件：

```text
scripts/real-browser-journey-runner.mjs
scripts/real-browser-journey-runner.test.mjs
scripts/analyze-financial-real-browser-run.mjs
scripts/financial-production-audit.test.mjs
scripts/lib/financial-production-audit.mjs
```

集成风险：高。`main` 已增加另一套财务浏览器 audit helpers，并修改相同 analyzer；应合并指标口径，不保留两套互相矛盾的发布结论。

### E. CI 和测试

主要内容：P0、D1–D4.5、M5、M7、报告、业务边界、opening facts、journey isolation 累积门禁。

关键文件：

```text
.github/workflows/financial-debt.yml
package.json
所有新增或修改的 *.test.ts / *.test.mjs
```

集成风险：中高。`package.json` 同时被 `main` 修改；脚本命名与累积顺序必须人工合并，不能覆盖 `main` 新增测试。

### F. 最终验收证据

```text
artifacts/report-invitation-browser/2026-07-24T18-00-00+08-00-financial-release-five-v7/
```

风险：该目录较大，最大单文件约 24 MiB，整体约 68 MiB。它可作为集成前审计附件，但集成后必须生成新的 v8；不得仅重跑静态测试后复用 v7 作发布结论。

## 6. 与 `main` 的高风险重叠

26 个受控文件同时被两边修改：

```text
package.json
scripts/analyze-financial-real-browser-run.mjs
scripts/real-browser-journey-runner.mjs
src/domain/finance/accruePeriod.ts
src/domain/finance/businessLifecycle.test.ts
src/domain/finance/commitFinancialDomainTransaction.test.ts
src/domain/finance/commitFinancialDomainTransaction.ts
src/domain/finance/evidenceMatching.ts
src/domain/finance/index.ts
src/domain/finance/ledgerMath.ts
src/domain/finance/migrateLegacyFinancialState.ts
src/domain/finance/normalizeFinancialProposals.test.ts
src/domain/finance/normalizeFinancialProposals.ts
src/domain/finance/openingFinancialFacts.ts
src/domain/finance/reduceFinancialLedger.test.ts
src/domain/finance/reduceFinancialLedger.ts
src/domain/finance/types.ts
src/domain/finance/validateFinancialProposals.test.ts
src/domain/finance/validateFinancialProposals.ts
src/services/simulation/financialProposalRepair.test.ts
src/services/simulation/prompts.test.ts
src/services/simulation/prompts.ts
src/services/simulation/simulationService.test.ts
src/services/simulation/simulationService.ts
src/utils/finalOutcomeFinancialSanitizer.test.ts
src/utils/finalOutcomeFinancialSanitizer.ts
```

冲突解决原则：

1. 先按领域不变量决定语义，再编辑文件；不按“哪边更新”决定。
2. `main` 的新事实摄取、支出/期权/退休/死亡闭环默认保留。
3. 债务分支的偿付守恒、DebtHealth、公司/个人边界、closing authority、邀请隔离和发布门禁默认保留。
4. 相同能力只保留一个权威入口、一个 reducer 和一个审计口径。
5. 每解决一组冲突，先跑该组专项测试，再进入下一组。

## 7. 推荐集成顺序

1. 用户确认本清单。
2. 保存精确删除候选路径，执行受限清理，再核验 v7 和所有非验收改动仍存在。
3. 对保留集合执行一次安全提交，提交信息标明 `pre-main-integration verified snapshot`。
4. 推荐把 `origin/main` merge 进债务分支，而不是直接把脏工作区 rebase；这样保留已验证债务快照和 `main` 的提交边界，集中解决一次语义冲突。
5. 按 A→B→C→D→E 顺序解决冲突并逐组测试。
6. 静态门禁全部通过后，生成全新 v8 2/2/1 五路线，重新审计图片与报告。
7. 只有 v8 和 CI 都通过，才推送并创建 PR。

## 8. 本轮不执行

- 不删除任何文件，等待清单确认。
- 不创建安全提交。
- 不 merge/rebase `main`。
- 不运行集成后的 v8。
- 不修改 `financial-upgrade`。
