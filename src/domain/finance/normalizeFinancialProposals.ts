import type { FinancialEventKind, FinancialEventProposal, FinancialLedger } from "./types";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { financialEvidenceCandidates, matchFinancialEvidence } from "./evidenceMatching";

export interface FinancialProposalNormalizationAudit {
  proposalId?: string;
  reasonCode: "KIND_FIELD_NORMALIZED" | "SOURCE_OUTCOME_FILLED" | "DUPLICATE_ID_RENAMED" | "CAREER_LINK_FILLED" | "CASH_ACCOUNT_FILLED"
    | "REPAIR_FIELDS_INHERITED" | "REPAIR_DUPLICATE_COLLAPSED" | "INCOME_TYPE_NORMALIZED" | "INCOME_SOURCE_ID_FILLED"
    | "ACCOUNT_ID_TYPE_CORRECTED" | "INCOME_SOURCE_SHAPE_COMPLETED" | "EXPENSE_COMMITMENT_SHAPE_COMPLETED"
    | "BUSINESS_HOLDING_SHAPE_COMPLETED" | "OPTION_EVENT_NORMALIZED" | "OPTION_TERMS_NORMALIZED"
    | "ASSET_ACCOUNT_SHAPE_COMPLETED" | "DEBT_ACCOUNT_SHAPE_COMPLETED";
  originalValue?: string;
  normalizedValue?: string;
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
      income_source_paused: /暂停|停发|停止|转为|顾问/
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
      const sentence = financialEvidenceCandidates({ proposal, narrativeText: input.narrativeText, limit: 1 })[0]?.excerpt
        || input.narrativeText.split(/(?<=[。！？；])/u).find((item) => pattern.test(item));
      if (sentence) proposal.evidence = sentence.trim();
    }
  }
  return { proposals: normalized.proposals, audit: [...audit, ...normalized.audit] };
}

const KINDS = new Set<FinancialEventKind>([
  "income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended",
  "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended",
  "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered",
  "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven",
  "business_option_granted", "business_option_vested", "business_option_revalued",
  "business_option_exercised", "business_option_expired", "business_option_cancelled",
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
    const effectiveAtAgeInMonths = Number(source.effectiveAtAgeInMonths);
    const evidenceText = typeof source.evidence === "string" ? source.evidence : "";
    const monthlyAmountFromEvidence = (): number | undefined => {
      const normalized = evidenceText.normalize("NFKC");
      const wan = normalized.match(/(?:每月|月(?:薪|收入|支出|租|供)?|每个月)[^。；，]{0,12}?(\d+(?:\.\d+)?)\s*万/u)
        || normalized.match(/(\d+(?:\.\d+)?)\s*万\s*(?:\/月|每月)/u);
      if (wan) return Number(wan[1]);
      const yuan = normalized.match(/(?:每月|月(?:薪|收入|支出|租|供)?|每个月)[^。；，]{0,12}?(\d+(?:\.\d+)?)\s*元/u)
        || normalized.match(/(\d+(?:\.\d+)?)\s*元\s*(?:\/月|每月)/u);
      return yuan ? Number(yuan[1]) / 10000 : undefined;
    };
    const unwrapHolding = (value: any): any => {
      if (!value || typeof value !== "object") return value;
      return value.optionHolding || value.businessHolding || value.equityHolding || value.holding || value.holdingDetails || value;
    };
    if (payload && kind === "business_holding_started") {
      const nested = payload.business_holding_started || payload.businessHoldingStarted || payload;
      payload = unwrapHolding(nested);
      if (payload?.instrumentType === "stock_option" || payload?.optionTerms) {
        kind = "business_option_granted";
        payload = { optionHolding: payload };
        audit.push({ proposalId: id, reasonCode: "OPTION_EVENT_NORMALIZED", originalValue: "business_holding_started", normalizedValue: kind });
      }
    } else if (payload && kind === "business_option_granted") {
      const nested = payload.business_option_granted || payload.businessOptionGranted || payload;
      payload = { optionHolding: unwrapHolding(nested) };
    }
    const holding: any = kind === "business_option_granted" ? payload?.optionHolding : kind === "business_holding_started" ? payload : undefined;
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
        holding.optionTerms = {
          ...termsInput,
          grantedUnits: Number(termsInput.grantedUnits ?? holding.grantedUnits ?? holding.units ?? 0),
          vestedUnits: Number(termsInput.vestedUnits ?? holding.vestedUnits ?? 0),
          exercisedUnits: Number(termsInput.exercisedUnits ?? holding.exercisedUnits ?? 0),
          strikePriceWanPerUnit: Number(termsInput.strikePriceWanPerUnit ?? holding.strikePriceWanPerUnit ?? 0)
        };
        // A grant creates a contingent right. Valuation must enter through a
        // separate revaluation event after vesting, never through grant shape repair.
        holding.personalCarryingValueWan = 0;
      }
      if (JSON.stringify(holding) !== original) {
        audit.push({ proposalId: id, reasonCode: "BUSINESS_HOLDING_SHAPE_COMPLETED", normalizedValue: holding.id });
      }
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
    const incomePayload = kind === "income_source_adjusted" ? payload?.nextSource : kind === "income_source_started" ? payload : undefined;
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
    if (incomePayload && typeof incomePayload === "object") {
      const original = JSON.stringify(incomePayload);
      if (kind === "income_source_started") incomePayload.id ||= incomePayload.incomeSourceId || incomePayload.sourceId || `${kind}_${id}`;
      if (kind === "income_source_started") incomePayload.type ||= /工资|薪资|月薪/u.test(evidenceText) ? "salary" : /顾问|咨询|服务费/u.test(evidenceText) ? "contract" : "other";
      const policyAliases: Record<string, string> = { recurring: "monthly", recurring_monthly: "monthly", monthly_recurring: "monthly", yearly: "annual", annually: "annual", one_off: "event_only" };
      incomePayload.accrualPolicy = policyAliases[incomePayload.accrualPolicy] || incomePayload.accrualPolicy
        || (kind === "income_source_started" ? (incomePayload.annualNetAmountWan !== undefined ? "annual" : "monthly") : undefined);
      const monthly = incomePayload.monthlyNetAmountWan ?? incomePayload.monthlyAmountWan ?? incomePayload.amountWanPerMonth ?? monthlyAmountFromEvidence();
      const annual = incomePayload.annualNetAmountWan ?? incomePayload.annualAmountWan ?? incomePayload.amountWanPerYear;
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
      const expenseAliases: Record<string, string> = { rent: "housing", mortgage_payment: "housing", caregiver: "dependent_support", caregiving: "dependent_support", medical: "healthcare", tuition: "education", living: "basic_living" };
      expensePayload.type = expenseAliases[expensePayload.type] || expensePayload.type || (/房租|月供|住房/u.test(evidenceText) ? "housing" : /照护|护工|赡养/u.test(evidenceText) ? "dependent_support" : "other");
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
        candidate.type ||= /房|公寓|住宅/u.test(evidenceText) ? "property" : "other_personal_asset";
        candidate.displayName ||= candidate.name || candidate.label || (candidate.type === "property" ? "待确认房产" : "待确认资产");
        candidate.marketValueWan = Number(candidate.marketValueWan ?? candidate.valueWan ?? candidate.amountWan);
        candidate.liquidity ||= candidate.type === "property" ? "illiquid" : "semi_liquid";
        candidate.status ||= "active";
        candidate.factStatus ||= "estimated";
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
        candidate.type ||= /房贷|按揭/u.test(evidenceText) ? "mortgage" : "family_or_personal_loan";
        candidate.displayName ||= candidate.name || candidate.label || (candidate.type === "mortgage" ? "待确认房贷" : "待确认债务");
        candidate.principalWan = Number(candidate.principalWan ?? payload.principalDrawnWan ?? candidate.amountWan);
        candidate.openedAtAgeInMonths = Number.isInteger(Number(candidate.openedAtAgeInMonths)) ? Number(candidate.openedAtAgeInMonths) : effectiveAtAgeInMonths;
        candidate.status ||= "active";
        candidate.factStatus ||= "estimated";
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
      const idBelongsToCash = input.currentLedger?.cashAccounts.some((item) => item.id === payload.incomeSourceId);
      if ((!payload.incomeSourceId || idBelongsToCash) && linkedActiveSources.length === 1) {
        const originalValue = typeof payload.incomeSourceId === "string" ? payload.incomeSourceId : undefined;
        payload.incomeSourceId = linkedActiveSources[0].id;
        audit.push({ proposalId: id, reasonCode: idBelongsToCash ? "ACCOUNT_ID_TYPE_CORRECTED" : "INCOME_SOURCE_ID_FILLED", originalValue, normalizedValue: linkedActiveSources[0].id });
      }
    }
    if (payload && kind === "income_source_adjusted" && payload.incomeSourceId) {
      const existingSource = input.currentLedger?.incomeSources.find((item) => item.id === payload.incomeSourceId);
      if (existingSource && payload.nextSource && typeof payload.nextSource === "object") {
        payload.nextSource = mergeMissing(existingSource, payload.nextSource);
        payload.nextSource.id = payload.incomeSourceId;
        audit.push({ proposalId: id, reasonCode: "INCOME_SOURCE_SHAPE_COMPLETED", normalizedValue: payload.incomeSourceId });
      }
    }
    if (payload && kind === "expense_commitment_adjusted" && payload.expenseCommitmentId && payload.nextCommitment && typeof payload.nextCommitment === "object") {
      const existingCommitment = input.currentLedger?.expenseCommitments.find((item) => item.id === payload.expenseCommitmentId);
      if (existingCommitment) {
        payload.nextCommitment = mergeMissing(existingCommitment, payload.nextCommitment);
        payload.nextCommitment.id = payload.expenseCommitmentId;
        const typeAliases: Record<string, string> = { rent: "housing", mortgage_payment: "housing", caregiver: "dependent_support", caregiving: "dependent_support", medical: "healthcare", tuition: "education", living: "basic_living" };
        payload.nextCommitment.type = typeAliases[payload.nextCommitment.type] || payload.nextCommitment.type;
        const nextAmount = payload.nextCommitment.monthlyAmountWan ?? payload.nextCommitment.amountWanPerMonth ?? payload.nextCommitment.monthlyCostWan ?? monthlyAmountFromEvidence();
        if (Number.isFinite(Number(nextAmount))) payload.nextCommitment.monthlyAmountWan = Number(nextAmount);
        audit.push({ proposalId: id, reasonCode: "EXPENSE_COMMITMENT_SHAPE_COMPLETED", normalizedValue: payload.expenseCommitmentId });
      }
    }
    const preferredCareerStateId = input.nextCareerStateIds?.length === 1
      ? input.nextCareerStateIds[0]
      : input.currentCareerStateId;
    if (payload && kind === "income_source_started" && ["salary", "contract", "self_employment_draw"].includes(String(payload.type))
      && preferredCareerStateId && (!payload.linkedCareerStateId || (input.nextCareerStateIds?.length === 1 && payload.linkedCareerStateId === input.currentCareerStateId))) {
      payload.linkedCareerStateId = preferredCareerStateId;
      audit.push({ proposalId: id, reasonCode: "CAREER_LINK_FILLED", normalizedValue: preferredCareerStateId });
    }
    if (payload && kind === "income_source_adjusted" && payload.nextSource
      && (!payload.nextSource.linkedCareerStateId || (input.nextCareerStateIds?.length === 1 && payload.nextSource.linkedCareerStateId === input.currentCareerStateId))) {
      const existingSource = input.currentLedger?.incomeSources.find((item) => item.id === payload.incomeSourceId);
      const linkedCareerStateId = input.nextCareerStateIds?.length === 1
        ? input.nextCareerStateIds[0]
        : existingSource?.linkedCareerStateId || preferredCareerStateId;
      if (linkedCareerStateId) {
        payload.nextSource.linkedCareerStateId = linkedCareerStateId;
        audit.push({ proposalId: id, reasonCode: "CAREER_LINK_FILLED", normalizedValue: linkedCareerStateId });
      }
    }
    const primaryCashId = input.currentLedger?.cashAccounts.find((item) => item.id === PRIMARY_CASH_ACCOUNT_ID && item.status === "active")?.id
      || input.currentLedger?.cashAccounts.find((item) => item.status === "active")?.id;
    if (payload && primaryCashId) {
      const needsDestination = ["one_off_income_received", "family_support_received", "debt_drawn", "liquidity_shortfall_created", "business_distribution_received"].includes(kind);
      const needsSource = ["one_off_expense_paid", "family_support_paid", "debt_principal_repaid", "debt_interest_paid"].includes(kind);
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
      effectiveAtAgeInMonths,
      payload,
      evidence: typeof source.evidence === "string" ? source.evidence : "",
      sourceOutcomeId,
      confidence: Number(source.confidence)
    } satisfies FinancialEventProposal];
  });
  return { proposals, audit };
}
