import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const recordRoot = path.resolve(process.argv[2] || "artifacts/report-invitation-browser/2026-07-17-phase2-real-ai-browser-evaluation");
const casesDir = path.join(recordRoot, "cases");
const imagesDir = path.join(recordRoot, "images");
const caseFiles = (await readdir(casesDir)).filter((file) => file.endsWith(".json")).sort();
const records = await Promise.all(caseFiles.map(async (file) => JSON.parse(await readFile(path.join(casesDir, file), "utf8"))));

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const modeCounts = {};
const eventCounts = {};
const invitationReasons = {};
const invitationStatuses = {};
const closureTypes = {};
const scenarioCounts = {};
const financialAnomalies = {
  studentNodes: 0,
  retiredNodes: 0,
  coreExpense1_2Nodes: 0,
  negativeDisposableNodes: 0
};
let totalNodes = 0;
let recordedAiErrors = 0;

const cases = [];
for (const record of records) {
  const history = record.finalState?.history || [];
  const invitations = record.finalState?.invitations || [];
  totalNodes += history.length;
  increment(scenarioCounts, record.scenario);
  increment(closureTypes, record.finalState?.outcome?.meta?.closureType || "missing");

  for (const invitation of invitations) {
    increment(invitationReasons, invitation.reason || "missing");
    increment(invitationStatuses, invitation.status || "missing");
  }

  for (const node of history) {
    increment(modeCounts, node.eventMeta?.eventMode || "missing");
    increment(eventCounts, node.eventMeta?.eventId || "missing");
    const financial = node.financialState || {};
    if (financial.employmentStatus === "student") financialAnomalies.studentNodes += 1;
    if (financial.employmentStatus === "retired") financialAnomalies.retiredNodes += 1;
    if (financial.annualCoreExpenseWan === 1.2) financialAnomalies.coreExpense1_2Nodes += 1;
    if (financial.annualDisposableIncomeWan < 0) financialAnomalies.negativeDisposableNodes += 1;
  }

  recordedAiErrors += (record.interactionLog || []).filter((item) => (
    /error/i.test(item.type || "") || /error/i.test(item.error || "")
  )).length;

  const imageDir = path.join(imagesDir, record.caseSlug);
  const imageFiles = await readdir(imageDir);
  const posterPresent = await Promise.any(
    imageFiles.filter((file) => /^poster\.(jpg|png)$/i.test(file)).map((file) => exists(path.join(imageDir, file)))
  ).catch(() => false);
  const reportPagePresent = await Promise.any(
    imageFiles.filter((file) => /^report-page\.(jpg|png)$/i.test(file)).map((file) => exists(path.join(imageDir, file)))
  ).catch(() => false);

  cases.push({
    caseSlug: record.caseSlug,
    scenario: record.scenario,
    historyNodeCount: history.length,
    invitations: invitations.map((invitation) => ({
      completedChoiceCount: invitation.completedChoiceCount,
      reason: invitation.reason,
      status: invitation.status,
      triggerKey: invitation.triggerKey
    })),
    closureType: record.finalState?.outcome?.meta?.closureType,
    finalAgeInMonths: record.finalState?.currentNode?.ageInMonths,
    imagesPresent: posterPresent && reportPagePresent,
    passed: record.passed,
    validation: record.validation
  });
}

const classifiedNodeCount = totalNodes - (modeCounts.missing || 0);
const modeShares = Object.fromEntries(Object.entries(modeCounts)
  .filter(([mode]) => mode !== "missing")
  .map(([mode, count]) => [mode, Number(((count / classifiedNodeCount) * 100).toFixed(1))]));

const aggregate = {
  generatedAt: new Date().toISOString(),
  recordRoot,
  caseCount: records.length,
  passedCaseCount: cases.filter((item) => item.passed).length,
  allArtifactsPresent: cases.every((item) => item.imagesPresent),
  scenarioCounts,
  totalNodes,
  classifiedNodeCount,
  modeCounts,
  modeShares,
  totalInvitations: Object.values(invitationReasons).reduce((sum, count) => sum + count, 0),
  invitationReasons,
  invitationStatuses,
  closureTypes,
  financialAnomalies,
  recordedAiErrors,
  topEventIds: Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
  cases
};

await writeFile(path.join(recordRoot, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
