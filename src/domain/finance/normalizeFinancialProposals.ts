import { canonicalizeExpenseCommitmentV4 } from "./migrateFinancialLedgerV3ToV4";
import { isFinancialLedgerV4, type DebtAccount, type DebtType, type ExpenseCommitment, type FinancialEventKind, type FinancialEventProposal, type FinancialLedger } from "./types";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { financialEvidenceCandidates, hasExplicitPersonalBusinessIncomeReceipt, hasMatchingPersonalBusinessIncomeAmount, matchFinancialEvidence } from "./evidenceMatching";

export interface FinancialProposalNormalizationAudit {
  proposalId?: string;
  reasonCode: "KIND_FIELD_NORMALIZED" | "SOURCE_OUTCOME_FILLED" | "DUPLICATE_ID_RENAMED" | "CAREER_LINK_FILLED" | "CASH_ACCOUNT_FILLED"
    | "REPAIR_FIELDS_INHERITED" | "REPAIR_DUPLICATE_COLLAPSED" | "INCOME_TYPE_NORMALIZED" | "INCOME_SOURCE_ID_FILLED"
    | "DEBT_DRAW_PAYLOAD_NORMALIZED" | "DEBT_TYPE_NORMALIZED" | "ASSET_PURCHASE_PAYLOAD_NORMALIZED"
    | "FOUNDER_CONTRIBUTION_NORMALIZED" | "INCOME_START_NORMALIZED_TO_ADJUSTMENT" | "NO_OP_PROPOSAL_DROPPED" | "LEGACY_INCOME_RECONFIRMATION_PRESERVED"
    | "ACCOUNT_ID_TYPE_CORRECTED" | "INCOME_SOURCE_SHAPE_COMPLETED" | "EXPENSE_COMMITMENT_SHAPE_COMPLETED" | "EXPENSE_EVIDENCE_PRESERVED" | "EXPENSE_TYPE_PRESERVED"
    | "MORTGAGE_PAYMENT_KEPT_OUT_OF_HOUSING"
    | "V4_EXPENSE_CANONICALIZED"
    | "BUSINESS_HOLDING_SHAPE_COMPLETED" | "OPTION_EVENT_NORMALIZED" | "OPTION_TERMS_NORMALIZED"
    | "OPTION_UNITS_UNKNOWN" | "OPTION_HOLDING_ID_DISAMBIGUATED" | "OPTION_EFFECTIVE_DATE_CLAMPED"
    | "RENT_ONLY_RECLASSIFIED_AS_HOUSING"
    | "EXISTING_MORTGAGE_PAYMENT_DEBT_DRAW_DROPPED"
    | "DEBT_RESTRUCTURE_PAYLOAD_CANONICALIZED"
    | "COMPANY_REVENUE_PERSONAL_DRAW_DROPPED" | "PERSONAL_BUSINESS_INCOME_RECEIPT_MISSING" | "PERSONAL_BUSINESS_INCOME_REPAIR_EVIDENCE_DROPPED" | "REPAIR_PERSONAL_BUSINESS_INCOME_MUTATION_DROPPED" | "UNLINKED_SELF_EMPLOYMENT_DRAW_DROPPED"
    | "ASSET_ACCOUNT_SHAPE_COMPLETED" | "DEBT_ACCOUNT_SHAPE_COMPLETED";
  originalValue?: string;
  normalizedValue?: string;
}

const DEBT_TYPE_ALIASES: Record<string, DebtType> = {
  personal_business_loan: "business_personal_guarantee",
  business_loan: "business_personal_guarantee",
  operating_loan: "business_personal_guarantee",
  personal_loan: "family_or_personal_loan",
  bank_personal_loan: "family_or_personal_loan",
  credit_card: "credit_balance"
};

function normalizedDebtType(value: unknown): DebtType {
  const raw = String(value || "family_or_personal_loan");
  return DEBT_TYPE_ALIASES[raw] || raw as DebtType;
}

/**
 * A recurring payment is evidence that an already-open mortgage continues;
 * it is never evidence that new principal reached the protagonist's cash
 * account.  Preserve a real new draw only when the prose explicitly says that
 * the new principal was disbursed.
 */
function isExistingMortgagePaymentRestatement(input: {
  evidenceText: string;
  currentLedger?: FinancialLedger;
}): boolean {
  const hasActiveMortgage = input.currentLedger?.debtAccounts.some((account) => (
    account.type === "mortgage" && (account.status === "active" || account.status === "defaulted")
  ));
  if (!hasActiveMortgage) return false;
  const paymentOnly = /(?:房贷|按揭)[^。；]{0,32}(?:月供|每月(?:还款|偿还)|还款|偿还)|(?:月供|每月(?:还款|偿还)|还贷)[^。；]{0,32}(?:房贷|按揭)/u.test(input.evidenceText);
  if (!paymentOnly) return false;
  const explicitlyDisbursedNewDebt = /(?:贷款|借款|房贷|按揭)[^。；]{0,24}(?:放款|发放|到账|借到|拿到|获得)|(?:放款|发放|到账|借到|拿到|获得)[^。；]{0,24}(?:贷款|借款|房贷|按揭)/u.test(input.evidenceText);
  return !explicitlyDisbursedNewDebt;
}

function authoritativeCareerLinkForSelfEmploymentDraw(input: {
  currentCareerStateId?: string;
  nextCareerStateIds?: string[];
}): string | undefined {
  if (input.nextCareerStateIds?.length === 1) return input.nextCareerStateIds[0];
  if ((input.nextCareerStateIds?.length || 0) > 1) return undefined;
  return input.currentCareerStateId;
}

/**
 * Models historically returned debt_drawn as a flat loan object even though
 * the authoritative reducer consumes a cash-balanced DebtDrawPayload. Convert
 * that common transport shape at the anti-corruption boundary; the validator
 * still rejects missing amounts, invalid schedules and unsupported debt types.
 */
function normalizeDebtDrawPayload(input: {
  proposalId: string;
  payload: Record<string, any>;
  effectiveAtAgeInMonths: number;
  audit: FinancialProposalNormalizationAudit[];
}): Record<string, any> {
  const { proposalId, payload, effectiveAtAgeInMonths, audit } = input;
  const flat = payload.debtAccount ? undefined : payload;
  const rawAccount = payload.debtAccount && typeof payload.debtAccount === "object"
    ? structuredClone(payload.debtAccount) as Record<string, any>
    : undefined;
  const principalWan = Number(
    payload.principalDrawnWan
      ?? rawAccount?.principalWan
      ?? flat?.principalAmountWan
      ?? flat?.principalWan
      ?? flat?.amountWan
  );
  if (!rawAccount && !Number.isFinite(principalWan)) return payload;

  const source = rawAccount || flat!;
  const rawType = String(source.type || "family_or_personal_loan");
  const type = normalizedDebtType(rawType);
  if (type !== rawType) {
    audit.push({ proposalId, reasonCode: "DEBT_TYPE_NORMALIZED", originalValue: rawType, normalizedValue: type });
  }
  const monthlyPaymentWan = Number(source.monthlyPaymentWan ?? source.repaymentPolicy?.monthlyPaymentWan);
  const annualInterestRate = Number(source.annualInterestRate ?? source.repaymentPolicy?.annualInterestRate);
  const remainingTermMonths = Number(source.termMonths ?? source.remainingTermMonths ?? source.repaymentPolicy?.remainingTermMonths);
  const hasSchedule = Number.isFinite(monthlyPaymentWan)
    || Number.isFinite(annualInterestRate)
    || Number.isFinite(remainingTermMonths);
  let repaymentPolicy = source.repaymentPolicy && typeof source.repaymentPolicy === "object"
    ? structuredClone(source.repaymentPolicy)
    : {
        mode: hasSchedule ? "known_schedule" : "event_driven",
        ...(Number.isFinite(monthlyPaymentWan) ? { monthlyPaymentWan } : {}),
        ...(Number.isFinite(annualInterestRate) ? { annualInterestRate } : {}),
        ...(Number.isFinite(remainingTermMonths) ? { remainingTermMonths } : {})
      };
  const supportedModes = new Set(["known_schedule", "estimated_amortizing", "event_driven"]);
  const hasUsableAutomaticSchedule = (Number(repaymentPolicy.monthlyPaymentWan) > 0)
    || (Number(repaymentPolicy.monthlyPrincipalWan) > 0)
    || (Number(repaymentPolicy.annualInterestRate) > 0 && Number(repaymentPolicy.remainingTermMonths) > 0);
  if (!supportedModes.has(String(repaymentPolicy.mode))
    || ((repaymentPolicy.mode === "known_schedule" || repaymentPolicy.mode === "estimated_amortizing") && !hasUsableAutomaticSchedule)) {
    repaymentPolicy = ["mortgage", "consumer_loan", "student_loan", "credit_balance"].includes(type)
      ? { mode: "estimated_amortizing", monthlyPrincipalWan: Math.round((principalWan / 240) * 10000) / 10000, remainingTermMonths: 240 }
      : { mode: "event_driven" };
    audit.push({ proposalId, reasonCode: "DEBT_DRAW_PAYLOAD_NORMALIZED", originalValue: String(source.repaymentPolicy?.mode || "missing"), normalizedValue: repaymentPolicy.mode });
  }
  const debtAccount: DebtAccount = {
    id: String(source.id || `${proposalId}_account`),
    type,
    displayName: String(source.displayName || "个人借款"),
    principalWan,
    openedAtAgeInMonths: Number(source.openedAtAgeInMonths ?? source.activeFromAgeInMonths ?? effectiveAtAgeInMonths),
    status: source.status || "active",
    repaymentPolicy,
    factStatus: source.factStatus || "estimated",
    evidence: Array.isArray(source.evidence) ? structuredClone(source.evidence) : [],
    origin: source.origin || "explicit",
    accruedUnpaidInterestWan: Number(source.accruedUnpaidInterestWan ?? 0),
    servicingStatus: source.servicingStatus || "current",
    consecutiveMissedPaymentMonths: Number(source.consecutiveMissedPaymentMonths ?? 0),
    totalMissedPaymentMonths: Number(source.totalMissedPaymentMonths ?? 0),
    recentMissedPaymentAgeInMonths: Array.isArray(source.recentMissedPaymentAgeInMonths)
      ? structuredClone(source.recentMissedPaymentAgeInMonths)
      : []
  };
  audit.push({ proposalId, reasonCode: "DEBT_DRAW_PAYLOAD_NORMALIZED", originalValue: rawAccount ? "nested_account" : "flat_loan", normalizedValue: "DebtDrawPayload" });
  return {
    debtAccount,
    destinationCashAccountId: payload.destinationCashAccountId,
    principalDrawnWan: principalWan
  };
}

/**
 * A restructure is a replacement of an existing obligation, not a new loan
 * and not a chance for model output to silently reduce a known balance.  The
 * model often supplies only a replacement id/type and a prose-confirmed new
 * payment.  Complete that transport shape from the authoritative old debt
 * only after the prose says the restructure has actually taken effect.
 *
 * Intentionally leave applications, negotiations, and incomplete payloads
 * untouched.  They must remain validator/gate failures rather than becoming
 * an invented accepted restructuring event.
 */
function hasCompletedDebtRestructureEvidence(evidenceText: string): boolean {
  const text = evidenceText.normalize("NFKC");
  const hardPending = /(?:尚未|还未|未获批|没有获批|等待|待(?:审核|审批|批准)|(?:审核|审批|协商|谈判)中)|(?:如果|若|一旦)[^。；]{0,48}(?:重组|调整|展期|月供|还款)/u.test(text);
  if (hardPending) return false;

  const approvedOrEffective = /(?:(?:申请|审批|审核|重组|调整|展期)[^。；]{0,36}(?:已(?:经)?|正式)?(?:通过|获批|批准|生效|执行|完成)|(?:银行|贷款机构)[^。；]{0,48}(?:已(?:经)?|正式)?(?:通过|获批|批准|同意|确认|完成|实施|执行)[^。；]{0,36}(?:重组|调整|展期|还款计划|月供)|(?:新|调整后(?:的)?)?(?:还款计划|月供)[^。；]{0,36}(?:确认|确认函|获批|批准|已(?:经)?生效|开始执行|正式执行))/u.test(text);
  if (approvedOrEffective) return true;

  const unapprovedApplication = /(?:申请|计划|准备|拟|希望|尝试|考虑|打算)[^。；]{0,20}(?:将|把|申请|调整|重组|展期)[^。；]{0,36}(?:月供|每月(?:还款|偿还)|还款额|还款计划)/u.test(text);
  if (unapprovedApplication) return false;

  // A concrete before/after payment statement is a confirmed new repayment
  // plan when there is no pending marker above. It stays narrower than a bare
  // "申请调整月供", which is retained for the gate to reject/retry.
  return /(?:月供|每月(?:还款|偿还)|还款额)[^。；]{0,48}(?:从|由)[^。；]{0,32}(?:降至|降到(?:了)?|降为|调整为|改为|变为)\s*\d+(?:\.\d+)?\s*(?:万元?|元)/u.test(text);
}

function explicitRestructuredMonthlyPaymentWan(evidenceText: string): number | undefined {
  const text = evidenceText.normalize("NFKC");
  const match = text.match(/(?:月供|每月(?:还款|偿还)|还款额)[^。；]{0,64}?(?:降至|降到(?:了)?|降为|调整为|改为|变为)\s*(\d+(?:\.\d+)?)\s*(万元?|元)/u);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return match[2].startsWith("万") ? amount : amount / 10000;
}

function restructureChangesTerm(evidenceText: string): boolean {
  return /(?:(?:还款)?(?:期限|年限)[^。；]{0,32}(?:延长|缩短|调整|变更)|(?:延长|缩短|调整|变更)[^。；]{0,20}(?:还款)?(?:期限|年限))/u.test(evidenceText.normalize("NFKC"));
}

function normalizeDebtRestructurePayload(input: {
  proposalId: string;
  payload: Record<string, any>;
  evidenceText: string;
  effectiveAtAgeInMonths: number;
  currentLedger?: FinancialLedger;
  audit: FinancialProposalNormalizationAudit[];
}): Record<string, any> {
  const { proposalId, payload, evidenceText, effectiveAtAgeInMonths, currentLedger, audit } = input;
  const rawReplacement = payload.replacementDebtAccount;
  const oldDebtAccountId = typeof payload.oldDebtAccountId === "string" ? payload.oldDebtAccountId.trim() : "";
  const oldDebt = currentLedger?.debtAccounts.find((account) => (
    account.id === oldDebtAccountId && (account.status === "active" || account.status === "defaulted")
  ));
  if (!oldDebt
    || !rawReplacement
    || typeof rawReplacement !== "object"
    || Array.isArray(rawReplacement)
    || !Number.isInteger(effectiveAtAgeInMonths)
    || effectiveAtAgeInMonths < 0
    || !hasCompletedDebtRestructureEvidence(evidenceText)) return payload;

  const explicitMonthlyPaymentWan = explicitRestructuredMonthlyPaymentWan(evidenceText);
  const repaymentPolicy = structuredClone(oldDebt.repaymentPolicy);
  const knownMonthlyInterestWan = Number(repaymentPolicy.monthlyInterestWan
    ?? (repaymentPolicy.annualInterestRate !== undefined
      ? oldDebt.principalWan * repaymentPolicy.annualInterestRate / 12
      : undefined));
  // A stated new payment below a still-known interest charge cannot be safely
  // interpreted as an automatic schedule without inventing a new rate.  Keep
  // it for the gate/repair path instead of recording an impossible plan.
  if (explicitMonthlyPaymentWan !== undefined
    && Number.isFinite(knownMonthlyInterestWan)
    && explicitMonthlyPaymentWan + 0.000001 < knownMonthlyInterestWan) return payload;
  if (explicitMonthlyPaymentWan !== undefined) {
    repaymentPolicy.mode = "known_schedule";
    repaymentPolicy.monthlyPaymentWan = explicitMonthlyPaymentWan;
    // The old fixed principal amount would override the new payment in the
    // accrual engine, so it cannot survive a payment-only restructure.
    delete repaymentPolicy.monthlyPrincipalWan;
  }
  const scheduleTermsChanged = explicitMonthlyPaymentWan !== undefined || restructureChangesTerm(evidenceText);
  if (scheduleTermsChanged) delete repaymentPolicy.remainingTermMonths;

  const requestedId = typeof rawReplacement.id === "string" ? rawReplacement.id.trim() : "";
  const existingIds = new Set(currentLedger?.debtAccounts.map((account) => account.id) || []);
  let replacementId = requestedId && requestedId !== oldDebt.id && !existingIds.has(requestedId)
    ? requestedId
    : `${oldDebt.id}_restructured_${effectiveAtAgeInMonths}`;
  let suffix = 2;
  while (existingIds.has(replacementId)) {
    replacementId = `${oldDebt.id}_restructured_${effectiveAtAgeInMonths}_${suffix}`;
    suffix += 1;
  }

  const replacementDebtAccount: DebtAccount = {
    id: replacementId,
    type: oldDebt.type,
    displayName: `${oldDebt.displayName}（重组后）`,
    principalWan: oldDebt.principalWan,
    openedAtAgeInMonths: effectiveAtAgeInMonths,
    status: "active",
    repaymentPolicy,
    // The carried obligation is authoritative, but a partial replacement
    // payload does not establish the new rate/term.  Keep it reviewable
    // rather than presenting inherited loan terms as newly known facts.
    factStatus: scheduleTermsChanged ? "needs_review" : oldDebt.factStatus,
    // Validator stamps the accepted, prose-grounded event evidence below;
    // do not retain model-supplied account evidence from a partial payload.
    evidence: [],
    origin: "explicit",
    // Do not emit capitalizedInterestWan: the old unpaid interest remains a
    // separate liability here, so reducer telemetry must not call it capitalized.
    accruedUnpaidInterestWan: oldDebt.accruedUnpaidInterestWan ?? 0,
    servicingStatus: "current",
    consecutiveMissedPaymentMonths: 0,
    totalMissedPaymentMonths: 0,
    recentMissedPaymentAgeInMonths: []
  };
  const transactionFeeWan = Number(payload.transactionFeeWan);
  const normalizedPayload: Record<string, any> = {
    oldDebtAccountId: oldDebt.id,
    replacementDebtAccount,
    transactionFeeWan: Number.isFinite(transactionFeeWan) && transactionFeeWan >= 0 ? transactionFeeWan : 0
  };
  if (typeof payload.sourceCashAccountId === "string" && payload.sourceCashAccountId.trim()) {
    normalizedPayload.sourceCashAccountId = payload.sourceCashAccountId.trim();
  }
  audit.push({
    proposalId,
    reasonCode: "DEBT_RESTRUCTURE_PAYLOAD_CANONICALIZED",
    originalValue: oldDebt.id,
    normalizedValue: replacementDebtAccount.id
  });
  return normalizedPayload;
}

function mergeMissing(base: unknown, repair: unknown): unknown {
  if (repair === undefined || repair === null || repair === "") return structuredClone(base);
  if (!base || !repair || typeof base !== "object" || typeof repair !== "object" || Array.isArray(base) || Array.isArray(repair)) {
    return structuredClone(repair);
  }
  const result = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(repair as Record<string, unknown>)) {
    result[key] = mergeMissing(result[key], value);
  }
  return result;
}

function strictPersonalBusinessIncomeType(proposal: Pick<FinancialEventProposal, "kind" | "payload">): "self_employment_draw" | "business_dividend" | undefined {
  if (proposal.kind !== "income_source_started" && proposal.kind !== "income_source_adjusted") return undefined;
  const payload = proposal.payload as Record<string, unknown>;
  const source = proposal.kind === "income_source_adjusted" ? payload.nextSource : payload;
  const type = source && typeof source === "object" ? String((source as Record<string, unknown>).type || "") : "";
  return type === "self_employment_draw" || type === "business_dividend" ? type : undefined;
}

const PERSONAL_CASH_INFLOW_KINDS = new Set<FinancialEventKind>([
  "income_source_started",
  "income_source_adjusted",
  "one_off_income_received",
  "business_distribution_received",
  "family_support_received"
]);

function repairKind(raw: Record<string, unknown>): FinancialEventKind | undefined {
  const value = raw.kind ?? raw.type ?? raw.deltaType;
  return typeof value === "string" && KINDS.has(value as FinancialEventKind)
    ? value as FinancialEventKind
    : undefined;
}

/**
 * A repair is a patch for a rejected proposal, not permission to relabel an
 * unsupported owner draw as rent, salary, or a one-off cash receipt.  That
 * would bypass the strict receipt check simply by changing the event shape.
 */
function mutatesStrictPersonalBusinessIncomeFallback(input: {
  fallback: FinancialEventProposal;
  repair: Record<string, unknown>;
}): boolean {
  const fallbackType = strictPersonalBusinessIncomeType(input.fallback);
  if (!fallbackType) return false;
  const nextKind = repairKind(input.repair);
  if (nextKind && nextKind !== input.fallback.kind) return true;
  const rawPayload = input.repair.payload;
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return false;
  const source = input.fallback.kind === "income_source_adjusted"
    ? (rawPayload as Record<string, unknown>).nextSource
    : rawPayload;
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  const nextType = (source as Record<string, unknown>).type;
  return nextType !== undefined && String(nextType) !== fallbackType;
}

/**
 * Repair responses are patches over rejected model proposals, not fresh facts.
 * Inherit omitted structural fields from the rejected proposal and collapse
 * duplicate repair rows before the ordinary normalizer/validator runs.
 */
export function normalizeRepairedFinancialProposals(input: {
  proposals: unknown;
  rejectedProposals: FinancialEventProposal[];
  acceptedOutcomeIds?: string[];
  currentLedger?: FinancialLedger;
  currentCareerStateId?: string;
  nextCareerStateIds?: string[];
  narrativeText?: string;
}): { proposals: FinancialEventProposal[]; audit: FinancialProposalNormalizationAudit[] } {
  if (!Array.isArray(input.proposals)) return { proposals: [], audit: [] };
  const rejectedById = new Map(input.rejectedProposals.map((proposal) => [proposal.id, proposal]));
  const rejectedByKind = new Map<FinancialEventKind, FinancialEventProposal[]>();
  for (const proposal of input.rejectedProposals) {
    rejectedByKind.set(proposal.kind, [...(rejectedByKind.get(proposal.kind) || []), proposal]);
  }
  const audit: FinancialProposalNormalizationAudit[] = [];
  const mergedByKey = new Map<string, Record<string, unknown>>();
  input.proposals.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const repair = structuredClone(raw) as Record<string, unknown>;
    const repairId = typeof repair.id === "string" && repair.id.trim() ? repair.id.trim() : undefined;
    const rawRepairKind = repair.kind ?? repair.type ?? repair.deltaType;
    const kindMatches = typeof rawRepairKind === "string" ? rejectedByKind.get(rawRepairKind as FinancialEventKind) || [] : [];
    const fallback = (repairId ? rejectedById.get(repairId) : undefined)
      || (kindMatches.length === 1 ? kindMatches[0] : undefined)
      || (input.rejectedProposals.length === 1 ? input.rejectedProposals[0] : undefined);
    const strictRejectedBusinessIncomeExists = input.rejectedProposals.some((proposal) => (
      strictPersonalBusinessIncomeType(proposal) !== undefined
    ));
    const resolvedRepairKind = repairKind(repair);
    if ((fallback && mutatesStrictPersonalBusinessIncomeFallback({ fallback, repair }))
      || (!fallback && strictRejectedBusinessIncomeExists && resolvedRepairKind && PERSONAL_CASH_INFLOW_KINDS.has(resolvedRepairKind))) {
      audit.push({
        proposalId: repairId || `${String(rawRepairKind || "proposal")}_${index + 1}`,
        reasonCode: "REPAIR_PERSONAL_BUSINESS_INCOME_MUTATION_DROPPED",
        originalValue: fallback ? String(fallback.kind) : "unmatched_strict_personal_business_income",
        normalizedValue: resolvedRepairKind || "income_type_mutation"
      });
      return;
    }
    const merged = mergeMissing(fallback, repair) as Record<string, unknown>;
    const key = String(merged.id || repairId || `${rawRepairKind || "proposal"}_${index + 1}`);
    if (fallback) audit.push({ proposalId: key, reasonCode: "REPAIR_FIELDS_INHERITED", originalValue: fallback.id, normalizedValue: key });
    if (mergedByKey.has(key)) {
      mergedByKey.set(key, mergeMissing(mergedByKey.get(key), merged) as Record<string, unknown>);
      audit.push({ proposalId: key, reasonCode: "REPAIR_DUPLICATE_COLLAPSED", originalValue: key, normalizedValue: key });
    } else {
      mergedByKey.set(key, merged);
    }
  });
  const normalized = normalizeFinancialProposals({
    ...input,
    proposals: [...mergedByKey.values()]
  });
  if (input.narrativeText) {
    const evidencePatterns: Partial<Record<FinancialEventKind, RegExp>> = {
      income_source_started: /工资|薪资|月薪|年薪|收入|顾问|咨询|合同/,
      income_source_adjusted: /工资|薪资|月薪|年薪|收入|顾问|咨询|调整|降至|增至/,
      income_source_ended: /离职|退休|结束|停止|不再|转为|顾问/,
      income_source_paused: /暂停|停发|停止|转为|顾问/,
      debt_drawn: /放款|贷款.{0,12}到账|借款.{0,12}到账|正式批准/,
      asset_purchased: /支付.{0,12}(?:设备|房|资产)|购买.{0,12}(?:设备|房|资产)|购置/
    };
    for (const proposal of normalized.proposals) {
      const payload = proposal.payload as Record<string, unknown>;
      const personalIncomeSource = (proposal.kind === "income_source_adjusted" ? payload.nextSource : payload) as Record<string, unknown> | undefined;
      const strictPersonalBusinessIncome = personalIncomeSource?.type === "self_employment_draw"
        || personalIncomeSource?.type === "business_dividend";
      const hasCompletedPersonalReceipt = (evidence: string) => !strictPersonalBusinessIncome
        || (hasExplicitPersonalBusinessIncomeReceipt({ type: personalIncomeSource?.type, evidence })
          && hasMatchingPersonalBusinessIncomeAmount({ type: personalIncomeSource?.type, source: personalIncomeSource, evidence }));
      const currentMatch = matchFinancialEvidence({ proposal, narrativeText: input.narrativeText });
      if (currentMatch.matched && currentMatch.reasonCode !== "EVIDENCE_FUZZY_MATCHED" && hasCompletedPersonalReceipt(proposal.evidence)) continue;
      const fallback = rejectedById.get(proposal.id);
      const fallbackMatch = fallback ? matchFinancialEvidence({ proposal: fallback, narrativeText: input.narrativeText }) : undefined;
      if (fallback && fallbackMatch?.matched && fallbackMatch.reasonCode !== "EVIDENCE_FUZZY_MATCHED" && hasCompletedPersonalReceipt(fallback.evidence)) {
        proposal.evidence = fallback.evidence;
        continue;
      }
      const pattern = evidencePatterns[proposal.kind];
      if (!pattern) continue;
      const sentence = financialEvidenceCandidates({ proposal, narrativeText: input.narrativeText, limit: 3 })
        .find((candidate) => hasCompletedPersonalReceipt(candidate.excerpt))?.excerpt
        || input.narrativeText.split(/(?<=[。！？；])/u).find((item) => pattern.test(item) && hasCompletedPersonalReceipt(item));
      if (sentence) proposal.evidence = sentence.trim();
    }
    normalized.proposals = normalized.proposals.filter((proposal) => {
      const payload = proposal.payload as Record<string, unknown>;
      const personalIncomeSource = (proposal.kind === "income_source_adjusted" ? payload.nextSource : payload) as Record<string, unknown> | undefined;
      const type = personalIncomeSource?.type;
      if (type !== "self_employment_draw" && type !== "business_dividend") return true;
      const evidenceMatch = matchFinancialEvidence({ proposal, narrativeText: input.narrativeText! });
      if (hasExplicitPersonalBusinessIncomeReceipt({ type, evidence: proposal.evidence })
        && hasMatchingPersonalBusinessIncomeAmount({ type, source: personalIncomeSource, evidence: proposal.evidence })
        && evidenceMatch.matched) return true;
      audit.push({
        proposalId: proposal.id,
        reasonCode: "PERSONAL_BUSINESS_INCOME_REPAIR_EVIDENCE_DROPPED",
        originalValue: String(type),
        normalizedValue: "missing_grounded_completed_personal_receipt"
      });
      return false;
    });
  }
  return { proposals: normalized.proposals, audit: [...audit, ...normalized.audit] };
}

const KINDS = new Set<FinancialEventKind>([
  "income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended",
  "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended",
  "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered",
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven", "debt_default_recorded",
  "business_option_granted", "business_option_vested", "business_option_revalued",
  "business_option_exercised", "business_option_expired", "business_option_cancelled",
  "business_holding_started", "business_financing_recorded", "business_holding_revalued", "business_distribution_received",
  "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"
]);

const KIND_ALIASES: Record<string, FinancialEventKind> = {
  option_grant: "business_option_granted",
  option_granted: "business_option_granted",
  stock_option_grant: "business_option_granted",
  stock_option_granted: "business_option_granted",
  business_option_grant: "business_option_granted",
  equity_option_grant: "business_option_granted"
};

const FACT_STATUS_ALIASES: Record<string, "known" | "estimated" | "unknown" | "needs_review"> = {
  confirmed: "known",
  verified: "known",
  explicit: "known",
  certain: "known",
  estimate: "estimated",
  inferred: "estimated",
  pending: "needs_review",
  review: "needs_review",
  unverified: "needs_review"
};

function normalizeFactStatus(value: unknown, fallback: "estimated" | "needs_review" = "estimated") {
  if (["known", "estimated", "unknown", "needs_review"].includes(String(value))) return value;
  return FACT_STATUS_ALIASES[String(value)] || fallback;
}

export function normalizeFinancialProposals(input: {
  proposals: unknown;
  acceptedOutcomeIds?: string[];
  currentLedger?: FinancialLedger;
  currentCareerStateId?: string;
  nextCareerStateIds?: string[];
}): { proposals: FinancialEventProposal[]; audit: FinancialProposalNormalizationAudit[] } {
  if (!Array.isArray(input.proposals)) return { proposals: [], audit: [] };
  const audit: FinancialProposalNormalizationAudit[] = [];
  const seenIds = new Map<string, number>();
  const onlyOutcomeId = input.acceptedOutcomeIds?.length === 1 ? input.acceptedOutcomeIds[0] : undefined;
  const proposals = input.proposals.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const source = structuredClone(raw) as Record<string, unknown>;
    const rawKind = source.kind ?? source.type ?? source.deltaType;
    const aliasedKind = typeof rawKind === "string" ? KIND_ALIASES[rawKind] : undefined;
    let kind = aliasedKind || rawKind as FinancialEventKind;
    if (typeof rawKind === "string" && (source.kind == null || aliasedKind)) {
      audit.push({ proposalId: String(source.id || ""), reasonCode: "KIND_FIELD_NORMALIZED", originalValue: String(rawKind), normalizedValue: String(kind) });
    }
    const baseId = typeof source.id === "string" && source.id.trim() ? source.id.trim() : `proposal_${index + 1}`;
    const occurrence = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, occurrence);
    const id = occurrence === 1 ? baseId : `${baseId}_${occurrence}`;
    if (id !== baseId) audit.push({ proposalId: id, reasonCode: "DUPLICATE_ID_RENAMED", originalValue: baseId, normalizedValue: id });
    let sourceOutcomeId = typeof source.sourceOutcomeId === "string" && source.sourceOutcomeId.trim()
      ? source.sourceOutcomeId.trim()
      : undefined;
    if (!sourceOutcomeId && onlyOutcomeId) {
      sourceOutcomeId = onlyOutcomeId;
      audit.push({ proposalId: id, reasonCode: "SOURCE_OUTCOME_FILLED", normalizedValue: onlyOutcomeId });
    }
    let payload: any = source.payload && typeof source.payload === "object"
      ? structuredClone(source.payload) as Record<string, any>
      : source.payload;
    const effectiveAtAgeInMonths = Number(source.effectiveAtAgeInMonths);
    const evidenceText = typeof source.evidence === "string" ? source.evidence : "";
    if (kind === "debt_drawn" && isExistingMortgagePaymentRestatement({
      evidenceText,
      currentLedger: input.currentLedger
    })) {
      audit.push({
        proposalId: id,
        reasonCode: "EXISTING_MORTGAGE_PAYMENT_DEBT_DRAW_DROPPED",
        originalValue: "debt_drawn",
        normalizedValue: "existing_mortgage_payment"
      });
      return [];
    }
    const monthlyAmountFromEvidence = (): number | undefined => {
      const normalized = evidenceText.normalize("NFKC");
      const wan = normalized.match(/(?:每月|月(?:薪|收入|支出|租|供)?|每个月)[^。；，]{0,12}?(\d+(?:\.\d+)?)\s*万/u)
        || normalized.match(/(\d+(?:\.\d+)?)\s*万\s*(?:\/月|每月)/u);
      if (wan) return Number(wan[1]);
      const yuan = normalized.match(/(?:每月|月(?:薪|收入|支出|租|供)?|每个月)[^。；，]{0,12}?(\d+(?:\.\d+)?)\s*元/u)
        || normalized.match(/(\d+(?:\.\d+)?)\s*元\s*(?:\/月|每月)/u);
      return yuan ? Number(yuan[1]) / 10000 : undefined;
    };
    const annualAmountFromEvidence = (): number | undefined => {
      const normalized = evidenceText.normalize("NFKC");
      const wan = normalized.match(/(?:年薪|年收入|年度收入)[^。；，]{0,12}?(\d+(?:\.\d+)?)\s*万/u)
        || normalized.match(/(\d+(?:\.\d+)?)\s*万\s*(?:\/年|每年)/u);
      return wan ? Number(wan[1]) : undefined;
    };
    const unwrapHolding = (value: any): any => {
      if (!value || typeof value !== "object") return value;
      return value.optionHolding || value.businessHolding || value.equityHolding || value.holding || value.holdingDetails || value;
    };
    const reserveFundedStartupMatch = evidenceText.match(/(?:备用金|存款|个人现金|自己的钱).{0,20}?(\d+(?:\.\d+)?)\s*万元?.{0,20}(?:启动资金|创业|出资|投入公司)/u);
    if (kind === "debt_drawn" && reserveFundedStartupMatch) {
      const investedWan = Number(reserveFundedStartupMatch[1]);
      kind = "business_holding_started";
      payload = {
        businessHolding: {
          id: `holding_${id}`,
          business: {
            id: `business_${id}`,
            displayName: "创业公司",
            status: "operating",
            factStatus: Number(source.confidence) >= 0.8 ? "known" : "estimated",
            evidence: []
          },
          personalCarryingValueWan: investedWan,
          status: "active",
          factStatus: Number(source.confidence) >= 0.8 ? "known" : "estimated",
          evidence: []
        },
        personalCashInvestedWan: investedWan
      };
      source.financialScope = "personal";
      audit.push({ proposalId: id, reasonCode: "FOUNDER_CONTRIBUTION_NORMALIZED", originalValue: "debt_drawn", normalizedValue: kind });
    }
    const founderContributionMatch = evidenceText.match(/(?:(?:备用金|个人|自己).{0,24}(?:取出|拿出|投入|出资|支付)(?:了)?\s*(\d+(?:\.\d+)?)\s*万元?.{0,24}(?:公司|创业|启动资金|运营资金)|(?:你|主角|本人).{0,12}垫付(?:了)?\s*(\d+(?:\.\d+)?)\s*万元?.{0,20}(?:服务器|差旅|公司|创业|办公|运营))/u);
    if (source.financialScope === "business_operating"
      && (kind === "expense_commitment_started" || kind === "one_off_expense_paid")
      && founderContributionMatch) {
      const investedWan = Number(founderContributionMatch[1] ?? founderContributionMatch[2]);
      kind = "business_holding_started";
      payload = {
        businessHolding: {
          id: `holding_${id}`,
          business: {
            id: `business_${id}`,
            displayName: "创业公司",
            status: "operating",
            factStatus: Number(source.confidence) >= 0.8 ? "known" : "estimated",
            evidence: []
          },
          personalCarryingValueWan: investedWan,
          status: "active",
          factStatus: Number(source.confidence) >= 0.8 ? "known" : "estimated",
          evidence: []
        },
        personalCashInvestedWan: investedWan
      };
      source.financialScope = "personal";
      audit.push({ proposalId: id, reasonCode: "FOUNDER_CONTRIBUTION_NORMALIZED", originalValue: String(rawKind), normalizedValue: kind });
    }
    if (payload && kind === "debt_drawn") {
      payload = normalizeDebtDrawPayload({
        proposalId: id,
        payload,
        effectiveAtAgeInMonths: Number(source.effectiveAtAgeInMonths),
        audit
      });
    }
    if (payload && kind === "debt_restructured") {
      payload = normalizeDebtRestructurePayload({
        proposalId: id,
        payload,
        evidenceText,
        effectiveAtAgeInMonths: Number(source.effectiveAtAgeInMonths),
        currentLedger: input.currentLedger,
        audit
      });
    }
    if (payload && kind === "asset_purchased") {
      const aliasedCashPaidWan = Number(payload.purchasePriceWan ?? payload.amountWan ?? payload.priceWan);
      if (!(Number(payload.cashPaidWan) > 0) && aliasedCashPaidWan > 0) {
        payload.cashPaidWan = aliasedCashPaidWan;
        audit.push({ proposalId: id, reasonCode: "ASSET_PURCHASE_PAYLOAD_NORMALIZED", normalizedValue: String(aliasedCashPaidWan) });
      }
      if (payload.transactionFeeWan == null) payload.transactionFeeWan = 0;
    }
    if (payload && kind === "business_holding_started") {
      const nested = payload.business_holding_started || payload.businessHoldingStarted || payload;
      const businessHolding = unwrapHolding(nested);
      const optionEvidence = `${evidenceText} ${String(businessHolding?.displayName || businessHolding?.name || "")}`;
      if (businessHolding?.instrumentType === "stock_option" || businessHolding?.optionTerms || /期权|stock\s*option|options?/iu.test(optionEvidence)) {
        kind = "business_option_granted";
        payload = { optionHolding: businessHolding };
        audit.push({ proposalId: id, reasonCode: "OPTION_EVENT_NORMALIZED", originalValue: "business_holding_started", normalizedValue: kind });
      } else {
        payload = {
          businessHolding,
          personalCashInvestedWan: Number(payload.personalCashInvestedWan ?? businessHolding?.personalCarryingValueWan ?? 0),
          ...(payload.sourceCashAccountId ? { sourceCashAccountId: payload.sourceCashAccountId } : {})
        };
      }
    } else if (payload && kind === "business_option_granted") {
      const nested = payload.business_option_granted || payload.businessOptionGranted || payload;
      payload = { optionHolding: unwrapHolding(nested) };
    }
    const holding: any = kind === "business_option_granted" ? payload?.optionHolding : kind === "business_holding_started" ? payload?.businessHolding : undefined;
    if (holding && typeof holding === "object") {
      const original = JSON.stringify(holding);
      holding.id ||= holding.holdingId || `${kind}_${id}`;
      holding.instrumentType ||= kind === "business_option_granted" ? "stock_option" : "equity";
      const instrumentAliases: Record<string, "equity" | "stock_option"> = {
        non_listed_equity: "equity",
        private_equity: "equity",
        founder_equity: "equity",
        common_stock: "equity",
        shares: "equity",
        option: "stock_option",
        stock_options: "stock_option"
      };
      holding.instrumentType = instrumentAliases[holding.instrumentType] || holding.instrumentType;
      holding.personalCarryingValueWan = Number.isFinite(Number(holding.personalCarryingValueWan))
        ? Number(holding.personalCarryingValueWan)
        : Number.isFinite(Number(holding.attributableValueWan)) ? Number(holding.attributableValueWan) : 0;
      holding.status ||= "active";
      holding.factStatus ||= "needs_review";
      holding.evidence = Array.isArray(holding.evidence) ? holding.evidence : [];
      const businessInput = holding.business && typeof holding.business === "object" ? holding.business : {};
      const businessId = businessInput.id || holding.businessId || holding.companyId || `${holding.id}_business`;
      holding.business = {
        ...businessInput,
        id: businessId,
        displayName: businessInput.displayName || holding.businessName || holding.companyName || "待确认企业",
        status: businessInput.status || "unknown",
        factStatus: businessInput.factStatus || "needs_review",
        evidence: Array.isArray(businessInput.evidence) ? businessInput.evidence : []
      };
      if (kind === "business_option_granted") {
        const termsInput = holding.optionTerms && typeof holding.optionTerms === "object" ? holding.optionTerms : {};
        const explicitGrantedUnits = Number(termsInput.grantedUnits ?? holding.grantedUnits ?? holding.units);
        const grantedUnits = Number.isFinite(explicitGrantedUnits) && explicitGrantedUnits > 0
          ? explicitGrantedUnits
          : 0;
        holding.optionTerms = {
          ...termsInput,
          grantedUnits,
          vestedUnits: Number(termsInput.vestedUnits ?? holding.vestedUnits ?? 0),
          exercisedUnits: Number(termsInput.exercisedUnits ?? holding.exercisedUnits ?? 0),
          strikePriceWanPerUnit: Number(termsInput.strikePriceWanPerUnit ?? holding.strikePriceWanPerUnit ?? 0)
        };
        if (!(Number.isFinite(explicitGrantedUnits) && explicitGrantedUnits > 0)) {
          holding.factStatus = "needs_review";
          audit.push({ proposalId: id, reasonCode: "OPTION_UNITS_UNKNOWN", normalizedValue: "0" });
        }
        if (input.currentLedger?.businessHoldings.some((item) => item.id === holding.id && item.instrumentType !== "stock_option")) {
          const originalId = holding.id;
          holding.id = `${holding.id}_stock_option`;
          audit.push({ proposalId: id, reasonCode: "OPTION_HOLDING_ID_DISAMBIGUATED", originalValue: originalId, normalizedValue: holding.id });
        }
        // A grant creates a contingent right. Valuation must enter through a
        // separate revaluation event after vesting, never through grant shape repair.
        holding.personalCarryingValueWan = 0;
      }
      if (JSON.stringify(holding) !== original) {
        audit.push({ proposalId: id, reasonCode: "BUSINESS_HOLDING_SHAPE_COMPLETED", normalizedValue: holding.id });
      }
    }
    if (kind === "business_option_granted"
      && input.currentLedger
      && Number(source.effectiveAtAgeInMonths) < input.currentLedger.asOfAgeInMonths
      && /(?:你|主人公|主角)[^。；]{0,24}(?:获得|获授|被授予|接受|拿到)[^。；]{0,20}期权|(?:授予|发放)[^。；]{0,12}(?:给)?你[^。；]{0,12}期权/u.test(evidenceText)) {
      const originalEffectiveAt = Number(source.effectiveAtAgeInMonths);
      source.effectiveAtAgeInMonths = input.currentLedger.asOfAgeInMonths;
      audit.push({
        proposalId: id,
        reasonCode: "OPTION_EFFECTIVE_DATE_CLAMPED",
        originalValue: String(originalEffectiveAt),
        normalizedValue: String(input.currentLedger.asOfAgeInMonths)
      });
    }
    const incomeTypeAliases: Record<string, string> = {
      consulting: "contract",
      consultant: "contract",
      advisory: "contract",
      freelance: "self_employment_draw",
      stipend: "other",
      allowance: "other",
      subsidy: "other",
      service_fee: "contract",
      consulting_fee: "contract",
      recurring_income: "other"
    };
    let incomePayload = kind === "income_source_adjusted" ? payload?.nextSource : kind === "income_source_started" ? payload : undefined;
    if (payload && kind === "business_option_granted" && payload.optionHolding && typeof payload.optionHolding === "object") {
      const option = payload.optionHolding as Record<string, any>;
      const terms = option.optionTerms && typeof option.optionTerms === "object"
        ? option.optionTerms as Record<string, any>
        : undefined;
      if (terms) {
        let normalized = false;
        const evidenceSupportsExpiry = /到期|有效期|失效|过期|expir/iu.test(String(source.evidence || ""));
        if (terms.expiresAtAgeInMonths !== undefined && !evidenceSupportsExpiry) {
          delete terms.expiresAtAgeInMonths;
          normalized = true;
        }
        if (terms.expiresAtAgeInMonths === undefined && Number.isFinite(option.expirationDateInMonths) && evidenceSupportsExpiry) {
          terms.expiresAtAgeInMonths = Number(option.expirationDateInMonths);
          normalized = true;
        }
        if (!terms.vestingPolicy && typeof option.vestingSchedule === "string") {
          const annual = option.vestingSchedule.match(/(\d+)\s*年归属[^\d]*(?:每年)\s*(\d+(?:\.\d+)?)\s*%/u);
          if (annual) {
            const totalMonths = Number(annual[1]) * 12;
            const annualRate = Number(annual[2]) / 100;
            if (totalMonths > 0 && annualRate > 0 && Math.abs(annualRate * Number(annual[1]) - 1) <= 0.02) {
              terms.vestingPolicy = { totalMonths, frequencyMonths: 12 };
              normalized = true;
            }
          }
        }
        if (normalized) audit.push({ proposalId: id, reasonCode: "OPTION_TERMS_NORMALIZED", normalizedValue: JSON.stringify(terms) });
      }
    }
    if (incomePayload && incomeTypeAliases[String(incomePayload.type)]) {
      const originalType = String(incomePayload.type);
      incomePayload.type = incomeTypeAliases[originalType];
      audit.push({ proposalId: id, reasonCode: "INCOME_TYPE_NORMALIZED", originalValue: originalType, normalizedValue: incomePayload.type });
    }
    if (kind === "income_source_started"
      && incomePayload
      && input.currentLedger
      && /(?:从本月起|自本月起|第一个月起|从第一个月起|一开始就).{0,36}(?:每月|月薪|工资|薪资)|(?:每月|月薪|工资|薪资).{0,36}(?:从本月起|自本月起|第一个月起|从第一个月起)/u.test(evidenceText)) {
      source.effectiveAtAgeInMonths = input.currentLedger.asOfAgeInMonths;
      incomePayload.activeFromAgeInMonths = input.currentLedger.asOfAgeInMonths;
    }
    if (kind === "income_source_started" && incomePayload?.id && input.currentLedger) {
      const existingSource = input.currentLedger.incomeSources.find((item) => item.id === incomePayload.id);
      if (existingSource) {
        kind = "income_source_adjusted";
        payload = {
          incomeSourceId: existingSource.id,
          nextSource: {
            ...structuredClone(existingSource),
            ...incomePayload,
            id: existingSource.id
          }
        };
        incomePayload = payload.nextSource;
        audit.push({
          proposalId: id,
          reasonCode: "INCOME_START_NORMALIZED_TO_ADJUSTMENT",
          originalValue: "income_source_started",
          normalizedValue: "income_source_adjusted"
        });
      }
    }
    if (incomePayload && typeof incomePayload === "object") {
      const original = JSON.stringify(incomePayload);
      if (kind === "income_source_started") incomePayload.id ||= incomePayload.incomeSourceId || incomePayload.sourceId || `${kind}_${id}`;
      if (kind === "income_source_started") incomePayload.type ||= /工资|薪资|月薪/u.test(evidenceText) ? "salary" : /顾问|咨询|服务费/u.test(evidenceText) ? "contract" : "other";
      const policyAliases: Record<string, string> = { recurring: "monthly", recurring_monthly: "monthly", monthly_recurring: "monthly", yearly: "annual", annually: "annual", one_off: "event_only" };
      incomePayload.accrualPolicy = policyAliases[incomePayload.accrualPolicy] || incomePayload.accrualPolicy
        || (kind === "income_source_started" ? (incomePayload.annualNetAmountWan !== undefined ? "annual" : "monthly") : undefined);
      const evidenceMonthly = monthlyAmountFromEvidence();
      const evidenceAnnual = annualAmountFromEvidence();
      const monthly = incomePayload.monthlyNetAmountWan ?? incomePayload.monthlyAmountWan ?? incomePayload.amountWanPerMonth
        ?? (evidenceMonthly !== undefined ? incomePayload.amountWan : undefined)
        ?? evidenceMonthly;
      const annual = incomePayload.annualNetAmountWan ?? incomePayload.annualAmountWan ?? incomePayload.amountWanPerYear
        ?? (evidenceAnnual !== undefined ? incomePayload.amountWan : undefined)
        ?? evidenceAnnual;
      if (evidenceAnnual !== undefined && evidenceMonthly === undefined
        && incomePayload.annualNetAmountWan === undefined && incomePayload.monthlyNetAmountWan === undefined) {
        incomePayload.accrualPolicy = "annual";
      }
      if (incomePayload.accrualPolicy === "monthly" && Number.isFinite(Number(monthly))) incomePayload.monthlyNetAmountWan = Number(monthly);
      if (incomePayload.accrualPolicy === "annual" && Number.isFinite(Number(annual))) incomePayload.annualNetAmountWan = Number(annual);
      if (kind === "income_source_started") {
        incomePayload.displayName ||= incomePayload.name || incomePayload.label || "待确认收入来源";
        incomePayload.activeFromAgeInMonths = Number.isInteger(Number(incomePayload.activeFromAgeInMonths)) ? Number(incomePayload.activeFromAgeInMonths) : effectiveAtAgeInMonths;
        incomePayload.status ||= "active";
        incomePayload.factStatus ||= "estimated";
        incomePayload.evidence = Array.isArray(incomePayload.evidence) ? incomePayload.evidence : [];
      }
      if (JSON.stringify(incomePayload) !== original) audit.push({ proposalId: id, reasonCode: "INCOME_SOURCE_SHAPE_COMPLETED", normalizedValue: incomePayload.id });
    }
    const expensePayload = kind === "expense_commitment_started" ? payload : undefined;
    if (expensePayload && typeof expensePayload === "object") {
      const original = JSON.stringify(expensePayload);
      expensePayload.id ||= expensePayload.expenseCommitmentId || expensePayload.commitmentId || `${kind}_${id}`;
      const rawExpenseType = String(expensePayload.type || "");
      const isMortgageRepayment = ["mortgage_payment", "mortgage", "debt_payment"].includes(rawExpenseType)
        || /(?:月供|房贷|按揭)/u.test(evidenceText);
      // Mortgage principal and interest are debt-service flows.  Do not hide a
      // misrouted repayment inside a housing commitment: leave an invalid
      // expense type for schema validation so the node is repaired into debt
      // repayment / repayment-policy handling instead of being double counted.
      if (isMortgageRepayment) {
        expensePayload.type = "mortgage_payment";
        audit.push({ proposalId: id, reasonCode: "MORTGAGE_PAYMENT_KEPT_OUT_OF_HOUSING", originalValue: rawExpenseType || "text_fallback", normalizedValue: "mortgage_payment" });
      } else {
        const expenseAliases: Record<string, string> = { rent: "housing", caregiver: "dependent_support", caregiving: "dependent_support", medical: "healthcare", tuition: "education", living: "basic_living" };
        expensePayload.type = expenseAliases[expensePayload.type] || expensePayload.type || (/房租|住房/u.test(evidenceText) ? "housing" : /照护|护工|赡养/u.test(evidenceText) ? "dependent_support" : "other");
      }
      if (expensePayload.type === "basic_living"
        && /(?:房租|月租|宿舍|租房)/u.test(evidenceText)
        && !/(?:生活费|日常开销|基本生活|伙食|餐饮|水电|通勤|综合支出)/u.test(evidenceText)) {
        expensePayload.type = "housing";
        audit.push({ proposalId: id, reasonCode: "RENT_ONLY_RECLASSIFIED_AS_HOUSING", normalizedValue: expensePayload.id });
      }
      const amount = expensePayload.monthlyAmountWan ?? expensePayload.amountWanPerMonth ?? expensePayload.monthlyCostWan ?? monthlyAmountFromEvidence();
      if (Number.isFinite(Number(amount))) expensePayload.monthlyAmountWan = Number(amount);
      expensePayload.displayName ||= expensePayload.name || expensePayload.label || "待确认持续支出";
      expensePayload.activeFromAgeInMonths = Number.isInteger(Number(expensePayload.activeFromAgeInMonths)) ? Number(expensePayload.activeFromAgeInMonths) : effectiveAtAgeInMonths;
      expensePayload.status ||= "active";
      expensePayload.factStatus ||= "estimated";
      expensePayload.evidence = Array.isArray(expensePayload.evidence) ? expensePayload.evidence : [];
      if (JSON.stringify(expensePayload) !== original) audit.push({ proposalId: id, reasonCode: "EXPENSE_COMMITMENT_SHAPE_COMPLETED", normalizedValue: expensePayload.id });
    }
    if (payload && (kind === "asset_purchased" || kind === "asset_balance_discovered")) {
      const candidate = payload.assetAccount && typeof payload.assetAccount === "object" ? payload.assetAccount : payload.asset || payload.account;
      if (candidate && typeof candidate === "object") {
        const original = JSON.stringify(candidate);
        candidate.id ||= payload.assetAccountId || candidate.accountId || `${kind}_${id}`;
        const assetTypeAliases: Record<string, string> = {
          real_estate: "property",
          residential_property: "property",
          residence: "property",
          home: "property",
          house: "property",
          apartment: "property"
        };
        candidate.type = assetTypeAliases[String(candidate.type)] || candidate.type
          || (/房|公寓|住宅/u.test(evidenceText) ? "property" : "other_personal_asset");
        candidate.displayName ||= candidate.name || candidate.label || (candidate.type === "property" ? "待确认房产" : "待确认资产");
        const explicitPropertyValue = evidenceText.normalize("NFKC").match(/(?:总价|成交价|市值|价值)[^\d]{0,8}(\d+(?:\.\d+)?)\s*万/u);
        const rawMarketValue = candidate.marketValueWan ?? candidate.valueWan ?? candidate.amountWan
          ?? (explicitPropertyValue ? Number(explicitPropertyValue[1]) : undefined);
        candidate.marketValueWan = Number.isFinite(Number(rawMarketValue)) ? Number(rawMarketValue) : 0;
        candidate.liquidity ||= candidate.type === "property" ? "illiquid" : "semi_liquid";
        candidate.status ||= "active";
        candidate.factStatus = normalizeFactStatus(candidate.factStatus, rawMarketValue === undefined ? "needs_review" : "estimated");
        candidate.openedAtAgeInMonths = Number.isInteger(Number(candidate.openedAtAgeInMonths)) ? Number(candidate.openedAtAgeInMonths) : effectiveAtAgeInMonths;
        candidate.evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
        payload.assetAccount = candidate;
        if (JSON.stringify(candidate) !== original) audit.push({ proposalId: id, reasonCode: "ASSET_ACCOUNT_SHAPE_COMPLETED", normalizedValue: candidate.id });
      }
    }
    if (payload && (kind === "debt_drawn" || kind === "debt_balance_discovered" || kind === "liquidity_shortfall_created")) {
      const candidate = payload.debtAccount && typeof payload.debtAccount === "object" ? payload.debtAccount : payload.debt || payload.account;
      if (candidate && typeof candidate === "object") {
        const original = JSON.stringify(candidate);
        candidate.id ||= payload.debtAccountId || candidate.accountId || `${kind}_${id}`;
        const debtTypeAliases: Record<string, string> = {
          housing_loan: "mortgage",
          home_loan: "mortgage",
          housing_mortgage: "mortgage",
          mortgage_loan: "mortgage",
          personal_loan: "family_or_personal_loan"
        };
        candidate.type = debtTypeAliases[String(candidate.type)] || candidate.type
          || (/房贷|按揭|组合贷款/u.test(evidenceText) ? "mortgage" : "family_or_personal_loan");
        candidate.displayName ||= candidate.name || candidate.label || (candidate.type === "mortgage" ? "待确认房贷" : "待确认债务");
        const explicitDebtValue = evidenceText.normalize("NFKC").match(/(?:组合贷款|贷款|房贷(?:余额)?|按揭(?:余额)?)[^\d]{0,8}(\d+(?:\.\d+)?)\s*万/u);
        const rawPrincipal = candidate.principalWan ?? payload.principalDrawnWan ?? candidate.amountWan
          ?? (explicitDebtValue ? Number(explicitDebtValue[1]) : undefined);
        candidate.principalWan = Number.isFinite(Number(rawPrincipal)) ? Number(rawPrincipal) : 0;
        candidate.openedAtAgeInMonths = Number.isInteger(Number(candidate.openedAtAgeInMonths)) ? Number(candidate.openedAtAgeInMonths) : effectiveAtAgeInMonths;
        candidate.status ||= "active";
        candidate.factStatus = normalizeFactStatus(candidate.factStatus, rawPrincipal === undefined ? "needs_review" : "estimated");
        candidate.evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
        if (!candidate.repaymentPolicy || typeof candidate.repaymentPolicy !== "object") candidate.repaymentPolicy = {};
        const policyAliases: Record<string, string> = { amortizing: "estimated_amortizing", estimated: "estimated_amortizing", schedule: "known_schedule", manual: "event_driven" };
        candidate.repaymentPolicy.mode = policyAliases[candidate.repaymentPolicy.mode] || candidate.repaymentPolicy.mode
          || (candidate.type === "mortgage" ? "estimated_amortizing" : "event_driven");
        if (candidate.repaymentPolicy.mode === "estimated_amortizing" && !candidate.repaymentPolicy.monthlyPrincipalWan && Number.isFinite(candidate.principalWan)) {
          candidate.repaymentPolicy.monthlyPrincipalWan = candidate.principalWan / 240;
          candidate.repaymentPolicy.remainingTermMonths ||= 240;
        }
        payload.debtAccount = candidate;
        if (JSON.stringify(candidate) !== original) audit.push({ proposalId: id, reasonCode: "DEBT_ACCOUNT_SHAPE_COMPLETED", normalizedValue: candidate.id });
      }
    }
    if (payload && (kind === "income_source_adjusted" || kind === "income_source_ended" || kind === "income_source_paused")) {
      const linkedActiveSources = input.currentLedger?.incomeSources.filter((item) => (
        item.status === "active" && (!input.currentCareerStateId || item.linkedCareerStateId === input.currentCareerStateId)
      )) || [];
      const activeCareerCandidates = input.currentLedger?.incomeSources.filter((item) => (
        item.status === "active"
        && (Boolean(item.linkedCareerStateId)
          || ["salary", "contract", "self_employment_draw"].includes(item.type)
          || item.id === "legacy_recurring_income")
      )) || [];
      const repairCandidates = linkedActiveSources.length > 0 ? linkedActiveSources : activeCareerCandidates;
      const idBelongsToCash = input.currentLedger?.cashAccounts.some((item) => item.id === payload.incomeSourceId);
      const idIsUnknown = typeof payload.incomeSourceId === "string"
        && !input.currentLedger?.incomeSources.some((item) => item.id === payload.incomeSourceId);
      if ((!payload.incomeSourceId || idBelongsToCash || idIsUnknown) && repairCandidates.length === 1) {
        const originalValue = typeof payload.incomeSourceId === "string" ? payload.incomeSourceId : undefined;
        payload.incomeSourceId = repairCandidates[0].id;
        audit.push({
          proposalId: id,
          reasonCode: idBelongsToCash || idIsUnknown ? "ACCOUNT_ID_TYPE_CORRECTED" : "INCOME_SOURCE_ID_FILLED",
          originalValue,
          normalizedValue: repairCandidates[0].id
        });
      }
    }
    if (payload && kind === "income_source_adjusted" && payload.incomeSourceId) {
      const existingSource = input.currentLedger?.incomeSources.find((item) => item.id === payload.incomeSourceId);
      if (existingSource && payload.nextSource && typeof payload.nextSource === "object") {
        payload.nextSource = mergeMissing(existingSource, payload.nextSource);
        payload.nextSource.id = payload.incomeSourceId;
        if (!Array.isArray(payload.nextSource.evidence)) payload.nextSource.evidence = structuredClone(existingSource.evidence || []);
        audit.push({ proposalId: id, reasonCode: "INCOME_SOURCE_SHAPE_COMPLETED", normalizedValue: payload.incomeSourceId });
      }
    }
    if (payload && kind === "expense_commitment_adjusted" && payload.expenseCommitmentId && payload.nextCommitment && typeof payload.nextCommitment === "object") {
      const existingCommitment = input.currentLedger?.expenseCommitments.find((item) => item.id === payload.expenseCommitmentId);
      if (existingCommitment) {
        payload.nextCommitment = mergeMissing(existingCommitment, payload.nextCommitment);
        payload.nextCommitment.id = payload.expenseCommitmentId;
        if (!Array.isArray(payload.nextCommitment.evidence) || payload.nextCommitment.evidence.length === 0) {
          payload.nextCommitment.evidence = structuredClone(existingCommitment.evidence);
          audit.push({ proposalId: id, reasonCode: "EXPENSE_EVIDENCE_PRESERVED", normalizedValue: payload.expenseCommitmentId });
        }
        const rawRequestedType = String(payload.nextCommitment.type || "");
        const isMortgageRepayment = ["mortgage_payment", "mortgage", "debt_payment"].includes(rawRequestedType)
          || /(?:月供|房贷|按揭)/u.test(evidenceText);
        if (isMortgageRepayment) {
          payload.nextCommitment.type = "mortgage_payment";
          audit.push({
            proposalId: id,
            reasonCode: "MORTGAGE_PAYMENT_KEPT_OUT_OF_HOUSING",
            originalValue: rawRequestedType || "text_fallback",
            normalizedValue: "mortgage_payment"
          });
        } else {
          const typeAliases: Record<string, string> = { rent: "housing", caregiver: "dependent_support", caregiving: "dependent_support", medical: "healthcare", tuition: "education", living: "basic_living" };
          const requestedType = typeAliases[payload.nextCommitment.type] || payload.nextCommitment.type;
          if (requestedType !== existingCommitment.type) {
            payload.nextCommitment.type = existingCommitment.type;
            audit.push({
              proposalId: id,
              reasonCode: "EXPENSE_TYPE_PRESERVED",
              originalValue: String(requestedType),
              normalizedValue: existingCommitment.type
            });
          } else {
            payload.nextCommitment.type = requestedType;
          }
        }
        const nextAmount = payload.nextCommitment.monthlyAmountWan ?? payload.nextCommitment.amountWanPerMonth ?? payload.nextCommitment.monthlyCostWan ?? monthlyAmountFromEvidence();
        if (Number.isFinite(Number(nextAmount))) payload.nextCommitment.monthlyAmountWan = Number(nextAmount);
        audit.push({ proposalId: id, reasonCode: "EXPENSE_COMMITMENT_SHAPE_COMPLETED", normalizedValue: payload.expenseCommitmentId });
      }
    }
    const preferredCareerStateId = input.nextCareerStateIds?.length === 1
      ? input.nextCareerStateIds[0]
      : input.currentCareerStateId;
    if (payload && kind === "income_source_started" && ["salary", "contract", "self_employment_draw"].includes(String(payload.type))
      && preferredCareerStateId && (!payload.linkedCareerStateId || (input.nextCareerStateIds?.length === 1 && payload.linkedCareerStateId !== preferredCareerStateId))) {
      payload.linkedCareerStateId = preferredCareerStateId;
      audit.push({ proposalId: id, reasonCode: "CAREER_LINK_FILLED", normalizedValue: preferredCareerStateId });
    }
    if (payload && kind === "income_source_adjusted" && payload.nextSource
      && (!payload.nextSource.linkedCareerStateId || (input.nextCareerStateIds?.length === 1 && payload.nextSource.linkedCareerStateId !== input.nextCareerStateIds[0]))) {
      const existingSource = input.currentLedger?.incomeSources.find((item) => item.id === payload.incomeSourceId);
      const linkedCareerStateId = input.nextCareerStateIds?.length === 1
        ? input.nextCareerStateIds[0]
        : existingSource?.linkedCareerStateId || preferredCareerStateId;
      if (linkedCareerStateId) {
        payload.nextSource.linkedCareerStateId = linkedCareerStateId;
        audit.push({ proposalId: id, reasonCode: "CAREER_LINK_FILLED", normalizedValue: linkedCareerStateId });
      }
    }
    if (payload && (kind === "income_source_started" || kind === "income_source_adjusted")) {
      const personalIncomeSource = (kind === "income_source_adjusted" ? payload.nextSource : payload) as Record<string, any> | undefined;
      if (personalIncomeSource?.type === "self_employment_draw" || personalIncomeSource?.type === "business_dividend") {
        // The personal ledger can record a founder's actual draw, never the
        // company's operating revenue.  A valid draw must also point to the
        // one authoritative current/accepted-next CareerState so the later
        // career-income transaction stays atomic.
        if (source.financialScope === "business_operating") {
          audit.push({
            proposalId: id,
            reasonCode: "COMPANY_REVENUE_PERSONAL_DRAW_DROPPED",
            originalValue: "self_employment_draw",
            normalizedValue: "business_operating"
          });
          return [];
        }
        if (!hasExplicitPersonalBusinessIncomeReceipt({ type: personalIncomeSource.type, evidence: evidenceText })
          || !hasMatchingPersonalBusinessIncomeAmount({ type: personalIncomeSource.type, source: personalIncomeSource, evidence: evidenceText })) {
          audit.push({
            proposalId: id,
            reasonCode: "PERSONAL_BUSINESS_INCOME_RECEIPT_MISSING",
            originalValue: String(personalIncomeSource.type),
            normalizedValue: "missing_explicit_personal_receipt"
          });
          return [];
        }
        if (personalIncomeSource.type === "self_employment_draw") {
          const authoritativeCareerLink = authoritativeCareerLinkForSelfEmploymentDraw({
            currentCareerStateId: input.currentCareerStateId,
            nextCareerStateIds: input.nextCareerStateIds
          });
          if (!authoritativeCareerLink || personalIncomeSource.linkedCareerStateId !== authoritativeCareerLink) {
            audit.push({
              proposalId: id,
              reasonCode: "UNLINKED_SELF_EMPLOYMENT_DRAW_DROPPED",
              originalValue: String(personalIncomeSource.linkedCareerStateId || "missing"),
              normalizedValue: authoritativeCareerLink || "missing"
            });
            return [];
          }
        }
      }
    }
    if (payload && kind === "income_source_adjusted" && payload.nextSource) {
      const existingSource = input.currentLedger?.incomeSources.find((item) => item.id === payload.incomeSourceId);
      const nextSource = payload.nextSource as Record<string, any>;
      const explicitlyReconfirmsLegacyMigration = Boolean(existingSource?.id.startsWith("legacy_"))
        && Boolean(existingSource?.evidence.length)
        && existingSource!.evidence.every((item) => item.source === "legacy_migration")
        && (monthlyAmountFromEvidence() !== undefined || annualAmountFromEvidence() !== undefined);
      if (existingSource
        && String(nextSource.type) === existingSource.type
        && String(nextSource.status) === existingSource.status
        && String(nextSource.accrualPolicy) === existingSource.accrualPolicy
        && Number(nextSource.monthlyNetAmountWan || 0) === Number(existingSource.monthlyNetAmountWan || 0)
        && Number(nextSource.annualNetAmountWan || 0) === Number(existingSource.annualNetAmountWan || 0)
        && !explicitlyReconfirmsLegacyMigration) {
        audit.push({ proposalId: id, reasonCode: "NO_OP_PROPOSAL_DROPPED", originalValue: kind });
        return [];
      }
      if (explicitlyReconfirmsLegacyMigration) {
        audit.push({
          proposalId: id,
          reasonCode: "LEGACY_INCOME_RECONFIRMATION_PRESERVED",
          normalizedValue: existingSource!.id
        });
      }
    }
    const primaryCashId = input.currentLedger?.cashAccounts.find((item) => item.id === PRIMARY_CASH_ACCOUNT_ID && item.status === "active")?.id
      || input.currentLedger?.cashAccounts.find((item) => item.status === "active")?.id;
    if (payload && primaryCashId) {
      const needsDestination = ["one_off_income_received", "family_support_received", "debt_drawn", "liquidity_shortfall_created", "business_distribution_received"].includes(kind);
      const needsSource = ["one_off_expense_paid", "family_support_paid", "debt_principal_repaid", "debt_interest_paid", "asset_purchased", "business_holding_started"].includes(kind);
      if (needsDestination && !payload.destinationCashAccountId) {
        payload.destinationCashAccountId = primaryCashId;
        audit.push({ proposalId: id, reasonCode: "CASH_ACCOUNT_FILLED", normalizedValue: primaryCashId });
      }
      if (needsSource && !payload.sourceCashAccountId) {
        payload.sourceCashAccountId = primaryCashId;
        audit.push({ proposalId: id, reasonCode: "CASH_ACCOUNT_FILLED", normalizedValue: primaryCashId });
      }
    }
    // Model transport is allowed to use the compact legacy-shaped expense
    // payload, but a V4 ledger never writes that shape.  Canonicalize only at
    // this anti-corruption boundary; invalid/ambiguous conversions deliberately
    // remain uncanonical so the ordinary schema/gate path can reject them.
    if (payload && input.currentLedger && isFinancialLedgerV4(input.currentLedger)
      && (kind === "expense_commitment_started" || kind === "expense_commitment_adjusted")) {
      const candidate = (kind === "expense_commitment_adjusted" ? payload.nextCommitment : payload) as ExpenseCommitment;
      if (candidate && typeof candidate === "object"
        && ["basic_living", "housing", "dependent_support", "education", "healthcare", "insurance", "other"].includes(String(candidate.type))) {
        const canonical = canonicalizeExpenseCommitmentV4({
          commitment: candidate,
          asOfAgeInMonths: effectiveAtAgeInMonths
        });
        if (canonical.issues.length === 0) {
          if (kind === "expense_commitment_adjusted") payload.nextCommitment = canonical.commitment;
          else payload = canonical.commitment as unknown as Record<string, any>;
          audit.push({ proposalId: id, reasonCode: "V4_EXPENSE_CANONICALIZED", normalizedValue: canonical.commitment.responsibilityKey });
        }
      }
    }
    return [{
      id,
      kind,
      effectiveAtAgeInMonths: Number(source.effectiveAtAgeInMonths),
      payload,
      evidence: typeof source.evidence === "string" ? source.evidence : "",
      sourceOutcomeId,
      confidence: Number(source.confidence),
      financialScope: source.financialScope === "personal"
        || source.financialScope === "shared_household"
        || source.financialScope === "business_operating"
        || source.financialScope === "third_party"
        ? source.financialScope
        : undefined
    } satisfies FinancialEventProposal];
  });
  return { proposals, audit };
}
