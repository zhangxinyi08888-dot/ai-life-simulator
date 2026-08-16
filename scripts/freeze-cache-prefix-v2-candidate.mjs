import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const CACHE_PREFIX_V2_CANDIDATE = Object.freeze({
  id: "cache-prefix-v2-reference-context-r4",
  promptPrefixVersion: "next_node_cache_prefix_v2_reference_context_r4",
  model: "deepseek-v4-flash",
  environment: Object.freeze({
    VITE_CACHE_AWARE_PROMPT_V1: "true",
    VITE_CACHE_AWARE_PROMPT_V2: "true"
  })
});

/**
 * Runtime and evidence producers that determine whether an external result
 * belongs to this candidate. Tests are deliberately excluded: their outcome
 * is recorded separately, while this identity binds observable behavior.
 */
export const CACHE_PREFIX_V2_SOURCE_FILES = Object.freeze([
  "package.json",
  "src/App.tsx",
  "src/types.ts",
  "src/services/ai/deepseekBrowserClient.ts",
  "src/services/ai/env.ts",
  "src/services/finalOutcome/finalOutcomeService.ts",
  "src/services/finalOutcome/prompts.ts",
  "src/services/simulation/prompts.ts",
  "src/services/simulation/simulationService.ts",
  "src/utils/deepseek.ts",
  "src/utils/eventPrompt.ts",
  "src/utils/financialNarrative.ts",
  "src/utils/finalFinancialNarrativeAuthority.ts",
  "src/utils/finalOutcomeFinancialContext.ts",
  "src/utils/finalOutcomeQuality.ts",
  "src/utils/finalOutcomeResponse.ts",
  "src/utils/simulationNodeRetry.ts",
  "src/utils/simulationResponse.ts",
  "src/utils/storyConsistency.ts",
  "src/utils/storyContext.ts",
  "src/domain/finance/reconcileCareerIncomeAtomicity.ts",
  "src/domain/relationship/relationshipOutcome.ts",
  "src/domain/relationship/relationshipState.ts",
  "scripts/probe-cache-prefix-layout.mjs",
  "scripts/replay-final-outcome-quality.mjs",
  "scripts/summarize-cache-prefix-run.mjs",
  "scripts/analyze-cache-prefix-acceptance.mjs",
  "scripts/prepare-cache-prefix-blind-review.mjs",
  "scripts/evaluate-cache-prefix-blind-review.mjs",
  "scripts/real-browser-journey-runner.mjs"
]);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedEntries(entries) {
  return [...entries]
    .map((entry) => ({ file: String(entry.file), sha256: digest(String(entry.content)) }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function buildCandidateSourceIdentity({ repositoryCommit, entries, dirtyCandidateFiles = [] }) {
  const files = normalizedEntries(entries);
  return {
    repositoryCommit,
    sourceSha256: digest(JSON.stringify(files)),
    dirtyCandidateFiles: [...new Set(dirtyCandidateFiles)].sort(),
    files
  };
}

export function buildFrozenCandidateManifest({ frozenAt, sourceIdentity }) {
  return {
    schemaVersion: 1,
    frozenAt,
    candidate: CACHE_PREFIX_V2_CANDIDATE,
    sourceIdentity,
    requiredLocalVerification: [
      "pnpm lint",
      "pnpm test:cache-prefix",
      "pnpm test",
      "pnpm build"
    ],
    requiredExternalEvidence: [
      "synthetic DeepSeek V1/V2 probe with provider usage",
      "completed V2 real-AI browser routes with this promptPrefixVersion",
      "anonymous 10-node blind-review packet generated from those routes"
    ]
  };
}

async function readSourceEntries(root) {
  return Promise.all(CACHE_PREFIX_V2_SOURCE_FILES.map(async (file) => ({
    file,
    content: await readFile(path.join(root, file), "utf8")
  })));
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout.trim();
}

async function gitStatus(root, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  // Do not trim: a leading space is part of Git's two-column short-status
  // format and is required to keep the first path intact.
  return stdout;
}

export function parseDirtyCandidateFiles(statusOutput) {
  return String(statusOutput)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1) : file)
    .filter(Boolean);
}

async function currentSourceIdentity(root) {
  const [repositoryCommit, status, entries] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    gitStatus(root, ["status", "--short", "--untracked-files=all", "--", ...CACHE_PREFIX_V2_SOURCE_FILES]),
    readSourceEntries(root)
  ]);
  const dirtyCandidateFiles = parseDirtyCandidateFiles(status);
  return buildCandidateSourceIdentity({ repositoryCommit, entries, dirtyCandidateFiles });
}

export async function freezeCachePrefixV2Candidate({ root, outputPath, frozenAt = new Date().toISOString() }) {
  const sourceIdentity = await currentSourceIdentity(root);
  const manifest = buildFrozenCandidateManifest({ frozenAt, sourceIdentity });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function verifyFrozenCachePrefixV2Candidate({ root, manifestPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const actual = await currentSourceIdentity(root);
  const checks = [
    {
      name: "candidate id",
      passed: manifest?.candidate?.id === CACHE_PREFIX_V2_CANDIDATE.id
    },
    {
      name: "prompt prefix version",
      passed: manifest?.candidate?.promptPrefixVersion === CACHE_PREFIX_V2_CANDIDATE.promptPrefixVersion
    },
    {
      name: "candidate source digest",
      passed: manifest?.sourceIdentity?.sourceSha256 === actual.sourceSha256
    }
  ];
  return { passed: checks.every((check) => check.passed), checks, manifest, actual };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootArgument = argumentValue("--root");
  const root = rootArgument
    ? path.resolve(rootArgument)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const verifyPath = argumentValue("--verify");
  if (verifyPath) {
    const result = await verifyFrozenCachePrefixV2Candidate({ root, manifestPath: path.resolve(verifyPath) });
    process.stdout.write(`${JSON.stringify({ passed: result.passed, checks: result.checks }, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
  } else {
    const outputPath = path.resolve(argumentValue("--output") || path.join(root, "artifacts", "cache-prefix-candidates", "v2-reference-context-r4.json"));
    const manifest = await freezeCachePrefixV2Candidate({ root, outputPath });
    process.stdout.write(`${JSON.stringify({ outputPath, candidate: manifest.candidate, sourceSha256: manifest.sourceIdentity.sourceSha256 }, null, 2)}\n`);
  }
}
