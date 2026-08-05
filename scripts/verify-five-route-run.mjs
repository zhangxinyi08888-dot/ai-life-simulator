#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertCandidateMatchesRepository,
  loadCandidateManifest,
  sameSourceIdentity,
  sourceIdentityFromCandidate
} from "./lib/release-candidate.mjs";
import { auditFinancialProductionRecords } from "./lib/financial-production-audit.mjs";

const execFileAsync = promisify(execFile);
const ANALYZER_PATH = fileURLToPath(new URL("./analyze-financial-real-browser-run.mjs", import.meta.url));
const ZERO_PRODUCTION_AUDIT_COUNTS = Object.freeze([
  "fallbackWithoutRepairRecordCount",
  "userVisibleInternalLedgerTextCount",
  "finalReportFinancialConflictCount",
  "unexplainedDebtDeltaNodeCount",
  "fabricatedOpeningAccountCount",
  "assetSummaryMismatchNodeCount",
  "debtConservationFailureCount",
  "autoShortfallFrozenAboveReserveNodeCount",
  "knownRateInterestOmissionNodeCount",
  "unsupportedRepaymentCompletionNodeCount",
  "userVisibleFinancialPlaceholderCount",
  "orphanFinancialAmountCount",
  "financialAmountPrecisionViolationCount",
  "crossJourneyInvitationEntryCount",
  "companyOperatingFlowInPersonalLedgerCount",
  "restrictedProjectFundingInPersonalCashCount",
  "restrictedProjectFundingAttributionGapCount",
  "unclassifiedGenerationCallCount",
  "excessivePatchNodeCount"
]);
const ZERO_FINANCE_AUDIT_COUNTS = Object.freeze([
  "invariantFailures",
  "openingFactMismatchCases",
  "salaryMismatchNodes",
  "financialGateCommittedBlockViolationCount",
  "financialGateNonEnforcedCommittedNodeCount",
  "financialGateModeMissingCommittedNodeCount",
  "adultBelowPolicyExpenseNodes",
  "wealthDirectionMismatches",
  "blockingOpenIssues",
  "visibleGenerationPauseCount"
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++index];
  }
  if (!args.root) throw new Error("Missing --root");
  return args;
}

function isoTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function appendFailure(condition, message, failures) {
  if (!condition) failures.push(message);
}

function invitationSequence(record) {
  const sequence = [];
  for (const event of record.interactionLog || []) {
    if (!event?.type?.startsWith("invitation_")) continue;
    const id = event.invitation?.id;
    if (!id) continue;
    let invitation = sequence.find((item) => item.id === id);
    if (!invitation) {
      invitation = { id, events: [] };
      sequence.push(invitation);
    }
    invitation.events.push(event.type);
  }
  return sequence;
}

async function existingImage(imagesDir, names) {
  for (const name of names) {
    const file = path.join(imagesDir, name);
    try {
      const metadata = await stat(file);
      if (metadata.isFile() && metadata.size > 0) return { file, metadata };
    } catch {
      // Try the next supported extension.
    }
  }
  return undefined;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function digestEvidence(root, files) {
  const digest = createHash("sha256");
  for (const absolute of [...new Set(files.map((file) => path.resolve(file)))].sort()) {
    if (!isInside(root, absolute)) throw new Error(`Evidence file is outside run root: ${absolute}`);
    const body = await readFile(absolute);
    digest.update(`${path.relative(root, absolute)}\0`);
    digest.update(createHash("sha256").update(body).digest("hex"));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function recomputeCertifiedAnalysis({ root, cwd }) {
  try {
    await execFileAsync(process.execPath, [ANALYZER_PATH, root, "--mode", "certify"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    const detail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
    throw new Error(`Failed to recompute the certified financial audit: ${detail}`);
  }
}

export async function verifyFiveRouteRun({
  root: rootInput,
  fullData: fullDataInput,
  report: reportInput,
  verifyRepository = true,
  recomputeAudit = verifyRepository,
  cwd = process.cwd()
}) {
  const root = path.resolve(rootInput);
  const casesDir = path.join(root, "cases");
  const imagesRoot = path.join(root, "images");
  const fullData = path.resolve(fullDataInput || path.join(root, "full-test-data.md"));
  const report = path.resolve(reportInput || path.join(root, "evaluation-report.md"));
  const financeAudit = path.join(root, "finance-audit.json");
  const { manifest: candidate, manifestPath: candidatePath } = await loadCandidateManifest(root);
  const startedAfter = isoTime(candidate.runStartedAt);
  if (!Number.isFinite(startedAfter)) throw new Error(`Invalid candidate runStartedAt: ${candidate.runStartedAt}`);
  if (verifyRepository) await assertCandidateMatchesRepository(candidate);
  if (recomputeAudit) await recomputeCertifiedAnalysis({ root, cwd });

  const failures = [];
  appendFailure(candidate.validationMode === "certify", "candidate is not in certify mode", failures);
  appendFailure(candidate.runId === path.basename(root), "candidate runId does not match run-root basename", failures);
  appendFailure(path.resolve(candidate.evidenceRoot) === root, "candidate evidenceRoot does not match run root", failures);
  const expectedSourceIdentity = sourceIdentityFromCandidate(candidate);

  await access(casesDir);
  const caseFiles = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
  appendFailure(caseFiles.length === 5, `Expected exactly 5 completed case JSON files, found ${caseFiles.length}`, failures);

  const records = [];
  const evidenceFiles = [candidatePath, fullData, report, financeAudit];
  for (const fileName of caseFiles) {
    const file = path.join(casesDir, fileName);
    const metadata = await stat(file);
    evidenceFiles.push(file);
    let record;
    try {
      record = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      failures.push(`${fileName}: invalid JSON (${error.message})`);
      continue;
    }
    records.push(record);
    const label = record.caseSlug || fileName;
    const state = record.finalState || {};
    const history = Array.isArray(state.history) ? state.history : [];
    const outcome = state.outcome || {};
    const invitations = invitationSequence(record);
    const eventTypes = (record.interactionLog || []).map((event) => event?.type).filter(Boolean);

    appendFailure(record.runId === path.basename(root), `${label}: runId does not match run root`, failures);
    appendFailure(sameSourceIdentity(record.sourceIdentity, expectedSourceIdentity), `${label}: source identity does not match candidate`, failures);
    appendFailure(sameSourceIdentity(state.releaseRuntimeIdentity, expectedSourceIdentity), `${label}: browser runtime identity does not match candidate`, failures);
    appendFailure(record.validation?.runtimeIdentityMatchesCandidate === true, `${label}: completion did not validate browser runtime identity`, failures);
    appendFailure(record.dataSource === "real_ai_browser", `${label}: dataSource is not real_ai_browser`, failures);
    appendFailure(state.testDataSource === "real_ai_browser" && !state.e2eCase, `${label}: final state is not proven real-AI browser data`, failures);
    appendFailure(record.passed === true, `${label}: record.passed is not true`, failures);
    appendFailure(isoTime(record.startedAt) >= startedAfter, `${label}: startedAt predates candidate`, failures);
    appendFailure(isoTime(record.completedAt) >= startedAfter, `${label}: completedAt predates candidate`, failures);
    appendFailure(metadata.mtimeMs >= startedAfter, `${label}: case JSON predates candidate`, failures);
    appendFailure(history.length > 0, `${label}: history is empty`, failures);
    appendFailure(record.config && Array.isArray(record.config.branches) && record.config.branches.length === 3, `${label}: persona/branch config is incomplete`, failures);
    appendFailure(Array.isArray(state.questions) && state.questions.length === 3, `${label}: generated questions are incomplete`, failures);
    appendFailure(Array.isArray(state.answers) && state.answers.length === 3, `${label}: answers are incomplete`, failures);

    history.forEach((node, index) => {
      const nodeLabel = `${label} node ${index + 1}`;
      appendFailure(typeof node.description === "string" && node.description.trim().length > 0, `${nodeLabel}: missing story body`, failures);
      appendFailure(!/第\s*\d+\s*个阶段带来了新的现实反馈/u.test(node.description || ""), `${nodeLabel}: deterministic template body detected`, failures);
      appendFailure(Array.isArray(node.choices) && node.choices.length > 0, `${nodeLabel}: displayed choices missing`, failures);
      appendFailure(typeof node.selectedChoice === "string" && node.selectedChoice.trim().length > 0, `${nodeLabel}: selected choice missing`, failures);
      const attributes = node.attributes || {};
      appendFailure(["happiness", "intelligence", "wealth", "relation", "health"].every((key) => Number.isFinite(attributes[key])), `${nodeLabel}: five attributes incomplete`, failures);
      appendFailure(node.financialState && Number.isFinite(node.financialState.netWorthWan), `${nodeLabel}: structured financial state missing`, failures);
    });

    appendFailure(outcome.report && outcome.share, `${label}: complete final report/share data missing`, failures);
    if (record.scenario === "accept_first") {
      appendFailure(invitations.length >= 1, `${label}: no distinct first invitation`, failures);
      appendFailure(invitations[0]?.events.includes("invitation_accepted"), `${label}: first invitation was not accepted`, failures);
      appendFailure(!invitations[0]?.events.includes("invitation_declined"), `${label}: first invitation was declined before acceptance`, failures);
      appendFailure(outcome.meta?.closureType === "user_reflection", `${label}: wrong closure for accept_first`, failures);
    } else if (record.scenario === "accept_second") {
      appendFailure(invitations.length >= 2, `${label}: fewer than two distinct invitations`, failures);
      appendFailure(invitations[0]?.events.includes("invitation_declined"), `${label}: first invitation was not declined`, failures);
      appendFailure(invitations[1]?.events.includes("invitation_accepted"), `${label}: second invitation was not accepted`, failures);
      appendFailure(outcome.meta?.closureType === "user_reflection", `${label}: wrong closure for accept_second`, failures);
    } else if (record.scenario === "natural_lifespan") {
      appendFailure(!eventTypes.includes("invitation_accepted"), `${label}: invitation accepted on natural_lifespan`, failures);
      appendFailure(invitations.every((item) => item.events.includes("invitation_declined")), `${label}: not every invitation was declined`, failures);
      appendFailure(eventTypes.includes("mortality_report_opened"), `${label}: mortality report was not opened`, failures);
      appendFailure(outcome.meta?.closureType === "mortality", `${label}: wrong closure for natural_lifespan`, failures);
      appendFailure(state.currentNode?.isEndingNode === true, `${label}: final node is not physiological ending`, failures);
    } else {
      failures.push(`${label}: unsupported scenario ${record.scenario}`);
    }

    appendFailure(eventTypes.includes("final_images_saved"), `${label}: image-save event missing`, failures);
    const imageDir = path.join(imagesRoot, label);
    const poster = await existingImage(imageDir, ["poster.jpg", "poster.png"]);
    const pageImage = await existingImage(imageDir, ["report-page.jpg", "report-page.png"]);
    appendFailure(Boolean(poster), `${label}: poster image missing or empty`, failures);
    appendFailure(Boolean(pageImage), `${label}: report-page image missing or empty`, failures);
    if (poster) {
      evidenceFiles.push(poster.file);
      appendFailure(poster.metadata.mtimeMs >= startedAfter, `${label}: poster predates candidate`, failures);
    }
    if (pageImage) {
      evidenceFiles.push(pageImage.file);
      appendFailure(pageImage.metadata.mtimeMs >= startedAfter, `${label}: report-page predates candidate`, failures);
    }
  }

  const scenarioCounts = records.reduce((counts, record) => {
    counts[record.scenario] = (counts[record.scenario] || 0) + 1;
    return counts;
  }, {});
  appendFailure(scenarioCounts.accept_first === 2, `Expected 2 accept_first cases, found ${scenarioCounts.accept_first || 0}`, failures);
  appendFailure(scenarioCounts.accept_second === 2, `Expected 2 accept_second cases, found ${scenarioCounts.accept_second || 0}`, failures);
  appendFailure(scenarioCounts.natural_lifespan === 1, `Expected 1 natural_lifespan case, found ${scenarioCounts.natural_lifespan || 0}`, failures);

  try {
    const metadata = await stat(fullData);
    const body = await readFile(fullData, "utf8");
    appendFailure(metadata.size > 0, "full-data Markdown is empty", failures);
    appendFailure(metadata.mtimeMs >= startedAfter, "full-data Markdown predates candidate", failures);
    for (const record of records) {
      appendFailure(body.includes(record.caseSlug), `full-data Markdown: missing ${record.caseSlug}`, failures);
      for (const [index, node] of (record.finalState?.history || []).entries()) {
        appendFailure(body.includes(node.description), `full-data Markdown: missing ${record.caseSlug} node ${index + 1} body`, failures);
        appendFailure(body.includes(node.selectedChoice), `full-data Markdown: missing ${record.caseSlug} node ${index + 1} selected choice`, failures);
      }
      appendFailure(body.includes(JSON.stringify(record.finalState?.outcome || {}, null, 2)), `full-data Markdown: missing complete outcome for ${record.caseSlug}`, failures);
    }
  } catch (error) {
    failures.push(`full-data Markdown missing or invalid (${error.message})`);
  }

  try {
    const metadata = await stat(report);
    const body = await readFile(report, "utf8");
    appendFailure(metadata.size > 0, "evaluation report is empty", failures);
    appendFailure(metadata.mtimeMs >= startedAfter, "evaluation report predates candidate", failures);
    for (const record of records) appendFailure(body.includes(record.caseSlug), `evaluation report: missing ${record.caseSlug}`, failures);
  } catch (error) {
    failures.push(`evaluation report missing or invalid (${error.message})`);
  }

  try {
    const metadata = await stat(financeAudit);
    const audit = JSON.parse(await readFile(financeAudit, "utf8"));
    appendFailure(metadata.size > 0, "finance audit is empty", failures);
    appendFailure(metadata.mtimeMs >= startedAfter, "finance audit predates candidate", failures);
    appendFailure(isoTime(audit.generatedAt) >= startedAfter, "finance audit generatedAt predates candidate", failures);
    appendFailure(audit.validationMode === "certify", "finance audit is not certify mode", failures);
    appendFailure(audit.candidateId === candidate.candidateId, "finance audit candidateId mismatch", failures);
    appendFailure(audit.derivedDiagnostic === false, "finance audit is a derived diagnostic, not certification evidence", failures);
    appendFailure(sameSourceIdentity(audit.sourceIdentity?.expected, expectedSourceIdentity), "finance audit source identity does not match candidate", failures);
    appendFailure(audit.sourceIdentity?.matches === true, "finance audit reports a source identity mismatch", failures);
    appendFailure(Boolean(audit.summary && typeof audit.summary === "object"), "finance audit summary is missing", failures);
    for (const key of ZERO_FINANCE_AUDIT_COUNTS) {
      appendFailure(
        audit.summary?.[key] === 0,
        `finance audit reports release blocker ${key}: ${audit.summary?.[key]}`,
        failures
      );
    }
    const recomputedProductionAudit = auditFinancialProductionRecords(records);
    appendFailure(Boolean(audit.productionAudit?.summary && typeof audit.productionAudit.summary === "object"), "finance audit production summary is missing", failures);
    for (const [key, value] of Object.entries(recomputedProductionAudit.summary)) {
      appendFailure(
        JSON.stringify(audit.productionAudit?.summary?.[key]) === JSON.stringify(value),
        `finance audit production summary differs from cases for ${key}`,
        failures
      );
    }
    for (const key of ZERO_PRODUCTION_AUDIT_COUNTS) {
      appendFailure(
        recomputedProductionAudit.summary[key] === 0,
        `finance audit recomputation found release blocker ${key}: ${recomputedProductionAudit.summary[key]}`,
        failures
      );
    }
  } catch (error) {
    failures.push(`finance-audit.json missing or invalid (${error.message})`);
  }

  const aggregatePath = path.join(root, "aggregate.json");
  const runManifestPath = path.join(root, "run-manifest.json");
  const visualInspectionPath = path.join(root, "visual-inspection.json");
  evidenceFiles.push(aggregatePath, runManifestPath, visualInspectionPath);
  try {
    const metadata = await stat(aggregatePath);
    const aggregate = JSON.parse(await readFile(aggregatePath, "utf8"));
    appendFailure(metadata.mtimeMs >= startedAfter, "aggregate predates candidate", failures);
    appendFailure(aggregate.validationMode === "certify", "aggregate is not certify mode", failures);
    appendFailure(aggregate.caseCount === 5, "aggregate caseCount is not 5", failures);
    appendFailure(aggregate.releaseCandidate === true, "aggregate releaseCandidate is not true", failures);
    appendFailure(aggregate.sourceIdentityMatches === true, "aggregate source identity did not match", failures);
    appendFailure(Array.isArray(aggregate.blockers) && aggregate.blockers.length === 0, "aggregate still has blockers", failures);
  } catch (error) {
    failures.push(`aggregate.json missing or invalid (${error.message})`);
  }
  try {
    const metadata = await stat(runManifestPath);
    const runManifest = JSON.parse(await readFile(runManifestPath, "utf8"));
    appendFailure(metadata.mtimeMs >= startedAfter, "run manifest predates candidate", failures);
    appendFailure(runManifest.validationMode === "certify", "run manifest is not certify mode", failures);
    appendFailure(runManifest.candidateId === candidate.candidateId, "run manifest candidateId mismatch", failures);
    appendFailure(runManifest.repositoryCommit === candidate.sourceCommit, "run manifest source commit mismatch", failures);
    appendFailure(runManifest.runtimeFingerprint === candidate.runtimeFingerprint, "run manifest runtime fingerprint mismatch", failures);
    appendFailure(runManifest.collectorFingerprint === candidate.collectorFingerprint, "run manifest collector fingerprint mismatch", failures);
    appendFailure(runManifest.repositoryDirty === false, "run manifest reports dirty runtime or collector files", failures);
  } catch (error) {
    failures.push(`run-manifest.json missing or invalid (${error.message})`);
  }
  try {
    const metadata = await stat(visualInspectionPath);
    const visual = JSON.parse(await readFile(visualInspectionPath, "utf8"));
    appendFailure(metadata.mtimeMs >= startedAfter, "visual inspection predates candidate", failures);
    appendFailure(visual.runId === candidate.runId, "visual inspection runId mismatch", failures);
    appendFailure(visual.caseCount === 5 && visual.imageCount === 10, "visual inspection does not cover all ten images", failures);
    appendFailure(visual.passed === true, "visual inspection did not pass", failures);
    const inspectedSlugs = Array.isArray(visual.cases) ? visual.cases.map((item) => item.caseSlug).sort() : [];
    appendFailure(Array.isArray(visual.cases)
      && visual.cases.length === 5
      && visual.cases.every((item) => item.passed)
      && JSON.stringify(inspectedSlugs) === JSON.stringify(records.map((record) => record.caseSlug).sort()), "visual inspection case results are incomplete", failures);
  } catch (error) {
    failures.push(`visual-inspection.json missing or invalid (${error.message})`);
  }

  const evidenceDigest = failures.length ? undefined : await digestEvidence(root, evidenceFiles);
  return {
    ok: failures.length === 0,
    root,
    candidate,
    caseCount: records.length,
    scenarioCounts,
    evidenceDigest,
    checkedAt: new Date().toISOString(),
    failures
  };
}

export async function writeReleaseApproval(result, approvalOutput) {
  if (!result.ok) throw new Error("Cannot write release approval for a failed verification");
  const repositoryPath = path.resolve(result.candidate.repositoryPath);
  const allowedRoot = path.join(repositoryPath, "release", "evidence");
  const output = path.resolve(repositoryPath, approvalOutput);
  if (!isInside(allowedRoot, output) || path.extname(output) !== ".json") {
    throw new Error("Release approval must be a JSON file under release/evidence/");
  }
  await mkdir(path.dirname(output), { recursive: true });
  const approval = {
    schemaVersion: 1,
    status: "approved",
    validationMode: "certify",
    candidateId: result.candidate.candidateId,
    runId: result.candidate.runId,
    sourceCommit: result.candidate.sourceCommit,
    runtimeFingerprint: result.candidate.runtimeFingerprint,
    collectorFingerprint: result.candidate.collectorFingerprint,
    releaseEnvironment: result.candidate.releaseEnvironment,
    evidenceUri: result.candidate.evidenceUri || null,
    evidenceDigest: result.evidenceDigest,
    certifiedAt: result.checkedAt,
    routeVerification: {
      ok: true,
      caseCount: result.caseCount,
      scenarioCounts: result.scenarioCounts
    }
  };
  await writeFile(output, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  return { approval, output };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await verifyFiveRouteRun({
    root: args.root,
    fullData: args["full-data"],
    report: args.report
  });
  if (result.ok && args["approval-out"]) {
    const approval = await writeReleaseApproval(result, args["approval-out"]);
    result.approvalPath = approval.output;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
