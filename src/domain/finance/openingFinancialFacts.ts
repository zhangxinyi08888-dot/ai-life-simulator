import type { FinancialState, QuestionTurn, UserInitialData } from "../../types";
import { roundWan } from "./ledgerMath";

/**
 * Opening expenses are deliberately kept separate from the compatibility
 * FinancialState aggregate.  The aggregate is model-owned legacy transport;
 * these facts are deterministic extractions from user supplied text and are
 * the only opening-expense input allowed to reach the ledger.
 */
export type OpeningExpenseFactType =
  | "basic_living"
  | "housing"
  | "dependent_support"
  | "healthcare"
  | "insurance"
  | "education"
  | "aggregate";

export type OpeningExpenseCadence = "monthly" | "annual" | "one_off" | "recurring_unknown";
export type OpeningExpenseCoverage = "fully_covers" | "disjoint" | "unknown";

export interface OpeningExpenseFact {
  /** Stable within the opening evidence and suitable for amount-source de-duplication. */
  id: string;
  type: OpeningExpenseFactType;
  responsibilityKey: string;
  responsibilityKind:
    | "adult_basic_living"
    | "primary_residence"
    | "child_support"
    | "elder_care"
    | "recurring_healthcare"
    | "personal_insurance"
    | "continuing_education"
    | "legacy_aggregate";
  cadence: OpeningExpenseCadence;
  /** The protagonist's monthly share when an amount is explicit. */
  monthlyAmountWan?: number;
  /** Contract/household total. It is never itself accrued for a shared fact. */
  grossMonthlyAmountWan?: number;
  protagonistShareRate?: number;
  financialScope: "personal" | "shared_household";
  factStatus: "known" | "needs_review";
  amountBasis: "explicit_known" | "explicit_shared_amount" | "contextual_estimate" | "legacy_estimate";
  amountSourceId: string;
  evidenceText: string;
  coverage?: OpeningExpenseCoverage;
}

export interface OpeningFinancialFacts {
  evidenceText: string;
  cashWan?: number;
  investmentAssetsWan?: number;
  propertyMarketValueWan?: number;
  ownsProperty: boolean;
  mortgagePrincipalWan?: number;
  mortgageMonthlyPaymentWan?: number;
  annualAfterTaxIncomeWan?: number;
  /**
   * Compatibility-only view of a user supplied basic/aggregate amount.
   * It is never allowed to write FinancialState.annualCoreExpenseWan.
   */
  monthlyBasicLivingExpenseWan?: number;
  /** New callers receive this populated; optional for persisted v3 test/input compatibility. */
  expenseFacts?: OpeningExpenseFact[];
}

function amountWan(value: string, unit: string): number | undefined {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return roundWan(unit.startsWith("万") ? amount : amount / 10_000);
}

function matchAmount(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = amountWan(match[1], match[2]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function expenseSentences(text: string): string[] {
  return text
    .split(/[。！？；\n]/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isBusinessExpenseContext(sentence: string): boolean {
  return /工坊|工作室|办公室|办公场地|仓库|厂房|门店|公司租金|团队|员工|服务器|原材料|推广/u.test(sentence);
}

/**
 * Opening evidence is written from the protagonist's perspective, but a
 * family member's promise to pay is still not the protagonist's recurring
 * cash-flow responsibility.  Keep this deliberately tied to an explicit
 * third-party payer plus an expense verb: merely mentioning a parent medical
 * need must remain eligible for a reviewable responsibility.
 */
function isExplicitThirdPartyExpensePayer(sentence: string): boolean {
  // Check a concrete third-party promise before the deliberately broad
  // first-person payer fallback below. Otherwise an earlier "我自学过…" can
  // stretch across the sentence and falsely claim the later "家里愿意承担
  // 学费" clause as the protagonist's own payment.
  const explicitThirdPartyPromise = /(?:家里|家人|父母|爸妈|母亲|父亲|伴侣|配偶|公司|雇主|朋友)[^。！？；]{0,20}(?:明确表示|承诺|愿意|会|将|负责)?[^。！？；]{0,16}(?:承担|支付|负担|缴纳|资助|代付)/u.test(sentence);
  const explicitSharedPayer = /(?:我|你|本人|主角).{0,16}(?:与|和|跟).{0,16}(?:家里|家人|父母|爸妈|母亲|父亲|伴侣|配偶).{0,20}(?:共同|一起|各自|平摊).{0,16}(?:承担|支付|负担|缴纳)/u.test(sentence);
  if (explicitThirdPartyPromise && !explicitSharedPayer) return true;
  const hasProtagonistPayer = /(?:我|你|本人|主角).{0,24}(?:承担|支付|负担|缴纳|代付|转账|付款)/u.test(sentence);
  if (hasProtagonistPayer) return false;
  return explicitThirdPartyPromise;
}

function inferCadence(raw: string, fallback: "monthly" | "annual" = "monthly"): "monthly" | "annual" {
  if (/每年|每年度|年度|年缴|年交|\/\s*年|年保费|年学费/u.test(raw)) return "annual";
  if (/每月|每个月|月均|月租|月供|\/\s*月/u.test(raw)) return "monthly";
  return fallback;
}

function findShareRate(sentence: string): number | undefined {
  if (/各(?:自)?(?:承担|支付|负担)?一半|各付一半|平摊|均摊|双方各半|两人各半/u.test(sentence)) return 0.5;
  const percent = sentence.match(/(?:我|本人|主角|你)(?:们)?[^。！？；]{0,12}(?:承担|支付|负担)[^\d]{0,6}(\d{1,3})\s*%/u);
  if (percent) {
    const value = Number(percent[1]);
    if (Number.isFinite(value) && value > 0 && value <= 100) return value / 100;
  }
  if (/(?:我|本人|主角|你)(?:们)?[^。！？；]{0,12}(?:承担|支付|负担)[^。！？；]{0,8}一半/u.test(sentence)) return 0.5;
  return undefined;
}

function monthlyAmount(value: number, cadence: "monthly" | "annual"): number {
  return roundWan(cadence === "annual" ? value / 12 : value);
}

interface ExpenseRule {
  type: Exclude<OpeningExpenseFactType, "aggregate" | "basic_living">;
  responsibilityKey: (sentence: string) => string;
  responsibilityKind: OpeningExpenseFact["responsibilityKind"];
  keywords: string;
  displayName: string;
}

const COMPONENT_RULES: ExpenseRule[] = [
  {
    type: "housing",
    responsibilityKey: () => "primary_residence:main",
    responsibilityKind: "primary_residence",
    keywords: "房租|月租|租金|物业(?:费)?|住房维护|住房维修|居住服务费",
    displayName: "住房"
  },
  {
    type: "dependent_support",
    responsibilityKey: (sentence) => /孩子|子女|育儿/u.test(sentence) ? "child_support:opening_child" : "elder_care:opening_parent",
    responsibilityKind: "elder_care",
    keywords: "(?:给|向)(?:父母|爸妈|母亲|父亲)(?:转账|转|汇|支付)?|(?:父母|爸妈|母亲|父亲)(?:生活费|赡养费|照护费|护理费)|(?:孩子|子女|育儿)(?:生活费|抚养费|照护费|护理费)",
    displayName: "抚养与照护"
  },
  {
    type: "healthcare",
    responsibilityKey: (sentence) => /父母|爸妈|母亲|父亲/u.test(sentence) ? "recurring_healthcare:opening_parent" : /孩子|子女/u.test(sentence) ? "recurring_healthcare:opening_child" : "recurring_healthcare:protagonist",
    responsibilityKind: "recurring_healthcare",
    keywords: "父母医疗|母亲医疗|父亲医疗|医疗费|医疗支出|医药费|药费|治疗费|复诊费|长期用药|持续用药|康复费|护理医疗",
    displayName: "持续医疗"
  },
  {
    type: "insurance",
    responsibilityKey: () => "personal_insurance:opening",
    responsibilityKind: "personal_insurance",
    keywords: "保险费|保费|医疗险|重疾险|商业保险|养老保险",
    displayName: "保险"
  },
  {
    type: "education",
    responsibilityKey: (sentence) => /孩子|子女/u.test(sentence) ? "continuing_education:opening_child" : "continuing_education:opening",
    responsibilityKind: "continuing_education",
    keywords: "学费|教育费|课程费|培训费|进修费",
    displayName: "教育"
  }
];

function componentFactFromMatch(input: {
  rule: ExpenseRule;
  sentence: string;
  raw: string;
  value: string;
  unit: string;
  index: number;
}): OpeningExpenseFact | undefined {
  if (input.rule.type === "housing" && /房贷|按揭|月供/u.test(input.sentence)) return undefined;
  if (isBusinessExpenseContext(input.sentence) || isExplicitThirdPartyExpensePayer(input.sentence)) return undefined;
  const amount = amountWan(input.value, input.unit);
  if (amount === undefined) return undefined;
  const cadence = inferCadence(input.raw);
  const grossMonthlyAmountWan = monthlyAmount(amount, cadence);
  const shareRate = findShareRate(input.sentence);
  const shared = shareRate !== undefined;
  const responsibilityKey = input.rule.responsibilityKey(input.sentence);
  return {
    id: `opening_expense_${input.rule.type}_${input.index}`,
    type: input.rule.type,
    responsibilityKey,
    responsibilityKind: input.rule.type === "dependent_support" && responsibilityKey.startsWith("child_support:")
      ? "child_support"
      : input.rule.responsibilityKind,
    cadence,
    monthlyAmountWan: roundWan(grossMonthlyAmountWan * (shareRate ?? 1)),
    ...(shared ? { grossMonthlyAmountWan, protagonistShareRate: shareRate } : {}),
    financialScope: shared ? "shared_household" : "personal",
    factStatus: "known",
    amountBasis: shared ? "explicit_shared_amount" : "explicit_known",
    amountSourceId: `opening_user_${input.rule.type}_${input.index}`,
    evidenceText: input.sentence
  };
}

function explicitComponentFacts(evidenceText: string): OpeningExpenseFact[] {
  const result: OpeningExpenseFact[] = [];
  // Opening facts are assembled from several questionnaire fields.  The same
  // user sentence may legitimately appear in more than one field, and the
  // directional patterns below can overlap around the same currency token.
  // De-duplicate by the actual money-token position in the normalized
  // sentence, rather than by regex match start: otherwise a nearby savings
  // amount or a repeated answer can be accrued as a second care commitment.
  const seenFacts = new Set<string>();
  let sequence = 0;
  for (const sentence of expenseSentences(evidenceText)) {
    for (const rule of COMPONENT_RULES) {
      const money = "(\\d+(?:\\.\\d+)?)\\s*(万元|万|元)";
      const patterns = [
        new RegExp(`(?:${rule.keywords})[^\\d。！？；]{0,14}${money}`, "gu"),
        // The reverse form is intentionally tight.  A broad "money then
        // keyword within 14 characters" rule misread "存款 5 万元，每月给
        // 父母 2000 元" as a 5 万/月赡养费.  Accept only grammatical money
        // labels such as "5000 元房租" or "5000 元的房租".
        new RegExp(`${money}(?:\\s*(?:/\\s*(?:月|年)))?\\s*(?:的|作为|用于)?\\s*(?:${rule.keywords})`, "gu")
      ];
      for (const pattern of patterns) {
        for (const match of sentence.matchAll(pattern)) {
          const raw = match[0];
          const values = raw.match(/(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
          if (!values) continue;
          const currencyOffset = (match.index ?? 0) + raw.lastIndexOf(values[0]);
          const key = [
            rule.type,
            rule.responsibilityKey(sentence),
            sentence.normalize("NFKC"),
            currencyOffset,
            values[1],
            values[2]
          ].join(":");
          if (seenFacts.has(key)) continue;
          seenFacts.add(key);
          const fact = componentFactFromMatch({
            rule, sentence, raw, value: values[1], unit: values[2], index: sequence++
          });
          if (fact) result.push(fact);
        }
      }
    }
  }
  return result;
}

function parentBreakdownFacts(evidenceText: string, existing: OpeningExpenseFact[]): OpeningExpenseFact[] {
  const result: OpeningExpenseFact[] = [];
  let sequence = existing.length;
  for (const sentence of expenseSentences(evidenceText)) {
    if (!/(?:给|向)(?:父母|爸妈|母亲|父亲).{0,48}(?:其中|包含)/u.test(sentence)) continue;
    const total = sentence.match(/(?:给|向)(?:父母|爸妈|母亲|父亲)(?:转账|转|汇|支付)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
    const medical = sentence.match(/(?:医疗|医药|治疗)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
    const living = sentence.match(/(?:生活费|赡养费|日常)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
    if (!total || !medical || !living) continue;
    const totalWan = amountWan(total[1], total[2]);
    const medicalWan = amountWan(medical[1], medical[2]);
    const livingWan = amountWan(living[1], living[2]);
    if (totalWan === undefined || medicalWan === undefined || livingWan === undefined) continue;
    if (roundWan(medicalWan + livingWan) > totalWan) continue;
    // The aggregate "给父母转 X" is only a container for the explicitly
    // allocated components.  Remove it so X is not accrued a second time.
    for (let index = existing.length - 1; index >= 0; index--) {
      const fact = existing[index];
      if (fact.type === "dependent_support" && fact.evidenceText === sentence && fact.monthlyAmountWan === totalWan) {
        existing.splice(index, 1);
      }
    }
    const hasHealthcare = existing.some((fact) => fact.type === "healthcare" && fact.evidenceText === sentence && fact.monthlyAmountWan === medicalWan);
    if (!hasHealthcare) {
      result.push({
        id: `opening_expense_healthcare_${sequence++}`,
        type: "healthcare",
        responsibilityKey: "recurring_healthcare:opening_parent",
        responsibilityKind: "recurring_healthcare",
        cadence: "monthly",
        monthlyAmountWan: medicalWan,
        financialScope: "personal",
        factStatus: "known",
        amountBasis: "explicit_known",
        amountSourceId: `opening_user_parent_medical_${sequence}`,
        evidenceText: sentence
      });
    }
    result.push({
      id: `opening_expense_dependent_support_${sequence++}`,
      type: "dependent_support",
      responsibilityKey: "elder_care:opening_parent",
      responsibilityKind: "elder_care",
      cadence: "monthly",
      monthlyAmountWan: livingWan,
      financialScope: "personal",
      factStatus: "known",
      amountBasis: "explicit_known",
      amountSourceId: `opening_user_parent_support_${sequence}`,
      evidenceText: sentence
    });
  }
  return result;
}

function missingResponsibilityFacts(evidenceText: string, existing: OpeningExpenseFact[]): OpeningExpenseFact[] {
  const result: OpeningExpenseFact[] = [];
  const hasType = (type: OpeningExpenseFactType) => existing.some((fact) => fact.type === type);
  const evidenceFor = (pattern: RegExp): string | undefined => expenseSentences(evidenceText)
    .find((sentence) => pattern.test(sentence)
      && !isBusinessExpenseContext(sentence)
      && !isExplicitThirdPartyExpensePayer(sentence));
  const add = (input: Omit<OpeningExpenseFact, "id" | "amountSourceId">) => {
    const index = existing.length + result.length;
    result.push({ ...input, id: `opening_expense_${input.type}_review_${index}`, amountSourceId: `opening_user_${input.type}_review_${index}` });
  };

  if (!hasType("housing")) {
    const sentence = evidenceFor(/房租|租金|物业(?:费)?|住房维护|住房维修/u);
    if (sentence && !/房贷|按揭|月供/u.test(sentence)) add({
      type: "housing", responsibilityKey: "primary_residence:main", responsibilityKind: "primary_residence",
      cadence: "recurring_unknown", financialScope: "personal", factStatus: "needs_review",
      amountBasis: "contextual_estimate", evidenceText: sentence
    });
  }
  if (!hasType("dependent_support")) {
    const sentence = evidenceFor(/(?:给|向)(?:父母|爸妈|母亲|父亲)|赡养|照护|护理|育儿|抚养/u);
    if (sentence) add({
      type: "dependent_support", responsibilityKey: /孩子|子女|育儿|抚养/u.test(sentence) ? "child_support:opening_child" : "elder_care:opening_parent",
      responsibilityKind: /孩子|子女|育儿|抚养/u.test(sentence) ? "child_support" : "elder_care",
      cadence: "recurring_unknown", financialScope: "personal", factStatus: "needs_review",
      amountBasis: "contextual_estimate", evidenceText: sentence
    });
  }
  if (!hasType("healthcare")) {
    const sentence = evidenceFor(/长期用药|持续用药|长期治疗|定期复诊|医疗费|医疗支出|医药费|治疗费/u);
    if (sentence) add({
      type: "healthcare", responsibilityKey: /父母|爸妈|母亲|父亲/u.test(sentence) ? "recurring_healthcare:opening_parent" : "recurring_healthcare:protagonist",
      responsibilityKind: "recurring_healthcare", cadence: "recurring_unknown", financialScope: "personal",
      factStatus: "needs_review", amountBasis: "contextual_estimate", evidenceText: sentence
    });
  }
  if (!hasType("insurance")) {
    const sentence = evidenceFor(/保险费|保费|医疗险|重疾险|商业保险|养老保险/u);
    if (sentence) add({
      type: "insurance", responsibilityKey: "personal_insurance:opening", responsibilityKind: "personal_insurance",
      cadence: "recurring_unknown", financialScope: "personal", factStatus: "needs_review",
      amountBasis: "contextual_estimate", evidenceText: sentence
    });
  }
  if (!hasType("education")) {
    const sentence = evidenceFor(/学费|教育费|课程费|培训费|进修费/u);
    if (sentence) add({
      type: "education", responsibilityKey: /孩子|子女/u.test(sentence) ? "continuing_education:opening_child" : "continuing_education:opening",
      responsibilityKind: "continuing_education", cadence: "recurring_unknown", financialScope: "personal",
      factStatus: "needs_review", amountBasis: "contextual_estimate", evidenceText: sentence
    });
  }
  return result;
}

function aggregateExpenseFacts(evidenceText: string, componentFacts: OpeningExpenseFact[]): OpeningExpenseFact[] {
  const result: OpeningExpenseFact[] = [];
  let sequence = componentFacts.length;
  for (const sentence of expenseSentences(evidenceText)) {
    const matches = [
      ...sentence.matchAll(/(?:每月|每个月|月均|每年|每年度|年度)?[^。！？；\d]{0,12}(?:总(?:生活)?支出|总开销|全部(?:生活)?开销|生活总支出|生活费|生活支出|日常开销|基本生活费)[^\d。！？；]{0,14}(\d+(?:\.\d+)?)\s*(万元|万|元)/gu),
      ...sentence.matchAll(/(\d+(?:\.\d+)?)\s*(万元|万|元)(?:\s*(?:\/\s*(?:月|年)))?[^。！？；\d]{0,14}(?:总(?:生活)?支出|总开销|全部(?:生活)?开销|生活总支出|生活费|生活支出|日常开销|基本生活费)/gu)
    ];
    for (const match of matches) {
      const values = match[0].match(/(\d+(?:\.\d+)?)\s*(万元|万|元)/u);
      if (!values) continue;
      const amount = amountWan(values[1], values[2]);
      if (amount === undefined) continue;
      const cadence = inferCadence(match[0]);
      const monthlyAmountWan = monthlyAmount(amount, cadence);
      const basicOnly = /基本生活费/u.test(match[0]);
      const hasComponentsInSentence = componentFacts.some((fact) => fact.evidenceText === sentence);
      const clearlyAll = /总(?:共|计|额)?|全部|一共|合计/u.test(match[0]);
      const coverage: OpeningExpenseCoverage = basicOnly
        ? "disjoint"
        : hasComponentsInSentence
          ? "unknown"
          : clearlyAll
            ? "fully_covers"
            : "unknown";
      result.push({
        id: `opening_expense_${basicOnly ? "basic_living" : "aggregate"}_${sequence++}`,
        type: basicOnly ? "basic_living" : "aggregate",
        responsibilityKey: basicOnly ? "adult_basic_living:protagonist" : "legacy_aggregate:opening",
        responsibilityKind: basicOnly ? "adult_basic_living" : "legacy_aggregate",
        cadence,
        monthlyAmountWan,
        financialScope: "personal",
        factStatus: coverage === "unknown" && !basicOnly ? "needs_review" : "known",
        amountBasis: basicOnly ? "explicit_known" : "legacy_estimate",
        amountSourceId: `opening_user_${basicOnly ? "basic_living" : "aggregate"}_${sequence}`,
        evidenceText: sentence,
        ...(basicOnly ? {} : { coverage })
      });
    }
  }
  return result;
}

/**
 * Extract typed recurring-expense facts only from original user/answer text.
 * Narrative/model state is intentionally not an input to this function.
 */
export function extractOpeningExpenseFacts(evidenceText: string): OpeningExpenseFact[] {
  const components = explicitComponentFacts(evidenceText);
  components.push(...parentBreakdownFacts(evidenceText, components));
  const aggregates = aggregateExpenseFacts(evidenceText, components);
  components.push(...missingResponsibilityFacts(evidenceText, [...components, ...aggregates]));
  return [...components, ...aggregates]
    .filter((fact) => fact.cadence !== "one_off")
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function openingFinancialEvidenceText(userData: UserInitialData, answers: QuestionTurn[]): string {
  return [
    userData.currentSituation,
    userData.regressionSituation,
    userData.milestoneCareer,
    userData.milestoneOther,
    ...(userData.milestones || []).map((item) => item.content),
    ...answers.map((item) => item.answer || "")
  ].filter(Boolean).join("\n");
}

export function extractOpeningFinancialFacts(userData: UserInitialData, answers: QuestionTurn[]): OpeningFinancialFacts {
  const evidenceText = openingFinancialEvidenceText(userData, answers);
  const expenseFacts = extractOpeningExpenseFacts(evidenceText);
  const mortgagePrincipalWan = matchAmount(evidenceText, [
    /(?:房贷|按揭)(?:余额|本金|还剩|剩余)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:还背着|背着|背上)[^\d\n。；]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)[^\n。；]{0,8}(?:房贷|按揭)/
  ]);
  const mortgageMonthlyPaymentWan = matchAmount(evidenceText, [
    /(?:月供|每月还款|每个月还款)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:每月|每个月)[^\d。；]{0,12}(?:偿还|支付)[^。；]{0,12}(?:房贷|按揭)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(?:每月|每个月)[^\d。；]{0,12}(?:房贷|按揭)[^。；]{0,12}(?:偿还|支付)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)/
  ]);
  const propertyMarketValueWan = matchAmount(evidenceText, [
    /(?:房产|住房|房子|公寓)(?:市值|价值|总价|买价|购入价)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
    /(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:的房子|的住房|的公寓)/
  ]);
  const ownsProperty = propertyMarketValueWan !== undefined
    || mortgagePrincipalWan !== undefined
    || /(?:名下|自有|买了|购入|刚买|背上房贷)[^。；]{0,12}(?:房|住房|公寓)|(?:房|住房|公寓)[^。；]{0,12}(?:名下|自有|按揭)/.test(evidenceText);
  const basicOrAggregate = expenseFacts.find((fact) => fact.type === "basic_living" || fact.type === "aggregate");

  return {
    evidenceText,
    expenseFacts,
    cashWan: matchAmount(evidenceText, [
      /(?:现金|存款|备用金|应急金|家庭备用金)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
      /(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:现金|存款|备用金|应急金)/
    ]),
    investmentAssetsWan: matchAmount(evidenceText, [
      /(?:基金|股票|理财|投资资产|投资账户)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
      /(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:基金|股票|理财|投资)/
    ]),
    propertyMarketValueWan,
    ownsProperty,
    mortgagePrincipalWan,
    mortgageMonthlyPaymentWan,
    annualAfterTaxIncomeWan: matchAmount(evidenceText, [
      /(?:税后年薪|税后年收入|年薪税后|年收入税后)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(万元|万|元)/,
      /(?:年薪|年收入)[^。；]{0,8}(\d+(?:\.\d+)?)\s*(万元|万|元)[^。；]{0,8}(?:税后)/
    ]),
    monthlyBasicLivingExpenseWan: basicOrAggregate?.monthlyAmountWan
  };
}

export function applyOpeningFactsToFinancialState(
  state: FinancialState,
  facts: OpeningFinancialFacts
): FinancialState {
  const next = { ...state };
  if (facts.cashWan !== undefined) next.cashWan = facts.cashWan;
  if (facts.investmentAssetsWan !== undefined) next.investmentAssetsWan = facts.investmentAssetsWan;
  if (facts.propertyMarketValueWan !== undefined) next.propertyMarketValueWan = facts.propertyMarketValueWan;
  if (facts.mortgagePrincipalWan !== undefined) next.totalDebtWan = facts.mortgagePrincipalWan;
  if (facts.annualAfterTaxIncomeWan !== undefined) next.annualAfterTaxIncomeWan = facts.annualAfterTaxIncomeWan;

  // Do not transport a model-generated annual aggregate across the opening
  // boundary.  initializeOpeningFinancialLedger derives it only after typed
  // accepted commitments exist; until then compatibility state has no expense
  // authority at all.
  next.annualCoreExpenseWan = 0;
  next.annualDisposableIncomeWan = roundWan(next.annualAfterTaxIncomeWan);
  next.netWorthWan = roundWan(
    next.cashWan
    + next.investmentAssetsWan
    + next.propertyMarketValueWan
    + next.businessAndOtherAssetsWan
    - next.totalDebtWan
  );
  return next;
}

/**
 * New-game opening balances are closed-world facts. The model may estimate
 * recurring income and expenses, but it never owns cash, assets or debt.
 */
export function applyAuthoritativeOpeningFactsToFinancialState(
  modelState: FinancialState,
  facts: OpeningFinancialFacts
): { state: FinancialState; ignoredModelBalance: boolean } {
  const ignoredModelBalance = [
    modelState.cashWan,
    modelState.investmentAssetsWan,
    modelState.propertyMarketValueWan,
    modelState.businessAndOtherAssetsWan,
    modelState.totalDebtWan
  ].some((value) => value !== 0);
  const closedWorldState: FinancialState = {
    ...modelState,
    cashWan: 0,
    investmentAssetsWan: 0,
    propertyMarketValueWan: 0,
    businessAndOtherAssetsWan: 0,
    totalDebtWan: 0,
    netWorthWan: 0,
    isEstimated: true
  };
  return {
    state: applyOpeningFactsToFinancialState(closedWorldState, facts),
    ignoredModelBalance
  };
}
