# 债务生产阻断闭环：可直接开发 Spec

> 状态：Approved for development（2026-07-21 发布阻断补充已合入）
> 日期：2026-07-20，最近修订：2026-07-21
> 目标分支：`codex/financial-debt-distress`
> 上游规格：`2026-07-18-authoritative-financial-ledger-architecture-spec.md`、`2026-07-18-debt-distress-lifecycle-and-event-arc-spec.md`
> 优先级：P0，完成前不得发布债务叙事、终局报告或宣称财务系统 production-ready

## 1. 决策摘要

当前债务账本已经具备单一缺口账户、逐月计划偿付、DebtHealth、债务事件与 Arc，但真实路线证明仍有四类生产阻断：

1. 系统自动创建的 `liquidity_shortfall` 只增不减，未来现金恢复后也不会回补。
2. 终局报告只校验金额，不校验“债务已还清、仍在偿还、仍有房产”等事实语义。
3. 债务叙事校验失败时会把完整故事正文替换成账本提示，形成用户可见“残章”。
4. 起点仍接受模型生成的资产负债快照，用户未声明的房产和房贷可能被迁移成权威账户。

本 Spec 做出以下不可逆设计决策：

- 系统自动缺口债保持零息、`event_driven`，但增加代码拥有的现金缓冲后自动回补机制；不得套用普通贷款合同，也不得凭空估算利率。
- 明确利率或明确月息的合同债必须逐月计息；未知利率不得由模型或系统补猜。
- 终局报告新增结构化 `FinalFinancialNarrativeAuthority`，债务、净资产和房产三类事实采用封闭 claims，覆盖海报标题、称号、摘要、时间线和全部报告段落。
- 节点降级只修复违规句子或段落；禁止用“当前没有可由权威账本确认……”等内部账本语言替换完整节点。
- 新游戏起点的资产、房产、投资和债务只允许由用户明确输入或结构化回答创建；模型生成的 `initialFinancialState` 不再拥有这些账户的写权限。
- 审计脚本本身纳入测试，必须能识别已知的四个 fallback 残章，禁止再次给出假绿灯。
- 修复验证只接受全新生成的真实网页路线，不允许复用 2026-07-19 的 artifacts。

## 2. 本 Spec 对上游规格的覆盖关系

未被本节覆盖的上游设计继续有效。

### 2.1 覆盖自动缺口债规则

上游 Spec §7.1 规定：

```text
liquidity_shortfall.repaymentPolicy.mode = event_driven
```

该字段保持不变，但本 Spec 增加一个仅适用于：

```text
type = liquidity_shortfall
origin = system_auto_shortfall
status = active
```

的代码级 `system_surplus_recovery`。它不是合同月供，不经过普通 `serviceDebtForMonth()`，也不允许作用于显式个人借款。

### 2.2 覆盖 D4.5 降级规则

上游 Spec §23.4 的“参数化生成安全节点正文和选项”改为：

```text
局部事实句修复
→ 局部 AI repair 一次
→ 叙事化局部兜底
→ 保留原节点全部非违规正文和选项
```

禁止整节点替换；禁止用户可见文案出现 `权威账本`、`Accepted Event`、`Proposal`、`fallback`、`账本确认` 等内部术语。

### 2.3 保持非目标

本期仍不实现：

- 征信评分、司法执行、地区化法律与破产规则。
- 自动出售用户资产。
- 根据总债务大小自动生成压力事件。
- 为未知合同补猜利率、罚息或复利。
- 投资资产市场增值模型。
- 完整退休产品策略、人生阶段枚举清理和通用语言润色重构。

## 3. 已确认失败基线

修复前必须把以下真实问题固化为可重复失败样本：

| Case | 失败事实 | 期望修复 |
|---|---|---|
| `real-custom-lifespan` | 现金恢复后 256.6983 万缺口债冻结至死亡；报告声称“还清债务” | 缺口债按盈余回补；报告不得声明清偿 |
| `real-career-first` | 现金 108.0429 万、缺口债 40.5 万长期共存 | 超出现金缓冲的部分必须回补缺口债 |
| `real-education-second` | 现金 143.66 万、缺口债 8.54 万；故事声称还清；出现 3 个 fallback 残章 | 债务下降；完成事实需 Accepted Event；无残章 |
| `real-relationship-first` | 用户未声明房产，却产生 200 万房产和 120 万房贷；出现 1 个 fallback 残章 | 新起点不得创建；旧数据不进入叙事 |
| `real-balance-second` | `real_estate` 非法类型进入账本；净资产含 80 万但房产汇总为 0；卖旧房没有出售账户 | 非法类型拒绝；换房事务原子闭合 |

审计基线必须报告：

```text
actual narrativeFallback nodes = 4
education-second fallback nodes = 3
relationship-first fallback nodes = 1
```

任何脚本对该固定 fixture 返回 0 都必须测试失败。

## 4. 事实所有权

| 事实 | 唯一写入者 | 模型权限 |
|---|---|---|
| 期初资产、债务、现金 | `OpeningFinancialFacts` extractor + initializer | 只能提出待确认候选，不得写账户 |
| 逐月收入、支出、利息、计划本金 | `accruePeriodSlice()` | 无 |
| 自动现金缺口 | `reconcileAutomaticLiquidityShortfall()` | 无 |
| 自动缺口债回补 | `recoverAutomaticLiquidityShortfallFromSurplus()` | 无 |
| 显式借款、还本、出售、购买、减免、重组 | Accepted Financial Event + reducer | 只能提交 Proposal |
| DebtHealth | `deriveDebtHealthState()` | 无 |
| 节点债务事实句 | `DebtNarrativeAuthority` | 只能写体验和权衡 |
| 终局债务、净资产、房产 claims | `FinalFinancialNarrativeAuthority` | 只能按 claims 渲染 |
| fallback 统计 | `financialProcessingMeta` + audit extractor | 无 |

任何摘要、报告、海报、模型 confidence、`FinancialState` compatibility snapshot 都不是事实写入者。

## 5. 账本闭环与自动缺口债回补

### 5.1 账户级恒等式

每笔债务在任意提交期间必须满足：

```text
closingPrincipal
  = openingPrincipal
  + principalDrawn
  + explicitPrincipalIncrease
  + capitalizedInterest
  - principalPaid
  - principalForgiven

closingAccruedInterest
  = openingAccruedInterest
  + currentInterestAccrued
  - interestPaid
  - interestForgiven
  - capitalizedInterest
```

全账本必须满足：

```text
closingDebt = Σ(active/defaulted principal + accrued unpaid interest)
cash >= 0
active system auto-shortfall account count <= 1
unexplained debt delta = 0
```

`FinancialTransaction` 增加或确保存在：

```ts
interface FinancialTransaction {
  debtPrincipalDrawnWan: number;
  debtPrincipalPaidWan: number;
  debtPrincipalForgivenWan: number;
  debtInterestAccruedWan: number;
  debtInterestPaidWan: number;
  debtInterestForgivenWan: number;
  debtCapitalizedInterestWan: number;
  automaticLiquidityShortfallIncreaseWan: number;
  automaticLiquidityShortfallRecoveryWan: number;
}
```

兼容规则：新事务必须写全上述字段；旧 History/transaction 在 restore 或 v2→v3 migration 边界统一补 0。持久化类型在迁移完成前可以把新增字段声明为 optional，但领域 reducer 的 canonical transaction 类型必须为 required，禁止业务代码到处使用 `?? 0` 猜测。

### 5.2 明确合同债计息

`serviceDebtForMonth()` 继续只自动处理非 `event_driven` 债务。

```text
currentInterestDue =
  monthlyInterestWan
  ?? principalWan * annualInterestRate / 12
  ?? 0
```

规则：

- `monthlyInterestWan` 或 `annualInterestRate` 已知时，必须按月计提。
- 当期计提利息无论是否支付，都只确认一次费用。
- 未付利息进入 `accruedUnpaidInterestWan`，默认不复利。
- 利率未知时保持 0，并产生/保留 `UNKNOWN_DEBT_SCHEDULE`；不得估算 6%、18% 或其他默认值。
- `liquidity_shortfall` 永不进入本合同计息函数。

### 5.3 自动缺口债现金缓冲

新增集中策略：

```ts
export interface AutomaticShortfallRecoveryPolicy {
  reserveExpenseMonths: 3;
  minimumReserveWan: 0;
  maximumRecoveryPerMonthWan?: number;
}

export const DEFAULT_AUTOMATIC_SHORTFALL_RECOVERY_POLICY = {
  reserveExpenseMonths: 3,
  minimumReserveWan: 0
} as const;
```

月度现金缓冲：

```text
activeMonthlyCoreExpense
  = Σ 当前月 active ExpenseCommitment.monthlyAmountWan

cashReserveTarget
  = max(minimumReserveWan,
        activeMonthlyCoreExpense * reserveExpenseMonths)
```

若成年用户没有任何 active ExpenseCommitment：

- 不得把缓冲视为 0 后清空现金；
- 创建/保留 blocking `PENDING_FACT_MISSING_ADULT_EXPENSE`；
- 当月跳过系统自动回补，直到支出事实修复。

### 5.4 自动回补算法

新增：

```ts
recoverAutomaticLiquidityShortfallFromSurplus(input: {
  ledger: FinancialLedger;
  ageInMonths: number;
  transactionId: string;
  policy?: AutomaticShortfallRecoveryPolicy;
}): {
  principalRecoveredWan: number;
  debtAccountId?: string;
};
```

每月顺序：

```text
1. 结算持续收入
2. 扣除非债务必要支出
3. 非债务缺口转入单一 auto-shortfall，现金回到 0
4. 支付明确合同债的利息和计划本金
5. 计算 cashReserveTarget
6. surplus = max(0, cash - cashReserveTarget)
7. recovery = min(surplus, active auto-shortfall principal)
8. cash -= recovery
9. auto-shortfall principal -= recovery
10. 写 transaction 中的 system audit record；不伪造模型 Proposal 或 Accepted Event
11. 本金归零时账户设为 repaid
```

回补要求：

- 只作用于 `origin: system_auto_shortfall`。
- 不作用于信用卡、房贷、亲友借款或其他显式 `event_driven` 债务。
- 不创造利息、不修改合同状态、不关闭其他债务 issue。
- 使用稳定 reason code：`AUTOMATIC_SHORTFALL_RECOVERED_FROM_SURPLUS`。
- 一个事务重放不能重复回补。
- 回补后重新派生 DebtHealth 和 Narrative Authority。

### 5.5 自动缺口债长期冻结不变量

每月提交后：

```text
if active auto-shortfall exists
and adult expense facts are available
then cash <= cashReserveTarget + epsilon
     OR auto-shortfall principal = 0
```

审计允许一个节点跨越多个月，但不允许在任何内部月末违反该不变量。

### 5.6 故事中的显式还款

模型写出以下完成事实时必须提交匹配 Proposal：

- 已偿还、还清、结清、付清、提前还款；
- 每月用于还债的明确金额；
- 债务余额已下降；
- 减免、豁免、重组已经生效。

映射：

| 叙事事实 | 必须存在 |
|---|---|
| 显式偿还普通债务 | accepted `debt_principal_repaid` / `debt_interest_paid` |
| 自动缺口债因盈余下降 | system audit `AUTOMATIC_SHORTFALL_RECOVERED_FROM_SURPLUS` |
| 还清 | closing 目标债务 principal + interest = 0 且 status = repaid |
| 重组生效 | accepted `debt_restructured` |
| 债务减免 | accepted `debt_forgiven` |

无匹配事实时，局部改写为“计划、尝试、开始预留”而不是完成。

## 6. 债务增量解释契约

扩展 `DebtNarrativeAuthority`：

```ts
interface DebtDeltaBreakdown {
  openingDebtWan: number;
  closingDebtWan: number;
  drawsWan: number;
  automaticShortfallIncreaseWan: number;
  currentInterestAccruedWan: number;
  principalPaidWan: number;
  interestPaidWan: number;
  forgivenWan: number;
  automaticShortfallRecoveryWan: number;
  unexplainedDeltaWan: number;
}
```

规则：

- `abs(unexplainedDeltaWan) > 0.01` 时禁止提交节点。
- closing debt 相比 opening debt 变化超过 0.01 万时，Authority 必须提供至少一条 canonical delta fact。
- 自动缺口增额不得被写成信用卡、房贷、借款到账或机构处罚。
- `real-career-first` 中 9 万信用卡 + 40.5 万自动缺口必须分开呈现，不能只写“欠款累积到 9 万”。
- 模型可以不重复精确金额，但不能给出与 breakdown 冲突的总额或原因。

## 7. 终局报告权威事实约束

### 7.1 结构化 Authority

新增 `src/utils/finalFinancialNarrativeAuthority.ts`：

```ts
type FinalDebtClaim =
  | { kind: "no_active_debt" }
  | { kind: "debt_outstanding"; totalDebtWan: number }
  | { kind: "debt_repayment_in_progress"; totalDebtWan: number }
  | { kind: "debt_fully_repaid"; evidenceAccountIds: string[] }
  | { kind: "formal_default_outstanding"; totalDebtWan: number };

type FinalNetWorthClaim =
  | { kind: "positive_net_worth"; netWorthWan: number }
  | { kind: "zero_net_worth" }
  | { kind: "negative_net_worth"; netWorthWan: number };

type FinalPropertyClaim =
  | { kind: "no_confirmed_property" }
  | { kind: "confirmed_property_holdings"; properties: Array<{ id: string; displayName: string; marketValueWan: number; factStatus: FinancialFactStatus }> };

interface FinalFinancialNarrativeAuthority {
  version: "final_financial_narrative_v1";
  asOfAgeInMonths: number;
  debt: FinalDebtClaim;
  netWorth: FinalNetWorthClaim;
  property: FinalPropertyClaim;
  permittedSemanticClaims: string[];
  forbiddenSemanticClaims: string[];
  canonicalSummary: string;
}
```

只从最终提交的 `FinancialLedger` 和 `DerivedFinancialStateV2` 派生。

### 7.2 覆盖表面

校验必须覆盖：

- `share.viralTitle`
- `share.covenantTitle`
- `share.oneLineSummary`
- `share.timeline[].title`
- `share.timeline[].choiceSummary`
- `share.imageAlt`
- `report.executiveSummary`
- `repeatedPatterns`
- `patternEffects`
- `futureTrends`
- `patternsToKeep`
- `patternsToAdjust`
- `finalLifeReading`

不得只扫描报告正文或数字。

### 7.3 封闭语义规则

若 `debt.kind` 为 `debt_outstanding`、`debt_repayment_in_progress` 或 `formal_default_outstanding`：

- 禁止：还清、结清、清偿完毕、无债一身轻、摆脱全部债务、不再欠债。
- 允许：持续偿还、债务仍在、偿债安排、带债生活、部分下降。

若 `debt.kind === no_active_debt`：

- 可以写当前无债。
- 只有历史中存在可靠 `debt_fully_repaid` 证据时才能写“还清了债务”。

若 `netWorth.kind === negative_net_worth`：

- 禁止：财务自由、资产充足、财富安全垫已经建立、经济无忧。
- 允许：现金流暂时恢复但净资产仍为负。

若 `property.kind === no_confirmed_property`：

- 禁止：名下房产、出售自己的房屋、房产升值、房贷压力。

`needs_review`、`unknown` 或 `legacy_migration` 且缺少用户证据的房产只能写“存在待核实的历史资产记录”，第一版默认完全不进入报告和海报。

### 7.4 生成、修复与降级

```text
生成报告
→ normalize schema
→ sanitize allowed numeric values
→ validate FinalFinancialNarrativeAuthority
→ 若冲突：只重写冲突字段一次
→ 再校验
→ 仍冲突：代码确定性替换冲突字段
→ 最终全量校验
```

确定性替换不得删除整个报告。最低规则：

- 标题冲突：从不含财务完成结论的关键选择生成标题。
- 摘要冲突：使用 `canonicalSummary`。
- 时间线冲突：保留年龄和非财务标题，删除或改写财务完成词。
- 报告段落冲突：只替换违规句子。

最终校验失败时报告生成失败，不得展示、下载或保存冲突报告。

### 7.5 报告审计元数据

扩展 outcome meta：

```ts
financialNarrativeAuthorityVersion: "final_financial_narrative_v1";
financialClaimRepairTriggered: boolean;
financialClaimFallbackCount: number;
financialClaimViolationCodes: string[];
sourceLedgerRevision: number;
```

新生成的报告必须写全这些字段；旧存档的 `FinalLifeOutcome.meta` 允许字段缺失，恢复时视为 `financialNarrativeAuthorityVersion=undefined`，不得将旧报告重新标记为已通过新门禁。

## 8. 节点 fallback 的用户可见质量

### 8.1 问题定位

当前 `applyDebtNarrativeFallback()` 会生成类似：

```text
当前没有可由权威账本确认的债务完成事实。
现有还款仍按账本记录执行……
```

这类文本只能用于内部诊断，禁止进入用户正文。

### 8.2 Surface 级修复

新增：

```ts
interface DebtNarrativeSurfaceIssue {
  surface: "description" | "choice_text" | "choice_impact" | "episode_summary" | "transition_summary" | "arc_evidence";
  path: string;
  start?: number;
  end?: number;
  reasonCode: string;
  offendingText: string;
}
```

修复只允许修改 issue 指向的文本段，不得改变：

- 年龄和 elapsed months；
- 选项 ID、`eventOutcomeId`、`decisionIntent`；
- Proposal、Accepted Event；
- Ledger、DebtHealth、Arc；
- 非违规段落和人物事实。

### 8.3 修复顺序

```text
1. canonical replacement：能由代码事实句直接替换时，不调用模型
2. targeted AI repair：仅传违规句、相邻上下文、Authority 和保留要求
3. narrative fallback：从叙事化模板库替换违规句
4. 全表面复验
```

每个 surface 最多一次 AI repair。禁止重新生成整个节点。

### 8.4 叙事化兜底要求

兜底句必须：

- 使用人物当前行动、生活选择和可确认财务状态；
- 不出现内部系统术语；
- 不声称债务完成、重组生效或机构行动；
- 能自然连接前后段落；
- 至少提供 6 组按状态组合的模板，不能所有节点使用同一句。

示例：

```text
你没有把这次协商当成已经完成的结果，而是先重新安排日常开支，等待下一步确认。

收入恢复后，你开始固定留出一部分现金处理旧欠款，同时保留基本生活缓冲。

债务仍在，但它不再占据全部生活；你把注意力放回可持续的工作和休息节奏。
```

### 8.5 记录与指标

`financialProcessingMeta` 是唯一统计位置：

```ts
narrativeFallback: boolean;
narrativeFallbackReasonCodes: string[];
narrativeRepairAttempts: number;
narrativeRepairSucceeded: boolean;
narrativeFallbackSurfacePaths: string[];
```

`narrativeFallback=true` 表示最终用户内容使用了代码兜底，而不是发生过普通 sanitize。

## 9. 起点资产负债封闭摄取

### 9.1 新游戏规则

模型返回的 `initialFinancialState` 不再允许创建：

- `propertyMarketValueWan`
- `investmentAssetsWan`
- `businessAndOtherAssetsWan`
- `totalDebtWan`

这些字段即使返回，也必须被忽略并记录 `MODEL_OPENING_BALANCE_IGNORED`。

权威起点只来自：

```ts
interface OpeningFinancialFacts {
  cash?: OpeningMoneyFact;
  properties: OpeningPropertyFact[];
  investments: OpeningAssetFact[];
  businessHoldings: OpeningBusinessHoldingFact[];
  debts: OpeningDebtFact[];
  income: OpeningIncomeFact[];
  expenses: OpeningExpenseFact[];
}

interface OpeningFactEvidence {
  source: "user_profile" | "structured_answer";
  fieldPath: string;
  excerpt: string;
  confidence: 1;
}
```

账户创建必须包含非空 evidence。

### 9.2 允许估算的范围

- 用户明确“有房但不知道市值”：可创建 `property`，`marketValueWan=0`、`factStatus=needs_review`，不计入净资产和叙事。
- 用户明确“有房贷但不知道余额”：创建 `PENDING_OPENING_DEBT_BALANCE` unresolved fact，不创建 `principalWan=0` 的伪债务账户，也不得触发压力事件；补齐余额后才创建账户。
- 用户只说“有 20 万存款”：只创建 20 万现金，不得创建房产或债务。
- 模型可以为明确存在的工作提出收入估算 Proposal，但必须进入 validator；不能在起点静默成为 known 事实。
- 成年生活支出允许按产品政策建立显式 estimated commitment，但必须标记 `system_policy`，不能反推出房屋、房贷或家庭结构。

### 9.3 旧存档迁移

现有 `legacy_migration` 账户不删除，但按证据分层：

```text
有 user_profile / structured_answer evidence
  → 保留原 factStatus

只有 LEGACY_FINANCIAL_STATE_MIGRATION 或 system_policy evidence
  → factStatus = needs_review
  → isNarrativeEligibleFinancialFact(account) = false
  → isReportEligibleFinancialFact(account) = false
  → isDebtCrisisEligibleAccount(account) = false
```

这三个 eligibility 由共享 helper 根据 `factStatus` 和 evidence 派生，不增加可漂移的持久化布尔字段。本期不要求新增确认 UI。没有 UI 时采取保守策略：账户继续留在审计账本，但不进入故事、报告、海报和债务压力事件。

## 10. 房产与资产事务完整性

### 10.1 类型边界

`AssetType` 继续只允许：

```ts
"investment" | "property" | "annuity" | "insurance_cash_value" | "other_personal_asset"
```

新 Proposal 中的 `real_estate`、`house`、`apartment` 等未知值直接拒绝，返回 `INVALID_ASSET_TYPE`。不得在 validator 后让非法类型进入账本。

旧存档迁移可以将已知别名 `real_estate` 映射为 `property`，必须写 `LEGACY_ASSET_TYPE_NORMALIZED` evidence。

### 10.2 买卖事务

“卖旧房换新房”必须在同一原子事务中包含：

```text
asset_sold(assetAccountId, assetValueRemovedWan, cashReceivedWan, transactionFeeWan)
asset_purchased(newAssetAccount, sourceCashAccountId, cashPaidWan)
```

守恒：

```text
cash delta
  = sale proceeds
  - sale fee
  - purchase cash paid
  - purchase fee

asset delta
  = - old carrying market value
  + new carrying market value
```

规则：

- 被出售资产必须在 opening ledger 中 active。
- 不存在旧房账户时，“卖掉城市公寓” Proposal 和完成叙事均拒绝。
- `asset_purchased` 必须包含非空 evidence。
- 若卖房金额未知，不允许自行生成“余款存入银行”；只能写交易仍待核实或不发生交易。
- `deriveFinancialState()`、面板汇总和 `ledgerNetWorthWan()` 必须对同一资产类型集合达成一致。

## 11. 审计与 CI 不得假绿

### 11.1 单一 extractor

新增或集中：

```ts
extractFinancialNarrativeAuditMeta(node: HistoryItem): {
  narrativeFallback: boolean;
  fallbackReasonCodes: string[];
  repairAttempts: number;
  repairSucceeded: boolean;
};
```

只读取 `financialProcessingMeta`。禁止各报告脚本分别猜字段路径。

### 11.2 审计输出

`finance-audit.json` 必须新增：

```ts
interface FinanceNarrativeAuditSummary {
  narrativeFallbackNodeCount: number;
  narrativeFallbackCaseCount: number;
  fallbackReasonCodeCounts: Record<string, number>;
  fallbackWithoutRepairRecordCount: number;
  userVisibleInternalLedgerTextCount: number;
  finalReportFinancialConflictCount: number;
  unexplainedDebtDeltaNodeCount: number;
  fabricatedOpeningAccountCount: number;
  assetSummaryMismatchNodeCount: number;
}
```

报告必须同时写 numerator、denominator 和具体节点索引，不得只写“通过”。

### 11.3 已知坏样本反向测试

固定 2026-07-19 artifacts 的最小裁剪 fixture，只保留必要字段，不把完整真实结果复制进单元测试。

测试必须断言：

```text
fallback count = 4
final report conflict >= 1
unexplained debt delta >= 1
fabricated opening account >= 1
asset summary mismatch >= 1
```

该 fixture 是审计脚本测试，不是修复后的验收数据。

## 12. 文件级实施清单

### 12.1 账本层

- `src/domain/finance/accruePeriod.ts`
  - 明确合同债按月计息保持不变。
  - 在合同 debt service 后调用 auto-shortfall recovery。
- `src/domain/finance/reduceFinancialLedger.ts`
  - 实现稳定、幂等的系统回补事务。
  - 补齐债务 delta audit 字段。
- `src/domain/finance/types.ts`
  - 增加 recovery policy、transaction delta 字段和必要 reason code。
- `src/domain/finance/ledgerMath.ts`
  - 增加账户级 debt conservation assertion。
- `src/domain/finance/deriveFinancialState.ts`
  - 确保资产枚举与 net worth/summary 完全一致。
- `src/domain/finance/migrateFinancialLedgerV2ToV3.ts`
  - 旧非法资产别名归一化；缺失证据账户改 needs-review。

### 12.2 Validator 与起点

- `src/domain/finance/validateFinancialProposals.ts`
  - 拒绝非法资产类型、空证据资产交易、不存在资产出售。
- `src/services/simulation/simulationService.ts`
  - 起点不再使用模型余额创建资产负债。
  - 接入回补后 Authority、局部修复和最终复验。
- `src/services/simulation/prompts.ts`
  - 删除 200 万房产/120 万房贷等起点示例锚点。
  - 明确 initial asset/debt fields 无写权限。
- 起点 extractor 所在文件
  - 输出强类型 `OpeningFinancialFacts` 和 evidence。

### 12.3 叙事与报告

- `src/utils/debtNarrativeAuthority.ts`
  - 增加 debt delta breakdown 和自动回补事实。
  - 改为 surface/segment 级修复。
- `src/utils/financialNarrative.ts`
  - 只做最后安全门，不生成整段内部文本。
- `src/utils/finalFinancialNarrativeAuthority.ts`（新增）
  - 终局 claims 派生和全表面校验。
- `src/utils/finalOutcomeFinancialSanitizer.ts`
  - 保留金额校验；接入语义 Authority，不再单独承担一致性。
- `src/services/finalOutcome/prompts.ts`
  - 注入结构化 claims、permitted/forbidden semantics。
- `src/services/finalOutcome/finalOutcomeService.ts`
  - 生成后校验、局部 repair、确定性降级和最终失败策略。

### 12.4 审计与 CI

- `scripts/analyze-financial-real-browser-run.mjs`
  - 使用统一 extractor，输出真实 fallback 和冲突指标。
- `scripts/render-full-browser-test-data-markdown.ts`
  - 显示 fallback、repair、Authority version 和冲突结果。
- `.github/workflows/financial-debt.yml`
  - 增加 P0 gate 和真实 artifacts schema 校验。
- `package.json`
  - 增加本 Spec 的分层测试脚本。

## 13. 测试规格

### 13.1 Gate P0-A：审计可信度

1. `PB-AUDIT-01`：四个 fallback fixture 必须统计为 4。
2. `PB-AUDIT-02`：读取 `narrativeMeta` 而非 `financialProcessingMeta` 的实现必须失败。
3. `PB-AUDIT-03`：报告“还清”而终局债务大于 0 必须识别冲突。
4. `PB-AUDIT-04`：非法资产类型导致净资产/房产汇总不一致必须识别。
5. `PB-AUDIT-05`：用户未声明但只有 legacy migration evidence 的房产必须识别为 fabricated/unsupported opening account。

### 13.2 Gate P0-B：偿还闭环

1. `PB-DEBT-01`：auto-shortfall + 现金低于三个月缓冲，不回补。
2. `PB-DEBT-02`：现金超过缓冲，超出部分回补 auto-shortfall。
3. `PB-DEBT-03`：现金足以清偿，账户进入 repaid，剩余现金保留缓冲。
4. `PB-DEBT-04`：成年支出事实缺失时不自动清空现金。
5. `PB-DEBT-05`：显式 event-driven 亲友借款不被系统自动偿还。
6. `PB-DEBT-06`：已知年利率合同逐月计息。
7. `PB-DEBT-07`：未知利率债务不凭空计息。
8. `PB-DEBT-08`：回补事务重放不重复扣现金。
9. `PB-DEBT-09`：每笔账户 debt conservation 恒等式成立。
10. `PB-DEBT-10`：40.5 万自动缺口与 9 万信用卡分别进入 delta breakdown。

### 13.3 Gate P0-C：节点叙事

1. `PB-NARR-01`：故事声称还清但账户未清偿，局部降级为尝试/持续偿还。
2. `PB-NARR-02`：自动回补成功可以写对应代码事实。
3. `PB-NARR-03`：局部 repair 不改变非违规段落。
4. `PB-NARR-04`：局部 repair 不改变选项 ID、Proposal、Ledger、DebtHealth 或 Arc。
5. `PB-NARR-05`：repair 失败后使用叙事化模板。
6. `PB-NARR-06`：用户可见正文内部术语计数为 0。
7. `PB-NARR-07`：fallback 元数据写入唯一正确位置。

### 13.4 Gate P0-D：终局报告

1. `PB-REPORT-01`：终局债务大于 0，标题“还清债务”必须失败。
2. `PB-REPORT-02`：负净资产报告“财务自由”必须失败。
3. `PB-REPORT-03`：无确认房产时报告“出售名下房产”必须失败。
4. `PB-REPORT-04`：冲突覆盖 title、covenant、summary、timeline、imageAlt 和全部报告段落。
5. `PB-REPORT-05`：局部 repair 成功后保留报告 schema 和非冲突字段。
6. `PB-REPORT-06`：repair 失败后确定性字段降级仍通过最终校验。
7. `PB-REPORT-07`：最终仍冲突时拒绝展示和下载。

### 13.5 Gate P0-E：起点和资产事务

1. `PB-OPEN-01`：用户只声明 20 万现金，只创建现金账户。
2. `PB-OPEN-02`：模型返回 200 万房产/120 万房贷被忽略。
3. `PB-OPEN-03`：用户明确房产和房贷时，账户包含原始 evidence。
4. `PB-OPEN-04`：纯 legacy migration 房产不进入故事、报告或压力事件。
5. `PB-ASSET-01`：新 Proposal 的 `real_estate` 被拒绝。
6. `PB-ASSET-02`：卖出不存在的城市公寓被拒绝并改写叙事。
7. `PB-ASSET-03`：旧房出售 + 新房购买现金与资产原子守恒。
8. `PB-ASSET-04`：账本房产、Derived State 房产和净资产使用同一类型集合。

## 14. CI 命令与顺序

`package.json` 增加：

```json
{
  "test:financial-production-audit": "node --import tsx --test src/utils/financialProductionAudit.test.ts",
  "test:financial-debt-recovery": "node --import tsx --test src/domain/finance/automaticShortfallRecovery.test.ts src/domain/finance/debtConservation.test.ts",
  "test:financial-debt-narrative": "node --import tsx --test src/utils/debtNarrativeAuthority.test.ts src/utils/finalFinancialNarrativeAuthority.test.ts",
  "test:financial-opening-assets": "node --import tsx --test src/services/simulation/openingFinancialFacts.test.ts src/domain/finance/assetTransaction.test.ts",
  "test:financial-production-blockers": "pnpm test:financial-production-audit && pnpm test:financial-debt-recovery && pnpm test:financial-debt-narrative && pnpm test:financial-opening-assets && pnpm test:financial-debt && pnpm test:financial-m5 && pnpm test:financial-m7"
}
```

PR CI 顺序：

```text
lint/typecheck
→ P0-A audit credibility
→ P0-B debt recovery
→ P0-C/D narrative and final report
→ P0-E opening/assets
→ existing D1–D4.5
→ M5
→ M7
→ full unit regression
→ build
```

任一 P0 gate 失败，后续真实路线结果不得标记 release candidate。

## 15. 分 PR 开发计划

### PR 0：可信审计基线

交付：

- 统一 audit meta extractor。
- 五类新增审计指标。
- 已知坏样本反向测试。
- 修正 evaluation report 的 fallback 口径。

完成门：P0-A 全绿；旧 fixture 必须准确报 4 个 fallback。

### PR 1：自动缺口债偿还与利息闭环

交付：

- 现金缓冲策略。
- auto-shortfall surplus recovery。
- 账户级 debt conservation。
- 明确合同债利息测试和未知利率保守策略。
- transaction/period audit 字段。

完成门：P0-B、D1a、D1b、M5 全绿。

### PR 2：债务增量与节点局部修复

交付：

- `DebtDeltaBreakdown`。
- canonical repayment/shortfall facts。
- surface 级 issue、targeted repair 和叙事化 fallback。
- 禁止整节点残章。

完成门：P0-C、D4.5 全绿；固定残章文本命中数为 0。

### PR 3：终局报告权威 claims

交付：

- `FinalFinancialNarrativeAuthority`。
- 全报告表面校验。
- 局部 report repair、确定性降级和 fail-closed。
- 报告 audit meta。

完成门：P0-D 全绿；终局账本—报告冲突为 0。

### PR 4：起点封闭摄取与资产原子事务

交付：

- 模型 opening balances 写权限移除。
- evidence-backed `OpeningFinancialFacts`。
- legacy needs-review 隔离。
- strict asset type validator。
- 房产出售/购买原子闭环。

完成门：P0-E、M7、全量回归全绿。

### PR 5：新鲜真实路线与发布候选

交付：

- 新的债务专项路线 artifacts。
- 新的 2/2/1 五路线 artifacts。
- 新 evaluation report、finance audit、manifest、完整节点数据和截图。
- 发布/不发布结论。

不得修改生产逻辑来适配某个固定 seed；不得复用旧 JSON。

## 16. 真实网页验收矩阵

### 16.1 债务专项路线

至少五条：

1. `no-debt-to-contract-debt-paid`：0 债务 → 明确借款 → 正常计息偿还 → 清偿。
2. `shortfall-to-surplus-recovery`：持续缺口 → 单一 auto-shortfall → 收入恢复 → 保留三个月缓冲 → 债务下降/清偿。
3. `manageable-mortgage-with-cash`：正常房贷 + 现金储备，DebtHealth manageable，不错误强制提前还清、不触发压力事件。
4. `distress-with-local-narrative-repair`：现金流恶化 → pressure event → 一个故意冲突 claim 被局部修复，非财务正文保留。
5. `terminal-debt-report-consistency`：带债且负净资产到终局，海报和报告明确仍有债务，不出现“还清/财务自由”。

### 16.2 完整五路线

固定 2/2/1：

- 2 条首次邀请接受。
- 2 条拒绝第一次、接受第二次。
- 1 条持续拒绝直到自然寿命终点。

每条保存：

- 所有节点正文、四个选项和用户选择；
- FinancialLedger、DerivedFinancialState、DebtHealth；
- transaction debt delta breakdown；
- fallback/repair meta；
- report Authority 和 violation 结果；
- 邀请记录、最终报告、海报和整页截图。

## 17. 生产上线门禁

必须全部满足：

```text
audit known-bad detection rate = 100%
ledger invariant failures = 0
debt conservation failures = 0
unexplained debt delta nodes = 0
auto-shortfall frozen above reserve nodes = 0
known-rate interest omission nodes = 0
story completed repayment without accepted/system fact = 0
user-visible internal ledger text nodes = 0
final report financial conflicts = 0
unsupported opening property/debt accounts = 0
asset summary mismatch nodes = 0
new real route narrativeFallback residual chapters = 0
all fallback uses have repair/fallback audit records = 100%
black/empty poster exports = 0
M5 = green
M7 = green
full unit/lint/typecheck/build = green
fresh debt routes = 5/5
fresh 2/2/1 route contract = green
```

关于 fallback：允许代码最终使用叙事化局部兜底，但验收中的“残章为 0”指用户可见内部账本文本和整节点替换为 0。报告必须同时给出真实 fallback count，不能把使用过兜底的节点统计成 0。

## 18. 回滚与发布策略

### 18.1 Feature flags

建议短期使用：

```ts
financialDebtRecoveryV1
finalFinancialNarrativeAuthorityV1
closedWorldOpeningFinanceV1
```

这些 flag 只用于影子对比和紧急回滚，不允许长期维护两套 reducer。

### 18.2 影子模式

- PR 1 可对同一 opening ledger 计算旧/新 closing candidate，只提交新逻辑前保存 diff。
- 影子结果不得调用第二次模型，不得污染用户状态。
- 重点比较 cash、principal、interest、net worth、DebtHealth 和 issue。

### 18.3 Fail closed

- 账本不守恒：节点失败，不提交。
- 终局报告仍与 Authority 冲突：报告失败，不展示、不下载。
- 起点出现无 evidence 资产或债务：忽略该账户并记录 issue，不让其进入叙事。
- fallback 仍包含内部文本：节点失败，不提交。

## 19. 风险与控制

| 风险 | 等级 | 控制 |
|---|---|---|
| 自动回补清空生活现金 | 高 | 三个月核心支出缓冲；缺失支出时跳过并阻断 |
| 自动偿还真实亲友借款违背人物意愿 | 高 | 只回补 system auto-shortfall |
| 为未知债务虚构利率 | 高 | 只有明确利率计息；未知计划 needs-review |
| 终局 denylist 继续打地鼠 | 高 | 结构化 claims + canonical semantics + 全表面验证 |
| 局部 repair 破坏选项或 Arc | 高 | path 级修改；结构化字段深比较不变量 |
| 关闭模型 opening 写权限导致信息减少 | 中 | 用户 evidence extractor；未知事实保守为空，不用编造补齐 |
| 旧 legacy 账户突然消失 | 中 | 账本保留但 narrative/report/event 隔离 |
| 房产别名迁移改变汇总 | 中 | migration audit + 迁移前后 net worth 守恒 |
| 审计脚本再次漂移 | 高 | 单一 extractor + known-bad fixture 进入 CI |
| 真实路线随机性掩盖问题 | 中 | 固定场景契约，不固定生成文本；保存失败尝试 |

## 20. Definition of Done

本 Spec 只有在以下事实同时成立时完成：

1. 自动缺口债能在未来盈余超过生活缓冲后确定性下降并清偿。
2. 明确合同债按计划计息和还本；未知利率不被编造。
3. 所有债务变化都能由 transaction delta breakdown 完整解释。
4. 故事中的还款完成事实都有 Accepted Event 或 system recovery record。
5. 节点修复不再产生内部账本残章，也不重新生成整个节点。
6. 终局报告、海报、时间线与终局债务、净资产和房产事实一致。
7. 用户未声明的资产和债务不能从模型 opening snapshot 进入权威账本。
8. 房产买卖使用合法类型、真实账户和原子现金闭环。
9. 审计脚本能识别旧的四个 fallback 和全部已知冲突，不再假绿。
10. 所有 P0 gates、M5、M7、全量测试、lint、typecheck 和 build 通过。
11. 五条全新债务路线和全新 2/2/1 五路线通过生产门禁。
12. 海报下载产物可见、非全黑，最终报告可正常展示。

## 21. 最终原则

债务不能因为故事没有继续提就冻结，也不能因为模型说“还清”就消失。

账本负责债务如何产生、计息、偿还和清偿；Authority 负责这些事实允许怎样被表达；模型只负责人物如何体验和选择。审计系统必须验证真实输出，而不是验证自己希望看到的结果。三者任一未闭环，都不能发布。

## 22. 2026-07-21 发布阻断补充（规范性覆盖）

本节针对 2026-07-20 五路线验收暴露出的新问题补充可执行契约。若本节与前文的“金额 sanitize”“公司经营事实”或“真实路线复用”规则冲突，以本节为准。

本轮只处理：终局数值标题、占位符零泄漏、公司/个人边界、职业收入原子契约、债务完成表述、邀请证据隔离和财务金额格式化。利率模型扩展、成年支出动态化和 `lifeStage` 清理继续属于非目标。

### 22.1 终局标题数值白名单

结局标题可以使用数值，但数值必须来自终局提交后的 Authority，不能从正文、模型摘要或公司经营口径重新抽取。

新增：

```ts
interface FinalFinancialNumericClaim {
  kind:
    | "cash"
    | "total_debt"
    | "net_worth"
    | "property_market_value"
    | "personal_annual_income"
    | "personal_annual_expense";
  valueWan: number;
  displayText: string;
  sourceLedgerRevision: number;
}

interface FinalFinancialNarrativeAuthority {
  // existing fields omitted
  numericClaims: FinalFinancialNumericClaim[];
}
```

白名单只允许：

- `cash`：终局报告可用现金账户合计。
- `total_debt`：终局报告可用 active/defaulted 债务本金与未付利息合计。
- `net_worth`：同一报告口径下的现金 + 资产 + 企业个人权益 - 债务。
- `property_market_value`：仅 `known` 且 report-eligible 的房产合计。
- `personal_annual_income`：终局有效个人收入来源未来 12 个月 horizon-aware 合计；公司营业收入不在此列。
- `personal_annual_expense`：终局有效个人支出承诺未来 12 个月 horizon-aware 合计；公司运营费用不在此列。

统一格式化：

```text
abs(valueWan) >= 100  → 最多 1 位小数
abs(valueWan) < 100   → 最多 2 位小数
去除末尾 0
禁止指数、超过 2 位小数、二进制浮点尾差
```

示例：`839.6358 → 839.6 万`，`54.9996 → 55 万`。

标题、摘要或报告中的每个财务金额必须能映射到一个 `numericClaim`。校验比较原始 `valueWan`，展示只使用 `displayText`。不得为了让模型数字过审而扩大近似误差范围。

公司月营收、融资额、估值只有在另一个明确的公司事实 Authority 中才可作为“公司”数值出现；它们永远不能匹配 `personal_annual_income`。

### 22.2 占位符与截断金额零泄漏

开局标题同样属于权威财务叙事表面。若开局账本已有显式房贷，标题不得写“房贷还没背”等否认事实；代码应改写为不虚构数字的定性标题。若账本无债，标题也不得凭空宣称负债。

`sanitizeFinalOutcomeFinancialClaims()` 不再把不被允许的金额替换成用户可见占位符。以下文本在所有用户可见表面均为禁止项：

```text
金额待账本确认
回报幅度待账本确认
回报率待账本确认
价值待确认
账本确认
负债 8…（以及任何金额词后仅残留数字前缀 + 省略号）
```

处理顺序：

```text
1. 若金额能唯一映射 numericClaim：替换为 canonical displayText。
2. 若不能映射：对该完整句子做一次局部 AI repair，要求删除未经确认的金额而保留人生事实。
3. repair 仍失败：用代码拥有的定性句替换完整句子。
4. 全表面重新扫描；仍有占位符、内部术语、孤立金额前缀或长浮点时，终局报告失败且不可展示/下载。
```

禁止只替换数字 token，因为那会生成“月入金额待账本确认”或“负债 8…”这类残句。

### 22.3 公司/个人边界

当前个人账本采用 `personal-only` 边界；本期不建设完整企业损益账本。

| 事实 | 个人账本处理 | 权威事件 |
|---|---|---|
| 公司营业收入、合同额、MRR/ARR | 不进入个人现金/收入 | 公司事实 Authority；本期可只留结构化经营事实 |
| 公司员工工资、销售提成、服务器费、公司房租 | 不进入个人支出 | 公司事实 Authority；不得用 `expense_commitment_*` |
| 个人税后工资 | 进入个人持续收入 | `income_source_started/adjusted`，type=`salary` |
| 业主提款/自雇可支配收入 | 进入个人持续收入 | `income_source_started/adjusted`，type=`self_employment_draw` |
| 已实际到账分红 | 进入个人现金 | `business_distribution_received` |
| 个人向公司注资 | 减少个人现金并增加个人企业权益成本 | 专用个人注资/持股事件；不得伪装生活支出 |
| 公司融资 | 不进入个人现金 | `business_financing_recorded` |
| 个人担保债务 | 仅在个人义务真实成立时进入个人债务 | `debt_drawn`，type=`business_personal_guarantee` |

Validator 必须基于结构化 `businessScope`/事件 kind 做边界校验，不能只依赖“公司”“团队”等关键词。过渡期若 Proposal 尚无 `businessScope`，明显属于公司运营的 Proposal 必须进入 repair，不得默认写入个人账本。

同一节点不得出现以下半边提交：

- 公司营收不入个人账本，但公司员工成本进入个人生活支出。
- 公司融资进入个人现金，却没有分红、工资、出售持股或个人借款事件。
- 正文写持股比例或公司投资，账本没有对应 `BusinessHolding`/公司事实。

过渡期专用事件 `business_holding_started` 负责原子记录 `BusinessHolding` 与个人现金出资。若正文只确认“成立公司/成为创始人”而没有可靠估值或出资金额，可创建 `personalCarryingValueWan = 0` 的已知持股事实；不得虚构估值。模型把“从备用金/个人存款拿出启动资金”误报为 `debt_drawn` 时，反腐层必须改写为该事件；个人自己的现金永远不是债务。

### 22.4 职业状态与个人收入原子契约

职业事实与个人收入事实按同一节点原子提交：

```text
employmentTransition
+ old income_source_ended/paused（若存在旧职业收入）
+ new income_source_started/adjusted（若正文确认个人收入）
```

规则：

- “辞职创业、开个人工作室、全职自由职业”使用 `self_employed`。
- 正文明确个人月薪、年薪、个人税后收入、业主提款或分红时，必须有同节点 Accepted Financial Event。
- 正文只有公司营收、合同额或融资额时，不得创建个人收入。
- `employed/self_employed + 0 income` 不是自动错误；只有在正文明确个人有薪却无 Accepted Event 时才是 `CAREER_INCOME_CONFLICT`。
- 若创业者明确暂不领薪，正文必须明确“暂不领取个人工资/提款”，CareerState 可以是 `self_employed` 且个人收入为 0。
- 原子组任一必需 Proposal 被拒，整组不提交；attempt 由代码改写为“转型/收入安排尚未正式生效”。

若已接受选项明确为“辞职/离职并全职创业”，且完成正文也明确主人公辞去工作，反腐层可确定性合成 `self_employed` transition；这是对已接受用户选择的结构化恢复，不是从开放正文猜职业。模型误把 `employment_transition` 放进财务 Proposal 数组时，先抽取到职业通道再校验，禁止作为未知财务 kind 静默丢弃。

`financialProcessingMeta` 增加或保证可审计：

```ts
careerIncomeContract: {
  transitionRequired: boolean;
  personalIncomeClaimed: boolean;
  acceptedCareerTransitionId?: string;
  acceptedIncomeEventIds: string[];
  status: "not_applicable" | "accepted" | "explicit_unpaid" | "rejected";
}
```

### 22.5 债务完成事实

任何用户可见表面出现“还清、结清、清零、清偿完毕”时，closing ledger 必须满足：

```text
目标债务账户 status = repaid
且 principalWan + accruedUnpaidInterestWan <= 0.01
且本节点存在 accepted debt_principal_repaid / debt_forgiven / system recovery record
```

现金大于债务不代表系统必须自动提前还款。若没有完成事件：

- 可以写“继续按计划偿还”“计划提前还款”“偿债能力改善”；
- 不得写“房贷清零”；
- 不得为了迎合故事由 reducer 自动替用户提前还贷。

### 22.6 邀请日志与真实路线隔离

每次 `startJourney()` 创建不可复用的 `journeyId`，并以以下身份绑定 working/case 文件：

```ts
interface BrowserJourneyIdentity {
  runId: string;
  journeyId: string;
  caseSlug: string;
  scenario: string;
  startedAt: string;
}
```

规则：

- 同一路径存在旧 working 文件时，默认视为新 journey，不读取旧 `interactionLog`。
- 只有显式 `resumeJourney()`，且 `runId + journeyId + caseSlug + scenario + state fingerprint` 全部一致，才能恢复日志。
- `startJourney()` 必须先清空内存 trace，并写入新的 `case_started`。
- `complete()` 从最终状态和本 journey trace 独立提取邀请 ID，要求 shown/declined/accepted 顺序闭合。
- trace 中每个 `pressureArcId` 必须属于本 journey 的 History/WorldState；出现未知 Arc 立即失败。
- summary 的 first/second/extra invitations 必须与 trace 及 `finalState.invitations` 按 ID、状态、顺序完全一致，禁止使用 `>=` 数量比较放行。
- 完整发布验收必须创建全新 record root；不得覆盖旧 case JSON 来制造“新路线”。

### 22.7 新增测试编号

第一批测试必须先作为红灯落下，再修改生产逻辑：

1. `PB-REPORT-08`：标题可使用终局债务 numeric claim，输出 canonical 数值。
2. `PB-REPORT-09`：所有用户表面禁止“金额待账本确认”等占位符。
3. `PB-REPORT-10`：非法数字删除整句或定性改写，不留下“负债 8…”。
4. `PB-REPORT-11`：`54.9996 万`统一输出 `55 万`，用户表面无超过 2 位小数。
5. `PB-BIZ-01`：公司营收不得用个人 `income_source_*`/`one_off_income_received` 入账。
6. `PB-BIZ-02`：公司员工及运营成本不得用个人 `expense_commitment_*`/`one_off_expense_paid` 入账。
7. `PB-BIZ-03`：个人工资、`self_employment_draw`、已到账分红可以进入个人账本。
8. `PB-CAREER-01`：正文明确个人收入但无 Accepted income event 时节点不得提交。
9. `PB-CAREER-02`：辞职创业时 CareerState、旧工资结束和新提款按规则原子提交。
10. `PB-NARR-08`：“房贷清零”但账户未关闭时必须局部改写。
11. `PB-RUN-01`：新 journey 不继承同 slug 旧 `interactionLog`。
12. `PB-RUN-02`：旧 Arc/邀请 ID 混入时 `complete()` 失败。
13. `PB-BIZ-08`：明确成立公司但未给估值时创建零成本 founder holding，不虚构资产值。
14. `PB-BIZ-10`：自己的备用金/存款投入创业不得创建债务，必须规范化为个人出资持股。
15. `PB-CAREER-04`：误放入财务数组的 employment transition 能被职业通道恢复并校验。
16. `PB-CAREER-05`：已接受“辞职创业”且正文确认辞职时，可确定性合成 self-employed transition。
17. `PB-REPORT-12`：显式房贷存在时，开局标题不得否认房贷；无债时不得虚构负债。
18. `PB-BIZ-11`：长句中的个人顾问月薪与“给自己发个人提款”仍能证明 personal income；公司合同额单独不能证明。
19. `PB-BIZ-08b`：模型为已确认成立的公司虚构出资额时，丢弃虚构金额并降级为零成本 founder holding，而不是丢失公司事实。
20. `PB-BIZ-12`：正文明确主人公持股比例时，即使没有估值或出资额，也必须创建零账面价值且比例准确的 `BusinessHolding`。
21. `PB-BIZ-13`：已有持股的比例重谈可在不虚构公司估值时只更新 ownershipRate，个人账面价值保持不变。
22. `PB-BIZ-14`：正文明确个人备用金作为启动资金时，按期初个人出资记录等额 BusinessHolding；只有金额未知时才允许零成本 holding。
23. `PB-CAREER-06`：财务 Proposal repair 不得覆盖或清空首轮已接受的 CareerState transition；只在职业转换原本未通过时修复职业字段。
24. `PB-BIZ-15`：以公司为句首但明确“向主人公个人账户支付工资”的证据属于个人收入；仅有公司营收或合同额仍不得入个人账。
25. `PB-CAREER-07`：无金额的旧工资结束事件允许在“辞职/离职/退休”同义完成句间做受限语义匹配，避免职业转换因标点或措辞差异失败。
26. `PB-CAREER-08`：本节点只有一个已接受的 next CareerState 时，个人职业收入必须强制链接该权威 ID，覆盖模型编造或陈旧的 CareerState ID。
27. `PB-CAREER-09`：“辞去年薪 X 的职位”等旧工资终止句不得被识别为当前个人收入声明。
28. `PB-CAREER-10`：持续收入证据明确“从本月起/第一个月起”时，Proposal 生效时间与 activeFrom 必须锚定本期起点，不能落在跨月节点末尾。
29. `PB-BIZ-16`：公司账户、公司现金流和公司营收句不得套用个人净资产/现金状态文案；个人余额清洗只作用于个人财务主体。
30. `PB-CAREER-11`：金额、类型、状态均未变化的 income adjustment 是重复确认，不得因证据失败而隔离既有权威收入；反腐层直接丢弃 no-op。
31. `PB-BIZ-17`：“降薪/涨薪/调薪”是个人收入调整证据；若校验通过必须更新收入来源。
32. `PB-NARR-09`：“把月供从 X 降到 Y”属于重组已生效的完成事实；没有 Accepted debt_restructured 时必须局部回退。
33. `PB-BIZ-18`：正文声称创业者“给自己开/发月薪”属于个人收入完成事实；没有活动个人收入来源或 Accepted income event 时必须改写为未形成已确认工资。
34. `PB-NARR-10`：现金余额净化不得生成“动用了整体仍处于负债状态来还贷”等残句；无法确认精确支出时使用定性现金缓冲表述。
35. `PB-BIZ-19`：若模型以 `income_source_started` 提交一个账本中已存在的同 ID 收入来源，反腐层必须机械转换为 `income_source_adjusted`；不得以重复 ID 拒绝并隔离原权威收入。
36. `PB-NARR-11`：“补上/补齐历史欠款”属于额外偿付完成事实；没有 Accepted `debt_principal_repaid` 时，只能写恢复当前计划还款，历史偿付问题仍按账本处理。
37. `PB-BIZ-20`：用户在已接受的自定义选择中明确“从本月起向个人账户每月支付 X 万税后工资”时，该选择本身是权威证据；代码必须确定性生成或替换本轮职业收入 Proposal，不得因模型漏交 Proposal 把个人收入归零。
38. `PB-NARR-12`：`房贷/贷款/按揭余额 X 万` 与总债务金额同属精确债务事实，必须用 closing ledger 校验并在不一致时局部改写。
39. `PB-BIZ-21`：报告或节点把个人收入拆成“工资+分红”时，分红必须有活动分红来源或 Accepted distribution event；否则保留权威收入总额并移除虚构构成。
40. `PB-BIZ-22`：中文“你占股 X%”与“你的持股为 X%”语义等价，必须创建或更新 `businessHolding.ownershipRate`。
41. `PB-BIZ-23`：同一证据中的个人启动资金只能落一次账；若模型提交 `one_off_expense_paid` 而正文同时证明取得企业权益，必须折叠为 `business_holding_started`，禁止支出与持股出资重复扣款。
42. `PB-NARR-13`：“用各自 X 万积蓄/存款作为启动资金”必须按整句净化；不得把余额片段替换成财务状态而生成残句。
43. `PB-BIZ-24`：在明确的股权/合伙协议上下文中，“你 40%，合伙人 60%”是有效的持股比例证据，必须更新现有 holding。
44. `PB-BIZ-25`：个人账本校验必须同时验证 `financialScope` 与 IncomeSource `type`；`business_operating` 即使被模型误标为 personal 也必须拒绝。
45. `PB-NARR-14`：fallback 经余额净化后不得出现“依靠/靠着整体仍处于负债状态备用金”，必须改为自然的定性现金缓冲表述。
46. `PB-NARR-15`：“房贷还有 X 万本金”属于精确余额事实；“每月利息 X 元/万”属于精确偿付事实，两者必须按 closing ledger 和已知还款计划校正。
47. `PB-NARR-16`：确定性回退器不得把“自定义抉择/用户选择/已接受选择”控制文本追加为故事段落；权威证据可用于校验但不可直接渲染。
48. `PB-NARR-17`：“补上/补齐房贷、月供或还款差额”统一属于历史欠款追补事实，没有额外 Accepted principal repayment 时必须局部回退。

### 22.8 CI 与发布门禁增量

新增硬门禁：

```text
user-visible financial placeholder count = 0
orphan/truncated financial amount count = 0
user-visible financial amount precision violations = 0
company operating revenue recorded as personal income = 0
company operating cost recorded as personal expense = 0
explicit personal income claims without Accepted Event = 0
debt-completion claims without closed account = 0
cross-journey invitation/Arc IDs = 0
business holding claims without structured holding/company fact = 0
```

审计结果必须包含 numerator、denominator、caseSlug、nodeIndex/path 和原始违规文本。没有已知利率账户时，“已知利率漏计息”必须报告 `0/0, not exercised`，不能显示为已验证通过。

### 22.9 实施与验收顺序

```text
A. spec + PB-REPORT/PB-RUN/PB-BIZ/PB-CAREER 红灯测试
B. 报告 numeric claims、整句降级、全表面占位符/精度审计
C. journey identity、显式 resume、邀请/Arc 完整性校验
D. company/personal validator + CareerState/个人收入原子提交
E. 全新 venture 单路线
F. 全新 record root 的 2/2/1 五路线
G. M5 → M7 → full unit → lint/typecheck → build → 图片检查
```

venture 单路线必须证明：

```text
公司经营改善
→ 个人工资/分红/业主提款 Accepted Event
→ 个人现金流真实改善
→ 债务下降（若人物选择或合同计划导致偿还）
→ 结局标题只引用 canonical 权威数值
```

若公司经营改善但人物明确不领薪，路线必须诚实呈现个人现金流没有改善，不能为了通过验收虚构分红或提款。
