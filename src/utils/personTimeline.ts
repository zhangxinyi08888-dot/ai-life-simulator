import { HistoryItem, PersonIdentityKey, PersonRelation, PersonState, UserInitialData } from "../types";

interface PersonSeed {
  identityKey: PersonIdentityKey;
  relation: PersonRelation;
  displayName?: string;
  keywords: string[];
  ageOffset: [number, number];
}

const FAMILY_SEEDS: PersonSeed[] = [
  { identityKey: { namespace: "user_role", key: "parent:unspecified" }, relation: "parent", displayName: "父母", keywords: ["父母"], ageOffset: [18, 45] },
  { identityKey: { namespace: "user_role", key: "parent:father" }, relation: "parent", displayName: "父亲", keywords: ["父亲", "爸爸"], ageOffset: [18, 45] },
  { identityKey: { namespace: "user_role", key: "parent:mother" }, relation: "parent", displayName: "母亲", keywords: ["母亲", "妈妈"], ageOffset: [18, 45] },
  { identityKey: { namespace: "user_role", key: "grandparent:paternal_father" }, relation: "grandparent", displayName: "爷爷", keywords: ["祖父", "爷爷"], ageOffset: [40, 80] },
  { identityKey: { namespace: "user_role", key: "grandparent:paternal_mother" }, relation: "grandparent", displayName: "奶奶", keywords: ["祖母", "奶奶"], ageOffset: [40, 80] },
  { identityKey: { namespace: "user_role", key: "grandparent:maternal_father" }, relation: "grandparent", displayName: "外公", keywords: ["外公", "外祖父"], ageOffset: [40, 80] },
  { identityKey: { namespace: "user_role", key: "grandparent:maternal_mother" }, relation: "grandparent", displayName: "外婆", keywords: ["外婆", "外祖母"], ageOffset: [40, 80] },
  { identityKey: { namespace: "user_role", key: "partner:current" }, relation: "partner", displayName: "伴侣", keywords: ["伴侣", "丈夫", "妻子", "爱人"], ageOffset: [-12, 12] },
  { identityKey: { namespace: "user_role", key: "partner:former:1" }, relation: "partner", displayName: "前伴侣", keywords: ["前妻", "前夫", "前任伴侣", "前任爱人"], ageOffset: [-12, 12] },
  { identityKey: { namespace: "user_role", key: "child:son:1" }, relation: "child", displayName: "儿子", keywords: ["儿子", "长子", "小儿子"], ageOffset: [-45, -15] },
  { identityKey: { namespace: "user_role", key: "child:daughter:1" }, relation: "child", displayName: "女儿", keywords: ["女儿", "长女", "大女儿"], ageOffset: [-45, -15] },
  { identityKey: { namespace: "user_role", key: "child:daughter:2" }, relation: "child", displayName: "小女儿", keywords: ["小女儿", "二女儿", "次女"], ageOffset: [-45, -15] }
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function identityToken(identityKey: PersonIdentityKey): string {
  return `${identityKey.namespace}:${identityKey.key}`;
}

function safeIdPart(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function stripNegatedCurrentPartnerMentions(text: string): string {
  return text.replace(
    /(?:没有|并无|尚无|暂无|未有|不存在|不是|无)(?:[^，。；！？\n]{0,10})?(?:现任|伴侣|对象|男友|女友|丈夫|妻子|爱人)/gu,
    ""
  );
}

function hasEstablishedChildFact(text: string, keywords: string[]): boolean {
  if (!includesAny(text, keywords)) return false;
  // A future family plan is not a present child fact. Keep this narrow so
  // ordinary statements such as "希望儿子成绩好" still preserve an existing
  // child, while "计划明年要孩子" cannot activate a lifecycle responsibility.
  return !/(?:计划|打算|准备|考虑|未来).{0,12}(?:要|生|迎来|拥有|有)(?:一|两|二|三|四|五|\d)?(?:个)?(?:孩子|儿子|女儿)|(?:孩子|儿子|女儿).{0,12}(?:计划|打算|准备).{0,12}(?:出生|到来|要)/u.test(text);
}

export function personIdForIdentity(identityKey: PersonIdentityKey): string {
  const readable = safeIdPart(identityKey.key);
  if (readable) return `person_${readable}`;
  let hash = 2166136261;
  for (const character of identityToken(identityKey)) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `person_${identityKey.namespace}_${(hash >>> 0).toString(36)}`;
}

function withIdentityKey(person: PersonState): PersonState {
  if (person.identityKey) return person;
  return {
    ...person,
    identityKey: { namespace: "accepted_character", key: `legacy:${person.id}` }
  };
}

function advancePersonAge(person: PersonState, targetAgeInMonths: number, fallbackAgeInMonths: number): PersonState {
  const previousProtagonistAge = person.protagonistAgeInMonthsAtLastUpdate ?? fallbackAgeInMonths;
  const elapsedYears = Math.max(0, targetAgeInMonths - previousProtagonistAge) / 12;
  return {
    ...person,
    explicitAge: typeof person.explicitAge === "number" ? person.explicitAge + elapsedYears : undefined,
    estimatedAgeRange: person.estimatedAgeRange
      ? [person.estimatedAgeRange[0] + elapsedYears, person.estimatedAgeRange[1] + elapsedYears]
      : undefined,
    protagonistAgeInMonthsAtLastUpdate: targetAgeInMonths
  };
}

function inferredSeeds(text: string): PersonSeed[] {
  const seeds = FAMILY_SEEDS.filter((seed) => {
    const scopedText = seed.identityKey.key === "partner:current"
      ? stripNegatedCurrentPartnerMentions(text.replace(/前妻|前夫|前任伴侣|前任爱人/gu, ""))
      : seed.identityKey.key === "child:daughter:1"
        ? text.replace(/小女儿|二女儿|次女/gu, "")
        : text;
    return seed.relation === "child"
      ? hasEstablishedChildFact(scopedText, seed.keywords)
      : includesAny(scopedText, seed.keywords);
  });
  const explicitChildren = seeds.filter((seed) => seed.relation === "child").length;
  const childCountMatch = text.match(/([两二三四五]|\d)个孩子/u);
  const countMap: Record<string, number> = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 };
  const requestedCount = childCountMatch ? (countMap[childCountMatch[1]] || Number(childCountMatch[1])) : 0;
  for (let ordinal = explicitChildren + 1; ordinal <= requestedCount; ordinal += 1) {
    seeds.push({
      identityKey: { namespace: "user_role", key: `child:unspecified:${ordinal}` },
      relation: "child",
      displayName: `孩子${ordinal}`,
      keywords: ["孩子"],
      ageOffset: [-45, -15]
    });
  }
  return seeds;
}

function createInferredPerson(seed: PersonSeed, text: string, protagonistAge: number, targetAgeInMonths: number): PersonState {
  const deceased = includesAny(text, seed.keywords.flatMap((keyword) => [`已故${keyword}`, `${keyword}去世`, `${keyword}离世`]));
  const explicitParent = seed.relation === "parent";
  const explicitChild = seed.relation === "child" && hasEstablishedChildFact(text, seed.keywords);
  const currentPartnerText = stripNegatedCurrentPartnerMentions(
    text.replace(/前妻|前夫|前任伴侣|前任爱人/gu, "")
  );
  const hasCurrentPartnerKeyword = includesAny(
    currentPartnerText,
    ["伴侣", "丈夫", "妻子", "爱人", "男友", "女友"]
  );
  const hasOngoingRelationshipEvidence = (
    /(?:我们|双方).{0,16}(?:交往|在一起|关系稳定|同居)/u.test(currentPartnerText)
    || /(?:交往|在一起).{0,8}(?:\d+|[一二两三四五六七八九十]+)(?:年|个月)/u.test(currentPartnerText)
    || /见过双方父母/u.test(currentPartnerText)
  );
  const explicitCurrentPartner = seed.identityKey.key === "partner:current"
    && (
      /现任|现在(?:和|与).{0,12}(?:妻子|丈夫|伴侣|男友|女友)|丈夫|妻子|老公|老婆|已婚|正在恋爱|恋爱中/.test(currentPartnerText)
      || /(?:与|和)(?:交往.{0,8}的)?(?:伴侣|男友|女友).{0,16}(?:共同生活|共同租房|同居|稳定交往|在一起)/.test(currentPartnerText)
      || /(?:伴侣|男友|女友).{0,16}(?:共同生活|共同租房|同居|稳定交往)/.test(currentPartnerText)
      || (hasCurrentPartnerKeyword && hasOngoingRelationshipEvidence)
    );
  const explicitUserFact = explicitParent || explicitChild || explicitCurrentPartner;
  const relationshipSummary = seed.relation === "parent"
    ? [...new Set(text.split(/[。！？\n]+/u).map((part) => part.trim()).filter((part) => part && includesAny(part, seed.keywords)))].join("；")
    : seed.identityKey.key === "partner:current"
    ? /已婚|丈夫|妻子|老公|老婆/.exec(text)?.[0]
      || /同居|共同生活/.exec(text)?.[0]
      || /正在恋爱|恋爱中|现任/.exec(text)?.[0]
      || seed.keywords.find((keyword) => text.includes(keyword))
    : seed.keywords.find((keyword) => text.includes(keyword));
  return {
    id: personIdForIdentity(seed.identityKey),
    identityKey: seed.identityKey,
    displayName: seed.displayName,
    relation: seed.relation,
    estimatedAgeRange: [protagonistAge + seed.ageOffset[0], protagonistAge + seed.ageOffset[1]],
    protagonistAgeInMonthsAtLastUpdate: targetAgeInMonths,
    lifeStatus: deceased ? "deceased" : explicitUserFact ? "active" : "unknown",
    occupationStatus: "unknown",
    healthStatus: "unknown",
    relationshipSummary,
    source: explicitUserFact ? "user_fact" : "model_inferred",
    confidence: deceased || explicitUserFact ? 0.9 : 0.55
  };
}

export function rebuildPersonStates(
  userData: Partial<UserInitialData>,
  history: HistoryItem[],
  targetAgeInMonths: number,
  acceptedPeople: PersonState[] = [],
  answers?: unknown
): PersonState[] {
  const latestHistory = history[history.length - 1];
  const existing = latestHistory?.worldStateSnapshot?.people || [];
  const fallbackAgeInMonths = latestHistory?.ageInMonths ?? (latestHistory?.age || 0) * 12;
  const retained = existing.map(withIdentityKey);
  const byIdentity = new Map(retained.map((person) => [identityToken(person.identityKey!), person]));

  for (const accepted of acceptedPeople.map(withIdentityKey)) {
    const token = identityToken(accepted.identityKey!);
    const previous = byIdentity.get(token);
    byIdentity.set(token, previous ? { ...previous, ...accepted, id: previous.id, identityKey: previous.identityKey } : accepted);
  }
  if (byIdentity.size > 0) {
    return [...byIdentity.values()].map((person) => advancePersonAge(person, targetAgeInMonths, fallbackAgeInMonths));
  }

  const text = [
    userData.currentSituation,
    userData.regressionSituation,
    userData.regressionChoices,
    userData.milestoneRelationship,
    Array.isArray(answers)
      ? answers.map((answer) => answer && typeof answer === "object" && "answer" in answer ? String(answer.answer || "") : "").join("\n")
      : ""
  ].filter(Boolean).join("\n");
  const protagonistAge = Math.floor(targetAgeInMonths / 12);
  return inferredSeeds(text).map((seed) => createInferredPerson(seed, text, protagonistAge, targetAgeInMonths));
}

export function formatPersonStateForPrompt(person: PersonState): string {
  const ageText = person.explicitAge
    ? `${person.explicitAge}岁`
    : person.estimatedAgeRange
      ? `估算${person.estimatedAgeRange[0]}-${person.estimatedAgeRange[1]}岁`
      : "年龄未知";
  return `${person.displayName || person.relation}：${ageText}，lifeStatus=${person.lifeStatus}，occupation=${person.occupationStatus || "unknown"}，confidence=${person.confidence.toFixed(2)}`;
}
