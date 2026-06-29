# Event System V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three-layer V2 event system so events provide eligibility, intent, tags, cooldown, and base probability while AI rendering owns concrete story details.

**Architecture:** Keep the existing simulator endpoint shape, but replace V1 `check` / `conceptPrompt` / `promptSeed` usage with V2 `trigger.eligibility` and `intent`. The dispatcher still returns one event or `null`, but selection now applies cooldown, tag similarity dedupe, category pressure, base probability, and normal-life null semantics.

**Tech Stack:** TypeScript, React/Vite, Express, node assert tests with `tsx`.

---

### Task 1: V2 Event Types and Prompt Tests

**Files:**
- Modify: `src/types.ts`
- Modify: `src/data/lifeEvents.ts`
- Modify: `src/utils/eventPrompt.ts`
- Modify: `src/utils/eventPrompt.test.ts`

- [ ] **Step 1: Write the failing prompt test**

```ts
import assert from "node:assert/strict";
import { buildEventIntentPrompt, buildNullEventPrompt } from "./eventPrompt";

const intentPrompt = buildEventIntentPrompt({
  id: "health_system_warning",
  category: "health",
  title: "健康系统预警",
  minAge: 18,
  maxAge: 70,
  conditionDescription: "健康低或压力高",
  cooldown: 6,
  baseProbability: 0.8,
  tags: ["health", "burnout", "instability"],
  trigger: { eligibility: () => true },
  intent: {
    type: "health_system_warning",
    meaning: "长期高压生活引发身体系统性反馈",
    tensionAxes: ["收益 vs 健康", "短期稳定 vs 长期风险"],
    allowedOutcomes: ["persist_high_pressure", "optimize_load", "exit_or_pause"],
    emotionalTone: "crisis"
  }
});

assert.match(intentPrompt, /Event Intent/);
assert.match(intentPrompt, /health_system_warning/);
assert.match(intentPrompt, /allowedOutcomes 是行动原语/);
assert.doesNotMatch(intentPrompt, /现实人生事件触发/);
assert.doesNotMatch(intentPrompt, /剧情指令/);

const nullPrompt = buildNullEventPrompt();
assert.match(nullPrompt, /本轮没有强事件结构/);
assert.match(nullPrompt, /最近 5 个历史节点/);
assert.match(nullPrompt, /不要强行制造事故/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/eventPrompt.test.ts
```

Expected: FAIL because `buildEventIntentPrompt` and `buildNullEventPrompt` do not exist.

- [ ] **Step 3: Implement prompt helpers**

Add `buildEventIntentPrompt(event)` and `buildNullEventPrompt()` in `src/utils/eventPrompt.ts`. Keep `buildEventSeedPrompt` only as a compatibility alias if existing imports still need it.

- [ ] **Step 4: Run the test to verify it passes**

Run the same command. Expected: PASS.

### Task 2: Dispatcher V2 Tests

**Files:**
- Modify: `src/data/lifeEvents.test.ts`
- Modify: `src/data/lifeEvents.ts`

- [ ] **Step 1: Write failing tests for V2 dispatcher behavior**

Test cases:

```ts
assert.ok(LIFE_EVENTS_DATABASE.every((event) => event.intent));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => event.trigger?.eligibility));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => !("conceptPrompt" in event)));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => !("promptSeed" in event)));
assert.ok(LIFE_EVENTS_DATABASE.every((event) => !("check" in event)));

const selected = queryDynamicLifeEvent(lowHealth, {}, 55, []);
assert.notEqual(selected?.id, "life_normal_transition");
assert.ok(selected === null || selected.intent);

const similarBlocked = queryDynamicLifeEvent(lowHealth, {}, 55, [
  historyItem({
    eventId: "health_system_warning",
    eventCategory: "health",
    eventTags: ["health", "burnout", "instability"]
  })
]);
assert.notEqual(similarBlocked?.id, "health_system_warning");
assert.notEqual(similarBlocked?.intent.type, "health_system_warning");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/data/lifeEvents.test.ts
```

Expected: FAIL because events still have V1 fields.

- [ ] **Step 3: Convert event data and dispatcher**

Update `LifeEventSeed` to V2 fields:

```ts
trigger: { eligibility: (...) => boolean }
intent: {
  type: string;
  meaning: string;
  tensionAxes: string[];
  allowedOutcomes: string[];
  emotionalTone?: "pressure" | "neutral" | "opportunity" | "crisis";
}
tags: string[];
baseProbability?: number;
cooldown?: number;
```

Update `queryDynamicLifeEvent` to:

1. Filter by age and `trigger.eligibility`.
2. Apply event id cooldown.
3. Apply tag similarity dedupe.
4. Apply same-category pressure if alternatives exist.
5. Allow `null` through base probability.
6. Return weighted random event or `null`.

- [ ] **Step 4: Run test to verify it passes**

Run the same command. Expected: PASS.

### Task 3: Server Integration

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Update event prompt usage**

Replace `buildEventSeedPrompt(seedEvent)` with:

```ts
const eventSeedPrompt = seedEvent
  ? buildEventIntentPrompt(seedEvent)
  : buildNullEventPrompt();
```

- [ ] **Step 2: Preserve eventMeta response**

Keep:

```ts
return res.json(seedEvent ? { ...node, eventMeta: buildEventMeta(seedEvent) } : node);
```

- [ ] **Step 3: Run TypeScript and existing tests**

Run:

```bash
PATH=/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH TMPDIR=/private/tmp ./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

### Task 4: Final Verification

**Files:**
- No source edits unless verification finds issues.

- [ ] **Step 1: Run focused tests**

```bash
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/data/lifeEvents.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/eventPrompt.test.ts
```

- [ ] **Step 2: Run existing regression tests**

```bash
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/simulationResponse.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/simulationNodeRetry.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/insightResponse.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/questionPrompt.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/answerFormatting.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/deepseek.test.ts
TMPDIR=/private/tmp /Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --import tsx src/utils/geminiErrors.test.ts
```

- [ ] **Step 3: Build**

```bash
PATH=/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH TMPDIR=/private/tmp ./node_modules/.bin/vite build
TMPDIR=/private/tmp ./node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
```

- [ ] **Step 4: Git status**

```bash
git status -sb
```

Expected: only intended docs and V2 implementation files changed.
