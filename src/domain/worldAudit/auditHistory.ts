import type { HistoryItem } from "../../types";
import { CORE_WORLD_REALITY_RULES } from "./rules";
import type {
  WorldAuditFinding,
  WorldAuditReport,
  WorldRealityRule,
  WorldRuleCategory,
  WorldAuditDomain
} from "./types";

function nodeAgeInMonths(node: HistoryItem): number {
  return node.ageInMonths ?? Math.round(node.age * 12);
}

export function auditWorldHistory(input: {
  history: HistoryItem[];
  routeId?: string;
  rules?: WorldRealityRule[];
  generatedAt?: string;
}): WorldAuditReport {
  const rules = input.rules || CORE_WORLD_REALITY_RULES;
  const findings: WorldAuditFinding[] = [];

  input.history.forEach((node, nodeIndex) => {
    const context = {
      routeId: input.routeId,
      nodeIndex,
      node,
      previousNode: input.history[nodeIndex - 1],
      nextNode: input.history[nodeIndex + 1],
      ageInMonths: nodeAgeInMonths(node)
    };
    for (const rule of rules) findings.push(...rule.evaluate(context));
  });

  const findingsByDomain: Partial<Record<WorldAuditDomain, number>> = {};
  const findingsByCategory: Partial<Record<WorldRuleCategory, number>> = {};
  for (const issue of findings) {
    findingsByDomain[issue.domain] = (findingsByDomain[issue.domain] || 0) + 1;
    findingsByCategory[issue.category] = (findingsByCategory[issue.category] || 0) + 1;
  }
  const blocking = findings.filter((issue) => issue.severity === "blocking").length;
  const warning = findings.filter((issue) => issue.severity === "warning").length;
  const info = findings.filter((issue) => issue.severity === "info").length;

  return {
    schemaVersion: 1,
    routeId: input.routeId,
    generatedAt: input.generatedAt || new Date().toISOString(),
    nodeCount: input.history.length,
    evaluatedRuleIds: rules.map((rule) => rule.id),
    summary: {
      passed: blocking === 0,
      blocking,
      warning,
      info,
      findingsByDomain,
      findingsByCategory
    },
    findings
  };
}
