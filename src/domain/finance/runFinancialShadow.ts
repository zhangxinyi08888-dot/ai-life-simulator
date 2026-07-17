import type { EmploymentStatus, FinancialSignals, FinancialState } from "../../types";
import type { CareerState } from "../career/types";
import { adaptLegacyFinancialSignalsToProposals } from "./adaptLegacyFinancialSignals";
import { deriveFinancialState } from "./deriveFinancialState";
import { FinancialLedgerInvariantError, roundWan } from "./ledgerMath";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  DerivedFinancialStateV2,
  FinancialEventProposal,
  FinancialLedger,
  FinancialLedgerIssue,
  FinancialPeriodSummary
} from "./types";
import { validateFinancialProposals } from "./validateFinancialProposals";

export interface FinancialShadowFieldDifference {
  field: "cashWan" | "totalDebtWan" | "netWorthWan" | "annualIncomeWan" | "annualExpenseWan" | "employmentStatus";
  legacyValue: number | EmploymentStatus | undefined;
  shadowValue: number | EmploymentStatus | undefined;
  absoluteDifferenceWan?: number;
}

export interface FinancialShadowComparison {
  transactionId: string;
  status: "matched" | "different" | "blocked";
  differences: FinancialShadowFieldDifference[];
  issueCodes: FinancialLedgerIssue["code"][];
  acceptedEventCount: number;
  resetFromLegacy: boolean;
}

export interface FinancialShadowResult {
  ledger: FinancialLedger;
  derivedState: DerivedFinancialStateV2;
  compatibilityState: FinancialState;
  periodSummary?: FinancialPeriodSummary;
  issues: FinancialLedgerIssue[];
  comparison: FinancialShadowComparison;
}

function compare(input: {
  transactionId: string;
  legacy: FinancialState;
  shadow: DerivedFinancialStateV2;
  issues: FinancialLedgerIssue[];
  acceptedEventCount: number;
  blocked: boolean;
  resetFromLegacy: boolean;
}): FinancialShadowComparison {
  const differences: FinancialShadowFieldDifference[] = [];
  const moneyFields = [
    ["cashWan", input.legacy.cashWan, input.shadow.cashWan],
    ["totalDebtWan", input.legacy.totalDebtWan, input.shadow.totalDebtWan],
    ["netWorthWan", input.legacy.netWorthWan, input.shadow.netWorthWan],
    ["annualIncomeWan", input.legacy.annualAfterTaxIncomeWan, input.shadow.annualizedRecurringIncomeWan],
    ["annualExpenseWan", input.legacy.annualCoreExpenseWan, input.shadow.annualizedCoreExpenseWan]
  ] as const;
  for (const [field, legacyValue, shadowValue] of moneyFields) {
    const absoluteDifferenceWan = roundWan(Math.abs(legacyValue - shadowValue));
    if (absoluteDifferenceWan > 0.1) differences.push({ field, legacyValue, shadowValue, absoluteDifferenceWan });
  }
  if (input.legacy.employmentStatus !== input.shadow.employmentStatus) {
    differences.push({ field: "employmentStatus", legacyValue: input.legacy.employmentStatus, shadowValue: input.shadow.employmentStatus });
  }
  return {
    transactionId: input.transactionId,
    status: input.blocked ? "blocked" : differences.length ? "different" : "matched",
    differences,
    issueCodes: [...new Set(input.issues.map((issue) => issue.code))],
    acceptedEventCount: input.acceptedEventCount,
    resetFromLegacy: input.resetFromLegacy
  };
}

function attachIssues(ledger: FinancialLedger, issues: FinancialLedgerIssue[]): FinancialLedger {
  if (!issues.length) return ledger;
  const next = structuredClone(ledger);
  const existing = new Set(next.unresolvedIssues.map((issue) => issue.id));
  next.unresolvedIssues.push(...issues.filter((issue) => !existing.has(issue.id)).map((issue) => structuredClone(issue)));
  return next;
}

export function runFinancialShadowTransition(input: {
  previousLegacyState: FinancialState;
  nextLegacyState: FinancialState;
  currentLedger?: FinancialLedger;
  currentCareerState: CareerState;
  legacySignals?: FinancialSignals;
  directProposals?: FinancialEventProposal[];
  acceptedOutcomeId?: string;
  narrativeText: string;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  simulationTransactionId: string;
  hasStructuredBusinessActivity?: boolean;
}): FinancialShadowResult {
  const mustResetBaseline = Boolean(
    input.currentLedger
    && input.currentLedger.asOfAgeInMonths !== input.periodStartAgeInMonths
  );
  const currentLedger = !mustResetBaseline && input.currentLedger ? input.currentLedger : migrateLegacyFinancialState({
    id: `shadow_${input.simulationTransactionId}`,
    legacyState: input.previousLegacyState,
    linkedCareerStateId: input.currentCareerState.id
  });
  const adapted = input.legacySignals
    ? adaptLegacyFinancialSignalsToProposals({
        signals: input.legacySignals,
        narrativeEvidence: input.narrativeText,
        currentCareerState: input.currentCareerState,
        currentLedger,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths,
        sourceOutcomeId: input.acceptedOutcomeId,
        simulationTransactionId: input.simulationTransactionId,
        hasStructuredBusinessActivity: input.hasStructuredBusinessActivity
      })
    : { proposals: [], issues: [] };
  const proposals = [...adapted.proposals, ...(input.directProposals || [])];
  const preexistingBlockingIssue = adapted.issues.some((issue) => issue.severity === "blocking");
  const validated = preexistingBlockingIssue
    ? { acceptedEvents: [], issues: [] as FinancialLedgerIssue[] }
    : validateFinancialProposals({
        proposals,
        currentLedger,
        currentCareerState: input.currentCareerState,
        acceptedOutcomeId: input.acceptedOutcomeId,
        narrativeText: input.narrativeText,
        periodStartAgeInMonths: input.periodStartAgeInMonths,
        periodEndAgeInMonths: input.periodEndAgeInMonths,
        simulationTransactionId: input.simulationTransactionId
      });
  const baselineIssues: FinancialLedgerIssue[] = mustResetBaseline ? [{
    id: `shadow_baseline_reset_${input.simulationTransactionId}`,
    code: "LEGACY_UNCERTAINTY",
    severity: "warning",
    relatedProposalIds: [],
    summary: "影子账本时间与阶段起点不连续，已从当前 V1 快照重建基线",
    createdAtAgeInMonths: input.periodStartAgeInMonths
  }] : [];
  const issues = [...baselineIssues, ...adapted.issues, ...validated.issues];
  const blocking = issues.some((issue) => issue.severity === "blocking");
  try {
    const reduced = reduceFinancialLedger({
      ledger: currentLedger,
      transactionId: input.simulationTransactionId,
      expectedLedgerRevision: currentLedger.revision,
      periodStartAgeInMonths: input.periodStartAgeInMonths,
      periodEndAgeInMonths: input.periodEndAgeInMonths,
      events: blocking ? [] : validated.acceptedEvents
    });
    if (reduced.alreadyCommitted || !("periodSummary" in reduced)) {
      throw new FinancialLedgerInvariantError("REVISION_CONFLICT", "影子事务被重复提交");
    }
    const ledger = attachIssues(reduced.ledger, issues);
    const derived = deriveFinancialState({
      ledger,
      periodSummary: reduced.periodSummary,
      employmentStatus: input.currentCareerState.employmentStatus
    });
    return {
      ledger,
      derivedState: derived.state,
      compatibilityState: derived.compatibilityState,
      periodSummary: reduced.periodSummary,
      issues,
      comparison: compare({
        transactionId: input.simulationTransactionId,
        legacy: input.nextLegacyState,
        shadow: derived.state,
        issues: ledger.unresolvedIssues,
        acceptedEventCount: blocking ? 0 : validated.acceptedEvents.length,
        blocked: false,
        resetFromLegacy: mustResetBaseline
      })
    };
  } catch (error) {
    const fallbackIssue: FinancialLedgerIssue = {
      id: `shadow_blocked_${input.simulationTransactionId}`,
      code: error instanceof FinancialLedgerInvariantError && error.code === "MISSING_FUNDING_SOURCE"
        ? "MISSING_FUNDING_SOURCE"
        : "UNBALANCED_TRANSACTION",
      severity: "blocking",
      relatedProposalIds: proposals.map((proposal) => proposal.id),
      summary: error instanceof Error ? error.message : "影子账本提交失败",
      createdAtAgeInMonths: input.periodEndAgeInMonths
    };
    const allIssues = [...issues, fallbackIssue];
    const fallbackLedger = attachIssues(migrateLegacyFinancialState({
      id: currentLedger.id,
      legacyState: input.nextLegacyState,
      linkedCareerStateId: input.currentCareerState.id
    }), allIssues);
    const derived = deriveFinancialState({ ledger: fallbackLedger, employmentStatus: input.currentCareerState.employmentStatus });
    return {
      ledger: fallbackLedger,
      derivedState: derived.state,
      compatibilityState: derived.compatibilityState,
      issues: allIssues,
      comparison: compare({
        transactionId: input.simulationTransactionId,
        legacy: input.nextLegacyState,
        shadow: derived.state,
        issues: fallbackLedger.unresolvedIssues,
        acceptedEventCount: 0,
        blocked: true,
        resetFromLegacy: true
      })
    };
  }
}
