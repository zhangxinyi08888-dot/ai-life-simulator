import { LifeEventSeed } from "../data/lifeEvents";
import { formatStoryContextPack, StoryContextPack } from "./storyContext";

function formatList(items: string[]): string {
  return items.map((item, index) => `  ${index + 1}. ${item}`).join("\n");
}

const directionChoiceRule = "\n- 生成 A/B/C 选项时，只有 state=stage_main_arc 或 long_term_main_arc 的方向可以成为职业、创业、重大转型方向\n- state=background_detail 的方向不得进入选项主语；state=side_thread 只能作为附带考虑；state=mentioned 不得主动出现在选项中";

function formatEventSpecificRules(event: LifeEventSeed): string {
  if (event.intent.type !== "health_system_warning") return "";

  return "\n- 健康预警事件中，高薪不是必然伤健康；只有在高强度、长期、无恢复机制时，收入选择才会显著损害健康\n- 渲染高收入选项时，不要默认写成“做到身体撑不住”，必须同时考虑工作强度、持续时间、休息安排、医疗/运动/睡眠等恢复策略";
}

export function buildEventIntentPrompt(event: LifeEventSeed, storyContext?: StoryContextPack): string {
  const contextPrompt = storyContext ? formatStoryContextPack(storyContext) : "";
  const answerRule = storyContext?.answerFacts.length
    ? "\n- 追问答案非空，本轮剧情必须至少显性使用 1 条追问答案中的事实或限制；不要机械复述原话，要转化成场景约束、人物反应、可选路径或心理惯性"
    : "";
  const eventSpecificRules = formatEventSpecificRules(event);

  return `${contextPrompt}\n\n【Event Intent】\ntype: ${event.intent.type}\nmeaning: ${event.intent.meaning}\ntensionAxes:\n${formatList(event.intent.tensionAxes)}\nallowedOutcomes:\n${formatList(event.intent.allowedOutcomes)}\nemotionalTone: ${event.intent.emotionalTone || "neutral"}\n\n请严格围绕该结构生成现实人生场景。\n要求：\n- 不要复述事件定义\n- 不要使用模板化灾难剧情\n- 不要使用事件库语言原句作为正文\n- 必须根据用户真实信息、追问补全信息、历史选择、当前属性、最近 5 个历史节点状态调整细节\n- 必须保持剧情延续性\n- 优先延续最近 5 个节点中已经出现的人、关系、职业状态、健康状态、财务状态，但人物必须随时间变化\n- 年龄只调整执行条件、风险和支持方式，不得删除学习、事业、创业、创作、旅行、研究等用户方向\n- Event 只提出阶段性压力，不能永久锁定 LifeIntensity，也不能修改 PressureArc phase\n- 每个非终章节点至少推进主事件 intent、延续一个 background thread、或从追问答案中转化一个现实限制/人物关系\n- 必须体现真实生活代价与选择\n- allowedOutcomes 是行动原语，不是选项文案；请将其渲染成自然、具体、符合上下文的用户选择${directionChoiceRule}${answerRule}${eventSpecificRules}`;
}

export function buildNullEventPrompt(storyContext?: StoryContextPack): string {
  const contextPrompt = storyContext ? formatStoryContextPack(storyContext) : "";
  const answerRule = storyContext?.answerFacts.length
    ? "\n- 追问答案非空，本轮剧情必须至少显性使用 1 条追问答案中的事实或限制"
    : "";

  return `${contextPrompt}\n\n【本轮没有强事件结构】\n请推进一段平稳但真实的人生日常：\n- 优先呈现用户上一选择的后果和仍在推进的人生方向\n- 保持和最近 5 个历史节点的延续性\n- 写出生活里的小变化、小压力、小选择\n- 可以延续一个轻量关系/亲情/生活副线，但不得取代用户当前主线\n- 不得因为年龄较高自动改写成退休、照护、回忆或传承；非终章仍然面向未来\n- 如果主线是学习、创业、写作、旅行或研究，继续推进该方向的日常后果\n- 可以呈现关系、工作、健康、财务或内心状态的微小变化\n- 不要强行制造事故、裁员、背叛、疾病或重大危机${directionChoiceRule}${answerRule}`;
}

export const buildEventSeedPrompt = buildEventIntentPrompt;
