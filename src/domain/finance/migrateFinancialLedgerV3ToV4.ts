import { assertFinancialLedgerInvariants, roundWan } from "./ledgerMath";
import type {
  ExpenseAmountBasis,
  ExpenseCommitment,
  ExpenseCommitmentType,
  ExpenseCommitmentV4,
  ExpenseResponsibilityKind,
  FinancialEvidence,
  FinancialLedgerIssue,
  FinancialLedgerV3,
  FinancialLedgerV4
} from "./types";

const REVIEW_INTERVAL_MONTHS: Record<ExpenseResponsibilityKind, number> = {
  adult_basic_living: 60,
  primary_residence: 36,
  child_support: 12,
  elder_care: 12,
  recurring_healthcare: 12,
  personal_insurance: 24,
  continuing_education: 12,
  legacy_aggregate: 12
};

const BUSINESS_PREMISE_PATTERN = /工坊|工作室|办公室|办公场地|仓库|门店|厂房|服务器|员工工资|团队工资|经营成本|公司租金/u;
const THIRD_PARTY_PATTERN = /由(?:配偶|父母|公司|他人|对方|第三方)(?:承担|支付)|他方(?:承担|支付)/u;
const MORTGAGE_PAYMENT_PATTERN = /月供|房贷(?:还款|月供|本息)|mortgage[_\s-]?payment/iu;

function textFor(commitment: ExpenseCommitment): string {
  return [
    commitment.id,
    commitment.displayName,
    ...commitment.evidence.map((item) => `${item.reasonCode} ${item.excerpt || ""}`)
  ].join(" ");
}

function hasAuthoritativeEvidence(evidence: FinancialEvidence[]): boolean {
  return evidence.some((item) => (
    item.source === "user"
    || item.source === "accepted_history"
    || item.source === "accepted_simulation_outcome"
  ));
}

function evidenceSourceIds(commitment: ExpenseCommitment): string[] {
  const ids = commitment.evidence
    .map((item) => item.sourceEventId || item.sourceChoiceId || item.sourceNodeId || item.reasonCode)
    .filter(Boolean);
  return [...new Set(ids.length > 0 ? ids : [`migration:v3:${commitment.id}`])];
}

function isLegacyAggregate(commitment: ExpenseCommitment): boolean {
  const text = textFor(commitment);
  return commitment.id === "legacy_core_expense"
    || /legacy[_\s-]?core[_\s-]?expense|旧版(?:核心)?支出聚合|aggregate/i.test(text);
}

function responsibilityFor(commitment: ExpenseCommitment): {
  responsibilityKind: ExpenseResponsibilityKind;
  responsibilityKey: string;
} {
  if (commitment.responsibilityKind && commitment.responsibilityKey) {
    return {
      responsibilityKind: commitment.responsibilityKind,
      responsibilityKey: commitment.responsibilityKey
    };
  }
  const text = textFor(commitment);
  if (isLegacyAggregate(commitment)) {
    return { responsibilityKind: "legacy_aggregate", responsibilityKey: "legacy_aggregate:opening" };
  }
  switch (commitment.type) {
    case "basic_living":
      return { responsibilityKind: "adult_basic_living", responsibilityKey: "adult_basic_living:protagonist" };
    case "housing":
      return { responsibilityKind: "primary_residence", responsibilityKey: "primary_residence:main" };
    case "dependent_support":
      return /孩子|子女|育儿|抚养|child|baby/i.test(text)
        ? { responsibilityKind: "child_support", responsibilityKey: `child_support:${commitment.id}` }
        : { responsibilityKind: "elder_care", responsibilityKey: `elder_care:${commitment.id}` };
    case "healthcare":
      return { responsibilityKind: "recurring_healthcare", responsibilityKey: `recurring_healthcare:${commitment.id}` };
    case "insurance":
      return { responsibilityKind: "personal_insurance", responsibilityKey: `personal_insurance:${commitment.id}` };
    case "education":
      return { responsibilityKind: "continuing_education", responsibilityKey: `continuing_education:${commitment.id}` };
    case "other":
      return { responsibilityKind: "legacy_aggregate", responsibilityKey: `legacy_aggregate:${commitment.id}` };
  }
}

function amountBasisFor(commitment: ExpenseCommitment, responsibilityKind: ExpenseResponsibilityKind): ExpenseAmountBasis {
  if (commitment.amountBasis) return commitment.amountBasis;
  // A legacy aggregate has no trustworthy component coverage even when the
  // old snapshot happened to mark its total as known.  Preserve its amount,
  // but force the v4 review/split protocol instead of treating it as an
  // authoritative atomic fact.
  if (responsibilityKind === "legacy_aggregate") return "legacy_estimate";
  if (commitment.factStatus === "known" && hasAuthoritativeEvidence(commitment.evidence)) return "explicit_known";
  if (responsibilityKind === "adult_basic_living"
    && commitment.evidence.some((item) => item.source === "system_policy")) return "policy_floor";
  if (commitment.evidence.some((item) => item.source === "legacy_migration")) {
    return "legacy_estimate";
  }
  if (commitment.factStatus === "estimated") return "contextual_estimate";
  return "last_known";
}

function policyIdFor(commitment: ExpenseCommitment, amountBasis: ExpenseAmountBasis): string | undefined {
  if (commitment.estimationPolicyId) return commitment.estimationPolicyId;
  if (amountBasis === "policy_floor") return "cn_conservative_basic_living@1";
  if (amountBasis === "contextual_estimate") return "expense-estimation-policy-v2:migrated-contextual";
  if (amountBasis === "legacy_estimate") {
    return commitment.evidence.find((item) => item.source === "legacy_migration")?.reasonCode || "legacy-financial-ledger-v3";
  }
  return undefined;
}

function issue(input: {
  id: string;
  code: FinancialLedgerIssue["code"];
  severity: FinancialLedgerIssue["severity"];
  accountId: string;
  summary: string;
  ageInMonths: number;
}): FinancialLedgerIssue {
  return {
    id: input.id,
    code: input.code,
    severity: input.severity,
    status: "open",
    relatedProposalIds: [],
    relatedAccountIds: [input.accountId],
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths
  };
}

function looksBusinessOrThirdParty(commitment: ExpenseCommitment): "business" | "third_party" | undefined {
  if (commitment.financialScope === "business_operating"
    || commitment.evidence.some((item) => item.financialScope === "business_operating")
    || BUSINESS_PREMISE_PATTERN.test(textFor(commitment))) return "business";
  if (commitment.financialScope === "third_party"
    || commitment.evidence.some((item) => item.financialScope === "third_party")
    || THIRD_PARTY_PATTERN.test(textFor(commitment))) return "third_party";
  return undefined;
}

function reviewClock(input: {
  commitment: ExpenseCommitment;
  responsibilityKind: ExpenseResponsibilityKind;
  asOfAgeInMonths: number;
  explicit: boolean;
}): Pick<ExpenseCommitmentV4, "lastConfirmedAtAgeInMonths" | "lastReviewedAtAgeInMonths" | "nextReviewAtAgeInMonths" | "accrualReviewStatus"> {
  if (Number.isInteger(input.commitment.nextReviewAtAgeInMonths)
    && (input.commitment.nextReviewAtAgeInMonths as number) >= input.commitment.activeFromAgeInMonths
    && input.commitment.accrualReviewStatus) {
    return {
      lastConfirmedAtAgeInMonths: input.commitment.lastConfirmedAtAgeInMonths,
      lastReviewedAtAgeInMonths: input.commitment.lastReviewedAtAgeInMonths,
      nextReviewAtAgeInMonths: input.commitment.nextReviewAtAgeInMonths as number,
      accrualReviewStatus: input.commitment.accrualReviewStatus
    };
  }
  const interval = REVIEW_INTERVAL_MONTHS[input.responsibilityKind];
  const effectiveFrom = Number.isInteger(input.commitment.activeFromAgeInMonths)
    ? input.commitment.activeFromAgeInMonths
    : input.asOfAgeInMonths;
  const lastConfirmedAtAgeInMonths = input.explicit
    ? input.commitment.lastConfirmedAtAgeInMonths ?? effectiveFrom
    : undefined;
  const reference = lastConfirmedAtAgeInMonths
    ?? input.commitment.lastReviewedAtAgeInMonths
    ?? effectiveFrom;
  const dueAt = reference + interval;
  const due = dueAt <= input.asOfAgeInMonths || input.commitment.factStatus === "needs_review";
  return {
    lastConfirmedAtAgeInMonths,
    lastReviewedAtAgeInMonths: input.commitment.lastReviewedAtAgeInMonths ?? (due ? input.asOfAgeInMonths : undefined),
    nextReviewAtAgeInMonths: due ? input.asOfAgeInMonths : dueAt,
    accrualReviewStatus: due
      ? "review_due"
      : input.commitment.accrualReviewStatus === "conservative"
        || input.commitment.factStatus === "estimated"
          ? "conservative"
          : "normal"
  };
}

/**
 * Canonicalizes a single compatibility commitment for a V4 write boundary.
 * The caller must surface returned issues through its transaction/gate path;
 * this helper deliberately never mutates the input commitment.
 */
export function canonicalizeExpenseCommitmentV4(input: {
  commitment: ExpenseCommitment;
  asOfAgeInMonths: number;
}): { commitment: ExpenseCommitmentV4; issues: FinancialLedgerIssue[] } {
  const legacy = structuredClone(input.commitment);
  const { responsibilityKind, responsibilityKey } = responsibilityFor(legacy);
  let amountBasis = amountBasisFor(legacy, responsibilityKind);
  let explicit = amountBasis === "explicit_known" || amountBasis === "explicit_shared_amount";
  const scopeConflict = looksBusinessOrThirdParty(legacy);
  const activeFromAgeInMonths = Number.isInteger(legacy.activeFromAgeInMonths)
    ? legacy.activeFromAgeInMonths
    : input.asOfAgeInMonths;
  const issues: FinancialLedgerIssue[] = [];
  let status = legacy.status;
  let factStatus = legacy.factStatus;

  if (status === "active" && legacy.monthlyAmountWan <= 0) {
    status = "paused";
    factStatus = "needs_review";
    issues.push(issue({
      id: `v4_migration_zero_active_expense_${legacy.id}`,
      code: "EXPENSE_UNKNOWN_ZERO_AMOUNT",
      severity: "blocking",
      accountId: legacy.id,
      summary: `旧版支出 ${legacy.displayName} 为 active 但金额为零；V4 已停止未来计提，等待确认金额`,
      ageInMonths: input.asOfAgeInMonths
    }));
  }

  if (status === "active" && factStatus === "unknown") {
    factStatus = "needs_review";
    issues.push(issue({
      id: `v4_migration_unknown_active_expense_${legacy.id}`,
      code: "PENDING_FACT",
      severity: "warning",
      accountId: legacy.id,
      summary: `旧版支出 ${legacy.displayName} 已知存在但金额来源不完整；V4 保留非零计提并标记为 needs_review`,
      ageInMonths: input.asOfAgeInMonths
    }));
  }

  if (scopeConflict) {
    status = "paused";
    factStatus = "needs_review";
    // The evidence remains available for the migration audit, but it cannot
    // remain an explicit personal amount while it establishes a business or
    // third-party scope conflict.
    if (explicit) {
      amountBasis = "last_known";
      explicit = false;
    }
    issues.push(issue({
      id: `v4_migration_scope_conflict_${legacy.id}`,
      code: scopeConflict === "business" ? "EXPENSE_BUSINESS_FLOW_IN_PERSONAL_LEDGER" : "EXPENSE_THIRD_PARTY_LIABILITY",
      severity: "blocking",
      accountId: legacy.id,
      summary: scopeConflict === "business"
        ? `旧版支出 ${legacy.displayName} 含经营场地或经营成本证据，已禁止继续作为个人支出计提`
        : `旧版支出 ${legacy.displayName} 显示由第三方承担，已禁止继续作为个人支出计提`,
      ageInMonths: input.asOfAgeInMonths
    }));
  }

  const clock = reviewClock({
    commitment: { ...legacy, activeFromAgeInMonths, factStatus },
    responsibilityKind,
    asOfAgeInMonths: input.asOfAgeInMonths,
    explicit
  });
  const v4: ExpenseCommitmentV4 = {
    ...legacy,
    activeFromAgeInMonths,
    activeUntilAgeInMonths: status === "ended"
      ? legacy.activeUntilAgeInMonths ?? input.asOfAgeInMonths
      : status === "paused"
        ? undefined
        : legacy.activeUntilAgeInMonths,
    status,
    factStatus,
    responsibilityKey,
    responsibilityKind,
    grossMonthlyAmountWan: legacy.grossMonthlyAmountWan,
    confirmedMonthlyAmountWan: explicit ? legacy.confirmedMonthlyAmountWan ?? roundWan(legacy.monthlyAmountWan) : undefined,
    plausibleMonthlyAmountRangeWan: legacy.plausibleMonthlyAmountRangeWan,
    amountBasis,
    amountSourceIds: legacy.amountSourceIds?.length ? [...new Set(legacy.amountSourceIds)] : evidenceSourceIds(legacy),
    estimationPolicyId: policyIdFor(legacy, amountBasis),
    financialScope: legacy.financialScope === "shared_household" ? "shared_household" : "personal",
    participantPersonIds: legacy.participantPersonIds ? [...new Set(legacy.participantPersonIds)] : undefined,
    householdShareRate: legacy.householdShareRate,
    ...clock,
    evidence: structuredClone(legacy.evidence)
  };

  if (responsibilityKind === "legacy_aggregate" && status === "active") {
    v4.factStatus = "needs_review";
    v4.accrualReviewStatus = "review_due";
    v4.nextReviewAtAgeInMonths = input.asOfAgeInMonths;
    issues.push(issue({
      id: `v4_migration_aggregate_review_${legacy.id}`,
      code: "EXPENSE_OPENING_COMPONENT_GAP",
      severity: "warning",
      accountId: legacy.id,
      summary: `旧版聚合支出 ${legacy.displayName} 保留原计提，等待分类分项与覆盖关系确认`,
      ageInMonths: input.asOfAgeInMonths
    }));
  }
  return { commitment: v4, issues };
}

function isMortgagePaymentCommitment(commitment: ExpenseCommitmentV4): boolean {
  return commitment.type === "housing" && MORTGAGE_PAYMENT_PATTERN.test(textFor(commitment));
}

/**
 * A V3 `legacy_core_expense` had no machine-readable coverage relationship
 * to the classified commitments that may have been added beside it later.
 * Treating that relationship as disjoint would double accrue cash; treating
 * it as fully covered would silently lose a real responsibility.  Preserve
 * the aggregate as the sole prospective accrual and retain every component as
 * a paused, reviewable record until an accepted atomic split supplies the
 * missing coverage fact.
 */
function quarantineUnknownAggregateComponents(input: {
  commitments: ExpenseCommitmentV4[];
  migrationIssues: FinancialLedgerIssue[];
  ageInMonths: number;
}): void {
  const activeAggregates = input.commitments.filter((commitment) => (
    commitment.status === "active" && commitment.responsibilityKind === "legacy_aggregate"
  ));
  if (activeAggregates.length === 0) return;

  for (const aggregate of activeAggregates) {
    const activeComponents = input.commitments.filter((commitment) => (
      commitment.status === "active"
      && commitment.id !== aggregate.id
      && commitment.responsibilityKind !== "legacy_aggregate"
    ));
    for (const component of activeComponents) {
      component.status = "paused";
      component.activeUntilAgeInMonths = undefined;
      component.factStatus = "needs_review";
      component.accrualReviewStatus = "review_due";
      component.lastReviewedAtAgeInMonths = input.ageInMonths;
      component.nextReviewAtAgeInMonths = input.ageInMonths;
      input.migrationIssues.push(issue({
        id: `v4_migration_aggregate_component_gap_${aggregate.id}_${component.id}`,
        code: "EXPENSE_OPENING_COMPONENT_GAP",
        severity: "warning",
        accountId: component.id,
        summary: `旧版聚合支出 ${aggregate.displayName} 与分项 ${component.displayName} 的覆盖关系未知；保留聚合作为唯一未来计提，分项已暂停待原子拆分确认`,
        ageInMonths: input.ageInMonths
      }));
    }
  }
}

export interface FinancialLedgerV3ToV4MigrationPreflight {
  ledger: FinancialLedgerV4;
  /** A V3 snapshot may be enabled as V4 only when migration created no open blocking conflict. */
  canEnableV4: boolean;
  blockingIssues: FinancialLedgerIssue[];
}

/**
 * Deterministically upgrades a persisted V3 ledger without replaying or
 * changing historical cash.  The result is idempotent: a valid V4 input is
 * merely cloned and revalidated.  Migration conflicts remain explicit ledger
 * issues so the caller can route them through the normal acceptance gate.
 */
export function migrateFinancialLedgerV3ToV4(input: FinancialLedgerV4): FinancialLedgerV4;
export function migrateFinancialLedgerV3ToV4(input: FinancialLedgerV3): FinancialLedgerV4;
export function migrateFinancialLedgerV3ToV4(input: FinancialLedgerV3 | FinancialLedgerV4): FinancialLedgerV4;
export function migrateFinancialLedgerV3ToV4(input: FinancialLedgerV3 | FinancialLedgerV4): FinancialLedgerV4 {
  if (input.version === 4) {
    const clone = structuredClone(input);
    assertFinancialLedgerInvariants(clone);
    return clone;
  }

  const migrated = input.expenseCommitments.map((commitment) => canonicalizeExpenseCommitmentV4({
    commitment,
    asOfAgeInMonths: input.asOfAgeInMonths
  }));
  const commitments = migrated.map((result) => result.commitment);
  const migrationIssues = migrated.flatMap((result) => result.issues);
  const activeKeys = new Set<string>();

  for (const commitment of commitments) {
    if (commitment.status !== "active") continue;
    if (activeKeys.has(commitment.responsibilityKey)) {
      commitment.status = "paused";
      commitment.factStatus = "needs_review";
      commitment.accrualReviewStatus = "review_due";
      commitment.nextReviewAtAgeInMonths = input.asOfAgeInMonths;
      migrationIssues.push(issue({
        id: `v4_migration_duplicate_responsibility_${commitment.id}`,
        code: "EXPENSE_DUPLICATE_RESPONSIBILITY",
        severity: "blocking",
        accountId: commitment.id,
        summary: `旧版支出 ${commitment.displayName} 与既有责任 ${commitment.responsibilityKey} 重复；已暂停未来计提，等待人工合并`,
        ageInMonths: input.asOfAgeInMonths
      }));
      continue;
    }
    activeKeys.add(commitment.responsibilityKey);
  }

  quarantineUnknownAggregateComponents({
    commitments,
    migrationIssues,
    ageInMonths: input.asOfAgeInMonths
  });

  for (const commitment of commitments) {
    if (!isMortgagePaymentCommitment(commitment) || commitment.status === "ended") continue;
    const hasActiveMortgage = input.debtAccounts.some((debt) => debt.type === "mortgage" && debt.status === "active");
    if (hasActiveMortgage) {
      commitment.status = "ended";
      commitment.activeUntilAgeInMonths = input.asOfAgeInMonths;
      migrationIssues.push(issue({
        id: `v4_migration_mortgage_double_count_${commitment.id}`,
        code: "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT",
        severity: "warning",
        accountId: commitment.id,
        summary: `旧版住房支出 ${commitment.displayName} 是房贷月供；未来本金和利息只由债务偿付策略结算`,
        ageInMonths: input.asOfAgeInMonths
      }));
    } else {
      migrationIssues.push(issue({
        id: `v4_migration_mortgage_missing_debt_${commitment.id}`,
        code: "EXPENSE_DEBT_SERVICE_DOUBLE_COUNT",
        severity: "blocking",
        accountId: commitment.id,
        summary: `旧版住房支出 ${commitment.displayName} 疑似房贷月供，但找不到对应活跃房贷；V4 启用前必须确认其归属`,
        ageInMonths: input.asOfAgeInMonths
      }));
    }
  }

  const knownIssueIds = new Set(input.unresolvedIssues.map((item) => item.id));
  const ledger: FinancialLedgerV4 = {
    ...structuredClone(input),
    version: 4,
    expenseCommitments: commitments,
    unresolvedIssues: [
      ...structuredClone(input.unresolvedIssues),
      ...migrationIssues.filter((item) => !knownIssueIds.has(item.id))
    ]
  };
  assertFinancialLedgerInvariants(ledger);
  return ledger;
}

/**
 * Keep the migration itself pure and inspectable (which is important for
 * restore tooling and audit reports), but make enablement an explicit
 * boundary.  Simulation code must call this helper rather than installing a
 * V4 candidate that carries an unresolved migration blocker.
 */
export function preflightFinancialLedgerV3ToV4(input: FinancialLedgerV3 | FinancialLedgerV4): FinancialLedgerV3ToV4MigrationPreflight {
  const ledger = migrateFinancialLedgerV3ToV4(input);
  const blockingIssues = ledger.unresolvedIssues.filter((item) => (
    item.status !== "resolved" && item.severity === "blocking"
  ));
  return {
    ledger,
    canEnableV4: blockingIssues.length === 0,
    blockingIssues
  };
}
