import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Bind independent adjudication to reviewer-visible input only. Internal Gold
 * labels must be free to change in response to the review without invalidating
 * the review of an unchanged narrative set.
 */
export function financialExpenseClauseBlindSourceSha256(corpus) {
  if (!corpus?.corpusId || !Array.isArray(corpus.examples) || corpus.examples.length === 0) {
    throw new Error("Clause corpus must contain id and examples");
  }
  return sha256(JSON.stringify({
    corpusId: corpus.corpusId,
    examples: corpus.examples.map(({ id, narrative }) => ({ id, narrative }))
  }));
}

/**
 * Produce an adjudication packet that cannot leak detector output or the
 * implementation-authored expected contract to an independent reviewer.
 */
export function buildFinancialExpenseClauseBlindPacket({ corpus, sourceSha256 }) {
  if (!corpus || !Array.isArray(corpus.examples) || corpus.examples.length === 0) {
    throw new Error("Clause corpus must contain at least one example");
  }
  if (!/^[a-f0-9]{64}$/u.test(sourceSha256 || "")) {
    throw new Error("sourceSha256 must be a lowercase SHA-256 digest");
  }
  const seen = new Set();
  const examples = corpus.examples.map((example) => {
    if (!example.id || !example.narrative) throw new Error("Every blind example requires id and narrative");
    if (seen.has(example.id)) throw new Error(`Duplicate blind example id: ${example.id}`);
    seen.add(example.id);
    return {
      id: example.id,
      narrative: example.narrative,
      narrativeSha256: sha256(example.narrative),
      reviewed: false,
      annotations: []
    };
  });
  return {
    schemaVersion: 1,
    packetKind: "financial_expense_clause_independent_blind_adjudication",
    source: {
      corpusId: corpus.corpusId,
      corpusRevision: corpus.revision,
      corpusSha256: sourceSha256
    },
    reviewerDeclaration: {
      reviewerId: "",
      reviewedAt: "",
      method: "independent_blind",
      detectorOutputConsulted: false,
      proposalLedgerAuditConsulted: false
    },
    annotationContract: {
      coordinateSystem: "UTF-16 half-open [start,end)",
      requiredFields: [
        "annotationId",
        "disposition",
        "responsibilityKey",
        "responsibilityKind",
        "completion",
        "cadence",
        "liability",
        "financialScope",
        "spans.responsibility"
      ],
      optionalFields: [
        "grossMonthlyAmountWan",
        "protagonistMonthlyAmountWan",
        "householdShareRate",
        "spans.completion",
        "spans.payer",
        "spans.amount",
        "spans.cadence",
        "notes"
      ],
      dispositionValues: ["material", "review", "ignore"],
      instruction: "Annotate only facts visible in the narrative. Do not inspect detector, proposal, ledger, audit, or expected-output files. Leave annotations empty only when the narrative contains no expense responsibility fact."
    },
    examples
  };
}

function normalizeSpan(narrative, span, label) {
  const [start, end, excerpt] = Array.isArray(span)
    ? [span[0], span[1], narrative.slice(span[0], span[1])]
    : [span?.start, span?.end, span?.excerpt];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new Error(`${label} requires a valid UTF-16 half-open span`);
  }
  if (narrative.slice(start, end) !== excerpt) {
    throw new Error(`${label} excerpt does not match narrative offsets`);
  }
  return { start, end, excerpt };
}

/** Validate only the independent review record, never the detector result. */
export function validateFinancialExpenseClauseBlindAdjudication({ packet, corpus, sourceSha256 }) {
  if (packet?.packetKind !== "financial_expense_clause_independent_blind_adjudication") {
    throw new Error("Unexpected blind adjudication packet kind");
  }
  if (packet.source?.corpusId !== corpus.corpusId
    || packet.source?.corpusSha256 !== sourceSha256) {
    throw new Error("Blind adjudication source identity does not match the frozen corpus");
  }
  const declaration = packet.reviewerDeclaration || {};
  if (!declaration.reviewerId?.trim() || !declaration.reviewedAt?.trim()) {
    throw new Error("Independent reviewer identity and reviewedAt are required");
  }
  if (declaration.method !== "independent_blind"
    || declaration.detectorOutputConsulted !== false
    || declaration.proposalLedgerAuditConsulted !== false) {
    throw new Error("Reviewer declaration does not satisfy independent blind protocol");
  }
  const expectedById = new Map(corpus.examples.map((example) => [example.id, example]));
  if (packet.examples?.length !== expectedById.size) throw new Error("Blind adjudication example count mismatch");
  const seenExamples = new Set();
  const seenAnnotations = new Set();
  const dispositionCounts = { material: 0, review: 0, ignore: 0 };
  for (const example of packet.examples || []) {
    const source = expectedById.get(example.id);
    if (!source || seenExamples.has(example.id)) throw new Error(`Unknown or duplicate adjudication example: ${example.id}`);
    seenExamples.add(example.id);
    if (example.narrative !== source.narrative || example.narrativeSha256 !== sha256(source.narrative)) {
      throw new Error(`Narrative identity mismatch for ${example.id}`);
    }
    if (example.reviewed !== true) throw new Error(`Example ${example.id} is not marked reviewed`);
    if (!Array.isArray(example.annotations)) throw new Error(`Example ${example.id} annotations must be an array`);
    for (const annotation of example.annotations) {
      const annotationIdentity = `${example.id}:${annotation.annotationId || ""}`;
      if (!annotation.annotationId || seenAnnotations.has(annotationIdentity)) {
        throw new Error(`Missing or duplicate annotationId in ${example.id}`);
      }
      seenAnnotations.add(annotationIdentity);
      if (!Object.hasOwn(dispositionCounts, annotation.disposition)) {
        throw new Error(`Invalid disposition in ${annotation.annotationId}`);
      }
      dispositionCounts[annotation.disposition] += 1;
      if (annotation.disposition !== "ignore") {
        for (const field of ["responsibilityKey", "responsibilityKind", "completion", "cadence", "liability", "financialScope"]) {
          if (!annotation[field]) throw new Error(`${annotation.annotationId} missing ${field}`);
        }
      }
      if (!annotation.spans?.responsibility) throw new Error(`${annotation.annotationId} missing responsibility span`);
      for (const [field, span] of Object.entries(annotation.spans)) {
        normalizeSpan(example.narrative, span, `${example.id}.${annotation.annotationId}.${field}`);
      }
    }
  }
  return {
    status: dispositionCounts.material >= 20 ? "review_complete" : "insufficient_material_coverage",
    reviewedExampleCount: seenExamples.size,
    annotationCount: seenAnnotations.size,
    dispositionCounts
  };
}
