# 通用方向线索状态机最小修复 Spec

## 1. 背景

当前人生模拟已经有 `StoryContextPack`，会把用户真实事实、追问答案、最近历史、兴趣倾向和事实衰减规则注入下一轮 AI 生成。

现有问题不是某一个具体主题，例如“植物学”，而是一个通用系统问题：

```text
早期被提到的鲜明事实，被模型反复引用。
模型自己写出的重复内容，又进入最近历史。
最近历史被 prompt 要求优先延续。
于是早期事实被错误放大成长期主线。
```

这会发生在任何主题上：

- 植物、设计、写作、音乐等兴趣。
- 某个专业、城市、行业、公司。
- 某段关系、某个遗憾。
- 某种短期情绪，例如焦虑、不甘、想逃离。

核心问题是：系统目前没有严格区分“用户主动选择强化”与“模型叙事重复提及”，也没有定义一个方向线索当前最多能被用到什么程度。

## 2. 目标

用最小代码改动解决方向线索漂移问题：

1. 早期事实可以影响起点，但不能默认贯穿一生。
2. 只有用户主动选择、明确输入或形成现实成果，才强化某个事实。
3. 模型正文中的偶然提及，不再自动强化事实权重。
4. 低权重事实仍可作为生活细节，但不得进入职业、创业、人生使命、重大转型选项。
5. 不针对“植物”写死规则，必须泛化到任意兴趣、行业、关系、地点、身份标签。
6. 每个方向线索都必须有明确状态：提到过、背景细节、副线、阶段主线、长期主线。

## 3. 非目标

本次不做：

- 不重构完整事件系统。
- 不重构完整持久化状态系统。
- 不做复杂 NLP 主题抽取。
- 不接入向量检索或长期记忆系统。
- 不改变页面交互流程。
- 不改变现有 AI API 调用方式。

本次只做现有事实权重逻辑的轻量升级，用派生状态实现“方向线索状态机”，优先避免大规模存储和事件系统改造。

## 4. 核心产品原则

### 4.1 人生由选择强化，不由开头一句话锁死

用户早期提到某个事实，只代表当时的背景或可能性。

例如：

```text
18 岁：我喜欢植物。
```

默认含义：

```text
用户当时有一个兴趣倾向。
```

不能直接推导为：

```text
用户未来一定从事植物行业。
用户中年一定转型植物学。
用户终章一定围绕植物总结。
```

### 4.2 用户选择高于模型复读

权重强化来源必须按优先级区分：

```text
用户点击选项 / 自定义输入
> 用户追问答案明确长期投入
> 历史中由用户选择导致的现实成果
> 模型正文偶然提及
```

模型正文偶然提及只能作为上下文，不应增加主线权重。

### 4.3 最近历史要过滤“模型自我强化”

现在 prompt 里要求“优先延续最近 5 个历史节点”，但最近历史里可能包含模型随手写出来的旧主题。

因此最近历史不能无条件强化所有词。

只有以下内容可以强化事实：

- `selectedChoice` 中出现该事实。
- 用户自定义选择中出现该事实。
- 节点标题或正文出现该事实，并且本节点的 `selectedChoice` 也指向同一事实。
- 节点形成明确现实成果，例如作品、职业身份、收入、证书、团队、项目上线。

如果事实只出现在正文里，而用户选择没有指向它，视为 `model_mention`，不强化。

## 5. 最小实现策略

### 5.1 增加方向线索状态

在现有 `StoryFact` 逻辑上增加一个派生字段，不要求大改数据结构：

```ts
type DirectionSignalState =
  | "mentioned"
  | "background_detail"
  | "side_thread"
  | "stage_main_arc"
  | "long_term_main_arc";
```

含义：

- `mentioned`：用户或历史中提到过，但本轮不主动注入；需要时只能作为“曾经提过”。
- `background_detail`：只能作为生活细节，例如偶尔想起、路过时注意到、休闲内容。
- `side_thread`：可以作为副线出现，但不能主导职业、创业、重大转型、人生使命。
- `stage_main_arc`：可以成为当前阶段主线，例如一段时间的项目、学习方向、短期转型尝试。
- `long_term_main_arc`：可以进入长期人生主线、终章、报告核心洞察。

这套状态适用于所有“方向线索”，包括：

- 兴趣：植物、写作、音乐、游戏、设计。
- 专业和行业：计算机、金融、教育、医疗、农业。
- 地点：某城市、出国、回老家。
- 身份：创业者、教师、自由职业者、管理者。
- 关系和议题：家庭责任、亲密关系、健康焦虑。

### 5.2 默认状态

早期提到的方向，默认最多只能到 `background_detail`。

例如：

```text
18 岁：喜欢植物。
```

默认允许：

```text
路过公园会认出植物。
偶尔看植物内容。
某次选择时想起早年兴趣。
```

默认禁止：

```text
创业一定做植物 App。
56 岁转型植物学。
人生终章围绕植物写一生主线。
```

### 5.3 使用现有字段计算 directionState

不新增持久化存储，先用现有信息动态计算：

```ts
function resolveDirectionSignalState(signal, history) {
  const userReinforcementCount = countUserChoiceReinforcements(signal, history);
  const outcomeCount = countUserChoiceOutcomes(signal, history);
  const unselectedCount = countConsecutiveUnselected(signal, history);

  const reinforcedState =
    userReinforcementCount >= 3 && outcomeCount >= 1
      ? "long_term_main_arc"
      : userReinforcementCount >= 2
        ? "stage_main_arc"
        : userReinforcementCount >= 1
          ? "side_thread"
          : "background_detail";

  return applyUnselectedDecayCap(reinforcedState, unselectedCount);
}

function applyUnselectedDecayCap(state, unselectedCount) {
  if (unselectedCount >= 5) return "mentioned";
  if (unselectedCount >= 3) return minState(state, "background_detail");
  if (unselectedCount >= 1) return minState(state, "background_detail");
  return state;
}
```

现有 `promotedToArc` 可以先保留兼容，但判定必须收紧：

```text
directionState = stage_main_arc 或 long_term_main_arc 时，promotedToArc 才能为 true。
```

模型正文提及不参与 `promotedToArc`。

### 5.4 区分用户选择强化与模型提及

在 `storyContext.ts` 中将现有 `countRecentMentions` 拆成两个概念：

```ts
countUserChoiceReinforcements(topic, recentHistory)
countUserChoiceOutcomes(topic, recentHistory)
countConsecutiveUnselected(topic, recentHistory)
countModelMentions(topic, recentHistory)
```

最小版本必须实现前三个：

```text
检查 recentHistory.selectedChoice。
如果 selectedChoice 包含该主题，算用户选择强化。
如果 selectedChoice 是“继续推进”“保持现状”等泛化词，不算。
检查 selectedChoice 指向后的节点结果。
如果形成作品、收入、身份、长期项目等结果，算现实成果。
从最近节点向前检查，直到遇到该方向的用户选择，统计连续未选择次数。
```

可选增强：

```text
如果 selectedChoice 是自定义抉择，也同样算用户选择强化。
```

不再用 `title + description + selectedChoice` 整体计数来强化兴趣。

`countModelMentions` 是调试和 reason 文案增强项；即使不落字段，也必须保证模型提及永远不增加 `userReinforcementCount`。

### 5.5 强化条件

只有这些行为能让方向升级：

```text
+1 用户点击了该方向选项
+1 用户自定义输入明确写了该方向
+1 最近历史中该方向由用户选择导致，而不是模型随手写进正文
+1 该方向产生现实成果，例如作品、收入、职业身份、长期项目、用户、证书、合作
+1 追问答案明确长期投入、已有能力、已有作品、正在实践
```

升级规则：

```text
0 次用户强化：mentioned 或 background_detail
1 次用户强化：side_thread
2 次用户强化：stage_main_arc
3 次以上用户强化，且至少 1 次现实成果：long_term_main_arc
```

### 5.6 衰减条件

如果用户连续几次没有选择某方向，就降低允许使用范围：

```text
1-2 个节点没选：最多 background_detail，只能作为生活细节。
3-5 个节点没选：不再主动出现在职业、创业、专业转向选项里。
5 个节点以上没选：正文也不主动使用；终章/报告最多作为“曾经的兴趣”提一次。
```

实现上采用“强化先算，衰减封顶”：

```text
先根据用户选择和现实成果算出理论状态。
再根据连续未选择次数给本轮使用范围设置上限。
```

这样可以避免“早年选择过一次，之后多年没再选择，却永远保留副线/主线资格”。

尤其禁止：

```text
模型自己写了一次方向 A
→ 最近历史出现方向 A
→ 下一轮继续强化方向 A
```

这属于模型自我强化，必须不计入方向状态升级。

### 5.7 Prompt 输出改成按状态展示

现有 `formatStoryContextPack` 会把所有用户事实、兴趣倾向完整展示给模型。

最小改法：

1. `兴趣倾向` 和其他方向线索按 `directionState` 输出。
2. `mentioned` 不输出原文或只输出“曾经提过”，避免鲜明词持续诱导模型。
3. `background_detail` 明确写“只能作为生活细节”。
4. `side_thread` 明确写“可作为副线，不得主导重大职业转型”。
5. `stage_main_arc` 才允许进入当前阶段的职业、项目、学习方向。
6. `long_term_main_arc` 才允许进入人生终章、长期报告核心。

示例 prompt：

```text
【方向线索使用边界】
- long_term_main_arc：可作为长期人生主线。
- stage_main_arc：可作为当前阶段主线。
- side_thread：可延续为副线，但不得主导职业/创业/人生使命。
- background_detail：只能作为生活细节，不能出现在重大选择选项中。
- mentioned：本轮不要主动展开，终章/报告最多作为曾经提过。

【兴趣倾向】
- 喜欢植物（state=background_detail，reason=早期提到，最近没有用户选择强化）
```

这比单纯写“不得升级”更硬，因为模型能看到每条事实的允许使用范围。

### 5.8 生成选项约束

在 `eventPrompt.ts` 和 `buildNextNodePrompt` 中增加一条通用约束：

```text
生成 A/B/C 选项时：
- 只有 state=stage_main_arc 或 long_term_main_arc 的方向可以成为职业、创业、重大转型方向。
- state=background_detail 的方向不得进入选项主语。
- state=side_thread 的方向最多作为附带考虑，不得成为三选项中的核心路线。
- state=mentioned 的方向不得主动出现在选项中。
```

这能直接防止：

```text
减少项目量，系统学习植物学知识，尝试转型植物领域
```

这种“用户没选过，但模型硬塞进选项”的情况。

## 6. 推荐权重规则

### 6.1 初始事实默认权重

沿用现有大方向：

```text
long_term_fact: 0.9
stage_fact: 0.75
interest_signal: 0.45
temporary_emotion: 0.35
```

但对 `interest_signal` 和部分 `stage_fact` 增加使用边界。

### 6.2 兴趣/方向类事实状态

```text
mentioned: 提到过，但最近长期未被选择或不适合主动展开
background_detail: 默认状态，只能当生活细节
side_thread: 用户选择过 1 次，可以作为副线
stage_main_arc: 用户选择过 2 次以上，可以成为阶段主线
long_term_main_arc: 用户选择过 3 次以上且有现实成果，可以成为长期主线
```

### 6.3 强化条件

加权只来自用户行为或现实成果：

```text
+1 用户选择文本包含该事实
+1 用户自定义输入包含该事实
+1 追问答案明确“长期投入/长期热爱/已经有作品或能力”
+1 最近历史里形成现实成果，且 selectedChoice 指向该事实
```

### 6.4 不强化条件

以下情况不增加权重：

```text
模型正文偶然提到。
模型标题偶然提到。
选项标签偶然提到，但用户没有点击。
最近历史里出现该词，但 selectedChoice 没有指向它。
```

### 6.5 高权重事实的降噪

即使某个方向初始权重较高，只要后续用户持续没有选择，也要按衰减规则降低使用边界。

高权重代表“重要背景”，不等于“永远主线”。

## 7. 代码改动范围

### 7.1 `src/utils/storyContext.ts`

最小改动：

1. 增加 `DirectionSignalState` 类型。
2. 给 `StoryFact` 增加可选字段：

```ts
directionState?: DirectionSignalState;
stateReason?: string;
userReinforcementCount?: number;
modelMentionCount?: number;
consecutiveUnselectedCount?: number;
```

3. 替换 `countRecentMentions` 的强化逻辑。
4. 新增 `resolveDirectionSignalState`。
5. `formatStoryContextPack` 输出方向线索使用边界。
6. 保留现有 `promotedToArc` 兼容旧逻辑，但只允许由 `stage_main_arc` 或 `long_term_main_arc` 推导。

### 7.2 `src/utils/eventPrompt.ts`

增加选项生成边界：

```text
不得把 state=background_detail 或 mentioned 的方向写成职业、创业、重大转型选项。
state=side_thread 的方向不能成为三选项主路线。
```

### 7.3 `src/services/simulation/prompts.ts`

增加同样的通用约束，避免无事件时也漂移。

不需要改 `App.tsx`、页面组件、事件库结构。

## 8. 测试策略

### 8.1 单元测试：未选择则不强化

输入：

```text
初始事实：喜欢某个兴趣 A。
最近历史正文多次出现兴趣 A。
selectedChoice 从未选择兴趣 A。
```

期望：

```text
reinforcementCount = 0
promotedToArc = false
directionState = background_detail 或 mentioned
prompt 中明确禁止它成为职业/创业/重大转型选项
```

### 8.2 单元测试：用户选择才强化

输入：

```text
初始事实：喜欢兴趣 A。
最近两次 selectedChoice 都选择兴趣 A 方向。
```

期望：

```text
reinforcementCount >= 2
promotedToArc = true
directionState = stage_main_arc
```

### 8.3 单元测试：长期主线必须有成果

输入：

```text
初始事实：喜欢兴趣 A。
最近三次 selectedChoice 都选择兴趣 A 方向。
其中一次形成作品、收入、职业身份、长期项目、用户、证书或合作。
```

期望：

```text
directionState = long_term_main_arc
可以进入终章和人生洞察报告核心。
```

### 8.4 单元测试：连续未选择会衰减

输入：

```text
初始事实：喜欢兴趣 A。
历史正文多次出现兴趣 A。
用户连续 5 个节点没有选择兴趣 A 方向。
```

期望：

```text
directionState = mentioned
prompt 不再主动展开该方向。
终章/报告最多作为“曾经的兴趣”提一次。
```

### 8.5 单元测试：泛化主题

不要只测植物。

至少覆盖：

- 植物
- 写作
- 游戏
- 某城市
- 某行业

### 8.6 Prompt 测试

验证 `buildEventIntentPrompt` 和 `buildNullEventPrompt` 输出包含：

```text
方向线索使用边界
state=background_detail
不得写成职业、创业、重大转型选项
模型正文偶然提及不计入强化
```

## 9. 验收标准

1. 用户早期提到某兴趣，但后续未选择该方向时，中后期节点不得主动把它写成职业转型或创业方向。
2. 模型正文里偶然重复某主题，不会导致该主题升级为主线。
3. 用户连续选择某主题方向后，该主题可以升级为主线。
4. 规则对任意主题有效，不依赖“植物”等硬编码。
5. 改动范围只涉及 story context 和 prompt builder，不影响 UI 流程。
6. 一次选择只能升级为副线，两次选择才能成为阶段主线，三次以上且有现实成果才能成为长期主线。

## 10. 示例

### 10.1 错误结果

```text
18 岁提到喜欢 A。
用户后续选择都围绕高薪项目、家庭、健康。
56 岁系统生成：转型 A 相关领域。
```

错误原因：

```text
A 只是早期兴趣，没有用户选择强化。
```

### 10.2 正确结果

```text
18 岁提到喜欢 A。
后续用户没有选择 A。
56 岁系统可以写：偶尔想起早年的兴趣 A。
但选项应围绕当前真实主线：项目量、健康恢复、远程工作、家庭关系、财务安排。
```

### 10.3 可升级结果

```text
18 岁提到喜欢 A。
22 岁选择学习 A。
28 岁选择用 A 做作品。
34 岁选择把 A 变成收入来源。
```

此时 A 可以成为职业主线，因为它已经被用户多次选择强化。

## 11. 推荐结论

本次最小修复不需要重做人生模拟器。

只要把方向线索分成：

```text
用户选择强化
模型文本提及
```

并把每条方向输出为：

```text
mentioned / background_detail / side_thread / stage_main_arc / long_term_main_arc
```

就能从系统层面解决“某个早期事实反复贯穿一生”的问题。

关键原则：

```text
模型可以记得用户说过什么，但不能替用户把它选成一生主线。
```
