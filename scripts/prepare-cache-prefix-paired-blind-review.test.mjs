import assert from "node:assert/strict";
import test from "node:test";
import { buildPairedBlindReviewArtifacts } from "./prepare-cache-prefix-paired-blind-review.mjs";

function node(label) {
  return {
    ageInMonths: 300,
    stage: "career",
    title: `${label} 标题`,
    description: `${label} 正文`,
    attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    financialState: { netWorthWan: 20, cashWan: 10, totalDebtWan: 0, employmentStatus: "employed", incomeStability: "stable" },
    choices: [{ id: "A", text: `${label} 选择 A` }, { id: "B", text: `${label} 选择 B` }, { id: "C", text: `${label} 选择 C` }]
  };
}

function pair(index) {
  return {
    key: index < 6 ? "career" : "relationship",
    pairIndex: index,
    samePromptInput: true,
    inputStatePath: `/tmp/input-${index}.json`,
    inputState: { currentNode: node(`共享 ${index}`) },
    selection: { id: "A", text: `共享选择 ${index}` },
    main: { outputNode: node(`main ${index}`) },
    candidate: { outputNode: node(`candidate ${index}`) }
  };
}

test("paired packet hides the A/B source mapping while retaining it in the audit manifest", () => {
  const artifacts = buildPairedBlindReviewArtifacts(Array.from({ length: 10 }, (_, index) => pair(index + 1)), { mainCommit: "main-sha" });
  assert.equal(artifacts.manifest.sampleCount, 10);
  assert.equal(artifacts.hardChecks.verdict, "ready_for_human_review");
  assert.match(artifacts.packet, /版本 A/);
  assert.match(artifacts.packet, /版本 B/);
  assert.doesNotMatch(artifacts.packet, /reviewerLabels/);
  assert.equal(artifacts.manifest.samples.every((sample) => sample.reviewerLabels.A && sample.reviewerLabels.B), true);
});

test("paired packet rejects a non-identical source input", () => {
  const records = Array.from({ length: 10 }, (_, index) => pair(index + 1));
  records[4].samePromptInput = false;
  assert.throws(() => buildPairedBlindReviewArtifacts(records), /identical input state/);
});
