# AI 人生模拟器：年龄感知故事世界状态 Spec

## 1. 文档信息

- 文档状态：Approved for implementation
- 目标版本：Age-aware Story V1.1
- 已选终局方案：方案 B，有界长寿
- 规格决策日期：2026-07-11
- V1.1 修订日期：2026-07-12
- 适用范围：人生节点生成、事件调度、故事上下文、人物延续、属性变化、终局判定
- 依赖文档：
  - `event-system-v2-three-layer-spec.md`
  - `event-system-v2-context-continuity-spec.md`
  - `event-system-v2-fact-decay-spec.md`
  - `generic-fact-weight-gating-minimal-fix-design.md`

## 2. 背景

当前系统已经能够：

- 从用户选择出发推进年龄。
- 根据年龄范围筛选人生事件。
- 延续最近历史、关系副线和用户事实。
- 让模型生成 `age`、`stage`、剧情正文、选项和属性。

但年龄目前主要是一个数值参数，而不是故事世界状态。

这意味着模型可能知道主角“现在 104 岁”，并在文案中写出“暮年”“拄拐杖”等年龄符号，却没有同步推演：

- 父母、祖辈、伴侣、子女和朋友现在大约多少岁。
- 过去的人物是否仍然健在、在职、同住或能够承担当前行为。
- 主角当前更可能处于求学、就业、转型、退休、照护或传承中的哪个阶段。
- 某项行为在当前年龄和健康状态下是否合理。
- 一个项目、关系或机构经过数十年后是否还应保持原样。
- 当前选项是否真正适合该年龄，而不只是语言上带有年龄标签。

典型问题不局限于“104 岁仍有父母在工作”，还包括：

- 未成年阶段出现缺乏前提的全职管理岗位、购房或婚育选择。
- 30 岁节点仍把高中老师当作当前日常管理者。
- 55 岁仍机械生成“初入职场”的试用期叙事。
- 70 岁仍围绕晋升、加班和跳槽生成与青年阶段相同的选项。
- 早年人物跨越几十个节点后没有衰老、退休、迁移、疏远或离世。
- 年龄已经大幅推进，但项目、公司、伴侣关系和家庭结构完全静止。
- 高龄节点的健康、体力和照护需求与年轻阶段没有任何概率差异。

因此，本问题的本质是：

```text
年龄参与了路由，但没有参与世界建模、叙事渲染和结果验收。
```

## 3. 当前系统核查

### 3.1 年龄目前参与的逻辑

当前年龄被用于：

1. 决定事件是否进入候选池：`minAge <= age <= maxAge`。
2. 限制下一节点相对上一节点增加 1 到 4 岁。
3. 在 prompt 中告诉模型上一节点年龄。
4. 在页面上显示 `AGE` 和阶段名称。
5. 通过 prompt 声明达到终局年龄时应生成结局。

### 3.2 年龄目前没有参与的逻辑

当前年龄没有直接参与：

- `stage` 的确定与校验。
- 人物年龄估算和生命周期更新。
- 职业、教育、婚育、照护等角色可行性判断。
- 行为强度和身体能力判断。
- 健康变化的风险基线。
- 选项的年龄适配检查。
- 历史事实的时效性判断。
- 跨节点时间跨度的一致性检查。
- 模型返回结果的语义验收。

### 3.3 当前终局策略冲突已确定解决方向

当前界面允许用户选择 7 到 80 岁作为回溯起点，但下一节点 prompt 又规定 73 岁及以上必须谢幕。

这两个规则不能同时作为最终产品规则存在：

```text
允许从 80 岁开始一段新人生
vs
达到 73 岁必须立即结束人生
```

本 spec 已确定采用方案 B“有界长寿”：

- 73 岁开始进入终章概率区间，不立即结束。
- 允许 80 岁以上继续推进。
- 终章概率同时考虑年龄、健康、恢复状态和近期历史。
- 110 岁为绝对安全上限，到达后必须进入终章。
- 回溯起点继续允许 7 到 80 岁。

年龄适配与终局策略仍然保持分离。即使节点尚未进入终章，也必须符合年龄与时间逻辑。

## 4. 目标

本 spec 的目标是让年龄成为故事世界的一等状态。

具体目标：

1. 每轮生成前由代码派生统一的年龄上下文 `AgeContext`。
2. 事件调度不仅判断事件能否发生，还提供当前年龄阶段的渲染语义。
3. 人物关系随时间推进，能够衰老、退休、迁移、疏远、患病、离世或转为回忆。
4. 职业、教育、关系、健康和生活方式与当前年龄形成合理联系。
5. 模型输出必须经过年龄一致性验收，不能只校验字段是否完整。
6. 年龄规则以现实概率为基础，不把统计倾向写成绝对禁令。
7. 明确区分硬时间矛盾和可解释的低概率人生。
8. 保持现有 V2 三层事件架构，不把事件重新写成固定剧本。
9. 对旧历史、时光回溯和已有存档保持兼容。
10. 时间跨度由人生张力和未解决主线决定，使高张力阶段更密、稳定阶段更疏。
11. 年龄只约束行动的现实执行条件，不分配人生目标，不把模拟器变成人生阶段流水线。
12. Event 强度只能影响阶段性 PressureArc，必须通过 phase 自然降级，不能绑架长期人生方向。
13. 月级时间用于内部精度，用户只看到真正有未来分歧的 decision checkpoint。

## 5. 非目标

本 spec 不做：

- 不根据年龄机械决定一个人的职业、婚姻或价值观。
- 不规定所有人必须在固定年龄毕业、结婚、生育或退休。
- 不因为高龄就必然扣除健康或终止工作。
- 不建立医学级寿命预测模型。
- 不要求精确模拟每个角色的出生日期。
- 不在 V1 引入完整社会人口统计数据库。
- 不用关键词黑名单直接删除所有包含“父母”“工作”等词语的剧情。
- 不让前端承担故事一致性判断。
- 不恢复以具体剧情为核心的事件脚本库。
- 不要求逐月生成节点；月份只作为精确时间轴，节点密度仍由 LifeIntensity 控制。
- 不把每次状态更新都做成用户选择；没有真实分歧的变化属于 Episode 内部过程。
- 不把学习、事业、创业、创作、旅行、研究或新关系限定在某个标准年龄段。

## 6. 核心原则

### 6.1 年龄是世界状态，不是文案标签

年龄必须同时影响：

```text
事件可能性
人物状态
社会角色
行为可行性
身体风险
时间连续性
选项语义
终局策略
```

仅把 `stage` 写成“暮年深耕”不算完成年龄适配。

### 6.2 硬约束与软约束必须分开

硬约束用于处理时间和状态矛盾，例如：

- 下一节点年龄小于或等于上一节点年龄。
- 已故人物以现实方式直接参与当前行动。
- 同一人物年龄没有随主角同步增长。
- 项目明明经过 20 年却仍被描述为“刚开始的第二个月”。
- 达到产品定义的硬终局条件却仍返回普通选择节点。

软约束用于处理现实概率，例如：

- 70 岁仍然全职工作并非不可能，但需要符合历史、健康和职业背景。
- 40 岁重新读大学完全可以成立，但应说明转型或再教育背景。
- 90 岁写论文可以成立，但不应默认仍承担青年研究员式的高强度日常。
- 高龄健康良好可以成立，但不应与多年健康史和当前行为强度相冲突。

### 6.3 明确事实优先于统计默认

优先级建议：

```text
硬时间事实与已提交世界状态
> 用户明确提供的现实事实
> 用户选择造成的历史结果
> 最近节点的连续状态
> 年龄阶段的现实概率默认
> 事件 intent
> 模型自由发挥
```

年龄默认可以被明确历史解释，但不能覆盖已经提交的硬事实。

### 6.4 年龄不等于能力判决

系统不能把年龄阶段直接翻译成能力不足。

正确做法：

- 年龄改变事件概率、恢复成本、社会角色和可选策略。
- 健康、财富、人际、才智和历史积累共同影响具体能力。
- 高龄角色可以继续工作、创作、研究和经营，但方式可能从亲力亲为转向顾问、协作、传承或低强度参与。

错误做法：

- `age >= 60` 就禁止创业。
- `age >= 70` 就强制健康下降。
- `age >= 35` 就强制出现婚育压力。
- `age >= 50` 就禁止学习新技能。

### 6.5 延续关系不等于冻结人物

关系线需要延续，但人物状态必须随时间变化。

例如“父母曾反对职业选择”可以长期影响主角，但延续方式应随年龄变化：

```text
25 岁：父母直接施压。
45 岁：父母逐渐需要照护，旧冲突转为理解或遗憾。
70 岁：父母可能已经离世，影响以回忆、遗物或价值观惯性存在。
```

### 6.6 时间推进必须产生世界变化

年龄增长不仅是主角数字增加。经过较长时间后，至少应重新评估：

- 人物年龄和状态。
- 工作身份和组织关系。
- 项目阶段和资产积累。
- 家庭结构和照护关系。
- 健康风险和生活节奏。
- 活跃副线是否仍然有效。

### 6.7 年龄约束执行，不约束愿望

最高级产品原则：

```text
Age constrains execution, not aspiration.
年龄约束执行条件，不约束人生愿望。
```

允许发生：

- 45 岁重新读书。
- 55 岁创业。
- 70 岁写书。
- 80 岁旅行。
- 90 岁继续研究。

年龄系统可以调整这些行动的：

- 时间跨度。
- 身体负荷。
- 资金与支持系统。
- 合作方式。
- 风险与恢复成本。
- 社会和家庭现实反馈。

年龄系统不得：

- 把读书自动替换为回忆校园。
- 把创业自动替换为退休准备。
- 把旅行自动替换为居家养老。
- 把研究自动替换为向年轻人讲述往事。
- 因为行为少见就判定故事错误。

只有用户明确进入终章后，叙事才可以从“继续选择”转为“人生收束”。80 岁、90 岁但尚未进入终章时，节点仍必须面向未来。

### 6.8 用户选择高于年龄默认

叙事优先级：

```text
用户刚做出的选择
> 用户持续强化的 DirectionArc
> 已建立能力、作品、资产和关系
> 当前事件 intent
> 年龄亲和度和阶段默认
```

如果用户在 55 岁选择创业，年龄系统只能调整创业方式、节奏和支持条件，不能把主线改成退休或照护。

### 6.9 PressureArc 单写者原则

```text
Only PressureArcStateMachine may decide PressureArc state transitions.
只有 PressureArcStateMachine 可以决定 PressureArc 状态变化。
```

所有权分为两层：

```text
PressureArcStateMachine：唯一决定创建、切换 phase、降级、暂停、恢复和结束。
SimulationTransaction：唯一负责原子持久化节点、WorldDelta、Arc 状态和世界快照。
```

其他模块只能：

- Event：提出开始 PressureArc 的触发条件。
- generateNode：提出本轮发生的事实、WorldDelta 和 ArcSignalProposal。
- Validation：接受或拒绝提案，不能修改 Arc。
- Repair：重写叙事和提案，不能修改 Arc。
- DecisionGate：判断是否值得展示，不能修改 Arc。
- PhaseTransitionPolicy：提供声明式规则，本身不执行写入。

禁止任何模块直接赋值：

```ts
pressureArc.phaseId = "growth";
pressureArc.status = "resolved";
pressureArc.phaseCheckpointCount += 1;
worldState.foregroundPressureArcId = anotherArcId;
```

所有状态变化必须通过纯函数 `reducePressureArc` 产生 TransitionDecision，再由统一事务提交。

### 6.10 持续过程必须拥有代码时间所有权

年龄正确推进不等于世界时间正确推进。凡是具有明确开始时间、持续周期或预计结束时间的过程，不能只作为自然语言留在最近历史中。

典型过程包括：

- 妊娠与生产。
- 康复、治疗和复查周期。
- 学制、培训和资格获取。
- 合同、任职和组织交接期。
- 搬迁、照护和其他跨月安排。

最高级规则：

```text
Model may propose a process; code owns its clock.
模型可以提出过程，代码拥有过程时钟。
```

具体要求：

- 模型可以通过结构化 delta 提出过程开始、完成或中断。
- 服务层必须在确定 `targetAgeInMonths` 后、生成下一节点前推进所有 active process。
- 模型不得自由保持孕周、康复月数、学年或合同阶段等可由时间计算的字段。
- 时间跨过预计结束点时，过程必须完成、中断或产生有证据的延期，不能原样冻结。
- 没有新选择的过程变化写入 `StoryEpisode.internalTransitions`，不增加用户关卡。
- OngoingProcess reducer 是过程时间与状态的唯一决策者；Validation 和模型只能 propose/check。

## 7. 年龄阶段模型

### 7.1 LifeStage 定义

V1 使用可配置年龄段，不直接写死在 prompt 中：

```ts
export type LifeStage =
  | "childhood"
  | "adolescence"
  | "emerging_adulthood"
  | "early_adulthood"
  | "midlife"
  | "mature_adulthood"
  | "later_life"
  | "longevity";

export interface LifeStageRange {
  stage: LifeStage;
  minAge: number;
  maxAge?: number;
}
```

建议默认值：

| LifeStage | 默认年龄 | 说明 |
| --- | ---: | --- |
| childhood | 7-12 | 未成年，法律与监护边界明显 |
| adolescence | 13-17 | 未成年，自主性增强但仍受法律与监护约束 |
| emerging_adulthood | 18-24 | 已成年，可进入多种教育、工作或生活路径 |
| early_adulthood | 25-34 | 成年阶段，不预设职业、关系或家庭任务 |
| midlife | 35-49 | 成年阶段，不预设必须工作、婚育或承担照护 |
| mature_adulthood | 50-64 | 恢复成本可能变化，但所有人生方向继续开放 |
| later_life | 65-79 | 制度与身体条件可能变化，但不默认退休或收束 |
| longevity | 80+ | 长寿阶段，执行支持更重要，但仍然面向未来 |

年龄段只提供法律、时间、恢复和代际关系背景，不是人生任务清单，也不得用于选择剧情 domain。

`LifeStage` 是内部兼容名称，语义等同于 chronological band。禁止把它翻译成“奋斗期”“成家期”“退休期”“养老期”等带任务导向的阶段名后注入 prompt。

### 7.2 AgeContext

每轮生成前必须由代码派生：

```ts
export interface AgeContext {
  currentAge: number;
  previousAge?: number;
  currentAgeInMonths: number;
  previousAgeInMonths?: number;
  elapsedMonths: number;
  elapsedYears: number;
  lifeStage: LifeStage;

  activeAgencyDirections: string[];
  executionAdaptations: string[];
  supportFactors: string[];
  healthAndRecoveryContext: string[];
  timeTransitionRequirements: string[];

  hardConstraints: string[];
  probabilityNotes: string[];
  exceptionalFacts: string[];
}
```

字段职责：

- `currentAge`：由 `currentAgeInMonths` 派生的展示年龄，不交给模型自由决定。
- `previousAge`：上一节点年龄。
- `currentAgeInMonths`：本轮目标时间，是时间推进的唯一精确真值。
- `previousAgeInMonths`：上一节点精确时间。
- `elapsedMonths`：本轮跨越月份。
- `elapsedYears`：`elapsedMonths / 12` 的派生值，用于概率计算和 prompt 展示。
- `lifeStage`：代码派生的标准阶段。
- `activeAgencyDirections`：来自用户选择和已强化主线的当前人生方向，优先于年龄默认。
- `executionAdaptations`：完成当前方向时需要调整的节奏、负荷、资源或协作方式。
- `supportFactors`：当前已有或缺少的健康、关系、资金和环境支持。
- `healthAndRecoveryContext`：年龄与当前健康共同形成的恢复和风险背景。
- `timeTransitionRequirements`：跨越时间后必须更新的世界状态。
- `hardConstraints`：不得违反的时间与状态事实。
- `probabilityNotes`：现实概率备注，只能调整执行方式和风险，不能删除人生方向。
- `exceptionalFacts`：用户或历史已经建立的低概率但真实事实。

### 7.3 AgeContext 生成规则

新增纯函数：

```ts
function buildAgeContext(input: {
  previousAgeInMonths?: number;
  targetAgeInMonths: number;
  attributes: LifeAttributes;
  history: HistoryItem[];
  people: PersonState[];
  endingPolicy: EndingPolicy;
}): AgeContext
```

要求：

- 结果必须确定、可测试，不依赖模型。
- 年龄段配置集中管理，禁止在多个 prompt 中散落数字。
- 健康指导必须结合 `health`，不能只看年龄。
- 工作指导必须结合历史职业状态，不能只看年龄。
- 明确异常事实必须进入 `exceptionalFacts`，避免模型反复质疑已建立事实。

## 8. 人物生命周期模型

### 8.1 PersonState

重要人物需要从纯文本副线升级为轻量状态：

```ts
export type PersonRelation =
  | "parent"
  | "grandparent"
  | "partner"
  | "child"
  | "sibling"
  | "friend"
  | "colleague"
  | "mentor"
  | "other";

export type PersonLifeStatus =
  | "active"
  | "retired"
  | "limited"
  | "distant"
  | "deceased"
  | "unknown";

export interface PersonState {
  id: string;
  displayName?: string;
  relation: PersonRelation;

  explicitAge?: number;
  estimatedAgeRange?: [number, number];
  ageInMonthsAtLastUpdate?: number;
  protagonistAgeInMonthsAtLastUpdate?: number;

  lifeStatus: PersonLifeStatus;
  occupationStatus?: "student" | "working" | "retired" | "not_working" | "unknown";
  healthStatus?: "stable" | "fragile" | "care_dependent" | "unknown";

  lastSeenNodeIndex?: number;
  lastKnownLocation?: string;
  relationshipSummary?: string;
  source: "user_fact" | "answer" | "history" | "model_inferred";
  confidence: number;
}
```

### 8.2 人物年龄推进

如果人物已知年龄：

```ts
personAgeDeltaMonths = currentProtagonistAgeInMonths - protagonistAgeInMonthsAtLastUpdate
newPersonAgeInMonths = ageInMonthsAtLastUpdate + personAgeDeltaMonths
```

如果人物年龄未知：

- 使用关系类型产生宽松估算范围。
- 估算只用于发现明显矛盾，不作为精确事实展示给用户。
- 一旦用户或剧情明确人物年龄，应替换估算值。
- `confidence` 较低时只能生成软警告，不能直接拒绝剧情。

### 8.3 人物出现方式

人物在剧情中的出现分为：

```ts
export type PersonPresenceMode =
  | "active_scene"
  | "remote_contact"
  | "indirect_update"
  | "memory"
  | "legacy";
```

规则：

- `active`、`retired`、`limited` 人物可根据健康状态出现在现实场景。
- `distant` 人物更适合远程联系或间接消息。
- `deceased` 人物只能通过回忆、遗物、纪念、旧信件或长期影响出现。
- 年龄范围明显超过合理活跃范围且没有明确异常事实时，不得默认生成高强度现实行动。
- 人物状态不应仅由模型一次正文永久改写；状态变化必须通过结构化 delta 提交。

### 8.4 关系副线的年龄衰减

`BackgroundThread` 的延续性不能只按节点距离计算，还要加入年龄与人物状态：

```ts
effectiveThreadWeight =
  baseWeight
  * nodeDecay
  * ageRelevanceMultiplier
  * personStatusMultiplier
```

示例：

- 早年父母反对仍可以作为长期心理事实。
- 父母当前是否可以直接打电话、工作或提供经济支持，要由 `PersonState` 判断。
- 已故父母的关系线可以保留，但 `presenceMode` 必须转为 `memory` 或 `legacy`。

### 8.5 OngoingProcess

`PersonState` 负责人物身份和年龄，`OngoingProcess` 负责跨月持续状态。V1.1 采用轻量通用结构，不新增完整婚姻或家庭模拟子系统：

```ts
export type OngoingProcessType =
  | "pregnancy"
  | "recovery"
  | "education"
  | "contract_transition"
  | "relocation"
  | "caregiving";

export interface OngoingProcess {
  id: string;
  type: OngoingProcessType;
  subjectPersonIds: string[];
  status: "active" | "completed" | "interrupted";
  startedAtAgeInMonths: number;
  expectedEndAgeInMonths?: number;
  lastUpdatedAtAgeInMonths: number;
  completionSummary?: string;
  exceptionalBasis?: string[];
  source: "user_fact" | "history" | "model_proposed";
  confidence: number;
}
```

派生规则：

- `elapsedProcessMonths = targetAgeInMonths - startedAtAgeInMonths` 由代码计算。
- 妊娠月份、康复月份、学年等展示值由 `elapsedProcessMonths` 派生，模型返回值不作为时间真值。
- `targetAgeInMonths >= expectedEndAgeInMonths` 时，reducer 必须给出 completed、interrupted 或有证据延期的决定。
- 过程完成后的下一节点不得重新描述为同一 active 阶段，除非通过新的 delta 创建不同 processId。
- 时光回溯直接恢复目标节点的 process 快照，不重新执行未来 process transition。

## 9. 年龄与事件系统的结合

### 9.1 保持 V2 三层架构

年龄感知不改变现有职责：

```text
Trigger Layer：决定事件是否可能进入候选池。
Intent Layer：定义人生张力。
Render Layer：结合 AgeContext 渲染具体故事。
```

新增一层生成前上下文：

```text
World State Layer：派生年龄阶段、人物状态和时间约束。
```

完整流程：

```text
History + Attributes + People + Current Timeline
        ↓
Current World State + Trigger / Active Arc
        ↓
Intent + Choice Temporal Hint
        ↓
LifeIntensity + TimelineAdvance
        ↓
Target AgeContext + Age Rendering Profile
        ↓
AI Render
        ↓
Structural Validation
        ↓
Age Consistency Validation
        ↓
Commit Node + World Delta
```

### 9.2 EventAgeProfile

事件仍然保持抽象，但可按阶段提供执行条件适配：

```ts
export interface EventAgeProfile {
  executionAdaptations: string[];
  riskFactors: string[];
  supportOptions: string[];
  forbiddenStereotypes: string[];
}

export interface EventIntent {
  type: string;
  meaning: string;
  tensionAxes: string[];
  allowedOutcomes: ActionPrimitive[];
  emotionalTone?: EmotionalTone;
  ageProfiles?: Partial<Record<LifeStage, EventAgeProfile>>;
  temporalProfile?: TemporalProfile;
  phasePolicyId?: string;
}
```

`ageProfiles` 只能调整同一人生方向的执行方式、风险和支持条件，不能改变事件 domain，也不能把行动替换为退休、照护或回忆。

`temporalProfile` 只定义叙事密度和合理结果跨度，不定义具体剧情。它与 `fingerprint.intensity` 分工如下：

```text
fingerprint.intensity：事件严重程度、去重和压力控制。
temporalProfile：用户需要多快再次做选择、这一节点跨越多长时间。
```

`temporalProfile` 只初始化 PressureArc 的首个 phase。后续强度必须读取 `phasePolicyId` 对应的当前 phase，禁止持续读取最初事件强度。

例如同一个创业事件：

| 阶段 | 允许的执行适配，不改变创业方向 |
| --- | --- |
| emerging_adulthood | 经验较少、试错空间、启动资金和团队建立 |
| early_adulthood | 现金流、能力定位、团队和长期投入 |
| midlife | 既有责任、行业经验、风险敞口和资源重组 |
| mature_adulthood | 经验、人脉、资金结构与精力配置 |
| later_life/longevity | 负荷、健康支持、合作执行和持续参与方式 |

### 9.3 年龄硬约束与年龄亲和度

年龄过滤必须区分硬约束和软亲和度：

```ts
export interface HardAgeConstraint {
  minAge?: number;
  maxAge?: number;
  reason: string;
  basis: "legal" | "biological" | "historical_fact";
}

export interface AgeAffinity {
  preferredRange?: [number, number];
  minimumMultiplier: number;
  outsideRangeAdaptations: string[];
}

export interface LifeEventSeed {
  // existing fields
  hardAgeConstraint?: HardAgeConstraint;
  ageAffinity?: AgeAffinity;
}
```

规则：

- `hardAgeConstraint` 才能把事件移出候选池。
- 硬约束必须说明法律、生理或已建立时间事实依据。
- 事业、创业、学习、创作、旅行、研究、财富、成长和一般关系事件不得设置硬 `maxAge`。
- `ageAffinity` 只能影响默认抽取权重，不能让权重降为 0。
- 用户刚选择的方向、DirectionArc 或 PressureArc 命中该事件时，年龄亲和度乘数强制为 1。
- 年龄超出 preferredRange 后必须适配执行方式，不得替换人生目标。

默认权重：

```ts
function calculateAgeAffinityMultiplier(
  age: number,
  affinity: AgeAffinity | undefined,
  userDirected: boolean
): number {
  if (userDirected || !affinity?.preferredRange) return 1;

  const [min, max] = affinity.preferredRange;
  if (age >= min && age <= max) return 1;

  const distance = age < min ? min - age : age - max;
  const multiplier = distance <= 10
    ? 0.8
    : distance <= 20
      ? 0.6
      : 0.4;

  return Math.max(multiplier, affinity.minimumMultiplier);
}
```

建议 `minimumMultiplier` 默认不低于 0.4。

#### 9.3.1 事件亲和度与结果现实概率分层

`AgeAffinity` 只决定抽象事件进入候选池的默认权重，不能代表该事件下所有具体结果都具有相同概率。

例如同一个“关系承诺与现实成本”事件，在不同历史下可以渲染为继续交往、同居、结婚、再婚或重新评估关系。事件在 50 岁仍可成立，但“已有长期伴侣后结婚”和“没有任何背景的首次婚姻并立即生育”不是同一概率层级。

新增结果级现实概率：

```ts
export type PlausibilityTier = "ordinary" | "uncommon" | "exceptional";

export interface OutcomePlausibilityContext {
  tier: PlausibilityTier;
  reasons: string[];
  supportingFacts: string[];
  requiresExplicitBasis: boolean;
}
```

具体结果尚未生成前，服务层只能构建 `OutcomePlausibilityGuidance`，向模型说明哪些结果需要更多依据；候选节点生成后，Validation 才能根据正文、delta 和世界状态产生最终 `OutcomePlausibilityContext`。禁止在看到具体结果之前预先把整个节点判为 uncommon 或 exceptional。

派生输入包括：

- 当前年龄和相关人物的已知或估算年龄。
- 用户是否明确选择该方向。
- 最近关系、健康和家庭历史。
- 已提交的 PersonState、OngoingProcess 和 exceptionalFacts。
- 当前行为是否属于社会选择、生物过程或法律过程。

处理规则：

- `ordinary`：正常生成和提交。
- `uncommon`：允许生成；正文或已有历史需要提供自然背景，但不能仅因年龄拒绝。
- `exceptional`：必须具有明确的健康、医疗、人物年龄、支持条件或用户事实；缺失依据时触发一次专用修复。
- 用户明确选择晚婚、再婚或其他非标准路径时，不应用年龄惩罚，但仍遵守确定性时间和生物约束。
- 一般关系选择不得设置硬 maxAge；生物过程可以使用有依据的 `HardAgeConstraint` 或 `requiresExplicitBasis`。
- 50 岁结婚本身最多属于 `uncommon`，不得作为错误；妊娠方处于极低概率年龄范围且没有任何支持背景时可以属于 `exceptional`。

### 9.4 旧 minAge/maxAge 迁移

现有事件的 `minAge/maxAge` 不再默认作为硬过滤：

```text
旧 minAge/maxAge
→ ageAffinity.preferredRange
```

只有经过逐项审核并补充 `basis/reason` 的事件，才能迁移为 `hardAgeConstraint`。

迁移要求：

- `career`：移除硬 maxAge。
- `opportunity`：移除硬 maxAge。
- `financial`：移除硬 maxAge。
- `growth`：移除硬 maxAge。
- 一般 `relationship`：移除硬 maxAge。
- `health`：年龄可影响概率和表现，不默认设置硬 maxAge。
- 未成年人法律限制等少数事件可以设置 hard minAge。

dispatcher 新逻辑：

```ts
const candidates = events
  .filter((event) => satisfiesHardAgeConstraint(event, age))
  .filter((event) => isEligibleForCandidatePool(event, state, user, age));

const finalWeight = baseWeight
  * focusBoost
  * calculateAgeAffinityMultiplier(age, event.ageAffinity, userDirected);
```

禁止继续使用：

```ts
age >= event.minAge && age <= event.maxAge
```

作为所有事件的统一硬过滤。

### 9.5 null event 必须延续主体性

无强事件不代表进入标准年龄生活模板。

null event 的推进优先级：

```text
用户刚做出的选择后果
> DirectionArc、PressureArc 或长期主线
> 已建立的项目、作品、事业和关系
> 当前属性变化
> 年龄背景细节
```

要求：

- 非终章 null event 仍然必须面向未来。
- 不得因为 60、70、80 或 90 岁就自动选择退休、照护、回忆或传承主题。
- 如果用户当前主线是学习、创业、写作、旅行或研究，null event 应推进该方向的日常后果。
- 只有用户主动选择稳定、退出、退休或收束时，这些内容才能升级为主线。

## 10. 年龄与五维属性

### 10.1 禁止机械年龄扣分

年龄增长不能直接等价于：

```text
health -= 固定值
happiness -= 固定值
wealth += 固定值
```

### 10.2 健康风险上下文

年龄应改变健康事件的风险基线和恢复成本，但最终变化仍取决于：

- 当前健康值。
- 工作与生活强度。
- 慢性问题是否已建立。
- 睡眠、运动、医疗和照护支持。
- 本轮时间跨度。
- 用户选择的恢复策略。

建议：

```ts
interface HealthAgeContext {
  baselineRisk: "low" | "moderate" | "elevated" | "high";
  recoverySensitivity: "normal" | "slower" | "fragile";
  establishedConditions: string[];
  protectiveFactors: string[];
}
```

### 10.3 其他属性

- `intelligence` 表示可用认知、经验和解决问题能力，不应随年龄自动下降。
- `wealth` 由现金流、资产、支出和风险共同决定，不因年龄自动增加。
- `relation` 应反映当前支持网络，不等于认识的人数。
- `happiness` 由现实状态和选择后果决定，不使用年龄刻板印象。

## 11. 时间连续性

### 11.1 时间推进由人生强度主导

V1 不再按年龄段直接决定 1 到 4 年步长。

时间跨度优先级：

```text
当前未解决主线 / 当前事件
> 当前选择带来的现实压力
> LifeStage 修正
> 年龄、已知里程碑和终局边界
```

年龄负责边界，不负责决定叙事密度。

### 11.2 月级时间轴

为了支持半年级高张力节点，内部时间真值改为月：

```ts
export interface TimelinePosition {
  ageInMonths: number;
}

export interface TimelineAdvance {
  elapsedMonths: number;
  targetAgeInMonths: number;
  targetAge: number;
  lifeIntensity: LifeIntensity;
  reasonCodes: string[];
}
```

派生规则：

```ts
const targetAge = Math.floor(targetAgeInMonths / 12);
const remainingMonths = targetAgeInMonths % 12;
```

展示规则：

- 整岁显示“30 岁”。
- 非整岁可显示“30 岁 8 个月”。
- 页面原有整数 `age` 保留为兼容字段，但不能再作为时间计算真值。
- 同一整数年龄可以存在多个节点，只要 `ageInMonths` 严格递增。

### 11.3 LifeIntensity

```ts
export type LifeIntensity =
  | "critical"
  | "high_tension"
  | "normal"
  | "stable";

export interface TemporalProfile {
  lifeIntensity: LifeIntensity;
  durationMonths: [number, number];
  requiresFollowUp: boolean;
}

export interface ChoiceTemporalHint extends TemporalProfile {
  reason: string;
}

export interface SimulationChoice {
  // existing fields
  temporalHint?: ChoiceTemporalHint;
  decisionIntent?: string;
  expectedWorldDeltaTypes?: WorldDelta["type"][];
}
```

`LifeIntensity` 表示当前人生阶段需要多密的用户参与，不评价这段人生是否重要。

默认跨度：

| LifeIntensity | 月份范围 | 典型情况 |
| --- | ---: | --- |
| critical | 1-6 | 急性健康问题、关系破裂、失业或现金流断裂 |
| high_tension | 6-12 | 创业早期、重大转型、融资、团队冲突 |
| normal | 12-36 | 工作积累、关系调整、长期学习 |
| stable | 36-60 | 平稳经营、退休生活、长期沉淀 |

预设选项由节点生成模型同时返回 `temporalHint`，服务层只接受已定义枚举和合法月份范围。

自定义选择没有 hint 时：

1. 调用一次 JSON-only `classifyChoiceTemporalHint`。
2. 分类输入只包含自定义选择、当前事件、PressureArcState、当前属性和 AgeContext。
3. 分类失败时回退到当前 PressureArc phase 或事件 temporal profile；两者都不存在时使用 `normal, 12-24 个月`。
4. 自定义选择分类调用不生成剧情，也不修改世界状态。

### 11.4 LifeIntensity 派生

```ts
function deriveLifeIntensity(input: {
  pressureArc?: PressureArcState;
  event?: LifeEventSeed | null;
  selectedChoiceTemporalHint?: ChoiceTemporalHint;
  attributes: LifeAttributes;
  recentHistory: HistoryItem[];
}): TemporalProfile
```

派生顺序：

1. 有前台 `PressureArcState` 时，当前 phase definition 是唯一基础 temporal profile。
2. PressureArc 已存在时，禁止再次合并最初 Event temporalProfile 或 fingerprint intensity。
3. 用户选择若要提高当前强度，必须通过 PhaseTransitionPolicy 进入升级 phase，或创建新的独立 PressureArc；不得临时覆盖 phase。
4. 没有 PressureArc 时，才合并 `ChoiceTemporalHint` 与新 Event temporalProfile。
5. 新事件没有 profile 时，根据现有 fingerprint 兼容推导首阶段强度。
6. null event 且连续两个节点状态稳定时，允许进入 `stable`。
7. 健康低于 25、财富低于 15 或明确急性危机时，应创建或升级 PressureArc，而不是在 phase 之外直接覆盖 LifeIntensity。
8. 年龄和 LifeStage 只修正时间上下限，不覆盖 phase 所有权。

仅在“当前没有 PressureArc，需要创建新 PressureArc”时使用以下合并算法：

```ts
const intensityRank: Record<LifeIntensity, number> = {
  stable: 0,
  normal: 1,
  high_tension: 2,
  critical: 3
};
```

- 不同 intensity：选择 rank 更高者的 `durationMonths`。
- 相同 intensity 且区间有交集：使用区间交集。
- 相同 intensity 但区间无交集：使用最大跨度更短的 profile。
- `requiresFollowUp` 使用逻辑 OR。

兼容映射：

```text
eventIntensity=major → high_tension, 6-12 个月
eventIntensity=minor → normal, 12-24 个月
null + 非稳定连续状态 → normal, 12-36 个月
null + 连续稳定状态 → stable, 36-60 个月
```

事件可提供更精确的 `temporalProfile` 覆盖兼容映射。

### 11.5 LifeStage 修正

LifeStage 只用于防止跳过阶段性硬边界：

- `childhood/adolescence`：默认最大 12 个月，避免跳过学年和关键教育节点。
- `emerging_adulthood`：默认最大 24 个月，除非明确处于稳定长期项目。
- `early_adulthood/midlife/mature_adulthood`：使用 intensity 默认范围。
- `later_life/longevity`：不自动缩短；稳定状态可以跳 3 到 5 年。
- 任意年龄出现 critical/high_tension 时，都优先使用较短跨度。

### 11.6 时间推进计算

```ts
const temporalProfile = deriveLifeIntensity({
  pressureArc,
  event,
  selectedChoiceTemporalHint,
  attributes,
  recentHistory
});

const elapsedMonths = stableInteger({
  min: temporalProfile.durationMonths[0],
  max: temporalProfile.durationMonths[1],
  namespace: "timeline-advance",
  seed: simulationSeed,
  fingerprint: branchFingerprint
});

const currentLifeStage = deriveLifeStage(Math.floor(currentAgeInMonths / 12));

const targetAgeInMonths = clampTimelineAdvance({
  currentAgeInMonths,
  elapsedMonths,
  currentLifeStage,
  knownMilestones,
  hardMaximumAgeInMonths: endingPolicy.hardMaximumAge * 12
});
```

规则：

- 同一分支重复生成时 `elapsedMonths` 必须相同。
- 结构或语义重试不得重新抽取时间跨度。
- 时间推进不能越过已知的下一硬里程碑；应截断到该里程碑。
- 达到 110 岁上限时截断到 `110 * 12`。
- 模型返回的 `age` 只用于兼容解析，服务层必须覆盖 `age` 和 `ageInMonths`。

### 11.7 事件选择顺序

加入事件强度后，流程调整为：

```text
当前时间与世界状态
→ 延续 PressureArc 当前阶段，或用当前年龄选择新事件
→ 派生 LifeIntensity / TemporalProfile
→ 计算 elapsedMonths 和 targetAgeInMonths
→ 构建目标时间的 AgeContext
→ 渲染这段时间后的结果节点
```

事件 eligibility 使用 `currentAgeInMonths` 对应的当前年龄，而不是尚未计算的目标年龄。

事件表示“从当前时间开始发生的张力”，目标节点表示该张力发展一段时间后的结果。

### 11.8 DirectionArc 与 PressureArc 分层

长期人生方向不能直接拥有永久高强度。

```ts
export type ArcStatus = "active" | "background" | "dormant" | "resolved";

export interface DirectionArc {
  id: string;
  directionType: string;
  summary: string;
  status: ArcStatus;
  startedAtAgeInMonths: number;
  userReinforcementCount: number;
  establishedAssets: string[];
}

export interface PressureArcState {
  id: string;
  eventId: string;
  eventIntentType: string;
  directionArcId?: string;
  phasePolicyId: string;
  phaseId: string;
  status: "active" | "stabilizing" | "resolved";
  startedAtAgeInMonths: number;
  phaseStartedAtAgeInMonths: number;
  phaseCheckpointCount: number;
  totalCheckpointCount: number;
  unresolvedSummary: string;
}
```

职责：

- `DirectionArc` 表示创业、写作、研究、旅行、学习等长期人生方向，可以持续多年。
- `PressureArc` 表示融资失败、现金流、疾病恢复、团队冲突等阶段性问题，必须自然衰减或解决。
- Event 创建或激活 PressureArc，不直接把 DirectionArc 永久设为 high_tension。
- PressureArc 解决后，DirectionArc 可以继续以 normal/stable 状态存在。
- 同一时刻最多一个 PressureArc 位于前台；其他未解决压力保持 `stabilizing` 并保留原 phase 计数。
- 新独立 critical 事件可以临时成为前台，但不得删除或重置原 PressureArc。

### 11.9 PhaseTransitionPolicy

```ts
export type ArcExitCondition =
  | { type: "choice_outcome"; outcome: string }
  | { type: "arc_signal"; signalType: string }
  | { type: "attribute_at_least"; attribute: keyof LifeAttributes; value: number }
  | { type: "attribute_at_most"; attribute: keyof LifeAttributes; value: number }
  | { type: "world_delta"; deltaType: WorldDelta["type"] }
  | { type: "elapsed_months"; value: number }
  | { type: "checkpoint_cap"; value: number };

export interface ArcPhaseDefinition {
  id: string;
  lifeIntensity: LifeIntensity;
  durationMonths: [number, number];
  minCheckpoints: number;
  maxCheckpoints: number;
  exitConditions: ArcExitCondition[];
  nextPhaseId?: string;
  fallbackPhaseId?: string;
  resolvesPressureArc?: boolean;
}

export interface PhaseTransitionPolicy {
  id: string;
  initialPhaseId: string;
  allowedSignalTypes: string[];
  phases: ArcPhaseDefinition[];
}
```

阶段转换规则：

1. 每个节点提交前，根据用户选择、属性、world delta、经过月份和 checkpoint 数评估 exitConditions。
2. 未达到 `minCheckpoints` 时，除明确终章或硬状态冲突外不提前转换。
3. 达到 `minCheckpoints` 后，任一业务 exitCondition 命中即进入 `nextPhaseId`；条件按 OR 计算。
4. 达到 `maxCheckpoints` 时必须进入 `fallbackPhaseId ?? nextPhaseId`，或由 `resolvesPressureArc` 结束压力弧；不得继续当前强度。
5. `maxCheckpoints` 是防失控安全阀，不是主要转换依据。
6. `resolvesPressureArc=true` 时关闭 PressureArc，但不关闭关联 DirectionArc。
7. 新的独立冲突可以创建新的 PressureArc；禁止仅换标题后重置旧 PressureArc 的高张力计数。

创业示例：

| Phase | LifeIntensity | 默认跨度 | 含义 |
| --- | --- | ---: | --- |
| trigger | high_tension | 3-6个月 | 机会或危机刚出现 |
| response | high_tension | 6-12个月 | 融资、团队、现金流选择产生反馈 |
| growth | normal | 12-24个月 | 产品、收入和组织进入增长调整 |
| operation | stable | 24-60个月 | 稳定经营，PressureArc 退出前台 |

示例策略：

```ts
const venturePhasePolicy: PhaseTransitionPolicy = {
  id: "venture_pressure_v1",
  initialPhaseId: "trigger",
  allowedSignalTypes: ["funding_secured", "funding_failed", "cashflow_stable", "team_formed"],
  phases: [
    {
      id: "trigger",
      lifeIntensity: "high_tension",
      durationMonths: [3, 6],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      nextPhaseId: "response"
    },
    {
      id: "response",
      lifeIntensity: "high_tension",
      durationMonths: [6, 12],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "funding_secured" },
        { type: "world_delta", deltaType: "career_state" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "growth",
      fallbackPhaseId: "growth"
    },
    {
      id: "growth",
      lifeIntensity: "normal",
      durationMonths: [12, 24],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [{ type: "checkpoint_cap", value: 2 }],
      nextPhaseId: "operation"
    },
    {
      id: "operation",
      lifeIntensity: "stable",
      durationMonths: [24, 60],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      resolvesPressureArc: true
    }
  ]
};
```

### 11.10 StoryEpisode 与决策节点

月级时间精度不等于月级用户节点。

```ts
export type NodeMateriality =
  | "transition"
  | "meaningful_update"
  | "decision_checkpoint";

export interface TimelineTransition {
  atAgeInMonths: number;
  materiality: "transition" | "meaningful_update";
  summary: string;
  worldDeltas: WorldDelta[];
}

export interface StoryEpisode {
  id: string;
  directionArcId?: string;
  pressureArcId?: string;
  startAgeInMonths: number;
  endAgeInMonths: number;
  internalTransitions: TimelineTransition[];
  decisionCheckpointId: string;
  summary: string;
}
```

规则：

- `TimelineTransition` 只记录内部过程，不单独展示三个选项。
- 每次模型生成的目标是“下一个 decision checkpoint”，不是“下个月发生的变化”。
- 住院、复查、康复等没有新选择空间的变化应合并进一个 StoryEpisode。
- `SimulationNode` 只代表 `decision_checkpoint`。
- 一个节点正文可以自然总结 Episode 中数月或数年的 internalTransitions。
- `HistoryItem` 只保存用户真正做过选择的 checkpoint；internalTransitions 保存在 NarrativeMeta/StoryEpisode 中。

### 11.11 DecisionGate

```ts
export interface DecisionGateResult {
  isDecisionCheckpoint: boolean;
  distinctActionCount: number;
  changesFutureState: boolean;
  repeatsPreviousDecision: boolean;
  reasonCodes: string[];
}
```

节点可以展示给用户，必须同时满足：

- 至少有两个实质不同且可执行的行动方向。
- 不同选择会改变人物、属性、项目、关系、位置、资源或 PressureArc phase。
- 不是上一节点“继续观察/继续恢复/继续坚持”的同义复读。
- 当前确实需要用户决定，而不是系统可以自然推进的过渡。

判定来源：

- 本地先检查至少两个不同的 `decisionIntent`。
- 至少两个选项的 `expectedWorldDeltaTypes` 或 PressureArc phase 结果必须不同。
- 缺少结构化 decision metadata 时进入 Level 2 语义审查，不能默认通过。
- 与上一 checkpoint 的重复相似度由语义审查返回 `0-1` 分数；超过 NodeDensityPolicy 阈值视为复读。

不满足时：

- 候选内容降为 `internalTransitions`。
- 修复 prompt 必须将这些过程压缩进 Episode，并生成下一个真实 decision checkpoint。
- 不得把非决策更新提交为 HistoryItem 或增加页面关卡数。
- 同一轮最多进行一次 DecisionGate 修复；仍无真实选择则返回可重试错误。

### 11.12 节点密度护栏

默认密度上限：

```ts
export interface NodeDensityPolicy {
  maxCriticalCheckpointsPerPressureArc: 2;
  maxHighOrCriticalCheckpointsPerRolling12Months: 3;
  maxRepeatedDecisionSimilarity: 0.8;
}
```

规则：

- 同一 PressureArc 最多连续展示 2 个 critical checkpoint。
- 任意滚动 12 个月默认最多展示 3 个 high_tension/critical checkpoint。
- 达到上限后，PhaseTransitionPolicy 必须进入 normal/stable/resolution，或把无新选择的变化折叠进 Episode。
- 新的独立重大事件可以突破一次全局密度上限，但必须拥有新的 eventId、PressureArc 和现实因果。
- 不允许旧冲突换标题后绕过密度限制。
- 密度控制不能吞掉真正不同的关键选择；必要时可同岁展示多个 checkpoint，但历史视图应按 StoryEpisode 分组。

用户展示示例：

```text
内部时间：75岁0月住院 → 75岁3月复查 → 75岁6月恢复活动
用户节点：75岁，一段恢复期后，决定是否重新开始研究
```

展示规则：

- 主卡片默认显示整数年龄和“几个月后/几年后”的经过时间，不为 internalTransition 单独创建卡片。
- 同一整数年龄内有多个真实 decision checkpoint 时可以依次展示，但历史面板按 StoryEpisode 分组。
- Episode 摘要负责说明中间变化，不能让用户误以为时间没有推进。
- 最终报告按 Episode 提取关键选择，internalTransitions 只作为背景材料，不占用关键节点名额。

### 11.13 时间跨度要求

当 `elapsedMonths >= 24` 时，prompt 必须要求模型体现至少一项时间变化：

- 工作身份变化。
- 项目进入新阶段。
- 人物年龄或状态变化。
- 家庭结构变化。
- 财务积累或消耗。
- 身体状态或生活节奏变化。

不得只改年龄数字而保持世界静止。

### 11.14 历史输入重构

下一节点 prompt 不应同时无差别输入全部历史正文和最近 5 个节点。

建议输入：

```text
长期硬事实摘要
+ 当前人物状态
+ 当前职业/关系/健康状态
+ 最近 5 个完整节点
+ 更早历史的压缩时间线
```

更早历史用于解释人生，不用于直接证明早年人物仍然活跃。

### 11.15 PressureArc 状态所有权与事务边界

模型输出只能包含事实提案：

```ts
export interface ArcSignalProposal {
  pressureArcId?: string;
  type: string;
  evidence: string;
  confidence: number;
}

export interface NodeOutcomeProposal {
  worldDeltas: WorldDelta[];
  arcSignals: ArcSignalProposal[];
}
```

模型禁止返回或修改：

```text
nextPhaseId
nextPressureArcStatus
foregroundPressureArcId
phaseCheckpointCount
```

校验后产生只读的 accepted outcome：

```ts
export interface AcceptedNodeOutcome {
  worldDeltas: WorldDelta[];
  arcSignals: ArcSignalProposal[];
}
```

唯一状态转换入口：

```ts
export interface PressureArcTransitionInput {
  currentArc?: PressureArcState;
  policy?: PhaseTransitionPolicy;
  selectedDecision: string;
  acceptedOutcome: AcceptedNodeOutcome;
  timelineAdvance: TimelineAdvance;
  densityPolicy: NodeDensityPolicy;
}

export interface PressureArcTransitionDecision {
  action:
    | "start"
    | "stay"
    | "advance"
    | "fallback"
    | "suspend"
    | "resume"
    | "resolve";
  previousPhaseId?: string;
  nextPhaseId?: string;
  nextArcState?: PressureArcState;
  foregroundPressureArcId?: string;
  reasonCodes: string[];
}

function reducePressureArc(
  input: PressureArcTransitionInput
): PressureArcTransitionDecision;
```

`reducePressureArc` 必须是纯函数：

- 不调用模型。
- 不写 React state、history、localStorage 或远端存储。
- 相同输入始终得到相同输出。
- 创建、stay、advance、fallback、suspend、resume、resolve 都经过同一入口。

唯一持久化入口：

```ts
export interface SimulationTransactionInput {
  transactionId: string;
  node: SimulationNode;
  storyEpisode: StoryEpisode;
  acceptedOutcome: AcceptedNodeOutcome;
  pressureArcTransition: PressureArcTransitionDecision;
  nextWorldStateSnapshot: WorldStateSnapshot;
}

function commitSimulationTransaction(
  input: SimulationTransactionInput
): CommittedSimulationState;
```

事务规则：

- Node、Episode、WorldDelta、PressureArc transition 和 WorldStateSnapshot 必须一起提交。
- 任一部分校验失败，全部不提交。
- Repair 后必须重新生成 AcceptedNodeOutcome 和 TransitionDecision，旧 decision 作废。
- 同一 `transactionId` 重复提交必须幂等，不能重复增加 checkpointCount 或重复切 phase。
- 时光回溯恢复的是已提交事务快照，不重新执行旧 transition。

融资示例：

```text
generateNode 提出：funding_secured + 财富变化
Validation 确认：正文、信号和 WorldDelta 一致
reducePressureArc 对照 Policy：response → growth
commitSimulationTransaction：一次提交节点、投资结果和 growth 状态
```

没有任何其他模块可以单独宣布“融资阶段结束”。

## 12. 模型输入规范

### 12.1 Age Context Prompt Block

在“当前属性”之后、“本轮任务”之前插入：

```text
【当前年龄与世界状态】
- 当前时间：{formatAge(previousAgeInMonths)}
- 本轮经过：{formatDuration(elapsedMonths)}
- 目标时间：{formatAge(targetAgeInMonths)}
- 人生强度：{lifeIntensity}
- 人生阶段：{lifeStage}
- 用户当前仍在选择的人生方向：{activeAgencyDirections}
- 长期 DirectionArc：{directionArcs}
- 当前 PressureArc 与阶段：{foregroundPressureArc}
- 本阶段转换条件：{phaseTransitionPolicy}
- 当前可见节点密度预算：{nodeDensityBudget}
- 执行条件与适配方式：{executionAdaptations}
- 当前支持因素：{supportFactors}
- 健康与恢复背景：{healthAndRecoveryContext}

【时间硬约束】
{hardConstraints}

【现实概率备注】
{probabilityNotes}

【正在进行的持续过程】
{ongoingProcesses}

【本轮代码派生的过程变化】
{requiredProcessTransitions}

【结果级现实概率指导】
{outcomePlausibilityGuidance}

注意：概率备注只能改变行动方式、成本和支持条件，不能把用户选择替换为标准年龄剧本。

【已建立的例外事实】
{exceptionalFacts}
```

### 12.2 人物状态输入

```text
【当前人物状态】
- 林雯：伴侣，约 102-106 岁，健康脆弱，当前为低强度参与。
- 母亲：已故，只能通过回忆、遗物或长期影响出现。
- 女儿：约 70-75 岁，异地居住，可远程联系。
```

模型不得把 `unknown` 自动解释为“仍然年轻且活跃”。

### 12.3 生成要求

新增规则：

1. 正文、人物行为和三个选项必须符合目标年龄与时间跨度。
2. 年龄阶段只提供现实边界，不得使用刻板印象替代具体因果。
3. 早年人物不能因为历史里出现过就永久保持原状态。
4. 已故人物只能通过回忆、遗物、纪念或长期影响出现。
5. 高龄角色可以继续工作和创作，但强度、支持系统和参与方式必须有现实依据。
6. 若沿用低概率状态，必须在正文中给出已经建立或自然可见的解释。
7. 三个选项都必须是当前年龄真正能执行的行动。
8. 不得用“年纪大了所以什么都不能做”作为默认冲突。
9. high_tension/critical 节点必须聚焦当前未解决问题，不得一次跳过融资、招人、现金流和转型等多个关键抉择。
10. stable 节点可以跨越多年，但必须总结期间至少一项人物、事业、家庭、健康或生活结构变化。
11. 每个非结局预设选项必须返回 `temporalHint`，描述选择后合理的叙事密度和时间范围。
12. 每个非终章节点至少有一个选项继续推进用户当前的 activeAgencyDirection。
13. 不允许三个选项全部变成降低强度、接受照护、退休、退出或回忆过去。
14. 年龄只能改变选项的执行条件与代价，不能删除用户已经建立的学习、事业、创作、旅行或研究方向。
15. 没有新选择空间的月级变化必须写入 `storyEpisode.internalTransitions`，不能单独生成关卡。
16. 三个选项必须至少包含两个会改变未来状态的实质行动，不得用同义改写凑数。
17. PressureArc 当前 phase 的强度优先于最初 Event temporalProfile；事件标签不能永久锁定 LifeIntensity。
18. 每个预设选项必须返回 `decisionIntent` 和 `expectedWorldDeltaTypes`，用于判断选项是否真正不同。
19. 不得自由填写可由时间派生的孕周、康复月份、学年或合同阶段；必须服从 OngoingProcess 当前状态。
20. `requiredProcessTransitions` 中的完成、中断或阶段变化必须在正文或 `StoryEpisode.internalTransitions` 中体现。
21. `uncommon` 结果可以成立，但要有自然背景；`exceptional` 结果必须返回可验证的 supportingFacts，不能只写“虽然少见但发生了”。
22. 50 岁结婚、晚婚、再婚等不因年龄被否定，也不要求系统补齐完整关系引入链。

## 13. 模型输出规范

### 13.1 SimulationNode 扩展

建议新增不直接展示的结构化元数据：

```ts
export interface NarrativeMeta {
  elapsedMonths: number;
  elapsedYears: number;
  lifeIntensity: LifeIntensity;
  nodeMateriality: "decision_checkpoint";
  storyEpisode: StoryEpisode;
  arcSignals: ArcSignalProposal[];
  recoveryState: RecoveryState;
  recoveryEvidence: string[];
  activeCharacters: Array<{
    personId?: string;
    displayName?: string;
    relation: PersonRelation;
    estimatedAge?: number;
    presenceMode: PersonPresenceMode;
    currentRole?: string;
  }>;
  primaryActivity?: {
    domain: "education" | "career" | "family" | "health" | "community" | "leisure" | "legacy";
    intensity: "low" | "moderate" | "high";
  };
  worldDeltas: WorldDelta[];
}

export interface EventMeta {
  // existing fields
  eventIntensity?: "minor" | "major";
  phasePolicyId?: string;
}

export interface SimulationNode {
  // existing fields
  ageInMonths?: number;
  narrativeMeta?: NarrativeMeta;
  committedArcMeta?: {
    pressureArcId?: string;
    phaseId?: string;
    transitionAction?: PressureArcTransitionDecision["action"];
  };
}
```

### 13.2 WorldDelta

```ts
export type WorldDelta =
  | { type: "person_status"; personId: string; status: PersonLifeStatus; reason: string }
  | { type: "person_role"; personId: string; occupationStatus: PersonState["occupationStatus"] }
  | { type: "relationship_change"; personId: string; summary: string }
  | { type: "process_started"; process: OngoingProcess }
  | { type: "process_completed"; processId: string; completedAtAgeInMonths: number; summary: string }
  | { type: "process_interrupted"; processId: string; interruptedAtAgeInMonths: number; reason: string }
  | { type: "career_state"; summary: string }
  | { type: "health_state"; summary: string }
  | { type: "location_change"; summary: string };
```

V1 可将 `narrativeMeta` 设为可选，逐步启用。结构化 delta 只有通过校验后才能写入下一轮世界状态。

补充规则：

- 新生成节点必须返回 `recoveryState`；旧响应缺失时标准化为 `neutral`。
- `elapsedMonths`、`elapsedYears` 和 `lifeIntensity` 由服务层使用已确定的 TimelineAdvance 覆盖，模型返回值只做兼容。
- 模型只返回 `arcSignals`，不得返回 next phase 或 next PressureArc status。
- `committedArcMeta` 只由 PressureArcStateMachine 和事务层写入，不属于模型响应 schema。
- `protected` 和 `depleted` 必须至少提供一条 `recoveryEvidence`。
- `eventIntensity` 从事件 fingerprint 写入 `EventMeta`，用于后续历史因子计算。
- `storyEpisode.internalTransitions` 可以包含过程性变化，但这些变化不得单独增加关卡数。
- 普通 `SimulationNode.narrativeMeta.nodeMateriality` 必须为 `decision_checkpoint`。
- 旧历史缺少 `eventIntensity` 时，可由已知 `eventId` 查表；仍无法确定则按非 major 处理。
- process delta 只有通过 OngoingProcess reducer 校验后才能写入世界快照；模型不能直接覆盖 `lastUpdatedAtAgeInMonths` 或派生月份。

## 14. 一致性校验

### 14.1 两级校验

#### Level 1：确定性校验

代码必须检查：

- `node.ageInMonths === targetAgeInMonths`。
- `node.age === Math.floor(targetAgeInMonths / 12)`。
- `elapsedMonths === targetAgeInMonths - previousAgeInMonths`。
- `elapsedYears === elapsedMonths / 12`。
- `ageInMonths` 必须严格递增；整数 `age` 允许相同。
- 节点内部保存的 `lifeStage` 必须等于 `deriveLifeStage(node.age)`；展示用 `stage` 必须非空。
- `lifeIntensity` 与使用的 `TemporalProfile` 一致。
- PressureArc phase 对应的 intensity、duration 和 checkpoint 计数合法。
- 达到 phase `maxCheckpoints` 时已经产生 phase transition。
- 滚动 12 个月内可见高张力节点数不超过 NodeDensityPolicy，或具有独立重大事件豁免。
- `NarrativeMeta.nodeMateriality === "decision_checkpoint"`。
- `StoryEpisode.internalTransitions` 的时间落在 Episode 起止范围内。
- 非结局预设选项的 `temporalHint` 必须使用合法枚举、月份范围和 follow-up 标记。
- 非结局预设选项必须包含非空 `decisionIntent` 和合法 `expectedWorldDeltaTypes`。
- 结局节点和普通节点的选项数量正确。
- 达到终局硬条件时 `isEndingNode === true`。
- 已故人物没有以 `active_scene` 或 `remote_contact` 出现。
- 已知人物年龄按经过年数同步推进。
- `NarrativeMeta` 中人物状态变化合法。
- 模型响应不得包含 `nextPhaseId`、`nextPressureArcStatus`、`foregroundPressureArcId` 或 checkpoint 计数修改。
- ArcSignalProposal 必须有正文 evidence，并与 WorldDelta 不冲突。
- ArcSignalProposal.type 必须存在于当前 PhaseTransitionPolicy.allowedSignalTypes。
- Validation 输出 AcceptedNodeOutcome，但不得返回修改后的 PressureArcState。
- active OngoingProcess 已按 `elapsedMonths` 推进，派生月份不得停留在上一节点。
- 达到 `expectedEndAgeInMonths` 的过程已经完成、中断或具有可验证延期依据。
- completed/interrupted process 不得在下一节点恢复为同一 active 状态。

#### Level 2：语义合理性校验

检查正文与选项：

- 社会角色是否存在明确法律、人物时间线或执行条件矛盾；少见角色本身不算问题。
- 人物关系是否符合时间线。
- 行为强度是否与年龄、健康和支持系统一致。
- 项目和关系是否体现了经过时间。
- 三个选项是否可执行。
- 三个选项是否至少包含两个实质不同的未来状态。
- 是否把无选择空间的内部过渡暴露成用户关卡。
- 是否因原始事件标签阻止 PressureArc 强度自然降级。
- 是否把年龄刻板印象当成唯一因果。
- `uncommon` 结果是否有自然历史背景；背景不足产生 warning 或一次修复，不因年龄本身报错。
- `exceptional` 结果是否有明确 supportingFacts；缺失依据时不得提交。

### 14.2 校验结果

```ts
export type StoryConsistencyIssueCode =
  | "age_progression_invalid"
  | "timeline_progression_invalid"
  | "life_intensity_mismatch"
  | "unresolved_arc_skipped"
  | "pressure_arc_phase_stalled"
  | "event_intensity_hijack"
  | "decision_checkpoint_not_material"
  | "node_density_exceeded"
  | "transition_exposed_as_choice"
  | "arc_state_write_violation"
  | "arc_signal_unsupported"
  | "transaction_atomicity_violation"
  | "life_stage_mismatch"
  | "character_timeline_conflict"
  | "deceased_character_active"
  | "activity_age_context_missing"
  | "health_age_context_conflict"
  | "elapsed_time_not_reflected"
  | "ongoing_process_time_frozen"
  | "ongoing_process_end_overrun"
  | "ongoing_process_state_conflict"
  | "outcome_plausibility_context_missing"
  | "exceptional_outcome_unsupported"
  | "choice_age_infeasible"
  | "active_agency_direction_missing"
  | "age_script_funneling"
  | "ending_policy_violation";

export interface StoryConsistencyIssue {
  code: StoryConsistencyIssueCode;
  severity: "warning" | "error";
  message: string;
  evidence?: string;
  retryInstruction?: string;
}
```

### 14.3 重试策略

- 只有 `error` 阻止节点提交。
- `warning` 记录但允许提交，防止过度校验低概率人生。
- “行为少见”本身不能产生 issue；只有具体时间、人物、健康或执行条件冲突才能产生 warning/error。
- 非终章节点缺少任何 activeAgencyDirection 推进选项时，标记 `active_agency_direction_missing:error`。
- 三个选项都把高龄用户导向退休、照护、退出或回忆时，标记 `age_script_funneling:error`。
- PressureArc 达到 phase `maxCheckpoints` 后仍保持原强度，标记 `pressure_arc_phase_stalled:error`。
- PressureArc 已进入 normal/stable phase，但仍因原始事件保持 high_tension，标记 `event_intensity_hijack:error`。
- 选项没有至少两个实质不同未来结果，标记 `decision_checkpoint_not_material:error`。
- 超过节点密度上限且不存在独立重大事件，标记 `node_density_exceeded:error`。
- 复查、恢复、等待等无选择过渡被单独展示为关卡，标记 `transition_exposed_as_choice:error`。
- 模型、Validation、Repair 或 DecisionGate 尝试直接写 Arc 状态，标记 `arc_state_write_violation:error`。
- ArcSignalProposal 缺少叙事证据或与 WorldDelta 冲突，标记 `arc_signal_unsupported:error`。
- Node、Episode、WorldDelta、Arc transition 或快照未能原子提交，标记 `transaction_atomicity_violation:error`。
- 持续过程经过时间后派生阶段未变化，标记 `ongoing_process_time_frozen:error`。
- 已跨过过程预计结束时间但仍无完成、中断或延期依据，标记 `ongoing_process_end_overrun:error`。
- completed/interrupted process 被原样恢复为 active，标记 `ongoing_process_state_conflict:error`。
- `uncommon` 结果缺少自然背景，标记 `outcome_plausibility_context_missing:warning`，允许一次定向修复但不得仅因年龄阻止提交。
- `exceptional` 结果缺少支持事实，标记 `exceptional_outcome_unsupported:error`。
- 字段缺失等结构错误继续使用现有最多 3 次完整生成策略。
- 年龄或人物语义错误只允许 1 次专用修复调用，避免反复改写导致世界漂移。
- 修复 prompt 只改写正文、选项和对应元数据，不改变用户上一选择、目标年龄、已提交属性和世界事实。
- 修复后仍存在 `error`：返回可重试错误，不提交不一致节点。

重试提示必须具体，例如：

```text
人物时间线冲突：主角当前 82 岁，正文把其母亲描述为仍在全职上班，
但历史没有建立极端长寿事实。请将该人物调整为退休、需要照护、间接消息、
回忆或已故影响；不要删除亲情主题。
```

### 14.4 不采用纯关键词封禁

不能简单规定：

```text
age > 80 && description.includes("父母") => reject
```

因为以下内容完全合理：

- “想起已经离世的父亲”。
- “整理母亲留下的信”。
- “父母当年的选择仍影响着你”。

校验必须结合人物状态和出现方式。

### 14.5 Level 2 实现方式

Level 2 采用“结构化本地校验 + 风险门控语义审查”，不要求每个节点固定增加模型调用。

本地校验输入：

```ts
interface StoryConsistencyInput {
  node: SimulationNode;
  ageContext: AgeContext;
  worldState: WorldStateSnapshot;
  eventIntent?: EventIntent;
}
```

以下任一条件成立时进入语义审查：

- `Math.floor(targetAgeInMonths / 12) < 18`。
- `elapsedMonths >= 36`。
- 正文出现父母、祖辈、子女等直系人物，但没有对应高置信度 `PersonState`。
- `primaryActivity.intensity=high`，且健康、恢复或支持条件可能不足。
- 人物估算年龄、职业状态或出现方式产生 warning。
- 本地校验无法判断正文是否与结构化 `NarrativeMeta` 一致。

语义审查只返回 JSON：

```ts
interface StoryConsistencyReview {
  issues: StoryConsistencyIssue[];
}
```

约束：

- 审查模型不得改写剧情。
- 审查 prompt 必须同时输入正文、选项、AgeContext、人物状态和明确例外事实。
- 审查结果只能使用已定义 issue code。
- 年龄较高或行为少见本身不得触发 error。
- 45 岁读书、55 岁创业、70 岁写书、80 岁旅行、90 岁研究必须默认视为可行方向。
- 没有证据的低概率判断只能标记 `warning`。
- 发现硬时间矛盾时标记 `error`，随后进入一次专用修复调用。
- 修复后重新执行 Level 1 和 Level 2；同一节点最多进行一次语义修复。
- 语义审查服务不可用时，Level 1 通过的节点可以降级提交，但必须记录 `semantic_review_skipped` 调试状态；已知硬错误不得降级提交。

## 15. 终局策略

### 15.1 已选方案

当前版本正式采用方案 B“有界长寿”。

产品语义：

- 73 岁不是强制死亡线，而是开始进入终章概率区间。
- 健康良好、恢复机制稳定、近期生活状态平稳的人，可以继续走到 80 岁以上。
- 健康脆弱、持续透支、近期发生严重健康事件时，终章概率提高。
- 终章概率只决定“是否进入人生收束节点”，不机械等同于某种具体死因。
- 110 岁是系统安全上限，防止无限推进。

### 15.2 EndingPolicy

终局策略必须集中配置：

```ts
export interface EndingPolicy {
  mode: "bounded_longevity";
  softEndingAge: number;
  hardMaximumAge: number;
  criticalHealthThreshold: number;
  maximumAnnualProbability: number;
  annualBaseProbabilityByAge: Array<{
    minAge: number;
    maxAge: number;
    probability: number;
  }>;
}

export const DEFAULT_ENDING_POLICY: EndingPolicy = {
  mode: "bounded_longevity",
  softEndingAge: 73,
  hardMaximumAge: 110,
  criticalHealthThreshold: 15,
  maximumAnnualProbability: 0.85,
  annualBaseProbabilityByAge: [
    { minAge: 0, maxAge: 72, probability: 0 },
    { minAge: 73, maxAge: 79, probability: 0.02 },
    { minAge: 80, maxAge: 89, probability: 0.05 },
    { minAge: 90, maxAge: 99, probability: 0.12 },
    { minAge: 100, maxAge: 109, probability: 0.25 },
    { minAge: 110, maxAge: Number.POSITIVE_INFINITY, probability: 1 }
  ]
};
```

这些参数属于集中配置，可通过后续数据评测调整；业务代码和 prompt 禁止重复写死年龄阈值。

### 15.3 终章影响因子

```ts
export type RecoveryState = "protected" | "neutral" | "depleted";
export type HealthTrend = "improving" | "stable" | "declining";

export interface EndingFactors {
  age: number;
  elapsedMonths: number;
  elapsedYears: number;
  currentHealth: number;
  recoveryState: RecoveryState;
  healthTrend: HealthTrend;
  hasRecentMajorHealthEvent: boolean;
  relationSupport: "strong" | "ordinary" | "weak";
}

export interface EndingDecision {
  shouldEnd: boolean;
  forcedByHardMaximum: boolean;
  annualProbability: number;
  nodeProbability: number;
  roll: number;
  factors: EndingFactors;
  reasonCodes: string[];
}
```

因子来源：

- `currentHealth`：候选节点生成后的健康值。
- `healthTrend`：最近 3 个已提交节点的健康变化趋势。
- `recoveryState`：本轮候选节点结构化返回的恢复状态；旧节点缺失时为 `neutral`。
- `hasRecentMajorHealthEvent`：最近 3 个节点存在 `health` 类 major 事件。
- `relationSupport`：候选节点生成后的 `relation` 属性映射的支持网络强度。
- `elapsedMonths`：目标时间与上一节点时间之差。
- `elapsedYears`：`elapsedMonths / 12`，允许小数。

### 15.4 修正系数

#### 健康系数

| 当前 health | multiplier |
| ---: | ---: |
| 75-100 | 0.55 |
| 60-74 | 0.75 |
| 45-59 | 1.00 |
| 30-44 | 1.35 |
| 15-29 | 1.75 |
| 0-14 | 2.40 |

#### 恢复状态系数

| recoveryState | multiplier |
| --- | ---: |
| protected | 0.75 |
| neutral | 1.00 |
| depleted | 1.25 |

`protected` 必须有明确恢复机制，例如稳定睡眠、降低强度、医疗照护、运动恢复或家人支持；不能因为选项文案积极就自动判定。

#### 健康趋势系数

| healthTrend | multiplier |
| --- | ---: |
| improving | 0.85 |
| stable | 1.00 |
| declining | 1.25 |

趋势计算：

```ts
const baselineItem = history[Math.max(0, history.length - 3)];
const healthDelta = candidateNode.attributes.health - baselineItem.attributes.health;

const healthTrend = healthDelta >= 6
  ? "improving"
  : healthDelta <= -6
    ? "declining"
    : "stable";
```

历史不足 3 个节点时使用 `stable`。

#### 近期重大健康事件系数

```text
最近 3 个节点存在 health + major 事件：1.15
否则：1.00
```

#### 支持网络系数

| relation | support | multiplier |
| ---: | --- | ---: |
| 70-100 | strong | 0.90 |
| 30-69 | ordinary | 1.00 |
| 0-29 | weak | 1.10 |

支持网络只做小幅修正，不能抵消硬上限。

### 15.5 概率计算

先使用 `Math.floor(targetAgeInMonths / 12)` 取得目标年龄对应的年度基础概率：

```ts
let adjustedAnnualProbability = clamp(
  baseAnnualProbability
    * healthMultiplier
    * recoveryMultiplier
    * healthTrendMultiplier
    * recentMajorHealthEventMultiplier
    * relationSupportMultiplier,
  0,
  policy.maximumAnnualProbability
);
```

当 `currentHealth < criticalHealthThreshold` 时：

```ts
adjustedAnnualProbability = Math.max(adjustedAnnualProbability, 0.65);
```

这表示健康危急会显著提高终章概率，但在硬上限之前仍不直接写死结局。

再根据本轮跨越年数换算节点概率：

```ts
const nodeProbability = 1 - Math.pow(
  1 - adjustedAnnualProbability,
  Math.max(1 / 12, elapsedMonths / 12)
);
```

critical 节点即使只推进 1 个月，也按实际月份计算，不能强行按 1 整年放大终章概率；stable 节点跨越 5 年时则必须累计 5 年风险。

最终判定：

```ts
const forcedByHardMaximum = targetAgeInMonths >= policy.hardMaximumAge * 12;
const shouldEnd = forcedByHardMaximum || deterministicRoll < nodeProbability;
```

### 15.6 可复现随机

终章判定不能直接调用不可复现的 `Math.random()`。

新增模拟级 `simulationSeed`，终章随机值由以下字段稳定生成：

```text
simulationSeed
+ branchFingerprint
+ targetAgeInMonths
+ nodeIndex
```

其中：

- `simulationSeed` 在开始模拟时创建并保存在模拟状态中。
- `branchFingerprint` 由已提交历史节点 ID 和当前选择文本生成。
- 相同历史、相同选择、相同目标年龄必须得到相同终章判定。
- 时光回溯后选择不同路径，会产生不同 `branchFingerprint`。
- 测试允许注入固定随机函数。

规范化算法：

```ts
const historyIdentity = history.map((item) => item.nodeId || stableHash({
  age: item.age,
  title: item.title,
  selectedChoice: item.selectedChoice
}));

const branchFingerprint = stableHash({
  historyIdentity,
  selectedDecision: selectedDecision.trim(),
  nodeIndex
});
```

- `stableHash` 必须使用固定字段顺序和 UTF-8 编码。
- V1 推荐 SHA-256，截取前 16 字节作为随机输入即可。
- 禁止使用 JavaScript 对象默认字符串化顺序作为哈希合同。

### 15.7 终章判定时机

除硬上限外，终章判定发生在“候选节点生成并通过年龄一致性校验之后、正式提交之前”。

原因：

- 本轮选择造成的新健康值和恢复策略只有候选节点生成后才能确定。
- 不能只根据上一节点状态决定本轮选择的结果。

流程：

1. 选择或延续事件主线，派生 `LifeIntensity`。
2. 计算 `targetAgeInMonths` 和初始 `AgeContext`。
3. 生成普通候选节点，包含更新后的属性和 `recoveryState`。
4. 完成结构与年龄一致性校验。
5. 使用候选节点结果计算 `EndingDecision`。
6. 若 `shouldEnd=false`，提交候选节点。
7. 若 `shouldEnd=true`，候选节点不展示、不提交，调用专用终章 prompt。
8. 终章 prompt 使用候选节点的现实后果作为收束原因，返回一个终章节点。
9. 终章节点通过校验后提交。

当 `targetAgeInMonths >= hardMaximumAge * 12` 时跳过普通候选节点，直接生成终章，避免无意义调用。

### 15.8 终章节点合同

```ts
export interface EndingNode extends SimulationNode {
  isEndingNode: true;
  choices: [{
    id: "ENDING";
    text: "安详落幕，查看一生洞察";
    impactSummary: "一生回望";
  }];
  endingMeta: {
    decision: EndingDecision;
    closingMode: "natural_closure" | "health_closure" | "hard_maximum";
  };
}
```

要求：

- 终章不必描述具体死亡过程。
- 不允许仅因为年龄较大就使用羞辱、衰败或失能叙事。
- 应结合最近选择、关系、事业、健康和长期主线自然收束。
- `isEndingNode` 和唯一选项由服务层覆盖，不能依赖模型返回正确。
- 终章 `ageInMonths` 必须等于 `targetAgeInMonths`，展示年龄由此派生。
- 概率终章的属性使用已通过校验的候选节点属性，终章模型不得再次任意改值。
- 硬上限终章以当前属性为基线，单项变化仍遵守普通属性变化上限。

`closingMode` 由代码决定：

```ts
const closingMode = decision.forcedByHardMaximum
  ? "hard_maximum"
  : decision.factors.currentHealth < policy.criticalHealthThreshold
    ? "health_closure"
    : "natural_closure";
```

### 15.9 回溯年龄规则

采用有界长寿后：

- 回溯起点继续允许 7 到 80 岁。
- 73 到 80 岁的起始节点必须正常生成，不得直接谢幕。
- 起始节点不进行终章抽签，至少保证用户获得第一个可选择节点。
- 从用户完成第一个选择后的下一节点开始应用终章概率。
- 起点年龄不得超过 80 岁；该限制是产品输入范围，不是寿命上限。

## 16. 服务流程改造

### 16.1 generateNextNode

目标流程：

```ts
const previousNode = history.at(-1);
const currentAgeInMonths = previousNode.ageInMonths ?? previousNode.age * 12;
const worldState = rebuildWorldState(history, savedWorldState);
const pressureArc = resolveForegroundPressureArc(worldState);
const selectedChoiceTemporalHint = await resolveChoiceTemporalHint({
  selectedDecision,
  choices: previousNode.choices,
  pressureArc,
  eventMeta: previousNode.eventMeta,
  currentAttributes
});

const event = pressureArc
  ? resolvePressureArcEvent(pressureArc)
  : queryDynamicLifeEvent(
      currentAttributes,
      userData,
      Math.floor(currentAgeInMonths / 12),
      history,
      answers
    );

const workingPressureArc = pressureArc ?? (
  event?.intent.temporalProfile?.requiresFollowUp
    ? initializePressureArc({ event, currentAgeInMonths })
    : undefined
);

const temporalProfile = deriveLifeIntensity({
  pressureArc: workingPressureArc,
  event,
  selectedChoiceTemporalHint,
  attributes: currentAttributes,
  recentHistory: history.slice(-5)
});

const timelineAdvance = calculateTimelineAdvance({
  currentAgeInMonths,
  temporalProfile,
  currentLifeStage: deriveLifeStage(Math.floor(currentAgeInMonths / 12)),
  simulationSeed,
  branchFingerprint,
  endingPolicy,
  knownMilestones: worldState.knownMilestones
});

const processAdvance = advanceOngoingProcesses({
  ongoingProcesses: worldState.ongoingProcesses ?? [],
  previousAgeInMonths: currentAgeInMonths,
  targetAgeInMonths: timelineAdvance.targetAgeInMonths
});

const outcomePlausibilityGuidance = buildOutcomePlausibilityGuidance({
  userData,
  history,
  people: worldState.people,
  ongoingProcesses: processAdvance.nextProcesses,
  targetAgeInMonths: timelineAdvance.targetAgeInMonths
});

const ageContext = buildAgeContext({
  previousAgeInMonths: currentAgeInMonths,
  targetAgeInMonths: timelineAdvance.targetAgeInMonths,
  attributes: currentAttributes,
  history,
  people: worldState.people,
  endingPolicy
});

const prompt = buildNextNodePrompt({
  ...input,
  timelineAdvance,
  temporalProfile,
  ageContext,
  worldState,
  foregroundPressureArc: workingPressureArc,
  eventSeed: event,
  ongoingProcesses: processAdvance.nextProcesses,
  requiredProcessTransitions: processAdvance.requiredTransitions,
  outcomePlausibilityGuidance
});

if (timelineAdvance.targetAgeInMonths >= endingPolicy.hardMaximumAge * 12) {
  const endingNode = await generateAndValidateEndingNode({
    input,
    timelineAdvance,
    ageContext,
    worldState,
    forcedByHardMaximum: true
  });
  return commitSimulationTransaction(buildEndingTransaction({
    endingNode,
    worldState,
    processAdvance,
    forcedByHardMaximum: true
  }));
}

let candidateResult = await generateAndValidateNode(...);
let candidateNode = candidateResult.node;
let acceptedOutcome = candidateResult.acceptedOutcome;
let outcomePlausibilityContext = evaluateOutcomePlausibility({
  candidateNode,
  acceptedOutcome,
  userData,
  history,
  people: worldState.people,
  ongoingProcesses: processAdvance.nextProcesses,
  targetAgeInMonths: timelineAdvance.targetAgeInMonths
});

if (outcomePlausibilityContext.tier === "exceptional"
  && outcomePlausibilityContext.requiresExplicitBasis
  && outcomePlausibilityContext.supportingFacts.length === 0) {
  candidateResult = await repairOutcomePlausibilityOnce(...);
  candidateNode = candidateResult.node;
  acceptedOutcome = candidateResult.acceptedOutcome;
  outcomePlausibilityContext = evaluateOutcomePlausibility(...);
}
const endingDecision = evaluateEnding({
  candidateNode,
  history,
  targetAgeInMonths: timelineAdvance.targetAgeInMonths,
  elapsedMonths: timelineAdvance.elapsedMonths,
  simulationSeed,
  branchFingerprint,
  endingPolicy
});

if (endingDecision.shouldEnd) {
  const endingNode = await generateAndValidateEndingNode({
    input,
    timelineAdvance,
    ageContext,
    worldState,
    candidateOutcome: candidateNode,
    endingDecision
  });
  return commitSimulationTransaction(buildEndingTransaction({
    endingNode,
    worldState,
    processAdvance,
    endingDecision
  }));
}

let decisionGate = evaluateDecisionGate({
  candidateNode,
  previousNode,
  pressureArc: workingPressureArc,
  densityPolicy,
  recentHistory: history.slice(-5)
});

if (!decisionGate.isDecisionCheckpoint) {
  candidateNode = await repairAsDecisionEpisode({
    candidateNode,
    decisionGate,
    timelineAdvance,
    pressureArc: workingPressureArc,
    worldState
  });
  acceptedOutcome = validateNodeOutcomeProposal(candidateNode);
  decisionGate = evaluateDecisionGate(...);
  if (!decisionGate.isDecisionCheckpoint) {
    throw new Error("SIMULATION_DECISION_CHECKPOINT_INVALID");
  }
}

const pressureArcTransition = reducePressureArc({
  currentArc: workingPressureArc,
  policy: resolvePhaseTransitionPolicy(workingPressureArc, event),
  selectedDecision,
  acceptedOutcome,
  timelineAdvance,
  densityPolicy
});

const nextWorldStateSnapshot = applyAcceptedOutcome({
  worldState,
  acceptedOutcome,
  pressureArcTransition,
  processAdvance
});

return commitSimulationTransaction({
  transactionId: buildTransactionId({
    simulationSeed,
    branchFingerprint,
    targetAgeInMonths: timelineAdvance.targetAgeInMonths
  }),
  node: candidateNode,
  storyEpisode: candidateNode.narrativeMeta!.storyEpisode,
  acceptedOutcome,
  pressureArcTransition,
  processAdvance,
  nextWorldStateSnapshot
});
```

服务层职责边界：

- `queryDynamicLifeEvent`：使用当前时间选择事件 intent。
- `initializePressureArc`：只在新 Event 需要 follow-up 时创建首个 phase。
- `resolveChoiceTemporalHint`：读取预设选项 hint，或按需分类自定义选择。
- `deriveLifeIntensity`：根据 PressureArc phase、事件和当前状态确定时间密度。
- `calculateTimelineAdvance`：决定经过月份和目标时间。
- `buildAgeContext`：只派生年龄世界状态。
- `advanceOngoingProcesses`：唯一推进持续过程时间并决定到期完成、中断或延期要求。
- `buildOutcomePlausibilityGuidance`：生成前提供低概率结果的现实条件，不预判尚未生成的具体结果。
- `evaluateOutcomePlausibility`：候选生成后区分 ordinary、uncommon 和 exceptional，不提交世界状态。
- `generateAndValidateNode`：只生成和验收候选节点。
- `validateNodeOutcomeProposal`：接受或拒绝 WorldDelta/ArcSignal proposal，不修改 Arc。
- `evaluateDecisionGate`：判断候选内容是否值得成为用户可见关卡。
- `repairAsDecisionEpisode`：压缩内部过渡并重写为下一个真实决策点。
- `reducePressureArc`：唯一决定 PressureArc 创建、推进、降级、暂停、恢复或结束。
- `evaluateEnding`：纯函数计算终章概率与稳定随机结果。
- `generateAndValidateEndingNode`：只生成终章叙事。
- `commitSimulationTransaction`：唯一原子提交 Node、Episode、WorldDelta、Arc transition 和世界快照。
- process transition 必须与 Node、Episode、WorldDelta 和 Arc transition 一起提交；任一失败则全部回滚。

候选节点若被终章替换，其 `worldDeltas` 和 ArcSignalProposal 不得单独提交；终章事务需要吸收其中与本轮选择相关的合法现实后果。

### 16.2 起始节点

起始节点同样必须构建 `AgeContext`：

- 7 岁起点不能默认生成成年职业选择。
- 60 岁起点不能默认套用毕业或初入职场模板。
- 用户里程碑模板与选择文案必须根据回溯年龄修正。
- 起始节点的 `stage` 应由代码阶段与模型自然标题共同生成。

### 16.3 时光回溯

恢复历史节点时：

- 恢复该节点当时的 `AgeContext` 或根据历史重建。
- 恢复该节点当时的人物状态快照。
- 删除目标节点之后产生的人物和世界 delta。
- 新分支不能继承被撤销未来里的离世、婚姻、子女或职业结果。

## 17. 兼容与迁移

### 17.1 旧历史兼容

旧 `HistoryItem` 没有 `narrativeMeta` 和人物状态。

迁移策略：

1. 保持新增字段可选。
2. 旧节点缺少 `ageInMonths` 时使用 `age * 12`。
3. 从用户事实和最近历史中尽力重建人物状态。
4. 推断结果标记 `source: model_inferred` 和较低 `confidence`。
5. 低置信度冲突只生成 warning，不直接拒绝旧节点。
6. 旧节点没有 StoryEpisode 时，每个历史节点临时映射为一个单 checkpoint Episode，不反向猜测 internalTransitions。
7. 旧事件没有 phase policy 时使用兼容四阶段策略，并从当前节点开始计数。
8. 从启用新版本后的第一个节点开始提交结构化 world delta。

### 17.2 历史异常数据

如果旧存档已经到达终局上限之后：

- 不修改历史展示。
- 下一次推进时应用当前 `EndingPolicy`。
- 生成终章前先基于现有高龄状态构建合理收束，不突然把人物状态重置成年轻阶段。

### 17.3 API 兼容

- `narrativeMeta`、`worldState` 初期均为可选。
- 前端未知字段应忽略。
- E2E mock 需要补充目标年龄和结局规则。
- 旧 AI 响应缺少新字段时进入兼容标准化流程，但不能绕过年龄硬约束。

### 17.4 状态持久化决策

人物和世界状态采用“历史节点可选快照”方案，不只在运行时临时重建：

```ts
export interface WorldStateSnapshot {
  people: PersonState[];
  ongoingProcesses?: OngoingProcess[];
  directionArcs: DirectionArc[];
  pressureArcs: PressureArcState[];
  foregroundPressureArcId?: string;
  knownMilestones?: Array<{
    ageInMonths: number;
    type: string;
    summary: string;
  }>;
  careerSummary?: string;
  relationshipSummary?: string;
  healthSummary?: string;
  locationSummary?: string;
  version: 1;
}

export interface HistoryItem {
  // existing fields
  nodeId?: string;
  ageInMonths?: number;
  lifeStage?: LifeStage;
  narrativeMeta?: NarrativeMeta;
  worldStateSnapshot?: WorldStateSnapshot;
}

export interface SimulationSessionState {
  simulationSeed: string;
  endingPolicyVersion: 1;
}
```

规则：

- 新节点提交时保存 `worldStateSnapshot`。
- 时光回溯直接恢复目标节点快照。
- 旧节点没有快照时，从该节点之前的历史重建，并在下一次提交时补齐新快照。
- 快照属于模拟状态，不直接展示给用户。
- `simulationSeed` 在一次模拟及其时光回溯分支中保持不变。

### 17.5 语义修复调用决策

- 不为每个普通节点固定增加第二次模型调用。
- 本地确定性校验先执行。
- 年龄或人物语义检查出现 `error` 时，允许增加一次专用修复调用。
- 修复调用只改写正文、选项和与其对应的结构化元数据，不得改变目标年龄、用户上一选择和已提交世界事实。
- 终章替换属于终局流程，不计入普通语义修复次数。

## 18. 可观测性

开发环境记录：

```ts
interface AgeConsistencyDebugRecord {
  previousAge: number;
  targetAge: number;
  previousAgeInMonths: number;
  targetAgeInMonths: number;
  elapsedMonths: number;
  lifeIntensity: LifeIntensity;
  lifeStage: LifeStage;
  selectedEventId?: string;
  activePersonStates: PersonState[];
  issues: StoryConsistencyIssue[];
  retryCount: number;
  accepted: boolean;
}
```

建议统计：

- 年龄一致性重试率。
- 各 issue code 出现频率。
- 不同年龄阶段的重试率。
- 不同 LifeIntensity 的节点占比和平均跨度。
- high_tension/critical 主线连续节点数。
- stable 节点实际跨越月份分布。
- PressureArc 各 phase 平均 checkpoint 数和降级成功率。
- `event_intensity_hijack` 出现次数。
- StoryEpisode 平均 internalTransitions 数。
- DecisionGate 拒绝率和修复成功率。
- 滚动 12 个月高张力节点密度超限次数。
- 人物时间线冲突率。
- 因终局策略被修正的节点数。
- OngoingProcess 到期转换成功率和冻结冲突次数。
- ordinary、uncommon、exceptional 结果占比及定向修复成功率。
- 三次重试后失败率。

日志不得包含用户完整敏感叙事，只记录必要摘要或哈希标识。

## 19. 测试策略

### 19.1 AgeContext 单元测试

必须覆盖：

- 7、13、18、25、35、50、65、80 岁边界。
- `targetAgeInMonths - previousAgeInMonths` 和派生 `elapsedYears` 计算。
- 同一整数年龄下多个节点的 `ageInMonths` 严格递增。
- 同年龄不同健康值产生不同健康上下文。
- 70 岁有明确在职历史时保留合理工作模式。
- 70 岁无职业历史时不凭空生成全职高管身份。
- 异常事实能够进入 `exceptionalFacts`。

### 19.2 人物生命周期单元测试

必须覆盖：

- 已知年龄随主角同步增长。
- 未知父母年龄生成宽松估算区间。
- 已故人物只能使用 `memory/legacy`。
- 退休人物不能无解释恢复为普通全职状态。
- 时光回溯撤销未来人物 delta。
- 低置信度推断只产生 warning。

#### 19.2.1 持续过程与结果现实概率测试

必须覆盖：

- active process 的派生月份随 `targetAgeInMonths` 单调增长。
- 妊娠六个月后再推进 9 个月，过程必须 completed、interrupted 或具有明确延期依据。
- 康复、学制和合同过程跨过预计结束时间后不能原样保持 active。
- completed/interrupted process 使用同一 processId 恢复 active 时被拒绝。
- 时光回溯恢复目标节点的 process 快照，不重复执行未来 transition。
- 同一候选结果在不同人物年龄和既往事实下可以得到不同 PlausibilityTier。
- 50 岁结婚有自然关系背景时允许通过。
- 50 岁结婚背景较少时最多产生 warning，不因年龄本身拒绝。
- exceptional 生物结果有 supportingFacts 时允许通过，缺失时产生 error。
- 用户明确选择晚婚时不应用年龄亲和度惩罚。

### 19.3 事件调度测试

必须覆盖：

- 同一事件在不同 `LifeStage` 获得不同渲染 profile。
- 事件查询使用当前年龄，目标时间在事件和主线强度确定后计算。
- null event 仍然接收 AgeContext。
- 超出事件年龄范围时不会退化为无年龄约束的通用故事。
- career、opportunity、financial、growth 事件超过旧 maxAge 后仍可进入候选池。
- 超出 preferredRange 后权重降低但不为 0。
- 用户选择、DirectionArc 或 PressureArc 命中时年龄亲和度乘数为 1。
- 55 岁创业、70 岁写作、80 岁旅行、90 岁研究对应事件均可被调度。
- 只有具备 `basis/reason` 的 hardAgeConstraint 才能硬过滤事件。

### 19.4 时间推进单元测试

必须覆盖：

- critical 返回 1-6 个月。
- high_tension 返回 6-12 个月。
- normal 返回 12-36 个月。
- stable 返回 36-60 个月。
- 青少年阶段最大跨度被截断为 12 个月。
- 30 岁创业 high_tension 不会一次跳过 3 年。
- 60 岁稳定退休允许跨越 3 到 5 年。
- 任意年龄出现 critical 时不会被 LifeStage 放大为多年。
- 相同 seed 和分支得到相同 `elapsedMonths`。
- 重试不会重新抽取时间跨度。
- 已知硬里程碑会截断时间推进。
- 时间推进不会越过 110 岁上限。
- unresolved high_tension arc 优先于新 major 事件。
- PressureArc 当前 phase 优先于原始 Event temporalProfile。
- 旧节点 `age=30` 正确迁移为 `ageInMonths=360`。
- 预设选项优先使用自身 `temporalHint`。
- 自定义选择分类失败时正确回退到 PressureArc phase、事件 profile 或 normal 默认。
- 选择 high_tension 与 stable 事件冲突时采用更高张力和较短时间范围。

### 19.5 Arc、Episode 与 DecisionGate 单元测试

必须覆盖：

- DirectionArc 持续 active 时，关联 PressureArc 可以正常 resolved。
- 创业 trigger/response 为 high_tension，growth 自动降为 normal，operation 自动降为 stable。
- phase 满足业务 exitCondition 时进入 nextPhase。
- phase 达到 maxCheckpoints 时强制进入 fallbackPhase。
- 原始事件为 high_tension，但 growth/operation 不得被重新提升为 high_tension。
- 旧 PressureArc 换标题或事件文案不能重置 checkpoint 计数。
- 新独立事件只有拥有不同 eventId、PressureArc 和现实因果时才能突破密度上限。
- 同一 PressureArc 最多连续展示 2 个 critical checkpoint。
- 滚动 12 个月默认最多展示 3 个 high_tension/critical checkpoint。
- 住院、复查、康复过程合并为一个 StoryEpisode。
- internalTransitions 不增加 HistoryItem 数量和页面关卡数。
- 两个以上实质不同选项通过 DecisionGate。
- “继续恢复/继续观察/继续坚持”同义选项无法通过 DecisionGate。
- DecisionGate 修复后仍无真实选择时不得提交节点。
- 同岁存在多个真实 checkpoint 时按 StoryEpisode 分组，但选择历史完整保留。
- 模型返回 `nextPhaseId=growth` 时被拒绝，不能直接修改 PressureArc。
- Validation 和 Repair 的返回类型不包含可提交 PressureArcState。
- 相同 PressureArcTransitionInput 多次执行得到相同 TransitionDecision。
- `funding_secured` 信号只让 response → growth 执行一次。
- ArcSignalProposal 缺少 evidence 或与财富 WorldDelta 冲突时不得进入 reducer。
- Repair 后旧 AcceptedNodeOutcome 和旧 TransitionDecision 必须失效。
- 相同 transactionId 重复提交不会重复增加 checkpointCount。
- 事务中任一快照写入失败时，Node、Episode、WorldDelta 和 Arc transition 全部回滚。
- 时光回溯恢复事务快照时不会重新执行旧 transition。

### 19.6 响应校验测试

以下结果必须拒绝并重试：

- 16 岁无背景成为企业正式高管。
- 55 岁仍被描述为刚高中毕业，历史没有再教育说明。
- 82 岁人物的已故母亲打电话安排其工作。
- 104 岁主角的外婆以普通高龄老人状态每天来访。
- 已经过了 10 年，正文仍说项目“第二个月刚开始”。
- `EndingDecision.shouldEnd=true` 或达到 110 岁硬上限，但最终仍返回三个普通选项。
- 52 岁 9 个月时已怀孕六个月，经过 9 个月后仍描述为怀孕六个月。
- 已跨过妊娠、康复、学制或合同的预计结束时间，正文仍原样保持 active 且没有延期依据。
- completed/interrupted process 在下一节点以同一 processId 恢复为 active。

以下结果必须允许：

- 40 岁明确选择重新读大学。
- 68 岁基于长期职业积累接受返聘。
- 75 岁在健康良好、有团队支持的前提下继续经营小型项目。
- 90 岁以低强度方式整理研究资料并与年轻合作者写论文。
- 82 岁回忆父母当年的反对。
- 高龄健康保持稳定，但正文体现了照护和恢复机制。
- 45 岁重新读书并以学习为主线。
- 55 岁创办新项目并继续融资、招人和调整现金流。
- 70 岁写书并推进出版选择。
- 80 岁根据体力和支持条件安排真实旅行。
- 90 岁继续研究、合作和发表。
- 50 岁结婚或再婚，正文与既往关系背景自然衔接。
- 用户明确选择晚婚，即使超出一般关系事件 preferredRange 也继续推进。
- 低概率生物过程具有明确人物年龄、健康、医疗或其他 supportingFacts。

以下结果必须产生 warning 或定向补充，不得仅因年龄拒绝：

- 50 岁出现首次婚姻，但最近历史对关系背景交代较少。
- 晚婚、较大年龄差伴侣或较晚育儿具有部分背景但仍需明确执行条件。

以下结果必须因人生流水线倾向被拒绝：

- 55 岁选择创业，下一节点却无因改成退休准备。
- 80 岁选择旅行，三个选项全部要求居家、接受照护或回忆过去。
- 90 岁研究主线仍活跃，正文却只允许向年轻人讲述往事。
- 非终章节点没有任何选项推进 activeAgencyDirection。
- 创业已经进入稳定经营 phase，仍连续返回 high_tension 节点。
- 75 岁恢复期被拆成住院、复查、康复三个没有新选择的月级关卡。
- 三个选项只是“继续恢复”“继续观察”“继续休息”的同义变化。

### 19.7 Prompt 回归测试

必须断言 prompt 包含：

- 目标年龄和时间跨度。
- 当前时间、目标时间、elapsedMonths 和 LifeIntensity。
- 标准人生阶段。
- 硬约束和软指导的明确区分。
- 当前人物状态。
- 已故人物出现方式规则。
- 高龄工作不是绝对禁止。
- 三个选项必须适龄。
- “年龄约束执行条件，不约束人生愿望”。
- 当前 activeAgencyDirection 及至少一个推进该方向的选项。
- 禁止三个选项共同导向退休、照护、退出或回忆。
- 当前 PressureArc phase、phase transition 条件和对应 LifeIntensity。
- 要求把无新选择的过程写入 StoryEpisode.internalTransitions。
- 只有 decision_checkpoint 可以成为 SimulationNode。

语义审查门控必须覆盖：

- 年龄达到 65、80 或 90 岁本身不触发语义审查。
- 18 岁以下自动进入语义审查。
- `elapsedMonths >= 36` 时自动进入语义审查。
- 直系人物缺少高置信度状态时自动进入语义审查。
- 高强度行为与健康或支持条件可能冲突时进入语义审查。
- 审查返回 warning 时允许提交。
- 审查返回 error 时只允许一次修复，修复失败不得提交。

### 19.8 端到端场景

至少建立以下固定场景：

1. 18 岁高考回溯，推进到 30 岁，家庭控制逐步转为成年边界。
2. 25 岁职业回溯，推进到 55 岁，职业从入行转为经验迁移。
3. 35 岁关系回溯，推进到 70 岁，伴侣和父母状态随时间变化。
4. 60 岁重新开始，第一节点直接使用成熟阶段语义。
5. 旧存档恢复到 80 岁以上，能够合理收束且不生成静止人物。
6. 明确长寿事实场景，系统允许低概率但已建立的状态。
7. 30 岁创业主线依次经历融资、招人、现金流和转型，不被单个 3 年节点跳过。
8. 60 岁进入稳定退休生活，可跨 3 到 5 年推进，同时人物和健康状态发生合理变化。
9. 同一创业方向分别从 30、55、70 岁开始，目标保持创业，仅执行方式和代价发生变化。
10. 45 岁读书、70 岁写书、80 岁旅行、90 岁研究均能连续推进至少 3 个非终章节点。
11. 创业持续 10 年时，融资 PressureArc 从 high_tension 降为 normal/stable，创业 DirectionArc 继续存在。
12. 75 岁半年恢复过程只展示一个真正需要选择的节点，内部保留住院、复查和康复变化。
13. 52 岁 9 个月出现已怀孕六个月的过程，下一节点跨越 9 个月时必须完成或中断，并将无选择变化折叠进 Episode。
14. 50 岁结婚场景可以正常推进；有自然背景时直接通过，背景较少时最多触发 warning 或一次定向补充，不得硬拒绝。

### 19.9 有界长寿单元测试

必须覆盖：

- 72 岁年度基础终章概率为 0。
- 73、80、90、100、110 岁命中正确概率档位。
- 110 岁无条件进入终章。
- 80 岁起始节点不抽签、不直接结束。
- 相同 seed、分支、年龄和节点索引产生相同 roll。
- 时光回溯后选择相同路径产生相同结果。
- 时光回溯后选择不同路径产生不同 branch fingerprint。
- 跨越 1 个月、6 个月、1 年和 5 年时正确换算节点概率。
- 健康良好、恢复充分会降低概率，但不能突破硬上限。
- 健康低于 15 时年度概率至少为 0.65。
- 历史不足 3 个节点时健康趋势为 `stable`。
- 被终章替换的候选节点不会提交 world delta。
- 专用终章节点年龄正确且只有唯一报告选项。

概率计算使用固定输入断言精确数值，浮点比较误差不超过 `1e-9`。

### 19.10 有界长寿统计测试

使用固定的 10,000 个 seed 进行离线统计测试：

- 各年龄档实际终章比例应落在理论概率的允许误差范围内。
- 健康和恢复修正应保持单调性。
- 任何 seed 都不得越过 110 岁继续生成普通节点。
- 测试只验证算法分布，不调用真实模型。

## 20. 验收标准

功能验收必须同时满足：

1. 每个新节点都有代码派生的 `targetAgeInMonths`、`LifeIntensity` 和 `AgeContext`。
2. `stage` 不再完全由模型自由决定。
3. 事件调度使用当前时间，生成使用由事件强度派生的目标时间，不再循环依赖。
4. 最近历史中的人物不会被无条件永久续写。
5. 已故人物不能作为现实行动者出现。
6. 经过多年后，剧情至少体现一项世界变化。
7. 三个选项都通过年龄可行性检查。
8. 高龄工作、学习和创作不会被一刀切禁止。
9. 明显年龄冲突触发带原因的重试。
10. 终局规则由代码执行，不依赖模型自觉。
11. 时光回溯正确恢复人物和世界状态。
12. 现有非年龄相关测试继续通过。
13. 73 岁后按有界长寿概率推进，不再强制立即结束。
14. 80 岁回溯起点至少生成一个可选择节点。
15. 110 岁不得继续生成普通节点。
16. 相同分支的终章判定可复现。
17. 终章替换前的候选节点不得污染历史和世界状态。
18. critical/high_tension 节点使用月级短跨度，不得跳过连续关键抉择。
19. stable 节点允许跨 3 到 5 年，但必须体现期间的世界变化。
20. `ageInMonths` 是唯一时间真值，整数 `age` 只用于兼容和展示。
21. 事业、学习、创业、创作、旅行和研究事件不得仅因高龄从候选池消失。
22. 用户选择、DirectionArc 和 PressureArc 必须优先于 LifeStage 默认。
23. 每个非终章节点至少有一个选项推进 activeAgencyDirection。
24. 年龄较高或人生路径少见本身不得成为语义错误。
25. Event 只初始化 PressureArc，不能永久锁定 LifeIntensity。
26. 每个 PressureArc 必须按 PhaseTransitionPolicy 降级、解决或转化。
27. SimulationNode 只能表示 decision checkpoint；普通时间变化必须折叠进 StoryEpisode。
28. 同一 PressureArc 最多连续展示 2 个 critical checkpoint。
29. 滚动 12 个月默认最多展示 3 个 high_tension/critical checkpoint。
30. 只有 `reducePressureArc` 可以产生 PressureArcTransitionDecision。
31. 模型、Validation、Repair 和 DecisionGate 只能 proposal/check，不能修改 Arc 状态。
32. Node、Episode、WorldDelta、Arc transition 和 WorldStateSnapshot 必须原子提交。
33. 所有 active OngoingProcess 必须按实际经过月份推进，不能由模型冻结时间。
34. 跨过预计结束时间的过程必须完成、中断或具有可验证延期依据。
35. 50 岁结婚等少见关系结果不得仅因年龄判错；uncommon 与 exceptional 必须分层处理。
36. exceptional 结果必须有明确 supportingFacts，确定性时间矛盾不得降级为 warning。

质量验收建议：

- 固定回归集中的硬时间矛盾通过率达到 100%。
- 年龄语义人工抽检通过率达到 95% 以上。
- 年龄一致性重试后失败率低于 1%。
- 低风险且通过首次校验的普通节点保持 1 次模型调用。
- 自定义选择缺少 temporal hint 时允许增加 1 次轻量分类调用。
- 高风险普通节点最多增加 1 次只读语义审查调用。
- 语义审查发现 error 时最多再增加 1 次修复调用。
- DecisionGate 失败时最多增加 1 次 Episode 压缩修复调用，禁止隐藏循环生成多个月级节点。
- 概率终章节点最多使用 1 次候选生成和 1 次终章生成。
- 110 岁硬上限节点直接生成终章，不生成普通候选。
- 反流水线固定回归集通过率达到 100%。
- 用户已强化主线在非终章节点中的保留率达到 100%。
- 不得出现某一事件 domain 仅因超过 preferredRange 而候选数归零。
- PressureArc 达到 phase 上限后的降级/转换成功率达到 100%。
- 非决策过渡被提交为 HistoryItem 的数量必须为 0。
- DecisionGate 固定同义选项回归集拦截率达到 100%。
- Arc 单写者违规固定回归集拦截率达到 100%。
- 重复 transactionId 导致的重复 phase 转换数量必须为 0。
- 事务失败后的部分状态提交数量必须为 0。

## 21. 分阶段实施

### Phase 1：统一年龄上下文与硬约束

范围：

- 新增 `LifeStage`、`AgeContext`、`EndingPolicy`。
- 新增 `TimelinePosition`、`LifeIntensity`、`TemporalProfile`、`DirectionArc`、`PressureArcState` 和 `PhaseTransitionPolicy`。
- 新增 `StoryEpisode`、`DecisionGate` 和 `NodeDensityPolicy`。
- 新增 `PressureArcStateMachine` 单写者和 `SimulationTransaction` 原子提交边界。
- 服务层根据事件/主线强度确定 `elapsedMonths` 和 `targetAgeInMonths`。
- prompt 注入年龄阶段、时间跨度和适龄规则。
- 新增 `simulationSeed`、稳定分支指纹和可复现随机。
- 实现有界长寿概率、修正系数和 110 岁硬上限。
- 新增专用终章生成 prompt。
- 73 到 80 岁回溯起点保持可用，起始节点不抽签。
- 新增 `AgeAffinity` 和 `HardAgeConstraint`，移除通用事件的硬 maxAge 过滤。
- prompt 和选项校验加入 activeAgencyDirection 与反流水线规则。
- 增加年龄 progression、stage、ending 测试。

价值：

- 年龄开始真正约束剧情。
- 解决年龄任意推进和终局失效。
- 为后续人物生命周期提供统一基础。

### Phase 2：人物生命周期

范围：

- 新增 `PersonState` 和 `PersonPresenceMode`。
- 从用户事实、回答和最近历史提取主要人物。
- 人物年龄随时间推进。
- 在历史节点保存可选 `WorldStateSnapshot`。
- 关系副线加入人物状态权重。
- 已故、退休、疏远等状态进入 prompt 和校验。
- 支持旧历史低置信度重建。
- 新增轻量 `OngoingProcess`，在确定目标月份后由 reducer 推进跨月状态。
- 将无新选择的过程完成、中断或阶段变化折叠进 StoryEpisode。

价值：

- 根治人物跨几十年保持静止的问题。
- 关系延续从“复读人物”升级为“延续关系影响”。

### Phase 3：事件适龄渲染

范围：

- 为主要事件 category 增加年龄 profile。
- age profile 只调整执行条件，不改变事件 domain 或人生目标。
- null event 优先延续用户选择和 activeAgencyDirection，不按年龄分配生活方向。
- 选项适龄性进入语义校验。
- 时间跨度影响事件和行为强度。

价值：

- 同一人生目标在不同阶段具有不同执行条件，但目标本身保持开放。
- 防止青年模板贯穿一生，也防止高龄节点退化为养老模板。

### Phase 4：结构化世界 delta 与语义审查

范围：

- 启用 `NarrativeMeta` 和 `WorldDelta`。
- 状态变化通过结构化字段提交。
- 对复杂语义冲突增加专用审查或修复调用。
- 建立调试指标和固定评测集。
- 增加 process_started/process_completed/process_interrupted delta。
- 增加结果级 PlausibilityTier，并在候选生成后评估具体结果。

价值：

- 长人生分支具有可持续、可恢复、可解释的世界状态。
- 为更长寿命、更复杂家庭结构和跨代故事打基础。

## 22. 建议代码落点

新增：

```text
src/utils/ageContext.ts
src/utils/ageContext.test.ts
src/utils/timelineAdvance.ts
src/utils/timelineAdvance.test.ts
src/utils/arcLifecycle.ts
src/utils/arcLifecycle.test.ts
src/utils/pressureArcStateMachine.ts
src/utils/pressureArcStateMachine.test.ts
src/utils/decisionGate.ts
src/utils/decisionGate.test.ts
src/utils/simulationTransaction.ts
src/utils/simulationTransaction.test.ts
src/utils/personTimeline.ts
src/utils/personTimeline.test.ts
src/utils/ongoingProcess.ts
src/utils/ongoingProcess.test.ts
src/utils/outcomePlausibility.ts
src/utils/outcomePlausibility.test.ts
src/utils/storyConsistency.ts
src/utils/storyConsistency.test.ts
src/config/endingPolicy.ts
src/utils/endingDecision.ts
src/utils/endingDecision.test.ts
```

修改：

```text
src/types.ts
src/data/lifeEvents.ts
src/services/simulation/prompts.ts
src/services/simulation/simulationService.ts
src/services/simulation/prompts.test.ts
src/utils/eventPrompt.ts
src/utils/storyContext.ts
src/utils/simulationResponse.ts
src/utils/simulationNodeRetry.ts
src/components/InitialSetup.tsx
src/components/SimulationEngine.tsx
src/components/DestinyReport.tsx
src/utils/historyRestore.ts
```

## 23. 风险与控制

### 23.1 最大产品风险：人生模拟退化为养老模拟

风险：系统把统计倾向变成绝对人生模板，使年龄取代用户选择成为剧情内容分配器。

失败表现：

```text
20 岁只能学习
30 岁只能工作
40 岁只能家庭
60 岁只能退休
80 岁只能回忆
```

控制：

- 硬约束只处理时间和已知状态矛盾。
- LifeStage 不得选择事件 domain。
- 通用事件使用 AgeAffinity，不使用硬 maxAge。
- 用户选择、DirectionArc 和 PressureArc 优先于年龄亲和度。
- 工作、学习、创业、创作、旅行、研究、婚育和健康采用执行适配，不采用人生目标禁令。
- 明确历史事实可以覆盖软指导。
- 每个非终章节点至少保留一个推进 activeAgencyDirection 的选项。
- 测试必须包含 45 岁读书、55 岁创业、70 岁写书、80 岁旅行和 90 岁研究。

### 23.2 Prompt 过长

风险：人物状态和完整历史一起输入导致上下文膨胀。

控制：

- 全历史改为压缩时间线。
- 只输入活跃人物和高权重事实。
- 最近 5 个节点保留完整信息。
- 已失活副线只保留摘要。

### 23.3 误判低概率人生

风险：校验器拒绝真实但少见的人生。

控制：

- 区分 warning 和 error。
- 低置信度人物年龄只能触发 warning。
- 已建立例外事实进入 `exceptionalFacts`。
- 不使用单一关键词直接拒绝。
- 年龄高或行为少见本身不产生 warning/error。
- 审查必须指出具体的时间、人物、健康或资源矛盾，不能只写“不符合该年龄阶段”。
- 50 岁结婚、晚婚和再婚不得自动升级为 error，也不触发关系机会配额或完整引入链要求。
- `uncommon` 默认只要求自然背景；只有 `exceptional` 且缺少明确依据时才阻止提交。
- 结果概率必须在候选内容生成后判断，禁止仅凭事件 category 或主角年龄提前判错。

### 23.4 模型调用成本

风险：每轮独立语义审查增加延迟和成本。

控制：

- 确定性规则先行。
- 默认在同一个生成 prompt 中要求结构化元数据。
- 只有高风险节点调用只读语义审查。
- 只有语义审查返回 error 时调用一次语义修复。
- 记录重试率后再决定是否全量启用审查模型。

### 23.5 世界状态错误累积

风险：一次错误人物推断被后续永久继承。

控制：

- 区分用户事实和模型推断。
- 模型推断默认低置信度。
- 重要状态变化需要结构化 delta 和校验。
- 时光回溯按节点重建，不直接复用未来状态。

### 23.6 Event 强度绑架长期人生

风险：创业、疾病、关系等 Event 的初始 high_tension 永久覆盖长期方向，使人生持续处于高潮。

控制：

- Event 只创建 PressureArc，不直接控制长期 DirectionArc。
- LifeIntensity 读取当前 PressureArc phase，不读取最初事件标签。
- PhaseTransitionPolicy 通过现实结果自然降级。
- maxCheckpoints 只作为安全阀，达到后强制 fallback。
- PressureArc resolved 后，DirectionArc 可以继续 normal/stable 发展。

### 23.7 月级时间导致节点碎片化

风险：内部时间精度被错误翻译成用户节点密度，产生连续数月的低价值选择卡。

控制：

- 月份是内部时间真值，不是页面关卡单位。
- SimulationNode 只代表 decision checkpoint。
- 过程变化写入 StoryEpisode.internalTransitions。
- DecisionGate 拒绝同义选项和无未来分歧的关卡。
- NodeDensityPolicy 限制滚动时间窗内的高张力节点数量。
- 历史视图按 Episode 分组，同岁真实关键选择仍可完整保留。

### 23.8 Arc 多写者导致状态重复推进

风险：generateNode、Validation、Repair、phase evaluator 和提交层都能修改 Arc，导致跳 phase、重复降级、故事与状态不一致或回溯重复执行。

控制：

- PressureArcStateMachine 是唯一 transition 决策者。
- PhaseTransitionPolicy 仅提供声明式数据。
- 模型只返回 ArcSignalProposal。
- Validation 只产生 AcceptedNodeOutcome。
- Repair 会使旧 proposal 和 transition decision 失效。
- SimulationTransaction 是唯一持久化入口并要求 transactionId 幂等。
- Node、Episode、WorldDelta、Arc transition 和快照原子提交或全部回滚。

## 24. 已确定实施决策

以下事项不再作为开发阻塞项：

1. 终局采用方案 B“有界长寿”。
2. 73 岁开始出现终章概率，110 岁为绝对上限。
3. 回溯起点继续允许 7 到 80 岁，起始节点不进行终章抽签。
4. 健康、恢复、近期健康趋势、重大健康事件和关系支持共同修正终章概率。
5. 终章判定采用稳定 seed，可被测试和时光回溯复现。
6. 允许在本地语义校验失败后增加一次按需修复调用，不对所有节点固定增加调用。
7. 人物和世界状态随历史节点保存可选快照，旧历史按需重建。
8. 长寿阶段不新增事件 category，继续使用现有 category + `ageProfiles`。
9. UI 可继续显示模型生成的自然阶段文案，但内部必须同时保存标准 `LifeStage`。
10. 终章节点的 `isEndingNode`、年龄和唯一选项由服务层强制覆盖。
11. 时间推进采用月级真值 `ageInMonths`，整数 `age` 仅用于兼容和展示。
12. 时间跨度由事件/未解决主线的 `LifeIntensity` 主导，LifeStage 修正，年龄负责硬边界。
13. 事件使用当前年龄调度，目标时间在事件和时间强度确定后计算。
14. high_tension/critical 主线必须分节点推进，stable 阶段允许跨 3 到 5 年。
15. 年龄约束执行条件，不约束人生愿望。
16. 通用事件的旧 minAge/maxAge 迁移为 AgeAffinity，只有有依据的 HardAgeConstraint 可以硬过滤。
17. 用户选择、DirectionArc 或 PressureArc 命中时不应用年龄亲和度惩罚。
18. 非终章节点必须保留 activeAgencyDirection，禁止三个选项共同导向养老或收束。
19. 长期人生方向使用 DirectionArc，阶段性压力使用 PressureArc，Event 只负责触发压力。
20. LifeIntensity 由 PressureArc 当前 phase 决定，并通过 PhaseTransitionPolicy 自然降级。
21. 月级内部变化通过 StoryEpisode 压缩，只有 decision checkpoint 能成为 SimulationNode。
22. DecisionGate 和 NodeDensityPolicy 共同防止重复选择与时间碎片化。
23. PressureArcStateMachine 是 Arc transition 唯一决策者，其他模块只能 propose 或 validate。
24. SimulationTransaction 是 Node、Episode、WorldDelta、Arc transition 和世界快照的唯一原子提交入口。
25. 跨月持续状态使用 OngoingProcess；模型可提出过程，只有 OngoingProcess reducer 拥有过程时钟和到期状态决定权。
26. AgeAffinity 只控制事件默认权重，具体结果另分 ordinary、uncommon、exceptional 三档。
27. 50 岁结婚等少见关系结果允许成立，不新增关系机会配额，也不强制展示完整关系引入链。
28. 持续过程冻结和到期未结束属于确定性 error；uncommon 结果背景不足默认是 warning，exceptional 缺少依据才是 error。

## 25. 开发就绪评审

### 25.1 结论

本 spec 已具备进入开发的条件，状态为：

```text
READY FOR IMPLEMENTATION
```

开发所需的核心合同已经明确：

- 产品行为和寿命边界。
- 年龄阶段和上下文输入。
- 人物状态与快照策略。
- 事件系统接入方式。
- 年龄亲和度、硬年龄约束和反流水线主体性规则。
- DirectionArc/PressureArc 所有权、阶段转换和强度降级策略。
- StoryEpisode、DecisionGate 和用户可见节点密度合同。
- PressureArc 单写者、proposal/accepted outcome 和原子事务合同。
- 下一时间位置和叙事节奏所有权。
- 终章概率、修正系数和随机算法。
- 终章判定时机。
- 普通节点与终章节点生成流程。
- 一致性问题码和重试策略。
- 旧历史兼容和时光回溯规则。
- 测试、验收和分阶段实施范围。

### 25.2 开发顺序

开发必须按以下顺序进行，避免人物系统和 prompt 同时大改导致难以定位回归：

1. Phase 1A：`EndingPolicy`、`simulationSeed`、`LifeIntensity`、`calculateTimelineAdvance`、`EndingDecision` 纯函数与测试。
2. Phase 1B：`AgeContext`、标准 `LifeStage`、prompt 注入与终章专用 prompt。
3. Phase 1C：服务流程接入、候选节点提交边界、起始节点和时光回溯兼容。
4. Phase 1D：事件年龄亲和度迁移、activeAgencyDirection 和反流水线校验。
5. Phase 1E：DirectionArc/PressureArc、单写者状态机、原子事务、阶段降级、StoryEpisode、DecisionGate 和节点密度。
6. Phase 2A：`PersonState` 提取、年龄推进和出现方式。
7. Phase 2B：`WorldStateSnapshot` 保存与恢复。
8. Phase 3：事件 age profile、null event 主体性延续、选项语义校验。
9. Phase 4：结构化 delta、按需语义修复和可观测性。

### 25.3 第一批开发完成定义

第一批可合并版本至少包含 Phase 1A 到 Phase 1E，并满足：

- 73 岁不再被固定结束。
- 80 岁起始节点可正常选择。
- 110 岁强制终章。
- 事件使用当前时间调度，prompt 使用确定后的 `targetAgeInMonths`。
- high_tension 创业等场景按月推进，stable 退休等场景可跨多年。
- 通用事业、机会、成长事件不再因旧 maxAge 从候选池消失。
- 非终章节点至少保留一个推进用户当前方向的选项。
- Event 强度不会越过 PressureArc phase 永久控制 LifeIntensity。
- 月级内部变化不会被拆成没有新选择的用户关卡。
- Arc phase 不存在任何绕过 PressureArcStateMachine 的写入路径。
- 节点与 Arc 状态不存在部分提交。
- 终章概率可复现且有完整单元测试。
- 候选节点被终章替换时不会污染历史。
- 所有现有测试继续通过。

人物生命周期属于解决故事年龄关系的必要部分，应紧随第一批实现，不应长期停留在仅有终章概率的状态。

### 25.4 非阻塞调优项

以下内容可以在真实数据验证后调整，不阻塞开发：

- 各年龄档年度基础概率的具体数值。
- 人物未知年龄的默认估算区间。
- 语义 warning 的阈值。
- 各事件 category 的 age profile 文案。
- 人工抽检样本量和上线灰度比例。

这些调优必须通过集中配置或测试夹具完成，不能散落修改业务判断。

## 26. 最终定义

本 spec 完成后的年龄感知应满足：

```text
模型不只是知道主角几岁，
而是知道经过了多少年、人物发生了什么变化、
当前有哪些现实角色和行动方式、哪些旧关系只能以记忆或影响存在，
哪些高张力时刻需要让用户连续参与、哪些稳定岁月可以自然跨越，
并且系统能够拒绝与这些世界状态和时间节奏冲突的故事。
```
