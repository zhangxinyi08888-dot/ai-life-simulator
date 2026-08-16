import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { summarizeCacheUsage } from "./lib/cache-usage-telemetry.mjs";

function assertCompletedRealBrowserRecord(record, expectedPromptPrefixVersion) {
  if (!record?.passed || record?.dataSource !== "real_ai_browser" || record?.finalState?.testDataSource !== "real_ai_browser" || record?.finalState?.e2eCase) {
    throw new Error(`Cache summary requires a completed real-AI browser record: ${record?.caseSlug || "unknown"}`);
  }
  if (expectedPromptPrefixVersion) {
    const successfulNextNodeTraces = (record.finalState?.generationCallTraces || []).filter((trace) => (
      trace?.outcome === "succeeded" && trace?.promptFamily === "next_node"
    ));
    if (successfulNextNodeTraces.length === 0 || successfulNextNodeTraces.some((trace) => trace.promptPrefixVersion !== expectedPromptPrefixVersion)) {
      throw new Error(`Cache summary requires completed ${expectedPromptPrefixVersion} next-node evidence: ${record?.caseSlug || "unknown"}`);
    }
  }
}

export function summarizeCachePrefixRun(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("Cache summary needs at least one completed record");
  records.forEach((record) => assertCompletedRealBrowserRecord(record, options.expectedPromptPrefixVersion));
  return {
    ...summarizeCacheUsage(records),
    // This is emitted only after every completed record has passed the strict
    // trace-level layout check above. Consumers can therefore require a
    // candidate layout without reconstructing the raw generation traces.
    provenance: {
      expectedPromptPrefixVersion: options.expectedPromptPrefixVersion,
      completedRealBrowserRecordCount: records.length
    }
  };
}

async function loadRecords(root) {
  const casesDir = path.join(root, "cases");
  const names = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(casesDir, name), "utf8"))));
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootArgument = argumentValue("--root");
  const expectedPromptPrefixVersion = argumentValue("--expected-prefix-version");
  if (!rootArgument) throw new Error("usage: node scripts/summarize-cache-prefix-run.mjs --root <run-root> [--expected-prefix-version <version>]");
  const root = path.resolve(rootArgument);
  const telemetry = summarizeCachePrefixRun(await loadRecords(root), { expectedPromptPrefixVersion });
  const outputPath = path.join(root, "cache-telemetry.json");
  await writeFile(outputPath, `${JSON.stringify(telemetry, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, summary: telemetry.summary }, null, 2)}\n`);
}
