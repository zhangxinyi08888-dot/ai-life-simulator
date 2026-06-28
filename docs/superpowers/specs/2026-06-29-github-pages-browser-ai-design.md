# GitHub Pages Browser AI Architecture Design

## Context

The current application runs correctly in local development because `server.ts` provides the `/api/simulator/*` endpoints. The GitHub Pages deployment only serves static frontend assets, so browser requests to `/api/simulator/generate-questions`, `/api/simulator/start`, `/api/simulator/next-node`, `/api/simulator/analyze-personality`, and `/api/simulator/time-travel` resolve against `zhangxinyi08888-dot.github.io` and fail because no API server exists there.

The requested direction is to fully adapt the project to GitHub Pages and ignore API key exposure concerns. Under that constraint, the app can become a pure static frontend that calls DeepSeek directly from the browser. This preserves realtime interaction while removing the need for Express hosting.

## Goals

- Make the GitHub Pages build functionally complete without a separately deployed backend.
- Preserve the current user-facing simulation flow and AI-generated content behavior.
- Move API orchestration out of Express endpoints and into browser-side services.
- Keep local development simple with `pnpm dev` / Vite and no required Express server.
- Support API key configuration through either a Vite build-time value or an in-app user-provided key stored in browser storage.
- Keep existing prompt builders, response normalization, retry behavior, and validation logic reusable and testable.

## Non-Goals

- Protecting API keys from browser users. This is explicitly out of scope for this architecture.
- Adding a separate hosted API service.
- Replacing DeepSeek with a different provider as part of this refactor.
- Changing the main product UX, visual design, or story-generation rules.
- Rewriting the entire app state model.

## Recommended Approach

Use a pure browser AI client backed by DeepSeek's chat completions API. The frontend owns the same domain operations currently exposed by Express endpoints. `server.ts` becomes optional legacy/local compatibility code and is removed from the GitHub Pages production path.

Alternative approaches considered:

1. Static frontend plus separate API backend.
   - Pros: API keys stay private, backend controls rate limits and provider retries.
   - Cons: Not a complete GitHub Pages-only app, requires another hosting platform.

2. Browser direct to DeepSeek with user-entered key.
   - Pros: Fully GitHub Pages-compatible, no backend hosting, no build-time secret dependency.
   - Cons: User must provide a key; key is visible to the browser environment.

3. Browser direct to DeepSeek with `VITE_DEEPSEEK_API_KEY` compiled at build time.
   - Pros: Simplest user experience.
   - Cons: Key is embedded in public JS assets and must be rotated by rebuilding.

The implementation should support both option 2 and option 3. Runtime user key takes precedence over build-time key.

## Target Architecture

```text
GitHub Pages
  index.html
  React UI
  Browser simulation service
  Browser DeepSeek client
  Prompt builders and response normalizers
  Browser key storage
        |
        | HTTPS POST /chat/completions
        v
DeepSeek API
```

The app must not call `/api/simulator/*` in the GitHub Pages build. All simulation operations should call local TypeScript service functions in the browser.

## Module Design

### `src/services/ai/deepseekBrowserClient.ts`

Purpose: browser-safe DeepSeek transport.

Responsibilities:

- Build the `/chat/completions` request.
- Read API key from explicit arguments, runtime key storage, or `import.meta.env.VITE_DEEPSEEK_API_KEY`.
- Preserve the existing JSON-only system instruction.
- Preserve `response_format: { type: "json_object" }`, `thinking: { type: "disabled" }`, `temperature`, `max_tokens`, and non-streaming behavior.
- Return `{ text: string }` compatible with existing parsing code.
- Convert transport errors, 401/403, provider errors, CORS failures, and malformed responses into typed frontend errors.

Suggested API:

```ts
export interface BrowserDeepSeekConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export async function callDeepSeekJsonFromBrowser(
  config: BrowserDeepSeekConfig,
  prompt: string,
  fetchImpl?: typeof fetch
): Promise<{ text: string }>;
```

### `src/services/ai/apiKeyStore.ts`

Purpose: manage browser-side API key configuration.

Responsibilities:

- Store, read, and clear a DeepSeek key in `localStorage`.
- Expose whether a usable key is available.
- Prefer explicit runtime key over build-time env key.
- Never log the key.

Suggested API:

```ts
export function getDeepSeekApiKey(): string;
export function setDeepSeekApiKey(value: string): void;
export function clearDeepSeekApiKey(): void;
export function hasDeepSeekApiKey(): boolean;
```

### `src/services/simulation/simulationService.ts`

Purpose: replace the five Express endpoints with direct browser functions.

Responsibilities:

- `generateQuestions(userData)` replaces `POST /api/simulator/generate-questions`.
- `startSimulation(userData, answers)` replaces `POST /api/simulator/start`.
- `generateNextNode(input)` replaces `POST /api/simulator/next-node`.
- `analyzePersonality(input)` replaces `POST /api/simulator/analyze-personality`.
- `timeTravel(input)` replaces `POST /api/simulator/time-travel`.
- Reuse existing prompt builders from `src/utils/questionPrompt.ts`, `src/utils/eventPrompt.ts`, `src/utils/answerFormatting.ts`, and normalization helpers from `src/utils/simulationResponse.ts`, `src/utils/insightResponse.ts`, and `src/utils/simulationNodeRetry.ts`.
- Keep endpoint response shapes compatible with current `App.tsx` expectations.

This service should be pure TypeScript and browser-compatible. It must not import Express, Node `path`, `dotenv`, or `@google/genai/node` APIs.

### Prompt Extraction

`server.ts` currently contains important prompt logic inline. During implementation, move endpoint-specific prompt construction into browser-safe modules under `src/services/simulation/prompts/` or `src/utils/`.

Suggested modules:

- `src/services/simulation/prompts/startSimulationPrompt.ts`
- `src/services/simulation/prompts/nextNodePrompt.ts`
- `src/services/simulation/prompts/personalityPrompt.ts`
- `src/services/simulation/prompts/timeTravelPrompt.ts`

The extracted functions should have small typed inputs and return strings. They should not call AI APIs directly.

### `src/App.tsx`

Purpose: consume simulation services instead of fetch endpoints.

Changes:

- Replace `fetch("/api/simulator/generate-questions")` with `simulationService.generateQuestions(...)`.
- Replace all other `/api/simulator/*` fetch calls with service calls.
- Keep state transitions and UI flow unchanged.
- Add a clear API-key-required state if no key is configured.
- Convert typed service errors into existing modal messages.

### API Key UI

Add a small configuration path for the browser key. The minimal version can live in the initial setup flow or an unobtrusive settings panel.

Behavior:

- If neither `localStorage` nor `VITE_DEEPSEEK_API_KEY` has a key, show an API key prompt before AI generation starts.
- Allow users to save the key locally.
- Allow clearing/replacing the key.
- Do not block the static app shell from loading.

## Build and Deployment Changes

### `package.json`

The GitHub Pages production build should only build the frontend.

Recommended scripts:

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "lint": "tsc --noEmit",
    "server:dev": "tsx server.ts",
    "server:build": "esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "server:start": "node dist/server.cjs"
  }
}
```

`server.ts` can remain for optional backend mode, but it should no longer be part of the Pages artifact.

### GitHub Pages Workflow

The workflow should build the static frontend and upload `dist`. It should keep:

- `BASE_PATH: /ai-life-simulator/`
- `cp dist/index.html dist/404.html`
- `touch dist/.nojekyll`

It should remove the server bundle cleanup once `pnpm build` no longer produces `dist/server.cjs`.

If using a build-time key, set:

```yaml
env:
  BASE_PATH: /ai-life-simulator/
  VITE_DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
  VITE_DEEPSEEK_MODEL: deepseek-v4-flash
  VITE_DEEPSEEK_BASE_URL: https://api.deepseek.com
```

If using user-entered key only, do not configure `VITE_DEEPSEEK_API_KEY`.

## Data Flow

### Generate Follow-Up Questions

1. User submits initial setup.
2. `App.tsx` calls `simulationService.generateQuestions(userData)`.
3. Service builds prompt with `buildQuestionPrompt(userData)`.
4. Browser DeepSeek client sends the chat completion request.
5. Service parses JSON and returns `{ questions }`.
6. UI moves to the questioning step.

### Start Simulation

1. User submits answers.
2. Service builds the start simulation prompt using extracted prompt logic.
3. Browser client calls DeepSeek.
4. Service uses existing retry and normalization helpers.
5. UI receives `{ initialAttributes, startNode }` and moves to simulation.

### Next Node, Final Insight, Time Travel

These flows mirror the current server endpoints but execute inside `simulationService`. Service functions own prompt construction, AI calls, parse/normalize, and typed error conversion.

## Error Handling

Create a small error type or discriminated union for service failures:

```ts
export type AiClientErrorCode =
  | "API_KEY_MISSING"
  | "AI_AUTH_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_NETWORK_FAILED"
  | "AI_RESPONSE_INVALID"
  | "AI_REQUEST_FAILED";
```

UI mapping:

- `API_KEY_MISSING`: show key setup prompt.
- `AI_AUTH_FAILED`: ask user to check key.
- `AI_RATE_LIMITED`: ask user to retry later.
- `AI_NETWORK_FAILED`: keep the current network wording.
- `AI_RESPONSE_INVALID`: ask user to retry generation.
- `AI_REQUEST_FAILED`: generic AI failure message with retry.

The app should not rely on `response.ok` or endpoint-shaped `{ error }` responses after migration; service functions should throw typed errors or return typed success values.

## Testing Plan

Add focused tests before implementation:

- Browser DeepSeek client builds the correct endpoint and request body.
- Browser DeepSeek client extracts JSON content and strips fenced JSON.
- API key store prefers runtime key over build-time key.
- `simulationService.generateQuestions` returns parsed questions from a fake fetch response.
- `simulationService.startSimulation` retries incomplete nodes and returns normalized output.
- `App.tsx` integration can be covered later if a UI test harness is introduced; it is not required for this refactor.

Use existing test style with `node:assert/strict` and `tsx`.

## Migration Steps

1. Add browser DeepSeek client and API key store tests.
2. Implement browser DeepSeek client and API key store.
3. Extract prompt construction from `server.ts` into browser-safe modules.
4. Add `simulationService` tests for each endpoint-equivalent operation.
5. Implement `simulationService` using extracted prompts and existing normalizers.
6. Update `App.tsx` to call `simulationService` instead of `/api/simulator/*`.
7. Add API key configuration UI.
8. Change `package.json` scripts so Pages builds only `vite build`.
9. Simplify `.github/workflows/deploy-pages.yml` for static-only output.
10. Verify local static build with `BASE_PATH=/ai-life-simulator/ pnpm build`.
11. Verify deployed Pages no longer calls `/api/simulator/*` by inspecting built JS and browser network requests.

## Acceptance Criteria

- GitHub Pages loads the app shell at `/ai-life-simulator/`.
- Starting the simulation from GitHub Pages no longer requests `https://zhangxinyi08888-dot.github.io/api/simulator/*`.
- With a valid DeepSeek key, the deployed Pages app can generate follow-up questions, start a simulation, generate next nodes, time travel, and produce the final insight report.
- Without a key, the deployed Pages app shows a key configuration message instead of the generic network failure modal.
- Local development works without running Express.
- `pnpm lint` passes.
- Existing utility tests pass, plus new browser AI service tests.
- The Pages artifact contains only static frontend files, `.nojekyll`, and `404.html`.

## Risks and Mitigations

- DeepSeek CORS behavior may change. Mitigation: keep the browser AI client isolated so a backend adapter can be reintroduced later without rewriting UI state.
- Browser bundles will expose prompts and build-time keys. Mitigation: accepted by current requirements; prefer user-entered key when possible.
- Prompt extraction may accidentally change simulation quality. Mitigation: move strings carefully, keep tests around prompt inputs where feasible, and compare generated request prompts during migration.
- `server.ts` and browser service can drift if both remain active. Mitigation: mark `server.ts` as legacy optional mode after migration, or remove it in a later cleanup once Pages mode is verified.

## Open Implementation Decision

Use user-entered DeepSeek key as the default runtime path, while still supporting optional `VITE_DEEPSEEK_API_KEY` for convenience. This keeps GitHub Pages fully static and avoids requiring GitHub Secrets for normal use.
