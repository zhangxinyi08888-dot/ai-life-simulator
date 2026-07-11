import assert from "node:assert/strict";
import { calculateTimelineAdvance, DEFAULT_TEMPORAL_PROFILES, deriveLifeStage, deriveTemporalProfile, mergeTemporalProfiles } from "./timelineAdvance";

assert.equal(deriveLifeStage(12), "childhood");
assert.equal(deriveLifeStage(65), "later_life");
assert.equal(deriveLifeStage(80), "longevity");

const merged = mergeTemporalProfiles(DEFAULT_TEMPORAL_PROFILES.stable, DEFAULT_TEMPORAL_PROFILES.high_tension);
assert.equal(merged.lifeIntensity, "high_tension");
assert.deepEqual(merged.durationMonths, [6, 12]);

const phaseOwned = deriveTemporalProfile({
  pressurePhaseProfile: DEFAULT_TEMPORAL_PROFILES.stable,
  eventProfile: DEFAULT_TEMPORAL_PROFILES.high_tension,
  attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 }
});
assert.equal(phaseOwned.lifeIntensity, "stable");

const startup = calculateTimelineAdvance({
  currentAgeInMonths: 30 * 12,
  temporalProfile: DEFAULT_TEMPORAL_PROFILES.high_tension,
  simulationSeed: "seed",
  branchFingerprint: "startup",
  hardMaximumAge: 110
});
assert.ok(startup.elapsedMonths >= 6 && startup.elapsedMonths <= 12);

const retirement = calculateTimelineAdvance({
  currentAgeInMonths: 60 * 12,
  temporalProfile: DEFAULT_TEMPORAL_PROFILES.stable,
  simulationSeed: "seed",
  branchFingerprint: "retirement",
  hardMaximumAge: 110
});
assert.ok(retirement.elapsedMonths >= 36 && retirement.elapsedMonths <= 60);

const adolescent = calculateTimelineAdvance({
  currentAgeInMonths: 16 * 12,
  temporalProfile: DEFAULT_TEMPORAL_PROFILES.stable,
  simulationSeed: "seed",
  branchFingerprint: "school",
  hardMaximumAge: 110
});
assert.ok(adolescent.elapsedMonths <= 12);

const repeated = calculateTimelineAdvance({
  currentAgeInMonths: 30 * 12,
  temporalProfile: DEFAULT_TEMPORAL_PROFILES.high_tension,
  simulationSeed: "seed",
  branchFingerprint: "startup",
  hardMaximumAge: 110
});
assert.deepEqual(startup, repeated);
