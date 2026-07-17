import { LifeEventSeed } from "../data/lifeEvents";
import { formatStoryContextPack, StoryContextPack } from "./storyContext";

function formatList(items: string[]): string {
  return items.map((item, index) => `  ${index + 1}. ${item}`).join("\n");
}

const directionChoiceRule = "\n- 生成 A/B/C 选项时，只有 state=stage_main_arc 或 long_term_main_arc 的方向可以成为职业、创业、重大转型方向\n- state=background_detail 的方向不得进入选项主语；state=side_thread 只能作为附带考虑；state=mentioned 不得主动出现在选项中\n- state=cooldown 或 dormant 的 decisionIntent 不得再次进入 A/B/C，初始事实、追问答案和 background thread 都不能绕过冷却\n- 延续 background thread 是推进人物关系、压力或既有后果，不等于把用户未采纳的具体方案换一种文案再次提供";

function formatEventSpecificRules(event: LifeEventSeed): string {
  if (event.intent.type !== "health_system_warning" && event.intent.type !== "health_forced_pause") {
    return "";
  }

  const warningRecoveryRule = event.intent.type === "health_system_warning"
    ? "\n- 健康预警正文应说明当前风险和可调整因素；三个选项中至少一个应能实质改善恢复条件，但不得承诺健康立即回升，也不得把它写成唯一正确答案"
    : "";

  return `\n- 健康事件不得把继续事业目标等同于维持原有负荷，也不得把恢复健康等同于必须永久放弃工作；选项应包含调整负荷的中间路径，当健康风险、医疗建议或现实条件充分支持时，也允许暂停、离职或退出当前工作进行调养${warningRecoveryRule}`;
}

function formatNarrativeModeRules(event: LifeEventSeed): string {
  const rules: Record<LifeEventSeed["narrativeMode"], string> = {
    pressure_crisis: `
- 只使用事件已有事实，不得临时增加第二个无关危机
- 三个选项至少覆盖承受、调整、求助、退出、重组中的两种不同战略；不得都写成不同程度的继续坚持
- major crisis 必须服从已有 PressureArc 和节点密度限制`,
    crossroads_opportunity: `
- 每条路都要有现实收益和代价，至少两条路径改变不同世界状态或长期方向
- 不得把所有机会写成高风险押注；允许稳健转型、小规模试点、延迟承诺和阶段性尝试`,
    recovery_growth: `
- 正文必须明确引用至少一项已经满足 eligibility 的历史选择、经过时间、属性趋势或支持条件
- 允许部分改善、条件改善、能力形成或重新定向，不承诺完美成功
- 不得用新的无关重大危机抵消改善；选择应围绕巩固、调整、扩大或重新定义成果
- 三个选择不能全部是继续恢复、继续观察或继续休息`,
    stability_meaning: `
- 必须推进一项已有方向、关系、习惯、能力、信誉或生活安排，不得新增重大危机
- 至少形成一个后续可引用的具体变化，可通过 worldDeltas 或摘要表达
- 平稳不等于退休、回忆或被动等待；所有年龄都必须保持未来导向
- 三个选择不能全部保持现状，至少一个必须形成小幅、具体、可继续追踪的变化`
  };
  return `\n【${event.narrativeMode} 模式契约】${rules[event.narrativeMode]}`;
}

export function buildEventIntentPrompt(event: LifeEventSeed, storyContext?: StoryContextPack): string {
  const contextPrompt = storyContext ? formatStoryContextPack(storyContext) : "";
  const answerRule = storyContext?.answerFacts.length
    ? "\n- 追问答案非空，本轮剧情必须至少显性使用 1 条追问答案中的事实或限制；不要机械复述原话，要转化成场景约束、人物反应、可选路径或心理惯性"
    : "";
  const eventSpecificRules = formatEventSpecificRules(event);
  const narrativeModeRules = formatNarrativeModeRules(event);
  return `${contextPrompt}\n\n【Event Intent】\ntype: ${event.intent.type}\nmeaning: ${event.intent.meaning}\ntensionAxes:\n${formatList(event.intent.tensionAxes)}\nallowedOutcomes:\n${formatList(event.intent.allowedOutcomes)}\nemotionalTone: ${event.intent.emotionalTone || "neutral"}\n\n请严格围绕该结构生成现实人生场景。\n要求：\n- 不要复述事件定义\n- 不要使用模板化灾难剧情\n- 不要使用事件库语言原句作为正文\n- 必须根据用户真实信息、追问补全信息、历史选择、当前属性、最近 5 个历史节点状态调整细节\n- 必须保持剧情延续性\n- 优先延续最近 5 个节点中已经出现的人、关系、职业状态、健康状态、财务状态，但人物必须随时间变化\n- 年龄只调整执行条件、风险和支持方式，不得删除学习、事业、创业、创作、旅行、研究等用户方向\n- Event 只提出阶段性压力，不能永久锁定 LifeIntensity，也不能修改 PressureArc phase\n- 每个非终章节点至少推进主事件 intent、延续一个 background thread、或从追问答案中转化一个现实限制/人物关系\n- 必须体现现实条件、行动成本和真实反馈；改善必须来自已经发生的选择、投入、支持、能力、关系或资源变化\n- 不得为了维持戏剧性而立即用新的事故、背叛、疾病、失业或重大损失抵消已有改善\n- allowedOutcomes 是行动原语，不是选项文案；请将其渲染成自然、具体、符合上下文的用户选择\n- 每个 choice 必须返回 eventOutcomeId，且只能取自本事件 allowedOutcomes\n- 三个 choice 至少覆盖两个不同 eventOutcomeId，eventOutcomeId 不授权模型直接修改世界状态${narrativeModeRules}${directionChoiceRule}${answerRule}${eventSpecificRules}`;
}

export function buildNullEventPrompt(storyContext?: StoryContextPack): string {
  const contextPrompt = storyContext ? formatStoryContextPack(storyContext) : "";
  const answerRule = storyContext?.answerFacts.length
    ? "\n- 追问答案非空，本轮剧情必须至少显性使用 1 条追问答案中的事实或限制"
    : "";

  return `${contextPrompt}\n\n【本轮没有强事件结构】\n请推进一段平稳但真实的人生日常：\n- 优先呈现用户上一选择的后果和仍在推进的人生方向\n- 保持和最近 5 个历史节点的延续性\n- 写出生活里的小变化、小压力、小选择\n- 可以延续一个轻量关系/亲情/生活副线，但不得取代用户当前主线\n- 不得因为年龄较高自动改写成退休、照护、回忆或传承；非终章仍然面向未来\n- 如果主线是学习、创业、写作、旅行或研究，继续推进该方向的日常后果\n- 可以呈现关系、工作、健康、财务或内心状态的微小变化\n- 不要强行制造事故、裁员、背叛、疾病或重大危机${directionChoiceRule}${answerRule}`;
}

export const buildEventSeedPrompt = buildEventIntentPrompt;
