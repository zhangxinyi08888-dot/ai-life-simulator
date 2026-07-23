import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem } from "../types";
import { CAREER_LINE_MIX_POLICY, createSelectionEntropy, selectCareerRouteLine } from "./lineMixPolicy";

test("career policy keeps 75/25 and 65/35 as separate absolute budgets", () => {
  assert.equal(CAREER_LINE_MIX_POLICY.mainLineShare, 0.75);
  assert.equal(CAREER_LINE_MIX_POLICY.crossLineShare, 0.25);
  assert.deepEqual(CAREER_LINE_MIX_POLICY.crossLineWeights, { romance: 0.65, family: 0.35 });
  assert.equal(CAREER_LINE_MIX_POLICY.mainLineShare + CAREER_LINE_MIX_POLICY.crossLineShare, 1);
  assert.equal(Object.values(CAREER_LINE_MIX_POLICY.crossLineWeights).reduce((sum, weight) => sum + weight, 0), 1);
  assert.ok(Object.values(CAREER_LINE_MIX_POLICY.crossLineWeights).every((weight) => weight >= 0));
});

test("named entropy is deterministic and slot independent", () => {
  const entropy = createSelectionEntropy({ simulationSeed: "seed", branchFingerprint: "branch", nodeIndex: 8 });
  assert.equal(entropy.sample("route_line"), entropy.sample("route_line"));
  assert.notEqual(entropy.sample("route_line"), entropy.sample("event_pick"));
});

test("unavailable selected romance is not reweighted into family", () => {
  const result = selectCareerRouteLine({
    history: [], availableLines: new Set(["career", "family"]),
    entropy: { sample: (slot) => slot === "route_line" ? 0.9 : 0.1 }
  });
  assert.equal(result.selectionKind, "cross");
  assert.equal(result.selectedLine, "romance");
});

function historySelection(index: number, kind: "main" | "cross"): HistoryItem {
  return {
    age: 30 + index, stage: "测试", title: "测试", description: "测试", selectedChoice: "继续",
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 }, choices: [], isEndingNode: false,
    eventMeta: {
      eventId: `event_${index}`, eventTags: [], routeLine: kind === "cross" ? "romance" : "career",
      selectionKind: kind, linePolicyId: CAREER_LINE_MIX_POLICY.id
    }
  };
}

function forcedHistorySelection(index: number): HistoryItem {
  const item = historySelection(index, "cross");
  item.eventMeta = {
    eventId: `forced_${index}`,
    eventTags: ["forced"],
    routeLine: "family",
    selectionKind: "forced"
  };
  return item;
}

test("selector converges to 75/25 and cross traffic converges to 65/35", () => {
  let main = 0;
  let romance = 0;
  let family = 0;
  for (let nodeIndex = 0; nodeIndex < 20_000; nodeIndex += 1) {
    const result = selectCareerRouteLine({
      history: [], availableLines: new Set(["career", "financial", "opportunity", "romance", "family"]),
      entropy: createSelectionEntropy({ simulationSeed: "distribution", branchFingerprint: "branch", nodeIndex })
    });
    if (result.selectionKind === "main") main += 1;
    else if (result.selectedLine === "romance") romance += 1;
    else if (result.selectedLine === "family") family += 1;
  }
  assert.ok(Math.abs(main / 20_000 - 0.75) < 0.015);
  assert.ok(Math.abs(romance / (romance + family) - 0.65) < 0.02);
  assert.ok(Math.abs(romance / 20_000 - 0.1625) < 0.015);
  assert.ok(Math.abs(family / 20_000 - 0.0875) < 0.0125);
});

test("selector prevents a third consecutive cross node and forces cross after ten eligible main nodes", () => {
  const forceMain = selectCareerRouteLine({
    history: [historySelection(0, "cross"), historySelection(1, "cross")],
    availableLines: new Set(["career", "romance", "family"]), entropy: { sample: () => 0.99 }
  });
  assert.equal(forceMain.selectionKind, "main");
  const forceCross = selectCareerRouteLine({
    history: Array.from({ length: 10 }, (_, index) => historySelection(index, "main")),
    availableLines: new Set(["career", "romance", "family"]), entropy: { sample: () => 0.1 }
  });
  assert.equal(forceCross.selectionKind, "cross");
});

test("forced events do not enter the ordinary 75/25 history denominator", () => {
  const result = selectCareerRouteLine({
    history: Array.from({ length: 12 }, (_, index) => forcedHistorySelection(index)),
    availableLines: new Set(["career", "romance", "family"]),
    entropy: { sample: (slot) => slot === "route_line" ? 0.99 : 0.1 }
  });
  assert.equal(result.selectionKind, "cross");
  assert.equal(result.selectedLine, "romance");
});
