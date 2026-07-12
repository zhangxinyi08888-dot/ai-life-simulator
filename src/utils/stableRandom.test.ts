import assert from "node:assert/strict";
import { stableHash, stableInteger, stableRandom } from "./stableRandom";

assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
assert.equal(stableRandom({ seed: "same" }), stableRandom({ seed: "same" }));
assert.notEqual(stableRandom({ seed: "a" }), stableRandom({ seed: "b" }));
assert.ok(stableInteger(3, 6, "range") >= 3);
assert.ok(stableInteger(3, 6, "range") <= 6);
