import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RELATIONSHIP_DISPATCH_FEATURE_FLAGS, relationshipDispatchFeatureFlags } from "./relationshipDispatchFlags";

test("relationship dispatch flags default on and can independently roll back line mixing", () => {
  assert.equal(DEFAULT_RELATIONSHIP_DISPATCH_FEATURE_FLAGS.enableAuthoritativeRelationshipStages, true);
  const flags = relationshipDispatchFeatureFlags({ enableLineMixPolicy: false });
  assert.equal(flags.enableLineMixPolicy, false);
  assert.equal(flags.enableRomanceFormationEvents, true);
  assert.equal(flags.enableTrustedFamilyActivation, true);
  assert.equal(flags.enableRomanceLifecycleScheduling, true);
  assert.equal(flags.enableRomanceFormationAgeAffinity, true);
});
