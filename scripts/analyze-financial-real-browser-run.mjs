import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  auditFinancialProductionRecords,
  extractFinancialNarrativeAuditMeta
} from "./lib/financial-production-audit.mjs";
import { execFile } from "node:child_process";
import {
  adultBelowPolicyExpenseViolation,
  classifyTerminalFinancialIssues,
  collectRecoveredGenerationAttempts,
  collectVisibleGenerationPauses,
  compensationConversionMismatches,
  duplicateSingletonExpenseTypes,
  personalCompensationAnnualAmounts,
  personalLedgerBusinessBoundaryViolations
} from "./financial-real-browser-audit-helpers.mjs";
import {
  assessExpenseResponsibilityCorpusCoverage,
  auditExpenseLifecycleDynamics,
  auditExpenseLifecycleCandidateTelemetry,
  auditExpenseResponsibilities
} from "./lib/financial-expense-audit.mjs";

function runGit(args) {
  return new Promise((resolve, reject) => execFile("git", args, { cwd: process.cwd() }, (error, stdout) => (
    error ? reject(error) : resolve(stdout.trim())
  )));
}

const cliArgs = process.argv.slice(2);
const positionalArgs = [];
let requestedOutputRoot;
for (let index = 0; index < cliArgs.length; index += 1) {
  if (cliArgs[index] === "--output-root") {
    requestedOutputRoot = cliArgs[index + 1];
    index += 1;
    continue;
  }
  positionalArgs.push(cliArgs[index]);
}
if (!positionalArgs[0]) {
  throw new Error("usage: analyze-financial-real-browser-run.mjs <source-root> [annotation-path] [--output-root <path>]");
}
if (requestedOutputRoot === "" || requestedOutputRoot === undefined && cliArgs.includes("--output-root")) {
  throw new Error("--output-root requires a path");
}
// `root` is always read-only input. A derived diagnostic may direct its
// reports elsewhere, so inspecting an historic run can never rewrite its
// original audit, report, aggregate, or manifest.
const root = path.resolve(positionalArgs[0]);
const outputRoot = requestedOutputRoot ? path.resolve(process.cwd(), requestedOutputRoot) : root;
await mkdir(outputRoot, { recursive: true });
const requestedAnnotationPath = positionalArgs[1] || process.env.EXPENSE_RESPONSIBILITY_ANNOTATIONS;
const launchUrl = process.env.REAL_BROWSER_LAUNCH_URL || "http://127.0.0.1:4173/";
const annotationPath = requestedAnnotationPath
  ? path.resolve(process.cwd(), requestedAnnotationPath)
  : path.join(root, "expense-responsibility-annotations.json");
const casesDir = path.join(root, "cases");
const files = (await readdir(casesDir)).filter((name) => name.endsWith(".json")).sort();
const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(casesDir, name), "utf8"))));
let sourceRunManifest;
try {
  sourceRunManifest = JSON.parse(await readFile(path.join(root, "run-manifest.json"), "utf8"));
} catch {
  sourceRunManifest = undefined;
}

async function loadExpenseResponsibilityAnnotations(filePath) {
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8"));
    const annotations = Array.isArray(payload) ? payload : payload.annotations;
    if (!Array.isArray(annotations)) {
      return {
        annotations: [],
        status: "invalid",
        sourcePath: filePath,
        corpusId: undefined,
        corpusKind: undefined,
        reviewer: undefined,
        reviewStatus: undefined,
        purpose: undefined,
        sourceRun: undefined,
        error: "annotation payload must be an array or contain annotations[]"
      };
    }
    const invalid = annotations.find((annotation) => !annotation
      || typeof annotation.caseSlug !== "string"
      || !Number.isInteger(annotation.nodeIndex)
      || !["start", "adjust", "end", "review", "ignore"].includes(annotation.expectedAction)
      || !["personal", "shared_household", "business_operating", "third_party"].includes(annotation.expectedScope)
      || (annotation.expectedAction !== "ignore" && typeof annotation.expectedResponsibilityKey !== "string"));
    if (invalid) {
      return {
        annotations: [],
        status: "invalid",
        sourcePath: filePath,
        corpusId: payload?.corpusId,
        corpusKind: payload?.corpusKind,
        reviewer: payload?.reviewer,
        reviewStatus: payload?.reviewStatus,
        purpose: payload?.purpose,
        sourceRun: payload?.sourceRun,
        error: "annotation lacks valid caseSlug/nodeIndex/action/scope/responsibilityKey"
      };
    }
    return {
      annotations,
      status: annotations.length > 0 ? "loaded" : "not_covered",
      sourcePath: filePath,
      corpusId: payload?.corpusId,
      corpusKind: payload?.corpusKind,
      reviewer: payload?.reviewer,
      reviewStatus: payload?.reviewStatus,
      purpose: payload?.purpose,
      sourceRun: payload?.sourceRun,
      error: undefined
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        annotations: [], status: "not_provided", sourcePath: filePath, corpusId: undefined, corpusKind: undefined,
        reviewer: undefined, reviewStatus: undefined, purpose: undefined, sourceRun: undefined, error: undefined
      };
    }
    return {
      annotations: [],
      status: "invalid",
      sourcePath: filePath,
      corpusId: undefined,
      corpusKind: undefined,
      reviewer: undefined,
      reviewStatus: undefined,
      purpose: undefined,
      sourceRun: undefined,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const expenseResponsibilityAnnotationSource = await loadExpenseResponsibilityAnnotations(annotationPath);
const humanReviewedAnnotationCorpus = ["human", "human_adjudicated"].includes(
  expenseResponsibilityAnnotationSource.reviewer
);
const expenseResponsibilityAnnotationLabel = humanReviewedAnnotationCorpus
  ? "人工标注责任"
  : "机器/AI 辅助诊断标注（非人工、非发布门禁）";
const isDerivedDiagnostic = outputRoot !== root;
const expenseAuditRouteRecords = records.map((record) => ({
  caseSlug: record.caseSlug,
  history: record.finalState?.history || []
}));
const expenseResponsibilityAudit = auditExpenseResponsibilities({
  annotations: expenseResponsibilityAnnotationSource.annotations,
  routeRecords: expenseAuditRouteRecords
});
// This compares a persisted detector/reconciler trace with independently
// authored annotations only after the route finishes.  Annotations are never
// passed back to candidate generation or authority.
const expenseLifecycleCandidateTelemetryAudit = auditExpenseLifecycleCandidateTelemetry({
  annotations: expenseResponsibilityAnnotationSource.annotations,
  routeRecords: expenseAuditRouteRecords
});
const expenseLifecycleDynamicAudit = auditExpenseLifecycleDynamics({ routeRecords: expenseAuditRouteRecords });
const expenseResponsibilityCorpusCoverage = assessExpenseResponsibilityCorpusCoverage({
  annotations: expenseResponsibilityAnnotationSource.annotations,
  corpusKind: expenseResponsibilityAnnotationSource.corpusKind
});
const { details: expenseResponsibilityAuditDetails, ...expenseResponsibilityAuditSummary } = expenseResponsibilityAudit;
const {
  details: expenseLifecycleCandidateTelemetryAuditDetails,
  ...expenseLifecycleCandidateTelemetryAuditSummary
} = expenseLifecycleCandidateTelemetryAudit;
const {
  summary: expenseLifecycleDynamicAuditSummary,
  details: expenseLifecycleDynamicAuditDetails
} = expenseLifecycleDynamicAudit;
const expenseLifecycleDynamicDiagnosticsByCase = new Map(
  expenseLifecycleDynamicAuditDetails.routeDiagnostics.map((item) => [item.caseSlug, item])
);
const productionAudit = auditFinancialProductionRecords(records);
const posterEvidence = await Promise.all(records.map(async (record) => {
  const posterPath = record.imagePaths?.posterPath;
  const reportPagePath = record.imagePaths?.pagePath;
  if (!posterPath || !reportPagePath) {
    return {
      caseSlug: record.caseSlug,
      posterPath,
      reportPagePath,
      byteSize: 0,
      nonBlank: false,
      distinctFromReportPage: false
    };
  }
  try {
    const [info, posterBytes, reportPageBytes] = await Promise.all([
      stat(posterPath),
      readFile(posterPath),
      readFile(reportPagePath)
    ]);
    // A 1280x720 JPEG containing the rendered poster is consistently tens of
    // kilobytes. The clipped all-black regression compressed below 10 KiB.
    return {
      caseSlug: record.caseSlug,
      posterPath,
      reportPagePath,
      byteSize: info.size,
      nonBlank: info.size >= 20_000,
      distinctFromReportPage: !posterBytes.equals(reportPageBytes)
    };
  } catch {
    return {
      caseSlug: record.caseSlug,
      posterPath,
      reportPagePath,
      byteSize: 0,
      nonBlank: false,
      distinctFromReportPage: false
    };
  }
}));
productionAudit.posterEvidence = posterEvidence;
productionAudit.summary.blackOrEmptyPosterExportCount = posterEvidence.filter((item) => !item.nonBlank).length;
productionAudit.summary.duplicateFinalImageEvidenceCount = posterEvidence.filter((item) => !item.distinctFromReportPage).length;
const round = (value) => Math.round(Number(value || 0) * 10000) / 10000;
const percent = (part, whole) => whole ? round((part / whole) * 100) : 0;
const close = (a, b, tolerance = 0.02) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance;
const financeText = /(?:月薪|工资|薪资|收入|支出|房租|租金|房贷|贷款|债务|存款|现金|融资|估值|期权|股权|万元|万\/月|每月|年薪|买房|卖房|投资|顾问费|稿费|退休金)/;
const hasCompletedPersonalOptionFact = (text = "") => String(text).split(/(?<=[。！？；])/u).some((sentence) => {
  const optionReference = /(?:你(?:获得|获授|被授予|持有|拥有|行使|行权)[^。；]{0,24}期权|(?:授予|发放)[^。；]{0,12}(?:给)?你[^。；]{0,12}期权|你的[^。；]{0,16}期权)/u.test(sentence);
  if (!optionReference) return false;
  const conditionalOnly = /尚未|还未|未正式|没有设立|口头承诺|未来|如果|若|计划|考虑|优先考虑|意向|争取|需要[^。；]{0,24}(?:达标|满足)[^。；]{0,12}(?:才|后)|达标后[^。；]{0,12}(?:才|方可)|才能兑现|等待[^。；]{0,16}兑现/u.test(sentence);
  const completedGrant = /你(?:已经|已|正式)?(?:获得|获授|被授予|持有|拥有|行使|行权)(?:了)?[^。；]{0,24}期权|(?:正式)?(?:授予|发放)[^。；]{0,12}(?:给)?你/u.test(sentence);
  return !conditionalOnly || completedGrant;
});
const personalEquityText = /(?:你(?:持有|拥有|获得|接受)[^。；]{0,20}(?:股权|股份|持股|干股)|(?:股权|持股)结构[^。；]{0,32}你占\s*\d|你(?:成为|是|作为)[^。；]{0,12}(?:联合创始人|合伙人)|你的(?:创始人股权|干股))/u;
const personalPropertyText = /(?:你(?:买下|买了|购买|购置|拥有|持有|还清|提前还)[^。；]{0,24}(?:房|公寓|房贷|按揭)|你们(?:买下|买了|购买|购置|拥有|持有|还清|提前还)[^。；]{0,24}(?:房|公寓|房贷|按揭)|(?:你|你们)(?:的)?(?:自住房|住房|房产|公寓|房贷|按揭|月供)|名下[^。；]{0,16}(?:住房|房产|公寓)|房贷每月|每月还完房贷|提前还清(?:部分|剩余)?房贷)/u;
const openingPropertyText = /(?:房产(?:市值|价值)?|住房(?:市值|价值)?|房贷余额|按揭余额|贷款余额)[^0-9]{0,12}\d/;

const cases = [];
const latestIssues = new Map();
let totalNodes = 0;
let invariantFailures = 0;
let financeNarrativeNodes = 0;
let acceptedCoverageNodes = 0;
let staleFinanceNodes = 0;
let salaryMismatchNodes = 0;
let salaryConversionMismatchNodes = 0;
let missingHoldingNodes = 0;
let missingOptionHoldingNodes = 0;
let missingPropertyNodes = 0;
let wealthDirectionMismatches = 0;
let adultZeroExpenseNodes = 0;
let employedAt80PlusNodes = 0;
let employedAt80PlusWithoutEvidenceNodes = 0;
let openingFactMismatchCases = 0;
let duplicateActiveShortfallNodes = 0;
let systemShortfallScheduleIssueNodes = 0;
let issueUndefinedNodes = 0;
let reportPlaceholderCases = 0;
let valuedOptionOmittedNodes = 0;
let contingentOptionInflatedNodes = 0;
let staleOptionLifecycleNodes = 0;
let adultBelowPolicyExpenseNodes = 0;
let invalidHoldingInstrumentNodes = 0;
let personalLedgerBusinessBoundaryNodes = 0;
let duplicateSingletonExpenseNodes = 0;
let visibleGenerationPauseCount = 0;
let generationRecoveredCount = 0;
let generationPauseCaseCount = 0;
let financialGateDecisionCount = 0;
let financialGateWouldBlockCount = 0;
let financialGateShadowWouldBlockCount = 0;
let financialGateEnforcedRejectedAttemptCount = 0;
let financialGateCommittedBlockViolationCount = 0;
let financialGateEnforcedCommittedNodeCount = 0;
let financialGateNonEnforcedCommittedNodeCount = 0;
let financialGateModeMissingCommittedNodeCount = 0;
let financialGateCriticalFactGroupCount = 0;
let financialGateSatisfiedFactGroupCount = 0;
let expenseLifecycleTriggerCount = 0;
let expenseLifecycleCoveredTriggerCount = 0;
const financialGateWouldBlockEvidence = [];

for (const record of records) {
  const history = record.finalState?.history || [];
  const gateEvents = record.finalState?.financialGateEvents || [];
  for (const event of gateEvents) {
    financialGateDecisionCount += 1;
    if (!event?.wouldBlock) continue;
    financialGateWouldBlockCount += 1;
    if (event.mode === "shadow") financialGateShadowWouldBlockCount += 1;
    if (event.mode === "enforced" && event.allowDomainCommit === false) financialGateEnforcedRejectedAttemptCount += 1;
    financialGateWouldBlockEvidence.push({
      caseSlug: record.caseSlug,
      historyLength: event.historyLength,
      mode: event.mode,
      regenerationCount: event.regenerationCount,
      transactionId: event.transactionId,
      reasonCodes: event.reasonCodes || [],
      relatedIssueIds: event.relatedIssueIds || [],
      relatedProposalIds: event.relatedProposalIds || [],
      authoritativeAgeBefore: event.authoritativeAgeBefore,
      previewAgeInMonths: event.previewAgeInMonths,
      previewPeriodIncomeWan: event.previewPeriodIncomeWan,
      previewPeriodExpenseWan: event.previewPeriodExpenseWan
    });
  }
  totalNodes += history.length;
  const nodes = [];
  let previous;
  for (let index = 0; index < history.length; index += 1) {
    const node = history[index];
    const fs = node.financialState || {};
    const ledger = node.financialLedger || {};
    const annualDebtInterestWan = round((ledger.debtAccounts || [])
      .filter((debt) => debt.status === "active" || debt.status === "defaulted")
      .reduce((sum, debt) => {
        if (Number.isFinite(debt.repaymentPolicy?.monthlyInterestWan)) return sum + debt.repaymentPolicy.monthlyInterestWan * 12;
        if (Number.isFinite(debt.repaymentPolicy?.annualInterestRate)) return sum + Number(debt.principalWan || 0) * debt.repaymentPolicy.annualInterestRate;
        return sum;
      }, 0));
    const assets = round(fs.cashWan + fs.investmentAssetsWan + fs.propertyMarketValueWan + fs.businessAndOtherAssetsWan);
    const expectedNetWorth = round(assets - fs.totalDebtWan);
    const identityOk = close(expectedNetWorth, fs.netWorthWan);
    const annualCashInflowWan = round((ledger.incomeSources || [])
      .filter((source) => source.status === "active"
        && source.accrualReviewStatus !== "quarantined"
        && source.accrualPolicy !== "event_only"
        && Number(source.activeFromAgeInMonths || 0) <= Number(ledger.asOfAgeInMonths || node.ageInMonths)
        && (source.activeUntilAgeInMonths == null || Number(source.activeUntilAgeInMonths) > Number(ledger.asOfAgeInMonths || node.ageInMonths)))
      .reduce((sum, source) => sum + (source.accrualPolicy === "annual"
        ? Number(source.annualNetAmountWan || 0)
        : Number(source.monthlyNetAmountWan || 0) * 12), 0));
    const disposableOk = close(annualCashInflowWan - Number(fs.annualCoreExpenseWan || 0) - annualDebtInterestWan, fs.annualDisposableIncomeWan);
    const cashFloorOk = Number(fs.cashWan || 0) >= -0.001;
    const ageOk = fs.asOfAgeInMonths == null || Number(fs.asOfAgeInMonths) === Number(node.ageInMonths);
    const ledgerAgeOk = ledger.asOfAgeInMonths == null || Number(ledger.asOfAgeInMonths) === Number(node.ageInMonths);
    const invariantOk = identityOk && disposableOk && cashFloorOk && ageOk && ledgerAgeOk;
    if (!invariantOk) invariantFailures += 1;

    const description = String(node.description || "");
    const hasFinanceNarrative = financeText.test(description);
    if (hasFinanceNarrative) financeNarrativeNodes += 1;
    const signature = [fs.annualAfterTaxIncomeWan, fs.annualCoreExpenseWan, fs.investmentAssetsWan, fs.propertyMarketValueWan, fs.businessAndOtherAssetsWan, fs.totalDebtWan, fs.employmentStatus].join("|");
    const transactionCount = Array.isArray(ledger.committedTransactionIds) ? ledger.committedTransactionIds.length : 0;
    const previousTransactionCount = previous?.transactionCount || 0;
    const acceptedCoverage = Boolean(hasFinanceNarrative && (transactionCount > previousTransactionCount || (previous && signature !== previous.signature)));
    if (acceptedCoverage) acceptedCoverageNodes += 1;
    const stale = Boolean(previous && hasFinanceNarrative && signature === previous.signature && transactionCount === previousTransactionCount);
    if (stale) staleFinanceNodes += 1;

    const personalCompensationAnnuals = personalCompensationAnnualAmounts(description);
    const impliedAnnual = personalCompensationAnnuals.length ? [round(personalCompensationAnnuals.at(-1))] : [];
    const monthlyAmounts = impliedAnnual.map((value) => round(value / 12));
    const activeIncomeAnnuals = (ledger.incomeSources || [])
      .filter((source) => source.status === "active")
      .map((source) => round(source.accrualPolicy === "annual" ? source.annualNetAmountWan : Number(source.monthlyNetAmountWan || 0) * 12));
    const salaryMismatch = impliedAnnual.length > 0 && !impliedAnnual.some((value) => activeIncomeAnnuals
      .some((candidate) => Math.abs(value - candidate) <= Math.max(2, value * 0.12)));
    if (salaryMismatch) salaryMismatchNodes += 1;
    const salaryConversionMismatches = compensationConversionMismatches(description);
    const salaryConversionMismatch = salaryConversionMismatches.length > 0;
    if (salaryConversionMismatch) salaryConversionMismatchNodes += 1;
    const completedPersonalOptionFact = hasCompletedPersonalOptionFact(description);
    const holdingMissing = (completedPersonalOptionFact || personalEquityText.test(description))
      && (ledger.businessHoldings?.length || 0) === 0 && Number(fs.businessAndOtherAssetsWan || 0) === 0;
    const optionHoldingMissing = completedPersonalOptionFact
      && !(ledger.businessHoldings || []).some((holding) => holding.instrumentType === "stock_option");
    const propertyMissing = personalPropertyText.test(description) && (ledger.assetAccounts?.filter((item) => item.type === "property").length || 0) === 0 && Number(fs.propertyMarketValueWan || 0) === 0;
    if (holdingMissing) missingHoldingNodes += 1;
    if (optionHoldingMissing) missingOptionHoldingNodes += 1;
    if (propertyMissing) missingPropertyNodes += 1;

    const ageYears = Number(node.ageInMonths || 0) / 12;
    const adultZeroExpense = ageYears >= 18 && Number(fs.annualCoreExpenseWan || 0) === 0;
    const adultBelowPolicyExpense = adultBelowPolicyExpenseViolation({
      ageInMonths: node.ageInMonths,
      financialState: fs,
      ledger
    });
    const careerIncomeSources = (ledger.incomeSources || []).filter((source) => source.status === "active" && source.linkedCareerStateId);
    const hasRecentCareerEvidence = careerIncomeSources.some((source) => Number.isFinite(source.lastConfirmedAtAgeInMonths)
      && Number(node.ageInMonths) - Number(source.lastConfirmedAtAgeInMonths) <= 36);
    const hasAccruingCareerIncome = careerIncomeSources.some((source) => source.accrualPolicy !== "event_only" && source.accrualReviewStatus !== "quarantined");
    const employedAt80Plus = ageYears >= 80 && fs.employmentStatus === "employed";
    const employedAt80PlusWithoutEvidence = ageYears >= 80 && fs.employmentStatus === "employed" && hasAccruingCareerIncome && !hasRecentCareerEvidence;
    if (adultZeroExpense) adultZeroExpenseNodes += 1;
    if (adultBelowPolicyExpense) adultBelowPolicyExpenseNodes += 1;
    if (employedAt80Plus) employedAt80PlusNodes += 1;
    if (employedAt80PlusWithoutEvidence) employedAt80PlusWithoutEvidenceNodes += 1;
    const activeShortfalls = (ledger.debtAccounts || []).filter((debt) => debt.status === "active" && debt.type === "liquidity_shortfall");
    const duplicateActiveShortfall = activeShortfalls.length > 1;
    const systemShortfallScheduleIssue = (ledger.unresolvedIssues || []).some((issue) => issue.status !== "resolved"
      && issue.code === "UNKNOWN_DEBT_SCHEDULE"
      && (issue.relatedDebtAccountIds || []).some((id) => activeShortfalls.some((debt) => debt.id === id)));
    const issueUndefined = (ledger.unresolvedIssues || []).some((issue) => /undefined|Cannot read properties|TypeError/u.test(String(issue.summary || "")));
    const activeOptions = (ledger.businessHoldings || []).filter((holding) => holding.instrumentType === "stock_option"
      && (holding.status === "active" || holding.status === "partially_sold"));
    const valuedOptionCarryingWan = round(activeOptions.reduce((sum, holding) => sum + Number(holding.personalCarryingValueWan || 0), 0));
    const valuedOptionOmitted = valuedOptionCarryingWan > 0
      && Number(fs.businessAndOtherAssetsWan || 0) + 0.02 < valuedOptionCarryingWan;
    const contingentOptionInflated = activeOptions.some((holding) => {
      const terms = holding.optionTerms || {};
      const remainingVestedUnits = Number(terms.vestedUnits || 0) - Number(terms.exercisedUnits || 0);
      return Number(holding.personalCarryingValueWan || 0) > 0
        && (remainingVestedUnits <= 0 || !Number.isFinite(terms.fairValueWanPerUnit));
    });
    const staleOptionLifecycle = activeOptions.some((holding) => {
      const expiresAt = holding.optionTerms?.expiresAtAgeInMonths ?? holding.expirationDateInMonths;
      return Number.isFinite(expiresAt) && Number(expiresAt) < Number(node.ageInMonths);
    });
    const invalidHoldingInstrument = (ledger.businessHoldings || []).some((holding) => (
      holding.instrumentType !== undefined && !["equity", "stock_option"].includes(holding.instrumentType)
    ));
    const businessBoundaryViolations = personalLedgerBusinessBoundaryViolations(ledger);
    const personalLedgerBusinessBoundary = businessBoundaryViolations.incomeSourceIds.length > 0
      || businessBoundaryViolations.expenseCommitmentIds.length > 0;
    const duplicateSingletonExpenses = duplicateSingletonExpenseTypes(ledger);
    const duplicateSingletonExpense = duplicateSingletonExpenses.length > 0;
    if (duplicateActiveShortfall) duplicateActiveShortfallNodes += 1;
    if (systemShortfallScheduleIssue) systemShortfallScheduleIssueNodes += 1;
    if (issueUndefined) issueUndefinedNodes += 1;
    if (valuedOptionOmitted) valuedOptionOmittedNodes += 1;
    if (contingentOptionInflated) contingentOptionInflatedNodes += 1;
    if (staleOptionLifecycle) staleOptionLifecycleNodes += 1;
    if (invalidHoldingInstrument) invalidHoldingInstrumentNodes += 1;
    if (personalLedgerBusinessBoundary) personalLedgerBusinessBoundaryNodes += 1;
    if (duplicateSingletonExpense) duplicateSingletonExpenseNodes += 1;

    const netWorthDelta = previous ? round(Number(fs.netWorthWan || 0) - Number(previous.fs.netWorthWan || 0)) : 0;
    const wealthDelta = previous ? Number(node.attributes?.wealth || 0) - Number(previous.node.attributes?.wealth || 0) : 0;
    const wealthDirectionMismatch = Boolean(previous && ((netWorthDelta > 0.02 && wealthDelta < 0) || (netWorthDelta < -0.02 && wealthDelta > 0)));
    if (wealthDirectionMismatch) wealthDirectionMismatches += 1;
    const financialMeta = node.financialProcessingMeta || {};
    // The opening snapshot predates the candidate → Preview → gate flow.  Every
    // subsequently generated node in a release corpus must declare that the
    // commit used the enforced gate; otherwise a successful result could be a
    // shadow-only observation rather than the zero-state-change contract.
    if (index > 0) {
      if (financialMeta.financialGateMode === "enforced") {
        financialGateEnforcedCommittedNodeCount += 1;
      } else if (financialMeta.financialGateMode === "shadow" || financialMeta.financialGateMode === "off") {
        financialGateNonEnforcedCommittedNodeCount += 1;
      } else {
        financialGateModeMissingCommittedNodeCount += 1;
      }
    }
    financialGateCriticalFactGroupCount += Number(financialMeta.financialGateCriticalFactGroupCount || 0);
    financialGateSatisfiedFactGroupCount += Number(financialMeta.financialGateSatisfiedCriticalFactGroupCount || 0);
    expenseLifecycleTriggerCount += Number(financialMeta.expenseLifecycleTriggerCount || 0);
    expenseLifecycleCoveredTriggerCount += Number(financialMeta.expenseLifecycleCoveredTriggerCount || 0);
    if (financialMeta.financialGateMode === "enforced" && financialMeta.financialGateWouldBlock === true) {
      financialGateCommittedBlockViolationCount += 1;
    }

    for (const issue of ledger.unresolvedIssues || []) {
      const key = `${record.caseSlug}:${issue.id}`;
      latestIssues.set(key, { caseSlug: record.caseSlug, ...issue });
    }
    nodes.push({
      node: index + 1,
      ageInMonths: node.ageInMonths,
      age: round(ageYears),
      title: node.title,
      selectedChoice: node.selectedChoice,
      financialState: fs,
      attributes: node.attributes,
      invariantChecks: { identityOk, disposableOk, cashFloorOk, ageOk, ledgerAgeOk, expectedNetWorth, annualDebtInterestWan, annualCashInflowWan },
      narrativeChecks: { hasFinanceNarrative, acceptedCoverage, stale, monthlyAmounts, impliedAnnual, activeIncomeAnnuals, salaryMismatch, salaryConversionMismatch, salaryConversionMismatches, holdingMissing, optionHoldingMissing, propertyMissing, adultZeroExpense, adultBelowPolicyExpense, employedAt80Plus, employedAt80PlusWithoutEvidence, duplicateActiveShortfall, systemShortfallScheduleIssue, issueUndefined, valuedOptionCarryingWan, valuedOptionOmitted, contingentOptionInflated, staleOptionLifecycle, invalidHoldingInstrument, personalLedgerBusinessBoundary, businessBoundaryViolations, duplicateSingletonExpense, duplicateSingletonExpenses, wealthDirectionMismatch },
      financialNarrativeAudit: extractFinancialNarrativeAuditMeta(node),
      issueIds: (ledger.unresolvedIssues || []).map((issue) => issue.id)
    });
    previous = { node, fs, signature, transactionCount };
  }

  const first = history[0]?.financialState || {};
  const last = history.at(-1)?.financialState || {};
  const openingText = JSON.stringify({ answers: record.finalState?.answers, config: record.config });
  const openingFactMismatch = openingPropertyText.test(openingText)
    && Number(first.propertyMarketValueWan || 0) === 0
    && Number(first.totalDebtWan || 0) === 0;
  if (openingFactMismatch) openingFactMismatchCases += 1;
  if (/金额待账本确认|回报幅度待账本确认|回报率待账本确认/u.test(JSON.stringify(record.finalState?.outcome || {}))) reportPlaceholderCases += 1;
  const invitationSequence = (record.interactionLog || [])
    .filter((item) => ["invitation_declined", "invitation_accepted"].includes(item.type))
    .map((item) => `${item.invitation?.id || "unknown"}:${item.type === "invitation_accepted" ? "accepted" : "declined"}`);
  const recoverableEvents = collectVisibleGenerationPauses(record);
  const recoveredGenerationAttempts = collectRecoveredGenerationAttempts(record);
  visibleGenerationPauseCount += recoverableEvents.length;
  generationRecoveredCount += recoveredGenerationAttempts;
  if (recoverableEvents.length > 0) generationPauseCaseCount += 1;
  const realityMetrics = {
    invariantFailures: nodes.filter((item) => !item.invariantChecks.identityOk || !item.invariantChecks.disposableOk
      || !item.invariantChecks.cashFloorOk || !item.invariantChecks.ageOk || !item.invariantChecks.ledgerAgeOk).length,
    salaryMismatchNodes: nodes.filter((item) => item.narrativeChecks.salaryMismatch).length,
    salaryConversionMismatchNodes: nodes.filter((item) => item.narrativeChecks.salaryConversionMismatch).length,
    adultZeroExpenseNodes: nodes.filter((item) => item.narrativeChecks.adultZeroExpense).length,
    personalLedgerBusinessBoundaryNodes: nodes.filter((item) => item.narrativeChecks.personalLedgerBusinessBoundary).length,
    duplicateSingletonExpenseNodes: nodes.filter((item) => item.narrativeChecks.duplicateSingletonExpense).length,
    missingPropertyNodes: nodes.filter((item) => item.narrativeChecks.propertyMissing).length,
    missingOptionHoldingNodes: nodes.filter((item) => item.narrativeChecks.optionHoldingMissing).length,
    valuedOptionOmittedNodes: nodes.filter((item) => item.narrativeChecks.valuedOptionOmitted).length,
    employedAt80PlusNodes: nodes.filter((item) => item.narrativeChecks.employedAt80Plus).length,
    employedAt80PlusWithoutEvidenceNodes: nodes.filter((item) => item.narrativeChecks.employedAt80PlusWithoutEvidence).length,
    openIssues: (history.at(-1)?.financialLedger?.unresolvedIssues || []).filter((issue) => (issue.status || "open") === "open").length
  };
  cases.push({
    caseSlug: record.caseSlug,
    scenario: record.scenario,
    closureType: record.finalState?.outcome?.meta?.closureType,
    passed: record.passed,
    nodeCount: history.length,
    finalAgeInMonths: history.at(-1)?.ageInMonths,
    invitationCount: record.finalState?.invitations?.length || 0,
    invitationSequence,
    recoverableEvents,
    recoveredGenerationAttempts,
    firstFinancialState: first,
    finalFinancialState: last,
    expenseLifecycleDiagnostics: expenseLifecycleDynamicDiagnosticsByCase.get(record.caseSlug),
    openingFactMismatch,
    realityMetrics,
    change: {
      cashWan: round(Number(last.cashWan || 0) - Number(first.cashWan || 0)),
      netWorthWan: round(Number(last.netWorthWan || 0) - Number(first.netWorthWan || 0)),
      debtWan: round(Number(last.totalDebtWan || 0) - Number(first.totalDebtWan || 0))
    },
    nodes
  });
}

const issues = [...latestIssues.values()];
const distressedDebtAccountKeys = new Set(records.flatMap((record) => {
  const terminalLedger = record.finalState?.history?.at(-1)?.financialLedger || {};
  return (terminalLedger.debtAccounts || [])
    .filter((debt) => (
      (debt.status === "active" || debt.status === "defaulted")
      && (debt.servicingStatus !== "current" || Number(debt.consecutiveMissedPaymentMonths || 0) > 0)
    ))
    .map((debt) => `${record.caseSlug}:${debt.id}`);
}));
const issueHealth = classifyTerminalFinancialIssues(issues, distressedDebtAccountKeys);
const openIssues = issueHealth.openIssues;
const blockingOpenIssues = issueHealth.blockingOpenIssues;
const servicingWarnings = issueHealth.servicingWarnings;
const resolvedIssues = issues.filter((issue) => issue.status === "resolved");
const issueCodeCounts = openIssues.reduce((acc, issue) => {
  acc[issue.code] = (acc[issue.code] || 0) + 1;
  return acc;
}, {});
const summary = {
  caseCount: cases.length,
  totalNodes,
  invariantFailures,
  financeNarrativeNodes,
  acceptedCoverageNodes,
  acceptedCoverageRatePct: percent(acceptedCoverageNodes, financeNarrativeNodes),
  staleFinanceNodes,
  staleFinanceRatePct: percent(staleFinanceNodes, financeNarrativeNodes),
  salaryMismatchNodes,
  salaryMismatchRatePct: percent(salaryMismatchNodes, financeNarrativeNodes),
  salaryConversionMismatchNodes,
  missingHoldingNodes,
  missingOptionHoldingNodes,
  missingPropertyNodes,
  wealthDirectionMismatches,
  financialGateDecisionCount,
  financialGateWouldBlockCount,
  financialGateShadowWouldBlockCount,
  financialGateEnforcedRejectedAttemptCount,
  financialGateCommittedBlockViolationCount,
  financialGateEnforcedCommittedNodeCount,
  financialGateNonEnforcedCommittedNodeCount,
  financialGateModeMissingCommittedNodeCount,
  rejectedNodeTimelineAdvanceCount: financialGateCommittedBlockViolationCount,
  rejectedNodePeriodAccrualCount: financialGateCommittedBlockViolationCount,
  financialGateCriticalFactGroupCount,
  financialGateSatisfiedFactGroupCount,
  criticalFactGroupCoverageRatePct: financialGateCriticalFactGroupCount === 0
    ? 100
    : percent(financialGateSatisfiedFactGroupCount, financialGateCriticalFactGroupCount),
  expenseLifecycleTriggerCount,
  expenseLifecycleCoveredTriggerCount,
  // Compatibility-only detector handling rate.  It must never be labelled as
  // real responsibility coverage because the detector created its own
  // denominator; a zero sample remains null/not_covered rather than 100%.
  machineDetectedResponsibilityHandlingRatePct: expenseLifecycleTriggerCount === 0
    ? null
    : percent(expenseLifecycleCoveredTriggerCount, expenseLifecycleTriggerCount),
  machineDetectedResponsibilityHandlingStatus: expenseLifecycleTriggerCount === 0 ? "not_covered" : "observed",
  expenseResponsibilityAnnotationLoadStatus: expenseResponsibilityAnnotationSource.status,
  expenseResponsibilityAnnotationSourcePath: expenseResponsibilityAnnotationSource.sourcePath,
  expenseResponsibilityAnnotationCorpusId: expenseResponsibilityAnnotationSource.corpusId ?? null,
  expenseResponsibilityAnnotationCorpusKind: expenseResponsibilityAnnotationSource.corpusKind ?? null,
  expenseResponsibilityAnnotationReviewer: expenseResponsibilityAnnotationSource.reviewer ?? null,
  expenseResponsibilityAnnotationReviewStatus: expenseResponsibilityAnnotationSource.reviewStatus ?? null,
  expenseResponsibilityAnnotationPurpose: expenseResponsibilityAnnotationSource.purpose ?? null,
  expenseResponsibilityAnnotationLoadError: expenseResponsibilityAnnotationSource.error ?? null,
  expenseResponsibilityCorpusCoverageStatus: expenseResponsibilityCorpusCoverage.status,
  expenseResponsibilityCorpusCoverageFailures: expenseResponsibilityCorpusCoverage.failures,
  expenseResponsibilityCorpusCoverageCounts: expenseResponsibilityCorpusCoverage.counts,
  ...expenseResponsibilityAuditSummary,
  ...expenseLifecycleCandidateTelemetryAuditSummary,
  ...expenseLifecycleDynamicAuditSummary,
  adultZeroExpenseNodes,
  employedAt80PlusNodes,
  employedAt80PlusWithoutEvidenceNodes,
  openingFactMismatchCases,
  duplicateActiveShortfallNodes,
  systemShortfallScheduleIssueNodes,
  issueUndefinedNodes,
  reportPlaceholderCases,
  valuedOptionOmittedNodes,
  contingentOptionInflatedNodes,
  staleOptionLifecycleNodes,
  adultBelowPolicyExpenseNodes,
  invalidHoldingInstrumentNodes,
  personalLedgerBusinessBoundaryNodes,
  duplicateSingletonExpenseNodes,
  visibleGenerationPauseCount,
  generationRecoveredCount,
  generationPauseCaseCount,
  openIssues: openIssues.length,
  blockingOpenIssues: blockingOpenIssues.length,
  servicingWarnings: servicingWarnings.length,
  distressedDebtAccounts: distressedDebtAccountKeys.size,
  orphanServicingWarnings: issueHealth.orphanServicingWarnings.length,
  resolvedIssues: resolvedIssues.length,
  issueCodeCounts,
  ...productionAudit.summary
};
const audit = {
  generatedAt: new Date().toISOString(),
  root,
  sourceRoot: root,
  outputRoot,
  sourceRun: sourceRunManifest
    ? {
      runId: sourceRunManifest.runId,
      repositoryCommit: sourceRunManifest.repositoryCommit,
      runStartedAt: sourceRunManifest.runStartedAt,
      runCompletedAt: sourceRunManifest.runCompletedAt
    }
    : null,
  derivedDiagnostic: isDerivedDiagnostic,
  summary,
  cases,
  issues,
  productionAudit,
  financialGateWouldBlockEvidence,
  expenseResponsibilityAudit: {
    annotationSource: expenseResponsibilityAnnotationSource,
    corpusCoverage: expenseResponsibilityCorpusCoverage,
    ...expenseResponsibilityAuditSummary,
    details: expenseResponsibilityAuditDetails
  },
  expenseLifecycleCandidateTelemetryAudit: {
    annotationSource: expenseResponsibilityAnnotationSource,
    ...expenseLifecycleCandidateTelemetryAuditSummary,
    details: expenseLifecycleCandidateTelemetryAuditDetails
  },
  expenseLifecycleDynamicAudit: {
    ...expenseLifecycleDynamicAuditSummary,
    details: expenseLifecycleDynamicAuditDetails
  }
};
await writeFile(path.join(outputRoot, "finance-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);

const displayPercent = (value) => value === null || value === undefined ? "未覆盖" : `${value}%`;
const expenseResponsibilityAuditLabel = `${summary.expenseResponsibilityAnnotationLoadStatus}${summary.expenseResponsibilityAnnotationCorpusId ? ` / ${summary.expenseResponsibilityAnnotationCorpusId}` : ""}`;
const routeRows = cases.map((item) => {
  const last = item.finalFinancialState;
  return `| ${item.caseSlug} | ${item.scenario} | ${item.closureType} | ${item.nodeCount} | ${item.invitationCount} | ${last.cashWan} | ${last.netWorthWan} | ${last.totalDebtWan} | ${last.annualAfterTaxIncomeWan} | ${last.annualCoreExpenseWan} | ${last.employmentStatus} |`;
}).join("\n");
const routeEvidenceRows = cases.map((item) => {
  const ageYears = Math.floor(Number(item.finalAgeInMonths || 0) / 12);
  const ageMonths = Number(item.finalAgeInMonths || 0) % 12;
  const age = `${ageYears}岁${ageMonths ? `${ageMonths}个月` : ""}`;
  return `| ${item.caseSlug} | ${item.scenario} | ${item.nodeCount} | ${age} | ${item.invitationSequence.join(" → ") || "无"} | ${item.closureType} | ${item.recoverableEvents.length} | ${item.passed ? "通过" : "失败"} |`;
}).join("\n");
const routeRealityRows = cases.map((item) => {
  const metrics = item.realityMetrics;
  const blockerCount = metrics.invariantFailures + metrics.salaryMismatchNodes + metrics.adultZeroExpenseNodes
    + metrics.personalLedgerBusinessBoundaryNodes + metrics.duplicateSingletonExpenseNodes + metrics.missingPropertyNodes
    + metrics.missingOptionHoldingNodes + metrics.valuedOptionOmittedNodes + metrics.employedAt80PlusNodes
    + Number(item.openingFactMismatch);
  return `| ${item.caseSlug} | ${metrics.invariantFailures} | ${metrics.salaryMismatchNodes} | ${metrics.adultZeroExpenseNodes} | ${metrics.personalLedgerBusinessBoundaryNodes} | ${metrics.duplicateSingletonExpenseNodes} | ${metrics.missingPropertyNodes} | ${metrics.missingOptionHoldingNodes} | ${metrics.valuedOptionOmittedNodes} | ${metrics.employedAt80PlusNodes} | ${metrics.openIssues} | ${blockerCount === 0 ? "核心现实性门禁通过" : "存在阻断"} |`;
}).join("\n");
const displayWan = (value) => value === null || value === undefined ? "未覆盖" : `${value} 万`;
const dynamicRouteDiagnostics = expenseLifecycleDynamicAuditDetails.routeDiagnostics;
const caseBySlug = new Map(cases.map((item) => [item.caseSlug, item]));
const cumulativeFlowRows = dynamicRouteDiagnostics.map((item) => {
  const flow = item.flow;
  return `| ${item.caseSlug} | ${flow.periodSummaryStatus} | ${displayWan(flow.cumulativeIncomeWan)} | ${displayWan(flow.cumulativeCoreExpenseWan)} | ${displayWan(flow.cumulativeOneOffExpenseWan)} | ${displayWan(flow.cumulativeDebtServiceWan)} | ${displayWan(flow.cumulativeNetCashFlowWan)} | ${displayPercent(flow.savingsRatePct)} |`;
}).join("\n") || "| 无 | not_covered | 未覆盖 | 未覆盖 | 未覆盖 | 未覆盖 | 未覆盖 | 未覆盖 |";
const annualExpenseDistributionRows = summary.annualCoreExpenseDistribution.map((item) => (
  `| ${item.annualCoreExpenseWan} | ${item.nodeCount} | ${displayPercent(item.nodeRatePct)} |`
)).join("\n") || "| 未覆盖 | 0 | 未覆盖 |";
const responsibilityLifecycleRows = summary.responsibilityLifecycleByKind.map((item) => (
  `| ${item.responsibilityKind} | ${item.starts} | ${item.adjusts} | ${item.ends} | ${item.reviews} | ${item.terminalActiveCount} | ${item.terminalPausedCount} | ${item.terminalEndedCount} | ${item.terminalOverdueReviewCount} |`
)).join("\n") || "| 未覆盖 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |";
const familyResponsibilityRunRateRows = expenseLifecycleDynamicAuditDetails.familyResponsibilityRunRateWindows.map((item) => (
  `| ${item.caseSlug} | ${item.nodeIndex} | ${item.action} | ${item.responsibilityKey} | ${item.responsibilityKind} | ${displayWan(item.before.annualizedCoreExpenseRunRateWan)}（${item.before.availableNodeCount}/3，${item.before.status}） | ${displayWan(item.after.annualizedCoreExpenseRunRateWan)}（${item.after.availableNodeCount}/3，${item.after.status}） |`
)).join("\n") || "| 未覆盖 | — | — | — | — | 未覆盖 | 未覆盖 |";
const terminalExpenseStateRows = expenseLifecycleDynamicAuditDetails.terminalExpenseStates.map((item) => {
  const route = caseBySlug.get(item.caseSlug);
  const flow = dynamicRouteDiagnostics.find((candidate) => candidate.caseSlug === item.caseSlug)?.flow || {};
  return `| ${item.caseSlug} | ${displayWan(route?.finalFinancialState?.cashWan)} | ${displayWan(route?.finalFinancialState?.netWorthWan)} | ${displayPercent(flow.savingsRatePct)} | ${item.finalFactStatus} / ${item.finalFactStatusStatus} | ${item.activeCommitmentCount} / ${item.pausedCommitmentCount} / ${item.endedCommitmentCount} | ${item.overdue.length} |`;
}).join("\n") || "| 未覆盖 | 未覆盖 | 未覆盖 | 未覆盖 | not_covered | 0 / 0 / 0 | 0 |";
const recoverableRows = cases.flatMap((item) => item.recoverableEvents.map((event) => (
  `| ${item.caseSlug} | ${event.type} | ${event.historyLength ?? 0} | ${String(event.message || "页面可恢复错误").replace(/\|/g, "\\|")} |`
))).join("\n") || "| 无 | — | — | 无 |";
const financialGateEvidenceRows = financialGateWouldBlockEvidence.map((event) => (
  `| ${event.caseSlug} | ${event.historyLength ?? 0} | ${event.mode} | ${event.regenerationCount ?? 0} | ${(event.reasonCodes || []).join("+") || "—"} | ${(event.relatedIssueIds || []).join("+") || "—"} | ${event.authoritativeAgeBefore ?? "—"} → ${event.previewAgeInMonths ?? "—"} | ${event.previewPeriodIncomeWan ?? 0} / ${event.previewPeriodExpenseWan ?? 0} |`
)).join("\n") || "| 无 | — | — | — | — | — | — | — |";
const issueRows = Object.entries(issueCodeCounts).map(([code, count]) => `| ${code} | ${count} |`).join("\n") || "| 无 | 0 |";
const expenseResponsibilityMissRows = expenseResponsibilityAuditDetails.missed.map((item) => (
  `| ${item.caseSlug} | ${item.nodeIndex} | ${item.expectedAction} | ${item.expectedResponsibilityKey} | ${item.expectedScope} | ${String(item.evidenceExcerpt || "").replace(/\|/g, "\\|")} |`
)).join("\n") || "| 无 | — | — | — | — | — |";
const expenseResponsibilityFalsePositiveRows = expenseResponsibilityAuditDetails.falsePositives.map((item) => (
  `| ${item.caseSlug} | ${item.nodeIndex} | ${item.action} | ${item.responsibilityKey} | ${item.financialScope} | ${item.source || "machine"} |`
)).join("\n") || "| 无 | — | — | — | — | — |";
const lifecycleCandidateTelemetryMatchRows = expenseLifecycleCandidateTelemetryAuditDetails.matches.map((item) => (
  `| ${item.annotation.caseSlug} | ${item.annotation.nodeIndex} | ${item.candidate.action} | ${item.candidate.responsibilityKey} | ${item.candidate.financialScope} | ${item.candidate.reconcilerDisposition} | ${(item.candidate.reconcilerReasonCodes || []).join(", ") || "—"} |`
)).join("\n") || "| 无 | — | — | — | — | — | — |";
const lifecycleCandidateTelemetryMissRows = expenseLifecycleCandidateTelemetryAuditDetails.missed.map((item) => (
  `| ${item.caseSlug} | ${item.nodeIndex} | ${item.expectedAction} | ${item.expectedResponsibilityKey} | ${item.expectedScope} | ${String(item.evidenceExcerpt || "").replace(/\|/g, "\\|")} |`
)).join("\n") || "| 无 | — | — | — | — | — |";
const lifecycleCandidateTelemetryFalsePositiveRows = expenseLifecycleCandidateTelemetryAuditDetails.falsePositives.map((item) => (
  `| ${item.caseSlug} | ${item.nodeIndex} | ${item.action} | ${item.responsibilityKey} | ${item.financialScope} | ${item.reconcilerDisposition} | ${(item.reconcilerReasonCodes || []).join(", ") || "—"} |`
)).join("\n") || "| 无 | — | — | — | — | — | — |";
const lifecycleCandidateTelemetryNegativeViolationRows = expenseLifecycleCandidateTelemetryAuditDetails.negativeViolations.map((item) => (
  `| ${item.annotation.caseSlug} | ${item.annotation.nodeIndex} | ${item.candidate.action} | ${item.candidate.responsibilityKey} | ${item.candidate.financialScope} | ${item.candidate.reconcilerDisposition} | ${(item.candidate.reconcilerReasonCodes || []).join(", ") || "—"} |`
)).join("\n") || "| 无 | — | — | — | — | — | — |";
const frozenExpenseResponsibilityCorpus = expenseResponsibilityAnnotationSource.corpusKind === "frozen_gold";
const blockers = [
  isDerivedDiagnostic && "派生只读诊断不构成当前提交的发布证据",
  invariantFailures > 0 && `账本/派生状态不变量失败：${invariantFailures} 个节点`,
  openingFactMismatchCases > 0 && `人物明确提供房产/房贷但开局账本资产和负债均为 0：${openingFactMismatchCases} 组`,
  salaryMismatchNodes > 0 && `正文个人薪资/收入与权威个人账本不一致：${salaryMismatchNodes} 个节点`,
  salaryConversionMismatchNodes > 0 && `正文年薪/月薪换算自相矛盾：${salaryConversionMismatchNodes} 个节点`,
  missingHoldingNodes > 0 && `正文持股但缺少结构化 BusinessHolding/公司事实：${missingHoldingNodes} 个节点`,
  productionAudit.summary.fallbackWithoutRepairRecordCount > 0 && `fallback 缺少 repair/fallback 审计记录：${productionAudit.summary.fallbackWithoutRepairRecordCount} 个`,
  productionAudit.summary.userVisibleInternalLedgerTextCount > 0 && `用户可见内部账本文本：${productionAudit.summary.userVisibleInternalLedgerTextCount} 个`,
  productionAudit.summary.finalReportFinancialConflictCount > 0 && `终局报告与权威财务事实冲突：${productionAudit.summary.finalReportFinancialConflictCount} 个`,
  productionAudit.summary.unexplainedDebtDeltaNodeCount > 0 && `无法由叙事或结构化 breakdown 解释的债务跳变：${productionAudit.summary.unexplainedDebtDeltaNodeCount} 个`,
  productionAudit.summary.fabricatedOpeningAccountCount > 0 && `缺少用户证据的开局资产/债务账户：${productionAudit.summary.fabricatedOpeningAccountCount} 个`,
  productionAudit.summary.assetSummaryMismatchNodeCount > 0 && `账本资产类型与汇总表不一致：${productionAudit.summary.assetSummaryMismatchNodeCount} 个`,
  productionAudit.summary.debtConservationFailureCount > 0 && `债务守恒失败：${productionAudit.summary.debtConservationFailureCount} 个`,
  productionAudit.summary.autoShortfallFrozenAboveReserveNodeCount > 0 && `现金超过三个月缓冲但缺口债冻结：${productionAudit.summary.autoShortfallFrozenAboveReserveNodeCount} 个`,
  productionAudit.summary.knownRateInterestOmissionNodeCount > 0 && `已知利率债务漏计息：${productionAudit.summary.knownRateInterestOmissionNodeCount} 个`,
  productionAudit.summary.unsupportedRepaymentCompletionNodeCount > 0 && `正文声称还清但没有偿还/减免权威事实：${productionAudit.summary.unsupportedRepaymentCompletionNodeCount} 个`,
  productionAudit.summary.userVisibleFinancialPlaceholderCount > 0 && `用户可见财务占位符：${productionAudit.summary.userVisibleFinancialPlaceholderCount} 处`,
  productionAudit.summary.orphanFinancialAmountCount > 0 && `截断或孤立财务金额：${productionAudit.summary.orphanFinancialAmountCount} 处`,
  productionAudit.summary.financialAmountPrecisionViolationCount > 0 && `财务金额长浮点泄漏：${productionAudit.summary.financialAmountPrecisionViolationCount} 处`,
  productionAudit.summary.crossJourneyInvitationEntryCount > 0 && `邀请或压力 Arc 跨 journey 串线：${productionAudit.summary.crossJourneyInvitationEntryCount} 条`,
  productionAudit.summary.companyOperatingFlowInPersonalLedgerCount > 0 && `公司经营收支进入个人账本：${productionAudit.summary.companyOperatingFlowInPersonalLedgerCount} 个账户节点`,
  productionAudit.summary.restrictedProjectFundingInPersonalCashCount > 0 && `受限项目/公益资金进入个人可支配现金：${productionAudit.summary.restrictedProjectFundingInPersonalCashCount} 笔交易`,
  productionAudit.summary.restrictedProjectFundingAttributionGapCount > 0 && `受限项目资金缺少逐 Accepted Event 归因：${productionAudit.summary.restrictedProjectFundingAttributionGapCount} 笔交易，无法证明未进入个人现金`,
  productionAudit.summary.blackOrEmptyPosterExportCount > 0 && `海报导出为空或全黑：${productionAudit.summary.blackOrEmptyPosterExportCount} 张`,
  productionAudit.summary.duplicateFinalImageEvidenceCount > 0 && `海报与报告页证据重复：${productionAudit.summary.duplicateFinalImageEvidenceCount} 组`,
  visibleGenerationPauseCount > 0 && `用户可见生成暂停：${visibleGenerationPauseCount} 次，涉及 ${generationPauseCaseCount} 组（恢复成功 ${generationRecoveredCount} 次）`,
  (!records.every((record) => record.passed) || records.length !== 5) && `固定五路线契约未全部通过：${records.filter((record) => record.passed).length}/${records.length}`,
  employedAt80PlusNodes > 0 && `80 岁以后仍为 employed：${employedAt80PlusNodes} 个节点（其中无近期工作证据 ${employedAt80PlusWithoutEvidenceNodes} 个）`,
  duplicateActiveShortfallNodes > 0 && `单路线同时存在多个活跃 shortfall 账户：${duplicateActiveShortfallNodes} 个节点`,
  systemShortfallScheduleIssueNodes > 0 && `系统 shortfall 自触发 UNKNOWN_DEBT_SCHEDULE：${systemShortfallScheduleIssueNodes} 个节点`,
  issueUndefinedNodes > 0 && `业务 issue 泄漏程序异常或 undefined：${issueUndefinedNodes} 个节点`,
  reportPlaceholderCases > 0 && `终局报告泄漏内部占位符：${reportPlaceholderCases} 组`,
  salaryMismatchNodes > 0 && `正文月收入与活跃收入来源不一致：${salaryMismatchNodes} 个节点`,
  missingPropertyNodes > 0 && `正文主人公房产或房贷事实没有房产账户：${missingPropertyNodes} 个节点`,
  valuedOptionOmittedNodes > 0 && `已归属且有账面价值的期权未进入用户财富：${valuedOptionOmittedNodes} 个节点`,
  contingentOptionInflatedNodes > 0 && `未归属或缺可靠估值的期权被计入用户财富：${contingentOptionInflatedNodes} 个节点`,
  missingOptionHoldingNodes > 0 && `正文出现期权但没有 stock_option holding：${missingOptionHoldingNodes} 个节点`,
  staleOptionLifecycleNodes > 0 && `期权超过到期月仍保持 active：${staleOptionLifecycleNodes} 个节点`,
  invalidHoldingInstrumentNodes > 0 && `持股 instrumentType 不在权威枚举内：${invalidHoldingInstrumentNodes} 个节点`,
  personalLedgerBusinessBoundaryNodes > 0 && `公司营收或经营成本进入个人收支：${personalLedgerBusinessBoundaryNodes} 个节点`,
  duplicateSingletonExpenseNodes > 0 && `basic_living 或 housing 存在重复 active 基线：${duplicateSingletonExpenseNodes} 个节点`,
  adultBelowPolicyExpenseNodes > 0 && `23 岁后生活支出仍低于成年保守政策下限：${adultBelowPolicyExpenseNodes} 个节点`,
  financialGateNonEnforcedCommittedNodeCount > 0 && `生成节点未使用 enforced 财务接受门：${financialGateNonEnforcedCommittedNodeCount} 个节点`,
  financialGateModeMissingCommittedNodeCount > 0 && `生成节点缺少财务接受门模式证据：${financialGateModeMissingCommittedNodeCount} 个节点`,
  financialGateCommittedBlockViolationCount > 0 && `接受门阻断候选仍进入历史并发生计提：${financialGateCommittedBlockViolationCount} 个节点`,
  summary.criticalFactGroupCoverageRatePct < 100 && `重大财务事实组覆盖率 ${summary.criticalFactGroupCoverageRatePct}%，低于 100%`,
  expenseResponsibilityAnnotationSource.status === "invalid" && `独立支出责任标注文件无效：${expenseResponsibilityAnnotationSource.error || annotationPath}`,
  frozenExpenseResponsibilityCorpus && summary.expenseResponsibilityAnnotatedCandidateCount === 0 && "冻结支出责任语料未覆盖任何 material 候选",
  frozenExpenseResponsibilityCorpus && summary.expenseResponsibilityCorpusCoverageStatus !== "covered"
    && `冻结支出责任语料样本不足：${summary.expenseResponsibilityCorpusCoverageFailures.join(",") || summary.expenseResponsibilityCorpusCoverageStatus}`,
  frozenExpenseResponsibilityCorpus && summary.expenseResponsibilityMissedCount > 0 && `冻结支出责任语料漏检：${summary.expenseResponsibilityMissedCount} 条`,
  frozenExpenseResponsibilityCorpus && summary.expenseResponsibilityFalsePositiveCount > 0 && `冻结支出责任语料误报：${summary.expenseResponsibilityFalsePositiveCount} 条`,
  frozenExpenseResponsibilityCorpus && summary.explicitRecurringExpenseCandidateCount === 0 && "冻结支出责任语料未覆盖任何明确金额责任",
  frozenExpenseResponsibilityCorpus && summary.explicitRecurringExpenseCoveragePct !== 100
    && `冻结支出责任明确金额覆盖率：${displayPercent(summary.explicitRecurringExpenseCoveragePct)}`,
  summary.expenseResponsibilityScopeMismatchCount > 0 && `个人账本存在非法支出 scope：${summary.expenseResponsibilityScopeMismatchCount} 条`,
  summary.expenseSharedAmountMismatchCount > 0 && `共同支出总额与主角份额不一致：${summary.expenseSharedAmountMismatchCount} 条`,
  wealthDirectionMismatches > 0 && `财富属性与净资产变化方向相反：${wealthDirectionMismatches} 个节点`,
  blockingOpenIssues.length > 0 && `终局仍存在 blocking open issue：${blockingOpenIssues.length} 个`,
  issueHealth.servicingWarningOverflow > 0 && `偿付 warning 超过真实困境债务账户：${servicingWarnings.length}/${distressedDebtAccountKeys.size}`,
  issueHealth.orphanServicingWarnings.length > 0 && `已恢复或不存在的债务仍挂偿付 warning：${issueHealth.orphanServicingWarnings.length} 个账户`,
  summary.acceptedCoverageRatePct < 80 && `财务叙述节点 Accepted 覆盖率 ${summary.acceptedCoverageRatePct}%，低于 80% 目标`
].filter(Boolean);
const routeContractPassed = records.length === 5 && records.every((record) => record.passed);
const releaseCandidate = !isDerivedDiagnostic && routeContractPassed && blockers.length === 0;
const m7Ready = !isDerivedDiagnostic && routeContractPassed && blockers.length === 0 && invariantFailures === 0;
const runEvidenceLabel = isDerivedDiagnostic ? "原始历史路线" : "本轮五条全新真实网页路线";
const runPossessive = isDerivedDiagnostic ? "原始路线" : "本轮";
const report = `# ${isDerivedDiagnostic ? "历史路线支出责任来源诊断报告" : "五组真实网页测试：财务完整审计报告"}

${isDerivedDiagnostic
  ? `> 这是对既有路线产物的只读后处理。输入根目录：\`${root}\`；诊断输出目录：\`${outputRoot}\`。它不能证明当前提交，也不能作为发布证据。${sourceRunManifest?.repositoryCommit ? ` 原始路线提交：\`${sourceRunManifest.repositoryCommit}\`。` : ""}`
  : ""}

## 结论

${runEvidenceLabel}的 **2/2/1 路径契约${records.length === 5 && records.every((record) => record.passed) ? "全部通过" : "未全部通过"}**，账本恒等式、含家庭支持与债务利息的可支配现金流恒等式、现金 floor 与年龄对齐共 ${totalNodes} 个节点、${invariantFailures} 个失败。

${isDerivedDiagnostic ? "派生诊断发布判断" : "本轮动态发布判断"}：**${releaseCandidate ? "通过真实路线财务门禁" : "不允许发布"}**。${releaseCandidate ? "以下 P0 动态阻断项均为 0。" : "存在以下阻断项："}

${blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- 无"}

## 路径矩阵与邀请序列

| 人物 | 路径 | 节点 | 终局年龄 | 邀请决策序列 | 收束 | 可恢复错误 | 结果 |
|---|---|---:|---|---|---|---:|---|
${routeEvidenceRows}

${isDerivedDiagnostic ? "原始路线记录" : "本轮"}没有失败后替换人物；所有完成记录均来自同一${isDerivedDiagnostic ? "历史" : "新"} run。页面可恢复错误如下，均通过可见重试流程继续：

| 人物 | 类型 | 当时历史节点 | 错误 |
|---|---|---:|---|
${recoverableRows}

## 核心指标

| 指标 | 结果 | 判断 |
|---|---:|---|
| 算术/现金/年龄不变量失败 | ${invariantFailures} | ${invariantFailures === 0 ? "通过" : "失败"} |
| 财务接受门决定 | ${financialGateDecisionCount} | shadow 与 enforced 使用同一判断 |
| shadow would-block | ${financialGateShadowWouldBlockCount} | 必须逐项复核召回与误报 |
| enforced 拒绝尝试 | ${financialGateEnforcedRejectedAttemptCount} | 允许内部恢复，不得进入历史 |
| 已提交生成节点的 enforced 接受门 | ${financialGateEnforcedCommittedNodeCount} | 发布门禁必须覆盖全部生成节点 |
| 已提交生成节点的非 enforced / 缺失模式 | ${financialGateNonEnforcedCommittedNodeCount} / ${financialGateModeMissingCommittedNodeCount} | 发布门禁必须均为 0 |
| 阻断候选仍提交/推进/计提 | ${financialGateCommittedBlockViolationCount} | 发布门禁必须为 0 |
| 重大事实组覆盖率 | ${summary.criticalFactGroupCoverageRatePct}%（${financialGateSatisfiedFactGroupCount}/${financialGateCriticalFactGroupCount}） | 目标 100% |
| 机器检测后的处理率（兼容指标） | ${displayPercent(summary.machineDetectedResponsibilityHandlingRatePct)}（${expenseLifecycleCoveredTriggerCount}/${expenseLifecycleTriggerCount}） | 只表示 detector 已命中后的处理；${summary.machineDetectedResponsibilityHandlingStatus} 时不得称为覆盖 |
| 独立责任标注语料 | ${expenseResponsibilityAuditLabel} | 标注源：${summary.expenseResponsibilityAnnotationSourcePath} |
| 冻结语料样本状态 | ${summary.expenseResponsibilityCorpusCoverageStatus} | ${summary.expenseResponsibilityCorpusCoverageFailures.join(", ") || "—"} |
| 独立责任召回 | ${displayPercent(summary.expenseResponsibilityRecallPct)}（${summary.expenseResponsibilityTruePositiveCount}/${summary.expenseResponsibilityAnnotatedCandidateCount}；漏检 ${summary.expenseResponsibilityMissedCount}） | 冻结 gold 语料必须 100%；新鲜五路线仅诊断 |
| 独立责任精度 | ${displayPercent(summary.expenseResponsibilityPrecisionPct)}（检测 ${summary.expenseResponsibilityDetectedCandidateCount}；误报 ${summary.expenseResponsibilityFalsePositiveCount}） | 冻结 gold 语料必须 100%；0 个检测样本显示未覆盖 |
| V4 候选 trace | ${summary.expenseLifecycleCandidateTelemetryStatus}（${summary.expenseLifecycleCandidateTelemetryRecordCount} 条） | shadow / enforced 均记录候选与 reconciler 决定，不代表已入账 |
| V4 候选对照 recall | ${displayPercent(summary.expenseLifecycleCandidateTelemetryRecallPct)}（匹配 ${summary.expenseLifecycleCandidateTelemetryMatchCount}/${summary.expenseLifecycleCandidateTelemetryAnnotatedCandidateCount}；漏检 ${summary.expenseLifecycleCandidateTelemetryMissedCount}） | 独立标注只在运行后对照，不参与生成 |
| V4 候选对照 precision | ${displayPercent(summary.expenseLifecycleCandidateTelemetryPrecisionPct)}（计划 ${summary.expenseLifecycleCandidateTelemetryPlannedCandidateCount}；误报 ${summary.expenseLifecycleCandidateTelemetryFalsePositiveCount}） | 仅已标注节点参与误报分母；0 个计划样本显示未覆盖 |
| 明确金额责任覆盖 | ${displayPercent(summary.explicitRecurringExpenseCoveragePct)}（${summary.explicitRecurringExpenseTruePositiveCount}/${summary.explicitRecurringExpenseCandidateCount}） | 冻结 gold 语料必须 100%，且分母非零 |
| 独立责任覆盖状态 | ${summary.coverageStatus} / ${summary.precisionStatus} | 0 个 material 标注必须为 not_covered，不能显示 100% |
| 年化核心支出节点分布 | ${summary.annualCoreExpenseDistributionStatus}（${summary.annualCoreExpenseObservedNodeCount} 个已观测，众数 ${displayWan(summary.annualCoreExpenseModeWan)}，集中度 ${displayPercent(summary.annualCoreExpenseConcentrationPct)}） | 仅诊断，不以储蓄率阈值自动调账 |
| 仅系统最低线的成年连续月数 | ${summary.systemFloorOnlyAdultMonths} 总月 / 最长 ${summary.maxSystemFloorOnlyStreakMonths} 月（${summary.systemFloorOnlyAdultStatus}） | 长期 floor-only 是财富偏高调查信号 |
| 活跃支出事实状态快照 | ${summary.activeExpenseFactStatusSnapshotStatus}（known ${summary.activeExpenseFactStatusSnapshotCounts.known} / estimated ${summary.activeExpenseFactStatusSnapshotCounts.estimated} / unknown ${summary.activeExpenseFactStatusSnapshotCounts.unknown} / needs_review ${summary.activeExpenseFactStatusSnapshotCounts.needs_review}） | 分母为 0 不得显示 100% |
| 期间累计现金流样本 | ${summary.routeCumulativeFinancialsStatus}；收入 ${displayWan(summary.cumulativeIncomeWan)}、持续支出 ${displayWan(summary.cumulativeCoreExpenseWan)}、一次性支出 ${displayWan(summary.cumulativeOneOffExpenseWan)}、债务服务 ${displayWan(summary.cumulativeDebtServiceWan)}、净现金流 ${displayWan(summary.cumulativeNetCashFlowWan)} | 来自 committed financialPeriodSummary |
| 家庭责任前后 3 节点运行率 | ${summary.familyResponsibilityRunRateWindowStatus}（${summary.familyResponsibilityRunRateWindowCount} 个窗口，${summary.familyResponsibilityRunRateIncompleteWindowCount} 个边界/缺样本窗口） | 不足 3 节点或无期间汇总会如实标为 partial/not_covered |
| 终局到期未复核责任 | ${summary.overdueExpenseReviewAccountCount} | 按责任类型明细见长期诊断 |
| 财富/净资产方向冲突 | ${wealthDirectionMismatches} | 目标 0 |
| 财务叙述节点 | ${financeNarrativeNodes} | 样本基数 |
| Accepted 覆盖率 | ${summary.acceptedCoverageRatePct}%（${acceptedCoverageNodes}/${financeNarrativeNodes}） | 目标 ≥80% |
| stale 节点率 | ${summary.staleFinanceRatePct}%（${staleFinanceNodes}/${financeNarrativeNodes}） | 越低越好 |
| 薪资不匹配率 | ${summary.salaryMismatchRatePct}%（${salaryMismatchNodes}/${financeNarrativeNodes}） | 目标 0 |
| 正文持股但无持股账户 | ${missingHoldingNodes} | 目标 0 |
| 正文期权但无 stock_option holding | ${missingOptionHoldingNodes} | 目标 0 |
| 正文房产/房贷但无房产账户 | ${missingPropertyNodes} | 目标 0 |
| 成年支出为 0 | ${adultZeroExpenseNodes} | 非阻断诊断；缺失时收入必须隔离 |
| 80 岁后仍 employed | ${employedAt80PlusNodes} | 目标 0 |
| 其中无近期工作证据仍 employed | ${employedAt80PlusWithoutEvidenceNodes} | 诊断项 |
| 开局重大资产负债漏入账 | ${openingFactMismatchCases} 组 | 目标 0 |
| narrative fallback | ${productionAudit.summary.narrativeFallbackNodeCount} 个 / ${productionAudit.summary.narrativeFallbackCaseCount} 组 | 必须如实统计，残章目标 0 |
| 用户可见内部账本文本 | ${productionAudit.summary.userVisibleInternalLedgerTextCount} | 目标 0 |
| 终局报告财务冲突 | ${productionAudit.summary.finalReportFinancialConflictCount} | 目标 0 |
| 无解释债务跳变 | ${productionAudit.summary.unexplainedDebtDeltaNodeCount} | 目标 0 |
| 无用户证据开局账户 | ${productionAudit.summary.fabricatedOpeningAccountCount} | 目标 0 |
| 资产汇总不一致 | ${productionAudit.summary.assetSummaryMismatchNodeCount} | 目标 0 |
| 债务守恒失败 | ${productionAudit.summary.debtConservationFailureCount} | 目标 0 |
| 缓冲以上缺口债冻结 | ${productionAudit.summary.autoShortfallFrozenAboveReserveNodeCount} | 目标 0 |
| 已知利率漏计息 | ${productionAudit.summary.knownRateInterestOmissionNodeCount}/${productionAudit.summary.knownRateDebtExposureNodeCount} | ${productionAudit.summary.knownRateDebtExposureNodeCount === 0 ? "未覆盖，不得视为已验证" : "目标 0"} |
| 无事实却声称还清 | ${productionAudit.summary.unsupportedRepaymentCompletionNodeCount} | 目标 0 |
| 用户可见财务占位符 | ${productionAudit.summary.userVisibleFinancialPlaceholderCount} | 目标 0 |
| 截断/孤立财务金额 | ${productionAudit.summary.orphanFinancialAmountCount} | 目标 0 |
| 财务金额长浮点 | ${productionAudit.summary.financialAmountPrecisionViolationCount} | 目标 0 |
| 跨 journey 邀请/Arc | ${productionAudit.summary.crossJourneyInvitationEntryCount} | 目标 0 |
| 公司经营收支进入个人账本 | ${productionAudit.summary.companyOperatingFlowInPersonalLedgerCount} | 目标 0 |
| 受限项目/公益资金进入个人可支配现金 | ${productionAudit.summary.restrictedProjectFundingInPersonalCashCount} | 目标 0；按交易 ID 去重 |
| 受限项目资金逐事件归因缺口 | ${productionAudit.summary.restrictedProjectFundingAttributionGapCount} | 目标 0；没有归因不得以聚合交易文本断言个人现金流 |
| 空白/全黑海报导出 | ${productionAudit.summary.blackOrEmptyPosterExportCount} | 目标 0 |
| 海报与报告页证据重复 | ${productionAudit.summary.duplicateFinalImageEvidenceCount} | 目标 0 |
| 用户可见生成暂停 | ${visibleGenerationPauseCount} 次 / ${generationPauseCaseCount} 组 | 发布门禁必须为 0 |
| 暂停后恢复成功 | ${generationRecoveredCount} 次 | 诊断项，不抵消暂停阻断 |
| 多个活跃 shortfall 账户节点 | ${duplicateActiveShortfallNodes} | 目标 0 |
| 系统 shortfall 自触发计划噪音 | ${systemShortfallScheduleIssueNodes} | 目标 0 |
| issue 泄漏异常/undefined | ${issueUndefinedNodes} | 目标 0 |
| 报告内部占位符 | ${reportPlaceholderCases} 组 | 目标 0 |
| 有价值期权未计入用户财富 | ${valuedOptionOmittedNodes} | 目标 0 |
| 或有/缺估值期权错误计入财富 | ${contingentOptionInflatedNodes} | 目标 0 |
| 过期但仍 active 的期权节点 | ${staleOptionLifecycleNodes} | 目标 0 |
| 非法持股 instrumentType 节点 | ${invalidHoldingInstrumentNodes} | 目标 0 |
| 公司营收或经营成本进入个人收支 | ${personalLedgerBusinessBoundaryNodes} | 目标 0 |
| basic_living / housing 重复 active | ${duplicateSingletonExpenseNodes} | 目标 0 |
| 23 岁后仍低于成年支出政策下限 | ${adultBelowPolicyExpenseNodes} | 目标 0 |
| open / resolved issue | ${openIssues.length} / ${resolvedIssues.length} | 必须有关闭路径且终局可控 |
| blocking open issue | ${blockingOpenIssues.length} | 发布门禁必须为 0 |
| 偿付 warning / 真实困境债务账户 | ${servicingWarnings.length} / ${distressedDebtAccountKeys.size} | warning 不得超过真实困境账户，且不得指向已恢复账户 |

Accepted 覆盖率以“包含财务叙述的节点中，本节点新增已提交交易或核心财务签名发生变化”为可审计代理口径；它不把纯时间计提误算为新事实接受。

## 财务接受门 would-block 明细

| 人物 | 历史节点 | 模式 | 重生次数 | 原因 | issue | 权威年龄 → Preview 年龄（月） | Preview 收入 / 支出（万） |
|---|---:|---|---:|---|---|---|---:|
${financialGateEvidenceRows}

## 独立支出责任标注审计

这组指标以${expenseResponsibilityAnnotationLabel}为分母，绝不从 lifecycle detector 自身生成分母。没有加载标注或标注 material 样本为 0 时，状态为 not_covered；新鲜五路线保留为诊断，冻结 gold 语料才执行 precision/recall 100% 门禁。

| 项目 | 结果 |
|---|---|
| 标注加载 | ${expenseResponsibilityAuditLabel} |
| 标注文件 | ${summary.expenseResponsibilityAnnotationSourcePath} |
| 冻结语料样本状态 | ${summary.expenseResponsibilityCorpusCoverageStatus}（${summary.expenseResponsibilityCorpusCoverageFailures.join(", ") || "—"}） |
| material 候选 / 正确匹配 / 漏检 | ${summary.expenseResponsibilityAnnotatedCandidateCount} / ${summary.expenseResponsibilityTruePositiveCount} / ${summary.expenseResponsibilityMissedCount} |
| 机器正例 / 误报 | ${summary.expenseResponsibilityDetectedCandidateCount} / ${summary.expenseResponsibilityFalsePositiveCount} |
| recall / precision | ${displayPercent(summary.expenseResponsibilityRecallPct)} / ${displayPercent(summary.expenseResponsibilityPrecisionPct)} |
| 明确金额责任覆盖 | ${displayPercent(summary.explicitRecurringExpenseCoveragePct)}（${summary.explicitRecurringExpenseTruePositiveCount}/${summary.explicitRecurringExpenseCandidateCount}） |
| coverage / precision status | ${summary.coverageStatus} / ${summary.precisionStatus} |

### 漏检责任

| 人物 | 节点 | 预期动作 | 责任键 | 范围 | 标注证据 |
|---|---:|---|---|---|---|
${expenseResponsibilityMissRows}

### 误报责任

| 人物 | 节点 | 机器动作 | 责任键 | 范围 | 来源 |
|---|---:|---|---|---|---|
${expenseResponsibilityFalsePositiveRows}

## V4 候选 trace 与独立标注对照

这里读取的是每个节点持久化的 lifecycle candidate/reconciler trace。它在 shadow 和 enforced 使用同一套候选与判定；shadow 中的 planned_* 只是 dry-run 计划，绝不表示账本已经写入。标注在路线结束后由审计器读取，未参与候选生成、reconciler 或权威提交。

| 项目 | 结果 |
|---|---|
| trace 状态 / 原始候选记录 | ${summary.expenseLifecycleCandidateTelemetryStatus} / ${summary.expenseLifecycleCandidateTelemetryRecordCount} |
| material 标注 / 完整匹配 / 漏检 | ${summary.expenseLifecycleCandidateTelemetryAnnotatedCandidateCount} / ${summary.expenseLifecycleCandidateTelemetryMatchCount} / ${summary.expenseLifecycleCandidateTelemetryMissedCount} |
| 已检测但未形成匹配计划 | ${summary.expenseLifecycleCandidateTelemetryDetectedButNotPlannedCount} |
| 已标注节点的 planned 候选 / 误报 | ${summary.expenseLifecycleCandidateTelemetryPlannedCandidateCount} / ${summary.expenseLifecycleCandidateTelemetryFalsePositiveCount} |
| ignore 标注 / 对照命中 / 未被 ignored 的违规候选 | ${summary.expenseLifecycleCandidateTelemetryNegativeAnnotatedCount} / ${summary.expenseLifecycleCandidateTelemetryNegativeMatchCount} / ${summary.expenseLifecycleCandidateTelemetryNegativeViolationCount}（${summary.expenseLifecycleCandidateTelemetryNegativeStatus}） |
| recall / precision | ${displayPercent(summary.expenseLifecycleCandidateTelemetryRecallPct)} / ${displayPercent(summary.expenseLifecycleCandidateTelemetryPrecisionPct)} |
| coverage / precision status | ${summary.expenseLifecycleCandidateTelemetryCoverageStatus} / ${summary.expenseLifecycleCandidateTelemetryPrecisionStatus} |

### 匹配候选

| 人物 | 节点 | 动作 | 责任键 | 范围 | reconciler 决定 | 原因码 |
|---|---:|---|---|---|---|---|
${lifecycleCandidateTelemetryMatchRows}

### 候选 trace 漏检

| 人物 | 节点 | 预期动作 | 责任键 | 范围 | 标注证据 |
|---|---:|---|---|---|---|
${lifecycleCandidateTelemetryMissRows}

### 候选 trace 误报

| 人物 | 节点 | 候选动作 | 责任键 | 范围 | reconciler 决定 | 原因码 |
|---|---:|---|---|---|---|---|
${lifecycleCandidateTelemetryFalsePositiveRows}

### ignore 对照中未被忽略的候选

| 人物 | 节点 | 候选动作 | 责任键 | 范围 | reconciler 决定 | 原因码 |
|---|---:|---|---|---|---|---|
${lifecycleCandidateTelemetryNegativeViolationRows}

## 长期支出与财富诊断

以下均为已提交账本快照和期间汇总的只读诊断；它们用于发现“收入稳定进入、支出被长期低估”的偏差，绝不按储蓄率阈值自动加账或扣账。任何分母为 0 的字段显示 not_covered 或“未覆盖”，不显示 100%。

### 按路线累计现金流

| 人物 | 期间汇总状态 | 累计收入 | 持续核心支出 | 一次性支出 | 债务服务 | 净现金流 | 储蓄率 |
|---|---|---:|---:|---:|---:|---:|---:|
${cumulativeFlowRows}

### 年化核心支出节点分布

| 年支出 | 节点数 | 已观测节点占比 |
|---:|---:|---:|
${annualExpenseDistributionRows}

只使用系统最低线的成年月份：${summary.systemFloorOnlyAdultMonths}；最长连续区间：${summary.maxSystemFloorOnlyStreakMonths} 个月；观测状态：${summary.systemFloorOnlyAdultStatus}。

### 按责任类型的生命周期与终局状态

| 责任类型 | start | adjust | end | review | 终局 active | paused | ended | 到期未复核 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${responsibilityLifecycleRows}

### 家庭责任前后 3 节点的年化核心支出运行率

窗口以责任发生节点为分界：before 为此前最多 3 个已提交节点，after 为当前及后续最多 3 个节点。边界节点不足 3 个或缺少 financialPeriodSummary 时保留 partial/not_covered，而不是补成完整样本。

| 人物 | 节点 | 动作 | 责任键 | 类型 | 前 3 节点运行率 | 后 3 节点运行率 |
|---|---:|---|---|---|---:|---:|
${familyResponsibilityRunRateRows}

### 终局财务与支出事实状态

| 人物 | 终局现金 | 终局净资产 | 期间储蓄率 | 支出事实状态 | active / paused / ended | 到期未复核 |
|---|---:|---:|---:|---|---:|---:|
${terminalExpenseStateRows}

## 五条路线终局快照

| 人物 | 路径 | 终局 | 节点 | 邀请 | 现金 | 净资产 | 债务 | 年收入 | 年支出 | 身份 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${routeRows}

## 逐组可复核结果

${cases.map((item) => `- **${item.caseSlug}**：${item.nodeCount} 个节点，${item.invitationCount} 次邀请；终局现金 ${item.finalFinancialState.cashWan} 万、债务 ${item.finalFinancialState.totalDebtWan} 万、净资产 ${item.finalFinancialState.netWorthWan} 万，就业状态 ${item.finalFinancialState.employmentStatus}；路线契约${item.passed ? "通过" : "失败"}。`).join("\n")}

以下结论直接从${runPossessive}各节点账本与正文计算，不复用固定路线描述：

| 人物 | 不变量失败 | 薪资错配 | 成年零支出 | 企业事实污染 | 重复生活/住房基线 | 房产缺口 | 期权 holding 缺口 | 有价值期权漏计 | 80+ employed | 终局 open issue | 判断 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${routeRealityRows}

## issue 代码统计

| 代码 | open 数量 |
|---|---:|
${issueRows}

## 下一步

${releaseCandidate
  ? "1. 继续执行静态 M5/M7、全量单测、lint、typecheck/build 与十张图片检查；全部通过后才可判定发布候选。\n2. open issue、薪资措辞偏差与持股/房产叙述代理指标保留为非阻断质量 backlog，不得伪装为 0。"
  : blockers.map((item, index) => `${index + 1}. 修复并用全新数据复验：${item}`).join("\n")}

## 生产阻断明细

- narrative fallback 节点：${productionAudit.fallbackNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 终局报告冲突：${productionAudit.finalReportConflicts.map((item) => `${item.caseSlug}:${item.code}`).join("、") || "无"}
- 无解释债务跳变：${productionAudit.unexplainedDebtDeltaNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 缺少用户证据的开局账户：${productionAudit.fabricatedOpeningAccounts.map((item) => `${item.caseSlug}:${item.accountId}`).join("、") || "无"}
- 资产汇总不一致：${productionAudit.assetSummaryMismatchNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 债务守恒失败：${productionAudit.debtConservationFailures.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 缓冲以上缺口债冻结：${productionAudit.frozenAutomaticShortfallNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 已知利率漏计息：${productionAudit.knownRateInterestOmissionNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 无事实却声称还清：${productionAudit.unsupportedRepaymentCompletionNodes.map((item) => `${item.caseSlug}#${item.node}`).join("、") || "无"}
- 用户可见财务占位符：${productionAudit.userVisibleFinancialPlaceholders.map((item) => `${item.caseSlug}:${item.path}`).join("、") || "无"}
- 截断/孤立财务金额：${productionAudit.orphanFinancialAmounts.map((item) => `${item.caseSlug}:${item.path}`).join("、") || "无"}
- 财务金额长浮点：${productionAudit.financialPrecisionViolations.map((item) => `${item.caseSlug}:${item.path}`).join("、") || "无"}
- 跨 journey 邀请/Arc：${productionAudit.crossJourneyInvitationEntries.map((item) => `${item.caseSlug}:${item.code}:${item.id}`).join("、") || "无"}
- 公司经营收支进入个人账本：${productionAudit.companyOperatingFlowsInPersonalLedger.map((item) => `${item.caseSlug}#${item.node}:${item.accountId}`).join("、") || "无"}
- 受限项目/公益资金进入个人可支配现金：${productionAudit.restrictedProjectFundingInPersonalCash.map((item) => `${item.caseSlug}#${item.node}:${item.transactionId}`).join("、") || "无"}
- 受限项目资金逐事件归因缺口：${productionAudit.restrictedProjectFundingAttributionGaps.map((item) => `${item.caseSlug}#${item.node}:${item.transactionId}`).join("、") || "无"}
- 空白/全黑海报：${productionAudit.posterEvidence.filter((item) => !item.nonBlank).map((item) => item.caseSlug).join("、") || "无"}
- 海报与报告页证据重复：${productionAudit.posterEvidence.filter((item) => !item.distinctFromReportPage).map((item) => item.caseSlug).join("、") || "无"}

1. 逐项处理上方动态生成的阻断项；不得用旧批次的固定结论替代${runPossessive}证据。
2. 入口事实修复继续使用原句、类型化账户 ID 和一次结构化重试，不降低 Validator 标准。
3. 期权验收保持双向门禁：可靠折后 carrying value 必须进入企业及其他资产、净资产和财富分；未归属或缺可靠估值期权只保留 contingent holding。
4. 所有阻断归零后仍需再跑全新的 2/2/1，不能复用${runPossessive} JSON。

逐节点的完整正文、全部选择、用户选择、五项状态、账本快照和终局报告见 \`full-test-data.md\`；机器可读审计见 \`finance-audit.json\`。

证据索引：\`cases/\` 保存五组完整 JSON，\`working/\` 保存同轮 checkpoint，\`images/<case>/report-page.jpg\` 与 \`poster.jpg\` 保存终局页面和海报，\`visual-inspection.json\` 保存人工视觉复核结果。
`;
await writeFile(path.join(outputRoot, "evaluation-report.md"), report);

const aggregate = {
  generatedAt: new Date().toISOString(),
  caseCount: records.length,
  allCasesPassed: routeContractPassed,
  m7Ready,
  scenarioCounts: records.reduce((acc, record) => ({ ...acc, [record.scenario]: (acc[record.scenario] || 0) + 1 }), {}),
  totalHistoryNodes: totalNodes,
  totalInvitations: records.reduce((sum, record) => sum + (record.finalState?.invitations?.length || 0), 0),
  releaseCandidate,
  blockers,
  cases: cases.map(({ nodes, ...item }) => item)
};
await writeFile(path.join(outputRoot, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
const runStartedAt = records.map((record) => record.startedAt).sort()[0];
const runCompletedAt = records.map((record) => record.completedAt).filter(Boolean).sort().at(-1);
const repositoryCommit = await runGit(["rev-parse", "HEAD"]);
const repositoryDirty = Boolean(await runGit(["status", "--short"]));
const manifest = {
  runId: path.basename(outputRoot),
  runStartedAt,
  runCompletedAt,
  generatedAt: new Date().toISOString(),
  repositoryPath: process.cwd(),
  repositoryCommit,
  repositoryDirty,
  launchUrl,
  commands: [
    "pnpm exec tsx scripts/render-full-browser-test-data-markdown.ts <source-root>/cases <source-root>/full-test-data.md",
    "node scripts/analyze-financial-real-browser-run.mjs <source-root> [annotation-path] [--output-root <path>]",
    "node $HOME/.codex/skills/run-real-browser-ending-routes/scripts/verify-five-route-run.mjs --root <source-root> --started-after <runStartedAt> --full-data <source-root>/full-test-data.md --report <output-root>/evaluation-report.md"
  ],
  sourceArtifact: {
    root,
    runId: sourceRunManifest?.runId ?? path.basename(root),
    repositoryCommit: sourceRunManifest?.repositoryCommit ?? null,
    runStartedAt: sourceRunManifest?.runStartedAt ?? null,
    runCompletedAt: sourceRunManifest?.runCompletedAt ?? null
  },
  derivedDiagnostic: isDerivedDiagnostic,
  artifacts: ["aggregate.json", "finance-audit.json", "full-test-data.md", "evaluation-report.md", "visual-inspection.json", "cases/", "working/", "images/"],
  cases: records.map((record) => ({ caseSlug: record.caseSlug, scenario: record.scenario, path: `cases/${record.caseSlug}.json` }))
};
await writeFile(path.join(outputRoot, "run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
