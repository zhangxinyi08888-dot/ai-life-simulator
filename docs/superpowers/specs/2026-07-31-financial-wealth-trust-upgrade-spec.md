# 财务节点接受门、支出生命周期与财富可信度升级 Spec

## 1. 文档状态

- 状态：开发中
- 规格日期：2026-07-31
- 目标分支：`codex/financial-wealth-trust-upgrade`
- 代码基线：`origin/main@4b2309a`
- 上游变更：债务生产线 PR #24 已合入 `main`
- 历史 checkpoint：`financial-upgrade@4200d50`

本分支不是新的财务计算器，也不重新实现债务、职业收入或最终报告权威逻辑。它补齐候选节点成为历史事实之前的接受协议，并解决成年支出长期冻结与财富属性方向漂移。

## 2. 合并后能力差异

### 2.1 `main@4b2309a` 已完成

- `FinancialLedger`、`CareerState`、`WorldState` 领域事务原子提交；
- 债务利息、计划偿付、逾期、重组、豁免、短缺债与债务健康派生；
- 职业转换与旧工资关闭、新工资启用的原子协调；
- 个人、公司、配偶、父母及第三方收入边界；
- 房产、房贷、企业持股、期权和重大个人收入的叙事覆盖检测；
- 候选 Proposal 校验、一次结构化修复、拒绝事实的正文局部回滚；
- 关闭账本驱动的正文、结局报告和海报财务接地；
- 成年基础生活费保底、学生家庭覆盖、晚年工资隔离；
- narrative fallback、债务异常、报告冲突和五路线发布审计；
- 一次纯领域事务试算，用于关闭账本正文清洗。

以上能力是本分支的依赖，不允许复制、降级或用旧 checkpoint 实现覆盖。

### 2.2 仍缺失

1. 现有试算不是节点接受门。重大事实在结构化事件缺失时，正文可以被降级后继续提交、推进年龄并结算本期收入支出。
2. `blockingIssueCount` 是提交后的观测指标，不是提交前的决定。
3. 成年支出政策只提供最低线；婚育、住房、赡养、照护、医疗和退休责任不会形成确定的生命周期复核协议。
4. 财富属性虽由财务快照计算，但综合评分和单步限幅仍可能让财富分与净资产变化方向相反。
5. 真实路线审计缺少接受门召回率、拒绝零变化、支出生命周期覆盖率和财富方向一致性发布指标。

## 3. 核心目标

### 3.1 节点接受协议

```text
候选正文 + 候选 Proposal
        ↓
Proposal Validator / Career-Income Atomicity
        ↓
无副作用 FinancialDomainPreview
        ↓
RequiredFinancialFactGroup + Preview Invariants
        ↓
FinancialNodeAcceptanceGate
        ├─ shadow: 记录 wouldBlock，允许提交
        └─ enforced: 阻断并重新生成
        ↓
唯一权威 commit
        ↓
History / Timeline / Period Accrual
```

重大事实不完整且处于 `enforced` 时：

- 不写入账本、CareerState、WorldState 或 History；
- 不推进年龄；
- 不结算候选期间收入、支出、利息和还款；
- 不复用试算结果作为权威对象；
- 使用统一的有界节点重新生成预算；
- 预算耗尽后返回可恢复错误，保留上一节点完整状态。

### 3.2 支出生命周期

支出不以“随机扣款”或“储蓄率封顶”修正。系统只根据已经发生的人生责任建立或复核类型化支出责任：

- `basic_living`：基础生活；
- `housing`：房租、物业和非本金住房成本；
- `dependent_support`：育儿、赡养和长期照护；
- `healthcare`：持续医疗责任；
- `insurance`：持续保障责任；
- `education`：持续教育责任。

规则：

- 新责任发生而没有对应支出事件时，生成结构化 review issue；
- 金额未知时创建独立 `needs_review` 责任账户，金额不冒充确定事实；
- `needs_review` 账户不使用 0 作为“已确认没有支出”；
- 已确认较高支出不得被更低系统估算覆盖；
- 同类型单例责任不得重复计提；
- 五年以上未确认且人生阶段已改变的系统估算必须重新复核；
- 只在正文明确责任已经发生时启动账户，计划、假设和他人责任不启动。

### 3.3 财富属性权威派生

财富属性仅由关闭账本派生，使用：

- 可靠净资产下界；
- 流动现金与基础支出覆盖月数；
- 年可支配收入；
- 收入稳定性；
- 债务规模和偿付压力；
- 已确认或可靠估值的资产；
- `needs_review` 正资产不计入确定财富上界。

额外方向规则：

- 净资产显著增加时，财富分不得下降；
- 净资产显著减少时，财富分不得上升；
- 净资产变化在金额容差内时，允许流动性、现金流和风险改变财富分；
- 方向规则只校准属性分，不修改账本金额。

## 4. 领域接口

### 4.1 Preview

新增 `previewFinancialDomainTransaction()`：

- 输入与权威事务相同；
- 对输入进行深拷贝后运行同一套领域 reducer；
- 返回候选 CareerState、Ledger、WorldState、PeriodSummary 和 DerivedFinancialState；
- 调用前后输入对象深度相等；
- Preview 不产生任何可被后续误判为已提交的外部状态。

### 4.2 RequiredFinancialFactGroup

事实组来自现有 Validator、coverage detector 和 career-income atomicity 的类型化问题，不新增一套宽泛主语正则。

首批 critical 事实组：

- `career_income_transition`
- `personal_compensation`
- `property_and_mortgage`
- `debt_repayment_or_restructure`
- `business_holding`
- `large_personal_cashflow`

review 事实组：

- `expense_lifecycle`
- `opening_fact_provenance`

### 4.3 Gate 决定

```ts
type FinancialNodeGateMode = "off" | "shadow" | "enforced";
type FinancialNodeDisposition = "accept" | "accept_with_review" | "regenerate";
```

决定至少记录：

- required / satisfied / unsatisfied critical 数量；
- `wouldBlock`、reason codes 和 issue IDs；
- Preview 的职业收入、年龄和账本不变量结果；
- gate 模式、重新生成次数和最终 disposition。

`shadow` 和 `enforced` 必须运行完全相同的判断；唯一差异是是否允许权威提交。

## 5. 迁移边界

历史 checkpoint `4200d50` 仅作为参考。以下内容不得直接 cherry-pick：

- 把“她/他”无条件当作主角的覆盖正则；
- 旧最终报告 sanitizer；
- 与债务线重叠的 fallback、报告、债务偿付和职业收入实现；
- 独立于现有 generation retry 的第二套无限或叠加重试；
- 只把支出改成 `needs_review`、却不建立类型化责任账户的实现。

可迁移的设计意图：

- `off / shadow / enforced` 策略；
- Required Fact Group 的结构化决定；
- gate telemetry；
- 人生责任触发支出复核；
- 发布审计新增指标。

## 6. 分阶段发布

### Phase A：Preview 与 shadow

- 明确抽取纯 Preview；
- 接入 Required Fact Group 和 gate；
- 默认 `shadow`；
- 统计 would-block 节点、原因、真实缺口和误报；
- 不改变用户可见行为。

### Phase B：enforced

- critical 事实组不完整时拒绝权威提交；
- 接入统一有界重新生成；
- 验证拒绝后零状态变化；
- 默认模式只有在真实路线召回率和误报验收通过后切换为 `enforced`。

### Phase C：支出生命周期和财富方向

- 接入类型化责任账户与审计；
- 接入账本财富方向校准；
- 扩展静态和真实路线发布门禁。

## 7. 验收要求

### 7.1 静态测试

必须证明：

1. Preview 不修改输入。
2. Preview 与相同输入的权威 commit 结果等价。
3. shadow 的判断和 enforced 完全一致，但 shadow 允许提交。
4. enforced 拒绝后 Ledger、CareerState、WorldState、History、年龄全部不变。
5. 拒绝节点不产生期间收入、支出、利息或本金偿付。
6. 重大事实完整时只提交一次，重试不重复入账。
7. 第三方工资、房产、债务和持股不触发主角事实组。
8. 责任计划不启动支出；已发生责任启动对应类型账户。
9. 较高既有支出不被更低估算覆盖。
10. 净资产方向变化超过容差时，财富属性方向一致。

### 7.2 全新 2/2/1 五路线

必须使用同一新 run 完成：

- 两条 accept-first；
- 两条 decline-first / accept-second；
- 一条 decline-all / natural-lifespan。

除既有债务生产门禁外，新增发布指标：

| 指标 | 发布要求 |
|---|---:|
| blocking gate rejection committed | 0 |
| rejected node timeline advance | 0 |
| rejected node period accrual | 0 |
| critical fact group coverage | 100% |
| shadow/enforced decision divergence | 0 |
| adult responsibility expense coverage | 100% |
| stale system expense without review | 0 |
| wealth/net-worth direction mismatch | 0 |
| user-visible generation pause | 0 |
| existing debt/report/invitation/image blockers | 0 |

shadow 召回率报告必须列出每个 would-block 节点、reason code、正文证据、Accepted Event 和人工分类，不能只给总数。

## 8. 完成定义

只有同时满足以下条件才可合并：

- 新 Spec、实现和测试均基于 `main@4b2309a` 或其后继提交；
- 旧 checkpoint 没有整分支混入；
- 所有静态测试、类型检查和生产构建通过；
- 全新五路线完成且新增与既有门禁全部通过；
- 验收证据明确记录 repository commit 和 dirty 状态；
- 未解决项目被分类为非阻断 backlog，不能用“审计未发现”代替证明。
