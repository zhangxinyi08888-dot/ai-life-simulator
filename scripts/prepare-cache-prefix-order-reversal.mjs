import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function splitNodeBlocks(markdown) {
  const match = markdown.match(/^([\s\S]*?)(?=^## N01\s*$)([\s\S]*)$/mu);
  if (!match) throw new Error("reviewer packet does not contain N01");
  const blocks = match[2].split(/(?=^## N\d{2}\s*$)/mu).filter(Boolean);
  if (blocks.length !== 10) throw new Error(`expected 10 node blocks, got ${blocks.length}`);
  return { preamble: match[1], blocks };
}

function reverseVersionOrder(block) {
  const match = block.match(/^([\s\S]*?)(^### 版本 A\s*$[\s\S]*?)(^### 版本 B\s*$[\s\S]*?)(^#### 审阅记录\s*$[\s\S]*)$/mu);
  if (!match) throw new Error(`cannot locate A/B sections in ${block.match(/^## (N\d{2})/mu)?.[1] ?? "unknown node"}`);
  return `${match[1]}${match[3]}${match[2]}${match[4]}`;
}

export function buildOrderReversalPacket(markdown) {
  const { preamble, blocks } = splitNodeBlocks(markdown);
  const note = "> 顺序复核：奇数节点显示 B 后显示 A；偶数节点仍显示 A 后显示 B。标签和内容不变，仍不包含真实来源映射。\n\n";
  const insertionPoint = preamble.indexOf("## 审阅任务");
  const revisedPreamble = insertionPoint >= 0
    ? `${preamble.slice(0, insertionPoint)}${note}${preamble.slice(insertionPoint)}`
    : `${preamble}${note}`;
  return `${revisedPreamble}${blocks.map((block, index) => index % 2 === 0 ? reverseVersionOrder(block) : block).join("")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const inputIndex = process.argv.indexOf("--input");
  const outputIndex = process.argv.indexOf("--output");
  if (inputIndex < 0 || outputIndex < 0) {
    throw new Error("usage: node scripts/prepare-cache-prefix-order-reversal.mjs --input <reviewer-packet.md> --output <order-reversal-packet.md>");
  }
  const inputPath = path.resolve(process.argv[inputIndex + 1]);
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  const output = buildOrderReversalPacket(await readFile(inputPath, "utf8"));
  await writeFile(outputPath, output, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, sha256: digest(output) })}\n`);
}
