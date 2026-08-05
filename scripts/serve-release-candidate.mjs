#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import {
  assertCandidateMatchesRepository,
  loadCandidateManifest,
  releaseRuntimeEnvFromCandidate
} from "./lib/release-candidate.mjs";

function parseArgs(argv) {
  const args = { host: "127.0.0.1", port: "5174" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    args[key.slice(2)] = argv[++index];
  }
  if (!args.candidate) throw new Error("Missing --candidate");
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return { ...args, port: String(port) };
}

const args = parseArgs(process.argv.slice(2));
const { manifest } = await loadCandidateManifest(args.candidate);
await assertCandidateMatchesRepository(manifest);
const runtimeEnv = releaseRuntimeEnvFromCandidate(manifest);
const launchUrl = new URL(runtimeEnv.BASE_PATH, `http://${args.host}:${args.port}`).href;
process.stdout.write(`${JSON.stringify({
  ok: true,
  candidateId: manifest.candidateId,
  sourceCommit: manifest.sourceCommit,
  launchUrl
}, null, 2)}\n`);

const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", args.host, "--port", args.port], {
  cwd: process.cwd(),
  env: { ...process.env, ...runtimeEnv },
  stdio: "inherit"
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
