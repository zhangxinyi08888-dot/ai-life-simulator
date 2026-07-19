import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function now() {
  return new Date().toISOString();
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
  return choices.find((choice) => choice.id === strategy)?.id || choices[offset % choices.length].id;
}

export async function createRealBrowserJourneyRunner({ tab, recordRoot, config }) {
  const workingDir = path.join(recordRoot, "working");
  const casesDir = path.join(recordRoot, "cases");
  const imagesDir = path.join(recordRoot, "images", config.slug);
  const workingPath = path.join(workingDir, `${config.slug}.json`);
  const casePath = path.join(casesDir, `${config.slug}.json`);
  await mkdir(workingDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  let trace = [{ type: "case_started", caseSlug: config.slug, scenario: config.scenario, at: now() }];
  try {
    const previous = JSON.parse(await readFile(workingPath, "utf8"));
    if (Array.isArray(previous.interactionLog)) trace = previous.interactionLog;
  } catch {
    // A missing working file means this is a new case.
  }

  async function snapshot() {
    return tab.playwright.domSnapshot();
  }

  async function unique(locator, label) {
    const count = await locator.count();
    if (count !== 1) throw new Error(`Expected one ${label}, got ${count}`);
    return locator;
  }

  async function readState() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const locator = tab.playwright.locator("#ai-life-test-state");
      const count = await locator.count();
      if (count === 1) {
        const raw = await locator.textContent();
        return JSON.parse(raw || "{}");
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
      if (predicate(state)) return state;
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async function persist(state, complete = false, extras = {}) {
    const payload = {
      schemaVersion: 2,
      runId: path.basename(recordRoot),
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

  async function importCheckpoint() {
    const raw = await readFile(workingPath, "utf8");
    const saved = JSON.parse(raw);
    await snapshot();
    const input = await unique(tab.playwright.getByRole("textbox", { name: "测试状态 JSON", exact: true }), "test state import textbox");
    await input.fill(raw);
    await snapshot();
    const button = await unique(tab.playwright.locator("#test-state-import-btn"), "test state import button");
    await button.click();
    const expectedHistoryLength = saved.latestState?.history?.length || 0;
    return waitForState((state) => (
      state.step === saved.latestState?.step
      && state.history?.length === expectedHistoryLength
      && state.currentNode
    ), "imported browser checkpoint", 20000);
  }

  async function clickRole(role, name) {
    await snapshot();
    const locator = await unique(tab.playwright.getByRole(role, { name, exact: true }), `${role} ${name}`);
    await locator.click();
  }

  async function startJourney() {
    await snapshot();
    const birthday = await unique(tab.playwright.getByLabel("出生日期", { exact: true }), "birth date field");
    await birthday.fill(config.birthday);
    await snapshot();
    const birthtime = await unique(tab.playwright.getByLabel("出生时辰", { exact: true }), "birth time select");
    await birthtime.selectOption({ value: config.birthtime });
    await clickRole("button", "生成我的命格角色卡");
    await tab.playwright.waitForTimeout(350);
    await clickRole("button", config.returnPointName);
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
    const questioning = await waitForState((state) => state.step === "questioning" && state.questions?.length === 3, "real AI background questions", 120000);
    trace.push({ type: "questions_generated", questions: questioning.questions, at: now() });
    await persist(questioning);
    await tab.playwright.waitForTimeout(300);

    for (let index = 0; index < 3; index += 1) {
      await snapshot();
      const answer = await unique(tab.playwright.getByRole("textbox", { name: "补充当时真实发生的事", exact: true }), `background answer ${index + 1}`);
      await answer.fill(config.answers[index]);
      await clickRole("button", index < 2 ? "保存补充，继续" : "开始生成平行人生");
      if (index < 2) await tab.playwright.waitForTimeout(350);
    }
    const started = await waitForState((state) => state.step === "simulating" && state.currentNode && !state.isLoading, "real AI simulation start", 120000);
    trace.push({ type: "simulation_started", node: started.currentNode, at: now() });
    await persist(started);
    return started;
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
    const locator = await unique(
      tab.playwright.locator(`[id=${JSON.stringify(`choice-btn-${choiceId}`)}]`),
      `choice ${choiceId}`
    );
    const beforeHistoryLength = before.history.length;
    await locator.click();
    const after = await waitForState((state) => (
      state.history.length > beforeHistoryLength
      && !state.isLoadingNext
      && state.currentNode
    ), "next real story node");
    trace.push({
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
    const locator = await unique(tab.playwright.locator(`[id=${JSON.stringify(`choice-btn-${choiceId}`)}]`), `choice ${choiceId}`);
    await locator.click();
    return { before, choiceId, choice, beforeHistoryLength: before.history.length };
  }

  async function finishAdvance(pendingAdvance, timeoutMs = 20000) {
    const after = await waitForState((state) => (
      state.history.length > pendingAdvance.beforeHistoryLength
      && !state.isLoadingNext
      && state.currentNode
    ), "next real story node", timeoutMs);
    trace.push({
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
    await submit.click();
    const after = await waitForState((state) => (
      state.history.length > beforeHistoryLength
      && !state.isLoadingNext
      && state.currentNode
    ), "next real story node from custom choice");
    const selectedChoice = `自定义抉择: ${customText.trim()}`;
    trace.push({
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
      trace.push({ type: "invitation_shown", invitation, nodeTitle: state.currentNode.title, historyLength: state.history.length, at: now() });
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
    trace.push({ type: "invitation_declined", invitation: after.currentNode.reportInvitation, historyLength: after.history.length, at: now() });
    await persist(after);
    return { before, after, invitation: before.currentNode.reportInvitation };
  }

  async function acceptInvitation() {
    const before = await recordPendingInvitation();
    const invitation = before.currentNode.reportInvitation;
    await snapshot();
    const locator = await unique(tab.playwright.locator("#report-invitation-accept-btn"), "accept invitation button");
    await locator.click();
    const after = await waitForState((state) => state.step === "insight" && state.outcome && !state.isLoading, "real reflection report");
    trace.push({ type: "invitation_accepted", invitation, historyLength: after.history.length, closureType: after.outcome.meta.closureType, at: now() });
    return { before, after, invitation };
  }

  async function openMortalityReport() {
    const before = await readState();
    if (!before.currentNode?.isEndingNode) throw new Error("Current node is not a physiological ending");
    await snapshot();
    const locator = await unique(tab.playwright.locator("#ending-report-btn"), "ending report button");
    await locator.click();
    const after = await waitForState((state) => state.step === "insight" && state.outcome && !state.isLoading, "real mortality report");
    trace.push({ type: "mortality_report_opened", historyLength: after.history.length, closureType: after.outcome.meta.closureType, at: now() });
    return { before, after };
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
    let posterRect;
    if (posterCount === 1) try {
      posterRect = await poster.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          // Browser screenshot clips use viewport coordinates. Adding the
          // document scroll offset moves the clip away from the visible card
          // and produced all-black poster evidence on long report pages.
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: rect.width,
          height: rect.height
        };
      });
    } catch {
      // Fall through to the centered report-card crop below.
    }
    if (!posterRect) {
      const viewport = await tab.playwright.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }));
      const width = Math.min(356, viewport.width - 32);
      posterRect = {
        x: Math.max(0, (viewport.width - width) / 2),
        y: 20,
        width,
        height: Math.min(632, viewport.height - 40)
      };
    }
    if (posterRect.width <= 0 || posterRect.height <= 0) {
      throw new Error("Final report poster has no visible bounds");
    }

    const posterPath = path.join(imagesDir, "poster.jpg");
    const pagePath = path.join(imagesDir, "report-page.jpg");
    await writeFile(posterPath, await tab.screenshot({ clip: posterRect }));
    // Preserve the actual terminal page viewport. fullPage screenshots of the
    // horizontally centered report can repeat transformed content in Chromium.
    await writeFile(pagePath, await tab.screenshot({}));
    trace.push({ type: "final_images_saved", posterPath, pagePath, at: now() });
    await persist(state, false, { imagePaths: { posterPath, pagePath } });
    return { posterPath, pagePath };
  }

  async function complete(finalState, { firstInvitation, secondInvitation, extraInvitations = [], imagePaths }) {
    const history = finalState.history || [];
    const invitations = finalState.invitations || [];
    const expectedClosure = config.scenario === "natural_lifespan" ? "mortality" : "user_reflection";
    const genericTemplatePattern = /第\s*\d+\s*个阶段带来了新的现实反馈/;
    const validation = {
      realAiBrowserSource: finalState.testDataSource === "real_ai_browser" && !finalState.e2eCase,
      completeWebHistory: history.length > 0,
      allStoryBodiesPresent: history.every((item) => typeof item.description === "string" && item.description.trim().length > 0),
      noDeterministicTemplateBodies: history.every((item) => !genericTemplatePattern.test(item.description || "")),
      allDisplayedChoicesPreserved: history.every((item) => Array.isArray(item.choices) && item.choices.length > 0),
      allUserChoicesPreserved: history.every((item) => typeof item.selectedChoice === "string" && item.selectedChoice.length > 0),
      allAttributesPreserved: history.every((item) => item.attributes && ["happiness", "intelligence", "wealth", "relation", "health"].every((key) => Number.isFinite(item.attributes[key]))),
      allFinancialStatesPreserved: history.every((item) => item.financialState && Number.isFinite(item.financialState.netWorthWan)),
      allInvitationsPreserved: invitations.length >= [firstInvitation, secondInvitation, ...extraInvitations].filter(Boolean).length,
      expectedClosureType: finalState.outcome?.meta?.closureType === expectedClosure,
      finalReportPresent: Boolean(finalState.outcome?.share && finalState.outcome?.report),
      finalImagesPresent: Boolean(imagePaths?.posterPath && imagePaths?.pagePath)
    };
    const record = {
      schemaVersion: 2,
      runId: path.basename(recordRoot),
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
      imagePaths,
      validation,
      passed: Object.values(validation).every(Boolean),
      finalState
    };
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

  return {
    config,
    get trace() { return trace; },
    workingPath,
    casePath,
    readState,
    waitForState,
    persist,
    importCheckpoint,
    startJourney,
    advanceOnce,
    beginAdvance,
    finishAdvance,
    advanceCustomOnce,
    recordPendingInvitation,
    declineInvitation,
    acceptInvitation,
    openMortalityReport,
    captureFinalImages,
    complete
  };
}
