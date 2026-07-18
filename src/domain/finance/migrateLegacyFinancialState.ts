import type { FinancialState } from "../../types";
import { initializeFinancialLedger } from "./initializeLedger";
import { PRIMARY_CASH_ACCOUNT_ID, roundWan } from "./ledgerMath";
import type { OpeningFinancialFacts } from "./openingFinancialFacts";
import type { DebtAccount, FinancialEvidence, FinancialLedger, IncomeSource } from "./types";

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
  openingFacts?: OpeningFinancialFacts;
}): FinancialLedger {
  const state = input.legacyState;
  const evidence = legacyEvidence("LEGACY_FINANCIAL_STATE_MIGRATION");
  const userEvidence: FinancialEvidence[] = input.openingFacts ? [{
    source: "user",
    excerpt: input.openingFacts.evidenceText,
    reasonCode: "EXPLICIT_OPENING_FINANCIAL_FACT",
    confidence: 1
  }] : [];
  const assetAccounts = [
    ...(state.investmentAssetsWan > 0 ? [{
      id: "legacy_investment_assets",
      type: "investment" as const,
      displayName: "旧版投资资产聚合",
      marketValueWan: roundWan(state.investmentAssetsWan),
      liquidity: "liquid" as const,
      status: "active" as const,
      factStatus: input.openingFacts?.investmentAssetsWan !== undefined ? "known" as const : "estimated" as const,
      openedAtAgeInMonths: state.asOfAgeInMonths,
      evidence: input.openingFacts?.investmentAssetsWan !== undefined ? userEvidence : evidence
    }] : []),
    ...(input.openingFacts?.ownsProperty && state.propertyMarketValueWan === 0 ? [{
      id: "opening_property_value_pending",
      type: "property" as const,
      displayName: "用户明确持有的住房（价值待确认）",
      marketValueWan: 0,
      liquidity: "illiquid" as const,
      status: "active" as const,
      factStatus: "needs_review" as const,
      openedAtAgeInMonths: state.asOfAgeInMonths,
      evidence: userEvidence
    }] : []),
    ...(state.propertyMarketValueWan > 0 ? [{
      id: "legacy_property_assets",
      type: "property" as const,
      displayName: "旧版房产聚合",
      marketValueWan: roundWan(state.propertyMarketValueWan),
      liquidity: "illiquid" as const,
      status: "active" as const,
      factStatus: input.openingFacts?.propertyMarketValueWan !== undefined ? "known" as const : "estimated" as const,
      openedAtAgeInMonths: state.asOfAgeInMonths,
      evidence: input.openingFacts?.propertyMarketValueWan !== undefined ? userEvidence : evidence
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
  const legacyDebtLooksLikeMortgage = (state.propertyMarketValueWan > 0 || input.openingFacts?.ownsProperty) && state.totalDebtWan > 0;
  const explicitMortgagePayment = input.openingFacts?.mortgageMonthlyPaymentWan;
  const estimatedMonthlyPrincipal = legacyDebtLooksLikeMortgage ? roundWan(state.totalDebtWan / 240) : undefined;
  const debtAccounts: DebtAccount[] = state.totalDebtWan > 0 ? [{
    id: input.openingFacts?.mortgagePrincipalWan !== undefined ? "opening_mortgage" : "legacy_total_debt",
    type: legacyDebtLooksLikeMortgage ? "mortgage" as const : "family_or_personal_loan" as const,
    displayName: input.openingFacts?.mortgagePrincipalWan !== undefined ? "用户明确的住房按揭" : legacyDebtLooksLikeMortgage ? "旧版房产关联债务估计" : "旧版债务聚合",
    principalWan: roundWan(state.totalDebtWan),
    openedAtAgeInMonths: state.asOfAgeInMonths,
    status: "active" as const,
    repaymentPolicy: legacyDebtLooksLikeMortgage
      ? {
          mode: "estimated_amortizing" as const,
          monthlyPaymentWan: explicitMortgagePayment,
          monthlyPrincipalWan: estimatedMonthlyPrincipal,
          monthlyInterestWan: explicitMortgagePayment !== undefined
            ? roundWan(Math.max(0, explicitMortgagePayment - (estimatedMonthlyPrincipal || 0)))
            : undefined,
          remainingTermMonths: 240
        }
      : { mode: "event_driven" as const },
    factStatus: input.openingFacts?.mortgagePrincipalWan !== undefined ? "known" as const : "estimated" as const,
    evidence: input.openingFacts?.mortgagePrincipalWan !== undefined
      ? userEvidence
      : legacyDebtLooksLikeMortgage
      ? [{ source: "system_policy", reasonCode: "LEGACY_MORTGAGE_ESTIMATED_240_MONTHS", confidence: 0.6 }, ...evidence]
      : evidence
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
  const incomeSources: IncomeSource[] = state.annualAfterTaxIncomeWan > 0 ? [{
    id: "legacy_recurring_income",
    type: "other" as const,
    displayName: "旧版持续收入聚合",
    annualNetAmountWan: roundWan(state.annualAfterTaxIncomeWan),
    accrualPolicy: "annual" as const,
    activeFromAgeInMonths: state.asOfAgeInMonths,
    status: "active" as const,
    linkedCareerStateId: input.linkedCareerStateId,
    factStatus: "estimated" as const,
    lastConfirmedAtAgeInMonths: state.asOfAgeInMonths,
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
  if (state.employmentStatus === "student" && state.annualCoreExpenseWan > 0) {
    incomeSources.push({
      id: "student_basic_family_support",
      type: "family_support",
      displayName: "学生基础生活费家庭支持",
      monthlyNetAmountWan: expenseCommitments[0].monthlyAmountWan,
      accrualPolicy: "monthly",
      activeFromAgeInMonths: state.asOfAgeInMonths,
      status: "active",
      factStatus: "estimated",
      lastConfirmedAtAgeInMonths: state.asOfAgeInMonths,
      evidence: [{
        source: "system_policy",
        reasonCode: "STUDENT_BASIC_LIVING_FAMILY_COVERED",
        confidence: 0.6
      }]
    });
  }

  return initializeFinancialLedger({
    id: input.id,
    asOfAgeInMonths: state.asOfAgeInMonths,
    openingPosition: {
      cashAccounts: [{
        id: PRIMARY_CASH_ACCOUNT_ID,
        type: "bank_deposit",
        balanceWan: roundWan(Math.max(0, state.cashWan)),
        status: "active",
        factStatus: input.openingFacts?.cashWan !== undefined ? "known" : state.isEstimated ? "estimated" : "known",
        evidence: input.openingFacts?.cashWan !== undefined ? userEvidence : evidence
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
      }, ...(input.openingFacts?.ownsProperty && input.openingFacts.propertyMarketValueWan === undefined ? [{
        id: `opening_property_value_pending_${state.asOfAgeInMonths}`,
        code: "PENDING_FACT" as const,
        severity: "blocking" as const,
        status: "open" as const,
        relatedProposalIds: [],
        relatedAccountIds: ["opening_property_value_pending"],
        summary: "用户明确持有住房和按揭，但未提供房产价值；房产事实已保留，价值等待后续确认",
        createdAtAgeInMonths: state.asOfAgeInMonths
      }] : [])]
    }
  });
}
