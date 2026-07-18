import assert from "node:assert/strict";
import { buildNarrativeRevealFrames } from "./narrativeReveal";
import { splitNarrativeParagraphs, splitNarrativeSentences } from "./narrativePresentation";

const description = "你进入一家新的公司，开始负责产品数据模块。团队愿意分享经验，你也逐渐适应新的节奏。\n\n前三个月里，你一边学习行业知识，一边主动承担项目重构。新的合作关系慢慢形成，你开始看见更清晰的职业方向。";
const frames = buildNarrativeRevealFrames("破局与重塑", description);
const finalParagraphs = splitNarrativeParagraphs(description);

assert.equal(frames.length, finalParagraphs.length);
assert.deepEqual(frames.at(-1), {
  title: "破局与重塑",
  paragraphs: finalParagraphs,
  descriptionComplete: true
});

for (let index = 1; index < frames.length; index += 1) {
  const previous = frames[index - 1].paragraphs;
  const current = frames[index].paragraphs;
  assert.ok(current.length >= previous.length, "段落数量只能增加，不能回退");
  previous.forEach((paragraph, paragraphIndex) => {
    assert.equal(current[paragraphIndex], paragraph, "已经显示的短段落不能再发生变化");
  });
}

assert.ok(finalParagraphs.every((paragraph) => paragraph.length <= 76 || splitNarrativeSentences(paragraph).length === 1));

const quotedParagraph = "他说：“可以再试一次。”你点了点头，决定先完成今天的工作。";
const quotedSentences = splitNarrativeSentences(quotedParagraph);
assert.equal(quotedSentences.join(""), quotedParagraph);
assert.deepEqual(quotedSentences, ["他说：“可以再试一次。”", "你点了点头，决定先完成今天的工作。"]);
