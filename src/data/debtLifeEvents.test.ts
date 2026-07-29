import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIFE_EVENTS_DATABASE } from "./lifeEvents";

/* TDD contract for Spec §9-11 and §17.3. Production events arrive in D3. */

function event(id: string) {
  const found = LIFE_EVENTS_DATABASE.find((candidate) => candidate.id === id);
  assert.ok(found, `missing debt life event: ${id}`);
  return found;
}

const EXPECTED_OUTCOMES: Record<string, string[]> = {
  financial_debt_pressure_emerges: [
    "reduce_discretionary_expenses",
    "stabilize_core_income",
    "review_debt_structure"
  ],
  financial_repayment_tradeoff: [
    "protect_essential_expenses",
    "maintain_affordable_minimum_payment",
    "seek_verified_income_or_support"
  ],
  financial_payment_strain: [
    "request_debt_restructuring",
    "sell_nonessential_asset",
    "seek_verified_family_support",
    "accept_and_record_payment_arrears"
  ],
  financial_debt_restructuring: [
    "extend_repayment_term",
    "refinance_with_explicit_terms",
    "negotiate_partial_forgiveness",
    "decline_unsustainable_restructuring"
  ],
  financial_life_under_repayment: [
    "maintain_sustainable_repayment",
    "balance_repayment_and_health",
    "preserve_one_meaningful_life_direction"
  ]
};

test("D3-01 all five debt distress/recovery event families exist exactly once", () => {
  for (const id of Object.keys(EXPECTED_OUTCOMES)) {
    assert.equal(LIFE_EVENTS_DATABASE.filter((candidate) => candidate.id === id).length, 1, id);
  }
});

test("D3-02 pressure emerges only from authoritative watch or distressed health", () => {
  const candidate = event("financial_debt_pressure_emerges");
  assert.equal(candidate.category, "financial");
  assert.equal(candidate.narrativeMode, "pressure_crisis");
  assert.equal(candidate.semanticFamily, "financial_debt_pressure");
  assert.deepEqual(candidate.requiredContextGroups, [
    ["debt_health_available", "debt_watch"],
    ["debt_health_available", "debt_distressed"]
  ]);
  assert.equal(candidate.dispatchMode, "random");
});

test("D3-03 repayment tradeoff requires distressed rather than bare debt presence", () => {
  const candidate = event("financial_repayment_tradeoff");
  assert.equal(candidate.narrativeMode, "crossroads_opportunity");
  assert.equal(candidate.semanticFamily, "financial_debt_tradeoff");
  assert.deepEqual(candidate.requiredContextGroups, [["debt_distressed"]]);
  assert.ok(!candidate.requiredContextGroups?.flat().includes("debt_present" as never));
});

test("D3-04 payment strain is the only major arc-only debt crisis entry", () => {
  const candidate = event("financial_payment_strain");
  assert.deepEqual(candidate.requiredContextGroups, [["debt_default_risk"], ["debt_defaulted"]]);
  assert.equal(candidate.dispatchMode, "arc_only");
  assert.equal(candidate.fingerprint?.intensity, "major");
  assert.equal(candidate.intent.phasePolicyId, "financial_debt_v1");
  assert.equal(candidate.intent.temporalProfile?.lifeIntensity, "high_tension");
  assert.equal(candidate.intent.temporalProfile?.requiresFollowUp, true);

  const otherDebtEvents = Object.keys(EXPECTED_OUTCOMES)
    .filter((id) => id !== candidate.id)
    .map(event);
  assert.ok(otherDebtEvents.every((item) => item.dispatchMode !== "arc_only"));
});

test("D3-05 restructuring and life-under-repayment are phase-gated continuations", () => {
  const restructuring = event("financial_debt_restructuring");
  assert.deepEqual(restructuring.historyConditionGroups, [[{
    type: "pressure_arc_state",
    phasePolicyIds: ["financial_debt_v1"],
    phaseIds: ["response", "restructuring"],
    statuses: ["active", "stabilizing"]
  }]]);

  const operation = event("financial_life_under_repayment");
  assert.deepEqual(operation.historyConditionGroups, [[{
    type: "pressure_arc_state",
    phasePolicyIds: ["financial_debt_v1"],
    phaseIds: ["recovery", "operation"],
    statuses: ["active", "stabilizing"]
  }]]);
  assert.deepEqual(operation.requiredContextGroups, [["debt_manageable"], ["debt_watch"]]);
});

test("D3-06 allowed outcomes express intent and never imply automatic success", () => {
  for (const [id, expected] of Object.entries(EXPECTED_OUTCOMES)) {
    const candidate = event(id);
    assert.deepEqual(candidate.intent.allowedOutcomes, expected, id);
    assert.equal(new Set(candidate.intent.allowedOutcomes).size, expected.length, `${id} outcomes must be unique`);
  }
  assert.ok(event("financial_payment_strain").intent.allowedOutcomes.includes("request_debt_restructuring"));
  assert.ok(!event("financial_payment_strain").intent.allowedOutcomes.includes("debt_restructured"));
});

test("D3-07 debt reduction progress requires an improving authoritative trend", () => {
  const candidate = event("financial_debt_reduction_progress");
  assert.deepEqual(candidate.requiredContextGroups, [["debt_health_available", "debt_recovering"]]);
  assert.ok(!candidate.requiredContextGroups?.flat().includes("debt_present" as never));
});

test("D3-08 the ghost financial_major_crisis reference is removed", () => {
  const source = readFileSync(new URL("./phase2LifeEvents.ts", import.meta.url), "utf8");
  assert.equal(source.includes("financial_major_crisis"), false);
});

test("D3-09 deterministic debt escalation only returns payment strain for reliable default risk", async () => {
  const modulePath = "../utils/debtEventScheduling";
  const module = await import(modulePath) as {
    queryDebtEscalationEvent: (input: Record<string, unknown>) => { id: string } | undefined;
  };
  const base = {
    history: [{ debtHealthState: { level: "default_risk", source: "authoritative_ledger" } }],
    worldState: { pressureArcs: [], foregroundPressureArcId: undefined }
  };
  assert.equal(module.queryDebtEscalationEvent(base)?.id, "financial_payment_strain");
  assert.equal(module.queryDebtEscalationEvent({
    ...base,
    history: [{ debtHealthState: { level: "watch", source: "authoritative_ledger" } }]
  }), undefined);
  assert.equal(module.queryDebtEscalationEvent({
    ...base,
    worldState: {
      pressureArcs: [{ id: "health", phasePolicyId: "health_crisis_v1", status: "active" }],
      foregroundPressureArcId: "health"
    }
  }), undefined);
});

test("D3-10 legacy unknown and bare debt_present cannot open a crisis", async () => {
  const modulePath = "../utils/eventEligibility";
  const module = await import(modulePath) as {
    matchesRequiredContext: (key: string, input: Record<string, unknown>) => boolean;
  };
  const base = {
    attribs: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
    userData: {},
    age: 40,
    history: [{
      age: 40,
      ageInMonths: 480,
      stage: "兼容历史",
      title: "旧债务节点",
      description: "旧财务状态记录了债务，但没有权威账本。",
      selectedChoice: "继续处理",
      attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
      choices: [{ id: "A", text: "继续处理", impactSummary: "继续" }],
      isEndingNode: false,
      financialState: { totalDebtWan: 10, isEstimated: false },
      debtHealthState: { level: "unknown", trend: "unknown", source: "legacy_compatibility" }
    }]
  };
  assert.equal(module.matchesRequiredContext("debt_present", base), true);
  assert.equal(module.matchesRequiredContext("debt_health_available", base), false);
  assert.equal(module.matchesRequiredContext("debt_default_risk", base), false);
  assert.equal(module.matchesRequiredContext("debt_defaulted", base), false);
});
