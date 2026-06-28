# AI 人生模拟器：事件系统 V2 Spec（三层事件架构修正版）

## 1. 目标

V2 的目标不是扩充事件库，而是：

```text
将剧情生成逻辑从事件库中剥离，使事件库成为人生压力/机会的结构调度系统。
```

V2 要解决的问题：

1. 消除剧情重复：避免同类事故或同类桥段反复出现。
2. 消除事件过拟合：避免“事件 = 完整故事”。
3. 提升人生多样性：同一个事件结构在不同用户历史中能生成不同展开。
4. 引入人生张力驱动：从“条件触发剧情”升级为“人生压力/机会分布调度”。

## 2. 核心设计原则

### 禁止

- 事件库写完整剧情。
- 事件库决定具体发生过程。
- 用 `title` / `conceptPrompt` 决定故事。
- 用 eligibility 判断直接决定“剧情发生”。
- 让 `tags` 参与叙事生成。

### 必须

事件只定义：

- 可能性
- 压力结构
- 冲突方向
- 调度标签
- 行动原语

AI 负责：

- 场景
- 人物
- 细节
- 对话
- 叙事节奏
- 三个用户可选项

## 3. 三层事件架构

### L0：Trigger Layer（候选资格层）

职责：

```text
判断事件是否进入候选池，不决定剧情内容，也不决定事件必然发生。
```

数据结构：

```ts
interface EventTrigger {
  eligibility: (state: LifeState, user: UserData, age: number) => boolean;
}
```

语义护栏：

```ts
// eligibility only determines whether event enters candidate pool.
// It must NOT be treated as deterministic trigger.
```

允许：

```ts
if (!event.trigger.eligibility(state, user, age)) skip;
```

禁止：

```ts
if (event.trigger.eligibility(state, user, age)) return event;
```

规则：

- `eligibility` 只做候选过滤。
- `eligibility` 不允许写剧情内容。
- `eligibility` 不依赖标题语义判断。
- `eligibility` 命中不代表事件发生。

### L1：Intent Layer（语义张力层）

职责：

```text
定义人生发生了什么结构性张力。
```

Intent 不写“具体发生什么”，只写：

- 压力结构
- 冲突维度
- 行动方向
- 情绪基调

数据结构：

```ts
interface EventIntent {
  type: string;
  meaning: string;
  tensionAxes: string[];
  allowedOutcomes: ActionPrimitive[];
  emotionalTone?: "pressure" | "neutral" | "opportunity" | "crisis";
}

type ActionPrimitive = string;
```

`allowedOutcomes` 是行动原语，不是 UI 选项文案。

正确示例：

```ts
allowedOutcomes: [
  "persist_high_pressure",
  "optimize_load",
  "exit_or_pause"
]
```

禁止写成：

```ts
allowedOutcomes: [
  "继续咬牙坚持，把这次机会拿下来",
  "暂时停下来，好好休息一阵子"
]
```

### L2：Render Layer（AI 生成层）

职责：

```text
将 intent + 用户历史 + 当前状态渲染成完整剧情节点。
```

输入：

```ts
interface RenderInput {
  intent: EventIntent | null;
  userState: LifeState;
  userData: UserData;
  history: HistoryItem[];
  coreStoryFocus?: string;
  attributes: LifeAttributes;
}
```

输出：

- 场景
- 人物
- 事件过程
- 对话
- 三个用户可选项
- 属性变化

关键约束：

- AI 不得复述 intent。
- AI 不得复用事件库语言。
- AI 必须根据用户真实信息、追问补全信息、历史选择、当前属性、最近 5 个历史节点状态生成。
- AI 必须保持剧情延续性。

## 4. 事件数据结构（V2 标准）

```ts
interface LifeEventSeedV2 {
  id: string;

  category: EventCategory;

  cooldown?: number;        // only here
  baseProbability?: number; // only here

  trigger: EventTrigger;
  intent: EventIntent;

  tags: string[]; // only for similarity, dedupe, and narrative pressure control
}
```

`trigger` 只负责“是否可能进入候选池”。

根字段负责调度策略：

- `cooldown`
- `baseProbability`

不允许在 `trigger` 中重复定义 `cooldown` 或 `probability`。

## 5. Category 系统

`category` 表示事件驱动域，不是普通内容分类。

推荐类型：

```ts
type EventCategory =
  | "career"
  | "relationship"
  | "health"
  | "financial"
  | "growth"
  | "opportunity";
```

命名原则：

- 使用 `financial`，不用 `wealth`。因为 `financial` 表示现金流、风险、资源和机会的过程域，`wealth` 更像结果。
- 使用 `growth`，不用 `self_growth`。因为 `growth` 可覆盖心理、技能、认知、人格等成长维度。

## 6. Tags 系统

### V1 错误用法

禁止把 `tags` 当成：

- 分类
- label
- metadata
- 剧情提示词

### V2 正确用途

`tags` 只用于三件事：

1. 相似事件去重。
2. 压力重复检测。
3. narrative pressure 控制。

示例：

```ts
tags: ["health", "burnout", "instability"]
```

相似度规则：

```ts
similarity = overlap(current.tags, recent.tags)
```

如果相似度超过阈值，应降低权重或移出候选池。

## 7. 调度系统（Event Dispatcher V2）

输入：

```ts
queryEvent(state, user, age, history)
```

流程：

### Step 1：候选过滤（Trigger Layer）

```ts
candidates = events.filter(event =>
  event.trigger.eligibility(state, user, age)
)
```

注意：

```text
进入 candidates 不代表事件发生。
```

### Step 2：冷却过滤

移除最近冷却窗口内已经出现过的 `event.id`。

```ts
remove if eventId in cooldown window
```

### Step 3：tag 去重

根据最近历史的事件 tags 计算相似度。

```ts
remove or reduce if similarity(tags) > threshold
```

### Step 4：类别压制

如果最近两个节点属于同一个 `category`：

```ts
reduce same-category weight
```

### Step 5：基础概率与随机选择

使用根字段 `baseProbability` 参与抽取。

```ts
weightedRandom(candidates, baseProbability)
```

### Step 6：允许返回 null

如果没有合适候选，或随机结果落在平稳推进区间：

```ts
return null
```

## 8. Null 事件机制

V2 明确规定：

```text
null = 人生平稳推进，不是失败。
```

当 `event = null` 时，AI 必须写：

- 日常推进
- 小选择
- 微压力
- 关系变化
- 工作或生活细节变化

禁止：

- 强行制造事故
- 强行裁员
- 强行背叛
- 强行生病
- 强行重大转折

验收目标：

```text
null 事件占比 >= 20%
```

## 9. Prompt 生成规则

标准输入模板：

```text
你正在模拟一个真实人生的连续推演。

本轮事件结构如下：

[Event Intent]
type:
meaning:
tensionAxes:
allowedOutcomes:
emotionalTone:

请严格围绕该结构生成现实人生场景。

要求：
- 不要复述事件定义
- 不要使用模板化灾难剧情
- 必须根据用户真实信息、追问补全信息、历史选择、当前属性、最近 5 个历史节点状态调整细节
- 必须保持剧情延续性
- 必须体现真实生活代价与选择
- allowedOutcomes 是行动原语，不是选项文案；请将其渲染成自然、具体、符合上下文的用户选择
```

当 `event = null` 时：

```text
本轮没有强事件结构。

请推进一段平稳但真实的人生日常：
- 保持和最近 5 个历史节点的延续性
- 写出生活里的小变化、小压力、小选择
- 不要强行制造事故、裁员、背叛、疾病或重大危机
```

## 10. promptSeed vs intent

V2 统一规则：

| 类型 | 使用方式 |
| --- | --- |
| `promptSeed` | 删除 |
| `intent` | 唯一语义层 |
| `conceptPrompt` | 仅允许兼容期 fallback |

长期目标：

```text
事件系统只认 intent，不再依赖 promptSeed / conceptPrompt。
```

## 11. 兼容 V1.1 迁移策略

迁移必须分三阶段，不能把 `conceptPrompt -> intent.meaning` 当成最终方案。

原因：

```text
conceptPrompt 本身就是问题来源，它不是结构，只是文本残留。
```

### Phase 1：Compatibility Mode（运行期兼容）

目标：

```text
不崩。
```

规则：

```ts
if (event.intent) {
  useV2Intent(event.intent)
} else {
  fallbackV1(event.conceptPrompt)
}
```

允许临时映射：

```ts
intent.meaning = conceptPrompt
```

但只能用于兼容期，不能作为正式迁移质量。

### Phase 2：Structural Rewriting（结构重写）

目标：

```text
结构正确。
```

需要人工或半自动重写：

- `intent.type`
- `intent.meaning`
- `intent.tensionAxes`
- `intent.allowedOutcomes`
- `intent.emotionalTone`
- `tags`
- `category`

不推荐：

```text
LLM 自动迁移后直接入库。
```

原因：

- 会继承旧 `conceptPrompt` 的剧情写法。
- 会污染 intent 层。
- 会导致 V2 退化成“换了字段名的旧剧本库”。

推荐方式：

| 方式 | 结论 |
| --- | --- |
| LLM 自动迁移 | 只能辅助 |
| 人工重构核心事件 | 必须 |
| 混合审核 | 推荐 |

### Phase 3：Hard Cut（删除 fallback）

目标：

```text
系统纯净。
```

完成条件：

- 事件库核心事件全部有 `intent`。
- 渲染链路稳定使用 V2 prompt。
- `conceptPrompt` 不再参与生成。

最终动作：

```text
remove conceptPrompt dependency entirely
```

## 12. 事件库职责重新定义

V1 错误模型：

```text
事件库 = 小说脚本
```

V2 正确模型：

```text
事件库 = 人生压力/机会分布器
```

它只回答三个问题：

1. 现在人生有没有压力点？
2. 是哪一类压力？
3. 可选行动方向是什么？

## 13. 成功指标

V2 必须达到：

1. 不再出现重复事故剧情。
2. 同一事件在不同上下文下展开明显不同。
3. `null` 事件占比不低于 20%。
4. 用户感知从“看剧情”变成“过人生”。

用户体验目标：

```text
不是在看剧情，是在过人生。
```

## 14. V1.2 最小落地范围

本 spec 可以作为 V1.2 的架构换轨版本，不要求一次性完成完整 V2。

V1.2 必做：

1. 新增 `LifeEventSeedV2` 类型。
2. 新增 `EventTrigger.eligibility`。
3. 新增 `EventIntent`。
4. 统一 `cooldown` / `baseProbability` 到事件根字段。
5. 将 `allowedOutcomes` 定义为 action primitives。
6. 扩展并标准化 `category` 为 `career / relationship / health / financial / growth / opportunity`。
7. dispatcher 支持 V2 `intent`。
8. 正式化 `null event`。
9. tags 用于相似度去重与压力重复检测。
10. prompt 输入改为 Event Intent 模板。

V1.2 暂不做：

- 完整权重池系统。
- 复杂人生状态机。
- Script Context Library。
- 多事件并发。
- 自动大规模迁移工具。

## 15. 一句话总结

V2 的核心不是“加更多事件”，而是把事件库从“剧情脚本库”升级成“人生张力调度器”。Trigger 只判断可能性，Intent 定义人生张力，Render 负责根据用户真实上下文生成具体剧情。
