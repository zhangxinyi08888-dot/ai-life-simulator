# 世界现实规则目录（第一阶段）

这份目录定义模拟器测试中的“真实”如何被验证。它不把现实简化成唯一剧情；硬规律零容忍，低概率事件允许发生，但必须具备前置条件、权威证据和持续后果。

## 规则类型

- `hard_invariant`：时间、账户、身份和生命周期不能违反的硬规律。
- `causal_evidence`：重大变化必须能够追溯到选择、Proposal、Accepted Event 或确定性系统结算。
- `reality_constraint`：现实中允许例外，但必须满足人物、资源、时间和证据条件。
- `statistical_calibration`：只能通过批量路线和可信数据判断的概率规律。
- `current_fact`：依赖地区、年代、政策或市场数据，必须记录来源和更新时间。

## 第一批已自动化规则

| 规则 | 类别 | 领域 | 失败级别 | 判断 |
|---|---|---|---|---|
| `TIME-001` | hard | 时间 | blocking | 人生节点时间不得倒退 |
| `ENDING-001` | hard | 结局 | blocking | 结局节点后不得继续普通人生 |
| `FIN-TIME-001` | hard | 财务/时间 | blocking | 账本时间必须等于节点时间 |
| `FIN-TIME-002` | hard | 财务/时间 | blocking | 派生财务快照时间必须等于节点时间 |
| `FIN-001` | hard | 财务 | blocking | 权威账本满足账户、现金、债务和幂等不变量 |
| `CAREER-001` | hard | 职业 | blocking | 当前职业 ID 必须引用已提交 CareerState |
| `CAREER-002` | hard | 职业 | blocking | 兼容就业状态必须镜像当前 CareerState |
| `CAREER-FIN-001` | causal | 职业/财务 | blocking | 权威模式下活跃职业收入必须引用当前 CareerState；首次出现或重新出现时记录 |
| `FIN-FACT-001` | causal | 财务 | blocking | 未解决的阻断性财务事实问题必须进入验收报告；同一持续问题不跨节点重复计数 |
| `ARC-001` | hard | Arc | blocking | 前台 PressureArc 必须存在且未解决 |
| `TIME-STATE-001` | hard | 跨领域 | blocking | 人物与 Arc 的状态时间不得晚于当前节点 |

实现位置：`src/domain/worldAudit/`。审计器只读历史节点，不修改模拟状态。

## 下一批规则

下一批按以下顺序增加：

1. Proposal → Accepted Event → 状态差异的逐节点因果覆盖。
2. 人物身份、年龄、死亡和关系变化的证据规则。
3. 健康恶化、治疗、恢复与活动强度的生命周期规则。
4. DirectionArc 和 PressureArc 的相位、解决证据及复发边界。
5. 事件资格、语义重复、选择差异和 outcome 覆盖。
6. 分布规则和带地区、时间版本的现实数据校准。

## 门禁语义

- 任意 `blocking` 发现使该路线的世界审计失败。
- `warning` 表示需要人工复核或统计校准，不能自动写成权威事实。
- 不能通过删除规则、自动更新基准或降级严重度来消除真实回归。
- 允许的现实例外必须补充明确条件和测试，而不是绕过规则。
