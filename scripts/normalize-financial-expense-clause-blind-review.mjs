import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  financialExpenseClauseBlindSourceSha256,
  validateFinancialExpenseClauseBlindAdjudication
} from "./lib/financial-expense-clause-blind-packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const rawReviewRelativePath = "docs/superpowers/reviews/2026-08-11-financial-expense-clause-blind-review-raw.md";
const outputRelativePath = "src/domain/finance/fixtures/financial-expense-clause-blind-adjudication-v1.json";
const corpusPath = path.join(projectRoot, "src/domain/finance/fixtures/financial-expense-clause-binding-gold-v1.json");
const rawReviewPath = path.join(projectRoot, rawReviewRelativePath);
const outputPath = path.join(projectRoot, outputRelativePath);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseReviewExamples(markdown) {
  const examples = [];
  for (const match of markdown.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/gu)) {
    const source = match[1].trim();
    if (!source.startsWith("{")) continue;
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    if (parsed?.id && parsed?.narrative && Array.isArray(parsed.annotations)) examples.push(parsed);
  }
  return examples;
}

function countDispositions(examples) {
  const counts = { material: 0, review: 0, ignore: 0 };
  for (const example of examples) {
    for (const annotation of example.annotations) counts[annotation.disposition] += 1;
  }
  return counts;
}

const dispositionOverrides = new Map([
  ["C-03:A-02", "ignore"],
  ["P-15:A-02", "ignore"],
  ["P-21:A-01", "review"],
  ["P-21:A-02", "review"],
  ["P-25:A-01", "review"]
]);

function canonicalKind(annotation, narrative) {
  if (annotation.responsibilityKind === "rent") return "primary_residence";
  if (annotation.responsibilityKind === "medical") return "recurring_healthcare";
  if (annotation.responsibilityKind === "care") return "elder_care";
  if (annotation.responsibilityKind === "childcare") return "child_support";
  if (annotation.responsibilityKind === "insurance") return "personal_insurance";
  if (annotation.responsibilityKind === "education") return "continuing_education";
  if (/租金.+(?:转入|汇入|收租)|出租/u.test(narrative)) return "rental_income";
  throw new Error(`Unsupported blind responsibility kind: ${annotation.responsibilityKind}`);
}

function canonicalKey(exampleId, annotation, kind) {
  if (kind === "primary_residence") return exampleId === "P-22" && annotation.annotationId === "A-02"
    ? "primary_residence:parent_temp"
    : "primary_residence:main";
  if (kind === "recurring_healthcare") {
    const protagonistExamples = new Set(["C-05:A-02", "C-12:A-01", "P-20:A-01", "P-20:A-02"]);
    return protagonistExamples.has(`${exampleId}:${annotation.annotationId}`)
      ? "recurring_healthcare:protagonist"
      : "recurring_healthcare:parents";
  }
  if (kind === "elder_care") return "elder_care:parents";
  if (kind === "child_support") return "child_support:unidentified";
  if (kind === "personal_insurance") return "personal_insurance:protagonist";
  if (kind === "continuing_education") return "continuing_education:protagonist";
  if (kind === "rental_income") return annotation.responsibilityKey === "partner"
    ? "rental_income:partner"
    : "rental_income:protagonist";
  throw new Error(`Unsupported canonical responsibility kind: ${kind}`);
}

function canonicalLiability(annotation, disposition) {
  if (annotation.liability === "unknown") return "unknown";
  if (annotation.liability === "shared") return "shared";
  if (disposition === "ignore" && annotation.responsibilityKey !== "protagonist") return "third_party";
  return "protagonist";
}

function canonicalScope(annotation, liability) {
  if (annotation.financialScope === "business") return "business_operating";
  if (liability === "third_party") return "third_party";
  if (liability === "shared") return "shared_household";
  return "personal";
}

function expandResponsibilitySpan(narrative, span) {
  if (!Array.isArray(span) || span.length !== 2) throw new Error("Reviewer responsibility span must be [start,end]");
  let [start, end] = span;
  const delimiters = new Set(["，", ",", "；", ";", "。", "！", "？", "\n"]);
  // Several reviewer tuples started one or two code units before the
  // separating comma. Move inside the intended clause before expanding,
  // otherwise the preceding fact is merged.
  for (let index = start; index < Math.min(end, start + 4); index += 1) {
    if (!delimiters.has(narrative[index])) continue;
    start = index + 1;
    break;
  }
  while (start < end && delimiters.has(narrative[start])) start += 1;
  while (start > 0 && !delimiters.has(narrative[start - 1])) start -= 1;
  while (end < narrative.length && !delimiters.has(narrative[end])) end += 1;
  while (start < end && /\s/u.test(narrative[start])) start += 1;
  while (end > start && /\s/u.test(narrative[end - 1])) end -= 1;
  return { start, end, excerpt: narrative.slice(start, end) };
}

function normalizeAnnotation(example, annotation) {
  const identity = `${example.id}:${annotation.annotationId}`;
  const disposition = dispositionOverrides.get(identity) || annotation.disposition;
  const responsibilityKind = canonicalKind(annotation, example.narrative);
  const liability = canonicalLiability(annotation, disposition);
  const financialScope = canonicalScope(annotation, liability);
  const responsibilityKey = canonicalKey(example.id, annotation, responsibilityKind);
  const span = expandResponsibilitySpan(example.narrative, annotation.spans?.responsibility);
  const cadenceNotExplicit = identity === "P-17:A-02";
  return {
    annotationId: identity,
    disposition,
    responsibilityKey,
    responsibilityKind,
    completion: annotation.completion,
    cadence: cadenceNotExplicit ? "recurring_unknown" : annotation.cadence === "yearly" ? "annual" : annotation.cadence,
    liability,
    financialScope,
    ...(annotation.grossMonthlyAmountWan !== undefined
      ? { grossMonthlyAmountWan: annotation.grossMonthlyAmountWan }
      : {}),
    ...(annotation.protagonistMonthlyAmountWan !== undefined && liability !== "third_party"
      ? { protagonistMonthlyAmountWan: annotation.protagonistMonthlyAmountWan }
      : {}),
    ...(annotation.householdShareRate !== undefined
      ? { householdShareRate: annotation.householdShareRate }
      : {}),
    spans: { responsibility: span },
    reviewerOriginal: {
      annotationId: annotation.annotationId,
      disposition: annotation.disposition,
      responsibilityKey: annotation.responsibilityKey,
      responsibilityKind: annotation.responsibilityKind,
      liability: annotation.liability,
      financialScope: annotation.financialScope,
      responsibilitySpan: annotation.spans.responsibility
    },
    normalizationReasons: [
      "canonical_taxonomy_mapping",
      "globally_unique_annotation_identity",
      "utf16_responsibility_span_boundary_repair",
      ...(cadenceNotExplicit ? ["cadence_not_explicit_in_source"] : []),
      ...(disposition !== annotation.disposition ? ["user_authorized_disposition_policy"] : [])
    ],
    ...(annotation.notes ? { notes: annotation.notes } : {})
  };
}

function addedRentalIncomeIgnore(example, actor) {
  const end = example.narrative.replace(/[。！？]+$/u, "").length;
  return {
    annotationId: `${example.id}:A-01`,
    disposition: "ignore",
    responsibilityKey: `rental_income:${actor}`,
    responsibilityKind: "rental_income",
    completion: "ongoing",
    cadence: "monthly",
    liability: actor === "protagonist" ? "protagonist" : "third_party",
    financialScope: actor === "protagonist" ? "personal" : "third_party",
    spans: { responsibility: { start: 0, end, excerpt: example.narrative.slice(0, end) } },
    reviewerOriginal: null,
    normalizationReasons: ["explicit_ignore_added_from_user_summary"],
    notes: "租金收入是明确负例，不得生成个人支出责任。"
  };
}

const [corpusBytes, rawReviewBytes] = await Promise.all([
  readFile(corpusPath),
  readFile(rawReviewPath)
]);
const corpus = JSON.parse(corpusBytes.toString("utf8"));
const rawExamples = parseReviewExamples(rawReviewBytes.toString("utf8"));
const sourceById = new Map(corpus.examples.map((example) => [example.id, example]));
if (rawExamples.length !== sourceById.size) throw new Error(`Expected ${sourceById.size} reviewed examples, found ${rawExamples.length}`);

const normalizedExamples = rawExamples.map((example) => {
  const source = sourceById.get(example.id);
  if (!source || source.narrative !== example.narrative) throw new Error(`Narrative mismatch for ${example.id}`);
  const annotations = example.annotations.map((annotation) => normalizeAnnotation(example, annotation));
  if (example.id === "C-11" || example.id === "N-03") annotations.push(addedRentalIncomeIgnore(example, "protagonist"));
  if (example.id === "N-04") annotations.push(addedRentalIncomeIgnore(example, "partner"));
  return {
    id: example.id,
    narrative: example.narrative,
    narrativeSha256: sha256(example.narrative),
    reviewed: true,
    annotations
  };
});

const originalDispositionCounts = countDispositions(rawExamples);
const normalizedDispositionCounts = countDispositions(normalizedExamples);
const normalizedAnnotationCount = Object.values(normalizedDispositionCounts).reduce((sum, count) => sum + count, 0);
if (normalizedAnnotationCount !== 48
  || normalizedDispositionCounts.material !== 26
  || normalizedDispositionCounts.review !== 9
  || normalizedDispositionCounts.ignore !== 13) {
  throw new Error(`Unexpected normalized counts: ${JSON.stringify(normalizedDispositionCounts)}`);
}

const sourceSha256 = financialExpenseClauseBlindSourceSha256(corpus);
const packet = {
  schemaVersion: 1,
  packetKind: "financial_expense_clause_independent_blind_adjudication",
  source: {
    corpusId: corpus.corpusId,
    corpusRevision: corpus.revision,
    corpusSha256: sourceSha256
  },
  reviewerDeclaration: {
    reviewerId: "user-provided-independent-blind-review",
    reviewedAt: "2026-08-11T00:00:00+08:00",
    method: "independent_blind",
    detectorOutputConsulted: false,
    proposalLedgerAuditConsulted: false
  },
  normalization: {
    normalizedAt: "2026-08-16T00:00:00+08:00",
    rawReviewPath: rawReviewRelativePath,
    rawReviewSha256: sha256(rawReviewBytes),
    originalAnnotationCount: 45,
    originalDispositionCounts,
    normalizedAnnotationCount,
    normalizedDispositionCounts,
    declaredSummaryCountWasNotUsed: 47,
    rejectedTargetCountWasNotUsed: 49,
    rules: [
      "planned responsibility remains review",
      "third-party, company and rental-income facts are ignore",
      "unknown payer or unknown shared-household share is review",
      "C-07 remains two responsibilities because one binding cannot own both rent and healthcare",
      "no synthetic forty-ninth annotation is added"
    ],
    semanticOverrides: [...dispositionOverrides.entries()].map(([annotationId, disposition]) => ({ annotationId, disposition })),
    addedIgnoreAnnotations: ["C-11:A-01", "N-03:A-01", "N-04:A-01"],
    correctedNarrativeHashes: ["P-16"],
    taxonomyAliases: {
      rent: "primary_residence",
      medical: "recurring_healthcare",
      care: "elder_care",
      childcare: "child_support",
      insurance: "personal_insurance",
      education: "continuing_education",
      sole: "protagonist",
      business: "business_operating"
    }
  },
  examples: normalizedExamples
};

const validation = validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 });
if (validation.status !== "review_complete") throw new Error(`Normalized blind review failed validation: ${JSON.stringify(validation)}`);
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath: outputRelativePath, ...validation }, null, 2)}\n`);
