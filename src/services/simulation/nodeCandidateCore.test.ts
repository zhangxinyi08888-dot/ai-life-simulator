import assert from "node:assert/strict";
import test from "node:test";
import type { WorldStateSnapshot } from "../../types";
import { traceGenerationCall, summarizeGenerationTraces, type GenerationCallTrace } from "./generationTelemetry";
import { createNodeCandidateEnvelope, fingerprintWorldState, hashNodeCandidate } from "./nodeCandidateHash";
import { applyNodeCandidatePatch, paragraphId } from "./nodeCandidatePatch";
import type { LockedCandidateSkeleton, SimulationNodeCandidate } from "./nodeCandidateTypes";
import {
  canPatch,
  canRegenerate,
  consumeFullGeneration,
  consumeModelPatch,
  createNodeGenerationBudget,
  NodeGenerationBudgetError
} from "./nodeGenerationBudget";

const worldState: WorldStateSnapshot = {
  people: [],
  directionArcs: [],
  pressureArcs: [],
  currentEmploymentStatus: "employed",
  careerRevision: 2,
  relationshipRevision: 3,
  familyRelationshipRevision: 4,
  version: 2
};

const skeleton: LockedCandidateSkeleton = {
  simulationSeed: "seed",
  branchFingerprint: "branch",
  nodeIndex: 7,
  transactionId: "tx-7",
  sourceSelectedDecision: "接受新工作",
  selectedOutcomeId: "accept_offer",
  currentAgeInMonths: 360,
  targetAgeInMonths: 372,
  elapsedMonths: 12,
  lifeIntensity: "normal",
  eventId: "career-offer",
  eventIntentType: "career_transition",
  allowedOutcomeIds: ["continue", "adjust"],
  worldStateFingerprint: fingerprintWorldState(worldState),
  worldStateVersion: 2,
  careerRevision: 2,
  relationshipRevision: 3,
  familyRelationshipRevision: 4,
  authoritativeCharacterIds: []
};

function candidate(): SimulationNodeCandidate {
  return {
    age: 31,
    ageInMonths: 372,
    lifeStage: "early_adulthood",
    stage: "职业转折",
    title: "新工作第一年",
    description: "你接受了新工作。\n\n一年后，你开始适应新的节奏。",
    descriptionParagraphs: ["你接受了新工作。", "一年后，你开始适应新的节奏。"],
    choices: [
      { id: "A", text: "继续投入", impactSummary: "稳步推进", eventOutcomeId: "continue" },
      { id: "B", text: "调整节奏", impactSummary: "控制压力", eventOutcomeId: "adjust" }
    ],
    attributes: { happiness: 60, intelligence: 62, wealth: 55, relation: 50, health: 58 },
    isEndingNode: false,
    narrativeMeta: {
      elapsedMonths: 12,
      elapsedYears: 1,
      lifeIntensity: "normal",
      nodeMateriality: "decision_checkpoint",
      storyEpisode: {
        id: "episode-7",
        startAgeInMonths: 360,
        endAgeInMonths: 372,
        internalTransitions: [],
        decisionCheckpointId: "checkpoint-7",
        summary: "适应新工作"
      },
      recoveryState: "neutral",
      recoveryEvidence: [],
      arcSignals: [],
      activeCharacters: [],
      worldDeltas: []
    }
  };
}

test("candidate hash is stable and changes only with authoritative skeleton or patchable content", () => {
  const first = candidate();
  const second = structuredClone(first);
  assert.equal(hashNodeCandidate(skeleton, first), hashNodeCandidate(structuredClone(skeleton), second));
  second.title = "修订标题";
  assert.notEqual(hashNodeCandidate(skeleton, first), hashNodeCandidate(skeleton, second));
  assert.notEqual(hashNodeCandidate(skeleton, first), hashNodeCandidate({ ...skeleton, transactionId: "tx-other" }, first));
});

test("patch merges allowed surfaces atomically and rejects stale or duplicate patches", () => {
  const envelope = createNodeCandidateEnvelope({ candidateRevision: 0, skeleton, candidate: candidate() });
  const paragraph = envelope.candidate.descriptionParagraphs![1];
  const patch = {
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: envelope.baseCandidateHash,
    targetCandidateRevision: 0,
    addressedIssueCodes: ["STATE_EVIDENCE_MISSING", "DECISION_GATE_FAILED"],
    descriptionParagraphPatches: [{
      paragraphId: paragraphId(1, paragraph),
      expectedTextHash: hashText(paragraph),
      replacementText: "一年后，你已在新岗位建立稳定节奏。"
    }],
    replacementChoices: [
      { id: "A", text: "继续投入", impactSummary: "稳步推进", eventOutcomeId: "continue" },
      { id: "B", text: "重新协商职责", impactSummary: "调整边界", eventOutcomeId: "adjust" }
    ]
  } as const;
  const applied = applyNodeCandidatePatch(envelope, patch);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.match(applied.envelope.candidate.description, /稳定节奏/);
  assert.equal(applied.envelope.candidate.choices[1].text, "重新协商职责");
  assert.deepEqual(applied.envelope.skeleton, skeleton);
  assert.notEqual(applied.envelope.baseCandidateHash, envelope.baseCandidateHash);
  assert.equal(applyNodeCandidatePatch(applied.envelope, patch).ok, false);

  const stale: Record<string, unknown> = structuredClone(patch);
  stale.baseCandidateHash = "stale";
  const rejected = applyNodeCandidatePatch(envelope, stale);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "STALE_OR_DUPLICATE_PATCH");
});

test("patch rejects unknown fields, stale paragraphs and unauthorized outcomes without partial mutation", () => {
  const envelope = createNodeCandidateEnvelope({ candidateRevision: 0, skeleton, candidate: candidate() });
  assert.equal(applyNodeCandidatePatch(envelope, { contractVersion: "node_candidate_patch_v1", surprise: true }).ok, false);
  const staleParagraph = applyNodeCandidatePatch(envelope, {
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: envelope.baseCandidateHash,
    targetCandidateRevision: 0,
    addressedIssueCodes: ["STATE_EVIDENCE_MISSING"],
    descriptionParagraphPatches: [{ paragraphId: "description:1:old", expectedTextHash: "old", replacementText: "替换" }]
  });
  assert.equal(staleParagraph.ok, false);
  if (!staleParagraph.ok) assert.equal(staleParagraph.code, "PATCH_PARAGRAPH_STALE");
  assert.match(envelope.candidate.description, /适应新的节奏/);

  const invalidChoice = applyNodeCandidatePatch(envelope, {
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: envelope.baseCandidateHash,
    targetCandidateRevision: 0,
    addressedIssueCodes: ["DECISION_GATE_FAILED"],
    replacementChoices: [
      { id: "A", text: "越权", impactSummary: "错误", eventOutcomeId: "not_allowed" },
      { id: "B", text: "调整", impactSummary: "调整", eventOutcomeId: "adjust" }
    ]
  });
  assert.equal(invalidChoice.ok, false);
  if (!invalidChoice.ok) assert.equal(invalidChoice.code, "PATCH_VALUE_INVALID");
});

test("patch enforces the issue-specific surface whitelist", () => {
  const envelope = createNodeCandidateEnvelope({
    candidateRevision: 0,
    skeleton,
    candidate: candidate(),
    requestedIssueCodes: ["DECISION_GATE_FAILED"],
    allowedPatchSurfaces: ["replacementChoices"]
  });
  const rejected = applyNodeCandidatePatch(envelope, {
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: envelope.baseCandidateHash,
    targetCandidateRevision: 0,
    addressedIssueCodes: ["DECISION_GATE_FAILED"],
    titleReplacement: "越权标题"
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "PATCH_SURFACE_NOT_ALLOWED");
});

test("patch rejects partial story episodes before merge", () => {
  const envelope = createNodeCandidateEnvelope({ candidateRevision: 0, skeleton, candidate: candidate() });
  const rejected = applyNodeCandidatePatch(envelope, {
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: envelope.baseCandidateHash,
    targetCandidateRevision: 0,
    addressedIssueCodes: [],
    narrativeMetaPatch: { storyEpisode: {} }
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, "PATCH_VALUE_INVALID");
});

test("node generation budget caps full generations and patches", () => {
  const budget = createNodeGenerationBudget();
  assert.equal(consumeFullGeneration(budget), 0);
  assert.equal(consumeFullGeneration(budget), 1);
  assert.equal(canRegenerate(budget), false);
  assert.throws(() => consumeFullGeneration(budget), (error) => error instanceof NodeGenerationBudgetError
    && error.code === "FULL_GENERATION_BUDGET_EXHAUSTED");
  consumeModelPatch(budget);
  assert.equal(canPatch(budget), false);
  assert.throws(() => consumeModelPatch(budget), (error) => error instanceof NodeGenerationBudgetError
    && error.code === "MODEL_PATCH_BUDGET_EXHAUSTED");
});

test("generation telemetry classifies calls and summarizes latency without unknown kinds", async () => {
  const traces: GenerationCallTrace[] = [];
  await traceGenerationCall({
    kind: "initial_generation",
    context: { transactionId: "tx-7", nodeIndex: 7, promptFamily: "next_node", promptPrefixVersion: "next_node_cache_prefix_v1" },
    listener: (trace) => traces.push(trace),
    operation: async (markFirstToken, recordResponseMetadata) => {
      recordResponseMetadata({
        providerRequestId: "trace-usage-1",
        model: "deepseek-v4-flash",
        usage: {
          promptTokens: 100,
          cacheHitTokens: 72,
          cacheMissTokens: 28,
          completionTokens: 12,
          totalTokens: 112
        }
      });
      markFirstToken();
      return "ok";
    }
  });
  await traceGenerationCall({
    kind: "candidate_patch",
    context: { transactionId: "tx-7", nodeIndex: 7, issueCodes: ["DECISION_GATE_FAILED"] },
    listener: (trace) => traces.push(trace),
    operation: async () => "patched"
  });
  assert.equal(traces.filter((trace) => trace.outcome === "succeeded").length, 2);
  const summary = summarizeGenerationTraces(traces);
  assert.equal(summary.fullGenerationCount, 1);
  assert.equal(summary.modelPatchCount, 1);
  assert.equal(summary.totalModelCallCount, 2);
  assert.deepEqual(summary.patchIssueCodes, ["DECISION_GATE_FAILED"]);
  assert.equal(summary.promptTokens, 100);
  assert.equal(summary.cacheHitTokens, 72);
  assert.equal(summary.cacheMissTokens, 28);
  assert.equal(summary.completionTokens, 12);
  assert.equal(summary.usageCallCount, 1);
  assert.equal(summary.missingUsageCallCount, 1);
  assert.equal(summary.cacheHitRate, 0.72);
  const completed = traces.find((trace) => trace.outcome === "succeeded" && trace.kind === "initial_generation")!;
  assert.equal(completed.promptFamily, "next_node");
  assert.equal(completed.promptPrefixVersion, "next_node_cache_prefix_v1");
  assert.equal(completed.providerRequestId, "trace-usage-1");
  assert.equal(completed.providerUsageStatus, "reported");
  assert.equal(
    traces.find((trace) => trace.outcome === "succeeded" && trace.kind === "candidate_patch")?.providerUsageStatus,
    "missing"
  );
});

function hashText(value: string): string {
  return paragraphId(0, value).split(":").at(-1)!;
}
