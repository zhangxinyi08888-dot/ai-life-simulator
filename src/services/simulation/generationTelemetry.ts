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

export interface GenerationCallTrace {
  traceId: string;
  transactionId?: string;
  nodeIndex?: number;
  candidateRevision?: number;
  candidateHash?: string;
  kind: GenerationCallKind;
  issueCodes: string[];
  startedAt: string;
  firstTokenAt?: string;
  completedAt?: string;
  durationMs?: number;
  outcome: "started" | "succeeded" | "failed" | "aborted";
  errorCode?: string;
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
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
}

export interface GenerationTraceContext {
  transactionId?: string;
  nodeIndex?: number;
  candidateRevision?: number;
  candidateHash?: string;
  issueCodes?: string[];
}

export type GenerationTraceListener = (trace: GenerationCallTrace) => void;

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
  return error instanceof DOMException && error.name === "AbortError"
    || errorCode(error) === "AI_REQUEST_ABORTED";
}

export async function traceGenerationCall<T>(input: {
  kind: GenerationCallKind;
  context?: GenerationTraceContext;
  listener?: GenerationTraceListener;
  operation: (markFirstToken: () => void) => Promise<T>;
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
    issueCodes: [...(input.context?.issueCodes ?? [])],
    startedAt,
    outcome: "started"
  };
  input.listener?.(base);
  try {
    const result = await input.operation(() => {
      if (!firstTokenAt) firstTokenAt = new Date().toISOString();
    });
    const completedMs = Date.now();
    input.listener?.({
      ...base,
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
    visiblePause: false
  };
}
