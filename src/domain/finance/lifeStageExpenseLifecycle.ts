import type {
  AcceptedFinancialEvent,
  ExpenseCommitment,
  ExpenseCommitmentType,
  FinancialEvidence,
  FinancialLedger,
  FinancialLedgerIssue
} from "./types";

export type LifeStageExpenseResponsibility =
  | "household_transition"
  | "housing"
  | "child_support"
  | "elder_care"
  | "healthcare"
  | "insurance"
  | "retirement_healthcare";

export interface LifeStageExpenseTrigger {
  responsibility: LifeStageExpenseResponsibility;
  expenseType: ExpenseCommitmentType;
  reasonCode: string;
  evidenceExcerpt: string;
  conservativeMonthlyAmountWan: number;
}

export interface LifeStageExpenseLifecycleResult {
  acceptedEvents: AcceptedFinancialEvent<"expense_commitment_started">[];
  issues: FinancialLedgerIssue[];
  reviewReasonCodes: string[];
  triggers: LifeStageExpenseTrigger[];
  coveredTriggerCount: number;
}

const NON_COMPLETED = /计划|打算|考虑|准备|希望|可能|如果|将来|未来|讨论|商量|看房|物色|考虑购买|考虑租/u;

const RESPONSIBILITY_RULES: Array<{
  responsibility: LifeStageExpenseResponsibility;
  expenseType: ExpenseCommitmentType;
  reasonCode: string;
  monthlyAmountWan: number;
  pattern: RegExp;
}> = [
  {
    responsibility: "household_transition",
    expenseType: "basic_living",
    reasonCode: "LIFE_STAGE_SHARED_HOUSEHOLD",
    monthlyAmountWan: 0.45,
    pattern: /(?:你|你们)[^。！？；]{0,32}(?:正式结婚|登记结婚|举办婚礼后共同生活|开始共同生活)/u
  },
  {
    responsibility: "housing",
    expenseType: "housing",
    reasonCode: "LIFE_STAGE_HOUSING_RESPONSIBILITY",
    monthlyAmountWan: 0.15,
    pattern: /(?:你|你们)[^。！？；]{0,30}(?:正式搬入|搬进新家|租下|开始租住|购房后入住|入住新房)/u
  },
  {
    responsibility: "child_support",
    expenseType: "dependent_support",
    reasonCode: "LIFE_STAGE_CHILD_SUPPORT",
    monthlyAmountWan: 0.25,
    pattern: /(?:你|你们)[^。！？；]{0,36}(?:孩子出生|生下孩子|迎来孩子|成为父母|开始承担育儿|开始抚养)/u
  },
  {
    responsibility: "elder_care",
    expenseType: "dependent_support",
    reasonCode: "LIFE_STAGE_ELDER_CARE",
    monthlyAmountWan: 0.2,
    pattern: /你[^。！？；]{0,40}(?:开始承担|正式承担|长期承担|每月支付)[^。！？；]{0,24}(?:父母|母亲|父亲)[^。！？；]{0,20}(?:赡养|护理|照护|医疗)/u
  },
  {
    responsibility: "healthcare",
    expenseType: "healthcare",
    reasonCode: "LIFE_STAGE_RECURRING_HEALTHCARE",
    monthlyAmountWan: 0.1,
    pattern: /你[^。！？；]{0,36}(?:开始长期治疗|需要长期治疗|开始持续用药|需要持续用药|每月复诊|长期康复)/u
  },
  {
    responsibility: "insurance",
    expenseType: "insurance",
    reasonCode: "LIFE_STAGE_INSURANCE_COMMITMENT",
    monthlyAmountWan: 0.05,
    pattern: /你[^。！？；]{0,36}(?:购买了|配置了|正式投保|开始缴纳)[^。！？；]{0,20}(?:医疗险|重疾险|养老保险|商业保险)/u
  },
  {
    responsibility: "retirement_healthcare",
    expenseType: "healthcare",
    reasonCode: "LIFE_STAGE_RETIREMENT_HEALTHCARE_REVIEW",
    monthlyAmountWan: 0.1,
    pattern: /你[^。！？；]{0,28}(?:正式退休|办理退休)[^。！？；]{0,28}(?:固定医疗|长期用药|定期复诊|康复支出)/u
  }
];

function completedProtagonistSentences(narrativeText: string): string[] {
  return narrativeText
    .split(/(?<=[。！？；])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => /你|你们/u.test(sentence))
    .filter((sentence) => !NON_COMPLETED.test(sentence));
}

export function detectLifeStageExpenseTriggers(narrativeText: string): LifeStageExpenseTrigger[] {
  const triggers = new Map<LifeStageExpenseResponsibility, LifeStageExpenseTrigger>();
  for (const sentence of completedProtagonistSentences(narrativeText)) {
    for (const rule of RESPONSIBILITY_RULES) {
      if (!rule.pattern.test(sentence) || triggers.has(rule.responsibility)) continue;
      triggers.set(rule.responsibility, {
        responsibility: rule.responsibility,
        expenseType: rule.expenseType,
        reasonCode: rule.reasonCode,
        evidenceExcerpt: sentence,
        conservativeMonthlyAmountWan: rule.monthlyAmountWan
      });
    }
  }
  return [...triggers.values()];
}

function eventExpenseType(event: AcceptedFinancialEvent): ExpenseCommitmentType | undefined {
  if (event.kind === "expense_commitment_started") return event.payload.type;
  if (event.kind === "expense_commitment_adjusted") return event.payload.nextCommitment.type;
  return undefined;
}

function responsibilityAlreadyCovered(input: {
  trigger: LifeStageExpenseTrigger;
  ledger: FinancialLedger;
  acceptedFinancialEvents: AcceptedFinancialEvent[];
}): boolean {
  const eventCovered = input.acceptedFinancialEvents.some((event) => {
    const type = eventExpenseType(event);
    if (type !== input.trigger.expenseType) return false;
    return event.evidence.some((item) => item.reasonCode === input.trigger.reasonCode)
      || event.evidence.some((item) => item.excerpt === input.trigger.evidenceExcerpt)
      || input.trigger.expenseType !== "dependent_support";
  });
  if (eventCovered) return true;
  return input.ledger.expenseCommitments.some((commitment) => (
    commitment.status === "active"
    && commitment.type === input.trigger.expenseType
    && (commitment.evidence.some((item) => item.reasonCode === input.trigger.reasonCode)
      || (input.trigger.expenseType !== "dependent_support" && commitment.factStatus === "known"))
  ));
}

function commitmentForTrigger(trigger: LifeStageExpenseTrigger, ageInMonths: number): ExpenseCommitment {
  const acceptedEvidence: FinancialEvidence = {
    source: "accepted_simulation_outcome",
    excerpt: trigger.evidenceExcerpt,
    reasonCode: trigger.reasonCode,
    confidence: 1,
    financialScope: "personal"
  };
  const policyEvidence: FinancialEvidence = {
    source: "system_policy",
    reasonCode: `${trigger.reasonCode}_CONSERVATIVE_ESTIMATE`,
    confidence: 1,
    financialScope: "personal"
  };
  return {
    id: `life_stage_expense_${trigger.responsibility}_${ageInMonths}`,
    type: trigger.expenseType,
    displayName: trigger.responsibility === "household_transition" ? "共同生活基础支出（待确认）"
      : trigger.responsibility === "housing" ? "住房持续支出（待确认）"
      : trigger.responsibility === "child_support" ? "育儿持续支出（待确认）"
        : trigger.responsibility === "elder_care" ? "父母照护支出（待确认）"
          : trigger.responsibility === "insurance" ? "保险持续支出（待确认）"
            : "医疗持续支出（待确认）",
    monthlyAmountWan: trigger.conservativeMonthlyAmountWan,
    activeFromAgeInMonths: ageInMonths,
    status: "active",
    factStatus: "needs_review",
    accrualReviewStatus: "conservative",
    evidence: [acceptedEvidence, policyEvidence]
  };
}

export function applyLifeStageExpenseLifecycle(input: {
  narrativeText: string;
  ledger: FinancialLedger;
  acceptedFinancialEvents: AcceptedFinancialEvent[];
  ageInMonths: number;
}): LifeStageExpenseLifecycleResult {
  const triggers = detectLifeStageExpenseTriggers(input.narrativeText);
  const uncovered = triggers.filter((trigger) => !responsibilityAlreadyCovered({
    trigger,
    ledger: input.ledger,
    acceptedFinancialEvents: input.acceptedFinancialEvents
  }));
  const acceptedEvents = uncovered.map((trigger): AcceptedFinancialEvent<"expense_commitment_started"> => {
    const commitment = commitmentForTrigger(trigger, input.ageInMonths);
    return {
      id: `accepted_${commitment.id}`,
      proposalId: `system_${commitment.id}`,
      kind: "expense_commitment_started",
      effectiveAtAgeInMonths: input.ageInMonths,
      payload: commitment,
      evidence: commitment.evidence,
      acceptedByReasonCodes: [trigger.reasonCode]
    };
  });
  const issues = uncovered.map((trigger): FinancialLedgerIssue => ({
    id: `expense_lifecycle_review_${trigger.responsibility}_${input.ageInMonths}`,
    code: "PENDING_FACT",
    severity: "warning",
    status: "open",
    relatedProposalIds: [],
    relatedAccountIds: [`life_stage_expense_${trigger.responsibility}_${input.ageInMonths}`],
    summary: `${trigger.evidenceExcerpt}；已启用保守支出责任，等待后续事实确认金额`,
    createdAtAgeInMonths: input.ageInMonths
  }));
  return {
    acceptedEvents,
    issues,
    reviewReasonCodes: uncovered.map((trigger) => `${trigger.reasonCode}_AMOUNT_NEEDS_REVIEW`),
    triggers,
    coveredTriggerCount: triggers.length
  };
}
