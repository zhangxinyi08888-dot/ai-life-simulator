export interface NodeGenerationBudget {
  fullGenerationLimit: number;
  modelPatchLimit: number;
  transientNetworkRetryPerCall: number;
  fullGenerationsUsed: number;
  modelPatchesUsed: number;
}

export type NodeGenerationBudgetCode = "FULL_GENERATION_BUDGET_EXHAUSTED" | "MODEL_PATCH_BUDGET_EXHAUSTED";

export class NodeGenerationBudgetError extends Error {
  readonly code: NodeGenerationBudgetCode;

  constructor(code: NodeGenerationBudgetCode) {
    super(code);
    this.name = "NodeGenerationBudgetError";
    this.code = code;
  }
}

export function createNodeGenerationBudget(input: Partial<Pick<NodeGenerationBudget,
  "fullGenerationLimit" | "modelPatchLimit" | "transientNetworkRetryPerCall"
>> = {}): NodeGenerationBudget {
  return {
    fullGenerationLimit: input.fullGenerationLimit ?? 2,
    modelPatchLimit: input.modelPatchLimit ?? 1,
    transientNetworkRetryPerCall: input.transientNetworkRetryPerCall ?? 1,
    fullGenerationsUsed: 0,
    modelPatchesUsed: 0
  };
}

export function consumeFullGeneration(budget: NodeGenerationBudget): 0 | 1 {
  if (budget.fullGenerationsUsed >= budget.fullGenerationLimit) {
    throw new NodeGenerationBudgetError("FULL_GENERATION_BUDGET_EXHAUSTED");
  }
  const revision = budget.fullGenerationsUsed as 0 | 1;
  budget.fullGenerationsUsed += 1;
  return revision;
}

export function consumeModelPatch(budget: NodeGenerationBudget): void {
  if (budget.modelPatchesUsed >= budget.modelPatchLimit) {
    throw new NodeGenerationBudgetError("MODEL_PATCH_BUDGET_EXHAUSTED");
  }
  budget.modelPatchesUsed += 1;
}

export function canRegenerate(budget: NodeGenerationBudget): boolean {
  return budget.fullGenerationsUsed < budget.fullGenerationLimit;
}

export function canPatch(budget: NodeGenerationBudget): boolean {
  return budget.modelPatchesUsed < budget.modelPatchLimit;
}
