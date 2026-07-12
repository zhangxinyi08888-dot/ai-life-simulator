import { DirectionArc, HistoryItem, LifeAttributes, LifeStage, PersonState, UserInitialData } from "../types";
import { deriveLifeStage, formatAgeInMonths } from "./timelineAdvance";

export interface AgeContext {
  currentAge: number;
  previousAge?: number;
  currentAgeInMonths: number;
  previousAgeInMonths?: number;
  elapsedMonths: number;
  elapsedYears: number;
  lifeStage: LifeStage;
  activeAgencyDirections: string[];
  executionAdaptations: string[];
  supportFactors: string[];
  healthAndRecoveryContext: string[];
  timeTransitionRequirements: string[];
  hardConstraints: string[];
  probabilityNotes: string[];
  exceptionalFacts: string[];
}

function directionSummaries(userData: Partial<UserInitialData>, arcs: DirectionArc[]): string[] {
  const values = arcs.filter((arc) => arc.status === "active").map((arc) => arc.summary);
  if (userData.regressionChoices) values.push(userData.regressionChoices);
  return [...new Set(values.filter(Boolean))];
}

export function buildAgeContext(input: {
  previousAgeInMonths?: number;
  targetAgeInMonths: number;
  attributes: LifeAttributes;
  userData: Partial<UserInitialData>;
  history: HistoryItem[];
  people: PersonState[];
  directionArcs?: DirectionArc[];
}): AgeContext {
  const currentAge = Math.floor(input.targetAgeInMonths / 12);
  const previousAge = typeof input.previousAgeInMonths === "number" ? Math.floor(input.previousAgeInMonths / 12) : undefined;
  const elapsedMonths = typeof input.previousAgeInMonths === "number" ? Math.max(0, input.targetAgeInMonths - input.previousAgeInMonths) : 0;
  const lifeStage = deriveLifeStage(currentAge);
  const activeAgencyDirections = directionSummaries(input.userData, input.directionArcs || []);
  const executionAdaptations: string[] = [];
  const supportFactors: string[] = [];
  const hardConstraints = [
    `本轮目标时间必须是${formatAgeInMonths(input.targetAgeInMonths)}。`,
    "年龄只约束执行条件，不得替换用户仍在推进的人生愿望。"
  ];

  if (currentAge < 18) executionAdaptations.push("遵守未成年人法律、监护和教育边界，但不要抹去用户的主动选择。");
  if (currentAge >= 65) executionAdaptations.push("可以继续学习、创业、创作、旅行和研究；只需结合健康、负荷、协作与支持条件调整执行方式。");
  if (input.attributes.health < 45) executionAdaptations.push("当前健康偏低，高强度行动需要恢复、医疗、睡眠、运动或协作机制。");
  if (input.attributes.relation >= 70) supportFactors.push("当前关系支持网络较强，可以成为执行计划的保护因素。");
  if (input.attributes.relation < 30) supportFactors.push("当前关系支持较弱，长期行动需要补充现实支持来源。");

  for (const person of input.people) {
    if (person.lifeStatus === "deceased") {
      hardConstraints.push(`${person.displayName || person.relation}已故，只能通过回忆、遗物、纪念或长期影响出现。`);
    }
    if ((person.relation === "parent" || person.relation === "grandparent") && person.estimatedAgeRange?.[0] && person.estimatedAgeRange[0] >= 105 && person.lifeStatus === "unknown") {
      hardConstraints.push(`${person.relation}估算年龄已达${person.estimatedAgeRange[0]}岁以上，不能默认仍在工作或日常活跃；如无明确长寿事实，应改为回忆、间接消息或已故影响。`);
    }
  }

  return {
    currentAge,
    previousAge,
    currentAgeInMonths: input.targetAgeInMonths,
    previousAgeInMonths: input.previousAgeInMonths,
    elapsedMonths,
    elapsedYears: elapsedMonths / 12,
    lifeStage,
    activeAgencyDirections,
    executionAdaptations,
    supportFactors,
    healthAndRecoveryContext: [`health=${input.attributes.health}`, `relation=${input.attributes.relation}`],
    timeTransitionRequirements: elapsedMonths >= 24 ? ["正文至少体现一项人物、工作、家庭、财务或健康状态的时间变化。"] : [],
    hardConstraints,
    probabilityNotes: ["少见不等于错误；45岁读书、55岁创业、70岁写书、80岁旅行、90岁研究均可成立。"],
    exceptionalFacts: []
  };
}

export function formatAgeContextForPrompt(context: AgeContext): string {
  const list = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- 暂无";
  return `【当前年龄与世界状态】
- 当前时间：${context.previousAgeInMonths == null ? "起点" : formatAgeInMonths(context.previousAgeInMonths)}
- 本轮经过：${context.elapsedMonths}个月
- 目标时间：${formatAgeInMonths(context.currentAgeInMonths)}
- chronologicalBand：${context.lifeStage}（只提供现实背景，不分配人生任务）

【用户当前仍在选择的人生方向】
${list(context.activeAgencyDirections)}

【执行条件与支持】
${list([...context.executionAdaptations, ...context.supportFactors])}

【时间硬约束】
${list(context.hardConstraints)}

【现实概率备注】
${list(context.probabilityNotes)}`;
}
