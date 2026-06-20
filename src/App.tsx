import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Compass, AlertCircle, X, Orbit } from "lucide-react";

import { UserInitialData, QuestionTurn, SimulationNode, LifeAttributes, HistoryItem, PersonalityInsight, QuestionItem } from "./types";
import InitialSetup from "./components/InitialSetup";
import SoulQuestioning from "./components/SoulQuestioning";
import SimulationEngine from "./components/SimulationEngine";
import DestinyReport from "./components/DestinyReport";

export default function App() {
  const [step, setStep] = useState<"initial" | "questioning" | "simulating" | "insight">("initial");
  const [name, setName] = useState("");
  const [userData, setUserData] = useState<UserInitialData | null>(null);
  
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [answers, setAnswers] = useState<QuestionTurn[]>([]);
  
  const [attributes, setAttributes] = useState<LifeAttributes>({
    happiness: 50,
    intelligence: 50,
    wealth: 50,
    relation: 50,
    health: 50
  });

  const [currentNode, setCurrentNode] = useState<SimulationNode | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [nodeCount, setNodeCount] = useState(1);
  const [insight, setInsight] = useState<PersonalityInsight | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. Submit Initial Setup -> Generate follow-up questions
  const handleInitialSubmit = async (data: UserInitialData, userName: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setUserData(data);
    setName(userName);

    try {
      const response = await fetch("/api/simulator/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userData: data })
      });

      const body = await response.json();
      if (!response.ok || body.error) {
        if (body.error === "AI_API_KEY_NOT_CONFIGURED" || body.message?.includes("API 密钥")) {
          setErrorMsg(body.message || "您尚未配置 AI API 密钥，请在本地 .env 中配置 DEEPSEEK_API_KEY。");
        } else {
          setErrorMsg(body.error || "生成背景补全问题失败，请检测网络环境。");
        }
        return;
      }

      setQuestions(body.questions || []);
      setStep("questioning");

    } catch (err: any) {
      console.error(err);
      setErrorMsg("网络异常：无法连接至命理计算中枢，请检查网络配置或稍后再试。");
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Submit Soul QuestionsAnswers -> Launch Life Simulation Level 1
  const handleSoulAnswersSubmit = async (submittedAnswers: QuestionTurn[]) => {
    if (!userData) return;
    setIsLoading(true);
    setErrorMsg(null);
    setAnswers(submittedAnswers);

    try {
      const response = await fetch("/api/simulator/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userData, answers: submittedAnswers })
      });

      const body = await response.json();
      if (!response.ok || body.error) {
        setErrorMsg(body.error || "初始星位注入失败，请重新建立契约。");
        return;
      }

      setAttributes(body.initialAttributes);
      setCurrentNode(body.startNode);
      setHistory([]);
      setNodeCount(1);
      setStep("simulating");

    } catch (err: any) {
      console.error(err);
      setErrorMsg("降生时空传输通道异常，请复查您的契约答案。");
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Make selected / custom choice -> Advance details
  const handleChoiceSelect = async (choiceText: string) => {
    if (!currentNode || !userData) return;

    setErrorMsg(null);

    // If we've reached ending and clicked final report button
    if (currentNode.isEndingNode || choiceText === "安详落幕，查看一生洞察") {
      setIsLoading(true);
      
      const finalHistoryItem: HistoryItem = {
        age: currentNode.age,
        title: currentNode.title,
        stage: currentNode.stage,
        description: currentNode.description,
        selectedChoice: choiceText,
        attributes: { ...attributes }
      };
      const updatedHistory = [...history, finalHistoryItem];

      try {
        const response = await fetch("/api/simulator/analyze-personality", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userData,
            history: updatedHistory,
            currentAttributes: attributes
          })
        });

        const body = await response.json();
        if (!response.ok || body.error) {
          setErrorMsg(body.error || "真我心理透视盘点失败。请重试按钮。");
          return;
        }

        setInsight(body);
        setStep("insight");

      } catch (err: any) {
        console.error(err);
        setErrorMsg("宿命总结遭遇神识乱流，请重新请求结契。");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Regular progression to next-node
    setIsLoadingNext(true);

    const newHistoryItem: HistoryItem = {
      age: currentNode.age,
      title: currentNode.title,
      stage: currentNode.stage,
      description: currentNode.description,
      selectedChoice: choiceText,
      attributes: { ...attributes }
    };
    const updatedHistory = [...history, newHistoryItem];
    setHistory(updatedHistory);

    try {
      const response = await fetch("/api/simulator/next-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userData,
          answers,
          history: updatedHistory,
          currentAttributes: attributes,
          selectedDecision: choiceText,
          nodeIndex: history.length
        })
      });

      const body = await response.json();
      if (!response.ok || body.error) {
        setErrorMsg(body.error || "下一个命运年份节点推演失利。");
        // Rollback history change to allow retry
        setHistory(history);
        return;
      }

      setAttributes(body.attributes);
      setCurrentNode(body);
      setNodeCount(prev => prev + 1);

    } catch (err: any) {
      console.error(err);
      setErrorMsg("时空穿梭有些颠簸，没能顺利着陆，请重试该选项。");
      setHistory(history);
    } finally {
      setIsLoadingNext(false);
    }
  };

  // 4. Time travel back to a specific target age
  const handleTimeTravel = async (targetAge: number) => {
    if (!userData) return;
    const targetIdx = history.findIndex(h => h.age === targetAge);
    if (targetIdx === -1) return;

    setErrorMsg(null);
    setIsLoadingNext(true);

    const targetItem = history[targetIdx];
    const restoredAttributes = targetItem.attributes || {
      happiness: 50,
      intelligence: 50,
      wealth: 50,
      relation: 50,
      health: 50
    };
    const truncatedHistory = history.slice(0, targetIdx);

    try {
      const response = await fetch("/api/simulator/time-travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userData,
          answers,
          history: truncatedHistory,
          currentAttributes: restoredAttributes,
          targetAge,
          targetTitle: targetItem.title,
          targetStage: targetItem.stage,
          targetDescription: targetItem.description
        })
      });

      const body = await response.json();
      if (!response.ok || body.error) {
        setErrorMsg(body.error || "时光逆转传输通道遭遇了未知摩擦力。");
        return;
      }

      setAttributes(restoredAttributes);
      setCurrentNode(body);
      setHistory(truncatedHistory);
      setNodeCount(truncatedHistory.length + 1);
      setStep("simulating"); // Make sure we return to simulated view to explore new path

    } catch (err: any) {
      console.error(err);
      setErrorMsg("逆转星轨失败，未能顺利重装这段尘封记忆。");
    } finally {
      setIsLoadingNext(false);
    }
  };

  const handleRestart = () => {
    setStep("initial");
    setName("");
    setUserData(null);
    setQuestions([]);
    setAnswers([]);
    setHistory([]);
    setNodeCount(1);
    setCurrentNode(null);
    setInsight(null);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center relative overflow-hidden" id="app-viewport">
      {/* Space atmosphere stars glow background */}
      <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-indigo-950/25 via-transparent to-transparent pointer-events-none" />
      <div className="absolute -left-32 top-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -right-32 bottom-20 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Main smartphone reader frame wrapper */}
      <div className="w-full h-screen max-w-md bg-slate-950/95 shadow-2xl relative flex flex-col overflow-hidden border border-slate-900/40 md:rounded-3xl md:h-[840px] md:my-5" id="mobile-canvas-container">
        
        {/* Universal upper cosmetic notch simulation (only visible on large screen) */}
        <div className="hidden md:flex w-full justify-center absolute top-2 z-50" id="notch-cosmetic">
          <div className="w-28 h-4.5 bg-black rounded-full border border-slate-900 flex items-center justify-between px-3 text-[7px] text-slate-600 font-mono">
            <span>ORACLE</span>
            <div className="w-1.5 h-1.5 rounded-full bg-slate-800 animate-pulse" />
          </div>
        </div>

        {/* Dynamic Screen routing with animated layout slide-overs */}
        <div className="flex-1 overflow-hidden pt-0 md:pt-6" id="router-view-body">
          <AnimatePresence mode="wait">
            {step === "initial" && (
              <motion.div
                key="initial-step"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <InitialSetup onSubmit={handleInitialSubmit} isLoading={isLoading} />
              </motion.div>
            )}

            {step === "questioning" && (
              <motion.div
                key="questioning-step"
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                className="w-full h-full"
              >
                <SoulQuestioning
                  questions={questions}
                  onSubmitAnswers={handleSoulAnswersSubmit}
                  isLoading={isLoading}
                  onGoBack={() => setStep("initial")}
                />
              </motion.div>
            )}

            {step === "simulating" && currentNode && (
              <motion.div
                key="simulating-step"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <SimulationEngine
                  currentNode={currentNode}
                  history={history}
                  nodeCount={nodeCount}
                  onSelectChoice={handleChoiceSelect}
                  isLoadingNext={isLoadingNext}
                  onTimeTravel={handleTimeTravel}
                />
              </motion.div>
            )}

            {step === "insight" && insight && userData && (
              <motion.div
                key="insight-step"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <DestinyReport
                  insight={insight}
                  userData={userData}
                  userName={name}
                  history={history}
                  onRestart={handleRestart}
                  onTimeTravel={handleTimeTravel}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Modern sliding error card/dialog */}
      <AnimatePresence>
        {errorMsg && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" id="error-alert-overlay">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl relative"
              id="error-alert-box"
            >
              <button
                id="dismiss-error-btn"
                type="button"
                onClick={() => setErrorMsg(null)}
                className="absolute top-3.5 right-3.5 p-1 rounded-full hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-start gap-3" id="error-alert-head">
                <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400 flex-shrink-0" id="error-circle-alert">
                  <AlertCircle className="w-5 h-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-100">时空命理演化警报</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-sans" id="error-toast-text">
                    {errorMsg}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-1" id="error-alert-footer">
                <button
                  id="error-resolve-btn"
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 transition-all"
                >
                  我知道了
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
