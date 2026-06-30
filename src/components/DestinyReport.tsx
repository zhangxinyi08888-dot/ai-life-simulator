import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Award, RefreshCw, Scroll, Brain, Heart,
  Sparkles, Compass, Lightbulb, ClipboardCopy,
  GitFork, TrendingUp, Sun, ChevronRight, History
} from "lucide-react";
import { PersonalityInsight, UserInitialData, HistoryItem } from "../types";

interface DestinyReportProps {
  insight: PersonalityInsight;
  userData: UserInitialData;
  userName: string;
  history: HistoryItem[];
  onRestart: () => void;
  onTimeTravel: (targetIndex: number) => void;
}

type AdviceTab = "growth" | "decision" | "wellness";

export default function DestinyReport({
  insight,
  userData,
  userName,
  history,
  onRestart,
  onTimeTravel
}: DestinyReportProps) {
  const [activeTab, setActiveTab] = useState<AdviceTab>("growth");
  
  const handleCopyTextReport = () => {
    const textReport = `【AI人生模拟器 • 一生契约报告】
体验者: ${userName}
终极人生称号: ${insight.lifeTitle}
人生墓志铭: "${insight.epitaph}"

【一生轨迹概要】:
${history.map((h, i) => `${i + 1}. ${h.age}岁 [${h.title}]: ${h.selectedChoice}`).join("\n")}

【真我性格评估】:
${insight.personalityTraits.map(t => `- ${t.trait} (度数 ${t.score}%): ${t.description}`).join("\n")}

【心理动机建议】:
${insight.detailedAnalysis}

【对照现实温情指引】:
${insight.realLifeAdvice}

【高级成长、抉择与自爱建议】:
- 个人潜能唤醒: ${insight.growthAdvice}
- 重大决策学智慧: ${insight.decisionAdvice}
- 能量管理身心指引: ${insight.wellnessAdvice}

宿命如流，终复流转。快来测测你模拟的一生吧！`;

    navigator.clipboard.writeText(textReport)
      .then(() => {
        alert("已成功复制完整的一生判定报告到剪贴板！包含：性格评估、现实投射、个人成长破局、重大决策机制及身心润养指南。快去与好友分享命运的秘密吧。");
      })
      .catch((err) => {
        console.error("复制失败", err);
        alert("复制报告到剪贴板失败，可以直接长按文本进行手动复制哦。");
      });
  };

  return (
    <div className="w-full h-full flex flex-col justify-between bg-slate-950 px-4 py-6 overflow-y-auto hide-scrollbar text-sans" id="destiny-report-root">
      
      {/* Visual top logo plate */}
      <div className="relative text-center pb-5 border-b border-slate-900" id="report-title-plate">
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-purple-500/10 to-transparent pointer-events-none" />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-600/10 border border-violet-500/20 text-violet-300 text-[10px] uppercase font-mono mb-3"
          id="seal-badge"
        >
          <Award className="w-3.5 h-3.5 text-violet-400" />
          DST-ORACLE • 终局命运封印
        </motion.div>

        <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">
          EPITAPH OF {userName.toUpperCase()}
        </p>
        
        <h2 className="text-sm font-semibold text-slate-400 mt-0.5">契约主终极人生称号</h2>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-300 py-1.5"
          id="stellar-title"
        >
          {insight.lifeTitle}
        </motion.div>

        {/* Poetic Epitaph container */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-3.5 max-w-xs mx-auto py-2.5 px-4 rounded-xl bg-slate-900/60 border border-slate-800/80 italic text-xs text-slate-300 leading-relaxed font-serif relative"
          id="gravestone-epitaph"
        >
          <span className="absolute -top-1.5 left-4 px-1.5 bg-slate-950 font-serif text-[9px] text-indigo-400">人生志铭刻辞</span>
          “ {insight.epitaph} ”
        </motion.div>
      </div>

      <div className="space-y-6 pt-5" id="report-details-body">
        
        {/* 1. Psychological Trait Sliders */}
        <div className="space-y-3.5" id="traits-group">
          <div className="flex items-center gap-1.5 px-1">
            <Brain className="w-4 h-4 text-violet-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">真我五维性格谱系</h3>
          </div>

          <div className="space-y-3" id="traits-list">
            {insight.personalityTraits.map((t, index) => {
              // Custom neon gradients for each slider
              const gradients = [
                "from-violet-500 to-indigo-500",
                "from-purple-500 to-pink-500",
                "from-amber-400 to-orange-500",
                "from-cyan-400 to-teal-500",
                "from-emerald-500 to-green-600"
              ];
              const textColors = [
                "text-indigo-400",
                "text-pink-400",
                "text-amber-400",
                "text-teal-400",
                "text-green-400"
              ];
              const gridCol = gradients[index % gradients.length];
              const textCol = textColors[index % textColors.length];

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="bg-slate-900/30 rounded-2xl p-3.5 border border-slate-900 space-y-2"
                  id={`trait-card-${index}`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-200" id={`trait-name-${index}`}>{t.trait}</span>
                    <span className={`font-mono font-bold ${textCol}`} id={`trait-score-${index}`}>{t.score}%</span>
                  </div>

                  {/* Horizontal visual progress */}
                  <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden" id={`trait-bar-bg-${index}`}>
                    <motion.div
                      id={`trait-bar-fill-${index}`}
                      className={`h-full bg-gradient-to-r ${gridCol}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${t.score}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>

                  <p className="text-[11px] text-slate-400 leading-normal text-justify" id={`trait-desc-${index}`}>
                    {t.description}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* 2. Detailed Motives Analysis */}
        <div className="space-y-2.5 bg-slate-900/50 backdrop-blur-sm rounded-2xl p-4.5 border border-slate-900" id="deep-motives-analysis">
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-slate-300">
            <Scroll className="w-4 h-4 text-indigo-400" />
            <h3>宿命心理抉择透视</h3>
          </div>
          <div className="text-xs text-slate-300 space-y-3 leading-relaxed text-justify animate-fade-in" id="detailed-analysis-text">
            {insight.detailedAnalysis.split("\n\n").map((para, idx) => (
              <p key={idx} className="indent-6 text-slate-300 leading-relaxed font-serif">
                {para}
              </p>
            ))}
          </div>
        </div>

        {/* 3. Advanced Advice Hub - Interactive Growth, Decision & Wellness Tabs */}
        <div className="space-y-3 bg-slate-900/40 border border-slate-900/80 rounded-2xl p-4.5" id="sophisticated-suggestions-system">
          <h3 className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5 px-0.5">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>AI命运成长优化系统 (多维跃迁)</span>
          </h3>

          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-medium" id="opinion-tab-bar">
            <button
              id="tab-growth-btn"
              type="button"
              onClick={() => setActiveTab("growth")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-center rounded-lg transition-all ${
                activeTab === "growth" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              成长突破
            </button>
            <button
              id="tab-decision-btn"
              type="button"
              onClick={() => setActiveTab("decision")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-center rounded-lg transition-all ${
                activeTab === "decision" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <GitFork className="w-3.5 h-3.5" />
              决策风向
            </button>
            <button
              id="tab-wellness-btn"
              type="button"
              onClick={() => setActiveTab("wellness")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-center rounded-lg transition-all ${
                activeTab === "wellness" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              身心润养
            </button>
          </div>

          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-900 min-h-[140px] flex flex-col justify-between" id="tab-interior-content">
            <AnimatePresence mode="wait">
              {activeTab === "growth" && (
                <motion.div
                  key="growth-interior"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2 text-xs text-slate-300 leading-relaxed text-justify"
                >
                  <div className="flex gap-1.5 items-center text-[10px] uppercase font-mono tracking-wider text-emerald-400 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    潜意识解锁与特质升华
                  </div>
                  <p className="font-serif text-slate-200 leading-relaxed">
                    {insight.growthAdvice}
                  </p>
                  <div className="pt-2 flex items-center text-[10px] text-slate-500 font-sans gap-0.5 border-t border-slate-900/60">
                    <ChevronRight className="w-3 h-3 text-indigo-400" />
                    建议：在接下来的三个月，着重跳出该舒适区，探索未开拓的能力边界。
                  </div>
                </motion.div>
              )}

              {activeTab === "decision" && (
                <motion.div
                  key="decision-interior"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2 text-xs text-slate-300 leading-relaxed text-justify"
                >
                  <div className="flex gap-1.5 items-center text-[10px] uppercase font-mono tracking-wider text-amber-400 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    认知偏误对抗与决策升级
                  </div>
                  <p className="font-serif text-slate-200 leading-relaxed">
                    {insight.decisionAdvice}
                  </p>
                  <div className="pt-2 flex items-center text-[10px] text-slate-500 font-sans gap-0.5 border-t border-slate-900/60">
                    <ChevronRight className="w-3 h-3 text-indigo-400" />
                    决策模型：推荐使用【得失概率矩阵法】平衡内耗，理性克服损失厌恶。
                  </div>
                </motion.div>
              )}

              {activeTab === "wellness" && (
                <motion.div
                  key="wellness-interior"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2 text-xs text-slate-300 leading-relaxed text-justify"
                >
                  <div className="flex gap-1.5 items-center text-[10px] uppercase font-mono tracking-wider text-rose-400 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                    高频心力润养与健康调适
                  </div>
                  <p className="font-serif text-slate-200 leading-relaxed">
                    {insight.wellnessAdvice}
                  </p>
                  <div className="pt-2 flex items-center text-[10px] text-slate-500 font-sans gap-0.5 border-t border-slate-900/60">
                    <ChevronRight className="w-3 h-3 text-indigo-400" />
                    能量贴士：避免为他人的杂音消耗自我。建议每日留15分钟空白冥想。
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 4. Personalized Real-Life Advice */}
        <div className="space-y-2.5 bg-slate-900/50 backdrop-blur-sm rounded-2xl p-4.5 border border-slate-900/40 relative overflow-hidden" id="real-advice-panel">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-violet-400">
            <Lightbulb className="w-4 h-4 animate-pulse" />
            <h3>对照现实 • 破局密信与温情指引</h3>
          </div>
          
          {/* User's original dilemma recap block */}
          <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-[10px] text-slate-400 leading-relaxed">
            <span className="font-semibold text-indigo-400">您的现实命题: </span>
            “{userData.currentSituation}”
          </div>

          <div className="text-xs text-slate-300 space-y-3 leading-relaxed text-justify font-sans" id="real-advice-text">
            {insight.realLifeAdvice.split("\n\n").map((para, idx) => (
              <p key={idx} className="indent-6 text-slate-200">
                {para}
              </p>
            ))}
          </div>
        </div>

        {/* 5. Complete Simulated Timeline Summary (Toggle/Expandable list) */}
        <div className="bg-slate-900/30 rounded-2xl p-4 border border-slate-900 space-y-3" id="timeline-summary-panel">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-slate-400" /> 一生流转大事记 ({history.length}个岁月)
          </h4>
          <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1 text-[11px]" id="timeline-mini-list">
            {history.map((node, i) => {
              const canTravel = i < history.length - 1; // Restore earlier interactive moments
              return (
                <div key={i} className="flex gap-2 border-b border-slate-950 pb-2.5 last:border-0 last:pb-0 items-start justify-between" id={`timeline-mini-item-${i}`}>
                  <div className="flex gap-2 flex-1 min-w-0">
                    <span className="font-mono font-bold text-indigo-400 w-10 flex-shrink-0 mt-0.5">{node.age} 岁</span>
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="font-semibold text-slate-200 text-[11px] truncate">{node.title}</div>
                      <div className="text-slate-400 leading-relaxed text-[10px] line-clamp-2">{node.description}</div>
                      <div className="text-[9px] text-indigo-300 bg-indigo-950/40 border border-indigo-900/30 px-1.5 py-0.5 rounded inline-block mt-1">核心抉择: {node.selectedChoice}</div>
                    </div>
                  </div>
                  {canTravel && (
                    <button
                      id={`timeline-travel-from-end-btn-${i}`}
                      type="button"
                      onClick={() => onTimeTravel(i)}
                      className="flex-shrink-0 px-2 py-1 rounded bg-violet-600/80 hover:bg-violet-500 text-white font-bold text-[9px] flex items-center gap-0.5 transition-all shadow-sm active:scale-95 mt-1"
                      title="回到此处重选，改写平行支线和后续结局"
                    >
                      <History className="w-2.5 h-2.5" />
                      回到此处
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Launcher/Reset Area */}
      <div className="mt-8 space-y-2.5" id="report-action-buttons">
        <button
          id="copy-text-report-btn"
          type="button"
          onClick={handleCopyTextReport}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-slate-100 text-xs font-semibold border border-slate-800 transition-all shadow-md active:scale-98"
        >
          <ClipboardCopy className="w-4 h-4 text-violet-400" />
          复制全文人格报告 • 赠友分享
        </button>

        <button
          id="restart-simulator-btn"
          type="button"
          onClick={onRestart}
          className="w-full flex items-center justify-center gap-1.5 py-3.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-lg active:scale-98 shadow-indigo-950/40"
        >
          <RefreshCw className="w-4 h-4" />
          重回红尘 • 起航全新人生
        </button>
      </div>

    </div>
  );
}
