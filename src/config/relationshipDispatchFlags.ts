export interface RelationshipDispatchFeatureFlags {
  enableLineMixPolicy: boolean;
  enableTrustedFamilyActivation: boolean;
  enableRomanceFormationEvents: boolean;
  enableAuthoritativeRelationshipStages: boolean;
  enableRomanceLifecycleScheduling: boolean;
  enableRomanceFormationAgeAffinity: boolean;
}

export const DEFAULT_RELATIONSHIP_DISPATCH_FEATURE_FLAGS: RelationshipDispatchFeatureFlags = {
  enableLineMixPolicy: true,
  enableTrustedFamilyActivation: true,
  enableRomanceFormationEvents: true,
  enableAuthoritativeRelationshipStages: true,
  enableRomanceLifecycleScheduling: true,
  enableRomanceFormationAgeAffinity: true
};

export function relationshipDispatchFeatureFlags(
  overrides?: Partial<RelationshipDispatchFeatureFlags>
): RelationshipDispatchFeatureFlags {
  return { ...DEFAULT_RELATIONSHIP_DISPATCH_FEATURE_FLAGS, ...overrides };
}
