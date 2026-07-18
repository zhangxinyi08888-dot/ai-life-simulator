import { splitNarrativeParagraphs } from "./narrativePresentation";

export interface StreamedNodePreview {
  title?: string;
  paragraphs: string[];
  descriptionComplete: boolean;
}

interface JsonStringField {
  value: string;
  complete: boolean;
}

function decodeJsonStringAt(source: string, openingQuoteIndex: number): JsonStringField {
  let value = "";

  for (let index = openingQuoteIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') return { value, complete: true };
    if (character !== "\\") {
      value += character;
      continue;
    }

    const escaped = source[index + 1];
    if (escaped === undefined) return { value, complete: false };
    index += 1;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "\t";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === '"' || escaped === "\\" || escaped === "/") value += escaped;
    else if (escaped === "u") {
      const code = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) return { value, complete: false };
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 4;
    } else {
      value += escaped;
    }
  }

  return { value, complete: false };
}

function readJsonStringField(source: string, field: string): JsonStringField | undefined {
  const fieldMatch = new RegExp(`"${field}"\\s*:\\s*"`).exec(source);
  if (!fieldMatch) return undefined;
  const openingQuoteIndex = fieldMatch.index + fieldMatch[0].length - 1;
  return decodeJsonStringAt(source, openingQuoteIndex);
}

export function extractStreamedNodePreview(source: string): StreamedNodePreview {
  const title = readJsonStringField(source, "title");
  const description = readJsonStringField(source, "description");
  const paragraphs = splitNarrativeParagraphs(description?.value || "");

  return {
    title: title?.value.trim() || undefined,
    paragraphs,
    descriptionComplete: Boolean(description?.complete)
  };
}

export function mergeStreamedNodePreview(
  previous: StreamedNodePreview | null,
  incoming: StreamedNodePreview,
  preservePrevious: boolean
): StreamedNodePreview {
  if (!preservePrevious || !previous) return incoming;
  const previousLength = previous.paragraphs.join("\n\n").length;
  const incomingLength = incoming.paragraphs.join("\n\n").length;
  if (incomingLength >= previousLength) return incoming;
  return {
    title: incoming.title || previous.title,
    paragraphs: previous.paragraphs,
    descriptionComplete: false
  };
}
