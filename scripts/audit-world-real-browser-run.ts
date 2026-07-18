import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditBrowserCases, renderWorldInvariantMarkdown, type BrowserCaseForWorldAudit } from "../src/domain/worldAudit";

function parseArgs(argv: string[]): { root: string; dryRun: boolean } {
  let root = "";
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") root = argv[index + 1] || "";
    if (argv[index] === "--dry-run") dryRun = true;
  }
  if (!root) throw new Error("必须提供 --root <真实浏览器运行目录>");
  return { root: path.resolve(root), dryRun };
}

const args = parseArgs(process.argv.slice(2));
const casesDirectory = path.join(args.root, "cases");
const caseFiles = (await readdir(casesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
if (!caseFiles.length) throw new Error(`没有在 ${casesDirectory} 找到 case JSON`);

const records: BrowserCaseForWorldAudit[] = [];
for (const name of caseFiles) {
  records.push(JSON.parse(await readFile(path.join(casesDirectory, name), "utf8")) as BrowserCaseForWorldAudit);
}

const audit = auditBrowserCases({ cases: records });
if (args.dryRun) {
  process.stdout.write(`${JSON.stringify({
    root: args.root,
    caseCount: audit.caseCount,
    nodeCount: audit.nodeCount,
    passed: audit.passed,
    blocking: audit.blocking,
    warning: audit.warning,
    provenanceFailures: audit.provenanceFailures
  }, null, 2)}\n`);
} else {
  await writeFile(path.join(args.root, "world-invariant-report.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await writeFile(path.join(args.root, "world-invariant-report.md"), renderWorldInvariantMarkdown(audit), "utf8");
  process.stdout.write(`${path.join(args.root, "world-invariant-report.json")}\n`);
  process.stdout.write(`${path.join(args.root, "world-invariant-report.md")}\n`);
}

process.exitCode = audit.passed ? 0 : 1;
