import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ClipboardCopy,
  Download,
  History,
  Lightbulb,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wand2
} from "lucide-react";
import {
  FinalLifeOutcome,
  FutureTrend,
  HistoryItem,
  LifePattern,
  PatternEffect,
  PatternUpgradeItem,
  UserInitialData
} from "../types";
import { downloadPoster } from "../utils/posterDownload";
import { formatAgeInMonths } from "../utils/timelineAdvance";

interface DestinyReportProps {
  outcome: FinalLifeOutcome;
  userData: UserInitialData;
  userName: string;
  history: HistoryItem[];
  onRestart: () => void;
  onTimeTravel: (targetIndex: number) => void;
}

function buildShareText(outcome: FinalLifeOutcome): string {
  const timeline = outcome.share.timeline
    .map((item) => `${item.ageLabel} ${item.title}：${item.choiceSummary}`)
    .join("\n");

  return `${outcome.share.viralTitle}
${outcome.share.covenantTitle}
${outcome.share.oneLineSummary}

AI认为，这几次选择塑造了今天的你：
${timeline}

${outcome.share.closingLine}`;
}

function formatParagraphs(paragraphs: string[]): string {
  return paragraphs.filter(Boolean).join("\n\n");
}

function buildFullReportText(outcome: FinalLifeOutcome): string {
  const report = outcome.report;
  return `${buildShareText(outcome)}

【AI人生模式分析】

【一句话总览】
${report.executiveSummary.headline}
${report.executiveSummary.patterns.map((pattern, index) => `人生模式${index + 1}：${pattern.name}\n${pattern.shortDescription}`).join("\n\n")}
${report.executiveSummary.closingLine}

【第一章：哪些选择模式一直在重复？】
${report.repeatedPatterns.map((pattern) => `### ${pattern.title}\n${formatParagraphs(pattern.paragraphs)}\n${pattern.closingLine}`).join("\n\n")}

【第二章：这些模式给你带来了什么？】
${report.patternEffects.map((effect) => `### ${effect.patternName}\n${formatParagraphs(effect.paragraphs)}\n复利：${effect.compoundReturn}\n代价：${effect.hiddenCost}\n${effect.closingLine}`).join("\n\n")}

【第三章：如果继续这样走】
${report.futureTrends.map((trend) => `### ${trend.title}\n${trend.trend}\n${trend.reason}`).join("\n\n")}

【第四章：哪些值得保留？】
${report.patternsToKeep.map((item) => `### ${item.title}\n${item.why}\n${formatParagraphs(item.paragraphs)}\n${item.closingLine}`).join("\n\n")}

【第五章：哪些值得调整？】
${report.patternsToAdjust.map((item) => `### ${item.title}\n${item.why}\n${formatParagraphs(item.paragraphs)}\n${item.closingLine}`).join("\n\n")}

【AI看到的人生】
${report.finalLifeReading.title}
${formatParagraphs(report.finalLifeReading.paragraphs)}
${report.finalLifeReading.finalSentence}`;
}

function ShareEndingPoster({
  outcome,
  posterRef
}: {
  outcome: FinalLifeOutcome;
  posterRef: React.RefObject<HTMLDivElement | null>;
}) {
  const themeClass = {
    warm_realistic: "from-stone-950 via-slate-950 to-emerald-950",
    quiet_dark: "from-slate-950 via-zinc-950 to-neutral-950",
    clean_magazine: "from-slate-100 via-white to-emerald-50"
  }[outcome.share.posterTheme];
  const isLight = outcome.share.posterTheme === "clean_magazine";
  const textMain = isLight ? "text-slate-950" : "text-slate-50";
  const textSoft = isLight ? "text-slate-600" : "text-slate-300";
  const lineColor = isLight ? "border-slate-300" : "border-white/15";

  return (
    <div
      ref={posterRef}
      className={`relative mx-auto flex aspect-[9/16] w-full max-w-[390px] flex-col overflow-hidden rounded-[28px] bg-gradient-to-br ${themeClass} p-5 shadow-2xl`}
      id="share-ending-poster"
      aria-label={outcome.share.imageAlt}
    >
      <div className={`flex items-center justify-between text-[10px] font-semibold tracking-[0.18em] ${textSoft}`}>
        <span>AI 给我的人生写了一个结局</span>
        <Sparkles className="h-3.5 w-3.5" />
      </div>

      <div className="mt-4 space-y-3">
        <h1 className={`text-[28px] font-black leading-tight ${textMain}`}>
          {outcome.share.viralTitle}
        </h1>
        <div className={`inline-flex rounded-full border px-3 py-1 text-[12px] font-semibold ${lineColor} ${textSoft}`}>
          {outcome.share.covenantTitle}
        </div>
        <p className={`text-[15px] font-medium leading-relaxed ${textSoft}`}>
          {outcome.share.oneLineSummary}
        </p>
      </div>

      <div className={`mt-4 border-t pt-3 ${lineColor}`}>
        <p className={`text-[11px] font-semibold ${textSoft}`}>AI认为，这几次选择塑造了今天的你。</p>
        <div className="mt-3 space-y-2.5">
          {outcome.share.timeline.map((item, index) => (
            <div key={`${item.ageLabel}-${item.title}-${index}`} className="grid grid-cols-[48px_22px_1fr] items-start gap-2">
              <div className={`font-mono text-[12px] font-bold ${textMain}`}>{item.ageLabel}</div>
              <div className="text-[15px] leading-none">{item.icon}</div>
              <div className="min-w-0">
                <div className={`truncate text-[13px] font-bold ${textMain}`}>{item.title}</div>
                <div className={`line-clamp-1 text-[11px] leading-relaxed ${textSoft}`}>{item.choiceSummary}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`mt-auto border-t pt-3 text-[14px] font-bold leading-relaxed ${lineColor} ${textMain}`}>
        {outcome.share.closingLine}
      </div>
    </div>
  );
}

function ChapterShell({
  title,
  icon,
  children
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

const PatternArticle: React.FC<{ pattern: LifePattern }> = ({ pattern }) => {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/45 p-4">
      <div className="text-sm font-bold text-slate-100">{pattern.title}</div>
      <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-300">
        {pattern.paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-4 border-t border-slate-800 pt-3 text-xs font-bold leading-relaxed text-emerald-200">
        {pattern.closingLine}
      </div>
    </article>
  );
};

const EffectArticle: React.FC<{ effect: PatternEffect }> = ({ effect }) => {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/45 p-4">
      <div className="text-sm font-bold text-slate-100">{effect.patternName}</div>
      <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-300">
        {effect.paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-4 grid gap-2 text-xs md:grid-cols-2">
        <div className="rounded-lg bg-emerald-500/10 p-3 text-emerald-100">
          <div className="mb-1 font-bold">带来的复利</div>
          <div className="leading-relaxed">{effect.compoundReturn}</div>
        </div>
        <div className="rounded-lg bg-amber-500/10 p-3 text-amber-100">
          <div className="mb-1 font-bold">隐藏的代价</div>
          <div className="leading-relaxed">{effect.hiddenCost}</div>
        </div>
      </div>
      <div className="mt-4 text-xs font-bold leading-relaxed text-slate-100">{effect.closingLine}</div>
    </article>
  );
};

function TrendList({ trends }: { trends: FutureTrend[] }) {
  return (
    <div className="space-y-3">
      {trends.map((trend, index) => (
        <article key={`${trend.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/45 p-4 text-xs leading-relaxed">
          <div className="text-sm font-bold text-slate-100">{trend.title}</div>
          <p className="mt-2 text-slate-300">{trend.trend}</p>
          <p className="mt-2 text-slate-400">{trend.reason}</p>
        </article>
      ))}
    </div>
  );
}

function UpgradeList({ items }: { items: PatternUpgradeItem[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <article key={`${item.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/45 p-4 text-xs leading-relaxed">
          <div className="text-sm font-bold text-slate-100">{item.title}</div>
          <p className="mt-2 font-semibold text-emerald-200">{item.why}</p>
          <div className="mt-3 space-y-3 text-slate-300">
            {item.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
          </div>
          <p className="mt-4 border-t border-slate-800 pt-3 font-bold text-slate-100">{item.closingLine}</p>
        </article>
      ))}
    </div>
  );
}

export default function DestinyReport({
  outcome,
  userData,
  userName,
  history,
  onRestart,
  onTimeTravel
}: DestinyReportProps) {
  const posterRef = useRef<HTMLDivElement | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "saving" | "failed">("idle");

  const copyReport = () => {
    navigator.clipboard.writeText(buildFullReportText(outcome))
      .then(() => alert("已复制人生终章与人生模式分析。"))
      .catch(() => alert("复制失败，可以手动长按文本复制。"));
  };

  const savePoster = async () => {
    setDownloadState("saving");
    try {
      await downloadPoster({
        element: posterRef.current,
        fileName: outcome.share.downloadFileName,
        pixelRatio: 2
      });
      setDownloadState("idle");
    } catch (error) {
      console.error(error);
      setDownloadState("failed");
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-950 px-4 py-5 text-sans hide-scrollbar" id="destiny-report-root">
      <div className="min-h-[calc(100vh-40px)] space-y-3">
        <ShareEndingPoster outcome={outcome} posterRef={posterRef} />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={savePoster}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-slate-950 transition active:scale-95 disabled:opacity-70"
            disabled={downloadState === "saving"}
          >
            <Download className="h-4 w-4" />
            {downloadState === "saving" ? "生成图片中" : "下载图片"}
          </button>
          <button
            type="button"
            onClick={copyReport}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs font-bold text-slate-100 transition active:scale-95"
          >
            <ClipboardCopy className="h-4 w-4 text-emerald-300" />
            复制文案
          </button>
        </div>

        {downloadState === "failed" && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            图片下载失败，可以先截图保存这张人生终章。
          </div>
        )}
      </div>

      <div className="space-y-7 pb-8 pt-6" id="life-pattern-report">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-emerald-300">LIFE PATTERN ANALYSIS</div>
          <h2 className="text-xl font-black text-slate-50">AI 人生模式分析</h2>
          <p className="text-xs leading-relaxed text-slate-400">
            这不是人格分析，而是根据你的经历和选择整理出的人生运行机制。现实命题：{userData.currentSituation || "未填写"}。
          </p>
          {userName && <p className="text-[11px] text-slate-500">体验者：{userName}</p>}
        </div>

        <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="text-[11px] font-bold tracking-[0.14em] text-emerald-200">一句话总览</div>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-100">{outcome.report.executiveSummary.headline}</p>
          <div className="mt-4 space-y-2">
            {outcome.report.executiveSummary.patterns.map((pattern, index) => (
              <div key={`${pattern.name}-${index}`} className="rounded-lg bg-slate-950/40 p-3">
                <div className="text-xs font-bold text-emerald-200">人生模式{index + 1}：{pattern.name}</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-300">{pattern.shortDescription}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs font-bold leading-relaxed text-slate-100">{outcome.report.executiveSummary.closingLine}</p>
        </section>

        <ChapterShell title="第一章：哪些选择模式一直在重复？" icon={<Lightbulb className="h-4 w-4 text-emerald-300" />}>
          <div className="space-y-3">
            {outcome.report.repeatedPatterns.map((pattern, index) => (
              <PatternArticle key={`${pattern.title}-${index}`} pattern={pattern} />
            ))}
          </div>
        </ChapterShell>

        <ChapterShell title="第二章：这些模式给你带来了什么？" icon={<TrendingUp className="h-4 w-4 text-emerald-300" />}>
          <div className="space-y-3">
            {outcome.report.patternEffects.map((effect, index) => (
              <EffectArticle key={`${effect.patternName}-${index}`} effect={effect} />
            ))}
          </div>
        </ChapterShell>

        <ChapterShell title="第三章：如果继续这样走" icon={<Wand2 className="h-4 w-4 text-emerald-300" />}>
          <TrendList trends={outcome.report.futureTrends} />
        </ChapterShell>

        <ChapterShell title="第四章：哪些值得保留？" icon={<Sparkles className="h-4 w-4 text-emerald-300" />}>
          <UpgradeList items={outcome.report.patternsToKeep} />
        </ChapterShell>

        <ChapterShell title="第五章：哪些值得调整？" icon={<RefreshCw className="h-4 w-4 text-emerald-300" />}>
          <UpgradeList items={outcome.report.patternsToAdjust} />
        </ChapterShell>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <Sparkles className="h-4 w-4 text-emerald-300" />
            AI看到的人生
          </h3>
          <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-4 text-xs leading-relaxed text-slate-300">
            <div className="text-sm font-bold text-slate-100">{outcome.report.finalLifeReading.title}</div>
            <div className="mt-3 space-y-3">
              {outcome.report.finalLifeReading.paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <p className="mt-4 text-sm font-black leading-relaxed text-emerald-200">{outcome.report.finalLifeReading.finalSentence}</p>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <History className="h-4 w-4 text-slate-400" />
            一生流转大事记
          </h3>
          <div className="space-y-2">
            {history.map((item, index) => {
              const canTravel = index < history.length - 1;
              return (
                <div key={`${item.ageInMonths ?? item.age * 12}-${item.title}-${index}`} className="flex gap-3 rounded-lg border border-slate-900 bg-slate-900/30 p-3">
                  <div className="w-16 shrink-0 font-mono text-xs font-bold text-emerald-300">{formatAgeInMonths(item.ageInMonths ?? item.age * 12)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-100">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{item.description}</div>
                    <div className="mt-1 text-[10px] text-emerald-200">选择：{item.selectedChoice}</div>
                  </div>
                  {canTravel && (
                    <button
                      type="button"
                      onClick={() => onTimeTravel(index)}
                      className="self-start rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-100"
                    >
                      回到此处
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={onRestart}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3.5 text-xs font-black text-slate-950"
        >
          <RefreshCw className="h-4 w-4" />
          重启一次新人生
        </motion.button>
      </div>
    </div>
  );
}
