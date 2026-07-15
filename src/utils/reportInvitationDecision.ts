import { ReportInvitationPolicy } from "../config/reportInvitationPolicy";
import {
  HistoryItem,
  ReportInvitationMeta,
  SimulationNode
} from "../types";
import {
  AcceptedNodeOutcome,
  PressureArcTransitionDecision
} from "./arcLifecycle";
import { stableHash } from "./stableRandom";

export interface ReportInvitationDecision {
  shouldInvite: boolean;
  invitation?: ReportInvitationMeta;
  reasonCodes: string[];
}

function isSafeNode(node: Pick<SimulationNode, "narrativeMeta">, policy: ReportInvitationPolicy): boolean {
  const intensity = node.narrativeMeta?.lifeIntensity ?? "normal";
  return policy.safeIntensities.includes(intensity);
}

function isArcBoundary(node: Pick<SimulationNode, "worldStateSnapshot" | "committedArcMeta">): boolean {
  return Boolean(node.worldStateSnapshot?.foregroundPressureArcId)
    || Boolean(node.committedArcMeta?.pressureArcId);
}

function isTensionBoundary(node: Pick<SimulationNode, "narrativeMeta">): boolean {
  const intensity = node.narrativeMeta?.lifeIntensity;
  return intensity === "critical" || intensity === "high_tension";
}

export function findStableEpisodeStartChoiceCount(
  history: HistoryItem[],
  candidateNode: SimulationNode
): number {
  const nodes: Array<HistoryItem | SimulationNode> = [...history, candidateNode];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (isArcBoundary(nodes[index]) || isTensionBoundary(nodes[index])) {
      return index + 1;
    }
  }
  return 0;
}

function directlyContinuedResolvedArcId(history: HistoryItem[], candidateNode: SimulationNode): string | undefined {
  const nodes: Array<HistoryItem | SimulationNode> = [...history, candidateNode];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (isTensionBoundary(node)) return undefined;
    const arcMeta = node.committedArcMeta;
    if (!arcMeta?.pressureArcId) continue;
    return arcMeta.transitionAction === "resolve" ? arcMeta.pressureArcId : undefined;
  }
  return undefined;
}

function hasActiveForegroundArc(node: SimulationNode): boolean {
  const snapshot = node.worldStateSnapshot;
  if (!snapshot?.foregroundPressureArcId) return false;
  return snapshot.pressureArcs.some((arc) => (
    arc.id === snapshot.foregroundPressureArcId
    && (arc.status === "active" || arc.status === "stabilizing")
  ));
}

function previousTriggerKeys(history: HistoryItem[]): Set<string> {
  return new Set(history.flatMap((item) => item.reportInvitation?.triggerKey ? [item.reportInvitation.triggerKey] : []));
}

function buildInvitation(input: {
  reason: ReportInvitationMeta["reason"];
  triggerKey: string;
  completedChoiceCount: number;
  pressureArcId?: string;
  resolutionEvidence?: string[];
  simulationSeed: string;
  branchFingerprint: string;
}): ReportInvitationMeta {
  return {
    id: stableHash({
      namespace: "report-invitation",
      simulationSeed: input.simulationSeed,
      branchFingerprint: input.branchFingerprint,
      triggerKey: input.triggerKey,
      completedChoiceCount: input.completedChoiceCount
    }),
    status: "pending",
    reason: input.reason,
    triggerKey: input.triggerKey,
    completedChoiceCount: input.completedChoiceCount,
    pressureArcId: input.pressureArcId,
    resolutionEvidence: input.resolutionEvidence
  };
}

export function evaluateReportInvitation(input: {
  candidateNode: SimulationNode;
  history: HistoryItem[];
  completedChoiceCount: number;
  pressureArcTransition: PressureArcTransitionDecision;
  acceptedOutcome: AcceptedNodeOutcome;
  policy: ReportInvitationPolicy;
  simulationSeed: string;
  branchFingerprint: string;
}): ReportInvitationDecision {
  if (input.candidateNode.isEndingNode) {
    return { shouldInvite: false, reasonCodes: ["mortality-node"] };
  }

  const invitedKeys = previousTriggerKeys(input.history);
  const resolvedArcId = input.pressureArcTransition.nextArcState?.id;
  const resolvedSignal = resolvedArcId
    ? input.acceptedOutcome.arcSignals.find((signal) => (
        signal.type === "pressure_resolved"
        && signal.pressureArcId === resolvedArcId
      ))
    : undefined;

  if (
    input.completedChoiceCount >= input.policy.minChoicesForArcResolution
    && input.pressureArcTransition.action === "resolve"
    && resolvedArcId
    && resolvedSignal
    && isSafeNode(input.candidateNode, input.policy)
  ) {
    const triggerKey = `arc:${resolvedArcId}`;
    if (!invitedKeys.has(triggerKey)) {
      const supplementalEvidence = input.acceptedOutcome.arcSignals
        .filter((signal) => signal.pressureArcId === resolvedArcId && signal.evidence)
        .map((signal) => signal.evidence);
      const resolutionEvidence = Array.from(new Set([resolvedSignal.evidence, ...supplementalEvidence]));
      return {
        shouldInvite: true,
        invitation: buildInvitation({
          reason: "arc_resolved",
          triggerKey,
          completedChoiceCount: input.completedChoiceCount,
          pressureArcId: resolvedArcId,
          resolutionEvidence,
          simulationSeed: input.simulationSeed,
          branchFingerprint: input.branchFingerprint
        }),
        reasonCodes: ["arc-resolved", "safe-intensity", "resolution-evidence"]
      };
    }
    return { shouldInvite: false, reasonCodes: ["arc-stage-already-invited"] };
  }

  if (input.pressureArcTransition.action === "resolve") {
    return {
      shouldInvite: false,
      reasonCodes: [
        "resolve-not-invitable",
        resolvedSignal ? "resolution-evidence-present" : "resolution-evidence-missing"
      ]
    };
  }

  const previousNode = input.history.at(-1);
  if (
    input.completedChoiceCount >= input.policy.minChoicesForStableWindow
    && previousNode
    && isSafeNode(previousNode, input.policy)
    && isSafeNode(input.candidateNode, input.policy)
    && !hasActiveForegroundArc(input.candidateNode)
  ) {
    const continuedArcId = directlyContinuedResolvedArcId(input.history, input.candidateNode);
    const stableEpisodeStart = findStableEpisodeStartChoiceCount(input.history, input.candidateNode);
    const triggerKey = continuedArcId
      ? `arc:${continuedArcId}`
      : `stable:${stableEpisodeStart}`;
    if (!invitedKeys.has(triggerKey)) {
      return {
        shouldInvite: true,
        invitation: buildInvitation({
          reason: "stable_window",
          triggerKey,
          completedChoiceCount: input.completedChoiceCount,
          pressureArcId: continuedArcId,
          simulationSeed: input.simulationSeed,
          branchFingerprint: input.branchFingerprint
        }),
        reasonCodes: ["stable-window", "no-active-pressure-arc", "new-narrative-stage"]
      };
    }
    return { shouldInvite: false, reasonCodes: ["stable-stage-already-invited"] };
  }

  return { shouldInvite: false, reasonCodes: ["no-invitation-condition"] };
}
