import type { DebtAccount, DebtType, FinancialEventKind, FinancialEventProposal, FinancialLedger } from "./types";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { matchFinancialEvidence } from "./evidenceMatching";

export interface FinancialProposalNormalizationAudit {
  proposalId?: string;
  reasonCode: "KIND_FIELD_NORMALIZED" | "SOURCE_OUTCOME_FILLED" | "DUPLICATE_ID_RENAMED" | "CAREER_LINK_FILLED" | "CASH_ACCOUNT_FILLED"
    | "REPAIR_FIELDS_INHERITED" | "REPAIR_DUPLICATE_COLLAPSED" | "INCOME_TYPE_NORMALIZED" | "INCOME_SOURCE_ID_FILLED"
    | "DEBT_DRAW_PAYLOAD_NORMALIZED" | "DEBT_TYPE_NORMALIZED" | "ASSET_PURCHASE_PAYLOAD_NORMALIZED"
    | "FOUNDER_CONTRIBUTION_NORMALIZED" | "INCOME_START_NORMALIZED_TO_ADJUSTMENT" | "NO_OP_PROPOSAL_DROPPED";
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
    const repairKind = repair.kind ?? repair.type ?? repair.deltaType;
    const kindMatches = typeof repairKind === "string" ? rejectedByKind.get(repairKind as FinancialEventKind) || [] : [];
    const fallback = (repairId ? rejectedById.get(repairId) : undefined)
      || (kindMatches.length === 1 ? kindMatches[0] : undefined)
      || (input.rejectedProposals.length === 1 ? input.rejectedProposals[0] : undefined);
    const merged = mergeMissing(fallback, repair) as Record<string, unknown>;
    const key = String(merged.id || repairId || `${repairKind || "proposal"}_${index + 1}`);
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
      const currentMatch = matchFinancialEvidence({ proposal, narrativeText: input.narrativeText });
      if (currentMatch.matched && currentMatch.reasonCode !== "EVIDENCE_FUZZY_MATCHED") continue;
      const fallback = rejectedById.get(proposal.id);
      const fallbackMatch = fallback ? matchFinancialEvidence({ proposal: fallback, narrativeText: input.narrativeText }) : undefined;
      if (fallback && fallbackMatch?.matched && fallbackMatch.reasonCode !== "EVIDENCE_FUZZY_MATCHED") {
        proposal.evidence = fallback.evidence;
        continue;
      }
      const pattern = evidencePatterns[proposal.kind];
      if (!pattern) continue;
      const sentence = input.narrativeText.split(/(?<=[。！？；])/u).find((item) => pattern.test(item));
      if (sentence) proposal.evidence = sentence.trim();
    }
  }
  return { proposals: normalized.proposals, audit: [...audit, ...normalized.audit] };
}

const KINDS = new Set<FinancialEventKind>([
  "income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended",
  "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended",
  "one_off_expense_paid", "asset_purchased", "asset_sold", "asset_revalued", "debt_drawn",
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven",
  "business_holding_started", "business_financing_recorded", "business_holding_revalued", "business_distribution_received",
  "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"
]);

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
    let kind = typeof rawKind === "string" && KINDS.has(rawKind as FinancialEventKind)
      ? rawKind as FinancialEventKind
      : rawKind as FinancialEventKind;
    if (source.kind == null && typeof rawKind === "string") {
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
    const evidenceText = typeof source.evidence === "string" ? source.evidence : "";
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
    if (payload && kind === "asset_purchased") {
      const aliasedCashPaidWan = Number(payload.purchasePriceWan ?? payload.amountWan ?? payload.priceWan);
      if (!(Number(payload.cashPaidWan) > 0) && aliasedCashPaidWan > 0) {
        payload.cashPaidWan = aliasedCashPaidWan;
        audit.push({ proposalId: id, reasonCode: "ASSET_PURCHASE_PAYLOAD_NORMALIZED", normalizedValue: String(aliasedCashPaidWan) });
      }
      if (payload.transactionFeeWan == null) payload.transactionFeeWan = 0;
    }
    const incomeTypeAliases: Record<string, string> = {
      consulting: "contract",
      consultant: "contract",
      advisory: "contract",
      freelance: "self_employment_draw"
    };
    let incomePayload = kind === "income_source_adjusted" ? payload?.nextSource : kind === "income_source_started" ? payload : undefined;
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
    if (payload && (kind === "income_source_ended" || kind === "income_source_paused") && !payload.incomeSourceId) {
      const linkedActiveSources = input.currentLedger?.incomeSources.filter((item) => (
        item.status === "active" && (!input.currentCareerStateId || item.linkedCareerStateId === input.currentCareerStateId)
      )) || [];
      if (linkedActiveSources.length === 1) {
        payload.incomeSourceId = linkedActiveSources[0].id;
        audit.push({ proposalId: id, reasonCode: "INCOME_SOURCE_ID_FILLED", normalizedValue: linkedActiveSources[0].id });
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
    if (payload && kind === "income_source_adjusted" && payload.nextSource) {
      const existingSource = input.currentLedger?.incomeSources.find((item) => item.id === payload.incomeSourceId);
      const nextSource = payload.nextSource as Record<string, any>;
      if (existingSource
        && String(nextSource.type) === existingSource.type
        && String(nextSource.status) === existingSource.status
        && String(nextSource.accrualPolicy) === existingSource.accrualPolicy
        && Number(nextSource.monthlyNetAmountWan || 0) === Number(existingSource.monthlyNetAmountWan || 0)
        && Number(nextSource.annualNetAmountWan || 0) === Number(existingSource.annualNetAmountWan || 0)) {
        audit.push({ proposalId: id, reasonCode: "NO_OP_PROPOSAL_DROPPED", originalValue: kind });
        return [];
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
    return [{
      id,
      kind,
      effectiveAtAgeInMonths: Number(source.effectiveAtAgeInMonths),
      payload,
      evidence: typeof source.evidence === "string" ? source.evidence : "",
      sourceOutcomeId,
      confidence: Number(source.confidence),
      financialScope: source.financialScope === "personal" || source.financialScope === "business_operating"
        ? source.financialScope
        : undefined
    } satisfies FinancialEventProposal];
  });
  return { proposals, audit };
}
