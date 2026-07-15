# 健康数值轻量校准 Spec

## 目标

AI 继续负责判断健康变化，代码只修正明显矛盾和异常跳变。同时避免事业线天然变成“健康只能下降”的单向轨迹。

## 核心原则

- 不建立完整健康计算模型。
- 不因为继续工作、事业成功或收入增加自动扣健康。
- 不因为停止工作自动恢复健康。
- 是否继续事业目标，与是否维持原有负荷分开判断。
- 健康可以下降、稳定或回升，但必须与本轮现实后果和恢复条件一致。

## 1. 明确 recoveryState

- `protected`：存在明确恢复条件，例如睡眠改善、调整工时、委派任务、规律运动、治疗或稳定支持。继续工作也可以是 `protected`。
- `neutral`：没有持续透支或明显恢复的充分证据，健康通常稳定或小幅波动。
- `depleted`：存在持续熬夜、症状加重、长期超负荷或无视医疗建议等明确证据。

不得仅凭“人物处于事业线”“选择继续工作”或事件类别，将 `recoveryState` 判断为 `depleted`。

## 2. 增加健康数值安全边界

```ts
function reconcileHealth(
  previousHealth: number,
  proposedHealth: number,
  recoveryState: RecoveryState,
  isMajorHealthEvent: boolean
): number {
  const maxDecline = isMajorHealthEvent ? 12 : 6;
  const rawDelta = proposedHealth - previousHealth;

  let delta = Math.max(-maxDecline, Math.min(6, rawDelta));

  if (recoveryState === "protected") {
    delta = Math.max(delta, -2);
  }

  if (recoveryState === "depleted") {
    delta = Math.min(delta, 2);
  }

  return Math.max(0, Math.min(100, previousHealth + delta));
}
```

说明：

- 普通节点单轮最多下降 6、回升 6。
- 只有 `health_forced_pause` 按重大健康事件处理，单轮最多下降 12；其他 major 事业事件不能放宽健康下降。
- `protected` 仍允许健康小幅下降，但最多下降 2。
- `depleted` 仍允许小幅改善，但最多回升 2。
- 最终健康值限制在 `0～100`。
- 校准以决策节点为单位，不按月机械累计。

## 3. 健康预警必须提供恢复路径

`health_system_warning` 的正文应说明当前风险和可调整因素，但不直接替用户判断必须辞职。

三个选项中至少一个应能实质改善恢复条件，例如调整工时、减少并行任务、委派、就医或阶段性暂停。同时：

- 不保证选择后健康立即回升。
- 不把恢复路线写成唯一正确答案。
- 允许用户维持当前负荷并承担风险。
- 当医疗建议或现实条件充分支持时，允许暂停、离职或退出当前工作调养。

## 4. 接入位置

AI 节点完成最终规范化或修复后、进入结局判断和历史写入前，使用上一节点健康值、本节点 AI 健康值、本节点 `recoveryState` 和健康事件类型进行一次校准。

## 验收标准

- 普通节点不能一次下降超过 6。
- `health_forced_pause` 不能一次下降超过 12。
- `protected` 状态不能一次下降超过 2。
- `depleted` 状态不能一次回升超过 2。
- 健康值始终在 `0～100`。
- 继续工作但恢复条件明确时，可以保持健康或回升。
- 停止工作但缺少恢复证据时，不保证健康回升。
- 健康预警至少提供一条改善恢复条件的选择，但仍保留维持负荷和暂停/退出的自由。

## 本次不处理

- 疾病类型、年龄、运动量等完整医学计算模型。
- 根据经过月数机械折算健康变化。
- 强制所有事业高强度选择扣健康。
- 强制休息、离职或就医后立即增加健康。
- 修改健康事件阈值、升级条件或 PressureArc 生命周期。
