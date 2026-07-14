# 健康事件分级与升级 Spec

## 目标

避免轻度健康预警自动变成连续重大危机，同时保留健康持续恶化后升级为“身体停摆”的能力。

## 已确认原则

- 随机事件池只保留 `health_system_warning` 一张健康卡。
- `happiness` 不参与健康事件触发；低幸福不能单独生成身体疾病。
- 健康预警需要写入历史，但不立即成为连续主线。
- `health_forced_pause` 不参与随机抽取，只能由明确的恶化条件升级触发。

## 1. Health System Warning 降级

`health_system_warning` 定义为轻度到中度健康预警：

```ts
fingerprint.intensity = "minor"
intent.emotionalTone = "pressure"
intent.temporalProfile = {
  lifeIntensity: "normal",
  durationMonths: [3, 9],
  requiresFollowUp: false
}
```

效果：

- 作为单节点事件出现。
- 不自动创建 `PressureArc`。
- 通过现有 `eventMeta` 保存在历史中，不新增状态字段。
- 当前随机入口暂时保持 `health < 42`。

## 2. health_forced_pause 保持重大危机

`health_forced_pause` 保持：

```ts
dispatchMode = "arc_only"
fingerprint.intensity = "major"
intent.emotionalTone = "crisis"
```

它不参与随机抽取；触发后可以创建 `PressureArc`，用于处理治疗、减负和生活重排。

## 3. 增加升级入口

在普通事件随机调度之前检查是否需要升级。满足以下任一情况时，直接选择 `health_forced_pause`：

### 直接升级

```text
当前 health < 30
```

### 持续恶化升级

必须同时满足：

1. 最近 3 个节点内出现过 `health_system_warning`。
2. 当前 `health < 38`。
3. 最近三个健康快照连续下降。
4. 三个快照累计下降至少 8 分。
5. 最近两个节点的 `recoveryState` 都是 `depleted`。

升级判断只使用结构化属性、`eventMeta` 和 `recoveryState`，不解析正文中的“熬夜、胸痛、加班”等关键词。

升级入口必须遵守 `health_forced_pause` 的现有冷却，避免重大健康 Arc 结束后立即重开。

## 调度优先级

```text
已有 active PressureArc
→ 健康恶化升级入口
→ 普通随机事件调度
```

## 验收标准

- `health_system_warning` 为 `minor + pressure`，且 `requiresFollowUp=false`。
- 健康预警节点不会创建 `PressureArc`。
- `health_forced_pause` 保持 `major + crisis + arc_only`。
- 幸福 25、健康 60 不触发任何健康事件。
- 健康低于 30 可直接升级为 `health_forced_pause`。
- 近期预警后，健康连续下降至少 8 分且持续 `depleted` 时可以升级。
- 健康回升、下降不足或恢复状态不是持续 `depleted` 时不得升级。
- 升级入口不能绕过冷却。

## 本次不处理

- 健康专属 PressureArc 的阶段数量和退出规则。
- 根据长期趋势动态调整健康事件随机权重。
- 通过自然语言正文识别疾病或透支状态。
