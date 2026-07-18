import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryItem, LifeAttributes, WorldStateSnapshot } from "../../types";
import { initializeCareerState } from "../career/careerState";
import { initializeFinancialLedger } from "../finance/initializeLedger";
import { auditWorldHistory } from "./auditHistory";
import { auditBrowserCases, renderWorldInvariantMarkdown } from "./auditCases";
import { requiredTestLayers } from "./risk";

const attributes: LifeAttributes = {
  happiness: 50,
  intelligence: 50,
  wealth: 50,
  relation: 50,
  health: 50
};

function historyNode(input: {
  ageInMonths: number;
  ending?: boolean;
  world?: WorldStateSnapshot;
  ledger?: ReturnType<typeof initializeFinancialLedger>;
}): HistoryItem {
  return {
    age: input.ageInMonths / 12,
    ageInMonths: input.ageInMonths,
    title: `节点 ${input.ageInMonths}`,
    stage: "测试",
    description: "确定性世界审计测试节点。",
    selectedChoice: "继续",
    attributes,
    choices: [],
    isEndingNode: input.ending || false,
    financialLedger: input.ledger,
    financialLedgerMode: input.ledger ? "authoritative" : undefined,
    worldStateSnapshot: input.world
  };
}

function validWorld(ageInMonths: number): WorldStateSnapshot {
  const career = initializeCareerState({
    id: "career_current",
    employmentStatus: "employed",
    effectiveFromAgeInMonths: ageInMonths - 12
  });
  return {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    currentEmploymentStatus: "employed",
    careerStates: [career],
    currentCareerStateId: career.id,
    careerRevision: 0,
    committedTransactionIds: [],
    version: 2
  };
}

test("valid history passes the first world reality rule set", () => {
  const age = 360;
  const report = auditWorldHistory({
    routeId: "valid-route",
    generatedAt: "2026-07-18T00:00:00.000Z",
    history: [historyNode({
      ageInMonths: age,
      world: validWorld(age),
      ledger: initializeFinancialLedger({ id: "ledger", asOfAgeInMonths: age })
    })]
  });

  assert.equal(report.summary.passed, true);
  assert.equal(report.summary.blocking, 0);
  assert.ok(report.evaluatedRuleIds.includes("TIME-001"));
  assert.ok(report.evaluatedRuleIds.includes("CAREER-FIN-001"));
});

test("audit reports time reversal, post-ending continuation and ledger age drift", () => {
  const report = auditWorldHistory({
    history: [
      historyNode({ ageInMonths: 480, ending: true }),
      historyNode({
        ageInMonths: 470,
        ledger: initializeFinancialLedger({ id: "old-ledger", asOfAgeInMonths: 460 })
      })
    ]
  });

  assert.equal(report.summary.passed, false);
  assert.deepEqual(
    new Set(report.findings.map((issue) => issue.ruleId)),
    new Set(["TIME-001", "ENDING-001", "FIN-TIME-001"])
  );
});

test("audit exposes career authority conflicts and unresolved blocking facts", () => {
  const age = 420;
  const currentCareer = initializeCareerState({
    id: "career_retired",
    employmentStatus: "retired",
    effectiveFromAgeInMonths: age
  });
  const oldCareer = initializeCareerState({
    id: "career_employed",
    employmentStatus: "employed",
    effectiveFromAgeInMonths: age - 120
  });
  const ledger = initializeFinancialLedger({
    id: "ledger-conflict",
    asOfAgeInMonths: age,
    openingPosition: {
      incomeSources: [{
        id: "salary-old-job",
        type: "salary",
        displayName: "旧工作工资",
        monthlyNetAmountWan: 1,
        accrualPolicy: "monthly",
        activeFromAgeInMonths: age - 120,
        status: "active",
        linkedCareerStateId: oldCareer.id,
        factStatus: "known",
        evidence: []
      }],
      unresolvedIssues: [{
        id: "issue-blocking",
        code: "CAREER_INCOME_CONFLICT",
        severity: "blocking",
        relatedProposalIds: ["proposal-1"],
        summary: "退休后旧工资仍活跃",
        createdAtAgeInMonths: age
      }]
    }
  });
  const world: WorldStateSnapshot = {
    people: [],
    directionArcs: [],
    pressureArcs: [],
    currentEmploymentStatus: "employed",
    careerStates: [oldCareer, currentCareer],
    currentCareerStateId: currentCareer.id,
    careerRevision: 1,
    committedTransactionIds: [],
    version: 2
  };

  const report = auditWorldHistory({ history: [historyNode({ ageInMonths: age, ledger, world })] });
  const ruleIds = new Set(report.findings.map((issue) => issue.ruleId));
  assert.equal(report.summary.passed, false);
  assert.equal(ruleIds.has("CAREER-002"), true);
  assert.equal(ruleIds.has("CAREER-FIN-001"), true);
  assert.equal(ruleIds.has("FIN-FACT-001"), true);
});

test("risk profiles reserve fresh real-browser acceptance for R4", () => {
  assert.deepEqual(requiredTestLayers("R1").requiredLayers, ["L0", "L1", "L2"]);
  assert.equal(requiredTestLayers("R3").realBrowserRequired, false);
  assert.equal(requiredTestLayers("R4").realBrowserRequired, true);
  assert.equal(requiredTestLayers("R4").requiredLayers.includes("L5"), true);
});

test("browser case aggregation rejects fixture provenance and renders coverage boundary", () => {
  const valid = historyNode({ ageInMonths: 360 });
  const audit = auditBrowserCases({
    generatedAt: "2026-07-18T00:00:00.000Z",
    cases: [
      {
        caseSlug: "real-case",
        scenario: "accept_first",
        dataSource: "real_ai_browser",
        finalState: { testDataSource: "real_ai_browser", history: [valid] }
      },
      {
        caseSlug: "fixture-case",
        dataSource: "deterministic_fixture",
        finalState: { testDataSource: "deterministic_fixture", e2eCase: "fixture", history: [valid] }
      }
    ]
  });

  assert.equal(audit.passed, false);
  assert.equal(audit.provenanceFailures.length, 1);
  assert.match(renderWorldInvariantMarkdown(audit), /本报告只声明/);
  assert.match(renderWorldInvariantMarkdown(audit), /fixture-case/);
});
