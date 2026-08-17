import type { ExpenseCommitmentV4, ExpenseResponsibilityCandidate } from "./types";

export type ParentElderCareCoverageRole = "aggregate" | "individual";

type ElderCareResponsibility = Pick<
  ExpenseCommitmentV4 | ExpenseResponsibilityCandidate,
  "responsibilityKind" | "responsibilityKey" | "participantPersonIds"
>;

const AGGREGATE_PARENT_CARE_KEYS = new Set([
  "elder_care:parents",
  "elder_care:opening_parent"
]);

/**
 * Only parent-beneficiary care accounts participate in the aggregate-parent
 * coverage rule. `elder_care:care_plan` is the protagonist's own long-term
 * care account, so it must be allowed beside a parent aggregate.
 */
export function parentElderCareCoverageRole(input: ElderCareResponsibility): ParentElderCareCoverageRole | undefined {
  if (input.responsibilityKind !== "elder_care" || !input.responsibilityKey.startsWith("elder_care:")) return undefined;
  if (AGGREGATE_PARENT_CARE_KEYS.has(input.responsibilityKey)) return "aggregate";
  if (input.responsibilityKey === "elder_care:care_plan") return undefined;

  const beneficiaryKey = input.responsibilityKey.slice("elder_care:".length);
  if (input.participantPersonIds?.length || /^(?:mother|father|parent)(?:[_:-]|$)/u.test(beneficiaryKey)) {
    return "individual";
  }
  return undefined;
}
