import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFinancialExpenseClauseBlindPacket,
  financialExpenseClauseBlindSourceSha256
} from "./lib/financial-expense-clause-blind-packet.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const fixturePath = path.join(
  projectRoot,
  "src/domain/finance/fixtures/financial-expense-clause-binding-gold-v1.json"
);
const fixtureBytes = await readFile(fixturePath);
const corpus = JSON.parse(fixtureBytes.toString("utf8"));
const packet = buildFinancialExpenseClauseBlindPacket({
  corpus,
  sourceSha256: financialExpenseClauseBlindSourceSha256(corpus)
});
const serialized = `${JSON.stringify(packet, null, 2)}\n`;
const outputFlagIndex = process.argv.indexOf("--output");
if (outputFlagIndex >= 0) {
  const outputPath = process.argv[outputFlagIndex + 1];
  if (!outputPath) throw new Error("--output requires a file path");
  await writeFile(path.resolve(outputPath), serialized, "utf8");
} else {
  process.stdout.write(serialized);
}
