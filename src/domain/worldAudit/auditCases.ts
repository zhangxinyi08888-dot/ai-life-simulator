import type { HistoryItem } from "../../types";
import { auditWorldHistory } from "./auditHistory";
import type { WorldAuditReport } from "./types";

export interface BrowserCaseForWorldAudit {
  caseSlug: string;
  scenario?: string;
  dataSource?: string;
  finalState?: {
    testDataSource?: string;
    e2eCase?: unknown;
    history?: HistoryItem[];
  };
}

export interface BrowserRunWorldAudit {
  schemaVersion: 1;
  generatedAt: string;
  caseCount: number;
  nodeCount: number;
  passed: boolean;
  blocking: number;
  warning: number;
  provenanceFailures: Array<{ caseSlug: string; reasons: string[] }>;
  cases: Array<{
    caseSlug: string;
    scenario?: string;
    provenancePassed: boolean;
    report: WorldAuditReport;
  }>;
}

export function auditBrowserCases(input: {
  cases: BrowserCaseForWorldAudit[];
  generatedAt?: string;
}): BrowserRunWorldAudit {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const provenanceFailures: BrowserRunWorldAudit["provenanceFailures"] = [];
  const cases = input.cases.map((record) => {
    const reasons: string[] = [];
    if (record.dataSource !== "real_ai_browser") reasons.push("dataSource 不是 real_ai_browser");
    if (record.finalState?.testDataSource !== "real_ai_browser") reasons.push("finalState.testDataSource 不是 real_ai_browser");
    if (record.finalState?.e2eCase) reasons.push("存在 e2eCase，不能作为真实 AI 证据");
    if (!Array.isArray(record.finalState?.history) || !record.finalState?.history.length) reasons.push("缺少完整 history");
    if (reasons.length) provenanceFailures.push({ caseSlug: record.caseSlug, reasons });
    return {
      caseSlug: record.caseSlug,
      scenario: record.scenario,
      provenancePassed: reasons.length === 0,
      report: auditWorldHistory({
        history: record.finalState?.history || [],
        routeId: record.caseSlug,
        generatedAt
      })
    };
  });
  const blocking = cases.reduce((sum, item) => sum + item.report.summary.blocking, 0);
  const warning = cases.reduce((sum, item) => sum + item.report.summary.warning, 0);
  return {
    schemaVersion: 1,
    generatedAt,
    caseCount: cases.length,
    nodeCount: cases.reduce((sum, item) => sum + item.report.nodeCount, 0),
    passed: provenanceFailures.length === 0 && blocking === 0,
    blocking,
    warning,
    provenanceFailures,
    cases
  };
}

function escapeCell(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderWorldInvariantMarkdown(audit: BrowserRunWorldAudit): string {
  const lines = [
    "# 世界不变量报告",
    "",
    `- 生成时间：\`${audit.generatedAt}\``,
    `- 路线数量：${audit.caseCount}`,
    `- 节点数量：${audit.nodeCount}`,
    `- 阻断问题：${audit.blocking}`,
    `- 警告：${audit.warning}`,
    `- 结论：**${audit.passed ? "通过" : "失败"}**`,
    "",
    "## 路线汇总",
    "",
    "| 路线 | 场景 | 来源 | 节点 | 阻断 | 警告 | 结论 |",
    "|---|---|---:|---:|---:|---:|---|"
  ];
  for (const item of audit.cases) {
    lines.push(`| ${escapeCell(item.caseSlug)} | ${escapeCell(item.scenario)} | ${item.provenancePassed ? "通过" : "失败"} | ${item.report.nodeCount} | ${item.report.summary.blocking} | ${item.report.summary.warning} | ${item.provenancePassed && item.report.summary.passed ? "通过" : "失败"} |`);
  }
  if (audit.provenanceFailures.length) {
    lines.push("", "## 来源问题", "");
    for (const issue of audit.provenanceFailures) lines.push(`- \`${issue.caseSlug}\`：${issue.reasons.join("；")}`);
  }
  lines.push("", "## 逐节点发现", "");
  const findings = audit.cases.flatMap((item) => item.report.findings.map((issue) => ({ caseSlug: item.caseSlug, ...issue })));
  if (!findings.length) {
    lines.push("当前已实现的规则未发现问题。该结论不代表尚未实现的因果、统计和当前事实规则已经通过。");
  } else {
    lines.push("| 路线 | 节点 | 年龄月 | 规则 | 领域 | 级别 | 问题 |", "|---|---:|---:|---|---|---|---|");
    for (const issue of findings) {
      lines.push(`| ${escapeCell(issue.caseSlug)} | ${issue.nodeIndex} | ${issue.ageInMonths} | ${issue.ruleId} | ${issue.domain} | ${issue.severity} | ${escapeCell(issue.message)} |`);
    }
  }
  lines.push("", "## 覆盖边界", "", "本报告只声明 `evaluatedRuleIds` 所列规则的结果。路线合约、完整因果证据、概率分布和带地区/时间版本的现实数据需要独立报告。", "");
  return lines.join("\n");
}
