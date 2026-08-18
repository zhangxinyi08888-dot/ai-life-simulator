import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CareerCompensationValidationCases } from "../src/domain/finance/careerCompensationValidationHarness";
import { runCareerCompensationAdditionalValidation } from "../src/domain/finance/careerCompensationValidationHarness";

const root = resolve(import.meta.dirname, "..");
const inputPath = resolve(root, "test-data/career-compensation-authority/cases.v1.json");
const outputPath = resolve(root, "test-data/career-compensation-authority/latest-result.json");
const cases = JSON.parse(await readFile(inputPath, "utf8")) as CareerCompensationValidationCases;
const report = runCareerCompensationAdditionalValidation(cases);

if (!report.allPassed) {
  throw new Error("CAREER_COMPENSATION_ADDITIONAL_VALIDATION_FAILED");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`CAREER_COMPENSATION_VALIDATION=PASS`);
console.log(`BOUNDARY_CASES=${report.summary.boundaryCases}`);
console.log(`METAMORPHIC_CASES=${report.summary.metamorphicCases}`);
console.log(`MUTATION_GUARDS=${report.summary.mutationGuards}`);
console.log(`RESULT=${outputPath}`);
