import assert from "node:assert/strict";
import test from "node:test";
import { buildBlindReviewArtifacts } from "./prepare-cache-prefix-blind-review.mjs";
import { evaluateBlindReview, parseBlindReviewRecord } from "./evaluate-cache-prefix-blind-review.mjs";

function node(number, label) {
  return {
    ageInMonths: 240 + number,
    stage: `${label} 阶段 ${number}`,
    title: `${label} 节点 ${number}`,
    description: `${label} 正文 ${number}，包含可核对的现实细节。`,
    selectedChoice: `${label} 的实际选择 ${number}`,
    choices: [{ text: "A" }, { text: "B" }, { text: "C" }],
    attributes: { happiness: 50, intelligence: 51, wealth: 52, relation: 53, health: 54 }
  };
}

function record(slug, label) {
  return {
    caseSlug: slug,
    passed: true,
    dataSource: "real_ai_browser",
    finalState: {
      testDataSource: "real_ai_browser",
      e2eCase: null,
      history: Array.from({ length: 18 }, (_, index) => node(index + 1, label))
    }
  };
}

function completedReview(template, { critical = false, packetSha256 } = {}) {
  const lines = template.split("\n").map((line) => {
    if (/^\| N\d{2} \|/u.test(line)) {
      const id = line.split("|")[1].trim();
      if (critical && id === "N03") return `| ${id} | 1 | 1 | 1 | 1 | 重大问题 | 角色事实冲突 | 未处置 |`;
      return `| ${id} | 1 | 1 | 1 | 1 | 通过 | 人工确认 | 不需要 |`;
    }
    return line;
  });
  return lines.join("\n")
    .replace("- 审阅人：", "- 审阅人：验收人员")
    .replace("- 审阅日期：", "- 审阅日期：2026-08-05")
    .replaceAll("- [ ]", "- [x]")
    .replace("最终结论：□ 通过  □ 暂不通过  □ 需复测", "最终结论：☑ 通过  □ 暂不通过  □ 需复测")
    .replace(/对应审阅包 SHA-256：`[a-f0-9]{64}`/u, `对应审阅包 SHA-256：\`${packetSha256}\``);
}

function artifacts() {
  return buildBlindReviewArtifacts([
    record("real-career-first", "职业"),
    record("real-relationship-first", "关系")
  ]);
}

test("blind-review acceptance requires individual review but has no average-score threshold", () => {
  const built = artifacts();
  const review = completedReview(built.template, { packetSha256: built.manifest.packetSha256 });
  const result = evaluateBlindReview({ packet: built.packet, manifest: built.manifest, review });
  assert.equal(result.verdict, "pass");
  assert.equal(result.review.decisionCounts.pass, 10);
  assert.equal(result.checks.find((item) => item.name.includes("no average threshold"))?.status, "pass");
});

test("blind-review acceptance rejects tampered packets and unresolved critical findings", () => {
  const built = artifacts();
  const criticalReview = completedReview(built.template, { critical: true, packetSha256: built.manifest.packetSha256 });
  const critical = evaluateBlindReview({ packet: built.packet, manifest: built.manifest, review: criticalReview });
  assert.equal(critical.verdict, "fail");
  assert.equal(critical.checks.find((item) => item.name === "no unresolved critical issue remains")?.status, "fail");

  const validReview = completedReview(built.template, { packetSha256: built.manifest.packetSha256 });
  const tampered = evaluateBlindReview({ packet: `${built.packet}tampered`, manifest: built.manifest, review: validReview });
  assert.equal(tampered.verdict, "fail");
  assert.equal(tampered.checks.find((item) => item.name === "review packet matches audit manifest")?.status, "fail");
});

test("blind-review parser leaves the unfilled template incomplete", () => {
  const built = artifacts();
  const parsed = parseBlindReviewRecord(built.template);
  assert.equal(parsed.rows.length, 10);
  assert.equal(parsed.rows.every((row) => row.decision === undefined), true);
});
