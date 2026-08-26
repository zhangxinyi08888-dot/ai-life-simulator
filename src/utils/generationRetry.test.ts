import assert from "node:assert/strict";
import test from "node:test";
import {
  isFinancialGateGenerationError,
  NEXT_NODE_FINANCIAL_GATE_ATTEMPTS,
  runWithInvalidAiResponseRetry
} from "./generationRetry";

test("malformed structured output is retried once before becoming visible", async () => {
  let attempts = 0;
  const result = await runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("invalid JSON"), { code: "AI_RESPONSE_INVALID" });
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
});

test("a transient network failure is retried once before becoming visible", async () => {
  let attempts = 0;
  const result = await runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("network"), { code: "AI_NETWORK_FAILED" });
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
});

test("an incomplete simulation node is retried before becoming visible", async () => {
  let attempts = 0;
  const result = await runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("SIMULATION_NODE_INCOMPLETE:eventOutcomeCoverage");
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
});

test("a persistent network failure is surfaced after the bounded retry", async () => {
  let attempts = 0;
  await assert.rejects(runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error(`network ${attempts}`), { code: "AI_NETWORK_FAILED" });
  }), /network 2/);
  assert.equal(attempts, 2);
});

test("a persistent incomplete simulation node is surfaced after the bounded retry", async () => {
  let attempts = 0;
  await assert.rejects(runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    throw new Error("SIMULATION_NODE_INCOMPLETE:eventOutcomeCoverage");
  }), /SIMULATION_NODE_INCOMPLETE:eventOutcomeCoverage/);
  assert.equal(attempts, 2);
});

test("a second malformed response is surfaced", async () => {
  let attempts = 0;
  await assert.rejects(runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error(`invalid ${attempts}`), { code: "AI_RESPONSE_INVALID" });
  }), /invalid 2/);
  assert.equal(attempts, 2);
});

test("a rejected financial preview gets one additional internal recovery attempt before any visible pause", async () => {
  let attempts = 0;
  const gateEvents: string[] = [];
  const result = await runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      gateEvents.push(`rejected-${attempts}`);
      const error = Object.assign(new Error("financial gate rejected candidate"), {
        code: "AI_RESPONSE_INVALID",
        retryScope: "financial_gate"
      });
      throw error;
    }
    return "committed-after-internal-recovery";
  }, {
    maxAttempts: 2,
    maxFinancialGateAttempts: 3,
    isFinancialGateError: isFinancialGateGenerationError
  });

  assert.equal(result, "committed-after-internal-recovery");
  assert.equal(attempts, 3, "the outer caller receives a successful node and never reaches its visible-pause catch");
  assert.deepEqual(gateEvents, ["rejected-1", "rejected-2"], "rejected preview audit events are retained across internal recovery");
});

test("a caller with one ordinary attempt still reserves one bounded financial-gate recovery", async () => {
  const attempts: number[] = [];
  const retryReasons: string[][] = [];
  let lastBlockingReasons: string[] | undefined;

  const result = await runWithInvalidAiResponseRetry(async (attempt) => {
    attempts.push(attempt);
    retryReasons.push(lastBlockingReasons || []);
    if (attempt === 1) {
      lastBlockingReasons = ["UNSATISFIED_CAREER_INCOME_TRANSITION"];
      throw Object.assign(new Error("financial gate rejected candidate"), {
        code: "AI_RESPONSE_INVALID",
        retryScope: "financial_gate"
      });
    }
    return "committed-after-final-financial-recovery";
  }, {
    maxAttempts: 1,
    maxFinancialGateAttempts: 2,
    isFinancialGateError: isFinancialGateGenerationError
  });

  assert.equal(result, "committed-after-final-financial-recovery");
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(retryReasons, [[], ["UNSATISFIED_CAREER_INCOME_TRANSITION"]]);
});

test("a recovered financial-gate retry never reaches the caller-visible pause boundary", async () => {
  let attempts = 0;
  const visiblePauseErrors: unknown[] = [];
  const generateNodeAtCallerBoundary = async () => {
    try {
      return await runWithInvalidAiResponseRetry(async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("financial gate rejected candidate"), {
            code: "AI_RESPONSE_INVALID",
            retryScope: "financial_gate"
          });
        }
        return "committed-after-internal-recovery";
      }, {
        maxAttempts: 2,
        maxFinancialGateAttempts: 3,
        isFinancialGateError: isFinancialGateGenerationError
      });
    } catch (error) {
      // Mirrors App.tsx: only errors escaping internal recovery become visible.
      visiblePauseErrors.push(error);
      throw error;
    }
  };

  assert.equal(await generateNodeAtCallerBoundary(), "committed-after-internal-recovery");
  assert.equal(attempts, 3);
  assert.equal(visiblePauseErrors.length, 0);
});

test("the next-node budget accepts a fourth full candidate before any visible pause", async () => {
  let fullCandidates = 0;
  const visiblePauseErrors: unknown[] = [];
  const result = await runWithInvalidAiResponseRetry(async (outerAttempt) => {
    const candidatesThisAttempt = outerAttempt === 1 ? 2 : 1;
    for (let index = 0; index < candidatesThisAttempt; index += 1) {
      fullCandidates += 1;
      if (fullCandidates === 4) return "committed-fourth-candidate";
    }
    const error = Object.assign(new Error("financial gate rejected candidates"), {
      code: "AI_RESPONSE_INVALID",
      retryScope: "financial_gate"
    });
    if (outerAttempt === NEXT_NODE_FINANCIAL_GATE_ATTEMPTS) visiblePauseErrors.push(error);
    throw error;
  }, {
    maxAttempts: 1,
    maxFinancialGateAttempts: NEXT_NODE_FINANCIAL_GATE_ATTEMPTS,
    isFinancialGateError: isFinancialGateGenerationError
  });

  assert.equal(result, "committed-fourth-candidate");
  assert.equal(fullCandidates, 4);
  assert.equal(visiblePauseErrors.length, 0);
});

test("financial gate recovery remains bounded when every preview is rejected", async () => {
  let attempts = 0;
  await assert.rejects(runWithInvalidAiResponseRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error(`financial gate ${attempts}`), {
      code: "AI_RESPONSE_INVALID",
      retryScope: "financial_gate"
    });
  }, {
    maxAttempts: 2,
    maxFinancialGateAttempts: 3,
    isFinancialGateError: isFinancialGateGenerationError
  }), /financial gate 3/);
  assert.equal(attempts, 3);
});
