import assert from "node:assert/strict";
import test from "node:test";
import { FinancialState, type SimulationNode } from "../types";
import { getFinancialStatusText, sanitizeFinancialNarrative, sanitizeOpeningFinancialTitle, sanitizeSimulationNodeFinancialNarrative, sanitizeUnsupportedFinancialCoverageClaims, validateDebtNarrativeConsistency } from "./financialNarrative";
import { initializeFinancialLedger } from "../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../domain/finance/ledgerMath";

const state: FinancialState = {
  currencyUnit: "CNY_WAN_REAL",
  asOfAgeInMonths: 40 * 12,
  cashWan: 6,
  investmentAssetsWan: 0,
  propertyMarketValueWan: 0,
  businessAndOtherAssetsWan: 0,
  totalDebtWan: 0,
  netWorthWan: 6,
  annualAfterTaxIncomeWan: 18,
  annualDisposableIncomeWan: 6,
  annualCoreExpenseWan: 12,
  employmentStatus: "employed",
  incomeStability: "stable",
  isEstimated: true
};

test("replaces precise current savings and balance totals", () => {
  assert.equal(
    sanitizeFinancialNarrative("目前存款约90万，但工作仍有风险。", state),
    "目前仍有一定现金缓冲，但工作仍有风险。"
  );
  assert.equal(
    sanitizeFinancialNarrative("存款从45万降至42万，现金流开始紧张。", state),
    "持续支出正在消耗现金缓冲，现金流开始紧张。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你看着银行余额里仅剩的800元，心里发紧。", state),
    "你看着仍有一定现金缓冲，心里发紧。"
  );
  assert.equal(
    sanitizeFinancialNarrative("净资产达到200万后，你开始重新规划生活。", state),
    "仍有一定现金缓冲后，你开始重新规划生活。"
  );
  assert.equal(
    sanitizeFinancialNarrative("存款因收入增加，目前约90万，但职业仍有风险。", state),
    "仍有一定现金缓冲，但职业仍有风险。"
  );
  assert.equal(
    sanitizeFinancialNarrative("消费贷到期后，现金还剩35.4万。", state),
    "消费贷到期后，仍有一定现金缓冲。"
  );
  assert.equal(
    sanitizeFinancialNarrative("备用金从35万降到了25万，现金流开始紧张。", state),
    "持续支出正在消耗现金缓冲，现金流开始紧张。"
  );
  assert.equal(
    sanitizeFinancialNarrative("备用金从三十五万降到二十八万，现金流开始紧张。", state),
    "持续支出正在消耗现金缓冲，现金流开始紧张。"
  );
  assert.equal(
    sanitizeFinancialNarrative("备用金以每月2万元的速度消耗，压力加重。", state),
    "持续支出正在消耗现金缓冲。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你手里还有约20万元存款，但这笔钱不足以让你忽视眼前风险。", state),
    "仍有一定现金缓冲，但这笔钱不足以让你忽视眼前风险。"
  );
});

test("preserves salary, expenses and transaction amounts", () => {
  const description = "月薪2万，房租5000元，本月支付医疗费3万，并用存款支付60万首付、办理120万贷款。";
  assert.equal(sanitizeFinancialNarrative(description, state), description);
  assert.equal(
    sanitizeFinancialNarrative("你们把备用金中的15万元作为启动资金。", state),
    "你们把备用金中的15万元作为启动资金。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你个人已从备用金中支取了8万元用于公司运营（作为股东借款）。", state),
    "你个人已从备用金中支取了8万元用于公司运营（作为股东借款）。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你们靠着35万元备用金和房贷压力，白天跑客户。", state),
    "你们在有限现金缓冲和房贷压力下，白天跑客户。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你们用各自12万元积蓄作为启动资金，租了一间共享办公室。", state),
    "你们各自投入了一笔启动资金，租了一间共享办公室。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你已用20万元存款支付首付，剩余资金继续留作周转。", state),
    "你已用20万元存款支付首付，剩余资金继续留作周转。"
  );
  assert.equal(
    sanitizeFinancialNarrative("外包确实带来了持续支出正在消耗现金缓冲的税后工资。", state),
    "外包确实带来了已经到账的个人税后收入。"
  );
  assert.equal(
    sanitizeFinancialNarrative("对方查看了你的工资流水和公司现金流情况，但要求补齐5.6万元利息中的2万元。", state),
    "对方查看了你的工资流水和公司现金流情况，但要求补齐5.6万元利息中的2万元。"
  );
  assert.equal(
    sanitizeFinancialNarrative("公司账上现金约20万元，仍需控制运营成本。", state),
    "公司账上现金约20万元，仍需控制运营成本。"
  );
  const fundingGap = "首付需要100万，双方家庭能出50万，加上现有存款，还差约50万。";
  assert.equal(sanitizeFinancialNarrative(fundingGap, state), fundingGap);

  const debtLedger = {
    ...initializeFinancialLedger({ id: "debt_narrative", asOfAgeInMonths: 480 }),
    debtAccounts: [{
      id: "mortgage",
      type: "mortgage" as const,
      displayName: "房贷",
      principalWan: 60,
      openedAtAgeInMonths: 300,
      status: "active" as const,
      repaymentPolicy: { mode: "known_schedule" as const, monthlyPaymentWan: 0.7 },
      factStatus: "known" as const,
      evidence: [],
      consecutiveMissedPaymentMonths: 10
    }]
  };
  assert.equal(
    sanitizeFinancialNarrative("房贷已连续九个月未还。", state, debtLedger),
    "房贷已连续10个月未还。"
  );
  assert.equal(
    sanitizeFinancialNarrative("银行记录显示已有两期逾期记录。", state, debtLedger),
    "银行记录显示已有10期逾期记录。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你已连续拖欠贷款三个月。", state, debtLedger),
    "你已连续拖欠贷款10个月。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你已经连续8个月未能足额偿还。", state, debtLedger),
    "你已经连续10个月未能足额偿还。"
  );
  const interestLedger = {
    ...debtLedger,
    debtAccounts: debtLedger.debtAccounts.map((account) => ({
      ...account,
      repaymentPolicy: { ...account.repaymentPolicy, monthlyInterestWan: 0.425 }
    }))
  };
  assert.equal(
    sanitizeFinancialNarrative("房贷每月利息近8000元。", state, interestLedger),
    "房贷当前每月计划利息为0.43万元。"
  );
  const health = { source: "authoritative_ledger" as const, level: "default_risk" as const } as any;
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "房贷连续九个月未还，罚息复利滚大，求职也因征信被拒，感觉人生彻底失败。",
    debtHealthState: health,
    ledger: debtLedger
  }), [
    "模型不能在 closing ledger 提交前自行断言连续拖欠的精确月数",
    "账本没有罚息或复利事实，不能自行添加惩罚性费用",
    "没有正式违约事实，不能把工作或生活机会被拒归因于征信",
    "债务压力不能被写成人格或人生失败"
  ]);
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "房贷已连续10个月未还，银行发来通知并邀请协商。",
    debtHealthState: health,
    ledger: debtLedger,
    allowExactServicingCount: true
  }), []);
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "银行表示将移交催收部门，并开始每周拨打催收电话。",
    debtHealthState: health,
    ledger: debtLedger,
    allowExactServicingCount: true
  }), ["没有正式违约事实，不能写催收升级或强制处置已经发生"]);
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "信函表示将移交法务部门。",
    debtHealthState: health,
    ledger: debtLedger,
    allowExactServicingCount: true
  }), ["没有正式违约事实，不能写催收升级或强制处置已经发生"]);
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "银行表示逾期记录已经上报征信。",
    debtHealthState: health,
    ledger: debtLedger,
    allowExactServicingCount: true
  }), ["没有正式违约事实，不能写征信后果已经发生"]);
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "银行说这笔记录会影响未来信贷。",
    debtHealthState: health,
    ledger: debtLedger,
    allowExactServicingCount: true
  }), ["没有正式违约事实，不能写征信后果已经发生"]);
  assert.deepEqual(validateDebtNarrativeConsistency({
    description: "你第一次被迫逾期了贷款月供。",
    debtHealthState: { ...health, consecutiveMissedPaymentMonths: 10 },
    ledger: debtLedger,
    allowExactServicingCount: true
  }), ["已有连续拖欠事实，不能把本轮写成第一次或首次逾期"]);
});

test("a rejected informal debt amount cannot remain beside the authoritative total", () => {
  assert.equal(
    sanitizeFinancialNarrative("你已经欠下10万元个人债务，仍在安排还款。", { ...state, totalDebtWan: 199.5 }),
    "个人总负债为199.5万元，仍在安排还款。"
  );
  assert.equal(
    sanitizeFinancialNarrative("个人账户4万多，负债仍是203万。", { ...state, cashWan: 0, totalDebtWan: 216.8755, netWorthWan: -216.8755 }),
    "整体仍处于负债状态，个人总负债为216.88万元。"
  );
  assert.equal(
    sanitizeFinancialNarrative("到这一阶段结束时，你仍有53.375万元个人债务需要处理。", { ...state, totalDebtWan: 53.375 }),
    "到这一阶段结束时，个人总负债为53.38万元需要处理。"
  );
});

test("unconfirmed personal draws and assumed family members do not reach the story", () => {
  const ledger = initializeFinancialLedger({ id: "no_draw", asOfAgeInMonths: 400 });
  assert.equal(
    sanitizeFinancialNarrative("你个人只从公司支取了很少的生活费，房贷靠积蓄和妻子（假设有）的工资撑着。", state, ledger),
    "你们继续根据实际现金流调整家庭支出与储蓄安排。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你给自己开1.5万月薪以覆盖基本生活，公司账上还剩20万。", { ...state, annualAfterTaxIncomeWan: 0 }, ledger, []),
    "公司账上还剩20万。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你不得已动用了35万积蓄来还贷。", state, ledger, []),
    "你们继续根据实际现金流调整家庭支出与储蓄安排。"
  );
});

test("unsupported personal net income is rewritten while company progress remains qualitative", () => {
  const zeroIncomeState = { ...state, annualAfterTaxIncomeWan: 0 };
  const text = sanitizeFinancialNarrative(
    "半年内总营收13万元，扣除开发成本和基本生活费，个人净收入仅4万元。",
    zeroIncomeState,
    initializeFinancialLedger({ id: "no_personal_income", asOfAgeInMonths: 480 }),
    []
  );
  assert.doesNotMatch(text, /个人净收入仅4万元/);
  assert.match(text, /半年内总营收13万元/);
});

test("unsupported dividend composition is removed while the authoritative salary total remains", () => {
  const salaryLedger = {
    ...initializeFinancialLedger({ id: "salary_only", asOfAgeInMonths: 480 }),
    incomeSources: [{
      id: "salary", type: "self_employment_draw" as const, displayName: "个人工资",
      monthlyNetAmountWan: 4, accrualPolicy: "monthly" as const, activeFromAgeInMonths: 470,
      status: "active" as const, linkedCareerStateId: "career", factStatus: "known" as const,
      evidence: [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }]
    }]
  };
  assert.equal(
    sanitizeFinancialNarrative("你的个人年税后收入约48万（工资+年底分红）。", { ...state, annualAfterTaxIncomeWan: 48 }, salaryLedger),
    "你的个人年税后收入约48万（已确认的个人工资）。"
  );
});

test("combined balance replacements cannot leave a financial-status grammar fragment", () => {
  assert.equal(
    sanitizeFinancialNarrative("你个人的持续支出正在消耗整体仍处于负债状态，房贷继续偿还。", { ...state, totalDebtWan: 20, netWorthWan: -14 }),
    "持续支出仍在消耗个人现金缓冲，房贷继续偿还。"
  );
  assert.equal(
    sanitizeFinancialNarrative("最初三个月，你们依靠整体仍处于负债状态备用金维持生活。", { ...state, totalDebtWan: 20, netWorthWan: -14 }),
    "最初三个月，你们依靠有限的现金缓冲维持生活。"
  );
});

test("an opening title cannot deny an explicit mortgage", () => {
  const ledger = {
    ...initializeFinancialLedger({ id: "opening_title", asOfAgeInMonths: 288 }),
    debtAccounts: [{
      id: "mortgage", type: "mortgage" as const, displayName: "房贷", principalWan: 210,
      openedAtAgeInMonths: 288, status: "active" as const,
      repaymentPolicy: { mode: "known_schedule" as const, monthlyPaymentWan: 1.3 },
      factStatus: "known" as const, evidence: [{ source: "user" as const, reasonCode: "TEST", confidence: 1 }]
    }]
  };
  assert.equal(sanitizeOpeningFinancialTitle("刚看到机会，房贷还没背", ledger), "房贷压力下的现实选择");
});

test("derives qualitative wording from the calculated state", () => {
  assert.equal(getFinancialStatusText(state), "仍有一定现金缓冲");
  assert.equal(getFinancialStatusText({ ...state, cashWan: 2 }), "现金流十分紧张");
  assert.equal(getFinancialStatusText({ ...state, netWorthWan: -2 }), "整体仍处于负债状态");
  assert.equal(getFinancialStatusText({ ...state, cashWan: 20 }), "已经积累了一些储蓄");
});

test("a current annual salary claim is removed when the closing ledger has no authoritative career income", () => {
  const noIncomeLedger = initializeFinancialLedger({ id: "no_income", asOfAgeInMonths: 526 });
  const result = sanitizeFinancialNarrative(
    "你正式调任区域总监，年薪升至60万。家庭生活保持稳定。",
    { ...state, annualAfterTaxIncomeWan: 0 },
    noIncomeLedger
  );
  assert.equal(result.includes("60万"), false);
  assert.match(result, /正式调任区域总监/);
  assert.doesNotMatch(result, /尚待确认|仍需观察/);
  const adjusted = sanitizeFinancialNarrative(
    "你被正式任命为ESG转型小组副负责人，年薪调整为36万元。",
    { ...state, annualAfterTaxIncomeWan: 0 },
    noIncomeLedger
  );
  assert.equal(adjusted.includes("36万"), false);
  assert.match(adjusted, /正式任命为ESG转型小组副负责人/);
  assert.doesNotMatch(adjusted, /尚待确认|仍需观察/);
});

test("rewrites an unsupported mortgage type without discarding real debt servicing", () => {
  const nonMortgageLedger = {
    ...initializeFinancialLedger({ id: "non_mortgage_debt", asOfAgeInMonths: 649 }),
    debtAccounts: [{
      id: "partner_art_loan",
      type: "family_or_personal_loan" as const,
      displayName: "伴侣艺术项目借款",
      principalWan: 3.8,
      openedAtAgeInMonths: 631,
      status: "active" as const,
      repaymentPolicy: { mode: "known_schedule" as const, monthlyPaymentWan: 0.22 },
      factStatus: "known" as const,
      evidence: []
    }]
  };
  assert.equal(
    sanitizeFinancialNarrative("你们用存款提前还了部分房贷，月供减少。", { ...state, totalDebtWan: 3.8 }, nonMortgageLedger),
    "你们用存款提前还了部分现有借款，每月还款压力减少。"
  );
  const noDebtLedger = initializeFinancialLedger({ id: "no_debt", asOfAgeInMonths: 649 });
  assert.equal(
    sanitizeFinancialNarrative("你们提前还了部分房贷，月供减少。", state, noDebtLedger),
    "你们继续根据实际现金流调整家庭支出与储蓄安排。"
  );
});

test("closing coverage blockers rewrite only the unsupported fact sentences", () => {
  const original = "你们买下了一套公寓。你背着房贷继续工作。公司承诺给你5%期权。你年薪调整为36万元。家人的生活节奏保持稳定。";
  const sanitized = sanitizeUnsupportedFinancialCoverageClaims(original, [
    "narrative_coverage_property_649",
    "narrative_coverage_mortgage_649",
    "narrative_coverage_personal_option_649",
    "narrative_coverage_personal_compensation_649"
  ]);
  assert.equal(sanitized, "家人的生活节奏保持稳定。");
});

test("missing personal-income authority rewrites paid workshops and consulting orders", () => {
  const original = "对方当场付了5000元咨询费。线上课程已有付费学员，课程销量依然不算高，行业咨询也接到了两三个小单子。这笔收入不多，但咨询带来一笔额外的现金流。你因此多了一条收入来源。你把案例整理成了方法论。";
  const sanitized = sanitizeUnsupportedFinancialCoverageClaims(original, [
    "personal_income_claim_without_event_406"
  ]);
  assert.doesNotMatch(sanitized, /5000元咨询费|这笔收入|额外的现金流|多了一条收入来源|尚待确认|仍需观察/u);
  assert.match(sanitized, /付费学员|课程销量|接到了两三个小单子/u);
  assert.match(sanitized, /案例整理成了方法论/u);
});

test("missing personal-income authority rewrites every unsupported commercial completion in one pass", () => {
  const original = "客户主动提出采购内部培训，并介绍了一家初创公司做团队咨询。这笔订单让我获得稳定收入。我逐步将收费调整为项目制。虽然金额不大，但现金流稳定。咨询业务已经形成每月3-4单的稳定节奏。开课后我根据学员反馈调整节奏。课程结束时十几位学员给出评价。这次尝试虽然没有带来多少收入。主业依然是收入基本盘。课程材料仍在继续打磨。";
  const sanitized = sanitizeUnsupportedFinancialCoverageClaims(original, [
    "personal_income_claim_without_event_406"
  ]);
  assert.match(sanitized, /采购内部培训|每月3-4单|开课后|十几位学员/u);
  assert.match(sanitized, /收费调整|没有带来多少收入/u);
  assert.doesNotMatch(sanitized, /稳定收入|现金流稳定|收入基本盘|尚待确认|仍需观察/u);
  assert.match(sanitized, /课程材料仍在继续打磨/u);
});

test("a generic protagonist annual-income claim is removed when the closing source is quarantined", () => {
  const quarantinedLedger = {
    ...initializeFinancialLedger({ id: "quarantined_income", asOfAgeInMonths: 454 }),
    incomeSources: [{
      id: "legacy_income", type: "salary" as const, displayName: "旧工资", annualNetAmountWan: 42,
      accrualPolicy: "annual" as const, activeFromAgeInMonths: 350, status: "active" as const,
      linkedCareerStateId: "career_current", factStatus: "needs_review" as const,
      accrualReviewStatus: "quarantined" as const, evidence: []
    }]
  };
  const result = sanitizeFinancialNarrative(
    "你已经在创新部门站稳脚跟，年收入稳定在52万左右，存款有所增加。",
    { ...state, annualAfterTaxIncomeWan: 0 },
    quarantinedLedger
  );
  assert.equal(result.includes("52万"), false);
  assert.match(result, /创新部门站稳脚跟/);
  assert.doesNotMatch(result, /尚待确认|仍需观察/);
});

test("closing-ledger debt counts sanitize every user-visible narrative surface", () => {
  const debtLedger = {
    ...initializeFinancialLedger({ id: "surface_counts", asOfAgeInMonths: 480 }),
    debtAccounts: [{
      id: "loan",
      type: "consumer_loan" as const,
      displayName: "贷款",
      principalWan: 10,
      openedAtAgeInMonths: 400,
      status: "active" as const,
      repaymentPolicy: { mode: "known_schedule" as const, monthlyPaymentWan: 1 },
      factStatus: "known" as const,
      evidence: [],
      consecutiveMissedPaymentMonths: 15
    }]
  };
  const result = sanitizeSimulationNodeFinancialNarrative({
    age: 40,
    ageInMonths: 480,
    stage: "压力",
    title: "压力",
    description: "连续10个月未能足额偿还。",
    descriptionParagraphs: ["连续10个月未能足额偿还。"],
    choices: [{ id: "A", text: "面对连续10个月未能足额偿还", impactSummary: "连续10个月未能足额支付" }],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false,
    narrativeMeta: {
      elapsedMonths: 5,
      elapsedYears: 5 / 12,
      lifeIntensity: "high_tension",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: {
        id: "episode",
        startAgeInMonths: 475,
        endAgeInMonths: 480,
        internalTransitions: [{ atAgeInMonths: 480, materiality: "meaningful_update", summary: "连续10个月未足额偿付", worldDeltas: [] }],
        decisionCheckpointId: "checkpoint",
        summary: "连续10个月未能足额偿还"
      },
      recoveryState: "depleted",
      recoveryEvidence: [],
      arcSignals: [{ type: "debt_pressure_persists", evidence: "连续10个月未能足额偿还", confidence: 0.9 }],
      activeCharacters: [],
      worldDeltas: []
    }
  }, state, debtLedger);
  assert.equal(JSON.stringify(result).includes("连续10个月"), false);
  assert.equal(JSON.stringify(result).includes("连续15个月"), true);
});

test("closing debt totals, unpaid interest and current payment ignore opening-period wording", () => {
  const debtLedger = {
    ...initializeFinancialLedger({ id: "closing_debt_values", asOfAgeInMonths: 480 }),
    debtAccounts: [{
      id: "mortgage", type: "mortgage" as const, displayName: "房贷", principalWan: 201.25,
      openedAtAgeInMonths: 300, status: "active" as const,
      repaymentPolicy: { mode: "known_schedule" as const, monthlyPaymentWan: 1.3 },
      factStatus: "known" as const, evidence: [], accruedUnpaidInterestWan: 17,
      consecutiveMissedPaymentMonths: 4, totalMissedPaymentMonths: 4, recentMissedPaymentAgeInMonths: []
    }, {
      id: "shortfall", type: "liquidity_shortfall" as const, displayName: "缺口", principalWan: 83.1352,
      openedAtAgeInMonths: 470, status: "active" as const,
      repaymentPolicy: { mode: "event_driven" as const }, factStatus: "known" as const, evidence: [],
      accruedUnpaidInterestWan: 0, consecutiveMissedPaymentMonths: 0, totalMissedPaymentMonths: 0, recentMissedPaymentAgeInMonths: []
    }]
  };
  assert.equal(
    sanitizeFinancialNarrative("总负债已经逼近280万，累计未付利息12.75万，期间按最低额1.1万还款。", state, debtLedger),
    "个人总负债为301.39万元，累计未付利息为17万元，期间当前每月计划还款为1.3万元。"
  );
});

test("rewrites monthly-versus-annual salary contradictions from the authoritative source", () => {
  const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];
  const ledger = initializeFinancialLedger({
    id: "salary_narrative",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 1, status: "active", factStatus: "known", evidence }],
      incomeSources: [{ id: "startup_salary", type: "salary", displayName: "创业公司工资", monthlyNetAmountWan: 1.25, accrualPolicy: "monthly", activeFromAgeInMonths: 289, status: "active", linkedCareerStateId: "career_startup", factStatus: "estimated", evidence }]
    }
  });
  assert.equal(
    sanitizeFinancialNarrative("你的月薪从22万降到15万，但仍决定加入。", state, ledger),
    "你的当前税后月薪约1.25万元，但仍决定加入。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你的年薪将从43万元调整至48万元左右，税后月薪约0.4万元。", state, ledger),
    "你的当前税后年薪约15万元，税后月薪约1.25万元。"
  );
  assert.equal(
    sanitizeFinancialNarrative("到年底，你个人累计债务约18万元，公司仍在融资。", { ...state, totalDebtWan: 44.6651 }, ledger),
    "到年底，你个人总负债为44.67万元，公司仍在融资。"
  );
});

test("does not render a quarantined career income as current personal salary", () => {
  const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];
  const ledger = initializeFinancialLedger({
    id: "quarantined_salary_narrative",
    asOfAgeInMonths: 660,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 1, status: "active", factStatus: "known", evidence }],
      incomeSources: [{
        id: "stale_salary",
        type: "salary",
        displayName: "旧工资",
        monthlyNetAmountWan: 1.67,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: 500,
        status: "active",
        linkedCareerStateId: "career_old",
        factStatus: "needs_review",
        accrualReviewStatus: "quarantined",
        evidence
      }]
    }
  });
  assert.equal(
    sanitizeFinancialNarrative("你的月薪1.67万元仍在继续，但这笔收入已经很久没有确认。", { ...state, annualAfterTaxIncomeWan: 0 }, ledger),
    ""
  );
});

test("canonical financial fallback copy is rendered at most once", () => {
  const ledger = initializeFinancialLedger({
    id: "dedupe_canonical_fallback",
    asOfAgeInMonths: 660,
    openingPosition: {
      incomeSources: []
    }
  });
  const sentence = "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。";
  assert.equal(
    sanitizeFinancialNarrative(`${sentence}${sentence}你的生活仍在继续。${sentence}`, { ...state, annualAfterTaxIncomeWan: 0 }, ledger),
    "你的生活仍在继续。"
  );
  const rejectedDebtFallback = "你尝试申请借款，但这次尚未形成已经到账的结果。";
  assert.equal(
    sanitizeFinancialNarrative(`${rejectedDebtFallback}你继续安排生活。${rejectedDebtFallback}`, state, ledger),
    `${rejectedDebtFallback}你继续安排生活。`
  );
});

test("whole-node financial cleanup is idempotent and removes legacy income templates across paragraphs", () => {
  const ledger = initializeFinancialLedger({ id: "whole_node_idempotence", asOfAgeInMonths: 660 });
  const input = {
    age: 55,
    ageInMonths: 660,
    stage: "经营复盘",
    title: "下一阶段",
    description: "你完成了客户访谈。\n\n这些尝试开始获得现实反馈，但个人收入是否形成仍需继续观察。\n\n你把访谈结论整理成产品清单。",
    descriptionParagraphs: [
      "你完成了客户访谈。",
      "这些尝试开始获得现实反馈，但个人收入是否形成仍需继续观察。",
      "你把访谈结论整理成产品清单。"
    ],
    choices: [
      { id: "A", text: "继续验证客户需求", impactSummary: "验证需求" },
      { id: "B", text: "暂停并复盘", impactSummary: "控制节奏" },
      { id: "C", text: "转向另一个细分场景", impactSummary: "调整方向" }
    ],
    attributes: { happiness: 50, intelligence: 60, wealth: 55, relation: 50, health: 58 },
    isEndingNode: false
  } as SimulationNode;
  const once = sanitizeSimulationNodeFinancialNarrative(input, { ...state, annualAfterTaxIncomeWan: 0 }, ledger, []);
  const twice = sanitizeSimulationNodeFinancialNarrative(once, { ...state, annualAfterTaxIncomeWan: 0 }, ledger, []);
  assert.deepEqual(twice, once);
  assert.doesNotMatch(once.description, /尚待确认|仍需观察|尚未形成确定结果/u);
  assert.match(once.description, /完成了客户访谈|整理成产品清单/u);
});

test("runtime narrative boundary tolerates non-string model output", () => {
  assert.equal(sanitizeFinancialNarrative({ description: "非法对象" } as unknown as string, state), "");
  assert.equal(
    sanitizeFinancialNarrative(["第一段。", "第二段。"] as unknown as string, state),
    "第一段。\n\n第二段。"
  );
});

test("sub-wan amounts keep exact yuan meaning instead of leaking long wan decimals", () => {
  const sanitized = sanitizeFinancialNarrative(
    "小册子每本0.005万元，朋友借款还剩0.1435万元，年薪54.9996万元。",
    state
  );
  assert.equal(sanitized, "小册子每本50元，朋友借款还剩1435元，年薪55万元。");
  assert.doesNotMatch(sanitized, /\d+\.\d{3,}\s*万/u);
});
