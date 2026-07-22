import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { normalizeFinancialProposals } from "./normalizeFinancialProposals";
import { validateFinancialProposals } from "./validateFinancialProposals";
import type { FinancialEventProposal, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];

function setup() {
  return {
    currentCareerState: initializeCareerState({ id: "career_current", employmentStatus: "employed", effectiveFromAgeInMonths: 300 }),
    currentLedger: initializeFinancialLedger({
      id: "proposal_test",
      asOfAgeInMonths: 300,
      openingPosition: {
        cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }]
      }
    })
  };
}

function proposal(overrides: Partial<FinancialEventProposal> = {}): FinancialEventProposal {
  return {
    id: "bonus",
    kind: "one_off_income_received",
    effectiveAtAgeInMonths: 312,
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 },
    sourceOutcomeId: "accepted_choice",
    evidence: "你已经收到2万元项目奖金。",
    confidence: 0.9,
    ...overrides
  };
}

function validate(proposals: FinancialEventProposal[], narrativeText = "这一年，你已经收到2万元项目奖金。") {
  return validateFinancialProposals({
    ...setup(),
    proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "proposal_validation",
    liquidityPolicy: "require_explicit"
  });
}

test("accepts valid proposals independently when an unrelated proposal is blocking", () => {
  const result = validate([
    proposal(),
    proposal({ id: "wrong_outcome", sourceOutcomeId: "other_choice" })
  ]);
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["bonus"]);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.issues[0].relatedProposalIds, ["wrong_outcome"]);
});

test("rolls back only the event that fails incremental ledger trial", () => {
  const result = validate([
    proposal(),
    proposal({
      id: "unfunded",
      kind: "one_off_expense_paid",
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 50 },
      evidence: "你已经支付50万元费用。"
    })
  ], "这一年，你已经收到2万元项目奖金。你已经支付50万元费用。");
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["bonus"]);
  assert.equal(result.issues.some((issue) => issue.code === "MISSING_FUNDING_SOURCE" && issue.relatedProposalIds.includes("unfunded")), true);
});

test("uses normalized and amount-anchored evidence without accepting another subject", () => {
  const normalized = validate([
    proposal({ evidence: "你 已经 收到 2 万元项目奖金" })
  ]);
  assert.equal(normalized.acceptedEvents.length, 1);
  assert.equal(normalized.acceptedEvents[0].acceptedByReasonCodes.includes("EVIDENCE_NORMALIZED_MATCHED"), true);

  const fuzzy = validate([
    proposal({ evidence: "你获得了2万元奖金" })
  ], "项目结算后，你的账户实际收到2万元项目奖金。公司另获得200万元融资。");
  assert.equal(fuzzy.acceptedEvents.length, 1);
  assert.equal(fuzzy.acceptedEvents[0].acceptedByReasonCodes.includes("EVIDENCE_FUZZY_MATCHED"), true);

  const wrongSubject = validate([
    proposal({ evidence: "公司获得了2万元奖金" })
  ], "公司获得了2万元奖金，你继续正常工作。");
  assert.equal(wrongSubject.acceptedEvents.length, 0);
});

test("low-confidence but otherwise determinate facts are accepted as estimated", () => {
  const result = validate([proposal({
    id: "estimated_income",
    kind: "income_source_started",
    confidence: 0.7,
    evidence: "你开始每月获得1万元顾问收入。",
    payload: {
      id: "consulting",
      type: "contract",
      displayName: "顾问收入",
      monthlyNetAmountWan: 1,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence
    }
  })], "你开始每月获得1万元顾问收入。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal((result.acceptedEvents[0].payload as { factStatus: string }).factStatus, "estimated");
});

test("PB-ASSET-01 rejects an unsupported model asset type", () => {
  const result = validate([proposal({
    id: "bad_property",
    kind: "asset_purchased",
    evidence: "你已经支付8万元买下一套公寓。",
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      cashPaidWan: 8,
      transactionFeeWan: 0,
      assetAccount: {
        id: "bad_home", type: "real_estate", displayName: "公寓", marketValueWan: 8,
        liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 312, evidence: []
      }
    } as never
  })], "你已经支付8万元买下一套公寓。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "INVALID_ASSET_TYPE");
});

test("PB-ASSET-02 rejects sale of an asset absent from the ledger", () => {
  const result = validate([proposal({
    id: "missing_sale",
    kind: "asset_sold",
    evidence: "你已经卖掉城市公寓，收到20万元。",
    payload: {
      assetAccountId: "missing_city_apartment", destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      assetValueRemovedWan: 20, cashReceivedWan: 20, transactionFeeWan: 0
    }
  })], "你已经卖掉城市公寓，收到20万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "UNBALANCED_TRANSACTION"), true);
});

test("asset purchase receives accepted-event evidence before entering the ledger", () => {
  const result = validate([proposal({
    id: "valid_asset",
    kind: "asset_purchased",
    evidence: "你已经支付8万元买入基金。",
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, cashPaidWan: 8, transactionFeeWan: 0,
      assetAccount: { id: "fund", type: "investment", displayName: "基金", marketValueWan: 8, liquidity: "liquid", status: "active", factStatus: "known", openedAtAgeInMonths: 312, evidence: [] }
    }
  })], "你已经支付8万元买入基金。");
  assert.equal(result.acceptedEvents.length, 1);
  const event = result.acceptedEvents[0];
  assert.equal(event.kind, "asset_purchased");
  if (event.kind === "asset_purchased") assert.equal(event.payload.assetAccount.evidence.length, 1);
});

test("new debt receives accepted-event evidence before debt-health eligibility", () => {
  const result = validate([proposal({
    id: "new_loan",
    kind: "debt_drawn",
    evidence: "你已经收到10万元个人借款。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 10,
      debtAccount: {
        id: "new_loan_account", type: "family_or_personal_loan", displayName: "个人借款",
        principalWan: 10, openedAtAgeInMonths: 312, status: "active",
        repaymentPolicy: { mode: "event_driven" }, factStatus: "known", origin: "explicit", evidence: []
      }
    }
  })], "你已经收到10万元个人借款。");
  assert.equal(result.acceptedEvents.length, 1);
  const event = result.acceptedEvents[0];
  assert.equal(event.kind, "debt_drawn");
  if (event.kind === "debt_drawn") assert.equal(event.payload.debtAccount.evidence[0]?.source, "accepted_simulation_outcome");
});

test("an explicit family loan with no schedule normalizes to event-driven servicing", () => {
  const raw = proposal({
    id: "family_loan",
    kind: "debt_drawn",
    evidence: "你已经收到10万元父母借款。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 10,
      debtAccount: {
        id: "family_loan_account", type: "family_or_personal_loan", displayName: "父母借款",
        principalWan: 10, openedAtAgeInMonths: 312, status: "active",
        repaymentPolicy: { mode: "no_schedule", annualInterestRate: 0, monthlyPaymentWan: 0, remainingTermMonths: null },
        factStatus: "known", origin: "explicit", evidence: []
      }
    }
  });
  const normalized = normalizeFinancialProposals({
    proposals: [raw], acceptedOutcomeIds: ["accepted_choice"], currentLedger: setup().currentLedger, currentCareerStateId: "career_current"
  });
  const result = validate(normalized.proposals, "你已经收到10万元父母借款。");
  assert.equal(result.acceptedEvents.length, 1);
  if (result.acceptedEvents[0].kind !== "debt_drawn") throw new Error("expected debt draw");
  assert.equal(result.acceptedEvents[0].payload.debtAccount.repaymentPolicy.mode, "event_driven");
});

test("PB-BIZ-01 company operating revenue cannot be recorded as personal recurring income", () => {
  const companyRevenue = proposal({
    id: "company_revenue",
    kind: "income_source_started",
    evidence: "你经营的公司每月收到46万元营业收入。",
    payload: {
      id: "company_mrr",
      type: "salary",
      displayName: "公司营业收入",
      monthlyNetAmountWan: 46,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence: []
    }
  });
  Object.assign(companyRevenue, { financialScope: "business_operating" });
  const result = validate([companyRevenue], "你经营的公司每月收到46万元营业收入。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-02 company payroll and operating costs cannot be recorded as personal expenses", () => {
  const companyPayroll = proposal({
    id: "company_payroll",
    kind: "expense_commitment_started",
    evidence: "你每月支付29万元团队工资和销售提成。",
    payload: {
      id: "company_payroll_expense",
      type: "other",
      displayName: "团队工资与销售提成",
      monthlyAmountWan: 29,
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence: []
    }
  });
  Object.assign(companyPayroll, { financialScope: "business_operating" });
  const result = validate([companyPayroll], "你每月支付29万元团队工资和销售提成。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-03 personal salary, owner draw, and received dividend remain valid personal cash events", () => {
  const salary = proposal({
    id: "personal_salary",
    kind: "income_source_started",
    evidence: "你开始领取每月4万元税后工资。",
    payload: {
      id: "salary_income", type: "salary", displayName: "个人工资", monthlyNetAmountWan: 4,
      accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active",
      linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  Object.assign(salary, { financialScope: "personal" });
  assert.equal(validate([salary], "你开始领取每月4万元税后工资。").acceptedEvents.length, 1);

  const ownerDraw = proposal({
    id: "owner_draw",
    kind: "income_source_started",
    evidence: "你开始每月提取3万元作为个人可支配收入。",
    payload: {
      id: "owner_draw_income", type: "self_employment_draw", displayName: "业主提款", monthlyNetAmountWan: 3,
      accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active",
      linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  Object.assign(ownerDraw, { financialScope: "personal" });
  assert.equal(validate([ownerDraw], "你开始每月提取3万元作为个人可支配收入。").acceptedEvents.length, 1);

  const input = setup();
  input.currentLedger.businessHoldings.push({
    id: "holding_1",
    business: { id: "business_1", displayName: "个人工作室", status: "operating", factStatus: "known", evidence },
    ownershipRate: 1,
    personalCarryingValueWan: 0,
    status: "active",
    factStatus: "known",
    evidence
  });
  const dividend = proposal({
    id: "received_dividend",
    kind: "business_distribution_received",
    evidence: "公司已经向你的个人账户支付2万元分红。",
    payload: { businessHoldingId: "holding_1", destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 }
  });
  Object.assign(dividend, { financialScope: "personal" });
  const dividendResult = validateFinancialProposals({
    ...input,
    proposals: [dividend],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "公司已经向你的个人账户支付2万元分红。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "proposal_validation_dividend",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(dividendResult.acceptedEvents.length, 1);
});

test("PB-BIZ-04 personal founder contribution creates a holding without recording company operations", () => {
  const startBusiness = proposal({
    id: "start_business",
    kind: "business_holding_started",
    evidence: "你用10万元个人现金创办了供应链软件公司。",
    financialScope: "personal",
    payload: {
      sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      personalCashInvestedWan: 10,
      businessHolding: {
        id: "holding_supply_chain",
        business: {
          id: "business_supply_chain",
          displayName: "供应链软件公司",
          status: "operating",
          factStatus: "known",
          evidence: []
        },
        ownershipRate: 1,
        attributableValueWan: 10,
        liquidityDiscountRate: 0,
        personalCarryingValueWan: 10,
        status: "active",
        factStatus: "known",
        evidence: []
      }
    }
  });
  const result = validate([startBusiness], "你用10万元个人现金创办了供应链软件公司。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents[0].kind, "business_holding_started");
});

test("PB-BIZ-05 a misclassified company operating expense is normalized when prose proves a personal founder contribution", () => {
  const misclassified = proposal({
    id: "startup_funds",
    kind: "expense_commitment_started",
    evidence: "你从35万备用金中取出5万元作为公司初期运营资金。",
    financialScope: "business_operating",
    payload: {
      id: "company_ops",
      type: "business_operating",
      displayName: "公司运营开支",
      monthlyAmountWan: 0.8,
      activeFromAgeInMonths: 301,
      status: "active",
      factStatus: "known",
      evidence: []
    }
  });
  const normalized = normalizeFinancialProposals({
    proposals: [misclassified],
    acceptedOutcomeIds: ["accepted_choice"],
    currentLedger: setup().currentLedger,
    currentCareerStateId: "career_current"
  });
  const result = validate(normalized.proposals, "你从35万备用金中取出5万元作为公司初期运营资金。");
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0].kind, "business_holding_started");
  if (result.acceptedEvents[0].kind !== "business_holding_started") throw new Error("expected founder contribution");
  assert.equal(result.acceptedEvents[0].payload.personalCashInvestedWan, 5);
});

test("PB-BIZ-06 a company customer contract cannot prove a personal owner draw", () => {
  const fakeDraw = proposal({
    id: "fake_owner_draw",
    kind: "income_source_started",
    evidence: "你签下了一家电子厂的试用合同，年费5万元。",
    financialScope: "personal",
    payload: {
      id: "owner_draw",
      type: "self_employment_draw",
      displayName: "创业期间个人提取",
      monthlyNetAmountWan: 0.3,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "estimated",
      evidence: []
    }
  });
  const result = validate([fakeDraw], "你签下了一家电子厂的试用合同，年费5万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-25 business operating income type cannot enter the personal ledger even when scope is mislabeled", () => {
  const companyRevenue = proposal({
    id: "company_revenue_mislabeled_personal",
    kind: "income_source_started",
    payload: {
      id: "business_income_company", type: "business_operating", displayName: "创业公司合同收入",
      monthlyNetAmountWan: 1.67, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
      status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
    },
    evidence: "三家客户年费18万元，实际到账10万元。"
  });
  Object.assign(companyRevenue, { financialScope: "personal" });
  const result = validate([companyRevenue], companyRevenue.evidence);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("PB-BIZ-09 explicit personal consulting earnings can prove a self-employment draw", () => {
  const consulting = proposal({
    id: "consulting_income",
    kind: "income_source_started",
    evidence: "你开始接供应链咨询零活，每月能多挣5000元左右。",
    financialScope: "personal",
    payload: {
      id: "consulting_draw", type: "self_employment_draw", displayName: "个人咨询收入",
      monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  const result = validate([consulting], "你开始接供应链咨询零活，每月能多挣5000元左右。");
  assert.equal(result.acceptedEvents.length, 1);
});

test("PB-BIZ-11 long-form personal consulting salary and owner draw evidence remain valid", () => {
  const consultantSalary = proposal({
    id: "long_consulting_salary",
    kind: "income_source_started",
    evidence: "你以每周10-15小时的节奏接下一家中小型制造企业的供应链优化顾问合同，税后月薪1.5万。",
    financialScope: "personal",
    payload: {
      id: "long_consulting_income", type: "salary", displayName: "兼职供应链顾问税后工资",
      monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  assert.equal(validate([consultantSalary], consultantSalary.evidence).acceptedEvents.length, 1);

  const ownerDraw = proposal({
    id: "explicit_owner_draw",
    kind: "income_source_started",
    evidence: "你给自己发了1万元作为个人提款。",
    financialScope: "personal",
    payload: {
      id: "explicit_owner_draw_income", type: "self_employment_draw", displayName: "创业项目个人提款",
      monthlyNetAmountWan: 0.4167, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  assert.equal(validate([ownerDraw], ownerDraw.evidence).acceptedEvents.length, 1);

  const companyPaidSalary = proposal({
    id: "company_paid_personal_salary",
    kind: "income_source_started",
    evidence: "公司从本月起每月向你个人账户支付4万元税后工资。",
    financialScope: "personal",
    payload: {
      id: "company_salary_income", type: "self_employment_draw", displayName: "创业公司个人税后工资",
      monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
    }
  });
  assert.equal(validate([companyPaidSalary], companyPaidSalary.evidence).acceptedEvents.length, 1);

  const lowerOwnerSalary = proposal({
    id: "lower_owner_salary",
    kind: "income_source_adjusted",
    evidence: "你给自己降薪到每月2.5万元。",
    financialScope: "personal",
    payload: {
      incomeSourceId: "owner_draw_income",
      nextSource: {
        id: "owner_draw_income", type: "self_employment_draw", displayName: "业主工资",
        monthlyNetAmountWan: 2.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
      }
    }
  });
  const salaryInput = setup();
  salaryInput.currentLedger.incomeSources.push({
    id: "owner_draw_income", type: "self_employment_draw", displayName: "业主工资",
    monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
    status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  assert.equal(validateFinancialProposals({
    ...salaryInput,
    proposals: [lowerOwnerSalary],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: lowerOwnerSalary.evidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "lower_owner_salary",
    liquidityPolicy: "require_explicit"
  }).acceptedEvents.length, 1);
});

test("PB-BIZ-10 own reserve used as startup capital cannot become a debt draw", () => {
  const fakeDebt = proposal({
    id: "startup_from_reserve",
    kind: "debt_drawn",
    evidence: "你们把备用金中的15万元作为启动资金。",
    payload: {
      debtAccount: { id: "fake_startup_debt", type: "family_or_personal_loan", principalWan: 15 },
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      principalDrawnWan: 15
    }
  });
  const normalized = normalizeFinancialProposals({
    proposals: [fakeDebt], acceptedOutcomeIds: ["accepted_choice"], currentLedger: setup().currentLedger, currentCareerStateId: "career_current"
  });
  assert.equal(normalized.proposals[0].kind, "business_holding_started");
  assert.equal((normalized.proposals[0].payload as any).personalCashInvestedWan, 15);
});

test("PB-CAREER-07 a paraphrased resignation sentence can close the old salary", () => {
  const input = setup();
  input.currentLedger.incomeSources.push({
    id: "legacy_salary", type: "salary", displayName: "旧工作工资", monthlyNetAmountWan: 3,
    accrualPolicy: "monthly", activeFromAgeInMonths: 240, status: "active",
    linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  const closeSalary = proposal({
    id: "close_old_salary",
    kind: "income_source_ended",
    evidence: "你提交辞职信，拿到最后工资后正式离职。",
    financialScope: "personal",
    payload: { incomeSourceId: "legacy_salary" }
  });
  const result = validateFinancialProposals({
    ...input,
    proposals: [closeSalary],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你向公司提交辞职信时，主管有些意外。拿到最后一个月工资后，你正式开始了创业。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "career_close_paraphrase",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
});
