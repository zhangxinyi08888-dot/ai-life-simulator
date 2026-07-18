# M7 聚焦复核报告

- 运行编号：2026-07-18T-m7-focused-1784369609683
- 数据源：真实网页 + 真实 AI
- 范围：3 条短路径，不重复完整 2/2/1
- 结论：**M7 暂不放行**

## 已验证通过

1. **首轮债务事实进入账本**：用户输入的房贷余额 210 万元、月供 1.3 万元、现金 35 万元均进入权威账本。
2. **成年支出与现金下限闭环**：学生路线存在持续生活支出；现金不足转为流动性缺口债务，负现金失败为 0。
3. **陈旧晚年工资不再无限计提**：58 岁起点路线中，旧版 45 万元年薪超过确认窗口后被标记 needs_review 并 quarantined，后续派生收入降为 0，没有继续把现金和净资产抬高。
4. **历史重放**：重放既有 5 路线共 120 节点，缺支出政策失败 0、晚年工资超期政策失败 0、首轮房贷捕获 1/1。

## 仍阻塞 M7 的事实

晚年路线的正文已经发生“退休/转顾问”，但模型返回的 Proposal 仍出现重复 id、schema 无效、支出 payload 缺金额、证据或 confidence 不合格。一次结构化修复重试后仍未形成 Accepted Event。系统采取了安全方向：停止陈旧工资计提；但因此出现正文仍描述顾问收入、账本收入为 0 的不一致。

这说明账本算术与拒绝后安全策略已经合格，但入口事实成功率尚未达到“唯一写入者切换”条件。M7 应保持 blocked，不能因为现金不再虚增就视为事实链路完成。

## 性能观察

- 无需修复的节点：财务入口处理约 1–2 ms。
- 触发一次模型修复的节点：本次样本增加约 2.06–3.07 秒。
- 该成本只发生在 blocking 节点；正常节点没有明显新增耗时。当前更主要的问题仍是修复成功率，而不是生成时延。

## 下一轮 M7 的最小复核条件

无需再跑 2/2/1。只需固定同一条 58 岁路线，重跑 2–3 次并同时满足：

- 退休或转顾问的 Career Transition 被接受；
- 旧工资结束/调整和新顾问收入形成 Accepted Event；
- 正文金额与派生快照一致；
- blocking Proposal 在一次修复后归零；
- 陈旧工资隔离仍保持有效。

## 证据文件

- m7-opening-mortgage: JSON `/Users/zz/Documents/new life/test---main/artifacts/financial-m7-focused-browser/2026-07-18T-m7-focused-1784369609683/cases/m7-opening-mortgage.json`；截图 `/Users/zz/Documents/new life/test---main/artifacts/financial-m7-focused-browser/2026-07-18T-m7-focused-1784369609683/images/m7-opening-mortgage/focused-final.jpg`
- m7-student-to-job: JSON `/Users/zz/Documents/new life/test---main/artifacts/financial-m7-focused-browser/2026-07-18T-m7-focused-1784369609683/cases/m7-student-to-job.json`；截图 `/Users/zz/Documents/new life/test---main/artifacts/financial-m7-focused-browser/2026-07-18T-m7-focused-1784369609683/images/m7-student-to-job/focused-final.jpg`
- m7-late-career-repair: JSON `/Users/zz/Documents/new life/test---main/artifacts/financial-m7-focused-browser/2026-07-18T-m7-focused-1784369609683/cases/m7-late-career-repair.json`；截图 `/Users/zz/Documents/new life/test---main/artifacts/financial-m7-focused-browser/2026-07-18T-m7-focused-1784369609683/images/m7-late-career-repair/focused-final.jpg`
