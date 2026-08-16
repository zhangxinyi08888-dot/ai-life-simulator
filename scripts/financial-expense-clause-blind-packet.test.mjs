import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildFinancialExpenseClauseBlindPacket,
  financialExpenseClauseBlindSourceSha256,
  validateFinancialExpenseClauseBlindAdjudication
} from "./lib/financial-expense-clause-blind-packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureBytes = await readFile(path.join(
  here,
  "../src/domain/finance/fixtures/financial-expense-clause-binding-gold-v1.json"
));
const corpus = JSON.parse(fixtureBytes.toString("utf8"));
const sourceSha256 = financialExpenseClauseBlindSourceSha256(corpus);

test("normalized independent review preserves raw source identity and the audited 48-entry contract", async () => {
  const [packet, rawReview] = await Promise.all([
    readFile(path.join(here, "../src/domain/finance/fixtures/financial-expense-clause-blind-adjudication-v1.json"), "utf8").then(JSON.parse),
    readFile(path.join(here, "../docs/superpowers/reviews/2026-08-11-financial-expense-clause-blind-review-raw.md"))
  ]);
  const result = validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 });
  assert.equal(packet.normalization.rawReviewSha256, createHash("sha256").update(rawReview).digest("hex"));
  assert.equal(packet.normalization.originalAnnotationCount, 45);
  assert.equal(packet.normalization.normalizedAnnotationCount, 48);
  assert.deepEqual(result, {
    status: "review_complete",
    reviewedExampleCount: 33,
    annotationCount: 48,
    dispositionCounts: { material: 26, review: 9, ignore: 13 }
  });
});

test("blind source identity depends only on reviewer-visible IDs and narratives", () => {
  const relabeled = structuredClone(corpus);
  relabeled.revision += 1;
  relabeled.examples[0].expectedBindings = [];
  assert.equal(financialExpenseClauseBlindSourceSha256(relabeled), sourceSha256);
  relabeled.examples[0].narrative += "改";
  assert.notEqual(financialExpenseClauseBlindSourceSha256(relabeled), sourceSha256);
});

test("blind adjudication packet exposes narratives but no implementation-authored labels", () => {
  const packet = buildFinancialExpenseClauseBlindPacket({ corpus, sourceSha256 });
  assert.equal(packet.source.corpusSha256, sourceSha256);
  assert.equal(packet.examples.length, corpus.examples.length);
  assert.equal(packet.reviewerDeclaration.detectorOutputConsulted, false);
  assert.equal(packet.reviewerDeclaration.proposalLedgerAuditConsulted, false);
  assert.ok(packet.examples.every((example) => example.reviewed === false));
  assert.ok(packet.examples.every((example) => example.annotations.length === 0));
  assert.deepEqual(
    packet.examples.map((example) => example.id),
    corpus.examples.map((example) => example.id)
  );
  for (const example of packet.examples) {
    assert.equal(
      example.narrativeSha256,
      createHash("sha256").update(example.narrative).digest("hex")
    );
  }
  const serialized = JSON.stringify(packet);
  for (const forbidden of [
    "expectedBindings",
    "expectedCandidateDisposition",
    "negativeAssertions",
    "plannedObservations",
    "sourceBindingReasonCodes",
    "\"detectorOutput\":"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `blind packet leaked ${forbidden}`);
  }
});

test("completed independent packet validates source identity, declaration, review coverage, and spans", () => {
  const packet = buildFinancialExpenseClauseBlindPacket({ corpus, sourceSha256 });
  packet.reviewerDeclaration = {
    reviewerId: "independent-reviewer-1",
    reviewedAt: "2026-08-09T00:00:00+08:00",
    method: "independent_blind",
    detectorOutputConsulted: false,
    proposalLedgerAuditConsulted: false
  };
  for (const example of packet.examples) example.reviewed = true;
  const first = packet.examples[0];
  first.annotations.push({
    annotationId: "blind:C-01:rent",
    disposition: "review",
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    completion: "completed",
    cadence: "monthly",
    liability: "protagonist",
    financialScope: "personal",
    spans: { responsibility: { start: 7, end: 9, excerpt: "房租" } }
  });
  const result = validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 });
  assert.equal(result.reviewedExampleCount, corpus.examples.length);
  assert.equal(result.annotationCount, 1);
  assert.equal(result.status, "insufficient_material_coverage");
});

test("blind adjudication accepts per-example annotation IDs and compact UTF-16 span tuples", () => {
  const packet = buildFinancialExpenseClauseBlindPacket({ corpus, sourceSha256 });
  packet.reviewerDeclaration = {
    reviewerId: "independent-reviewer-1",
    reviewedAt: "2026-08-11T00:00:00+08:00",
    method: "independent_blind",
    detectorOutputConsulted: false,
    proposalLedgerAuditConsulted: false
  };
  for (const example of packet.examples) example.reviewed = true;
  packet.examples[0].annotations.push({
    annotationId: "A-01",
    disposition: "material",
    responsibilityKey: "protagonist",
    responsibilityKind: "rent",
    completion: "ongoing",
    cadence: "monthly",
    liability: "sole",
    financialScope: "personal",
    spans: { responsibility: [0, 14] }
  });
  packet.examples[1].annotations.push({
    annotationId: "A-01",
    disposition: "review",
    responsibilityKey: "protagonist",
    responsibilityKind: "rent",
    completion: "planned",
    cadence: "monthly",
    liability: "sole",
    financialScope: "personal",
    spans: { responsibility: [0, 14] }
  });
  const result = validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 });
  assert.equal(result.annotationCount, 2);
  assert.deepEqual(result.dispositionCounts, { material: 1, review: 1, ignore: 0 });
});

test("blind adjudication rejects unreviewed examples and mismatched excerpts", () => {
  const packet = buildFinancialExpenseClauseBlindPacket({ corpus, sourceSha256 });
  packet.reviewerDeclaration.reviewerId = "independent-reviewer-1";
  packet.reviewerDeclaration.reviewedAt = "2026-08-09T00:00:00+08:00";
  assert.throws(
    () => validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 }),
    /not marked reviewed/u
  );
  for (const example of packet.examples) example.reviewed = true;
  packet.examples[0].annotations.push({
    annotationId: "blind:bad-span",
    disposition: "ignore",
    spans: { responsibility: { start: 7, end: 9, excerpt: "医疗" } }
  });
  assert.throws(
    () => validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 }),
    /excerpt does not match/u
  );
});

test("blind packet generation rejects malformed identity and empty corpora", () => {
  assert.throws(
    () => buildFinancialExpenseClauseBlindPacket({ corpus: { examples: [] }, sourceSha256 }),
    /at least one example/u
  );
  assert.throws(
    () => buildFinancialExpenseClauseBlindPacket({ corpus, sourceSha256: "not-a-digest" }),
    /SHA-256/u
  );
});
