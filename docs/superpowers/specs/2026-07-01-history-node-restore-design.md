# 生平纪事历史节点恢复方案

## 背景

当前“生平纪事”中的“时光逆流 回到此岁”按钮并不会恢复用户曾经走到的历史节点。它会把目标年龄传给 `handleTimeTravel`，再调用 `timeTravel()` 服务，让 AI 在同一年龄重新生成一个新的节点。

这导致用户感受到的行为是“回退后内容变了”，而不是“回到历史上的那个节点重新选择”。当前实现还存在一个额外隐患：回退定位只使用 `age`，如果前期推演中多个节点同岁，点击后可能命中第一个同龄节点，而不是用户实际点的那一条。

用户已明确选择方案 A：点击历史记录应恢复历史节点快照，让用户重新选择。只有用户重新做出选择后，才生成新的后续分支。

## 目标

- 点击生平纪事中的历史节点后，恢复该历史节点当时的标题、正文、阶段、年龄、属性和选项。
- 回退动作本身不调用 AI，不生成新节点，不改变节点正文。
- 用户在恢复后的节点上重新选择 A/B/C 或自定义选择后，再按现有 `generateNextNode()` 流程生成新的后续节点。
- 回退时截断目标节点之后的历史，让新选择覆盖旧分支。
- 支持同龄多节点，点击哪一条就恢复哪一条。
- 保持当前视觉结构和主要交互文案基本不变。

## 非目标

- 不重写整体模拟状态机。
- 不新增本地持久化、存档槽或分支树浏览器。
- 不要求 AI 复刻历史节点。
- 不在本轮调整故事生成 prompt。
- 不在本轮设计多分支并行查看能力；旧分支被截断后不保留在 UI 中。

## 推荐方案

采用“历史节点快照恢复”。

历史记录不再只保存用户选过的节点摘要，还要保存足够的信息来重建一个 `SimulationNode`。当用户点击历史项时，前端直接把该历史项转换回 `currentNode`，并截断历史数组。

核心原则：

- 历史节点恢复是本地状态操作。
- 新分支生成只发生在用户重新选择之后。
- 目标历史项用数组下标定位，不用年龄定位。

## 数据模型

当前 `HistoryItem` 缺少 `choices` 和 `isEndingNode`，无法完整恢复为可交互节点。需要扩展为：

```ts
export interface HistoryItem {
  age: number;
  title: string;
  stage: string;
  description: string;
  selectedChoice: string;
  attributes: LifeAttributes;
  choices: SimulationChoice[];
  isEndingNode: boolean;
  eventMeta?: EventMeta;
}
```

创建历史记录时，从当前节点拷贝：

```ts
choices: currentNode.choices,
isEndingNode: currentNode.isEndingNode
```

`selectedChoice` 仍然保留，用于生平纪事中展示“上一次这条线选择了什么”。恢复节点后，用户可以选择同一个选项，也可以改选其他选项或输入自定义选择。

当前应用没有持久化旧历史记录，因此不需要设计历史数据迁移。为了开发期热更新和防御性兼容，可以在恢复时对缺失 `choices` 的历史项禁用按钮或显示错误提示，但生产主路径应保证新创建的历史项一定带有 `choices`。

## 交互流程

### 生平纪事中回退

1. 用户打开“生平纪事”。
2. 用户点击某一条历史记录的“时光逆流 回到此岁”。
3. 抽屉关闭。
4. 主阅读区显示被点击历史节点的原始正文和原始选项。
5. 生平纪事只保留该节点之前的历史。
6. 用户重新选择后，系统从该节点开始生成新的后续分支。

### 终局报告中回退

终局报告里的“逆回此岁”应使用同一套恢复逻辑。点击后退出报告页，回到模拟页，并恢复对应历史节点。

终局报告当前只允许非最后一条历史记录回退。这个限制可以保留，因为最后一条通常是终局节点或报告入口，不一定是适合重新分支的普通互动节点。

## 状态流

将 `onTimeTravel(targetAge: number)` 改为按下标传参：

```ts
onTimeTravel(targetIndex: number)
```

恢复逻辑：

```ts
const targetItem = history[targetIndex];
const restoredNode: SimulationNode = {
  age: targetItem.age,
  stage: targetItem.stage,
  title: targetItem.title,
  description: targetItem.description,
  choices: targetItem.choices,
  attributes: targetItem.attributes,
  isEndingNode: targetItem.isEndingNode,
  eventMeta: targetItem.eventMeta
};

setAttributes(targetItem.attributes);
setCurrentNode(restoredNode);
setHistory(history.slice(0, targetIndex));
setNodeCount(targetIndex + 1);
setStep("simulating");
```

这个流程不调用 `runTimeTravel()`。

## 组件改动范围

### `src/types.ts`

- 给 `HistoryItem` 增加 `choices` 和 `isEndingNode`。

### `src/App.tsx`

- 创建普通历史记录和终局历史记录时保存完整节点快照字段。
- 将 `handleTimeTravel(targetAge)` 改为 `handleRestoreHistoryNode(targetIndex)` 或同等语义命名。
- 删除恢复历史节点流程中的 `runTimeTravel()` 调用。
- 通过 `targetIndex` 查找历史项，避免同龄节点冲突。
- 恢复后切回 `simulating` 步骤。

### `src/components/SimulationEngine.tsx`

- `onTimeTravel` 参数从年龄改为历史下标。
- 历史抽屉点击时传 `idx`。
- 按钮文案可以暂时保留，但更准确的文案建议改为“回到此处重选”。

### `src/components/DestinyReport.tsx`

- `onTimeTravel` 参数从年龄改为历史下标。
- 终局报告历史列表点击时传 `i`。
- 按钮文案建议改为“回到此处重选”。

### `src/services/simulation/simulationService.ts`

- 暂时保留 `timeTravel()`，但本功能不再调用它。
- 后续如果没有独立“生成同岁新分支开场”的产品入口，可以再单独删除或重命名该服务。

## 边界情况

### 同岁多节点

用历史下标定位后，多个节点同岁也能精确恢复用户点击的那一条。

### 自定义选择

历史项保存的是上一次的 `selectedChoice`，恢复节点保存的是原始 `choices`。用户仍可通过现有自定义入口重新输入新选择。重新选择后，新的历史项会记录新的 `selectedChoice`。

### 恢复后再次回退

恢复节点时历史已被截断到目标节点之前，因此该节点本身不再出现在生平纪事中。用户做出新选择后，该节点会再次作为新历史项加入历史，之后可以继续回退。

### 恢复结局节点

模拟页中的历史抽屉可以展示所有已记录节点。若某个历史项是 `isEndingNode: true`，恢复后会显示结局按钮。终局报告可以继续禁止最后一条回退，降低恢复结局节点后流程混乱的风险。

### AI 请求失败

恢复历史节点不涉及 AI 请求，因此不应出现 AI 请求失败。只有用户重新选择生成后续节点时，才沿用现有错误处理。

## 测试计划

### 单元或组件逻辑测试

新增或调整测试覆盖以下行为：

- 创建 `HistoryItem` 时保存 `choices` 和 `isEndingNode`。
- 恢复历史节点时不调用 `timeTravel()` 或 AI caller。
- 恢复后 `currentNode` 的 `age/title/stage/description/choices/attributes/isEndingNode` 与目标历史项一致。
- 恢复后 `history` 等于目标节点之前的历史片段。
- 恢复第二个同龄历史节点时，不会误恢复第一个同龄节点。
- 从终局报告点击历史项时，也按下标恢复正确节点。

### 手动验证

1. 完成至少三个模拟节点。
2. 打开生平纪事，点击第二个节点。
3. 确认页面显示第二个节点原文和原选项。
4. 确认没有出现“时空线收束整理中”的 AI 生成等待，或等待时间只来自普通 UI 切换。
5. 重新选择一个不同选项。
6. 确认新生成的后续节点接在第二个节点之后，旧的后续历史被截断。
7. 制造两个同龄节点，确认点击第二个同龄节点能恢复第二个。

## 验收标准

- 点击历史节点后，当前章节内容与历史抽屉中该条记录一致。
- 点击历史节点不会调用 `timeTravel()`。
- 用户可以在恢复后的节点重新选择。
- 重新选择后只生成目标节点之后的新分支。
- 同龄节点按点击项精确恢复。
- TypeScript 检查通过，相关测试通过。

