import assert from "node:assert/strict";
import { rebuildPersonStates } from "./personTimeline";

const people = rebuildPersonStates({ regressionSituation: "父母希望我稳定，外婆常来看我。" }, [], 80 * 12);
const parent = people.find((person) => person.relation === "parent");
const grandparent = people.find((person) => person.relation === "grandparent");
assert.deepEqual(parent?.estimatedAgeRange, [98, 125]);
assert.deepEqual(grandparent?.estimatedAgeRange, [120, 160]);

const deceased = rebuildPersonStates({ regressionSituation: "已故父亲留下了一封信。" }, [], 60 * 12);
assert.equal(deceased.find((person) => person.relation === "parent")?.lifeStatus, "deceased");

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
