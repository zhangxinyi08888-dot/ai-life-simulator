# 跨线事件调度、父母关系、爱情形成与关系生命周期闭环 Spec

## 1. 文档状态

- 状态：修订待开发
- 规格决策日期：2026-07-19
- 生命周期修订日期：2026-07-23
- 变更性质：事件归属调度与关系事实闭环修正，不是单纯调整事件概率
- 首个适用主线：事业主线
- 核心交付：普通节点 75/25 线路分流、爱情形成事件、浪漫关系探索态、关系生命周期 checkpoint、父母线可信激活、父母关系结构化状态、关系事务单写
- 上游约束：继续服从现有 NarrativeMode、PressureArc、DirectionArc、事件 cooldown、语义去重和权威 WorldState 事务边界
- 取代范围：取代“把所有 relationship 事件直接放入全局候选池后仅靠 `baseProbability` 调权”的方案；取代“形成事件 + 最近 N 节点历史命中即可视为 `confirmed_partner`”的止血方案
- 本次修订范围：只补充爱情关系从 `exploring -> dating -> commitment decision` 的时间连续性、自然收束、年龄软权重和验收口径；不扩展为完整 NPC 或社交网络系统

## 2. 问题定义

### 2.1 当前现象

当前事业路线里，其他生活领域不是先按线路份额被选择，而是所有符合条件的事件一起进入候选池，再经过 NarrativeMode 和事件权重选取。由此产生三个问题：

1. `baseProbability` 只是候选池内部的相对权重，不能表达“普通事业节点中 25% 为跨线节点”。
2. 父母线可以被宽泛家庭词和模型历史正文反复召回，且第一批家庭事件偏责任、牺牲和边界压力。
3. 爱情事件主要要求 `confirmed_partner`，能够延续现任关系，却缺少“相遇、继续了解、确认交往”的形成闭环。

### 2.2 已确认的爱情断链

当前 `confirmed_partner` 只接受两类证据：

1. `WorldStateSnapshot.people` 中存在非 `model_inferred`、置信度不低于 `0.75` 的 `partner`；
2. 用户初始填写或追问答案 `userText` 中明确出现现任伴侣、已婚、正在恋爱等表达。

后续历史正文不属于 `userText`。同时：

- `activeCharacters` 只描述本节点出场人物，不会自动提交到人物 reducer；
- `relationship_change` 当前只更新兼容摘要，不会创建人物或推进结构化关系；
- `model_inferred` 人物默认置信度 `0.55`，不能通过 `confirmed_partner`；
- `rebuildPersonStates()` 在没有既有人物时只扫描初始用户材料，不会把后续相遇剧情提升为可靠人物。

因此，仅新增“相遇事件”会形成：

```text
相遇事件进入剧情
  -> 用户选择继续了解
  -> 没有 Accepted Person / Accepted Relationship 被提交
  -> 下一轮 confirmed_partner 仍为 false
  -> 承诺、协作、陪伴等事件继续不可用
```

### 2.3 设计根因

#### 根因 A：线路归属和事件权重混在一起

系统没有先决定“本轮属于事业还是其他生活线”，因此无法给出可解释的 75/25 产品策略。

#### 根因 B：关系存在、关系阶段和人物称谓混在一起

“认识某人”“愿意继续了解”“开始约会”“稳定伴侣”是不同事实，当前却试图用单一 `confirmed_partner` 覆盖。

#### 根因 C：模型叙事拥有了事实召回权，却没有事实提交责任

模型正文可以让父母或对象反复出现，但不需要提供可验证、可提交、可撤销的关系状态。

#### 根因 D：家庭关系默认通过压力获得戏剧性

父母存在与父母施压之间缺少“未知、普通联系、支持交换、意见不同但尊重”等中性状态，导致压力事件成为最容易生成的家庭内容。

#### 根因 E：爱情阶段被拆成互不相干的普通随机事件

`romance_new_connection`、`romance_connection_clarification` 和后续承诺事件虽然具有语义先后关系，但当前只通过资格条件相连：

- `exploring` 满三个月只让 clarification “可以进入候选池”，不保证被调度；
- 事业主线下爱情普通份额约为 `25% × 65% = 16.25%`；
- 普通节点默认推进 12–36 个月；
- clarification 继续与事业、财务、家庭和强制事件竞争。

因此，相遇后平均等待多个普通节点才再次抽中爱情事件，每个节点又可跨越一至三年；“相遇十几年后才确认交往”是当前架构的可预期长尾，不是模型偶发发挥问题。

### 2.4 本轮 R4 时间证据与边界

本轮五路线真实记录中：

- `romance_new_connection` 出现年龄为 21.8、28.7、29.7、55.3、59.6 岁，均值 39.0 岁，中位数 29.7 岁；
- 两条选择 `continue_getting_to_know` 的路线在 21.8、29.7 岁形成 exploring；
- 对应 `begin_mutual_dating` 在 50.5、45.8 岁才出现；
- 两条路线从相遇到正式交往分别等待 28.7 年和 16.2 年，且都跨过 14 个历史节点；
- 本轮没有权威 marriage transition。

该证据足以证明无上限随机等待的机制缺陷，但 `n=2` 的成功发展样本不足以校准 P50/P90 或年龄乘数。窗口参数必须通过确定性大样本和至少 30–50 条关系发展生成路线再冻结。

## 3. 目标

### 3.1 产品目标

- 事业主线的普通节点中，约 75% 由事业线拥有，约 25% 由爱情、家庭或友情线拥有。
- 跨线事件与事业现实相交，但不自动取代长期事业方向。
- 没有现任伴侣时，爱情可以自然形成，也可以被用户拒绝或长期不形成。
- 用户没有确认父母相关事实时，系统不得自行长出父母线。
- 父母线激活后默认关系未知，不默认保守、反对、控制或需要照护。
- 父亲、母亲或未区分的父母群体可以拥有不同、议题化、可演进的关系事实。
- 用户选择继续了解后，关系在数月到数年的现实窗口内得到跟进，不再依赖普通跨线随机命中。
- 晚年爱情始终可发生，但新相遇年龄不再在 18–100 岁全区间完全等权。

### 3.2 工程目标

- 将“线路选择”置于 NarrativeMode 内具体事件选择之前。
- 为事件增加稳定的 `routeLine`，不再从标题、正文或 tags 猜测线路。
- `RelationshipState` 成为浪漫关系阶段的唯一权威来源。
- 人物 reducer 成为长期人物创建和身份合并的唯一写入者。
- 父母关系状态只接受用户认可证据或已接受事件结果。
- 历史扫描只用于事件资格和兼容迁移，不成为关系状态的第二写入者。
- 关系 checkpoint 由 relationship reducer 创建和更新，调度器只读取，不从模型正文推断期限。
- 时间轴不得跳过已经承诺的关系最大跟进期限。

### 3.3 成功标准

以下错误在架构上不能继续表达：

- 通过调低或调高某个事件 `baseProbability` 冒充 75/25 线路份额；
- AI 正文提到“家里”后自动激活父母线；
- 未选择的父母选项激活家庭事件；
- 第一次见面或“继续了解”直接变成稳定伴侣；
- 最近 N 节点窗口过期后，已形成的关系突然消失；
- 同一相遇人物在后续节点被重新生成成另一个人；
- 单次担忧被归纳成“父母一贯保守”；
- “担心风险”被等同于“反对主角选择”。
- `exploring` 在没有新选择的情况下悬挂十几年；
- 为解决长尾而强制用户开始交往、同居或结婚；
- checkpoint 到期后在后台静默结束关系；
- 因一次模型 fallback 丢失后续关系跟进义务。

## 4. 非目标

- 不保证每一条短路线精确达到 75/15/7.5/2.5；配置表达的是普通节点的目标概率，并通过批量路线验收。
- 不让爱情、婚姻或生育成为所有路线的必经阶段。
- 不建设完整社交网络、约会应用或 NPC 自主行为系统。
- 不在第一批覆盖所有主线的专属跨线权重；先完成事业主线闭环，再扩展教育、财富等主线。
- 不删除健康 PressureArc、健康危机、恢复或收束事件；仅把健康从“可选跨线池”移除。
- 不把 `self` 继续作为独立跨线。自我变化由事件后果、已接受历史和 DirectionArc 表达。
- 不从旧历史正文批量反推父母立场或浪漫关系阶段。
- 不以全国平均初婚年龄为单一路线剧本，不要求所有用户在某个年龄相遇、交往或结婚。
- 不让关系 checkpoint 绕过 PressureArc、健康危机和其他必须先完成的系统因果事件。

## 5. 核心术语与所有权

| 概念 | 含义 | 唯一权威来源 |
|---|---|---|
| `mainLine` | 当前普通人生阶段主要推进的长期方向 | 当前有效 DirectionArc / 初始 `coreStoryFocus` 兼容映射 |
| `routeLine` | 本节点主要决策属于哪一条线 | 事件种子与调度结果 |
| `backgroundThread` | 可被正文轻量延续的背景材料 | StoryContext，只读，不等于线路激活 |
| 长期人物身份 | 后续需要稳定引用的具体人物 | `PersonState[]` + person reducer |
| 浪漫关系阶段 | 认识、探索、约会、伴侣、结束 | `RelationshipState[]` + relationship reducer |
| 关系生命周期 checkpoint | 已形成关系下一次可跟进、应跟进和最迟跟进的时间边界 | `RelationshipState.progression` + relationship reducer |
| 父母线激活 | 父母可进入家庭事件候选池 | `FamilyRelationshipState.activation` |
| 父母议题立场 | 某位父母对某个具体议题的当前立场 | `ParentTopicStance[]` + family relationship reducer |
| 本节点正文 | 已发生过程的叙事表达 | 派生内容，不得单独反写权威状态 |

重要边界：

```text
backgroundThread 可影响文风和轻量连续性，
但不能创建人物、激活父母线或确认伴侣。
```

## 6. 总体调度顺序

下一普通节点的顺序调整为：

```text
1. 检查强制优先事件
   - 前台 PressureArc continuation
   - 健康危机阶段收束
   - 债务等确定性升级入口
   - E2E override
   - 其他必须完成的系统生命周期事件

2. 检查关系生命周期 checkpoint
   - `overdue` checkpoint：进入下一安全决策节点
   - `due` checkpoint：进入因果跟进队列
   - 仅 `eligible` checkpoint：仍可在普通 romance 线路中渐进加权

3. 若无强制事件或到期 checkpoint，解析当前 mainLine

4. 按 LineMixPolicy 选择 routeLine
   - main line
   - cross line

5. 只在被选 routeLine 内建立 eligible candidate pool

6. 应用 required context / required facts / history conditions

7. 应用事件 ID cooldown、语义相似限制、类别连续限制

8. 在可用 NarrativeMode 中选择模式

9. 在该 routeLine + NarrativeMode 内按事件权重选择具体事件

10. Render

11. 用户选择后，由事务提交 Accepted Outcome、人物和关系变化
```

强制事件不计入 75/25 的分母。结局节点、报告邀请节点和恢复流程中的非决策内部过渡也不计入。

优先级和统计口径：

| 顺序 | 入口 | 是否走普通线路调度 | 是否计入 75/25 |
|---:|---|---:|---:|
| 1 | 前台 PressureArc continuation | 否 | 否 |
| 2 | 健康、债务等确定性升级或收束 | 否 | 否 |
| 3 | E2E override | 否 | 否 |
| 4 | 已到期或超期的关系 checkpoint | 否；走因果跟进队列 | 否 |
| 5 | Arc 非急性期安全 continuation / 重大事件后缓冲 | 只在安全候选集合内选择 | 否 |
| 6 | 普通人生节点，包括尚未到期但已 eligible 的关系候选 | 是 | 是 |

E2E override 必须记录 `selectionKind="override"`；真实分布验收必须关闭 override。Arc 安全检查打回的跨线候选不得计为已实现的跨线节点。

关系 checkpoint 在 `eligibleAt` 到 `dueAt` 之间若通过普通 romance 抽样自然出现，按普通跨线节点计数；从 `dueAt` 起由生命周期队列提升或在 `maxAt` 强制进入下一安全节点时，记录 `selectionKind="relationship_follow_up"`，不进入 75/25 分母。强制事件打断期间 checkpoint 必须保持 pending，不能因被推迟而丢失。

## 7. 线路数据结构

### 7.1 RouteLine

```ts
export type RouteLine =
  | "career"
  | "romance"
  | "family"
  | "friendship"
  | "health"
  | "financial"
  | "opportunity"
  | "growth"
  | "community";
```

第一批只为事业主线配置主线组合以及 `romance / family` 两条跨线。`friendship` 保留类型但首批权重为 0，待人物引入和至少 2-3 个后续事件形成供给后再开放。`health` 保留给强制或因果事件，不进入本批跨线抽样；`growth` 不作为 `self` 的替代跨线偷渡回来。

### 7.2 事件种子新增字段

```ts
interface LifeEventSeed {
  // existing fields...
  routeLine: RouteLine;
}
```

规则：

- `category="relationship"` 的事件必须进一步声明 `routeLine="romance" | "family" | "friendship"`。
- `category` 继续用于报告统计；relationship 内部的连续限制改用 `routeLine`，避免 romance、family 被同一个 category 机械互斥。
- `routeLine` 只用于线路预算、线路候选池和线路冷却。
- 禁止根据 `tags`、标题或 `semanticFamily` 在运行时猜 `routeLine`。

### 7.3 事业主线策略

```ts
interface LineMixPolicy {
  mainLineShare: number;
  crossLineShare: number;
  mainPortfolio: Partial<Record<RouteLine, number>>;
  crossLineWeights: Partial<Record<RouteLine, number>>;
  maxConsecutiveCrossLineNodes: number;
  maxEligibleMainNodesWithoutCrossLine: number;
  unavailableCrossLineFallback: "return_to_main";
}

export const CAREER_LINE_MIX_POLICY: LineMixPolicy = {
  mainLineShare: 0.75,
  crossLineShare: 0.25,
  mainPortfolio: {
    career: 0.65,
    financial: 0.20,
    opportunity: 0.15
  },
  crossLineWeights: {
    romance: 0.65,
    family: 0.35
  },
  maxConsecutiveCrossLineNodes: 2,
  maxEligibleMainNodesWithoutCrossLine: 10,
  unavailableCrossLineFallback: "return_to_main"
};
```

`mainPortfolio` 表示事业主线拥有的事件组合，不把所有 `financial` 或 `opportunity` 事件改名为 career。事件仍需按真实语义标注 `routeLine`；只有与当前事业 DirectionArc 有直接关系的 financial / opportunity 事件才进入该组合。债务确定性入口继续走强制优先级。

目标占全部普通节点：

| 线路 | 目标占比 |
|---|---:|
| 事业主线组合 | 75% |
| 爱情 | 16.25% |
| 家庭 | 8.75% |
| 友情（首批关闭） | 0% |

### 7.4 线路选择规则

```ts
interface LineSelectionResult {
  mainLine: RouteLine;
  selectedLine: RouteLine;
  selectionKind: "main" | "cross";
  policyId: string;
  randomSample: number;
  fallbackReason?: string;
}
```

- 线路、NarrativeMode 和具体事件三个抽取层都必须使用命名随机槽，不得再直接读取 `Math.random()`：

```ts
interface SelectionEntropy {
  sample(slot: "route_line" | "cross_line" | "narrative_mode" | "event_pick"): number;
}
```

每个槽位由 simulation seed、branch fingerprint、node index 和 slot 稳定派生。新增随机步骤不得改变其他槽位的结果。
- 若最近已经连续出现两个跨线节点，本轮优先主线。
- 若最近十个“有跨线候选的普通节点”均由主线拥有，本轮强制选择一个可用跨线，避免极端长空窗，同时不持续抬高 25% 的目标均值。
- 强制防饿死只在存在合格跨线候选时执行，不得为满足比例而制造父母或伴侣事实。
- `eventMeta` 必须保存 `routeLine`、`selectionKind` 和 `policyId`，以便验收而不从正文反推。

### 7.5 跨线候选不可用时的回退

跨线权重表达绝对产品预算，不能把不可用的爱情份额无限转移给家庭，导致父母再次压屏。

回退顺序：

1. 在本轮选中的跨线内寻找其他 NarrativeMode 的合格事件；
2. 若该线没有安全候选，直接回到事业主线组合或普通 `null event`；
3. 记录 `fallbackReason="selected_cross_line_unavailable"`。

首批禁止把不可用的 romance 预算转移给 family，也禁止用父母线补偿友情空池。

用户明确关闭爱情方向时，未使用的爱情份额回到主线，不自动放大父母或友情份额。

## 8. 父母线激活

### 8.1 三个事实必须分离

```text
父母存在
  != 父母线已激活
  != 父母对当前议题施压或反对
```

### 8.2 可激活来源

只有以下来源可以激活父母线：

```ts
type FamilyActivationSource =
  | "user_input"
  | "user_answer"
  | "accepted_choice"
  | "accepted_event_outcome";
```

并且证据必须显式指向父母角色，例如父母、父亲、母亲、爸爸、妈妈。单独出现“家庭、家里、老家、稳定、现实压力”不构成父母线激活证据。

禁止来源：

- 模型生成的正文；
- 未被用户选择的 A/B/C 选项；
- 模型 suggestions 中用户未采用的回答；
- background thread；
- 仅靠年龄、文化或社会常识的推测。

### 8.3 激活判定

```ts
function canActivateParentLine(evidence: RelationshipEvidence): boolean {
  return PARENT_ACTIVATION_SOURCES.has(evidence.source)
    && evidence.accepted === true
    && containsExplicitParentReference(evidence.text);
}
```

补充规则：

- 用户填写“父母”时，可以确认父母群体存在，但不得假定父亲和母亲意见相同。
- 只有材料分别提及父亲或母亲时，才把议题立场写到对应人物。
- 暂时无法区分具体父母时，使用 `parent_unspecified` 关系主体，不复制同一立场到父亲和母亲。
- 用户选择涉及父母的选项，只确认“用户决定让父母参与或处理父母事项”；不得同时假定父母的回应。

范围边界：`routeLine="family"` 是家庭总线路；本批可信激活和结构化 stance 只覆盖 parent 子域。子女、祖父母、兄弟姐妹继续读取已有可靠事实，但不适用 `ParentTopicStance`，也不得被父母专用规则自动激活。后续成员类型另立状态，不在本批扩展。

## 9. 父母关系权威状态

### 9.1 数据结构

```ts
type ParentRole = "father" | "mother" | "parent_unspecified";

interface FamilyRelationshipState {
  id: string;
  participantPersonId?: string;
  role: ParentRole;
  activation: "active" | "distant" | "ended";
  contact: "unknown" | "frequent" | "occasional" | "rare" | "distant";
  emotionalSupport: "unknown" | "supportive" | "mixed" | "limited";
  practicalSupport: "unknown" | "available" | "conditional" | "unavailable";
  autonomyRespect: "unknown" | "high" | "mixed" | "low";
  conflictIntensity: "unknown" | "low" | "moderate" | "high";
  topicStances: ParentTopicStance[];
  revision: number;
}

interface ParentTopicStance {
  id: string;
  topic:
    | "career_change"
    | "entrepreneurship"
    | "romance"
    | "marriage"
    | "relocation"
    | "finance"
    | "caregiving";
  stance:
    | "supportive"
    | "conditionally_supportive"
    | "concerned_but_respectful"
    | "neutral"
    | "opposed"
    | "unknown";
  reasons: string[];
  effectiveFromAgeInMonths: number;
  evidence: RelationshipEvidenceRef[];
  source: "user_fact" | "accepted_history";
  confidence: number;
}
```

### 9.2 单写者

- `FamilyRelationshipState` 只能由 family relationship reducer 写入。
- Profile 和六段摘要只读取并聚合，不能反向写入。
- 模型可以返回统一 `RelationshipProposal` 中的 family 变体，不能直接返回最终状态。
- Proposal 必须绑定 `sourceOutcomeId`、正文 evidence、主体和 topic。
- 未被用户选择的 option 不能形成 Proposal。
- accepted choice 只授权提交该选择真实导致的变化，不能顺带覆盖父母长期性格。

### 9.3 从行为更新，不从形容词更新

允许的证据映射示例：

| 已接受事实 | 可更新状态 |
|---|---|
| 父母听完计划后明确尊重最终决定 | 对应 topic=`concerned_but_respectful` 或 `supportive`；可提议 `autonomyRespect=high` |
| 母亲明确提供临时住房 | `practicalSupport=available` |
| 父亲表达收入担忧但没有阻止 | topic=`concerned_but_respectful`，不得写 `opposed` |
| 明确要求放弃并以撤回支持相威胁 | topic=`opposed`；一次事件最多将 `autonomyRespect` 提议为 `mixed` |
| 连续多个已接受事件跨议题越过边界 | 才可将 `autonomyRespect` 更新为 `low` |
| 已确认固定医疗转账或照护安排 | 建立 financial connection / caregiving responsibility，不自动推出情感压力 |

禁止规则：

- 一次担忧不能生成“一贯保守”；
- 一次争吵不能生成“控制型家庭”；
- 一次支持不能生成“无条件支持”；
- 经济上无法帮助不能生成“情感上不支持”；
- 父母双方不能因同一句“父母”获得完全相同的个人立场。

## 10. 父母事件供给

### 10.1 未知关系默认事件池

父母线已激活但关系状态未知时，只开放观察和普通互动事件：

```ts
const UNKNOWN_FAMILY_EVENT_WEIGHTS = {
  ordinary_contact: 0.40,
  support_exchange: 0.30,
  neutral_information: 0.20,
  value_difference: 0.10
};
```

`direct_pressure` 不属于未知默认池。它必须先有明确压力证据，不能通过 5% 随机概率创造父母反对。

### 10.2 第一批家庭事件

建议新增或重写：

1. `family_ordinary_contact`
   - 日常通话、见面或分享近况；
   - 不预设父母支持或反对；
   - 选择围绕分享程度、参与边界和联系安排。
2. `family_support_exchange`
   - 讨论双方实际能提供的情绪、信息、住房、金钱或时间支持；
   - “无法提供某类支持”不是负面人格。
3. `family_value_difference`
   - 只有已经存在具体议题差异时可用；
   - 担忧、条件性支持、尊重决定和明确反对必须区分。
4. `relationship_family_obligation_pull`
   - 从默认首发家庭事件池移除；
   - 仅在已确认请求、照护、固定经济连接或越界压力存在时 eligible。

### 10.3 压力事件门槛

以下至少一项为真，家庭压力事件才可进入候选池：

- 用户明确陈述父母反对或施压；
- 已接受事件中父母提出具体请求；
- 权威状态存在照护责任；
- 权威财务账本存在家庭支持支出或共同义务；
- 同一父母主体已有与当前 topic 对应的 `opposed`；
- 已接受历史中存在重复越界证据。

“资源压力”“家庭”“老家”这些宽泛关键词不得单独满足门槛。

## 11. 爱情形成生命周期

### 11.1 关系阶段

扩展 `RelationshipState.stage`：

```ts
type RomanticRelationshipStage =
  | "acquaintance"
  | "exploring"
  | "dating"
  | "cohabiting"
  | "married"
  | "separated"
  | "divorced"
  | "widowed";
```

语义：

| stage | 含义 | 是否通过 `confirmed_romantic_connection` | 是否通过 `confirmed_partner` |
|---|---|---:|---:|
| `acquaintance` | 已认识但未表达持续浪漫探索 | 否 | 否 |
| `exploring` | 双方保持联系，关系可能发展 | 是 | 否 |
| `dating` | 双方明确开始交往 | 是 | 是 |
| `cohabiting` / `married` | 稳定伴侣阶段 | 是 | 是 |
| `separated` / `divorced` / `widowed`，或 status=`ended` | 当前关系不再有效 | 否 | 否 |

`stage` 只表达发展阶段；`status` 只表达关系当前是否继续。新写入禁止再使用旧 `stage="active" | "distant" | "ended"`。`status="active" | "strained"` 均表示关系仍在继续；`distant` 是否仍属进行中必须由迁移规则显式判定，不能静默猜测。

### 11.2 门槛定义

新增：

```ts
type RequiredContextKey =
  | ExistingKeys
  | "no_confirmed_partner"
  | "no_active_romantic_connection"
  | "confirmed_romantic_connection";
```

判定必须优先读取权威 `RelationshipState`：

```ts
function hasConfirmedRomanticConnection(world: WorldStateSnapshot): boolean {
  return world.relationships?.some((relationship) =>
    relationship.type === "romantic"
    && ["active", "strained"].includes(relationship.status)
    && ["exploring", "dating", "cohabiting", "married"].includes(relationship.stage || "")
    && relationship.confidence >= 0.75
  ) ?? false;
}

function hasConfirmedPartner(world: WorldStateSnapshot): boolean {
  return world.relationships?.some((relationship) =>
    relationship.type === "romantic"
    && ["active", "strained"].includes(relationship.status)
    && ["dating", "cohabiting", "married"].includes(relationship.stage || "")
    && relationship.confidence >= 0.75
  ) ?? false;
}

function hasNoActiveRomanticConnection(world: WorldStateSnapshot): boolean {
  return !(world.relationships || []).some((relationship) =>
    relationship.type === "romantic"
    && ["active", "strained"].includes(relationship.status)
    && ["exploring", "dating", "cohabiting", "married"].includes(relationship.stage || "")
  );
}
```

兼容期内，用户初始材料明确写有现任伴侣、已婚或正在恋爱时，可以初始化相应 `RelationshipState`。兼容正则不能继续作为长期第二事实源。

### 11.3 禁止的历史捷径

禁止实现：

```ts
recentHistoryHasFormationEvent
  && selectedChoiceContainsContinue
  => confirmed_partner = true;
```

原因：

- “继续了解”不等于正式伴侣；
- N 节点窗口过期会让关系消失；
- 无法稳定绑定具体人物；
- 旧形成事件可能在拒绝或结束后继续误命中；
- 它会绕过 relationship reducer，形成第二写入者。

历史条件可以用于语义去重，但不得决定关系是否仍存在或能否继续。形成后续事件必须读取权威 stage、status 和 `effectiveFromAgeInMonths`。

### 11.4 RelationshipProgression 权威状态

`RelationshipState` 增加可选生命周期状态：

```ts
type RelationshipCheckpointKind =
  | "exploration_review"
  | "commitment_review";

interface RelationshipProgressionState {
  policyId:
    | "romance_exploration_v1"
    | "romance_commitment_v1";
  checkpointKind: RelationshipCheckpointKind;
  startedAtAgeInMonths: number;
  eligibleAtAgeInMonths: number;
  dueAtAgeInMonths: number;
  maxAtAgeInMonths: number;
  reviewCount: number;
  lastReviewAtAgeInMonths?: number;
  lifecycleStatus: "active" | "resolved";
}

interface RelationshipState {
  // existing fields...
  progression?: RelationshipProgressionState;
}

type RelationshipCheckpointStatus =
  | "waiting"
  | "eligible"
  | "due"
  | "overdue"
  | "resolved";
```

所有权规则：

- `RelationshipProgressionState` 只能由 relationship reducer 根据 Accepted Outcome 创建、更新或清除；
- 模型不得填写、修改或建议具体月份；
- 调度器和时间轴只读取 progression，不直接改写 relationship；
- `waiting | eligible | due | overdue` 必须由当前权威年龄和三个时间戳纯函数派生，禁止多个模块各自更新一个会漂移的存储状态；
- 派生的 checkpoint status 只表达调度义务，不等于关系阶段已经变化；
- checkpoint 到期或超期不得在后台自动把 relationship 改为 `dating`、`ended`、`cohabiting` 或 `married`；
- checkpoint 被强制事件推迟时，原 `dueAt/maxAt` 与 overdue 原因必须保留。

```ts
function deriveRelationshipCheckpointStatus(
  progression: RelationshipProgressionState,
  currentAgeInMonths: number
): RelationshipCheckpointStatus {
  if (progression.lifecycleStatus === "resolved") return "resolved";
  if (currentAgeInMonths > progression.maxAtAgeInMonths) return "overdue";
  if (currentAgeInMonths >= progression.dueAtAgeInMonths) return "due";
  if (currentAgeInMonths >= progression.eligibleAtAgeInMonths) return "eligible";
  return "waiting";
}
```

### 11.5 探索阶段时间策略

第一版 `romance_exploration_v1`：

```ts
const ROMANCE_EXPLORATION_POLICY = {
  firstReview: {
    eligibleAfterMonths: 3,
    dueAfterMonths: 12,
    maxAfterMonths: 18
  },
  slowReview: {
    eligibleAfterMonths: 6,
    dueAfterMonths: 12,
    maxAfterMonths: 18
  },
  maximumReviewCount: 2,
  maximumTotalExplorationMonths: 36
} as const;
```

语义：

| 已探索时间 | 调度行为 |
|---|---|
| 0–3 个月 | clarification 不 eligible |
| 3–6 个月 | 进入普通 romance 候选池，权重乘数 1.5 |
| 6–9 个月 | 权重乘数 3 |
| 9–12 个月 | 权重乘数 6 |
| 12–18 个月 | 标记 `due`，进入关系因果跟进队列 |
| 超过 18 个月 | 标记 `overdue`，下一安全决策节点必须处理 |
| 总探索超过 36 个月 | 必须进入探索收束，不再提供无限“继续慢慢了解” |

这里的权重只作用于已经选定的 romance 线路内，不改变事业普通节点的 75/25 线路预算。达到 `dueAt` 后不再依赖普通 romance 抽样；达到 `maxAt` 后不得被普通节点继续越过。

`continue_slow_exploration` 可以重新创建下一次 review，但必须：

- `reviewCount += 1`；
- 从本次 Accepted Outcome 的有效月份重新计算下一窗口；
- `maxAtAgeInMonths` 不得超过初次 exploration 开始后的 36 个月；
- 达到 `maximumReviewCount` 或总探索上限后，下一收束节点只允许“正式交往、回到普通关系、结束浪漫探索”等可终结悬挂状态的 outcome。

### 11.6 探索状态自然衰减但不静默结束

探索进入 24–36 个月区间仍未确认关系，说明关系已经进入现实衰减区；36 个月是硬上限，不是新的随机等待窗口。系统必须生成一个可选择的收束节点，而不是让 `exploring` 永久存活。

收束节点至少提供：

- `begin_mutual_dating`：双方明确开始交往；
- `return_to_acquaintance`：保留人物，将浪漫探索结束并回到普通认识；
- `end_romantic_exploration`：明确结束这段探索。

“渐行渐远”可以作为 `return_to_acquaintance` 或 `end_romantic_exploration` 的叙事表达，但状态变化仍然只能在用户选中 outcome 后提交。若收束节点生成失败：

1. 只做一次结构化局部 repair；
2. 仍失败时允许改派一个普通安全节点；
3. progression 时间戳保持不变，派生 status 继续为 `overdue`；
4. 下一安全节点继续补回，不得清除或重置等待时长。

### 11.7 正式交往后的承诺 checkpoint

`begin_mutual_dating` 提交 `stage="dating"` 时，reducer 同时创建 `romance_commitment_v1`：

```ts
const ROMANCE_COMMITMENT_POLICY = {
  eligibleAfterMonths: 12,
  dueAfterMonths: 24,
  maxAfterMonths: 48,
  maximumDelayCount: 1,
  maximumTotalMonths: 60
} as const;
```

承诺 checkpoint 表示“关系需要讨论长期安排”，不表示必须结婚。事件选项可以覆盖：

- 形成共同生活或长期计划；
- 继续交往并给出明确复核条件；
- 维持稳定伴侣但不结婚；
- 讨论同居或婚姻；
- 重新评估或结束关系。

只有明确授权 `cohabiting` 或 `married` 的 Accepted Outcome 才能推进到对应 stage。`relationship_material_commitment_test` 第一版从“最近正文命中同居/承诺关键词”迁移为“active dating relationship + commitment checkpoint eligible”；正文关键词只用于渲染素材和去重，不再拥有事件资格权。

### 11.8 时间轴边界

只提高事件权重不能防止普通节点一次跨过数年。时间轴必须读取所有 active relationship progression：

```ts
nextTimelineBoundaryAgeInMonths = Math.min(
  nextUserMilestoneAgeInMonths,
  nextPressureArcBoundaryAgeInMonths,
  earliestRelationshipCheckpointMaxAtAgeInMonths
);
```

规则：

- `eligibleAt` 和 `dueAt` 不必硬截断每一个普通节点；
- `maxAt` 必须成为硬时间边界；
- 当前年龄已超过 `maxAt` 时，下一安全节点必须先处理 overdue checkpoint；
- PressureArc、健康危机或其他强制因果事件可以暂时推迟关系 checkpoint，但时间推进仍必须读取关系边界，不得再通过 `nextMilestoneAgeInMonths=undefined` 绕开 `maxAt`；
- 强制事件的目标年龄必须钳制到最近的关系边界；到达边界后，只允许独立重大危机继续优先，且必须记录 deferral；
- 正在运行的 PressureArc 不得被普通关系节点后台结束或推进；需要插入关系恢复节点时，使用显式 `interleave` no-op：保留 foreground arc，不增加 checkpointCount，不改变 phase/status；
- overdue checkpoint 或同一 checkpoint 连续 deferred 达到 3 个节点时进入 `mustRestore`；下一节点必须直接以 `interleave` 插入，即使当前 PressureArc 尚未进入相位间隙，也不得再消费第 4 个 continuation；
- 当前年龄已经等于 `maxAt` 时，下一节点就是满足 `dispatchAge <= maxAt + 1` 的最后派发时隙；除独立重大危机外，即使 PressureArc 尚未进入普通相位间隙，也必须用同一 `interleave` no-op 插入 checkpoint，不能再消费一次 continuation 后才恢复；
- 强制弧 resolve 后的第一个安全节点必须恢复 `mustRestore` checkpoint；
- 结局或死亡可以关闭未完成 checkpoint，但必须记录明确 closure reason，不能伪装成用户主动结束关系。

调度优先级固定为：

```text
独立重大危机
→ 当前 PressureArc continuation
→ mustRestore relationship follow-up（连续 deferred 达到 3 时可打断当前相位）
→ 普通 due relationship follow-up
→ 新 PressureArc / 普通健康升级
→ 普通事件
```

其中“当前 PressureArc continuation”在派发前必须先检查 mustRestore；命中时本节点改为
relationship interleave，原 PressureArc 从下一节点继续。浏览器 E2E override 只属于测试设施，
不改变生产优先级语义。`currentAgeInMonths >= maxAtAgeInMonths` 是独立于 mustRestore 的硬截止
保护：它不改写 `mustRestore = overdue || consecutiveDeferredNodes >= 3` 的定义，但会在最后派发
时隙直接触发 interleave。

### 11.9 Starvation-free deferral 观测合同

deferral 不写入 `RelationshipState`，也不要求旧存档迁移。调度器从历史节点派生：

```ts
checkpointKey = [
  relationship.id,
  progression.checkpointKind,
  progression.startedAtAgeInMonths,
  progression.dueAtAgeInMonths,
  progression.maxAtAgeInMonths
].join(":");

mustRestore = checkpointStatus === "overdue"
  || consecutiveDeferredNodes >= 3;
```

`consecutiveDeferredNodes` 从最新历史节点向前扫描，只累计同一 `checkpointKey` 且
`relationshipCheckpointDeferred=true` 的连续节点。新字段缺失的旧存档从该节点的
`worldStateSnapshot` 回退派生 checkpointKey。

EventMeta 增加可选观测字段：

```ts
relationshipCheckpointKey?: string;
relationshipCheckpointDeferredCount?: number;
relationshipCheckpointMustRestore?: boolean;
pressureArcInterleaved?: boolean;
```

节点数和月份必须分别验收：

- `consecutiveDeferredNodes <= 3`；
- checkpoint 实际派发年龄不得超过自身 `maxAtAgeInMonths + 1`；
- exploration 总时长仍不得超过 `startedAt + 36`（允许派发节点本身的 1 个月决策跨度）；
- commitment 使用自己的 48/60 个月合同，不得套用 exploration 的 36 个月上限。

## 12. 爱情形成事件

### 12.1 事件一：新的关系入口

```ts
{
  id: "romance_new_connection",
  category: "relationship",
  routeLine: "romance",
  narrativeMode: "crossroads_opportunity",
  semanticFamily: "romance_formation",
  requiredContextGroups: [["no_active_romantic_connection"]],
  hardAgeConstraint: { minAge: 18, basis: "legal" },
  ageAffinityPolicyId: "romance_formation_age_v1",
  cooldown: 2,
  baseProbability: 0.65,
  intent: {
    type: "romance_new_connection",
    meaning: "正常生活场景中出现一个可以继续了解的人，是否发展由用户决定。",
    tensionAxes: [
      "保持现有节奏 vs 为新关系留出空间",
      "好奇与靠近 vs 保护边界",
      "现实接触 vs 过早投射"
    ],
    allowedOutcomes: [
      "continue_getting_to_know",
      "keep_as_acquaintance",
      "decline_romantic_direction"
    ],
    emotionalTone: "opportunity"
  }
}
```

Render 约束：

- 不生成命中注定、完美对象或立刻相爱；
- 不默认对方已经表达浪漫兴趣；
- 不默认对象是同事，事业场景只能提供接触面；
- 三个选项都不能要求放弃事业主线；
- 模型只返回候选人物展示资料；稳定 `candidateKey` 由代码根据 simulation seed、branch fingerprint、event id、node index 和 ordinal 派生；
- 本节点必须允许明确拒绝爱情方向；
- 用户连续拒绝形成事件后进入 romance cooldown / opt-down，不能反复投放。

`romance_formation_age_v1` 只调整新相遇的软权重：

| 年龄 | 默认乘数 |
|---|---:|
| 18–21 | 1.15 |
| 22–29 | 1.25 |
| 30–35 | 1.00 |
| 36–45 | 0.75 |
| 46–60 | 0.45 |
| 60+ | 0.25 |

边界：

- 18 岁以上永远保留候选资格，年龄不得成为硬排除条件；
- 用户明确选择爱情主线、主动寻找伴侣、离异或丧偶后明确重新开放关系时，乘数不得低于 1；18–29 岁的自然相遇提升仍保留；
- 用户初始材料已有 active relationship 时不走新相遇年龄权重，而读取权威关系；
- 当前仅有单一 `preferredRange` 的年龄接口无法表达上述分段曲线；实现时必须增加独立的分段软权重 resolver，不得借用 hard min/max 拼接出等价的硬门槛；
- 该策略最后实施，并在更大样本校准后才能冻结具体乘数，不能用五条 R4 路线直接拟合。

为防止爱情形成线在事业/教育长路线中只有理论候选、用户实际永远看不到，增加一次性形成机会保底：

- 仅适用于 `career` 主线和 `education` 回溯路线；
- 从回溯起点累计至少 24 个月，且历史中从未展示过 `romance_new_connection` 时，在下一个安全普通节点派发一次；
- 已展示即清账，用户选择继续了解、保持普通认识或明确拒绝都不得再次触发该保底；
- active romance、关系关闭/冷却、最近重大危机和事业线连续跨线已达上限时不得强插，条件解除后继续保留欠付机会；
- 该规则保证的是一次自然相遇选择，不保证恋爱、确认、承诺或结婚。

### 12.2 事件二：关系确认窗口

```ts
{
  id: "romance_connection_clarification",
  category: "relationship",
  routeLine: "romance",
  narrativeMode: "crossroads_opportunity",
  semanticFamily: "romance_formation_clarification",
  requiredContextGroups: [["confirmed_romantic_connection"]],
  cooldown: 8,
  trigger: {
    eligibility: (_attribs, _userData, _age, history) =>
      hasEligibleExplorationCheckpoint(history)
  },
  intent: {
    type: "romance_connection_clarification",
    meaning: "持续接触后，双方需要确认是开始交往、继续慢慢了解，还是停止浪漫探索。",
    tensionAxes: [
      "关系明确 vs 保持开放",
      "继续投入 vs 及时止损",
      "亲密期待 vs 现实节奏"
    ],
    allowedOutcomes: [
      "begin_mutual_dating",
      "continue_slow_exploration",
      "end_romantic_exploration"
    ],
    emotionalTone: "crossroads"
  }
}
```

只有 `begin_mutual_dating` 可以将阶段推进为 `dating`，从而满足 `confirmed_partner`。

clarification 的候选权重、到期提升和最长等待必须读取 `RelationshipState.progression`，不得重新用历史节点数量推算。若模型无法生成合格 clarification，沿用一次局部 repair、普通安全节点 fallback 和 checkpoint reschedule；fallback 不得被计为 clarification 已实现。

### 12.3 事件三：探索收束窗口

达到 `maximumReviewCount` 或 `maximumTotalExplorationMonths` 后，不再复用包含无限慢速探索的普通 clarification 合同，而是调度：

```ts
{
  id: "romance_exploration_resolution",
  category: "relationship",
  routeLine: "romance",
  requiredContextGroups: [["confirmed_romantic_connection"]],
  trigger: {
    eligibility: (_attribs, _userData, _age, history) =>
      hasOverdueExplorationResolution(history)
  },
  intent: {
    type: "romance_exploration_resolution",
    meaning: "长期未确认的浪漫探索需要形成明确、可持续的关系边界。",
    allowedOutcomes: [
      "begin_mutual_dating",
      "return_to_acquaintance",
      "end_romantic_exploration"
    ]
  }
}
```

该事件只能来自 lifecycle queue，不能作为普通随机新剧情投放。三个 outcome 均由代码生成 Proposal；`return_to_acquaintance` 和 `end_romantic_exploration` 都保留 person，仅结束 active romantic relationship。

### 12.4 事件四：关系承诺窗口

`relationship_material_commitment_test` 迁移为状态驱动：

```ts
{
  id: "relationship_material_commitment_test",
  category: "relationship",
  routeLine: "romance",
  requiredContextGroups: [["confirmed_partner"]],
  trigger: {
    eligibility: (_attribs, _userData, _age, history) =>
      hasEligibleCommitmentCheckpoint(history)
  },
  intent: {
    type: "relationship_material_commitment_test",
    meaning: "正式交往一段时间后，双方需要讨论长期安排、边界与现实责任。",
    allowedOutcomes: [
      "make_shared_commitment_plan",
      "delay_with_clear_conditions",
      "reassess_relationship_fit"
    ]
  }
}
```

第一版保留现有三个行动原语，但必须满足：

- `make_shared_commitment_plan` 只确认存在共同计划并解决本次 commitment checkpoint；没有更具体的新事实时 stage 保持 `dating`，不自动等同于结婚；
- `delay_with_clear_conditions` 最多更新一次 checkpoint，下一 review 必须在 6–12 个月内发生，总时长不得超过开始交往后的 60 个月；
- 达到 delay/总时长上限后，不再提供无限延后，必须在“形成共同计划、维持 dating 但结束本轮承诺追问、重新评估或结束关系”之间形成明确结果；
- `reassess_relationship_fit` 只有在用户选择后才能将关系改为 strained 或 ended；
- 若需要推进 `cohabiting` 或 `married`，必须由更具体、明确授权该 stage 的 outcome 和 Proposal 完成；
- 事件资格不再依赖最近八个节点正文是否出现“同居、承诺、长期计划”等词。

第一次选择 `delay_with_clear_conditions` 后，下一次 checkpoint 使用收束合同 `relationship_commitment_resolution`，不再复用仍包含 delay 的普通承诺合同。第一版固定 outcomes 为：

- `make_shared_commitment_plan`；
- `maintain_committed_partnership_without_marriage`；
- `reassess_relationship_fit`。

三个 outcome 均结束本轮 commitment progression；维持稳定伴侣但不结婚仍保持 `stage="dating"`，不得被解释为关系失败。这样 `maximumDelayCount=1` 由事件合同保证，而不是在用户第二次选择延后后静默丢弃 checkpoint。

### 12.5 现有爱情事件迁移

| 事件类型 | 新门槛 |
|---|---|
| 新相遇、重逢入口 | `no_active_romantic_connection` |
| 再次接触、慢慢了解、关系确认 | active `exploring` + 对应 progression eligible/due |
| 正式承诺、共同生活、共同财务 | active `dating/cohabiting/married` + 对应 progression 或明确已接受事实 |
| 信任修复 | 对应的 active romantic relationship + 已确认裂纹证据 |
| 分手、放手、重新定向 | 对应关系仍可定位，且已有持续不匹配或结束提议 |
| 稳定陪伴 | `confirmed_partner`，不得由普通 family 代替爱情陪伴 |

## 13. 人物与关系提交协议

### 13.1 选择结果存档

新历史必须直接保存实际选项和 outcome，不能继续依赖选项文本反查：

```ts
interface HistoryItem {
  // existing fields...
  selectedChoiceId?: string;
  selectedEventOutcomeId?: string;
}
```

`createHistoryItemFromNode()` 在用户选择时写入两者。旧历史允许从 `selectedChoice + choices[]` 做一次兼容恢复；新历史缺失 `selectedEventOutcomeId` 时不得提交需要 outcome 授权的关系变化。`EventHistoryCondition` 同步增加 `selected_outcome_count`，但该条件只用于行为历史统计，不用于替代权威 relationship stage。

### 13.2 Proposal

形成事件可以返回候选 Proposal，但模型不能直接写入人物或关系：

```ts
interface RelationshipProposalEnvelope {
  id: string;
  sourceOutcomeId: string;
  evidence: string;
}

interface PersonIntroductionProposal extends RelationshipProposalEnvelope {
  displayName?: string;
  candidateOrdinal: number;
}

interface RomanticRelationshipTransitionProposal extends RelationshipProposalEnvelope {
  relationshipId?: string;
  fromStage?: RomanticRelationshipStage;
  toStage?: RomanticRelationshipStage;
  toStatus?: "active" | "strained" | "distant" | "ended";
}

interface FamilyActivationProposal extends RelationshipProposalEnvelope {
  parentRole: ParentRole;
}

interface ParentTopicStanceProposal extends RelationshipProposalEnvelope {
  parentRole: ParentRole;
  topic: ParentTopicStance["topic"];
  stance: ParentTopicStance["stance"];
  reasons: string[];
}

type RelationshipProposal =
  | PersonIntroductionProposal
  | RomanticRelationshipTransitionProposal
  | FamilyActivationProposal
  | ParentTopicStanceProposal;
```

`candidateKey`、阶段迁移和 confidence 不由模型自由填写。代码按事件和实际 outcome 使用固定映射：

```ts
const ROMANCE_OUTCOME_TRANSITIONS = {
  continue_getting_to_know: {
    toStage: "exploring",
    progressionPolicyId: "romance_exploration_v1",
    confidence: 0.90
  },
  begin_mutual_dating: {
    toStage: "dating",
    progressionPolicyId: "romance_commitment_v1",
    confidence: 0.95
  },
  continue_slow_exploration: {
    toStage: "exploring",
    progressionPolicyId: "romance_exploration_v1",
    incrementReviewCount: true,
    confidence: 0.90
  },
  return_to_acquaintance: {
    toStage: "acquaintance",
    toStatus: "ended",
    clearProgression: true,
    confidence: 0.95
  },
  end_romantic_exploration: {
    toStatus: "ended",
    clearProgression: true,
    confidence: 0.95
  }
} as const;
```

所有 checkpoint 月份由 reducer 根据 `progressionPolicyId` 和 Accepted Event 的有效时间计算，Proposal 不携带自由月份。

### 13.3 Validator

Validator 必须确认：

- `sourceOutcomeId` 等于用户实际选择的事件 outcome；
- evidence 为本节点正文已经发生的原句；
- 代码从稳定输入生成 `candidateKey`，后续 Proposal 必须引用权威 relationship / person，不能让模型重新命名身份；
- `continue_getting_to_know` 最多推进到 `exploring`；
- `begin_mutual_dating` 才能推进到 `dating`；
- `continue_slow_exploration` 不得超过 review count 和总探索时长上限；
- `return_to_acquaintance` 保留 person，但结束 active romantic relationship；
- `keep_as_acquaintance` 不创建浪漫关系；
- `decline_romantic_direction` 和 `end_romantic_exploration` 不创建 active relationship；
- 不得在同一人物已有 active romantic relationship 时重复创建第二条 active relationship；
- 第一版整个世界最多只允许一条 `exploring` relationship；
- 不得在用户已明确关闭爱情方向时提交形成关系。
- checkpoint 的 relationship id、stage、reviewCount 和有效月份必须与权威状态一致，旧或重复 checkpoint outcome 必须幂等拒绝。

### 13.4 Accepted Event 与 reducer

```text
PersonIntroductionProposal
  -> validator
  -> AcceptedPersonIntroduction
  -> person reducer / mergeAcceptedPeople

RomanticRelationshipTransitionProposal / FamilyActivationProposal / ParentTopicStanceProposal
  -> validator
  -> AcceptedRelationshipTransition
  -> relationship reducer
```

事务要求：

- `continue_getting_to_know` 需要最小人物身份创建和 `exploring` 关系同时成功，否则整个事务失败；
- 人物使用 `accepted_character` identity namespace 和稳定 `candidateKey`；
- 后续阶段沿用同一个 person id 和 relationship id；
- 人物存在不等于浪漫关系存在；
- 关系结束不删除人物，只将 relationship 标为 ended；
- `continue_getting_to_know`、`continue_slow_exploration` 和 `begin_mutual_dating` 必须在同一 relationship transaction 中创建或更新 progression；
- progression 到期只改变调度状态，不得绕过用户选择提交关系阶段；
- Profile summary 只聚合 accepted relationship，不读取 `activeCharacters` 推断伴侣。

最小人物身份包括 person id、identityKey、可用 displayName、source 和 confidence，必须与关系迁移原子提交；姓名、职业、年龄和背景 enrichment 可以后补。禁止人物创建失败后单独提交关系阶段。提交失败时先进行一次结构化 repair；仍失败则保留上一权威状态并记录 issue，不得生成悬空关系。

## 14. Prompt 边界

### 14.1 跨线事件不劫持主线

事业主线中的爱情、家庭和友情事件必须：

- 保留上一事业选择已经发生的现实后果；
- 不把事业自动写成感情障碍；
- 不要求三个选项都围绕放弃、降薪、搬家或停止工作；
- 至少一个选项允许在不放弃事业方向的情况下处理关系；
- `primaryActivity` 可以继续为 career，但 `eventMeta.routeLine` 表示本轮决策由哪条线拥有；两者语义不得混用。

### 14.2 家庭叙事约束

- 未知父母关系不得默认“稳定最重要”；
- 不得把关心写成反对；
- 不得把无法提供资源写成情感冷漠；
- 未区分父亲和母亲时，不得编造两人一致意见；
- 没有 accepted family fact 时，正文不能为后续节点创造可触发的父母事实。

第一批增加只读审计 issue：`UNSUPPORTED_PARENT_OPPOSITION`、`UNSUPPORTED_PARENT_CONTROL`、`PARENT_CONCERN_MISLABELED_AS_OPPOSITION`。它们先进入 trace、world audit 和测试报告，不直接改写正文；确认误报率可接受后再决定是否触发一次模型 repair。

### 14.3 爱情叙事约束

- 没有确认伴侣时，不得调用承诺、同居、婚姻和共同财务 intent；
- exploring 阶段不得在正文中称“伴侣”；
- 对方的互惠兴趣必须由事件事实或 accepted transition 支撑；
- 形成事件不保证成功，拒绝和保持普通关系都是完整、有效的路线。
- Render 必须从权威状态注入当前 active romantic relationship 的 relationshipId、personId、candidateKey、displayName、stage 和最近已接受互动；模型不得重新生成 candidateKey 或用新人物替换现有人物。

## 15. 兼容与迁移

### 15.1 旧用户输入

- 初始材料明确写“已婚”时迁移为 `married`，明确同居时迁移为 `cohabiting`，明确“正在恋爱、现任伴侣”时迁移为 `dating`。
- 初始材料只写“曾经恋爱、前任、已经分手”时，初始化 ended relationship 或只保留历史事实，不通过 `confirmed_partner`。
- 初始材料只写“对爱情有期待”时，不创建人物或关系。

### 15.2 旧历史

- 不批量从旧正文反推 active partner 或父母立场。
- 若旧 WorldState 已存在可靠 partner person，但缺少 RelationshipState，可迁移为 `dating`，使用 migration source、较低于用户明确事实的 confidence，并记录 migration evidence。
- `userText` 正则只在未完成关系版本迁移的 snapshot 初始化时使用；迁移完成写入版本标记，此后不得再次参与长期资格判断。
- 旧 `relationshipSummary` 只用于展示兼容，不作为事件资格权威。
- 旧 active `exploring` relationship 缺少 progression 时：
  - 能可靠读取 `effectiveFromAgeInMonths`，按该时间初始化 `romance_exploration_v1`；
  - 已超过 36 个月时标记 migration-created overdue checkpoint，但不得自动结束关系；
  - 无可靠开始时间时，以迁移时当前年龄建立 3/12/18 个月窗口，并记录 `startTimeEstimated=true`。
- 旧 active `dating` relationship 缺少 progression 时：
  - 有可靠开始时间则按 `romance_commitment_v1` 初始化；
  - 无可靠开始时间时，不立即生成婚姻压力节点；在迁移后 6–12 个月建立首次 commitment review。
- `cohabiting`、`married`、ended relationship 默认不创建探索 checkpoint；是否需要其他生命周期由后续独立 spec 决定。
- progression schema 必须有独立版本标记，迁移只执行一次。

### 15.3 爱情开放度

```ts
interface RoutePreferenceState {
  routeLine: "romance";
  openness: "open" | "neutral" | "closed";
  refusalCount: number;
  cooldownUntilAgeInMonths?: number;
  source: "user" | "accepted_history";
}
```

连续拒绝形成事件可进入 cooldown 或 `closed`；未使用的爱情份额回到主线。重新开放只能来自用户主动编辑、后续回答明确表达开放，或用户选择重新开放关系方向。冷却自然结束最多从 `closed` 回到 `neutral`，不能自动变为 `open`。

形成事件的两个冷却层必须分工，不能重复封锁同一时间窗口：

- `keep_as_acquaintance` 只表达本次不发展，写入 12 个月 RoutePreference 冷却；
- 第一次 `decline_romantic_direction` 表达明确拒绝，写入 120 个月冷却；
- 第二次明确拒绝写入 240 个月冷却并将 openness 设为 `closed`；
- 事件 ID 自身 cooldown 仅用于避免紧邻节点重复，固定为 2 个普通节点；
- “保持普通认识”不得增加 `refusalCount`，也不得继承明确拒绝的长期冷却。

### 15.4 灰度开关

```ts
interface RelationshipDispatchFeatureFlags {
  enableLineMixPolicy: boolean;
  enableTrustedFamilyActivation: boolean;
  enableRomanceFormationEvents: boolean;
  enableAuthoritativeRelationshipStages: boolean;
  enableRomanceLifecycleScheduling: boolean;
  enableRomanceFormationAgeAffinity: boolean;
}
```

推荐按依赖顺序开启：

1. authoritative relationship stages；
2. romance formation events；
3. romance lifecycle scheduling；
4. trusted family activation；
5. line mix policy；
6. romance formation age affinity。

禁止在线路策略先开启、形成事件和关系提交仍未闭环时提高爱情权重，否则 16.25% 预算会频繁落入不可用候选并回退。

`enableRomanceLifecycleScheduling=false` 只停止新建和提升 checkpoint，不删除已存在 progression；回滚读取时必须保留字段。`enableRomanceFormationAgeAffinity=false` 恢复 18–100 岁软权重 1，不影响最低年龄硬约束。

## 16. 可观测性

每次普通节点记录：

```ts
interface EventSelectionTrace {
  mainLine: RouteLine;
  selectedLine?: RouteLine;
  selectionKind?: "main" | "cross" | "forced" | "relationship_follow_up";
  policyId?: string;
  randomSample?: number;
  candidateIdsBeforeLineFilter: string[];
  candidateIdsAfterLineFilter: string[];
  fallbackReason?: string;
  familyActivationEvidenceIds?: string[];
  romanticRelationshipId?: string;
  relationshipStageBefore?: RomanticRelationshipStage;
  relationshipStageAfter?: RomanticRelationshipStage;
  relationshipCheckpointKind?: RelationshipCheckpointKind;
  relationshipCheckpointStatus?: "waiting" | "eligible" | "due" | "overdue" | "resolved";
  relationshipElapsedMonths?: number;
  relationshipCheckpointWaitMonths?: number;
  relationshipCheckpointDeferred?: boolean;
  relationshipCheckpointDeferralReason?: string;
  relationshipCheckpointFallbackReason?: string;
  relationshipCheckpointRescheduled?: boolean;
  entropySamples?: Partial<Record<"route_line" | "cross_line" | "narrative_mode" | "event_pick", number>>;
}
```

报告必须能区分：

- 线路被抽中但无候选；
- 因 cooldown 被排除；
- 因事实缺失被排除；
- 因用户关闭爱情方向被排除；
- Proposal 生成失败；
- Proposal 校验失败；
- Accepted Event 提交失败。
- checkpoint 仍未 eligible；
- checkpoint 已 eligible 但尚未被普通 romance 抽中；
- checkpoint 因强制事件推迟；
- checkpoint 到期后被提升；
- checkpoint 生成 fallback 后是否重新调度；
- relationship progression 是否超出最大等待或总探索上限。

发布指标必须同时报告：

- `lineDrawRate`：线路被抽中的比例；
- `lineCandidateAvailabilityRate`：抽中时存在安全候选的比例；
- `lineRealizationRate`：最终真正生成该线路事件的比例；
- `lineFallbackRate`：抽中后回退主线的比例及原因；
- forced / override / null event 各自占比。
- `romanceFormationAgeP50/P90`；
- `explorationToFirstReviewMonthsP50/P90/max`；
- `datingToCommitmentReviewMonthsP50/P90/max`；
- `explorationOverdueRate`；
- `explorationNaturalClosureRate`；
- `relationshipCheckpointFallbackRate`；
- `relationshipCheckpointRescheduleFulfillmentRate`；
- `relationshipCheckpointForcedDeferralMonths`。

`FOCUS_CATEGORY_BOOST` 不得参与线路层或跨线份额计算。主线组合使用显式 portfolio weights；具体事件仍需软偏好时，只能在已经选定的 routeLine 内生效。

年龄与关系推进指标必须按以下条件分层，禁止混算：

- 初始无伴侣且 romance openness 为 open/neutral；
- 初始已有伴侣；
- 用户主动拒绝或关闭爱情；
- 离异/丧偶后重新开放；
- 关系主线与非关系主线；
- 形成事件选择继续了解、普通认识或拒绝。

不能把拒绝形成、保持普通认识或已有伴侣路线计入“相遇到确认”的等待分母。

## 17. 实施阶段

### Phase A：权威关系阶段与事务闭环

交付：

- 扩展 `RelationshipState.stage`；
- 清理新写入的 stage/status 语义，并定义旧 `active/distant/ended` stage 迁移；
- 增加 `confirmed_romantic_connection`、`no_confirmed_partner` 和 `no_active_romantic_connection`；
- `HistoryItem` 增加 `selectedChoiceId`、`selectedEventOutcomeId`，eligibility 增加 `selected_outcome_count`；
- 增加 PersonIntroduction / RelationshipTransition Proposal、Validator、Accepted Event；
- 将 accepted person 和 relationship 接入统一 simulation transaction；
- 增加 outcome→stage 确定性映射和代码生成 candidateKey；
- relationship reducer 增加重复 active relationship 与单一 exploring 不变量；
- 初始化和迁移现有明确伴侣事实，并将权威人物/关系上下文注入 Prompt。

停止条件：形成事件结果尚不能可靠写入并在下一节点读取、旧 stage 无法确定迁移、`strained` 关系被误判为不存在、或仍可创建重复 active/exploring 关系时，不进入 Phase B。

### Phase B：爱情形成事件

交付：

- `romance_new_connection`；
- `romance_connection_clarification`；
- 拒绝、慢速探索、正式交往和结束探索的完整状态迁移；
- 形成事件 cooldown、RoutePreferenceState 与连续拒绝后的 opt-down / re-entry。

停止条件：真实或模拟长路线中仍出现“能相遇、不能发展”“继续了解直接结婚”、exploring 因历史窗口过期成为僵尸状态、或同一人物被重新生成时，不进入 Phase C。

### Phase C：父母线可信激活与关系状态

交付：

- `FamilyRelationshipState` 与 reducer；
- 父母激活证据白名单；
- 未知家庭事件池；
- 收紧 `relationship_family_obligation_pull`；
- 父母议题立场 Proposal 和校验。

停止条件：模型正文或未选选项仍能激活父母线、未知父母仍可进入直接压力事件、长路线候选可用率异常下降、family fallback 或 null event 因事件供给不足显著升高时，不进入 Phase D。`phase2LongRoutes.test.ts` 必须作为回归门槛。

### Phase D：75/25 线路调度

交付：

- 为全部存量事件显式标注 `routeLine`，遗漏事件必须在类型或静态测试中失败；
- `LineMixPolicy`；
- 事业 mainPortfolio 与 65/35 跨线权重；
- SelectionEntropy 从 simulationService 透传到 line / mode / event pick，迁移现有 Math.random monkey-patch 测试；
- 防连续与阈值 10 的防饿死规则；
- eventMeta 和 selection trace；
- E2E override、Arc安全continuation和普通调度的统计隔离；
- friendship 首批权重为 0，fallback 回主线；
- relationship 重复限制从 category 迁移到 routeLine；
- `FOCUS_CATEGORY_BOOST` 退出线路层，只允许在已选 routeLine 内保留必要的事件级软偏好。

### Phase E：关系生命周期连续性

按以下内部顺序交付，年龄权重必须最后上线：

1. **E1 progression schema 与迁移**
   - `RelationshipProgressionState`；
   - exploration / commitment policy；
   - 旧 exploring/dating 一次性迁移；
   - feature flags 和版本标记。
2. **E2 reducer 与单写者**
   - `continue_getting_to_know` 原子创建 exploring + first review；
   - `continue_slow_exploration` 更新 reviewCount 和下一窗口；
   - `begin_mutual_dating` 原子推进 dating + commitment review；
   - return/end outcome 清除 progression，但保留人物。
3. **E3 混合调度与时间轴边界**
   - eligible 阶段 romance 池内渐进加权；
   - due 阶段进入因果跟进队列；
   - maxAt 硬时间边界；
   - 历史派生 checkpointKey、连续 deferral 与 mustRestore；
   - 强制事件时间跨度钳制到关系边界；
   - PressureArc 允许 `interleave` no-op；连续 deferred 达到 3 或命中硬截止时无需等待相位间隙，且关系节点不得推进或结束 arc；
   - overdue 或连续 deferred 达到 3 后必达，强制弧结束后第一个安全节点补回；
   - `EventSelectionKind` 显式扩展 `relationship_follow_up`；
   - scheduled follow-up 与普通 75/25 统计隔离。
4. **E4 探索衰减与承诺节点**
   - reviewCount 和 36 个月总上限；
   - `romance_exploration_resolution` 用户可选择的自然收束；
   - `relationship_material_commitment_test` 从正文正则迁移到状态资格。
5. **E5 年龄软权重**
   - `romance_formation_age_v1`；
   - 主动爱情方向、离异/丧偶重新开放等豁免；
   - 大样本校准后再冻结乘数。

停止条件：

- checkpoint 到期仍可能被普通事件无限推迟；
- 普通节点可以跨过 `maxAt` 且没有 deferral 记录；
- 强制节点通过 `nextMilestoneAgeInMonths=undefined` 跨过关系边界；
- 同一 checkpoint 连续 deferred 超过 3 个节点；
- interleave 关系节点增加 PressureArc checkpointCount、切换 phase 或 resolve arc；
- mustRestore 存在时仍可启动新的普通 PressureArc；
- exploring 能超过 36 个月并继续无限选择慢速探索；
- checkpoint 到期会后台静默改变或结束关系；
- fallback、强制事件或回滚会清除 progression；
- scheduled follow-up 被错误计入 75/25；
- 年龄权重成为 18 岁以上的硬排除条件。

## 18. 测试与验收

### 18.1 R0：类型与纯函数

- 所有 relationship 事件都有合法 `routeLine`。
- `crossLineWeights` 非负且总和为 1。
- `mainLineShare + crossLineShare = 1`。
- forced event 不进入普通节点分母。
- 同一 seed、branch、node index 得到相同线路结果。
- 同一 seed、branch、node index 得到相同 NarrativeMode 和具体事件结果。
- `continue_getting_to_know` 不能产生 `dating`。
- `begin_mutual_dating` 可以从 `exploring` 产生 `dating`。
- ended relationship 不通过两个确认门槛。
- `strained` 且 stage 为 dating/cohabiting/married 的关系仍通过 `confirmed_partner`。
- 新历史保存 `selectedChoiceId` 和 `selectedEventOutcomeId`；旧历史只有兼容恢复可文本反查。
- `continue_getting_to_know` 创建 first exploration checkpoint，月份只由 policy + accepted time 决定。
- `waiting/eligible/due/overdue` 由当前时间和 progression 纯函数派生，不作为可漂移的存储状态写入。
- `eligible/due/overdue` 不直接改变 relationship stage/status。
- `continue_slow_exploration` 增加 reviewCount，不能越过 36 个月总上限。
- `begin_mutual_dating` 清除 exploration review 并创建 commitment review。
- maxAt 进入 timeline boundary；未到 maxAt 不应无条件硬插节点。
- `relationship_follow_up` 是合法 `EventSelectionKind`，且不进入普通 75/25 分母。
- 18 岁以上所有年龄仍可通过新相遇硬资格。

### 18.2 R1：父母激活合同

必须覆盖：

| 输入 | 期望 |
|---|---|
| 用户填写“父母希望我留在本地” | 激活 parent line |
| 用户回答“每月给父母2000元” | 激活 parent line |
| 用户选择“先和父母讨论搬家” | 接受结果后激活 |
| 模型正文临时写“父母可能担心” | 不激活 |
| 未选择选项写“听从父母” | 不激活 |
| 用户只写“回老家发展” | 不激活 |
| 用户只写“家庭现金流紧张” | 不激活 parent line |

额外断言：未知父母关系时，`relationship_family_obligation_pull` 不 eligible。

### 18.3 R1：爱情形成合同

必须覆盖：

1. 无 active romantic connection、年龄不低于 18 岁时，形成事件可 eligible。
2. 选择 `decline_romantic_direction` 后，不创建人物或关系，并进入 cooldown。
3. 选择 `keep_as_acquaintance` 后，不通过 `confirmed_romantic_connection`。
4. 选择 `continue_getting_to_know` 后，人物和 exploring relationship 原子提交。
5. 下一节点通过 `confirmed_romantic_connection`，但不通过 `confirmed_partner`。
6. 选择 `begin_mutual_dating` 后通过 `confirmed_partner`。
7. 选择 `end_romantic_exploration` 后不再通过两个门槛。
8. 超过十个节点后，未结束的 relationship 仍存在，不依赖历史窗口。
9. 同一 candidateKey 不会创建重复人物。
10. exploring 超过十个节点后仍能按状态持续月份进入 clarification。
11. 已有 exploring 时，新的形成事件不可 eligible。
12. exploration 满 3 个月进入 eligible，未满 3 个月不 eligible。
13. eligible 到 due 之间只在 romance 线路内提升权重，不改变线路份额。
14. due 后进入 relationship follow-up 队列，不依赖再次抽中 16.25%。
15. maxAt 后下一安全节点必须处理 checkpoint。
16. PressureArc 推迟 checkpoint 后 progression 仍存在，并记录 deferral。
17. clarification fallback 后 checkpoint 仍为 pending/overdue，后续能够补回。
18. `keep_as_acquaintance` 只冷却 12 个月且不增加 refusalCount；第一次/第二次明确拒绝分别保持 120/240 个月语义。
19. 形成事件自身只冷却 2 个普通节点，不再与 RoutePreference 形成十年级双重冷却。
20. 两次 slow review 或总探索 36 个月后，不再提供无限 slow outcome。
21. 收束 outcome 只有在用户选择后结束关系，人物仍存在。
22. checkpointKey 同时包含 relationship id、kind、startedAt、dueAt 和 maxAt；同一人物的两个 review 窗口不得混算 deferral。
23. 连续 deferred 达到 3 时进入 mustRestore，下一节点必须插入，不得产生第 4 个 deferred 节点。
24. interleave 不增加 PressureArc 的 phaseCheckpointCount/totalCheckpointCount，不改变 phase/status。
25. 强制事件目标年龄不得大跨度跨过关系 maxAt；当前年龄等于 maxAt 时，除独立重大危机外不得再消费 PressureArc continuation，checkpoint 必须以 no-op interleave 在 maxAt+1 派发。
26. 强制弧 resolve 后第一个安全节点必须是 pending relationship follow-up。

### 18.4 R2：调度分布

使用固定 personas、固定事件可用性和大量稳定 seeds，至少运行 10,000 个普通调度样本：

- main line 目标 75%，允许统计误差区间 73%–77%；
- cross line 总计目标 25%，允许 23%–27%；
- 在主线组合、romance、family 始终有候选的对照条件下：
  - romance 目标 16.25%，允许 14.75%–17.75%；
  - family 目标 8.75%，允许 7.5%–10%；
  - friendship 首批必须为 0；
- 不得出现连续三个跨线节点；
- 有安全跨线候选时，不得连续超过十个普通主线节点而没有跨线；
- romance 不可用时，其预算必须回到主线，family 不得吸收。

另设真实 eligibility 对照，报告各线路 draw / availability / realization / fallback，不能用“所有线路始终有候选”的数学测试代替产品可用率验收。

生命周期调度另设至少 1,000 个稳定 seed 的确定性对照：

- 条件固定为“初始无伴侣、选择继续了解、无长期强制 Arc”；
- `explorationToFirstReviewMonths` 的 P50 初始目标为 6–12 个月；
- first review 的 P90 初始目标不超过 18 个月；
- 无强制事件时 first review 最大值不得超过 18 个月；
- `totalExplorationMonths` 的 P90 和最大值不得超过 36 个月；
- `datingToCommitmentReviewMonths` 的 P50 初始目标为 18–36 个月；
- P90 初始目标不超过 60 个月；
- 所有阈值先作为校准门槛，不能由本轮两条成功发展路线反推为最终产品常量。

另设压力密集型调度矩阵：

- 至少覆盖 3 条连续创业、普通 PressureArc、健康危机叠加路线；
- `consecutiveDeferredNodes` 最大值不得超过 3；
- `dispatchAgeInMonths - maxAtAgeInMonths` 最大值不得超过 1；
- mustRestore 或硬截止插入后 PressureArc id、phase、status 与两个 checkpointCount 必须保持不变；
- mustRestore 未清除前不得启动新的普通 PressureArc；
- relationship 生成 fallback 后原 checkpointKey 和 mustRestore 仍可恢复。

若确定性调度本身不能满足上限，不得用模型叙事质量或五路线 R4 结果掩盖。

### 18.5 R3：长路线语义验收

至少覆盖：

- 事业路线，无初始父母和伴侣事实；
- 事业路线，有父母但关系未知；
- 事业路线，明确父母支持；
- 事业路线，明确父母反对；
- 事业路线，无伴侣但对爱情开放；
- 事业路线，连续拒绝爱情形成；
- 事业路线，从探索发展为正式交往；
- 事业路线，探索后主动结束；
- 事业路线，初始已有伴侣；
- 事业路线，相遇后 3–18 个月内完成首次 review；
- 事业路线，探索期间被健康/PressureArc 打断后恢复 review；
- 事业路线，两次选择慢慢了解后进入可收束节点；
- 晚年新相遇仍可达，但不与 22–35 岁完全等权；
- 离异或丧偶后主动重新开放关系，不受默认年龄衰减。

人工分别判断：

1. 路线归属是否符合调度 trace；
2. 事业主线是否持续推进；
3. 父母是否被无依据写成压力源；
4. 担忧是否被误写为反对；
5. 爱情人物身份是否连续；
6. 关系阶段是否跳级；
7. 拒绝爱情后是否仍被重复投放；
8. eligible 阶段加权是否自然，不显得固定月份硬插；
9. overdue checkpoint 是否被补回；
10. 探索衰减是否通过用户选择收束而非后台静默变化；
11. 关系跟进是否仍沿用同一 personId / relationshipId；
12. 事业和健康因果是否被关系 checkpoint 不合理打断。

窗口参数冻结前，至少运行 30–50 条包含关系发展的生成路线。五条固定 R4 可以证明结构和回归，但不能用于估算 P50/P90 或校准年龄乘数。

### 18.6 R4：真实浏览器验收

真实 AI 浏览器证据必须使用新 run root，不复用旧结果。至少完成：

- 2 条无父母事实的事业路线；
- 2 条父母已激活但立场不同的事业路线；
- 2 条无伴侣起点的爱情形成路线；
- 1 条拒绝爱情形成路线；
- 1 条初始已有伴侣路线；
- 1 条 checkpoint 被强制事件推迟后补回的路线；
- 1 条 exploring 达到 review 上限后自然收束的路线。

发布门槛分开报告：

- 路线可达性；
- 权威人物/关系状态正确性；
- 75/25 调度统计；
- 叙事质量与刻板偏差；
- relationship checkpoint 的等待、deferral、fallback 和 reschedule；
- 相遇年龄只作为分层指标，不把所有路线强行对齐到全国初婚均值。

任何一项失败都必须如实保留失败证据，不能用替换 persona 制造通过结果。

## 19. 回滚策略

- `enableLineMixPolicy=false`：回到当前全局候选池，但保留新关系状态数据。
- `enableRomanceFormationEvents=false`：停止新形成事件，不删除已存在 accepted relationship。
- `enableRomanceLifecycleScheduling=false`：停止新建和提升 checkpoint，但保留 progression 数据；不得因此回退到历史正文或把 active relationship 清除。
- `enableRomanceFormationAgeAffinity=false`：恢复成年新相遇统一软权重，不改变 18 岁硬下限和已存在关系。
- `enableTrustedFamilyActivation=false`：只允许用户明确输入初始化父母线；不得回退到模型正文关键词激活。
- 新字段均要求向后兼容读取；回滚不能删除人物和关系历史。
- 不允许通过降低 `confirmed_partner` 置信度门槛或重新扫描自然语言正文作为回滚手段。

## 20. 完成定义

本 Spec 完成不是“事件库里多了两个爱情事件”，而是以下闭环同时成立：

```text
普通节点先选线路
  -> 线路内选择合格事件
  -> 事件只提出候选变化
  -> 用户选择授权对应 outcome
  -> validator 形成 Accepted Event
  -> person / relationship / family reducer 原子提交
  -> relationship reducer 创建或更新生命周期 checkpoint
  -> eligible 后渐进加权，due/max 后因果补回
  -> 用户选择下一 outcome 后才推进或结束关系
  -> 下一节点只读取权威状态判断资格
```

最终产品行为必须同时满足：

- 事业普通节点拥有清晰的 75/25 主线与跨线预算；
- 爱情在没有现任伴侣时可以形成，但不会一步跳成伴侣；
- 相遇、确认交往和承诺决策在数月到数年的有界窗口内推进，不再依赖十几年后的随机抽中；
- exploring 不会永久腐烂，达到 review/总时长上限后进入用户可选择的收束；
- checkpoint 到期、fallback 或强制事件推迟都不会静默改变关系或丢失后续义务；
- 晚年爱情保持可达，年龄只改变新相遇软权重；
- 父母只在用户认可证据存在时进入家庭线；
- 父母关系默认未知，压力必须有证据；
- 所有人物和关系都能跨节点稳定追踪，不依赖会过期的正文关键词窗口。
