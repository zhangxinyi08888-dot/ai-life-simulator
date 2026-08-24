import assert from "node:assert/strict";
import {
  hasFirstPersonNarration,
  normalizeNarrativePayloadToSecondPerson,
  normalizeNarrativeToSecondPerson
} from "./narrativePerspective";

assert.equal(hasFirstPersonNarration("我跟着她学习项目排期，半年后我转正。"), true);
assert.equal(hasFirstPersonNarration("她说：“我理解你的顾虑。”你点了点头。"), false);
assert.equal(hasFirstPersonNarration("你保留了自我，也没有变得忘我。"), false);

assert.equal(
  normalizeNarrativeToSecondPerson("我跟着她学习，我的工资也涨了。我们决定继续。"),
  "你跟着她学习，你的工资也涨了。你们决定继续。"
);
assert.equal(
  normalizeNarrativeToSecondPerson("她说：“我理解。”我点了点头。"),
  "她说：“我理解。”你点了点头。"
);
assert.equal(
  normalizeNarrativeToSecondPerson("我仍保留自我，也没有变得忘我。"),
  "你仍保留自我，也没有变得忘我。"
);

const normalizedPayload = normalizeNarrativePayloadToSecondPerson({
  title: "我的新起点",
  descriptionParagraphs: ["我接受了新岗位。"],
  financialEventProposals: [{ evidence: "我在本月收到了工资。" }],
  narrativeMeta: { arcSignals: [{ evidence: "我开始规律复诊。" }] },
  choices: [{ text: "我先完成试用期目标", decisionIntent: "career:complete:probation" }]
});

assert.deepEqual(normalizedPayload, {
  title: "你的新起点",
  descriptionParagraphs: ["你接受了新岗位。"],
  financialEventProposals: [{ evidence: "你在本月收到了工资。" }],
  narrativeMeta: { arcSignals: [{ evidence: "你开始规律复诊。" }] },
  choices: [{ text: "你先完成试用期目标", decisionIntent: "career:complete:probation" }]
});
