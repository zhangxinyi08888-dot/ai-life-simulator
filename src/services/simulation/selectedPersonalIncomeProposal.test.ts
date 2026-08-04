import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { resolveAllowedIncomeCareerStateIds, synthesizeSelectedPersonalIncomeProposal } from "./simulationService";

const decision = "现有客户续费；我与合伙人签署工资决议，从本月起公司向我的个人账户每月支付4万元税后工资。";

test("PB-BIZ-20 accepted custom decision starts explicit personal income deterministically", () => {
  const ledger = initializeFinancialLedger({ id: "selected_income", asOfAgeInMonths: 300 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: decision,
    acceptedOutcomeId: "custom_outcome",
    periodStartAgeInMonths: 300,
    currentCareerStateId: "career_founder",
    currentEmploymentStatus: "self_employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_started");
  assert.equal((result[0].payload as any).monthlyNetAmountWan, 4);
  assert.equal((result[0].payload as any).linkedCareerStateId, "career_founder");
  assert.equal(result[0].evidence, decision);
});

test("PB-BIZ-20 accepted custom decision adjusts an existing career income and replaces model competition", () => {
  const ledger = initializeFinancialLedger({
    id: "selected_income_adjustment",
    asOfAgeInMonths: 312,
    openingPosition: {
      incomeSources: [{
        id: "owner_draw", type: "self_employment_draw", displayName: "创业提款",
        monthlyNetAmountWan: 0.5, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "known", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [{
      id: "model_income", kind: "income_source_started", effectiveAtAgeInMonths: 320,
      payload: { id: "invented", type: "self_employment_draw", monthlyNetAmountWan: 8 },
      evidence: "公司月营收8万元。", confidence: 0.8
    }],
    selectedDecision: decision,
    acceptedOutcomeId: "custom_outcome",
    periodStartAgeInMonths: 312,
    currentCareerStateId: "career_founder",
    currentEmploymentStatus: "self_employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_adjusted");
  assert.equal((result[0].payload as any).incomeSourceId, "owner_draw");
  assert.equal((result[0].payload as any).nextSource.monthlyNetAmountWan, 4);
});

test("PB-CAREER-06 an actual employment start can ground the exact personal salary from its narrative", () => {
  const ledger = initializeFinancialLedger({ id: "return_to_work_income", asOfAgeInMonths: 639 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "C. 回归职场稳定",
    narrativeText: "你决定回归职场，最终接受了年薪45万元的offer，并于本月正式入职，税后月薪约2.6万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "return_to_work",
    periodStartAgeInMonths: 639,
    currentCareerStateId: "career_employed",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_started");
  assert.equal((result[0].payload as any).type, "salary");
  assert.equal((result[0].payload as any).monthlyNetAmountWan, 2.6);
  assert.match(result[0].evidence, /税后月薪约2.6万元/);
});

test("PB-CAREER-06b a completed external paid consultant role derives salary, not an owner draw", () => {
  const ledger = initializeFinancialLedger({ id: "external_consultant_salary", asOfAgeInMonths: 328 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "申请核对并调整还款安排",
    narrativeText: "老周介绍的供应链顾问工作，你接了，按月结算，税后到手约1.2万。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "request_debt_restructuring",
    periodStartAgeInMonths: 328,
    currentCareerStateId: "career_external_consultant",
    currentEmploymentStatus: "employed",
    migrateToCurrentCareerState: true,
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal((result[0]?.payload as any).type, "salary");
  assert.equal((result[0]?.payload as any).monthlyNetAmountWan, 1.2);
  assert.equal((result[0]?.payload as any).linkedCareerStateId, "career_external_consultant");
});

test("PB-CAREER-06a a future employer offer salary cannot synthesize or adjust current income", () => {
  const ledger = initializeFinancialLedger({ id: "pending_offer_income", asOfAgeInMonths: 639 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "接受产品总监 offer，税后月薪3.5万元，下月入职。",
    narrativeText: "你接受了产品总监 offer。对方给出的税后月薪为3.5万元，你计划下月正式入职。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "accept_product_director_offer",
    periodStartAgeInMonths: 639,
    currentCareerStateId: "career_employed",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.deepEqual(result, []);
});

test("PB-CAREER-11 exact annual salary in accepted narrative starts same-node income without a career transition", () => {
  const ledger = initializeFinancialLedger({ id: "annual_salary_confirmation", asOfAgeInMonths: 420 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续当前节奏，把顾问角色逐步转为正式兼职。",
    narrativeText: "调整完成后，你的税后年薪稳定在32万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "annual_salary_confirmation",
    periodStartAgeInMonths: 420,
    currentCareerStateId: "career_consultant",
    currentEmploymentStatus: "part_time",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_started");
  assert.equal((result[0]?.payload as any).annualNetAmountWan, 32);
  assert.equal((result[0]?.payload as any).accrualPolicy, "annual");
});

test("PB-CAREER-11a prospective job-posting pay cannot synthesize a current personal income", () => {
  const ledger = initializeFinancialLedger({ id: "prospective_job_posting", asOfAgeInMonths: 420 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续当前节奏，与伴侣筹备共同生活。",
    narrativeText: "你留意到同城一家医疗器械公司正在招项目经理，年薪30万元，比现在高约三成，但你把招聘信息收了起来。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "maintain_financial_order",
    periodStartAgeInMonths: 420,
    currentCareerStateId: "career_current",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 0);
});

test("PB-CAREER-11b a raised annual salary with an explicit qualifier updates the current income", () => {
  const ledger = initializeFinancialLedger({
    id: "qualified_annual_salary_adjustment",
    asOfAgeInMonths: 335,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
        annualNetAmountWan: 24, accrualPolicy: "annual", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_opening_312", factStatus: "estimated", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [{
      id: "malformed_model_salary", kind: "income_source_adjusted", effectiveAtAgeInMonths: 335,
      sourceOutcomeId: "stay_local", confidence: 0.9, evidence: "税后年薪涨到约30万。",
      payload: {
        incomeSourceId: "legacy_recurring_income",
        nextSource: { ...ledger.incomeSources[0], annualNetAmountWan: 30, evidence: ["税后年薪涨到约30万。"] }
      }
    } as any],
    selectedDecision: "继续留在当前城市，和伴侣一起按计划推进买房和婚姻。",
    narrativeText: "你在原公司继续深耕，28岁前被提为项目主管，税后年薪涨到约30万。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "stay_local",
    periodStartAgeInMonths: 335,
    currentCareerStateId: "career_opening_312",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_adjusted");
  assert.equal((result[0]?.payload as any).incomeSourceId, "legacy_recurring_income");
  assert.equal((result[0]?.payload as any).nextSource.annualNetAmountWan, 30);
});

test("PB-CAREER-11c a partner's narration can explicitly reconfirm the protagonist's plain annual income", () => {
  const ledger = initializeFinancialLedger({
    id: "partner_narrated_personal_annual_income",
    asOfAgeInMonths: 335,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
        annualNetAmountWan: 18, accrualPolicy: "annual", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_current", factStatus: "needs_review", evidence: []
      }]
    }
  });
  const narrative = "她指着其中一行说，这个数字是按你留在本地、年收入稳定在18万元的基础上算的。";
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续留在本地，维持当前工作安排。",
    narrativeText: narrative,
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "stay_local",
    periodStartAgeInMonths: 335,
    currentCareerStateId: "career_current",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_adjusted");
  assert.equal((result[0]?.payload as any).incomeSourceId, "legacy_recurring_income");
  assert.equal((result[0]?.payload as any).nextSource.type, "salary");
  assert.equal((result[0]?.payload as any).nextSource.annualNetAmountWan, 18);
  assert.equal((result[0]?.payload as any).nextSource.linkedCareerStateId, "career_current");
  assert.equal(result[0]?.evidence, narrative);
});

test("PB-CAREER-11d plain annual income remains rejected when it belongs only to a partner", () => {
  const ledger = initializeFinancialLedger({
    id: "partner_only_annual_income",
    asOfAgeInMonths: 335,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
        annualNetAmountWan: 18, accrualPolicy: "annual", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_current", factStatus: "needs_review", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续留在本地，维持当前工作安排。",
    narrativeText: "伴侣的年收入稳定在18万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "stay_local",
    periodStartAgeInMonths: 335,
    currentCareerStateId: "career_current",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.deepEqual(result, []);
});

test("PB-CAREER-11e extracts the protagonist amount rather than an earlier partner annual income", () => {
  const ledger = initializeFinancialLedger({
    id: "mixed_annual_income_ownership",
    asOfAgeInMonths: 335,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
        annualNetAmountWan: 12, accrualPolicy: "annual", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_current", factStatus: "needs_review", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续留在本地，维持当前工作安排。",
    narrativeText: "她的年收入稳定在18万元，而你留在本地、年收入稳定在12万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "stay_local",
    periodStartAgeInMonths: 335,
    currentCareerStateId: "career_current",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal((result[0]?.payload as any).nextSource.annualNetAmountWan, 12);
});

test("PB-CAREER-12 exact narrative salary adjusts the sole active current income in the same node", () => {
  const ledger = initializeFinancialLedger({
    id: "same_node_salary_adjustment",
    asOfAgeInMonths: 480,
    openingPosition: {
      incomeSources: [{
        id: "current_salary", type: "salary", displayName: "当前工资",
        monthlyNetAmountWan: 3, accrualPolicy: "monthly", activeFromAgeInMonths: 420,
        status: "active", linkedCareerStateId: "career_current", factStatus: "known", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续留任并承担新的职责。",
    narrativeText: "年度复核结束后，你的月薪正式调整为4.2万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "same_node_salary_adjustment",
    periodStartAgeInMonths: 480,
    currentCareerStateId: "career_current",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_adjusted");
  assert.equal((result[0]?.payload as any).incomeSourceId, "current_salary");
  assert.equal((result[0]?.payload as any).nextSource.monthlyNetAmountWan, 4.2);
});

test("PB-CAREER-12a salary change never captures a later monthly rent or medical outlay", () => {
  const ledger = initializeFinancialLedger({ id: "salary-before-monthly-expenses", asOfAgeInMonths: 288 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "确认劳动合同后正式入职AI创业公司，担任产品负责人。",
    narrativeText: "正式入职后，你的月薪从原来的2.5万元降至1.5万元，年终奖也大幅缩水，每月扣除房租3500元和父母医疗费用约1200元后，现金流明显紧张。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "start_ai_startup_product_lead",
    periodStartAgeInMonths: 288,
    currentCareerStateId: "career_startup_product_lead",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_started");
  assert.equal((result[0]?.payload as any).monthlyNetAmountWan, 1.5);
  assert.equal((result[0]?.payload as any).linkedCareerStateId, "career_startup_product_lead");
});

test("PB-CAREER-13 employee hiring salary cannot become protagonist income", () => {
  const ledger = initializeFinancialLedger({ id: "employee_salary", asOfAgeInMonths: 480 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续扩张团队。",
    narrativeText: "你招聘了一名销售，月薪调整为3万元，并给他设置了季度奖金。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "employee_salary",
    periodStartAgeInMonths: 480,
    currentCareerStateId: "career_founder",
    currentEmploymentStatus: "self_employed",
    ledger
  });
  assert.equal(result.length, 0);
});

test("PB-CAREER-14 exact recurring side-income prose starts a separate personal contract source", () => {
  const ledger = initializeFinancialLedger({
    id: "side_income",
    asOfAgeInMonths: 589,
    openingPosition: {
      incomeSources: [{
        id: "primary_salary", type: "salary", displayName: "主业工资",
        monthlyNetAmountWan: 2, accrualPolicy: "monthly", activeFromAgeInMonths: 500,
        status: "active", linkedCareerStateId: "career_current", factStatus: "needs_review",
        accrualReviewStatus: "quarantined", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "保持主业与课程副业并行。",
    narrativeText: "你的《零基础家庭财务Python课》加上一对一咨询，副业月收入稳定在6000元左右。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "maintain_side_income",
    periodStartAgeInMonths: 589,
    currentCareerStateId: "career_current",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_started");
  assert.equal((result[0].payload as any).type, "contract");
  assert.equal((result[0].payload as any).monthlyNetAmountWan, 0.6);
  assert.equal((result[0].payload as any).id, "personal_side_income_career_current");
  assert.equal(ledger.incomeSources[0].monthlyNetAmountWan, 2);
});

test("PB-CAREER-14a a consulting-company salary is not misclassified as side income", () => {
  const ledger = initializeFinancialLedger({
    id: "consulting-company-salary",
    asOfAgeInMonths: 317,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
        annualNetAmountWan: 32, accrualPolicy: "annual", activeFromAgeInMonths: 300,
        status: "active", linkedCareerStateId: "career_opening_300", factStatus: "estimated", evidence: []
      }]
    }
  });

  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续留在当前公司，并保持对家乡项目的远程支持。",
    narrativeText: "26岁半，你仍在上海的咨询公司工作，税后月薪2.7万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "maintain_remote_support",
    periodStartAgeInMonths: 317,
    currentCareerStateId: "career_opening_300",
    currentEmploymentStatus: "employed",
    ledger
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_adjusted");
  assert.equal((result[0]?.payload as any).incomeSourceId, "legacy_recurring_income");
  assert.equal((result[0]?.payload as any).nextSource.type, "salary");
  assert.equal((result[0]?.payload as any).nextSource.monthlyNetAmountWan, 2.7);
  assert.notEqual((result[0]?.payload as any).nextSource.id, "personal_side_income_career_opening_300");
});

test("PB-CAREER-14b explicitly marked weekend consulting remains a side-income contract", () => {
  const ledger = initializeFinancialLedger({ id: "explicit-consulting-income", asOfAgeInMonths: 317 });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "保留主业，并在周末承接教育咨询。",
    narrativeText: "你周末承接教育咨询，副业月收入稳定在0.6万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "start_weekend_consulting",
    periodStartAgeInMonths: 317,
    currentCareerStateId: "career_opening_300",
    currentEmploymentStatus: "employed",
    ledger
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.kind, "income_source_started");
  assert.equal((result[0]?.payload as any).id, "personal_side_income_career_opening_300");
  assert.equal((result[0]?.payload as any).type, "contract");
  assert.equal((result[0]?.payload as any).monthlyNetAmountWan, 0.6);
});

test("PB-CAREER-09 income confirmation remains linked to the current career when no transition occurs", () => {
  assert.deepEqual(resolveAllowedIncomeCareerStateIds("career_self_employed", []), ["career_self_employed"]);
  assert.deepEqual(resolveAllowedIncomeCareerStateIds("career_old", ["career_new"]), ["career_new"]);
});

test("PB-CAREER-10 salary reconfirmation cannot be hijacked by an unsupported candidate career", () => {
  const ledger = initializeFinancialLedger({
    id: "salary_reconfirmation",
    asOfAgeInMonths: 480,
    openingPosition: {
      incomeSources: [{
        id: "owner_draw", type: "self_employment_draw", displayName: "创业个人工资",
        monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 300,
        status: "active", linkedCareerStateId: "career_founder", factStatus: "needs_review",
        accrualReviewStatus: "quarantined", evidence: []
      }]
    }
  });
  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "董事会完成年度复核，公司继续向我的个人账户每月支付4.5万元税后工资。",
    acceptedOutcomeId: "salary_review",
    periodStartAgeInMonths: 480,
    currentCareerStateId: "unsupported_candidate_career",
    currentEmploymentStatus: "employed",
    ledger
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_adjusted");
  assert.equal((result[0].payload as any).incomeSourceId, "owner_draw");
  assert.equal((result[0].payload as any).nextSource.linkedCareerStateId, "career_founder");
  assert.equal((result[0].payload as any).nextSource.type, "self_employment_draw");
  assert.equal((result[0].payload as any).nextSource.monthlyNetAmountWan, 4.5);
});

test("a migration-only annual income is deterministically reconfirmed from accepted narrative", () => {
  const ledger = initializeFinancialLedger({
    id: "legacy_annual_income_reconfirmation",
    asOfAgeInMonths: 347,
    openingPosition: {
      incomeSources: [{
        id: "legacy_recurring_income", type: "other", displayName: "旧版持续收入聚合",
        annualNetAmountWan: 30, accrualPolicy: "annual", activeFromAgeInMonths: 312,
        status: "active", linkedCareerStateId: "career_opening", factStatus: "estimated",
        evidence: [{ source: "legacy_migration", reasonCode: "LEGACY_FINANCIAL_STATE_MIGRATION", confidence: 0.5 }]
      }]
    }
  });

  const result = synthesizeSelectedPersonalIncomeProposal({
    proposals: [],
    selectedDecision: "继续全力冲刺下一个项目。",
    narrativeText: "连续18个月高强度运转，你主导的区域方案被列为集团标杆，年税后收入稳定在30万元。",
    allowNarrativeEvidence: true,
    acceptedOutcomeId: "continue_current_career",
    periodStartAgeInMonths: 347,
    currentCareerStateId: "career_opening",
    currentEmploymentStatus: "employed",
    ledger
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "income_source_adjusted");
  assert.equal((result[0].payload as any).incomeSourceId, "legacy_recurring_income");
  assert.equal((result[0].payload as any).nextSource.annualNetAmountWan, 30);
  assert.match(result[0].evidence, /年税后收入稳定在30万元/);
});
