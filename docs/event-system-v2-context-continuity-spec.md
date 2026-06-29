# AI 人生模拟器：事件系统 V2 补充 Spec（上下文延续与关系副线修复）

## 1. 背景

V2 三层事件架构已经把事件库从“剧本库”改成“人生张力调度器”：

```text
Trigger Layer：判断候选资格
Intent Layer：定义人生张力
Render Layer：生成具体剧情
```

这个方向解决了“事件写死剧情”和“同类事故复读”的问题，但也引入了一个新副作用：

```text
事件变得更干净、更抽象以后，追问答案、感情线、亲情线、朋友线等生活副线在生成中变弱。
```

用户感知上会表现为：

- 明明回答了 3 个背景补全问题，但后续剧情不明显使用。
- 主线推进还在，但亲情、感情、熟人关系、家庭牵扯减少。
- null event 变成普通过渡，而不是生活细节与关系变化的承载点。
- 用户选择“恋爱与婚姻”或填写了关系经历，但事件调度不一定提升 relationship 线权重。

## 2. 根因

### 2.1 追问链路仍在，但没有成为强约束

当前代码仍保留：

- `generate-questions`
- `buildQuestionPrompt`
- `SoulQuestioning`
- `answersText`

服务端也仍把追问答案注入 prompt：

```text
【3道剧本背景补全问题得到的真实材料】
```

但 V2 的 Event Intent prompt 只要求：

```text
必须根据用户真实信息、追问补全信息、历史选择、当前属性、最近 5 个历史节点状态调整细节
```

这句话不足以保证 AI 显性使用追问答案。

### 2.2 V2 删除了 conceptPrompt / promptSeed 后，副线提示也被一起削弱

旧版本的 `conceptPrompt` 虽然过细，但里面自然包含：

- 家庭压力
- 伴侣态度
- 老家亲友
- 朋友利益
- 婚恋现实

V2 改成 `intent` 后，只保留张力结构。如果 Render Layer 没有补上“关系副线织入规则”，AI 就会倾向只写当前事件的主冲突。

### 2.3 dispatcher 没有使用 coreStoryFocus

当前事件选择主要依赖五维属性：

```text
happiness
intelligence
wealth
relation
health
```

但没有把 `userData.coreStoryFocus` 转成 category 权重。

因此用户选择：

```text
恋爱与婚姻
```

并不会让 `relationship` 事件更容易出现。

### 2.4 null event 没有承担“生活副线推进”职责

V2 规定：

```text
null = 人生平稳推进，不是失败
```

但还没有进一步规定：

```text
null event 应随机推进关系、亲情、健康、财务、成长等轻量生活副线。
```

这会导致平稳节点变成“无事发生”，而不是“人生仍在缓慢变化”。

## 3. 目标

本补充 spec 的目标是：

```text
在不破坏 V2 三层架构的前提下，让追问答案、感情线、亲情线和生活副线重新进入剧情调度与渲染。
```

具体目标：

1. 追问答案必须成为 Render Layer 的强上下文材料。
2. 最近 5 个历史节点必须影响剧情延续。
3. `coreStoryFocus` 必须影响事件 category 权重。
4. null event 必须承担轻量副线推进职责。
5. relationship / family / romance 不应只在强事件中出现，也应作为背景副线穿插。

## 4. 非目标

本补充 spec 不做：

- 不恢复 `conceptPrompt`。
- 不恢复 `promptSeed`。
- 不把 relationship 事件写成固定恋爱剧本。
- 不引入完整状态机。
- 不做复杂 Script Context Library。
- 不要求每一轮都出现感情或亲情。

## 5. 核心原则

### 5.1 追问答案不是装饰材料

追问答案属于高优先级用户事实，优先级仅低于用户真实基础事实。

```text
用户真实事实 > 追问补全信息 > 历史选择 > 事件 intent > 系统模板
```

Render Layer 不能只“参考”追问答案，而应尽量显性使用。

### 5.2 副线不是强事件

感情线、亲情线、朋友线不一定要以强事件出现。

它们可以是：

- 一通电话
- 一次饭局
- 一条消息
- 一个未回复的人
- 家里人的态度变化
- 伴侣或暧昧对象的现实反馈
- 朋友关系的远近变化

### 5.3 关系线必须贴合用户阶段

关系副线不能强行写成恋爱或婚姻。

它必须根据用户历史与年龄阶段变化：

```text
学生阶段：父母、同学、老师、暗恋、朋友
初入职场：同事、朋友、前任、伴侣、家人期待
中年阶段：伴侣、子女、父母养老、亲友借钱、婚姻磨损
老年阶段：陪伴、孤独、子女关系、旧友、身体照护
```

### 5.4 延续性优先于戏剧性

如果最近 5 个节点已经埋下某条关系线，后续应优先延续它，而不是每轮新开一条关系线。

## 6. 数据结构建议

### 6.1 StoryContextPack

新增渲染上下文包，用于把用户事实、追问答案和历史节点整理成可输入 AI 的结构。

```ts
interface StoryContextPack {
  userFacts: string[];
  answerFacts: string[];
  recentHistory: HistoryItem[]; // last 5 nodes
  activeThreads: BackgroundThread[];
}
```

字段说明：

- `userFacts`：来自用户初始表单、回溯节点、里程碑。
- `answerFacts`：来自 3 个追问答案。
- `recentHistory`：最近 5 个历史节点。
- `activeThreads`：可延续的生活副线。

### 6.2 BackgroundThread

新增轻量副线结构。

```ts
interface BackgroundThread {
  id: string;
  type:
    | "romance"
    | "family"
    | "friendship"
    | "career"
    | "health"
    | "financial"
    | "growth";
  source: "user_fact" | "answer" | "history" | "event";
  summary: string;
  salience: number; // 0~1
  lastTouchedNode?: number;
}
```

注意：

```text
BackgroundThread 不是剧情脚本，只是提醒 AI 哪些生活关系还在场。
```

### 6.3 EventIntent 补充字段

不改变 V2 核心结构，只允许新增可选字段：

```ts
interface EventIntent {
  type: string;
  meaning: string;
  tensionAxes: string[];
  allowedOutcomes: ActionPrimitive[];
  emotionalTone?: "pressure" | "neutral" | "opportunity" | "crisis";
  threadAffinity?: BackgroundThread["type"][];
}
```

用途：

```text
提示某个 intent 更适合牵动哪些副线，但不强制写具体剧情。
```

示例：

```ts
threadAffinity: ["family", "financial"]
```

表示这个事件适合牵动家庭与财务副线。

## 7. 调度层修复

### 7.1 coreStoryFocus category boost

dispatcher 需要把 `userData.coreStoryFocus` 转成 category 权重。

建议映射：

```ts
const focusCategoryBoost = {
  career: { career: 1.6, financial: 1.2, growth: 1.1 },
  romance: { relationship: 1.7, growth: 1.1 },
  wealth: { financial: 1.7, career: 1.2, opportunity: 1.1 },
  selftruth: { growth: 1.5, career: 1.1, opportunity: 1.1 },
  innerpeace: { growth: 1.5, health: 1.3, relationship: 1.1 }
}
```

规则：

- boost 只能影响权重，不能绕过 `eligibility`。
- boost 不能取消 cooldown。
- boost 不能覆盖 tag similarity 去重。

### 7.2 relationship fallback eligibility

当用户选择 `coreStoryFocus = romance`，或追问答案/里程碑中存在明显关系材料时，relationship 类事件应更容易进入候选池。

允许新增轻量判断：

```ts
hasRelationshipContext(userData, answers, history)
```

可识别：

- 恋爱
- 分手
- 婚姻
- 相亲
- 暧昧
- 家庭阻力
- 伴侣
- 前任
- 父母态度

但注意：

```text
这只能提升候选资格或权重，不能强行制造恋爱剧情。
```

### 7.3 null event side-thread selection

当 `event = null` 时，应随机选择一个轻量副线方向。

建议分布：

```ts
nullEventThreadMix = {
  relationship: 0.2,
  family: 0.2,
  career: 0.2,
  financial: 0.15,
  health: 0.15,
  growth: 0.1
}
```

如果 `coreStoryFocus = romance`：

```ts
relationship + family 总权重应提高
```

如果最近 5 个节点已有某副线：

```ts
优先延续已有副线，而不是新开副线
```

## 8. 渲染层修复

### 8.1 Prompt 必须新增 Story Context Section

每次生成节点时，Event Intent 前后必须加入：

```text
【Story Context Pack】
用户真实事实：
- ...

追问补全事实：
- ...

最近 5 个历史节点：
- ...

当前可延续副线：
- ...
```

### 8.2 追问答案使用规则

AI 必须遵守：

```text
如果追问答案非空，本轮剧情必须至少显性使用 1 条追问答案中的事实或限制。
```

但禁止：

```text
机械复述用户原话。
```

正确方式：

```text
把追问答案转成场景里的约束、人物反应、可选路径或心理惯性。
```

### 8.3 最近 5 节点延续规则

AI 必须遵守：

```text
优先延续最近 5 个节点中已经出现的人、关系、职业状态、健康状态、财务状态。
```

禁止：

```text
无解释地重置职业身份
无解释地新增核心伴侣
无解释地让家庭态度突变
无解释地忽略上一轮重大选择
```

### 8.4 副线织入规则

每个非终章节点至少满足以下之一：

1. 推进主事件 intent。
2. 延续一个 background thread。
3. 从追问答案中转化一个现实限制或人物关系。

对于 null event，至少满足以下之一：

1. 推进一个轻量关系/亲情/生活副线。
2. 呈现上一轮选择后的日常后果。
3. 写出生活状态的微小变化。

## 9. UI 与产品表现

本次修复不需要改 UI。

但产品层的结果应表现为：

- 用户回答的 3 个追问更明显进入剧情。
- 即使主线是事业，也会偶尔出现家庭/伴侣/朋友的现实反馈。
- 即使没有强事件，也会有生活副线推进。
- 恋爱与婚姻主线下，relationship 事件和 relationship background thread 明显更常出现。

## 10. 验收标准

### 10.1 追问答案进入剧情

给定：

```text
用户追问答案中提到“父母希望我稳定，不支持冒险”
```

生成节点应出现：

```text
父母态度、稳定期待、冒险阻力、电话/饭桌/转账/沉默等现实表现之一
```

不得完全忽略。

### 10.2 coreStoryFocus 影响调度

给定：

```text
coreStoryFocus = romance
```

预期：

```text
relationship category 的候选权重高于默认状态
```

但仍必须遵守：

- cooldown
- tag similarity
- eligibility

### 10.3 null event 不再空泛

给定：

```text
event = null
```

生成节点不得只是“平稳过了几年”。

必须包含：

- 一个小选择
- 一个生活细节
- 一个轻量副线变化

### 10.4 最近 5 节点延续

给定最近 5 个节点中反复出现：

```text
母亲反对用户辞职
```

后续节点如果涉及事业转向、收入变化或低谷，必须考虑这条家庭线。

### 10.5 不退化为旧剧本库

不得因为补副线而恢复：

- `conceptPrompt`
- `promptSeed`
- 固定人物模板
- 固定事故模板
- 固定恋爱桥段

## 11. 最小实现范围

P0 必做：

1. 新增 StoryContextPack 构建逻辑。
2. 将追问答案整理为 answerFacts。
3. 将最近 5 个节点整理为 recentHistory summary。
4. 在 Render Prompt 中加入 Story Context Section。
5. 强制非空追问答案至少显性使用 1 条。
6. coreStoryFocus 影响 category 权重。
7. null event prompt 增加副线推进规则。

P1 可做：

1. 新增 BackgroundThread 抽取。
2. relationship / family context detection。
3. null event side-thread mix。
4. EventIntent 增加 `threadAffinity`。

暂不做：

- 完整状态机。
- 长线人物关系图谱。
- 多事件并发。
- 复杂 Script Context Library。

## 12. 一句话总结

V2 已经把事件库变成了人生张力调度器；本补充 spec 的目标，是把追问答案和关系副线重新接回 Render Layer 与 Dispatcher，让故事不只是“事件驱动”，而是能延续用户真实生活里的关系、限制和日常变化。
