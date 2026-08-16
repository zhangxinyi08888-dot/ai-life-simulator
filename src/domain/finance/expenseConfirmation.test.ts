import assert from "node:assert/strict";
import test from "node:test";
import {
  validateExpenseConfirmationAtomicity,
  validateExpenseConfirmation,
  verifyAcceptedExpenseConfirmationAgainstFinalNarrative,
  type AcceptedAuthoritySnapshot,
  type ExpenseAmountObservation,
  type ValidateExpenseConfirmationInput
} from "./expenseConfirmation";
import { bindNarrativeExpenseFacts, type NarrativeExpenseFactBinding } from "./narrativeExpenseFactBinding";
import type { AcceptedFinancialEvent, ExpenseCommitmentV4, FinancialEventProposal, FinancialLedgerIssue, FinancialLedgerV4 } from "./types";

const NODE_ID = "node_confirmation";
const OUTCOME_ID = "outcome_confirmation";
const PROPOSAL_ID = "proposal_confirmation";
const PERSONAL_TEXT = "你已经每月支付房租5000元。";

function authority(): AcceptedAuthoritySnapshot {
  return {
    sourceNodeId: NODE_ID,
    sourceOutcomeId: OUTCOME_ID,
    acceptedUserFactIds: ["user_fact_confirmation"],
    acceptedDirectProposalIds: [PROPOSAL_ID],
    acceptedWorldDeltaIds: ["world_delta_confirmation"],
    periodStartAgeInMonths: 400,
    periodEndAgeInMonths: 412
  };
}

function commitment(overrides: Partial<ExpenseCommitmentV4> = {}): ExpenseCommitmentV4 {
  return {
    id: "rent_main",
    type: "housing",
    displayName: "当前住所房租",
    monthlyAmountWan: 0.35,
    activeFromAgeInMonths: 360,
    status: "active",
    factStatus: "needs_review",
    evidence: [{ source: "system_policy", reasonCode: "TEST_FLOOR", confidence: 1, financialScope: "personal" }],
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    amountBasis: "policy_floor",
    amountSourceIds: ["policy_floor:rent_main"],
    estimationPolicyId: "expense-estimation-policy-v2",
    financialScope: "personal",
    accrualReviewStatus: "review_due",
    nextReviewAtAgeInMonths: 412,
    ...overrides
  };
}

function ledger(expense: ExpenseCommitmentV4): Pick<FinancialLedgerV4, "expenseCommitments"> {
  return { expenseCommitments: [expense] };
}

function personalBinding(text = PERSONAL_TEXT): NarrativeExpenseFactBinding {
  const result = bindNarrativeExpenseFacts({
    sourceNodeId: NODE_ID,
    sourceOutcomeId: OUTCOME_ID,
    narrativeText: text
  });
  const binding = result.bindings.find((item) => item.responsibilityKey === "primary_residence:main");
  assert.ok(binding, "expected a personal housing binding");
  return binding;
}

function personalProposal(input: {
  existing?: ExpenseCommitmentV4;
  evidence?: string;
  confidence?: number;
  monthlyAmountWan?: number;
  id?: string;
} = {}): FinancialEventProposal {
  const existing = input.existing || commitment();
  const nextCommitment: ExpenseCommitmentV4 = {
    ...existing,
    monthlyAmountWan: input.monthlyAmountWan ?? 0.5,
    financialScope: "personal"
  };
  return {
    id: input.id || PROPOSAL_ID,
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: 412,
    payload: {
      expenseCommitmentId: existing.id,
      previousCommitmentId: existing.id,
      changeReason: "estimate_superseded_by_exact_fact",
      nextCommitment
    },
    evidence: input.evidence || PERSONAL_TEXT,
    sourceOutcomeId: OUTCOME_ID,
    confidence: input.confidence ?? 0.9,
    financialScope: "personal"
  };
}

function personalObservation(binding: NarrativeExpenseFactBinding, overrides: Partial<ExpenseAmountObservation> = {}): ExpenseAmountObservation {
  assert.ok(binding.amountSpan, "personal binding needs an amount span");
  return {
    id: "observation_confirmation",
    authoritySourceKind: "direct_financial_proposal",
    authoritySourceId: PROPOSAL_ID,
    sourceOutcomeId: OUTCOME_ID,
    expenseCommitmentId: "rent_main",
    responsibilityKey: binding.responsibilityKey,
    responsibilityKind: binding.responsibilityKind,
    proposedType: binding.proposedType,
    statementKind: "exact",
    cadence: "monthly",
    payer: "protagonist",
    financialScope: "personal",
    protagonistAmountWan: 0.5,
    effectiveAtAgeInMonths: 412,
    amountSourceId: "accepted_bill:rent:5000",
    evidenceFingerprint: binding.evidenceFingerprint,
    bindingId: binding.id,
    evidenceAnchor: {
      kind: "final_narrative_span",
      ...binding.amountSpan,
      fingerprint: binding.evidenceFingerprint
    },
    ...overrides
  };
}

function validate(input: Partial<ValidateExpenseConfirmationInput> = {}) {
  const binding = input.bindings?.[0] || personalBinding();
  const existing = input.previousLedger?.expenseCommitments[0] || commitment();
  const proposal = input.proposal || personalProposal({ existing });
  const observation = input.observation || personalObservation(binding);
  return validateExpenseConfirmation({
    observation,
    proposal,
    previousLedger: input.previousLedger || ledger(existing),
    currentAcceptedAuthority: input.currentAcceptedAuthority || authority(),
    finalNarrativeText: input.finalNarrativeText || PERSONAL_TEXT,
    periodStartAgeInMonths: input.periodStartAgeInMonths ?? 400,
    periodEndAgeInMonths: input.periodEndAgeInMonths ?? 412,
    bindings: input.bindings || [binding],
    targetIssueIds: input.targetIssueIds || ["expense_review_due_rent_main"]
  });
}

test("F-04 confirms a fresh current-period direct personal amount only when its binding and account match", () => {
  const binding = personalBinding();
  const result = validate({ bindings: [binding] });
  assert.equal(result.disposition, "confirmed_exact");
  assert.equal(result.accountId, "rent_main");
  assert.equal(result.matchedBindingId, binding.id);
  assert.equal(result.resolutionKind, "exact_amount");
  assert.deepEqual(result.targetIssueIds, ["expense_review_due_rent_main"]);
  assert.deepEqual(result.canonicalConfirmation, {
    factStatus: "known",
    amountBasis: "explicit_known",
    monthlyAmountWan: 0.5,
    confirmedMonthlyAmountWan: 0.5,
    grossMonthlyAmountWan: undefined,
    householdShareRate: undefined,
    confirmedAtAgeInMonths: 412
  });
});

test("non-Accepted narrative and scheduled-review observations can never become exact confirmations", () => {
  const binding = personalBinding();
  for (const authoritySourceKind of ["narrative_supplement", "scheduled_review"] as const) {
    const result = validate({
      bindings: [binding],
      observation: personalObservation(binding, { authoritySourceKind })
    });
    assert.equal(result.disposition, "not_confirmation");
    assert.deepEqual(result.reasonCodes, ["EXPENSE_CONFIRMATION_NON_ACCEPTED_SOURCE"]);
    assert.equal(result.canonicalConfirmation, undefined);
  }
});

test("an Accepted WorldState delta can request review but cannot claim an exact amount", () => {
  const binding = personalBinding();
  const result = validate({
    bindings: [binding],
    observation: personalObservation(binding, {
      authoritySourceKind: "accepted_world_delta",
      authoritySourceId: "world_delta_confirmation"
    })
  });
  assert.equal(result.disposition, "review_only");
  assert.deepEqual(result.reasonCodes, ["EXPENSE_CONFIRMATION_WORLD_DELTA_NOT_EXACT_AUTHORITY"]);
});

test("rejects a direct confirmation when payer or cadence differs from the bound fact", () => {
  const binding = personalBinding();
  const payerMismatch = validate({
    bindings: [binding],
    observation: personalObservation(binding, {
      payer: "shared",
      financialScope: "shared_household"
    })
  });
  assert.equal(payerMismatch.disposition, "blocked");
  assert.deepEqual(payerMismatch.reasonCodes, ["EXPENSE_CONFIRMATION_PAYER_MISMATCH"]);

  const cadenceMismatch = validate({
    bindings: [binding],
    observation: personalObservation(binding, {
      cadence: "annual",
      protagonistAmountWan: 6
    })
  });
  assert.equal(cadenceMismatch.disposition, "blocked");
  assert.deepEqual(cadenceMismatch.reasonCodes, ["EXPENSE_CONFIRMATION_CADENCE_MISMATCH"]);
});

function sharedBinding(text: string): NarrativeExpenseFactBinding {
  const span = (excerpt: string) => {
    const start = text.indexOf(excerpt);
    assert.notEqual(start, -1, `missing ${excerpt}`);
    return { start, end: start + excerpt.length, excerpt };
  };
  return {
    id: "binding_shared_rent",
    clauseId: "clause_shared_rent",
    sentenceIndex: 0,
    clauseIndex: 0,
    contextClauseIds: ["clause_shared_rent"],
    sourceNodeId: NODE_ID,
    sourceOutcomeId: OUTCOME_ID,
    sourceIdentityStatus: "bound",
    evidenceFingerprint: "fingerprint_shared_rent",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    proposedType: "housing",
    action: "adjust",
    completion: "completed",
    cadence: "monthly",
    liability: "shared",
    financialScope: "shared_household",
    shareRate: 0.5,
    explicitMonthlyTotalWan: 0.52,
    protagonistShareWan: 0.26,
    amountSourceId: "binding_shared_amount",
    participantPersonIds: ["partner_1"],
    responsibilitySpan: span("房租"),
    completionSpan: span("共同支付"),
    payerSpan: span("你们共同支付"),
    amountSpan: span("5200元"),
    cadenceSpan: span("每月"),
    sourceMateriality: "nonmaterial",
    unresolvedFields: [],
    reasonCodes: ["TEST_SHARED"]
  };
}

test("F-05 validates shared total, protagonist share, and scope as one inseparable fact", () => {
  const text = "你们共同支付每月房租5200元，各承担一半。";
  const binding = sharedBinding(text);
  const existing = commitment({
    monthlyAmountWan: 0.2,
    financialScope: "shared_household",
    responsibilityKey: binding.responsibilityKey,
    responsibilityKind: binding.responsibilityKind,
    type: binding.proposedType
  });
  const proposal: FinancialEventProposal = {
    id: PROPOSAL_ID,
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: 412,
    payload: {
      expenseCommitmentId: existing.id,
      previousCommitmentId: existing.id,
      nextCommitment: {
        ...existing,
        monthlyAmountWan: 0.26,
        grossMonthlyAmountWan: 0.52,
        householdShareRate: 0.5,
        financialScope: "shared_household"
      }
    },
    evidence: text,
    sourceOutcomeId: OUTCOME_ID,
    confidence: 0.9,
    financialScope: "shared_household"
  };
  const observation: ExpenseAmountObservation = {
    id: "observation_shared_rent",
    authoritySourceKind: "direct_financial_proposal",
    authoritySourceId: PROPOSAL_ID,
    sourceOutcomeId: OUTCOME_ID,
    expenseCommitmentId: existing.id,
    responsibilityKey: binding.responsibilityKey,
    responsibilityKind: binding.responsibilityKind,
    proposedType: binding.proposedType,
    statementKind: "exact",
    cadence: "monthly",
    payer: "shared",
    financialScope: "shared_household",
    protagonistAmountWan: 0.26,
    grossAmountWan: 0.52,
    householdShareRate: 0.5,
    effectiveAtAgeInMonths: 412,
    amountSourceId: "accepted_bill:shared_rent:5200",
    evidenceFingerprint: binding.evidenceFingerprint,
    bindingId: binding.id,
    evidenceAnchor: {
      kind: "final_narrative_span",
      ...binding.amountSpan!,
      fingerprint: binding.evidenceFingerprint
    }
  };
  const valid = validate({
    bindings: [binding],
    observation,
    proposal,
    previousLedger: ledger(existing),
    finalNarrativeText: text
  });
  assert.equal(valid.disposition, "confirmed_exact");
  assert.equal(valid.resolutionKind, "shared_allocation");
  assert.equal(valid.canonicalConfirmation?.monthlyAmountWan, 0.26);
  assert.equal(valid.canonicalConfirmation?.grossMonthlyAmountWan, 0.52);

  const invalidShare = validate({
    bindings: [binding],
    observation: { ...observation, householdShareRate: 0.4 },
    proposal,
    previousLedger: ledger(existing),
    finalNarrativeText: text
  });
  assert.equal(invalidShare.disposition, "blocked");
  assert.deepEqual(invalidShare.reasonCodes, ["EXPENSE_CONFIRMATION_SHARE_MISMATCH"]);
});

test("post-sanitize text cannot reuse a stale amount span as confirmation evidence", () => {
  const binding = personalBinding();
  const finalText = `说明：${PERSONAL_TEXT}`;
  const result = validate({
    bindings: [binding],
    proposal: personalProposal(),
    finalNarrativeText: finalText
  });
  assert.equal(result.disposition, "blocked");
  assert.deepEqual(result.reasonCodes, ["EXPENSE_CONFIRMATION_EVIDENCE_ANCHOR_INVALID"]);
});

test("direct proposal evidence and effective age must match the same final exact fact", () => {
  const binding = personalBinding();
  const finalText = `${PERSONAL_TEXT}你本月搬家到公司附近。`;
  const wrongEvidence = validate({
    bindings: [binding],
    finalNarrativeText: finalText,
    proposal: personalProposal({ evidence: "你本月搬家到公司附近。" })
  });
  assert.equal(wrongEvidence.disposition, "blocked");
  assert.deepEqual(wrongEvidence.reasonCodes, ["EXPENSE_CONFIRMATION_PROPOSAL_EVIDENCE_MISMATCH"]);

  const wrongAge = validate({
    bindings: [binding],
    proposal: { ...personalProposal(), effectiveAtAgeInMonths: 411 }
  });
  assert.equal(wrongAge.disposition, "blocked");
  assert.deepEqual(wrongAge.reasonCodes, ["EXPENSE_CONFIRMATION_PROPOSAL_EFFECTIVE_AT_MISMATCH"]);
});

test("low confidence, ledger echo, and wrong account cannot close an exact review", () => {
  const binding = personalBinding();
  const lowConfidence = validate({
    bindings: [binding],
    proposal: personalProposal({ confidence: 0.79 })
  });
  assert.equal(lowConfidence.disposition, "blocked");
  assert.deepEqual(lowConfidence.reasonCodes, ["EXPENSE_CONFIRMATION_CONFIDENCE_TOO_LOW"]);

  const echoed = validate({
    bindings: [binding],
    previousLedger: ledger(commitment({ amountSourceIds: ["accepted_bill:rent:5000"] }))
  });
  assert.equal(echoed.disposition, "blocked");
  assert.deepEqual(echoed.reasonCodes, ["EXPENSE_CONFIRMATION_LEDGER_ECHO"]);

  const wrongAccount = validate({
    bindings: [binding],
    proposal: {
      ...personalProposal(),
      payload: {
        expenseCommitmentId: "other_rent",
        nextCommitment: { ...commitment(), id: "other_rent", monthlyAmountWan: 0.5 }
      }
    }
  });
  assert.equal(wrongAccount.disposition, "blocked");
  assert.deepEqual(wrongAccount.reasonCodes, ["EXPENSE_CONFIRMATION_ACCOUNT_MISMATCH"]);
});

test("a structured Accepted user fact can confirm without rendered-prose copying only when every required field is referenced", () => {
  const existing = commitment();
  const proposal = personalProposal({ existing, evidence: "用户明确提供当前房租" });
  const observation: ExpenseAmountObservation = {
    id: "observation_user_fact",
    authoritySourceKind: "user_fact",
    authoritySourceId: "user_fact_confirmation",
    expenseCommitmentId: existing.id,
    responsibilityKey: existing.responsibilityKey,
    responsibilityKind: existing.responsibilityKind,
    proposedType: existing.type,
    statementKind: "exact",
    cadence: "monthly",
    payer: "protagonist",
    financialScope: "personal",
    protagonistAmountWan: 0.5,
    effectiveAtAgeInMonths: 412,
    amountSourceId: "user_fact:rent:5000",
    evidenceFingerprint: "user_fact_fingerprint",
    evidenceAnchor: {
      kind: "structured_accepted_fact",
      sourceKind: "user_fact",
      sourceId: "user_fact_confirmation",
      fieldPaths: ["payer", "financialScope", "responsibilityKey", "cadence", "protagonistAmountWan"],
      fingerprint: "user_fact_fingerprint"
    }
  };
  const result = validate({
    observation,
    proposal,
    previousLedger: ledger(existing),
    bindings: [],
    finalNarrativeText: "本轮根据用户输入更新账本。"
  });
  assert.equal(result.disposition, "confirmed_exact");
  assert.equal(result.canonicalConfirmation?.amountBasis, "explicit_known");
});

test("post-sanitize verification uniquely rebinds the same exact fact and rejects removed evidence", () => {
  const binding = personalBinding();
  const event = {
    id: "accepted_confirmation",
    proposalId: PROPOSAL_ID,
    kind: "expense_commitment_adjusted" as const,
    effectiveAtAgeInMonths: 412,
    payload: {
      expenseCommitmentId: "rent_main",
      nextCommitment: {
        ...commitment(),
        monthlyAmountWan: 0.5,
        factStatus: "known" as const,
        amountBasis: "explicit_known" as const,
        confirmedMonthlyAmountWan: 0.5,
        lastConfirmedAtAgeInMonths: 412
      }
    },
    evidence: [],
    acceptedByReasonCodes: [],
    expenseConfirmationResolution: {
      disposition: "confirmed_exact" as const,
      responsibilityKey: binding.responsibilityKey,
      accountId: "rent_main",
      targetIssueIds: ["expense_review_due_rent_main"],
      resolutionKind: "exact_amount" as const,
      matchedBindingId: binding.id
    }
  };
  const valid = verifyAcceptedExpenseConfirmationAgainstFinalNarrative({
    event,
    finalNarrativeText: `最终正文：${PERSONAL_TEXT}`,
    sourceNodeId: NODE_ID,
    sourceOutcomeId: OUTCOME_ID
  });
  assert.equal(valid.valid, true);
  assert.ok(valid.matchedBindingId);

  const removed = verifyAcceptedExpenseConfirmationAgainstFinalNarrative({
    event,
    finalNarrativeText: "最终正文只说你搬到了公司附近，没有给出当前账单。",
    sourceNodeId: NODE_ID,
    sourceOutcomeId: OUTCOME_ID
  });
  assert.equal(removed.valid, false);
  assert.deepEqual(removed.reasonCodes, ["EXPENSE_CONFIRMATION_FINAL_BINDING_MISSING"]);
});

test("I-04 exact confirmation is rejected when Preview does not atomically close its declared review issue", () => {
  const event = {
    id: "accepted_confirmation_atomicity",
    proposalId: PROPOSAL_ID,
    kind: "expense_commitment_adjusted",
    effectiveAtAgeInMonths: 412,
    payload: { expenseCommitmentId: "rent_main", nextCommitment: commitment() },
    evidence: [],
    acceptedByReasonCodes: [],
    expenseConfirmationResolution: {
      disposition: "confirmed_exact",
      responsibilityKey: "primary_residence:main",
      accountId: "rent_main",
      targetIssueIds: ["expense_review_due_rent_main"],
      resolutionKind: "exact_amount"
    }
  } as AcceptedFinancialEvent;
  const openIssue = {
    id: "expense_review_due_rent_main",
    code: "EXPENSE_REVIEW_OVERDUE",
    severity: "blocking",
    status: "open",
    relatedProposalIds: [],
    relatedAccountIds: ["rent_main"],
    summary: "房租金额待确认",
    createdAtAgeInMonths: 412,
    expenseResolutionKind: "exact_amount",
    expenseResponsibilityKey: "primary_residence:main"
  } as FinancialLedgerIssue;
  const violations = validateExpenseConfirmationAtomicity({ events: [event], previewIssues: [openIssue] });
  assert.deepEqual(violations, [{
    eventId: event.id,
    targetIssueId: openIssue.id,
    reasonCodes: [
      "EXPENSE_CONFIRMATION_TARGET_ISSUE_STILL_OPEN",
      "EXPENSE_CONFIRMATION_TARGET_RESOLVED_BY_OTHER_EVENT"
    ]
  }]);

  const resolved = validateExpenseConfirmationAtomicity({
    events: [event],
    previewIssues: [{ ...openIssue, status: "resolved", resolvedByEventId: event.id }]
  });
  assert.deepEqual(resolved, []);
});
