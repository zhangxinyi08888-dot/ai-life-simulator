# Main 与 V2/r4 成对盲评揭盲裁决

- 日期：2026-08-10
- 原始盲评包：`reviewer-packet.md`
- 原始盲评包 SHA-256：`1a366b30dd6dc1c61d09fbe932aee3013d754d977c6edc98319f9ac9c755e0e4`
- 第一轮记录 SHA-256：`0500213eb3ec9f16a64b98699c48f90d310b8a75830178928537236d881f1ce6`
- 顺序反转包 SHA-256：`a4e5e0426a6789a8454b52a86827c190f160e52acc0764f84bb2adcca8d1521b`
- 第二轮记录 SHA-256：`a9e95bd8cb53d0fd452291eb78ded4a4f2329db2c3be8357c94a2caec3d8286d`
- 揭盲来源：`audit-manifest.json`
- 当前基线：main commit `7748a6419dadfcb25d1511f4cabd1e7da7f513eb`
- 修改后版本：`cache-prefix-v2-reference-context-r4`
- 修改后源码 SHA-256：`f8e20a7a7882d9f89aac5d3acf3543352fbe3609bfa18e6f00b2e49746e59344`

## 揭盲后的逐节点胜负

| 节点 | 路线 | A 来源 | B 来源 | 两轮较优标签 | 真实胜方 |
|---|---|---|---|---|---|
| N01 | career | main | V2/r4 | A | main |
| N02 | career | main | V2/r4 | A | main |
| N03 | career | main | V2/r4 | A | main |
| N04 | career | V2/r4 | main | B | main |
| N05 | career | V2/r4 | main | B | main |
| N06 | relationship | main | V2/r4 | B | V2/r4 |
| N07 | relationship | main | V2/r4 | B | V2/r4 |
| N08 | relationship | main | V2/r4 | B | V2/r4 |
| N09 | relationship | V2/r4 | main | A | V2/r4 |
| N10 | relationship | V2/r4 | main | A | V2/r4 |

## 汇总

- 总胜/平/负（V2/r4 相对 main）：`5 / 0 / 5`。
- career：V2/r4 `0 / 0 / 5`；main 五个节点全部胜出。
- relationship：V2/r4 `5 / 0 / 0`；V2/r4 五个成功节点全部胜出。
- 两轮节点胜方一致：`10/10`。
- 顺序反转的五个节点中，首位版本胜 `2/5`、第二位版本胜 `3/5`，未观察到固定首位优势。

## 四维评分（10 个成功输出）

| 真实版本 | 前情 | 现实/状态 | 选择 | 文风 | 四维总均分 |
|---|---:|---:|---:|---:|---:|
| main | 4.50 | 3.90 | 4.30 | 3.90 | 4.150 |
| V2/r4 | 4.30 | 3.80 | 4.30 | 4.10 | 4.125 |

总均分只差 `0.025`，不构成有意义的整体质量优势。V2/r4 文风均分高 `0.20`，但 main 在前情和现实一致性上分别高 `0.20`、`0.10`。

## 重大问题与失败门禁

- main N06：三个选择为通用占位表达，未处理关系、外派和父母照护冲突。
- main N07：幸福 `58→-2`、才智 `72→2`，正文没有足以解释量级崩落的事件。
- main N10：调回申请重复提交，且标题写 30 岁、结构化时间为 31 岁。
- V2/r4 另有一个未进入 10 对成功样本的 `relationship-03` 生成失败；两次可见重试均触发 `SIMULATION_NODE_INCOMPLETE:attributesRange`。该失败已保留在 `failures/relationship-03.json`。

## 裁决

成功生成的内容中，V2/r4 与 main 整体为平局，未发现统一的文风退化；V2/r4 在关系线及文风维度更好，但在职业线明显落后。由于 V2/r4 存在独立、可复现的生成失败，本轮不能给出“在不牺牲当前生成质量和可用性的前提下通过”的验收结论，应判定为：`需修复后复测`。

本次顺序反转由同一审阅人连续完成，只能作为顺序偏差控制，不等同于第二位独立人工审阅人。
