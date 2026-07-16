# 健康 PressureArc 短生命周期最小修复 Spec

## 1. 背景

当前 `PressureArc` 同时承担三项合理职责：

1. 追踪阶段压力从触发到解决的生命周期。
2. 通过 phase 控制 `lifeIntensity`，形成 `high_tension → normal → stable` 的节奏。
3. 在 Arc 形成明确结果并 resolve 时，为 `arc_resolved` 报告邀请提供自然停顿点。

问题不在 `PressureArc` 本身，而在活跃 Arc 期间始终复用原始事件：

```ts
const seedEvent = existingPressureArc
  ? LIFE_EVENTS_DATABASE.find((event) => event.id === existingPressureArc.eventId) || null
  : ...;
```

`health_forced_pause` 创建 PressureArc 后，原始事件会贯穿默认的 `trigger → response → growth → operation` 四个阶段，导致同一健康危机连续出现五六个节点。事件冷却无法处理这种情况，因为已有 Arc 会绕过新的事件选择。

本次修复保留 PressureArc 的生命周期、强度控制和收束邀请能力，只为 `health_forced_pause` 增加一套更短的 phase policy，并根据健康 phase 切换节点使用的事件表达。

## 2. 目标

- `health_forced_pause` 仍然能够创建 PressureArc。
- 一条健康危机 Arc 在 3–4 个节点内 resolve。
- 急性危机只在 `trigger` 节点出现一次。
- 后续节点改写为治疗、减负、恢复条件和长期管理，不再重复“再次停摆、再次住院”。
- 健康 Arc 仍然按照 `high_tension → normal → stable` 控制节奏。
- operation 节点形成明确结果时，仍可触发 `arc_resolved` 报告邀请。
- 健康 Arc resolve 不代表角色已经治愈，低健康值和长期健康影响继续保留。
- 健康 Arc resolve 后，下一节点恢复现有动态事件选择。

## 3. 非目标

本次不处理：

- 不重做通用 PressureArc 状态机。
- 不对职业、关系、财务等其他 PressureArc 更换 phase policy。
- 不在活跃健康 Arc 中恢复完整 `queryDynamicLifeEvent()`。
- 不支持两个前台 PressureArc 并行。
- 不增加疾病类型、治疗方案或医学概率模型。
- 不修改现有健康数值校准规则。
- 不修改报告邀请 UI、终局 UI 或报告结构。
- 不修改 `health_system_warning` 的单节点预警规则。

## 3.1 与既有 Spec 的关系

- 本 Spec 延续 `2026-07-15-health-event-severity-escalation-design.md` 中“轻度预警不创建 Arc、`health_forced_pause` 只能由升级入口触发”的规则，并补上该 Spec 明确未处理的健康 Arc 阶段与退出规则。
- 本 Spec 不修改 `2026-07-15-health-value-reconciliation-design.md` 中的健康数值边界。
- `2026-07-15-natural-reflection-report-invitation-design.md` 原定 operation 缺少解决证据时不重试；本 Spec 只对新健康策略的 operation 增加一次定向修复，其他 PressureArc 仍保持原行为。

## 4. 已确认产品规则

健康危机 Arc 使用以下固定结构：

```text
trigger
→ health_forced_pause
→ high_tension
→ 1 个节点

recovery
→ health_recovery_observation
→ normal
→ 1–2 个节点

operation
→ health_recovery_observation
→ stable
→ 1 个节点后 resolve
```

因此：

```text
整条健康 Arc：3–4 个节点
health_forced_pause：最多连续 1 个节点
health_recovery_observation：2–3 个节点
```

如果 recovery 首节点已经形成 `stability_reached` 或 `pressure_addressed`，下一节点进入 operation；否则 recovery 在第二个 checkpoint 后进入 operation。

operation 节点必须写清这次健康压力形成的阶段结果。结果可以是：

- 症状缓解，恢复条件建立；
- 工作负荷已经重排，但仍需长期管理；
- 角色接受了新的身体边界；
- 治疗效果有限，角色决定带病调整生活；
- 问题没有完全解决，但急性危机阶段已经结束。

resolve 的是“这次健康压力事件”，不是角色的全部健康问题。

## 5. 数据与类型

### 5.1 不新增 PressureArc 状态字段

继续使用现有：

```ts
interface PressureArcState {
  eventId: string;
  eventIntentType: string;
  phasePolicyId: string;
  phaseId: string;
  status: "active" | "stabilizing" | "resolved";
  phaseCheckpointCount: number;
  totalCheckpointCount: number;
  // ...
}
```

本次不使用额外的 `stabilizing` 特殊覆盖规则。健康 phase 是生命周期和强度的唯一判断来源；Arc 在 operation resolve 前保持现有 active 行为。

### 5.2 不修改公共类型

现有 `EventIntent.phasePolicyId`、`PressureArcState.phasePolicyId`、`PhaseTransitionPolicy` 和 `ArcSignalProposal` 已经能够表达本次方案，`src/types.ts` 不需要新增字段。

## 6. 新增健康 Phase Policy

在 `src/utils/arcLifecycle.ts` 新增：

```ts
export const HEALTH_CRISIS_PHASE_POLICY: PhaseTransitionPolicy = {
  id: "health_crisis_v1",
  initialPhaseId: "trigger",
  allowedSignalTypes: [
    "pressure_addressed",
    "pressure_persists",
    "pressure_resolved",
    "stability_reached"
  ],
  phases: [
    {
      id: "trigger",
      ...DEFAULT_TEMPORAL_PROFILES.high_tension,
      durationMonths: [3, 6],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      nextPhaseId: "recovery"
    },
    {
      id: "recovery",
      ...DEFAULT_TEMPORAL_PROFILES.normal,
      durationMonths: [3, 12],
      minCheckpoints: 1,
      maxCheckpoints: 2,
      exitConditions: [
        { type: "arc_signal", signalType: "stability_reached" },
        { type: "arc_signal", signalType: "pressure_addressed" },
        { type: "checkpoint_cap", value: 2 }
      ],
      nextPhaseId: "operation",
      fallbackPhaseId: "operation"
    },
    {
      id: "operation",
      ...DEFAULT_TEMPORAL_PROFILES.stable,
      durationMonths: [6, 18],
      minCheckpoints: 1,
      maxCheckpoints: 1,
      exitConditions: [{ type: "checkpoint_cap", value: 1 }],
      resolvesPressureArc: true
    }
  ]
};
```

`pressure_resolved` 只提供叙事结果证据，不加入 operation 的退出条件。operation 仍由代码在一个 checkpoint 后 resolve。

## 7. Phase Policy 注册与分派

当前 `phasePolicyId` 已被保存，但生成流程仍多处写死 `DEFAULT_PHASE_POLICY`。本次增加最小注册表：

```ts
const PHASE_POLICIES: Record<string, PhaseTransitionPolicy> = {
  [DEFAULT_PHASE_POLICY.id]: DEFAULT_PHASE_POLICY,
  [HEALTH_CRISIS_PHASE_POLICY.id]: HEALTH_CRISIS_PHASE_POLICY
};

export function resolvePhasePolicy(policyId?: string): PhaseTransitionPolicy {
  return PHASE_POLICIES[policyId || DEFAULT_PHASE_POLICY.id]
    || DEFAULT_PHASE_POLICY;
}
```

### 7.1 创建 Arc 时

`health_forced_pause.intent.phasePolicyId` 设置为：

```ts
"health_crisis_v1"
```

创建 Arc 前：

```ts
const startPolicy = resolvePhasePolicy(
  seedEvent?.intent.phasePolicyId
);
```

并将 `startPolicy` 传入 `reducePressureArc()`。`initializePressureArc()` 会继续把 `policy.id` 写入 `PressureArcState.phasePolicyId`。

### 7.2 已有 Arc 推进时

每轮统一按 Arc 已保存的 ID 读取策略：

```ts
const pressureArcPolicy = resolvePhasePolicy(
  workingPressureArc?.phasePolicyId
);
```

以下位置必须使用同一个 `pressureArcPolicy`：

- `resolvePhase(pressureArcPolicy, workingPressureArc.phaseId)`；
- `validateNodeOutcomeProposal({ policy: pressureArcPolicy })`；
- `reducePressureArc({ policy: pressureArcPolicy })`；
- operation 节点的解决证据检查。

不得出现“创建时使用健康策略、推进时又回到默认策略”的情况。

## 8. 健康 Arc 的节点事件映射

### 8.1 新增观察事件

在 `src/data/lifeEvents.ts` 新增：

```ts
{
  id: "health_recovery_observation",
  category: "health",
  dispatchMode: "arc_only",
  title: "治疗与负荷观察",
  minAge: 0,
  maxAge: 110,
  conditionDescription: "健康危机后的治疗、减负、恢复和长期管理阶段",
  cooldown: 0,
  baseProbability: 0,
  tags: ["health", "recovery", "observation"],
  fingerprint: {
    category: "health",
    tags: ["health", "recovery", "observation"],
    intensity: "minor"
  },
  trigger: {
    eligibility: () => false
  },
  intent: {
    type: "health_recovery_observation",
    meaning: "急性健康压力已经进入治疗、调整负荷和观察结果的阶段。",
    tensionAxes: [
      "恢复条件是否可持续",
      "原有人生方向如何调整执行",
      "短期缓解与长期管理"
    ],
    allowedOutcomes: [
      "continue_goal_with_adjusted_execution",
      "maintain_recovery_and_monitoring",
      "restructure_life_around_health_limits"
    ],
    emotionalTone: "reflection",
    temporalProfile: {
      lifeIntensity: "normal",
      durationMonths: [3, 12],
      requiresFollowUp: false
    },
    phasePolicyId: "health_crisis_v1"
  }
}
```

该事件：

- 不进入普通随机事件池；
- 不独立创建 PressureArc；
- 只作为已有健康 Arc recovery/operation 节点的叙事结构；
- `eventMeta.eventId` 应记录为 `health_recovery_observation`，避免历史统计继续把恢复节点算成 `health_forced_pause`。

### 8.2 增加映射函数

在 `simulationService.ts` 内增加模块私有函数，不新增文件：

```ts
function resolvePressureArcPresentationEvent(
  arc: PressureArcState
): LifeEventSeed | null {
  if (arc.eventId === "health_forced_pause") {
    const usesNewHealthPolicy = arc.phasePolicyId === HEALTH_CRISIS_PHASE_POLICY.id;
    const isAcutePhase = usesNewHealthPolicy
      ? arc.phaseId === "trigger"
      : arc.phaseId === "trigger" || arc.phaseId === "response";
    const eventId = isAcutePhase
      ? arc.eventId
      : "health_recovery_observation";
    return LIFE_EVENTS_DATABASE.find((event) => event.id === eventId) || null;
  }

  return LIFE_EVENTS_DATABASE.find((event) => event.id === arc.eventId) || null;
}
```

### 8.3 拆分“选中事件”和“节点展示事件”

为避免变量含义混乱，`generateNextNode()` 内部使用：

```ts
selectedEvent  // 没有前台 Arc 时，通过现有调度选中的事件
nodeEvent      // 当前节点实际使用的事件表达
```

规则：

```text
没有 existingPressureArc
→ selectedEvent 使用现有 e2e / health escalation / dynamic event 调度
→ nodeEvent = selectedEvent

存在 existingPressureArc
→ 不调用完整 queryDynamicLifeEvent()
→ nodeEvent = resolvePressureArcPresentationEvent(existingPressureArc)
```

健康 Arc resolve 后，下一节点不存在 `existingPressureArc`，自动恢复原有动态事件选择。

本次不增加 `backgroundEvent`，也不允许 recovery/operation 选择新的重大事件。普通工作、家庭、关系和生活变化通过观察事件 Prompt 作为背景线继续推进。

## 9. Prompt 规则

继续使用现有 `buildNextNodePrompt()`，根据 `foregroundPressureArc.phasePolicyId` 和 `phaseId` 增加健康阶段指令，不新增独立 Prompt 文件。

### 9.1 trigger

```text
【健康危机触发阶段】
- 本节点写清身体或心理状态为什么迫使原生活节奏发生中断。
- 不把继续人生方向等同于维持原有负荷。
- 选择必须包含调整执行方式的中间路径。
- 这是本次健康 Arc 唯一允许使用“停摆、住院、被迫暂停”等急性危机表达的节点。
```

### 9.2 recovery

```text
【健康恢复与观察阶段】
- 延续同一次健康压力，但不得再次制造新的停摆、住院或突发恶化来重复 trigger。
- 重点写治疗、睡眠、工时、任务委派、运动、照护支持或生活结构调整是否真正建立。
- protected 只表示恢复条件成立，不表示已经治愈。
- 允许继续原有人生方向，但必须说明执行方式如何改变。
- 若恢复条件已经建立，可返回 pressure_addressed 或 stability_reached；evidence 必须是正文原句。
```

### 9.3 operation

```text
【健康压力阶段结果】
- 本节点必须写清这次健康压力最终形成了什么阶段结果。
- 结果可以是恢复、长期管理、带病调整、接受边界或治疗效果有限。
- 不得把阶段结果写成完全治愈，也不得把 PressureArc resolve 写成人生完成。
- arcSignals 必须返回 pressure_resolved。
- pressureArcId 必须与当前前台 PressureArc 一致。
- evidence 必须是正文中直接描述结果的完整原句。
- 本节点不得引入另一项需要长期跟进的重大危机。
```

## 10. operation 解决证据修复

当前真实数据中，代码 resolve 后缺失有效 `pressure_resolved` 的情况较多。为保留 PressureArc 驱动邀请的价值，健康 operation 增加一次定向修复。

处理顺序：

```text
生成并规范化 operation 节点
→ validateNodeOutcomeProposal()
→ 检查是否存在：
   type === pressure_resolved
   pressureArcId === 当前 Arc ID
   evidence 能在正文中找到
→ 有效：继续提交
→ 无效：使用同一 Prompt 定向重试一次
→ 重试仍无效：节点可以提交、Arc 仍按代码 resolve，但本轮不展示 arc_resolved 邀请
```

定向修复只发生在健康 operation，最多一次，不影响普通节点成本。

不得让模型信号控制 Arc 是否 resolve。代码仍是 PressureArc 状态的唯一写入者；信号只决定本轮是否具备报告邀请所需的明确结果证据。

## 11. 与报告邀请的关系

现有 `evaluateReportInvitation()` 不修改。

健康 operation 提交后，只有同时满足以下条件才展示 `arc_resolved` 邀请：

1. `completedChoiceCount >= minChoicesForArcResolution`；
2. `pressureArcTransition.action === "resolve"`；
3. 当前节点 `lifeIntensity === "stable"`；
4. 存在匹配当前 Arc 的有效 `pressure_resolved`；
5. 同一 `triggerKey` 尚未邀请过。

缺少有效解决证据时：

- Arc 仍然 resolve；
- 不展示 `arc_resolved` 邀请；
- 后续仍可通过现有 `stable_window` 条件获得软邀请；
- 不阻塞用户继续体验。

## 12. 与健康数值的关系

继续使用现有 `reconcileHealth()`：

- trigger 中 `health_forced_pause` 仍按重大健康事件允许最大 12 点下降；
- recovery/operation 的 `health_recovery_observation` 不是重大健康事件，普通节点最多下降 6；
- `protected` 最多下降 2；
- `depleted` 最多回升 2；
- Arc resolve 不自动增加健康值；
- operation 结束时健康仍可低于 30。

健康 Arc resolve 后，如果健康仍低且之后再次满足原有升级条件，可以在 `health_forced_pause` 冷却结束后创建新的健康 Arc。

## 13. 文件改动

### 必须修改

| 文件 | 最小改动 |
|---|---|
| `src/utils/arcLifecycle.ts` | 新增 `HEALTH_CRISIS_PHASE_POLICY`、Policy 注册表和 `resolvePhasePolicy()` |
| `src/data/lifeEvents.ts` | 为 `health_forced_pause` 指定 `health_crisis_v1`；新增 `health_recovery_observation` |
| `src/services/simulation/simulationService.ts` | 按 Arc Policy 推进；拆分 `selectedEvent/nodeEvent`；增加健康阶段事件映射；operation 缺证据时定向修复一次 |
| `src/services/simulation/prompts.ts` | 增加 trigger/recovery/operation 的健康阶段指令 |

### 不需要修改

- `src/types.ts`
- `src/utils/healthReconciliation.ts`
- `src/utils/reportInvitationDecision.ts`
- `src/config/reportInvitationPolicy.ts`
- UI、报告页和终局流程

## 14. 单元测试

### 14.1 `arcLifecycle.test.ts`

新增测试：

1. `health_forced_pause` 使用 `health_crisis_v1` 创建 Arc。
2. trigger 第一个 checkpoint 后进入 recovery。
3. recovery 首节点出现 `stability_reached` 时进入 operation。
4. recovery 没有有效信号时最多停留两个 checkpoint。
5. operation 一个 checkpoint 后 resolve。
6. 健康 Arc 总节点数最少 3、最多 4。
7. `pressure_resolved` 不控制 operation 是否 resolve。
8. 默认 PressureArc 的四阶段规则保持不变。
9. 未知 `phasePolicyId` 回退到 `DEFAULT_PHASE_POLICY`。

### 14.2 `simulationService` 相关测试

新增测试：

1. 健康 trigger 的 `eventMeta.eventId === "health_forced_pause"`。
2. 健康 recovery/operation 的 `eventMeta.eventId === "health_recovery_observation"`。
3. 活跃健康 Arc 期间不调用完整动态事件选择。
4. recovery 正文不会继续使用急性危机事件结构。
5. operation 有有效解决证据时，提交节点包含匹配 Arc 的 `pressure_resolved`。
6. operation 第一次缺失证据时只重试一次。
7. 重试仍失败时 Arc 正常 resolve，但不产生 `arc_resolved` 邀请。
8. 满足邀请次数和安全强度时，有效 operation 结果能够产生 `arc_resolved` 邀请。
9. Arc resolve 后下一节点恢复普通动态事件选择。
10. operation 结束时健康值偏低不会被自动修复或重置。

## 15. 真实浏览器回归

至少运行以下 4 条真实路线：

1. 低健康直接触发 `health_forced_pause`，选择暂停治疗。
2. 低健康触发后继续目标但调整工时。
3. recovery 持续 depleted，直到 checkpoint cap 进入 operation。
4. 第 12 次选择以后完成健康 operation，验证 `arc_resolved` 邀请。

每条路线保存：

- 节点正文与标题；
- `eventMeta.eventId`；
- `lifeIntensity`；
- `phasePolicyId`、`phaseId`、`transitionAction`；
- `recoveryState` 和健康值；
- `arcSignals`；
- 邀请 reason 和 resolutionEvidence。

回归通过标准：

- 任一路线都没有连续两个以上 `health_forced_pause`；本方案的正常目标是只出现一个；
- 健康 Arc 节点数均为 3–4；
- 强度顺序为 `high_tension → normal → stable`；
- recovery/operation 不重复急性停摆叙事；
- operation 不要求角色完全康复；
- 至少一条满足次数条件的路线真实命中 `arc_resolved` 邀请；
- 其他动态事件在健康 Arc resolve 后正常恢复。

## 16. 兼容性与失败降级

- 旧历史中的 Arc 若 `phasePolicyId` 缺失或无法识别，继续使用 `DEFAULT_PHASE_POLICY`。
- 已经创建为 `generic_pressure_v1` 的旧健康 Arc 不在中途迁移，避免恢复历史时改变 phase 语义；只有新创建的 `health_forced_pause` 使用 `health_crisis_v1`。
- `health_recovery_observation` 查找失败时，节点生成应回退到无强事件的普通节点 Prompt，并继续附加当前健康 phase 指令；不得回退为 `health_forced_pause`，避免重新制造急性危机叙事。开发和测试环境同时记录 `health-recovery-event-missing` reason code。
- operation 缺失解决证据不会阻塞 Arc resolve，也不会阻塞用户继续体验。
- 本次改动不得改变 mortality 判定优先级。

## 17. 完成定义

以下条件全部满足，视为开发完成：

1. 新健康 Arc 使用 `health_crisis_v1`。
2. 健康 Arc 在 3–4 个节点内 resolve。
3. `health_forced_pause` 不再贯穿 recovery 和 operation。
4. phase policy 在创建、profile、信号校验和 reduce 四处保持一致。
5. operation 能生成并校验匹配 Arc 的 `pressure_resolved`。
6. 解决证据缺失时只重试一次，并有安全降级。
7. 通用 PressureArc、健康预警、健康数值、报告邀请和生理终局的现有行为无回归。
8. 单元测试、类型检查和真实浏览器回归全部通过。
