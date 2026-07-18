import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulationNode } from "../types";
import SimulationEngine from "./SimulationEngine";

const currentNode: SimulationNode = {
  age: 18,
  ageInMonths: 18 * 12,
  stage: "成长",
  title: "等待下一章",
  description: "上一章仍然保留在页面中。",
  isEndingNode: false,
  attributes: {
    happiness: 60,
    intelligence: 65,
    wealth: 50,
    relation: 58,
    health: 62
  },
  choices: [
    { id: "A", text: "继续向前", impactSummary: "成长" }
  ]
};

function renderLoadingState(isLoadingNext: boolean): string {
  return renderToStaticMarkup(
    <SimulationEngine
      currentNode={currentNode}
      history={[]}
      nodeCount={1}
      onSelectChoice={() => undefined}
      onAcceptReportInvitation={() => undefined}
      onContinueReportInvitation={() => undefined}
      isLoadingNext={isLoadingNext}
      generationStage="generating"
      narrativePreview={null}
      generationError={null}
      onStopGeneration={() => undefined}
      onRetryGeneration={() => undefined}
      onDiscardGeneration={() => undefined}
      isLoadingReport={false}
      onTimeTravel={() => undefined}
    />
  );
}

const loadingMarkup = renderLoadingState(true);

assert.match(loadingMarkup, /data-chapter-state="draft"/);
assert.match(loadingMarkup, /id="generation-dock"/);
assert.match(loadingMarkup, /id="loading-next-progress"/);
assert.match(loadingMarkup, /正在推演现实影响/);
assert.match(loadingMarkup, /generation-shimmer/);
assert.doesNotMatch(loadingMarkup, /id="interaction-dock"/);
assert.doesNotMatch(loadingMarkup, /id="next-chapter-preview"/);
assert.doesNotMatch(loadingMarkup, /id="pending-choice-receipt"/);
assert.doesNotMatch(loadingMarkup, /你选择了/);

const idleMarkup = renderLoadingState(false);

assert.match(idleMarkup, /id="interaction-dock"/);
assert.match(idleMarkup, /data-chapter-state="committed"/);
assert.doesNotMatch(idleMarkup, /id="generation-dock"/);

const streamingMarkup = renderToStaticMarkup(
  <SimulationEngine
    currentNode={currentNode}
    history={[]}
    nodeCount={1}
    onSelectChoice={() => undefined}
    onAcceptReportInvitation={() => undefined}
    onContinueReportInvitation={() => undefined}
    isLoadingNext
    generationStage="generating"
    narrativePreview={{
      title: "正在形成的新章节",
      paragraphs: ["第一段已经抵达。", "第二段正在继续。"],
      descriptionComplete: false
    }}
    generationError={null}
    onStopGeneration={() => undefined}
    onRetryGeneration={() => undefined}
    onDiscardGeneration={() => undefined}
    isLoadingReport={false}
    onTimeTravel={() => undefined}
  />
);

assert.match(streamingMarkup, /id="chapter-node-title"/);
assert.match(streamingMarkup, /id="chapter-node-body"/);
assert.match(streamingMarkup, /正在形成的新章节/);
assert.match(streamingMarkup, /第一段已经抵达/);
assert.match(streamingMarkup, /第二段正在继续/);
assert.match(streamingMarkup, /id="scroll-to-latest-btn"/);
assert.doesNotMatch(streamingMarkup, /id="next-chapter-draft-title"/);

const interruptedMarkup = renderToStaticMarkup(
  <SimulationEngine
    currentNode={currentNode}
    history={[]}
    nodeCount={1}
    onSelectChoice={() => undefined}
    onAcceptReportInvitation={() => undefined}
    onContinueReportInvitation={() => undefined}
    isLoadingNext={false}
    generationStage="generating"
    narrativePreview={{
      title: "保留下来的章节",
      paragraphs: ["这段已经生成，因此中断后仍然可见。"],
      descriptionComplete: false
    }}
    generationError="生成已暂停，当前已经出现的内容会继续保留。"
    onStopGeneration={() => undefined}
    onRetryGeneration={() => undefined}
    onDiscardGeneration={() => undefined}
    isLoadingReport={false}
    onTimeTravel={() => undefined}
  />
);

assert.match(interruptedMarkup, /id="next-generation-error-state"/);
assert.match(interruptedMarkup, /这段已经生成，因此中断后仍然可见/);
assert.match(interruptedMarkup, /id="retry-next-generation-btn"/);
assert.match(interruptedMarkup, /id="discard-next-generation-btn"/);
assert.doesNotMatch(interruptedMarkup, /id="interaction-dock"/);
