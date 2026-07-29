const INTERNAL_LEDGER_TEXT = /(?:当前没有可由权威账本确认|本期末个人总负债为|本期账本没有记录未足额偿付|现有还款仍按账本记录执行|下一步需要继续核对现金缓冲和未来到期安排|Accepted Event|FinancialEventProposal|narrativeFallback)/u;
const DEBT_COMPLETION_TEXT = /(?:还清(?:了|全部|所有)?(?:债务|欠款|贷款)?|结清(?:了|全部|所有)?(?:债务|欠款|贷款)?|清偿完毕|无债一身轻|摆脱(?:了)?全部债务|不再欠债)/u;
const NEGATIVE_NET_WORTH_SUCCESS_TEXT = /(?:财务自由|财富自由|资产充足|经济无忧|财务无忧|财富安全垫(?:已经)?建立)/u;
const PROPERTY_POSSESSION_TEXT = /(?:名下有(?:一套|房产)|名下房产|自己的(?:房[屋产子]|公寓|住房)|(?:出售|卖掉)(?:了)?(?:自己的|名下的)?(?:房屋|房产|住房|公寓)|房产升值|房贷压力)/u;
const DEBT_TEXT = /(?:债务|欠款|贷款|房贷|信用卡)/u;
const MONEY_WAN = /(\d+(?:\.\d+)?)\s*万(?:元)?/gu;
const ALLOWED_ASSET_TYPES = new Set(["investment", "property", "annuity", "insurance_cash_value", "other_personal_asset"]);
const AUTHORITATIVE_OPENING_SOURCES = new Set(["user", "user_profile", "structured_answer", "user_input", "accepted_history", "accepted_simulation_outcome"]);
const FINANCIAL_PLACEHOLDER_TEXT = /金额待账本确认|回报幅度待账本确认|回报率待账本确认|价值待确认|账本确认/u;
const ORPHAN_FINANCIAL_AMOUNT_TEXT = /(?:负债|债务|净资产|现金|收入|支出)\s*-?\d+(?:\.\d+)?\s*(?:…|\.{2,})/u;
const LONG_FINANCIAL_FLOAT_TEXT = /-?\d+\.\d{3,}\s*万(?:元)?/u;

const PERSONAL_MONTHLY_INCOME_PATTERNS = [
  /(?:你|你的|本人|个人)(?:当前|现在|每月|税后|的|可支配|实际到账|净收入|收入|工资|薪资|月薪|从公司领取|从公司获得|从公司拿到|向自己支付|给自己发){0,8}[^。！？\n]{0,24}?(?:税后)?(?:月薪|每月收入|每月工资|每月薪资|工资|薪资)(?:达到|提升至|升至|降至|恢复至|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu,
  /(?:公司|企业)[^。！？\n]{0,20}?(?:向你|给你|向你的个人账户|给你的个人账户|向本人|给本人)[^。！？\n]{0,16}?(?:每月)?(?:支付|发放|转入)[^。！？\n]{0,8}?(\d+(?:\.\d+)?)\s*万(?:元)?(?:税后)?(?:工资|薪资)/gu,
  /(?:你|本人)(?:从本月起)?[^。！？\n]{0,16}?每月向自己支付\s*(\d+(?:\.\d+)?)\s*万(?:元)?(?:税后)?(?:工资|薪资)/gu
];

export function extractPersonalMonthlyIncomeWan(text) {
  const values = [];
  for (const sentence of String(text || "").split(/[。！？\n]/u)) {
    const conditionalSalaryRule = /(?:如果|若|当)[^。！？\n]{0,40}(?:时|则)[^。！？\n]{0,24}(?:工资|薪资|月薪)(?:调整为|降至|升至|为|达到)?\s*\d/u.test(sentence);
    if (conditionalSalaryRule) continue;
    const unacceptedOffer = /(?:offer|职位|岗位|工作).{0,24}(?:开出|给出|提供|税后|月薪)|(?:开出|给出|提供).{0,24}(?:薪资|工资|月薪)/iu.test(sentence)
      && !/(?:接受了|已接受|已经接受|正式入职|已经入职|当前|现在|实际到账|开始领取)/u.test(sentence);
    if (unacceptedOffer) continue;
    for (const pattern of PERSONAL_MONTHLY_INCOME_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of sentence.matchAll(pattern)) values.push(Number(match[1]));
    }
  }
  return [...new Set(values.filter(Number.isFinite))];
}

export function containsPersonalHoldingClaim(text) {
  return String(text || "").split(/[。！？\n]/u).some((sentence) => (
    /(?:你|本人|个人)(?:实际|直接|间接|仍然|最终|目前|当前)?(?:持有|持股|占股|拥有)[^。！？]{0,18}(?:股份|股权|期权|%|％)/u.test(sentence)
    || /(?:你|本人|个人)(?:的)?(?:股份|股权|期权)(?:比例)?(?:为|达到|增至|降至|剩余|是)?\s*\d/u.test(sentence)
    || /(?:你|本人)(?:出资|投入)[^。！？]{0,24}(?:成为|作为)[^。！？]{0,10}(?:股东|合伙人)/u.test(sentence)
    || /(?:你|本人)(?:成为|是)[^。！？]{0,12}(?:股东|控股股东)/u.test(sentence)
  ));
}

const round = (value) => Math.round(Number(value || 0) * 10000) / 10000;
const close = (left, right, tolerance = 0.02) => Math.abs(Number(left || 0) - Number(right || 0)) <= tolerance;

function containsCompletedRepaymentClaim(text) {
  return String(text || "").split(/[。！？!?\n]/u).some((sentence) => {
    if (!DEBT_COMPLETION_TEXT.test(sentence)) return false;
    if (/(?:未|没有|尚|仍|距离|如果|一旦|可以|可望|用来|准备|计划|打算|将在|将会|希望|尝试|申请|承诺|需要|才能|能否|还在|待)(?:[^。！？!?\n]{0,20})(?:还清|结清|清偿|无债)/u.test(sentence)) return false;
    if (/(?:还清|结清|清偿)(?:[^。！？!?\n]{0,20})(?:仍需|还要|尚需|需要|才能|数年|很久|时间)/u.test(sentence)) return false;
    return /(?:(?:还清|结清)(?:了)?[^。！？!?\n]{0,12}(?:债务|欠款|贷款|房贷|信用卡|债)|清偿(?:完毕|了)?[^。！？!?\n]{0,12}(?:债务|欠款|贷款|房贷|信用卡|债)|无债一身轻|不再欠债|(?:终于|已经|成功|彻底).{0,12}(?:还清|结清|清偿|无债)|(?:债务|欠款|贷款|房贷|信用卡).{0,8}(?:归零|清零))/u.test(sentence);
  });
}

function flattenText(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => flattenText(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => flattenText(item, output));
  return output;
}

function flattenTextEntries(value, path = "", output = []) {
  if (typeof value === "string") output.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((item, index) => flattenTextEntries(item, `${path}[${index}]`, output));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => flattenTextEntries(item, path ? `${path}.${key}` : key, output));
  return output;
}

function activeDebtTotal(ledger) {
  return round((ledger?.debtAccounts || [])
    .filter((account) => account.status === "active" || account.status === "defaulted")
    .reduce((sum, account) => sum + Number(account.principalWan || 0) + Number(account.accruedUnpaidInterestWan || 0), 0));
}

function activePropertyAccounts(ledger) {
  return (ledger?.assetAccounts || []).filter((account) => account.status === "active" && account.type === "property");
}

function evidenceSources(account) {
  return new Set((account?.evidence || []).map((evidence) => evidence?.source).filter(Boolean));
}

function hasAuthoritativeOpeningEvidence(account) {
  const sources = evidenceSources(account);
  return [...sources].some((source) => AUTHORITATIVE_OPENING_SOURCES.has(source));
}

function openingAccountsWithoutEvidence(firstNode) {
  const ledger = firstNode?.financialLedger || {};
  return [
    ...(ledger.assetAccounts || []).filter((account) => account.status === "active" && !hasAuthoritativeOpeningEvidence(account)),
    ...(ledger.debtAccounts || []).filter((account) => (account.status === "active" || account.status === "defaulted") && !hasAuthoritativeOpeningEvidence(account))
  ];
}

function propertySummaryMismatch(node) {
  const ledger = node?.financialLedger || {};
  const invalidActiveAsset = (ledger.assetAccounts || []).some((account) => account.status === "active" && !ALLOWED_ASSET_TYPES.has(account.type));
  const propertyTotal = round(activePropertyAccounts(ledger).reduce((sum, account) => sum + Number(account.marketValueWan || 0), 0));
  return invalidActiveAsset || !close(propertyTotal, node?.financialState?.propertyMarketValueWan || 0);
}

function debtNumbers(text) {
  const values = [];
  MONEY_WAN.lastIndex = 0;
  for (const match of String(text || "").matchAll(MONEY_WAN)) values.push(Number(match[1]));
  return values;
}

function nodeDebtDeltaIssue(node, previousNode) {
  if (!previousNode) return undefined;
  const openingDebtWan = activeDebtTotal(previousNode.financialLedger);
  const closingDebtWan = activeDebtTotal(node.financialLedger);
  const debtDeltaWan = round(closingDebtWan - openingDebtWan);
  if (Math.abs(debtDeltaWan) <= 0.01) return undefined;
  const description = String(node.description || "");
  const values = debtNumbers(description);
  const mentionsMatchingClosing = values.some((value) => close(value, closingDebtWan));
  const mentionsMatchingDelta = values.some((value) => close(value, Math.abs(debtDeltaWan)));
  const transaction = (node.financialLedger?.recentTransactions || []).at(-1);
  const hasCanonicalBreakdown = transaction
    && Number.isFinite(transaction.debtPrincipalDrawnWan)
    && Number.isFinite(transaction.debtPrincipalPaidWan)
    && Number.isFinite(transaction.automaticLiquidityShortfallRecoveryWan)
    && Number.isFinite(transaction.debtInterestAccruedWan);
  if (hasCanonicalBreakdown || (DEBT_TEXT.test(description) && (mentionsMatchingClosing || mentionsMatchingDelta))) return undefined;
  return { openingDebtWan, closingDebtWan, debtDeltaWan, narrativeWanValues: values };
}

function latestTransaction(node) {
  return (node?.financialLedger?.recentTransactions || []).at(-1);
}

function debtConservationIssue(node) {
  const transaction = latestTransaction(node);
  if (!transaction || !Number.isFinite(transaction.debtDeltaWan)) return undefined;
  const required = [
    "debtPrincipalDrawnWan", "debtPrincipalPaidWan", "debtPrincipalForgivenWan",
    "debtInterestAccruedWan", "debtInterestLiabilityPaidWan", "debtInterestForgivenWan"
  ];
  if (!required.every((key) => Number.isFinite(transaction[key]))) {
    return { transactionId: transaction.id, reason: "missing_canonical_debt_breakdown" };
  }
  const expectedDebtDeltaWan = round(
    transaction.debtPrincipalDrawnWan
    + transaction.debtInterestAccruedWan
    - transaction.debtPrincipalPaidWan
    - transaction.debtPrincipalForgivenWan
    - transaction.debtInterestLiabilityPaidWan
    - transaction.debtInterestForgivenWan
  );
  if (close(expectedDebtDeltaWan, transaction.debtDeltaWan)) return undefined;
  return { transactionId: transaction.id, expectedDebtDeltaWan, actualDebtDeltaWan: transaction.debtDeltaWan };
}

function activeMonthlyCoreExpense(ledger, ageInMonths) {
  return round((ledger?.expenseCommitments || [])
    .filter((commitment) => commitment.status === "active"
      && Number(commitment.activeFromAgeInMonths) < ageInMonths
      && (commitment.activeUntilAgeInMonths === undefined || Number(commitment.activeUntilAgeInMonths) >= ageInMonths))
    .reduce((sum, commitment) => sum + Number(commitment.monthlyAmountWan || 0), 0));
}

function frozenAutomaticShortfallIssue(node) {
  const ledger = node?.financialLedger || {};
  const shortfallWan = round((ledger.debtAccounts || [])
    .filter((account) => account.status === "active" && account.origin === "system_auto_shortfall")
    .reduce((sum, account) => sum + Number(account.principalWan || 0), 0));
  if (shortfallWan <= 0.01) return undefined;
  const monthlyExpenseWan = activeMonthlyCoreExpense(ledger, Number(node.ageInMonths || 0));
  if (Number(node.ageInMonths || 0) >= 18 * 12 && monthlyExpenseWan <= 0) return undefined;
  const cashWan = round((ledger.cashAccounts || [])
    .filter((account) => account.status === "active")
    .reduce((sum, account) => sum + Number(account.balanceWan || 0), 0));
  const reserveWan = round(monthlyExpenseWan * 3);
  if (cashWan <= reserveWan + 0.01) return undefined;
  return { shortfallWan, cashWan, reserveWan, transactionId: latestTransaction(node)?.id };
}

function knownRateInterestOmissionIssue(node, previousNode) {
  if (!previousNode) return undefined;
  const elapsedMonths = Number(node.ageInMonths || 0) - Number(previousNode.ageInMonths || 0);
  if (elapsedMonths <= 0) return undefined;
  const knownRateDebt = (previousNode.financialLedger?.debtAccounts || []).filter((account) => (
    (account.status === "active" || account.status === "defaulted")
    && Number(account.principalWan || 0) > 0.01
    && (Number(account.repaymentPolicy?.annualInterestRate || 0) > 0
      || Number(account.repaymentPolicy?.monthlyInterestWan || 0) > 0)
  ));
  if (knownRateDebt.length === 0) return undefined;
  const transaction = latestTransaction(node);
  if (Number(transaction?.debtInterestAccruedWan || 0) > 0) return undefined;
  return { debtAccountIds: knownRateDebt.map((account) => account.id), elapsedMonths, transactionId: transaction?.id };
}

function unsupportedRepaymentCompletionIssue(node, previousNode, priorNodes = []) {
  if (!containsCompletedRepaymentClaim(node?.description)) return undefined;
  const transaction = latestTransaction(node);
  const hasRepaymentFact = Number(transaction?.debtPrincipalPaidWan || 0) > 0
    || Number(transaction?.debtPrincipalForgivenWan || 0) > 0
    || (node?.financialLedger?.debtAccounts || []).some((account) => {
      const previous = previousNode?.financialLedger?.debtAccounts?.find((item) => item.id === account.id);
      return previous && (previous.status === "active" || previous.status === "defaulted")
        && ["repaid", "forgiven", "restructured"].includes(account.status);
    });
  if (hasRepaymentFact) return undefined;
  const historicallyGroundedZeroDebt = Number(node?.financialState?.totalDebtWan || 0) <= 0.01
    && priorNodes.some((item) => Number(item?.financialState?.totalDebtWan || 0) > 0.01);
  if (historicallyGroundedZeroDebt) return undefined;
  return { transactionId: transaction?.id };
}

export function extractFinancialNarrativeAuditMeta(node) {
  const meta = node?.financialProcessingMeta || {};
  return {
    narrativeFallback: meta.narrativeFallback === true,
    fallbackReasonCodes: Array.isArray(meta.narrativeFallbackReasonCodes) ? meta.narrativeFallbackReasonCodes : [],
    repairAttempts: Number(meta.narrativeRepairAttempts || 0),
    repairSucceeded: meta.narrativeRepairSucceeded === true,
    fallbackSurfacePaths: Array.isArray(meta.narrativeFallbackSurfacePaths) ? meta.narrativeFallbackSurfacePaths : []
  };
}

export function collectFinalReportFinancialConflicts(record) {
  const history = record?.finalState?.history || [];
  const latest = history.at(-1);
  const outcome = record?.finalState?.outcome;
  if (!latest || !outcome) return [];
  const text = flattenText({ share: outcome.share, report: outcome.report }).join("\n");
  const debtWan = activeDebtTotal(latest.financialLedger);
  const netWorthWan = Number(latest.financialState?.netWorthWan || 0);
  const confirmedProperties = activePropertyAccounts(latest.financialLedger)
    .filter((account) => account.factStatus === "known" || hasAuthoritativeOpeningEvidence(account));
  const conflicts = [];
  if (debtWan > 0.01 && containsCompletedRepaymentClaim(text)) conflicts.push({ code: "REPORT_DEBT_COMPLETION_CONFLICT", debtWan });
  if (netWorthWan < -0.01 && NEGATIVE_NET_WORTH_SUCCESS_TEXT.test(text)) conflicts.push({ code: "REPORT_NEGATIVE_NET_WORTH_CONFLICT", netWorthWan });
  if (confirmedProperties.length === 0 && PROPERTY_POSSESSION_TEXT.test(text)) conflicts.push({ code: "REPORT_PROPERTY_CONFLICT" });
  return conflicts;
}

export function auditFinancialProductionRecords(records) {
  const fallbackNodes = [];
  const fallbackReasonCodeCounts = {};
  const internalLedgerTextNodes = [];
  const unexplainedDebtDeltaNodes = [];
  const fabricatedOpeningAccounts = [];
  const assetSummaryMismatchNodes = [];
  const finalReportConflicts = [];
  const debtConservationFailures = [];
  const frozenAutomaticShortfallNodes = [];
  const knownRateInterestOmissionNodes = [];
  const unsupportedRepaymentCompletionNodes = [];
  const userVisibleFinancialPlaceholders = [];
  const orphanFinancialAmounts = [];
  const financialPrecisionViolations = [];
  const crossJourneyInvitationEntries = [];
  const companyOperatingFlowsInPersonalLedger = [];
  const fallbackCaseSlugs = new Set();
  let fallbackWithoutRepairRecordCount = 0;
  let knownRateDebtExposureNodeCount = 0;

  for (const record of records) {
    const history = record?.finalState?.history || [];
    const visibleEntries = flattenTextEntries({
      history: history.map((node) => ({ title: node.title, description: node.description, choices: node.choices })),
      share: record?.finalState?.outcome?.share,
      report: record?.finalState?.outcome?.report
    });
    for (const entry of visibleEntries) {
      if (FINANCIAL_PLACEHOLDER_TEXT.test(entry.text)) userVisibleFinancialPlaceholders.push({ caseSlug: record.caseSlug, ...entry });
      if (ORPHAN_FINANCIAL_AMOUNT_TEXT.test(entry.text)) orphanFinancialAmounts.push({ caseSlug: record.caseSlug, ...entry });
      if (LONG_FINANCIAL_FLOAT_TEXT.test(entry.text)) financialPrecisionViolations.push({ caseSlug: record.caseSlug, ...entry });
    }
    const expectedJourneyId = record?.identity?.journeyId || record?.journeyId;
    const finalInvitationIds = new Set((record?.finalState?.invitations || []).map((invitation) => invitation.id));
    const validArcIds = new Set(history.flatMap((node) => node?.worldStateSnapshot?.pressureArcs || []).map((arc) => arc.id));
    for (const entry of record?.interactionLog || []) {
      if (expectedJourneyId && entry.journeyId && entry.journeyId !== expectedJourneyId) {
        crossJourneyInvitationEntries.push({ caseSlug: record.caseSlug, code: "CROSS_JOURNEY_TRACE", path: "interactionLog", id: entry.journeyId });
      }
      if (!entry.type?.startsWith("invitation_") || !entry.invitation?.id) continue;
      if (!finalInvitationIds.has(entry.invitation.id)) {
        crossJourneyInvitationEntries.push({ caseSlug: record.caseSlug, code: "CROSS_JOURNEY_INVITATION", id: entry.invitation.id });
      }
      if (entry.invitation.pressureArcId && !validArcIds.has(entry.invitation.pressureArcId)) {
        crossJourneyInvitationEntries.push({ caseSlug: record.caseSlug, code: "CROSS_JOURNEY_PRESSURE_ARC", id: entry.invitation.pressureArcId });
      }
    }
    const openingUnsupported = openingAccountsWithoutEvidence(history[0]);
    for (const account of openingUnsupported) {
      fabricatedOpeningAccounts.push({ caseSlug: record.caseSlug, accountId: account.id, accountType: account.type, evidenceSources: [...evidenceSources(account)] });
    }
    for (let index = 0; index < history.length; index += 1) {
      const node = history[index];
      const auditMeta = extractFinancialNarrativeAuditMeta(node);
      if (auditMeta.narrativeFallback) {
        fallbackCaseSlugs.add(record.caseSlug);
        fallbackNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...auditMeta });
        if (auditMeta.repairAttempts === 0 && auditMeta.fallbackSurfacePaths.length === 0) fallbackWithoutRepairRecordCount += 1;
        for (const code of auditMeta.fallbackReasonCodes) fallbackReasonCodeCounts[code] = (fallbackReasonCodeCounts[code] || 0) + 1;
      }
      if (INTERNAL_LEDGER_TEXT.test(String(node.description || ""))) {
        internalLedgerTextNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title });
      }
      const deltaIssue = nodeDebtDeltaIssue(node, history[index - 1]);
      if (deltaIssue) unexplainedDebtDeltaNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...deltaIssue });
      const conservationIssue = debtConservationIssue(node);
      if (conservationIssue) debtConservationFailures.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...conservationIssue });
      const frozenShortfallIssue = frozenAutomaticShortfallIssue(node);
      if (frozenShortfallIssue) frozenAutomaticShortfallNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...frozenShortfallIssue });
      const interestIssue = knownRateInterestOmissionIssue(node, history[index - 1]);
      if (interestIssue) knownRateInterestOmissionNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...interestIssue });
      if (history[index - 1] && (history[index - 1].financialLedger?.debtAccounts || []).some((account) => (
        (account.status === "active" || account.status === "defaulted")
        && Number(account.principalWan || 0) > 0.01
        && (Number(account.repaymentPolicy?.annualInterestRate || 0) > 0 || Number(account.repaymentPolicy?.monthlyInterestWan || 0) > 0)
      ))) knownRateDebtExposureNodeCount += 1;
      const repaymentIssue = unsupportedRepaymentCompletionIssue(node, history[index - 1], history.slice(0, index));
      if (repaymentIssue) unsupportedRepaymentCompletionNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...repaymentIssue });
      if (propertySummaryMismatch(node)) assetSummaryMismatchNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title });
      for (const source of node?.financialLedger?.incomeSources || []) {
        if ((source.evidence || []).some((item) => item.financialScope === "business_operating")) {
          companyOperatingFlowsInPersonalLedger.push({ caseSlug: record.caseSlug, node: index + 1, accountId: source.id, direction: "income" });
        }
      }
      for (const commitment of node?.financialLedger?.expenseCommitments || []) {
        if ((commitment.evidence || []).some((item) => item.financialScope === "business_operating")) {
          companyOperatingFlowsInPersonalLedger.push({ caseSlug: record.caseSlug, node: index + 1, accountId: commitment.id, direction: "expense" });
        }
      }
    }
    for (const conflict of collectFinalReportFinancialConflicts(record)) finalReportConflicts.push({ caseSlug: record.caseSlug, ...conflict });
  }

  return {
    summary: {
      narrativeFallbackNodeCount: fallbackNodes.length,
      narrativeFallbackCaseCount: fallbackCaseSlugs.size,
      fallbackReasonCodeCounts,
      fallbackWithoutRepairRecordCount,
      userVisibleInternalLedgerTextCount: internalLedgerTextNodes.length,
      finalReportFinancialConflictCount: finalReportConflicts.length,
      unexplainedDebtDeltaNodeCount: unexplainedDebtDeltaNodes.length,
      fabricatedOpeningAccountCount: fabricatedOpeningAccounts.length,
      assetSummaryMismatchNodeCount: assetSummaryMismatchNodes.length,
      debtConservationFailureCount: debtConservationFailures.length,
      autoShortfallFrozenAboveReserveNodeCount: frozenAutomaticShortfallNodes.length,
      knownRateInterestOmissionNodeCount: knownRateInterestOmissionNodes.length,
      unsupportedRepaymentCompletionNodeCount: unsupportedRepaymentCompletionNodes.length,
      userVisibleFinancialPlaceholderCount: userVisibleFinancialPlaceholders.length,
      orphanFinancialAmountCount: orphanFinancialAmounts.length,
      financialAmountPrecisionViolationCount: financialPrecisionViolations.length,
      crossJourneyInvitationEntryCount: crossJourneyInvitationEntries.length,
      companyOperatingFlowInPersonalLedgerCount: companyOperatingFlowsInPersonalLedger.length,
      knownRateDebtExposureNodeCount
    },
    fallbackNodes,
    internalLedgerTextNodes,
    finalReportConflicts,
    unexplainedDebtDeltaNodes,
    fabricatedOpeningAccounts,
    assetSummaryMismatchNodes,
    debtConservationFailures,
    frozenAutomaticShortfallNodes,
    knownRateInterestOmissionNodes,
    unsupportedRepaymentCompletionNodes,
    userVisibleFinancialPlaceholders,
    orphanFinancialAmounts,
    financialPrecisionViolations,
    crossJourneyInvitationEntries,
    companyOperatingFlowsInPersonalLedger
  };
}

export const FINANCIAL_PRODUCTION_AUDIT_PATTERNS = {
  internalLedgerText: INTERNAL_LEDGER_TEXT,
  debtCompletionText: DEBT_COMPLETION_TEXT,
  negativeNetWorthSuccessText: NEGATIVE_NET_WORTH_SUCCESS_TEXT,
  propertyPossessionText: PROPERTY_POSSESSION_TEXT
};
