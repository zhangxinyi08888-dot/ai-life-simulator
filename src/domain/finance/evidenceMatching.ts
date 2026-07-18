import type { FinancialEventKind, FinancialEventProposal } from "./types";

export type EvidenceMatchReason = "EVIDENCE_EXACT_MATCHED" | "EVIDENCE_NORMALIZED_MATCHED" | "EVIDENCE_FUZZY_MATCHED";

const PROTAGONIST_PATTERN = /你|主角|本人|自己的|个人/;
const NON_PROTAGONIST_ENTITY_PATTERN = /^(?:公司|企业|项目|团队|同事|伴侣|配偶|父母|孩子|子女)/;
const ENTITY_ONLY_EVENT_KINDS = new Set<FinancialEventKind>(["business_financing_recorded"]);

const EVENT_PATTERNS: Partial<Record<FinancialEventKind, RegExp>> = {
  income_source_started: /工资|薪资|月薪|年薪|收入|顾问|咨询|稿费|版税|租金|养老金|年金|分红|提款/,
  income_source_adjusted: /工资|薪资|月薪|年薪|收入|顾问|咨询|稿费|版税|租金|养老金|年金|分红|调整|涨薪|降薪/,
  income_source_paused: /暂停|停发|停薪|中断|不再领取/,
  income_source_ended: /离职|退休|结束|终止|停发|不再领取|停止工作/,
  one_off_income_received: /收入|奖金|补偿|到账|获得|收到|稿费|报酬/,
  expense_commitment_started: /支出|房租|租金|生活费|医疗|教育|保险|赡养|月供/,
  expense_commitment_adjusted: /支出|房租|租金|生活费|医疗|教育|保险|赡养|月供|上涨|下降|调整/,
  expense_commitment_ended: /支出|房租|租金|月供|结束|终止|不再|还清/,
  one_off_expense_paid: /支出|支付|花费|缴纳|购买|转出|投入/,
  asset_purchased: /购买|买入|购置|首付|房产|投资/,
  asset_sold: /出售|卖出|变现|成交/,
  asset_revalued: /估值|市值|升值|贬值|上涨|下跌/,
  debt_drawn: /借款|贷款|房贷|按揭|融资到账|借入/,
  debt_principal_repaid: /还本|偿还本金|提前还款|还清|结清/,
  debt_interest_paid: /利息|息费/,
  debt_restructured: /重组|再融资|置换贷款/,
  debt_forgiven: /减免|豁免|免除债务/,
  business_financing_recorded: /融资|投资方|天使轮|A轮|B轮|估值/,
  business_holding_revalued: /股权|持股|期权|估值|股份/,
  business_distribution_received: /分红|股息|利润分配/,
  business_holding_sold: /出售股权|转让股份|退出|套现/,
  family_support_received: /家人|家庭|父母|伴侣|支持|资助|转账/,
  family_support_paid: /家人|家庭|父母|伴侣|支持|资助|赡养/,
  liquidity_shortfall_created: /资金缺口|周转|借款|透支|现金不足/
};

export function normalizeEvidenceText(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function narrativeSentences(value: string): string[] {
  return String(value || "").split(/(?<=[。！？!?；;\n])/u).map((item) => item.trim()).filter(Boolean);
}

function financialAmounts(value: unknown, key = ""): number[] {
  if (typeof value === "number") {
    return /(?:wan|amount|value|principal|income|expense|payment|fee|valuation|cash)/i.test(key)
      && Number.isFinite(value)
      && value > 0
      ? [Math.round(value * 10000) / 10000]
      : [];
  }
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => financialAmounts(item, key));
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => financialAmounts(child, childKey));
}

function textContainsAmount(text: string, amount: number): boolean {
  const normalized = text.normalize("NFKC");
  const candidates = new Set([
    String(amount),
    amount.toFixed(1),
    amount.toFixed(2),
    String(Math.round(amount * 10000))
  ]);
  return [...candidates].some((candidate) => {
    const trimmed = candidate.replace(/(\.\d*?[1-9])0+$|\.0+$/u, "$1");
    return normalized.includes(`${trimmed}万`)
      || normalized.includes(`${trimmed} 万`)
      || (amount < 1 && normalized.includes(`${Math.round(amount * 10000)}元`));
  });
}

export function matchFinancialEvidence(input: {
  proposal: FinancialEventProposal;
  narrativeText: string;
}): { matched: boolean; reasonCode?: EvidenceMatchReason; excerpt?: string } {
  const evidence = String(input.proposal.evidence || "").trim();
  if (!evidence) return { matched: false };
  if (!ENTITY_ONLY_EVENT_KINDS.has(input.proposal.kind) && NON_PROTAGONIST_ENTITY_PATTERN.test(evidence)) {
    return { matched: false };
  }
  if (input.narrativeText.includes(evidence)) {
    return { matched: true, reasonCode: "EVIDENCE_EXACT_MATCHED", excerpt: evidence };
  }
  const normalizedNarrative = normalizeEvidenceText(input.narrativeText);
  const normalizedEvidence = normalizeEvidenceText(evidence);
  if (normalizedEvidence && normalizedNarrative.includes(normalizedEvidence)) {
    return { matched: true, reasonCode: "EVIDENCE_NORMALIZED_MATCHED", excerpt: evidence };
  }

  const amounts = financialAmounts(input.proposal.payload);
  const eventPattern = EVENT_PATTERNS[input.proposal.kind];
  if (!amounts.length || !eventPattern) return { matched: false };
  const sentence = narrativeSentences(input.narrativeText).find((candidate) => (
    (PROTAGONIST_PATTERN.test(candidate) || /她|他/.test(candidate))
    && eventPattern.test(candidate)
    && amounts.some((amount) => textContainsAmount(candidate, amount))
    && amounts.some((amount) => textContainsAmount(evidence, amount))
  ));
  return sentence
    ? { matched: true, reasonCode: "EVIDENCE_FUZZY_MATCHED", excerpt: sentence }
    : { matched: false };
}

export function matchesNormalizedEvidence(narrativeText: string, evidence: string): boolean {
  const normalizedEvidence = normalizeEvidenceText(evidence);
  return Boolean(normalizedEvidence) && normalizeEvidenceText(narrativeText).includes(normalizedEvidence);
}
