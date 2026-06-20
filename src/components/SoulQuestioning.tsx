import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HelpCircle, ChevronRight, MessageSquare, ClipboardCheck, ArrowLeft } from "lucide-react";
import { QuestionTurn, QuestionItem } from "../types";

interface SoulQuestioningProps {
  questions: QuestionItem[];
  onSubmitAnswers: (answers: QuestionTurn[]) => void;
  isLoading: boolean;
  onGoBack: () => void;
}

export default function SoulQuestioning({ questions, onSubmitAnswers, isLoading, onGoBack }: SoulQuestioningProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState<string[]>(["", "", ""]);

  const handleTextChange = (text: string) => {
    const updated = [...responses];
    updated[currentStep] = text;
    setResponses(updated);
  };

  const handleSelectPreset = (presetText: string) => {
    handleTextChange(presetText);
  };

  const handleNext = () => {
    if (currentStep < 2) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Create turns
      const turns: QuestionTurn[] = questions.map((q, idx) => ({
        id: idx + 1,
        question: q.question,
        answer: responses[idx] || "我暂时记不清具体细节，请基于我已提供的信息保持克制，不要替我编造。"
      }));
      onSubmitAnswers(turns);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    } else {
      onGoBack();
    }
  };

  const currentQuestionItem = questions[currentStep];
  const currentQuestionText = currentQuestionItem?.question || "";
  const currentPresetOptions = currentQuestionItem?.suggestions || [];
  const currentAnswer = responses[currentStep];

  return (
    <div className="w-full h-full flex flex-col justify-between" id="questioning-screen">
      {/* Step Header Indicator */}
      <div className="pt-5 px-4" id="step-indicator">
        <div className="flex justify-between items-center mb-1.5" id="step-progress-row">
          <button
            id="prev-step-button"
            type="button"
            onClick={handlePrev}
            className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 font-sans"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> 返回上步
          </button>
          <span className="text-[10px] uppercase font-mono tracking-wider text-indigo-400">
            背景补全进度 ({currentStep + 1} / 3)
          </span>
        </div>
        
        {/* Progress horizontal line */}
        <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden" id="progress-bar-container">
          <motion.div
            id="progress-bar-fill"
            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
            initial={{ width: "33%" }}
            animate={{ width: `${(currentStep + 1) * 33.33}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Main Question Card View */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0 flex flex-col justify-start" id="question-card-wrapper">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="bg-slate-900/60 rounded-2xl p-5 border border-slate-800/80 space-y-5"
            id={`question-card-${currentStep}`}
          >
            <div className="flex items-start gap-2.5">
              <span className="p-2 rounded-xl bg-violet-500/10 text-violet-400 flex-shrink-0" id={`sparkle-icon-${currentStep}`}>
                <HelpCircle className="w-5 h-5" />
              </span>
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-violet-400">剧本关键背景补全 • 第 {currentStep + 1} 问</span>
                <h2 className="text-base font-medium leading-relaxed text-slate-100" id={`question-text-${currentStep}`}>
                  {currentQuestionText}
                </h2>
              </div>
            </div>

            {/* Answers Custom TextArea */}
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400">补充当时真实情况</label>
              <textarea
                id={`answer-textarea-${currentStep}`}
                rows={3}
                placeholder="写下当时真实发生的事、你的状态、能做和不能做的事..."
                value={currentAnswer}
                onChange={(e) => handleTextChange(e.target.value)}
                className="w-full text-xs bg-slate-950 border border-slate-800/90 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl p-3 text-slate-200 outline-none resize-none leading-relaxed"
              />
            </div>

            {/* Presets suggestions to tap on mobile */}
            {currentPresetOptions.length > 0 && (
              <div className="space-y-2 mt-1" id="presets-container">
                <span className="text-[10px] text-slate-500 flex items-center gap-1 font-sans">
                  <MessageSquare className="w-3 h-3" /> 快速补全选项（点击选择后可继续修改）
                </span>
                <div className="space-y-1.5" id="presets-list">
                  {currentPresetOptions.map((option, index) => (
                    <button
                      id={`preset-option-${currentStep}-${index}`}
                      key={index}
                      type="button"
                      onClick={() => handleSelectPreset(option)}
                      className={`w-full text-left p-2.5 text-xs rounded-xl border transition-all leading-tight ${
                        currentAnswer === option
                          ? "bg-indigo-950/40 border-indigo-500/80 text-indigo-200"
                          : "bg-slate-950 hover:bg-slate-950/70 border-slate-800 text-slate-400"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Launcher Area */}
      <div className="p-4 border-t border-slate-900 bg-slate-950/90 backdrop-blur-md" id="question-launcher-area">
        <button
          id={`answer-submit-btn-${currentStep}`}
          type="button"
          onClick={handleNext}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-1.5 py-3.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-semibold transition-all disabled:opacity-60 shadow-lg shadow-indigo-950/40"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              正在根据真实背景生成起点...
            </>
          ) : currentStep < 2 ? (
            <>
              保存补充 • 下一问
              <ChevronRight className="w-4 h-4" />
            </>
          ) : (
            <>
              <ClipboardCheck className="w-4 h-4" />
              开始生成平行人生
            </>
          )}
        </button>
      </div>
    </div>
  );
}
