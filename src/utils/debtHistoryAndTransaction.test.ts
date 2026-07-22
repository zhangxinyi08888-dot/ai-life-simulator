import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryItemFromNode, restoreHistoryNodeAtIndex } from "./historyRestore";
import { commitSimulationTransaction, emptyWorldState } from "./simulationTransaction";

/* Cross-boundary TDD contract for Spec §8.4, §13 and §14. */

const debtHealthState = {
  asOfAgeInMonths: 480,
  level: "default_risk",
  trend: "worsening",
  totalDebtWan: 20,
  scheduledDebtServiceNext12MonthsWan: 6,
  availableCashForDebtNext12MonthsWan: 2,
  debtServiceCoverageRatio: 0.3333,
  liquidityShortfallDebtWan: 1,
  consecutiveMissedPaymentMonths: 2,
  missedPaymentMonthsLast12: 2,
  activeDefaultedDebtCount: 0,
  reasonCodes: ["CONSECUTIVE_MISSED_PAYMENTS"],
  source: "authoritative_ledger",
  sourceLedgerRevision: 3
};

function node(overrides: Record<string, unknown> = {}) {
  return {
    age: 40,
    ageInMonths: 480,
    stage: "偿债压力",
    title: "还款安排需要调整",
    description: "本月还款出现缺口。",
    choices: [{ id: "A", text: "协商重组", impactSummary: "降低月供压力" }],
    attributes: { happiness: 45, intelligence: 60, wealth: 30, relation: 50, health: 50 },
    debtHealthState,
    isEndingNode: false,
    ...overrides
  } as any;
}

const episode = {
  id: "episode_debt",
  startAgeInMonths: 477,
  endAgeInMonths: 480,
  internalTransitions: [],
  decisionCheckpointId: "node_debt",
  summary: "债务压力期"
};

function arc(id: string, policy: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    eventId: policy === "financial_debt_v1" ? "financial_payment_strain" : "health_forced_pause",
    eventIntentType: policy,
    phasePolicyId: policy,
    phaseId: "response",
    status,
    startedAtAgeInMonths: 470,
    phaseStartedAtAgeInMonths: 474,
    phaseCheckpointCount: 1,
    totalCheckpointCount: 2,
    unresolvedSummary: policy,
    ...overrides
  } as any;
}

test("D2-X01 HistoryItem stores a deep clone of debt health", () => {
  const item = createHistoryItemFromNode(node(), "协商重组") as any;
  assert.deepEqual(item.debtHealthState, debtHealthState);
  assert.notEqual(item.debtHealthState, debtHealthState);
  item.debtHealthState.reasonCodes.push("MUTATED");
  assert.deepEqual(debtHealthState.reasonCodes, ["CONSECUTIVE_MISSED_PAYMENTS"]);
});

test("D2-X02 restoring history deep-clones debt health without rewriting the old snapshot", () => {
  const item = createHistoryItemFromNode(node(), "协商重组") as any;
  const restored = restoreHistoryNodeAtIndex([item], 0) as any;
  assert.deepEqual(restored.node.debtHealthState, debtHealthState);
  assert.notEqual(restored.node.debtHealthState, item.debtHealthState);
  restored.node.debtHealthState.level = "manageable";
  assert.equal(item.debtHealthState.level, "default_risk");
});

test("D4-X01 one transaction applies the primary health arc and suspended debt update atomically", () => {
  const debt = arc("debt_arc", "financial_debt_v1", "active");
  const health = arc("health_arc", "health_crisis_v1", "active", { phaseId: "trigger" });
  const transition = {
    action: "start",
    nextArcState: health,
    additionalArcStateUpdates: [arc("debt_arc", "financial_debt_v1", "suspended", {
      suspendedAtAgeInMonths: 480,
      suspendedByArcId: "health_arc"
    })],
    foregroundPressureArcId: "health_arc",
    reasonCodes: ["acute-health-preempts-debt"]
  } as any;
  const world = {
    ...emptyWorldState(),
    pressureArcs: [debt],
    foregroundPressureArcId: "debt_arc"
  };
  const committed = commitSimulationTransaction({
    transactionId: "tx_preempt",
    node: node(),
    storyEpisode: episode as any,
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    pressureArcTransition: transition,
    currentWorldStateSnapshot: world
  } as any);
  assert.equal(committed.worldStateSnapshot.pressureArcs.length, 2);
  assert.equal(committed.worldStateSnapshot.pressureArcs.find((item) => item.id === "debt_arc")?.status, "suspended");
  assert.equal(committed.worldStateSnapshot.foregroundPressureArcId, "health_arc");
  assert.deepEqual((committed.node as any).debtHealthState, debtHealthState);
});

test("D4-X02 duplicate primary and additional arc IDs reject the whole transaction", () => {
  const duplicate = arc("same_arc", "financial_debt_v1", "active");
  assert.throws(() => commitSimulationTransaction({
    transactionId: "tx_duplicate_arc",
    node: node(),
    storyEpisode: episode as any,
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    pressureArcTransition: {
      action: "resume",
      nextArcState: duplicate,
      additionalArcStateUpdates: [arc("same_arc", "financial_debt_v1", "suspended")],
      foregroundPressureArcId: "same_arc",
      reasonCodes: []
    },
    currentWorldStateSnapshot: emptyWorldState()
  } as any), /same arc|duplicate|同一 Arc/i);
});

test("D4-X03 transaction retry does not duplicate arc state or domain counters", () => {
  const transition = {
    action: "start",
    nextArcState: arc("debt_arc", "financial_debt_v1", "active"),
    foregroundPressureArcId: "debt_arc",
    reasonCodes: []
  } as any;
  const input = {
    transactionId: "tx_idempotent_debt",
    node: node(),
    storyEpisode: episode,
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    pressureArcTransition: transition,
    currentWorldStateSnapshot: emptyWorldState()
  } as any;
  const first = commitSimulationTransaction(input);
  const repeated = commitSimulationTransaction({ ...input, currentWorldStateSnapshot: first.worldStateSnapshot });
  assert.equal(repeated.alreadyCommitted, true);
  assert.equal(repeated.worldStateSnapshot.pressureArcs.length, 1);
  assert.equal(repeated.worldStateSnapshot.committedTransactionIds?.filter((id) => id === input.transactionId).length, 1);
});
