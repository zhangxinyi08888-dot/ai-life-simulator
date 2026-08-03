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
import { parentElderCareCoverageRole } from "./elderCareCoverage";

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
  /** Named mother/father lacks an accepted PersonState identity; retain review only. */
  identityResolutionRequired?: boolean;
  /** Required with a lower, pause, resume, or end mutation; ignored for an ordinary increase. */
  changeReason?: ExpenseCommitmentChangeReason;
  /** Only `adjust` may request a temporary pause/resume of an existing responsibility. */
  nextStatus?: "active" | "paused";
  source?: ExpenseResponsibilityCandidate["source"];
  evidenceExcerpt: string;
}

const NON_COMPLETED = /计划|打算|考虑|准备|希望|可能|如果|将来|未来|讨论|商量|看房|物色|尝试|拟|预期/u;
const BUSINESS_PLACE = /工坊|工作室|办公室|办公场地|仓库|厂房|门店|商铺|店铺|服务器|团队|员工|原材料|推广|公司租金|经营场地/u;
const MONEY = /(\d+(?:\.\d+)?)\s*(万元|万|元)/u;
const HOUSING_EXPENSE_SIGNAL = /房租|租金|月租|物业费|住房维护|维修费|开始租住|续租|租住|租下|新租(?:的)?(?:公寓|房子|住房)|租的(?:公寓|房子|住房)|搬入|入住/u;
const PARENT_HEALTHCARE_EXPENSE_SIGNAL = /(?:父母|爸妈|母亲|父亲|妈妈|爸爸)[^。！？；]{0,24}(?:医疗|医药|治疗|复诊|用药|医院|门诊)|(?:医疗|医药|治疗|复诊|用药|医院|门诊)[^。！？；]{0,24}(?:父母|爸妈|母亲|父亲|妈妈|爸爸)/u;
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
 * A narrative sentence may mention salary, rent and family care together.
 * Never let the first amount in that sentence become every responsibility's
 * amount: bind a value only when it is locally adjacent to the responsibility
 * signal. If the sentence contains one amount total, the ordinary parser is
 * still safe to use as a compatibility fallback.
 */

function monthlyAmountNearExpenseSignal(
  text: string,
  signal: RegExp,
  conflictingResponsibilitySignal?: RegExp
): number | undefined {
  const signalMatches = [...text.matchAll(new RegExp(signal.source, "gu"))];
  const moneyMatches = [...text.matchAll(new RegExp(MONEY.source, "gu"))];
  const candidates: Array<{ amount: string; unit: string; localEvidence: string; distance: number; afterSignal: boolean }> = [];
  const hasConflict = (value: string) => conflictingResponsibilitySignal
    ? new RegExp(conflictingResponsibilitySignal.source, "u").test(value)
    : false;
  for (const signalMatch of signalMatches) {
    const signalStart = signalMatch.index;
    if (signalStart === undefined) continue;
    const signalEnd = signalStart + signalMatch[0].length;
    for (const moneyMatch of moneyMatches) {
      const moneyStart = moneyMatch.index;
      if (moneyStart === undefined) continue;
      const moneyEnd = moneyStart + moneyMatch[0].length;
      const afterSignal = moneyStart >= signalEnd;
      const distance = afterSignal ? moneyStart - signalEnd : signalStart - moneyEnd;
      if (distance < 0 || distance > 16) continue;
      const between = afterSignal
        ? text.slice(signalEnd, moneyStart)
        : text.slice(moneyEnd, signalStart);
      if (/\d/u.test(between) || hasConflict(between)) continue;
      // A preceding amount can belong to a different responsibility in the
      // same clause ("房租3500 元和父母医疗1200 元"). Do not let that
      // component cross the second responsibility's signal merely because it
      // is closer than its own following amount.
      if (!afterSignal && hasConflict(text.slice(Math.max(0, moneyStart - 24), signalStart))) continue;
      const localEvidence = text.slice(
        Math.max(0, Math.min(signalStart, moneyStart) - 16),
        Math.min(text.length, Math.max(signalEnd, moneyEnd) + 12)
      );
      candidates.push({
        amount: moneyMatch[1],
        unit: moneyMatch[2],
        localEvidence,
        distance,
        afterSignal
      });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || Number(right.afterSignal) - Number(left.afterSignal));
  const match = candidates[0];
  if (match) {
    const raw = toWan(match.amount, match.unit);
    if (raw === undefined) return undefined;
    // Frequency is local to this responsibility-amount pair. A sentence can
    // legitimately mention monthly salary alongside annual rent or medical
    // spending, so inspecting the whole sentence would pick the wrong cadence.
    if (/每年|年度|年缴|年付|年租|年支出|年费用|\/年/u.test(match.localEvidence)) return roundWan(raw / 12);
    if (/每季|季度/u.test(match.localEvidence)) return roundWan(raw / 3);
    return raw;
  }
  const allAmounts = [...text.matchAll(new RegExp(MONEY.source, "gu"))];
  return allAmounts.length === 1 ? monthlyAmount(text) : undefined;
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
    && /生活费|赡养|照护|护理|护工|照料|照顾|陪护|陪诊|接送.{0,10}就医|医疗|理疗|康复|康复训练|关节活动|轮椅|血压|膝盖|腰疼|长期监测|降压药|(?:医院|门诊).{0,8}(?:复查|体检|检查|评估)|(?:复查|体检|检查)(?:血压|病情|治疗)|请人.{0,12}(?:照看|照护|护理)/u.test(sentence);
}

/** A stable update that expressly says the care bill did not increase is not a new responsibility event. */
function hasNoNewParentExpenseSignal(sentence: string): boolean {
  if (!/(?:父母|爸妈|母亲|父亲|妈妈|爸爸)/u.test(sentence)) return false;
  const stable = /(?:身体|病情).{0,12}(?:还算|相对|基本)?稳定/u.test(sentence);
  const noIncrease = /(?:医疗|医药|照护|护理).{0,12}(?:支出|费用|开销).{0,12}(?:也)?(?:没|未|没有)(?:再)?(?:增加|上升|变多|提高)/u.test(sentence);
  return stable && noIncrease;
}

function hasFollowupPersonalCareAction(sentence: string): boolean {
  return /(?:你|我).{0,30}(?:请人|请(?:了)?(?:护工|钟点工|保姆|家政)|(?:给|为).{0,16}(?:他|她|父母|母亲|父亲|妈妈|爸爸).{0,20}(?:找|请)(?:了)?(?:一位|一名|个)?(?:康复师|理疗师)|照看|照护|护理|陪护|照料)/u.test(sentence)
    // “你每周固定陪她治疗” and “你推着轮椅去医院” are completed,
    // continuing care actions.  They are intentionally narrower than a
    // generic visit: the surrounding parent-care context is checked below
    // before this can establish a personal recurring responsibility.
    || /(?:你|我|本人|主角).{0,36}(?:陪(?:着)?(?:她|他|父母|母亲|父亲|妈妈|爸爸).{0,16}(?:治疗|理疗|复诊|就医)|推(?:着)?(?:她|他|父母|母亲|父亲|妈妈|爸爸).{0,16}(?:轮椅|去(?:医院|就医)))/u.test(sentence)
    // A daily rehabilitation routine is a care responsibility only when the
    // adjacent sentence has already anchored the parent and health context.
    // That second guard lives in `hasOngoingPersonalParentCareResponsibility`.
    || /(?:你|我|本人|主角).{0,36}(?:帮(?:着)?|协助).{0,16}(?:她|他|父母|母亲|父亲|妈妈|爸爸).{0,20}(?:康复训练|关节活动|复健)/u.test(sentence)
    || /^(?:给|为)家里请(?:了)?(?:一位|一名|个)?(?:每周[^。！？；]{0,12})?(?:钟点工|保姆|家政|护工)/u.test(sentence);
}

const CAREGIVER_SERVICE = /钟点工|护工|保姆|家政|康复师|理疗师|(?:白班|住家)?阿姨/u;
const PARENT_REFERENCE = /父母|爸妈|母亲|父亲|妈妈|爸爸/u;

/**
 * A jointly arranged caregiver becomes a completed recurring-responsibility
 * observation only once adjacent prose states the resulting recurring cost.
 * “商量请阿姨” alone remains a plan, while “决定请…每月多支出三千” is a
 * material household cash-flow fact that must not disappear behind the
 * generic `NON_COMPLETED` wording filter.
 */
function sharedCaregiverArrangement(input: {
  sentence: string;
  previousSentence: string;
  nextSentence: string;
}): { evidence: string; amount?: number; shareRate?: number } | undefined {
  const subject = /(?:你|我)(?!们)(?:与|和|跟|同)(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友)|(?:你们|我们|双方|两人)/u;
  const caregiver = /(?:决定|一起|共同)?请(?:了)?(?:一位|一名|个)?[^。！？；]{0,16}(?:钟点工|护工|保姆|家政|(?:白班|住家)?阿姨)/u;
  const elderContext = /(?:父母|爸妈|母亲|父亲|妈妈|爸爸|老人|两边老人|双方老人)/u;
  if (!subject.test(input.sentence) || !caregiver.test(input.sentence)) return undefined;
  const context = `${input.previousSentence}${input.sentence}${input.nextSentence}`;
  if (!elderContext.test(context) || BUSINESS_PLACE.test(context)) return undefined;
  const amount = monthlyAmount(input.nextSentence) ?? monthlyAmount(input.sentence);
  if (amount === undefined) return undefined;
  const evidence = `${input.sentence}${input.nextSentence}`;
  return {
    evidence,
    amount,
    shareRate: /(?:各(?:自)?承担|各付|一人一半|各半|平摊)/u.test(evidence) ? 0.5 : undefined
  };
}

/**
 * A generic first-person care verb is not enough: "你照料家里的猫" must
 * never inherit a nearby parent-health sentence.  These are the only forms
 * that establish the parent as the object in the same completed sentence.
 */
function hasNamedPersonalParentCareAction(sentence: string): boolean {
  return /(?:你|我|本人|主角).{0,44}(?:(?:陪(?:着)?|推(?:着)?).{0,16}(?:父母|爸妈|母亲|父亲|妈妈|爸爸).{0,20}(?:治疗|理疗|复诊|就医|轮椅)|带(?:着)?(?:父母|爸妈|母亲|父亲|妈妈|爸爸).{0,28}(?:去|到).{0,12}(?:医院|门诊).{0,16}(?:体检|检查|复查|治疗|理疗|康复评估)|(?:照料|照顾|陪护|陪诊|护理|照看).{0,16}(?:父母|爸妈|母亲|父亲|妈妈|爸爸)|(?:帮(?:着)?|协助).{0,16}(?:父母|爸妈|母亲|父亲|妈妈|爸爸).{0,20}(?:康复训练|关节活动|复健)|(?:给|为)(?:父母|爸妈|母亲|父亲|妈妈|爸爸).{0,16}(?:请|找)(?:了)?(?:护工|钟点工|保姆|家政|康复师|理疗师)|(?:给|为)(?:他|她).{0,20}(?:找|请)(?:了)?(?:一位|一名|个)?(?:康复师|理疗师)|(?:看望|探望).{0,12}(?:父母|爸妈|他们).{0,28}(?:请人|请(?:了)?(?:护工|钟点工|保姆|家政)|照看|照护|护理))/u.test(sentence)
    // The parent context may lead an otherwise target-elided care-service
    // arrangement in the *same* sentence, but the action must be arranging a
    // caregiver rather than a generic "照料" verb.
    || /(?:父母|爸妈|母亲|父亲|妈妈|爸爸).{0,72}(?:你|我|本人|主角).{0,40}(?:请人|请(?:了)?(?:护工|钟点工|保姆|家政))/u.test(sentence);
}

function hasLocalPronounParentCareAction(sentence: string): boolean {
  return /(?:你|我|本人|主角).{0,36}(?:(?:陪(?:着)?|推(?:着)?|照料|照顾|陪护|陪诊|护理|照看).{0,16}(?:她|他|他们)|(?:帮(?:着)?|协助).{0,16}(?:她|他|他们).{0,20}(?:康复训练|关节活动|复健))/u.test(sentence);
}

/**
 * An actual, continuing caregiving action is sufficient evidence that the
 * protagonist has taken on the care responsibility, even when the narrative
 * does not separately spell out a cash amount.  The resulting commitment is
 * still a policy-backed `needs_review` estimate, never an invented known
 * payment.  This is deliberately stricter than "a parent is unwell": there
 * must be a first-person care action, or a local ellipsis whose immediately
 * preceding sentence established the protagonist as the actor.
 */
function hasOngoingPersonalParentCareResponsibility(input: {
  sentence: string;
  previousSentence: string;
  parentContext: string;
}): boolean {
  if (!PARENT_REFERENCE.test(input.parentContext) || BUSINESS_PLACE.test(input.parentContext)) return false;
  const hasRecurringCadence = /每(?:天|日|周|月)|每隔.{0,4}(?:周|月)|固定|持续|长期|定期|其余时间|大部分时间|多数时间|主要精力|更多时间/u.test(input.parentContext);
  if (!hasRecurringCadence) return false;
  if (hasNamedPersonalParentCareAction(input.sentence)) return true;
  // The care context can precede the actor in one Chinese sentence, e.g.
  // “母亲每周五去县医院做理疗，你陪着她”。  Do not promote a bare
  // “陪着她” outside a parent/medical context; the three predicates together
  // are what establish a completed recurring caregiving responsibility.
  if (hasLocalPronounParentCareAction(input.sentence)
    && /理疗|治疗|复诊|就医|轮椅|照护|护理|陪诊|康复|康复训练|关节活动|复健|(?:医院|门诊).{0,8}(?:复查|体检|检查)|(?:复查|体检|检查)(?:血压|病情|治疗)/u.test(input.parentContext)) return true;
  return /(?:其余时间|大部分时间|多数时间|主要精力|更多时间).{0,20}(?:用来)?(?:照料|照顾|陪护|陪诊|护理).{0,16}(?:父母|爸妈|母亲|父亲|妈妈|爸爸)/u.test(input.sentence)
    && /(?:你|我|本人|主角)/u.test(input.previousSentence);
}

/**
 * A caregiver arrangement can be a meaningful new care need before it proves
 * that the protagonist pays a recurring amount. Keep that uncertainty visible
 * as a review candidate instead of turning a decision to ask a caregiver into
 * a personal `start`/`adjust`. This deliberately requires a parent reference,
 * a concrete caregiver, and a recurring schedule; a generic future plan is
 * still ignored by the normal non-completed-language guard.
 */
function hasPlannedParentCareArrangementReview(input: {
  sentence: string;
  previousSentence: string;
}): boolean {
  const context = `${input.previousSentence}${input.sentence}`;
  if (!PARENT_REFERENCE.test(context) || BUSINESS_PLACE.test(context)) return false;
  return /(?:商量|决定|考虑|计划|准备).{0,24}(?:请(?:一位|一名|个)?|安排).{0,16}(?:钟点工|护工|保姆|家政)/u.test(input.sentence)
    && /每(?:周|月)|固定|长期|持续/u.test(input.sentence);
}

/**
 * “按时服药” is a continuing health action, not a future health plan.  The
 * sentence can incidentally contain words such as “未来” (for example,
 * “你不再计算未来的年岁，只按时服药”), so it needs this narrow completed-fact
 * exception rather than weakening the generic planned-language guard.
 */
function hasCompletedOngoingPersonalHealthcareAction(sentence: string): boolean {
  if (/(?:计划|打算|准备|希望|尝试|提醒|建议|劝|嘱咐|要求|让|帮|陪).{0,24}(?:用药|服药|复诊|治疗)/u.test(sentence)) return false;
  // A plural household subject cannot establish the protagonist's individual
  // healthcare liability.  It may still be retained below as a shared
  // narrative candidate for review, but must never enter the personal
  // policy-estimate path merely because "你" is a prefix of "你们".
  if (/(?:你们|我们|双方|两人).{0,40}(?:继续|仍|每天|每日|按时|规律|固定|长期|持续|每月|定期|只).{0,14}(?:用药|服药|复诊|治疗)/u.test(sentence)) return false;
  // "你陪父亲按时服药" and similar care actions describe another person's
  // treatment.  A parent/proxy beneficiary preceding the treatment verb is
  // never evidence of the protagonist's own recurring healthcare.
  if (/(?:陪|提醒|建议|劝|嘱咐|要求|让|帮).{0,20}(?:父母|爸妈|母亲|父亲|妈妈|爸爸|他|她|他们).{0,20}(?:用药|服药|复诊)/u.test(sentence)) return false;
  return /(?:你|我|本人|主角).{0,40}(?:继续|仍|每天|每日|按时|规律|固定|长期|持续|每月|定期|只).{0,14}(?:用药|服药|复诊)/u.test(sentence);
}

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
  const elderCareCoverageMayOverlap = (left: Pick<ExpenseResponsibilityCandidate, "responsibilityKind" | "responsibilityKey" | "participantPersonIds">, right: Pick<ExpenseResponsibilityCandidate, "responsibilityKind" | "responsibilityKey" | "participantPersonIds">): boolean => {
    if (left.responsibilityKind !== "elder_care" || right.responsibilityKind !== "elder_care") return false;
    if (left.responsibilityKey === right.responsibilityKey) return true;
    const leftRole = parentElderCareCoverageRole(left);
    const rightRole = parentElderCareCoverageRole(right);
    return (leftRole === "aggregate" && rightRole === "individual")
      || (leftRole === "individual" && rightRole === "aggregate");
  };
  // An Accepted outcome can name “mother” or “father” before PersonState has
  // materialized the person. Preserve the role-specific review rather than
  // silently widening it to `parents`; a prose fallback in the same node must
  // not turn that unresolved identity into a live aggregate deduction.
  if ((candidate.action === "start" || candidate.action === "adjust") && target.some((item) => (
    item.identityResolutionRequired && elderCareCoverageMayOverlap(item, candidate)
  ))) return;
  if (candidate.identityResolutionRequired) {
    for (let index = target.length - 1; index >= 0; index--) {
      const existing = target[index];
      if (!elderCareCoverageMayOverlap(existing, candidate)
        || !["start", "adjust"].includes(existing.action)) continue;
      target.splice(index, 1);
      const diagnosticIndex = diagnostics.findIndex((item) => item.candidateId === existing.id);
      if (diagnosticIndex >= 0) diagnostics.splice(diagnosticIndex, 1);
    }
  }
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
  // Candidate derivation can see a concrete caregiving action and a generic
  // owner-review sentence for the same responsibility in one narrative. The
  // concrete completed action is stronger evidence; retaining the weaker
  // review would create a spurious PENDING_FACT beside the same planned
  // personal account. This is the reverse ordering of the start-after-review
  // case handled above, not a global unknown-liability override.
  if (candidate.action === "review" && candidate.liability === "unknown") {
    const confirmedCandidateAlreadyPresent = target.some((item) => (
      item.responsibilityKey === candidate.responsibilityKey
      && item.financialScope === candidate.financialScope
      && (item.action === "start" || item.action === "adjust")
      && item.liability !== "unknown"
    ));
    if (confirmedCandidateAlreadyPresent) return;
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
  const hasOngoingTreatment = /长期(?:治疗|康复)|持续(?:用药|治疗)|定期复诊|每月复诊|固定(?:医疗|治疗)|长期护理|护理服务|护工|按时服药/u.test(healthSummary);
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

function isCanonicalAggregateParentHealthcareCommitment(commitment: ExpenseCommitmentV4): boolean {
  return commitment.responsibilityKey === "recurring_healthcare:opening_parent"
    || commitment.responsibilityKey === "recurring_healthcare:parents";
}

/**
 * A named parent normally resolves only to that exact accepted account. The
 * narrow legacy exception is the unique canonical opening aggregate: reusing
 * it avoids silently opening a second medical account for the same already
 * captured responsibility. Never fall back to an unrelated named parent.
 */
function parentHealthcareTarget(input: {
  activeCommitments: ExpenseCommitmentV4[];
  namedParent?: PersonState;
}): ExpenseCommitmentV4 | undefined {
  if (!input.namedParent) {
    return input.activeCommitments.length === 1 ? input.activeCommitments[0] : undefined;
  }
  const exact = input.activeCommitments.find((commitment) => (
    commitment.responsibilityKey === `recurring_healthcare:${input.namedParent!.id}`
    || (commitment.participantPersonIds || []).includes(input.namedParent!.id)
  ));
  if (exact) return exact;
  const only = input.activeCommitments.length === 1 ? input.activeCommitments[0] : undefined;
  return only && isCanonicalAggregateParentHealthcareCommitment(only) ? only : undefined;
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

  const hasSharedPayer = /(?:你们|我们|双方|两人).{0,24}(?:支付|承担|负担|缴纳|分摊|平摊|各付|代付|租下|租住|搬入|入住)|(?:你们|我们|双方|两人).{0,36}(?:给|向).{0,12}(?:双方)?(?:父母|爸妈|母亲|父亲).{0,16}(?:生活费|赡养费|照护费|护理费)|(?:你们|我们|双方|两人).{0,30}(?:轮流|共同|一起).{0,14}(?:照护|陪护|陪诊|照料|接送).{0,20}(?:父母|爸妈|母亲|父亲|就医)|(?:你们|我们|双方|两人).{0,30}(?:每天|每日|按时|规律|固定|长期|持续|每月|定期|继续|仍).{0,14}(?:用药|服药|复诊|治疗)|(?:共同|各自承担|各付|一人一半|各半|平摊).{0,18}(?:支付|承担|负担|缴纳|房租|租金|费用|育儿|照护)/u.test(sentence);
  if (hasSharedPayer) {
    return {
      liability: "shared",
      financialScope: "shared_household",
      shareRate: /(?:各(?:自)?承担|各付|一人一半|各半|平摊)/u.test(sentence) ? 0.5 : undefined
    };
  }

  const hasThirdPartyPayer = /(?:伴侣|配偶|妻子|丈夫|父母|母亲|父亲|公司|雇主|朋友|他|她).{0,24}(?:支付|承担|负担|缴纳|转账|付款|代付)/u.test(sentence);
  if (hasThirdPartyPayer) return { liability: "third_party", financialScope: "third_party" };

  const hasPersonalPayer = /(?:你|我|本人|主角).{0,24}(?:支付|承担|负担|缴纳|转账|(?:转(?:给|向|账)|(?:给|向).{0,12}转(?!入))|付款|付(?:了)?(?:房租|租金|费|款)?|交了|租下|租住|租(?:了)?(?:一(?:个|间))?(?:小)?(?:单间|房间|公寓|房子|住房|住处)|搬入|入住|投保|(?<!继)续保)/u.test(sentence)
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
    // A first-person cash-flow sentence can name salary before listing the
    // recurring deductions. Once it explicitly says the narrator's monthly
    // cash flow deducts rent or parent medical care, that is stronger than an
    // owner-review; third-party/business payers have already returned above.
    || /(?:你|我|本人|主角|你的).{0,32}(?:月薪|工资|薪资|收入|现金流)[^。！？；]{0,96}(?:每月).{0,16}(?:扣除|扣掉|减去|除去).{0,24}(?:房租|租金|物业费|医疗|医药|治疗|复诊|用药)/u.test(sentence)
    || hasNamedPersonalParentCareAction(sentence)
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

/**
 * A later care observation may refine an already authoritative personal
 * care account, but it must not turn a relative's health state into a new
 * personal bill. Resolve only an active, policy-estimated account already in
 * the ledger; an exact account or ambiguous pair remains on the ordinary
 * review path.
 */
function contextualPersonalElderCareTarget(input: {
  commitments?: ExpenseCommitmentV4[];
  responsibilityKey: string;
}): ExpenseCommitmentV4 | undefined {
  const candidates = (input.commitments || []).filter((commitment) => (
    commitment.status === "active"
    && commitment.responsibilityKind === "elder_care"
    && parentElderCareCoverageRole(commitment) !== undefined
    && commitment.financialScope === "personal"
    && commitment.factStatus === "needs_review"
    && commitment.amountBasis === "contextual_estimate"
  ));
  const exact = candidates.find((commitment) => commitment.responsibilityKey === input.responsibilityKey);
  if (exact) return exact;
  // A named parent may refine the explicitly aggregate `parents` account.
  // Do not fall back to a merely unique unrelated parent account: father-care
  // evidence must never alter a mother's responsibility just because it is
  // the only contextual estimate currently open.
  return candidates.find((commitment) => commitment.responsibilityKey === "elder_care:parents");
}

/**
 * This is deliberately evidence-driven, not an age trigger. The phrase must
 * describe an already occurring, more intensive parent-care situation; a
 * one-off treatment, a home repair, or an illness without changed care stays
 * outside this path.
 */
function hasElderCareIntensityEscalation(sentence: string): boolean {
  if (NON_COMPLETED.test(sentence) || BUSINESS_PLACE.test(sentence) || !PARENT_REFERENCE.test(sentence)) return false;
  const careContext = /照护|护理|护工|陪护|陪诊|康复|康复训练|关节活动|复健|理疗|复诊|医院|医疗/u.test(sentence);
  if (!careContext) return false;
  return /(?:费用|开销|支出).{0,16}(?:增加|上升|变多|变高|加重)|(?:照护|护理|护工|康复|理疗|复诊|陪诊).{0,20}(?:增加|加重|更频繁|每天|每日|长期|持续)|(?:膝盖|腰疼|病情|行动|身体).{0,16}(?:加重|恶化|反复|行动不便)|(?:需要|开始).{0,16}(?:更多|长期|持续|每天|每日).{0,20}(?:照护|护理|康复|陪诊)|(?:膝盖|腰疼|病情|行动|身体)[\s\S]{0,96}(?:每天|每日|每周|定期|固定|持续|长期)[\s\S]{0,48}(?:陪(?:着)?|帮(?:着)?|协助|照料|照顾|护理|陪护|陪诊)[\s\S]{0,32}(?:康复训练|关节活动|复健|理疗|复诊|治疗|医院)/u.test(sentence);
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
    const previousSentence = sentences[index - 1] || "";
    const nextSentence = sentences[index + 1] || "";
    const completedSharedCaregiver = sharedCaregiverArrangement({ sentence, previousSentence, nextSentence });
    const explicitParentCareCommitment = isExplicitPersonalParentCareCommitment(sentence, nextSentence);
    const completedPersonalHealthcareAction = hasCompletedOngoingPersonalHealthcareAction(sentence);
    const plannedParentCareReview = hasPlannedParentCareArrangementReview({ sentence, previousSentence });
    if (!completedSentence(sentence)
      && !completedSharedCaregiver
      && !explicitParentCareCommitment
      && !completedPersonalHealthcareAction
      && !plannedParentCareReview) continue;
    if (hasNoNewParentExpenseSignal(sentence)) continue;
    // A care need and the protagonist's concrete follow-up commonly appear in
    // adjacent short sentences. Treat only that narrow pair as one fact so a
    // pronoun such as “他们” cannot erase an established parental obligation.
    const followsParentCare = hasParentCareSignal(sentence) && hasFollowupPersonalCareAction(nextSentence);
    const continuesParentCare = hasParentCareSignal(previousSentence) && hasFollowupPersonalCareAction(sentence);
    const evidenceSentence = followsParentCare
      ? `${sentence}${nextSentence}`
      : continuesParentCare
        ? `${previousSentence}${sentence}`
        : sentence;
    if (isRentalIncomeSentence(evidenceSentence)) continue;
    // Liability belongs to the current completed action, not to a
    // neighbouring context sentence stitched in only to preserve evidence.
    // Otherwise "父亲需要监测。你每周照料猫" would inherit a personal parent
    // care payer merely because both fragments were examined together.
    const liabilityContext = classifyNarrativeLiability(sentence);
    // A parent becoming ill alone remains an owner-review fact.  A completed
    // first-person caregiving routine is different: it establishes that the
    // protagonist is the care provider, while the unknown amount stays an
    // auditable policy estimate (`needs_review`).  Never override an explicit
    // third-party/shared payer classification.
    const personalCareResponsibility = liabilityContext.liability === "unknown"
      && hasOngoingPersonalParentCareResponsibility({
        sentence,
        previousSentence,
        parentContext: evidenceSentence
      });
    const personalHealthcareResponsibility = liabilityContext.liability === "unknown"
      && completedPersonalHealthcareAction;
    const scope = personalCareResponsibility || personalHealthcareResponsibility
      ? "personal"
      : liabilityContext.financialScope;
    const liability = personalCareResponsibility || personalHealthcareResponsibility
      ? "protagonist"
      : liabilityContext.liability;
    const shareRate = liabilityContext.shareRate;
    const isBusiness = scope === "business_operating";
    const amount = monthlyAmount(evidenceSentence);
    const housingAmount = monthlyAmountNearExpenseSignal(
      evidenceSentence,
      HOUSING_EXPENSE_SIGNAL,
      PARENT_HEALTHCARE_EXPENSE_SIGNAL
    );
    const parentHealthcareAmount = monthlyAmountNearExpenseSignal(
      evidenceSentence,
      PARENT_HEALTHCARE_EXPENSE_SIGNAL,
      HOUSING_EXPENSE_SIGNAL
    );

    if (completedSharedCaregiver) {
      const parent = parentCandidateIdentity({
        snapshot: input.candidateWorldState,
        sentence: `${previousSentence}${sentence}`
      });
      const shareRate = completedSharedCaregiver.shareRate;
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `elder_care:${parent.key}`,
        responsibilityKind: "elder_care",
        proposedType: "dependent_support",
        // The care service and its recurring household cost have happened,
        // but an unallocated total is not a personal-ledger amount. The
        // reconciler either creates the proven personal share or raises a
        // material scope blocker for regeneration; it must never disappear.
        action: "start",
        completion: "completed",
        cadence: "monthly",
        liability: "shared",
        financialScope: "shared_household",
        explicitMonthlyTotalWan: completedSharedCaregiver.amount,
        protagonistShareWan: shareRate === undefined
          ? undefined
          : roundWan(completedSharedCaregiver.amount * shareRate),
        shareRate,
        amountSourceId: `narrative_shared_caregiver_${completedSharedCaregiver.evidence}`,
        participantPersonIds: parent.participantPersonIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({
          excerpt: completedSharedCaregiver.evidence,
          scope: "shared_household",
          reasonCode: "EXPENSE_SHARED_ELDER_CARE_NARRATIVE"
        })]
      }, "EXPENSE_SHARED_ELDER_CARE_NARRATIVE");
      continue;
    }

    const parentForNarrative = parentCandidateIdentity({
      snapshot: input.candidateWorldState,
      sentence: evidenceSentence
    });
    const intensityTarget = contextualPersonalElderCareTarget({
      commitments: input.existingExpenseCommitments,
      responsibilityKey: `elder_care:${parentForNarrative.key}`
    });
    const establishedPersonalEscalation = hasElderCareIntensityEscalation(evidenceSentence)
      && amount === undefined
      && !["shared", "third_party", "none"].includes(liabilityContext.liability)
      && hasOngoingPersonalParentCareResponsibility({
        sentence,
        previousSentence,
        parentContext: evidenceSentence
      });
    if (intensityTarget && establishedPersonalEscalation) {
      // The existing account establishes who bears this responsibility. The
      // newly completed care escalation only permits an upward contextual
      // estimate, never an invented known amount or an age-only mutation.
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: intensityTarget.responsibilityKey,
        responsibilityKind: "elder_care",
        proposedType: "dependent_support",
        action: "adjust",
        completion: "completed",
        cadence: "recurring_unknown",
        liability: "protagonist",
        financialScope: "personal",
        participantPersonIds: intensityTarget.participantPersonIds,
        policyEstimateAdjustment: "increase_only",
        source: "narrative_supplement",
        evidence: [sourceEvidence({
          excerpt: evidenceSentence,
          scope: "personal",
          reasonCode: "EXPENSE_ELDER_CARE_INTENSITY_ESCALATION"
        })]
      }, "EXPENSE_ELDER_CARE_INTENSITY_ESCALATION");
      continue;
    }

    if (plannedParentCareReview) {
      const parent = parentCandidateIdentity({ snapshot: input.candidateWorldState, sentence: `${previousSentence}${sentence}` });
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `elder_care:${parent.key}`,
        responsibilityKind: "elder_care",
        proposedType: "dependent_support",
        // The decision and recurring care need are real, but no payer or
        // amount was accepted. `review` keeps it in the gate/audit path while
        // `unknown` prohibits a personal cash-flow mutation.
        action: "review",
        completion: "completed",
        cadence: "recurring_unknown",
        liability: "unknown",
        financialScope: "personal",
        participantPersonIds: parent.participantPersonIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({
          excerpt: sentence,
          scope: "personal",
          reasonCode: "EXPENSE_PARENT_CARE_ARRANGEMENT_REVIEW"
        })]
      }, "EXPENSE_PARENT_CARE_ARRANGEMENT_REVIEW");
      continue;
    }

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
      const target = parentHealthcareTarget({
        activeCommitments: activeParentHealthcare,
        namedParent
      });
      const parentKey = target?.responsibilityKey.replace(/^recurring_healthcare:/u, "");
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
        participantPersonIds: target?.participantPersonIds || parentParticipantIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({ excerpt: evidenceSentence, scope, reasonCode: "EXPENSE_MEDICAL_SUBSIDY_ADJUSTMENT" })]
      }, "EXPENSE_MEDICAL_SUBSIDY_ADJUSTMENT");
      continue;
    }

    // Do not let a single multi-clause sentence become a zero-sum parser
    // choice. In particular, a salary followed by "房租…和父母医疗…" contains
    // two distinct recurring outflows. Emit both responsibility candidates
    // with their locally-bound amounts before either legacy branch can
    // `continue` and hide the other one.
    if (HOUSING_EXPENSE_SIGNAL.test(evidenceSentence)
      && PARENT_HEALTHCARE_EXPENSE_SIGNAL.test(evidenceSentence)
      && housingAmount !== undefined
      && parentHealthcareAmount !== undefined) {
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: "primary_residence:main",
        responsibilityKind: "primary_residence",
        proposedType: "housing",
        action: candidateActionForLiability(liability),
        completion: "completed",
        cadence: "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: housingAmount,
        protagonistShareWan: liability === "third_party" || liability === "unknown"
          ? undefined
          : shareRate === undefined ? housingAmount : roundWan(housingAmount * shareRate),
        shareRate,
        amountSourceId: `narrative_housing_${evidenceSentence}`,
        participantPersonIds: [],
        source: "narrative_supplement",
        evidence: [sourceEvidence({
          excerpt: evidenceSentence,
          scope,
          reasonCode: isBusiness ? "EXPENSE_BUSINESS_PLACE" : "EXPENSE_HOUSING_NARRATIVE"
        })]
      }, isBusiness ? "EXPENSE_BUSINESS_PLACE" : "EXPENSE_HOUSING_NARRATIVE");
      const namedParent = findNamedStructuredPerson({
        snapshot: input.candidateWorldState,
        relation: "parent",
        sentence: evidenceSentence
      });
      const activeParentHealthcare = activeAcceptedParentHealthcareCommitments({
        commitments: input.existingExpenseCommitments,
        snapshot: input.candidateWorldState
      });
      const healthcareTarget = parentHealthcareTarget({
        activeCommitments: activeParentHealthcare,
        namedParent
      });
      const parent = parentCandidateIdentity({ snapshot: input.candidateWorldState, sentence: evidenceSentence });
      const parentKey = healthcareTarget?.responsibilityKey.replace(/^recurring_healthcare:/u, "") || parent.key;
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: `recurring_healthcare:${parentKey}`,
        responsibilityKind: "recurring_healthcare",
        proposedType: "healthcare",
        action: liability === "unknown" ? "review" : healthcareTarget ? "adjust" : "start",
        completion: "completed",
        cadence: "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: parentHealthcareAmount,
        protagonistShareWan: liability === "protagonist" || liability === "shared"
          ? shareRate === undefined ? parentHealthcareAmount : roundWan(parentHealthcareAmount * shareRate)
          : undefined,
        shareRate,
        amountSourceId: `narrative_parent_healthcare_${evidenceSentence}`,
        participantPersonIds: healthcareTarget?.participantPersonIds || parent.participantPersonIds,
        source: "narrative_supplement",
        evidence: [sourceEvidence({
          excerpt: evidenceSentence,
          scope,
          reasonCode: "EXPENSE_PARENT_MEDICAL_SPLIT"
        })]
      }, "EXPENSE_PARENT_MEDICAL_SPLIT");
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

    // `续签` alone is not a residence fact: a customer can renew an annual
    // contract, which may also contain a large annual revenue amount.  Keep
    // the renewal signal only when the same sentence names a residence or a
    // rental agreement.  Explicit rent/occupancy terms remain sufficient.
    if (HOUSING_EXPENSE_SIGNAL.test(evidenceSentence)
      || /(?:续签[^。！？；]{0,24}(?:房子|房屋|住房|公寓|住处|住所|租约|租房合同)|(?:房子|房屋|住房|公寓|住处|住所|租约|租房合同)[^。！？；]{0,24}续签)/u.test(evidenceSentence)) {
      addCandidate(input.target, input.diagnostics, {
        responsibilityKey: "primary_residence:main",
        responsibilityKind: "primary_residence",
        proposedType: "housing",
        action: candidateActionForLiability(liability),
        completion: "completed",
        cadence: housingAmount === undefined ? "recurring_unknown" : "monthly",
        liability,
        financialScope: scope,
        explicitMonthlyTotalWan: housingAmount,
        protagonistShareWan: liability === "third_party" || liability === "unknown"
          ? undefined
          : housingAmount !== undefined && shareRate !== undefined ? roundWan(housingAmount * shareRate) : housingAmount,
        shareRate,
        amountSourceId: housingAmount === undefined ? undefined : `narrative_housing_${evidenceSentence}`,
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

    if (/(?:长期治疗|持续用药|每月复诊|长期康复|固定医疗|护工|定期复诊|按时服药)/u.test(evidenceSentence)) {
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
      identityResolutionRequired: fact.identityResolutionRequired,
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
