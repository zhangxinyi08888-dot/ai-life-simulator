# 自然收束与报告邀请 Spec

## 1. 背景

当前模拟只有年龄、健康概率命中的生理终局。即使一条 `PressureArc` 已经解决，用户仍会继续经历新的事件，直到角色死亡；完整体验通常需要大量选择。

本次改动不增加新的强制终局，也不以固定轮次替代原有年龄终局。系统只在叙事已经形成阶段性答案时展示报告邀请，由用户决定结束本次推演或继续人生。

## 2. 产品目标

- 大多数未提前触发生理终局的用户，在完成 12–17 次选择之间获得第一次自然收束机会。
- 用户可以在合适的叙事节点主动查看“这段人生”的报告。
- 用户拒绝邀请后可以无限继续，直到再次出现合适节点或触发原有生理终局。
- 报告邀请不打断危机，不把阶段性收束叙述成角色死亡。

“12–17 次获得机会”是产品观测目标，不是结局规则。不得实现第 17 或第 18 次强制结束、强制邀请或强制生成反思结局。

## 3. 本次真正的结束类型

系统只保留两种结束：

```ts
export type SimulationClosureType =
  | "user_reflection"  // 用户在报告邀请中主动查看报告
  | "mortality";       // 年龄、健康或最高年龄触发生理终局
```

### 3.1 生理终局

继续使用现有 `evaluateEnding()` 和 `EndingPolicy`：

- 命中年龄、健康概率或 `hardMaximumAge` 时，直接生成现有死亡终章。
- 生理终局优先级最高。
- 生理终局节点不得同时展示报告邀请卡。
- 不修改现有 73 岁后进入概率终局、110 岁硬结束的规则。

### 3.2 用户主动收束

- 报告邀请本身不是结局。
- 只有用户点击“查看这段人生的报告”后，本次推演才结束并进入报告页。
- 用户主动收束不生成死亡节点，不恶化健康值，不修改角色当前属性。
- 报告应使用“截至此刻”“这段人生”“已经走过的路”等表达，不得暗示角色已经死亡或完整寿命已经结束。

## 4. 选择次数定义

统一使用 `completedChoiceCount`，计算方式为当前分支的 `history.length`。

计入一次选择：

- 用户提交一个 A/B/C 预设选项；
- 用户提交一个自定义选择。

不计入选择：

- 初始出生节点；
- 点击“继续走下去”；
- 点击“查看这段人生的报告”；
- 报告生成重试。

时光回溯后，以截断后的当前分支 `history.length` 重新计算。不得使用界面上的 `nodeCount` 作为邀请判定依据。

## 5. 报告邀请判定

新增独立的纯函数 `evaluateReportInvitation()`。它不得并入 `evaluateEnding()`，因为前者只决定是否展示邀请，后者决定是否直接进入生理终局。

```ts
export type ReportInvitationReason = "arc_resolved" | "stable_window";

export interface ReportInvitationDecision {
  shouldInvite: boolean;
  reason?: ReportInvitationReason;
  triggerKey?: string;
  pressureArcId?: string;
  resolutionEvidence?: string[];
  reasonCodes: string[];
}
```

判定优先级：

```text
生理终局命中
→ 直接结束，不判定报告邀请

否则满足 Arc 收束邀请
→ 展示报告邀请

否则满足连续稳定邀请
→ 展示报告邀请

否则
→ 正常展示 A/B/C
```

### 5.1 条件 A：PressureArc 收束邀请

必须同时满足：

1. `completedChoiceCount >= 12`。
2. 本轮 `pressureArcTransition.action === "resolve"`。
3. 当前节点 `lifeIntensity` 为 `normal` 或 `stable`。
4. 当前节点存在明确且经过校验的解决结果。
5. 当前 Arc 所属叙事阶段尚未展示过报告邀请。

生成的触发键：

```ts
triggerKey = `arc:${pressureArcId}`;
```

该 `triggerKey` 同时作为叙事阶段标识。同一 `pressureArcId` 在同一条分支中最多邀请一次，不受两次邀请之间经过多少次选择影响。

### 5.2 “明确解决结果”的定义

Arc 因 `checkpoint_cap` 自动进入 `resolved`，不等于叙事已经有明确结果。不得只检查 `nextArcState.status === "resolved"`。

当前节点必须包含一条经过 `validateNodeOutcomeProposal()` 验证、且 `pressureArcId` 与本轮 resolve Arc 一致的 `pressure_resolved`。专属结果信号和相关 `worldDelta` 可以作为补充证据，例如 `stability_reached`、`funding_secured`、`funding_failed`、`cashflow_stable`、`team_formed`，以及带有非空 `summary` 的职业、关系、健康或地点状态变化；它们不能替代缺失的通用 `pressure_resolved`。

其中：

- `pressure_persists` 不属于解决结果；
- `pressure_addressed` 只表示问题被处理，单独出现时不足以证明已经形成结果；
- 证据文本必须实际出现在当前节点正文中，继续使用现有信号校验机制；
- 成功、失败、妥协和接受现实都可以是明确结果，不要求正面结局。

新增通用信号 `pressure_resolved`，用于没有专属结果信号的职业、关系、健康等 Arc。必须同步加入 `DEFAULT_PHASE_POLICY.allowedSignalTypes`，否则会被 `validateNodeOutcomeProposal()` 过滤：

```ts
allowedSignalTypes: [
  "pressure_addressed",
  "pressure_persists",
  "pressure_resolved",
  "stability_reached",
  "funding_secured",
  "funding_failed",
  "cashflow_stable",
  "team_formed"
]
```

operation 阶段返回：

```ts
{
  pressureArcId: foregroundPressureArc.id,
  type: "pressure_resolved",
  evidence: "正文中直接描述结果的原句",
  confidence: 0.0 // 至 1.0
}
```

在现有 `buildNextNodePrompt()` 中根据 `foregroundPressureArc.phaseId === "operation"` 动态增加要求，不新增独立 Prompt：

```text
【当前阶段收束要求】
- 本节点必须写清当前阶段压力最终形成了什么结果。
- arcSignals 必须返回 pressure_resolved。
- evidence 必须是正文中直接描述该结果的原句。
- pressureArcId 必须与当前前台 PressureArc 一致。
- 这里只表示阶段压力解决，不表示 DirectionArc 或长期人生方向完成。
```

`pressure_resolved` 只作为结果证据，不加入 operation 的 `exitConditions`，也不参与决定 Arc 是否 resolve；状态转换仍由代码单写。邀请判定只接受 `pressureArcId` 与本轮 resolve Arc 一致的信号。

首版不增加 AI 修复重试。operation 节点缺少有效 `pressure_resolved` 时，PressureArc 仍按现有规则 resolve，但本轮不展示报告邀请，后续等待稳定阶段或新的叙事阶段。

### 5.3 条件 B：连续稳定软邀请

用于避免长期没有可用的 Arc 收束节点。必须同时满足：

1. `completedChoiceCount >= 15`。
2. 提交本轮 Arc 转换后，不存在 `active` 或 `stabilizing` 的前台 `PressureArc`。
3. 当前节点和前一个节点的 `lifeIntensity` 都属于 `normal | stable`。
4. 当前连续稳定阶段对应的叙事阶段尚未展示过报告邀请。

若本轮 `pressureArcTransition.action === "resolve"`，但没有满足“明确解决结果”，不得利用条件 B 绕过条件 A。应继续体验，等待后续真正的稳定窗口。

连续稳定阶段从以下任一情况后的第一个 `normal | stable` 节点开始：

- 上一个节点为 `critical | high_tension`；
- 上一个节点存在前台 `PressureArc`；
- 当前分支开始。

为每个连续稳定阶段生成稳定的触发键。若这段稳定生活直接延续自最近一次 PressureArc resolve，且中间没有新的 PressureArc 或 `critical | high_tension` 节点，则沿用该 Arc 的阶段键，避免同一阶段先以 Arc resolve、随后又以 stable window 重复邀请：

```ts
triggerKey = lastResolvedPressureArcId
  ? `arc:${lastResolvedPressureArcId}`
  : `stable:${stableEpisodeStartChoiceCount}`;
```

同一个 `triggerKey` 最多邀请一次。用户一直处于同一段稳定生活时，不得因为选择次数增加而反复邀请；只有经历新的 PressureArc，或离开稳定状态并在新的高张力阶段后再次稳定，才形成新的叙事阶段和邀请机会。

稳定阶段起点扫描实现在 `reportInvitationDecision.ts` 内部，作为独立的模块私有纯函数，不新增文件：

```ts
function findStableEpisodeStartChoiceCount(
  history: HistoryItem[],
  candidateNode: SimulationNode
): number
```

算法：

```text
组合 history 与 candidateNode
→ 从当前节点向前扫描
→ 找到最后一个 critical | high_tension 节点
   或最后一个参与过前台 PressureArc 的节点
→ 返回该节点对应选择数 + 1
→ 完全没有边界时返回 0
```

Arc 边界必须同时检查：

```ts
const isArcBoundary =
  Boolean(node.worldStateSnapshot?.foregroundPressureArcId) ||
  Boolean(node.committedArcMeta?.pressureArcId);
```

不能只检查 `foregroundPressureArcId`，因为 resolve 提交后该字段会被清空。本轮刚 resolve 的节点也属于 Arc 边界；如果本轮没有明确结果证据，条件 A 失败后不得在同一轮改走条件 B。该扫描只在评估稳定邀请时执行一次，复杂度为 O(history.length)，对当前会话长度没有可感知性能影响。

## 6. 拒绝邀请与再次邀请

默认配置：

```ts
export interface ReportInvitationPolicy {
  minChoicesForArcResolution: number;
  minChoicesForStableWindow: number;
  safeIntensities: Array<"normal" | "stable">;
}

export const DEFAULT_REPORT_INVITATION_POLICY: ReportInvitationPolicy = {
  minChoicesForArcResolution: 12,
  minChoicesForStableWindow: 15,
  safeIntensities: ["normal", "stable"]
};
```

选择次数只用于控制第一次邀请不要过早出现，并用于观测第一次邀请是否大多发生在 12–17 次之间；不用于计算第二次及后续邀请的间隔。

用户点击“继续走下去”时：

- 当前邀请状态改为 `declined`；
- 立即收起邀请卡并恢复当前节点原有 A/B/C 和自定义入口；
- 不生成新节点；
- 不增加 `completedChoiceCount`；
- 不把“继续走下去”写入人生选择历史。

下一次邀请必须同时满足：

1. 上一次邀请已被用户拒绝；
2. 当前 `triggerKey` 与所有历史邀请的 `triggerKey` 不同；
3. 一个新的 PressureArc 已形成明确结果并 resolve，或用户离开原稳定阶段后进入新的连续稳定阶段。

第二次及后续邀请不设置“至少间隔多少次选择”，也不设置“必须从第 18 次以后开始”。如果新阶段已经完整形成，可以邀请；如果始终没有新阶段，即使继续很多次选择也不再次邀请。

若第 12–17 次之间始终没有合适节点，不在第 17 次强制展示；第 18 次以后遇到下一个合适节点时，仍可展示当前分支的第一次邀请。

## 7. 状态模型

邀请判定结果随节点保存，避免 UI 自行推断 Arc 状态。

```ts
export interface ReportInvitationMeta {
  id: string;
status: "pending" | "accepted" | "declined";
  reason: ReportInvitationReason;
  triggerKey: string;
  completedChoiceCount: number;
  pressureArcId?: string;
resolutionEvidence?: string[];
acceptedAtChoiceCount?: number;
declinedAtChoiceCount?: number;
}
```

在 `SimulationNode` 和 `HistoryItem` 中增加：

```ts
reportInvitation?: ReportInvitationMeta;
```

邀请 ID 必须可重复计算，建议：

```ts
id = stableHash({
  namespace: "report-invitation",
  simulationSeed,
  branchFingerprint,
  triggerKey,
  completedChoiceCount
});
```

状态流转：

```text
无邀请
  └─ 判定命中 → pending

pending
  ├─ 查看报告 → 结束推演，closureType=user_reflection
  └─ 继续体验 → declined → 恢复当前节点原选项

declined
  └─ 用户提交当前节点选择 → 随 HistoryItem 保存
```

时光回溯规则：

- 回到邀请之前：该分支上的邀请和拒绝记录随历史截断，可以在新分支重新判定。
- 回到已经拒绝的邀请节点：恢复 `declined` 状态，直接显示原选项，不再次展示同一邀请。
- 不跨分支全局屏蔽某个 Arc 或稳定阶段。

## 8. 服务端/模拟流程

`generateNextNode()` 调整后的顺序：

```text
1. 生成并规范化候选节点
2. evaluateEnding()
3. 若命中生理终局：生成死亡终章并直接返回
4. 通过 DecisionGate
5. validateNodeOutcomeProposal()
6. reducePressureArc()
7. commitSimulationTransaction()
8. evaluateReportInvitation()，使用 committed node 和本轮 transition
9. 将 pending ReportInvitationMeta 附加到返回节点
10. 返回普通节点
```

邀请判定必须发生在 `reducePressureArc()` 之后，否则无法可靠识别“本轮刚刚 resolve”；生理终局必须在它之前短路。

`evaluateReportInvitation()` 只读取结构化状态：

- `completedChoiceCount`；
- 当前和历史节点的 `lifeIntensity`；
- `PressureArcTransitionDecision`；
- 提交后的 `WorldStateSnapshot`；
- 已验证的 `AcceptedNodeOutcome`；
- 历史中的邀请和拒绝元数据。

不得通过搜索正文关键词决定是否邀请。

## 9. 报告生成

报告接口增加上下文：

```ts
export interface FinalOutcomeContext {
  closureType: "user_reflection" | "mortality";
  invitationReason?: "arc_resolved" | "stable_window";
  pressureArcId?: string;
  resolutionEvidence?: string[];
}
```

`GenerateFinalOutcomeInput` 增加必填 `context: FinalOutcomeContext`。`closureType` 不保存在 App 临时 state 中，而是沿调用参数显式传递：

```text
SimulationEngine 明确回调
→ App 共享报告生成函数参数
→ GenerateFinalOutcomeInput.context
→ buildFinalOutcomePrompt
→ FinalLifeOutcome.meta.closureType
→ DestinyReport / 海报文案
```

`SimulationEngine` 在现有 `onSelectChoice` 外最小增加：

```ts
onAcceptReportInvitation: (invitation: ReportInvitationMeta) => void;
onContinueReportInvitation: (invitationId: string) => void;
```

现有生理终局按钮可以继续走 `onSelectChoice()`；App 通过 `currentNode.isEndingNode` 明确传入 `{ closureType: "mortality" }`。接受报告邀请时传入 `{ closureType: "user_reflection", invitationReason, pressureArcId, resolutionEvidence }`。两条入口调用同一个 `handleGenerateFinalOutcome(context, terminalAction)`，不得继续仅依赖“安详落幕，查看一生洞察”字符串区分报告类型。

`generateFinalOutcome()` 将 `context` 传给 Prompt，并在规范化结果后由代码写入：

```ts
FinalLifeOutcome.meta.closureType = input.context.closureType;
```

不得信任 AI 返回的 `closureType`。为兼容旧测试数据和旧报告记录，缺少该字段时规范化默认使用 `mortality`；新增的用户主动报告必须显式写入 `user_reflection`。

### user_reflection

- 使用截至当前节点的完整历史生成报告；
- 当前节点以特殊终止动作“查看这段人生的报告”加入报告上下文；
- 报告定位为阶段性人生总结，但本次推演结束；
- 不写死亡、遗言、墓志铭或“走完一生”等确定性表达。

### mortality

- 保持现有终章和报告逻辑；
- 可以回顾完整人生和生命结尾。

报告页面结构不重做，但生成 Prompt、报告标题、海报角标、分享提示、替代文本和下载文件名必须根据 `closureType` 调整语义。

## 10. 界面与交互

邀请卡位于剧情正文之后、A/B/C 选项之前，使用当前互动区内嵌卡片，不使用全屏弹窗，不替换剧情正文。

文案：

```text
这条人生，已经有了值得回望的轨迹

一路走到这里，你的选择、得到的东西和付出的代价，
已经慢慢形成了一条清晰的轨迹。

[查看这段人生的报告]

继续走下去，看看更远的结果
```

交互要求：

- `pending` 时隐藏当前节点原有 A/B/C 和自定义入口。
- 主按钮为高强调“查看这段人生的报告”。
- 不显示“将在这里结束本次推演”提示。
- “继续走下去，看看更远的结果”使用小号文字按钮。
- 点击继续后，在同一个节点恢复原有 A/B/C 和自定义入口。
- 不显示 `12/18`、`15/25` 等进度。
- 不使用“最后机会”“人生已完成”“必须结束”等文案。
- 生理终局继续只显示现有终局报告按钮，不显示邀请卡。

报告页复用现有结构，但按 `FinalLifeOutcome.meta.closureType` 切换固定文案：

| 位置 | `user_reflection` | `mortality` |
|---|---|---|
| 加载提示 | 这段人生的报告生成中 | 完整人生报告生成中 |
| 海报角标 | 平行时空 · 阶段回望 | 平行时空 · 人生终章 |
| 下载文件名 | 这段人生的报告.png | 人生终章.png |
| 分享提示 | 已复制这段人生的报告 | 已复制人生终章与人生模式分析 |
| 结尾语义 | 此刻回望、阶段洞察 | 人生志铭、完整人生总结 |

建议稳定的测试 ID：

```text
report-invitation-card
report-invitation-accept-btn
report-invitation-continue-btn
```

## 11. 文件改动建议

### 新增

- `src/config/reportInvitationPolicy.ts`
  - 保存首次邀请门槛和安全强度配置。
- `src/utils/reportInvitationDecision.ts`
  - 实现纯函数判定、稳定阶段识别、触发键和历史去重。
- `src/utils/reportInvitationDecision.test.ts`
  - 覆盖规则矩阵。

### 修改

- `src/types.ts`
  - 增加 `ReportInvitationMeta`、`ReportInvitationReason`、`SimulationClosureType`。
  - 在 `SimulationNode`、`HistoryItem` 中增加邀请元数据。
- `src/utils/arcLifecycle.ts`
  - 增加通用结果信号 `pressure_resolved`。
- `src/services/simulation/prompts.ts`
  - operation 阶段要求 Arc 最终节点给出 `pressure_resolved` 和正文证据。
- `src/services/simulation/simulationService.ts`
  - 在提交 Arc 转换后判定报告邀请并附加节点元数据。
  - 保持生理终局优先短路。
- `src/utils/historyRestore.ts`
  - 创建历史项和恢复节点时复制邀请元数据。
- `src/components/SimulationEngine.tsx`
  - 渲染内嵌邀请卡；增加接受与继续两个明确回调。
- `src/App.tsx`
  - 处理 `pending → declined`。
  - 使用共享报告生成函数显式传递 `closureType`，不增加临时 state。
- `src/services/finalOutcome/finalOutcomeService.ts`
  - 接收并传递结束上下文。
- `src/services/finalOutcome/prompts.ts`
  - 根据 `closureType` 区分阶段报告与完整人生报告语义。
- `src/utils/finalOutcomeResponse.ts`
  - 将 `closureType` 写入结果 meta，并为旧数据提供 `mortality` 默认值。
- `src/components/DestinyReport.tsx`
  - 根据结果 meta 切换报告标题、海报角标、分享提示和下载语义。

### 可控影响与兼容要求

- operation Prompt 增加少量固定文本，不增加额外 AI 请求；如果信号缺失，只漏掉本次邀请，不影响 Arc 正常推进。
- 稳定阶段反向扫描为一次 O(n) 只读操作，不新增持久化结构，不影响当前会话性能。
- `closureType` 增加类型和测试数据调整成本；旧报告统一默认 `mortality`，避免历史数据和既有测试立即失效。
- 报告页面只切换固定文案，不重做组件结构和报告 JSON 主体。
- 不改变生理终局概率、PressureArc 生命周期、普通节点生成或用户选择流程。

不修改：

- `src/config/endingPolicy.ts` 中的生理终局参数；
- `evaluateEnding()` 的年龄、健康概率算法；
- `SimulationNode.isEndingNode` 的含义。报告邀请节点必须保持 `isEndingNode=false`。

## 12. 验收测试

### 判定单元测试

1. 第 11 次选择 Arc resolve：不邀请。
2. 第 12 次选择 Arc resolve，当前为 `high_tension`：不邀请。
3. 第 12 次选择 Arc resolve，但只有 `pressure_persists`：不邀请。
4. 第 12 次选择 Arc 因阶段上限 resolve，但没有结果证据：不邀请。
5. 第 12 次选择 Arc resolve，当前 `normal` 且有匹配 Arc ID 的 `pressure_resolved`：邀请。
6. 第 12 次选择 Arc resolve，当前 `stable`，有匹配的 `pressure_resolved` 和相关 `worldDelta`：邀请。
7. 同一个 `pressureArcId` 已邀请过：不重复邀请。
8. 第 14 次选择，无 active Arc 且连续稳定：不触发条件 B。
9. 第 15 次选择，无 active Arc且连续两个节点安全：邀请。
10. 第 15 次选择，仍有 active/stabilizing Arc：不邀请。
11. 本轮 Arc 无证据 resolve：不得通过稳定条件兜底邀请。
12. 同一个连续稳定阶段已邀请过：不重复邀请。
13. Arc 收束邀请被拒绝后，紧接着进入该 Arc 的稳定生活：沿用原 `triggerKey`，不重复邀请。
14. 第一次邀请被拒绝后，无论又经过多少次选择，只要仍处于原叙事阶段：不邀请。
15. 第一次邀请被拒绝后，新的 PressureArc resolve 且有明确结果：使用新的 `triggerKey`，允许第二次邀请。
16. 第一次邀请被拒绝后，新的 PressureArc 仍为 active/stabilizing：不邀请。
17. 第一次邀请被拒绝后，经历新的高张力阶段并再次进入连续稳定状态：允许第二次邀请。
18. 两次邀请之间选择次数很少，但新的叙事阶段已经完整形成：允许邀请。
19. 两次邀请之间选择次数很多，但没有形成新的叙事阶段：不邀请。
20. 第 12–17 次没有合适节点，第 18 次以后出现合适节点：允许展示第一次邀请。
21. 任意轮次命中生理终局：直接返回 `isEndingNode=true`，无邀请元数据。
22. 第 18、25、40 次选择均不得仅因轮次自动结束或自动再次邀请。
23. `pressure_resolved` 未加入 allowedSignalTypes 时测试必须失败；加入后能够通过现有信号校验。
24. `pressure_resolved.pressureArcId` 与本轮 resolve Arc 不一致：不邀请。
25. resolve 节点的 `foregroundPressureArcId` 已被清空，但存在 `committedArcMeta.pressureArcId`：仍能识别为稳定阶段边界。

### UI 测试

1. `pending` 邀请节点只显示邀请卡，不显示 A/B/C 和自定义入口。
2. 点击继续后不请求新节点、不增加选择数，并恢复原选项。
3. 点击报告后进入报告生成状态，本次推演结束。
4. 用户主动报告不显示死亡式终章。
5. 生理终局节点只显示原有终局按钮。
6. 时光回溯到已拒绝节点时不重复展示邀请卡。
7. 接受邀请生成的结果包含 `meta.closureType=user_reflection`，报告页使用阶段回望文案。
8. 生理终局生成的结果包含 `meta.closureType=mortality`，报告页使用人生终章文案。

### 回归测试

1. 现有 73 岁前零基础死亡概率保持不变。
2. 现有 110 岁硬结束保持不变。
3. 未命中邀请时，普通节点生成、选择和自定义选择流程不变。
4. PressureArc 的 start、advance、fallback、resolve 和持久化行为不变。
5. 拒绝报告邀请后可以持续体验到原有自然生命终点。
6. 缺少 `meta.closureType` 的旧报告规范化为 `mortality`。

## 13. 埋点与产品验证

建议增加：

```text
report_invitation_shown
report_invitation_accepted
report_invitation_declined
mortality_ending_triggered
final_report_generated
```

共同字段：

```text
simulationId / branchFingerprint
completedChoiceCount
ageInMonths
reason
pressureArcId（如有）
triggerKey（如有）
```

产品目标通过数据验证，不写进强制逻辑：

- 未提前死亡且完成至少 12 次选择的会话中，大多数在第 12–17 次选择之间看到第一次邀请；
- 分别观察 Arc 收束邀请和连续稳定邀请的展示、接受、拒绝比例；
- 观察第一次邀请后到下一个叙事阶段完成之间的实际选择数，用于验证阶段划分是否过密或过疏，不把该数据写成固定冷却；
- 若首次邀请过早或过晚，优先调整邀请策略，不增加硬结束轮次。

## 14. 本次不做

- 不增加第 18 次或任何固定轮次强制结局。
- 不把 Arc resolve 自动改成 `isEndingNode=true`。
- 不取消或缩短原有生理终局。
- 不允许查看报告后返回原节点继续；接受邀请即结束本次推演。
- 不根据正文关键词、情感语气或模型自由判断直接结束。
- 不为满足 12–17 次目标而强行制造或提前 resolve PressureArc。
- 不用固定选择次数或第 18 次门槛安排第二次及后续邀请。
