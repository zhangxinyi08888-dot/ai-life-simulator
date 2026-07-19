# 五组真实网页测试：财务完整审计报告

## 结论

本轮五条全新真实网页路线的 **2/2/1 路径契约全部通过**，账本恒等式、可支配收入恒等式、现金 floor 与年龄对齐共 119 个节点、0 个失败。入口层修复已经让合法事实更容易进入账本；报告中的无来源金额必须被重写成自然的定性结论，不能泄漏内部占位符。

但 **M7 仍不允许切换唯一写入者**。静态代码门禁通过并不代表动态事实完整；本轮存在以下阻断项：

- 正文月收入与活跃收入来源不一致：8 个节点
- 正文主人公房产或房贷事实没有房产账户：3 个节点
- 持股 instrumentType 不在权威枚举内：5 个节点
- 终局仍存在 open issue：69 个

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
| real-career-first | accept_first | 16 | 55岁1个月 | 5cecb989:accepted | user_reflection | 1 | 通过 |
| real-custom-lifespan | natural_lifespan | 43 | 100岁3个月 | 5b572d1d:declined → a2a7b4b5:declined → 0c5acd7e:declined → e8cf6c88:declined → d8c59b98:declined → 0f211f0d:declined | mortality | 2 | 通过 |
| real-education-second | accept_second | 22 | 53岁3个月 | 5f42f127:declined → 46b41325:accepted | user_reflection | 1 | 通过 |
| real-relationship-first | accept_first | 16 | 61岁9个月 | 398661b6:accepted | user_reflection | 1 | 通过 |
| real-venture-second | accept_second | 22 | 62岁3个月 | 8c24e23e:declined → d5b13e4d:accepted | user_reflection | 1 | 通过 |

本轮没有失败后替换人物；所有完成记录均来自同一新 run。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
| real-career-first | recoverable_error | 15 | 页面已完成节点并显示邀请；采集器等待超时后从同轮页面状态继续 |
| real-custom-lifespan | recoverable_error | 4 | AI 返回内容格式异常；通过页面可见继续生成完成同一节点 |
| real-custom-lifespan | recoverable_error | 14 | 浏览器控制会话超时；从本次运行目录内同人物 checkpoint 恢复 |
| real-education-second | recoverable_error | 15 | 页面已完成节点并显示邀请；浏览器控制等待超时后从同轮状态继续 |
| real-relationship-first | recoverable_error | 7 | 页面节点已经完成，立即展开按钮交互超时；从同轮页面状态继续 |
| real-venture-second | recoverable_error | 12 | AI 返回内容格式异常；通过页面可见继续生成完成同一节点 |

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | 0 | 通过 |
| 财务叙述节点 | 108 | 样本基数 |
| Accepted 覆盖率 | 96.2963%（104/108） | 目标 ≥80% |
| stale 节点率 | 0%（0/108） | 越低越好 |
| 薪资不匹配率 | 7.4074%（8/108） | 目标 0 |
| 正文持股但无持股账户 | 0 | 目标 0 |
| 正文期权但无 stock_option holding | 0 | 目标 0 |
| 正文房产/房贷但无房产账户 | 3 | 目标 0 |
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
| 非法持股 instrumentType 节点 | 5 | 目标 0 |
| 23 岁后仍低于成年支出政策下限 | 0 | 目标 0 |
| open / resolved issue | 69 / 32 | 必须有关闭路径且终局可控 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| real-career-first | accept_first | user_reflection | 16 | 1 | 651.75 | 656.75 | 0 | 0 | 10.2 | employed |
| real-custom-lifespan | natural_lifespan | mortality | 43 | 6 | 0 | -216.626 | 221.626 | 1.14 | 12.72 | not_working |
| real-education-second | accept_second | user_reflection | 22 | 2 | 206.84 | 206.84 | 0 | 19.2 | 12.36 | student |
| real-relationship-first | accept_first | user_reflection | 16 | 1 | 431.2205 | 441.2205 | 0 | 0 | 5.4 | employed |
| real-venture-second | accept_second | user_reflection | 22 | 2 | 315.2333 | 685.2333 | 0 | 0 | 47.4 | employed |

## 逐组现实性结论

- **real-career-first**：个人期权 holding 已形成，固定归属持续结算且没有把归属期误作到期；由于正文始终没有可靠公允单价，期权账面值为 0、未计入财富是正确的保守结果。终局仍为 employed 但权威年收入已被 stale policy 暂停为 0，说明职业确认/退休闭环仍未完成。
- **real-relationship-first**：三段正文明确出现主人公房贷、提前还本和还清事实，但账本始终没有房产账户；终局 employed、年收入 0 也表明职业收入确认被挂起。这是当前最明确的事实摄取缺口。
- **real-education-second**：成年零支出与 23 岁后低支出均已归零，基础生活费政策切档修复有效；但 53 岁终局仍标 student，同时正文的 2.5 万月收入与活跃来源不一致，CareerState 长期演化仍有偏差。
- **real-venture-second**：开局 210 万房产/房贷已正确入账，终局房贷归零；企业权益进入账户，但模型返回了非法的 non_listed_equity instrumentType，且 150 万 carrying value 仍为 needs_review，只能作为原始净资产估计，不能进入保守财富属性。
- **real-custom-lifespan**：100 岁 3 个月生理终局为 not_working，80+ 工资计提、重复 shortfall 和系统债务计划噪音均为 0；但终局净债务 216.626 万且仍有大量拒绝事实，负债规模部分来自入口拒绝后的保守偏差，不能仅按算术正确判为现实。

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
| LEGACY_UNCERTAINTY | 5 |
| UNBALANCED_TRANSACTION | 35 |
| BUSINESS_PERSONAL_BOUNDARY_CONFLICT | 2 |
| PENDING_FACT | 11 |
| CAREER_INCOME_CONFLICT | 5 |
| ACCOUNT_TYPE_MISMATCH | 7 |
| CAREER_STATE_STALE | 4 |

## 下一步

1. 优先修复后续购房/房贷 coverage repair：向修复模型提供原句、现有现金/债务 ID 与成对的 asset_purchased + debt_drawn 示例；仍失败时必须暂停相关结算并保持具体 pending fact，不能让房贷叙述无账户地继续。
2. 收口 CareerState 与收入来源：解决 53 岁 student、employed 但年收入为 0，以及 8 个正文月收入不匹配；职业转换必须和旧收入关闭、新收入启动组成受控依赖组。
3. 归一化持股 instrumentType 同义词并在账本边界拒绝非法枚举；本轮暴露的 non_listed_equity 已映射为 equity，后续不得把运行时非法字符串写入权威账本。
4. 继续补齐缺金额、缺 evidence、缺 business 对象、ID 类型混用和生效时间越界的结构化修复，重点消除 35 个 UNBALANCED_TRANSACTION、11 个 PENDING_FACT 与 7 个 ACCOUNT_TYPE_MISMATCH。
5. 期权验收保持双向门禁：可靠折后 carrying value 必须进入企业及其他资产、净资产和财富分；未归属或缺可靠估值期权只保留 contingent holding。上述阻断修复后再跑全新的 2/2/1，不能复用本轮 JSON。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 `full-test-data.md`；机器可读审计见 `finance-audit.json`。

证据索引：`cases/` 保存五组完整 JSON，`working/` 保存同轮 checkpoint，`images/<case>/report-page.jpg` 与 `poster.jpg` 保存终局页面和海报，`visual-inspection.json` 保存人工视觉复核结果。
