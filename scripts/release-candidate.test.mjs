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
  resolveEvidenceRoot
} from "./lib/release-candidate.mjs";
import { verifyReleaseApproval } from "./verify-release-approval.mjs";

const execFileAsync = promisify(execFile);

async function createRepository() {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "ai-life-release-candidate-"));
  await mkdir(path.join(repositoryPath, "src"), { recursive: true });
  await mkdir(path.join(repositoryPath, "scripts"), { recursive: true });
  await mkdir(path.join(repositoryPath, "docs"), { recursive: true });
  await Promise.all([
    writeFile(path.join(repositoryPath, "src", "runtime.ts"), "export const value = 1;\n"),
    writeFile(path.join(repositoryPath, "src", "runtime.test.ts"), "// test\n"),
    writeFile(path.join(repositoryPath, "scripts", "collector.mjs"), "export const collector = 1;\n"),
    writeFile(path.join(repositoryPath, "docs", "guide.md"), "guide\n"),
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
  assert.equal(result.manifest.repositoryPath, await realpath(repositoryPath));
  assert.equal(result.manifest.evidenceRoot, path.join(evidenceBase, runId));

  assert.throws(() => resolveEvidenceRoot({
    repositoryPath,
    runId: "inside-root",
    root: path.join(repositoryPath, "artifacts", "inside-root")
  }), /outside the Git worktree/u);
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
    releaseEnvironment: { basePath: null, model: null, modelBaseUrl: null },
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

  await writeFile(path.join(repositoryPath, "docs", "guide.md"), "evidence-only follow-up\n");
  const stillApproved = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath
  });
  assert.equal(stillApproved.ok, true, stillApproved.failures.join("\n"));

  await writeFile(path.join(repositoryPath, "src", "runtime.ts"), "export const value = 99;\n");
  const rejected = await verifyReleaseApproval({
    approvalPath: "release/evidence/candidate.json",
    cwd: repositoryPath
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failures.some((failure) => failure.includes("runtime fingerprint")), true);
});
