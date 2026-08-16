/**
 * Independent responsibility audit.  It intentionally receives human
 * annotations instead of invoking the lifecycle detector, so the detector can
 * neither create its own denominator nor turn an empty sample into a pass.
 *
 * Matching unit: (caseSlug, nodeIndex, responsibilityKey, action,
 * financialScope).  Type, protagonist amount and household share are strict
 * attributes of the same match; a key-only match with the wrong amount is both
 * a miss and an invalid machine positive.
 */

function percent(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : null;
}

const FACT_STATUSES = ["known", "estimated", "unknown", "needs_review"];
const EXPENSE_COMMITMENT_STATUSES = ["active", "paused", "ended"];
const RESPONSIBILITY_ACTIONS = ["start", "adjust", "end", "review"];
const HUMAN_REVIEWER_LABELS = new Set(["human", "human_adjudicated"]);
const FAMILY_RESPONSIBILITY_KINDS = new Set([
  "primary_residence",
  "child_support",
  "elder_care"
]);
const REVIEW_INTERVAL_MONTHS = {
  adult_basic_living: 60,
  primary_residence: 36,
  personal_insurance: 24,
  child_support: 12,
  elder_care: 12,
  recurring_healthcare: 12,
  continuing_education: 12,
  legacy_aggregate: 12
};

function round(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function nonNegative(value) {
  return Math.max(0, finite(value) ?? 0);
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

/**
 * The frozen corpus is a release input, not a convenient sample.  Keep its
 * minimum composition here so a tiny, all-green fixture cannot be presented
 * as the Spec's closed gate.
 */
/**
 * @param {{ annotations?: any[], corpusKind?: string }} input
 */
export function assessExpenseResponsibilityCorpusCoverage(input = {}) {
  const { annotations = [], corpusKind } = input;
  if (corpusKind !== "frozen_gold") {
    return { status: "not_applicable", failures: [], counts: {} };
  }

  const material = annotations.filter((item) => item.material !== false && item.expectedAction !== "ignore");
  const count = (predicate) => annotations.filter(predicate).length;
  const materialCount = material.length;
  const counts = {
    material: materialCount,
    housing: count((item) => item.material !== false && item.expectedType === "housing"),
    dependentSupport: count((item) => item.material !== false && item.expectedType === "dependent_support"),
    healthcare: count((item) => item.material !== false && item.expectedType === "healthcare"),
    insurance: count((item) => item.material !== false && item.expectedType === "insurance"),
    adjust: count((item) => item.material !== false && item.expectedAction === "adjust"),
    end: count((item) => item.material !== false && item.expectedAction === "end"),
    review: count((item) => item.material !== false && item.expectedAction === "review"),
    businessOrThirdPartyNegative: count((item) => item.expectedAction === "ignore"
      && ["business_operating", "third_party"].includes(item.expectedScope)),
    // `human_adjudicated` is the explicit provenance label for a row reviewed
    // by a human adjudicator after fresh-route annotation.  It is a valid
    // human review, not a machine-generated expected answer.
    nonHumanReviewer: count((item) => !HUMAN_REVIEWER_LABELS.has(item.reviewer))
  };
  if (materialCount === 0) return { status: "not_covered", failures: ["material"], counts };

  const failures = [
    counts.material < 12 && "material<12",
    counts.housing < 2 && "housing<2",
    counts.dependentSupport < 2 && "dependent_support<2",
    counts.healthcare < 2 && "healthcare<2",
    counts.insurance < 2 && "insurance<2",
    counts.adjust < 1 && "adjust<1",
    counts.end < 1 && "end<1",
    counts.review < 1 && "review<1",
    counts.businessOrThirdPartyNegative < 4 && "business_or_third_party_negative<4",
    counts.nonHumanReviewer > 0 && "non_human_reviewer"
  ].filter(Boolean);
  return {
    status: failures.length > 0 ? "insufficient_coverage" : "covered",
    failures,
    counts
  };
}

export function expenseResponsibilityKey(value) {
  return [value.caseSlug, value.nodeIndex, value.responsibilityKey, value.action, value.financialScope].join("|");
}

function nodeLedger(node) {
  return node?.financialLedger || {};
}

function nodeAgeInMonths(node) {
  const explicit = Number(node?.ageInMonths);
  if (Number.isFinite(explicit)) return explicit;
  const age = Number(node?.age);
  return Number.isFinite(age) ? age * 12 : undefined;
}

function financialScope(commitment) {
  return commitment?.financialScope || "personal";
}

function responsibilityKey(commitment) {
  return typeof commitment?.responsibilityKey === "string" && commitment.responsibilityKey.trim()
    ? commitment.responsibilityKey
    : undefined;
}

function commitmentFor(node, key) {
  return (nodeLedger(node).expenseCommitments || []).find((item) => responsibilityKey(item) === key);
}

function expectedMatch(annotation, currentNode, previousNode) {
  const commitment = commitmentFor(currentNode, annotation.expectedResponsibilityKey);
  const previous = commitmentFor(previousNode, annotation.expectedResponsibilityKey);
  if (annotation.expectedAction === "ignore") return !commitment;

  // An account merely being present is not enough.  The audit is aligned to a
  // particular node/action, so a stale active or already-ended account must
  // not make a start/adjust/end annotation look covered.
  const actionMatches = (
    (annotation.expectedAction === "start" && !previous && commitment && commitment.status !== "ended")
    || (annotation.expectedAction === "adjust" && previous && commitment?.status !== "ended" && commitmentChanged(previous, commitment))
    || (annotation.expectedAction === "end" && previous && previous.status !== "ended" && commitment?.status === "ended")
    || (annotation.expectedAction === "review"
      && commitment
      && Number(commitment.lastReviewedAtAgeInMonths) === nodeAgeInMonths(currentNode))
  );
  if (!actionMatches) return false;
  if (annotation.expectedType && commitment.type !== annotation.expectedType) return false;
  if (annotation.expectedScope && financialScope(commitment) !== annotation.expectedScope) return false;
  if (annotation.expectedMonthlyAmountWan !== undefined
    && Math.abs(Number(commitment.monthlyAmountWan) - annotation.expectedMonthlyAmountWan) > 0.005) return false;
  if (annotation.expectedShareRate !== undefined
    && Math.abs(Number(commitment.householdShareRate) - annotation.expectedShareRate) > 0.005) return false;
  return true;
}

function activeCommitments(node) {
  return (nodeLedger(node).expenseCommitments || []).filter((commitment) => commitment.status === "active");
}

function sameOptionalNumber(left, right) {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (!Number.isFinite(leftValue) && !Number.isFinite(rightValue)) return true;
  return leftValue === rightValue;
}

function commitmentChanged(previous, current) {
  return previous.status !== current.status
    || !sameOptionalNumber(previous.monthlyAmountWan, current.monthlyAmountWan)
    || financialScope(previous) !== financialScope(current)
    || !sameOptionalNumber(previous.householdShareRate, current.householdShareRate)
    || !sameOptionalNumber(previous.grossMonthlyAmountWan, current.grossMonthlyAmountWan);
}

/**
 * Artifact records do not persist a raw detector trace in every historical
 * format.  For annotated nodes we therefore derive the machine positive from
 * the committed responsibility action.  This is deliberately restricted to
 * annotated node coordinates: a partial, human-labelled corpus cannot call
 * every unlabelled route account a false positive.
 */
export function collectCommittedResponsibilityCandidates({ routeRecords = [], annotations = [] }) {
  const annotatedNodes = new Set(annotations.map((annotation) => `${annotation.caseSlug}|${annotation.nodeIndex}`));
  const candidates = [];
  for (const record of routeRecords) {
    const history = record.history || [];
    for (const [nodeIndex, node] of history.entries()) {
      if (!annotatedNodes.has(`${record.caseSlug}|${nodeIndex}`)) continue;
      const current = nodeLedger(node).expenseCommitments || [];
      const previous = nodeLedger(history[nodeIndex - 1]).expenseCommitments || [];
      const previousByKey = new Map(previous
        .map((commitment) => [responsibilityKey(commitment), commitment])
        .filter(([key]) => key));
      for (const commitment of current) {
        const key = responsibilityKey(commitment);
        if (!key || commitment.responsibilityKind === "adult_basic_living") continue;
        const prior = previousByKey.get(key);
        let action;
        if (!prior && commitment.status !== "ended") action = "start";
        else if (prior && commitment.status === "ended" && prior.status !== "ended") action = "end";
        else if (prior && commitmentChanged(prior, commitment)) action = "adjust";
        else if (Number.isFinite(Number(commitment.lastReviewedAtAgeInMonths))
          && Number(commitment.lastReviewedAtAgeInMonths) === nodeAgeInMonths(node)) action = "review";
        if (!action) continue;
        candidates.push({
          caseSlug: record.caseSlug,
          nodeIndex,
          responsibilityKey: key,
          action,
          financialScope: financialScope(commitment),
          source: "committed_ledger"
        });
      }
    }
  }
  return candidates;
}

const PLANNED_LIFECYCLE_CANDIDATE_DISPOSITIONS = new Set([
  "planned_start",
  "planned_adjust",
  "planned_end",
  "planned_review"
]);

function candidateTraceNodeKey(value) {
  return `${value.caseSlug}|${value.nodeIndex}`;
}

function candidateTraceIdentityMatches(candidate, annotation) {
  return candidate.caseSlug === annotation.caseSlug
    && candidate.nodeIndex === annotation.nodeIndex
    && candidate.responsibilityKey === annotation.expectedResponsibilityKey
    && candidate.action === annotation.expectedAction
    && candidate.financialScope === annotation.expectedScope;
}

function candidateTraceContractMatches(candidate, annotation) {
  if (!candidateTraceIdentityMatches(candidate, annotation)) return false;
  if (annotation.expectedType && candidate.proposedType !== annotation.expectedType) return false;
  if (annotation.expectedMonthlyAmountWan !== undefined) {
    const actual = finite(candidate.sourceMonthlyAmountWan);
    if (actual === undefined || Math.abs(actual - annotation.expectedMonthlyAmountWan) > 0.005) return false;
  }
  if (annotation.expectedShareRate !== undefined) {
    const actual = finite(candidate.shareRate);
    if (actual === undefined || Math.abs(actual - annotation.expectedShareRate) > 0.005) return false;
  }
  return candidate.reconcilerDisposition === `planned_${annotation.expectedAction}`;
}

/**
 * Read the raw V4 detector/reconciler trace stored in node telemetry. It is
 * deliberately independent from human annotations: artifact analysis may
 * compare the two after a run, but annotations never enter generation or
 * reconciliation.
 */
export function collectExpenseLifecycleCandidateRecords({ routeRecords = [] } = {}) {
  const records = [];
  for (const route of routeRecords) {
    for (const [nodeIndex, node] of (route.history || []).entries()) {
      const telemetry = node?.financialProcessingMeta?.expenseLifecycleTelemetry;
      const candidates = Array.isArray(telemetry?.candidates) ? telemetry.candidates : [];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate.candidateId !== "string" || !candidate.candidateId.trim()) continue;
        records.push({
          caseSlug: route.caseSlug,
          nodeIndex,
          mode: telemetry?.mode || "unknown",
          telemetryWouldBlock: Boolean(telemetry?.wouldBlock),
          ...candidate
        });
      }
    }
  }
  return records;
}

/**
 * Audit detector/reconciler traces against a separately authored annotation
 * corpus. A raw candidate is not a success on its own: a positive match needs
 * identity, typed/amount contract, and the corresponding planned disposition.
 * Conversely, only planned candidates on annotated nodes enter precision so a
 * partial label corpus cannot call all unannotated route activity a false
 * positive.
 */
export function auditExpenseLifecycleCandidateTelemetry({ annotations = [], routeRecords = [] } = {}) {
  const candidateRecords = collectExpenseLifecycleCandidateRecords({ routeRecords });
  const material = annotations.filter((item) => item.material !== false && item.expectedAction !== "ignore");
  const annotatedNodeKeys = new Set(annotations.map((annotation) => candidateTraceNodeKey(annotation)));
  const matches = [];
  const missed = [];
  const detectedButNotPlanned = [];
  const matchedCandidateRecordIds = new Set();
  for (const annotation of material) {
    const identityMatches = candidateRecords.filter((candidate) => candidateTraceIdentityMatches(candidate, annotation));
    const match = identityMatches.find((candidate) => candidateTraceContractMatches(candidate, annotation));
    if (match) {
      matches.push({ annotation, candidate: match });
      matchedCandidateRecordIds.add(`${candidateTraceNodeKey(match)}|${match.candidateId}`);
      continue;
    }
    if (identityMatches.length > 0) {
      detectedButNotPlanned.push({ annotation, candidates: identityMatches });
    } else {
      missed.push(annotation);
    }
  }
  const plannedCandidatesAtAnnotatedNodes = candidateRecords.filter((candidate) => (
    PLANNED_LIFECYCLE_CANDIDATE_DISPOSITIONS.has(candidate.reconcilerDisposition)
    && annotatedNodeKeys.has(candidateTraceNodeKey(candidate))
  ));
  const falsePositives = plannedCandidatesAtAnnotatedNodes.filter((candidate) => {
    const candidateRecordId = `${candidateTraceNodeKey(candidate)}|${candidate.candidateId}`;
    if (matchedCandidateRecordIds.has(candidateRecordId)) return false;
    return !material.some((annotation) => candidateTraceContractMatches(candidate, annotation));
  });
  const negativeMatches = annotations
    .filter((annotation) => annotation.expectedAction === "ignore")
    .map((annotation) => ({
      annotation,
      candidates: candidateRecords.filter((candidate) => (
        candidate.caseSlug === annotation.caseSlug
        && candidate.nodeIndex === annotation.nodeIndex
        && candidate.responsibilityKey === annotation.expectedResponsibilityKey
        && candidate.financialScope === annotation.expectedScope
      ))
    }))
    .filter((item) => item.candidates.length > 0);
  // An ignore annotation may still produce a detector record for observability
  // (for example, an office candidate deliberately classified as business and
  // reconciled as `ignored`). It becomes a diagnostic false positive only if
  // it was not ignored by the reconciler. This catches a new review issue or
  // a planned personal commitment that a positive-only precision denominator
  // would otherwise hide.
  const negativeViolations = negativeMatches.flatMap((item) => item.candidates
    .filter((candidate) => candidate.reconcilerDisposition !== "ignored")
    .map((candidate) => ({ annotation: item.annotation, candidate })));
  const plannedNegativeViolations = negativeViolations.filter((item) => (
    PLANNED_LIFECYCLE_CANDIDATE_DISPOSITIONS.has(item.candidate.reconcilerDisposition)
  ));
  for (const item of plannedNegativeViolations) {
    const candidateRecordId = `${candidateTraceNodeKey(item.candidate)}|${item.candidate.candidateId}`;
    if (!falsePositives.some((candidate) => (
      `${candidateTraceNodeKey(candidate)}|${candidate.candidateId}` === candidateRecordId
    ))) falsePositives.push(item.candidate);
  }
  const positiveMissed = [...missed, ...detectedButNotPlanned.map((item) => item.annotation)];
  const candidateTelemetryObserved = candidateRecords.length > 0;
  const annotationCount = material.length;
  const negativeAnnotationCount = annotations.filter((item) => item.expectedAction === "ignore").length;
  return {
    expenseLifecycleCandidateTelemetryRecordCount: candidateRecords.length,
    expenseLifecycleCandidateTelemetryPlannedCandidateCount: plannedCandidatesAtAnnotatedNodes.length,
    expenseLifecycleCandidateTelemetryAnnotatedCandidateCount: annotationCount,
    expenseLifecycleCandidateTelemetryMatchCount: matches.length,
    expenseLifecycleCandidateTelemetryMissedCount: positiveMissed.length,
    expenseLifecycleCandidateTelemetryDetectedButNotPlannedCount: detectedButNotPlanned.length,
    expenseLifecycleCandidateTelemetryFalsePositiveCount: falsePositives.length,
    expenseLifecycleCandidateTelemetryNegativeAnnotatedCount: negativeAnnotationCount,
    expenseLifecycleCandidateTelemetryNegativeMatchCount: negativeMatches.length,
    expenseLifecycleCandidateTelemetryNegativeViolationCount: negativeViolations.length,
    expenseLifecycleCandidateTelemetryRecallPct: percent(matches.length, annotationCount),
    expenseLifecycleCandidateTelemetryPrecisionPct: percent(
      plannedCandidatesAtAnnotatedNodes.length - falsePositives.length,
      plannedCandidatesAtAnnotatedNodes.length
    ),
    expenseLifecycleCandidateTelemetryStatus: candidateTelemetryObserved ? "observed" : "not_covered",
    expenseLifecycleCandidateTelemetryCoverageStatus: annotationCount === 0
      ? "not_covered"
      : positiveMissed.length === 0 ? "covered" : "incomplete",
    expenseLifecycleCandidateTelemetryPrecisionStatus: plannedCandidatesAtAnnotatedNodes.length === 0
      ? "not_covered"
      : falsePositives.length === 0 && negativeViolations.length === 0 ? "covered" : "incomplete",
    expenseLifecycleCandidateTelemetryNegativeStatus: negativeAnnotationCount === 0
      ? "not_covered"
      : negativeViolations.length === 0 ? "covered" : "incomplete",
    details: {
      matches,
      missed: positiveMissed,
      detectedButNotPlanned,
      falsePositives,
      negativeMatches,
      negativeViolations,
      candidateRecords
    }
  };
}

function annotationNodes(nodes, annotation) {
  return {
    current: nodes.get(`${annotation.caseSlug}|${annotation.nodeIndex}`),
    previous: nodes.get(`${annotation.caseSlug}|${annotation.nodeIndex - 1}`)
  };
}

function candidateMatchesAnnotation(candidate, annotation, nodes) {
  if (annotation.expectedAction === "ignore") return false;
  if (expenseResponsibilityKey(candidate) !== expenseResponsibilityKey({
    caseSlug: annotation.caseSlug,
    nodeIndex: annotation.nodeIndex,
    responsibilityKey: annotation.expectedResponsibilityKey,
    action: annotation.expectedAction,
    financialScope: annotation.expectedScope
  })) return false;
  const { current, previous } = annotationNodes(nodes, annotation);
  return expectedMatch(annotation, current, previous);
}

function responsibilityKind(commitment) {
  if (typeof commitment?.responsibilityKind === "string" && commitment.responsibilityKind) {
    return commitment.responsibilityKind;
  }
  // Old ledgers did not persist a V4 responsibility kind.  Do not guess a
  // family member from a broad `dependent_support` type: that would make the
  // diagnostic look more complete than the historical facts allow.
  if (commitment?.type === "basic_living") return "adult_basic_living";
  return "unclassified";
}

function commitmentKey(commitment) {
  return responsibilityKey(commitment) || (typeof commitment?.id === "string" ? commitment.id : undefined);
}

function commitmentFactStatus(commitment) {
  return FACT_STATUSES.includes(commitment?.factStatus) ? commitment.factStatus : "unknown";
}

/**
 * Policy/context/legacy amounts are conservative cash-flow safeguards.  They
 * remain reviewable, but the narrator cannot manufacture an Accepted fact to
 * close them merely because their calendar review is due.  The release gate
 * must therefore distinguish these system-owned estimates from explicit or
 * last-known amounts that genuinely require an authoritative disposition.
 */
function isPolicyOwnedExpenseEstimate(commitment) {
  return commitmentFactStatus(commitment) !== "known"
    && ["policy_floor", "contextual_estimate", "legacy_estimate"].includes(commitment?.amountBasis);
}

function activeOrPausedCommitments(node) {
  return (nodeLedger(node).expenseCommitments || []).filter((commitment) => (
    commitment?.status === "active" || commitment?.status === "paused"
  ));
}

function ageInMonths(node) {
  return nodeAgeInMonths(node);
}

function nodeDurationMonths(node, previousNode) {
  const period = node?.financialPeriodSummary;
  const start = finite(period?.periodStartAgeInMonths);
  const end = finite(period?.periodEndAgeInMonths);
  if (start !== undefined && end !== undefined && end >= start) return end - start;
  const previousAge = ageInMonths(previousNode);
  const currentAge = ageInMonths(node);
  if (previousAge !== undefined && currentAge !== undefined && currentAge >= previousAge) {
    return currentAge - previousAge;
  }
  return 0;
}

function systemFloorOnly(node) {
  const commitments = activeCommitments(node);
  if (commitments.length !== 1) return false;
  const commitment = commitments[0];
  const isFloorAmount = Math.abs(nonNegative(commitment.monthlyAmountWan) - 0.35) <= 0.005;
  const hasFloorBasis = commitment.amountBasis === undefined || commitment.amountBasis === "policy_floor";
  return responsibilityKind(commitment) === "adult_basic_living" && isFloorAmount && hasFloorBasis;
}

const EXPENSE_EPSILON_WAN = 0.005;
const ACCEPTED_EXPENSE_EVIDENCE_SOURCES = new Set([
  "user",
  "accepted_history",
  "accepted_simulation_outcome"
]);

function hasExpenseSnapshot(node) {
  return Array.isArray(nodeLedger(node).expenseCommitments);
}

function isMaterialExpenseResponsibility(commitment) {
  return !["adult_basic_living", "unclassified_core_consumption"].includes(responsibilityKind(commitment));
}

function activeMonthlyAmount(commitment) {
  return commitment?.status === "active" ? nonNegative(commitment.monthlyAmountWan) : 0;
}

function commitmentByResponsibilityKey(node) {
  const byKey = new Map();
  for (const commitment of nodeLedger(node).expenseCommitments || []) {
    const key = commitmentKey(commitment);
    if (key) byKey.set(key, commitment);
  }
  return byKey;
}

function amountSourceIds(commitment) {
  return Array.isArray(commitment?.amountSourceIds)
    ? commitment.amountSourceIds.filter((value) => typeof value === "string" && value.trim())
    : [];
}

/**
 * Snapshots deliberately do not expose reducer payloads.  For a downward
 * recurring-expense transition, the durable evidence available to a browser
 * audit is therefore the replacement commitment's explicit amount basis plus
 * accepted (not policy-only) evidence.  A policy rotation cannot satisfy this
 * predicate.
 */
function hasAcceptedDownwardExpenseAuthority(commitment) {
  if (responsibilityKind(commitment) === "unclassified_core_consumption"
    && (commitment.evidence || []).some((evidence) => evidence?.reasonCode === "EXPENSE_UNCLASSIFIED_RESIDUAL_REALLOCATION")) {
    return true;
  }
  if (!commitment || !["explicit_known", "explicit_shared_amount"].includes(commitment.amountBasis)) return false;
  return (commitment.evidence || []).some((evidence) => (
    ACCEPTED_EXPENSE_EVIDENCE_SOURCES.has(evidence?.source)
    && !/^EXPENSE_POLICY_|^SYSTEM_POLICY_/u.test(String(evidence?.reasonCode || ""))
  ));
}

function hasStableExpenseReviewIssue(node, commitment) {
  const key = commitmentKey(commitment);
  return (nodeLedger(node).unresolvedIssues || []).some((issue) => {
    if (issue?.status === "resolved") return false;
    const linked = (issue?.relatedAccountIds || []).includes(commitment?.id)
      || (key && String(issue?.id || "").includes(key));
    if (!linked) return false;
    return issue?.code === "PENDING_FACT"
      || /^expense_(?:review_due|responsibility_review|lifecycle_review)_/u.test(String(issue?.id || ""));
  });
}

function reviewedAtCurrentNode(commitment, node) {
  const reviewedAt = finite(commitment?.lastReviewedAtAgeInMonths);
  const nodeAge = ageInMonths(node);
  return reviewedAt !== undefined && nodeAge !== undefined && reviewedAt >= nodeAge;
}

function hasMortgageMarker(commitment) {
  const values = [
    commitment?.displayName,
    commitment?.responsibilityKey,
    ...(amountSourceIds(commitment)),
    ...(commitment?.evidence || []).flatMap((evidence) => [evidence?.reasonCode, evidence?.excerpt])
  ];
  return values.some((value) => /mortgage|mortgage_payment|loan_repayment|房贷|按揭|月供/u.test(String(value || "")));
}

function hasMortgageService(node) {
  const ledger = nodeLedger(node);
  const activeMortgage = (ledger.debtAccounts || []).some((debt) => (
    debt?.type === "mortgage"
    && ["active", "restructured", "defaulted"].includes(debt?.status)
    && (
      nonNegative(debt?.repaymentPolicy?.monthlyPaymentWan) > EXPENSE_EPSILON_WAN
      || nonNegative(debt?.repaymentPolicy?.monthlyPrincipalWan) > EXPENSE_EPSILON_WAN
      || nonNegative(debt?.repaymentPolicy?.monthlyInterestWan) > EXPENSE_EPSILON_WAN
    )
  ));
  if (!activeMortgage) return false;
  const period = periodSummary(node);
  return Boolean(
    (period && (period.debtPrincipalPaidWan > EXPENSE_EPSILON_WAN || period.debtInterestPaidWan > EXPENSE_EPSILON_WAN))
    || activeMortgage
  );
}

function activeNonAggregateMonthlyAmount(node) {
  return activeCommitments(node)
    .filter((commitment) => responsibilityKind(commitment) !== "legacy_aggregate")
    .reduce((sum, commitment) => sum + activeMonthlyAmount(commitment), 0);
}

function hasAcceptedAggregateSplitAuthority(commitments) {
  return commitments.some((commitment) => hasAcceptedDownwardExpenseAuthority(commitment)
    && (commitment.evidence || []).some((evidence) => /SPLIT|拆分|分项|REDUCED|降低/u.test(`${evidence?.reasonCode || ""} ${evidence?.excerpt || ""}`)));
}

function collectDuplicateAmountSources(node) {
  const sources = new Map();
  for (const commitment of activeCommitments(node)) {
    const id = commitmentKey(commitment);
    if (!id) continue;
    for (const sourceId of new Set(amountSourceIds(commitment))) {
      const commitments = sources.get(sourceId) || [];
      commitments.push(commitment);
      sources.set(sourceId, commitments);
    }
  }
  return [...sources.entries()]
    .filter(([, commitments]) => new Set(commitments.map((commitment) => commitmentKey(commitment))).size > 1)
    .map(([amountSourceId, commitments]) => ({
      amountSourceId,
      commitmentIds: commitments.map((commitment) => commitment.id),
      responsibilityKeys: commitments.map((commitment) => commitmentKey(commitment)),
      responsibilityKinds: commitments.map((commitment) => responsibilityKind(commitment))
    }));
}

function periodSummary(node) {
  const value = node?.financialPeriodSummary;
  if (!value || typeof value !== "object") return undefined;
  const observed = [
    value.incomeWan,
    value.coreExpenseWan,
    value.otherExpenseWan,
    value.debtPrincipalPaidWan,
    value.debtInterestPaidWan,
    value.netCashFlowWan
  ].some((item) => finite(item) !== undefined);
  if (!observed) return undefined;
  return {
    incomeWan: nonNegative(value.incomeWan),
    coreExpenseWan: nonNegative(value.coreExpenseWan),
    otherExpenseWan: nonNegative(value.otherExpenseWan),
    debtPrincipalPaidWan: nonNegative(value.debtPrincipalPaidWan),
    debtInterestPaidWan: nonNegative(value.debtInterestPaidWan),
    netCashFlowWan: finite(value.netCashFlowWan) ?? 0,
    durationMonths: nodeDurationMonths(node)
  };
}

function expenseWindow(nodes) {
  const observedPeriods = nodes.map(periodSummary).filter(Boolean);
  const months = observedPeriods.reduce((sum, item) => sum + item.durationMonths, 0);
  const coreExpenseWan = round(observedPeriods.reduce((sum, item) => sum + item.coreExpenseWan, 0));
  return {
    requestedNodeCount: 3,
    availableNodeCount: nodes.length,
    observedPeriodNodeCount: observedPeriods.length,
    periodMonths: months,
    coreExpenseWan,
    annualizedCoreExpenseRunRateWan: months > 0 ? round(coreExpenseWan / months * 12) : null,
    status: observedPeriods.length === 0
      ? "not_covered"
      : nodes.length < 3 || observedPeriods.length !== nodes.length ? "partial" : "observed"
  };
}

function reviewDueAt(commitment) {
  const explicit = finite(commitment?.nextReviewAtAgeInMonths);
  if (explicit !== undefined) return explicit;
  const kind = responsibilityKind(commitment);
  const interval = REVIEW_INTERVAL_MONTHS[kind];
  const origin = finite(commitment?.lastConfirmedAtAgeInMonths)
    ?? finite(commitment?.activeFromAgeInMonths);
  return interval !== undefined && origin !== undefined ? origin + interval : undefined;
}

function responsibilityEventFor(current, previous, node) {
  if (!previous && current?.status !== "ended") return "start";
  if (previous && previous.status !== "ended" && current?.status === "ended") return "end";
  const reviewedAt = finite(current?.lastReviewedAtAgeInMonths);
  if (previous && current && current.status !== "ended" && reviewedAt !== undefined && reviewedAt === ageInMonths(node)) {
    return "review";
  }
  if (previous && current && current.status !== "ended" && commitmentChanged(previous, current)) return "adjust";
  return undefined;
}

function collectResponsibilityLifecycleEvents(record) {
  const history = record.history || [];
  const events = [];
  for (const [nodeIndex, node] of history.entries()) {
    const current = nodeLedger(node).expenseCommitments || [];
    const previous = nodeLedger(history[nodeIndex - 1]).expenseCommitments || [];
    const currentByKey = new Map(current
      .map((commitment) => [commitmentKey(commitment), commitment])
      .filter(([key]) => key));
    const previousByKey = new Map(previous
      .map((commitment) => [commitmentKey(commitment), commitment])
      .filter(([key]) => key));
    for (const commitment of current) {
      const key = commitmentKey(commitment);
      if (!key) continue;
      const prior = previousByKey.get(key);
      const action = responsibilityEventFor(commitment, prior, node);
      if (!action) continue;
      events.push({
        caseSlug: record.caseSlug,
        nodeIndex,
        ageInMonths: ageInMonths(node),
        responsibilityKey: key,
        responsibilityKind: responsibilityKind(commitment),
        action,
        status: commitment.status || "unknown",
        financialScope: financialScope(commitment),
        monthlyAmountWan: finite(commitment.monthlyAmountWan) ?? null
      });
    }
    // A future reducer might compact ended commitments away.  Preserve that
    // disappearance as an auditable end instead of silently losing the event.
    for (const [key, prior] of previousByKey) {
      if (currentByKey.has(key) || prior.status === "ended") continue;
      events.push({
        caseSlug: record.caseSlug,
        nodeIndex,
        ageInMonths: ageInMonths(node),
        responsibilityKey: key,
        responsibilityKind: responsibilityKind(prior),
        action: "end",
        status: "missing_from_snapshot",
        financialScope: financialScope(prior),
        monthlyAmountWan: null
      });
    }
  }
  return events;
}

function routeFlowDiagnostics(history) {
  const periods = history.map(periodSummary);
  const observed = periods.filter(Boolean);
  const complete = observed.length === history.length;
  if (observed.length === 0) {
    return {
      periodSummaryStatus: "not_covered",
      periodSummaryNodeCount: 0,
      missingPeriodSummaryNodeCount: history.length,
      cumulativeIncomeWan: null,
      cumulativeCoreExpenseWan: null,
      cumulativeOtherExpenseWan: null,
      cumulativeOneOffExpenseWan: null,
      cumulativeDebtPrincipalPaidWan: null,
      cumulativeDebtInterestPaidWan: null,
      cumulativeDebtServiceWan: null,
      cumulativeNetCashFlowWan: null,
      cumulativeSavingsWan: null,
      savingsRatePct: null,
      savingsRateStatus: "not_covered"
    };
  }
  const total = (field) => round(observed.reduce((sum, item) => sum + item[field], 0));
  const income = total("incomeWan");
  const coreExpense = total("coreExpenseWan");
  const otherExpense = total("otherExpenseWan");
  const principal = total("debtPrincipalPaidWan");
  const interest = total("debtInterestPaidWan");
  const debtService = round(principal + interest);
  const savings = round(income - coreExpense - otherExpense - debtService);
  return {
    periodSummaryStatus: complete ? "covered" : "partial",
    periodSummaryNodeCount: observed.length,
    missingPeriodSummaryNodeCount: history.length - observed.length,
    cumulativeIncomeWan: income,
    cumulativeCoreExpenseWan: coreExpense,
    cumulativeOtherExpenseWan: otherExpense,
    // `otherExpenseWan` is the committed one-off/non-core field of the
    // period summary; keeping both names makes the report unambiguous.
    cumulativeOneOffExpenseWan: otherExpense,
    cumulativeDebtPrincipalPaidWan: principal,
    cumulativeDebtInterestPaidWan: interest,
    cumulativeDebtServiceWan: debtService,
    cumulativeNetCashFlowWan: total("netCashFlowWan"),
    cumulativeSavingsWan: savings,
    savingsRatePct: percent(savings, income),
    savingsRateStatus: income > 0 ? (complete ? "observed" : "partial") : "not_covered"
  };
}

function terminalExpenseState(history) {
  const terminalNode = history.at(-1);
  const commitments = nodeLedger(terminalNode).expenseCommitments || [];
  const terminalAgeInMonths = ageInMonths(terminalNode);
  const statusCounts = Object.fromEntries(EXPENSE_COMMITMENT_STATUSES.map((status) => [status, 0]));
  const factStatusCounts = Object.fromEntries(FACT_STATUSES.map((status) => [status, 0]));
  const activeFactStatusCounts = Object.fromEntries(FACT_STATUSES.map((status) => [status, 0]));
  const overdue = [];
  for (const commitment of commitments) {
    increment(statusCounts, EXPENSE_COMMITMENT_STATUSES.includes(commitment.status) ? commitment.status : "unknown");
    const factStatus = commitmentFactStatus(commitment);
    increment(factStatusCounts, factStatus);
    if (commitment.status === "active") increment(activeFactStatusCounts, factStatus);
    const dueAtAgeInMonths = reviewDueAt(commitment);
    if (commitment.status !== "ended"
      && terminalAgeInMonths !== undefined
      && dueAtAgeInMonths !== undefined
      && terminalAgeInMonths >= dueAtAgeInMonths) {
      overdue.push({
        commitmentId: commitment.id,
        responsibilityKey: commitmentKey(commitment),
        responsibilityKind: responsibilityKind(commitment),
        status: commitment.status,
        factStatus,
        amountBasis: commitment.amountBasis ?? null,
        acceptedDispositionRequired: !isPolicyOwnedExpenseEstimate(commitment),
        dueAtAgeInMonths,
        ageInMonths: terminalAgeInMonths
      });
    }
  }
  const activeCount = statusCounts.active || 0;
  const finalFactStatus = commitments.length === 0
    ? "not_covered"
    : factStatusCounts.needs_review > 0 ? "needs_review"
      : factStatusCounts.unknown > 0 ? "unknown"
        : factStatusCounts.estimated > 0 ? "estimated"
          : "known";
  return {
    status: commitments.length === 0 ? "not_covered" : "observed",
    commitmentCount: commitments.length,
    statusCounts,
    factStatusCounts,
    activeFactStatusCounts,
    finalFactStatus,
    finalFactStatusStatus: commitments.length === 0 ? "not_covered" : "observed",
    overdue,
    activeCommitmentCount: activeCount,
    pausedCommitmentCount: statusCounts.paused || 0,
    endedCommitmentCount: statusCounts.ended || 0
  };
}

function lifecycleCountsByKind(events, terminal) {
  const byKind = new Map();
  const entryFor = (kind) => {
    if (!byKind.has(kind)) {
      byKind.set(kind, {
        responsibilityKind: kind,
        starts: 0,
        adjusts: 0,
        ends: 0,
        reviews: 0,
        eventCount: 0,
        terminalActiveCount: 0,
        terminalPausedCount: 0,
        terminalEndedCount: 0,
        terminalOverdueReviewCount: 0
      });
    }
    return byKind.get(kind);
  };
  for (const event of events) {
    const entry = entryFor(event.responsibilityKind);
    increment(entry, `${event.action}s`);
    entry.eventCount += 1;
  }
  for (const commitment of terminal.commitments) {
    const entry = entryFor(responsibilityKind(commitment));
    if (commitment.status === "active") entry.terminalActiveCount += 1;
    else if (commitment.status === "paused") entry.terminalPausedCount += 1;
    else if (commitment.status === "ended") entry.terminalEndedCount += 1;
  }
  for (const overdue of terminal.state.overdue) {
    entryFor(overdue.responsibilityKind).terminalOverdueReviewCount += 1;
  }
  return [...byKind.values()].sort((left, right) => left.responsibilityKind.localeCompare(right.responsibilityKind));
}

/**
 * Read-only diagnostic companion for real-browser artifacts.  It intentionally
 * consumes committed snapshots and period summaries only: no detector is
 * called, no account is repaired, and no model output can make an empty sample
 * look like coverage.
 */
export function auditExpenseLifecycleDynamics({ routeRecords = [] } = {}) {
  const annualDistribution = new Map();
  const factStatusSnapshotCounts = Object.fromEntries(FACT_STATUSES.map((status) => [status, 0]));
  const floorRows = [];
  const lifecycleEvents = [];
  const routeDiagnostics = [];
  const baselineDownwardOverwrites = [];
  const unknownZeroExpenses = [];
  const staleExpensesWithoutReview = [];
  const aggregateSplitLosses = [];
  const amountSourceDoubleCounts = [];
  const mortgageExpenseDoubleCounts = [];
  const acceptedNodesWithUnresolvedMaterialExpenseBindings = [];
  const bindingSourceIdentityMissing = [];
  const bindingTelemetryIncomplete = [];
  const postSanitizeConfirmationRejections = [];
  const unknownLiabilityPersonalCommitments = [];
  const knownWithoutExplicitAmountEvidence = [];
  const policyFloorPromotedToKnown = [];
  const untraceableAmountSources = [];
  const confirmedResponsibilitiesWithoutNonzeroAccrual = [];
  const expenseConfirmationAuthorityViolations = [];
  const reviewResolutionsWithoutAcceptedOutcome = [];
  const annualCoreExpenseDerivationMismatches = [];
  let expenseBindingTelemetryObservedNodeCount = 0;
  let annualExpenseObservedNodeCount = 0;
  let annualExpenseMissingNodeCount = 0;
  let activeFactStatusSnapshotCount = 0;
  let expenseSnapshotObservedNodeCount = 0;
  let systemFloorOnlyAdultMonths = 0;
  let maxSystemFloorOnlyStreakMonths = 0;
  let unclassifiedExpenseSnapshotCount = 0;
  let unclassifiedExpenseMonths = 0;
  let unclassifiedExpenseWanMonths = 0;
  let activeExpenseWanMonths = 0;
  let knownTypedExpenseWanMonths = 0;

  for (const record of routeRecords) {
    const history = record.history || [];
    const flow = routeFlowDiagnostics(history);
    const events = collectResponsibilityLifecycleEvents(record);
    lifecycleEvents.push(...events);
    let currentFloorStreakMonths = 0;
    let routeFloorOnlyAdultMonths = 0;
    let routeMaxFloorOnlyStreakMonths = 0;
    let routeUnclassifiedExpenseMonths = 0;
    for (const [nodeIndex, node] of history.entries()) {
      const previousNode = history[nodeIndex - 1];
      const lifecycleTelemetry = node?.financialProcessingMeta?.expenseLifecycleTelemetry;
      if (lifecycleTelemetry && lifecycleTelemetry.narrativeBindingMode) {
        expenseBindingTelemetryObservedNodeCount += 1;
        if (Number(lifecycleTelemetry.narrativeBindingSourceIdentityMissingCount || 0) > 0) {
          bindingSourceIdentityMissing.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            count: Number(lifecycleTelemetry.narrativeBindingSourceIdentityMissingCount)
          });
        }
        if (Number(lifecycleTelemetry.expenseConfirmationRejectedAfterSanitizeCount || 0) > 0) {
          postSanitizeConfirmationRejections.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            count: Number(lifecycleTelemetry.expenseConfirmationRejectedAfterSanitizeCount)
          });
        }
        for (const candidate of lifecycleTelemetry.candidates || []) {
          if (!candidate.sourceFactBindingId) continue;
          const incomplete = !candidate.sourceClause?.clauseId
            || !Number.isInteger(candidate.sourceClause?.sentenceIndex)
            || !Number.isInteger(candidate.sourceClause?.clauseIndex)
            || !candidate.sourceSpans?.responsibility
            || !(candidate.unresolvedFields || []).includes("completion") && !candidate.sourceSpans?.completion
            || candidate.amountBasis !== "unknown" && !candidate.sourceSpans?.amount
            || candidate.liability !== "unknown" && !candidate.sourceSpans?.payer
            || candidate.cadence !== "recurring_unknown" && !candidate.sourceSpans?.cadence
            || !["committed", "rejected", "prospective_shadow"].includes(candidate.finalDisposition);
          if (incomplete) bindingTelemetryIncomplete.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            candidateId: candidate.candidateId,
            sourceFactBindingId: candidate.sourceFactBindingId
          });
        }
        const unresolvedCritical = (lifecycleTelemetry.candidates || []).filter((candidate) => (
          candidate.sourceMateriality === "critical"
          && (candidate.wouldBlock || candidate.reconcilerDisposition === "blocked")
        ));
        if (lifecycleTelemetry.mode === "enforced" && unresolvedCritical.length > 0) {
          acceptedNodesWithUnresolvedMaterialExpenseBindings.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            candidateIds: unresolvedCritical.map((candidate) => candidate.candidateId),
            reasonCodes: [...new Set(unresolvedCritical.flatMap((candidate) => candidate.sourceBindingReasonCodes || []))]
          });
        }
      }
      const annualExpense = finite(node?.financialState?.annualCoreExpenseWan);
      if (annualExpense === undefined) {
        annualExpenseMissingNodeCount += 1;
      } else {
        annualExpenseObservedNodeCount += 1;
        const key = round(annualExpense).toFixed(4);
        const current = annualDistribution.get(key) || { annualCoreExpenseWan: round(annualExpense), nodeCount: 0 };
        current.nodeCount += 1;
        annualDistribution.set(key, current);
      }
      if (hasExpenseSnapshot(node)) expenseSnapshotObservedNodeCount += 1;
      const commitments = activeCommitments(node);
      const derivedAnnualCoreExpenseWan = round(commitments.reduce((sum, commitment) => (
        sum + activeMonthlyAmount(commitment) * 12
      ), 0));
      if (annualExpense !== undefined
        && Math.abs(annualExpense - derivedAnnualCoreExpenseWan) > EXPENSE_EPSILON_WAN) {
        annualCoreExpenseDerivationMismatches.push({
          caseSlug: record.caseSlug,
          nodeIndex,
          reportedAnnualCoreExpenseWan: annualExpense,
          derivedAnnualCoreExpenseWan
        });
      }
      const acceptedEventIds = new Set((nodeLedger(node).recentTransactions || [])
        .flatMap((transaction) => Array.isArray(transaction.eventIds) ? transaction.eventIds : []));
      for (const issue of nodeLedger(node).unresolvedIssues || []) {
        if (issue?.status !== "resolved" || !issue?.expenseResolutionKind) continue;
        const previouslyResolved = (nodeLedger(previousNode).unresolvedIssues || [])
          .some((previousIssue) => previousIssue?.id === issue.id && previousIssue?.status === "resolved");
        if (previouslyResolved) continue;
        if (!issue.resolvedByEventId || !acceptedEventIds.has(issue.resolvedByEventId)) {
          reviewResolutionsWithoutAcceptedOutcome.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            issueId: issue.id,
            resolvedByEventId: issue.resolvedByEventId ?? null
          });
        }
      }
      for (const commitment of commitments) {
        if (financialScope(commitment) === "personal"
          && (commitment.evidence || []).some((evidence) => (
            /OWNER_REVIEW_REQUIRED|PAYER_UNRESOLVED|SCOPE_UNRESOLVED/u.test(String(evidence?.reasonCode || ""))
          ))) {
          unknownLiabilityPersonalCommitments.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id });
        }
        if (commitment.factStatus === "known"
          && !["explicit_known", "explicit_shared_amount"].includes(commitment.amountBasis)) {
          knownWithoutExplicitAmountEvidence.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id, amountBasis: commitment.amountBasis });
        }
        if (commitment.factStatus === "known" && commitment.amountBasis === "policy_floor") {
          policyFloorPromotedToKnown.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id });
        }
        if (commitment.factStatus === "known" && activeMonthlyAmount(commitment) <= EXPENSE_EPSILON_WAN) {
          confirmedResponsibilitiesWithoutNonzeroAccrual.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            commitmentId: commitment.id
          });
        }
        if (commitment.factStatus === "known"
          && ["explicit_known", "explicit_shared_amount"].includes(commitment.amountBasis)
          && !(commitment.evidence || []).some((evidence) => ACCEPTED_EXPENSE_EVIDENCE_SOURCES.has(evidence?.source))) {
          expenseConfirmationAuthorityViolations.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            commitmentId: commitment.id,
            reason: "known_explicit_without_accepted_evidence"
          });
        }
        if (commitment.responsibilityKind && commitment.responsibilityKind !== "adult_basic_living"
          && (!Array.isArray(commitment.amountSourceIds) || commitment.amountSourceIds.length === 0)) {
          untraceableAmountSources.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id });
        }
        increment(factStatusSnapshotCounts, commitmentFactStatus(commitment));
        activeFactStatusSnapshotCount += 1;
        if (["unknown", "needs_review"].includes(commitmentFactStatus(commitment))
          && activeMonthlyAmount(commitment) <= EXPENSE_EPSILON_WAN) {
          unknownZeroExpenses.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            commitmentId: commitment.id,
            responsibilityKey: commitmentKey(commitment),
            responsibilityKind: responsibilityKind(commitment),
            factStatus: commitmentFactStatus(commitment)
          });
        }
        if (hasMortgageService(node)
          && commitment.type === "housing"
          && hasMortgageMarker(commitment)) {
          mortgageExpenseDoubleCounts.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            commitmentId: commitment.id,
            responsibilityKey: commitmentKey(commitment),
            monthlyAmountWan: activeMonthlyAmount(commitment)
          });
        }
      }
      for (const commitment of activeOrPausedCommitments(node)) {
        const dueAtAgeInMonths = reviewDueAt(commitment);
        const currentAgeInMonths = ageInMonths(node);
        if (currentAgeInMonths === undefined
          || dueAtAgeInMonths === undefined
          || currentAgeInMonths < dueAtAgeInMonths
          || reviewedAtCurrentNode(commitment, node)
          || hasStableExpenseReviewIssue(node, commitment)) continue;
        staleExpensesWithoutReview.push({
          caseSlug: record.caseSlug,
          nodeIndex,
          commitmentId: commitment.id,
          responsibilityKey: commitmentKey(commitment),
          responsibilityKind: responsibilityKind(commitment),
          status: commitment.status,
          dueAtAgeInMonths,
          ageInMonths: currentAgeInMonths
        });
      }
      for (const duplicate of collectDuplicateAmountSources(node)) {
        amountSourceDoubleCounts.push({ caseSlug: record.caseSlug, nodeIndex, ...duplicate });
      }

      if (previousNode && hasExpenseSnapshot(previousNode) && hasExpenseSnapshot(node)) {
        const currentByKey = commitmentByResponsibilityKey(node);
        for (const previous of activeCommitments(previousNode)) {
          const key = commitmentKey(previous);
          if (!key) continue;
          const current = currentByKey.get(key);
          const previousAmount = activeMonthlyAmount(previous);
          const currentAmount = activeMonthlyAmount(current);
          if (responsibilityKind(previous) !== "legacy_aggregate"
            && current?.status === "active"
            && currentAmount < previousAmount - EXPENSE_EPSILON_WAN
            && !hasAcceptedDownwardExpenseAuthority(current)) {
            baselineDownwardOverwrites.push({
              caseSlug: record.caseSlug,
              nodeIndex,
              commitmentId: current.id,
              responsibilityKey: key,
              responsibilityKind: responsibilityKind(current),
              beforeMonthlyAmountWan: previousAmount,
              afterMonthlyAmountWan: currentAmount,
              beforeAmountBasis: previous.amountBasis ?? null,
              afterAmountBasis: current.amountBasis ?? null
            });
          }
          if (responsibilityKind(previous) !== "legacy_aggregate") continue;
          const currentComponents = activeCommitments(node)
            .filter((commitment) => responsibilityKind(commitment) !== "legacy_aggregate");
          const aggregateChanged = !current
            || current.status !== "active"
            || currentAmount < previousAmount - EXPENSE_EPSILON_WAN;
          if (!aggregateChanged) continue;
          const postSplitMonthlyAmountWan = round(currentAmount + activeNonAggregateMonthlyAmount(node));
          if (postSplitMonthlyAmountWan >= previousAmount - EXPENSE_EPSILON_WAN
            || hasAcceptedAggregateSplitAuthority([current, ...currentComponents].filter(Boolean))) continue;
          aggregateSplitLosses.push({
            caseSlug: record.caseSlug,
            nodeIndex,
            aggregateCommitmentId: previous.id,
            aggregateResponsibilityKey: key,
            beforeMonthlyAmountWan: previousAmount,
            afterMonthlyAmountWan: postSplitMonthlyAmountWan,
            componentResponsibilityKeys: currentComponents.map((commitment) => commitmentKey(commitment))
          });
        }
      }
      const durationMonths = nodeDurationMonths(node, history[nodeIndex - 1]);
      const unclassifiedCommitment = commitments.find((commitment) => (
        commitment?.status === "active" && responsibilityKind(commitment) === "unclassified_core_consumption"
      ));
      const activeMonthlyExpenseWan = round(commitments.reduce((sum, commitment) => sum + activeMonthlyAmount(commitment), 0));
      const unclassifiedMonthlyExpenseWan = activeMonthlyAmount(unclassifiedCommitment);
      const knownTypedMonthlyExpenseWan = round(commitments
        .filter((commitment) => isMaterialExpenseResponsibility(commitment) && commitmentFactStatus(commitment) === "known")
        .reduce((sum, commitment) => sum + activeMonthlyAmount(commitment), 0));
      activeExpenseWanMonths = round(activeExpenseWanMonths + activeMonthlyExpenseWan * durationMonths);
      knownTypedExpenseWanMonths = round(knownTypedExpenseWanMonths + knownTypedMonthlyExpenseWan * durationMonths);
      if (unclassifiedCommitment) {
        unclassifiedExpenseSnapshotCount += 1;
        unclassifiedExpenseMonths += durationMonths;
        routeUnclassifiedExpenseMonths += durationMonths;
        unclassifiedExpenseWanMonths = round(unclassifiedExpenseWanMonths + unclassifiedMonthlyExpenseWan * durationMonths);
      }
      const onlyFloor = systemFloorOnly(node) && (ageInMonths(node) || 0) >= 18 * 12;
      if (onlyFloor) {
        currentFloorStreakMonths += durationMonths;
        routeFloorOnlyAdultMonths += durationMonths;
        systemFloorOnlyAdultMonths += durationMonths;
        routeMaxFloorOnlyStreakMonths = Math.max(routeMaxFloorOnlyStreakMonths, currentFloorStreakMonths);
        maxSystemFloorOnlyStreakMonths = Math.max(maxSystemFloorOnlyStreakMonths, currentFloorStreakMonths);
      } else {
        currentFloorStreakMonths = 0;
      }
      floorRows.push({
        caseSlug: record.caseSlug,
        nodeIndex,
        ageInMonths: ageInMonths(node),
        durationMonths,
        annualCoreExpenseWan: annualExpense ?? null,
        systemFloorOnlyAdult: onlyFloor
      });
    }
    const terminal = terminalExpenseState(history);
    const terminalCommitments = nodeLedger(history.at(-1)).expenseCommitments || [];
    const routeEvents = events;
    const familyWindows = routeEvents
      .filter((event) => FAMILY_RESPONSIBILITY_KINDS.has(event.responsibilityKind))
      .map((event) => ({
        ...event,
        before: expenseWindow(history.slice(Math.max(0, event.nodeIndex - 3), event.nodeIndex)),
        after: expenseWindow(history.slice(event.nodeIndex, Math.min(history.length, event.nodeIndex + 3)))
      }));
    routeDiagnostics.push({
      caseSlug: record.caseSlug,
      flow,
      systemFloorOnlyAdultMonths: routeFloorOnlyAdultMonths,
      maxSystemFloorOnlyStreakMonths: routeMaxFloorOnlyStreakMonths,
      unclassifiedExpenseMonths: routeUnclassifiedExpenseMonths,
      lifecycleEventCount: routeEvents.length,
      lifecycleEvents: routeEvents,
      familyResponsibilityRunRateWindows: familyWindows,
      terminalExpenseState: terminal,
      responsibilityLifecycleByKind: lifecycleCountsByKind(routeEvents, { commitments: terminalCommitments, state: terminal })
    });
  }

  const distribution = [...annualDistribution.values()]
    .sort((left, right) => right.nodeCount - left.nodeCount || left.annualCoreExpenseWan - right.annualCoreExpenseWan)
    .map((item) => ({
      ...item,
      nodeRatePct: percent(item.nodeCount, annualExpenseObservedNodeCount)
    }));
  const factStatusSnapshotRatePct = Object.fromEntries(FACT_STATUSES.map((status) => [
    status,
    percent(factStatusSnapshotCounts[status], activeFactStatusSnapshotCount)
  ]));
  const eventCountsByAction = Object.fromEntries(RESPONSIBILITY_ACTIONS.map((action) => [
    action,
    lifecycleEvents.filter((event) => event.action === action).length
  ]));
  const terminalStatuses = routeDiagnostics.map((route) => ({
    caseSlug: route.caseSlug,
    ...route.terminalExpenseState
  }));
  const overdueByKind = {};
  for (const route of terminalStatuses) {
    for (const overdue of route.overdue) increment(overdueByKind, overdue.responsibilityKind);
  }
  const familyResponsibilityRunRateWindows = routeDiagnostics.flatMap((route) => route.familyResponsibilityRunRateWindows);
  const incompleteFamilyWindows = familyResponsibilityRunRateWindows.filter((window) => (
    window.before.status !== "observed" || window.after.status !== "observed"
  )).length;
  const observedFamilyWindows = familyResponsibilityRunRateWindows.filter((window) => (
    window.before.annualizedCoreExpenseRunRateWan !== null || window.after.annualizedCoreExpenseRunRateWan !== null
  )).length;
  const flowRoutes = routeDiagnostics.filter((route) => route.flow.periodSummaryStatus !== "not_covered");
  const aggregateFlow = (field) => flowRoutes.length === 0
    ? null
    : round(flowRoutes.reduce((sum, route) => sum + Number(route.flow[field] || 0), 0));
  const aggregateIncome = aggregateFlow("cumulativeIncomeWan");
  const aggregateSavings = aggregateFlow("cumulativeSavingsWan");
  const flowStatus = flowRoutes.length === 0
    ? "not_covered"
    : flowRoutes.length === routeDiagnostics.length && routeDiagnostics.every((route) => route.flow.periodSummaryStatus === "covered")
      ? "covered"
      : "partial";
  const responsibilityLifecycleByKind = lifecycleCountsByKind(
    lifecycleEvents,
    {
      commitments: terminalStatuses.flatMap((route) => {
        const terminalRecord = routeRecords.find((record) => record.caseSlug === route.caseSlug);
        return nodeLedger(terminalRecord?.history?.at(-1)).expenseCommitments || [];
      }),
      state: { overdue: terminalStatuses.flatMap((route) => route.overdue) }
    }
  );
  const expenseInvariantAuditStatus = expenseSnapshotObservedNodeCount === 0 ? "not_covered" : "observed";
  const observedInvariantCount = (items) => expenseInvariantAuditStatus === "not_covered" ? null : items.length;

  return {
    summary: {
      annualCoreExpenseDistributionStatus: annualExpenseObservedNodeCount === 0 ? "not_covered" : "observed",
      annualCoreExpenseObservedNodeCount: annualExpenseObservedNodeCount,
      annualCoreExpenseMissingNodeCount: annualExpenseMissingNodeCount,
      annualCoreExpenseDistribution: distribution,
      annualCoreExpenseConcentrationPct: annualExpenseObservedNodeCount === 0 ? null : distribution[0]?.nodeRatePct ?? null,
      annualCoreExpenseModeWan: annualExpenseObservedNodeCount === 0 ? null : distribution[0]?.annualCoreExpenseWan ?? null,
      systemFloorOnlyAdultMonths,
      maxSystemFloorOnlyStreakMonths,
      systemFloorOnlyAdultStatus: floorRows.length === 0 ? "not_covered" : "observed",
      unclassifiedExpenseSnapshotCount,
      unclassifiedExpenseMonths,
      unclassifiedExpenseSharePct: percent(unclassifiedExpenseWanMonths, activeExpenseWanMonths),
      knownTypedExpenseSharePct: percent(knownTypedExpenseWanMonths, activeExpenseWanMonths),
      unclassifiedExpenseStatus: expenseSnapshotObservedNodeCount === 0 ? "not_covered" : "observed",
      activeExpenseFactStatusSnapshotCount: activeFactStatusSnapshotCount,
      activeExpenseFactStatusSnapshotCounts: factStatusSnapshotCounts,
      activeExpenseFactStatusSnapshotRatePct: factStatusSnapshotRatePct,
      activeExpenseFactStatusSnapshotStatus: activeFactStatusSnapshotCount === 0 ? "not_covered" : "observed",
      responsibilityLifecycleEventCount: lifecycleEvents.length,
      responsibilityLifecycleEventCountsByAction: eventCountsByAction,
      responsibilityLifecycleByKind,
      overdueExpenseReviewAccountCount: terminalStatuses.reduce((sum, item) => sum + item.overdue.length, 0),
      overdueExpenseReviewByResponsibilityKind: overdueByKind,
      finalExpenseStateRouteCount: terminalStatuses.filter((item) => item.status !== "not_covered").length,
      finalExpenseStateStatus: terminalStatuses.length === 0 ? "not_covered" : "observed",
      familyResponsibilityRunRateWindowCount: familyResponsibilityRunRateWindows.length,
      familyResponsibilityRunRateWindowStatus: familyResponsibilityRunRateWindows.length === 0
        ? "not_covered"
        : observedFamilyWindows === 0 ? "not_covered"
          : incompleteFamilyWindows > 0 ? "partial" : "observed",
      familyResponsibilityRunRateIncompleteWindowCount: incompleteFamilyWindows,
      routeCumulativeFinancialsStatus: flowStatus,
      cumulativeIncomeWan: aggregateIncome,
      cumulativeCoreExpenseWan: aggregateFlow("cumulativeCoreExpenseWan"),
      cumulativeOtherExpenseWan: aggregateFlow("cumulativeOtherExpenseWan"),
      cumulativeOneOffExpenseWan: aggregateFlow("cumulativeOneOffExpenseWan"),
      cumulativeDebtPrincipalPaidWan: aggregateFlow("cumulativeDebtPrincipalPaidWan"),
      cumulativeDebtInterestPaidWan: aggregateFlow("cumulativeDebtInterestPaidWan"),
      cumulativeDebtServiceWan: aggregateFlow("cumulativeDebtServiceWan"),
      cumulativeNetCashFlowWan: aggregateFlow("cumulativeNetCashFlowWan"),
      cumulativeSavingsWan: aggregateSavings,
      cumulativeSavingsRatePct: aggregateIncome && aggregateIncome > 0 ? percent(aggregateSavings, aggregateIncome) : null,
      cumulativeSavingsRateStatus: aggregateIncome && aggregateIncome > 0 ? flowStatus : "not_covered",
      expenseInvariantAuditStatus,
      expenseBindingTelemetryStatus: expenseBindingTelemetryObservedNodeCount > 0 ? "observed" : "not_covered",
      expenseBindingTelemetryObservedNodeCount,
      acceptedNodeWithUnresolvedMaterialExpenseBindingCount: expenseBindingTelemetryObservedNodeCount > 0
        ? acceptedNodesWithUnresolvedMaterialExpenseBindings.length
        : null,
      expenseBindingSourceIdentityMissingCount: expenseBindingTelemetryObservedNodeCount > 0
        ? bindingSourceIdentityMissing.reduce((sum, item) => sum + item.count, 0)
        : null,
      expenseBindingTelemetryIncompleteCount: expenseBindingTelemetryObservedNodeCount > 0
        ? bindingTelemetryIncomplete.length
        : null,
      expenseConfirmationRejectedAfterSanitizeCount: expenseBindingTelemetryObservedNodeCount > 0
        ? postSanitizeConfirmationRejections.reduce((sum, item) => sum + item.count, 0)
        : null,
      unknownLiabilityPersonalCommitmentCount: observedInvariantCount(unknownLiabilityPersonalCommitments),
      knownWithoutExplicitAmountEvidenceCount: observedInvariantCount(knownWithoutExplicitAmountEvidence),
      policyFloorPromotedToKnownCount: observedInvariantCount(policyFloorPromotedToKnown),
      expenseAmountSourceUntraceableCount: observedInvariantCount(untraceableAmountSources),
      confirmedResponsibilityWithoutNonzeroAccrualCount: observedInvariantCount(confirmedResponsibilitiesWithoutNonzeroAccrual),
      expenseConfirmationAuthorityViolationCount: observedInvariantCount(expenseConfirmationAuthorityViolations),
      reviewResolutionWithoutAcceptedOutcomeCount: observedInvariantCount(reviewResolutionsWithoutAcceptedOutcome),
      reviewDueWithoutAcceptedDispositionCount: expenseSnapshotObservedNodeCount === 0
        ? null
        : terminalStatuses.reduce((sum, item) => (
          sum + item.overdue.filter((overdue) => overdue.acceptedDispositionRequired).length
        ), 0),
      policyOwnedExpenseReviewOutstandingCount: expenseSnapshotObservedNodeCount === 0
        ? null
        : terminalStatuses.reduce((sum, item) => (
          sum + item.overdue.filter((overdue) => !overdue.acceptedDispositionRequired).length
        ), 0),
      annualCoreExpenseDerivationMismatchCount: observedInvariantCount(annualCoreExpenseDerivationMismatches),
      expenseInvariantObservedNodeCount: expenseSnapshotObservedNodeCount,
      expenseBaselineDownwardOverwriteCount: observedInvariantCount(baselineDownwardOverwrites),
      expenseUnknownZeroCount: observedInvariantCount(unknownZeroExpenses),
      staleExpenseWithoutReviewCount: observedInvariantCount(staleExpensesWithoutReview),
      expenseAggregateSplitLossCount: observedInvariantCount(aggregateSplitLosses),
      expenseAmountSourceDoubleCount: observedInvariantCount(amountSourceDoubleCounts),
      mortgageExpenseDoubleCountCount: observedInvariantCount(mortgageExpenseDoubleCounts)
    },
    details: {
      routeDiagnostics,
      floorRows,
      lifecycleEvents,
      familyResponsibilityRunRateWindows,
      terminalExpenseStates: terminalStatuses,
      baselineDownwardOverwrites,
      unknownZeroExpenses,
      staleExpensesWithoutReview,
      aggregateSplitLosses,
      amountSourceDoubleCounts,
      mortgageExpenseDoubleCounts,
      acceptedNodesWithUnresolvedMaterialExpenseBindings,
      bindingSourceIdentityMissing,
      bindingTelemetryIncomplete,
      postSanitizeConfirmationRejections,
      unknownLiabilityPersonalCommitments,
      knownWithoutExplicitAmountEvidence,
      policyFloorPromotedToKnown,
      untraceableAmountSources,
      confirmedResponsibilitiesWithoutNonzeroAccrual,
      expenseConfirmationAuthorityViolations,
      reviewResolutionsWithoutAcceptedOutcome,
      annualCoreExpenseDerivationMismatches
    }
  };
}

const RELEASE_EXPENSE_INVARIANT_FIELDS = [
  ["expenseBaselineDownwardOverwriteCount", "无下降证据却静默下调持续支出"],
  ["expenseUnknownZeroCount", "已存在的未知支出责任被按零计提"],
  ["staleExpenseWithoutReviewCount", "到期支出未复核且没有 review issue"],
  ["expenseAggregateSplitLossCount", "支出总额拆分后发生无证据下降"],
  ["expenseAmountSourceDoubleCount", "同一支出金额事实被重复计提"],
  ["mortgageExpenseDoubleCountCount", "房贷同时进入 debt service 与 housing"],
  ["acceptedNodeWithUnresolvedMaterialExpenseBindingCount", "enforced 节点仍带未解决重大支出 binding"],
  ["expenseBindingSourceIdentityMissingCount", "production binding 缺少稳定 source identity"],
  ["expenseBindingTelemetryIncompleteCount", "production binding 缺少分句、span 或最终 disposition telemetry"],
  ["expenseConfirmationRejectedAfterSanitizeCount", "最终正文清洗后支出确认失效"],
  ["unknownLiabilityPersonalCommitmentCount", "付款责任未知却进入个人 active 支出"],
  ["knownWithoutExplicitAmountEvidenceCount", "known 支出缺少 explicit amount basis"],
  ["policyFloorPromotedToKnownCount", "policy floor 被提升为 known"],
  ["expenseAmountSourceUntraceableCount", "分类持续支出缺少 amountSourceId"],
  ["confirmedResponsibilityWithoutNonzeroAccrualCount", "已确认持续支出没有非零计提"],
  ["expenseConfirmationAuthorityViolationCount", "known 精确支出缺少 Accepted 权威证据"],
  ["reviewResolutionWithoutAcceptedOutcomeCount", "支出复核未由 Accepted Event 关闭"],
  ["reviewDueWithoutAcceptedDispositionCount", "需权威处置的到期支出复核没有 Accepted disposition"],
  ["annualCoreExpenseDerivationMismatchCount", "年化核心支出与 active 账户求和不一致"]
];

/**
 * These are deterministic authority invariants, rather than diagnostic
 * distribution metrics.  A certification cannot treat an unobserved audit as
 * a zero count: otherwise a route without expense snapshots could turn the
 * lifecycle gate green by omission.
 */
export function expenseLifecycleReleaseBlockers(summary = {}) {
  const blockers = [];
  if (summary.expenseInvariantAuditStatus !== "observed") {
    blockers.push("支出事实不变量未被观察到，无法证明没有静默低估或重复计提");
  } else {
    for (const [field, description] of RELEASE_EXPENSE_INVARIANT_FIELDS) {
      const count = summary[field];
      if (!Number.isFinite(count)) {
        blockers.push(`支出事实不变量 ${field} 缺少可核验计数`);
      } else if (count > 0) {
        blockers.push(`${description}：${count} 个节点`);
      }
    }
  }

  if (summary.adultBaselineOnlyAfterResponsibilityStatus !== "observed") {
    blockers.push("成人责任后的 basic floor 审计未被观察到，无法证明责任支出没有丢失");
  } else if (!Number.isFinite(summary.adultBaselineOnlyAfterResponsibilityCount)) {
    blockers.push("成人责任后的 basic floor 审计缺少可核验计数");
  } else if (summary.adultBaselineOnlyAfterResponsibilityCount > 0) {
    blockers.push(`已有家庭、住房或医疗责任却只剩 basic floor：${summary.adultBaselineOnlyAfterResponsibilityCount} 个节点`);
  }
  return blockers;
}

export function auditExpenseResponsibilities({ annotations = [], routeRecords = [], detectedCandidates = [] }) {
  const nodes = new Map();
  for (const record of routeRecords) {
    for (const [nodeIndex, node] of (record.history || []).entries()) nodes.set(`${record.caseSlug}|${nodeIndex}`, node);
  }
  const material = annotations.filter((item) => item.material !== false && item.expectedAction !== "ignore");
  // Negative annotations remain part of precision even though they are not
  // part of the material-recall denominator.
  const allAnnotated = annotations;
  const candidates = detectedCandidates.length > 0
    ? detectedCandidates
    : collectCommittedResponsibilityCandidates({ routeRecords, annotations: allAnnotated });
  const detectedByKey = new Map();
  for (const candidate of candidates) detectedByKey.set(expenseResponsibilityKey(candidate), candidate);
  const truePositiveAnnotations = material.filter((annotation) => {
    const { current, previous } = annotationNodes(nodes, annotation);
    return expectedMatch(annotation, current, previous);
  });
  const explicitRecurringAnnotations = material.filter((annotation) => Number.isFinite(Number(annotation.expectedMonthlyAmountWan)));
  const explicitRecurringTruePositives = truePositiveAnnotations.filter((annotation) => Number.isFinite(Number(annotation.expectedMonthlyAmountWan)));
  const truePositiveKeys = new Set(truePositiveAnnotations.map((annotation) => expenseResponsibilityKey({
    caseSlug: annotation.caseSlug,
    nodeIndex: annotation.nodeIndex,
    responsibilityKey: annotation.expectedResponsibilityKey,
    action: annotation.expectedAction,
    financialScope: annotation.expectedScope
  })));
  const missed = material.filter((annotation) => !truePositiveKeys.has(expenseResponsibilityKey({
    caseSlug: annotation.caseSlug,
    nodeIndex: annotation.nodeIndex,
    responsibilityKey: annotation.expectedResponsibilityKey,
    action: annotation.expectedAction,
    financialScope: annotation.expectedScope
  })));
  const falsePositives = candidates.filter((candidate) => !allAnnotated.some((annotation) => (
    candidateMatchesAnnotation(candidate, annotation, nodes)
  )));

  const scopeMismatch = [];
  const sharedAmountMismatch = [];
  const floorOnlyAfterResponsibility = [];
  const highAgeCareResponsibilities = [];
  const floorRows = [];
  let adultBaselineObservedNodeCount = 0;
  for (const record of routeRecords) {
    const annotationsByNodeIndex = new Map();
    for (const annotation of annotations.filter((item) => item.caseSlug === record.caseSlug)) {
      const entries = annotationsByNodeIndex.get(annotation.nodeIndex) || [];
      entries.push(annotation);
      annotationsByNodeIndex.set(annotation.nodeIndex, entries);
    }
    // This intentionally survives a snapshot where a prior commitment is
    // silently dropped.  The old same-node implementation asked whether a
    // node was both "has a material account" and "only floor", which is
    // logically impossible and therefore guaranteed a false green.
    const materialResponsibilityHistory = new Map();
    for (const [nodeIndex, node] of (record.history || []).entries()) {
      const commitments = activeCommitments(node);
      if (hasExpenseSnapshot(node)) adultBaselineObservedNodeCount += 1;
      for (const annotation of annotationsByNodeIndex.get(nodeIndex) || []) {
        if (annotation.material === false || annotation.expectedAction === "ignore") continue;
        const key = annotation.expectedResponsibilityKey
          || `annotation:${nodeIndex}:${annotation.expectedType || "unclassified"}`;
        const isBasicFloorAnnotation = annotation.expectedType === "basic_living"
          || key.startsWith("adult_basic_living:");
        if (isBasicFloorAnnotation) continue;
        materialResponsibilityHistory.set(key, {
          status: annotation.expectedAction === "end" ? "ended" : "active",
          source: "human_annotation"
        });
      }
      for (const commitment of nodeLedger(node).expenseCommitments || []) {
        if (!isMaterialExpenseResponsibility(commitment)) continue;
        const key = commitmentKey(commitment);
        if (!key) continue;
        materialResponsibilityHistory.set(key, {
          status: commitment.status === "ended" ? "ended" : commitment.status === "paused" ? "paused" : "active",
          source: "committed_ledger"
        });
      }
      for (const commitment of commitments) {
        if (!["personal", "shared_household"].includes(financialScope(commitment))) {
          scopeMismatch.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id, scope: financialScope(commitment) });
        }
        if (commitment.grossMonthlyAmountWan !== undefined && commitment.householdShareRate !== undefined
          && Math.abs(Number(commitment.monthlyAmountWan) - Number(commitment.grossMonthlyAmountWan) * Number(commitment.householdShareRate)) > 0.005) {
          sharedAmountMismatch.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id });
        }
        const age = nodeAgeInMonths(node) || 0;
        if (age >= 65 * 12 && ["recurring_healthcare", "elder_care"].includes(commitment.responsibilityKind)
          && (commitment.evidence || []).some((evidence) => /HEALTH|CARE|治疗|用药|护工|照护/u.test(`${evidence.reasonCode || ""} ${evidence.excerpt || ""}`))) {
          highAgeCareResponsibilities.push({ caseSlug: record.caseSlug, nodeIndex, commitmentId: commitment.id, responsibilityKind: commitment.responsibilityKind });
        }
      }
      const annual = Number(node.financialState?.annualCoreExpenseWan ?? 0);
      const onlyFloor = commitments.length === 1
        && commitments[0].responsibilityKind === "adult_basic_living"
        && Math.abs(Number(commitments[0].monthlyAmountWan) - 0.35) < 0.005;
      const outstandingMaterialResponsibilities = [...materialResponsibilityHistory.entries()]
        .filter(([, value]) => value.status === "active");
      if (onlyFloor && outstandingMaterialResponsibilities.length > 0) {
        floorOnlyAfterResponsibility.push({
          caseSlug: record.caseSlug,
          nodeIndex,
          durationMonths: nodeDurationMonths(node, record.history[nodeIndex - 1]),
          materialResponsibilityKeys: outstandingMaterialResponsibilities.map(([key]) => key),
          materialResponsibilitySources: outstandingMaterialResponsibilities.map(([, value]) => value.source)
        });
      }
      floorRows.push({ caseSlug: record.caseSlug, nodeIndex, annualCoreExpenseWan: annual, onlyFloor });
    }
  }
  const floorStreaks = new Map();
  for (const row of floorRows) {
    const prior = floorStreaks.get(row.caseSlug) || 0;
    floorStreaks.set(row.caseSlug, row.onlyFloor ? prior + 1 : 0);
  }
  const annotationCount = material.length;
  const detectedCandidateCount = candidates.length;
  const personalLiabilityRejectedAsBusinessOrThirdParty = material.filter((annotation) => (
    ["personal", "shared_household"].includes(annotation.expectedScope)
    && candidates.some((candidate) => (
      candidate.caseSlug === annotation.caseSlug
      && candidate.nodeIndex === annotation.nodeIndex
      && candidate.responsibilityKey === annotation.expectedResponsibilityKey
      && candidate.action === annotation.expectedAction
      && ["business_operating", "third_party"].includes(candidate.financialScope)
    ))
  ));
  const nonPersonalCommittedAsPersonal = annotations.filter((annotation) => {
    if (annotation.expectedAction !== "ignore"
      || !["business_operating", "third_party"].includes(annotation.expectedScope)) return false;
    const { current } = annotationNodes(nodes, annotation);
    const commitment = commitmentFor(current, annotation.expectedResponsibilityKey);
    return commitment && ["personal", "shared_household"].includes(financialScope(commitment));
  });
  return {
    expenseResponsibilityAnnotatedCandidateCount: annotationCount,
    expenseResponsibilityTruePositiveCount: truePositiveAnnotations.length,
    expenseResponsibilityMissedCount: missed.length,
    expenseResponsibilityFalsePositiveCount: falsePositives.length,
    expenseResponsibilityDetectedCandidateCount: detectedCandidateCount,
    expenseResponsibilityScopeMismatchCount: scopeMismatch.length,
    expenseSharedAmountMismatchCount: sharedAmountMismatch.length,
    explicitRecurringExpenseCandidateCount: explicitRecurringAnnotations.length,
    explicitRecurringExpenseTruePositiveCount: explicitRecurringTruePositives.length,
    explicitRecurringExpenseCoveragePct: percent(explicitRecurringTruePositives.length, explicitRecurringAnnotations.length),
    explicitRecurringExpenseCoverageStatus: explicitRecurringAnnotations.length === 0
      ? "not_covered"
      : explicitRecurringTruePositives.length === explicitRecurringAnnotations.length ? "covered" : "incomplete",
    adultBaselineOnlyAfterResponsibilityCount: adultBaselineObservedNodeCount === 0 ? null : floorOnlyAfterResponsibility.length,
    materialResponsibilityPresentButFloorOnlyMonths: annotationCount === 0
      ? null
      : floorOnlyAfterResponsibility.reduce((sum, item) => sum + Number(item.durationMonths || 0), 0),
    adultBaselineOnlyAfterResponsibilityStatus: adultBaselineObservedNodeCount === 0 ? "not_covered" : "observed",
    highAgeHealthOrCareResponsibilityCount: highAgeCareResponsibilities.length,
    personalLiabilityRejectedAsBusinessOrThirdPartyCount: annotationCount === 0
      ? null
      : personalLiabilityRejectedAsBusinessOrThirdParty.length,
    nonPersonalCommittedAsPersonalCount: annotations.length === 0
      ? null
      : nonPersonalCommittedAsPersonal.length,
    expenseResponsibilityRecallPct: percent(truePositiveAnnotations.length, annotationCount),
    expenseResponsibilityPrecisionPct: percent(detectedCandidateCount - falsePositives.length, detectedCandidateCount),
    coverageStatus: annotationCount === 0 ? "not_covered" : missed.length === 0 ? "covered" : "incomplete",
    precisionStatus: detectedCandidateCount === 0 ? "not_covered" : falsePositives.length === 0 ? "covered" : "incomplete",
    details: {
      missed,
      falsePositives,
      scopeMismatch,
      sharedAmountMismatch,
      floorOnlyAfterResponsibility,
      highAgeCareResponsibilities,
      personalLiabilityRejectedAsBusinessOrThirdParty,
      nonPersonalCommittedAsPersonal,
      detectedCandidates: candidates
    }
  };
}
