import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_SCORE_COLUMNS = ["前情连贯性", "现实/状态一致性", "选择质量", "文风自然性"];
const REQUIRED_SIGNOFFS = [
  "10 个节点均已逐项填写。",
  "没有未处置的重大问题",
  "若有需复核项，已写明是否接受、修复后复测，或作为已知风险保留。"
];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownTableCells(line) {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function isMarkdownTableDivider(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function readBulletValue(markdown, label) {
  const match = String(markdown).match(new RegExp(`^\\s*-\\s*${escapedPattern(label)}\\s*[:：]\\s*(.+?)\\s*$`, "mu"));
  return match?.[1].trim() || undefined;
}

function readPacketDigest(markdown) {
  const match = String(markdown).match(/对应审阅包 SHA-256：[`]?([a-f0-9]{64})[`]?/iu);
  return match?.[1]?.toLowerCase();
}

function readDecision(value) {
  const text = String(value ?? "").trim();
  const candidates = [
    ["通过", "pass"],
    ["需复核", "needs_review"],
    ["重大问题", "critical"]
  ].filter(([label]) => text.includes(label));
  return candidates.length === 1 ? candidates[0][1] : undefined;
}

function readFinalDecision(markdown) {
  const line = String(markdown).split(/\r?\n/u).find((item) => /^最终结论\s*[:：]/u.test(item.trim()));
  if (!line) return undefined;
  const value = line.replace(/^最终结论\s*[:：]\s*/u, "").trim();
  if (!value || value.includes("□") || value.includes("☐")) {
    const selected = [
      ["通过", "pass"],
      ["暂不通过", "fail"],
      ["需复测", "retest"]
    ].filter(([label]) => new RegExp(`(?:☑|✅|✔|\\[x\\]|\\(x\\))\\s*${escapedPattern(label)}`, "iu").test(value));
    return selected.length === 1 ? selected[0][1] : undefined;
  }
  const candidates = [
    ["通过", "pass"],
    ["暂不通过", "fail"],
    ["需复测", "retest"]
  ].filter(([label]) => value.startsWith(label));
  return candidates.length === 1 ? candidates[0][1] : undefined;
}

function checkedSignoffs(markdown) {
  return REQUIRED_SIGNOFFS.map((label) => ({
    label,
    checked: new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*${escapedPattern(label)}`, "mu").test(markdown)
  }));
}

function score(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : undefined;
}

function columnIndex(headers, prefix) {
  return headers.findIndex((header) => header.startsWith(prefix));
}

/** Parse the human-edited Markdown record without deriving a quality score. */
export function parseBlindReviewRecord(markdown) {
  const lines = String(markdown).split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) => {
    const cells = markdownTableCells(line);
    return cells?.[0] === "节点" && cells.includes("结论");
  });
  let headers = [];
  const rows = [];
  if (headerIndex >= 0) {
    headers = markdownTableCells(lines[headerIndex]) ?? [];
    for (const line of lines.slice(headerIndex + 1)) {
      const cells = markdownTableCells(line);
      if (!cells) break;
      if (isMarkdownTableDivider(cells)) continue;
      const id = cells[0];
      if (!/^N\d{2}$/u.test(id)) continue;
      const scores = Object.fromEntries(REQUIRED_SCORE_COLUMNS.map((name) => {
        const index = columnIndex(headers, name);
        return [name, index >= 0 ? score(cells[index]) : undefined];
      }));
      const decisionIndex = columnIndex(headers, "结论");
      const evidenceIndex = columnIndex(headers, "证据或说明");
      const dispositionIndex = columnIndex(headers, "处置/复测依据");
      rows.push({
        blindId: id,
        scores,
        decision: decisionIndex >= 0 ? readDecision(cells[decisionIndex]) : undefined,
        evidence: evidenceIndex >= 0 ? cells[evidenceIndex] : "",
        disposition: dispositionIndex >= 0 ? cells[dispositionIndex] : ""
      });
    }
  }
  return {
    packetSha256: readPacketDigest(markdown),
    reviewer: readBulletValue(markdown, "审阅人"),
    reviewedOn: readBulletValue(markdown, "审阅日期"),
    headers,
    rows,
    signoffs: checkedSignoffs(markdown),
    finalDecision: readFinalDecision(markdown)
  };
}

function check(name, passes, detail) {
  return { name, status: passes ? "pass" : "fail", detail };
}

/**
 * Validate the integrity and completeness of a manual blind review. This is
 * intentionally not a numeric quality gate: every node must be reviewed and
 * any unresolved critical issue stops acceptance.
 */
export function evaluateBlindReview({ packet, manifest, review }) {
  const parsed = parseBlindReviewRecord(review);
  const manifestSamples = Array.isArray(manifest?.samples) ? manifest.samples : [];
  const expectedIds = manifestSamples.map((sample) => sample.blindId);
  const rowsById = new Map(parsed.rows.map((row) => [row.blindId, row]));
  const receivedIds = parsed.rows.map((row) => row.blindId);
  const duplicateIds = receivedIds.filter((id, index) => receivedIds.indexOf(id) !== index);
  const unexpectedIds = receivedIds.filter((id) => !expectedIds.includes(id));
  const missingIds = expectedIds.filter((id) => !rowsById.has(id));
  const reviewRows = expectedIds.map((id) => rowsById.get(id)).filter(Boolean);
  const missingScores = reviewRows.flatMap((row) => REQUIRED_SCORE_COLUMNS
    .filter((name) => row.scores[name] === undefined)
    .map((name) => `${row.blindId}:${name}`));
  const missingDecisions = reviewRows.filter((row) => !row.decision).map((row) => row.blindId);
  const nonPassWithoutEvidence = reviewRows
    .filter((row) => row.decision !== "pass" && !row.evidence.trim())
    .map((row) => row.blindId);
  const reviewWithoutDisposition = reviewRows
    .filter((row) => row.decision === "needs_review" && !row.disposition.trim())
    .map((row) => row.blindId);
  const criticalIds = reviewRows.filter((row) => row.decision === "critical").map((row) => row.blindId);
  const packetSha256 = digest(packet);
  const checks = [
    check("audit manifest contains exactly 10 blind nodes", manifest?.sampleCount === 10 && expectedIds.length === 10 && new Set(expectedIds).size === 10, `sampleCount=${manifest?.sampleCount ?? "missing"}`),
    check("review packet matches audit manifest", manifest?.packetSha256 === packetSha256, `packetSha256=${packetSha256}`),
    check("review record names the reviewed packet", parsed.packetSha256 === manifest?.packetSha256, `reviewPacketSha256=${parsed.packetSha256 ?? "missing"}`),
    check("reviewer and date are recorded", Boolean(parsed.reviewer && parsed.reviewedOn), `reviewer=${parsed.reviewer ? "recorded" : "missing"}, date=${parsed.reviewedOn ? "recorded" : "missing"}`),
    check("all 10 expected nodes are reviewed exactly once", missingIds.length === 0 && unexpectedIds.length === 0 && duplicateIds.length === 0 && receivedIds.length === 10, `missing=${missingIds.join(",") || "none"}; unexpected=${unexpectedIds.join(",") || "none"}; duplicates=${duplicateIds.join(",") || "none"}`),
    check("every node has four valid 1-5 ratings (no average threshold)", missingScores.length === 0, `missing=${missingScores.join(",") || "none"}`),
    check("every node has one final disposition", missingDecisions.length === 0, `missing=${missingDecisions.join(",") || "none"}`),
    check("non-pass dispositions include evidence", nonPassWithoutEvidence.length === 0, `missing=${nonPassWithoutEvidence.join(",") || "none"}`),
    check("each review item includes a treatment or retest basis", reviewWithoutDisposition.length === 0, `missing=${reviewWithoutDisposition.join(",") || "none"}`),
    check("no unresolved critical issue remains", criticalIds.length === 0, `critical=${criticalIds.join(",") || "none"}`),
    check("human signoff checklist is complete", parsed.signoffs.every((item) => item.checked), `missing=${parsed.signoffs.filter((item) => !item.checked).map((item) => item.label).join(";") || "none"}`),
    check("human final conclusion is pass", parsed.finalDecision === "pass", `final=${parsed.finalDecision ?? "missing"}`)
  ];
  return {
    verdict: checks.every((item) => item.status === "pass") ? "pass" : "fail",
    checks,
    review: {
      reviewer: parsed.reviewer,
      reviewedOn: parsed.reviewedOn,
      finalDecision: parsed.finalDecision,
      decisionCounts: {
        pass: reviewRows.filter((row) => row.decision === "pass").length,
        needsReview: reviewRows.filter((row) => row.decision === "needs_review").length,
        critical: criticalIds.length
      }
    }
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootArgument = argumentValue("--root");
  const reviewArgument = argumentValue("--review");
  if (!rootArgument || !reviewArgument) {
    throw new Error("usage: node scripts/evaluate-cache-prefix-blind-review.mjs --root <run-root> --review <completed-review.md>");
  }
  const root = path.resolve(rootArgument);
  const reviewPath = path.resolve(reviewArgument);
  const blindReviewDir = path.join(root, "blind-review");
  const [packet, manifestText, review] = await Promise.all([
    readFile(path.join(blindReviewDir, "reviewer-packet.md"), "utf8"),
    readFile(path.join(blindReviewDir, "audit-manifest.json"), "utf8"),
    readFile(reviewPath, "utf8")
  ]);
  const result = evaluateBlindReview({ packet, manifest: JSON.parse(manifestText), review });
  const outputPath = path.join(blindReviewDir, "acceptance.json");
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${result.verdict.toUpperCase()} blind review\n${JSON.stringify({ outputPath, review: result.review }, null, 2)}\n`);
  if (result.verdict !== "pass") process.exitCode = 1;
}
