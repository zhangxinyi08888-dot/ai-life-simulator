import type { EventMeta, HistoryItem, LifeAttributes, LifeEventCategory } from "../types";

export interface PromptSeed {
  core: string;
  contextGuidance: string[];
  forbidden: string[];
  optionDirections: string[];
}

export interface EventFingerprint {
  category: LifeEventCategory;
  tags: string[];
  intensity?: "minor" | "major";
}

export interface LifeEventSeed {
  id: string;
  category: LifeEventCategory;
  title: string;
  minAge: number;
  maxAge: number;
  conditionDescription: string;
  // Trigger logic in JSON-friendly schema or simple checking attributes
  check: (attribs: LifeAttributes, userData: { birthday?: string; gender?: string; currentSituation?: string }, age: number) => boolean;
  cooldown?: number;
  tags?: string[];
  fingerprint?: EventFingerprint;
  promptSeed?: PromptSeed;
  conceptPrompt?: string; // Used to direct AI story generation
}

export const LIFE_EVENTS_DATABASE: LifeEventSeed[] = [
  // ==================== CAREER MILESTONES (职业生涯里程碑) ====================
  {
    id: "career_startup_boom",
    category: "career",
    title: "创业合伙与现金流考验",
    minAge: 22,
    maxAge: 45,
    conditionDescription: "智力 >= 65 且 财富 >= 60",
    check: (attribs) => attribs.intelligence >= 65 && attribs.wealth >= 60,
    conceptPrompt: "因为你在专业领域的积累和积累的一笔启动金，有一个真实的风口项目（如新型本地智能服务、垂类效率开发、或是实体连锁加盟）向你招手。你面临着是要追求快速融资、疯狂招人背水一战，还是保持轻资产运营、宁可错失风口也要保住底线，或者直接套现自己手中的微小话语权。选项和后果必须展现出合伙人内讧、资金链月度承压等具体商业常识，算清真实的房租、人员工资和获客成本，展示出好坏均存的落地成长。"
  },
  {
    id: "career_corporate_politics",
    category: "career",
    title: "跨部门内耗与站队考验",
    minAge: 23,
    maxAge: 55,
    conditionDescription: "人际比值较高且财富处于中游",
    check: (attribs) => attribs.relation >= 60 && attribs.wealth >= 40 && attribs.wealth <= 75,
    conceptPrompt: "你所在的公司遭遇架构调整。你直属老领导跟新来的高管发生了严重的权力拉锯，老领导试图让你在跨部门汇报中顶包某些财务亏空线索，而新高管则私下暗示如果主动提供把柄就提拔你。你面临一次具体的利弊选择。选项应当务实、带着中国职场常识，比如【替老领导顶雷企图维系人际但背负职业风险】、或是【向新管理层靠拢但背上过河拆桥的名声】、或者【寻找合规体面退路直接申请平调划清界限】。"
  },
  {
    id: "career_structural_layoff",
    category: "career",
    title: "行业变迁与结构性裁员",
    minAge: 22,
    maxAge: 52,
    conditionDescription: "财富 < 45",
    check: (attribs) => attribs.wealth < 45,
    conceptPrompt: "面对整体大环境的大幅紧缩，你所在的业务线因为入不敷出被总部整体“优化”。你瞬间失去了唯一的工资收入，而下个月的房租或房贷利息正等待支付。这一幕要写得极其朴素真实：没有神话奇遇，只有赔偿金谈判桌上的冷冰冰、招聘软件上石沉大海的简历、以及中年再婚或单身青年的焦虑。选项要包含【为了生存立刻降薪去中小型企业干脏活累活】、【回绝低质量岗位，申请微薄失业救济金闭门考考证自救】、【动用多年积累的人脉厚着脸皮寻找外包私活单子】。"
  },
  {
    id: "career_intellectual_breakthrough",
    category: "career",
    title: "核心研制产出与成果受夺",
    minAge: 20,
    maxAge: 45,
    conditionDescription: "智力评分高于 72",
    check: (attribs) => attribs.intelligence >= 72,
    conceptPrompt: "你在岗位上耗费无数个深夜独立产出的某套核心系统或重大商业提案大获成功。但在论功行赏时，你的总监暗示要将本部门的整体署名（其实主要是总监本人）排在第一位，并把分外利益分给大客户的关系户。选项必须要带着刺痛骨皮的职场真实：【默默吃哑巴亏以求安稳、但换取总监口头的晋升承诺】、【鱼死网破直接找公司监察部门或跨级申诉，但有可能在此行业被排挤】、【直接把方案核心带走，低调物色下家随时准备和平解约】。"
  },

  // ==================== RELATIONSHIP DEVELOPMENTS (情感与现实博弈) ====================
  {
    id: "relation_realistic_compromise",
    category: "relationship",
    title: "买房落户与两代人的长考",
    minAge: 24,
    maxAge: 38,
    conditionDescription: "幸福度 >= 45",
    check: (attribs) => attribs.happiness >= 45,
    conceptPrompt: "感情走到了谈婚论嫁的边缘。但在现实面前，关于首付由谁出大头、房产证写谁名字、两家对彩礼或婚后是否跟老人合租等具体的物质利益冲突，毫无保留地被摆上了台面。你的伴侣也承受着两边家长的催促和算计，言语中多了防备和疲惫。选项要求围绕典型的现实利益冲突：【掏空自己和父母的微薄家底全款/贷款买房，背上三十年重债】、【坚持在租来的二手房结婚坚守自由，但要顶住女方/男方家长的强烈鄙视】、【在现实摩擦中看清彼此并不适合，体面宣告分手各走一方】。"
  },
  {
    id: "relation_family_heavy_duty",
    category: "relationship",
    title: "家乡村落期待与微薄退路",
    minAge: 22,
    maxAge: 55,
    conditionDescription: "人际 >= 50 且 幸福度 < 60",
    check: (attribs) => attribs.relation >= 50 && attribs.happiness < 60,
    conceptPrompt: "父母老迈或老家有兄弟姐妹遇到极其具体的读书/买房急用钱困境。老家亲友向你频繁求援，甚至强烈劝说你在大城市大厂或私企朝不保夕还不如考个县城编制回来。选项要有强烈中国乡情下的两难：【把手里积攒的转折备用金转给亲人，宁愿自己再在大城市多熬两年盒饭】、【明确拒绝老家的求援，背负无情无义的骂名，保护自己改写的物质基本盘】、【顺从家庭渴望，彻底放弃一线奋斗，打包行囊回偏远老家谋取稳定工作】。"
  },
  {
    id: "relation_business_betrayal",
    category: "relationship",
    title: "利益交换之中的挚友裂纹",
    minAge: 20,
    maxAge: 50,
    conditionDescription: "人际评分中等，且财富大于 50",
    check: (attribs) => attribs.relation >= 40 && attribs.wealth >= 50,
    conceptPrompt: "跟你交往多年、原本无话不谈甚至是共事上下游的挚友，因为一笔关键的供货单或者内部推荐机会，在利益面前做出了私下的手段，坑害了你。你意外发现了这个事实。选项需要深刻反思：【为了往日的情分装聋作哑，但从此在业务中建立铜墙铁壁的隔离防线】、【毫不留情当众揭穿，直接进行商业诉讼或者切割，相忘且相仇于江湖】、【直接找对方深夜对饮，揭开利益底牌，重构利益平衡点，各取所需】。"
  },

  // ==================== HEALTH CHALLENGES (健康与生命约束) ====================
  {
    id: "health_hustle_burnout",
    category: "health",
    title: "体检报告的亮红警报",
    minAge: 22,
    maxAge: 50,
    conditionDescription: "健康 < 45",
    check: (attribs) => attribs.health < 45,
    conceptPrompt: "多年超负荷熬夜、高盐重辣外卖、以及常年业绩压榨，在一次普通的周六体检后换来了几项指标严重异常甚至需要入院微创手术的复查单。面对急需加班跟进的重大节点以及手头可能颗粒无收的季度提成，你发现身体是不可能被糊弄的。选项应极其真实：【咬牙吃几颗止痛药和护肝片继续在工位上熬，把高额提成和KPI拿下来再治】、【向公司递交确诊单请病假半薪停职疗养，但要准备好被边缘化和扣年终奖】、【主动辞去高收入的核心主力岗，降低支出转做轻松、没有KPI折磨的轻量过渡岗位】。"
  },
  {
    id: "health_life_accident_lesson",
    category: "health",
    title: "身体宕机与生活暂停",
    minAge: 18,
    maxAge: 70,
    conditionDescription: "健康 < 40 或 幸福度 < 35",
    check: (attribs) => attribs.health < 40 || attribs.happiness < 35,
    cooldown: 8,
    tags: ["health", "major_crisis", "forced_pause", "burnout"],
    fingerprint: {
      category: "health",
      tags: ["health", "major_crisis", "forced_pause", "burnout"],
      intensity: "major"
    },
    promptSeed: {
      core: "长期透支导致一次现实的身体宕机，被迫暂停原有生活节奏。",
      contextGuidance: [
        "结合上一阶段的职业选择、财务状况、居住状态和家庭支持度来决定具体表现。",
        "如果上一阶段是高压职场，可写体检异常、眩晕、慢病复发或急性炎症。",
        "如果上一阶段是副业奔波或体力消耗，可写现实意外或劳损加重。",
        "如果上一阶段是长期孤独和情绪压抑，可写失眠、焦虑躯体化或精神崩溃边缘。"
      ],
      forbidden: [
        "不要固定写雨夜骨折。",
        "不要连续重复轮椅办公、社群发帖。",
        "不要把健康危机写成无差别惩罚。"
      ],
      optionDirections: [
        "继续硬撑原计划，但承受身体和效率代价。",
        "接受停顿，重排生活节奏和工作方式。",
        "向家人、朋友、公司或医疗系统寻求现实支持。"
      ]
    }
  },

  // ==================== UNEXPECTED OPPORTUNITIES (实际人生机遇与两难) ====================
  {
    id: "opportunity_venture_partnership",
    category: "opportunity",
    title: "前上司抛来的加盟邀约",
    minAge: 21,
    maxAge: 48,
    conditionDescription: "才智优秀且财富偏低 (智力 >= 60, 财富 < 45)",
    check: (attribs) => attribs.intelligence >= 60 && attribs.wealth < 45,
    conceptPrompt: "有一位非常看重你过往执行力的老上司拉出来成立了一家新公司（干垂直细分领域的落地业务，如智能化运营、高频物流等）。对方诚挚邀请你作为极其重要的核心干将加入，但只能拿到极低的基本生活赞助费，主要靠后续股权分成，这意味着你至少有一年毫无稳定入息。选项包括：【辞去现在虽然平庸但准时发薪的民企职位，自降薪水跟着老上司赌一把未来】、【礼貌拒绝，相比飘忽的大饼，你认为每个月实实在在能存下来的公积金和工资才最安稳】、【提出不全职加入，利用业余时间提供无休止的技术或业务顾问支持（牺牲全部娱乐和睡眠），拿外包费用】。"
  },
  {
    id: "opportunity_overseas_relocation",
    category: "opportunity",
    title: "高风险高回报的外派肥缺",
    minAge: 22,
    maxAge: 45,
    conditionDescription: "幸福度评分低于 40",
    check: (attribs) => attribs.happiness < 40,
    conceptPrompt: "由于你近来表现出对安稳岗位的疲态或主动寻找机会，公司抛来一个派驻中亚、非洲或南美洲的项目执行岗。工作极其艰苦、离家数万里，但给足了原本大本营足足三倍的综合津贴和退役后的核心总监绿卡。你面临这个能带给你财富破局、却需要付出巨大寂寞和环境风险的选择。选项要围绕：【为了家庭或稳定婉拒外派，继续在大城市死熬现在的低薪小坑】、【果断孤身登机，将青春和两年健康留在异国工地上，用铁血挣下第一套全款房】、【借此为跳板去竞争对手那里，用拿到外派要挟现有老总进行原地加薪谈判】。"
  },
  {
    id: "opportunity_side_hustle_conflict",
    category: "opportunity",
    title: "副业悄然起色与合规冲突",
    minAge: 20,
    maxAge: 50,
    conditionDescription: "智力 >= 60 且 财富 < 60",
    check: (attribs) => attribs.intelligence >= 60 && attribs.wealth < 60,
    conceptPrompt: "你在下班后低调做起的独立技术外包、或细分垂直自媒体账号悄然积攒了第一波忠实高客单价客户。副业收入甚至在某几个月跟你的主业基本持平，但因为在主营业务范畴发生了某种细小的利益重叠，如果被公司人力部门发现，你将面临被无补偿开除甚至竞业起诉的巨大可能。选项包括：【在好转的兆头下果断当天提辞职，将业余爱好全面商业化，自己为生】、【立即收缩或出让副业所有权给朋友打掩护，继续把主业的铁饭碗抱死，杜绝一切职业合规风险】、【在钢丝绳上继续疯狂跳舞，白天应付差事磨洋工，晚上红着眼做副业，能捞一笔是一笔】。"
  },
  {
    id: "life_normal_transition",
    category: "opportunity",
    title: "平稳生活与长期积累",
    minAge: 18,
    maxAge: 80,
    conditionDescription: "无强事件或近期发生过重大事件时的平稳过渡",
    check: () => true,
    cooldown: 2,
    tags: ["normal_life", "transition", "breathing_room"],
    fingerprint: {
      category: "opportunity",
      tags: ["normal_life", "transition", "breathing_room"],
      intensity: "minor"
    },
    promptSeed: {
      core: "没有突发大事，生活进入一段平稳但仍有细小取舍的长期积累阶段。",
      contextGuidance: [
        "结合上一阶段选择，描述日常节奏、微小压力和普通人的长期取舍。",
        "不要强行制造事故、裁员、背叛或重大危机。",
        "让选项围绕继续积累、微调方向、修复关系或照顾身体。"
      ],
      forbidden: [
        "不要为了戏剧性强行引入灾难。",
        "不要重复最近发生过的重大事件。"
      ],
      optionDirections: [
        "维持当前节奏继续积累。",
        "做一次温和调整，降低未来风险。",
        "把注意力转向关系、健康或兴趣的修复。"
      ]
    }
  }
];

const DEFAULT_COOLDOWN = 4;
const NORMAL_EVENT_ID = "life_normal_transition";

function eventTags(event: LifeEventSeed): string[] {
  return event.fingerprint?.tags || event.tags || [];
}

function hasSharedTag(left: string[], right: string[]): boolean {
  return left.some((tag) => right.includes(tag));
}

function eventMeta(item: HistoryItem): EventMeta | undefined {
  return item.eventMeta;
}

function isEventInCooldown(event: LifeEventSeed, history: HistoryItem[]): boolean {
  const cooldown = event.cooldown ?? DEFAULT_COOLDOWN;
  const recent = history.slice(-cooldown);
  const tags = eventTags(event);

  return recent.some((item) => {
    const meta = eventMeta(item);
    if (!meta) return false;
    if (meta.eventId && meta.eventId === event.id) return true;

    const metaTags = meta.eventTags || [];
    const isMajorHealthEvent = tags.includes("health") && tags.includes("major_crisis");
    const isSameMajorHealthFingerprint = isMajorHealthEvent
      && metaTags.includes("health")
      && metaTags.includes("major_crisis")
      && hasSharedTag(tags, metaTags);

    return isSameMajorHealthFingerprint;
  });
}

function isCategoryLimited(event: LifeEventSeed, history: HistoryItem[]): boolean {
  const recent = history.slice(-2);
  if (recent.length < 2) return false;

  const categories = recent.map((item) => item.eventMeta?.eventCategory).filter(Boolean);
  if (categories.length < 2 || categories[0] !== categories[1]) return false;

  if (categories[0] === event.category) return true;

  const tags = eventTags(event);
  const isMajorHealthEvent = tags.includes("health") && tags.includes("major_crisis");
  const recentHadMajorHealth = recent.some((item) => {
    const recentTags = item.eventMeta?.eventTags || [];
    return recentTags.includes("health") && recentTags.includes("major_crisis");
  });

  return isMajorHealthEvent && recentHadMajorHealth;
}

function hasRecentMajorEvent(history: HistoryItem[]): boolean {
  return history.slice(-2).some((item) => item.eventMeta?.eventTags?.includes("major_crisis"));
}

function hasStableBreathingRoom(attribs: LifeAttributes): boolean {
  return attribs.health >= 50 && attribs.wealth >= 50 && attribs.happiness >= 50;
}

// Helper to select the single best matching life event seed dynamically
export function queryDynamicLifeEvent(
  attribs: LifeAttributes,
  userData: { birthday?: string; gender?: string; currentSituation?: string },
  age: number,
  history: HistoryItem[] = []
): LifeEventSeed | null {
  // Filter events within age range and that pass our condition check
  const candidates = LIFE_EVENTS_DATABASE.filter(event => {
    return age >= event.minAge && age <= event.maxAge && event.check(attribs, userData, age);
  });

  if (candidates.length === 0) return null;

  const nonCooledCandidates = candidates.filter((event) => !isEventInCooldown(event, history));
  if (nonCooledCandidates.length === 0) return null;

  const categoryAllowedCandidates = nonCooledCandidates.filter((event) => !isCategoryLimited(event, history));
  const finalCandidates = categoryAllowedCandidates.length > 0 ? categoryAllowedCandidates : nonCooledCandidates;
  const normalTransition = finalCandidates.find((event) => event.id === NORMAL_EVENT_ID);

  if (normalTransition && hasRecentMajorEvent(history) && hasStableBreathingRoom(attribs)) {
    return normalTransition;
  }

  if (normalTransition && finalCandidates.length === 1) return normalTransition;

  const dramaticCandidates = finalCandidates.filter((event) => event.id !== NORMAL_EVENT_ID);
  if (dramaticCandidates.length > 0) {
    const index = Math.floor(Math.random() * dramaticCandidates.length);
    return dramaticCandidates[index];
  }

  return normalTransition || null;
}

export function buildEventMeta(event: LifeEventSeed): EventMeta {
  return {
    eventId: event.id,
    eventCategory: event.category,
    eventTags: eventTags(event)
  };
}
