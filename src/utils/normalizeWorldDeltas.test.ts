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

test("drops direct and payload-wrapped boolean career transitions instead of mutating them during source-outcome backfill", () => {
  // This is the malformed shape returned during the education 2/2/1 route
  // after selecting `maintain_dual_track`.  A truthy primitive previously
  // reached `transition.sourceOutcomeId = ...` and surfaced as a visible
  // pause rather than being treated as invalid untrusted model transport.
  const result = normalizeWorldDeltas({
    acceptedOutcomeIds: ["maintain_current_rhythm"],
    worldDeltas: [
      {
        type: "career_state",
        summary: "继续维持金融主修与计算机项目的双轨节奏。",
        employmentTransition: true
      },
      {
        deltaType: "career_state",
        summary: "另一条模型输出将异常值放在 payload 中。",
        payload: { employmentTransition: true }
      }
    ]
  });

  assert.deepEqual(result.worldDeltas, [
    {
      type: "career_state",
      summary: "继续维持金融主修与计算机项目的双轨节奏。"
    },
    {
      type: "career_state",
      summary: "另一条模型输出将异常值放在 payload 中。"
    }
  ]);
  assert.equal(result.audit.filter((item) => item.reasonCode === "EMPLOYMENT_TRANSITION_DROPPED").length, 2);
});

test("flattens a pending employer offer withdrawal and binds it to the selected outcome", () => {
  const result = normalizeWorldDeltas({
    acceptedOutcomeIds: ["decline_ai_offer"],
    worldDeltas: [{
      deltaType: "career_state",
      summary: "放弃待入职 offer",
      payload: {
        pendingEmployerOfferResolution: {
          action: "withdrawn",
          pendingOfferSourceOutcomeId: "accept_ai_offer",
          evidence: "你放弃了已经接受的 offer。",
          confidence: 0.9
        }
      }
    }]
  });
  const resolution = result.worldDeltas[0]?.type === "career_state"
    ? result.worldDeltas[0].pendingEmployerOfferResolution
    : undefined;
  assert.equal(resolution?.sourceOutcomeId, "decline_ai_offer");
  assert.equal(result.audit.some((item) => item.reasonCode === "PENDING_EMPLOYER_OFFER_RESOLUTION_FLATTENED"), true);
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
