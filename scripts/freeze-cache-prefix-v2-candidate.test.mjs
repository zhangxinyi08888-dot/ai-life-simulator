import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_PREFIX_V2_CANDIDATE,
  buildCandidateSourceIdentity,
  buildFrozenCandidateManifest,
  parseDirtyCandidateFiles
} from "./freeze-cache-prefix-v2-candidate.mjs";

test("frozen V2 candidate binds the r4 prompt layout and deterministic source digest", () => {
  const first = buildCandidateSourceIdentity({
    repositoryCommit: "base-commit",
    entries: [
      { file: "src/services/simulation/prompts.ts", content: "prompt-r4" },
      { file: "src/services/simulation/simulationService.ts", content: "service" }
    ],
    dirtyCandidateFiles: ["src/services/simulation/prompts.ts"]
  });
  const reordered = buildCandidateSourceIdentity({
    repositoryCommit: "base-commit",
    entries: [
      { file: "src/services/simulation/simulationService.ts", content: "service" },
      { file: "src/services/simulation/prompts.ts", content: "prompt-r4" }
    ],
    dirtyCandidateFiles: ["src/services/simulation/prompts.ts"]
  });
  const changed = buildCandidateSourceIdentity({
    repositoryCommit: "base-commit",
    entries: [
      { file: "src/services/simulation/prompts.ts", content: "prompt-r5" },
      { file: "src/services/simulation/simulationService.ts", content: "service" }
    ]
  });
  assert.equal(first.sourceSha256, reordered.sourceSha256);
  assert.notEqual(first.sourceSha256, changed.sourceSha256);
  assert.deepEqual(first.dirtyCandidateFiles, ["src/services/simulation/prompts.ts"]);

  const manifest = buildFrozenCandidateManifest({ frozenAt: "2026-08-07T00:00:00.000Z", sourceIdentity: first });
  assert.equal(manifest.candidate.id, "cache-prefix-v2-reference-context-r4");
  assert.equal(manifest.candidate.promptPrefixVersion, "next_node_cache_prefix_v2_reference_context_r4");
  assert.equal(manifest.candidate, CACHE_PREFIX_V2_CANDIDATE);
  assert.ok(manifest.requiredExternalEvidence.some((item) => item.includes("10-node blind-review")));
});

test("candidate freeze preserves the first porcelain-status path", () => {
  assert.deepEqual(
    parseDirtyCandidateFiles(" M package.json\n?? scripts/probe-cache-prefix-layout.mjs\nR  old.ts -> src/new.ts\n"),
    ["package.json", "scripts/probe-cache-prefix-layout.mjs", "src/new.ts"]
  );
});
