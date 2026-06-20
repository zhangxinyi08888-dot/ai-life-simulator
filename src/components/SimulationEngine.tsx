import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Heart, BookOpen, DollarSign, Users, Activity, 
  Sparkles, History, Send, MessageSquarePlus, Milestone, Compass
} from "lucide-react";
import { SimulationNode, LifeAttributes, HistoryItem } from "../types";

interface SimulationEngineProps {
  currentNode: SimulationNode;
  history: HistoryItem[];
  nodeCount: number;
  onSelectChoice: (choiceText: string) => void;
  isLoadingNext: boolean;
  isLoadingReport: boolean;
  onTimeTravel: (targetAge: number) => void;
}

export default function SimulationEngine({
  currentNode,
  history,
  nodeCount,
  onSelectChoice,
  isLoadingNext,
  isLoadingReport,
  onTimeTravel
}: SimulationEngineProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");

  const attributesList = [
    { key: "happiness", name: "幸福度", icon: Heart, color: "from-pink-500 to-rose-500", textCol: "text-rose-400" },
    { key: "intelligence", name: "才智度", icon: BookOpen, color: "from-purple-500 to-indigo-500", textCol: "text-indigo-400" },
    { key: "wealth", name: "财富度", icon: DollarSign, color: "from-amber-400 to-yellow-500", textCol: "text-amber-400" },
    { key: "relation", name: "人缘值", icon: Users, color: "from-cyan-400 to-teal-500", textCol: "text-teal-400" },
    { key: "health", name: "健康值", icon: Activity, color: "from-emerald-500 to-green-600", textCol: "text-green-400" }
  ];

  // Helper to determine the attribute delta/change from the previous history item if available
  const getAttributeDelta = (key: keyof LifeAttributes): number | null => {
    if (history.length === 0) return null;
    return null; // For simplicity we just show the values, but if someone wants it we can calculate if old node was saved.
  };

  const handlePresetSelect = (choiceText: string) => {
    onSelectChoice(choiceText);
    setIsCustomMode(false);
    setCustomText("");
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customText.trim()) return;
    onSelectChoice(`自定义抉择: ${customText.trim()}`);
    setIsCustomMode(false);
    setCustomText("");
  };

  return (
    <div className="w-full h-full flex flex-col justify-between relative bg-slate-950 font-sans" id="engine-panel">
      
      {/* Top sticky attribute bar */}
      <div className="bg-slate-900/80 backdrop-blur-md px-3 py-2.5 border-b border-slate-800/80 flex flex-col gap-1.5" id="attribute-header">
        <div className="flex justify-between items-center px-1" id="top-stage-meta">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-200" id="current-stage-badge">
              生命阶段: <span className="text-indigo-400">{currentNode.stage}</span>
            </span>
          </div>
          <motion.button
            id="toggle-history-btn"
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/80 text-slate-300 hover:text-slate-100 text-[10px] transition-all"
          >
            <History className="w-3 h-3" />
            生平纪事 ({history.length})
          </motion.button>
        </div>

        {/* High performance 5-dimension indicators */}
        <div className="grid grid-cols-5 gap-1.5" id="stats-meters-grid">
          {attributesList.map(({ key, name, icon: Icon, color, textCol }) => {
            const val = currentNode.attributes[key as keyof LifeAttributes] ?? 50;
            return (
              <div key={key} className="bg-slate-950/60 rounded-xl p-1.5 border border-slate-900 flex flex-col items-center justify-center relative overflow-hidden" id={`attribute-card-${key}`}>
                <div className="flex items-center gap-0.5 mb-1 text-[10px] text-slate-400" id={`attribute-label-${key}`}>
                  <Icon className={`w-3 h-3 ${textCol}`} />
                  <span>{name}</span>
                </div>
                
                {/* Visual Circle progress or bold pill */}
                <span className={`text-xs font-bold ${textCol}`} id={`attribute-value-${key}`}>
                  {val}
                </span>

                {/* mini bar base */}
                <div className="w-full h-1 bg-slate-900 rounded-full mt-1.5 overflow-hidden" id={`attribute-bar-bg-${key}`}>
                  <motion.div
                    id={`attribute-bar-fill-${key}`}
                    className={`h-full bg-gradient-to-r ${color}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${val}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Screen: Story Reading Panel */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4" id="novel-scrollable-body">
        {/* Story node narrative header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          key={currentNode.age}
          className="space-y-3"
          id="active-chapter-head"
        >
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-mono font-bold">
            <Milestone className="w-4 h-4" />
            <span>AGE {currentNode.age} • 第 {nodeCount} 个抉择关卡</span>
          </div>

          <h2 className="text-xl font-serif font-semibold text-slate-100 border-l-4 border-indigo-500 pl-2.5 leading-none" id="chapter-node-title">
            {currentNode.title}
          </h2>

          <div 
            className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-4.5 border border-slate-900 text-slate-300 text-sm leading-relaxed space-y-3 font-serif select-none"
            id="chapter-node-body"
          >
            {currentNode.description.split("\n\n").map((para, i) => (
              <p key={i} className="text-justify indent-6 tracking-wide text-slate-200">
                {para}
              </p>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Interactive Command Control Panel (Choices or custom input) */}
      <div className="p-4 border-t border-slate-900 bg-slate-950/95 backdrop-blur-md space-y-3" id="interaction-dock">
        {isLoadingNext || isLoadingReport ? (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-400" id="loading-next-spinner">
            <div className="w-8 h-8 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
            <div className="text-[11px] font-mono tracking-widest uppercase text-indigo-400 animate-pulse">
              {isLoadingReport ? "一生报告生成中..." : "时空线收束整理中..."}
            </div>
            <p className="text-[10px] text-slate-500 max-w-xs text-center leading-normal">
              {isLoadingReport
                ? "AI正在整理你的完整人生轨迹、关键选择和终局属性，生成最终洞察报告。"
                : "AI正在根据你先前的选择、出生时间和宿命因果，推演下一个人生年份的故事。"}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {!isCustomMode ? (
              <motion.div
                key="preset-options"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-2.5"
                id="preset-choices-container"
              >
                {/* Normal choice buttons */}
                {currentNode.choices.map((choice) => (
                  <button
                    id={`choice-btn-${choice.id}`}
                    key={choice.id}
                    type="button"
                    onClick={() => handlePresetSelect(choice.text)}
                    className="w-full text-left bg-gradient-to-r from-slate-900 to-slate-900/80 hover:from-slate-900/60 hover:to-indigo-950/20 border border-slate-800 hover:border-indigo-500/50 rounded-xl p-3 text-xs text-slate-200 transition-all flex items-start gap-2.5 relative group"
                  >
                    <span className="flex-shrink-0 w-5 h-5 rounded-lg bg-indigo-500/10 text-indigo-300 font-mono flex items-center justify-center text-[10px] font-semibold border border-indigo-500/20 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      {choice.id}
                    </span>
                    <div className="flex-1 pr-16 leading-normal text-slate-300 group-hover:text-slate-100">
                      {choice.text}
                    </div>
                    {choice.impactSummary && (
                      <span className="absolute right-3 top-3 text-[9px] bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800 text-slate-500 group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-all">
                        {choice.impactSummary}
                      </span>
                    )}
                  </button>
                ))}

                {/* Custom active input trigger */}
                {!currentNode.isEndingNode && (
                  <button
                    id="trigger-custom-input-btn"
                    type="button"
                    onClick={() => setIsCustomMode(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-xl bg-slate-900/30 hover:bg-slate-900/50 border border-dashed border-slate-800 hover:border-violet-500/50 text-violet-400 transition-all"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    写下我特定的突破性想法 (自定义抉择)
                  </button>
                )}

                {currentNode.isEndingNode && (
                  <button
                    id="ending-report-btn"
                    type="button"
                    onClick={() => onSelectChoice("安详落幕，查看一生洞察")}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold transition-all shadow-lg shadow-indigo-950/50"
                  >
                    <Sparkles className="w-4 h-4 animate-pulse" />
                    安详度过此生 • 查看命运深层评估
                  </button>
                )}
              </motion.div>
            ) : (
              <motion.form
                key="custom-input-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleCustomSubmit}
                className="space-y-3"
                id="custom-decision-box"
              >
                <div className="flex justify-between items-center px-1 text-xs">
                  <span className="text-violet-400 font-medium flex items-center gap-1">
                    <Compass className="w-3.5 h-3.5" /> 我自定的人生转轨行为:
                  </span>
                  <button
                    id="cancel-custom-choice-btn"
                    type="button"
                    onClick={() => setIsCustomMode(false)}
                    className="text-slate-500 hover:text-slate-300 text-[10px]"
                  >
                    取消，选回默认项
                  </button>
                </div>
                
                <div className="flex gap-2">
                  <input
                    id="custom-action-input"
                    type="text"
                    required
                    maxLength={100}
                    placeholder="例如: 拒绝父母的安排，拿着吉他去酒吧驻唱，结识志同道合之人..."
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-3 text-xs text-slate-100 outline-none"
                  />
                  <button
                    id="submit-custom-action-btn"
                    type="submit"
                    className="bg-violet-600 hover:bg-violet-500 p-3 rounded-xl text-white transition-all"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 text-center">
                  * 触发自定义：AI人生模拟不设标准答案，根据您的任何脑洞皆可无缝衍生。
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        )}
      </div>

      {/* Slide-over Biography Log Panel (History Drawer) */}
      <AnimatePresence>
        {isHistoryOpen && (
          <div className="absolute inset-0 z-50 flex" id="biography-overlay-mask">
            {/* Backdrop cover */}
            <motion.div
              id="biography-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="absolute inset-0 bg-black pointer-events-auto"
            />

            {/* Sidebar drawer sheet */}
            <motion.div
              id="biography-sheet"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3 }}
              className="absolute right-0 top-0 bottom-0 w-4/5 max-w-sm bg-slate-900 border-l border-slate-800 flex flex-col pointer-events-auto shadow-2xl"
            >
              {/* Drawer Header */}
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/60">
                <span className="text-xs font-semibold text-slate-200 uppercase tracking-widest flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-400" />
                  <span>毕生岁月回顾纪事</span>
                </span>
                <button
                  id="close-history-btn"
                  type="button"
                  onClick={() => setIsHistoryOpen(false)}
                  className="text-slate-400 hover:text-slate-200 text-xs"
                >
                  关闭
                </button>
              </div>

              {/* Drawer Scroll body with custom timeline design */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4" id="biography-timeline">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs text-center space-y-2">
                    <p>尚处于岁月的起点。</p>
                    <p className="text-[10px] text-slate-600">做出您的第一个重大决定，生平事迹便会记录在此。</p>
                  </div>
                ) : (
                  <div className="relative border-l border-indigo-500/20 ml-2.5 pl-4 space-y-5" id="timeline-stack">
                    {history.map((item, idx) => (
                      <div key={idx} className="relative group" id={`timeline-item-${idx}`}>
                        {/* Circle dot anchor on timeline */}
                        <div className="absolute -left-[21.5px] top-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-slate-900" />
                        
                        <div className="space-y-1" id={`timeline-content-${idx}`}>
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className="font-mono text-indigo-400 font-bold" id={`timeline-age-${idx}`}>
                              {item.age} 岁
                            </span>
                            <span className="text-slate-500" id={`timeline-stage-${idx}`}>
                              • {item.stage}
                            </span>
                          </div>
                          
                          <h4 className="text-xs font-medium text-slate-100" id={`timeline-title-${idx}`}>
                            {item.title}
                          </h4>
                          
                          <p className="text-[11px] text-slate-400 leading-relaxed max-h-16 overflow-y-auto hide-scrollbar text-justify" id={`timeline-desc-${idx}`}>
                            {item.description}
                          </p>
                          
                          <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5" id={`timeline-decision-dock-${idx}`}>
                            <div className="inline-block text-[10px] text-indigo-300 bg-indigo-950/40 border border-indigo-900/30 px-2 py-0.5 rounded-md" id={`timeline-decision-${idx}`}>
                              抉择: <span className="font-semibold text-slate-200">{item.selectedChoice}</span>
                            </div>
                            <button
                              id={`timeline-travel-btn-${idx}`}
                              type="button"
                              onClick={() => {
                                setIsHistoryOpen(false);
                                onTimeTravel(item.age);
                              }}
                              className="px-2.5 py-1 rounded bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-[9px] flex items-center gap-0.5 transition-all shadow-sm active:scale-95"
                            >
                              <History className="w-2.5 h-2.5" />
                              时光逆流 回到此岁
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
