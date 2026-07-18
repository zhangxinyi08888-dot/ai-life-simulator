# 个人持续负债、偿债困境与生活事件 Arc：可直接开发 Spec

> 状态：待评审 / 可直接进入开发
> 日期：2026-07-18
> 上游规格：`2026-07-18-authoritative-financial-ledger-architecture-spec.md`、`2026-07-17-four-mode-life-event-library-overhaul-spec.md`
> 目标分支：`codex/financial-ledger-v2`
> 核心交付：停止自动借新债偿还旧债；建立债务支付事实、债务健康派生状态、困境侧事件库、`financial_debt_v1` Arc，以及急性健康危机抢占机制

## 1. 决策摘要

当前权威账本已经解决“债务是什么、借款与现金如何闭环、本金和利息如何分开”，但尚未解决“长期负债如何影响生活，以及偿债能力不足时系统如何处理”。现状存在四个确定性缺陷：

1. 计划还款无条件扣现金；现金变负后，`auto_shortfall_debt` 自动补债，形成以债养债。
2. 每个事务边界都可能新建一个 `liquidity_shortfall` 账户，缺口账户持续增殖。
3. 缺口债 24 个月后被自动转换为 240 个月估算摊销，其还款又可能制造新缺口，形成自我维持的债务螺旋。
4. 事件库只有 `financial_debt_reduction_progress` 恢复事件，没有债务压力、支付困难、重组和带债恢复生活的困境侧事件。

本 Spec 做出以下产品和工程决策：

- 自动流动性缺口只能覆盖已发生的非债务现金缺口，不得为计划本金或利息自动融资。
- 同一账本任何时点最多存在一个未关闭的系统自动缺口债账户；账户合并，增额记录不合并。
- `liquidity_shortfall` 永久豁免“24 个月后自动转估算摊销”；持续缺口通过风险状态和事件处理，不通过系统虚构还款计划。
- 债务支付按月、按“非债务义务 → 应计利息 → 计划本金”的顺序结算；支付不足记录事实，不制造新债让还款看起来成功。
- 债务风险由确定性 `DebtHealthState` 派生；模型不得返回或覆盖该状态。
- 普通负债不进入危机。`watch` 和 `distressed` 使用普通动态事件；只有 `default_risk` 或 `defaulted` 可以启动 `financial_debt_v1`。
- 急性健康危机可以抢占并暂停债务 Arc；健康 Arc 结束后，根据最新债务健康状态恢复或关闭债务 Arc。
- Arc transition 必须读取本节点 closing ledger 派生出的 `DebtHealthState`；财务候选结果、Arc transition 和 WorldState 最终原子提交。

## 2. 范围与非目标

### 2.1 本期范围

- 债务账户偿付状态和未付利息。
- 月度偿债支付能力检查。
- 单一自动流动性缺口账户。
- 未支付、逾期风险和正式违约的区分。
- `DebtHealthState`、趋势与证据 reason code。
- History 快照、事件 eligibility 和 Prompt 上下文。
- 五类债务生活事件。
- `financial_debt_v1` phase policy。
- 急性健康 Arc 对债务 Arc 的抢占、暂停和恢复。
- 旧账本、旧 History 和时光回溯兼容。
- 单元、集成、CI gate 和真实路线验收。

### 2.2 明确不做

- 不建立征信分、催收机构、法院执行、破产法或地区化法律规则。
- 不从正文关键词推断“失信”“被起诉”“房屋被拍卖”或正式违约。
- 不因为存在房贷或 `totalDebtWan > 0` 自动降低幸福、健康或关系属性。
- 不自动出售资产、向家人借款、减免债务或修改还款合同。
- 不要求债务清零后才能退出压力 Arc。
- 不把企业债务计入个人债务；只有已确认的个人担保继续进入个人账本。
- 不在本期实现多个普通 PressureArc 同时前台展示；仅实现急性健康对债务 Arc 的单向抢占。

## 3. 当前代码基线

| 现状 | 当前位置 | 问题 |
|---|---|---|
| 计划还款无条件扣现金 | `src/domain/finance/accruePeriod.ts` | 无支付能力检查 |
| 现金为负后自动创建缺口债 | `src/domain/finance/reduceFinancialLedger.ts` | 可用新债完成旧债还款 |
| 自动缺口 ID 随事务变化 | `closeLiquidityShortfall()` | 每轮可新建账户 |
| `event_driven` 24 个月后转 240 月摊销 | `addDebtScheduleReviewIssues()` | 缺口债会进入债务螺旋 |
| `defaulted` 只存在于类型和聚合 | `DebtAccount.status` | 没有进入该状态的受控事件 |
| `debt_present` 只检查总债务大于 0 | `src/utils/eventEligibility.ts` | 正常房贷与债务危机无法区分 |
| 债务事件只有恢复侧 | `src/data/phase2LifeEvents.ts` | 困境段没有生活响应 |
| 有 Arc 时屏蔽健康升级和普通事件 | `simulationService.ts` | 长债务 Arc 会吞掉其他生活领域 |
| Arc transition 先于财务提交 | `simulationService.ts` | 退出条件看不到 closing ledger |
| `financial_major_crisis` 被引用但不存在 | `phase2LifeEvents.ts` | 冷却条件永久无效 |

## 4. 核心不变量

每次账本事务提交后必须满足：

```text
totalCashWan >= 0
all debt principal >= 0
all accrued unpaid interest >= 0
totalDebtWan = Σ(active/defaulted principal + accrued unpaid interest)
interestDue = interestPaid + interestUnpaid
principalDue = principalPaid + principalUnpaid
principalPaid <= cash available after non-debt obligations and interest paid
automatic shortfall increase caused by debt service = 0
active automatic liquidity shortfall account count <= 1
liquidity_shortfall repaymentPolicy.mode = event_driven
liquidity_shortfall never enters estimated_amortizing by age threshold
debt health is derived, never model-written
formal default requires an accepted event or legacy evidence; one missed month is not default
```

额外语义约束：

- 借款增加现金和债务，净资产不立即变化。
- 还本金减少现金和债务，净资产不立即变化。
- 已支付利息减少现金和净资产。
- 未支付利息增加应付债务和费用，减少净资产；默认不产生复利，除非合同或重组事件明确允许资本化。
- 未支付本金继续保留在本金余额中，不重复加债。
- 负净资产允许存在；负现金不允许保存。

## 5. 领域模型修改

### 5.1 债务偿付状态

在 `src/domain/finance/types.ts` 增加：

```ts
export type DebtServicingStatus =
  | "current"
  | "partial"
  | "missed"
  | "delinquent";

export interface DebtServiceRecord {
  id: string;
  debtAccountId: string;
  ageInMonths: number;
  interestDueWan: number;
  interestPaidWan: number;
  interestUnpaidWan: number;
  principalDueWan: number;
  principalPaidWan: number;
  principalUnpaidWan: number;
  outcome: "paid" | "partial" | "missed";
  reasonCodes: Array<
    | "PAID_AS_SCHEDULED"
    | "PARTIAL_PAYMENT"
    | "DEBT_PAYMENT_MISSED"
    | "INSUFFICIENT_CASH_AFTER_ESSENTIALS"
  >;
}
```

扩展 `DebtAccount`：

```ts
export interface DebtAccount {
  // existing fields...
  origin: "explicit" | "system_auto_shortfall" | "legacy_migration";
  accruedUnpaidInterestWan: number;
  servicingStatus: DebtServicingStatus;
  consecutiveMissedPaymentMonths: number;
  totalMissedPaymentMonths: number;
  recentMissedPaymentAgeInMonths: number[];
  lastPaymentAtAgeInMonths?: number;
  lastMissedPaymentAtAgeInMonths?: number;
  lastPrincipalIncreaseAtAgeInMonths?: number;
}
```

迁移默认值：

```ts
accruedUnpaidInterestWan = 0
servicingStatus = "current"
consecutiveMissedPaymentMonths = 0
totalMissedPaymentMonths = 0
recentMissedPaymentAgeInMonths = []
```

`recentMissedPaymentAgeInMonths` 每月更新时删除早于 `currentAgeInMonths - 11` 的条目，只保留滚动 12 个月窗口；同一债务同一月最多一个条目。它是 `missedPaymentMonthsLast12` 的持久真值，不能用 lifetime total 或限长 transaction 反推。

不得根据旧正文推断逾期状态。旧债务若缺少计划，继续使用 `factStatus: "needs_review"` 或 `UNKNOWN_DEBT_SCHEDULE`。

### 5.1.1 账本版本

本期将 canonical `FinancialLedger.version` 从 `2` 升为 `3`。原因是新增字段会改变持久化 schema、总债务口径和月度偿债语义，不能把它伪装成 v2 的可选展示字段。

```ts
export interface FinancialLedgerV2 { /* frozen legacy v2 shape */ version: 2 }
export interface FinancialLedgerV3 { /* v2 fields plus this Spec */ version: 3 }
export type FinancialLedgerInput = FinancialLedgerV2 | FinancialLedgerV3;
export type FinancialLedger = FinancialLedgerV3;

export function migrateFinancialLedgerV2ToV3(
  ledger: FinancialLedgerV2
): FinancialLedgerV3;
```

边界规则：

- 新初始化、新节点和新事务只写 v3。
- Reducer 只接收 v3；simulation 边界遇到 v2 时先调用 `migrateFinancialLedgerV2ToV3()`。
- v2→v3 只补偿付默认值、合并旧缺口账户并修正缺口 repayment policy，不重跑历史月结。
- 迁移前后现金、资产、`principalWan` 合计和净资产保持不变；旧账本没有未付利息事实，因此初始化为 0。
- History 中保留旧 ledger snapshot 的可读性；恢复后进入下一节点时才迁移候选副本，不回写旧 HistoryItem。
- 新建 `src/domain/finance/migrateFinancialLedgerV2ToV3.ts`；现有 `migrateLegacyFinancialState.ts` 只负责 legacy `FinancialState`→v3 ledger，不能兼任 v2→v3。
- `simulationService` 读取 `lastNode.financialLedger` 后，在 revision check、derive 和 reducer 之前完成迁移。

### 5.2 正式违约事件

增加受控事件，而不是在第一次未付款时直接写 `defaulted`：

```ts
export type FinancialEventKind =
  | ExistingKinds
  | "debt_default_recorded";

export interface DebtDefaultRecordedPayload {
  debtAccountId: string;
  reason:
    | "explicit_default"
    | "contractual_default_after_delinquency"
    | "legacy_confirmed_default";
}
```

Reducer 规则：

- 仅允许目标账户当前为 `active`。
- 第一版禁止 `debt_default_recorded` 直接作用于 `origin: "system_auto_shortfall"`；该账户的恶化由 persisted shortfall 和 DebtHealthState 表达，避免在尚未建模“基础义务未支付”前切断现金 floor 机制。
- 必须有用户事实、已接受历史或已接受模拟结果证据。
- 将 `DebtAccount.status` 设为 `defaulted`，`servicingStatus` 设为 `delinquent`。
- 不自动修改本金、未付利息或现金。
- `default_risk` 是派生风险，不等于正式 `defaulted`。

### 5.3 债务减免与重组对未付利息的处理

扩展 payload：

```ts
export interface DebtForgivenPayload {
  debtAccountId: string;
  principalForgivenWan: number;
  accruedInterestForgivenWan?: number;
}

export interface DebtRestructuredPayload {
  oldDebtAccountId: string;
  replacementDebtAccount: DebtAccount;
  capitalizedInterestWan?: number;
  sourceCashAccountId?: string;
  transactionFeeWan: number;
}
```

重组守恒：

```text
old principal
+ old accrued unpaid interest
- explicit forgiveness in same transaction
+ explicit additional draw in same transaction
= replacement principal
+ replacement accrued unpaid interest
```

重组不能静默抹掉未付利息。若将未付利息资本化，必须写入 `capitalizedInterestWan` 和证据。

显式 `debt_interest_paid` 的应用顺序：先冲减目标账户的 `accruedUnpaidInterestWan`，该部分不重复确认费用；超过历史未付利息的部分才作为本期新利息费用。对已由自动月结覆盖的同月计划利息，validator 必须拒绝重复支付 Proposal。

### 5.4 FinancialLedgerIssue 扩展

增加 issue code：

```ts
| "DEBT_PAYMENT_MISSED"
| "DEBT_PAYMENT_DELINQUENT"
| "LIQUIDITY_SHORTFALL_PERSISTED"
| "DEBT_DEFAULT_RECORDED"
```

规则：

- 当月部分或完全未支付：创建或更新账户级 `DEBT_PAYMENT_MISSED` warning。
- 连续 2 个月未足额支付：创建 `DEBT_PAYMENT_DELINQUENT` warning。
- 正式违约事件接受后：创建 `DEBT_DEFAULT_RECORDED` warning。
- 自动缺口账户连续存在 6 个月且本金未下降，或 6 个月内至少两次增额：创建 `LIQUIDITY_SHORTFALL_PERSISTED` warning。
- Issue 使用稳定账户级 ID，重复发生只更新摘要和关联记录，不增殖同 code、同账户的 open issue。
- 完成足额补缴、重组或清偿后，由确定性规则关闭对应 issue。

扩展 issue 审计字段：

```ts
relatedDebtServiceRecordIds?: string[];
lastOccurredAtAgeInMonths?: number;
occurrenceCount?: number;
```

现有 `resolveIssuesFromAcceptedEvents()` 不得因为“同一债务出现了任意 Accepted Event”就关闭 missed/delinquent issue。关闭条件必须逐 code 判断：足额补缴并恢复 current、重组替代旧债、债务清偿或明确解决事件。

### 5.5 审计记录

扩展 `FinancialTransaction`：

```ts
export interface FinancialTransaction {
  // existing fields...
  debtServiceRecords: DebtServiceRecord[];
  automaticLiquidityShortfallIncreaseWan: number;
}
```

扩展 `FinancialPeriodSummary`：

```ts
debtInterestDueWan: number;
debtInterestUnpaidWan: number;
debtPrincipalDueWan: number;
debtPrincipalUnpaidWan: number;
missedDebtAccountIds: string[];
automaticLiquidityShortfallIncreaseWan: number;
```

`recentTransactions` 继续保持现有限长。每次缺口增额必须在 transaction 中保留金额和原因，不能因为复用同一账户而丢失审计链。

## 6. 月度结算算法

### 6.1 为什么必须逐月

节点跨度可能为 3–36 个月。批量结算会允许后面月份的收入倒灌支付前面月份的债务，无法可靠识别何时开始支付困难。因此自动收入、持续支出和计划债务必须逐月推进。

### 6.2 月度顺序

将 `accruePeriodSlice()` 内部重构为逐月循环；外部公开函数名可以保持不变：

```text
for each elapsed month:
  1. 结算当月持续收入
  2. 扣除当月非债务 ExpenseCommitment
  3. 若现金小于 0，调用 reconcileAutomaticLiquidityShortfall()
  4. 计算每笔债务当月到期利息和本金
  5. 按债务稳定顺序支付应计未付利息和当月利息
  6. 用剩余现金支付计划本金
  7. 记录 DebtServiceRecord
  8. 更新 servicingStatus、missed counters、remaining term 和 issue
  9. 再次断言现金非负；此步骤禁止调用自动缺口补债
```

同月多笔债务的稳定顺序：

```text
defaulted/delinquent contractual minimum
→ mortgage/student/consumer/credit/family/guarantee
→ account.openedAtAgeInMonths
→ account.id
```

第一版不做最优偿债策略，不根据利率自动选择“雪球法”或“雪崩法”。排序只用于确定性和最低合同义务。

### 6.3 到期金额

对 `known_schedule` 和 `estimated_amortizing`：

```text
currentInterestDue = monthlyInterestWan
  ?? principalWan * annualInterestRate / 12
  ?? 0

principalDue = monthlyPrincipalWan
  ?? max(0, monthlyPaymentWan - currentInterestDue)
  ?? principalWan / max(1, remainingTermMonths)
```

支付顺序：

```text
interestDue = accruedUnpaidInterestWan + currentInterestDue
interestPaid = min(cash, interestDue)
interestUnpaid = interestDue - interestPaid
cash -= interestPaid
accruedUnpaidInterestWan = interestUnpaid

principalPaid = min(cash, principalDue, principalWan)
principalUnpaid = principalDue - principalPaid
cash -= principalPaid
principalWan -= principalPaid
```

- 默认不对 `accruedUnpaidInterestWan` 计复利。
- 本期 `transaction.expenseWan` 和 `FinancialPeriodSummary.otherExpenseWan` 确认的是“当期新产生的 currentInterestDue”，无论已付还是未付；历史 `accruedUnpaidInterestWan` 的后续支付只减少现金和应付债务，不得再次确认费用。
- 因此本期净资产恒等式使用当期新应计利息；未付利息通过 debt delta 进入负债，支付历史欠息时 cash delta 与 debt delta 等额反向，不重复改变净资产。
- `remainingTermMonths` 随自然月减少，不因未付款暂停；期限归零但仍有余额时至少进入 `default_risk`。
- `event_driven` 不产生自动到期额。
- 本金归零且未付利息归零时，账户才进入 `repaid`。
- 本金归零但仍有未付利息时，账户保持 active/defaulted。

### 6.4 Payment status 更新

```text
interestUnpaid = 0 && principalUnpaid = 0
  → current；consecutiveMissedPaymentMonths = 0

paid total > 0 && unpaid total > 0
  → partial；consecutiveMissedPaymentMonths += 1

paid total = 0 && due total > 0
  → missed；consecutiveMissedPaymentMonths += 1

consecutiveMissedPaymentMonths >= 2
  → delinquent
```

`delinquent` 不自动把账户 lifecycle status 改成 `defaulted`。

三层状态在同一个连续未足额支付阈值上同步产生，但不得合并成一个字段：

| 层级 | 表达 | 消费方 |
|---|---|---|
| 账户层 | `DebtAccount.servicingStatus = "delinquent"` | 月结、重组和账户展示 |
| Issue 层 | open `DEBT_PAYMENT_DELINQUENT` | 审计、阻断规则和修复链 |
| 派生层 | `DebtHealthState.level = "default_risk"` | 事件 eligibility、Arc 和叙事约束 |

三者输入相同、职责不同。账户层是事实，Issue 层是待处理问题，DebtHealth 层是跨账户风险结论。

## 7. 单一自动流动性缺口账户

### 7.1 账户规则

实现：

```ts
reconcileAutomaticLiquidityShortfall(input: {
  ledger: FinancialLedger;
  ageInMonths: number;
  transactionId: string;
  eligibleDeficitWan: number;
  reasonCode: "NON_DEBT_RECURRING_OBLIGATION" | "ACCEPTED_INCURRED_EXPENSE";
}): LiquidityShortfallResult
```

机械规则：

1. 只查找 `type === "liquidity_shortfall" && origin === "system_auto_shortfall" && status === "active"` 的系统账户。
2. 找到时增加该账户本金，不创建新账户。
3. 未找到时创建新账户；ID 使用事务稳定哈希，已清偿旧账户不重新打开。
4. 同一时点若发现两个以上活跃 `system_auto_shortfall` 账户，抛 `INVALID_LEDGER`；迁移器负责合并旧数据。显式 Proposal 创建的短期债必须使用 `origin: "explicit"`，不参与合并和“最多一个”不变量。
5. 每次增额更新 `lastPrincipalIncreaseAtAgeInMonths` 并写 transaction 审计记录。
6. 账户固定使用 `repaymentPolicy: { mode: "event_driven" }`。
7. `addDebtScheduleReviewIssues()` 对 `liquidity_shortfall` 直接跳过，不得转成 `estimated_amortizing`。

### 7.2 自动缺口允许范围

允许：

- 持续生活、住房、抚养、医疗、保险、教育和已提交的其他非债务 ExpenseCommitment。
- Validator 已确认剧情中实际发生、无法撤回的必要一次性支出。

禁止：

- 自动本金还款。
- 自动利息支付。
- 资产购买、投资和企业出资。
- 可取消的可选消费。
- 债务重组费用。
- 为了让 Proposal 通过而后台补资金。

若禁止项资金不足：拒绝相关 Proposal，或对计划还款记录 `DEBT_PAYMENT_MISSED`；不得调用自动缺口账户。

### 7.2.1 Validator 统一试算与失败回退

V3 不再把生产主链的粗粒度 `auto_shortfall_debt` 直接传给 Proposal trial。所有模型 Proposal 默认使用：

```ts
liquidityTreatment: "require_explicit"
```

持续义务和 Proposal 必须分开处理：

1. Reducer 对确定性的非债务持续义务继续允许 `reconcileAutomaticLiquidityShortfall()`，这不属于 Proposal 获得资金。
2. Validator 对全部 Proposal 组统一按 `require_explicit` 试算，不只严格检查本金支付。
3. 资产购买、债务本息支付、投资、企业出资和重组费用资金不足时，返回 `MISSING_FUNDING_SOURCE`。
4. 剧情已明确发生且不可撤回的必要一次性支出，首次严格试算仍会失败；只有 evidence validator 确认后，才能由系统把 Accepted Event 标记为 `liquidityTreatment: "allow_system_shortfall"` 并二次试算。模型不能设置该标记。
5. 不可撤回支出以外的失败 Proposal 进入现有 `financialProposalRepair`，优先补充明确借款、资产出售、支持到账、收入或取消尚未发生的支出。
6. Repair 最多一次；修复 Proposal 必须重新 normalize、validate 和 trial，不能沿用第一次的 accepted 结果绕过资金校验。
7. 二次试算仍失败时，拒绝该 Proposal，保留可独立提交的确定性持续结算和其他 accepted events。

叙事回退契约：

- 若被拒 Proposal 对应的正文只表达“尝试、申请、协商或计划”，正文可以保留，但不得写成已完成事实。
- 若正文声明“已卖出、已到账、已还清、已重组、已减免”等完成事实，而对应 Proposal 最终被拒，执行一次有界 narrative repair，把完成事实改为失败、延期或仍在协商。
- Repair 输入必须包含 accepted event IDs、rejected proposal IDs、reason codes 和可用权威账户摘要。
- Narrative repair 后重新运行 story consistency、decision gate、财务叙事 sanitizer 和 `validateNodeOutcomeProposal()`。
- Narrative repair 失败时使用确定性中性模板替换物质性财务完成句，不允许保存“故事成功、账本失败”的节点。

### 7.3 旧缺口账户迁移

在 ledger migration 中：

- 找出全部 active 且可识别为系统自动生成的 `liquidity_shortfall`；旧 evidence reason code 为 `AUTOMATIC_LIQUIDITY_SHORTFALL` 的账户迁移为 `origin: "system_auto_shortfall"`，其余为 `legacy_migration`。
- 保留最早账户 ID，将本金和未付利息汇总。
- 其余账户设为 `restructured`、本金和未付利息归零，并在 evidence 写 `LEGACY_SHORTFALL_CONSOLIDATION`。
- 不改变迁移前后总债务和净资产。
- 若旧缺口已被自动改成 `estimated_amortizing`，恢复 `event_driven`，但保留 `needs_review` 证据。

## 8. DebtHealthState

### 8.1 类型

在 `src/domain/finance/debtHealth.ts` 定义：

```ts
export type DebtHealthLevel =
  | "none"
  | "manageable"
  | "watch"
  | "distressed"
  | "default_risk"
  | "defaulted"
  | "unknown";

export type DebtTrend = "improving" | "stable" | "worsening" | "unknown";

export type DebtHealthReasonCode =
  | "NO_ACTIVE_DEBT"
  | "PAYMENTS_CURRENT"
  | "LOW_DEBT_SERVICE_COVERAGE"
  | "NEGATIVE_DISPOSABLE_CASHFLOW"
  | "LOW_CASH_BUFFER"
  | "LIQUIDITY_SHORTFALL_PRESENT"
  | "LIQUIDITY_SHORTFALL_GROWING"
  | "RECENT_PARTIAL_PAYMENT"
  | "RECENT_MISSED_PAYMENT"
  | "CONSECUTIVE_MISSED_PAYMENTS"
  | "BALANCE_REMAINS_AFTER_TERM"
  | "FORMAL_DEFAULT_RECORDED"
  | "DEBT_BALANCE_IMPROVING"
  | "COVERAGE_IMPROVING"
  | "RESTRUCTURING_ACCEPTED_NOT_YET_PROVEN"
  | "INSUFFICIENT_RELIABLE_FACTS";

export interface DebtHealthState {
  asOfAgeInMonths: number;
  level: DebtHealthLevel;
  trend: DebtTrend;
  totalDebtWan: number;
  scheduledDebtServiceNext12MonthsWan: number;
  availableCashForDebtNext12MonthsWan: number;
  debtServiceCoverageRatio?: number;
  cashBufferMonths?: number;
  liquidityShortfallDebtWan: number;
  consecutiveMissedPaymentMonths: number;
  missedPaymentMonthsLast12: number;
  activeDefaultedDebtCount: number;
  reasonCodes: DebtHealthReasonCode[];
  source: "authoritative_ledger" | "legacy_compatibility";
  sourceLedgerRevision?: number;
}
```

`DebtTrend` 与严重度分离。重组是 Arc/事件阶段，不是健康等级；重组后的债务可以仍为 `watch`，同时趋势为 `improving`。

### 8.2 派生输入

```ts
deriveDebtHealthState({
  ledger,
  derivedFinancialState,
  previousDebtHealthState?
})
```

只允许读取：

- closing `FinancialLedger`；
- closing `DerivedFinancialStateV2`；
-账本中的债务服务记录和 issue；
- 上一节点已经提交的 `DebtHealthState`，仅用于趋势和跨期门槛。

不得读取正文、标题、模型 confidence 或 `wealth` 属性。

指标公式：

```text
scheduledDebtServiceNext12MonthsWan
  = Σ active/defaulted 非 event_driven 债务未来 12 个月计划利息和本金

incomeInHorizonWan
  = Σ month 1..12 中当月 active 的 IncomeSource 应计额

nonDebtExpenseInHorizonWan
  = Σ month 1..12 中当月 active 的 ExpenseCommitment 应计额

availableCashForDebtNext12MonthsWan
  = max(0,
      current cash
      + incomeInHorizonWan
      - nonDebtExpenseInHorizonWan)

debtServiceCoverageRatio
  = availableCashForDebtNext12MonthsWan
    / scheduledDebtServiceNext12MonthsWan

cashBufferMonths
  = current cash / max(monthly non-debt expense commitments, epsilon)

liquidityShortfallDebtWan
  = Σ active/defaulted liquidity_shortfall principal + unpaid interest
```

- 无计划债务服务且有可靠 event-driven 私人借款时，coverage 为空，不用 `Infinity` 表示健康。
- 12 个月 horizon 必须逐月尊重 `activeFromAgeInMonths`、`activeUntilAgeInMonths` 和 status；三个月后结束的合同收入只能计三个月，不得直接使用全年年化值。
- `scheduledDebtServiceNext12MonthsWan` 同样按未来每月剩余期限、利息和本金计划求和，不能把当前月供无条件乘 12。
- `missedPaymentMonthsLast12` 从持久化 servicing counters 和最近 debt service records 派生；不能只依赖限长的 `recentTransactions`。
- 重组接受当期只把 trend 标为 `unknown` 或通过 reason code 标记“尚待履约验证”；至少一个后续足额支付月后才能标记 `improving`。

### 8.3 默认阈值

阈值集中在可配置常量，不散落于事件 trigger：

```ts
export const DEFAULT_DEBT_HEALTH_POLICY = {
  watchCoverageRatio: 1.2,
  distressedCoverageRatio: 1.0,
  delinquentMonths: 2,
  persistentShortfallMonths: 6,
  worseningShortfallIncreaseCount: 2,
  cashBufferWatchMonths: 1
};
```

严重度按最高命中项决定：

| Level | 确定性条件 |
|---|---|
| `none` | active/defaulted debt 总额为 0 |
| `unknown` | 有债务，但所有债务事实均为 unknown/needs_review，且没有可靠计划或支付记录 |
| `defaulted` | 至少一个账户 `status === "defaulted"` |
| `default_risk` | 连续至少 2 个月未足额支付；或期限结束仍有余额；或 `DEBT_PAYMENT_DELINQUENT` open |
| `distressed` | 本期发生未足额支付；或 6 个月内自动缺口至少两次增额；或 coverage < 1 且不是 unknown |
| `watch` | coverage 在 `[1, 1.2)`；或未来 12 个月 horizon 非债务现金流 < 0；或现金缓冲不足 1 个月；或存在未增长的缺口债 |
| `manageable` | 有债务、没有以上风险，且合同支付可持续 |

补充规则：

- 正常按计划支付的房贷，即使本金很大，也应为 `manageable`。
- `totalDebtWan` 和 debt-to-income 不能单独把状态提升到 `distressed`。
- `unknown` 不得被当成 `manageable`；事件库只允许生成“核实安排”类低强度节点，不得生成违约剧情。
- `trend` 使用上一快照比较债务、本息覆盖、缺口本金和 missed counters；缺少上一快照时为 `unknown`。

### 8.4 快照归属

扩展 `SimulationNode` 和 `HistoryItem`：

```ts
debtHealthState?: DebtHealthState;
```

新节点必须保存。旧历史缺失时：

- 若有 `financialLedger`，现场派生只用于 eligibility，不回写旧节点。
- 只有旧 `financialState` 时，只有 `isEstimated === false && totalDebtWan === 0` 可以兼容派生 `none`；其余一律为 `unknown`，不得派生 `watch/distressed/default_risk/defaulted`。
- 兼容派生结果写 `source: "legacy_compatibility"`；权威 v3 ledger 派生结果写 `source: "authoritative_ledger"`。
- History restore 必须原样克隆该字段。

## 9. 事件 Eligibility

### 9.1 新增 context keys

```ts
type RequiredContextKey =
  | ExistingKeys
  | "debt_health_available"
  | "debt_manageable"
  | "debt_watch"
  | "debt_distressed"
  | "debt_default_risk"
  | "debt_defaulted"
  | "debt_recovering";
```

匹配规则读取从后向前第一个带 `debtHealthState` 的 HistoryItem，避免特殊节点或旧节点截断状态。若全都缺失，旧节点可以调用只读兼容派生器。

`debt_health_available` 只有在 `source === "authoritative_ledger"` 且对应节点存在 authoritative `financialLedger` 时成立。`legacy_compatibility` 的 unknown/none 只能用于保守排除，不得满足困境事件门槛。

`debt_present` 保留给恢复和资源排序等非危机事件，但不得作为债务危机硬门槛。

### 9.2 幽灵引用修复

删除：

```ts
eventIds: ["financial_major_crisis"]
```

改为以下任一真实条件：

- 最近没有 `financial_debt_pressure` 或 `financial_debt_crisis` semantic family；
- 当前没有 active/suspended `financial_debt_v1`；
- 最新 debt health 低于 `distressed`。

不新增一个空泛的 `financial_major_crisis` 占位事件。

## 10. 困境侧事件库

所有事件：

- category 为 `financial`。
- 金额和账户 ID 只读 Prompt 中的权威财务摘要。
- 事件正文不得自行声明债务已减少、已重组或已违约。
- `wealth` 只影响软权重，不参与硬 eligibility。
- 事件选择读取上一已提交节点的 debt health；本节点结果由 closing debt health 决定。

### 10.1 `financial_debt_pressure_emerges`｜债务开始挤压生活

- narrativeMode：`pressure_crisis`
- semanticFamily：`financial_debt_pressure`
- requiredContext：`debt_health_available` 且满足 `debt_watch` 或 `debt_distressed`，即 `[ ["debt_health_available", "debt_watch"], ["debt_health_available", "debt_distressed"] ]`
- 排除：active/suspended `financial_debt_v1`；最近 6 节点同语义族
- baseProbability：0.68；cooldown：6
- temporal：normal，6–18 个月；不创建 Arc
- allowedOutcomes：
  - `reduce_discretionary_expenses`
  - `stabilize_core_income`
  - `review_debt_structure`

### 10.2 `financial_repayment_tradeoff`｜还款与基本生活发生冲突

- narrativeMode：`crossroads_opportunity`
- semanticFamily：`financial_debt_tradeoff`
- requiredContext：`debt_distressed`
- trigger：不是只有 `unknown`；最近存在非债务义务和计划债务服务
- baseProbability：0.72；cooldown：5
- temporal：high_tension，3–9 个月；不创建 Arc
- allowedOutcomes：
  - `protect_essential_expenses`
  - `maintain_affordable_minimum_payment`
  - `seek_verified_income_or_support`

### 10.3 `financial_payment_strain`｜原还款安排无法维持

- narrativeMode：`pressure_crisis`
- semanticFamily：`financial_debt_crisis`
- requiredContext：`debt_default_risk` 或 `debt_defaulted`
- dispatchMode：`arc_only`；cooldown：按 Arc 管理
- temporal：high_tension，3–6 个月；`requiresFollowUp: true`
- `intent.phasePolicyId: "financial_debt_v1"`
- allowedOutcomes：
  - `request_debt_restructuring`
  - `sell_nonessential_asset`
  - `seek_verified_family_support`
  - `accept_and_record_payment_arrears`

只有该事件可以启动债务 Arc。不得生成威胁、司法处置或公开失信，除非账本已有正式违约证据。

新增确定性 `queryDebtEscalationEvent(history)`：只在没有其他前台 Arc、最新可靠 debt health 为 `default_risk/defaulted`、且不存在 active/suspended `financial_debt_v1` 时返回本事件。它不进入普通随机池，避免危机被模式权重长期推迟或在低风险状态随机出现。

### 10.4 `financial_debt_restructuring`｜重新安排债务

- narrativeMode：`recovery_growth`
- semanticFamily：`financial_debt_restructuring`
- requiredContext：active `financial_debt_v1` 的 `response/restructuring` phase
- temporal：normal，3–12 个月；Arc continuation
- allowedOutcomes：
  - `extend_repayment_term`
  - `refinance_with_explicit_terms`
  - `negotiate_partial_forgiveness`
  - `decline_unsustainable_restructuring`

选择不等于成功。只有 validator 接受 `debt_restructured` 或 `debt_forgiven` 后，账本才变化。

### 10.5 `financial_life_under_repayment`｜在偿债中重建日常

- narrativeMode：`stability_meaning`
- semanticFamily：`financial_debt_sustainable_life`
- requiredContext：active `financial_debt_v1` 的 `recovery/operation` phase，且上一已提交 health 不高于 `watch`
- temporal：stable，9–24 个月；Arc continuation
- allowedOutcomes：
  - `maintain_sustainable_repayment`
  - `balance_repayment_and_health`
  - `preserve_one_meaningful_life_direction`

债务仍大于 0 时允许出现；不得把“尚未清零”描述成失败。

### 10.6 与既有恢复事件的关系

保留 `financial_debt_reduction_progress`，但调整 eligibility：

- 要求 `debt_recovering`，而不只是债务总额下降。
- active debt Arc 时仅允许在 `recovery/operation` 作为 continuation。
- 无 Arc 时继续作为普通恢复事件。
- 债务因减免一次性下降但现金流仍不可持续时，不得误触发“恢复”。

### 10.7 Phase 2 helper 修改

现有 `phase2Event()` 只允许 `normal/stable`、强制 `requiresFollowUp: false` 和 minor random event，不能承载本 Spec 的危机入口。修改 helper 契约：

```ts
interface Phase2EventDefinition {
  // existing fields...
  dispatchMode?: LifeEventSeed["dispatchMode"];
  intensity?: "minor" | "major";
  temporal: TemporalProfile;
}
```

默认值保持兼容：`dispatchMode: "random"`、`intensity: "minor"`。`financial_payment_strain` 显式使用：

```ts
dispatchMode: "arc_only"
intensity: "major"
temporal: {
  lifeIntensity: "high_tension",
  durationMonths: [3, 6],
  requiresFollowUp: true
}
```

其他既有 Phase 2 事件行为不变。

## 11. Outcome 与财务 Proposal 契约

事件选项只表达人物行动意图。财务事实仍走：

```text
selected outcome
→ FinancialEventProposal[]
→ validator
→ AcceptedFinancialEvent[]
→ ledger trial
→ commit
```

最低映射：

| Outcome | 允许的 Proposal | 不允许的隐式效果 |
|---|---|---|
| `reduce_discretionary_expenses` | `expense_commitment_adjusted/ended` | 无金额证据时不得自动降低支出 |
| `stabilize_core_income` | income source start/adjust，必须与 CareerState 原子闭环 | 不得凭选择直接增加收入 |
| `request_debt_restructuring` | 可以无财务事件，表示仅发起协商 | 不得直接重组 |
| `extend_repayment_term` | `debt_restructured` | 不得只改月供而不关闭旧债 |
| `negotiate_partial_forgiveness` | `debt_forgiven`，需明确接受证据 | 不得把减免写成现金收入 |
| `sell_nonessential_asset` | `asset_sold`，必要时同事务还本 | 不得出售不存在资产 |
| `seek_verified_family_support` | `family_support_received`，需剧情明确到账 | 不得只因“寻求”就到账 |
| `accept_and_record_payment_arrears` | 通常无 Proposal；月度结算生成 missed record | 不得把 risk 直接升级为正式 default |

Validator 增加以下检查：

- 重组引用的旧债必须 active/defaulted，替代债 ID 必须新建。
- 减免不能超过本金和应计未付利息对应部分。
- 资产出售与还本同事务时，现金来源必须闭环。
- 任何本金支付 Proposal 不允许使用自动缺口策略试算通过。
- `debt_default_recorded` 必须有明确违约证据，不能只依赖 DebtHealthState。

Arc signal 约束：

- `restructuring_accepted`、`debt_cashflow_stabilized` 是保留的 system-derived signal，模型返回时由 `validateNodeOutcomeProposal()` 丢弃。
- `restructuring_accepted` 只在 closing Accepted Financial Events 包含已提交的 `debt_restructured` 或 `debt_forgiven` 时由系统追加。
- `debt_cashflow_stabilized` 只在 closing `debt_health_sustainable` 为真时由系统追加。
- 模型可以返回 `restructuring_started`、`restructuring_failed` 和 `debt_pressure_persists`，但只能推进叙事，不能修改账本或 DebtHealthState。

## 12. `financial_debt_v1` Phase Policy

### 12.1 Policy

在 `src/utils/arcLifecycle.ts` 增加：

```ts
export const FINANCIAL_DEBT_PHASE_POLICY: PhaseTransitionPolicy = {
  id: "financial_debt_v1",
  initialPhaseId: "trigger",
  earlyResolveConditions: [
    { type: "debt_health_sustainable" }
  ],
  allowedSignalTypes: [
    "debt_plan_reviewed",
    "restructuring_started",
    "restructuring_accepted",
    "restructuring_failed",
    "debt_cashflow_stabilized",
    "debt_pressure_persists"
  ],
  phases: [
    {
      id: "trigger",
      ...DEFAULT_TEMPORAL_PROFILES.high_tension,
      durationMonths: [3, 6],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      nextPhaseId: "response"
    },
    {
      id: "response",
      ...DEFAULT_TEMPORAL_PROFILES.high_tension,
      durationMonths: [3, 9],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "restructuring_started" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "restructuring",
      fallbackPhaseId: "restructuring"
    },
    {
      id: "restructuring",
      ...DEFAULT_TEMPORAL_PROFILES.normal,
      durationMonths: [3, 12],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "restructuring_accepted" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "recovery",
      fallbackPhaseId: "recovery"
    },
    {
      id: "recovery",
      ...DEFAULT_TEMPORAL_PROFILES.normal,
      durationMonths: [6, 18],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "debt_health_at_most", value: "watch" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "operation",
      fallbackPhaseId: "operation"
    },
    {
      id: "operation",
      ...DEFAULT_TEMPORAL_PROFILES.stable,
      durationMonths: [9, 24],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [
        { type: "debt_health_at_most", value: "watch" },
        { type: "checkpoint_cap", value: 1 }
      ]
    }
  ]
};
```

若 `response/restructuring` 到 checkpoint cap 时仍为 `default_risk/defaulted`，可以向后进入 recovery 展示，但不得因此把 DebtHealthState 降级。Arc 是叙事前台生命周期，不是财务事实源。

### 12.1.1 Phase 展示事件映射

`resolvePressureArcPresentationEvent()` 对 `financial_debt_v1` 使用固定映射，不能继续对所有 phase 返回起始危机事件：

| Phase | 默认展示事件 | 允许的安全插入 |
|---|---|---|
| `trigger` | `financial_payment_strain` | 无 |
| `response` | `financial_payment_strain` | `financial_repayment_tradeoff` |
| `restructuring` | `financial_debt_restructuring` | 无 |
| `recovery` | `financial_life_under_repayment` | `financial_debt_reduction_progress`、低强度健康/关系/职业事件 |
| `operation` | `financial_life_under_repayment` | `financial_debt_reduction_progress`、低强度普通事件 |

动态安全插入失败时必须回退本表默认事件，不得回退 `arc.eventId`。所有插入事件仍不得创建第二条 Arc。

### 12.2 财务退出条件

扩展 `ArcExitCondition`：

```ts
| {
    type: "debt_health_at_most";
    value: "manageable" | "watch" | "distressed" | "default_risk";
  }
| {
    type: "debt_health_sustainable";
  }
```

扩展 `PhaseTransitionPolicy`：

```ts
earlyResolveConditions?: ArcExitCondition[];
```

`reducePressureArc()` 在普通 phase transition 之前检查 `earlyResolveConditions`。`financial_debt_v1` 命中 `debt_health_sustainable` 时可以从任一 phase 直接 resolve，避免现金流已经恢复却仍被机械推进到 `restructuring`。其他既有 policy 不配置该字段，行为不变。

严重度排序：

```text
none < manageable < watch < distressed < default_risk < defaulted
unknown 不与任何 at_most 条件匹配
```

`debt_health_sustainable` 的确定性定义：

```text
level in [none, manageable, watch]
AND trend != worsening
AND latest debt service has no unpaid amount
AND no open DEBT_PAYMENT_DELINQUENT
```

`earlyResolveConditions` 只使用财务系统生成的 closing state。`operation` phase 不设置 `resolvesPressureArc: true`；否则现有 reducer 会在 checkpoint cap 时无条件关闭仍处于 default risk 的 Arc。达到 cap 但未满足 sustainable 时保持 operation，reason code 为 `resolution-condition-not-met`，checkpoint 计数钳制在 max，直到财务恢复或被健康危机抢占。

扩展 `reducePressureArc()` 输入：

```ts
closingDebtHealthState?: DebtHealthState;
```

财务条件必须使用 closing 状态，不使用上一 HistoryItem 的快照。

### 12.3 带债退出

债务 Arc 允许在以下条件退出：

- level 为 `none`、`manageable` 或 `watch`；
- 最近一次债务服务没有 missed；
- 没有 open `DEBT_PAYMENT_DELINQUENT`；
- 若仍有缺口债，其趋势不得为 `worsening`。

不要求 `totalDebtWan === 0`。

## 13. 健康危机抢占与单前台 Arc

### 13.1 产品决策

急性健康危机优先于债务危机。仅 `queryHealthEscalationEvent()` 返回需要启动 `health_crisis_v1` 的急性事件时允许抢占；普通健康恢复、日常健康变化不能抢占。

优先级：

```text
active health_crisis_v1
> new acute health escalation
> active financial_debt_v1
> other active PressureArc
> new debt default-risk escalation
> ordinary dynamic event
```

### 13.2 状态扩展

扩展：

```ts
PressureArcState.status:
  | "active"
  | "stabilizing"
  | "suspended"
  | "resolved";

PressureArcState.suspendedAtAgeInMonths?: number;
PressureArcState.suspendedByArcId?: string;
```

同步扩展 `EventHistoryCondition` 中 `pressure_arc_state.statuses` 的联合类型以接受 `"suspended"`。`foregroundPressureArc()` 只返回 `foregroundPressureArcId` 指向且状态为 active/stabilizing 的 Arc；suspended Arc 不能被误当成前台。

扩展 transition 结果，使一次原子事务可以更新前台 health Arc 和后台 debt Arc：

```ts
export interface PressureArcTransitionDecision {
  // existing fields describe the primary/narrative arc
  additionalArcStateUpdates?: PressureArcState[];
  foregroundPressureArcId?: string;
}
```

- `nextArcState` 始终表示本节点叙事直接处理的 primary Arc。
- `additionalArcStateUpdates` 只用于同事务暂停、恢复或关闭后台 Arc。
- `commitSimulationTransaction()` 先应用 `nextArcState`，再按 ID 应用 additional updates，最后一次性设置明确的 `foregroundPressureArcId`。
- 同一 Arc ID 不得同时出现在 primary 和 additional updates；否则抛出事务校验错误。
- `committedArcMeta` 和报告邀请归因只读取 primary Arc，后台 debt Arc 的自动暂停/恢复/关闭不能伪装成本节点解决了一条叙事 Arc。

抢占：

1. 将前台 debt Arc 设为 `suspended`，保留 phase 和 checkpoint。
2. 启动 health Arc 并设为 foreground。
3. 暂停期间不增加 debt Arc checkpoint，不推进 phase elapsed months。

健康 Arc 结束：

1. 重新派生最新 closing debt health。
2. 若 debt health 为 `distressed/default_risk/defaulted`，恢复最近被该 health Arc 暂停的 debt Arc。
3. 若为 `none/manageable/watch`，将 debt Arc 直接标记 `resolved`，reason code 为 `debt-stabilized-during-health-preemption`。
4. 若为 `unknown`，恢复 debt Arc 到低强度 continuation，不直接关闭。

报告邀请规则：

- 用户在债务 Arc 的前台节点中真实完成可持续恢复时，继续按现有 `arc_resolved` 规则评估邀请。
- 健康 Arc 结束时顺带关闭后台 debt Arc，不触发第二个债务 Arc 报告邀请。
- preemption、suspend 和 resume 本身都不是邀请理由。

### 13.3 明确限制

- 债务 Arc 不抢占任何 active health Arc。
- 第一版不支持债务 Arc 抢占 generic pressure Arc；已有其他前台 Arc 时，债务危机保留为 debt health 和 eligibility 事实，待前台 Arc 结束后再评估是否启动。
- suspended Arc 不参与事件 continuation 选择，但保留在 WorldState。
- `foregroundPressureArcId` 始终最多一个。

## 14. 模拟事务管线重排

### 14.1 当前问题

当前顺序：

```text
validate outcome
→ reducePressureArc
→ commitAuthoritativeFinancialProgress
→ commitSimulationTransaction
```

因此本节点重组成功后，Arc 仍只能读取旧财务状态。

### 14.2 新顺序

```text
选择事件（读取上一已提交 debt health）
→ 生成和校验节点
→ 首次 validateNodeOutcomeProposal
→ 计算 authoritative financial candidate
→ 完成 Proposal repair 和必要的 narrative repair
→ 使用最终 narrativeText 重新 validateNodeOutcomeProposal
→ derive closing financial state
→ derive closing debt health
→ reduce/preempt/resume PressureArc（读取 closing debt health）
→ commitSimulationTransaction 一次性提交 node + ledger + debt health + WorldState
```

`commitAuthoritativeFinancialProgress()` 在此阶段必须保持纯候选提交语义：只返回对象，不单独持久化。若财务或 Arc 任一步失败，不保存部分结果。

第二次 `validateNodeOutcomeProposal()` 是强制步骤：财务 Proposal repair、财务叙事 sanitizer 或 narrative repair 可能改变 `node.description`，而 arc signal 的 evidence 必须仍能在最终 narrativeText 中匹配。Arc 只能消费第二次校验后的 outcome；不得沿用修复前的 arcSignals，也不得在 evidence 静默失配时继续推进 Arc。

### 14.3 幂等

- simulation transaction ID 保持现有稳定哈希。
- 重试同一事务不得重复增加缺口本金、missed counters 或 checkpoint。
- 财务 candidate 已在账本 `committedTransactionIds` 命中时，DebtHealthState 必须从已提交 ledger 派生，而不是再次结算。
- preemption/resume 必须以 Arc ID 幂等；同一 health Arc 不得重复 suspend 同一 debt Arc。

## 15. Prompt 修改

Prompt 的财务摘要增加受限字段：

```json
{
  "debtHealth": {
    "level": "distressed",
    "trend": "worsening",
    "reasonCodes": ["RECENT_MISSED_PAYMENT", "SHORTFALL_GROWING"]
  },
  "debtAccounts": [
    {
      "id": "mortgage_1",
      "type": "mortgage",
      "status": "active",
      "servicingStatus": "partial",
      "principalWan": 80,
      "accruedUnpaidInterestWan": 0.2
    }
  ]
}
```

Prompt 约束：

- 不要求模型返回 `DebtHealthState`。
- 不允许模型返回最终余额或把“申请重组”写成“重组完成”。
- 没有正式 default evidence 时禁止写催收、诉讼、失信或强制处置。
- 选择资产出售、家人支持或重组时，模型必须返回对应 Proposal；否则只表示尝试。
- narrative 必须允许角色在债务未清零时继续健康、关系、工作和个人方向。

## 16. 文件级实施清单

### 16.1 账本层

- `src/domain/finance/types.ts`
  - Debt servicing fields、DebtServiceRecord、issue codes、default event、summary fields。
- `src/domain/finance/ledgerMath.ts`
  - `totalDebtWan` 加入 `accruedUnpaidInterestWan`；新增不变量。
- `src/domain/finance/accruePeriod.ts`
  - 逐月 waterfall、部分支付、missed record；禁止 debt service 自动补债。
- `src/domain/finance/reduceFinancialLedger.ts`
  - 单一缺口账户、缺口豁免、issue 生命周期、default/restructure/forgiveness 规则。
- `src/domain/finance/reconcileLiquidity.ts`
  - 分离 eligible non-debt shortfall 与 require-prefunded 路径。
- `src/domain/finance/migrateLegacyFinancialState.ts`
  - legacy FinancialState 直接初始化 v3。
- 新增 `src/domain/finance/migrateFinancialLedgerV2ToV3.ts`
  - servicing 默认值、旧缺口合并和 v2→v3 守恒。
- `src/domain/finance/validateFinancialProposals.ts`
  - 偿债资金来源、default evidence、重组和未付利息校验。
- `src/domain/finance/deriveFinancialState.ts`
  - 总债务和利息语义同步。
- 新增 `src/domain/finance/debtHealth.ts`。

### 16.2 模拟与历史

- `src/types.ts`
  - Node/History debt health、PressureArc suspended 字段。
- `src/utils/historyRestore.ts`
  - 克隆和恢复 debt health。
- `src/services/simulation/simulationService.ts`
  - 管线重排、health preemption、resume、closing health 输入。
- `src/utils/simulationTransaction.ts`
  - 原子写入 debt health 和 `additionalArcStateUpdates` 多 Arc 状态变化。
- `src/services/simulation/prompts.ts`
  - Debt health 与受限债务摘要、Proposal 约束。

### 16.3 事件与 Arc

- `src/utils/eventEligibility.ts`
  - debt health context keys；移除危机对裸 debt_present 的依赖。
- `src/data/phase2LifeEvents.ts`
  - 五类事件、恢复事件修订、幽灵引用清理。
- `src/utils/arcLifecycle.ts`
  - `financial_debt_v1`、财务退出条件、suspend/resume。
- `src/utils/arcContinuation.ts` 或当前 continuation 选择文件
  - debt phase → event 映射和安全 continuation。

## 17. 测试规格

### 17.1 账本单元测试

必须覆盖：

1. 现金足够：按期支付利息和本金。
2. 现金只够利息：利息足额、本金部分或未付，不新增缺口债。
3. 现金只够部分利息：记录未付利息和 missed，不新增缺口债。
4. 非债务持续支出导致缺口：现金归零、缺口本金等额增加。
5. 连续多个事务缺口：始终只有一个 active 自动缺口账户。
6. 每次缺口增额均有独立 transaction 审计记录。
7. 缺口账户超过24个月仍为 `event_driven`。
8. 缺口债不会自动还款、不会再制造缺口债。
9. 未付利息进入 total debt 和净资产。
10. 未付本金不重复增加债务。
11. 第一次 missed 不进入 defaulted。
12. 明确 default event 才进入 defaulted。
13. 重组保留本金和未付利息守恒。
14. 减免未付利息时不增加现金。
15. 同一事务重试不重复 missed counter 或缺口增额。
16. 旧多个缺口账户迁移后总债务、现金和净资产不变。
17. 全部 Proposal 默认在 `require_explicit` 下试算，确定性持续义务仍可形成系统缺口。
18. 资产购买、债务支付和重组费不能被系统缺口账户兜底。
19. 已发生必要支出只有经 validator 标记后才能二次试算使用系统缺口。
20. Proposal repair 失败后，不提交被拒事件，其他确定性结算保持可提交。

### 17.2 DebtHealthState 测试

必须覆盖：

- 无债务 → `none`。
- 正常大额房贷、按期支付 → `manageable`。
- 负可支配现金流但仍履约 → `watch`。
- 本期首次部分支付 → `distressed`，不是 defaulted。
- 连续两个月未支付 → `default_risk`。
- accepted formal default → `defaulted`。
- 缺口债两次增额 → `distressed`。
- 债务下降但 missed 仍持续 → 不得标记 recovering。
- 债务仍存在、coverage 恢复、无 missed → `watch/manageable` + improving。
- 旧信息不足 → `unknown`，不得进入 crisis。
- 三个月后结束的合同收入只计入 horizon 前三个月，不能按全年收入计算 coverage。
- legacy compatibility 状态不能满足 `debt_health_available`。

### 17.3 Eligibility 与事件测试

- `debt_present` 仍可服务资源排序，但不能启动 crisis。
- `manageable` 房贷不能选择困境事件。
- `watch/distressed` 只能选择普通债务压力事件。
- `default_risk/defaulted` 可选择 `financial_payment_strain`。
- `financial_debt_reduction_progress` 要求真实 improving trend。
- `financial_major_crisis` 幽灵引用为 0。
- 事件正文和 Proposal 不得发明账户或金额。

### 17.4 Arc 测试

- `financial_payment_strain` 启动 `financial_debt_v1`。
- `watch/distressed` 不启动 Arc。
- closing health 降到 `watch` 时可推进或退出，不滞后一节点。
- 债务未归零但可持续时可以退出。
- checkpoint cap 不得修改 DebtHealthState。
- 重组选择但 Proposal 被拒绝时，Arc 不因选择文本自动恢复。
- 财务或 narrative repair 改写正文后，arcSignals 必须用最终 narrativeText 重验；失配信号不能推进 Arc。
- 急性健康事件抢占 debt Arc。
- debt Arc suspended 期间 checkpoint 不增加。
- health Arc 结束后，债务仍 distressed 时恢复 debt Arc。
- health Arc 结束后，债务已稳定时关闭 debt Arc。
- foregroundPressureArcId 始终最多一个。
- active health Arc 不能被 debt Arc 抢占。
- 后台 debt Arc 自动关闭不产生重复 report invitation。

### 17.5 端到端与真实路线

固定至少五条路线：

1. 正常房贷长期按期偿还。
2. 收入下降但仍能支付利息，部分本金延期。
3. 持续生活缺口形成单一缺口债并进入 distressed。
4. 连续 missed → default risk → 重组 → 带债恢复。
5. debt Arc 中发生急性健康危机，健康抢占后恢复债务线。

每条保存完整 node、ledger、DebtServiceRecord、DebtHealthState、eventMeta、Arc 和 report invitation。

## 18. CI Gate 与验收指标

### Gate D1a：缺口账户安全

```text
active auto-shortfall accounts per ledger <= 1
liquidity_shortfall auto-amortized after 24 months = 0
shortfall consolidation audit loss = 0
v2→v3 migration net-worth discrepancy = 0
```

### Gate D1b：偿债与试算安全

```text
negative committed cash = 0
automatic shortfall created by debt service = 0
debt due = paid + unpaid discrepancy = 0
unexplained net-worth delta = 0
idempotency failures = 0
proposal funding bypass through auto-shortfall = 0
completed narrative claims without accepted financial event = 0
```

### Gate D2：领域状态与事件覆盖

```text
normal mortgage crisis false-positive = 0
missed payment without distress/default-risk classification = 0
debt crisis triggered only by totalDebtWan > 0 = 0
debt distress event families covered = 5/5
ghost financial_major_crisis references = 0
```

### Gate D3：Arc 与跨领域调度

```text
closing debt health exit lag = 0
multiple foreground pressure arcs = 0
acute health blocked by active debt arc = 0
suspended debt arc checkpoint drift = 0
debt remains > 0 but sustainable arc-exit failures = 0
partial transaction commits = 0
```

`Gate D1` 是 D1a 与 D1b 的聚合门禁。所有 gate 在 CI 中自动触发；D1a、D1b、D2、D3 完成中间不要求人工暂停确认。任何 gate 失败均不得进入下一阶段合并。

在 `package.json` 增加：

```json
{
  "test:financial-debt-d1a": "node --import tsx --test src/domain/finance/reduceFinancialLedger.test.ts src/domain/finance/migrateFinancialLedgerV2ToV3.test.ts",
  "test:financial-debt-d1b": "node --import tsx --test src/domain/finance/debtLifecycle.test.ts src/domain/finance/debtDistressLedger.test.ts src/domain/finance/validateFinancialProposals.test.ts",
  "test:financial-debt-d1": "pnpm test:financial-debt-d1a && pnpm test:financial-debt-d1b",
  "test:financial-debt-d2": "node --import tsx --test src/domain/finance/debtHealth.test.ts src/utils/eventEligibility.test.ts src/data/phase2LifeEvents.test.ts",
  "test:financial-debt-d3": "node --import tsx --test src/utils/arcLifecycle.test.ts src/services/simulation/simulationService.test.ts src/utils/simulationTransaction.test.ts src/utils/historyRestore.test.ts"
}
```

`.github/workflows/ci.yml` 在既有 M7 gate 后、Full unit regression 前依次运行 D1a、D1b、D2、D3。D1 聚合脚本同时纳入既有 `test:financial-m5`，D3 同时纳入既有 `test:financial-m7`，避免单独脚本通过但里程碑 gate 漏测。

## 19. 分阶段开发计划

### Phase D0：失败基线

- 为当前以债养债、缺口增殖和24个月债务螺旋建立固定失败测试。
- 保存当前真实路线 baseline manifest。
- 基线用于对比问题指标，不要求修复后数字完全相同。

### Phase D1a：单一缺口账户与螺旋隔离

- 单一自动缺口账户。
- 缺口债豁免自动摊销。
- `origin`、v2→v3 基础迁移和审计增额记录。
- 保持其他偿债行为暂时不变，先验证账户合并与净资产守恒。
- 独立 PR 合入并运行 D1 中的 shortfall 子集。

### Phase D1b：逐月偿债与支付失败事实

- Debt servicing fields 和 service records。
- 逐月 payment waterfall。
- missed/delinquent issue。
- 正式 default event。
- Validator 统一严格试算、Proposal/narrative repair 回退和幂等。
- 通过 Gate D1。

### Phase D2：DebtHealthState

- 实现派生器和配置阈值。
- 接入 Node、History、restore、Prompt 受限摘要。
- 兼容旧历史。
- 完成状态单元测试。

### Phase D3：困境事件库

- 新增 context keys。
- 新增五类事件。
- 修订恢复事件。
- 清理 `financial_major_crisis`。
- 建立 outcome → Proposal 测试。
- 通过 Gate D2。

### Phase D4：Debt Arc 与管线重排

- `financial_debt_v1`。
- `debt_health_at_most`。
- 财务 candidate → debt health → Arc → 原子提交顺序。
- health 抢占、debt suspend/resume。
- 通过 Gate D3。

### Phase D5：真实路线影子验证与切换

- 跑固定五条路线和现有五终局路线。
- 对比现金、债务、净资产、missed、缺口账户数、事件和 Arc。
- 检查报告叙事不再把持续负债描述为财务自由。
- 指标通过后启用唯一策略；不保留两套长期偿债 reducer。

滚动修订规则：D1a、D1b、D2 每个 gate 通过后，开发者必须用实际类型、测试和 baseline 结果复核后续 D3–D4 章节，并在同一分支修订 Spec 中已经失效的接口细节后再继续。该复核是代码评审与 CI 清单，不设置人工暂停或用户确认点。

## 20. 风险与控制

| 风险 | 等级 | 控制 |
|---|---|---|
| 月度 waterfall 改变所有路线数字 | 高 | 先保存 baseline；验收问题指标和不变量，不锁旧错误数字 |
| missed 被误判为正式违约 | 高 | 分离 servicingStatus、default risk 和 accepted default event |
| 财务先算、Arc 后算产生半提交 | 高 | 所有步骤只生成候选对象，最终一次 commitSimulationTransaction |
| DebtHealth 阈值误伤正常房贷 | 高 | coverage/missed/shortfall 为主，总债务只作背景；固定反例测试 |
| 长 debt Arc 屏蔽健康和普通生活 | 高 | 仅 default risk 启 Arc；急性健康抢占；限制 checkpoint |
| 合并缺口账户丢失审计 | 中 | 账户合并、transaction record 不合并 |
| 缺口债豁免后永久不处理 | 中 | persisted issue + distressed eligibility + 处置事件，不自动虚构摊销 |
| 旧存档字段缺失 | 中 | 可选字段、确定性迁移、unknown 保守回退 |
| 重组选项被误当成重组成功 | 中 | outcome 与 Accepted Event 分离，closing ledger 决定健康状态 |
| health preemption 扩大多 Arc 复杂度 | 中 | 仅支持 health 对 debt 单向抢占，不泛化任意多 Arc 调度 |

## 21. Definition of Done

本 Spec 完成必须同时满足：

1. 自动计划还款永远不会通过新增流动性缺口债完成。
2. 任一账本最多一个 active 系统缺口账户，且每次增额可审计。
3. 缺口债不会被年龄阈值转成自动摊销。
4. 月度到期金额可拆成 paid/unpaid，现金始终非负。
5. 第一次 missed、持续 delinquency、default risk 和正式 default 语义分离。
6. 未付利息进入总债务和净资产，重组与减免守恒。
7. `DebtHealthState` 完全由 closing ledger 派生并保存到 History。
8. 正常房贷不会触发债务危机事件或 Arc。
9. 五类困境/恢复事件均由可靠债务健康状态门控。
10. 债务 Arc 可以在仍有债务但支付可持续时退出。
11. 急性健康危机不会被债务 Arc 屏蔽，暂停和恢复行为可重复验证。
12. 财务、DebtHealth、Arc 和 WorldState 在同一模拟事务中原子提交。
13. D1、D2、D3 CI gate 全部通过。
14. 固定真实路线中负现金、缺口增殖和债务螺旋均为 0。

## 22. 最终原则

债务不是一个触发惩罚剧情的数字，而是一组有来源、有合同、有支付事实和生活后果的长期义务。

账本负责回答“实际欠多少、到期多少、支付多少、为什么没付”；`DebtHealthState` 负责回答“是否可持续”；事件系统负责让这些事实进入工作、健康、关系和生活选择；模型只负责提出有证据的叙事与 Proposal。任何一层都不得替代另一层重新猜测。
