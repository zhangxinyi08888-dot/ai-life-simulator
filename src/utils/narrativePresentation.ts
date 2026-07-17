const SENTENCE_PATTERN = /[^。！？!?；;]+[。！？!?；;]?/g;

function splitSingleBlock(text: string): string[] {
  if (text.length <= 90) return [text];

  const sentences = text.match(SENTENCE_PATTERN)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  if (sentences.length <= 1) return [text];

  const desiredCount = Math.min(4, Math.max(2, Math.ceil(text.length / 100)));
  const targetLength = Math.ceil(text.length / desiredCount);
  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (
      current
      && paragraphs.length < desiredCount - 1
      && current.length >= targetLength * 0.55
      && current.length + sentence.length > targetLength
    ) {
      paragraphs.push(current);
      current = sentence;
      continue;
    }
    current += sentence;
  }

  if (current) paragraphs.push(current);
  if (paragraphs.length > 1 && paragraphs.at(-1)!.length < 28) {
    paragraphs[paragraphs.length - 2] += paragraphs.pop();
  }

  return paragraphs.length <= 4
    ? paragraphs
    : [...paragraphs.slice(0, 3), paragraphs.slice(3).join("")];
}

export function splitNarrativeParagraphs(description: string): string[] {
  const normalized = description.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const explicitParagraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, "").trim())
    .filter(Boolean);

  if (
    explicitParagraphs.length > 1
    && explicitParagraphs.length <= 4
    && explicitParagraphs.every((paragraph) => paragraph.length <= 120)
  ) {
    return explicitParagraphs;
  }

  return splitSingleBlock(explicitParagraphs.join("") || normalized);
}
