export type FinancialNodeGateMode = "off" | "shadow" | "enforced";

export function resolveFinancialNodeGateMode(value: unknown): FinancialNodeGateMode {
  return value === "off" || value === "shadow" || value === "enforced" ? value : "shadow";
}

export const DEFAULT_FINANCIAL_NODE_GATE_MODE: FinancialNodeGateMode = resolveFinancialNodeGateMode(
  (import.meta as ImportMeta & { env?: ImportMetaEnv }).env?.VITE_FINANCIAL_NODE_GATE_MODE
);

export const FINANCIAL_GATE_MAX_REGENERATIONS = 2;
