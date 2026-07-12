import { ChoiceTemporalHint, HistoryItem, LifeAttributes, LifeIntensity, LifeStage, TemporalProfile } from "../types";
import { stableHash, stableInteger } from "./stableRandom";

export interface TimelineAdvance {
  elapsedMonths: number;
  targetAgeInMonths: number;
  targetAge: number;
  lifeIntensity: LifeIntensity;
  reasonCodes: string[];
}

export const DEFAULT_TEMPORAL_PROFILES: Record<LifeIntensity, TemporalProfile> = {
  critical: { lifeIntensity: "critical", durationMonths: [1, 6], requiresFollowUp: true },
  high_tension: { lifeIntensity: "high_tension", durationMonths: [6, 12], requiresFollowUp: true },
  normal: { lifeIntensity: "normal", durationMonths: [12, 36], requiresFollowUp: false },
  stable: { lifeIntensity: "stable", durationMonths: [36, 60], requiresFollowUp: false }
};

const intensityRank: Record<LifeIntensity, number> = {
  stable: 0,
  normal: 1,
  high_tension: 2,
  critical: 3
};

export function deriveLifeStage(age: number): LifeStage {
  if (age <= 12) return "childhood";
  if (age <= 17) return "adolescence";
  if (age <= 24) return "emerging_adulthood";
  if (age <= 34) return "early_adulthood";
  if (age <= 49) return "midlife";
  if (age <= 64) return "mature_adulthood";
  if (age <= 79) return "later_life";
  return "longevity";
}

export function mergeTemporalProfiles(left: TemporalProfile, right: TemporalProfile): TemporalProfile {
  if (intensityRank[left.lifeIntensity] !== intensityRank[right.lifeIntensity]) {
    const winner = intensityRank[left.lifeIntensity] > intensityRank[right.lifeIntensity] ? left : right;
    return { ...winner, durationMonths: [...winner.durationMonths] as [number, number], requiresFollowUp: left.requiresFollowUp || right.requiresFollowUp };
  }

  const intersection: [number, number] = [
    Math.max(left.durationMonths[0], right.durationMonths[0]),
    Math.min(left.durationMonths[1], right.durationMonths[1])
  ];
  const durationMonths = intersection[0] <= intersection[1]
    ? intersection
    : left.durationMonths[1] <= right.durationMonths[1]
      ? left.durationMonths
      : right.durationMonths;

  return {
    lifeIntensity: left.lifeIntensity,
    durationMonths: [...durationMonths] as [number, number],
    requiresFollowUp: left.requiresFollowUp || right.requiresFollowUp
  };
}

export function deriveTemporalProfile(input: {
  pressurePhaseProfile?: TemporalProfile;
  choiceHint?: ChoiceTemporalHint;
  eventProfile?: TemporalProfile;
  attributes: LifeAttributes;
  stableNodeCount?: number;
}): TemporalProfile {
  if (input.pressurePhaseProfile) {
    return { ...input.pressurePhaseProfile, durationMonths: [...input.pressurePhaseProfile.durationMonths] as [number, number] };
  }

  let profile = input.eventProfile
    ? { ...input.eventProfile, durationMonths: [...input.eventProfile.durationMonths] as [number, number] }
    : input.stableNodeCount && input.stableNodeCount >= 2
      ? DEFAULT_TEMPORAL_PROFILES.stable
      : DEFAULT_TEMPORAL_PROFILES.normal;

  if (input.choiceHint) profile = mergeTemporalProfiles(profile, input.choiceHint);

  if (input.attributes.health < 25 || input.attributes.wealth < 15) {
    profile = mergeTemporalProfiles(profile, DEFAULT_TEMPORAL_PROFILES.high_tension);
  }

  return { ...profile, durationMonths: [...profile.durationMonths] as [number, number] };
}

function clampDurationByStage(range: [number, number], stage: LifeStage): [number, number] {
  const maxMonths = stage === "childhood" || stage === "adolescence"
    ? 12
    : stage === "emerging_adulthood"
      ? 24
      : range[1];
  return [Math.min(range[0], maxMonths), Math.min(range[1], maxMonths)];
}

export function calculateTimelineAdvance(input: {
  currentAgeInMonths: number;
  temporalProfile: TemporalProfile;
  simulationSeed: string;
  branchFingerprint: string;
  hardMaximumAge: number;
  nextMilestoneAgeInMonths?: number;
}): TimelineAdvance {
  const currentAge = Math.floor(input.currentAgeInMonths / 12);
  const stage = deriveLifeStage(currentAge);
  const [minMonths, maxMonths] = clampDurationByStage(input.temporalProfile.durationMonths, stage);
  const sampledMonths = stableInteger(minMonths, maxMonths, {
    namespace: "timeline-advance",
    seed: input.simulationSeed,
    branch: input.branchFingerprint,
    age: input.currentAgeInMonths,
    intensity: input.temporalProfile.lifeIntensity
  });
  const hardMaximum = input.hardMaximumAge * 12;
  const milestoneMaximum = typeof input.nextMilestoneAgeInMonths === "number" && input.nextMilestoneAgeInMonths > input.currentAgeInMonths
    ? input.nextMilestoneAgeInMonths
    : Number.POSITIVE_INFINITY;
  const targetAgeInMonths = Math.min(input.currentAgeInMonths + sampledMonths, hardMaximum, milestoneMaximum);
  const elapsedMonths = Math.max(1, targetAgeInMonths - input.currentAgeInMonths);

  return {
    elapsedMonths,
    targetAgeInMonths,
    targetAge: Math.floor(targetAgeInMonths / 12),
    lifeIntensity: input.temporalProfile.lifeIntensity,
    reasonCodes: [`intensity:${input.temporalProfile.lifeIntensity}`, `stage:${stage}`]
  };
}

export function buildBranchFingerprint(history: HistoryItem[], selectedDecision: string, nodeIndex: number): string {
  return stableHash({
    history: history.map((item) => ({ ageInMonths: item.ageInMonths ?? item.age * 12, title: item.title, selectedChoice: item.selectedChoice })),
    selectedDecision: selectedDecision.trim(),
    nodeIndex
  });
}

export function formatAgeInMonths(ageInMonths: number): string {
  const years = Math.floor(ageInMonths / 12);
  const months = ageInMonths % 12;
  return months === 0 ? `${years} 岁` : `${years} 岁 ${months} 个月`;
}
