# 主角用户画像与内部画像：可直接开发 Spec

## 1. 文档状态

- 状态：待开发
- 规格决策日期：2026-07-17
- 目标版本：分四个 Phase 增量上线
- 用户交付：一张只展示六项内容、可编辑的“主角画像”
- 内部交付：结构化主角档案、权威状态引用、来源与确认机制、摘要聚合器、编辑命令和事件事实读取接口
- 当前基线：`WorldStateSnapshot.version=1`，已包含 `people`、`directionArcs`、`pressureArcs` 和职业/关系/健康/地点摘要；精确财务继续由节点上的 `FinancialState` 管理
- 兼容原则：不替换 `FinancialState`、`PersonState`、`DirectionArc`、`PressureArcState`；旧历史缺失画像时必须可读取和回溯
- 财务架构更新：`2026-07-18-authoritative-financial-ledger-architecture-spec.md` 定义 `FinancialLedger.version=2` 后，本 Spec 中涉及 `FinancialSignals`、`FinancialChange` 和可写 `FinancialState` 的旧边界以该文档为准；`CareerState` 单写就业身份，`FinancialState` 仅作为账本派生兼容快照

## 2. 背景与问题定义

当前系统能够持续保存五维属性、财务快照、部分人物状态、DirectionArc、PressureArc 和最近历史，但没有一份同时满足以下要求的主角档案：

1. 用户可以快速看到“这个人现在是谁”。
2. 用户可以直接更正家庭背景、兴趣、价值和人生方向。
3. 用户可以修改城市、职业、婚姻、债务等客观状态，并同步到真正的权威数据源。
4. 模拟产生的确定结果能够更新主角当前状态。
5. 系统观察到的价值变化可以被提出，但不能被一次选择写死。
6. 事件系统可以读取结构化、分级可靠的事实，而不是从六段自然语言中猜测。
7. 历史回溯能够恢复当时的主角画像和权威状态。

本 Spec 将“画像”拆成三个层次：

```text
权威状态与用户主权事实
        ↓
内部结构化 ProtagonistProfile
        ↓
面向用户的六字段 ProtagonistProfileSummary
```

六字段摘要是可重建的展示缓存，不是事实真值，也不能作为事件硬条件。

## 3. 核心设计决策

### 3.1 一个产品入口，多个权威数据源

用户只看到一张完整画像，但底层保持单写者边界：

| 信息 | 权威来源 | 画像中的形态 |
|---|---|---|
| 家庭背景、自我描述 | `ProtagonistProfile.background/selfDescription` | 用户主权事实 |
| 当前城市、居住状态 | `WorldStateSnapshot.locationStates/currentLocationStateId` | 结构化引用 |
| 就业、职业、行业 | `WorldStateSnapshot.careerStates/currentCareerStateId` | 结构化引用 |
| 伴侣、子女、重要关系 | `PersonState + RelationshipState` | relationship 引用 |
| 金额、收入、债务、净资产 | `FinancialLedger`；当前节点 `FinancialState` 为派生快照 | 逻辑引用，不复制金额 |
| 持续健康限制 | `HealthConditionState` | health condition 引用 |
| 当前方向 | `DirectionArc` | directionArcId 引用 |
| 当前压力 | `PressureArcState` | 不进入画像真值，只可影响摘要语境 |
| 兴趣、价值 | `ProtagonistProfile.interests/values` | 用户主权事实或已确认观察 |
| 系统推断 | `ProtagonistProfile.observations` | 与正式事实分区保存 |

### 3.2 六段文案不反向驱动系统

以下行为一律禁止：

- 从 `generatedSummary.currentFoundation` 解析是否有债务。
- 从“家庭与关系”摘要解析是否已婚。
- 从“真正在意”摘要自动替用户选择。
- 把模型生成的摘要直接写回权威状态。
- 让模型每轮返回并覆盖整张画像。

### 3.3 每次选择都评估，只有实质变化才提交

每次接受后的节点都进入画像影响评估，但允许产生零个 patch。只有已经发生、证据明确且符合写入权限的变化才能提交。

### 3.4 用户主权字段受保护

家庭背景、兴趣、价值、自我描述和用户声明的理想不能因单个剧情节点被覆盖。模拟只能：

- 对兴趣提出强化或休眠建议；
- 对价值变化新增 observation；
- 对理想通过 DirectionArc 的状态变化提出更新；
- 等待用户确认，或由多次已接受历史提高观察可信度。

### 3.5 事实可靠性不只由 confidence 决定

事件硬条件必须同时检查来源、确认状态、权威归属和可信度。模型即使返回 `confidence=0.99`，也不能单独创造婚姻、债务、失业、重大疾病或亲人死亡事实。

## 4. 产品目标

### 4.1 用户目标

- 在有限页面内用六项内容理解主角当前人生。
- 可以更正错误事实，也可以从当前时间点主动更新人生方向。
- 修改客观状态后，后续剧情和事件资格同步变化。
- 能区分“我明确填写的内容”和“系统观察到、等待确认的变化”。
- 画像随着人生推进自动刷新，但不会无故漂移。

### 4.2 工程目标

- 建立可版本化、可回溯、可原子提交的 `ProtagonistProfile`。
- 建立地点、职业和关系的最小结构化权威状态。
- 建立来源、确认状态、写入策略和证据元数据。
- 建立统一的用户编辑命令与模拟 patch 提交流程。
- 建立确定性摘要输入与受约束的自然语言聚合器。
- 为 `WorldFactCondition` 提供三态事实读取接口。

## 5. 非目标

- 不做临床心理评估或固定人格标签。
- 不把价值观变成强制选择规则。
- 不让画像替代财务账本、人物状态、关系状态、DirectionArc 或 PressureArc。
- 不从普通正文关键词直接创建重大事实。
- 不要求第一版自动重算整条历史。
- 不在主页面展示 confidence、来源枚举、证据节点或内部 ID。
- 不允许一次用户编辑静默推断未提供的连带事实，例如“离异”不自动等于“房产已分割”。

## 6. 用户端六字段

### 6.1 类型

```ts
export interface ProtagonistProfileSummary {
  basicSituation: string;
  familyAndRelationships: string;
  currentFoundation: string;
  currentDirection: string;
  interests: string[];
  coreValues: string[];
  generatedAtAgeInMonths: number;
  sourceRevision: number;
}
```

### 6.2 展示语义

| 展示字段 | 示例 | 主要来源 |
|---|---|---|
| 基本情况 | 小城普通家庭出身，目前生活在上海，从事产品工作 | background、location、career |
| 家庭与关系 | 已婚，有一个女儿，需要分担父母照护 | relationship、people |
| 当前基础 | 工作稳定，有房贷，现金储备一般 | career、financial、health limitation |
| 当前方向 | 希望逐步转向独立创作，获得更多生活自主权 | active DirectionArc、用户理想 |
| 兴趣爱好 | 写作、摄影、徒步 | interests |
| 真正在意 | 自由、家人、创造 | confirmed values |

### 6.3 展示约束

- `basicSituation`：最多 56 个中文字符，最多两行。
- `familyAndRelationships`：最多 48 个中文字符，最多两行。
- `currentFoundation`：最多 32 个中文字符，最多一行。
- `currentDirection`：最多 48 个中文字符，最多两行。
- `interests`：最多展示 3 项，每项最多 8 个中文字符。
- `coreValues`：最多展示 3 项，每项最多 8 个中文字符。
- 空字段使用中性表达，例如“暂未补充”，不得自行补齐人物事实。
- 主页面不展示来源、可信度和观察状态；编辑面板可显示“由你填写”“来自人生经历”“等待你确认”。

## 7. 内部领域模型

### 7.1 通用来源和权限

```ts
export type ProfileFactSource =
  | "user"
  | "answer"
  | "world_state"
  | "accepted_history"
  | "system_derived"
  | "model_inferred";

export type ProfileConfirmationStatus =
  | "asserted"
  | "pending_confirmation"
  | "confirmed"
  | "denied"
  | "superseded";

export type ProfileWritePolicy =
  | "user_only"
  | "simulation_mutable"
  | "source_owned"
  | "derived";

export interface ProfileFactMeta {
  source: ProfileFactSource;
  confirmationStatus: ProfileConfirmationStatus;
  writePolicy: ProfileWritePolicy;
  confidence: number;
  effectiveFromAgeInMonths: number;
  updatedAtAgeInMonths: number;
  updatedAtNodeIndex?: number;
  evidenceNodeIndexes: number[];
}

export interface ProfileFact<T> {
  id: string;
  value: T;
  meta: ProfileFactMeta;
}
```

约束：

- `confidence` 必须 clamp 到 `0..1`。
- `user` 明确填写的当前事实使用 `asserted`；用户确认系统观察后使用 `confirmed`。
- `model_inferred` 默认必须为 `pending_confirmation`。
- `derived` 字段禁止直接编辑，必须修改其上游权威来源。
- `source_owned` 字段的修改必须路由给对应 reducer。

### 7.2 用户主权背景

```ts
export interface ProtagonistBackground {
  familyBackground?: string;
  hometown?: string;
  educationBackground?: string;
  socioeconomicOrigin?: string;
}
```

- 仅用户、初始问答或用户确认可以写入。
- 模型正文不得新增或覆盖原生家庭、出生地和教育背景。
- 用户更正时保留旧值为 `superseded` 审计记录；当前 profile 只引用最新有效值。

### 7.3 地点权威状态

```ts
export interface LocationState {
  id: string;
  city?: string;
  region?: string;
  country?: string;
  residenceType?: "renting" | "owned" | "family_home" | "dormitory" | "shared" | "other";
  livingArrangement?: "alone" | "with_partner" | "with_parents" | "with_children" | "shared" | "other";
  effectiveFromAgeInMonths: number;
  source: "user" | "accepted_history";
  confidence: number;
}
```

- 搬迁必须有已接受结果或用户明确编辑。
- “考虑去上海”“获得上海机会”不能更新 current location。
- 旧地点不删除，历史节点通过其快照恢复；当前快照只保留当前 `LocationState`。

### 7.4 职业权威状态

```ts
export interface CareerState {
  id: string;
  employmentStatus: EmploymentStatus;
  occupation?: string;
  industry?: string;
  organization?: string;
  careerStage?: string;
  activeProjectIds: string[];
  effectiveFromAgeInMonths: number;
  source: "user" | "accepted_history";
  confidence: number;
}
```

- `employmentStatus` 应与当前 `FinancialState.employmentStatus` 协调。
- 职业 reducer 可以接受明确的入职、离职、创业、休养、退休结果。
- 模型只提出变化，事务提交器负责更新。
- 如职业和财务信号冲突，本轮不得静默选择一方；进入修复或降级为 unknown。

### 7.5 关系权威状态

#### 7.5.1 PersonState 实体身份稳定性

`RelationshipState` 和画像关系引用成立的前提，是 `PersonState.id` 表示稳定人物实体，而不是每轮从最近文本重新识别出的临时角色。

当前实现使用 `family_parent`、`family_grandparent`、`family_partner`、`family_child` 等固定角色 ID。它们在追加节点和快照恢复时可以复用，但无法区分父亲与母亲、多个孩子、前后伴侣或多个同类朋友。Phase 1 必须先完成稳定实体身份规则：

```ts
export type PersonIdentityNamespace =
  | "user_role"
  | "named_person"
  | "accepted_character";

export interface PersonIdentityKey {
  namespace: PersonIdentityNamespace;
  key: string;
}

export interface PersonState {
  // 现有字段保持不变
  identityKey?: PersonIdentityKey;
}
```

ID 规则：

1. 追加节点时，优先按已有 `identityKey` 复用 `PersonState.id`，不得重新生成。
2. 回溯时直接恢复目标快照中的 `people`，不得重新识别并替换 ID。
3. 分支点以前已经出现的人物沿用原 ID。
4. 分支点以后首次出现的新人物，在节点被接受并提交时分配一次 ID；该 ID 随分支后续快照持久化。
5. 用户明确人物优先使用可区分角色的 identity key，例如 `parent:father`、`parent:mother`，不能继续把所有父母折叠为 `family_parent`。
6. 有明确姓名的人物使用规范化姓名加关系域作为 identity key；同名冲突时必须增加稳定区分信息，不能仅靠姓名合并。
7. 模型临时提及但未被接受节点提交的人物不得获得长期实体 ID。
8. `rebuildPersonStates()` 只负责复用、推进年龄和补充已接受人物，不得根据最近五个节点重建并替换整个人物集合。

关系引用提交前必须验证所有 `participantPersonIds` 都存在于同一份 `WorldStateSnapshot.people`。缺失引用使本轮 relationship patch 无效，不得留下悬空 ID。

```ts
export interface RelationshipState {
  id: string;
  participantPersonIds: string[];
  type: "romantic" | "family" | "friendship" | "professional" | "community";
  stage?: "dating" | "cohabiting" | "married" | "separated" | "divorced" | "widowed" | "active" | "distant" | "ended";
  status: "active" | "strained" | "distant" | "ended";
  livingTogether?: boolean;
  financialConnection?: boolean;
  responsibilitySummary?: string;
  effectiveFromAgeInMonths: number;
  source: "user" | "answer" | "accepted_history";
  confidence: number;
}

export interface ProfileRelationshipRef {
  relationshipId: string;
  personIds: string[];
}
```

- `PersonState` 继续保存人物身份、年龄、生命状态、职业和健康等人物信息。
- `RelationshipState` 保存“主角与人物之间是什么关系、处于什么阶段”。
- 伴侣关系变化不得只更新摘要字符串。
- 离异只确定关系阶段；房产、债务、子女照护如未说明，保持原状态或标记待补充。

### 7.6 健康限制权威状态

```ts
export interface HealthConditionState {
  id: string;
  type: "chronic_condition" | "functional_limitation" | "recovery_plan";
  status: "active" | "managed" | "resolved" | "unknown";
  summary: string;
  effectiveFromAgeInMonths: number;
  source: "user" | "accepted_history";
  confidence: number;
  evidenceNodeIndexes: number[];
}
```

- 五维 `health` 只表示总体状态，不能替代具体健康限制。
- `healthSummary` 只用于兼容旧历史，不能单独触发重大疾病事件。
- 新的持续健康限制必须来自用户明确资料或通过健康结果校验的已接受历史。
- 模型推断只能提出候选，不得直接创建 chronic condition。
- “已管理”不等于“已治愈”；事件和摘要必须保留这个区别。

### 7.7 兴趣、价值和理想

```ts
export interface ProfileInterest {
  key: string;
  label: string;
  aliases?: string[];
  categoryKey?: string;
  status: "mentioned" | "active" | "sustained" | "dormant";
  importance: number;
}

export interface ProfileValue {
  key: string;
  label: string;
  importance: number;
}

export interface DeclaredAspiration {
  id: string;
  summary: string;
  status: "exploring" | "active" | "background" | "paused" | "fulfilled" | "abandoned";
  importance: number;
  directionArcId?: string;
}
```

约束：

- 用户可以直接新增、修改、排序、暂停和删除自己声明的兴趣、价值和理想。
- “删除”用户声明内容应转为审计记录中的 superseded；当前数组不再引用。
- 单次模型正文提及不构成兴趣。
- 单次实际参与最多把兴趣从 `mentioned` 推到 `active`，不能直接写成 `sustained`。
- 价值变化必须进入 observation；未确认 observation 不覆盖正式 values。
- 理想与 DirectionArc 关联，但用户声明理想不自动创建 active DirectionArc；需要用户选择强化或明确设为当前方向。

兴趣 key 规则：

- Phase 1–2 保留用户原始 `label`，同时生成规范化 `key`：去首尾空格、统一大小写和全半角，并经过显式 alias map；不得仅靠模糊相似度自动合并。
- 内置常见别名必须映射到同一 key，例如“拍照”“摄影”→ `photography`；“街头摄影”保留具体 label，同时使用 `categoryKey=photography`。
- 无受控词汇的新兴趣使用 `custom:<stable-normalized-key>`，保留用户原文。
- 系统发现可能重复的兴趣时只能提出合并建议；用户确认后再合并 evidence、importance 和状态。
- Phase 3 建立有限兴趣分类表，首批覆盖约 20–30 个常见领域；分类表用于聚合和事件软权重，不删除用户的具体兴趣表达。

### 7.8 系统观察

```ts
export interface ProfileObservation {
  id: string;
  type: "value_shift" | "risk_attitude" | "self_acceptance" | "direction_emergence" | "coping_pattern";
  statement: string;
  status: "observed" | "pending_confirmation" | "confirmed" | "denied";
  confidence: number;
  evidenceNodeIndexes: number[];
  firstObservedAtAgeInMonths: number;
  lastObservedAtAgeInMonths: number;
}
```

示例：

- “现在更看重稳定。”
- “对失败更加谨慎。”
- “逐渐接受自己的身体限制。”
- “开始把创作视为长期方向。”

规则：

- 一次选择最多创建或强化 observation，不得直接改写正式 value。
- observation 至少需要两条去重的已接受历史证据，才可进入用户确认入口；重大反思节点允许一条高质量证据进入 `pending_confirmation`，但仍不能自动确认。
- 用户确认后，可以生成对应 `ProfileFact<ProfileValue>` 或调整已有 value。
- 用户否认后保留 denied 审计状态，后续不得因相同证据重复提示。

### 7.9 ProtagonistProfile

```ts
export interface ProtagonistProfile {
  background?: ProfileFact<ProtagonistBackground>;
  selfDescription?: ProfileFact<string>;

  currentLocationStateId?: string;
  currentCareerStateId?: string;
  relationshipRefs: ProfileRelationshipRef[];
  healthConditionIds: string[];

  financialStateRef: { owner: "current_simulation_node" };
  directionArcIds: string[];

  interests: Array<ProfileFact<ProfileInterest>>;
  values: Array<ProfileFact<ProfileValue>>;
  declaredAspirations: Array<ProfileFact<DeclaredAspiration>>;
  observations: ProfileObservation[];

  generatedSummary?: ProtagonistProfileSummary;
  revision: number;
  version: 1;
}
```

`financialStateRef` 是逻辑引用，不保存金额和节点索引。读取时始终由当前 `SimulationNode.financialState` 或当前 `HistoryItem.financialState` 注入聚合器。历史回溯后自然读取被恢复节点的财务快照。

### 7.10 WorldStateSnapshot 扩展

```ts
export interface WorldStateSnapshot {
  // 现有字段保持不变
  protagonistProfile?: ProtagonistProfile;
  locationStates?: LocationState[];
  currentLocationStateId?: string;
  careerStates?: CareerState[];
  currentCareerStateId?: string;
  relationships?: RelationshipState[];
  healthConditions?: HealthConditionState[];
  version: 1 | 2;
}
```

兼容规则：

- 旧 `version:1` 读取时允许 `protagonistProfile` 和新增状态为空。
- 首次写入画像的新节点使用 `version:2`。
- 不批量重写旧历史。
- 恢复旧节点时可即时构建只读 fallback summary，但不得把推断结果自动提交为权威画像。
- Phase 1 保留 `careerSummary`、`relationshipSummary`、`healthSummary`、`locationSummary`，不得删除。
- version 1 历史继续把四个旧 summary 作为 fallback 展示和旧 Prompt 兼容输入。
- version 2 先提交结构化权威状态，再由单向 compatibility formatter 生成四个旧 summary；禁止从旧 summary 反向覆盖结构化状态。
- 事件硬条件不得读取四个旧 summary。若只有旧 summary 而没有可靠结构化事实，三态 resolver 必须返回 `unknown`。

## 8. 字段权限矩阵

| 字段 | 用户直接编辑 | 模拟自动提交 | 模型可提出 | 事件硬条件 |
|---|---:|---:|---:|---:|
| 家庭背景 | 是 | 否 | 否 | 仅用户/答案确认事实 |
| 自我描述 | 是 | 否 | 否 | 否，仅 Prompt 上下文 |
| 当前城市 | 是，经 Location reducer | 是，明确搬迁结果 | 是 | 是，可靠来源 |
| 职业状态 | 是，经 Career reducer | 是，明确职业结果 | 是 | 是，可靠来源 |
| 婚姻/伴侣 | 是，经 Relationship reducer | 是，明确关系结果 | 是 | 是，可靠来源 |
| 子女/赡养责任 | 是，经 Person/Relationship reducer | 是，明确结果 | 是 | 是，可靠来源 |
| 房贷/债务 | 是，经 Financial reducer | 是，经财务信号 | 是 | 是，只读 FinancialState |
| 健康限制 | 是，经健康权威状态 | 是，校验后的健康结果 | 是 | 是，禁止低可信推断 |
| 兴趣 | 是 | 仅强化/休眠建议 | 是 | 软条件 |
| 价值 | 是 | 否 | observation | 仅软条件，且需确认 |
| 理想 | 是 | 通过 Arc 状态反映 | 是 | 软条件/方向权重 |
| 六段摘要 | 否，编辑上游字段 | 自动重建 | 仅受约束润色 | 禁止 |

## 9. 用户编辑协议

### 9.1 两种编辑语义

用户编辑必须明确区分：

1. `correct_fact`：更正系统记录错误。
2. `change_from_now`：从当前模拟年龄开始发生变化。

```ts
export interface UpdateProtagonistProfileCommand {
  mode: "correct_fact" | "change_from_now";
  target:
    | "background"
    | "self_description"
    | "location"
    | "career"
    | "relationship"
    | "financial"
    | "health"
    | "interest"
    | "value"
    | "aspiration";
  payload: unknown;
  currentAgeInMonths: number;
  currentNodeIndex: number;
  expectedProfileRevision: number;
}
```

### 9.2 修正事实

- 默认只修正当前分支从当前节点起使用的事实。
- 第一版不自动重算已经生成的过去节点。
- 如用户要求修改回溯起点以前的基础事实，UI 必须提示“只从现在生效”或“回到相关节点重新推演”。
- 不得静默重写已完成历史正文。

### 9.3 从现在开始改变

- 写入 `effectiveFromAgeInMonths=currentAgeInMonths`。
- 旧状态保留在旧历史快照。
- 新状态参与后续 Prompt、事件条件和摘要。
- 如变更涉及 source-owned 字段，必须通过对应 reducer 和一致性校验。

### 9.4 示例：已婚改为离异

允许自动同步：

- RelationshipState.stage → `divorced`。
- RelationshipState.status → `ended` 或产品指定的后续状态。
- `livingTogether` 在用户明确说明分居时更新；否则进入 unknown/待补充。
- 关系事件资格重算。
- 画像摘要重建。

禁止自动推断：

- 房产已经出售或分割。
- 共同债务已经解除。
- 子女监护和抚养方案已经确定。
- 双方不再联系。

这些信息缺失时返回待补充项，不生成虚构默认值。

## 10. 模拟更新协议

### 10.1 模型只能提出 patch

```ts
export type ProfilePatchTarget =
  | "location"
  | "career"
  | "relationship"
  | "interest"
  | "aspiration"
  | "observation";

export interface ProfilePatchProposal {
  id: string;
  target: ProfilePatchTarget;
  operation: "set" | "add" | "update" | "transition" | "reinforce" | "challenge";
  entityId?: string;
  value: unknown;
  reason: string;
  evidence: string;
  confidence: number;
}
```

财务按 `2026-07-18-authoritative-financial-ledger-architecture-spec.md` 使用 `FinancialEventProposal → AcceptedFinancialEvent → FinancialLedger reducer`；人物生命状态继续使用经过校验的 `worldDeltas` / ProfilePatch。不得用 ProfilePatch、正文或财务 Proposal 绕过对应单写者。

当前 `career_state`、`health_state`、`location_change` 和 `relationship_change` 主要携带 `summary` 文本，只足以更新兼容摘要，不能单独构建完整 `CareerState`、`LocationState`、`HealthConditionState` 或 `RelationshipState`。Phase 1–3 必须采用以下之一：

- 扩展对应 WorldDelta，增加经过校验的可选结构化 payload；或
- 由同一节点同时返回结构化 ProfilePatch，并验证它与 accepted WorldDelta 一致。

禁止从 WorldDelta.summary 解析城市、婚姻、职业或疾病等硬事实。

### 10.2 NarrativeMeta 扩展

```ts
export interface NarrativeMeta {
  // 现有字段保持不变
  profilePatches?: ProfilePatchProposal[];
}
```

### 10.3 校验

新增纯函数：

```ts
validateProfilePatchProposals({
  proposals,
  selectedDecision,
  acceptedOutcome,
  narrativeText,
  currentWorldState,
  currentFinancialState
}): AcceptedProfilePatch[];
```

必须检查：

1. `evidence` 是当前正文中的完整原句或由结构化 accepted outcome 直接证明。
2. patch 不写入 `user_only` 字段。
3. source-owned 字段必须能转换为对应 reducer 输入。
4. “考虑、计划、可能、希望”不能提交成已经完成的城市、职业或关系变化。
5. 单次模型推断不能创建重大关系、债务、疾病或死亡事实。
6. entityId 必须引用已存在实体，除非当前已接受节点明确创建新实体。
7. 同一事务内冲突 patch 必须拒绝或修复，不得按数组顺序覆盖。

### 10.4 Reducer

```ts
reduceProtagonistProfile({
  currentProfile,
  acceptedPatches,
  nextWorldState,
  currentFinancialState,
  targetAgeInMonths,
  nodeIndex
}): ProtagonistProfile;
```

规则：

- reducer 是画像状态的唯一写者。
- 每个 accepted patch 必须幂等。
- profile `revision` 每次实际变化加 1；零变化不得增加。
- summary 在所有权威 reducer 完成之后生成。
- Profile、WorldDelta、FinancialState、Arc transition 和 summary 必须在同一 simulation transaction 中提交。

## 11. 摘要聚合器

### 11.1 输入

```ts
export interface BuildProfileSummaryInput {
  profile: ProtagonistProfile;
  worldState: WorldStateSnapshot;
  financialState: FinancialState;
  ageInMonths: number;
}
```

### 11.2 两阶段生成

第一阶段由代码生成确定性 `ProfileSummaryFacts`：

```ts
interface ProfileSummaryFacts {
  backgroundLabels: string[];
  city?: string;
  occupation?: string;
  relationshipLabels: string[];
  dependentLabels: string[];
  employmentStability?: string;
  housingLabel?: string;
  cashBufferLabel?: string;
  activeDirectionLabels: string[];
  interestLabels: string[];
  valueLabels: string[];
}
```

第二阶段生成六字段：

- 优先使用确定性模板。
- 如使用模型润色，只允许压缩和改写已提供 facts。
- 模型不得增加姓名、城市、婚姻、子女、职业、金额、疾病或方向。
- 润色结果必须通过事实词项校验；失败时回退模板。

### 11.3 重建时机

以下任一变化后重建：

- profile revision 变化；
- location/career/relationship 权威状态变化；
- FinancialState 发生实质变化；
- DirectionArc 状态或排序变化；
- 用户确认/否认 observation。

纯五维变化、普通正文变化、PressureArc checkpoint 变化不必单独重建，除非改变了上述来源。

## 12. 事实可靠性与事件系统

### 12.1 三态查询

```ts
export type FactResolution =
  | { status: "satisfied"; evidenceIds: string[] }
  | { status: "unsatisfied"; reason: string }
  | { status: "unknown"; missingFacts: string[] };
```

“没有伴侣资料”必须返回 `unknown`，不能等同于 `has_partner=false`。

### 12.2 硬条件允许来源

事件硬条件只允许使用：

- 用户明确填写且未被 superseded/denied 的事实；
- 用户确认的事实；
- source-owned 权威状态；
- 已接受历史中稳定提交的事实；
- 从权威数字确定性推导的事实。

以下内容不能单独满足硬条件：

- `model_inferred`；
- `pending_confirmation` observation；
- 六字段 generatedSummary；
- 普通正文关键词；
- 低置信度人物推断。

### 12.3 硬事件保护

以下事件必须依赖可靠硬条件：

- 结婚、离婚、背叛和伴侣死亡；
- 怀孕、生育和子女重大责任；
- 裁员、失业和组织冲突；
- 债务、房贷、破产和重大资产交易；
- 重大疾病和长期健康限制；
- 父母照护和共同家庭财务责任。

### 12.4 软条件

兴趣、理想和已确认价值可以：

- 调整事件候选权重；
- 调整场景表达；
- 影响选项关注点；
- 帮助选择与用户方向相关的普通事件。

它们不能：

- 自动替用户选择；
- 删除与价值不一致但现实合理的选项；
- 自动触发辞职、离婚、创业或冒险；
- 永久锁定人物行为模式。

### 12.5 与事件库四模式 Spec 的关系

- 本 Spec 提供 Phase 3 `WorldFactCondition` 所需的可靠来源、三态 resolver 和画像软条件。
- 四模式事件库仍负责候选生成、模式权重和事件选择。
- 本 Spec 不改变活动 PressureArc → 健康升级 → 普通动态事件的调度优先级。
- generic `WorldFact[]` 如按事件库 Spec 实现，应引用或派生自这里的权威状态，不得复制精确财务金额和人物详情。
- 两条开发线不设置循环阻塞：事件库可先用 Phase 2 `requiredContextGroups` 上线轻量条件；画像 Phase 4 完成后，再把相关条件升级为完整三态 `WorldFactCondition`。
- 升级前 `requiredContextGroups` 无可靠证据时继续按“不满足”处理；升级后才区分 `unsatisfied` 与 `unknown` 并记录 reason codes。
- 同一事件在迁移期间只能选择一个条件入口作为硬门槛，禁止 `requiredContextGroups` 和 `WorldFactCondition` 产生互相矛盾的双重判定。

## 13. Prompt 使用

下一轮 Prompt 只注入精简结构化上下文：

```text
【主角当前画像】
- 基本情况：...
- 家庭与关系：...
- 当前基础：...
- 当前方向：...
- 兴趣：...
- 真正在意：...

【可靠事实边界】
- 只有下列 source-owned facts 可以作为客观事实：...
- pending observations 只能作为内心张力，不得写成既定价值变化。
```

规则：

- Prompt 使用 summary 提高可读性，同时传入事件所需的结构化 facts。
- summary 不能替代结构化事实。
- 不向模型暴露所有历史审计记录，只传当前有效事实和最多 3 条相关 observation。
- 模型不得直接修改 profile revision、confirmationStatus 或 writePolicy。

## 14. 历史回溯与分支

- 每个 `HistoryItem.worldStateSnapshot` 保存当时的 profile 和权威状态快照。
- `HistoryItem.financialState` 继续保存当时财务快照。
- 回溯后恢复目标节点的 profile revision、summary 和 source refs。
- 截断后的旧未来不参与当前画像、观察强化或事件条件。
- 从旧 `version:1` 节点回溯时，显示 fallback summary；首次新选择提交后生成正式 version 2 profile。
- transactionId 幂等检查必须覆盖 profile patch，重试不得重复强化兴趣或 observation。

## 15. 初始化

### 15.1 来源

画像初始化只读取：

- `UserInitialData`；
- 用户回答 `QuestionTurn`；
- 起始节点已校验的财务状态；
- 起始人物状态；
- 已建立的初始 DirectionArc。

为避免从自由文本猜测基础事实，建议向 `UserInitialData` 增加一个兼容性的可选 seed，而不是继续增加多个零散顶层字段：

```ts
export interface ProtagonistProfileSeed {
  hometown?: string;
  educationBackground?: string;
  familyBackground?: string;
  socioeconomicOrigin?: string;
}

export interface UserInitialData {
  // 现有字段保持不变
  protagonistProfileSeed?: ProtagonistProfileSeed;
}
```

新用户可在初始资料或画像首次编辑时填写；旧用户缺失该对象时保持兼容。

### 15.2 初始化边界

- 用户明确描述使用 `source=user|answer`。
- 城市、职业、婚姻等未明确时保持 unknown，不由模型补齐。
- `protagonistProfileSeed` 是 hometown、educationBackground、familyBackground、socioeconomicOrigin 的最高优先级初始化来源。
- 有稳定 question id 的追问答案可以映射到对应结构化字段；不得只根据问题文案关键词猜字段含义。
- `milestoneGaokao`、`currentSituation` 和其他自由文本只可生成待确认候选或 fallback 展示，不得通过自然语言解析直接成为事件硬事实。
- 从“想尝试摄影”可以初始化 `interest.status=mentioned`，不能初始化为 sustained。
- 从“希望辞职创业”可以初始化 declared aspiration，不能把 employmentStatus 改为 self_employed。
- 模型可生成六字段 fallback 文案，但不得把文案中的补充内容提交为事实。

## 16. API 和模块边界

建议新增：

```text
src/services/profile/profileService.ts
src/services/profile/profileEditService.ts
src/utils/profileReducer.ts
src/utils/profilePatchValidation.ts
src/utils/profileSummary.ts
src/utils/profileFactResolver.ts
src/utils/locationState.ts
src/utils/careerState.ts
src/utils/relationshipState.ts
src/utils/healthConditionState.ts
```

公开接口：

```ts
initializeProtagonistProfile(...): ProtagonistProfile
updateProtagonistProfile(command, context): ProfileUpdateResult
validateProfilePatchProposals(...): AcceptedProfilePatch[]
reduceProtagonistProfile(...): ProtagonistProfile
buildProtagonistProfileSummary(...): ProtagonistProfileSummary
resolveProfileFact(condition, context): FactResolution
```

UI 不直接修改 `WorldStateSnapshot`，只能调用 `updateProtagonistProfile()`。

## 17. 错误与冲突处理

### 17.1 乐观并发

- 用户编辑命令必须携带 `expectedProfileRevision`。
- revision 不一致时返回 `PROFILE_REVISION_CONFLICT`，UI 刷新后让用户重新确认。

### 17.2 跨源冲突

示例：旧历史迁移后，CareerState 为 `employed`，兼容 FinancialState 却为 `not_working`。

- V2 新节点以 CareerState 为就业身份真值，由 `deriveFinancialState()` 重建兼容字段。
- 冲突涉及旧历史或迁移可信度时，不生成确定性“工作稳定”摘要，事实 resolver 返回 `unknown` 并记录迁移问题。
- 不允许模型、摘要或 FinancialEventProposal 自行选择并覆盖 CareerState。

### 17.3 缺失连带事实

修改关系、城市或职业后，如住房、债务、照护责任无法确定：

- 保留原有未被明确否定的事实；
- 将受影响条件标记为 unknown 或 needs_review；
- 必要时向用户提出一个最小补充问题；
- 不自动生成完整生活重构。

## 18. 分阶段实施

### Phase 1：内部模型和只读摘要

- Phase 1 开工前先建立 PersonState ID 稳定性测试，并修复同类人物折叠问题。
- 增加 Profile 类型、LocationState、CareerState、RelationshipState、HealthConditionState。
- 从初始资料和当前权威状态构建 profile。
- 构建六字段 summary。
- 保存到 `WorldStateSnapshot.version=2`。
- 完成旧历史 fallback 和回溯。
- UI 只读展示。

### Phase 2：用户编辑

- 增加统一编辑入口。
- 支持 `correct_fact` 和 `change_from_now`。
- source-owned 修改路由到对应 reducer。
- 增加 revision 冲突保护。
- 修改后刷新 summary 和事件上下文。

### Phase 3：模拟自动更新和系统观察

- 增加 `profilePatches`。
- 增加 patch 校验和 reducer。
- 支持兴趣强化、DirectionArc 引用同步、地点/职业/关系明确结果更新。
- 增加 observation 的观察、确认、否认流程。
- 用户主权字段保持保护。

### Phase 4：事件事实集成

- 实现三态 `resolveProfileFact()`。
- 与 `WorldFactCondition` 对接。
- 重大事件切换到可靠硬事实。
- 兴趣、价值和方向只作为软条件。
- 增加“为什么该事件有资格出现”的内部 reason codes。

Phase 1–3 可以独立上线。事件库 Phase 3 可拆成：

- Phase 3A：继续使用 `requiredContextGroups` 的简化可靠条件；
- Phase 3B：画像 Phase 4 完成后，升级为完整三态 `WorldFactCondition`。

因此画像 Phase 4 不阻塞事件库 Phase 3A，但必须在事件库 Phase 3B 合并前完成。

## 19. 测试要求

### 19.1 单元测试

必须覆盖：

1. 六字段摘要只使用结构化输入。
2. 空字段不被模型补齐。
3. 一次普通选择产生零 patch 时 profile revision 不变。
4. 搬迁意向不更新地点，完成搬迁才更新。
5. 用户主权字段拒绝 simulation patch。
6. 用户确认 observation 后才更新正式 value。
7. `model_inferred` 不能满足重大事件硬条件。
8. unknown 与 false 正确区分。
9. 财务摘要从 FinancialState 推导，不复制金额。
10. transaction 重试不会重复强化兴趣。
11. revision 冲突拒绝旧编辑。
12. 离异不自动清除债务、房产和子女责任。
13. 回溯后恢复当时 profile 和 summary。
14. 旧 version 1 历史可正常继续。
15. 追加新节点时已有人物 ID 保持不变。
16. 回溯后恢复目标快照中的人物 ID，不重新生成。
17. 分支点以前人物 ID 保持不变，分支后新人物获得分支内稳定 ID。
18. 父亲和母亲、多个孩子及前后伴侣不会因 relation 相同而合并。
19. `participantPersonIds` 缺失时 relationship patch 被拒绝。
20. “摄影、拍照、街头摄影”按 alias/category 规则聚合，但保留用户原始 label。

### 19.2 集成测试

至少覆盖以下路径：

- 用户编辑兴趣 → summary 更新 → 后续 Prompt 出现兴趣 → 事件只软加权。
- 用户修改当前城市 → LocationState 更新 → summary 更新 → 城市条件生效。
- 已接受搬迁节点 → profile patch 提交 → 回溯前后城市不同。
- 用户把已婚更正为离异 → RelationshipState 更新 → 婚姻事件失去资格 → 财务保持未擅自变化。
- 财务信号产生房贷 → FinancialState 更新 → 当前基础摘要变化 → 房贷事件资格成立。
- 系统观察“更看重稳定” → 待确认 → 未确认前不成为硬条件 → 用户确认后显示在“真正在意”。

### 19.3 浏览器验收

- 主页面只展示六项，没有内部字段泄漏。
- 六项在目标页面高度内完整显示或按规则截断。
- 统一编辑入口可以修改用户主权字段。
- 修改 source-owned 字段时有明确确认和缺失事实提示。
- 页面刷新、继续模拟和历史回溯后画像一致。
- 用户可以确认或否认系统观察。

## 20. 验收标准

满足以下全部条件才算完成：

1. 用户只看到六字段画像，内容来自结构化状态聚合。
2. 六段文案不能作为事件硬条件。
3. 财务、人物、关系、地点、职业、DirectionArc 和 PressureArc 保持明确单写者。
4. 用户主权字段不会被单次模型输出覆盖。
5. 客观状态编辑会写入相应权威数据源，而不是只改文案。
6. 系统观察具备 observed/pending/confirmed/denied 生命周期。
7. 重大事件不接受低可信模型推断作为唯一条件。
8. 事实 resolver 能区分 satisfied、unsatisfied 和 unknown。
9. profile、权威状态和 summary 原子提交并支持幂等重试。
10. 历史回溯恢复当时画像，旧历史保持兼容。
11. 用户编辑和模拟更新都有 revision、来源和证据记录。
12. 价值、兴趣和理想只影响表达和权重，不替用户做决定。

## 21. 开发顺序结论

推荐顺序：

```text
结构化权威状态
→ ProtagonistProfile
→ 六字段只读摘要
→ 用户编辑与权限
→ 模拟 ProfilePatch
→ 系统观察确认
→ WorldFactCondition 对接
```

不得先实现“让模型每轮生成六段画像”再补结构化状态。那会使展示文案先成为事实源，后续迁移成本高且容易触发错误事件。

本 Spec 完成后的产品定义为：

> 用户看到的是一张简洁、完整、可编辑的主角画像；系统内部保存的是有权威来源、编辑边界、确认状态和历史证据的结构化人生档案；六段摘要随状态自动刷新，但永远不替代事实本身。
