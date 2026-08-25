import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { normalizeFinancialProposals } from "./normalizeFinancialProposals";
import { reconcileExpenseCommitments } from "./reconcileExpenseCommitments";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import { isUnacceptedIncomeOpportunityEvidence, validateFinancialProposals } from "./validateFinancialProposals";
import type { ExpenseCommitmentV4, ExpenseResponsibilityCandidate, FinancialEventProposal, FinancialEvidence, FinancialLedgerV3 } from "./types";
import type { FinancialEventKind } from "./types";
import { validateFinancialPayloadSchema } from "./financialProposalSchema";

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

function v4LedgerWithHousing() {
  const context = setup();
  const ledger = migrateFinancialLedgerV3ToV4(context.currentLedger as FinancialLedgerV3);
  ledger.expenseCommitments.push({
    id: "home_main",
    type: "housing",
    displayName: "主角租住房屋",
    monthlyAmountWan: 0.5,
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    evidence,
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    amountBasis: "explicit_known",
    amountSourceIds: ["rent:main"],
    financialScope: "personal",
    accrualReviewStatus: "normal",
    nextReviewAtAgeInMonths: 312,
    confirmedMonthlyAmountWan: 0.5,
    lastConfirmedAtAgeInMonths: 300
  });
  return { ...context, currentLedger: ledger };
}

function v4Context() {
  const context = setup();
  return {
    ...context,
    currentLedger: migrateFinancialLedgerV3ToV4(context.currentLedger as FinancialLedgerV3)
  };
}

function v4Expense(overrides: Partial<ExpenseCommitmentV4> = {}): ExpenseCommitmentV4 {
  const base: ExpenseCommitmentV4 = {
    id: "expense_test",
    type: "housing",
    displayName: "测试持续支出",
    monthlyAmountWan: 0.2,
    activeFromAgeInMonths: 312,
    status: "active",
    factStatus: "known",
    evidence,
    responsibilityKey: "primary_residence:test",
    responsibilityKind: "primary_residence",
    amountBasis: "explicit_known",
    amountSourceIds: ["test:expense"],
    financialScope: "personal",
    accrualReviewStatus: "normal",
    nextReviewAtAgeInMonths: 324,
    confirmedMonthlyAmountWan: 0.2,
    lastConfirmedAtAgeInMonths: 312
  };
  return { ...base, ...overrides };
}

function v4ElderCareExpense(input: {
  id: string;
  responsibilityKey: string;
  monthlyAmountWan: number;
  status?: "active" | "paused";
}) {
  return v4Expense({
    id: input.id,
    type: "dependent_support",
    displayName: "父母照护持续支出",
    monthlyAmountWan: input.monthlyAmountWan,
    status: input.status || "active",
    responsibilityKey: input.responsibilityKey,
    responsibilityKind: "elder_care",
    amountSourceIds: [`test:${input.responsibilityKey}`],
    confirmedMonthlyAmountWan: input.monthlyAmountWan
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
  assert.equal(result.issues.some((issue) => issue.code === "UNRESOLVED_FUNDING_GAP" && issue.relatedProposalIds.includes("unfunded")), true);
});

test("rejects a period-end one-off that tries to book an explicitly pre-period medical outlay", () => {
  const historicalOutlay = proposal({
    id: "historical_medical_outlay",
    kind: "one_off_expense_paid",
    payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1.2 },
    evidence: "你父亲上个月因腰椎问题住院，你垫付了1.2万元住院押金。"
  });
  const result = validate(
    [historicalOutlay],
    "25岁0个月，你开始整理共同账户。你父亲上个月因腰椎问题住院，你垫付了1.2万元住院押金。到26岁0个月，你们重新安排了照护预算。"
  );
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]?.code, "PENDING_FACT");
  assert.deepEqual(result.issues[0]?.relatedProposalIds, ["historical_medical_outlay"]);
  assert.match(result.issues[0]?.summary || "", /本阶段开始前/);

  const currentPeriod = validate([
    proposal({
      id: "current_medical_outlay",
      kind: "one_off_expense_paid",
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 1.2 },
      evidence: "25岁0个月，你本月垫付了1.2万元父亲住院费用。"
    })
  ], "25岁0个月，你本月垫付了1.2万元父亲住院费用。");
  assert.deepEqual(currentPeriod.acceptedEvents.map((event) => event.proposalId), ["current_medical_outlay"]);
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

test("does not turn a single personal grant receipt into a permanent recurring other-income source", () => {
  const result = validate([proposal({
    id: "foundation_grant_recurring",
    kind: "income_source_started",
    evidence: "你收到第一笔资助款3000元。",
    payload: {
      id: "income_foundation_grant",
      type: "other",
      displayName: "基金会资助项目收入",
      monthlyNetAmountWan: 0.3,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence
    }
  })], "你收到第一笔资助款3000元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "UNBALANCED_TRANSACTION");
  assert.match(result.issues[0]?.summary || "", /不能推导为长期/);
});

test("accepts recurring other income only when the narrative states its cadence", () => {
  const result = validate([proposal({
    id: "recurring_other_income",
    kind: "income_source_started",
    evidence: "你每月稳定收到3000元个人创作资助。",
    payload: {
      id: "income_recurring_grant",
      type: "other",
      displayName: "个人创作资助",
      monthlyNetAmountWan: 0.3,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      factStatus: "known",
      evidence
    }
  })], "你每月稳定收到3000元个人创作资助。");
  assert.equal(result.acceptedEvents.length, 1);
});

test("accepts an exact protagonist side-income contract alongside a primary salary", () => {
  const current = setup();
  current.currentLedger.incomeSources.push({
    id: "primary_salary",
    type: "salary",
    displayName: "主业工资",
    monthlyNetAmountWan: 2,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 280,
    status: "active",
    linkedCareerStateId: "career_current",
    factStatus: "known",
    evidence
  });
  const result = validateFinancialProposals({
    ...current,
    proposals: [proposal({
      id: "personal_side_income",
      kind: "income_source_started",
      evidence: "你的线上课程加上一对一咨询，副业月收入稳定在6000元左右。",
      payload: {
        id: "personal_side_income_career_current",
        type: "contract",
        displayName: "正文确认的个人副业收入",
        monthlyNetAmountWan: 0.6,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 300,
        status: "active",
        linkedCareerStateId: "career_current",
        factStatus: "known",
        evidence
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你的线上课程加上一对一咨询，副业月收入稳定在6000元左右。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "side_income_validation",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
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

test("rejects a repeated discovery of the sole opening mortgage with the same balance", () => {
  const state = setup();
  state.currentLedger.debtAccounts.push({
    id: "opening_mortgage",
    type: "mortgage",
    displayName: "开局住房按揭",
    principalWan: 210,
    openedAtAgeInMonths: 288,
    status: "active",
    repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.875, remainingTermMonths: 240 },
    factStatus: "known",
    evidence,
    origin: "explicit"
  });
  const result = validateFinancialProposals({
    ...state,
    proposals: [proposal({
      id: "repeated_opening_mortgage",
      kind: "debt_balance_discovered",
      evidence: "你仍背着210万元房贷余额。",
      payload: {
        debtAccount: {
          id: "model_generated_mortgage",
          type: "mortgage",
          displayName: "住房贷款",
          principalWan: 210,
          openedAtAgeInMonths: 288,
          status: "active",
          repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.875, remainingTermMonths: 240 },
          factStatus: "known",
          evidence: [],
          origin: "explicit"
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你仍背着210万元房贷余额。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "repeated_opening_mortgage",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0]?.summary ?? "", /已存在且余额一致/);
});

test("rejects a discovered mortgage principal inferred only from monthly payment", () => {
  const state = setup();
  const result = validateFinancialProposals({
    ...state,
    proposals: [proposal({
      id: "invented_mortgage_balance",
      kind: "debt_balance_discovered",
      evidence: "你算了一笔账，每月房贷月供1.2万，加上生活开销，还能存下一些钱。",
      payload: {
        debtAccount: {
          id: "mortgage_primary",
          type: "mortgage",
          displayName: "待确认房贷",
          principalWan: 150,
          openedAtAgeInMonths: 312,
          status: "active",
          repaymentPolicy: { mode: "estimated_amortizing", monthlyPaymentWan: 1.2, remainingTermMonths: 240 },
          factStatus: "estimated",
          evidence: [],
          origin: "explicit"
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你算了一笔账，每月房贷月供1.2万，加上生活开销，还能存下一些钱。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "invented_mortgage_balance",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0]?.summary ?? "", /不能从月供、期限或利率反推本金/);
});

test("accepts a discovered debt balance when the evidence states the exact principal", () => {
  const state = setup();
  const result = validateFinancialProposals({
    ...state,
    proposals: [proposal({
      id: "explicit_mortgage_balance",
      kind: "debt_balance_discovered",
      evidence: "你核对账单后确认，当前房贷余额150万元。",
      payload: {
        debtAccount: {
          id: "mortgage_primary",
          type: "mortgage",
          displayName: "住房房贷",
          principalWan: 150,
          openedAtAgeInMonths: 312,
          status: "active",
          repaymentPolicy: { mode: "estimated_amortizing", remainingTermMonths: 240 },
          factStatus: "known",
          evidence: [],
          origin: "explicit"
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你核对账单后确认，当前房贷余额150万元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "explicit_mortgage_balance",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0]?.kind, "debt_balance_discovered");
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

test("PB-BIZ-37 a profit-sharing discussion cannot create or adjust personal draw or dividend income", () => {
  const narrative = "公司注册后签下正式客户，客户年费4.8万元已经回款。老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。";
  const inventedDraw = proposal({
    id: "talked_about_dividend_as_draw",
    kind: "income_source_started",
    evidence: "老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。",
    financialScope: "personal",
    payload: {
      id: "talked_about_dividend_draw", type: "self_employment_draw", displayName: "创业个人提款",
      monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
    }
  });
  const inventedDividend = proposal({
    id: "talked_about_dividend_as_income",
    kind: "income_source_started",
    evidence: "老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。",
    financialScope: "personal",
    payload: {
      id: "talked_about_dividend_income", type: "business_dividend", displayName: "公司分红",
      annualNetAmountWan: 8, accrualPolicy: "annual", activeFromAgeInMonths: 312,
      status: "active", factStatus: "estimated", evidence: []
    }
  });
  const result = validate([inventedDraw, inventedDividend], narrative);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 2);

  const context = setup();
  context.currentLedger.incomeSources.push({
    id: "existing_owner_draw", type: "self_employment_draw", displayName: "既有业主提款",
    monthlyNetAmountWan: 1, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
    status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  const adjustment = proposal({
    id: "talked_about_dividend_adjustment",
    kind: "income_source_adjusted",
    evidence: "老周提醒你该谈分红了，你又一次以‘等拿到第二个客户再说’搪塞过去。",
    financialScope: "personal",
    payload: {
      incomeSourceId: "existing_owner_draw",
      nextSource: { ...context.currentLedger.incomeSources[0], monthlyNetAmountWan: 1.5 }
    }
  });
  const adjusted = validateFinancialProposals({
    ...context,
    proposals: [adjustment],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "talked_about_dividend_adjustment",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(adjusted.acceptedEvents.length, 0);
  assert.equal(adjusted.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("PB-BIZ-38 exact personal receipt text cannot authorize a mismatched recurring draw or dividend amount", () => {
  const mismatchedDraw = proposal({
    id: "mismatched_draw_amount",
    kind: "income_source_started",
    evidence: "公司从本月起每月向你的个人账户支付1.2万元税后工资。",
    financialScope: "personal",
    payload: {
      id: "mismatched_draw_income", type: "self_employment_draw", displayName: "创业公司个人工资",
      monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
    }
  });
  const mismatchedDividend = proposal({
    id: "mismatched_dividend_amount",
    kind: "income_source_started",
    evidence: "公司从本年度起已向你的个人账户支付年度分红6万元。",
    financialScope: "personal",
    payload: {
      id: "mismatched_dividend_income", type: "business_dividend", displayName: "年度个人分红",
      annualNetAmountWan: 8, accrualPolicy: "annual", activeFromAgeInMonths: 312,
      status: "active", factStatus: "estimated", evidence: []
    }
  });
  const result = validate([mismatchedDraw, mismatchedDividend], `${mismatchedDraw.evidence}${mismatchedDividend.evidence}`);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 2);
});

test("PB-BIZ-39 a planned founder payment cannot start or adjust personal income", () => {
  const plannedEvidence = "公司计划从下月起每月向你个人账户支付4万元税后工资。";
  const plannedStart = proposal({
    id: "planned_owner_draw", kind: "income_source_started", evidence: plannedEvidence, financialScope: "personal",
    payload: {
      id: "planned_owner_draw_income", type: "self_employment_draw", displayName: "计划中的业主提款",
      monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
    }
  });
  const startResult = validate([plannedStart], plannedEvidence);
  assert.equal(startResult.acceptedEvents.length, 0);
  assert.equal(startResult.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");

  const context = setup();
  context.currentLedger.incomeSources.push({
    id: "existing_owner_draw", type: "self_employment_draw", displayName: "既有业主提款",
    monthlyNetAmountWan: 3, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
    status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  const plannedAdjustment = proposal({
    id: "planned_owner_draw_adjustment", kind: "income_source_adjusted", evidence: plannedEvidence, financialScope: "personal",
    payload: {
      incomeSourceId: "existing_owner_draw",
      nextSource: { ...context.currentLedger.incomeSources.at(-1)!, monthlyNetAmountWan: 4 }
    }
  });
  const adjustmentResult = validateFinancialProposals({
    ...context, proposals: [plannedAdjustment], acceptedOutcomeId: "accepted_choice", narrativeText: plannedEvidence,
    periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "planned_owner_draw_adjustment",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(adjustmentResult.acceptedEvents.length, 0);
  assert.equal(adjustmentResult.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("PB-BIZ-30 rejects restricted project funding from personal cash even when the protagonist receives it", () => {
  const restrictedGrant = proposal({
    id: "restricted_village_school_funding",
    kind: "one_off_income_received",
    financialScope: "personal",
    evidence: "你申请到一笔10万元的项目基金，款项已到账，用于为5所村小提供硬件和教师津贴。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 10,
      displayName: "乡村教育项目基金"
    }
  });
  const result = validate([restrictedGrant], restrictedGrant.evidence);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
  assert.match(result.issues[0].summary, /专款用途/);
});

test("PB-BIZ-31 keeps an explicitly personal freely disposable creative project award in personal cash", () => {
  const personalAward = proposal({
    id: "personal_creative_project_award",
    kind: "one_off_income_received",
    financialScope: "personal",
    evidence: "你获得个人公益创作基金10万元作为个人可自由支配的创作奖金；你决定用其中一部分为村小提供硬件。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 10,
      displayName: "个人公益创作基金"
    }
  });
  const result = validate([personalAward], personalAward.evidence);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0, JSON.stringify(result.issues));
  assert.equal(result.acceptedEvents.length, 1);
});

test("PB-BIZ-32 rejects restricted project funding when the grant label is carried by payload", () => {
  const restrictedGrant = proposal({
    id: "payload_labeled_restricted_grant",
    kind: "one_off_income_received",
    financialScope: "personal",
    evidence: "你收到10万元，专用于为村小采购硬件。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 10,
      displayName: "乡村教育公益项目资助"
    }
  });
  const result = validate([restrictedGrant], restrictedGrant.evidence);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("PB-BIZ-33 rejects the full audited vocabulary of earmarked project funding from personal cash", () => {
  const restrictedFunding = [
    ["乡村教育基金", "你申请到乡村教育基金10万元，款项到账后专门用于为村小采购硬件。"],
    ["教育资助", "你收到一笔教育资助10万元，定向用于学校课程培训。"],
    ["专项基金", "你暂时保管10万元专项基金，专款用于教师培训。"],
    ["项目款", "你收到10万元公益项目款，仅限用于项目执行。"],
    ["教育赞助", "你收到10万元教育赞助，用于学校教学设备。"]
  ] as const;

  for (const [label, evidence] of restrictedFunding) {
    const candidate = proposal({
      id: `restricted_${label}`,
      kind: "one_off_income_received",
      financialScope: "personal",
      evidence,
      payload: {
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        amountWan: 10,
        displayName: label
      }
    });
    const result = validate([candidate], evidence);
    assert.equal(result.acceptedEvents.length, 0, label);
    assert.equal(result.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT", `${label}: ${JSON.stringify(result.issues)}`);
    assert.match(result.issues[0]?.summary || "", /专款用途/, label);
  }
});

test("PB-BIZ-34 keeps an explicitly personal freely disposable award out of the restricted-funding classifier", () => {
  const personalAward = proposal({
    id: "personal_disposable_education_award",
    kind: "one_off_income_received",
    financialScope: "personal",
    evidence: "你获得一笔个人公益教育资助10万元，作为个人自由支配奖金，奖金无指定用途；你决定用其中一部分为村小提供硬件。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 10,
      displayName: "个人公益教育资助奖金"
    }
  });
  const result = validate([personalAward], personalAward.evidence);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0, JSON.stringify(result.issues));
  assert.equal(result.acceptedEvents.length, 1);
});

test("PB-BIZ-35 keeps a personal commercial project payment outside the public-funding boundary", () => {
  const personalProjectPayment = proposal({
    id: "personal_consulting_project_payment",
    kind: "one_off_income_received",
    financialScope: "personal",
    evidence: "你收到10万元个人咨询项目款，作为本次软件开发服务的个人报酬，专门用于后续项目执行。",
    payload: {
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 10,
      displayName: "个人咨询项目报酬"
    }
  });
  const result = validate([personalProjectPayment], personalProjectPayment.evidence);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0, JSON.stringify(result.issues));
  assert.equal(result.acceptedEvents.length, 1);
});

test("PB-BIZ-36 rejects a restricted public project fund disguised as a personal business distribution", () => {
  const input = setup();
  input.currentLedger.businessHoldings.push({
    id: "holding_school_project",
    business: {
      id: "school_project_entity",
      displayName: "乡村教育公益项目",
      status: "operating",
      factStatus: "known",
      evidence
    },
    ownershipRate: 1,
    personalCarryingValueWan: 0,
    status: "active",
    factStatus: "known",
    evidence
  });
  const restrictedDistribution = proposal({
    id: "restricted_project_distribution",
    kind: "business_distribution_received",
    financialScope: "personal",
    evidence: "你收到10万元公益项目款，仅限用于项目执行。",
    payload: {
      businessHoldingId: "holding_school_project",
      destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
      amountWan: 10
    }
  });
  const result = validateFinancialProposals({
    ...input,
    proposals: [restrictedDistribution],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: restrictedDistribution.evidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "restricted_project_distribution",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
  assert.match(result.issues[0]?.summary || "", /专款用途/);
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

test("PB-BIZ-28 withdrawing personal savings for living costs is not recurring owner income", () => {
  const falseDraw = proposal({
    id: "personal_savings_false_draw",
    kind: "income_source_started",
    evidence: "母亲病情稳定，医疗支出维持每月4000元，你每月从积蓄中提取1.5万作为生活费用。",
    financialScope: "personal",
    payload: {
      id: "cofounder_salary", type: "self_employment_draw", displayName: "创业公司联合创始人薪资",
      monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 539,
      status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
    }
  });
  const result = validate([falseDraw], falseDraw.evidence);
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("a consulting fee paid by a named company remains personal compensation", () => {
  const consulting = proposal({
    id: "medical_ai_consulting",
    kind: "income_source_started",
    evidence: "你接受AI医疗创业公司的顾问工作，顾问收入每月1万元，直接支付到你的个人账户。",
    financialScope: "personal",
    payload: {
      id: "consultant_income_ai_tool_630",
      type: "contract",
      displayName: "AI医疗创业公司顾问费",
      monthlyNetAmountWan: 1,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence: []
    }
  });
  const result = validate([consulting], consulting.evidence);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), false);
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
    evidence: "你从本月起每月给自己发1万元作为个人提款。",
    financialScope: "personal",
    payload: {
      id: "explicit_owner_draw_income", type: "self_employment_draw", displayName: "创业项目个人提款",
      monthlyNetAmountWan: 1, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
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

function relativeSalaryTransitionContext() {
  const context = setup();
  context.currentLedger.incomeSources.push({
    id: "legacy_salary", type: "salary", displayName: "旧工作税后工资", monthlyNetAmountWan: 2.5,
    accrualPolicy: "monthly", activeFromAgeInMonths: 240, status: "active",
    linkedCareerStateId: "career_current", factStatus: "known", evidence: []
  });
  return context;
}

function relativeSalaryStart(monthlyNetAmountWan: number, evidenceText: string, type = "salary") {
  return proposal({
    id: "start_relative_salary",
    kind: "income_source_started",
    evidence: evidenceText,
    confidence: 0.95,
    financialScope: "personal",
    payload: {
      id: "new_relative_salary", type, displayName: "AI 创业公司个人工资",
      monthlyNetAmountWan, accrualPolicy: "monthly", activeFromAgeInMonths: 312,
      status: "active", linkedCareerStateId: "career_next", factStatus: "known", evidence: []
    }
  });
}

test("PB-CAREER-08 accepts an exact completed salary fraction of the one authoritative prior wage as estimated", () => {
  const context = relativeSalaryTransitionContext();
  const closeEvidence = "你正式辞去大公司的产品经理职位，加入了前同事的AI创业公司担任产品负责人。";
  const salaryEvidence = "你主动提出在最初几个月只领取相当于原来六成的薪水。";
  const result = validateFinancialProposals({
    ...context,
    proposals: [
      proposal({ id: "end_legacy_salary", kind: "income_source_ended", evidence: closeEvidence, payload: { incomeSourceId: "legacy_salary" } }),
      relativeSalaryStart(1.5, salaryEvidence)
    ],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: `${closeEvidence}${salaryEvidence}`,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "relative_salary_transition",
    allowedCareerStateIds: ["career_next"],
    liquidityPolicy: "require_explicit"
  });
  assert.deepEqual(result.acceptedEvents.map((event) => event.proposalId), ["end_legacy_salary", "start_relative_salary"]);
  assert.equal((result.acceptedEvents[1].payload as { factStatus: string }).factStatus, "estimated");
});

test("PB-CAREER-08b accepts a completed three-tenths pay cut against one migrated annual wage", () => {
  const context = setup();
  context.currentLedger.incomeSources.push({
    id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合", annualNetAmountWan: 30,
    accrualPolicy: "annual", activeFromAgeInMonths: 300, status: "active",
    linkedCareerStateId: "career_current", factStatus: "estimated", evidence: []
  });
  const closeEvidence = "你正式辞去大公司的产品经理职位，加入了前同事的AI创业公司担任产品负责人。";
  const salaryEvidence = "收入比大厂少了三成，每月房租和给父母转的医疗费依然雷打不动。";
  const result = validateFinancialProposals({
    ...context,
    proposals: [
      proposal({ id: "end_legacy_income", kind: "income_source_ended", evidence: closeEvidence, payload: { incomeSourceId: "legacy_recurring_income" } }),
      relativeSalaryStart(1.75, salaryEvidence)
    ],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: `${closeEvidence}${salaryEvidence}`,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "relative_salary_migrated_annual",
    allowedCareerStateIds: ["career_next"],
    liquidityPolicy: "require_explicit"
  });
  assert.deepEqual(
    result.acceptedEvents.map((event) => event.proposalId),
    ["end_legacy_income", "start_relative_salary"],
    JSON.stringify(result.issues)
  );
  assert.equal((result.acceptedEvents[1].payload as { factStatus: string }).factStatus, "estimated");
});

test("PB-CAREER-09 rejects mismatched, prospective, ambiguous-baseline and non-salary relative income", () => {
  const completed = "你已正式加入AI创业公司，只领取相当于原来六成的薪水。";
  const planned = "你计划加入AI创业公司后只领取原工资的60%。";
  for (const [label, candidate, mutate] of [
    ["mismatched", relativeSalaryStart(1.6, completed), undefined],
    ["prospective", relativeSalaryStart(1.5, planned), undefined],
    ["non_salary", relativeSalaryStart(1.5, completed, "self_employment_draw"), undefined],
    ["ambiguous", relativeSalaryStart(1.5, completed), (context: ReturnType<typeof relativeSalaryTransitionContext>) => {
      context.currentLedger.incomeSources.push({
        ...structuredClone(context.currentLedger.incomeSources.at(-1)!),
        id: "second_active_salary",
        monthlyNetAmountWan: 1
      });
    }]
  ] as const) {
    const context = relativeSalaryTransitionContext();
    mutate?.(context);
    const result = validateFinancialProposals({
      ...context,
      proposals: [candidate],
      acceptedOutcomeId: "accepted_choice",
      narrativeText: candidate.evidence,
      periodStartAgeInMonths: 300,
      periodEndAgeInMonths: 312,
      simulationTransactionId: `relative_salary_${label}`,
      allowedCareerStateIds: ["career_next"],
      liquidityPolicy: "require_explicit"
    });
    assert.equal(result.acceptedEvents.length, 0, label);
    assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true, label);
  }
});

test("rejects malformed kind payload before reducer trial without leaking undefined", () => {
  const result = validate([proposal({ id: "malformed_adjustment", kind: "income_source_adjusted", payload: { incomeSourceId: "salary_main" }, evidence: "你正式涨薪到每月3万元。" })], "你正式涨薪到每月3万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0].summary, /payload\.nextSource/);
  assert.doesNotMatch(result.issues[0].summary, /undefined/i);
});

test("rejects malformed expense commitments before exact-confirmation validation without throwing", () => {
  const malformed = [
    proposal({
      id: "malformed_expense_start",
      kind: "expense_commitment_started",
      payload: undefined as any,
      evidence: "你开始承担一笔每月5000元的住房支出。"
    }),
    proposal({
      id: "malformed_expense_adjustment",
      kind: "expense_commitment_adjusted",
      payload: { expenseCommitmentId: "housing_main" },
      evidence: "你的住房支出调整为每月5000元。"
    })
  ];

  for (const candidate of malformed) {
    const result = validate([candidate], candidate.evidence);
    assert.equal(result.acceptedEvents.length, 0);
    assert.equal(result.issues.length, 1);
    assert.equal(typeof result.issues[0].code, "string");
    assert.doesNotMatch(result.issues[0].summary, /undefined/i);
  }
});

test("reports typed account mismatch with legal income-source candidates", () => {
  const context = setup();
  context.currentLedger.incomeSources.push({ id: "salary_main", type: "salary", displayName: "工资", monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence });
  const nextSource = { ...structuredClone(context.currentLedger.incomeSources[0]), monthlyNetAmountWan: 3 };
  const result = validateFinancialProposals({ ...context, proposals: [proposal({ id: "wrong_typed_id", kind: "income_source_adjusted", payload: { incomeSourceId: PRIMARY_CASH_ACCOUNT_ID, nextSource: { ...nextSource, id: PRIMARY_CASH_ACCOUNT_ID } }, evidence: "你正式涨薪到每月3万元。" })], acceptedOutcomeId: "accepted_choice", narrativeText: "你正式涨薪到每月3万元。", periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "typed_mismatch", liquidityPolicy: "require_explicit" });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0].code, "ACCOUNT_TYPE_MISMATCH");
  assert.match(result.issues[0].summary, /salary_main/);
  assert.doesNotMatch(result.issues[0].summary, /undefined/i);
});

test("rejects company revenue and team payroll at the personal-ledger boundary", () => {
  const result = validate([
    proposal({
      id: "saas_revenue", kind: "income_source_started", evidence: "公司SaaS年费收入达到27万元。",
      payload: { id: "saas_revenue", type: "business_dividend", displayName: "SaaS年费收入", annualNetAmountWan: 27, accrualPolicy: "annual", activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    }),
    proposal({
      id: "team_payroll", kind: "expense_commitment_started", evidence: "公司团队工资和运营成本每月3.8万元。",
      payload: { id: "team_payroll", type: "other", displayName: "团队工资及运营成本", monthlyAmountWan: 3.8, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    })
  ], "公司SaaS年费收入达到27万元。公司团队工资和运营成本每月3.8万元。你没有从公司领取分红。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 2);
});

test("rejects nonprofit monthly donations from a personal career income source", () => {
  const context = setup();
  context.currentLedger.incomeSources.push({
    id: "career_income_current",
    type: "contract",
    displayName: "个人咨询收入",
    monthlyNetAmountWan: 1.8,
    accrualPolicy: "monthly",
    activeFromAgeInMonths: 300,
    status: "active",
    linkedCareerStateId: "career_current",
    factStatus: "known",
    evidence
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "donation_income_adjusted_554",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 312,
      evidence: "机构月捐因协调员定期更新项目反馈，反而增至9500元。",
      payload: {
        incomeSourceId: "career_income_current",
        nextSource: {
          ...context.currentLedger.incomeSources.at(-1),
          id: "career_income_current",
          type: "other",
          displayName: "机构月捐收入",
          monthlyNetAmountWan: 0.95
        }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "咨询业务方面，你月税后收入稳定在1.8万元；机构月捐因协调员定期更新项目反馈，反而增至9500元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "nonprofit_donation_boundary",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true, JSON.stringify(result.issues));
});

test("does not confuse a salary at a SaaS company with company revenue", () => {
  const result = validate([
    proposal({
      id: "saas_salary", kind: "income_source_started", evidence: "你正式入职跨境电商SaaS公司，税后月薪1.5万元。",
      payload: { id: "saas_salary", type: "salary", displayName: "SaaS公司税后工资", monthlyNetAmountWan: 1.5, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence }
    })
  ], "你正式入职跨境电商SaaS公司，税后月薪1.5万元。");
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0);
  assert.equal(result.acceptedEvents.length, 1);
});

test("rejects nonprofit grants, hired staff payroll and warehouse rent from the personal ledger", () => {
  const result = validate([
    proposal({
      id: "nonprofit_grant", kind: "one_off_income_received", evidence: "青禾中心获得国家级公益项目资助，首期款30万元将在签约后到账。",
      payload: { amountWan: 30, destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID }
    }),
    proposal({
      id: "accountant_salary", kind: "expense_commitment_started", evidence: "你招聘一位专职会计，月薪4500元。",
      payload: { id: "expense_accountant_salary", type: "basic_living", displayName: "专职会计月薪", monthlyAmountWan: 0.45, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    }),
    proposal({
      id: "warehouse_rent", kind: "expense_commitment_started", evidence: "中心新增仓库月租800元。",
      payload: { id: "expense_warehouse_rent", type: "basic_living", displayName: "新增仓库月租", monthlyAmountWan: 0.08, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    })
  ], "青禾中心获得国家级公益项目资助，首期款30万元将在签约后到账。你招聘一位专职会计，月薪4500元。中心新增仓库月租800元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 3);
});

test("rejects a spouse salary from the protagonist ledger", () => {
  const result = validate([proposal({
    id: "spouse_salary", kind: "income_source_started", evidence: "小余考了会计证，找到一份出纳工作，月薪4500元。",
    payload: { id: "income_xiaoyu_accountant", type: "salary", displayName: "小余出纳工作", monthlyNetAmountWan: 0.45, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence }
  })], "小余考了会计证，找到一份出纳工作，月薪4500元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
  assert.match(result.issues[0].summary, /其他人物/);
});

test("rejects a parent's business earnings from the protagonist ledger", () => {
  const parentIncome = proposal({
    id: "parent_business_income",
    kind: "income_source_started",
    evidence: "母亲的小作坊每年稳定多赚1.2万元。",
    payload: {
      id: "income_parent_business",
      type: "other",
      displayName: "家庭小作坊收入",
      annualNetAmountWan: 1.2,
      accrualPolicy: "annual",
      activeFromAgeInMonths: 360,
      status: "active",
      factStatus: "known",
      evidence: []
    }
  });
  const result = validate([parentIncome], "母亲的小作坊每年稳定多赚1.2万元。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.ok(result.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"));
});

test("rejects a spouse recurring transfer as protagonist income and requires family support events", () => {
  const result = validate([proposal({
    id: "wife_med_contribution", kind: "income_source_started",
    evidence: "妻子每月从工资里转2000元进你建立的医疗备用金账户。",
    payload: { id: "wife_med_contribution", type: "family_support", displayName: "妻子医疗金转入", monthlyNetAmountWan: 0.2, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence }
  })], "妻子每月从工资里转2000元进你建立的医疗备用金账户。");
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
  assert.match(result.issues[0].summary, /家庭支持事件/);
});

test("accepts only an explicit spouse transfer through family_support_received", () => {
  const accepted = validate([proposal({
    id: "wife_med_transfer", kind: "family_support_received",
    evidence: "妻子从工资里转2000元进你建立的医疗备用金账户。",
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 0.2 }
  })], "妻子从工资里转2000元进你建立的医疗备用金账户。");
  assert.equal(accepted.issues.length, 0, JSON.stringify(accepted.issues));
  assert.equal(accepted.acceptedEvents.length, 1);

  const rejected = validate([proposal({
    id: "wife_salary_as_support", kind: "family_support_received",
    evidence: "妻子目前月薪2万元。",
    payload: { destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 2 }
  })], "妻子目前月薪2万元。");
  assert.equal(rejected.acceptedEvents.length, 0);
  assert.equal(rejected.issues[0].code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("rewrites an accepted asset dependency from proposal id to event id", () => {
  const context = setup();
  context.currentLedger.cashAccounts[0].balanceWan = 54;
  const proposals = [
    proposal({
      id: "mortgage_draw", kind: "debt_drawn", evidence: "你办理126万元组合贷款。",
      payload: {
        debtAccount: { id: "mortgage", type: "mortgage", displayName: "房贷", principalWan: 126, openedAtAgeInMonths: 312, status: "active", repaymentPolicy: { mode: "estimated_amortizing", monthlyPrincipalWan: 0.525, remainingTermMonths: 240 }, factStatus: "known", evidence },
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID, principalDrawnWan: 126
      }
    }),
    proposal({
      id: "home_purchase", kind: "asset_purchased", evidence: "你用54万元首付和126万元组合贷款买下总价180万元的住房。",
      payload: {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        assetAccount: { id: "home", type: "property", displayName: "自住房", marketValueWan: 180, liquidity: "illiquid", status: "active", factStatus: "known", openedAtAgeInMonths: 312, evidence },
        cashPaidWan: 180, transactionFeeWan: 0, linkedDebtDrawEventId: "mortgage_draw"
      }
    })
  ];
  const result = validateFinancialProposals({
    ...context,
    proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你办理126万元组合贷款，用54万元首付买下总价180万元的住房。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "mortgage_purchase",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 2);
  assert.equal((result.acceptedEvents[1].payload as any).linkedDebtDrawEventId, "accepted_mortgage_draw");
});

test("rejects an orphan mortgage and down payment when a completed home purchase has no property event", () => {
  const context = setup();
  context.currentLedger.cashAccounts[0].balanceWan = 20;
  const proposals = [
    proposal({
      id: "orphan_mortgage", kind: "debt_drawn", evidence: "你们付了婚房首付，办理80万元房贷。",
      payload: {
        debtAccount: { id: "orphan_mortgage", type: "mortgage", displayName: "婚房按揭", principalWan: 80, openedAtAgeInMonths: 312, status: "active", repaymentPolicy: { mode: "known_schedule", monthlyPaymentWan: 0.45, remainingTermMonths: 300 }, factStatus: "estimated", evidence },
        destinationCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        principalDrawnWan: 80
      }
    }),
    proposal({
      id: "orphan_down_payment", kind: "one_off_expense_paid", evidence: "你们支付了15万元婚房首付。",
      payload: { sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID, amountWan: 15 }
    })
  ];
  const result = validateFinancialProposals({
    ...context,
    proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你们用20万元存款支付了15万元婚房首付，并办理80万元房贷。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "orphan_home_purchase",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.id)), new Set([
    "proposal_issue_orphan_mortgage_312",
    "proposal_issue_orphan_down_payment_312"
  ]));
  assert.ok(result.issues.every((issue) => issue.code === "UNBALANCED_TRANSACTION"));
});

test("allows compensation explicitly offered to the protagonist by another person", () => {
  const result = validate([proposal({
    id: "consulting_offer", kind: "income_source_started", evidence: "张哥问你要不要以技术顾问身份加入，每周远程工作十小时，月薪8000元；你最终决定接下兼职。",
    payload: { id: "income_consulting", type: "contract", displayName: "技术顾问收入", monthlyNetAmountWan: 0.8, accrualPolicy: "monthly", activeFromAgeInMonths: 312, status: "active", linkedCareerStateId: "career_current", factStatus: "estimated", evidence }
  })], "张哥问你要不要以技术顾问身份加入，每周远程工作十小时，月薪8000元；你最终决定接下兼职。");
  assert.equal(result.issues.filter((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT").length, 0);
  assert.equal(result.acceptedEvents.length, 1);
});

test("accepts an explicit monthly take-home amount as salary but never relaxes draw evidence", () => {
  const completedConsultantEvidence = "老周介绍的那个供应链顾问岗位，你最终接了，按月结算，税后到手约1.2万。";
  assert.equal(isUnacceptedIncomeOpportunityEvidence(completedConsultantEvidence), false);
  const salary = validate([proposal({
    id: "completed_external_consultant_salary",
    kind: "income_source_started",
    evidence: completedConsultantEvidence,
    payload: {
      id: "income_external_consultant_salary",
      type: "salary",
      displayName: "供应链顾问工资",
      monthlyNetAmountWan: 1.2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence
    }
  })], completedConsultantEvidence);
  assert.deepEqual(salary.issues, []);
  assert.equal(salary.acceptedEvents.length, 1);

  const draw = validate([proposal({
    id: "take_home_wording_is_not_owner_draw",
    kind: "income_source_started",
    evidence: completedConsultantEvidence,
    payload: {
      id: "income_owner_draw",
      type: "self_employment_draw",
      displayName: "业主提款",
      monthlyNetAmountWan: 1.2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence
    }
  })], completedConsultantEvidence);
  assert.equal(draw.acceptedEvents.length, 0);
  assert.equal(draw.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  const prospectiveConsultantEvidence = "你计划下月接下老周介绍的供应链顾问岗位，按月结算，税后到手约1.2万。";
  assert.equal(isUnacceptedIncomeOpportunityEvidence(prospectiveConsultantEvidence), true);
  const prospective = validate([proposal({
    id: "prospective_external_consultant_salary",
    kind: "income_source_started",
    evidence: prospectiveConsultantEvidence,
    payload: {
      id: "income_prospective_consultant_salary",
      type: "salary",
      displayName: "待入职顾问工资",
      monthlyNetAmountWan: 1.2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence
    }
  })], prospectiveConsultantEvidence);
  assert.equal(prospective.acceptedEvents.length, 0);
  assert.equal(prospective.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  const independentProjectEvidence = "老周介绍了一个独立供应链咨询项目，你最终接了，税后到手约1.2万，按月结算。";
  const independentProject = validate([proposal({
    id: "independent_project_is_not_salary",
    kind: "income_source_started",
    evidence: independentProjectEvidence,
    payload: {
      id: "income_independent_project_salary",
      type: "salary",
      displayName: "独立项目工资",
      monthlyNetAmountWan: 1.2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 312,
      status: "active",
      linkedCareerStateId: "career_current",
      factStatus: "known",
      evidence
    }
  })], independentProjectEvidence);
  assert.equal(independentProject.acceptedEvents.length, 0);
  assert.equal(independentProject.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("rejects an unaccepted job posting or project invitation as a legacy-income reconfirmation while accepting an exact current salary", () => {
  const context = setup();
  const legacyIncome = {
    id: "legacy_recurring_income", type: "salary" as const, displayName: "旧版持续收入聚合",
    annualNetAmountWan: 18, accrualPolicy: "annual" as const, activeFromAgeInMonths: 300,
    status: "active" as const, linkedCareerStateId: "career_current", factStatus: "estimated" as const, evidence
  };
  context.currentLedger.incomeSources.push(legacyIncome);
  const currentSalary = (annualNetAmountWan: number) => ({
    ...legacyIncome,
    annualNetAmountWan,
    lastConfirmedAtAgeInMonths: 312
  });

  const prospectiveEvidence = "工作这边，你留意到同城一家医疗器械公司正在招项目经理，薪资比现在高约三成，但需要经常出差。";
  assert.equal(isUnacceptedIncomeOpportunityEvidence(prospectiveEvidence), true);
  assert.equal(isUnacceptedIncomeOpportunityEvidence("你正式换工作，新岗位月薪3万元。"), false, "a completed first-person job change is not a mere new-job posting");
  const prospective = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "prospective_job_posting", kind: "income_source_adjusted", evidence: prospectiveEvidence,
      confidence: 0.7,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(18) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: prospectiveEvidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "prospective_job_posting",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(prospective.acceptedEvents.length, 0);
  assert.equal(prospective.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  // A supervisor's invitation to lead a temporary project is not a salary
  // confirmation either.  In particular, a generic \"获得主管肯定\" must not
  // refresh lastConfirmedAtAgeInMonths for the legacy income source.
  const projectInvitationEvidence = "你提交的预算优化方案在部门例会上获得了主管的肯定，他私下问你愿不愿意牵头做一个跨部门的成本分析项目，为期三个月，不影响婚礼筹备。";
  const projectInvitation = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "prospective_internal_project", kind: "income_source_adjusted", evidence: projectInvitationEvidence,
      confidence: 0.9,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(18) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: projectInvitationEvidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "prospective_internal_project",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(projectInvitation.acceptedEvents.length, 0);
  assert.equal(projectInvitation.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  const projectWithSalaryEvidence = "主管问你愿不愿意牵头三个月的跨部门成本分析项目，项目补贴后月薪可达2.5万元。";
  const projectWithSalary = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "prospective_internal_project_with_salary", kind: "income_source_adjusted", evidence: projectWithSalaryEvidence,
      confidence: 0.9,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(18) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: projectWithSalaryEvidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "prospective_internal_project_with_salary",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(projectWithSalary.acceptedEvents.length, 0);
  assert.equal(projectWithSalary.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  const confirmedEvidence = "你仍在原公司工作，年税后收入稳定在18万元。";
  const confirmed = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "current_income_reconfirmed", kind: "income_source_adjusted", evidence: confirmedEvidence,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(18) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: confirmedEvidence,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "current_income_reconfirmed",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(confirmed.acceptedEvents.length, 1);
  assert.equal((confirmed.acceptedEvents[0]?.payload as any).nextSource.annualNetAmountWan, 18);

  const partnerNarratedPersonalIncome = "她指着其中一行说，这个数字是按你留在本地、年收入稳定在18万元的基础上算的。";
  const partnerNarrated = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "partner_narrated_personal_income", kind: "income_source_adjusted", evidence: partnerNarratedPersonalIncome,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(18) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: partnerNarratedPersonalIncome,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "partner_narrated_personal_income",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(partnerNarrated.issues.length, 0);
  assert.equal(partnerNarrated.acceptedEvents.length, 1);

  const mixedNarratedIncome = "伴侣的年收入稳定在20万元，而你留在本地、年收入稳定在18万元。";
  const mismatchedPartnerAmount = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "partner_amount_cannot_be_written_as_protagonist_income", kind: "income_source_adjusted", evidence: mixedNarratedIncome,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(20) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: mixedNarratedIncome,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "partner_amount_cannot_be_written_as_protagonist_income",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(mismatchedPartnerAmount.acceptedEvents.length, 0);
  assert.equal(mismatchedPartnerAmount.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  const partnerOnlyIncome = "伴侣的年收入稳定在18万元。";
  const partnerOnly = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "partner_only_annual_income", kind: "income_source_adjusted", evidence: partnerOnlyIncome,
      payload: { incomeSourceId: legacyIncome.id, nextSource: currentSalary(18) }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: partnerOnlyIncome,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "partner_only_annual_income",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(partnerOnly.acceptedEvents.length, 0);
  assert.equal(partnerOnly.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);

  const spoofedPartnerDisplayName = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "partner_display_name_cannot_spoof_personal_income", kind: "income_source_adjusted", evidence: partnerNarratedPersonalIncome,
      payload: {
        incomeSourceId: legacyIncome.id,
        nextSource: { ...currentSalary(18), displayName: "伴侣工资" }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: partnerNarratedPersonalIncome,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "partner_display_name_cannot_spoof_personal_income",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(spoofedPartnerDisplayName.acceptedEvents.length, 0);
  assert.equal(spoofedPartnerDisplayName.issues.some((issue) => issue.code === "BUSINESS_PERSONAL_BOUNDARY_CONFLICT"), true);
});

test("requires adjustment instead of stacking a second authoritative basic-living commitment", () => {
  const context = setup();
  context.currentLedger.expenseCommitments.push({
    id: "living_current", type: "basic_living", displayName: "当前生活费", monthlyAmountWan: 0.8,
    activeFromAgeInMonths: 300, status: "active", factStatus: "estimated", evidence
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "living_duplicate", kind: "expense_commitment_started", evidence: "你的基本生活费调整为每月1万元。",
      payload: { id: "living_duplicate", type: "basic_living", displayName: "新的基本生活费", monthlyAmountWan: 1, activeFromAgeInMonths: 312, status: "active", factStatus: "estimated", evidence }
    })],
    acceptedOutcomeId: "accepted_choice", narrativeText: "你的基本生活费调整为每月1万元。",
    periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "duplicate_living", liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.match(result.issues[0].summary, /expense_commitment_adjusted/);
});

test("a model proposal cannot create the system-owned unclassified residual", () => {
  const context = v4Context();
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "model_unclassified",
      kind: "expense_commitment_started",
      evidence: "你的其他生活支出估计为每月5500元。",
      payload: v4Expense({
        id: "model_unclassified",
        type: "other",
        displayName: "未分类核心生活支出估算",
        monthlyAmountWan: 0.55,
        responsibilityKey: "unclassified_core_consumption:protagonist",
        responsibilityKind: "unclassified_core_consumption",
        factStatus: "needs_review",
        amountBasis: "contextual_estimate",
        confirmedMonthlyAmountWan: undefined
      })
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你的其他生活支出估计为每月5500元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "model_unclassified_rejected",
    liquidityPolicy: "require_explicit"
  });

  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_SCHEMA_FIELD_MISMATCH"), true);
});

test("allows separate dependent-support commitments for different responsibilities", () => {
  const context = setup();
  context.currentLedger.expenseCommitments.push({
    id: "support_parent", type: "dependent_support", displayName: "父母照护费", monthlyAmountWan: 0.2,
    activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence,
    responsibilityKey: "elder_care:parent", responsibilityKind: "elder_care",
    amountBasis: "explicit_known", amountSourceIds: ["parent-care"], financialScope: "personal",
    accrualReviewStatus: "normal", nextReviewAtAgeInMonths: 312, confirmedMonthlyAmountWan: 0.2,
    lastConfirmedAtAgeInMonths: 300
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "support_child", kind: "expense_commitment_started", evidence: "你开始每月支付0.3万元子女教育生活费。",
      payload: {
        id: "support_child", type: "dependent_support", displayName: "子女教育生活费", monthlyAmountWan: 0.3,
        activeFromAgeInMonths: 312, status: "active", factStatus: "known", evidence,
        responsibilityKey: "child_support:child_1", responsibilityKind: "child_support",
        amountBasis: "explicit_known", amountSourceIds: ["child-care"], financialScope: "personal",
        accrualReviewStatus: "normal", nextReviewAtAgeInMonths: 324, confirmedMonthlyAmountWan: 0.3,
        lastConfirmedAtAgeInMonths: 312
      }
    })],
    acceptedOutcomeId: "accepted_choice", narrativeText: "你开始每月支付0.3万元子女教育生活费。",
    periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "separate_support", liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 1);
});

test("V4 rejects reusing one recurring amount source across different responsibilities", () => {
  const context = setup();
  const currentLedger = migrateFinancialLedgerV3ToV4(context.currentLedger as FinancialLedgerV3);
  currentLedger.expenseCommitments.push({
    id: "support_parent", type: "dependent_support", displayName: "父母照护费", monthlyAmountWan: 0.4,
    activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence,
    responsibilityKey: "elder_care:parent", responsibilityKind: "elder_care",
    amountBasis: "explicit_known", amountSourceIds: ["parent-transfer-4000"], financialScope: "personal",
    accrualReviewStatus: "normal", nextReviewAtAgeInMonths: 312, confirmedMonthlyAmountWan: 0.4,
    lastConfirmedAtAgeInMonths: 300
  });
  const result = validateFinancialProposals({
    ...context,
    currentLedger,
    proposals: [proposal({
      id: "duplicate_parent_transfer", kind: "expense_commitment_started", evidence: "你开始每月支付0.4万元子女抚养费。",
      payload: {
        id: "support_child", type: "dependent_support", displayName: "子女抚养费", monthlyAmountWan: 0.4,
        activeFromAgeInMonths: 312, status: "active", factStatus: "known", evidence,
        responsibilityKey: "child_support:child_1", responsibilityKind: "child_support",
        amountBasis: "explicit_known", amountSourceIds: ["parent-transfer-4000"], financialScope: "personal",
        accrualReviewStatus: "normal", nextReviewAtAgeInMonths: 324, confirmedMonthlyAmountWan: 0.4,
        lastConfirmedAtAgeInMonths: 312
      }
    })],
    acceptedOutcomeId: "accepted_choice", narrativeText: "你开始每月支付0.4万元子女抚养费。",
    periodStartAgeInMonths: 300, periodEndAgeInMonths: 312, simulationTransactionId: "duplicate_expense_source", liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "EXPENSE_AMOUNT_SOURCE_DOUBLE_COUNT");
});

test("V4 shared-household known amounts require a gross amount and protagonist share", () => {
  const missingGross = validateFinancialPayloadSchema("expense_commitment_started", v4Expense({
    financialScope: "shared_household",
    amountBasis: "explicit_shared_amount",
    householdShareRate: 0.5
  }));
  assert.equal(missingGross.some((item) => item.path.endsWith("grossMonthlyAmountWan")), true);

  const missingShare = validateFinancialPayloadSchema("expense_commitment_started", v4Expense({
    financialScope: "shared_household",
    amountBasis: "explicit_shared_amount",
    grossMonthlyAmountWan: 0.4
  }));
  assert.equal(missingShare.some((item) => item.path.endsWith("householdShareRate")), true);
});

test("collective expense prose cannot relabel a household total as the protagonist's personal bill", () => {
  const context = v4Context();
  const narrative = "你们每月共同承担房租5000元。";
  const personalTotal = proposal({
    id: "collective_total_as_personal",
    kind: "expense_commitment_started",
    financialScope: "personal",
    evidence: narrative,
    payload: v4Expense({ id: "collective_total_as_personal", monthlyAmountWan: 0.5 })
  });
  const sharedTotal = proposal({
    id: "collective_total_as_shared",
    kind: "expense_commitment_started",
    financialScope: "shared_household",
    evidence: narrative,
    payload: v4Expense({
      id: "collective_total_as_shared",
      monthlyAmountWan: 0.5,
      financialScope: "shared_household",
      amountBasis: "explicit_shared_amount",
      grossMonthlyAmountWan: 0.5,
      householdShareRate: 1,
      confirmedMonthlyAmountWan: 0.5
    })
  });
  const result = validateFinancialProposals({
    ...context,
    proposals: [personalTotal, sharedTotal],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "collective_total_rejected",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.filter((item) => item.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT").length, 2);
});

test("model transport cannot spoof the deterministic responsibility-reconciliation marker", () => {
  const context = v4Context();
  const narrative = "你们每月共同承担房租5000元。";
  const normalized = normalizeFinancialProposals({
    proposals: [proposal({
      id: "system_expense_start_model_spoof",
      kind: "expense_commitment_started",
      financialScope: "personal",
      evidence: narrative,
      payload: v4Expense({ id: "system_expense_start_model_spoof", monthlyAmountWan: 0.5 }),
      systemGenerated: "expense_responsibility_reconciliation"
    })],
    acceptedOutcomeIds: ["accepted_choice"],
    currentLedger: context.currentLedger,
    currentCareerStateId: context.currentCareerState.id
  });
  assert.equal(normalized.proposals[0]?.systemGenerated, undefined);
  const result = validateFinancialProposals({
    ...context,
    proposals: normalized.proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "system_marker_model_spoof",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"), true);
});

test("an internally reconciled accepted WorldState expense uses structured authority instead of raw narrative matching", () => {
  const context = v4Context();
  const stateEvidence = "健康进入长期管理阶段，日常方案持续执行。";
  const candidate: ExpenseResponsibilityCandidate = {
    id: "accepted_world_delta_healthcare",
    responsibilityKey: "recurring_healthcare:protagonist",
    responsibilityKind: "recurring_healthcare",
    proposedType: "healthcare",
    action: "start",
    completion: "completed",
    cadence: "recurring_unknown",
    liability: "protagonist",
    financialScope: "personal",
    participantPersonIds: [],
    source: "accepted_world_delta",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "EXPENSE_PROTAGONIST_HEALTHCARE_WORLD_STATE",
      excerpt: stateEvidence,
      confidence: 1,
      financialScope: "personal"
    }]
  };
  const reconciliation = reconcileExpenseCommitments({
    ledger: context.currentLedger,
    candidates: [candidate],
    ageInMonths: 312,
    sourceOutcomeId: "accepted_choice",
    mode: "enforced"
  });
  assert.deepEqual(reconciliation.issues, []);
  assert.equal(reconciliation.proposals.length, 1);
  assert.equal(reconciliation.proposals[0]?.systemGenerated, "expense_world_delta_reconciliation");

  // The candidate's accepted WorldState evidence is deliberately not copied
  // into this node's prose. Ordinary evidence matching would reject it; the
  // internal marker must retain the accepted structured-authority path.
  const result = validateFinancialProposals({
    ...context,
    proposals: reconciliation.proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "治疗、睡眠和工作减负安排已经稳定，她开始观察这一方案能否长期维持。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "accepted_world_delta_healthcare"
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(result.acceptedEvents[0]?.acceptedByReasonCodes.includes("ACCEPTED_WORLD_DELTA"), true);
  assert.equal(result.acceptedEvents[0]?.evidence[0]?.reasonCode, "ACCEPTED_WORLD_DELTA");
});

test("only a canonical system expense reconciliation bypasses a company-text false positive", () => {
  const context = v4Context();
  const narrative = "公司团队的运营成本近期增加。你仍每月支付房租3500元。";
  const candidate: ExpenseResponsibilityCandidate = {
    id: "personal_rent_with_company_context",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    proposedType: "housing",
    action: "start",
    completion: "completed",
    cadence: "monthly",
    liability: "protagonist",
    financialScope: "personal",
    explicitMonthlyTotalWan: 0.35,
    protagonistShareWan: 0.35,
    amountSourceId: "narrative:personal-rent:3500",
    participantPersonIds: [],
    source: "narrative_supplement",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "EXPENSE_HOUSING_NARRATIVE",
      excerpt: narrative,
      confidence: 1,
      financialScope: "personal"
    }]
  };
  const reconciliation = reconcileExpenseCommitments({
    ledger: context.currentLedger,
    candidates: [candidate],
    ageInMonths: 312,
    sourceOutcomeId: "accepted_choice",
    mode: "enforced"
  });
  assert.equal(reconciliation.proposals[0]?.systemGenerated, "expense_responsibility_reconciliation");

  const canonical = validateFinancialProposals({
    ...context,
    proposals: reconciliation.proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "canonical_company_text_false_positive"
  });
  assert.deepEqual(canonical.issues, []);
  assert.equal(canonical.acceptedEvents.length, 1);

  const modelProposal = proposal({
    id: "model_personal_rent_with_company_context",
    kind: "expense_commitment_started",
    financialScope: "personal",
    evidence: narrative,
    payload: v4Expense({
      id: "model_personal_rent_with_company_context",
      monthlyAmountWan: 0.35,
      confirmedMonthlyAmountWan: 0.35,
      amountSourceIds: ["narrative:personal-rent:3500"]
    })
  });
  const ordinary = validateFinancialProposals({
    ...context,
    proposals: [modelProposal],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "model_company_text_false_positive"
  });
  assert.equal(ordinary.acceptedEvents.length, 0);
  assert.equal(ordinary.issues[0]?.code, "BUSINESS_PERSONAL_BOUNDARY_CONFLICT");
});

test("a completed narrative joint account for rent accepts a policy-based shared housing review without treating its contribution rate as rent", () => {
  const context = v4Context();
  const narrative = "43岁过半，你与伴侣正式设立了共同账户，每月按税后收入的30%存入用于房租和家庭共同支出，剩余各自保留。起初的几个月，你们像两个谨慎的合伙人，每笔支出都记录在案，季度复盘时仔细核对每一项。";
  const candidate: ExpenseResponsibilityCandidate = {
    id: "narrative_joint_account_shared_residence",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    proposedType: "housing",
    action: "start",
    completion: "completed",
    cadence: "recurring_unknown",
    liability: "shared",
    financialScope: "shared_household",
    participantPersonIds: [],
    source: "narrative_supplement",
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "EXPENSE_HOUSING_NARRATIVE",
      excerpt: narrative.split("。", 1)[0] + "。",
      confidence: 1,
      financialScope: "shared_household"
    }]
  };
  const reconciliation = reconcileExpenseCommitments({
    ledger: context.currentLedger,
    candidates: [candidate],
    ageInMonths: 312,
    sourceOutcomeId: "accepted_choice",
    mode: "enforced"
  });
  const proposal = reconciliation.proposals[0];
  assert.equal(reconciliation.wouldBlock, false);
  assert.equal(proposal?.systemGenerated, "expense_responsibility_reconciliation");

  const result = validateFinancialProposals({
    ...context,
    proposals: reconciliation.proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "narrative_joint_account_shared_residence"
  });
  const commitment = result.acceptedEvents[0]?.payload as any;
  assert.deepEqual(result.issues, []);
  assert.equal(result.acceptedEvents.length, 1);
  assert.equal(commitment.monthlyAmountWan, 0.35);
  assert.equal(commitment.amountBasis, "contextual_estimate");
  assert.equal(commitment.factStatus, "needs_review");
  assert.equal(commitment.grossMonthlyAmountWan, undefined);
  assert.equal(commitment.householdShareRate, undefined);
});

test("a contextual care uplift passes only as a strict same-account increase", () => {
  const context = v4Context();
  context.currentLedger.asOfAgeInMonths = 66 * 12 + 8;
  context.currentLedger.expenseCommitments.push({
    ...v4ElderCareExpense({
      id: "contextual_parent_care",
      responsibilityKey: "elder_care:parents",
      monthlyAmountWan: 0.2
    }),
    activeFromAgeInMonths: 58 * 12,
    factStatus: "needs_review",
    amountBasis: "contextual_estimate",
    confirmedMonthlyAmountWan: undefined,
    estimationPolicyId: "expense-estimation-policy-v2",
    accrualReviewStatus: "conservative",
    lastConfirmedAtAgeInMonths: undefined,
    lastReviewedAtAgeInMonths: 58 * 12,
    nextReviewAtAgeInMonths: 59 * 12,
    participantPersonIds: [],
    evidence: [{
      source: "accepted_simulation_outcome",
      reasonCode: "INITIAL_PARENT_CARE",
      excerpt: "你定期带父母去县医院做全面体检。",
      confidence: 1,
      financialScope: "personal"
    }]
  });
  const narrative = "父亲膝盖的退行性变化需要持续关注。你每天早晚帮他做一轮轻柔的关节活动。";
  const reconciliation = reconcileExpenseCommitments({
    ledger: context.currentLedger,
    candidates: [{
      id: "contextual_care_uplift",
      responsibilityKey: "elder_care:parents",
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      action: "adjust",
      completion: "completed",
      cadence: "recurring_unknown",
      liability: "protagonist",
      financialScope: "personal",
      participantPersonIds: [],
      policyEstimateAdjustment: "increase_only",
      source: "narrative_supplement",
      evidence: [{
        source: "accepted_simulation_outcome",
        reasonCode: "EXPENSE_ELDER_CARE_INTENSITY_ESCALATION",
        excerpt: narrative,
        confidence: 1,
        financialScope: "personal"
      }]
    }],
    ageInMonths: 66 * 12 + 8,
    sourceOutcomeId: "accepted_choice",
    mode: "enforced"
  });
  const uplift = reconciliation.proposals[0];
  assert.equal(uplift?.systemGenerated, "expense_contextual_care_uplift");
  assert.equal((uplift?.payload as any)?.nextCommitment?.monthlyAmountWan, 0.35);

  const accepted = validateFinancialProposals({
    ...context,
    proposals: reconciliation.proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 66 * 12 + 8,
    periodEndAgeInMonths: 66 * 12 + 9,
    simulationTransactionId: "contextual_care_uplift"
  });
  assert.deepEqual(accepted.issues, []);
  assert.equal(accepted.acceptedEvents.length, 1);

  const changes = [
    (proposal: FinancialEventProposal) => { (proposal.payload as any).nextCommitment.financialScope = "shared_household"; },
    (proposal: FinancialEventProposal) => { (proposal.payload as any).nextCommitment.participantPersonIds = ["mother"]; },
    (proposal: FinancialEventProposal) => { (proposal.payload as any).nextCommitment.monthlyAmountWan = 0.2; },
    (proposal: FinancialEventProposal) => { (proposal.payload as any).nextCommitment.status = "paused"; }
  ];
  for (const mutate of changes) {
    const spoofed = structuredClone(uplift!);
    mutate(spoofed);
    const rejected = validateFinancialProposals({
      ...context,
      proposals: [spoofed],
      acceptedOutcomeId: "accepted_choice",
      narrativeText: narrative,
      periodStartAgeInMonths: 66 * 12 + 8,
      periodEndAgeInMonths: 66 * 12 + 9,
      simulationTransactionId: "contextual_care_uplift_spoof"
    });
    assert.equal(rejected.acceptedEvents.length, 0);
    assert.ok(rejected.issues.length > 0, "every identity or amount spoof must be rejected by either the V4 schema or the dedicated uplift validator");
  }
});

test("model transport cannot spoof accepted WorldState authority or bypass evidence and ownership checks", () => {
  const context = v4Context();
  const noNarrativeEvidence = "健康进入长期管理阶段，日常方案持续执行。";
  const sharedHousingEvidence = "你们每月共同承担房租5000元。";
  const normalized = normalizeFinancialProposals({
    proposals: [
      {
        ...proposal({
          id: "system_expense_start_model_world_delta_evidence_spoof",
          kind: "expense_commitment_started",
          financialScope: "personal",
          evidence: noNarrativeEvidence,
          payload: v4Expense({
            id: "system_expense_start_model_world_delta_evidence_spoof",
            type: "healthcare",
            displayName: "持续医疗支出",
            monthlyAmountWan: 0.12,
            responsibilityKey: "recurring_healthcare:protagonist",
            responsibilityKind: "recurring_healthcare"
          })
        }),
        systemGenerated: "expense_world_delta_reconciliation"
      },
      {
        ...proposal({
          id: "system_expense_start_model_world_delta_ownership_spoof",
          kind: "expense_commitment_started",
          financialScope: "personal",
          evidence: sharedHousingEvidence,
          payload: v4Expense({ id: "system_expense_start_model_world_delta_ownership_spoof", monthlyAmountWan: 0.5 })
        }),
        systemGenerated: "expense_world_delta_reconciliation"
      }
    ],
    acceptedOutcomeIds: ["accepted_choice"],
    currentLedger: context.currentLedger,
    currentCareerStateId: context.currentCareerState.id
  });
  assert.deepEqual(normalized.proposals.map((item) => item.systemGenerated), [undefined, undefined]);

  const result = validateFinancialProposals({
    ...context,
    proposals: normalized.proposals,
    acceptedOutcomeId: "accepted_choice",
    narrativeText: `你在雨后的街道慢慢散步。${sharedHousingEvidence}`,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "model_world_delta_marker_spoof"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((item) => item.code === "UNBALANCED_TRANSACTION"), true);
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_RESPONSIBILITY_SCOPE_CONFLICT"), true);
});

test("a jointly stated total is accepted only when the evidence proves the protagonist's exact share", () => {
  const context = v4Context();
  const narrative = "你们每月共同承担房租5000元，其中你每月承担2500元（各半）。";
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "confirmed_shared_rent_half",
      kind: "expense_commitment_started",
      financialScope: "shared_household",
      evidence: narrative,
      payload: v4Expense({
        id: "confirmed_shared_rent_half",
        monthlyAmountWan: 0.25,
        financialScope: "shared_household",
        amountBasis: "explicit_shared_amount",
        grossMonthlyAmountWan: 0.5,
        householdShareRate: 0.5,
        confirmedMonthlyAmountWan: 0.25,
        amountSourceIds: ["rent:shared:5000"]
      })
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "confirmed_shared_rent_half",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 1);
});

test("direct aggregate and individual elder-care starts cannot coexist in one model proposal batch", () => {
  const context = v4Context();
  const narrative = "你开始每月支付3000元父母照护费。你开始每月支付2000元母亲照护费。";
  const result = validateFinancialProposals({
    ...context,
    proposals: [
      proposal({
        id: "parents_care_start",
        kind: "expense_commitment_started",
        evidence: "你开始每月支付3000元父母照护费。",
        payload: v4ElderCareExpense({ id: "parents_care", responsibilityKey: "elder_care:parents", monthlyAmountWan: 0.3 })
      }),
      proposal({
        id: "mother_care_start",
        kind: "expense_commitment_started",
        evidence: "你开始每月支付2000元母亲照护费。",
        payload: v4ElderCareExpense({ id: "mother_care", responsibilityKey: "elder_care:mother", monthlyAmountWan: 0.2 })
      })
    ],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "direct_aggregate_individual_conflict",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues.some((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY"), true);
});

test("a protagonist care plan does not collide with aggregate parent-care coverage", () => {
  const context = v4Context();
  const narrative = "你开始每月支付3000元父母照护费。你开始每月支付护工费用2000元。";
  const result = validateFinancialProposals({
    ...context,
    proposals: [
      proposal({
        id: "parents_care_start",
        kind: "expense_commitment_started",
        evidence: "你开始每月支付3000元父母照护费。",
        payload: v4ElderCareExpense({ id: "parents_care", responsibilityKey: "elder_care:parents", monthlyAmountWan: 0.3 })
      }),
      proposal({
        id: "protagonist_care_plan_start",
        kind: "expense_commitment_started",
        evidence: "你开始每月支付护工费用2000元。",
        payload: v4ElderCareExpense({ id: "protagonist_care_plan", responsibilityKey: "elder_care:care_plan", monthlyAmountWan: 0.2 })
      })
    ],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "parent_care_and_protagonist_care_plan",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 2);
  const reduced = reduceFinancialLedger({
    ledger: context.currentLedger,
    transactionId: "parent_care_and_protagonist_care_plan",
    expectedLedgerRevision: context.currentLedger.revision,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    events: result.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  assert.deepEqual(
    reduced.ledger.expenseCommitments.filter((commitment) => commitment.status === "active")
      .map((commitment) => commitment.responsibilityKey).sort(),
    ["elder_care:care_plan", "elder_care:parents"]
  );
});

test("a paused aggregate elder-care responsibility still blocks a direct individual start", () => {
  const context = v4Context();
  context.currentLedger.expenseCommitments.push(v4ElderCareExpense({
    id: "parents_care_paused",
    responsibilityKey: "elder_care:parents",
    monthlyAmountWan: 0.3,
    status: "paused"
  }) as never);
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "mother_care_beside_paused_parents",
      kind: "expense_commitment_started",
      evidence: "你开始每月支付2000元母亲照护费。",
      payload: v4ElderCareExpense({ id: "mother_care", responsibilityKey: "elder_care:mother", monthlyAmountWan: 0.2 })
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你开始每月支付2000元母亲照护费。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "paused_aggregate_individual_conflict",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  const issue = result.issues.find((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY");
  assert.ok(issue);
  assert.equal(issue.relatedAccountIds?.includes("parents_care_paused"), true);
});

test("a paused V4 responsibility rejects a second start, while an ended responsibility may restart", () => {
  const pausedContext = v4Context();
  const paused = v4ElderCareExpense({
    id: "mother_care_paused",
    responsibilityKey: "elder_care:mother",
    monthlyAmountWan: 0.2,
    status: "paused"
  });
  pausedContext.currentLedger.expenseCommitments.push(paused as never);
  const narrative = "你恢复每月承担母亲照护费2000元。";
  const directStart = proposal({
    id: "mother_care_duplicate_start",
    kind: "expense_commitment_started",
    evidence: narrative,
    payload: v4ElderCareExpense({
      id: "mother_care_duplicate",
      responsibilityKey: "elder_care:mother",
      monthlyAmountWan: 0.2
    })
  });
  const rejected = validateFinancialProposals({
    ...pausedContext,
    proposals: [directStart],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "paused_same_key_start_rejected",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(rejected.acceptedEvents.length, 0);
  const issue = rejected.issues.find((item) => item.code === "EXPENSE_DUPLICATE_RESPONSIBILITY");
  assert.ok(issue);
  assert.equal(issue.relatedAccountIds?.includes(paused.id), true);

  const reducerOnlyEvent = validateFinancialProposals({
    ...v4Context(),
    proposals: [directStart],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "paused_same_key_direct_reducer",
    liquidityPolicy: "require_explicit"
  }).acceptedEvents[0]!;
  assert.throws(() => reduceFinancialLedger({
    ledger: pausedContext.currentLedger,
    transactionId: "paused_same_key_direct_reducer",
    expectedLedgerRevision: pausedContext.currentLedger.revision,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    events: [reducerOnlyEvent],
    liquidityPolicy: "require_explicit"
  }), /必须调整或恢复原账户/);
  assert.equal(pausedContext.currentLedger.expenseCommitments.length, 1);

  const endedContext = v4Context();
  endedContext.currentLedger.expenseCommitments.push({
    ...v4ElderCareExpense({
      id: "mother_care_ended",
      responsibilityKey: "elder_care:mother",
      monthlyAmountWan: 0.2
    }),
    status: "ended",
    activeUntilAgeInMonths: 312
  } as never);
  const restarted = validateFinancialProposals({
    ...endedContext,
    proposals: [directStart],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "ended_same_key_restart_allowed",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(restarted.issues.length, 0);
  assert.equal(restarted.acceptedEvents.length, 1);
});

test("a paused V4 responsibility resumes through an adjustment of the same account", () => {
  const context = v4Context();
  const paused = v4ElderCareExpense({
    id: "mother_care_paused",
    responsibilityKey: "elder_care:mother",
    monthlyAmountWan: 0.2,
    status: "paused"
  });
  context.currentLedger.expenseCommitments.push(paused as never);
  const narrative = "母亲照护费用不再由家人代付，你恢复每月承担2000元。";
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "mother_care_resumed",
      kind: "expense_commitment_adjusted",
      evidence: narrative,
      payload: {
        expenseCommitmentId: paused.id,
        previousCommitmentId: paused.id,
        changeReason: "responsibility_resumed",
        nextCommitment: { ...paused, status: "active" }
      }
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: narrative,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "paused_same_key_resume_adjustment",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 1);
  const reduced = reduceFinancialLedger({
    ledger: context.currentLedger,
    transactionId: "paused_same_key_resume_adjustment",
    expectedLedgerRevision: context.currentLedger.revision,
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    events: result.acceptedEvents,
    liquidityPolicy: "require_explicit"
  });
  assert.equal(reduced.ledger.expenseCommitments.length, 1);
  assert.equal(reduced.ledger.expenseCommitments[0]?.id, paused.id);
  assert.equal(reduced.ledger.expenseCommitments[0]?.status, "active");
});

test("an aggregate elder-care account can split atomically into individual responsibilities in either proposal order", () => {
  const narrative = "你已将原先每月3000元父母照护费拆分为分项。你每月承担母亲照护费2000元。你每月承担父亲照护费1000元。";
  for (const order of ["end_first", "end_last"] as const) {
    const context = v4Context();
    context.currentLedger.expenseCommitments.push(v4ElderCareExpense({
      id: "parents_care",
      responsibilityKey: "elder_care:parents",
      monthlyAmountWan: 0.3
    }) as never);
    const end = proposal({
      id: `parents_care_split_end_${order}`,
      kind: "expense_commitment_ended",
      evidence: "你已将原先每月3000元父母照护费拆分为分项。",
      payload: {
        expenseCommitmentId: "parents_care",
        previousCommitmentId: "parents_care",
        changeReason: "aggregate_atomically_split"
      }
    });
    const mother = proposal({
      id: `mother_care_split_${order}`,
      kind: "expense_commitment_started",
      evidence: "你每月承担母亲照护费2000元。",
      payload: v4ElderCareExpense({ id: "mother_care", responsibilityKey: "elder_care:mother", monthlyAmountWan: 0.2 })
    });
    const father = proposal({
      id: `father_care_split_${order}`,
      kind: "expense_commitment_started",
      evidence: "你每月承担父亲照护费1000元。",
      payload: v4ElderCareExpense({ id: "father_care", responsibilityKey: "elder_care:father", monthlyAmountWan: 0.1 })
    });
    const proposals = order === "end_first" ? [end, mother, father] : [mother, father, end];
    const result = validateFinancialProposals({
      ...context,
      proposals,
      acceptedOutcomeId: "accepted_choice",
      narrativeText: narrative,
      periodStartAgeInMonths: 300,
      periodEndAgeInMonths: 312,
      simulationTransactionId: `aggregate_atomic_split_${order}`,
      liquidityPolicy: "require_explicit"
    });
    assert.equal(result.issues.length, 0, order);
    assert.equal(result.acceptedEvents.length, 3, order);
    const reduced = reduceFinancialLedger({
      ledger: context.currentLedger,
      transactionId: `aggregate_atomic_split_reduce_${order}`,
      expectedLedgerRevision: context.currentLedger.revision,
      periodStartAgeInMonths: 300,
      periodEndAgeInMonths: 312,
      events: result.acceptedEvents,
      liquidityPolicy: "require_explicit"
    });
    const activeElderCare = reduced.ledger.expenseCommitments.filter((commitment) => (
      commitment.status !== "ended" && commitment.responsibilityKey?.startsWith("elder_care:")
    ));
    assert.deepEqual(activeElderCare.map((commitment) => commitment.responsibilityKey).sort(), ["elder_care:father", "elder_care:mother"]);
    assert.equal(reduced.ledger.expenseCommitments.find((commitment) => commitment.id === "parents_care")?.status, "ended");
  }
});

test("ledger invariants reject a direct reducer write that would overlap paused or active aggregate elder care", () => {
  const clean = v4Context();
  const directMother = validateFinancialProposals({
    ...clean,
    proposals: [proposal({
      id: "direct_mother_for_ledger_invariant",
      kind: "expense_commitment_started",
      evidence: "你开始每月支付2000元母亲照护费。",
      payload: v4ElderCareExpense({ id: "direct_mother", responsibilityKey: "elder_care:mother", monthlyAmountWan: 0.2 })
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你开始每月支付2000元母亲照护费。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "direct_mother_for_ledger_invariant",
    liquidityPolicy: "require_explicit"
  }).acceptedEvents[0]!;
  for (const status of ["active", "paused"] as const) {
    const context = v4Context();
    context.currentLedger.expenseCommitments.push(v4ElderCareExpense({
      id: `parents_care_${status}`,
      responsibilityKey: "elder_care:parents",
      monthlyAmountWan: 0.3,
      status
    }) as never);
    assert.throws(() => reduceFinancialLedger({
      ledger: context.currentLedger,
      transactionId: `direct_overlap_${status}`,
      expectedLedgerRevision: context.currentLedger.revision,
      periodStartAgeInMonths: 300,
      periodEndAgeInMonths: 312,
      events: [directMother],
      liquidityPolicy: "require_explicit"
    }), /父母聚合照护/);
  }
});

test("V4 rejects an expense end without an auditable previous commitment and reason", () => {
  const context = v4LedgerWithHousing();
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "end_home_without_authority",
      kind: "expense_commitment_ended",
      payload: { expenseCommitmentId: "home_main" },
      evidence: "你已经搬离旧公寓，不再承担房租。"
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你已经搬离旧公寓，不再承担房租。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "v4_end_without_authority",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "EXPENSE_END_WITHOUT_EVIDENCE");
});

test("V4 accepts a residence end only when Accepted evidence, reason, and prior responsibility agree", () => {
  const context = v4LedgerWithHousing();
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "end_home_with_authority",
      kind: "expense_commitment_ended",
      payload: {
        expenseCommitmentId: "home_main",
        previousCommitmentId: "home_main",
        changeReason: "residence_ended"
      },
      evidence: "你已经搬离旧公寓，不再承担房租。"
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你已经搬离旧公寓，不再承担房租。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "v4_end_with_authority",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.issues.length, 0);
  assert.equal(result.acceptedEvents.length, 1);
  const accepted = result.acceptedEvents[0];
  assert.equal(accepted.kind, "expense_commitment_ended");
  if (accepted.kind !== "expense_commitment_ended") throw new Error("expected expense end");
  assert.equal(accepted.payload.previousCommitmentId, "home_main");
});

test("V4 accepts a Chinese-numeral exact rent that supersedes a higher estimate", () => {
  const context = v4LedgerWithHousing();
  const current = context.currentLedger.expenseCommitments.find((item) => item.id === "home_main")!;
  current.monthlyAmountWan = 0.45;
  current.grossMonthlyAmountWan = 0.45;
  current.factStatus = "needs_review";
  current.amountBasis = "contextual_estimate";
  delete current.confirmedMonthlyAmountWan;
  delete current.lastConfirmedAtAgeInMonths;
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "confirm_chinese_rent_exact_amount",
      kind: "expense_commitment_adjusted",
      payload: {
        expenseCommitmentId: current.id,
        previousCommitmentId: current.id,
        changeReason: "estimate_superseded_by_exact_fact",
        nextCommitment: {
          ...current,
          monthlyAmountWan: 0.04,
          grossMonthlyAmountWan: 0.04,
          factStatus: "needs_review",
          amountBasis: "last_known"
        }
      },
      evidence: "宿舍每月四百元的房租仍由你个人承担。"
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "宿舍每月四百元的房租仍由你个人承担。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "v4_chinese_exact_rent",
    liquidityPolicy: "require_explicit"
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.acceptedEvents.length, 1);
});

test("V4 does not let unemployment pause a continuing expense without temporary-payment proof", () => {
  const context = v4LedgerWithHousing();
  const current = context.currentLedger.expenseCommitments.find((item) => item.id === "home_main")!;
  const result = validateFinancialProposals({
    ...context,
    proposals: [proposal({
      id: "pause_home_for_unemployment",
      kind: "expense_commitment_adjusted",
      payload: {
        expenseCommitmentId: "home_main",
        previousCommitmentId: "home_main",
        changeReason: "temporary_third_party_coverage",
        nextCommitment: { ...current, status: "paused" }
      },
      evidence: "你暂时失业，收入减少。"
    })],
    acceptedOutcomeId: "accepted_choice",
    narrativeText: "你暂时失业，收入减少。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312,
    simulationTransactionId: "v4_pause_without_payment_proof",
    liquidityPolicy: "require_explicit"
  });
  assert.equal(result.acceptedEvents.length, 0);
  assert.equal(result.issues[0]?.code, "EXPENSE_DOWNWARD_WITHOUT_AUTHORITY");
});

test("every financial event kind has a payload schema that rejects an empty object", () => {
  const kinds: FinancialEventKind[] = ["income_source_started", "income_source_adjusted", "income_source_paused", "income_source_ended", "one_off_income_received", "expense_commitment_started", "expense_commitment_adjusted", "expense_commitment_ended", "one_off_expense_paid", "asset_purchased", "asset_balance_discovered", "asset_sold", "asset_revalued", "debt_drawn", "debt_balance_discovered", "debt_principal_repaid", "debt_interest_paid", "debt_restructured", "debt_forgiven", "debt_default_recorded", "business_holding_started", "business_financing_recorded", "business_option_granted", "business_option_vested", "business_option_revalued", "business_option_exercised", "business_option_expired", "business_option_cancelled", "business_holding_revalued", "business_distribution_received", "business_holding_sold", "family_support_received", "family_support_paid", "liquidity_shortfall_created"];
  for (const kind of kinds) assert.ok(validateFinancialPayloadSchema(kind, {}).length > 0, `${kind} schema must reject {}`);
});
