import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, MessageSquare, Sparkles } from "lucide-react";
import { QuestionItem, QuestionTurn } from "../types";

interface SoulQuestioningProps {
  questions: QuestionItem[];
  onSubmitAnswers: (answers: QuestionTurn[]) => void;
  isLoading: boolean;
  onGoBack: () => void;
}

export default function SoulQuestioning({ questions, onSubmitAnswers, isLoading, onGoBack }: SoulQuestioningProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState<string[]>(["", "", ""]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [currentStep]);

  const handleTextChange = (text: string) => {
    setResponses((current) => current.map((answer, index) => index === currentStep ? text : answer));
  };

  const handleNext = () => {
    if (currentStep < 2) {
      setCurrentStep((step) => step + 1);
      return;
    }

    onSubmitAnswers(questions.map((question, index) => ({
      id: index + 1,
      question: question.question,
      answer: responses[index] || "我暂时记不清具体细节，请基于我已提供的信息保持克制，不要替我编造。"
    })));
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep((step) => step - 1);
      return;
    }
    onGoBack();
  };

  const currentQuestion = questions[currentStep];
  const currentAnswer = responses[currentStep];

  return (
    <div className="flex h-full w-full flex-col bg-[#050505] text-[#f2eee5]" id="questioning-screen">
      <header className="px-6 pb-4 pt-7" id="step-indicator">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#8d887f]">
          <button type="button" onClick={handlePrevious} className="flex items-center gap-1.5 normal-case tracking-normal text-[#8d887f] transition hover:text-[#ded7ca]" id="prev-step-button">
            <ArrowLeft className="h-3.5 w-3.5" /> 返回上步
          </button>
          <span className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-[#c5b57f]" />深度追问 · 0{currentStep + 1} / 03</span>
        </div>
        <div className="mt-4 flex gap-1.5" aria-label={`背景补全进度 ${currentStep + 1} / 3`}>
          {[0, 1, 2].map((step) => (
            <span key={step} className={`h-px flex-1 transition-colors ${step <= currentStep ? "bg-[#c7b77f]" : "bg-[#302e2a]"}`} />
          ))}
        </div>
      </header>

      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" id="question-card-wrapper">
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.24 }}>
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#77726a]">补全真实背景</p>
            <h2 className="mt-3 font-serif text-[27px] font-medium leading-[1.35] tracking-[-0.025em] text-[#f1ece3]" id={`question-text-${currentStep}`}>
              {currentQuestion?.question || "再告诉我一点当时的情况"}
            </h2>
            <div className="mt-5 h-px w-9 bg-[#9f9066]" />

            <label className="mt-7 block">
              <span className="text-[11px] tracking-[0.08em] text-[#aaa49a]">补充当时真实发生的事</span>
              <textarea
                id={`answer-textarea-${currentStep}`}
                rows={4}
                placeholder="写下你的状态、现实限制，以及当时能做或不能做的事……"
                value={currentAnswer}
                onChange={(event) => handleTextChange(event.target.value)}
                className="mt-2 h-28 w-full resize-none rounded-[15px] border border-[#302e2a] bg-[#0a0a0a] px-4 py-3 text-[13px] leading-6 text-[#ddd7cd] outline-none placeholder:text-[#504d48] focus:border-[#766b50]"
              />
            </label>

            {!!currentQuestion?.suggestions?.length && (
              <div className="mt-6" id="presets-container">
                <p className="flex items-center gap-1.5 text-[10px] tracking-[0.08em] text-[#706c65]">
                  <MessageSquare className="h-3 w-3" /> 也可以选择一个接近的答案，再继续修改
                </p>
                <div className="mt-2 overflow-hidden rounded-[15px] border border-[#2d2b27] bg-[#090909]" id="presets-list">
                  {currentQuestion.suggestions.map((option, index) => {
                    const selected = currentAnswer === option;
                    return (
                      <button
                        id={`preset-option-${currentStep}-${index}`}
                        key={option}
                        type="button"
                        onClick={() => handleTextChange(option)}
                        className={`flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left text-[12px] leading-5 transition ${index < currentQuestion.suggestions.length - 1 ? "border-b border-[#292724]" : ""} ${selected ? "bg-[#18160f] text-[#e6dfd3]" : "text-[#8e8981] hover:bg-[#10100f]"}`}
                      >
                        <span className={`h-4 w-4 shrink-0 rounded-full border ${selected ? "flex items-center justify-center border-[#a69769] bg-[#c7b77f]" : "border-[#514d45]"}`}>
                          {selected && <Check className="h-2.5 w-2.5 text-[#17140e]" />}
                        </span>
                        <span>{option}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-[#1f1e1b] bg-[#070707] px-6 pb-6 pt-4" id="question-launcher-area">
        <button
          id={`answer-submit-btn-${currentStep}`}
          type="button"
          onClick={handleNext}
          disabled={isLoading}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border border-[#ded3b6]/60 bg-[#d2c08d] px-5 text-[14px] font-semibold tracking-[0.04em] text-[#15130f] transition hover:bg-[#dac99a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "正在生成平行人生…" : currentStep < 2 ? "保存补充，继续" : "开始生成平行人生"}
          {!isLoading && <ArrowRight className="h-4 w-4" />}
        </button>
        <p className="mt-3 text-center text-[9px] tracking-[0.06em] text-[#514e49]">可以留空，系统不会替你编造真实经历</p>
      </footer>
    </div>
  );
}
