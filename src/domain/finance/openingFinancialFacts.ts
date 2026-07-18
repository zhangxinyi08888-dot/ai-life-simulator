import type { FinancialState, QuestionTurn, UserInitialData } from "../../types";
import { roundWan } from "./ledgerMath";

export interface OpeningFinancialFacts {
  evidenceText: string;
  cashWan?: number;
  investmentAssetsWan?: number;
  propertyMarketValueWan?: number;
  ownsProperty: boolean;
  mortgagePrincipalWan?: number;
  mortgageMonthlyPaymentWan?: number;
  annualAfterTaxIncomeWan?: number;
}

function amountWan(value: string, unit: string): number | undefined {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return roundWan(unit.startsWith("万") ? amount : amount / 10_000);
}

function matchAmount(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = amountWan(match[1], match[2]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function openingFinancialEvidenceText(userData: UserInitialData, answers: QuestionTurn[]): string {
  return [
    userData.currentSituation,
    userData.regressionSituation,
    userData.milestoneCareer,
    userData.milestoneOther,
    ...(userData.milestones || []).map((item) => item.content),
    ...answers.map((item) => item.answer || "")
  ].filter(Boolean).join("\n");
}

export function extractOpeningFinancialFacts(userData: UserInitialData, answers: QuestionTurn[]): OpeningFinancialFacts {
  const evidenceText = openingFinancialEvidenceText(userData, answers);
  const mortgagePrincipalWan = matchAmount(evidenceText, [
    /(?:房贷|按揭)(?:余额|本金|还剩|剩余)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:还背着|背着)[^。；]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:房贷|按揭)/
  ]);
  const mortgageMonthlyPaymentWan = matchAmount(evidenceText, [
    /(?:月供|每月还款|每个月还款)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:每月|每个月)[^\d。；]{0,12}(?:偿还|支付)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]);
  const propertyMarketValueWan = matchAmount(evidenceText, [
    /(?:房产|住房|房子|公寓)(?:市值|价值|总价|买价|购入价)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:的房子|的住房|的公寓)/
  ]);
  const ownsProperty = propertyMarketValueWan !== undefined
    || mortgagePrincipalWan !== undefined
    || /(?:名下|自有|买了|购入|刚买|背上房贷)[^。；]{0,12}(?:房|住房|公寓)|(?:房|住房|公寓)[^。；]{0,12}(?:名下|自有|按揭)/.test(evidenceText);

  return {
    evidenceText,
    cashWan: matchAmount(evidenceText, [
      /(?:现金|存款|备用金|应急金|家庭备用金)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
      /(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:现金|存款|备用金|应急金)/
    ]),
    investmentAssetsWan: matchAmount(evidenceText, [
      /(?:基金|股票|理财|投资资产|投资账户)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
      /(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:基金|股票|理财|投资)/
    ]),
    propertyMarketValueWan,
    ownsProperty,
    mortgagePrincipalWan,
    mortgageMonthlyPaymentWan,
    annualAfterTaxIncomeWan: matchAmount(evidenceText, [
      /(?:税后年薪|税后年收入|年薪税后|年收入税后)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
      /(?:年薪|年收入)[^。；]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:税后)/
    ])
  };
}

export function applyOpeningFactsToFinancialState(
  state: FinancialState,
  facts: OpeningFinancialFacts
): FinancialState {
  const next = { ...state };
  if (facts.cashWan !== undefined) next.cashWan = facts.cashWan;
  if (facts.investmentAssetsWan !== undefined) next.investmentAssetsWan = facts.investmentAssetsWan;
  if (facts.propertyMarketValueWan !== undefined) next.propertyMarketValueWan = facts.propertyMarketValueWan;
  if (facts.mortgagePrincipalWan !== undefined) next.totalDebtWan = facts.mortgagePrincipalWan;
  if (facts.annualAfterTaxIncomeWan !== undefined) next.annualAfterTaxIncomeWan = facts.annualAfterTaxIncomeWan;
  next.annualDisposableIncomeWan = roundWan(next.annualAfterTaxIncomeWan - next.annualCoreExpenseWan);
  next.netWorthWan = roundWan(
    next.cashWan
    + next.investmentAssetsWan
    + next.propertyMarketValueWan
    + next.businessAndOtherAssetsWan
    - next.totalDebtWan
  );
  return next;
}
