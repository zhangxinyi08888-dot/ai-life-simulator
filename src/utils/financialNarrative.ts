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
    /(?:你|主角|本人|你的).{0,28}(?:月薪|年薪|工资|薪资)|(?:当前|税后)?(?:月薪|年薪)(?:约|为|达到|调整为|调整至|提升至|降至|降到|升至)?\s*\d/u.test(sentence)
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
    .replace(/(?:税后)?年薪(?:将)?(?:从|由)\s*\d+(?:\.\d+)?\s*万(?:元)?[^，。；！？]{0,16}?(?:调整至|提升至|升至|降至|降到|增至|增加到|变为|达到)\s*\d+(?:\.\d+)?\s*万(?:元)?(?:左右)?/gu, `当前税后年薪约${formatWan(annualWan)}万元`)
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

function sanitizeUnsupportedMortgageClaims(description: string, ledger?: FinancialLedger): string {
  if (!ledger) return description;
  if (ledger.debtAccounts.some((account) => account.type === "mortgage")) return description;
  if (ledger.debtAccounts.length > 0) {
    return description
      .replace(/房贷|按揭/gu, "现有借款")
      .replace(/月供/gu, "每月还款压力");
  }
  return description.split(/(?<=[。！？])/u).map((sentence) => (
    /房贷|按揭|月供/u.test(sentence)
      ? "你们继续根据实际现金流调整家庭支出与储蓄安排。"
      : sentence
  )).join("");
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
    sanitizePersonalDebtClaims(sanitizeUnsupportedMortgageClaims(sanitizeUnsupportedIncomeComposition(sanitizeUnconfirmedPersonalDrawClaims(sanitizeRecurringIncomeClaims(prepared, ledger), ledger, acceptedEvents), ledger), ledger), state),
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

const CHINESE_MONEY_DIGIT_TOKEN = "零〇一二两三四五六七八九";
const CHINESE_MONEY_TOKEN = `${CHINESE_MONEY_DIGIT_TOKEN}十百千万`;
// Include compact spoken amounts such as “四千五” as one token rather than
// matching its “四千” prefix and silently degrading a ledger-backed 4,500-yuan
// amount. The short form may not stop before another Chinese unit or 元.
const OPENING_EXPENSE_AMOUNT = String.raw`(?:\d+(?:\.\d+)?\s*(?:万元?|万|元)|\d{3,6}|[${CHINESE_MONEY_TOKEN}]+(?:万|千|百|十)[${CHINESE_MONEY_DIGIT_TOKEN}]?(?![${CHINESE_MONEY_TOKEN}元])|[${CHINESE_MONEY_TOKEN}]+(?:万元?|万|千|百|十|元))`;
const OPENING_EXPENSE_AMOUNT_CAPTURE = `(${OPENING_EXPENSE_AMOUNT})`;
// `explicit_shared_amount` stores the protagonist's share, not necessarily
// the total that prose such as "合租每月 X" would assert.  Keep it out of
// this narrow sanitizer until a scope-aware renderer can prove the wording.
const EXPLICIT_OPENING_EXPENSE_AMOUNT_BASES = new Set(["explicit_known"]);
const CHINESE_MONEY_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
};
const CHINESE_MONEY_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1_000, 万: 10_000 };

type OpeningNarrativeExpenseType = "basic_living" | "housing" | "healthcare" | "dependent_support" | "insurance" | "education";

interface OpeningNarrativeExpenseContext {
  type: OpeningNarrativeExpenseType;
  pattern: string;
  label: string;
  /**
   * These categories can also occur as a one-off transaction.  Only strip an
   * invented amount when the same clause establishes a recurring cadence.
   */
  requiresRecurringCadence?: boolean;
}

const OPENING_NARRATIVE_EXPENSE_CONTEXTS: OpeningNarrativeExpenseContext[] = [
  { type: "basic_living", pattern: "日常(?:开销|生活|支出)|基本生活费|生活成本|(?:个人|自己(?:的)?)生活费", label: "日常生活", requiresRecurringCadence: true },
  { type: "housing", pattern: "房租|租金|物业(?:费)?|住房(?:维护|维修)?", label: "住房" },
  { type: "healthcare", pattern: "(?:父母|爸妈|母亲|父亲)?(?:医疗|医药|治疗|药费|住院|康复)(?:费|支出)?", label: "医疗" },
  { type: "dependent_support", pattern: "(?:父母|爸妈|母亲|父亲)[^，。！？；]{0,12}(?:家用|赡养|生活费|照护|护理)|(?:家用|赡养|生活费|照护|护理)[^，。！？；]{0,12}(?:父母|爸妈|母亲|父亲)", label: "家庭照护" },
  { type: "insurance", pattern: "保险费|保费|医疗险|重疾险|商业保险|养老保险", label: "保险", requiresRecurringCadence: true },
  { type: "education", pattern: "学费|教育费|课程费|培训费|进修费", label: "教育", requiresRecurringCadence: true }
];

const OPENING_RECURRING_EXPENSE_CADENCE = /每月|每个月|月均|月度|按月|月缴|月交|月付|每年|每年度|年度|按年|年缴|年交|年付|\/\s*(?:月|年)/u;
const OPENING_ANNUAL_EXPENSE_CADENCE = /每年|每年度|年度|按年|年缴|年交|年付|\/\s*年/u;
const OPENING_ONE_OFF_EXPENSE_MARKER = /一次性|单次|首期|报名费|退费|报销|获赔/u;
const OPENING_NON_PERSONAL_RECURRING_EXPENSE_CONTEXT = /^(?:公司|企业|团队|项目|工坊|工作室|办公室|机构|学校|基金会|雇主)[^，；：]{0,20}(?:保险费|保费|医疗险|重疾险|商业保险|养老保险|学费|教育费|课程费|培训费|进修费)/u;
const OPENING_THIRD_PARTY_EXPENSE_PAYER = /^(?:父母|爸妈|母亲|父亲|伴侣|配偶|家人|公司|雇主)[^，；：]{0,20}(?:承担|支付|缴纳|报销|代付|负担)/u;

function parseChineseMoneyInteger(raw: string): number | undefined {
  // Spoken shorthand elides the lower-order unit: 四千五 = 4,500 and
  // 二万五 = 25,000. It must be resolved before the general unit parser,
  // which otherwise treats the final 五 as individual yuan.
  const compact = raw.match(/^([零〇一二两三四五六七八九])([万千百十])([零〇一二两三四五六七八九])$/u);
  if (compact) {
    const leading = CHINESE_MONEY_DIGITS[compact[1]!];
    const unit = CHINESE_MONEY_UNITS[compact[2]!];
    const trailing = CHINESE_MONEY_DIGITS[compact[3]!];
    if (leading === undefined || unit === undefined || trailing === undefined) return undefined;
    return leading * unit + trailing * (unit / 10);
  }
  let total = 0;
  let section = 0;
  let digit: number | undefined;
  for (const character of raw) {
    if (character in CHINESE_MONEY_DIGITS) {
      digit = CHINESE_MONEY_DIGITS[character];
      continue;
    }
    const unit = CHINESE_MONEY_UNITS[character];
    if (!unit) return undefined;
    if (unit === 10_000) {
      total += (section + (digit ?? 0)) * unit;
      section = 0;
      digit = undefined;
      continue;
    }
    section += (digit ?? 1) * unit;
    digit = undefined;
  }
  return total + section + (digit ?? 0);
}

function parseOpeningExpenseAmountWan(raw: string): number | undefined {
  const normalized = raw.replace(/\s/gu, "");
  // Chinese spoken/compact money forms are all CNY amounts here: 四千五、
  // 四千五百、二万五元 should therefore be parsed as 4,500 / 4,500 / 25,000
  // yuan before converting to 万元. Treat them as a whole instead of first
  // stripping the final 千/百 unit, which would turn 四千五 into 4,005.
  const chineseNumberText = normalized.replace(/元$/u, "");
  if (new RegExp(`^[${CHINESE_MONEY_TOKEN}]+$`, "u").test(chineseNumberText)) {
    const chineseValue = parseChineseMoneyInteger(chineseNumberText);
    return chineseValue === undefined ? undefined : chineseValue * 0.0001;
  }
  const unitMatch = normalized.match(/(万元?|万|元|千|百|十)$/u);
  const unit = unitMatch?.[1];
  const numberText = unit ? normalized.slice(0, -unit.length) : normalized;
  const numeric = /^\d+(?:\.\d+)?$/u.test(numberText)
    ? Number(numberText)
    : parseChineseMoneyInteger(numberText);
  if (!Number.isFinite(numeric)) return undefined;
  const multiplier = unit === "万" || unit === "万元"
    ? 1
    : unit === "千"
      ? 0.1
      : unit === "百"
        ? 0.01
        : unit === "十"
          ? 0.001
          : 0.0001;
  return numeric * multiplier;
}

function openingExpenseClause(sentence: string, matchIndex: number): string {
  const before = sentence.slice(0, matchIndex);
  const boundary = Math.max(
    before.lastIndexOf("，"),
    before.lastIndexOf("；"),
    before.lastIndexOf("：")
  );
  const after = sentence.slice(matchIndex);
  const nextBoundary = after.search(/[，；：。！？]/u);
  return sentence.slice(boundary + 1, nextBoundary === -1 ? sentence.length : matchIndex + nextBoundary);
}

function hasClearlyNonPersonalOpeningExpenseContext(clause: string): boolean {
  return OPENING_NON_PERSONAL_RECURRING_EXPENSE_CONTEXT.test(clause)
    || OPENING_THIRD_PARTY_EXPENSE_PAYER.test(clause);
}

function openingExpenseAmountsForContext(
  sentence: string,
  context: string,
  requiresRecurringCadence = false
): number[] {
  const amounts = new Set<number>();
  const patterns = [
    new RegExp(`(?:${context})[^，。！？；]{0,16}?${OPENING_EXPENSE_AMOUNT_CAPTURE}`, "gu"),
    new RegExp(`${OPENING_EXPENSE_AMOUNT_CAPTURE}[^，。！？；]{0,8}?(?:${context})`, "gu")
  ];
  for (const pattern of patterns) {
    for (const match of sentence.matchAll(pattern)) {
      const clause = openingExpenseClause(sentence, match.index ?? 0);
      if (requiresRecurringCadence && (
        !OPENING_RECURRING_EXPENSE_CADENCE.test(clause)
        || OPENING_ONE_OFF_EXPENSE_MARKER.test(clause)
        || hasClearlyNonPersonalOpeningExpenseContext(clause)
      )) continue;
      let amount = parseOpeningExpenseAmountWan(match[1] || "");
      if (amount !== undefined && requiresRecurringCadence && OPENING_ANNUAL_EXPENSE_CADENCE.test(clause)) {
        amount /= 12;
      }
      if (amount !== undefined) amounts.add(amount);
    }
  }
  return [...amounts];
}

function hasExplicitOpeningExpenseAmount(ledger: FinancialLedger, type: OpeningNarrativeExpenseType, amountWan: number): boolean {
  return ledger.expenseCommitments.some((commitment) => (
    commitment.status === "active"
    && commitment.type === type
    && commitment.factStatus === "known"
    && isNarrativeEligibleFinancialFact(commitment)
    && ["personal", "shared_household"].includes(commitment.financialScope || "")
    && EXPLICIT_OPENING_EXPENSE_AMOUNT_BASES.has(commitment.amountBasis || "")
    && Math.abs(commitment.monthlyAmountWan - amountWan) < 0.0001
  ));
}

function hasCombinedParentExpenseAmount(sentence: string): boolean {
  return new RegExp(
    `(?:医疗|医药|治疗|药费|住院|康复)[^，。！？；]{0,12}(?:家用|赡养|生活费|照护|护理)[^，。！？；]{0,12}${OPENING_EXPENSE_AMOUNT_CAPTURE}`,
    "u"
  ).test(sentence);
}

/**
 * The opening node is generated after deterministic opening fact extraction.
 * Its prose cannot promote a model-supplied recurring expense amount into an
 * opening fact.  A displayed number is allowed only when the committed V4
 * account has the same explicit amount; contextual estimates remain visible
 * as reviewable accounts, never as a falsely precise story claim.
 */
function hasUnsupportedOpeningRecurringExpenseClaim(sentence: string, ledger: FinancialLedger): boolean {
  if (!new RegExp(OPENING_EXPENSE_AMOUNT, "u").test(sentence)) return false;
  if (hasCombinedParentExpenseAmount(sentence)) return true;
  return OPENING_NARRATIVE_EXPENSE_CONTEXTS.some(({ type, pattern, requiresRecurringCadence }) => (
    openingExpenseAmountsForContext(sentence, pattern, requiresRecurringCadence)
      .some((amountWan) => !hasExplicitOpeningExpenseAmount(ledger, type, amountWan))
  ));
}

function openingExpenseReviewNarrative(sentence: string, ledger: FinancialLedger): string {
  const activeTypes = new Set(ledger.expenseCommitments
    .filter((commitment) => commitment.status === "active")
    .map((commitment) => commitment.type));
  const labels = OPENING_NARRATIVE_EXPENSE_CONTEXTS
    .filter(({ type, pattern }) => activeTypes.has(type) && new RegExp(`(?:${pattern})`, "u").test(sentence))
    .map(({ label }) => label);
  if (labels.length === 0) return "你正在重新评估日常生活成本，具体金额仍待确认。";
  const subject = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join("、")}与${labels[labels.length - 1]}`;
  return `你仍在承担${subject}等持续支出，具体金额仍待确认。`;
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
    if (hasUnsupportedOpeningRecurringExpenseClaim(sentence, ledger)) {
      return openingExpenseReviewNarrative(sentence, ledger);
    }
    return sentence;
  }).join("");
}

export function sanitizeUnsupportedFinancialCoverageClaims(
  description: string,
  issueIds: string[]
): string {
  const hasIssue = (prefix: string) => issueIds.some((id) => id.startsWith(prefix));
  const unsupportedProperty = hasIssue("narrative_coverage_property_");
  const unsupportedMortgage = hasIssue("narrative_coverage_mortgage_");
  const unsupportedHolding = hasIssue("narrative_coverage_business_holding_")
    || hasIssue("narrative_coverage_personal_option_");
  const unsupportedCompensation = hasIssue("narrative_coverage_personal_compensation_")
    || hasIssue("personal_income_claim_without_event_");
  const unsupportedPersonalOutlay = hasIssue("narrative_coverage_personal_outlay_");
  if (!unsupportedProperty && !unsupportedMortgage && !unsupportedHolding && !unsupportedCompensation && !unsupportedPersonalOutlay) return description;
  return description.split(/(?<=[。！？])/u).map((sentence) => {
    if (unsupportedProperty && /(?:名下|自有|自己的).{0,16}(?:房|住房|公寓)|(?:买了|买下|购入|购买|卖掉|出售).{0,16}(?:房|住房|公寓)|(?:婚房|住房|房子|公寓)?首付|房产升值/u.test(sentence)) {
      return "你们继续根据实际现金流评估居住安排与生活成本。";
    }
    if (unsupportedMortgage && /房贷|按揭|月供/u.test(sentence)) {
      return "你们继续根据实际现金流调整家庭支出与储蓄安排。";
    }
    if (unsupportedHolding && /股权|期权|持股|股份|联合创始人|合伙人/u.test(sentence)) {
      return "相关权益仍在讨论与条件确认阶段，尚未真正落到你个人名下。";
    }
    if (unsupportedCompensation && /月薪|年薪|工资|薪资|个人收入|个人进账|个人净收入/u.test(sentence)) {
      return "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。";
    }
    if (unsupportedPersonalOutlay
      && /(?:你(?!们)|我(?!们)|本人|主角)[^。！？；]{0,24}(?:垫付(?:了)?|支付(?:了)?|缴纳(?:了)?|花费(?:了)?|支出(?:了)?|转出(?:了)?|拿出(?:了)?|付了)/u.test(sentence)
      && /(?:住院|急诊|手术|治疗|医疗|医药|护理|照护|父母|母亲|父亲|孩子|子女)/u.test(sentence)) {
      return "这段时间你持续处理家庭照护与健康安排，具体费用仍待权威账本确认。";
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
