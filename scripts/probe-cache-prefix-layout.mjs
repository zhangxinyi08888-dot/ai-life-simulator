import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";
import { LIFE_EVENTS_DATABASE } from "../src/data/lifeEvents.ts";
import { initializeFinancialLedger } from "../src/domain/finance/index.ts";
import { buildNextNodePromptRequest } from "../src/services/simulation/prompts.ts";
import { callDeepSeekJson } from "../src/utils/deepseek.ts";
import { buildStoryContextPack } from "../src/utils/storyContext.ts";

const SCHEMA_VERSION = 1;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
}

function probeUserData() {
  return {
    birthday: "1995-05-20",
    gender: "女",
    regressionAge: 24,
    regressionSituation: "工作稳定但长期加班，想试着转向更有成长空间的产品工作，同时不愿透支健康。",
    regressionChoices: "先在当前城市积累产品能力，再判断是否接受更高风险的新机会。",
    coreStoryFocus: "career",
    milestoneCareer: "毕业后做过两年运营，熟悉客户现场，也担心自己只剩下执行经验。",
    milestoneRelationship: "曾因加班忽略过一段关系，现在希望保留稳定的私人生活。"
  };
}

function probeAnswers() {
  return [
    { id: 1, question: "当时最大的现实限制是什么？", answer: "存款不多，父母希望我先保留稳定收入，身体也开始出现睡眠问题。" },
    { id: 2, question: "最想改变什么？", answer: "不想再只接重复执行工作，希望能承担产品判断，但不愿靠无限加班证明自己。" },
    { id: 3, question: "有哪些不可放弃的关系或责任？", answer: "每周要陪父母处理一次家庭事务，也要留出与伴侣相处的时间。" }
  ];
}

function probeHistory(count) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      age: 24 + Math.floor(index / 2),
      ageInMonths: 288 + index * 6,
      stage: "职业转换观察期",
      title: `缓存探针阶段 ${number}`,
      description: `第 ${number} 阶段，你在客户现场与产品团队之间协调需求，逐渐发现反复救火正在挤压睡眠。父母提醒你保留稳定收入，伴侣也希望周末不再被临时工作占满。你开始把一次用户访谈和一个小范围方案复盘写下来，准备验证自己是否适合产品方向。`,
      selectedChoice: number % 2 === 0 ? "保留现岗位并承担一个小范围产品试点" : "先完成客户交付，再整理产品观察笔记",
      attributes: { happiness: 48 + (number % 3), intelligence: 62, wealth: 45, relation: 56, health: 46 - (number % 2) },
      choices: [
        { id: "A", text: "保留现岗位并承担一个小范围产品试点", impactSummary: "稳中试错", decisionIntent: "career:pilot:product_discovery" },
        { id: "B", text: "先完成客户交付，再整理产品观察笔记", impactSummary: "积累证据", decisionIntent: "career:document:product_observation" },
        { id: "C", text: "暂缓额外任务，先恢复规律作息", impactSummary: "守住健康", decisionIntent: "health:protect:sleep_routine" }
      ],
      isEndingNode: false
    };
  });
}

function probeFinancialLedger() {
  const initial = initializeFinancialLedger({ id: "cache_probe_ledger", asOfAgeInMonths: 312 });
  return {
    ...initial,
    cashAccounts: [{ id: "cache_probe_cash", type: "cash", balanceWan: 8.5, status: "active", factStatus: "known" }]
  };
}

/** Build a provider-shaped prompt series whose system prefix is identical. */
export function buildCacheProbeRequests(layout, callCount = 3) {
  if (!["v1", "v2"].includes(layout)) throw new Error(`unknown cache probe layout: ${layout}`);
  if (!Number.isInteger(callCount) || callCount < 3) throw new Error("cache probe needs at least three calls");
  const event = LIFE_EVENTS_DATABASE.find((item) => item.intent.type === "career_venture_pressure");
  if (!event) throw new Error("cache probe requires career_venture_pressure event");
  const userData = probeUserData();
  const answers = probeAnswers();
  const ledger = probeFinancialLedger();
  const requests = Array.from({ length: callCount }, (_, index) => {
    const history = probeHistory(6 + index);
    return buildNextNodePromptRequest({
      userData,
      answers,
      history,
      storyContext: buildStoryContextPack(userData, answers, history),
      currentAttributes: { happiness: 49, intelligence: 62, wealth: 45, relation: 56, health: 45 },
      currentFinancialState: {
        cashWan: 8.5,
        investmentAssetsWan: 0,
        propertyMarketValueWan: 0,
        businessAndOtherAssetsWan: 0,
        totalDebtWan: 0,
        annualAfterTaxIncomeWan: 18,
        annualDisposableIncomeWan: 6,
        annualCoreExpenseWan: 12,
        netWorthWan: 8.5,
        employmentStatus: "employed"
      },
      currentFinancialLedger: ledger,
      selectedDecision: history.at(-1)?.selectedChoice || "保留现岗位并承担一个小范围产品试点",
      selectedOutcomeId: "continue_venture_with_guards",
      eventSeed: event
    }, { cacheAwarePromptV2: layout === "v2" });
  });
  if (requests.some((request) => typeof request === "string")) throw new Error("cache probe requires segmented prompts");
  const prefixes = requests.map((request) => request.systemPrefix);
  if (!prefixes.every((prefix) => prefix === prefixes[0])) throw new Error("cache probe system prefix changed across requests");
  return requests;
}

export function summarizeCacheProbe(samples) {
  const usageSamples = samples.filter((sample) => finite(sample?.usage?.promptTokens) !== undefined);
  const sum = (field, subset = usageSamples) => subset.reduce((total, sample) => total + (finite(sample.usage?.[field]) ?? 0), 0);
  const rate = (subset) => {
    const hit = sum("cacheHitTokens", subset);
    const miss = sum("cacheMissTokens", subset);
    return hit + miss > 0 ? hit / (hit + miss) : undefined;
  };
  const postFirst = usageSamples.slice(1);
  return {
    callCount: samples.length,
    usageCallCount: usageSamples.length,
    promptTokens: sum("promptTokens"),
    cacheHitTokens: sum("cacheHitTokens"),
    cacheMissTokens: sum("cacheMissTokens"),
    completionTokens: sum("completionTokens"),
    inputCacheHitRate: rate(usageSamples),
    postFirstInputCacheHitRate: rate(postFirst),
    firstTokenP95Ms: usageSamples.length
      ? [...usageSamples].map((sample) => sample.firstTokenMs).filter((value) => finite(value) !== undefined).sort((a, b) => a - b).at(-1)
      : undefined
  };
}

export async function runCacheProbe({ layout, call, callCount = 3, now = () => Date.now() }) {
  const requests = buildCacheProbeRequests(layout, callCount);
  const samples = [];
  for (const [index, request] of requests.entries()) {
    const startedAt = now();
    let firstTokenAt;
    const result = await call(request, () => {
      if (firstTokenAt === undefined) firstTokenAt = now();
    });
    const completedAt = now();
    if (!result?.usage) throw new Error(`cache probe call ${index + 1} did not return provider usage`);
    samples.push({
      callNumber: index + 1,
      promptPrefixVersion: layout === "v2" ? "next_node_cache_prefix_v2_reference_context_r4" : "next_node_cache_prefix_v1_full_context_system_r1",
      usage: result.usage,
      firstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      durationMs: completedAt - startedAt
    });
  }
  return { layout, samples, summary: summarizeCacheProbe(samples) };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readLayouts(value) {
  const layouts = (value || "v1,v2").split(",").map((item) => item.trim()).filter(Boolean);
  if (layouts.length === 0 || layouts.some((layout) => !["v1", "v2"].includes(layout))) {
    throw new Error("--layouts must be v1, v2, or v1,v2");
  }
  return [...new Set(layouts)];
}

function loadEnvFile(file) {
  if (file) loadDotenv({ path: path.resolve(file), quiet: true });
}

function apiConfigFromEnvironment(envFile) {
  // An explicit file lets a separate, known local test configuration be used
  // without copying credentials into this worktree or printing them.
  loadEnvFile(envFile);
  loadDotenv({ path: path.resolve(".env.local"), quiet: true });
  loadDotenv({ path: path.resolve(".env"), quiet: true });
  const apiKey = process.env.VITE_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("missing VITE_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY for real cache probe");
  return {
    apiKey,
    baseUrl: process.env.VITE_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.VITE_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const layouts = readLayouts(argumentValue("--layouts"));
  const callCount = Number(argumentValue("--calls") || 3);
  const startedAt = new Date().toISOString();
  const config = apiConfigFromEnvironment(argumentValue("--env-file"));
  const results = [];
  for (const layout of layouts) {
    results.push(await runCacheProbe({
      layout,
      callCount,
      call: (prompt) => callDeepSeekJson(config, prompt)
    }));
  }
  const outputPath = path.resolve(argumentValue("--output") || path.join("artifacts", "cache-prefix-probes", `${timestampForPath()}-v2-reference-context.json`));
  await mkdir(path.dirname(outputPath), { recursive: true });
  const report = {
    schemaVersion: SCHEMA_VERSION,
    dataSource: "real_ai_api",
    startedAt,
    completedAt: new Date().toISOString(),
    model: config.model,
    layouts: results
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, summaries: results.map(({ layout, summary }) => ({ layout, ...summary })) }, null, 2)}\n`);
}
