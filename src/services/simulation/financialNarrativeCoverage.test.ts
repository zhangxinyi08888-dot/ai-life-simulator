import assert from "node:assert/strict";
import test from "node:test";
import { initializeFinancialLedger } from "../../domain/finance/initializeLedger";
import { detectNarrativeFinancialCoverageIssues } from "./simulationService";

const evidence = [{ source: "accepted_history" as const, reasonCode: "TEST", confidence: 1 }];
const ledger = initializeFinancialLedger({
  id: "coverage", asOfAgeInMonths: 360,
  openingPosition: { cashAccounts: [{ id: "cash_primary", type: "bank_deposit", balanceWan: 10, status: "active", factStatus: "known", evidence }] }
});

test("narrative coverage catches missing property, mortgage and option facts", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你买下了一套公寓并背上房贷，公司还授予了你一批期权。",
    ledger, acceptedEvents: [], ageInMonths: 372
  });
  assert.deepEqual(issues.map((issue) => issue.id), [
    "narrative_coverage_property_372",
    "narrative_coverage_mortgage_372",
    "narrative_coverage_business_holding_372"
  ]);
  assert.ok(issues.every((issue) => issue.severity === "blocking"));
});

test("accepted directional events satisfy narrative coverage", () => {
  const issues = detectNarrativeFinancialCoverageIssues({
    narrativeText: "你买下了一套公寓并背上房贷，公司还授予了你一批期权。",
    ledger,
    acceptedEvents: [{ kind: "asset_purchased" }, { kind: "debt_drawn" }, { kind: "business_option_granted" }],
    ageInMonths: 372
  });
  assert.equal(issues.length, 0);
});
