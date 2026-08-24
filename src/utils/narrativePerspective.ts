/**
 * The simulation presents a life to the user, so chapter prose is always
 * second-person.  Direct quotations are deliberately excluded: another
 * character may naturally say "我", but the narrator must not become "我".
 */
const DIRECT_QUOTE_SOURCE = '“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"';

function directQuotePattern(): RegExp {
  return new RegExp(DIRECT_QUOTE_SOURCE, "gu");
}

const NON_NARRATOR_FIRST_PERSON_TERMS = /(?:自我|忘我|无我|唯我|我行我素)/gu;
const FIRST_PERSON_NARRATOR = /我(?:们|的|自己)?|咱(?:们)?|本人/u;

function mapOutsideDirectQuotes(value: string, transform: (segment: string) => string): string {
  let result = "";
  let cursor = 0;

  for (const quote of value.matchAll(directQuotePattern())) {
    const index = quote.index ?? cursor;
    result += transform(value.slice(cursor, index));
    result += quote[0];
    cursor = index + quote[0].length;
  }

  return result + transform(value.slice(cursor));
}

function normalizeUnquotedNarration(value: string): string {
  const preservedTerms: string[] = [];
  const shielded = value.replace(NON_NARRATOR_FIRST_PERSON_TERMS, (term) => {
    const placeholder = `\uE000${preservedTerms.length}\uE001`;
    preservedTerms.push(term);
    return placeholder;
  });

  const normalized = shielded
    .replace(/我自己/gu, "你自己")
    .replace(/我们/gu, "你们")
    .replace(/咱们/gu, "你们")
    .replace(/我的/gu, "你的")
    .replace(/本人/gu, "你本人")
    .replace(/咱/gu, "你")
    .replace(/我/gu, "你");

  return normalized.replace(/\uE000(\d+)\uE001/gu, (_placeholder, index: string) => (
    preservedTerms[Number(index)] ?? ""
  ));
}

/**
 * Returns true when visible prose uses a first-person narrator outside of
 * quoted dialogue.  This intentionally catches forms such as “和我…”,
 * “我的…”, “我们…”, and “本人…”, not merely sentences that start with “我”.
 */
export function hasFirstPersonNarration(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const unquoted = value.replace(directQuotePattern(), "");
  return FIRST_PERSON_NARRATOR.test(unquoted.replace(NON_NARRATOR_FIRST_PERSON_TERMS, ""));
}

/**
 * Converts model narration into the product's second-person perspective.
 * Direct speech is left byte-for-byte intact because another character is
 * allowed to say "我". This is a deterministic content correction, not a
 * model retry, so validation sees the same corrected text as the player.
 */
export function normalizeNarrativeToSecondPerson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  return mapOutsideDirectQuotes(value, normalizeUnquotedNarration);
}

/**
 * Normalizes every model-produced string in a JSON-shaped generation payload.
 * Applying this before authority validation keeps description text and its
 * structured evidence in the same grammatical perspective.
 */
export function normalizeNarrativePayloadToSecondPerson<T>(value: T): T {
  if (typeof value === "string") {
    return normalizeNarrativeToSecondPerson(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNarrativePayloadToSecondPerson(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeNarrativePayloadToSecondPerson(item)
      ])
    ) as T;
  }

  return value;
}
