import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { WorldStateSnapshot } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { deriveExpenseResponsibilityCandidates, type ExplicitExpenseResponsibilityFact } from "./expenseResponsibility";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateFinancialLedgerV3ToV4 } from "./migrateFinancialLedgerV3ToV4";
import { extractOpeningExpenseFacts } from "./openingFinancialFacts";
import { reconcileExpenseCommitments } from "./reconcileExpenseCommitments";
import { reduceFinancialLedger } from "./reduceFinancialLedger";
import type {
  AcceptedFinancialEvent,
  ExpenseCommitmentType,
  ExpenseCommitmentV4,
  ExpenseResponsibilityKind,
  FinancialEventProposal,
  FinancialLedgerV3,
  FinancialLedgerV4
} from "./types";
import { validateFinancialProposals } from "./validateFinancialProposals";
import { assessExpenseResponsibilityCorpusCoverage } from "../../../scripts/lib/financial-expense-audit.mjs";

/**
 * This is deliberately not an audit fixture.  Each frozen annotation is fed
 * through the production candidate/reconciler/validator/reducer sequence and
 * the resulting Accepted event is compared with the independent annotation.
 *
 * The corpus has two projections:
 *
 * - `authoritative_fact`: controlled Accepted-fact inputs, the closed release
 *   gate.  It proves the actual ledger pipeline, rather than a hand-written
 *   post-commit ledger, reaches the annotated action.
 * - `narrative_only`: the exact evidence excerpts with no structured fact.
 *   It is emitted as a capability diagnostic.  This keeps missing object IDs,
 *   amounts, or action verbs visible instead of pretending that the closed
 *   corpus measures raw prose extraction alone.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const goldV1 = JSON.parse(await readFile(
  path.join(here, "../../../scripts/fixtures/financial-expense-responsibility-gold-v1.json"),
  "utf8"
)) as GoldCorpus;
const goldV1Sources = JSON.parse(await readFile(
  path.join(here, "../../../scripts/fixtures/financial-expense-responsibility-gold-v1-sources.json"),
  "utf8"
)) as GoldSourceCorpus;
const goldV2 = JSON.parse(await readFile(
  path.join(here, "../../../scripts/fixtures/financial-expense-responsibility-gold-v2.json"),
  "utf8"
)) as GoldCorpus;
const goldV2Sources = JSON.parse(await readFile(
  path.join(here, "../../../scripts/fixtures/financial-expense-responsibility-gold-v2-sources.json"),
  "utf8"
)) as GoldSourceCorpus;
const goldV3 = JSON.parse(await readFile(
  path.join(here, "../../../scripts/fixtures/financial-expense-responsibility-gold-v3.json"),
  "utf8"
)) as GoldCorpus;
const goldV3Sources = JSON.parse(await readFile(
  path.join(here, "../../../scripts/fixtures/financial-expense-responsibility-gold-v3-sources.json"),
  "utf8"
)) as GoldSourceCorpus;
const gold: GoldCorpus = {
  corpusKind: "frozen_gold",
  annotations: [...goldV1.annotations, ...goldV2.annotations, ...goldV3.annotations]
};
const goldSources: GoldSourceCorpus = {
  corpusKind: "frozen_gold_source",
  facts: [...goldV1Sources.facts, ...goldV2Sources.facts, ...goldV3Sources.facts]
};

type GoldAction = "start" | "adjust" | "end" | "review" | "ignore";
interface GoldAnnotation {
  caseSlug: string;
  nodeIndex: number;
  evidenceExcerpt: string;
  expectedAction: GoldAction;
  expectedType?: ExpenseCommitmentType;
  expectedScope: "personal" | "shared_household" | "business_operating" | "third_party";
  expectedResponsibilityKey: string;
  expectedMonthlyAmountWan?: number;
  expectedShareRate?: number;
  material: boolean;
  reviewer: string;
}
interface GoldCorpus {
  corpusKind: "frozen_gold" | "frozen_gold_extension";
  annotations: GoldAnnotation[];
}
interface GoldSourceFact {
  caseSlug: string;
  nodeIndex: number;
  fact: Omit<ExplicitExpenseResponsibilityFact, "amountSourceId"> & { amountSourceId?: string };
}
interface GoldSourceCorpus {
  corpusKind: "frozen_gold_source" | "frozen_gold_source_extension";
  facts: GoldSourceFact[];
}
interface ObservedExpenseAction {
  action: Exclude<GoldAction, "ignore">;
  responsibilityKey: string;
  type: ExpenseCommitmentType;
  financialScope: "personal" | "shared_household";
  monthlyAmountWan?: number;
  householdShareRate?: number;
}
interface CorpusEvaluation {
  mode: "authoritative_fact" | "narrative_only";
  material: number;
  truePositives: number;
  missed: GoldAnnotation[];
  falsePositives: Array<{ annotation: GoldAnnotation; observed: ObservedExpenseAction }>;
  precisionPct: number | null;
  recallPct: number | null;
  observations: Array<{ annotation: GoldAnnotation; observed: ObservedExpenseAction[]; rejectedIssueCodes: string[] }>;
}

type RawCandidateExpectation = Pick<GoldAnnotation,
  "expectedAction" | "expectedType" | "expectedScope" | "expectedResponsibilityKey" | "expectedMonthlyAmountWan"
>;

interface RawDetectorRow {
  annotation: GoldAnnotation;
  ageInMonths: number;
  narrativeText: string;
  currentWorldState?: WorldStateSnapshot;
  candidateWorldState?: WorldStateSnapshot;
  existingExpenseCommitments?: ExpenseCommitmentV4[];
  /** Positive rows require the exact responsibility/action/scope candidate. */
  required?: RawCandidateExpectation;
  /** Negative rows only forbid this accidental recurring-expense classification. */
  forbidden?: Pick<GoldAnnotation, "expectedResponsibilityKey" | "expectedScope" | "expectedType"> & {
    forbidPersonalOrShared?: boolean;
    /** A false-positive boundary is about the financial class, not an alias. */
    forbidAnyResponsibilityKey?: boolean;
  };
}

function personalOrSharedScope(scope: string | undefined): "personal" | "shared_household" {
  // Classified V4 commitments cannot accrue a business/third-party scope;
  // those candidate scopes are excluded before proposal acceptance.
  return scope === "shared_household" ? "shared_household" : "personal";
}

function responsibilityKindFor(annotation: GoldAnnotation): ExpenseResponsibilityKind {
  if (annotation.expectedResponsibilityKey.startsWith("primary_residence:")) return "primary_residence";
  if (annotation.expectedResponsibilityKey.startsWith("child_support:")) return "child_support";
  if (annotation.expectedResponsibilityKey.startsWith("elder_care:")) return "elder_care";
  if (annotation.expectedResponsibilityKey.startsWith("recurring_healthcare:")) return "recurring_healthcare";
  if (annotation.expectedResponsibilityKey.startsWith("personal_insurance:")) return "personal_insurance";
  if (annotation.expectedResponsibilityKey.startsWith("continuing_education:")) return "continuing_education";
  throw new Error(`unsupported gold responsibility key: ${annotation.expectedResponsibilityKey}`);
}

function seedAmountFor(annotation: GoldAnnotation): number {
  // The frozen adjust rows describe the new amount.  Their precondition must
  // be a different accepted amount or the real reconciler correctly emits no
  // mutation and the harness would be testing a no-op instead of an adjust.
  if (annotation.expectedAction === "adjust") {
    if (annotation.expectedResponsibilityKey === "primary_residence:main") return 0.26;
    if (annotation.expectedResponsibilityKey === "recurring_healthcare:protagonist") return 0.12;
    if (annotation.expectedResponsibilityKey === "recurring_healthcare:opening_parent") return 0.12;
  }
  if (annotation.expectedMonthlyAmountWan !== undefined) return annotation.expectedMonthlyAmountWan;
  switch (responsibilityKindFor(annotation)) {
    case "primary_residence": return 0.26;
    case "child_support": return 0.3;
    case "elder_care": return 0.4;
    case "recurring_healthcare": return 0.18;
    case "personal_insurance": return 0.08;
    case "continuing_education": return 0.2;
    default: return 0.35;
  }
}

function needsExistingCommitment(annotation: GoldAnnotation): boolean {
  return ["adjust", "end", "review"].includes(annotation.expectedAction);
}

/**
 * This is intentionally only used to create a prior account for an
 * adjust/end/review case. The target action always comes from the independent
 * frozen source fixture below, never from its expected annotation.
 */
function syntheticSeedFactFor(annotation: GoldAnnotation, input: {
  action?: Exclude<GoldAction, "ignore">;
  amountWan?: number;
  evidenceExcerpt?: string;
  sourceSuffix: string;
  scope?: "personal" | "shared_household" | "business_operating" | "third_party";
  liability?: "protagonist" | "shared" | "third_party";
}): ExplicitExpenseResponsibilityFact {
  const action = input.action || (annotation.expectedAction === "ignore" ? "start" : annotation.expectedAction);
  const scope = input.scope || annotation.expectedScope;
  const amount = input.amountWan;
  const isShared = scope === "shared_household";
  // This only builds the synthetic *prior* account required to exercise a
  // review/adjust transition. It must satisfy the V4 shared-account schema,
  // but it is never an amount attributed to the target annotation. An
  // amount-unknown shared target remains amount-unknown in its independent
  // source fixture and is checked as such below.
  const shareRate = isShared ? annotation.expectedShareRate ?? 0.5 : undefined;
  return {
    responsibilityKey: annotation.expectedResponsibilityKey,
    responsibilityKind: responsibilityKindFor(annotation),
    proposedType: annotation.expectedType || "other",
    action,
    completion: "completed",
    cadence: "monthly",
    liability: input.liability || (isShared ? "shared" : "protagonist"),
    financialScope: scope,
    // The V4 record stores the protagonist's share as its recurring cashflow
    // and preserves the gross shared total independently.
    explicitMonthlyTotalWan: isShared && amount !== undefined && shareRate !== undefined
      ? Number((amount / shareRate).toFixed(4))
      : amount,
    protagonistShareWan: amount,
    shareRate: isShared ? shareRate : undefined,
    amountSourceId: amount === undefined ? undefined : `gold:${annotation.caseSlug}:${annotation.nodeIndex}:${input.sourceSuffix}`,
    source: "accepted_outcome",
    evidenceExcerpt: input.evidenceExcerpt || annotation.evidenceExcerpt
  };
}

function annotationCoordinate(annotation: Pick<GoldAnnotation, "caseSlug" | "nodeIndex">): string {
  return `${annotation.caseSlug}:${annotation.nodeIndex}`;
}

/**
 * A single opening/node may contain more than one independently accepted
 * responsibility (for example, rent and parent medical care). A coordinate
 * alone would silently overwrite one source in a Map and turn the corpus into
 * a one-fact-at-a-time test. Keep the expected action/key in the source join.
 */
function annotationSourceCoordinate(annotation: Pick<GoldAnnotation,
  "caseSlug" | "nodeIndex" | "expectedResponsibilityKey" | "expectedAction"
>): string {
  return `${annotationCoordinate(annotation)}:${annotation.expectedResponsibilityKey}:${annotation.expectedAction}`;
}

function sourceCoordinate(source: GoldSourceFact): string {
  return `${annotationCoordinate(source)}:${source.fact.responsibilityKey}:${source.fact.action || "start"}`;
}

const goldSourceByAnnotation = new Map(goldSources.facts.map((source) => [
  sourceCoordinate(source),
  source
]));

function acceptedFactForAnnotation(annotation: GoldAnnotation, sourceSuffix: string): ExplicitExpenseResponsibilityFact | undefined {
  // One fresh node can legitimately carry both a material elder-care start
  // and a negative "must not become insurance" annotation. A source for the
  // positive must never be injected into its boundary negative merely because
  // they share the same route/node coordinate.
  if (annotation.expectedAction === "ignore") return undefined;
  const source = goldSourceByAnnotation.get(annotationSourceCoordinate(annotation));
  if (!source) return undefined;
  return {
    ...source.fact,
    amountSourceId: source.fact.amountSourceId || `gold_source:${annotationCoordinate(annotation)}:${sourceSuffix}`
  };
}

function freshLedger(id: string, ageInMonths: number): FinancialLedgerV4 {
  return migrateFinancialLedgerV3ToV4(initializeFinancialLedger({
    id,
    asOfAgeInMonths: ageInMonths,
    openingPosition: {
      cashAccounts: [{
        id: "primary_cash",
        type: "bank_deposit",
        balanceWan: 1000,
        status: "active",
        factStatus: "known",
        evidence: [{ source: "accepted_history", reasonCode: "TEST_RESERVE", confidence: 1 }]
      }]
    }
  }) as FinancialLedgerV3);
}

function reviewProposals(input: {
  events: AcceptedFinancialEvent<"expense_commitment_adjusted">[];
  sourceOutcomeId: string;
}): FinancialEventProposal[] {
  return input.events.map((event) => ({
    id: event.proposalId,
    kind: event.kind,
    effectiveAtAgeInMonths: event.effectiveAtAgeInMonths,
    payload: event.payload,
    evidence: event.evidence.map((item) => item.excerpt).filter(Boolean).join("；") || "V4 支出责任到期复核",
    sourceOutcomeId: input.sourceOutcomeId,
    confidence: 1,
    financialScope: "personal",
    systemGenerated: "expense_lifecycle_review"
  } as FinancialEventProposal));
}

function observedActions(input: {
  before: FinancialLedgerV4;
  events: AcceptedFinancialEvent[];
}): ObservedExpenseAction[] {
  const existingById = new Map(input.before.expenseCommitments.map((item) => [item.id, item]));
  const result: ObservedExpenseAction[] = [];
  for (const event of input.events) {
    if (event.kind === "expense_commitment_started") {
      const commitment = event.payload;
      result.push({
        action: "start",
        responsibilityKey: commitment.responsibilityKey!,
        type: commitment.type,
        financialScope: personalOrSharedScope(commitment.financialScope),
        monthlyAmountWan: commitment.monthlyAmountWan,
        householdShareRate: commitment.householdShareRate
      });
      continue;
    }
    if (event.kind === "expense_commitment_adjusted") {
      const commitment = event.payload.nextCommitment;
      const action = event.acceptedByReasonCodes.includes("SYSTEM_POLICY_REVIEW") ? "review" : "adjust";
      result.push({
        action,
        responsibilityKey: commitment.responsibilityKey!,
        type: commitment.type,
        financialScope: personalOrSharedScope(commitment.financialScope),
        monthlyAmountWan: commitment.monthlyAmountWan,
        householdShareRate: commitment.householdShareRate
      });
      continue;
    }
    if (event.kind === "expense_commitment_ended") {
      const prior = existingById.get(event.payload.expenseCommitmentId);
      if (!prior?.responsibilityKey) continue;
      result.push({
        action: "end",
        responsibilityKey: prior.responsibilityKey,
        type: prior.type,
        financialScope: personalOrSharedScope(prior.financialScope)
      });
    }
  }
  return result;
}

/**
 * A completed responsibility can be real enough to require a review while
 * still lacking proof that the protagonist owes a recurring amount. The V4
 * reconciler deliberately emits a review issue rather than an Accepted ledger
 * event in that case. Treat that explicit non-accruing disposition as the
 * observed `review` action for corpus scoring: it proves detection without
 * pretending that an unsupported personal account was created.
 */
function observedNonAccruingReviews(input: {
  candidates: ReturnType<typeof deriveExpenseResponsibilityCandidates>["candidates"];
  candidateDecisions: ReturnType<typeof reconcileExpenseCommitments>["candidateDecisions"];
  expectedAnnotation: GoldAnnotation;
}): ObservedExpenseAction[] {
  if (input.expectedAnnotation.expectedAction !== "review") return [];
  const decisionByCandidateId = new Map(input.candidateDecisions.map((decision) => [decision.candidateId, decision]));
  return input.candidates.flatMap((candidate) => {
    const decision = decisionByCandidateId.get(candidate.id);
    if (candidate.action !== "review"
      || candidate.liability !== "unknown"
      || candidate.responsibilityKey !== input.expectedAnnotation.expectedResponsibilityKey
      || candidate.proposedType !== input.expectedAnnotation.expectedType
      || candidate.financialScope !== input.expectedAnnotation.expectedScope
      || decision?.reasonCodes.includes("LIABILITY_UNKNOWN_REVIEW_REQUIRED") !== true) return [];
    return [{
      action: "review" as const,
      responsibilityKey: candidate.responsibilityKey,
      type: candidate.proposedType,
      financialScope: personalOrSharedScope(candidate.financialScope)
    }];
  });
}

function runProductionStage(input: {
  ledger: FinancialLedgerV4;
  annotation: GoldAnnotation;
  ageInMonths: number;
  mode: CorpusEvaluation["mode"];
  sourceSuffix: string;
  explicitFactsOverride?: ExplicitExpenseResponsibilityFact[];
}): { ledger: FinancialLedgerV4; observed: ObservedExpenseAction[]; rejectedIssueCodes: string[] } {
  const sourceOutcomeId = `gold_outcome_${input.mode}_${input.annotation.caseSlug}_${input.annotation.nodeIndex}_${input.sourceSuffix}`;
  const sourceFact = input.explicitFactsOverride?.[0] || acceptedFactForAnnotation(input.annotation, input.sourceSuffix);
  const explicitFacts = input.mode === "authoritative_fact" && sourceFact
    ? input.explicitFactsOverride || [sourceFact]
    : undefined;
  if (input.mode === "authoritative_fact" && input.annotation.expectedAction !== "ignore") {
    assert.ok(explicitFacts?.length, `missing independently reviewed Accepted source for material gold row ${annotationCoordinate(input.annotation)}`);
  }
  // Validation must ground the candidate in the separately reviewed Accepted
  // source text, not in the annotation that states what the test expects.
  const authorityNarrativeText = explicitFacts?.map((fact) => fact.evidenceExcerpt).join("；")
    || input.annotation.evidenceExcerpt;
  const derived = deriveExpenseResponsibilityCandidates({
    ageInMonths: input.ageInMonths,
    // The closed corpus has an Accepted factual input.  Feeding its prose
    // through the supplemental extractor as well would manufacture a second,
    // lower-confidence candidate and would no longer test one source of truth.
    // Negative rows intentionally have no Accepted expense fact. Their closed
    // assertion is therefore exercised against the frozen prose itself: no
    // personal/shared recurring account may be manufactured from a family,
    // debt, income, business, or third-party statement.
    narrativeText: input.mode === "narrative_only" || !explicitFacts ? input.annotation.evidenceExcerpt : undefined,
    explicitFacts
  });
  const reconciliation = reconcileExpenseCommitments({
    ledger: input.ledger,
    candidates: derived.candidates,
    ageInMonths: input.ageInMonths,
    sourceOutcomeId,
    mode: "enforced"
  });
  if (input.mode === "authoritative_fact") {
    assert.equal(reconciliation.wouldBlock, false, `gold ${input.annotation.caseSlug}/${input.annotation.nodeIndex} generated an unexpected lifecycle blocker: ${reconciliation.issues.map((item) => item.code).join(", ")}`);
  }
  const proposals = [...reconciliation.proposals, ...reviewProposals({ events: reconciliation.reviewEvents, sourceOutcomeId })];
  const career = initializeCareerState({
    id: "gold_not_working",
    employmentStatus: "not_working",
    effectiveFromAgeInMonths: input.ledger.asOfAgeInMonths
  });
  const validation = validateFinancialProposals({
    proposals,
    currentLedger: input.ledger,
    currentCareerState: career,
    acceptedOutcomeId: sourceOutcomeId,
    narrativeText: authorityNarrativeText,
    periodStartAgeInMonths: input.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: input.ageInMonths + 1,
    simulationTransactionId: `gold_transaction_${input.mode}_${input.annotation.caseSlug}_${input.annotation.nodeIndex}_${input.sourceSuffix}`
  });
  if (input.mode === "authoritative_fact") {
    assert.deepEqual(validation.issues, [], `gold ${input.annotation.caseSlug}/${input.annotation.nodeIndex} did not complete normal validation: ${JSON.stringify(validation.issues)}`);
  }
  const reduced = reduceFinancialLedger({
    ledger: input.ledger,
    transactionId: `gold_transaction_${input.mode}_${input.annotation.caseSlug}_${input.annotation.nodeIndex}_${input.sourceSuffix}`,
    expectedLedgerRevision: input.ledger.revision,
    periodStartAgeInMonths: input.ledger.asOfAgeInMonths,
    periodEndAgeInMonths: input.ageInMonths + 1,
    events: validation.acceptedEvents
  });
  assert.equal(reduced.alreadyCommitted, false);
  return {
    ledger: reduced.ledger as FinancialLedgerV4,
    observed: [
      ...observedActions({ before: input.ledger, events: validation.acceptedEvents }),
      ...observedNonAccruingReviews({
        candidates: derived.candidates,
        candidateDecisions: reconciliation.candidateDecisions,
        expectedAnnotation: input.annotation
      })
    ],
    rejectedIssueCodes: validation.issues.map((item) => item.code)
  };
}

function prepareExistingCommitment(input: {
  annotation: GoldAnnotation;
  ageInMonths: number;
  mode: CorpusEvaluation["mode"];
}): FinancialLedgerV4 {
  const ledger = freshLedger(`gold_seed_${input.mode}_${input.annotation.caseSlug}_${input.annotation.nodeIndex}`, input.ageInMonths - 2);
  const amountWan = seedAmountFor(input.annotation);
  const seedAnnotation: GoldAnnotation = {
    ...input.annotation,
    expectedAction: "start",
    expectedMonthlyAmountWan: amountWan,
    evidenceExcerpt: `你已开始每月承担 ${input.annotation.expectedResponsibilityKey} 的持续支出 ${Math.round(amountWan * 10_000)} 元。`
  };
  const seed = runProductionStage({
    ledger,
    annotation: seedAnnotation,
    ageInMonths: input.ageInMonths - 1,
    // Precondition accounts are created from an Accepted source fact in both
    // projections.  This isolates whether the annotated current action is
    // expressible, rather than making a missing prior account a false result.
    mode: "authoritative_fact",
    sourceSuffix: "seed",
    explicitFactsOverride: [syntheticSeedFactFor(seedAnnotation, {
      sourceSuffix: "seed",
      amountWan
    })]
  });
  return seed.ledger;
}

function matches(annotation: GoldAnnotation, observed: ObservedExpenseAction): boolean {
  if (annotation.expectedAction === "ignore") return false;
  if (observed.action !== annotation.expectedAction
    || observed.responsibilityKey !== annotation.expectedResponsibilityKey
    || observed.type !== annotation.expectedType
    || observed.financialScope !== annotation.expectedScope) return false;
  if (annotation.expectedMonthlyAmountWan !== undefined
    && Math.abs(Number(observed.monthlyAmountWan) - annotation.expectedMonthlyAmountWan) > 0.005) return false;
  if (annotation.expectedShareRate !== undefined
    && Math.abs(Number(observed.householdShareRate) - annotation.expectedShareRate) > 0.005) return false;
  return true;
}

function matchesRawCandidate(input: {
  expected: RawCandidateExpectation;
  candidate: ReturnType<typeof deriveExpenseResponsibilityCandidates>["candidates"][number];
}): boolean {
  const { expected, candidate } = input;
  if (candidate.action !== expected.expectedAction
    || candidate.responsibilityKey !== expected.expectedResponsibilityKey
    || candidate.proposedType !== expected.expectedType
    || candidate.financialScope !== expected.expectedScope) return false;
  if (expected.expectedMonthlyAmountWan !== undefined
    && Math.abs(Number(candidate.protagonistShareWan) - expected.expectedMonthlyAmountWan) > 0.005) return false;
  return true;
}

function evaluateGoldCorpus(mode: CorpusEvaluation["mode"]): CorpusEvaluation {
  const observations: CorpusEvaluation["observations"] = [];
  const missed: GoldAnnotation[] = [];
  const falsePositives: CorpusEvaluation["falsePositives"] = [];
  let truePositives = 0;
  for (const annotation of gold.annotations) {
    const ageInMonths = 600 + annotation.nodeIndex * 10;
    const ledger = needsExistingCommitment(annotation)
      ? prepareExistingCommitment({ annotation, ageInMonths, mode })
      : freshLedger(`gold_${mode}_${annotation.caseSlug}_${annotation.nodeIndex}`, ageInMonths);
    const stage = runProductionStage({
      ledger,
      annotation,
      ageInMonths,
      mode,
      sourceSuffix: "target"
    });
    observations.push({ annotation, observed: stage.observed, rejectedIssueCodes: stage.rejectedIssueCodes });
    if (annotation.expectedAction === "ignore") {
      for (const observed of stage.observed) falsePositives.push({ annotation, observed });
      continue;
    }
    const matching = stage.observed.filter((observed) => matches(annotation, observed));
    if (matching.length === 1) truePositives += 1;
    else missed.push(annotation);
    for (const observed of stage.observed) {
      if (!matches(annotation, observed)) falsePositives.push({ annotation, observed });
    }
  }
  const material = gold.annotations.filter((annotation) => annotation.material && annotation.expectedAction !== "ignore").length;
  const automaticPositiveCount = truePositives + falsePositives.length;
  return {
    mode,
    material,
    truePositives,
    missed,
    falsePositives,
    recallPct: material > 0 ? Number(((truePositives / material) * 100).toFixed(2)) : null,
    precisionPct: automaticPositiveCount > 0 ? Number(((truePositives / automaticPositiveCount) * 100).toFixed(2)) : null,
    observations
  };
}

test("frozen expense gold corpus runs the production authority path at 100% precision and recall", () => {
  assert.equal(goldV1.corpusKind, "frozen_gold");
  assert.equal(goldV2.corpusKind, "frozen_gold");
  assert.equal(goldV3.corpusKind, "frozen_gold_extension");
  assert.equal(goldSources.corpusKind, "frozen_gold_source");
  // v1 is the original minimum corpus. v2 freezes the seven missed material
  // responsibilities plus the fresh boundary failures from the release run;
  // v3 freezes the independent annotations from the current v8 release run.
  assert.equal(goldV1.annotations.filter((item) => item.material && item.expectedAction !== "ignore").length, 12);
  assert.equal(goldV1.annotations.filter((item) => item.expectedAction === "ignore").length, 4);
  assert.equal(goldV2.annotations.filter((item) => item.material && item.expectedAction !== "ignore").length, 7);
  assert.equal(goldV2.annotations.filter((item) => item.expectedAction === "ignore").length, 5);
  assert.equal(goldV3.annotations.filter((item) => item.material && item.expectedAction !== "ignore").length, 7);
  assert.equal(goldV3.annotations.filter((item) => item.expectedAction === "ignore").length, 3);
  assert.equal(gold.annotations.filter((item) => item.material && item.expectedAction !== "ignore").length, 26);
  assert.equal(gold.annotations.filter((item) => item.expectedAction === "ignore").length, 12);
  assert.equal(goldSources.facts.length, 30);
  const coverage = assessExpenseResponsibilityCorpusCoverage({
    annotations: gold.annotations,
    corpusKind: gold.corpusKind
  });
  assert.equal(coverage.status, "covered", JSON.stringify(coverage));
  assert.equal(coverage.counts.nonHumanReviewer, 0);
  assert.equal(coverage.counts.housing >= 2, true);
  assert.equal(coverage.counts.dependentSupport >= 2, true);
  assert.equal(coverage.counts.healthcare >= 2, true);
  assert.equal(coverage.counts.insurance >= 2, true);
  assert.equal(coverage.counts.adjust >= 1, true);
  assert.equal(coverage.counts.end >= 1, true);
  assert.equal(coverage.counts.review >= 1, true);
  assert.equal(coverage.counts.businessOrThirdPartyNegative >= 4, true);
  assert.deepEqual(
    gold.annotations
      .filter((annotation) => annotation.material && annotation.expectedAction !== "ignore")
      .map(annotationSourceCoordinate)
      .sort(),
    gold.annotations
      .filter((annotation) => annotation.material && annotation.expectedAction !== "ignore")
      .map((annotation) => {
        assert.ok(goldSourceByAnnotation.has(annotationSourceCoordinate(annotation)), `missing Accepted source for material row ${annotationSourceCoordinate(annotation)}`);
        return annotationSourceCoordinate(annotation);
      })
      .sort(),
    "every material frozen row must have an independently reviewed Accepted source"
  );

  const evaluation = evaluateGoldCorpus("authoritative_fact");
  assert.equal(evaluation.material, 26);
  assert.equal(evaluation.truePositives, 26, JSON.stringify(evaluation.missed));
  assert.equal(evaluation.missed.length, 0);
  assert.equal(evaluation.falsePositives.length, 0, JSON.stringify(evaluation.falsePositives));
  assert.equal(evaluation.recallPct, 100);
  assert.equal(evaluation.precisionPct, 100);
});

test("frozen corpus also publishes the narrative-only capability gap instead of treating accepted facts as raw-prose recall", (t) => {
  const evaluation = evaluateGoldCorpus("narrative_only");
  const limited = evaluation.observations
    .filter(({ annotation, observed }) => annotation.expectedAction !== "ignore" && !observed.some((item) => matches(annotation, item)))
    .map(({ annotation, observed, rejectedIssueCodes }) => ({
      coordinate: `${annotation.caseSlug}:${annotation.nodeIndex}`,
      expected: `${annotation.expectedAction}:${annotation.expectedResponsibilityKey}`,
      observed: observed.map((item) => `${item.action}:${item.responsibilityKey}`),
      rejectedIssueCodes
    }));
  // This is intentionally diagnostic, not a second frozen release threshold:
  // some fixture excerpts omit a person identifier, exact amount, or change
  // verb even though the accepted source fact used by the closed gate has it.
  t.diagnostic(JSON.stringify({
    corpus: "financial-expense-responsibility-gold-v1+v2+v3",
    mode: evaluation.mode,
    precisionPct: evaluation.precisionPct,
    recallPct: evaluation.recallPct,
    missed: limited,
    falsePositives: evaluation.falsePositives.map(({ annotation, observed }) => ({
      coordinate: `${annotation.caseSlug}:${annotation.nodeIndex}`,
      observed: `${observed.action}:${observed.responsibilityKey}`
    }))
  }));
  assert.equal(evaluation.material, 26);
  assert.ok(evaluation.observations.length === gold.annotations.length);
});

function structuredWorld(overrides: Partial<WorldStateSnapshot> = {}): WorldStateSnapshot {
  const employed = initializeCareerState({
    id: "structured_gold_employed",
    employmentStatus: "employed",
    effectiveFromAgeInMonths: 600
  });
  return {
    people: [{
      id: "mother",
      relation: "parent",
      lifeStatus: "active",
      healthStatus: "stable",
      source: "accepted_history",
      confidence: 1
    }],
    directionArcs: [],
    pressureArcs: [],
    relationships: [],
    familyRelationships: [],
    committedTransactionIds: [],
    careerStates: [employed],
    currentCareerStateId: employed.id,
    currentEmploymentStatus: "employed",
    careerRevision: 0,
    version: 2,
    ...overrides
  };
}

/**
 * The fresh corpus uses a stable `parents` key where the real narration is
 * plural, and `opening_parent` where the opening responsibility was already
 * identified.  The same accepted context is supplied on both sides unless a
 * row deliberately tests a WorldState delta, so an unrelated state change
 * cannot make a raw-prose assertion pass by accident.
 */
function acceptedParentWorld(input: {
  id: string;
  healthStatus?: "stable" | "fragile" | "care_dependent";
  activeFamilyLink?: boolean;
}): WorldStateSnapshot {
  const parent = {
    id: input.id,
    relation: "parent" as const,
    lifeStatus: "active" as const,
    healthStatus: input.healthStatus || "stable",
    source: "accepted_history" as const,
    confidence: 1,
    relationshipSummary: input.id === "parents" ? "已接受的父母照护对象" : input.id === "opening_parent"
      ? "Opening 中已接受的父母医疗对象"
      : "已接受的具体父母照护对象"
  };
  return structuredWorld({
    people: [parent],
    familyRelationships: input.activeFamilyLink ? [{
      id: `family_${input.id}`,
      participantPersonId: input.id,
      role: "mother",
      activation: "active",
      contact: "frequent",
      emotionalSupport: "mixed",
      practicalSupport: "unknown",
      autonomyRespect: "unknown",
      conflictIntensity: "low",
      topicStances: [],
      revision: 1
    }] : []
  });
}

function goldV2Annotation(caseSlug: string, nodeIndex: number, expectedAction?: GoldAction): GoldAnnotation {
  const annotation = goldV2.annotations.find((item) => (
    item.caseSlug === caseSlug
    && item.nodeIndex === nodeIndex
    && (expectedAction === undefined || item.expectedAction === expectedAction)
  ));
  assert.ok(annotation, `missing gold-v2 annotation ${caseSlug}:${nodeIndex}${expectedAction ? `:${expectedAction}` : ""}`);
  return annotation;
}

function goldV3Annotation(caseSlug: string, nodeIndex: number, expectedAction?: GoldAction): GoldAnnotation {
  const annotation = goldV3.annotations.find((item) => (
    item.caseSlug === caseSlug
    && item.nodeIndex === nodeIndex
    && (expectedAction === undefined || item.expectedAction === expectedAction)
  ));
  assert.ok(annotation, `missing gold-v3 annotation ${caseSlug}:${nodeIndex}${expectedAction ? `:${expectedAction}` : ""}`);
  return annotation;
}

function activeKnownParentHealthcare(responsibilityKey = "recurring_healthcare:opening_parent"): ExpenseCommitmentV4 {
  return {
    id: `gold_existing_${responsibilityKey.replace(/[^a-zA-Z0-9:_-]/gu, "_")}`,
    responsibilityKey,
    responsibilityKind: "recurring_healthcare",
    type: "healthcare",
    displayName: "已接受父母医疗责任",
    monthlyAmountWan: 0.12,
    amountBasis: "explicit_known",
    amountSourceIds: ["gold-existing-parent-healthcare"],
    financialScope: "personal",
    activeFromAgeInMonths: 300,
    status: "active",
    factStatus: "known",
    accrualReviewStatus: "normal",
    lastConfirmedAtAgeInMonths: 300,
    nextReviewAtAgeInMonths: 360,
    evidence: []
  };
}

test("gold-v2 raw structured and narrative detector corpus covers all fresh human annotations", () => {
  const openingParent = acceptedParentWorld({ id: "opening_parent" });
  const parentsStable = acceptedParentWorld({ id: "parents" });
  const parentsCareDependent = acceptedParentWorld({ id: "parents", healthStatus: "care_dependent", activeFamilyLink: true });
  const rows: RawDetectorRow[] = [
    {
      annotation: goldV2Annotation("real-career-first-release", 7),
      ageInMonths: 32 * 12 + 8,
      narrativeText: "你主动把每月医疗补贴从1200元提到1500元。",
      currentWorldState: openingParent,
      candidateWorldState: openingParent,
      existingExpenseCommitments: [activeKnownParentHealthcare()],
      required: goldV2Annotation("real-career-first-release", 7)
    },
    {
      annotation: goldV2Annotation("real-relationship-first-release", 9),
      ageInMonths: 35 * 12,
      narrativeText: "给家里请了一位每周来三次的钟点工，负责打扫和做晚饭，每月多出两千四的固定开销。",
      currentWorldState: parentsStable,
      candidateWorldState: parentsStable,
      required: goldV2Annotation("real-relationship-first-release", 9)
    },
    {
      annotation: goldV2Annotation("real-education-second-release", 5),
      ageInMonths: 31 * 12,
      narrativeText: "年初刚续租了公司附近的房子。",
      required: goldV2Annotation("real-education-second-release", 5)
    },
    {
      annotation: goldV2Annotation("real-custom-lifespan-release", 8),
      ageInMonths: 48 * 12,
      narrativeText: "父亲血压偏高需要长期监测，医生开了降压药。为了更好照顾父母，我调整了每月回家的频率。",
      currentWorldState: parentsStable,
      candidateWorldState: parentsStable,
      required: goldV2Annotation("real-custom-lifespan-release", 8)
    },
    {
      annotation: goldV2Annotation("real-custom-lifespan-release", 32, "start"),
      ageInMonths: 84 * 12,
      narrativeText: "父母已过百岁，虽身体尚可，但已需要更多照料。你每隔几周会去看望他们，或请人帮忙照看。",
      currentWorldState: parentsStable,
      candidateWorldState: parentsCareDependent,
      required: goldV2Annotation("real-custom-lifespan-release", 32, "start")
    },
    {
      annotation: goldV2Annotation("real-custom-lifespan-release", 35),
      ageInMonths: 91 * 12,
      narrativeText: "父母已过百岁，请人照护的费用逐年增加。",
      currentWorldState: parentsCareDependent,
      candidateWorldState: parentsCareDependent,
      required: goldV2Annotation("real-custom-lifespan-release", 35)
    },
    {
      annotation: goldV2Annotation("real-custom-lifespan-release", 42),
      ageInMonths: 99 * 12,
      narrativeText: "将房租和伙食费从共同账户支付，其他个人开支保持独立。",
      required: goldV2Annotation("real-custom-lifespan-release", 42)
    },
    {
      annotation: goldV2Annotation("real-education-second-release", 0, "ignore"),
      ageInMonths: 25 * 12,
      narrativeText: "家里明确表示承担国内学费没问题。",
      forbidden: {
        expectedResponsibilityKey: "continuing_education:opening",
        expectedScope: "third_party",
        expectedType: "education",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    },
    {
      annotation: goldV2Annotation("real-venture-second-release", 1),
      ageInMonths: 28 * 12,
      narrativeText: "房贷每月1.3万元的固定支出。",
      forbidden: {
        expectedResponsibilityKey: "primary_residence:main",
        expectedScope: "personal",
        expectedType: "housing",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    },
    {
      annotation: goldV2Annotation("real-venture-second-release", 21),
      ageInMonths: 50 * 12,
      narrativeText: "每月1.4万元顾问费勉强维持着生活。",
      forbidden: {
        expectedResponsibilityKey: "personal_insurance:main",
        expectedScope: "personal",
        expectedType: "insurance",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    },
    {
      annotation: goldV2Annotation("real-custom-lifespan-release", 16),
      ageInMonths: 60 * 12,
      narrativeText: "协助她把老家的房子租了出去，租金定期转入她的账户。",
      currentWorldState: acceptedParentWorld({ id: "parents" }),
      candidateWorldState: acceptedParentWorld({ id: "parents" }),
      forbidden: {
        expectedResponsibilityKey: "primary_residence:main",
        expectedScope: "third_party",
        expectedType: "housing",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    },
    {
      annotation: goldV2Annotation("real-custom-lifespan-release", 32, "ignore"),
      ageInMonths: 84 * 12,
      narrativeText: "父母已过百岁，虽身体尚可，但已需要更多照料。",
      currentWorldState: parentsStable,
      candidateWorldState: parentsCareDependent,
      forbidden: {
        expectedResponsibilityKey: "personal_insurance:main",
        expectedScope: "personal",
        expectedType: "insurance",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    }
  ];

  assert.equal(rows.length, goldV2.annotations.length, "every fresh human annotation must have a raw detector regression row");
  assert.equal(rows.filter((row) => row.required).length, 7);
  assert.equal(rows.filter((row) => row.forbidden).length, 5);

  for (const row of rows) {
    const candidates = deriveExpenseResponsibilityCandidates({
      ageInMonths: row.ageInMonths,
      narrativeText: row.narrativeText,
      currentWorldState: row.currentWorldState,
      candidateWorldState: row.candidateWorldState,
      existingExpenseCommitments: row.existingExpenseCommitments
    }).candidates;
    if (row.required) {
      assert.ok(candidates.some((candidate) => matchesRawCandidate({ expected: row.required!, candidate })), JSON.stringify({
        coordinate: annotationCoordinate(row.annotation),
        expected: row.required,
        observed: candidates.map((candidate) => ({
          responsibilityKey: candidate.responsibilityKey,
          action: candidate.action,
          type: candidate.proposedType,
          scope: candidate.financialScope,
          protagonistShareWan: candidate.protagonistShareWan
        }))
      }));
    }
    if (row.forbidden) {
      const forbidden = candidates.filter((candidate) => (
        (row.forbidden!.forbidAnyResponsibilityKey || candidate.responsibilityKey === row.forbidden!.expectedResponsibilityKey)
        && (row.forbidden!.expectedType === undefined || candidate.proposedType === row.forbidden!.expectedType)
        && (row.forbidden!.forbidPersonalOrShared
          ? ["personal", "shared_household"].includes(candidate.financialScope)
          : candidate.financialScope === row.forbidden!.expectedScope)
      ));
      assert.deepEqual(forbidden, [], JSON.stringify({
        coordinate: annotationCoordinate(row.annotation),
        forbidden: row.forbidden,
        observed: candidates.map((candidate) => ({
          responsibilityKey: candidate.responsibilityKey,
          action: candidate.action,
          type: candidate.proposedType,
          scope: candidate.financialScope
        }))
      }));
    }
  }
});

test("gold-v3 opening evidence is split into reviewable housing and parent-health facts before the generic floor", () => {
  const opening = goldV3Annotation("real-career-first", 0, "start");
  const facts = extractOpeningExpenseFacts(opening.evidenceExcerpt);
  const observed = facts.map((fact) => ({
    responsibilityKey: fact.responsibilityKey,
    type: fact.type,
    scope: fact.financialScope,
    factStatus: fact.factStatus,
    amountBasis: fact.amountBasis
  }));
  assert.deepEqual(observed, [
    {
      responsibilityKey: "recurring_healthcare:opening_parent",
      type: "healthcare",
      scope: "personal",
      factStatus: "needs_review",
      amountBasis: "contextual_estimate"
    },
    {
      responsibilityKey: "primary_residence:main",
      type: "housing",
      scope: "personal",
      factStatus: "needs_review",
      amountBasis: "contextual_estimate"
    }
  ]);
  assert.equal(facts.some((fact) => fact.type === "basic_living"), false,
    "an explicit but unpriced opening responsibility must not collapse into the unrelated adult floor");

  const thirdPartyTuition = extractOpeningExpenseFacts(
    goldV3Annotation("real-education-second", 0, "ignore").evidenceExcerpt
  );
  assert.equal(thirdPartyTuition.some((fact) => fact.type === "education"), false,
    "a family promise to pay tuition cannot become the protagonist's opening education commitment");

  const mortgage = extractOpeningExpenseFacts(
    goldV3Annotation("real-venture-second", 0, "ignore").evidenceExcerpt
  );
  assert.equal(mortgage.some((fact) => fact.type === "housing"), false,
    "mortgage servicing belongs to debt repayment, never an opening housing commitment");
});

test("gold-v3 current-v8 detector rows preserve high-age care uncertainty and personal-ledger boundaries", () => {
  const parent = acceptedParentWorld({ id: "person_parent_unspecified", healthStatus: "fragile" });
  const rows: RawDetectorRow[] = [
    {
      annotation: goldV3Annotation("real-custom-lifespan", 22, "start"),
      ageInMonths: 58 * 12,
      narrativeText: "父亲的膝盖开始不太好，母亲也偶尔头晕，你每周回老家两次，帮忙买菜、陪他们去医院复查。",
      currentWorldState: parent,
      candidateWorldState: parent,
      required: goldV3Annotation("real-custom-lifespan", 22, "start")
    },
    {
      annotation: goldV3Annotation("real-custom-lifespan", 30, "review"),
      ageInMonths: 72 * 12,
      narrativeText: "母亲的记性下降变得明显，有时会忘记刚说过的话。你与父亲商量后，决定请一位钟点工每周来三天帮忙做午饭和打扫，你则保持每周两次回老家陪伴和复查。",
      currentWorldState: parent,
      candidateWorldState: parent,
      required: goldV3Annotation("real-custom-lifespan", 30, "review")
    },
    {
      annotation: goldV3Annotation("real-venture-second", 1, "ignore"),
      ageInMonths: 24 * 12,
      narrativeText: "前三个月，你们在城中村租下一间每月2000元的办公室。",
      forbidden: {
        expectedResponsibilityKey: "primary_residence:main",
        expectedScope: "business_operating",
        expectedType: "housing",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    },
    {
      annotation: goldV3Annotation("real-education-second", 0, "ignore"),
      ageInMonths: 18 * 12,
      narrativeText: "家里愿意承担国内学费，但希望我毕业后尽快稳定就业。",
      forbidden: {
        expectedResponsibilityKey: "continuing_education:opening",
        expectedScope: "third_party",
        expectedType: "education",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    },
    {
      annotation: goldV3Annotation("real-venture-second", 0, "ignore"),
      ageInMonths: 24 * 12,
      narrativeText: "我年薪税后约38万元，房贷余额210万元，每月还款1.3万元，家庭备用金约35万元。",
      forbidden: {
        expectedResponsibilityKey: "primary_residence:main",
        expectedScope: "personal",
        expectedType: "housing",
        forbidPersonalOrShared: true,
        forbidAnyResponsibilityKey: true
      }
    }
  ];

  assert.equal(rows.filter((row) => row.required).length, 2);
  assert.equal(rows.filter((row) => row.forbidden).length, 3);
  let truePositives = 0;
  let falsePositives = 0;
  for (const row of rows) {
    const candidates = deriveExpenseResponsibilityCandidates({
      ageInMonths: row.ageInMonths,
      narrativeText: row.narrativeText,
      currentWorldState: row.currentWorldState,
      candidateWorldState: row.candidateWorldState
    }).candidates;
    if (row.required && candidates.some((candidate) => matchesRawCandidate({ expected: row.required!, candidate }))) {
      truePositives += 1;
    }
    if (row.required && !candidates.some((candidate) => matchesRawCandidate({ expected: row.required!, candidate }))) {
      assert.fail(JSON.stringify({
        coordinate: annotationCoordinate(row.annotation),
        expected: row.required,
        observed: candidates.map((candidate) => ({
          responsibilityKey: candidate.responsibilityKey,
          action: candidate.action,
          scope: candidate.financialScope,
          liability: candidate.liability
        }))
      }));
    }
    if (row.forbidden) {
      const forbidden = candidates.filter((candidate) => (
        (row.forbidden!.forbidAnyResponsibilityKey || candidate.responsibilityKey === row.forbidden!.expectedResponsibilityKey)
        && (row.forbidden!.expectedType === undefined || candidate.proposedType === row.forbidden!.expectedType)
        && (row.forbidden!.forbidPersonalOrShared
          ? ["personal", "shared_household"].includes(candidate.financialScope)
          : candidate.financialScope === row.forbidden!.expectedScope)
      ));
      falsePositives += forbidden.length;
      assert.deepEqual(forbidden, [], JSON.stringify({
        coordinate: annotationCoordinate(row.annotation),
        forbidden: row.forbidden,
        observed: candidates.map((candidate) => ({
          responsibilityKey: candidate.responsibilityKey,
          action: candidate.action,
          scope: candidate.financialScope,
          liability: candidate.liability
        }))
      }));
    }
  }
  assert.equal(truePositives, 2);
  assert.equal(falsePositives, 0);
  assert.equal(Number(((truePositives / 2) * 100).toFixed(2)), 100);
  assert.equal(Number(((truePositives / (truePositives + falsePositives)) * 100).toFixed(2)), 100);

  const plannedCareCandidates = deriveExpenseResponsibilityCandidates({
    ageInMonths: 72 * 12,
    narrativeText: "母亲的记性下降变得明显，有时会忘记刚说过的话。你与父亲商量后，决定请一位钟点工每周来三天帮忙做午饭和打扫，你则保持每周两次回老家陪伴和复查。",
    currentWorldState: parent,
    candidateWorldState: parent
  }).candidates;
  const plannedCareReview = reconcileExpenseCommitments({
    ledger: freshLedger("gold_v3_unknown_parent_care", 72 * 12),
    candidates: plannedCareCandidates,
    ageInMonths: 72 * 12,
    sourceOutcomeId: "gold_v3_unknown_parent_care",
    mode: "enforced"
  });
  assert.equal(plannedCareReview.proposals.length, 0,
    "a care arrangement with no accepted payer or amount must not start/adjust a personal cash-flow account");
  assert.equal(plannedCareReview.issues.some((item) => item.code === "PENDING_FACT"), true,
    "the unknown owner remains auditable for a later Accepted fact instead of being treated as zero or a personal payment");
});

type StructuredObservedAction = [
  responsibilityKey: string,
  action: string,
  scope: string
];

/**
 * This gate intentionally supplies only accepted WorldState changes (plus one
 * non-personal narrative negative). It never supplies ExplicitExpense-
 * ResponsibilityFact or any annotation-shaped key/type/action input, so it
 * independently verifies the structure-first detector that precedes the V4
 * reconciler.
 */
test("frozen structure-first detector corpus reaches 100% precision and recall without annotation injection", () => {
  const base = structuredWorld();
  const retired = initializeCareerState({
    id: "structured_gold_retired",
    employmentStatus: "retired",
    effectiveFromAgeInMonths: 720
  });
  const rows: Array<{
    label: string;
    ageInMonths: number;
    current: WorldStateSnapshot;
    candidate: WorldStateSnapshot;
    narrativeText?: string;
    expected: StructuredObservedAction[];
  }> = [
    {
      label: "cohabitation",
      ageInMonths: 612,
      current: base,
      candidate: structuredWorld({
        relationships: [{
          id: "relationship_partner",
          participantPersonIds: ["partner"],
          type: "romantic",
          stage: "cohabiting",
          status: "active",
          livingTogether: true,
          responsibilitySummary: "已确认共同居住",
          effectiveFromAgeInMonths: 612,
          source: "accepted_history",
          confidence: 1
        }]
      }),
      expected: [
        ["adult_basic_living:protagonist", "review", "shared_household"],
        ["primary_residence:main", "review", "shared_household"]
      ]
    },
    {
      label: "accepted child",
      ageInMonths: 624,
      current: base,
      candidate: structuredWorld({
        people: [...base.people, {
          id: "child_1",
          relation: "child",
          lifeStatus: "active",
          source: "user_fact",
          confidence: 1,
          relationshipSummary: "主角新增一名已接受的子女"
        }]
      }),
      expected: [["child_support:child_1", "review", "personal"]]
    },
    {
      label: "parent care need",
      ageInMonths: 636,
      current: base,
      candidate: structuredWorld({
        people: [{
          ...base.people[0]!,
          healthStatus: "care_dependent",
          relationshipSummary: "母亲已进入需要长期照护的状态"
        }],
        familyRelationships: [{
          id: "family_mother",
          participantPersonId: "mother",
          role: "mother",
          activation: "active",
          contact: "frequent",
          emotionalSupport: "mixed",
          practicalSupport: "unknown",
          autonomyRespect: "unknown",
          conflictIntensity: "low",
          topicStances: [],
          revision: 1
        }]
      }),
      expected: [["elder_care:mother", "review", "personal"]]
    },
    {
      label: "ongoing treatment",
      ageInMonths: 648,
      current: base,
      candidate: structuredWorld({ healthSummary: "医生确认主角需要长期治疗并持续用药。" }),
      expected: [["recurring_healthcare:protagonist", "start", "personal"]]
    },
    {
      label: "retirement review",
      ageInMonths: 720,
      current: base,
      candidate: structuredWorld({
        careerStates: [retired],
        currentCareerStateId: retired.id,
        currentEmploymentStatus: "retired"
      }),
      expected: [["adult_basic_living:protagonist", "review", "personal"]]
    },
    {
      label: "advanced age alone",
      ageInMonths: 89 * 12,
      current: base,
      candidate: structuredWorld(),
      expected: []
    },
    {
      label: "business workshop boundary",
      ageInMonths: 660,
      current: base,
      candidate: structuredWorld(),
      narrativeText: "公司租下木工坊作为经营场地。",
      expected: [["primary_residence:main", "start", "business_operating"]]
    }
  ];

  let materialCount = 0;
  let truePositiveCount = 0;
  let falsePositiveCount = 0;
  for (const row of rows) {
    const observed = deriveExpenseResponsibilityCandidates({
      currentWorldState: row.current,
      candidateWorldState: row.candidate,
      narrativeText: row.narrativeText,
      ageInMonths: row.ageInMonths
    }).candidates.map((candidate): StructuredObservedAction => [
      candidate.responsibilityKey,
      candidate.action,
      candidate.financialScope
    ]);
    materialCount += row.expected.length;
    for (const expected of row.expected) {
      if (observed.some((actual) => actual.join("|") === expected.join("|"))) truePositiveCount += 1;
    }
    for (const actual of observed) {
      if (!row.expected.some((expected) => actual.join("|") === expected.join("|"))) {
        falsePositiveCount += 1;
      }
    }
  }
  const precisionPct = truePositiveCount + falsePositiveCount > 0
    ? Number(((truePositiveCount / (truePositiveCount + falsePositiveCount)) * 100).toFixed(2))
    : null;
  const recallPct = materialCount > 0
    ? Number(((truePositiveCount / materialCount) * 100).toFixed(2))
    : null;
  assert.equal(materialCount, 7, "the structure-first corpus must stay non-empty");
  assert.equal(falsePositiveCount, 0);
  assert.equal(truePositiveCount, materialCount);
  assert.equal(precisionPct, 100);
  assert.equal(recallPct, 100);
});
