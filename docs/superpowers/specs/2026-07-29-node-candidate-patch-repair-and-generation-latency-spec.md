# 候选节点 Patch 修复与生成延迟治理：可直接开发 Spec

> 状态：Draft for review；用户确认前不得修改生产生成链路
> 日期：2026-07-29
> 目标分支：`codex/debt-generation-latency`
> 基线提交：`4b2309a`（已包含 PR #24 的权威债务生命周期）
> 上游规格：`2026-07-18-authoritative-financial-ledger-architecture-spec.md`、`2026-07-19-cross-line-family-romance-dispatch-spec.md`、`2026-07-20-debt-production-blocker-closure-spec.md`
> 优先级：P1 性能与可靠性；不得以放松权威校验换取延迟下降

## 1. 决策摘要

当前生成延迟的主要来源不是账本计算，也不是负债分支让 DeepSeek 单次生成变慢，而是候选节点校验失败后反复重新生成整个节点。

本 Spec 做出以下设计决策：

1. 保留 `commitSimulationTransaction()` 的最终单次原子提交，不允许流式正文、局部 Patch、候选账本或 Arc 中间态提前写入 History。
2. 将提交前修复统一为：

   ```text
   首次完整生成
   → 确定性修复
   → 聚合提交前问题
   → 最多一次局部模型 Patch
   → 全量复验
   → 必要时最多一次完整重生成
   ```

3. 每个 `baseCandidateHash` 最多接受一次模型 Patch。Patch 后新暴露的问题只允许确定性修复、叙事化降级或一次完整重生成，不得再次请求 Patch。
4. 财务候选结算后的 closing facts 不再触发模型 Patch。金额、债务完成事实、Proposal 拒绝结果和报告式事实只能由代码接地或降级。
5. Patch 只能修改显式白名单 surface，不得修改锁定骨架、权威状态、已接受/拒绝事件或事务身份。
6. `baseCandidateHash` 必须覆盖锁定骨架和归一化候选；合并时哈希不一致即确定性拒绝。
7. 统一完整生成、Patch、Proposal repair、人物抽取和外层恢复的调用分类与耗时遥测，消除性能报告中的 `unknown` 调用。
8. 不降低任何财务、职业、关系、健康、Arc、DecisionGate 或事件授权校验；性能不达标时改善上下文和修复粒度，不增加重试。

### 1.1 对上游修复规则的规范性覆盖

未被本节覆盖的上游事实语义继续有效。本 Spec 只覆盖生成候选的调用预算和修复编排：

- 将债务生产 Spec §8.3 的“每个 surface 最多一次 AI repair”收紧为“单节点所有 surface 合并后最多一次模型 Patch”。
- 关系 Spec 中的“一次结构化局部 repair”并入同一个 batch Patch，不再拥有独立模型调用预算。
- 当前 `generateCompleteSimulationNode(maxAttempts=3)` 与 UI 外层 `runWithInvalidAiResponseRetry(maxAttempts=2)` 不再各自决定内容重生成次数，统一服从 `NodeGenerationBudget`。
- 上游关于局部 fallback、checkpoint reschedule、财务 authority 和关系 authority 的结果语义保持不变。

## 2. 已确认基线

### 2.1 样本 A：venture 路线

同一人物、真实 AI、两边各连续生成 15 个节点：

| 指标 | 债务分支 | 当时本地 main |
|---|---:|---:|
| 完整重生成节点 | 4/15 | 8/15 |
| 完整重生成调用 | 5 | 12 |
| 辅助/局部调用 | 13 | 7 |
| 模型调用总数 | 33 | 34 |
| 平均模型链路 | 21.1 秒 | 27.3 秒 |
| P90 | 26.3 秒 | 51.0 秒 |

该样本没有显示负债分支存在整体延迟回归，但确认财务局部调用增加。

### 2.2 样本 B：普通职业转型路线

普通家庭背景、5 万现金、无预设房贷、两边各连续生成 20 个节点：

| 指标 | 债务分支 | 当时本地 main |
|---|---:|---:|
| 完整重生成节点 | 8/20 | 6/20 |
| 完整重生成调用 | 11 | 7 |
| 辅助/局部调用 | 14 | 9 |
| 模型调用总数 | 45 | 36 |
| 平均模型链路 | 25.3 秒 | 21.5 秒 |
| P90 | 33.0 秒 | 31.9 秒 |
| 页面等待均值上界 | 27.0 秒 | 22.8 秒 |

首次完整生成耗时几乎一致：15.4 秒对 15.7 秒。额外 17.8% 平均耗时来自更多完整重生成和辅助调用。

### 2.3 合并判断

两组实验共 70 个节点、每个版本 35 个：

| 指标 | 债务分支 | 当时本地 main |
|---|---:|---:|
| 平均模型链路 | 23.5 秒 | 24.0 秒 |
| 完整重生成节点 | 12/35 | 14/35 |
| 模型调用总数 | 78 | 70 |

结论：样本足以确定优化方向，但不足以直接固化生产性能阈值。主要问题是修复粒度和重试乘法，不是负债账本计算。

## 3. 当前代码机制

### 3.1 完整生成存在两层重试

当前 `generateNextNode()` 调用 `generateCompleteSimulationNode()`；后者默认最多尝试 3 次。UI 入口又通过 `runWithInvalidAiResponseRetry()` 对完整 `generateNextNode()` 最多重跑 2 次。

这形成潜在乘法：

```text
外层完整流程重试 × 内层结构重试 × 后续领域修复调用
```

相同节点可能重新生成正文、选项、Proposal、人物和 Arc signal 多次。

### 3.2 多个修复点仍要求完整节点

当前完整节点修复至少包括：

- 已接受选择一致性修复；
- 年龄、状态、家庭、关系和债务叙事一致性修复；
- 关系权威最终修复；
- DecisionGate 最多两轮修复；
- 健康 operation 结果证据修复；
- romance contract 失败后的递归 `generateNextNode()`。

其中多数错误只影响一个段落、当前选项集合或一个 evidence，却重新生成所有 surface。

### 3.3 已有局部修复先例

当前仓库已经存在：

- 财务 Proposal 局部 repair；
- 财务叙事 surface 修复和确定性 fallback；
- 关系权威确定性降级；
- `repairDeterministicRomanceChoices()`；
- 金额、债务余额与完成事实的确定性接地。

本 Spec 不是建立第二套事实系统，而是把已有局部修复能力统一到候选节点协议下。

## 4. 目标

### 4.1 产品目标

1. 普通节点不因局部格式或事实措辞错误等待多次完整生成。
2. 用户看到的“正在推演现实影响”能够区分首次生成、局部校准和最终提交。
3. 保持当前财务、职业、关系、健康和 Arc 的事实一致性。
4. 暂停或网络失败时不留下半个节点、半笔账或半次 Arc 推进。

### 4.2 工程目标

1. 建立统一的 `NodeCandidateEnvelope`、`LockedCandidateSkeleton` 和 `NodeCandidatePatch`。
2. 建立共享的单节点调用预算，消除内外层重试乘法。
3. 将可修复问题分成 deterministic、patchable、regenerate、fatal 四类。
4. 每个候选版本最多一次模型 Patch。
5. Patch 合并后必须重新执行全部适用校验。
6. 建立可用于真实路线审计的调用级遥测。

### 4.3 成功标准

```text
authority validation regressions = 0
partial history commits = 0
duplicate domain transactions = 0
visible generation pauses = 0
model patch calls per candidate revision <= 1
full regeneration calls per node <= 1
at least 90% nodes use exactly one full generation
```

## 5. 非目标

本期不做：

- 改变 `FinancialLedger`、`CareerState`、`DebtHealth` 或 PressureArc 的事实所有权；
- 允许模型直接提交账本或世界状态；
- 把候选节点分段写入 History；
- 更换 DeepSeek 模型或供应商；
- 单纯降低 `max_tokens` 以制造表面提速；
- 放宽校验、把 error 改成 warning，或隐藏失败；
- 同时重写起始节点、时间旅行和终局报告的全部生成架构；
- 在 PR CI 中用不稳定的公网模型延迟作为唯一合并依据。

## 6. 不可破坏的不变量

### 6.1 最终单次提交

唯一允许写入历史时间线的动作仍然是：

```ts
commitSimulationTransaction(...)
```

在调用前：

- History 不得追加候选节点；
- CareerState 和 FinancialLedger 不得产生外部可见 revision；
- PressureArc 不得推进；
- report invitation 不得创建；
- 流式 preview 不得成为恢复后的正式正文。

### 6.2 候选财务结算无外部副作用

`commitAuthoritativeFinancialProgress()` 名称虽然包含 commit，但在节点管道里必须继续表现为候选计算：输入旧快照，返回新候选，不直接修改历史对象或全局存储。

相同 `transactionId` 的失败尝试、Patch 复验和完整重生成不得重复落账。

### 6.3 权威事实不由 Patch 创建

Patch 可以提出新的候选 Proposal，但不能创建：

- AcceptedFinancialEvent；
- AcceptedCareerTransition；
- 已提交的关系阶段；
- PressureArc phase；
- DebtHealth；
- closing balance；
- report invitation。

这些仍由现有 validator、reducer 和事务提交产生。

### 6.4 校验强度不降低

任何性能指标不允许通过以下方式达成：

- 跳过 validator；
- 删除 issue code；
- 把 blocking 降为 warning；
- 允许无 evidence 的 Proposal；
- 扩大模型写权限；
- 增加第二次或第三次 Patch。

## 7. 术语与生命周期

### 7.1 Candidate

`Candidate` 是尚未提交的完整节点草案。它可以被确定性修复或 Patch，但没有事实写权限。

### 7.2 Candidate revision

每次完整生成产生新的 `candidateRevision`：

```text
revision 0 = 首次完整生成
revision 1 = 唯一一次完整重生成
```

Patch 不创建新完整生成 revision，但合并成功后生成新的 `candidateHash`，并记录 `patchApplied=true`。

### 7.3 Repair epoch

本期只有两个修复阶段：

1. `pre_settlement`：财务候选结算前，可进行一次模型 Patch。
2. `post_settlement`：closing facts 已产生，只允许确定性接地或叙事化 fallback。

禁止在 `post_settlement` 发起模型 Patch，因为该 Patch 可能重新引入 Proposal、选项或 Arc signal，与已结算候选发生版本错配。

### 7.4 Locked skeleton

锁定骨架是生成本轮节点时由代码拥有、Patch 不得修改的上下文。

## 8. 目标管道

```text
准备 LockedCandidateSkeleton
→ initial_generation（完整模型调用一次）
→ parse + normalize
→ deterministic repair
→ collect pre-settlement issues
→ issues 为空：继续
→ issues 非空且全部 patchable：一次 batch Patch
→ 校验 baseCandidateHash 并原子合并 Patch
→ 重新执行全部 pre-settlement validators
→ 仍失败：deterministic fallback 或最多一次 full regeneration
→ Proposal validation
→ 候选账本与职业状态结算
→ closing facts grounding
→ post-settlement deterministic validation/fallback
→ Arc reduce
→ commitSimulationTransaction（唯一正式提交）
→ report invitation evaluation
```

完整重生成会产生新的 candidate revision，并重新从 deterministic repair 开始；该 revision 仍可使用最多一次 Patch，但单节点总 Patch 预算仍为 1，因此如果 revision 0 已消费 Patch，revision 1 不得再调用模型 Patch。

## 9. 锁定骨架

### 9.1 类型

```ts
export interface LockedCandidateSkeleton {
  simulationSeed: string;
  branchFingerprint: string;
  nodeIndex: number;
  transactionId: string;

  sourceSelectedDecision: string;
  selectedOutcomeId?: string;

  currentAgeInMonths: number;
  targetAgeInMonths: number;
  elapsedMonths: number;
  lifeIntensity: LifeIntensity;

  eventId?: string;
  eventIntentType?: string;
  allowedOutcomeIds: string[];

  foregroundPressureArcId?: string;
  pressureArcPhasePolicyId?: string;
  pressureArcPhaseId?: string;

  worldStateFingerprint: string;
  worldStateVersion: 1 | 2;
  careerRevision: number;
  relationshipRevision: number;
  familyRelationshipRevision: number;
  ledgerRevision?: number;

  authoritativeCharacterIds: string[];
  relationshipCheckpointKey?: string;
}
```

当前实现直到接近财务结算时才计算 `transactionId`。L2 必须把同一套稳定输入的 `transactionId` 计算前移到 skeleton 创建阶段；只移动确定性计算时点，不改变 transaction ID 算法或提交语义。

### 9.2 Patch 禁止修改的语义

- 上一节点已经接受的用户选择；
- 年龄、月份跨度和强度；
- 本轮事件及允许的 outcome 集合；
- 当前前台 Arc 的身份和 policy；
- 当前权威人物身份及关系 checkpoint；
- transaction、ledger/career/relationship/family revision、world state fingerprint；
- 已进入 accepted/rejected 阶段的 Proposal ID 和结论。

### 9.3 当前节点选项不是骨架

本轮即将展示给用户的新选项仍是候选内容。DecisionGate Patch 可以整体替换当前选项集合，但必须满足：

- 选项 ID 唯一；
- `eventOutcomeId` 属于 `allowedOutcomeIds`；
- 至少两个实质不同的 `decisionIntent`；
- 不修改上一节点的 `sourceSelectedDecision`；
- 不写入权威世界或财务状态。

## 10. Candidate Envelope 与哈希

### 10.1 Envelope

```ts
export interface NodeCandidateEnvelope {
  candidateRevision: 0 | 1;
  skeleton: LockedCandidateSkeleton;
  candidate: SimulationNodeCandidate;
  baseCandidateHash: string;
  patchApplied: boolean;
  patchIssueCodes: CandidateRepairIssueCode[];
}
```

`SimulationNodeCandidate` 是提交前类型，不得错误标记为已经拥有 closing `financialState`、`financialLedger` 或已提交 `worldStateSnapshot`：

```ts
export type SimulationNodeCandidate = Omit<SimulationNode,
  | "financialLedger"
  | "financialLedgerMode"
  | "financialState"
  | "debtHealthState"
  | "financialPeriodSummary"
  | "financialChange"
  | "financialProcessingMeta"
  | "worldStateSnapshot"
  | "committedArcMeta"
  | "reportInvitation"
>;
```

当前实现为了兼容校验而通过 `attachPendingFinancialContext()` 把 opening financial state 临时挂在 `SimulationNode` 上；迁移到 envelope 后，opening context 应作为独立输入传给 validator，不应伪装成候选的 closing state。

### 10.2 哈希输入

`baseCandidateHash` 使用已有 `stableHash()` 和稳定键排序，输入为：

```ts
stableHash({
  version: "node_candidate_v1",
  skeleton: normalizeLockedSkeleton(skeleton),
  candidate: normalizePatchableCandidate(candidate)
})
```

必须包含：

- 锁定骨架全部字段；
- title；
- 归一化 description paragraphs；
- choices；
- 候选 Proposal；
- `storyEpisode`、`worldDeltas`、`arcSignals`；
- 当前候选人物引用。

必须排除：

- 请求开始和结束时间；
- latency、token usage；
- provider request ID；
- attempt number；
- 流式 preview；
- UI loading 状态；
- 调试日志路径。

### 10.3 哈希闸门

Patch 合并前必须满足：

```text
patch.contractVersion === node_candidate_patch_v1
patch.baseCandidateHash === envelope.baseCandidateHash
patch.targetCandidateRevision === envelope.candidateRevision
envelope.patchApplied === false
```

任一失败返回 `STALE_OR_DUPLICATE_PATCH`，不得猜测合并，也不得消耗第二次 Patch。

## 11. Patch 契约

### 11.1 禁止通用 JSON Patch

不得采用任意路径的 RFC 6902/merge-patch。Patch 必须是按 surface 封闭枚举的结构，否则模型可以绕过锁定骨架。

### 11.2 类型

```ts
export interface NodeCandidatePatch {
  contractVersion: "node_candidate_patch_v1";
  baseCandidateHash: string;
  targetCandidateRevision: 0 | 1;
  addressedIssueCodes: CandidateRepairIssueCode[];

  titleReplacement?: string;
  descriptionParagraphPatches?: DescriptionParagraphPatch[];
  replacementChoices?: SimulationChoice[];
  proposalPatch?: CandidateProposalPatch;
  narrativeMetaPatch?: CandidateNarrativeMetaPatch;
}

export interface DescriptionParagraphPatch {
  paragraphId: string;
  expectedTextHash: string;
  replacementText: string;
}

export interface CandidateProposalPatch {
  financialEventProposals?: FinancialEventProposal[];
  employmentTransition?: EmploymentTransitionProposal | null;
  worldDeltas?: WorldDelta[];
}

export interface CandidateNarrativeMetaPatch {
  storyEpisode?: StoryEpisode;
  arcSignals?: ArcSignalProposal[];
}
```

### 11.3 paragraph ID

正文归一化后为每段生成：

```text
description:{index}:{stableHash(originalText)}
```

所有 paragraph patch 相对于同一个 base candidate 原子应用。不得按前一个 patch 的结果重新计算后一个位置。

### 11.4 白名单

允许修改：

- title 文案；
- 被明确 issue 指向的 description paragraph；
- 当前待展示的完整 choices 集合；
- 尚未校验/接受的 Proposal；
- 候选 `storyEpisode` 和 `arcSignals`。

禁止修改：

- age、ageInMonths、elapsed months；
- attributes 的权威 reconcile 结果；
- event meta 的 event ID、route、policy；
- closing ledger/state/debt health；
- accepted/rejected event；
- world snapshot；
- report invitation；
- transaction ID 或 revision。

## 12. Repair Issue 分类

### 12.1 统一 issue

```ts
export type CandidateRepairStrategy =
  | "deterministic"
  | "model_patch"
  | "full_regeneration"
  | "fatal";

export interface CandidateRepairIssue {
  code: CandidateRepairIssueCode;
  phase: "parse" | "normalize" | "pre_settlement" | "post_settlement";
  strategy: CandidateRepairStrategy;
  surfaces: CandidateSurfacePath[];
  message: string;
  authorityContext: Record<string, unknown>;
}
```

### 12.2 结构问题分类

| 问题 | 策略 |
|---|---|
| 非法 JSON、流被截断且无法解析 | `full_regeneration` |
| title 或 description 为空 | `full_regeneration` |
| choices 整体缺失或少于最低数量 | `model_patch`，只生成 choices |
| `descriptionParagraphs` 缺失 | `deterministic`，从 description 切分 |
| `expectedWorldDeltaTypes` 缺失 | `deterministic` |
| 单个 choice 缺少 outcome/intent | `model_patch`，替换 choices |
| 未知字段或模型尝试写 Arc phase | strip 后记录；若核心方向错误则 `full_regeneration` |

旧的字符串 issue 必须通过适配器映射到 typed issue；迁移完成前不得静默丢弃未知 issue，未知项默认 `full_regeneration` 并记录原始 code。

### 12.3 领域问题分类

| 问题 | 首选策略 |
|---|---|
| 正文未体现上一轮已接受行动 | 段落 Patch |
| 年龄/时态局部冲突 | 段落 Patch |
| 未经授权的家庭/关系进展 | 确定性删除/降级；无法自然连接时段落 Patch |
| DecisionGate 选项同质 | choices-only Patch |
| 健康 evidence 缺失 | 事实短句可确定性补；叙事转折用段落 Patch |
| Proposal 缺字段但证据明确 | Proposal Patch 或现有确定性 synthesis |
| Proposal 已拒绝仍声称完成 | post-settlement 确定性回退 |
| 金额、利率、余额或长浮点 | post-settlement 确定性接地 |
| 整体事件方向错误 | 完整重生成 |
| Patch 企图修改锁定骨架 | fatal patch rejection；进入完整重生成 |

## 13. 确定性修复目录

### 13.1 必须优先确定性处理

- `descriptionParagraphs` 派生；
- 金额两位小数与展示格式；
- 权威 closing balance 替换；
- 无 Accepted Event 的“已借到、已还清、已重组”回退；
- 未授权 Arc 写入删除；
- `expectedWorldDeltaTypes` 回填；
- 已知 romance choices 的规则化修复；
- 被 DecisionGate 冷却的 choices 删除；
- 明确无权威关系依据的关系升级降级；
- 可由已有 accepted event 唯一确定的 evidence/signal。

### 13.2 canonical 句子边界

只有“事实证据型短句”允许直接插入，例如：

```text
这次申请尚未形成已经到账的结果。
现有债务仍按原有安排继续偿付。
```

以下情况禁止简单追加句子，必须段落 Patch 或叙事化 fallback：

- 健康从急性危机进入长期管理；
- 关系阶段发生情绪和身份转折；
- 职业离开、退休或身份转换；
- 同一段前文已经表达相反时态或结果。

确定性插入必须发生在段落边界，并在插入后重新执行 story consistency。

## 14. Batch Patch 请求

### 14.1 聚合规则

在发起 Patch 前，一次收集所有已知 `pre_settlement` patchable issues，包括：

- selectedDecision consistency；
- story consistency；
- family/relationship authority；
- health recovery evidence；
- DecisionGate；
- event outcome coverage；
- Proposal schema/evidence；
- candidate Arc signal evidence。

不得每个 validator 各发一次请求。

### 14.2 Prompt 输入

Patch Prompt 只能接收：

- `baseCandidateHash`；
- 锁定骨架的受限摘要；
- 当前候选中允许修改的 surface；
- typed issues 和对应 authority context；
- 明确不可修改字段；
- Patch JSON schema。

不得把完整底层账本、API Key、全历史 Prompt 或无关个人数据写入 Patch 日志。

### 14.3 输出要求

模型只能返回 `NodeCandidatePatch`。若返回完整节点、额外解释或锁定字段：

- 不尝试宽松适配；
- 标记 `PATCH_CONTRACT_INVALID`；
- 不发第二次 Patch；
- 根据 issue 类型进入确定性 fallback 或完整重生成。

### 14.4 合并与复验

```text
validate patch schema
→ verify hash/revision/budget
→ verify allowed surfaces
→ atomic patch merge
→ recompute candidate hash
→ rerun every pre-settlement validator
```

不得只复验 Patch 声称解决的 issue，因为局部修改可能破坏其他证据。

## 15. 调用预算与状态机

### 15.1 共享预算

```ts
export interface NodeGenerationBudget {
  fullGenerationLimit: 2; // initial + one regeneration
  modelPatchLimit: 1;
  transientNetworkRetryPerCall: 1;
  fullGenerationsUsed: number;
  modelPatchesUsed: number;
}
```

所有 helper 和 UI 外层必须共享同一个 budget，不得各自维护独立 maxAttempts。

### 15.2 网络重试与内容重生成分离

- 同一个请求的连接中断允许一次 transient retry，不计为新的 candidate revision。
- 已收到完整模型内容但解析/校验失败，属于内容失败，不能伪装成网络重试。
- 401/403、429、quota、abort 不自动重试。

### 15.3 状态机

```text
preparing
→ generating_initial
→ validating_candidate
→ repairing_deterministic
→ repairing_patch（可选，最多一次）
→ validating_patch
→ regenerating_full（可选，最多一次）
→ settling_authority
→ grounding_closing_facts
→ validating_final
→ committing
→ revealing
```

任一状态进入 `aborted` 后不得继续提交。

## 16. 财务与 closing facts 边界

### 16.1 Pre-settlement

此阶段可以修改尚未接受的 Proposal，但不能声称 Proposal 已成功。

Patch 后必须重新运行：

- Proposal schema；
- source outcome；
- evidence；
- subject/entity boundary；
- funding trial；
- career-income atomicity。

### 16.2 Settlement

调用现有财务候选管道产生：

- accepted/rejected financial events；
- candidate ledger；
- candidate career/world state；
- closing financial state；
- closing DebtHealth。

此时 Accepted/Rejected 结论冻结，后续文案修复不得修改 Proposal 结果。

### 16.3 Post-settlement

只允许：

- `sanitizeSimulationNodeFinancialNarrative()`；
- DebtNarrativeAuthority surface repair；
- Proposal rejection narrative rollback；
- canonical closing amount replacement；
- 参数化叙事 fallback；
- 最终全量校验。

若无法安全修复，整个 candidate revision 失败；在预算允许时从旧权威状态完整重生成，不得对已结算候选进行第二次模型 Patch。

## 17. 遥测契约

### 17.1 调用分类

```ts
export type GenerationCallKind =
  | "initial_generation"
  | "candidate_patch"
  | "full_regeneration"
  | "proposal_repair"
  | "financial_narrative_repair"
  | "romance_candidate_extraction"
  | "relationship_authority_fallback"
  | "health_evidence_repair"
  | "final_outcome_generation"
  | "outer_recovery";
```

不得再把可识别调用归为 `unknown`。暂未迁移的调用必须记录 `legacy_unclassified` 并携带 caller 名称；该类型在本期完成门必须为 0。

### 17.2 事件结构

```ts
export interface GenerationCallTrace {
  traceId: string;
  transactionId?: string;
  nodeIndex?: number;
  candidateRevision?: number;
  candidateHash?: string;
  kind: GenerationCallKind | "legacy_unclassified";
  issueCodes: string[];

  startedAt: string;
  firstTokenAt?: string;
  completedAt?: string;
  durationMs?: number;

  outcome: "started" | "succeeded" | "failed" | "aborted";
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
}
```

### 17.3 隐私与体积

遥测禁止保存：

- API Key 和 Authorization header；
- 完整 Prompt；
- 完整用户回答；
- 完整模型正文；
- 底层账本明细。

本地测试 artifact 可以单独保存脱敏 Prompt，但不能进入默认 CI artifact。

### 17.4 节点级汇总

最终测试记录至少包含：

```ts
interface NodeGenerationSummary {
  fullGenerationCount: number;
  modelPatchCount: number;
  auxiliaryCallCount: number;
  totalModelCallCount: number;
  totalModelLatencyMs: number;
  firstTokenLatencyMs?: number;
  deterministicRepairCodes: string[];
  patchIssueCodes: string[];
  fullRegenerationReasonCodes: string[];
  visiblePause: boolean;
}
```

## 18. UI 进度

`NextGenerationStage` 扩展为：

```ts
type NextGenerationStage =
  | "preparing"
  | "generating"
  | "validating"
  | "repairing"
  | "finalizing"
  | "revealing";
```

建议文案：

| Stage | 标题 | 说明 |
|---|---|---|
| generating | 正在推演现实影响 | 正在形成新的经历，尚未写入时间线 |
| validating | 正在核对现实条件 | 校验年龄、事实、关系和选项 |
| repairing | 正在校准局部内容 | 只调整未通过校验的部分 |
| finalizing | 下一章即将展开 | 权威状态正在进行最终原子提交 |

UI 不展示内部 issue、账本术语或模型失败细节，但测试状态必须能看到调用计数和阶段耗时。

## 19. 错误与 fallback

### 19.1 可恢复

- recoverable missing field；
- Patch 可解决的局部不一致；
- 可确定性接地的 closing claim；
- 单次瞬时网络中断。

这些错误不得立即产生用户可见暂停。

### 19.2 必须完整重生成

- JSON 无法解析；
- 核心 title/description 缺失；
- 整体事件方向错误；
- 上一步用户选择被整体改写；
- Patch 修改锁定骨架；
- Patch 后仍存在无法确定性降级的 blocking issue。

### 19.3 必须停止

- 预算耗尽；
- auth、quota、rate limit；
- 用户 abort；
- 账本不变量失败；
- transaction revision 冲突；
- 最终候选仍包含权威冲突。

停止时不得写入新节点。用户可以重试同一选择，但必须创建新的 generation trace；transaction identity 继续保证幂等。

## 20. 文件级实施清单

### 20.1 新增

```text
src/services/simulation/nodeCandidateTypes.ts
src/services/simulation/nodeCandidateHash.ts
src/services/simulation/nodeCandidateIssues.ts
src/services/simulation/nodeCandidateDeterministicRepair.ts
src/services/simulation/nodeCandidatePatch.ts
src/services/simulation/nodeCandidatePatchPrompt.ts
src/services/simulation/nodeGenerationBudget.ts
src/services/simulation/generationTelemetry.ts
```

对应测试文件与源码同目录。

### 20.2 修改

```text
src/services/simulation/simulationService.ts
src/services/simulation/prompts.ts
src/utils/simulationNodeRetry.ts
src/utils/generationRetry.ts
src/utils/simulationResponse.ts
src/utils/storyConsistency.ts
src/utils/decisionGate.ts
src/App.tsx
src/components/SimulationEngine.tsx
src/components/SimulationEngine.test.tsx
scripts/financial-real-browser-audit-helpers.mjs
scripts/analyze-financial-real-browser-run.mjs
scripts/real-browser-journey-runner.mjs
package.json
.github/workflows/ci.yml
```

### 20.3 不应修改

除非测试证明存在独立 bug，本期不修改：

```text
src/domain/finance/reduceFinancialLedger.ts
src/domain/finance/accruePeriod.ts
src/domain/finance/debtHealth.ts
src/utils/arcLifecycle.ts 的 phase 语义
FinancialLedger schema
DebtHealth 阈值
```

## 21. 测试规格

### 21.1 Hash 与锁定骨架

1. 相同 skeleton/candidate 的哈希稳定。
2. telemetry 时间变化不影响哈希。
3. 正文、选项、Proposal 或 skeleton 任一变化都会改变哈希。
4. stale hash Patch 被拒绝且候选不变。
5. 重复 Patch 被拒绝。
6. Patch 修改 age、event、Arc、revision 或 transaction 时被拒绝。

### 21.2 Patch 合并

1. 多个 paragraph patch 相对同一 base 原子应用。
2. 一个 paragraph hash 不匹配时整个 Patch 失败，不部分应用。
3. choices-only Patch 不改变正文和 Proposal。
4. proposal-only Patch 不改变选项和 Arc signal。
5. Patch 合并后运行全部 validator，而非仅运行命中 validator。

### 21.3 Repair budget

1. 单节点最多两次完整生成。
2. 单节点最多一次模型 Patch。
3. 外层 retry 和内层 retry 共享预算，不产生 2×3 调用。
4. 网络 retry 不创建新 candidate revision。
5. abort 后任何 pending response 不得提交。

### 21.4 场景回归

至少覆盖：

- selectedDecision 只缺一个结果段落；
- DecisionGate 只有 choices 同质；
- health operation 缺 evidence 且正文时态一致；
- health operation 前文仍是急性恶化，禁止机械拼接恢复句；
- 普通事件越权生成爱情关系；
- Proposal 被拒但正文声称借款到账；
- closing debt balance 与正文不一致；
- romance event 的 outcome coverage 缺失；
- Patch 后关系 evidence 被财务接地改写；
- Patch 后发生账本 invariant failure，确认零提交。

### 21.5 原子提交回归

失败和重试路径必须断言：

```text
history length unchanged
ledger revision unchanged
career revision unchanged
world state fingerprint and relationship/family revisions unchanged
pressure arc checkpoint unchanged
report invitation unchanged
```

成功路径必须断言以上对象在同一个 transaction 中提交一次。

## 22. CI 与性能验收

### 22.1 PR 确定性门禁

新增：

```json
{
  "test:generation-candidate-patch": "node --import tsx --test src/services/simulation/nodeCandidate*.test.ts",
  "test:generation-budget": "node --import tsx --test src/services/simulation/nodeGenerationBudget.test.ts src/utils/generationRetry.test.ts src/utils/simulationNodeRetry.test.ts",
  "test:generation-authority-regression": "node --import tsx --test src/services/simulation/simulationService.test.ts src/utils/simulationTransaction.test.ts"
}
```

PR CI 必须运行：

```text
candidate patch contract
→ shared budget
→ generation authority regression
→ financial production blockers
→ M5
→ M7
→ full test
→ lint
→ build
```

PR CI 使用固定 caller 和合成 latency，验证调用预算与状态机；不依赖公网模型延迟。

### 22.2 真实 AI 性能基线

发布前运行：

- 3 类人物：普通职业、关系/健康交错、财务/创业；
- 每类 3 轮；
- 每轮 20 节点；
- 总计 180 节点；
- 与同一提交、关闭 Patch flag 的控制组对比；
- 相同 persona、选择策略、模型、Prompt 版本和网络环境。

### 22.3 性能门禁

在 180 节点基线建立后，必须满足：

```text
P90 latency <= control P90 * 1.10
full-regeneration node rate <= control + 5 percentage points
nodes with exactly one full generation >= 90%
model patch calls per node <= 1
patch success rate >= 50%
visible generation pauses = 0
authority regressions = 0
```

Patch 成功率低于 50% 时停止扩大 rollout。修复方式是补充 Patch authority context 或改进确定性 fallback，不增加 Patch 次数、不放松校验。

### 22.4 真实 AI 工作流

真实模型性能测试放入单独的 `workflow_dispatch` 或受保护的 release workflow，需要显式 API secret。它不作为普通 PR 的公网波动型硬阻断，但其最新同提交报告是发布门禁。

## 23. 分阶段开发计划

### L0：Spec 确认

交付本文件。用户确认前不得修改生产代码。

### L1：调用分类与遥测

交付：

- `GenerationCallKind`；
- call trace 与节点汇总；
- 所有现有 AI caller 显式分类；
- 本地 artifact analyzer；
- `legacy_unclassified = 0` 测试。

本阶段不得改变生成结果和重试行为。

### L2：Candidate、Hash 与共享预算

交付：

- envelope、skeleton、hash；
- typed issue 适配器；
- Patch schema/validator/atomic merge；
- shared budget；
- shadow mode，只计算 Patch 可行性，不改变正式候选。

### L3：状态一致性与 DecisionGate

交付：

- 聚合 pre-settlement issues；
- selectedDecision/story paragraph Patch；
- choices-only DecisionGate Patch；
- 每候选最多一次 Patch；
- 完整全量复验。

### L4：健康、incomplete 与关系权威

交付：

- 健康 evidence 分类：canonical short fact vs paragraph Patch；
- incomplete output 四级分类；
- 关系权威确定性降级统一接入；
- romance recursive regeneration 改为受共享预算控制。

### L5：Closing facts 与恢复链收口

交付：

- post-settlement 禁止模型 Patch；
- closing facts deterministic grounding；
- Proposal rejection narrative rollback；
- 删除重复/嵌套完整重试路径；
- UI `repairing` stage。

### L6：验收

交付：

- 全量测试、M5、M7、财务生产门禁；
- 180 节点真实 AI 对照；
- 性能报告和发布判断；
- 无用户可见暂停的新鲜路线证据。

L1–L6 中间不因普通绿灯暂停开发；任一阶段出现权威事实回归、原子提交破坏或 Patch 成功率低于 50%，停止后续 rollout 并修订本 Spec。

## 24. Feature Flags 与发布

```ts
interface CandidateRepairFeatureFlags {
  enableGenerationTelemetry: boolean;
  enableCandidatePatchShadow: boolean;
  enableCandidatePatchRepair: boolean;
  enableSharedGenerationBudget: boolean;
}
```

发布顺序：

```text
telemetry on
→ Patch shadow on
→ 对比 shadow recommendation 与当前结果
→ 小流量 Patch repair
→ shared budget enforcement
→ 全量启用
```

回滚时关闭 `enableCandidatePatchRepair` 和 `enableSharedGenerationBudget`，恢复当前完整生成路径；遥测保持开启，用于确认回滚效果。

## 25. 风险与控制

| 风险 | 控制 |
|---|---|
| Patch 与候选不是同一版本 | skeleton + normalized candidate hash；不匹配拒绝 |
| 局部修复破坏其他 evidence | Patch 后运行全部 validator |
| 一次 Patch 同时处理过多问题质量下降 | issues 按 surface 结构化，提供最小权威上下文 |
| canonical 句子产生缝合感 | 只允许事实短句；叙事转折走 paragraph Patch/fallback |
| Patch 次数重新膨胀 | shared budget；每节点总 Patch 上限 1 |
| 内外 retry 再次相乘 | 所有 helper 共享同一个 budget |
| closing facts 与 Patch 版本错配 | post-settlement 禁止模型 Patch |
| 性能门禁导致校验被放松 | authority regression 先于性能 gate；非目标明确禁止 |
| 公网模型性能波动导致 CI 假红 | PR 用确定性预算 gate；真实 AI 用同提交对照发布 gate |
| 遥测泄露用户内容或密钥 | 默认只记录枚举、哈希、计时和 token，不记录 Prompt |

## 26. Definition of Done

以下条件全部满足才算完成：

1. 所有 AI 调用具有非 `unknown` 分类。
2. `NodeCandidatePatch` 只能修改白名单 surface。
3. stale、重复或越权 Patch 100% 被确定性拒绝。
4. 每节点模型 Patch 不超过一次。
5. 每节点完整生成不超过两次。
6. 外层与内层重试不再形成乘法。
7. post-settlement 不存在模型 Patch。
8. 所有 Patch 合并后执行全量 validator。
9. 失败、abort 和预算耗尽路径对 History、Ledger、Career、World、Arc 均零提交。
10. 财务生产门禁、M5、M7、全量测试、lint 和 build 全绿。
11. 180 节点性能门禁通过。
12. 用户可见生成暂停为 0。
13. 权威事实回归为 0。

## 27. 最终原则

```text
模型可以修文案和候选方案，不能修权威事实。
局部问题优先局部修复，不能用整节点重掷掩盖。
Patch 必须绑定候选版本，不能跨版本猜测合并。
closing facts 由代码接地，不能再交给模型重新决定。
无论生成和修复经过多少候选步骤，正式时间线只提交一次。
性能优化不能以真实性、可审计性或原子性为代价。
```
