import assert from "node:assert/strict";
import test from "node:test";

import { buildOrderReversalPacket } from "./prepare-cache-prefix-order-reversal.mjs";

function block(id, a, b) {
  return `## ${id}\n\n共享\n\n### 版本 A\n\n${a}\n\n### 版本 B\n\n${b}\n\n#### 审阅记录\n\n记录\n\n---\n\n`;
}

test("reverses only odd-numbered node display order without changing labels or bodies", () => {
  const packet = `# 标题\n\n## 审阅任务\n\n规则\n\n${Array.from({ length: 10 }, (_, index) => {
    const id = `N${String(index + 1).padStart(2, "0")}`;
    return block(id, `A-${id}`, `B-${id}`);
  }).join("")}`;
  const output = buildOrderReversalPacket(packet);

  assert.match(output, /^# 标题/mu);
  assert.match(output, /奇数节点显示 B 后显示 A/u);
  for (let index = 1; index <= 10; index += 1) {
    const id = `N${String(index).padStart(2, "0")}`;
    const node = output.match(new RegExp(`## ${id}([\\s\\S]*?)(?=## N\\d{2}|$)`, "u"))?.[1];
    assert.ok(node, `${id} exists`);
    const aIndex = node.indexOf("### 版本 A");
    const bIndex = node.indexOf("### 版本 B");
    assert.equal(index % 2 === 1, bIndex < aIndex, `${id} has expected display order`);
    assert.match(node, new RegExp(`A-${id}`, "u"));
    assert.match(node, new RegExp(`B-${id}`, "u"));
  }
});
