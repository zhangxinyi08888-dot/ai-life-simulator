import assert from "node:assert/strict";
import test from "node:test";
import { buildBlindReviewArtifacts, selectBlindReviewSamples } from "./prepare-cache-prefix-blind-review.mjs";

function node(number, label) {
  return {
    ageInMonths: 240 + number,
    stage: `${label} 阶段 ${number}`,
    title: `${label} 节点 ${number}`,
    description: `${label} 正文 ${number}，包含一个可核对的现实细节。`,
    selectedChoice: `${label} 的实际选择 ${number}`,
    choices: [
      { text: `${label} 选择 A ${number}` },
      { text: `${label} 选择 B ${number}` },
      { text: `${label} 选择 C ${number}` }
    ],
    attributes: { happiness: 50, intelligence: 51, wealth: 52, relation: 53, health: 54 },
    financialState: { netWorthWan: number, cashWan: number + 1, totalDebtWan: 0, employmentStatus: "employed", incomeStability: "stable" }
  };
}

function record(slug, label) {
  return {
    caseSlug: slug,
    passed: true,
    dataSource: "real_ai_browser",
    finalState: {
      testDataSource: "real_ai_browser",
      e2eCase: null,
      history: Array.from({ length: 18 }, (_, index) => node(index + 1, label)),
      generationCallTraces: [{ outcome: "succeeded", promptFamily: "next_node", promptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4" }]
    }
  };
}

test("blind-review packet samples ten completed real-AI nodes evenly and hides route labels", () => {
  const records = [
    record("real-career-first", "职业"),
    record("real-relationship-first", "关系")
  ];
  const artifacts = buildBlindReviewArtifacts(records);
  assert.equal(artifacts.manifest.sampleCount, 10);
  assert.deepEqual(artifacts.manifest.samples.map((sample) => sample.blindId), ["N01", "N02", "N03", "N04", "N05", "N06", "N07", "N08", "N09", "N10"]);
  assert.equal(artifacts.manifest.samples.filter((sample) => sample.sourceCaseSlug === "real-career-first").length, 5);
  assert.equal(artifacts.manifest.samples.filter((sample) => sample.sourceCaseSlug === "real-relationship-first").length, 5);
  assert.doesNotMatch(artifacts.packet, /real-career-first|real-relationship-first/);
  assert.match(artifacts.template, /N10/);
});

test("blind-review selection rejects fixture and unfinished sources", () => {
  const fixture = record("journey-fixture", "样本");
  fixture.finalState.e2eCase = "journey-fixture";
  assert.throws(() => selectBlindReviewSamples([fixture], 1), /completed real-AI browser record/);
  const unfinished = record("real-unfinished", "样本");
  unfinished.passed = false;
  assert.throws(() => selectBlindReviewSamples([unfinished], 1), /completed real-AI browser record/);
});

test("blind-review selection admits a verified short real-browser sample only when explicitly enabled", () => {
  const shortSample = record("real-short", "样本");
  shortSample.passed = false;
  shortSample.shortSample = { complete: true };
  shortSample.validation = {
    realAiBrowserSource: true,
    allStoryBodiesPresent: true,
    allDisplayedChoicesPreserved: true,
    allUserChoicesPreserved: true,
    allAttributesPreserved: true,
    allFinancialStatesPreserved: true
  };
  assert.throws(() => selectBlindReviewSamples([shortSample], 1), /completed real-AI browser record/);
  const artifacts = buildBlindReviewArtifacts([shortSample], 1, { allowShortSample: true });
  assert.equal(artifacts.manifest.sourceEligibility, "completed_or_verified_short_sample");
  assert.equal(artifacts.manifest.sampleCount, 1);
});

test("blind-review packet can require the candidate prompt prefix without exposing it to reviewers", () => {
  const records = [record("real-career-first", "职业"), record("real-relationship-first", "关系")];
  const artifacts = buildBlindReviewArtifacts(records, 10, {
    expectedPromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4"
  });
  assert.equal(artifacts.manifest.expectedPromptPrefixVersion, "next_node_cache_prefix_v2_reference_context_r4");
  assert.doesNotMatch(artifacts.packet, /next_node_cache_prefix_v2_reference_context_r4/);
  records[0].finalState.generationCallTraces[0].promptPrefixVersion = "next_node_cache_prefix_v1_full_context_system_r1";
  assert.throws(
    () => buildBlindReviewArtifacts(records, 10, { expectedPromptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4" }),
    /next-node evidence/
  );
});
