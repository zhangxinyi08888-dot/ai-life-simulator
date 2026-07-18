import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorldDeltas } from "./normalizeWorldDeltas";

test("flattens career transitions and maps deterministic employment aliases", () => {
  const result = normalizeWorldDeltas({
    acceptedOutcomeIds: ["choice_fallback_1"],
    worldDeltas: [{
      deltaType: "career_state",
      summary: "晋升",
      payload: {
        employmentTransition: {
          subject: "protagonist",
          toStatus: "promoted_to_director",
          effectiveAtAgeInMonths: 420,
          sourceOutcomeId: null,
          evidence: "你正式晋升为产品总监。",
          confidence: 0.9
        }
      }
    }]
  });
  const transition = (result.worldDeltas[0] as { employmentTransition?: Record<string, unknown> }).employmentTransition;
  assert.equal(result.worldDeltas[0].type, "career_state");
  assert.equal(transition?.toStatus, "employed");
  assert.equal(transition?.occupation, "director");
  assert.equal(transition?.sourceOutcomeId, "choice_fallback_1");
  assert.equal(result.audit.some((item) => item.reasonCode === "EMPLOYMENT_STATUS_MAPPED"), true);
});
