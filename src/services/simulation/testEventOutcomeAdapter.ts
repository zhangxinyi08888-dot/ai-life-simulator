import type { GenerateNextNodeInput, SimulationServiceDeps } from "./simulationService";
import { generateNextNode as generateNextNodeProduction } from "./simulationService";

function allowedOutcomesFromPrompt(prompt: string): string[] {
  const section = prompt.match(/allowedOutcomes:\n([\s\S]*?)\nemotionalTone:/)?.[1] || "";
  return [...section.matchAll(/^\s*\d+\.\s*(\S+)\s*$/gm)].map((match) => match[1]).slice(0, 3);
}

/** Keeps legacy AI fixtures aligned with the Phase 2 event response contract. */
export async function generateNextNodeWithEventOutcomes(
  input: GenerateNextNodeInput,
  deps: SimulationServiceDeps = {}
) {
  if (!deps.callAiJson) return generateNextNodeProduction(input, deps);
  const originalCall = deps.callAiJson;
  return generateNextNodeProduction(input, {
    ...deps,
    callAiJson: async (prompt) => {
      const response = await originalCall(prompt);
      const allowed = allowedOutcomesFromPrompt(prompt);
      if (allowed.length < 2 || typeof response?.text !== "string") return response;
      try {
        const parsed = JSON.parse(response.text);
        if (Array.isArray(parsed?.choices)) {
          parsed.choices = parsed.choices.map((choice: unknown, index: number) => ({
            ...(choice && typeof choice === "object" ? choice : {}),
            eventOutcomeId: (choice as { eventOutcomeId?: string })?.eventOutcomeId || allowed[index % allowed.length]
          }));
          return { ...response, text: JSON.stringify(parsed) };
        }
      } catch {
        return response;
      }
      return response;
    }
  });
}

