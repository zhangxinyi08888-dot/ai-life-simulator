# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、含家庭支持与债务利息的可支配现金流恒等式、现金 floor 与年龄对齐共 161 个节点、0 个失败。

本轮动态发布判断：**通过真实路线财务门禁**。以下 P0 动态阻断项均为 0。

- 无

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 156 | 样本基数 |
| Accepted 覆盖率 | 97.4359%（152/156） | 目标 ≥80% |
| stale 节点率 | 0%（0/156） | 越低越好 |
| 薪资不匹配率 | 0%（0/156） | 目标 0 |
| 正文持股但无持股账户 | 0 | 目标 0 |
| 正文房产/房贷但无房产账户 | 8 | 目标 0 |
| 成年支出为 0 | 7 | 非阻断诊断；缺失时收入必须隔离 |
| 80 岁后仍 employed | 0 | 目标 0 |
| 开局重大资产负债漏入账 | 0 组 | 目标 0 |
| narrative fallback | 11 个 / 3 组 | 必须如实统计，残章目标 0 |
| 用户可见内部账本文本 | 0 | 目标 0 |
| 终局报告财务冲突 | 0 | 目标 0 |
| 无解释债务跳变 | 0 | 目标 0 |
| 无用户证据开局账户 | 0 | 目标 0 |
| 资产汇总不一致 | 0 | 目标 0 |
| 债务守恒失败 | 0 | 目标 0 |
| 缓冲以上缺口债冻结 | 0 | 目标 0 |
| 已知利率漏计息 | 0/18 | 目标 0 |
| 无事实却声称还清 | 0 | 目标 0 |
| 用户可见财务占位符 | 0 | 目标 0 |
| 截断/孤立财务金额 | 0 | 目标 0 |
| 财务金额长浮点 | 0 | 目标 0 |
| 跨 journey 邀请/Arc | 0 | 目标 0 |
| 公司经营收支进入个人账本 | 0 | 目标 0 |
| 空白/全黑海报导出 | 0 | 目标 0 |
| 海报与报告页证据重复 | 0 | 目标 0 |
| open / resolved issue | 396 / 599 | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 21 | 1 | 0 | -181.6 | 181.6 | 0 | 18 | employed |
| real-custom-lifespan | natural_lifespan | mortality | 67 | 10 | 0 | -301.3233 | 301.3233 | 0.96 | 3.6 | self_employed |
| real-education-second | accept_second | user_reflection | 27 | 2 | 0 | -43.2 | 43.2 | 0 | 2.76 | self_employed |
| real-relationship-first | accept_first | user_reflection | 24 | 1 | 0 | -296.3604 | 296.3604 | 0 | 18 | employed |
| real-venture-second | accept_second | user_reflection | 22 | 2 | 226.8 | 226.8 | 0 | 42 | 18 | self_employed |

## 逐组可复核结果

- **real-career-first**：21 个节点，1 次邀请；终局现金 0 万、债务 181.6 万、净资产 -181.6 万，就业状态 employed；路线契约通过。
- **real-custom-lifespan**：67 个节点，10 次邀请；终局现金 0 万、债务 301.3233 万、净资产 -301.3233 万，就业状态 self_employed；路线契约通过。
- **real-education-second**：27 个节点，2 次邀请；终局现金 0 万、债务 43.2 万、净资产 -43.2 万，就业状态 self_employed；路线契约通过。
- **real-relationship-first**：24 个节点，1 次邀请；终局现金 0 万、债务 296.3604 万、净资产 -296.3604 万，就业状态 employed；路线契约通过。
- **real-venture-second**：22 个节点，2 次邀请；终局现金 226.8 万、债务 0 万、净资产 226.8 万，就业状态 self_employed；路线契约通过。

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| PENDING_FACT | 6 |
| BUSINESS_PERSONAL_BOUNDARY_CONFLICT | 15 |
| UNBALANCED_TRANSACTION | 23 |
| DEBT_PAYMENT_DELINQUENT | 338 |
| CAREER_INCOME_CONFLICT | 7 |
| UNKNOWN_DEBT_SCHEDULE | 1 |
| MISSING_FUNDING_SOURCE | 1 |

## 下一步

1. 继续执行静态 M5/M7、全量单测、lint、typecheck/build 与十张图片检查；全部通过后才可判定发布候选。
2. open issue、薪资措辞偏差与持股/房产叙述代理指标保留为非阻断质量 backlog，不得伪装为 0。

## 生产阻断明细

- narrative fallback 节点：real-custom-lifespan#6、real-custom-lifespan#43、real-custom-lifespan#45、real-custom-lifespan#47、real-custom-lifespan#51、real-custom-lifespan#61、real-custom-lifespan#64、real-relationship-first#4、real-venture-second#3、real-venture-second#7、real-venture-second#8
- 终局报告冲突：无
- 无解释债务跳变：无
- 缺少用户证据的开局账户：无
- 资产汇总不一致：无
- 债务守恒失败：无
- 缓冲以上缺口债冻结：无
- 已知利率漏计息：无
- 无事实却声称还清：无
- 用户可见财务占位符：无
- 截断/孤立财务金额：无
- 财务金额长浮点：无
- 跨 journey 邀请/Arc：无
- 公司经营收支进入个人账本：无
- 空白/全黑海报：无
- 海报与报告页证据重复：无

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 `full-test-data.md`；机器可读审计见 `finance-audit.json`。
