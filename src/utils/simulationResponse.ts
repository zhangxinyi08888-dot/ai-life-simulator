import { SimulationNode } from "../types";

interface NormalizeOptions {
  fallbackAge?: number;
  minAge?: number;
  maxAge?: number;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min?: number, max?: number): number {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
}

function normalizeAttributes(attributes: any): SimulationNode["attributes"] {
  return {
    happiness: readNumber(attributes?.happiness, 50),
    intelligence: readNumber(attributes?.intelligence ?? attributes?.wisdom ?? attributes?.talent, 50),
    wealth: readNumber(attributes?.wealth, 50),
    relation: readNumber(attributes?.relation ?? attributes?.social ?? attributes?.relationships, 50),
    health: readNumber(attributes?.health, 50)
  };
}

type WithNormalizedChoices<T> = Omit<T, "choices"> & { choices: SimulationNode["choices"] };
type WithNormalizedNode<T> = Omit<T, keyof SimulationNode> & SimulationNode;

function readNodeDescription(node: any): string {
  return readString(node?.description)
    || readString(node?.narrative)
    || readString(node?.newCrossroads?.narrative)
    || readString(node?.scene)
    || readString(node?.story);
}

function hasCompleteAttributes(attributes: any): boolean {
  return [
    attributes?.happiness,
    attributes?.intelligence ?? attributes?.wisdom ?? attributes?.talent,
    attributes?.wealth,
    attributes?.relation ?? attributes?.social ?? attributes?.relationships,
    attributes?.health
  ].every((value) => typeof value === "number" && Number.isFinite(value));
}

export function normalizeSimulationNodeChoices<T extends Record<string, any>>(node: T): WithNormalizedChoices<T> {
  const rawChoices = Array.isArray(node.choices)
    ? node.choices
    : Array.isArray(node.options)
      ? node.options
      : Array.isArray(node.newCrossroads?.options)
        ? node.newCrossroads.options
        : [];
  const choices = rawChoices.map((choice: any, index: number) => {
    const id = readString(choice?.id) || readString(choice?.label) || String.fromCharCode(65 + index);
    const impactSummary = readString(choice?.impactSummary) || readString(choice?.summary) || "继续探索";
    const text = readString(choice?.text) || readString(choice?.content) || readString(choice?.choice) || readString(choice?.labelText) || `${id}. ${impactSummary}`;

    return { id, text, impactSummary };
  });

  return {
    ...node,
    choices
  };
}

export function getSimulationNodeValidationIssues(node: Record<string, any>): string[] {
  const issues: string[] = [];
  const choices = normalizeSimulationNodeChoices(node).choices;
  const requiredChoiceCount = node?.isEndingNode ? 1 : 3;

  if (!readNodeDescription(node)) issues.push("description");
  if (!hasCompleteAttributes(node?.attributes)) issues.push("attributes");
  if (choices.length < requiredChoiceCount) issues.push("choices");

  return issues;
}

export function normalizeSimulationNode<T extends Record<string, any>>(node: T, options: NormalizeOptions = {}): WithNormalizedNode<T> {
  const normalized = normalizeSimulationNodeChoices(node);
  const fallbackAge = options.fallbackAge ?? 20;

  return {
    ...normalized,
    age: clampNumber(readNumber(normalized.age ?? normalized.currentAge, fallbackAge), options.minAge, options.maxAge),
    stage: readString(normalized.stage) || "现实转折",
    title: readString(normalized.title) || "新的选择",
    description: readNodeDescription(normalized) || "新的现实局面正在展开。",
    attributes: normalizeAttributes(normalized.attributes),
    isEndingNode: Boolean(normalized.isEndingNode)
  } as WithNormalizedNode<T>;
}
