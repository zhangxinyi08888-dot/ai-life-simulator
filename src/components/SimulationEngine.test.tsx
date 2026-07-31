import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulationNode } from "../types";
import SimulationEngine, { isDecisionAreaInReadingViewport } from "./SimulationEngine";

assert.equal(isDecisionAreaInReadingViewport({ decisionTop: 500, decisionBottom: 800, readingTop: 100, readingBottom: 500 }), false);
assert.equal(isDecisionAreaInReadingViewport({ decisionTop: 470, decisionBottom: 800, readingTop: 100, readingBottom: 500 }), true);
assert.equal(isDecisionAreaInReadingViewport({ decisionTop: -300, decisionBottom: 110, readingTop: 100, readingBottom: 500 }), false);

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
assert.match(idleMarkup, /id="choices-ready-dock"/);
assert.match(idleMarkup, /id="inline-decision-area"/);
assert.match(idleMarkup, /aria-labelledby="decision-area-heading"/);
assert.match(idleMarkup, /tabindex="-1"/);
assert.match(idleMarkup, /1 个选择已准备好/);
assert.match(idleMarkup, /pb-\[89px\]/);
assert.match(idleMarkup, /absolute inset-x-0 bottom-0/);
assert.ok(idleMarkup.indexOf('id="preset-choices-container"') < idleMarkup.indexOf('id="interaction-dock"'));
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
    generationStage="revealing"
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
assert.match(streamingMarkup, /paragraph-enter/);
assert.match(streamingMarkup, /id="scroll-to-latest-btn"/);
assert.match(streamingMarkup, /正在展开最终正文/);
assert.match(streamingMarkup, /立即展开/);
assert.doesNotMatch(streamingMarkup, /opacity:0;transform:translateY\(5px\)/);
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
    narrativePreview={null}
    generationError="本次推演已暂停，新的章节尚未写入时间线。"
    onStopGeneration={() => undefined}
    onRetryGeneration={() => undefined}
    onDiscardGeneration={() => undefined}
    isLoadingReport={false}
    onTimeTravel={() => undefined}
  />
);

assert.match(interruptedMarkup, /id="next-generation-error-state"/);
assert.match(interruptedMarkup, /generation-shimmer/);
assert.doesNotMatch(interruptedMarkup, /保留下来的章节/);
assert.match(interruptedMarkup, /id="retry-next-generation-btn"/);
assert.match(interruptedMarkup, /id="discard-next-generation-btn"/);
assert.doesNotMatch(interruptedMarkup, /id="interaction-dock"/);

const semanticIdMarkup = renderToStaticMarkup(
  <SimulationEngine
    currentNode={{
      ...currentNode,
      choices: [
        { id: "stay_in_current_role", text: "留在现有岗位继续争取期权", impactSummary: "专注现岗" },
        { id: "accept_new_role_transfer", text: "接受内部转岗，进入新业务线", impactSummary: "转岗新业" },
        { id: "startup_for_larger_platform", text: "加入更大的平台加速成长", impactSummary: "跳槽大平台" }
      ]
    }}
    history={[]}
    nodeCount={1}
    onSelectChoice={() => undefined}
    onAcceptReportInvitation={() => undefined}
    onContinueReportInvitation={() => undefined}
    isLoadingNext={false}
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
assert.match(semanticIdMarkup, /id="choice-btn-stay_in_current_role"/);
assert.match(semanticIdMarkup, /data-choice-display-label="A"[^>]*>A<\/span>/);
assert.match(semanticIdMarkup, /data-choice-display-label="B"[^>]*>B<\/span>/);
assert.match(semanticIdMarkup, /data-choice-display-label="C"[^>]*>C<\/span>/);
assert.doesNotMatch(semanticIdMarkup, />stay_in_current_role<\/span>/);
assert.doesNotMatch(semanticIdMarkup, />accept_new_role_transfer<\/span>/);
assert.doesNotMatch(semanticIdMarkup, />startup_for_larger_platform<\/span>/);
