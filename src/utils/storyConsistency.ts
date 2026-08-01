import { LifeStage, PersonState, SimulationNode, WorldStateSnapshot } from "../types";
import { deriveLifeStage } from "./timelineAdvance";

export type StoryConsistencyIssueCode =
  | "timeline_progression_invalid"
  | "life_stage_mismatch"
  | "deceased_character_active"
  | "character_timeline_conflict"
  | "family_authority_conflict"
  | "relationship_authority_conflict"
  | "age_script_funneling"
  | "arc_state_write_violation";

export interface StoryConsistencyIssue {
  code: StoryConsistencyIssueCode;
  severity: "warning" | "error";
  message: string;
}

const FUNNEL_TERMS = ["退休", "养老", "接受照护", "退出", "回忆过去", "安享晚年"];
const ROMANTIC_CHARACTER_CLAIM = /romantic(?:_|\s)?(?:partner|interest)|恋人|伴侣|恋爱对象/i;
const ENDED_ROMANCE_REFERENCE = /分手|前任|走散|分开一段时间|结束(?:了)?(?:这段)?关系|关系(?:已经)?无法回到从前|不再是(?:恋人|伴侣)/;
const ROMANTIC_STATE_CLAIM_TEXT = /(?:私人|单独).{0,8}(?:相处|约会)|试探.{0,16}(?:进一步|发展|态度)|(?:主动)?推进.{0,10}(?:关系|发展)|确认.{0,8}(?:感觉|心意)|卸下心防|更深.{0,8}(?:了解|关系)|关系.{0,10}(?:升温|越来越亲密)|重新学会.{0,8}靠近|(?:和|与).{0,10}(?:慢慢相处|培养感情)|尝试.{0,8}(?:一段)?新(?:的)?关系|感情.{0,10}(?:进展|升温|发展)/;
const ROMANTIC_EXECUTING_CHOICE_TEXT = /(?:建立|开始|开启|发展).{0,12}(?:亲密关系|恋爱关系|一段感情)|(?:私人|单独).{0,8}(?:相处|约会)|试探.{0,16}(?:进一步|发展|态度)|(?:主动)?推进.{0,10}(?:关系|发展)|确认.{0,8}(?:感觉|心意)|卸下心防|更深.{0,8}(?:了解|关系)|挽回.{0,10}(?:感情|关系|前任)|(?:和|与).{0,8}前任复合|重新开始.{0,8}(?:感情|关系)|前任.{0,12}重新联系.{0,16}(?:可能|机会)|重新联系.{0,12}前任.{0,16}(?:可能|机会)|(?:认真|主动)?追求.{0,12}(?:女生|男生|她|他|对方)|与.{0,10}(?:女生|男生|她|他|对方).{0,16}保持联系.{0,20}(?:观察|发展|再定)|(?:和|与).{0,14}深入交往|(?:和|与).{0,14}(?:看看|看).{0,6}能否发展|(?:尝试|开始).{0,16}(?:更)?深入.{0,4}交往|给彼此一个机会/;

/**
 * Relationship facts are code-owned.  In particular, a commitment plan is
 * deliberately not a cohabitation/marriage/parenthood transition.  Keep the
 * recognizers here narrow enough to allow future-oriented discussion while
 * catching assertions that the state already changed.
 */
function narrativeAssertsCohabiting(text: string): boolean {
  const assertion = /(?:你(?:和|与)|我(?:和|与)|你们|我们).{0,16}(?:同居|同住|合租|共同居住|共同生活|搬到一起(?:住|生活))|(?:同居(?:生活)?|共同生活)(?:的(?:第|日常|执行|磨合|稳定|开始)|已(?:经)?|开始|日常|磨合|执行|稳定|之后|以来)/;
  return text.split(/(?<=[。！？；\n])/u).some((sentence) => (
    assertion.test(sentence)
    && !/(?:讨论|商量|评估|考虑|计划|打算|准备|期待|希望|未来|条件|筹备).{0,16}(?:同居|同住|合租|共同居住|共同生活|搬到一起(?:住|生活))/.test(sentence)
  ));
}

function narrativeAssertsMarriage(text: string): boolean {
  const assertion = /(?:你(?:和|与)|我(?:和|与)|你们|我们).{0,16}(?:领(?:了)?证|登记(?:了)?结婚|结了婚|已经结婚|正式结婚|成(?:了)?夫妻|办(?:了)?婚礼)|婚后(?:生活|第|日常)|新婚|夫妻(?:生活|关系|日常)|你的(?:妻子|丈夫)|(?:妻子|丈夫|老公|老婆).{0,10}(?:说|决定|工作|收入|父母|家人)/;
  return text.split(/(?<=[。！？；\n])/u).some((sentence) => (
    assertion.test(sentence)
    && !/(?:讨论|商量|评估|考虑|计划|打算|准备|期待|希望|未来|条件|筹备).{0,16}(?:领证|登记(?:结婚)?|结婚|婚礼)/.test(sentence)
  ));
}

function narrativeAssertsChildBirth(text: string): boolean {
  return /(?:孩子|宝宝|儿子|女儿|新生儿).{0,6}(?:出生|降生|满月)|(?:生了|生下(?:了)?|迎来了|有了).{0,8}(?:孩子|宝宝|儿子|女儿)|(?:成为|初为).{0,8}(?:父母|爸爸|妈妈)/.test(text);
}

function narrativeAssertsUngroundedParenting(text: string, hasAuthoritativeChild: boolean): boolean {
  if (hasAuthoritativeChild) return false;
  return /(?:接|照顾|陪伴|抚养|带).{0,8}(?:孩子|宝宝|儿子|女儿)|(?:孩子|宝宝|儿子|女儿).{0,12}(?:托育|托班|幼儿园|接送|照护|育儿|奶粉|尿布|熟睡|上学)|(?:孩子|宝宝|儿子|女儿)的(?:托育|教育|照护|生活)费/.test(text);
}

function choiceExecutesFormalRelationshipTransition(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (/不(?:急着|打算|准备)?(?:领证|结婚|同居)|(?:讨论|商量|评估|考虑|是否).{0,16}(?:领证|结婚|同居)|(?:领证|结婚|同居).{0,16}(?:讨论|商量|评估|考虑|是否)|(?:暂缓|推迟|延后).{0,20}再考虑/.test(normalized)) {
    return false;
  }
  return /(?:先|正式|立即|直接|马上|按计划|到时|届时|半年后|一年后|两年后|三年后).{0,16}(?:领证|结婚|同居)|租房结婚|(?:办|举行).{0,6}婚礼|婚礼.{0,6}(?:办|举行)|开始同居|搬到一起(?:住|生活)|保持.{0,10}(?:现有|当前).{0,8}同居|继续同居/.test(normalized);
}

function choiceExecutesDatingTransition(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (/(?:讨论|商量|评估|考虑|是否).{0,16}(?:正式交往|确定恋爱关系|成为恋人)|(?:正式交往|确定恋爱关系|成为恋人).{0,16}(?:讨论|商量|评估|考虑|是否)/.test(normalized)) {
    return false;
  }
  return /(?:明确表达|决定|开始|确认|正式|愿意).{0,20}(?:正式交往|恋爱关系|成为恋人)|(?:和|与).{0,10}正式交往/.test(normalized);
}

function eventAuthorizesDatingChoice(eventId: string | undefined, romanticStage: string | undefined): boolean {
  // These code-owned checkpoint events deliberately offer the user the next
  // relationship stage as one possible future outcome. They do not authorize
  // the generated prose to claim that the transition has already happened.
  return romanticStage === "exploring"
    && (eventId === "romance_connection_clarification" || eventId === "romance_exploration_resolution");
}

export function stripUnauthorizedRomanticCharacters(
  node: SimulationNode,
  worldState?: WorldStateSnapshot
): SimulationNode {
  const hasActiveRomanticRelationship = worldState?.relationships?.some((relationship) => (
    relationship.type === "romantic" && ["active", "strained"].includes(relationship.status)
  ));
  if (hasActiveRomanticRelationship || node.eventMeta?.eventId === "romance_new_connection") return node;
  const activeCharacters = node.narrativeMeta?.activeCharacters || [];
  // `candidateOrdinal` is a validator-visible romantic-candidate marker, but
  // legacy payloads can attach it to a real parent or colleague by mistake.
  // Remove a true candidate entirely; otherwise retain the person and remove
  // only the stale marker so metadata cannot cause a final-surface pause.
  let changed = false;
  const filteredCharacters = activeCharacters.flatMap((character) => {
    const isExplicitRomanticCandidate = ROMANTIC_CHARACTER_CLAIM.test(JSON.stringify(character))
      || (character.candidateOrdinal === 0 && character.relation === "other");
    if (isExplicitRomanticCandidate) {
      changed = true;
      return [];
    }
    if (character.candidateOrdinal == null) return [character];
    changed = true;
    const { candidateOrdinal: _candidateOrdinal, ...withoutCandidateOrdinal } = character;
    return [withoutCandidateOrdinal];
  });
  if (!changed || !node.narrativeMeta) return node;
  return {
    ...node,
    narrativeMeta: { ...node.narrativeMeta, activeCharacters: filteredCharacters }
  };
}

export function validateStoryConsistency(input: {
  node: SimulationNode;
  targetAgeInMonths: number;
  people: PersonState[];
  worldState?: WorldStateSnapshot;
}): StoryConsistencyIssue[] {
  const issues: StoryConsistencyIssue[] = [];
  const expectedAge = Math.floor(input.targetAgeInMonths / 12);
  if (input.node.ageInMonths !== input.targetAgeInMonths || input.node.age !== expectedAge) {
    issues.push({ code: "timeline_progression_invalid", severity: "error", message: "节点时间与代码确定的目标时间不一致。" });
  }
  const expectedStage: LifeStage = deriveLifeStage(expectedAge);
  if (input.node.lifeStage !== expectedStage) {
    issues.push({ code: "life_stage_mismatch", severity: "error", message: "内部 chronological band 与目标年龄不一致。" });
  }

  for (const character of input.node.narrativeMeta?.activeCharacters || []) {
    const person = character.personId ? input.people.find((item) => item.id === character.personId) : undefined;
    if (person?.lifeStatus === "deceased" && (character.presenceMode === "active_scene" || character.presenceMode === "remote_contact")) {
      issues.push({ code: "deceased_character_active", severity: "error", message: `${person.displayName || person.relation}已故，不能作为现实行动者出现。` });
    }
    if (person?.estimatedAgeRange?.[0] && person.estimatedAgeRange[0] >= 105 && person.lifeStatus === "unknown" && character.currentRole?.includes("工作")) {
      issues.push({ code: "character_timeline_conflict", severity: "error", message: `${person.relation}估算年龄超过105岁，缺少明确长寿事实时不能默认仍在工作。` });
    }
  }

  if (!input.node.isEndingNode && input.node.choices.length >= 2 && input.node.choices.every((choice) => FUNNEL_TERMS.some((term) => choice.text.includes(term)))) {
    issues.push({ code: "age_script_funneling", severity: "error", message: "非终章选项全部导向退休、照护、退出或回忆，缺少继续面向未来的方向。" });
  }

  const parentSentences = input.node.description
    .split(/(?<=[。！？；])/u)
    .filter((sentence) => /父母|父亲|母亲|爸爸|妈妈/.test(sentence));
  for (const relationship of input.worldState?.familyRelationships || []) {
    const careerStance = relationship.topicStances.find((stance) => stance.topic === "career_change")?.stance;
    for (const sentence of parentSentences) {
      const oppositionText = sentence.replace(/不(?:会|再)?要求.{0,16}(?:求稳|留下|拒绝|放弃)/gu, "");
      const assertsOpposition = /反对|不同意|不支持|阻止|要求.{0,16}(?:求稳|留下|拒绝|放弃)/.test(oppositionText);
      const assertsRelaxation = /不再.{0,8}反对|从反对转为|(?:态度|语气|口风|立场).{0,12}(?:缓和|软化|松动|转为|转变|改变|好转)|(?:逐渐|开始|慢慢|终于).{0,12}(?:理解|接受|认可|支持)|(?:没|不).{0,4}(?:那么|再|像以前那样).{0,6}(?:反对|强硬)|(?:默认|勉强接受)/.test(sentence);
      const assertsSupport = /明确支持|表示支持|赞成|如约.{0,12}(?:帮助|帮忙)|愿意.{0,12}(?:帮助|帮忙)/.test(sentence);
      const contradictsStance = careerStance === "supportive" && assertsOpposition
        || careerStance === "opposed" && (assertsRelaxation || assertsSupport);
      const contradictsPracticalSupport = relationship.practicalSupport === "available"
        && /不(?:愿|会|再).{0,12}(?:帮助|帮忙)|没有实际帮忙|拒绝.{0,12}(?:帮助|帮忙)/.test(sentence)
        || relationship.practicalSupport === "unavailable"
        && /如约.{0,12}(?:帮助|帮忙)|愿意.{0,12}(?:帮助|帮忙)|提供了.{0,12}帮助/.test(sentence);
      if (contradictsStance || contradictsPracticalSupport) {
        issues.push({
          code: "family_authority_conflict",
          severity: "error",
          message: `父母正文与当前权威家庭状态冲突：${sentence.trim()} 未经已接受的 parent_topic_stance 不得宣告立场变化。`
        });
        break;
      }
    }
  }

  const activeRomanticRelationship = input.worldState?.relationships?.find((relationship) => (
    relationship.type === "romantic"
    && ["active", "strained"].includes(relationship.status)
  ));
  const romanticStage = activeRomanticRelationship?.stage;
  const narrative = `${input.node.title}\n${input.node.description}`;
  const choiceNarrative = input.node.choices.map((choice) => choice.text).join("\n");
  const romanticCharacterClaim = (input.node.narrativeMeta?.activeCharacters || []).some((character) => (
    character.candidateOrdinal != null || ROMANTIC_CHARACTER_CLAIM.test(JSON.stringify(character))
  ));
  const hasEndedRomanticRelationship = input.worldState?.relationships?.some((relationship) => (
    relationship.type === "romantic" && relationship.status === "ended"
  ));
  const authorityClaimNarrative = hasEndedRomanticRelationship
    ? narrative
      .split(/(?<=[。！？；\n])/u)
      .filter((sentence) => !ENDED_ROMANCE_REFERENCE.test(sentence))
      .join("")
    : narrative;
  const romanticClaimText = `${authorityClaimNarrative}\n${choiceNarrative}`
    .replace(/(?:没有|暂无|前任|前).{0,4}(?:女朋友|男朋友|恋人|伴侣)/g, "");
  const unauthorizedPartnerLabelClaim = hasEndedRomanticRelationship
    ? /(?:新(?:的)?|现任|找到(?:了)?|遇到(?:了)?|有了)(?:女朋友|男朋友|恋人|伴侣)/.test(romanticClaimText)
    : /(?:女朋友|男朋友|恋人|伴侣)/.test(romanticClaimText);
  const unauthorizedRelationshipPattern = unauthorizedPartnerLabelClaim
    || /新认识的(?:女生|男生)|关系稳定后|情感(?:新起点|可能|尝试|探索|推进)|浪漫可能|感情投入|发展(?:一段)?(?:感情|恋爱)|推进(?:这段)?感情|你和[^，。\n]{1,10}的关系(?:进入|稳定|升温)|你和[^，。\n]{1,10}.{0,60}(?:合租|共同账户|家庭基金)|(?:和|与).{0,10}(?:共同生活|认真交往)|鼓励.{0,10}(?:迁居|搬来).{0,16}(?:共同|一起)/.test(romanticClaimText);
  const unauthorizedRomanticNarrative = ROMANTIC_STATE_CLAIM_TEXT.test(authorityClaimNarrative);
  const unauthorizedRomanticChoice = ROMANTIC_EXECUTING_CHOICE_TEXT.test(choiceNarrative);
  const unauthorizedNewRelationshipClaim = unauthorizedRelationshipPattern
    || unauthorizedRomanticNarrative
    || unauthorizedRomanticChoice;
  const isRomanceFormationNode = input.node.eventMeta?.eventId === "romance_new_connection";
  const unauthorizedFormalTransitionChoice = input.node.choices.some((choice) => (
    choiceExecutesFormalRelationshipTransition(choice.text)
  ));
  const unauthorizedDatingTransitionChoice = input.node.choices.some((choice) => (
    choiceExecutesDatingTransition(choice.text)
  ));
  const unauthorizedDatingTransitionChoiceForCurrentEvent = unauthorizedDatingTransitionChoice
    && !eventAuthorizesDatingChoice(input.node.eventMeta?.eventId, romanticStage);
  const unauthorizedRelationshipDecisionIntent = input.node.eventMeta?.routeLine !== "romance"
    && input.node.choices.some((choice) => /^romance:(?:end|breakup|separate|commit|cohabit|marry|begin|start|proceed|advance|confirm)(?::|$)/i.test(choice.decisionIntent || ""));
  const assertsDating = /(?:你们|我们)(?:已经|已)?(?:开始|正式)?(?:确定(?:了)?恋爱关系|正式交往|成为(?:了)?(?:恋人|伴侣))|(?:(?:你们|我们)|(?:你和|我和)[^，。\n]{1,10})(?:已经|已)?交往(?:了)?(?:[一二三四五六七八九十\d]+(?:个?月|年))?/.test(narrative);
  const assertsCohabiting = narrativeAssertsCohabiting(narrative);
  const assertsMarried = narrativeAssertsMarriage(narrative);
  const authorityPeople = input.worldState?.people?.length ? input.worldState.people : input.people;
  const hasAuthoritativeChild = authorityPeople.some((person) => (
    person.relation === "child" && person.lifeStatus !== "deceased"
  )) || false;
  const assertsParenthood = narrativeAssertsChildBirth(narrative)
    || narrativeAssertsUngroundedParenting(narrative, hasAuthoritativeChild);
  const relationshipConflict = !activeRomanticRelationship
    ? assertsDating
      || assertsCohabiting
      || assertsMarried
      || assertsParenthood
      || unauthorizedDatingTransitionChoiceForCurrentEvent
      || unauthorizedFormalTransitionChoice
      || unauthorizedRelationshipDecisionIntent
      || (!isRomanceFormationNode && (romanticCharacterClaim || unauthorizedNewRelationshipClaim))
    : romanticStage === "acquaintance" || romanticStage === "exploring"
      ? assertsDating || assertsCohabiting || assertsMarried || assertsParenthood || unauthorizedDatingTransitionChoiceForCurrentEvent
        || unauthorizedFormalTransitionChoice || unauthorizedRelationshipDecisionIntent
      : romanticStage === "dating"
        ? assertsCohabiting || assertsMarried || assertsParenthood || unauthorizedFormalTransitionChoice || unauthorizedRelationshipDecisionIntent
      : romanticStage === "cohabiting"
          ? assertsMarried || assertsParenthood || unauthorizedFormalTransitionChoice || unauthorizedRelationshipDecisionIntent
          : romanticStage === "married"
            ? assertsParenthood || unauthorizedRelationshipDecisionIntent
            : false;
  if (relationshipConflict) {
    const conflictReasons = [
      assertsDating && "narrative_asserts_dating",
      assertsCohabiting && "narrative_asserts_cohabiting",
      assertsMarried && "narrative_asserts_married",
      assertsParenthood && "narrative_asserts_ungrounded_parenthood",
      unauthorizedDatingTransitionChoiceForCurrentEvent && "choice_executes_dating",
      unauthorizedFormalTransitionChoice && "choice_executes_formal_transition",
      unauthorizedRelationshipDecisionIntent && "decision_intent_executes_relationship_transition",
      romanticCharacterClaim && "romantic_character_claim",
      unauthorizedRelationshipPattern && "relationship_pattern_claim",
      unauthorizedRomanticNarrative && "narrative_state_claim",
      unauthorizedRomanticChoice && "choice_executes_romance"
    ].filter(Boolean).join(",");
    issues.push({
      code: "relationship_authority_conflict",
      severity: "error",
      message: `爱情正文超前于当前权威关系阶段（${romanticStage || "none"}；${conflictReasons || "unspecified"}）；只有用户已接受的 outcome 才能推进正式交往、共同生活或婚姻状态；没有权威 child 人物时也不得写成已经生育、育儿或承担托育。`
    });
  }
  return issues;
}

const FORBIDDEN_ARC_WRITE_KEYS = new Set([
  "nextPhaseId",
  "nextPressureArcStatus",
  "foregroundPressureArcId",
  "phaseCheckpointCount"
]);

export function containsForbiddenArcWrite(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenArcWrite);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => FORBIDDEN_ARC_WRITE_KEYS.has(key) || containsForbiddenArcWrite(nested));
}

/**
 * Model output is never an authority for PressureArc lifecycle state. Drop
 * forbidden lifecycle keys at the generation boundary so an otherwise valid
 * node can continue through the normal validators without a full-node retry.
 */
export function stripForbiddenArcWrites<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripForbiddenArcWrites(item)) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !FORBIDDEN_ARC_WRITE_KEYS.has(key))
      .map(([key, nested]) => [key, stripForbiddenArcWrites(nested)])
  ) as T;
}
