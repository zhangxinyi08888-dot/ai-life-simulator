# 支出分句事实绑定与权威确认闭环 Spec

## 1. 文档状态

- 状态：审查修订完成，可进入 Phase 0
- 规格日期：2026-08-08
- 目标分支：`codex/financial-expense-lifecycle`
- 代码基线：`ce35e55a00cab60755753d1cd3ea2a1dbf84ae9c`
- 远端基线：`origin/codex/financial-expense-lifecycle@ce35e55`
- 风险等级：R3（财务单领域权威链，但修改公共节点 gate / retry 合同）
- 前置能力：`FinancialLedger v4`、`ExpenseCommitmentV4`、`FinancialDomainPreview`、`FinancialNodeAcceptanceGate`、支出 lifecycle shadow/enforced、拒绝后零状态变化
- 上位规格：`2026-07-31-financial-expense-authority-and-lifecycle-correction-spec.md`
- 取代范围：本 Spec 取代上位规格中“正文支出候选的整句识别、责任归属、金额绑定、重大 unknown 处置和精确金额确认”相关实现条款
- 保留范围：Ledger V4、支出类型、估算政策、opening、legacy aggregate、生命周期状态机、个人/企业边界、债务分流和年化派生仍沿用上位规格

本 Spec 只解决一个窄问题：已经出现在候选节点中的持续支出事实，必须在同一个事实单元内正确绑定“责任、完成状态、付款人、金额、频率和个人份额”，并通过现有 Proposal / Validator / Gate / Accepted Event 链完成确认。它不通过提高统一支出数字、随机扣款、储蓄率上限或报告修饰来降低财富。

## 2. 决策摘要

本轮采用以下固定决策：

1. 在 `narrative_supplement` 与 `ExpenseResponsibilityCandidate` 之间新增非持久化的“分句事实绑定层”。
2. `NON_COMPLETED`、付款人和金额不得继续按整句共享；三者必须绑定到同一个支出事实单元。
3. 每个绑定必须保存责任、付款人和金额各自的原文 span；不能只保存拼接后的 evidence 字符串。
4. `amount unknown` 与 `liability unknown` 是两种不同状态：前者在责任已确认时可以建立非零 contextual estimate，后者不能自动扣主角现金。
5. 已完成、有持续金额、但付款人或范围无法解析的重大事实，不能继续作为普通 warning 提交；必须进入有界重生，耗尽后零状态变化。
6. “父母身体不好”等只有责任需要、没有主角付款事实的内容仍是 review，不得因本 Spec 自动成为个人支出。
7. 不新增 `ExpenseConfirmationProposal` 或 Financial Event kind；精确事实确认复用现有 `expense_commitment_started` / `expense_commitment_adjusted`。
8. 只有本轮新的 Accepted 精确事实可以把账户确认为 `known + explicit_known/explicit_shared_amount`。
9. `narrative_supplement` 的明确金额可以继续作为 `needs_review + last_known` 的当前计提输入，但重复出现不能提升事实权威。
10. 同一 AI 叙事重复 N 次不是独立证据，绝不能触发 `needs_review → estimated/known`。
11. 模型只能提供本轮支出金额观察；`factStatus`、`amountBasis`、确认字段、复核时钟和 issue closure 全部由确定性代码生成。
12. 4.2 万众数、储蓄率和 snapshot factStatus 比例继续作为诊断；发布门检查责任 episode 是否完整，不以金额分布反向调账。
13. 本轮不修改 0.35 万/月 basic-living policy floor，也不实现完整的人生阶段重估；它们属于后续独立增量。

## 3. 已确认基线

### 3.1 当前错误链

当前 narrative 路径大致为：

```text
整句文本
  ↓
整句 NON_COMPLETED 判断
  ↓
整句 classifyNarrativeLiability
  ↓
责任信号附近 16 字金额绑定
  ↓
ExpenseResponsibilityCandidate
  ↓
liability=unknown → 非阻断 issue → 继续推进
```

它会产生四类结构性错误：

1. **完成态污染**：一句话后半段出现“未来/计划”，会否决前半段已经发生的支出。
2. **付款人污染**：一句话内的第三方或 shared 付款人会覆盖另一笔个人支出。
3. **金额降格**：责任与金额相距超过固定字符窗口时，候选仍可能存在，但明确金额退化成 policy estimate。
4. **unknown 非闭环**：已经发生且有周期金额的支出，只因付款人省略而成为 non-blocking issue；时间和收入继续推进，账本不增加支出。

### 3.2 代表性失败样本

| 输入 | 当前风险 | 正确结果 |
|---|---|---|
| `你已经每月支付房租5000元，未来再考虑搬家。` | `未来` 误杀已发生房租 | 房租 completed；搬家 planned |
| `你支付房租5000元，伴侣承担父母医疗1200元。` | 第三方付款人污染房租 | housing personal 0.5；医疗 third-party 0.12 |
| `你们共同支付房租5000元，你单独承担父母医疗1200元。` | 两项都被标 shared | housing shared；医疗 personal |
| `每月支付房租5000元。` | 金额明确但 payer unknown，issue 后继续 | material owner repair；未修复则拒绝 |
| `父亲最近身体不好，需要定期复查。` | 可能被误当个人现金责任 | responsibility review；不扣主角现金 |
| `你与父亲商量后决定请钟点工……费用由你承担，每月1200元；次周已经上门。` | 计划词、付款人和金额跨片段 | completed personal elder-care exact fact |

### 3.3 v8 / v18 的使用边界

历史数据只证明问题存在，不构成本 Spec 的可比 before/after：

| 运行 | 节点 | 4.2 万众数占比 | floor-only | 标注 | 选择性 factStatus snapshot |
|---|---:|---:|---:|---|---|
| v8 | 111 | 52.25% | 772 人月；最长 422 月 | 独立责任 recall 5/7 | known 12 / estimated 18 / needs_review 157 |
| v18 | 123 | 59.35% | 1502 人月；最长 1020 月 | 原始 run 未提供 | known 0 / estimated 3 / needs_review 188 |

限制：

- 两次运行使用不同真实 AI 正文、不同节点数和不同标注分母。
- 两次 manifest 均为 `repositoryDirty=true`，不能精确重放当时执行源码。
- v18 后置的 2/4 人工 fixture 使用另一组语料，不能与 v8 的 5/7 做 A/B。
- v8 的 known 12 是同一个 0.35 万 basic-living 账户跨 12 个节点的 snapshot，不是 12 个独立支出事实。
- v8 的 estimated 18 主要也是同一账户跨节点重复；v18 的 estimated 3 同理。
- 当前代码中的责任金额局部 16 字窗口是在 v18 之后加入，不能反向解释 v18 的 known=0。

因此不得写出“边界修复导致 known 12→0”或“v18 证明当前 HEAD 仍为 59.35%”等因果结论。

## 4. 目标与非目标

### 4.1 产品目标

- 已经发生的个人持续支出不会因为同句其他付款人、计划词或无关金额而消失。
- 同一句中多笔支出分别绑定正确的 payer、scope、amount 和 share。
- 金额未知时保留非零、可解释计提；责任归属未知时不擅自扣个人现金。
- 重大 owner-unknown 不会挂 warning 后持续多年，而是在节点接受前得到修复或整节点拒绝。
- 新的 Accepted 精确事实能够关闭 `needs_review`，而不是让账户永远停在 policy floor。

### 4.2 工程目标

- 新增可单测、可审计的 clause / fact binding 中间层。
- 保持 `deriveExpenseResponsibilityCandidates()` 外部 API 兼容。
- 保持 Ledger V4、reducer、年化派生和期间计提数学不变。
- 为 expense confirmation 增加 validator predicate，而不是新建第二套事件协议。
- 将重大 unknown 纳入现有 `expense_lifecycle` Required Fact Group。
- 保持拒绝后的 Ledger、WorldState、CareerState、History、年龄和 PeriodSummary 全部不变。

### 4.3 非目标

- 不调整 `adult_basic_living=0.35 万/月`。
- 不建立 Policy V3、实时城市物价或 CPI。
- 不实现同居、婚育、退休和家庭人数变化的完整自动重估；本 Spec 只提供其支出事实能够正确绑定和确认的入口。
- 不自动假定老年人患病、住院、聘请护工或产生固定医疗费。
- 不新增 Ledger V5，不修改现金、净资产或 `annualizedCoreExpenseWan` 公式。
- 不新增完整的配偶、父母、子女或公司复式账本。
- 不用重复正文、issue occurrenceCount、模型置信度累积或时间经过提升事实权威。
- 不以 `known` 数量、4.2 万众数占比或储蓄率作为自动调账目标。
- 不在开发中反复运行完整 2/2/1；冻结候选后只运行一次正式认证。

## 5. 权威链与事实状态

### 5.1 唯一允许的链路

```text
候选正文 / Accepted WorldState / Accepted Outcome
                    ↓
       NarrativeExpenseFactBinding
                    ↓
       ExpenseResponsibilityCandidate
                    ↓
       reconcileExpenseCommitments
                    ↓
  FinancialEventProposal(started / adjusted / ended)
                    ↓
 Validator → validated provisional AcceptedFinancialEvent
                    ↓
       FinancialDomainPreview
                    ↓
       FinancialNodeAcceptanceGate
                    ↓
       authoritative transaction commit
                    ↓
    Derived state + PeriodSummary + Cash
```

正文不能直接写 Ledger，binding 也不能直接创建 Accepted Event。Gate 之前的 AcceptedFinancialEvent 只是只读 Preview 使用的 provisional event；只有 Gate 授权后的同一事件集合才可成为权威提交。

### 5.2 状态语义固定

| 来源 | factStatus | amountBasis | 是否按当前金额计提 | 是否关闭 review |
|---|---|---|---|---|
| system policy floor | `needs_review` | `policy_floor` | 是 | 否 |
| structured responsibility，金额未知 | `needs_review` | `contextual_estimate` | 是 | 否 |
| narrative supplement 明确金额 | `needs_review` | `last_known` | 是 | 否 |
| 新 Accepted 结构化上下文触发代码重估 | `needs_review` | `contextual_estimate` | 是 | 否；可更新 amount/policy/lastReviewed；exact issue 未解决时不改 nextReview |
| 本轮 Accepted 个人精确金额 | `known` | `explicit_known` | 是 | 是 |
| 本轮 Accepted shared 总额+份额 | `known` | `explicit_shared_amount` | 是 | 是 |

`estimated` 不是 `needs_review` 的自动上一级。本 Spec 不新增任何 `needs_review → estimated` 的计数或重复叙事升级规则。

### 5.3 来源优先级

同一责任同一节点的来源优先级固定为：

```text
user_fact
  > accepted_outcome / direct Accepted financial proposal
  > accepted_world_delta（只拥有结构化责任，不自动拥有精确金额）
  > narrative_supplement
  > system policy
```

高优先级来源可以确认或提高权威；低优先级来源不能降低、暂停、结束或覆盖高优先级事实。

金额权威必须由代码判定，不能由模型通过 `sourceOutcomeId` 或 evidence.source 自报：

| 候选来源 | 可拥有的事实 | 可 exact confirm |
|---|---|---|
| `user_fact` | 用户本轮明确提供的 payer/scope/amount/cadence/share | 是 |
| 本轮 direct financial proposal，经普通 schema/evidence validator 与最终正文/Outcome 逐字段校验 | 本轮已发生的 payer/scope/amount/cadence/share | 是 |
| `accepted_world_delta` | 结构化责任、人物、住所、关系和阶段上下文 | 否；没有独立 exact amount authority |
| `narrative_supplement` / binder 自动补充 | 可形成 last-known 计提和 review | 否 |
| `scheduled_review` / `system_policy` / `legacy_migration` | review 或 policy estimate | 否 |

凡 `candidate.source=narrative_supplement|scheduled_review`，或 proposal 标记为系统 reconciliation 生成，都不能因碰巧带有当前 `sourceOutcomeId` 而升级为 known。direct proposal 也必须先通过本 Spec 的 confirmation validator；“模型直接填 known”本身没有权威。

## 6. 分句事实绑定层

### 6.1 非持久化类型

新增 `src/domain/finance/narrativeExpenseFactBinding.ts`：

```ts
interface NarrativeClause {
  id: string;
  sentenceIndex: number;
  clauseIndex: number;
  start: number;
  end: number;
  text: string;
}

interface NarrativeExpenseFactBinding {
  id: string;
  clauseId: string;
  contextClauseIds: string[];
  sourceNodeId?: string;
  sourceOutcomeId?: string;
  sourceIdentityStatus: "bound" | "missing";
  evidenceFingerprint: string;

  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  action: ExpenseResponsibilityAction;
  completion: ExpenseResponsibilityCompletion;
  cadence: ExpenseResponsibilityCadence;

  liability: ExpenseResponsibilityLiability;
  financialScope: ExpenseResponsibilityScope;
  shareRate?: number;
  explicitMonthlyTotalWan?: number;
  protagonistShareWan?: number;
  amountSourceId?: string;
  participantPersonIds: string[];

  responsibilitySpan: TextSpan;
  completionSpan?: TextSpan;
  payerSpan?: TextSpan;
  amountSpan?: TextSpan;
  cadenceSpan?: TextSpan;
  reasonCodes: string[];
}

interface TextSpan {
  start: number;
  end: number;
  excerpt: string;
}

interface NarrativeExpenseFactBindingResult {
  clauses: NarrativeClause[];
  bindings: NarrativeExpenseFactBinding[];
  diagnostics: Array<{
    clauseId: string;
    bindingId?: string;
    disposition: "bound" | "owner_review" | "ignored" | "ambiguous";
    reasonCodes: string[];
  }>;
}
```

这些类型只存在于候选生成和 telemetry，不写入 Ledger，不触发迁移。

### 6.2 最小 API

```ts
segmentNarrativeExpenseClauses(text: string): NarrativeClause[]

bindNarrativeExpenseFacts(input: {
  sourceNodeId?: string;
  sourceOutcomeId?: string;
  narrativeText: string;
  candidateWorldState?: WorldStateSnapshot;
  existingExpenseCommitments?: ExpenseCommitmentV4[];
}): NarrativeExpenseFactBindingResult

candidateFromNarrativeBinding(
  binding: NarrativeExpenseFactBinding
): ExpenseResponsibilityCandidate
```

`deriveExpenseResponsibilityCandidates()` 的返回值保持不变，但 input 以向后兼容方式增加可选 `sourceNodeId/sourceOutcomeId`。production 的 shadow/enforced binding 与任何 confirmation 路径必须提供稳定 source identity；旧测试/兼容调用可以暂时省略，但此时 binder 必须标记 `SOURCE_IDENTITY_MISSING`，且结果不得用于 exact confirmation。结构化 `explicitFacts`、WorldState 和 Accepted Outcome 路径不改；只将 `deriveNarrativeCandidates()` 内部替换为：

```text
segment → bind → candidate adapter
```

### 6.3 分句规则

1. `。！？；\n` 继续形成 sentence 边界。
2. `，,`、转折词和显式付款人切换用于形成 clause span，但不能盲目切分金额枚举。
3. 一个 clause 可以生成多个责任 fact；每个 fact 必须拥有独立 payer/amount span。
4. 如果一个 span 同时可能属于两笔责任且无法通过局部谓词确定，不猜测，标记 `ambiguous`。
5. 原始绝对 offset 必须按 JavaScript UTF-16 `[start,end)` 保留，同时保存候选正文 fingerprint，方便 validator、审计和失败报告定位原文。

### 6.4 完成状态绑定

`NON_COMPLETED` 不再对整个 sentence 一票否决，只判断包含责任动作的 clause / predicate。

优先级：

```text
明确已发生/正在持续动作
  > 同 clause 的计划词
  > 其他 clause 的计划词无效
```

规则：

- `已经支付房租，未来考虑搬家`：房租 completed，搬家 planned。
- `计划下月开始支付房租`：planned，不启动账户。
- `决定请钟点工`：仅表示安排决定；没有服务开始、持续付款或 Accepted 结果时不计提个人支出。
- `决定请钟点工，次周已经上门并开始服务`：可形成 completed responsibility。
- `如果父亲需要就考虑请护工`：hypothetical，只记录诊断。
- 现有持续用药、named caregiver 和父母照护窄例外必须迁移为 binding rule，而不是删除。

当前 reconciler 只接受 `completion=completed`。为保持本轮范围最小，binding 保留原始 `ongoing` 供审计，但 Candidate adapter 必须把“已经在持续发生”的 `ongoing` 规范化为 `completed`，并记录 `EXPENSE_ONGOING_CANONICALIZED_TO_COMPLETED`；不得修改 planned/hypothetical。定向测试必须分别覆盖 ongoing start、ongoing owner-unknown 和 ongoing exact confirmation，避免它们在适配后静默消失。

### 6.5 付款人和范围绑定

付款人必须与当前责任 fact 绑定，不能使用整句唯一标签。

对每个 binding 独立执行：

```text
business_operating
shared_household
third_party
personal
unknown
```

优先级只在同一 fact 内生效。一个 business fact 不得覆盖同句 personal fact；一个 third-party 医疗 fact 不得覆盖同句 personal housing。

允许识别的个人付款表达至少包括：

- `由你承担`、`费用你承担`、`你来支付`、`你支付`、`你出钱`；
- `你每月转给父母`、`从你的现金流中扣除`；
- 已发生的 `你租住/续租/交房租`；
- 本轮 Accepted Outcome 中明确的主角个人承担。

shared 必须区分：

- “共同承担”只证明 shared liability；
- “各付一半/主角承担 40%/主角每月承担 2000”才能证明个人份额；
- shared 总额不能直接作为主角个人金额。

### 6.6 金额绑定

不将字符距离 `<=16` 作为事实边界。新规则为：

1. 优先绑定同 fact clause 中、与该责任谓词关联的金额。
2. 允许显式指代的相邻 clause，例如命名护工后出现“她的服务费每月 1200”。
3. 邻句 resolver 必须有稳定的人物、责任或服务者引用；不能只依赖“最近金额”。
4. 工资、营收、回款、房价、贷款本金、保险赔付等冲突金额不得绑定持续支出。
5. 多责任多金额必须一对一；歧义时 amount unknown，不复制同一个金额。
6. 年、季、月和一次性频率必须在同一 fact 或显式引用 clause 中折算。
7. 绑定金额时保存 `amountSpan` 和 `amountSourceId`，同一 source 不得重复计提。

### 6.7 跨 clause 引用边界

允许的跨 clause 合并：

- 同一命名人物或 responsibilityKey；
- 同一命名护工/康复师；
- 明确代词指向且前 clause 只有一个候选对象；
- Accepted WorldState 已提供唯一 participant identity。

禁止的跨 clause 合并：

- 仅因位置接近；
- 跨过另一笔责任或另一名付款人；
- 从收入金额借到房租/医疗；
- 从家庭总额借到个人份额；
- 从旧账本或 Prompt 示例复制金额。

### 6.8 Candidate 适配

每个 binding 只生成一个 canonical `ExpenseResponsibilityCandidate`。候选保留现有字段语义，并通过 telemetry 关联 `binding.id` 与各 span。

若本轮 direct financial proposal 已与同一 binding/responsibility/amountSource 对齐，binding 只作为 evidence consistency 输入，不再额外生成 `narrative_supplement` proposal；direct proposal 经 confirmation validator 成功后拥有本轮写入。对齐失败时不得合并金额或 payer，分别进入 reject/review，避免同一事实双写。

第一阶段不把 binding 字段加入 Ledger。若 telemetry 需要跨模块传递，可为 Candidate 增加可选的：

```ts
sourceFactBindingId?: string;
sourceSpans?: {
  responsibility: TextSpan;
  completion?: TextSpan;
  payer?: TextSpan;
  amount?: TextSpan;
};
sourceBindingDisposition?: "bound" | "owner_review" | "ambiguous";
sourceMateriality?: "nonmaterial" | "review" | "critical";
unresolvedFields?: Array<"completion" | "payer" | "scope" | "amount" | "share" | "cadence">;
sourceBindingReasonCodes?: string[];
```

这些字段只能用于 Validator 与审计，不参与账户 identity 或现金计算。

Binder 是 narrative materiality 的单一 writer：它依据 §7.2 生成 `sourceMateriality/unresolvedFields/reasonCodes`，Candidate adapter 原样传递，reconciler 只消费并生成对应 issue / Required Fact Group。`lifeStageExpenseLifecycle.ts` 可以产生结构化责任候选，但不得对同一 narrative binding 重新推导一份不同 severity。实现不得让 binder、lifecycle detector 和 reconciler 各自判断一次 material unknown。

`binding.id`、`evidenceFingerprint` 和 `amountSourceId` 必须是稳定、可重放的代码生成值：

```text
hash(
  sourceNodeId / sourceOutcomeId
  + responsibilityKey
  + responsibility/completion/payer/amount/cadence span offsets
  + normalized amount/share/cadence
)
```

同一来源重放必须得到同一 ID；同一数字在新节点出现也不能自动视为新权威。对于 policy floor 的同额确认，除了 fingerprint 新鲜，还必须有独立的本轮“实际账单、当前实际月支出或分项合计”事实；单纯复述旧 0.35 不满足确认条件。

`sourceIdentityStatus=missing` 时允许生成仅用于兼容 detector/telemetry 的正文 fingerprint，但不得生成权威 `amountSourceId` 或 confirmation observation；production shadow/enforced 路径出现 missing 必须被审计为配置/调用错误。

## 7. 重大 unknown 分级

### 7.1 分类矩阵

| 场景 | materiality | 处理 |
|---|---|---|
| 仅描述父母患病/需要帮助，无主角付款或持续服务 | review | 不创建个人账户；保留 owner review |
| completed/ongoing personal responsibility，payer 已确认，金额未知 | review | 建立 typed 非零 `needs_review + contextual_estimate` |
| completed recurring cash outflow，有明确金额/频率，但 payer 或 scope unknown | critical | 生成 blocking issue，要求本轮重生修复 |
| shared 总额明确，但主角份额 unknown | critical | 不把总额当个人金额；要求 Accepted share |
| structured Accepted 明确主角承担 shared 责任，但金额总额未知 | review | 只有 policy 明确定义“主角个人承担额”时才按该非零金额建 `needs_review`；不得臆造 household 总额或默认 50% 份额 |
| structured Accepted 只确认 household shared 责任，主角是否承担或 policy 口径不明 | critical | 要求补齐 payer/share，不能把 household policy 总额直接扣入个人现金 |
| business / third-party | non-accruing | 不写个人账本，保留诊断 |
| planned / hypothetical | non-accruing | 不启动账户 |
| one-off | 非 lifecycle | 本 Spec 只标记并交回既有模型 `one_off_expense_paid` 路径；不新增 adapter，不创建 recurring commitment，也不得重复扣款 |

当前 V2 policy 没有 `amountPerspective=protagonist_share|household_total` 元数据，因此“policy 明确定义主角个人承担额”的 shared amount-unknown 分支在本 Spec 当前版本恒不启用，必须按 critical 处理。不得默认 50%；只有后续 policy 显式增加 perspective 后才可开启该 reviewable 分支。

### 7.2 Material unknown 判定

满足以下全部条件时，`liability=unknown` 必须 blocking：

1. completion 为 `completed` 或 `ongoing`；
2. cadence 为 monthly / quarterly / annual / recurring_unknown，而非 one_off；
3. 文本出现实际付款、扣除、月租、保费、服务费、固定转账等现金流谓词；
4. 存在明确正金额，或存在明确“由某人承担”但 payer/span 冲突；
5. scope 不是已确认 business/third-party；
6. 当前 binding 无法唯一确定 personal/shared/third-party。

不得只因“有人需要照护”或“可能产生费用”就进入 blocking。

下列情况也属于 critical：已确认 personal/shared 主角责任但没有任何非零可用策略；completed recurring amountSource 与另一 active component 重叠或会双计；aggregate/component 覆盖关系不明却试图同时计提；任何 proposal 试图绕过 confirmation 状态矩阵。它们分别防止“责任已确认但仍计 0”、重复扣款和伪确认。

### 7.3 Reason codes

新增并稳定以下 reason codes：

```text
EXPENSE_FACT_BINDING_AMBIGUOUS
EXPENSE_COMPLETED_RECURRING_PAYER_UNRESOLVED
EXPENSE_COMPLETED_RECURRING_SCOPE_CONFLICT
EXPENSE_SHARED_PROTAGONIST_SHARE_UNRESOLVED
EXPENSE_AMOUNT_BOUND_TO_CONFLICTING_FACT
EXPENSE_CONFIRMATION_EVIDENCE_INSUFFICIENT
EXPENSE_CONFIRMATION_CONFIDENCE_INSUFFICIENT
EXPENSE_CONFIRMATION_IDENTITY_MISMATCH
EXPENSE_CONFIRMATION_AMOUNT_MISMATCH
EXPENSE_CONFIRMATION_SOURCE_NOT_AUTHORITATIVE
EXPENSE_CONFIRMATION_EVIDENCE_STALE
EXPENSE_CONFIRMATION_LEDGER_ECHO
EXPENSE_CONFIRMATION_CADENCE_MISSING
EXPENSE_CONFIRMATION_SHARE_UNRESOLVED
EXPENSE_CONFIRMATION_STATUS_BASIS_MISMATCH
EXPENSE_CONFIRMATION_DOWNWARD_WITHOUT_AUTHORITY
EXPENSE_CONFIRMATION_ATOMICITY_FAILED
```

severity 不按 reason code 名称或列表序号决定，而由 §7.2 的 material predicate 和冲突后果决定：generic ambiguity 在 planned/nonmaterial 文本中可以是诊断；在 completed recurring cashflow 中必须 blocking。`EXPENSE_AMOUNT_BOUND_TO_CONFLICTING_FACT`、policy-missing、double-source、aggregate overlap 和伪确认只要会导致本期漏计、错计或双计，也必须 blocking。普通 care need / payer 已确认但只有安全非零 estimate 的 amount-unknown review 保持 warning。所有 blocking 项归入现有 `expense_lifecycle` Required Fact Group。

这些是稳定的 validator / disposition / gate reason codes，不要求全部扩展为新的 `FinancialLedgerIssue.code`。持久化 issue 使用现有 `PENDING_FACT`、`EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT`、`EXPENSE_SHARED_AMOUNT_MISMATCH`、`EXPENSE_AMOUNT_SOURCE_DOUBLE_COUNT` 等最窄语义码，并在 `summary`、proposal 关联和 telemetry 中保留具体 reason code；不得用一个新宽泛 issue code 绕过既有 schema。

### 7.4 Gate 行为

在 `enforced` 模式：

```text
material binding unresolved
  → FinancialDomainPreview 可生成但不可 commit
  → RequiredFinancialFactGroup(expense_lifecycle, critical)
  → FinancialNodeAcceptanceGate.regenerate
  → 将 reason code 和最小事实摘要传入现有有界重生
  → 修复成功后重新完整 Preview
  → 预算耗尽则返回可恢复错误
```

拒绝候选不得：

- 写 Ledger、WorldState、CareerState 或 History；
- 推进 ageInMonths；
- 计提期间收入、支出、利息或还款；
- 增加 committedTransactionIds；
- 把被拒绝 binding 当作下一节点已接受上下文。

Gate mode 的语义必须固定，避免 shadow 与权威写入混淆：

| `FinancialNodeGateMode` | 非法 confirmation proposal | 重大 required fact 缺失 | 节点行为 |
|---|---|---|---|
| `off` | validator 仍从 accepted write-set 排除 | 不生成本 Spec 的重生要求 | 节点可继续，旧账户与 issue 不变 |
| `shadow` | validator 仍从 accepted write-set 排除 | 运行与 enforced 相同判定并记录 `wouldBlock` | 节点可继续，旧账户与 issue 不变 |
| `enforced` | validator 排除且 required fact 不满足 | `allowDomainCommit=false` | 整节点重生；耗尽后零状态变化 |

`shadow` 只是不因缺失事实拒绝整个节点，不代表允许无效 confirmation 写账。schema、authority、identity、金额和状态矩阵校验在三种模式下都必须执行。

## 8. 权威金额确认

### 8.1 不新增事件类型

确认复用：

- 账户不存在：`expense_commitment_started`；
- 账户已存在：`expense_commitment_adjusted`；
- 责任结束：`expense_commitment_ended`；
- 临时暂停/恢复：`expense_commitment_adjusted + changeReason`。

`ExpenseConfirmationProposal` 不进入 schema。

### 8.2 Code-owned confirmation observation

模型不得直接提交事实状态升级。新增内部、非持久化观察类型：

```ts
interface ExpenseAmountObservation {
  id: string;
  authoritySourceKind: "user_fact" | "direct_financial_proposal" | "accepted_world_delta";
  authoritySourceId: string;
  sourceOutcomeId?: string;

  expenseCommitmentId?: string;
  responsibilityKey: string;
  statementKind: "exact" | "estimate";
  cadence: "monthly" | "annual";

  protagonistAmountWan?: number;
  grossAmountWan?: number;
  householdShareRate?: number;
  financialScope: "personal" | "shared_household";
  effectiveAtAgeInMonths: number;
  evidenceAnchor: TextSpan | StructuredAcceptedFactRef;
}

type ExpenseConfirmationDisposition =
  | "not_confirmation"
  | "confirmed_exact"
  | "contextual_reprice"
  | "review_only"
  | "blocked";

interface ExpenseConfirmationValidationResult {
  disposition: ExpenseConfirmationDisposition;
  observationId: string;
  proposalId: string;
  responsibilityKey: string;
  accountId?: string;
  reasonCodes: string[];
  canonicalProposal?: FinancialEventProposal;
  targetIssueIds: string[];
  resolutionKind?: ExpenseIssueResolutionKind;
}

interface StructuredAcceptedFactRef {
  sourceKind: "user_fact" | "direct_financial_proposal" | "accepted_world_delta";
  sourceId: string;
  fieldPaths: string[];
  fingerprint: string;
}

interface AcceptedAuthoritySnapshot {
  sourceNodeId: string;
  sourceOutcomeId: string;
  acceptedUserFactIds: string[];
  acceptedDirectProposalIds: string[];
  acceptedWorldDeltaIds: string[];
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}
```

`authoritySourceKind`、source ID、当前年龄和 evidence fingerprint 由代码根据已接受候选盖章，不能信任模型自报。`statementKind=estimate` 不是 exact confirmation；本 Spec 中它最多触发代码拥有的 `needs_review + contextual_estimate` 重估。

新增 builder：

```ts
buildExpenseAmountObservation(input: {
  proposal: FinancialEventProposal;
  candidate?: ExpenseResponsibilityCandidate;
  binding?: NarrativeExpenseFactBinding;
  currentAuthority: AcceptedAuthoritySnapshot;
  finalNarrativeText: string;
}): ExpenseAmountObservation | undefined
```

它只能从 `user_fact`、本轮 direct model financial proposal 经普通 schema/evidence validator 通过的字段，或后续专用 Accepted expense fact builder 生成 observation。普通 amount-free `accepted_world_delta` 只能提供 responsibility/payer/scope 上下文并返回 `review_only/contextual_reprice`，不能提供 exact amount。`systemGenerated=expense_responsibility_reconciliation|expense_lifecycle_review`、`candidate.source=narrative_supplement|scheduled_review` 永远不能生成 `confirmed_exact` observation。proposal ID、binding ID 与 authority source ID 必须稳定一一映射。

新增纯函数：

```ts
validateExpenseConfirmation(input: {
  observation: ExpenseAmountObservation;
  proposal: FinancialEventProposal;
  previousLedger: FinancialLedgerV4;
  currentAcceptedAuthority: AcceptedAuthoritySnapshot;
  finalNarrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  bindings: NarrativeExpenseFactBinding[];
}): ExpenseConfirmationValidationResult
```

确认 validator 位于普通 schema/evidence 校验之后、Accepted Event 创建之前。只有同时满足以下条件才返回 `confirmed_exact`：

1. proposal kind 为 `expense_commitment_started` 或 `expense_commitment_adjusted`；
2. authority source 属于本轮候选，source fingerprint 未出现在旧 evidence / amountSourceIds；`direct_financial_proposal` 必须有非空 `sourceOutcomeId` 且指向本轮 Outcome；
3. evidence anchor 是本轮最终可见正文中的连续 span，或本轮结构化 Accepted fact 的稳定引用；不是拼接文本、旧 Prompt、scheduled review、legacy migration 或 Ledger echo；
4. statementKind 为 exact，且原文不含“约、大概、预算、预计、左右”等估算语义；
5. binding completion 为 completed/ongoing；
6. payer/scope 已绑定为 personal，或 shared 且同时包含 household 总额、主角份额和 share rate；
7. 金额、频率和折算与 evidence anchor 一致，`effectiveAtAgeInMonths` 位于本期；
8. proposal confidence `>=0.8`；
9. 对已有账户，proposal 引用 previous ledger 中同一账户；ID、responsibilityKey、kind 和 type 不变，scope/participants 只有本轮新的 Accepted 变化事实才可改变；
10. 金额降低、pause 或 end 仍满足既有 change authority；从 policy/context/legacy 估算降到新的实际精确值时，使用窄原因 `estimate_superseded_by_exact_fact`，不得允许任意低估算下调；
11. schema、reducer preview 和财务不变量全部通过。

确认 Prompt 只暴露 account ID、responsibilityKey、displayName 和必要 WorldState 上下文，不暴露旧 policy 金额。即便模型仍复述旧数字，只要没有本轮新的实际账单、当前支出或分项合计事实，必须返回 `EXPENSE_CONFIRMATION_LEDGER_ECHO`。

confirmation validation 必须在所有正文 writer、repair、fallback 和 sanitizer 完成之后、Gate 之前，对 `finalNarrativeText` 重新 bind/校验。早期 span 若在最终正文中已经不存在、UTF-16 offset/excerpt 不再逐字匹配、正文 fingerprint 已变且无法唯一 rebind、或只描述历史期，不得沿用为本期确认事实。该 post-sanitize verifier 必须有独立单元测试。

若 post-sanitize verification 改变任何 confirmation disposition，必须丢弃旧 provisional event/write-set 与旧 Preview，从 previous authoritative state 重新构造 event 并完整 Preview；Gate 不得读取包含已失效 confirmation 的 stale Preview。

validator 只接受 observation 的事实字段，并由代码构造 canonical `nextCommitment`；模型 payload 中的 `factStatus`、`amountBasis`、`confirmedMonthlyAmountWan`、`lastConfirmedAtAgeInMonths`、`lastReviewedAtAgeInMonths` 和 `nextReviewAtAgeInMonths` 一律忽略或要求与代码期望值逐字段完全相等。

只有 result 中的 `canonicalProposal` 可以进入 provisional write-set。Gate 必须接收结构化 `ExpenseConfirmationValidationResult[]`，按 `disposition/reasonCodes/targetIssueIds/resolutionKind` 构造 required fact group 和 atomicity 断言；不能只根据 generic proposal kind 或 account ID 猜测确认是否完成。

### 8.3 确认后的状态

个人精确金额：

```text
factStatus = known
amountBasis = explicit_known
monthlyAmountWan = confirmedMonthlyAmountWan
lastConfirmedAtAgeInMonths = currentAge
lastReviewedAtAgeInMonths = currentAge
nextReviewAtAgeInMonths = currentAge + responsibilityReviewInterval
```

共同家庭精确金额：

```text
factStatus = known
amountBasis = explicit_shared_amount
grossMonthlyAmountWan = acceptedTotal
householdShareRate = acceptedShareRate
monthlyAmountWan = grossMonthlyAmountWan * householdShareRate
confirmedMonthlyAmountWan = monthlyAmountWan
```

即使新金额与当前 policy/last-known 数字相同，新的 Accepted 精确事实仍然是有效确认，因为它改变事实依据、确认时间和 review 状态。

状态矩阵对本轮新建或调整的 V4 支出是双向约束：

| factStatus | 允许的 amountBasis | 确认字段 | 权威要求 |
|---|---|---|---|
| `known` | `explicit_known` / `explicit_shared_amount` | `confirmedMonthlyAmountWan`、`lastConfirmedAtAgeInMonths` 必填 | 本轮 Accepted exact |
| `needs_review` | `last_known` / `contextual_estimate` / `policy_floor` / `legacy_estimate` | 不得因本轮写入新 confirmed 值 | supplement、policy 或未收敛责任 |
| `estimated` | 本 Spec 不产生 | confirmed 字段必须为空 | 保留旧读取兼容；不得作为确认降级目标 |
| `unknown` | 不得 active | 必须为空 | 不得计提 |

旧快照先保持可读；任何本轮 mutation 都必须产出合法组合。若旧账户本身是非法组合，本轮不得借确认顺便静默“修好”，而应生成迁移/审计 issue。

### 8.4 低置信度和 narrative supplement

- `confidence < 0.8` 的 proposal 不能作为 exact confirmation。
- validator 必须在通用 `markEstimatedFacts()` 之前识别 confirmation；不得留下 `estimated + explicit_known` 或 `known + policy_floor` 混合状态。
- 低置信度 exact 不得简单降级成 `estimated + explicit_known`；它只能保留原账户并进入 `review_only/blocked`。
- prose-only 精确金额继续是 `needs_review + last_known`；它只可用于新建或有新 evidence 的上调并按该金额计提，不关闭 review。它不得降低、pause、end 或覆盖更高权威金额，除非另有本轮 Accepted change authority。
- 同一 prose、同义改写、相同数字或 issue occurrenceCount 增长均不提升权威。

### 8.5 Review issue 原子关闭

每个“会持久化并等待未来责任事实关闭”的 recurring-expense issue 必须持久化兼容可选字段 `expenseResolutionKind` 与 `expenseResponsibilityKey`；旧快照字段缺失时保持可读并走原兼容分支，但本轮新建的此类 issue 缺失它们属于 schema/audit failure。瞬时 schema/validator rejection 不持久化，不得为满足字段要求伪造 resolver。commit 必须同时匹配 validation result 的 `targetIssueIds`、resolver 类别、responsibilityKey、相关 account（若已经存在）和同事务 event，不能继续只凭 account ID 相交就关闭：

```ts
type ExpenseIssueResolutionKind =
  | "exact_amount"
  | "payer_scope"
  | "shared_allocation"
  | "end_or_pause_authority"
  | "aggregate_split";
```

| `expenseResolutionKind` | 唯一允许的关闭条件 |
|---|---|
| `exact_amount` | valid `confirmed_exact` |
| `payer_scope` | 新 Accepted payer/scope fact |
| `shared_allocation` | `explicit_shared_amount` 且 gross/share/personal 数学闭合 |
| `end_or_pause_authority` | 带 Accepted changeReason 的 pause/end |
| `aggregate_split` | 同事务 atomic split/coverage event |

contextual reprice 只能更新估算金额、policy fingerprint 和 `lastReviewedAtAgeInMonths`；它不能关闭 `exact_amount`、`payer_scope` 或 `shared_allocation` issue。当前只有一个 `nextReviewAtAgeInMonths`：只要 exact issue 未解决，该字段保持原值，不得后移；只有不存在 exact issue 时才可设置新的 contextual review deadline。若后续规格允许 Accepted estimate 解决“完全没有可用金额”的 critical gap，必须原子创建一个较轻的 estimate review issue，不能宣称已获得 exact fact。

同一事务必须同时完成：

```text
Accepted adjustment
+ Ledger account mutation
+ review issue resolution
+ period transaction identity
```

系统 scheduled review、narrative touch、append evidence、`lastReviewedAt` 变化、occurrenceCount 增长或无关账户 adjustment 均不得关闭 issue。合法 exact confirmation 若未关闭对应 issue，或 issue 在无合法 resolver 时被关闭，Gate 均报 `EXPENSE_CONFIRMATION_ATOMICITY_FAILED`；`resolvedByEventId` 必须指向同一 Accepted Event。

## 9. Review 获取新事实

### 9.1 禁止循环自证

以下均不是新事实：

- 连续多个节点重复同一句支出；
- 模型根据 Prompt 中的旧账本数字重新输出相同数字；
- issue occurrenceCount 达到 N；
- 只经过时间；
- 报告或海报复述 Ledger。

### 9.2 允许的 review outcome

复核必须收敛为以下之一：

1. 本轮 Accepted exact amount / payer / share；
2. 新 Accepted payer/scope/share 事实；
3. 新 Accepted 结构化上下文触发的 contextual estimate 更新；
4. 有 Accepted 证据地 pause/resume；
5. 有 Accepted 证据地 end。

每个 outcome 只解决它实际拥有的事实维度。第 2 项若只解决 payer/scope，不能关闭 exact amount issue；第 3 项仍保持 `needs_review`，不能关闭 exact amount issue。只确认“责任仍存在/范围未变”可以追加 Accepted evidence，但不能刷新金额的 `nextReviewAtAgeInMonths`，否则金额未知会被无限延期；它也不得写 `lastConfirmedAt/confirmedMonthlyAmountWan`。

### 9.3 Prompt / retry 约束

重生 Prompt 只提供：

- 缺失字段类型：payer / scope / share / exact amount；
- responsibilityKey 和账户 ID；
- blocking reason code；
- 不含凭据和完整旧响应的最小上下文。

普通生成 Prompt 和 retry Prompt 都不得直接给出希望模型重复的旧 policy/last-known 金额。模型无法从故事合理地产生新事实时，不得编造。

节点行为分两层：

- 普通 payer 已确认、amount unknown 或单纯 overdue review，本轮没有新 material amount/change claim 时，允许 `accept_with_review`；保留原非零计提、原 `nextReviewAt` 和 open issue，不伪造 disposition。
- 本轮正文/Proposal 已宣告 material current amount、payer/share/scope、下调、pause 或 end，却无法形成匹配 Accepted fact，或命中 §7.2 critical 时，必须 regenerate；耗尽后拒绝并零状态变化。

`reviewDueWithoutAcceptedDispositionCount` 是 release/corpus 的非收敛门，不会自动把每个普通 overdue review 改成单节点 blocking。若未来需要按 SLA 升级 blocking，必须另行定义阈值、起算 episode 和例外，本 Spec 不隐含该行为。

## 10. 数据不变量

新增以下确定性不变量：

1. 一个 fact binding 最多向一个责任候选贡献同一个 amountSourceId。
2. 一个金额 span 不得同时绑定两项 active recurring commitments，除非有 Accepted aggregate split。
3. 本轮新建或调整后的 `known` V4 expense 必须使用 `explicit_known` 或 `explicit_shared_amount`，并有 Accepted exact evidence。
4. `policy_floor`、`contextual_estimate`、`legacy_estimate` 不得使用 `known`。
5. 本轮新建或调整后的 `explicit_known`、`explicit_shared_amount` 不得使用 `estimated` 或 `needs_review`。
6. narrative supplement 不得单独产生 `known`。
7. shared known amount 必须满足 `monthly = gross * shareRate`。
8. liability unknown 不得产生个人 active commitment。
9. payer 已确认、金额未知的 material responsibility 不得回落为 0 或 unrelated basic floor。
10. business / third-party binding 不得进入个人 active commitment。
11. 被拒绝节点的 History/length、age/ageInMonths/nodeIndex、attributes（尤其 wealth）、CareerState/revision、FinancialLedger（含 revision、asOf、cash、accounts、issues、recentTransactions、committed IDs）、PeriodSummary、WorldState/revision、PressureArc、邀请、cooldown 和 event scheduling state 深度相等；唯一允许的外部变化是 AI 调用计数和 gate telemetry。
12. Accepted commitment 在下一期间的 `coreExpenseWan` 必须按有效月份精确计提，并与 cash delta 闭合。

现有 schema 需要补足状态与 amountBasis 的双向组合校验；不能只验证 explicit basis 存在 confirmed 字段。

## 11. 统计单位与审计

### 11.1 统一统计单位

Gold 中“应该存在但可能漏检”的责任先使用独立 expectation identity：

```text
goldExpectationId =
  (caseSlug, goldAnnotationId, responsibilityKey, effectiveFromAgeInMonths)
```

它不依赖系统是否成功创建事件。Gold 必须同时标注 `effectiveFromAgeInMonths`、可选 `effectiveToAgeInMonths`、completion、payer/liability、scope、cadence、normalized amount/share 和预期 spans。

系统成功提交后的责任生命周期再以 episode 统计：

```text
responsibilityEpisodeId =
  (caseSlug, responsibilityKey, startAcceptedEventId)
```

从 Accepted start 到 Accepted end 为一个 episode。opening/migration 使用稳定 synthetic start ID：`opening:<sourceFactId>` / `migration:<legacyAccountId>:<migrationVersion>`。跨节点重复 snapshot 不新增 episode。成功的 expectation 必须映射到恰好一个 committed episode；漏检 expectation 不需要伪造 episodeId。

Binder 与最终账本分两层对齐，不能共用一个 recall：

```text
expenseBinding TP =
  goldAnnotationId + completion + payer/liability + scope + cadence
  + normalized amount/share + expected spans

expenseCommitment TP =
  matched binding + correct Accepted event/account
  + correct next-period accrual
```

金额事实单位：`amountSourceId`。同一 source 在历史中重复出现只计一次。

时长使用 committed person-month；金额使用实际 accrued amount。snapshot 只用于调试，不用于责任数或召回率。

count 的 distinct key 固定为：episode 违规 `(caseSlug, episodeId, reasonCode)`；event 违规使用 transaction/event ID；amount 违规使用 `amountSourceId`；accepted-node 违规使用 `(caseSlug,nodeId,reasonCode)`。所有百分比同时输出 `matched/denominator/status` 和金额比较容差。

### 11.2 发布阻断指标

| 指标 | 统计单位 / 分母 | 适用层 | 要求与空样本语义 |
|---|---|---|---|
| `materialResponsibilityMissedExpectationCount` | material goldExpectationId | 冻结 gold / 独立标注 | 0；0 条 gold=`not_covered` 并阻断 |
| `expenseBindingPrecisionPct/RecallPct` | 完整 binding TP 定义 | 冻结 gold | 100%；0/0=`not_covered` 并阻断 |
| `expenseCommitmentPrecisionPct/RecallPct` | commitment TP 定义 | 冻结 E2E gold | 100%；0/0=`not_covered` 并阻断 |
| `materialResponsibilityPresentButFloorOnlyMonths` | expectation/Accepted episode 的有效 committed 月 | gold / 结构化 Accepted | 0；开放路线无标注为 `not_covered`，不单独阻断 |
| `explicitRecurringAmountAcceptedPct` | eligible direct Accepted exact observation | gold / 结构化 Accepted | 100%，且分母非零；排除 supplement/business/third-party/planned |
| `acceptedNodeWithUnresolvedMaterialExpenseBindingCount` | accepted node + unresolved required fact | 所有 enforced committed run | 0；shadow 只诊断，不作为该门的分母 |
| `unknownLiabilityPersonalCommitmentCount` | active personal commitment | 所有 committed run | 0 |
| `confirmedResponsibilityWithoutNonzeroAccrualCount` | confirmed active responsibility | 所有 committed run | 0 |
| `knownWithoutExplicitAmountEvidenceCount` | mutated V4 commitment | 所有 committed run | 0 |
| `policyFloorPromotedToKnownCount` | mutated V4 commitment | 所有 committed run | 0 |
| `expenseAmountSourceUntraceableCount` / `expenseAmountSourceDoubleCount` | distinct amountSourceId | 所有 committed run | 0 / 0 |
| `personalLiabilityRejectedAsBusinessOrThirdPartyCount` | gold annotation | 冻结 gold | 0；0 条 gold=`not_covered` 并阻断 |
| `nonPersonalCommittedAsPersonalCount` | gold + deterministic scope negative | gold / 所有明确 scope run | 0 |
| `expenseConfirmationAuthorityViolationCount` | confirmation decision/event | 所有 committed run | 0 |
| `reviewResolutionWithoutAcceptedOutcomeCount` | resolved review cycle | 所有 committed run | 0 |
| `reviewDueWithoutAcceptedDispositionCount` | due review cycle | 所有 committed run | 0；重复 narrative/occurrence 不算 disposition |
| `lifecycleTransitionMismatchCount` | Accepted transition/episode | gold / 结构化 Accepted | 0；无标注开放路线不单独阻断 |
| `annualCoreExpenseDerivationMismatchCount` | committed node | 所有 committed run | 0 |
| `expenseGateRejectedStateMutationCount` | rejected attempt | 所有 gate run | 0 |

`materialResponsibilityPresentButFloorOnlyMonths` 只统计 completed/ongoing、recurring、personal 或 shared 且主角承担额大于 0、尚未 paused/ended 的 material liability。Gold 使用标注的 effective range；Accepted start 从事件生效后的首个可计提月开始，不能把事件发生前的 elapsed period 算成漏账。判定依据是账户组合仍只有 `adult_basic_living`，不是年额数值碰巧等于 4.2 万。

`reviewDueWithoutAcceptedDispositionCount` 的合法 disposition 仅包括 matching exact confirmation、matching payer/scope/share、contextual reprice、带 authority 的 pause/resume 或 end；旧账本复述、append evidence 和 occurrenceCount 不算。

### 11.3 诊断指标

以下必须报告，但不单独阻断：

- 4.2 万众数占比和完整支出分布；
- 储蓄率、净现金流和净资产；
- `systemFloorOnlyAdultMonths`，按 `detector_missed / scope_ambiguous / policy_missing / review_unresolved / candidate_rejected / no_material_responsibility / unclassified` 的互斥优先级分原因；前两类和 `no_material_responsibility` 只有 gold/独立标注路线可赋值，开放路线无法判定时必须进入 `unclassified`；
- unique episode 的 start/adjust/review/pause/resume/end 分布；
- 按 person-month 和 accrued-wan 加权的 amountBasis 分布；
- needs_review episode 数、持续月份、overdue 时长；
- 新鲜路线 precision/recall，仅在独立标注存在时计算；`0/0=not_covered`。

不得把 known/estimated/needs_review snapshot count 当作独立事实数或召回率。

## 12. 测试规范

### 12.1 Clause binding 单元测试

| ID | 输入 | 预期 |
|---|---|---|
| C-01 | 已支付房租，未来考虑搬家 | housing completed；move planned |
| C-02 | 计划下月开始支付房租 | planned，无 active proposal |
| C-03 | 你支付房租5000，伴侣承担父母医疗1200 | personal housing 0.5；third-party medical 0.12 |
| C-04 | 你们共同支付房租5000，你单独承担父母医疗1200 | 两项 payer/scope 独立 |
| C-05 | 月薪1.8万，扣房租5000和医疗1200 | 收入金额不得借用；两项支出分别绑定 |
| C-06 | signal 与金额相距 >16 字但同一 predicate | 保留 exact amount |
| C-07 | 两个责任只有一个金额且指向不明 | amount ambiguous，不复制 |
| C-08 | 决定请护工；次周已上门，费用由你承担，每月1200 | completed elder-care exact |
| C-09 | 仅商量/考虑请护工 | review/planned，不启动 |
| C-10 | 工坊租金与个人房租同句 | business 与 personal 独立 |
| C-11 | 出租房屋获得租金 | 不是 housing expense |
| C-12 | 个人持续用药与父亲服药同句 | beneficiary 和 payer 正确 |
| C-13 | 已经持续支付个人房租/照护费 | ongoing 规范化为 completed candidate，不被 reconciler 忽略 |

每个测试必须断言 responsibility/payer/amount/completion span，而不只断言候选数量。

### 12.2 Unknown / gate 测试

| ID | 场景 | 预期 |
|---|---|---|
| U-01 | `每月支付房租5000`，payer 省略 | critical unknown，enforced regenerate |
| U-02 | 父母需要复查，无付款事实 | warning review，个人账本不扣款 |
| U-03 | Accepted personal liability，金额未知 | typed 非零 contextual estimate |
| U-04 | shared 总额明确，个人份额缺失 | critical，不能把总额计入个人 |
| U-05 | company/third-party 明确 | non-accruing，gate 不误阻断 |
| U-06 | 修复后 payer/scope 完整 | 再 Preview 后接受，且只 commit 一次 |
| U-07 | 重生预算耗尽 | 可恢复错误，所有权威状态零变化 |
| U-08 | ongoing recurring amount 明确、payer unresolved | 规范化后仍 critical，不得被 nonAccruing 忽略 |

### 12.3 Confirmation 测试

| ID | 场景 | 预期 |
|---|---|---|
| F-01 | policy floor + 本轮 direct Accepted“当前实际账单/分项合计”为 0.35 exact | 同额也确认成 known/explicit，关闭 exact review |
| F-02 | policy floor + prose/Prompt echo 重复 0.35 三次 | 仍 needs_review；`LEDGER_ECHO`，不得确认 |
| F-03 | prose-only exact 0.5 | last_known/needs_review，按0.5计提，不关闭 review |
| F-04 | Accepted personal exact 0.5 | known/explicit_known |
| F-05 | Accepted shared total0.52、share50% | known/shared，个人0.26 |
| F-06 | shared 总额与份额不闭合 | validator reject |
| F-07 | confidence<0.8 的确认 | 不得生成 estimated+explicit 混合状态 |
| F-08 | 引用旧账本金额，无本轮 span | reject |
| F-09 | 金额下降无 changeReason | reject |
| F-10 | Accepted pause/end | 原子关闭对应 review issue |
| F-11 | 重放同一 Accepted confirmation | 幂等，不重复计提 |
| F-12 | 确认后的下一期间 | coreExpense 与 cash 按新额精确变化 |
| F-13 | `known+policy_floor` 或 `estimated+explicit_known` | schema/invariant reject |
| F-14 | 新 Accepted contextual reprice | 仍 needs_review；confirmed 为空；exact issue 不关闭 |
| F-15 | ongoing + 本轮 Accepted exact payer/amount | 可 confirmed exact，且下一期只计提一次 |

### 12.4 Issue resolution 与零写测试

| ID | 场景 | 预期 |
|---|---|---|
| I-01 | 无关 account adjustment 与目标 issue 的 account ID 偶然相交 | 不能关闭目标 issue |
| I-02 | scheduled review 只更新时间/evidence | issue 保持 open，occurrence 可增加 |
| I-03 | valid exact confirmation | account mutation 与目标 issue 在同一 Accepted Event 原子完成 |
| I-04 | valid exact confirmation 但目标 issue 未关闭 | `EXPENSE_CONFIRMATION_ATOMICITY_FAILED` |
| Z-01 | enforced invalid confirmation | 所有权威状态 deep-equal，仅 telemetry/调用计数可变 |
| Z-02 | 两次拒绝后第三次合法 | 前两次零写；第三次恰好一个 transaction/event；重放幂等 |

### 12.5 完整链路测试

至少冻结以下端到端 fixture：

```text
candidate narrative
→ binding
→ candidate
→ reconciliation
→ proposal validator
→ preview
→ acceptance gate
→ commit/reject
→ next-period accrual
```

必须覆盖：

- opening 独立租房；
- 同句个人住房 + 第三方医疗；
- shared housing 总额与份额；
- 父母长期照护和护工；
- 长期医疗；
- business workshop、第三方支付、出租收入负例；
- 拒绝后的零状态变化；
- 确认后 review issue 真正关闭。

### 12.6 Gold corpus

冻结、版本化、人工标注的语料必须：

- material 正例不少于 20 个；
- mixed-payer/mixed-scope 同句正例不少于 6 个；
- completed + planned 同句正例不少于 4 个；
- amount 距离和多金额歧义不少于 6 个；
- business/third-party/rental-income 负例不少于 8 个；
- 整体 E2E corpus 中 start/adjust/review/pause/resume/end 均有样本；
- precision 100%、recall 100%、scope mismatch 0；
- 输入、标注、policy version 和 expected binding spans 固定。

未达到最小样本或分母为 0 时为 `insufficient_coverage/not_covered`，不能通过。

上述数量是对上位支出 Spec 类型配额的增量，不是替代；material 正例必须分层覆盖 housing、dependent/elder-care、healthcare、insurance，不能全部由房租样本组成。Phase 0 在实现前锁定 raw narrative 和标注；标注者必须在不看 detector、proposal、ledger 和审计输出的条件下先标注，再运行对齐。

Clause binder 的 gold 只要求 start/review/adjust 与本 Spec 的 completion/payer/amount 绑定。pause/resume/end 继续由既有 Accepted explicit fact / Proposal 的端到端测试覆盖，不把本轮窄实现扩成通用 narrative lifecycle parser。

## 13. 实施阶段

### Phase 0：冻结失败语料与基线

- 将上述 C/U/F 用例写成冻结 fixture；
- 保存当前 legacy detector 输出；
- 标注 binding span、payer、scope、amount、completion；
- 不使用 v8/v18 不同路线作 A/B；
- 不改生产行为。

退出条件：gold corpus 非空、可重复、能够稳定暴露整句污染。

### Phase 1：Clause binding shadow

- 新增 `narrativeExpenseFactBinding.ts`；
- legacy detector 与新 binder 同时运行；
- 只有 legacy 结果进入 reconciler；新结果只写 telemetry；
- 输出逐 binding confusion matrix 和 reason codes；
- 不允许两个路径同时创建 proposal。

退出条件：gold corpus precision/recall 100%，所有 span 可追溯。

### Phase 2：Enforced binding

- narrative candidate 改用 `segment → bind → candidate`；
- structured/Accepted candidate 优先级不变；
- legacy narrative path 停止写 proposal；
- 接入 material unknown blocking issues；
- 验证 gate 重生原因会传入下一次候选生成。

退出条件：C/U 全部通过；拒绝零状态变化通过。

### Phase 3：Exact confirmation

- 新增 code-owned `ExpenseAmountObservation` 与 confirmation validator；
- 模型输出先归一化为 observation，代码盖 authority source 与 fingerprint 后才允许生成 canonical adjustment；
- 补 schema 的 factStatus/amountBasis 双向不变量；
- 阻止低 confidence confirmation 进入通用 `markEstimatedFacts` 混合状态；
- 复用 existing adjusted/start event；
- 按 resolver 类别原子关闭 review issue，而不是按 account ID 泛化关闭；
- preview 同时断言合法确认已写入正确账户且目标 issue 被同一 event 关闭。

退出条件：F 全部通过，幂等与下一期间计提通过。

### Phase 4：审计与短探索

- 增加 episode、binding 和 amountSource 审计；
- 运行 R3 静态门禁；
- 使用 1–3 条必要短路线验证真实生成文本，不跑完整 2/2/1；
- 保存首次失败 clause/span/reason code。

退出条件：确定性 blockers 为 0，无重大 precision 回归。

### Phase 5：冻结候选与正式认证

- 整合最新 main 后重新计算 test-process-v2 范围；
- 工作区必须 clean；
- 固定 commit、runtime、prompt、config、collector fingerprint；
- 只在最终冻结候选上运行一次全新 2/2/1；
- 生成 full-data、机器审计、独立人工标注和五路线验证。

完整 2/2/1 只能证明运行提交；不得复用 v8/v18 或开发期 checkpoint 作为正式发布证据。

## 14. 预计代码范围

### 14.1 新增

- `src/domain/finance/narrativeExpenseFactBinding.ts`
- `src/domain/finance/narrativeExpenseFactBinding.test.ts`
- `src/domain/finance/expenseConfirmation.ts`
- `src/domain/finance/expenseConfirmation.test.ts`
- 冻结 clause-binding gold fixture

### 14.2 修改

- `src/domain/finance/expenseResponsibility.ts`
- `src/domain/finance/expenseResponsibility.test.ts`
- `src/domain/finance/lifeStageExpenseLifecycle.ts`（只移除 narrative severity 的重复 writer；不扩人生阶段规则）
- `src/domain/finance/lifeStageExpenseLifecycle.test.ts`
- `src/domain/finance/expenseLifecycleReview.ts`（写入 typed resolver；不把重复 evidence 当确认）
- `src/domain/finance/expenseLifecycleReview.test.ts`
- `src/domain/finance/expenseGoldCorpusE2E.test.ts`
- `src/domain/finance/types.ts`（只增加窄 change reason / 必要的 issue resolver 字段；不升级 Ledger version）
- `src/domain/finance/reconcileExpenseCommitments.ts`（仅 material unknown reason/disposition 和 confirmation adapter）
- `src/domain/finance/reconcileExpenseCommitments.test.ts`
- `src/domain/finance/financialProposalSchema.ts`
- `src/domain/finance/reduceFinancialLedger.ts`（仅允许窄 change reason 并维持 reducer invariant）
- `src/domain/finance/reduceFinancialLedger.test.ts`
- `src/domain/finance/validateFinancialProposals.ts`
- `src/domain/finance/validateFinancialProposals.test.ts`
- `src/domain/finance/financialNodeAcceptanceGate.ts`
- `src/domain/finance/financialNodeAcceptanceGate.test.ts`
- `src/domain/finance/commitFinancialDomainTransaction.ts`
- `src/domain/finance/commitFinancialDomainTransaction.test.ts`
- `src/services/simulation/prompts.ts`
- `src/services/simulation/simulationService.ts`
- `src/services/simulation/simulationService.test.ts`
- `src/config/financialGatePolicy.ts`
- `src/config/financialGatePolicy.test.ts`
- `scripts/lib/financial-expense-audit.mjs`
- `scripts/financial-expense-audit.test.mjs`
- `scripts/analyze-financial-real-browser-run.mjs`
- `scripts/analyze-financial-real-browser-run.test.mjs`

### 14.3 禁止修改

除非测试证明现有缺陷，否则本轮不得修改：

- `deriveFinancialState.ts` 的年化公式；
- `accruePeriod.ts` 的期间数学；
- `expenseEstimationPolicyV2.ts` 的政策金额；
- debt repayment / mortgage 分流；
- wealth attribute 算法；
- 最终报告数字 sanitizer；
- Ledger schema version。

## 15. 测试命令与 test-process-v2

### 15.1 开发期定向门禁

```bash
node --import tsx --test \
  src/domain/finance/narrativeExpenseFactBinding.test.ts \
  src/domain/finance/expenseConfirmation.test.ts \
  src/domain/finance/expenseResponsibility.test.ts \
  src/domain/finance/lifeStageExpenseLifecycle.test.ts \
  src/domain/finance/expenseLifecycleReview.test.ts \
  src/domain/finance/reconcileExpenseCommitments.test.ts \
  src/domain/finance/validateFinancialProposals.test.ts \
  src/domain/finance/financialNodeAcceptanceGate.test.ts \
  src/domain/finance/commitFinancialDomainTransaction.test.ts \
  src/domain/finance/reduceFinancialLedger.test.ts

pnpm test:financial-expense-lifecycle
pnpm test:financial-expense-audit
```

每个阶段还需运行：

```bash
pnpm lint
pnpm build
```

### 15.2 R3 合并前

```bash
pnpm test
pnpm test:financial-production-blockers
pnpm lint
pnpm build
```

同时运行 1–3 条固定/短探索场景。开发期不得用旧 2/2/1 工件证明新代码。

### 15.3 R4 发布认证

只有冻结候选、clean source identity 和所有静态门通过后，才使用项目统一流程运行一次全新 2/2/1。

## 16. Telemetry 与失败可诊断性

每个 binding 至少记录：

- binding ID、clause ID、sentence/clause index；
- responsibility/completion/payer/amount/cadence spans；
- derived responsibilityKey/kind/scope/liability/share；
- candidate ID 和 reconciler disposition；
- proposal/issue IDs；
- wouldBlock、blocking reason 和 regeneration count；
- 最终 committed / rejected 状态。

禁止记录：

- API key；
- 完整系统 Prompt；
- 未裁剪的模型原始响应；
- 与支出事实无关的长篇正文。

拒绝诊断必须能回答：

```text
哪一段文字
→ 检测出哪项责任
→ payer/amount 为什么无法绑定
→ 哪个 reason code 阻断
→ 重生后是否修复
→ 是否发生任何权威状态变化
```

## 17. 回滚策略

建议增加内部配置：

```ts
type ExpenseNarrativeBindingMode = "legacy" | "shadow" | "enforced";
```

语义：

- `legacy`：仅旧 narrative detector 产生候选；用于紧急回滚。
- `shadow`：旧路径拥有行为，新 binder 只记录差异。
- `enforced`：只有新 binder 产生 narrative candidates。

此配置独立于 `FinancialNodeGateMode`：

- binding mode 决定 narrative candidate 来源；
- financial gate mode 决定 unresolved critical 是否阻断提交。

回滚到 `legacy/shadow` 不能关闭既有债务、职业收入和节点接受门，也不能让两个 detector 同时写账。

它与已有 `ExpenseLifecycleMode` 的允许组合固定如下：

| `ExpenseLifecycleMode` | `ExpenseNarrativeBindingMode` | 语义 |
|---|---|---|
| `off` | `legacy` | 完整紧急回滚；新 binder/confirmation 不拥有写入 |
| `off` | `shadow/enforced` | 非法配置，启动时拒绝或归一化为 `legacy` |
| `shadow` | `legacy` | 只有 legacy detector 进入 lifecycle preview；不运行新 binder 对照 |
| `shadow` | `shadow` | lifecycle 不权威写入，新 binder 同时输出差异观测 |
| `shadow` | `enforced` | 非法配置；binder 不得早于 lifecycle 获得权威 |
| `enforced` | `legacy` | 仅临时兼容回滚；保留现有 lifecycle 权威 |
| `enforced` | `shadow` | 推荐 Phase 1：现有 lifecycle 写入，新 binder 只对照 |
| `enforced` | `enforced` | Phase 2+：新 binder 是 narrative 唯一 writer |

无论上述组合如何，confirmation schema/authority validator 都不能关闭；模式只控制“缺失确认是否整节点阻断”和“哪个 binder 产生候选”，不允许非法状态进入 write-set。

## 18. 风险与防护

### 18.1 召回提高导致误扣款

防护：narrative 仍是 supplement；liability unknown 不扣个人现金；precision 和 personal/business 双向 gold 门同时为 100%。

### 18.2 Clause 切得过细丢失主语

防护：保存 contextClauseIds；仅通过明确指代和唯一 participant 合并；歧义进入 owner review。

### 18.3 Clause 切得过粗继续污染

防护：mixed-payer/mixed-scope 是冻结 gold 的必选样本；每个 fact 必须有独立 payer span。

### 18.4 金额扩大搜索后串账

防护：取消字符窗口不等于段落级最近金额；必须基于 fact predicate、冲突信号和 amountSourceId 绑定。

### 18.5 重生循环

防护：复用现有有界重生预算；reason code 稳定；预算耗尽返回可恢复错误，不接受残缺节点。

### 18.6 AI 自我确认

防护：重复 narrative 永不升级；confirmation 必须有代码盖章的本轮 authority source ID、可验证的最终正文 span 或结构化 Accepted 引用、精确金额和 validator 接受；direct proposal 还必须有本轮 sourceOutcomeId。

### 18.7 known/estimated 状态混搭

防护：增加 factStatus/amountBasis 双向 schema invariant；confirmation 在通用低置信度降级前验证。

## 19. 完成定义

只有同时满足以下条件，本 Spec 才算完成：

1. 同句 completed/planned、personal/shared/third-party/business 和多金额不会互相污染。
2. 每个支出 binding 都能追溯责任、完成态、payer 和 amount span。
3. `amount unknown` 与 `liability unknown` 使用不同 disposition。
4. material owner-unknown 在 enforced 模式下必定 regenerate；耗尽后零状态变化。
5. responsibility 已确认但 amount unknown 时建立 typed 非零 contextual estimate，而不是只剩 basic floor。
6. prose-only exact 不会冒充 known；只在新建或有新 evidence 上调时可按 last-known 金额计提。
7. 本轮 Accepted exact 能通过现有 start/adjust 事件确认账户并关闭 review issue。
8. 重复正文、旧账本 echo 和 occurrenceCount 不能升级事实。
9. policy floor 冒充 known、known 无 exact evidence、estimated+explicit 混搭均为 0。
10. review issue 只能由匹配 resolver 的同一 Accepted Event 关闭；无关 adjustment、scheduled review 和 occurrenceCount 不得关闭。
11. 拒绝后的 Ledger、WorldState、CareerState、History、年龄、attributes、Arc、邀请、cooldown 和 PeriodSummary 变化均为 0。
12. Accepted expense 在下一期间的 core expense 和 cash 变化正确闭合。
13. 冻结 gold corpus 达到样本下限，precision/recall 100%，scope mismatch 0。
14. `materialResponsibilityPresentButFloorOnlyMonths=0`，且 `confirmedResponsibilityWithoutNonzeroAccrualCount=0`。
15. R3 静态门、定向短探索、类型检查和构建通过。
16. 最终冻结候选的全新 2/2/1 完整、同 commit、dirty=false，既有债务/职业/企业个人边界门禁无回归。

完成后只允许声明：

> 已发生的持续支出事实能够在分句级正确绑定责任、付款人和金额；重大未归属事实不会静默提交；新的 Accepted 精确事实能够确认账户并关闭复核。

不得声明：

- 4.2 万占比已经进入真实区间；
- 所有人生阶段支出已经完成动态重估；
- needs_review 已全部消失；
- 长期财富偏高已被整体解决。

## 20. 后续增量

本 Spec 完成后，以下内容进入独立后续规格：

1. Accepted 人生阶段状态到 housing / child_support / elder_care / healthcare 的通用 transition；
2. city / household / age-band / care-intensity 的 contextual estimate fingerprint 与 increase-only reprice；
3. `verified_floor_only` 及长期 basic-only 的期限复核；
4. 用户可见的 expense review / confirmation UI；
5. 政策金额的外部数据校准。

这些增量必须复用本 Spec 的 binding、confirmation 和 gate，不得再建旁路。
