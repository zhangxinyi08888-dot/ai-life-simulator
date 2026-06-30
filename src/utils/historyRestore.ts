import { HistoryItem, SimulationNode } from "../types";

export interface RestoredHistoryNode {
  node: SimulationNode;
  historyBefore: HistoryItem[];
  attributes: SimulationNode["attributes"];
  nodeCount: number;
}

export function createHistoryItemFromNode(node: SimulationNode, selectedChoice: string): HistoryItem {
  return {
    age: node.age,
    title: node.title,
    stage: node.stage,
    description: node.description,
    selectedChoice,
    attributes: { ...node.attributes },
    choices: node.choices.map((choice) => ({ ...choice })),
    isEndingNode: node.isEndingNode,
    eventMeta: node.eventMeta
  };
}

export function restoreHistoryNodeAtIndex(history: HistoryItem[], targetIndex: number): RestoredHistoryNode {
  const targetItem = history[targetIndex];
  if (!targetItem) {
    throw new Error("HISTORY_RESTORE_INDEX_OUT_OF_RANGE");
  }

  const node: SimulationNode = {
    age: targetItem.age,
    stage: targetItem.stage,
    title: targetItem.title,
    description: targetItem.description,
    choices: targetItem.choices.map((choice) => ({ ...choice })),
    attributes: { ...targetItem.attributes },
    isEndingNode: targetItem.isEndingNode,
    eventMeta: targetItem.eventMeta
  };

  return {
    node,
    historyBefore: history.slice(0, targetIndex),
    attributes: { ...targetItem.attributes },
    nodeCount: targetIndex + 1
  };
}
