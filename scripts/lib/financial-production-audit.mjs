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
const RESTRICTED_PROJECT_FUNDING_TEXT = /(?:项目|公益|专项|教育)[^。；\n]{0,24}(?:基金|资助|拨款|赞助|项目款|资金|经费|款)|(?:基金|资助|拨款|赞助|项目款|资金|经费|款)[^。；\n]{0,24}(?:项目|公益|专项|教育)/u;
const RESTRICTED_PROJECT_FUNDING_PUBLIC_PURPOSE_TEXT = /(?:用于|专款|专项|定向|仅限|专门)[^。；\n]{0,48}(?:学校|村小|教师|硬件|设备|教学|助学|课程|培训|公益|志愿者|基金会|社会组织|非营利|社区服务|受助人|服务对象)/u;
const GENERIC_PROJECT_EXECUTION_PURPOSE_TEXT = /(?:用于|专款|专项|定向|仅限|专门)[^。；\n]{0,48}(?:项目运营|项目实施|项目执行|项目服务|机构运营)/u;
const EXPLICIT_PUBLIC_BENEFICIARY_CONTEXT = /(?:公益|教育|学校|村小|校园|教师|学生|助学|社区服务|基金会|社会组织|非营利)/u;
const PERSONAL_DISPOSABLE_AWARD_TEXT = /(?:个人(?:可)?自由支配|个人(?:可)?自行支配|你(?:个人)?(?:可)?自由支配|你(?:个人)?(?:可)?自行支配|无(?:指定|限定)用途)[^。；\n]{0,32}(?:奖(?:金|励)?|奖金)|(?:奖(?:金|励)?|奖金)[^。；\n]{0,48}(?:个人(?:可)?自由支配|个人(?:可)?自行支配|你(?:个人)?(?:可)?自由支配|你(?:个人)?(?:可)?自行支配|无(?:指定|限定)用途)/u;
const PERSONAL_CASH_INFLOW_EVENT_KINDS = new Set([
  "income_source_started",
  "income_source_adjusted",
  "one_off_income_received",
  "family_support_received",
  "business_distribution_received"
]);
const FAILED_FINANCIAL_ATTEMPT_TEXT = /(?:尝试申请借款，但这次尚未形成已经到账的结果|尝试申请调整还款安排，但尚未形成生效协议|开始评估资产处置，但这次尚未形成确定成交|尝试寻求外部支持，但这次尚未确认资金到账|实际到账的个人收入尚待确认|关于补发收入的安排仍在核对，暂时没有确定到账|(?:股权补偿|期权补偿|期权归属)仍在确认[^。！？\n]{0,24}尚未形成确定的个人持有结果|已经尝试推进这项财务安排，但它暂时还没有形成确定结果)/u;
const COMPLETION_AFTER_FAILED_ATTEMPT_TEXT = /(?:这笔|该笔|上述)(?:钱|资金|款项)[^。！？\n]{0,12}(?:到账|到手|入账)(?:后|以后|之后)|(?:借款|贷款)[^。！？\n]{0,12}(?:到账|到手|入账)(?:后|以后|之后)|(?:重组|展期|宽限期|还款安排)[^。！？\n]{0,12}(?:生效|获批|确认)(?:后|以后|之后)|(?:签了|签署|签订)[^。！？\n]{0,8}(?:重组|展期|宽限期|还款|补充)?协议|补发[^。！？\n]{0,16}(?:工资|薪资|奖金)|(?:工资|薪资|奖金)[^。！？\n]{0,16}(?:补发|到账)|(?:签署|签订)[^。！？\n]{0,20}(?:股权|股份|期权)(?:协议)?|(?:你|我|主角)(?:已经|已)?(?:获得|拿到|确认|持有)[^。！？\n]{0,20}(?:股权|股份|期权)|(?:资产|房产|车辆|股份)[^。！？\n]{0,12}(?:成交|出售|卖出)(?:后|以后|之后)/u;
const RELIEF_AFTER_FAILED_ATTEMPT_TEXT = /(?:松(?:了)?(?:一)?口气|长舒一口气|终于(?:可以)?(?:喘息|缓口气)|(?:现金流|资金|还款|月供|债务|经济|财务)?压力[^。！？\n]{0,12}(?:缓解|减轻|下降|小了)|现金流[^。！？\n]{0,12}(?:缓解|改善)|月供[^。！？\n]{0,16}(?:降低|减轻|轻松)|燃眉之急[^。！？\n]{0,8}(?:得到)?缓解)/u;
const RESTRUCTURE_PENDING_TEXT = /尚未形成生效协议/u;
const RESTRUCTURE_BENEFIT_TEXT = /(?:每月|月供)[^。！？\n]{0,20}(?:多出(?:来)?(?:的)?|释放|降低|降到|降至|少还)\s*\d|(?:这份|该份|新的?)(?:补充)?协议|用更长的还款周期[^。！？\n]{0,16}(?:喘息|缓解)|(?:松(?:了)?(?:一)?口气|喘息空间|宽慰)[^。！？\n]{0,24}(?:月供|还款|利息|现金流)|(?:利息总额|还款期限)[^。！？\n]{0,20}(?:增加|延长)[^。！？\n]{0,20}(?:月供|现金流|喘息|缓解)/u;
const UNCONFIRMED_PERSONAL_INCOME_TEXT = /(?:实际到账的个人收入尚待确认|补发收入的安排仍在核对|这项财务安排[^。！？\n]{0,16}没有形成确定结果)/u;
const PERSONAL_INCOME_BENEFIT_TEXT = /(?:副业|兼职|驻场|咨询)[^。！？\n]{0,16}收入[^。！？\n]{0,20}(?:稳定|到账|带来|填补|覆盖|缓解|攒下)|靠(?:副业|兼职|驻场|咨询)收入[^。！？\n]{0,20}(?:填补|覆盖|攒下)/u;
const REJECTED_COMPLETION_TITLE_TEXT = /(?:债务|贷款|房贷)?重组|重组生效|协商后(?:的)?(?:新平衡|缓冲|转机)|还款(?:方案|安排)(?:落地|生效)|(?:借款|贷款)(?:到账|获批)|资金到账|融资到位|(?:卖房|卖车|资产出售|资产处置)(?:落地|完成|成交)|(?:援助|支持|家人资金)(?:到账|到位)/u;
const CANONICAL_FINANCIAL_FALLBACK_SENTENCES = [
  "这段时间的工作安排仍在继续，但实际到账的个人收入尚待确认。",
  "创业初期，个人可支配收入仍未形成稳定来源。",
  "公司经营已有进展，但个人可支配收入仍未形成稳定来源。",
  "你们继续根据实际现金流调整家庭支出与储蓄安排。",
  "你尝试申请借款，但这次尚未形成已经到账的结果。",
  "你已经尝试申请调整还款安排，但尚未形成生效协议。",
  "你开始评估资产处置，但这次尚未形成确定成交。",
  "你尝试寻求外部支持，但这次尚未确认资金到账。"
];

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
    if (/(?:还清|结清|清偿)(?:[^。！？!?\n]{0,20})(?:仍需|还要|尚需|需要|才能|还差|距离|数年|很久|时间)/u.test(sentence)) return false;
    return /(?:(?:还清|结清)(?:了)?[^。！？!?\n]{0,12}(?:债务|欠款|贷款|房贷|信用卡|债)|清偿(?:完毕|了)?[^。！？!?\n]{0,12}(?:债务|欠款|贷款|房贷|信用卡|债)|无债一身轻|不再欠债|(?:终于|已经|成功|彻底).{0,12}(?:还清|结清|清偿|无债)|(?:债务|欠款|贷款|房贷|信用卡).{0,8}(?:归零|清零))/u.test(sentence);
  });
}

function transactionHasDebtSettlementFactForAccount(transaction, debtAccountId) {
  if (Array.isArray(transaction?.debtSettlementAccountIds)
    && transaction.debtSettlementAccountIds.includes(debtAccountId)) return true;
  // Old reducer snapshots may lack the explicit target list. A service record
  // still provides account-specific proof; an aggregate debt total does not.
  return (transaction?.debtServiceRecords || []).some((record) => (
    record?.debtAccountId === debtAccountId
    && (Number(record?.principalPaidWan || 0) > 0 || Number(record?.interestPaidWan || 0) > 0)
  ));
}

function transactionAuditId(transaction) {
  const id = transaction?.id || transaction?.simulationTransactionId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function transactionEvidenceText(transaction) {
  return [
    transaction?.id,
    transaction?.simulationTransactionId,
    ...(Array.isArray(transaction?.eventIds) ? transaction.eventIds : []),
    ...(Array.isArray(transaction?.evidence) ? transaction.evidence.flatMap((evidence) => [
      evidence?.sourceEventId,
      evidence?.reasonCode,
      evidence?.excerpt
    ]) : [])
  ].filter((value) => typeof value === "string" && value.trim()).join("\n");
}

function eventAuditEvidenceText(eventAudit) {
  return [
    eventAudit?.eventId,
    eventAudit?.kind,
    ...(Array.isArray(eventAudit?.evidence) ? eventAudit.evidence.flatMap((evidence) => [
      evidence?.sourceEventId,
      evidence?.reasonCode,
      evidence?.excerpt
    ]) : [])
  ].filter((value) => typeof value === "string" && value.trim()).join("\n");
}

function isRestrictedProjectFundingText(text) {
  return RESTRICTED_PROJECT_FUNDING_TEXT.test(text)
    && (RESTRICTED_PROJECT_FUNDING_PUBLIC_PURPOSE_TEXT.test(text)
      || (GENERIC_PROJECT_EXECUTION_PURPOSE_TEXT.test(text) && EXPLICIT_PUBLIC_BENEFICIARY_CONTEXT.test(text)))
    && !PERSONAL_DISPOSABLE_AWARD_TEXT.test(text);
}

function restrictedProjectFundingPersonalCashEventAudits(transaction) {
  const eventAudits = transaction?.acceptedEventAudit;
  if (!Array.isArray(eventAudits)) return [];
  return eventAudits.filter((eventAudit) => {
    if (!PERSONAL_CASH_INFLOW_EVENT_KINDS.has(eventAudit?.kind)) return false;
    // The reducer credits the protagonist ledger for every kind above.  An
    // evidence tag such as business_operating cannot retroactively make that
    // cash non-personal, so never treat scope as an exemption here.
    return isRestrictedProjectFundingText(eventAuditEvidenceText(eventAudit));
  });
}

function isLegacyRestrictedProjectFundingInPersonalCash(transaction) {
  // Older transaction snapshots aggregate all event evidence. They can prove
  // a violation only when exactly one event was accepted; a mixed salary plus
  // organisation-funding period must never be reclassified from the merged
  // prose alone.
  if (Array.isArray(transaction?.acceptedEventAudit)) return false;
  if (!Array.isArray(transaction?.eventIds) || transaction.eventIds.length !== 1) return false;
  const cashInflow = Number(transaction?.incomeWan || 0) > 0.01 || Number(transaction?.cashDeltaWan || 0) > 0.01;
  if (!cashInflow) return false;
  return isRestrictedProjectFundingText(transactionEvidenceText(transaction));
}

function isRestrictedProjectFundingInPersonalCash(transaction) {
  return restrictedProjectFundingPersonalCashEventAudits(transaction).length > 0
    || isLegacyRestrictedProjectFundingInPersonalCash(transaction);
}

function isRestrictedProjectFundingAttributionGap(transaction) {
  if (Array.isArray(transaction?.acceptedEventAudit)) return false;
  if (!Array.isArray(transaction?.eventIds) || transaction.eventIds.length < 2) return false;
  const cashInflow = Number(transaction?.incomeWan || 0) > 0.01 || Number(transaction?.cashDeltaWan || 0) > 0.01;
  return cashInflow && isRestrictedProjectFundingText(transactionEvidenceText(transaction));
}

/**
 * Recent transactions are retained in multiple later ledger snapshots.  Count
 * each canonical transaction at its first occurrence only, otherwise one
 * restricted grant would be reported once per subsequent history node.
 */
export function collectRestrictedProjectFundingInPersonalCash(records) {
  const findings = [];
  for (const record of records) {
    const seenTransactionIds = new Set();
    for (const [nodeIndex, node] of (record?.finalState?.history || []).entries()) {
      for (const transaction of node?.financialLedger?.recentTransactions || []) {
        const transactionId = transactionAuditId(transaction);
        if (!transactionId || seenTransactionIds.has(transactionId)) continue;
        seenTransactionIds.add(transactionId);
        if (!isRestrictedProjectFundingInPersonalCash(transaction)) continue;
        const eventAudit = restrictedProjectFundingPersonalCashEventAudits(transaction)[0];
        findings.push({
          caseSlug: record.caseSlug,
          node: nodeIndex + 1,
          ageInMonths: node.ageInMonths,
          transactionId,
          simulationTransactionId: transaction.simulationTransactionId,
          incomeWan: Number(transaction.incomeWan || 0),
          cashDeltaWan: Number(transaction.cashDeltaWan || 0),
          eventIds: Array.isArray(transaction.eventIds) ? transaction.eventIds : [],
          ...(eventAudit ? { eventId: eventAudit.eventId, eventKind: eventAudit.kind } : {}),
          evidenceExcerpts: (transaction.evidence || []).map((evidence) => evidence?.excerpt).filter(Boolean)
        });
      }
    }
  }
  return findings;
}

export function collectRestrictedProjectFundingAttributionGaps(records) {
  const findings = [];
  for (const record of records) {
    const seenTransactionIds = new Set();
    for (const [nodeIndex, node] of (record?.finalState?.history || []).entries()) {
      for (const transaction of node?.financialLedger?.recentTransactions || []) {
        const transactionId = transactionAuditId(transaction);
        if (!transactionId || seenTransactionIds.has(transactionId)) continue;
        seenTransactionIds.add(transactionId);
        if (!isRestrictedProjectFundingAttributionGap(transaction)) continue;
        findings.push({
          caseSlug: record.caseSlug,
          node: nodeIndex + 1,
          ageInMonths: node.ageInMonths,
          transactionId,
          eventIds: transaction.eventIds,
          evidenceExcerpts: (transaction.evidence || []).map((evidence) => evidence?.excerpt).filter(Boolean)
        });
      }
    }
  }
  return findings;
}

function hasRecordedDebtSettlementForAccount(history, debtAccountId) {
  return history.some((node) => {
    const ledger = node?.financialLedger;
    const account = ledger?.debtAccounts?.find((candidate) => candidate.id === debtAccountId);
    if (!ledger || !account || account.status !== "repaid") return false;
    return (ledger.recentTransactions || []).some((transaction) => (
      transactionHasDebtSettlementFactForAccount(transaction, debtAccountId)
    ));
  });
}

function hasReliableRepaidDebtAccounts(history, node) {
  const repaidAccounts = (node?.financialLedger?.debtAccounts || []).filter((account) => account.status === "repaid");
  return repaidAccounts.length > 0
    && repaidAccounts.every((account) => (hasAuthoritativeOpeningEvidence(account) || account.origin === "system_auto_shortfall")
      && hasRecordedDebtSettlementForAccount(history, account.id));
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
  // The opening chapter can truthfully mention a pre-simulation payoff.  There
  // is no prior in-simulation ledger period to which that background fact can
  // be attached, so it is not a current-period completion claim.
  if (!previousNode) return undefined;
  const historyThroughNode = [...priorNodes, node];
  const supported = activeDebtTotal(node?.financialLedger) <= 0.01
    && hasReliableRepaidDebtAccounts(historyThroughNode, node);
  if (supported) return undefined;
  return { transactionId: latestTransaction(node)?.id };
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
  if (containsCompletedRepaymentClaim(text)
    && (debtWan > 0.01
      || !hasReliableRepaidDebtAccounts(history, latest))) {
    conflicts.push({ code: "REPORT_DEBT_COMPLETION_CONFLICT", debtWan });
  }
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
  const restrictedProjectFundingInPersonalCash = collectRestrictedProjectFundingInPersonalCash(records);
  const restrictedProjectFundingAttributionGaps = collectRestrictedProjectFundingAttributionGaps(records);
  const rejectedCompletionContradictionNodes = [];
  const invalidFinancialNarrativeClaimNodes = [];
  const invalidInternalTransitionNodes = [];
  const duplicateChoiceIdNodes = [];
  const duplicateCanonicalFallbackNodes = [];
  const visibleGenerationPauses = [];
  const unclassifiedGenerationCalls = [];
  const generationTraceGroups = new Map();
  const fallbackCaseSlugs = new Set();
  let fallbackWithoutRepairRecordCount = 0;
  let knownRateDebtExposureNodeCount = 0;

  for (const record of records) {
    const history = record?.finalState?.history || [];
    const generationEvents = record?.finalState?.generationEvents || record?.generationEvents || [];
    for (const event of generationEvents) {
      if (event?.type === "visible_pause") visibleGenerationPauses.push({ caseSlug: record.caseSlug, ...event });
    }
    const generationTraces = record?.finalState?.generationCallTraces || record?.generationCallTraces || [];
    for (const trace of generationTraces) {
      if (!trace?.kind || trace.kind === "unknown") unclassifiedGenerationCalls.push({ caseSlug: record.caseSlug, ...trace });
      if (trace?.outcome === "started") continue;
      const hasNodeIndex = Number.isInteger(trace.nodeIndex);
      const key = `${record.caseSlug}:${hasNodeIndex ? `node-${trace.nodeIndex}` : trace.transactionId || "node-unknown"}`;
      const group = generationTraceGroups.get(key) || [];
      group.push(trace);
      generationTraceGroups.set(key, group);
    }
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
    const terminalTraceInvitationIds = new Set((record?.interactionLog || [])
      .filter((entry) => entry.type === "invitation_declined" || entry.type === "invitation_accepted")
      .map((entry) => entry.invitation?.id)
      .filter(Boolean));
    const validArcIds = new Set(history.flatMap((node) => node?.worldStateSnapshot?.pressureArcs || []).map((arc) => arc.id));
    for (const entry of record?.interactionLog || []) {
      if (expectedJourneyId && entry.journeyId && entry.journeyId !== expectedJourneyId) {
        crossJourneyInvitationEntries.push({ caseSlug: record.caseSlug, code: "CROSS_JOURNEY_TRACE", path: "interactionLog", id: entry.journeyId });
      }
      if (!entry.type?.startsWith("invitation_") || !entry.invitation?.id) continue;
      if (!finalInvitationIds.has(entry.invitation.id) && !terminalTraceInvitationIds.has(entry.invitation.id)) {
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
      const choiceIds = (node.choices || []).map((choice) => choice?.id).filter(Boolean);
      if (new Set(choiceIds).size !== choiceIds.length) {
        duplicateChoiceIdNodes.push({ caseSlug: record.caseSlug, node: index + 1, choiceIds });
      }
      const internalTransitions = node?.narrativeMeta?.storyEpisode?.internalTransitions || [];
      if (internalTransitions.some((transition) => !(
        transition
        && typeof transition === "object"
        && Number.isFinite(transition.atAgeInMonths)
        && (transition.materiality === "transition" || transition.materiality === "meaningful_update")
        && typeof transition.summary === "string"
        && Array.isArray(transition.worldDeltas)
      ))) {
        invalidInternalTransitionNodes.push({ caseSlug: record.caseSlug, node: index + 1 });
      }
      const descriptionText = String(node.description || "");
      if (CANONICAL_FINANCIAL_FALLBACK_SENTENCES.some((sentence) => descriptionText.split(sentence).length - 1 > 1)) {
        duplicateCanonicalFallbackNodes.push({ caseSlug: record.caseSlug, node: index + 1 });
      }
      const auditMeta = extractFinancialNarrativeAuditMeta(node);
      if (node.financialProcessingMeta?.financialNarrativeAuthorityVersion === "financial_narrative_claims_v1") {
        const invalidClaimCount = Number(node.financialProcessingMeta?.invalidFinancialNarrativeClaimCount || 0);
        const danglingClaims = (node.financialNarrativeClaims || []).filter((claim) => (
          !claim?.proposalId || !claim?.surfaceText || !descriptionText.includes(String(claim.surfaceText))
        ));
        if (invalidClaimCount > 0 || danglingClaims.length > 0) {
          invalidFinancialNarrativeClaimNodes.push({
            caseSlug: record.caseSlug,
            node: index + 1,
            invalidClaimCount,
            danglingClaimIds: danglingClaims.map((claim) => claim?.id).filter(Boolean)
          });
        }
      }
      if (auditMeta.narrativeFallback) {
        fallbackCaseSlugs.add(record.caseSlug);
        fallbackNodes.push({ caseSlug: record.caseSlug, node: index + 1, ageInMonths: node.ageInMonths, title: node.title, ...auditMeta });
        if (auditMeta.repairAttempts === 0 && auditMeta.fallbackSurfacePaths.length === 0) fallbackWithoutRepairRecordCount += 1;
        for (const code of auditMeta.fallbackReasonCodes) fallbackReasonCodeCounts[code] = (fallbackReasonCodeCounts[code] || 0) + 1;
        const description = String(node.description || "");
        const fallbackSentences = description.split(/(?<=[。！？])/u).map((sentence) => sentence.trim()).filter(Boolean);
        const hasImmediateReliefContradiction = fallbackSentences.some((sentence, sentenceIndex) => (
          FAILED_FINANCIAL_ATTEMPT_TEXT.test(sentence)
          && RELIEF_AFTER_FAILED_ATTEMPT_TEXT.test(fallbackSentences[sentenceIndex + 1] || "")
        ));
        if (FAILED_FINANCIAL_ATTEMPT_TEXT.test(description)
          && (COMPLETION_AFTER_FAILED_ATTEMPT_TEXT.test(description)
            || hasImmediateReliefContradiction
            || (RESTRUCTURE_PENDING_TEXT.test(description) && RESTRUCTURE_BENEFIT_TEXT.test(description))
            || ((node.financialProcessingMeta?.acceptedEventCount ?? 0) === 0
              && UNCONFIRMED_PERSONAL_INCOME_TEXT.test(description)
              && PERSONAL_INCOME_BENEFIT_TEXT.test(description))
            || REJECTED_COMPLETION_TITLE_TEXT.test(String(node.title || "")))) {
          rejectedCompletionContradictionNodes.push({
            caseSlug: record.caseSlug,
            node: index + 1,
            ageInMonths: node.ageInMonths,
            title: node.title
          });
        }
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

  const generationGroups = [...generationTraceGroups.values()];
  const completedGenerationNodeCount = generationGroups.length;
  const singleFullGenerationNodeCount = generationGroups.filter((group) => (
    group.filter((trace) => trace.kind === "initial_generation" || trace.kind === "full_regeneration").length === 1
  )).length;
  const excessivePatchNodeCount = generationGroups.filter((group) => (
    group.filter((trace) => trace.kind === "candidate_patch").length > 1
  )).length;
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
      restrictedProjectFundingInPersonalCashCount: restrictedProjectFundingInPersonalCash.length,
      restrictedProjectFundingAttributionGapCount: restrictedProjectFundingAttributionGaps.length,
      rejectedCompletionContradictionNodeCount: rejectedCompletionContradictionNodes.length,
      invalidFinancialNarrativeClaimNodeCount: invalidFinancialNarrativeClaimNodes.length,
      invalidInternalTransitionNodeCount: invalidInternalTransitionNodes.length,
      duplicateChoiceIdNodeCount: duplicateChoiceIdNodes.length,
      duplicateCanonicalFallbackNodeCount: duplicateCanonicalFallbackNodes.length,
      knownRateDebtExposureNodeCount,
      visibleGenerationPauseCount: visibleGenerationPauses.length,
      unclassifiedGenerationCallCount: unclassifiedGenerationCalls.length,
      completedGenerationNodeCount,
      singleFullGenerationNodeRate: completedGenerationNodeCount > 0
        ? singleFullGenerationNodeCount / completedGenerationNodeCount
        : 1,
      excessivePatchNodeCount
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
    companyOperatingFlowsInPersonalLedger,
    restrictedProjectFundingInPersonalCash,
    restrictedProjectFundingAttributionGaps,
    rejectedCompletionContradictionNodes,
    invalidFinancialNarrativeClaimNodes,
    invalidInternalTransitionNodes,
    duplicateChoiceIdNodes,
    duplicateCanonicalFallbackNodes,
    visibleGenerationPauses,
    unclassifiedGenerationCalls
  };
}

export const FINANCIAL_PRODUCTION_AUDIT_PATTERNS = {
  internalLedgerText: INTERNAL_LEDGER_TEXT,
  debtCompletionText: DEBT_COMPLETION_TEXT,
  negativeNetWorthSuccessText: NEGATIVE_NET_WORTH_SUCCESS_TEXT,
  propertyPossessionText: PROPERTY_POSSESSION_TEXT
};
