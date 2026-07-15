import { LifeIntensity } from "../types";

export interface ReportInvitationPolicy {
  minChoicesForArcResolution: number;
  minChoicesForStableWindow: number;
  safeIntensities: LifeIntensity[];
}

export const DEFAULT_REPORT_INVITATION_POLICY: ReportInvitationPolicy = {
  minChoicesForArcResolution: 12,
  minChoicesForStableWindow: 15,
  safeIntensities: ["normal", "stable"]
};
