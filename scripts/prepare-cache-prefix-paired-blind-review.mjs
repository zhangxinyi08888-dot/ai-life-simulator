import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REVIEW_SCHEMA_VERSION = 1;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
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

function renderAge(node) {
  const ageInMonths = Number(node?.ageInMonths);
  if (Number.isFinite(ageInMonths)) {
    const years = Math.floor(ageInMonths / 12);
    const months = ageInMonths % 12;
    return months ? `${years} 岁 ${months} 个月` : `${years} 岁`;
  }
  return Number.isFinite(Number(node?.age)) ? `${node.age} 岁` : "年龄未记录";
}

function renderState(node) {
  const attributes = node?.attributes || {};
  const financial = node?.financialState;
  const lines = [
    `- 五维：幸福 ${cleanInline(attributes.happiness)}；才智 ${cleanInline(attributes.intelligence)}；财富 ${cleanInline(attributes.wealth)}；人际 ${cleanInline(attributes.relation)}；健康 ${cleanInline(attributes.health)}`
  ];
  if (financial) {
    lines.push(`- 财务：净资产 ${cleanInline(financial.netWorthWan)} 万；现金 ${cleanInline(financial.cashWan)} 万；总负债 ${cleanInline(financial.totalDebtWan)} 万；就业 ${cleanInline(financial.employmentStatus)}；收入稳定性 ${cleanInline(financial.incomeStability)}`);
  } else {
    lines.push("- 财务：未记录结构化快照（仅记录缺失，不自动扣分）。");
  }
  return lines;
}

function renderChoices(choices) {
  if (!Array.isArray(choices) || choices.length === 0) return ["- （没有可用选择，记录为异常。）"];
  return choices.map((choice, index) => `${index + 1}. ${cleanInline(choice?.text)}`);
}

function outputIsReviewable(node) {
  return Boolean(
    node
    && typeof node.description === "string"
    && node.description.trim()
    && Array.isArray(node.choices)
    && node.choices.length > 0
    && node.attributes
  );
}

function assertPairedRecord(record) {
  if (record?.status) throw new Error(`Blind packet cannot include failed pair ${record.key || "unknown"}-${record.pairIndex || "unknown"}`);
  if (record?.samePromptInput !== true) throw new Error(`Paired blind review requires identical input state: ${record?.key || "unknown"}-${record?.pairIndex || "unknown"}`);
  if (!outputIsReviewable(record?.main?.outputNode) || !outputIsReviewable(record?.candidate?.outputNode)) {
    throw new Error(`Paired blind review requires two reviewable outputs: ${record?.key || "unknown"}-${record?.pairIndex || "unknown"}`);
  }
  if (!record?.inputState || !record.inputState.currentNode) {
    throw new Error(`Paired blind review requires its shared source state: ${record?.key || "unknown"}-${record?.pairIndex || "unknown"}`);
  }
}

function assignmentFor(record) {
  // The deterministic salt prevents reviewer-facing ordering from becoming a
  // proxy for source identity. The source mapping is kept only in the audit
  // manifest, not in the review packet.
  const mainFirst = Number.parseInt(digest(`paired-review-2026-08-08:${record.key}:${record.pairIndex}`).slice(0, 2), 16) % 2 === 0;
  return mainFirst
    ? { A: "main", B: "v2_r4" }
    : { A: "v2_r4", B: "main" };
}

function outputForLabel(record, label) {
  const source = label === "main" ? record.main : record.candidate;
  return source.outputNode;
}

function renderVersion(label, node) {
  return [
    `### 版本 ${label}`,
    "",
    `- 时间：${renderAge(node)}`,
    `- 阶段：${cleanInline(node?.stage)}`,
    `- 标题：${cleanInline(node?.title)}`,
    "",
    "#### 正文",
    "",
    quoteBlock(node?.description),
    "",
    "#### 可选选择",
    "",
    ...renderChoices(node?.choices),
    "",
    "#### 结构化现实快照",
    "",
    ...renderState(node),
    ""
  ];
}

function renderReviewerPacket(samples) {
  const lines = [
    "# 10 节点人工成对盲评包",
    "",
    "> 此文件刻意不标注路线、分支、缓存命中率或实现版本。每个节点的版本 A/B 来自同一输入状态与同一实际选择；请不要查看同目录审计映射文件。",
    "",
    "## 审阅任务",
    "",
    "- 先阅读共享前情，再分别评分版本 A 与版本 B：前情连贯性、现实/状态一致性、选择质量、文风自然性（各 1–5）。",
    "- 写明本对中哪个更好：A、B 或相当；若任一版本存在事实冲突、选择失真、明显模板化或生成失败，请写入证据。",
    "- 性能指标不构成内容验收证据；任何重大问题都应使该版本暂不通过。",
    "",
    "---",
    ""
  ];
  for (const sample of samples) {
    const sourceNode = sample.inputState.currentNode;
    const assignment = sample.assignment;
    lines.push(
      `## ${sample.blindId}`,
      "",
      "### 共享前情与本次选择",
      "",
      `- 选择前节点：${renderAge(sourceNode)} · ${cleanInline(sourceNode?.title)}`,
      `- 本次实际选择：${cleanInline(sample.record.selection?.text)}`,
      "",
      quoteBlock(sourceNode?.description),
      "",
      ...renderState(sourceNode),
      "",
      ...renderVersion("A", outputForLabel(sample.record, assignment.A)),
      ...renderVersion("B", outputForLabel(sample.record, assignment.B)),
      "#### 审阅记录",
      "",
      "- 较优：□ A  □ B  □ 相当",
      "- 版本 A：前情 ___ / 现实 ___ / 选择 ___ / 文风 ___；结论：□ 通过 □ 需复核 □ 重大问题",
      "- 版本 B：前情 ___ / 现实 ___ / 选择 ___ / 文风 ___；结论：□ 通过 □ 需复核 □ 重大问题",
      "- 证据或说明：",
      "",
      "---",
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderReviewTemplate(samples, packetSha256) {
  const lines = [
    "# 10 节点人工成对盲评记录",
    "",
    `- 对应审阅包 SHA-256：\`${packetSha256}\``,
    "- 审阅人：",
    "- 审阅日期：",
    "",
    "填写每对的 A/B 四项评分、较优版本与事实证据。评分不设平均分硬阈值；任何重大问题都必须具体说明。",
    "",
    "| 节点 | A 前情 | A 现实 | A 选择 | A 文风 | B 前情 | B 现实 | B 选择 | B 文风 | 较优 | A 结论 | B 结论 | 证据或说明 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|"
  ];
  for (const sample of samples) {
    lines.push(`| ${sample.blindId} |  |  |  |  |  |  |  |  | A / B / 相当 | 通过 / 需复核 / 重大问题 | 通过 / 需复核 / 重大问题 |  |`);
  }
  lines.push(
    "",
    "## 验收结论",
    "",
    "- [ ] 10 对均已完成 A/B 独立评分。",
    "- [ ] 每个重大问题均已标明所属版本并有可复测依据。",
    "- [ ] 较弱一侧的重大问题均已标明，并有可复测依据。",
    "",
    "最终结论：□ A 优于 B  □ B 优于 A  □ 两者相当  □ 需修复后复测  □ 证据不足",
    ""
  );
  return `${lines.join("\n")}\n`;
}

export function buildPairedBlindReviewArtifacts(records, provenance = {}) {
  if (!Array.isArray(records) || records.length !== 10) {
    throw new Error(`Paired blind review requires exactly 10 successful pairs, got ${records?.length ?? 0}`);
  }
  records.forEach(assertPairedRecord);
  const samples = [...records]
    .sort((left, right) => `${left.key}:${String(left.pairIndex).padStart(2, "0")}`.localeCompare(`${right.key}:${String(right.pairIndex).padStart(2, "0")}`))
    .map((record, index) => ({
      blindId: `N${String(index + 1).padStart(2, "0")}`,
      record,
      inputState: record.inputState,
      assignment: assignmentFor(record)
    }));
  const packet = renderReviewerPacket(samples);
  const packetSha256 = digest(packet);
  const observedFailures = Array.isArray(provenance.generationFailures) ? provenance.generationFailures : [];
  const labelCounts = samples.reduce((counts, sample) => {
    counts[sample.assignment.A] += 1;
    counts[sample.assignment.B] += 1;
    return counts;
  }, { main: 0, v2_r4: 0 });
  return {
    packet,
    template: renderReviewTemplate(samples, packetSha256),
    manifest: {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      sampleCount: samples.length,
      packetSha256,
      provenance: {
        ...provenance,
        generationFailures: undefined
      },
      observedGenerationFailures: observedFailures.map((failure) => ({
        key: failure?.key,
        pairIndex: failure?.pairIndex,
        status: failure?.status,
        sha256: digest(JSON.stringify(failure))
      })),
      labelCounts,
      samples: samples.map((sample) => ({
        blindId: sample.blindId,
        pairKey: sample.record.key,
        pairIndex: sample.record.pairIndex,
        inputStateSha256: digest(JSON.stringify(sample.inputState)),
        mainOutputSha256: digest(JSON.stringify(sample.record.main.outputNode)),
        candidateOutputSha256: digest(JSON.stringify(sample.record.candidate.outputNode)),
        reviewerLabels: sample.assignment
      }))
    },
    hardChecks: {
      verdict: observedFailures.length > 0
        ? "ready_for_human_review_with_observed_generation_failure"
        : "ready_for_human_review",
      checks: [
        { name: "exactly 10 successful paired outputs", status: "pass", detail: `count=${samples.length}` },
        { name: "all paired inputs are identical", status: "pass", detail: "10/10 samePromptInput=true" },
        { name: "both sides expose body, choices, and attributes", status: "pass", detail: "10/10 pairs" },
        { name: "reviewer labels are source-balanced", status: labelCounts.main === 10 && labelCounts.v2_r4 === 10 ? "pass" : "fail", detail: `mainLabels=${labelCounts.main}; candidateLabels=${labelCounts.v2_r4}` },
        { name: "generation failures are retained as separate evidence", status: observedFailures.length > 0 ? "observed" : "pass", detail: `count=${observedFailures.length}` }
      ]
    }
  };
}

async function loadPairs(root) {
  const pairsDir = path.join(root, "pairs");
  const names = (await readdir(pairsDir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => {
    const record = JSON.parse(await readFile(path.join(pairsDir, name), "utf8"));
    record.inputState = JSON.parse(await readFile(record.inputStatePath, "utf8"));
    return record;
  }));
}

async function loadFailures(root) {
  const failuresDir = path.join(root, "failures");
  try {
    const names = (await readdir(failuresDir)).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(failuresDir, name), "utf8"))));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootArgument = argumentValue("--root");
  if (!rootArgument) throw new Error("usage: node scripts/prepare-cache-prefix-paired-blind-review.mjs --root <run-root> [--main-commit <sha>] [--candidate-id <id>] [--candidate-source-sha <sha>]");
  const root = path.resolve(rootArgument);
  const [pairs, generationFailures] = await Promise.all([loadPairs(root), loadFailures(root)]);
  const artifacts = buildPairedBlindReviewArtifacts(pairs, {
    mainCommit: argumentValue("--main-commit"),
    candidateId: argumentValue("--candidate-id"),
    candidateSourceSha256: argumentValue("--candidate-source-sha"),
    generationFailures
  });
  const outputDir = path.join(root, "blind-review");
  await mkdir(outputDir, { recursive: true });
  const packetPath = path.join(outputDir, "reviewer-packet.md");
  const templatePath = path.join(outputDir, "review-template.md");
  const manifestPath = path.join(outputDir, "audit-manifest.json");
  const hardChecksPath = path.join(outputDir, "hard-checks.json");
  await Promise.all([
    writeFile(packetPath, artifacts.packet, "utf8"),
    writeFile(templatePath, artifacts.template, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(artifacts.manifest, null, 2)}\n`, "utf8"),
    writeFile(hardChecksPath, `${JSON.stringify(artifacts.hardChecks, null, 2)}\n`, "utf8")
  ]);
  process.stdout.write(`${JSON.stringify({ packetPath, templatePath, manifestPath, hardChecksPath, packetSha256: artifacts.manifest.packetSha256 }, null, 2)}\n`);
}
