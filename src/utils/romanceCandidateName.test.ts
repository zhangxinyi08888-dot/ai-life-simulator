import assert from "node:assert/strict";
import test from "node:test";
import { isValidRomanceDisplayName } from "./romanceCandidateName";

test("romance display names accept stable identities and reject role descriptions", () => {
  for (const name of ["陈远", "赵明远", "老刘", "小苏", "Alex"]) {
    assert.equal(isValidRomanceDisplayName(name), true, `${name} should remain a stable display identity`);
  }

  for (const description of [
    "做校园社交APP的男生",
    "负责产品落地的女生",
    "社区食堂负责人",
    "创业公司的产品经理",
    "陈老师",
    "一个程序员"
  ]) {
    assert.equal(isValidRomanceDisplayName(description), false, `${description} is a role description rather than a name`);
  }
});
