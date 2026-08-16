import type { FinancialState, WorldStateSnapshot } from "../../types";
import type { FinancialNodeGateMode } from "../../config/financialGatePolicy";
import type { CareerStateCollection } from "../career/types";
import { deriveFinancialState } from "./deriveFinancialState";
import { estimateExpenseResponsibility, expenseReviewIntervalMonths, type ExpenseEstimate } from "./expenseEstimationPolicyV2";
import { estimateUnclassifiedCoreConsumption } from "./expenseAggregateFallbackPolicyV1";
import { buildRequiredFinancialFactGroups, evaluateFinancialNodeAcceptance, type FinancialNodeAcceptanceDecision, type RequiredFinancialFactGroup } from "./financialNodeAcceptanceGate";
import { validateFinancialPayloadSchema } from "./financialProposalSchema";
import { initializeFinancialLedger } from "./initializeLedger";
import { roundWan } from "./ledgerMath";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import { preflightFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import type { OpeningExpenseFact, OpeningFinancialFacts } from "./openingFinancialFacts";
import type {
  AssetAccount,
  BusinessHolding,
  CashAccount,
  DebtAccount,
  ExpenseCommitment,
  ExpenseAmountBasis,
  ExpenseResponsibilityKind,
  FinancialEvidence,
  FinancialLedger,
  FinancialLedgerIssue,
  FinancialLedgerV4,
  IncomeSource
} from "./types";

export type OpeningFinancialFactKind = "cash" | "asset" | "debt" | "income_source" | "expense_commitment" | "business_holding";

export interface OpeningFinancialEventCandidate {
  id: string;
  kind: OpeningFinancialFactKind;
  payload: CashAccount | AssetAccount | DebtAccount | IncomeSource | ExpenseCommitment | BusinessHolding;
}

export interface AcceptedOpeningFinancialEvent extends OpeningFinancialEventCandidate {
  acceptedByReasonCodes: ["OPENING_SCHEMA", "OPENING_EVIDENCE", "OPENING_INVARIANTS"];
}

interface OpeningFinancialLedgerCandidate {
  ledger: FinancialLedgerV4;
  candidateEvents: OpeningFinancialEventCandidate[];
  issues: FinancialLedgerIssue[];
  canEnableV4: boolean;
}

export interface PreparedOpeningFinancialAuthority {
  candidate: OpeningFinancialLedgerCandidate;
  requiredFactGroups: RequiredFinancialFactGroup[];
  gateDecision: FinancialNodeAcceptanceDecision;
}

/**
 * The v4 fields are intentionally carried at this opening boundary already.
 * During the rolling v3 -> v4 migration this local intersection keeps the
 * opening protocol compatible with persisted v3 fixtures while preserving the
 * exact runtime shape for the v4 ledger migration.
 */
type OpeningExpenseCommitment = ExpenseCommitment & {
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  amountBasis: ExpenseAmountBasis;
  amountSourceIds: string[];
  estimationPolicyId?: string;
  financialScope: "personal" | "shared_household";
  participantPersonIds?: string[];
  householdShareRate?: number;
  confirmedMonthlyAmountWan?: number;
  grossMonthlyAmountWan?: number;
  plausibleMonthlyAmountRangeWan?: [number, number];
  lastConfirmedAtAgeInMonths?: number;
  lastReviewedAtAgeInMonths?: number;
  nextReviewAtAgeInMonths?: number;
};

function candidateEvent<T extends OpeningFinancialEventCandidate["payload"]>(kind: OpeningFinancialFactKind, payload: T): OpeningFinancialEventCandidate {
  return {
    id: `opening_candidate_${kind}_${payload.id}`,
    kind,
    payload: structuredClone(payload)
  };
}

function openingEvidence(input: {
  excerpt: string;
  reasonCode: string;
  scope: "personal" | "shared_household";
  confidence?: number;
}): FinancialEvidence {
  // shared_household is a v4 scope.  The cast is temporary compatibility for
  // a repository that can still read v3 ledgers during this rollout.
  return {
    source: "user",
    excerpt: input.excerpt,
    reasonCode: input.reasonCode,
    confidence: input.confidence ?? 1,
    financialScope: input.scope
  } as unknown as FinancialEvidence;
}

function policyEvidence(reasonCode: string): FinancialEvidence {
  return {
    source: "system_policy",
    reasonCode,
    confidence: 0.8,
    financialScope: "personal"
  };
}

function displayName(type: ExpenseCommitment["type"]): string {
  switch (type) {
    case "basic_living": return "基础生活支出";
    case "housing": return "住房持续支出";
    case "dependent_support": return "抚养与照护持续支出";
    case "healthcare": return "医疗持续支出";
    case "insurance": return "保险持续支出";
    case "education": return "教育持续支出";
    case "other": return "开局聚合支出（待拆分）";
  }
}

function compatibilityFacts(facts: OpeningFinancialFacts): OpeningExpenseFact[] {
  if (facts.expenseFacts?.length) return structuredClone(facts.expenseFacts);
  // Existing callers can still supply the old, user-extracted basic field.
  // Deliberately do not read proposedState.annualCoreExpenseWan here: that is
  // model compatibility output and is not an opening financial fact.
  if (facts.monthlyBasicLivingExpenseWan === undefined) return [];
  return [{
    id: "opening_expense_basic_living_compat",
    type: "basic_living",
    responsibilityKey: "adult_basic_living:protagonist",
    responsibilityKind: "adult_basic_living",
    cadence: "monthly",
    monthlyAmountWan: facts.monthlyBasicLivingExpenseWan,
    financialScope: "personal",
    factStatus: "known",
    amountBasis: "explicit_known",
    amountSourceId: "opening_user_basic_living_compat",
    evidenceText: facts.evidenceText
  }];
}

function openingEstimate(input: {
  state: FinancialState;
  responsibilityKind: OpeningExpenseFact["responsibilityKind"];
  livingArrangement?: "with_family" | "renting" | "owner_occupied" | "provided" | "unknown";
}): ExpenseEstimate | undefined {
  return estimateExpenseResponsibility({
    responsibilityKind: input.responsibilityKind,
    ageInMonths: input.state.asOfAgeInMonths,
    employmentStatus: input.state.employmentStatus,
    livingArrangement: input.livingArrangement || "unknown",
    cityCostBand: "unknown"
  });
}

function issue(input: {
  id: string;
  code: string;
  summary: string;
  ageInMonths: number;
  relatedAccountIds?: string[];
  relatedProposalIds?: string[];
}): FinancialLedgerIssue {
  return {
    id: input.id,
    code: input.code as FinancialLedgerIssue["code"],
    severity: "warning",
    status: "open",
    relatedProposalIds: input.relatedProposalIds || [],
    ...(input.relatedAccountIds ? { relatedAccountIds: input.relatedAccountIds } : {}),
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths
  };
}

function commitmentForFacts(input: {
  id: string;
  type: ExpenseCommitment["type"];
  responsibilityKey: string;
  responsibilityKind: OpeningExpenseFact["responsibilityKind"];
  facts: OpeningExpenseFact[];
  ageInMonths: number;
  fallbackMonthlyAmountWan?: number;
  fallbackEstimate?: ExpenseEstimate;
  /**
   * Most fallback estimates only price otherwise-unpriced facts.  A legacy
   * aggregate with unknown component coverage is different: the account must
   * conservatively reach max(P, T, F) even though P itself is numeric.  Keep
   * that exceptional top-up explicit so normal priced commitments never gain
   * an implicit second amount.
   */
  applyFallbackToPricedFacts?: boolean;
  forceNeedsReview?: boolean;
  forceAmountBasis?: OpeningExpenseCommitment["amountBasis"];
}): OpeningExpenseCommitment {
  // A known numeric amount can still need review because its coverage or
  // ownership is uncertain.  It remains the conservative accrual input; only
  // a missing number receives a policy estimate.
  const pricedFacts = input.facts.filter((fact) => fact.monthlyAmountWan !== undefined);
  const missingFacts = input.facts.filter((fact) => fact.monthlyAmountWan === undefined);
  const exactMonthlyAmountWan = roundWan(pricedFacts.reduce((sum, fact) => sum + (fact.monthlyAmountWan || 0), 0));
  const fallbackMonthlyAmountWan = input.fallbackMonthlyAmountWan ?? 0;
  const usesConservativeTopUp = missingFacts.length > 0 || input.applyFallbackToPricedFacts === true;
  const monthlyAmountWan = roundWan(exactMonthlyAmountWan + (usesConservativeTopUp ? fallbackMonthlyAmountWan : 0));
  if (monthlyAmountWan <= 0) {
    throw new Error(`Opening responsibility ${input.responsibilityKey} 缺少非零计提金额`);
  }
  const sharedFacts = pricedFacts.filter((fact) => fact.financialScope === "shared_household");
  const shared = sharedFacts.length > 0;
  const sameShareRate = shared && new Set(sharedFacts.map((fact) => fact.protagonistShareRate)).size === 1
    ? sharedFacts[0].protagonistShareRate
    : undefined;
  const allGross = shared && sharedFacts.length === pricedFacts.length && sharedFacts.every((fact) => fact.grossMonthlyAmountWan !== undefined);
  const grossMonthlyAmountWan = allGross
    ? roundWan(sharedFacts.reduce((sum, fact) => sum + (fact.grossMonthlyAmountWan || 0), 0))
    : undefined;
  const factStatus = input.forceNeedsReview || missingFacts.length > 0 || input.facts.some((fact) => fact.factStatus !== "known") ? "needs_review" : "known";
  const amountBasis = input.forceAmountBasis
    ?? (missingFacts.length > 0 ? "contextual_estimate" : shared ? "explicit_shared_amount" : "explicit_known");
  const evidence = [
    ...input.facts.map((fact) => openingEvidence({
      excerpt: fact.evidenceText,
      reasonCode: `OPENING_EXPENSE_${fact.type.toUpperCase()}`,
      scope: fact.financialScope
    })),
    ...(missingFacts.length > 0 || amountBasis === "policy_floor" || amountBasis === "legacy_estimate"
      ? [policyEvidence(`OPENING_EXPENSE_${input.responsibilityKind.toUpperCase()}_CONSERVATIVE_ESTIMATE`)]
      : [])
  ];
  return {
    id: input.id,
    type: input.type,
    displayName: displayName(input.type) + (factStatus === "needs_review" ? "（待确认）" : ""),
    monthlyAmountWan,
    activeFromAgeInMonths: input.ageInMonths,
    status: "active",
    factStatus,
    accrualReviewStatus: factStatus === "needs_review" ? "conservative" : "normal",
    evidence,
    responsibilityKey: input.responsibilityKey,
    responsibilityKind: input.responsibilityKind,
    amountBasis,
    amountSourceIds: input.facts.map((fact) => fact.amountSourceId),
    ...(factStatus === "known" ? { confirmedMonthlyAmountWan: monthlyAmountWan, lastConfirmedAtAgeInMonths: input.ageInMonths } : {}),
    ...(grossMonthlyAmountWan !== undefined ? { grossMonthlyAmountWan } : {}),
    ...(sameShareRate !== undefined ? { householdShareRate: sameShareRate, participantPersonIds: ["opening_shared_household"] } : {}),
    financialScope: shared ? "shared_household" : "personal",
    ...(factStatus === "needs_review"
      ? {
          plausibleMonthlyAmountRangeWan: input.fallbackEstimate?.plausibleRangeWan
            || [roundWan(monthlyAmountWan * 0.75), roundWan(monthlyAmountWan * 1.4)],
          estimationPolicyId: input.fallbackEstimate?.policyId || "cn_opening_responsibility_conservative@1"
        }
      : {}),
    lastReviewedAtAgeInMonths: input.ageInMonths,
    nextReviewAtAgeInMonths: input.ageInMonths + expenseReviewIntervalMonths(input.responsibilityKind)
  } as OpeningExpenseCommitment;
}

function groupedFacts(facts: OpeningExpenseFact[]): Map<string, OpeningExpenseFact[]> {
  const groups = new Map<string, OpeningExpenseFact[]>();
  for (const fact of facts) {
    const group = groups.get(fact.responsibilityKey) || [];
    group.push(fact);
    groups.set(fact.responsibilityKey, group);
  }
  return groups;
}

function deduplicateRepeatedOpeningFacts(facts: OpeningExpenseFact[]): OpeningExpenseFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    // Questionnaire fields often restate the same current bill in different
    // words. Repetition is corroborating evidence, not a second liability.
    // Different amounts, scopes, cadence or shares remain distinct components.
    const semanticKey = [
      fact.type,
      fact.responsibilityKey,
      fact.monthlyAmountWan ?? "unknown",
      fact.grossMonthlyAmountWan ?? "unknown",
      fact.protagonistShareRate ?? "unknown",
      fact.financialScope,
      fact.cadence
    ].join(":");
    if (seen.has(semanticKey)) return false;
    seen.add(semanticKey);
    return true;
  });
}

function buildOpeningExpenseCommitments(input: {
  state: FinancialState;
  openingFacts: OpeningFinancialFacts;
}): { commitments: ExpenseCommitment[]; issues: FinancialLedgerIssue[] } {
  const facts = deduplicateRepeatedOpeningFacts(compatibilityFacts(input.openingFacts))
    .filter((fact) => fact.cadence !== "one_off");
  const basicEstimate = openingEstimate({
    state: input.state,
    responsibilityKind: "adult_basic_living"
  });
  const floor = basicEstimate?.accrualMonthlyAmountWan;
  const basicFacts = facts.filter((fact) => fact.type === "basic_living");
  const aggregateFacts = facts.filter((fact) => fact.type === "aggregate");
  const componentFacts = facts.filter((fact) => fact.type !== "basic_living" && fact.type !== "aggregate");
  const componentIssues: FinancialLedgerIssue[] = [];
  const componentCommitments: ExpenseCommitment[] = [];
  for (const [responsibilityKey, group] of groupedFacts(componentFacts).entries()) {
    const first = group[0];
    const needsEstimate = group.some((fact) => fact.monthlyAmountWan === undefined);
    const estimate = needsEstimate ? openingEstimate({
      state: input.state,
      responsibilityKind: first.responsibilityKind,
      livingArrangement: first.responsibilityKind === "primary_residence" ? "unknown" : undefined
    }) : undefined;
    if (needsEstimate && !estimate) {
      componentIssues.push(openingBlockingIssue({
        id: `opening_policy_missing_${responsibilityKey.replace(/[^a-z0-9]+/giu, "_")}`,
        code: "EXPENSE_ESTIMATION_POLICY_MISSING",
        summary: `Opening 责任 ${responsibilityKey} 缺少适用的 V2 支出估计策略，不能以 basic floor 或零金额替代`,
        ageInMonths: input.state.asOfAgeInMonths,
        relatedProposalIds: group.map((fact) => fact.id)
      }));
      continue;
    }
    componentCommitments.push(commitmentForFacts({
      id: `opening_${responsibilityKey.replace(/[^a-z0-9]+/giu, "_")}`,
      type: first.type as Exclude<OpeningExpenseFact["type"], "aggregate">,
      responsibilityKey,
      responsibilityKind: first.responsibilityKind,
      facts: group,
      ageInMonths: input.state.asOfAgeInMonths,
      fallbackMonthlyAmountWan: estimate?.accrualMonthlyAmountWan,
      fallbackEstimate: estimate
    }));
  }
  const componentTotal = roundWan(componentCommitments.reduce((sum, commitment) => sum + commitment.monthlyAmountWan, 0));
  const explicitComponentTotal = roundWan(componentFacts
    .filter((fact) => fact.factStatus === "known" && fact.monthlyAmountWan !== undefined)
    .reduce((sum, fact) => sum + (fact.monthlyAmountWan || 0), 0));
  const explicitBasic = roundWan(basicFacts.reduce((sum, fact) => sum + (fact.monthlyAmountWan || 0), 0));
  const minimumBasic = Math.max(explicitBasic, floor || 0);
  const basicFact = basicFacts.length ? basicFacts : [{
    id: "opening_expense_basic_living_policy",
    type: "basic_living" as const,
    responsibilityKey: "adult_basic_living:protagonist",
    responsibilityKind: "adult_basic_living" as const,
    cadence: "recurring_unknown" as const,
    financialScope: "personal" as const,
    factStatus: "needs_review" as const,
    amountBasis: "contextual_estimate" as const,
    amountSourceId: "opening_policy_adult_basic_living",
    evidenceText: "Opening 个人基础生活支出使用年龄对应的最低保护线"
  }];
  const basicCommitment = (monthlyAmountWan: number, forceNeedsReview = false, forceAmountBasis?: OpeningExpenseCommitment["amountBasis"]) => {
    if (monthlyAmountWan <= 0) return undefined;
    return commitmentForFacts({
      id: "opening_adult_basic_living_protagonist",
      type: "basic_living",
      responsibilityKey: "adult_basic_living:protagonist",
      responsibilityKind: "adult_basic_living",
      facts: basicFact,
      ageInMonths: input.state.asOfAgeInMonths,
      fallbackMonthlyAmountWan: Math.max(0, monthlyAmountWan - explicitBasic),
      fallbackEstimate: basicEstimate,
      forceNeedsReview,
      forceAmountBasis
    });
  };

  const aggregate = aggregateFacts.find((fact) => fact.monthlyAmountWan !== undefined);
  if (aggregate) {
    const aggregateMonthlyAmountWan = aggregate.monthlyAmountWan || 0;
    const coverage = aggregate.coverage || "unknown";
    if (coverage === "unknown") {
      // Unknown coverage is intentionally a *single* account.  Components
      // remain evidence/candidates only until a later accepted split can prove
      // whether they are included in P; adding both would double-count.
      const aggregateAccrual = Math.max(aggregateMonthlyAmountWan, explicitComponentTotal, floor || 0);
      const commitment = commitmentForFacts({
        id: `opening_legacy_aggregate_${input.state.asOfAgeInMonths}`,
        type: "other",
        responsibilityKey: `legacy_aggregate:${input.state.asOfAgeInMonths}`,
        responsibilityKind: "legacy_aggregate",
        facts: [aggregate],
        ageInMonths: input.state.asOfAgeInMonths,
        fallbackMonthlyAmountWan: aggregateAccrual - aggregateMonthlyAmountWan,
        applyFallbackToPricedFacts: true,
        forceNeedsReview: true,
        forceAmountBasis: "legacy_estimate"
      });
      return {
        commitments: [commitment],
        issues: [...componentIssues, issue({
          id: `expense_opening_component_gap_${input.state.asOfAgeInMonths}`,
          code: "EXPENSE_OPENING_COMPONENT_GAP",
          summary: "开局总支出与住房、抚养或医疗分项的覆盖关系未知；仅保留单一聚合保守计提，等待原子拆分",
          ageInMonths: input.state.asOfAgeInMonths,
          relatedAccountIds: [commitment.id],
          relatedProposalIds: componentFacts.map((fact) => fact.id)
        })]
      };
    }
    if (coverage === "fully_covers") {
      const targetTotal = Math.max(aggregateMonthlyAmountWan, componentTotal + (floor || 0), componentTotal + explicitBasic);
      const residualBasic = roundWan(Math.max(floor || 0, explicitBasic, targetTotal - componentTotal));
      const basic = basicCommitment(residualBasic, basicFact.some((fact) => fact.factStatus !== "known"), "legacy_estimate");
      return { commitments: [...componentCommitments, ...(basic ? [basic] : [])], issues: componentIssues };
    }
    // A basic-only aggregate is explicitly disjoint from the named components.
    const basic = basicCommitment(Math.max(aggregateMonthlyAmountWan, minimumBasic), basicFact.some((fact) => fact.factStatus !== "known"), "legacy_estimate");
    return { commitments: [...componentCommitments, ...(basic ? [basic] : [])], issues: componentIssues };
  }

  const basic = basicCommitment(minimumBasic, basicFact.some((fact) => fact.factStatus !== "known"), basicFacts.length ? undefined : "policy_floor");
  const onlyPolicyBasic = basic
    && basicFacts.length === 0
    && componentCommitments.length === 0
    && input.state.employmentStatus !== "student";
  const aggregateEstimate = onlyPolicyBasic ? estimateUnclassifiedCoreConsumption({
    ageInMonths: input.state.asOfAgeInMonths,
    employmentStatus: input.state.employmentStatus,
    livingArrangement: "unknown",
    cityCostBand: "unknown",
    annualRecurringPersonalIncomeWan: input.state.annualAfterTaxIncomeWan
  }) : undefined;
  const residualWan = roundWan(Math.max(0, (aggregateEstimate?.targetMonthlyCoreExpenseWan || 0) - (basic?.monthlyAmountWan || 0)));
  const unclassified: OpeningExpenseCommitment | undefined = aggregateEstimate && residualWan > 0 ? {
    id: `opening_unclassified_core_consumption_${input.state.asOfAgeInMonths}`,
    type: "other",
    displayName: "未分类核心生活支出估算（待确认）",
    monthlyAmountWan: residualWan,
    activeFromAgeInMonths: input.state.asOfAgeInMonths,
    status: "active",
    factStatus: "needs_review",
    accrualReviewStatus: "conservative",
    evidence: [{
      source: "system_policy",
      reasonCode: "EXPENSE_UNCLASSIFIED_CORE_CONSUMPTION",
      excerpt: "Opening 缺少可安全拆分的持续支出分项；仅建立未分类余额，不推断住房、医疗或家庭责任",
      confidence: 1,
      financialScope: "personal"
    }],
    responsibilityKey: "unclassified_core_consumption:protagonist",
    responsibilityKind: "unclassified_core_consumption",
    amountBasis: "contextual_estimate",
    amountSourceIds: [`${aggregateEstimate.policyId}@${aggregateEstimate.policyVersion}`],
    estimationPolicyId: aggregateEstimate.policyId,
    financialScope: "personal",
    plausibleMonthlyAmountRangeWan: aggregateEstimate.plausibleRangeWan,
    lastReviewedAtAgeInMonths: input.state.asOfAgeInMonths,
    nextReviewAtAgeInMonths: input.state.asOfAgeInMonths + 12
  } : undefined;
  return {
    commitments: [...componentCommitments, ...(basic ? [basic] : []), ...(unclassified ? [unclassified] : [])],
    issues: componentIssues
  };
}

/**
 * Opening has position semantics rather than normal-period cash-flow
 * semantics, so it keeps its own adapter.  This function deliberately stops
 * at a candidate V4 ledger: nothing here is an accepted opening event yet.
 */
function buildOpeningFinancialLedgerCandidate(input: {
  id: string;
  proposedState: FinancialState;
  linkedCareerStateId: string;
  openingFacts: OpeningFinancialFacts;
}): OpeningFinancialLedgerCandidate {
  // During migration the legacy adapter is only a proposal builder. Its ledger
  // is never installed as authority until the opening Preview and gate allow it.
  const candidate = migrateLegacyFinancialState({
    id: `${input.id}_candidate`, legacyState: input.proposedState,
    linkedCareerStateId: input.linkedCareerStateId, openingFacts: input.openingFacts
  });
  const openingExpenses = buildOpeningExpenseCommitments({ state: input.proposedState, openingFacts: input.openingFacts });
  const candidateEvents = [
    ...candidate.cashAccounts.map((item) => candidateEvent("cash", item)),
    ...candidate.assetAccounts.map((item) => candidateEvent("asset", item)),
    ...candidate.debtAccounts.map((item) => candidateEvent("debt", item)),
    ...candidate.incomeSources.map((item) => candidateEvent("income_source", item)),
    ...openingExpenses.commitments.map((item) => candidateEvent("expense_commitment", item)),
    ...candidate.businessHoldings.map((item) => candidateEvent("business_holding", item))
  ];
  const ids = new Set<string>();
  const candidateIssues: FinancialLedgerIssue[] = [];
  for (const event of candidateEvents) {
    if (ids.has(event.payload.id)) {
      candidateIssues.push(openingBlockingIssue({
        id: `opening_schema_duplicate_id_${event.payload.id}`,
        code: "EXPENSE_SCHEMA_FIELD_MISMATCH",
        summary: `Opening financial candidate id 重复：${event.payload.id}`,
        ageInMonths: input.proposedState.asOfAgeInMonths,
        relatedProposalIds: [event.id]
      }));
    }
    ids.add(event.payload.id);
  }
  candidateIssues.push(...openingCandidateSchemaIssues({
    candidateEvents,
    openingFacts: input.openingFacts,
    ageInMonths: input.proposedState.asOfAgeInMonths
  }));
  const byKind = <T extends OpeningFinancialEventCandidate["payload"]>(kind: OpeningFinancialFactKind) => (
    candidateEvents.filter((event) => event.kind === kind).map((event) => structuredClone(event.payload) as T)
  );
  const v3Ledger = initializeFinancialLedger({
    id: input.id,
    asOfAgeInMonths: input.proposedState.asOfAgeInMonths,
    openingPosition: {
      cashAccounts: byKind<CashAccount>("cash"), assetAccounts: byKind<AssetAccount>("asset"),
      debtAccounts: byKind<DebtAccount>("debt"), incomeSources: byKind<IncomeSource>("income_source"),
      expenseCommitments: byKind<ExpenseCommitment>("expense_commitment"),
      businessHoldings: byKind<BusinessHolding>("business_holding"),
      unresolvedIssues: [...structuredClone(candidate.unresolvedIssues), ...openingExpenses.issues, ...candidateIssues]
    }
  });
  // Every newly initialized simulation can write a canonical V4 ledger only
  // after migration eligibility and the opening acceptance gate are both
  // satisfied.  The V4 candidate is nevertheless retained for the preview,
  // diagnostics and a user-actionable rejection.
  const migrationPreflight = preflightFinancialLedgerV3ToV4(v3Ledger);
  const issues = [
    ...migrationPreflight.ledger.unresolvedIssues,
    ...candidateIssues.filter((item) => !migrationPreflight.ledger.unresolvedIssues.some((known) => known.id === item.id))
  ];
  return {
    ledger: migrationPreflight.ledger,
    candidateEvents,
    issues,
    canEnableV4: migrationPreflight.canEnableV4
  };
}

function openingBlockingIssue(input: {
  id: string;
  code: FinancialLedgerIssue["code"];
  summary: string;
  ageInMonths: number;
  relatedProposalIds?: string[];
}): FinancialLedgerIssue {
  return {
    id: input.id,
    code: input.code,
    severity: "blocking",
    status: "open",
    relatedProposalIds: input.relatedProposalIds || [],
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths
  };
}

function openingCandidateSchemaIssues(input: {
  candidateEvents: OpeningFinancialEventCandidate[];
  openingFacts: OpeningFinancialFacts;
  ageInMonths: number;
}): FinancialLedgerIssue[] {
  const issues: FinancialLedgerIssue[] = [];
  const kindFor = (kind: OpeningFinancialFactKind) => ({
    income_source: "income_source_started",
    expense_commitment: "expense_commitment_started",
    asset: "asset_balance_discovered",
    debt: "debt_balance_discovered"
  } as const)[kind];
  for (const event of input.candidateEvents) {
    if (!event.payload.id || !Array.isArray(event.payload.evidence) || event.payload.evidence.length === 0) {
      issues.push(openingBlockingIssue({
        id: `opening_schema_missing_provenance_${event.id}`,
        code: "PENDING_FACT",
        summary: `Opening ${event.kind} 缺少稳定 id 或可追溯 evidence，不能成为权威账本事实`,
        ageInMonths: input.ageInMonths,
        relatedProposalIds: [event.id]
      }));
      continue;
    }
    const validationKind = kindFor(event.kind);
    if (!validationKind) continue;
    const schemaPayload = event.kind === "asset"
      ? { assetAccount: event.payload }
      : event.kind === "debt"
        ? { debtAccount: event.payload }
        : event.payload;
    const errors = validateFinancialPayloadSchema(validationKind, schemaPayload);
    if (errors.length === 0) continue;
    issues.push(openingBlockingIssue({
      id: `opening_schema_invalid_${event.id}`,
      code: event.kind === "expense_commitment" ? "EXPENSE_SCHEMA_FIELD_MISMATCH" : "PENDING_FACT",
      summary: `Opening ${event.kind} schema 无效：${errors.map((error) => `${error.path} ${error.reason}`).join("；")}`,
      ageInMonths: input.ageInMonths,
      relatedProposalIds: [event.id]
    }));
  }
  for (const fact of input.openingFacts.expenseFacts || []) {
    const scope = String((fact as { financialScope?: unknown }).financialScope || "");
    if (["personal", "shared_household"].includes(scope)) continue;
    issues.push(openingBlockingIssue({
      id: `opening_schema_scope_${fact.id}`,
      code: "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT",
      summary: `Opening 支出事实 ${fact.id} 的范围 ${scope || "缺失"} 不能写入个人持续支出账户`,
      ageInMonths: input.ageInMonths,
      relatedProposalIds: [fact.id]
    }));
  }
  return issues;
}

/**
 * Runs the same gate evaluator used by a normal node against a zero-period
 * opening position preview.  There is intentionally no synthetic cash-flow
 * transaction: opening balances are positions, not first-period income or
 * expenses.  A blocking opening fact is always enforced so shadow mode cannot
 * persist a malformed starting authority.
 */
export function prepareOpeningFinancialAuthority(input: {
  id: string;
  proposedState: FinancialState;
  linkedCareerStateId: string;
  openingFacts: OpeningFinancialFacts;
  currentCareer: CareerStateCollection;
  currentWorldState: WorldStateSnapshot;
  mode: FinancialNodeGateMode;
}): PreparedOpeningFinancialAuthority {
  const candidate = buildOpeningFinancialLedgerCandidate(input);
  const currentCareer = input.currentCareer.careerStates.find((state) => state.id === input.currentCareer.currentCareerStateId);
  if (!currentCareer) throw new Error("Opening financial Preview 缺少当前 CareerState");
  const preview = {
    career: structuredClone(input.currentCareer),
    financialLedger: structuredClone(candidate.ledger),
    worldState: structuredClone(input.currentWorldState),
    derivedFinancialState: deriveFinancialState({
      ledger: candidate.ledger,
      employmentStatus: currentCareer.employmentStatus
    }),
    alreadyCommitted: false
  };
  const requiredFactGroups = buildRequiredFinancialFactGroups({
    issues: candidate.issues,
    rejectedCompletedProposals: [],
    ageInMonths: input.proposedState.asOfAgeInMonths
  });
  const hasBlockingOpeningIssue = candidate.issues.some((item) => (
    item.status !== "resolved" && item.severity === "blocking"
  ));
  const gateDecision = evaluateFinancialNodeAcceptance({
    mode: hasBlockingOpeningIssue || !candidate.canEnableV4 ? "enforced" : input.mode,
    preview,
    requiredFactGroups,
    expectedAgeInMonths: input.proposedState.asOfAgeInMonths,
    transactionId: `opening_${input.id}`,
    authoritativeAgeBefore: input.proposedState.asOfAgeInMonths
  });
  return { candidate, requiredFactGroups, gateDecision };
}

/** Materialization is the sole writer for opening accepted event ids. */
export function commitPreparedOpeningFinancialAuthority(input: PreparedOpeningFinancialAuthority): {
  ledger: FinancialLedger;
  acceptedEvents: AcceptedOpeningFinancialEvent[];
} {
  if (!input.gateDecision.allowDomainCommit) {
    throw new Error(`Opening financial acceptance gate rejected candidate: ${input.gateDecision.reasonCodes.join(",")}`);
  }
  const acceptedEvents = input.candidate.candidateEvents.map((event) => ({
    ...structuredClone(event),
    id: `accepted_opening_${event.kind}_${event.payload.id}`,
    acceptedByReasonCodes: ["OPENING_SCHEMA", "OPENING_EVIDENCE", "OPENING_INVARIANTS"] as ["OPENING_SCHEMA", "OPENING_EVIDENCE", "OPENING_INVARIANTS"]
  }));
  const ledger = structuredClone(input.candidate.ledger);
  ledger.openingAcceptedEventIds = acceptedEvents.map((event) => event.id);
  return { ledger, acceptedEvents };
}
