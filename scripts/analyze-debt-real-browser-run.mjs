import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const recordRoot = path.resolve(process.argv[2] || "artifacts/financial-debt-browser/2026-07-19-real-debt-routes");
const casesDir = path.join(recordRoot, "cases");
const files = (await readdir(casesDir)).filter((file) => file.endsWith(".json")).sort();
const cases = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(casesDir, file), "utf8"))));
const requiredSlugs = ["manageable-mortgage", "distress-to-default-risk", "debt-arc-health-preemption"];
const bySlug = new Map(cases.map((item) => [item.slug, item]));
const aggregate = {
  schemaVersion: 1,
  recordRoot,
  generatedAt: new Date().toISOString(),
  requiredSlugs,
  missingSlugs: requiredSlugs.filter((slug) => !bySlug.has(slug)),
  passedSlugs: requiredSlugs.filter((slug) => bySlug.get(slug)?.passed),
  failedSlugs: requiredSlugs.filter((slug) => bySlug.has(slug) && !bySlug.get(slug)?.passed),
  cases: requiredSlugs.map((slug) => {
    const item = bySlug.get(slug);
    return item ? { slug, passed: item.passed, validation: item.validation, screenshotPath: item.screenshotPath } : { slug, passed: false, missing: true };
  })
};
aggregate.passed = aggregate.missingSlugs.length === 0 && aggregate.failedSlugs.length === 0;
await writeFile(path.join(recordRoot, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
console.log(JSON.stringify(aggregate, null, 2));
if (!aggregate.passed) process.exitCode = 1;
