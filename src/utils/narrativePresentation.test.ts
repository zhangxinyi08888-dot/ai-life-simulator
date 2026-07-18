import assert from "node:assert/strict";
import {
  splitNarrativeParagraphs,
  splitNarrativeSentences,
  splitStableStreamingParagraphs
} from "./narrativePresentation";

assert.deepEqual(
  splitNarrativeParagraphs("第一段写选择之后发生的事情。\n\n第二段写现实代价。\n\n第三段写新的关口。"),
  ["第一段写选择之后发生的事情。", "第二段写现实代价。", "第三段写新的关口。"]
);

const longBlock = "你接受了新岗位，三周后开始负责两个交付项目，月收入比以前增加了四千元。通勤时间也从四十分钟拉长到一个半小时，晚饭经常只能在地铁站解决。伴侣支持这次尝试，但希望你每周至少留出一个完整晚上处理共同生活。试用期结束前，公司又让你在带新人和争取核心项目之间做出选择。";
const generatedParagraphs = splitNarrativeParagraphs(longBlock);
assert.equal(generatedParagraphs.length >= 2, true);
assert.equal(generatedParagraphs.join(""), longBlock);
assert.equal(
  generatedParagraphs.every((paragraph) => paragraph.length <= 76 || splitNarrativeSentences(paragraph).length === 1),
  true
);

const oversizedExplicitParagraphs = `${longBlock}\n\n${longBlock}\n\n${longBlock}`;
const rebalancedParagraphs = splitNarrativeParagraphs(oversizedExplicitParagraphs);
assert.equal(rebalancedParagraphs.length > 4, true);
assert.equal(rebalancedParagraphs.join(""), oversizedExplicitParagraphs.replaceAll("\n\n", ""));
assert.equal(
  rebalancedParagraphs.every((paragraph) => paragraph.length <= 76 || splitNarrativeSentences(paragraph).length === 1),
  true
);

const stableStreamingParagraphs = splitStableStreamingParagraphs(`${longBlock}最后一句仍在生成`);
assert.equal(stableStreamingParagraphs.length > 0, true);
assert.deepEqual(stableStreamingParagraphs, generatedParagraphs.slice(0, stableStreamingParagraphs.length));
assert.equal(longBlock.startsWith(stableStreamingParagraphs.join("")), true);

assert.deepEqual(splitNarrativeParagraphs("短句保持原样。"), ["短句保持原样。"]);
assert.deepEqual(splitNarrativeParagraphs("   "), []);
