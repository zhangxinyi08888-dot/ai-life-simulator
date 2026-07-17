# 四模式人生事件库重构：可直接开发 Spec

## 1. 文档状态

- 状态：待开发
- 目标版本：分四个 Phase 增量上线
- 核心交付：四模式选择器、轻量因果条件、完整新增事件库、世界事实升级路线、长期因果系统升级路线
- 当前基线：`src/data/lifeEvents.ts` 中 14 个事件，其中 12 个可进入随机池、2 个为健康 Arc 专用事件
- 兼容原则：Phase 1–2 不改 `queryDynamicLifeEvent()` 的公开签名，不改 `generateNextNode()` 的事件调度优先级，不重构现有 `PressureArc`

## 2. 背景与问题定义

当前事件系统的主要偏差不是单条 Prompt 文案，而是以下结构共同造成：

1. 随机事件池以压力、危机和高风险机会为主，平稳生活只有 `life_normal_transition` 一张卡。
2. `queryDynamicLifeEvent()` 在存在戏剧候选时主动排除 `life_normal_transition`，随后以固定空事件概率决定是否返回 `null`，其余路径必选戏剧事件。
3. 标签和类别过滤为空时会恢复旧候选，导致冷却和防重复在候选不足时失效。
4. 多个事件把属性分数当作世界事实，例如高幸福推导亲密承诺、高智力推导成果争夺。
5. 恢复、成长、连接和意义没有可靠来源，模型只能临时编造“开始运动”“想开了”等万能解释。
6. 当前 `HistoryItem` 保存选项列表和选中文字，但没有直接保存最终 `decisionIntent`，不利于轻量因果判断。
7. 当前 `PersonState` 允许低置信度模型推断，尚不足以支持所有关系事件绑定精确 `personId`。

本 Spec 不把事件机械调整为正负 50:50，而是建立四种都能自然发生的生活模式：

| 模式 | 作用 | 主要来源 |
|---|---|---|
| `pressure_crisis` | 打破旧平衡 | 外部冲击、风险累积、未解决压力 |
| `crossroads_opportunity` | 改变方向 | 人生阶段、外部机会、用户主动寻找 |
| `recovery_growth` | 让选择产生结果 | 前期选择、持续投入、时间和支持条件 |
| `stability_meaning` | 表现真实生活复利 | 习惯、陪伴、兴趣、信誉和微资产积累 |

核心原则：

> 危机可以在满足事实条件时随机到来；恢复、成长、连接和成果兑现必须主要来自此前选择、时间与积累。

## 3. 目标

### 3.1 产品目标

- 平稳生活成为一等叙事模式，不再只是候选耗尽后的兜底。
- 危机之后能够自然进入调整、恢复、成长或重新分岔。
- 用户持续执行某类选择后，系统能够生成可追溯的阶段结果。
- “坚持后好转”“主动放手”“关系修复”“身体恢复”“平淡中形成意义”成为可稳定到达的叙事结构。
- 不同核心主题在事件分布、人物关系和结果路径上产生可观察差异。
- 80 岁以上没有职业上下文时，仍能通过 `self`、健康、关系和平稳意义事件继续面向未来。

### 3.2 工程目标

- Phase 1 保持 `queryDynamicLifeEvent(attribs, userData, age, history, answers)` 签名不变。
- Phase 1 保持现有调度优先级：活动 PressureArc → 健康升级 → 普通动态事件。
- Phase 1 不新增持久化状态版本，不增加 `WorldStateSnapshot.version`。
- Phase 2 只增加可选的 `selectedDecisionIntent` 和事件轻量条件，不引入 `CausalProgress`。
- Phase 3 完成事实可靠性后再引入独立 `community` 领域和精确人物约束。
- Phase 4 才引入正式 `EventSource`、`CausalProgress` 和到期结果队列。

## 4. 非目标

- 不把所有路线强制按四模式固定循环。
- 不把正向事件写成无条件奖励或童话式成功。
- 不禁止失败、疾病、失业、冲突、债务和死亡。
- Phase 1–2 不泛化或替换 `PressureArcState`。
- Phase 1–2 不要求所有关系事件绑定精确 `personId`。
- Phase 1–2 不创建独立社区人物模型。
- 不一次性迁移旧历史；旧历史缺少新字段时必须可正常恢复。
- 不用正文关键词直接判定严重疾病、债务或关系身份。
- 不允许新增事件绕过健康升级、年龄一致性、财务连续性和终局策略。

## 5. 分阶段实施总览

| Phase | 目标 | 核心改动 | 明确不做 |
|---|---|---|---|
| Phase 1 | 修正选择行为 | 四模式、候选感知权重、模式疲劳、严格过滤、平稳事件入池 | 新持久化状态、精确事实、完整新增事件 |
| Phase 2 | 补齐内容和轻量因果 | 新增 37 个正式事件、`historyConditionGroups`、`requiredContextGroups`、模式 Prompt、保存最终选择意图 | `CausalProgress`、独立 community、精确事实图谱 |
| Phase 3 | 提升事实可靠性 | `WorldFactCondition`、人物置信度、项目/组织/债务事实、6 个 community 事件 | 统一长期因果状态机 |
| Phase 4 | 建立长期因果调度 | `EventSource`、`CausalProgress`、到期结果队列、跨窗口积累 | 本 Spec 之外的 UI 或报告重构 |

Phase 必须按顺序合并；Phase 2 的内容分布评估通过后，才能开始 Phase 3。

### 5.1 与主角画像 Spec 的依赖边界

事件库与主角画像可以独立推进，Phase 3 不设置循环阻塞：

- 事件库 Phase 3A 可以继续使用 Phase 2 `requiredContextGroups` 的简化可靠条件。
- 主角画像 Phase 4 完成三态 `resolveProfileFact()` 后，事件库 Phase 3B 再将相关条件升级为完整 `WorldFactCondition`。
- Phase 3A 无可靠证据时按“不满足”处理；Phase 3B 才正式区分 `satisfied`、`unsatisfied` 和 `unknown`。
- 迁移中的同一事件只能选择一个硬条件入口，禁止 `requiredContextGroups` 与 `requiredFactGroups` 同时对同一事实作矛盾判定。
- community 精确人物约束、重大关系、债务、裁员和重大疾病等依赖可靠事实的事件，必须等到其所需事实源可用后才能进入正式随机池；不能用简化条件降低安全门槛。

## 6. Phase 1：四模式选择器

### 6.1 类型改动

在 `src/types.ts` 增加 `NarrativeMode`，在 `src/data/lifeEvents.ts` 导入并扩展 `LifeEventSeed`：

```ts
export type NarrativeMode =
  | "pressure_crisis"
  | "crossroads_opportunity"
  | "recovery_growth"
  | "stability_meaning";

export interface LifeEventSeed {
  // 现有字段保持不变
  narrativeMode: NarrativeMode;
  semanticFamily: string;
}
```

同时为历史去重增加可选元数据：

```ts
export interface EventMeta {
  // 现有字段保持不变
  eventMode?: NarrativeMode;
  eventSemanticFamily?: string;
}
```

`buildEventMeta()` 必须写入这两个字段。旧历史缺失时通过 `eventId` 查当前事件库回退；查不到时不计入模式疲劳和语义冷却。

Phase 1 要求所有现有事件显式填写 `narrativeMode`，不得依赖运行时根据 `emotionalTone` 猜测。迁移表：

| 现有事件 | narrativeMode | semanticFamily |
|---|---|---|
| `career_venture_pressure` | `crossroads_opportunity` | `career_transition` |
| `career_responsibility_shift` | `pressure_crisis` | `career_scope_change` |
| `career_structural_instability` | `pressure_crisis` | `career_structural_instability` |
| `career_credit_ownership_conflict` | `pressure_crisis` | `career_credit_ownership` |
| `relationship_material_commitment_test` | `crossroads_opportunity` | `relationship_commitment` |
| `relationship_family_obligation_pull` | `pressure_crisis` | `family_responsibility` |
| `relationship_trust_interest_fracture` | `pressure_crisis` | `relationship_trust_fracture` |
| `health_system_warning` | `pressure_crisis` | `health_system_warning` |
| `health_forced_pause` | `pressure_crisis` | `health_acute_crisis` |
| `health_recovery_observation` | `recovery_growth` | `health_recovery_observation` |
| `opportunity_unstable_alliance` | `crossroads_opportunity` | `career_alliance_opportunity` |
| `opportunity_escape_route` | `crossroads_opportunity` | `self_escape_route` |
| `financial_side_path_conflict` | `crossroads_opportunity` | `financial_side_path` |
| `life_normal_transition` | `stability_meaning` | `life_normal_accumulation` |

### 6.2 模式权重

新增 `src/config/narrativeModePolicy.ts`：

```ts
export interface NarrativeModeWeights {
  pressure_crisis: number;
  crossroads_opportunity: number;
  recovery_growth: number;
  stability_meaning: number;
}

export const DEFAULT_MODE_WEIGHTS: NarrativeModeWeights = {
  pressure_crisis: 0.18,
  crossroads_opportunity: 0.24,
  recovery_growth: 0.26,
  stability_meaning: 0.32
};
```

这些值是归一化前的基础权重，不是永久事件比例。`computeModeWeights()` 必须按以下条件调整：

| 条件 | 调整 |
|---|---|
| 最近 2 个有事件节点都是 `pressure_crisis` | 压力 ×0.15；恢复 ×1.8；平稳 ×1.6 |
| 最近 1 个节点为 major crisis | 压力 ×0.1；恢复 ×2.0；平稳 ×1.8 |
| 最近 3 个节点至少 2 个为 `recovery_growth` | 恢复 ×0.55；平稳 ×1.25；分岔 ×1.2 |
| 最近 3 个节点至少 2 个为 `stability_meaning` | 平稳 ×0.65；分岔 ×1.35；成长 ×1.15 |
| `health < 42` | 压力 ×1.35，但健康强制升级仍由现有独立入口控制 |
| `health >= 55 && wealth >= 50 && happiness >= 55` | 平稳 ×1.25；成长 ×1.2；压力 ×0.75 |
| `coreStoryFocus=career` | 职业候选在模式内加权，不直接改变模式 |
| `coreStoryFocus=romance` | 关系候选在模式内加权，不绕过关系上下文 |
| `coreStoryFocus=selftruth` | 恢复 ×1.25；平稳 ×1.2；分岔 ×1.1 |
| `coreStoryFocus=innerpeace` | 恢复 ×1.35；平稳 ×1.3；压力 ×0.75 |
| 最近选择包含明确高风险 intent | 分岔 ×1.35；压力 ×1.25；平稳 ×0.8 |

最后将负数和非有限值归零，再在有候选的模式之间归一化。

### 6.3 模式疲劳

新增纯函数：

```ts
export function applyModeFatigue(
  weights: NarrativeModeWeights,
  history: HistoryItem[]
): NarrativeModeWeights;
```

规则：

- 只读取最近 3 个有 `eventMeta.eventId` 的历史节点。
- 连续两个 `pressure_crisis` 后，本轮压力模式权重最多为所有可用模式总权重的 10%。
- major crisis 后的下一次新事件选择，如果存在恢复或平稳候选，压力模式权重必须为 0。
- 活跃 PressureArc 的 acute/trigger 阶段不通过本函数选择；后段 `selectArcContinuationEvent()` 可以调用 `queryDynamicLifeEvent()`，此时模式疲劳正常生效，但结果仍须通过现有 safe continuation 过滤，且不得改变 Arc 状态。
- 用户明确连续选择高风险 intent 时，可以保留压力权重，但不得绕过 major crisis 后喘息规则。

### 6.4 严格过滤

Phase 1 必须删除以下两种回退：

```ts
tagAllowedCandidates.length > 0
  ? tagAllowedCandidates
  : nonCooledCandidates;

categoryAllowedCandidates.length > 0
  ? categoryAllowedCandidates
  : similaritySafeCandidates;
```

新规则：

```text
年龄与基础 eligibility
→ 事件冷却
→ 标签相似度过滤
→ 连续类别过滤
→ 按模式分组
```

任何一步为空都不得恢复之前被过滤的事件。

### 6.5 候选感知模式选择

新增模块私有或独立纯函数：

```ts
function groupCandidatesByMode(
  candidates: LifeEventSeed[]
): Record<NarrativeMode, LifeEventSeed[]>;

function pickModeByWeight(
  weights: NarrativeModeWeights
): NarrativeMode | null;
```

没有候选的模式权重必须设为 0。不能先抽到一个空模式后固定回退平稳模式，因为这会掩盖其他仍有候选的模式。

### 6.6 `null` 语义

Phase 1 删除全局 `NULL_EVENT_CHANCE`。

- 有合法模式候选：必须从所选模式中选一张事件卡。
- 所有候选为空：返回 `null`，使用现有 `buildNullEventPrompt()` 延续上一选择的普通后果。
- `stability_meaning` 表示有明确积累主题的平稳事件；`null` 表示没有合适事件种子。两者不能再通过第二次随机门混用。

### 6.7 重大危机后喘息

在模式选择前执行：

```ts
if (hasRecentMajorEvent(history) && hasStableBreathingRoom(attribs)) {
  return stabilityCandidates.length > 0
    ? pickWeighted(stabilityCandidates, userData, age, history)
    : null;
}
```

该规则优先级高于普通模式权重。

### 6.8 Phase 1 最终算法

```ts
export function queryDynamicLifeEvent(
  attribs: LifeAttributes,
  userData: UserEventData,
  age: number,
  history: HistoryItem[] = [],
  answers?: unknown
): LifeEventSeed | null {
  const eligible = LIFE_EVENTS_DATABASE.filter((event) =>
    satisfiesHardAgeConstraint(event, age)
    && isEligibleForCandidatePool(event, attribs, userData, age, answers)
  );

  const nonCooled = eligible.filter((event) =>
    !isEventInCooldown(event, history)
  );
  const tagSafe = nonCooled.filter((event) =>
    !isTagSimilarToRecent(event, history)
  );
  const finalCandidates = tagSafe.filter((event) =>
    !isCategoryLimited(event, history)
  );

  const byMode = groupCandidatesByMode(finalCandidates);

  if (hasRecentMajorEvent(history) && hasStableBreathingRoom(attribs)) {
    return pickWeighted(
      byMode.stability_meaning,
      userData,
      age,
      history
    );
  }

  if (finalCandidates.length === 0) return null;

  let weights = computeModeWeights(attribs, history, userData);
  weights = zeroUnavailableModeWeights(weights, byMode);
  weights = applyModeFatigue(weights, history);

  const mode = pickModeByWeight(weights);
  if (!mode) return null;

  return pickWeighted(byMode[mode], userData, age, history);
}
```

`pickWeighted([])` 必须安全返回 `null`。

### 6.9 与 PressureArc 后段事件解耦的关系

当前 `selectArcContinuationEvent()` 会在非急性 Arc 阶段调用 `queryDynamicLifeEvent()`。Phase 1 不修改该函数的公开行为：

- 健康或通用 Arc 的 acute/trigger 阶段继续使用原事件；
- recovery/growth/operation 等后段可以使用四模式选择结果；
- 所选事件仍必须满足现有 `isSafeArcContinuationEvent()`；
- 不安全或无候选时继续回退现有 Arc presentation event；
- 动态事件不得创建第二条 Arc，不覆盖 Arc phase 的时间强度，不改变 `committedArcMeta`。

因此 Phase 1 的统计测试必须分别覆盖“无 Arc 新事件选择”和“Arc 后段安全展示事件选择”，不能用前者证明后者无回归。

## 7. Phase 2：轻量因果与上下文条件

### 7.1 保存最终选择意图

在 `src/types.ts` 中增加：

```ts
export interface HistoryItem {
  // 现有字段不变
  selectedDecisionIntent?: string;
}
```

写入历史时：

1. 找到 `choice.text === selectedChoice` 的选项；
2. 优先保存该选项的 `decisionIntent`；
3. 自定义选择或旧节点缺失时调用 `normalizeDecisionIntent()`；
4. 旧历史缺失字段时，评估器仍按上述方式从选项回退推导。

### 7.2 轻量历史条件类型

在 `src/data/lifeEvents.ts` 或新建 `src/utils/eventEligibility.ts`：

```ts
export type EventHistoryCondition =
  | {
      type: "selected_intent_count";
      intentPrefixes: string[];
      minCount: number;
      withinNodes?: number;
      withinMonths?: number;
    }
  | {
      type: "elapsed_since_event";
      eventIds?: string[];
      semanticFamilies?: string[];
      minMonths: number;
      maxMonths?: number;
    }
  | {
      type: "attribute_trend";
      attribute: keyof LifeAttributes;
      direction: "improving" | "declining" | "stable";
      withinNodes: number;
      minimumDelta?: number;
    }
  | {
      type: "recent_mode_count";
      modes: NarrativeMode[];
      minCount: number;
      withinNodes: number;
    }
  | {
      type: "event_absent";
      eventIds?: string[];
      semanticFamilies?: string[];
      withinNodes?: number;
      withinMonths?: number;
    };
```

同一 `historyConditionGroups` 子数组内使用 AND 语义。需要 OR 时，通过多个子数组表示“组内 AND、组间 OR”。Phase 2 不支持任意嵌套布尔表达式。

### 7.3 轻量上下文条件

```ts
export type RequiredContextKey =
  | "career_active"
  | "career_or_creation_direction"
  | "active_project_context"
  | "identified_life_constraint"
  | "confirmed_partner"
  | "confirmed_family"
  | "confirmed_friend_or_colleague"
  | "financial_state_available"
  | "debt_present"
  | "learning_or_creation_direction"
  | "health_recovery_context";

export interface LifeEventSeed {
  historyConditionGroups?: EventHistoryCondition[][];
  requiredContextGroups?: RequiredContextKey[][];
}
```

`requiredContextGroups` 与历史条件相同：组内 AND、组间 OR。例如：

```ts
requiredContextGroups: [
  ["confirmed_partner"],
  ["confirmed_family"]
]
```

表示伴侣或家庭上下文满足任意一类即可。字段缺失或空数组表示无上下文硬条件。

上下文判定必须使用结构化信息优先：

| Key | Phase 2 判定 |
|---|---|
| `career_active` | 最近 `primaryActivity.domain=career`，或 `WorldStateSnapshot.careerSummary` 非空，或用户职业里程碑/当前描述明确存在工作、项目、研究、创作 |
| `career_or_creation_direction` | 活跃 `DirectionArc` 指向职业、创业、项目、研究、写作或创作 |
| `active_project_context` | 最近8节点存在尚未收束的项目/作品/研究方向，且至少一次被用户选择继续；单次模型临时提及不满足 |
| `identified_life_constraint` | 用户资料、追问或已接受历史明确存在尚未解决的职业、地点、关系、财务或生活结构困局；低 happiness 本身不满足 |
| `confirmed_partner` | 用户事实/追问明确存在伴侣，或最近历史中 partner 的 `source` 非 `model_inferred` 且 `confidence>=0.75`、`lifeStatus` 非 distant/deceased |
| `confirmed_family` | 用户事实/追问明确存在对应家庭关系，或 parent/child/sibling 的可靠人物状态满足上条置信度规则 |
| `confirmed_friend_or_colleague` | 最近历史存在 friend/colleague/mentor 且 `source` 非 `model_inferred`、`confidence>=0.7` |
| `financial_state_available` | 最近节点存在 `financialState` |
| `debt_present` | 最近 `financialState.totalDebtWan > 0` |
| `learning_or_creation_direction` | 活跃 DirectionArc 或用户主线明确指向学习、研究、写作、创作、技能 |
| `health_recovery_context` | 最近 8 个节点出现健康预警/停摆/恢复事件，或健康 Arc 处于 recovery/operation |

仅有 `model_inferred + confidence=0.55` 不得满足 `confirmed_partner`。

### 7.4 eligibility 评估顺序

```text
dispatchMode
→ hardAgeConstraint
→ trigger.eligibility
→ requiredContextGroups
→ historyConditionGroups
→ 冷却/语义/类别过滤
```

`trigger.eligibility` 不再允许关系上下文无条件绕过所有关系事件。关系事件必须各自声明 `requiredContextGroups`。

### 7.5 时间计算

- `withinNodes` 使用历史数组索引窗口。
- `withinMonths` 和 `elapsed_since_event` 使用 `ageInMonths ?? age * 12`。
- 同时提供 `withinNodes` 和 `withinMonths` 时必须同时满足。
- 属性趋势使用窗口内最早值和当前值；`improving` 要求差值 `>= minimumDelta`，`declining` 要求差值 `<= -minimumDelta`，`stable` 要求绝对差值 `< minimumDelta`。

## 8. Prompt 契约

在 `src/utils/eventPrompt.ts` 新增按模式规则：

### 8.1 通用现实主义原则

替换“必须体现真实生活代价与选择”为：

```text
必须体现现实条件、行动成本和真实反馈。结果可以恶化、持平或改善；改善必须来自已经发生的选择、投入、支持、能力、关系或资源变化。不得为了维持戏剧性而立即用新的事故、背叛、疾病、失业或重大损失抵消已有改善。
```

对有事件种子的节点，Prompt 还必须要求每个选择返回 `eventOutcomeId`，取值只能来自当前事件的 `allowedOutcomes`；三个选择至少覆盖两个不同 ID。`eventOutcomeId` 是 Phase 2 的轻量校验字段，不授权模型直接修改世界状态。

### 8.2 `pressure_crisis`

- 必须使用事件已有事实，不得临时增加第二个无关危机。
- 三个选项至少覆盖两种战略：承受/调整/求助/退出/重组中的不同方向。
- 不得把三个选项都写成不同程度的继续坚持。
- major crisis 必须服从已有 Arc 和节点密度限制。

### 8.3 `crossroads_opportunity`

- 每条路都有现实收益和代价。
- 至少两条路径改变不同世界状态或长期方向。
- 不得把所有机会写成高风险押注。
- 允许稳健转型、试点、延迟承诺和阶段性尝试。

### 8.4 `recovery_growth`

- 正文必须明确引用至少一项满足 eligibility 的历史选择、经过时间、属性趋势或支持条件。
- 允许部分改善、条件改善、能力形成或重新定向，不承诺完美成功。
- 不得在同一节点引入新的无关重大危机抵消结果。
- 选择应围绕如何巩固、调整、扩大或重新定义成果。

### 8.5 `stability_meaning`

- 必须推进一项已有方向、关系、习惯、能力、信誉或生活安排。
- 不得新增重大危机。
- 至少形成一个可在后续引用的具体变化；Phase 2 可通过 `worldDeltas` 或摘要表达，不新增持久化微资产字段。
- 平稳不等于退休、回忆或被动等待；所有年龄都必须保持未来导向。

## 9. 现有事件修订要求

新增事件上线前，必须同时修订以下旧事件：

| 事件 | 修订 |
|---|---|
| `career_venture_pressure` | 要求 `career_or_creation_direction`；机会允许试点，不只允许高风险跃迁 |
| `career_responsibility_shift` | 要求 `career_active`，删除单靠 relation/wealth 创造组织责任的路径 |
| `career_structural_instability` | 要求 `career_active` 或真实财务压力；财富低只做权重 |
| `career_credit_ownership_conflict` | Phase 2 至少要求 `career_or_creation_direction`；Phase 3 再要求具体项目/协作者事实 |
| `relationship_material_commitment_test` | 要求 `confirmed_partner`，改名可保留 ID；不再由 happiness 单独触发 |
| `relationship_family_obligation_pull` | 要求 `confirmed_family`；relation/happiness 只做亲和度 |
| `relationship_trust_interest_fracture` | 要求 `confirmed_partner` 或 `confirmed_friend_or_colleague`；不得把所有重要关系都默认成背叛 |
| `opportunity_unstable_alliance` | 要求职业/创作方向；提供小规模试点结果原语 |
| `opportunity_escape_route` | 要求已有可识别困局；低 happiness 不能独立创造异地机会 |
| `financial_side_path_conflict` | 要求 `financial_state_available` 和职业/技能方向；删除 `reduce_and_hide_exposure`，不得鼓励隐瞒合规风险 |
| `life_normal_transition` | 保持永久可 eligible，正式参与 `stability_meaning` 模式内抽取 |

健康预警、强制停摆和恢复观察继续遵守已有健康 Specs，不回退其触发阈值和专用 Arc。

### 9.1 旧事件修订后的精确契约

以下字段覆盖原定义；未列出的 title、category、年龄、冷却、temporalProfile 和 tags 保持现状。

| eventId | requiredContextGroups | trigger/history 修订 | allowedOutcomes |
|---|---|---|---|
| `career_venture_pressure` | `[["career_or_creation_direction"]]` | intelligence>=60；财富只进入权重；最近6节点无 `career_transition` | `run_limited_venture_pilot`, `stay_lean_and_preserve_optionality`, `commit_to_high_risk_leap` |
| `career_responsibility_shift` | `[["career_active"]]` | 最近6节点存在承担职责、团队协作或组织变化事实；不得由 relation/wealth 单独触发 | `accept_limited_responsibility`, `draw_explicit_responsibility_boundary`, `seek_rule_based_mediation` |
| `career_structural_instability` | `[["career_active"]]` | incomeStability 为 unstable/volatile，或已接受历史明确存在岗位/行业变化；wealth<45只提高权重 | `stabilize_immediate_cashflow`, `invest_in_gradual_transition`, `activate_verified_network_support` |
| `career_credit_ownership_conflict` | `[["active_project_context"]]` | 最近历史必须已有协作者/组织或成果归属疑问；intelligence 只提高权重 | `document_and_negotiate_ownership`, `challenge_credit_capture_formally`, `preserve_core_work_and_exit` |
| `relationship_material_commitment_test` | `[["confirmed_partner"]]` | 最近8节点已有共同计划/关系推进；happiness 不再作为 eligibility | `make_shared_commitment_plan`, `delay_with_clear_conditions`, `reassess_relationship_fit` |
| `relationship_family_obligation_pull` | `[["confirmed_family"]]` | 最近历史已有具体家庭请求、照护或资源压力；relation/happiness 只做权重 | `offer_bounded_family_support`, `set_firm_family_boundary`, `renegotiate_family_support_terms` |
| `relationship_trust_interest_fracture` | `[["confirmed_partner"], ["confirmed_friend_or_colleague"]]` | 最近历史已有共同资源、合作或可信的矛盾证据；不得无依据生成背叛 | `verify_issue_and_set_safeguards`, `attempt_bounded_trust_repair`, `end_shared_interest_arrangement` |
| `opportunity_unstable_alliance` | `[["career_or_creation_direction"]]` | 机会必须延续已有方向；wealth<48只提高权重 | `run_small_alliance_pilot`, `decline_for_current_stability`, `join_with_explicit_exit_conditions` |
| `opportunity_escape_route` | `[["identified_life_constraint"]]` | happiness<45只提高权重；必须已有具体困局和可识别的新路径 | `test_escape_route_temporarily`, `stay_and_repair_current_structure`, `decline_route_and_seek_another_option` |
| `financial_side_path_conflict` | `[["financial_state_available", "career_or_creation_direction"]]` | 现有技能/工作必须能解释收入来源；不得处于现金缺口强制处理节点 | `run_compliant_side_income_pilot`, `clarify_rules_before_committing`, `decline_and_protect_core_income` |
| `life_normal_transition` | `[]` | eligibility 永远为 true；正式进入 `stability_meaning`；不再从戏剧候选池中剔除 | `maintain_current_rhythm`, `make_one_small_adjustment`, `strengthen_one_existing_direction_or_relationship` |

## 10. Phase 2 新增事件库：通用约定

Phase 2 正式新增 37 个随机事件。以下目录是实现清单，不是示例；事件 ID、模式、语义族和行动原语视为稳定契约。

除非单项另有说明，统一默认：

```ts
dispatchMode: "random"
fingerprint.intensity: "minor"
intent.temporalProfile: {
  lifeIntensity: "normal",
  durationMonths: [12, 36],
  requiresFollowUp: false
}
```

其他统一约定：

- `baseProbability` 仅表示同一模式候选中的相对权重，不表示绝对发生概率。
- 所有新增事件的 `intent.type` 必须与 `event.id` 完全相同。
- 事件卡未单列 `trigger` 时使用 `trigger.eligibility: () => true`；实际硬门槛全部由该卡的 `requiredContextGroups` 和 `historyConditionGroups` 承担。单列了 `trigger` 的事件必须同时满足 trigger、上下文和历史条件。
- `cooldown` 在 Phase 2 继续使用节点数，Phase 3 再迁移为现实月份。
- 每张事件卡的 `preferredRange` 同时写入 `minAge`、`maxAge` 和默认 `ageAffinity.preferredRange`；`minimumMultiplier=0.4`。现有 `defaultHardAgeConstraint()` 继续仅为 career、relationship、financial、opportunity 提供法律意义上的18岁下限，health 和 growth 不自动增加18岁硬限制。
- 所有新增事件沿用默认 `outsideRangeAdaptations=["年龄只调整执行方式、风险和支持条件，不得删除该人生方向。"]`，单项未声明时不得另写年龄刻板叙事。
- `ageAffinity.preferredRange` 只降低权重，不作为硬上限；用户已有方向可以跨年龄继续。
- 所有 `recovery_growth` 事件至少有一组 `historyConditionGroups`，不得只靠当前高属性触发。
- 所有 `stability_meaning` 事件必须有明确主题，不能只是 `life_normal_transition` 的改写。
- `allowedOutcomes` 顺序不等于 UI 中 A/B/C 的固定顺序，模型可以按上下文重排。
- 同一 `semanticFamily` 的旧事件和新事件共享语义冷却。
- 下方事件卡中的 `requiredContext` 是 `requiredContextGroups` 的紧凑写法：逗号表示同一组内 AND，“或”表示不同组之间 OR。例如“`financial_state_available`、`confirmed_partner` 或 `confirmed_family`”必须实现为 `[["financial_state_available", "confirmed_partner"], ["financial_state_available", "confirmed_family"]]`，不能解释为三个条件任选一个。

## 11. 职业领域新增事件（8）

### 11.1 `career_gradual_transition_window`｜渐进式转型窗口

- category：`career`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`crossroads`
- semanticFamily：`career_transition`
- preferredRange：20–70；baseProbability：0.68；cooldown：5
- requiredContext：`career_active` 或 `career_or_creation_direction`，即 `[["career_active"], ["career_or_creation_direction"]]`
- trigger：当前不是急性健康 Arc trigger；最近存在职业/创作方向；不要求财富达到固定阈值
- historyConditionGroups：`[]`
- meaning：现有路径出现一个可以小规模试验的新方向，不必立即辞职或孤注一掷。
- tensionAxes：当前稳定 vs 新方向；完整转型 vs 小步试点；短期效率 vs 长期适配
- allowedOutcomes：`run_transition_pilot`、`prepare_before_switching`、`keep_current_path_with_review_date`
- temporalProfile：normal，6–18个月，不创建 Arc

### 11.2 `career_scope_redefinition`｜重新定义工作边界

- category：`career`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`crossroads`
- semanticFamily：`career_scope_change`
- preferredRange：22–75；baseProbability：0.62；cooldown：5
- requiredContext：`career_active`
- trigger：最近职业活动强度为 moderate/high，或最近选择包含承担、扩张、并行任务类 intent
- historyConditionGroups：至少一组满足：① 最近6节点存在 `career:expand`/`career:accept_responsibility`；② health 或 happiness 最近3节点下降至少4分
- meaning：角色可以重新定义职责、规模和工作方式，而不是只能继续或退出。
- tensionAxes：影响力 vs 可持续性；收入 vs 自主边界；完整承担 vs 重新分工
- allowedOutcomes：`narrow_scope_keep_core`、`delegate_and_share_responsibility`、`maintain_scope_with_explicit_limits`
- temporalProfile：normal，6–18个月

### 11.3 `career_skill_compounding`｜能力开始形成复利

- category：`career`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`career_skill_growth`
- preferredRange：18–90；baseProbability：0.72；cooldown：5
- requiredContext：`career_or_creation_direction`
- historyConditionGroups：最近8节点至少2次 `career:learn`、`career:practice`、`growth:study`、`creation:practice`；且至少经过6个月
- meaning：反复练习开始转化为更稳定的判断、效率或作品质量。
- tensionAxes：继续深挖 vs 扩大应用；专业深度 vs 可见成果；个人能力 vs 协作影响
- allowedOutcomes：`deepen_specialty`、`apply_skill_to_real_project`、`share_skill_with_others`
- temporalProfile：normal，12–24个月

### 11.4 `career_project_recognition`｜项目获得真实认可

- category：`career`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`career_recognition`
- preferredRange：20–85；baseProbability：0.58；cooldown：7
- requiredContext：`career_or_creation_direction`
- historyConditionGroups：最近10节点至少2次项目/创作推进 intent；最近6节点未出现同语义族；intelligence 趋势稳定或改善
- meaning：此前投入第一次得到具体外部反馈、采用、收入、职责或信誉上的认可。
- tensionAxes：扩大影响 vs 保持质量；兑现成果 vs 继续打磨；个人所有权 vs 团队共享
- allowedOutcomes：`scale_recognized_work`、`protect_quality_and_consolidate`、`convert_recognition_into_long_term_position`
- temporalProfile：normal，12–30个月

### 11.5 `career_long_project_completion`｜长期项目阶段完成

- category：`career`
- narrativeMode：`recovery_growth`
- emotionalTone：`reflection`
- semanticFamily：`career_completion`
- preferredRange：22–100；baseProbability：0.52；cooldown：8
- requiredContext：`career_or_creation_direction`
- historyConditionGroups：最近12节点至少3次相同方向 intent；从首次相关选择经过至少18个月；最近8节点无同语义族
- meaning：一项持续多年的工作、研究、经营或创作完成阶段成果，角色需要决定如何收束或延伸。
- tensionAxes：完成感 vs 新目标；公开成果 vs 私人意义；继续扩张 vs 有意识收束
- allowedOutcomes：`close_project_and_integrate_learning`、`extend_project_into_next_stage`、`share_or_publish_completed_work`
- temporalProfile：stable，18–36个月

### 11.6 `career_sustainable_work_rhythm`｜可持续的工作节奏

- category：`career`
- narrativeMode：`stability_meaning`
- emotionalTone：`everyday`
- semanticFamily：`career_sustainable_rhythm`
- preferredRange：20–100；baseProbability：0.72；cooldown：4
- requiredContext：`career_active`
- trigger：health>=42；最近节点没有 major crisis；当前职业方向未 resolved
- historyConditionGroups：`[]`
- meaning：工作没有发生戏剧性变化，但职责、节奏和生活边界逐渐稳定。
- tensionAxes：稳定节奏 vs 适度进步；可靠交付 vs 个人空间；习惯延续 vs 小幅优化
- allowedOutcomes：`maintain_sustainable_rhythm`、`improve_one_work_habit`、`reserve_time_for_non_work_direction`
- temporalProfile：stable，18–48个月

### 11.7 `career_mentorship_reciprocity`｜经验开始流动

- category：`career`
- narrativeMode：`stability_meaning`
- emotionalTone：`connection`
- semanticFamily：`career_mentorship`
- preferredRange：25–100；baseProbability：0.52；cooldown：7
- requiredContext：`career_active`
- trigger：intelligence>=58 或已有 mentor/colleague 上下文；不得仅因高年龄自动触发“传承”
- historyConditionGroups：最近8节点至少1次形成技能、完成项目或获得认可；或用户已有导师/同行事实
- meaning：角色在同行、导师或后辈关系中交换经验，同时重新理解自己的专业位置。
- tensionAxes：独立完成 vs 共同成长；输出经验 vs 继续学习；个人成绩 vs 群体能力
- allowedOutcomes：`mentor_with_boundaries`、`build_peer_learning_exchange`、`remain_learner_and_seek_feedback`
- temporalProfile：stable，12–36个月

### 11.8 `career_craft_meaning`｜在专业日常中找到意义

- category：`career`
- narrativeMode：`stability_meaning`
- emotionalTone：`reflection`
- semanticFamily：`career_craft_meaning`
- preferredRange：18–110；baseProbability：0.62；cooldown：6
- requiredContext：`career_active` 或 `career_or_creation_direction`
- trigger：最近没有强制职业危机；不要求在职，可适配自由职业、研究、创作和退休后持续实践
- historyConditionGroups：最近8节点至少2次同方向选择，或 DirectionArc 强化次数>=2
- meaning：长期做一件事形成了秩序、身份和个人标准，价值不再只来自职位或收入。
- tensionAxes：外部评价 vs 内在标准；效率 vs 手艺；持续实践 vs 寻找新刺激
- allowedOutcomes：`deepen_personal_standard`、`connect_craft_to_daily_life`、`open_craft_to_new_context`
- temporalProfile：stable，24–60个月

## 12. 关系领域新增事件（8）

### 12.1 `relationship_mutual_commitment_window`｜双方承诺窗口

- category：`relationship`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`crossroads`
- semanticFamily：`relationship_commitment`
- preferredRange：20–80；baseProbability：0.58；cooldown：7
- requiredContext：`confirmed_partner`
- trigger：关系人物非 distant/deceased；不得由 happiness 单独触发
- historyConditionGroups：最近8节点存在至少1次与同一关系的沟通、协作或共同计划；最近8节点无同语义族
- meaning：关系走到需要双方共同定义承诺、生活安排和边界的阶段。
- tensionAxes：亲密 vs 自主；共同计划 vs 各自方向；承诺形式 vs 实际协作
- allowedOutcomes：`make_mutual_commitment_plan`、`delay_commitment_with_clear_conditions`、`redefine_relationship_scope`
- temporalProfile：normal，6–18个月

### 12.2 `relationship_release_and_reorientation`｜放手与重新定向

- category：`relationship`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`reflection`
- semanticFamily：`relationship_release`
- preferredRange：18–100；baseProbability：0.54；cooldown：8
- requiredContext：`confirmed_partner` 或 `confirmed_friend_or_colleague`
- trigger：最近关系摘要存在长期不匹配、距离或边界冲突；不得凭低 happiness 创造分手
- historyConditionGroups：最近8节点至少2次关系调整/沟通/边界 intent，且关系或 happiness 未改善至少3分
- meaning：持续尝试后，角色可以选择结束、降低关系强度或重新定义彼此位置。
- tensionAxes：维持熟悉 vs 接受结束；责任感 vs 自我保护；失去关系 vs 释放未来空间
- allowedOutcomes：`end_relationship_with_clarity`、`reduce_contact_and_redefine_role`、`attempt_one_bounded_repair`
- temporalProfile：normal，6–18个月

### 12.3 `relationship_shared_problem_solving`｜共同解决现实问题

- category：`relationship`
- narrativeMode：`recovery_growth`
- emotionalTone：`connection`
- semanticFamily：`relationship_cooperation`
- preferredRange：18–100；baseProbability：0.7；cooldown：5
- requiredContext：`confirmed_partner` 或 `confirmed_family`
- historyConditionGroups：最近8节点至少1次 `relationship:communicate`、`relationship:share_responsibility`、`relationship:set_boundary`；经过至少3个月
- meaning：此前的沟通或边界开始转化为更清楚的分工和共同解决问题的能力。
- tensionAxes：独自承担 vs 共同负责；效率 vs 彼此感受；旧习惯 vs 新协作方式
- allowedOutcomes：`formalize_shared_responsibility`、`keep_testing_new_cooperation`、`request_more_specific_support`
- temporalProfile：normal，6–18个月

### 12.4 `relationship_trust_rebuilding`｜信任逐步重建

- category：`relationship`
- narrativeMode：`recovery_growth`
- emotionalTone：`connection`
- semanticFamily：`relationship_trust_repair`
- preferredRange：18–100；baseProbability：0.56；cooldown：7
- requiredContext：`confirmed_partner` 或 `confirmed_friend_or_colleague`
- historyConditionGroups：最近10节点出现关系裂纹/边界事件；之后至少2次 repair/communicate/honesty intent；relation 趋势稳定或改善
- meaning：信任不是一次谈话恢复，而是在连续一致的行动中重新形成。
- tensionAxes：再次信任 vs 保留保护；原谅 vs 核实变化；恢复亲密 vs 接受新的边界
- allowedOutcomes：`restore_trust_gradually`、`maintain_relationship_with_safeguards`、`acknowledge_partial_repair_only`
- temporalProfile：normal，9–24个月

### 12.5 `relationship_boundary_aftercare`｜建立边界后的关系变化

- category：`relationship`
- narrativeMode：`recovery_growth`
- emotionalTone：`reflection`
- semanticFamily：`relationship_boundary_growth`
- preferredRange：18–110；baseProbability：0.66；cooldown：6
- requiredContext：`confirmed_partner`、`confirmed_family` 或 `confirmed_friend_or_colleague` 中至少一个
- historyConditionGroups：最近8节点至少1次 `relationship:set_boundary`、`relationship:reduce_contact`、`relationship:renegotiate_support`
- meaning：边界产生了真实后果：可能减少冲突、带来距离，也可能迫使关系重新协商。
- tensionAxes：边界稳定 vs 关系温度；短期不适 vs 长期尊重；解释自己 vs 允许他人适应
- allowedOutcomes：`hold_boundary_consistently`、`soften_delivery_keep_boundary`、`revise_boundary_based_on_results`
- temporalProfile：normal，6–18个月

### 12.6 `relationship_family_responsibility_rebalanced`｜家庭责任重新分配

- category：`relationship`
- narrativeMode：`recovery_growth`
- emotionalTone：`connection`
- semanticFamily：`family_responsibility_rebalance`
- preferredRange：20–100；baseProbability：0.58；cooldown：7
- requiredContext：`confirmed_family`
- historyConditionGroups：最近10节点出现家庭义务压力；之后至少1次协商、求助或拒绝过度承担 intent；经过至少6个月
- meaning：原本集中在一个人身上的家庭责任开始重新分配，角色获得更可持续的位置。
- tensionAxes：公平分担 vs 家庭习惯；照顾他人 vs 保留生活；短期摩擦 vs 长期秩序
- allowedOutcomes：`formalize_family_role_split`、`accept_limited_role_with_support`、`reopen_negotiation_for_unresolved_load`
- temporalProfile：normal，6–24个月

### 12.7 `relationship_daily_companionship`｜稳定陪伴的日常

- category：`relationship`
- narrativeMode：`stability_meaning`
- emotionalTone：`connection`
- semanticFamily：`relationship_companionship`
- preferredRange：18–110；baseProbability：0.7；cooldown：5
- requiredContext：`confirmed_partner` 或 `confirmed_family`
- trigger：最近没有 major relationship crisis；关系人物仍 active/limited
- historyConditionGroups：`[]`
- meaning：关系通过普通陪伴、共同安排和重复的小行动形成安全感。
- tensionAxes：共同时间 vs 各自空间；习惯稳定 vs 保持新鲜；照顾彼此 vs 保留自主
- allowedOutcomes：`strengthen_shared_routine`、`protect_individual_space`、`create_one_new_shared_practice`
- temporalProfile：stable，12–36个月

### 12.8 `relationship_friendship_deepening`｜友谊与同行连接深化

- category：`relationship`
- narrativeMode：`stability_meaning`
- emotionalTone：`connection`
- semanticFamily：`friendship_deepening`
- preferredRange：18–110；baseProbability：0.6；cooldown：6
- requiredContext：`confirmed_friend_or_colleague`
- trigger：不得自动改写为恋爱；必须延续已有朋友、同事或导师关系
- historyConditionGroups：最近10节点至少出现同一人物两次，或已有可靠 friend/colleague/mentor PersonState
- meaning：一段非亲密伴侣关系通过长期往来形成信任、支持或共同兴趣。
- tensionAxes：依赖 vs 互相支持；坦诚 vs 保留边界；共同经历 vs 各自生活
- allowedOutcomes：`invest_in_friendship_consistently`、`share_a_real_difficulty`、`build_a_shared_activity`
- temporalProfile：stable，12–36个月

## 13. 健康领域新增事件（6）

新增健康事件不得修改已有升级阈值。`health_forced_pause` 仍是唯一可由 `queryHealthEscalationEvent()` 强制触发的重大健康事件。

### 13.1 `health_support_plan_choice`｜支持与治疗安排选择

- category：`health`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`crossroads`
- semanticFamily：`health_support_plan`
- preferredRange：18–110；baseProbability：0.62；cooldown：6
- requiredContext：`health_recovery_context`
- trigger：health 在30–55之间；不处于健康 Arc trigger；最近存在预警、恢复观察或持续 depleted
- historyConditionGroups：最近8节点出现 `health_system_warning` 或 `health_recovery_observation`；最近6节点无同语义族
- meaning：健康问题已经明确，角色需要选择怎样安排治疗、负荷、支持和原有人生方向。
- tensionAxes：专业支持 vs 自我管理；短期停顿 vs 调整后继续；隐私自主 vs 接受帮助
- allowedOutcomes：`seek_structured_health_support`、`reduce_load_with_monitoring_plan`、`coordinate_support_and_continue_adjusted_goal`
- temporalProfile：normal，3–9个月

### 13.2 `health_recovery_progress`｜恢复开始出现证据

- category：`health`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`health_recovery_progress`
- preferredRange：18–110；baseProbability：0.72；cooldown：5
- requiredContext：`health_recovery_context`
- historyConditionGroups：至少一组满足：① 最近8节点至少2次 `health:reduce_load`/`health:seek_support`/`health:treatment`，从首次选择经过至少6个月，health 最近3节点改善至少3分；② 健康 Arc 处于 recovery/operation，recoveryState 最近2节点不再连续 depleted
- meaning：持续调整开始转化为症状、体力、睡眠或生活能力上的可观察改善。
- tensionAxes：扩大活动 vs 保护恢复；回到旧节奏 vs 建立新节奏；短期好转 vs 长期稳定
- allowedOutcomes：`consolidate_recovery_plan`、`resume_activity_gradually`、`adjust_plan_based_on_remaining_limits`
- temporalProfile：normal，3–12个月

### 13.3 `health_function_return`｜生活能力逐步恢复

- category：`health`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`health_function_return`
- preferredRange：18–110；baseProbability：0.56；cooldown：7
- requiredContext：`health_recovery_context`
- historyConditionGroups：最近10节点出现 health forced pause/recovery；至少经过9个月；最近3节点 health 累计改善至少5分；最近2节点 recoveryState 至少一个 protected
- meaning：恢复不只体现在数值上，角色重新获得处理工作、关系或日常活动的能力。
- tensionAxes：恢复参与 vs 避免过载；原方向 vs 调整后的能力边界；证明自己 vs 尊重身体反馈
- allowedOutcomes：`resume_one_meaningful_role`、`keep_recovery_as_primary_goal`、`redesign_role_around_current_capacity`
- temporalProfile：normal，6–18个月

### 13.4 `health_recovery_milestone`｜健康危机阶段收束

- category：`health`
- narrativeMode：`recovery_growth`
- emotionalTone：`reflection`
- semanticFamily：`health_recovery_closure`
- preferredRange：18–110；baseProbability：0.48；cooldown：10
- requiredContext：`health_recovery_context`
- historyConditionGroups：健康 Arc 已 resolved 或最近出现 `health_recovery_observation` 后经过至少12个月；health 趋势稳定/改善；最近4节点无 acute health crisis
- meaning：急性危机已转为恢复完成或长期可管理状态，健康不再必须占据人生前台。
- tensionAxes：恢复后的谨慎 vs 重新投入；完全恢复期待 vs 接受长期管理；旧身份 vs 调整后的生活
- allowedOutcomes：`close_acute_health_chapter`、`adopt_long_term_management_identity`、`reenter_previous_direction_with_limits`
- temporalProfile：stable，6–18个月

### 13.5 `health_sustainable_routine`｜可持续的健康日常

- category：`health`
- narrativeMode：`stability_meaning`
- emotionalTone：`everyday`
- semanticFamily：`health_sustainable_routine`
- preferredRange：12–110；baseProbability：0.68；cooldown：5
- requiredContext：无
- trigger：health>=45；不处于健康 Arc trigger；最近没有 acute health crisis
- historyConditionGroups：`[]`
- meaning：健康通过可持续的睡眠、活动、复查、饮食或负荷边界维持，而不是靠一次英雄式改变。
- tensionAxes：规律 vs 灵活；维护身体 vs 继续生活；自我管理 vs 接受支持
- allowedOutcomes：`maintain_health_routine`、`improve_one_sustainable_habit`、`adapt_routine_to_current_life`
- temporalProfile：stable，12–36个月

### 13.6 `health_adapted_life_balance`｜带着限制建立稳定生活

- category：`health`
- narrativeMode：`stability_meaning`
- emotionalTone：`reflection`
- semanticFamily：`health_adapted_balance`
- preferredRange：18–110；baseProbability：0.54；cooldown：7
- requiredContext：`health_recovery_context`
- trigger：health 在35–65之间；不处于急性 trigger；允许健康未完全恢复
- historyConditionGroups：最近10节点出现健康调整/治疗/恢复；之后至少6个月没有重大急性事件
- meaning：角色不必等到完全康复才重新拥有工作、关系、兴趣和未来，可以围绕真实限制建立稳定生活。
- tensionAxes：接受限制 vs 放弃可能；保护身体 vs 保持参与；可持续生活 vs 追求恢复到过去
- allowedOutcomes：`build_life_around_current_capacity`、`preserve_one_core_direction`、`seek_additional_support_for_more_participation`
- temporalProfile：stable，12–36个月

## 14. 财务领域新增事件（7）

所有财务事件优先读取 `financialState`；`wealth` 只作为选择权重。金额和状态连续性继续由财务系统负责，事件不得自行发明精确余额。

### 14.1 `financial_resource_priority_choice`｜资源优先级选择

- category：`financial`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`crossroads`
- semanticFamily：`financial_priority_choice`
- preferredRange：18–100；baseProbability：0.64；cooldown：5
- requiredContext：`financial_state_available`
- trigger：存在可识别的储蓄、债务、教育、住房、健康或创作目标中的至少两类；不得只凭 wealth 生成大额投资
- historyConditionGroups：最近6节点无同语义族
- meaning：有限资源需要在安全、成长、家庭和个人方向之间排序。
- tensionAxes：安全垫 vs 长期投入；家庭需要 vs 个人方向；现在使用 vs 未来选择权
- allowedOutcomes：`prioritize_financial_safety`、`fund_one_long_term_direction`、`split_resources_by_explicit_ratio`
- temporalProfile：normal，12–24个月

### 14.2 `financial_cautious_opportunity`｜可控规模的财务机会

- category：`financial`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`opportunity`
- semanticFamily：`financial_cautious_opportunity`
- preferredRange：20–80；baseProbability：0.58；cooldown：7
- requiredContext：`financial_state_available`、`career_or_creation_direction`
- trigger：现金非负；不得处于现金缺口强制处置节点；机会必须与已有技能、工作或项目相连
- historyConditionGroups：最近8节点无同语义族；最近4节点无 financial major crisis
- meaning：角色获得一个可以限定投入、验证需求并保留退出空间的增收或经营机会。
- tensionAxes：试点规模 vs 潜在收益；现金安全 vs 机会窗口；控制风险 vs 学习速度
- allowedOutcomes：`run_small_financial_pilot`、`delay_until_buffer_ready`、`decline_and_protect_core_finances`
- temporalProfile：normal，6–18个月

### 14.3 `financial_emergency_buffer`｜应急缓冲开始形成

- category：`financial`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`financial_buffer_growth`
- preferredRange：18–100；baseProbability：0.7；cooldown：6
- requiredContext：`financial_state_available`
- historyConditionGroups：最近8节点至少2次 `financial:save`/`financial:reduce_expense`/`career:stabilize_income`；经过至少6个月；cashWan 趋势非下降
- meaning：持续储蓄、控制支出或稳定收入开始形成可以应对波动的缓冲。
- tensionAxes：继续积累 vs 使用部分资源；安全感 vs 新投入；严格纪律 vs 保留生活质量
- allowedOutcomes：`continue_building_buffer`、`set_buffer_target_then_redirect_surplus`、`use_small_part_for_meaningful_goal`
- temporalProfile：normal，9–24个月

### 14.4 `financial_debt_reduction_progress`｜债务压力逐步下降

- category：`financial`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`financial_debt_recovery`
- preferredRange：18–100；baseProbability：0.66；cooldown：6
- requiredContext：`financial_state_available`、`debt_present`
- historyConditionGroups：最近10节点至少2次还债/降低支出/增加稳定收入 intent；经过至少6个月；totalDebtWan 相比窗口起点下降
- meaning：持续处置开始降低债务和利息压力，角色重新获得部分选择空间。
- tensionAxes：加速偿还 vs 保留现金；债务清理 vs 生活质量；单一目标 vs 同时恢复其他生活领域
- allowedOutcomes：`accelerate_debt_reduction`、`balance_debt_and_cash_buffer`、`maintain_current_repayment_plan`
- temporalProfile：normal，9–24个月

### 14.5 `financial_income_stabilization`｜收入结构趋于稳定

- category：`financial`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`financial_income_stability`
- preferredRange：18–90；baseProbability：0.62；cooldown：7
- requiredContext：`financial_state_available`、`career_active`
- historyConditionGroups：最近10节点至少2次稳定收入/建立客户/调整工作结构 intent；经过至少9个月；incomeStability 相比窗口起点改善
- meaning：收入未必大幅增加，但波动降低、来源更清楚，生活不再依赖下一次翻盘。
- tensionAxes：稳定性 vs 增长速度；集中主业 vs 多来源；收入提升 vs 时间边界
- allowedOutcomes：`consolidate_stable_income`、`diversify_without_overload`、`trade_some_income_for_sustainability`
- temporalProfile：normal，12–30个月

### 14.6 `financial_long_term_order`｜长期财务秩序

- category：`financial`
- narrativeMode：`stability_meaning`
- emotionalTone：`everyday`
- semanticFamily：`financial_long_term_order`
- preferredRange：18–110；baseProbability：0.66；cooldown：6
- requiredContext：`financial_state_available`
- trigger：没有现金缺口；最近没有 major financial crisis；收入和支出可解释
- historyConditionGroups：`[]`
- meaning：财富不再主要承担证明和翻盘功能，而成为支持生活、关系和未来选择的秩序。
- tensionAxes：储备未来 vs 使用当下；纪律 vs 弹性；个人安全 vs 支持重要关系
- allowedOutcomes：`maintain_financial_order`、`allocate_for_quality_of_life`、`support_one_long_term_commitment`
- temporalProfile：stable，18–48个月

### 14.7 `financial_shared_household_plan`｜共同生活的财务协作

- category：`financial`
- narrativeMode：`stability_meaning`
- emotionalTone：`connection`
- semanticFamily：`financial_household_cooperation`
- preferredRange：20–100；baseProbability：0.5；cooldown：8
- requiredContext：`financial_state_available` 且具备 `confirmed_partner` 或 `confirmed_family`，即 `[["financial_state_available", "confirmed_partner"], ["financial_state_available", "confirmed_family"]]`
- trigger：存在共同生活、照护、住房或长期家庭支出上下文；不得默认要求买房或婚姻
- historyConditionGroups：最近8节点无同语义族
- meaning：家庭或伴侣开始用更透明、可持续的方式安排共同支出和个人空间。
- tensionAxes：共同账户 vs 个人自主；公平分担 vs 收入差异；长期计划 vs 当下需要
- allowedOutcomes：`create_shared_financial_rules`、`separate_personal_and_shared_budgets`、`review_household_plan_periodically`
- temporalProfile：stable，12–36个月

## 15. 自我与成长领域新增事件（8）

Phase 2 为兼容现有枚举，以下事件的 `category` 使用 `growth`；设计领域记为 `self`。Phase 3 如引入正式 `LifeDomain`，再将其迁移为 `self`，历史 `eventCategory=growth` 保持可读。

### 15.1 `self_new_direction_choice`｜新的个人方向

- category：`growth`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`crossroads`
- semanticFamily：`self_direction_choice`
- preferredRange：15–110；baseProbability：0.66；cooldown：6
- requiredContext：无
- trigger：用户资料、追问、DirectionArc 或最近选择中存在学习、创作、研究、旅行、生活方式或价值方向；不得因年龄高而自动改成回忆/传承
- historyConditionGroups：最近6节点无同语义族
- meaning：角色发现一个值得投入的新方向，需要决定它在现实生活中占据多大位置。
- tensionAxes：兴趣 vs 既有责任；试验 vs 承诺；个人意义 vs 外部评价
- allowedOutcomes：`run_small_self_direction_experiment`、`commit_regular_time_to_direction`、`keep_direction_as_background_for_now`
- temporalProfile：normal，6–18个月

### 15.2 `self_value_reorientation`｜重新排序重要的事

- category：`growth`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`reflection`
- semanticFamily：`self_value_reorientation`
- preferredRange：18–110；baseProbability：0.56；cooldown：8
- requiredContext：无
- trigger：最近发生一次收束、完成、放手、恢复或稳定窗口；不得凭空宣布“想开了”
- historyConditionGroups：至少一组满足：① 最近8节点出现 resolved PressureArc；② 最近8节点出现 completion/release/recovery_closure 语义族；③ 最近10节点连续强化同一 DirectionArc 至少3次
- meaning：经历具体结果后，角色重新理解成功、安全、关系、自由或身体在自己人生中的排序。
- tensionAxes：旧标准 vs 新经验；外部认可 vs 内在一致；保留野心 vs 改变衡量方式
- allowedOutcomes：`redefine_success_criteria`、`protect_one_new_priority`、`test_new_values_before_full_commitment`
- temporalProfile：normal，12–24个月

### 15.3 `self_confidence_rebuilding`｜信心逐步恢复

- category：`growth`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`self_confidence_recovery`
- preferredRange：12–110；baseProbability：0.68；cooldown：6
- requiredContext：无
- historyConditionGroups：最近10节点出现失败、拒绝、停顿或低 happiness；之后至少2次小步执行/学习/求助 intent；happiness 最近3节点改善至少3分或保持稳定且完成具体行动
- meaning：信心不是口号，而是通过连续完成小目标和承受现实反馈重新形成。
- tensionAxes：继续小步积累 vs 扩大挑战；保护新信心 vs 接受失败可能；自我认可 vs 外部验证
- allowedOutcomes：`increase_challenge_gradually`、`consolidate_small_wins`、`seek_real_world_feedback`
- temporalProfile：normal，6–18个月

### 15.4 `self_skill_validation`｜学习成果得到验证

- category：`growth`
- narrativeMode：`recovery_growth`
- emotionalTone：`flourishing`
- semanticFamily：`self_skill_validation`
- preferredRange：12–110；baseProbability：0.66；cooldown：6
- requiredContext：`learning_or_creation_direction`
- historyConditionGroups：最近10节点至少2次学习/练习/制作 intent；经过至少6个月；最近8节点无同语义族
- meaning：学习开始通过作品、解决问题、考试、教学或现实使用得到验证。
- tensionAxes：继续学习 vs 开始应用；私人兴趣 vs 公开成果；广度 vs 深度
- allowedOutcomes：`apply_skill_in_real_context`、`deepen_skill_before_expanding`、`share_skill_or_teach_others`
- temporalProfile：normal，9–24个月

### 15.5 `self_failure_becomes_method`｜失败经验形成方法

- category：`growth`
- narrativeMode：`recovery_growth`
- emotionalTone：`reflection`
- semanticFamily：`self_failure_integration`
- preferredRange：15–110；baseProbability：0.58；cooldown：8
- requiredContext：无
- historyConditionGroups：最近10节点出现失败、退出、拒绝、项目未达成或选择后果不佳；之后至少1次调整、复盘或重新尝试 intent；经过至少6个月
- meaning：失败没有被美化，但角色从中提炼出以后能使用的判断、边界或工作方法。
- tensionAxes：再次尝试 vs 接受不适合；保留经验 vs 放下执念；证明自己 vs 修正方法
- allowedOutcomes：`apply_learned_method_to_next_attempt`、`close_failed_direction_keep_learning`、`run_smaller_test_with_new_constraints`
- temporalProfile：normal，9–24个月

### 15.6 `self_interest_becomes_practice`｜兴趣成为稳定实践

- category：`growth`
- narrativeMode：`stability_meaning`
- emotionalTone：`everyday`
- semanticFamily：`self_interest_practice`
- preferredRange：8–110；baseProbability：0.72；cooldown：5
- requiredContext：`learning_or_creation_direction`
- trigger：兴趣/创作/学习方向仍 active/background；最近没有要求完全放弃该方向的事实
- historyConditionGroups：最近8节点至少2次相关 intent，或 DirectionArc 强化次数>=2
- meaning：兴趣不一定变成职业，但通过固定时间、作品或社群成为生活中稳定存在的部分。
- tensionAxes：纯粹兴趣 vs 外部成果；稳定习惯 vs 新鲜感；个人空间 vs 分享连接
- allowedOutcomes：`protect_regular_practice_time`、`complete_one_small_artifact`、`share_interest_with_trusted_others`
- temporalProfile：stable，12–36个月

### 15.7 `self_daily_meaning`｜普通生活中的意义感

- category：`growth`
- narrativeMode：`stability_meaning`
- emotionalTone：`reflection`
- semanticFamily：`self_daily_meaning`
- preferredRange：8–110；baseProbability：0.74；cooldown：5
- requiredContext：无
- trigger：最近没有 major crisis；至少存在一个 active/background DirectionArc、可靠关系或稳定日常活动
- historyConditionGroups：最近6节点无同语义族
- meaning：角色从重复的工作、照料、学习、兴趣或陪伴中辨认出自己愿意长期保留的生活部分。
- tensionAxes：追求变化 vs 看见已有价值；效率 vs 感受；宏大目标 vs 可持续日常
- allowedOutcomes：`protect_meaningful_daily_element`、`simplify_life_around_core_values`、`add_one_small_source_of_aliveness`
- temporalProfile：stable，18–48个月

### 15.8 `self_long_term_creation`｜长期创作与表达

- category：`growth`
- narrativeMode：`stability_meaning`
- emotionalTone：`flourishing`
- semanticFamily：`self_long_term_creation`
- preferredRange：12–110；baseProbability：0.58；cooldown：7
- requiredContext：`learning_or_creation_direction`
- trigger：方向可为写作、艺术、研究、手艺、产品、记录或其他持续表达；不要求职业化
- historyConditionGroups：最近12节点至少3次同方向 intent；经过至少18个月；最近8节点无 completion 语义族
- meaning：长期表达形成了作品序列、方法或个人声音，即使规模不大也具有持续性。
- tensionAxes：继续私人实践 vs 面向他人；完成作品 vs 不断修改；稳定表达 vs 尝试新形式
- allowedOutcomes：`complete_and_archive_work`、`share_work_with_real_audience`、`begin_next_creation_cycle`
- temporalProfile：stable，18–48个月

## 16. Phase 3 社区领域新增事件（6）

以下事件属于完整目标事件库，但不得在 Phase 2 提前以 `growth/self` 身份上线。Phase 3 完成社区人物、组织或群体事实后再启用。

第10节的随机调度、minor intensity、`intent.type=event.id`、年龄亲和度和默认 temporalProfile 同样适用于以下6个事件。

最低基础设施：

```ts
type CommunityFact = {
  id: string;
  kind: "neighborhood" | "peer_group" | "volunteer_group" | "professional_network" | "public_group";
  status: "active" | "distant" | "ended";
  source: "user_fact" | "answer" | "history" | "model_inferred";
  confidence: number;
  summary: string;
};
```

社区事件要求存在 `source !== model_inferred && confidence>=0.7` 的事实，或用户在本轮明确主动选择加入。

### 16.1 `community_contribution_choice`｜参与与贡献的选择

- category：`community`
- narrativeMode：`crossroads_opportunity`
- emotionalTone：`opportunity`
- semanticFamily：`community_contribution_choice`
- preferredRange：15–110；baseProbability：0.6；cooldown：7
- requiredFacts：已有社区/同行群体，或用户明确选择寻找群体
- history：最近8节点无同语义族
- meaning：角色获得参与社群、同行网络、邻里或公共事务的具体入口。
- tensionAxes：个人时间 vs 公共参与；短期付出 vs 长期归属；普通成员 vs 承担责任
- allowedOutcomes：`join_as_regular_member`、`contribute_one_bounded_skill`、`decline_leadership_keep_light_connection`

### 16.2 `community_mutual_aid`｜互助网络开始形成

- category：`community`
- narrativeMode：`recovery_growth`
- emotionalTone：`connection`
- semanticFamily：`community_mutual_aid`
- preferredRange：15–110；baseProbability：0.62；cooldown：7
- requiredFacts：active community fact
- history：最近10节点至少2次参加/帮助/求助 intent；经过至少6个月
- meaning：角色不再只靠个人硬撑，社群关系开始提供实际的信息、照料、合作或情感支持。
- tensionAxes：接受帮助 vs 保持自主；互惠 vs 过度承担；私人困难 vs 公开连接
- allowedOutcomes：`accept_specific_community_support`、`build_reciprocal_aid_rule`、`limit_contribution_to_sustainable_level`

### 16.3 `community_belonging`｜归属感逐渐建立

- category：`community`
- narrativeMode：`recovery_growth`
- emotionalTone：`connection`
- semanticFamily：`community_belonging`
- preferredRange：10–110；baseProbability：0.58；cooldown：8
- requiredFacts：active community fact
- history：最近12节点至少3次参与同一群体；经过至少12个月
- meaning：重复参与让角色从旁观者变成被认识、被期待也能表达真实需要的成员。
- tensionAxes：归属 vs 独立；被看见 vs 保留隐私；共同规范 vs 个人差异
- allowedOutcomes：`deepen_belonging`、`keep_membership_with_boundaries`、`take_one_visible_contribution`

### 16.4 `community_peer_network`｜同行网络的稳定连接

- category：`community`
- narrativeMode：`stability_meaning`
- emotionalTone：`connection`
- semanticFamily：`community_peer_network`
- preferredRange：15–110；baseProbability：0.6；cooldown：7
- requiredFacts：active peer_group/professional_network
- history：最近10节点出现至少两名或一个稳定群体；无同语义族
- meaning：同行关系通过持续交流形成信息、反馈和共同学习的长期网络。
- tensionAxes：竞争 vs 合作；个人路径 vs 同行参照；输出经验 vs 接受反馈
- allowedOutcomes：`maintain_peer_exchange`、`start_small_collaboration`、`seek_feedback_without_comparison`

### 16.5 `community_stewardship`｜有限责任的共同维护

- category：`community`
- narrativeMode：`stability_meaning`
- emotionalTone：`reflection`
- semanticFamily：`community_stewardship`
- preferredRange：20–110；baseProbability：0.46；cooldown：9
- requiredFacts：active community fact，角色已持续参与至少18个月
- history：至少3次可验证贡献；最近没有过载/家庭危机
- meaning：角色开始承担一项边界清楚的维护责任，让共同空间或群体能够持续运转。
- tensionAxes：贡献 vs 个人边界；责任延续 vs 角色轮换；个人影响 vs 共同所有
- allowedOutcomes：`take_bounded_stewardship_role`、`share_stewardship_with_others`、`remain_contributor_without_leadership`

### 16.6 `community_intergenerational_exchange`｜跨代经验交换

- category：`community`
- narrativeMode：`stability_meaning`
- emotionalTone：`connection`
- semanticFamily：`community_intergenerational_exchange`
- preferredRange：15–110；baseProbability：0.42；cooldown：10
- requiredFacts：active community fact；群体中存在不同年龄角色事实
- history：角色拥有可验证技能/经验或明确学习需求；不得只因年龄高自动安排“传承”
- meaning：不同年龄的人通过具体活动交换经验、技术、照料或新的看法。
- tensionAxes：教授 vs 学习；经验稳定性 vs 新方法；被需要 vs 保持平等
- allowedOutcomes：`exchange_skills_bidirectionally`、`join_intergenerational_project`、`keep_informal_contact_and_learning`

## 17. 新增事件数量与覆盖审计

Phase 2 新增：

| 领域 | 压力危机 | 分岔机会 | 恢复成长 | 平稳意义 | 合计 |
|---|---:|---:|---:|---:|---:|
| career | 0 | 2 | 3 | 3 | 8 |
| relationship | 0 | 2 | 4 | 2 | 8 |
| health | 0 | 1 | 3 | 2 | 6 |
| financial | 0 | 2 | 3 | 2 | 7 |
| self/growth | 0 | 2 | 3 | 3 | 8 |
| **合计** | **0** | **9** | **16** | **12** | **37** |

Phase 3 再新增 community：分岔1、恢复2、平稳3，共6个。

本轮明确不新增压力危机事件。现有压力事件数量已经足够用于验证；只有在分布评估证明某一领域缺少必要现实冲击时，才能另开 Spec 新增。

Phase 2 完成后事件库总数：

```text
现有 14
+ Phase 2 新增 37
= 51
```

其中两个健康事件仍为 `arc_only`。Phase 3 community 完成后总数为57。

### 17.1 Phase 2 机器字段附录

下表固定每个新增事件的 `conditionDescription` 和 `tags`。实现时 `fingerprint.category=category`、`fingerprint.tags=tags`，不得另写一套不同标签。`fingerprint.intensity` 使用第10节默认值。

| eventId | conditionDescription | tags |
|---|---|---|
| `career_gradual_transition_window` | 已有职业或创作方向出现可小规模验证的新路径 | `career, transition, pilot, opportunity` |
| `career_scope_redefinition` | 已有工作责任或负荷需要重新划定规模、分工和边界 | `career, scope_change, boundary, responsibility` |
| `career_skill_compounding` | 同一职业或创作能力经过持续练习开始形成复利 | `career, skill_growth, accumulation, flourishing` |
| `career_project_recognition` | 持续推进的项目或作品获得具体外部反馈和认可 | `career, recognition, project, flourishing` |
| `career_long_project_completion` | 同一长期项目经过足够时间形成阶段完成结果 | `career, project_completion, reflection, closure` |
| `career_sustainable_work_rhythm` | 已有工作在非危机状态下逐渐形成可持续节奏 | `career, sustainable_rhythm, boundary, stability` |
| `career_mentorship_reciprocity` | 已形成的经验或同行关系开始产生双向学习 | `career, mentorship, connection, growth` |
| `career_craft_meaning` | 长期专业或创作实践形成个人标准和意义 | `career, craft, meaning, stability` |
| `relationship_mutual_commitment_window` | 已确认的伴侣关系进入双方共同定义承诺的阶段 | `relationship, commitment, mutual_plan, crossroads` |
| `relationship_release_and_reorientation` | 经持续尝试仍不匹配的重要关系需要结束或重定义 | `relationship, release, boundary, reflection` |
| `relationship_shared_problem_solving` | 沟通和分工开始形成共同解决现实问题的能力 | `relationship, cooperation, responsibility, repair` |
| `relationship_trust_rebuilding` | 关系裂纹后通过连续一致行动逐步重建信任 | `relationship, trust_repair, connection, recovery` |
| `relationship_boundary_aftercare` | 建立边界后关系进入适应、修正和稳定阶段 | `relationship, boundary, aftercare, growth` |
| `relationship_family_responsibility_rebalanced` | 家庭义务经过协商开始形成更可持续的分担 | `relationship, family_obligation, boundary, rebalance` |
| `relationship_daily_companionship` | 可靠关系通过普通陪伴和共同安排积累安全感 | `relationship, companionship, routine, connection` |
| `relationship_friendship_deepening` | 已存在的朋友、同事或导师关系通过长期往来深化 | `relationship, friendship, connection, stability` |
| `health_support_plan_choice` | 健康问题明确后需要选择治疗、减负和支持安排 | `health, support_plan, crossroads, recovery` |
| `health_recovery_progress` | 持续治疗或减负后出现可观察的恢复证据 | `health, recovery_progress, improvement, observation` |
| `health_function_return` | 健康改善开始转化为日常生活能力恢复 | `health, function_return, recovery, flourishing` |
| `health_recovery_milestone` | 急性健康危机转为恢复完成或长期可管理状态 | `health, recovery_closure, reflection, stability` |
| `health_sustainable_routine` | 非急性状态下形成可持续的健康维护日常 | `health, routine, maintenance, stability` |
| `health_adapted_life_balance` | 在真实健康限制下建立可持续的参与和生活结构 | `health, adaptation, management, meaning` |
| `financial_resource_priority_choice` | 有限资源需要在安全、成长、家庭和个人方向间排序 | `financial, priority, crossroads, resource_allocation` |
| `financial_cautious_opportunity` | 已有技能或工作带来可限定投入的财务试点机会 | `financial, opportunity, pilot, risk_control` |
| `financial_emergency_buffer` | 持续储蓄或稳定收入开始形成应急缓冲 | `financial, buffer, saving, recovery` |
| `financial_debt_reduction_progress` | 持续处置使结构化债务和利息压力下降 | `financial, debt, recovery, cashflow` |
| `financial_income_stabilization` | 工作或客户结构调整使收入波动下降 | `financial, income_stability, recovery, career` |
| `financial_long_term_order` | 非危机财务状态形成支持长期生活的秩序 | `financial, order, stability, meaning` |
| `financial_shared_household_plan` | 可靠关系中的共同生活支出需要透明协作 | `financial, household, cooperation, relationship` |
| `self_new_direction_choice` | 已有兴趣、学习或价值方向出现可投入的新路径 | `growth, direction, crossroads, experiment` |
| `self_value_reorientation` | 经历具体收束、恢复或长期投入后重新排序价值 | `growth, values, reflection, reorientation` |
| `self_confidence_rebuilding` | 失败后通过连续小行动和真实反馈恢复信心 | `growth, confidence, recovery, small_wins` |
| `self_skill_validation` | 持续学习或练习通过现实使用得到验证 | `growth, skill_validation, flourishing, practice` |
| `self_failure_becomes_method` | 失败后经过调整和复盘形成可迁移方法 | `growth, failure, reflection, method` |
| `self_interest_becomes_practice` | 同一兴趣通过固定时间和作品成为稳定实践 | `growth, interest, routine, practice` |
| `self_daily_meaning` | 非危机生活中的重复活动形成可辨认的意义 | `growth, daily_meaning, stability, reflection` |
| `self_long_term_creation` | 长期创作或表达形成作品序列、方法或个人声音 | `growth, creation, long_term, meaning` |

### 17.2 Phase 3 community 机器字段附录

| eventId | conditionDescription | tags |
|---|---|---|
| `community_contribution_choice` | 已有或主动寻找的群体出现有限参与入口 | `community, contribution, opportunity, crossroads` |
| `community_mutual_aid` | 持续参与后形成可验证的互助关系 | `community, mutual_aid, connection, recovery` |
| `community_belonging` | 同一群体中的重复参与逐渐形成归属 | `community, belonging, connection, growth` |
| `community_peer_network` | 同行群体通过持续交流形成稳定网络 | `community, peer_network, stability, learning` |
| `community_stewardship` | 长期参与后承担边界清楚的共同维护责任 | `community, stewardship, responsibility, meaning` |
| `community_intergenerational_exchange` | 可靠群体中不同年龄角色进行双向经验交换 | `community, intergenerational, connection, meaning` |

## 18. Phase 3：世界事实与人物可靠性

Phase 3 的目标不是建立完整知识图谱，而是让事件硬条件不再依赖属性分数和低置信度单次推断。

### 18.1 事实结构

在 `src/types.ts` 增加：

```ts
export type WorldFactKind =
  | "relationship"
  | "career_activity"
  | "project"
  | "organization"
  | "financial_obligation"
  | "health_plan"
  | "community";

export interface WorldFact {
  id: string;
  kind: WorldFactKind;
  subjectId?: string;
  objectId?: string;
  status: string;
  summary: string;
  source: "user_fact" | "answer" | "accepted_history" | "model_inferred";
  confidence: number;
  firstSeenAtAgeInMonths: number;
  lastConfirmedAtAgeInMonths: number;
}

export interface WorldStateSnapshot {
  // 现有字段保持不变
  facts?: WorldFact[];
  version: 1 | 2;
}
```

兼容规则：

- 旧 `version:1` 读取时按 `facts=[]`。
- 首次提交含 facts 的新节点时写 `version:2`。
- 不批量回填旧历史；从用户资料、答案和后续接受节点逐步建立事实。
- `model_inferred` 事实不能单独满足重大承诺、背叛、债务、裁员和重大疾病等硬事件条件。

### 18.2 事实条件

```ts
export interface WorldFactCondition {
  kind: WorldFactKind;
  subjectId?: string;
  objectId?: string;
  statuses?: string[];
  allowedSources?: WorldFact["source"][];
  minConfidence?: number;
}

export interface LifeEventSeed {
  requiredFactGroups?: WorldFactCondition[][];
  forbiddenFacts?: WorldFactCondition[];
}
```

规则仍为组内 AND、组间 OR。`forbiddenFacts` 任一命中即淘汰事件。

### 18.3 人物事实

- partner/parent/child/sibling/friend/colleague/mentor 保留现有 `PersonState`。
- 重大关系事件要求 `source=user_fact|answer|history/accepted_history` 且 confidence>=0.75。
- 单次 `model_inferred` 人物只允许作为背景候选，不允许触发承诺、背叛、死亡、长期照护或财务共同责任。
- 事件生成后，`activeCharacters.personId` 必须引用已有可靠人物；模型提出新人物时先作为候选事实，只有用户接受该节点后才提交。

### 18.4 职业和财务事实

- 成果归属事件要求 active project + collaborator/organization。
- 结构性失业要求 active employment/organization 或明确外部行业事实。
- 债务恢复事件要求结构化 `financialState.totalDebtWan > 0`。
- 家庭财务事件要求可靠关系事实和共同支出/共同生活事实。
- 所有精确金额仍以 `FinancialState` 为真值，WorldFact 只记录语义状态。

### 18.5 社区上线

完成事实提交、置信度和读取兼容后，加入第16节6个 community 事件。Phase 3 前不得把它们改挂 `growth` 提前上线。

## 19. Phase 4：长期因果进度

Phase 4 用于解决 Phase 2 历史窗口方案的局限：历史截断、跨多年积累、多种行为共同推动同一结果、分支恢复和成熟度计算。

### 19.1 EventSource

```ts
export type EventSource =
  | "external_shock"
  | "life_stage"
  | "user_direction"
  | "decision_consequence"
  | "accumulation_milestone"
  | "arc_continuation";

export interface LifeEventSeed {
  source: EventSource;
}
```

迁移原则：

- 压力危机主要为 `external_shock` 或 `arc_continuation`。
- 分岔机会主要为 `life_stage` 或 `user_direction`。
- 恢复成长主要为 `decision_consequence` 或 `accumulation_milestone`。
- 平稳意义主要为 `accumulation_milestone`，少量为 `life_stage`。

### 19.2 CausalProgress

```ts
export interface CausalProgress {
  id: string;
  domain: "career" | "relationship" | "health" | "financial" | "self" | "community";
  goalType: string;
  sourceDecisionIntents: string[];
  sourceEventIds: string[];
  startedAtAgeInMonths: number;
  lastAdvancedAtAgeInMonths: number;
  accumulatedMonths: number;
  progressSignals: string[];
  supportingFactIds: string[];
  blockingFactIds: string[];
  maturity: number;
  status: "active" | "ready" | "resolved" | "abandoned";
}

export interface WorldStateSnapshot {
  causalProgress?: CausalProgress[];
}
```

### 19.3 成熟度

成熟度只能由代码根据接受后的结构化结果推进，模型不得直接返回最终 `maturity`。

```text
基础时间贡献：min(0.35, accumulatedMonths / expectedMonths * 0.35)
有效选择贡献：每个去重后的匹配 intent +0.12，最多0.36
支持事实贡献：每个有效 supporting fact +0.08，最多0.24
阻碍事实扣减：每个 active blocker -0.12
最终 clamp 到 0..1
```

各进度可以覆盖默认 `expectedMonths` 和贡献参数，但必须在独立配置中声明并测试。

### 19.4 到期结果队列

每轮新事件选择前：

```text
强制重大危机
→ 活跃前台 Arc
→ status=ready 的 CausalProgress 对应结果事件
→ 普通四模式选择
```

同一轮多个 ready 进度按以下顺序：

1. 等待时间最长；
2. 与用户主线匹配；
3. maturity 更高；
4. 最近未展示的领域。

到期结果没有合法候选时保持 ready，不得降级为随机压力事件。

### 19.5 Phase 2 条件迁移

- Phase 4 上线后，Phase 2 的 `historyConditionGroups` 保留为旧历史和无进度对象时的兼容入口。
- 同时存在 ready progress 和历史条件时，只生成一次结果事件。
- 事件提交成功后将对应 progress 标记为 resolved 或创建下一阶段 progress。

## 20. 选择结果与 DecisionGate

Phase 2 暂不新增完整 `EventOutcomeDefinition` 持久化，但必须强化生成和校验：

### 20.1 Phase 2 最小要求

- 在 `SimulationChoice` 增加可选 `eventOutcomeId?: string`。对本 Spec 的事件节点，该字段必填且必须等于当前事件 `allowedOutcomes` 之一；旧节点和 null 节点可缺失。
- 新事件的三个 `allowedOutcomes` 必须传入 Prompt。
- 三个选择至少覆盖两个不同 `eventOutcomeId`，且所有 ID 都在事件白名单内。
- 三个选择至少形成两个不同的规范化 `decisionIntent`；不得只替换措辞。
- 当不同结果本来就影响不同领域时，`expectedWorldDeltaTypes` 必须准确反映差异；纯财务或纯自我事件不强制伪造第二种 WorldDelta 类型，仍可由 `eventOutcomeId + decisionIntent` 证明战略差异。
- `recovery_growth` 的选择不能全部是继续恢复/继续观察/继续休息。
- `stability_meaning` 的选择不能全部是保持现状，至少一个应形成小幅具体变化。

在 `decisionGate.ts` 增加可选输入：

```ts
allowedOutcomeIds?: string[];
narrativeMode?: NarrativeMode;
```

新增 reason codes：

- `insufficient-event-strategy-coverage`
- `event-outcome-not-allowed`
- `recovery-options-only-maintain`
- `stability-options-no-concrete-progression`

### 20.2 Phase 4 完整结果

Phase 4 再增加 `outcomeId`、事实创建/关闭和 progress 更新，不要求 Phase 2 提前承担该持久化改造。

## 21. 涉及文件与任务拆分

### 21.1 Phase 1

| 文件 | 改动 |
|---|---|
| `src/types.ts` | 增加 `NarrativeMode`、EventMeta 可选模式/语义族 |
| `src/data/lifeEvents.ts` | 现有事件补模式和语义族；重写模式选择；删除固定 null 门和过滤回退 |
| `src/config/narrativeModePolicy.ts` | 新增基础权重和调权策略 |
| `src/data/lifeEvents.test.ts` | 模式映射、严格过滤、喘息、候选感知抽取测试 |
| `src/config/narrativeModePolicy.test.ts` | 模式权重和疲劳纯函数测试 |

### 21.2 Phase 2

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `HistoryItem.selectedDecisionIntent?`、`SimulationChoice.eventOutcomeId?` |
| 历史提交位置（当前 UI/状态转换代码） | 保存最终选择 intent，旧历史回退 |
| `src/utils/eventEligibility.ts` | 历史条件、上下文条件、年龄/月窗口评估 |
| `src/data/lifeEvents.ts` | 新增37个事件、修订11个旧事件 |
| `src/utils/eventPrompt.ts` | 四模式 Prompt 契约 |
| `src/utils/simulationResponse.ts` | 保留和规范化 `eventOutcomeId`，非法值交由 Gate 拒绝 |
| `src/utils/decisionGate.ts` | 模式相关战略覆盖校验 |
| 对应 `.test.ts` | 每个事件可达性、阻断和 Prompt/DecisionGate 测试 |

### 21.3 Phase 3

| 文件 | 改动 |
|---|---|
| `src/types.ts` | WorldFact、facts、WorldState version 2 |
| `src/utils/worldFacts.ts` | 事实提取、置信度、去重和提交 |
| `src/utils/simulationTransaction.ts` | 只提交接受节点中的事实变化 |
| `src/data/lifeEvents.ts` | 精确事实条件、6个 community 事件 |
| `src/utils/personTimeline.ts` | 人物事实可靠性和 source 规则 |

### 21.4 Phase 4

| 文件 | 改动 |
|---|---|
| `src/types.ts` | EventSource、CausalProgress、WorldState 扩展 |
| `src/utils/causalProgress.ts` | 创建、推进、成熟度、resolve |
| `src/utils/eventSelection.ts` | ready 结果队列优先级 |
| `src/utils/simulationTransaction.ts` | 原子提交 progress 变化 |
| `src/data/lifeEvents.ts` | 事件 source 和结果进度映射 |

## 22. 测试要求

### 22.1 Phase 1 单元测试

1. 14个现有事件均有明确 `narrativeMode` 和 `semanticFamily`。
2. `life_normal_transition` 在存在戏剧候选时仍可通过模式选择被选中。
3. 冷却过滤后为空时返回 `null`，不恢复被冷却事件。
4. 标签过滤后为空时返回 `null`，不恢复相似事件。
5. 类别过滤后为空时返回 `null`，不恢复同类别事件。
6. 空模式不会参与模式抽取。
7. 抽到空模式不会固定回退平稳模式。
8. 连续两个压力事件后，若存在恢复/平稳候选，压力权重显著降低。
9. major crisis 后稳定状态优先返回平稳事件或 null。
10. 不再存在全局固定 `NULL_EVENT_CHANCE` 路径。
11. 活跃 PressureArc 和健康升级顺序不变。
12. 固定 Math.random 时结果可重复。

### 22.2 Phase 2 事件契约测试

对37个新增事件逐一验证：

- ID 唯一；
- `semanticFamily` 非空；
- 模式与本 Spec 一致；
- 三个 allowedOutcomes 唯一；
- 生成选择的 `eventOutcomeId` 全部属于当前事件白名单，且至少两个不同；
- 至少两个结果不属于同一 continue/maintain 族；
- recovery 事件存在历史条件；
- stability 事件 `requiresFollowUp=false`；
- 非危机事件不创建 PressureArc；
- `requiredContextGroups` 不满足时不可达；
- 历史条件满足时可进入候选；
- 冷却和语义冷却有效。

### 22.3 属性与事实回归

- 单身或关系未知时不得触发承诺事件。
- 只有低 happiness 不得创造逃离机会、伴侣或急性健康危机。
- 只有高 intelligence 不得创造成果争夺或成果认可。
- 没有职业上下文不得触发组织责任和结构性裁员。
- 没有债务不得触发债务下降。
- 没有健康历史不得触发恢复成果。
- 80岁以上仍可触发自我、关系、健康和平稳意义事件，且正文面向未来。

### 22.4 统计测试

新增可注入随机数的测试入口，生产函数签名可不公开变更；可通过内部 `rng` 参数、模块私有选择器或 stub `Math.random` 完成。

至少构造以下状态，各抽样10,000次：

1. 稳定中年，无 Arc；
2. 刚结束重大危机；
3. 低健康但未到强制停摆；
4. 长期职业方向；
5. 明确关系主线；
6. 财务恢复过程；
7. 80岁以上仍有个人方向；
8. 所有压力候选在冷却中。

验收范围：

- 稳定状态且存在合法 recovery 候选时，`recovery_growth + stability_meaning` 占所有非 null 选择的55%–75%。
- 稳定状态但没有任何合法 recovery 候选时，`stability_meaning` 占所有非 null 选择的45%–65%；不得为了满足比例放宽 recovery 因果条件。
- 无重大风险条件时，major crisis 随机选择占比不高于5%；现有强制健康升级不计入随机分布。
- major crisis 后下一次新事件中，无新恶化证据时 `pressure_crisis` 为0。
- 不同 coreStoryFocus 的领域分布有统计差异，但不得绕过 `requiredContextGroups`。
- 被严格过滤的事件在任何抽样中选择次数为0。
- 所有候选为空时100%返回 null。

这些范围是回归门槛，不要求线上每10个节点严格满足比例。

### 22.5 长路线测试

至少完成10类路线，每类不少于3个固定种子：

- 职业坚持后能力形成；
- 职业渐进转型；
- 项目获得认可后收束；
- 关系修复；
- 主动放手并重新定向；
- 健康停摆后真实恢复；
- 健康未完全恢复但稳定管理；
- 债务逐步下降并形成缓冲；
- 兴趣成为长期实践；
- 高龄仍持续学习、创作或建立连接。

每条保存：完整节点、eventId、eventMode、semanticFamily、用户选择、selectedDecisionIntent、属性、财务、人物、Arc 和 WorldState。

## 23. 上线观测

新增开发/评估日志字段，不进入用户 UI：

```ts
{
  selectedMode,
  availableModes,
  modeWeightsBeforeFatigue,
  modeWeightsAfterFatigue,
  candidateIdsBeforeFilters,
  candidateIdsAfterFilters,
  selectedEventId,
  selectionReason
}
```

不得记录用户完整隐私文本；只记录事件 ID、模式、权重和结构化 reason code。

建议汇总指标：

- 四模式选择分布；
- 各领域事件分布；
- null 比例；
- 连续压力长度；
- 语义族短期重复率；
- recovery 事件历史条件命中来源；
- `requiredContextGroups` 阻断次数；
- Arc 结束后首个新事件模式。

## 24. 兼容与降级

- 旧事件缺 `eventMode`：通过事件 ID 查库；查不到则不参加模式疲劳。
- 旧历史缺 `selectedDecisionIntent`：通过被选选项的 `decisionIntent` 回退，再回退 `normalizeDecisionIntent(selectedChoice)`。
- 旧历史缺 `ageInMonths`：使用 `age * 12`。
- 新事件历史条件无法计算：视为不满足，不能宽松放行 recovery 事件。
- `requiredContextGroups` 无可靠证据：视为不满足。
- 所有候选为空：返回 null，不恢复旧候选。
- Phase 3 读取旧 WorldState：`facts=[]`，不报错。
- Phase 4 读取旧 WorldState：`causalProgress=[]`，继续使用 Phase 2 historyConditions。
- 新事件生成失败：沿用现有有限重试，不自动改抽压力事件。

## 25. 开发顺序与合并门槛

### PR 1：模式元数据与严格过滤

- 类型、现有事件映射、EventMeta；
- 删除过滤回退和全局 null 门；
- 保持选择逻辑暂时可编译；
- Phase 1 测试1–5通过。

### PR 2：模式权重与疲劳

- policy、候选感知模式选择、重大危机后喘息；
- Phase 1 全部测试和统计基线通过。

### PR 3：轻量 eligibility 基础设施

- selectedDecisionIntent；
- historyConditions、requiredContextGroups、semanticFamily；
- 旧事件修订；
- 不新增事件，先验证旧池行为。

### PR 4：职业、关系事件

- 第11、12节共16个事件；
- 对应 Prompt 和契约测试。

### PR 5：健康、财务事件

- 第13、14节共13个事件；
- 健康 Arc、财务连续性回归。

### PR 6：自我与成长事件

- 第15节8个事件；
- 高龄、平稳意义和长期创作路线。

### PR 7：完整路线评估

- 10类固定种子；
- 分布报告；
- 根据数据只调权重，不临时改变模式定义。

Phase 3 和 Phase 4 各自另开开发计划，不与 Phase 2 内容 PR 混合。

## 26. 完成定义

Phase 1–2 视为本轮事件库优化完成，必须同时满足：

1. 四模式成为新事件选择的一级结构。
2. `life_normal_transition` 不再被戏剧候选逻辑排除。
3. 全局固定 `NULL_EVENT_CHANCE` 被移除。
4. 标签、类别和冷却过滤不再恢复旧候选。
5. 14个旧事件完成模式/语义族映射，11个不可靠旧事件完成上下文修订。
6. 37个新增事件全部按第11–15节实现，不得只选取其中一部分后宣称事件库完成。
7. recovery 事件全部有可执行的历史因果条件。
8. 关系承诺、家庭责任和信任事件不再由属性分数单独创造。
9. HistoryItem 能保存或可靠恢复最终选择 intent。
10. `eventOutcomeId`、四模式 Prompt 和 DecisionGate 战略覆盖规则上线。
11. 单元、分布和10类长路线测试全部通过。
12. 健康升级、PressureArc、财务连续性、年龄一致性、报告邀请和终局逻辑无回归。

完整目标事件库视为完成，还必须继续满足：

13. Phase 3 世界事实和6个 community 事件上线。
14. Phase 4 CausalProgress 和到期结果队列上线。
15. 恢复、成长和意义事件在长路线中能够追溯到真实选择、时间或事实，不依赖模型临场编造。

任何只调 Prompt、只调权重、只增加少量正面事件、或保留过滤回退的实现，都不满足本 Spec。
