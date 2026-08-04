import assert from "node:assert/strict";
import test from "node:test";
import { initializeCareerState } from "../career/careerState";
import type { AcceptedCareerTransition } from "../career/types";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "./ledgerMath";
import {
  collectPersonalIncomeNarrativeContractIssues,
  narrativeClaimsExplicitPersonalIncome,
  narrativeClaimsNewPersonalIncomeActivity,
  reconcileCareerIncomeAtomicity
} from "./reconcileCareerIncomeAtomicity";
import type { AcceptedFinancialEvent, FinancialEvidence } from "./types";

const evidence: FinancialEvidence[] = [{ source: "accepted_simulation_outcome", reasonCode: "TEST", confidence: 1 }];

function fixture() {
  const currentCareer = initializeCareerState({ id: "career_job", employmentStatus: "employed", effectiveFromAgeInMonths: 600 });
  const retired = initializeCareerState({ id: "career_retired", employmentStatus: "retired", effectiveFromAgeInMonths: 660 });
  const transition: AcceptedCareerTransition = {
    id: "accepted_retire_now",
    proposalId: "retire_now",
    fromCareerStateId: currentCareer.id,
    nextCareerState: retired,
    effectiveAtAgeInMonths: 660,
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const ledger = initializeFinancialLedger({
    id: "retirement_atomicity",
    asOfAgeInMonths: 659,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
      incomeSources: [
        { id: "salary", type: "salary", displayName: "工资", monthlyNetAmountWan: 3, accrualPolicy: "monthly", activeFromAgeInMonths: 600, status: "active", linkedCareerStateId: currentCareer.id, factStatus: "known", evidence },
        { id: "rent", type: "rent", displayName: "租金", monthlyNetAmountWan: 1, accrualPolicy: "monthly", activeFromAgeInMonths: 600, status: "active", factStatus: "known", evidence }
      ]
    }
  });
  return { currentCareer, transition, ledger };
}

test("retirement is held pending when its linked wage source is not closed", () => {
  const current = fixture();
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [current.transition],
    financialEvents: [],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.equal(result.issues[0].code, "CAREER_INCOME_CONFLICT");
  assert.deepEqual(result.issues[0].relatedIncomeSourceIds, ["salary"]);
});

test("retirement and linked wage closure commit as a group while rent remains untouched", () => {
  const current = fixture();
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_salary",
    proposalId: "end_salary_proposal",
    kind: "income_source_ended",
    effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [current.transition],
    financialEvents: [endSalary],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 1);
  assert.deepEqual(result.acceptedFinancialEvents.map((event) => event.payload), [{ incomeSourceId: "salary" }]);
  assert.equal(result.issues.length, 0);
});

test("consultant transition is held when the old wage closes without a next-career income", () => {
  const current = fixture();
  const consultant: AcceptedCareerTransition = {
    ...current.transition,
    id: "accepted_consultant",
    proposalId: "consultant",
    nextCareerState: { ...current.transition.nextCareerState, id: "career_consultant", employmentStatus: "self_employed", occupation: "顾问" }
  };
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_salary", proposalId: "end_salary_proposal", kind: "income_source_ended", effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" }, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [consultant],
    financialEvents: [endSalary],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.equal(result.acceptedFinancialEvents.length, 0);
  assert.match(result.issues[0].summary, /新 CareerState/);
});

test("consultant transition and adjusted wage migrate as one atomic group", () => {
  const current = fixture();
  const nextCareerState = { ...current.transition.nextCareerState, id: "career_consultant", employmentStatus: "self_employed" as const, occupation: "顾问" };
  const consultant: AcceptedCareerTransition = {
    ...current.transition, id: "accepted_consultant", proposalId: "consultant", nextCareerState
  };
  const adjusted: AcceptedFinancialEvent<"income_source_adjusted"> = {
    id: "adjust_salary", proposalId: "adjust_salary_proposal", kind: "income_source_adjusted", effectiveAtAgeInMonths: 660,
    payload: {
      incomeSourceId: "salary",
      nextSource: { ...current.ledger.incomeSources[0], monthlyNetAmountWan: 1.5, linkedCareerStateId: nextCareerState.id }
    },
    evidence, acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [consultant],
    financialEvents: [adjusted],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 1);
  assert.equal(result.acceptedFinancialEvents.length, 1);
  assert.equal(result.issues.length, 0);
});

test("one exact evidence sentence cannot open two identical career income sources", () => {
  const current = fixture();
  const exactEvidence: FinancialEvidence[] = [{
    ...evidence[0],
    excerpt: "你开始接下一家教育科技公司的远程兼职咨询，税后月薪1.8万元。"
  }];
  const source = {
    type: "contract" as const,
    displayName: "远程兼职咨询收入",
    monthlyNetAmountWan: 1.8,
    accrualPolicy: "monthly" as const,
    activeFromAgeInMonths: 331,
    status: "active" as const,
    linkedCareerStateId: current.currentCareer.id,
    factStatus: "known" as const,
    evidence: exactEvidence
  };
  const events: AcceptedFinancialEvent<"income_source_started">[] = [
    {
      id: "accepted_selected",
      proposalId: "selected_personal_income_331",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 331,
      payload: { ...source, id: "career_income_generic", displayName: "用户确认的个人工资" },
      evidence: exactEvidence,
      acceptedByReasonCodes: ["TEST"]
    },
    {
      id: "accepted_model",
      proposalId: "consulting_income_331",
      kind: "income_source_started",
      effectiveAtAgeInMonths: 331,
      payload: { ...source, id: "consulting_income_331" },
      evidence: exactEvidence,
      acceptedByReasonCodes: ["TEST"]
    }
  ];
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [],
    financialEvents: events,
    ageInMonths: 380
  });
  assert.deepEqual(result.acceptedFinancialEvents.map((event) => event.proposalId), ["consulting_income_331"]);
});

test("PB-CAREER-01 explicit personal income prose requires an Accepted income event", () => {
  const current = fixture();
  const missing = collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "工作室逐渐稳定，你的个人税后年收入约28万元。",
    acceptedFinancialEvents: [],
    ageInMonths: 660
  });
  assert.equal(missing.length, 1);
  assert.equal(missing[0].code, "CAREER_INCOME_CONFLICT");

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "一位老客户办了工作坊，对方当场付了5000元咨询费。线上课程已有付费学员，行业咨询也接到了两三个小单子。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "咨询业务积累了一些客户，你因此多了一条收入来源。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "一个月卖出了14份，收入不到三千元。你帮客户梳理话术，收了五千元。咨询业务已经积累了26个付费咨询客户。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你接下了内部分享。这笔收入不多，但咨询带来一笔额外的现金流。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你开始每周抽两个晚上接咨询，每次收费800元。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "课程销量依然不算高，但企业客户开始询问内训。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "这些尝试开始获得现实反馈，但个人收入是否形成仍需继续观察。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 0);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "客户提出采购内部培训并介绍团队咨询。这笔订单带来了稳定收入。咨询业务形成每月3-4单的稳定节奏，现金流稳定，主业依然是收入基本盘。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "开课后你根据学员反馈调整节奏。课程结束时十几位学员给出评价。这次尝试虽然没有带来多少收入，却像另一种收入来源。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "有公司请你做内部分享，你按次收取费用。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "老周提前支付的两万元分成垫付了当月还款。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "公司的课程平台已有付费学员，企业客户回款进入公司账户。",
    acceptedFinancialEvents: [],
    ageInMonths: 660,
    currentLedger: current.ledger
  }).length, 0);

  const longFormMissing = collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你以每周10-15小时的节奏接下一家企业的供应链优化顾问合同，税后月薪1.5万。你给自己发了1万元作为个人提款。",
    acceptedFinancialEvents: [],
    ageInMonths: 660
  });
  assert.equal(longFormMissing.length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "半年内总营收13万元，扣除开发成本和基本生活费，个人净收入仅4万元。",
    acceptedFinancialEvents: [],
    ageInMonths: 660
  }).length, 1);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你辞去了年薪38万元的供应链产品经理职位，开始全职创业。",
    acceptedFinancialEvents: [],
    ageInMonths: 660
  }).length, 0);

  const companyOnly = collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "公司年营业收入达到280万元，但你明确暂不领取个人工资或提款。",
    acceptedFinancialEvents: [],
    ageInMonths: 660
  });
  assert.equal(companyOnly.length, 0);

  const acceptedOwnerDraw: AcceptedFinancialEvent<"income_source_started"> = {
    id: "accepted_owner_draw",
    proposalId: "owner_draw",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 660,
    payload: {
      id: "owner_draw_income", type: "self_employment_draw", displayName: "业主提款",
      monthlyNetAmountWan: 28 / 12, accrualPolicy: "monthly", activeFromAgeInMonths: 660,
      status: "active", linkedCareerStateId: current.currentCareer.id, factStatus: "known", evidence
    },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你的个人税后年收入约28万元。",
    acceptedFinancialEvents: [acceptedOwnerDraw],
    ageInMonths: 660
  }).length, 0);

  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你的个人税后年收入约为36万元。",
    acceptedFinancialEvents: [],
    ageInMonths: 661,
    currentLedger: current.ledger
  }).length, 0);

  const quarantinedLedger = {
    ...current.ledger,
    incomeSources: current.ledger.incomeSources.map((source) => (
      source.id === "salary"
        ? { ...source, accrualReviewStatus: "quarantined" as const, factStatus: "needs_review" as const }
        : source
    ))
  };
  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: "你的个人税后年收入约为36万元。",
    acceptedFinancialEvents: [],
    ageInMonths: 662,
    currentLedger: quarantinedLedger
  }).length, 1);
});

test("PB-CAREER-01a company and product traction are not personal compensation", () => {
  const companyOrProductOnly = [
    "公司的产品已有至少三个付费客户，销售团队正在复盘转化路径。",
    "产品完成第一轮迭代，签约了两家付费试用客户，但公司尚未实现盈利。",
    "客户对平台给出积极反馈，并明确表达了续约意向。"
  ];

  for (const narrativeText of companyOrProductOnly) {
    assert.equal(narrativeClaimsNewPersonalIncomeActivity(narrativeText), false, narrativeText);
    assert.equal(collectPersonalIncomeNarrativeContractIssues({
      narrativeText,
      acceptedFinancialEvents: [],
      ageInMonths: 660
    }).length, 0, narrativeText);
  }

  assert.equal(narrativeClaimsNewPersonalIncomeActivity(
    "你开始每周抽两个晚上接咨询，每次收费800元。"
  ), true);
  assert.equal(narrativeClaimsNewPersonalIncomeActivity(
    "一位老客户办了工作坊，对方当场付了5000元咨询费。"
  ), true);
  // A client purchasing the protagonist's training/consulting is still a
  // commercial completion claim. It must not be mistaken for product traction
  // merely because the same sentence also mentions a company.
  assert.equal(narrativeClaimsNewPersonalIncomeActivity(
    "客户主动提出采购内部培训，并介绍了一家初创公司做团队咨询。"
  ), true);
});

test("PB-CAREER-01b explicit personal compensation overrides organization traction", () => {
  const mixedOrganizationAndNewPersonalCompensation = [
    "公司的产品已有至少三个付费客户，你每月收到1.2万元税后工资。",
    "平台签约了两家付费试用客户，你收到5000元顾问费作为个人服务报酬。"
  ];

  for (const narrativeText of mixedOrganizationAndNewPersonalCompensation) {
    assert.equal(narrativeClaimsNewPersonalIncomeActivity(narrativeText), true, narrativeText);
    assert.equal(collectPersonalIncomeNarrativeContractIssues({
      narrativeText,
      acceptedFinancialEvents: [],
      ageInMonths: 660
    }).length, 1, narrativeText);
  }

  const mixedOrganizationAndCurrentPersonalIncome = "团队已经获得续约意向，你的个人收入稳定在2万元/月。";
  assert.equal(narrativeClaimsExplicitPersonalIncome(mixedOrganizationAndCurrentPersonalIncome), true);
  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: mixedOrganizationAndCurrentPersonalIncome,
    acceptedFinancialEvents: [],
    ageInMonths: 660
  }).length, 1);
});

test("PB-CAREER-01c conditional and forecast income language is not completed personal income", () => {
  const hypotheticalOrForecastOnly = [
    "你重新算了算，如果保留大公司的工作，同时严格控制业余项目的投入，现金流可以维持稳定，但项目进展会慢下来；如果减少大公司的工时，则要接受更低的收入。",
    "若签约成功，咨询收入预计每月增加5000元。",
    "如果接受新岗位，你的个人收入稳定在2万元/月。",
    "收入预期变化会让贷款审批更复杂。"
  ];

  for (const narrativeText of hypotheticalOrForecastOnly) {
    assert.equal(narrativeClaimsNewPersonalIncomeActivity(narrativeText), false, narrativeText);
    assert.equal(narrativeClaimsExplicitPersonalIncome(narrativeText), false, narrativeText);
    assert.equal(collectPersonalIncomeNarrativeContractIssues({
      narrativeText,
      acceptedFinancialEvents: [],
      ageInMonths: 660
    }).length, 0, narrativeText);
  }

  const actualReceipt = "客户已经结算，你收到5000元顾问费作为个人服务报酬。";
  assert.equal(narrativeClaimsNewPersonalIncomeActivity(actualReceipt), true);
  assert.equal(collectPersonalIncomeNarrativeContractIssues({
    narrativeText: actualReceipt,
    acceptedFinancialEvents: [],
    ageInMonths: 660
  }).length, 1);
});

test("PB-CAREER-02 resignation, old wage closure, and new owner draw commit atomically", () => {
  const current = fixture();
  const nextCareerState = initializeCareerState({ id: "career_studio", employmentStatus: "self_employed", occupation: "工作室负责人", effectiveFromAgeInMonths: 660 });
  const transition: AcceptedCareerTransition = {
    ...current.transition,
    id: "accepted_start_studio",
    proposalId: "start_studio",
    nextCareerState
  };
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_salary", proposalId: "end_salary_proposal", kind: "income_source_ended", effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" }, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const ownerDraw: AcceptedFinancialEvent<"income_source_started"> = {
    id: "start_owner_draw", proposalId: "owner_draw_proposal", kind: "income_source_started", effectiveAtAgeInMonths: 660,
    payload: {
      id: "owner_draw", type: "self_employment_draw", displayName: "业主提款", monthlyNetAmountWan: 2,
      accrualPolicy: "monthly", activeFromAgeInMonths: 660, status: "active",
      linkedCareerStateId: nextCareerState.id, factStatus: "known", evidence
    },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [transition],
    financialEvents: [endSalary, ownerDraw],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 1);
  assert.deepEqual(result.acceptedFinancialEvents.map((event) => event.id), ["end_salary", "start_owner_draw"]);
  assert.equal(result.issues.length, 0);
});

test("PB-CAREER-03 a founder can become self-employed before taking personal income", () => {
  const current = fixture();
  const nextCareerState = initializeCareerState({
    id: "career_founder",
    employmentStatus: "self_employed",
    occupation: "创业者",
    effectiveFromAgeInMonths: 660
  });
  const transition: AcceptedCareerTransition = {
    ...current.transition,
    id: "accepted_start_company",
    proposalId: "start_company",
    nextCareerState
  };
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_salary", proposalId: "end_salary_proposal", kind: "income_source_ended", effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" }, evidence, acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [transition],
    financialEvents: [endSalary],
    ageInMonths: 660,
    personalIncomeClaimed: false
  });
  assert.equal(result.acceptedCareerTransitions.length, 1);
  assert.deepEqual(result.acceptedFinancialEvents.map((event) => event.id), ["end_salary"]);
  assert.equal(result.issues.length, 0);
});

test("PB-CAREER-15 income cannot rebind to a CareerState that was not committed", () => {
  const current = fixture();
  const orphanAdjustment: AcceptedFinancialEvent<"income_source_adjusted"> = {
    id: "adjust_salary_to_orphan_career",
    proposalId: "adjust_salary_to_orphan_career_proposal",
    kind: "income_source_adjusted",
    effectiveAtAgeInMonths: 660,
    payload: {
      incomeSourceId: "salary",
      nextSource: {
        ...structuredClone(current.ledger.incomeSources[0]),
        linkedCareerStateId: "career_consulting"
      }
    },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [],
    financialEvents: [orphanAdjustment],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.equal(result.acceptedFinancialEvents.length, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "CAREER_INCOME_CONFLICT");
  assert.deepEqual(result.issues[0].relatedProposalIds, ["adjust_salary_to_orphan_career_proposal"]);
  assert.match(result.issues[0].summary, /career_consulting/);
});

test("an orphan income closure cannot erase the last wage of an employed CareerState", () => {
  const current = fixture();
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "orphan_end_salary",
    proposalId: "orphan_end_salary_proposal",
    kind: "income_source_ended",
    effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [],
    financialEvents: [endSalary],
    ageInMonths: 660
  });
  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.deepEqual(result.acceptedFinancialEvents, []);
});

test("a same-career salary replacement can close the old wage without a CareerTransition", () => {
  const current = fixture();
  const endSalary: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "replace_end_salary",
    proposalId: "replace_end_salary_proposal",
    kind: "income_source_ended",
    effectiveAtAgeInMonths: 660,
    payload: { incomeSourceId: "salary" },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const startReplacement: AcceptedFinancialEvent<"income_source_started"> = {
    id: "replace_start_salary",
    proposalId: "replace_start_salary_proposal",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 660,
    payload: {
      id: "replacement_salary",
      type: "salary",
      displayName: "调整后的工资",
      monthlyNetAmountWan: 3.5,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 660,
      status: "active",
      linkedCareerStateId: current.currentCareer.id,
      factStatus: "known",
      evidence
    },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [],
    financialEvents: [endSalary, startReplacement],
    ageInMonths: 660
  });
  assert.deepEqual(result.acceptedFinancialEvents.map((event) => event.id), [
    "replace_end_salary",
    "replace_start_salary"
  ]);
});

test("an employed transition is rejected when its new salary is ended again in the same candidate", () => {
  const current = fixture();
  const nextCareerState = initializeCareerState({
    id: "career_promoted",
    employmentStatus: "employed",
    occupation: "区域负责人",
    effectiveFromAgeInMonths: 660
  });
  const transition: AcceptedCareerTransition = {
    ...current.transition,
    id: "accepted_promotion",
    proposalId: "promotion",
    nextCareerState
  };
  const endOld: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_old_salary", proposalId: "end_old_salary_proposal", kind: "income_source_ended",
    effectiveAtAgeInMonths: 660, payload: { incomeSourceId: "salary" }, evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const startNew: AcceptedFinancialEvent<"income_source_started"> = {
    id: "start_new_salary", proposalId: "start_new_salary_proposal", kind: "income_source_started",
    effectiveAtAgeInMonths: 660,
    payload: {
      id: "new_salary", type: "salary", displayName: "新工资", monthlyNetAmountWan: 5,
      accrualPolicy: "monthly", activeFromAgeInMonths: 660, status: "active",
      linkedCareerStateId: nextCareerState.id, factStatus: "known", evidence
    },
    evidence,
    acceptedByReasonCodes: ["TEST"]
  };
  const endNew: AcceptedFinancialEvent<"income_source_ended"> = {
    id: "end_new_salary", proposalId: "end_new_salary_proposal", kind: "income_source_ended",
    effectiveAtAgeInMonths: 660, payload: { incomeSourceId: "new_salary" }, evidence,
    acceptedByReasonCodes: ["TEST"]
  };

  const result = reconcileCareerIncomeAtomicity({
    currentCareerStateId: current.currentCareer.id,
    currentLedger: current.ledger,
    careerTransitions: [transition],
    financialEvents: [endOld, startNew, endNew],
    ageInMonths: 660
  });

  assert.equal(result.acceptedCareerTransitions.length, 0);
  assert.deepEqual(result.acceptedFinancialEvents, []);
  assert.match(result.issues[0].summary, /实际 0 个/);
});
