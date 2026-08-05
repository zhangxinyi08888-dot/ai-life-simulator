#!/usr/bin/env node
import process from "node:process";
import { prepareReleaseCandidate } from "./lib/release-candidate.mjs";

function parseArgs(argv) {
  const args = { mode: "certify" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++index];
  }
  if (!args["run-id"]) throw new Error("Missing --run-id");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await prepareReleaseCandidate({
  runId: args["run-id"],
  root: args.root,
  validationMode: args.mode,
  launchUrl: args["launch-url"],
  evidenceUri: args["evidence-uri"]
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: result.manifest.validationMode,
  runId: result.manifest.runId,
  evidenceRoot: result.manifest.evidenceRoot,
  manifestPath: result.manifestPath,
  sourceCommit: result.manifest.sourceCommit,
  runtimeFingerprint: result.manifest.runtimeFingerprint,
  collectorFingerprint: result.manifest.collectorFingerprint
}, null, 2)}\n`);
