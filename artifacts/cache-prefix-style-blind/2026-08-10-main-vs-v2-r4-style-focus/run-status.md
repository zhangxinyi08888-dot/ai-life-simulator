# 文风专项真实成对测试状态

- 计划：12 对、24 次真实模型生成
- 有效完成：10 对、20 次真实模型生成
- 有效题材：5 类，每类 2 次重复
- 同输入配对：10/10 对 `samePromptInput=true`
- 调用顺序：main 先 5 对，V2/r4 先 5 对
- 盲标签：A=main 5 对，A=V2/r4 5 对
- 新模型校验失败：0
- 新 `attributesRange` 失败：0
- 模型调用前的设置错误：2 次，已移入 `setup-failures/`，不计入样本
- 基础设施阻断：1 次；`relationship-cohabitation-r1` 被浏览器安全审查阻断，不是模型生成失败
- 取消：1 对；基础设施阻断后没有绕过限制继续调用
- 完整 2/2/1：未运行，本轮是文风专项短样本验证

## 固定标识

- main 提交：`7748a6419dadfcb25d1511f4cabd1e7da7f513eb`
- V2/r4 候选：`cache-prefix-v2-reference-context-r4`
- V2/r4 候选源码 SHA-256：`f8e20a7a7882d9f89aac5d3acf3543352fbe3609bfa18e6f00b2e49746e59344`
- 盲审包 SHA-256：`5b7e3f6f7261012ea7c5ccba44aaad019b409785930c044fe7a9e620b3d9021d`
- 揭盲前 Codex 评分 SHA-256：`1ff120f1f1b5e42767560d135a89101a4c7dc65809721691e5d02952fe5854d6`

## 当前判定

- 揭盲结果：V2/r4 8 胜、main 2 胜、0 平
- 七维总均值：main 3.414/5，V2/r4 3.829/5
- 独立人工复核：已完成；V2/r4 6 胜、main 4 胜，七维总均值 3.329:2.729
- 人工与 Codex 逐组胜者一致：8/10；分歧为 S08、S10
- 发布级质量结论：尚不能给出；既有 `relationship-03` 的 `attributesRange` 失败仍需处理和复测
