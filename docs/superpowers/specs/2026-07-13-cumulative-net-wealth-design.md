# 累计净财富账户简单 Spec

## 1. 背景

当前页面显示的 `0–100` 财富度来自 AI 自由评分。它没有固定计算公式，也没有校验正文中的收入、资产和负债是否支持该分数，因此可能出现“收入下降，但财富度没有明显变化且无法解释”的情况。

财富度同时被事件系统用于机会和风险判断，不能直接替换成金额。本次采用双轨设计：

```text
累计净财富：面向用户展示的真实金额，单位为万元。
财富资源度：面向内部规则使用的 0–100 综合抗风险指数。
```

## 2. 目标

1. 增加可累计、可解释的净财富账户。
2. 页面主要展示“累计财富”和本阶段增减金额。
3. 财富金额由代码计算，不再由 AI 直接给出最终结果。
4. 保留现有 `wealth: 0–100`，继续兼容事件系统。
5. 财富资源度根据净财富、现金流、流动性、负债和收入稳定性统一计算。
6. 所有金额使用“万元，按当前购买力计算”，避免跨越几十年后被通货膨胀扭曲。
7. 支持负净财富，用于表达房贷、创业负债和家庭债务。

## 3. 非目标

本次不做：

- 精确的税务、社保和个税计算器。
- 股票、基金、房价的真实行情模拟。
- 复杂的家庭成员独立账户。
- 银行级复式记账系统。
- 一次性重构幸福、才智、关系和健康的评分方式。

## 4. 核心定义

### 4.1 累计净财富

累计净财富是当前拥有的全部资产减去全部负债，不是累计收入。

```text
累计净财富 =
现金及存款
+ 投资资产
+ 房产市值
+ 企业及其他资产
- 房贷及其他负债
```

注意：房产使用“房产市值”时，房贷必须计入负债；不得同时使用“房产净值”再重复扣除房贷。

### 4.2 本阶段财富变化

每个模拟节点覆盖一段真实时间。本阶段变化统一按该节点完整时间段计算：

```text
本阶段净财富变化 =
税后收入
- 家庭生活支出
- 医疗教育等支出
- 利息及资金成本
+ 投资、房产和企业资产价值变化
+ 其他净变化

本期累计净财富 = 上期累计净财富 + 本阶段净财富变化
```

借款、还本金和购买资产属于资产负债结构变化，不能直接重复计入净财富增减：

- 新借款：现金增加、负债同步增加，净财富不立即变化。
- 偿还本金：现金减少、负债同步减少，净财富不立即变化。
- 支付利息：属于真实费用，减少净财富。
- 用现金购买房产或投资：只是资产类型转换，不立即改变净财富。

## 5. 数据结构

在 `SimulationNode` 和 `HistoryItem` 中增加财务快照与本阶段变化：

```ts
type IncomeStability = "unstable" | "volatile" | "stable" | "very_stable";
type EmploymentStatus = "student" | "part_time" | "employed" | "self_employed" | "not_working" | "medical_leave" | "retired";

interface FinancialSignals {
  employmentStatus: EmploymentStatus;
  monthlyNetIncomeWan: number;
  incomeMonths: number;
  monthlyLivingExpenseWan: number;
  oneOffIncomeWan: number;
  oneOffExpenseWan: number;
  assetValueChangeWan: number;
  personalDebtChangeWan: number;
  incomeStability: IncomeStability;
  confidence: number;
  reasons: string[];
}

interface FinancialState {
  currencyUnit: "CNY_WAN_REAL"; // 万元，按当前购买力
  asOfAgeInMonths: number;

  cashWan: number;
  investmentAssetsWan: number;
  propertyMarketValueWan: number;
  businessAndOtherAssetsWan: number;
  totalDebtWan: number;

  netWorthWan: number;              // 由代码计算
  annualAfterTaxIncomeWan: number;
  annualDisposableIncomeWan: number;
  annualCoreExpenseWan: number;
  employmentStatus?: EmploymentStatus;
  incomeStability: IncomeStability;
  isEstimated: boolean;
}

interface FinancialChange {
  periodMonths: number;
  afterTaxIncomeWan: number;
  livingExpenseWan: number;
  medicalEducationExpenseWan: number;
  interestAndFeesWan: number;
  assetValueChangeWan: number;
  otherNetChangeWan: number;

  netWorthChangeWan: number;        // 由代码计算
  incomeStability?: IncomeStability;
  reasons: string[];
}
```

`FinancialSignals` 是 AI 提取的事实信号；`FinancialChange`、`netWorthWan` 和 `netWorthChangeWan` 均由代码派生。AI 返回最终金额时必须忽略，避免模型自行修改计算结果。

## 6. 生成与计算流程

### 6.1 初始节点

AI 根据用户明确提供的收入、资产和负债，返回初始 `FinancialState` 的基础字段。

缺少信息时：

- 采用与职业、城市和人生阶段相符的保守估计。
- 使用 5 万或 10 万的整数档位，避免伪造过度精确的数据。
- 设置 `isEstimated: true`。
- 不得生成遗产、暴富或其他没有事实依据的大额资产。

代码随后计算：

```ts
netWorthWan =
  cashWan
  + investmentAssetsWan
  + propertyMarketValueWan
  + businessAndOtherAssetsWan
  - totalDebtWan;
```

### 6.2 后续节点

AI 在主节点中只返回本阶段 `FinancialSignals`。代码把月收入乘实际工作月份，扣除按月生活成本和一次性支出，再更新资产与个人债务。

缺少或损坏 `FinancialSignals` 时：

- 普通工资场景优先从正文明确的月薪、月入、工作状态和每月汇款中做本地快速提取。
- 正文没有新薪资时，沿用上一阶段收入和生活水平，不冻结累计财富。
- 房产、继承、股权、融资、破产等重大复杂事件才允许发起一次轻量 AI 补算。
- 补算仍失败时使用本地保守信号，不让财务附加字段拖垮主剧情。

代码负责：

1. 将 `FinancialSignals` 转为 `FinancialChange` 并计算 `netWorthChangeWan`。
2. 更新各项资产和负债余额。
3. 计算新的 `netWorthWan`。
4. 根据新财务状态计算 `wealth: 0–100`。
5. 校验金额、正文和变化原因是否互相支持。

## 7. 财富资源度计算

保留 `wealth`，但改为代码根据五项子分数计算：

```text
财富资源度 =
净财富水平分 × 30%
+ 可支配现金流分 × 25%
+ 收入稳定性分 × 20%
+ 流动性分 × 15%
+ 负债安全度分 × 10%
```

五项子分数都归一化为 `0–100`，映射阈值放在独立配置文件中，方便后续调整。最终结果四舍五入并限制在 `0–100`。

V1 规则：

- 净财富越高，净财富水平分越高；负净财富允许得到 `0–20` 分。
- 年度可支配收入越高，现金流分越高；持续为负时显著扣分。
- 收入稳定性分别映射为 `20 / 40 / 70 / 90`。
- 可动用资产能覆盖的核心生活月份越多，流动性分越高。
- 年度偿债压力占税后收入比例越低，负债安全度越高。

为避免单轮剧情造成异常跳变，普通节点的财富资源度变化默认限制在 `-12～+12`；破产、重大资产出售、巨额继承等有明确事实依据的重大事件可以突破限制。

## 8. AI 返回契约

后续节点新增：

```json
{
  "financialSignals": {
    "employmentStatus": "employed",
    "monthlyNetIncomeWan": 8,
    "incomeMonths": 12,
    "monthlyLivingExpenseWan": 3.5,
    "oneOffIncomeWan": 0,
    "oneOffExpenseWan": 22,
    "assetValueChangeWan": -6,
    "personalDebtChangeWan": 0,
    "incomeStability": "stable",
    "confidence": 0.9,
    "reasons": [
      "降薪后全年税后收入下降",
      "康复治疗和家庭支出增加",
      "房产及投资资产小幅回落"
    ]
  }
}
```

代码计算结果：

```text
本阶段净财富变化 = 8 × 12 - 3.5 × 12 - 22 - 6 = 26 万
```

如果正文明确写“收入下降”，但 AI 返回的收入高于上一阶段且没有新增收入来源，视为一致性错误并重新生成。

## 9. 页面展示

五维区域中的财富卡片改为：

```text
累计财富
428 万
本阶段 +8 万
```

展示规则：

- 小于 1 亿元：显示为 `428 万`。
- 大于等于 1 亿元：显示为 `1.2 亿`。
- 负数显示为 `-85 万`。
- 本阶段增加使用 `+8 万`，减少使用 `-12 万`。
- “财富资源度 74”作为详情或辅助信息，不再作为主金额展示。
- `isEstimated: true` 时显示“估算”标识。

## 10. 回溯与兼容

- `HistoryItem` 必须保存当时完整的 `financialState` 和 `financialChange`。
- 时光回溯时同时恢复五维属性和财务快照。
- 旧历史节点没有财务字段时，根据原 `wealth` 生成一次保守初始快照，并标记为估算。
- 事件系统继续读取 `attributes.wealth`，无需立即修改现有财富阈值。
- 最终报告同时使用累计净财富、财富资源度和关键财务变化，避免只复述一个抽象分数。

## 11. 校验规则

提交节点前必须校验：

1. 所有金额都是有限数字，允许净财富和单项变化为负。
2. `periodMonths` 必须等于代码确定的节点时间跨度。
3. `netWorthChangeWan` 必须由代码公式计算。
4. 新净财富必须等于旧净财富加本阶段变化。
5. 资产总额减负债必须等于净财富。
6. 房产净值和房贷不得重复扣减。
7. 正文中的收入、支出、资产和负债方向必须与结构化变化一致。
8. 新 `wealth` 必须等于统一评分函数的结果。
9. 普通节点财富资源度变化超过 `12` 时必须拒绝或要求重大事件依据。

## 12. 验收标准

- 页面能显示累计净财富、本阶段增减和估算状态。
- 同一份财务输入始终得到相同的累计净财富和财富资源度。
- 收入下降但仍有高净资产时，可以表现为“累计财富仍高、现金流和财富资源度下降”。
- 负债大于资产时能正确显示负净财富。
- 1 年与 3 年节点不会把年度收入错误地按同一金额累计。
- 时光回溯后，累计净财富和财富资源度恢复到历史节点值。
- 旧事件系统继续按 `wealth: 0–100` 正常筛选事件。

## 13. 建议实施顺序

1. 增加 `FinancialSignals`、`FinancialState`、`FinancialChange` 类型和纯计算函数。
2. 增加初始财务快照生成与归一化。
3. 修改后续节点 prompt，只让 AI 返回结构化财务事实信号。
4. 增加金额、时间跨度和正文方向一致性校验。
5. 将财务快照写入历史并支持回溯恢复。
6. 修改财富卡片和最终报告展示。
7. 补充计算、回溯、负财富和跨年累计测试。
