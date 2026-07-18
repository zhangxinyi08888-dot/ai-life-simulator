# 权威财务账本架构：根治版 Spec

## 1. 文档状态

- 状态：待开发
- 规格决策日期：2026-07-18
- 目标版本：`FinancialLedger.version=2`
- 变更性质：财务事实架构重构，不是现有规则的局部修补
- 核心交付：职业身份单写、个人权威账本、持续收支、债务账户、企业权益、原子事务、派生财务快照和可审计证据
- 当前基线：节点保存 `FinancialState`、`FinancialSignals`、`FinancialChange`；`simulationService` 可以从模型信号、旧 `FinancialChange` 或正文 fallback 三条路径生成财务状态
- 上游依赖：`2026-07-17-protagonist-profile-and-internal-ledger-spec.md` 中的 `CareerState`、结构化 WorldDelta / ProfilePatch 和事务提交原则
- 取代范围：本 Spec 取代 `2026-07-13-cumulative-net-wealth-design.md` 中“模型返回 FinancialSignals 后直接更新余额”的设计，并取代 `2026-07-16-negative-cash-and-financial-narrative-minimal-fix-design.md` 中作为长期架构的现金缺口处理；后两份文档只保留为历史背景

## 2. 问题定义

2026-07-17 的真实 AI 路线评估包含 10 条路线、296 个节点。测试暴露的不是几个独立计算错误，而是财务系统缺少权威事实源和一致的状态演进协议。

### 2.1 已确认的问题

| 问题 | 评估结果 | 结构性后果 |
|---|---:|---|
| 主角被误判为 `student` | 46 / 296 个节点，人工复核仅约 3 个是真实全日制学生 | 触发学生低支出，污染后续现金和财富属性 |
| 年核心支出降到 1.2 万元 | 109 / 296 个节点 | 支出形成只降不升的棘轮，长期虚增现金 |
| 企业和个人财务混合 | 296 个节点的 `businessAndOtherAssetsWan` 始终为 0 | 公司融资进入个人现金，持股与估值口径失真 |
| 债务多年静止 | 5 条有债务路线均出现 | 房贷不摊销、还款与现金不闭环、净资产失真 |
| 现金无来源跌破 0 | 已发现 2 个明确节点 | 账本允许消费不存在的资金 |
| 退休身份与收入冲突 | 出现 36 岁误退休、退休后原工资延续等 | 身份、收入来源、阶段收入和年化收入互相矛盾 |
| 报告与账本冲突 | 多条路线存在 | 报告读取了已污染快照，并再次按文风解释数字 |

评估基线目录：

```text
artifacts/report-invitation-browser/
  2026-07-17-phase2-real-ai-browser-evaluation/cases/
```

### 2.2 当前错误链路

```text
模型或正文给出自然语言
        ↓
模型返回 FinancialSignals，或代码从正文关键词补推
        ↓
学生校正 / 旧 FinancialChange / 本地 fallback 分支
        ↓
applyFinancialSignals() 或 applyFinancialChange()
        ↓
FinancialState
        ↓
财富属性、事件资格、下一轮 Prompt、最终报告
```

前面任何一次身份、收入、支出或交易误判都会成为下一轮输入，并在后续节点持续放大。

### 2.3 根因

#### 根因 A：存量、流水、身份和估值混在同一组信号里

`FinancialSignals` 同时携带：

- `employmentStatus`：职业生命周期事实；
- `monthlyNetIncomeWan`：持续收入率；
- `incomeMonths`：阶段发生期；
- `oneOffIncomeWan` / `oneOffExpenseWan`：现金流水；
- `assetValueChangeWan`：投资估值；
- `propertyMarketValueChangeWan`：房产交易或估值；
- `personalDebtChangeWan`：债务余额净变化。

这些字段的所有权、时间语义和现金影响不同，不能由一次模型返回直接写进最终状态。

#### 根因 B：没有唯一写入者

当前至少存在三条财务落账路径：

1. 合法 `FinancialSignals` → `applyFinancialSignals()`；
2. 合法旧 `FinancialChange` → `applyFinancialChange()`；
3. 两者失败 → 从正文推断 `FinancialSignals`。

同一事实在不同路径下可能产生不同结果，无法建立全局不变量。

#### 根因 C：自然语言拥有了事实写权限

当前系统会从整段正文中的“大学”“学生”“退休”“工作”等词推断主角身份，没有主语、时间和已发生结果校验。正文同时承担叙事与数据库更新协议，导致他人经历、计划、选项和背景描述被写成主角事实。

#### 根因 D：个人与企业没有实体边界

公司融资、公司营收、公司估值、创始人持股、个人工资、个人分红和股权出售没有分属不同实体，因此企业资金会被误写为个人可支配现金。

#### 根因 E：余额快照没有可追溯的账户和交易

系统只保存聚合余额，无法回答：

- 这笔债务是什么类型、何时产生、是否需要自动还款；
- 现金为什么增加或减少；
- 资产变化是购买、出售还是估值；
- 收入是工资、租金、养老金、版税还是企业分红；
- 某个数字来自用户、已接受结果、估计还是模型推断。

## 3. 目标

### 3.1 产品目标

- 人生跨越几十年后，财务状态仍保持连续、可解释和符合基本经济关系。
- 用户能够理解现金、资产、债务、持续收入和企业权益为什么变化。
- 合理保留负净资产、失业、创业亏损和退休消耗储蓄等真实路径，不把“财务困难”当成计算错误。
- 报告、财富属性、事件资格和下一轮剧情读取同一份权威财务状态。

### 3.2 工程目标

- `CareerState` 成为就业身份的唯一写入者。
- `FinancialLedger` 成为个人金额、账户、持续来源、义务和交易的唯一写入者。
- 模型只返回结构化 Proposal；只有校验通过的 Proposal 才能成为 Accepted Event。
- 所有 Accepted Event 通过一个幂等 reducer 原子提交。
- `FinancialState` 改为从账本派生的兼容快照，任何模型返回的最终余额都不具有写权限。
- 明确区分阶段实际发生额、当前月度运行率和向前年化指标。
- 明确区分个人资产与企业实体资金。
- 支持旧历史读取、回溯和渐进迁移，不静默重写已完成历史。

### 3.3 根治标准

本次完成标准不是七项指标暂时下降，而是以下错误类别在架构上不可表达或无法通过校验：

- 正文关键词直接改变就业状态；
- `part_time` 自动触发学生支出；
- 借款、还款、债务减免共享一个无法解释现金影响的净字段；
- 公司融资直接增加个人现金；
- 没有资金来源却提交负现金；
- 同一节点绕过统一 reducer 更新财务状态；
- 报告或摘要反向写入财务事实。

## 4. 非目标

- 不建设银行级总账、完整会计科目表或税务申报系统。
- 不接入真实股票、基金、房价、利率和通胀行情。
- 不精算中国所有地区的个税、社保、养老金和福利规则。
- 不在第一版建立配偶、父母和子女的完整独立账本；家庭支持先以有方向的个人交易记录。
- 不自动决定破产、资产出售、社会救助或家庭援助。
- 不追求所有旧历史数字的自动纠正；旧历史只建立明确的迁移边界。
- 不把职业、婚姻、健康和地点全部放进财务账本；它们由各自 reducer 单写，财务只引用已接受状态。
- 不允许“为了叙事自然”绕过结构化交易和权威状态。

## 5. 核心设计原则

### 5.1 单一事实所有权

| 事实 | 唯一权威来源 | 兼容或展示位置 |
|---|---|---|
| 当前就业身份、职业和组织 | `CareerState` | `FinancialState.employmentStatus` 只读镜像，后续删除 |
| 现金、投资、房产、个人企业权益 | `FinancialLedger` 账户 | `FinancialState` 聚合快照 |
| 债务余额和状态 | `DebtAccount` | `FinancialState.totalDebtWan` 聚合值 |
| 工资、租金、养老金等持续收入 | `IncomeSource` | 年化收入和阶段收入派生值 |
| 基础生活、住房、照护等持续义务 | `ExpenseCommitment` | 年化核心支出和阶段支出派生值 |
| 公司融资、估值和主角持股 | `BusinessEntityRef + BusinessHolding` | 个人企业权益派生值 |
| 本阶段已发生变化 | `AcceptedFinancialEvent[]` | `FinancialPeriodSummary` |
| 正文、摘要和最终报告 | 派生内容 | 永远不得反写上述事实 |

### 5.2 模型提出，代码决定，事务提交

模型可以：

- 从已接受选择和正文中提出职业状态变化；
- 提出收入来源开始、暂停、调整或结束；
- 提出已经发生的支出、资产交易、借款、还款和企业权益变化；
- 为 Proposal 提供证据和置信度。

模型不可以：

- 直接返回或覆盖最终 `FinancialState`；
- 仅凭关键词改变 `CareerState`；
- 在没有资金来源时创造个人现金；
- 将公司融资解释为个人收入；
- 用一段 summary 替代账户或交易；
- 在冲突时静默选择更顺故事的一方。

### 5.3 存量、流水和运行率分离

- 存量：某一年龄时点的现金、资产和债务余额。
- 流水：一段时间内实际发生的收入、支出、借款、还款和交易。
- 运行率：当前仍有效的月度收入或支出，用于下一阶段自动结算。
- 估值：资产价格变化，不等于现金流。

四者必须使用不同结构，不得继续压进同一个净变化字段。

### 5.4 不确定不是零，也不是沿用一切

缺失信息时必须区分：

- `known`：有权威事实和证据；
- `estimated`：系统按明确政策估计；
- `unknown`：不能确定，不能当作零；
- `needs_review`：与其他权威事实冲突或缺少重大交易闭环。

旧系统的“模型没有返回所以写 0”和“正文没有新数字所以无限沿用”都被禁止。

### 5.5 原子、幂等、可回溯

- 一个节点的职业变化、财务事件和世界状态变化使用同一 `transactionId`。
- 同一事务重复提交不得重复累计收入、支出或债务。
- 历史节点保存当时的账本快照引用或完整可恢复快照。
- 回到旧节点后从该节点账本继续分叉，不读取未来分支账户。

### 5.6 计量单位与个人边界

- 所有金额继续使用 `CNY_WAN_REAL`：以当前购买力表示的人民币万元，避免跨越几十年的名义金额不可比。
- 收入默认记录个人税后到账金额；公司税前营收、家庭成员收入和雇主成本不能混入。
- 支出只记录主角个人实际承担或共同承担中归属于主角的部分；“家里欠债”“孩子学费”“父母医疗费”只有主角实际支付、代偿或共同负责时才进入个人账本。
- 配偶共同房产和共同债务在第一版允许按主角归属比例计入；比例未知时标记 `needs_review`，不得默认 100% 归属于主角。
- 估值和现金流都必须使用相同购买力口径；不得一边使用当前房价，一边使用几十年前名义工资。

## 6. 总体架构

```text
User Facts / Accepted Choice / Accepted World Outcome
                         ↓
              Proposal Extraction Layer
        ┌────────────────┴────────────────┐
        ↓                                 ↓
CareerTransitionProposal        FinancialEventProposal[]
        ↓                                 ↓
Career Validator               Financial Validator
        ↓                                 ↓
AcceptedCareerTransition       AcceptedFinancialEvent[]
        └────────────────┬────────────────┘
                         ↓
             Simulation Transaction Commit
                         ↓
        ┌────────────────┴────────────────┐
        ↓                                 ↓
    CareerState                    FinancialLedger
                                          ↓
                              deriveFinancialState()
                                          ↓
                  FinancialState + FinancialPeriodSummary
                                          ↓
             Wealth / Eligibility / Prompt / UI / Report
```

### 6.1 模块边界

建议新增：

```text
src/domain/finance/
  types.ts
  initializeLedger.ts
  accruePeriod.ts
  validateFinancialProposals.ts
  acceptFinancialEvents.ts
  reduceFinancialLedger.ts
  deriveFinancialState.ts
  migrateLegacyFinancialState.ts
  reconcileLiquidity.ts
  compatibility.ts
```

职业状态继续由画像 / 世界状态模块管理，不在 `src/domain/finance` 内复制 reducer。

## 7. 领域模型

### 7.1 通用元数据

```ts
export type FinancialFactStatus =
  | "known"
  | "estimated"
  | "unknown"
  | "needs_review";

export type FinancialFactSource =
  | "user"
  | "accepted_history"
  | "accepted_simulation_outcome"
  | "system_policy"
  | "legacy_migration";

export interface FinancialEvidence {
  source: FinancialFactSource;
  sourceNodeId?: string;
  sourceEventId?: string;
  sourceChoiceId?: string;
  excerpt?: string;
  reasonCode: string;
  confidence: number;
}
```

约束：

- `excerpt` 只是审计证据，不参与后续事实推断。
- `model_inferred` 不作为已接受财务事实来源；模型推断只能存在于 Proposal，接受后来源记录为 `accepted_simulation_outcome`，并保留 validator reason。
- `confidence` 不能覆盖写入权限和会计不变量。

### 7.2 账本根对象

```ts
export interface FinancialLedger {
  id: string;
  owner: "protagonist";
  currencyUnit: "CNY_WAN_REAL";
  asOfAgeInMonths: number;

  cashAccounts: CashAccount[];
  assetAccounts: AssetAccount[];
  debtAccounts: DebtAccount[];
  incomeSources: IncomeSource[];
  expenseCommitments: ExpenseCommitment[];
  businessHoldings: BusinessHolding[];

  recentTransactions: FinancialTransaction[];
  committedTransactionIds: string[];
  unresolvedIssues: FinancialLedgerIssue[];
  revision: number;
  version: 2;
}
```

`recentTransactions` 只需覆盖 Prompt、审计和回溯需要的窗口；完整历史已随节点快照保存，不要求一个不断增长的全局数组。

节点存储边界：

```ts
export interface SimulationNode {
  // 现有字段保持不变
  financialLedger?: FinancialLedger;       // V2 权威快照
  financialState?: FinancialState;         // V2 派生兼容快照
  financialPeriodSummary?: FinancialPeriodSummary;
}

export interface HistoryItem {
  // 与 SimulationNode 使用相同三个财务字段
  financialLedger?: FinancialLedger;
  financialState?: FinancialState;
  financialPeriodSummary?: FinancialPeriodSummary;
}
```

- `WorldStateSnapshot` 不复制金额和账户，只保存 CareerState 等跨领域状态。
- 当前节点和历史节点各自保存可恢复的 ledger 快照，保证回溯和分支隔离。
- `financialState` 在保存前由 ledger 确定性派生，读取旧历史时仍允许只有 V1 `financialState`。
- `financialSignals` 和 `financialChange` 只在迁移期保留旧历史读取，不进入新 V2 节点的权威写入链路。

### 7.3 现金账户

```ts
export interface CashAccount {
  id: string;
  type: "cash" | "bank_deposit" | "short_term_reserve";
  balanceWan: number;
  status: "active" | "closed";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}
```

第一版允许初始化为一个聚合 `primary_cash` 账户。多现金账户是模型能力，不是第一版 UI 要求。

### 7.4 资产账户

```ts
export type AssetType =
  | "investment"
  | "property"
  | "annuity"
  | "insurance_cash_value"
  | "other_personal_asset";

export interface AssetAccount {
  id: string;
  type: AssetType;
  displayName: string;
  marketValueWan: number;
  liquidity: "liquid" | "semi_liquid" | "illiquid";
  status: "active" | "disposed";
  factStatus: FinancialFactStatus;
  openedAtAgeInMonths: number;
  closedAtAgeInMonths?: number;
  evidence: FinancialEvidence[];
}
```

规则：

- 购买和出售是现金与资产之间的交易。
- `AssetRevalued` 只改变市值，不改变现金。
- 房产交易金额、房产市值变化和房贷必须分别表达。
- 年金、基金和保险不得只扣现金而不创建对应资产。

### 7.5 持续收入来源

```ts
export type IncomeSourceType =
  | "salary"
  | "contract"
  | "self_employment_draw"
  | "rent"
  | "pension"
  | "annuity_payment"
  | "royalty"
  | "investment_distribution"
  | "business_dividend"
  | "family_support"
  | "other";

export interface IncomeSource {
  id: string;
  type: IncomeSourceType;
  displayName: string;
  monthlyNetAmountWan?: number;
  annualNetAmountWan?: number;
  accrualPolicy: "monthly" | "annual" | "event_only";
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  status: "active" | "paused" | "ended";
  linkedCareerStateId?: string;
  linkedAssetAccountId?: string;
  linkedBusinessHoldingId?: string;
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}
```

关键约束：

- 退休只结束与原职业绑定且确实终止的工资来源，不自动结束租金、版税、年金或分红。
- 就业状态变化不自动创造具体工资金额；缺少金额时收入来源为 `unknown` 或沿用有明确持续性的既有合同。
- `incomeMonths` 不再由模型自由填写，由生效和结束月份与本阶段时间区间求交集得到。
- 一次性报酬使用 FinancialEvent，不伪装成持续收入来源。

### 7.6 持续支出义务

```ts
export type ExpenseCommitmentType =
  | "basic_living"
  | "housing"
  | "dependent_support"
  | "education"
  | "healthcare"
  | "insurance"
  | "other";

export interface ExpenseCommitment {
  id: string;
  type: ExpenseCommitmentType;
  displayName: string;
  monthlyAmountWan: number;
  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  status: "active" | "paused" | "ended";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}
```

关键约束：

- `student`、`part_time`、`retired` 不能直接覆盖全部支出义务。
- 身份只影响“是否需要重新估计缺失支出”，不删除房租、房贷利息、子女、照护、医疗等已存在义务。
- 生活成本需要调整时，提交 `ExpenseCommitmentAdjusted`，保留旧金额和生效时间。
- 没有明确变化时延续有效义务；不能把一次低估永久写成新基线。

### 7.7 债务账户

```ts
export type DebtType =
  | "mortgage"
  | "consumer_loan"
  | "student_loan"
  | "credit_balance"
  | "business_personal_guarantee"
  | "family_or_personal_loan"
  | "liquidity_shortfall";

export interface DebtRepaymentPolicy {
  mode: "known_schedule" | "estimated_amortizing" | "event_driven";
  monthlyPaymentWan?: number;
  monthlyPrincipalWan?: number;
  monthlyInterestWan?: number;
  annualInterestRate?: number;
  remainingTermMonths?: number;
}

export interface DebtAccount {
  id: string;
  type: DebtType;
  displayName: string;
  principalWan: number;
  openedAtAgeInMonths: number;
  closedAtAgeInMonths?: number;
  status: "active" | "repaid" | "restructured" | "defaulted";
  repaymentPolicy: DebtRepaymentPolicy;
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}
```

规则：

- 新借款：现金增加、债务本金增加，净资产不立即变化。
- 偿还本金：现金减少、债务本金减少，净资产不立即变化。
- 支付利息：现金减少、费用增加，净资产减少。
- 债务减免：债务减少、产生单独的债务减免收益；不伪装成现金收入。
- 再融资：旧债关闭、新债建立，只有费用影响净资产。
- 房贷和标准分期债务不得永久 `event_driven`。条款未知时使用明确标记的 `estimated_amortizing` 保守策略；非标准私人借款可以 `event_driven`，但长期无变化时进入 `needs_review`。
- `principalWan` 不允许小于 0；归零时账户必须变为 `repaid`。

### 7.8 企业实体与个人持股

```ts
export interface BusinessEntityRef {
  id: string;
  displayName: string;
  latestPostMoneyValuationWan?: number;
  valuationAsOfAgeInMonths?: number;
  status: "operating" | "exited" | "closed" | "unknown";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}

export interface BusinessHolding {
  id: string;
  business: BusinessEntityRef;
  ownershipRate?: number;
  attributableValueWan?: number;
  liquidityDiscountRate?: number;
  personalCarryingValueWan: number;
  status: "active" | "partially_sold" | "sold" | "written_off";
  factStatus: FinancialFactStatus;
  evidence: FinancialEvidence[];
}
```

企业边界：

- 公司融资进入公司实体，不进入个人现金账户。
- 公司营收、合同额和公司现金不是主角个人收入。
- 企业估值变化不是个人现金流。
- 只有工资、创始人提款、分红、股权出售等明确对个人发生的转移才能进入个人账本。
- 融资后只有在投后估值和主角持股可确定时，才能更新 `personalCarryingValueWan`。
- 只有融资金额而没有估值或持股变化时，记录企业融资事实，并把个人权益标记为 `needs_review`；不得简单把融资金额搬到 `businessAndOtherAssetsWan`。
- 退出或出售股权时，个人现金流和企业权益减少必须成对提交。

### 7.9 账本问题

```ts
export interface FinancialLedgerIssue {
  id: string;
  code:
    | "MISSING_FUNDING_SOURCE"
    | "UNBALANCED_TRANSACTION"
    | "CAREER_INCOME_CONFLICT"
    | "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"
    | "UNKNOWN_DEBT_SCHEDULE"
    | "UNSUPPORTED_LARGE_VALUE_CHANGE"
    | "LEGACY_UNCERTAINTY";
  severity: "warning" | "blocking";
  relatedProposalIds: string[];
  summary: string;
  createdAtAgeInMonths: number;
}
```

重大冲突不能只写进日志后继续提交。`blocking` 问题必须拒绝本轮相关 Proposal，进入结构化修复；修复仍失败时保留上轮权威状态，只提交确定性自动结算。

### 7.10 新模拟的初始账本

新模拟不能让模型直接生成一份被视为真值的最终余额。初始化也必须经过 Proposal、校验和 Accepted Event：

```ts
export interface InitialFinancialProfileProposal {
  asOfAgeInMonths: number;
  explicitFacts: Array<{
    kind: "cash" | "asset" | "debt" | "income_source" | "expense_commitment" | "business_holding";
    payload: unknown;
    evidence: string;
    confidence: number;
  }>;
  missingFactKinds: string[];
}
```

初始化顺序：

1. 优先读取用户明确填写的金额、工作、住房、债务和家庭责任。
2. 已回答的稳定问题可以产生 `known` opening event。
3. 模型只负责把用户材料整理成 Proposal，不能增加用户没有表达的房产、遗产、公司股权或巨额负债。
4. 缺失但模拟必须使用的基础现金和生活支出，由版本化 `FinancialEstimationPolicy` 给出保守估计，并标记 `estimated + system_policy`。
5. 无法合理估计的企业持股、债务期限和非工资收入保持 `unknown`，不写 0。
6. 所有 opening event 经过同一 validator 后交给 `initializeFinancialLedger()`。

```ts
export interface FinancialEstimationPolicy {
  id: string;
  version: number;
  estimateOpeningCash(context: FinancialEstimationContext): EstimatedMoney;
  estimateBasicLivingCommitment(context: FinancialEstimationContext): EstimatedMoney;
  estimateDebtRepaymentPolicy(context: FinancialEstimationContext): DebtRepaymentPolicy | undefined;
}

export interface FinancialEstimationContext {
  ageInMonths: number;
  careerState?: CareerState;
  locationStateId?: string;
  livingArrangement?: "with_family" | "renting" | "owner_occupied" | "unknown";
  explicitDependents?: number;
}

export interface EstimatedMoney {
  valueWan: number;
  plausibleRangeWan: [number, number];
  policyId: string;
  reasonCode: string;
}
```

估计必须可重现：相同输入与 policy version 得到相同结果。不得把随机模型输出包装成 `system_policy`。

## 8. 职业状态集成

### 8.1 单写规则

`CareerState.employmentStatus` 是就业身份真值。`FinancialLedger` 只能通过 `linkedCareerStateId` 引用职业状态，不保存第二份可独立更新的就业状态。

过渡期的 `FinancialState.employmentStatus`：

```ts
financialState.employmentStatus = currentCareerState.employmentStatus;
```

它由 `deriveFinancialState()` 写入，只为旧 UI、Prompt 和测试兼容。模型、财务 Proposal 和财务 reducer 均不得写该字段。

#### CareerState 上线前的过渡权威

Profile Phase 1 尚未上线时，允许在 `WorldStateSnapshot` 增加一个临时权威字段：

```ts
export interface WorldStateSnapshot {
  // 现有字段保持不变
  currentEmploymentStatus?: EmploymentStatus;
}
```

过渡规则：

- 新节点优先读取 `currentEmploymentStatus`；缺失时只在初始化阶段从用户明确事实或旧 `FinancialState.employmentStatus` 建立一次 opening value。
- 后续没有已接受职业转换时永远保持上一轮值，不再从正文关键词重新推断。
- 只有用户编辑或已选择结果携带的、经过校验的结构化 `EmploymentTransition` 可以更新该字段。
- `LifeEventSeed.employmentStatusHint` 如存在，只能声明该事件可能产生的状态或帮助构造 Proposal，不能直接写状态；实际状态必须由所选 `eventOutcomeId` 对应的 Accepted Transition 决定。
- CareerState 上线后，`currentEmploymentStatus` 改为从当前 CareerState 派生的兼容镜像；财务调用方继续通过同一个 resolver 读取，无需再次改接口。

```ts
export function resolveAuthoritativeEmploymentStatus(input: {
  currentCareerState?: CareerState;
  worldState: WorldStateSnapshot;
  legacyFinancialState?: FinancialState;
  isInitialization: boolean;
}): EmploymentStatus | undefined;
```

过渡字段是 CareerState 的部署脚手架，不是第二个长期事实源。

### 8.2 结构化职业转换

```ts
export interface EmploymentTransitionProposal {
  id: string;
  fromCareerStateId: string;
  toStatus: EmploymentStatus;
  occupation?: string;
  organization?: string;
  effectiveAtAgeInMonths: number;
  sourceOutcomeId: string;
  evidence: string;
  confidence: number;
}

export interface AcceptedCareerTransition {
  id: string;
  proposalId?: string;
  fromCareerStateId: string;
  nextCareerState: CareerState;
  effectiveAtAgeInMonths: number;
  evidence: FinancialEvidence[];
  acceptedByReasonCodes: string[];
}
```

接受条件：

- 必须关联用户已选择并被接受的 `eventOutcomeId` 或用户编辑命令；
- 必须描述主角已经发生的状态变化；
- 计划、考虑、候选选项和其他人物经历不能接受；
- `fromCareerStateId` 必须是提交前当前状态；
- 生效时间必须位于本节点覆盖时间内；
- 退休后重新就业、老年进修和兼职顾问均允许，不按年龄禁止；但必须有主角明确证据。

### 8.3 身份与收入解耦

- `employed` 不保证一定存在已知工资金额。
- `retired` 不等于收入为 0。
- `student` 可以有兼职、奖学金、家庭支持或资产收入。
- `part_time` 是工作强度，不是教育身份。
- `medical_leave` 可以继续领取部分工资、病假工资或保险给付。
- 职业转换只开始、暂停或结束与它明确关联的收入来源，不能清空全部收入。

## 9. 财务事件模型

### 9.1 Proposal 与 Accepted Event 分离

```ts
export interface FinancialEventProposal {
  id: string;
  kind: FinancialEventKind;
  effectiveAtAgeInMonths: number;
  payload: unknown;
  evidence: string;
  sourceOutcomeId?: string;
  confidence: number;
}

export interface AcceptedFinancialEvent {
  id: string;
  proposalId?: string;
  kind: FinancialEventKind;
  effectiveAtAgeInMonths: number;
  payload: FinancialEventPayload;
  evidence: FinancialEvidence[];
  acceptedByReasonCodes: string[];
}
```

Proposal 可以被接受、修正、拆分或拒绝。Accepted Event 的 payload 必须是具体类型，不能继续使用 `unknown`。

### 9.2 事件类型

```ts
export type FinancialEventKind =
  | "income_source_started"
  | "income_source_adjusted"
  | "income_source_paused"
  | "income_source_ended"
  | "one_off_income_received"
  | "expense_commitment_started"
  | "expense_commitment_adjusted"
  | "expense_commitment_ended"
  | "one_off_expense_paid"
  | "asset_purchased"
  | "asset_sold"
  | "asset_revalued"
  | "debt_drawn"
  | "debt_principal_repaid"
  | "debt_interest_paid"
  | "debt_restructured"
  | "debt_forgiven"
  | "business_financing_recorded"
  | "business_holding_revalued"
  | "business_distribution_received"
  | "business_holding_sold"
  | "family_support_received"
  | "family_support_paid"
  | "liquidity_shortfall_created";
```

### 9.3 最小 payload 契约

Accepted Event 不接受只有“净变化”的模糊 payload。最少必须使用以下有方向结构：

```ts
export interface MoneyReceivedPayload {
  destinationCashAccountId: string;
  amountWan: number;
  incomeSourceId?: string;
}

export interface MoneyPaidPayload {
  sourceCashAccountId: string;
  amountWan: number;
  expenseCommitmentId?: string;
}

export interface AssetPurchasePayload {
  sourceCashAccountId: string;
  assetAccount: AssetAccount;
  cashPaidWan: number;
  transactionFeeWan: number;
  linkedDebtDrawEventId?: string;
}

export interface AssetSalePayload {
  assetAccountId: string;
  destinationCashAccountId: string;
  assetValueRemovedWan: number;
  cashReceivedWan: number;
  transactionFeeWan: number;
}

export interface DebtDrawPayload {
  debtAccount: DebtAccount;
  destinationCashAccountId: string;
  principalDrawnWan: number;
}

export interface DebtPrincipalRepaymentPayload {
  debtAccountId: string;
  sourceCashAccountId: string;
  principalPaidWan: number;
}

export interface DebtInterestPaymentPayload {
  debtAccountId: string;
  sourceCashAccountId: string;
  interestPaidWan: number;
}

export interface BusinessFinancingPayload {
  businessHoldingId: string;
  financingAmountWan: number;
  postMoneyValuationWan?: number;
  ownershipRateAfterFinancing?: number;
  personalCashReceivedWan: 0;
}
```

持续来源和义务的 start / adjust / pause / end payload 必须携带完整对象 ID、生效时间和新旧值。资产重估必须携带 `assetAccountId`、旧值、新值和估值依据。债务重组必须显式引用旧债和新债，不能只给 `totalDebtChangeWan`。

```ts
export type FinancialEventPayload =
  | MoneyReceivedPayload
  | MoneyPaidPayload
  | AssetPurchasePayload
  | AssetSalePayload
  | DebtDrawPayload
  | DebtPrincipalRepaymentPayload
  | DebtInterestPaymentPayload
  | BusinessFinancingPayload
  | IncomeSource
  | ExpenseCommitment
  | AssetAccount
  | DebtAccount
  | BusinessHolding;
```

实现时应进一步使用 `FinancialEventPayloadMap[FinancialEventKind]` 建立 kind 到 payload 的编译期映射，禁止把上述 union 当成无需判别的宽类型。

### 9.4 标准财务影响

| 事件 | 现金 | 资产 | 债务 | 本期净财富 |
|---|---:|---:|---:|---:|
| 持续/一次性个人收入到账 | `+金额` | 0 | 0 | `+金额` |
| 生活或一次性费用支付 | `-金额` | 0 | 0 | `-金额` |
| 现金购买投资/房产 | `-金额及费用` | `+购入价值` | 0 | 仅费用和成交差额影响 |
| 出售资产 | `+净到手金额` | `-账面价值` | 0 | 出售损益影响 |
| 资产重估 | 0 | `±金额` | 0 | `±金额` |
| 新增借款到账 | `+金额` | 0 | `+金额` | 0 |
| 偿还本金 | `-金额` | 0 | `-金额` | 0 |
| 支付利息 | `-金额` | 0 | 0 | `-金额` |
| 债务减免 | 0 | 0 | `-金额` | `+金额`，单独标记非现金收益 |
| 公司融资 | 0 | 默认 0 | 0 | 默认 0；持股重估另行提交 |
| 企业分红到账 | `+金额` | 0 | 0 | `+金额` |
| 出售个人持股 | `+净到手金额` | `-个人权益价值` | 0 | 出售损益影响 |

### 9.5 统一交易记录

```ts
export interface FinancialTransaction {
  id: string;
  simulationTransactionId: string;
  eventIds: string[];
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  cashDeltaWan: number;
  assetDeltaWan: number;
  debtDeltaWan: number;
  incomeWan: number;
  expenseWan: number;
  valuationChangeWan: number;
  nonCashGainLossWan: number;
  netWorthDeltaWan: number;
  evidence: FinancialEvidence[];
}
```

该结构是面向产品的轻量交易汇总，不要求暴露会计借贷方向。但 reducer 内部必须验证资产、债务和净财富变化可以由 Accepted Event 完整解释。

```ts
export interface FinancialPeriodSummary {
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  incomeWan: number;
  coreExpenseWan: number;
  otherExpenseWan: number;
  debtPrincipalPaidWan: number;
  debtInterestPaidWan: number;
  assetPurchaseWan: number;
  assetSaleProceedsWan: number;
  valuationChangeWan: number;
  netCashFlowWan: number;
  netWorthChangeWan: number;
  transactionIds: string[];
}
```

## 10. 时间推进与自动结算

### 10.1 阶段边界

每个节点具有：

```text
periodStartAgeInMonths
periodEndAgeInMonths
internalTransitions[].atAgeInMonths
```

自动结算必须按时间切片：

1. 结算阶段开始到第一个结构化转换；
2. 应用转换；
3. 结算到下一个转换；
4. 应用节点内一次性事件；
5. 结算到阶段结束。

如果 Proposal 只能确认“本阶段发生”但无法确认具体月份，默认在阶段末生效，并将 factStatus 标为 `estimated`。不得把退休或离职回溯到整个阶段起点，从而错误抹除此前收入。

### 10.2 收入结算

```text
periodIncome = Σ 每个有效 IncomeSource 在本阶段实际覆盖月份的应计金额
             + Σ 已接受一次性个人收入
```

- 月度来源按有效月份计算。
- 年度来源按 policy 分摊或在明确支付月份到账。
- `event_only` 来源没有事件时不自动创造收入。
- 结束收入来源后，后续阶段不再沿用。

### 10.3 支出结算

```text
periodCoreExpense = Σ 有效 ExpenseCommitment 的本阶段金额
periodOtherExpense = Σ 已接受一次性支出 + 债务利息 + 交易费用
```

- 基础生活支出不得为负。
- 已存在的住房、抚养、照护和医疗义务不会因职业标签变化自动消失。
- 大额一次性支出必须有资金来源闭环。

### 10.4 债务结算

- `known_schedule`：按已知本金、利息和期数结算。
- `estimated_amortizing`：按初始化时记录的保守估计结算，每次都保留 estimated 证据。
- `event_driven`：只在明确事件时变化；达到复核阈值时产生 `UNKNOWN_DEBT_SCHEDULE`。
- 任何本金偿还都必须有同额现金流或明确的资产处置 / 再融资来源。

## 11. 流动性与负现金

### 11.1 不变量

任何新账本提交后：

```text
totalCashWan >= 0
```

负净资产允许存在，负现金余额不允许作为已提交状态存在。

### 11.2 资金来源校验

提交大额支出前，validator 计算：

```text
availableCashAfterDeterministicAccrual
+ acceptedDebtDraws
+ acceptedAssetSaleProceeds
+ acceptedSupportReceived
- acceptedExpenses
- acceptedPrincipalRepayments
```

结果小于 0 时，原 Proposal 因 `MISSING_FUNDING_SOURCE` 被阻断。

### 11.3 流动性缺口

若剧情明确支出已经发生，不能简单拒绝并假装没有发生。系统进入结构化修复，要求在同一事务补充一种真实资金来源：

- 新增短期负债；
- 资产出售；
- 家庭支持；
- 其他明确收入；
- 下调或取消尚未实际发生的支出。

只有修复接受后才能提交。`liquidity_shortfall_created` 是有证据的短期负债事件，不是 reducer 在后台静默造债。

若修复仍失败：

- 本轮相关重大财务 Proposal 不提交；
- 保留确定性的持续收支结算；
- 写入 blocking issue；
- 下一节点必须处理该资金冲突；
- 不允许保存负现金。

## 12. 派生财务快照

### 12.1 V2 快照

```ts
export interface DerivedFinancialStateV2 {
  currencyUnit: "CNY_WAN_REAL";
  asOfAgeInMonths: number;

  cashWan: number;
  investmentAssetsWan: number;
  propertyMarketValueWan: number;
  businessAndOtherAssetsWan: number;
  totalDebtWan: number;
  netWorthWan: number;

  periodIncomeWan: number;
  periodCoreExpenseWan: number;
  periodOtherExpenseWan: number;
  periodNetCashFlowWan: number;

  annualizedRecurringIncomeWan: number;
  annualizedCoreExpenseWan: number;
  annualizedDisposableCashFlowWan: number;

  employmentStatus: EmploymentStatus;
  incomeStability: IncomeStability;
  factStatus: FinancialFactStatus;
  unresolvedIssueCodes: FinancialLedgerIssue["code"][];
  ledgerRevision: number;
}
```

### 12.2 指标语义

- `periodIncomeWan`：本节点覆盖时间内实际确认的个人税后收入。
- `annualizedRecurringIncomeWan`：节点结束时仍有效的持续收入来源按未来 12 个月年化，不包含一次性收入。
- `periodCoreExpenseWan`：本阶段实际核心支出。
- `annualizedCoreExpenseWan`：节点结束时仍有效的支出义务年化。
- `annualizedDisposableCashFlowWan`：持续收入年化减持续核心支出、已知利息与固定义务年化。
- 历史字段 `annualAfterTaxIncomeWan`、`annualCoreExpenseWan`、`annualDisposableIncomeWan` 在兼容期映射到三个 annualized 字段，不再使用 `monthlyIncome * 12` 无视生效状态。

### 12.3 净资产恒等式

```text
netWorthWan =
  cashWan
  + investmentAssetsWan
  + propertyMarketValueWan
  + businessAndOtherAssetsWan
  - totalDebtWan
```

并且：

```text
currentNetWorthWan - previousNetWorthWan
= incomeWan
- expenseWan
+ valuationChangeWan
+ nonCashGainLossWan
```

借款到账、偿还本金和资产类型转换不得单独改变净资产。

### 12.4 财富属性

`wealth: 0–100` 只能读取 `DerivedFinancialStateV2`。在存在 blocking issue 时：

- 不因未知金额给予高财富分；
- 流动性、收入稳定性和债务安全度使用保守下界；
- 保留 reason code，便于测试和报告说明。

## 13. Proposal 校验

### 13.1 校验顺序

```text
Schema
→ Outcome Authority
→ Subject
→ Temporal
→ Account / Entity Boundary
→ Funding Source
→ Accounting Invariants
→ Plausibility
→ Cross-domain Consistency
```

### 13.2 权威结果校验

- Proposal 必须对应已接受选择、节点内已发生事实或确定性自动结算。
- 候选选项、计划、愿望和可能性不能落账。
- 重大变化必须能关联 `sourceOutcomeId` 或用户命令。

### 13.3 主语校验

- 交易和身份必须明确属于主角。
- 孩子上大学、同事退休、公司获得融资等不得直接映射为主角学生、退休或个人收入。
- 无法确认主语时拒绝 Proposal，不用关键词猜测。

### 13.4 重大金额校验

以下情形必须进入结构化修复或 `needs_review`：

- 普通工资节点出现无法解释的巨额净财富变化；
- 资产购入没有现金、债务或交换资产来源；
- 债务减少没有本金支付、减免或重组事件；
- 公司融资同时进入个人现金；
- 企业权益变化缺少估值或持股依据；
- 现金将跌破 0；
- 当前职业与工资来源明显冲突但没有转换时间。

### 13.5 不使用正文 fallback 创建事实

当 Proposal 缺失或损坏时：

1. 继续结算既有有效收入来源、支出义务和债务政策；
2. 尝试一次结构化修复，修复输出仍是 Proposal；
3. 无法修复时保持未知变化不提交；
4. 记录 issue；
5. 不调用 `inferEmploymentStatus(description)`；
6. 不从普通正文提取金额后直接落账。

正文本地提取器可以用来发现“可能遗漏了重大事实”，但只能触发修复，不能成为 Accepted Event。

### 13.6 模型 Proposal 返回契约

Phase 5 将节点 Prompt 的财务返回格式从扁平信号：

```json
{
  "financialSignals": {
    "employmentStatus": "employed",
    "monthlyNetIncomeWan": 2.5,
    "incomeMonths": 12,
    "oneOffIncomeWan": 0,
    "oneOffExpenseWan": 0,
    "personalDebtChangeWan": 0
  }
}
```

改为有方向的 Proposal：

```json
{
  "financialEventProposals": [
    {
      "id": "proposal_salary_started_1",
      "kind": "income_source_started",
      "effectiveAtAgeInMonths": 324,
      "payload": {
        "id": "income_salary_primary",
        "type": "salary",
        "displayName": "当前工作的税后工资",
        "monthlyNetAmountWan": 2.5,
        "accrualPolicy": "monthly",
        "activeFromAgeInMonths": 324,
        "status": "active",
        "linkedCareerStateId": "career_current"
      },
      "sourceOutcomeId": "accepted_join_company",
      "evidence": "你正式入职，税后月薪为2.5万元",
      "confidence": 0.9
    }
  ]
}
```

Prompt 约束：

- 没有财务变化时返回空数组，不重复返回全部现有账户。
- Proposal 只描述本节点已经发生的变化，不返回候选选项中的未来金额。
- employmentStatus 通过独立 `EmploymentTransitionProposal` 返回，不放进财务 Proposal。
- 模型不返回最终余额、净资产、`incomeMonths` 或债务净变化。
- 账户 ID 优先引用 Prompt 提供的现有 ID；新建来源、资产或债务时使用本节点内唯一临时 ID，由 validator 转成稳定 ID。

#### Phase 1–4 兼容适配器

在 Prompt 完成切换前，模型可以继续返回旧 `FinancialSignals`，但 `attachFinancialProgress()` 不再用它直接更新余额，而是先调用：

```ts
adaptLegacyFinancialSignalsToProposals({
  signals,
  narrativeEvidence,
  currentCareerState,
  currentLedger,
  period
}): {
  proposals: FinancialEventProposal[];
  issues: FinancialLedgerIssue[];
};
```

适配边界：

- 忽略 `FinancialSignals.employmentStatus`，身份只走 Career 权威链路。
- `incomeMonths` 不直接采用，由来源生效区间计算。
- 持续收入和支出只有在主角证据明确时才能转换为 start / adjust / end Proposal；否则延续现有权威来源和义务。
- 一次性收入和支出必须有已发生证据才能转换。
- `assetValueChangeWan` 只有在唯一资产账户和估值语义明确时才能转换；否则产生 issue。
- `propertyMarketValueChangeWan` 必须先区分购买、出售或重估，不能按净字段直接转换。
- `personalDebtChangeWan` 不能自动转换，因为它无法区分借款到账、资产融资、还本、减免和重组；非零值必须进入结构化修复。
- 涉及融资、公司估值或股权时禁止通用转换，必须进入企业边界 validator。

这个适配器是迁移层，Phase 5 Prompt 切换完成后停止生成新的旧信号，Phase 7 删除。

## 14. 原子事务提交

### 14.1 输入

```ts
export interface SimulationDomainTransaction {
  transactionId: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  currentCareerState: CareerState;
  currentFinancialLedger: FinancialLedger;
  acceptedCareerTransitions: AcceptedCareerTransition[];
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  acceptedWorldOutcome: AcceptedNodeOutcome;
}
```

### 14.2 提交顺序

1. 检查 `transactionId` 幂等。
2. 校验所有 Accepted Event 的时间与当前 revision。
3. 按时间切片结算现有收入、支出和债务。
4. 在对应时间点应用职业转换。
5. 应用与职业转换关联的收入来源开始、暂停或结束事件。
6. 应用一次性财务事件。
7. 处理并校验流动性。
8. 计算交易汇总和派生快照。
9. 校验净资产恒等式、账户非负约束和实体边界。
10. 同时提交 CareerState、FinancialLedger、WorldStateSnapshot 和节点快照。

任一步出现 blocking 错误，整个领域事务不得部分提交。

### 14.3 版本与并发

- 事务输入携带 `expectedLedgerRevision` 和 `expectedCareerRevision`。
- 任一 revision 不一致时返回冲突，不重放旧 Proposal。
- 成功提交后两个 revision 按实际变化分别递增。

## 15. Prompt、正文与报告边界

### 15.1 下一轮 Prompt

Prompt 只接收：

- 当前 CareerState；
- 派生财务快照；
- 有效收入来源的受限摘要；
- 有效支出与债务义务的受限摘要；
- 最近已接受交易；
- unresolved issue；
- 当前选择允许产生的 Proposal schema。

不得把整份底层账本或全部历史交易塞给模型，也不得要求模型重新计算最终余额。

### 15.2 正文生成顺序

推荐顺序：

```text
先生成受约束的节点结果和 Proposal
→ 校验并提交领域事务
→ 根据已提交结果生成或校正财务表述
```

若继续采用一次调用同时返回正文和 Proposal，正文只能视为候选文案；提交后必须删除或重写与权威状态冲突的余额陈述。

### 15.3 最终报告

- 所有金额来自 `DerivedFinancialStateV2` 和账本趋势，不从正文重新提取。
- 报告区分现金、净资产、企业权益、负债和持续收入。
- “巨额财富”“财务自由”“负债沉重”等评价必须使用配置阈值和可解释指标。
- blocking issue 存在时，报告不得给出过度确定的金额结论；应说明哪些部分为估计或待确认。
- 报告不能为了文学主题否定明确数字，也不能用文学表述替代财务事实。

## 16. 旧数据迁移

### 16.1 迁移原则

- 不批量重写旧节点正文和历史快照。
- 旧节点继续按 V1 读取。
- 从旧节点继续模拟时，在分叉点创建 V2 opening ledger。
- opening ledger 只迁移已有结构化余额，不重新解析历史正文。

### 16.2 Opening Ledger

```ts
export interface LegacyOpeningBalanceEvent {
  kind: "legacy_opening_balance";
  asOfAgeInMonths: number;
  cashWan: number;
  investmentAssetsWan: number;
  propertyMarketValueWan: number;
  businessAndOtherAssetsWan: number;
  totalDebtWan: number;
  sourceFinancialStateRef: string;
}
```

迁移规则：

- 五项余额创建聚合账户并标记 `legacy_migration`。
- `netWorthWan` 重新按恒等式计算，忽略旧的派生值。
- 旧 `annualAfterTaxIncomeWan` 不能无条件创建永久工资来源；只有存在可靠 CareerState 或结构化历史证据时才创建 estimated IncomeSource。
- 旧 `annualCoreExpenseWan` 可以创建 estimated 基础支出义务，但不得低于配置的合理下界且必须保留 `LEGACY_UNCERTAINTY`。
- 旧 `totalDebtWan` 创建聚合债务账户；类型和期限未知时标记 `needs_review`，不能假装拥有精确摊销计划。
- 旧 `businessAndOtherAssetsWan` 只能创建 legacy 企业及其他资产聚合项，不反推公司、估值和持股。

### 16.3 历史回溯

- V2 节点保存 `FinancialLedger` 快照或可恢复的结构化引用。
- 回到 V2 节点时恢复对应 ledger revision 和 committed transaction IDs。
- 回到 V1 节点时重新创建该分支的 opening ledger。
- 新分支不得复用原未来分支的交易 ID。

## 17. 影子运行与切换

### 17.1 影子模式

第一阶段保留 V1 对用户可见结果，同时让 V2 账本在测试和受控环境中并行计算：

```text
相同 Accepted Outcome
       ├── V1 FinancialState
       └── V2 FinancialLedger → DerivedFinancialStateV2
```

影子模式只用于比较，不允许 V1 和 V2 互相写入。

记录差异：

- employmentStatus；
- 现金；
- 资产分类；
- 债务；
- 阶段收入和支出；
- 净资产；
- unresolved issue。

### 17.2 单写切换

满足验收条件后：

1. V2 成为唯一写入者；
2. V1 `FinancialState` 由 compatibility formatter 派生；
3. 停止调用 `applyFinancialSignals()` 和 `applyFinancialChange()` 更新余额；
4. 停止正文 employment / amount fallback；
5. 模型 contract 切换到 Proposal；
6. 下游逐项切换到 V2 派生快照。

### 17.3 删除旧路径

完成至少一轮完整真实 AI 回归并稳定后删除：

- `inferEmploymentStatus()`；
- `isStudentFinancialNarrative()` 对身份的写入用途；
- `reconcileStudentFinancialSignals()` 的身份和全局支出覆盖；
- `FinancialSignals.employmentStatus`；
- `personalDebtChangeWan`；
- `attachFinancialProgress()` 中的三分支写入；
- 旧 `FinancialChange` 直接 reducer 路径。

兼容读取类型可以保留到旧历史迁移策略稳定，但不得继续产生新 V1 节点。

## 18. 测试策略

### 18.1 纯函数不变量测试

每次 reducer 提交必须验证：

```text
cash >= 0
all asset balances >= 0
all debt principal >= 0
netWorth = assets - debts
debt draw: cash delta = debt delta
principal repayment: cash delta = debt delta，方向相反于余额
asset purchase/sale closes cash and asset legs
company financing does not change personal cash
transaction IDs are idempotent
```

### 18.2 职业与收入测试

- “孩子考入大学”不改变主角 CareerState。
- “退休干部加入团队”不改变主角 CareerState。
- 在线 MBA 不自动把全职主角改为 student。
- `part_time` 不触发学生支出策略。
- 退休只终止明确关联的工资，不终止租金、养老金、年金和版税。
- 退休后重新就业和老年进修可以通过明确 Accepted Outcome 合法发生。
- 没有职业转换时状态继承，不重新推断。

### 18.3 收支与时间测试

- 收入来源只按实际覆盖月份累计。
- 阶段实际收入与当前年化收入分别正确。
- 节点中途离职只结算离职前工资。
- 支出义务不会因身份标签变化消失。
- 一次低支出估计不会永久覆盖后续基线。

### 18.4 债务测试

- 房贷按已知或明确估计的政策递减。
- 借款增加现金和债务，不改变净资产。
- 还本金减少现金和债务，不改变净资产。
- 利息减少现金和净资产。
- 债务减免不增加现金。
- 再融资不制造净资产。
- 现金不足时必须补充结构化资金来源。

### 18.5 企业测试

- A 轮融资不增加个人现金。
- 公司合同额和营收不进入个人收入。
- 投后估值与持股明确时才重估个人权益。
- 分红增加个人现金，但公司融资不增加。
- 出售持股同时减少企业权益并增加个人现金。
- 期权池扩张不是个人生活支出。

### 18.6 真实路线回归

固定使用 2026-07-17 评估的 10 条路线作为 legacy regression corpus，并增加 V2 重跑。

最低验收：

| 指标 | 验收条件 |
|---|---|
| 主语错配导致身份变化 | 0 |
| `part_time` 被学生规则处理 | 0 |
| 无来源负现金 | 0 |
| 债务变化与现金 / 减免 / 重组不闭环 | 0 |
| 公司融资进入个人现金 | 0 |
| 净资产恒等式失败 | 0 |
| 同一事务重复累计 | 0 |
| 报告金额与最终派生快照冲突 | 0 |
| 重大未知金额被静默当作 0 | 0 |

同时保留合理性人工复核：

- 负可支配现金流在有储蓄时允许存在；
- 退休后消耗现金是合法路径；
- 老年工作和学习不被年龄硬禁止；
- 创业失败和负净资产不被自动美化；
- 企业权益不会被误当成高流动性现金。

## 19. 可观测性与审计

每个节点在开发和评估环境输出 `FinancialCommitTrace`：

```ts
export interface FinancialCommitTrace {
  transactionId: string;
  proposalIds: string[];
  acceptedEventIds: string[];
  rejectedProposals: Array<{ id: string; reasonCodes: string[] }>;
  openingLedgerRevision: number;
  closingLedgerRevision: number;
  periodSummary: FinancialPeriodSummary;
  invariantResults: Array<{ code: string; passed: boolean }>;
  issueCodes: FinancialLedgerIssue["code"][];
}
```

要求：

- trace 不进入面向用户的主页面。
- 评估报告必须能按 reason code 汇总。
- 任一数字都能追溯到 opening balance、自动结算或 Accepted Event。
- 不记录未脱敏的用户敏感原文；excerpt 只保留支持当前事实的最短片段。

## 20. 分阶段实施

### Phase 0：规格与失败基线

- 本 Spec 评审通过。
- 修订画像 Spec 的财务所有权和 CareerState 单写表述。
- 把七类问题转成固定测试和指标脚本。
- 为 10 条真实路线保存不可变 baseline manifest。
- 明确 V1/V2 对比字段和允许误差。

### Phase 0.5：P0 最小权威切片

目的：在完整账本开发前立即停止新增身份和负现金污染，同时确保代码形态可以被 V2 复用，而不是形成另一套临时规则。

代码交付：

1. `WorldStateSnapshot.currentEmploymentStatus?` 和 `resolveAuthoritativeEmploymentStatus()`：初始化后只继承或接受结构化职业转换。
2. 停止 `inferEmploymentStatus()` 的正文关键词写入；旧函数可以暂留兼容壳，但只能返回权威状态或上一状态。
3. 学生支出校正只在权威状态严格等于 `student` 时运行；`part_time` 和正文出现“大学/学生”都不能触发。
4. 在 V1 两条 reducer 后统一执行 `reconcileLiquidityShortfall()`：若原始现金小于 0，将现金归零，并把等额缺口记录为 `liquidityShortfallWan` 和短期债务，保证转换前后净资产相同。
5. 增加身份主语错配、低支出棘轮、负现金、缺口转债和净资产不二次变化测试。

明确不做：

- 不让 `personalDebtChangeWan` 一律等额影响现金。当前正数可表示房贷等资产融资，负数又可能表示还本、减免或重组；在不知道交易类型时自动改现金会制造新的重复入账。
- 不在这一切片解决房贷摊销、普通借款到账、还本现金流和企业融资；这些由 Phase 3、Phase 4 的有方向事件完成。
- 不宣称 Phase 0.5 已完成根治。它只建立两个后续不会推翻的不变量：身份单写和已提交现金非负。

Phase 0.5 验收：

| 指标 | 条件 |
|---|---|
| 新节点从正文关键词改变就业状态 | 0 |
| `part_time` 进入学生支出校正 | 0 |
| 新节点 `cashWan < 0` | 0 |
| 流动性缺口导致净资产二次减少 | 0 |
| 相同节点重复处理缺口 | 不重复增债 |

### Phase 1：账本内核

- 增加 V2 类型。
- 实现初始化、时间结算、事件接受、唯一 reducer 和派生快照。
- 实现现金、资产、债务和净资产不变量。
- 完成纯函数单元测试，不接 AI。

### Phase 2：职业状态与持续收支

- 实现 CareerState 的结构化 EmploymentTransition。
- 实现 IncomeSource 和 ExpenseCommitment 生命周期。
- 删除财务对正文就业关键词的依赖。
- 实现阶段实际值与年化运行率分离。

### Phase 3：债务与流动性

- 实现 DebtAccount 和三种 repayment policy。
- 实现借款、还本、利息、重组、减免和短期流动性缺口。
- 阻断无资金来源的已发生支出。

### Phase 4：企业实体边界

- 实现 BusinessEntityRef 和 BusinessHolding。
- 区分公司融资、公司营收、个人工资、分红和股权出售。
- 将个人企业权益纳入净资产，但不纳入现金和高流动性资产。

### Phase 5：Proposal 与原子事务

- 模型 contract 改为结构化 Proposal。
- 实现 Proposal validators 和修复协议。
- 将职业、财务和世界状态纳入同一 simulation transaction。
- 运行 V1/V2 影子对比。

### Phase 6：下游切换

- 财富属性读取 V2。
- 下一轮 Prompt 读取 V2 受限摘要。
- UI 和最终报告读取 V2。
- 完成旧历史 opening ledger 和回溯。
- V2 变为唯一写入者。

### Phase 7：删除旧路径

- 删除正文财务 fallback 的写权限。
- 删除 `personalDebtChangeWan` 和 `FinancialSignals.employmentStatus`。
- 删除旧双 reducer 写入。
- 重跑真实 AI 路线并完成验收。

## 21. 开发顺序与首个实现切片

本 Spec 通过后的第一周先交付 Phase 0 的失败基线和 Phase 0.5 的 P0 最小权威切片。该切片必须按上述权威 resolver 和流动性函数实现，不能用新增正文正则或债务净字段猜测替代。

随后第一个根治性内核切片是不依赖 AI 的账本核心：

1. 定义 `FinancialLedger`、账户、收入来源、支出义务、债务和 Accepted Event 类型。
2. 实现 `reduceFinancialLedger()` 和 `deriveFinancialState()`。
3. 用手写 Accepted Event 覆盖收入、支出、资产购买、借款、还本、利息和公司融资。
4. 锁定净资产、现金、债务、个人 / 企业边界和幂等不变量。
5. 实现 `migrateLegacyFinancialState()`，使现有路线可以从任意 V1 节点进入 V2。

只有账本内核通过后，才接模型 Proposal、CareerState 和真实路线。这样根治逻辑先由确定性代码成立，不把架构正确性继续寄托在 Prompt 上。

## 22. 最终决策摘要

1. `CareerState` 单写就业身份，财务只读引用。
2. `FinancialLedger` 单写所有个人金额事实。
3. `FinancialState` 是派生快照，不是模型输入后的可写对象。
4. 持续收入、持续支出、账户余额和阶段交易分开保存。
5. 债务使用账户和有方向的事件，不再使用一个净变化字段表达所有情况。
6. 公司融资和公司营收不进入个人现金；企业权益需要估值和持股证据。
7. 正文和 summary 永远没有硬事实写权限。
8. 所有变更经过 Proposal → Validator → Accepted Event → 单一 reducer。
9. 职业、财务和世界状态使用同一幂等事务原子提交。
10. 先影子运行 V2，再单写切换，最后删除 V1 推断和双 reducer。
