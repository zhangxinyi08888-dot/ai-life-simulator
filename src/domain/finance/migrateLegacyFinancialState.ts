import type { FinancialState } from "../../types";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type { DebtAccount, FinancialEvidence, FinancialLedger } from "./types";

function legacyEvidence(reasonCode: string): FinancialEvidence[] {
  return [{
    source: "legacy_migration",
    reasonCode,
    confidence: 0.5
  }];
}

export function migrateLegacyFinancialState(input: {
  id: string;
  legacyState: FinancialState;
  linkedCareerStateId?: string;
}): FinancialLedger {
  const state = input.legacyState;
  const evidence = legacyEvidence("LEGACY_FINANCIAL_STATE_MIGRATION");
  const assetAccounts = [
    ...(state.investmentAssetsWan > 0 ? [{
      id: "legacy_investment_assets",
      type: "investment" as const,
      displayName: "旧版投资资产聚合",
      marketValueWan: roundWan(state.investmentAssetsWan),
      liquidity: "liquid" as const,
      status: "active" as const,
      factStatus: "estimated" as const,
      openedAtAgeInMonths: state.asOfAgeInMonths,
      evidence
    }] : []),
    ...(state.propertyMarketValueWan > 0 ? [{
      id: "legacy_property_assets",
      type: "property" as const,
      displayName: "旧版房产聚合",
      marketValueWan: roundWan(state.propertyMarketValueWan),
      liquidity: "illiquid" as const,
      status: "active" as const,
      factStatus: "estimated" as const,
      openedAtAgeInMonths: state.asOfAgeInMonths,
      evidence
    }] : []),
    ...(state.businessAndOtherAssetsWan > 0 ? [{
      id: "legacy_business_and_other_assets",
      type: "other_personal_asset" as const,
      displayName: "旧版企业及其他资产混合项",
      marketValueWan: roundWan(state.businessAndOtherAssetsWan),
      liquidity: "illiquid" as const,
      status: "active" as const,
      factStatus: "needs_review" as const,
      openedAtAgeInMonths: state.asOfAgeInMonths,
      evidence
    }] : [])
  ];
  const debtAccounts: DebtAccount[] = state.totalDebtWan > 0 ? [{
    id: "legacy_total_debt",
    type: "family_or_personal_loan" as const,
    displayName: "旧版债务聚合",
    principalWan: roundWan(state.totalDebtWan),
    openedAtAgeInMonths: state.asOfAgeInMonths,
    status: "active" as const,
    repaymentPolicy: { mode: "event_driven" as const },
    factStatus: "needs_review" as const,
    evidence
  }] : [];
  if (state.cashWan < 0) {
    debtAccounts.push({
      id: "legacy_cash_shortfall",
      type: "liquidity_shortfall",
      displayName: "旧版负现金迁移形成的流动性缺口",
      principalWan: roundWan(-state.cashWan),
      openedAtAgeInMonths: state.asOfAgeInMonths,
      status: "active",
      repaymentPolicy: { mode: "event_driven" },
      factStatus: "needs_review",
      evidence
    });
  }
  const incomeSources = state.annualAfterTaxIncomeWan > 0 ? [{
    id: "legacy_recurring_income",
    type: "other" as const,
    displayName: "旧版持续收入聚合",
    annualNetAmountWan: roundWan(state.annualAfterTaxIncomeWan),
    accrualPolicy: "annual" as const,
    activeFromAgeInMonths: state.asOfAgeInMonths,
    status: "active" as const,
    linkedCareerStateId: input.linkedCareerStateId,
    factStatus: "estimated" as const,
    evidence
  }] : [];
  const expenseCommitments = state.annualCoreExpenseWan > 0 ? [{
    id: "legacy_core_expense",
    type: "basic_living" as const,
    displayName: "旧版核心支出聚合",
    monthlyAmountWan: roundWan(state.annualCoreExpenseWan / 12),
    activeFromAgeInMonths: state.asOfAgeInMonths,
    status: "active" as const,
    factStatus: "estimated" as const,
    evidence
  }] : [];

  return initializeFinancialLedger({
    id: input.id,
    asOfAgeInMonths: state.asOfAgeInMonths,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: roundWan(Math.max(0, state.cashWan)),
        status: "active",
        factStatus: state.isEstimated ? "estimated" : "known",
        evidence
      }],
      assetAccounts,
      debtAccounts,
      incomeSources,
      expenseCommitments,
      unresolvedIssues: [{
        id: `legacy_uncertainty_${state.asOfAgeInMonths}`,
        code: "LEGACY_UNCERTAINTY",
        severity: "warning",
        relatedProposalIds: [],
        summary: "V1 聚合财务快照缺少账户、来源和债务条款明细",
        createdAtAgeInMonths: state.asOfAgeInMonths
      }]
    }
  });
}
