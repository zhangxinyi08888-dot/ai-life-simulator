import assert from "node:assert/strict";
import test from "node:test";
import {
  bindNarrativeExpenseFacts,
  candidateFromNarrativeBinding,
  segmentNarrativeExpenseClauses
} from "./narrativeExpenseFactBinding";

function bind(narrativeText: string) {
  return bindNarrativeExpenseFacts({
    sourceNodeId: "node-expense-binding",
    sourceOutcomeId: "outcome-expense-binding",
    narrativeText
  });
}

function byKey(result: ReturnType<typeof bind>, responsibilityKey: string) {
  const binding = result.bindings.find((item) => item.responsibilityKey === responsibilityKey);
  assert.ok(binding, `expected ${responsibilityKey}`);
  return binding;
}

function assertSpan(span: { start: number; end: number; excerpt: string } | undefined, excerpt: string) {
  assert.ok(span, `expected span ${excerpt}`);
  assert.equal(span.excerpt, excerpt);
  assert.equal(span.end - span.start, excerpt.length);
}

test("C-01 clause completion keeps an already-paid rent fact when a later clause is planned", () => {
  const result = bind("你已经每月支付房租5000元，未来再考虑搬家。");
  const housing = byKey(result, "primary_residence:main");
  assert.equal(housing.completion, "completed");
  assert.equal(housing.liability, "protagonist");
  assert.equal(housing.explicitMonthlyTotalWan, 0.5);
  assertSpan(housing.responsibilitySpan, "房租");
  assertSpan(housing.completionSpan, "已经");
  assertSpan(housing.payerSpan, "你已经每月支付");
  assertSpan(housing.amountSpan, "5000元");
  assert.equal(result.bindings.length, 1);
});

test("C-02 a planned rent start remains a review candidate rather than an active proposal", () => {
  const binding = byKey(bind("你计划下月开始支付房租5000元。"), "primary_residence:main");
  const candidate = candidateFromNarrativeBinding(binding);
  assert.equal(binding.completion, "planned");
  assert.equal(candidate.action, "review");
  assert.equal(candidate.completion, "planned");
});

test("C-03 binds personal rent and a partner-paid parent medical bill separately", () => {
  const result = bind("你支付房租5000元，伴侣承担父母医疗1200元。");
  const housing = byKey(result, "primary_residence:main");
  const healthcare = byKey(result, "recurring_healthcare:parents");
  assert.deepEqual([
    housing.liability,
    housing.financialScope,
    housing.explicitMonthlyTotalWan,
    healthcare.liability,
    healthcare.financialScope,
    healthcare.explicitMonthlyTotalWan
  ], ["protagonist", "personal", 0.5, "third_party", "third_party", 0.12]);
  assertSpan(housing.payerSpan, "你支付");
  assertSpan(healthcare.payerSpan, "伴侣承担");
  assertSpan(housing.amountSpan, "5000元");
  assertSpan(healthcare.amountSpan, "1200元");
});

test("C-04 binds shared residence and an individual medical expense independently", () => {
  const result = bind("你们共同支付房租5000元，你单独承担父母医疗1200元。");
  const housing = byKey(result, "primary_residence:main");
  const healthcare = byKey(result, "recurring_healthcare:parents");
  assert.deepEqual([
    housing.liability,
    housing.financialScope,
    housing.shareRate,
    healthcare.liability,
    healthcare.financialScope,
    healthcare.protagonistShareWan
  ], ["shared", "shared_household", undefined, "protagonist", "personal", 0.12]);
  assert.equal(housing.sourceMateriality, "critical");
  assert.ok(housing.unresolvedFields.includes("share"));
  assertSpan(healthcare.payerSpan, "你单独承担");
});

test("C-05 excludes a salary amount and binds each recurring outlay to its own amount", () => {
  const result = bind("你的月薪1.8万元，扣房租5000元和医疗1200元后，现金流明显紧张。");
  const housing = byKey(result, "primary_residence:main");
  const healthcare = byKey(result, "recurring_healthcare:protagonist");
  assert.deepEqual([housing.explicitMonthlyTotalWan, healthcare.explicitMonthlyTotalWan], [0.5, 0.12]);
  assert.equal(result.bindings.some((item) => item.explicitMonthlyTotalWan === 1.8), false);
  assertSpan(housing.amountSpan, "5000元");
  assertSpan(healthcare.amountSpan, "1200元");
});

test("C-06 retains an exact amount beyond the legacy sixteen-character window when it belongs to one predicate", () => {
  const binding = byKey(bind("你已经请护工负责父亲日常照料和陪诊并协调社区服务直到费用为每月1200元。"), "elder_care:parents");
  assert.equal(binding.explicitMonthlyTotalWan, 0.12);
  assert.ok((binding.amountSpan?.start || 0) - binding.responsibilitySpan.end > 16);
  assertSpan(binding.amountSpan, "1200元");
});

test("C-06 housing context does not turn incidental transport for a parent checkup into healthcare", () => {
  const result = bind("你已经承担这套长期租住房屋的固定成本，考虑到父亲复查时的交通、日常买菜和工作通勤等安排仍会持续很多年，这笔住房固定成本每月由你支付5000元。");
  assert.equal(result.bindings.some((item) => item.responsibilityKind === "recurring_healthcare"), false);
  assert.equal(byKey(result, "primary_residence:main").explicitMonthlyTotalWan, 0.5);
});

test("C-07 does not copy one ambiguous amount to two responsibilities", () => {
  const result = bind("你已经承担房租和父母医疗，每月5000元。");
  const housing = byKey(result, "primary_residence:main");
  const healthcare = byKey(result, "recurring_healthcare:parents");
  assert.equal(housing.explicitMonthlyTotalWan, undefined);
  assert.equal(healthcare.explicitMonthlyTotalWan, undefined);
  for (const binding of [housing, healthcare]) {
    assert.ok(binding.unresolvedFields.includes("amount"));
    assert.ok(binding.reasonCodes.includes("EXPENSE_FACT_BINDING_AMBIGUOUS"));
    assertSpan(binding.amountSpan, "5000元");
  }
});

test("a future housing cadence cannot be borrowed by the current rent amount", () => {
  const result = bind("你正在支付现在公寓房租4800元，未来准备搬到月租7500元的新房。");
  const housing = result.bindings.find((item) => item.responsibilityKey === "primary_residence:main" && item.completion !== "planned");
  const planned = result.bindings.find((item) => item.responsibilityKey === "primary_residence:main" && item.completion === "planned");
  assert.ok(housing);
  assert.ok(planned);
  assert.equal(housing.explicitMonthlyTotalWan, 0.48);
  assertSpan(housing.amountSpan, "4800元");
  assertSpan(housing.cadenceSpan, "房租");
  assert.equal(planned.explicitMonthlyTotalWan, 0.75);
  assert.equal(candidateFromNarrativeBinding(planned).action, "review");
  assertSpan(planned.amountSpan, "7500元");
});

test("completed expense plus planned insurance, child-course, or treatment adjustment retains a review-only observation", () => {
  const cases = [
    ["你已开始每月支付父亲康复训练2000元，但准备下季度把自己的保险升级到1200元。", "personal_insurance:protagonist", 0.12],
    ["你已经每月支付孩子托班费3500元，同时计划明年改读每月6000元的国际课程。", "child_support:unidentified", 0.6],
    ["你已为自己每月购买慢病药800元，考虑未来改用每月1500元的新疗法。", "recurring_healthcare:protagonist", 0.15]
  ] as const;
  for (const [narrative, key, amount] of cases) {
    const planned = bind(narrative).bindings.find((item) => item.responsibilityKey === key && item.completion === "planned");
    assert.ok(planned, narrative);
    assert.equal(planned.explicitMonthlyTotalWan, amount);
    assert.equal(candidateFromNarrativeBinding(planned).action, "review");
  }
  const insurance = bind(cases[0][0]).bindings.find((item) => item.responsibilityKey === cases[0][1] && item.completion === "planned");
  assert.equal(insurance?.cadence, "recurring_unknown");
});

test("a bare expense noun without completion evidence stays review-only", () => {
  const housing = byKey(bind("你本月的房租5000元。"), "primary_residence:main");
  assert.equal(housing.action, "review");
  assert.equal(housing.completionSpan, undefined);
  assert.ok(housing.unresolvedFields.includes("completion"));
});

test("C-08 permits a bounded caregiver-service continuation across clauses", () => {
  const binding = byKey(bind("你与父亲商量后决定请护工；次周已上门，费用由你承担，每月1200元。"), "elder_care:parents");
  assert.equal(binding.completion, "completed");
  assert.equal(binding.liability, "protagonist");
  assert.equal(binding.explicitMonthlyTotalWan, 0.12);
  assert.equal(binding.contextClauseIds.length, 4);
  assertSpan(binding.responsibilitySpan, "护工");
  assertSpan(binding.completionSpan, "已上门");
  assertSpan(binding.payerSpan, "费用由你承担");
  assertSpan(binding.amountSpan, "1200元");
});

test("C-09 a discussion about a caregiver is reviewable but does not start an account", () => {
  const binding = byKey(bind("你与父亲商量后考虑请护工。"), "elder_care:parents");
  const candidate = candidateFromNarrativeBinding(binding);
  assert.equal(binding.completion, "planned");
  assert.equal(binding.liability, "protagonist");
  assert.equal(binding.sourceMateriality, "nonmaterial");
  assert.equal(candidate.action, "review");
});

test("C-09b a jointly arranged named caregiver becomes critical only once connected prose states the recurring cashflow", () => {
  const binding = byKey(bind("你和伴侣商量后，决定请一个白班阿姨，每周来三天，帮忙做饭和打扫，减轻两边老人的负担。这笔开销不小，你算了算，每月要多支出三千多元。"), "elder_care:parents");
  assert.equal(binding.completion, "completed");
  assert.equal(binding.liability, "shared");
  assert.equal(binding.financialScope, "shared_household");
  assert.equal(binding.explicitMonthlyTotalWan, 0.3);
  assert.equal(binding.sourceMateriality, "critical");
  assert.ok(binding.unresolvedFields.includes("share"));
  assertSpan(binding.payerSpan, "你和伴侣");
  assertSpan(binding.amountSpan, "三千多元");
});

test("C-09c binds a shared gross rent to the protagonist share in the immediate clause", () => {
  const binding = byKey(bind("你们每月共同承担房租5000元，其中你每月承担2500元（各半）。"), "primary_residence:main");
  assert.equal(binding.liability, "shared");
  assert.equal(binding.financialScope, "shared_household");
  assert.equal(binding.explicitMonthlyTotalWan, 0.5);
  assert.equal(binding.shareRate, 0.5);
  assert.equal(binding.protagonistShareWan, 0.25);
  assert.equal(binding.sourceMateriality, "nonmaterial");
  assert.deepEqual(binding.unresolvedFields, []);
});

test("C-10 business workshop rent and personal residence rent remain independent", () => {
  const result = bind("你每月支付个人房租3000元，同时公司租下工坊每月5000元。");
  assert.equal(result.bindings.length, 2);
  const [personal, business] = result.bindings;
  assert.deepEqual([
    personal.liability,
    personal.financialScope,
    personal.explicitMonthlyTotalWan,
    business.liability,
    business.financialScope,
    business.explicitMonthlyTotalWan
  ], ["protagonist", "personal", 0.3, "none", "business_operating", 0.5]);
});

test("C-11 rental income is not an expense responsibility", () => {
  const result = bind("你把房屋出租，每月获得租金5000元。");
  assert.equal(result.bindings.length, 0);
});

test("C-12 personal medication and a parent medication bill retain beneficiary and payer", () => {
  const result = bind("你持续用药每月1200元，父亲服药由母亲承担每月800元。");
  const personal = byKey(result, "recurring_healthcare:protagonist");
  const parent = byKey(result, "recurring_healthcare:parents");
  assert.deepEqual([
    personal.liability,
    personal.explicitMonthlyTotalWan,
    parent.liability,
    parent.financialScope,
    parent.explicitMonthlyTotalWan
  ], ["protagonist", 0.12, "third_party", "third_party", 0.08]);
  assertSpan(personal.responsibilitySpan, "用药");
  assertSpan(parent.payerSpan, "母亲承担");
});

test("parent rehabilitation training is healthcare while paid caregivers remain elder care", () => {
  const rehabilitation = bind("你已开始每月支付父亲康复训练2000元。");
  const healthcare = byKey(rehabilitation, "recurring_healthcare:parents");
  assert.equal(healthcare.responsibilityKind, "recurring_healthcare");
  assert.equal(healthcare.proposedType, "healthcare");
  assert.equal(healthcare.explicitMonthlyTotalWan, 0.2);
  assert.equal(rehabilitation.bindings.some((item) => item.responsibilityKind === "elder_care"), false);

  const caregiver = byKey(bind("你已经每月支付父亲护工费2000元。"), "elder_care:parents");
  assert.equal(caregiver.proposedType, "dependent_support");
});

test("C-13 an ongoing responsibility is observable and canonicalized only in the adapter", () => {
  const binding = byKey(bind("你已经持续支付个人房租每月5000元。"), "primary_residence:main");
  const candidate = candidateFromNarrativeBinding(binding);
  assert.equal(binding.completion, "ongoing");
  assert.equal(candidate.completion, "completed");
  assert.ok(candidate.sourceBindingReasonCodes.includes("EXPENSE_ONGOING_CANONICALIZED_TO_COMPLETED"));
});

test("generic daily-life care wording cannot manufacture an elder-care payer or commitment", () => {
  const text = "角色从重复的工作、照料、学习、兴趣或陪伴中辨认出愿意保留的部分。工作、家庭、健康和资源约束仍然存在，你没有把普通社交解释成亲密关系。";
  const result = bind(text);
  assert.equal(result.bindings.some((item) => item.responsibilityKind === "elder_care"), false);
});

test("material unknown with an actual recurring amount is critical, while a care need alone remains review", () => {
  const unresolved = byKey(bind("每月支付房租5000元。"), "primary_residence:main");
  const needOnly = byKey(bind("父亲最近身体不好，需要定期复查。"), "recurring_healthcare:parents");
  assert.equal(unresolved.sourceMateriality, "critical");
  assert.ok(unresolved.reasonCodes.includes("EXPENSE_COMPLETED_RECURRING_PAYER_UNRESOLVED"));
  assert.equal(needOnly.sourceMateriality, "review");
  assert.equal(needOnly.liability, "unknown");
  assert.equal(needOnly.explicitMonthlyTotalWan, undefined);
});

test("source identity controls amount authority and all binder identifiers are stable", () => {
  const sourceText = "你每月支付房租5000元。";
  const first = bind(sourceText).bindings[0];
  const second = bind(sourceText).bindings[0];
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.id, second.id);
  assert.equal(first.evidenceFingerprint, second.evidenceFingerprint);
  assert.equal(first.amountSourceId, second.amountSourceId);
  const candidate = candidateFromNarrativeBinding(first);
  assert.equal(candidate.sourceClause.clauseId, first.clauseId);
  assert.equal(candidate.sourceClause.sentenceIndex, 0);
  assert.equal(candidate.sourceClause.clauseIndex, 0);
  assert.deepEqual(candidate.sourceClause.contextClauseIds, first.contextClauseIds);
  assert.equal(candidate.sourceSpans.cadence?.excerpt, "每月");

  const missingIdentity = bindNarrativeExpenseFacts({ narrativeText: sourceText }).bindings[0];
  assert.ok(missingIdentity);
  assert.equal(missingIdentity.sourceIdentityStatus, "missing");
  assert.equal(missingIdentity.amountSourceId, undefined);
  assert.ok(missingIdentity.reasonCodes.includes("SOURCE_IDENTITY_MISSING"));
});

test("segmenter emits stable UTF-16 spans for sentence and comma clauses", () => {
  const text = "你支付房租5000元，伴侣承担父母医疗1200元。\n你持续用药。";
  const clauses = segmentNarrativeExpenseClauses(text);
  assert.deepEqual(clauses.map((clause) => clause.text), ["你支付房租5000元", "伴侣承担父母医疗1200元", "你持续用药"]);
  for (const clause of clauses) assert.equal(text.slice(clause.start, clause.end), clause.text);
});
