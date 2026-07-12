import assert from "node:assert/strict";
import {
  advanceOngoingProcesses,
  applyProcessWorldDeltas,
  rebuildOngoingProcessesFromHistory,
  unresolvedProcessRequirements,
  validateProcessWorldDeltas
} from "./ongoingProcess";
import { OngoingProcess } from "../types";

const pregnancy: OngoingProcess = {
  id: "pregnancy_partner_1",
  type: "pregnancy",
  subjectPersonIds: ["family_partner"],
  status: "active",
  startedAtAgeInMonths: 52 * 12 + 3,
  expectedEndAgeInMonths: 53 * 12,
  lastUpdatedAtAgeInMonths: 52 * 12 + 9,
  source: "history",
  confidence: 0.9
};

const advanced = advanceOngoingProcesses({
  ongoingProcesses: [pregnancy],
  previousAgeInMonths: 52 * 12 + 9,
  targetAgeInMonths: 53 * 12 + 6
});
assert.equal(advanced.nextProcesses[0].lastUpdatedAtAgeInMonths, 53 * 12 + 6);
assert.equal(advanced.requiredTransitions.length, 1);
assert.equal(advanced.requiredTransitions[0].processId, pregnancy.id);
assert.equal(unresolvedProcessRequirements(advanced.requiredTransitions, []).length, 1);

const validated = validateProcessWorldDeltas({
  worldDeltas: [{ type: "process_completed", processId: pregnancy.id, completedAtAgeInMonths: 53 * 12, summary: "孩子出生，妊娠结束。" }],
  currentProcesses: advanced.nextProcesses,
  previousAgeInMonths: 52 * 12 + 9,
  targetAgeInMonths: 53 * 12 + 6
});
assert.deepEqual(validated.issues, []);
assert.equal(unresolvedProcessRequirements(advanced.requiredTransitions, validated.worldDeltas).length, 0);
const completed = applyProcessWorldDeltas(advanced.nextProcesses, validated.worldDeltas, 53 * 12 + 6);
assert.equal(completed[0].status, "completed");

const restarted = validateProcessWorldDeltas({
  worldDeltas: [{ type: "process_completed", processId: pregnancy.id, completedAtAgeInMonths: 54 * 12, summary: "重复完成" }],
  currentProcesses: completed,
  previousAgeInMonths: 53 * 12 + 6,
  targetAgeInMonths: 54 * 12
});
assert.equal(restarted.worldDeltas.length, 0);
assert.equal(restarted.issues.length, 1);

const inferred = rebuildOngoingProcessesFromHistory([{
  age: 52,
  ageInMonths: 52 * 12 + 9,
  stage: "现实抉择",
  title: "工作与家庭",
  description: "妻子已怀孕六个月，希望你多陪伴。",
  selectedChoice: "平衡工作",
  attributes: { happiness: 50, intelligence: 70, wealth: 60, relation: 60, health: 50 },
  choices: [],
  isEndingNode: false
}]);
assert.equal(inferred.length, 1);
assert.equal(inferred[0].expectedEndAgeInMonths, 53 * 12);

const started = validateProcessWorldDeltas({
  worldDeltas: [{
    type: "process_started",
    process: {
      id: "pregnancy_new",
      type: "pregnancy",
      subjectPersonIds: ["protagonist"],
      status: "active",
      startedAtAgeInMonths: 600,
      expectedEndAgeInMonths: 660,
      lastUpdatedAtAgeInMonths: 600,
      source: "model_proposed",
      confidence: 0.8
    }
  }],
  currentProcesses: [],
  previousAgeInMonths: 600,
  targetAgeInMonths: 600
});
assert.equal(started.issues.length, 0);
assert.equal(started.worldDeltas[0].type === "process_started" && started.worldDeltas[0].process.expectedEndAgeInMonths, 609);

const missingSubject = validateProcessWorldDeltas({
  worldDeltas: [{ type: "process_started", process: { ...pregnancy, id: "invalid", subjectPersonIds: [] } }],
  currentProcesses: [],
  previousAgeInMonths: 600,
  targetAgeInMonths: 600
});
assert.equal(missingSubject.worldDeltas.length, 0);
assert.equal(missingSubject.issues.length, 1);
