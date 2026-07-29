import { LifeIntensity } from "../types";

export interface ReportInvitationPolicy {
  minChoicesForArcResolution: number;
  minChoicesForStableWindow: number;
  chronicFinancialDebtArcChoices: number;
  reinviteAfterChoices: number;
  safeIntensities: LifeIntensity[];
}

export const DEFAULT_REPORT_INVITATION_POLICY: ReportInvitationPolicy = {
  minChoicesForArcResolution: 12,
  minChoicesForStableWindow: 15,
  chronicFinancialDebtArcChoices: 8,
  reinviteAfterChoices: 6,
  safeIntensities: ["normal", "stable"]
};
