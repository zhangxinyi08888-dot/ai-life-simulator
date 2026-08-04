import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDistinctFinalImageEvidence,
  buildDevFsImportReference,
  buildFinalImageRestorePayload,
  buildFinalPosterCropArgs,
  buildCurrentChoiceSelector,
  createRealBrowserJourneyRunner,
  FINAL_IMAGE_VIEWPORT,
  initializeJourneyTrace,
  submittedPersonaMatchesConfig,
  waitForUniqueLocator,
  validateJourneyInvitationIsolation
} from "./real-browser-journey-runner.mjs";

const identity = {
  runId: "fresh-run",
  journeyId: "journey-new",
  caseSlug: "real-venture-second",
  scenario: "accept_second",
  startedAt: "2026-07-21T00:00:00.000Z"
};

test("PB-RUN-01 a new journey never inherits an old same-slug interaction log", () => {
  const trace = initializeJourneyTrace({
    identity,
    previousRecord: {
      identity: { ...identity, runId: "old-run", journeyId: "journey-old" },
      interactionLog: [
        { type: "case_started", journeyId: "journey-old" },
        { type: "invitation_shown", invitation: { id: "old-invitation", pressureArcId: "old-arc" } }
      ]
    },
    resume: false
  });
  assert.deepEqual(trace, [{
    type: "case_started",
    caseSlug: identity.caseSlug,
    scenario: identity.scenario,
    runId: identity.runId,
    journeyId: identity.journeyId,
    at: identity.startedAt
  }]);
});

test("PB-RUN-02 an invitation or pressure Arc from another journey fails completion validation", () => {
  const trace = [
    { type: "case_started", caseSlug: identity.caseSlug, scenario: identity.scenario, runId: identity.runId, journeyId: identity.journeyId, at: identity.startedAt },
    { type: "invitation_shown", journeyId: identity.journeyId, invitation: { id: "old-invitation", status: "pending", pressureArcId: "old-arc" } },
    { type: "invitation_shown", journeyId: identity.journeyId, invitation: { id: "new-invitation", status: "pending", pressureArcId: "new-arc" } },
    { type: "invitation_accepted", journeyId: identity.journeyId, invitation: { id: "new-invitation", status: "pending", pressureArcId: "new-arc" } }
  ];
  const issues = validateJourneyInvitationIsolation({
    identity,
    trace,
    finalState: {
      history: [{ worldStateSnapshot: { pressureArcs: [{ id: "new-arc" }] } }],
      invitations: [{ id: "new-invitation", status: "accepted", pressureArcId: "new-arc" }]
    },
    expectedInvitations: [{ id: "new-invitation", pressureArcId: "new-arc" }]
  });
  assert.equal(issues.some((issue) => issue.code === "CROSS_JOURNEY_PRESSURE_ARC"), true);
  assert.equal(issues.some((issue) => issue.code === "CROSS_JOURNEY_INVITATION"), true);
});

test("PB-RUN-03 poster and report-page evidence cannot be the same viewport capture", () => {
  const poster = Buffer.from("poster pixels");
  const page = Buffer.from("report page pixels");
  assert.doesNotThrow(() => assertDistinctFinalImageEvidence({ poster, page }));
  assert.throws(
    () => assertDistinctFinalImageEvidence({ poster, page: Buffer.from(poster) }),
    /identical/i
  );
});

test("PB-RUN-04 final-image evidence viewport fully exposes the 844px product canvas", () => {
  assert.deepEqual(FINAL_IMAGE_VIEWPORT, { width: 1280, height: 900 });
});

test("PB-RUN-05 poster evidence is cropped from the full report-page pixels", () => {
  assert.deepEqual(buildFinalPosterCropArgs({
    pagePath: "/tmp/report-page.jpg",
    posterPath: "/tmp/poster.jpg",
    posterRect: { x: 17.2, y: 20.8, width: 355.7, height: 632.9 }
  }), [
    "--cropToHeightWidth", "633", "356",
    "--cropOffset", "21", "17",
    "/tmp/report-page.jpg", "--out", "/tmp/poster.jpg"
  ]);
});

test("PB-RUN-06 final-image restore keeps the exact outcome without replaying heavy history", () => {
  const outcome = { share: { viralTitle: "权威标题" }, report: { id: "report" } };
  const payload = buildFinalImageRestorePayload({
    latestState: {
      step: "insight",
      userName: "旅人",
      userData: { birthday: "1988-05-11" },
      currentNode: { id: "ending", title: "终章", description: "正文", attributes: { health: 10 } },
      currentAttributes: { health: 10 },
      history: [{ id: "heavy-node", financialLedger: { committedTransactions: new Array(100).fill({ id: "tx" }) } }],
      questions: [{ id: "q" }],
      answers: [{ id: "a" }],
      nodeCount: 68,
      simulationSeed: "seed",
      outcome
    }
  });
  assert.equal(payload.outcome, outcome);
  assert.deepEqual(payload.history, []);
  assert.deepEqual(payload.questions, []);
  assert.deepEqual(payload.answers, []);
  assert.equal(payload.currentNode.id, "ending");
  assert.equal(payload.nodeCount, 68);
});

test("PB-RUN-07 large checkpoint recovery uses a Vite filesystem reference without encoding plus signs", () => {
  assert.equal(
    buildDevFsImportReference("/Users/zz/Documents/new life/artifacts/run+08-00/working/checkpoint.json"),
    "@file:/@fs/Users/zz/Documents/new%20life/artifacts/run+08-00/working/checkpoint.json"
  );
  assert.throws(() => buildDevFsImportReference("working/checkpoint.json"), /absolute/i);
});

test("PB-RUN-08 invitation controls may render shortly after the pending state", async () => {
  const counts = [0, 0, 1];
  const locator = { count: async () => counts.shift() ?? 1 };
  let waits = 0;
  const result = await waitForUniqueLocator({
    locator,
    label: "accept invitation button",
    wait: async () => { waits += 1; },
    attempts: 4
  });
  assert.equal(result, locator);
  assert.equal(waits, 2);
});

test("PB-RUN-09 current choice lookup is scoped to the live decision area", () => {
  assert.equal(
    buildCurrentChoiceSelector("choice_continue_side_project"),
    '#inline-decision-area #preset-choices-container [id="choice-btn-choice_continue_side_project"]'
  );
});

test("PB-RUN-10 completion rejects a route whose submitted birthday or birth time differs from its configured persona", () => {
  const config = { birthday: "1994-06-26", birthtime: "21:00" };
  assert.equal(submittedPersonaMatchesConfig({ config, finalState: { userData: { birthday: "1994-06-26", birthtime: "21:00" } } }), true);
  assert.equal(submittedPersonaMatchesConfig({ config, finalState: { userData: { birthday: "1998-05-15", birthtime: "21:00" } } }), false);
  assert.equal(submittedPersonaMatchesConfig({ config, finalState: { userData: { birthday: "1994-06-26", birthtime: "07:00" } } }), false);
});

test("PB-RUN-11 a checkpoint cannot cross release-candidate source identities", async () => {
  const recordRoot = await mkdtemp(path.join(os.tmpdir(), "ai-life-runner-source-"));
  await mkdir(path.join(recordRoot, "working"), { recursive: true });
  const candidate = {
    candidateId: path.basename(recordRoot),
    sourceCommit: "a".repeat(40),
    runtimeFingerprint: "b".repeat(64),
    collectorFingerprint: "c".repeat(64)
  };
  await writeFile(path.join(recordRoot, "candidate-manifest.json"), `${JSON.stringify(candidate)}\n`);
  await writeFile(path.join(recordRoot, "working", "real-venture-second.json"), `${JSON.stringify({
    identity,
    sourceIdentity: { ...candidate, runtimeFingerprint: "different" },
    interactionLog: []
  })}\n`);
  await assert.rejects(createRealBrowserJourneyRunner({
    tab: {},
    recordRoot,
    config: { slug: "real-venture-second", scenario: "accept_second" },
    resume: true
  }), /different release candidate source identity/u);
});
