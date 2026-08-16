import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REVIEW_SCHEMA_VERSION = 2;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function renderAge(node) {
  const ageInMonths = Number(node?.ageInMonths);
  if (Number.isFinite(ageInMonths)) {
    const years = Math.floor(ageInMonths / 12);
    const months = ageInMonths % 12;
    return months ? `${years} 岁 ${months} 个月` : `${years} 岁`;
  }
  return Number.isFinite(Number(node?.age)) ? `${node.age} 岁` : "年龄未记录";
}

function cleanInline(value) {
  return String(value ?? "未记录").replace(/\r?\n/g, " ").trim() || "未记录";
}

function quoteBlock(value) {
  return String(value ?? "（无正文）")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.length > 0 ? `> ${line}` : ">")
    .join("\n");
}

function sampleIndexes(length, count) {
  if (!Number.isInteger(count) || count < 1 || count > length) {
    throw new Error(`Cannot select ${count} blind-review nodes from ${length} history nodes`);
  }
  return Array.from({ length: count }, (_, index) => (
    Math.floor(((index + 1) * (length + 1)) / (count + 1)) - 1
  ));
}

function assertEligibleRecord(record, options = {}) {
  const history = record?.finalState?.history;
  const verifiedShortSample = options.allowShortSample === true
    && record?.shortSample?.complete === true
    && record?.validation?.realAiBrowserSource === true
    && record?.validation?.allStoryBodiesPresent === true
    && record?.validation?.allDisplayedChoicesPreserved === true
    && record?.validation?.allUserChoicesPreserved === true
    && record?.validation?.allAttributesPreserved === true
    && record?.validation?.allFinancialStatesPreserved === true;
  if ((!record?.passed && !verifiedShortSample)
    || record?.dataSource !== "real_ai_browser"
    || record?.finalState?.testDataSource !== "real_ai_browser"
    || record?.finalState?.e2eCase) {
    throw new Error(`Blind review requires a completed real-AI browser record: ${record?.caseSlug || "unknown"}`);
  }
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error(`Blind review record has no accepted history: ${record.caseSlug}`);
  }
  if (options.expectedPromptPrefixVersion) {
    const successfulNextNodeTraces = (record.finalState.generationCallTraces || []).filter((trace) => (
      trace?.outcome === "succeeded"
      && trace?.promptFamily === "next_node"
    ));
    if (successfulNextNodeTraces.length === 0 || successfulNextNodeTraces.some((trace) => trace.promptPrefixVersion !== options.expectedPromptPrefixVersion)) {
      throw new Error(`Blind review requires completed ${options.expectedPromptPrefixVersion} next-node evidence: ${record.caseSlug}`);
    }
  }
}

/**
 * Select an evenly distributed, deterministically shuffled set of accepted
 * nodes. Source labels are retained only in the audit manifest, never in the
 * reviewer-facing packet.
 */
export function selectBlindReviewSamples(records, sampleCount = 10, options = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("Blind review needs at least one completed record");
  if (!Number.isInteger(sampleCount) || sampleCount < records.length) {
    throw new Error(`Sample count must be an integer >= route count (${records.length})`);
  }

  const orderedRecords = [...records].sort((left, right) => String(left.caseSlug).localeCompare(String(right.caseSlug)));
  orderedRecords.forEach((record) => assertEligibleRecord(record, options));
  const base = Math.floor(sampleCount / orderedRecords.length);
  const remainder = sampleCount % orderedRecords.length;
  const sourceSamples = [];

  orderedRecords.forEach((record, recordIndex) => {
    const count = base + (recordIndex < remainder ? 1 : 0);
    const history = record.finalState.history;
    for (const historyIndex of sampleIndexes(history.length, count)) {
      sourceSamples.push({
        sourceCaseSlug: record.caseSlug,
        sourceNodeNumber: historyIndex + 1,
        node: history[historyIndex],
        previousNode: history[historyIndex - 1]
      });
    }
  });

  return sourceSamples
    .sort((left, right) => digest(`${left.sourceCaseSlug}:${left.sourceNodeNumber}`).localeCompare(digest(`${right.sourceCaseSlug}:${right.sourceNodeNumber}`)))
    .map((sample, index) => ({
      ...sample,
      blindId: `N${String(index + 1).padStart(2, "0")}`
    }));
}

function renderState(node) {
  const attributes = node?.attributes || {};
  const financial = node?.financialState;
  const lines = [
    `- 五维：幸福 ${cleanInline(attributes.happiness)}；才智 ${cleanInline(attributes.intelligence)}；财富 ${cleanInline(attributes.wealth)}；人际 ${cleanInline(attributes.relation)}；健康 ${cleanInline(attributes.health)}`
  ];
  if (financial) {
    lines.push(`- 财务快照：净资产 ${cleanInline(financial.netWorthWan)} 万；现金 ${cleanInline(financial.cashWan)} 万；总负债 ${cleanInline(financial.totalDebtWan)} 万；就业 ${cleanInline(financial.employmentStatus)}；收入稳定性 ${cleanInline(financial.incomeStability)}`);
  } else {
    lines.push("- 财务快照：本样本没有可用的结构化财务快照（不要仅因缺失而扣分）。");
  }
  return lines;
}

function renderChoices(choices) {
  if (!Array.isArray(choices) || choices.length === 0) return ["- （本节点没有普通选择，记录为异常并说明原因。）"];
  return choices.map((choice, index) => `${index + 1}. ${cleanInline(choice?.text)}`);
}

export function renderBlindReviewPacket(samples) {
  const lines = [
    "# 10 节点人工盲评包",
    "",
    "> 此文件刻意不标注路线、版本、缓存命中率或实现方式。请在阅读审阅模板之前独立判断，不要查看同目录的审计映射文件。",
    "",
    "## 审阅任务",
    "",
    "- 对每个节点判断：前情与正文是否连贯、现实与结构化状态是否一致、三个选择是否具体且有真实取舍、文风是否自然而非模板化。",
    "- 每个节点都必须写出单独结论：通过、需复核或重大问题；不要用缓存命中率替代内容判断。",
    "- 验收条件不是平均分阈值：10 个节点均完成判断，且没有未处置的重大事实冲突、选择失真或叙事失真问题。",
    "",
    "---",
    ""
  ];

  for (const sample of samples) {
    const node = sample.node || {};
    const previous = sample.previousNode;
    lines.push(`## ${sample.blindId}`, "");
    if (previous) {
      lines.push(
        "### 可用前情",
        "",
        `- 上一阶段：${renderAge(previous)} · ${cleanInline(previous.title)}`,
        `- 上一阶段后的实际选择：${cleanInline(previous.selectedChoice)}`,
        "",
        quoteBlock(previous.description),
        ""
      );
    } else {
      lines.push("### 可用前情", "", "- 这是该路线的起始节点；没有更早节点可供比对。", "");
    }
    lines.push(
      "### 当前节点",
      "",
      `- 时间：${renderAge(node)}`,
      `- 阶段：${cleanInline(node.stage)}`,
      `- 标题：${cleanInline(node.title)}`,
      "",
      "#### 正文",
      "",
      quoteBlock(node.description),
      "",
      "#### 当时可选选择",
      "",
      ...renderChoices(node.choices),
      "",
      "#### 结构化现实快照",
      "",
      ...renderState(node),
      "",
      `- 此节点之后的实际选择：${cleanInline(node.selectedChoice)}`,
      "",
      "#### 审阅记录",
      "",
      `- 结论：□ 通过  □ 需复核  □ 重大问题`,
      `- 说明：`,
      "",
      "---",
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderBlindReviewTemplate(samples, packetSha256) {
  const lines = [
    "# 10 节点人工盲评记录",
    "",
    `- 对应审阅包 SHA-256：\`${packetSha256}\``,
    "- 审阅人：",
    "- 审阅日期：",
    "",
    "填写方式：每个节点都填一行。评分用于说明问题严重度，不设平均分硬阈值；任何“需复核”或“重大问题”都必须附证据和可复测的处置说明。重大问题修复后，应重新审阅该节点并更新为最终结论。",
    "",
    "| 节点 | 前情连贯性 (1–5) | 现实/状态一致性 (1–5) | 选择质量 (1–5) | 文风自然性 (1–5) | 结论 | 证据或说明 | 处置/复测依据 |",
    "|---|---:|---:|---:|---:|---|---|---|"
  ];
  for (const sample of samples) {
    lines.push(`| ${sample.blindId} |  |  |  |  | 通过 / 需复核 / 重大问题 |  |  |`);
  }
  lines.push(
    "",
    "## 验收结论",
    "",
    "- [ ] 10 个节点均已逐项填写。",
    "- [ ] 没有未处置的重大问题（若曾有重大问题，已修复并重新审阅对应节点）。",
    "- [ ] 若有需复核项，已写明是否接受、修复后复测，或作为已知风险保留。",
    "",
    "最终结论：□ 通过  □ 暂不通过  □ 需复测",
    ""
  );
  return `${lines.join("\n")}\n`;
}

export function buildBlindReviewArtifacts(records, sampleCount = 10, options = {}) {
  const samples = selectBlindReviewSamples(records, sampleCount, options);
  const packet = renderBlindReviewPacket(samples);
  const packetSha256 = digest(packet);
  return {
    packet,
    template: renderBlindReviewTemplate(samples, packetSha256),
    manifest: {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sampleCount: samples.length,
      expectedPromptPrefixVersion: options.expectedPromptPrefixVersion,
      sourceEligibility: options.allowShortSample ? "completed_or_verified_short_sample" : "completed_real_browser_only",
      packetSha256,
      samples: samples.map((sample) => ({
        blindId: sample.blindId,
        sourceCaseSlug: sample.sourceCaseSlug,
        sourceNodeNumber: sample.sourceNodeNumber,
        nodeSha256: digest(JSON.stringify(sample.node))
      }))
    }
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function loadCompletedRecords(root) {
  const casesDir = path.join(root, "cases");
  const names = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(casesDir, name), "utf8"))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = argumentValue("--root");
  const parsedSampleCount = Number(argumentValue("--samples") || 10);
  if (!root) throw new Error("usage: node scripts/prepare-cache-prefix-blind-review.mjs --root <run-root> [--samples 10] [--expected-prefix-version <version>] [--allow-short-sample]");
  const absoluteRoot = path.resolve(root);
  const artifacts = buildBlindReviewArtifacts(await loadCompletedRecords(absoluteRoot), parsedSampleCount, {
    expectedPromptPrefixVersion: argumentValue("--expected-prefix-version"),
    allowShortSample: process.argv.includes("--allow-short-sample")
  });
  const outputDir = path.join(absoluteRoot, "blind-review");
  await mkdir(outputDir, { recursive: true });
  const packetPath = path.join(outputDir, "reviewer-packet.md");
  const templatePath = path.join(outputDir, "review-template.md");
  const manifestPath = path.join(outputDir, "audit-manifest.json");
  await Promise.all([
    writeFile(packetPath, artifacts.packet, "utf8"),
    writeFile(templatePath, artifacts.template, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(artifacts.manifest, null, 2)}\n`, "utf8")
  ]);
  process.stdout.write(`${JSON.stringify({ packetPath, templatePath, manifestPath, sampleCount: artifacts.manifest.sampleCount, packetSha256: artifacts.manifest.packetSha256 }, null, 2)}\n`);
}
