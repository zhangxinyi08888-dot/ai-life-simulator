# 关系线合并前自测记录（2026-07-20）

## 1. 当前结论

状态：**已集成最新 `origin/main`；集成冲突、自动化门禁和关系线 R4 冒烟均已处理并通过，可以进入提交前范围复核。**

已经通过：

- 分支范围检查：未包含画像系统、财务账本架构 spec 或 `financialNarrative.ts` 修改；
- R0/R1 权威关系合同补测；
- R2 每场景 20,000 次真实候选池调度抽样；
- R3 权威状态长路线；
- 修复家庭状态未注入 prompt 的缺口；
- 修复爱情选项文本与 outcome 授权不一致的缺口；
- 爱情继续、保持认识、拒绝三种 outcome 的真实事务闭环；
- 父母支持、反对两种权威状态初始化及下一节点叙事一致性；
- 自然语言明确伴侣的初始化与连续两节点稳定性；
- 第二条独立无父母事业路线连续三节点未误激活家庭；
- 最终自动化回归：198/198、lint、build、`git diff --check` 全部通过。

集成后结果：

- 分支已快进到 `origin/main@95a013e415650e02b9905ae925622617555058ba`；
- `prompts.test.ts` 与 `simulationService.ts` 两处冲突已按双方契约合并，上游权威财务开账和本分支关系初始化均保留；
- 自动化门禁：259/259、lint、build、`git diff --check` 全部通过；
- R4 冒烟最初暴露两个关系校验缺口，修复后父母反对与爱情形成/提交路线均通过；详见第 9、11 节。

### 本轮实际执行的 R4 路线

| 路线 | 已到达 | 结果 |
|---|---:|---|
| `career-no-family-1-retry` | 无父母、无伴侣事业路线 10 节点 | 通过；自然命中爱情形成，继续后创建唯一 `accepted_character + exploring` |
| `career-no-family-2-fixed` | 独立新 seed 无父母事业路线 5 节点 | 通过；前 3 节点 familyRelationships 为空，第 4 节点独立命中爱情形成，第 5 节点提交“苏晚” exploring |
| `career-parent-support-fixed-2` | 父母支持路线起点 + 1 节点 | 通过；单一 `parent_unspecified`，`supportive + available + high`，叙事沿用支持 |
| `career-parent-opposed-fixed-3` | 父母反对路线起点 + 1 节点 | 通过；单一 `parent_unspecified`，`opposed + unavailable + mixed`，叙事保持反对与无实际帮助 |
| `career-no-family-1-retry`（continue） | 无伴侣爱情形成 | 通过；形成正文、人物、三项 outcome、evidence 与原子提交均正确 |
| `career-no-family-2-fixed`（第二次独立形成） | 无伴侣爱情形成 | 通过；业务咖啡假阳性被拦截后，重新生成共同兴趣与私人邀约，并原子提交“苏晚” |
| `career-no-family-romance-acquaintance-fixed` | 保持普通认识（额外覆盖） | 通过；不创建人物/浪漫关系，记录 romance cooldown |
| `career-no-family-romance-decline-fixed` | 拒绝爱情形成 | 通过；不创建人物/浪漫关系，`refusalCount=1` |
| `career-initial-partner-fixed` | 自然语言初始伴侣 + 2 节点 | 通过；`cohabiting + active + 0.9` 持续，未投放新相遇 |
| `romance-formation-fresh` | latest-main 全新开局 + 定向 romance + continue | 通过；“小杨”进入唯一 `accepted_character + exploring + 0.9`，version 2 财务账本正常提交 |
| `parent-opposed-after-fix` | 本轮全新父母开局 + 修复后 1 节点 | 通过；`opposed + unavailable + mixed` 与正文一致，不再自行软化 |

历史失败路线仍保留在同一 run root，分别对应 REL-R4-001/003/004/005，未用替换 persona 覆盖失败证据。

## 2. 确认 Bug

### REL-R4-001：非爱情行动错误授权为 `continue_getting_to_know`

严重度：阻断合并
来源：真实 AI 浏览器路线 `career-no-family-1`
证据：`/tmp/relationship-premerge-20260720-KocENf/working/career-no-family-1.json`

触发过程：

1. 事业路线第 2 个普通节点自然抽到 `romance_new_connection`；
2. 模型返回的三个选项中：
   - “继续推进团队扩张，把精力集中在客户增长上”被标为 `continue_getting_to_know`；
   - “放慢扩张节奏，先打磨产品深度……”被标为 `keep_as_acquaintance`；
   - “与林悦保持专业联系，同时通过她拓展行业人脉”再次被标为 `continue_getting_to_know`；
3. 用户选择第三项后，代码按 outcome 确定性创建了人物“林悦”和 `exploring` relationship。

实际问题：

- Proposal/reducer 事务是正确的，但用户选择的实际行动没有明确授权浪漫探索；
- 校验器只检查 outcome 是否属于 allowedOutcomes，以及三个选项是否至少覆盖两个 outcome；
- 两个重复的 `continue_getting_to_know` 仍可通过，选项文本与 outcome 的语义错配也未被识别；
- 最终形成“状态可靠提交，但授权事实错误”的关系。

已实施修复：

- 爱情形成和确认事件的三个 choice 必须一一覆盖三个 outcome，不能重复；
- 增加 `romanceChoiceSemantics` 校验，事业扩张、行业人脉等行动不能承载爱情 outcome；
- retry prompt 明确要求每条文案直接表达对应关系动作；
- DecisionGate 等后续重写完成后，再执行一次最终事件授权合同校验；
- 新增真实失败样例和正确样例的回归测试。

当前状态：**已关闭。真实路线已验证三项选择语义，并分别完成 continue / acquaintance / decline 事务结果。**

### REL-R4-003：爱情形成事件在真实生成中连续被 `romanceChoiceSemantics` 拒绝

严重度：阻断合并
来源：修复后真实 AI 浏览器路线 `career-no-family-1-retry`
证据：`/tmp/relationship-premerge-20260720-KocENf/working/career-no-family-1-retry.json`

触发过程：

1. 无父母、无伴侣的事业路线推进到第 9 个节点时，调度器自然选中了爱情形成事件；
2. 第一次流式正文已经写出与“林悦”的新接触，但生成未能提交；
3. 页面显示可恢复暂停后点击“继续生成”，第二次请求完整运行；
4. 第二次正文退回纯事业叙事，没有真正呈现爱情形成场景；
5. 最终仍被 `SIMULATION_NODE_INCOMPLETE:romanceChoiceSemantics` 拒绝，历史从待提交的 9 回滚为 8。

实际问题：

- 这次第二次失败没有发生浏览器控制中断，属于可复现的产品路径；
- 当前 retry 仍让模型重新生成整个节点，并要求模型同时遵守爱情事件、三个唯一 outcome 和选项文案语义；
- retry prompt 虽然列出了规则，但模型仍可能忽略爱情 intent，回到事业主线正文与选项；
- 校验器正确阻止了错误授权，但恢复机制可能重复得到同一错误，爱情线仍存在“能被调度、不能稳定形成”的断点。

已实施修复：

- 模型继续负责正文和 `activeCharacters`，代码按 `(eventIntentType, outcomeId)` 确定性修复爱情选项结构；
- 结构问题在首次响应后局部修复，不再因为选项字段错误重写整段正文；
- 增加 `romanceNarrativeGrounding`，正文必须真实出现候选人物和相遇场景；职业/商务联系人还必须出现私人交流、个人兴趣或轻量私人邀约，不能只靠“认识、加微信”被登记成爱情；
- proposal evidence 改为提取包含候选人物姓名的正文段落；
- 真实页面复验已生成“林悦”节点，包含展会晚宴、个人阅读与职业理念交流、周末咖啡；三项分别唯一映射 continue / acquaintance / decline，页面无生成暂停；
- 证据已更新至 `/tmp/relationship-premerge-20260720-KocENf/working/career-no-family-1-retry.json`。

当前状态：**已关闭。continue 后建立 `person_romance_9f1f0ca2` 与 `romantic / exploring / active / 0.9`，下一节点读取同一权威身份。**

### REL-R4-005：明确的现任伴侣事实被降级为 `model_inferred`，没有建立初始关系

严重度：阻断初始伴侣路线验收
来源：真实 AI 浏览器路线 `career-initial-partner-1`
证据：`/tmp/relationship-premerge-20260720-KocENf/working/career-initial-partner-1.json`

输入事实：用户在回溯事件和追问答案中分别填写“与交往三年的伴侣小陈共同生活”和“伴侣小陈有稳定工作，我们已经交往三年并共同租房”。

实际结果：

- `people` 中生成了 `partner:current`；
- 但人物来源为 `model_inferred`、confidence=0.55、lifeStatus=`unknown`；
- `relationships` 仍为空，因此 `confirmed_partner` 不成立；
- 后续仍可能错误开放新的爱情形成事件。

代码原因：当前伴侣确认正则只识别“现任/现在和/现在与/丈夫/妻子/老公/老婆/已婚/正在恋爱/恋爱中”等固定形式，没有识别“与交往多年的伴侣共同生活”这类同样明确的用户陈述。

已实施修复：扩展明确现任伴侣的自然语言识别，覆盖“与交往多年的伴侣共同生活/共同租房/稳定交往”等表达，并新增回归测试。

当前状态：**已关闭。`career-initial-partner-fixed` 起点即建立 `cohabiting + active + 0.9`，连续两节点保持同一人物与关系。**

### REL-R3-002：父母权威关系状态没有注入下一节点 prompt

严重度：阻断家庭叙事验收
来源：R3 长路线准备阶段的代码与 prompt 检查

触发条件：

- `FamilyRelationshipState` 已记录 `supportive`、`concerned_but_respectful`、`opposed` 等议题立场；
- 下一节点 prompt 只注入普通 `relationships`，没有注入 `familyRelationships/topicStances`。

影响：

- 模型无法沿用已经接受的父母立场；
- 已记录的“支持”或“担忧但尊重”可能在后续节点重新被写成反对或施压；
- 家庭 reducer 虽然正确，但“下一节点只读取权威状态”的闭环没有真正成立。

已实施修复：

- 增加【当前权威家庭关系状态】prompt 段落；
- 注入 role、activation、联系、情感/现实支持、自主尊重、冲突强度和 topicStances；
- 明确 `unknown` 不得解释为反对、保守、冷漠或控制；
- 增加支持、担忧但尊重、反对以及议题更新的测试。

当前状态：**已关闭。父母支持与反对路线均验证下一节点读取并保持权威家庭状态。**

### REL-R4-004：未区分的“父母”被拆成父亲和母亲，且用户支持事实没有进入权威状态

严重度：阻断家庭路线验收
来源：真实 AI 浏览器路线 `career-parent-support-1`
证据：`/tmp/relationship-premerge-20260720-KocENf/working/career-parent-support-1.json`

输入事实：用户明确填写“父母支持我自己做决定，不要求我求稳；搬家时愿意提供实际帮助”。

实际结果：

- 父母线被成功激活；
- 系统创建了 `father` 和 `mother` 两个人物与两条家庭关系；
- 两条关系的 `emotionalSupport`、`practicalSupport`、`autonomyRespect`、`conflictIntensity` 全部为 `unknown`，`topicStances` 为空；
- 初始正文正确复述了支持和实际帮助，但权威状态没有承接这些用户事实。

与 spec 的冲突：

- spec §8.3 要求只出现“父母”而无法区分双方时使用 `parent_unspecified`，不得复制成父亲和母亲；
- spec §9.3 允许已接受的“尊重最终决定”和“提供实际帮助”分别形成议题支持、自主尊重或实际支持事实；
- 当前实现只完成了“可信激活”，没有完成“可信初始立场写入”，导致下一节点 prompt 仍只能看到未知关系。

已实施修复：

- 未区分的“父母”只建立一条 `parent_unspecified`，不再复制为 father/mother；
- 初始化时将用户明确陈述的实际支持、自主尊重和事业议题支持/反对写入权威家庭状态；
- 事实来源记录为 `user_fact`，避免把模型正文作为父母关系激活依据。

当前状态：**已关闭。支持与反对路线均只创建一个 `parent_unspecified`，初始立场和实际支持事实正确进入权威状态。**

对照复验：`career-parent-opposed-1` 明确输入父母反对、要求求稳并撤回搬家帮助。初始正文正确写出压力，但权威状态仍与支持路线一样全部为 `unknown`，并再次错误拆成 father/mother 两条记录。由此确认支持与反对事实都会在初始化边界丢失，不是单一文案偶发。

## 3. 修复过程中新增发现（已加防护，待完整回归）

### REL-DEV-006：确定性选项修复曾把纯商务联系人误包装成爱情入口

现象：第一版局部修复能够把错误的爱情选项改成三个合法 outcome，但正文中的人物只是“华东代理商”，互动只有业务合作。若只修选项结构，代码会替用户创造正文并未成立的浪漫授权。

根因：结构修复只检查 `activeCharacters` 和姓名是否出现，没有验证人物是否真正进入私人/浪漫语境。

处理：新增 `romanceNarrativeGrounding`。职业、客户、供应商、商务合作等人物除了出场外，还必须有个人兴趣、工作之外的交流、私人会面或轻量邀约等证据；否则拒绝形成 proposal。已增加“纯商务联系人不得形成爱情”的测试。

状态：**开发中发现并已修复；最新真实节点通过该门槛。**

### REL-DEV-007：确定性 proposal 的 evidence 曾错误引用事业段落

现象：正文后半段已经写出候选人物，但第一版代码总取正文首段作为 evidence，导致 evidence 与人物形成事实不一致。

根因：evidence 截取规则只按段落顺序，不按候选人物定位。

处理：优先选择包含 `activeCharacters[candidateOrdinal].displayName` 的段落。最新真实节点的两条 proposal 均引用包含“林悦”的相遇段落。

状态：**已修复并有定向测试及真实页面证据。**

### REL-DEV-008：运行中的 PressureArc 事件选择未使用稳定 entropy

现象：补测时，同一 seed 的长路线在存在 active PressureArc 后仍可能选择不同事件，导致确定性测试漂移。

根因：普通线路选择已经透传稳定 `SelectionEntropy`，但 Arc continuation 分支仍直接调用未带 entropy 的事件选择，回落到裸随机。

处理：Arc continuation 与普通事件选择统一透传同一稳定 entropy。

状态：**已修复并通过定向测试及最终 198/198 完整回归。**

### REL-DEV-009：单个冷却选项导致整个下一节点连续失败

现象：爱情形成选择 continue 与 keep 后，下一节点多次暂停。透明化错误后确认具体原因为 `repeats-recently-passed-option`，不是关系 Proposal 失败。

根因与处理：

- DecisionGate 把任意一个冷却/dormant intent 当成整节点失败；模型重写仍返回该选项时会再次必然拒绝；
- repair 后若至少还有两个非冷却实质选项，代码只移除命中项并重新评估，不再否决整节点；
- dormant 增加 8 个决策节点有效期，不再永久封号；
- `node-density-exceeded` 仅限制候选自身为 high/critical 的节点，普通生活节点不再被历史高压密度误杀；
- DecisionGate 最终失败透传具体 reasonCodes，UI 显示真实 message。

状态：**已修复；198/198、lint、真实 keep 路线均通过。**

### REL-DEV-010：“不要求我求稳”被误判为父母反对

现象：`career-parent-support-fixed` 已正确建立 `practicalSupport=available`、`autonomyRespect=high`，但 topic stance 被错误写成 `opposed`。

根因：反对正则匹配了否定短语中的“要求…求稳”。

处理：提取反对语义前先移除“不要求/不会要求/不再要求……”片段，并补充真实原句回归；同时对父母关系摘要做句子去重。

状态：**已修复；`career-parent-support-fixed-2` 得到 `supportive + available + high`。**

### REL-DEV-011：父母正文擅自改变立场，权威状态未变化

现象：首轮反对路线下一节点写“父母从反对转为观望、不再直接反对”，但 `FamilyRelationshipState` 仍为 `opposed`。

根因：prompt 注入了权威状态，却没有禁止正文在没有已提交 `parent_topic_stance` 时自行宣布关系变化，也没有后置一致性校验。

处理：

- prompt 明确 description 只能沿用已接受状态；
- StoryConsistency 新增 `family_authority_conflict`，拦截未经提交的“从反对转为支持/观望”“不再反对”以及实际帮助事实反转；
- 冲突节点进入一致性修复，不能以正文先写、状态不写的方式通过。

状态：**已修复；`career-parent-opposed-fixed-3` 后续正文仍保留“稳定最重要”和不提供实际帮助，权威状态一致。**

### REL-DEV-012：“周末喝咖啡谈项目”被误认成爱情形成

现象：第二条独立无父母路线自然命中 `romance_new_connection` 后，模型写出一名教育信息化创业者，互动全部围绕 SaaS 项目、技术和商业互补；代码仅因“周末喝咖啡”通过 grounding，并将纯合作机会改写成爱情选项。

根因：第一版 `romanceNarrativeGrounding` 把咖啡、周末见面等场所信号直接当成私人关系证据，没有判断会面的实际目的。

处理：

- 职业人物必须出现个人生活、共同兴趣、明确好感或非业务目的的私人邀约；
- 同段仍围绕项目、合作、产品、投资、客户等内容时，“加微信/周末/咖啡”不再构成爱情证据；
- retry prompt 要求保留事业背景但单独生成一个离开业务语境的私人接触段落；
- `SIMULATION_NODE_INCOMPLETE` 的具体校验项透传到 UI。

真实复验：原“创业者谈项目”节点被 `romanceNarrativeGrounding` 拒绝并回滚；同一确定性事件重新生成“苏晚”，正文包含共同徒步/摄影兴趣和科技艺术展邀约，随后提交唯一 `accepted_character + exploring + 0.9`。

状态：**已修复；第二条独立爱情形成路线通过。**

## 4. 运行异常（暂不归类为产品 Bug）

### TEST-RUNTIME-001：批量推进超过控制窗口

现象：连续推进第 4–6 个真实 AI 节点时，自动批次长时间没有返回。

诊断结果：

- 中断后页面结构化状态显示 `isLoadingNext=false`、`errorMsg=null`，历史已从 3 推进到 4；
- 说明批次内至少一个节点已正常完成，等待时间是多个真实 AI 请求累计，不是确定的应用软锁；
- 后续改为一次只推进一个节点。

状态：**测试工具运行策略问题，不计入产品缺陷。**

### TEST-RUNTIME-002：强制中断请求后页面显示“AI 返回内容格式异常”

现象：手工终止浏览器控制批次后，页面保留流式正文但没有 choices，显示“生成暂时停在这里”。

诊断结果：

- 该请求是在外部强制中断期间被取消，不能证明自然运行也会失败；
- 点击“继续生成”后同一路线恢复，历史从 4 推进到 5，生成三个选择；
- 页面恢复机制有效。

状态：**由测试中断触发，不计入产品 Bug；保留为恢复路径证据。**

### TEST-RUNTIME-003：单节点真实 AI 响应超过 180 秒

现象：修复后路线第 7 次推进在 180 秒以上仍未返回自动化结果。

当前证据不足：

- 自动化被人工终止，未取得最终页面结构化状态；
- 可能是上游 AI 延迟、重试循环、浏览器控制等待或节点最终校验失败；
- 在读取完成状态前，不能归因为产品软锁或本次关系线改造。

状态：**未分类异常，后续需要在不强制中断的单节点模式下复现并读取日志。**

### TEST-RUNTIME-004：父母反对路线首次背景追问返回非法 JSON

现象：`career-parent-opposed-fixed` 在生成三条背景追问时返回 `AI 返回内容不是合法 JSON`，尚未进入关系初始化。

处理与结论：保留该失败，不计为父母逻辑缺陷；使用新 route slug `career-parent-opposed-fixed-2` 从零重试后正常进入模拟。说明真实 AI 入口仍存在偶发结构化响应失败，但恢复后关系状态正确。

## 5. 合并前异常与风险（已处理）

### MERGE-RISK-001：当前分支落后 `origin/main` 19 个提交，且存在核心文件重叠

性质：合并准备风险，不归类为关系线产品 Bug

当时检查结果：

- 当前分支状态为 `behind 19`；
- 上游新增内容主要属于财务现实闭环和真实浏览器证据；
- 但上游也修改了本分支正在修改的 `prompts.ts`、`prompts.test.ts`、`simulationService.ts`、`simulationService.test.ts`；
- 因此当前 198/198 只证明本分支基线自身通过，不能替代与最新 `main` 集成后的回归。

处理结果：已快进到最新 `origin/main`，手工合并两个冲突文件，并完成 259/259、lint、build 与 diff check；集成后 R4 结果见第 9 节。

## 6. 叙事质量观察

### NARRATIVE-001：普通事业节点出现过度压缩的选项文案

恢复生成后的一个节点返回：

- `A. 专家路线`
- `B. 管理晋升`
- `C. 灵活观望`

这些选择具有不同 outcome 和 decisionIntent，但具体行动、成本和现实条件表达不足。它不是关系线状态错误，也不是本分支新引入的确定性问题，暂记为普通节点叙事质量观察，不阻断本次关系状态修复，但不应被当作 R4 叙事质量通过证据。

### NARRATIVE-002：财务清洗后出现残缺句

自然语言伴侣路线出现“你的已经积累了一些储蓄左右”“85万元的总已经积累了一些储蓄”等残句。人物和关系状态没有受影响，问题位于既有财务叙事清洗边界；本关系分支仅记录，不修改 `financialNarrative.ts`。

### NARRATIVE-003：初始伴侣状态保留身份，但 displayName 仍为通用“伴侣”

用户事实明确写了“伴侣小陈”，正文能够沿用“小陈”，但结构化 `PersonState.displayName` 仍为“伴侣”。稳定 identity、置信度和关系门槛均正确，因此不阻断本次关系形成修复；后续如要展示人物名，应单独增加可靠姓名提取，而不是影响当前 partner 确认门槛。

## 7. 已验证的非问题

- 无父母事实 persona 的前 6 个已提交节点中，`familyRelationships` 始终为空；
- AI 追问建议里曾出现“父母不支持换工作”，但用户没有选择或填写该建议，父母线没有被激活；
- 修复前路线自然命中了 `romance_new_connection`，证明爱情形成事件在无初始伴侣时可达；
- 形成后人物使用 `accepted_character` candidateKey，person/relationship 引用一致；
- 自动化中断后“继续生成”可以恢复，不是永久软锁。
- 最终完整自动化回归为 198/198，lint、build 和 `git diff --check` 均通过。

## 8. 后续复验顺序

1. 提交前再次确认只包含关系线、DecisionGate 恢复和历史跳转修复，不包含 `financialNarrative.ts`；
2. 如需支持开发测试工具导入集成前 checkpoint，再为 INTEGRATION-R4-015 单独建立兼容门槛；
3. 另行处理 NARRATIVE-002 财务残句，不把 `financialNarrative.ts` 混入本关系分支。

## 9. 最新 main 集成后真实页面异常（2026-07-21）

证据根目录：`/tmp/relationship-post-main-smoke-20260721/working/`

### REL-R4-013：权威父母仍反对，正文却自行宣告“语气缓和”

严重度：阻断合并
路线：`parent-opposed-fresh`（全新输入、全新真实 AI 生成）
证据：`parent-opposed-fresh.json`

已确认事实：

- 开局只创建一个 `parent_unspecified`，没有错误拆成父亲和母亲；
- `career_change=opposed`、`practicalSupport=unavailable`、`autonomyRespect=mixed` 均正确写入权威状态；
- 用户选择接受负责人岗位后，下一节点的权威状态仍保持上述值。

异常正文：`父母虽然还是念叨“稳定第一”，但看你干得不错，语气缓和了不少。`

原因定位：`storyConsistency.ts` 的 `family_authority_conflict` 只识别“不再反对”“从反对转为”“态度软化/改变”等固定表达，没有覆盖“语气缓和”“没那么反对”“逐渐接受”等等价叙述。因此权威状态没有被改写，但叙事先行宣布了未经用户选择的立场变化。

修复与复验：

- 扩展 `family_authority_conflict`，覆盖“语气缓和、口风松动、没那么反对、逐渐接受、默认接受”等同义表达；
- 一致性修复提示直接注入当前 `career_change / practicalSupport / autonomyRespect` 权威值，并明确允许“保持现状或删除父母段落”，禁止模型换一种说法继续宣告立场变化；
- 复验正文保持“父母坚持不帮忙搬家”“依然紧张”“当初要是留在大公司就好了”，权威状态仍为 `opposed + unavailable + mixed`。

状态：**已修复。复验证据：`/tmp/relationship-post-main-smoke-20260721-fresh/working/parent-opposed-after-fix.json`。**

### REL-R4-014：爱情继续选择被普通 DecisionGate 选项覆盖规则阻断

严重度：阻断爱情提交冒烟
路线：`romance-formation-restored-post-main`（从尚未选择的相遇节点恢复，后续请求为集成后真实 AI）
证据：`romance-formation-restored-post-main-failures.json`

相遇节点本身符合爱情入口合同：

- `eventId=romance_new_connection`；
- “苏晚”在独立段落出现，包含徒步、摄影、艺术展等非业务私人证据；
- 三个选项分别唯一映射 `continue_getting_to_know / keep_as_acquaintance / decline_romantic_direction`；
- 选择前没有人物或浪漫关系被提前提交。

用户选择 `continue_getting_to_know` 后，第一次下一节点生成被拒绝：

`生成结果没有形成真正不同的人生选择：insufficient-event-strategy-coverage。请重试。`

这次失败发生在下一普通节点的 choices/DecisionGate，不是爱情 Proposal 或 evidence 校验。由于失败节点不入历史，本次爱情选择也没有机会在下一节点边界提交，表现为“爱情入口合法，但被后继节点的普通选项质量连带阻断”。

状态：**保留为旧 checkpoint 路线的普通节点质量失败；在全新 latest-main 爱情路线中未复现，不再作为关系提交阻断项。**

### INTEGRATION-R4-015：旧 checkpoint 在最新财务账本上恢复后触发本金超额偿还

性质：恢复兼容异常；由于使用了集成前 checkpoint，暂不直接归因于自然新路线
证据：`romance-formation-restored-post-main-failures.json`

在 REL-R4-014 后点击一次“继续生成”，新正文写出“尾款到账 5 万元，并还清利息最高的信用卡”。权威财务事务最终抛出：

`FinancialLedgerInvariantError: 偿还本金超过剩余本金`

调用链为 `commitAuthoritativeFinancialProgress -> commitFinancialDomainTransaction -> reduceFinancialLedger`。异常被 UI 映射为笼统的“时空穿梭有些颠簸”，没有展示财务 reason code。由于起点来自最新 main 集成前的浏览器 checkpoint，这一结果至少证明旧存档恢复与新财务账本之间缺少兼容验收；是否也会在全新路线出现，需要单独复现。

状态：**未分类为关系线 Bug。该入口只存在于 DEV 测试状态导入器；全新 latest-main 财务账本路线已正常提交。是否兼容旧测试 checkpoint 作为独立工具需求处理。**

### REL-R4-016：“结识/互换微信”且私人进展位于后段时被误判为未形成爱情

严重度：阻断爱情形成（已修复）
路线：`romance-formation-fresh`（latest-main 全新开局，稳定 seed 只用于定向覆盖 romance）
证据：`/tmp/relationship-post-main-smoke-20260721-fresh/working/romance-formation-fresh.json`

真实正文先写“在行业峰会中结识了产品总监林悦，会后互换微信”，后一个含林悦的段落再写“周末一起看展、吃饭，感受到微妙吸引力”。旧校验存在两个问题：

- 相遇词只识别“认识了/交换微信”，不识别同义的“结识/互换微信”；
- 只检查第一个包含候选姓名的段落，忽略同一人物在后续段落中的私人进展。

结果是 `romanceNarrativeGrounding` 错误失败，确定性 choice 修复因缺少 grounded character 没有运行，又连带出现 `romanceChoiceSemantics`。

修复后：聚合所有包含候选姓名的段落；补充“结识/互换微信/看展”等等价表达；纯商务咖啡反例仍被拒绝。全新复验生成“小杨”的私人咖啡和生活交流，三项 outcome 唯一，继续后创建 `person_romance_5775ebea` 与 `romantic / exploring / active / 0.9`。

状态：**已修复并通过定向测试与全新真实页面闭环。**

## 10. 本轮明确不计为产品 Bug 的现象

- 浏览器控制等待爱情下一节点超过单次 180 秒窗口：重新连接后页面给出了明确的 `nextGenerationError`，所以测试工具超时本身不计为应用软锁；
- Vite 构建的大于 500 kB chunk 警告：构建成功，属于既有性能警告；
- `financialNarrative.ts` 未被本分支修改，以上财务恢复异常只记录，不在关系分支内顺带修复。

## 11. 当前发布判断

- 自动化：通过（259/259、lint、build、diff check）；
- 父母反对真实路线：通过；单一 `parent_unspecified`，状态与正文保持 `opposed + unavailable + mixed`；
- 爱情继续真实路线：通过；全新 latest-main 开局，`romance_new_connection` → `continue_getting_to_know` → 唯一 `accepted_character + exploring`；
- 权威财务账本：上述全新爱情路线使用 version 2 账本并正常提交，没有复现本金超额偿还；
- 结论：**关系线集成与冒烟验收通过，可以进入提交前范围复核。旧 DEV checkpoint 兼容异常保留为独立测试工具事项，不混入本关系分支。**
