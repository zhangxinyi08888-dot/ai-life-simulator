import type { NodeCandidateEnvelope, CandidateRepairIssue, NodeCandidatePatch } from "./nodeCandidateTypes";
import { splitNarrativeParagraphs } from "../../utils/narrativePresentation";
import { stableHash } from "../../utils/stableRandom";

export function buildNodeCandidatePatchPrompt(input: {
  envelope: NodeCandidateEnvelope;
  issues: CandidateRepairIssue[];
}): string {
  const allowedSurfaces = [...new Set(input.issues.flatMap((issue) => issue.surfaces))];
  const paragraphs = input.envelope.candidate.descriptionParagraphs?.filter(Boolean)
    ?? splitNarrativeParagraphs(input.envelope.candidate.description);
  const paragraphRefs = paragraphs.map((text, index) => ({
    paragraphId: `description:${index}:${stableHash(text)}`,
    expectedTextHash: stableHash(text),
    text
  }));
  const responseShape: Record<string, unknown> = {
    contractVersion: "node_candidate_patch_v1",
    baseCandidateHash: input.envelope.baseCandidateHash,
    targetCandidateRevision: input.envelope.candidateRevision,
    addressedIssueCodes: input.issues.map((issue) => issue.code)
  };
  if (allowedSurfaces.includes("titleReplacement")) responseShape.titleReplacement = "替换后的完整标题";
  if (allowedSurfaces.includes("descriptionParagraphPatches")) responseShape.descriptionParagraphPatches = [{
    paragraphId: "必须取自正文段落标识",
    expectedTextHash: "对应的当前段落哈希",
    replacementText: "替换后的完整段落"
  }];
  if (allowedSurfaces.includes("replacementChoices")) responseShape.replacementChoices = [{
    id: "A",
    text: "选项文本",
    impactSummary: "影响摘要",
    decisionIntent: "domain:action:object",
    eventOutcomeId: "只能取自 allowedOutcomeIds"
  }];
  if (allowedSurfaces.includes("proposalPatch")) responseShape.proposalPatch = {
    financialEventProposals: [], employmentTransition: null, worldDeltas: []
  };
  if (allowedSurfaces.includes("narrativeMetaPatch")) responseShape.narrativeMetaPatch = {
    storyEpisode: "可选；如返回必须是完整对象", arcSignals: []
  };
  return `你是候选节点局部修复器。只能修复列出的字段，不能重新生成完整节点，也不能改写锁定骨架。

【锁定骨架】
${JSON.stringify(input.envelope.skeleton)}

【当前候选】
${JSON.stringify(input.envelope.candidate)}

【正文段落标识】
${JSON.stringify(paragraphRefs)}

【待修问题】
${JSON.stringify(input.issues)}

【允许修复面】
${JSON.stringify(allowedSurfaces)}

只返回以下 JSON 形状；没有出现在形状中的字段禁止返回：
${JSON.stringify(responseShape)}

规则：
1. 不得返回 age、ageInMonths、eventMeta、attributes、isEndingNode、transactionId、PressureArc 状态或任何未列出的字段。
2. descriptionParagraphPatches 是整段原子替换；段落标识格式为 description:<index>:<hash>，expectedTextHash 必须等于末段 hash。
3. replacementChoices 必须保留至少两个不同策略，eventOutcomeId 只能来自锁定骨架 allowedOutcomeIds。
4. 所有 evidence 必须逐字出现在修复后的正文。
5. 只输出 JSON，不要解释。`;
}

export function parseNodeCandidatePatch(text: string): NodeCandidatePatch {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PATCH_RESPONSE_INVALID");
  }
  return parsed as NodeCandidatePatch;
}
