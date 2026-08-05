import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  computeSourceState,
  prepareReleaseCandidate,
  releaseRuntimeEnvFromCandidate,
  resolveReleaseEnvironment,
  resolveEvidenceRoot
} from "./lib/release-candidate.mjs";
import { verifyReleaseApproval } from "./verify-release-approval.mjs";

const execFileAsync = promisify(execFile);

async function createRepository() {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "ai-life-release-candidate-"));
  await mkdir(path.join(repositoryPath, "src"), { recursive: true });
  await mkdir(path.join(repositoryPath, "scripts"), { recursive: true });
  await mkdir(path.join(repositoryPath, "docs"), { recursive: true });
  await mkdir(path.join(repositoryPath, ".github", "workflows"), { recursive: true });
  await mkdir(path.join(repositoryPath, "public"), { recursive: true });
  await Promise.all([
    writeFile(path.join(repositoryPath, "src", "runtime.ts"), "export const value = 1;\n"),
    writeFile(path.join(repositoryPath, "src", "runtime.test.ts"), "// test\n"),
    writeFile(path.join(repositoryPath, "scripts", "collector.mjs"), "export const collector = 1;\n"),
    writeFile(path.join(repositoryPath, "docs", "guide.md"), "guide\n"),
    writeFile(path.join(repositoryPath, ".github", "workflows", "deploy-pages.yml"), "name: deploy\n"),
    writeFile(path.join(repositoryPath, "public", "favicon.txt"), "icon\n"),
    writeFile(path.join(repositoryPath, "package.json"), "{\"type\":\"module\"}\n")
  ]);
  await execFileAsync("git", ["init"], { cwd: repositoryPath });
  await execFileAsync("git", ["config", "user.email", "tests@example.com"], { cwd: repositoryPath });
  await execFileAsync("git", ["config", "user.name", "Tests"], { cwd: repositoryPath });
  await execFileAsync("git", ["add", "."], { cwd: repositoryPath });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repositoryPath });
  return repositoryPath;
}

test("runtime fingerprint ignores docs and tests but changes with production source", async () => {
  const repositoryPath = await createRepository();
  const baseline = await computeSourceState(repositoryPath);
  await writeFile(path.join(repositoryPath, "docs", "guide.md"), "updated guide\n");
  await writeFile(path.join(repositoryPath, "src", "runtime.test.ts"), "// updated test\n");
  const nonRuntimeChange = await computeSourceState(repositoryPath);
  assert.equal(nonRuntimeChange.runtimeFingerprint, baseline.runtimeFingerprint);
  assert.deepEqual(nonRuntimeChange.runtimeDirtyPaths, []);

  await writeFile(path.join(repositoryPath, "src", "runtime.ts"), "export const value = 2;\n");
  const runtimeChange = await computeSourceState(repositoryPath);
  assert.notEqual(runtimeChange.runtimeFingerprint, baseline.runtimeFingerprint);
  assert.deepEqual(runtimeChange.runtimeDirtyPaths, ["src/runtime.ts"]);

  await writeFile(path.join(repositoryPath, ".github", "workflows", "deploy-pages.yml"), "name: changed deploy\n");
  const deployChange = await computeSourceState(repositoryPath);
  assert.notEqual(deployChange.runtimeFingerprint, runtimeChange.runtimeFingerprint);

  await writeFile(path.join(repositoryPath, "public", "favicon.txt"), "changed icon\n");
  const publicChange = await computeSourceState(repositoryPath);
  assert.notEqual(publicChange.runtimeFingerprint, deployChange.runtimeFingerprint);
});

test("certification candidate requires clean source and an evidence root outside Git", async () => {
  const repositoryPath = await createRepository();
  const evidenceBase = await mkdtemp(path.join(os.tmpdir(), "ai-life-evidence-"));
  const runId = "2026-08-03-clean-candidate";
  const result = await prepareReleaseCandidate({
    cwd: repositoryPath,
    runId,
    root: path.join(evidenceBase, runId),
    now: () => "2026-08-03T00:00:00.000Z"
  });
  assert.equal(result.manifest.validationMode, "certify");
  assert.deepEqual(result.manifest.releaseEnvironment, resolveReleaseEnvironment({}));
  assert.equal(result.manifest.launchUrl, "http://127.0.0.1:5174/ai-life-simulator/");
  assert.equal(result.manifest.repositoryPath, await realpath(repositoryPath));
  assert.equal(result.manifest.evidenceRoot, path.join(evidenceBase, runId));

  assert.throws(() => resolveEvidenceRoot({
    repositoryPath,
    runId: "inside-root",
    root: path.join(repositoryPath, "artifacts", "inside-root")
  }), /outside the Git worktree/u);

  await assert.rejects(prepareReleaseCandidate({
    cwd: repositoryPath,
    runId: "wrong-launch-path",
    root: path.join(evidenceBase, "wrong-launch-path"),
    launchUrl: "http://127.0.0.1:5174/"
  }), /launchUrl path/u);
});

test("candidate runtime server receives the frozen non-secret identity and effective environment", () => {
  const candidate = {
    candidateId: "candidate",
    sourceCommit: "a".repeat(40),
    runtimeFingerprint: "b".repeat(64),
    collectorFingerprint: "c".repeat(64),
    releaseEnvironment: resolveReleaseEnvironment({
      BASE_PATH: "/release",
      VITE_DEEPSEEK_MODEL: "test-model",
      VITE_DEEPSEEK_BASE_URL: "https://example.test/",
      VITE_FINANCIAL_NODE_GATE_MODE: "shadow",
      VITE_EXPENSE_LIFECYCLE_MODE: "enforced",
      VITE_ENABLE_CANDIDATE_PATCH_REPAIR: "true"
    })
  };
  const environment = releaseRuntimeEnvFromCandidate(candidate);
  assert.equal(environment.BASE_PATH, "/release/");
  assert.equal(environment.VITE_DEEPSEEK_MODEL, "test-model");
  assert.equal(environment.VITE_DEEPSEEK_BASE_URL, "https://example.test");
  assert.equal(environment.VITE_RELEASE_CANDIDATE_ID, candidate.candidateId);
  assert.equal(environment.VITE_RELEASE_RUNTIME_FINGERPRINT, candidate.runtimeFingerprint);
});

test("certification candidate rejects dirty runtime while explore mode records it", async () => {
  const repositoryPath = await createRepository();
  await writeFile(path.join(repositoryPath, "src", "runtime.ts"), "export const value = 3;\n");
  const evidenceBase = await mkdtemp(path.join(os.tmpdir(), "ai-life-evidence-"));
  await assert.rejects(prepareReleaseCandidate({
    cwd: repositoryPath,
    runId: "dirty-certify",
    root: path.join(evidenceBase, "dirty-certify")
  }), /requires clean runtime/u);

  const explored = await prepareReleaseCandidate({
    cwd: repositoryPath,
    runId: "dirty-explore",
    root: path.join(evidenceBase, "dirty-explore"),
    validationMode: "explore"
  });
  assert.deepEqual(explored.manifest.runtimeDirtyPaths, ["src/runtime.ts"]);
});

test("deployment approval survives evidence-only changes but rejects runtime drift", async () => {
  const repositoryPath = await createRepository();
  const source = await computeSourceState(repositoryPath);
  const approvalDir = path.join(repositoryPath, "release", "evidence");
  const approvalPath = path.join(approvalDir, "candidate.json");
  await mkdir(approvalDir, { recursive: true });
  await writeFile(approvalPath, `${JSON.stringify({
    status: "approved",
    validationMode: "certify",
    candidateId: "candidate",
    sourceCommit: source.sourceCommit,
    runtimeFingerprint: source.runtimeFingerprint,
    collectorFingerprint: source.collectorFingerprint,
    releaseEnvironment: resolveReleaseEnvironment({}),
    evidenceDigest: "d".repeat(64),
    routeVerification: {
      ok: true,
      caseCount: 5,
      scenarioCounts: { accept_first: 2, accept_second: 2, natural_lifespan: 1 }
    }
  })}\n`);
  const approved = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath
  });
  assert.equal(approved.ok, true, approved.failures.join("\n"));

  const wrongEnvironment = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath,
    env: { BASE_PATH: "/unexpected/" }
  });
  assert.equal(wrongEnvironment.ok, false);
  assert.equal(wrongEnvironment.failures.some((failure) => failure.includes("basePath differs")), true);

  await writeFile(path.join(repositoryPath, "docs", "guide.md"), "evidence-only follow-up\n");
  const stillApproved = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath
  });
  assert.equal(stillApproved.ok, true, stillApproved.failures.join("\n"));

  await writeFile(path.join(repositoryPath, "scripts", "collector.mjs"), "export const collector = 99;\n");
  const collectorRejected = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath
  });
  assert.equal(collectorRejected.ok, false);
  assert.equal(collectorRejected.failures.some((failure) => failure.includes("collector fingerprint")), true);

  await writeFile(path.join(repositoryPath, "src", "runtime.ts"), "export const value = 99;\n");
  const rejected = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failures.some((failure) => failure.includes("runtime fingerprint")), true);
});
