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

成功后，用户在低健康、低幸福、50 岁以后等高风险状态下，仍然可能遇到健康危机，但不会连续几轮都写成同一种“雨夜断骨”。

## 3. 非目标

V1.1 不做以下内容：

- 不做完整状态机，例如 `major_health_crisis -> recovery_arc -> income_pressure_arc`。
- 不做多事件并发，每轮仍然只选择一个主事件。
- 不做完整 `weightRules` 权重池。权重池放到 V1.2。
- 不做 `focusBoost` 主线加权。主线权重放到 V1.2。
- 不做复杂情绪调度。`moodType` 和 `activeTags` 放到 V1.3。
- 不大规模扩充事件库，只对必要事件做抽象化调整。

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
  promptSeed?: PromptSeed;

  conceptPrompt?: string;
}
```

`conceptPrompt` 暂时保留兼容旧事件。新逻辑优先使用 `promptSeed` 渲染事件提示；如果事件还没有 `promptSeed`，再回退到 `conceptPrompt`。

### 5.2 promptSeed

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

V1.1 不要求前端新增 `eventId` 到历史结构。为了降低改动成本，后端可以先根据历史文本和事件标题做轻量识别：

- 若最近历史节点标题、描述或选择中出现当前事件标题，视为近期触发过。
- 若最近历史节点中出现当前事件的关键 `tags`，视为同类近期出现过。
- 后续版本可把 `eventId` 正式写入 `HistoryItem`，但 V1.1 不强制。

### 6.2 事件 ID 冷却

规则：

- 每个事件可配置 `cooldown`。
- 默认冷却为 4 个历史节点。
- 最近 `cooldown` 个历史节点中疑似出现过该事件，则排除。
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

## 7. 同类事件限制

### 7.1 类别连续限制

V1.1 规则：

- 检查最近 2 个历史节点。
- 如果最近 2 个节点都疑似属于同一个 `category`，下一轮屏蔽该 category 的强事件。
- 如果候选池因此为空，则放宽限制，避免无事件可选。

### 7.2 健康类特殊规则

健康类事件尤其容易复读。V1.1 对 `health` 增加更严格限制：

- 最近 2 个节点中只要出现过明确健康事故关键词，就屏蔽 `health_life_accident_lesson`。
- 健康仍可在正文中作为背景压力出现，但不得再次作为主事件事故。

健康事故关键词包括：

- 骨折
- 轮椅
- 摔倒
- 交通事故
- 雨夜断骨
- 身体宕机
- 入院

这些关键词只用于 V1.1 的粗粒度去重，不作为长期语义系统。

## 8. promptSeed 抽象化要求

### 8.1 health_life_accident_lesson 改造

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

### 8.2 其他事件的兼容策略

V1.1 不要求一次性改造全部事件。优先改造：

1. `health_life_accident_lesson`
2. `health_hustle_burnout`
3. 其他在历史中容易复读的事件

未改造事件继续使用 `conceptPrompt`。

## 9. 事件提示词生成

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

## 10. 调度函数改造

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
2. 根据事件 `cooldown` 和历史文本排除近期重复事件。
3. 根据最近 2 个历史节点做同类事件限制。
4. 如果过滤后仍有候选，从候选中随机选择。
5. 如果过滤后为空，回退到第一步候选池，避免完全无事件；但同一个 `event.id` 的冷却仍必须生效，尤其不能立即回退到刚发生过的健康事故事件。
6. 如果第一步候选池也为空，则返回 `null`，让 AI 自行推进常规生活节点。

V1.1 暂不做加权随机，只做过滤后随机。

## 11. 验收标准

### 11.1 低健康不复读

构造场景：

- 当前健康 < 40。
- 最近历史中已经出现 `health_life_accident_lesson` 或包含“骨折/轮椅/摔倒”等关键词。

预期：

- 下一轮不得再次选择 `health_life_accident_lesson`。

### 11.2 连续健康类限制

构造场景：

- 最近 2 个历史节点都明显是健康类事件。

预期：

- 下一轮优先排除健康类主事件。
- 如果没有其他候选事件，可回退，但不能再次选择同一个健康事故事件。

### 11.3 promptSeed 不再写死事故

构造场景：

- 选中健康身体宕机事件。

预期：

- 注入 AI 的 prompt 中不得出现固定要求“雨夜滑倒骨折”。
- prompt 应要求 AI 根据用户上一阶段上下文动态选择具体健康表现。

### 11.4 兼容旧事件

构造场景：

- 事件没有 `promptSeed`，只有 `conceptPrompt`。

预期：

- 事件仍可正常被选中并注入 prompt。

## 12. 测试计划

新增或更新测试：

1. `lifeEvents.test.ts`
   - 验证最近触发过的事件会被冷却排除。
   - 验证同类健康事件连续出现时会被限制。
   - 验证候选池为空时可回退。

2. `eventPrompt.test.ts`
   - 验证 `promptSeed` 能渲染成抽象剧情指令。
   - 验证旧 `conceptPrompt` 仍兼容。

3. 现有节点生成测试
   - 确认 `next-node` 仍能生成完整节点。
   - 确认事件为空时仍能走纯 AI 推演。

## 13. 交付范围

V1.1 应包含：

- 更新 `LifeEventSeed` 类型。
- 新增 `PromptSeed` 类型。
- 更新 `queryDynamicLifeEvent` 参数与过滤逻辑。
- 新增事件提示渲染函数。
- 抽象化 `health_life_accident_lesson`。
- 至少为健康事故配置冷却期。
- 单元测试覆盖冷却、同类限制、promptSeed 渲染。
- 后端 `/api/simulator/next-node` 接入新的调度函数与提示渲染函数。

V1.1 不要求：

- 改 UI。
- 改用户历史数据结构。
- 增加大量新事件。
- 引入完整状态机。
- 做权重池与 focusBoost。

## 14. 后续版本衔接

V1.1 的字段设计要为 V1.2/V1.3 留空间：

- V1.2 可在当前结构上加入 `baseWeight`、`weightRules`、`focusBoost`。
- V1.3 可加入 `moodType`、`activeTags`、轻量恢复期机制。
- V2.0 再考虑完整状态机、事件树和人生阶段系统。

因此 V1.1 的实现应避免把冷却逻辑写死在某一个事件里，而应作为通用事件调度能力实现。
