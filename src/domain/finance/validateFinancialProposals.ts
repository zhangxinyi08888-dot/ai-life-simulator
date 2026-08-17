import type { CareerState } from "../career/types";
import { FinancialLedgerInvariantError } from "./ledgerMath";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type { LiquidityPolicy } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  FinancialEventKind,
  FinancialEventPayloadMap,
  FinancialEventProposal,
  FinancialLedger,
  FinancialLedgerIssue,
  ExpenseCommitmentV4
} from "./types";
import { isExpenseCommitmentV4, isFinancialLedgerV4 } from "./types";
import { parentElderCareCoverageRole, type ParentElderCareCoverageRole } from "./elderCareCoverage";
import { hasExplicitPersonalBusinessIncomeReceipt, hasMatchingPersonalBusinessIncomeAmount, isNarratedBeforePeriod, matchFinancialEvidence, type EvidenceMatchReason } from "./evidenceMatching";
import { validateFinancialPayloadSchema } from "./financialProposalSchema";
import { hasCompletedEmployerStartEvidence } from "../../utils/employmentState";
import { bindNarrativeExpenseFacts, type NarrativeExpenseFactBinding } from "./narrativeExpenseFactBinding";
import {
  validateExpenseConfirmation,
  type ExpenseAmountObservation,
  type ExpenseConfirmationValidationResult
} from "./expenseConfirmation";
import { expenseReviewIntervalMonths } from "./expenseEstimationPolicyV2";

const FINANCIAL_EVENT_KINDS = new Set<FinancialEventKind>([
  "income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended",
  "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended",
  "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered",
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven", "debt_default_recorded",
  "business_holding_started",
  "business_option_granted", "business_option_vested", "business_option_revalued",
  "business_option_exercised", "business_option_expired", "business_option_cancelled",
  "business_financing_recorded", "business_holding_revalued", "business_distribution_received",
  "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"
]);

export function isFinancialEventKind(value: unknown): value is FinancialEventKind {
  return FINANCIAL_EVENT_KINDS.has(value as FinancialEventKind);
}
const ASSET_TYPES = new Set(["investment", "property", "annuity", "insurance_cash_value", "other_personal_asset"]);
const PERSONAL_INCOME_SOURCE_TYPES = new Set(["salary", "contract", "self_employment_draw", "rent", "pension", "annuity_payment", "royalty", "investment_distribution", "business_dividend", "family_support", "other"]);
const PERSONAL_OPERATING_FLOW_KINDS = new Set<FinancialEventKind>([
  "income_source_started",
  "income_source_adjusted",
  "income_source_paused",
  "income_source_ended",
  "one_off_income_received",
  "expense_commitment_started",
  "expense_commitment_adjusted",
  "expense_commitment_ended",
  "one_off_expense_paid"
]);
// These events are accepted only by the protagonist's personal ledger.  A
// company or third-party scope is not a destination-routing hint: allowing it
// through would still mutate personal cash in the reducer.
const PERSONAL_CASH_INFLOW_EVENT_KINDS = new Set<FinancialEventKind>([
  "income_source_started",
  "income_source_adjusted",
  "one_off_income_received",
  "family_support_received",
  "business_distribution_received"
]);

/**
 * A salary mentioned in a job posting, an unaccepted offer, or a comparison
 * with the protagonist's present pay is an opportunity, not a personal-income
 * fact. It must not reconfirm a stale legacy wage or restart its accrual.
 *
 * An offer, signed contract, or onboarding plan does not make its quoted pay
 * current income. Only an explicit completed first day can do that.
 */
export function isUnacceptedIncomeOpportunityEvidence(evidence: string): boolean {
  const uncompletedStart = /(?:下(?:个)?月|下周|明天|未来|将于|将在|计划|准备|拟|预计|等待|确认|安排|尚未|还未|若|如果|一旦)[^。；]{0,32}(?:入职|到岗|上班|任职|担任|加入)|(?:下(?:个)?月|下周|明天|未来|将于|将在|计划|准备|拟|预计|等待|确认|安排|尚未|还未|若|如果|一旦)[^。；]{0,32}(?:接下|接了|接受(?:了)?)[^。；]{0,32}(?:顾问|咨询)(?:岗位|职位|工作)|入职(?:手续|流程|日期)/u.test(evidence);
  const completedEmployment = !uncompletedStart
    && (hasCompletedEmployerStartEvidence(evidence)
      || /(?:你|主角|本人)[^。；]{0,48}(?:正式(?:入职|换(?:了)?工作|换岗|跳槽|转岗)|已经(?:入职|换(?:了)?工作|换岗|跳槽|转岗)|已(?:入职|换(?:了)?工作|换岗|跳槽|转岗)|(?:正式)?加入[^。；]{0,24}(?:公司|企业|机构|团队)[^。；]{0,28}(?:担任|任职|负责|工作|职位|岗位)|换到[^。；]{0,24}(?:岗位|工作))/u.test(evidence));
  if (completedEmployment) return false;
  return uncompletedStart
    || /(?:正在招|招聘|招募|招人|(?:新|该|这个|一个|某个|招聘的).{0,4}(?:岗位|职位)|(?:岗位|职位).{0,20}(?:招聘|招募|开放)|工作机会|猎头|offer|录用通知|(?:签署|签了|签订)[^。；]{0,24}(?:劳动合同|聘用合同)|薪资比(?:现在|目前)|薪资(?:更高|更低)|薪酬(?:更高|更低)|(?:问你愿不愿意|邀请你|希望你|请你|考虑是否)[^。；]{0,42}(?:牵头|负责|接手|加入|参与)[^。；]{0,32}(?:项目|岗位|工作|任务))/iu.test(evidence);
}

const EXPLICIT_PROTAGONIST_ANNUAL_INCOME = /(?:(?:按|以|基于)\s*(?:你(?!们|和|与|跟)|主角|本人)|(?:你的|主角的|本人的)|(?:你(?!们|和|与|跟))(?:目前|现在|仍(?:在)?|已(?:经)?|正(?:在)?|继续|留在|在)?)[^。！？；]{0,36}?(?:(?:税后)?年收入|年税后收入)(?:正式)?(?:约|为|有|达到|调整为|降至|升至|涨到|维持在|稳定在)?(?:约)?\s*(\d+(?:\.\d+)?)\s*万元?/u;

/**
 * Return the amount only when plain “年收入” is locally owned by the
 * protagonist.  A sentence can mention a partner and still state the
 * protagonist's current income (for example, “她说，按你留在本地、年收入
 * 稳定在18万元…”), so a boolean third-party regex is not sufficient.
 */
export function explicitProtagonistAnnualIncomeWan(evidence: string): number | undefined {
  for (const sentence of String(evidence || "").split(/(?<=[。！？；])/u)) {
    const match = sentence.match(EXPLICIT_PROTAGONIST_ANNUAL_INCOME);
    const amount = match ? Number(match[1]) : undefined;
    if (Number.isFinite(amount) && (amount as number) > 0) return amount;
  }
  return undefined;
}

/** Plain annual income is usable only when the amount is explicitly owned by the protagonist. */
export function hasExplicitProtagonistAnnualIncomeFact(evidence: string): boolean {
  return explicitProtagonistAnnualIncomeWan(evidence) !== undefined;
}

/**
 * A narrator may mention a third party before explicitly stating the
 * protagonist's annual income.  That statement only disambiguates a proposed
 * recurring personal source when the proposed amount is the same amount.  Do
 * not let it waive the third-party guard for an arbitrary income proposal.
 */
function proposalMatchesExplicitProtagonistAnnualIncome(input: {
  proposal: FinancialEventProposal;
  subject: Record<string, any> | undefined;
}): boolean {
  if (![
    "income_source_started",
    "income_source_adjusted"
  ].includes(input.proposal.kind)) return false;
  const annualIncomeWan = explicitProtagonistAnnualIncomeWan(input.proposal.evidence);
  if (!(Number.isFinite(annualIncomeWan) && (annualIncomeWan as number) > 0)) return false;
  const proposedAnnualWan = input.subject?.accrualPolicy === "monthly"
    ? Number(input.subject.monthlyNetAmountWan) * 12
    : Number(input.subject?.annualNetAmountWan);
  return Number.isFinite(proposedAnnualWan)
    && Math.abs(proposedAnnualWan - annualIncomeWan) < 0.000001;
}

function personalCareerIncomeEvidenceIsExplicit(type: unknown, evidence: string): boolean {
  if (!["salary", "contract", "self_employment_draw", "business_dividend"].includes(String(type))) return true;
  if (isUnacceptedIncomeOpportunityEvidence(evidence)) return false;
  if (String(type) === "self_employment_draw" || String(type) === "business_dividend") {
    if (/(?:你|我|主角|本人).{0,32}(?:从|动用)[^。；]{0,20}(?:积蓄|存款|储蓄|备用金|个人账户)[^。；]{0,20}(?:提取|拿出|支取|取出)|(?:你|我|主角|本人).{0,20}(?:从积蓄中|从存款中|从储蓄中|从备用金中)(?:提取|拿出|支取|取出)/u.test(evidence)) {
      return false;
    }
    return hasExplicitPersonalBusinessIncomeReceipt({ type, evidence });
  }
  // Do not treat a generic achievement (for example, \"获得主管肯定\") as
  // wage evidence.  A recurring career source needs either a compensation
  // term, or an explicit periodic personal receipt/earning statement.
  const compensationTerm = /(?:税后)?(?:月薪|年薪|工资|薪资|年税后收入|税后年收入)|顾问费|咨询收入|副业月收入|个人收入|个人进账|个人账户|可支配收入|报酬/u.test(evidence);
  const periodicPersonalReceipt = /(?:你|我|主角|本人).{0,56}(?:每月|月均|按月|每年|年度|年收入).{0,36}(?:领取|获得|收到|赚|挣|进账|支付|发放)/u.test(evidence);
  // “税后到手约 X 万，按月结算” is an explicit recurring net wage amount,
  // even when the prose does not repeat the word “工资”.  It is intentionally
  // a salary-only rule: founder draws and dividends still require an explicit
  // completed personal business receipt above.
  const explicitMonthlyTakeHomeSalary = String(type) === "salary"
    && !/(?:独立|自由职业|自由顾问|项目制|外包)[^。；]{0,32}(?:项目|合同|咨询)|(?:顾问|咨询)[^。；]{0,20}(?:项目|合同)/u.test(evidence)
    && String(evidence || "").split(/(?<=[。！？；])/u).some((sentence) => (
      /税后到手(?:约|为|有)?\s*\d+(?:\.\d+)?\s*(?:万|元)/u.test(sentence)
      && /(?:按月|每月|月度)结算/u.test(sentence)
    ));
  return compensationTerm
    || periodicPersonalReceipt
    || explicitMonthlyTakeHomeSalary
    || hasExplicitProtagonistAnnualIncomeFact(evidence);
}

const CHINESE_SALARY_RATIO_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10
};

function chineseSalaryPercentage(value: string): number | undefined {
  if (value === "十") return 100;
  if (value.length === 1) {
    const digit = CHINESE_SALARY_RATIO_DIGITS[value];
    return digit === undefined ? undefined : digit * 10;
  }
  if (value.includes("十")) {
    const [tensText, unitsText] = value.split("十");
    const tens = tensText ? CHINESE_SALARY_RATIO_DIGITS[tensText] : 1;
    const units = unitsText ? CHINESE_SALARY_RATIO_DIGITS[unitsText] : 0;
    if (tens === undefined || units === undefined) return undefined;
    return tens * 10 + units;
  }
  return undefined;
}

function relativeSalaryRatio(evidence: string): number | undefined {
  const sentences = String(evidence || "").split(/(?<=[。！？；])/u).filter(Boolean);
  for (const sentence of sentences) {
    const hasPersonalSalaryReceipt = /(?:你(?!们)|我(?!们)|主角|本人)[^。；]{0,64}(?:领取|领到|拿到|到手|发放|调整为|降为|降至)[^。；]{0,48}(?:工资|薪水|薪资|月薪|年薪)|(?:你(?!们)|我(?!们)|主角|本人)[^。；]{0,40}(?:工资|薪水|薪资|月薪|年薪)[^。；]{0,32}(?:调整为|降为|降至|发放|领取|领到|拿到|到手)/u.test(sentence);
    const referencesPriorSalary = /(?:原来|原先|原工资|原薪水|原薪资|原月薪|原年薪|此前|之前|上一份工作|上份工作)/u.test(sentence);
    const isProspective = /(?:计划|打算|考虑|准备|希望|可能|如果|将来|未来|尚未|还未|预计|拟)[^。；]{0,40}(?:领取|领到|拿到|工资|薪水|薪资|月薪|年薪)/u.test(sentence);
    if (!hasPersonalSalaryReceipt || !referencesPriorSalary || isProspective) continue;
    if (/一半/u.test(sentence)) return 0.5;
    const numericPercent = sentence.match(/(\d+(?:\.\d+)?)\s*%/u);
    if (numericPercent) {
      const percentage = Number(numericPercent[1]);
      if (Number.isFinite(percentage) && percentage > 0 && percentage <= 200) return percentage / 100;
    }
    const chinesePercent = sentence.match(/百分之([零一二两三四五六七八九十]+)/u);
    if (chinesePercent) {
      const percentage = chineseSalaryPercentage(chinesePercent[1]);
      if (percentage !== undefined && percentage > 0 && percentage <= 200) return percentage / 100;
    }
    const proportion = sentence.match(/([\d.]+|[一二两三四五六七八九十])\s*成/u);
    if (proportion) {
      const numeric = Number(proportion[1]);
      const tenths = Number.isFinite(numeric) ? numeric : CHINESE_SALARY_RATIO_DIGITS[proportion[1]];
      if (tenths !== undefined && tenths > 0 && tenths <= 10) return tenths / 10;
    }
  }
  return undefined;
}

/**
 * A completed salary transition may state the new wage as an exact fraction
 * of the one authoritative prior career salary.  This is not a licence to
 * infer company income: it is salary-only, requires one unambiguous baseline,
 * and accepts only the amount produced by that baseline and ratio.
 */
function proposalMatchesAuthoritativeRelativeSalary(input: {
  proposal: FinancialEventProposal;
  source: Record<string, unknown> | undefined;
  ledger: FinancialLedger;
  narrativeText: string;
}): boolean {
  if (input.source?.type !== "salary" || input.source.accrualPolicy !== "monthly") return false;
  if (isUnacceptedIncomeOpportunityEvidence(input.proposal.evidence)) return false;
  if (!hasCompletedEmployerStartEvidence(input.narrativeText)) return false;
  const ratio = relativeSalaryRatio(input.proposal.evidence);
  if (ratio === undefined) return false;
  const priorSalaries = input.ledger.incomeSources.filter((source) => (
    source.status === "active"
    && source.type === "salary"
    && Boolean(source.linkedCareerStateId)
    && source.accrualPolicy === "monthly"
    && Number.isFinite(source.monthlyNetAmountWan)
  ));
  if (priorSalaries.length !== 1) return false;
  const nextCareerStateId = input.source.linkedCareerStateId;
  if (typeof nextCareerStateId !== "string"
    || nextCareerStateId === priorSalaries[0].linkedCareerStateId) return false;
  const proposedMonthlyWan = Number(input.source.monthlyNetAmountWan);
  return Number.isFinite(proposedMonthlyWan)
    && Math.abs(proposedMonthlyWan - priorSalaries[0].monthlyNetAmountWan * ratio) < 0.000001;
}

function proposalIssue(input: {
  proposal?: FinancialEventProposal;
  code: FinancialLedgerIssue["code"];
  summary: string;
  ageInMonths: number;
  severity?: FinancialLedgerIssue["severity"];
}): FinancialLedgerIssue {
  const payload = input.proposal?.payload && typeof input.proposal.payload === "object"
    ? input.proposal.payload as Record<string, any>
    : {};
  const relatedIncomeSourceIds = [payload.incomeSourceId, payload.nextSource?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  const relatedAccountIds = [payload.sourceCashAccountId, payload.destinationCashAccountId, payload.assetAccountId, payload.assetAccount?.id, payload.expenseCommitmentId, payload.nextCommitment?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  const relatedDebtAccountIds = [payload.debtAccountId, payload.oldDebtAccountId, payload.debtAccount?.id, payload.replacementDebtAccount?.id].filter((value): value is string => typeof value === "string" && value.length > 0);
  const isHoldingPayload = input.proposal?.kind === "business_holding_started";
  const relatedBusinessHoldingIds = [
    payload.businessHoldingId,
    payload.businessHolding?.id,
    isHoldingPayload ? payload.id : undefined,
    payload.optionHolding?.id,
    payload.resultingEquityHolding?.id
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const safeSummary = String(input.summary || "财务 Proposal 校验失败")
    .replace(/\bundefined\b/gi, "缺失值")
    .replace(/\bnull\b/gi, "空值");
  return {
    id: `proposal_issue_${input.proposal?.id || input.code}_${input.ageInMonths}`,
    code: input.code,
    severity: input.severity || "blocking",
    status: "open",
    relatedProposalIds: input.proposal ? [input.proposal.id] : [],
    relatedAccountIds,
    relatedIncomeSourceIds,
    relatedDebtAccountIds,
    relatedBusinessHoldingIds,
    summary: safeSummary,
    createdAtAgeInMonths: input.ageInMonths,
    ...(input.proposal?.kind === "income_source_adjusted" ? { pendingFactPolicy: "bounded_last_known_income" as const } : {})
  };
}

function typedReferenceIssue(input: { proposal: FinancialEventProposal; ledger: FinancialLedger; ageInMonths: number }): FinancialLedgerIssue | undefined {
  const payload = input.proposal.payload as Record<string, any>;
  const references: Array<{ id: unknown; label: string; ids: string[] }> = [];
  const activeCash = input.ledger.cashAccounts.filter((item) => item.status === "active").map((item) => item.id);
  const activeIncome = input.ledger.incomeSources.filter((item) => item.status !== "ended").map((item) => item.id);
  const activeExpenses = input.ledger.expenseCommitments.filter((item) => item.status !== "ended").map((item) => item.id);
  const activeAssets = input.ledger.assetAccounts.filter((item) => item.status !== "disposed").map((item) => item.id);
  const activeDebts = input.ledger.debtAccounts.filter((item) => item.status === "active" || item.status === "defaulted").map((item) => item.id);
  const activeHoldings = input.ledger.businessHoldings.filter((item) => item.status === "active" || item.status === "partially_sold").map((item) => item.id);
  if (["income_source_adjusted", "income_source_paused", "income_source_ended"].includes(input.proposal.kind)) references.push({ id: payload.incomeSourceId, label: "收入来源", ids: activeIncome });
  if (["expense_commitment_adjusted", "expense_commitment_ended"].includes(input.proposal.kind)) references.push({ id: payload.expenseCommitmentId, label: "支出义务", ids: activeExpenses });
  if (["asset_sold", "asset_revalued"].includes(input.proposal.kind)) references.push({ id: payload.assetAccountId, label: "资产账户", ids: activeAssets });
  if (["debt_principal_repaid", "debt_interest_paid", "debt_forgiven"].includes(input.proposal.kind)) references.push({ id: payload.debtAccountId, label: "债务账户", ids: activeDebts });
  if (input.proposal.kind === "debt_restructured") references.push({ id: payload.oldDebtAccountId, label: "债务账户", ids: activeDebts });
  if (["business_financing_recorded", "business_holding_revalued", "business_distribution_received", "business_holding_sold",
    "business_option_vested", "business_option_revalued", "business_option_exercised", "business_option_expired", "business_option_cancelled"
  ].includes(input.proposal.kind)) references.push({ id: payload.businessHoldingId, label: "企业持股", ids: activeHoldings });
  const destinationCashKinds: FinancialEventKind[] = ["one_off_income_received", "family_support_received", "asset_sold", "debt_drawn", "liquidity_shortfall_created", "business_distribution_received", "business_holding_sold"];
  const sourceCashKinds: FinancialEventKind[] = ["one_off_expense_paid", "family_support_paid", "asset_purchased", "debt_principal_repaid", "debt_interest_paid", "business_holding_started", "business_option_exercised"];
  if (destinationCashKinds.includes(input.proposal.kind)) references.push({ id: payload.destinationCashAccountId, label: "现金账户", ids: activeCash });
  if (sourceCashKinds.includes(input.proposal.kind) || (input.proposal.kind === "debt_restructured" && payload.sourceCashAccountId)) references.push({ id: payload.sourceCashAccountId, label: "现金账户", ids: activeCash });
  const invalid = references.find((reference) => typeof reference.id === "string" && !reference.ids.includes(reference.id));
  if (!invalid) return undefined;
  return proposalIssue({
    proposal: input.proposal,
    code: input.proposal.kind === "asset_sold" ? "UNBALANCED_TRANSACTION" : "ACCOUNT_TYPE_MISMATCH",
    summary: `${invalid.label} ID 类型错误或不存在：${String(invalid.id)}；合法候选：${invalid.ids.length ? invalid.ids.join("、") : "无可用候选"}`,
    ageInMonths: input.ageInMonths
  });
}

function businessOperatingFact(proposal: FinancialEventProposal): boolean {
  const payload = proposal.payload as Record<string, any>;
  const subject = proposal.kind === "expense_commitment_adjusted" ? payload.nextCommitment : payload;
  const text = `${proposal.evidence || ""} ${subject?.displayName || ""}`;
  const businessExpense = /(?:公司|团队|项目|门店|工作室|机构|中心)[^。；]{0,40}(?:工资|薪酬|人力成本|运营成本|服务器|市场推广|采购|办公成本|仓库|场地|审计费)|(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,30}(?:会计|员工|助理|工程师|销售|运营)[^。；]{0,20}(?:月薪|工资|薪酬)|(?:专职会计|员工|助理|工程师|销售|运营)[^。；]{0,16}(?:月薪|工资|薪酬)|(?:仓库|办公室|门店|场地)(?:月租|租金)|(?:团队工资|员工工资|助理补贴|企业运营)/u.test(text);
  const businessRevenue = /(?:公司|SaaS|产品|平台|客户合同|客户年费|工作室|机构|中心|基金会|协会|公益项目)[^。；]{0,45}(?:营收|收入|年费|回款|销售额|资助|拨款|赞助|捐款|月捐|会费|项目款|首期款|可支配资金)|(?:订阅收入|公司月收入|项目营收|项目资助|项目拨款|机构月捐|项目捐款)/u.test(text);
  const explicitlyNegatedReceipt = /你(?:个人)?[^。；]{0,12}(?:没有|未|并未|不曾)[^。；]{0,12}(?:领取|获得|收到|分红|股息)/u.test(text);
  const isIncomeProposal = ["income_source_started", "income_source_adjusted", "one_off_income_received"].includes(proposal.kind);
  const explicitPersonal = isIncomeProposal && !explicitlyNegatedReceipt
    && /你(?:个人)?[^。；]{0,20}(?:领取|获得|收到|税后工资|月薪|年薪|年税后收入|税后年收入|顾问费|分红|股息)|转入(?:你的|个人)账户/u.test(text);
  const personalCompensation = ["salary", "contract", "self_employment_draw"].includes(String(subject?.type))
    && /(?:税后|到手)?(?:工资|薪资|月薪|年薪|年税后收入|税后年收入)|顾问费|咨询费/u.test(text);
  return (businessExpense || businessRevenue) && !explicitPersonal && !personalCompensation;
}

/**
 * A restricted project grant can be received by the protagonist as the
 * applicant or temporary custodian without becoming personal cash. This is
 * deliberately narrower than the general business-operating check: reject
 * only a personal-income proposal when both the funding source and an
 * earmarked public/project use are explicit. A personal, freely disposable
 * creative award remains a valid personal receipt.
 */
function restrictedProjectFundingFact(proposal: FinancialEventProposal): boolean {
  if (![
    "income_source_started",
    "income_source_adjusted",
    "one_off_income_received",
    "family_support_received",
    "business_distribution_received"
  ].includes(proposal.kind)) return false;

  const payload = proposal.payload as Record<string, unknown>;
  const subject = proposal.kind === "income_source_adjusted" ? payload.nextSource : payload;
  const evidence = String(proposal.evidence || "");
  const text = `${evidence} ${JSON.stringify(subject || {})}`;
  // Keep the production audit's source-language vocabulary covered here:
  // a restricted education/special/project fund is not a personal cash inflow
  // merely because the protagonist applied for or temporarily holds it.
  const projectFunding = /(?:项目|公益|专项|教育)[^。；\n]{0,24}(?:基金|资助|拨款|赞助|项目款|资金|经费|款)|(?:基金|资助|拨款|赞助|项目款|资金|经费|款)[^。；\n]{0,24}(?:项目|公益|专项|教育)/u.test(text);
  const publicBeneficiaryUse = /(?:用于|用作|为|专款|专用|专项|定向|仅限|专门)[^。；\n]{0,56}(?:学校|村小|校园|教师|学生|硬件|教学设备|设备|教具|教师津贴|助学|公益项目|志愿者|公益机构|基金会|社会组织|非营利|社区服务|受助人|服务对象|教学|课程|培训|公益)|(?:提供|购置|采购|配发|发放)[^。；\n]{0,28}(?:学校|村小|教师|学生|硬件|教学设备|设备|教具|津贴|助学|公益项目|志愿者|公益机构|基金会|社会组织|非营利|社区服务|教学|课程|培训|公益)/u.test(text);
  const genericProjectExecutionUse = /(?:用于|用作|为|专款|专用|专项|定向|仅限|专门)[^。；\n]{0,56}(?:项目运营|项目实施|项目执行|项目服务|机构运营)/u.test(text);
  const explicitlyPublicContext = /(?:公益|教育|学校|村小|校园|教师|学生|助学|社区服务|基金会|社会组织|非营利)/u.test(text);
  // "项目款用于项目执行" can also describe a protagonist's commercial
  // consulting engagement. The generic execution wording becomes restricted
  // only when the same fact explicitly identifies a public beneficiary.
  const earmarkedPublicUse = publicBeneficiaryUse || (genericProjectExecutionUse && explicitlyPublicContext);
  const explicitPersonalUnrestrictedAward = /(?:个人(?:可)?自由支配|个人(?:可)?自行支配|你(?:个人)?(?:可)?自由支配|你(?:个人)?(?:可)?自行支配|无(?:指定|限定)用途)[^。；\n]{0,32}(?:奖(?:金|励)?|奖金)|(?:奖(?:金|励)?|奖金)[^。；\n]{0,48}(?:个人(?:可)?自由支配|个人(?:可)?自行支配|你(?:个人)?(?:可)?自由支配|你(?:个人)?(?:可)?自行支配|无(?:指定|限定)用途)/u.test(evidence);

  return projectFunding && earmarkedPublicUse && !explicitPersonalUnrestrictedAward;
}

function unsupportedRecurringOtherIncome(proposal: FinancialEventProposal): boolean {
  if (proposal.kind !== "income_source_started" && proposal.kind !== "income_source_adjusted") return false;
  const payload = proposal.payload as Record<string, any>;
  const source = proposal.kind === "income_source_adjusted" ? payload.nextSource : payload;
  if (source?.type !== "other" || source?.accrualPolicy === "event_only") return false;
  const text = `${proposal.evidence || ""} ${source?.displayName || ""}`;
  const hasRecurringCadence = /(?:每月|月均|按月|月收入|每年|年度|按年|年收入|稳定|固定|持续|定期|月薪|年薪)/u.test(text);
  return !hasRecurringCadence;
}

function thirdPartyIncomeFact(proposal: FinancialEventProposal): boolean {
  if (!["income_source_started", "income_source_adjusted", "one_off_income_received", "family_support_received"].includes(proposal.kind)) return false;
  const payload = proposal.payload as Record<string, any>;
  const subject = proposal.kind === "income_source_adjusted" ? payload.nextSource : payload;
  const text = `${proposal.evidence || ""} ${subject?.displayName || ""}`;
  const thirdPartySubjectName = /^(?:妻子|丈夫|伴侣|配偶|父亲|母亲|妈妈|爸爸|儿子|女儿|孩子|小余)/u.test(String(subject?.displayName || ""));
  const thirdPartyNarrative = /(?:妻子|丈夫|伴侣|配偶|女友|男友|父亲|母亲|妈妈|爸爸|儿子|女儿|孩子|岳父|岳母|公公|婆婆|小余|她|他)[^。；]{0,45}(?:月薪|年薪|工资|薪资|收入|到手|分红|股息|赚|盈利|利润)/u.test(text);
  // Do not let a sentence-initial “她说” own a later, explicitly
  // protagonist-attributed annual income.  A payload named as a third-party
  // source still loses: model display names cannot relabel another person's
  // salary as the protagonist's income.
  const thirdParty = thirdPartySubjectName
    || (thirdPartyNarrative && !proposalMatchesExplicitProtagonistAnnualIncome({ proposal, subject }));
  const transferredToProtagonist = /(?:给你|向你|转入你的|转给你|汇给你|进入你(?:的)?账户|转[^。；]{0,16}(?:进|入)你(?:建立的|的)?[^。；]{0,16}账户|共同账户)/u.test(text);
  const protagonistIsRecipient = /(?:邀请|邀约|问|聘请|雇佣|希望)[^。；]{0,18}你[^。；]{0,28}(?:月薪|年薪|工资|薪资|顾问费|咨询费)|你[^。；]{0,28}(?:加入|担任|受聘|接受)[^。；]{0,28}(?:月薪|年薪|工资|薪资|顾问费|咨询费)/u.test(text);
  // A recurring source always belongs to the person who earns it. An explicit
  // transfer from that source may be recorded only as family_support_received;
  // it must never become a protagonist salary/source or CareerState link.
  if (thirdParty && ["income_source_started", "income_source_adjusted"].includes(proposal.kind)) return true;
  if (thirdParty && proposal.kind === "family_support_received") return !transferredToProtagonist;
  return thirdParty && !protagonistIsRecipient;
}

function duplicateDebtBalanceDiscovery(
  proposal: FinancialEventProposal,
  ledger: FinancialLedger
): { id: string; principalWan: number } | undefined {
  if (proposal.kind !== "debt_balance_discovered") return undefined;
  const candidate = (proposal.payload as FinancialEventPayloadMap["debt_balance_discovered"]).debtAccount;
  const activeDebts = ledger.debtAccounts.filter((account) => account.status === "active" || account.status === "defaulted");
  const exactId = activeDebts.find((account) => account.id === candidate.id);
  if (exactId) return exactId;

  // A repeated mention of the sole opening mortgage is not a new balance fact.
  // Multiple mortgages remain distinguishable and therefore require an
  // explicit account id instead of being collapsed by type.
  if (candidate.type !== "mortgage") return undefined;
  const activeMortgages = activeDebts.filter((account) => account.type === "mortgage");
  if (activeMortgages.length !== 1) return undefined;
  const existing = activeMortgages[0];
  const toleranceWan = Math.max(0.01, Math.abs(existing.principalWan) * 0.001);
  return Math.abs(existing.principalWan - candidate.principalWan) <= toleranceWan
    ? existing
    : undefined;
}

function debtBalanceEvidenceSupportsPrincipal(proposal: FinancialEventProposal): boolean {
  if (proposal.kind !== "debt_balance_discovered") return true;
  const principalWan = Number(
    (proposal.payload as FinancialEventPayloadMap["debt_balance_discovered"]).debtAccount.principalWan
  );
  const debtEvidence = proposal.evidence?.split(/(?<=[。！？；])/u).find((sentence) => (
    /房贷|按揭|贷款|借款|欠款|负债|债务|本金/u.test(sentence)
    && /余额|尚欠|还欠|剩余|本金|欠款|负债|债务/u.test(sentence)
  ));
  if (!debtEvidence) return false;
  const explicitBalancesWan = [...debtEvidence.matchAll(/(\d+(?:\.\d+)?)\s*万元?/gu)]
    .map((match) => Number(match[1]));
  return explicitBalancesWan.some((amount) => (
    Math.abs(amount - principalWan) <= Math.max(0.01, Math.abs(principalWan) * 0.001)
  ));
}

function markEstimatedFacts<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(markEstimatedFacts) as T;
  const clone = structuredClone(value) as Record<string, unknown>;
  if ("factStatus" in clone) clone.factStatus = "estimated";
  for (const [key, child] of Object.entries(clone)) {
    if (key !== "evidence") clone[key] = markEstimatedFacts(child);
  }
  return clone as T;
}

/**
 * A due review is a deterministic policy transition on an already accepted
 * V4 commitment.  It is intentionally much narrower than a model proposal:
 * it may not create a commitment, change its responsibility identity or
 * amount, and it must be anchored to this node's accepted outcome.  This
 * preserves the ordinary schema/reducer path without inventing a narrative
 * sentence that never existed.
 */
function isValidSystemExpenseLifecycleReview(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
}): boolean {
  const { proposal } = input;
  if (proposal.systemGenerated !== "expense_lifecycle_review"
    || !proposal.id.startsWith("system_expense_review_")
    || proposal.kind !== "expense_commitment_adjusted") return false;
  const payload = proposal.payload as Record<string, unknown>;
  const commitmentId = payload.expenseCommitmentId;
  const next = payload.nextCommitment as Record<string, unknown> | undefined;
  if (typeof commitmentId !== "string" || !next || typeof next !== "object") return false;
  const current = input.ledger.expenseCommitments.find((item) => item.id === commitmentId);
  return Boolean(
    current
    && current.status !== "ended"
    && next.id === current.id
    && next.responsibilityKey === current.responsibilityKey
    && next.responsibilityKind === current.responsibilityKind
    && next.type === current.type
    && Number(next.monthlyAmountWan) === current.monthlyAmountWan
    && next.status === current.status
    && next.factStatus === current.factStatus
    && next.amountBasis === current.amountBasis
    && next.confirmedMonthlyAmountWan === current.confirmedMonthlyAmountWan
    && next.lastConfirmedAtAgeInMonths === current.lastConfirmedAtAgeInMonths
    && next.accrualReviewStatus === "review_due"
  );
}

const V4_EXPENSE_CHANGE_REASONS = new Set([
  "residence_ended", "shared_responsibility_changed", "explicit_amount_reduced", "estimate_superseded_by_exact_fact", "dependent_independent",
  "care_responsibility_transferred", "care_recipient_deceased", "treatment_completed", "insurance_cancelled",
  "education_completed", "aggregate_atomically_split", "temporary_third_party_coverage",
  "responsibility_resumed", "responsibility_ended"
]);

function changeReasonHasAcceptedEvidence(reason: string, text: string): boolean {
  switch (reason) {
    case "residence_ended":
      return /搬离|退租|退房|不再居住|搬出/u.test(text);
    case "shared_responsibility_changed":
      return /共同承担|分摊|各自承担|承担比例|对半|份额/u.test(text);
    case "explicit_amount_reduced":
      return /(?:月租|房租|支出|费用|保费|医疗费|生活费).{0,20}(?:降|减少|下调|变为|调整为)|(?:降为|减少至|下调至).{0,20}(?:元|万)/u.test(text);
    case "estimate_superseded_by_exact_fact":
      return /(?:实际|当前|现行|仍|每月).{0,32}(?:月租|房租|支出|费用|保费|医疗费|生活费|每月).{0,32}(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|万)/u.test(text)
        || /(?:每月|每季度|每年)(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|万).{0,20}(?:月租|房租|支出|费用|保费|医疗费|生活费)/u.test(text)
        || /(?:月租|房租|支出|费用|保费|医疗费|生活费).{0,20}(?:每月|每季度|每年)?(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|万)/u.test(text);
    case "dependent_independent":
      return /子女.{0,20}(?:独立|工作|不再需要抚养)|独立生活/u.test(text);
    case "care_responsibility_transferred":
      return /照护.{0,30}(?:转由|转给|改由|不再由)|(?:责任|费用).{0,20}(?:转移|改由|转由)/u.test(text);
    case "care_recipient_deceased":
      return /去世|离世/u.test(text);
    case "treatment_completed":
      return /(?:治疗|用药|复诊).{0,24}(?:完成|结束|停止)|康复/u.test(text);
    case "insurance_cancelled":
      return /(?:保单|保险).{0,24}(?:取消|终止|退保|结束)|不再.{0,12}(?:缴纳|支付).{0,12}(?:保费|保险)/u.test(text);
    case "education_completed":
      return /毕业|退学|(?:课程|教育).{0,24}(?:完成|结束)|不再.{0,12}(?:学费|教育费)/u.test(text);
    case "aggregate_atomically_split":
      return /(?:原子)?拆分|分项|拆成/u.test(text);
    case "temporary_third_party_coverage":
      // "暂时失业" or "临时困难" is not a payment authority.  A pause
      // requires a named/identifiable other payer or an explicit proxy-pay
      // fact, while the responsibility itself remains in force.
      return /(?:暂由|临时由).{0,28}(?:伴侣|配偶|父母|家人|子女|雇主|机构|他人|对方).{0,28}(?:代付|代缴|承担|支付)|(?:伴侣|配偶|父母|家人|子女|雇主|机构|他人|对方).{0,28}(?:暂时代付|临时代缴|暂时承担|代付|代缴)/u.test(text);
    case "responsibility_resumed":
      return /恢复.{0,20}(?:支付|缴纳|承担)|重新.{0,20}(?:支付|缴纳|承担)|不再.{0,20}(?:代付|代缴)/u.test(text);
    case "responsibility_ended":
      return /不再.{0,24}(?:承担|支付|缴纳)|(?:责任|支出|费用).{0,24}(?:结束|终止)|转由.{0,24}(?:承担|支付)/u.test(text);
    default:
      return false;
  }
}

function v4ExpenseChangeAuthorityIssue(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
  narrativeText: string;
  ageInMonths: number;
}): FinancialLedgerIssue | undefined {
  if (!isFinancialLedgerV4(input.ledger)
    || !["expense_commitment_adjusted", "expense_commitment_ended"].includes(input.proposal.kind)) return undefined;
  const payload = input.proposal.payload as Record<string, unknown>;
  const current = input.ledger.expenseCommitments.find((item) => item.id === payload.expenseCommitmentId);
  if (!current || !isExpenseCommitmentV4(current)) return undefined;
  const next = input.proposal.kind === "expense_commitment_adjusted"
    ? payload.nextCommitment
    : undefined;
  const needsAuthority = input.proposal.kind === "expense_commitment_ended"
    || (next && typeof next === "object" && isExpenseCommitmentV4(next as any) && (
      (next as any).status !== current.status
      || Number((next as any).monthlyAmountWan) < current.monthlyAmountWan - 0.0001
    ));
  if (!needsAuthority) return undefined;
  const previousCommitmentId = payload.previousCommitmentId;
  const changeReason = payload.changeReason;
  const isEnd = input.proposal.kind === "expense_commitment_ended";
  if (previousCommitmentId !== current.id || typeof changeReason !== "string" || !V4_EXPENSE_CHANGE_REASONS.has(changeReason)) {
    return proposalIssue({
      proposal: input.proposal,
      code: isEnd ? "EXPENSE_END_WITHOUT_EVIDENCE" : "EXPENSE_DOWNWARD_WITHOUT_AUTHORITY",
      summary: "V4 支出下调、暂停、恢复或结束必须保存 previousCommitmentId 和允许的变化原因",
      ageInMonths: input.ageInMonths
    });
  }
  if (isEnd && changeReason === "responsibility_resumed") {
    return proposalIssue({
      proposal: input.proposal,
      code: "EXPENSE_END_WITHOUT_EVIDENCE",
      summary: "恢复支付不是永久结束支出责任的证据",
      ageInMonths: input.ageInMonths
    });
  }
  if (!isEnd && next && typeof next === "object" && isExpenseCommitmentV4(next as any)) {
    if (current.status === "active" && (next as any).status === "paused" && changeReason !== "temporary_third_party_coverage") {
      return proposalIssue({
        proposal: input.proposal,
        code: "EXPENSE_DOWNWARD_WITHOUT_AUTHORITY",
        summary: "暂停持续支出只能由责任仍存在但暂由他方承担或付款暂时停止的事实授权",
        ageInMonths: input.ageInMonths
      });
    }
    if (current.status === "paused" && (next as any).status === "active" && changeReason !== "responsibility_resumed") {
      return proposalIssue({
        proposal: input.proposal,
        code: "EXPENSE_DOWNWARD_WITHOUT_AUTHORITY",
        summary: "恢复持续支出必须由主角恢复承担的事实授权",
        ageInMonths: input.ageInMonths
      });
    }
  }
  const evidenceText = `${input.proposal.evidence} ${input.narrativeText}`;
  if (!changeReasonHasAcceptedEvidence(changeReason, evidenceText)) {
    return proposalIssue({
      proposal: input.proposal,
      code: isEnd ? "EXPENSE_END_WITHOUT_EVIDENCE" : "EXPENSE_DOWNWARD_WITHOUT_AUTHORITY",
      summary: `支出变化原因 ${changeReason} 缺少 Accepted outcome 的明确证据；收入、退休、时间经过或模型未再提及不能降低支出`,
      ageInMonths: input.ageInMonths
    });
  }
  return undefined;
}

const COLLECTIVE_EXPENSE_RESPONSIBILITY = /(?:你们|我们|双方|两人|(?:你|我)(?!们)(?:与|和|跟|同)(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友|家人|亲属|兄弟姐妹|姐姐|哥哥|弟弟|妹妹|朋友|同事)|共同|轮流|各自|各半|一人一半|平摊|对半)/u;
const PERSONAL_EXPENSE_RESPONSIBILITY_ACTOR = /(?:你(?!们)|我(?!们)|主角|本人)/u;

function v4ExpenseCommitmentFromProposal(proposal: FinancialEventProposal): ExpenseCommitmentV4 | undefined {
  if (proposal.kind !== "expense_commitment_started" && proposal.kind !== "expense_commitment_adjusted") return undefined;
  const payload = proposal.payload as Record<string, unknown>;
  const commitment = proposal.kind === "expense_commitment_started" ? payload : payload.nextCommitment;
  return commitment && typeof commitment === "object" && isExpenseCommitmentV4(commitment as any)
    ? commitment as ExpenseCommitmentV4
    : undefined;
}

function evidenceContainsExpenseAmount(text: string, amountWan: number): boolean {
  if (!Number.isFinite(amountWan) || amountWan <= 0) return false;
  const normalized = text.normalize("NFKC").replace(/\s+/gu, "");
  const wanCandidates = new Set([
    String(amountWan),
    amountWan.toFixed(1),
    amountWan.toFixed(2),
    amountWan.toFixed(4)
  ]);
  if ([...wanCandidates].some((candidate) => {
    const trimmed = candidate.replace(/(\.\d*?[1-9])0+$|\.0+$/u, "$1");
    return normalized.includes(`${trimmed}万`);
  })) return true;
  return normalized.includes(`${Math.round(amountWan * 10000)}元`);
}

function evidenceStatesProtagonistShare(input: {
  evidence: string;
  commitment: ExpenseCommitmentV4;
}): boolean {
  const { evidence, commitment } = input;
  const directlyStatesPersonalAmount = PERSONAL_EXPENSE_RESPONSIBILITY_ACTOR.test(evidence)
    && /(?:承担|支付|负担|缴纳|转给|转向|付(?:了)?|出(?:了)?)/u.test(evidence)
    && evidenceContainsExpenseAmount(evidence, commitment.monthlyAmountWan);
  if (directlyStatesPersonalAmount) return true;
  if (commitment.grossMonthlyAmountWan === undefined || commitment.householdShareRate === undefined
    || !evidenceContainsExpenseAmount(evidence, commitment.grossMonthlyAmountWan)) return false;
  const rate = commitment.householdShareRate;
  if (Math.abs(rate - 0.5) <= 0.0001 && /各半|对半|一人一半|平摊/u.test(evidence)) return true;
  const percentageMatches = [...evidence.matchAll(/(?:你(?!们)|我(?!们)|主角|本人)[^。！？；]{0,24}(?:承担|负责|支付|负担)?[^。！？；]{0,12}(\d+(?:\.\d+)?)\s*%/gu)];
  return percentageMatches.some((match) => Math.abs(Number(match[1]) / 100 - rate) <= 0.0001);
}

/**
 * The model controls neither household allocation nor the meaning of a
 * collective sentence.  A total shared bill can enter this ledger only after
 * the evidence demonstrates the protagonist's exact share; relabelling that
 * total as a personal commitment is not evidence.
 */
function v4ExpenseResponsibilityOwnershipIssue(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
  ageInMonths: number;
  isSystemReconciliation: boolean;
}): FinancialLedgerIssue | undefined {
  if (!isFinancialLedgerV4(input.ledger) || input.isSystemReconciliation) return undefined;
  const commitment = v4ExpenseCommitmentFromProposal(input.proposal);
  if (!commitment) return undefined;
  const collectiveEvidence = COLLECTIVE_EXPENSE_RESPONSIBILITY.test(input.proposal.evidence);
  if (!collectiveEvidence) return undefined;
  if (evidenceStatesProtagonistShare({ evidence: input.proposal.evidence, commitment })) return undefined;
  return proposalIssue({
    proposal: input.proposal,
    code: "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT",
    summary: "共同责任正文只说明家庭或多人总额，未证明主角的确切月承担额；不得以 personal/shared_household 标签把总额计入个人账本",
    ageInMonths: input.ageInMonths
  });
}

function isValidSystemExpenseResponsibilityReconciliation(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
}): boolean {
  const { proposal } = input;
  if ((proposal.systemGenerated !== "expense_responsibility_reconciliation"
      && proposal.systemGenerated !== "expense_world_delta_reconciliation")
    || !proposal.id.startsWith("system_expense_")
    || !proposal.sourceOutcomeId
    || proposal.confidence !== 1
    || !isFinancialLedgerV4(input.ledger)) return false;
  if (proposal.kind === "expense_commitment_started") {
    return proposal.id.startsWith("system_expense_start_") && isExpenseCommitmentV4(proposal.payload as any);
  }
  const payload = proposal.payload as Record<string, unknown>;
  const commitmentId = typeof payload.expenseCommitmentId === "string" ? payload.expenseCommitmentId : undefined;
  const current = input.ledger.expenseCommitments.find((item) => item.id === commitmentId);
  if (!current || !isExpenseCommitmentV4(current)) return false;
  if (proposal.kind === "expense_commitment_adjusted") {
    return proposal.id.startsWith("system_expense_adjust_")
      && isExpenseCommitmentV4(payload.nextCommitment as any)
      && (payload.nextCommitment as ExpenseCommitmentV4).id === current.id;
  }
  return proposal.kind === "expense_commitment_ended" && proposal.id.startsWith("system_expense_end_");
}

function sameParticipantIds(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = [...new Set(left || [])].sort();
  const normalizedRight = [...new Set(right || [])].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((item, index) => item === normalizedRight[index]);
}

/**
 * A contextual care uplift is intentionally narrower than ordinary
 * reconciliation. It is the second validator boundary after the reconciler:
 * starting from one active, parent-beneficiary elder-care account, it may
 * only increase its unknown policy amount and append policy metadata. It
 * cannot become a back door for a scope, recipient, status, or known-amount
 * mutation merely by carrying a system-generated marker.
 */
function isValidSystemContextualCareUplift(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
}): boolean {
  const { proposal } = input;
  if (proposal.systemGenerated !== "expense_contextual_care_uplift"
    || proposal.kind !== "expense_commitment_adjusted"
    || !proposal.id.startsWith("system_expense_adjust_")
    || proposal.financialScope !== "personal"
    || !proposal.sourceOutcomeId
    || proposal.confidence !== 1
    || !isFinancialLedgerV4(input.ledger)) return false;
  const payload = proposal.payload as Record<string, unknown>;
  if ("previousCommitmentId" in payload || "changeReason" in payload) return false;
  const commitmentId = typeof payload.expenseCommitmentId === "string" ? payload.expenseCommitmentId : undefined;
  const current = input.ledger.expenseCommitments.find((item) => item.id === commitmentId);
  const next = payload.nextCommitment;
  if (!current || !isExpenseCommitmentV4(current) || !isExpenseCommitmentV4(next as any)) return false;
  const refined = next as ExpenseCommitmentV4;
  return current.status === "active"
    && current.financialScope === "personal"
    && current.responsibilityKind === "elder_care"
    && parentElderCareCoverageRole(current) !== undefined
    && current.factStatus === "needs_review"
    && current.amountBasis === "contextual_estimate"
    && refined.id === current.id
    && refined.responsibilityKey === current.responsibilityKey
    && refined.responsibilityKind === current.responsibilityKind
    && refined.type === current.type
    && refined.displayName === current.displayName
    && refined.financialScope === current.financialScope
    && refined.status === current.status
    && refined.activeFromAgeInMonths === current.activeFromAgeInMonths
    && refined.grossMonthlyAmountWan === current.grossMonthlyAmountWan
    && refined.confirmedMonthlyAmountWan === current.confirmedMonthlyAmountWan
    && refined.householdShareRate === current.householdShareRate
    && refined.lastConfirmedAtAgeInMonths === current.lastConfirmedAtAgeInMonths
    && sameParticipantIds(refined.participantPersonIds, current.participantPersonIds)
    && refined.factStatus === "needs_review"
    && refined.amountBasis === "contextual_estimate"
    && refined.accrualReviewStatus === "conservative"
    && refined.monthlyAmountWan > current.monthlyAmountWan + 0.0001
    && refined.estimationPolicyId === "expense-estimation-policy-v2"
    && refined.lastReviewedAtAgeInMonths === proposal.effectiveAtAgeInMonths
    && (refined.nextReviewAtAgeInMonths || 0) > proposal.effectiveAtAgeInMonths
    && current.amountSourceIds.every((sourceId) => refined.amountSourceIds.includes(sourceId))
    && refined.amountSourceIds.some((sourceId) => sourceId.includes(":contextual-uplift:"))
    && refined.evidence.some((item) => (
      item.source === "system_policy" && item.reasonCode === "EXPENSE_CONTEXTUAL_UPLIFT_ELEVATED_CARE"
    ));
}

function acceptedEvent(
  proposal: FinancialEventProposal,
  evidenceReason: EvidenceMatchReason,
  expenseConfirmation?: ExpenseConfirmationValidationResult
): AcceptedFinancialEvent {
  const payload = proposal.confidence < 0.8
    ? markEstimatedFacts(proposal.payload)
    : structuredClone(proposal.payload);
  if (proposal.kind === "asset_purchased" && payload && typeof payload === "object") {
    const purchase = payload as Record<string, unknown>;
    const linkedId = purchase.linkedDebtDrawEventId;
    if (typeof linkedId === "string" && !linkedId.startsWith("accepted_")) {
      // Proposal dependencies are expressed with Proposal IDs. Once accepted,
      // the reducer's atomicity check must reference the corresponding Event ID.
      purchase.linkedDebtDrawEventId = `accepted_${linkedId}`;
    }
  }
  const event = {
    id: `accepted_${proposal.id}`,
    proposalId: proposal.id,
    kind: proposal.kind,
    effectiveAtAgeInMonths: proposal.effectiveAtAgeInMonths,
    payload: payload as FinancialEventPayloadMap[FinancialEventKind],
    evidence: [{
      source: proposal.systemGenerated === "expense_lifecycle_review" ? "system_policy" : "accepted_simulation_outcome",
      sourceEventId: proposal.systemGenerated === "expense_lifecycle_review" ? undefined : proposal.sourceOutcomeId,
      excerpt: proposal.evidence.trim(),
      reasonCode: evidenceReason,
      confidence: proposal.confidence,
      financialScope: proposal.financialScope ?? "personal"
    }],
    acceptedByReasonCodes: ["SCHEMA", "OUTCOME_AUTHORITY", "SUBJECT", "TEMPORAL", evidenceReason, "ACCOUNTING_INVARIANTS"],
    ...(expenseConfirmation?.disposition === "confirmed_exact"
      && expenseConfirmation.accountId
      && expenseConfirmation.resolutionKind
      ? {
          expenseConfirmationResolution: {
            disposition: "confirmed_exact" as const,
            responsibilityKey: expenseConfirmation.responsibilityKey,
            accountId: expenseConfirmation.accountId,
            targetIssueIds: expenseConfirmation.targetIssueIds,
            resolutionKind: expenseConfirmation.resolutionKind,
            matchedBindingId: expenseConfirmation.matchedBindingId
          }
        }
      : {})
  } as AcceptedFinancialEvent;
  if (event.kind === "asset_purchased") {
    const account = event.payload.assetAccount;
    if (!Array.isArray(account.evidence) || account.evidence.length === 0) {
      account.evidence = structuredClone(event.evidence);
    }
  }
  if (event.kind === "business_holding_started") {
    const holding = event.payload.businessHolding;
    if (!Array.isArray(holding.evidence) || holding.evidence.length === 0) holding.evidence = structuredClone(event.evidence);
    if (!Array.isArray(holding.business.evidence) || holding.business.evidence.length === 0) holding.business.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "business_holding_revalued" && (!Array.isArray(event.payload.valuationEvidence) || event.payload.valuationEvidence.length === 0)) {
    event.payload.valuationEvidence = structuredClone(event.evidence);
  }
  if (event.kind === "income_source_started" && (!Array.isArray(event.payload.evidence) || event.payload.evidence.length === 0)) {
    event.payload.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "income_source_adjusted" && (!Array.isArray(event.payload.nextSource.evidence) || event.payload.nextSource.evidence.length === 0)) {
    event.payload.nextSource.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "expense_commitment_started") {
    const existingEvidence = Array.isArray(event.payload.evidence) ? event.payload.evidence : [];
    event.payload.evidence = [...existingEvidence];
    for (const evidence of event.evidence) {
      if (!event.payload.evidence.some((item) => item.sourceEventId === evidence.sourceEventId
        && item.reasonCode === evidence.reasonCode
        && item.excerpt === evidence.excerpt)) event.payload.evidence.push(structuredClone(evidence));
    }
  }
  if (event.kind === "expense_commitment_adjusted") {
    const existingEvidence = Array.isArray(event.payload.nextCommitment.evidence)
      ? event.payload.nextCommitment.evidence
      : [];
    event.payload.nextCommitment.evidence = [...existingEvidence];
    for (const evidence of event.evidence) {
      if (!event.payload.nextCommitment.evidence.some((item) => item.sourceEventId === evidence.sourceEventId
        && item.reasonCode === evidence.reasonCode
        && item.excerpt === evidence.excerpt)) event.payload.nextCommitment.evidence.push(structuredClone(evidence));
    }
  }
  if (event.kind === "debt_drawn" || event.kind === "liquidity_shortfall_created") {
    const account = event.payload.debtAccount;
    if (!Array.isArray(account.evidence) || account.evidence.length === 0) {
      account.evidence = structuredClone(event.evidence);
    }
  }
  if (event.kind === "debt_restructured") {
    const account = event.payload.replacementDebtAccount;
    if (!Array.isArray(account.evidence) || account.evidence.length === 0) {
      account.evidence = structuredClone(event.evidence);
    }
  }
  return event;
}

/**
 * Automatic liquidity is an exception for an expense that the narrative says
 * has already happened and that cannot reasonably be cancelled.  The model
 * cannot opt into this path: the marker is added only after ordinary evidence
 * matching and the first explicit-funding trial have both run.
 *
 * Keep this deliberately conservative. Generic consumption and future intent
 * are repairable proposals, not system-authorised borrowing.
 */
function isIncurredEssentialOneOffExpense(
  proposal: FinancialEventProposal,
  narrativeText: string
): boolean {
  if (proposal.kind !== "one_off_expense_paid") return false;
  const evidence = proposal.evidence.trim();
  if (!evidence || !matchFinancialEvidence({ proposal, narrativeText }).matched) return false;

  const isAttemptOrFuture = /(?:尝试|试图|打算|计划|准备|考虑|申请|协商|报价|预算|尚未|还未|未能|没有|取消|可退|attempt|plan|intend|consider|apply|negotiate|not yet|cancel)/iu.test(evidence);
  if (isAttemptOrFuture) return false;
  const isCompleted = /(?:已经|已(?:经)?(?:支付|缴纳|结清|发生|产生|接受|完成)|支付了|缴纳了|花费了|住院|急诊|手术|治疗|抢救|丧葬|paid|incurred|completed|underwent|hospitali[sz]ed)/iu.test(evidence);
  const isEssential = /(?:必要|必需|无法撤回|不可撤回|医疗|医药|治疗|住院|急诊|手术|抢救|护理|丧葬|基本住房|房租|学费|教育|保险|抚养|赡养|essential|necessary|unavoidable|medical|hospital|surgery|funeral|tuition|insurance|dependent care)/iu.test(evidence);
  return isCompleted && isEssential;
}

function markSystemShortfallAllowed(event: AcceptedFinancialEvent): AcceptedFinancialEvent {
  return {
    ...event,
    // This field is intentionally absent from Proposal. It is validator-owned.
    liquidityTreatment: "allow_system_shortfall",
    acceptedByReasonCodes: [...event.acceptedByReasonCodes, "INCURRED_ESSENTIAL_EXPENSE"]
  } as AcceptedFinancialEvent;
}

function dependentProposalIds(proposal: FinancialEventProposal): string[] {
  const payload = proposal.payload as Record<string, unknown> | undefined;
  if (proposal.kind === "asset_purchased" && typeof payload?.linkedDebtDrawEventId === "string") {
    return [payload.linkedDebtDrawEventId];
  }
  return [];
}

function proposalGroups(proposals: FinancialEventProposal[], ledger: FinancialLedger): FinancialEventProposal[][] {
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const parent = new Map(proposals.map((proposal) => [proposal.id, proposal.id]));
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const proposal of proposals) {
    for (const dependencyId of dependentProposalIds(proposal)) {
      if (byId.has(dependencyId)) union(proposal.id, dependencyId);
    }
  }
  const activeCareerIncomeIds = new Set(ledger.incomeSources
    .filter((source) => source.status === "active" && Boolean(source.linkedCareerStateId))
    .map((source) => source.id));
  const wageStarts = proposals.filter((proposal) => proposal.kind === "income_source_started" && ["salary", "contract", "self_employment_draw"].includes(String((proposal.payload as Record<string, unknown>)?.type)));
  const careerIncomeClosures = proposals.filter((proposal) => (
    (proposal.kind === "income_source_ended" || proposal.kind === "income_source_paused")
    && activeCareerIncomeIds.has(String((proposal.payload as Record<string, unknown>)?.incomeSourceId))
  ));
  for (const start of wageStarts) {
    for (const closure of careerIncomeClosures) union(start.id, closure.id);
  }
  // A parent-care aggregate may turn into named component responsibilities
  // only as one reducer transaction. Group the verified aggregate end with
  // the component starts so model ordering cannot leave an intermediate
  // aggregate + individual ledger state.
  const aggregateSplitEnds = proposals.filter((proposal) => isAggregateAtomicSplitEnd({ proposal, ledger }));
  const individualElderCareUpserts = proposals.filter((proposal) => {
    const mutation = elderCareProposalMutation({ proposal, ledger });
    return mutation?.operation !== "end" && mutation?.role === "individual";
  });
  for (const end of aggregateSplitEnds) {
    for (const individual of individualElderCareUpserts) union(end.id, individual.id);
  }
  const grouped = new Map<string, FinancialEventProposal[]>();
  for (const proposal of proposals) {
    const root = find(proposal.id);
    grouped.set(root, [...(grouped.get(root) || []), proposal]);
  }
  const priority = (proposal: FinancialEventProposal) => {
    if (proposal.kind === "expense_commitment_ended") return 0;
    if (proposal.kind === "debt_drawn" || proposal.kind === "liquidity_shortfall_created") return 1;
    return 2;
  };
  return [...grouped.values()]
    .map((group) => [...group].sort((left, right) => priority(left) - priority(right)))
    .sort((left, right) => {
      const ageDifference = Math.min(...left.map((proposal) => proposal.effectiveAtAgeInMonths))
        - Math.min(...right.map((proposal) => proposal.effectiveAtAgeInMonths));
      if (ageDifference !== 0) return ageDifference;
      return Math.min(...left.map(priority)) - Math.min(...right.map(priority));
    });
}

/**
 * V4 records a stable source id for every recurring amount.  A source may be
 * updated on its own responsibility, but it must not become a second active
 * personal commitment in the same prospective ledger.  Split facts receive
 * distinct allocation ids (for example `transfer:medical` and
 * `transfer:support`) before reaching this check.
 */
function v4ExpenseMutation(proposal: FinancialEventProposal): {
  accountId: string;
  amountSourceIds: string[];
} | undefined {
  if (proposal.kind !== "expense_commitment_started" && proposal.kind !== "expense_commitment_adjusted") return undefined;
  const payload = proposal.payload as Record<string, unknown>;
  const commitment = proposal.kind === "expense_commitment_started"
    ? payload
    : payload.nextCommitment;
  if (!commitment || typeof commitment !== "object" || !isExpenseCommitmentV4(commitment as any)) return undefined;
  const accountId = proposal.kind === "expense_commitment_started"
    ? (commitment as { id: string }).id
    : payload.expenseCommitmentId;
  return typeof accountId === "string"
    ? { accountId, amountSourceIds: (commitment as { amountSourceIds: string[] }).amountSourceIds }
    : undefined;
}

type ElderCareCoverageRole = ParentElderCareCoverageRole;
type ElderCareMutationOperation = "upsert" | "end";

interface ElderCareProposalMutation {
  proposal: FinancialEventProposal;
  role: ElderCareCoverageRole;
  responsibilityKey: string;
  commitmentId?: string;
  operation: ElderCareMutationOperation;
}

function elderCareCoverageRole(commitment: ExpenseCommitmentV4): ElderCareCoverageRole | undefined {
  return parentElderCareCoverageRole(commitment);
}

function elderCareProposalMutation(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
}): ElderCareProposalMutation | undefined {
  if (!isFinancialLedgerV4(input.ledger)) return undefined;
  const { proposal } = input;
  if (proposal.kind === "expense_commitment_ended") {
    const payload = proposal.payload as Record<string, unknown>;
    const commitmentId = typeof payload.expenseCommitmentId === "string" ? payload.expenseCommitmentId : undefined;
    const current = input.ledger.expenseCommitments.find((item) => item.id === commitmentId);
    if (!current || !isExpenseCommitmentV4(current)) return undefined;
    const role = elderCareCoverageRole(current);
    return role ? { proposal, role, responsibilityKey: current.responsibilityKey, commitmentId, operation: "end" } : undefined;
  }
  const commitment = v4ExpenseCommitmentFromProposal(proposal);
  if (!commitment || commitment.status === "ended") return undefined;
  const role = elderCareCoverageRole(commitment);
  return role ? {
    proposal,
    role,
    responsibilityKey: commitment.responsibilityKey,
    commitmentId: proposal.kind === "expense_commitment_adjusted"
      ? (proposal.payload as Record<string, unknown>).expenseCommitmentId as string | undefined
      : commitment.id,
    operation: "upsert"
  } : undefined;
}

function isAggregateAtomicSplitEnd(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
}): boolean {
  const mutation = elderCareProposalMutation(input);
  if (!mutation || mutation.operation !== "end" || mutation.role !== "aggregate") return false;
  const payload = input.proposal.payload as Record<string, unknown>;
  return payload.previousCommitmentId === mutation.commitmentId
    && payload.changeReason === "aggregate_atomically_split"
    && /(?:原子)?拆分|分项|拆成/u.test(input.proposal.evidence);
}

/**
 * This preflight covers direct Accepted proposals in the same node. The
 * reconciler already prevents derived overlap; model starts still need this
 * check before their first ledger write. A paused aggregate remains a live
 * coverage responsibility and therefore also blocks a component start.
 */
function directElderCareCoverageAtomicity(input: {
  proposals: FinancialEventProposal[];
  ledger: FinancialLedger;
  ageInMonths: number;
}): { rejectedProposalIds: Set<string>; issues: FinancialLedgerIssue[] } {
  const rejectedProposalIds = new Set<string>();
  const issues: FinancialLedgerIssue[] = [];
  if (!isFinancialLedgerV4(input.ledger)) return { rejectedProposalIds, issues };
  const mutations = input.proposals
    .map((proposal) => elderCareProposalMutation({ proposal, ledger: input.ledger }))
    .filter((mutation): mutation is ElderCareProposalMutation => Boolean(mutation));
  const issueByProposalId = new Set<string>();
  const reject = (mutationsToReject: ElderCareProposalMutation[], summary: string, relatedAccountIds: string[] = []) => {
    for (const mutation of mutationsToReject) {
      rejectedProposalIds.add(mutation.proposal.id);
      if (issueByProposalId.has(mutation.proposal.id)) continue;
      const next = proposalIssue({
        proposal: mutation.proposal,
        code: "EXPENSE_DUPLICATE_RESPONSIBILITY",
        summary,
        ageInMonths: input.ageInMonths
      });
      if (relatedAccountIds.length > 0) {
        next.relatedAccountIds = [...new Set([...(next.relatedAccountIds || []), ...relatedAccountIds])];
      }
      issues.push(next);
      issueByProposalId.add(mutation.proposal.id);
    }
  };

  const aggregateUpserts = mutations.filter((mutation) => mutation.operation === "upsert" && mutation.role === "aggregate");
  const individualUpserts = mutations.filter((mutation) => mutation.operation === "upsert" && mutation.role === "individual");
  const existingAggregate = input.ledger.expenseCommitments.find((commitment) => (
    commitment.status !== "ended" && isExpenseCommitmentV4(commitment) && elderCareCoverageRole(commitment) === "aggregate"
  ));
  const existingIndividuals = input.ledger.expenseCommitments.filter((commitment) => (
    commitment.status !== "ended" && isExpenseCommitmentV4(commitment) && elderCareCoverageRole(commitment) === "individual"
  ));
  const validAggregateSplitEnd = existingAggregate
    ? mutations.find((mutation) => mutation.operation === "end"
      && mutation.role === "aggregate"
      && mutation.commitmentId === existingAggregate.id
      && isAggregateAtomicSplitEnd({ proposal: mutation.proposal, ledger: input.ledger }))
    : undefined;

  if (aggregateUpserts.length > 0 && individualUpserts.length > 0) {
    reject(
      [...aggregateUpserts, ...individualUpserts],
      "同一节点不能新建父母聚合照护与个人照护账户；必须只保留一种覆盖方式",
      [...(existingAggregate ? [existingAggregate.id] : []), ...existingIndividuals.map((item) => item.id)]
    );
  }
  if (existingAggregate && individualUpserts.length > 0 && !validAggregateSplitEnd) {
    reject(
      individualUpserts,
      `父母聚合照护 ${existingAggregate.id} 仍为 ${existingAggregate.status}；新建个人照护前必须同批以 aggregate_atomically_split 结束聚合账户`,
      [existingAggregate.id]
    );
  }
  if (existingIndividuals.length > 0 && aggregateUpserts.length > 0) {
    reject(
      aggregateUpserts,
      "已存在个人父母照护账户时不得新建聚合照护账户；反向合并需要单独的已接受迁移语义",
      existingIndividuals.map((item) => item.id)
    );
  }
  return { rejectedProposalIds, issues };
}

function activeExpenseAmountSourceOwners(ledger: FinancialLedger): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  if (!isFinancialLedgerV4(ledger)) return owners;
  for (const commitment of ledger.expenseCommitments) {
    if (commitment.status !== "active") continue;
    for (const sourceId of commitment.amountSourceIds) {
      const sourceOwners = owners.get(sourceId) || new Set<string>();
      sourceOwners.add(commitment.id);
      owners.set(sourceId, sourceOwners);
    }
  }
  return owners;
}

function replaceExpenseAmountSourceOwner(input: {
  owners: Map<string, Set<string>>;
  accountId: string;
  amountSourceIds: string[];
}): void {
  for (const [sourceId, owners] of input.owners.entries()) {
    owners.delete(input.accountId);
    if (owners.size === 0) input.owners.delete(sourceId);
  }
  for (const sourceId of input.amountSourceIds) {
    const owners = input.owners.get(sourceId) || new Set<string>();
    owners.add(input.accountId);
    input.owners.set(sourceId, owners);
  }
}

function proposalExpenseCommitment(proposal: FinancialEventProposal): ExpenseCommitmentV4 | undefined {
  if (proposal.kind === "expense_commitment_started") {
    return isExpenseCommitmentV4(proposal.payload as any) ? proposal.payload as ExpenseCommitmentV4 : undefined;
  }
  if (proposal.kind !== "expense_commitment_adjusted") return undefined;
  const next = (proposal.payload as Record<string, unknown>)?.nextCommitment;
  return isExpenseCommitmentV4(next as any) ? next as ExpenseCommitmentV4 : undefined;
}

function exactExpenseConfirmationAttempt(input: {
  proposal: FinancialEventProposal;
  ledger: FinancialLedger;
  narrativeText: string;
  sourceNodeId: string;
  sourceOutcomeId?: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}): { proposal: FinancialEventProposal; result: ExpenseConfirmationValidationResult } | undefined {
  if (!isFinancialLedgerV4(input.ledger) || input.proposal.systemGenerated) return undefined;
  const commitment = proposalExpenseCommitment(input.proposal);
  if (!commitment) return undefined;
  const claimsExact = commitment.factStatus === "known"
    || commitment.amountBasis === "explicit_known"
    || commitment.amountBasis === "explicit_shared_amount"
    || (input.proposal.payload as Record<string, unknown>)?.changeReason === "estimate_superseded_by_exact_fact";
  if (!claimsExact) return undefined;

  const bindings = bindNarrativeExpenseFacts({
    sourceNodeId: input.sourceNodeId,
    sourceOutcomeId: input.sourceOutcomeId,
    narrativeText: input.narrativeText,
    existingExpenseCommitments: input.ledger.expenseCommitments
  });
  const compatible = bindings.bindings.filter((binding) => (
    binding.responsibilityKind === commitment.responsibilityKind
    && binding.proposedType === commitment.type
    && (binding.liability === "protagonist" || binding.liability === "shared")
    && binding.protagonistShareWan !== undefined
  ));
  const binding = compatible.find((item) => item.responsibilityKey === commitment.responsibilityKey)
    || (compatible.length === 1 ? compatible[0] : undefined);
  const fallbackResult: ExpenseConfirmationValidationResult = {
    disposition: "blocked",
    observationId: `expense_observation_${input.proposal.id}`,
    proposalId: input.proposal.id,
    responsibilityKey: commitment.responsibilityKey,
    accountId: commitment.id,
    reasonCodes: ["EXPENSE_CONFIRMATION_BINDING_REQUIRED"],
    targetIssueIds: []
  };
  if (!binding || !binding.amountSourceId || !binding.amountSpan || !input.sourceOutcomeId) {
    return { proposal: input.proposal, result: fallbackResult };
  }

  const adjustmentAccountId = input.proposal.kind === "expense_commitment_adjusted"
    ? String((input.proposal.payload as Record<string, unknown>).expenseCommitmentId || "")
    : undefined;
  const adjustmentAccount = adjustmentAccountId
    ? input.ledger.expenseCommitments.find((item) => item.id === adjustmentAccountId && item.status !== "ended")
    : undefined;
  const genericParentHealthcareAlias = binding.responsibilityKind === "recurring_healthcare"
    && ["opening_parent", "parents", "parent", "person_parent_unspecified"].includes(
      binding.responsibilityKey.replace(/^recurring_healthcare:/u, "")
    );
  const canonicalParentHealthcareTargets = genericParentHealthcareAlias
    ? input.ledger.expenseCommitments.filter((item) => (
        item.status !== "ended"
        && item.responsibilityKind === "recurring_healthcare"
        && ["recurring_healthcare:opening_parent", "recurring_healthcare:parents"].includes(String(item.responsibilityKey))
      ))
    : [];
  const confirmationBinding = adjustmentAccount
    && canonicalParentHealthcareTargets.length === 1
    && canonicalParentHealthcareTargets[0].id === adjustmentAccount.id
    ? {
        ...binding,
        responsibilityKey: adjustmentAccount.responsibilityKey,
        participantPersonIds: adjustmentAccount.participantPersonIds?.length
          ? adjustmentAccount.participantPersonIds
          : binding.participantPersonIds
      }
    : binding;

  const cadence = confirmationBinding.cadence === "annual" ? "annual" : "monthly";
  const cadenceMultiplier = cadence === "annual" ? 12 : 1;
  const observation: ExpenseAmountObservation = {
    id: `expense_observation_${input.proposal.id}`,
    authoritySourceKind: "direct_financial_proposal",
    authoritySourceId: input.proposal.id,
    sourceOutcomeId: input.sourceOutcomeId,
    expenseCommitmentId: input.proposal.kind === "expense_commitment_adjusted"
      ? String((input.proposal.payload as Record<string, unknown>).expenseCommitmentId || commitment.id)
      : undefined,
    responsibilityKey: confirmationBinding.responsibilityKey,
    responsibilityKind: confirmationBinding.responsibilityKind,
    proposedType: confirmationBinding.proposedType,
    statementKind: "exact",
    cadence,
    payer: confirmationBinding.liability as "protagonist" | "shared",
    financialScope: confirmationBinding.financialScope,
    protagonistAmountWan: confirmationBinding.protagonistShareWan! * cadenceMultiplier,
    grossAmountWan: confirmationBinding.explicitMonthlyTotalWan === undefined
      ? undefined
      : confirmationBinding.explicitMonthlyTotalWan * cadenceMultiplier,
    householdShareRate: confirmationBinding.shareRate,
    effectiveAtAgeInMonths: input.proposal.effectiveAtAgeInMonths,
    amountSourceId: confirmationBinding.amountSourceId!,
    evidenceFingerprint: confirmationBinding.evidenceFingerprint,
    bindingId: confirmationBinding.id,
    evidenceAnchor: {
      kind: "final_narrative_span",
      ...confirmationBinding.amountSpan!,
      fingerprint: confirmationBinding.evidenceFingerprint
    }
  };
  const targetIssueIds = input.ledger.unresolvedIssues.filter((issue) => (
    issue.status !== "resolved"
    && (issue.expenseResponsibilityKey === confirmationBinding.responsibilityKey
      || (issue.relatedAccountIds || []).includes(commitment.id))
    && (!issue.expenseResolutionKind
      || issue.expenseResolutionKind === "exact_amount"
      || issue.expenseResolutionKind === "shared_allocation")
  )).map((issue) => issue.id);
  // A new model-authored account ID is transport data, but the responsibility
  // identity is domain-owned. For a start with one unambiguous bound fact,
  // canonicalize the key before confirmation; an adjustment must retain the
  // existing ledger identity and is never rewritten here.
  const proposalForConfirmation = structuredClone(input.proposal);
  if (proposalForConfirmation.kind === "expense_commitment_started") {
    proposalForConfirmation.payload = {
      ...(proposalForConfirmation.payload as Record<string, unknown>),
      responsibilityKey: confirmationBinding.responsibilityKey,
      responsibilityKind: confirmationBinding.responsibilityKind,
      type: confirmationBinding.proposedType,
      financialScope: confirmationBinding.financialScope,
      participantPersonIds: confirmationBinding.participantPersonIds
    };
  }
  const result = validateExpenseConfirmation({
    observation,
    proposal: proposalForConfirmation,
    previousLedger: input.ledger,
    currentAcceptedAuthority: {
      sourceNodeId: input.sourceNodeId,
      sourceOutcomeId: input.sourceOutcomeId,
      acceptedUserFactIds: [],
      acceptedDirectProposalIds: [input.proposal.id],
      acceptedWorldDeltaIds: [],
      periodStartAgeInMonths: input.periodStartAgeInMonths,
      periodEndAgeInMonths: input.periodEndAgeInMonths
    },
    finalNarrativeText: input.narrativeText,
    periodStartAgeInMonths: input.periodStartAgeInMonths,
    periodEndAgeInMonths: input.periodEndAgeInMonths,
    bindings: bindings.bindings.map((item) => item.id === binding.id ? confirmationBinding : item),
    targetIssueIds
  });
  if (result.disposition !== "confirmed_exact" || !result.canonicalConfirmation) {
    return { proposal: input.proposal, result };
  }
  const canonical = result.canonicalConfirmation;
  const nextCommitment: ExpenseCommitmentV4 = {
    ...structuredClone(commitment),
    factStatus: canonical.factStatus,
    amountBasis: canonical.amountBasis,
    monthlyAmountWan: canonical.monthlyAmountWan,
    confirmedMonthlyAmountWan: canonical.confirmedMonthlyAmountWan,
    ...(canonical.grossMonthlyAmountWan === undefined
      ? { grossMonthlyAmountWan: undefined, householdShareRate: undefined }
      : {
          grossMonthlyAmountWan: canonical.grossMonthlyAmountWan,
          householdShareRate: canonical.householdShareRate
        }),
    amountSourceIds: [...new Set([...commitment.amountSourceIds, observation.amountSourceId])],
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: canonical.confirmedAtAgeInMonths,
    lastReviewedAtAgeInMonths: canonical.confirmedAtAgeInMonths,
    nextReviewAtAgeInMonths: canonical.confirmedAtAgeInMonths
      + expenseReviewIntervalMonths(commitment.responsibilityKind)
  };
  const proposal = proposalForConfirmation;
  proposal.financialScope = confirmationBinding.financialScope;
  proposal.payload = proposal.kind === "expense_commitment_started"
    ? nextCommitment
    : { ...(proposal.payload as Record<string, unknown>), nextCommitment };
  return { proposal, result };
}

export function validateFinancialProposals(input: {
  proposals: FinancialEventProposal[];
  currentLedger: FinancialLedger;
  currentCareerState: CareerState;
  acceptedOutcomeId?: string;
  narrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  simulationTransactionId: string;
  allowedCareerStateIds?: string[];
  liquidityPolicy?: LiquidityPolicy;
  enforceExpenseConfirmation?: boolean;
}): { acceptedEvents: AcceptedFinancialEvent[]; issues: FinancialLedgerIssue[]; expenseConfirmationResults?: ExpenseConfirmationValidationResult[] } {
  const issues: FinancialLedgerIssue[] = [];
  const acceptedEvents: AcceptedFinancialEvent[] = [];
  const acceptedProposals: FinancialEventProposal[] = [];
  const expenseConfirmationResults: ExpenseConfirmationValidationResult[] = [];
  const ids = new Set<string>();
  const allowedCareerStateIds = new Set([input.currentCareerState.id, ...(input.allowedCareerStateIds || [])]);
  const expenseAmountSourceOwners = activeExpenseAmountSourceOwners(input.currentLedger);

  for (const submittedProposal of input.proposals) {
    let proposal = submittedProposal;
    let expenseConfirmation: ExpenseConfirmationValidationResult | undefined;
    if (!proposal.id || ids.has(proposal.id) || !FINANCIAL_EVENT_KINDS.has(proposal.kind) || !proposal.payload || typeof proposal.payload !== "object") {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal schema 无效或 id 重复", ageInMonths: input.periodEndAgeInMonths }));
      continue;
    }
    ids.add(proposal.id);
    if (input.enforceExpenseConfirmation) {
      const attempted = exactExpenseConfirmationAttempt({
        proposal,
        ledger: input.currentLedger,
        narrativeText: input.narrativeText,
        sourceNodeId: input.simulationTransactionId,
        sourceOutcomeId: input.acceptedOutcomeId,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths
      });
      if (attempted) {
        expenseConfirmation = attempted.result;
        expenseConfirmationResults.push(attempted.result);
        if (attempted.result.disposition !== "confirmed_exact") {
          issues.push({
            ...proposalIssue({
              proposal,
              code: "PENDING_FACT",
              summary: `支出精确事实未通过权威确认：${attempted.result.reasonCodes.join("、")}`,
              ageInMonths: proposal.effectiveAtAgeInMonths
            }),
            severity: "blocking",
            relatedAccountIds: attempted.result.accountId ? [attempted.result.accountId] : [],
            expenseResolutionKind: proposal.financialScope === "shared_household"
              ? "shared_allocation"
              : "exact_amount",
            expenseResponsibilityKey: attempted.result.responsibilityKey
          });
          continue;
        }
        proposal = attempted.proposal;
      }
    }
    const schemaErrors = validateFinancialPayloadSchema(proposal.kind, proposal.payload);
    if (schemaErrors.length > 0) {
      const invalidAssetType = proposal.kind === "asset_purchased"
        && schemaErrors.some((error) => error.path === "payload.assetAccount.type");
      const invalidPersonalIncomeType = proposal.kind === "income_source_started"
        && schemaErrors.some((error) => error.path === "payload.type");
      const invalidExpenseSchema = proposal.kind === "expense_commitment_started"
        || proposal.kind === "expense_commitment_adjusted";
      const mortgageMisroutedAsExpense = invalidExpenseSchema
        && schemaErrors.some((error) => error.path.endsWith(".type"))
        && /(?:月供|房贷|按揭|mortgage)/iu.test(`${proposal.evidence} ${JSON.stringify(proposal.payload)}`);
      issues.push(proposalIssue({
        proposal,
        code: invalidAssetType
          ? "INVALID_ASSET_TYPE"
          : invalidPersonalIncomeType
            ? "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"
            : mortgageMisroutedAsExpense
              ? "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT"
              : invalidExpenseSchema
                ? "EXPENSE_SCHEMA_FIELD_MISMATCH"
                : "UNBALANCED_TRANSACTION",
        summary: `财务 Proposal payload schema 无效：${schemaErrors.map((error) => `${error.path} ${error.reason}`).join("；")}`,
        ageInMonths: input.periodEndAgeInMonths
      }));
      continue;
    }
    if (isFinancialLedgerV4(input.currentLedger)
      && (proposal.kind === "expense_commitment_started" || proposal.kind === "expense_commitment_adjusted")) {
      const candidate = proposal.kind === "expense_commitment_adjusted"
        ? (proposal.payload as Record<string, unknown>).nextCommitment
        : proposal.payload;
      if (!candidate || typeof candidate !== "object" || !isExpenseCommitmentV4(candidate as any)) {
        issues.push(proposalIssue({
          proposal,
          code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
          summary: "V4 账本只接受包含责任键、金额依据、范围和复核时钟的 canonical 支出 payload",
          ageInMonths: input.periodEndAgeInMonths
        }));
        continue;
      }
    }
    const referenceIssue = typedReferenceIssue({ proposal, ledger: input.currentLedger, ageInMonths: proposal.effectiveAtAgeInMonths });
    if (referenceIssue) { issues.push(referenceIssue); continue; }
    const duplicateDebt = duplicateDebtBalanceDiscovery(proposal, input.currentLedger);
    if (duplicateDebt) {
      issues.push(proposalIssue({
        proposal,
        code: "UNBALANCED_TRANSACTION",
        summary: `债务账户 ${duplicateDebt.id} 已存在且余额一致；正文重复提及不能再次创建 debt_balance_discovered`,
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (!input.acceptedOutcomeId || proposal.sourceOutcomeId !== input.acceptedOutcomeId) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 未关联本轮已接受结果", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (!Number.isInteger(proposal.effectiveAtAgeInMonths)
      || proposal.effectiveAtAgeInMonths < input.periodStartAgeInMonths
      || proposal.effectiveAtAgeInMonths > input.periodEndAgeInMonths) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 生效时间不在本阶段内", ageInMonths: input.periodEndAgeInMonths }));
      continue;
    }
    const payload = proposal.payload as Record<string, unknown>;
    const v4ExpenseAuthorityIssue = v4ExpenseChangeAuthorityIssue({
      proposal,
      ledger: input.currentLedger,
      narrativeText: input.narrativeText,
      ageInMonths: proposal.effectiveAtAgeInMonths
    });
    if (v4ExpenseAuthorityIssue) {
      issues.push(v4ExpenseAuthorityIssue);
      continue;
    }
    if (thirdPartyIncomeFact(proposal)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "伴侣、父母、子女或其他人物的工资与收入不得进入主人公个人账本；只有明确转给主人公的款项才能使用家庭支持事件入账", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (restrictedProjectFundingFact(proposal)) {
      issues.push(proposalIssue({
        proposal,
        code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
        summary: "项目基金、公益资助或拨款如有学校、教师、硬件或项目运营等专款用途，即使暂时由主角收到或保管，也不得进入主角个人现金账本",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (PERSONAL_CASH_INFLOW_EVENT_KINDS.has(proposal.kind)
      && proposal.financialScope !== undefined
      && proposal.financialScope !== "personal") {
      issues.push(proposalIssue({
        proposal,
        code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
        summary: "个人现金流入不得以 business_operating、third_party 或 shared_household 范围入账；公司或第三方资金必须先在其自身范围留存，只有明确分配给主角的个人款项才能入账",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    // The deterministic reconciler may preserve a legitimate personal
    // responsibility whose evidence sentence also discusses a company.  Its
    // canonical V4 proposal has already been scope-classified by the
    // responsibility path, so do not let the broad text-only business regex
    // reject it.  A model proposal (including a forged system marker) does
    // not satisfy this predicate and remains subject to the normal boundary
    // guard below.
    const isCanonicalSystemExpenseReconciliation = isValidSystemExpenseResponsibilityReconciliation({
      proposal,
      ledger: input.currentLedger
    });
    if (["expense_commitment_started", "expense_commitment_adjusted", "one_off_expense_paid"].includes(proposal.kind)
      && businessOperatingFact(proposal)
      && !isCanonicalSystemExpenseReconciliation) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司团队工资或经营成本不得进入主人公个人支出账本", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (["expense_commitment_started", "expense_commitment_adjusted"].includes(proposal.kind)
      && proposal.financialScope === "third_party") {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_THIRD_PARTY_LIABILITY",
        summary: "第三方承担的持续支出不得写入主角个人账本",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (["income_source_started", "income_source_adjusted", "one_off_income_received"].includes(proposal.kind)
      && businessOperatingFact(proposal)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司营收、客户回款或产品年费不得进入主人公个人收入账本；只有个人工资、提款或已分配分红可以入账", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (unsupportedRecurringOtherIncome(proposal)) {
      issues.push(proposalIssue({
        proposal,
        code: "UNBALANCED_TRANSACTION",
        summary: "一次到账、首笔资助或单次结算不能推导为长期月度/年度个人收入；需要明确持续频率，或改用一次性收入事件",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (proposal.kind === "income_source_started" && payload.type === "business_dividend"
      && !hasExplicitPersonalBusinessIncomeReceipt({ type: payload.type, evidence: proposal.evidence })) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "business_dividend 必须有已向主人公分配利润的证据，不能用公司年费或营收替代", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const isSystemReview = proposal.systemGenerated === "expense_lifecycle_review";
    const isSystemWorldDeltaReconciliation = proposal.systemGenerated === "expense_world_delta_reconciliation";
    const isSystemReconciliation = proposal.systemGenerated === "expense_responsibility_reconciliation"
      || isSystemWorldDeltaReconciliation;
    const isSystemContextualCareUplift = proposal.systemGenerated === "expense_contextual_care_uplift";
    const isAnySystemReconciliation = isSystemReconciliation || isSystemContextualCareUplift;
    const proposedExpenseResponsibilityKind = proposal.kind === "expense_commitment_adjusted"
      ? String((payload.nextCommitment as Record<string, unknown> | undefined)?.responsibilityKind || "")
      : String(payload.responsibilityKind || "");
    if ((proposal.kind === "expense_commitment_started" || proposal.kind === "expense_commitment_adjusted")
      && proposedExpenseResponsibilityKind === "unclassified_core_consumption") {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: "未分类核心支出只能由确定性 Preview/Commit 余额策略生成；模型和正文 Proposal 不得直接创建或修改该账户",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (proposal.systemGenerated !== undefined && !isSystemReview && !isAnySystemReconciliation) {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: "仅允许域内生成的 expense_lifecycle_review、expense-responsibility reconciliation 或 contextual care uplift 使用系统财务 Proposal 标记",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (isSystemReview && !isValidSystemExpenseLifecycleReview({ proposal, ledger: input.currentLedger })) {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: "系统支出复核只能保持既有 V4 责任的金额和身份，并将其标记为 review_due",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (isSystemContextualCareUplift && !isValidSystemContextualCareUplift({ proposal, ledger: input.currentLedger })) {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: "系统照护估计上调只能在同一 active personal contextual parent-care 责任上严格增加金额；不得改变账户身份、范围、状态或已知金额",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (isSystemReconciliation && !isValidSystemExpenseResponsibilityReconciliation({ proposal, ledger: input.currentLedger })) {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: "系统责任对账 Proposal 必须是本轮已接受结果驱动的 canonical V4 支出开始事件",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    const ownershipIssue = v4ExpenseResponsibilityOwnershipIssue({
      proposal,
      ledger: input.currentLedger,
      ageInMonths: proposal.effectiveAtAgeInMonths,
      isSystemReconciliation: isAnySystemReconciliation
    });
    if (ownershipIssue) {
      issues.push(ownershipIssue);
      continue;
    }
    const evidenceMatch = isSystemReview
      ? { matched: true as const, reasonCode: "SYSTEM_POLICY_REVIEW" as const }
      : isSystemWorldDeltaReconciliation
        ? { matched: true as const, reasonCode: "ACCEPTED_WORLD_DELTA" as const }
        : matchFinancialEvidence({ proposal, narrativeText: input.narrativeText });
    if (!evidenceMatch.matched || !evidenceMatch.reasonCode || !Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 缺少可靠正文证据或 confidence", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (["one_off_expense_paid", "family_support_paid"].includes(proposal.kind)
      && isNarratedBeforePeriod({
        narrativeText: input.narrativeText,
        evidence: evidenceMatch.excerpt || proposal.evidence,
        periodStartAgeInMonths: input.periodStartAgeInMonths
      })) {
      issues.push(proposalIssue({
        proposal,
        code: "PENDING_FACT",
        summary: "正文明确该个人支出发生在本阶段开始前；当前没有可追溯的历史现金更正，不能伪造成本期一次性现金事件",
        ageInMonths: input.periodEndAgeInMonths
      }));
      continue;
    }
    if (!debtBalanceEvidenceSupportsPrincipal(proposal)) {
      issues.push(proposalIssue({
        proposal,
        code: "UNBALANCED_TRANSACTION",
        summary: "债务余额发现必须有正文明确余额或本金金额；不能从月供、期限或利率反推本金",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (proposal.financialScope === "business_operating" && PERSONAL_OPERATING_FLOW_KINDS.has(proposal.kind)) {
      issues.push(proposalIssue({
        proposal,
        code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
        summary: "公司营业收入、员工工资和运营成本不得作为主角个人收支入账",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    if (proposal.kind === "asset_purchased") {
      const assetAccount = payload.assetAccount as Record<string, unknown> | undefined;
      if (!assetAccount || !ASSET_TYPES.has(String(assetAccount.type))) {
        issues.push(proposalIssue({ proposal, code: "INVALID_ASSET_TYPE", summary: "资产购买包含不受支持的资产类型", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
    }
    if (proposal.kind === "expense_commitment_started") {
      const durableType = String(payload.type);
      const durableKey = typeof payload.responsibilityKey === "string" && payload.responsibilityKey
        ? payload.responsibilityKey
        : `legacy_type:${durableType}`;
      const v4Ledger = isFinancialLedgerV4(input.currentLedger);
      const existingSameType = input.currentLedger.expenseCommitments.filter((item) => {
        if (v4Ledger ? item.status === "ended" : item.status !== "active") return false;
        const existingKey = item.responsibilityKey || `legacy_type:${item.type}`;
        return existingKey === durableKey;
      });
      const onlyPolicyEstimate = !v4Ledger && existingSameType.length > 0 && existingSameType.every((item) => item.evidence.some((evidence) => evidence.source === "system_policy"
        || (evidence.source === "legacy_migration" && evidence.reasonCode === "LEGACY_FINANCIAL_STATE_MIGRATION")));
      if (existingSameType.length > 0 && !onlyPolicyEstimate) {
        const duplicateResponsibilityIssue = proposalIssue({
          proposal,
          code: "EXPENSE_DUPLICATE_RESPONSIBILITY",
          summary: `持续支出责任 ${durableKey} 已存在，必须引用现有支出 ID 使用 expense_commitment_adjusted，不能重复 started`,
          ageInMonths: proposal.effectiveAtAgeInMonths
        });
        duplicateResponsibilityIssue.relatedAccountIds = existingSameType.map((item) => item.id);
        issues.push(duplicateResponsibilityIssue);
        continue;
      }
    }
    if (proposal.kind === "business_financing_recorded" && payload.personalCashReceivedWan !== 0) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司融资不得进入个人现金", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "one_off_income_received" && ("businessHoldingId" in payload || "financingAmountWan" in payload)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司融资或公司营收不得伪装成个人一次性收入", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "income_source_started") {
      if (!PERSONAL_INCOME_SOURCE_TYPES.has(String(payload.type))) {
        issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司营业收入类型不能进入个人收入来源账本", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      const linkedCareerStateId = payload.linkedCareerStateId;
      const isCareerIncome = ["salary", "self_employment_draw"].includes(String(payload.type));
      const requiresCompletedBusinessIncomeReceipt = payload.type === "self_employment_draw" || payload.type === "business_dividend";
      const matchesAuthoritativeRelativeSalary = proposalMatchesAuthoritativeRelativeSalary({
        proposal,
        source: payload,
        ledger: input.currentLedger,
        narrativeText: input.narrativeText
      });
      if ((!personalCareerIncomeEvidenceIsExplicit(payload.type, proposal.evidence) && !matchesAuthoritativeRelativeSalary)
        || (requiresCompletedBusinessIncomeReceipt && !hasMatchingPersonalBusinessIncomeAmount({ type: payload.type, source: payload, evidence: proposal.evidence }))) {
        issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司合同额、营业收入或不匹配金额不能证明主角已经按该金额和频率领取个人工资、提款或分红", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      if (matchesAuthoritativeRelativeSalary) {
        proposal = { ...proposal, payload: markEstimatedFacts(proposal.payload) };
      }
      if (isCareerIncome && typeof linkedCareerStateId !== "string") {
        issues.push(proposalIssue({ proposal, code: "CAREER_INCOME_CONFLICT", summary: "职业收入来源必须引用当前或本轮已接受的 CareerState", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      if (typeof linkedCareerStateId === "string" && !allowedCareerStateIds.has(linkedCareerStateId)) {
        issues.push(proposalIssue({ proposal, code: "CAREER_INCOME_CONFLICT", summary: "收入来源引用了非当前或未接受的 CareerState", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
      }
      if (isCareerIncome) {
        const activeCareerSources = input.currentLedger.incomeSources.filter((source) => source.status === "active" && Boolean(source.linkedCareerStateId));
        const replacedSourceIds = new Set(input.proposals.flatMap((candidate) => {
          if (candidate.kind === "income_source_ended" || candidate.kind === "income_source_paused") {
            const id = (candidate.payload as Record<string, unknown>)?.incomeSourceId;
            return typeof id === "string" ? [id] : [];
          }
          if (candidate.kind === "income_source_adjusted") {
            const id = (candidate.payload as Record<string, unknown>)?.incomeSourceId;
            return typeof id === "string" ? [id] : [];
          }
          return [];
        }));
        const unreplaced = activeCareerSources.filter((source) => !replacedSourceIds.has(source.id));
        if (unreplaced.length > 0) {
          issues.push(proposalIssue({
            proposal,
            code: "CAREER_INCOME_CONFLICT",
            summary: `新职业收入不得与旧职业收入叠加；请调整或结束：${unreplaced.map((source) => source.id).join("、")}`,
            ageInMonths: proposal.effectiveAtAgeInMonths
          }));
          continue;
        }
      }
    }
    const adjustedIncomeSource = payload.nextSource as Record<string, unknown> | undefined;
    const adjustedIncomeType = adjustedIncomeSource?.type;
    const adjustedRequiresCompletedBusinessIncomeReceipt = adjustedIncomeType === "self_employment_draw" || adjustedIncomeType === "business_dividend";
    if (proposal.kind === "income_source_adjusted"
      && (!personalCareerIncomeEvidenceIsExplicit(adjustedIncomeType, proposal.evidence)
        || (adjustedRequiresCompletedBusinessIncomeReceipt && !hasMatchingPersonalBusinessIncomeAmount({ type: adjustedIncomeType, source: adjustedIncomeSource, evidence: proposal.evidence })))) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司合同额、营业收入或不匹配金额不能证明主角个人收入已经按该金额和频率调整", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    if (proposal.kind === "income_source_adjusted"
      && !PERSONAL_INCOME_SOURCE_TYPES.has(String((payload.nextSource as Record<string, unknown> | undefined)?.type))) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司营业收入类型不能进入个人收入来源账本", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const amount = typeof payload.amountWan === "number" ? payload.amountWan : 0;
    const plausibilityLimit = Math.max(100, Math.abs(input.currentLedger.cashAccounts.reduce((sum, account) => sum + account.balanceWan, 0)) * 5);
    if ((proposal.kind === "one_off_income_received" || proposal.kind === "one_off_expense_paid") && amount > plausibilityLimit) {
      issues.push(proposalIssue({ proposal, code: "UNSUPPORTED_LARGE_VALUE_CHANGE", summary: "通用一次性金额远超当前账本规模，需要更具体的资产、债务或企业事件", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const expenseMutation = isFinancialLedgerV4(input.currentLedger) ? v4ExpenseMutation(proposal) : undefined;
    const duplicateAmountSourceId = expenseMutation?.amountSourceIds.find((sourceId) => (
      [...(expenseAmountSourceOwners.get(sourceId) || [])].some((ownerId) => ownerId !== expenseMutation.accountId)
    ));
    if (duplicateAmountSourceId) {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_AMOUNT_SOURCE_DOUBLE_COUNT",
        summary: `持续支出金额来源 ${duplicateAmountSourceId} 已由另一项 active responsibility 使用；必须先原子拆分或提供不同的主角份额来源`,
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
      continue;
    }
    acceptedEvents.push(acceptedEvent(proposal, evidenceMatch.reasonCode, expenseConfirmation));
    acceptedProposals.push(proposal);
    if (expenseMutation) replaceExpenseAmountSourceOwner({
      owners: expenseAmountSourceOwners,
      accountId: expenseMutation.accountId,
      amountSourceIds: expenseMutation.amountSourceIds
    });
  }

  const directElderCareAtomicity = directElderCareCoverageAtomicity({
    proposals: acceptedProposals,
    ledger: input.currentLedger,
    ageInMonths: input.periodEndAgeInMonths
  });
  issues.push(...directElderCareAtomicity.issues);
  const eligibleProposals = acceptedProposals.filter((proposal) => !directElderCareAtomicity.rejectedProposalIds.has(proposal.id));
  const eligibleProposalIds = new Set(eligibleProposals.map((proposal) => proposal.id));
  const eligibleEvents = acceptedEvents.filter((event) => !event.proposalId || eligibleProposalIds.has(event.proposalId));
  const hasActiveProperty = input.currentLedger.assetAccounts.some((account) => account.status === "active" && account.type === "property");
  const hasAcceptedPropertyFact = eligibleEvents.some((event) => (
    (event.kind === "asset_purchased" || event.kind === "asset_balance_discovered")
    && event.payload.assetAccount.type === "property"
  ));
  const purchaseNarrative = /(?:首付|买下|买了|购买|购入|购置|购房|婚房)/u.test(input.narrativeText);
  const orphanPropertyPurchaseProposalIds = new Set<string>();
  if (!hasActiveProperty && !hasAcceptedPropertyFact && purchaseNarrative) {
    for (const proposal of eligibleProposals) {
      const payload = proposal.payload as Record<string, unknown>;
      const mortgageDraw = proposal.kind === "debt_drawn"
        && (payload.debtAccount as Record<string, unknown> | undefined)?.type === "mortgage";
      const downPayment = proposal.kind === "one_off_expense_paid" && /(?:首付|购房款|买房款)/u.test(proposal.evidence);
      if (!mortgageDraw && !downPayment) continue;
      orphanPropertyPurchaseProposalIds.add(proposal.id);
      issues.push(proposalIssue({
        proposal,
        code: "UNBALANCED_TRANSACTION",
        summary: "购房首付或新房贷必须与同批已通过校验的 property 资产事件一起提交，不能只记支出和债务",
        ageInMonths: proposal.effectiveAtAgeInMonths
      }));
    }
  }
  const trialProposals = eligibleProposals.filter((proposal) => !orphanPropertyPurchaseProposalIds.has(proposal.id));
  const candidatesByProposalId = new Map(eligibleEvents
    .filter((event) => !orphanPropertyPurchaseProposalIds.has(event.proposalId!))
    .map((event) => [event.proposalId!, event]));
  const acceptedAfterTrial: AcceptedFinancialEvent[] = [];
  for (const group of proposalGroups(trialProposals, input.currentLedger)) {
    const groupEvents = group.map((proposal) => candidatesByProposalId.get(proposal.id)!);
    try {
      reduceFinancialLedger({
        ledger: input.currentLedger,
        transactionId: `validation_${input.simulationTransactionId}_${acceptedAfterTrial.length}`,
        expectedLedgerRevision: input.currentLedger.revision,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths,
        events: [...acceptedAfterTrial, ...groupEvents],
        // Proposal trials are always strict. Production's broad liquidity
        // policy must never make an unfunded model proposal appear valid.
        liquidityPolicy: "require_explicit"
      });
      acceptedAfterTrial.push(...groupEvents);
    } catch (error) {
      const missingFunding = error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE";
      const mayUseSystemShortfall = missingFunding
        && group.length > 0
        && group.every((proposal) => isIncurredEssentialOneOffExpense(proposal, input.narrativeText));
      if (mayUseSystemShortfall) {
        const markedEvents = groupEvents.map(markSystemShortfallAllowed);
        try {
          reduceFinancialLedger({
            ledger: input.currentLedger,
            transactionId: `validation_essential_${input.simulationTransactionId}_${acceptedAfterTrial.length}`,
            expectedLedgerRevision: input.currentLedger.revision,
            periodStartAgeInMonths: input.periodStartAgeInMonths,
            periodEndAgeInMonths: input.periodEndAgeInMonths,
            events: [...acceptedAfterTrial, ...markedEvents],
            liquidityPolicy: "auto_shortfall_debt"
          });
          acceptedAfterTrial.push(...markedEvents);
          continue;
        } catch (secondTrialError) {
          error = secondTrialError;
        }
      }
      if (!(error instanceof FinancialLedgerInvariantError)) throw error;
      const code = error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE"
        ? "MISSING_FUNDING_SOURCE"
        : "UNBALANCED_TRANSACTION";
      for (const proposal of group) {
        issues.push(proposalIssue({
          proposal,
          code,
          summary: error instanceof Error ? error.message : "财务 Proposal 账本试算失败",
          ageInMonths: input.periodEndAgeInMonths
        }));
      }
    }
  }
  return { acceptedEvents: acceptedAfterTrial, issues, expenseConfirmationResults };
}
