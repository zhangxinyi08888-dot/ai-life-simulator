import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { generateFinalOutcome } from "../src/services/finalOutcome/finalOutcomeService.ts";
import { callDeepSeekJson } from "../src/utils/deepseek.ts";
import {
  collectFinalFinancialNarrativeIssues,
  deriveFinalFinancialNarrativeAuthority
} from "../src/utils/finalFinancialNarrativeAuthority.ts";
import { collectFinalOutcomeQualityIssues } from "../src/utils/finalOutcomeQuality.ts";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadConfig(envFile) {
  if (envFile) loadDotenv({ path: path.resolve(envFile), quiet: true });
  loadDotenv({ path: path.resolve(".env.local"), quiet: true });
  loadDotenv({ path: path.resolve(".env"), quiet: true });
  const apiKey = process.env.VITE_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("missing VITE_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY");
  return {
    apiKey,
    baseUrl: process.env.VITE_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.VITE_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
  };
}

function reportIndexes(outcome) {
  const values = [];
  const report = outcome.report;
  for (const item of report.executiveSummary.patterns) values.push(...item.keyMomentIndexes);
  for (const field of ["repeatedPatterns", "patternEffects", "futureTrends", "patternsToKeep", "patternsToAdjust"]) {
    for (const item of report[field]) values.push(...item.keyMomentIndexes);
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

function phaseCoverage(history, indexes) {
  const ages = indexes.map((index) => (history[index].ageInMonths ?? history[index].age * 12) / 12);
  return {
    before40: ages.some((age) => age < 40),
    age40To59: ages.some((age) => age >= 40 && age < 60),
    age60Plus: ages.some((age) => age >= 60)
  };
}

function markdownReport(report) {
  const lines = [
    "# 长寿终局报告定向复放",
    "",
    `- 源 case SHA-256：\`${report.sourceCaseSha256}\``,
    `- 模型：\`${report.model}\``,
    `- 重复次数：${report.runs.length}`,
    "",
    "| 次数 | Provider 调用 | 质量修复 | 财务修复 | 不同历史索引 | 40岁前 | 40–59岁 | 60岁后 | 质量问题 | 财务问题 |",
    "|---:|---:|---|---|---:|---|---|---|---:|---:|",
    ...report.runs.map((run) => `| ${run.runNumber} | ${run.providerCalls.length} | ${run.meta.finalOutcomeQualityRepairTriggered ? "是" : "否"} | ${run.meta.financialClaimRepairTriggered ? "是" : "否"} | ${run.referencedIndexes.length} | ${run.phaseCoverage.before40 ? "是" : "否"} | ${run.phaseCoverage.age40To59 ? "是" : "否"} | ${run.phaseCoverage.age60Plus ? "是" : "否"} | ${run.qualityIssues.length} | ${run.financialIssues.length} |`),
    "",
    ...report.runs.flatMap((run) => run.outcome ? [
      `## 第 ${run.runNumber} 次`,
      "",
      `- 标题：${run.outcome.share.viralTitle}`,
      `- 模式：${run.outcome.report.executiveSummary.patterns.map((item) => item.name).join("；")}`,
      `- 引用索引：${run.referencedIndexes.join("、")}`,
      `- 最终人生判断：${run.outcome.report.finalLifeReading.finalSentence}`,
      ""
    ] : [
      `## 第 ${run.runNumber} 次`,
      "",
      `- 生成失败：${run.failedAttempts.at(-1)?.message || "未知错误"}`,
      ""
    ])
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const inputPath = path.resolve(argumentValue("--input") || "artifacts/report-invitation-browser/2026-08-11T00-20-56+08-00-five-ending-routes/cases/real-custom-lifespan.json");
  const outputDir = path.resolve(argumentValue("--output") || "artifacts/final-outcome-quality-replay/2026-08-12-long-life-r1");
  const repeat = Number(argumentValue("--repeat") || 3);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error("--repeat must be an integer from 1 to 5");
  const config = loadConfig(argumentValue("--env-file"));
  const sourceText = await readFile(inputPath, "utf8");
  const source = JSON.parse(sourceText);
  const state = source.finalState;
  if (!state?.userData || !Array.isArray(state.history) || state.history.length === 0) throw new Error("input case has no finalState history");
  const closureType = state.outcome?.meta?.closureType || "mortality";
  const report = {
    schemaVersion: 1,
    dataSource: "archived_history_real_provider_final_outcome_only",
    sourceCase: path.relative(process.cwd(), inputPath),
    sourceCaseSha256: createHash("sha256").update(sourceText).digest("hex"),
    startedAt: new Date().toISOString(),
    model: config.model,
    historyLength: state.history.length,
    closureType,
    runs: []
  };
  await mkdir(outputDir, { recursive: true });

  for (let index = 0; index < repeat; index += 1) {
    const providerCalls = [];
    const failedAttempts = [];
    const generationAttempts = 1;
    let outcome;
    try {
      outcome = await generateFinalOutcome({
        userData: state.userData,
        answers: state.answers || [],
        history: state.history,
        currentAttributes: state.currentAttributes,
        context: { closureType }
      }, {
        callAiJson: async (prompt) => {
          const result = await callDeepSeekJson(config, prompt);
          providerCalls.push({
            generationAttempt: 1,
            providerRequestId: result.providerRequestId,
            model: result.model,
            usage: result.usage,
            responseText: result.text
          });
          return result;
        }
      });
    } catch (error) {
      failedAttempts.push({
        generationAttempt: 1,
        code: error && typeof error === "object" ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (!outcome) {
      const run = {
        runNumber: index + 1,
        generationAttempts,
        failedAttempts,
        providerCalls,
        referencedIndexes: [],
        phaseCoverage: { before40: false, age40To59: false, age60Plus: false },
        qualityIssues: [{ code: "FINAL_REPORT_GENERATION_REJECTED", path: "$", message: failedAttempts.at(-1)?.message || "生成失败" }],
        financialIssues: [],
        meta: {},
        outcome: null
      };
      report.runs.push(run);
      await writeFile(path.join(outputDir, `outcome-${index + 1}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
      continue;
    }
    const qualityIssues = collectFinalOutcomeQualityIssues({ data: outcome, history: state.history, closureType });
    const authority = deriveFinalFinancialNarrativeAuthority(state.history);
    const financialIssues = collectFinalFinancialNarrativeIssues({ outcome, authority });
    const referencedIndexes = reportIndexes(outcome);
    const run = {
      runNumber: index + 1,
      generationAttempts,
      failedAttempts,
      providerCalls,
      referencedIndexes,
      phaseCoverage: phaseCoverage(state.history, referencedIndexes),
      qualityIssues,
      financialIssues,
      meta: outcome.meta,
      outcome
    };
    report.runs.push(run);
    await writeFile(path.join(outputDir, `outcome-${index + 1}.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }

  report.completedAt = new Date().toISOString();
  report.passed = report.runs.every((run) => Boolean(run.outcome)
    && run.providerCalls.length <= 2
    && run.qualityIssues.length === 0
    && run.financialIssues.length === 0
    && run.referencedIndexes.length >= 3
    && Object.values(run.phaseCoverage).every(Boolean));
  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "review.md"), markdownReport(report), "utf8");
  process.stdout.write(`${JSON.stringify({ outputDir, passed: report.passed, runs: report.runs.map((run) => ({
    runNumber: run.runNumber,
    providerCallCount: run.providerCalls.length,
    qualityRepairTriggered: run.meta?.finalOutcomeQualityRepairTriggered,
    financialRepairTriggered: run.meta?.financialClaimRepairTriggered,
    referencedIndexCount: run.referencedIndexes.length,
    phaseCoverage: run.phaseCoverage,
    qualityIssueCount: run.qualityIssues.length,
    financialIssueCount: run.financialIssues.length
  })) }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
