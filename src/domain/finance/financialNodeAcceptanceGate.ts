import type { FinancialNodeGateMode } from "../../config/financialGatePolicy";
import { currentCareerState } from "../career/careerState";
import type { CommittedFinancialDomainTransaction } from "./commitFinancialDomainTransaction";
import type { FinancialEventProposal, FinancialLedgerIssue } from "./types";

export type RequiredFinancialFactGroupKind =
  | "career_income_transition"
  | "personal_compensation"
  | "property_and_mortgage"
  | "debt_repayment_or_restructure"
  | "business_holding"
  | "large_personal_cashflow"
  | "expense_lifecycle"
  | "opening_fact_provenance";

export interface RequiredFinancialFactGroup {
  id: string;
  kind: RequiredFinancialFactGroupKind;
  materiality: "critical" | "review";
  satisfied: boolean;
  reasonCode: string;
  relatedIssueIds: string[];
  relatedProposalIds: string[];
}

export type FinancialNodeDisposition = "accept" | "accept_with_review" | "regenerate";

export interface FinancialNodeAcceptanceDecision {
  mode: FinancialNodeGateMode;
  disposition: FinancialNodeDisposition;
  allowDomainCommit: boolean;
  wouldBlock: boolean;
  reasonCodes: string[];
  relatedIssueIds: string[];
  relatedProposalIds: string[];
  requiredFactGroupCount: number;
  satisfiedFactGroupCount: number;
  criticalFactGroupCount: number;
  satisfiedCriticalFactGroupCount: number;
  unsatisfiedCriticalFactGroupCount: number;
  activeCareerIncomeCount: number;
  previewAgeAligned: boolean;
  transactionId?: string;
  regenerationCount?: number;
  authoritativeAgeBefore?: number;
  previewAgeInMonths?: number;
  previewPeriodIncomeWan?: number;
  previewPeriodExpenseWan?: number;
}

function groupKindForIssue(issue: FinancialLedgerIssue): RequiredFinancialFactGroupKind | undefined {
  // Opening positions use their own schema adapter, but they must be visible
  // to the same acceptance gate rather than disappearing as an initialization
  // exception.  Keep provenance/schema failures separate from a normal
  // lifecycle reconciliation failure so diagnostics can tell the user what
  // needs to be supplied before a start node exists.
  if (issue.id.startsWith("opening_schema_") || issue.id.startsWith("opening_fact_")) {
    return "opening_fact_provenance";
  }
  if (issue.code.startsWith("EXPENSE_")
    || issue.id.startsWith("expense_")
    // A deterministic lifecycle proposal may fail ordinary evidence/schema
    // validation with a generic code. Its `system_expense_*` identity still
    // makes it a material expense-lifecycle fact, never a dismissible review.
    || (issue.relatedProposalIds || []).some((proposalId) => proposalId.startsWith("system_expense_"))) {
    return "expense_lifecycle";
  }
  if (issue.id.startsWith("career_transition_missing_") || issue.code === "CAREER_INCOME_CONFLICT") {
    return "career_income_transition";
  }
  if (issue.id.startsWith("narrative_coverage_personal_compensation_")
    || issue.id.startsWith("personal_income_claim_without_event_")) return "personal_compensation";
  if (issue.id.startsWith("narrative_coverage_property_")
    || issue.id.startsWith("narrative_coverage_mortgage_")) return "property_and_mortgage";
  if (issue.id.startsWith("narrative_coverage_business_holding_")
    || issue.id.startsWith("narrative_coverage_personal_option_")) return "business_holding";
  if (issue.id.startsWith("narrative_coverage_personal_outlay_")) return "large_personal_cashflow";
  return undefined;
}

function groupKindForRejectedProposal(
  proposal: FinancialEventProposal
): RequiredFinancialFactGroupKind | undefined {
  if (["expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended"].includes(proposal.kind)) {
    return "expense_lifecycle";
  }
  if (["income_source_started", "income_source_adjusted", "income_source_ended", "income_source_paused"]
    .includes(proposal.kind)) return "personal_compensation";
  if (["asset_purchased", "asset_sold", "debt_drawn", "debt_balance_discovered"]
    .includes(proposal.kind)) return "property_and_mortgage";
  if (["debt_principal_repaid", "debt_restructured", "debt_forgiven"]
    .includes(proposal.kind)) return "debt_repayment_or_restructure";
  if (["business_holding_started", "business_option_granted", "business_holding_sold"]
    .includes(proposal.kind)) return "business_holding";
  if (["one_off_income_received", "one_off_expense_paid", "family_support_received", "family_support_paid"]
    .includes(proposal.kind)) return "large_personal_cashflow";
  return undefined;
}

export function buildRequiredFinancialFactGroups(input: {
  issues: FinancialLedgerIssue[];
  rejectedCompletedProposals: FinancialEventProposal[];
  reviewReasonCodes?: string[];
  ageInMonths: number;
}): RequiredFinancialFactGroup[] {
  const groups = new Map<string, RequiredFinancialFactGroup>();
  const add = (group: Omit<RequiredFinancialFactGroup, "id">) => {
    const key = `${group.materiality}:${group.kind}`;
    const previous = groups.get(key);
    groups.set(key, {
      id: `financial_fact_group_${group.kind}_${input.ageInMonths}`,
      ...group,
      relatedIssueIds: [...new Set([...(previous?.relatedIssueIds || []), ...group.relatedIssueIds])],
      relatedProposalIds: [...new Set([...(previous?.relatedProposalIds || []), ...group.relatedProposalIds])]
    });
  };

  for (const issue of input.issues) {
    if ((issue.status ?? "open") !== "open" || issue.severity !== "blocking") continue;
    const kind = groupKindForIssue(issue);
    if (!kind) continue;
    add({
      kind,
      materiality: "critical",
      satisfied: false,
      reasonCode: `UNSATISFIED_${kind.toUpperCase()}`,
      relatedIssueIds: [issue.id],
      relatedProposalIds: issue.relatedProposalIds
    });
  }

  for (const proposal of input.rejectedCompletedProposals) {
    const kind = groupKindForRejectedProposal(proposal);
    if (!kind) continue;
    add({
      kind,
      materiality: "critical",
      satisfied: false,
      reasonCode: `REJECTED_COMPLETED_${kind.toUpperCase()}`,
      relatedIssueIds: [],
      relatedProposalIds: [proposal.id]
    });
  }

  for (const reasonCode of input.reviewReasonCodes || []) {
    add({
      kind: "expense_lifecycle",
      materiality: "review",
      satisfied: false,
      reasonCode,
      relatedIssueIds: [],
      relatedProposalIds: []
    });
  }
  return [...groups.values()];
}

export function evaluateFinancialNodeAcceptance(input: {
  mode: FinancialNodeGateMode;
  preview: CommittedFinancialDomainTransaction;
  requiredFactGroups: RequiredFinancialFactGroup[];
  expectedAgeInMonths: number;
  transactionId?: string;
  regenerationCount?: number;
  authoritativeAgeBefore?: number;
}): FinancialNodeAcceptanceDecision {
  if (input.mode === "off") {
    return {
      mode: "off",
      disposition: "accept",
      allowDomainCommit: true,
      wouldBlock: false,
      reasonCodes: [],
      relatedIssueIds: [],
      relatedProposalIds: [],
      requiredFactGroupCount: 0,
      satisfiedFactGroupCount: 0,
      criticalFactGroupCount: 0,
      satisfiedCriticalFactGroupCount: 0,
      unsatisfiedCriticalFactGroupCount: 0,
      activeCareerIncomeCount: 0,
      previewAgeAligned: true,
      transactionId: input.transactionId,
      regenerationCount: input.regenerationCount,
      authoritativeAgeBefore: input.authoritativeAgeBefore,
      previewAgeInMonths: input.preview.financialLedger.asOfAgeInMonths,
      previewPeriodIncomeWan: input.preview.financialPeriodSummary?.incomeWan,
      previewPeriodExpenseWan: input.preview.financialPeriodSummary
        ? input.preview.financialPeriodSummary.coreExpenseWan
          + input.preview.financialPeriodSummary.otherExpenseWan
          + input.preview.financialPeriodSummary.debtInterestPaidWan
        : undefined
    };
  }

  const nextCareer = currentCareerState(input.preview.career);
  const activeCareerIncomeCount = nextCareer
    ? input.preview.financialLedger.incomeSources.filter((source) => (
        source.status === "active"
        && source.accrualReviewStatus !== "quarantined"
        && source.linkedCareerStateId === nextCareer.id
      )).length
    : 0;
  const employedIncomeInvalid = nextCareer?.employmentStatus === "employed" && activeCareerIncomeCount !== 1;
  const previewAgeAligned = input.preview.financialLedger.asOfAgeInMonths === input.expectedAgeInMonths
    && input.preview.derivedFinancialState.state.asOfAgeInMonths === input.expectedAgeInMonths;
  const allCritical = input.requiredFactGroups.filter((group) => group.materiality === "critical");
  const critical = allCritical.filter((group) => !group.satisfied);
  const review = input.requiredFactGroups.filter((group) => group.materiality === "review" && !group.satisfied);
  const reasonCodes = new Set([...critical, ...review].map((group) => group.reasonCode));
  if (employedIncomeInvalid) {
    reasonCodes.add(activeCareerIncomeCount === 0
      ? "EMPLOYED_WITHOUT_ACTIVE_CAREER_INCOME"
      : "EMPLOYED_WITH_MULTIPLE_ACTIVE_CAREER_INCOMES");
  }
  if (!previewAgeAligned) reasonCodes.add("PREVIEW_AGE_MISMATCH");
  const unsatisfiedCriticalFactGroupCount = critical.length
    + (employedIncomeInvalid ? 1 : 0)
    + (!previewAgeAligned ? 1 : 0);
  const wouldBlock = unsatisfiedCriticalFactGroupCount > 0;
  return {
    mode: input.mode,
    disposition: wouldBlock ? "regenerate" : review.length > 0 ? "accept_with_review" : "accept",
    allowDomainCommit: input.mode !== "enforced" || !wouldBlock,
    wouldBlock,
    reasonCodes: [...reasonCodes],
    relatedIssueIds: [...new Set(critical.flatMap((group) => group.relatedIssueIds))],
    relatedProposalIds: [...new Set(critical.flatMap((group) => group.relatedProposalIds))],
    requiredFactGroupCount: input.requiredFactGroups.length,
    satisfiedFactGroupCount: input.requiredFactGroups.filter((group) => group.satisfied).length,
    criticalFactGroupCount: allCritical.length,
    satisfiedCriticalFactGroupCount: allCritical.filter((group) => group.satisfied).length,
    unsatisfiedCriticalFactGroupCount,
    activeCareerIncomeCount,
    previewAgeAligned,
    transactionId: input.transactionId,
    regenerationCount: input.regenerationCount,
    authoritativeAgeBefore: input.authoritativeAgeBefore,
    previewAgeInMonths: input.preview.financialLedger.asOfAgeInMonths,
    previewPeriodIncomeWan: input.preview.financialPeriodSummary?.incomeWan,
    previewPeriodExpenseWan: input.preview.financialPeriodSummary
      ? input.preview.financialPeriodSummary.coreExpenseWan
        + input.preview.financialPeriodSummary.otherExpenseWan
        + input.preview.financialPeriodSummary.debtInterestPaidWan
      : undefined
  };
}
