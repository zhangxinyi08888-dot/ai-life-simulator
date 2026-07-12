import {
  HistoryItem,
  OngoingProcess,
  OngoingProcessType,
  ProcessTransitionRequirement,
  WorldDelta
} from "../types";
import { stableHash } from "./stableRandom";

const DEFAULT_DURATION_MONTHS: Record<OngoingProcessType, number> = {
  pregnancy: 9,
  recovery: 6,
  education: 24,
  contract_transition: 6,
  relocation: 3,
  caregiving: 12
};

const DURATION_RANGES: Record<OngoingProcessType, [number, number]> = {
  pregnancy: [9, 9],
  recovery: [1, 18],
  education: [3, 72],
  contract_transition: [1, 18],
  relocation: [1, 12],
  caregiving: [1, 60]
};

const PROCESS_TYPES = new Set<OngoingProcessType>(Object.keys(DEFAULT_DURATION_MONTHS) as OngoingProcessType[]);

export interface ProcessAdvanceResult {
  nextProcesses: OngoingProcess[];
  requiredTransitions: ProcessTransitionRequirement[];
  issues: string[];
}

export interface ValidatedProcessDeltas {
  worldDeltas: WorldDelta[];
  issues: string[];
}

function cloneProcess(process: OngoingProcess): OngoingProcess {
  return {
    ...process,
    subjectPersonIds: [...process.subjectPersonIds],
    exceptionalBasis: process.exceptionalBasis ? [...process.exceptionalBasis] : undefined
  };
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampMonth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeProcessType(value: unknown): OngoingProcessType | undefined {
  return typeof value === "string" && PROCESS_TYPES.has(value as OngoingProcessType)
    ? value as OngoingProcessType
    : undefined;
}

function normalizeStartedProcess(raw: unknown, previousAgeInMonths: number, targetAgeInMonths: number): OngoingProcess | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const type = normalizeProcessType(record.type);
  if (!type) return undefined;
  const subjectPersonIds = Array.isArray(record.subjectPersonIds)
    ? record.subjectPersonIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (subjectPersonIds.length === 0) return undefined;
  const rawStartedAt = readFiniteNumber(record.startedAtAgeInMonths) ?? targetAgeInMonths;
  const startedAtAgeInMonths = clampMonth(rawStartedAt, previousAgeInMonths, targetAgeInMonths);
  const exceptionalBasis = Array.isArray(record.exceptionalBasis)
    ? record.exceptionalBasis.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const id = typeof record.id === "string" && record.id.trim()
    ? record.id.trim()
    : `process_${stableHash({ type, subjectPersonIds, startedAtAgeInMonths })}`;
  const rawExpectedEnd = readFiniteNumber(record.expectedEndAgeInMonths);
  const proposedDuration = rawExpectedEnd == null ? DEFAULT_DURATION_MONTHS[type] : Math.round(rawExpectedEnd - startedAtAgeInMonths);
  const [minimumDuration, maximumDuration] = DURATION_RANGES[type];
  const durationMonths = Math.max(minimumDuration, Math.min(maximumDuration, proposedDuration));

  return {
    id,
    type,
    subjectPersonIds,
    status: "active",
    startedAtAgeInMonths,
    expectedEndAgeInMonths: startedAtAgeInMonths + durationMonths,
    lastUpdatedAtAgeInMonths: targetAgeInMonths,
    exceptionalBasis,
    source: "model_proposed",
    confidence: Math.max(0, Math.min(1, readFiniteNumber(record.confidence) ?? 0.75))
  };
}

export function advanceOngoingProcesses(input: {
  ongoingProcesses?: OngoingProcess[];
  previousAgeInMonths: number;
  targetAgeInMonths: number;
}): ProcessAdvanceResult {
  const issues: string[] = [];
  const requiredTransitions: ProcessTransitionRequirement[] = [];
  const nextProcesses = (input.ongoingProcesses || []).map((process) => {
    const next = cloneProcess(process);
    if (next.lastUpdatedAtAgeInMonths > input.targetAgeInMonths) {
      issues.push(`process ${next.id} lastUpdatedAtAgeInMonths exceeds target timeline`);
      return next;
    }
    if (next.status !== "active") return next;
    next.lastUpdatedAtAgeInMonths = input.targetAgeInMonths;
    if (typeof next.expectedEndAgeInMonths === "number" && input.targetAgeInMonths >= next.expectedEndAgeInMonths) {
      requiredTransitions.push({
        processId: next.id,
        processType: next.type,
        atAgeInMonths: input.targetAgeInMonths,
        allowedActions: ["completed", "interrupted"],
        reason: `${next.type} 已跨过预计结束时间，必须在本轮完成或中断。`
      });
    }
    return next;
  });
  return { nextProcesses, requiredTransitions, issues };
}

export function validateProcessWorldDeltas(input: {
  worldDeltas: WorldDelta[];
  currentProcesses?: OngoingProcess[];
  previousAgeInMonths: number;
  targetAgeInMonths: number;
}): ValidatedProcessDeltas {
  const issues: string[] = [];
  const accepted: WorldDelta[] = [];
  const known = new Map((input.currentProcesses || []).map((process) => [process.id, process]));
  const resolved = new Set<string>();
  const startedInBatch: OngoingProcess[] = [];

  for (const delta of input.worldDeltas) {
    if (delta.type === "process_started") {
      const normalized = normalizeStartedProcess(delta.process, input.previousAgeInMonths, input.targetAgeInMonths);
      if (!normalized) {
        issues.push("process_started contains an invalid process");
        continue;
      }
      if (known.has(normalized.id)) {
        issues.push(`process ${normalized.id} already exists`);
        continue;
      }
      known.set(normalized.id, normalized);
      startedInBatch.push(normalized);
      accepted.push({ type: "process_started", process: normalized });
      continue;
    }

    if (delta.type === "process_completed" || delta.type === "process_interrupted") {
      const process = known.get(delta.processId);
      if (!process || process.status !== "active" || resolved.has(delta.processId)) {
        issues.push(`process ${delta.processId} cannot transition from its current state`);
        continue;
      }
      resolved.add(delta.processId);
      if (delta.type === "process_completed") {
        const completedAt = readFiniteNumber(delta.completedAtAgeInMonths) ?? input.targetAgeInMonths;
        accepted.push({
          type: "process_completed",
          processId: delta.processId,
          completedAtAgeInMonths: clampMonth(completedAt, input.previousAgeInMonths, input.targetAgeInMonths),
          summary: typeof delta.summary === "string" && delta.summary.trim() ? delta.summary.trim() : `${process.type} 已完成`
        });
      } else {
        const interruptedAt = readFiniteNumber(delta.interruptedAtAgeInMonths) ?? input.targetAgeInMonths;
        accepted.push({
          type: "process_interrupted",
          processId: delta.processId,
          interruptedAtAgeInMonths: clampMonth(interruptedAt, input.previousAgeInMonths, input.targetAgeInMonths),
          reason: typeof delta.reason === "string" && delta.reason.trim() ? delta.reason.trim() : `${process.type} 已中断`
        });
      }
      continue;
    }

    accepted.push(delta);
  }
  for (const process of startedInBatch) {
    if (typeof process.expectedEndAgeInMonths === "number"
      && process.expectedEndAgeInMonths <= input.targetAgeInMonths
      && !resolved.has(process.id)) {
      issues.push(`process ${process.id} starts after its expected end without a resolution`);
    }
  }
  return { worldDeltas: accepted, issues };
}

export function unresolvedProcessRequirements(
  requirements: ProcessTransitionRequirement[],
  worldDeltas: WorldDelta[]
): ProcessTransitionRequirement[] {
  const resolvedIds = new Set(worldDeltas.flatMap((delta) => {
    return delta.type === "process_completed" || delta.type === "process_interrupted" ? [delta.processId] : [];
  }));
  return requirements.filter((requirement) => !resolvedIds.has(requirement.processId));
}

export function applyProcessWorldDeltas(
  processes: OngoingProcess[],
  worldDeltas: WorldDelta[],
  targetAgeInMonths: number
): OngoingProcess[] {
  const next = processes.map(cloneProcess);
  for (const delta of worldDeltas) {
    if (delta.type === "process_started") {
      if (next.some((process) => process.id === delta.process.id)) throw new Error(`PROCESS_ALREADY_EXISTS:${delta.process.id}`);
      next.push(cloneProcess(delta.process));
      continue;
    }
    if (delta.type !== "process_completed" && delta.type !== "process_interrupted") continue;
    const index = next.findIndex((process) => process.id === delta.processId);
    if (index < 0 || next[index].status !== "active") throw new Error(`PROCESS_STATE_CONFLICT:${delta.processId}`);
    next[index] = {
      ...next[index],
      status: delta.type === "process_completed" ? "completed" : "interrupted",
      lastUpdatedAtAgeInMonths: targetAgeInMonths,
      completionSummary: delta.type === "process_completed" ? delta.summary : delta.reason
    };
  }
  return next;
}

function chineseMonthNumber(value: string): number | undefined {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const values: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return values[value];
}

export function extractPregnancyMonths(text: string): number | undefined {
  const match = text.match(/(?:怀孕|妊娠)(?:已)?([一二三四五六七八九十\d]+)个?月/);
  return match ? chineseMonthNumber(match[1]) : undefined;
}

export function rebuildOngoingProcessesFromHistory(history: HistoryItem[]): OngoingProcess[] {
  const snapshotProcesses = history[history.length - 1]?.worldStateSnapshot?.ongoingProcesses;
  const preserved = (snapshotProcesses || []).map(cloneProcess);
  if (preserved.some((process) => process.type === "pregnancy" && process.status === "active")) return preserved;
  const recent = history.slice(-5);
  const bornAfter = recent.some((item) => /孩子|婴儿|宝宝/.test(item.description) && /出生|生产|分娩/.test(item.description));
  if (bornAfter) return preserved;
  for (const item of recent) {
    const elapsed = extractPregnancyMonths(item.description);
    if (!elapsed || elapsed < 1 || elapsed > 10) continue;
    const observedAtAgeInMonths = item.ageInMonths ?? item.age * 12;
    const startedAtAgeInMonths = observedAtAgeInMonths - elapsed;
    const subjectPersonId = /妻子|伴侣|爱人/.test(item.description) ? "family_partner" : "protagonist";
    return [...preserved, {
      id: `process_${stableHash({ type: "pregnancy", startedAtAgeInMonths, subject: subjectPersonId })}`,
      type: "pregnancy",
      subjectPersonIds: [subjectPersonId],
      status: "active",
      startedAtAgeInMonths,
      expectedEndAgeInMonths: startedAtAgeInMonths + DEFAULT_DURATION_MONTHS.pregnancy,
      lastUpdatedAtAgeInMonths: observedAtAgeInMonths,
      source: "history",
      confidence: 0.85
    }];
  }
  return preserved;
}

export function processElapsedMonths(process: OngoingProcess, atAgeInMonths: number): number {
  return Math.max(0, atAgeInMonths - process.startedAtAgeInMonths);
}

export function formatOngoingProcessForPrompt(process: OngoingProcess, targetAgeInMonths: number): string {
  const elapsed = processElapsedMonths(process, targetAgeInMonths);
  const due = typeof process.expectedEndAgeInMonths === "number" ? `，预计结束于 ageInMonths=${process.expectedEndAgeInMonths}` : "";
  return `${process.id}：type=${process.type}，status=${process.status}，已持续${elapsed}个月${due}，subject=${process.subjectPersonIds.join(",") || "unknown"}`;
}
