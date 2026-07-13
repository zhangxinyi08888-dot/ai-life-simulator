# AI 人生模拟器：事件系统 V2 补充 Spec（用户事实影响衰减与主线漂移控制）

## 1. 背景

当前 V2 已经通过 `StoryContextPack` 把用户真实事实、追问答案、最近 5 个历史节点和可延续副线重新输入剧情生成。

这解决了“追问信息没有被用起来”的问题，但也带来一个新风险：

```text
某个初始时间节点的信息被 AI 过度延展，变成贯穿一生的固定主题。
```

典型例子：

```text
用户在 18 岁填报志愿时提到“我对植物感兴趣”
↓
大学、就业、创业、中年转型、老年生活都不断生成植物相关内容
```

这会让剧情显得机械、不真实。

现实中，早期兴趣可以影响人生起点，但不应该自动决定终身走向。一个人可能曾经喜欢植物，后来进入互联网、教育、金融、销售、体制、家庭照护、自由职业等完全不同路径。除非用户后续选择不断强化这个兴趣，否则它应该逐渐降为生活细节，而不是长期主线。

## 2. 目标

本 spec 的目标是：

```text
让用户初始信息影响剧情，但不绑架剧情。
```

具体目标：

1. 区分不同类型的用户事实。
2. 给阶段性事实和兴趣倾向加入时间衰减。
3. 让后续选择和最近历史优先于初始兴趣。
4. 只有被持续强化的信息，才升级为长期人生主线。
5. 避免 AI 把单个兴趣机械延展成终身职业、创业方向或人生主题。
6. 区分“方向没有被提供”和“方向被明确提供但用户未选择”，把后者作为轻量负反馈，避免同一具体方案反复占用选项。

## 3. 核心原则

### 3.1 初始条件是起点，不是终身剧本

用户在回溯节点提供的信息，优先用于解释当时处境。

例如：

```text
18 岁喜欢植物
```

合理影响：

- 高考志愿想象
- 专业兴趣
- 大学社团或生活细节
- 早期选择时的价值偏好

不应自动影响：

- 30 岁创业一定做植物
- 45 岁事业转型仍然围绕植物
- 60 岁人生总结仍然把植物当核心主题

除非用户后续选择持续强化。

### 3.2 后续选择高于初始兴趣

剧情优先级应调整为：

```text
用户真实硬事实
> 用户最近选择
> 用户选择导致的现实状态与成果
> 近期明确未采纳形成的选项冷却
> 最近 5 个历史节点中的其他事实
> 当前属性与人生阶段
> 追问补全事实
> 初始兴趣倾向
> 模型正文偶然提及
> 生辰/星盘/八字假设
> 系统模板
```

注意：

追问答案仍然重要，但追问中的“兴趣倾向”需要区分是否仍然活跃。

真实事实与行动提案必须分开处理。例如，“父母曾建议去某城市”可以继续作为家庭事实，但不代表“搬去该城市”可以在用户多次未采纳后持续成为选项。选项冷却限制的是行动提案，不删除已经发生的事实。

### 3.3 兴趣默认是弱锚点

用户兴趣默认只是一种偏好线索，不是职业主线。

兴趣可以表现为：

- 生活审美
- 注意力偏好
- 业余爱好
- 情绪慰藉
- 某个阶段的选择参考

兴趣不应默认表现为：

- 长期职业
- 创业项目
- 人生使命
- 终身遗憾
- 每一章都必须出现的主题

### 3.4 被强化才升级为主线

某个兴趣或初始事实只有在以下情况出现时，才可以升级为长期主线：

1. 用户后续多次选择相关路线。
2. 最近 5 个历史节点中多次出现相关行动。
3. `coreStoryFocus` 是 `selftruth` 或明确偏向兴趣理想。
4. 追问答案明确说这是长期热爱或现实能力。
5. 用户在剧情选择中继续投入该方向。
6. 该方向已经产生明确现实资产，例如专业、作品、证书、人脉、收入、职业身份。

否则，它只能作为低权重背景素材。

### 3.5 选项证据必须区分选择、未采纳与未提供

每个方向在一个历史节点中只产生以下一种证据：

```text
selected_choice：该方向被提供且被用户选择，属于正强化。
passed_choice：该方向被提供，但用户选择了其他方案，属于轻量负反馈。
not_offered：该方向没有被提供，属于中性，不强化也不降权。
model_mention：只在模型生成的标题或正文中出现，属于中性，不构成用户偏好证据。
```

一次 `passed_choice` 只表示用户在当时条件下更偏向其他方案，不等于永久拒绝。只有同一方向近期被重复提供且持续未被选择时，才进入冷却或停止主动提供。

## 4. 用户事实分层

建议将用户事实分成四类。

### 4.1 LongTermFact 长期事实

长期稳定、不应随剧情轻易消失。

示例：

- 出生年份
- 性别
- 原生家庭基本结构
- 真实高考经历
- 已发生的重要职业经历
- 已发生的重要情感关系
- 长期健康限制

特点：

```text
高权重，低衰减。
```

### 4.2 StageFact 阶段事实

只强绑定某个时间节点。

示例：

- 当年高考分数
- 填志愿时的分数线
- 毕业时的第一份 offer
- 某一年家里缺钱
- 某段关系正在拉扯
- 当时所在城市

特点：

```text
高初始权重，中高衰减。
```

### 4.3 InterestSignal 兴趣倾向

用户表达的偏好、兴趣、审美或想象。

示例：

- 对植物感兴趣
- 喜欢写作
- 喜欢设计
- 想做游戏
- 想去大城市
- 想自由

特点：

```text
中低初始权重，高衰减。
除非被后续选择强化，否则不得成为长期主线。
```

### 4.4 TemporaryEmotion 临时状态

当时的情绪、压力、冲动。

示例：

- 焦虑
- 想逃离
- 怕父母失望
- 一时赌气
- 不甘心

特点：

```text
只影响短期节点，不应长期固化为人格标签。
```

## 5. 建议数据结构

### 5.1 StoryFact

```ts
type StoryFactType =
  | "long_term_fact"
  | "stage_fact"
  | "interest_signal"
  | "temporary_emotion";

interface StoryFact {
  id: string;
  type: StoryFactType;
  text: string;
  source: "user_data" | "question_answer" | "history" | "choice";
  sourceAge?: number;
  sourceNodeIndex?: number;
  salience: number; // 0~1
  decayRate: number; // 0~1 per node
  reinforcementCount: number;
  promotedToArc: boolean;
}
```

### 5.2 salience 建议

```ts
long_term_fact: 0.9
stage_fact: 0.75
interest_signal: 0.45
temporary_emotion: 0.35
```

### 5.3 decayRate 建议

```ts
long_term_fact: 0.02
stage_fact: 0.12
interest_signal: 0.18
temporary_emotion: 0.25
```

含义：

```text
interest_signal 如果连续几轮没有被使用或强化，权重应明显下降。
```

### 5.4 选择证据使用现有历史动态派生

选择证据不新增持久化存储，直接使用现有 `HistoryItem.choices`、`HistoryItem.selectedChoice` 和 `SimulationChoice.decisionIntent` 动态计算：

```ts
interface ChoicePreferenceSignal {
  decisionIntent: string;
  selectedCount: number;
  passedOfferCount: number;
  consecutivePassedOfferCount: number;
  lastOfferedNodeIndex: number;
  state: "available" | "cooldown" | "dormant";
}
```

`decisionIntent` 必须作为稳定的行动指纹，表达“动作 + 对象”，不能只返回模糊动词：

```text
不推荐：consider_offer
推荐：location:move_to_wuhan_guanggu

不推荐：change_job
推荐：career:accept_internal_demoted_architect_role
```

选择文案可以随上下文变化，但语义相同的行动应尽量复用同一个 `decisionIntent`。旧历史缺少有效 `decisionIntent` 时，可以使用规范化后的选项文本作为降级匹配；不得通过扩充城市、行业或兴趣关键词白名单解决。

## 6. 事实权重计算

建议渲染前动态计算每条 fact 的当前权重。

```ts
currentWeight =
  salience
  * Math.pow(1 - decayRate, nodeDistance)
  * reinforcementMultiplier
```

其中：

```ts
nodeDistance = 当前节点序号 - sourceNodeIndex
```

强化倍率：

```ts
reinforcementMultiplier = 1 + reinforcementCount * 0.35
```

如果 `promotedToArc = true`：

```ts
currentWeight = Math.max(currentWeight, 0.75)
```

## 7. 强化规则

当以下情况发生时，某个 fact 的 `reinforcementCount += 1`：

1. 用户选择文本直接包含该主题。
2. 用户选择的 `decisionIntent` 明确指向该主题。
3. 用户自定义输入明确选择该主题。
4. 由用户选择推动的该主题带来现实结果，例如收入、关系、身份、地点变化。
5. 用户在时光回流后再次选择相关路线。

模型生成的标题、正文、未被选择的选项，以及最近历史中的重复提及，都不能单独增加 `reinforcementCount`。只有用户选择或由该选择导致的现实成果，才能把模型叙事转化为强化证据。

当：

```text
reinforcementCount >= 2
```

可以考虑升级：

```ts
promotedToArc = true
```

但仍需满足现实合理性。

## 8. 降权规则

当以下情况发生时，某个兴趣或阶段事实应降权：

1. 最近 5 个节点没有出现该主题。
2. 该方向被明确提供，但用户连续选择了其他方向。
3. 当前职业/关系/家庭状态已经明显转向。
4. 当前年龄阶段与该事实关联很弱。
5. 该事实只是某个早期节点的兴趣表达，没有形成现实资产。

其中第 2 条是更强、更准确的用户负反馈，必须区分：

```text
方向没有出现在 choices 中：not_offered，中性，不增加未采纳次数。
方向出现在 choices 中但未被选择：passed_choice，增加一次未采纳证据。
方向被选择或被自定义输入明确选择：selected_choice，清除该方向的连续未采纳计数和冷却。
```

建议采用轻量冷却：

```text
近期第 1 次明确提供但未选择：保留为弱负反馈，不立即封锁。
近期第 2 次明确提供但未选择：进入 cooldown，后续 3 个决策节点不得再次成为 A/B/C 主选项。
近期第 3 次明确提供但未选择：进入 dormant，不再主动提供。
用户之后主动选择或自定义输入该方向：解除 cooldown/dormant，重新计算权重。
```

冷却只限制具体行动提案，不删除相关真实事实，也不阻止人物关系或现实后果继续发展。

示例：

```text
18 岁喜欢植物
↓
22 岁选择互联网运营
↓
25 岁进入本地生活平台
↓
28 岁创业做社区服务
```

此时“植物”应降为生活细节，不能继续主导创业方向。

## 9. Prompt 规则

需要在 Render Layer prompt 中加入约束。

### 9.1 初始兴趣约束

```text
用户在某个时间节点表达的兴趣，只能作为当时的偏好、审美或生活细节。
不得自动扩展为终身职业、创业方向或人生主题。
只有当用户后续选择、最近历史节点或现实成果持续强化该兴趣时，才允许升级为长期主线。
```

### 9.2 最近历史优先

```text
生成本轮剧情时，优先参考最近 5 个历史节点和用户最近选择。
如果早期兴趣与最近人生状态冲突，应以最近状态为准。
早期兴趣可以作为细节回响，但不得强行拉回主线。
```

### 9.3 生活细节使用方式

```text
如果某个兴趣没有被强化，可以偶尔作为生活细节出现，例如房间摆设、周末活动、审美偏好、聊天话题。
不要把它写成职业必然、创业项目必然或重大人生使命。
```

### 9.4 选择冷却与副线连续性

```text
延续 background thread 是延续人物关系、压力和既有后果，不等于重复之前未被选择的具体方案。
某个 decisionIntent 进入 cooldown 或 dormant 后，初始事实、追问答案、最近历史和 background thread 都不能绕过冷却，再次把它放入 A/B/C。
相关事实仍可作为背景出现，但必须推进新的关系变化或现实后果，不能把同一提案换一种文案重新提供。
```

### 9.5 候选选项硬校验

Prompt 约束之外，还应复用现有候选节点校验流程。若新节点的任一选项命中 `cooldown` 或 `dormant` 的 `decisionIntent`，应以 `repeats-recently-passed-option` 拒绝候选结果并定向修复。

冷却优先级高于副线连续性、初始事实、Event Intent 和候选回退；不得因为缺少其他候选而重新启用仍在冷却中的行动提案。

## 10. StoryContextPack 调整

当前 `StoryContextPack` 包含：

```ts
userFacts
answerFacts
recentHistory
activeThreads
```

建议后续升级为：

```ts
interface StoryContextPack {
  longTermFacts: StoryFact[];
  stageFacts: StoryFact[];
  interestSignals: StoryFact[];
  temporaryEmotions: StoryFact[];
  choicePreferenceSignals: ChoicePreferenceSignal[];
  recentHistory: HistoryItem[];
  activeThreads: BackgroundThread[];
}
```

V1 实现可以先不改结构，只在格式化文本中加入说明：

```text
以下兴趣/阶段信息来自早期节点，若最近历史没有强化，只能作为背景细节，不得主导后续人生方向。
以下方向近期被明确提供但未被选择，若处于 cooldown/dormant，不得再次成为选项；相关事实和人物关系仍可作为背景继续发展。
```

## 11. 事件调度影响

### 11.1 不让兴趣直接决定事件 category

兴趣不能直接强行推高某类事件。

例如：

```text
喜欢植物
```

不应自动导致：

```text
创业事件 = 植物创业
职业事件 = 园艺行业
财富事件 = 花店
老年事件 = 植物疗愈
```

### 11.2 被强化后才能影响 category

如果用户多次选择植物相关路线，可以逐渐影响：

```text
growth
career
financial
opportunity
```

但仍应根据当前人生状态决定具体表现。

## 12. 示例

### 12.1 错误生成

用户 18 岁说：

```text
我对植物感兴趣。
```

错误后续：

```text
30 岁，你辞职创办植物疗愈工作室。
45 岁，你把植物疗愈品牌做成全国连锁。
60 岁，你回到山里研究植物人生哲学。
```

问题：

```text
早期兴趣被自动变成终身主线。
```

### 12.2 正确生成

如果后续没有强化：

```text
你大学后来转向运营方向。工作几年后，植物只偶尔出现在你的出租屋阳台上。
某个压力很大的周末，你给几盆绿植换土，意识到自己已经很久没有为喜欢的事留时间。
```

如果后续持续强化：

```text
你大学加入植物社团，毕业后进入农业科技公司，后来又选择继续做社区园艺项目。
这时植物方向可以升级为长期职业线。
```

## 13. 实施优先级

### P0：Prompt 止血

先在 `buildEventIntentPrompt` 和 `buildNullEventPrompt` 中加入：

```text
早期兴趣不得自动变成终身主线。
最近 5 个节点和最近选择优先。
未被强化的兴趣只能作为生活细节。
延续副线不等于重复未被选择的具体方案。
处于 cooldown/dormant 的 decisionIntent 不得进入 A/B/C。
```

收益最大，改动最小。

### P1：StoryContext 文本分层

在 `buildStoryContextPack` 中粗分：

```text
用户硬事实
阶段事实
兴趣倾向
临时情绪
最近选择与明确未采纳方向
最近历史
```

不一定马上引入完整 `StoryFact` 类型；选择信号优先从现有 `choices`、`selectedChoice` 和 `decisionIntent` 动态派生，不新增持久化结构。

### P2：事实权重与衰减

引入：

```ts
salience
decayRate
reinforcementCount
promotedToArc
```

让系统显式知道哪些事实还活跃。

同时用 `passedOfferCount` 和 `consecutivePassedOfferCount` 对允许使用范围封顶。没有被提供的方向不得增加连续未采纳次数。

### P3：主线升级机制

当某个兴趣被多次选择强化，才将其升级为：

```text
active arc
```

并允许它影响职业、财富、关系等长期剧情。

同阶段将 `cooldown/dormant` 信号接入现有候选节点校验；模型重复生成近期未采纳方案时必须拒绝并定向修复。

## 14. 验收标准

### 14.1 早期兴趣不会自动绑架人生

构造：

```text
18 岁：喜欢植物
22 岁：选择互联网运营
25 岁：进入本地生活平台
28 岁：创业做社区服务
```

预期：

```text
30 岁创业方向不得自动变成植物相关。
```

### 14.2 兴趣可以作为生活细节保留

同样构造下，允许：

```text
阳台绿植
周末去植物园
喜欢自然环境
用植物作为减压方式
```

### 14.3 被强化后可以升级为主线

构造：

```text
18 岁：喜欢植物
19 岁：选择植物相关专业
22 岁：进入农业科技公司
25 岁：继续选择植物相关创业
```

预期：

```text
植物方向可以成为长期职业线。
```

### 14.4 最近历史优先于初始兴趣

如果最近 5 个节点持续围绕家庭、财务、健康或职业转型，早期兴趣不得强行抢占主线。

### 14.5 明确未采纳的方案会进入冷却

构造：

```text
节点 1：提供 direction:A，用户选择 direction:B。
节点 2：再次提供 direction:A，用户仍选择其他方向。
节点 3：模型再次把 direction:A 放入 A/B/C。
```

预期：

```text
direction:A 进入 cooldown。
节点 3 的候选结果被拒绝并修复，后续 3 个决策节点不得再次主动提供 direction:A。
```

### 14.6 没有提供不等于未选择

如果某方向没有出现在某个节点的 `choices` 中，该节点不得增加该方向的 `passedOfferCount` 或 `consecutivePassedOfferCount`。

### 14.7 模型复读和副线不能绕过冷却

如果某个冷却方向仍出现在初始事实、追问答案、最近历史正文或家庭副线中，可以保留事实和人物关系，但不得再次成为 A/B/C 的核心行动提案。

### 14.8 用户主动选择可以解除冷却

用户通过预设选项或自定义输入明确选择某方向后，应清除该方向的连续未采纳计数，解除 `cooldown/dormant`，并重新参与事实权重与主线升级计算。

## 15. 一句话总结

```text
用户初始条件应该塑造人生起点，而不是锁死整个人生剧本。
早期兴趣只有在被后续选择持续强化时，才会成为长期主线；否则它只是生活里的低权重回响。
用户选中的方案是正强化；明确提供但未选中的方案是轻量负反馈；没有提供的方向保持中性；模型自行提及不构成用户偏好证据。
```
