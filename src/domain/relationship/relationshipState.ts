import type {
  FamilyRelationshipState,
  PersonState,
  RelationshipState,
  WorldStateSnapshot
} from "../../types";
import {
  createCommitmentProgression,
  createExplorationProgression
} from "./relationshipLifecycle";

export class RelationshipStateError extends Error {
  readonly code: "REVISION_CONFLICT" | "INVALID_STATE" | "MISSING_PERSON_REFERENCE";

  constructor(code: RelationshipStateError["code"], message: string) {
    super(message);
    this.name = "RelationshipStateError";
    this.code = code;
  }
}

function assertRevision(domain: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new RelationshipStateError("REVISION_CONFLICT", `${domain} revision 冲突：期望 ${expected}，实际 ${actual}`);
  }
}

function replaceOrAppend<T extends { id: string }>(states: T[], nextState: T): T[] {
  const index = states.findIndex((state) => state.id === nextState.id);
  if (index < 0) return [...states, structuredClone(nextState)];
  const next = states.map((state) => structuredClone(state));
  next[index] = structuredClone(nextState);
  return next;
}

export function mergeAcceptedPeople(input: { currentPeople: PersonState[]; acceptedPeople: PersonState[] }): PersonState[] {
  const next = input.currentPeople.map((person) => structuredClone(person));
  const identityIndex = new Map<string, number>(next.flatMap((person, index) => person.identityKey
    ? [[`${person.identityKey.namespace}:${person.identityKey.key}`, index] as const]
    : []));
  const ids = new Set(next.map((person) => person.id));
  for (const acceptedPerson of input.acceptedPeople) {
    if (!acceptedPerson.identityKey) throw new RelationshipStateError("INVALID_STATE", "长期人物必须包含 identityKey");
    const token = `${acceptedPerson.identityKey.namespace}:${acceptedPerson.identityKey.key}`;
    const existingIndex = identityIndex.get(token);
    if (existingIndex !== undefined) {
      const existing = next[existingIndex];
      next[existingIndex] = { ...existing, ...structuredClone(acceptedPerson), id: existing.id, identityKey: existing.identityKey };
      continue;
    }
    if (ids.has(acceptedPerson.id)) {
      throw new RelationshipStateError("INVALID_STATE", `人物 id ${acceptedPerson.id} 已被其他 identityKey 使用`);
    }
    next.push(structuredClone(acceptedPerson));
    identityIndex.set(token, next.length - 1);
    ids.add(acceptedPerson.id);
  }
  return next;
}

export function reduceRelationshipState(input: {
  current: WorldStateSnapshot;
  expectedRevision: number;
  nextState?: RelationshipState;
}): WorldStateSnapshot {
  const revision = input.current.relationshipRevision || 0;
  assertRevision("Relationship", revision, input.expectedRevision);
  if (!input.nextState) return input.current;
  const participantIds = [...new Set(input.nextState.participantPersonIds)];
  const peopleIds = new Set(input.current.people.map((person) => person.id));
  const missingIds = participantIds.filter((personId) => !peopleIds.has(personId));
  if (!input.nextState.id || participantIds.length === 0) {
    throw new RelationshipStateError("INVALID_STATE", "RelationshipState 必须引用至少一个人物");
  }
  if (missingIds.length > 0) {
    throw new RelationshipStateError("MISSING_PERSON_REFERENCE", `RelationshipState 引用了不存在的人物：${missingIds.join(", ")}`);
  }
  const progression = input.nextState.progression;
  if (progression) {
    const ordered = progression.startedAtAgeInMonths <= progression.eligibleAtAgeInMonths
      && progression.eligibleAtAgeInMonths <= progression.dueAtAgeInMonths
      && progression.dueAtAgeInMonths <= progression.maxAtAgeInMonths;
    const expectedKind = input.nextState.stage === "exploring"
      ? "exploration_review"
      : input.nextState.stage === "dating"
        ? "commitment_review"
        : undefined;
    if (!ordered || progression.reviewCount < 0 || !Number.isInteger(progression.reviewCount)) {
      throw new RelationshipStateError("INVALID_STATE", "Relationship progression 时间窗口或 reviewCount 无效");
    }
    if (expectedKind && progression.checkpointKind !== expectedKind) {
      throw new RelationshipStateError("INVALID_STATE", `Relationship stage ${input.nextState.stage} 与 checkpoint ${progression.checkpointKind} 不匹配`);
    }
  }
  if (input.nextState.type === "romantic" && ["active", "strained"].includes(input.nextState.status)) {
    const relationships = input.current.relationships || [];
    const duplicatePerson = relationships.find((relationship) => (
      relationship.id !== input.nextState?.id
      && relationship.type === "romantic"
      && ["active", "strained"].includes(relationship.status)
      && relationship.participantPersonIds.some((personId) => participantIds.includes(personId))
    ));
    if (duplicatePerson) throw new RelationshipStateError("INVALID_STATE", `人物已存在进行中的浪漫关系：${duplicatePerson.id}`);
    if (input.nextState.stage === "exploring") {
      const existingExploring = relationships.find((relationship) => (
        relationship.id !== input.nextState?.id
        && relationship.type === "romantic"
        && relationship.stage === "exploring"
        && ["active", "strained"].includes(relationship.status)
      ));
      if (existingExploring) throw new RelationshipStateError("INVALID_STATE", `世界中已存在探索中的浪漫关系：${existingExploring.id}`);
    }
  }
  const nextState = {
    ...input.nextState,
    participantPersonIds: participantIds,
    confidence: Math.min(1, Math.max(0, input.nextState.confidence))
  };
  return {
    ...input.current,
    relationships: replaceOrAppend(input.current.relationships || [], nextState),
    relationshipRevision: revision + 1,
    version: 2
  };
}

export function reduceFamilyRelationshipState(input: {
  current: WorldStateSnapshot;
  expectedRevision: number;
  nextState?: FamilyRelationshipState;
}): WorldStateSnapshot {
  const revision = input.current.familyRelationshipRevision || 0;
  assertRevision("FamilyRelationship", revision, input.expectedRevision);
  if (!input.nextState) return input.current;
  if (!input.nextState.id || !input.nextState.role) {
    throw new RelationshipStateError("INVALID_STATE", "FamilyRelationshipState 缺少稳定 id 或父母角色");
  }
  if (input.nextState.participantPersonId && !input.current.people.some((person) => person.id === input.nextState?.participantPersonId)) {
    throw new RelationshipStateError("MISSING_PERSON_REFERENCE", `FamilyRelationshipState 引用了不存在的人物：${input.nextState.participantPersonId}`);
  }
  const nextState = {
    ...structuredClone(input.nextState),
    topicStances: input.nextState.topicStances.map((stance) => ({
      ...stance,
      confidence: Math.min(1, Math.max(0, stance.confidence)),
      evidence: [...stance.evidence]
    })),
    revision: Math.max(input.nextState.revision, revision + 1)
  };
  return {
    ...input.current,
    familyRelationships: replaceOrAppend(input.current.familyRelationships || [], nextState),
    familyRelationshipRevision: revision + 1,
    version: 2
  };
}

function initialParentFacts(
  parent: PersonState,
  ageInMonths: number
): Pick<FamilyRelationshipState, "practicalSupport" | "autonomyRespect" | "topicStances"> {
  const text = parent.relationshipSummary?.trim() || "";
  const oppositionText = text.replace(/不(?:会|再)?要求.{0,16}(?:求稳|留下|拒绝|放弃)/gu, "");
  const practicalSupport = /不愿意.{0,12}(?:帮助|帮忙|提供)|不(?:会|再)?帮忙|拒绝.{0,12}(?:帮助|帮忙)/.test(text)
    ? "unavailable" as const
    : /愿意.{0,12}(?:帮助|帮忙|提供|支持)|(?:帮助|帮忙).{0,8}(?:搬家|住房|资金)/.test(text)
      ? "available" as const
      : "unknown" as const;
  const opposed = /反对|不同意|要求.{0,16}(?:求稳|留下|拒绝|放弃)|否则.{0,16}(?:不愿|不帮|撤回)/.test(oppositionText);
  const supportive = /支持.{0,16}(?:自己|我).{0,16}(?:决定|判断|选择)|尊重.{0,16}(?:决定|选择)|(?:换工作|岗位|职业).{0,12}(?:支持|赞成)/.test(text);
  const concernedButRespectful = !opposed && /担心|顾虑/.test(text) && /尊重|由.{0,8}(?:自己|我).{0,8}决定/.test(text);
  const autonomyRespect = /支持.{0,16}(?:自己|我).{0,16}(?:决定|判断|选择)|尊重.{0,16}(?:决定|选择)|由.{0,8}(?:自己|我).{0,8}决定/.test(text)
    ? "high" as const
    : opposed && /要求|必须|否则/.test(text)
      ? "mixed" as const
      : "unknown" as const;
  const topic = /换工作|跳槽|岗位|职业|求稳|大公司/.test(text)
    ? "career_change" as const
    : /创业|合伙|开公司/.test(text)
      ? "entrepreneurship" as const
      : /搬家|迁居|去外地|回老家/.test(text)
        ? "relocation" as const
        : /结婚|婚姻/.test(text)
          ? "marriage" as const
          : /恋爱|伴侣|对象/.test(text)
            ? "romance" as const
            : /借款|买房|收入|资金|钱/.test(text)
              ? "finance" as const
              : /照护|照顾|养老|医疗/.test(text)
                ? "caregiving" as const
                : undefined;
  const stance = opposed
    ? "opposed" as const
    : supportive
      ? "supportive" as const
      : concernedButRespectful
        ? "concerned_but_respectful" as const
        : undefined;
  const topicStances = topic && stance ? [{
    id: `parent_stance_initial_${parent.id}_${topic}`,
    topic,
    stance,
    reasons: [text],
    effectiveFromAgeInMonths: ageInMonths,
    evidence: [{ nodeIndex: -1, sourceOutcomeId: "initial_user_fact", evidence: text }],
    source: "user_fact" as const,
    confidence: parent.confidence
  }] : [];
  return { practicalSupport, autonomyRespect, topicStances };
}

export function ensureRelationshipWorldState(snapshot: WorldStateSnapshot, ageInMonths: number): WorldStateSnapshot {
  const next = structuredClone(snapshot);
  next.relationships ||= [];
  next.familyRelationships ||= [];
  next.routePreferences ||= [];
  next.relationshipRevision ??= 0;
  next.familyRelationshipRevision ??= 0;
  let migratedLegacyStage = false;
  let migratedProgression = false;
  next.relationships = next.relationships.map((relationship) => {
    if (relationship.type !== "romantic") return relationship;
    if (relationship.stage === "active") {
      migratedLegacyStage = true;
      return { ...relationship, stage: "dating" as const };
    }
    if (relationship.stage === "distant" || relationship.stage === "ended") {
      migratedLegacyStage = true;
      return {
        ...relationship,
        stage: "separated" as const,
        status: relationship.stage === "ended" ? "ended" as const : "distant" as const
      };
    }
    return relationship;
  });
  if (migratedLegacyStage) next.relationshipRevision += 1;
  if (next.relationshipProgressionVersion !== 1) {
    next.relationships = next.relationships.map((relationship) => {
      if (
        relationship.type !== "romantic"
        || !["active", "strained"].includes(relationship.status)
        || relationship.progression
      ) return relationship;
      if (relationship.stage === "exploring") {
        const hasReliableStart = Number.isFinite(relationship.effectiveFromAgeInMonths)
          && relationship.effectiveFromAgeInMonths > 0
          && relationship.effectiveFromAgeInMonths <= ageInMonths;
        const startedAtAgeInMonths = hasReliableStart ? relationship.effectiveFromAgeInMonths : ageInMonths;
        migratedProgression = true;
        return {
          ...relationship,
          progression: createExplorationProgression(startedAtAgeInMonths, {
            startTimeEstimated: !hasReliableStart,
            migrationCreated: true
          })
        };
      }
      if (relationship.stage === "dating") {
        const hasReliableStart = Number.isFinite(relationship.effectiveFromAgeInMonths)
          && relationship.effectiveFromAgeInMonths > 0
          && relationship.effectiveFromAgeInMonths <= ageInMonths;
        const startedAtAgeInMonths = hasReliableStart ? relationship.effectiveFromAgeInMonths : ageInMonths;
        migratedProgression = true;
        return {
          ...relationship,
          progression: createCommitmentProgression(startedAtAgeInMonths, {
            startTimeEstimated: !hasReliableStart,
            migrationCreated: true,
            migrationAgeInMonths: ageInMonths
          })
        };
      }
      return relationship;
    });
    next.relationshipProgressionVersion = 1;
    if (migratedProgression) next.relationshipRevision += 1;
  }
  next.routePreferences = next.routePreferences.map((preference) => (
    preference.openness === "closed"
    && typeof preference.cooldownUntilAgeInMonths === "number"
    && preference.cooldownUntilAgeInMonths <= ageInMonths
      ? { ...preference, openness: "neutral" as const, cooldownUntilAgeInMonths: undefined }
      : preference
  ));
  if (!next.relationships.some((relationship) => relationship.type === "romantic" && ["active", "strained"].includes(relationship.status))) {
    const partner = next.people.find((person) => (
      person.relation === "partner"
      && ["user_fact", "answer"].includes(person.source)
      && person.confidence >= 0.75
      && !["distant", "deceased"].includes(person.lifeStatus)
      && !next.relationships.some((relationship) => (
        relationship.type === "romantic"
        && relationship.participantPersonIds.includes(person.id)
      ))
    ));
    if (partner) {
      next.relationships.push({
        id: `relationship_${partner.id}`,
        participantPersonIds: [partner.id],
        type: "romantic",
        stage: /丈夫|妻子|老公|老婆|已婚/.test(partner.relationshipSummary || "")
          ? "married"
          : /同居|共同生活/.test(partner.relationshipSummary || "") ? "cohabiting" : "dating",
        status: "active",
        statusEffectiveFromAgeInMonths: ageInMonths,
        effectiveFromAgeInMonths: ageInMonths,
        progression: createCommitmentProgression(ageInMonths, { migrationCreated: true }),
        source: partner.source === "user_fact" ? "user" : "answer",
        confidence: partner.confidence
      });
      next.relationshipRevision += 1;
    }
  }
  for (const parent of next.people.filter((person) => (
    person.relation === "parent"
    && ["user_fact", "answer"].includes(person.source)
    && person.confidence >= 0.75
  ))) {
    const role = /father|父亲|爸爸/.test(`${parent.identityKey?.key || ""} ${parent.displayName || ""}`)
      ? "father" as const
      : /mother|母亲|妈妈/.test(`${parent.identityKey?.key || ""} ${parent.displayName || ""}`)
        ? "mother" as const
        : "parent_unspecified" as const;
    if (next.familyRelationships.some((relationship) => relationship.participantPersonId === parent.id || relationship.role === role)) continue;
    const initialFacts = initialParentFacts(parent, ageInMonths);
    next.familyRelationships.push({
      id: `family_${parent.id}`,
      participantPersonId: parent.id,
      role,
      activation: parent.lifeStatus === "distant" ? "distant" : parent.lifeStatus === "deceased" ? "ended" : "active",
      contact: "unknown",
      emotionalSupport: "unknown",
      practicalSupport: initialFacts.practicalSupport,
      autonomyRespect: initialFacts.autonomyRespect,
      conflictIntensity: "unknown",
      topicStances: initialFacts.topicStances,
      revision: 1
    });
    next.familyRelationshipRevision += 1;
  }
  next.version = 2;
  return next;
}
