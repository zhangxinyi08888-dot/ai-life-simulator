import assert from "node:assert/strict";
import { extractStreamedNodePreview, mergeStreamedNodePreview } from "./streamingJsonPreview";
import { splitNarrativeParagraphs } from "./narrativePresentation";

assert.deepEqual(
  extractStreamedNodePreview('{"title":"新的阶段","description":"第一段仍在生成'),
  {
    title: "新的阶段",
    paragraphs: ["第一段仍在生成"],
    descriptionComplete: false
  }
);

const preservedPreview = {
  title: "已生成标题",
  paragraphs: ["已经生成并需要保留的一整段内容。"],
  descriptionComplete: false
};

assert.deepEqual(
  mergeStreamedNodePreview(
    preservedPreview,
    { title: "重试标题", paragraphs: ["更短"], descriptionComplete: false },
    true
  ),
  {
    title: "重试标题",
    paragraphs: preservedPreview.paragraphs,
    descriptionComplete: false
  }
);

assert.deepEqual(
  mergeStreamedNodePreview(
    preservedPreview,
    { title: "重试标题", paragraphs: ["新的内容已经超过之前保留的段落长度，因此可以接管展示。"], descriptionComplete: true },
    true
  ),
  {
    title: "重试标题",
    paragraphs: ["新的内容已经超过之前保留的段落长度，因此可以接管展示。"],
    descriptionComplete: true
  }
);

assert.deepEqual(
  extractStreamedNodePreview('{"title":"新的阶段","description":"第一段。\\n\\n第二段。","choices":['),
  {
    title: "新的阶段",
    paragraphs: ["第一段。", "第二段。"],
    descriptionComplete: true
  }
);

const longStreamedDescription = "你接受了新岗位，三周后开始负责两个交付项目，月收入比以前增加了四千元。通勤时间也从四十分钟拉长到一个半小时，晚饭经常只能在地铁站解决。伴侣支持这次尝试，但希望你每周至少留出一个完整晚上处理共同生活。试用期结束前，公司又让你在带新人和争取核心项目之间做出选择。";
const completedLongPreview = extractStreamedNodePreview(JSON.stringify({
  title: "新的阶段",
  description: longStreamedDescription
}));
assert.equal(completedLongPreview.descriptionComplete, true);
assert.deepEqual(completedLongPreview.paragraphs, splitNarrativeParagraphs(longStreamedDescription));

assert.deepEqual(
  extractStreamedNodePreview('{"title":"含有\\u73b0\\u5b9e的标题","description":"带有\\\"引号\\\"的正文'),
  {
    title: "含有现实的标题",
    paragraphs: ['带有"引号"的正文'],
    descriptionComplete: false
  }
);
