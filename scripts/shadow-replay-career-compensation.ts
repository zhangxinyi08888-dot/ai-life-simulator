import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auditCareerCompensationHistory, projectEducationHistoryWithCareerCompensation } from "../src/domain/finance/shadowCareerCompensationAudit";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runRoot = argument("--run-root");
if (!runRoot) throw new Error("Usage: pnpm shadow:career-compensation -- --run-root <221-artifact-root>");

const inventory = JSON.parse(readFileSync(join(runRoot, "complete-corpus.json"), "utf8"));
const slugs: string[] = Array.isArray(inventory)
  ? inventory.map((item) => item.caseSlug || item.slug).filter(Boolean)
  : Array.isArray(inventory.cases)
    ? inventory.cases.map((item: Record<string, unknown>) => item.caseSlug || item.slug).filter((value: unknown): value is string => typeof value === "string")
    : Object.keys(inventory.cases || {}).length > 0
    ? Object.keys(inventory.cases)
    : ["real-career-first", "real-education-second", "real-relationship-second", "real-venture-first", "real-natural-lifespan"];
const cases = [];
let aggregateNodeCount = 0;
for (const caseSlug of slugs) {
  try {
    const caseFile = JSON.parse(readFileSync(join(runRoot, "cases", caseSlug, "case.json"), "utf8"));
    const finalSnapshotFile = caseFile.snapshots.at(-1)?.file;
    const finalSnapshot = JSON.parse(readFileSync(join(runRoot, "cases", caseSlug, finalSnapshotFile), "utf8"));
    const nodes = finalSnapshot.storage?.history || [];
    const metrics = auditCareerCompensationHistory(nodes);
    aggregateNodeCount += metrics.nodeCount;
    cases.push({
      caseSlug,
      metrics,
      ...(caseSlug === "real-education-second"
        ? { educationProjection: projectEducationHistoryWithCareerCompensation(nodes) }
        : {})
    });
  } catch (error) {
    cases.push({ caseSlug, error: error instanceof Error ? error.message : String(error) });
  }
}
process.stdout.write(`${JSON.stringify({
  mode: "read_only_shadow_replay",
  policyId: "career_compensation_cn_v1",
  aggregateNodeCount,
  cases
}, null, 2)}\n`);
