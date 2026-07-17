import { FinancialLedgerInvariantError } from "./ledgerMath";
import type { AcceptedFinancialEvent } from "./types";

export function validateAcceptedFinancialEvents(input: {
  events: AcceptedFinancialEvent[];
  periodStartAgeInMonths: number;
  periodEndAgeInMonths: number;
}): AcceptedFinancialEvent[] {
  const ids = new Set<string>();
  const events = input.events.map((event) => structuredClone(event));
  for (const event of events) {
    if (!event.id || ids.has(event.id)) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `AcceptedFinancialEvent id 必须存在且唯一: ${event.id || "<empty>"}`);
    }
    ids.add(event.id);
    if (!Number.isInteger(event.effectiveAtAgeInMonths)
      || event.effectiveAtAgeInMonths < input.periodStartAgeInMonths
      || event.effectiveAtAgeInMonths > input.periodEndAgeInMonths) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `事件 ${event.id} 生效时间不在本阶段内`);
    }
    if (!event.payload || typeof event.payload !== "object") {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `事件 ${event.id} 缺少有方向 payload`);
    }
    if (!event.acceptedByReasonCodes.length || !event.evidence.length) {
      throw new FinancialLedgerInvariantError("INVALID_LEDGER", `事件 ${event.id} 缺少接受原因或证据`);
    }
    for (const evidence of event.evidence) {
      if (!evidence.reasonCode || !Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1) {
        throw new FinancialLedgerInvariantError("INVALID_LEDGER", `事件 ${event.id} 证据无效`);
      }
    }
  }
  return events.sort((left, right) => left.effectiveAtAgeInMonths - right.effectiveAtAgeInMonths);
}
