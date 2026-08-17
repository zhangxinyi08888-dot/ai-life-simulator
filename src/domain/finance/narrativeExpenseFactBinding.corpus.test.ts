import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bindNarrativeExpenseFacts, type NarrativeExpenseFactBinding } from "./narrativeExpenseFactBinding";

interface ExpectedBinding {
  id: string;
  responsibilityKey: string;
  responsibilityKind: string;
  proposedType: string;
  action: string;
  completion: "completed" | "ongoing";
  cadence: string;
  liability: string;
  financialScope: string;
  amountDisposition: "exact" | "ambiguous" | "exact_total_share_unknown";
  grossMonthlyAmountWan?: number;
  protagonistMonthlyAmountWan?: number;
  shareRate?: number;
  spans: Record<string, { text: string; occurrence?: number }>;
}

interface GoldExample {
  id: string;
  narrative: string;
  expectedBindings: ExpectedBinding[];
  plannedObservations?: Array<{ responsibilityKey?: string; completion: "planned" }>;
  negativeAssertions?: Array<{ forbidPersonalOrSharedResponsibilityKey: string }>;
}

interface ExpectedSpan {
  text: string;
  occurrence?: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(await readFile(path.join(here, "fixtures", "financial-expense-clause-binding-gold-v1.json"), "utf8")) as {
  examples: GoldExample[];
};

function close(left: number | undefined, right: number | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Math.abs(left - right) <= 0.0001;
}

function resolveExpectedSpan(narrative: string, expected: ExpectedSpan): { start: number; end: number } {
  let from = 0;
  let start = -1;
  for (let index = 0; index <= (expected.occurrence || 0); index += 1) {
    start = narrative.indexOf(expected.text, from);
    assert.notEqual(start, -1, `missing annotated span ${JSON.stringify(expected.text)}`);
    from = start + expected.text.length;
  }
  return { start, end: start + expected.text.length };
}

function overlaps(actual: { start: number; end: number } | undefined, expected: { start: number; end: number }): boolean {
  return Boolean(actual && actual.start < expected.end && expected.start < actual.end);
}

function spansMatch(narrative: string, actual: NarrativeExpenseFactBinding, expected: ExpectedBinding): boolean {
  const fields = ["responsibility", "completion", "payer", "amount", "cadence"] as const;
  const actualSpans = {
    responsibility: actual.responsibilitySpan,
    completion: actual.completionSpan,
    payer: actual.payerSpan,
    amount: actual.amountSpan,
    cadence: actual.cadenceSpan
  };
  return fields.every((field) => {
    const annotated = expected.spans[field];
    return !annotated || overlaps(actualSpans[field], resolveExpectedSpan(narrative, annotated));
  });
}

function matches(narrative: string, actual: NarrativeExpenseFactBinding, expected: ExpectedBinding): boolean {
  const activeCompletionMatches = [actual.completion, expected.completion].every((value) => (
    value === "completed" || value === "ongoing"
  ));
  if (actual.responsibilityKey !== expected.responsibilityKey
    || actual.responsibilityKind !== expected.responsibilityKind
    || actual.proposedType !== expected.proposedType
    || actual.action !== expected.action
    || !(actual.completion === expected.completion || activeCompletionMatches)
    || actual.cadence !== expected.cadence
    || actual.liability !== expected.liability
    || actual.financialScope !== expected.financialScope
    || !spansMatch(narrative, actual, expected)) return false;
  if (expected.amountDisposition === "ambiguous") {
    return actual.explicitMonthlyTotalWan === undefined
      && actual.reasonCodes.includes("EXPENSE_FACT_BINDING_AMBIGUOUS");
  }
  if (!close(actual.explicitMonthlyTotalWan, expected.grossMonthlyAmountWan)) return false;
  if (expected.amountDisposition === "exact_total_share_unknown") {
    return actual.shareRate === undefined && actual.protagonistShareWan === undefined;
  }
  return close(actual.shareRate, expected.shareRate)
    && close(actual.protagonistShareWan, expected.protagonistMonthlyAmountWan);
}

function summarize(binding: NarrativeExpenseFactBinding): string {
  return [
    binding.responsibilityKey,
    binding.action,
    binding.completion,
    binding.cadence,
    binding.liability,
    binding.financialScope,
    binding.explicitMonthlyTotalWan ?? "-",
    binding.protagonistShareWan ?? "-",
    binding.shareRate ?? "-",
    binding.responsibilitySpan?.excerpt ?? "-",
    binding.completionSpan?.excerpt ?? "-",
    binding.payerSpan?.excerpt ?? "-",
    binding.amountSpan?.excerpt ?? "-",
    binding.cadenceSpan?.excerpt ?? "-"
  ].join("|");
}

test("frozen clause-binding corpus reaches exact contract recall and has no scoped false positives", () => {
  let expectedCount = 0;
  let matchedCount = 0;
  const failures: string[] = [];
  for (const example of corpus.examples) {
    const result = bindNarrativeExpenseFacts({
      sourceNodeId: `gold:${example.id}`,
      sourceOutcomeId: `gold-outcome:${example.id}`,
      narrativeText: example.narrative
    });
    for (const binding of result.bindings) {
      for (const span of [binding.responsibilitySpan, binding.completionSpan, binding.payerSpan, binding.amountSpan, binding.cadenceSpan]) {
        if (!span) continue;
        assert.equal(example.narrative.slice(span.start, span.end), span.excerpt, `${example.id}: invalid source span`);
      }
    }
    const matchedActualIds = new Set<string>();
    for (const expected of example.expectedBindings) {
      expectedCount += 1;
      const actual = result.bindings.find((candidate) => !matchedActualIds.has(candidate.id) && matches(example.narrative, candidate, expected));
      if (!actual) {
        failures.push(`${example.id}/${expected.id}: expected contract not matched; actual=${result.bindings.map(summarize).join(" || ") || "<none>"}`);
        continue;
      }
      matchedCount += 1;
      matchedActualIds.add(actual.id);
    }
    for (const negative of example.negativeAssertions || []) {
      const violation = result.bindings.find((binding) => (
        !matchedActualIds.has(binding.id)
        &&
        binding.responsibilityKey === negative.forbidPersonalOrSharedResponsibilityKey
        && ["personal", "shared_household"].includes(binding.financialScope)
        && ["protagonist", "shared"].includes(binding.liability)
      ));
      if (violation) failures.push(`${example.id}: negative scope violation ${summarize(violation)}`);
    }
    const unmatchedScoped = result.bindings.filter((binding) => (
      !matchedActualIds.has(binding.id)
      && ["protagonist", "shared"].includes(binding.liability)
      && ["completed", "ongoing"].includes(binding.completion)
    ));
    for (const binding of unmatchedScoped) failures.push(`${example.id}: unexpected scoped binding ${summarize(binding)}`);
  }
  assert.equal(matchedCount, expectedCount, failures.join("\n"));
  assert.deepEqual(failures, []);
  assert.ok(expectedCount >= 20);
});
