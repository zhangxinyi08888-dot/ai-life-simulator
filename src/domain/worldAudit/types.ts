import type { HistoryItem } from "../../types";

export type WorldRuleCategory =
  | "hard_invariant"
  | "causal_evidence"
  | "reality_constraint"
  | "statistical_calibration"
  | "current_fact";

export type WorldAuditDomain =
  | "timeline"
  | "finance"
  | "career"
  | "people"
  | "relationship"
  | "health"
  | "arc"
  | "event"
  | "ending"
  | "cross_domain";

export type WorldAuditSeverity = "blocking" | "warning" | "info";

export interface WorldAuditFinding {
  ruleId: string;
  category: WorldRuleCategory;
  domain: WorldAuditDomain;
  severity: WorldAuditSeverity;
  nodeIndex: number;
  ageInMonths: number;
  message: string;
  evidence: Record<string, unknown>;
}

export interface WorldRuleContext {
  routeId?: string;
  nodeIndex: number;
  node: HistoryItem;
  previousNode?: HistoryItem;
  nextNode?: HistoryItem;
  ageInMonths: number;
}

export interface WorldRealityRule {
  id: string;
  title: string;
  category: WorldRuleCategory;
  domain: WorldAuditDomain;
  defaultSeverity: WorldAuditSeverity;
  rationale: string;
  evaluate(context: WorldRuleContext): WorldAuditFinding[];
}

export interface WorldAuditReport {
  schemaVersion: 1;
  routeId?: string;
  generatedAt: string;
  nodeCount: number;
  evaluatedRuleIds: string[];
  summary: {
    passed: boolean;
    blocking: number;
    warning: number;
    info: number;
    findingsByDomain: Partial<Record<WorldAuditDomain, number>>;
    findingsByCategory: Partial<Record<WorldRuleCategory, number>>;
  };
  findings: WorldAuditFinding[];
}
