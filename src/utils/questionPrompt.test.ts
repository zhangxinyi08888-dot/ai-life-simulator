import assert from "node:assert/strict";
import { buildQuestionPrompt } from "./questionPrompt";

const prompt = buildQuestionPrompt({
  birthday: "2005-06-01",
  birthtime: "08:30",
  gender: "女",
  coreStoryFocus: "selftruth",
  regressionAge: 18,
  regressionSituation: "高考后填志愿，家里希望我报本地普通信息工程，但我想去外地学服装设计。",
  regressionChoices: "报服装设计、听家里安排、复读一年",
  milestones: [
    {
      id: "gaokao",
      title: "高考与志愿",
      content: "分数过了本科线，但美术基础和家庭预算都不稳定。"
    }
  ],
  currentSituation: "",
  isReturnToPast: true,
  targetAgeNode: "",
  regressionNodeKey: "gaokao"
});

assert.match(prompt, /剧本关键背景补全工具/);
assert.match(prompt, /18 岁/);
assert.match(prompt, /高考后填志愿/);
assert.match(prompt, /事实背景追问/);
assert.match(prompt, /人物状态追问/);
assert.match(prompt, /行动条件追问/);
assert.match(prompt, /分数、录取线、家庭预算、专业兴趣、城市选择/);
assert.match(prompt, /只能作为提问角度/);
assert.match(prompt, /不能凭空编造现实事实/);
assert.match(prompt, /每个问题必须提供 4-5 个/);
