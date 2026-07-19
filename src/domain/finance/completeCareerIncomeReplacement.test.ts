import assert from "node:assert/strict";
import test from "node:test";
import type { AcceptedCareerTransition } from "../career/types";
import { initializeFinancialLedger } from "./initializeLedger";
import { completeCareerIncomeReplacementProposals } from "./completeCareerIncomeReplacement";

test("accepted job change deterministically settles every old-career income source", () => {
  const ledger = initializeFinancialLedger({ id: "career_replacement", asOfAgeInMonths: 360, openingPosition: {
    incomeSources: ["salary", "legacy_salary"].map((id) => ({
      id, type: "salary" as const, displayName: id, monthlyNetAmountWan: 2, accrualPolicy: "monthly" as const,
      activeFromAgeInMonths: 300, status: "active" as const, linkedCareerStateId: "career_old",
      factStatus: "estimated" as const, evidence: []
    }))
  } });
  const transition: AcceptedCareerTransition = {
    id: "accepted_transition", proposalId: "transition", fromCareerStateId: "career_old",
    nextCareerState: {
      id: "career_new", employmentStatus: "employed", occupation: "工程师", careerStage: "new_job",
      activeProjectIds: [], effectiveFromAgeInMonths: 361, source: "accepted_history", confidence: 1
    },
    effectiveAtAgeInMonths: 361,
    evidence: [{ source: "accepted_simulation_outcome", sourceEventId: "choice", excerpt: "你正式入职新公司。", reasonCode: "TEST", confidence: 1 }],
    acceptedByReasonCodes: ["TEST"]
  };
  const proposals = completeCareerIncomeReplacementProposals({
    proposals: [{ id: "end_salary", kind: "income_source_ended", effectiveAtAgeInMonths: 361, payload: { incomeSourceId: "salary" }, sourceOutcomeId: "choice", evidence: "你正式入职新公司。", confidence: 1 }],
    currentLedger: ledger, currentCareerStateId: "career_old", transition, acceptedOutcomeId: "choice"
  });
  assert.deepEqual(proposals.filter((proposal) => proposal.kind === "income_source_ended").map((proposal) => (proposal.payload as { incomeSourceId: string }).incomeSourceId).sort(), ["legacy_salary", "salary"]);
});
