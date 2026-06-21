# Event Dispatcher V1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the V1.1 event dispatcher spec: event metadata, cooldown, category/tag limits, abstract prompt seeds, and stable/no-event progression.

**Architecture:** Keep the event database in `src/data/lifeEvents.ts`, but make event selection metadata-driven. Add event metadata to generated nodes/history so the backend can cool down events by `eventId` and `eventTags` instead of inferred titles or keywords.

**Tech Stack:** TypeScript, React, Express, tsx tests, Vite, esbuild.

---

### Task 1: Event Dispatcher Tests

**Files:**
- Create: `src/data/lifeEvents.test.ts`
- Create: `src/utils/eventPrompt.test.ts`

- [ ] **Step 1: Write failing tests for cooldown and tags**

```ts
import assert from "node:assert/strict";
import { queryDynamicLifeEvent } from "./lifeEvents";

const lowHealth = { happiness: 45, intelligence: 50, wealth: 50, relation: 50, health: 30 };

assert.equal(
  queryDynamicLifeEvent(lowHealth, {}, 55, [
    {
      age: 52,
      title: "身体亮起红灯",
      stage: "中年困顿期",
      description: "被迫停下。",
      selectedChoice: "接受停顿",
      attributes: lowHealth,
      eventMeta: {
        eventId: "health_life_accident_lesson",
        eventCategory: "health",
        eventTags: ["health", "major_crisis", "forced_pause"]
      }
    }
  ])?.id,
  undefined
);
```

- [ ] **Step 2: Write failing tests for promptSeed rendering**

```ts
import assert from "node:assert/strict";
import { buildEventSeedPrompt } from "./eventPrompt";

const prompt = buildEventSeedPrompt({
  id: "health_life_accident_lesson",
  category: "health",
  title: "身体宕机与生活暂停",
  minAge: 18,
  maxAge: 70,
  conditionDescription: "健康 < 40",
  check: () => true,
  cooldown: 8,
  tags: ["health", "major_crisis", "forced_pause"],
  promptSeed: {
    core: "长期透支导致一次现实的身体宕机。",
    contextGuidance: ["结合上一阶段动态渲染。"],
    forbidden: ["不要固定写雨夜骨折。"],
    optionDirections: ["接受停顿。"]
  }
});

assert.match(prompt, /剧情指令/);
assert.match(prompt, /长期透支/);
assert.doesNotMatch(prompt, /骑共享单车/);
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
TMPDIR=/private/tmp node --import tsx src/data/lifeEvents.test.ts
TMPDIR=/private/tmp node --import tsx src/utils/eventPrompt.test.ts
```

Expected: Fail because signatures and `eventPrompt` do not exist yet.

### Task 2: Event Types and Prompt Rendering

**Files:**
- Modify: `src/types.ts`
- Modify: `src/data/lifeEvents.ts`
- Create: `src/utils/eventPrompt.ts`

- [ ] **Step 1: Add event metadata types**

Add optional `eventMeta` to `SimulationNode` and `HistoryItem`:

```ts
export interface EventMeta {
  eventId?: string;
  eventCategory?: "career" | "relationship" | "health" | "opportunity";
  eventTags: string[];
}
```

- [ ] **Step 2: Add `PromptSeed` and `EventFingerprint`**

Define these in `src/data/lifeEvents.ts` and extend `LifeEventSeed` with optional `cooldown`, `tags`, `fingerprint`, and `promptSeed`.

- [ ] **Step 3: Implement `buildEventSeedPrompt(event)`**

Use `promptSeed` when present; fall back to legacy `conceptPrompt`.

### Task 3: Event Selection

**Files:**
- Modify: `src/data/lifeEvents.ts`

- [ ] **Step 1: Implement cooldown filtering**

Use `history.eventMeta.eventId` for exact cooldown and `eventTags` overlap for strong event fingerprints.

- [ ] **Step 2: Implement category/tag limitation**

If recent two history nodes share `eventCategory`, suppress that category unless no non-cooled candidates remain.

- [ ] **Step 3: Add `life_normal_transition`**

Add a low-conflict ordinary-life event and allow `null` when no safe candidate exists.

### Task 4: Server and Frontend Metadata Wiring

**Files:**
- Modify: `server.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Pass history into `queryDynamicLifeEvent`**

Update `/api/simulator/next-node` to call `queryDynamicLifeEvent(currentAttributes, userData, fallbackAgeCheck, history)`.

- [ ] **Step 2: Attach selected event metadata to generated node**

After normalizing the generated node, set `node.eventMeta` from the selected event.

- [ ] **Step 3: Store current node event metadata into history**

When frontend builds `HistoryItem`, copy `currentNode.eventMeta`.

### Task 5: Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run targeted tests**

```bash
TMPDIR=/private/tmp node --import tsx src/data/lifeEvents.test.ts
TMPDIR=/private/tmp node --import tsx src/utils/eventPrompt.test.ts
```

- [ ] **Step 2: Run existing tests and type check**

```bash
TMPDIR=/private/tmp node --import tsx src/utils/simulationResponse.test.ts
TMPDIR=/private/tmp node --import tsx src/utils/simulationNodeRetry.test.ts
TMPDIR=/private/tmp node --import tsx src/utils/insightResponse.test.ts
./node_modules/.bin/tsc --noEmit
```

- [ ] **Step 3: Build and restart**

```bash
./node_modules/.bin/vite build
node -e "import('esbuild').then(esbuild => esbuild.build({ entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: true, outfile: 'dist/server.cjs' }))"
```

- [ ] **Step 4: Commit and push**

```bash
git add src/data/lifeEvents.ts src/data/lifeEvents.test.ts src/utils/eventPrompt.ts src/utils/eventPrompt.test.ts src/types.ts src/App.tsx server.ts docs/superpowers/plans/2026-06-22-event-dispatcher-v1.1.md
git commit -m "Implement event dispatcher v1.1"
git push
```
