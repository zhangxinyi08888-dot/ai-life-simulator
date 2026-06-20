import { SimulationNode } from "../types";
import { getSimulationNodeValidationIssues, normalizeSimulationNode } from "./simulationResponse";

interface GenerateCompleteNodeOptions {
  fallbackAge?: number;
  minAge?: number;
  maxAge?: number;
  maxAttempts?: number;
}

export async function generateCompleteSimulationNode(
  generateRawNode: (attempt: number, previousIssues: string[]) => Promise<Record<string, any>>,
  options: GenerateCompleteNodeOptions = {}
): Promise<SimulationNode> {
  const maxAttempts = options.maxAttempts ?? 3;
  let issues: string[] = [];
  let lastNode: Record<string, any> = {};

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastNode = await generateRawNode(attempt, issues);
    issues = getSimulationNodeValidationIssues(lastNode);
    if (issues.length === 0) {
      return normalizeSimulationNode(lastNode, options);
    }
  }

  throw new Error(`SIMULATION_NODE_INCOMPLETE:${issues.join(",") || "unknown"}`);
}
