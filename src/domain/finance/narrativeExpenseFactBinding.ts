import type { WorldStateSnapshot } from "../../types";
import type {
  ExpenseCommitmentType,
  ExpenseCommitmentV4,
  ExpenseResponsibilityCandidate,
  ExpenseResponsibilityKind,
  FinancialEvidence
} from "./types";
import type {
  ExpenseResponsibilityAction,
  ExpenseResponsibilityCadence,
  ExpenseResponsibilityCompletion,
  ExpenseResponsibilityLiability,
  ExpenseResponsibilityScope
} from "./expenseResponsibility";

/**
 * A deliberately non-persistent representation of a contiguous source span.
 * Offsets are JavaScript UTF-16 offsets and follow the [start, end) contract.
 */
export interface TextSpan {
  start: number;
  end: number;
  excerpt: string;
}

export interface NarrativeClause {
  id: string;
  sentenceIndex: number;
  clauseIndex: number;
  start: number;
  end: number;
  text: string;
}

export type NarrativeExpenseBindingMateriality = "nonmaterial" | "review" | "critical";
export type NarrativeExpenseBindingDisposition = "bound" | "owner_review" | "ignored" | "ambiguous";
export type NarrativeExpenseBindingUnresolvedField = "completion" | "payer" | "scope" | "amount" | "share" | "cadence";

/**
 * A source-local fact.  It is intentionally richer than the existing
 * ExpenseResponsibilityCandidate, but it never reaches the ledger on its own.
 */
export interface NarrativeExpenseFactBinding {
  id: string;
  clauseId: string;
  sentenceIndex: number;
  clauseIndex: number;
  contextClauseIds: string[];
  sourceNodeId?: string;
  sourceOutcomeId?: string;
  sourceIdentityStatus: "bound" | "missing";
  evidenceFingerprint: string;

  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  action: ExpenseResponsibilityAction;
  completion: ExpenseResponsibilityCompletion;
  cadence: ExpenseResponsibilityCadence;

  liability: ExpenseResponsibilityLiability;
  financialScope: ExpenseResponsibilityScope;
  shareRate?: number;
  explicitMonthlyTotalWan?: number;
  protagonistShareWan?: number;
  /** Undefined without a stable source identity: it cannot be confirmation authority. */
  amountSourceId?: string;
  participantPersonIds: string[];

  responsibilitySpan: TextSpan;
  completionSpan?: TextSpan;
  payerSpan?: TextSpan;
  amountSpan?: TextSpan;
  cadenceSpan?: TextSpan;
  sourceMateriality: NarrativeExpenseBindingMateriality;
  unresolvedFields: NarrativeExpenseBindingUnresolvedField[];
  reasonCodes: string[];
}

export interface NarrativeExpenseFactBindingDiagnostic {
  clauseId: string;
  bindingId?: string;
  disposition: NarrativeExpenseBindingDisposition;
  reasonCodes: string[];
}

export interface NarrativeExpenseFactBindingResult {
  clauses: NarrativeClause[];
  bindings: NarrativeExpenseFactBinding[];
  diagnostics: NarrativeExpenseFactBindingDiagnostic[];
}

/**
 * Metadata is intentionally carried on the adapter result rather than added
 * to the persisted finance types in Phase 1.  The structural subtype remains
 * assignable wherever the legacy candidate type is consumed.
 */
export interface NarrativeBindingCandidate extends ExpenseResponsibilityCandidate {
  sourceFactBindingId: string;
  sourceSpans: {
    responsibility: TextSpan;
    completion?: TextSpan;
    payer?: TextSpan;
    amount?: TextSpan;
    cadence?: TextSpan;
  };
  sourceClause: {
    clauseId: string;
    contextClauseIds: string[];
    sentenceIndex: number;
    clauseIndex: number;
  };
  /** Legacy candidates have no `ignored` telemetry state; retain it only in diagnostics. */
  sourceBindingDisposition: Exclude<NarrativeExpenseBindingDisposition, "ignored">;
  sourceMateriality: NarrativeExpenseBindingMateriality;
  unresolvedFields: NarrativeExpenseBindingUnresolvedField[];
  sourceBindingReasonCodes: string[];
}

interface MoneyMention {
  span: TextSpan;
  monthlyWan: number;
  cadence: ExpenseResponsibilityCadence;
  cadenceSpan?: TextSpan;
  isIncome: boolean;
}

interface RawFact {
  clause: NarrativeClause;
  responsibilityKey: string;
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  responsibilitySpan: TextSpan;
  participantPersonIds: string[];
  sentenceText: string;
  sentenceClauses: NarrativeClause[];
}

interface PayerResolution {
  liability: ExpenseResponsibilityLiability;
  financialScope: ExpenseResponsibilityScope;
  shareRate?: number;
  payerSpan?: TextSpan;
}

const SENTENCE_SEPARATOR = /[。！？；\n]/u;
const CLAUSE_SEPARATOR = /[，,]/u;

const INCOME_CONTEXT = /(?:税后|到手)?(?:月薪|工资|薪资|收入|年薪|年收入|报酬|顾问费|咨询收入|副业收入|营收|营业收入|合同额|回款|奖金|分红|股息)/u;
const RENTAL_INCOME = /(?:把|将).{0,20}(?:房子|房屋|住房|公寓|房产).{0,12}(?:出租|租(?:了)?出去)|(?:收取|获得|收到).{0,16}(?:房租|租金)|(?:房租|租金).{0,16}(?:收入|转入|打入|汇入|存入)/u;
const BUSINESS_PLACE = /工坊|工作室|办公室|办公场地|办公位|共享(?:办公(?:空间|室|位)?|工位)|联合(?:办公(?:空间|室|位)?|工位)|仓库|厂房|门店|商铺|店铺|经营场地/u;
const PERSONAL_PRONOUN = /(?:你(?!们)|我(?!们)|本人|主角)/u;
const SHARED_PAYER = /你们|我们|(?:你|我)(?!们)(?:与|和|跟|同)(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友)|共同(?:支付|承担|负担|缴纳)|双方(?:支付|承担)|两人(?:支付|承担)|各(?:自)?承担|各付|一人一半|各半|平摊/u;
const THIRD_PARTY_PAYER = /(?:伴侣|配偶|妻子|丈夫|父母|母亲|父亲|妈妈|爸爸|姐姐|哥哥|弟弟|妹妹|叔叔|阿姨|公司|雇主|朋友|他|她).{0,24}(?:支付|承担|负担|缴纳|转账|付款|代付)/u;
const PERSONAL_PAYER = /(?:由|费用由)?(?:你(?!们)|我(?!们)|本人|主角).{0,24}(?:承担|支付|负担|缴纳|转账|付款|交(?!通)(?:了)?|签下|续签|续租|租住|租下|投保|续保|购买)|(?:你(?!们)|我(?!们)|本人|主角).{0,12}(?:每月|每年).{0,20}(?:给|向).{0,12}(?:父母|母亲|父亲|孩子|子女).{0,16}(?:转|支付|承担|负担)/u;
const CASHFLOW_DEDUCTION = /(?:扣除|扣掉|扣|减去|除去).{0,18}(?:房租|租金|物业费|医疗|医药|治疗|复诊|用药)/u;
const COMPLETED_ACTION = /已经|已(?:经)?|正在|目前|现已|持续|固定|继续|仍(?:在)?|每月(?:都)?|每年(?:都)?|(?:支付|承担|负担|缴纳|交(?!通)(?:了)?|扣除|扣掉|续租|租住|上门|开始服务|服药|用药|复诊|购买)/u;
const ONGOING_ACTION = /正在|持续|继续|仍(?:在)?|长期|固定|定期|连续/u;
const PLANNED_ACTION = /计划|打算|考虑|准备|希望|可能|如果|将来|未来|讨论|商量|看房|物色|尝试|拟|预期|决定/u;
const HYPOTHETICAL_ACTION = /如果|可能|或许|一旦|假如/u;
const CASHFLOW_PREDICATE = /支付|承担|负担|缴纳|扣除|扣掉|交(?!通)(?:了)?|转给|转账|房租|租金|保费|服务费|费用|开销|固定支出|月租/u;
const CARE_SERVICE = /护工|钟点工|保姆|家政|陪护|照护|照料|护理|康复师|理疗师|(?:白班|住家)?阿姨/u;
const PARENT_REFERENCE = /父母|爸妈|母亲|父亲|妈妈|爸爸|老人|长辈/u;

const RESPONSIBILITY_PATTERNS: Array<{
  responsibilityKind: ExpenseResponsibilityKind;
  proposedType: ExpenseCommitmentType;
  signal: RegExp;
}> = [
  {
    responsibilityKind: "primary_residence",
    proposedType: "housing",
    signal: /房租|租金|月租|物业费|租约|租住|续签|续租|租下|搬入|入住|公寓|住房|住处/u
  },
  {
    responsibilityKind: "child_support",
    proposedType: "dependent_support",
    signal: /育儿|托育|孩子|子女|宝宝|学费|奶粉|国际课程/u
  },
  {
    responsibilityKind: "elder_care",
    proposedType: "dependent_support",
    signal: /赡养|生活费|护工|钟点工|保姆|家政|陪护|照护|照料|护理|康复师|理疗师|(?:白班|住家)?阿姨|陪诊|陪同就医/u
  },
  {
    responsibilityKind: "recurring_healthcare",
    proposedType: "healthcare",
    signal: /医疗|医药|治疗|疗法|复诊|用药|服药|慢病药物?|药费|降压药|医院|门诊|体检|复查|理疗|康复/u
  },
  {
    responsibilityKind: "personal_insurance",
    proposedType: "insurance",
    signal: /保险费|保费|医疗险|重疾险|商业保险|投保|续保|(?:自己的|个人|本人).{0,4}保险|保险升级/u
  },
  {
    responsibilityKind: "continuing_education",
    proposedType: "education",
    signal: /课程费|培训费|进修|学费|继续教育/u
  }
];

function roundWan(value: number): number {
  return Number(value.toFixed(4));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function createSpan(text: string, start: number, end: number): TextSpan {
  return { start, end, excerpt: text.slice(start, end) };
}

function trimRange(text: string, start: number, end: number): [number, number] | undefined {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/u.test(text[nextStart])) nextStart += 1;
  while (nextEnd > nextStart && (/\s/u.test(text[nextEnd - 1]) || SENTENCE_SEPARATOR.test(text[nextEnd - 1]))) nextEnd -= 1;
  return nextStart < nextEnd ? [nextStart, nextEnd] : undefined;
}

/**
 * Segment sentences first, then comma-delimited clauses.  We deliberately do
 * not cut on every conjunction: an amount enumeration such as “房租 5000 和
 * 医疗 1200” must remain available to the one-to-one amount binder.
 */
export function segmentNarrativeExpenseClauses(text: string): NarrativeClause[] {
  const clauses: NarrativeClause[] = [];
  let sentenceStart = 0;
  let sentenceIndex = 0;

  const appendSentence = (start: number, end: number) => {
    const sentenceRange = trimRange(text, start, end);
    if (!sentenceRange) return;
    const [trimmedStart, trimmedEnd] = sentenceRange;
    let clauseStart = trimmedStart;
    let clauseIndex = 0;
    for (let index = trimmedStart; index < trimmedEnd; index += 1) {
      if (!CLAUSE_SEPARATOR.test(text[index])) continue;
      const clauseRange = trimRange(text, clauseStart, index);
      if (clauseRange) {
        const [startOffset, endOffset] = clauseRange;
        clauses.push({
          id: `expense_clause:${sentenceIndex}:${clauseIndex}:${startOffset}-${endOffset}`,
          sentenceIndex,
          clauseIndex,
          start: startOffset,
          end: endOffset,
          text: text.slice(startOffset, endOffset)
        });
        clauseIndex += 1;
      }
      clauseStart = index + 1;
    }
    const tailRange = trimRange(text, clauseStart, trimmedEnd);
    if (tailRange) {
      const [startOffset, endOffset] = tailRange;
      clauses.push({
        id: `expense_clause:${sentenceIndex}:${clauseIndex}:${startOffset}-${endOffset}`,
        sentenceIndex,
        clauseIndex,
        start: startOffset,
        end: endOffset,
        text: text.slice(startOffset, endOffset)
      });
    }
    sentenceIndex += 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_SEPARATOR.test(text[index])) continue;
    appendSentence(sentenceStart, index);
    sentenceStart = index + 1;
  }
  appendSentence(sentenceStart, text.length);
  return clauses;
}

function sentenceTextFor(clauses: NarrativeClause[], clause: NarrativeClause, text: string): string {
  const sentenceClauses = clauses.filter((item) => item.sentenceIndex === clause.sentenceIndex);
  if (!sentenceClauses.length) return clause.text;
  return text.slice(sentenceClauses[0].start, sentenceClauses[sentenceClauses.length - 1].end);
}

function sentenceClausesFor(clauses: NarrativeClause[], clause: NarrativeClause): NarrativeClause[] {
  return clauses.filter((item) => item.sentenceIndex === clause.sentenceIndex);
}

function allMatches(pattern: RegExp, text: string): RegExpExecArray[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))];
}

function parseChineseThousands(raw: string): number | undefined {
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const simple = raw.match(/^([一二两三四五六七八九])千(?:([一二两三四五六七八九])(?:百)?)?多?$/u);
  if (simple) {
    const thousand = digits[simple[1]];
    const hundred = simple[2] ? digits[simple[2]] * 100 : 0;
    return thousand * 1000 + hundred;
  }
  const wan = raw.match(/^([一二两三四五六七八九])万(?:([一二两三四五六七八九])千)?$/u);
  if (wan) return digits[wan[1]] * 10_000 + (wan[2] ? digits[wan[2]] * 1000 : 0);
  return undefined;
}

function cadenceFor(
  text: string,
  start: number,
  end: number,
  bounds?: { start: number; end: number }
): { cadence: ExpenseResponsibilityCadence; span?: TextSpan } {
  const localStart = Math.max(bounds?.start || 0, start - 18);
  const localEnd = Math.min(bounds?.end ?? text.length, end + 18);
  const local = text.slice(localStart, localEnd);
  const match = (pattern: RegExp): TextSpan | undefined => {
    const result = pattern.exec(local);
    if (!result || result.index === undefined) return undefined;
    return createSpan(text, localStart + result.index, localStart + result.index + result[0].length);
  };
  const monthly = match(/每月|每个月|月均|月租|月付/u);
  if (monthly) return { cadence: "monthly", span: monthly };
  // “下季度升级” is an effective-time statement, not quarterly billing.
  const quarterly = match(/每季|每季度|按季|季度(?:缴|付|支付|缴纳|费用)/u);
  if (quarterly) return { cadence: "quarterly", span: quarterly };
  const annual = match(/每年|年度|年缴|年付|年租|年支出|年费用|年保费/u);
  if (annual) return { cadence: "annual", span: annual };
  const oneOff = match(/一次|一笔|单次/u);
  if (oneOff) return { cadence: "one_off", span: oneOff };
  return { cadence: "recurring_unknown" };
}

function moneyMentions(text: string, clause: NarrativeClause): MoneyMention[] {
  const result: MoneyMention[] = [];
  const add = (start: number, end: number, rawValue: string, unit: "wan" | "yuan") => {
    const numeric = /^\d/u.test(rawValue) ? Number(rawValue) : parseChineseThousands(rawValue);
    if (!Number.isFinite(numeric) || numeric === undefined || numeric <= 0) return;
    const rawWan = unit === "wan" ? numeric : numeric / 10_000;
    const cadence = cadenceFor(text, start, end, clause);
    const monthlyWan = cadence.cadence === "annual"
      ? roundWan(rawWan / 12)
      : cadence.cadence === "quarterly"
        ? roundWan(rawWan / 3)
        : roundWan(rawWan);
    const context = text.slice(Math.max(clause.start, start - 18), Math.min(clause.end, end + 12));
    result.push({
      span: createSpan(text, start, end),
      monthlyWan,
      cadence: cadence.cadence,
      cadenceSpan: cadence.span,
      isIncome: INCOME_CONTEXT.test(context)
    });
  };

  const arabic = /(\d+(?:\.\d+)?)\s*(万元|万|元)/gu;
  for (const match of text.slice(clause.start, clause.end).matchAll(arabic)) {
    if (match.index === undefined) continue;
    const start = clause.start + match.index;
    add(start, start + match[0].length, match[1], match[2].startsWith("万") ? "wan" : "yuan");
  }

  // Chinese shorthand is intentionally accepted only when it has an amount
  // shape (e.g. 两千四), not for ordinary Chinese prose such as “一半”.
  const chinese = /([一二两三四五六七八九](?:千(?:[一二两三四五六七八九](?:百)?)?)?多?|[一二两三四五六七八九]万(?:[一二两三四五六七八九]千)?)(?:元)?/gu;
  for (const match of text.slice(clause.start, clause.end).matchAll(chinese)) {
    if (match.index === undefined || parseChineseThousands(match[1]) === undefined) continue;
    const start = clause.start + match.index;
    // Do not duplicate an Arabic amount's unit span. The Chinese expression
    // parser only yields a result for ideographic numerals, so this is mostly
    // defensive for mixed text.
    if (result.some((item) => item.span.start === start)) continue;
    add(start, start + match[0].length, match[1], "yuan");
  }
  return result.sort((left, right) => left.span.start - right.span.start);
}

function parentIdentity(input: { snapshot?: WorldStateSnapshot; text: string }): { key: string; ids: string[] } {
  const parent = input.snapshot?.people.find((person) => (
    person.relation === "parent"
    && Boolean(person.displayName)
    && input.text.includes(person.displayName || "")
  ));
  return parent ? { key: parent.id, ids: [parent.id] } : { key: "parents", ids: [] };
}

function keyFor(input: {
  responsibilityKind: ExpenseResponsibilityKind;
  clauseText: string;
  snapshot?: WorldStateSnapshot;
}): { key: string; participantPersonIds: string[] } {
  switch (input.responsibilityKind) {
    case "primary_residence": return {
      key: /父母|母亲|父亲|妈妈|爸爸|老人|长辈/u.test(input.clauseText) && /暂住处|住处|住所/u.test(input.clauseText)
        ? "primary_residence:parent_temp"
        : "primary_residence:main",
      participantPersonIds: []
    };
    case "child_support": return { key: "child_support:unidentified", participantPersonIds: [] };
    case "elder_care": {
      const parent = parentIdentity({ snapshot: input.snapshot, text: input.clauseText });
      return { key: `elder_care:${parent.key}`, participantPersonIds: parent.ids };
    }
    case "recurring_healthcare": {
      if (PARENT_REFERENCE.test(input.clauseText)) {
        const parent = parentIdentity({ snapshot: input.snapshot, text: input.clauseText });
        return { key: `recurring_healthcare:${parent.key}`, participantPersonIds: parent.ids };
      }
      return { key: "recurring_healthcare:protagonist", participantPersonIds: [] };
    }
    case "personal_insurance": return { key: "personal_insurance:protagonist", participantPersonIds: [] };
    case "continuing_education": return { key: "continuing_education:protagonist", participantPersonIds: [] };
    default: return { key: "adult_basic_living:protagonist", participantPersonIds: [] };
  }
}

function rawFactsForClause(input: {
  narrativeText: string;
  clause: NarrativeClause;
  clauses: NarrativeClause[];
  candidateWorldState?: WorldStateSnapshot;
}): RawFact[] {
  if (RENTAL_INCOME.test(input.clause.text)) return [];
  const facts: RawFact[] = [];
  for (const pattern of RESPONSIBILITY_PATTERNS) {
    for (const match of allMatches(pattern.signal, input.clause.text)) {
      if (match.index === undefined) continue;
      const start = input.clause.start + match.index;
      const sentenceText = sentenceTextFor(input.clauses, input.clause, input.narrativeText);
      // Bare narrative category words such as “工作、照料、学习” describe a
      // life domain, not a recurring elder-care cash obligation. Generic care
      // verbs need a beneficiary or an actual paid-care predicate in the same
      // sentence; named providers (护工/钟点工/康复师...) remain valid signals.
      if (pattern.responsibilityKind === "elder_care"
        && /^(?:照护|照料|护理)$/u.test(match[0])
        && !PARENT_REFERENCE.test(sentenceText)
        && !/(?:孩子|子女|老人|长辈|患者|病人).{0,16}(?:照护|照料|护理)|(?:照护|照料|护理).{0,16}(?:费用|服务费|支出|开销|支付|承担)/u.test(sentenceText)) {
        continue;
      }
      // A generic “康复” is a healthcare signal.  If it is already part of a
      // named caregiver action, the elder-care fact owns the recurring bill.
      if (pattern.responsibilityKind === "recurring_healthcare"
        && CARE_SERVICE.test(input.clause.text)
        && /康复师|理疗师/u.test(match[0])) continue;
      // Insurance product names own their embedded “医疗” token; otherwise a
      // single premium manufactures a second healthcare responsibility.
      if (pattern.responsibilityKind === "recurring_healthcare"
        && /医疗险|重疾险|保险费|保费/u.test(input.clause.text)) continue;
      // Transportation mentioned only as context for a follow-up visit is not
      // itself a recurring healthcare responsibility. The independent blind
      // review caught this while evaluating a housing-cost sentence.
      if (pattern.responsibilityKind === "recurring_healthcare"
        && /(?:复查|复诊|就医|看病)时的交通/u.test(input.clause.text)) continue;
      // A comma can separate the beneficiary from the expense predicate
      // (“父亲身体不好，需要定期复查”). The beneficiary is still a sentence
      // local fact, unlike payer/amount which remain fact-local below.
      const beneficiaryContext = sentenceClausesFor(input.clauses, input.clause)
        .filter((item) => item.clauseIndex <= input.clause.clauseIndex)
        .map((item) => item.text)
        .join("，");
      const key = keyFor({
        responsibilityKind: pattern.responsibilityKind,
        clauseText: beneficiaryContext,
        snapshot: input.candidateWorldState
      });
      facts.push({
        clause: input.clause,
        responsibilityKey: key.key,
        responsibilityKind: pattern.responsibilityKind,
        proposedType: pattern.proposedType,
        responsibilitySpan: createSpan(input.narrativeText, start, start + match[0].length),
        participantPersonIds: key.participantPersonIds,
        sentenceText,
        sentenceClauses: sentenceClausesFor(input.clauses, input.clause)
      });
      // One phrase should create one fact for a responsibility kind. The
      // current clause can still carry a second distinct responsibility.
      break;
    }
  }
  return facts.sort((left, right) => left.responsibilitySpan.start - right.responsibilitySpan.start);
}

function spanForMatch(text: string, clause: NarrativeClause, pattern: RegExp): TextSpan | undefined {
  const match = pattern.exec(clause.text);
  if (!match || match.index === undefined) return undefined;
  const start = clause.start + match.index;
  return createSpan(text, start, start + match[0].length);
}

function completionFor(input: {
  text: string;
  fact: RawFact;
  contextClauses: NarrativeClause[];
}): { completion: ExpenseResponsibilityCompletion; span?: TextSpan } {
  const contextText = input.contextClauses.map((item) => item.text).join("；");
  const explicitCompletedSpan = spanForMatch(input.text, input.fact.clause, /已经|已(?:经)?|正在|目前|现已|持续|继续|仍(?:在)?|续租|租住|服药|用药|复诊/u)
    || input.contextClauses
      .filter((clause) => clause.id !== input.fact.clause.id)
      .map((clause) => spanForMatch(input.text, clause, /已经上门|已上门|已经开始|已开始|正在服务|开始服务|已经|已(?:经)?|正在|目前|现已|持续|继续|仍(?:在)?|续租|租住|服药|用药|复诊/u))
      .find(Boolean);
  const actionSpan = spanForMatch(input.text, input.fact.clause, /支付|承担|负担|缴纳|交(?!通)(?:了)?|扣除|扣掉|购买/u)
    || input.contextClauses
      .filter((clause) => clause.id !== input.fact.clause.id)
      .map((clause) => spanForMatch(input.text, clause, /支付|承担|负担|缴纳|交(?!通)(?:了)?|扣除|扣掉|购买/u))
      .find(Boolean);
  const plannedSpan = spanForMatch(input.text, input.fact.clause, PLANNED_ACTION);
  const hypotheticalSpan = spanForMatch(input.text, input.fact.clause, HYPOTHETICAL_ACTION);
  // “决定请护工”本身仍只是计划；只有相连 clause 同时写出已经形成的
  // 当前周期性开销，才把该服务安排视为 completed。这样既保留计划过滤，
  // 又不会让现实中已发生的共同照护现金流因“决定”二字被整句丢弃。
  const careCashflowSpan = input.fact.responsibilityKind === "elder_care"
    && CARE_SERVICE.test(input.fact.clause.text)
    ? input.contextClauses
      .map((clause) => spanForMatch(input.text, clause, /(?:这笔|该|其)?(?:开销|费用|服务费|照护费)|每月.{0,16}(?:支出|费用|开销|支付|承担)/u))
      .find(Boolean)
    : undefined;

  // A concrete completion marker wins over a plan in the same fact (“原本
  // 计划搬家，但已经续租”), while a bare “计划开始支付” cannot become an
  // active bill merely because it contains the verb “支付”.
  const completionEvidenceSpan = explicitCompletedSpan && /^(?:服药|用药|复诊)$/u.test(explicitCompletedSpan.excerpt) && actionSpan
    ? actionSpan
    : explicitCompletedSpan || careCashflowSpan;
  if (completionEvidenceSpan) {
    return {
      completion: ONGOING_ACTION.test(contextText) ? "ongoing" : "completed",
      span: completionEvidenceSpan
    };
  }
  if (hypotheticalSpan) return { completion: "hypothetical", span: hypotheticalSpan };
  if (plannedSpan) return { completion: "planned", span: plannedSpan };
  if (actionSpan) return { completion: "completed", span: actionSpan };
  // A health need is a reviewable responsibility observation, not proof that
  // a recurring cashflow is already occurring.
  if (/需要|应当|建议|安排/u.test(input.fact.clause.text)) {
    return { completion: "hypothetical", span: spanForMatch(input.text, input.fact.clause, /需要|应当|建议|安排/u) };
  }
  return { completion: "ongoing" };
}

/**
 * Find the actor actually adjacent to the payment action. A whole-sentence
 * regex would start at “父亲” in “父亲服药由母亲承担”, incorrectly making the
 * beneficiary look like the payer. The closest valid actor/action pair wins.
 */
function thirdPartyPayerSpan(text: string, clauses: NarrativeClause[]): TextSpan | undefined {
  const actor = /伴侣|配偶|妻子|丈夫|父母|母亲|父亲|妈妈|爸爸|姐姐|哥哥|弟弟|妹妹|叔叔|阿姨|公司|雇主|朋友|他|她/gu;
  let best: { span: TextSpan; distance: number } | undefined;
  for (const clause of clauses) {
    for (const match of clause.text.matchAll(actor)) {
      if (match.index === undefined) continue;
      const actorStart = clause.start + match.index;
      const actionMatch = /(?:支付|承担|负担|缴纳|转账|付款|代付)/u.exec(text.slice(actorStart, Math.min(clause.end, actorStart + 28)));
      if (!actionMatch || actionMatch.index === undefined) continue;
      const actionStart = actorStart + actionMatch.index;
      const actionEnd = actionStart + actionMatch[0].length;
      const candidate = { span: createSpan(text, actorStart, actionEnd), distance: actionStart - (actorStart + match[0].length) };
      if (!best || candidate.distance < best.distance || candidate.distance === best.distance && candidate.span.start > best.span.start) {
        best = candidate;
      }
    }
  }
  return best?.span;
}

function payerFor(input: {
  text: string;
  fact: RawFact;
  contextClauses: NarrativeClause[];
}): PayerResolution {
  const context = input.contextClauses.map((clause) => clause.text).join("；");
  const local = input.fact.clause.text;
  const sentence = input.fact.sentenceText;
  const payerSpan = (pattern: RegExp) => input.contextClauses
    .map((clause) => spanForMatch(input.text, clause, pattern)).find(Boolean);
  const business = BUSINESS_PLACE.test(context)
    || /公司.{0,18}(?:支付|承担|租(?:下|用|赁)|缴纳)/u.test(context);
  if (business) return {
    liability: "none",
    financialScope: "business_operating",
    payerSpan: payerSpan(BUSINESS_PLACE) || payerSpan(/公司/u)
  };
  if (/^(?:你|我|本人|主角).{0,8}为(?:父母|母亲|父亲|妈妈|爸爸|孩子|子女).{0,16}(?:支付|承担|负担|缴纳|购买)/u.test(local)) return {
    liability: "protagonist",
    financialScope: "personal",
    payerSpan: spanForMatch(input.text, input.fact.clause, /^(?:你|我|本人|主角).{0,16}(?:支付|承担|负担|缴纳|购买)/u)
      || spanForMatch(input.text, input.fact.clause, /^(?:你|我|本人|主角)/u)
  };
  if (THIRD_PARTY_PAYER.test(local)) return {
    liability: "third_party",
    financialScope: "third_party",
    payerSpan: thirdPartyPayerSpan(input.text, [input.fact.clause])
  };
  const personalPaymentAction = spanForMatch(
    input.text,
    input.fact.clause,
    /(?:你(?!们)|我(?!们)|本人|主角).{0,28}(?:支付|承担|负担|缴纳|转账|付款|交(?!通)(?:了)?|购买)/u
  );
  if (personalPaymentAction) return {
    liability: "protagonist",
    financialScope: "personal",
    payerSpan: personalPaymentAction
  };
  if (/(?:为自己|自己的).{0,12}(?:购买|支付|承担|缴纳)|(?:购买|支付|承担|缴纳).{0,12}(?:自己的|本人)/u.test(local)) return {
    liability: "protagonist",
    financialScope: "personal",
    payerSpan: spanForMatch(input.text, input.fact.clause, /为自己|自己的|本人/u)
  };
  // “X 替你/为你支付” names X as payer. Do this before protagonist matching,
  // because the substring “你支付” must not reverse the actual liability.
  if (/(?:替|为)(?:你|我)(?:支付|承担|负担|缴纳|付款|代付)/u.test(context)
    && THIRD_PARTY_PAYER.test(context)) return {
    liability: "third_party",
    financialScope: "third_party",
    payerSpan: thirdPartyPayerSpan(input.text, input.contextClauses)
  };
  if (SHARED_PAYER.test(context)) {
    const share = /各(?:自)?承担|各付|一人一半|各半|平摊/u.test(context)
      ? 0.5
      : (() => {
          const match = context.match(/(?:你(?:们)?|我(?:们)?|主角).{0,12}承担\s*(\d+(?:\.\d+)?)\s*%/u);
          return match ? Number(match[1]) / 100 : undefined;
        })();
    return {
      liability: "shared",
      financialScope: "shared_household",
      shareRate: share,
      payerSpan: payerSpan(/各(?:自)?承担(?:一半)?|各付(?:一半)?|一人一半|各半|平摊/u)
        || payerSpan(SHARED_PAYER)
    };
  }
  if (PERSONAL_PAYER.test(context)) {
    return {
      liability: "protagonist",
      financialScope: "personal",
      payerSpan: payerSpan(/两笔均由(?:你|我|本人|主角)支付/u)
        || payerSpan(PERSONAL_PAYER)
        || payerSpan(/(?:你(?!们)|我(?!们)|本人|主角)/u)
    };
  }
  if (THIRD_PARTY_PAYER.test(context)) return {
    liability: "third_party",
    financialScope: "third_party",
    payerSpan: thirdPartyPayerSpan(input.text, input.contextClauses)
  };
  // A planned observation may inherit the sentence subject, but it remains a
  // review-only fact and can never become an active payment. This covers
  // “你已经支付 X，同时计划调整 Y” without borrowing X's completion.
  if (PLANNED_ACTION.test(local)
    && PERSONAL_PRONOUN.test(sentence)
    && !THIRD_PARTY_PAYER.test(local)
    && !SHARED_PAYER.test(local)
    && !BUSINESS_PLACE.test(local)) {
    const subjectSpan = input.fact.sentenceClauses
      .map((clause) => spanForMatch(input.text, clause, PERSONAL_PRONOUN))
      .find(Boolean);
    return { liability: "protagonist", financialScope: "personal", payerSpan: subjectSpan };
  }
  if (
    (PERSONAL_PRONOUN.test(context) && /房租|租金|月租|医疗|医药|治疗|复诊|用药|服药|保费|费用|开销|支付|承担|缴纳|扣/u.test(context))
    || (CASHFLOW_DEDUCTION.test(input.fact.clause.text) && PERSONAL_PRONOUN.test(sentence))) {
    return {
      liability: "protagonist",
      financialScope: "personal",
      payerSpan: payerSpan(PERSONAL_PAYER)
        || payerSpan(/(?:你(?!们)|我(?!们)|本人|主角)/u)
        || spanForMatch(input.text, input.fact.clause, CASHFLOW_DEDUCTION)
    };
  }
  return { liability: "unknown", financialScope: "personal" };
}

function likelyCareContinuation(rawFact: RawFact, clause: NarrativeClause): boolean {
  if (rawFact.responsibilityKind !== "elder_care") return false;
  return CARE_SERVICE.test(rawFact.clause.text)
    && /已上门|已经上门|开始服务|已经开始|已开始|服务费|费用|每月|每季度|每季|每年|年度/u.test(clause.text);
}

function explicitSharedAllocationContinuation(rawFact: RawFact, clause: NarrativeClause): boolean {
  if (!SHARED_PAYER.test(rawFact.clause.text)) return false;
  // Only a bounded, same-sentence continuation with an explicit protagonist
  // allocation may complete a shared total. This intentionally excludes a
  // bare amount in the next clause, which could belong to another bill.
  return clause.sentenceIndex === rawFact.clause.sentenceIndex
    && /^(?:其中|而|并且)?\s*(?:(?:你(?!们)|我(?!们)|本人|主角).{0,16})?(?:各(?:自)?承担|承担|支付|负担|缴纳).{0,20}(?:(?:\d+(?:\.\d+)?)\s*%|各半|一半|对半|平摊|\d|[一二两三四五六七八九])/u.test(clause.text);
}

function contextualClausesFor(input: {
  rawFact: RawFact;
  allClauses: NarrativeClause[];
  allRawFacts: RawFact[];
}): NarrativeClause[] {
  const startIndex = input.allClauses.findIndex((item) => item.id === input.rawFact.clause.id);
  if (startIndex < 0) return [input.rawFact.clause];
  const previous = input.allClauses[startIndex - 1];
  const previousFacts = previous
    ? input.allRawFacts.filter((fact) => fact.clause.id === previous.id)
    : [];
  const hasSameResponsibilityPayerPrelude = previous?.sentenceIndex === input.rawFact.clause.sentenceIndex
    && previousFacts.some((fact) => fact.responsibilityKind === input.rawFact.responsibilityKind)
    && previousFacts.every((fact) => fact.responsibilityKind === input.rawFact.responsibilityKind)
    && !PLANNED_ACTION.test(input.rawFact.clause.text)
    && (PERSONAL_PAYER.test(previous.text) || SHARED_PAYER.test(previous.text)
      || /(?:你(?!们)|我(?!们)|本人|主角).{0,20}(?:签下|续签|入住|搬入|租住)/u.test(previous.text));
  const hasSharedActorPrelude = input.rawFact.responsibilityKind === "elder_care"
    && previous?.sentenceIndex === input.rawFact.clause.sentenceIndex
    && /(?:你|我)(?!们)(?:与|和|跟|同)(?:伴侣|配偶|妻子|丈夫|爱人|男友|女友)|你们|我们/u.test(previous.text);
  const context = (hasSharedActorPrelude || hasSameResponsibilityPayerPrelude) && previous
    ? [previous, input.rawFact.clause]
    : [input.rawFact.clause];

  const immediateNext = input.allClauses[startIndex + 1];
  if (immediateNext && explicitSharedAllocationContinuation(input.rawFact, immediateNext)) {
    context.push(immediateNext);
  }
  if (immediateNext
    && immediateNext.sentenceIndex === input.rawFact.clause.sentenceIndex
    && context.some((clause) => SHARED_PAYER.test(clause.text))
    && /各(?:自)?承担|各付|一人一半|各半|一半|对半|平摊/u.test(immediateNext.text)
    && !context.some((item) => item.id === immediateNext.id)) {
    context.push(immediateNext);
  }
  const immediateNextFacts = immediateNext
    ? input.allRawFacts.filter((fact) => fact.clause.id === immediateNext.id)
    : [];
  const explicitAmountContinuation = immediateNext
    && immediateNext.sentenceIndex === input.rawFact.clause.sentenceIndex
    && immediateNextFacts.length === 0
    && /^(?:每月|每季度|每季|每年|年度|按年|按季).{0,24}(?:由)?(?:你|我|本人|主角)?(?:支付|承担|负担|缴纳)?\s*\d/u.test(immediateNext.text);
  if (explicitAmountContinuation && !context.some((item) => item.id === immediateNext.id)) {
    context.push(immediateNext);
  }
  const explicitCadenceContinuation = immediateNext
    && immediateNext.sentenceIndex === input.rawFact.clause.sentenceIndex
    && immediateNextFacts.length === 0
    && /^(?:按年缴纳|按年支付|每年缴纳|每年支付|年缴|年付|每季度缴纳|按季缴纳)$/u.test(immediateNext.text.trim());
  if (explicitCadenceContinuation && !context.some((item) => item.id === immediateNext.id)) {
    context.push(immediateNext);
  }
  // A service can be introduced in one sentence and become an actual expense
  // in the next. Follow only explicit care-service / fee references and stop
  // at a second responsibility, so proximity alone never borrows a wage or a
  // different household bill.
  for (let index = startIndex + 1; index < Math.min(input.allClauses.length, startIndex + 9); index += 1) {
    const clause = input.allClauses[index];
    if (context.some((item) => item.id === clause.id)) continue;
    const hasOtherFact = input.allRawFacts.some((fact) => fact.clause.id === clause.id);
    const explicitCareReference = likelyCareContinuation(input.rawFact, clause);
    const explicitFeeReference = /(?:这笔|该|其|服务)?(?:费用|服务费|照护费|开销|支出).{0,24}(?:\d|[一二两三四五六七八九])/u.test(clause.text);
    const explicitTrailingAmount = context.length > 1
      && /^(?:每月|每季度|每季|每年|年度|按年|按季).{0,24}(?:由)?(?:你|我|本人|主角)?(?:支付|承担|负担|缴纳)?\s*\d/u.test(clause.text);
    const explicitResponsibilityAmount = input.rawFact.responsibilityKind === "primary_residence"
      && /(?:这笔|该)?(?:住房|房租|租房|租住)(?:固定)?成本.{0,24}\d/u.test(clause.text);
    const bridgeWithoutCashflow = hasOtherFact
      && /固定成本/u.test(input.rawFact.clause.text)
      && !CASHFLOW_PREDICATE.test(clause.text);
    if (hasOtherFact && !explicitCareReference && !bridgeWithoutCashflow) break;
    if (explicitCareReference || explicitFeeReference || explicitTrailingAmount || explicitResponsibilityAmount) {
      context.push(clause);
      continue;
    }
    if (bridgeWithoutCashflow) {
      context.push(clause);
      continue;
    }
    // A named caregiver may have one short service-description bridge before
    // the next sentence spells out its recurring cashflow.  Do not cross a
    // different responsibility or a newly named payer merely for proximity.
    const canBridgeCareService = input.rawFact.responsibilityKind === "elder_care"
      && CARE_SERVICE.test(input.rawFact.clause.text)
      && clause.sentenceIndex <= input.rawFact.clause.sentenceIndex + 1
      && !/(?:伴侣|配偶|妻子|丈夫|父母|母亲|父亲|公司|雇主).{0,24}(?:支付|承担|负担|缴纳|转账|付款|代付)/u.test(clause.text);
    if (!canBridgeCareService) break;
    context.push(clause);
  }
  return context;
}

function amountFor(input: {
  narrativeText: string;
  rawFact: RawFact;
  sentenceFacts: RawFact[];
  contextClauses: NarrativeClause[];
  allClauses: NarrativeClause[];
}): { mention?: MoneyMention; ambiguous: boolean; ambiguousSpan?: TextSpan } {
  const factClauseMentions = moneyMentions(input.narrativeText, input.rawFact.clause).filter((item) => !item.isIncome);
  const sentenceMentions = input.rawFact.sentenceClauses.flatMap((clause) => (
    moneyMentions(input.narrativeText, clause).filter((item) => !item.isIncome)
  ));
  const sortedFacts = [...input.sentenceFacts].sort((left, right) => left.responsibilitySpan.start - right.responsibilitySpan.start);
  const factIndex = sortedFacts.findIndex((item) => item.responsibilitySpan.start === input.rawFact.responsibilitySpan.start
    && item.responsibilityKind === input.rawFact.responsibilityKind);
  const nextFactStart = factIndex >= 0 ? sortedFacts[factIndex + 1]?.responsibilitySpan.start : undefined;

  const afterCurrentSignal = factClauseMentions.filter((item) => (
    item.span.start >= input.rawFact.responsibilitySpan.end
    && (nextFactStart === undefined || item.span.start < nextFactStart)
  ));
  if (afterCurrentSignal.length === 1) return { mention: afterCurrentSignal[0], ambiguous: false };
  if (afterCurrentSignal.length > 1) return { ambiguous: true };

  // Chinese expense phrases commonly put the amount before the noun:
  // “每月6000元的国际课程”. Bind it only when this clause contains exactly
  // one responsibility, so a nearby wage or a second bill cannot be copied.
  const sameClauseFacts = input.sentenceFacts.filter((fact) => fact.clause.id === input.rawFact.clause.id);
  const beforeCurrentSignal = factClauseMentions.filter((item) => item.span.end <= input.rawFact.responsibilitySpan.start);
  if (sameClauseFacts.length === 1 && beforeCurrentSignal.length === 1) {
    return { mention: beforeCurrentSignal[0], ambiguous: false };
  }

  if (sortedFacts.length === 1 && factClauseMentions.length === 1) {
    return { mention: factClauseMentions[0], ambiguous: false };
  }

  // An explicit responsibility referent can disambiguate a later amount even
  // when another life-domain noun appears in the intervening prose.
  for (const clause of input.contextClauses.slice(1)) {
    const mentions = moneyMentions(input.narrativeText, clause).filter((item) => !item.isIncome);
    if (mentions.length !== 1) continue;
    const explicitlyNamesResponsibility = input.rawFact.responsibilityKind === "primary_residence"
      && /(?:这笔|该)?(?:住房|房租|租房|租住)(?:固定)?成本/u.test(clause.text);
    if (explicitlyNamesResponsibility) return { mention: mentions[0], ambiguous: false };
  }

  // A single amount after a group of two responsibility nouns is a household
  // aggregate of unknown allocation, never two copied personal bills.
  const mentionsAfterAllFacts = sentenceMentions.filter((item) => (
    item.span.start >= Math.max(...sortedFacts.map((fact) => fact.responsibilitySpan.end))
  ));
  if (sortedFacts.length > 1 && mentionsAfterAllFacts.length === 1) {
    return { ambiguous: true, ambiguousSpan: mentionsAfterAllFacts[0].span };
  }

  // Cross-clause money needs an explicit referent. For caregivers, a named
  // service plus “已上门 / 服务费” is sufficient; for any other fact, only an
  // explicit “费用/服务费/开销/支出”为金额 continuation is acceptable.
  for (const clause of input.contextClauses.slice(1)) {
    const mentions = moneyMentions(input.narrativeText, clause).filter((item) => !item.isIncome);
    if (mentions.length !== 1) continue;
    const explicitReference = input.rawFact.responsibilityKind === "elder_care"
      ? likelyCareContinuation(input.rawFact, clause)
      : /(?:这笔|该|其|服务)?(?:费用|服务费|照护费|开销|支出)|^(?:每月|每季度|每季|每年|年度|按年|按季).{0,24}(?:由)?(?:你|我|本人|主角)?(?:支付|承担|负担|缴纳)?/u.test(clause.text);
    if (explicitReference) return { mention: mentions[0], ambiguous: false };
  }
  return { ambiguous: false };
}

function materialityFor(input: {
  completion: ExpenseResponsibilityCompletion;
  cadence: ExpenseResponsibilityCadence;
  liability: ExpenseResponsibilityLiability;
  financialScope: ExpenseResponsibilityScope;
  amountKnown: boolean;
  shareRate?: number;
  factText: string;
}): { materiality: NarrativeExpenseBindingMateriality; unresolved: NarrativeExpenseBindingUnresolvedField[]; reasonCodes: string[] } {
  const unresolved: NarrativeExpenseBindingUnresolvedField[] = [];
  const reasonCodes: string[] = [];
  const recurring = input.cadence !== "one_off";
  const completed = input.completion === "completed" || input.completion === "ongoing";
  const hasCashflow = CASHFLOW_PREDICATE.test(input.factText);
  if (!input.amountKnown) {
    unresolved.push("amount");
    reasonCodes.push("EXPENSE_AMOUNT_UNRESOLVED");
  }
  if (input.liability === "unknown") {
    unresolved.push("payer", "scope");
    const critical = completed && recurring && hasCashflow && input.amountKnown && input.financialScope === "personal";
    if (critical) {
      reasonCodes.push("EXPENSE_COMPLETED_RECURRING_PAYER_UNRESOLVED");
      return { materiality: "critical", unresolved: unique(unresolved), reasonCodes };
    }
    reasonCodes.push("EXPENSE_OWNER_REVIEW_REQUIRED");
    return { materiality: "review", unresolved: unique(unresolved), reasonCodes };
  }
  if (input.liability === "shared" && input.shareRate === undefined) {
    unresolved.push("share");
    if (completed && recurring && input.amountKnown) {
      reasonCodes.push("EXPENSE_SHARED_PROTAGONIST_SHARE_UNRESOLVED");
      return { materiality: "critical", unresolved: unique(unresolved), reasonCodes };
    }
    return { materiality: "review", unresolved: unique(unresolved), reasonCodes };
  }
  if (!completed || input.cadence === "one_off") {
    reasonCodes.push("EXPENSE_NON_RECURRING_OR_NOT_COMPLETED");
    return { materiality: "nonmaterial", unresolved: unique(unresolved), reasonCodes };
  }
  if (input.liability === "third_party" || input.liability === "none") {
    reasonCodes.push("EXPENSE_NON_PERSONAL_SCOPE");
    return { materiality: "nonmaterial", unresolved: unique(unresolved), reasonCodes };
  }
  if (!input.amountKnown) return { materiality: "review", unresolved: unique(unresolved), reasonCodes };
  reasonCodes.push("EXPENSE_FACT_BOUND");
  return { materiality: "nonmaterial", unresolved: unique(unresolved), reasonCodes };
}

function bindingDisposition(binding: NarrativeExpenseFactBinding): NarrativeExpenseBindingDisposition {
  if (binding.sourceMateriality === "critical") return "ambiguous";
  if (binding.liability === "unknown") return "owner_review";
  if (binding.completion === "planned" || binding.completion === "hypothetical" || binding.sourceMateriality === "nonmaterial" && binding.liability !== "protagonist" && binding.liability !== "shared") {
    return "ignored";
  }
  return "bound";
}

function bindingId(input: {
  sourceNodeId?: string;
  sourceOutcomeId?: string;
  responsibilityKey: string;
  spans: Array<TextSpan | undefined>;
  amount?: number;
  shareRate?: number;
  cadence: ExpenseResponsibilityCadence;
}): string {
  const identity = input.sourceNodeId || input.sourceOutcomeId || "missing";
  const spans = input.spans.map((span) => span ? `${span.start}:${span.end}` : "-").join("|");
  return `expense_binding_${fnv1a(`${identity}|${input.responsibilityKey}|${spans}|${input.amount ?? "-"}|${input.shareRate ?? "-"}|${input.cadence}`)}`;
}

/**
 * Pure Phase-1 binder. It never writes an event, never consults the ledger
 * for authority, and has no side effects. Existing commitments are accepted
 * in the input solely so the future adapter can keep its public shape stable.
 */
export function bindNarrativeExpenseFacts(input: {
  sourceNodeId?: string;
  sourceOutcomeId?: string;
  narrativeText: string;
  candidateWorldState?: WorldStateSnapshot;
  existingExpenseCommitments?: ExpenseCommitmentV4[];
}): NarrativeExpenseFactBindingResult {
  void input.existingExpenseCommitments;
  const clauses = segmentNarrativeExpenseClauses(input.narrativeText);
  const rawFacts = clauses.flatMap((clause) => rawFactsForClause({
    narrativeText: input.narrativeText,
    clause,
    clauses,
    candidateWorldState: input.candidateWorldState
  }));
  const bindings: NarrativeExpenseFactBinding[] = [];
  const diagnostics: NarrativeExpenseFactBindingDiagnostic[] = [];
  const sourceIdentityStatus = input.sourceNodeId || input.sourceOutcomeId ? "bound" : "missing";

  for (const rawFact of rawFacts) {
    const contextClauses = contextualClausesFor({ rawFact, allClauses: clauses, allRawFacts: rawFacts });
    const completion = completionFor({ text: input.narrativeText, fact: rawFact, contextClauses });
    const payer = payerFor({ text: input.narrativeText, fact: rawFact, contextClauses });
    const sentenceFacts = rawFacts.filter((item) => item.clause.sentenceIndex === rawFact.clause.sentenceIndex);
    const amount = amountFor({
      narrativeText: input.narrativeText,
      rawFact,
      sentenceFacts,
      contextClauses,
      allClauses: clauses
    });
    const factContextText = contextClauses.map((clause) => clause.text).join("；");
    const contextualCadence: ExpenseResponsibilityCadence = /每月|每个月|月均|月租|月付/u.test(factContextText)
      ? "monthly"
      : /每季度|每季|按季|季度(?:缴|付|支付|缴纳|费用)/u.test(factContextText)
        ? "quarterly"
        : /每年|年度|按年|年缴|年付/u.test(factContextText)
          ? "annual"
          : rawFact.responsibilityKind === "primary_residence" && amount.mention && /房租|租金/u.test(rawFact.sentenceText)
            ? "monthly"
            : "recurring_unknown";
    const cadence = amount.mention && amount.mention.cadence !== "recurring_unknown"
      ? amount.mention.cadence
      : contextualCadence;
    const explicitCadencePattern = cadence === "monthly"
      ? /每月|每个月|月均|月付/u
      : cadence === "quarterly"
        ? /每季度|每季|按季/u
        : cadence === "annual"
          ? /按年缴纳|按年支付|每年缴纳|每年支付|年缴|年付|按年/u
          : cadence === "one_off"
            ? /一次|一笔|单次/u
            : /$^/u;
    const explicitCadenceSpan = contextClauses
      .map((clause) => spanForMatch(input.narrativeText, clause, explicitCadencePattern))
      .find(Boolean);
    const housingCadenceSpan = rawFact.responsibilityKind === "primary_residence"
      ? spanForMatch(input.narrativeText, rawFact.clause, /月租|房租|租金/u)
      : undefined;
    const contextualCadenceSpan = explicitCadenceSpan || housingCadenceSpan || contextClauses
      .map((clause) => spanForMatch(
        input.narrativeText,
        clause,
        cadence === "monthly"
          ? /每月|每个月|月均|月租|月付/u
          : cadence === "quarterly"
            ? /每季度|每季|按季|季度(?:缴|付|支付|缴纳|费用)/u
            : cadence === "annual"
              ? /每年|年度|按年|年缴|年付/u
              : cadence === "one_off"
                ? /一次|一笔|单次/u
                : /$^/u
      ))
      .find(Boolean)
      || (cadence === "monthly" && rawFact.responsibilityKind === "primary_residence"
        ? rawFact.responsibilitySpan
        : undefined);
    const cadenceSpan = explicitCadenceSpan || amount.mention?.cadenceSpan || contextualCadenceSpan;
    const material = materialityFor({
      completion: completion.completion,
      cadence,
      liability: payer.liability,
      financialScope: payer.financialScope,
      amountKnown: Boolean(amount.mention),
      shareRate: payer.shareRate,
      factText: contextClauses.map((item) => item.text).join("；")
    });
    const reasonCodes = [...material.reasonCodes];
    // `ongoing` is the legacy fallback when a responsibility phrase has no
    // explicit completion marker. Preserve that compatibility for routing,
    // but make the missing source authority visible to the gate and audit.
    if (!completion.span) {
      material.unresolved.push("completion");
      reasonCodes.push("EXPENSE_COMPLETION_UNRESOLVED");
    }
    if (amount.ambiguous) {
      reasonCodes.push("EXPENSE_FACT_BINDING_AMBIGUOUS", "EXPENSE_AMOUNT_BOUND_TO_CONFLICTING_FACT");
      if (!material.unresolved.includes("amount")) material.unresolved.push("amount");
    }
    if (sourceIdentityStatus === "missing") reasonCodes.push("SOURCE_IDENTITY_MISSING");
    const explicitMonthlyTotalWan = amount.mention?.monthlyWan;
    const protagonistShareWan = explicitMonthlyTotalWan === undefined
      ? undefined
      : payer.liability === "protagonist"
        ? explicitMonthlyTotalWan
        : payer.liability === "shared" && payer.shareRate !== undefined
          ? roundWan(explicitMonthlyTotalWan * payer.shareRate)
          : undefined;
    const id = bindingId({
      sourceNodeId: input.sourceNodeId,
      sourceOutcomeId: input.sourceOutcomeId,
      responsibilityKey: rawFact.responsibilityKey,
      spans: [rawFact.responsibilitySpan, completion.span, payer.payerSpan, amount.mention?.span || amount.ambiguousSpan, cadenceSpan],
      amount: explicitMonthlyTotalWan,
      shareRate: payer.shareRate,
      cadence
    });
    const evidenceFingerprint = `expense_evidence_${fnv1a([
      input.sourceNodeId || "",
      input.sourceOutcomeId || "",
      rawFact.responsibilityKey,
      rawFact.responsibilitySpan.start,
      rawFact.responsibilitySpan.end,
      completion.span?.start || "",
      payer.payerSpan?.start || "",
      amount.mention?.span.start || amount.ambiguousSpan?.start || "",
      amount.mention?.span.end || amount.ambiguousSpan?.end || "",
      explicitMonthlyTotalWan || "",
      payer.shareRate || "",
      cadence
    ].join("|"))}`;
    const binding: NarrativeExpenseFactBinding = {
      id,
      clauseId: rawFact.clause.id,
      sentenceIndex: rawFact.clause.sentenceIndex,
      clauseIndex: rawFact.clause.clauseIndex,
      contextClauseIds: contextClauses.map((clause) => clause.id),
      sourceNodeId: input.sourceNodeId,
      sourceOutcomeId: input.sourceOutcomeId,
      sourceIdentityStatus,
      evidenceFingerprint,
      responsibilityKey: rawFact.responsibilityKey,
      responsibilityKind: rawFact.responsibilityKind,
      proposedType: rawFact.proposedType,
      action: completion.span && (completion.completion === "completed" || completion.completion === "ongoing")
        ? payer.liability === "protagonist" || payer.liability === "shared" ? "start" : "review"
        : "review",
      completion: completion.completion,
      cadence,
      liability: payer.liability,
      financialScope: payer.financialScope,
      shareRate: payer.shareRate,
      explicitMonthlyTotalWan,
      protagonistShareWan,
      amountSourceId: sourceIdentityStatus === "bound" && amount.mention
        ? `expense_amount_${fnv1a(`${evidenceFingerprint}|${amount.mention.span.start}:${amount.mention.span.end}|${explicitMonthlyTotalWan}`)}`
        : undefined,
      participantPersonIds: rawFact.participantPersonIds,
      responsibilitySpan: rawFact.responsibilitySpan,
      completionSpan: completion.span,
      payerSpan: payer.payerSpan,
      amountSpan: amount.mention?.span || amount.ambiguousSpan,
      cadenceSpan,
      sourceMateriality: amount.ambiguous && completion.completion !== "planned" && completion.completion !== "hypothetical"
        ? "review"
        : material.materiality,
      unresolvedFields: unique(material.unresolved),
      reasonCodes: unique(reasonCodes)
    };
    bindings.push(binding);
    diagnostics.push({
      clauseId: binding.clauseId,
      bindingId: binding.id,
      disposition: bindingDisposition(binding),
      reasonCodes: binding.reasonCodes
    });
  }
  // The same obligation can be named twice in adjacent clauses ("共同租住公寓，
  // 月租 5200 元"). Keep the richer active binding instead of manufacturing
  // two commitments. Planned alternatives remain separate observations.
  const bindingScore = (binding: NarrativeExpenseFactBinding): number => (
    (binding.explicitMonthlyTotalWan !== undefined ? 8 : 0)
    + (binding.protagonistShareWan !== undefined ? 4 : 0)
    + (binding.payerSpan ? 2 : 0)
    + (binding.cadence !== "recurring_unknown" ? 1 : 0)
  );
  const completionClass = (binding: NarrativeExpenseFactBinding): "active" | "inactive" => (
    binding.completion === "completed" || binding.completion === "ongoing" ? "active" : "inactive"
  );
  const dedupedBindings = bindings.filter((binding, index) => !bindings.some((other, otherIndex) => (
    otherIndex !== index
    && other.responsibilityKey === binding.responsibilityKey
    && (other.liability === binding.liability || other.liability === "unknown" || binding.liability === "unknown")
    && completionClass(other) === completionClass(binding)
    && clauses.find((clause) => clause.id === other.clauseId)?.sentenceIndex
      === clauses.find((clause) => clause.id === binding.clauseId)?.sentenceIndex
    && (bindingScore(other) > bindingScore(binding)
      || bindingScore(other) === bindingScore(binding) && otherIndex < index)
  )));
  const retainedIds = new Set(dedupedBindings.map((binding) => binding.id));
  return {
    clauses,
    bindings: dedupedBindings,
    diagnostics: diagnostics.filter((diagnostic) => !diagnostic.bindingId || retainedIds.has(diagnostic.bindingId))
  };
}

/**
 * The adapter is a compatibility bridge only. Phase 1 callers may feed its
 * candidate to existing detector telemetry, but it does not make a ledger
 * write and it cannot turn a narrative-only amount into a known fact.
 */
export function candidateFromNarrativeBinding(binding: NarrativeExpenseFactBinding): NarrativeBindingCandidate {
  const canonicalizedOngoing = binding.completion === "ongoing";
  const completion: ExpenseResponsibilityCompletion = canonicalizedOngoing ? "completed" : binding.completion;
  const reasonCodes = canonicalizedOngoing
    ? unique([...binding.reasonCodes, "EXPENSE_ONGOING_CANONICALIZED_TO_COMPLETED"])
    : binding.reasonCodes;
  const scope = binding.financialScope;
  const disposition = bindingDisposition(binding);
  const evidence: FinancialEvidence = {
    source: "accepted_simulation_outcome",
    sourceNodeId: binding.sourceNodeId,
    sourceEventId: binding.sourceOutcomeId,
    excerpt: binding.contextClauseIds.length > 1
      ? `${binding.responsibilitySpan.excerpt} / ${binding.amountSpan?.excerpt || ""}`.trim()
      : binding.responsibilitySpan.excerpt,
    reasonCode: reasonCodes[0] || "EXPENSE_FACT_BOUND",
    confidence: 1,
    financialScope: scope
  };
  return {
    id: `expense_candidate_from_${binding.id}`,
    responsibilityKey: binding.responsibilityKey,
    responsibilityKind: binding.responsibilityKind,
    proposedType: binding.proposedType,
    action: completion === "completed" && binding.liability !== "unknown" ? "start" : "review",
    completion,
    cadence: binding.cadence,
    liability: binding.liability,
    financialScope: scope,
    explicitMonthlyTotalWan: binding.explicitMonthlyTotalWan,
    protagonistShareWan: binding.protagonistShareWan,
    shareRate: binding.shareRate,
    amountSourceId: binding.amountSourceId,
    participantPersonIds: binding.participantPersonIds,
    source: "narrative_supplement",
    evidence: [evidence],
    sourceFactBindingId: binding.id,
    sourceSpans: {
      responsibility: binding.responsibilitySpan,
      completion: binding.completionSpan,
      payer: binding.payerSpan,
      amount: binding.amountSpan,
      cadence: binding.cadenceSpan
    },
    sourceClause: {
      clauseId: binding.clauseId,
      contextClauseIds: binding.contextClauseIds,
      sentenceIndex: binding.sentenceIndex,
      clauseIndex: binding.clauseIndex
    },
    sourceBindingDisposition: disposition === "ignored" ? "owner_review" : disposition,
    sourceMateriality: binding.sourceMateriality,
    unresolvedFields: binding.unresolvedFields,
    sourceBindingReasonCodes: reasonCodes
  };
}
