const SENTENCE_END_PATTERN = /[。！？!?；;]/;
const SHORT_PARAGRAPH_TARGET_LENGTH = 64;
const SHORT_PARAGRAPH_MAX_LENGTH = 76;
const SHORT_PARAGRAPH_MIN_SPLIT_LENGTH = 32;

export function splitNarrativeSentences(text: string): string[] {
  if (!text) return [];
  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_END_PATTERN.test(text[index])) continue;
    while (index + 1 < text.length && SENTENCE_END_PATTERN.test(text[index + 1])) index += 1;
    while (index + 1 < text.length && /[”’）】》」』]/.test(text[index + 1])) index += 1;
    sentences.push(text.slice(start, index + 1));
    start = index + 1;
  }

  if (start < text.length) sentences.push(text.slice(start));
  return sentences.filter(Boolean);
}

export function completeSentencePrefix(text: string): string {
  const sentences = splitNarrativeSentences(text);
  while (sentences.length > 0 && !SENTENCE_END_PATTERN.test(sentences.at(-1)!)) sentences.pop();
  return sentences.join("");
}

function splitSingleBlock(text: string, includeTrailingParagraph: boolean): string[] {
  const sentences = splitNarrativeSentences(text).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length === 0) return [];

  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (
      current
      && current.length >= SHORT_PARAGRAPH_MIN_SPLIT_LENGTH
      && current.length + sentence.length > SHORT_PARAGRAPH_MAX_LENGTH
    ) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
    if (current.length >= SHORT_PARAGRAPH_TARGET_LENGTH) {
      paragraphs.push(current);
      current = "";
    }
  }

  if (includeTrailingParagraph && current) paragraphs.push(current);
  return paragraphs;
}

export function splitNarrativeParagraphs(description: string): string[] {
  const normalized = description.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const explicitParagraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, "").trim())
    .filter(Boolean);

  return explicitParagraphs.flatMap((paragraph) => splitSingleBlock(paragraph, true));
}

export function splitStableStreamingParagraphs(text: string): string[] {
  const completePrefix = completeSentencePrefix(text.replace(/\r\n/g, "\n"));
  if (!completePrefix) return [];
  return completePrefix
    .split(/\n\s*\n+/)
    .flatMap((paragraph) => splitSingleBlock(paragraph.replace(/\s*\n\s*/g, "").trim(), false));
}
