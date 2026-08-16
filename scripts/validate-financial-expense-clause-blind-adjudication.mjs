import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  financialExpenseClauseBlindSourceSha256,
  validateFinancialExpenseClauseBlindAdjudication
} from "./lib/financial-expense-clause-blind-packet.mjs";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/validate-financial-expense-clause-blind-adjudication.mjs <completed-packet.json>");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureBytes = await readFile(path.join(
  scriptDir,
  "../src/domain/finance/fixtures/financial-expense-clause-binding-gold-v1.json"
));
const corpus = JSON.parse(fixtureBytes.toString("utf8"));
const packet = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
const result = validateFinancialExpenseClauseBlindAdjudication({
  packet,
  corpus,
  sourceSha256: financialExpenseClauseBlindSourceSha256(corpus)
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
