# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、含家庭支持与债务利息的可支配现金流恒等式、现金 floor 与年龄对齐共 122 个节点、0 个失败。

本轮动态发布判断：**不允许发布**。存在以下阻断项：

- 终局仍存在 blocking open issue：1 个
- 人工正文质量审计发现：内部审计模板泄漏、句子拼接损坏、状态与后续结果矛盾

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
| real-career-first | accept_first | 17 | 30岁8个月 | 7425ddf4:accepted | user_reflection | 0 | 通过 |
| real-custom-lifespan | natural_lifespan | 34 | 78岁8个月 | 7e3e7f27:declined → a4d06f8c:declined → b1a7af67:declined | mortality | 0 | 通过 |
| real-education-second | accept_second | 29 | 31岁1个月 | ccebc956:declined → 25396e10:accepted | user_reflection | 0 | 通过 |
| real-relationship-first | accept_first | 17 | 44岁7个月 | 562c76e4:accepted | user_reflection | 0 | 通过 |
| real-venture-second | accept_second | 25 | 50岁6个月 | fc857a63:declined → ea29e399:accepted | user_reflection | 0 | 通过 |

本轮没有失败后替换人物；所有完成记录均来自同一新 run。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
| 无 | — | — | 无 |

正式 case 开始前发生过一次 collector 入口配置失败：首次 URL 未带 `recordTestRun`，随后启用 `importTestState` 时导入浮层遮挡入口。最终改用仅含 `recordTestRun` 的 URL 后开始正式采集。该过程没有生成故事节点或 case JSON，也没有替换、重跑任何正式路线；原始说明见 `setup-failures/collector-entry.json`。

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 110 | 样本基数 |
| Accepted 覆盖率 | 96.3636%（106/110） | 目标 ≥80% |
| stale 节点率 | 0%（0/110） | 越低越好 |
| 薪资不匹配率 | 0%（0/110） | 目标 0 |
| 正文持股但无持股账户 | 0 | 目标 0 |
| 正文期权但无 stock_option holding | 0 | 目标 0 |
| 正文房产/房贷但无房产账户 | 0 | 目标 0 |
| 成年支出为 0 | 0 | 非阻断诊断；缺失时收入必须隔离 |
| 80 岁后仍 employed | 0 | 目标 0 |
| 其中无近期工作证据仍 employed | 0 | 诊断项 |
| 开局重大资产负债漏入账 | 0 组 | 目标 0 |
| narrative fallback | 13 个 / 5 组 | 必须如实统计，残章目标 0 |
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
| 仅一次完整生成节点比例 | 96.6% | 目标 ≥90% |
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
| open / resolved issue | 8 / 25 | 必须有关闭路径且终局可控 |
| blocking open issue | 1 | 发布门禁必须为 0 |
| 偿付 warning / 真实困境债务账户 | 0 / 0 | warning 不得超过真实困境账户，且不得指向已恢复账户 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 17 | 1 | 0 | -6.7 | 6.7 | 3.6 | 4.2 | self_employed |
| real-custom-lifespan | natural_lifespan | mortality | 34 | 3 | 0 | -68.5599 | 68.5599 | 0 | 4.2 | not_working |
| real-education-second | accept_second | user_reflection | 29 | 2 | 0 | -31.4 | 31.4 | 0 | 2.4 | student |
| real-relationship-first | accept_first | user_reflection | 17 | 1 | 62.15 | 62.15 | 0 | 2.4 | 4.2 | employed |
| real-venture-second | accept_second | user_reflection | 25 | 2 | 1.05 | -12.9647 | 14.0147 | 19.2 | 4.2 | self_employed |

## 逐组可复核结果

- **real-career-first**：17 个节点，1 次邀请；终局现金 0 万、债务 6.7 万、净资产 -6.7 万，就业状态 self_employed；路线契约通过。
- **real-custom-lifespan**：34 个节点，3 次邀请；终局现金 0 万、债务 68.5599 万、净资产 -68.5599 万，就业状态 not_working；路线契约通过。
- **real-education-second**：29 个节点，2 次邀请；终局现金 0 万、债务 31.4 万、净资产 -31.4 万，就业状态 student；路线契约通过。
- **real-relationship-first**：17 个节点，1 次邀请；终局现金 62.15 万、债务 0 万、净资产 62.15 万，就业状态 employed；路线契约通过。
- **real-venture-second**：25 个节点，2 次邀请；终局现金 1.05 万、债务 14.0147 万、净资产 -12.9647 万，就业状态 self_employed；路线契约通过。

以下结论直接从本轮各节点账本与正文计算，不复用旧批次的路线描述：

| 人物 | 不变量失败 | 薪资错配 | 成年零支出 | 企业事实污染 | 重复生活/住房基线 | 房产缺口 | 期权 holding 缺口 | 有价值期权漏计 | 80+ employed | 终局 open issue | 判断 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-custom-lifespan | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-education-second | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 核心现实性门禁通过 |
| real-relationship-first | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 核心现实性门禁通过 |
| real-venture-second | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 核心现实性门禁通过 |

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| PENDING_FACT | 2 |
| CAREER_INCOME_CONFLICT | 1 |

## Cache Prefix 请求级遥测

- 已接受 next-node：117；带 usage 的 next-node 调用：121。
- 输入命中率：52.8862%；未命中 tokens/成功节点：5780.410256410257；输入 tokens/成功节点：12269.02564102564。
- 首次生成通过率：96.5812%；完整重试/成功节点：0.03418803418803419；首 token p50/p95：917/1549 ms。

| 调用类型 | Prompt family | Prefix 版本 | 调用数 | 有 usage | 输入 tokens | 命中 tokens | 未命中 tokens | 输入命中率 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| final_outcome_generation | final_outcome | unversioned | 1 | 1 | 2931 | 0 | 2931 | 0% |
| full_regeneration | next_node | next_node_cache_prefix_v2_reference_context_r4 | 4 | 4 | 45069 | 44928 | 141 | 99.6871% |
| initial_generation | next_node | next_node_cache_prefix_v2_reference_context_r4 | 117 | 117 | 1390407 | 714240 | 676167 | 51.3691% |
| proposal_repair | financial_proposal_repair | unversioned | 22 | 22 | 58144 | 0 | 58144 | 0% |

## 下一步

1. 修复终局 `CAREER_INCOME_CONFLICT`，保证正文新增个人收入活动前存在对应 accepted event。
2. 移除文学正文中的内部审计模板句；将财务回退从“删 span 后拼接”改为句/从句边界的事实感知修复。
3. 修复“协议尚未生效”却“执行新计划”的依赖结果矛盾，并统一 venture 测试人物的年龄锚点。
4. 只做确定性回归测试和针对问题节点的聚焦复测；按本轮约束，不再执行第二次 2/2/1。

## 人工正文质量审计

自动路线契约通过不等于生成质量通过。人工复核发现以下发布阻断：

- `real-relationship-first` 与 `real-venture-second` 的正文出现“尚未被写成未经权威状态确认的成功结果”等内部审计模板，破坏叙事并向用户泄漏验证语义。
- `real-career-first` 出现“比原来少了三分之一……”的缺主语残句，以及“账本上依然见底的整体仍处于负债状态的欠款”的错误拼接，说明当前回退会破坏句法边界。
- `real-venture-second` 同时声称“调整还款安排尚未形成生效协议”和“过去十六个月严格执行新计划”，构成事实依赖矛盾。
- 同一路线终局保留 `CAREER_INCOME_CONFLICT`：正文宣告新增个人收入活动，但没有相应 accepted event。
- venture 人物配置本身存在 31 岁房贷锚点与 24 岁回溯入口不一致，归为测试夹具问题。

机器可读证据及处置依据见 `manual-quality-audit.json`。因此本轮结论是：**2/2/1 路径执行成功，但 V2 发布验收失败，不能据此直接发布。**

## 生产阻断明细

- narrative fallback 节点：real-career-first#2、real-custom-lifespan#28、real-education-second#4、real-education-second#7、real-education-second#10、real-relationship-first#3、real-relationship-first#10、real-venture-second#2、real-venture-second#11、real-venture-second#13、real-venture-second#16、real-venture-second#18、real-venture-second#20
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
4. 本次为约定的唯一一次最终 2/2/1；修复后保留本轮 JSON 作为失败基线，仅运行聚焦复测，不启动第二轮完整 2/2/1。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 `full-test-data.md`；机器可读审计见 `finance-audit.json`。

证据索引：`cases/` 保存五组完整 JSON，`working/` 保存同轮 checkpoint，`images/<case>/report-page.jpg` 与 `poster.jpg` 保存终局页面和海报，`visual-inspection.json` 保存 10 张图片的人工视觉复核结果，`manual-quality-audit.json` 保存正文质量阻断，`setup-failures/` 保存正式 case 前的入口配置失败说明。
