# Context Continuity Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V2 rendering consistently use follow-up answers, recent five-node history, and lightweight relationship/family side threads while letting `coreStoryFocus` influence event category weights.

**Architecture:** Add a small `StoryContextPack` utility that extracts user facts, answer facts, recent history, and active side threads. Feed that pack into event/null prompt builders, and update event dispatch weighting so focus boosts affect selection without bypassing eligibility, cooldown, or tag dedupe.

**Tech Stack:** TypeScript, Express, node assert tests with `tsx`.

---

### Task 1: Story Context Pack

**Files:**
- Create: `src/utils/storyContext.ts`
- Create: `src/utils/storyContext.test.ts`

- [ ] Write failing tests for answer facts, recent 5 history nodes, and family/romance thread extraction.
- [ ] Implement `buildStoryContextPack`.
- [ ] Implement `formatStoryContextPack`.
- [ ] Verify focused test passes.

### Task 2: Prompt Integration

**Files:**
- Modify: `src/utils/eventPrompt.ts`
- Modify: `src/utils/eventPrompt.test.ts`
- Modify: `server.ts`

- [ ] Write failing tests proving event and null prompts include Story Context Pack, require one answer fact when available, and describe null side-thread progression.
- [ ] Pass `StoryContextPack` into event/null prompt builders from `server.ts`.
- [ ] Verify focused tests pass.

### Task 3: Focus-Aware Dispatch

**Files:**
- Modify: `src/data/lifeEvents.ts`
- Modify: `src/data/lifeEvents.test.ts`

- [ ] Write failing tests proving `coreStoryFocus=romance` boosts relationship weight.
- [ ] Implement focus category multipliers at weighted selection time.
- [ ] Add lightweight relationship context fallback eligibility only through existing user context, without bypassing cooldown or tag dedupe.
- [ ] Verify focused tests pass.

### Task 4: Final Verification

**Files:**
- No source edits unless failures reveal issues.

- [ ] Run focused tests.
- [ ] Run TypeScript check.
- [ ] Run existing regression tests.
- [ ] Build frontend and server.
