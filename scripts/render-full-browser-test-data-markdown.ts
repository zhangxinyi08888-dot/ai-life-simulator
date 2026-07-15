import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, any>;

function escapeInline(value: unknown): string {
  return String(value ?? "—")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function renderAge(node: JsonRecord): string {
  const ageInMonths = Number(node.ageInMonths);
  if (Number.isFinite(ageInMonths)) {
    const years = Math.floor(ageInMonths / 12);
    const months = ageInMonths % 12;
    return months ? `${years} 岁 ${months} 个月` : `${years} 岁`;
  }
  return Number.isFinite(Number(node.age)) ? `${node.age} 岁` : "年龄未知";
}

function renderChoice(choice: JsonRecord, index: number): string[] {
  const lines = [`${index + 1}. **${escapeInline(choice.id || String.fromCharCode(65 + index))}**：${escapeInline(choice.text)}`];
  if (choice.impactSummary) lines.push(`   - 影响提示：${escapeInline(choice.impactSummary)}`);
  if (choice.decisionIntent) lines.push(`   - 决策意图：\`${escapeInline(choice.decisionIntent)}\``);
  if (Array.isArray(choice.expectedWorldDeltaTypes) && choice.expectedWorldDeltaTypes.length) {
    lines.push(`   - 预期世界变化：${choice.expectedWorldDeltaTypes.map((item: unknown) => `\`${escapeInline(item)}\``).join("、")}`);
  }
  if (choice.temporalHint) {
    const hint = choice.temporalHint;
    lines.push(`   - 时间提示：强度 \`${escapeInline(hint.lifeIntensity)}\`；跨度 ${escapeInline(hint.durationMonths?.join("–"))} 个月；需要后续 ${hint.requiresFollowUp ? "是" : "否"}；原因：${escapeInline(hint.reason)}`);
  }
  return lines;
}

function renderAttributes(attributes: JsonRecord = {}): string[] {
  return [
    "| 幸福 | 才智 | 财富资源度 | 关系 | 健康 |",
    "|---:|---:|---:|---:|---:|",
    `| ${escapeInline(attributes.happiness)} | ${escapeInline(attributes.intelligence)} | ${escapeInline(attributes.wealth)} | ${escapeInline(attributes.relation)} | ${escapeInline(attributes.health)} |`
  ];
}

function renderFinancialSummary(financialState?: JsonRecord, financialChange?: JsonRecord): string[] {
  if (!financialState) return ["本节点没有结构化财务状态。"];
  const lines = [
    "| 净资产（万元） | 现金（万元） | 投资资产（万元） | 房产市值（万元） | 企业及其他资产（万元） | 总负债（万元） |",
    "|---:|---:|---:|---:|---:|---:|",
    `| ${escapeInline(financialState.netWorthWan)} | ${escapeInline(financialState.cashWan)} | ${escapeInline(financialState.investmentAssetsWan)} | ${escapeInline(financialState.propertyMarketValueWan)} | ${escapeInline(financialState.businessAndOtherAssetsWan)} | ${escapeInline(financialState.totalDebtWan)} |`,
    "",
    "| 年税后收入（万元） | 年核心支出（万元） | 年可支配收入（万元） | 就业状态 | 收入稳定性 | 是否估算 |",
    "|---:|---:|---:|---|---|---|",
    `| ${escapeInline(financialState.annualAfterTaxIncomeWan)} | ${escapeInline(financialState.annualCoreExpenseWan)} | ${escapeInline(financialState.annualDisposableIncomeWan)} | ${escapeInline(financialState.employmentStatus)} | ${escapeInline(financialState.incomeStability)} | ${financialState.isEstimated ? "是" : "否"} |`
  ];
  if (financialChange) {
    lines.push("", `- 本阶段净资产变化：${escapeInline(financialChange.netWorthChangeWan)} 万元`);
    if (financialChange.summary) lines.push(`- 变化摘要：${escapeInline(financialChange.summary)}`);
  }
  return lines;
}

function compactNodeState(node: JsonRecord): JsonRecord {
  return {
    age: node.age,
    ageInMonths: node.ageInMonths,
    stage: node.stage,
    attributes: node.attributes,
    financialState: node.financialState,
    financialChange: node.financialChange,
    eventMeta: node.eventMeta,
    narrativeMeta: node.narrativeMeta,
    committedArcMeta: node.committedArcMeta,
    worldStateSnapshot: node.worldStateSnapshot,
    reportInvitation: node.reportInvitation,
    isEndingNode: node.isEndingNode
  };
}

function renderInvitation(invitation: JsonRecord, label: string): string[] {
  return [
    `### ${label}`,
    "",
    `- ID：\`${escapeInline(invitation.id)}\``,
    `- 状态：\`${escapeInline(invitation.status)}\``,
    `- 原因：\`${escapeInline(invitation.reason)}\``,
    `- 触发键：\`${escapeInline(invitation.triggerKey)}\``,
    `- 完成选择数：${escapeInline(invitation.completedChoiceCount)}`,
    `- PressureArc ID：${invitation.pressureArcId ? `\`${escapeInline(invitation.pressureArcId)}\`` : "无"}`,
    `- 解决证据：${Array.isArray(invitation.resolutionEvidence) && invitation.resolutionEvidence.length ? invitation.resolutionEvidence.map((item: unknown) => escapeInline(item)).join("；") : "无"}`,
    `- 接受时选择数：${escapeInline(invitation.acceptedAtChoiceCount)}`,
    `- 拒绝时选择数：${escapeInline(invitation.declinedAtChoiceCount)}`,
    ""
  ];
}

function renderFinalOutcome(outcome: JsonRecord): string[] {
  const share = outcome.share || {};
  const report = outcome.report || {};
  const executive = report.executiveSummary || {};
  return [
    "## 最终终局报告",
    "",
    `- 报告类型：\`${escapeInline(outcome.meta?.closureType)}\``,
    `- 海报标题：${escapeInline(share.viralTitle)}`,
    `- 契约标题：${escapeInline(share.covenantTitle)}`,
    `- 一句话总结：${escapeInline(share.oneLineSummary)}`,
    `- 报告总标题：${escapeInline(executive.headline)}`,
    `- 报告结语：${escapeInline(report.finalLifeReading?.finalSentence || share.closingLine)}`,
    "",
    "### 完整报告原文与结构化内容",
    "",
    "以下 JSON 为应用最终生成并保存的完整报告，字段和正文均未删减：",
    "",
    "```json",
    JSON.stringify(outcome, null, 2),
    "```",
    ""
  ];
}

function renderCase(record: JsonRecord, caseIndex: number): string[] {
  const finalState = record.finalState || {};
  const history: JsonRecord[] = Array.isArray(finalState.history) ? finalState.history : [];
  const invitations: JsonRecord[] = Array.isArray(finalState.invitations) ? finalState.invitations : [];
  const lines: string[] = [
    `# 第 ${caseIndex + 1} 组：${escapeInline(record.caseSlug)}`,
    "",
    `- 测试场景：\`${escapeInline(record.scenario)}\``,
    `- 浏览器地址：${escapeInline(record.sourceUrl)}`,
    `- 历史节点数：${history.length}`,
    `- 邀请数：${invitations.length}`,
    `- 最终报告类型：\`${escapeInline(finalState.outcome?.meta?.closureType)}\``,
    `- 最终年龄：${renderAge(finalState.currentNode || history.at(-1) || {})}`,
    "",
    "## 报告邀请记录",
    ""
  ];

  if (!invitations.length) lines.push("本组没有报告邀请。", "");
  invitations.forEach((invitation, invitationIndex) => {
    lines.push(...renderInvitation(invitation, `邀请 ${invitationIndex + 1}`));
  });

  lines.push("## 完整故事节点", "");
  history.forEach((node, nodeIndex) => {
    const choices: JsonRecord[] = Array.isArray(node.choices) ? node.choices : [];
    lines.push(
      `### 节点 ${nodeIndex + 1}/${history.length} · ${renderAge(node)} · ${escapeInline(node.title)}`,
      "",
      `- 人生阶段：${escapeInline(node.stage)}`,
      `- 是否生理终局节点：${node.isEndingNode ? "是" : "否"}`,
      "",
      "#### 故事正文",
      "",
      String(node.description || "（无正文）"),
      "",
      "#### 当时展示的全部故事选择",
      ""
    );
    if (choices.length) {
      choices.forEach((choice, choiceIndex) => lines.push(...renderChoice(choice, choiceIndex)));
    } else {
      lines.push("本节点没有普通故事选项。" );
    }
    lines.push(
      "",
      "#### 用户实际选择",
      "",
      `> ${String(node.selectedChoice || "（未记录）").replace(/\r?\n/g, "\n> ")}`,
      "",
      "#### 当时五项状态",
      "",
      ...renderAttributes(node.attributes),
      "",
      "#### 当时财务状态",
      "",
      ...renderFinancialSummary(node.financialState, node.financialChange),
      "",
      "#### 完整节点状态快照",
      "",
      "```json",
      JSON.stringify(compactNodeState(node), null, 2),
      "```",
      ""
    );
  });

  lines.push(...renderFinalOutcome(finalState.outcome || {}));
  lines.push("---", "");
  return lines;
}

const inputDir = path.resolve(process.argv[2] || "artifacts/report-invitation-browser/2026-07-16-natural-reflection-browser-evaluation");
const outputPath = path.resolve(process.argv[3] || "docs/reports/2026-07-16-natural-reflection-10-case-full-test-data.md");
const files = (await readdir(inputDir))
  .filter((file) => file.startsWith("journey-") && file.endsWith(".json"))
  .sort();
const records = await Promise.all(files.map(async (file) => (
  JSON.parse(await readFile(path.join(inputDir, file), "utf8")) as JsonRecord
)));

const totalNodes = records.reduce((sum, record) => sum + (record.finalState?.history?.length || 0), 0);
const totalInvitations = records.reduce((sum, record) => sum + (record.finalState?.invitations?.length || 0), 0);
const lines = [
  "# 自然收束报告邀请：10 组完整浏览器测试数据",
  "",
  "> 本文档由保存的浏览器原始 JSON 自动生成。故事正文、全部选择、用户实际选择、状态快照与最终报告均来自测试记录，没有抽样或省略。",
  "",
  "## 数据概览",
  "",
  `- 测试组数：${records.length}`,
  `- 故事节点总数：${totalNodes}`,
  `- 报告邀请总数：${totalInvitations}`,
  `- 原始数据目录：\`${inputDir}\``,
  "",
  "## 文档结构说明",
  "",
  "每组数据依次包含邀请记录、全部故事节点和完整终局报告。每个节点均展示故事正文、系统提供的全部选择、用户最终选择、五项属性、结构化财务值，以及包含 PressureArc、世界状态和邀请状态的完整节点快照。",
  "",
  "---",
  ""
];
records.forEach((record, index) => lines.push(...renderCase(record, index)));

await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(JSON.stringify({ outputPath, caseCount: records.length, totalNodes, totalInvitations }, null, 2));
