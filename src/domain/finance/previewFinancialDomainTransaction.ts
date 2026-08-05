import {
  commitFinancialDomainTransaction,
  type CommittedFinancialDomainTransaction,
  type FinancialDomainTransactionInput
} from "./commitFinancialDomainTransaction";

/**
 * Runs the exact production domain transaction against a deep-cloned write set.
 * The returned value is a candidate only: callers must still invoke the
 * authoritative commit after the node acceptance gate passes.
 */
export function previewFinancialDomainTransaction(
  input: FinancialDomainTransactionInput
): CommittedFinancialDomainTransaction {
  return commitFinancialDomainTransaction(structuredClone(input));
}
