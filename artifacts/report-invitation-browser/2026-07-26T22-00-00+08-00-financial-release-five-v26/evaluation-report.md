# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、含家庭支持与债务利息的可支配现金流恒等式、现金 floor 与年龄对齐共 121 个节点、0 个失败。

本轮动态发布判断：**通过真实路线财务门禁**。以下 P0 动态阻断项均为 0。

- 无

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
| real-career-first | accept_first | 16 | 47岁1个月 | 5820d13d:accepted | user_reflection | 0 | 通过 |
| real-custom-lifespan | natural_lifespan | 27 | 88岁10个月 | 69d63b69:declined → aeadbf55:declined | mortality | 0 | 通过 |
| real-education-second | accept_second | 22 | 54岁1个月 | 8b024509:declined → bbdaff70:accepted | user_reflection | 0 | 通过 |
| real-relationship-first | accept_first | 23 | 54岁 | 6f6b5e28:accepted | user_reflection | 0 | 通过 |
| real-venture-second | accept_second | 33 | 62岁2个月 | 18e6ecb5:declined → ff2eb1a4:accepted | user_reflection | 0 | 通过 |

本轮没有失败后替换人物；所有完成记录均来自同一新 run。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
| 无 | — | — | 无 |

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 116 | 样本基数 |
| Accepted 覆盖率 | 96.5517%（112/116） | 目标 ≥80% |
| stale 节点率 | 0%（0/116） | 越低越好 |
| 薪资不匹配率 | 0%（0/116） | 目标 0 |
| 正文持股但无持股账户 | 0 | 目标 0 |
| 正文期权但无 stock_option holding | 0 | 目标 0 |
| 正文房产/房贷但无房产账户 | 0 | 目标 0 |
| 成年支出为 0 | 0 | 非阻断诊断；缺失时收入必须隔离 |
| 80 岁后仍 employed | 0 | 目标 0 |
| 其中无近期工作证据仍 employed | 0 | 诊断项 |
| 开局重大资产负债漏入账 | 0 组 | 目标 0 |
| narrative fallback | 12 个 / 5 组 | 必须如实统计，残章目标 0 |
| 用户可见内部账本文本 | 0 | 目标 0 |
| 终局报告财务冲突 | 0 | 目标 0 |
| 无解释债务跳变 | 0 | 目标 0 |
| 无用户证据开局账户 | 0 | 目标 0 |
| 资产汇总不一致 | 0 | 目标 0 |
| 债务守恒失败 | 0 | 目标 0 |
| 缓冲以上缺口债冻结 | 0 | 目标 0 |
| 已知利率漏计息 | 0/63 | 目标 0 |
| 无事实却声称还清 | 0 | 目标 0 |
| 用户可见财务占位符 | 0 | 目标 0 |
| 截断/孤立财务金额 | 0 | 目标 0 |
| 财务金额长浮点 | 0 | 目标 0 |
| 跨 journey 邀请/Arc | 0 | 目标 0 |
| 公司经营收支进入个人账本 | 0 | 目标 0 |
| 空白/全黑海报导出 | 0 | 目标 0 |
| 海报与报告页证据重复 | 0 | 目标 0 |
| 用户可见生成暂停 | 0 次 / 0 组 | 发布门禁必须为 0 |
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
| open / resolved issue | 7 / 71 | 必须有关闭路径且终局可控 |
| blocking open issue | 0 | 发布门禁必须为 0 |
| 偿付 warning / 真实困境债务账户 | 1 / 1 | warning 不得超过真实困境账户，且不得指向已恢复账户 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 16 | 1 | 954.95 | 954.95 | 0 | 54 | 13.8 | employed |
| real-custom-lifespan | natural_lifespan | mortality | 27 | 2 | 186.15 | 228.15 | 0 | 1.8 | 6 | not_working |
| real-education-second | accept_second | user_reflection | 22 | 2 | 462.932 | 446.2929 | 16.6391 | 13.9992 | 4.2 | employed |
| real-relationship-first | accept_first | user_reflection | 23 | 1 | 0 | 19.6968 | 130.3032 | 28 | 15.24 | employed |
| real-venture-second | accept_second | user_reflection | 33 | 2 | 318.1179 | 333.1179 | 15 | 0 | 4.2 | self_employed |

## 逐组可复核结果

- **real-career-first**：16 个节点，1 次邀请；终局现金 954.95 万、债务 0 万、净资产 954.95 万，就业状态 employed；路线契约通过。
- **real-custom-lifespan**：27 个节点，2 次邀请；终局现金 186.15 万、债务 0 万、净资产 228.15 万，就业状态 not_working；路线契约通过。
- **real-education-second**：22 个节点，2 次邀请；终局现金 462.932 万、债务 16.6391 万、净资产 446.2929 万，就业状态 employed；路线契约通过。
- **real-relationship-first**：23 个节点，1 次邀请；终局现金 0 万、债务 130.3032 万、净资产 19.6968 万，就业状态 employed；路线契约通过。
- **real-venture-second**：33 个节点，2 次邀请；终局现金 318.1179 万、债务 15 万、净资产 333.1179 万，就业状态 self_employed；路线契约通过。

以下结论直接从本轮各节点账本与正文计算，不复用旧批次的路线描述：

| 人物 | 不变量失败 | 薪资错配 | 成年零支出 | 企业事实污染 | 重复生活/住房基线 | 房产缺口 | 期权 holding 缺口 | 有价值期权漏计 | 80+ employed | 终局 open issue | 判断 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-custom-lifespan | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-education-second | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-relationship-first | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 核心现实性门禁通过 |
| real-venture-second | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 核心现实性门禁通过 |

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| DEBT_PAYMENT_DELINQUENT | 1 |
| PENDING_FACT | 1 |

## 下一步

1. 继续执行静态 M5/M7、全量单测、lint、typecheck/build 与十张图片检查；全部通过后才可判定发布候选。
2. open issue、薪资措辞偏差与持股/房产叙述代理指标保留为非阻断质量 backlog，不得伪装为 0。

## 生产阻断明细

- narrative fallback 节点：real-career-first#9、real-career-first#10、real-custom-lifespan#21、real-education-second#5、real-education-second#11、real-relationship-first#5、real-relationship-first#11、real-relationship-first#12、real-relationship-first#18、real-relationship-first#20、real-relationship-first#21、real-venture-second#22
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
