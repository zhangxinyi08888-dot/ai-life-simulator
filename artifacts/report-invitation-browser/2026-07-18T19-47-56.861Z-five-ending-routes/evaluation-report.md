# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、可支配收入恒等式、现金 floor 与年龄对齐共 140 个节点、0 个失败。入口层修复已经让合法事实更容易进入账本；报告中的无来源金额必须被重写成自然的定性结论，不能泄漏内部占位符。

但 **M7 仍不允许切换唯一写入者**。静态代码门禁通过并不代表动态事实完整；本轮存在以下阻断项：

- 正文出现期权但没有 stock_option holding：8 个节点
- 23 岁后生活支出仍低于成年保守政策下限：17 个节点
- 终局仍存在 open issue：74 个

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
| real-career-first | accept_first | 16 | 56岁5个月 | 5ccd8554:accepted | user_reflection | 1 | 通过 |
| real-custom-lifespan | natural_lifespan | 59 | 92岁9个月 | 573efba5:declined → f7563c83:declined → 9bee0c9f:declined → c4aa0699:declined | mortality | 4 | 通过 |
| real-education-second | accept_second | 22 | 60岁10个月 | f9cc9ac8:declined → e07ed789:accepted | user_reflection | 0 | 通过 |
| real-relationship-first | accept_first | 17 | 53岁3个月 | 17d5a47c:accepted | user_reflection | 0 | 通过 |
| real-venture-second | accept_second | 26 | 63岁6个月 | 2b3f2deb:declined → ace63a0e:accepted | user_reflection | 1 | 通过 |

本轮没有失败后替换人物；所有完成记录均来自同一新 run。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
| real-career-first | recoverable_error | 11 | AI 返回内容格式异常 |
| real-custom-lifespan | recoverable_error | 0 | background questions format error |
| real-custom-lifespan | recoverable_timeout | 0 | background questions retry timed out |
| real-custom-lifespan | recoverable_error | 10 | AI 返回内容格式异常 |
| real-custom-lifespan | recoverable_error | 57 | AI 返回内容格式异常 |
| real-venture-second | recoverable_error | 21 | AI 返回内容格式异常 |

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 133 | 样本基数 |
| Accepted 覆盖率 | 96.9925%（129/133） | 目标 ≥80% |
| stale 节点率 | 0%（0/133） | 越低越好 |
| 薪资不匹配率 | 6.7669%（9/133） | 目标 0 |
| 正文持股但无持股账户 | 18 | 目标 0 |
| 正文期权但无 stock_option holding | 8 | 目标 0 |
| 正文房产/房贷但无房产账户 | 9 | 目标 0 |
| 成年支出为 0 | 0 | 目标 0 |
| 80 岁后无近期工作证据仍 employed | 0 | 目标 0 |
| 开局重大资产负债漏入账 | 0 组 | 目标 0 |
| 多个活跃 shortfall 账户节点 | 0 | 目标 0 |
| 系统 shortfall 自触发计划噪音 | 0 | 目标 0 |
| issue 泄漏异常/undefined | 0 | 目标 0 |
| 报告内部占位符 | 0 组 | 目标 0 |
| 有价值期权未计入用户财富 | 0 | 目标 0 |
| 或有/缺估值期权错误计入财富 | 0 | 目标 0 |
| 过期但仍 active 的期权节点 | 0 | 目标 0 |
| 23 岁后仍低于成年支出政策下限 | 17 | 目标 0 |
| open / resolved issue | 74 / 52 | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 16 | 1 | 557.5 | 557.5 | 0 | 0 | 6 | employed |
| real-custom-lifespan | natural_lifespan | mortality | 59 | 4 | 0 | -1045.9563 | 1045.9563 | 0 | 23.88 | not_working |
| real-education-second | accept_second | user_reflection | 22 | 2 | 738.1 | 738.1 | 0 | 19.2 | 2.4 | employed |
| real-relationship-first | accept_first | user_reflection | 17 | 1 | 0 | -80.97 | 290.97 | 21.6 | 22.8 | employed |
| real-venture-second | accept_second | user_reflection | 26 | 2 | 5289.3667 | 5579.3667 | 0 | 960 | 426 | employed |

## 逐组现实性结论

- **real-career-first**：账本算术与现金闭环稳定，但正文中的创业权益仍有未创建 holding 的节点，入口完整性尚未达标。
- **real-relationship-first**：路线完成且没有 stale 节点；部分正文月收入仍找不到同额活跃来源，职业收入事实仍有阶段性偏差。
- **real-education-second**：成年零支出为 0，但 system-policy commitment 被标成 needs_review 后没有在 23 岁边界重估，非学生阶段仍长期停在 0.2 万/月；房产叙述也仍有账户缺口。
- **real-venture-second**：开局房产和房贷已正确入账，确定性期权归属/到期单测通过；但真实路线中的期权 Proposal 没有形成 stock_option holding，因此仍谈不上把可靠期权价值计入财富。
- **real-custom-lifespan**：单一 shortfall 账户与死亡闭环有效，终局为 not_working 且无无证据的 80+ 工资；但晚年净债务规模和大量未关闭事实仍需治理。

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| UNBALANCED_TRANSACTION | 39 |
| ACCOUNT_TYPE_MISMATCH | 12 |
| PENDING_FACT | 8 |
| CAREER_INCOME_CONFLICT | 9 |
| CAREER_STATE_STALE | 1 |

## 下一步

1. system-policy basic_living 的年龄重估必须识别 estimated 与 needs_review 两种状态；被审查不能阻断政策切档。
2. 对 business_holding_started / business_option_granted 的常见嵌套形状补归一化，并把“正文有期权、无 stock_option holding”设为专项 coverage 阻断；固定归属和到期仍由已实现的期间结算负责。
3. 继续补齐缺金额、缺 evidence、缺 business 对象、ID 类型混用和生效时间越界的归一化/修复重试，降低终局 open issue。
4. 将薪资、房产、普通股和期权 coverage issue 作为 M7 阻断项逐节点关闭，不能只依赖报告重写掩盖缺失事实。
5. 修复后必须重新跑全新的 2/2/1 五路线，不能复用本轮 JSON。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 `full-test-data.md`；机器可读审计见 `finance-audit.json`。

证据索引：`cases/` 保存五组完整 JSON，`working/` 保存同轮 checkpoint，`images/<case>/report-page.jpg` 与 `poster.jpg` 保存终局页面和海报，`visual-inspection.json` 保存人工视觉复核结果。
