import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, Calendar, User, Compass, ArrowRight, Hourglass, 
  ArrowLeft, GraduationCap, Briefcase, Heart, BookOpen, AlertCircle, RefreshCw,
  Plus, Trash2
} from "lucide-react";
import { UserInitialData } from "../types";

export interface Milestone {
  id: string;
  title: string;
  icon: string;
  content: string;
  placeholder: string;
  presetTemplate?: string;
}

const FOCUS_DEFAULT_MILESTONES: Record<string, Milestone[]> = {
  career: [
    {
      id: "gaokao",
      title: "高考与择学",
      icon: "🎓",
      content: "当年高考志愿失格，为了稳妥听信父母放弃了最感兴趣的专业改报普通电子科，入校深觉枯燥乏味。",
      placeholder: "例：当年第一志愿落榜，被迫调剂到不喜欢的冷门专业，自此失去了学习热情。",
      presetTemplate: "高考分数擦边，为了留在本地，报考了家人极力推荐的普通信息工程。大学期间面对复杂的电路和代码一直提不起兴致。"
    },
    {
      id: "career",
      title: "首份工作与晋升困难",
      icon: "💼",
      content: "进了一家传统IT外包公司做写代码，起薪低且加班无度。项目不断延期，没有技术沉淀和实质晋升，浑浑噩噩过了几年。",
      placeholder: "例：第一份工作在小作坊做销售兼运营，整日被琐碎繁重的工作缠绕，工资极低没有前途。",
      presetTemplate: "一毕业就做了行政专员，琐事巨多但薪资极菲薄，被领导当作廉价杂役。换了两家公司也只是从一个牢笼跳入另一个格子间。"
    },
    {
      id: "layoff",
      title: "行业变迁与裁员危机",
      icon: "⚠️",
      content: "正当好不容易坐上小组长时，公司承接的外包订单锐减，面临部门重组与强制‘裁员优化’，至今仍处于长期的待业焦虑中。",
      placeholder: "例：公司遇到危机进行大整顿，自己成了裁员单上的第一把刀，失业数月无着落。",
      presetTemplate: "因为宏观大环境和行业性断崖，公司一夜之间解散。由于竞业协议和年龄大，在求职路上碰壁无数，开始背负消费贷度日。"
    }
  ],
  romance: [
    {
      id: "first_love",
      title: "青涩年华的惊艳暗恋",
      icon: "🌸",
      content: "大二时疯狂暗恋隔壁班的一位白月光同学。写了满满两本日记，却至终因为自卑、胆怯没敢说出那一个字，成为了毕生的遗憾。",
      placeholder: "例：喜欢了高中同桌整整三年，直到毕业离校也没表露心迹，之后天各一方再无波澜。",
      presetTemplate: "在学生会活动中一见倾心。默默关注了对方一整年，无数次偶遇却只敢生硬地打个招呼，最后眼看着有人捷足先登。"
    },
    {
      id: "romance",
      title: "毕业分飞与无奈痛放",
      icon: "💖",
      content: "毕业后两人开启了两地异地恋，由于高昂的高铁费、沉重的工作负荷和双方家长对彩礼/婚房首期的摩擦，最终流泪痛心分手。",
      placeholder: "例：原本谈婚论嫁，最终败给了对方父母要求的昂贵彩礼以及两地规划问题，心撕裂般各奔东西。",
      presetTemplate: "恋爱三年，甚至见过双方家长。但在讨论在哪个省会定居以及未来房贷如何分担时爆发激烈争吵，最终妥协败给现实，和平断联。"
    },
    {
      id: "marriage",
      title: "相亲安稳与灵魂荒芜",
      icon: "💍",
      content: "迫于社会传统年龄和父母天天催婚的巨大压力，草草相亲找了个性格稳重的伴侣。日子每天平淡如白开水，心中始终是枯竭的。",
      placeholder: "例：到了大龄不得不妥协结婚，日子虽然安稳无忧，但没有爱的悸动，灵魂彻底死寂。",
      presetTemplate: "29 岁那年通过朋友介绍认识现在的另一半。彼此客客气气，眼里只有柴米油盐和每月的房按，深夜醒来看着身边的枕边人，感到无尽的落寞。"
    }
  ],
  wealth: [
    {
      id: "first_pot_gold",
      title: "红利爆发差池",
      icon: "🪙",
      content: "2018年听群友提起过早期的数字藏品与短视频博主红利。由于性格极度保守和十万本金不够，只是眼睁睁地旁观，错过了风口爆发。",
      placeholder: "例：当年看好跨境电商或自媒体红利，却因为胆怯不敢投入，身边穷校友反而借此实现了豪车洋房。",
      presetTemplate: "大学刚毕业赶上朋友攒班子做早期短视频带货。由于对风口倾斜嗤之以鼻，自己选择去考冷门编制，几年后朋友公司分红几百万，自己月薪4000。"
    },
    {
      id: "wealth",
      title: "风口踏空与割肉悔恨",
      icon: "📈",
      content: "后来的几年，目睹了几波板块轮动暴涨。在极具涨幅的主线中听信了小道消息，高位接盘后在谷底恐慌割肉，错过了资产倍增的良机。",
      placeholder: "例：在几波重大科技和金融风口前，听信谣言多次底部被清洗，眼看大牛市擦肩过，血本无归。",
      presetTemplate: "把仅有的十五万积蓄全仓买了题材，因为沉不住气在历史谷底割肉清仓。结果割肉后两个月，该板块暴涨数倍，彻底气结心痛。"
    },
    {
      id: "investment_fail",
      title: "杠杆决策与债务枷锁",
      icon: "📉",
      content: "顺应所谓的‘财富保值’风向，倾其所有甚至申请了信贷，高位按揭买下了一套偏远地产，如今价值近乎腰斩，每月扛着重重的房贷负重前行。",
      placeholder: "例：在一二线城市高位买入了房地产被套牢，或者不加考察加盟实体店使得积储成空、负债累累。",
      presetTemplate: "全网买房热潮最旺时签下了两百万高额房贷合同。这两年大势折头，资产腰斩，收入缩水，每天睁眼就是巨大的月供债务，不敢停歇半分。"
    }
  ],
  selftruth: [
    {
      id: "gaokao",
      title: "夭折的天赋志向",
      icon: "🎨",
      content: "自小对数字艺术、插画动漫有惊人直觉与热爱。高考极想报考美术设计类，却被家中长辈用‘玩艺术的没出息，出来连饭都吃不起’强逼，只能改报机械专业。",
      placeholder: "例：从小向往写作和自媒体，却在学业压力和父母逼迫下选了体制内最对口的冷门专业，扼杀了天性灵气。",
      presetTemplate: "曾自己独立画过短篇绘本，梦想是考美院。高考志愿填报最后三分钟，全家齐上阵夺走了我的鼠标，强行改成了工商管理，自此将画笔深埋压箱。"
    },
    {
      id: "career",
      title: "背叛自我的格子间",
      icon: "🏢",
      content: "毕业后在一家传统的枯燥机构内做录入助理。每天核对核销无休止的数据和机械表格，觉得自己对万事万物的灵性正在一点点死去。",
      placeholder: "例：被迫在一眼能望到死胡同的流水线工位上敲击键盘，只为了那份父母眼中所谓的‘稳定起薪’。",
      presetTemplate: "朝九晚五的统计职员，每天看无数没有灵性的签字与审批流程。同事之间死气沉沉、勾心斗角，我只觉得自己是一具死去的装有体温的容器。"
    },
    {
      id: "soul_crisis",
      title: "暮气觉醒与自由渴望",
      icon: "🕊️",
      content: "突然在深夜加班的雨中惊醒：自己已经为了旁人的期望庸碌生活了近十年，内心不甘地咆哮，渴望冲破钢铁和教条垒成的无形藩篱。",
      placeholder: "例：经历过职场和心理磨难后终于懂得：我想要的不是升职跟多高收入，而是完全自主的艺术和旷野般的生活。",
      presetTemplate: "在日复一日的虚无感堆叠中濒临崩溃。半夜醒来翻出十几年前画了一半的稿子，泪流满面，强烈想要抛弃现有的无意义生活、去做大自然自由野放的旅人。"
    }
  ],
  custom: [
    {
      id: "gaokao",
      title: "高考与升学",
      icon: "🎓",
      content: "当年高考志愿失常，为了安稳放弃了画画爱好改报理工专业，心里一直隐藏着缺憾。",
      placeholder: "例：当年高考考上了三本，选了平庸的物流软件专业，非常遗憾没有报考第一志愿的服装设计学。",
      presetTemplate: "高考前由于重度失眠，理综有一门没有做完。最后擦边考入一个二本院校，选了家里逼着填报的信息工程，彻底封存了热爱的动漫设计志趣。"
    },
    {
      id: "career",
      title: "求职与工作",
      icon: "💼",
      content: "大学毕业出来，第一份工作做的是疲于奔命的网络销售。后来遭遇行业转型，被不留情面地一锅端裁员，深感无助。",
      placeholder: "例：毕业后连换了四份不顺的工作。后来在教培机构做老师，最终因行业性调整遭受全员裁撤，一度陷入抑郁焦虑。",
      presetTemplate: "大学毕业求职不顺，海投几百份只拿到个客服经理。打拼五年换了三家，好不容易混上主管，遭遇行业收缩被大厂第一批全干废‘优化’，至今背债失业。"
    },
    {
      id: "relationship",
      title: "恋爱与婚姻",
      icon: "💖",
      content: "大二曾狂烈暗恋一个学长/学姐。但由于腼腆 and 自卑无话而终。后来经历长辈催婚，过着不温不火的相亲。",
      placeholder: "例：大学初恋，两人最终因大都市房价与婆媳彩礼摩擦，在扯证前宣告和平分开，成为心中无法抚平的白色执念。",
      presetTemplate: "大二那年遇到了极其合拍的知己，谈过轰轰烈烈三年的纯真恋爱。毕业时由于买房首付 and 两地规划对立而心痛放手。后来相亲结了婚，只有白开水的日常。"
    }
  ]
};

interface InitialSetupProps {
  onSubmit: (data: UserInitialData, name: string) => void;
  isLoading: boolean;
}

export default function InitialSetup({ onSubmit, isLoading }: InitialSetupProps) {
  const [setupStep, setSetupStep] = useState<"basic" | "milestones" | "backtrack">("basic");
  
  // State for properties
  const [name, setName] = useState("");
  const [gender, setGender] = useState("未知");
  const [birthday, setBirthday] = useState("2000-01-01");
  const [birthtime, setBirthtime] = useState("");
  const [coreStoryFocus, setCoreStoryFocus] = useState("career"); // career, romance, wealth, selftruth, custom
  const [customFocusText, setCustomFocusText] = useState("身心宿命");
  // Dynamic Milestones
  const [milestones, setMilestones] = useState<Milestone[]>(FOCUS_DEFAULT_MILESTONES.career);

  const selectCoreFocus = (focusKey: string) => {
    setCoreStoryFocus(focusKey);
    const defaults = FOCUS_DEFAULT_MILESTONES[focusKey] || FOCUS_DEFAULT_MILESTONES.custom;
    setMilestones(defaults);
    if (defaults.length > 0) {
      setRegressionNodeKey(defaults[0].id);
    }
  };

  // legacy fields computed on current dynamic milestones to satisfy dependencies & other components
  const milestoneGaokao = milestones.find(m => m.id === "gaokao")?.content || milestones[0]?.content || "";
  const milestoneCareer = milestones.find(m => m.id === "career")?.content || milestones[1]?.content || "";
  const milestoneRelationship = milestones.find(m => m.id === "relationship")?.content || milestones[2]?.content || "";
  const milestoneOther = milestones.slice(3).map(m => `【${m.title}】${m.content}`).join("\n") || "";

  // Selected regression point details
  const [regressionNodeKey, setRegressionNodeKey] = useState("gaokao");
  const [regressionAge, setRegressionAge] = useState(18);
  const [regressionSituation, setRegressionSituation] = useState("");
  const [regressionChoices, setRegressionChoices] = useState("");

  const [validationError, setValidationError] = useState("");

  // Helper to extract age from text
  const extractAgeFromText = (text: string, defaultAge: number): number => {
    const matches = text.match(/(\d+)\s*岁/);
    if (matches && matches[1]) {
      const age = parseInt(matches[1]);
      if (age >= 7 && age <= 80) return age;
    }
    const numMatches = text.match(/\b(1[5-9]|2\d|3[0-5])\b/);
    if (numMatches && numMatches[1]) {
      const age = parseInt(numMatches[1]);
      if (age >= 7 && age <= 80) return age;
    }
    return defaultAge;
  };

  const getDynamicMilestones = () => {
    return milestones.map(m => {
      const age = extractAgeFromText(m.content, m.id === "gaokao" ? 18 : m.id === "career" ? 22 : m.id === "relationship" ? 20 : 25);
      
      let baseChoices = "A. 勇往直前：做出极具魄力与远见的决断，突破当年的遗憾与阻碍\nB. 稳中求胜：顺应当时的保守路径，但融入成熟心智，暗中发展副业与精力储备\nC. 独辟蹊径：完全跳出当时的世俗评价体系，将精力投入到最具灵魂感召或新兴趋势的崭新维度";
      
      let titleLower = m.title.toLowerCase();
      let contentLower = m.content.toLowerCase();
      
      if (m.id === "gaokao" || titleLower.includes("高考") || titleLower.includes("升学") || titleLower.includes("志愿") || contentLower.includes("高考") || contentLower.includes("志愿") || contentLower.includes("学校")) {
        baseChoices = "A. 捍卫灵魂热望：不顾家人反对，手写报下最热爱的理想专业或坚定复读重考\nB. 稳健求安：顺应当时的安稳路线，但利用大学课外时间全力自学梦想的高精尖本领/副企\nC. 彻底重构赛道：跳出当时考分或学历局限，坚信新兴科技产业才是未来，提前开始自研与创业";
      } else if (m.id === "career" || titleLower.includes("工作") || titleLower.includes("职场") || titleLower.includes("裁员") || titleLower.includes("创业") || contentLower.includes("工作") || contentLower.includes("公司") || contentLower.includes("创业") || contentLower.includes("求职")) {
        baseChoices = "A. 勇闯险峰：回绝平庸轨道的雇佣，不计代价联合志同道合的好友，开创属于自身的高成长事业\nB. 蛟龙折木：欣然接受现实分配或既定公司职务，融入上帝视角的防守智慧，规避未来经济变迁之困\nC. 另立乾坤：跳离传统雇员生态，用自己的独特技艺做独立自主的数字自由人，开启独立IP长线运营";
      } else if (m.id === "relationship" || titleLower.includes("情感") || titleLower.includes("恋") || titleLower.includes("婚") || contentLower.includes("恋爱") || contentLower.includes("相亲") || contentLower.includes("结婚") || contentLower.includes("分手")) {
        baseChoices = "A. 义无反顾：抛开一切彩礼、首付与物质俗虑，坚定不移、倾其所有地抓住最爱之人的手携手面对未来\nB. 温柔释怀：将这份遗憾的白月光尘封心间，相忘于江湖，把充盈的情感升华为推动自我巅峰奋斗的无限养分\nC. 强力破格：运用绝对自信的个人崛起步伐和非凡的情商智慧，正面说服并击穿世俗家境门第的重重屏障";
      }

      return {
        key: m.id,
        label: `${m.title}重置点`,
        title: `${m.title}点`,
        icon: m.icon || "🌟",
        desc: `关联【${m.title}】`,
        milestoneText: m.content,
        age: age,
        situation: `【生命印记：${m.content.trim()}】\n再次回到你所写下的 "${m.title}" 的关键转折期（约 ${age} 岁），命运重置的量子通道已经就绪。在这个关键抉择节点前，属于你的人生平行空间正在展开：`,
        choices: baseChoices
      };
    });
  };

  const getDynamicTemplates = () => {
    const list = getDynamicMilestones();
    const result: Record<string, typeof list[0]> = {};
    list.forEach(item => {
      result[item.key] = item;
    });
    return result;
  };

  const handleAddMilestone = () => {
    const newId = `custom_${Date.now()}`;
    setMilestones([
      ...milestones,
      {
        id: newId,
        title: `重大事件_${milestones.length + 1}`,
        icon: "🌟",
        content: "",
        placeholder: "在此输入您经历的其他重大转折，如大病休养、自主创业、城市定居等...",
      }
    ]);
  };

  const handleDeleteMilestone = (id: string) => {
    if (milestones.length <= 1) {
      setValidationError("为了使平行宇宙具有充足的人形时空轨迹，请至少保留一个人生转折节点。");
      return;
    }
    const filtered = milestones.filter(m => m.id !== id);
    setMilestones(filtered);
    if (regressionNodeKey === id) {
      setRegressionNodeKey(filtered[0]?.id || "");
    }
  };

  const handleChangeMilestoneTitle = (id: string, newTitle: string) => {
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, title: newTitle } : m));
  };

  const handleChangeMilestoneContent = (id: string, newContent: string) => {
    setMilestones(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
  };

  const truncateText = (text: string, maxLength: number = 20) => {
    if (!text) return "未填写";
    const clean = text.trim();
    if (clean.length <= maxLength) return clean;
    return clean.slice(0, maxLength) + "...";
  };

  const lastLoadedNodeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (regressionNodeKey !== lastLoadedNodeKeyRef.current) {
      const list = getDynamicMilestones();
      const tmpl = list.find(m => m.key === regressionNodeKey);
      if (tmpl) {
        setRegressionAge(tmpl.age);
        setRegressionSituation(tmpl.situation);
        setRegressionChoices(tmpl.choices);
        lastLoadedNodeKeyRef.current = regressionNodeKey;
      } else if (list.length > 0) {
        const firstTmpl = list[0];
        setRegressionNodeKey(firstTmpl.key);
        setRegressionAge(firstTmpl.age);
        setRegressionSituation(firstTmpl.situation);
        setRegressionChoices(firstTmpl.choices);
        lastLoadedNodeKeyRef.current = firstTmpl.key;
      }
    }
  }, [regressionNodeKey, milestones]);



  const handleNextToMilestones = () => {
    if (!name.trim()) {
      setValidationError("请填写您的代称或姓名，方便宿命之神召唤您。");
      return;
    }
    setValidationError("");
    setSetupStep("milestones");
  };

  const handleNextToBacktrack = () => {
    const hasFilledMilestone = milestones.some(m => m.content.trim().length > 0);
    if (!hasFilledMilestone) {
      setValidationError("为了提高平行宇宙分支的共振度，请确保至少填写一个人生节点大事记（或一键导入预设模板）。");
      return;
    }
    setValidationError("");
    setSetupStep("backtrack");
  };

  const handleStartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regressionSituation.trim()) {
      setValidationError("请详述您想带回那个节点的记忆细节或前后文，以便AI小说精细化演变。");
      return;
    }
    if (!regressionChoices.trim()) {
      setValidationError("请定义当时那刻您想尝试的命运抉择。");
      return;
    }
    setValidationError("");

    // Calculate a combined situation to supply the server for rich background
    const finalFormattedSituation = `【用户真实人生大事记】
- 高考升学轨迹：${milestoneGaokao}
- 职场与裁员变动：${milestoneCareer}
- 恋爱与情感姻缘：${milestoneRelationship}
- 其他宿命机遇：${milestoneOther}

【核心要重启的过去宿命点】
回到 ${regressionAge}岁 开启平行宇宙分支。
当时情境：${regressionSituation}
当时面临的选择：${regressionChoices}
本次重写聚焦的核心夙愿：${
      coreStoryFocus === "career" ? "职场与创业" :
      coreStoryFocus === "romance" ? "恋爱与婚姻" :
      coreStoryFocus === "wealth" ? "财富与自由" :
      coreStoryFocus === "selftruth" ? "兴趣与理想" : customFocusText
    }`;

    onSubmit({
      birthday,
      birthtime,
      gender,
      currentSituation: finalFormattedSituation,
      isReturnToPast: true,
      targetAgeNode: `回到过去重新抉择 - ${getDynamicTemplates()[regressionNodeKey as keyof ReturnType<typeof getDynamicTemplates>]?.label || "过去"} (${regressionAge}岁)`,
      milestoneGaokao,
      milestoneCareer,
      milestoneRelationship,
      milestoneOther,
      milestones,
      regressionNodeKey,
      regressionAge,
      regressionSituation,
      regressionChoices,
      coreStoryFocus: coreStoryFocus === "custom" ? customFocusText : coreStoryFocus
    }, name);
  };

  return (
    <div className="w-full h-full flex flex-col justify-between" id="welcome-screen">
      {/* Top Banner Indicator */}
      <div className="relative text-center py-5 px-4 pb-2">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[10px] font-mono mb-2"
          id="universe-badge"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          DST-REWRITE • 时空改写契约机
        </motion.div>
        
        <h1 className="text-2xl font-serif font-semibold tracking-tight text-slate-100" id="app-main-title">
          命运重启：AI 逆时光模拟器
        </h1>
        <p className="text-slate-400 text-[11px] max-w-xs mx-auto leading-relaxed mt-1">
          探寻您真实的岁月记忆，时光逆流至指定节点。以超精细的一年一叶，重写逆天改命之书。
        </p>

        {/* Horizontal steps design */}
        <div className="flex items-center justify-center gap-2 mt-4" id="wizard-steps-indicators">
          <button 
            type="button"
            onClick={() => setSetupStep("basic")}
            className={`w-6 h-1.5 rounded-full transition-all ${setupStep === "basic" ? "bg-indigo-500 w-8" : "bg-slate-800"}`}
            title="命盘初始"
          />
          <button 
            type="button"
            onClick={() => name && setSetupStep("milestones")}
            disabled={!name}
            className={`w-6 h-1.5 rounded-full transition-all ${setupStep === "milestones" ? "bg-indigo-500 w-8" : "bg-slate-800 disabled:opacity-50"}`}
            title="事件写照"
          />
          <button 
            type="button"
            onClick={() => name && milestones.some(m => m.content.trim()) && setSetupStep("backtrack")}
            disabled={!name || !milestones.some(m => m.content.trim())}
            className={`w-6 h-1.5 rounded-full transition-all ${setupStep === "backtrack" ? "bg-indigo-500 w-8" : "bg-slate-800 disabled:opacity-50"}`}
            title="时空锁钥"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 pb-8 hide-scrollbar" id="wizard-scrollable-inner">
        <AnimatePresence mode="wait">
          
          {/* STEP 1: Basic Info and Core Focus */}
          {setupStep === "basic" && (
            <motion.div
              key="step-basic"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
              id="step-basic-container"
            >
              <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-4 border border-slate-800/60 space-y-3" id="basics-group">
                <h3 className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5 mb-1 uppercase tracking-wider font-mono">
                  <User className="w-3.5 h-3.5" /> 第一步：星轨天承命册
                </h3>
                
                <div className="grid grid-cols-2 gap-3" id="basic-grid">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1 font-sans">您的尊称/代名</label>
                    <input
                      id="user-name-input"
                      type="text"
                      placeholder="如: 李修远 / 晓溪"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={12}
                      className="w-full text-xs bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl px-3 py-2.5 text-slate-200 outline-none transition-all"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1 font-sans">星盘性别属性</label>
                    <select
                      id="user-gender-select"
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full text-xs bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-slate-200 outline-none transition-all"
                    >
                      <option value="未知">保密/未知</option>
                      <option value="男">男 (阳魄型)</option>
                      <option value="女">女 (阴柔型)</option>
                      <option value="非二元">无拘 (星宿灵体)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-sans flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> 出生星盘时间 (推演天干地支五行星位依据)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      id="user-birthday-input"
                      type="date"
                      value={birthday}
                      onChange={(e) => setBirthday(e.target.value)}
                      className="w-full text-xs bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:border-indigo-500 outline-none"
                    />
                    <input
                      id="user-birthtime-input"
                      type="time"
                      value={birthtime}
                      onChange={(e) => setBirthtime(e.target.value)}
                      className="w-full text-xs bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-slate-200 focus:border-indigo-500 outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Core story focus */}
              <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-4 border border-slate-800/60 space-y-3" id="core-focus-group">
                <h3 className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5 mb-1 uppercase tracking-wider font-mono">
                  🪐 核心抉择：人生主调聚焦方向
                </h3>
                <p className="text-slate-400 text-[10px] leading-relaxed">
                  本次重写平行宇宙，你想让AI推演算命系统重点聚焦于你的哪一方面宿命变迁？
                </p>
                <div className="grid grid-cols-2 gap-2" id="focus-options-grid">
                  {[
                    { key: "career", label: "💼 职场与权力", desc: "主推：创业、职场变迁、学术高度" },
                    { key: "romance", label: "💖 恋爱与因缘", desc: "主推：白月光弥补、红尘婚姻、宿命羁绊" },
                    { key: "wealth", label: "🪙 财富与垄断", desc: "主推：信息差套现、商业帝国、投资爆发" },
                    { key: "selftruth", label: "🎨 兴趣与真我", desc: "主推：艺术理想、自由意志、超越世俗" },
                    { key: "custom", label: "✍️ 自定义聚焦", desc: "完全自由地编辑及设定您的平行梦想" }
                  ].map((item) => (
                    <button
                      id={`focus-btn-${item.key}`}
                      key={item.key}
                      type="button"
                      onClick={() => selectCoreFocus(item.key)}
                      className={`p-2.5 rounded-xl border text-xs text-left transition-all ${
                        coreStoryFocus === item.key
                          ? "bg-indigo-950/40 border-indigo-500 text-indigo-200"
                          : "bg-slate-955/50 border-slate-800/80 hover:border-slate-700 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <div className="font-semibold text-[11px]">{item.label}</div>
                      <div className="text-[9px] text-slate-400 mt-0.5 font-sans leading-tight">{item.desc}</div>
                    </button>
                  ))}
                </div>

                {coreStoryFocus === "custom" && (
                  <input
                    id="custom-focus-text-input"
                    type="text"
                     placeholder="可填输入如：'想探索健康与长寿' / '修真平行科技线'"
                    value={customFocusText}
                    onChange={(e) => setCustomFocusText(e.target.value)}
                    className="w-full text-xs bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2 text-slate-300 outline-none"
                  />
                )}
              </div>

              {validationError && (
                <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-xs text-red-300 flex items-center gap-1.5" id="val-err-1">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {validationError}
                </div>
              )}

              <button
                id="to-stage-2-btn"
                type="button"
                onClick={handleNextToMilestones}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
              >
                下一步：登记经历与故事主线
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* STEP 2: Gathering user major real-life milestones */}
          {setupStep === "milestones" && (
            <motion.div
              key="step-milestones"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
              id="step-milestones-container"
            >
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-1.5" id="milestones-intro-card">
                <h3 className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5 uppercase font-mono">
                  <GraduationCap className="w-4 h-4 text-indigo-400" /> 第二步：描写过往人生经历
                </h3>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  请记录你的关键人生经历（您可以定制修改标题、添加或删除特定转折阶段，这些经历将充当重塑平行时空的底层背景）。
                </p>
              </div>

              {/* Dynamic Milestones List */}
              <div className="space-y-3.5" id="dynamic-milestones-list">
                {milestones.map((m) => (
                  <div
                    key={m.id}
                    className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-4 border border-slate-800/60 space-y-2.5 transition-all"
                    id={`milestone-card-${m.id}`}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <div className="flex items-center gap-2 flex-grow">
                        <span className="text-sm">{m.icon}</span>
                        <input
                          id={`milestone-title-input-${m.id}`}
                          type="text"
                          value={m.title}
                          onChange={(e) => handleChangeMilestoneTitle(m.id, e.target.value)}
                          className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 text-xs font-semibold text-slate-200 outline-none py-0.5 px-0.5 w-full transition-all"
                          placeholder="修改节点标题"
                          maxLength={30}
                        />
                      </div>
                      
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {m.presetTemplate && (
                          <button
                            id={`preset-btn-${m.id}`}
                            type="button"
                            onClick={() => handleChangeMilestoneContent(m.id, m.presetTemplate || "")}
                            className="text-[9px] text-indigo-400 bg-indigo-950/20 px-1.5 py-0.5 rounded border border-indigo-900/30 hover:bg-indigo-950/65 transition-colors cursor-pointer"
                          >
                            🪄 填入模板
                          </button>
                        )}
                        
                        {milestones.length > 1 && (
                          <button
                            id={`delete-btn-${m.id}`}
                            type="button"
                            onClick={() => handleDeleteMilestone(m.id)}
                            className="p-1 text-slate-500 hover:text-red-400 rounded transition-all cursor-pointer"
                            title="删除此事件"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <textarea
                      id={`milestone-content-textarea-${m.id}`}
                      rows={2}
                      maxLength={150}
                      placeholder={m.placeholder}
                      value={m.content}
                      onChange={(e) => handleChangeMilestoneContent(m.id, e.target.value)}
                      className="w-full text-xs bg-slate-950 border border-slate-800/90 focus:border-indigo-500 rounded-xl p-2.5 text-slate-300 outline-none resize-none leading-relaxed"
                    />
                  </div>
                ))}
              </div>

              {/* Add Custom Milestone Button */}
              <button
                id="add-milestone-btn"
                type="button"
                onClick={handleAddMilestone}
                className="w-full py-2.5 rounded-xl border border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/30 hover:bg-slate-900/20 text-slate-400 hover:text-slate-300 text-xs font-medium flex items-center justify-center gap-1 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 text-slate-500" />
                新增关键节点经历
              </button>

              {validationError && (
                <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-xs text-red-300 flex items-center gap-1.5" id="val-err-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {validationError}
                </div>
              )}

              <div className="flex gap-3" id="navigation-block-2">
                <button
                  id="back-to-stage-1-btn"
                  type="button"
                  onClick={() => setSetupStep("basic")}
                  className="flex-1 py-3 rounded-xl border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-slate-200 font-medium text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回修改档案
                </button>
                <button
                  id="to-stage-3-btn"
                  type="button"
                  onClick={handleNextToBacktrack}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer"
                >
                  时空选锚：回溯时光起点
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: Backtrack selection & specification */}
          {setupStep === "backtrack" && (
            <motion.div
              key="step-backtrack"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
              id="step-backtrack-container"
            >
              <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-4 border border-slate-800/60 space-y-3" id="backtrack-nodes-choice-group">
                <h3 className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5 mb-1 uppercase tracking-wider font-mono">
                  <Hourglass className="w-4 h-4 text-violet-400" /> 第三步：叩问过去 选定重启时空锚点
                </h3>
                <p className="text-slate-400 text-[10px] leading-relaxed">
                  你想回到现实人生中的哪一个核心关卡？点击即可瞬间完成时空测算与锚定：
                </p>

                <div className="grid grid-cols-2 gap-2.5" id="regression-keys-grid">
                  {Object.entries(getDynamicTemplates()).map(([key, template]) => (
                    <button
                      id={`regression-select-btn-${key}`}
                      key={key}
                      type="button"
                      onClick={() => setRegressionNodeKey(key)}
                      className={`p-3 rounded-2xl border text-xs text-left transition-all flex flex-col gap-1 relative overflow-hidden ${
                        regressionNodeKey === key
                          ? "bg-indigo-950/40 border-indigo-500 text-indigo-100 shadow-md shadow-indigo-900/20"
                          : "bg-slate-950/45 border-slate-800/80 hover:border-slate-700 hover:text-slate-200 text-slate-400"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold">
                        <span>{template.icon}</span>
                        <span>{template.title}</span>
                      </div>
                      
                      <div className="text-[9px] text-slate-400 font-sans italic line-clamp-1 border-t border-slate-850/40 pt-1 mt-0.5" title={template.milestoneText}>
                        &ldquo;{truncateText(template.milestoneText, 22)}&rdquo;
                      </div>

                      <div className="flex items-center justify-between w-full text-[9px] mt-0.5 pt-0.5 border-t border-slate-900/30">
                        <span className="text-[8px] text-slate-500 scale-90 origin-left">{template.desc}</span>
                        <span className="text-violet-400 font-semibold bg-violet-500/10 px-1 py-0.2 rounded text-[8px] scale-90 origin-right whitespace-nowrap">
                          约 {template.age} 岁
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Backtrack core details form */}
              <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-4 border border-slate-800/60 space-y-3" id="anchor-editing-group">
                <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                  <span className="text-xs font-semibold text-indigo-300 font-mono">量子通道调参：当前时空锚点</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 font-mono">调遣年龄:</span>
                    <input
                      id="regression-age-input"
                      type="number"
                      min={7}
                      max={80}
                      value={regressionAge}
                      onChange={(e) => setRegressionAge(Math.min(80, Math.max(7, parseInt(e.target.value) || 18)))}
                      className="w-10 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-center text-xs text-indigo-300 font-bold font-mono outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1" id="detailed-retro-context">
                  <label className="block text-[11px] text-slate-400 font-medium">那个时间点当时的具体情况与情感困局：</label>
                  <textarea
                    id="regression-situation-input"
                    rows={4}
                    value={regressionSituation}
                    onChange={(e) => setRegressionSituation(e.target.value)}
                    className="w-full text-xs font-sans bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl p-3 text-slate-200 outline-none resize-none leading-relaxed"
                  />
                  <p className="text-[9px] text-slate-500 font-sans leading-normal">
                    * AI将基于这段真实的前后文，在那个岁数为您生动交融编织第一个交互的小说场景。
                  </p>
                </div>

                <div className="space-y-1" id="detailed-retro-choices">
                  <label className="block text-[11px] text-slate-400 font-medium">设计你当时面临着的、梦寐以求探索的分支选择：</label>
                  <textarea
                    id="regression-choices-input"
                    rows={3}
                    value={regressionChoices}
                    onChange={(e) => setRegressionChoices(e.target.value)}
                    className="w-full text-xs font-mono bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl p-3 text-emerald-300 outline-none resize-none leading-normal"
                    placeholder="格式（例）：&#13;A. 听从调排填报稳当专业&#13;B. 强改密码卡报第一狂想专业"
                  />
                  <p className="text-[9px] text-slate-500 leading-normal">
                    * 请列出你可以选择的方向，这三个选项将无缝转化为您降生后，18岁面对的第一个宿命抉择！
                  </p>
                </div>
              </div>



              {validationError && (
                <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-xs text-red-300 flex items-center gap-1.5" id="val-err-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {validationError}
                </div>
              )}

              <div className="flex gap-3" id="navigation-block-3">
                <button
                  id="back-to-stage-2-btn"
                  type="button"
                  onClick={() => setSetupStep("milestones")}
                  className="flex-1 py-3.5 rounded-xl border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-slate-200 font-medium text-xs flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回过往调查
                </button>
                <button
                  id="launch-oracle-button"
                  type="button"
                  onClick={handleStartSubmit}
                  disabled={isLoading}
                  className="flex-grow py-3.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-950/50 disabled:opacity-50 flex items-center justify-center gap-1.5 uppercase font-mono tracking-wider"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      正在生成背景补全问题...
                    </>
                  ) : (
                    <>
                      签订契约 • 启动时空倒流
                      <Sparkles className="w-4 h-4 text-violet-300 animate-pulse" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
