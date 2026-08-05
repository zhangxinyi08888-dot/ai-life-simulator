import assert from "node:assert/strict";
import { rebuildPersonStates } from "./personTimeline";

const people = rebuildPersonStates({ regressionSituation: "父母希望我稳定，外婆常来看我。" }, [], 80 * 12);
const parents = people.filter((person) => person.relation === "parent");
const parent = parents[0];
const grandparent = people.find((person) => person.relation === "grandparent");
assert.equal(parents.length, 1);
assert.equal(parents[0].identityKey?.key, "parent:unspecified");
assert.ok(parents.every((person) => person.source === "user_fact" && person.confidence >= 0.75));
assert.deepEqual(parent?.estimatedAgeRange, [98, 125]);
assert.deepEqual(grandparent?.estimatedAgeRange, [120, 160]);

const deceased = rebuildPersonStates({ regressionSituation: "已故父亲留下了一封信。" }, [], 60 * 12);
assert.equal(deceased.find((person) => person.relation === "parent")?.lifeStatus, "deceased");

const answerParents = rebuildPersonStates({}, [], 30 * 12, [], [{ id: 1, question: "支持安排", answer: "我每月给父母2000元。" }]);
assert.equal(answerParents.filter((person) => person.relation === "parent").length, 1);
assert.equal(answerParents.find((person) => person.relation === "parent")?.identityKey?.key, "parent:unspecified");
assert.equal(rebuildPersonStates({ regressionSituation: "我想回老家发展。" }, [], 30 * 12).some((person) => person.relation === "parent"), false);
assert.equal(rebuildPersonStates({ currentSituation: "家庭现金流比较紧张。" }, [], 30 * 12).some((person) => person.relation === "parent"), false);

const deduplicatedParentSummary = rebuildPersonStates({
  currentSituation: "父母支持我自己判断。父母支持我自己判断。"
}, [], 30 * 12).find((person) => person.relation === "parent")?.relationshipSummary;
assert.equal(deduplicatedParentSummary, "父母支持我自己判断");

const advanced = rebuildPersonStates({}, [{
  age: 40,
  ageInMonths: 480,
  stage: "测试",
  title: "测试",
  description: "测试",
  selectedChoice: "继续",
  choices: [],
  attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
  isEndingNode: false,
  worldStateSnapshot: {
    people: [{ id: "mother", relation: "parent", estimatedAgeRange: [65, 70], protagonistAgeInMonthsAtLastUpdate: 480, lifeStatus: "active", source: "history", confidence: 0.9 }],
    directionArcs: [], pressureArcs: [], version: 1
  }
}], 45 * 12);
assert.deepEqual(advanced[0].estimatedAgeRange, [70, 75]);
assert.equal(advanced[0].id, "mother");
assert.equal(advanced[0].identityKey?.key, "legacy:mother");

const children = rebuildPersonStates({ milestoneRelationship: "我们有一个儿子和一个女儿，后来又有了小女儿。" }, [], 40 * 12)
  .filter((person) => person.relation === "child");
assert.equal(children.length, 3);
assert.equal(new Set(children.map((person) => person.id)).size, 3);
assert.ok(children.every((person) => person.source === "user_fact" && person.lifeStatus === "active"));
assert.equal(
  rebuildPersonStates({ milestoneRelationship: "我们计划明年要一个儿子。" }, [], 40 * 12)
    .some((person) => person.relation === "child"),
  false
);

const partners = rebuildPersonStates({ milestoneRelationship: "与前妻离婚多年，现在和妻子共同生活。" }, [], 40 * 12)
  .filter((person) => person.relation === "partner");
assert.equal(partners.length, 2);
assert.deepEqual(partners.map((person) => person.identityKey?.key).sort(), ["partner:current", "partner:former:1"]);

const naturallyWordedPartner = rebuildPersonStates({
  regressionSituation: "我与交往三年的伴侣小陈共同生活，双方会一起讨论重要决定。"
}, [], 30 * 12).find((person) => person.identityKey?.key === "partner:current");
assert.equal(naturallyWordedPartner?.source, "user_fact");
assert.equal(naturallyWordedPartner?.lifeStatus, "active");
assert.ok((naturallyWordedPartner?.confidence || 0) >= 0.75);

const crossAnswerPartner = rebuildPersonStates({
  regressionSituation: "28岁时伴侣希望我留在同一座城市，我们第一次认真讨论婚姻。"
}, [], 28 * 12, [], [
  { id: 1, question: "关系背景", answer: "我们交往四年，关系稳定，也见过双方父母。" }
]).find((person) => person.identityKey?.key === "partner:current");
assert.equal(crossAnswerPartner?.source, "user_fact");
assert.equal(crossAnswerPartner?.lifeStatus, "active");
assert.ok((crossAnswerPartner?.confidence || 0) >= 0.75);

for (const negatedPartnerText of [
  "我单身，没有现任伴侣，对自然认识新朋友持开放态度。",
  "我没有确认伴侣，也没有共同财务。",
  "我无伴侣，希望未来自然发展关系。",
  "目前并无男友，生活重心偏工作。"
]) {
  assert.equal(
    rebuildPersonStates({ currentSituation: negatedPartnerText }, [], 30 * 12)
      .some((person) => person.identityKey?.key === "partner:current"),
    false,
    negatedPartnerText
  );
}

const retained = rebuildPersonStates({}, [{
  age: 40,
  ageInMonths: 480,
  stage: "测试",
  title: "测试",
  description: "测试",
  selectedChoice: "继续",
  choices: [],
  attributes: { happiness: 50, intelligence: 50, wealth: 50, relation: 50, health: 50 },
  isEndingNode: false,
  worldStateSnapshot: {
    people: partners,
    directionArcs: [], pressureArcs: [], version: 2
  }
}], 41 * 12, [{
  ...partners[0],
  id: "must_not_replace_existing_id",
  relationshipSummary: "关系已经结束"
}]);
assert.equal(retained.find((person) => person.identityKey?.key === partners[0].identityKey?.key)?.id, partners[0].id);
assert.equal(retained.find((person) => person.identityKey?.key === partners[0].identityKey?.key)?.relationshipSummary, "关系已经结束");
