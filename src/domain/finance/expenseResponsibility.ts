import type { PersonState, ResidenceOccupancyState, WorldStateSnapshot } from "../../types";
import type {
  ExpenseResponsibilityCandidate,
  ExpenseCommitmentType,
  ExpenseCommitmentChangeReason,
  ExpenseResponsibilityKind,
  ExpenseCommitmentV4,
  FinancialEvidence
} from "./types";
import { roundWan } from "./ledgerMath";

export type ExpenseResponsibilityAction = "start" | "adjust" | "end" | "review";
export type ExpenseResponsibilityCompletion = "completed" | "ongoing" | "planned" | "hypothetical";
export type ExpenseResponsibilityCadence = "one_off" | "monthly" | "quarterly" | "annual" | "recurring_unknown";
export type ExpenseResponsibilityLiability = "protagonist" | "shared" | "third_party" | "none" | "unknown";
export type ExpenseResponsibilityScope = "personal" | "shared_household" | "business_operating" | "third_party";

export interface ExpenseResponsibilityDerivationResult {
  candidates: ExpenseResponsibilityCandidate[];
  diagnostics: Array<{
    candidateId: string;
    reasonCode: string;
    disposition: "candidate" | "ignored" | "owner_review";
  }>;
}

export interface ExplicitExpenseResponsibilityFact {
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  action?: ExpenseResponsibilityAction;
  completion?: ExpenseResponsibilityCompletion;
  cadence?: ExpenseResponsibilityCadence;
  liability?: ExpenseResponsibilityLiability;
  financialScope?: ExpenseResponsibilityScope;
  explicitMonthlyTotalWan?: number;
  protagonistShareWan?: number;
  shareRate?: number;
  amountSourceId?: string;
  participantPersonIds?: string[];
  /** Required with a lower, pause, resume, or end mutation; ignored for an ordinary increase. */
  changeReason?: ExpenseCommitmentChangeReason;
  /** Only `adjust` may request a temporary pause/resume of an existing responsibility. */
  nextStatus?: "active" | "paused";
  source?: ExpenseResponsibilityCandidate["source"];
  evidenceExcerpt: string;
}

const NON_COMPLETED = /计划|打算|考虑|准备|希望|可能|如果|将来|未来|讨论|商量|看房|物色|尝试|拟|预期/u;
const BUSINESS_PLACE = /工坊|工作室|办公室|仓库|厂房|门店|服务器|团队|员工|原材料|推广|公司租金|经营场地/u;
const MONEY = /(\d+(?:\.\d+)?)\s*(万元|万|元)/u;
const CHINESE_DIGIT_WAN: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
};

function toWan(amount: string, unit: string): number | undefined {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return roundWan(unit.startsWith("万") ? parsed : parsed / 10_000);
}

function monthlyAmount(text: string): number | undefined {
  const amount = text.match(MONEY);
  if (amount) {
    const raw = toWan(amount[1], amount[2]);
    if (raw === undefined) return undefined;
    if (/每年|年度|年缴|年付|年保费/u.test(text)) return roundWan(raw / 12);
    if (/每季|季度/u.test(text)) return roundWan(raw / 3);
    return raw;
  }

  // Fresh route evidence includes the ordinary Chinese shorthand “两千四”.
  // It is a monthly amount only when a monthly cadence is explicit; do not
  // treat generic Chinese numerals in prose as money.
  const colloquial = text.match(/(?:每月|每个月|月均)[^。！？；]{0,16}([一二两三四五六七八九])千(?:([一二三四五六七八九])百?)?/u);
  if (!colloquial) return undefined;
  const thousands = CHINESE_DIGIT_WAN[colloquial[1]];
  const hundreds = colloquial[2] ? CHINESE_DIGIT_WAN[colloquial[2]] * 100 : 0;
  return roundWan((thousands * 1000 + hundreds) / 10_000);
}

/**
 * “续保” is a real insurance action, but it is also the two-character
 * substring at the boundary of “继续保持”.  The latter is never an insurance
 * responsibility.  Keep bare renewal support while excluding that prose
 * collision.
 */
function hasInsuranceExpenseSignal(sentence: string): boolean {
  return /医疗险|重疾险|养老保险|商业保险|保险费|保费|投保|(?<!继)续保/u.test(sentence);
}

/** A rental income flow is not the protagonist's housing expense. */
function isRentalIncomeSentence(sentence: string): boolean {
  return /(?:把|将).{0,20}(?:房子|房屋|住房|公寓|房产).{0,12}(?:出租|租(?:了)?出去)/u.test(sentence)
    || /(?:房租|租金).{0,24}(?:转入|打入|汇入|存入|进入|归入).{0,16}(?:她|他|母亲|父亲|父母|家人|伴侣|配偶)(?:的)?账户/u.test(sentence);
}

function hasParentCareSignal(sentence: string): boolean {
  return /(?:父母|爸妈|母亲|父亲|妈妈|爸爸)/u.test(sentence)
    && /生活费|赡养|照护|护理|护工|照料|照顾|陪护|陪诊|接送.{0,10}就医|医疗|血压|长期监测|降压药|请人.{0,12}(?:照看|照护|护理)/u.test(sentence);
}

function hasFollowupPersonalCareAction(sentence: string): boolean {
  return /(?:你|我).{0,30}(?:请人|请(?:了)?(?:护工|钟点工|保姆|家政)|照看|照护|护理|陪护|照料)/u.test(sentence)
    || /^(?:给|为)家里请(?:了)?(?:一位|一名|个)?(?:每周[^。！？；]{0,12})?(?:钟点工|保姆|家政|护工)/u.test(sentence);
}

const CAREGIVER_SERVICE = /钟点工|护工|保姆|家政/u;
const PARENT_REFERENCE = /父母|爸妈|母亲|父亲|妈妈|爸爸/u;

/**
 * Keep this deliberately narrower than generic narrative liability.  A
 * caregiver arrangement can be a real parent-care fact even when the wording
 * says it is a short trial, but only after the text explicitly assigns the
 * cost to the protagonist and records that the parents accepted or started
 * the arrangement.  A plan, a parent-paid service, and a business service
 * must remain outside this fallback.
 */
function isExplicitPersonalParentCareCommitment(sentence: string, nextSentence: string): boolean {
  if (!PARENT_REFERENCE.test(sentence) || !CAREGIVER_SERVICE.test(sentence)) return false;
  if (BUSINESS_PLACE.test(sentence)) return false;
  if (!/(?:费用|服务费|照护费|开销).{0,12}(?:由|由着)(?:你|我|本人|主角).{0,8}(?:承担|支付|负担)/u.test(sentence)) {
    return false;
  }
  if (!NON_COMPLETED.test(sentence)) return true;
  // A trial is a completed financial fact only once the adjacent outcome says
  // the parent accepted it or the service actually began.  This keeps a bare
  // "准备/尝试请钟点工" plan from opening a recurring account.
  const outcome = `${sentence}${nextSentence}`;
  return /(?:父母|爸妈|母亲|父亲|妈妈|爸爸).{0,20}(?:点头|同意|答应|接受|认可)/u.test(outcome)
    || CAREGIVER_SERVICE.test(nextSentence) && /(?:上门|开始(?:服务|照护)?|已开始|已经开始)/u.test(nextSentence);
}

function caregiverNames(sentence: string): string[] {
  const names = new Set<string>();
  for (const match of sentence.matchAll(/(?:钟点工|护工|保姆|家政)([\u4E00-\u9FFF]{1,3})(?:是|，|、|。|来|上门|负责)/gu)) {
    const name = match[1];
    // "钟点工服务，..." is a service description, not a person's name.
    if (!["服务", "安排", "费用", "工作", "人员"].includes(name)) names.add(name);
  }
  return [...names];
}

function explicitParentCareAmount(input: {
  sentences: string[];
  startIndex: number;
}): { amount?: number; sentenceIndex?: number } {
  const direct = monthlyAmount(input.sentences[input.startIndex]);
  if (direct !== undefined) return { amount: direct, sentenceIndex: input.startIndex };

  // The fresh lifespan route introduces the caregiver, records the parents'
  // acceptance, and gives the named caregiver's monthly fee a few sentences
  // later.  Only follow a name introduced as a caregiver, or an explicit
  // caregiver-fee phrase; do not borrow a nearby housing/project amount.
  const knownCaregiverNames = new Set<string>();
  const maxIndex = Math.min(input.sentences.length - 1, input.startIndex + 8);
  for (let index = input.startIndex; index <= maxIndex; index++) {
    const sentence = input.sentences[index];
    for (const name of caregiverNames(sentence)) knownCaregiverNames.add(name);
    const amount = monthlyAmount(sentence);
    if (amount === undefined) continue;
    const hasFeeWord = /费用|服务费|照护费|开销/u.test(sentence);
    const hasCaregiverFee = CAREGIVER_SERVICE.test(sentence) && hasFeeWord;
    const hasNamedCaregiverFee = [...knownCaregiverNames].some((name) => (
      sentence.includes(`${name}的费用`) || sentence.includes(`${name}服务费`) || sentence.includes(`${name}照护费`)
    ));
    if (hasCaregiverFee || hasNamedCaregiverFee) return { amount, sentenceIndex: index };
  }
  return {};
}

function medicalSubsidyAdjustmentAmount(sentence: string): number | undefined {
  const match = sentence.match(/(?:医疗补贴|医药补贴)[^。！？；]{0,32}(?:提到|提高到|上调到|增加到|调整为|变为)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
  return match ? toWan(match[1], match[2]) : undefined;
}

function sourceEvidence(input: {
  excerpt: string;
  scope: ExpenseResponsibilityScope;
  reasonCode: string;
  source?: FinancialEvidence["source"];
}): FinancialEvidence {
  return {
    source: input.source || "accepted_simulation_outcome",
    excerpt: input.excerpt,
    reasonCode: input.reasonCode,
    confidence: 1,
    financialScope: input.scope
  };
}

function candidateId(key: string, source: string, ordinal: number): string {
  return `expense_candidate_${key.replace(/[^a-zA-Z0-9:_-]/gu, "_")}_${source}_${ordinal}`;
}

function completedSentence(text: string): boolean {
  return Boolean(text.trim()) && !NON_COMPLETED.test(text);
}

function addCandidate(
  target: ExpenseResponsibilityCandidate[],
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"],
  candidate: Omit<ExpenseResponsibilityCandidate, "id">,
  reasonCode: string
): void {
  // A structured child/parent state may first surface as owner-review. When
  // the same node then supplies a completed payer fact for that exact stable
  // person key, retain the payer candidate and remove the superseded unknown
  // owner review. This prevents an accepted PersonState from being split into
  // an `:id` review plus a second `:unidentified` account.
  if ((candidate.action === "start" || candidate.action === "adjust") && candidate.liability !== "unknown") {
    const reviewIndex = target.findIndex((item) => (
      item.responsibilityKey === candidate.responsibilityKey
      && item.financialScope === candidate.financialScope
      && item.action === "review"
      && item.liability === "unknown"
    ));
    if (reviewIndex >= 0) {
      const [review] = target.splice(reviewIndex, 1);
      const diagnosticIndex = diagnostics.findIndex((item) => item.candidateId === review.id);
      if (diagnosticIndex >= 0) diagnostics.splice(diagnosticIndex, 1);
    }
  }
  const duplicate = target.find((item) => (
    item.responsibilityKey === candidate.responsibilityKey
    && item.action === candidate.action
    && item.amountSourceId === candidate.amountSourceId
    && item.financialScope === candidate.financialScope
  ));
  if (duplicate) return;
  const id = candidateId(candidate.responsibilityKey, candidate.source, target.length);
  target.push({ id, ...candidate });
  diagnostics.push({
    candidateId: id,
    reasonCode,
    disposition: candidate.liability === "unknown" ? "owner_review" : "candidate"
  });
}

function deriveRelationshipCandidates(input: {
  current?: WorldStateSnapshot;
  candidate?: WorldStateSnapshot;
  ageInMonths: number;
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  if (!input.candidate) return;
  const currentById = new Map((input.current?.relationships || []).map((item) => [item.id, item]));
  for (const relationship of input.candidate.relationships || []) {
    if (relationship.type !== "romantic" || !["cohabiting", "married"].includes(String(relationship.stage))) continue;
    const previous = currentById.get(relationship.id);
    const becameShared = !previous
      || (previous.livingTogether !== true && relationship.livingTogether === true)
      || (! ["cohabiting", "married"].includes(String(previous.stage)) && ["cohabiting", "married"].includes(String(relationship.stage)));
    if (!becameShared || relationship.livingTogether !== true) continue;
    const excerpt = relationship.responsibilitySummary || `${relationship.stage === "married" ? "婚后" : "同居后"}已确认共同居住`;
    const sharedEvidence = sourceEvidence({ excerpt, scope: "shared_household", reasonCode: "EXPENSE_SHARED_HOUSEHOLD_REVIEW" });
    for (const [responsibilityKey, responsibilityKind, proposedType] of [
      // The opening and V3→V4 migration canonicalize this identity as
      // `:protagonist`.  A separate `:main` key would silently bypass the
      // review path and could create a duplicate basic-living responsibility.
      ["adult_basic_living:protagonist", "adult_basic_living", "basic_living"],
      ["primary_residence:main", "primary_residence", "housing"]
    ] as const) {
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey,
        responsibilityKind,
        proposedType,
        action: "review",
        completion: "completed",
        cadence: "recurring_unknown",
        liability: "shared",
        financialScope: "shared_household",
        participantPersonIds: relationship.participantPersonIds,
        source: "accepted_world_delta",
        evidence: [sharedEvidence]
      }, "EXPENSE_SHARED_HOUSEHOLD_REVIEW");
    }
  }
}

function sameResidenceOccupancy(
  left: ResidenceOccupancyState | undefined,
  right: ResidenceOccupancyState | undefined
): boolean {
  return left?.livingArrangement === right?.livingArrangement
    && left?.financialScope === right?.financialScope
    && left?.liability === right?.liability
    && left?.evidence === right?.evidence
    && left?.effectiveFromAgeInMonths === right?.effectiveFromAgeInMonths;
}

function isPersonalResidenceResponsibility(residence: ResidenceOccupancyState | undefined): boolean {
  return Boolean(
    residence
    && ["personal", "shared_household"].includes(residence.financialScope)
    && ["protagonist", "shared"].includes(residence.liability)
  );
}

/**
 * A location delta becomes a housing responsibility only after its residence
 * payload has been accepted and persisted in WorldState.  Text is not read
 * here: prose-only rent/move-in wording remains the explicitly secondary
 * narrative supplement below.
 */
function deriveStructuredResidenceCandidates(input: {
  current?: WorldStateSnapshot;
  candidate?: WorldStateSnapshot;
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  const residence = input.candidate?.residence;
  if (!residence || residence.source !== "accepted_history" || sameResidenceOccupancy(input.current?.residence, residence)) return;
  const personalResponsibility = isPersonalResidenceResponsibility(residence);
  const previouslyPersonal = isPersonalResidenceResponsibility(input.current?.residence);
  const action: ExpenseResponsibilityAction = personalResponsibility
    ? previouslyPersonal ? "adjust" : "start"
    : "review";
  const reasonCode = personalResponsibility
    ? "EXPENSE_PRIMARY_RESIDENCE_WORLD_STATE"
    : "EXPENSE_RESIDENCE_NON_PERSONAL";
  addCandidate(input.target, input.diagnostics, {
    responsibilityKey: "primary_residence:main",
    responsibilityKind: "primary_residence",
    proposedType: "housing",
    action,
    completion: "completed",
    cadence: "recurring_unknown",
    liability: residence.liability,
    financialScope: residence.financialScope,
    participantPersonIds: [],
    source: "accepted_world_delta",
    evidence: [sourceEvidence({
      excerpt: residence.evidence,
      scope: residence.financialScope,
      reasonCode
    })]
  }, reasonCode);
}

/**
 * PersonState has no payer or custody field. A newly accepted child is
 * therefore a first-class responsibility review, never evidence that the
 * protagonist has already agreed to a recurring personal deduction. A later
 * Accepted financial fact may turn this stable key into an actual account.
 */
function deriveStructuredChildCandidates(input: {
  current?: WorldStateSnapshot;
  candidate?: WorldStateSnapshot;
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  if (!input.candidate) return;
  const currentById = new Map((input.current?.people || []).map((item) => [item.id, item]));
  for (const child of input.candidate.people || []) {
    if (child.relation !== "child") continue;
    const previous = currentById.get(child.id);
    const newlyAcceptedChild = !previous || previous.relation !== "child";
    const isCurrentDependent = ["active", "limited"].includes(child.lifeStatus);
    // `model_inferred` remains a presentation hint. It is not an accepted
    // family fact and must not silently open even a review obligation.
    const isAcceptedChildFact = child.source !== "model_inferred";
    if (!newlyAcceptedChild || !isCurrentDependent || !isAcceptedChildFact) continue;
    const excerpt = child.relationshipSummary || `${child.displayName || "子女"}已作为主角家庭成员进入已接受 WorldState`;
    addCandidate(input.target, input.diagnostics, {
      responsibilityKey: `child_support:${child.id}`,
      responsibilityKind: "child_support",
      proposedType: "dependent_support",
      action: "review",
      completion: "completed",
      cadence: "recurring_unknown",
      liability: "unknown",
      financialScope: "personal",
      participantPersonIds: [child.id],
      source: "accepted_world_delta",
      evidence: [sourceEvidence({ excerpt, scope: "personal", reasonCode: "EXPENSE_CHILD_WORLD_STATE_OWNER_NEEDS_REVIEW" })]
    }, "EXPENSE_CHILD_WORLD_STATE_OWNER_NEEDS_REVIEW");
  }
}

function isAcceptedStructuredPerson(person: PersonState): boolean {
  return person.source !== "model_inferred" && person.lifeStatus !== "deceased";
}

function isParentCareNeed(person: PersonState | undefined): boolean {
  return Boolean(person && (
    person.healthStatus === "fragile"
    || person.healthStatus === "care_dependent"
    || person.lifeStatus === "limited"
  ));
}

function hasActiveFamilyLink(snapshot: WorldStateSnapshot | undefined, personId: string): boolean {
  return Boolean(snapshot?.familyRelationships?.some((relationship) => (
    relationship.participantPersonId === personId && relationship.activation === "active"
  )));
}

function deriveStructuredCareCandidates(input: {
  current?: WorldStateSnapshot;
  candidate?: WorldStateSnapshot;
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  if (!input.candidate) return;
  const currentById = new Map((input.current?.people || []).map((item) => [item.id, item]));
  for (const person of input.candidate.people || []) {
    const previous = currentById.get(person.id);
    const newlyCareDependent = person.relation === "parent"
      && isAcceptedStructuredPerson(person)
      && isParentCareNeed(person)
      && (
        !isParentCareNeed(previous)
        || (!hasActiveFamilyLink(input.current, person.id) && hasActiveFamilyLink(input.candidate, person.id))
      );
    if (!newlyCareDependent) continue;
    const excerpt = person.relationshipSummary || `${person.displayName || "父母"}的已接受健康/生活状态表明需要进一步照护确认`;
    addCandidate(input.target, input.diagnostics, {
      responsibilityKey: `elder_care:${person.id}`,
      responsibilityKind: "elder_care",
      proposedType: "dependent_support",
      action: "review",
      completion: "completed",
      cadence: "recurring_unknown",
      liability: "unknown",
      financialScope: "personal",
      participantPersonIds: [person.id],
      source: "accepted_world_delta",
      evidence: [sourceEvidence({ excerpt, scope: "personal", reasonCode: "EXPENSE_ELDER_CARE_OWNER_NEEDS_REVIEW" })]
    }, "EXPENSE_ELDER_CARE_OWNER_NEEDS_REVIEW");
  }
}

function deriveStructuredHealthCandidates(input: {
  current?: WorldStateSnapshot;
  candidate?: WorldStateSnapshot;
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  if (!input.candidate) return;
  const healthSummary = input.candidate.healthSummary?.trim();
  if (!healthSummary || healthSummary === input.current?.healthSummary?.trim() || !completedSentence(healthSummary)) return;

  // A health-state delta is accepted world data. It still has to say that a
  // continuing treatment/care responsibility exists; a lower health score,
  // advanced age, or generic "health management" alone is not a bill.
  const hasOngoingTreatment = /长期(?:治疗|康复)|持续(?:用药|治疗)|定期复诊|每月复诊|固定(?:医疗|治疗)|长期护理|护理服务|护工/u.test(healthSummary);
  const hasHealthReviewSignal = hasOngoingTreatment || /长期管理|医疗随访|健康管理|康复观察|复查/u.test(healthSummary);
  if (!hasHealthReviewSignal) return;
  const action: ExpenseResponsibilityAction = hasOngoingTreatment ? "start" : "review";
  const reasonCode = hasOngoingTreatment
    ? "EXPENSE_PROTAGONIST_HEALTHCARE_WORLD_STATE"
    : "EXPENSE_PROTAGONIST_HEALTH_REVIEW";
  addCandidate(input.target, input.diagnostics, {
    responsibilityKey: "recurring_healthcare:protagonist",
    responsibilityKind: "recurring_healthcare",
    proposedType: "healthcare",
    action,
    completion: "completed",
    cadence: "recurring_unknown",
    liability: "protagonist",
    financialScope: "personal",
    participantPersonIds: [],
    source: "accepted_world_delta",
    evidence: [sourceEvidence({ excerpt: healthSummary, scope: "personal", reasonCode })]
  }, reasonCode);
}

function employmentStatus(snapshot: WorldStateSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined;
  return snapshot.careerStates?.find((state) => state.id === snapshot.currentCareerStateId)?.employmentStatus
    || snapshot.currentEmploymentStatus;
}

function deriveCareerExitReviewCandidates(input: {
  current?: WorldStateSnapshot;
  candidate?: WorldStateSnapshot;
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  if (!input.candidate) return;
  const previousStatus = employmentStatus(input.current);
  const nextStatus = employmentStatus(input.candidate);
  if (!nextStatus || nextStatus === previousStatus || !["retired", "not_working"].includes(nextStatus)) return;
  const excerpt = `已接受 CareerState 从 ${previousStatus || "unknown"} 变为 ${nextStatus}`;
  // The reconciler expands this sentinel review to every active personal or
  // shared recurring responsibility. It deliberately does not lower or end
  // any commitment merely because the protagonist stopped working.
  addCandidate(input.target, input.diagnostics, {
    responsibilityKey: "adult_basic_living:protagonist",
    responsibilityKind: "adult_basic_living",
    proposedType: "basic_living",
    action: "review",
    completion: "completed",
    cadence: "recurring_unknown",
    liability: "protagonist",
    financialScope: "personal",
    participantPersonIds: [],
    source: "accepted_world_delta",
    evidence: [sourceEvidence({ excerpt, scope: "personal", reasonCode: "EXPENSE_CAREER_EXIT_REVIEW" })]
  }, "EXPENSE_CAREER_EXIT_REVIEW");
}

function acceptedPeopleForResponsibility(
  snapshot: WorldStateSnapshot | undefined,
  relation: PersonState["relation"]
): PersonState[] {
  return (snapshot?.people || []).filter((person) => (
    person.relation === relation
    && person.source !== "model_inferred"
    && person.lifeStatus !== "deceased"
  ));
}

function findNamedStructuredPerson(input: {
  snapshot?: WorldStateSnapshot;
  relation: "child" | "parent";
  sentence: string;
}): PersonState | undefined {
  const people = acceptedPeopleForResponsibility(input.snapshot, input.relation);
  if (people.length === 1) return people[0];
  const nameMatch = people.filter((person) => person.displayName && input.sentence.includes(person.displayName));
  if (nameMatch.length === 1) return nameMatch[0];
  const identityMatch = people.filter((person) => {
    const key = person.identityKey?.key || "";
    if (input.relation === "child") {
      return (/(?:儿子|长子|小儿子)/u.test(input.sentence) && /child:son/u.test(key))
        || (/(?:女儿|长女|小女儿|二女儿|次女)/u.test(input.sentence) && /child:daughter/u.test(key));
    }
    return (/(?:母亲|妈妈)/u.test(input.sentence) && /parent:mother/u.test(key))
      || (/(?:父亲|爸爸)/u.test(input.sentence) && /parent:father/u.test(key));
  });
  return identityMatch.length === 1 ? identityMatch[0] : undefined;
}

/**
 * A generic narrative "医疗补贴" has no beneficiary on its own.  It may
 * therefore adjust only a parent-health responsibility whose parent identity
 * is already accepted by the ledger or the accepted WorldState.  In
 * particular, an arbitrary child/spouse/legacy healthcare account is not a
 * safe fallback target merely because it is not the protagonist's account.
 */
function isAcceptedActiveParentHealthcareCommitment(input: {
  commitment: ExpenseCommitmentV4;
  snapshot?: WorldStateSnapshot;
}): boolean {
  const { commitment } = input;
  if (commitment.status !== "active" || commitment.responsibilityKind !== "recurring_healthcare") return false;
  const prefix = "recurring_healthcare:";
  if (!commitment.responsibilityKey.startsWith(prefix)) return false;
  const beneficiaryKey = commitment.responsibilityKey.slice(prefix.length);
  // These are the two canonical aggregate keys emitted by the opening and
  // narrative parent-responsibility paths. They remain valid even if an old
  // opening record predates PersonState identity capture.
  if (beneficiaryKey === "opening_parent" || beneficiaryKey === "parents") return true;
  const acceptedParentIds = new Set(
    acceptedPeopleForResponsibility(input.snapshot, "parent").map((person) => person.id)
  );
  return acceptedParentIds.has(beneficiaryKey)
    || (commitment.participantPersonIds || []).some((personId) => acceptedParentIds.has(personId));
}

function activeAcceptedParentHealthcareCommitments(input: {
  commitments?: ExpenseCommitmentV4[];
  snapshot?: WorldStateSnapshot;
}): ExpenseCommitmentV4[] {
  return (input.commitments || []).filter((commitment) => (
    isAcceptedActiveParentHealthcareCommitment({ commitment, snapshot: input.snapshot })
  ));
}

/**
 * A prose sentence can supplement an accepted state, but it must not make an
 * absent payer magically become the protagonist.  In particular, a partner's
 * rent, a parent's own medical bill, or a company workshop must never turn
 * into a personal recurring cash flow simply because the story mentions it.
 */
function classifyNarrativeLiability(sentence: string): {
  liability: ExpenseResponsibilityLiability;
  financialScope: ExpenseResponsibilityScope;
  shareRate?: number;
} {
  if (BUSINESS_PLACE.test(sentence)) {
    return { liability: "third_party", financialScope: "business_operating" };
  }

  const hasSharedPayer = /(?:你们|我们|双方|两人).{0,24}(?:支付|承担|负担|缴纳|分摊|平摊|各付|代付|租下|租住|搬入|入住)|(?:你们|我们|双方|两人).{0,36}(?:给|向).{0,12}(?:双方)?(?:父母|爸妈|母亲|父亲).{0,16}(?:生活费|赡养费|照护费|护理费)|(?:你们|我们|双方|两人).{0,30}(?:轮流|共同|一起).{0,14}(?:照护|陪护|陪诊|照料|接送).{0,20}(?:父母|爸妈|母亲|父亲|就医)|(?:共同|各自承担|各付|一人一半|各半|平摊).{0,18}(?:支付|承担|负担|缴纳|房租|租金|费用|育儿|照护)/u.test(sentence);
  if (hasSharedPayer) {
    return {
      liability: "shared",
      financialScope: "shared_household",
      shareRate: /(?:各(?:自)?承担|各付|一人一半|各半|平摊)/u.test(sentence) ? 0.5 : undefined
    };
  }

  const hasThirdPartyPayer = /(?:伴侣|配偶|妻子|丈夫|父母|母亲|父亲|公司|雇主|朋友|他|她).{0,24}(?:支付|承担|负担|缴纳|转账|付款|代付)/u.test(sentence);
  if (hasThirdPartyPayer) return { liability: "third_party", financialScope: "third_party" };

  const hasPersonalPayer = /(?:你|我|本人|主角).{0,24}(?:支付|承担|负担|缴纳|转账|(?:转(?:给|向|账)|(?:给|向).{0,12}转(?!入))|付款|付(?:了)?(?:房租|租金|费|款)?|交了|租下|租住|搬入|入住|复诊|用药|投保|(?<!继)续保|接送.{0,10}就医|陪护|照护|照料)/u.test(sentence)
    // "你盘算着下个月要交的房租" is not a speculative move: it says
    // that an already occupied residence has a recurring protagonist bill.
    // Keep this deliberately tied to a first-person payer and a housing noun
    // so a generic future housing plan remains excluded by NON_COMPLETED.
    || /(?:你|我|本人|主角).{0,24}(?:要|需|得|需要)交(?:的)?(?:房租|租金|物业费)/u.test(sentence)
    // User-provided opening facts commonly elide the already-established
    // second-person subject, e.g. “每月给父母转 4000 元”.  Keep this narrow
    // so a third-party subject still wins above.
    || /^(?:每月|每年|长期).{0,10}(?:给|向)(?:父母|母亲|父亲|妈妈|爸爸|孩子|子女).{0,16}(?:转|支付|承担|负担)/u.test(sentence)
    // Narrative sentences commonly omit the first-person subject once the
    // current living arrangement is established. These are still completed
    // protagonist responsibilities, not future plans or a third-party bill.
    || /(?:刚|已|年初|本月|今年).{0,12}(?:续租|续签).{0,24}(?:房子|房屋|住房|公寓|住处|住所)/u.test(sentence)
    || hasFollowupPersonalCareAction(sentence)
    || /(?:你|我|本人|主角).{0,24}(?:医疗补贴|医药补贴).{0,32}(?:提到|提高到|上调到|增加到|调整为|变为)/u.test(sentence);
  if (hasPersonalPayer) return { liability: "protagonist", financialScope: "personal" };

  return { liability: "unknown", financialScope: "personal" };
}

function candidateActionForLiability(liability: ExpenseResponsibilityLiability): ExpenseResponsibilityAction {
  return liability === "unknown" ? "review" : "start";
}

function parentCandidateIdentity(input: {
  snapshot?: WorldStateSnapshot;
  sentence: string;
}): { key: string; participantPersonIds: string[] } {
  const parent = findNamedStructuredPerson({
    snapshot: input.snapshot,
    relation: "parent",
    sentence: input.sentence
  });
  // A plural or otherwise un-named parental responsibility is still a stable
  // household fact.  `parents` avoids inventing duplicate `:unidentified`
  // responsibilities across successive paragraphs; a concrete accepted person
  // id always wins when available.
  return parent
    ? { key: parent.id, participantPersonIds: [parent.id] }
    : { key: "parents", participantPersonIds: [] };
}

function deriveNarrativeCandidates(input: {
  narrativeText: string;
  candidateWorldState?: WorldStateSnapshot;
  /**
   * Narrative text cannot invent the beneficiary of a generic "医疗补贴".
   * An already accepted, active parent-health commitment is the only
   * contextual target allowed when the sentence itself omits the parent.
   */
  existingExpenseCommitments?: ExpenseCommitmentV4[];
  target: ExpenseResponsibilityCandidate[];
  diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"];
}): void {
  const sentences = input.narrativeText.split(/(?<=[。！？；])/u).map((item) => item.trim()).filter(Boolean);
  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index];
    const nextSentence = sentences[index + 1] || "";
    const explicitParentCareCommitment = isExplicitPersonalParentCareCommitment(sentence, nextSentence);
    if (!completedSentence(sentence) && !explicitParentCareCommitment) continue;
    // A care need and the protagonist's concrete follow-up commonly appear in
    // adjacent short sentences. Treat only that narrow pair as one fact so a
    // pronoun such as “他们” cannot erase an established parental obligation.
    const evidenceSentence = hasParentCareSignal(sentence) && hasFollowupPersonalCareAction(nextSentence)
      ? `${sentence}${nextSentence}`
      : sentence;
    if (isRentalIncomeSentence(evidenceSentence)) continue;
    const liabilityContext = classifyNarrativeLiability(evidenceSentence);
    const scope = liabilityContext.financialScope;
    const liability = liabilityContext.liability;
    const shareRate = liabilityContext.shareRate;
    const isBusiness = scope === "business_operating";
    const amount = monthlyAmount(evidenceSentence);

    if (explicitParentCareCommitment) {
      const parent = parentCandidateIdentity({ snapshot: input.candidateWorldState, sentence });
      const careAmount = explicitParentCareAmount({ sentences, startIndex: index });
      // Keep the evidence verbatim and contiguous. The validator intentionally
      // rejects stitched snippets, even if both fragments came from this
      // narrative, because it cannot independently prove their relationship.
      const excerpt = careAmount.sentenceIndex === undefined
        ? sentence
        : sentences.slice(index, careAmount.sentenceIndex + 1).join("");
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `elder_care:${parent.key}`,
        responsibilityKind: "elder_care",
        proposedType: "dependent_support",
        action: "start",
        completion: "completed",
        cadence: careAmount.amount === undefined ? "recurring_unknown" : "monthly",
        liability: "protagonist",
        financialScope: "personal",
        explicitMonthlyTotalWan: careAmount.amount,
        protagonistShareWan: careAmount.amount,
        amountSourceId: careAmount.amount === undefined ? undefined : `narrative_parent_caregiver_${excerpt}`,
        participantPersonIds: parent.participantPersonIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt, scope: "personal", reasonCode: "EXPENSE_EXPLICIT_PARENT_CARE_NARRATIVE" })]
      }, "EXPENSE_EXPLICIT_PARENT_CARE_NARRATIVE");
      continue;
    }

    const medicalSubsidyAmount = medicalSubsidyAdjustmentAmount(evidenceSentence);
    if (medicalSubsidyAmount !== undefined) {
      const isExplicitPersonalMedicalAdjustment = liability === "protagonist"
        && !/(?:公司|雇主|单位|政府|社保|医保|保险公司|医院)[^。！？；]{0,24}(?:医疗补贴|医药补贴)/u.test(evidenceSentence);
      const namedParent = findNamedStructuredPerson({
        snapshot: input.candidateWorldState,
        relation: "parent",
        sentence: evidenceSentence
      });
      const activeParentHealthcare = activeAcceptedParentHealthcareCommitments({
        commitments: input.existingExpenseCommitments,
        snapshot: input.candidateWorldState
      });
      // A narrative-only amount can adjust a known parent-health commitment
      // only when the payer is explicit and there is exactly one accepted
      // target.  Do not infer an `opening_parent` account from the word
      // “医疗补贴”: it might be company/government reimbursement, or an
      // entirely different beneficiary. Explicit accepted facts are handled
      // above and retain their own responsibility key.
      const namedParentCommitment = namedParent
        ? activeParentHealthcare.find((commitment) => (
          commitment.responsibilityKey === `recurring_healthcare:${namedParent.id}`
          || commitment.responsibilityKey === "recurring_healthcare:parents"
          || commitment.responsibilityKey === "recurring_healthcare:opening_parent"
          || (commitment.participantPersonIds || []).includes(namedParent.id)
        ))
        : undefined;
      const parentKey = namedParentCommitment?.responsibilityKey.replace(/^recurring_healthcare:/u, "")
        || (activeParentHealthcare.length === 1
          ? activeParentHealthcare[0].responsibilityKey.replace(/^recurring_healthcare:/u, "")
          : undefined);
      if (!isExplicitPersonalMedicalAdjustment || !parentKey) continue;
      const parentParticipantIds = namedParent ? [namedParent.id] : [];
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `recurring_healthcare:${parentKey}`,
        responsibilityKind: "recurring_healthcare",
        proposedType: "healthcare",
        action: "adjust",
        completion: "completed",
        cadence: "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: medicalSubsidyAmount,
        protagonistShareWan: medicalSubsidyAmount,
        amountSourceId: `narrative_medical_subsidy_${evidenceSentence}`,
        participantPersonIds: parentParticipantIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: "EXPENSE_MEDICAL_SUBSIDY_ADJUSTMENT" })]
      }, "EXPENSE_MEDICAL_SUBSIDY_ADJUSTMENT");
      continue;
    }

    if (hasFollowupPersonalCareAction(evidenceSentence) && /钟点工|保姆|家政|护工/u.test(evidenceSentence)) {
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: "elder_care:parents",
        responsibilityKind: "elder_care",
        proposedType: "dependent_support",
        action: "start",
        completion: "completed",
        cadence: amount === undefined ? "recurring_unknown" : "monthly",
        liability: "protagonist",
        financialScope: "personal",
        explicitMonthlyTotalWan: amount,
        protagonistShareWan: amount,
        amountSourceId: amount === undefined ? undefined : `narrative_household_care_${evidenceSentence}`,
        participantPersonIds: [],
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope: "personal", reasonCode: "EXPENSE_HOUSEHOLD_CARE_NARRATIVE" })]
      }, "EXPENSE_HOUSEHOLD_CARE_NARRATIVE");
      continue;
    }

    if (/(?:租金|房租|月租|物业费|住房维护|维修费|开始租住|续租|续签|租住|租下|新租(?:的)?(?:公寓|房子|住房)|租的(?:公寓|房子|住房)|搬入|入住)/u.test(evidenceSentence)) {
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: "primary_residence:main",
        responsibilityKind: "primary_residence",
        proposedType: "housing",
        action: candidateActionForLiability(liability),
        completion: "completed",
        cadence: amount === undefined ? "recurring_unknown" : "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: amount,
        protagonistShareWan: liability === "third_party" || liability === "unknown"
          ? undefined
          : amount !== undefined && shareRate !== undefined ? roundWan(amount * shareRate) : amount,
        shareRate,
        amountSourceId: amount === undefined ? undefined : `narrative_housing_${evidenceSentence}`,
        participantPersonIds: [],
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: isBusiness ? "EXPENSE_BUSINESS_PLACE" : "EXPENSE_HOUSING_NARRATIVE" })]
      }, isBusiness ? "EXPENSE_BUSINESS_PLACE" : "EXPENSE_HOUSING_NARRATIVE");
      continue;
    }

    if (/(?:孩子出生|生下孩子|迎来孩子|成为父母|育儿|抚养孩子|子女教育)/u.test(evidenceSentence)) {
      const pays = liability === "protagonist" || liability === "shared";
      const child = findNamedStructuredPerson({
        snapshot: input.candidateWorldState,
        relation: "child",
        sentence: evidenceSentence
      });
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `child_support:${child?.id || "unidentified"}`,
        responsibilityKind: "child_support",
        proposedType: "dependent_support",
        action: pays ? "start" : "review",
        completion: "completed",
        cadence: amount === undefined ? "recurring_unknown" : "monthly",
        liability: pays ? liability : "unknown",
        financialScope: scope,
        explicitMonthlyTotalWan: amount,
        protagonistShareWan: pays
          ? amount !== undefined && shareRate !== undefined ? roundWan(amount * shareRate) : amount
          : undefined,
        shareRate,
        amountSourceId: amount === undefined ? undefined : `narrative_child_${evidenceSentence}`,
        participantPersonIds: child ? [child.id] : [],
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: pays ? "EXPENSE_CHILD_SUPPORT_NARRATIVE" : "EXPENSE_CHILD_SUPPORT_OWNER_NEEDS_REVIEW" })]
      }, pays ? "EXPENSE_CHILD_SUPPORT_NARRATIVE" : "EXPENSE_CHILD_SUPPORT_OWNER_NEEDS_REVIEW");
      continue;
    }

    if (hasParentCareSignal(evidenceSentence)) {
      const sourceId = `narrative_parent_${evidenceSentence}`;
      const parent = parentCandidateIdentity({ snapshot: input.candidateWorldState, sentence: evidenceSentence });
      const parentKey = parent.key;
      const parentParticipantIds = parent.participantPersonIds;
      const medicalPart = evidenceSentence.match(/(?:其中)?(?:医疗|医药|治疗|复诊|用药)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
      const total = amount;
      if (medicalPart && total !== undefined) {
        const medical = toWan(medicalPart[1], medicalPart[2]);
        if (medical !== undefined) {
          addCandidate(input.target, input.diagnostics, {
            responsibilityKey: `recurring_healthcare:${parentKey}`,
            responsibilityKind: "recurring_healthcare",
            proposedType: "healthcare",
            action: candidateActionForLiability(liability),
            completion: "completed",
            cadence: "monthly",
            liability,
            financialScope: scope,
            explicitMonthlyTotalWan: medical,
            protagonistShareWan: liability === "protagonist" || liability === "shared" ? medical : undefined,
            // The transfer is one parent-level fact, but its medical and
            // support allocations are distinct monetary facts. Stable
            // allocation IDs let the ledger audit their sum without treating
            // two accounts as if they claimed the exact same amount source.
            amountSourceId: `${sourceId}:medical`,
            participantPersonIds: parentParticipantIds,
            source: "narrative_supplement",
            evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: "EXPENSE_PARENT_MEDICAL_SPLIT" })]
          }, "EXPENSE_PARENT_MEDICAL_SPLIT");
          const support = roundWan(Math.max(0, total - medical));
          if (support > 0) addCandidate(input.target, input.diagnostics, {
            responsibilityKey: `elder_care:${parentKey}`,
            responsibilityKind: "elder_care",
            proposedType: "dependent_support",
            action: candidateActionForLiability(liability),
            completion: "completed",
            cadence: "monthly",
            liability,
            financialScope: scope,
            explicitMonthlyTotalWan: support,
            protagonistShareWan: liability === "protagonist" || liability === "shared" ? support : undefined,
            amountSourceId: `${sourceId}:support`,
            participantPersonIds: parentParticipantIds,
            source: "narrative_supplement",
            evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: "EXPENSE_PARENT_SUPPORT_SPLIT" })]
          }, "EXPENSE_PARENT_SUPPORT_SPLIT");
          continue;
        }
      }
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `elder_care:${parentKey}`,
        responsibilityKind: "elder_care",
        proposedType: "dependent_support",
        action: candidateActionForLiability(liability),
        completion: "completed",
        cadence: amount === undefined ? "recurring_unknown" : "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: amount,
        protagonistShareWan: liability === "protagonist" || liability === "shared" ? amount : undefined,
        amountSourceId: amount === undefined ? undefined : sourceId,
        participantPersonIds: parentParticipantIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: "EXPENSE_ELDER_CARE_NARRATIVE" })]
      }, "EXPENSE_ELDER_CARE_NARRATIVE");
      continue;
    }

    if (/(?:长期治疗|持续用药|每月复诊|长期康复|固定医疗|护工|定期复诊)/u.test(evidenceSentence)) {
      const hasCare = /护工|照护|护理/u.test(evidenceSentence);
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: hasCare ? "elder_care:care_plan" : "recurring_healthcare:protagonist",
        responsibilityKind: hasCare ? "elder_care" : "recurring_healthcare",
        proposedType: hasCare ? "dependent_support" : "healthcare",
        action: candidateActionForLiability(liability),
        completion: "completed",
        cadence: amount === undefined ? "recurring_unknown" : "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: amount,
        protagonistShareWan: liability === "protagonist" || liability === "shared" ? amount : undefined,
        amountSourceId: amount === undefined ? undefined : `narrative_health_${evidenceSentence}`,
        participantPersonIds: [],
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: hasCare ? "EXPENSE_CARE_NARRATIVE" : "EXPENSE_RECURRING_HEALTHCARE_NARRATIVE" })]
      }, hasCare ? "EXPENSE_CARE_NARRATIVE" : "EXPENSE_RECURRING_HEALTHCARE_NARRATIVE");
      continue;
    }

    if (hasInsuranceExpenseSignal(evidenceSentence)) {
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: "personal_insurance:main",
        responsibilityKind: "personal_insurance",
        proposedType: "insurance",
        action: candidateActionForLiability(liability),
        completion: "completed",
        cadence: /每年|年度|年缴|年付/u.test(evidenceSentence) ? "annual" : amount === undefined ? "recurring_unknown" : "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: amount,
        protagonistShareWan: liability === "protagonist" || liability === "shared" ? amount : undefined,
        amountSourceId: amount === undefined ? undefined : `narrative_insurance_${evidenceSentence}`,
        participantPersonIds: [],
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: "EXPENSE_INSURANCE_NARRATIVE" })]
      }, "EXPENSE_INSURANCE_NARRATIVE");
    }
  }
}

/**
 * Structure wins over prose: callers may pass a candidate WorldState produced
 * by an accepted cross-domain transition.  Narrative extraction exists only to
 * supply otherwise missing, completed responsibility evidence and is always
 * scope-classified before reconciliation.
 */
export function deriveExpenseResponsibilityCandidates(input: {
  currentWorldState?: WorldStateSnapshot;
  candidateWorldState?: WorldStateSnapshot;
  existingExpenseCommitments?: ExpenseCommitmentV4[];
  narrativeText?: string;
  explicitFacts?: ExplicitExpenseResponsibilityFact[];
  ageInMonths: number;
}): ExpenseResponsibilityDerivationResult {
  const candidates: ExpenseResponsibilityCandidate[] = [];
  const diagnostics: ExpenseResponsibilityDerivationResult["diagnostics"] = [];
  // A direct accepted occupancy fact owns this node's primary-residence
  // decision.  Put it before cohabitation review so a generic relationship
  // review cannot preempt a concrete accepted move-in/rent fact.
  deriveStructuredResidenceCandidates({
    current: input.currentWorldState,
    candidate: input.candidateWorldState,
    target: candidates,
    diagnostics
  });
  deriveRelationshipCandidates({
    current: input.currentWorldState,
    candidate: input.candidateWorldState,
    ageInMonths: input.ageInMonths,
    target: candidates,
    diagnostics
  });
  deriveStructuredCareCandidates({
    current: input.currentWorldState,
    candidate: input.candidateWorldState,
    target: candidates,
    diagnostics
  });
  deriveStructuredChildCandidates({
    current: input.currentWorldState,
    candidate: input.candidateWorldState,
    target: candidates,
    diagnostics
  });
  deriveStructuredHealthCandidates({
    current: input.currentWorldState,
    candidate: input.candidateWorldState,
    target: candidates,
    diagnostics
  });
  deriveCareerExitReviewCandidates({
    current: input.currentWorldState,
    candidate: input.candidateWorldState,
    target: candidates,
    diagnostics
  });
  for (const fact of input.explicitFacts || []) {
    const scope = fact.financialScope || "personal";
    addCandidate(candidates, diagnostics, {
      responsibilityKey: fact.responsibilityKey,
      responsibilityKind: fact.responsibilityKind,
      proposedType: fact.proposedType,
      action: fact.action || "start",
      completion: fact.completion || "completed",
      cadence: fact.cadence || "recurring_unknown",
      liability: fact.liability || "protagonist",
      financialScope: scope,
      explicitMonthlyTotalWan: fact.explicitMonthlyTotalWan,
      protagonistShareWan: fact.protagonistShareWan,
      shareRate: fact.shareRate,
      amountSourceId: fact.amountSourceId,
      participantPersonIds: fact.participantPersonIds || [],
      changeReason: fact.changeReason,
      nextStatus: fact.nextStatus,
      source: fact.source || "accepted_outcome",
      evidence: [sourceEvidence({ excerpt: fact.evidenceExcerpt, scope, reasonCode: "EXPENSE_EXPLICIT_RESPONSIBILITY" })]
    }, "EXPENSE_EXPLICIT_RESPONSIBILITY");
  }
  if (input.narrativeText) deriveNarrativeCandidates({
    narrativeText: input.narrativeText,
    candidateWorldState: input.candidateWorldState,
    existingExpenseCommitments: input.existingExpenseCommitments,
    target: candidates,
    diagnostics
  });
  return { candidates, diagnostics };
}
