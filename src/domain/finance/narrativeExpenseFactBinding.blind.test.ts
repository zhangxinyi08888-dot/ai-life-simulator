import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bindNarrativeExpenseFacts,
  candidateFromNarrativeBinding,
  type NarrativeExpenseFactBinding
} from "./narrativeExpenseFactBinding";

interface BlindSpan {
  start: number;
  end: number;
  excerpt: string;
}

interface BlindAnnotation {
  annotationId: string;
  disposition: "material" | "review" | "ignore";
  responsibilityKey: string;
  responsibilityKind: string;
  completion: "ongoing" | "planned";
  cadence: string;
  liability: string;
  financialScope: string;
  grossMonthlyAmountWan?: number;
  protagonistMonthlyAmountWan?: number;
  householdShareRate?: number;
  spans: { responsibility: BlindSpan };
}

interface BlindExample {
  id: string;
  narrative: string;
  annotations: BlindAnnotation[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const packet = JSON.parse(await readFile(path.join(
  here,
  "fixtures/financial-expense-clause-blind-adjudication-v1.json"
), "utf8")) as { examples: BlindExample[] };

function close(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Math.abs(left - right) <= 0.0001;
}

function overlaps(left: BlindSpan, right: BlindSpan): boolean {
  return left.start < right.end && right.start < left.end;
}

function completionMatches(binding: NarrativeExpenseFactBinding, annotation: BlindAnnotation): boolean {
  if (annotation.completion === "planned") return binding.completion === "planned";
  return binding.completion === "completed" || binding.completion === "ongoing";
}

function observationMatches(binding: NarrativeExpenseFactBinding, annotation: BlindAnnotation): boolean {
  if (binding.responsibilityKey !== annotation.responsibilityKey
    || binding.responsibilityKind !== annotation.responsibilityKind
    || !completionMatches(binding, annotation)
    || binding.cadence !== annotation.cadence
    || binding.liability !== annotation.liability
    || binding.financialScope !== annotation.financialScope
    || !close(binding.explicitMonthlyTotalWan, annotation.grossMonthlyAmountWan)
    || !close(binding.protagonistShareWan, annotation.protagonistMonthlyAmountWan)
    || !close(binding.shareRate, annotation.householdShareRate)
    || !overlaps(binding.responsibilitySpan, annotation.spans.responsibility)) return false;
  return annotation.disposition !== "review"
    || annotation.completion !== "planned"
    || candidateFromNarrativeBinding(binding).action === "review";
}

test("independent normalized blind adjudication reaches exact material/review recall and zero scope mismatch", () => {
  const failures: string[] = [];
  let materialCount = 0;
  let materialMatched = 0;
  let reviewCount = 0;
  let reviewMatched = 0;
  let ignoreCount = 0;
  let ignoreBoundaryMatched = 0;
  let actualScopedCount = 0;
  let matchedScopedCount = 0;

  for (const example of packet.examples) {
    const result = bindNarrativeExpenseFacts({
      sourceNodeId: `blind:${example.id}`,
      sourceOutcomeId: `blind-outcome:${example.id}`,
      narrativeText: example.narrative
    });
    const matchedBindingIds = new Set<string>();
    for (const annotation of example.annotations) {
      if (annotation.disposition === "ignore") {
        ignoreCount += 1;
        const scopedViolation = result.bindings.find((binding) => (
          (binding.completion === "completed" || binding.completion === "ongoing")
          && (binding.liability === "protagonist" || binding.liability === "shared")
          && (binding.financialScope === "personal" || binding.financialScope === "shared_household")
          && overlaps(binding.responsibilitySpan, annotation.spans.responsibility)
        ));
        if (scopedViolation) failures.push(`${example.id}/${annotation.annotationId}: ignore became scoped personal accrual`);
        else ignoreBoundaryMatched += 1;
        continue;
      }
      if (annotation.disposition === "material") materialCount += 1;
      else reviewCount += 1;
      const binding = result.bindings.find((candidate) => (
        !matchedBindingIds.has(candidate.id) && observationMatches(candidate, annotation)
      ));
      if (!binding) {
        failures.push(`${example.id}/${annotation.annotationId}: ${annotation.disposition} observation not matched`);
        continue;
      }
      matchedBindingIds.add(binding.id);
      if (annotation.disposition === "material") materialMatched += 1;
      else reviewMatched += 1;
    }

    const scopedActual = result.bindings.filter((binding) => (
      (binding.completion === "completed" || binding.completion === "ongoing")
      && (binding.liability === "protagonist" || binding.liability === "shared")
      && (binding.financialScope === "personal" || binding.financialScope === "shared_household")
    ));
    actualScopedCount += scopedActual.length;
    matchedScopedCount += scopedActual.filter((binding) => matchedBindingIds.has(binding.id)).length;
    for (const binding of scopedActual) {
      if (!matchedBindingIds.has(binding.id)) failures.push(`${example.id}/${binding.responsibilityKey}: unexpected scoped personal accrual`);
    }
  }

  const summary = {
    material: { matched: materialMatched, total: materialCount, recallPct: materialCount ? materialMatched / materialCount * 100 : null },
    review: { matched: reviewMatched, total: reviewCount, recallPct: reviewCount ? reviewMatched / reviewCount * 100 : null },
    ignoreBoundary: { matched: ignoreBoundaryMatched, total: ignoreCount, passPct: ignoreCount ? ignoreBoundaryMatched / ignoreCount * 100 : null },
    scopedPrecision: { matched: matchedScopedCount, total: actualScopedCount, precisionPct: actualScopedCount ? matchedScopedCount / actualScopedCount * 100 : null },
    scopeMismatchCount: failures.filter((failure) => failure.includes("scoped personal accrual")).length
  };
  console.info(JSON.stringify({ corpus: "financial-expense-clause-blind-adjudication-v1", ...summary }));
  assert.deepEqual(failures, []);
  assert.deepEqual(summary, {
    material: { matched: 26, total: 26, recallPct: 100 },
    review: { matched: 9, total: 9, recallPct: 100 },
    ignoreBoundary: { matched: 13, total: 13, passPct: 100 },
    scopedPrecision: { matched: 27, total: 27, precisionPct: 100 },
    scopeMismatchCount: 0
  });
});
