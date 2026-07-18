import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Activity, AlertCircle, ArrowDown, BookOpen, CheckCircle2, Compass, DollarSign, Heart, History, MessageSquarePlus, RotateCcw, Send, Sparkles, Square, Users } from "lucide-react";
import { HistoryItem, LifeAttributes, ReportInvitationMeta, SimulationNode } from "../types";
import { formatAgeInMonths } from "../utils/timelineAdvance";
import { formatNetWorthWan } from "../utils/financialState";
import { splitNarrativeParagraphs } from "../utils/narrativePresentation";
import type { NextGenerationStage } from "../services/simulation/simulationService";
import type { StreamedNodePreview } from "../utils/streamingJsonPreview";

interface SimulationEngineProps {
  currentNode: SimulationNode;
  history: HistoryItem[];
  nodeCount: number;
  onSelectChoice: (choiceText: string) => void;
  onAcceptReportInvitation: (invitation: ReportInvitationMeta) => void;
  onContinueReportInvitation: (invitationId: string) => void;
  isLoadingNext: boolean;
  generationStage: NextGenerationStage;
  narrativePreview: StreamedNodePreview | null;
  generationError: string | null;
  onStopGeneration: () => void;
  onRetryGeneration: () => void;
  onDiscardGeneration: () => void;
  isLoadingReport: boolean;
  onTimeTravel: (targetIndex: number) => void;
}

const ATTRIBUTES = [
  { key: "happiness", name: "幸福", icon: Heart },
  { key: "intelligence", name: "才智", icon: BookOpen },
  { key: "wealth", name: "财富", icon: DollarSign },
  { key: "relation", name: "关系", icon: Users },
  { key: "health", name: "健康", icon: Activity }
] as const;

const GENERATION_COPY: Record<NextGenerationStage, { title: string; detail: string }> = {
  preparing: { title: "正在承接你的选择", detail: "整理上一阶段的人物、时间与现实条件。" },
  generating: { title: "正在推演现实影响", detail: "新的经历正在形成，正式状态尚未写入时间线。" },
  validating: { title: "正在校准时间线", detail: "核对年龄、财务、人物关系与后续选项。" },
  finalizing: { title: "下一章即将展开", detail: "本段已经通过校准，正在写入你的生平纪事。" },
  revealing: { title: "正在展开最终正文", detail: "内容已经校准完成，正在平稳呈现这一章。" }
};

const DECISION_VISIBILITY_MARGIN_PX = 24;

export function isDecisionAreaInReadingViewport(input: {
  decisionTop: number;
  decisionBottom: number;
  readingTop: number;
  readingBottom: number;
}): boolean {
  return input.decisionTop <= input.readingBottom - DECISION_VISIBILITY_MARGIN_PX
    && input.decisionBottom >= input.readingTop + DECISION_VISIBILITY_MARGIN_PX;
}

export default function SimulationEngine({ currentNode, history, nodeCount, onSelectChoice, onAcceptReportInvitation, onContinueReportInvitation, isLoadingNext, generationStage, narrativePreview, generationError, onStopGeneration, onRetryGeneration, onDiscardGeneration, isLoadingReport, onTimeTravel }: SimulationEngineProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [isDecisionAreaVisible, setIsDecisionAreaVisible] = useState(false);
  const [customText, setCustomText] = useState("");
  const prefersReducedMotion = useReducedMotion();
  const storyRef = useRef<HTMLDivElement>(null);
  const decisionAreaRef = useRef<HTMLDivElement>(null);
  const interactionDockRef = useRef<HTMLElement>(null);
  const paragraphs = useMemo(() => splitNarrativeParagraphs(currentNode.description), [currentNode.description]);
  const pendingInvitation = currentNode.reportInvitation?.status === "pending"
    ? currentNode.reportInvitation
    : undefined;
  const hasNextChapterPreview = isLoadingNext || Boolean(generationError) || Boolean(narrativePreview);
  const chapterIdentity = `${currentNode.ageInMonths ?? currentNode.age * 12}-${currentNode.title}`;
  const previousChapterViewRef = useRef({ chapterIdentity, hasNextChapterPreview });
  const displayedParagraphs = hasNextChapterPreview ? (narrativePreview?.paragraphs ?? []) : paragraphs;
  const displayedTitle = hasNextChapterPreview ? narrativePreview?.title : currentNode.title;

  useLayoutEffect(() => {
    const previous = previousChapterViewRef.current;
    const previewStarted = hasNextChapterPreview && !previous.hasNextChapterPreview;
    const regularChapterChanged = chapterIdentity !== previous.chapterIdentity
      && !hasNextChapterPreview
      && !previous.hasNextChapterPreview;

    if (previewStarted || regularChapterChanged) {
      storyRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }

    previousChapterViewRef.current = { chapterIdentity, hasNextChapterPreview };
  }, [chapterIdentity, hasNextChapterPreview]);

  useLayoutEffect(() => {
    const storyElement = storyRef.current;
    const decisionElement = decisionAreaRef.current;

    if (hasNextChapterPreview || !storyElement || !decisionElement) {
      setIsDecisionAreaVisible(false);
      return;
    }

    let animationFrame: number | null = null;
    const updateDecisionVisibility = () => {
      const storyRect = storyElement.getBoundingClientRect();
      const decisionRect = decisionElement.getBoundingClientRect();
      setIsDecisionAreaVisible(isDecisionAreaInReadingViewport({
        decisionTop: decisionRect.top,
        decisionBottom: decisionRect.bottom,
        readingTop: storyRect.top,
        readingBottom: storyRect.bottom
      }));
    };

    const scheduleDecisionVisibilityUpdate = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateDecisionVisibility();
      });
    };

    updateDecisionVisibility();
    storyElement.addEventListener("scroll", scheduleDecisionVisibilityUpdate, { passive: true });
    window.addEventListener("resize", scheduleDecisionVisibilityUpdate);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleDecisionVisibilityUpdate);
    resizeObserver?.observe(storyElement);
    resizeObserver?.observe(decisionElement);

    return () => {
      storyElement.removeEventListener("scroll", scheduleDecisionVisibilityUpdate);
      window.removeEventListener("resize", scheduleDecisionVisibilityUpdate);
      resizeObserver?.disconnect();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [chapterIdentity, hasNextChapterPreview, isCustomMode]);

  useLayoutEffect(() => {
    if (!isDecisionAreaVisible) return;
    const dockElement = interactionDockRef.current;
    if (dockElement?.contains(document.activeElement)) {
      decisionAreaRef.current?.focus({ preventScroll: true });
    }
  }, [isDecisionAreaVisible]);

  const preferredScrollBehavior = () => (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth"
  );

  const scrollToLatestParagraph = () => {
    const storyElement = storyRef.current;
    storyElement?.scrollTo({ top: storyElement.scrollHeight, behavior: preferredScrollBehavior() });
  };

  const scrollToDecisionArea = () => {
    const storyElement = storyRef.current;
    const decisionElement = decisionAreaRef.current;
    if (!storyElement || !decisionElement) return;
    const storyRect = storyElement.getBoundingClientRect();
    const decisionRect = decisionElement.getBoundingClientRect();
    storyElement.scrollTo({
      top: storyElement.scrollTop + decisionRect.top - storyRect.top - DECISION_VISIBILITY_MARGIN_PX,
      behavior: preferredScrollBehavior()
    });
  };

  const choose = (choiceText: string) => {
    onSelectChoice(choiceText);
    setIsCustomMode(false);
    setCustomText("");
  };

  const submitCustomChoice = (event: React.FormEvent) => {
    event.preventDefault();
    if (!customText.trim()) return;
    choose(`自定义抉择: ${customText.trim()}`);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[#050505] text-[#f2eee5]" id="engine-panel">
      <header className="border-b border-[#22201d] bg-[#070707] px-4 pb-3 pt-5" id="attribute-header">
        <div className="flex items-center justify-end px-1" id="top-stage-meta">
          <button type="button" onClick={() => setIsHistoryOpen(true)} className="flex items-center gap-1.5 rounded-full border border-[#37332c] px-3 py-1.5 text-[10px] text-[#a7a097] transition hover:border-[#746a50] hover:text-[#ded7ca]" id="toggle-history-btn">
            <History className="h-3 w-3 text-[#b6a778]" /> 生平纪事 {history.length}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1" id="stats-meters-grid">
          {ATTRIBUTES.map(({ key, name, icon: Icon }) => {
            const value = currentNode.attributes[key as keyof LifeAttributes] ?? 50;
            const isWealth = key === "wealth" && Boolean(currentNode.financialState);
            const displayValue = isWealth
              ? formatNetWorthWan(currentNode.financialState!.netWorthWan)
              : value;
            const wealthChange = isWealth ? currentNode.financialChange?.netWorthChangeWan : undefined;
            const wealthEstimated = isWealth && currentNode.financialState?.isEstimated;
            const wealthChangeLabel = typeof wealthChange === "number"
              ? `${wealthChange >= 0 ? "+" : ""}${formatNetWorthWan(wealthChange)}`
              : undefined;
            return (
              <div
                key={key}
                title={isWealth ? `真实净财富 ${displayValue}${wealthEstimated ? "（估算）" : ""}${wealthChangeLabel ? `，本阶段 ${wealthChangeLabel}` : ""}；财富资源度 ${value}` : undefined}
                className="flex h-20 flex-col rounded-[10px] border border-[#292724] bg-[#0b0b0b] px-1.5 py-2 text-center"
                id={`attribute-card-${key}`}
              >
                <div className="flex min-h-3 items-center justify-center gap-1 text-[9px] text-[#77726b]" id={`attribute-label-${key}`}>
                  <Icon className="h-2.5 w-2.5 shrink-0 text-[#aa9b70]" />
                  <span>{name}</span>
                  {wealthEstimated && (
                    <span aria-label="估算值" title="估算值" className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full border border-[#514b3d] text-[6px] leading-none text-[#8f866f]" id="wealth-estimated-badge">估</span>
                  )}
                </div>
                <div className="mt-1 flex min-h-4 items-baseline justify-center gap-1 whitespace-nowrap tabular-nums" id={`attribute-value-${key}`}>
                  <span className="text-[12px] font-semibold text-[#d6c99f]">{displayValue}</span>
                  {wealthChangeLabel && (
                    <span className={`text-[7px] font-medium ${(wealthChange ?? 0) >= 0 ? "text-[#7e9875]" : "text-[#a5746f]"}`} id="wealth-change-value">{wealthChangeLabel}</span>
                  )}
                </div>
                <div className="mt-auto h-px overflow-hidden bg-[#292724]" id={`attribute-bar-bg-${key}`}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.45 }} className="h-full bg-[#c4b47e]" id={`attribute-bar-fill-${key}`} />
                </div>
              </div>
            );
          })}
        </div>
      </header>

      <main ref={storyRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-[89px] pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" id="novel-scrollable-body">
        <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5" id="active-chapter-head" data-chapter-state={hasNextChapterPreview ? "draft" : "committed"} aria-busy={hasNextChapterPreview}>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-[#9c9278]">
            <span>{hasNextChapterPreview ? "NEXT CHAPTER" : `AGE ${formatAgeInMonths(currentNode.ageInMonths ?? currentNode.age * 12)}`}</span>
            <span className="h-px flex-1 bg-[#2c2924]" />
            <span>{hasNextChapterPreview ? (generationError ? "已暂停" : "生成中") : `抉择 ${String(nodeCount).padStart(2, "0")}`}</span>
          </div>
          <h2 className="min-h-[35px] font-serif text-[28px] font-medium leading-[1.25] tracking-[-0.025em] text-[#f0ebe2]" id="chapter-node-title">
            {displayedTitle || <span className="generation-shimmer block h-8 w-3/5 rounded-[8px] border border-[#4a402c]" />}
          </h2>
          <div className="h-px w-9 bg-[#9f9066]" />
          <div className="space-y-4 rounded-[17px] border border-[#2d2b27] bg-[#0a0a0a] p-4 text-[13px] leading-7 text-[#bdb6ab]" id="chapter-node-body">
            {displayedParagraphs.length ? (
              <>
                {displayedParagraphs.map((paragraph, index) => (
                  <p className={hasNextChapterPreview ? "paragraph-enter" : undefined} key={`chapter-paragraph-${index}`}>
                    {paragraph}
                  </p>
                ))}
              </>
            ) : (
              <>
                <div className="generation-shimmer h-3 w-full rounded-md" />
                <div className="generation-shimmer h-3 w-[82%] rounded-md [animation-delay:120ms]" />
                <div className="generation-shimmer h-3 w-[66%] rounded-md [animation-delay:240ms]" />
              </>
            )}
          </div>
        </motion.article>

        {!hasNextChapterPreview && (
          <div ref={decisionAreaRef} aria-labelledby="decision-area-heading" className="scroll-mt-6 pb-1 pt-8 outline-none" id="inline-decision-area" tabIndex={-1}>
            <div className="mb-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-[#9c9278]" id="decision-area-heading">
              <span>{pendingInvitation ? "LIFE REVIEW" : currentNode.isEndingNode ? "FINAL CHAPTER" : isCustomMode ? "CUSTOM CHOICE" : "YOUR CHOICE"}</span>
              <span className="h-px flex-1 bg-[#2c2924]" />
              <span>{pendingInvitation ? "回望" : currentNode.isEndingNode ? "终章" : isCustomMode ? "自定义" : `${currentNode.choices.length} 个方向`}</span>
            </div>

            {isLoadingReport ? (
              <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-[16px] border border-[#302d27] bg-[#0a0a0a] text-center" id="loading-report-spinner">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#4a4435] border-t-[#c8b77d]" />
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#b6a778]">{pendingInvitation ? "这段人生的报告生成中" : "完整人生报告生成中"}</p>
                <p className="max-w-[280px] text-[10px] leading-5 text-[#625e58]">正在整理你的人生轨迹与关键选择。</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {pendingInvitation ? (
                  <motion.div key="report-invitation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-[16px] border border-[#6f6244] bg-[#11100d] p-4" id="report-invitation-card">
                    <div className="flex items-center gap-2 text-[#cbbb89]"><Sparkles className="h-4 w-4" /><h3 className="font-serif text-[17px] text-[#ece4d6]">这条人生，已经有了值得回望的轨迹</h3></div>
                    <p className="mt-3 text-[11px] leading-6 text-[#9d968b]">一路走到这里，你的选择、得到的东西和付出的代价，已经慢慢形成了一条清晰的轨迹。</p>
                    <button type="button" onClick={() => onAcceptReportInvitation(pendingInvitation)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-[13px] border border-[#ded3b6]/60 bg-[#d2c08d] text-[12px] font-semibold text-[#15130f] transition hover:bg-[#dac99a]" id="report-invitation-accept-btn"><Sparkles className="h-4 w-4" />查看这段人生的报告</button>
                    <button type="button" onClick={() => onContinueReportInvitation(pendingInvitation.id)} className="mt-3 w-full text-center text-[10px] leading-5 text-[#827b70] transition hover:text-[#c5ba9d]" id="report-invitation-continue-btn">继续走下去，看看更远的结果</button>
                  </motion.div>
                ) : !isCustomMode ? (
                  <motion.div key="choices" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2" id="preset-choices-container">
                    {!currentNode.isEndingNode && currentNode.choices.map((choice) => (
                      <button key={choice.id} id={`choice-btn-${choice.id}`} type="button" onClick={() => choose(choice.text)} className="group flex min-h-12 w-full items-start gap-3 rounded-[13px] border border-[#302e2a] bg-[#0a0a0a] px-3 py-2.5 text-left transition hover:border-[#73694f] hover:bg-[#12110d]">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#514b3d] text-[10px] text-[#c2b487] group-hover:border-[#9d8e63]">{choice.id}</span>
                        <span className="min-w-0 flex-1 text-[12px] leading-5 text-[#b5afa6] group-hover:text-[#e2dcd1]">{choice.text}</span>
                        {choice.impactSummary && <span className="mt-0.5 shrink-0 rounded-full border border-[#34312b] px-2 py-0.5 text-[8px] text-[#6e6962]">{choice.impactSummary}</span>}
                      </button>
                    ))}

                    {!currentNode.isEndingNode && (
                      <button type="button" onClick={() => setIsCustomMode(true)} className="flex h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#37332d] text-[11px] text-[#978d73] transition hover:border-[#766b50] hover:text-[#c8b981]" id="trigger-custom-input-btn">
                        <MessageSquarePlus className="h-3.5 w-3.5" /> 写下我自己的选择
                      </button>
                    )}

                    {currentNode.isEndingNode && (
                      <button type="button" onClick={() => onSelectChoice("安详落幕，查看一生洞察")} className="flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border border-[#ded3b6]/60 bg-[#d2c08d] text-[13px] font-semibold text-[#15130f] transition hover:bg-[#dac99a]" id="ending-report-btn">
                        <Sparkles className="h-4 w-4" /> 查看我的人生洞察
                      </button>
                    )}
                  </motion.div>
                ) : (
                  <motion.form key="custom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={submitCustomChoice} className="space-y-3" id="custom-decision-box">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-[11px] text-[#b8aa7c]"><Compass className="h-3.5 w-3.5" />写下自己的选择</p>
                      <button type="button" onClick={() => setIsCustomMode(false)} className="text-[10px] text-[#69655f] hover:text-[#bdb6ac]" id="cancel-custom-choice-btn">返回默认选项</button>
                    </div>
                    <div className="flex gap-2">
                      <input required maxLength={100} value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="我决定……" className="h-12 min-w-0 flex-1 rounded-[13px] border border-[#302e2a] bg-[#0a0a0a] px-3 text-[12px] text-[#ddd7cd] outline-none placeholder:text-[#514e49] focus:border-[#766b50]" id="custom-action-input" />
                      <button type="submit" className="flex h-12 w-12 items-center justify-center rounded-[13px] border border-[#d4c69f]/60 bg-[#d2c08d] text-[#15130f] hover:bg-[#dac99a]" id="submit-custom-action-btn"><Send className="h-4 w-4" /></button>
                    </div>
                    <p className="text-center text-[9px] text-[#56524d]">没有标准答案，系统会沿着你的真实选择继续推演</p>
                  </motion.form>
                )}
              </AnimatePresence>
            )}
          </div>
        )}
      </main>

      {hasNextChapterPreview ? (
        <section className="absolute inset-x-0 bottom-0 z-20 flex min-h-[65px] items-center border-t border-[#211f1c] bg-[#070707] px-4 py-3" id="generation-dock">
          <div className="w-full" id="loading-next-progress" role="status" aria-live="polite">
            {generationError ? (
              <div className="px-1" id="next-generation-error-state">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#b98276]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-[#d0b094]">生成暂时停在这里</p>
                    <p className="mt-1 text-[9px] leading-5 text-[#756d64]">{generationError}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 pl-8">
                  <button type="button" onClick={onRetryGeneration} className="flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[#746545] bg-[#1a1710] px-3 text-[10px] text-[#cdbd88] transition hover:bg-[#211d14]" id="retry-next-generation-btn"><RotateCcw className="h-3 w-3" />继续生成</button>
                  <button type="button" onClick={onDiscardGeneration} className="h-9 px-3 text-[10px] text-[#77716a] transition hover:text-[#bdb6ab]" id="discard-next-generation-btn">返回选择</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 px-1">
                <div className="h-5 w-5 shrink-0 animate-spin rounded-full border border-[#5c5138] border-t-[#d1bf82] shadow-[0_0_10px_rgba(200,183,125,0.12)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-[#cdbd88]">{GENERATION_COPY[generationStage].title}</p>
                  <p className="mt-0.5 truncate text-[9px] text-[#625e58]">{GENERATION_COPY[generationStage].detail}</p>
                </div>
                {displayedParagraphs.length > 1 && (
                  <button type="button" onClick={scrollToLatestParagraph} className="flex h-8 shrink-0 items-center gap-1 px-1 text-[9px] text-[#9b8e6a] transition hover:text-[#d0c08f]" id="scroll-to-latest-btn"><ArrowDown className="h-3 w-3" />查看最新</button>
                )}
                <button type="button" onClick={onStopGeneration} className="flex h-8 shrink-0 items-center gap-1 rounded-[9px] border border-[#343028] px-2 text-[9px] text-[#756f66] transition hover:border-[#625945] hover:text-[#b8aa7c]" id="stop-next-generation-btn">{generationStage === "revealing" ? <><ArrowDown className="h-3 w-3" />立即展开</> : <><Square className="h-2.5 w-2.5" />暂停</>}</button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <motion.section
          animate={isDecisionAreaVisible ? { opacity: 0, y: 10 } : { opacity: 1, y: 0 }}
          aria-hidden={isDecisionAreaVisible}
          className={`absolute inset-x-0 bottom-0 z-20 border-t bg-[#090908] px-3 py-2.5 ${isDecisionAreaVisible ? "pointer-events-none border-transparent" : "border-[#28251f]"}`}
          id="interaction-dock"
          initial={false}
          ref={interactionDockRef}
          transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: "easeOut" }}
        >
          <button
            type="button"
            onClick={scrollToDecisionArea}
            className="flex h-11 w-full items-center gap-3 rounded-[14px] border border-[#514833] bg-[#0d0c0a] px-3 text-left transition hover:border-[#80714d] hover:bg-[#12100c]"
            id="choices-ready-dock"
            aria-controls="inline-decision-area"
            tabIndex={isDecisionAreaVisible ? -1 : 0}
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#c7b574]" />
            <span className="min-w-0 flex-1 text-[11px] font-medium text-[#cdbd88]">
              {isLoadingReport ? "人生报告正在生成" : pendingInvitation ? "人生回望已经准备好" : currentNode.isEndingNode ? "人生洞察已经准备好" : isCustomMode ? "正在写下自己的选择" : `${currentNode.choices.length} 个选择已准备好`}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[#b8a873]">
              {isLoadingReport ? "查看进度" : pendingInvitation ? "查看入口" : currentNode.isEndingNode ? "查看洞察" : isCustomMode ? "返回输入" : "查看选择"}
              <ArrowDown className="h-3.5 w-3.5" />
            </span>
          </button>
        </motion.section>
      )}

      <AnimatePresence>
        {isHistoryOpen && (
          <div className="absolute inset-0 z-50" id="biography-overlay-mask">
            <motion.button aria-label="关闭生平纪事" initial={{ opacity: 0 }} animate={{ opacity: 0.72 }} exit={{ opacity: 0 }} onClick={() => setIsHistoryOpen(false)} className="absolute inset-0 bg-black" id="biography-backdrop" />
            <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", duration: 0.28 }} className="absolute bottom-0 right-0 top-0 flex w-[84%] max-w-sm flex-col border-l border-[#302d27] bg-[#080808]" id="biography-sheet">
              <header className="flex items-center justify-between border-b border-[#282622] px-4 py-5">
                <div><p className="text-[9px] uppercase tracking-[0.18em] text-[#706b64]">Life Archive</p><h3 className="mt-1 font-serif text-[18px] text-[#e2dcd1]">生平纪事</h3></div>
                <button type="button" onClick={() => setIsHistoryOpen(false)} className="rounded-full border border-[#39352f] px-3 py-1.5 text-[10px] text-[#948e85]" id="close-history-btn">关闭</button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-4" id="biography-timeline">
                {history.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center"><History className="h-5 w-5 text-[#756a4f]" /><p className="mt-3 text-[12px] text-[#8b857c]">尚处于岁月的起点</p><p className="mt-1 text-[10px] text-[#56524d]">第一个选择会记录在这里</p></div>
                ) : (
                  <div className="ml-2 border-l border-[#39342b] pl-5">
                    {history.map((item, index) => (
                      <article key={`${item.ageInMonths ?? item.age * 12}-${index}`} className="relative pb-6" id={`timeline-item-${index}`}>
                        <span className="absolute -left-[25px] top-1 h-2 w-2 rounded-full border border-[#b5a575] bg-[#080808]" />
                        <p className="text-[9px] uppercase tracking-[0.12em] text-[#a7976b]">{formatAgeInMonths(item.ageInMonths ?? item.age * 12)} · {item.stage}</p>
                        <h4 className="mt-1.5 text-[12px] font-medium text-[#d7d0c5]">{item.title}</h4>
                        <p className="mt-1 line-clamp-3 text-[10px] leading-5 text-[#77716a]">{item.description}</p>
                        <p className="mt-2 rounded-[8px] border border-[#2f2c27] bg-[#0d0d0c] px-2 py-1.5 text-[9px] leading-4 text-[#9f978c]">选择：{item.selectedChoice}</p>
                        {item.financialState && (
                          <p className="mt-1 text-[9px] text-[#8d8265]">累计财富：{formatNetWorthWan(item.financialState.netWorthWan)}{item.financialState.isEstimated ? " · 估算" : ""}</p>
                        )}
                        <button type="button" onClick={() => { setIsHistoryOpen(false); onTimeTravel(index); }} className="mt-2 text-[9px] text-[#b6a778] hover:text-[#d4c592]" id={`timeline-travel-btn-${index}`}>回到此处重新选择 →</button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
