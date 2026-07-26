import assert from "node:assert/strict";
import test from "node:test";
import { FinancialState } from "../types";
import { getFinancialStatusText, sanitizeFinancialNarrative, sanitizeOpeningFinancialTitle, sanitizeSimulationNodeFinancialNarrative, validateDebtNarrativeConsistency } from "./financialNarrative";
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
    "创业初期，个人可支配收入仍未形成稳定来源。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你给自己开1.5万月薪以覆盖基本生活，公司账上还剩20万。", { ...state, annualAfterTaxIncomeWan: 0 }, ledger, []),
    "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。"
  );
  assert.equal(
    sanitizeFinancialNarrative("你不得已动用了35万积蓄来还贷。", state, ledger, []),
    "你继续动用现金缓冲偿还房贷。"
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
  assert.match(text, /公司经营已有进展/);
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
  assert.match(result, /实际到账的个人收入尚待确认/);
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
    "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。"
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
