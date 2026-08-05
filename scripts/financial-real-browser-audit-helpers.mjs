const businessExpensePattern = /(?:公司|团队|项目|门店|工作室|机构|中心)[^。；]{0,40}(?:工资|薪酬|人力成本|运营成本|服务器|市场推广|采购|办公成本|仓库|场地|审计费)|(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,30}(?:会计|员工|助理|工程师|销售|运营)[^。；]{0,20}(?:月薪|工资|薪酬)|(?:专职会计|员工|助理|工程师|销售|运营)[^。；]{0,16}(?:月薪|工资|薪酬)|(?:仓库|办公室|门店|场地)(?:月租|租金)|(?:团队工资|员工工资|助理补贴|企业运营)/u;
const businessRevenuePattern = /(?:公司|SaaS|产品|平台|客户合同|客户年费|工作室|机构|中心|基金会|协会|公益项目)[^。；]{0,45}(?:营收|收入|年费|回款|销售额|资助|拨款|赞助|项目款|首期款|可支配资金)|(?:订阅收入|公司月收入|项目营收|项目资助|项目拨款)/u;
const personalReceiptPattern = /(?:个人(?:工资|薪酬|提款|顾问费|咨询费|分红|股息)|创始人提款|税后工资|月薪|年薪|利润分配|转入个人|向你支付|你(?:领取|获得|收到)[^。；]{0,12}(?:工资|薪酬|提款|顾问费|咨询费|分红|股息))/u;
const thirdPartyIncomeReceiptPattern = /(?:妻子|丈夫|伴侣|配偶|女友|男友|父亲|母亲|妈妈|爸爸|儿子|女儿|孩子|岳父|岳母|公公|婆婆|小余|她|他)[^。；]{0,45}(?:月薪|年薪|工资|薪资|收入|到手|分红|股息)/u;
const thirdPartyIncomeIdentityPattern = /(?:^|\s)(?:妻子|丈夫|伴侣|配偶|父亲|母亲|妈妈|爸爸|儿子|女儿|孩子|小余)(?:\s|_|的|出纳|工资|薪资|收入|月薪|年薪|$)/u;

function ledgerFactText(item) {
  return [item?.id, item?.displayName, ...(item?.evidence || []).map((evidence) => evidence?.excerpt)]
    .filter(Boolean)
    .join(" ");
}

function hasExplicitPersonalServiceReceipt(source) {
  const personalEvidence = (source?.evidence || [])
    .filter((evidence) => evidence?.financialScope === "personal")
    .map((evidence) => evidence?.excerpt)
    .filter(Boolean)
    .join(" ");
  if (!personalEvidence) return false;
  const text = [source?.displayName, personalEvidence].filter(Boolean).join(" ");
  return /(?:个人)?(?:顾问|咨询)(?:费|收入|报酬|薪酬)|(?:顾问|咨询)(?:工作|服务|合同|协议)[^。；]{0,20}(?:收入|报酬|薪酬|费用|年费)/u.test(text);
}

function personalCompensationEvidenceSentences(source) {
  const personalEvidence = (source?.evidence || [])
    .filter((evidence) => evidence?.financialScope === "personal")
    .map((evidence) => evidence?.excerpt)
    .filter(Boolean)
    .join(" ");
  return personalEvidence ? personalEvidence.split(/(?<=[。！？；])/u) : [];
}

function hasExplicitPersonalCompensationReceipt(source) {
  return personalCompensationEvidenceSentences(source).some((sentence) => (
    /(?:你的|你本人(?:的)?|你个人(?:的)?|主角(?:的)?|本人(?:的)?)(?:[^。；]{0,32})(?:税后(?:年|月)?收入|(?:税后)?(?:年薪|月薪)|工资|薪资|年收入|月收入|个人收入|个人进账)|(?:你|主角|本人)(?:仍|一直|继续)?(?:在|于|从|受聘于|入职)[^。；]{0,48}(?:税后(?:年|月)?收入|(?:税后)?(?:年薪|月薪)|工资|薪资|年收入|月收入|个人收入|个人进账)/u.test(sentence)
  ));
}

function explicitlyStatedPersonalAnnualCompensationWan(source) {
  return personalCompensationEvidenceSentences(source).flatMap((sentence) => {
    const possessiveAmounts = [...sentence.matchAll(/(?:你的|你本人(?:的)?|你个人(?:的)?|主角(?:的)?|本人(?:的)?)(?:[^。；]{0,32}?)(?:年税后收入|税后年收入|(?:税后)?年薪|年工资|年薪资|年收入|个人年收入)(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    const employmentAmounts = [...sentence.matchAll(/(?:你|主角|本人)(?:仍|一直|继续)?(?:在|于|从|受聘于|入职)[^。；]{0,48}?(?:年税后收入|税后年收入|(?:税后)?年薪|年工资|年薪资|年收入|个人年收入)(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    return [...possessiveAmounts, ...employmentAmounts].filter(Number.isFinite);
  });
}

function hasAmountMatchedPersonalCompensationReceipt(source) {
  if (!hasExplicitPersonalCompensationReceipt(source)) return false;
  const identityText = [source?.id, source?.displayName].filter(Boolean).join(" ");
  const requiresAmountMatch = source?.type === "other" || /(?:legacy|recurring|持续收入|聚合)/iu.test(identityText);
  const monthlyAmountWan = Number(source?.monthlyNetAmountWan);
  const annualAmountWan = Number(source?.annualNetAmountWan);
  const statedAnnualAmountsWan = explicitlyStatedPersonalAnnualCompensationWan(source);
  const sourceAnnualAmountWan = Number.isFinite(monthlyAmountWan) && monthlyAmountWan > 0
    ? monthlyAmountWan * 12
    : annualAmountWan;
  if (!requiresAmountMatch || !Number.isFinite(sourceAnnualAmountWan) || sourceAnnualAmountWan <= 0 || statedAnnualAmountsWan.length === 0) {
    return true;
  }
  return statedAnnualAmountsWan.some((statedAnnualAmountWan) => (
    Math.abs(sourceAnnualAmountWan - statedAnnualAmountWan) <= Math.max(0.1, statedAnnualAmountWan * 0.02)
  ));
}

export function personalLedgerBusinessBoundaryViolations(ledger = {}) {
  const incomeSourceIds = (ledger.incomeSources || [])
    .filter((source) => source.status === "active")
    .filter((source) => {
      const text = ledgerFactText(source);
      const identityText = [source?.id, source?.displayName].filter(Boolean).join(" ");
      const personalIncomeType = ["salary", "contract", "self_employment_draw", "business_dividend"].includes(source.type);
      const explicitPersonalServiceReceipt = hasExplicitPersonalServiceReceipt(source);
      const explicitPersonalCompensationReceipt = hasAmountMatchedPersonalCompensationReceipt(source);
      const thirdPartyIncome = (thirdPartyIncomeReceiptPattern.test(text)
        || thirdPartyIncomeIdentityPattern.test(identityText))
        && !/(?:给你|向你|转入你的|转给你|汇给你|共同账户)/u.test(text);
      return thirdPartyIncome || (businessRevenuePattern.test(text) && !personalReceiptPattern.test(text)
        && !explicitPersonalServiceReceipt
        && !explicitPersonalCompensationReceipt
        && !(personalIncomeType && /工资|薪酬|顾问|咨询|提款|分红|股息/u.test(text)));
    })
    .map((source) => source.id);
  const expenseCommitmentIds = (ledger.expenseCommitments || [])
    .filter((commitment) => commitment.status === "active")
    .filter((commitment) => businessExpensePattern.test(ledgerFactText(commitment)))
    .map((commitment) => commitment.id);
  return { incomeSourceIds, expenseCommitmentIds };
}

export function duplicateSingletonExpenseTypes(ledger = {}) {
  const counts = (ledger.expenseCommitments || [])
    .filter((commitment) => commitment.status === "active" && ["basic_living", "housing"].includes(commitment.type))
    .reduce((result, commitment) => {
      result[commitment.type] = (result[commitment.type] || 0) + 1;
      return result;
    }, {});
  return Object.entries(counts).filter(([, count]) => count > 1).map(([type]) => type);
}

export function personalCompensationAnnualAmounts(narrativeText = "") {
  return String(narrativeText).split(/(?<=[。！？；])/u).flatMap((sentence) => {
    if (!/你|你的|本人|自己/u.test(sentence)) return [];
    const candidateCompensation = /猎头|邀请|邀约|推荐|提出|offer|如果|可以给你|考虑|是否|至少|预计|建议|希望/iu.test(sentence);
    const hypotheticalMoveCompensation = /(?:这意味着|如果|若)[^。；]{0,60}(?:辞掉|辞去|离开|去|加入|转到)[^。；]{0,40}(?:月薪|年薪)/u.test(sentence);
    const completedCompensation = /正式(?:加入|入职|受聘)|决定接受|接受了|签下|转为[^。；]{0,20}(?:顾问|兼职|全职)|月薪(?:降至|调整为|维持)|薪资调整为|工资调整为|给自己/u.test(sentence);
    const historicalCompensation = /(?:以前|曾经|当年|过去|原先|原来|上一份|此前)[^。；]{0,24}(?:月薪|年薪|工资|薪资)|(?:辞去|辞掉|离开|放弃|结束)[^。；]{0,24}(?:月薪|年薪|工资|薪资)|(?:月薪|年薪|工资|薪资)[^。；]{0,24}(?:的旧工作|的工作后|已经结束|成为过去)/u.test(sentence);
    if ((candidateCompensation || hypotheticalMoveCompensation) && !completedCompensation) return [];
    if (historicalCompensation && !completedCompensation) return [];
    if (!/(?:你(?:的|本人|个人)?[^。；]{0,45}|给自己[^。；]{0,24})(?:薪资调整为|工资调整为|税后工资|税后月薪|月薪|年薪)|薪资调整为[^。；]{0,18}(?:年薪|月薪)/u.test(sentence)) return [];
    const monthlyTotal = [...sentence.matchAll(/(?:每月总计|每月总收入|月总收入|个人每月总收入)(?:约为|约|达到|为)?\s*(\d+(?:\.\d+)?)\s*(万|元)/gu)]
      .map((match) => Math.round(Number(match[1]) * (match[2] === "元" ? 0.0001 : 1) * 12 * 10000) / 10000);
    if (monthlyTotal.length > 0) return monthlyTotal;
    const monthly = [...sentence.matchAll(/(?:税后)?月薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*(万|元)/gu)]
      .filter((match) => !/(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,70}(?:会计|员工|助理|工程师|销售|运营|护工)[^。；]{0,35}$/u.test(sentence.slice(Math.max(0, Number(match.index) - 110), Number(match.index))))
      .map((match) => Math.round(Number(match[1]) * (match[2] === "元" ? 0.0001 : 1) * 12 * 10000) / 10000);
    const annual = [...sentence.matchAll(/(?:税后)?年薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    const annualRange = [...sentence.matchAll(/(?:税后)?年薪(?:将)?(?:从|由)\s*\d+(?:\.\d+)?\s*万(?:元)?[^，。；！？]{0,16}?(?:调整至|提升至|升至|降至|降到|增至|增加到|变为|达到)\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    return [...monthly, ...annual, ...annualRange];
  });
}

export function compensationConversionMismatches(narrativeText = "") {
  return String(narrativeText).split(/(?<=[。！？；])/u).flatMap((sentence) => {
    const monthly = [...sentence.matchAll(/(?:税后)?月薪(?:达到|提升至|升至|降至|降到|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    const annualDirect = [...sentence.matchAll(/(?:税后)?年薪(?:达到|提升至|升至|降至|降到|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    const annualRange = [...sentence.matchAll(/(?:税后)?年薪(?:将)?(?:从|由)\s*\d+(?:\.\d+)?\s*万(?:元)?[^，。；！？]{0,16}?(?:调整至|提升至|升至|降至|降到|增至|增加到|变为|达到)\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    const annual = annualRange.at(-1) ?? annualDirect.at(-1);
    const monthlyWan = monthly.at(-1);
    if (!Number.isFinite(annual) || !Number.isFinite(monthlyWan)) return [];
    const impliedAnnualWan = Number(monthlyWan) * 12;
    if (Math.abs(Number(annual) - impliedAnnualWan) <= Math.max(0.1, Number(annual) * 0.02)) return [];
    return [{ sentence, annualWan: Number(annual), monthlyWan: Number(monthlyWan), impliedAnnualWan }];
  });
}

export function adultBelowPolicyExpenseViolation(input = {}) {
  const ageYears = Number(input.ageInMonths || 0) / 12;
  const financialState = input.financialState || {};
  const ledger = input.ledger || {};
  const annualCoreExpenseWan = Number(financialState.annualCoreExpenseWan || 0);
  if (ageYears < 23 || financialState.employmentStatus === "student" || annualCoreExpenseWan + 0.02 >= 4.2) {
    return false;
  }
  const hasExactLowerLivingAuthority = (ledger.expenseCommitments || []).some((commitment) => (
    commitment.status === "active"
    && commitment.type === "basic_living"
    && commitment.factStatus === "known"
    && Number(commitment.monthlyAmountWan || 0) > 0
    && Number(commitment.monthlyAmountWan || 0) * 12 + 0.02 < 4.2
    && (commitment.evidence || []).some((evidence) => (
      evidence?.financialScope === "personal"
      && (
        evidence?.source === "user_profile"
        || (evidence?.source === "accepted_simulation_outcome" && evidence?.reasonCode === "EVIDENCE_EXACT_MATCHED")
      )
      && /(?:生活|日常|基本)[^。；]{0,24}(?:成本|支出|开销|花费)|(?:每月|月均)[^。；]{0,18}\d/u.test(String(evidence?.excerpt || ""))
    ))
  ));
  return !hasExactLowerLivingAuthority;
}

export function collectVisibleGenerationPauses(record = {}) {
  const pauses = new Map();
  for (const event of record.finalState?.generationEvents || []) {
    if (event?.type !== "visible_pause") continue;
    const key = event.id || `state:${event.historyLength || 0}:${event.debug || event.message || ""}`;
    pauses.set(key, {
      type: "visible_pause",
      generationEventId: event.id,
      historyLength: event.historyLength || 0,
      errorCode: event.errorCode,
      message: event.message,
      debug: event.debug,
      at: event.at,
      source: "app_state"
    });
  }
  for (const event of record.interactionLog || []) {
    if (event?.type !== "recoverable_error") continue;
    const key = event.generationEventId || `trace:${event.historyLength || 0}:${event.debug || event.message || ""}`;
    const existing = pauses.get(key) || {};
    pauses.set(key, {
      ...existing,
      ...event,
      type: "visible_pause",
      source: event.generationEventId ? "app_state_and_runner" : "runner"
    });
  }
  return [...pauses.values()];
}

export function collectRecoveredGenerationAttempts(record = {}) {
  const recoveredIds = new Set((record.finalState?.generationEvents || [])
    .filter((event) => event?.type === "recovered")
    .map((event) => event.id || `state:${event.historyLength || 0}:${event.at || ""}`));
  for (const event of record.interactionLog || []) {
    if (event?.type !== "recoverable_retry_succeeded") continue;
    recoveredIds.add(event.generationEventId || `trace:${event.historyLength || 0}:${event.at || ""}`);
  }
  return recoveredIds.size;
}

export function classifyTerminalFinancialIssues(issues = [], distressedDebtAccountKeys = new Set()) {
  const openIssues = issues.filter((issue) => (issue.status || "open") === "open");
  const blockingOpenIssues = openIssues.filter((issue) => issue.severity === "blocking");
  const servicingWarnings = openIssues.filter((issue) => (
    issue.severity !== "blocking"
    && (issue.code === "DEBT_PAYMENT_MISSED" || issue.code === "DEBT_PAYMENT_DELINQUENT")
  ));
  const servicingWarningAccountKeys = new Set(servicingWarnings.flatMap((issue) => (
    (issue.relatedDebtAccountIds || []).map((debtId) => `${issue.caseSlug}:${debtId}`)
  )));
  const orphanServicingWarnings = [...servicingWarningAccountKeys]
    .filter((key) => !distressedDebtAccountKeys.has(key));
  return {
    openIssues,
    blockingOpenIssues,
    servicingWarnings,
    servicingWarningAccountKeys,
    orphanServicingWarnings,
    servicingWarningOverflow: Math.max(0, servicingWarnings.length - distressedDebtAccountKeys.size)
  };
}
