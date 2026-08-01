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
  FinancialLedgerIssue
} from "./types";
import { isExpenseCommitmentV4, isFinancialLedgerV4 } from "./types";
import { matchFinancialEvidence, type EvidenceMatchReason } from "./evidenceMatching";
import { validateFinancialPayloadSchema } from "./financialProposalSchema";

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

/**
 * A salary mentioned in a job posting, an unaccepted offer, or a comparison
 * with the protagonist's present pay is an opportunity, not a personal-income
 * fact. It must not reconfirm a stale legacy wage or restart its accrual.
 *
 * Keep an explicit completed acceptance in scope: a generated node can state
 * both the accepted offer and the resulting exact salary in one sentence.
 */
export function isUnacceptedIncomeOpportunityEvidence(evidence: string): boolean {
  const completedEmployment = /(?:你|主角|本人).{0,48}(?:正式(?:入职|换(?:了)?工作|换岗|跳槽|转岗)|已经(?:入职|换(?:了)?工作|换岗|跳槽|转岗)|已(?:入职|换(?:了)?工作|换岗|跳槽|转岗)|换到[^。；]{0,24}(?:岗位|工作)|接受(?:了)?[^。；]{0,24}(?:offer|录用|岗位|工作)|签署(?:了)?[^。；]{0,24}(?:劳动合同|聘用合同)|(?:最终|已经|已)?(?:决定|选择)(?:接下|接受|入职|加入|签约)[^。；]{0,24}(?:兼职|工作|岗位|offer|录用)?)/u.test(evidence);
  if (completedEmployment) return false;
  return /(?:正在招|招聘|招募|招人|(?:新|该|这个|一个|某个|招聘的).{0,4}(?:岗位|职位)|(?:岗位|职位).{0,20}(?:招聘|招募|开放)|工作机会|猎头|offer|录用通知|薪资比(?:现在|目前)|薪资(?:更高|更低)|薪酬(?:更高|更低)|(?:问你愿不愿意|邀请你|希望你|请你|考虑是否)[^。；]{0,42}(?:牵头|负责|接手|加入|参与)[^。；]{0,32}(?:项目|岗位|工作|任务))/iu.test(evidence);
}

function personalCareerIncomeEvidenceIsExplicit(type: unknown, evidence: string): boolean {
  if (!["salary", "contract", "self_employment_draw", "business_dividend"].includes(String(type))) return true;
  if (isUnacceptedIncomeOpportunityEvidence(evidence)) return false;
  if (String(type) === "self_employment_draw" || String(type) === "business_dividend") {
    if (/(?:你|我|主角|本人).{0,32}(?:从|动用)[^。；]{0,20}(?:积蓄|存款|储蓄|备用金|个人账户)[^。；]{0,20}(?:提取|拿出|支取|取出)|(?:你|我|主角|本人).{0,20}(?:从积蓄中|从存款中|从储蓄中|从备用金中)(?:提取|拿出|支取|取出)/u.test(evidence)) {
      return false;
    }
    return /(?:你|我|主角|本人).{0,80}(?:领取|提取|获得|收到|赚|挣|顾问费|咨询收入|转入个人|给自己发|个人可支配收入|个人收入|个人提款|个人账户|工资|薪资|降薪|涨薪|调薪|业主提款|分红)/u.test(evidence);
  }
  // Do not treat a generic achievement (for example, \"获得主管肯定\") as
  // wage evidence.  A recurring career source needs either a compensation
  // term, or an explicit periodic personal receipt/earning statement.
  const compensationTerm = /(?:税后)?(?:月薪|年薪|工资|薪资|年税后收入|税后年收入)|顾问费|咨询收入|副业月收入|个人收入|个人进账|个人账户|可支配收入|报酬/u.test(evidence);
  const periodicPersonalReceipt = /(?:你|我|主角|本人).{0,56}(?:每月|月均|按月|每年|年度|年收入).{0,36}(?:领取|获得|收到|赚|挣|进账|支付|发放)/u.test(evidence);
  return compensationTerm || periodicPersonalReceipt;
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
  const thirdParty = /(?:妻子|丈夫|伴侣|配偶|女友|男友|父亲|母亲|妈妈|爸爸|儿子|女儿|孩子|岳父|岳母|公公|婆婆|小余|她|他)[^。；]{0,45}(?:月薪|年薪|工资|薪资|收入|到手|分红|股息|赚|盈利|利润)/u.test(text)
    || /^(?:妻子|丈夫|伴侣|配偶|父亲|母亲|妈妈|爸爸|儿子|女儿|孩子|小余)/u.test(String(subject?.displayName || ""));
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
    && next.factStatus === "needs_review"
    && next.accrualReviewStatus === "review_due"
  );
}

const V4_EXPENSE_CHANGE_REASONS = new Set([
  "residence_ended", "shared_responsibility_changed", "explicit_amount_reduced", "dependent_independent",
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

function acceptedEvent(proposal: FinancialEventProposal, evidenceReason: EvidenceMatchReason): AcceptedFinancialEvent {
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
    acceptedByReasonCodes: ["SCHEMA", "OUTCOME_AUTHORITY", "SUBJECT", "TEMPORAL", evidenceReason, "ACCOUNTING_INVARIANTS"]
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
  if (event.kind === "expense_commitment_started" && (!Array.isArray(event.payload.evidence) || event.payload.evidence.length === 0)) {
    event.payload.evidence = structuredClone(event.evidence);
  }
  if (event.kind === "expense_commitment_adjusted" && (!Array.isArray(event.payload.nextCommitment.evidence) || event.payload.nextCommitment.evidence.length === 0)) {
    event.payload.nextCommitment.evidence = structuredClone(event.evidence);
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
  const grouped = new Map<string, FinancialEventProposal[]>();
  for (const proposal of proposals) {
    const root = find(proposal.id);
    grouped.set(root, [...(grouped.get(root) || []), proposal]);
  }
  const priority = (proposal: FinancialEventProposal) => proposal.kind === "debt_drawn" || proposal.kind === "liquidity_shortfall_created" ? 0 : 1;
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
}): { acceptedEvents: AcceptedFinancialEvent[]; issues: FinancialLedgerIssue[] } {
  const issues: FinancialLedgerIssue[] = [];
  const acceptedEvents: AcceptedFinancialEvent[] = [];
  const acceptedProposals: FinancialEventProposal[] = [];
  const ids = new Set<string>();
  const allowedCareerStateIds = new Set([input.currentCareerState.id, ...(input.allowedCareerStateIds || [])]);
  const expenseAmountSourceOwners = activeExpenseAmountSourceOwners(input.currentLedger);

  for (const proposal of input.proposals) {
    if (!proposal.id || ids.has(proposal.id) || !FINANCIAL_EVENT_KINDS.has(proposal.kind) || !proposal.payload || typeof proposal.payload !== "object") {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal schema 无效或 id 重复", ageInMonths: input.periodEndAgeInMonths }));
      continue;
    }
    ids.add(proposal.id);
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
    if (["expense_commitment_started", "expense_commitment_adjusted", "one_off_expense_paid"].includes(proposal.kind)
      && businessOperatingFact(proposal)) {
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
      && !/分红|股息|利润分配|个人领取|转入个人/u.test(`${proposal.evidence} ${String(payload.displayName || "")}`)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "business_dividend 必须有已向主人公分配利润的证据，不能用公司年费或营收替代", ageInMonths: proposal.effectiveAtAgeInMonths }));
      continue;
    }
    const isSystemReview = proposal.systemGenerated === "expense_lifecycle_review";
    if (proposal.systemGenerated !== undefined && !isSystemReview) {
      issues.push(proposalIssue({
        proposal,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: "仅允许域内生成的 expense_lifecycle_review 使用系统财务 Proposal 标记",
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
    const evidenceMatch = isSystemReview
      ? { matched: true as const, reasonCode: "SYSTEM_POLICY_REVIEW" as const }
      : matchFinancialEvidence({ proposal, narrativeText: input.narrativeText });
    if (!evidenceMatch.matched || !evidenceMatch.reasonCode || !Number.isFinite(proposal.confidence) || proposal.confidence < 0.6 || proposal.confidence > 1) {
      issues.push(proposalIssue({ proposal, code: "UNBALANCED_TRANSACTION", summary: "财务 Proposal 缺少可靠正文证据或 confidence", ageInMonths: proposal.effectiveAtAgeInMonths }));
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
      const existingSameType = input.currentLedger.expenseCommitments.filter((item) => {
        if (item.status !== "active") return false;
        const existingKey = item.responsibilityKey || `legacy_type:${item.type}`;
        return existingKey === durableKey;
      });
      const onlyPolicyEstimate = existingSameType.length > 0 && existingSameType.every((item) => item.evidence.some((evidence) => evidence.source === "system_policy"
        || (evidence.source === "legacy_migration" && evidence.reasonCode === "LEGACY_FINANCIAL_STATE_MIGRATION")));
      if (existingSameType.length > 0 && !onlyPolicyEstimate) {
        issues.push(proposalIssue({
          proposal,
          code: "EXPENSE_DUPLICATE_RESPONSIBILITY",
          summary: `持续支出责任 ${durableKey} 已存在，必须引用现有支出 ID 使用 expense_commitment_adjusted，不能重复 started`,
          ageInMonths: proposal.effectiveAtAgeInMonths
        }));
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
      if (!personalCareerIncomeEvidenceIsExplicit(payload.type, proposal.evidence)) {
        issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司合同额或营业收入不能证明主角已经领取个人工资、提款或分红", ageInMonths: proposal.effectiveAtAgeInMonths }));
        continue;
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
    if (proposal.kind === "income_source_adjusted"
      && !personalCareerIncomeEvidenceIsExplicit((payload.nextSource as Record<string, unknown> | undefined)?.type, proposal.evidence)) {
      issues.push(proposalIssue({ proposal, code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", summary: "公司合同额或营业收入不能证明主角个人收入已经调整", ageInMonths: proposal.effectiveAtAgeInMonths }));
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
    acceptedEvents.push(acceptedEvent(proposal, evidenceMatch.reasonCode));
    acceptedProposals.push(proposal);
    if (expenseMutation) replaceExpenseAmountSourceOwner({
      owners: expenseAmountSourceOwners,
      accountId: expenseMutation.accountId,
      amountSourceIds: expenseMutation.amountSourceIds
    });
  }

  const hasActiveProperty = input.currentLedger.assetAccounts.some((account) => account.status === "active" && account.type === "property");
  const hasAcceptedPropertyFact = acceptedEvents.some((event) => (
    (event.kind === "asset_purchased" || event.kind === "asset_balance_discovered")
    && event.payload.assetAccount.type === "property"
  ));
  const purchaseNarrative = /(?:首付|买下|买了|购买|购入|购置|购房|婚房)/u.test(input.narrativeText);
  const orphanPropertyPurchaseProposalIds = new Set<string>();
  if (!hasActiveProperty && !hasAcceptedPropertyFact && purchaseNarrative) {
    for (const proposal of acceptedProposals) {
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
  const trialProposals = acceptedProposals.filter((proposal) => !orphanPropertyPurchaseProposalIds.has(proposal.id));
  const candidatesByProposalId = new Map(acceptedEvents
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
  return { acceptedEvents: acceptedAfterTrial, issues };
}
