import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_RECORD_ROOT = "artifacts/report-invitation-browser/2026-07-17-phase2-real-ai-browser-evaluation";
export const BASELINE_MANIFEST_NAME = "financial-baseline-manifest.json";

const BUSINESS_NARRATIVE = /融资|估值|股权|公司出售|企业出售|公司营收|合同额|A轮|Pre-A/i;
const HIGH_WEALTH_DENIAL = /不是巨额财富|并非巨额财富|没有留下巨额财富/;
const MONEY_TOLERANCE_WAN = 0.11;
const STATIC_DEBT_MIN_NODES = 3;
const HIGH_NET_WORTH_THRESHOLD_WAN = 1000;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function round(value) {
  return Number(value.toFixed(4));
}

function finite(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nodeRef(record, node, nodeIndex) {
  return {
    caseSlug: record.caseSlug,
    nodeIndex,
    age: node.age,
    title: node.title
  };
}

function findStaticDebtRuns(record, history) {
  const runs = [];
  let startIndex = 0;

  for (let index = 1; index <= history.length; index += 1) {
    const startDebt = finite(history[startIndex]?.financialState?.totalDebtWan);
    const nextDebt = finite(history[index]?.financialState?.totalDebtWan, Number.NaN);
    const sameDebt = index < history.length && Math.abs(nextDebt - startDebt) < 0.0001;
    if (sameDebt) continue;

    const nodeCount = index - startIndex;
    if (startDebt > 0 && nodeCount >= STATIC_DEBT_MIN_NODES) {
      runs.push({
        caseSlug: record.caseSlug,
        startNodeIndex: startIndex,
        endNodeIndex: index - 1,
        nodeCount,
        debtWan: startDebt
      });
    }
    startIndex = index;
  }

  return runs;
}

export function analyzeFinancialBaseline(records) {
  const evidence = {
    studentNodes: [],
    coreExpense1_2Nodes: [],
    negativeDisposableNodes: [],
    negativeCashNodes: [],
    negativeCashWithoutDebtNodes: [],
    retiredUnder50Nodes: [],
    businessNarrativeNodes: [],
    positiveBusinessAssetNodes: [],
    netWorthIdentityMismatchNodes: [],
    staticDebtRuns: [],
    highNetWorthDenialCases: []
  };

  let totalNodes = 0;
  let partTimeNodes = 0;
  let positiveDebtCases = 0;
  const businessNarrativeCases = new Set();

  for (const record of records) {
    const history = record.finalState?.history || [];
    totalNodes += history.length;
    if (history.some((node) => finite(node.financialState?.totalDebtWan) > 0)) positiveDebtCases += 1;
    evidence.staticDebtRuns.push(...findStaticDebtRuns(record, history));

    for (const [nodeIndex, node] of history.entries()) {
      const financial = node.financialState || {};
      const description = node.description || "";
      const ref = nodeRef(record, node, nodeIndex);

      if (financial.employmentStatus === "student") evidence.studentNodes.push(ref);
      if (financial.employmentStatus === "part_time") partTimeNodes += 1;
      if (financial.employmentStatus === "retired" && finite(node.age) < 50) {
        evidence.retiredUnder50Nodes.push({ ...ref, employmentStatus: "retired" });
      }
      if (financial.annualCoreExpenseWan === 1.2) evidence.coreExpense1_2Nodes.push(ref);
      if (finite(financial.annualDisposableIncomeWan) < 0) evidence.negativeDisposableNodes.push(ref);
      if (finite(financial.cashWan) < 0) {
        const item = { ...ref, cashWan: financial.cashWan, totalDebtWan: finite(financial.totalDebtWan) };
        evidence.negativeCashNodes.push(item);
        if (finite(financial.totalDebtWan) <= 0) evidence.negativeCashWithoutDebtNodes.push(item);
      }
      if (finite(financial.businessAndOtherAssetsWan) > 0) {
        evidence.positiveBusinessAssetNodes.push({
          ...ref,
          businessAndOtherAssetsWan: financial.businessAndOtherAssetsWan
        });
      }
      if (BUSINESS_NARRATIVE.test(description)) {
        evidence.businessNarrativeNodes.push(ref);
        businessNarrativeCases.add(record.caseSlug);
      }

      const calculatedNetWorthWan = round(
        finite(financial.cashWan)
        + finite(financial.investmentAssetsWan)
        + finite(financial.propertyMarketValueWan)
        + finite(financial.businessAndOtherAssetsWan)
        - finite(financial.totalDebtWan)
      );
      if (
        typeof financial.netWorthWan === "number"
        && Math.abs(calculatedNetWorthWan - financial.netWorthWan) > MONEY_TOLERANCE_WAN
      ) {
        evidence.netWorthIdentityMismatchNodes.push({
          ...ref,
          recordedNetWorthWan: financial.netWorthWan,
          calculatedNetWorthWan
        });
      }
    }

    const finalFinancial = history.at(-1)?.financialState || {};
    const reportText = JSON.stringify(record.finalState?.outcome?.report || {});
    if (
      finite(finalFinancial.netWorthWan) >= HIGH_NET_WORTH_THRESHOLD_WAN
      && HIGH_WEALTH_DENIAL.test(reportText)
    ) {
      evidence.highNetWorthDenialCases.push({
        caseSlug: record.caseSlug,
        finalNetWorthWan: finalFinancial.netWorthWan,
        matchedPhrase: reportText.match(HIGH_WEALTH_DENIAL)?.[0]
      });
    }
  }

  const metrics = {
    caseCount: records.length,
    totalNodes,
    employment: {
      studentNodes: evidence.studentNodes.length,
      partTimeNodes,
      retiredUnder50Nodes: evidence.retiredUnder50Nodes.length
    },
    expenses: {
      annualCoreExpense1_2Nodes: evidence.coreExpense1_2Nodes.length
    },
    cashFlow: {
      negativeDisposableNodes: evidence.negativeDisposableNodes.length,
      negativeCashNodes: evidence.negativeCashNodes.length,
      negativeCashWithoutDebtNodes: evidence.negativeCashWithoutDebtNodes.length
    },
    debt: {
      positiveDebtCases,
      staticDebtRunCases: new Set(evidence.staticDebtRuns.map((run) => run.caseSlug)).size,
      staticDebtRuns: evidence.staticDebtRuns.length
    },
    business: {
      narrativeCases: businessNarrativeCases.size,
      narrativeNodes: evidence.businessNarrativeNodes.length,
      positiveBusinessAssetNodes: evidence.positiveBusinessAssetNodes.length
    },
    accounting: {
      netWorthIdentityMismatchNodes: evidence.netWorthIdentityMismatchNodes.length
    },
    reports: {
      highNetWorthDenialCases: evidence.highNetWorthDenialCases.length
    }
  };

  return { metrics, evidence };
}

export async function loadCorpus(recordRoot) {
  const casesDir = path.join(recordRoot, "cases");
  const caseFiles = (await readdir(casesDir)).filter((file) => file.endsWith(".json")).sort();
  const sourceFiles = [];
  const records = [];

  for (const file of caseFiles) {
    const content = await readFile(path.join(casesDir, file), "utf8");
    const record = JSON.parse(content);
    records.push(record);
    sourceFiles.push({
      file: `cases/${file}`,
      sha256: sha256(content),
      historyNodeCount: record.finalState?.history?.length || 0
    });
  }

  return { records, sourceFiles };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function compareBaselineManifest(manifest, current) {
  const mismatches = [];
  if (stableJson(manifest.sourceFiles) !== stableJson(current.sourceFiles)) {
    mismatches.push("sourceFiles or hashes changed");
  }
  if (stableJson(manifest.expectedMetrics) !== stableJson(current.metrics)) {
    mismatches.push("expectedMetrics changed");
  }
  return mismatches;
}

function parseArgs(argv) {
  const args = { recordRoot: DEFAULT_RECORD_ROOT, writeManifest: false, verify: false, includeEvidence: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write-manifest") args.writeManifest = true;
    else if (arg === "--verify") args.verify = true;
    else if (arg === "--evidence") args.includeEvidence = true;
    else if (arg === "--root") args.recordRoot = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recordRoot = path.resolve(args.recordRoot);
  const manifestPath = path.join(recordRoot, BASELINE_MANIFEST_NAME);
  const { records, sourceFiles } = await loadCorpus(recordRoot);
  const analysis = analyzeFinancialBaseline(records);
  const current = { sourceFiles, metrics: analysis.metrics };

  if (args.writeManifest) {
    const manifest = {
      schemaVersion: 1,
      corpusId: "phase2-real-ai-browser-2026-07-17",
      sourceRevision: "1027dc336f65c49f6b13c90762a57bdc24e7a20a",
      sourceFiles,
      expectedMetrics: analysis.metrics,
      manualReviewContext: {
        confirmedFullTimeStudentNodesApprox: 3,
        note: "46 student 状态节点中，人工复核约 3 个属于真实全日制学生；该判断用于人工验收，不由关键词自动分类。"
      },
      metricPolicy: {
        staticDebtMinimumConsecutiveNodes: STATIC_DEBT_MIN_NODES,
        highNetWorthThresholdWan: HIGH_NET_WORTH_THRESHOLD_WAN,
        moneyToleranceWan: MONEY_TOLERANCE_WAN
      }
    };
    await writeFile(manifestPath, stableJson(manifest), "utf8");
  }

  if (args.verify) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const mismatches = compareBaselineManifest(manifest, current);
    if (mismatches.length > 0) {
      throw new Error(`Financial baseline verification failed: ${mismatches.join("; ")}`);
    }
  }

  const output = {
    corpusId: "phase2-real-ai-browser-2026-07-17",
    verification: args.verify ? "passed" : "not_requested",
    metrics: analysis.metrics
  };
  if (args.includeEvidence) output.evidence = analysis.evidence;
  process.stdout.write(stableJson(output));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
