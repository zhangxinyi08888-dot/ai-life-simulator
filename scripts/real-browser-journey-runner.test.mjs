import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertRuntimeIdentityMatchesCandidate,
  assertDistinctFinalImageEvidence,
  buildDevFsImportReference,
  buildFinalImageRestorePayload,
  buildFinalPosterCropArgs,
  buildCurrentChoiceSelector,
  createRealBrowserJourneyRunner,
  FINAL_IMAGE_VIEWPORT,
  initializeJourneyTrace,
  readLocatorTextInChunks,
  submittedPersonaMatchesConfig,
  validateShortSampleState,
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

test("collector reads a multi-megabyte test state without one oversized bridge frame", async () => {
  const payload = JSON.stringify({ history: Array.from({ length: 50 }, (_, index) => ({
    index,
    description: "完整人生节点".repeat(12_000)
  })) });
  let maximumSlice = 0;
  const locator = {
    evaluate: async (callback, range) => {
      const element = { textContent: payload };
      const value = callback(element, range);
      if (typeof value === "string") maximumSlice = Math.max(maximumSlice, value.length);
      return value;
    }
  };
  const reconstructed = await readLocatorTextInChunks(locator);
  assert.equal(reconstructed, payload);
  assert.ok(maximumSlice <= 180_000);
});

test("collector keeps one frozen snapshot when live text changes between chunks", async () => {
  const original = JSON.stringify({ history: ["初始节点".repeat(80_000)] });
  const replacement = JSON.stringify({ history: ["更新节点".repeat(10)] });
  let liveText = original;
  let sliceCount = 0;
  const locator = {
    evaluate: async (callback, argument) => {
      const value = callback({ textContent: liveText }, argument);
      if (typeof value === "string" && argument?.start !== undefined) {
        sliceCount += 1;
        liveText = replacement;
      }
      return value;
    }
  };
  const reconstructed = await readLocatorTextInChunks(locator, { chunkSize: 32_000, retryDelayMs: 0 });
  assert.equal(reconstructed, replacement);
  assert.ok(sliceCount > 1);
});

test("collector waits through more than eight streaming updates before accepting evidence", async () => {
  let version = 0;
  let mutationsRemaining = 90;
  const locator = {
    evaluate: async (callback, argument) => {
      const payload = JSON.stringify({ version, history: ["流式节点".repeat(12_000)] });
      const value = callback({ textContent: payload }, argument);
      if (typeof value === "string" && argument?.start !== undefined && mutationsRemaining > 0) {
        version += 1;
        mutationsRemaining -= 1;
      }
      return value;
    }
  };
  const reconstructed = await readLocatorTextInChunks(locator, {
    chunkSize: 5_000,
    attempts: 30,
    retryDelayMs: 0
  });
  assert.equal(JSON.parse(reconstructed).version, 90);
  assert.equal(mutationsRemaining, 0);
});

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

test("PB-RUN-12 browser state must expose the frozen candidate identity before it can be collected", () => {
  const sourceIdentity = {
    candidateId: "candidate",
    sourceCommit: "a".repeat(40),
    runtimeFingerprint: "b".repeat(64),
    collectorFingerprint: "c".repeat(64)
  };
  assert.doesNotThrow(() => assertRuntimeIdentityMatchesCandidate({
    runtimeIdentity: { ...sourceIdentity },
    sourceIdentity
  }));
  assert.throws(() => assertRuntimeIdentityMatchesCandidate({
    runtimeIdentity: { ...sourceIdentity, runtimeFingerprint: "wrong" },
    sourceIdentity
  }), /Browser runtime identity/u);
  assert.throws(() => assertRuntimeIdentityMatchesCandidate({
    runtimeIdentity: undefined,
    sourceIdentity
  }), /Browser runtime identity/u);
});

test("PB-RUN-13 short samples validate evidence without impersonating a completed route", () => {
  const node = (index) => ({
    description: `第 ${index} 个真实节点包含具体现实细节。`,
    choices: [{ id: "A", text: "继续推进" }, { id: "B", text: "暂缓验证" }, { id: "C", text: "先恢复节奏" }],
    selectedChoice: "继续推进",
    attributes: { happiness: 50, intelligence: 51, wealth: 52, relation: 53, health: 54 },
    financialState: { netWorthWan: 8.5 }
  });
  const state = {
    testDataSource: "real_ai_browser",
    step: "simulating",
    currentNode: { isEndingNode: false },
    history: Array.from({ length: 5 }, (_, index) => node(index + 1))
  };
  const validation = validateShortSampleState({ finalState: state, targetSelectedNodeCount: 5 });
  assert.equal(Object.values(validation).every(Boolean), true);
  assert.equal(validateShortSampleState({ finalState: state, targetSelectedNodeCount: 4 }).selectedNodeCountMatchesTarget, false);
  assert.equal(validateShortSampleState({
    finalState: { ...state, currentNode: { reportInvitation: { status: "pending" } } },
    targetSelectedNodeCount: 5
  }).noPendingReportInvitation, false);
});
