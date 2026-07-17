import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(path);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

const testFiles = collectTests("src").sort();
if (!testFiles.length) {
  throw new Error("No TypeScript tests found under src");
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
