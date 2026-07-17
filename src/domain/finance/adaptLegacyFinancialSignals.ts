import type { FinancialSignals } from "../../types";
import type { CareerState } from "../career/types";
import { roundWan } from "./ledgerMath";
import type {
  FinancialEventProposal,
  FinancialLedger,
  FinancialLedgerIssue,
  IncomeSource,
  ExpenseCommitment
} from "./types";

function issue(input: {
  id: string;
  code: FinancialLedgerIssue["code"];
  severity?: FinancialLedgerIssue["severity"];
  summary: string;
  ageInMonths: number;
}): FinancialLedgerIssue {
  return {
    id: input.id,
    code: input.code,
    severity: input.severity || "warning",
    relatedProposalIds: [],
    summary: input.summary,
    createdAtAgeInMonths: input.ageInMonths
  };
}

export function adaptLegacyFinancialSignalsToProposals(input: {
  signals: FinancialSignals;
  narrativeEvidence: string;
  currentCareerState: CareerState;
  currentLedger: FinancialLedger;
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
  sourceOutcomeId?: string;
  simulationTransactionId: string;
  hasStructuredBusinessActivity?: boolean;
}): { proposals: FinancialEventProposal[]; issues: FinancialLedgerIssue[] } {
  const proposals: FinancialEventProposal[] = [];
  const issues: FinancialLedgerIssue[] = [];
  const effectiveAtAgeInMonths = input.periodEndAgeInMonths;
  const evidence = input.narrativeEvidence.trim();
  const base = {
    effectiveAtAgeInMonths,
    evidence,
    sourceOutcomeId: input.sourceOutcomeId,
    confidence: input.signals.confidence
  };

  // FinancialSignals.employmentStatus and incomeMonths have no write authority.
  // Career owns identity; active intervals own the number of accrued months.
  if (input.hasStructuredBusinessActivity && input.signals.oneOffIncomeWan > 0) {
    issues.push(issue({
      id: `legacy_business_boundary_${input.simulationTransactionId}`,
      code: "BUSINESS_PERSONAL_BOUNDARY_CONFLICT",
      severity: "blocking",
      summary: "旧信号在企业活动节点返回个人一次性收入，必须改为公司融资、分红或股权出售事件",
      ageInMonths: effectiveAtAgeInMonths
    }));
  }

  const activeIncome = input.currentLedger.incomeSources.find((source) => (
    source.status === "active"
    && source.linkedCareerStateId === input.currentCareerState.id
  ));
  if (input.signals.monthlyNetIncomeWan > 0) {
    const activeMonthlyAmount = activeIncome?.monthlyNetAmountWan
      ?? (activeIncome?.annualNetAmountWan === undefined ? undefined : activeIncome.annualNetAmountWan / 12);
    if (activeIncome && (
      activeIncome.accrualPolicy !== "monthly"
      || Math.abs((activeMonthlyAmount || 0) - input.signals.monthlyNetIncomeWan) > 0.0001
    )) {
      const nextSource: IncomeSource = {
        ...activeIncome,
        monthlyNetAmountWan: roundWan(input.signals.monthlyNetIncomeWan),
        annualNetAmountWan: undefined,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: effectiveAtAgeInMonths,
        factStatus: "estimated",
        evidence: [...activeIncome.evidence]
      };
      proposals.push({
        id: `legacy_income_adjust_${input.simulationTransactionId}`,
        kind: "income_source_adjusted",
        payload: { incomeSourceId: activeIncome.id, nextSource },
        ...base
      });
    } else if (!activeIncome && ["employed", "part_time", "self_employed", "medical_leave"].includes(input.currentCareerState.employmentStatus)) {
      const source: IncomeSource = {
        id: `legacy_income_${input.simulationTransactionId}`,
        type: input.currentCareerState.employmentStatus === "self_employed" ? "self_employment_draw" : "salary",
        displayName: "旧模型信号转换的当前个人收入",
        monthlyNetAmountWan: roundWan(input.signals.monthlyNetIncomeWan),
        accrualPolicy: "monthly",
        activeFromAgeInMonths: effectiveAtAgeInMonths,
        status: "active",
        linkedCareerStateId: input.currentCareerState.id,
        factStatus: "estimated",
        evidence: []
      };
      proposals.push({
        id: `legacy_income_start_${input.simulationTransactionId}`,
        kind: "income_source_started",
        payload: source,
        ...base
      });
    }
  }

  const activeLiving = input.currentLedger.expenseCommitments.find((commitment) => commitment.status === "active" && commitment.type === "basic_living");
  if (input.signals.monthlyLivingExpenseWan > 0 && !activeLiving) {
    const commitment: ExpenseCommitment = {
      id: `legacy_living_${input.simulationTransactionId}`,
      type: "basic_living",
      displayName: "旧模型信号转换的基础生活支出",
      monthlyAmountWan: roundWan(input.signals.monthlyLivingExpenseWan),
      activeFromAgeInMonths: effectiveAtAgeInMonths,
      status: "active",
      factStatus: "estimated",
      evidence: []
    };
    proposals.push({
      id: `legacy_living_start_${input.simulationTransactionId}`,
      kind: "expense_commitment_started",
      payload: commitment,
      ...base
    });
  }

  if (input.signals.oneOffIncomeWan > 0 && !input.hasStructuredBusinessActivity) {
    proposals.push({
      id: `legacy_one_off_income_${input.simulationTransactionId}`,
      kind: "one_off_income_received",
      payload: { destinationCashAccountId: "primary_cash", amountWan: roundWan(input.signals.oneOffIncomeWan) },
      ...base
    });
  }
  if (input.signals.oneOffExpenseWan > 0) {
    proposals.push({
      id: `legacy_one_off_expense_${input.simulationTransactionId}`,
      kind: "one_off_expense_paid",
      payload: { sourceCashAccountId: "primary_cash", amountWan: roundWan(input.signals.oneOffExpenseWan) },
      ...base
    });
  }

  if (input.signals.personalDebtChangeWan !== 0) {
    issues.push(issue({
      id: `legacy_ambiguous_debt_${input.simulationTransactionId}`,
      code: "LEGACY_UNCERTAINTY",
      severity: "blocking",
      summary: "personalDebtChangeWan 无法区分借款、还本、减免或重组，禁止自动转换",
      ageInMonths: effectiveAtAgeInMonths
    }));
  }
  if (input.signals.assetValueChangeWan !== 0 || input.signals.propertyMarketValueChangeWan !== 0) {
    issues.push(issue({
      id: `legacy_ambiguous_asset_${input.simulationTransactionId}`,
      code: "UNSUPPORTED_LARGE_VALUE_CHANGE",
      severity: "blocking",
      summary: "旧资产净变化字段无法区分购买、出售或重估，必须改为有方向事件",
      ageInMonths: effectiveAtAgeInMonths
    }));
  }
  return { proposals, issues };
}
