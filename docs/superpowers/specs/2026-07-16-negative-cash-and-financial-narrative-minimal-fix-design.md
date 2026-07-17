# 负现金与财务正文病句：最小完整上线版 Spec

## 1. 背景

当前存在两个会破坏人生模拟可信度的问题：

1. `cashWan` 可以长期向负数滚动。系统虽然保持了算术连续，却跳过了“现金耗尽后形成借贷、透支或欠款”的现实转换。
2. `sanitizeFinancialNarrative()` 在整段正文中替换“余额词语 + 精确金额”，会把完整陈述句塞进名词或介词位置，形成明显病句。

仅将负现金改为债务，只能消灭负数，仍可能变成无限债务；仅删除余额替换，又会重新暴露正文与账本的双重真值。因此上线版必须同时包含：

```text
现金缺口结构化留痕
→ 缺口等额转债务
→ 下一节点必须处理流动性

正文按分句处理
→ 交易事实保留
→ 当前余额陈述替换为完整分句
```

## 2. 目标

- 所有新生成的 `FinancialState.cashWan >= 0`。
- 现金缺口等额进入 `totalDebtWan`，不二次改变净财富。
- `FinancialChange` 结构化记录现金缺口，保证债务增加可审计。
- 发生现金缺口后，下一节点必须呈现现实处置，不允许角色继续无来源消费。
- 保留工资、费用、首付、贷款、融资和资产交易金额。
- 当前存款、余额、积蓄和净资产总额不再与系统账本并存。
- 清洗结果必须是完整、自然、幂等的中文。

## 3. 非目标

- 不禁止 `netWorthWan < 0`；负净资产是合法状态。
- 不建立授信额度、利率、征信、破产清算或社会福利计算模型。
- 不自动替用户出售资产、申请救助或宣布破产。
- 不新建财务 PressureArc，不修改现有 PressureArc 生命周期。
- 不修复复杂的同轮买房、卖房和贷款重组。
- 不改 UI、报告、终局和历史数据格式版本。
- 不回填已经保存的负现金和既有病句。

## 4. 涉及文件

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `FinancialChange` 增加可选的 `liquidityShortfallWan` |
| `src/utils/financialState.ts` | 现金下限、缺口转债、结构化留痕 |
| `src/services/simulation/prompts.ts` | 下一节点增加流动性处置约束 |
| `src/utils/financialNarrative.ts` | 改为分句级余额清洗 |
| `src/utils/financialState.test.ts` | 财务连续性和现金缺口测试 |
| `src/utils/financialNarrative.test.ts` | 病句、交易保护和幂等测试 |
| `src/services/simulation/prompts.test.ts` 或对应服务测试 | 流动性约束注入测试 |

不新增页面组件、服务接口或独立事件状态机。

## 5. 财务不变量

每个财务状态提交后必须满足：

```text
cashWan >= 0

netWorthWan = cashWan
             + investmentAssetsWan
             + propertyMarketValueWan
             + businessAndOtherAssetsWan
             - totalDebtWan
```

当原始计算得到 `rawCash < 0` 时：

```text
liquidityShortfallWan = abs(rawCash)
cashWan = 0
totalDebtWan += liquidityShortfallWan
```

现金转债只是资产负债重分类：

```text
转换前：cash=-20，debt=1，净影响=-21
转换后：cash=0，debt=21，净影响=-21
```

因此不得再次减少 `netWorthWan` 或 `financialChange.netWorthChangeWan`。

## 6. 改动一：结构化现金缺口

### 6.1 类型

在 `FinancialChange` 增加可选字段：

```ts
export interface FinancialChange {
  // 现有字段保持不变
  liquidityShortfallWan?: number;
}
```

含义：本阶段常规收入、支出和模型声明的债务变化处理完后，仍无法覆盖的现金缺口。单位万元。

旧历史缺失该字段时按 `0` 处理，不需要数据迁移。

### 6.2 底层现金下限函数

在 `financialState.ts` 增加内部纯函数：

```ts
function floorCashToDebt(state: FinancialState): {
  financialState: FinancialState;
  liquidityShortfallWan: number;
} {
  if (state.cashWan >= 0) {
    const financialState = {
      ...state,
      netWorthWan: calculateNetWorth(state)
    };
    return { financialState, liquidityShortfallWan: 0 };
  }

  const liquidityShortfallWan = roundMoney(-state.cashWan);
  const financialState: FinancialState = {
    ...state,
    cashWan: 0,
    totalDebtWan: roundMoney(
      state.totalDebtWan + liquidityShortfallWan
    )
  };
  financialState.netWorthWan = calculateNetWorth(financialState);

  return { financialState, liquidityShortfallWan };
}
```

### 6.3 接入 `applyFinancialChange()`

保持现有 `rawCash` 计算。构造尚未计算最终净财富的 `next` 后调用：

```ts
const reconciled = floorCashToDebt(next);

return {
  financialState: reconciled.financialState,
  financialChange: reconciled.liquidityShortfallWan > 0
    ? {
        ...financialChange,
        liquidityShortfallWan: reconciled.liquidityShortfallWan,
        reasons: [
          ...financialChange.reasons,
          `现金缺口 ${reconciled.liquidityShortfallWan} 万元转为短期负债`
        ]
      }
    : financialChange
};
```

### 6.4 接入 `applyFinancialSignals()`

先按现有逻辑计算：

```text
现金 = 上期现金 + 收入 - 生活支出 - 一次性支出
债务 = 上期债务 + personalDebtChangeWan
```

再调用 `floorCashToDebt(next)`。返回的 `financialSignals` 保留模型原始事实；代码增加的流动性债务通过以下位置留痕：

- `FinancialState.totalDebtWan`
- `FinancialChange.liquidityShortfallWan`
- `FinancialChange.reasons`

不得把缺口再次加到 `financialChange.otherNetChangeWan`，否则会重复减少净财富。

### 6.5 初始财务状态

`normalizeInitialFinancialState()` 完成初始状态构造后，也调用 `floorCashToDebt()`，只使用返回的 `financialState`。

初始状态没有对应 `FinancialChange`，因此不记录 `liquidityShortfallWan`；但不能产生负现金起点。

## 7. 改动二：流动性处置约束

### 7.1 触发条件

不新增财务事件或 PressureArc。下一节点 Prompt 直接检查最后一个历史节点：

```ts
const liquidityShortfallWan =
  lastNode?.financialChange?.liquidityShortfallWan ?? 0;
```

当 `liquidityShortfallWan > 0` 时，下一节点必须处理流动性问题。

这条约束优先级高于普通财务副线，但不能覆盖当前 PressureArc；若当前存在健康、关系等前台 Arc，正文需要同时体现“原压力仍在推进”和“现金已经耗尽后的现实处置”。

### 7.2 Prompt 内容

在 `buildNextNodePrompt()` 中加入：

```text
【必须处理的流动性约束】
上一阶段出现现金缺口 {liquidityShortfallWan} 万元，代码已将缺口转为短期负债。

- 本节点正文必须明确说明角色通过借款、透支、资产处置、家庭支持、降低生活成本或新增收入中的哪种方式继续维持。
- 不得继续描写无资金来源的正常消费。
- A/B/C 必须提供至少两类实质不同的处置方向：
  1. 出售或缩减资产与支出；
  2. 借款、债务重组、家庭或社会支持；
  3. 增加可持续收入或改变住房、工作、生活方式。
- 三个选项不能全部依赖新增借款。
- financialSignals 必须反映正文中的收入、支出、资产和债务变化。
```

“至少两类”而不是强制三个固定选项，避免与当前主线或前台 Arc 冲突。

### 7.3 连续缺口

如果处置节点仍生成新的 `liquidityShortfallWan > 0`，下一节点继续注入相同约束。

系统不硬性禁止用户继续借款，但每一次新增缺口都必须：

- 进入债务；
- 留下结构化证据；
- 在下一节点呈现现实处置和代价。

这解决的是“无限无解释债务”，不是建立授信额度模型。

## 8. 改动三：分句级财务正文清洗

### 8.1 原则

禁止继续在完整正文上执行宽范围 `BALANCE_TOTAL.replace()`。

处理顺序：

```text
按中文标点拆分分句并保留标点
→ 余额增减区间优先处理
→ 含真实交易动作的分句保留
→ 仅有当前余额总额的分句整体替换
→ 拼回原文
```

### 8.2 正则

保留现有 `MONEY_AMOUNT`、`BALANCE_TERM` 和 `TRANSACTION_CONTEXT`，但余额总额匹配只在单个分句内执行：

```ts
const BALANCE_TOTAL_IN_CLAUSE = new RegExp(
  `(?:${BALANCE_TERM}[^，。！？；]{0,48}?${MONEY_AMOUNT}`
    + `|${MONEY_AMOUNT}[^，。！？；]{0,16}?${BALANCE_TERM})`
);

const BALANCE_DECLINE = /降至|降到|减少至|减少到|消耗至|消耗到|见底/;
const BALANCE_INCREASE = /增至|增加到|上升至|达到/;
```

不得使用 lookbehind，也不得根据匹配后的单个字符猜测语法位置。

两个方向都必须匹配：

```text
存款约90万       # 余额词在前
带着70万存款     # 金额在前
```

### 8.3 完整状态分句

新增：

```ts
function getFinancialStatusClause(state: FinancialState): string {
  const monthlyExpense = state.annualCoreExpenseWan / 12;
  const coverageMonths = monthlyExpense > 0
    ? state.cashWan / monthlyExpense
    : Number.POSITIVE_INFINITY;

  if (state.netWorthWan < 0) return "整体仍处于负债状态";
  if (coverageMonths < 3) return "当前现金流十分紧张";
  if (coverageMonths < 12) return "目前仍保有一定现金缓冲";
  return "当前现金储备相对充足";
}
```

返回值必须能够独立作为完整分句，不能使用“一些积蓄”“紧张的现金流”等名词短语。

### 8.4 分句清洗

实现等价于：

```ts
function sanitizeFinancialClause(
  clause: string,
  state: FinancialState
): string {
  if (!clause) return clause;

  if (BALANCE_RANGE.test(clause)) {
    if (TRANSACTION_CONTEXT.test(clause)) return clause;
    return clause.replace(BALANCE_RANGE, (match) => {
      if (BALANCE_DECLINE.test(match)) return "现金缓冲有所减少";
      if (BALANCE_INCREASE.test(match)) return "现金缓冲有所增加";
      return "现金状况有所变化";
    });
  }

  if (!BALANCE_TOTAL_IN_CLAUSE.test(clause)) return clause;
  if (TRANSACTION_CONTEXT.test(clause)) return clause;

  return getFinancialStatusClause(state);
}
```

实现时避免对带 `g` 的正则直接反复 `.test()`；可使用无 `g` 检测正则，或在每次检测前重置 `lastIndex`。

### 8.5 保留标点地拆分和拼接

```ts
export function sanitizeFinancialNarrative(
  description: string,
  state: FinancialState
): string {
  if (!description) return description;

  return description.replace(
    /([^，。！？；]+)([，。！？；]?)/g,
    (_full, clause: string, punctuation: string) =>
      `${sanitizeFinancialClause(clause, state)}${punctuation}`
  );
}
```

### 8.6 交易事实保护

以下金额必须保持原文：

- 工资、年薪、项目收入、融资和赔偿金；
- 房租、生活费、医疗费和学费；
- 首付、贷款、还款和利息；
- 买房、卖房、投资和资产处置；
- 明确的资金缺口。

例如：

```text
月薪2万，房租5000元，本月支付医疗费3万。
→ 原文保留

用存款支付60万首付，办理120万贷款。
→ 原文保留
```

### 8.7 示例

```text
你辞去了高级经理职位，带着70万存款，但每天工作8小时。
→ 你辞去了高级经理职位，目前仍保有一定现金缓冲，但每天工作8小时。

你看着银行余额里仅剩800元，心里发紧。
→ 当前现金流十分紧张，心里发紧。

你的存款从45万降至42万，现金流开始紧张。
→ 你的现金缓冲有所减少，现金流开始紧张。

存款从20万增至40万。
→ 现金缓冲有所增加。
```

## 9. 测试要求

### 9.1 财务状态测试

至少覆盖：

1. `applyFinancialChange()` 的负现金归零并等额增加债务。
2. `applyFinancialSignals()` 在模型债务变化基础上增加缺口债务。
3. 初始财务状态不能产生负现金。
4. `liquidityShortfallWan` 等于原始现金缺口。
5. `reasons` 只追加一次“现金缺口转为短期负债”。
6. 现金转债前后净财富不发生二次变化。
7. `financialChange.netWorthChangeWan` 等于最终状态净财富减上一状态净财富。
8. 无缺口节点的现有结果完全不变。

### 9.2 Prompt 测试

至少覆盖：

1. 上一节点无 `liquidityShortfallWan` 时不出现流动性约束。
2. 上一节点存在缺口时注入约束和具体金额。
3. 约束要求至少两类处置方向，且禁止三个选项全部新增借款。
4. 存在前台 PressureArc 时仍保留流动性约束。

### 9.3 正文清洗测试

至少覆盖：

- 当前余额总额出现在句首、介词短语和嵌套从句中；
- 余额上升、下降和带“你的”的表达；
- 工资、费用、首付、贷款和融资金额完整保留；
- “带着70万存款”“银行余额仅剩800元”等真实病句回归样本；
- 连续两个财务分句不会产生重复或残缺语法；
- 多次执行清洗结果不变。

幂等要求：

```ts
sanitizeFinancialNarrative(
  sanitizeFinancialNarrative(text, state),
  state
) === sanitizeFinancialNarrative(text, state)
```

## 10. 验收标准

- 新生成和新初始化的财务状态均无负现金。
- 现金缺口、债务增量、最终净财富和阶段净财富变化能够互相核对。
- 发生现金缺口后，下一节点必须呈现资金来源或现实处置。
- 连续缺口不能在正文中无解释地继续正常生活。
- 非交易性的当前余额精确总额不会与系统账本同时作为两套真值出现。
- 不再出现“带着70万持续支出正在消耗现金缓冲”“你的已经积累了一些储蓄）降至”等清洗病句。
- 交易金额和费用金额保持原文。
- TypeScript、相关单元测试和生产构建通过。

## 11. 验证命令

```bash
pnpm exec tsx --test \
  src/utils/financialState.test.ts \
  src/utils/financialNarrative.test.ts \
  src/services/simulation/prompts.test.ts

pnpm exec tsc --noEmit
pnpm build
```

如果仓库没有 `prompts.test.ts`，将 Prompt 断言放入现有 simulation service 测试文件，不为一个断言体系新增重复测试框架。

## 12. 已知边界

- 系统允许用户在明确承担代价时继续借款，因此不设置债务硬上限。
- 本次阻止的是“无解释的无限债务”，不是所有长期负债。
- 代码层流动性债务不会改写模型原始 `financialSignals.personalDebtChangeWan`，而是通过 `FinancialChange.liquidityShortfallWan` 和最终状态留痕。
- 复杂房产原子交易仍需单独修复。
- 历史数据不会自动重写。

上述边界不影响本次上线目标。
