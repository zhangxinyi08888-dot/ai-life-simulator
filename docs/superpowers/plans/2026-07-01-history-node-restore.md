# History Node Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make biography history clicks restore the exact historical node snapshot so the user can choose again, without calling AI during the restore action.

**Architecture:** Store enough node data in each `HistoryItem` to rebuild a `SimulationNode`. Put snapshot creation and restoration in a small pure utility so the App and reports pass history indexes instead of ages.

**Tech Stack:** React 19, TypeScript, Vite, Node assert tests run through `tsx`.

---

### Task 1: Add History Snapshot Utility

**Files:**
- Modify: `src/types.ts`
- Create: `src/utils/historyRestore.ts`
- Test: `src/utils/historyRestore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/historyRestore.test.ts` with assertions that:

```ts
import assert from "node:assert/strict";
import { HistoryItem, SimulationNode } from "../types";
import { createHistoryItemFromNode, restoreHistoryNodeAtIndex } from "./historyRestore";

const choices = [
  { id: "A", text: "留在本城继续试错", impactSummary: "稳中求变" },
  { id: "B", text: "去外地接受新机会", impactSummary: "异地重启" },
  { id: "C", text: "暂停一年整理方向", impactSummary: "蓄力观察" }
];

const node: SimulationNode = {
  age: 24,
  stage: "职场岔路",
  title: "第一份工作后的摇摆",
  description: "你站在是否离开的节点上。",
  choices,
  attributes: { happiness: 55, intelligence: 63, wealth: 41, relation: 58, health: 72 },
  isEndingNode: false,
  eventMeta: { eventId: "career-crossroad", eventCategory: "career", eventTags: ["job"] }
};

const item = createHistoryItemFromNode(node, "去外地接受新机会");
assert.deepEqual(item.choices, choices);
assert.equal(item.isEndingNode, false);
assert.equal(item.selectedChoice, "去外地接受新机会");

const earlier: HistoryItem = createHistoryItemFromNode(
  { ...node, age: 23, title: "前一个节点" },
  "继续推进"
);
const sameAgeLater: HistoryItem = createHistoryItemFromNode(
  { ...node, title: "同岁但不同节点", description: "同一年发生的另一个转折。" },
  "暂停一年整理方向"
);

const restored = restoreHistoryNodeAtIndex([earlier, item, sameAgeLater], 2);
assert.equal(restored.node.age, 24);
assert.equal(restored.node.title, "同岁但不同节点");
assert.equal(restored.node.description, "同一年发生的另一个转折。");
assert.deepEqual(restored.node.choices, choices);
assert.deepEqual(restored.historyBefore, [earlier, item]);
assert.equal(restored.nodeCount, 3);

assert.throws(() => restoreHistoryNodeAtIndex([earlier], -1), /HISTORY_RESTORE_INDEX_OUT_OF_RANGE/);
assert.throws(() => restoreHistoryNodeAtIndex([earlier], 1), /HISTORY_RESTORE_INDEX_OUT_OF_RANGE/);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
PATH="/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH" pnpm exec tsx src/utils/historyRestore.test.ts
```

Expected: FAIL because `src/utils/historyRestore.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implement `createHistoryItemFromNode(node, selectedChoice)` and `restoreHistoryNodeAtIndex(history, targetIndex)`.

- [ ] **Step 4: Run test to verify it passes**

Run the same `tsx` command. Expected: exit 0.

### Task 2: Wire App State to Snapshot Restore

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SimulationEngine.tsx`
- Modify: `src/components/DestinyReport.tsx`

- [ ] **Step 1: Update callback signatures**

Change `onTimeTravel` props from `(targetAge: number) => void` to `(targetIndex: number) => void`.

- [ ] **Step 2: Save full history snapshots**

Replace inline history item object creation in `App.tsx` with `createHistoryItemFromNode(currentNode, choiceText)` so every history entry includes `choices` and `isEndingNode`.

- [ ] **Step 3: Restore by index without AI**

Replace `handleTimeTravel(targetAge)` with a restore handler using `restoreHistoryNodeAtIndex(history, targetIndex)`. The handler must set attributes, current node, truncated history, node count, and `simulating` step, and must not call `runTimeTravel()`.

- [ ] **Step 4: Pass indexes from UI**

In `SimulationEngine`, pass `idx` from the history map. In `DestinyReport`, pass `i` from the report history map.

### Task 3: Verify and Commit

**Files:**
- All modified implementation and test files.

- [ ] **Step 1: Run focused regression test**

```bash
PATH="/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH" pnpm exec tsx src/utils/historyRestore.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run TypeScript check**

```bash
PATH="/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH" pnpm lint
```

Expected: exit 0.

- [ ] **Step 3: Run existing simulation tests**

```bash
PATH="/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/zz/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH" pnpm exec tsx src/services/simulation/simulationService.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/utils/historyRestore.ts src/utils/historyRestore.test.ts src/App.tsx src/components/SimulationEngine.tsx src/components/DestinyReport.tsx docs/superpowers/plans/2026-07-01-history-node-restore.md
git commit -m "feat: restore biography history nodes"
```

