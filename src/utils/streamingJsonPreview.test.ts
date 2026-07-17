import assert from "node:assert/strict";
import { extractStreamedNodePreview, mergeStreamedNodePreview } from "./streamingJsonPreview";

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

assert.deepEqual(
  extractStreamedNodePreview('{"title":"含有\\u73b0\\u5b9e的标题","description":"带有\\\"引号\\\"的正文'),
  {
    title: "含有现实的标题",
    paragraphs: ['带有"引号"的正文'],
    descriptionComplete: false
  }
);
