export interface ScenarioPreset {
  title: string;
  situation: string;
  isReturn: boolean;
  targetAge?: string;
  icon: string;
}

export const SITUATION_PRESETS: ScenarioPreset[] = [
  {
    title: "迷茫毕业生",
    situation: "刚大学毕业，在大城市合租房里，简历投出去石沉大海，拿着低微的实习工资，对未来深深困惑并自我怀疑。",
    isReturn: false,
    icon: "🎓"
  },
  {
    title: "倦怠期打工人",
    situation: "在职场打拼了5年，按部就班生活。虽然收入稳定，但感到日复一日的重复，身体亚健康，失去了年轻时的灵气与抱负。",
    isReturn: true,
    targetAge: "18岁高考志愿填报前夕",
    icon: "💼"
  },
  {
    title: "考研/考公失意者",
    situation: "在自习室里不知疲倦地拼搏了一年多，面临名落孙山后的尴尬期。身边的同学已经结婚或者工作，自己在风口不知去向。",
    isReturn: true,
    targetAge: "15岁上高一的那个秋天",
    icon: "📚"
  },
  {
    title: "渴望自由的隐忍青年",
    isReturn: true,
    targetAge: "7岁刚戴上红领巾上小学的那天",
    situation: "在非常严厉的家庭环境中长大，从小什么都被规划。现在想要回到童年，按照真正的自我直觉做出不同选择，看看能不能活得更自由。",
    icon: "🪁"
  }
];

export const OTHER_START_NODES = [
  { label: "不回到过去，从现在的真实困局出航", value: "不回溯，直面当下", isReturn: false },
  { label: "回到 18 岁高考誓师大会那一天", value: "18岁誓师大会", isReturn: true },
  { label: "回到 15 岁情窦初开、升上高中的起点", value: "15岁升高一", isReturn: true },
  { label: "回到 10 岁无忧无虑捕蝉捕蜻蜓的小学暑假", value: "10岁小学夏日", isReturn: true },
  { label: "回到 22 岁走出校门、揣着500元去大城市的傍晚", value: "22岁刚毕业傍晚", isReturn: true }
];

export const INITIAL_SUGGESTIONS_FOR_QUESTIONS_PRESETS: Record<number, string[]> = {
  0: [
    "我想弥补曾经放弃爱人的遗憾，给他/她更坚定的守护。",
    "我想要纯粹地追寻财富，在这个时代先活出物质自由。",
    "我希望抛开一切标签，追求艺术、自然与真正的独立自由。"
  ],
  1: [
    "我更看重能在危机时刻拉住我的家人和真挚挚友。",
    "我更相信自己手中的力量和无可替代的智力才干。",
    "我希望在人海中保持平淡，但拥有一片健康的内心旷野。"
  ],
  2: [
    "我的焦虑源于对未知的恐惧以及害怕虚度了一生。",
    "我害怕自己到头来辜负了所有爱护我的人的期待。",
    "我感到焦躁的是被迫在世俗标准里生存，丧失了自我价值。"
  ]
};
