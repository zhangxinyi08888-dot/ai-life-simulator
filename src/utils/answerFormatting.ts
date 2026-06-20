function stringifyAnswerValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "未解答";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(stringifyAnswerValue).join("；");
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return stringifyAnswerValue(record.answer ?? record.value ?? record.text ?? record.content ?? JSON.stringify(record));
  }

  return String(value);
}

export function formatAnswerTurns(
  answers: unknown,
  labels: { question: string; answer: string } = {
    question: "追问问题",
    answer: "用户当时想法/真实立场"
  }
): string {
  if (!answers) {
    return "";
  }

  const turns = Array.isArray(answers)
    ? answers
    : typeof answers === "object"
      ? Object.entries(answers as Record<string, unknown>).map(([key, value]) => {
          const record = value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;

          return {
            question: stringifyAnswerValue(record?.question ?? record?.label ?? key),
            answer: stringifyAnswerValue(record ?? value)
          };
        })
      : [{ question: "用户补充", answer: stringifyAnswerValue(answers) }];

  return turns
    .map((turn: any) => {
      const question = stringifyAnswerValue(turn?.question ?? turn?.label ?? "追问");
      const answer = stringifyAnswerValue(turn?.answer ?? turn?.value ?? turn?.text);
      return `  * ${labels.question}：${question}\n  * ${labels.answer}：${answer}`;
    })
    .join("\n");
}
