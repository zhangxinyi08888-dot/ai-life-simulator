import assert from "node:assert/strict";
import test from "node:test";

/* TDD contract for Spec §12-14 and §17.4. Production behavior arrives in D4. */

const attributes = { happiness: 50, intelligence: 60, wealth: 35, relation: 50, health: 55 };

async function arcModule() {
  const modulePath = "./arcLifecycle";
  return import(modulePath) as Promise<Record<string, any>>;
}

function debtHealth(overrides: Record<string, unknown> = {}) {
  return {
    asOfAgeInMonths: 480,
    level: "watch",
    trend: "stable",
    totalDebtWan: 40,
    scheduledDebtServiceNext12MonthsWan: 8,
    availableCashForDebtNext12MonthsWan: 9,
    debtServiceCoverageRatio: 1.125,
    liquidityShortfallDebtWan: 0,
    consecutiveMissedPaymentMonths: 0,
    missedPaymentMonthsLast12: 0,
    activeDefaultedDebtCount: 0,
    reasonCodes: ["PAYMENTS_CURRENT"],
    source: "authoritative_ledger",
    sourceLedgerRevision: 3,
    latestDebtServiceHasUnpaidAmount: false,
    hasOpenDelinquentIssue: false,
    ...overrides
  };
}

function debtArc(overrides: Record<string, unknown> = {}) {
  return {
    id: "debt_arc",
    eventId: "financial_payment_strain",
    eventIntentType: "financial_payment_strain",
    phasePolicyId: "financial_debt_v1",
    phaseId: "trigger",
    status: "active",
    startedAtAgeInMonths: 470,
    phaseStartedAtAgeInMonths: 470,
    phaseCheckpointCount: 0,
    totalCheckpointCount: 0,
    unresolvedSummary: "原还款安排无法维持",
    ...overrides
  };
}

test("D4-01 financial_debt_v1 defines the exact five-phase policy", async () => {
  const module = await arcModule();
  const policy = module.resolvePhasePolicy("financial_debt_v1");
  assert.equal(policy, module.FINANCIAL_DEBT_PHASE_POLICY);
  assert.equal(policy.id, "financial_debt_v1");
  assert.deepEqual(policy.phases.map((phase: any) => phase.id), [
    "trigger", "response", "restructuring", "recovery", "operation"
  ]);
  assert.deepEqual(policy.earlyResolveConditions, [{ type: "debt_health_sustainable" }]);
  assert.ok(policy.allowedSignalTypes.includes("restructuring_accepted"));
  assert.ok(policy.allowedSignalTypes.includes("debt_cashflow_stabilized"));
});

test("D4-02 payment strain starts a foreground debt arc in trigger", async () => {
  const module = await arcModule();
  const result = module.reducePressureArc({
    startProposal: {
      eventId: "financial_payment_strain",
      eventIntentType: "financial_payment_strain",
      currentAgeInMonths: 480
    },
    policy: module.FINANCIAL_DEBT_PHASE_POLICY,
    selectedDecision: "请求重组",
    attributes,
    timelineAdvance: { elapsedMonths: 0, targetAgeInMonths: 480 },
    closingDebtHealthState: debtHealth({ level: "default_risk" })
  });
  assert.equal(result.action, "start");
  assert.equal(result.nextArcState.phasePolicyId, "financial_debt_v1");
  assert.equal(result.nextArcState.phaseId, "trigger");
  assert.equal(result.foregroundPressureArcId, result.nextArcState.id);
});

test("D4-03 debt_health_at_most uses ordered closing health and never matches unknown", async () => {
  const module = await arcModule();
  assert.equal(module.matchesDebtHealthExitCondition(
    { type: "debt_health_at_most", value: "watch" }, debtHealth({ level: "watch" })
  ), true);
  assert.equal(module.matchesDebtHealthExitCondition(
    { type: "debt_health_at_most", value: "watch" }, debtHealth({ level: "default_risk" })
  ), false);
  assert.equal(module.matchesDebtHealthExitCondition(
    { type: "debt_health_at_most", value: "default_risk" }, debtHealth({ level: "unknown" })
  ), false);
});

test("D4-04 sustainable health permits a debt-positive exit", async () => {
  const module = await arcModule();
  assert.equal(module.isDebtHealthSustainable(debtHealth({
    level: "watch",
    totalDebtWan: 40,
    trend: "improving",
    latestDebtServiceHasUnpaidAmount: false,
    hasOpenDelinquentIssue: false
  })), true);
  assert.equal(module.isDebtHealthSustainable(debtHealth({ level: "watch", trend: "worsening" })), false);
  assert.equal(module.isDebtHealthSustainable(debtHealth({ level: "watch", hasOpenDelinquentIssue: true })), false);
});

test("D4-05 closing sustainable health resolves from any phase without one-node lag", async () => {
  const module = await arcModule();
  for (const phaseId of ["trigger", "response", "restructuring", "recovery", "operation"]) {
    const result = module.reducePressureArc({
      currentArc: debtArc({ phaseId }),
      policy: module.FINANCIAL_DEBT_PHASE_POLICY,
      selectedDecision: "维持可承担还款",
      acceptedOutcome: { worldDeltas: [], arcSignals: [] },
      attributes,
      timelineAdvance: { elapsedMonths: 3, targetAgeInMonths: 483 },
      closingDebtHealthState: debtHealth({ level: "watch", trend: "improving", totalDebtWan: 35 })
    });
    assert.equal(result.action, "resolve", phaseId);
    assert.equal(result.nextArcState.status, "resolved", phaseId);
  }
});

test("D4-06 operation checkpoint cap cannot resolve continuing default risk", async () => {
  const module = await arcModule();
  const closing = debtHealth({ level: "default_risk", consecutiveMissedPaymentMonths: 3 });
  const before = structuredClone(closing);
  const result = module.reducePressureArc({
    currentArc: debtArc({ phaseId: "operation", phaseCheckpointCount: 1, totalCheckpointCount: 5 }),
    policy: module.FINANCIAL_DEBT_PHASE_POLICY,
    selectedDecision: "继续协商",
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    attributes,
    timelineAdvance: { elapsedMonths: 12, targetAgeInMonths: 492 },
    closingDebtHealthState: closing
  });
  assert.notEqual(result.action, "resolve");
  assert.equal(result.nextArcState.phaseId, "operation");
  assert.ok(result.reasonCodes.includes("resolution-condition-not-met"));
  assert.deepEqual(closing, before, "arc transition must not mutate debt health");
});

test("D4-07 model-authored system debt signals are discarded", async () => {
  const module = await arcModule();
  const narrativeText = "债务协商仍在等待确认。";
  const accepted = module.validateNodeOutcomeProposal({
    policy: module.FINANCIAL_DEBT_PHASE_POLICY,
    narrativeText,
    arcSignals: [
      { type: "restructuring_accepted", evidence: narrativeText, confidence: 1 },
      { type: "debt_cashflow_stabilized", evidence: narrativeText, confidence: 1 },
      { type: "restructuring_started", evidence: narrativeText, confidence: 0.9 }
    ]
  });
  assert.deepEqual(accepted.arcSignals.map((signal: any) => signal.type), ["restructuring_started"]);
});

test("D4-08 a rejected restructure proposal cannot advance the arc as accepted", async () => {
  const module = await arcModule();
  const result = module.reducePressureArc({
    currentArc: debtArc({ phaseId: "restructuring", phaseCheckpointCount: 0 }),
    policy: module.FINANCIAL_DEBT_PHASE_POLICY,
    selectedDecision: "同意重组方案",
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    acceptedFinancialEvents: [],
    rejectedFinancialProposalIds: ["proposal_restructure"],
    attributes,
    timelineAdvance: { elapsedMonths: 3, targetAgeInMonths: 483 },
    closingDebtHealthState: debtHealth({ level: "default_risk" })
  });
  assert.equal(result.action, "stay");
  assert.equal(result.nextArcState.phaseId, "restructuring");
  assert.ok(!result.reasonCodes.includes("restructuring-accepted"));
});

test("D4-09 arc signals are revalidated against final repaired narrative", async () => {
  const module = await arcModule();
  const accepted = module.validateNodeOutcomeProposal({
    policy: module.FINANCIAL_DEBT_PHASE_POLICY,
    narrativeText: "重组仍未获得确认，原方案继续等待。",
    arcSignals: [{
      type: "restructuring_started",
      evidence: "重组协议已经正式生效",
      confidence: 0.95
    }]
  });
  assert.equal(accepted.arcSignals.length, 0);
});

test("D4-10 acute health escalation suspends debt and becomes the sole foreground arc", async () => {
  const module = await arcModule();
  const result = module.preemptDebtArcForAcuteHealth({
    debtArc: debtArc({ phaseId: "restructuring", phaseCheckpointCount: 1 }),
    healthStartProposal: {
      eventId: "health_forced_pause",
      eventIntentType: "health_forced_pause",
      currentAgeInMonths: 480
    }
  });
  assert.equal(result.nextArcState.phasePolicyId, "health_crisis_v1");
  assert.equal(result.additionalArcStateUpdates.length, 1);
  assert.equal(result.additionalArcStateUpdates[0].id, "debt_arc");
  assert.equal(result.additionalArcStateUpdates[0].status, "suspended");
  assert.equal(result.additionalArcStateUpdates[0].phaseId, "restructuring");
  assert.equal(result.additionalArcStateUpdates[0].phaseCheckpointCount, 1);
  assert.equal(result.foregroundPressureArcId, result.nextArcState.id);
});

test("D4-11 suspended debt checkpoints do not drift", async () => {
  const module = await arcModule();
  const suspended = debtArc({
    status: "suspended",
    phaseId: "response",
    phaseCheckpointCount: 1,
    totalCheckpointCount: 2,
    suspendedAtAgeInMonths: 480,
    suspendedByArcId: "health_arc"
  });
  const result = module.reducePressureArc({
    currentArc: suspended,
    policy: module.FINANCIAL_DEBT_PHASE_POLICY,
    selectedDecision: "优先治疗",
    acceptedOutcome: { worldDeltas: [], arcSignals: [] },
    attributes,
    timelineAdvance: { elapsedMonths: 12, targetAgeInMonths: 492 },
    closingDebtHealthState: debtHealth({ level: "default_risk" })
  });
  assert.equal(result.nextArcState.status, "suspended");
  assert.equal(result.nextArcState.phaseCheckpointCount, 1);
  assert.equal(result.nextArcState.totalCheckpointCount, 2);
  assert.equal(result.nextArcState.phaseStartedAtAgeInMonths, suspended.phaseStartedAtAgeInMonths);
});

test("D4-12 health resolution resumes risky debt but closes sustainable background debt", async () => {
  const module = await arcModule();
  const suspended = debtArc({ status: "suspended", suspendedByArcId: "health_arc" });
  const resumed = module.resolveDebtArcAfterHealth({
    debtArc: suspended,
    healthArcId: "health_arc",
    closingDebtHealthState: debtHealth({ level: "distressed" })
  });
  assert.equal(resumed.status, "active");

  const closed = module.resolveDebtArcAfterHealth({
    debtArc: suspended,
    healthArcId: "health_arc",
    closingDebtHealthState: debtHealth({ level: "watch", trend: "improving" })
  });
  assert.equal(closed.status, "resolved");
  assert.ok(closed.resolutionReasonCodes.includes("debt-stabilized-during-health-preemption"));
});

test("D4-13 phase presentation never falls back to the original crisis in recovery", async () => {
  const module = await arcModule();
  const expected: Record<string, string> = {
    trigger: "financial_payment_strain",
    response: "financial_payment_strain",
    restructuring: "financial_debt_restructuring",
    recovery: "financial_life_under_repayment",
    operation: "financial_life_under_repayment"
  };
  for (const [phaseId, eventId] of Object.entries(expected)) {
    assert.equal(module.resolvePressureArcPresentationEvent({
      arc: debtArc({ phaseId }),
      safeDynamicEvent: undefined
    }).id, eventId, phaseId);
  }
});
