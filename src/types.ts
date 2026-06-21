/**
 * Shared Type Definitions for AI Life Simulator
 */

export interface LifeAttributes {
  happiness: number;   // 幸福度 (0 - 100)
  intelligence: number; // 智商/才干 (0 - 100)
  wealth: number;       // 财富/资源 (0 - 100)
  relation: number;     // 人际/情商 (0 - 100)
  health: number;       // 健康/精力 (0 - 100)
}

export interface UserInitialData {
  birthday: string;          // 出生日期: YYYY-MM-DD
  birthtime: string;         // 出生时间: HH:MM or unspecified
  gender: string;            // 性别
  currentSituation: string;  // 现实中当前的情况描述
  isReturnToPast: boolean;   // 是否选择回溯/回到过去某个时间点
  targetAgeNode: string;     // 回溯年份或时间节点说明

  // 主要人生节点记录 (高考、升学、找工作、换工作、裁员、恋爱、结婚等)
  milestoneGaokao?: string;       // 高考与升学情况 (如：哪年高考，留下了哪些志愿遗憾)
  milestoneCareer?: string;       // 找工作、换工作与离职裁员经历
  milestoneRelationship?: string; // 情感、恋爱与结婚进展与遗恨
  milestoneOther?: string;        // 其他宿命机遇或危机回忆
  milestones?: { id: string; title: string; content: string; icon?: string; placeholder?: string; presetTemplate?: string }[];

  // 用户自主选择时光倒流回溯的节点、当时的困境和曾经的选择
  regressionNodeKey: string;      // 回到的节点标识 ("gaokao" | "career" | "layoff" | "romance" | "marriage" | "custom" 等)
  regressionAge: number;          // 回溯起点年龄
  regressionSituation: string;    // 该节点当时的前后文细节及困厄
  regressionChoices: string;      // 当时面临的纠结选择、或梦寐以求想要做的其它选项
  coreStoryFocus: string;         // 核心主线设定 ("career" | "romance" | "wealth" | "selftruth" | "innerpeace")
}

export interface QuestionTurn {
  id: number;
  question: string;
  answer: string | null;
}

export interface QuestionItem {
  question: string;
  suggestions: string[];
}

export interface SimulationChoice {
  id: string;               // "A", "B", "C", "custom"
  text: string;             // 选项文本
  impactSummary: string;    // 选项潜在线索提示或意味
}

export type LifeEventCategory = "career" | "relationship" | "health" | "opportunity";

export interface EventMeta {
  eventId?: string;
  eventCategory?: LifeEventCategory;
  eventTags: string[];
}

export interface SimulationNode {
  age: number;              // 当前模拟的年龄
  stage: string;            // 人生阶段: "学步懵懂", "金石华年", "立身扬名", "不惑风雨", "桑榆暮景", "终章致敬" 等
  title: string;            // 本节标题
  description: string;      // 描述性互动小说正文
  choices: SimulationChoice[]; // 三个预设选项 + 支持自定义
  attributes: LifeAttributes;  // 更新后的五维属性值
  isEndingNode: boolean;       // 是否已到达人生终点
  eventMeta?: EventMeta;        // 触发本节点的事件种子元数据，用于冷却与同类限制
}

export interface HistoryItem {
  age: number;
  title: string;
  stage: string;
  description: string;
  selectedChoice: string;
  attributes: LifeAttributes;   // 存储该历史节点当时的属性状态，支持高保真时光回溯
  eventMeta?: EventMeta;
}

export interface PersonalityInsight {
  lifeTitle: string;        // 终极人生称号
  epitaph: string;          // 温暖且深刻的人生志铭
  personalityTraits: {
    trait: string;          // 特质名称
    score: number;          // 得分 (0-100)
    description: string;    // 详细表现描述
  }[];
  detailedAnalysis: string; // 深度心理与性格剖析
  realLifeAdvice: string;   // 针对现实生活的温情建议
  growthAdvice: string;     // 针对个人成长的具体建议 (Personal Growth)
  decisionAdvice: string;   // 针对重大决策的决策学建议 (Decision Making Wisdom)
  wellnessAdvice: string;   // 针对身心调适与幸福保障的健康建议 (Well-being & Mindful-care)
}
