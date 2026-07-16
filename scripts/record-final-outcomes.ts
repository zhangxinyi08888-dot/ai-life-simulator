import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { callDeepSeekJson } from "../src/utils/deepseek";
import { generateFinalOutcome } from "../src/services/finalOutcome/finalOutcomeService";
import { FinalLifeOutcome, HistoryItem, LifeAttributes, QuestionTurn, UserInitialData } from "../src/types";

const execFileAsync = promisify(execFile);

interface CaseFixture {
  slug: string;
  name: string;
  userData: UserInitialData;
  answers: QuestionTurn[];
  history: HistoryItem[];
  attributes: LifeAttributes;
}

function attributes(overrides: Partial<LifeAttributes> = {}): LifeAttributes {
  return { happiness: 58, intelligence: 70, wealth: 55, relation: 62, health: 66, ...overrides };
}

function node(age: number, title: string, description: string, selectedChoice: string, attrs = attributes()): HistoryItem {
  return {
    age,
    title,
    stage: "人生节点",
    description,
    selectedChoice,
    attributes: attrs,
    choices: [],
    isEndingNode: false
  };
}

const fixtures: CaseFixture[] = [
  {
    slug: "interest-app",
    name: "兴趣产品线",
    userData: {
      birthday: "1992-03-15",
      birthtime: "09:00",
      gender: "男",
      currentSituation: "正在犹豫是否继续投入自己的植物记录产品。",
      isReturnToPast: true,
      targetAgeNode: "高考志愿",
      regressionNodeKey: "gaokao",
      regressionAge: 18,
      regressionSituation: "高考后在稳定专业和热爱的植物方向之间摇摆。",
      regressionChoices: "想看看如果更早相信兴趣会怎样。",
      coreStoryFocus: "selftruth",
      milestones: [
        { id: "gaokao", title: "高考志愿", content: "为了现实选择了更稳的专业。" },
        { id: "career", title: "第一份工作", content: "进入传统公司，开始怀疑自己的热爱。" }
      ]
    },
    answers: [
      { id: 1, question: "当时最大的现实限制是什么？", answer: "家里希望先稳定，自己也怕兴趣养不活自己。" },
      { id: 2, question: "压力下你通常怎么反应？", answer: "先自己查资料和硬扛，不太愿意麻烦别人。" },
      { id: 3, question: "你有哪些兴趣和能力？", answer: "喜欢植物，也会写一些小工具和内容。" }
    ],
    history: [
      node(18, "高考志愿", "他把植物方向放在心里，最终选了更稳的专业。", "先选择现实认可的专业"),
      node(23, "第一份工作", "稳定岗位让收入变踏实，也让每天越来越不像自己。", "留下来攒经验和现金流"),
      node(28, "第一次创业", "他尝试做植物记录工具，收入不稳定但终于愿意公开作品。", "用业余时间做出第一个版本"),
      node(31, "植物APP上线", "产品有了小批真实用户，他开始理解热爱也需要运营和合作。", "继续打磨垂直功能"),
      node(35, "健康亮红灯", "长期熬夜让身体报警，他被迫调整节奏。", "暂停扩张，先修复身体"),
      node(39, "继续坚持", "产品不算爆红，却成为一群人的日常工具。", "把热爱慢慢做成稳定作品", attributes({ happiness: 76, intelligence: 82, wealth: 63, health: 62 }))
    ],
    attributes: attributes({ happiness: 76, intelligence: 82, wealth: 63, health: 62 })
  },
  {
    slug: "career-pivot",
    name: "职场转向线",
    userData: {
      birthday: "1995-06-09",
      birthtime: "21:30",
      gender: "女",
      currentSituation: "想从稳定岗位转向更有成长性的行业。",
      isReturnToPast: true,
      targetAgeNode: "第一份工作",
      regressionNodeKey: "career",
      regressionAge: 22,
      regressionSituation: "毕业时在传统公司和新行业实习之间犹豫。",
      regressionChoices: "想试试更难但成长更快的路。",
      coreStoryFocus: "career",
      milestones: [{ id: "career", title: "第一份工作", content: "选择稳定后长期缺少成长感。" }]
    },
    answers: [
      { id: 1, question: "当时最担心什么？", answer: "担心收入不稳，也担心父母觉得我不务正业。" },
      { id: 2, question: "遇到困难如何应对？", answer: "会快速学习，但很容易把所有压力都放在自己身上。" },
      { id: 3, question: "能动用哪些资源？", answer: "有一点存款，执行力强，但行业人脉很少。" }
    ],
    history: [
      node(22, "毕业选择", "她拒绝了最稳的 offer，去了一个小团队从基础岗位做起。", "进入新行业实习"),
      node(24, "低薪成长期", "工资低、事情杂，但她快速补齐了项目能力。", "继续留在小团队磨作品"),
      node(27, "第一次跳槽", "她用作品集换到更好的平台，也开始承担管理责任。", "用成果争取新机会"),
      node(31, "行业下行", "团队缩编，她第一次面对外部周期带来的失控感。", "保住核心能力，准备转型"),
      node(34, "转向顾问型工作", "她不再只追职位，而是把经验产品化。", "做可复用的方法和服务", attributes({ happiness: 70, intelligence: 84, wealth: 68, relation: 64, health: 58 }))
    ],
    attributes: attributes({ happiness: 70, intelligence: 84, wealth: 68, relation: 64, health: 58 })
  },
  {
    slug: "relationship-rebuild",
    name: "关系修复线",
    userData: {
      birthday: "1990-11-21",
      birthtime: "07:20",
      gender: "女",
      currentSituation: "想理解自己为什么总在关系里过度承担。",
      isReturnToPast: true,
      targetAgeNode: "分手前夜",
      regressionNodeKey: "romance",
      regressionAge: 26,
      regressionSituation: "一段重要关系走到分岔，她在挽留和放手之间摇摆。",
      regressionChoices: "想试试更早表达边界。",
      coreStoryFocus: "romance",
      milestones: [{ id: "relationship", title: "重要分手", content: "长期迁就后仍然分开。" }]
    },
    answers: [
      { id: 1, question: "那段关系里你最害怕什么？", answer: "害怕表达需求后对方离开。" },
      { id: 2, question: "你通常如何处理冲突？", answer: "先忍，再自己消化，最后一次性爆发。" },
      { id: 3, question: "你真正想保留什么？", answer: "想保留亲密，也想保留自己的生活节奏。" }
    ],
    history: [
      node(26, "分手前夜", "她第一次没有继续解释，而是把自己的底线说清楚。", "坦诚表达真实需求"),
      node(27, "关系冷静期", "两个人短暂分开，她学会不把所有沉默都归咎于自己。", "暂停追问，照顾自己"),
      node(29, "新的亲密方式", "她在新关系里练习提前沟通，而不是等到委屈堆满。", "把边界说在前面"),
      node(33, "家庭责任拉扯", "伴侣、父母和工作同时需要她，她开始分配责任。", "不再一个人承担全部"),
      node(37, "稳定而自由", "关系没有变得完美，但她不再靠牺牲自己换安稳。", "保留亲密也保留自己", attributes({ happiness: 74, relation: 78, health: 64 }))
    ],
    attributes: attributes({ happiness: 74, relation: 78, health: 64 })
  },
  {
    slug: "wealth-recovery",
    name: "财富复盘线",
    userData: {
      birthday: "1988-01-30",
      birthtime: "14:10",
      gender: "男",
      currentSituation: "想从一次投资失误里恢复信心和秩序。",
      isReturnToPast: true,
      targetAgeNode: "投资决策",
      regressionNodeKey: "wealth",
      regressionAge: 30,
      regressionSituation: "身边人都在讨论风口，他在保守和加杠杆之间摇摆。",
      regressionChoices: "想看看如果当时更克制会怎样。",
      coreStoryFocus: "wealth",
      milestones: [{ id: "wealth", title: "投资失误", content: "重仓高风险机会后承受了长期压力。" }]
    },
    answers: [
      { id: 1, question: "当时为什么会心动？", answer: "害怕错过，也想证明自己能抓住机会。" },
      { id: 2, question: "压力下会怎么做？", answer: "会不断补救，越亏越想靠下一次翻回来。" },
      { id: 3, question: "有什么现实限制？", answer: "家庭开支稳定，抗风险的钱并不多。" }
    ],
    history: [
      node(30, "风口面前", "他没有满仓冲进去，而是把资金分成生活、学习和小额试错。", "控制仓位，小额验证"),
      node(32, "错过暴涨", "身边人短期赚了钱，他很焦虑，但现金流没有被摧毁。", "承认错过，不追高"),
      node(35, "稳住家庭现金流", "他把副业和投资分开管理，生活重新有了安全边界。", "先建立风险垫"),
      node(39, "长期复利", "他不再追逐每个风口，而是做自己理解的领域。", "只投看得懂的东西"),
      node(45, "财富秩序", "财富增长不戏剧化，但家庭和身体都保住了。", "用纪律替代冲动", attributes({ wealth: 72, happiness: 68, health: 66 }))
    ],
    attributes: attributes({ wealth: 72, happiness: 68, health: 66 })
  },
  {
    slug: "inner-peace",
    name: "内在平衡线",
    userData: {
      birthday: "1998-09-02",
      birthtime: "12:40",
      gender: "男",
      currentSituation: "总觉得自己慢半拍，想知道如何稳定向前。",
      isReturnToPast: true,
      targetAgeNode: "考研失败",
      regressionNodeKey: "custom",
      regressionAge: 24,
      regressionSituation: "考研失败后在继续备考、找工作和休息之间纠结。",
      regressionChoices: "想试试不再用一次失败否定自己。",
      coreStoryFocus: "innerpeace",
      milestones: [{ id: "exam", title: "考研失败", content: "失败后长期怀疑自己的能力。" }]
    },
    answers: [
      { id: 1, question: "失败后最难受的是什么？", answer: "觉得自己浪费时间，也怕被同龄人甩开。" },
      { id: 2, question: "你通常如何恢复？", answer: "会自己默默整理计划，但恢复很慢。" },
      { id: 3, question: "你真正想要什么？", answer: "想有稳定生活，也想继续学习。" }
    ],
    history: [
      node(24, "考研落榜", "他没有立刻把自己推回高压备考，而是先找一份能学习的工作。", "先工作，保留学习节奏"),
      node(26, "慢慢恢复", "他用下班时间补技能，重新建立对自己的信任。", "把学习拆成小目标"),
      node(29, "职业稳定", "他不再执着一次考试，而是把能力迁移到岗位里。", "用作品证明能力"),
      node(32, "再次选择深造", "他带着更清楚的问题重返学习，而不是为了证明自己。", "选择非全日制深造"),
      node(36, "稳定向前", "他没有变成别人眼里的最快，却形成了自己的节奏。", "按自己的节奏积累", attributes({ happiness: 72, intelligence: 80, health: 70 }))
    ],
    attributes: attributes({ happiness: 72, intelligence: 80, health: 70 })
  }
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportMarkdown(fixture: CaseFixture, outcome: FinalLifeOutcome): string {
  const paragraphList = (items: string[]) => items.filter(Boolean).join("\n\n");
  const repeatedPatterns = outcome.report.repeatedPatterns.map((item) => `### ${item.title}\n\n${paragraphList(item.paragraphs)}\n\n**${item.closingLine}**`).join("\n\n");
  const effects = outcome.report.patternEffects.map((item) => `### ${item.patternName}\n\n${paragraphList(item.paragraphs)}\n\n- 带来的复利：${item.compoundReturn}\n- 隐藏的代价：${item.hiddenCost}\n\n**${item.closingLine}**`).join("\n\n");
  const trends = outcome.report.futureTrends.map((item) => `### ${item.title}\n\n${item.trend}\n\n${item.reason}`).join("\n\n");
  const keep = outcome.report.patternsToKeep.map((item) => `### ${item.title}\n\n${item.why}\n\n${paragraphList(item.paragraphs)}\n\n**${item.closingLine}**`).join("\n\n");
  const adjust = outcome.report.patternsToAdjust.map((item) => `### ${item.title}\n\n${item.why}\n\n${paragraphList(item.paragraphs)}\n\n**${item.closingLine}**`).join("\n\n");

  return `# ${fixture.name}\n\n${outcome.share.viralTitle}\n\n${outcome.share.covenantTitle}\n\n${outcome.share.oneLineSummary}\n\n## 人生终章时间线\n\n${outcome.share.timeline.map((item) => `- ${item.ageLabel} ${item.icon} ${item.title}：${item.choiceSummary}`).join("\n")}\n\n${outcome.share.closingLine}\n\n# AI 人生模式分析\n\n## 一句话总览\n\n${outcome.report.executiveSummary.headline}\n\n${outcome.report.executiveSummary.patterns.map((item, index) => `人生模式${index + 1}：**${item.name}**\n\n${item.shortDescription}`).join("\n\n")}\n\n${outcome.report.executiveSummary.closingLine}\n\n## 第一章：哪些选择模式一直在重复？\n\n${repeatedPatterns}\n\n## 第二章：这些模式给你带来了什么？\n\n${effects}\n\n## 第三章：如果继续这样走\n\n${trends}\n\n## 第四章：哪些值得保留？\n\n${keep}\n\n## 第五章：哪些值得调整？\n\n${adjust}\n\n## AI看到的人生\n\n### ${outcome.report.finalLifeReading.title}\n\n${paragraphList(outcome.report.finalLifeReading.paragraphs)}\n\n**${outcome.report.finalLifeReading.finalSentence}**\n`;
}

function posterHtml(outcome: FinalLifeOutcome): string {
  const light = outcome.share.posterTheme === "clean_magazine";
  const bg = outcome.share.posterTheme === "clean_magazine"
    ? "linear-gradient(145deg,#f8fafc,#ffffff,#ecfdf5)"
    : outcome.share.posterTheme === "quiet_dark"
      ? "linear-gradient(145deg,#020617,#09090b,#171717)"
      : "linear-gradient(145deg,#0c0a09,#020617,#052e2b)";
  const main = light ? "#020617" : "#f8fafc";
  const soft = light ? "#475569" : "#cbd5e1";
  const border = light ? "#cbd5e1" : "rgba(255,255,255,.16)";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(outcome.share.viralTitle)}</title>
<style>
*{box-sizing:border-box} body{margin:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.poster{width:390px;height:693px;padding:22px;border-radius:28px;background:${bg};color:${main};display:flex;flex-direction:column;overflow:hidden}.label{display:flex;justify-content:space-between;color:${soft};font-size:10px;font-weight:700;letter-spacing:.18em}.title{margin:24px 0 12px;font-size:30px;line-height:1.12;font-weight:900}.badge{display:inline-flex;border:1px solid ${border};border-radius:999px;padding:5px 12px;color:${soft};font-size:12px;font-weight:700}.summary{margin:12px 0 0;color:${soft};font-size:15px;line-height:1.65;font-weight:600}.timeline{margin-top:18px;border-top:1px solid ${border};padding-top:14px}.hint{color:${soft};font-size:11px;font-weight:700}.item{display:grid;grid-template-columns:50px 24px 1fr;gap:8px;margin-top:11px;align-items:start}.age{font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace}.icon{font-size:15px}.item-title{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.choice{color:${soft};font-size:11px;line-height:1.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.closing{margin-top:auto;border-top:1px solid ${border};padding-top:14px;font-size:15px;line-height:1.5;font-weight:900}
</style>
</head>
<body>
  <main class="poster">
    <div class="label"><span>AI 给我的人生写了一个结局</span><span>✦</span></div>
    <section>
      <h1 class="title">${escapeHtml(outcome.share.viralTitle)}</h1>
      <div class="badge">${escapeHtml(outcome.share.covenantTitle)}</div>
      <p class="summary">${escapeHtml(outcome.share.oneLineSummary)}</p>
    </section>
    <section class="timeline">
      <div class="hint">AI认为，这几次选择塑造了今天的你。</div>
      ${outcome.share.timeline.map((item) => `<div class="item"><div class="age">${escapeHtml(item.ageLabel)}</div><div class="icon">${escapeHtml(item.icon)}</div><div><div class="item-title">${escapeHtml(item.title)}</div><div class="choice">${escapeHtml(item.choiceSummary)}</div></div></div>`).join("")}
    </section>
    <footer class="closing">${escapeHtml(outcome.share.closingLine)}</footer>
  </main>
</body>
</html>`;
}

async function screenshotHtml(htmlPath: string, outputPath: string): Promise<void> {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  await execFileAsync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--window-size=390,844",
    `--screenshot=${outputPath}`,
    pathToFileURL(htmlPath).href
  ]);
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.VITE_DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("缺少 DEEPSEEK_API_KEY 或 VITE_DEEPSEEK_API_KEY");

  const baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.VITE_DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || process.env.VITE_DEEPSEEK_MODEL || "deepseek-v4-flash";
  const runDir = path.resolve("records/final-outcomes", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const caseDir = path.join(runDir, `${String(index + 1).padStart(2, "0")}-${fixture.slug}`);
    await mkdir(caseDir, { recursive: true });

    const outcome = await generateFinalOutcome({
      userData: fixture.userData,
      answers: fixture.answers,
      history: fixture.history,
      currentAttributes: fixture.attributes,
      context: { closureType: "mortality" }
    }, {
      callAiJson: (prompt) => callDeepSeekJson({ apiKey, baseUrl, model }, prompt)
    });

    const jsonPath = path.join(caseDir, "outcome.json");
    const reportPath = path.join(caseDir, "report.md");
    const htmlPath = path.join(caseDir, "poster.html");
    const pngPath = path.join(caseDir, "poster.png");

    await writeFile(jsonPath, `${JSON.stringify(outcome, null, 2)}\n`, "utf8");
    await writeFile(reportPath, reportMarkdown(fixture, outcome), "utf8");
    await writeFile(htmlPath, posterHtml(outcome), "utf8");
    await screenshotHtml(htmlPath, pngPath);
    console.log(`${index + 1}. ${fixture.name}: ${caseDir}`);
  }

  console.log(`记录已保存：${runDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
