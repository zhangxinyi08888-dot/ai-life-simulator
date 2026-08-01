import type { SimulationChoice, WorldDelta } from "../../types";
import { splitNarrativeParagraphs } from "../../utils/narrativePresentation";
import { stableHash } from "../../utils/stableRandom";
import { hashNodeCandidate } from "./nodeCandidateHash";
import type {
  NodeCandidateEnvelope,
  NodeCandidatePatch,
  SimulationNodeCandidate
} from "./nodeCandidateTypes";

export type NodeCandidatePatchRejectionCode =
  | "PATCH_CONTRACT_INVALID"
  | "STALE_OR_DUPLICATE_PATCH"
  | "PATCH_SURFACE_NOT_ALLOWED"
  | "PATCH_PARAGRAPH_STALE"
  | "PATCH_VALUE_INVALID";

export type ApplyNodeCandidatePatchResult =
  | { ok: true; envelope: NodeCandidateEnvelope }
  | { ok: false; code: NodeCandidatePatchRejectionCode; message: string };

const PATCH_KEYS = new Set([
  "contractVersion",
  "baseCandidateHash",
  "targetCandidateRevision",
  "addressedIssueCodes",
  "titleReplacement",
  "descriptionParagraphPatches",
  "replacementChoices",
  "proposalPatch",
  "narrativeMetaPatch"
]);

const PROPOSAL_PATCH_KEYS = new Set(["financialEventProposals", "employmentTransition", "worldDeltas"]);
const NARRATIVE_PATCH_KEYS = new Set(["storyEpisode", "arcSignals"]);

function onlyKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validChoice(choice: SimulationChoice, allowedOutcomeIds: string[]): boolean {
  if (!nonEmptyString(choice.id) || !nonEmptyString(choice.text) || !nonEmptyString(choice.impactSummary)) return false;
  if (choice.eventOutcomeId && allowedOutcomeIds.length > 0 && !allowedOutcomeIds.includes(choice.eventOutcomeId)) return false;
  return true;
}

function validStoryEpisode(value: unknown): boolean {
  if (!isObject(value)) return false;
  return nonEmptyString(value.id)
    && Number.isInteger(value.startAgeInMonths)
    && Number.isInteger(value.endAgeInMonths)
    && Number(value.endAgeInMonths) >= Number(value.startAgeInMonths)
    && Array.isArray(value.internalTransitions)
    && nonEmptyString(value.decisionCheckpointId)
    && nonEmptyString(value.summary);
}

function validArcSignals(value: unknown): boolean {
  return Array.isArray(value) && value.every((signal) => (
    isObject(signal)
    && nonEmptyString(signal.type)
    && nonEmptyString(signal.evidence)
    && Number.isFinite(signal.confidence)
    && Number(signal.confidence) >= 0
    && Number(signal.confidence) <= 1
  ));
}

function withEmploymentTransition(
  worldDeltas: WorldDelta[],
  employmentTransition: NonNullable<NodeCandidatePatch["proposalPatch"]>["employmentTransition"]
): WorldDelta[] {
  const withoutCareerTransition = worldDeltas.filter((delta) => delta.type !== "career_state" || !delta.employmentTransition);
  if (!employmentTransition) return withoutCareerTransition;
  return [
    ...withoutCareerTransition,
    { type: "career_state", summary: employmentTransition.evidence, employmentTransition }
  ];
}

export function paragraphId(index: number, text: string): string {
  return `description:${index}:${stableHash(text)}`;
}

export function applyNodeCandidatePatch(
  envelope: NodeCandidateEnvelope,
  rawPatch: unknown
): ApplyNodeCandidatePatchResult {
  if (!isObject(rawPatch) || !onlyKeys(rawPatch, PATCH_KEYS)) {
    return { ok: false, code: "PATCH_CONTRACT_INVALID", message: "Patch 包含未知顶层字段或不是对象" };
  }
  const patch = rawPatch as unknown as NodeCandidatePatch;
  if (patch.contractVersion !== "node_candidate_patch_v1"
    || !nonEmptyString(patch.baseCandidateHash)
    || !Array.isArray(patch.addressedIssueCodes)) {
    return { ok: false, code: "PATCH_CONTRACT_INVALID", message: "Patch 缺少版本、候选哈希或 issue codes" };
  }
  if (envelope.patchApplied
    || patch.baseCandidateHash !== envelope.baseCandidateHash
    || patch.targetCandidateRevision !== envelope.candidateRevision) {
    return { ok: false, code: "STALE_OR_DUPLICATE_PATCH", message: "Patch 不属于当前候选版本或已重复应用" };
  }
  const requestedIssueCodes = new Set(envelope.requestedIssueCodes);
  if (requestedIssueCodes.size > 0 && (
    patch.addressedIssueCodes.some((code) => !requestedIssueCodes.has(code))
    || [...requestedIssueCodes].some((code) => !patch.addressedIssueCodes.includes(code))
  )) {
    return { ok: false, code: "PATCH_CONTRACT_INVALID", message: "Patch addressedIssueCodes 与本次请求不一致" };
  }
  const suppliedSurfaces = [
    patch.titleReplacement !== undefined ? "titleReplacement" : undefined,
    patch.descriptionParagraphPatches !== undefined ? "descriptionParagraphPatches" : undefined,
    patch.replacementChoices !== undefined ? "replacementChoices" : undefined,
    patch.proposalPatch !== undefined ? "proposalPatch" : undefined,
    patch.narrativeMetaPatch !== undefined ? "narrativeMetaPatch" : undefined
  ].filter((surface): surface is string => Boolean(surface));
  if (suppliedSurfaces.some((surface) => !envelope.allowedPatchSurfaces.includes(surface))) {
    return { ok: false, code: "PATCH_SURFACE_NOT_ALLOWED", message: "Patch 使用了本次问题未授权的修复面" };
  }
  if (patch.proposalPatch && (!isObject(patch.proposalPatch) || !onlyKeys(patch.proposalPatch, PROPOSAL_PATCH_KEYS))) {
    return { ok: false, code: "PATCH_SURFACE_NOT_ALLOWED", message: "Proposal Patch 包含非白名单字段" };
  }
  if (patch.narrativeMetaPatch && (!isObject(patch.narrativeMetaPatch) || !onlyKeys(patch.narrativeMetaPatch, NARRATIVE_PATCH_KEYS))) {
    return { ok: false, code: "PATCH_SURFACE_NOT_ALLOWED", message: "Narrative Patch 包含非白名单字段" };
  }

  const candidate = structuredClone(envelope.candidate) as SimulationNodeCandidate;
  if (patch.titleReplacement !== undefined) {
    if (!nonEmptyString(patch.titleReplacement)) {
      return { ok: false, code: "PATCH_VALUE_INVALID", message: "替换标题不能为空" };
    }
    candidate.title = patch.titleReplacement.trim();
  }

  if (patch.descriptionParagraphPatches !== undefined) {
    if (!Array.isArray(patch.descriptionParagraphPatches)) {
      return { ok: false, code: "PATCH_CONTRACT_INVALID", message: "段落 Patch 必须是数组" };
    }
    const paragraphs = candidate.descriptionParagraphs?.filter(Boolean)
      ?? splitNarrativeParagraphs(candidate.description);
    const replacements = new Map<number, string>();
    for (const item of patch.descriptionParagraphPatches) {
      if (!isObject(item) || !nonEmptyString(item.paragraphId)
        || !nonEmptyString(item.expectedTextHash) || !nonEmptyString(item.replacementText)) {
        return { ok: false, code: "PATCH_VALUE_INVALID", message: "段落 Patch 字段不完整" };
      }
      const index = paragraphs.findIndex((paragraph, paragraphIndex) => paragraphId(paragraphIndex, paragraph) === item.paragraphId);
      if (index < 0 || stableHash(paragraphs[index]) !== item.expectedTextHash) {
        return { ok: false, code: "PATCH_PARAGRAPH_STALE", message: `段落 ${item.paragraphId} 已变化` };
      }
      replacements.set(index, item.replacementText.trim());
    }
    const nextParagraphs = paragraphs.map((paragraph, index) => replacements.get(index) ?? paragraph);
    candidate.descriptionParagraphs = nextParagraphs;
    candidate.description = nextParagraphs.join("\n\n");
  }

  if (patch.replacementChoices !== undefined) {
    if (!Array.isArray(patch.replacementChoices)
      || patch.replacementChoices.length < 2
      || !patch.replacementChoices.every((choice) => validChoice(choice, envelope.skeleton.allowedOutcomeIds))) {
      return { ok: false, code: "PATCH_VALUE_INVALID", message: "替换选项不满足最小结构或事件授权" };
    }
    const ids = patch.replacementChoices.map((choice) => choice.id);
    if (new Set(ids).size !== ids.length) {
      return { ok: false, code: "PATCH_VALUE_INVALID", message: "替换选项 ID 必须唯一" };
    }
    candidate.choices = structuredClone(patch.replacementChoices);
  }

  if (patch.proposalPatch) {
    if (patch.proposalPatch.financialEventProposals !== undefined) {
      if (!Array.isArray(patch.proposalPatch.financialEventProposals)) {
        return { ok: false, code: "PATCH_VALUE_INVALID", message: "financialEventProposals 必须是数组" };
      }
      candidate.financialEventProposals = structuredClone(patch.proposalPatch.financialEventProposals);
    }
    if (patch.proposalPatch.worldDeltas !== undefined) {
      if (!Array.isArray(patch.proposalPatch.worldDeltas) || !candidate.narrativeMeta) {
        return { ok: false, code: "PATCH_VALUE_INVALID", message: "worldDeltas 需要有效 narrativeMeta" };
      }
      candidate.narrativeMeta.worldDeltas = structuredClone(patch.proposalPatch.worldDeltas);
    }
    if (patch.proposalPatch.employmentTransition !== undefined) {
      if (!candidate.narrativeMeta) {
        return { ok: false, code: "PATCH_VALUE_INVALID", message: "employmentTransition 需要有效 narrativeMeta" };
      }
      candidate.narrativeMeta.worldDeltas = withEmploymentTransition(
        candidate.narrativeMeta.worldDeltas ?? [],
        patch.proposalPatch.employmentTransition
      );
    }
  }

  if (patch.narrativeMetaPatch) {
    if (!candidate.narrativeMeta) {
      return { ok: false, code: "PATCH_VALUE_INVALID", message: "narrativeMeta Patch 需要现有 narrativeMeta" };
    }
    if (patch.narrativeMetaPatch.storyEpisode !== undefined) {
      if (!validStoryEpisode(patch.narrativeMetaPatch.storyEpisode)) {
        return { ok: false, code: "PATCH_VALUE_INVALID", message: "storyEpisode 必须是完整且时间有序的对象" };
      }
      candidate.narrativeMeta.storyEpisode = structuredClone(patch.narrativeMetaPatch.storyEpisode);
    }
    if (patch.narrativeMetaPatch.arcSignals !== undefined) {
      if (!validArcSignals(patch.narrativeMetaPatch.arcSignals)) {
        return { ok: false, code: "PATCH_VALUE_INVALID", message: "arcSignals 必须是数组" };
      }
      candidate.narrativeMeta.arcSignals = structuredClone(patch.narrativeMetaPatch.arcSignals);
    }
  }

  const nextHash = hashNodeCandidate(envelope.skeleton, candidate);
  return {
    ok: true,
    envelope: {
      ...envelope,
      candidate,
      baseCandidateHash: nextHash,
      patchApplied: true,
      patchIssueCodes: [...new Set(patch.addressedIssueCodes)]
    }
  };
}
