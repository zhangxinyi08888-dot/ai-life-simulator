import { HistoryItem, SimulationNode } from "../types";
import { normalizeDecisionIntent } from "./choicePreference";

function cloneValue<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

export interface RestoredHistoryNode {
  node: SimulationNode;
  historyBefore: HistoryItem[];
  attributes: SimulationNode["attributes"];
  nodeCount: number;
}

export function createHistoryItemFromNode(node: SimulationNode, selectedChoice: string): HistoryItem {
  const selectedOption = node.choices.find((choice) => (
    choice.text === selectedChoice || selectedChoice.includes(choice.text)
  ));
  return {
    age: node.age,
    ageInMonths: node.ageInMonths,
    lifeStage: node.lifeStage,
    title: node.title,
    stage: node.stage,
    description: node.description,
    selectedChoice,
    selectedDecisionIntent: selectedOption
      ? normalizeDecisionIntent(selectedOption)
      : normalizeDecisionIntent({ id: "custom", text: selectedChoice, impactSummary: "自定义选择" }),
    attributes: { ...node.attributes },
    financialLedger: cloneValue(node.financialLedger),
    financialLedgerMode: node.financialLedgerMode,
    financialState: cloneValue(node.financialState),
    financialPeriodSummary: cloneValue(node.financialPeriodSummary),
    financialSignals: cloneValue(node.financialSignals),
    financialChange: cloneValue(node.financialChange),
    choices: node.choices.map((choice) => ({ ...choice })),
    isEndingNode: node.isEndingNode,
    eventMeta: node.eventMeta,
    narrativeMeta: cloneValue(node.narrativeMeta),
    worldStateSnapshot: cloneValue(node.worldStateSnapshot),
    committedArcMeta: cloneValue(node.committedArcMeta),
    reportInvitation: cloneValue(node.reportInvitation)
  };
}

export function restoreHistoryNodeAtIndex(history: HistoryItem[], targetIndex: number): RestoredHistoryNode {
  const targetItem = history[targetIndex];
  if (!targetItem) {
    throw new Error("HISTORY_RESTORE_INDEX_OUT_OF_RANGE");
  }

  const node: SimulationNode = {
    age: targetItem.age,
    ageInMonths: targetItem.ageInMonths,
    lifeStage: targetItem.lifeStage,
    stage: targetItem.stage,
    title: targetItem.title,
    description: targetItem.description,
    choices: targetItem.choices.map((choice) => ({ ...choice })),
    attributes: { ...targetItem.attributes },
    financialLedger: cloneValue(targetItem.financialLedger),
    financialLedgerMode: targetItem.financialLedgerMode,
    financialState: cloneValue(targetItem.financialState),
    financialPeriodSummary: cloneValue(targetItem.financialPeriodSummary),
    financialSignals: cloneValue(targetItem.financialSignals),
    financialChange: cloneValue(targetItem.financialChange),
    isEndingNode: targetItem.isEndingNode,
    eventMeta: targetItem.eventMeta,
    narrativeMeta: cloneValue(targetItem.narrativeMeta),
    worldStateSnapshot: cloneValue(targetItem.worldStateSnapshot),
    committedArcMeta: cloneValue(targetItem.committedArcMeta),
    reportInvitation: cloneValue(targetItem.reportInvitation)
  };

  return {
    node,
    historyBefore: history.slice(0, targetIndex),
    attributes: { ...targetItem.attributes },
    nodeCount: targetIndex + 1
  };
}
