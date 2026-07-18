# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、可支配收入恒等式、现金 floor 与年龄对齐共 120 个节点、0 个失败。入口层修复已经让合法事实更容易进入账本；报告中的无来源金额必须被重写成自然的定性结论，不能泄漏内部占位符。

但 **M7 仍不允许切换唯一写入者**。静态代码门禁通过并不代表动态事实完整；本轮存在以下阻断项：

- 期权超过到期月仍保持 active：13 个节点
- 23 岁后生活支出仍低于成年保守政策下限：22 个节点
- 终局仍存在 open issue：69 个

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 116 | 样本基数 |
| Accepted 覆盖率 | 95.6897%（111/116） | 目标 ≥80% |
| stale 节点率 | 0%（0/116） | 越低越好 |
| 薪资不匹配率 | 9.4828%（11/116） | 目标 0 |
| 正文持股但无持股账户 | 9 | 目标 0 |
| 正文房产/房贷但无房产账户 | 5 | 目标 0 |
| 成年支出为 0 | 0 | 目标 0 |
| 80 岁后无近期工作证据仍 employed | 0 | 目标 0 |
| 开局重大资产负债漏入账 | 0 组 | 目标 0 |
| 多个活跃 shortfall 账户节点 | 0 | 目标 0 |
| 系统 shortfall 自触发计划噪音 | 0 | 目标 0 |
| issue 泄漏异常/undefined | 0 | 目标 0 |
| 报告内部占位符 | 0 组 | 目标 0 |
| 有价值期权未计入用户财富 | 0 | 目标 0 |
| 或有/缺估值期权错误计入财富 | 0 | 目标 0 |
| 过期但仍 active 的期权节点 | 13 | 目标 0 |
| 23 岁后仍低于成年支出政策下限 | 22 | 目标 0 |
| open / resolved issue | 69 / 32 | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 16 | 1 | 54.4 | 54.4 | 0 | 24 | 9.24 | employed |
| real-custom-lifespan | natural_lifespan | mortality | 42 | 5 | 0 | -390.2283 | 390.2283 | 3 | 24.2004 | not_working |
| real-education-second | accept_second | user_reflection | 26 | 2 | 71.848 | 71.848 | 0 | 0 | 2.4 | self_employed |
| real-relationship-first | accept_first | user_reflection | 16 | 1 | 0 | 128.33 | 81.67 | 0 | 6.96 | employed |
| real-venture-second | accept_second | user_reflection | 20 | 2 | 76.28 | 381.28 | 0 | 0 | 15.6 | employed |

## 逐组现实性结论

- **real-career-first**：现金、收入和换岗能进入账本，但创业股权/期权叙述仍有未创建 holding 的节点，入口完整性尚未达标。
- **real-relationship-first**：路线完成；后段仍出现正文月收入与账本来源不匹配，说明职业事实存在阶段性空洞。
- **real-education-second**：成年零支出已修复，但 23 岁后基础生活支出仍停留在学生档，且多处房产/房贷叙述没有对应账户，净资产仍会被高估。
- **real-venture-second**：开局房产 300 万、房贷 210 万已正确入账；期权 holding 能创建，但固定四年归属与到期没有自动结算，导致期权长期保持零价值并在到期后仍 active。
- **real-custom-lifespan**：单一 shortfall 账户可在收入恢复后还清，89 岁转为 retired，死亡节点确定性改为 not_working 且关闭职业收入；但晚年生活缺口债务仍达到数百万元，需要继续校准支出和兜底政策。

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| UNBALANCED_TRANSACTION | 48 |
| PENDING_FACT | 5 |
| ACCOUNT_TYPE_MISMATCH | 3 |
| CAREER_INCOME_CONFLICT | 7 |
| CAREER_STATE_STALE | 1 |

## 下一步

1. 在年龄阶段变化时重新评估 system-policy basic_living；学生估计不能永久沿用到就业和中年。
2. 为确定性期权归属表实现 period settlement，并在 expirationDateInMonths 到达时自动到期；估值仍必须来自 Accepted Event。
3. 继续补齐缺金额、缺 evidence、缺 business 对象和生效时间越界的归一化/修复重试，降低终局 open issue。
4. 将薪资、房产和持股 coverage issue 作为 M7 阻断项逐节点关闭，不能只依赖报告重写掩盖缺失事实。
5. 修复后必须重新跑全新的 2/2/1 五路线，不能复用本轮 JSON。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 `full-test-data.md`；机器可读审计见 `finance-audit.json`。
