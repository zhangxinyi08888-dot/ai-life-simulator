import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const simulationSource = readFileSync(new URL("../../services/simulation/simulationService.ts", import.meta.url), "utf8");
const promptSource = readFileSync(new URL("../../services/simulation/prompts.ts", import.meta.url), "utf8");

test("M7 gate: production nodes use the authoritative domain transaction as the only balance writer", () => {
  assert.equal((simulationSource.match(/attachFinancialProgress\(\{/g) || []).length, 0);
  assert.equal((simulationSource.match(/attachFinancialShadow\(\{/g) || []).length, 0);
  assert.equal((simulationSource.match(/commitAuthoritativeFinancialProgress\(\{/g) || []).length, 2);
  assert.match(simulationSource, /financialLedgerMode: "authoritative"/);
  assert.match(simulationSource, /domainTransactionAlreadyCommitted: true/);
  assert.match(simulationSource, /liquidityPolicy: "auto_shortfall_debt"/);
  assert.doesNotMatch(simulationSource, /rawNode\?\.financialSignals|rawNode\?\.financialChange/);
  assert.doesNotMatch(simulationSource, /inferFinancialSignalsFromNarrative|applyFinancialSignals|applyFinancialChange/);
  assert.doesNotMatch(simulationSource, /runFinancialShadowTransition|adaptLegacyFinancialSignalsToProposals/);
});

test("M7 gate: model contract proposes directional events instead of aggregate balances", () => {
  const nextNodeContract = promptSource.slice(promptSource.indexOf("export function buildNextNodePrompt"));
  assert.match(nextNodeContract, /financialEventProposals 必须放在返回 JSON 顶层/);
  assert.match(nextNodeContract, /business_financing_recorded/);
  assert.match(nextNodeContract, /employmentStatus 不属于财务 Proposal/);
  assert.doesNotMatch(nextNodeContract, /financialSignals 必须放在返回 JSON 顶层/);
  assert.doesNotMatch(nextNodeContract, /personalDebtChangeWan 只记录/);
});
