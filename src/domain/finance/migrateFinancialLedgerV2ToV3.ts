import { assertFinancialLedgerInvariants, roundWan } from "./ledgerMath";
import { normalizeDebtAccountV3 } from "./initializeLedger";
import type {
  DebtAccount,
  DebtAccountV2,
  FinancialLedger,
  FinancialLedgerInput,
  FinancialLedgerV2
} from "./types";

function migrateDebt(account: DebtAccountV2 | DebtAccount): DebtAccount {
  const normalized = normalizeDebtAccountV3({
    ...structuredClone(account),
    origin: "origin" in account && account.origin
      ? account.origin
      : account.type === "liquidity_shortfall"
        ? "system_auto_shortfall"
        : "legacy_migration",
    accruedUnpaidInterestWan: "accruedUnpaidInterestWan" in account
      ? account.accruedUnpaidInterestWan
      : 0
  });
  if (normalized.origin === "system_auto_shortfall") normalized.factStatus = "known";
  return normalized;
}

/**
 * Upgrades a persisted v2 ledger without replaying history. The operation is
 * deterministic and idempotent so a restore boundary may call it safely.
 */
export function migrateFinancialLedgerV2ToV3(input: FinancialLedgerV2): FinancialLedger;
export function migrateFinancialLedgerV2ToV3(input: FinancialLedger): FinancialLedger;
export function migrateFinancialLedgerV2ToV3(input: FinancialLedgerInput): FinancialLedger;
export function migrateFinancialLedgerV2ToV3(input: FinancialLedgerInput | FinancialLedger): FinancialLedger {
  const isPersistedV2 = input.version === 2;
  const ledger = structuredClone(input) as Omit<FinancialLedger, "version" | "debtAccounts"> & {
    version: 3;
    debtAccounts: DebtAccount[];
  };
  ledger.version = 3;
  ledger.debtAccounts = input.debtAccounts.map(migrateDebt);
  const missingEffectiveDateIssues = [] as FinancialLedger["unresolvedIssues"];
  ledger.incomeSources = ledger.incomeSources.map((source) => {
    if (Number.isInteger(source.activeFromAgeInMonths) && source.activeFromAgeInMonths >= 0) return source;
    missingEffectiveDateIssues.push({
      id: `migrated_missing_active_from_income_${source.id}`,
      code: "PENDING_FACT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      relatedIncomeSourceIds: [source.id],
      summary: `收入来源 ${source.displayName} 缺少生效时间；恢复边界前不做追溯计提`,
      createdAtAgeInMonths: ledger.asOfAgeInMonths
    });
    return { ...source, activeFromAgeInMonths: ledger.asOfAgeInMonths };
  });
  ledger.expenseCommitments = ledger.expenseCommitments.map((commitment) => {
    if (Number.isInteger(commitment.activeFromAgeInMonths) && commitment.activeFromAgeInMonths >= 0) return commitment;
    missingEffectiveDateIssues.push({
      id: `migrated_missing_active_from_expense_${commitment.id}`,
      code: "PENDING_FACT",
      severity: "blocking",
      status: "open",
      relatedProposalIds: [],
      relatedAccountIds: [commitment.id],
      summary: `支出义务 ${commitment.displayName} 缺少生效时间；从恢复边界开始保守计提`,
      createdAtAgeInMonths: ledger.asOfAgeInMonths
    });
    return { ...commitment, activeFromAgeInMonths: ledger.asOfAgeInMonths };
  });
  const existingIssueIds = new Set(ledger.unresolvedIssues.map((issue) => issue.id));
  ledger.unresolvedIssues.push(...missingEffectiveDateIssues.filter((issue) => !existingIssueIds.has(issue.id)));
  ledger.assetAccounts = ledger.assetAccounts.map((account) => {
    const rawType = String(account.type);
    if (rawType !== "real_estate" && rawType !== "house" && rawType !== "apartment") return account;
    return {
      ...account,
      type: "property",
      factStatus: "needs_review",
      evidence: [
        ...account.evidence,
        { source: "legacy_migration", reasonCode: "LEGACY_ASSET_TYPE_NORMALIZED", confidence: 0.5 }
      ]
    };
  });

  // liquidity_shortfall is the canonical cash-floor facility, not an explicit
  // bridge-loan type. Consolidate every active instance, including v3 records
  // produced by older model proposals that incorrectly marked one as explicit.
  // Actual accepted borrowing remains separate under its concrete debt type.
  const activeShortfalls = ledger.debtAccounts
    .filter((account) => account.type === "liquidity_shortfall"
      && account.status === "active")
    .sort((left, right) => left.openedAtAgeInMonths - right.openedAtAgeInMonths);

  if (activeShortfalls.length > 0) {
    const keeper = activeShortfalls[0];
    keeper.origin = "system_auto_shortfall";
    keeper.repaymentPolicy = { mode: "event_driven" };
    keeper.principalWan = roundWan(activeShortfalls.reduce((sum, account) => sum + account.principalWan, 0));
    keeper.accruedUnpaidInterestWan = roundWan(activeShortfalls.reduce(
      (sum, account) => sum + (account.accruedUnpaidInterestWan ?? 0),
      0
    ));
    keeper.lastPrincipalIncreaseAtAgeInMonths = Math.max(
      ...activeShortfalls.map((account) => account.lastPrincipalIncreaseAtAgeInMonths ?? account.openedAtAgeInMonths)
    );

    for (const redundant of activeShortfalls.slice(1)) {
      redundant.principalWan = 0;
      redundant.accruedUnpaidInterestWan = 0;
      redundant.status = "restructured";
      redundant.closedAtAgeInMonths = ledger.asOfAgeInMonths;
      redundant.repaymentPolicy = { mode: "event_driven" };
    }
  }

  assertFinancialLedgerInvariants(ledger);
  return ledger;
}
