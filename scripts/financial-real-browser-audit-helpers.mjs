const businessExpensePattern = /(?:公司|团队|项目|门店|工作室|机构|中心)[^。；]{0,40}(?:工资|薪酬|人力成本|运营成本|服务器|市场推广|采购|办公成本|仓库|场地|审计费)|(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,30}(?:会计|员工|助理|工程师|销售|运营)[^。；]{0,20}(?:月薪|工资|薪酬)|(?:专职会计|员工|助理|工程师|销售|运营)[^。；]{0,16}(?:月薪|工资|薪酬)|(?:仓库|办公室|门店|场地)(?:月租|租金)|(?:团队工资|员工工资|助理补贴|企业运营)/u;
const businessRevenuePattern = /(?:公司|SaaS|产品|平台|客户合同|客户年费|工作室|机构|中心|基金会|协会|公益项目)[^。；]{0,45}(?:营收|收入|年费|回款|销售额|资助|拨款|赞助|项目款|首期款|可支配资金)|(?:订阅收入|公司月收入|项目营收|项目资助|项目拨款)/u;
const personalReceiptPattern = /(?:个人(?:工资|薪酬|提款|顾问费|咨询费|分红|股息)|创始人提款|税后工资|月薪|年薪|利润分配|转入个人|向你支付|你(?:领取|获得|收到)[^。；]{0,12}(?:工资|薪酬|提款|顾问费|咨询费|分红|股息))/u;

function ledgerFactText(item) {
  return [item?.id, item?.displayName, ...(item?.evidence || []).map((evidence) => evidence?.excerpt)]
    .filter(Boolean)
    .join(" ");
}

export function personalLedgerBusinessBoundaryViolations(ledger = {}) {
  const incomeSourceIds = (ledger.incomeSources || [])
    .filter((source) => source.status === "active")
    .filter((source) => {
      const text = ledgerFactText(source);
      const personalIncomeType = ["salary", "contract", "self_employment_draw", "business_dividend"].includes(source.type);
      return businessRevenuePattern.test(text) && !personalReceiptPattern.test(text)
        && !(personalIncomeType && /工资|薪酬|顾问|咨询|提款|分红|股息/u.test(text));
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
    const completedCompensation = /正式(?:加入|入职|受聘)|决定接受|接受了|签下|转为[^。；]{0,20}(?:顾问|兼职|全职)|月薪(?:降至|调整为|维持)|薪资调整为|工资调整为|给自己/u.test(sentence);
    if (candidateCompensation && !completedCompensation) return [];
    if (!/(?:你(?:的|本人|个人)?[^。；]{0,45}|给自己[^。；]{0,24})(?:薪资调整为|工资调整为|税后工资|税后月薪|月薪|年薪)|薪资调整为[^。；]{0,18}(?:年薪|月薪)/u.test(sentence)) return [];
    const monthly = [...sentence.matchAll(/(?:税后)?月薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*(万|元)/gu)]
      .filter((match) => !/(?:招聘|招募|新招|聘请|雇佣)[^。；]{0,70}(?:会计|员工|助理|工程师|销售|运营|护工)[^。；]{0,35}$/u.test(sentence.slice(Math.max(0, Number(match.index) - 110), Number(match.index))))
      .map((match) => Math.round(Number(match[1]) * (match[2] === "元" ? 0.0001 : 1) * 12 * 10000) / 10000);
    const annual = [...sentence.matchAll(/(?:税后)?年薪(?:达到|提升至|升至|降至|恢复至|稳定在|调整为|维持|约为|为|约)?\s*(\d+(?:\.\d+)?)\s*万/gu)]
      .map((match) => Number(match[1]));
    return [...monthly, ...annual];
  });
}
