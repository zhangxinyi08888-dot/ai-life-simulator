import type {
  ExpenseResponsibilityChange,
  PersonState,
  WorldDelta,
  WorldStateSnapshot
} from "../types";
import type { ExplicitExpenseResponsibilityFact } from "../domain/finance/expenseResponsibility";

const PARENT_WORD = /父母|爸妈|母亲|父亲|妈妈|爸爸/u;
const ONGOING_WORD = /每(?:周|月|天|日)|每隔.{0,4}(?:周|月|天)|固定|持续|长期|定期|按时|规律|其余时间|大部分时间|主要精力/u;
const PLANNED_WORD = /计划|打算|准备|希望|尝试|考虑/u;
const BUSINESS_WORD = /工坊|工作室|办公室|仓库|厂房|门店|服务器|团队|公司租金|经营场地/u;
// An amount-free responsibility declaration can only describe a bill owned
// by the protagonist.  Collective care and group medication do not establish
// the protagonist's cash-flow share, even if a model incorrectly labels the
// delta owner as "protagonist".  Keep this deliberately narrow: "你和母亲"
// can still be a direct parent-care action, while a partner/group or an
// explicit joint-action word must use an Accepted financial proposal instead.
const COLLECTIVE_RESPONSIBILITY_ACTOR = /(?:你们|我们|双方|两人|(?:你|我)(?!们)(?:与|和|跟|同)(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友|家人|亲属|兄弟姐妹|姐姐|哥哥|弟弟|妹妹|朋友|同事)|(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友|家人|亲属|兄弟姐妹|姐姐|哥哥|弟弟|妹妹|朋友|同事)(?:与|和|跟|同)(?:你|我)(?!们)|共同|轮流|各自|各半|一人一半|平摊)/u;
const PERSONAL_ACTOR = "(?:你(?!们)|我(?!们)|本人|主角)";
// Treat a payer as third-party only when that party is grammatically the
// payer (at a clause boundary or after "由/让").  A looser `父母.*支付`
// pattern would falsely reject "你为父母支付…", which is exactly a
// protagonist-owned responsibility.
const THIRD_PARTY_PAYER = /(?:(?:由|让)(?:父母|爸妈|母亲|父亲|妈妈|爸爸|伴侣|配偶|公司|雇主|他|她)[^。！？；]{0,12}(?:自己)?(?:支付|承担|负担|缴纳|代付)|(?:^|[，。；])(?:父母|爸妈|母亲|父亲|妈妈|爸爸|伴侣|配偶|公司|雇主|他|她)[^。！？；]{0,12}(?:自己)?(?:支付|承担|负担|缴纳|代付))/u;

export interface ExpenseResponsibilityDeltaNormalization {
  responsibility?: ExpenseResponsibilityChange;
  sourceOutcomeFilled?: boolean;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function confidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.8 && value <= 1
    ? value
    : undefined;
}

/** Parse a deliberately tiny, amount-free responsibility declaration. */
export function normalizeExpenseResponsibilityChange(input: {
  raw: unknown;
  acceptedOutcomeId?: string;
}): ExpenseResponsibilityDeltaNormalization {
  if (!input.raw || typeof input.raw !== "object") return {};
  const raw = input.raw as Record<string, unknown>;
  const responsibilityKind = raw.responsibilityKind;
  const beneficiary = raw.beneficiary;
  const owner = raw.owner;
  const cadence = raw.cadence;
  const evidence = nonEmptyString(raw.evidence);
  const sourceOutcomeId = nonEmptyString(raw.sourceOutcomeId) || input.acceptedOutcomeId;
  const normalizedConfidence = confidence(raw.confidence);
  if (
    (responsibilityKind !== "elder_care" && responsibilityKind !== "recurring_healthcare")
    || !["protagonist", "mother", "father", "parents"].includes(String(beneficiary))
    // This transport is intentionally amount-free. A shared responsibility
    // cannot safely determine the protagonist's cash-flow share without an
    // Accepted financial proposal, so shared care is never admitted here.
    || owner !== "protagonist"
    || cadence !== "recurring_unknown"
    || !evidence
    || normalizedConfidence === undefined
    || (responsibilityKind === "elder_care" && beneficiary === "protagonist")
    || (responsibilityKind === "recurring_healthcare" && beneficiary !== "protagonist")
  ) return {};
  return {
    responsibility: {
      responsibilityKind,
      beneficiary: beneficiary as ExpenseResponsibilityChange["beneficiary"],
      owner,
      cadence,
      evidence,
      confidence: normalizedConfidence,
      ...(sourceOutcomeId ? { sourceOutcomeId } : {})
    },
    sourceOutcomeFilled: !nonEmptyString(raw.sourceOutcomeId) && Boolean(input.acceptedOutcomeId)
  };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, "");
}

function evidenceInNarrative(narrativeText: string | undefined, evidence: string): boolean {
  return Boolean(narrativeText && normalizedText(narrativeText).includes(normalizedText(evidence)));
}

function sentences(evidence: string): string[] {
  return evidence.split(/(?<=[。！？；])/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function isCompletedPersonalMedication(evidence: string): boolean {
  if (PLANNED_WORD.test(evidence) || BUSINESS_WORD.test(evidence) || THIRD_PARTY_PAYER.test(evidence)) return false;
  return sentences(evidence).some((sentence) => {
    // A reminder, recommendation, or accompaniment is not the protagonist's
    // treatment.  Keep this aligned with the narrative lifecycle detector:
    // "你提醒/建议/陪父亲按时服药" must not open the protagonist's account.
    if (COLLECTIVE_RESPONSIBILITY_ACTOR.test(sentence)) return false;
    if (/(?:计划|打算|准备|希望|尝试|提醒|建议|劝|嘱咐|要求|让|帮|陪).{0,24}(?:用药|服药|复诊|治疗)/u.test(sentence)) return false;
    if (/(?:陪|提醒|建议|劝|嘱咐|要求|让|帮).{0,20}(?:父母|爸妈|母亲|父亲|妈妈|爸爸|他|她|他们).{0,20}(?:用药|服药|复诊)/u.test(sentence)) return false;
    return new RegExp(`${PERSONAL_ACTOR}.{0,40}(?:继续|仍|每天|每日|按时|规律|固定|长期|持续|每月|定期|只).{0,14}(?:用药|服药|复诊)`, "u").test(sentence);
  });
}

function hasDirectParentCareAction(sentence: string, owner: ExpenseResponsibilityChange["owner"]): boolean {
  if (owner === "protagonist" && COLLECTIVE_RESPONSIBILITY_ACTOR.test(sentence)) return false;
  const actor = owner === "shared_household"
    ? "(?:你们|我们|双方|两人)"
    : PERSONAL_ACTOR;
  const parent = "(?:父母|爸妈|母亲|父亲|妈妈|爸爸)";
  const namedTarget = new RegExp(
    `${actor}[^。！？；]{0,44}(?:(?:陪(?:着)?|推(?:着)?)[^，。！？；]{0,16}${parent}[^，。！？；]{0,20}(?:治疗|理疗|复诊|就医|轮椅)|带(?:着)?${parent}[^，。！？；]{0,28}(?:去|到)[^，。！？；]{0,12}(?:医院|门诊)[^，。！？；]{0,16}(?:体检|检查|复查|治疗|理疗|康复评估)|(?:照料|照顾|陪护|陪诊|护理|照看)[^，。！？；]{0,16}${parent}|(?:帮(?:着)?|协助)[^，。！？；]{0,16}${parent}[^，。！？；]{0,20}(?:康复训练|关节活动|复健)|(?:给|为)${parent}[^，。！？；]{0,16}请(?:了)?(?:护工|钟点工|保姆|家政))`,
    "u"
  );
  if (namedTarget.test(sentence)) return true;
  // A local pronoun is safe only when its antecedent parent and medical care
  // context are in this *same* sentence.  Never borrow a parent from a
  // previous sentence: "父亲长期治疗。你每周照料家里的猫。" is not elder care.
  const localParentPronoun = new RegExp(
    `${actor}[^。！？；]{0,36}(?:陪(?:着)?|推(?:着)?)[^。！？；]{0,16}(?:她|他|他们)[^。！？；]{0,16}(?:治疗|理疗|复诊|就医|去(?:医院|就医)|轮椅)`,
    "u"
  );
  if (PARENT_WORD.test(sentence) && localParentPronoun.test(sentence)) return true;
  // Preserve the existing detector's same-sentence caregiver-arrangement
  // form, while keeping it distinct from a generic care verb with another
  // object such as a pet.
  const caregiverArrangement = new RegExp(
    `${parent}[^。！？；]{0,72}${actor}[^。！？；]{0,40}(?:请人|请(?:了)?(?:护工|钟点工|保姆|家政))`,
    "u"
  );
  return caregiverArrangement.test(sentence);
}

function hasAdjacentParentRehabilitationAction(input: {
  previousSentence?: string;
  sentence: string;
  owner: ExpenseResponsibilityChange["owner"];
}): boolean {
  const { previousSentence = "", sentence, owner } = input;
  if (owner === "protagonist" && COLLECTIVE_RESPONSIBILITY_ACTOR.test(sentence)) return false;
  if (!PARENT_WORD.test(previousSentence)
    || !/(?:膝盖|腰疼|病情|行动不便|康复|理疗|复诊|治疗|医院)/u.test(previousSentence)) return false;
  const actor = owner === "shared_household"
    ? "(?:你们|我们|双方|两人)"
    : PERSONAL_ACTOR;
  return new RegExp(
    `${actor}[^。！？；]{0,36}(?:帮(?:着)?|协助)[^。！？；]{0,16}(?:她|他|他们)[^。！？；]{0,20}(?:康复训练|关节活动|复健)`,
    "u"
  ).test(sentence);
}

function isCompletedParentCare(evidence: string, owner: ExpenseResponsibilityChange["owner"]): boolean {
  if (PLANNED_WORD.test(evidence) || BUSINESS_WORD.test(evidence) || THIRD_PARTY_PAYER.test(evidence)) return false;
  const parts = sentences(evidence);
  return parts.some((sentence, index) => (
    ONGOING_WORD.test(`${parts[index - 1] || ""}${sentence}`)
    && (hasDirectParentCareAction(sentence, owner)
      || hasAdjacentParentRehabilitationAction({ previousSentence: parts[index - 1], sentence, owner }))
  ));
}

/**
 * This is the final semantic boundary for an AI-authored responsibility.  It
 * does not infer a bill from age, a health status, or a relative's illness:
 * it admits only an exact, completed first-person recurring action.
 */
export function sanitizeExpenseResponsibilityDeltas(input: {
  worldDeltas: WorldDelta[];
  narrativeText?: string;
  expectedSourceOutcomeId?: string;
}): WorldDelta[] {
  return input.worldDeltas.filter((delta) => {
    if (delta.type !== "expense_responsibility") return true;
    const responsibility = delta.responsibility;
    // Defense in depth for direct callers bypassing normalization. A shared
    // household bill needs an Accepted financial event with an auditable
    // protagonist share; this amount-free WorldDelta must never turn into a
    // full personal policy charge.
    if (responsibility.owner !== "protagonist") return false;
    if (!input.expectedSourceOutcomeId || responsibility.sourceOutcomeId !== input.expectedSourceOutcomeId) return false;
    if (!evidenceInNarrative(input.narrativeText, responsibility.evidence)) return false;
    return responsibility.responsibilityKind === "elder_care"
      ? isCompletedParentCare(responsibility.evidence, responsibility.owner)
      : isCompletedPersonalMedication(responsibility.evidence);
  });
}

function responsibilityIdentity(delta: Extract<WorldDelta, { type: "expense_responsibility" }>): string {
  const responsibility = delta.responsibility;
  return [
    responsibility.responsibilityKind,
    responsibility.beneficiary,
    responsibility.owner,
    responsibility.cadence,
    responsibility.sourceOutcomeId || "",
    responsibility.evidence
  ].join("\u001f");
}

/**
 * The ledger may only retain an amount-free responsibility when the final
 * user-visible node still contains the AcceptedOutcome evidence.  This is
 * intentionally separate from normalization: later narrative/debt repair can
 * replace prose after the first validation pass.
 */
export function missingAcceptedExpenseResponsibilityDeltas(input: {
  acceptedWorldDeltas: WorldDelta[];
  finalWorldDeltas: WorldDelta[];
}): Array<Extract<WorldDelta, { type: "expense_responsibility" }>> {
  const finalIdentities = new Set(input.finalWorldDeltas.flatMap((delta) => (
    delta.type === "expense_responsibility" ? [responsibilityIdentity(delta)] : []
  )));
  return input.acceptedWorldDeltas.filter((delta): delta is Extract<WorldDelta, { type: "expense_responsibility" }> => (
    delta.type === "expense_responsibility" && !finalIdentities.has(responsibilityIdentity(delta))
  ));
}

function acceptedParentForBeneficiary(input: {
  snapshot?: WorldStateSnapshot;
  beneficiary: Exclude<ExpenseResponsibilityChange["beneficiary"], "protagonist">;
}): PersonState | undefined {
  const parents = (input.snapshot?.people || []).filter((person) => (
    person.relation === "parent" && person.source !== "model_inferred" && person.lifeStatus !== "deceased"
  ));
  // The plural declaration is intentionally an aggregate obligation even if
  // only one parent is currently represented in WorldState.  Do not collapse
  // `elder_care:parents` into that lone person's key.
  if (input.beneficiary === "parents") return undefined;
  const expectedKey = input.beneficiary === "mother" ? "parent:mother" : "parent:father";
  const expectedName = input.beneficiary === "mother" ? /母亲|妈妈/u : /父亲|爸爸/u;
  const exact = parents.filter((person) => person.identityKey?.key === expectedKey || expectedName.test(person.displayName || ""));
  return exact.length === 1 ? exact[0] : undefined;
}

/**
 * Convert an AcceptedOutcome delta to the pre-existing lifecycle input.  The
 * stable account key is code-owned; raw model data never gets to choose it.
 */
export function explicitFactsFromAcceptedExpenseResponsibilityDeltas(input: {
  worldDeltas: WorldDelta[];
  currentWorldState?: WorldStateSnapshot;
}): ExplicitExpenseResponsibilityFact[] {
  return input.worldDeltas.flatMap<ExplicitExpenseResponsibilityFact>((delta) => {
    if (delta.type !== "expense_responsibility") return [];
    const responsibility = delta.responsibility;
    // Accepted outcomes should already have been sanitized, but retain the
    // same guard at the finance bridge so a malformed historical/direct call
    // cannot create a shared commitment without a verified amount share.
    if (responsibility.owner !== "protagonist"
      || COLLECTIVE_RESPONSIBILITY_ACTOR.test(responsibility.evidence)) return [];
    const financialScope = "personal" as const;
    const liability = "protagonist" as const;
    if (responsibility.responsibilityKind === "recurring_healthcare") {
      return [{
        responsibilityKey: "recurring_healthcare:protagonist",
        responsibilityKind: "recurring_healthcare",
        proposedType: "healthcare",
        action: "start",
        completion: "completed",
        cadence: "recurring_unknown",
        liability,
        financialScope,
        source: "accepted_outcome",
        evidenceExcerpt: responsibility.evidence
      }];
    }
    const beneficiary = responsibility.beneficiary;
    if (beneficiary === "protagonist") return [];
    const parent = acceptedParentForBeneficiary({ snapshot: input.currentWorldState, beneficiary });
    // Mother/father is a role identity declared by the accepted outcome. If
    // WorldState has not yet materialized that role, never widen it into
    // `parents` or open an unanchored individual account: keep the exact role
    // as an identity-resolution review until an accepted PersonState supplies
    // its participant id.
    const identityResolutionRequired = beneficiary !== "parents" && !parent;
    const responsibilitySuffix = beneficiary === "parents" ? "parents" : beneficiary;
    return [{
      responsibilityKey: `elder_care:${responsibilitySuffix}`,
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      action: identityResolutionRequired ? "review" : "start",
      completion: "completed",
      cadence: "recurring_unknown",
      liability: identityResolutionRequired ? "unknown" : liability,
      financialScope,
      participantPersonIds: parent ? [parent.id] : [],
      ...(identityResolutionRequired ? { identityResolutionRequired: true } : {}),
      source: "accepted_outcome",
      evidenceExcerpt: responsibility.evidence
    }];
  });
}
