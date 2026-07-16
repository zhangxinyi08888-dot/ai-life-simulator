import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface InvitationRecord {
  status: "pending" | "accepted" | "declined";
  reason: "arc_resolved" | "stable_window";
  triggerKey: string;
  completedChoiceCount: number;
  pressureArcId?: string;
  resolutionEvidence?: string[];
}

interface BrowserJourneyRecord {
  caseSlug: string;
  scenario: "accept_first" | "accept_second" | "natural_lifespan";
  firstInvitation: InvitationRecord;
  secondInvitation?: InvitationRecord;
  unexpectedInvitations: InvitationRecord[];
  interactionLog: unknown[];
  finalState: {
    history: Array<{
      selectedChoice?: string;
      choices?: unknown[];
      attributes?: unknown;
      financialState?: unknown;
    }>;
    invitations: InvitationRecord[];
    currentNode?: { ageInMonths?: number; age?: number };
    outcome?: { meta?: { closureType?: string }; report?: unknown; share?: unknown };
  };
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] || 0) + 1;
}

function invitationConditionIsValid(invitation: InvitationRecord): boolean {
  if (invitation.reason === "stable_window") {
    return invitation.completedChoiceCount >= 15 && !invitation.pressureArcId;
  }
  return Boolean(invitation.pressureArcId) && Boolean(invitation.resolutionEvidence?.length);
}

const inputDir = path.resolve(process.argv[2] || "artifacts/report-invitation-browser/2026-07-16-natural-reflection-browser-evaluation");
const files = (await readdir(inputDir)).filter((file) => file.startsWith("journey-") && file.endsWith(".json")).sort();
const records: BrowserJourneyRecord[] = await Promise.all(files.map(async (file) => (
  JSON.parse(await readFile(path.join(inputDir, file), "utf8")) as BrowserJourneyRecord
)));

const invitationReasons: Record<string, number> = {};
const invitationStatuses: Record<string, number> = {};
const closureTypes: Record<string, number> = {};
const scenarioCounts: Record<string, number> = {};

const cases = records.map((record) => {
  const expectedInvitationCount = record.scenario === "accept_first" ? 1 : 2;
  const expectedClosureType = record.scenario === "natural_lifespan" ? "mortality" : "user_reflection";
  const history = record.finalState.history;
  const invitations = record.finalState.invitations;
  invitations.forEach((invitation) => {
    increment(invitationReasons, invitation.reason);
    increment(invitationStatuses, invitation.status);
  });
  increment(closureTypes, record.finalState.outcome?.meta?.closureType || "missing");
  increment(scenarioCounts, record.scenario);

  const assertions = {
    firstInvitationIn12To17: record.firstInvitation.completedChoiceCount >= 12 && record.firstInvitation.completedChoiceCount <= 17,
    firstInvitationConditionValid: invitationConditionIsValid(record.firstInvitation),
    secondInvitationUsesNewStage: record.scenario === "accept_first" || Boolean(
      record.secondInvitation
      && record.secondInvitation.completedChoiceCount > record.firstInvitation.completedChoiceCount
      && record.secondInvitation.triggerKey !== record.firstInvitation.triggerKey
      && invitationConditionIsValid(record.secondInvitation)
    ),
    expectedInvitationCount: invitations.length === expectedInvitationCount,
    noUnexpectedThirdInvitation: record.unexpectedInvitations.length === 0,
    expectedClosureType: record.finalState.outcome?.meta?.closureType === expectedClosureType,
    allNodesPreserveSelectedChoice: history.every((item) => Boolean(item.selectedChoice)),
    allNodesPreserveStoryChoices: history.every((item) => Array.isArray(item.choices)),
    allNodesPreserveAttributes: history.every((item) => Boolean(item.attributes)),
    allNodesPreserveFinancialState: history.every((item) => Boolean(item.financialState)),
    finalReportPresent: Boolean(record.finalState.outcome?.report && record.finalState.outcome?.share)
  };

  return {
    caseSlug: record.caseSlug,
    scenario: record.scenario,
    historyNodeCount: history.length,
    firstInvitationAt: record.firstInvitation.completedChoiceCount,
    firstInvitationReason: record.firstInvitation.reason,
    secondInvitationAt: record.secondInvitation?.completedChoiceCount,
    secondInvitationReason: record.secondInvitation?.reason,
    invitationStatuses: invitations.map((item) => item.status),
    finalClosureType: record.finalState.outcome?.meta?.closureType,
    finalAgeInMonths: record.finalState.currentNode?.ageInMonths,
    interactionCount: record.interactionLog.length,
    assertions,
    passed: Object.values(assertions).every(Boolean)
  };
});

const historyCounts = cases.map((item) => item.historyNodeCount);
const firstInvitationCounts = cases.map((item) => item.firstInvitationAt);
const secondInvitationCounts = cases.flatMap((item) => item.secondInvitationAt === undefined ? [] : [item.secondInvitationAt]);
const aggregate = {
  generatedAt: new Date().toISOString(),
  inputDir,
  caseCount: cases.length,
  allCasesPassed: cases.length === 10 && cases.every((item) => item.passed),
  scenarioCounts,
  totalHistoryNodes: historyCounts.reduce((sum, count) => sum + count, 0),
  totalInvitations: Object.values(invitationReasons).reduce((sum, count) => sum + count, 0),
  invitationReasons,
  invitationStatuses,
  closureTypes,
  firstInvitationRange: [Math.min(...firstInvitationCounts), Math.max(...firstInvitationCounts)],
  secondInvitationRange: [Math.min(...secondInvitationCounts), Math.max(...secondInvitationCounts)],
  historyNodeRange: [Math.min(...historyCounts), Math.max(...historyCounts)],
  cases
};

const outputPath = path.join(inputDir, "aggregate.json");
await writeFile(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
