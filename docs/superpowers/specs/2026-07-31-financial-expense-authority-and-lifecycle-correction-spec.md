# 个人支出事实权威与人生阶段生命周期修正 Spec

## 1. 文档状态

- 状态：审查修订完成，可进入 Phase 0
- 规格日期：2026-07-31
- 目标分支：`codex/financial-wealth-trust-upgrade`
- 代码基线：`16a5ad75bd96d407f3075f1255ad6f047cb1589d`
- 上游基线：债务生产线已合入的 `origin/main@4b2309a`
- 前置能力：节点 `FinancialDomainPreview`、`FinancialNodeAcceptanceGate`、权威 `FinancialLedger v3`、职业收入原子提交、债务生命周期和账本派生财富属性
- 修正范围：取代 `2026-07-31-financial-wealth-trust-upgrade-spec.md` 中尚未完成的“支出生命周期”设计；原 Spec 的 Preview、接受门和财富派生部分继续有效
- 冲突优先级：旧 Spec 中任何与本 Spec 冲突的支出生命周期条款（包括正文正则直接创建 Accepted Event）均以本 Spec 为准；非支出部分仍沿用旧 Spec
- 动态证据基线：`artifacts/report-invitation-browser/2026-07-31T06-20-00+0800-financial-wealth-enforced-five-v7/`

本 Spec 解决的不是“让支出数字看起来更大”，而是个人支出事实的所有权、分类、估计方向、生命周期和验收口径。修复不得通过随机扣款、强制储蓄率、按收入比例反推消费或修改最终报告数字来完成。

## 2. 决策摘要

本轮采用以下不可逆设计决策：

1. `FinancialLedger` 继续是主角个人持续支出的唯一金额事实源；正文、关系状态和人生事件只能提出责任候选。
2. `0.35 万元/月` 只能表示成年 `basic_living` 的最低保护线，不能表示完整生活总支出，也不能覆盖更高的既有估计。
3. 未知支出金额与用于现金流结算的保守计提金额分开保存；`needs_review` 不等于 0，也不等于已知事实。
4. 住房、育儿、赡养、医疗、保险和教育使用稳定的责任账户，不继续压进单一 `basic_living`；共同生活是复核触发器，不是可与这些账户叠加的模糊消费桶。
5. 责任开始、调整、暂停和结束必须由 Accepted Event 或已接受的跨领域状态变化驱动，并与节点事务原子提交。
6. 公司办公室、工坊、仓库、员工工资和经营成本不能进入个人支出账本。
7. 支出覆盖率以独立标注的“实际责任候选”为分母；`0/0` 输出 `not_covered`，不得判定为 100%。
8. 旧聚合支出只允许原子拆分或有证据地下调，不允许被政策最低线静默替换。
9. Opening 模型不再拥有 `annualCoreExpenseWan` 的写权限；该字段只能由已接受的分类支出账户派生。
10. `mortgage_payment` 属于债务偿付，不是 `housing` 持续消费；本金和利息不得在两个领域重复计提。

## 3. 已确认问题与基线

### 3.1 v7 支出分布

五条真实 AI 浏览器路线共 114 个节点，只有 8 个不同的年化核心支出值：

| 年化核心支出 | 节点 | 占比 |
|---:|---:|---:|
| 4.2 万 | 60 | 52.63% |
| 18.6 万 | 22 | 19.30% |
| 16.2 万 | 9 | 7.89% |
| 7.32 万 | 7 | 6.14% |
| 6 万 | 6 | 5.26% |
| 2.4 万 | 4 | 3.51% |
| 18 万 | 4 | 3.51% |
| 10.44 万 | 2 | 1.75% |

Career 路线期间收入 578.9 万、支出 70.25 万，储蓄率约 87.9%；Venture 路线期间收入 1306.1352 万、支出 254.3 万，储蓄率约 80.5%。算术闭合，但支出输入明显缺少分辨力。

### 3.2 已确认的错误链路

四条成年路线的 opening `annualCoreExpenseWan=18` 被迁移成：

```text
legacy_core_expense
monthlyAmountWan = 1.5
factStatus = estimated
evidence = legacy_migration@0.5
```

第一次期间提交时，当前策略把所有 `legacy_migration + estimated` 视为政策管理基线。只要金额与成年人政策值不同，就结束原账户并创建：

```text
estimated_basic_living_v1
monthlyAmountWan = 0.35
factStatus = estimated
evidence = system_policy
```

这一行为把“最低保护线”错误实现成“标准替换值”。它不检查方向、不要求生活成本下降证据，也不摄取首节点正文已经出现的房租、医疗或家庭转账。

### 3.3 生命周期覆盖是假绿

v7 只有 1 个 `expenseLifecycleTrigger`，来源是：

> 你租下了一间 50 平米的独立工坊。

系统将工坊误判为个人住房，建立 `housing + financialScope=personal` 账户。与此同时，真实存在的同居、共同租房、每月给父母转账、高龄照护和护工支出大量未进入触发分母。

当前指标：

```text
detected triggers → 自动建账 → coveredTriggerCount = triggerCount
```

只能衡量“检测到以后有没有处理”，不能衡量检测召回率；零触发时直接返回 100%，属于空样本通过。

### 3.4 根因

1. **政策语义错误**：最低线、上下文估计、已知金额和当前计提金额共用一个 `monthlyAmountWan`。
2. **迁移语义错误**：所有 legacy estimate 被视为可由政策重置的同一种账户。
3. **触发来源错误**：人生责任主要从少量正文正则推断，没有优先使用已接受的关系、人物、职业、健康和居住状态变化。
4. **范围分类滞后**：先识别“租下”，后判断个人/家庭/公司，导致工坊进入个人住房。
5. **验收分母错误**：检测器既生成分母又生成分子，无法发现漏检和误报。
6. **不确定性方向不对称**：收入可按既有来源持续计提，支出不确定时却被压到最低线，形成长期单向财富偏差。
7. **Opening Prompt 数值锚定**：当前严格 JSON 示例固定写入 `annualCoreExpenseWan: 18`，模型容易把示例值复制到不同人物；该值随后又被当成 `legacy_core_expense` 迁移，形成跨路线同值聚集。
8. **债务与住房别名冲突**：当前 proposal normalizer 将 `mortgage_payment` 和包含“月供”的文本归为 `housing`，而债务策略也会处理房贷偿付，存在本金/利息重复计提和错误结束住房账户的风险。

## 4. 目标与非目标

### 4.1 产品目标

- 不同住房、家庭、照护、医疗和退休路径形成可解释且不同的持续支出结构。
- 用户能够追溯每个持续支出的责任对象、个人承担比例、事实来源和复核状态。
- 未知信息保留为不确定事实，但不会因为未知而把支出当成 0 或最低总支出。
- 长期现金和净资产变化来自实际账户与责任，不来自人为压储蓄率。

### 4.2 工程目标

- 建立 `ExpenseCommitment v4` 的责任身份、范围、金额依据和复核时钟。
- 建立跨 `WorldState → ExpenseResponsibilityCandidate → AcceptedFinancialEvent` 的单向协议。
- 实现 opening 分项事实、legacy 聚合拆分、禁止无证据向下覆盖和定期复核。
- 实现个人、共同家庭、第三方和企业经营范围校验。
- 将支出候选检测、账户覆盖、误报、漏检、范围冲突和过期账户纳入 CI 与真实路线审计。

### 4.3 非目标

- 不建立配偶、父母、子女或公司的完整复式账本。
- 不接入实时城市物价、CPI、房租或保险报价。
- 不根据收入强制消费升级，也不把储蓄率限制在某个目标区间。
- 不自动重写已经完成的历史节点和历史现金；迁移只影响迁移点之后的权威演进。
- 不把订婚、恋爱、讨论结婚或计划要孩子自动视为已经发生的财务责任。
- 不因年龄自动假定父母需要赡养、子女已经独立或退休必然增加医疗费。

## 5. 核心原则

### 5.1 事实所有权

| 事实 | 唯一权威来源 | 财务消费方式 |
|---|---|---|
| 关系阶段、是否共同生活 | `RelationshipState` | 产生责任候选，不直接写金额 |
| 父母/子女人物与状态 | `PersonState`、`FamilyRelationshipState` | 产生责任候选，不直接写金额 |
| 就业与退休 | `CareerState` | 触发支出复核，不直接覆盖支出 |
| 已发生的健康责任 | 已接受健康状态或 Accepted Outcome | 产生医疗责任候选 |
| 居住变化 | 已接受 `WorldDelta`、房产/租房 Accepted Event | 产生住房责任候选 |
| 主角承担的持续金额 | `ExpenseCommitment` | 期间自动结算 |
| 本期支出变化 | `AcceptedFinancialEvent[]` | 原子提交到 Ledger |
| 正文 | 派生叙事与证据 | 不能单独成为 `known` 金额 |
| `annualCoreExpenseWan` | 由 active `ExpenseCommitment` 派生 | 只读兼容字段，模型和 UI 均无写权限 |

### 5.2 个人边界

个人账本只记录主角实际承担的部分：

- 共同租金 5200 元、明确各付一半，主角 `monthlyAmountWan=0.26`；不得同时保存并计提 0.52。
- 配偶承担的部分不进入主角账本。
- 父母医疗、孩子学费只有主角实际支付、共同负责或承诺持续支付时才进入。
- 工坊、办公室、仓库、服务器、员工工资、推广等一律属于 `business_operating`；除非正文明确主角用个人现金代付且该代付形成个人一次性支出或对企业的个人投入，否则不得创建个人持续支出。
- 房贷月供必须路由到 `DebtRepaymentPolicy` 和债务事件；其中本金、利息均不再作为 `housing ExpenseCommitment` 计提。物业、房租、住房维护等非债务成本才属于 `housing`。

各账户的消费边界必须互斥：

| 类型 | 包含 | 明确排除 |
|---|---|---|
| `basic_living` | 主角个人餐食、日用品、通勤、通信及普通水电等基础日常 | 房租、房贷、照护、医疗、保险、教育 |
| `housing` | 主角承担的房租、物业、非资本化维护及居住服务 | 房贷本金、利息、企业场地、配偶份额 |
| `dependent_support` | 主角承担的育儿、父母生活支持、护工和非医疗照护 | 已单列医疗、教育、配偶个人消费 |
| `healthcare` | 主角实际承担的本人或受抚养人持续治疗、药物和复诊 | 已由保险或第三方支付部分 |
| `insurance` | 主角实际承担的持续保费 | 社保已从税后收入扣除部分、保险理赔 |
| `education` | 主角实际承担的本人或受抚养人持续学费及项目费用 | 企业培训、奖学金或第三方承担部分 |

同一金额事实只能分配一次。若“每月给父母 4000，其中医疗 3000、生活费 1000”，应分配为 `healthcare 0.3 + dependent_support 0.1`，不能把总额 0.4 再与两个分项叠加。无法确认总额与分项关系时进入 review，保留单一聚合计提。

### 5.3 不确定不是零

- 正向资产不确定时不计入确定财富上界。
- 负向持续支出不确定时，使用版本化、非零、可解释的保守计提值。
- 对 expense，`conservative` 表示在版本化 policy 允许范围内不低估现金流出；使用 policy base，而不是 range 下界，也不得为了压低财富任意取上界。
- 保守计提值是现金流计算输入，不冒充已知事实；UI、Prompt 和审计必须显示 `needs_review`。
- 责任存在但金额未知，禁止 `monthlyAmountWan=0`。
- 责任是否存在也未知时，不得凭年龄创建确定账户；应先创建候选或 review issue。

### 5.4 最低线只能向上保护

`F` 只表示 `adult_basic_living` 的政策最低线。设该责任当前有效计提金额为 `A`：

```text
仅当 responsibilityKind = adult_basic_living：
  无新的 Accepted 调整/结束事实时，A' = max(A, basicLivingFloor)

其他既有责任：
  无新的 Accepted 调整/结束事实时，A' = A

其他新出现但金额未知的责任：
  使用对应 responsibility policy 的 base estimate，不使用 basicLivingFloor
```

以下行为全部禁止：

- 因 `A !== F` 将 `A` 替换成 `F`；
- 因就业、退休或年龄档位变化删除住房、抚养、医疗等独立责任；
- 因模型本节点没有再次提及而结束或降低已有责任；
- 用新的低置信度估计覆盖更高置信度或更高金额的既有责任。

允许降低的唯一条件：

1. 已接受的明确金额调整，且证据说明主角承担额已经下降；
2. 已接受的责任结束或范围变化；
3. 原账户是聚合迁移值，被原子拆分为分类账户，且拆分后总额不低于拆分前；如需降低总额，仍必须满足 1 或 2。

### 5.5 不以结果倒推支出

支出估计不得读取或优化：

- 目标储蓄率；
- 当前净资产是否“太高”；
- 财富属性目标分；
- 最终报告期望结论；
- 为避免负现金而随意降低生活成本。

现金不足继续使用既有流动性、短缺债和债务困境协议，不篡改支出事实。

## 6. 领域模型

### 6.1 `FinancialLedger v4`

新增 Ledger v4；债务 v3 字段原样保留。`ExpenseCommitment` 扩展为：

```ts
export type ExpenseCommitmentType =
  | "basic_living"
  | "housing"
  | "dependent_support"
  | "education"
  | "healthcare"
  | "insurance"
  | "other";

export type ExpenseResponsibilityKind =
  | "adult_basic_living"
  | "primary_residence"
  | "child_support"
  | "elder_care"
  | "recurring_healthcare"
  | "personal_insurance"
  | "continuing_education"
  | "legacy_aggregate";

export type ExpenseAmountBasis =
  | "explicit_known"
  | "explicit_shared_amount"
  | "last_known"
  | "contextual_estimate"
  | "policy_floor"
  | "legacy_estimate";

export type FinancialScopeV4 =
  | "personal"
  | "shared_household"
  | "business_operating"
  | "third_party";

export interface ExpenseCommitment {
  id: string;
  responsibilityKey: string;          // 稳定、可幂等，例如 primary_residence:main
  responsibilityKind: ExpenseResponsibilityKind;
  type: ExpenseCommitmentType;
  displayName: string;

  // monthlyAmountWan 始终表示主角个人实际计提份额。
  monthlyAmountWan: number;
  grossMonthlyAmountWan?: number;      // 家庭/合同总额，仅用于份额校验，不直接计提
  confirmedMonthlyAmountWan?: number; // 已确认的主角份额
  plausibleMonthlyAmountRangeWan?: [number, number];
  amountBasis: ExpenseAmountBasis;
  amountSourceIds: string[];          // 可审计金额事实/政策分配 ID，用于跨账户去重
  estimationPolicyId?: string;

  financialScope: "personal" | "shared_household";
  participantPersonIds?: string[];
  householdShareRate?: number;

  activeFromAgeInMonths: number;
  activeUntilAgeInMonths?: number;
  status: "active" | "paused" | "ended";
  factStatus: FinancialFactStatus;
  accrualReviewStatus: "normal" | "conservative" | "review_due";
  lastConfirmedAtAgeInMonths?: number;
  lastReviewedAtAgeInMonths?: number;
  nextReviewAtAgeInMonths?: number;
  evidence: FinancialEvidence[];
}
```

约束：

- `monthlyAmountWan` 不得为负；所有 active 责任必须大于 0，0 金额不得以 active commitment 占位。
- `monthlyAmountWan` 永远是主角个人份额。存在 `grossMonthlyAmountWan` 与 `householdShareRate` 时，必须满足 `monthlyAmountWan = grossMonthlyAmountWan × householdShareRate`（允许统一的金额舍入误差）。
- `explicit_known` / `explicit_shared_amount` 必须同时存在 `confirmedMonthlyAmountWan`、个人承担证据和 `lastConfirmedAtAgeInMonths`。
- `explicit_known` / `explicit_shared_amount` 必须具有稳定 `amountSourceIds`；同一 source 的分配总额不得超过其主角应承担额。
- `explicit_shared_amount` 必须保存主角份额；`householdShareRate` 已知时必须满足金额关系。
- `contextual_estimate`、`policy_floor`、`legacy_estimate` 必须保存 `estimationPolicyId` 或迁移 reason code。
- V4 同步把 `FinancialEvidence.financialScope` 扩展为 `FinancialScopeV4`，候选和证据可表达企业/第三方，但 committed `ExpenseCommitment.financialScope` 只允许 personal/shared household。
- committed commitment 不允许 `business_operating` 或 `third_party`；此类事实在进入 Ledger 前必须被拒绝或路由到相应领域。
- 同一 `responsibilityKey` 同时最多一个 active 账户。
- 账户单例约束不得按 `type` 实现；两个子女、两位父母、多个保单或多个教育项目必须允许各自拥有不同的 active `responsibilityKey`。
- `basic_living` 和 `primary_residence` 分开；房租、物业和住房维护不得藏进基本生活费。

### 6.2 责任候选

```ts
export interface ExpenseResponsibilityCandidate {
  id: string;
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  action: "start" | "adjust" | "end" | "review";
  completion: "completed" | "ongoing" | "planned" | "hypothetical";
  cadence: "one_off" | "monthly" | "quarterly" | "annual" | "recurring_unknown";
  liability: "protagonist" | "shared" | "third_party" | "none" | "unknown";
  financialScope: "personal" | "shared_household" | "business_operating" | "third_party";
  explicitMonthlyTotalWan?: number;
  protagonistShareWan?: number;
  shareRate?: number;
  amountSourceId?: string;
  participantPersonIds: string[];
  source: "user_fact" | "accepted_world_delta" | "accepted_outcome" | "narrative_supplement" | "scheduled_review";
  evidence: FinancialEvidence[];
}
```

候选不是账本事实。只有完成状态、主角责任和范围校验通过后，才能被转为 Accepted Event。

`ExpenseCommitment` 只承载持续责任：季度/年度已知金额按主角份额确定性折算为月均计提，并保留原频率证据；一次性学费、押金、手术费或个人代付必须路由到 one-off cash event，不能误建成永久 commitment。无法判断是否持续时进入 review，不能默认“每月”。

### 6.3 估计策略返回值

```ts
export interface ExpenseEstimate {
  accrualMonthlyAmountWan: number;
  plausibleRangeWan: [number, number];
  policyId: string;
  policyVersion: number;
  reasonCodes: string[];
  inputs: {
    ageBand: string;
    lifeStage: LifeStage;
    livingArrangement: "with_family" | "renting" | "owner_occupied" | "provided" | "unknown";
    householdSize?: number;
    cityCostBand?: "low" | "medium" | "high" | "unknown";
    responsibilityKind: ExpenseResponsibilityKind;
  };
}
```

策略要求：

- 相同输入与 policy version 必须得到相同结果。
- `0.35` 可以继续作为成年非住房 `basic_living` 的最低线，但不能代表住房、赡养、医疗、保险和教育。
- 独立居住且住房金额未知时，必须存在独立的非零 `housing needs_review`；不能假设住房免费。
- `livingArrangement=with_family/provided` 允许住房个人份额为 0，但必须有已接受状态证据，不能仅因缺少租房文字推断。
- 不允许用收入百分比、目标储蓄率或净资产反推估计值。
- 第一版具体金额表必须放在版本化配置并由产品/数据验收，不继续散落在 reducer 中。

### 6.4 估计配置与选值规则

新增版本化配置 `expense-estimation-policy-v2`。每个配置项必须包含 `responsibilityKind`、适用的人生/居住/城市成本档、`baseMonthlyAmountWan`、`plausibleRangeWan`、来源说明、批准日期和 policy version；不允许只留一个无来源的魔法常量。

选值顺序固定为：

1. 明确的主角个人金额；
2. 明确总额乘以主角份额；
3. 同一责任的上次已知/当前计提值；
4. 当前上下文命中的 policy base estimate；
5. 仅对 `adult_basic_living` 使用 policy floor。

新增未知责任时，账本使用 base estimate，不使用 plausible range 的下界；范围仅供 UI、审计和敏感性分析。城市成本档未知时使用 `medium`，不能自动落到 `low`。找不到适用配置时产生 `EXPENSE_ESTIMATION_POLICY_MISSING`，enforced 模式拒绝节点，禁止回落为 0 或复用 0.35。

`FinancialFactStatus` 语义同时收紧：责任存在且金额待确认使用 `needs_review`；责任是否存在也未知时只保留 candidate/issue，不创建 active `unknown` 账户。估计配置升级只产生 review/adjust proposal；除 `basic_living` 最低线向上保护外，不得因配置版本变化静默改写已提交金额，尤其不得自动下调。

首版配置发布前必须附一份校准备忘录，列出各档输入依据、典型人物和 low/base/high 敏感性结果。真实路线的储蓄率只能用于发现配置失真，不能反向成为选值公式。

## 7. 写入流水线与原子性

### 7.1 节点顺序

```text
候选正文 + 模型 Proposal + 候选跨领域状态变化
        ↓
验证 Career / Relationship / Family / Health / Location proposals
        ↓
Preview Candidate WorldState（不提交）
        ↓
current WorldState → candidate WorldState 的责任差异
        + 明确 Financial Proposal
        + 正文补充候选
        + 到期复核候选
        ↓
classifyExpenseResponsibilityCandidates()
        ↓
reconcileExpenseCommitments()
        ↓
AcceptedFinancialEvent[] / review issues / rejection reasons
        ↓
FinancialDomainPreview（包含期间结算）
        ↓
FinancialNodeAcceptanceGate
        ↓
唯一原子 commit：WorldState + Ledger + History + Timeline
```

财务不得读取“已经提交的下一节点关系状态”再补一次账。候选 WorldState 和候选 Ledger 必须在同一个 Preview 中计算，在 gate 通过后一次提交。

### 7.2 来源优先级

从高到低：

1. 用户明确金额与责任；
2. 已接受历史中的 known 账户；
3. 当前节点已完成、主角明确承担且金额明确的 Accepted Outcome / Financial Proposal；
4. 已接受的结构化 WorldState 差异；
5. 版本化 contextual estimate；
6. policy floor；
7. 未经结构化确认的正文补充候选。

低优先级来源不得覆盖高优先级金额。正文补充候选可以触发 `needs_review`，但不能把金额直接标记为 `known`。

### 7.3 幂等键

责任键必须稳定：

```text
adult_basic_living:protagonist
primary_residence:main
child_support:<personId>
elder_care:<personId>
recurring_healthcare:<personId-or-protagonist>
personal_insurance:<policy-or-protagonist>
continuing_education:<programId>
legacy_aggregate:<migrationAge>
```

重试相同节点不得新增第二个责任账户或重复本期计提。

## 8. 责任识别规则

### 8.1 必须优先使用结构化状态

| 结构化变化 | 候选责任 | 默认动作 |
|---|---|---|
| `RelationshipState.livingTogether: false/undefined → true` | 复核 `adult_basic_living` 和 `primary_residence` | review，不自动叠加新消费桶 |
| 浪漫关系进入 `cohabiting` 或 `married` 且确认共同居住 | 复核个人份额、家庭人数和 `primary_residence` | review |
| 已接受租房/入住/购房居住变化 | `primary_residence` | start/adjust |
| 新增主角子女，且主角承担抚养 | `child_support:<personId>` | start |
| 父母状态进入受限且主角承担持续支付/照护 | `elder_care:<personId>` | start/review |
| 主角形成长期治疗、持续用药或定期复诊 | `recurring_healthcare:protagonist` | start/adjust |
| 主角购买持续保险 | `personal_insurance:<id>` | start |
| 主角开始持续教育并承担费用 | `continuing_education:<id>` | start |
| Career 进入 `retired/not_working` | 所有生活责任 | review，不自动降低或结束 |
| 搬家、家庭规模或共同承担比例变化 | 相关现有责任 | adjust/review |

结婚本身不证明支出一定增加；它触发家庭和住房责任复核。只有共同居住、实际支付或可审计的保守未知责任进入计提。

### 8.2 正文补充识别

正文识别必须按以下顺序：

1. 主语：主角、共同家庭、第三方或公司；
2. 状态：已发生、持续发生、计划、假设或引用历史；
3. 范围：个人、共同家庭、企业经营或第三方；
4. 责任对象：住房、孩子、父母、本人健康、保险或教育；
5. 金额与份额：总额、主角份额、频率和生效时间。

先分类范围，再匹配“租下”“支付”等动词。出现以下经营语义时，禁止建立个人 housing：

```text
工坊、工作室、办公室、仓库、厂房、门店、服务器、团队、员工、原材料、推广、公司租金
```

单纯扩充正则不是完成条件；结构化状态差异必须是主路径，正则仅补充漏掉的候选和证据。

### 8.3 计划与他人责任

以下只记录叙事，不启动账户：

- “计划明年结婚/要孩子”；
- “考虑租房/买房”；
- “父母需要医疗”但没有主角承担证据；
- “配偶每月支付房租”；
- “公司每月支付办公室租金”；
- 选项中未被选择的支出结果。

如果责任已发生但主角是否承担未知，生成 `EXPENSE_RESPONSIBILITY_OWNER_NEEDS_REVIEW`，不得直接计入个人账本。

## 9. Opening 支出协议

### 9.1 模型输出与兼容字段

Opening 的金额协议改为：

```text
用户原始资料 / 结构化回答
        ↓ deterministic extraction
OpeningExpenseFact[]
        ↓ validate + estimate missing responsibilities
Accepted expense events
        ↓ commit
ExpenseCommitment[]
        ↓ derive
initialFinancialState.annualCoreExpenseWan
```

- 删除 strict JSON 示例中的固定 `annualCoreExpenseWan: 18`、`annualDisposableIncomeWan: 12`；兼容字段统一示例为 0，ingest 忽略模型值，并在 commit 后分别由账户总额及收入减支出派生。`annualAfterTaxIncomeWan` 继续遵守既有 opening 收入权威协议，不在本 Spec 中改写。
- 兼容期内模型仍可返回 `initialFinancialState.annualCoreExpenseWan`，但 ingest 必须忽略其金额，不得据此创建 `legacy_core_expense`、`known` 或 `estimated` 账户。
- 新模型协议输出可选的分类 `openingExpenseProposals[]`，每项必须携带 type、频率、主角份额、事实状态和证据；这些仍是 Proposal，必须经过 validator 和 gate。
- 模型正文自行补充的金额不得因出现在首节点而升级为用户事实；无结构化 Proposal 时只进入补充候选或 review issue。
- Opening 页面、首节点 Prompt 和后续 Prompt 读取的 `annualCoreExpenseWan` 必须来自 committed accounts，不得回读模型原始聚合值。
- Opening 也必须执行 schema → expense reconciliation → FinancialDomainPreview → acceptance gate；失败时不得先持久化 start node、opening ledger 或首段时间线，再依赖 sanitizer 删除不一致正文。

### 9.2 分项提取

新增 `OpeningExpenseFact[]`，确定性提取：

- 总生活费；
- 房租、物业和个人承担比例；
- 父母/子女持续转账；
- 持续医疗和用药；
- 保险；
- 教育；
- 原始频率和是否一次性；
- 已知房贷月供只形成或调整 Debt repayment proposal；禁止通过 `mortgage_payment → housing` 别名进入 ExpenseCommitment。
- “月供”不能再被纯文本兜底规则归为 housing；只有房租、物业、住房维护等非债务住房成本才可归为 housing。

同一句存在多个分项时分别建账并求和。例如：

```text
房租 5000 + 父母医疗 3000
→ housing 0.5 + healthcare 0.3
```

只有用户输入、已接受历史或合法 opening Accepted Event 可以成为 `known`。首节点模型自行生成的金额必须同时提交结构化 Proposal；否则正文金额应被降级或账户标记为 `estimated/needs_review`。

### 9.3 聚合与分项去重

如果 opening 同时存在总额和分项：

- `coverage=fully_covers`：总额证据明确覆盖全部个人核心支出，分项是总额内部结构，不得再次叠加总额；
- `coverage=disjoint`：总额明确只覆盖 basic living，住房、赡养、医疗等独立分项继续相加；
- `coverage=unknown`：无法判断覆盖关系时保留一个 `legacy_aggregate needs_review`，并生成 `EXPENSE_OPENING_COMPONENT_GAP`；不允许同时激活 aggregate 和分项账户。

### 9.4 Legacy 聚合拆分

设聚合月额为 `P`、已确认非 basic 分项的主角份额合计为 `T`、适用 basic floor 为 `F`。必须先判定覆盖关系，再计算计提：

```text
if coverage == fully_covers:
  targetTotal = max(P, T + F)
  basicLiving = targetTotal - T
  end aggregate; activate components + residual basicLiving

elif coverage == disjoint:
  basicLiving = max(P, F)
  targetTotal = basicLiving + T
  end aggregate; activate components + basicLiving

elif coverage == unknown:
  aggregateAccrual = max(P, T, F)
  keep exactly one active legacy_aggregate needs_review
  keep components as non-accruing candidates/evidence only
  emit EXPENSE_OPENING_COMPONENT_GAP
```

`coverage=unknown` 时禁止运行前两个拆分公式；`max(P, T, F)` 是一个账户的单一计提值，不是 aggregate 与 components 的合计。待覆盖关系确认后再原子拆分，避免因猜测“已包含”或“互不重叠”造成低估或双重计提。

只有 `fully_covers` 或 `disjoint` 才允许把聚合值拆成分类账户集合 `C`，并且必须同一事务：

```text
end legacy_aggregate
start/adjust component commitments
assert Σ component monthly accrual >= P
```

没有支出下降证据时，不满足总额守恒的拆分必须被 gate 拒绝。

## 10. 生命周期状态机

### 10.1 状态

```text
candidate
   ├─ planned/hypothetical/third_party/business → ignored_with_reason
   ├─ owner unknown → review_issue
   └─ completed + personal/shared
          ↓
       active_known / active_estimated / active_needs_review
          ├─ accepted adjustment → active_*
          ├─ review due → active_needs_review（继续原计提，不归零）
          ├─ accepted pause → paused
          └─ accepted end → ended
```

`paused` 的语义固定为：

- 暂停期间不参与期间支出计提，也不计入 `annualCoreExpenseWan`；账户、原金额、责任键和证据仍保留。
- pause 只允许由 Accepted fact 证明“责任仍存在，但付款暂时停止或暂由他方承担”；现金不足、失业、模型未再次提及或单纯时间经过不能触发 pause。
- pause/resume 使用 `expense_commitment_adjusted` 表达 `active ↔ paused`，不得通过结束旧账户再新建账户规避责任幂等。
- paused 账户继续运行复核时钟；到期产生稳定 review issue，但在恢复 active 前不计提。
- `ended` 表示责任已经终止或永久转移，必须满足第 10.3 节的结束证据；它与临时 pause 不可互换。

### 10.2 复核时钟

- 不同责任使用不同的最长未确认周期：

| 责任 | 最长未确认期 | 提前复核事件 |
|---|---:|---|
| `adult_basic_living` | 60 个月 | 独立居住、共同生活、家庭人数、退休或长期失业变化 |
| `primary_residence` | 36 个月 | 搬迁、购房、退租、共同承担比例变化 |
| `child_support` | 12 个月 | 出生、入托入学、主要照护安排或承担人变化 |
| `elder_care` | 12 个月 | 健康、照护级别、护工或承担人变化 |
| `recurring_healthcare` | 12 个月 | 诊断、治疗方案、持续用药或支付方变化 |
| `personal_insurance` | 24 个月 | 投保、续保、退保、保费或受保人变化 |
| `continuing_education` | 12 个月 | 入学、续期、毕业、退学或资助变化 |
| `legacy_aggregate` | 12 个月 | 任一可拆分的分项事实出现 |

- `lastReviewedAtAgeInMonths` 只说明系统或模型完成一次复核，不能冒充金额已确认；只有新的 Accepted exact fact 才能更新 `lastConfirmedAtAgeInMonths`。
- 发生关系、住房、家庭人数、父母照护、健康、教育、就业或退休状态变化时立即提前复核。
- 到期不等于结束；继续使用上一计提金额，标记 `review_due` 并创建稳定 issue。
- 同一责任的 review issue 使用稳定 ID，重复节点只增加 `occurrenceCount`。
- 连续两个实质节点仍未复核时，下一节点 Prompt 必须显式要求确认；不能静默无限延期。

### 10.2.1 已有照护责任的证据驱动上调

`elder_care` 的普通 review 只保留原金额。只有同时满足下列全部条件时，系统才可产生一次 `increase_only` 调整：

1. 已有账户是 `active + personal + needs_review + contextual_estimate` 的父母受益人 `elder_care`；目标只能是精确相同的 `responsibilityKey`，或 canonical `elder_care:parents` aggregate，不能用唯一账户猜测母亲/父亲，更不能指向 `elder_care:care_plan`。
2. 本节点出现新的、已完成的持续照护升级事实，例如已存在“定期带父母体检”后，出现“父亲膝盖退行性变化，你每天帮他做关节康复”；事实必须同时说明父母对象、主角个人持续动作和升级/高强度上下文。
3. 没有 exact 金额、共同承担、第三方付款、暂停/结束或责任键/参与人变化；新 policy base 必须严格大于既有 `monthlyAmountWan`。

允许改变的只有 `monthlyAmountWan`、对应 policy/range metadata、复核时间和追加 evidence；账户 id、责任键、类型、scope、参与人、份额、状态、已确认金额和 `known` 事实不得改变。该事件使用专用 `expense_contextual_care_uplift` validator 约束，不能借普通 reconciliation 越权写入。

高龄本身、跨年龄档位、重复旧 evidence、父母患病但没有主角持续动作、一次理疗/探望、公司场地、共同但未分摊责任，均不得触发上调或新建账户。

### 10.3 结束规则

责任只在下列证据下结束：

- 搬离/退租且无新的住房责任；
- 主角明确不再承担该对象费用；
- 子女独立且主角持续支付已结束；
- 照护对象去世或照护责任明确转移；
- 治疗、保险或教育项目明确结束；
- 聚合账户完成原子拆分。

不得仅按年龄推断子女独立、父母去世或医疗结束。

### 10.4 下调授权

所有下调或结束事件必须保存 `previousCommitmentId`、Accepted source event、变化原因和生效年龄。允许的典型原因包括退租/搬家、共同承担比例明确变化、治疗或教育完成、保单取消、责任转移；收入下降、退休、时间经过、模型未再提及、政策版本变更都不是下调证据。

若同一节点结束旧住房并开始新住房，或结束 aggregate 并建立分项，必须在一个 Preview 中比较事务前后总计提。存在没有解释的净下降时 gate 拒绝整个节点；不得先结束旧账户、再把新账户留作下一节点补齐。

## 11. Reconciler 与 Validator

新增：

```text
src/domain/finance/
  expenseResponsibility.ts
  expenseEstimationPolicyV2.ts
  reconcileExpenseCommitments.ts
  expenseLifecycleReview.ts
  migrateFinancialLedgerV3ToV4.ts
```

职责：

- `expenseResponsibility.ts`：从结构化状态差异和补充证据产生候选；
- `expenseEstimationPolicyV2.ts`：生成可重现估计，不执行账户写入；
- `reconcileExpenseCommitments.ts`：把候选、现有账户和显式 Proposal 合并成事件计划；
- `expenseLifecycleReview.ts`：只负责到期检查和 review issue，不直接改金额或结束账户；
- `migrateFinancialLedgerV3ToV4.ts`：一次性迁移，不重写历史现金。

现有 `financialProposalSchema.ts` 必须同步升级，不能只检查 `evidence` 是数组：

- 每个 evidence 元素必须是合法 `FinancialEvidence` 对象，禁止字符串、空对象和未知 source；
- 支出对象只接受 canonical 金额字段，`monthlyNetAmountWan`、`annualNetAmountWan` 等收入字段必须拒绝，不能静默保留；
- `grossMonthlyAmountWan`、`householdShareRate` 和 `monthlyAmountWan` 必须做交叉校验；
- `responsibilityKey`、type、beneficiary/scope 组合必须合法；
- 旧 alias 只能规范同义词，不能跨领域把 debt、business 或 income 变成 expense；
- lifecycle reconciler 生成的系统 Proposal 必须经过与模型 Proposal 完全相同的 schema、scope、Preview 和 gate，不得直接拼接 `AcceptedFinancialEvent`。

Validator 新增 reason codes：

```text
EXPENSE_BASELINE_DOWNWARD_OVERWRITE
EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT
EXPENSE_BUSINESS_FLOW_IN_PERSONAL_LEDGER
EXPENSE_THIRD_PARTY_LIABILITY
EXPENSE_UNKNOWN_ZERO_AMOUNT
EXPENSE_SHARED_AMOUNT_MISMATCH
EXPENSE_DUPLICATE_RESPONSIBILITY
EXPENSE_AGGREGATE_SPLIT_LOSS
EXPENSE_END_WITHOUT_EVIDENCE
EXPENSE_REVIEW_OVERDUE
EXPENSE_OPENING_COMPONENT_GAP
EXPENSE_MODEL_AGGREGATE_NOT_AUTHORITATIVE
EXPENSE_DEBT_SERVICE_DOUBLE_COUNT
EXPENSE_ESTIMATION_POLICY_MISSING
EXPENSE_AMOUNT_SOURCE_DOUBLE_COUNT
EXPENSE_SCHEMA_FIELD_MISMATCH
```

Critical：

- 已发生、金额明确的主角持续支出被漏掉；
- 企业/第三方支出准备进入个人账本；
- 已有支出无证据向下覆盖；
- aggregate 拆分造成总计提下降；
- 责任结束缺少证据；
- shared 总额被当成主角全额计提。
- 模型聚合 `annualCoreExpenseWan` 试图直接写入账户；
- 房贷本金或利息同时进入 debt service 和 housing commitment。
- 同一总额事实被完整分配到多个账户，或分项和总额发生重复计提；
- evidence、金额字段、责任键或份额不满足 V4 schema。

Review：

- 责任明确存在但金额未知；
- 主角承担比例未知；
- 到达复核时点但没有新金额；
- opening 只有聚合支出，尚未拆分。

Critical 在 enforced 模式下拒绝整个候选节点，沿用现有“拒绝后零状态变化”契约。Review 可以 `accept_with_review`，但必须创建非零保守账户或保持上一计提金额。

## 12. 计提与派生不变量

1. `annualCoreExpenseWan = 12 × Σ active ExpenseCommitment.monthlyAmountWan`。
2. 债务本金和利息由债务策略结算，不重复进入 housing；物业、房租和非债务住房成本进入 housing。
3. 共同支出只计主角份额。
4. business operating expense 对个人核心支出的贡献必须为 0。
5. active `needs_review` 责任贡献必须大于 0。
6. review due 不停止计提。
7. 没有 Accepted downward event 时，节点结束总持续支出不得因政策轮换下降。
8. 单个责任 adjust/end 只影响该 `responsibilityKey`。
9. 同一 transaction 重放不重复开始账户或重复计提。
10. 被 gate 拒绝的候选不得改变 Ledger、WorldState、年龄、History 或 PeriodSummary。
11. 同一金额来源在所有 active commitments 中的分配总和不得超过主角应承担额。
12. 所有 committed expense 必须通过 V4 canonical schema；normalizer 不得留下收入字段、字符串 evidence 或跨领域 alias。

## 13. 审计与指标重写

### 13.1 独立真值标注

真实路线增加：

```text
expense-responsibility-annotations.json
```

每条标注至少包含：

```ts
interface ExpenseResponsibilityAnnotation {
  caseSlug: string;
  nodeIndex: number;
  evidenceExcerpt: string;
  expectedAction: "start" | "adjust" | "end" | "review" | "ignore";
  expectedType?: ExpenseCommitmentType;
  expectedScope: "personal" | "shared_household" | "business_operating" | "third_party";
  expectedResponsibilityKey?: string;
  expectedMonthlyAmountWan?: number;
  expectedShareRate?: number;
  material: boolean;
  reviewer: "human";
}
```

标注不能由被测 detector 自动生成。审计脚本将标注与 committed events/accounts 对齐。

precision/recall 的最小对齐单位固定为 `(caseSlug, nodeIndex, responsibilityKey, action, financialScope)`；类型、个人份额和金额容差作为同一对齐记录的附加正确性条件。不得按“正文里出现过相似词”或自由文本句子数计算 TP。

### 13.2 发布指标

旧 `adultResponsibilityExpenseCoverageRatePct` 废弃。若为一个兼容周期保留，必须重命名为 `machineDetectedResponsibilityHandlingRatePct`，只表示 detector 命中后的处理率，不能参与发布结论；任何报告不得再把它称作“正文责任覆盖率”。

验收分两层：

- **封闭门禁层**：确定性单测和冻结、人工标注的定向 gold corpus。样本与期望固定，precision/recall 必须 100%。
- **开放诊断层**：每次全新生成的 2/2/1 五路线。仍计算并报告 precision/recall，但本 Spec 不预设 recall 阈值，也不以它单独阻断发布；scope mismatch、无证据降额、双重计提等确定性不变量仍必须为 0。

| 指标 | 定义 | 发布要求 |
|---|---|---:|
| `expenseResponsibilityAnnotatedCandidateCount` | 人工标注的 material 已发生责任数 | 定向 gold corpus 必须非零 |
| `expenseResponsibilityTruePositiveCount` | 正确 key、范围、动作和节点覆盖数 | 定向 gold corpus 等于候选数 |
| `expenseResponsibilityMissedCount` | 有标注但无对应事件/账户 | 定向 gold corpus 为 0；新鲜五路线仅诊断 |
| `expenseResponsibilityFalsePositiveCount` | 无责任却创建个人账户 | 0 |
| `expenseResponsibilityScopeMismatchCount` | 公司/第三方误入个人 | 0 |
| `expenseSharedAmountMismatchCount` | 总额与个人份额不一致 | 0 |
| `expenseBaselineDownwardOverwriteCount` | 无下降证据却降低持续支出 | 0 |
| `expenseUnknownZeroCount` | 已存在未知责任以 0 计提 | 0 |
| `staleExpenseWithoutReviewCount` | 到期未复核也无 issue | 0 |
| `expenseAggregateSplitLossCount` | 拆分后无证据下降 | 0 |
| `expenseAmountSourceDoubleCount` | 同一金额事实被总额/分项或跨类型重复计提 | 0 |
| `mortgageExpenseDoubleCountCount` | 房贷同时进入 debt service 与 housing | 0 |
| `explicitRecurringExpenseCoveragePct` | 人工标注明确金额责任的正确入账率 | 定向 gold corpus 100%，且分母非零 |
| `adultBaselineOnlyAfterResponsibilityCount` | 已有家庭/住房/医疗责任却只剩 basic floor | 0 |
| `expenseResponsibilityPrecisionPct` | TP / 自动正例 | 定向 gold corpus 100%；新鲜五路线仅诊断 |
| `expenseResponsibilityRecallPct` | TP / 人工 material 候选 | 定向 gold corpus 100%；新鲜五路线仅诊断 |

分母为 0 时：

```text
rate = null
status = not_covered
```

不得输出 100%。封闭定向 gold corpus 出现该状态时不满足发布门禁；新鲜五路线出现该状态时保留为诊断结果，不据此宣称已覆盖，也不单独形成 recall 阻断。

### 13.3 诊断指标

以下只用于发现偏差，不用于人为调账：

- 年化核心支出值的节点分布和集中度；
- 只使用 basic floor 的连续月数；
- `systemFloorOnlyAdultMonths` 与 `maxSystemFloorOnlyStreakMonths`；
- 按路线累计收入、核心支出、其他支出和储蓄率；
- `estimated/needs_review/known` 支出占比；
- 每种责任类型的触发、调整和结束次数；
- 超过各责任类型最长未确认期的账户数。

储蓄率过高是调查信号，不是直接拒绝或自动增加支出的规则。

## 14. 数据迁移

### 14.1 V3 → V4

- `known` 分类支出保留原金额和生效时间，补稳定 `responsibilityKey`。
- `system_policy basic_living` 保留原计提金额，标记 `policy_floor`，按 basic_living 的 60 个月上限设置复核；生活状态变化仍可提前触发。
- `legacy_core_expense` 转成 `legacy_aggregate + legacy_estimate + needs_review`，保留原金额；不得立即变成 0.35。
- 已有 housing、dependent、healthcare、insurance、education 根据证据补责任对象和范围；无法确定时保持计提并进入 review。
- 迁移识别历史 `mortgage_payment`/“月供” housing：若存在对应 active mortgage 及 repayment policy，则在迁移点结束重复的 expense commitment，并记录显式 migration correction；不回写历史现金。找不到对应债务时标记冲突并阻断 V4 启用，不能擅自丢弃可能真实的住房支出。
- 检测到工坊、办公室、仓库等经营证据的个人 housing 标记迁移冲突，禁止未来计提；历史现金修正必须使用显式 correction transaction，不能静默改旧余额。

### 14.2 不回写旧历史

- 已完成历史节点保持原快照。
- 从 V4 迁移点开始使用新账本。
- 迁移发现历史低估时，不补扣几十年现金；只在当前年龄建立 prospective 责任并记录 `priorFactCorrection`/migration issue 的解释边界。
- 回溯到 V3 节点后按同一确定性迁移产生新的分支，不读取未来 V4 状态。

### 14.3 兼容读取

- `FinancialState.annualCoreExpenseWan` 继续从 V4 commitments 派生。
- 模型返回的 opening `annualCoreExpenseWan` 仅做旧 schema 兼容解析，值必须丢弃；不得迁移为 V4 commitment。
- Prompt、UI 和报告可以读取分类摘要，但不得直接写入账户。
- V3 兼容读取保留一个发布周期；所有新节点只写 V4。

## 15. 分阶段开发

### Phase 0：阻止继续低估

- 修复 policy rotation：只对 `adult_basic_living` 使用 `max(existing, basicLivingFloor)`；Phase 0 的全部安全修正不受 `expenseLifecycleMode` 控制，始终生效；
- 删除或改写“legacy estimated 必须替换成 0.35”的测试；
- 移除 Opening Prompt 中固定 18 万支出示例的业务语义，禁止模型聚合字段写账；
- 删除 `mortgage_payment → housing` 和“月供 → housing”的 alias/文本兜底，改为债务 proposal 路由；
- 新增 baseline downward overwrite invariant 和审计；
- 保证现有债务、收入、接受门行为不回退。

### Phase 1：V4 模型与 opening 分项

- 扩展 ExpenseCommitment；
- 实现 V3 → V4 迁移；
- 实现 opening 分项抽取、共享份额和聚合去重；
- Prompt 输出分类支出摘要。

### Phase 2：结构化责任候选

- 接入 RelationshipState、FamilyRelationshipState、PersonState、CareerState、Health/Location WorldDelta；
- 正文 detector 降级为补充候选；
- 先完成 scope 分类，再创建事件；
- 与 FinancialDomainPreview 和 gate 原子集成。

### Phase 3：复核与结束

- 实现第 10.2 节的分类复核时钟；
- 实现稳定 review issue；
- 实现责任 adjust/pause/end；
- 到期继续计提，不归零、不静默延期。

### Phase 4：shadow

- `expenseLifecycleMode=shadow` 计算 V4 候选、事件计划和账本差异，但不改变权威账本；
- 输出每个 candidate、scope、action、金额依据、人工标签和是否误报/漏报；
- shadow 与 enforced 必须调用同一个 V4 evaluator；仅“是否执行其 disposition”不同。

| 模式 | V4 支出判定 | Critical 行为 | 权威提交 |
|---|---|---|---|
| `off` | 不运行新 lifecycle reconciler | 不产生 V4 lifecycle disposition | 当前权威路径照常提交；Phase 0 安全修正仍生效 |
| `shadow` | 完整运行并记录 wouldBlock/diff | 不因 V4 支出 Critical 阻断；现有非支出 gate 仍照常执行 | V4 preview/event plan 不写入；当前权威路径照常提交 |
| `enforced` | 完整运行 | V4 支出 Critical 拒绝整个候选节点 | 零账本提交、零 WorldState/History 变化、零时间推进、零期间计提 |

### Phase 5：enforced 与发布

- 先通过定向责任语料，再切 `enforced`；
- 运行全量静态门禁、全新 2/2/1 五路线和定向支出路线；
- 所有新旧生产阻断项通过后才能合并。

### 实现影响面

| 现有/新增模块 | 必须完成的改动 |
|---|---|
| `src/domain/finance/types.ts` | Ledger v4、责任键、主角份额、金额依据、复核时钟与严格 evidence 类型 |
| `src/domain/finance/financialProposalSchema.ts` | V4 schema、active 正金额、份额交叉校验、拒绝 income 字段和非法 evidence |
| `src/domain/finance/normalizeFinancialProposals.ts` | 删除 mortgage/月供到 housing 的跨域 alias；只做同域规范化 |
| `src/domain/finance/financialEstimationPolicy.ts` | 保留 basic floor；调用 V2 版本化责任估计配置，不再返回完整生活替换值 |
| `src/domain/finance/commitFinancialDomainTransaction.ts` | 删除无方向 policy rotation；接收 reconciler 的已验证事件，保持单一 commit |
| `src/domain/finance/openingFinancialFacts.ts` | 生成 `OpeningExpenseFact[]`、分项、频率、主角份额和 aggregate 覆盖关系 |
| `src/domain/finance/migrateLegacyFinancialState.ts` | 不再信任模型 aggregate；委托幂等 V3→V4 迁移并处理历史重复月供 |
| `src/domain/finance/lifeStageExpenseLifecycle.ts` | 降级为正文补充候选；移除正则直接生成 Accepted Event 的能力 |
| 新增 `expenseResponsibility.ts` | 从 current/candidate WorldState 差异生成结构化责任候选 |
| 新增 `expenseEstimationPolicyV2.ts` | 加载、校验和执行版本化 policy config |
| 新增 `reconcileExpenseCommitments.ts` | 来源优先级、责任匹配、份额、去重、调整/结束和 review 计划 |
| 新增 `expenseLifecycleReview.ts` | 分类时钟与稳定 issue；不得直接改金额或结束账户 |
| 新增 `migrateFinancialLedgerV3ToV4.ts` | 前向、幂等、非回写迁移 |
| `src/domain/finance/financialNodeAcceptanceGate.ts` | exact 缺失、无证据降额、scope、schema 和双重计提进入 gate disposition |
| `src/services/simulation/prompts.ts` | 移除固定 18/12 锚点；只呈现 committed 分类摘要和待确认责任 |
| `src/services/simulation/simulationService.ts` | opening 与普通节点统一走 candidate WorldState → reconciler → Preview → gate → commit |
| `scripts/analyze-financial-real-browser-run.mjs` 及发布审计 | 独立标注分母、N/A 空样本、precision/recall、floor streak、份额/scope/房贷重复指标 |

## 16. 静态验收矩阵

以下用例必须直接成为自动化测试：

| 编号 | 场景 | 预期 |
|---|---|---|
| E-01 | legacy 1.5 万/月，adult floor 0.35 | 保留 1.5，不创建更低替代账户 |
| E-02 | legacy/student 0.2，进入独立工作成年人 | basic 最低上调到 0.35，不影响其他责任 |
| E-03 | known 1.0，无新支出事件 | 到期可进入 review，但继续按 1.0 计提，政策不能覆盖 |
| E-04 | known 1.0，有证据调整为 0.7 | Accepted adjust 后变为 0.7 |
| E-05 | 房租 5000 + 父母医疗 3000 | 建 housing 0.5 和 healthcare 0.3 |
| E-06 | 总生活费 1.5，分项合计 0.8 且覆盖关系未知 | 保留 aggregate review，禁止双重全额计提 |
| E-07 | 月租 5200、两人各半 | 主角计提 0.26，不是 0.52 |
| E-08 | “计划明年同居” | 不启动账户 |
| E-09 | RelationshipState 进入 cohabiting 且共同居住 | 复核 basic_living、housing 和个人份额，不新建可重复计提的 generic household 账户 |
| E-10 | 孩子出生，金额未知但主角承担 | 非零 dependent_support needs_review |
| E-11 | 每月给父母转 4000 | dependent_support known 0.4 |
| E-12 | 父母身体不佳但未说明主角支付 | owner review，不直接计入 |
| E-13 | 长期用药每月 1200 | healthcare known 0.12 |
| E-14 | 退休但没有支出变化证据 | 触发 review，不降低 basic/housing |
| E-15 | 租下木工坊/办公室/仓库 | 不创建个人支出账户；候选 scope 为 business_operating |
| E-16 | 公司租金由主角个人代付一次 | one-off personal/business investment，不创建个人住房 |
| E-17 | personal_insurance 账户 24 个月未确认 | review_due，继续原金额计提 |
| E-18 | basic_living 尚未满 60 个月但共同居住状态改变 | 立即提前 review，不自动降额 |
| E-19 | 父母照护责任明确结束 | 只结束对应 responsibilityKey |
| E-20 | 同一候选节点重试三次 | 最终只提交一个账户、一次期间计提 |
| E-21 | gate 拒绝责任 scope 冲突 | Ledger/World/History/年龄/PeriodSummary 全部不变 |
| E-22 | 缺现金支付必要支出 | 保留支出，通过流动性/短缺债处理，不下调金额 |
| E-23 | 定向 gold corpus 中 0 个标注候选 | 覆盖状态 `not_covered`，封闭门禁失败 |
| E-24 | 定向 gold detector 只命中工坊、漏掉同居 | precision/recall 均失败，不能显示 100% |
| E-25 | 同一房贷月供被 proposal 写成 `mortgage_payment` | 只进入 debt repayment policy，housing 增量为 0，且本金/利息只结算一次 |
| E-26 | 两个不同 opening 人物都缺少明确总支出 | 不因 Prompt 示例得到相同 18 万；聚合模型字段不建账，分类账户由确定性提取/版本化估计产生 |
| E-27 | 两个子女或两位需要照护的父母 | 同 type、不同 responsibilityKey 可并存；重复叙述同一对象不重复计提 |
| E-28 | 支出 payload 含 `monthlyNetAmountWan` 或字符串 evidence | schema 拒绝，不静默归一化为合法支出 |
| E-29 | opening 只说“有房租和父母医疗”但无金额 | 建立两个非零 needs_review 责任；不只留下 basic floor |
| E-30 | review 到期但没有新的 exact 金额 | 更新 lastReviewed，不更新 lastConfirmed，继续原金额并保持 review_due |
| E-31 | “给父母 4000，其中医疗 3000、生活费 1000” | 两个分项合计 0.4；总额不再额外计提 |
| E-32 | 一次性手术费/租房押金与每年保费 | 前两者走 one-off event；年保费按 12 月折算且保留 annual cadence 证据 |
| E-33 | paused 持续责任 | 不计提、不进入 annualCoreExpenseWan；保留账户并继续 review 时钟 |
| E-34 | shadow 中出现 V4 支出 Critical | 记录 wouldBlock/diff；V4 不写权威状态，节点是否提交仍由当前非 V4 gate 决定 |
| E-35 | 已有 `.2` contextual parent-care；新事实为膝盖退行性变化 + 每日关节康复 | 同一账户按 elevated policy 严格上调（older adult `.35`），保留 `needs_review`；年龄/重复证据/一次理疗/他人账户均不得上调 |

### Opening 专项验收

Opening 抽取作为独立关键路径，除共享 E 用例外必须有单独测试组：

| 编号 | 输入 | 预期 |
|---|---|---|
| O-01 | 仅“有房租和父母医疗”，无金额 | 两个非零 needs_review 责任，不回落为单一 basic floor |
| O-02 | 房租 5000 + 父母医疗 3000 | housing 0.5 + healthcare 0.3，证据与个人份额正确 |
| O-03 | 总额 `P` + 分项 `T`，coverage unknown | 只激活一个 `max(P,T,F)` aggregate；分项不计提并生成 component gap |
| O-04 | 两个不同人物均无明确总支出 | 模型 aggregate 不写账，不能因 Prompt 示例同时得到 18 万 |

## 17. 动态验收

### 17.1 全新 2/2/1 五路线

继续执行：

- 2 条 accept-first；
- 2 条 decline-first / accept-second；
- 1 条 decline-all / natural-lifespan；
- 同一 commit、同一 run ID、无替换人物；
- 完整历史、账本、邀请、报告和十张终局图片。

除既有债务和接受门指标外，必须报告第 13 节全部支出指标。

五路线中新鲜 AI 叙事的 responsibility recall 属于开放诊断指标：有人工 material 标注时报告实值，分母为 0 时报告 `not_covered`，本 Spec 不设置固定 recall 发布阈值。确定性的漏账 Critical、scope mismatch、无证据降额、份额错误、房贷/总额双计仍按既有门禁阻断。

### 17.2 定向非空支出语料

常规五路线不能保证自然出现每种责任，因此另外建立冻结、版本化并由人工标注的定向 gold corpus。语料可以来自受控真实 AI 浏览器输出或固定 fixture，但进入门禁后输入与期望必须保持不变，至少覆盖：

1. 独立租房 + opening 分项；
2. 同居/结婚 + 共同租金份额；
3. 育儿；
4. 父母赡养或长期照护；
5. 主角长期医疗或保险；
6. 退休后的支出复核；
7. 工坊/办公室/仓库的企业负例。

最低样本要求：

- material 正例至少 12 个；
- `housing`、`dependent_support`、`healthcare/insurance` 各至少 2 个；
- adjust、end、review 各至少 1 个；
- business/third-party 负例至少 4 个；
- 所有正例和负例人工标注；
- precision 100%、recall 100%、scope mismatch 0。

未达到样本数量时状态为 `insufficient_coverage`，即使已有样本全部通过也不能发布。

### 17.3 长期财富诊断

真实路线必须输出：

- 每条路线累计收入、持续支出、一次性支出、债务服务和净现金流；
- 年支出分布及连续使用最低基线的最长月份；
- 每个家庭责任前后 3 个节点的支出运行率；
- 终局现金、净资产、储蓄率和支出事实状态。

这些数据用于判断模型分辨力，但不得用“储蓄率必须低于 X%”替代事实验收。

## 18. CI 与命令

新增脚本：

```json
{
  "test:opening-expense-facts": "node --import tsx --test src/domain/finance/openingFinancialFacts.test.ts src/domain/finance/openingFinancialAuthority.test.ts",
  "test:financial-expense-lifecycle": "node --import tsx --test src/domain/finance/expenseResponsibility.test.ts src/domain/finance/reconcileExpenseCommitments.test.ts src/domain/finance/expenseLifecycleReview.test.ts src/domain/finance/migrateFinancialLedgerV3ToV4.test.ts src/domain/finance/financialProposalSchema.test.ts src/domain/finance/normalizeFinancialProposals.test.ts src/domain/finance/commitFinancialDomainTransaction.test.ts",
  "test:financial-expense-audit": "node --test scripts/financial-expense-audit.test.mjs"
}
```

并加入 `test:financial-production-blockers`。发布至少执行：

```text
pnpm test:opening-expense-facts
pnpm test:financial-expense-lifecycle
pnpm test:financial-expense-audit
pnpm test:financial-production-blockers
pnpm test
pnpm lint
pnpm build
```

真实路线执行现有 browser collector、full-data renderer、financial analyzer 和 five-route verifier；不得复用旧 v7 作为新实现证据。

## 19. Telemetry 与可观察性

每个节点新增：

```ts
interface ExpenseLifecycleTelemetry {
  mode: "off" | "shadow" | "enforced";
  candidateCount: number;
  acceptedStartCount: number;
  acceptedAdjustCount: number;
  acceptedEndCount: number;
  reviewCount: number;
  ignoredCount: number;
  reasonCodes: string[];
  beforeAnnualizedExpenseWan: number;
  afterAnnualizedExpenseWan: number;
  baselineDownwardBlocked: boolean;
  staleResponsibilityKeys: string[];
  businessScopeRejectedKeys: string[];
  duplicateAmountSourceIds: string[];
  schemaRejectedCount: number;
}
```

日志必须能回答：

- 为什么创建、调整或结束这个账户；
- 金额是已知值、个人份额、上次已知值、上下文估计还是最低线；
- 哪个 WorldState delta 或证据触发；
- 为什么某个候选被忽略或进入 review；
- gate 拒绝后权威状态是否完全不变。

## 20. 回滚与安全边界

- 使用独立 `expenseLifecycleMode`；shadow 的 V4 结果只记录差异，不写账本，但当前权威路径仍按上表提交。
- enforced 出现误报时可回退到 shadow，但不得回退节点接受门、债务权威或财富派生。
- 不允许同时运行旧正则自动建账和新 reconciler，避免重复支出。
- 迁移失败必须保留 V3 账本并中止本节点，不生成半迁移 V4。
- 所有 correction 都保留事件、issue 和 policy version，不静默改余额。

## 21. 完成定义

只有同时满足以下条件，支出修正才算完成：

1. 旧的 1.5 万/月 estimated opening 不会无证据降到 0.35。
2. `0.35` 明确只作为非住房基本生活最低线。
3. opening 分项、共同份额和 aggregate 去重通过静态测试。
4. 结构化关系、家庭、住房、医疗和退休状态是生命周期主触发源。
5. 工坊、办公室、仓库等企业负例进入个人账本的数量为 0。
6. 所有 active 未知责任使用非零、可解释的保守计提。
7. 到期支出全部复核或有稳定 review issue，继续原计提而非归零。
8. 无证据向下覆盖、aggregate split loss、shared amount mismatch 均为 0。
9. 冻结定向 gold corpus 达到最低样本，precision/recall 均为 100%，`0/0` 不再通过；新鲜五路线 recall 按第 17.1 节作为诊断报告。
10. 全新 2/2/1 五路线、静态生产门禁、全量测试、类型检查和构建全部通过。
11. 拒绝节点继续满足零提交、零时间推进、零期间计提。
12. 最终报告、海报和下一轮 Prompt 全部读取同一份 V4 支出分类摘要。
13. Opening Prompt 不再用固定业务数值锚定支出，模型聚合 `annualCoreExpenseWan` 无法写入 Ledger。
14. 房贷偿付与 housing commitment 完全分流，任何节点都不存在本金或利息重复计提。
15. V4 schema 拒绝收入字段、字符串 evidence 和总额/份额不一致；账户去重按 responsibilityKey 而非 type。

满足以上条件后，只能声明：已消除“最低线静默覆盖”导致的系统性支出低估，并使分类支出责任可审计、可复核、可回归。不得进一步宣称终局净资产、储蓄率已经进入真实区间，或“财富长期偏高”这一更广泛问题已被整体解决；仅仅增加账户类型、标记 `needs_review` 或让审计显示 100% 均不构成完成。
