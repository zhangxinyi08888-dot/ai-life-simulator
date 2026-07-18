import assert from "node:assert/strict";
import { extractStreamedNodePreview, mergeStreamedNodePreview } from "./streamingJsonPreview";
import { splitNarrativeParagraphs, splitStableStreamingParagraphs } from "./narrativePresentation";

assert.deepEqual(
  extractStreamedNodePreview('{"title":"新的阶段","description":"第一段仍在生成'),
  {
    title: "新的阶段",
    paragraphs: [],
    descriptionComplete: false
  }
);

assert.deepEqual(
  extractStreamedNodePreview('{"title":"新的阶段","description":"第一段已经完成。\\n\\n第二段仍在生成'),
  {
    title: "新的阶段",
    paragraphs: ["第一段已经完成。"],
    descriptionComplete: false
  }
);

assert.deepEqual(
  extractStreamedNodePreview('{"title":"结构化新章","descriptionParagraphs":["第一段已经完整。","第二段仍在生成'),
  {
    title: "结构化新章",
    paragraphs: ["第一段已经完整。"],
    descriptionComplete: false
  }
);

assert.deepEqual(
  extractStreamedNodePreview('{"title":"结构化新章","descriptionParagraphs":["第一段已经完整。","第二段的第一句话已经完成。第二句话仍在生成'),
  {
    title: "结构化新章",
    paragraphs: ["第一段已经完整。"],
    descriptionComplete: false
  }
);

const stablePartialParagraph = "第一句话交代新的工作环境和现实限制。第二句话继续说明收入、通勤、团队协作以及生活安排发生的变化。第三句话仍在生成";
assert.deepEqual(
  extractStreamedNodePreview(`{"title":"结构化新章","descriptionParagraphs":["${stablePartialParagraph}`),
  {
    title: "结构化新章",
    paragraphs: splitStableStreamingParagraphs(stablePartialParagraph),
    descriptionComplete: false
  }
);

assert.deepEqual(
  extractStreamedNodePreview('{"title":"结构化新章","descriptionParagraphs":["没有任何句末标点的内容仍在生成'),
  {
    title: "结构化新章",
    paragraphs: [],
    descriptionComplete: false
  }
);

assert.deepEqual(
  extractStreamedNodePreview('{"title":"结构化新章","descriptionParagraphs":["第一段已经完整。","第二段也已经完整。"],"choices":['),
  {
    title: "结构化新章",
    paragraphs: ["第一段已经完整。", "第二段也已经完整。"],
    descriptionComplete: true
  }
);

const sentenceFallback = "第一句话交代了新的工作环境和现实限制。第二句话继续说明收入、通勤、团队协作以及生活安排发生的具体变化。第三句话补充这次选择所带来的机会和必须承担的代价。";
assert.deepEqual(
  extractStreamedNodePreview(`{"title":"句子兜底","description":"${sentenceFallback}`),
  {
    title: "句子兜底",
    paragraphs: splitStableStreamingParagraphs(sentenceFallback),
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
    null,
    {
      title: "首次抵达",
      paragraphs: ["第一段。", "第二段。", "第三段。"],
      descriptionComplete: true
    },
    true
  ),
  {
    title: "首次抵达",
    paragraphs: ["第一段。"],
    descriptionComplete: false
  }
);

assert.deepEqual(
  mergeStreamedNodePreview(
    preservedPreview,
    { title: "重试标题", paragraphs: ["更短"], descriptionComplete: false },
    true
  ),
  {
    title: "已生成标题",
    paragraphs: preservedPreview.paragraphs,
    descriptionComplete: false
  }
);

assert.deepEqual(
  mergeStreamedNodePreview(
    preservedPreview,
    {
      title: "已生成标题",
      paragraphs: [...preservedPreview.paragraphs, "新完成的第二段。", "同时抵达的第三段。"],
      descriptionComplete: true
    },
    true
  ),
  {
    title: "已生成标题",
    paragraphs: [...preservedPreview.paragraphs, "新完成的第二段。"],
    descriptionComplete: false
  }
);

assert.deepEqual(
  mergeStreamedNodePreview(
    { title: "前缀增长", paragraphs: ["第一句已经完成。"], descriptionComplete: false },
    { title: "前缀增长", paragraphs: ["第一句已经完成。第二句也已经完成。"], descriptionComplete: false },
    true
  ),
  {
    title: "前缀增长",
    paragraphs: ["第一句已经完成。"],
    descriptionComplete: false
  }
);

assert.deepEqual(
  mergeStreamedNodePreview(
    preservedPreview,
    { title: "已生成标题", paragraphs: [...preservedPreview.paragraphs, "新完成的第二段。"], descriptionComplete: false },
    true
  ),
  {
    title: "已生成标题",
    paragraphs: [...preservedPreview.paragraphs, "新完成的第二段。"],
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
    title: "已生成标题",
    paragraphs: preservedPreview.paragraphs,
    descriptionComplete: false
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
    paragraphs: [],
    descriptionComplete: false
  }
);
