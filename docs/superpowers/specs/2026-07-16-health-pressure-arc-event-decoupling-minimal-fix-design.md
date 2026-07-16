# PressureArc 事件解耦与健康叙事去重复：最小开发 Spec

## 1. 目标

修复活跃 `PressureArc` 始终复用原始事件造成的叙事重复，尤其是健康 Arc 连续多个节点重复“身体停摆/住院”。

本 Spec 以当前分支已有实现为前提：

- `HEALTH_CRISIS_PHASE_POLICY` 已存在，阶段为 `trigger → recovery → operation`；
- `health_recovery_observation` 已存在；
- `pressure_resolved` 已在信号白名单中；
- `evaluateReportInvitation()`、邀请卡和 `closureType` 传递链已经完成。

本次只改变“活跃 Arc 当前节点使用哪一个事件内容”，不改变 Arc 的生命周期所有权。

## 2. 当前问题

`generateNextNode()` 目前在存在前台 Arc 时始终调用：

```ts
resolvePressureArcPresentationEvent(existingPressureArc)
```

因此原始 `health_forced_pause` 会被重复用于后续节点。事件冷却无法生效，因为活跃 Arc 会绕过 `queryDynamicLifeEvent()`。

## 3. 设计原则

1. `PressureArcState` 仍由 `reducePressureArc()` 唯一推进和 resolve。
2. 动态事件只负责本节点的叙事内容、`eventMeta` 和背景选择，不得创建、修改或结束 Arc。
3. Arc phase 优先决定 `lifeIntensity` 和时间跨度；动态事件的 temporal profile 不能覆盖 Arc phase。
4. 健康 Arc 的急性表达只允许出现在 `trigger`；恢复/观察阶段不得再次使用急性危机表达。
5. `pressure_resolved` 仍只是叙事证据，不是状态机控制信号；缺失时 Arc 仍可按代码 resolve，但本轮不产生 `arc_resolved` 邀请。

## 4. 事件选择矩阵

| 前台 Arc | phase | 节点事件选择 |
|---|---|---|
| 无 | — | 保留现有 e2e 覆盖、健康升级和 `queryDynamicLifeEvent()` 顺序 |
| 通用 Arc | `trigger` / `response` | 复用 Arc 原始事件，保持前两阶段因果连续 |
| 通用 Arc | `growth` / `operation` | 调用 `queryDynamicLifeEvent()`，允许出现不同的工作、关系、财务或生活事件 |
| 健康 Arc（`health_crisis_v1`） | `trigger` | 使用 `health_forced_pause` |
| 健康 Arc（`health_crisis_v1`） | `recovery` / `operation` | 使用安全动态事件；无合适候选时回退 `health_recovery_observation` |
| 旧健康 Arc（缺少或不是 `health_crisis_v1`） | 任意 | 继续旧的 `resolvePressureArcPresentationEvent()` 映射，不在中途迁移 |

“安全动态事件”定义如下：

- `event.id !== currentArc.eventId`；
- 不是 `health_forced_pause`；
- 不是重大急性健康事件（`category === "health"` 且 `fingerprint.intensity === "major"`）；
- `getEventTemporalProfile(event).requiresFollowUp === false`；
- 满足现有年龄、冷却、类别和用户主线筛选。

如果动态候选不满足上述条件，视为无候选，不修改全局 `queryDynamicLifeEvent()`。

## 5. 代码改动

### 5.1 `src/services/simulation/simulationService.ts`

新增模块私有函数，建议命名为：

```ts
function selectArcContinuationEvent(input: {
  arc: PressureArcState;
  attributes: LifeAttributes;
  userData: UserInitialData;
  age: number;
  history: HistoryItem[];
  answers: unknown;
}): LifeEventSeed | null
```

函数逻辑：

```text
旧 Arc（policy 不是 health_crisis_v1）
→ trigger/response 复用原事件
→ growth/operation 调 queryDynamicLifeEvent，再做安全过滤

新健康 Arc
→ trigger 复用 health_forced_pause
→ recovery/operation 调 queryDynamicLifeEvent，再做安全过滤
→ 无安全候选时回退 health_recovery_observation
```

在 `generateNextNode()` 中保留现有无 Arc 的 `selectedEvent` 逻辑，仅替换：

```ts
const nodeEvent = workingPressureArc
  ? selectArcContinuationEvent({
      arc: workingPressureArc,
      attributes: input.currentAttributes,
      userData: input.userData,
      age: Math.floor(currentAgeInMonths / 12),
      history: input.history,
      answers: input.answers
    })
  : selectedEvent;
```

其他流程不变：

- `workingPressureArc` 仍来自当前 Arc 或 `startArcDecision`；
- `pressureArcPolicy` 仍通过 `resolvePhasePolicy(workingPressureArc.phasePolicyId)` 获取；
- `reducePressureArc()`、`commitSimulationTransaction()`、`evaluateReportInvitation()` 不改签名；
- 动态事件不得进入 `startArcDecision`，因为该分支只在 `!existingPressureArc` 时执行。

### 5.2 `src/services/simulation/prompts.ts` 与时间线约束

继续传入 `foregroundPressureArc`。现有健康阶段 Prompt 保留，并补充：

- recovery/operation 即使本节点使用了动态事件，正文仍须交代当前健康压力的后续影响或管理方式；
- 动态事件只改变本节点场景；Prompt 仍须携带 `pressureArcId`、`phase` 和 `unresolvedSummary`，避免长期压力主线丢失；
- 不得再次写“再次停摆、再次住院、再次急救”等急性危机；
- operation 必须写出本次压力的阶段结果，并返回匹配当前 Arc 的 `pressure_resolved` 证据；
- 不得将 PressureArc resolve 写成 DirectionArc 或整个人生完成。

`deriveTemporalProfile()` 已在存在 `pressurePhaseProfile` 时优先返回 Arc phase profile，保持：

```text
trigger = high_tension
recovery = normal
operation = stable
```

不得改为由动态事件重新决定强度。

### 5.3 不修改的文件

本次不修改：

- `src/utils/arcLifecycle.ts` 的通用状态机和 `HEALTH_CRISIS_PHASE_POLICY`；
- `src/data/lifeEvents.ts` 的事件触发阈值和全局调度函数；
- `src/utils/reportInvitationDecision.ts` 和 `src/config/reportInvitationPolicy.ts`；
- `src/utils/simulationTransaction.ts`；
- UI、报告标题、终局文案和 `closureType` 调用链；
- 健康数值校准、财务底线和自然生理终局规则。

## 6. 兼容与降级

- 动态候选为空、被过滤或事件查找失败时，使用原事件映射；健康 Arc 优先回退 `health_recovery_observation`。
- 旧历史中的 generic 健康 Arc 不迁移 phase，也不强制替换已有 `eventId`。
- 动态节点仍提交当前 Arc 的 `committedArcMeta`；`eventMeta.eventId` 变化不代表 Arc 已变化。
- 动态节点的 `eventMeta.phasePolicyId` 仅描述展示事件；Arc 真正的 policy/phase/status 以 `PressureArcState` 和 `committedArcMeta` 为准，不得强行同步两者。
- 任一节点生成失败时沿用现有重试流程，不新增无限重试。
- `pressure_resolved` 修复仍只允许现有健康 operation 定向重试一次。

## 7. 测试要求

### 7.1 单元测试

在 `src/services/simulation/simulationService.test.ts` 增加：

1. 无 Arc 时，e2e 覆盖和普通动态事件顺序不变。
2. generic Arc 的 trigger/response 复用原事件。
3. generic Arc 的 growth/operation 可以使用不同事件。
4. 动态候选为原事件、重大急性健康事件或 `requiresFollowUp=true` 时被过滤。
5. 动态候选为空时回退原事件；健康 Arc 回退 `health_recovery_observation`。
6. 健康 trigger 的 `eventMeta.eventId` 为 `health_forced_pause`。
7. 健康 recovery/operation 不出现连续急性危机表达，且不会创建第二条 Arc。
8. 动态事件改变 `eventMeta` 时，`committedArcMeta.pressureArcId`、phase 和 transition action 不变。
9. Arc phase 仍决定 `lifeIntensity`，不被动态事件覆盖。
10. 后段动态事件变化时，Prompt 仍包含原 Arc 的 `unresolvedSummary`。
11. operation 仍按代码 resolve；有匹配 `pressure_resolved` 且强度安全时才展示邀请。
12. Arc resolve 后下一节点恢复普通动态事件选择。

### 7.2 回归验收

至少验证四条路线：健康直接升级、健康持续 depleted、健康调整负荷、非健康 generic Arc。

每条路线记录：节点正文、`eventMeta.eventId`、Arc id/phase/status、`committedArcMeta`、健康值、`lifeIntensity`、`arcSignals` 和邀请结果。

通过标准：

- 新健康 Arc 通常在 3–4 个节点内完成；
- `health_forced_pause` 不连续超过 2 个节点，目标为只出现 1 个；
- recovery/operation 不再出现“再次停摆/再次住院/再次急救”；
- 健康 Arc resolve 后健康值可保持偏低，不自动治愈；
- 不产生第二条前台 PressureArc；
- generic Arc 后段能恢复事件多样性；
- 报告邀请、自然终局、财务和年龄连续性无回归。

## 8. 明确非目标

本次不建立新的 Arc 状态类型，不增加轮次硬上限，不把 PressureArc resolve 解释为人生主线完成，也不把动态事件选择改造成新的完整状态机。

## 9. 完成定义

完成以下条件即可合并：

1. 活跃 Arc 后段不再无条件复用原始事件。
2. 健康 Arc 的急性表达被限制在 trigger，恢复阶段使用安全事件或观察事件。
3. Arc 状态、强度、resolve 和报告邀请的现有契约保持不变。
4. 单元测试和真实浏览器回归均通过，且保留完整节点与状态数据。
