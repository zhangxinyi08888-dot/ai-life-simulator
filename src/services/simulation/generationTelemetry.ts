import type { AiUsage } from "../../utils/deepseek";

export type GenerationCallKind =
  | "initial_generation"
  | "candidate_patch"
  | "full_regeneration"
  | "proposal_repair"
  | "financial_narrative_repair"
  | "romance_candidate_extraction"
  | "relationship_authority_fallback"
  | "health_evidence_repair"
  | "final_outcome_generation"
  | "outer_recovery";

export type GenerationPromptFamily =
  | "next_node"
  | "candidate_patch"
  | "financial_proposal_repair"
  | "financial_narrative_repair"
  | "romance_candidate"
  | "final_outcome"
  | "other";

export interface GenerationCallTrace {
  traceId: string;
  transactionId?: string;
  nodeIndex?: number;
  candidateRevision?: number;
  candidateHash?: string;
  kind: GenerationCallKind;
  /** Prompt classification only; prompt text and user data are never traced. */
  promptFamily?: GenerationPromptFamily;
  /** Telemetry label only; it is intentionally not sent to the model. */
  promptPrefixVersion?: string;
  issueCodes: string[];
  startedAt: string;
  firstTokenAt?: string;
  completedAt?: string;
  durationMs?: number;
  outcome: "started" | "succeeded" | "failed" | "aborted";
  errorCode?: string;
  promptTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  model?: string;
  /** Legacy aliases kept for existing collectors. */
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
  /** Explicitly distinguishes a provider that returned no usage from an uninspected trace. */
  providerUsageStatus?: "reported" | "missing";
}

export interface NodeGenerationSummary {
  fullGenerationCount: number;
  modelPatchCount: number;
  auxiliaryCallCount: number;
  totalModelCallCount: number;
  totalModelLatencyMs: number;
  firstTokenLatencyMs?: number;
  deterministicRepairCodes: string[];
  patchIssueCodes: string[];
  fullRegenerationReasonCodes: string[];
  visiblePause: boolean;
  promptTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  usageCallCount: number;
  missingUsageCallCount: number;
  cacheHitRate?: number;
}

export interface GenerationTraceContext {
  transactionId?: string;
  nodeIndex?: number;
  candidateRevision?: number;
  candidateHash?: string;
  issueCodes?: string[];
  promptFamily?: GenerationPromptFamily;
  promptPrefixVersion?: string;
}

export type GenerationTraceListener = (trace: GenerationCallTrace) => void;

export interface GenerationResponseMetadata {
  usage?: AiUsage;
  providerRequestId?: string;
  model?: string;
}

function traceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `generation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; name?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return typeof candidate.name === "string" ? candidate.name : undefined;
}

function isAbort(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && (error as { name?: unknown }).name === "AbortError"
    || errorCode(error) === "AI_REQUEST_ABORTED";
}

function responseTraceFields(metadata: GenerationResponseMetadata | undefined): Pick<GenerationCallTrace,
  "promptTokens" | "cacheHitTokens" | "cacheMissTokens" | "completionTokens" | "totalTokens" | "inputTokens" | "outputTokens" | "providerRequestId" | "model" | "providerUsageStatus"
> {
  const usage = metadata?.usage;
  return {
    promptTokens: usage?.promptTokens,
    cacheHitTokens: usage?.cacheHitTokens,
    cacheMissTokens: usage?.cacheMissTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    inputTokens: usage?.promptTokens,
    outputTokens: usage?.completionTokens,
    providerRequestId: metadata?.providerRequestId,
    model: metadata?.model,
    providerUsageStatus: usage ? "reported" : "missing"
  };
}

export async function traceGenerationCall<T>(input: {
  kind: GenerationCallKind;
  context?: GenerationTraceContext;
  listener?: GenerationTraceListener;
  operation: (
    markFirstToken: () => void,
    recordResponseMetadata: (metadata: GenerationResponseMetadata) => void
  ) => Promise<T>;
}): Promise<T> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  let firstTokenAt: string | undefined;
  const base: GenerationCallTrace = {
    traceId: traceId(),
    transactionId: input.context?.transactionId,
    nodeIndex: input.context?.nodeIndex,
    candidateRevision: input.context?.candidateRevision,
    candidateHash: input.context?.candidateHash,
    kind: input.kind,
    promptFamily: input.context?.promptFamily,
    promptPrefixVersion: input.context?.promptPrefixVersion,
    issueCodes: [...(input.context?.issueCodes ?? [])],
    startedAt,
    outcome: "started"
  };
  input.listener?.(base);
  let metadata: GenerationResponseMetadata | undefined;
  try {
    const result = await input.operation(() => {
      if (!firstTokenAt) firstTokenAt = new Date().toISOString();
    }, (nextMetadata) => {
      metadata = {
        usage: nextMetadata.usage ?? metadata?.usage,
        providerRequestId: nextMetadata.providerRequestId ?? metadata?.providerRequestId,
        model: nextMetadata.model ?? metadata?.model
      };
    });
    const completedMs = Date.now();
    input.listener?.({
      ...base,
      ...responseTraceFields(metadata),
      firstTokenAt,
      completedAt: new Date(completedMs).toISOString(),
      durationMs: completedMs - startedMs,
      outcome: "succeeded"
    });
    return result;
  } catch (error) {
    const completedMs = Date.now();
    input.listener?.({
      ...base,
      ...responseTraceFields(metadata),
      firstTokenAt,
      completedAt: new Date(completedMs).toISOString(),
      durationMs: completedMs - startedMs,
      outcome: isAbort(error) ? "aborted" : "failed",
      errorCode: errorCode(error)
    });
    throw error;
  }
}

export function summarizeGenerationTraces(traces: GenerationCallTrace[]): NodeGenerationSummary {
  const completed = traces.filter((trace) => trace.outcome !== "started");
  const firstStarted = traces.find((trace) => trace.outcome === "started");
  const firstCompletedWithToken = completed.find((trace) => trace.firstTokenAt);
  const firstTokenLatencyMs = firstStarted && firstCompletedWithToken?.firstTokenAt
    ? Math.max(0, Date.parse(firstCompletedWithToken.firstTokenAt) - Date.parse(firstStarted.startedAt))
    : undefined;
  const fullKinds = new Set<GenerationCallKind>(["initial_generation", "full_regeneration"]);
  const auxiliaryKinds = new Set<GenerationCallKind>([
    "financial_narrative_repair",
    "romance_candidate_extraction",
    "relationship_authority_fallback",
    "health_evidence_repair",
    "outer_recovery"
  ]);
  const usageTraces = completed.filter((trace) => trace.promptTokens !== undefined);
  const promptTokens = usageTraces.reduce((sum, trace) => sum + (trace.promptTokens ?? 0), 0);
  const cacheHitTokens = usageTraces.reduce((sum, trace) => sum + (trace.cacheHitTokens ?? 0), 0);
  const cacheMissTokens = usageTraces.reduce((sum, trace) => sum + (trace.cacheMissTokens ?? 0), 0);
  const completionTokens = usageTraces.reduce((sum, trace) => sum + (trace.completionTokens ?? 0), 0);
  return {
    fullGenerationCount: completed.filter((trace) => fullKinds.has(trace.kind)).length,
    modelPatchCount: completed.filter((trace) => trace.kind === "candidate_patch" || trace.kind === "proposal_repair").length,
    auxiliaryCallCount: completed.filter((trace) => auxiliaryKinds.has(trace.kind)).length,
    totalModelCallCount: completed.length,
    totalModelLatencyMs: completed.reduce((sum, trace) => sum + (trace.durationMs ?? 0), 0),
    firstTokenLatencyMs,
    deterministicRepairCodes: [],
    patchIssueCodes: [...new Set(completed.filter((trace) => trace.kind === "candidate_patch").flatMap((trace) => trace.issueCodes))],
    fullRegenerationReasonCodes: [...new Set(completed.filter((trace) => trace.kind === "full_regeneration").flatMap((trace) => trace.issueCodes))],
    visiblePause: false,
    promptTokens,
    cacheHitTokens,
    cacheMissTokens,
    completionTokens,
    usageCallCount: usageTraces.length,
    missingUsageCallCount: completed.length - usageTraces.length,
    cacheHitRate: cacheHitTokens + cacheMissTokens > 0
      ? cacheHitTokens / (cacheHitTokens + cacheMissTokens)
      : undefined
  };
}
