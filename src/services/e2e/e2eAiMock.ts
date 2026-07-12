import { FinalLifeOutcome, LifeAttributes, SimulationNode } from "../../types";

type AiJsonCaller = (prompt: string) => Promise<{ text: string }>;

interface E2eCase {
  slug: string;
  regressionAge: number;
  title: string;
  theme: string;
  viralTitle: string;
  covenantTitle: string;
  summary: string;
  nodes: SimulationNode[];
  outcome: FinalLifeOutcome;
}

const baseAttributes: LifeAttributes = {
  happiness: 62,
  intelligence: 72,
  wealth: 56,
  relation: 60,
  health: 66
};

function attrs(overrides: Partial<LifeAttributes> = {}): LifeAttributes {
  return { ...baseAttributes, ...overrides };
}

function choiceNode(
  age: number,
  title: string,
  description: string,
  attributes: LifeAttributes,
  isEndingNode = false
): SimulationNode {
  return {
    age,
    stage: isEndingNode ? "人生收束" : "现实抉择",
    title,
    description,
    attributes,
    isEndingNode,
    choices: isEndingNode
      ? [{ id: "A", text: "安详落幕，查看一生洞察", impactSummary: "终章" }]
      : [
          { id: "A", text: "先把手里的事情做成一个可以展示的作品", impactSummary: "沉淀作品" },
          { id: "B", text: "继续保持稳定节奏，同时小步验证新方向", impactSummary: "稳中试探" },
          { id: "C", text: "找一个能互补的人一起推进，不再全部自己扛", impactSummary: "借力成长" }
        ]
  };
}

function outcome(
  viralTitle: string,
  covenantTitle: string,
  oneLineSummary: string,
  finalSentence: string,
  timeline: FinalLifeOutcome["share"]["timeline"]
): FinalLifeOutcome {
  return {
    meta: {
      generatedAt: "2026-07-02T00:00:00.000Z",
      modelProvider: "mock",
      posterVersion: "web-v1",
      reportVersion: "life-pattern-v2"
    },
    share: {
      viralTitle,
      covenantTitle,
      oneLineSummary,
      timeline,
      closingLine: "人生不是由成功组成，而是由一次次选择组成。",
      posterTheme: "warm_realistic",
      downloadFileName: `${viralTitle.replace(/[《》]/g, "")}.png`,
      imageAlt: "AI 人生终章网页海报"
    },
    report: {
      executiveSummary: {
        headline: "AI 回顾了你的人生轨迹，发现真正塑造你的不是某一次决定，而是三个反复出现的选择模式。",
        patterns: [
          { name: "成长优先，而非短期稳定", shortDescription: "每次关键转折，你都会把长期能力放在眼前确定性之前。", keyMomentIndexes: [0, 1] },
          { name: "先准备，再行动", shortDescription: "你很少冲动开始，通常会等作品、经验或判断更扎实后才真正迈出去。", keyMomentIndexes: [1, 2] },
          { name: "独自解决，再慢慢沉淀", shortDescription: "你习惯把压力先接住，再用学习和复盘把它变成自己的方法。", keyMomentIndexes: [2, 3] }
        ],
        closingLine: "这些模式让你获得了今天的优势，也带来了今天的代价。"
      },
      repeatedPatterns: [
        {
          name: "成长优先",
          title: "你总是在稳定和成长之间，把票投给成长",
          paragraphs: [
            "回看这条轨迹，真正改变你的不是某个突然的运气，而是你一次次把自己放进更难但更能长本事的位置。早期你会顾虑现实，后来每到分岔点，还是会选择能积累经验、作品和判断力的那条路。",
            "这已经不是单次决定，而是一套长期运行的选择系统。"
          ],
          keyMomentIndexes: [0, 1, 2],
          closingLine: "你的人生不是被机会推着走，而是被能力复利慢慢推开。"
        }
      ],
      patternEffects: [
        {
          patternName: "长期积累",
          compoundReturn: "经验越来越能迁移，作品越来越能证明你。",
          hiddenCost: "速度看起来不够快，也容易在独自硬扛时消耗自己。",
          paragraphs: [
            "这种模式让你的优势更耐用：行业和环境变化时，你不是只剩一个岗位，而是带着可迁移的能力继续往前走。但它也让你习惯把压力内部消化，很多本可以被合作放大的事情，最后都变成了一个人的长跑。"
          ],
          keyMomentIndexes: [1, 2, 3],
          closingLine: "真正限制你的，已经不是努力，而是放大努力的方式。"
        }
      ],
      futureTrends: [
        {
          title: "经验产品化会变得越来越重要",
          trend: "如果这个模式继续，未来十年你最可能把过往经验变成产品、方法或服务，而不是单纯依赖职位变化。",
          reason: "因为你的增长一直来自积累和沉淀，这是模式延续，不是命运预测。",
          keyMomentIndexes: [2, 3]
        }
      ],
      patternsToKeep: [
        {
          title: "保留把事情做成作品的习惯",
          why: "它已经在多个阶段证明，比短期热闹更能帮你留下真实资产。",
          paragraphs: ["继续让选择落到作品、案例、方法和可复用成果上。你越能把经历沉淀下来，未来越不容易被单一环境定义。"],
          keyMomentIndexes: [1, 2],
          closingLine: "作品，是你和时间合作的方式。"
        }
      ],
      patternsToAdjust: [
        {
          title: "把自己做，升级成一起做",
          why: "过去独自解决问题让你成长很快，但下一阶段它会成为瓶颈。",
          paragraphs: ["未来五年，重要的不是再证明你能一个人扛住，而是找到能放大你能力的人、流程和资源。合作不是降低自主性，而是让你的积累产生更大回声。"],
          keyMomentIndexes: [2, 3],
          closingLine: "能力决定你能走多快，合作决定你能走多远。"
        }
      ],
      finalLifeReading: {
        title: "如果我是十年后的你",
        paragraphs: [
          "回头看你的轨迹，我会发现一件很有意思的事：你并不是靠某一次大胆翻盘改变人生。真正发生的是，你把同一种选择重复了很多年。",
          "别人看到的是节点，你走过的是一套越来越清晰的运行机制。"
        ],
        finalSentence
      }
    }
  };
}

const cases: E2eCase[] = [
  {
    slug: "interest-app",
    regressionAge: 18,
    title: "兴趣产品线",
    theme: "兴趣与作品",
    viralTitle: "重生之我把兴趣当副业坚持了半辈子",
    covenantTitle: "与热爱缔约的人",
    summary: "现实改变过你的路径，却没有真正改掉你的热爱。",
    nodes: [
      choiceNode(18, "志愿表前的犹豫", "你把兴趣写在草稿纸上，又被现实、家人的期待和收入焦虑反复拉回。那一刻，你没有轻易反抗，而是开始想有没有一种方式，既能活下去，也不把热爱彻底交出去。", attrs()),
      choiceNode(24, "第一份稳定工作", "稳定让生活有了底，但你发现自己下班后才真正醒来。你开始把兴趣变成一个小作品，哪怕进展很慢，也第一次把喜欢的事从脑子里拿到了现实中。", attrs({ intelligence: 76, wealth: 58 })),
      choiceNode(31, "作品被真实用户使用", "你做的工具没有突然爆红，却有人每天打开它。你意识到兴趣不是逃离现实，而是需要被现实检验、打磨和迭代。", attrs({ happiness: 72, intelligence: 82, wealth: 62 })),
      choiceNode(39, "慢慢做到别人离不开", "这一生没有夸张的逆袭，但你把一件喜欢的事做成了有人需要的作品。你也终于承认，热爱不是年少冲动，而是你反复选择后的主线。", attrs({ happiness: 78, intelligence: 84, wealth: 68, relation: 70, health: 64 }), true)
    ],
    outcome: outcome(
      "重生之我把兴趣当副业坚持了半辈子",
      "与热爱缔约的人",
      "现实改变过你的路径，却没有真正改掉你的热爱。",
      "你不是靠抓住机会成长，而是靠不断积累，让机会最终找到你。",
      [
        { ageLabel: "18岁", icon: "🎓", title: "志愿表前", choiceSummary: "先向现实低头", keyMomentIndexes: [0] },
        { ageLabel: "24岁", icon: "💼", title: "稳定工作", choiceSummary: "下班后继续做", keyMomentIndexes: [1] },
        { ageLabel: "31岁", icon: "📱", title: "作品上线", choiceSummary: "让兴趣被使用", keyMomentIndexes: [2] },
        { ageLabel: "39岁", icon: "🌱", title: "仍在坚持", choiceSummary: "把热爱做成资产", keyMomentIndexes: [3] }
      ]
    )
  },
  {
    slug: "career-pivot",
    regressionAge: 22,
    title: "职业转向线",
    theme: "职业成长",
    viralTitle: "重生之我用低薪换了一条护城河",
    covenantTitle: "把经验炼成路的人",
    summary: "你最重要的选择，常常不是钱更多，而是成长空间更大。",
    nodes: [
      choiceNode(22, "毕业后的低薪入口", "你站在稳定岗位和高成长小团队之间，心里清楚前者更安全，后者更辛苦。最后你选择了那个更能学到东西的位置，也接受了起点不体面的现实。", attrs({ wealth: 44, intelligence: 70 })),
      choiceNode(26, "用作品换机会", "几年里你做了很多杂事，也把杂事沉淀成项目经验。别人看到你换了平台，真正发生的是你终于有了能证明自己的东西。", attrs({ intelligence: 80, wealth: 60 })),
      choiceNode(34, "行业下行后的转身", "当行业开始收缩，你没有只盯着岗位名称，而是把经验整理成方法、案例和服务。你发现最抗周期的不是职位，而是被验证过的能力。", attrs({ intelligence: 84, wealth: 68, health: 58 })),
      choiceNode(40, "成为可迁移的人", "你没有成为最会追风口的人，却成为了换环境也能继续创造价值的人。职业不再只是公司给你的头衔，而是你长期积累出来的信用。", attrs({ happiness: 72, intelligence: 86, wealth: 74, relation: 68, health: 60 }), true)
    ],
    outcome: outcome(
      "重生之我用低薪换了一条护城河",
      "把经验炼成路的人",
      "你最重要的选择，常常不是钱更多，而是成长空间更大。",
      "你的未来不在某个岗位里，而在越来越难被替代的经验里。",
      [
        { ageLabel: "22岁", icon: "💼", title: "低薪入口", choiceSummary: "选择成长空间", keyMomentIndexes: [0] },
        { ageLabel: "26岁", icon: "🧩", title: "作品换机会", choiceSummary: "把杂事做成履历", keyMomentIndexes: [1] },
        { ageLabel: "34岁", icon: "📉", title: "行业下行", choiceSummary: "经验开始迁移", keyMomentIndexes: [2] },
        { ageLabel: "40岁", icon: "🧭", title: "可迁移人生", choiceSummary: "不再只靠岗位", keyMomentIndexes: [3] }
      ]
    )
  },
  {
    slug: "relationship-rebuild",
    regressionAge: 26,
    title: "关系修复线",
    theme: "关系边界",
    viralTitle: "重生之我终于在爱里说了不",
    covenantTitle: "保留自己的人",
    summary: "你学会的不是不再爱，而是不再用牺牲自己证明爱。",
    nodes: [
      choiceNode(26, "分手前夜的停顿", "你本能地想继续解释、继续退让，但这一次你把真实需求说了出来。关系没有立刻变好，可你第一次没有把所有沉默都算成自己的错。", attrs({ relation: 58 })),
      choiceNode(29, "新的沟通方式", "你开始把边界提前说，而不是等委屈攒到爆发。亲密变得没那么戏剧化，却更像两个成年人共同经营生活。", attrs({ happiness: 70, relation: 72 })),
      choiceNode(33, "家庭责任的分配", "当伴侣、父母和工作同时需要你，你没有再自动接下全部。你学会了把责任说清楚，也允许别人承担他们该承担的部分。", attrs({ happiness: 74, relation: 78, health: 64 })),
      choiceNode(38, "亲密与自由并存", "你没有得到完美关系，却得到了一种更稳的自己。你终于明白，爱不是把自己缩小，而是两个人都能在关系里站住。", attrs({ happiness: 80, relation: 82, health: 68 }), true)
    ],
    outcome: outcome(
      "重生之我终于在爱里说了不",
      "保留自己的人",
      "你学会的不是不再爱，而是不再用牺牲自己证明爱。",
      "你真正修复的不是某段关系，而是自己在关系里的位置。",
      [
        { ageLabel: "26岁", icon: "💔", title: "分手前夜", choiceSummary: "第一次说出边界", keyMomentIndexes: [0] },
        { ageLabel: "29岁", icon: "💬", title: "新的沟通", choiceSummary: "提前表达需求", keyMomentIndexes: [1] },
        { ageLabel: "33岁", icon: "🏠", title: "家庭责任", choiceSummary: "不再全部自己扛", keyMomentIndexes: [2] },
        { ageLabel: "38岁", icon: "🌤", title: "亲密自由", choiceSummary: "爱里也保留自己", keyMomentIndexes: [3] }
      ]
    )
  },
  {
    slug: "wealth-recovery",
    regressionAge: 30,
    title: "财富复盘线",
    theme: "风险秩序",
    viralTitle: "重生之我没追风口反而保住了人生",
    covenantTitle: "把风险关进笼的人",
    summary: "你真正赢回来的不是一笔钱，而是面对机会时的秩序。",
    nodes: [
      choiceNode(30, "风口面前的克制", "身边人都在谈暴富故事，你也怕错过。但你没有把全部安全感押上去，而是把钱分成生活、防守和小额试错。", attrs({ wealth: 54, happiness: 58 })),
      choiceNode(32, "错过暴涨后的焦虑", "你看着别人短期赚到钱，心里并不轻松。可当市场回撤时，你没有被债务拖垮，也第一次理解现金流是普通人的底气。", attrs({ wealth: 62, health: 66 })),
      choiceNode(36, "只做看得懂的事", "你把投资和副业分开，不再靠下一次翻盘修复上一次冲动。财富增长慢了一点，生活却终于重新有了边界。", attrs({ wealth: 70, happiness: 66 })),
      choiceNode(45, "纪律替代冲动", "你没有成为故事里一夜翻身的人，却保住了家庭、睡眠和继续选择的资格。财富不再是证明自己的工具，而是让生活不失控的秩序。", attrs({ wealth: 76, happiness: 70, health: 68 }), true)
    ],
    outcome: outcome(
      "重生之我没追风口反而保住了人生",
      "把风险关进笼的人",
      "你真正赢回来的不是一笔钱，而是面对机会时的秩序。",
      "你不是错过了所有风口，而是终于学会不把人生押成一局。",
      [
        { ageLabel: "30岁", icon: "📈", title: "风口面前", choiceSummary: "没有满仓冲进去", keyMomentIndexes: [0] },
        { ageLabel: "32岁", icon: "💸", title: "错过暴涨", choiceSummary: "现金流保住了你", keyMomentIndexes: [1] },
        { ageLabel: "36岁", icon: "🧮", title: "只做懂的事", choiceSummary: "用边界管理欲望", keyMomentIndexes: [2] },
        { ageLabel: "45岁", icon: "🛡", title: "财富秩序", choiceSummary: "纪律替代冲动", keyMomentIndexes: [3] }
      ]
    )
  },
  {
    slug: "inner-peace",
    regressionAge: 24,
    title: "内在平衡线",
    theme: "稳定节奏",
    viralTitle: "重生之我终于允许自己慢半拍",
    covenantTitle: "按自己节奏的人",
    summary: "你不是一直落后，只是需要一种不靠自责驱动的人生节奏。",
    nodes: [
      choiceNode(24, "失败后的缓冲", "那次失败让你很想立刻证明自己，但你没有把自己重新推回高压里。你先找了一份能学习的工作，给生活留下一点可恢复的空间。", attrs({ happiness: 50, health: 60 })),
      choiceNode(27, "小目标重新建立信心", "你把学习拆小，把每天能完成的事写下来。进展并不戏剧化，但你开始重新相信，慢一点也可以在往前。", attrs({ happiness: 64, intelligence: 76, health: 66 })),
      choiceNode(32, "带着问题继续深造", "你再次回到学习，不再是为了证明自己没输，而是因为你知道自己真正想解决什么问题。节奏变慢了，方向反而更清楚。", attrs({ happiness: 70, intelligence: 82 })),
      choiceNode(36, "稳定向前", "你没有变成别人眼里最快的人，却形成了自己的节奏。你终于明白，稳定不是没有野心，而是不用焦虑摧毁自己。", attrs({ happiness: 76, intelligence: 84, health: 72 }), true)
    ],
    outcome: outcome(
      "重生之我终于允许自己慢半拍",
      "按自己节奏的人",
      "你不是一直落后，只是需要一种不靠自责驱动的人生节奏。",
      "你的命运不是一次失败决定的，而是一次次重新站稳决定的。",
      [
        { ageLabel: "24岁", icon: "📝", title: "失败之后", choiceSummary: "先保留恢复空间", keyMomentIndexes: [0] },
        { ageLabel: "27岁", icon: "📚", title: "小目标", choiceSummary: "重新相信积累", keyMomentIndexes: [1] },
        { ageLabel: "32岁", icon: "🎓", title: "继续深造", choiceSummary: "带着问题学习", keyMomentIndexes: [2] },
        { ageLabel: "36岁", icon: "🌿", title: "稳定向前", choiceSummary: "按自己的节奏走", keyMomentIndexes: [3] }
      ]
    )
  }
];

const casesBySlug = new Map(cases.map((item) => [item.slug, item]));
const cachedCallers = new Map<string, AiJsonCaller>();

export function getE2eCaseSlugs(): string[] {
  return cases.map((item) => item.slug);
}

export function createE2eAiJsonCaller(slug: string): AiJsonCaller {
  const fixture = casesBySlug.get(slug);
  if (!fixture) {
    throw new Error(`Unknown E2E case: ${slug}`);
  }

  let nextNodeIndex = 1;

  return async (prompt: string) => {
    if (prompt.includes("剧本关键背景补全工具")) {
      return {
        text: JSON.stringify({
          questions: [
            {
              question: `在“${fixture.theme}”这条线里，当时最具体的现实限制是什么？`,
              suggestions: ["我最担心收入不稳。", "我怕家人反对。", "我当时资源很少。", "我其实已经有一点准备。"]
            },
            {
              question: "当时遇到压力时，你通常会怎么反应？",
              suggestions: ["我会先自己扛。", "我会查资料慢慢解决。", "我会拖一阵再行动。", "我会找少数信任的人商量。"]
            },
            {
              question: "当时你能动用的能力、兴趣或资源是什么？",
              suggestions: ["我有长期学习的能力。", "我有一些作品或经验。", "我时间不多但愿意投入。", "我缺少合作伙伴。"]
            }
          ]
        })
      };
    }

    if (prompt.includes("startNode")) {
      return {
        text: JSON.stringify({
          initialAttributes: fixture.nodes[0].attributes,
          startNode: fixture.nodes[0]
        })
      };
    }

    if (prompt.includes("人生模式分析产品文案系统")) {
      return { text: JSON.stringify(fixture.outcome) };
    }

    if (prompt.includes("你正在为一段写实人生生成自然终章")) {
      return { text: JSON.stringify(fixture.nodes[fixture.nodes.length - 1]) };
    }

    if (prompt.includes("【上一步做出的命运裁决】")) {
      const node = fixture.nodes[Math.min(nextNodeIndex, fixture.nodes.length - 1)];
      nextNodeIndex += 1;
      if (node.isEndingNode) {
        return {
          text: JSON.stringify({
            ...node,
            isEndingNode: false,
            choices: fixture.nodes[0].choices,
            e2eForceEnding: true
          })
        };
      }
      return { text: JSON.stringify(node) };
    }

    return { text: JSON.stringify(fixture.outcome) };
  };
}

export function getCachedE2eAiJsonCaller(slug: string): AiJsonCaller {
  const cached = cachedCallers.get(slug);
  if (cached) return cached;

  const caller = createE2eAiJsonCaller(slug);
  cachedCallers.set(slug, caller);
  return caller;
}

export function getBrowserE2eAiJsonCaller(): AiJsonCaller | undefined {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (!env?.DEV || typeof window === "undefined") return undefined;

  const slug = new URLSearchParams(window.location.search).get("e2eCase");
  if (!slug) return undefined;

  return getCachedE2eAiJsonCaller(slug);
}

export function shouldForceBrowserE2eEnding(rawNode: unknown): boolean {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (!env?.DEV || typeof window === "undefined") return false;
  const slug = new URLSearchParams(window.location.search).get("e2eCase");
  return Boolean(slug && casesBySlug.has(slug) && (rawNode as { e2eForceEnding?: boolean } | null)?.e2eForceEnding === true);
}
