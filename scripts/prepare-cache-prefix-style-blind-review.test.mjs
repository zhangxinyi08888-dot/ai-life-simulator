import assert from "node:assert/strict";
import test from "node:test";

import { buildStyleBlindReview, measureStyle } from "./prepare-cache-prefix-style-blind-review.mjs";

function record(index) {
  const pairId = `pair-${index}`;
  const node = (label) => ({title: `${label}-${index}`, ageInMonths: 300, stage: "test", description: `第${index}个月，你走到窗边。你意识到事情变了。“再试一次。”`, choices: [{text: "继续"}]});
  return {pairId, key: "test", theme: index % 2 ? "关系" : "职业", replicate: 1, samePromptInput: true, selection: {id: "A", text: "继续"}, callOrder: index % 2 ? ["main", "v2_r4"] : ["v2_r4", "main"], main: {outputNode: node("main")}, candidate: {outputNode: node("candidate")}};
}

test("builds a balanced ten-pair packet without source labels", () => {
  const records = Array.from({length: 10}, (_, index) => record(index + 1));
  const states = new Map(records.map((item) => [item.pairId, {currentNode: {title: "前情", description: "共享前情"}}]));
  const result = buildStyleBlindReview(records, states);
  assert.equal(result.manifest.sampleCount, 10);
  assert.deepEqual(result.manifest.aLabelCounts, {main: 5, v2_r4: 5});
  assert.doesNotMatch(result.packet, /v2_r4|cache-prefix|mainOutputSha/u);
  assert.match(result.packet, /场景承载/u);
  assert.match(result.packet, /克制与余味/u);
});

test("measures style signals without treating length as the only feature", () => {
  const metrics = measureStyle("第3个月，你走到窗边。\n\n她说：“别急。”你意识到计划需要改变。");
  assert.equal(metrics.paragraphCount, 2);
  assert.equal(metrics.directSpeechCount, 1);
  assert.ok(metrics.numericTemporalAnchorCount >= 1);
  assert.ok(metrics.sceneTermCount >= 1);
  assert.ok(metrics.summaryScaffoldCount >= 1);
});
