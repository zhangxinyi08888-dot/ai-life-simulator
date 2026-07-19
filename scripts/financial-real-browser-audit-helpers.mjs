const businessExpensePattern = /(?:公司|团队|项目|门店|工作室|机构)[^。；]{0,30}(?:工资|薪酬|人力成本|运营成本|服务器|市场推广|采购|办公成本)|(?:团队工资|员工工资|助理补贴|企业运营)/u;
const businessRevenuePattern = /(?:公司|SaaS|产品|平台|客户合同|客户年费)[^。；]{0,30}(?:营收|收入|年费|回款|销售额)|(?:订阅收入|公司月收入|项目营收)/u;
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
      return businessRevenuePattern.test(text) && !personalReceiptPattern.test(text);
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
