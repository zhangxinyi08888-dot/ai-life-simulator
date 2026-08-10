import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STYLE_DIMENSIONS = [
  "场景承载",
  "细节有效性",
  "人物声音",
  "节奏结构",
  "自然度",
  "情绪细腻度",
  "克制与余味"
];

const SCENE_TERMS = ["窗", "门", "桌", "手机", "屏幕", "厨房", "办公室", "会议室", "咖啡", "高铁", "车站", "灯", "雨", "夜", "清晨", "走廊", "冰箱", "菜市场", "饭桌", "医院", "出租屋", "公园", "街", "声音", "目光"];
const SUMMARY_TERMS = ["你开始", "你意识到", "你逐渐", "你发现", "你知道", "你清楚", "你明白", "这让你", "这段时间", "与此同时", "现实比", "状态", "节奏", "机制", "流程", "计划"];
const STYLE_DEFECTS = ["模板化总结", "抽象空转", "细节堆砌", "过度解释", "刻意抒情", "人物声音漂移", "节奏平直", "段落句式重复", "无"];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanInline(value) {
  return String(value ?? "未记录").replace(/\r?\n/gu, " ").trim() || "未记录";
}

function quoteBlock(value) {
  return String(value ?? "（无正文）")
    .trim()
    .split(/\r?\n/gu)
    .map((line) => line.length > 0 ? `> ${line}` : ">")
    .join("\n");
}

function countMatches(value, pattern) {
  return [...String(value ?? "").matchAll(pattern)].length;
}

function countTerms(value, terms) {
  const text = String(value ?? "");
  return terms.reduce((count, term) => count + text.split(term).length - 1, 0);
}

export function measureStyle(description) {
  const text = String(description ?? "").trim();
  const paragraphs = text.split(/\n\s*\n/gu).map((item) => item.trim()).filter(Boolean);
  const sentences = text.split(/[。！？!?]+/gu).map((item) => item.trim()).filter(Boolean);
  const sentenceLengths = sentences.map((item) => [...item].length);
  const averageSentenceLength = sentenceLengths.length
    ? sentenceLengths.reduce((sum, length) => sum + length, 0) / sentenceLengths.length
    : 0;
  const sentenceLengthVariance = sentenceLengths.length
    ? sentenceLengths.reduce((sum, length) => sum + ((length - averageSentenceLength) ** 2), 0) / sentenceLengths.length
    : 0;
  return {
    characterCount: [...text].length,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    averageSentenceLength: Number(averageSentenceLength.toFixed(2)),
    sentenceLengthStdDev: Number(Math.sqrt(sentenceLengthVariance).toFixed(2)),
    directSpeechCount: countMatches(text, /[“‘'][^”’'\n]{2,}[”’']/gu),
    numericTemporalAnchorCount: countMatches(text, /\d+(?:\.\d+)?\s*(?:岁|个月|年|月|周|天|小时|分钟|次|家|人|元|万元|万|%)/gu),
    sceneTermCount: countTerms(text, SCENE_TERMS),
    summaryScaffoldCount: countTerms(text, SUMMARY_TERMS),
    paragraphYouOpeningCount: paragraphs.filter((item) => /^你(?:开始|意识到|逐渐|发现|知道|清楚|明白|决定|继续|把|和|在|一边|想)/u.test(item)).length
  };
}

function assignmentMap(records) {
  const ranked = [...records].sort((left, right) => digest(`style-blind-2026-08-10:${left.pairId}`).localeCompare(digest(`style-blind-2026-08-10:${right.pairId}`)));
  return new Map(ranked.map((record, index) => [record.pairId, index < Math.floor(ranked.length / 2)
    ? { A: "main", B: "v2_r4" }
    : { A: "v2_r4", B: "main" }]));
}

function outputFor(record, source) {
  return source === "main" ? record.main.outputNode : record.candidate.outputNode;
}

function assertRecord(record) {
  if (!record?.pairId || record.samePromptInput !== true) throw new Error(`invalid style pair ${record?.pairId ?? "unknown"}`);
  for (const source of ["main", "candidate"]) {
    if (!record[source]?.outputNode?.description) throw new Error(`missing ${source} output for ${record.pairId}`);
  }
}

function renderVersion(label, node) {
  return [
    `### 版本 ${label}`,
    "",
    `- 标题：${cleanInline(node?.title)}`,
    `- 时间：${cleanInline(node?.ageInMonths)} 月龄；阶段：${cleanInline(node?.stage)}`,
    "",
    quoteBlock(node?.description),
    "",
    "#### 后续选择（仅辅助判断叙事落点）",
    "",
    ...(node?.choices ?? []).map((choice, index) => `${index + 1}. ${cleanInline(choice?.text)}`),
    ""
  ];
}

function renderPacket(samples) {
  const lines = [
    "# Main 与修改版文风专项成对盲评包",
    "",
    "> A/B 已逐对随机且整体平衡；本包不包含真实来源、缓存指标或实现信息。请先完成评分，再查看审计映射。",
    "",
    "## 七项文风评分（各 1–5）",
    "",
    "- 场景承载：是否通过动作、空间、物件和互动呈现，而非作者直接总结。",
    "- 细节有效性：细节是否推动人物、冲突或现实判断，而非只增加字数。",
    "- 人物声音：人物语言、反应和选择是否具体、有辨识度。",
    "- 节奏结构：段落推进是否有变化、转折和轻重，而非流水账。",
    "- 自然度：是否少模板、少生硬术语、少重复句式。",
    "- 情绪细腻度：是否呈现情绪变化的过程和矛盾，而非只贴情绪标签。",
    "- 克制与余味：是否避免把意义全部解释完，结尾是否自然留下空间。",
    "",
    `缺陷标签可多选：${STYLE_DEFECTS.join("、")}。`,
    "",
    "---",
    ""
  ];
  for (const sample of samples) {
    const current = sample.inputState.currentNode;
    lines.push(
      `## ${sample.blindId} · ${sample.record.theme} · 重复 ${sample.record.replicate}`,
      "",
      "### 共享前情与本次选择",
      "",
      `- 前情标题：${cleanInline(current?.title)}`,
      `- 本次实际选择：${cleanInline(sample.record.selection?.text)}`,
      "",
      quoteBlock(current?.description),
      "",
      ...renderVersion("A", outputFor(sample.record, sample.assignment.A)),
      ...renderVersion("B", outputFor(sample.record, sample.assignment.B)),
      "#### 审阅记录",
      "",
      `- A：${STYLE_DIMENSIONS.map((name) => `${name} __`).join("；")}；缺陷：__`,
      `- B：${STYLE_DIMENSIONS.map((name) => `${name} __`).join("；")}；缺陷：__`,
      "- 文风较优：□ A □ B □ 相当；把握度：□ 高 □ 中 □ 低",
      "- 最关键的文本证据：",
      "",
      "---",
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderTemplate(samples, packetSha256) {
  const headers = ["节点", ...STYLE_DIMENSIONS.map((name) => `A ${name}`), ...STYLE_DIMENSIONS.map((name) => `B ${name}`), "较优", "把握度", "A 缺陷", "B 缺陷", "关键证据"];
  const lines = [
    "# 文风专项成对盲评记录",
    "",
    `- 对应审阅包 SHA-256：\`${packetSha256}\``,
    "- 审阅人：",
    "- 审阅日期：",
    "",
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((_, index) => index === 0 ? "---" : "---:").join(" | ")} |`
  ];
  for (const sample of samples) {
    lines.push(`| ${sample.blindId} | ${Array(headers.length - 1).fill("").join(" | ")} |`);
  }
  lines.push("", "总体判断：", "");
  return `${lines.join("\n")}\n`;
}

export function buildStyleBlindReview(records, inputStates) {
  if (!Array.isArray(records) || records.length < 8) throw new Error(`style blind review requires at least 8 pairs, got ${records?.length ?? 0}`);
  records.forEach(assertRecord);
  const assignments = assignmentMap(records);
  const samples = [...records]
    .sort((left, right) => left.pairId.localeCompare(right.pairId))
    .map((record, index) => ({blindId: `S${String(index + 1).padStart(2, "0")}`, record, inputState: inputStates.get(record.pairId), assignment: assignments.get(record.pairId)}));
  const packet = renderPacket(samples);
  const packetSha256 = digest(packet);
  return {
    packet,
    template: renderTemplate(samples, packetSha256),
    manifest: {
      schemaVersion: 1,
      sampleCount: samples.length,
      packetSha256,
      aLabelCounts: samples.reduce((counts, sample) => ({...counts, [sample.assignment.A]: counts[sample.assignment.A] + 1}), {main: 0, v2_r4: 0}),
      samples: samples.map((sample) => ({blindId: sample.blindId, pairId: sample.record.pairId, theme: sample.record.theme, replicate: sample.record.replicate, callOrder: sample.record.callOrder, reviewerLabels: sample.assignment, inputStateSha256: digest(JSON.stringify(sample.inputState)), mainOutputSha256: digest(JSON.stringify(sample.record.main.outputNode)), candidateOutputSha256: digest(JSON.stringify(sample.record.candidate.outputNode))}))
    },
    metrics: {
      schemaVersion: 1,
      samples: samples.map((sample) => ({pairId: sample.record.pairId, theme: sample.record.theme, replicate: sample.record.replicate, main: measureStyle(sample.record.main.outputNode.description), v2_r4: measureStyle(sample.record.candidate.outputNode.description)}))
    }
  };
}

async function loadRecords(root) {
  const names = (await readdir(path.join(root, "pairs"))).filter((name) => name.endsWith(".json")).sort();
  const records = await Promise.all(names.map((name) => readFile(path.join(root, "pairs", name), "utf8").then(JSON.parse)));
  const states = new Map();
  for (const record of records) states.set(record.pairId, JSON.parse(await readFile(record.inputStatePath, "utf8")));
  return { records, states };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(argumentValue("--root") ?? "");
  if (!root) throw new Error("usage: node scripts/prepare-cache-prefix-style-blind-review.mjs --root <run-root>");
  const { records, states } = await loadRecords(root);
  const result = buildStyleBlindReview(records, states);
  const outputDir = path.join(root, "blind-review");
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, "reviewer-packet.md"), result.packet, "utf8"),
    writeFile(path.join(outputDir, "review-template.md"), result.template, "utf8"),
    writeFile(path.join(outputDir, "audit-manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8"),
    writeFile(path.join(outputDir, "style-metrics.json"), `${JSON.stringify(result.metrics, null, 2)}\n`, "utf8")
  ]);
  process.stdout.write(`${JSON.stringify({ outputDir, sampleCount: result.manifest.sampleCount, packetSha256: result.manifest.packetSha256, aLabelCounts: result.manifest.aLabelCounts })}\n`);
}
