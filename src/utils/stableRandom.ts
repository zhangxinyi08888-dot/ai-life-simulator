function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

export function stableHash(value: unknown): string {
  const text = stableSerialize(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stableRandom(value: unknown): number {
  return Number.parseInt(stableHash(value), 16) / 0x100000000;
}

export function stableInteger(min: number, max: number, value: unknown): number {
  if (max <= min) return min;
  return min + Math.floor(stableRandom(value) * (max - min + 1));
}
