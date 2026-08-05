#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertCompleteReleaseEnvironment,
  computeSourceState,
  resolveReleaseEnvironment,
  resolveRepositoryRoot
} from "./lib/release-candidate.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++index];
  }
  if (!args.approval) throw new Error("Missing --approval");
  return args;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function verifyReleaseApproval({ approvalPath, cwd = process.cwd(), env = process.env }) {
  const repositoryPath = await resolveRepositoryRoot(cwd);
  const allowedRoot = path.join(repositoryPath, "release", "evidence");
  const absolute = path.resolve(repositoryPath, approvalPath);
  if (!isInside(allowedRoot, absolute) || path.extname(absolute) !== ".json") {
    throw new Error("Approval path must be a JSON file under release/evidence/");
  }
  const approval = JSON.parse(await readFile(absolute, "utf8"));
  const current = await computeSourceState(repositoryPath);
  const failures = [];
  if (approval.status !== "approved" || approval.validationMode !== "certify") failures.push("approval is not a completed certification");
  if (approval.routeVerification?.ok !== true || approval.routeVerification?.caseCount !== 5) failures.push("approval does not contain a passing five-route verification");
  if (approval.routeVerification?.scenarioCounts?.accept_first !== 2
    || approval.routeVerification?.scenarioCounts?.accept_second !== 2
    || approval.routeVerification?.scenarioCounts?.natural_lifespan !== 1) failures.push("approval scenario allocation is not 2/2/1");
  if (!/^[a-f0-9]{64}$/u.test(approval.evidenceDigest || "")) failures.push("approval evidence digest is missing or invalid");
  if (current.runtimeFingerprint !== approval.runtimeFingerprint) failures.push("runtime fingerprint differs from the certified candidate");
  if (current.collectorFingerprint !== approval.collectorFingerprint) failures.push("collector fingerprint differs from the certified candidate");
  if (current.runtimeDirtyPaths.length) failures.push(`runtime files are dirty: ${current.runtimeDirtyPaths.join(", ")}`);
  if (current.collectorDirtyPaths.length) failures.push(`collector files are dirty: ${current.collectorDirtyPaths.join(", ")}`);
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", approval.sourceCommit, "HEAD"], { cwd: repositoryPath });
  } catch {
    failures.push("certified source commit is not an ancestor of the deployment revision");
  }
  let expectedEnvironment;
  try {
    expectedEnvironment = assertCompleteReleaseEnvironment(approval.releaseEnvironment);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "approval release environment is invalid");
  }
  let actualEnvironment;
  try {
    actualEnvironment = resolveReleaseEnvironment(env);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "deployment release environment is invalid");
  }
  if (expectedEnvironment && actualEnvironment) {
    for (const [key, value] of Object.entries(expectedEnvironment)) {
      if (value !== actualEnvironment[key]) {
        failures.push(`release environment ${key} differs from certification`);
      }
    }
  }
  return {
    ok: failures.length === 0,
    approvalPath: absolute,
    candidateId: approval.candidateId,
    sourceCommit: approval.sourceCommit,
    deploymentCommit: current.sourceCommit,
    runtimeFingerprint: current.runtimeFingerprint,
    collectorFingerprint: current.collectorFingerprint,
    failures
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyReleaseApproval({ approvalPath: args.approval });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
