import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID } from "../../domain/finance/ledgerMath";
import type { FinancialEvidence } from "../../domain/finance/types";
import { buildFinancialProposalRepairPrompt, formatRestrictedFinancialLedger } from "./prompts";
import { buildDeterministicFinancialNarrativeRollback, extractMisplacedEmploymentTransition, isCompanyOperatingNarrativeProposal, resolveSelectedOutcomeId, settleRejectedFinancialProposalIssues, stillClaimsRejectedDebtDraw, stillClaimsRejectedDebtRestructure, synthesizeMissingBusinessHoldingStartProposal, synthesizeMissingDebtCompletionProposals, synthesizeSelectedCareerTransition, validateSelectedDecisionConsistency } from "./simulationService";
import type { HistoryItem } from "../../types";

const evidence: FinancialEvidence[] = [{ source: "accepted_history", reasonCode: "TEST", confidence: 1 }];
const ledger = initializeFinancialLedger({
  id: "repair_ledger",
  asOfAgeInMonths: 300,
  openingPosition: {
    cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }],
    incomeSources: [{
      id: "salary_main",
      type: "salary",
      displayName: "工资",
      monthlyNetAmountWan: 2,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: 300,
      status: "active",
      factStatus: "known",
      evidence
    }]
  }
});

test("restricted ledger summary exposes stable ids without exposing transaction history", () => {
  const summary = formatRestrictedFinancialLedger(ledger);
  assert.match(summary, /salary_main/);
  assert.match(summary, /primary_cash/);
  assert.doesNotMatch(summary, /recentTransactions/);
});

test("repair prompt supplies rejection reasons, period bounds and the unique outcome id", () => {
  const prompt = buildFinancialProposalRepairPrompt({
    rejectedProposals: [{
      id: "adjust_salary",
      kind: "income_source_adjusted",
      effectiveAtAgeInMonths: 312,
      payload: { incomeSourceId: undefined },
      sourceOutcomeId: "choice_1",
      evidence: "你正式涨薪到每月3万元。",
      confidence: 0.9
    }],
    issues: [{
      id: "issue_adjust_salary",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      relatedProposalIds: ["adjust_salary"],
      summary: "收入来源调整必须引用同一账户: undefined",
      createdAtAgeInMonths: 312
    }],
    ledger,
    acceptedOutcomeId: "choice_1",
    narrativeText: "你正式涨薪到每月3万元。",
    periodStartAgeInMonths: 300,
    periodEndAgeInMonths: 312
  });
  assert.match(prompt, /salary_main/);
  assert.match(prompt, /choice_1/);
  assert.match(prompt, /300 到 312/);
  assert.match(prompt, /收入来源调整必须引用同一账户/);
  assert.match(prompt, /不得省略 confidence/);
  assert.match(prompt, /逐字复制当前正文/);
  assert.match(prompt, /正文候选原句与金额锚/);
  assert.match(prompt, /你正式涨薪到每月3万元/);
  assert.match(prompt, /confidence 必须在 0.6-1 之间/);
  assert.match(prompt, /employmentTransition/);
  assert.match(prompt, /原子组/);
});

test("selected choices without eventOutcomeId receive a deterministic fallback authority id", () => {
  const history = [{
    age: 30,
    ageInMonths: 360,
    stage: "转折",
    title: "选择",
    description: "描述",
    selectedChoice: "此前选择",
    choices: [{ id: "A", text: "接受新的工作", impactSummary: "职业变化" }],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false
  }] as HistoryItem[];
  const first = resolveSelectedOutcomeId(history, "接受新的工作");
  const second = resolveSelectedOutcomeId(history, "接受新的工作");
  assert.match(first || "", /^choice_fallback_/);
  assert.equal(first, second);
});

test("custom decisions receive deterministic authority without masquerading as a preset choice", () => {
  const history = [{
    age: 30,
    ageInMonths: 360,
    stage: "经营",
    title: "现金流转折",
    description: "客户集中度开始显现风险。",
    selectedChoice: "此前选择",
    choices: [{ id: "A", text: "保持现状", impactSummary: "谨慎维持" }],
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    isEndingNode: false
  }] as HistoryItem[];
  const decision = "核心客户已经终止合同，本月起个人经营收入降至每月0.5万元";
  const first = resolveSelectedOutcomeId(history, decision);
  const second = resolveSelectedOutcomeId(history, decision);
  assert.match(first || "", /^custom_choice_/);
  assert.equal(first, second);
});

test("a borrowing decision cannot be rewritten as voluntarily refusing the loan", () => {
  assert.deepEqual(
    validateSelectedDecisionConsistency(
      "申请20万元经营贷购买设备",
      "你拒绝了贷款和扩张诱惑，决定继续轻资产经营。"
    ),
    ["用户已选择申请或使用借款，正文却改写成主角主动拒绝或未申请借款"]
  );
  assert.deepEqual(
    validateSelectedDecisionConsistency(
      "申请20万元经营贷购买设备",
      "你提交了贷款申请，但银行因材料不足拒绝放款，设备采购因此延期。"
    ),
    []
  );
});

test("loan balance and active monthly payment claims require an accepted debt draw", () => {
  assert.equal(stillClaimsRejectedDebtDraw("贷款还剩6期约3.65万元本金，月供0.6083万元。"), true);
  assert.equal(stillClaimsRejectedDebtDraw("贷款尚未获批，月供只是测算。"), false);
});

test("a rejected restructure cannot leave a confirmed repayment plan in the story", () => {
  assert.equal(stillClaimsRejectedDebtRestructure("银行表示可以申请先息后本，仍需等待审批。"), false);
  assert.equal(stillClaimsRejectedDebtRestructure("桌上放着银行寄来的新还款计划确认函。"), true);
  assert.equal(stillClaimsRejectedDebtRestructure("银行已同意展期五年。"), true);
  assert.equal(stillClaimsRejectedDebtRestructure("你咬着牙签了协议，月供暂时归零。"), true);
});

test("a reduced monthly payment is a completed restructure claim", () => {
  assert.equal(stillClaimsRejectedDebtRestructure("你终于去银行申请了房贷重组，把月供从1.3万元降到了9000元。"), true);
});

test("failed model rollback degrades rejected completion facts deterministically", () => {
  const paragraphs = buildDeterministicFinancialNarrativeRollback({
    rejectedProposals: [{
      id: "restructure_rejected",
      kind: "debt_restructured",
      effectiveAtAgeInMonths: 312,
      payload: {},
      evidence: "银行已经批准重组并把月供降至0.3万元。",
      confidence: 0.9
    }],
    acceptedEvents: [],
    narrativeText: "你继续处理工作。银行已经批准重组并把月供降至0.3万元。晚上你照常回家吃饭。"
  });
  assert.equal(paragraphs.length, 1);
  assert.match(paragraphs.join("\n"), /你继续处理工作/);
  assert.match(paragraphs.join("\n"), /晚上你照常回家吃饭/);
  assert.match(paragraphs.join("\n"), /尚未形成生效协议/);
  assert.doesNotMatch(paragraphs.join("\n"), /已经批准|降至0.3万元/);
});

test("rejected proposal diagnostics are closed after the proposal is not committed", () => {
  const [issue] = settleRejectedFinancialProposalIssues({
    issues: [{
      id: "proposal_issue_bad_repayment_300",
      code: "UNBALANCED_TRANSACTION",
      severity: "blocking",
      status: "open",
      relatedProposalIds: ["bad_repayment"],
      summary: "还款金额无效",
      createdAtAgeInMonths: 300
    }],
    acceptedProposalIds: [],
    rejectedProposalIds: ["bad_repayment"],
    ageInMonths: 300,
    narrativeRolledBack: true
  });
  assert.equal(issue.status, "resolved");
  assert.equal(issue.resolvedByEventId, "system:rejected_proposal_narrative_rollback");
});

test("unresolved authoritative facts are not hidden by proposal settlement", () => {
  const [issue] = settleRejectedFinancialProposalIssues({
    issues: [{
      id: "pending_fact_income_salary",
      code: "PENDING_FACT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      relatedIncomeSourceIds: ["salary"],
      summary: "当前工资需要确认",
      createdAtAgeInMonths: 300
    }],
    acceptedProposalIds: [],
    rejectedProposalIds: ["bad_salary_change"],
    ageInMonths: 300,
    narrativeRolledBack: true
  });
  assert.equal(issue.status, "open");
});

test("PB-NARR-16 rollback never renders custom-decision control text as a story paragraph", () => {
  const paragraphs = buildDeterministicFinancialNarrativeRollback({
    rejectedProposals: [{
      id: "restructure_rejected", kind: "debt_restructured", effectiveAtAgeInMonths: 312,
      payload: {}, evidence: "银行已经批准重组。", confidence: 0.8
    }],
    acceptedEvents: [{
      id: "accepted_income", proposalId: "selected_income", kind: "income_source_started", effectiveAtAgeInMonths: 300,
      payload: { id: "income", type: "self_employment_draw", displayName: "工资", monthlyNetAmountWan: 4, accrualPolicy: "monthly", activeFromAgeInMonths: 300, status: "active", factStatus: "known", evidence: [] },
      acceptedByReasonCodes: ["EVIDENCE_EXACT_MATCHED"],
      evidence: [{ source: "accepted_simulation_outcome", sourceEventId: "custom", excerpt: "自定义抉择: 从本月起公司向我的个人账户每月支付4万元税后工资。", reasonCode: "EVIDENCE_EXACT_MATCHED", confidence: 1 }]
    } as any],
    narrativeText: "银行已经批准重组。\n\n公司开始按决议发放个人工资。"
  });
  assert.doesNotMatch(paragraphs.join("\n"), /自定义抉择/u);
  assert.match(paragraphs.join("\n"), /尚未形成生效协议/u);
});

test("company operating facts survive rejection from the personal ledger", () => {
  assert.equal(isCompanyOperatingNarrativeProposal({
    id: "company_revenue",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 312,
    payload: {},
    evidence: "公司年收入达到12万元。",
    confidence: 0.9,
    financialScope: "personal"
  }), true);
  assert.equal(isCompanyOperatingNarrativeProposal({
    id: "personal_draw",
    kind: "income_source_started",
    effectiveAtAgeInMonths: 312,
    payload: {},
    evidence: "你开始领取每月2万元个人工资。",
    confidence: 0.9,
    financialScope: "personal"
  }), false);
  assert.equal(isCompanyOperatingNarrativeProposal({
    id: "duplicated_career",
    kind: "career_state" as any,
    effectiveAtAgeInMonths: 312,
    payload: {},
    evidence: "你已经辞职并开始创业。",
    confidence: 0.9
  }), true);
});

test("completed debt facts without proposals receive a repair-only placeholder", () => {
  const proposals = synthesizeMissingDebtCompletionProposals({
    proposals: [],
    narrativeText: "银行同意将贷款展期至60个月，月供已降至0.34万元。",
    acceptedOutcomeId: "choice_restructure",
    effectiveAtAgeInMonths: 409
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "debt_restructured");
  assert.equal(proposals[0].confidence, 0);
  assert.equal(proposals[0].sourceOutcomeId, "choice_restructure");
});

test("PB-BIZ-08 explicit company formation synthesizes an unpriced founder holding", () => {
  const ledger = initializeFinancialLedger({
    id: "business_start",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 35, status: "active", factStatus: "known", evidence: [] }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你全职投入供应链软件创业。",
    acceptedOutcomeId: "start_company",
    effectiveAtAgeInMonths: 306,
    ledger
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_started");
  assert.equal((proposals[0].payload as any).personalCashInvestedWan, 0);
});

test("PB-BIZ-08 replaces an unsupported invented founder contribution with an unpriced holding", () => {
  const current = initializeFinancialLedger({
    id: "founder_repair",
    asOfAgeInMonths: 288,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 35, status: "active", factStatus: "known", evidence: [] }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [{
      id: "invented_contribution",
      kind: "business_holding_started",
      effectiveAtAgeInMonths: 288,
      sourceOutcomeId: "accepted_startup",
      financialScope: "personal",
      evidence: "你和合伙人各投入5万元作为启动资金。",
      confidence: 0.9,
      payload: {
        sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID,
        personalCashInvestedWan: 5,
        businessHolding: {
          id: "invented_holding",
          business: { id: "invented_business", displayName: "公司", status: "operating", factStatus: "estimated", evidence: [] },
          personalCarryingValueWan: 5,
          status: "active",
          factStatus: "estimated",
          evidence: []
        }
      }
    }],
    narrativeText: "你辞去工作，和前同事一起创办了链达科技。",
    acceptedOutcomeId: "accepted_startup",
    effectiveAtAgeInMonths: 288,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_started");
  assert.equal((proposals[0].payload as any).personalCashInvestedWan, 0);
  assert.match(proposals[0].evidence, /创办了链达科技/);
});

test("PB-BIZ-26 a weak entrepreneurship thought cannot be holding evidence when the accepted choice is explicit", () => {
  const current = initializeFinancialLedger({ id: "founder_choice_evidence", asOfAgeInMonths: 288 });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [{
      id: "weak_holding",
      kind: "business_holding_started",
      effectiveAtAgeInMonths: 294,
      sourceOutcomeId: "start_company",
      financialScope: "personal",
      evidence: "颈椎和失眠问题加剧，你开始怀疑自己是否适合创业。",
      confidence: 0.9,
      payload: {
        personalCashInvestedWan: 0,
        businessHolding: {
          id: "weak", business: { id: "weak_business", displayName: "公司", status: "operating", factStatus: "known", evidence: [] },
          personalCarryingValueWan: 0, status: "active", factStatus: "known", evidence: []
        }
      }
    }],
    narrativeText: "颈椎和失眠问题加剧，你开始怀疑自己是否适合创业。",
    selectedDecision: "辞职创业，先用半年做出三个付费客户",
    acceptedOutcomeId: "start_company",
    effectiveAtAgeInMonths: 294,
    periodStartAgeInMonths: 288,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_started");
  assert.equal(proposals[0].evidence, "辞职创业，先用半年做出三个付费客户");
});

test("PB-BIZ-27 an option menu cannot replace the accepted startup decision as holding evidence", () => {
  const current = initializeFinancialLedger({ id: "founder_option_menu", asOfAgeInMonths: 288 });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你站在节点上，面前有三条路：继续全职创业；或者把创业降级为副业；还是彻底放弃创业。",
    selectedDecision: "辞职创业，先用半年做出三个付费客户",
    acceptedOutcomeId: "start_company",
    effectiveAtAgeInMonths: 299,
    periodStartAgeInMonths: 288,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_started");
  assert.equal(proposals[0].evidence, "辞职创业，先用半年做出三个付费客户");
});

test("PB-BIZ-12 an explicit ownership percentage creates an unpriced holding", () => {
  const current = initializeFinancialLedger({
    id: "ownership_capture",
    asOfAgeInMonths: 288,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 35, status: "active", factStatus: "known", evidence: [] }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "老张占55%，你占45%，所有收入先覆盖公司成本。",
    acceptedOutcomeId: "accepted_startup",
    effectiveAtAgeInMonths: 298,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal((proposals[0].payload as any).businessHolding.ownershipRate, 0.45);
  assert.equal((proposals[0].payload as any).businessHolding.personalCarryingValueWan, 0);
});

test("PB-BIZ-12 Chinese 占股 wording creates an unpriced holding", () => {
  const ledger = initializeFinancialLedger({ id: "ownership_capture_zh", asOfAgeInMonths: 330 });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你与合伙人签署正式协议，你占股60%，合伙人占股40%。",
    acceptedOutcomeId: "selected",
    effectiveAtAgeInMonths: 342,
    periodStartAgeInMonths: 330,
    ledger
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_started");
  assert.equal((proposals[0].payload as any).businessHolding.ownershipRate, 0.6);
});

test("PB-BIZ-25 Chinese 持有 wording creates an unpriced holding", () => {
  const ledger = initializeFinancialLedger({ id: "ownership_capture_holds", asOfAgeInMonths: 330 });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "公司经营逐渐稳定，你持有60%股权，合伙人持有40%。",
    acceptedOutcomeId: "selected",
    effectiveAtAgeInMonths: 342,
    periodStartAgeInMonths: 330,
    ledger
  });
  assert.equal(proposals.length, 1);
  assert.equal((proposals[0].payload as any).businessHolding.ownershipRate, 0.6);
});

test("PB-BIZ-13 an explicit ownership renegotiation updates the existing holding without inventing valuation", () => {
  const current = initializeFinancialLedger({
    id: "ownership_adjustment",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 5, status: "active", factStatus: "known", evidence: [] }],
      businessHoldings: [{
        id: "founder_holding", business: { id: "business", displayName: "创业公司", status: "operating", factStatus: "known", evidence: [] },
        ownershipRate: 0.5, personalCarryingValueWan: 0, status: "active", factStatus: "known", evidence: []
      }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你们重新签订协议：你占55%，合伙人占45%。",
    acceptedOutcomeId: "accepted_renegotiation",
    effectiveAtAgeInMonths: 311,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_revalued");
  assert.equal((proposals[0].payload as any).ownershipRate, 0.55);
  assert.equal((proposals[0].payload as any).postMoneyValuationWan, undefined);
});

test("PB-BIZ-24 allocation-list wording updates the protagonist ownership", () => {
  const current = initializeFinancialLedger({
    id: "ownership_allocation_list",
    asOfAgeInMonths: 300,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 5, status: "active", factStatus: "known", evidence: [] }],
      businessHoldings: [{
        id: "founder_holding", business: { id: "business", displayName: "创业公司", status: "operating", factStatus: "known", evidence: [] },
        ownershipRate: 0.5, personalCarryingValueWan: 10, status: "active", factStatus: "known", evidence: []
      }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你们签署合伙协议，股权按贡献分配：你40%，老张35%，小刘25%。",
    acceptedOutcomeId: "accepted_allocation",
    effectiveAtAgeInMonths: 314,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_revalued");
  assert.equal((proposals[0].payload as any).ownershipRate, 0.4);
});

test("PB-BIZ-24 contribution wording with 拿 captures ownership", () => {
  const current = initializeFinancialLedger({ id: "ownership_take", asOfAgeInMonths: 300 });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你们明确股权分工：你负责产品和运营拿70%，老李负责销售拿30%。",
    acceptedOutcomeId: "accepted_take",
    effectiveAtAgeInMonths: 312,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal((proposals[0].payload as any).businessHolding.ownershipRate, 0.7);
});

test("PB-BIZ-14 explicit startup capital uses the stated cash amount at period start", () => {
  const current = initializeFinancialLedger({
    id: "startup_capital_capture",
    asOfAgeInMonths: 288,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 35, status: "active", factStatus: "known", evidence: [] }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [],
    narrativeText: "你辞去工作，与合伙人正式注册公司，用35万备用金作为启动资金。",
    acceptedOutcomeId: "accepted_startup",
    effectiveAtAgeInMonths: 298,
    periodStartAgeInMonths: 288,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].effectiveAtAgeInMonths, 288);
  assert.equal((proposals[0].payload as any).personalCashInvestedWan, 35);
  assert.equal((proposals[0].payload as any).businessHolding.personalCarryingValueWan, 35);
});

test("PB-BIZ-23 startup cash expense is folded into the holding instead of charged twice", () => {
  const current = initializeFinancialLedger({
    id: "startup_cash_dedup",
    asOfAgeInMonths: 288,
    openingPosition: {
      cashAccounts: [{ id: PRIMARY_CASH_ACCOUNT_ID, type: "bank_deposit", balanceWan: 35, status: "active", factStatus: "known", evidence: [] }]
    }
  });
  const proposals = synthesizeMissingBusinessHoldingStartProposal({
    proposals: [{
      id: "cash_invested", kind: "one_off_expense_paid", effectiveAtAgeInMonths: 288,
      payload: { amountWan: 35, sourceCashAccountId: PRIMARY_CASH_ACCOUNT_ID },
      evidence: "你用35万元家庭备用金作为启动资金，成立了链捷科技。", confidence: 0.9,
      financialScope: "personal"
    }],
    narrativeText: "你用35万元家庭备用金作为启动资金，和合伙人一起成立了链捷科技。",
    acceptedOutcomeId: "accepted_startup",
    effectiveAtAgeInMonths: 299,
    periodStartAgeInMonths: 288,
    ledger: current
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].kind, "business_holding_started");
  assert.equal((proposals[0].payload as any).personalCashInvestedWan, 35);
});

test("PB-CAREER-04 a misplaced employment_transition is recovered from the financial array", () => {
  const transition = extractMisplacedEmploymentTransition({
    financialEventProposals: [{
      id: "career_wrong_channel",
      kind: "employment_transition",
      effectiveAtAgeInMonths: 301,
      sourceOutcomeId: "start_company",
      evidence: "你辞职并开始创业。",
      confidence: 0.95,
      payload: { subject: "protagonist", fromStatus: "employed", toStatus: "self_employed" }
    }]
  });
  assert.equal(transition?.toStatus, "self_employed");
  assert.equal(transition?.effectiveAtAgeInMonths, 301);
  assert.equal(transition?.sourceOutcomeId, "start_company");
});

test("PB-CAREER-05 an accepted resignation-to-startup choice synthesizes self-employed authority", () => {
  const transition = synthesizeSelectedCareerTransition({
    selectedDecision: "辞职创业，先用半年做出三个付费客户",
    narrativeText: "你辞去了原来的工作，并开始全职创业。",
    acceptedOutcomeId: "start_company",
    effectiveAtAgeInMonths: 288
  });
  assert.equal(transition?.toStatus, "self_employed");
  assert.equal(transition?.sourceOutcomeId, "start_company");
});

test("PB-CAREER-06 a return-to-work choice and accepted offer synthesize employed authority", () => {
  const transition = synthesizeSelectedCareerTransition({
    selectedDecision: "C. 回归职场稳定",
    narrativeText: "你决定结束创业，回归职场。最终你接受了年薪45万元的offer，税后月薪约2.6万元。",
    acceptedOutcomeId: "return_to_work",
    effectiveAtAgeInMonths: 639
  });
  assert.equal(transition?.toStatus, "employed");
  assert.match(transition?.evidence || "", /回归职场|接受了年薪/);
});

test("PB-CAREER-07 accepting a named offer synthesizes employed authority", () => {
  const transition = synthesizeSelectedCareerTransition({
    selectedDecision: "接受深圳的产品总监offer，搬家南下，全力回归职场主线",
    narrativeText: "你接受了这份产品总监offer，并正式到深圳入职。",
    acceptedOutcomeId: "accept_shenzhen_offer",
    effectiveAtAgeInMonths: 588
  });
  assert.equal(transition?.toStatus, "employed");
});

test("PB-CAREER-08 the accepted resignation choice remains authority when prose only says a resignation was submitted", () => {
  const transition = synthesizeSelectedCareerTransition({
    selectedDecision: "辞职创业，先用半年做出三个付费客户",
    narrativeText: "你递交辞呈后，开始拜访潜在客户。",
    acceptedOutcomeId: "start_company",
    effectiveAtAgeInMonths: 298
  });
  assert.equal(transition?.toStatus, "self_employed");
  assert.equal(transition?.evidence, "辞职创业，先用半年做出三个付费客户");
});
