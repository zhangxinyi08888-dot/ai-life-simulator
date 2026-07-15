import assert from "node:assert/strict";
import { createE2eAiJsonCaller, getCachedE2eAiJsonCaller, getE2eCaseSlugs } from "./e2eAiMock";

const slugs = getE2eCaseSlugs();
assert.equal(slugs.length, 5);

const callAiJson = createE2eAiJsonCaller("interest-app");

const questions = JSON.parse((await callAiJson("剧本关键背景补全工具")).text);
assert.equal(questions.questions.length, 3);
assert.equal(questions.questions[0].suggestions.length >= 4, true);

const start = JSON.parse((await callAiJson("startNode")).text);
assert.equal(start.startNode.isEndingNode, false);
assert.equal(start.startNode.choices.length, 3);
assert.equal(new Set(start.startNode.choices.map((choice: { decisionIntent: string }) => choice.decisionIntent)).size, 3);

const next = JSON.parse((await callAiJson("【上一步做出的命运裁决】")).text);
assert.notDeepEqual(
  next.choices.map((choice: { decisionIntent: string }) => choice.decisionIntent),
  start.startNode.choices.map((choice: { decisionIntent: string }) => choice.decisionIntent)
);
JSON.parse((await callAiJson("【上一步做出的命运裁决】")).text);
const endingCandidate = JSON.parse((await callAiJson("【上一步做出的命运裁决】")).text);
assert.equal(endingCandidate.isEndingNode, false);
assert.equal(endingCandidate.choices.length, 3);
assert.equal(endingCandidate.e2eForceEnding, true);
const ending = JSON.parse((await callAiJson("你正在为一段写实人生生成自然终章")).text);
assert.equal(ending.isEndingNode, true);
assert.equal(ending.choices[0].text, "安详落幕，查看一生洞察");

const outcome = JSON.parse((await callAiJson("人生模式分析产品文案系统")).text);
assert.equal(outcome.share.viralTitle.includes("我"), true);
assert.equal(outcome.share.viralTitle.includes("你"), false);
assert.equal(outcome.share.timeline.length >= 4, true);
assert.equal(outcome.report.executiveSummary.patterns.length, 3);

const cachedA = getCachedE2eAiJsonCaller("career-pivot");
const cachedB = getCachedE2eAiJsonCaller("career-pivot");
assert.equal(cachedA, cachedB);
JSON.parse((await cachedA("【上一步做出的命运裁决】")).text);
JSON.parse((await cachedB("【上一步做出的命运裁决】")).text);
const cachedEnding = JSON.parse((await cachedA("【上一步做出的命运裁决】")).text);
assert.equal(cachedEnding.e2eForceEnding, true);
