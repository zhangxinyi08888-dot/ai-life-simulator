# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、含家庭支持与债务利息的可支配现金流恒等式、现金 floor 与年龄对齐共 176 个节点、0 个失败。

本轮动态发布判断：**通过真实路线财务门禁**。以下 P0 动态阻断项均为 0。

- 无

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
| real-career-first | accept_first | 20 | 31岁4个月 | 056ac6ef:accepted | user_reflection | 0 | 通过 |
| real-custom-lifespan | natural_lifespan | 89 | 80岁7个月 | 4c500e32:declined → 6c75301d:declined → bff0f533:declined → 3de60f04:declined → 99afb486:declined → b2681116:declined → 897dda9c:declined → c9ddeaee:declined → e994c54a:declined → c7015e0c:declined → 471b3deb:declined → 7f512b1e:declined → 7c58dc94:declined | mortality | 0 | 通过 |
| real-education-second | accept_second | 26 | 32岁4个月 | b26747b8:declined → 14f41b93:accepted | user_reflection | 0 | 通过 |
| real-venture-second | accept_second | 25 | 34岁10个月 | a73c63f2:declined → d309ed0c:accepted | user_reflection | 0 | 通过 |
| real-wealth-first-replacement | accept_first | 16 | 43岁7个月 | fe514394:accepted | user_reflection | 0 | 通过 |

所有完成记录均来自同一新 run。`real-relationship-first` 曾在首张报告邀请出现前因生理终局结束，已作为未完成尝试存档于 `failed-attempts/real-relationship-first-early-mortality.json`，未计入案例、未复用；随后新开 `real-wealth-first-replacement` 作为首邀接受的替代路线。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
| 无 | — | — | 无 |

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 144 | 样本基数 |
| Accepted 覆盖率 | 97.2222%（140/144） | 目标 ≥80% |
| stale 节点率 | 0%（0/144） | 越低越好 |
| 薪资不匹配率 | 0%（0/144） | 目标 0 |
| 正文持股但无持股账户 | 0 | 目标 0 |
| 正文期权但无 stock_option holding | 0 | 目标 0 |
| 正文房产/房贷但无房产账户 | 0 | 目标 0 |
| 成年支出为 0 | 0 | 非阻断诊断；缺失时收入必须隔离 |
| 80 岁后仍 employed | 0 | 目标 0 |
| 其中无近期工作证据仍 employed | 0 | 诊断项 |
| 开局重大资产负债漏入账 | 0 组 | 目标 0 |
| narrative fallback | 10 个 / 5 组 | 必须如实统计，残章目标 0 |
| 用户可见内部账本文本 | 0 | 目标 0 |
| 终局报告财务冲突 | 0 | 目标 0 |
| 无解释债务跳变 | 0 | 目标 0 |
| 无用户证据开局账户 | 0 | 目标 0 |
| 资产汇总不一致 | 0 | 目标 0 |
| 债务守恒失败 | 0 | 目标 0 |
| 缓冲以上缺口债冻结 | 0 | 目标 0 |
| 已知利率漏计息 | 0/28 | 目标 0 |
| 无事实却声称还清 | 0 | 目标 0 |
| 用户可见财务占位符 | 0 | 目标 0 |
| 截断/孤立财务金额 | 0 | 目标 0 |
| 财务金额长浮点 | 0 | 目标 0 |
| 跨 journey 邀请/Arc | 0 | 目标 0 |
| 公司经营收支进入个人账本 | 0 | 目标 0 |
| 空白/全黑海报导出 | 0 | 目标 0 |
| 海报与报告页证据重复 | 0 | 目标 0 |
| 用户可见生成暂停 | 0 次 / 0 组 | 发布门禁必须为 0 |
| 未分类模型调用 | 0 | 目标 0 |
| 单节点 Patch 超预算 | 0 | 目标 0 |
| 仅一次完整生成节点比例 | 96.5% | 目标 ≥90% |
| 暂停后恢复成功 | 0 次 | 诊断项，不抵消暂停阻断 |
| 多个活跃 shortfall 账户节点 | 0 | 目标 0 |
| 系统 shortfall 自触发计划噪音 | 0 | 目标 0 |
| issue 泄漏异常/undefined | 0 | 目标 0 |
| 报告内部占位符 | 0 组 | 目标 0 |
| 有价值期权未计入用户财富 | 0 | 目标 0 |
| 或有/缺估值期权错误计入财富 | 0 | 目标 0 |
| 过期但仍 active 的期权节点 | 0 | 目标 0 |
| 非法持股 instrumentType 节点 | 0 | 目标 0 |
| 公司营收或经营成本进入个人收支 | 0 | 目标 0 |
| basic_living / housing 重复 active | 0 | 目标 0 |
| 23 岁后仍低于成年支出政策下限 | 0 | 目标 0 |
| open / resolved issue | 7 / 94 | 必须有关闭路径且终局可控 |
| blocking open issue | 0 | 发布门禁必须为 0 |
| 偿付 warning / 真实困境债务账户 | 0 / 0 | warning 不得超过真实困境账户，且不得指向已恢复账户 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 20 | 1 | 25.7328 | 25.7328 | 0 | 0 | 4.2 | employed |
| real-custom-lifespan | natural_lifespan | mortality | 89 | 13 | 318.0881 | 318.0881 | 0 | 0 | 12.12 | not_working |
| real-education-second | accept_second | user_reflection | 26 | 2 | 0 | 0 | 0 | 0 | 2.4 | student |
| real-venture-second | accept_second | user_reflection | 25 | 2 | 80.5005 | -15.7495 | 96.25 | 30 | 4.2 | self_employed |
| real-wealth-first-replacement | accept_first | user_reflection | 16 | 1 | 255.65 | 255.65 | 0 | 21.6 | 4.2 | employed |

## 逐组可复核结果

- **real-career-first**：20 个节点，1 次邀请；终局现金 25.7328 万、债务 0 万、净资产 25.7328 万，就业状态 employed；路线契约通过。
- **real-custom-lifespan**：89 个节点，13 次邀请；终局现金 318.0881 万、债务 0 万、净资产 318.0881 万，就业状态 not_working；路线契约通过。
- **real-education-second**：26 个节点，2 次邀请；终局现金 0 万、债务 0 万、净资产 0 万，就业状态 student；路线契约通过。
- **real-venture-second**：25 个节点，2 次邀请；终局现金 80.5005 万、债务 96.25 万、净资产 -15.7495 万，就业状态 self_employed；路线契约通过。
- **real-wealth-first-replacement**：16 个节点，1 次邀请；终局现金 255.65 万、债务 0 万、净资产 255.65 万，就业状态 employed；路线契约通过。

以下结论直接从本轮各节点账本与正文计算，不复用旧批次的路线描述：

| 人物 | 不变量失败 | 薪资错配 | 成年零支出 | 企业事实污染 | 重复生活/住房基线 | 房产缺口 | 期权 holding 缺口 | 有价值期权漏计 | 80+ employed | 终局 open issue | 判断 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 核心现实性门禁通过 |
| real-custom-lifespan | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-education-second | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-venture-second | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 核心现实性门禁通过 |
| real-wealth-first-replacement | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| PENDING_FACT | 2 |

## Cache Prefix 请求级遥测

- 已接受 next-node：171；带 usage 的 next-node 调用：177。
- 输入命中率：67.3469%；未命中 tokens/成功节点：3070.0058479532163；输入 tokens/成功节点：9401.888888888889。
- 首次生成通过率：96.4912%；完整重试/成功节点：0.03508771929824561；首 token p50/p95：971/7312 ms。

| 调用类型 | Prompt family | Prefix 版本 | 调用数 | 有 usage | 输入 tokens | 命中 tokens | 未命中 tokens | 输入命中率 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| final_outcome_generation | final_outcome | unversioned | 1 | 1 | 2731 | 0 | 2731 | 0% |
| full_regeneration | next_node | next_node_cache_prefix_v1_compact_context_r2 | 6 | 6 | 53486 | 52608 | 878 | 98.3584% |
| initial_generation | next_node | next_node_cache_prefix_v1_compact_context_r2 | 171 | 171 | 1554237 | 1030144 | 524093 | 66.2797% |
| proposal_repair | financial_proposal_repair | unversioned | 69 | 69 | 161487 | 0 | 161487 | 0% |
| romance_candidate_extraction | romance_candidate | unversioned | 2 | 2 | 1131 | 0 | 1131 | 0% |

## 下一步

1. 继续执行静态 M5/M7、全量单测、lint、typecheck/build 与十张图片检查；全部通过后才可判定发布候选。
2. open issue、薪资措辞偏差与持股/房产叙述代理指标保留为非阻断质量 backlog，不得伪装为 0。

## 生产阻断明细

- narrative fallback 节点：real-career-first#2、real-custom-lifespan#40、real-education-second#10、real-education-second#15、real-venture-second#2、real-venture-second#7、real-venture-second#16、real-venture-second#24、real-wealth-first-replacement#9、real-wealth-first-replacement#15
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

1. 逐项处理上方动态生成的阻断项；不得用旧批次的固定结论替代本轮证据。
2. 入口事实修复继续使用原句、类型化账户 ID 和一次结构化重试，不降低 Validator 标准。
3. 期权验收保持双向门禁：可靠折后 carrying value 必须进入企业及其他资产、净资产和财富分；未归属或缺可靠估值期权只保留 contingent holding。
4. 所有阻断归零后仍需再跑全新的 2/2/1，不能复用本轮 JSON。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 `full-test-data.md`；机器可读审计见 `finance-audit.json`。

证据索引：`cases/` 保存五组完整 JSON，`working/` 保存同轮 checkpoint，`images/<case>/report-page.jpg` 与 `poster.jpg` 保存终局页面和海报，`visual-inspection.json` 保存人工视觉复核结果。
