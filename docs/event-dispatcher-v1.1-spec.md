# 事件调度器 V1.1 Spec

## 1. 背景

当前事件库位于 `src/data/lifeEvents.ts`，本质是一个剧情种子库。每次用户选择后，后端根据当前年龄和五维属性，从事件库中选一个事件，并把该事件的 `conceptPrompt` 注入下一轮 AI 生成提示词。

现有问题是事件选择逻辑过于刚性：`check()` 只返回命中或不命中。例如健康低于 40 时，`health_life_accident_lesson` 会被反复选中；事件本身又把“雨夜、骨折、轮椅线上协同、社群发帖”写得过死，导致 50 岁后出现连续相似剧情。

V1.1 的目标不是做完整状态机，也不是扩充大规模事件库，而是先把事件调度从“硬触发”升级为轻量的“带冷却、同类限制、抽象剧情种子”的调度器。

## 2. 目标

V1.1 只解决三个问题：

1. 防止同一个事件在短时间内反复触发。
2. 防止同一类事件连续压屏，例如健康事故连续出现。
3. 把写死的具体事件文本改成更抽象的 `promptSeed`，让 AI 根据用户历史动态渲染具体场景。
4. 为每个由事件库触发的历史节点保存轻量事件指纹，避免依赖 AI 生成标题或正文反推事件。

成功后，用户在低健康、低幸福、50 岁以后等高风险状态下，仍然可能遇到健康危机，但不会连续几轮都写成同一种“雨夜断骨”。

## 3. 非目标

V1.1 不做以下内容：

- 不做完整状态机，例如 `major_health_crisis -> recovery_arc -> income_pressure_arc`。
- 不做多事件并发，每轮仍然只选择一个主事件。
- 不做完整 `weightRules` 权重池。权重池放到 V1.2。
- 不做 `focusBoost` 主线加权。主线权重放到 V1.2。
- 不做复杂情绪调度。`moodType` 和 `activeTags` 放到 V1.3。
- 不大规模扩充事件库，只对必要事件做抽象化调整，并允许增加一个普通生活/平稳过渡种子。

## 4. 当前数据流

当前下一节点生成流程：

1. 前端在 `src/App.tsx` 中提交当前选择。
2. 请求体包含 `history`、`currentAttributes`、`selectedDecision`、`nodeIndex`。
3. 后端 `/api/simulator/next-node` 读取最后一个历史节点，计算 `fallbackAgeCheck = lastAge + 3`。
4. 后端调用 `queryDynamicLifeEvent(currentAttributes, userData, fallbackAgeCheck)`。
5. `queryDynamicLifeEvent` 从 `LIFE_EVENTS_DATABASE` 中筛选年龄和 `check()` 匹配的事件。
6. 随机选出一个事件。
7. 后端把事件标题和 `conceptPrompt` 注入 AI prompt。
8. AI 返回新的剧情节点。

V1.1 保持整体调用方式不变，只替换事件选择函数内部逻辑与事件字段表达。

## 5. V1.1 数据结构

### 5.1 事件字段

V1.1 后的事件仍保持兼容当前字段，但新增轻量字段：

```ts
interface LifeEventSeed {
  id: string;
  category: "career" | "relationship" | "health" | "opportunity";
  title: string;
  minAge: number;
  maxAge: number;
  conditionDescription: string;
  check: (attribs: LifeAttributes, userData: UserInitialData, age: number) => boolean;

  cooldown?: number;
  tags?: string[];
  fingerprint?: EventFingerprint;
  promptSeed?: PromptSeed;

  conceptPrompt?: string;
}
```

`conceptPrompt` 暂时保留兼容旧事件。新逻辑优先使用 `promptSeed` 渲染事件提示；如果事件还没有 `promptSeed`，再回退到 `conceptPrompt`。

### 5.2 事件指纹

事件冷却不能依赖 AI 生成的标题、正文或选项文本，因为同一个事件可能被模型写成“身体亮起红灯”“深夜急诊室”“不得不停下来的那个月”等不同标题。V1.1 必须引入稳定的事件指纹。

```ts
interface EventFingerprint {
  category: LifeEventSeed["category"];
  tags: string[];
  intensity?: "minor" | "major";
}
```

`fingerprint` 用于调度判断；`tags` 是核心依据。示例：

```ts
{
  id: "health_life_accident_lesson",
  category: "health",
  tags: ["health", "major_crisis", "forced_pause", "burnout"]
}
```

事件触发并生成节点后，历史节点必须保存轻量元数据：

```ts
eventMeta?: {
  eventId?: string;
  eventCategory?: LifeEventSeed["category"];
  eventTags: string[];
}
```

V1.1 最低要求保存 `eventTags` 和 `eventCategory`。`eventId` 建议同时保存，用于精确冷却；如果实现时暂不保存 `eventId`，也必须能通过 `eventTags` 完成同类限制。

### 5.3 promptSeed

`promptSeed` 是事件库与 AI 之间的新边界。事件库只给剧情指令，不直接写死最终剧情。

```ts
interface PromptSeed {
  core: string;
  contextGuidance: string[];
  forbidden: string[];
  optionDirections: string[];
}
```

字段含义：

- `core`：事件核心，例如“长期透支导致一次身体宕机，被迫暂停原有生活节奏”。
- `contextGuidance`：要求 AI 结合哪些上下文动态渲染。
- `forbidden`：禁止模型重复或写死的表达。
- `optionDirections`：本轮三个选项的大方向。

## 6. 冷却机制

### 6.1 冷却来源

V1.1 不依赖标题、正文、选择文案或关键词识别事件。冷却来源必须是历史节点上的事件元数据：

- `historyItem.eventMeta.eventId` 用于精确判断同一事件是否触发过。
- `historyItem.eventMeta.eventTags` 用于判断同类事件或相同事件指纹是否近期出现过。
- `historyItem.eventMeta.eventCategory` 用于类别连续限制。

如果历史中没有 `eventMeta`，说明是旧数据或无事件节点，不能把标题/正文当作可靠事实强行匹配。

### 6.2 事件 ID 冷却

规则：

- 每个事件可配置 `cooldown`。
- 默认冷却为 4 个历史节点。
- 最近 `cooldown` 个历史节点中，如果 `eventId` 相同，则排除。
- 若历史项没有 `eventId` 但 `eventTags` 与当前事件 `tags` 高度重合，也应按同一事件指纹降级处理，至少禁止再次触发同一强事件。
- 重大健康事故类事件建议冷却 8 个历史节点。

示例：

```ts
{
  id: "health_life_accident_lesson",
  cooldown: 8
}
```

### 6.3 冷却不改变属性

冷却只影响事件种子是否被选中，不修改用户属性。健康低仍然会保留在 prompt 中，但不会强行重复同一个事故事件。

### 6.4 冷却优先级

冷却规则的优先级高于同类事件限制、候选池回退和随机选择。被冷却的 `event.id` 不允许因为候选池为空而被回退选中。

## 7. 同类事件限制

### 7.1 类别连续限制

V1.1 规则：

- 检查最近 2 个历史节点。
- 如果最近 2 个节点的 `eventCategory` 相同，下一轮屏蔽该 category 的强事件。
- 如果候选池因此为空，可以放宽同类限制，但不能放宽事件 ID 冷却。

### 7.2 健康类特殊规则

健康类事件尤其容易复读。V1.1 对 `health` 增加更严格限制：

- 最近 2 个节点中只要出现过 `health + major_crisis` 指纹，就屏蔽 `health_life_accident_lesson`。
- 健康仍可在正文中作为背景压力出现，但不得再次作为主事件事故。

健康限制不识别“骨折、轮椅、摔倒、交通事故、失眠、脂肪肝、高血压”等剧情词。所有判断都来自 `eventTags`。

示例：

```ts
tags: ["health", "major_crisis", "forced_pause"]
```

如果最近历史已有这个指纹，本轮不得再次选择同类强健康危机。后续可以出现康复、调整作息、收入压力等派生内容，但 V1.1 不要求建立完整恢复期状态机。

## 8. 普通生活节点

V1.1 允许在没有合适事件时返回 `null`，让 AI 根据历史自然推进平稳生活。这个行为不是失败，而是重要的剧情节奏控制。

可选地新增一个低冲突普通生活种子：

```ts
{
  id: "life_normal_transition",
  category: "opportunity",
  title: "平稳生活与长期积累",
  minAge: 18,
  maxAge: 80,
  cooldown: 2,
  tags: ["normal_life", "transition", "breathing_room"],
  promptSeed: {
    core: "没有突发大事，生活进入一段平稳但仍有细小取舍的长期积累阶段。",
    contextGuidance: [
      "结合上一阶段选择，描述日常节奏、微小压力和普通人的长期取舍。",
      "不要强行制造事故、裁员、背叛或重大危机。",
      "让选项围绕继续积累、微调方向、修复关系或照顾身体。"
    ],
    forbidden: [
      "不要为了戏剧性强行引入灾难。",
      "不要重复最近发生过的重大事件。"
    ],
    optionDirections: [
      "维持当前节奏继续积累。",
      "做一次温和调整，降低未来风险。",
      "把注意力转向关系、健康或兴趣的修复。"
    ]
  }
}
```

如果 V1.1 暂不新增该事件，调度器也必须支持返回 `null`，并在后端 prompt 中明确提示 AI：本轮没有事件种子，不要强行制造大事，优先写平稳生活推进。

## 9. promptSeed 抽象化要求

### 9.1 health_life_accident_lesson 改造

当前坏例：

```text
因为极度缺觉，你在下雨天骑共享单车或赶地铁是不慎滑倒造成了骨折……
```

V1.1 应改为：

```ts
promptSeed: {
  core: "长期透支导致一次现实的身体宕机，被迫暂停原有生活节奏。",
  contextGuidance: [
    "结合上一阶段的职业选择、财务状况、居住状态和家庭支持度来决定具体表现。",
    "如果上一阶段是高压职场，可写体检异常、眩晕、慢病复发或急性炎症。",
    "如果上一阶段是副业奔波或体力消耗，可写现实意外或劳损加重。",
    "如果上一阶段是长期孤独和情绪压抑，可写失眠、焦虑躯体化或精神崩溃边缘。"
  ],
  forbidden: [
    "不要固定写雨夜骨折。",
    "不要连续重复轮椅办公、社群发帖。",
    "不要把健康危机写成无差别惩罚。"
  ],
  optionDirections: [
    "继续硬撑原计划，但承受身体和效率代价。",
    "接受停顿，重排生活节奏和工作方式。",
    "向家人、朋友、公司或医疗系统寻求现实支持。"
  ]
}
```

同时应配置稳定指纹：

```ts
tags: ["health", "major_crisis", "forced_pause", "burnout"],
fingerprint: {
  category: "health",
  tags: ["health", "major_crisis", "forced_pause", "burnout"],
  intensity: "major"
}
```

### 9.2 其他事件的兼容策略

V1.1 不要求一次性改造全部事件。优先改造：

1. `health_life_accident_lesson`
2. `health_hustle_burnout`
3. 其他在历史中容易复读的事件

未改造事件继续使用 `conceptPrompt`。

## 10. 事件提示词生成

后端应新增一个事件提示渲染函数：

```ts
function buildEventSeedPrompt(event: LifeEventSeed): string
```

如果存在 `promptSeed`，生成类似：

```text
【现实人生事件触发：身体宕机与生活暂停】
本轮只使用以下剧情指令，不要把它当成固定文本：
- 核心事件：长期透支导致一次现实的身体宕机，被迫暂停原有生活节奏。
- 上下文适配要求：
  1. 结合上一阶段的职业选择、财务状况、居住状态和家庭支持度来决定具体表现。
  2. ...
- 禁止：
  1. 不要固定写雨夜骨折。
  2. ...
- 选项方向：
  1. 继续硬撑原计划，但承受身体和效率代价。
  2. ...
```

如果不存在 `promptSeed`，继续使用旧的 `conceptPrompt`。

## 11. 调度函数改造

V1.1 建议把现有：

```ts
queryDynamicLifeEvent(attributes, userData, age)
```

升级为：

```ts
queryDynamicLifeEvent(attributes, userData, age, history)
```

内部流程：

1. 取年龄匹配且 `check()` 命中的候选事件。
2. 根据事件 `cooldown`、`eventId` 和 `eventTags` 排除近期重复事件。冷却事件不可回退。
3. 根据最近 2 个历史节点的 `eventCategory` 和 `eventTags` 做同类事件限制。
4. 如果过滤后仍有候选，从候选中随机选择。
5. 如果过滤后为空，只允许放宽同类限制，不允许放宽事件 ID 冷却。
6. 如果放宽同类限制后仍为空，返回 `null`，让 AI 自行推进常规生活节点。
7. 如果新增了 `life_normal_transition`，可在第 6 步前把它作为平稳节点候选，但它也要遵守自己的冷却。

V1.1 暂不做加权随机，只做过滤后随机。

## 12. 验收标准

### 12.1 低健康不复读

构造场景：

- 当前健康 < 40。
- 最近历史中已有 `eventMeta.eventId = "health_life_accident_lesson"`。

预期：

- 下一轮不得再次选择 `health_life_accident_lesson`。

### 12.2 标签指纹限制

构造场景：

- 最近历史中没有 `eventId`，但存在 `eventTags = ["health", "major_crisis", "forced_pause"]`。

预期：

- 下一轮不得再次选择带有相同强健康危机指纹的事件。
- 不得通过标题、正文或关键词来判断是否重复。

### 12.3 连续健康类限制

构造场景：

- 最近 2 个历史节点的 `eventCategory` 都是 `health`。

预期：

- 下一轮优先排除健康类主事件。
- 如果没有其他候选事件，可放宽同类限制，但不能放宽同一个健康事故事件的冷却。

### 12.4 promptSeed 不再写死事故

构造场景：

- 选中健康身体宕机事件。

预期：

- 注入 AI 的 prompt 中不得出现固定要求“雨夜滑倒骨折”。
- prompt 应要求 AI 根据用户上一阶段上下文动态选择具体健康表现。

### 12.5 兼容旧事件

构造场景：

- 事件没有 `promptSeed`，只有 `conceptPrompt`。

预期：

- 事件仍可正常被选中并注入 prompt。

### 12.6 平稳生活节点

构造场景：

- 年龄 45。
- 健康 60，财富 55，幸福 58。
- 最近发生过重大事件。

预期：

- 允许返回 `null`，由 AI 推进平稳生活。
- 如果实现了 `life_normal_transition`，允许返回该平稳节点。
- 不得为了“有事件”而强行制造事故、裁员、背叛或重大危机。

### 12.7 冷却优先于回退

构造场景：

- 第一层候选池只有 `health_life_accident_lesson`。
- 该事件仍在冷却期内。

预期：

- 不得回退选中 `health_life_accident_lesson`。
- 应返回 `null` 或平稳生活节点。

## 13. 测试计划

新增或更新测试：

1. `lifeEvents.test.ts`
   - 验证最近触发过的事件会被冷却排除。
   - 验证事件标签指纹能限制同类强事件。
   - 验证同类健康事件连续出现时会被限制。
   - 验证候选池为空时不会回退到冷却事件。
   - 验证可返回 `null` 或平稳生活节点。

2. `eventPrompt.test.ts`
   - 验证 `promptSeed` 能渲染成抽象剧情指令。
   - 验证旧 `conceptPrompt` 仍兼容。

3. 现有节点生成测试
   - 确认 `next-node` 仍能生成完整节点。
   - 确认事件为空时仍能走纯 AI 推演。

## 14. 交付范围

V1.1 应包含：

- 更新 `LifeEventSeed` 类型。
- 新增 `PromptSeed` 类型。
- 新增事件指纹与历史事件元数据字段。
- 更新 `queryDynamicLifeEvent` 参数与过滤逻辑。
- 新增事件提示渲染函数。
- 抽象化 `health_life_accident_lesson`。
- 至少为健康事故配置冷却期。
- 支持 `null` 或 `life_normal_transition` 平稳生活节点。
- 单元测试覆盖冷却、同类限制、promptSeed 渲染。
- 后端 `/api/simulator/next-node` 接入新的调度函数与提示渲染函数。

V1.1 不要求：

- 改 UI。
- 增加大量新事件。
- 引入完整状态机。
- 做权重池与 focusBoost。

V1.1 允许给 `HistoryItem` 增加可选的事件元数据字段，但不改变用户可见历史 UI。

## 15. 后续版本衔接

V1.1 的字段设计要为 V1.2/V1.3 留空间：

- V1.2 可在当前结构上加入 `baseWeight`、`weightRules`、`focusBoost`。
- V1.3 可加入 `moodType`、`activeTags`、轻量恢复期机制。
- V2.0 再考虑完整状态机、事件树和人生阶段系统。

因此 V1.1 的实现应避免把冷却逻辑写死在某一个事件里，而应作为通用事件调度能力实现。
