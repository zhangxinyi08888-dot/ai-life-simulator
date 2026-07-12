import { HistoryItem, PersonRelation, PersonState, UserInitialData } from "../types";

const RELATION_DEFINITIONS: Array<{ relation: PersonRelation; id: string; keywords: string[]; ageOffset: [number, number] }> = [
  { relation: "parent", id: "family_parent", keywords: ["父母", "父亲", "母亲", "爸爸", "妈妈"], ageOffset: [18, 45] },
  { relation: "grandparent", id: "family_grandparent", keywords: ["祖父", "祖母", "爷爷", "奶奶", "外公", "外婆"], ageOffset: [40, 80] },
  { relation: "partner", id: "family_partner", keywords: ["伴侣", "丈夫", "妻子", "爱人", "女友", "男友", "恋人"], ageOffset: [-12, 12] },
  { relation: "child", id: "family_child", keywords: ["儿子", "女儿", "孩子"], ageOffset: [-45, -15] }
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function rebuildPersonStates(userData: Partial<UserInitialData>, history: HistoryItem[], targetAgeInMonths: number): PersonState[] {
  const existing = history[history.length - 1]?.worldStateSnapshot?.people;
  const advancedExisting = existing?.map((person) => {
    const previousProtagonistAge = person.protagonistAgeInMonthsAtLastUpdate ?? (history[history.length - 1].ageInMonths ?? history[history.length - 1].age * 12);
    const elapsedYears = Math.max(0, targetAgeInMonths - previousProtagonistAge) / 12;
    return {
      ...person,
      explicitAge: typeof person.explicitAge === "number" ? person.explicitAge + elapsedYears : undefined,
      estimatedAgeRange: person.estimatedAgeRange
        ? [person.estimatedAgeRange[0] + elapsedYears, person.estimatedAgeRange[1] + elapsedYears] as [number, number]
        : undefined,
      protagonistAgeInMonthsAtLastUpdate: targetAgeInMonths
    };
  }) || [];

  const text = [
    userData.regressionSituation,
    userData.regressionChoices,
    userData.milestoneRelationship,
    ...history.slice(-5).flatMap((item) => [item.description, item.selectedChoice])
  ].filter(Boolean).join("\n");
  const protagonistAge = Math.floor(targetAgeInMonths / 12);

  const inferredPeople = RELATION_DEFINITIONS
    .filter((definition) => !advancedExisting.some((person) => person.relation === definition.relation))
    .filter((definition) => includesAny(text, definition.keywords))
    .map((definition) => {
      const deceased = includesAny(text, definition.keywords.flatMap((keyword) => [`已故${keyword}`, `${keyword}去世`, `${keyword}离世`]));
      return {
        id: definition.id,
        relation: definition.relation,
        estimatedAgeRange: [protagonistAge + definition.ageOffset[0], protagonistAge + definition.ageOffset[1]],
        protagonistAgeInMonthsAtLastUpdate: targetAgeInMonths,
        lifeStatus: deceased ? "deceased" : "unknown",
        occupationStatus: "unknown",
        healthStatus: "unknown",
        relationshipSummary: definition.keywords.find((keyword) => text.includes(keyword)),
        source: "model_inferred",
        confidence: deceased ? 0.9 : 0.55
      } satisfies PersonState;
    });

  return [...advancedExisting, ...inferredPeople];
}

export function formatPersonStateForPrompt(person: PersonState): string {
  const ageText = person.explicitAge
    ? `${person.explicitAge}岁`
    : person.estimatedAgeRange
      ? `估算${person.estimatedAgeRange[0]}-${person.estimatedAgeRange[1]}岁`
      : "年龄未知";
  return `${person.displayName || person.relation}：${ageText}，lifeStatus=${person.lifeStatus}，occupation=${person.occupationStatus || "unknown"}，confidence=${person.confidence.toFixed(2)}`;
}
