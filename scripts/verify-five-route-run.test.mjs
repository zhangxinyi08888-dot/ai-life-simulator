import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveReleaseEnvironment, sourceIdentityFromCandidate } from "./lib/release-candidate.mjs";
import { verifyFiveRouteRun, writeReleaseApproval } from "./verify-five-route-run.mjs";

const routes = [
  ["real-career-first", "accept_first"],
  ["real-relationship-first", "accept_first"],
  ["real-education-second", "accept_second"],
  ["real-venture-second", "accept_second"],
  ["real-custom-lifespan", "natural_lifespan"]
];

function interactions(scenario, slug) {
  const first = { id: `${slug}-invitation-1` };
  const second = { id: `${slug}-invitation-2` };
  const events = [{ type: "case_started" }];
  if (scenario === "accept_first") {
    events.push({ type: "invitation_shown", invitation: first }, { type: "invitation_accepted", invitation: first });
  } else if (scenario === "accept_second") {
    events.push(
      { type: "invitation_shown", invitation: first },
      { type: "invitation_declined", invitation: first },
      { type: "invitation_shown", invitation: second },
      { type: "invitation_accepted", invitation: second }
    );
  } else {
    events.push(
      { type: "invitation_shown", invitation: first },
      { type: "invitation_declined", invitation: first },
      { type: "mortality_report_opened" }
    );
  }
  events.push({ type: "final_images_saved" });
  return events;
}

async function createValidRun() {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), "ai-life-verifier-repo-"));
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-life-verifier-run-"));
  await Promise.all([
    mkdir(path.join(root, "cases")),
    mkdir(path.join(root, "images")),
    mkdir(path.join(repositoryPath, "release", "evidence"), { recursive: true })
  ]);
  const candidate = {
    schemaVersion: 1,
    candidateId: path.basename(root),
    runId: path.basename(root),
    validationMode: "certify",
    runStartedAt: "2020-01-01T00:00:00.000Z",
    repositoryPath,
    sourceCommit: "a".repeat(40),
    runtimeFingerprint: "b".repeat(64),
    collectorFingerprint: "c".repeat(64),
    evidenceRoot: root,
    releaseEnvironment: resolveReleaseEnvironment({})
  };
  await writeFile(path.join(root, "candidate-manifest.json"), `${JSON.stringify(candidate, null, 2)}\n`);
  const sourceIdentity = sourceIdentityFromCandidate(candidate);
  const records = [];
  for (const [slug, scenario] of routes) {
    const imageDir = path.join(root, "images", slug);
    await mkdir(imageDir, { recursive: true });
    await writeFile(path.join(imageDir, "poster.jpg"), `poster-${slug}`);
    await writeFile(path.join(imageDir, "report-page.jpg"), `page-${slug}`);
    const outcome = {
      meta: { closureType: scenario === "natural_lifespan" ? "mortality" : "user_reflection" },
      report: { id: `${slug}-report` },
      share: { title: `${slug}-share` }
    };
    const record = {
      schemaVersion: 2,
      runId: candidate.runId,
      sourceIdentity,
      dataSource: "real_ai_browser",
      caseSlug: slug,
      scenario,
      config: { branches: [{}, {}, {}] },
      startedAt: "2026-08-03T00:00:00.000Z",
      completedAt: "2026-08-03T00:01:00.000Z",
      interactionLog: interactions(scenario, slug),
      validation: { runtimeIdentityMatchesCandidate: true },
      passed: true,
      finalState: {
        releaseRuntimeIdentity: sourceIdentity,
        testDataSource: "real_ai_browser",
        questions: [{}, {}, {}],
        answers: [{}, {}, {}],
        history: [{
          description: `${slug} complete story body`,
          choices: [{ id: "choice-a", text: "行动" }],
          selectedChoice: `${slug} selected choice`,
          attributes: { happiness: 1, intelligence: 1, wealth: 1, relation: 1, health: 1 },
          financialState: { netWorthWan: 1 }
        }],
        currentNode: { isEndingNode: scenario === "natural_lifespan" },
        outcome
      }
    };
    records.push(record);
    await writeFile(path.join(root, "cases", `${slug}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }
  const fullData = records.map((record) => [
    record.caseSlug,
    record.finalState.history[0].description,
    record.finalState.history[0].selectedChoice,
    JSON.stringify(record.finalState.outcome, null, 2)
  ].join("\n")).join("\n");
  await writeFile(path.join(root, "full-test-data.md"), fullData);
  await writeFile(path.join(root, "evaluation-report.md"), records.map((record) => record.caseSlug).join("\n"));
  await writeFile(path.join(root, "finance-audit.json"), `${JSON.stringify({
    generatedAt: "2026-08-03T00:02:00.000Z",
    validationMode: "certify",
    candidateId: candidate.candidateId,
    derivedDiagnostic: false,
    sourceIdentity: { expected: sourceIdentity, matches: true, mismatches: [] },
    summary: {}
  }, null, 2)}\n`);
  await writeFile(path.join(root, "aggregate.json"), `${JSON.stringify({
    validationMode: "certify",
    caseCount: 5,
    releaseCandidate: true,
    sourceIdentityMatches: true,
    blockers: []
  }, null, 2)}\n`);
  await writeFile(path.join(root, "run-manifest.json"), `${JSON.stringify({
    validationMode: "certify",
    candidateId: candidate.candidateId,
    repositoryCommit: candidate.sourceCommit,
    runtimeFingerprint: candidate.runtimeFingerprint,
    collectorFingerprint: candidate.collectorFingerprint,
    repositoryDirty: false
  }, null, 2)}\n`);
  await writeFile(path.join(root, "visual-inspection.json"), `${JSON.stringify({
    runId: candidate.runId,
    caseCount: 5,
    imageCount: 10,
    passed: true,
    cases: routes.map(([caseSlug]) => ({ caseSlug, passed: true }))
  }, null, 2)}\n`);
  return { repositoryPath, root, candidate, records };
}

test("certification verifier accepts one pinned 2/2/1 corpus and writes only a small approval", async () => {
  const fixture = await createValidRun();
  const result = await verifyFiveRouteRun({ root: fixture.root, verifyRepository: false });
  assert.equal(result.ok, true, result.failures.join("\n"));
  assert.equal(result.caseCount, 5);
  assert.equal(result.evidenceDigest.length, 64);
  const { output } = await writeReleaseApproval(result, "release/evidence/candidate.json");
  const approval = JSON.parse(await readFile(output, "utf8"));
  assert.equal(approval.status, "approved");
  assert.equal(approval.routeVerification.caseCount, 5);
  assert.equal(approval.runtimeFingerprint, fixture.candidate.runtimeFingerprint);
});
test("certification verifier rejects a route collected from another source fingerprint", async () => {
  const fixture = await createValidRun();
  const file = path.join(fixture.root, "cases", "real-career-first.json");
  const record = JSON.parse(await readFile(file, "utf8"));
  record.sourceIdentity.runtimeFingerprint = "wrong";
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = await verifyFiveRouteRun({ root: fixture.root, verifyRepository: false });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.includes("source identity")), true);
});

test("certification verifier rejects a route whose browser runtime does not prove the candidate identity", async () => {
  const fixture = await createValidRun();
  const file = path.join(fixture.root, "cases", "real-career-first.json");
  const record = JSON.parse(await readFile(file, "utf8"));
  record.finalState.releaseRuntimeIdentity.runtimeFingerprint = "wrong";
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  const result = await verifyFiveRouteRun({ root: fixture.root, verifyRepository: false });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.includes("browser runtime identity")), true);
});

test("certification verifier requires the fresh finance machine audit in its evidence digest", async () => {
  const fixture = await createValidRun();
  await writeFile(path.join(fixture.root, "finance-audit.json"), "not-json\n");
  const result = await verifyFiveRouteRun({ root: fixture.root, verifyRepository: false });
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((failure) => failure.includes("finance-audit.json")), true);
});
