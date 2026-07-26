import { FinancialState, type SimulationNode } from "../types";
import type { AcceptedFinancialEvent, FinancialLedger } from "../domain/finance/types";
import type { DebtHealthState } from "../domain/finance/debtHealth";
import { isNarrativeEligibleFinancialFact } from "../domain/finance/financialFactEligibility";
import { narrativeClaimsExplicitPersonalIncome } from "../domain/finance/reconcileCareerIncomeAtomicity";

const MONEY_AMOUNT = String.raw`(?:-?\d+(?:\.\d+)?\s*(?:万元?|万|元)(?:多|左右|上下)?|[零〇一二两三四五六七八九十百千]+万(?:元)?(?:多|左右|上下)?)`;
const BALANCE_TERM = String.raw`(?:现金及存款|现金余额|银行余额|账户余额|个人账户|家庭备用金|备用金|存款|积蓄|净资产|净财富|身家|累计财富|现金(?!流))`;
const BALANCE_RANGE = new RegExp(
  `${BALANCE_TERM}[^，。！？；]{0,36}?(?:从|由)\s*${MONEY_AMOUNT}[^，。！？；]{0,16}?(?:(?:降至|降到|增至|增加到|变为|达到)了?)\s*${MONEY_AMOUNT}`,
  "g"
);
const BALANCE_TOTAL = new RegExp(
  `${BALANCE_TERM}[^。！？；]{0,64}?${MONEY_AMOUNT}`,
  "g"
);
const TRANSACTION_CONTEXT = /支付|付了|拿出|取出|投入|用于|花费|支援|借出|偿还|入账|收到|获得|首付|贷款|房贷|医疗费|学费|房租|项目收入|稿费|月薪|工资|还差|缺口/;
const DECLINING_BALANCE = /从|由|降至|降到|减少|消耗|见底/;

export function getFinancialStatusText(state: FinancialState): string {
  const monthlyExpense = state.annualCoreExpenseWan / 12;
  const coverageMonths = monthlyExpense > 0 ? state.cashWan / monthlyExpense : Number.POSITIVE_INFINITY;
  if (state.netWorthWan < 0) return "整体仍处于负债状态";
  if (coverageMonths < 3) return "现金流十分紧张";
  if (coverageMonths < 12) return "仍有一定现金缓冲";
  return "已经积累了一些储蓄";
}

function replaceBalanceTotal(match: string, state: FinancialState): string {
  if (TRANSACTION_CONTEXT.test(match)) return match;
  if (DECLINING_BALANCE.test(match)) return "持续支出正在消耗现金缓冲";
  return getFinancialStatusText(state);
}

function formatWan(value: number): string {
  return (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toString();
}

function sanitizeLongWanPrecision(text: string): string {
  return text.replace(/(-?\d+\.\d{3,})\s*万(?:元)?/gu, (_match, raw: string) => {
    const valueWan = Number(raw);
    if (!Number.isFinite(valueWan)) return _match;
    if (Math.abs(valueWan) < 1) return `${Math.round(valueWan * 10_000)}元`;
    return `${formatWan(valueWan)}万元`;
  });
}

function sanitizeRecurringIncomeClaims(description: string, ledger?: FinancialLedger): string {
  if (!ledger) return description;
  const careerIncome = ledger.incomeSources.filter((source) => (
    source.status === "active"
    && Boolean(source.linkedCareerStateId)
    && source.accrualPolicy !== "event_only"
    && source.accrualReviewStatus !== "quarantined"
    && isNarrativeEligibleFinancialFact(source)
  ));
  if (careerIncome.length === 0) return description.split(/(?<=[。！？])/u).map((sentence) => (
    /(?:你|主角|本人|你的).{0,28}(?:月薪|年薪|工资|薪资)|(?:当前|税后)?(?:月薪|年薪)(?:约|为|达到|降至|降到|升至)?\s*\d/u.test(sentence)
      ? "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。"
      : sentence
  )).join("");
  if (careerIncome.length !== 1) return description;
  const source = careerIncome[0];
  const monthlyWan = source.accrualPolicy === "annual"
    ? (source.annualNetAmountWan || 0) / 12
    : source.monthlyNetAmountWan || 0;
  const annualWan = source.accrualPolicy === "annual"
    ? source.annualNetAmountWan || 0
    : monthlyWan * 12;
  if (monthlyWan <= 0 || annualWan <= 0) return description;
  return description
    .replace(/(?:税后)?月薪(?:从|由)\s*\d+(?:\.\d+)?\s*万(?:元)?[^，。；！？]{0,16}?(?:降至|降到|增至|增加到|变为|达到)\s*\d+(?:\.\d+)?\s*万(?:元)?/gu, `当前税后月薪约${formatWan(monthlyWan)}万元`)
    .replace(/((?:税后)?月薪(?:约|为|达到|降至|降到)?\s*)(\d+(?:\.\d+)?)\s*万(?:元)?/gu, (match, prefix: string, raw: string) => (
      Math.abs(Number(raw) - monthlyWan) <= Math.max(0.01, monthlyWan * 0.01)
        ? match
        : `${prefix}${formatWan(monthlyWan)}万元`
    ))
    .replace(/((?:税后)?年薪(?:约|为|达到|降至|降到)?\s*)(\d+(?:\.\d+)?)\s*万(?:元)?/gu, (match, prefix: string, raw: string) => (
      Math.abs(Number(raw) - annualWan) <= Math.max(0.01, annualWan * 0.01)
        ? match
        : `${prefix}${formatWan(annualWan)}万元`
    ));
}

function sanitizeUnsupportedIncomeComposition(description: string, ledger?: FinancialLedger): string {
  if (!ledger) return description;
  const hasDividendIncome = ledger.incomeSources.some((source) => (
    source.status === "active" && source.type === "business_dividend"
  ));
  if (hasDividendIncome) return description;
  return description.replace(/[（(](?:已确认的)?(?:工资|薪资)[+＋、和与](?:年底|年终)?分红[）)]/gu, "（已确认的个人工资）");
}

function sanitizeUnconfirmedPersonalDrawClaims(
  description: string,
  ledger?: FinancialLedger,
  acceptedEvents?: AcceptedFinancialEvent[]
): string {
  if (!ledger) return description;
  const hasActivePersonalIncome = ledger.incomeSources.some((source) => (
    source.status === "active"
    && source.accrualReviewStatus !== "quarantined"
    && isNarrativeEligibleFinancialFact(source)
    && ["salary", "contract", "self_employment_draw", "business_dividend"].includes(source.type)
  ));
  const withoutAssumedFamily = description
    .replace(/(?:和|以及)?(?:妻子|丈夫|配偶)[（(]假设有[）)](?:的)?(?:工资|收入)?/gu, "")
    .replace(/(?:妻子|丈夫|配偶)[（(]假设有[）)]/gu, "家人");
  const acceptedPersonalIncome = acceptedEvents?.some((event) => (
    event.kind === "business_distribution_received"
    || (event.kind === "income_source_started" && ["salary", "contract", "self_employment_draw", "business_dividend"].includes(event.payload.type))
    || (event.kind === "income_source_adjusted" && ["salary", "contract", "self_employment_draw", "business_dividend"].includes(event.payload.nextSource.type))
  ));
  if (hasActivePersonalIncome || acceptedPersonalIncome) return withoutAssumedFamily;
  return withoutAssumedFamily.split(/(?<=[。！？])/u).map((sentence) => {
    if (/(?:你|主角|本人).{0,16}(?:给自己开|给自己发|领取|拿到|获得|收到).{0,20}(?:月薪|工资|薪资)|(?:你|主角|本人).{0,16}(?:月薪|工资|薪资).{0,12}(?:达到|为|有)\s*\d/u.test(sentence)) {
      return "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。";
    }
    if (/(?:你|主角|本人)每月(?:税后)?\s*\d+(?:\.\d+)?\s*万/u.test(sentence)) {
      return "创业初期，个人可支配收入仍未形成稳定来源。";
    }
    if (/(?:你|主角|本人|个人).{0,20}(?:从公司支取|从公司领取|领取公司|提取公司).{0,16}(?:生活费|工资|薪资|收入|提款|分红)/u.test(sentence)) {
      return "创业初期，个人可支配收入仍未形成稳定来源。";
    }
    if (acceptedEvents && /(?:个人净收入|个人可支配收入|个人进账)(?:仅|约为|约|达到|为)?\s*\d+(?:\.\d+)?\s*万元?/u.test(sentence)) {
      return "公司经营已有进展，但个人可支配收入仍未形成稳定来源。";
    }
    if (narrativeClaimsExplicitPersonalIncome(sentence)) {
      return "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。";
    }
    return sentence;
  }).join("");
}

function sanitizePersonalDebtClaims(description: string, state: FinancialState): string {
  return description
    .replace(/(?:你|主角|本人)(?:仍|还|目前|当前)?(?:有|背负着?)\s*-?\d+(?:\.\d+)?\s*万(?:元)?(?:的)?(?:个人)?(?:债务|负债)/gu, `个人总负债为${formatWan(state.totalDebtWan)}万元`)
    .replace(/(?:你(?:的)?|个人|家庭)(?:累计|当前|总计)?(?:总)?(?:债务|负债)(?:约|为|仍是|还是|还剩|余额为|达到|升至|增加到)?\s*-?\d+(?:\.\d+)?\s*万(?:元)?/gu, `个人总负债为${formatWan(state.totalDebtWan)}万元`)
    .replace(/(?:债务|负债)(?:约|为|仍是|还是|还剩|余额为|达到|升至|增加到)\s*-?\d+(?:\.\d+)?\s*万(?:元)?/gu, `个人总负债为${formatWan(state.totalDebtWan)}万元`)
    .replace(/(?:你|主角|本人).{0,12}(?:欠下|背上|负担)(?:了)?\s*-?\d+(?:\.\d+)?\s*万(?:元)?(?:的)?(?:个人)?(?:债务|负债)/gu, `个人总负债为${formatWan(state.totalDebtWan)}万元`)
    .replace(/(?:个人总){2,}负债/gu, "个人总负债");
}

function sanitizeDebtServicingClaims(description: string, ledger?: FinancialLedger): string {
  if (!ledger) return description;
  const activeDebts = ledger.debtAccounts.filter((account) => account.status === "active" || account.status === "defaulted");
  const unpaidInterestWan = activeDebts.reduce((sum, account) => sum + (account.accruedUnpaidInterestWan || 0), 0);
  const scheduledMonthlyPaymentWan = activeDebts.reduce((sum, account) => (
    sum + (account.repaymentPolicy.mode === "event_driven" ? 0 : (account.repaymentPolicy.monthlyPaymentWan || 0))
  ), 0);
  let grounded = activeDebts.length > 0
    ? description
      .replace(new RegExp(`(?:个人|家庭)?(?:总负债|债务总额|负债总额)[^，。！？；]{0,24}?${MONEY_AMOUNT}`, "gu"), `个人总负债为${formatWan(activeDebts.reduce((sum, account) => sum + account.principalWan + (account.accruedUnpaidInterestWan || 0), 0))}万元`)
      .replace(new RegExp(`(?:累计)?(?:未付|拖欠|欠付)(?:的)?利息[^，。！？；]{0,16}?${MONEY_AMOUNT}`, "gu"), `累计未付利息为${formatWan(unpaidInterestWan)}万元`)
    : description;
  if (scheduledMonthlyPaymentWan > 0) {
    grounded = grounded.replace(new RegExp(`(?:每月(?:最低)?还款|最低还款额|按最低额)[^，。！？；]{0,12}?${MONEY_AMOUNT}(?:还款)?`, "gu"), `当前每月计划还款为${formatWan(scheduledMonthlyPaymentWan)}万元`);
  }
  const scheduledMonthlyInterestWan = activeDebts.reduce((sum, account) => (
    sum + (account.repaymentPolicy.mode === "event_driven" ? 0 : (account.repaymentPolicy.monthlyInterestWan || 0))
  ), 0);
  if (scheduledMonthlyInterestWan > 0) {
    grounded = grounded.replace(new RegExp(`每月(?:计划)?利息(?:约|近|为|达到)?\\s*${MONEY_AMOUNT}`, "gu"), `当前每月计划利息为${formatWan(scheduledMonthlyInterestWan)}万元`);
  }
  const consecutiveMissedMonths = ledger.debtAccounts
    .filter((account) => account.status === "active" || account.status === "defaulted")
    .reduce((maximum, account) => Math.max(maximum, account.consecutiveMissedPaymentMonths ?? 0), 0);
  if (consecutiveMissedMonths <= 0) return grounded;
  return grounded.replace(
    /连续(?:\d+|[零一二两三四五六七八九十百]+)个?月(未还|逾期|拖欠|未足额偿还|未足额支付|未足额偿付|未能足额偿还|未能足额支付|未能足额偿付)/gu,
    `连续${consecutiveMissedMonths}个月$1`
  ).replace(
    /连续(拖欠|未还|逾期)((?:贷款|借款)?)(?:\d+|[零一二两三四五六七八九十百]+)个?月/gu,
    `连续$1$2${consecutiveMissedMonths}个月`
  ).replace(
    /(?:已有|出现|有)(?:\d+|[零一二两三四五六七八九十百]+)(?:期|个月)逾期记录/gu,
    `已有${consecutiveMissedMonths}期逾期记录`
  );
}

export function sanitizeFinancialNarrative(
  description: string,
  state: FinancialState,
  ledger?: FinancialLedger,
  acceptedEvents?: AcceptedFinancialEvent[]
): string {
  if (!description) return description;
  const prepared = description.replace(
    new RegExp(`靠着\\s*${MONEY_AMOUNT}\\s*(?:的)?(?:家庭)?备用金(?:和|、)房贷压力`, "gu"),
    "在有限现金缓冲和房贷压力下"
  ).replace(new RegExp(`(?:你们)?用各自\\s*${MONEY_AMOUNT}\\s*(?:的)?(?:积蓄|存款|备用金)(?:作为)?(?:启动资金)?`, "gu"), "你们各自投入了一笔启动资金")
    .replace(/持续支出正在消耗现金缓冲的(?:个人)?(?:税后)?(?:工资|薪资|收入)/gu, "已经到账的个人税后收入")
    .replace(new RegExp(`(?:你|主角|本人)(?:不得已|只好)?动用了?\s*${MONEY_AMOUNT}\s*(?:的)?(?:存款|积蓄|备用金)[^。！？]{0,12}(?:还贷|偿还房贷)`, "gu"), "你继续动用现金缓冲偿还房贷");
  const grounded = sanitizeDebtServicingClaims(
    sanitizePersonalDebtClaims(sanitizeUnsupportedIncomeComposition(sanitizeUnconfirmedPersonalDrawClaims(sanitizeRecurringIncomeClaims(prepared, ledger), ledger, acceptedEvents), ledger), state),
    ledger
  );
  return sanitizeLongWanPrecision(grounded
    .replace(/你个人的持续支出正在消耗(?:现金缓冲)?整体仍处于负债状态/gu, "持续支出仍在消耗个人现金缓冲")
    .replace(/(?:依靠|靠着)整体仍处于负债状态(?:的)?备用金/gu, "依靠有限的现金缓冲")
    .split(/(?<=[。！？])/u).map((sentence) => {
    const companyOnlyBalanceContext = /(?:公司|企业|项目|团队)(?:账户|账上|现金流|资金|营收|收入|支出|成本|预算)/u.test(sentence)
      && !/(?:你|主角|本人)(?:的)?个人|个人账户|个人现金|家庭备用金/u.test(sentence);
    if (companyOnlyBalanceContext) return sentence;
    if (/(?:备用金|存款|个人现金|自己的钱).{0,32}(?:作为启动资金|投入|出资|支付|垫付|支取|拿出|取出|用于公司运营|股东借款)/u.test(sentence)) return sentence;
    if (new RegExp(`${BALANCE_TERM}[^。！？]{0,48}?${MONEY_AMOUNT}[^。！？]{0,32}?(?:消耗|缩水|减少|下降)`, "u").test(sentence)) {
      return "持续支出正在消耗现金缓冲。";
    }
    return sentence
      .replace(BALANCE_RANGE, (match) => replaceBalanceTotal(match, state))
      .replace(BALANCE_TOTAL, (match) => replaceBalanceTotal(match, state));
    }).join(""));
}

export function sanitizeUnsupportedOpeningAccountClaims(description: string, ledger: FinancialLedger): string {
  const hasProperty = ledger.assetAccounts.some((account) => account.status === "active"
    && account.type === "property" && isNarrativeEligibleFinancialFact(account));
  const hasDebt = ledger.debtAccounts.some((account) => isNarrativeEligibleFinancialFact(account));
  return description.split(/(?<=[。！？])/u).map((sentence) => {
    if (!hasProperty && /(?:名下|自有|自己的).{0,12}(?:房|住房|公寓)|(?:买了|购入|刚买|卖掉|出售).{0,12}(?:房|住房|公寓)|房产升值/u.test(sentence)) {
      return "你开始重新评估居住安排与眼前的生活成本。";
    }
    if (!hasDebt && /(?:背着|背上|欠下|偿还|月供|房贷|贷款|负债|债务)/u.test(sentence)) {
      return "你开始更谨慎地安排现金流与接下来的生活选择。";
    }
    return sentence;
  }).join("");
}

export function sanitizeOpeningFinancialTitle(title: string, ledger: FinancialLedger): string {
  const hasMortgage = ledger.debtAccounts.some((account) => (
    account.type === "mortgage" && isNarrativeEligibleFinancialFact(account)
  ));
  const hasDebt = ledger.debtAccounts.some((account) => isNarrativeEligibleFinancialFact(account));
  if (hasMortgage && /(?:房贷|按揭).{0,12}(?:还没|尚未|没有|未背|没背)|(?:还没|尚未|没有).{0,12}(?:房贷|按揭)/u.test(title)) {
    return "房贷压力下的现实选择";
  }
  if (!hasDebt && /负债|债务|房贷|按揭/u.test(title)) return "现金流与人生选择";
  return title;
}

export function sanitizeSimulationNodeFinancialNarrative(
  node: SimulationNode,
  state: FinancialState,
  ledger?: FinancialLedger
): SimulationNode {
  const sanitize = (text: string) => sanitizeFinancialNarrative(text, state, ledger);
  const paragraphs = (node.descriptionParagraphs?.length
    ? node.descriptionParagraphs
    : node.description.split(/\n\s*\n+/u)
  ).map(sanitize);
  return {
    ...node,
    description: paragraphs.join("\n\n"),
    descriptionParagraphs: paragraphs,
    choices: node.choices.map((choice) => ({
      ...choice,
      text: sanitize(choice.text),
      impactSummary: sanitize(choice.impactSummary),
      decisionIntent: choice.decisionIntent ? sanitize(choice.decisionIntent) : choice.decisionIntent
    })),
    narrativeMeta: node.narrativeMeta ? {
      ...node.narrativeMeta,
      storyEpisode: {
        ...node.narrativeMeta.storyEpisode,
        summary: sanitize(node.narrativeMeta.storyEpisode.summary),
        internalTransitions: node.narrativeMeta.storyEpisode.internalTransitions.map((transition) => ({
          ...transition,
          summary: sanitize(transition.summary)
        }))
      },
      arcSignals: node.narrativeMeta.arcSignals.map((signal) => ({ ...signal, evidence: sanitize(signal.evidence) }))
    } : node.narrativeMeta
  };
}

export function validateDebtNarrativeConsistency(input: {
  description: string;
  debtHealthState?: DebtHealthState;
  ledger?: FinancialLedger;
  allowExactServicingCount?: boolean;
}): string[] {
  if (input.debtHealthState?.source !== "authoritative_ledger" || !input.ledger) return [];
  const issues: string[] = [];
  const hasFormalDefault = input.ledger.debtAccounts.some((account) => account.status === "defaulted");
  if ((input.debtHealthState.consecutiveMissedPaymentMonths ?? 0) > 0 && /第一次.{0,12}逾期|首次.{0,12}逾期|第一次.{0,12}拖欠|首次.{0,12}拖欠/u.test(input.description)) {
    issues.push("已有连续拖欠事实，不能把本轮写成第一次或首次逾期");
  }
  if (!input.allowExactServicingCount && /连续(?:\d+|[零一二两三四五六七八九十百]+)个?月(?:未还|逾期|拖欠|未足额偿还|未足额支付|未足额偿付|未能足额偿还|未能足额支付|未能足额偿付)/u.test(input.description)) {
    issues.push("模型不能在 closing ledger 提交前自行断言连续拖欠的精确月数");
  }
  if (!hasFormalDefault) {
    if (/罚息|复利/u.test(input.description)) issues.push("账本没有罚息或复利事实，不能自行添加惩罚性费用");
    if (/上报征信|报送征信|征信受损|征信记录(?:已经|已)?(?:产生|留下|出现)|影响未来信贷|未来信贷.{0,8}(?:受影响|受限)|信用评分(?:下降|降低)/u.test(input.description)) {
      issues.push("没有正式违约事实，不能写征信后果已经发生");
    }
    if (/(?:征信|信用记录)[^。！？]{0,24}(?:被拒|拒绝|失去|无法)|因[^。！？]{0,16}(?:征信|信用记录)[^。！？]{0,16}(?:被拒|拒绝)/u.test(input.description)) {
      issues.push("没有正式违约事实，不能把工作或生活机会被拒归因于征信");
    }
    if (/移交催收|催收部门|催收电话|上门催收|正式催收|移交法务|法务部门|(?:每天|每日)[^。！？]{0,12}催收|催收[^。！？]{0,12}(?:每天|每日)|诉讼|查封|拍卖|强制处置/u.test(input.description)) {
      issues.push("没有正式违约事实，不能写催收升级或强制处置已经发生");
    }
  }
  if (/彻底失败|人生失败|信用破产/u.test(input.description)) issues.push("债务压力不能被写成人格或人生失败");
  return issues;
}
