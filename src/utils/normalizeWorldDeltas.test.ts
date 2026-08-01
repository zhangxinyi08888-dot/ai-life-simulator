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

test("flattens and validates an accepted structured residence payload on a location delta", () => {
  const result = normalizeWorldDeltas({
    worldDeltas: [{
      deltaType: "location_change",
      summary: "居住安排已完成更新。",
      payload: {
        residence: {
          livingArrangement: "renting",
          financialScope: "personal",
          liability: "protagonist",
          evidence: "已签订租约并搬入住所。"
        }
      }
    }]
  });
  assert.deepEqual(result.worldDeltas, [{
    type: "location_change",
    summary: "居住安排已完成更新。",
    residence: {
      livingArrangement: "renting",
      financialScope: "personal",
      liability: "protagonist",
      evidence: "已签订租约并搬入住所。"
    }
  }]);
  assert.equal(result.audit.some((item) => item.reasonCode === "RESIDENCE_CHANGE_FLATTENED"), true);
});

test("drops an invalid structured residence payload without discarding its ordinary location delta", () => {
  const result = normalizeWorldDeltas({
    worldDeltas: [{
      type: "location_change",
      summary: "公司场地搬迁。",
      residence: {
        livingArrangement: "workshop",
        financialScope: "personal",
        liability: "protagonist"
      }
    }]
  });
  assert.deepEqual(result.worldDeltas, [{ type: "location_change", summary: "公司场地搬迁。" }]);
  assert.equal(result.audit.some((item) => item.reasonCode === "RESIDENCE_CHANGE_DROPPED"), true);
});
