import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { normalizeFinancialProposals, normalizeRepairedFinancialProposals } from "./normalizeFinancialProposals";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import { validateFinancialPayloadSchema } from "./financialProposalSchema";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { FinancialEvidence } from "./types";

test("normalizes kind fields, fills a unique outcome id and deduplicates temporary ids", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["choice_fallback_1"],
    proposals: [
      { id: "temporary", type: "one_off_income_received", effectiveAtAgeInMonths: 301, payload: {}, evidence: "证据", confidence: 0.9 },
      { id: "temporary", kind: "one_off_expense_paid", effectiveAtAgeInMonths: 301, payload: {}, sourceOutcomeId: null, evidence: "证据", confidence: 0.9 }
    ]
  });
  assert.deepEqual(result.proposals.map((proposal) => proposal.id), ["temporary", "temporary_2"]);
  assert.deepEqual(result.proposals.map((proposal) => proposal.sourceOutcomeId), ["choice_fallback_1", "choice_fallback_1"]);
  assert.equal(result.proposals[0].kind, "one_off_income_received");
  assert.equal(result.audit.some((item) => item.reasonCode === "DUPLICATE_ID_RENAMED"), true);
});

test("canonicalizes model expense transport before it can target a V4 ledger", () => {
  const currentLedger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "v4_expense_transport",
    asOfAgeInMonths: 360
  }));
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    proposals: [{
      id: "rent_start",
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: 372,
      payload: { id: "rent_main", type: "housing", monthlyAmountWan: 0.5 },
      evidence: "你开始每月支付5000元房租。",
      confidence: 0.9
    }]
  });
  const commitment = result.proposals[0].payload as any;
  assert.equal(commitment.responsibilityKey, "primary_residence:main");
  assert.equal(commitment.responsibilityKind, "primary_residence");
  assert.equal(commitment.amountBasis, "contextual_estimate");
  assert.equal(commitment.financialScope, "personal");
  assert.equal(Number.isInteger(commitment.nextReviewAtAgeInMonths), true);
  assert.equal(result.audit.some((item) => item.reasonCode === "V4_EXPENSE_CANONICALIZED"), true);
});

test("reconfirms the exact opening parent-healthcare placeholder instead of starting a duplicate account", () => {
  const currentLedger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "opening_parent_healthcare_reconfirmation",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: 10,
        status: "active",
        factStatus: "known",
        evidence: []
      }]
    }
  }));
  currentLedger.expenseCommitments.push({
    id: "opening_recurring_healthcare_opening_parent",
    type: "healthcare",
    displayName: "医疗持续支出（待确认）",
    monthlyAmountWan: 0.12,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "needs_review",
    evidence: [{
      source: "accepted_history",
      reasonCode: "OPENING_PARENT_HEALTHCARE",
      excerpt: "你需要持续承担父母医疗支出。",
      confidence: 0.8,
      financialScope: "personal"
    }],
    responsibilityKey: "recurring_healthcare:opening_parent",
    responsibilityKind: "recurring_healthcare",
    amountBasis: "contextual_estimate",
    amountSourceIds: ["opening_parent_healthcare"],
    financialScope: "personal",
    accrualReviewStatus: "conservative",
    lastReviewedAtAgeInMonths: 300,
    nextReviewAtAgeInMonths: 312
  });
  const narrative = "你每月要承担约两千元的医疗支出。";
  const normalized = normalizeFinancialProposals({
    acceptedOutcomeIds: ["accepted_choice"],
    currentLedger,
    proposals: [{
      id: "expense_healthcare_parents",
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: 312,
      payload: {
        id: "expense_healthcare_parents",
        type: "recurring_healthcare",
        displayName: "父母医疗支出",
        monthlyAmountWan: 0.2,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 312,
        status: "active",
        factStatus: "estimated",
        evidence: []
      },
      evidence: narrative,
      confidence: 0.9
    }]
  });

  assert.equal(normalized.proposals.length, 1);
  assert.equal(normalized.proposals[0]?.kind, "expense_commitment_adjusted");
  const payload = normalized.proposals[0]?.payload as any;
  assert.equal(payload.expenseCommitmentId, "opening_recurring_healthcare_opening_parent");
  assert.equal(payload.nextCommitment.id, "opening_recurring_healthcare_opening_parent");
  assert.equal(payload.nextCommitment.type, "healthcare");
  assert.equal(payload.nextCommitment.monthlyAmountWan, 0.2);
  assert.equal(payload.nextCommitment.accrualPolicy, undefined);
  assert.equal(payload.nextCommitment.responsibilityKey, "recurring_healthcare:opening_parent");
  assert.equal(payload.nextCommitment.factStatus, "needs_review");
  assert.deepEqual(validateFinancialPayloadSchema("expense_commitment_adjusted", payload), []);
  assert.equal(normalized.audit.some((item) => item.reasonCode === "OPENING_PARENT_HEALTHCARE_RECONFIRMED"), true);
  assert.equal(normalized.audit.some((item) => item.reasonCode === "EXPENSE_INCOME_FIELD_DROPPED"), true);

  const validation = validateFinancialProposals({
    proposals: normalized.proposals,
    currentLedger,
    currentCareerState: initializeCareerState({
      id: "career_current",
      employmentStatus: "employed",
      effectiveFromAgeInMonths: 300
    }),
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "opening_parent_healthcare_reconfirmation",
    liquidityPolicy: "require_explicit"
  });
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.acceptedEvents.length, 1);

  const reduced = reduceFinancialLedger({
    ledger: currentLedger,
    transactionId: "opening_parent_healthcare_reconfirmation",
    expectedLedgerRevision: currentLedger.revision,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    events: validation.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  const parentHealthcare = reduced.ledger.expenseCommitments.filter((commitment) => (
    commitment.responsibilityKey === "recurring_healthcare:opening_parent"
  ));
  assert.equal(parentHealthcare.length, 1);
  assert.equal(parentHealthcare[0]?.monthlyAmountWan, 0.2);
});

test("does not broaden opening parent-healthcare reconfirmation to a known account", () => {
  const currentLedger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "known_parent_healthcare_is_not_rewritten",
    asOfAgeInMonths: 300
  }));
  currentLedger.expenseCommitments.push({
    id: "opening_recurring_healthcare_opening_parent",
    type: "healthcare",
    displayName: "父母医疗支出",
    monthlyAmountWan: 0.12,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence: [],
    responsibilityKey: "recurring_healthcare:opening_parent",
    responsibilityKind: "recurring_healthcare",
    amountBasis: "explicit_known",
    amountSourceIds: ["accepted:opening_parent_healthcare"],
    financialScope: "personal",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: 300,
    nextReviewAtAgeInMonths: 312
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["accepted_choice"],
    currentLedger,
    proposals: [{
      id: "expense_healthcare_parents",
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: 312,
      payload: { type: "recurring_healthcare", displayName: "父母医疗支出", monthlyAmountWan: 0.2 },
      evidence: "你每月要承担约两千元的医疗支出。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0]?.kind, "expense_commitment_started");
  assert.notEqual((result.proposals[0]?.payload as any).id, "opening_recurring_healthcare_opening_parent");
  assert.equal(result.audit.some((item) => item.reasonCode === "OPENING_PARENT_HEALTHCARE_RECONFIRMED"), false);
});

test("keeps a V4 mortgage-payment expense schema-invalid for the validator instead of crashing canonicalization", () => {
  const currentLedger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "v4_mortgage_payment_routing",
    asOfAgeInMonths: 360
  }));
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    proposals: [{
      id: "mortgage_payment_as_expense",
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: 372,
      payload: { id: "mortgage_monthly", type: "mortgage_payment", monthlyAmountWan: 0.8 },
      evidence: "你已经支付首期房贷月供8000元。",
      confidence: 1
    }]
  });

  assert.equal((result.proposals[0]?.payload as any).type, "mortgage_payment");
  assert.equal(result.audit.some((item) => item.reasonCode === "MORTGAGE_PAYMENT_KEPT_OUT_OF_HOUSING"), true);
  assert.equal(result.audit.some((item) => item.reasonCode === "V4_EXPENSE_CANONICALIZED"), false);
});

test("fills only the missing CareerState reference without changing wage semantics", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentCareerStateId: "career_current",
    nextCareerStateIds: ["career_new_job"],
    proposals: [{
      id: "new_wage",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 301,
      payload: { id: "salary_new", type: "salary", monthlyNetAmountWan: 1.25 },
      evidence: "你正式入职，月薪1.25万元",
      confidence: 0.9
    }]
  });
  assert.equal((result.proposals[0].payload as { linkedCareerStateId: string }).linkedCareerStateId, "career_new_job");
  assert.equal((result.proposals[0].payload as { monthlyNetAmountWan: number }).monthlyNetAmountWan, 1.25);
  assert.equal(result.audit.some((item) => item.reasonCode === "CAREER_LINK_FILLED"), true);
});

test("repairs an invented CareerState reference to the single accepted next state", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentCareerStateId: "career_current",
    nextCareerStateIds: ["career_authoritative_next"],
    proposals: [{
      id: "repaired_owner_draw",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 301,
      payload: {
        id: "owner_draw", type: "self_employment_draw", monthlyNetAmountWan: 4,
        linkedCareerStateId: "career_model_invented"
      },
      evidence: "公司从本月起每月向你个人账户支付4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal((result.proposals[0].payload as any).linkedCareerStateId, "career_authoritative_next");
});

test("anchors from-this-month recurring income to the current period start", () => {
  const currentLedger = initializeFinancialLedger({ id: "income_timing", asOfAgeInMonths: 295 });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_current",
    proposals: [{
      id: "salary_late_timestamp",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 304,
      sourceOutcomeId: "selected",
      payload: {
        id: "owner_salary", type: "self_employment_draw", monthlyNetAmountWan: 4,
        accrualPolicy: "monthly", activeFromAgeInMonths: 304, status: "active", factStatus: "known", evidence: []
      },
      evidence: "公司从本月起每月向你个人账户支付4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0].effectiveAtAgeInMonths, 295);
  assert.equal((result.proposals[0].payload as any).activeFromAgeInMonths, 295);
});

test("drops a debt draw reconstructed only from an existing mortgage monthly-payment restatement", () => {
  const currentLedger = initializeFinancialLedger({
    id: "existing_mortgage_payment", asOfAgeInMonths: 420,
    openingPosition: {
      debtAccounts: [{
        id: "opening_mortgage", type: "mortgage", displayName: "既有住房按揭",
        principalWan: 180, openedAtAgeInMonths: 300, status: "active",
        repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.8 },
        factStatus: "known", evidence: []
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger,
    proposals: [{
      id: "duplicate_mortgage_draw", kind: "debt_drawn", effectiveAtAgeInMonths: 432,
      payload: {
        principalDrawnWan: 0.8,
        debtAccount: {
          id: "invented_mortgage", type: "mortgage", displayName: "房贷月供",
          principalWan: 0.8, openedAtAgeInMonths: 432, status: "active",
          repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.8 },
          factStatus: "estimated", evidence: []
        }
      },
      evidence: "银行重新调整后，你仍按现有房贷每月月供8000元。", confidence: 0.9
    }]
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.audit.some((item) => item.reasonCode === "EXISTING_MORTGAGE_PAYMENT_DEBT_DRAW_DROPPED"), true);
});

test("keeps an explicit newly disbursed mortgage distinct from an existing mortgage payment", () => {
  const currentLedger = initializeFinancialLedger({
    id: "new_mortgage_after_existing", asOfAgeInMonths: 420,
    openingPosition: {
      debtAccounts: [{
        id: "opening_mortgage", type: "mortgage", displayName: "既有住房按揭",
        principalWan: 180, openedAtAgeInMonths: 300, status: "active",
        repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.8 },
        factStatus: "known", evidence: []
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger,
    proposals: [{
      id: "new_mortgage_draw", kind: "debt_drawn", effectiveAtAgeInMonths: 432,
      payload: {
        principalDrawnWan: 200,
        debtAccount: {
          id: "new_mortgage", type: "mortgage", displayName: "新增住房按揭",
          principalWan: 200, openedAtAgeInMonths: 432, status: "active",
          repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.8 },
          factStatus: "known", evidence: []
        }
      },
      evidence: "银行批准新增住房贷款200万元，贷款已经放款到账；新的月供8000元。", confidence: 0.9
    }]
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.audit.some((item) => item.reasonCode === "EXISTING_MORTGAGE_PAYMENT_DEBT_DRAW_DROPPED"), false);
});

test("canonicalizes a completed debt restructure from the authoritative old obligation without reducing principal or unpaid interest", () => {
  const currentLedger = initializeFinancialLedger({
    id: "completed_mortgage_restructure", asOfAgeInMonths: 328,
    openingPosition: {
      debtAccounts: [{
        id: "opening_mortgage", type: "mortgage", displayName: "用户明确的住房按揭",
        principalWan: 188.775, openedAtAgeInMonths: 288, status: "active",
        repaymentPolicy: {
          mode: "estimated_amortizing", monthlyPaymentWan: 1.3,
          monthlyPrincipalWan: 0.875, monthlyInterestWan: 0.425, remainingTermMonths: 200
        },
        factStatus: "known", evidence: [], accruedUnpaidInterestWan: 4.675,
        servicingStatus: "delinquent", consecutiveMissedPaymentMonths: 3,
        totalMissedPaymentMonths: 4, recentMissedPaymentAgeInMonths: [326, 327, 328]
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["request_debt_restructuring"], currentLedger,
    proposals: [{
      id: "debt_restructured_335", kind: "debt_restructured", effectiveAtAgeInMonths: 335,
      sourceOutcomeId: "request_debt_restructuring",
      payload: {
        oldDebtAccountId: "opening_mortgage",
        replacementDebtAccount: {
          id: "opening_mortgage_restructured", type: "mortgage", principalWan: 1,
          policy: "estimated_amortizing", factStatus: "known"
        }
      },
      evidence: "经理的话还在耳边——月供从1.3万元降到8200元，但还款期限延长了十年，后续贷款审批会受影响。",
      confidence: 0.9, financialScope: "personal"
    }]
  });

  assert.equal(result.proposals.length, 1);
  const payload = result.proposals[0]?.payload as any;
  const replacement = payload.replacementDebtAccount;
  assert.deepEqual(validateFinancialPayloadSchema("debt_restructured", payload), []);
  assert.equal(payload.oldDebtAccountId, "opening_mortgage");
  assert.equal(payload.transactionFeeWan, 0);
  assert.equal(replacement.id, "opening_mortgage_restructured");
  assert.equal(replacement.displayName, "用户明确的住房按揭（重组后）");
  assert.equal(replacement.principalWan, 188.775);
  assert.equal(replacement.accruedUnpaidInterestWan, 4.675);
  assert.equal(Math.round((replacement.principalWan + replacement.accruedUnpaidInterestWan) * 1000) / 1000, 193.45);
  assert.equal(replacement.openedAtAgeInMonths, 335);
  assert.equal(replacement.status, "active");
  assert.equal(replacement.factStatus, "needs_review");
  assert.deepEqual(replacement.repaymentPolicy, {
    mode: "known_schedule", monthlyPaymentWan: 0.82, monthlyInterestWan: 0.425
  });
  assert.equal(payload.capitalizedInterestWan, undefined);
  assert.equal(replacement.servicingStatus, "current");
  assert.equal(replacement.consecutiveMissedPaymentMonths, 0);
  assert.equal(replacement.totalMissedPaymentMonths, 0);
  assert.deepEqual(replacement.recentMissedPaymentAgeInMonths, []);
  assert.deepEqual(replacement.evidence, []);
  assert.equal(result.audit.some((item) => item.reasonCode === "DEBT_RESTRUCTURE_PAYLOAD_CANONICALIZED"), true);

  const validation = validateFinancialProposals({
    proposals: result.proposals,
    currentLedger,
    currentCareerState: initializeCareerState({
      id: "career_current", employmentStatus: "self_employed", effectiveFromAgeInMonths: 328
    }),
    acceptedOutcomeId: "request_debt_restructuring",
    narrativeText: "经理的话还在耳边——月供从1.3万元降到8200元，但还款期限延长了十年，后续贷款审批会受影响。",
    periodStartAgeInMonths: 328,
    periodEndAgeInMonths: 335,
    simulationTransactionId: "completed_mortgage_restructure"
  });
  assert.equal(validation.issues.length, 0);
  assert.equal(validation.acceptedEvents.length, 1);
  const accepted = validation.acceptedEvents[0];
  if (accepted?.kind === "debt_restructured") {
    assert.equal(accepted.payload.replacementDebtAccount.evidence[0]?.excerpt, "经理的话还在耳边——月供从1.3万元降到8200元，但还款期限延长了十年，后续贷款审批会受影响。");
  } else {
    assert.fail("expected accepted debt restructure");
  }
});

test("keeps a pending debt-restructure application schema-invalid instead of inventing a replacement debt", () => {
  const currentLedger = initializeFinancialLedger({
    id: "pending_mortgage_restructure", asOfAgeInMonths: 328,
    openingPosition: {
      debtAccounts: [{
        id: "opening_mortgage", type: "mortgage", displayName: "既有住房按揭",
        principalWan: 180, openedAtAgeInMonths: 288, status: "active",
        repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.75, remainingTermMonths: 240 },
        factStatus: "known", evidence: [], accruedUnpaidInterestWan: 2
      }]
    }
  });
  const rawPayload = {
    oldDebtAccountId: "opening_mortgage",
    replacementDebtAccount: { id: "invented_replacement", principalWan: 1 }
  };
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["request_debt_restructuring"], currentLedger,
    proposals: [{
      id: "pending_restructure", kind: "debt_restructured", effectiveAtAgeInMonths: 335,
      payload: rawPayload,
      evidence: "你申请将房贷月供从1.3万元降到8200元。",
      confidence: 0.9
    }]
  });

  assert.deepEqual(result.proposals[0]?.payload, rawPayload);
  assert.notDeepEqual(validateFinancialPayloadSchema("debt_restructured", result.proposals[0]?.payload), []);
  assert.equal(result.audit.some((item) => item.reasonCode === "DEBT_RESTRUCTURE_PAYLOAD_CANONICALIZED"), false);
});

test("canonicalizes a completed before-and-after monthly-payment restructure even when the new term is not narrated", () => {
  const currentLedger = initializeFinancialLedger({
    id: "payment_only_mortgage_restructure", asOfAgeInMonths: 328,
    openingPosition: {
      debtAccounts: [{
        id: "opening_mortgage", type: "mortgage", displayName: "既有住房按揭",
        principalWan: 188.775, openedAtAgeInMonths: 288, status: "active",
        repaymentPolicy: { mode: "estimated_amortizing", monthlyPaymentWan: 1.3, monthlyInterestWan: 0.425, remainingTermMonths: 200 },
        factStatus: "known", evidence: [], accruedUnpaidInterestWan: 4.675
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["request_debt_restructuring"], currentLedger,
    proposals: [{
      id: "debt_restructured_335", kind: "debt_restructured", effectiveAtAgeInMonths: 335,
      payload: {
        oldDebtAccountId: "opening_mortgage",
        replacementDebtAccount: { id: "opening_mortgage_restructured", type: "mortgage", principalWan: 1 }
      },
      evidence: "银行受理后，每月还款额从1.3万元降到了0.9万元。",
      confidence: 0.9
    }]
  });

  const replacement = (result.proposals[0]?.payload as any).replacementDebtAccount;
  assert.equal(replacement.principalWan, 188.775);
  assert.equal(replacement.accruedUnpaidInterestWan, 4.675);
  assert.equal(replacement.factStatus, "needs_review");
  assert.deepEqual(replacement.repaymentPolicy, {
    mode: "known_schedule", monthlyPaymentWan: 0.9, monthlyInterestWan: 0.425
  });
  assert.equal("remainingTermMonths" in replacement.repaymentPolicy, false);
});

test("drops a self-employment draw without an explicit personal receipt", () => {
  const nonPersonalBusinessFacts = [
    "第三个月你们注册了公司，租下共享办公位，开始交付产品。",
    "公司签下正式客户，客户年费4.8万元已经回款，但资金仍留在公司运营账户。",
    "老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。"
  ];

  for (const [index, evidence] of nonPersonalBusinessFacts.entries()) {
    const result = normalizeFinancialProposals({
      acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_founder",
      proposals: [{
        id: `company_fact_as_draw_${index}`, kind: "income_source_started", effectiveAtAgeInMonths: 420,
        payload: { id: `invented_draw_${index}`, type: "freelance", monthlyNetAmountWan: 8 },
        evidence, confidence: 0.9
      }]
    });
    assert.equal(result.proposals.length, 0, evidence);
    assert.equal(result.audit.some((item) => item.reasonCode === "PERSONAL_BUSINESS_INCOME_RECEIPT_MISSING"), true, evidence);
  }
});

test("drops a business dividend inferred from customer revenue or a profit-sharing discussion", () => {
  for (const evidence of [
    "公司注册后签下第一个客户，年费4.8万元已经回款。",
    "老周提醒你该谈分红了，你说等拿到第二个客户再说。"
  ]) {
    const result = normalizeFinancialProposals({
      acceptedOutcomeIds: ["selected"],
      proposals: [{
        id: "invented_dividend", kind: "income_source_started", effectiveAtAgeInMonths: 420,
        payload: { id: "invented_dividend_income", type: "business_dividend", annualNetAmountWan: 8 },
        evidence, confidence: 0.9
      }]
    });
    assert.equal(result.proposals.length, 0, evidence);
    assert.equal(result.audit.some((item) => item.reasonCode === "PERSONAL_BUSINESS_INCOME_RECEIPT_MISSING"), true, evidence);
  }
});

test("requires the personal draw or dividend amount and cadence to match its evidence", () => {
  const mismatchedSources = [
    {
      id: "mismatched_draw", type: "self_employment_draw", payload: {
        id: "mismatched_draw_income", type: "self_employment_draw", monthlyNetAmountWan: 1.5
      }, evidence: "公司从本月起每月向你的个人账户支付1.2万元税后工资。", careerId: "career_founder"
    },
    {
      id: "mismatched_dividend", type: "business_dividend", payload: {
        id: "mismatched_dividend_income", type: "business_dividend", annualNetAmountWan: 8
      }, evidence: "公司从本年度起已向你的个人账户支付年度分红6万元。"
    }
  ];
  for (const candidate of mismatchedSources) {
    const result = normalizeFinancialProposals({
      acceptedOutcomeIds: ["selected"], currentCareerStateId: candidate.careerId,
      proposals: [{
        id: candidate.id, kind: "income_source_started", effectiveAtAgeInMonths: 420,
        payload: candidate.payload, evidence: candidate.evidence, confidence: 0.9
      }]
    });
    assert.equal(result.proposals.length, 0, candidate.id);
    assert.equal(result.audit.some((item) => item.reasonCode === "PERSONAL_BUSINESS_INCOME_RECEIPT_MISSING"), true, candidate.id);
  }
});

test("rejects a planned personal business payment for starts, adjustments, and repairs", () => {
  const plannedEvidence = "公司计划从下月起每月向你个人账户支付4万元税后工资。";
  const currentLedger = initializeFinancialLedger({
    id: "planned_founder_income",
    asOfAgeInMonths: 420,
    openingPosition: {
      incomeSources: [{
        id: "owner_draw", type: "self_employment_draw", displayName: "既有业主提款",
        monthlyNetAmountWan: 3, accrualPolicy: "monthly", activeFromAgeInMonths: 400,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const start = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_founder",
    proposals: [{
      id: "planned_start", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: { id: "planned_draw", type: "self_employment_draw", monthlyNetAmountWan: 4 },
      evidence: plannedEvidence, confidence: 0.9
    }]
  });
  const adjustment = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger, currentCareerStateId: "career_founder",
    proposals: [{
      id: "planned_adjustment", kind: "income_source_adjusted", effectiveAtAgeInMonths: 420,
      payload: {
        incomeSourceId: "owner_draw",
        nextSource: { ...currentLedger.incomeSources[0], monthlyNetAmountWan: 4 }
      },
      evidence: plannedEvidence, confidence: 0.9
    }]
  });
  const repair = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_founder", narrativeText: plannedEvidence,
    rejectedProposals: [{
      id: "planned_repair", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: { id: "planned_repair_draw", type: "self_employment_draw", monthlyNetAmountWan: 4 },
      evidence: "你从本月起每月领取4万元业主提款。", confidence: 0.9
    }],
    proposals: [{ id: "planned_repair", evidence: plannedEvidence }]
  });
  for (const result of [start, adjustment, repair]) assert.equal(result.proposals.length, 0);
});

test("normalizes a personal self-employment draw only with an authoritative career link", () => {
  const valid = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_old", nextCareerStateIds: ["career_founder"],
    proposals: [{
      id: "founder_draw", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: { id: "founder_draw_income", type: "freelance", monthlyNetAmountWan: 4, linkedCareerStateId: "invented" },
      evidence: "董事会决议后，公司从本月起向你的个人账户每月支付4万元税后工资。", confidence: 0.9
    }]
  });
  assert.equal(valid.proposals.length, 1);
  assert.equal((valid.proposals[0].payload as any).type, "self_employment_draw");
  assert.equal((valid.proposals[0].payload as any).linkedCareerStateId, "career_founder");

  const salaryBeforeUnpaidDividend = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_founder",
    proposals: [{
      id: "paid_salary_before_unpaid_dividend", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: { id: "paid_salary_income", type: "self_employment_draw", monthlyNetAmountWan: 4 },
      evidence: "公司从本月起每月向你的个人账户支付4万元税后工资，但尚未分红。", confidence: 0.9
    }]
  });
  assert.equal(salaryBeforeUnpaidDividend.proposals.length, 1);

  const ownerDraw = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_founder",
    proposals: [{
      id: "explicit_owner_draw", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: { id: "explicit_owner_draw_income", type: "self_employment_draw", monthlyNetAmountWan: 2 },
      evidence: "你从本月起每月领取2万元业主提款。", confidence: 0.9
    }]
  });
  assert.equal(ownerDraw.proposals.length, 1);
  assert.equal((ownerDraw.proposals[0].payload as any).type, "self_employment_draw");

  const unlinked = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    proposals: [{
      id: "unlinked_founder_draw", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: { id: "unlinked_draw_income", type: "self_employment_draw", monthlyNetAmountWan: 4 },
      evidence: "你从本月起每月领取4万元业主提款。", confidence: 0.9
    }]
  });
  assert.equal(unlinked.proposals.length, 0);
  assert.equal(unlinked.audit.some((item) => item.reasonCode === "UNLINKED_SELF_EMPLOYMENT_DRAW_DROPPED"), true);
});

test("drops a no-op income adjustment instead of quarantining the authoritative source", () => {
  const currentLedger = initializeFinancialLedger({
    id: "income_noop",
    asOfAgeInMonths: 307,
    openingPosition: {
      incomeSources: [{
        id: "owner_salary", type: "self_employment_draw", displayName: "公司税后工资",
        monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 297,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_founder",
    proposals: [{
      id: "repeat_salary",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 315,
      sourceOutcomeId: "selected",
      payload: {
        incomeSourceId: "owner_salary",
        nextSource: {
          ...currentLedger.incomeSources[0],
          activeFromAgeInMonths: 307
        }
      },
      evidence: "你继续从公司每月领取4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.audit.some((item) => item.reasonCode === "NO_OP_PROPOSAL_DROPPED"), true);
});

test("normalizes compact expense next payloads and drops unchanged recurring commitments", () => {
  const currentLedger = migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id: "expense_noop",
    asOfAgeInMonths: 359
  }));
  currentLedger.expenseCommitments.push({
    id: "parent_support",
    type: "dependent_support",
    displayName: "每月给父母的赡养费",
    monthlyAmountWan: 0.2,
    activeFromAgeInMonths: 314,
    status: "active",
    factStatus: "estimated",
    evidence: [],
    responsibilityKey: "elder_care:parents",
    responsibilityKind: "elder_care",
    amountBasis: "contextual_estimate",
    amountSourceIds: ["parent_support:estimate"],
    financialScope: "personal",
    accrualReviewStatus: "review_due",
    lastReviewedAtAgeInMonths: 336,
    nextReviewAtAgeInMonths: 348
  });

  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["strengthen_shared_routine"],
    currentLedger,
    proposals: [{
      id: "repeat_parent_support",
      kind: "expense_commitment_adjusted",
      effectiveAtAgeInMonths: 362,
      sourceOutcomeId: "strengthen_shared_routine",
      payload: {
        expenseCommitmentId: "parent_support",
        next: {
          id: "parent_support",
          type: "expense_commitment",
          category: "family_support",
          displayName: "每月给父母的赡养费",
          monthlyAmountWan: 0.2,
          status: "active",
          factStatus: "estimated",
          evidence: []
        }
      },
      evidence: "你继续维持原来的家庭安排。",
      confidence: 0.85
    }]
  });

  assert.equal(result.proposals.length, 0);
  assert.equal(result.audit.some((item) => item.reasonCode === "EXPENSE_NEXT_ALIAS_NORMALIZED"), true);
  assert.equal(result.audit.some((item) => item.reasonCode === "NO_OP_PROPOSAL_DROPPED"), true);
});

test("preserves an explicit same-amount confirmation for a migration-only income source", () => {
  const legacyEvidence: FinancialEvidence[] = [{
    source: "legacy_migration",
    reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION",
    confidence: 0.5
  }];
  const currentLedger = initializeFinancialLedger({
    id: "legacy_income_confirmation",
    asOfAgeInMonths: 327,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "salary", displayName: "迁移工资",
        monthlyNetAmountWan: 2.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_current", factStatus: "estimated",
        evidence: legacyEvidence
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_current",
    proposals: [{
      id: "confirm_legacy_salary",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 357,
      sourceOutcomeId: "selected",
      payload: {
        incomeSourceId: "legacy_recurring_income",
        nextSource: { ...currentLedger.incomeSources[0] }
      },
      evidence: "你目前仍在原岗位，税后月薪为2.5万元。",
      confidence: 0.9
    }]
  });

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].kind, "income_source_adjusted");
  assert.equal(result.audit.some((item) => item.reasonCode === "LEGACY_INCOME_RECONFIRMATION_PRESERVED"), true);
});

test("normalizes a repeated income start for the same source id into an adjustment", () => {
  const currentLedger = initializeFinancialLedger({
    id: "income_existing",
    asOfAgeInMonths: 307,
    openingPosition: {
      incomeSources: [{
        id: "self_employment_draw_supplychain", type: "self_employment_draw", displayName: "创业月度提款",
        monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 295,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_founder",
    proposals: [{
      id: "raise_owner_salary",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 315,
      sourceOutcomeId: "selected",
      payload: {
        id: "self_employment_draw_supplychain", type: "self_employment_draw", displayName: "创业月度提款",
        monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 315,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      },
      evidence: "从本月起公司向你的个人账户每月支付4万元税后工资。",
      confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0].kind, "income_source_adjusted");
  assert.equal((result.proposals[0].payload as any).incomeSourceId, "self_employment_draw_supplychain");
  assert.equal((result.proposals[0].payload as any).nextSource.monthlyNetAmountWan, 4);
  assert.equal(result.audit.some((item) => item.reasonCode === "INCOME_START_NORMALIZED_TO_ADJUSTMENT"), true);
});

test("fills a missing cash account reference without changing the amount", () => {
  const currentLedger = initializeFinancialLedger({
    id: "cash_normalization",
    asOfAgeInMonths: 300,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 3, status: "active", factStatus: "known", evidence: [] }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    proposals: [{ id: "income", kind: "one_off_income_received", effectiveAtAgeInMonths: 301, payload: { amountWan: 2 }, evidence: "你收到2万元", confidence: 0.9 }]
  });
  assert.equal((result.proposals[0].payload as { destinationCashAccountId: string }).destinationCashAccountId, PRIMARY_CASH_ACCOUNT_ID);
  assert.equal((result.proposals[0].payload as { amountWan: number }).amountWan, 2);
});

test("normalizes a flat model debt draw into the authoritative cash-balanced payload", () => {
  const currentLedger = initializeFinancialLedger({
    id: "flat_debt_draw",
    asOfAgeInMonths: 384,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 30, status: "active", factStatus: "known", evidence: [] }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["borrow_for_studio"],
    currentLedger,
    proposals: [{
      id: "loan_drawn",
      kind: "debt_drawn",
      effectiveAtAgeInMonths: 390,
      payload: {
        id: "debt_loan_2024",
        type: "personal_business_loan",
        displayName: "个人经营贷款",
        principalAmountWan: 20,
        annualInterestRate: 0.06,
        termMonths: 36,
        monthlyPaymentWan: 0.6083,
        activeFromAgeInMonths: 390,
        status: "active",
        factStatus: "estimated",
        evidence: []
      },
      evidence: "银行完成20万元经营贷款放款。",
      confidence: 0.9
    }]
  });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.destinationCashAccountId, PRIMARY_CASH_ACCOUNT_ID);
  assert.equal(payload.principalDrawnWan, 20);
  assert.equal(payload.debtAccount.id, "debt_loan_2024");
  assert.equal(payload.debtAccount.type, "business_personal_guarantee");
  assert.equal(payload.debtAccount.principalWan, 20);
  assert.deepEqual(payload.debtAccount.repaymentPolicy, {
    mode: "known_schedule",
    monthlyPaymentWan: 0.6083,
    annualInterestRate: 0.06,
    remainingTermMonths: 36
  });
  assert.equal(result.audit.some((item) => item.reasonCode === "DEBT_DRAW_PAYLOAD_NORMALIZED"), true);
  assert.equal(result.audit.some((item) => item.reasonCode === "DEBT_TYPE_NORMALIZED"), true);
});

test("normalizes asset purchase price aliases and fills the cash source", () => {
  const currentLedger = initializeFinancialLedger({
    id: "asset_purchase_alias",
    asOfAgeInMonths: 384,
    openingPosition: { cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 20, status: "active", factStatus: "known", evidence: [] }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["choice_equipment"],
    currentLedger,
    proposals: [{
      id: "equipment_purchase",
      kind: "asset_purchased",
      effectiveAtAgeInMonths: 390,
      payload: {
        assetAccount: { id: "equipment", type: "business_asset", marketValueWan: 20 },
        purchasePriceWan: 20,
        linkedDebtDrawEventId: "loan_draw"
      },
      evidence: "贷款到账当天，你立即支付20万元购买设备。",
      confidence: 0.9
    }]
  });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.cashPaidWan, 20);
  assert.equal(payload.transactionFeeWan, 0);
  assert.equal(payload.sourceCashAccountId, PRIMARY_CASH_ACCOUNT_ID);
  assert.equal(result.audit.some((item) => item.reasonCode === "ASSET_PURCHASE_PAYLOAD_NORMALIZED"), true);
});

test("completes long-tail recurring income and expense shapes from deterministic aliases", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [
    { id: "stipend", kind: "income_source_started", effectiveAtAgeInMonths: 300, payload: { type: "stipend", accrualPolicy: "recurring_monthly" }, evidence: "你每月获得4500元补贴。", confidence: 0.9 },
    { id: "caregiver", kind: "expense_commitment_started", effectiveAtAgeInMonths: 300, payload: { type: "caregiver" }, evidence: "你每月支付护工6000元。", confidence: 0.9 }
  ] });
  const income = result.proposals[0].payload as any;
  const expense = result.proposals[1].payload as any;
  assert.equal(income.type, "other");
  assert.equal(income.accrualPolicy, "monthly");
  assert.equal(income.monthlyNetAmountWan, 0.45);
  assert.equal(income.status, "active");
  assert.equal(expense.type, "dependent_support");
  assert.equal(expense.monthlyAmountWan, 0.6);
  assert.equal(expense.status, "active");
});

test("completes late-discovered mortgage shape without inventing current cash movement", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "old_mortgage", kind: "debt_balance_discovered", effectiveAtAgeInMonths: 400,
    payload: { debt: { accountId: "mortgage_home", amountWan: 120 } },
    evidence: "你名下住房尚有120万元房贷余额。", confidence: 0.9
  }] });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.debtAccount.id, "mortgage_home");
  assert.equal(payload.debtAccount.type, "mortgage");
  assert.equal(payload.debtAccount.principalWan, 120);
  assert.equal(payload.debtAccount.repaymentPolicy.mode, "estimated_amortizing");
  assert.equal(payload.destinationCashAccountId, undefined);
});

test("normalizes residential purchase aliases and explicit price without inventing a valuation", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "home_purchase", kind: "asset_purchased", effectiveAtAgeInMonths: 422,
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      cashPaidWan: 54,
      transactionFeeWan: 0,
      linkedDebtDrawEventId: "mortgage_draw",
      assetAccount: { id: "home", type: "residential_property", factStatus: "confirmed" }
    },
    evidence: "你买下一套两居室，总价180万，首付54万，组合贷款126万。", confidence: 0.9
  }] });
  const account = (result.proposals[0].payload as any).assetAccount;
  assert.equal(account.type, "property");
  assert.equal(account.marketValueWan, 180);
  assert.equal(account.factStatus, "known");
});

test("keeps an unknown discovered property as needs-review zero carrying value", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "old_home", kind: "asset_balance_discovered", effectiveAtAgeInMonths: 422,
    payload: { asset: { accountId: "home", type: "house" } },
    evidence: "你仍住在自己名下的房子里，但当前估值不清楚。", confidence: 0.9
  }] });
  const account = (result.proposals[0].payload as any).assetAccount;
  assert.equal(account.type, "property");
  assert.equal(account.marketValueWan, 0);
  assert.equal(account.factStatus, "needs_review");
});

test("repair output inherits omitted structural fields from the rejected proposal", () => {
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    rejectedProposals: [{
      id: "consulting_income",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 700,
      payload: { id: "consulting", type: "salary", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 700, status: "active", factStatus: "estimated", evidence: [] },
      sourceOutcomeId: "selected",
      evidence: "你转为顾问，每月收入2万元。",
      confidence: 0.9
    }],
    proposals: [{ id: "consulting_income", payload: { monthlyNetAmountWan: 2.2 } }]
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].kind, "income_source_started");
  assert.equal(result.proposals[0].confidence, 0.9);
  assert.equal((result.proposals[0].payload as any).id, "consulting");
  assert.equal((result.proposals[0].payload as any).monthlyNetAmountWan, 2.2);
});

test("repair duplicate rows collapse into one proposal", () => {
  const rejected = [{
    id: "end_salary", kind: "income_source_ended" as const, effectiveAtAgeInMonths: 700,
    payload: { incomeSourceId: "salary" }, sourceOutcomeId: "selected", evidence: "你结束全职工作。", confidence: 0.9
  }];
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    rejectedProposals: rejected,
    proposals: [{ id: "end_salary" }, { id: "end_salary", confidence: 0.95 }]
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].confidence, 0.95);
  assert.equal(result.audit.some((item) => item.reasonCode === "REPAIR_DUPLICATE_COLLAPSED"), true);
});

test("normalizes consultant income and fills the sole active career income id", () => {
  const currentLedger = initializeFinancialLedger({
    id: "career_income", asOfAgeInMonths: 696,
    openingPosition: { incomeSources: [{
      id: "legacy_salary", type: "other", displayName: "旧工资", annualNetAmountWan: 45,
      accrualPolicy: "annual", activeFromAgeInMonths: 696, status: "active", linkedCareerStateId: "career_old", factStatus: "estimated", evidence: []
    }] }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger, currentCareerStateId: "career_old", nextCareerStateIds: ["career_consultant"],
    proposals: [
      { id: "end_old", kind: "income_source_ended", effectiveAtAgeInMonths: 696, payload: {}, evidence: "你结束全职工作。", confidence: 0.9 },
      { id: "start_consulting", kind: "income_source_started", effectiveAtAgeInMonths: 696, payload: { id: "consulting", type: "consulting" }, evidence: "你转为顾问。", confidence: 0.9 }
    ]
  });
  assert.equal((result.proposals[0].payload as any).incomeSourceId, "legacy_salary");
  assert.equal((result.proposals[1].payload as any).type, "contract");
  assert.equal((result.proposals[1].payload as any).linkedCareerStateId, "career_consultant");
});

test("repair evidence is grounded to a verbatim consultant sentence", () => {
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    narrativeText: "你转为每周三天的顾问后，顾问年收入稳定在24万左右。家庭生活也慢了下来。",
    rejectedProposals: [{
      id: "consulting", kind: "income_source_started", effectiveAtAgeInMonths: 696,
      payload: { id: "consulting", type: "contract", annualNetAmountWan: 24 }, sourceOutcomeId: "selected",
      evidence: "顾问收入约24万元", confidence: 0.9
    }],
    proposals: [{ id: "consulting", evidence: "新的收入已经稳定" }]
  });
  assert.equal(result.proposals[0].evidence, "你转为每周三天的顾问后，顾问年收入稳定在24万左右。家庭生活也慢了下来。".split("家庭")[0]);
});

test("repair never rewrites a personal draw to a word-only profit-sharing sentence", () => {
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentCareerStateId: "career_founder",
    narrativeText: "公司注册后签下正式客户，客户年费4.8万元已经回款。老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。",
    rejectedProposals: [{
      id: "invented_owner_draw", kind: "income_source_started", effectiveAtAgeInMonths: 420,
      payload: {
        id: "invented_owner_draw_income", type: "self_employment_draw", monthlyNetAmountWan: 1.5,
        linkedCareerStateId: "career_founder"
      },
      sourceOutcomeId: "selected",
      evidence: "你开始接供应链咨询零活，每月能多挣1.5万元。",
      confidence: 0.9
    }],
    proposals: [{ id: "invented_owner_draw" }]
  });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.audit.some((item) => item.reasonCode === "PERSONAL_BUSINESS_INCOME_REPAIR_EVIDENCE_DROPPED"), true);
});

test("repair cannot relabel a rejected personal business income as another personal cash inflow", () => {
  const narrativeText = "公司注册后签下正式客户，客户年费4.8万元已经回款。老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。";
  const rejectedProposals = [{
    id: "invented_owner_draw", kind: "income_source_started" as const, effectiveAtAgeInMonths: 420,
    payload: {
      id: "invented_owner_draw_income", type: "self_employment_draw", monthlyNetAmountWan: 1.5,
      linkedCareerStateId: "career_founder"
    },
    sourceOutcomeId: "selected", evidence: "你开始接供应链咨询零活，每月能多挣1.5万元。", confidence: 0.9
  }];
  const attemptedMutations = [
    { id: "invented_owner_draw", kind: "income_source_started", payload: { type: "rent", monthlyNetAmountWan: 1.5 } },
    { id: "invented_owner_draw", kind: "income_source_started", payload: { type: "other", monthlyNetAmountWan: 1.5 } },
    { id: "invented_owner_draw", kind: "income_source_started", payload: { type: "contract", monthlyNetAmountWan: 1.5 } },
    { id: "invented_owner_draw", kind: "one_off_income_received", payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1.5 } }
  ];
  for (const repairProposal of attemptedMutations) {
    const result = normalizeRepairedFinancialProposals({
      acceptedOutcomeIds: ["selected"], currentCareerStateId: "career_founder", narrativeText,
      rejectedProposals, proposals: [repairProposal]
    });
    assert.equal(result.proposals.length, 0, JSON.stringify(repairProposal));
    assert.equal(result.audit.some((item) => item.reasonCode === "REPAIR_PERSONAL_BUSINESS_INCOME_MUTATION_DROPPED"), true);
  }
});

test("repair evidence for a debt draw is grounded to the completed disbursement sentence", () => {
  const sentence = "银行正式批准贷款，并将20万元全额放入你的现金账户。";
  const result = normalizeRepairedFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    narrativeText: `${sentence}到账当天你支付20万元购买设备。`,
    rejectedProposals: [{
      id: "loan_draw", kind: "debt_drawn", effectiveAtAgeInMonths: 390,
      payload: { principalDrawnWan: 20 }, sourceOutcomeId: "selected",
      evidence: "贷款已经到账", confidence: 0.9
    }],
    proposals: [{ id: "loan_draw", evidence: "银行已经处理" }]
  });
  assert.equal(result.proposals[0].evidence, sentence);
});

test("corrects a cash-account id used as the sole active income-source id and completes the next source shape", () => {
  const currentLedger = initializeFinancialLedger({ id: "typed_income", asOfAgeInMonths: 300, openingPosition: {
    cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 3, status: "active", factStatus: "known", evidence: [] }],
    incomeSources: [{ id: "salary_main", type: "salary", displayName: "工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: [] }]
  } });
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], currentLedger, currentCareerStateId: "career_current", proposals: [{ id: "adjust", kind: "income_source_adjusted", effectiveAtAgeInMonths: 312, payload: { incomeSourceId: PRIMARY_CASH_ACCOUNT_ID, nextSource: { monthlyNetAmountWan: 3 } }, evidence: "你涨薪到每月3万元。", confidence: 0.9 }] });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.incomeSourceId, "salary_main"); assert.equal(payload.nextSource.id, "salary_main"); assert.equal(payload.nextSource.displayName, "工资"); assert.equal(payload.nextSource.monthlyNetAmountWan, 3);
  assert.equal(result.audit.some((item) => item.reasonCode === "ACCOUNT_ID_TYPE_CORRECTED"), true);
});

test("preserves policy evidence when an expense adjustment omits it", () => {
  const currentLedger = initializeFinancialLedger({ id: "expense_evidence", asOfAgeInMonths: 288, openingPosition: {
    expenseCommitments: [{
      id: "living_policy", type: "basic_living", displayName: "基础生活支出（系统保守估计）",
      monthlyAmountWan: 0.15, activeFromAgeInMonths: 216, status: "active", factStatus: "estimated",
      evidence: [{ source: "system_policy", reasonCode: "STUDENT_BASIC_LIVING_ESTIMATED_V1", confidence: 0.6 }]
    }]
  } });
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], currentLedger, proposals: [{
    id: "adjust_living", kind: "expense_commitment_adjusted", effectiveAtAgeInMonths: 300,
    payload: { expenseCommitmentId: "living_policy", nextCommitment: { monthlyAmountWan: 0.15, evidence: [] } },
    evidence: "生活支出仍按估计处理。", confidence: 0.9
  }] });
  const next = (result.proposals[0].payload as any).nextCommitment;
  assert.equal(next.evidence[0].source, "system_policy");
  assert.equal(result.audit.some((item) => item.reasonCode === "EXPENSE_EVIDENCE_PRESERVED"), true);
});

test("normalizes the narrow nextState alias for an existing expense adjustment", () => {
  const currentLedger = initializeFinancialLedger({ id: "expense_next_state_alias", asOfAgeInMonths: 288, openingPosition: {
    expenseCommitments: [{
      id: "rent_main", type: "housing", displayName: "住房支出",
      monthlyAmountWan: 0.5, activeFromAgeInMonths: 288, status: "active", factStatus: "needs_review",
      evidence: [{ source: "accepted_history", reasonCode: "OPENING_RENT", confidence: 0.8 }]
    }]
  } });
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], currentLedger, proposals: [{
    id: "adjust_rent_alias", kind: "expense_commitment_adjusted", effectiveAtAgeInMonths: 300,
    payload: {
      expenseCommitmentId: "rent_main",
      nextState: { monthlyAmountWan: 0.6 }
    },
    evidence: "你已经开始每月支付6000元房租。", confidence: 0.95
  }] });

  assert.equal(result.proposals.length, 1);
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.nextState, undefined);
  assert.equal(payload.nextCommitment.id, "rent_main");
  assert.equal(payload.nextCommitment.monthlyAmountWan, 0.6);
  assert.equal(result.audit.some((item) => (
    item.reasonCode === "EXPENSE_NEXT_ALIAS_NORMALIZED" && item.originalValue === "nextState"
  )), true);
});

test("preserves expense account semantics when rent-only evidence targets a basic-living adjustment", () => {
  const currentLedger = initializeFinancialLedger({ id: "expense_type_identity", asOfAgeInMonths: 288, openingPosition: {
    expenseCommitments: [{
      id: "living_policy", type: "basic_living", displayName: "基础生活支出（系统保守估计）",
      monthlyAmountWan: 0.35, activeFromAgeInMonths: 288, status: "active", factStatus: "estimated",
      evidence: [{ source: "system_policy", reasonCode: "ADULT_BASIC_LIVING_ESTIMATED_V1", confidence: 0.6 }]
    }]
  } });
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], currentLedger, proposals: [{
    id: "adjust_rent", kind: "expense_commitment_adjusted", effectiveAtAgeInMonths: 300,
    payload: {
      expenseCommitmentId: "living_policy",
      nextCommitment: { type: "housing", displayName: "基本生活与房租", monthlyAmountWan: 0.5 }
    },
    evidence: "你搬到新城市后，每月房租调整为5000元。", confidence: 0.9
  }] });
  const next = (result.proposals[0].payload as any).nextCommitment;
  assert.equal(next.type, "basic_living");
  assert.equal(result.audit.some((item) => item.reasonCode === "EXPENSE_TYPE_PRESERVED"), true);
});

test("repairs an unknown income id and annual amount against the sole active career source", () => {
  const currentLedger = initializeFinancialLedger({ id: "annual_income_repair", asOfAgeInMonths: 351, openingPosition: {
    incomeSources: [{
      id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
      annualNetAmountWan: 18, accrualPolicy: "annual", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_previous", factStatus: "needs_review", evidence: []
    }]
  } });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    currentCareerStateId: "career_current",
    proposals: [{
      id: "salary_351_32", kind: "income_source_adjusted", effectiveAtAgeInMonths: 379,
      payload: { incomeSourceId: "salary_351", nextSource: { amountWan: 32, displayName: "分公司年薪" } },
      evidence: "29岁3个月，你已在分公司站稳脚跟，年薪32万。", confidence: 0.95
    }]
  });
  const payload = result.proposals[0].payload as any;
  assert.equal(payload.incomeSourceId, "legacy_recurring_income");
  assert.equal(payload.nextSource.id, "legacy_recurring_income");
  assert.equal(payload.nextSource.accrualPolicy, "annual");
  assert.equal(payload.nextSource.annualNetAmountWan, 32);
});

test("does not replace the living baseline with rent-only evidence", () => {
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    proposals: [{
      id: "project_dorm_rent",
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: 318,
      payload: {
        id: "expense_project_living",
        type: "basic_living",
        displayName: "乡村生活支出",
        monthlyAmountWan: 0.03
      },
      evidence: "你住进学校旁的教师宿舍，月租仅300元。",
      confidence: 0.9
    }]
  });
  assert.equal((result.proposals[0].payload as any).type, "housing");
  assert.equal(result.audit.some((item) => item.reasonCode === "RENT_ONLY_RECLASSIFIED_AS_HOUSING"), true);
});

test("keeps mortgage repayments out of housing commitments instead of normalizing 月供 to housing", () => {
  const currentLedger = initializeFinancialLedger({ id: "mortgage_routing", asOfAgeInMonths: 318, openingPosition: {
    expenseCommitments: [{
      id: "housing_cost", type: "housing", displayName: "房屋物业与维护", monthlyAmountWan: 0.1,
      activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence: []
    }]
  } });
  const started = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    proposals: [{
      id: "mortgage_as_expense", kind: "expense_commitment_started", effectiveAtAgeInMonths: 318,
      payload: { id: "mortgage_monthly", displayName: "房贷月供", monthlyAmountWan: 0.8 },
      evidence: "本月起你每月房贷月供8000元。", confidence: 0.9
    }]
  });
  assert.equal((started.proposals[0].payload as any).type, "mortgage_payment");
  assert.equal(started.audit.some((item) => item.reasonCode === "MORTGAGE_PAYMENT_KEPT_OUT_OF_HOUSING"), true);

  const adjusted = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger,
    proposals: [{
      id: "mortgage_as_housing_adjustment", kind: "expense_commitment_adjusted", effectiveAtAgeInMonths: 318,
      payload: { expenseCommitmentId: "housing_cost", nextCommitment: { type: "housing", monthlyAmountWan: 0.8 } },
      evidence: "银行调整后，你每月房贷月供8000元。", confidence: 0.9
    }]
  });
  assert.equal((adjusted.proposals[0].payload as any).nextCommitment.type, "mortgage_payment");
  assert.equal(adjusted.audit.some((item) => item.reasonCode === "MORTGAGE_PAYMENT_KEPT_OUT_OF_HOUSING"), true);
});

test("normalizes a fixed option schedule and expiry into authoritative option terms", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "grant", kind: "business_option_granted", effectiveAtAgeInMonths: 348,
    payload: { optionHolding: {
      id: "employee_option", instrumentType: "stock_option", business: { id: "employer" },
      optionTerms: { grantedUnits: 30000, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.001 },
      vestingSchedule: "4年归属，每年25%", expirationDateInMonths: 408,
      personalCarryingValueWan: 0, status: "active", factStatus: "estimated", evidence: []
    } }, evidence: "公司授予3万份期权，四年归属，每年25%，34岁到期。", confidence: 0.8
  }] });
  const terms = (result.proposals[0].payload as any).optionHolding.optionTerms;
  assert.deepEqual(terms.vestingPolicy, { totalMonths: 48, frequencyMonths: 12 });
  assert.equal(terms.expiresAtAgeInMonths, 408);
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_TERMS_NORMALIZED"), true);
});

test("clamps a current option grant that carries a stale model timestamp", () => {
  const currentLedger = initializeFinancialLedger({ id: "option_timing", asOfAgeInMonths: 324 });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"],
    currentLedger,
    proposals: [{
      id: "stock_option_330",
      kind: "business_option_granted",
      effectiveAtAgeInMonths: 303,
      payload: {
        optionHolding: {
          id: "personal_option",
          business: { id: "employer" },
          instrumentType: "stock_option",
          status: "active"
        }
      },
      evidence: "你获得公司授予的1%期权，具体份数待确认。",
      confidence: 0.85
    }]
  });
  assert.equal(result.proposals[0].effectiveAtAgeInMonths, 324);
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_EFFECTIVE_DATE_CLAMPED"), true);
});

test("does not turn a vesting period into an unsupported option expiry", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "grant_without_expiry", kind: "business_option_granted", effectiveAtAgeInMonths: 297,
    payload: { optionHolding: {
      id: "startup_option", instrumentType: "stock_option", business: { id: "startup" },
      optionTerms: { grantedUnits: 8000, vestedUnits: 0, exercisedUnits: 0, strikePriceWanPerUnit: 0.001, expiresAtAgeInMonths: 336 },
      vestingSchedule: "4年归属，每年25%", personalCarryingValueWan: 0, status: "active", factStatus: "estimated", evidence: []
    } }, evidence: "公司承诺期权分四年归属。", confidence: 0.9
  }] });
  assert.equal((result.proposals[0].payload as any).optionHolding.optionTerms.expiresAtAgeInMonths, undefined);
});

test("unwraps a nested partial equity holding without inventing a valuation", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "founder_equity", kind: "business_holding_started", effectiveAtAgeInMonths: 405,
    payload: { businessHolding: { holdingId: "founder_share", instrumentType: "non_listed_equity", ownershipRate: 0.4, companyName: "供应链软件公司" } },
    evidence: "新的股权结构为：你占40%。", confidence: 0.9
  }] });
  const holding = (result.proposals[0].payload as any).businessHolding;
  assert.equal(holding.id, "founder_share");
  assert.equal(holding.business.displayName, "供应链软件公司");
  assert.equal(holding.ownershipRate, 0.4);
  assert.equal(holding.instrumentType, "equity");
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.factStatus, "needs_review");
  assert.equal(result.audit.some((item) => item.reasonCode === "BUSINESS_HOLDING_SHAPE_COMPLETED"), true);
});

test("converts a stock-option holding event and nested grant aliases to the option contract", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "my_options", kind: "business_holding_started", effectiveAtAgeInMonths: 348,
    payload: { holding: {
      holdingId: "employee_options", instrumentType: "stock_option", companyId: "employer",
      optionTerms: { grantedUnits: 30000 }, vestingSchedule: "4年归属，每年25%"
    } }, evidence: "公司授予你3万份期权，四年归属，每年25%。", confidence: 0.9
  }] });
  assert.equal(result.proposals[0].kind, "business_option_granted");
  const holding = (result.proposals[0].payload as any).optionHolding;
  assert.equal(holding.id, "employee_options");
  assert.equal(holding.instrumentType, "stock_option");
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.optionTerms.vestedUnits, 0);
  assert.deepEqual(holding.optionTerms.vestingPolicy, { totalMonths: 48, frequencyMonths: 12 });
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_EVENT_NORMALIZED"), true);
});

test("normalizes long-tail option aliases and keeps unknown option value out of wealth", () => {
  const currentLedger = initializeFinancialLedger({
    id: "existing_equity", asOfAgeInMonths: 360,
    openingPosition: {
      businessHoldings: [{
        id: "startup_equity", instrumentType: "equity", personalCarryingValueWan: 0,
        status: "active", factStatus: "needs_review", evidence: [],
        business: { id: "startup", displayName: "创业公司", status: "operating", factStatus: "known", evidence: [] }
      }]
    }
  });
  const result = normalizeFinancialProposals({
    acceptedOutcomeIds: ["selected"], currentLedger,
    proposals: [{
      id: "grant_alias", kind: "stock_option_grant", effectiveAtAgeInMonths: 368,
      payload: { optionHolding: { id: "startup_equity", displayName: "创业公司10%期权", businessId: "startup" } },
      evidence: "你持有创业公司10%的期权，但归属和行权条件仍待确认。", confidence: 0.9
    }]
  });
  assert.equal(result.proposals[0].kind, "business_option_granted");
  const holding = (result.proposals[0].payload as any).optionHolding;
  assert.equal(holding.id, "startup_equity_stock_option");
  assert.equal(holding.instrumentType, "stock_option");
  assert.equal(holding.optionTerms.grantedUnits, 0);
  assert.equal(holding.optionTerms.vestedUnits, 0);
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.factStatus, "needs_review");
});

test("recognizes option semantics in a generic holding event even when units are absent", () => {
  const result = normalizeFinancialProposals({ acceptedOutcomeIds: ["selected"], proposals: [{
    id: "generic_option", kind: "business_holding_started", effectiveAtAgeInMonths: 368,
    payload: { id: "employee_right", displayName: "员工期权", businessId: "employer" },
    evidence: "公司确认你拥有员工期权，具体份额待补充。", confidence: 0.85
  }] });
  assert.equal(result.proposals[0].kind, "business_option_granted");
  const holding = (result.proposals[0].payload as any).optionHolding;
  assert.equal(holding.optionTerms.grantedUnits, 0);
  assert.equal(holding.personalCarryingValueWan, 0);
  assert.equal(holding.factStatus, "needs_review");
  assert.equal(result.audit.some((item) => item.reasonCode === "OPTION_UNITS_UNKNOWN"), true);
});
