export interface DeepSeekClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] || trimmed).trim();
}

export async function callDeepSeekJson(
  config: DeepSeekClientConfig,
  prompt: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ text: string }> {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是一个严格的 JSON 生成器。只返回一个合法 JSON 对象，不要输出 Markdown、解释文字或代码围栏。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.85,
      max_tokens: 8192,
      stream: false
    })
  });

  const bodyText = await response.text();
  let body: any = null;

  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(bodyText || `DeepSeek API request failed with status ${response.status}`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error(`DeepSeek API response did not include JSON content: ${bodyText}`);
  }

  return { text: extractJsonText(content) };
}

