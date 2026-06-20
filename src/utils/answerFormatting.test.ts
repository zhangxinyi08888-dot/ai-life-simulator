import assert from "node:assert/strict";
import { formatAnswerTurns } from "./answerFormatting";

const arrayText = formatAnswerTurns([
  { question: "你真正害怕什么？", answer: "我怕稳定变成一眼望到头" },
  { question: "现实限制是什么？", answer: null }
]);

assert.match(arrayText, /追问问题：你真正害怕什么？/);
assert.match(arrayText, /真实立场：我怕稳定变成一眼望到头/);
assert.match(arrayText, /真实立场：未解答/);

const objectText = formatAnswerTurns({
  q1: "我想换一条路",
  q2: { question: "家里最大的阻力？", answer: "父母希望我别冒险" }
});

assert.match(objectText, /追问问题：q1/);
assert.match(objectText, /真实立场：我想换一条路/);
assert.match(objectText, /追问问题：家里最大的阻力？/);
assert.match(objectText, /真实立场：父母希望我别冒险/);

const stringText = formatAnswerTurns("我只是想重新认真选一次");

assert.match(stringText, /追问问题：用户补充/);
assert.match(stringText, /真实立场：我只是想重新认真选一次/);
