import "dotenv/config";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { callDeepSeekJson } from "../src/utils/deepseek";
import { generateNextNode, startSimulation } from "../src/services/simulation/simulationService";
import { createHistoryItemFromNode } from "../src/utils/historyRestore";
import { isValidRomanceDisplayName } from "../src/utils/romanceCandidateName";
import type {
  HistoryItem,
  QuestionTurn,
  SimulationChoice,
  SimulationNode,
  UserInitialData
} from "../src/types";

const requestedRoutes = Number(process.env.ROUTE_COUNT || process.argv[2] || 30);
const concurrency = Math.max(1, Number(process.env.ROUTE_CONCURRENCY || 2));
const maxDecisionCount = Math.max(12, Number(process.env.ROUTE_MAX_DECISIONS || 32));
const aiRequestTimeoutMs = Math.max(30_000, Number(process.env.ROUTE_AI_TIMEOUT_MS || 120_000));
const runId = process.env.ROUTE_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const recordRoot = path.resolve(
  process.env.ROUTE_RECORD_ROOT
    || `artifacts/relationship-lifecycle-real-ai/${runId}`
);
const resumeExistingRun = process.env.ROUTE_RESUME === "1";

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY 或 VITE_DEEPSEEK_API_KEY");
const baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.VITE_DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const model = process.env.DEEPSEEK_MODEL || process.env.VITE_DEEPSEEK_MODEL || "deepseek-v4-flash";
const callAiJson = async (prompt: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiRequestTimeoutMs);
  try {
    return await callDeepSeekJson({ apiKey, baseUrl, model }, prompt, fetch, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

interface Persona {
  slug: string;
  pressureDense?: boolean;
  userData: UserInitialData;
  answers: QuestionTurn[];
}

const personas: Persona[] = [
  {
    slug: "career-shanghai",
    userData: {
      birthday: "1998-05-15",
      birthtime: "09:00",
      gender: "女",
      currentSituation: "单身，在上海工作，没有确认伴侣，对自然认识新朋友持开放态度。",
      isReturnToPast: true,
      targetAgeNode: "职业方向",
      regressionNodeKey: "career",
      regressionAge: 24,
      regressionSituation: "在稳定运营岗位与年轻科技公司的产品岗位之间犹豫。",
      regressionChoices: "A. 加入年轻科技公司\nB. 留职学习产品与数据\nC. 继续稳定路线",
      coreStoryFocus: "career",
      milestones: [{ id: "career", title: "职业方向", content: "当时选择了稳定岗位。" }]
    },
    answers: [
      { id: 1, question: "现实约束是什么？", answer: "独自在上海租房，存款12万元，没有伴侣或家庭共同财务。" },
      { id: 2, question: "如何面对不确定性？", answer: "会先做预算和小规模验证，也愿意参加行业活动认识新朋友。" },
      { id: 3, question: "有哪些资源？", answer: "有运营经验、学习能力和少量行业朋友，但没有创业经验。" }
    ]
  },
  {
    slug: "career-hangzhou",
    userData: {
      birthday: "1995-02-08",
      birthtime: "13:00",
      gender: "男",
      currentSituation: "单身，在杭州做设计，没有现任伴侣，希望工作之外也有稳定生活。",
      isReturnToPast: true,
      targetAgeNode: "第一次跳槽",
      regressionNodeKey: "career",
      regressionAge: 26,
      regressionSituation: "在大公司稳定岗位和小团队主设计师机会之间选择。",
      regressionChoices: "A. 加入小团队\nB. 留职做个人项目\nC. 继续大公司晋升",
      coreStoryFocus: "career",
      milestones: [{ id: "career", title: "第一次跳槽", content: "为了稳定留在原公司。" }]
    },
    answers: [
      { id: 1, question: "现实约束是什么？", answer: "存款18万元，无负债、无伴侣，父母经济独立。" },
      { id: 2, question: "如何做选择？", answer: "倾向先试做再决定，不排斥通过朋友或兴趣活动认识对象。" },
      { id: 3, question: "有哪些资源？", answer: "有四年设计经验、作品集和几个可信赖的同行朋友。" }
    ]
  },
  {
    slug: "education-beijing",
    userData: {
      birthday: "2001-09-12",
      birthtime: "07:00",
      gender: "女",
      currentSituation: "单身，刚开始职业生涯，没有确认伴侣，对亲密关系不设固定时间表。",
      isReturnToPast: true,
      targetAgeNode: "大学专业",
      regressionNodeKey: "gaokao",
      regressionAge: 19,
      regressionSituation: "在家人建议的金融专业和喜欢的计算机方向之间犹豫。",
      regressionChoices: "A. 转向计算机\nB. 金融辅修计算机\nC. 继续金融",
      coreStoryFocus: "career",
      milestones: [{ id: "gaokao", title: "大学专业", content: "选择了更稳妥的专业。" }]
    },
    answers: [
      { id: 1, question: "现实约束是什么？", answer: "家庭支持国内学费，个人没有负债，也没有伴侣。" },
      { id: 2, question: "如何应对压力？", answer: "会拆成小目标，但成绩落后时容易怀疑自己。" },
      { id: 3, question: "有哪些资源？", answer: "学过网页制作，有同学愿意一起做项目，也愿意参加社团。" }
    ]
  },
  {
    slug: "venture-shenzhen",
    pressureDense: true,
    userData: {
      birthday: "1991-11-03",
      birthtime: "17:00",
      gender: "男",
      currentSituation: "单身，在深圳做供应链产品，没有确认伴侣，生活重心偏工作但愿意发展关系。",
      isReturnToPast: true,
      targetAgeNode: "创业机会",
      regressionNodeKey: "career",
      regressionAge: 30,
      regressionSituation: "发现制造企业的软件需求，在辞职创业和留职验证之间犹豫。",
      regressionChoices: "A. 辞职创业\nB. 周末验证需求\nC. 做成公司内部业务",
      coreStoryFocus: "career",
      milestones: [{ id: "career", title: "创业机会", content: "当时没有迈出创业一步。" }]
    },
    answers: [
      { id: 1, question: "现实约束是什么？", answer: "有35万元备用金和房贷，但没有伴侣或共同财务。" },
      { id: 2, question: "如何面对风险？", answer: "会先找付费客户验证，工作忙时容易忽略社交。" },
      { id: 3, question: "有哪些资源？", answer: "有八年产品经验和潜在客户，也有固定运动社群。" }
    ]
  },
  {
    slug: "balance-chengdu",
    pressureDense: true,
    userData: {
      birthday: "1997-04-20",
      birthtime: "05:00",
      gender: "女",
      currentSituation: "单身，在成都做咨询，没有确认伴侣，希望重新安排工作与生活。",
      isReturnToPast: true,
      targetAgeNode: "工作节奏",
      regressionNodeKey: "career",
      regressionAge: 27,
      regressionSituation: "连续加班后，在继续争取晋升和重建生活节奏之间犹豫。",
      regressionChoices: "A. 暂停晋升重建节奏\nB. 组建团队继续竞争\nC. 换到稳定岗位",
      coreStoryFocus: "career",
      milestones: [{ id: "career", title: "工作节奏", content: "长期把工作放在生活之前。" }]
    },
    answers: [
      { id: 1, question: "现实约束是什么？", answer: "存款25万元，无负债、无伴侣，可以承受短期收入下降。" },
      { id: 2, question: "如何面对压力？", answer: "习惯靠完成任务缓解焦虑，需要主动恢复社交和运动。" },
      { id: 3, question: "有哪些资源？", answer: "有专业能力、朋友支持和请短假的条件。" }
    ]
  }
];

function pickChoice(node: SimulationNode): SimulationChoice | undefined {
  const eventId = node.eventMeta?.eventId;
  const preferredOutcome = eventId === "romance_new_connection"
    ? "continue_getting_to_know"
    : eventId === "romance_connection_clarification" || eventId === "romance_exploration_resolution"
      ? "begin_mutual_dating"
      : eventId === "relationship_material_commitment_test"
        ? "delay_with_clear_conditions"
        : eventId === "relationship_commitment_resolution"
          ? "make_shared_commitment_plan"
          : undefined;
  if (preferredOutcome) {
    const exact = node.choices.find((choice) => choice.eventOutcomeId === preferredOutcome);
    if (exact) return exact;
  }
  return [...node.choices].sort((left, right) => {
    const score = (choice: SimulationChoice) => {
      const intensity = choice.temporalHint?.lifeIntensity;
      const calm = intensity === "normal" ? 30 : intensity === "stable" ? 20 : 0;
      const social = /社交|朋友|活动|生活|关系|共同|认识/.test(choice.text) ? 5 : 0;
      return calm + social + (choice.temporalHint?.durationMonths?.[1] || 0) / 100;
    };
    return score(right) - score(left);
  })[0];
}

function activeRomanticIdentity(node: SimulationNode): { personId?: string; displayName?: string } {
  const world = node.worldStateSnapshot;
  const relationship = world?.relationships?.find((item) => (
    item.type === "romantic" && ["active", "strained"].includes(item.status)
  ));
  const personId = relationship?.participantPersonIds[0];
  const person = world?.people.find((item) => item.id === personId);
  return { personId, displayName: person?.displayName };
}

interface RouteRecord {
  slug: string;
  persona: string;
  simulationSeed: string;
  startedAt: string;
  completedAt?: string;
  complete: boolean;
  stopReason?: string;
  history: HistoryItem[];
  currentNode: SimulationNode;
  metrics: {
    encounterAgeInMonths?: number;
    developmentEncounterAgeInMonths?: number;
    firstConfirmationAgeInMonths?: number;
    firstConfirmationWaitMonths?: number;
    datingStartedAtAgeInMonths?: number;
    explorationTotalMonths?: number;
    firstCommitmentReviewAgeInMonths?: number;
    commitmentWaitMonths?: number;
    commitmentResolutionAgeInMonths?: number;
    commitmentResolutionWaitMonths?: number;
    fallbackCount: number;
    lineFallbackCount: number;
    romanceFallbackCount: number;
    checkpointObservedCount: number;
    checkpointDeferredCount: number;
    checkpointMaxDeferredCount: number;
    checkpointMaxOverdueMonths: number;
    checkpointKeyMissingCount: number;
    checkpointBoundViolationCount: number;
    mustRestoreObservedCount: number;
    pressureInterleaveCount: number;
    overdueCount: number;
    relationshipFollowUpCount: number;
    generationErrorCount: number;
    generationRetryRecoveredCount: number;
    generationPaused: boolean;
    personIds: string[];
    displayNames: string[];
    identityDrift: boolean;
    invalidRomanceDisplayNameCount: number;
    keepAsAcquaintanceSelected: boolean;
    keepAsAcquaintanceAtAgeInMonths?: number;
    reencounterAfterKeep: boolean;
  };
  errors: string[];
}

async function runRoute(index: number): Promise<RouteRecord> {
  const persona = personas[index % personas.length];
  const slug = `${String(index + 1).padStart(2, "0")}-${persona.slug}`;
  const simulationSeed = `${runId}:${slug}`;
  const startedAt = new Date().toISOString();
  const start = await startSimulation(persona.userData, persona.answers, { callAiJson });
  let currentNode = start.startNode;
  let currentAttributes = start.initialAttributes;
  const history: HistoryItem[] = [];
  const errors: string[] = [];
  const personIds = new Set<string>();
  const displayNames = new Set<string>();
  let encounterAgeInMonths: number | undefined;
  let developmentEncounterAgeInMonths: number | undefined;
  let firstConfirmationAgeInMonths: number | undefined;
  let datingStartedAtAgeInMonths: number | undefined;
  let firstCommitmentReviewAgeInMonths: number | undefined;
  let commitmentResolutionAgeInMonths: number | undefined;
  let fallbackCount = 0;
  let lineFallbackCount = 0;
  let romanceFallbackCount = 0;
  let checkpointObservedCount = 0;
  let checkpointDeferredCount = 0;
  let checkpointMaxDeferredCount = 0;
  let checkpointMaxOverdueMonths = 0;
  let checkpointKeyMissingCount = 0;
  let checkpointBoundViolationCount = 0;
  let mustRestoreObservedCount = 0;
  let pressureInterleaveCount = 0;
  let overdueCount = 0;
  let relationshipFollowUpCount = 0;
  let generationErrorCount = 0;
  let generationRetryRecoveredCount = 0;
  let invalidRomanceDisplayNameCount = 0;
  const shouldKeepFirstEncounter = index % 5 === 0;
  let keepAsAcquaintanceSelected = false;
  let keepAsAcquaintanceAtAgeInMonths: number | undefined;
  let reencounterAfterKeep = false;
  let stopReason = "decision_limit";

  for (let decision = 0; decision < maxDecisionCount; decision += 1) {
    const eventMeta = currentNode.eventMeta;
    if (eventMeta?.eventId === "romance_new_connection" && encounterAgeInMonths === undefined) {
      encounterAgeInMonths = currentNode.ageInMonths;
    }
    if (
      eventMeta?.eventId === "romance_new_connection"
      && keepAsAcquaintanceAtAgeInMonths !== undefined
      && currentNode.ageInMonths > keepAsAcquaintanceAtAgeInMonths
    ) {
      reencounterAfterKeep = true;
    }
    if (
      ["romance_connection_clarification", "romance_exploration_resolution"].includes(eventMeta?.eventId || "")
      && firstConfirmationAgeInMonths === undefined
    ) {
      firstConfirmationAgeInMonths = currentNode.ageInMonths;
    }
    if (eventMeta?.eventId === "relationship_material_commitment_test" && firstCommitmentReviewAgeInMonths === undefined) {
      firstCommitmentReviewAgeInMonths = currentNode.ageInMonths;
    }
    if (eventMeta?.eventId === "relationship_commitment_resolution") {
      commitmentResolutionAgeInMonths = currentNode.ageInMonths;
    }
    if (eventMeta?.fallbackReason || eventMeta?.romanceRescheduled) fallbackCount += 1;
    if (eventMeta?.lineFallbackReason) lineFallbackCount += 1;
    if (
      eventMeta?.romanceRescheduled
      || eventMeta?.romanceRescheduleFulfilled
      || eventMeta?.romanceRepairAttempted
      || eventMeta?.requestedEventId?.startsWith("romance_")
    ) romanceFallbackCount += 1;
    if (eventMeta?.relationshipCheckpointStatus) checkpointObservedCount += 1;
    if (eventMeta?.relationshipCheckpointStatus && !eventMeta.relationshipCheckpointKey) checkpointKeyMissingCount += 1;
    if (eventMeta?.relationshipCheckpointDeferred) {
      checkpointDeferredCount += 1;
      checkpointMaxDeferredCount = Math.max(
        checkpointMaxDeferredCount,
        eventMeta.relationshipCheckpointDeferredCount || 0
      );
    }
    if (eventMeta?.relationshipCheckpointMustRestore) mustRestoreObservedCount += 1;
    if (eventMeta?.pressureArcInterleaved) pressureInterleaveCount += 1;
    if (eventMeta?.relationshipCheckpointStatus === "overdue") overdueCount += 1;
    if (
      eventMeta?.relationshipCheckpointStatus === "overdue"
      && Number.isFinite(eventMeta.relationshipCheckpointMaxAtAgeInMonths)
    ) {
      checkpointMaxOverdueMonths = Math.max(
        checkpointMaxOverdueMonths,
        currentNode.ageInMonths - eventMeta.relationshipCheckpointMaxAtAgeInMonths!
      );
    }
    if (
      (eventMeta?.relationshipCheckpointDeferredCount || 0) > 3
      || (
        eventMeta?.selectionKind === "relationship_follow_up"
        && Number.isFinite(eventMeta.relationshipCheckpointMaxAtAgeInMonths)
        && currentNode.ageInMonths > eventMeta.relationshipCheckpointMaxAtAgeInMonths! + 1
      )
    ) checkpointBoundViolationCount += 1;
    if (eventMeta?.selectionKind === "relationship_follow_up") relationshipFollowUpCount += 1;

    const identity = activeRomanticIdentity(currentNode);
    if (identity.personId) personIds.add(identity.personId);
    if (identity.displayName) displayNames.add(identity.displayName);
    const formationCandidate = eventMeta?.eventId === "romance_new_connection"
      ? currentNode.narrativeMeta?.activeCharacters?.find((character) => character.candidateOrdinal === 0)
      : undefined;
    if (
      (identity.displayName && !isValidRomanceDisplayName(identity.displayName))
      || (formationCandidate && !isValidRomanceDisplayName(formationCandidate.displayName))
    ) invalidRomanceDisplayNameCount += 1;
    const activeRelationship = currentNode.worldStateSnapshot?.relationships?.find((relationship) => (
      relationship.type === "romantic" && ["active", "strained"].includes(relationship.status)
    ));
    if (activeRelationship?.stage === "dating" && datingStartedAtAgeInMonths === undefined) {
      datingStartedAtAgeInMonths = activeRelationship.progression?.startedAtAgeInMonths || currentNode.ageInMonths;
    }

    if (commitmentResolutionAgeInMonths !== undefined) {
      stopReason = "commitment_resolution_reached";
      break;
    }
    if (currentNode.isEndingNode) {
      stopReason = "ending_reached";
      break;
    }
    if (currentNode.ageInMonths >= 65 * 12) {
      stopReason = "age_65_reached";
      break;
    }
    const choice = shouldKeepFirstEncounter
      && eventMeta?.eventId === "romance_new_connection"
      && !keepAsAcquaintanceSelected
      ? currentNode.choices.find((candidate) => candidate.eventOutcomeId === "keep_as_acquaintance")
      : pickChoice(currentNode);
    if (!choice) {
      stopReason = "no_choice";
      break;
    }
    if (eventMeta?.eventId === "romance_new_connection") {
      if (choice.eventOutcomeId === "keep_as_acquaintance") {
        keepAsAcquaintanceSelected = true;
        keepAsAcquaintanceAtAgeInMonths = currentNode.ageInMonths;
      } else if (choice.eventOutcomeId === "continue_getting_to_know" && developmentEncounterAgeInMonths === undefined) {
        developmentEncounterAgeInMonths = currentNode.ageInMonths;
      }
    }
    const historyItem = createHistoryItemFromNode(currentNode, choice.text);
    history.push(historyItem);
    const generationInput = {
        userData: persona.userData,
        answers: persona.answers,
        history,
        currentAttributes,
        selectedDecision: choice.text,
        nodeIndex: history.length,
        simulationSeed
      };
    try {
      currentNode = await generateNextNode(generationInput, { callAiJson });
      currentAttributes = currentNode.attributes;
    } catch (error) {
      generationErrorCount += 1;
      errors.push(`initial: ${error instanceof Error ? error.message : String(error)}`);
      try {
        currentNode = await generateNextNode(generationInput, { callAiJson });
        currentAttributes = currentNode.attributes;
        generationRetryRecoveredCount += 1;
      } catch (retryError) {
        generationErrorCount += 1;
        errors.push(`retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        stopReason = "generation_error";
        break;
      }
    }
  }

  const record: RouteRecord = {
    slug,
    persona: persona.slug,
    simulationSeed,
    startedAt,
    completedAt: new Date().toISOString(),
    complete: true,
    stopReason,
    history,
    currentNode,
    metrics: {
      encounterAgeInMonths,
      developmentEncounterAgeInMonths,
      firstConfirmationAgeInMonths,
      firstConfirmationWaitMonths: developmentEncounterAgeInMonths !== undefined && firstConfirmationAgeInMonths !== undefined
        ? firstConfirmationAgeInMonths - developmentEncounterAgeInMonths
        : undefined,
      datingStartedAtAgeInMonths,
      explorationTotalMonths: developmentEncounterAgeInMonths !== undefined && datingStartedAtAgeInMonths !== undefined
        ? datingStartedAtAgeInMonths - developmentEncounterAgeInMonths
        : undefined,
      firstCommitmentReviewAgeInMonths,
      commitmentWaitMonths: datingStartedAtAgeInMonths !== undefined && firstCommitmentReviewAgeInMonths !== undefined
        ? firstCommitmentReviewAgeInMonths - datingStartedAtAgeInMonths
        : undefined,
      commitmentResolutionAgeInMonths,
      commitmentResolutionWaitMonths: datingStartedAtAgeInMonths !== undefined && commitmentResolutionAgeInMonths !== undefined
        ? commitmentResolutionAgeInMonths - datingStartedAtAgeInMonths
        : undefined,
      fallbackCount,
      lineFallbackCount,
      romanceFallbackCount,
      checkpointObservedCount,
      checkpointDeferredCount,
      checkpointMaxDeferredCount,
      checkpointMaxOverdueMonths,
      checkpointKeyMissingCount,
      checkpointBoundViolationCount,
      mustRestoreObservedCount,
      pressureInterleaveCount,
      overdueCount,
      relationshipFollowUpCount,
      generationErrorCount,
      generationRetryRecoveredCount,
      generationPaused: stopReason === "generation_error",
      personIds: [...personIds],
      displayNames: [...displayNames],
      identityDrift: personIds.size > 1 || displayNames.size > 1,
      invalidRomanceDisplayNameCount,
      keepAsAcquaintanceSelected,
      keepAsAcquaintanceAtAgeInMonths,
      reencounterAfterKeep
    },
    errors
  };
  await writeFile(path.join(recordRoot, "cases", `${slug}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function quantile(values: number[], ratio: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function average(values: number[]): number | undefined {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : undefined;
}

function summarize(records: RouteRecord[]) {
  const encounterAges = records.flatMap((record) => record.metrics.encounterAgeInMonths === undefined ? [] : [record.metrics.encounterAgeInMonths]);
  const confirmationWaits = records.flatMap((record) => record.metrics.firstConfirmationWaitMonths === undefined ? [] : [record.metrics.firstConfirmationWaitMonths]);
  const explorationDurations = records.flatMap((record) => record.metrics.explorationTotalMonths === undefined ? [] : [record.metrics.explorationTotalMonths]);
  const commitmentWaits = records.flatMap((record) => record.metrics.commitmentWaitMonths === undefined ? [] : [record.metrics.commitmentWaitMonths]);
  const resolutionWaits = records.flatMap((record) => record.metrics.commitmentResolutionWaitMonths === undefined ? [] : [record.metrics.commitmentResolutionWaitMonths]);
  const routeNodes = (record: RouteRecord) => [...record.history, record.currentNode];
  const hasForcedDeferral = (
    record: RouteRecord,
    checkpointKind: "exploration_review" | "commitment_review"
  ) => routeNodes(record).some((node) => (
    node.eventMeta?.relationshipCheckpointDeferred
    && node.eventMeta.relationshipCheckpointKind === checkpointKind
  ));
  const uninterruptedConfirmationWaits = records.flatMap((record) => (
    record.metrics.firstConfirmationWaitMonths === undefined || hasForcedDeferral(record, "exploration_review")
      ? []
      : [record.metrics.firstConfirmationWaitMonths]
  ));
  const uninterruptedResolutionWaits = records.flatMap((record) => (
    record.metrics.commitmentResolutionWaitMonths === undefined || hasForcedDeferral(record, "commitment_review")
      ? []
      : [record.metrics.commitmentResolutionWaitMonths]
  ));
  const generatedNodeCount = records.reduce((sum, record) => sum + routeNodes(record).length, 0);
  const allFallbackCount = records.reduce((sum, record) => sum + record.metrics.fallbackCount, 0);
  const lineFallbackCount = records.reduce((sum, record) => sum + record.metrics.lineFallbackCount, 0);
  const romanceFallbackCount = records.reduce((sum, record) => sum + record.metrics.romanceFallbackCount, 0);
  return {
    runId,
    dataSource: "real_ai_direct",
    requestedRoutes,
    completedRoutes: records.length,
    definitions: {
      routeStop: `commitment resolution, ending, age 65, generation error, or ${maxDecisionCount} decisions`,
      encounterAge: "age at first romance_new_connection",
      firstConfirmationWait: "months from the accepted continue_getting_to_know encounter to first clarification/resolution checkpoint",
      explorationTotal: "months from accepted continue_getting_to_know encounter to authoritative dating start",
      commitmentWait: "months from dating start to first material commitment review",
      commitmentResolutionWait: "months from dating start to forced commitment resolution after one delay",
      pressureDenseRoute: "persona explicitly marked pressureDense in the current collector"
    },
    coverage: {
      encounterCount: encounterAges.length,
      confirmationCount: confirmationWaits.length,
      commitmentReviewCount: commitmentWaits.length,
      commitmentResolutionCount: resolutionWaits.length
    },
    encounterAgeMonths: {
      average: average(encounterAges),
      p50: quantile(encounterAges, 0.5),
      p90: quantile(encounterAges, 0.9),
      min: encounterAges.length ? Math.min(...encounterAges) : undefined,
      max: encounterAges.length ? Math.max(...encounterAges) : undefined
    },
    firstConfirmationWaitMonths: {
      average: average(confirmationWaits),
      p50: quantile(confirmationWaits, 0.5),
      p90: quantile(confirmationWaits, 0.9),
      max: confirmationWaits.length ? Math.max(...confirmationWaits) : undefined
    },
    explorationTotalMonths: {
      average: average(explorationDurations),
      p50: quantile(explorationDurations, 0.5),
      p90: quantile(explorationDurations, 0.9),
      max: explorationDurations.length ? Math.max(...explorationDurations) : undefined
    },
    commitmentWaitMonths: {
      average: average(commitmentWaits),
      p50: quantile(commitmentWaits, 0.5),
      p90: quantile(commitmentWaits, 0.9),
      max: commitmentWaits.length ? Math.max(...commitmentWaits) : undefined
    },
    commitmentResolutionWaitMonths: {
      average: average(resolutionWaits),
      p50: quantile(resolutionWaits, 0.5),
      p90: quantile(resolutionWaits, 0.9),
      max: resolutionWaits.length ? Math.max(...resolutionWaits) : undefined
    },
    uninterruptedLifecycle: {
      definition: "checkpoint phase had no forced event carrying relationshipCheckpointDeferred",
      confirmationCount: uninterruptedConfirmationWaits.length,
      firstConfirmationWaitMonths: {
        average: average(uninterruptedConfirmationWaits),
        p50: quantile(uninterruptedConfirmationWaits, 0.5),
        p90: quantile(uninterruptedConfirmationWaits, 0.9),
        max: uninterruptedConfirmationWaits.length ? Math.max(...uninterruptedConfirmationWaits) : undefined
      },
      commitmentResolutionCount: uninterruptedResolutionWaits.length,
      commitmentResolutionWaitMonths: {
        average: average(uninterruptedResolutionWaits),
        p50: quantile(uninterruptedResolutionWaits, 0.5),
        p90: quantile(uninterruptedResolutionWaits, 0.9),
        max: uninterruptedResolutionWaits.length ? Math.max(...uninterruptedResolutionWaits) : undefined
      }
    },
    fallback: {
      generatedNodeCount,
      allCount: allFallbackCount,
      allRouteCount: records.filter((record) => record.metrics.fallbackCount > 0).length,
      allNodeRatio: generatedNodeCount > 0 ? allFallbackCount / generatedNodeCount : 0,
      lineCount: lineFallbackCount,
      lineNodeRatio: generatedNodeCount > 0 ? lineFallbackCount / generatedNodeCount : 0,
      romanceCount: romanceFallbackCount,
      romanceRouteCount: records.filter((record) => record.metrics.romanceFallbackCount > 0).length,
      romanceNodeRatio: generatedNodeCount > 0 ? romanceFallbackCount / generatedNodeCount : 0
    },
    overdue: {
      count: records.reduce((sum, record) => sum + record.metrics.overdueCount, 0),
      routeCount: records.filter((record) => record.metrics.overdueCount > 0).length,
      checkpointObservedCount: records.reduce((sum, record) => sum + record.metrics.checkpointObservedCount, 0),
      forcedDeferralCount: records.reduce((sum, record) => sum + record.metrics.checkpointDeferredCount, 0),
      forcedDeferralRouteCount: records.filter((record) => record.metrics.checkpointDeferredCount > 0).length,
      ratio: records.reduce((sum, record) => sum + record.metrics.checkpointObservedCount, 0) > 0
        ? records.reduce((sum, record) => sum + record.metrics.overdueCount, 0)
          / records.reduce((sum, record) => sum + record.metrics.checkpointObservedCount, 0)
        : 0
    },
    checkpointRestoration: {
      maxConsecutiveDeferredNodes: records.length
        ? Math.max(...records.map((record) => record.metrics.checkpointMaxDeferredCount))
        : 0,
      maxOverdueMonths: records.length
        ? Math.max(...records.map((record) => record.metrics.checkpointMaxOverdueMonths))
        : 0,
      checkpointKeyMissingCount: records.reduce((sum, record) => sum + record.metrics.checkpointKeyMissingCount, 0),
      boundViolationCount: records.reduce((sum, record) => sum + record.metrics.checkpointBoundViolationCount, 0),
      mustRestoreObservedCount: records.reduce((sum, record) => sum + record.metrics.mustRestoreObservedCount, 0),
      pressureInterleaveCount: records.reduce((sum, record) => sum + record.metrics.pressureInterleaveCount, 0)
    },
    pressureDense: {
      routeCount: records.filter((record) => personas.find((persona) => persona.slug === record.persona)?.pressureDense).length,
      pausedRouteCount: records.filter((record) => (
        personas.find((persona) => persona.slug === record.persona)?.pressureDense
        && record.metrics.generationPaused
      )).length,
      boundViolationCount: records.filter((record) => (
        personas.find((persona) => persona.slug === record.persona)?.pressureDense
      )).reduce((sum, record) => sum + record.metrics.checkpointBoundViolationCount, 0)
    },
    keepAsAcquaintance: {
      selectedRouteCount: records.filter((record) => record.metrics.keepAsAcquaintanceSelected).length,
      reencounterRouteCount: records.filter((record) => record.metrics.reencounterAfterKeep).length,
      reencounterRate: records.some((record) => record.metrics.keepAsAcquaintanceSelected)
        ? records.filter((record) => record.metrics.reencounterAfterKeep).length
          / records.filter((record) => record.metrics.keepAsAcquaintanceSelected).length
        : 0
    },
    generation: {
      pausedRouteCount: records.filter((record) => record.metrics.generationPaused).length,
      errorCount: records.reduce((sum, record) => sum + record.metrics.generationErrorCount, 0),
      retryRecoveredCount: records.reduce((sum, record) => sum + record.metrics.generationRetryRecoveredCount, 0)
    },
    identityDriftRouteCount: records.filter((record) => record.metrics.identityDrift).length,
    invalidRomanceDisplayNameCount: records.reduce(
      (sum, record) => sum + (record.metrics.invalidRomanceDisplayNameCount || 0),
      0
    ),
    stopReasons: Object.fromEntries([...new Set(records.map((record) => record.stopReason))].map((reason) => [
      reason,
      records.filter((record) => record.stopReason === reason).length
    ]))
  };
}

async function main() {
  await mkdir(path.join(recordRoot, "cases"), { recursive: true });
  const manifestPath = path.join(recordRoot, "manifest.json");
  const priorManifest = resumeExistingRun
    ? JSON.parse(await readFile(manifestPath, "utf8")) as { startedAt?: string }
    : undefined;
  const batchStartedAt = priorManifest?.startedAt || new Date().toISOString();
  if (!resumeExistingRun) {
    await writeFile(manifestPath, `${JSON.stringify({
      runId,
      dataSource: "real_ai_direct",
      model,
      requestedRoutes,
      concurrency,
      maxDecisionCount,
      aiRequestTimeoutMs,
      startedAt: batchStartedAt
    }, null, 2)}\n`, "utf8");
  }

  const records: RouteRecord[] = resumeExistingRun
    ? await Promise.all(
        (await readdir(path.join(recordRoot, "cases")))
          .filter((name) => /^\d{2}-.+\.json$/.test(name))
          .map(async (name) => JSON.parse(
            await readFile(path.join(recordRoot, "cases", name), "utf8")
          ) as RouteRecord)
      )
    : [];
  const completedIndexes = new Set(records.map((record) => Number(record.slug.slice(0, 2)) - 1));
  const pendingIndexes = Array.from({ length: requestedRoutes }, (_, index) => index)
    .filter((index) => !completedIndexes.has(index));
  let cursor = 0;
  async function worker(workerIndex: number) {
    while (cursor < pendingIndexes.length) {
      const index = pendingIndexes[cursor];
      cursor += 1;
      try {
        const record = await runRoute(index);
        records.push(record);
        console.log(JSON.stringify({
          type: "route_complete",
          worker: workerIndex,
          index: index + 1,
          slug: record.slug,
          stopReason: record.stopReason,
          historyLength: record.history.length,
          metrics: record.metrics
        }));
      } catch (error) {
        console.error(JSON.stringify({
          type: "route_failed_to_start",
          worker: workerIndex,
          index: index + 1,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
  records.sort((left, right) => left.slug.localeCompare(right.slug));
  const summary = summarize(records);
  await writeFile(path.join(recordRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify({
    runId,
    dataSource: "real_ai_direct",
    model,
    requestedRoutes,
    completedRoutes: records.length,
    concurrency,
    maxDecisionCount,
    aiRequestTimeoutMs,
    startedAt: batchStartedAt,
    completedAt: new Date().toISOString(),
    summaryPath: path.join(recordRoot, "summary.json")
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ type: "batch_complete", recordRoot, summary }));
}

async function replayFailure(casePath: string) {
  const record = JSON.parse(await readFile(path.resolve(casePath), "utf8")) as RouteRecord;
  const persona = personas.find((candidate) => candidate.slug === record.persona);
  const configuredHistoryIndex = process.env.ROUTE_REPLAY_HISTORY_INDEX;
  const historyIndex = configuredHistoryIndex === undefined
    ? record.history.length - 1
    : Number(configuredHistoryIndex);
  const selectedHistoryItem = record.history[historyIndex];
  if (!persona || !selectedHistoryItem) throw new Error("重放记录缺少 persona 或已选择历史节点");
  const replayHistory = record.history.slice(0, historyIndex + 1);
  const nextNode = await generateNextNode({
    userData: persona.userData,
    answers: persona.answers,
    history: replayHistory,
    currentAttributes: selectedHistoryItem.attributes,
    selectedDecision: selectedHistoryItem.selectedChoice,
    nodeIndex: replayHistory.length,
    simulationSeed: record.simulationSeed
  }, { callAiJson });
  const replayPath = path.resolve(process.env.ROUTE_REPLAY_OUTPUT || `${casePath}.replay.json`);
  await writeFile(replayPath, `${JSON.stringify({
    dataSource: "real_ai_direct",
    sourceCase: path.resolve(casePath),
    replayedAt: new Date().toISOString(),
    historyIndex,
    selectedDecision: selectedHistoryItem.selectedChoice,
    nextNode
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    type: "replay_complete",
    replayPath,
    eventId: nextNode.eventMeta?.eventId,
    selectionKind: nextNode.eventMeta?.selectionKind,
    relationshipCheckpointDeferred: nextNode.eventMeta?.relationshipCheckpointDeferred,
    relationshipCheckpointStatus: nextNode.eventMeta?.relationshipCheckpointStatus,
    choiceCount: nextNode.choices.length
  }));
}

if (process.env.ROUTE_REPLAY_CASE) {
  await replayFailure(process.env.ROUTE_REPLAY_CASE);
} else {
  await main();
}
