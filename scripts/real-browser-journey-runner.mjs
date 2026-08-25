import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { summarizeCacheUsage } from "./lib/cache-usage-telemetry.mjs";

export const FINAL_IMAGE_VIEWPORT = Object.freeze({ width: 1280, height: 900 });

export async function waitForUniqueLocator({ locator, label, wait, attempts = 40 }) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const count = await locator.count();
    if (count === 1) return locator;
    if (count > 1) throw new Error(`Expected one ${label}, got ${count}`);
    if (attempt + 1 < attempts) await wait();
  }
  throw new Error(`Expected one ${label}, got 0`);
}
const execFileAsync = promisify(execFile);
const CANDIDATE_MANIFEST_NAME = "candidate-manifest.json";

function now() {
  return new Date().toISOString();
}

function sourceIdentityFromCandidate(candidate) {
  const sourceIdentity = {
    candidateId: candidate?.candidateId,
    sourceCommit: candidate?.sourceCommit,
    runtimeFingerprint: candidate?.runtimeFingerprint,
    collectorFingerprint: candidate?.collectorFingerprint
  };
  if (!Object.values(sourceIdentity).every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Candidate manifest is missing a complete source identity");
  }
  return sourceIdentity;
}

function sameSourceIdentity(left, right) {
  return Boolean(left && right
    && left.candidateId === right.candidateId
    && left.sourceCommit === right.sourceCommit
    && left.runtimeFingerprint === right.runtimeFingerprint
    && left.collectorFingerprint === right.collectorFingerprint);
}

export function runtimeIdentityMatchesCandidate({ runtimeIdentity, sourceIdentity }) {
  return !sourceIdentity || sameSourceIdentity(runtimeIdentity, sourceIdentity);
}

export function assertRuntimeIdentityMatchesCandidate({ runtimeIdentity, sourceIdentity }) {
  if (!runtimeIdentityMatchesCandidate({ runtimeIdentity, sourceIdentity })) {
    throw new Error("Browser runtime identity does not match the frozen release candidate");
  }
}

export async function loadRunSourceIdentity(recordRoot) {
  try {
    const manifest = JSON.parse(await readFile(path.join(recordRoot, CANDIDATE_MANIFEST_NAME), "utf8"));
    return sourceIdentityFromCandidate(manifest);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export function buildDevFsImportReference(filePath) {
  if (!path.isAbsolute(filePath)) {
    throw new Error("Checkpoint import path must be absolute");
  }
  return `@file:/@fs${encodeURI(filePath)}`;
}

export function buildCurrentChoiceSelector(choiceId) {
  // Choice ids may repeat in an archived chapter while the current decision
  // area is visible.  Limit the collector to the live decision controls so a
  // retry can never click a historical choice with the same semantic id.
  return `#inline-decision-area #preset-choices-container [id=${JSON.stringify(`choice-btn-${choiceId}`)}]`;
}

export function assertDistinctFinalImageEvidence({ poster, page }) {
  const posterBytes = Buffer.from(poster || []);
  const pageBytes = Buffer.from(page || []);
  if (posterBytes.length === 0 || pageBytes.length === 0) {
    throw new Error("Final poster and report-page evidence must both be non-empty");
  }
  if (posterBytes.equals(pageBytes)) {
    throw new Error("Final poster and report-page evidence are identical viewport captures");
  }
}

export function submittedPersonaMatchesConfig({ config, finalState }) {
  const submitted = finalState?.userData || {};
  return submitted.birthday === config?.birthday
    && submitted.birthtime === config?.birthtime;
}

export function buildFinalPosterCropArgs({ pagePath, posterPath, posterRect }) {
  return [
    "--cropToHeightWidth",
    String(Math.round(posterRect.height)),
    String(Math.round(posterRect.width)),
    "--cropOffset",
    String(Math.round(posterRect.y)),
    String(Math.round(posterRect.x)),
    pagePath,
    "--out",
    posterPath
  ];
}

export function buildFinalImageRestorePayload(saved) {
  const state = saved?.latestState ?? saved;
  if (state?.step !== "insight" || !state?.outcome || !state?.userData || !state?.currentNode) {
    throw new Error("Final-image checkpoint must contain an insight state, outcome, userData, and currentNode");
  }
  const node = state.currentNode;
  return {
    step: state.step,
    userName: state.userName,
    userData: state.userData,
    questions: [],
    answers: [],
    currentAttributes: state.currentAttributes ?? node.attributes,
    currentNode: {
      id: node.id,
      title: node.title,
      description: node.description,
      age: node.age,
      ageInMonths: node.ageInMonths,
      stage: node.stage,
      attributes: node.attributes,
      choices: node.choices,
      selectedChoice: node.selectedChoice,
      isEndingNode: node.isEndingNode,
      reportInvitation: node.reportInvitation
    },
    history: [],
    nodeCount: state.nodeCount,
    simulationSeed: state.simulationSeed,
    outcome: state.outcome
  };
}

export function initializeJourneyTrace({ identity, previousRecord, resume = false }) {
  const previousIdentity = previousRecord?.identity;
  const canResume = resume
    && previousIdentity?.runId === identity.runId
    && previousIdentity?.journeyId === identity.journeyId
    && previousIdentity?.caseSlug === identity.caseSlug
    && previousIdentity?.scenario === identity.scenario
    && Array.isArray(previousRecord?.interactionLog);
  if (canResume) {
    return previousRecord.interactionLog.map((entry) => ({
      ...entry,
      runId: identity.runId,
      journeyId: identity.journeyId
    }));
  }
  return [{
    type: "case_started",
    caseSlug: identity.caseSlug,
    scenario: identity.scenario,
    runId: identity.runId,
    journeyId: identity.journeyId,
    at: identity.startedAt
  }];
}

function invitationIds(values) {
  return values.map((item) => item?.id).filter(Boolean);
}

export function validateJourneyInvitationIsolation({ identity, trace, finalState, expectedInvitations = [] }) {
  const issues = [];
  const validArcIds = new Set((finalState?.history || []).flatMap((item) => (
    item?.worldStateSnapshot?.pressureArcs || []
  )).map((arc) => arc.id));
  for (const arc of finalState?.currentNode?.worldStateSnapshot?.pressureArcs || []) validArcIds.add(arc.id);
  const expectedIds = new Set(invitationIds(expectedInvitations));
  const stateIds = invitationIds(finalState?.invitations || []);
  const traceInvitations = trace.filter((entry) => entry.type?.startsWith("invitation_") && entry.invitation?.id);
  for (const entry of trace) {
    if (entry.journeyId && entry.journeyId !== identity.journeyId) {
      issues.push({ code: "CROSS_JOURNEY_TRACE", id: entry.journeyId });
    }
  }
  for (const entry of traceInvitations) {
    if (!expectedIds.has(entry.invitation.id)) {
      issues.push({ code: "CROSS_JOURNEY_INVITATION", id: entry.invitation.id });
    }
    if (entry.invitation.pressureArcId && !validArcIds.has(entry.invitation.pressureArcId)) {
      issues.push({ code: "CROSS_JOURNEY_PRESSURE_ARC", id: entry.invitation.pressureArcId });
    }
  }
  const expectedIdList = invitationIds(expectedInvitations);
  if (JSON.stringify(stateIds) !== JSON.stringify(expectedIdList)) {
    issues.push({ code: "INVITATION_STATE_MISMATCH", expectedIds: expectedIdList, actualIds: stateIds });
  }
  for (const id of expectedIdList) {
    const events = traceInvitations.filter((entry) => entry.invitation.id === id).map((entry) => entry.type);
    const shownIndex = events.indexOf("invitation_shown");
    const terminalIndex = Math.max(events.indexOf("invitation_declined"), events.indexOf("invitation_accepted"));
    if (shownIndex < 0 || terminalIndex <= shownIndex) {
      issues.push({ code: "INVITATION_SEQUENCE_INCOMPLETE", id, events });
    }
  }
  return issues;
}

const GENERIC_TEMPLATE_BODY_PATTERN = /第\s*\d+\s*个阶段带来了新的现实反馈/;

/**
 * Validate an intentionally bounded real-browser sample without claiming that
 * it reached a report or a physiological ending. The resulting record can be
 * admitted to blind review only through the explicit short-sample option.
 */
export function validateShortSampleState({ finalState, targetSelectedNodeCount }) {
  const history = finalState?.history || [];
  const validTarget = Number.isInteger(targetSelectedNodeCount) && targetSelectedNodeCount > 0;
  return {
    realAiBrowserSource: finalState?.testDataSource === "real_ai_browser" && !finalState?.e2eCase,
    selectedNodeCountMatchesTarget: validTarget && history.length === targetSelectedNodeCount,
    allStoryBodiesPresent: history.every((item) => typeof item.description === "string" && item.description.trim().length > 0),
    noDeterministicTemplateBodies: history.every((item) => !GENERIC_TEMPLATE_BODY_PATTERN.test(item.description || "")),
    allDisplayedChoicesPreserved: history.every((item) => Array.isArray(item.choices) && item.choices.length > 0),
    allUserChoicesPreserved: history.every((item) => typeof item.selectedChoice === "string" && item.selectedChoice.length > 0),
    allAttributesPreserved: history.every((item) => item.attributes && ["happiness", "intelligence", "wealth", "relation", "health"].every((key) => Number.isFinite(item.attributes[key]))),
    allFinancialStatesPreserved: history.every((item) => item.financialState && Number.isFinite(item.financialState.netWorthWan)),
    noPendingReportInvitation: finalState?.currentNode?.reportInvitation?.status !== "pending",
    remainsNonTerminalSimulation: finalState?.step === "simulating" && !finalState?.currentNode?.isEndingNode
  };
}

function chooseId(state, strategy, offset = 0) {
  const choices = state.currentNode?.choices || [];
  if (!choices.length) return undefined;
  if (strategy === "stable_long") {
    const ranked = [...choices].sort((a, b) => {
      const score = (choice) => {
        const intensity = choice.temporalHint?.lifeIntensity;
        const stability = intensity === "stable" ? 1000 : intensity === "normal" ? 500 : 0;
        return stability + (choice.temporalHint?.durationMonths?.[1] || 0);
      };
      return score(b) - score(a);
    });
    return ranked[0].id;
  }
  if (strategy === "tension") {
    return choices.find((choice) => (
      choice.temporalHint?.requiresFollowUp
      || choice.temporalHint?.lifeIntensity === "high_tension"
    ))?.id || choices[offset % choices.length].id;
  }
  const normalizedStrategy = String(strategy || "").trim().toUpperCase();
  return choices.find((choice) => {
    if (choice.id === strategy) return true;
    const labelMatch = String(choice.id || "").match(/(?:^|_)([ABC])$/i);
    return labelMatch?.[1].toUpperCase() === normalizedStrategy;
  })?.id || choices[offset % choices.length].id;
}

async function locateChoiceButton(tab, choice) {
  // Prefer the live decision area. Historical chapters can render an archived
  // button with the same id/text, which must never be selected on retry.
  const current = tab.playwright.locator(buildCurrentChoiceSelector(choice.id));
  const currentCount = await current.count();
  if (currentCount === 1) return current;
  if (currentCount > 1) {
    throw new Error(`Expected one current choice ${choice.id}, got ${currentCount}`);
  }
  const byId = tab.playwright.locator(`[id=${JSON.stringify(`choice-btn-${choice.id}`)}]`);
  const idCount = await byId.count();
  if (idCount === 1) return byId;
  if (idCount > 1) {
    const byText = byId.filter({ hasText: choice.text });
    const textCount = await byText.count();
    if (textCount === 1) return byText;
    throw new Error(`Expected one choice ${choice.id}/${choice.text}, got ${idCount} ids and ${textCount} text matches`);
  }
  return waitForUniqueLocator({
    locator: byId,
    label: `choice ${choice.id}`,
    wait: () => tab.playwright.waitForTimeout(50)
  });
}

function nodeCommitSignature(node) {
  if (!node) return "";
  return JSON.stringify({
    ageInMonths: node.ageInMonths,
    title: node.title,
    description: node.description
  });
}

export async function readLocatorTextInChunks(locator, { chunkSize = 180_000 } = {}) {
  const snapshotKey = `__aiLifeCollectorSnapshot_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const length = await locator.evaluate((element, key) => {
    globalThis[key] = element.textContent || "";
    return globalThis[key].length;
  }, snapshotKey);
  try {
    let raw = "";
    for (let start = 0; start < length; start += chunkSize) {
      raw += await locator.evaluate(
        (_element, range) => (globalThis[range.key] || "").slice(range.start, range.end),
        { key: snapshotKey, start, end: Math.min(length, start + chunkSize) }
      );
    }
    return raw;
  } finally {
    await locator.evaluate((_element, key) => {
      delete globalThis[key];
    }, snapshotKey);
  }
}

export async function createRealBrowserJourneyRunner({ tab, recordRoot, config, resume = false }) {
  const workingDir = path.join(recordRoot, "working");
  const casesDir = path.join(recordRoot, "cases");
  const imagesDir = path.join(recordRoot, "images", config.slug);
  const workingPath = path.join(workingDir, `${config.slug}.json`);
  const casePath = path.join(casesDir, `${config.slug}.json`);
  await mkdir(workingDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });
  const sourceIdentity = await loadRunSourceIdentity(recordRoot);

  let previousRecord;
  if (resume) {
    try {
      previousRecord = JSON.parse(await readFile(workingPath, "utf8"));
    } catch {
      previousRecord = undefined;
    }
  }
  if (resume && (previousRecord?.sourceIdentity || sourceIdentity)
    && !sameSourceIdentity(previousRecord?.sourceIdentity, sourceIdentity)) {
    throw new Error("Cannot resume a browser journey under a different release candidate source identity");
  }
  const startedAt = previousRecord?.identity?.startedAt || now();
  const identity = resume && previousRecord?.identity
    ? previousRecord.identity
    : {
        runId: path.basename(recordRoot),
        journeyId: randomUUID(),
        caseSlug: config.slug,
        scenario: config.scenario,
        startedAt
      };
  let trace = initializeJourneyTrace({ identity, previousRecord, resume });
  const appendTrace = (entry) => trace.push({ ...entry, runId: identity.runId, journeyId: identity.journeyId });

  async function snapshot() {
    return tab.playwright.domSnapshot();
  }

  async function unique(locator, label) {
    return waitForUniqueLocator({
      locator,
      label,
      wait: () => tab.playwright.waitForTimeout(50)
    });
  }

  async function readState() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const locator = tab.playwright.locator("#ai-life-test-state");
      const count = await locator.count();
      if (count === 1) {
        const raw = await readLocatorTextInChunks(locator);
        const state = JSON.parse(raw || "{}");
        assertRuntimeIdentityMatchesCandidate({
          runtimeIdentity: state.releaseRuntimeIdentity,
          sourceIdentity
        });
        return state;
      }
      if (count > 1) throw new Error(`Expected one test state node, got ${count}`);
      await tab.playwright.waitForTimeout(50);
    }
    throw new Error("Timed out waiting for test state node");
  }

  async function waitForState(predicate, description, timeoutMs = 180000) {
    const limit = Math.ceil(timeoutMs / 100);
    for (let index = 0; index < limit; index += 1) {
      await tab.playwright.waitForTimeout(100);
      const state = await readState();
      if (state.errorMsg) throw new Error(`${description}: ${state.errorMsg}`);
      if (state.nextGenerationError) throw new Error(`${description}: ${state.nextGenerationError}`);
      if (predicate(state)) return state;
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async function waitForAdvanceState(predicate, description, timeoutMs = 180000, maxVisibleRetries = 1) {
    const limit = Math.ceil(timeoutMs / 100);
    const handledPauseIds = new Set();
    let visibleRetryCount = 0;
    for (let index = 0; index < limit; index += 1) {
      await tab.playwright.waitForTimeout(100);
      const state = await readState();
      if (state.errorMsg) throw new Error(`${description}: ${state.errorMsg}`);
      if (state.nextGenerationError) {
        const pauseEvent = [...(state.generationEvents || [])]
          .reverse()
          .find((event) => event?.type === "visible_pause");
        const pauseId = pauseEvent?.id
          || `${state.history?.length || 0}:${state.nextGenerationErrorDebug || state.nextGenerationError}`;
        if (handledPauseIds.has(pauseId)) continue;
        handledPauseIds.add(pauseId);
        visibleRetryCount += 1;
        appendTrace({
          type: "recoverable_error",
          generationEventId: pauseEvent?.id,
          errorCode: pauseEvent?.errorCode,
          message: state.nextGenerationError,
          debug: state.nextGenerationErrorDebug,
          historyLength: state.history?.length || 0,
          visibleRetryCount,
          at: now()
        });
        await persist(state);
        if (visibleRetryCount > maxVisibleRetries) {
          throw new Error(`${description}: visible generation pause limit exceeded (${visibleRetryCount})`);
        }
        await snapshot();
        const retry = await unique(tab.playwright.locator("#retry-next-generation-btn"), "visible generation retry button");
        await retry.click();
        appendTrace({
          type: "recoverable_retry_started",
          generationEventId: pauseEvent?.id,
          historyLength: state.history?.length || 0,
          visibleRetryCount,
          at: now()
        });
        continue;
      }
      if (predicate(state)) {
        if (visibleRetryCount > 0) {
          const recoveredEvent = [...(state.generationEvents || [])]
            .reverse()
            .find((event) => event?.type === "recovered");
          appendTrace({
            type: "recoverable_retry_succeeded",
            generationEventId: recoveredEvent?.id,
            historyLength: state.history?.length || 0,
            visibleRetryCount,
            at: now()
          });
          await persist(state);
        }
        return state;
      }
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async function persist(state, complete = false, extras = {}) {
    const payload = {
      schemaVersion: 2,
      runId: path.basename(recordRoot),
      journeyId: identity.journeyId,
      identity,
      ...(sourceIdentity ? { sourceIdentity } : {}),
      dataSource: "real_ai_browser",
      caseSlug: config.slug,
      scenario: config.scenario,
      config,
      updatedAt: now(),
      complete,
      interactionLog: trace,
      latestState: state,
      ...extras
    };
    await writeFile(complete ? casePath : workingPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return complete ? casePath : workingPath;
  }

  async function importCheckpoint({ finalImageOnly = false } = {}) {
    const storedRaw = await readFile(workingPath, "utf8");
    const saved = JSON.parse(storedRaw);
    const importPayload = finalImageOnly ? buildFinalImageRestorePayload(saved) : saved;
    const raw = finalImageOnly ? JSON.stringify(importPayload) : storedRaw;
    const importText = !finalImageOnly && Buffer.byteLength(raw, "utf8") > 250_000
      ? buildDevFsImportReference(workingPath)
      : raw;
    await snapshot();
    const input = await unique(tab.playwright.getByRole("textbox", { name: "测试状态 JSON", exact: true }), "test state import textbox");
    // Large authoritative ledgers can exceed the browser bridge's default
    // action window. Full checkpoints use the dev-only local-file reference,
    // while small and final-image payloads retain the direct UI path.
    try {
      await input.fill(importText, { timeoutMs: 60000 });
    } catch (error) {
      // Very long lifespan checkpoints can exceed the extension bridge's
      // direct fill payload limit. Preserve the same visible import contract
      // by focusing the textarea and pasting the exact serialized checkpoint.
      await tab.clipboard.writeText(importText);
      await input.click();
      await input.press("ControlOrMeta+V", { timeoutMs: 10000 });
    }
    await tab.playwright.waitForTimeout(300);
    await snapshot();
    const button = await unique(tab.playwright.locator("#test-state-import-btn"), "test state import button");
    await button.click();
    const expectedState = importPayload.latestState ?? importPayload;
    const expectedHistoryLength = expectedState.history?.length || 0;
    return waitForState((state) => (
      state.step === expectedState.step
      && state.history?.length === expectedHistoryLength
      && state.currentNode
    ), "imported browser checkpoint", 30000);
  }

  async function clickRole(role, name, attempts = 40) {
    await snapshot();
    const locator = await waitForUniqueLocator({
      locator: tab.playwright.getByRole(role, { name, exact: true }),
      label: `${role} ${name}`,
      wait: () => tab.playwright.waitForTimeout(50),
      attempts
    });
    await locator.click();
  }

  async function fillControlledInput(locator, value, label) {
    // The controlled date input accepts a browser-level `fill`, but the
    // synthetic React change handler does not reliably retain that update in
    // the in-app browser.  Drive the native control as a user would instead.
    await locator.click();
    await tab.playwright.waitForTimeout(250);
    await locator.press("ControlOrMeta+A");
    await tab.playwright.waitForTimeout(250);
    await locator.press("Backspace");
    await tab.playwright.waitForTimeout(500);
    await locator.type(value, { delay: 100 });
    // Let the controlled value commit before the next UI action.  Without
    // this, the immediately following click can submit the previous default
    // date even though the DOM briefly shows the requested value.
    await tab.playwright.waitForTimeout(750);
    let actualValue = await locator.evaluate((element) => element.value);
    // Some Chromium date inputs consume the first keystroke sequence only to
    // focus their native segments.  Retry the same visible typing once before
    // rejecting the route; a second failed attempt remains a hard failure.
    if (actualValue !== value) {
      await locator.type(value, { delay: 100 });
      await tab.playwright.waitForTimeout(750);
      actualValue = await locator.evaluate((element) => element.value);
    }
    if (actualValue !== value) {
      throw new Error(`Expected ${label} to retain ${value}, received ${actualValue || "empty"}`);
    }
  }

  async function beginJourney() {
    trace = initializeJourneyTrace({ identity, resume: false });
    // Fail before entering any personal data or starting a paid AI request if
    // this tab is attached to a stale or incorrectly launched local service.
    await readState();
    await snapshot();
    // Chromium can expose the native date control a moment before its input
    // segment is ready for keyboard entry.  Wait for that UI settle window
    // before performing the visible date interaction.
    await tab.playwright.waitForTimeout(750);
    const birthday = await unique(tab.playwright.getByLabel("出生日期", { exact: true }), "birth date field");
    await fillControlledInput(birthday, config.birthday, "birth date field");
    await snapshot();
    const birthtime = await unique(tab.playwright.getByLabel("出生时辰", { exact: true }), "birth time select");
    await birthtime.selectOption({ value: config.birthtime });
    await tab.playwright.waitForTimeout(350);
    const actualBirthtime = await birthtime.evaluate((element) => element.value);
    if (actualBirthtime !== config.birthtime) {
      throw new Error(`Expected birth time select to retain ${config.birthtime}, received ${actualBirthtime || "empty"}`);
    }
    await clickRole("button", "生成我的命格角色卡");
    await tab.playwright.waitForTimeout(350);
    // Character-card generation renders its selectable return points
    // asynchronously.  A normal click wait is sufficient for static buttons,
    // but this particular generated control may need the full UI settle window.
    await clickRole("button", config.returnPointName, 240);
    await tab.playwright.waitForTimeout(350);

    await snapshot();
    const anchor = await unique(tab.playwright.getByLabel("回溯事件摘要", { exact: true }), "anchor textarea");
    await anchor.fill(config.anchorText);
    if (Number.isFinite(config.regressionAge)) {
      await snapshot();
      const age = await unique(tab.playwright.getByLabel("回溯年龄", { exact: true }), "regression age field");
      await age.fill(String(config.regressionAge));
    }
    for (let index = 0; index < 3; index += 1) {
      await snapshot();
      const label = `命运分支 ${String.fromCharCode(65 + index)}`;
      const branch = await unique(tab.playwright.getByLabel(label, { exact: true }), label);
      await branch.fill(config.branches[index]);
    }
    await clickRole("button", "确认，从这里开始");
  }

  async function submitBackgroundAnswers(questioning) {
    // The visible SoulQuestioning flow always collects three answers, while
    // provider state may retain extra generated suggestions. Wait for the
    // three required questions when no already-observed state is supplied.
    const activeQuestioning = questioning || await waitForState(
      (state) => state.step === "questioning" && state.questions?.length >= 3,
      "real AI background questions",
      120000
    );
    if (activeQuestioning.step !== "questioning" || activeQuestioning.questions?.length < 3) {
      throw new Error("Cannot submit background answers before three real-AI questions are visible");
    }
    if (!trace.some((entry) => entry.type === "questions_generated")) {
      appendTrace({ type: "questions_generated", questions: activeQuestioning.questions, at: now() });
      await persist(activeQuestioning);
    }
    await tab.playwright.waitForTimeout(300);

    for (let index = 0; index < 3; index += 1) {
      await snapshot();
      const answer = await unique(tab.playwright.getByRole("textbox", { name: "补充当时真实发生的事", exact: true }), `background answer ${index + 1}`);
      await answer.fill(config.answers[index]);
      await clickRole("button", index < 2 ? "保存补充，继续" : "开始生成平行人生");
      if (index < 2) await tab.playwright.waitForTimeout(350);
    }
  }

  async function recordSimulationStart(started) {
    const activeStarted = started || await readState();
    if (!(activeStarted.step === "simulating" && activeStarted.currentNode && !activeStarted.isLoading)) {
      throw new Error("Cannot record simulation start before the first real-AI node is ready");
    }
    if (!trace.some((entry) => entry.type === "simulation_started")) {
      appendTrace({ type: "simulation_started", node: activeStarted.currentNode, at: now() });
      await persist(activeStarted);
    }
    return activeStarted;
  }

  async function startJourney() {
    await beginJourney();
    // The visible questionnaire is intentionally fixed to three answers, but
    // a real provider may return extra suggestion cards.  Preserve every
    // generated question in the trace while accepting any response that can
    // render the required three-step UI; waiting for an exact array length
    // would turn a valid real-AI response into an infinite collector wait.
    const questioning = await waitForState((state) => state.step === "questioning" && state.questions?.length >= 3, "real AI background questions", 120000);
    await submitBackgroundAnswers(questioning);
    const started = await waitForState((state) => state.step === "simulating" && state.currentNode && !state.isLoading, "real AI simulation start", 120000);
    return recordSimulationStart(started);
  }

  async function advanceOnce(strategy, offset = 0) {
    const before = await readState();
    if (before.currentNode?.reportInvitation?.status === "pending") {
      throw new Error("Cannot advance while a report invitation is pending");
    }
    await tab.playwright.waitForTimeout(120);
    await snapshot();
    const choiceId = chooseId(before, strategy, offset);
    if (!choiceId) throw new Error(`No choice available at ${before.currentNode?.title}`);
    const choice = before.currentNode.choices.find((item) => item.id === choiceId);
    const locator = await locateChoiceButton(tab, choice);
    const beforeHistoryLength = before.history.length;
    const beforeNodeSignature = nodeCommitSignature(before.currentNode);
    await locator.click();
    const after = await waitForAdvanceState((state) => (
      state.history.length > beforeHistoryLength
      && !state.isLoadingNext
      && state.currentNode
      && nodeCommitSignature(state.currentNode) !== beforeNodeSignature
    ), "next real story node");
    appendTrace({
      type: "choice_completed",
      sourceNodeTitle: before.currentNode.title,
      sourceAgeInMonths: before.currentNode.ageInMonths,
      displayedChoices: before.currentNode.choices,
      selectedChoiceId: choiceId,
      selectedChoice: choice.text,
      resultingNodeTitle: after.currentNode.title,
      resultingAgeInMonths: after.currentNode.ageInMonths,
      resultingAttributes: after.currentAttributes,
      resultingFinancialState: after.currentNode.financialState,
      invitation: after.currentNode.reportInvitation,
      at: now()
    });
    await persist(after);
    return after;
  }

  async function beginAdvance(strategy, offset = 0) {
    const before = await readState();
    if (before.currentNode?.reportInvitation?.status === "pending") throw new Error("Cannot advance while a report invitation is pending");
    await tab.playwright.waitForTimeout(120);
    await snapshot();
    const choiceId = chooseId(before, strategy, offset);
    if (!choiceId) throw new Error(`No choice available at ${before.currentNode?.title}`);
    const choice = before.currentNode.choices.find((item) => item.id === choiceId);
    const locator = await locateChoiceButton(tab, choice);
    await locator.click();
    return {
      before,
      choiceId,
      choice,
      beforeHistoryLength: before.history.length,
      beforeNodeSignature: nodeCommitSignature(before.currentNode)
    };
  }

  async function finishAdvance(pendingAdvance, timeoutMs = 180000) {
    const after = await waitForAdvanceState((state) => (
      state.history.length > pendingAdvance.beforeHistoryLength
      && !state.isLoadingNext
      && state.currentNode
      && nodeCommitSignature(state.currentNode) !== pendingAdvance.beforeNodeSignature
    ), "next real story node", timeoutMs);
    appendTrace({
      type: "choice_completed",
      sourceNodeTitle: pendingAdvance.before.currentNode.title,
      sourceAgeInMonths: pendingAdvance.before.currentNode.ageInMonths,
      displayedChoices: pendingAdvance.before.currentNode.choices,
      selectedChoiceId: pendingAdvance.choiceId,
      selectedChoice: pendingAdvance.choice.text,
      resultingNodeTitle: after.currentNode.title,
      resultingAgeInMonths: after.currentNode.ageInMonths,
      resultingAttributes: after.currentAttributes,
      resultingFinancialState: after.currentNode.financialState,
      invitation: after.currentNode.reportInvitation,
      at: now()
    });
    await persist(after);
    return after;
  }

  async function advanceCustomOnce(customText) {
    const before = await readState();
    if (before.currentNode?.reportInvitation?.status === "pending") {
      throw new Error("Cannot advance while a report invitation is pending");
    }
    if (!customText?.trim()) throw new Error("Custom choice text is required");
    await snapshot();
    const trigger = await unique(tab.playwright.locator("#trigger-custom-input-btn"), "custom choice trigger");
    await trigger.click();
    await tab.playwright.waitForTimeout(120);
    await snapshot();
    const input = await unique(tab.playwright.locator("#custom-action-input"), "custom choice input");
    await input.fill(customText.trim());
    await snapshot();
    const submit = await unique(tab.playwright.locator("#submit-custom-action-btn"), "custom choice submit");
    const beforeHistoryLength = before.history.length;
    const beforeNodeSignature = nodeCommitSignature(before.currentNode);
    await submit.click();
    const after = await waitForAdvanceState((state) => (
      state.history.length > beforeHistoryLength
      && !state.isLoadingNext
      && state.currentNode
      && nodeCommitSignature(state.currentNode) !== beforeNodeSignature
    ), "next real story node from custom choice");
    const selectedChoice = `自定义抉择: ${customText.trim()}`;
    appendTrace({
      type: "choice_completed",
      sourceNodeTitle: before.currentNode.title,
      sourceAgeInMonths: before.currentNode.ageInMonths,
      displayedChoices: before.currentNode.choices,
      selectedChoiceId: "custom",
      selectedChoice,
      resultingNodeTitle: after.currentNode.title,
      resultingAgeInMonths: after.currentNode.ageInMonths,
      resultingAttributes: after.currentAttributes,
      resultingFinancialState: after.currentNode.financialState,
      invitation: after.currentNode.reportInvitation,
      at: now()
    });
    await persist(after);
    return after;
  }

  async function recordPendingInvitation() {
    const state = await readState();
    const invitation = state.currentNode?.reportInvitation;
    if (invitation?.status !== "pending") throw new Error("No pending invitation to record");
    if (!trace.some((item) => item.type === "invitation_shown" && item.invitation?.id === invitation.id)) {
      appendTrace({ type: "invitation_shown", invitation, nodeTitle: state.currentNode.title, historyLength: state.history.length, at: now() });
      await persist(state);
    }
    return state;
  }

  async function declineInvitation() {
    const before = await recordPendingInvitation();
    await snapshot();
    const locator = await unique(tab.playwright.locator("#report-invitation-continue-btn"), "continue invitation button");
    await locator.click();
    const after = await waitForState((state) => state.currentNode?.reportInvitation?.status === "declined", "declined invitation", 10000);
    appendTrace({ type: "invitation_declined", invitation: after.currentNode.reportInvitation, historyLength: after.history.length, at: now() });
    await persist(after);
    return { before, after, invitation: before.currentNode.reportInvitation };
  }

  async function beginAcceptInvitation() {
    const before = await recordPendingInvitation();
    const invitation = before.currentNode.reportInvitation;
    await snapshot();
    const locator = await unique(tab.playwright.locator("#report-invitation-accept-btn"), "accept invitation button");
    await locator.click();
    return { before, invitation };
  }

  async function finishAcceptInvitation(pendingAcceptance, timeoutMs = 180000) {
    const { before, invitation } = pendingAcceptance;
    const after = await waitForState((state) => state.step === "insight" && state.outcome && !state.isLoading, "real reflection report", timeoutMs);
    appendTrace({ type: "invitation_accepted", invitation, historyLength: after.history.length, closureType: after.outcome.meta.closureType, at: now() });
    return { before, after, invitation };
  }

  async function acceptInvitation() {
    return finishAcceptInvitation(await beginAcceptInvitation());
  }

  async function beginOpenMortalityReport() {
    const before = await readState();
    if (!before.currentNode?.isEndingNode) throw new Error("Current node is not a physiological ending");
    await snapshot();
    const locator = await unique(tab.playwright.locator("#ending-report-btn"), "ending report button");
    await locator.click();
    return { before };
  }

  async function finishOpenMortalityReport(pendingMortality, timeoutMs = 180000) {
    const { before } = pendingMortality;
    const after = await waitForState((state) => state.step === "insight" && state.outcome && !state.isLoading, "real mortality report", timeoutMs);
    appendTrace({ type: "mortality_report_opened", historyLength: after.history.length, closureType: after.outcome.meta.closureType, at: now() });
    return { before, after };
  }

  async function openMortalityReport() {
    return finishOpenMortalityReport(await beginOpenMortalityReport());
  }

  async function captureFinalImages() {
    const state = await readState();
    if (state.step !== "insight" || !state.outcome) {
      throw new Error("Final report is not visible");
    }

    await snapshot();
    // The insight view enters with an opacity/position transition. State can
    // already be "insight" while the pixels are still the black page shell.
    await tab.playwright.waitForTimeout(1500);
    const poster = tab.playwright.locator("#share-ending-poster");
    const posterCount = await poster.count();
    if (posterCount !== 1) throw new Error(`Expected one final report poster, got ${posterCount}`);
    const viewport = await tab.playwright.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }));
    if (viewport.width !== FINAL_IMAGE_VIEWPORT.width || viewport.height !== FINAL_IMAGE_VIEWPORT.height) {
      throw new Error(`Final image capture requires the ${FINAL_IMAGE_VIEWPORT.width}x${FINAL_IMAGE_VIEWPORT.height} mobile viewport; received ${viewport.width}x${viewport.height}`);
    }
    const readPosterRect = () => poster.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    let posterRect = await readPosterRect();
    if (posterRect.y < 0 || posterRect.y + posterRect.height > viewport.height) {
      // The report owns an internal scroll container, so browser page scroll
      // state cannot reset it. Scroll the visible report surface decisively to
      // its top before measuring the poster crop again.
      await tab.cua.scroll({
        x: Math.round(viewport.width / 2),
        y: Math.round(viewport.height / 2),
        scrollX: 0,
        scrollY: -1_000_000
      });
      await tab.playwright.waitForTimeout(150);
      posterRect = await readPosterRect();
    }
    if (posterRect.width <= 0 || posterRect.height <= 0) {
      throw new Error("Final report poster has no visible bounds");
    }
    if (posterRect.x < 0 || posterRect.y < 0
      || posterRect.x + posterRect.width > viewport.width
      || posterRect.y + posterRect.height > viewport.height) {
      throw new Error(`Final report poster is not fully visible for capture: ${JSON.stringify({ posterRect, viewport })}`);
    }

    const posterPath = path.join(imagesDir, "poster.jpg");
    const pagePath = path.join(imagesDir, "report-page.jpg");
    // The app is a fixed-height mobile canvas inside the browser viewport.
    // `fullPage` applies a second coordinate scale in controlled Chromium, so
    // capture the complete 1280x900 viewport after the internal report surface
    // has been returned to its top.
    const pageImage = await tab.screenshot({});
    await writeFile(pagePath, pageImage);
    // Controlled Chromium applies clip coordinates in a different scale from
    // the returned viewport pixels. Crop the authoritative full-page pixels
    // instead, using the DOM bounds measured in the fixed capture viewport.
    await execFileAsync("/usr/bin/sips", buildFinalPosterCropArgs({ pagePath, posterPath, posterRect }));
    const posterImage = await readFile(posterPath);
    assertDistinctFinalImageEvidence({ poster: posterImage, page: pageImage });
    appendTrace({ type: "final_images_saved", posterPath, pagePath, at: now() });
    await persist(state, false, { imagePaths: { posterPath, pagePath } });
    return { posterPath, pagePath };
  }

  async function captureCheckpointImage(label = "checkpoint") {
    await snapshot();
    await tab.playwright.waitForTimeout(300);
    const pagePath = path.join(imagesDir, `${label}.jpg`);
    await writeFile(pagePath, await tab.screenshot({}));
    appendTrace({ type: "checkpoint_image_saved", label, pagePath, at: now() });
    return pagePath;
  }

  async function complete(finalState, { firstInvitation, secondInvitation, extraInvitations = [], imagePaths }) {
    const history = finalState.history || [];
    const invitations = finalState.invitations || [];
    const expectedInvitations = [firstInvitation, secondInvitation, ...extraInvitations].filter(Boolean);
    const invitationIsolationIssues = validateJourneyInvitationIsolation({ identity, trace, finalState, expectedInvitations });
    const expectedClosure = config.scenario === "natural_lifespan" ? "mortality" : "user_reflection";
    const validation = {
      runtimeIdentityMatchesCandidate: runtimeIdentityMatchesCandidate({
        runtimeIdentity: finalState.releaseRuntimeIdentity,
        sourceIdentity
      }),
      realAiBrowserSource: finalState.testDataSource === "real_ai_browser" && !finalState.e2eCase,
      completeWebHistory: history.length > 0,
      allStoryBodiesPresent: history.every((item) => typeof item.description === "string" && item.description.trim().length > 0),
      noDeterministicTemplateBodies: history.every((item) => !GENERIC_TEMPLATE_BODY_PATTERN.test(item.description || "")),
      allDisplayedChoicesPreserved: history.every((item) => Array.isArray(item.choices) && item.choices.length > 0),
      allUserChoicesPreserved: history.every((item) => typeof item.selectedChoice === "string" && item.selectedChoice.length > 0),
      allAttributesPreserved: history.every((item) => item.attributes && ["happiness", "intelligence", "wealth", "relation", "health"].every((key) => Number.isFinite(item.attributes[key]))),
      allFinancialStatesPreserved: history.every((item) => item.financialState && Number.isFinite(item.financialState.netWorthWan)),
      submittedPersonaMatchesConfig: submittedPersonaMatchesConfig({ config, finalState }),
      allInvitationsPreserved: JSON.stringify(invitationIds(invitations)) === JSON.stringify(invitationIds(expectedInvitations)),
      invitationJourneyIsolation: invitationIsolationIssues.length === 0,
      expectedClosureType: finalState.outcome?.meta?.closureType === expectedClosure,
      finalReportPresent: Boolean(finalState.outcome?.share && finalState.outcome?.report),
      finalImagesPresent: Boolean(imagePaths?.posterPath && imagePaths?.pagePath)
    };
    if (sourceIdentity) validation.sourceIdentityPinned = true;
    const record = {
      schemaVersion: 2,
      runId: path.basename(recordRoot),
      journeyId: identity.journeyId,
      identity,
      ...(sourceIdentity ? { sourceIdentity } : {}),
      dataSource: "real_ai_browser",
      caseSlug: config.slug,
      scenario: config.scenario,
      config,
      startedAt: trace[0]?.at,
      completedAt: now(),
      firstInvitation,
      secondInvitation,
      extraInvitations,
      interactionLog: trace,
      invitationIsolationIssues,
      imagePaths,
      validation,
      passed: Object.values(validation).every(Boolean),
      finalState
    };
    // Keep a request-classified, prompt-free summary beside the raw state so
    // the browser evidence remains inspectable even before aggregate analysis.
    record.cacheTelemetry = summarizeCacheUsage([record]);
    await writeFile(casePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return {
      path: casePath,
      summary: {
        slug: config.slug,
        scenario: config.scenario,
        historyLength: history.length,
        invitationCount: invitations.length,
        firstAt: firstInvitation?.completedChoiceCount,
        secondAt: secondInvitation?.completedChoiceCount,
        closureType: finalState.outcome?.meta?.closureType,
        passed: record.passed,
        validation
      }
    };
  }

  async function completeShortSample(finalState, { targetSelectedNodeCount }) {
    const history = finalState?.history || [];
    const validation = {
      ...validateShortSampleState({ finalState, targetSelectedNodeCount }),
      ...(sourceIdentity ? {
        runtimeIdentityMatchesCandidate: runtimeIdentityMatchesCandidate({
          runtimeIdentity: finalState?.releaseRuntimeIdentity,
          sourceIdentity
        }),
        sourceIdentityPinned: true
      } : {})
    };
    const validationPassed = Object.values(validation).every(Boolean);
    const record = {
      schemaVersion: 2,
      runId: path.basename(recordRoot),
      journeyId: identity.journeyId,
      identity,
      ...(sourceIdentity ? { sourceIdentity } : {}),
      dataSource: "real_ai_browser",
      caseSlug: config.slug,
      scenario: config.scenario,
      config,
      startedAt: trace[0]?.at,
      completedAt: now(),
      complete: false,
      shortSample: {
        complete: true,
        targetSelectedNodeCount,
        acceptedHistoryCount: history.length,
        validationPassed
      },
      interactionLog: trace,
      validation,
      // `passed` belongs only to a complete ending-route run. Short samples
      // have their own explicit validation and must never be upgraded to a
      // release-level route pass.
      passed: false,
      finalState
    };
    record.cacheTelemetry = summarizeCacheUsage([record]);
    await writeFile(casePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return {
      path: casePath,
      summary: {
        slug: config.slug,
        scenario: config.scenario,
        historyLength: history.length,
        targetSelectedNodeCount,
        validationPassed,
        validation
      }
    };
  }

  return {
    config,
    get trace() { return trace; },
    workingPath,
    casePath,
    readState,
    waitForState,
    persist,
    importCheckpoint,
    beginJourney,
    submitBackgroundAnswers,
    recordSimulationStart,
    startJourney,
    advanceOnce,
    beginAdvance,
    finishAdvance,
    advanceCustomOnce,
    recordPendingInvitation,
    beginAcceptInvitation,
    finishAcceptInvitation,
    declineInvitation,
    acceptInvitation,
    beginOpenMortalityReport,
    finishOpenMortalityReport,
    openMortalityReport,
    captureFinalImages,
    captureCheckpointImage,
    complete,
    completeShortSample
  };
}
