import { splitNarrativeParagraphs, splitStableStreamingParagraphs } from "./narrativePresentation";

export interface StreamedNodePreview {
  title?: string;
  paragraphs: string[];
  descriptionComplete: boolean;
}

function splitCompletedStreamingParagraphs(value: string, complete: boolean): string[] {
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  if (complete) return splitNarrativeParagraphs(normalized);

  const separator = /\n\s*\n+/g;
  const completed: string[] = [];
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(normalized)) !== null) {
    const paragraph = normalized.slice(start, match.index).replace(/\s*\n\s*/g, "").trim();
    if (paragraph) completed.push(...splitNarrativeParagraphs(paragraph));
    start = match.index + match[0].length;
  }
  const tail = normalized.slice(start).replace(/\s*\n\s*/g, "").trimStart();
  const stableTailParagraphs = splitStableStreamingParagraphs(tail);
  return [...completed, ...stableTailParagraphs];
}

interface JsonStringField {
  value: string;
  complete: boolean;
  endIndex: number;
}

function decodeJsonStringAt(source: string, openingQuoteIndex: number): JsonStringField {
  let value = "";

  for (let index = openingQuoteIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') return { value, complete: true, endIndex: index };
    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = source[index + 1];
    if (escaped === undefined) return { value, complete: false, endIndex: source.length };
    index += 1;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "\t";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === '"' || escaped === "\\" || escaped === "/") value += escaped;
    else if (escaped === "u") {
      const code = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) return { value, complete: false, endIndex: source.length };
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 4;
    } else {
      value += escaped;
    }
  }

  return { value, complete: false, endIndex: source.length };
}

function readJsonStringField(source: string, field: string): JsonStringField | undefined {
  const fieldMatch = new RegExp(`"${field}"\\s*:\\s*"`).exec(source);
  if (!fieldMatch) return undefined;
  const openingQuoteIndex = fieldMatch.index + fieldMatch[0].length - 1;
  return decodeJsonStringAt(source, openingQuoteIndex);
}

interface JsonStringArrayField {
  values: string[];
  complete: boolean;
  partialValue?: string;
}

function readJsonStringArrayField(source: string, field: string): JsonStringArrayField | undefined {
  const fieldMatch = new RegExp(`"${field}"\\s*:\\s*\\[`).exec(source);
  if (!fieldMatch) return undefined;
  let index = fieldMatch.index + fieldMatch[0].length;
  const values: string[] = [];

  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1;
    if (source[index] === "]") return { values, complete: true };
    if (source[index] !== '"') return { values, complete: false };

    const item = decodeJsonStringAt(source, index);
    if (!item.complete) return { values, complete: false, partialValue: item.value };
    const value = item.value.replace(/\s*\n\s*/g, "").trim();
    if (value) values.push(value);
    index = item.endIndex + 1;
  }

  return { values, complete: false };
}

export function extractStreamedNodePreview(source: string): StreamedNodePreview {
  const title = readJsonStringField(source, "title");
  const structuredParagraphs = readJsonStringArrayField(source, "descriptionParagraphs");
  const description = readJsonStringField(source, "description");
  const completedStructuredParagraphs = structuredParagraphs?.values.flatMap((paragraph) => (
    splitNarrativeParagraphs(paragraph)
  )) ?? [];
  const structuredPartialParagraphs = splitStableStreamingParagraphs(
    (structuredParagraphs?.partialValue || "").replace(/\s*\n\s*/g, "").trimStart()
  );
  const paragraphs = structuredParagraphs
    ? [...completedStructuredParagraphs, ...structuredPartialParagraphs]
    : splitCompletedStreamingParagraphs(
        description?.value || "",
        Boolean(description?.complete)
      );
  const descriptionComplete = structuredParagraphs
    ? structuredParagraphs.complete
    : Boolean(description?.complete);

  return {
    title: title?.complete ? title.value.trim() || undefined : undefined,
    paragraphs,
    descriptionComplete
  };
}

export function mergeStreamedNodePreview(
  previous: StreamedNodePreview | null,
  incoming: StreamedNodePreview,
  preservePrevious: boolean
): StreamedNodePreview {
  if (!preservePrevious) return incoming;
  if (!previous) {
    const paragraphs = incoming.paragraphs.slice(0, 1);
    return {
      ...incoming,
      paragraphs,
      descriptionComplete: incoming.descriptionComplete && paragraphs.length === incoming.paragraphs.length
    };
  }
  const canAppendWithoutChangingVisibleParagraphs = previous.paragraphs.every((paragraph, index) => (
    incoming.paragraphs[index] === paragraph
  ));
  if (canAppendWithoutChangingVisibleParagraphs && incoming.paragraphs.length >= previous.paragraphs.length) {
    const paragraphs = incoming.paragraphs.slice(0, previous.paragraphs.length + 1);
    return {
      ...incoming,
      title: previous.title || incoming.title,
      paragraphs,
      descriptionComplete: incoming.descriptionComplete && paragraphs.length === incoming.paragraphs.length
    };
  }
  return {
    title: previous.title || incoming.title,
    paragraphs: previous.paragraphs,
    descriptionComplete: false
  };
}
