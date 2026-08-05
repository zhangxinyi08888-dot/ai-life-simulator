import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CANDIDATE_MANIFEST_NAME = "candidate-manifest.json";

export const RUNTIME_ROOTS = [
  "index.html",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "server.ts",
  "src",
  "tsconfig.json",
  "vite.config.ts"
];

export const COLLECTOR_ROOTS = ["scripts"];

const TEST_FILE_PATTERN = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function isRuntimeFile(file) {
  return !TEST_FILE_PATTERN.test(file);
}

function isCollectorFile(file) {
  return !TEST_FILE_PATTERN.test(file);
}

async function runGit(repositoryPath, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  return stdout;
}

export async function resolveRepositoryRoot(cwd = process.cwd()) {
  return (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

async function listScopedFiles(repositoryPath, roots, includeFile) {
  const output = await runGit(repositoryPath, [
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
    "--",
    ...roots
  ]);
  return [...new Set(output.split("\0").filter(Boolean).map(normalizeRelativePath))]
    .filter(includeFile)
    .sort();
}

async function fingerprintFiles(repositoryPath, files) {
  const aggregate = createHash("sha256");
  for (const file of files) {
    const absolute = path.join(repositoryPath, file);
    let fileDigest = "missing";
    let executable = false;
    try {
      const [body, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
      fileDigest = createHash("sha256").update(body).digest("hex");
      executable = Boolean(metadata.mode & 0o111);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    aggregate.update(`${file}\0${fileDigest}\0${executable ? "x" : "-"}\0`);
  }
  return aggregate.digest("hex");
}

function parsePorcelainPaths(output, includeFile) {
  const paths = [];
  for (const token of output.split("\0")) {
    if (!token || token.length < 4 || token[2] !== " ") continue;
    const file = normalizeRelativePath(token.slice(3));
    if (includeFile(file)) paths.push(file);
  }
  return [...new Set(paths)].sort();
}

async function scopedDirtyPaths(repositoryPath, roots, includeFile) {
  const output = await runGit(repositoryPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...roots
  ]);
  return parsePorcelainPaths(output, includeFile);
}

export async function computeSourceState(repositoryPath = process.cwd()) {
  const root = await resolveRepositoryRoot(repositoryPath);
  const [
    sourceCommit,
    sourceTree,
    runtimeFiles,
    collectorFiles,
    runtimeDirtyPaths,
    collectorDirtyPaths
  ] = await Promise.all([
    runGit(root, ["rev-parse", "HEAD"]).then((value) => value.trim()),
    runGit(root, ["rev-parse", "HEAD^{tree}"]).then((value) => value.trim()),
    listScopedFiles(root, RUNTIME_ROOTS, isRuntimeFile),
    listScopedFiles(root, COLLECTOR_ROOTS, isCollectorFile),
    scopedDirtyPaths(root, RUNTIME_ROOTS, isRuntimeFile),
    scopedDirtyPaths(root, COLLECTOR_ROOTS, isCollectorFile)
  ]);
  const [runtimeFingerprint, collectorFingerprint] = await Promise.all([
    fingerprintFiles(root, runtimeFiles),
    fingerprintFiles(root, collectorFiles)
  ]);
  return {
    repositoryPath: root,
    sourceCommit,
    sourceTree,
    runtimeFingerprint,
    collectorFingerprint,
    runtimeFiles,
    collectorFiles,
    runtimeDirtyPaths,
    collectorDirtyPaths
  };
}

export function defaultEvidenceBase(repositoryPath, env = process.env) {
  return path.resolve(
    env.AI_LIFE_TEST_EVIDENCE_ROOT || path.join(repositoryPath, "..", "ai-life-test-evidence")
  );
}

export function resolveEvidenceRoot({ repositoryPath, runId, root, env = process.env }) {
  if (!runId || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(runId)) {
    throw new Error("runId must contain only letters, numbers, dot, underscore, plus, or hyphen");
  }
  const resolved = path.resolve(
    root || path.join(defaultEvidenceBase(repositoryPath, env), "report-invitation-browser", runId)
  );
  if (path.basename(resolved) !== runId) {
    throw new Error(`Evidence root basename must equal runId: ${runId}`);
  }
  if (isPathInside(path.resolve(repositoryPath), resolved)) {
    throw new Error("Real-browser evidence root must be outside the Git worktree");
  }
  return resolved;
}

export function sourceIdentityFromCandidate(candidate) {
  return {
    candidateId: candidate.candidateId,
    sourceCommit: candidate.sourceCommit,
    runtimeFingerprint: candidate.runtimeFingerprint,
    collectorFingerprint: candidate.collectorFingerprint
  };
}

export function sameSourceIdentity(left, right) {
  return Boolean(left && right
    && left.candidateId === right.candidateId
    && left.sourceCommit === right.sourceCommit
    && left.runtimeFingerprint === right.runtimeFingerprint
    && left.collectorFingerprint === right.collectorFingerprint);
}

export async function prepareReleaseCandidate({
  cwd = process.cwd(),
  runId,
  root,
  validationMode = "certify",
  launchUrl = "http://127.0.0.1:4173/",
  evidenceUri,
  env = process.env,
  now = () => new Date().toISOString()
}) {
  if (!new Set(["explore", "certify"]).has(validationMode)) {
    throw new Error(`Unsupported validation mode: ${validationMode}`);
  }
  const source = await computeSourceState(cwd);
  if (validationMode === "certify") {
    const dirty = [...source.runtimeDirtyPaths, ...source.collectorDirtyPaths];
    if (dirty.length) {
      throw new Error(`Certification requires clean runtime and collector files: ${dirty.join(", ")}`);
    }
  }
  const evidenceRoot = resolveEvidenceRoot({
    repositoryPath: source.repositoryPath,
    runId,
    root,
    env
  });
  await mkdir(evidenceRoot, { recursive: true });
  const existing = await readdir(evidenceRoot);
  if (existing.length) {
    throw new Error(`Evidence root is not empty: ${evidenceRoot}`);
  }
  const runStartedAt = now();
  const manifest = {
    schemaVersion: 1,
    candidateId: runId,
    runId,
    validationMode,
    runStartedAt,
    createdAt: runStartedAt,
    repositoryPath: source.repositoryPath,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
    runtimeFingerprint: source.runtimeFingerprint,
    collectorFingerprint: source.collectorFingerprint,
    runtimeDirtyPaths: source.runtimeDirtyPaths,
    collectorDirtyPaths: source.collectorDirtyPaths,
    evidenceRoot,
    ...(evidenceUri ? { evidenceUri } : {}),
    launchUrl,
    releaseEnvironment: {
      basePath: env.BASE_PATH || null,
      model: env.VITE_DEEPSEEK_MODEL || null,
      modelBaseUrl: env.VITE_DEEPSEEK_BASE_URL || null
    },
    requiredScenarioCounts: {
      accept_first: 2,
      accept_second: 2,
      natural_lifespan: 1
    }
  };
  const manifestPath = path.join(evidenceRoot, CANDIDATE_MANIFEST_NAME);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, manifestPath, source };
}

export async function loadCandidateManifest(candidatePathOrRoot) {
  const resolved = path.resolve(candidatePathOrRoot);
  const manifestPath = path.basename(resolved) === CANDIDATE_MANIFEST_NAME
    ? resolved
    : path.join(resolved, CANDIDATE_MANIFEST_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return { manifest, manifestPath };
}

export async function assertCandidateMatchesRepository(candidate, {
  cwd = process.cwd(),
  requireClean = candidate.validationMode === "certify",
  requireSourceCommit = true,
  requireCollector = true
} = {}) {
  const current = await computeSourceState(cwd);
  const failures = [];
  if (requireSourceCommit && current.sourceCommit !== candidate.sourceCommit) {
    failures.push(`source commit changed: ${candidate.sourceCommit} -> ${current.sourceCommit}`);
  }
  if (current.runtimeFingerprint !== candidate.runtimeFingerprint) {
    failures.push("runtime fingerprint changed");
  }
  if (requireCollector && current.collectorFingerprint !== candidate.collectorFingerprint) {
    failures.push("collector fingerprint changed");
  }
  if (requireClean && current.runtimeDirtyPaths.length) {
    failures.push(`runtime files are dirty: ${current.runtimeDirtyPaths.join(", ")}`);
  }
  if (requireClean && requireCollector && current.collectorDirtyPaths.length) {
    failures.push(`collector files are dirty: ${current.collectorDirtyPaths.join(", ")}`);
  }
  if (failures.length) {
    const error = new Error(`Release candidate no longer matches the repository: ${failures.join("; ")}`);
    error.failures = failures;
    throw error;
  }
  return current;
}
