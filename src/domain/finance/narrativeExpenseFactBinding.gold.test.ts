import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Phase 0 fixture guard only.  It deliberately imports no production binder:
 * the new binder does not exist until Phase 1.  This test freezes the raw
 * narrative, annotation identity and expected source spans so Phase 1 cannot
 * silently replace the failure corpus with detector-shaped expectations.
 */

interface SourceSpan {
  text: string;
  occurrence?: number;
}

interface ExpectedBinding {
  id: string;
  material: boolean;
  expectedCandidateDisposition: string;
  responsibilityKey: string;
  responsibilityKind: string;
  proposedType: string;
  action: "start" | "adjust" | "review";
  completion: "completed" | "ongoing";
  cadence: "monthly" | "quarterly" | "annual";
  liability: "protagonist" | "shared" | "third_party" | "unknown";
  financialScope: "personal" | "shared_household" | "third_party";
  amountDisposition: "exact" | "ambiguous" | "exact_total_share_unknown";
  grossMonthlyAmountWan?: number;
  protagonistMonthlyAmountWan?: number;
  shareRate?: number;
  spans: Record<string, SourceSpan>;
  forbiddenAmountSpans?: SourceSpan[];
}

interface PlannedObservation {
  kind: string;
  responsibilityKey?: string;
  completion: "planned";
  spans: Record<string, SourceSpan>;
}

interface NegativeAssertion {
  reason: string;
  spans: Record<string, SourceSpan>;
  forbidPersonalOrSharedResponsibilityKey: string;
}

interface GoldExample {
  id: string;
  kind: "positive" | "mixed" | "negative" | "planned_only";
  caseSlug: string;
  tags: string[];
  narrative: string;
  expectedBindings: ExpectedBinding[];
  plannedObservations?: PlannedObservation[];
  negativeAssertions?: NegativeAssertion[];
}

interface LifecycleSample {
  id: string;
  action: "start" | "adjust" | "review" | "pause" | "resume" | "end";
  narrative: string;
  requiredAuthority: string;
  expectedResponsibilityKey: string;
  expectedNextPeriodMonthlyWan: number | "contextual_estimate";
}

interface ClauseBindingGoldCorpus {
  schemaVersion: number;
  corpusId: string;
  corpusKind: "frozen_clause_binding_gold";
  revision: number;
  frozenAt: string;
  status: "frozen_spec_seed_requires_independent_blind_adjudication";
  baseline: {
    commit: string;
    ledgerVersion: string;
    policyVersion: string;
  };
  annotationProtocol: {
    authoringMode: string;
    rawNarrativeFrozenBeforeImplementation: boolean;
    detectorOutputConsultedDuringAnnotation: boolean;
    proposalLedgerAuditConsultedDuringAnnotation: boolean;
    independentBlindAdjudicationRequiredBeforeRelease: boolean;
    spanCoordinateSystem: string;
  };
  requiredSpecCases: string[];
  examples: GoldExample[];
  lifecycleE2ESamples: LifecycleSample[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "financial-expense-clause-binding-gold-v1.json");
const fixtureBytes = await readFile(fixturePath);
const corpus = JSON.parse(fixtureBytes.toString("utf8")) as ClauseBindingGoldCorpus;

/**
 * Update only with a corpus revision and an intentional annotation review.
 * This protects the Phase 0 raw texts from accidental edits while no binder
 * exists yet to give us a behavioral regression signal.
 */
const FROZEN_SHA256 = "d8f8a3bde5b3fc7b7cae10e7bd58b96f2c58e0211878b1db21fb207cb87f64ea";

interface ResolvedSpan {
  start: number;
  end: number;
  text: string;
}

function resolveSpan(narrative: string, span: SourceSpan): ResolvedSpan {
  const occurrence = span.occurrence ?? 0;
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = narrative.indexOf(span.text, from);
    if (start < 0) {
      throw new Error(`span ${JSON.stringify(span.text)} occurrence=${occurrence} is absent from ${JSON.stringify(narrative)}`);
    }
    from = start + span.text.length;
  }
  return { start, end: start + span.text.length, text: span.text };
}

function assertSpanMapResolves(narrative: string, spans: Record<string, SourceSpan>, label: string): void {
  for (const [role, span] of Object.entries(spans)) {
    const resolved = resolveSpan(narrative, span);
    assert.equal(
      narrative.slice(resolved.start, resolved.end),
      span.text,
      `${label}.${role} must resolve to its frozen source fragment`
    );
  }
}

function allBindings(): ExpectedBinding[] {
  return corpus.examples.flatMap((example) => example.expectedBindings);
}

test("Phase 0 clause-binding Gold corpus is versioned and intentionally frozen", () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.corpusId, "financial-expense-clause-binding-gold-v1");
  assert.equal(corpus.corpusKind, "frozen_clause_binding_gold");
  assert.equal(corpus.revision, 4);
  assert.equal(corpus.status, "frozen_spec_seed_requires_independent_blind_adjudication");
  assert.equal(corpus.baseline.commit, "ce35e55a00cab60755753d1cd3ea2a1dbf84ae9c");
  assert.equal(corpus.baseline.ledgerVersion, "v4");
  assert.equal(corpus.baseline.policyVersion, "expense-estimation-policy-v2");
  assert.equal(corpus.annotationProtocol.rawNarrativeFrozenBeforeImplementation, false);
  assert.equal(corpus.annotationProtocol.authoringMode, "spec_seed_from_reviewed_failure_shapes");
  assert.equal(corpus.annotationProtocol.detectorOutputConsultedDuringAnnotation, true);
  assert.equal(corpus.annotationProtocol.proposalLedgerAuditConsultedDuringAnnotation, false);
  assert.equal(corpus.annotationProtocol.independentBlindAdjudicationRequiredBeforeRelease, true);
  assert.match(corpus.annotationProtocol.spanCoordinateSystem, /UTF-16/u);
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), FROZEN_SHA256);
});

test("Phase 0 Gold spans are resolvable and binding identities are independently addressable", () => {
  const seenExampleIds = new Set<string>();
  const seenBindingIds = new Set<string>();

  for (const example of corpus.examples) {
    assert.ok(example.narrative.length > 0, `${example.id} must retain raw narrative`);
    assert.equal(seenExampleIds.has(example.id), false, `duplicate example ID: ${example.id}`);
    seenExampleIds.add(example.id);

    for (const binding of example.expectedBindings) {
      assert.equal(seenBindingIds.has(binding.id), false, `duplicate binding ID: ${binding.id}`);
      seenBindingIds.add(binding.id);
      assert.match(binding.responsibilityKey, /^[a-z_]+:[a-z0-9_]+$/u, `${binding.id} must have a stable responsibility key`);
      assert.ok(binding.responsibilityKind.length > 0, `${binding.id} must name a responsibility kind`);
      assert.ok(binding.proposedType.length > 0, `${binding.id} must name a commitment type`);
      assertSpanMapResolves(example.narrative, binding.spans, binding.id);
      assert.ok(binding.spans.responsibility, `${binding.id} requires a responsibility span`);
      assert.ok(binding.spans.completion, `${binding.id} requires a completion span`);
      assert.ok(binding.spans.cadence, `${binding.id} requires a cadence span`);

      if (binding.liability === "unknown") {
        assert.equal(binding.spans.payer, undefined, `${binding.id} must not invent a payer span`);
        assert.equal(binding.expectedCandidateDisposition, "material_unknown_gate");
      } else {
        assert.ok(binding.spans.payer, `${binding.id} requires a payer span`);
      }

      if (binding.amountDisposition === "exact") {
        assert.ok(binding.spans.amount, `${binding.id} exact amount requires source span`);
        assert.ok(binding.grossMonthlyAmountWan !== undefined && binding.grossMonthlyAmountWan > 0, `${binding.id} exact amount requires normalized gross monthly amount`);
      }
      if (binding.amountDisposition === "ambiguous") {
        assert.ok(binding.spans.amount, `${binding.id} ambiguous amount still requires the ambiguous amount span`);
        assert.equal(binding.grossMonthlyAmountWan, undefined, `${binding.id} must not copy an ambiguous total to an individual responsibility`);
      }
      if (binding.amountDisposition === "exact_total_share_unknown") {
        assert.ok(binding.spans.amount, `${binding.id} exact shared total requires source span`);
        assert.ok(binding.grossMonthlyAmountWan !== undefined && binding.grossMonthlyAmountWan > 0);
        assert.equal(binding.protagonistMonthlyAmountWan, undefined, `${binding.id} must not invent a protagonist share`);
        assert.equal(binding.shareRate, undefined, `${binding.id} must not invent a share rate`);
        assert.equal(binding.expectedCandidateDisposition, "material_unknown_gate");
      }
      if (binding.liability === "shared" && binding.amountDisposition === "exact") {
        assert.ok(binding.shareRate !== undefined && binding.shareRate > 0 && binding.shareRate <= 1, `${binding.id} exact shared amount requires a bounded share rate`);
        assert.ok(binding.protagonistMonthlyAmountWan !== undefined && binding.protagonistMonthlyAmountWan > 0, `${binding.id} exact shared amount requires a protagonist amount`);
      }
      if (binding.liability === "third_party") {
        assert.equal(binding.expectedCandidateDisposition, "non_accruing_third_party", `${binding.id} cannot create a personal accrual`);
      }
      for (const [index, forbidden] of (binding.forbiddenAmountSpans || []).entries()) {
        const resolved = resolveSpan(example.narrative, forbidden);
        assert.equal(example.narrative.slice(resolved.start, resolved.end), forbidden.text, `${binding.id}.forbiddenAmountSpans[${index}] must resolve`);
      }
    }

    for (const [index, planned] of (example.plannedObservations || []).entries()) {
      assert.equal(planned.completion, "planned", `${example.id}.planned[${index}] must remain planned`);
      assertSpanMapResolves(example.narrative, planned.spans, `${example.id}.planned[${index}]`);
    }
    for (const [index, negative] of (example.negativeAssertions || []).entries()) {
      assert.ok(negative.forbidPersonalOrSharedResponsibilityKey.length > 0, `${example.id}.negative[${index}] requires a boundary assertion`);
      assertSpanMapResolves(example.narrative, negative.spans, `${example.id}.negative[${index}]`);
    }
  }
});

test("Phase 0 Gold corpus satisfies the Spec 12.1 and 12.6 minimum coverage", () => {
  const exampleIds = new Set(corpus.examples.map((example) => example.id));
  for (const requiredId of corpus.requiredSpecCases) {
    assert.equal(exampleIds.has(requiredId), true, `missing required clause case ${requiredId}`);
  }

  const bindings = allBindings();
  const materialBindings = bindings.filter((binding) => binding.material);
  assert.ok(materialBindings.length >= 20, `material positives ${materialBindings.length}/20`);

  const mixedPayerScope = corpus.examples.filter((example) => example.tags.includes("mixed_payer_scope"));
  assert.ok(mixedPayerScope.length >= 6, `mixed payer/scope examples ${mixedPayerScope.length}/6`);

  const completedAndPlanned = corpus.examples.filter((example) => example.tags.includes("completed_and_planned"));
  assert.ok(completedAndPlanned.length >= 4, `completed + planned examples ${completedAndPlanned.length}/4`);
  for (const example of completedAndPlanned) {
    assert.ok(example.expectedBindings.length > 0, `${example.id} needs a completed/ongoing binding`);
    assert.ok((example.plannedObservations || []).length > 0, `${example.id} needs a planned observation`);
  }

  const amountBindingExamples = corpus.examples.filter((example) =>
    example.tags.includes("amount_binding") || example.tags.includes("multi_amount_ambiguity")
  );
  assert.ok(amountBindingExamples.length >= 6, `amount/multi-amount examples ${amountBindingExamples.length}/6`);

  const boundaryNegatives = corpus.examples.filter((example) =>
    example.kind === "negative" && example.tags.includes("business_third_party_rental_negative")
  );
  assert.ok(boundaryNegatives.length >= 8, `business/third-party/rental-income negatives ${boundaryNegatives.length}/8`);

  const materialKinds = new Set(materialBindings.map((binding) => binding.responsibilityKind));
  for (const requiredKind of ["primary_residence", "child_support", "elder_care", "recurring_healthcare", "personal_insurance"]) {
    assert.equal(materialKinds.has(requiredKind), true, `missing material responsibility layer: ${requiredKind}`);
  }
});

test("Phase 0 keeps lifecycle E2E coverage distinct from narrow prose binding", () => {
  const requiredActions = ["start", "adjust", "review", "pause", "resume", "end"] as const;
  const observedActions = new Set(corpus.lifecycleE2ESamples.map((sample) => sample.action));
  assert.equal(corpus.lifecycleE2ESamples.length, requiredActions.length);
  for (const action of requiredActions) {
    assert.equal(observedActions.has(action), true, `missing E2E lifecycle fixture: ${action}`);
  }
  for (const sample of corpus.lifecycleE2ESamples) {
    assert.ok(sample.narrative.length > 0, `${sample.id} needs raw narrative`);
    assert.match(sample.requiredAuthority, /^accepted_/u, `${sample.id} must state its required authority`);
    assert.match(sample.expectedResponsibilityKey, /^[a-z_]+:[a-z0-9_]+$/u);
  }
});
