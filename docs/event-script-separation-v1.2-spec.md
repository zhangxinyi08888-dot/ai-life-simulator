# Deprecated Spec: 事件层与剧本层分离 V1.2

> 状态：已废弃。
>
> 本文档不再作为后续开发依据，仅保留为讨论过程记录。新的事件层与剧本层拆分方案应重新定义后再进入实现。

## 目标

将当前事件库从“半剧本驱动”改为“冲突种子驱动”。

事件库只负责定义：

- 发生了哪类人生冲突
- 属于哪个主题
- 强度多大
- 有哪些调度标签
- AI 应该从什么角度生成

不再写死：

- 具体场景
- 具体人物
- 具体事故
- 具体对话
- 具体选项文本

最终目标是减少剧情割裂、固定桥段复读和事件库维护成本。

## 当前问题

当前大量事件仍使用 `conceptPrompt`，内容过细。

例如 `career_corporate_politics` 当前包含：

- 公司架构调整
- 老领导
- 新高管
- 财务亏空
- 顶包
- 交把柄

这会导致 AI 把这些内容当作现实事实，即使用户当前人生状态并不适配，也会被强行拉入公司政治剧本。

问题本质：

```text
事件库承担了剧本职责
```

应该改成：

```text
事件库提供冲突
剧本层生成表现
```

## 核心原则

### 1. 事件不是剧本

```text
事件 = 冲突类型 + 触发条件 + 标签 + 生成指导
```

事件不是完整剧情。

### 2. 剧本必须贴合上下文，AI 需要根据：

- 用户真实信息
- 追问补全信息
- 历史选择
- 当前属性
- 历史 5 个节点状态

动态生成具体场景，并保持一定延续性。

### 3. 禁止把 promptSeed 当作事实

`promptSeed` 只能提供方向，不允许写死现实事实。

### 4. 事件库优先维护结构，剧本库维护表现素材

```text
Event Library：冲突骨架
Script Context Library：可选表现素材
AI：结合上下文生成具体剧情
```

## 数据结构调整

新增或统一事件结构：

```ts
interface LifeEventSeed {
  id: string;
  category: LifeEventCategory;
  conflictType: LifeConflictType;
  severity: "minor" | "major";
  tags: string[];
  cooldown?: number;
  minAge: number;
  maxAge: number;
  conditionDescription: string;
  check: (...) => boolean;
  promptSeed: PromptSeed;
}
```

`category` 保留为一级人生主题：

```ts
type LifeEventCategory =
  | "career"
  | "relationship"
  | "health"
  | "wealth"
  | "self_growth"
  | "opportunity";
```

新增 `conflictType`：

```ts
type LifeConflictType =
  | "opportunity"
  | "crisis"
  | "responsibility_shift"
  | "interest_conflict"
  | "betrayal"
  | "sacrifice"
  | "identity_choice"
  | "recovery"
  | "normal_transition";
```

新增 `severity`：

```ts
severity: "minor" | "major";
```

用途：

- 避免连续重大事件
- 控制剧情节奏
- 为后续状态机做准备

## promptSeed 标准

所有旧 `conceptPrompt` 逐步废弃，统一改为：

```ts
interface PromptSeed {
  core: string;
  contextGuidance: string[];
  optionDirections: string[];
}
```

字段解释：

`core`：

一句话定义冲突本质。

`contextGuidance`：

告诉 AI 如何结合用户历史生成具体场景。

`optionDirections`：

只给选择方向，不写死完整选项。

## 示例改造

旧事件：

```text
career_corporate_politics
```

不再写死：

- 老领导
- 新高管
- 财务亏空
- 顶包

新事件：

```ts
{
  id: "career_responsibility_shift",
  category: "career",
  conflictType: "responsibility_shift",
  severity: "major",
  tags: ["career", "responsibility_shift", "interest_conflict", "reputation_risk"],
  cooldown: 6,

  promptSeed: {
    core: "你被卷入一次责任与利益不对等的局面，需要决定是否承担不属于自己的代价。",
    contextGuidance: [
      "结合用户当前职业状态生成具体场景。",
      "如果用户在公司体系中，可以表现为项目背锅、绩效甩责或组织内耗。",
      "如果用户在创业或自由职业中，可以表现为合伙人甩锅、客户纠纷或合作项目责任转移。",
      "如果用户处于低谷或回乡阶段，可以表现为熟人社会、家庭事务或小组织中的责任压迫。",
      "重点体现责任、利益、名声和未来机会之间的不对称。"
    ],
    optionDirections: [
      "承担部分责任，换取未来机会或关系缓冲。",
      "公开切割，保护自己但承受关系和名声代价。",
      "寻找第三方、规则或谈判空间，争取更平衡的处理方式。"
    ]
  }
}
```

## Script Context Library

V1.2 可以先不复杂实现，但需要在 spec 里确立方向。

后续新增轻量剧本素材库：

```text
careerScenes
healthScenes
relationshipScenes
wealthScenes
selfGrowthScenes
```

示例：

```ts
healthScenes = [
  "体检异常",
  "睡眠崩溃",
  "慢病复发",
  "职业病",
  "情绪躯体化",
  "意外受伤"
]
```

注意：这些不是剧情，只是表现素材。

AI 需要根据：

```text
event.promptSeed
+
script context candidates
+
用户历史
```

生成具体节点。

## 调度规则

V1.2 仍延续 V1.1 的基础规则：

- `eventId` 冷却
- `eventTags` 冷却
- 同类事件限制
- 允许平稳生活节点

新增：

```text
severity 节奏控制
```

建议规则：

```text
最近 2 轮出现 major：
降低 major 事件概率，优先 minor / normal_transition

最近 3 轮出现 2 个以上危机：
优先 recovery / normal_transition / self_growth
```

## P1 改造范围

必须完成：

1. 所有 `conceptPrompt` 改为 `promptSeed`
2. 事件不再写死具体人物、场景、事故
3. 添加 `severity`
4. 添加 `conflictType`
5. 保留 `category` / `tags` / `cooldown` / `fingerprint`
6. 保持现有调度器可运行

不做：

- 权重池
- `focusBoost`
- 完整状态机
- 复杂剧本库
- 多事件并发

## 验收标准

### 1. 事件库中不再有 conceptPrompt

预期：

```text
LIFE_EVENTS_DATABASE 全部事件使用 promptSeed
```

### 2. 事件不包含强绑定剧本

不得出现类似：

- 老领导
- 新高管
- 财务亏空
- 雨夜骨折
- 固定城市
- 固定职业
- 固定亲属关系

### 3. 同一个事件能适配不同人生上下文

例如 `career_responsibility_shift`：

```text
公司员工 → 项目背锅
创业者 → 合伙人甩锅
自由职业者 → 客户责任纠纷
回县城 → 熟人社会责任压迫
```

### 4. 选项只给方向，不写死完整剧情

`optionDirections` 只能描述选择逻辑，不能提前替用户决定行动。

### 5. 重大事件不会连续压迫

连续 `major` 后，系统应更容易进入：

- `normal_transition`
- `recovery`
- `self_growth`

## 版本建议

```text
V1.2：
promptSeed 全量改造 + severity + conflictType

V1.3：
轻量 Script Context Library

V1.4：
baseWeight / weightRules / focusBoost

V2.0：
状态机 + 长线人生弧 + 多阶段剧情包
```

## 一句话总结

V1.2 的核心不是增加事件数量，而是把事件库从“写剧情”改成“定义冲突”。事件层只给 AI 一个可调度、可冷却、可组合的冲突种子；剧本层再根据用户真实上下文生成具体人生片段。
