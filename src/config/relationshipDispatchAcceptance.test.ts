import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, RouteLine, WorldStateSnapshot } from "../types";
import { queryDynamicLifeEvent, getLastEventSelectionTrace } from "../data/lifeEvents";
import { createSelectionEntropy } from "./lineMixPolicy";

const attributes = { happiness: 58, intelligence: 70, wealth: 55, relation: 60, health: 65 };
const sampleSize = 20_000;

function baselineHistory(input: { familyActive: boolean; exploring: boolean }): HistoryItem[] {
  const people = input.exploring ? [{
    id: "person_candidate",
    identityKey: { namespace: "accepted_character" as const, key: "candidate" },
    displayName: "林遥",
    relation: "partner" as const,
    lifeStatus: "active" as const,
    source: "accepted_history" as const,
    confidence: 0.9
  }] : [];
  const snapshot: WorldStateSnapshot = {
    people,
    directionArcs: [{
      id: "career", directionType: "career", summary: "持续推进产品事业", status: "active",
      startedAtAgeInMonths: 300, userReinforcementCount: 2, establishedAssets: []
    }],
    pressureArcs: [],
    relationships: input.exploring ? [{
      id: "relationship_candidate", participantPersonIds: ["person_candidate"], type: "romantic",
      stage: "exploring", status: "active", effectiveFromAgeInMonths: 359,
      source: "accepted_history", confidence: 0.9
    }] : [],
    familyRelationships: input.familyActive ? [{
      id: "family_parent", role: "parent_unspecified", activation: "active", contact: "unknown",
      emotionalSupport: "unknown", practicalSupport: "unknown", autonomyRespect: "unknown",
      conflictIntensity: "unknown", topicStances: [], revision: 1
    }] : [],
    relationshipRevision: input.exploring ? 1 : 0,
    familyRelationshipRevision: input.familyActive ? 1 : 0,
    version: 2
  };
  return [{
    age: 30,
    ageInMonths: 360,
    stage: "事业发展",
    title: "继续推进产品工作",
    description: "你完成了一个常规工作节点。",
    selectedChoice: "继续推进",
    selectedDecisionIntent: "career:continue:project",
    attributes,
    choices: [{ id: "A", text: "继续推进", impactSummary: "保持方向" }],
    isEndingNode: false,
    eventMeta: { eventId: "career_baseline", eventCategory: "career", routeLine: "career", eventTags: ["baseline"] },
    worldStateSnapshot: snapshot
  }];
}

function sampleRealizedLines(history: HistoryItem[]) {
  const realized: Partial<Record<RouteLine, number>> = {};
  let fallback = 0;
  let drawnCross = 0;
  let availableCross = 0;
  for (let nodeIndex = 0; nodeIndex < sampleSize; nodeIndex += 1) {
    const event = queryDynamicLifeEvent(
      attributes,
      { coreStoryFocus: "career", currentSituation: "正在从事产品工作并持续推进事业。" },
      30,
      history,
      undefined,
      {
        applyCareerLineMix: true,
        entropy: createSelectionEntropy({ simulationSeed: "relationship-dispatch-acceptance", branchFingerprint: "main", nodeIndex })
      }
    );
    assert.ok(event, `sample ${nodeIndex} should realize an event`);
    realized[event.routeLine] = (realized[event.routeLine] || 0) + 1;
    const lineSelection = getLastEventSelectionTrace()?.lineSelection;
    if (lineSelection?.selectionKind === "cross") drawnCross += 1;
    if (lineSelection?.crossLineCandidateAvailable) availableCross += 1;
    if (lineSelection?.fallbackReason === "selected_cross_line_unavailable") fallback += 1;
  }
  return { realized, fallback, drawnCross, availableCross };
}

function rate(count: number | undefined): number {
  return (count || 0) / sampleSize;
}

test("real candidate selection realizes career 75/25 with romance 65 and family 35", () => {
  const result = sampleRealizedLines(baselineHistory({ familyActive: true, exploring: false }));
  const romance = rate(result.realized.romance);
  const family = rate(result.realized.family);
  const cross = romance + family;
  assert.ok(cross >= 0.23 && cross <= 0.27, `cross=${cross}`);
  assert.ok(romance >= 0.1475 && romance <= 0.1775, `romance=${romance}`);
  assert.ok(family >= 0.075 && family <= 0.1, `family=${family}`);
  assert.equal(rate(result.realized.friendship), 0);
  assert.equal(result.fallback, 0);
});

test("unavailable romance returns its realized budget to main without inflating family", () => {
  const result = sampleRealizedLines(baselineHistory({ familyActive: true, exploring: true }));
  const family = rate(result.realized.family);
  const romance = rate(result.realized.romance);
  const fallback = rate(result.fallback);
  assert.equal(romance, 0);
  assert.ok(family >= 0.075 && family <= 0.1, `family=${family}`);
  assert.ok(fallback >= 0.1475 && fallback <= 0.1775, `fallback=${fallback}`);
});

test("when no cross line is eligible all cross draws fall back to main", () => {
  const result = sampleRealizedLines(baselineHistory({ familyActive: false, exploring: true }));
  assert.equal(rate(result.realized.romance), 0);
  assert.equal(rate(result.realized.family), 0);
  assert.ok(rate(result.fallback) >= 0.23 && rate(result.fallback) <= 0.27, `fallback=${rate(result.fallback)}`);
  assert.equal(result.availableCross, 0);
});
