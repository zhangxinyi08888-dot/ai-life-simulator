import { readFile, writeFile } from "node:fs/promises";
import {
  commitFinancialDomainTransaction,
  deriveDebtHealthState,
  type AcceptedFinancialEvent,
  type FinancialLedger
} from "../src/domain/finance/index";
import type { SimulationNode, WorldStateSnapshot } from "../src/types";
import { createHistoryItemFromNode } from "../src/utils/historyRestore";
import { deriveDebtNarrativeAuthority } from "../src/utils/debtNarrativeAuthority";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: prepare-debt-pressure-browser-checkpoint.ts <working-json>");

const record = JSON.parse(await readFile(inputPath, "utf8"));
const state = record.latestState;
const currentNode = state?.currentNode as SimulationNode | undefined;
const ledger = currentNode?.financialLedger as FinancialLedger | undefined;
const worldState = currentNode?.worldStateSnapshot as WorldStateSnapshot | undefined;
if (!currentNode || !ledger || !worldState) throw new Error("Working checkpoint lacks an authoritative current node");
if (currentNode.debtHealthState?.level !== "manageable") throw new Error("Checkpoint must begin from manageable debt");
const start = currentNode.ageInMonths ?? currentNode.age * 12;
const end = start + 12;
const incomeSource = ledger.incomeSources.find((source) => source.status === "active" && source.accrualPolicy !== "event_only");
if (!incomeSource) throw new Error("Checkpoint lacks an active recurring income source");
const event: AcceptedFinancialEvent<"income_source_adjusted"> = {
  id: `accepted_browser_income_collapse_${start}`,
  proposalId: `browser_income_collapse_${start}`,
  kind: "income_source_adjusted",
  effectiveAtAgeInMonths: start,
  payload: {
    incomeSourceId: incomeSource.id,
    nextSource: {
      ...structuredClone(incomeSource),
      monthlyNetAmountWan: undefined,
      annualNetAmountWan: 6,
      factStatus: "known",
      evidence: [{
        source: "user",
        excerpt: "核心客户本月终止合同，个人月收入降至0.5万元且未来一年没有替代收入。",
        reasonCode: "BROWSER_CONFIRMED_INCOME_COLLAPSE",
        confidence: 1
      }]
    }
  },
  evidence: [{
    source: "user",
    excerpt: "核心客户本月终止合同，个人月收入降至0.5万元且未来一年没有替代收入。",
    reasonCode: "BROWSER_CONFIRMED_INCOME_COLLAPSE",
    confidence: 1
  }],
  acceptedByReasonCodes: ["EXPLICIT_AMOUNT", "SELECTED_BROWSER_ACTION"]
};
const careerStates = worldState.careerStates ?? [];
const currentCareerStateId = worldState.currentCareerStateId;
if (!currentCareerStateId || careerStates.length === 0) throw new Error("Checkpoint lacks authoritative career state");
const transactionId = `browser_cashflow_collapse_${start}_${end}`;
const committed = commitFinancialDomainTransaction({
  transactionId,
  periodStartAgeInMonths: start,
  periodEndAgeInMonths: end,
  expectedCareerRevision: worldState.careerRevision ?? 0,
  expectedLedgerRevision: ledger.revision,
  currentCareer: { careerStates, currentCareerStateId, careerRevision: worldState.careerRevision ?? 0 },
  currentFinancialLedger: ledger,
  currentWorldState: worldState,
  acceptedCareerTransitions: [],
  acceptedFinancialEvents: [event],
  liquidityPolicy: "auto_shortfall_debt"
});
const debtHealthState = deriveDebtHealthState({
  ledger: committed.financialLedger,
  derivedFinancialState: committed.derivedFinancialState.state,
  previousDebtHealthState: currentNode.debtHealthState
});
if (debtHealthState.level !== "default_risk") {
  throw new Error(`Expected default_risk after deterministic collapse, received ${debtHealthState.level}`);
}
const authority = deriveDebtNarrativeAuthority({
  ledger: committed.financialLedger,
  debtHealthState,
  periodStartAgeInMonths: start,
  acceptedCompletedEventKinds: [event.kind]
});
const paragraphs = [
  "核心客户已经终止合同，个人持续月收入从3.2万元降至0.5万元；必要生活支出与原贷款月供继续到期。",
  authority.canonicalFacts.map((fact) => fact.text).join(""),
  "现金不足后，系统只记录必要生活形成的单一流动性缺口和未足额偿付，没有用新债完成计划还款。"
];
const nextNode: SimulationNode = {
  ...structuredClone(currentNode),
  age: end / 12,
  ageInMonths: end,
  title: "现金流恶化后的十二个月",
  stage: "债务压力形成",
  description: paragraphs.join("\n\n"),
  descriptionParagraphs: paragraphs,
  financialLedger: committed.financialLedger,
  financialState: committed.derivedFinancialState.compatibilityState,
  debtHealthState,
  financialPeriodSummary: committed.financialPeriodSummary,
  financialProcessingMeta: {
    proposalCount: 1,
    acceptedEventCount: 1,
    acceptedCareerTransitionCount: 0,
    blockingIssueCount: 0,
    repairTriggered: false,
    repairLatencyMs: 0,
    totalProcessingLatencyMs: 0,
    debtNarrativeAuthorityVersion: authority.version,
    narrativeFallback: false,
    narrativeFallbackReasonCodes: [],
    rejectedDebtClaimKinds: []
  },
  worldStateSnapshot: committed.worldState,
  eventMeta: {
    eventId: "browser_confirmed_income_collapse",
    eventCategory: "financial",
    eventTags: ["financial", "income_collapse", "debt"],
    eventIntensity: "minor",
    eventMode: "crossroads_opportunity",
    eventSemanticFamily: "financial_income_collapse"
  },
  narrativeMeta: currentNode.narrativeMeta ? {
    ...structuredClone(currentNode.narrativeMeta),
    elapsedMonths: 12,
    elapsedYears: 1,
    storyEpisode: {
      ...structuredClone(currentNode.narrativeMeta.storyEpisode),
      id: `episode_browser_cashflow_collapse_${end}`,
      startAgeInMonths: start,
      endAgeInMonths: end,
      internalTransitions: authority.timeline.map((fact) => ({
        atAgeInMonths: fact.ageInMonths,
        materiality: "meaningful_update" as const,
        summary: fact.kind === "payment_paid" ? "当月按期偿付。" : "当月未能足额偿付。",
        worldDeltas: []
      })),
      decisionCheckpointId: `checkpoint_browser_cashflow_collapse_${end}`,
      summary: authority.canonicalFacts.find((fact) => fact.kind === "missed_payments_continue")?.text ?? paragraphs[0]
    },
    arcSignals: [],
    worldDeltas: []
  } : currentNode.narrativeMeta
};

const historyItem = createHistoryItemFromNode(currentNode, "核心客户终止合同，收入降至0.5万元且不新增借款偿还旧债");
record.updatedAt = new Date().toISOString();
record.interactionLog = [
  ...(record.interactionLog ?? []),
  {
    type: "deterministic_financial_transition",
    transactionId,
    sourceNodeTitle: currentNode.title,
    resultingNodeTitle: nextNode.title,
    periodStartAgeInMonths: start,
    periodEndAgeInMonths: end,
    acceptedEventIds: [event.id],
    debtServiceRecords: committed.financialTransaction?.debtServiceRecords ?? [],
    at: new Date().toISOString()
  }
];
record.latestState = {
  ...state,
  history: [...(state.history ?? []), historyItem],
  currentNode: nextNode,
  currentAttributes: nextNode.attributes,
  nodeCount: (state.history?.length ?? 0) + 2,
  nextGenerationError: null,
  nextNarrativePreview: null,
  isLoading: false,
  isLoadingNext: false,
  capturedAt: new Date().toISOString()
};
await writeFile(inputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  transactionId,
  start,
  end,
  debtHealth: debtHealthState.level,
  missedMonths: debtHealthState.consecutiveMissedPaymentMonths,
  serviceOutcomes: committed.financialTransaction?.debtServiceRecords?.map((item) => item.outcome),
  totalDebtWan: committed.derivedFinancialState.state.totalDebtWan,
  cashWan: committed.derivedFinancialState.state.cashWan
}, null, 2));
