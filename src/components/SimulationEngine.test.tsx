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
      isLoadingReport={false}
      onTimeTravel={() => undefined}
    />
  );
}

const loadingMarkup = renderLoadingState(true);

assert.match(loadingMarkup, /id="next-chapter-preview"/);
assert.match(loadingMarkup, /id="loading-next-progress"/);
assert.match(loadingMarkup, /正在推演现实影响/);
assert.match(loadingMarkup, /generation-shimmer/);
assert.doesNotMatch(loadingMarkup, /id="interaction-dock"/);
assert.doesNotMatch(loadingMarkup, /id="pending-choice-receipt"/);
assert.doesNotMatch(loadingMarkup, /你选择了/);

const idleMarkup = renderLoadingState(false);

assert.match(idleMarkup, /id="interaction-dock"/);
assert.doesNotMatch(idleMarkup, /id="next-chapter-preview"/);
