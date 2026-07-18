import type { FinancialState } from "../../types";
import { initializeFinancialLedger } from "./initializeLedger";
import { migrateLegacyFinancialState } from "./migrateLegacyFinancialState";
import type { OpeningFinancialFacts } from "./openingFinancialFacts";
import type { AssetAccount, BusinessHolding, CashAccount, DebtAccount, ExpenseCommitment, FinancialLedger, IncomeSource } from "./types";

export type OpeningFinancialFactKind = "cash" | "asset" | "debt" | "income_source" | "expense_commitment" | "business_holding";

export interface AcceptedOpeningFinancialEvent {
  id: string;
  kind: OpeningFinancialFactKind;
  payload: CashAccount | AssetAccount | DebtAccount | IncomeSource | ExpenseCommitment | BusinessHolding;
  acceptedByReasonCodes: ["OPENING_SCHEMA", "OPENING_EVIDENCE", "OPENING_INVARIANTS"];
}

function accepted<T extends AcceptedOpeningFinancialEvent["payload"]>(kind: OpeningFinancialFactKind, payload: T): AcceptedOpeningFinancialEvent {
  if (!payload.id || !Array.isArray(payload.evidence) || payload.evidence.length === 0) {
    throw new Error(`Opening financial proposal ${kind} 缺少稳定 id 或 evidence`);
  }
  return {
    id: `accepted_opening_${kind}_${payload.id}`,
    kind,
    payload: structuredClone(payload),
    acceptedByReasonCodes: ["OPENING_SCHEMA", "OPENING_EVIDENCE", "OPENING_INVARIANTS"]
  };
}

export function initializeOpeningFinancialLedger(input: {
  id: string;
  proposedState: FinancialState;
  linkedCareerStateId: string;
  openingFacts: OpeningFinancialFacts;
}): { ledger: FinancialLedger; acceptedEvents: AcceptedOpeningFinancialEvent[] } {
  // During migration the legacy adapter is only a proposal builder. Its ledger
  // is never installed as authority; every object is accepted and reinitialized.
  const candidate = migrateLegacyFinancialState({
    id: `${input.id}_candidate`, legacyState: input.proposedState,
    linkedCareerStateId: input.linkedCareerStateId, openingFacts: input.openingFacts
  });
  const acceptedEvents = [
    ...candidate.cashAccounts.map((item) => accepted("cash", item)),
    ...candidate.assetAccounts.map((item) => accepted("asset", item)),
    ...candidate.debtAccounts.map((item) => accepted("debt", item)),
    ...candidate.incomeSources.map((item) => accepted("income_source", item)),
    ...candidate.expenseCommitments.map((item) => accepted("expense_commitment", item)),
    ...candidate.businessHoldings.map((item) => accepted("business_holding", item))
  ];
  const ids = new Set<string>();
  for (const event of acceptedEvents) {
    if (ids.has(event.payload.id)) throw new Error(`Opening financial proposal id 重复：${event.payload.id}`);
    ids.add(event.payload.id);
  }
  const byKind = <T extends AcceptedOpeningFinancialEvent["payload"]>(kind: OpeningFinancialFactKind) => (
    acceptedEvents.filter((event) => event.kind === kind).map((event) => structuredClone(event.payload) as T)
  );
  const ledger = initializeFinancialLedger({
    id: input.id,
    asOfAgeInMonths: input.proposedState.asOfAgeInMonths,
    openingPosition: {
      cashAccounts: byKind<CashAccount>("cash"), assetAccounts: byKind<AssetAccount>("asset"),
      debtAccounts: byKind<DebtAccount>("debt"), incomeSources: byKind<IncomeSource>("income_source"),
      expenseCommitments: byKind<ExpenseCommitment>("expense_commitment"),
      businessHoldings: byKind<BusinessHolding>("business_holding"),
      unresolvedIssues: structuredClone(candidate.unresolvedIssues)
    }
  });
  ledger.openingAcceptedEventIds = acceptedEvents.map((event) => event.id);
  return { ledger, acceptedEvents };
}
