import { isNarrativeEligibleFinancialFact } from "./financialFactEligibility";
import type { ExpenseAmountBasis, ExpenseCommitmentV4, ExpenseResponsibilityKind, FinancialLedger } from "./types";
import { isFinancialLedgerV4 } from "./types";
import { roundWan } from "./ledgerMath";

/**
 * A single, presentation-safe view of the recurring expenses that actually
 * belong to the protagonist.  It intentionally sits beside the ledger rather
 * than the prompt or report layers: both consumers must see the same V4
 * responsibility identity, amount basis and review state.
 */
export const PERSONAL_EXPENSE_SUMMARY_VERSION = "personal_expense_summary_v4" as const;

export interface PersonalExpenseCommitmentSummary {
  commitmentId: string;
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  financialScope: "personal" | "shared_household";
  monthlyAmountWan: number;
  amountBasis: ExpenseAmountBasis;
  factStatus: ExpenseCommitmentV4["factStatus"];
  reviewStatus: ExpenseCommitmentV4["accrualReviewStatus"];
  status: "active" | "paused";
  /** A paused responsibility remains visible for continuity, but does not accrue. */
  accrues: boolean;
  /** Whether its amount may be quoted in a final narrative. */
  narrativeEligible: boolean;
}

export interface PersonalExpenseSummaryV4 {
  version: typeof PERSONAL_EXPENSE_SUMMARY_VERSION;
  availability: "available";
  asOfAgeInMonths: number;
  sourceLedgerRevision: number;
  activeCommitments: PersonalExpenseCommitmentSummary[];
  pausedCommitments: PersonalExpenseCommitmentSummary[];
  annualizedActiveExpenseWan: number;
  /** The subset whose amount is admissible in a final report. */
  reportEligibleAnnualizedExpenseWan: number;
}

export interface PersonalExpenseSummaryUnavailable {
  version: typeof PERSONAL_EXPENSE_SUMMARY_VERSION;
  availability: "unavailable";
  reason: "no_ledger" | "not_v4";
}

export type PersonalExpenseSummary = PersonalExpenseSummaryV4 | PersonalExpenseSummaryUnavailable;

type VisiblePersonalExpenseCommitment = ExpenseCommitmentV4 & { status: "active" | "paused" };

function isVisiblePersonalRecurringCommitment(value: ExpenseCommitmentV4): value is VisiblePersonalExpenseCommitment {
  // The V4 type already prevents business/third_party scopes.  Keep this
  // runtime guard at the presentation boundary so a malformed restored value
  // can never leak a non-personal operating flow into a personal narrative.
  const hasNonPersonalEvidence = value.evidence.some((evidence) => (
    evidence.financialScope === "business_operating" || evidence.financialScope === "third_party"
  ));
  return value.status !== "ended"
    && !hasNonPersonalEvidence
    && (value.financialScope === "personal" || value.financialScope === "shared_household");
}

function toSummaryItem(commitment: VisiblePersonalExpenseCommitment): PersonalExpenseCommitmentSummary {
  return {
    commitmentId: commitment.id,
    responsibilityKey: commitment.responsibilityKey,
    responsibilityKind: commitment.responsibilityKind,
    financialScope: commitment.financialScope,
    monthlyAmountWan: roundWan(commitment.monthlyAmountWan),
    amountBasis: commitment.amountBasis,
    factStatus: commitment.factStatus,
    reviewStatus: commitment.accrualReviewStatus,
    status: commitment.status,
    accrues: commitment.status === "active",
    narrativeEligible: isNarrativeEligibleFinancialFact(commitment)
  };
}

function compareCommitments(left: PersonalExpenseCommitmentSummary, right: PersonalExpenseCommitmentSummary): number {
  return left.responsibilityKey.localeCompare(right.responsibilityKey)
    || left.commitmentId.localeCompare(right.commitmentId);
}

export function derivePersonalExpenseSummary(ledger?: FinancialLedger): PersonalExpenseSummary {
  if (!ledger) {
    return { version: PERSONAL_EXPENSE_SUMMARY_VERSION, availability: "unavailable", reason: "no_ledger" };
  }
  if (!isFinancialLedgerV4(ledger)) {
    return { version: PERSONAL_EXPENSE_SUMMARY_VERSION, availability: "unavailable", reason: "not_v4" };
  }

  const commitments = ledger.expenseCommitments
    .filter(isVisiblePersonalRecurringCommitment)
    .map(toSummaryItem)
    .sort(compareCommitments);
  const activeCommitments = commitments.filter((commitment) => commitment.status === "active");
  const pausedCommitments = commitments.filter((commitment) => commitment.status === "paused");

  return {
    version: PERSONAL_EXPENSE_SUMMARY_VERSION,
    availability: "available",
    asOfAgeInMonths: ledger.asOfAgeInMonths,
    sourceLedgerRevision: ledger.revision,
    activeCommitments,
    pausedCommitments,
    annualizedActiveExpenseWan: roundWan(activeCommitments.reduce((sum, commitment) => sum + commitment.monthlyAmountWan * 12, 0)),
    reportEligibleAnnualizedExpenseWan: roundWan(activeCommitments
      .filter((commitment) => commitment.narrativeEligible)
      .reduce((sum, commitment) => sum + commitment.monthlyAmountWan * 12, 0))
  };
}

function formatCommitment(commitment: PersonalExpenseCommitmentSummary): string {
  return `responsibilityKey=${commitment.responsibilityKey}, kind=${commitment.responsibilityKind}, scope=${commitment.financialScope}, monthly=${commitment.monthlyAmountWan}, basis=${commitment.amountBasis}, factStatus=${commitment.factStatus}, review=${commitment.reviewStatus}, status=${commitment.status}`;
}

/**
 * The one text formatter used by the next-node prompt and terminal narrative
 * authority.  Never add a second hand-written expense list at either caller.
 */
export function formatPersonalExpenseSummaryForPrompt(summary: PersonalExpenseSummary): string {
  if (summary.availability === "unavailable") {
    return summary.reason === "no_ledger"
      ? "- V4 支出分类摘要不可用：暂无账本；不得把叙事中的生活成本当作已接受的持续支出。"
      : "- V4 支出分类摘要不可用：当前为兼容账本；不得把旧聚合支出写成已确认的分类责任。";
  }
  const active = summary.activeCommitments.map((commitment) => `- active ${formatCommitment(commitment)}`);
  const paused = summary.pausedCommitments.map((commitment) => `- paused ${formatCommitment(commitment)}`);
  return [
    `- sourceLedgerRevision=${summary.sourceLedgerRevision}, asOfAgeInMonths=${summary.asOfAgeInMonths}`,
    `- annualizedActiveExpenseWan=${summary.annualizedActiveExpenseWan}, reportEligibleAnnualizedExpenseWan=${summary.reportEligibleAnnualizedExpenseWan}`,
    ...active,
    ...paused,
    ...(active.length === 0 && paused.length === 0 ? ["- 当前没有已接受的个人或共同家庭持续支出责任。"] : []),
    "- business_operating 与 third_party 流量不属于个人持续支出，禁止据此生成个人住房、家庭或医疗责任。",
    "- factStatus=needs_review 或 narrativeEligible=false 的金额可用于账本现金流，但不得在终局报告或海报中冒充已确认事实。"
  ].join("\n");
}

export function formatPersonalExpenseSummaryFromLedgerForPrompt(ledger?: FinancialLedger): string {
  return formatPersonalExpenseSummaryForPrompt(derivePersonalExpenseSummary(ledger));
}
