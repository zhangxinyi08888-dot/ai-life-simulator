import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Compass, AlertCircle, X, Orbit } from "lucide-react";

import { UserInitialData, QuestionTurn, SimulationNode, LifeAttributes, HistoryItem, FinalLifeOutcome, QuestionItem } from "./types";
import InitialSetup from "./components/InitialSetup";
import SoulQuestioning from "./components/SoulQuestioning";
import SimulationEngine from "./components/SimulationEngine";
import DestinyReport from "./components/DestinyReport";
import { isAiClientError } from "./services/ai/errors";
import {
  generateNextNode,
  generateQuestions,
  startSimulation
} from "./services/simulation/simulationService";
import { generateFinalOutcome } from "./services/finalOutcome/finalOutcomeService";
import { createHistoryItemFromNode, restoreHistoryNodeAtIndex } from "./utils/historyRestore";

function getSimulationErrorMessage(error: unknown, fallback: string): string {
  if (!isAiClientError(error)) return fallback;

  if (error.code === "API_KEY_MISSING") {
    return "未检测到 VITE_DEEPSEEK_API_KEY，请在本地或构建环境中配置 DeepSeek API Key。";
  }
  if (error.code === "AI_AUTH_FAILED") {
    return "DeepSeek API Key 校验失败，请检查 VITE_DEEPSEEK_API_KEY 是否正确。";
  }
  if (error.code === "AI_RATE_LIMITED") {
    return "DeepSeek 请求过于频繁，请稍后再试。";
  }
  if (error.code === "AI_RESPONSE_INVALID") {
    return "AI 返回内容格式异常，请重新生成。";
  }
  if (error.code === "AI_NETWORK_FAILED") {
    return "网络异常：无法连接至命理计算中枢，请检查网络配置或稍后再试。";
  }

  return error.message || fallback;
}

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
  const [simulationSeed, setSimulationSeed] = useState(() => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const [outcome, setOutcome] = useState<FinalLifeOutcome | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Confirm the generated anchor, then keep the original three-question flow.
  const handleInitialSubmit = async (data: UserInitialData, userName: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setUserData(data);
    setName(userName);

    try {
      const body = await generateQuestions(data);
      setQuestions(body.questions || []);
      setStep("questioning");

    } catch (err: any) {
      console.error(err);
      setErrorMsg(getSimulationErrorMessage(err, "生成背景补全问题失败，请检测网络环境。"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSoulAnswersSubmit = async (submittedAnswers: QuestionTurn[]) => {
    if (!userData) return;
    setIsLoading(true);
    setErrorMsg(null);
    setAnswers(submittedAnswers);

    try {
      const body = await startSimulation(userData, submittedAnswers);
      setAttributes(body.initialAttributes);
      setCurrentNode(body.startNode);
      setHistory([]);
      setNodeCount(1);
      setSimulationSeed(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
      setStep("simulating");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(getSimulationErrorMessage(err, "降生时空传输通道异常，请复查您的契约答案。"));
    } finally {
      setIsLoading(false);
    }
  };

  // Make selected / custom choice -> Advance details
  const handleChoiceSelect = async (choiceText: string) => {
    if (!currentNode || !userData) return;

    setErrorMsg(null);

    // If we've reached ending and clicked final report button
    if (currentNode.isEndingNode || choiceText === "安详落幕，查看一生洞察") {
      setIsLoading(true);
      
      const finalHistoryItem = createHistoryItemFromNode(currentNode, choiceText);
      const updatedHistory = [...history, finalHistoryItem];

      try {
        const body = await generateFinalOutcome({
          userData,
          answers,
          history: updatedHistory,
          currentAttributes: attributes
        });
        setOutcome(body);
        setStep("insight");

      } catch (err: any) {
        console.error(err);
        setErrorMsg(getSimulationErrorMessage(err, "宿命总结遭遇神识乱流，请重新请求结契。"));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Regular progression to next-node
    setIsLoadingNext(true);

    const newHistoryItem = createHistoryItemFromNode(currentNode, choiceText);
    const updatedHistory = [...history, newHistoryItem];
    setHistory(updatedHistory);

    try {
      const body = await generateNextNode({
        userData,
        answers,
        history: updatedHistory,
        currentAttributes: attributes,
        selectedDecision: choiceText,
        nodeIndex: updatedHistory.length,
        simulationSeed
      });

      setAttributes(body.attributes);
      setCurrentNode(body);
      setNodeCount(prev => prev + 1);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(getSimulationErrorMessage(err, "时空穿梭有些颠簸，没能顺利着陆，请重试该选项。"));
      setHistory(history);
    } finally {
      setIsLoadingNext(false);
    }
  };

  // 4. Restore a specific historical node so the user can choose again
  const handleTimeTravel = (targetIndex: number) => {
    setErrorMsg(null);

    try {
      const restored = restoreHistoryNodeAtIndex(history, targetIndex);
      setAttributes(restored.attributes);
      setCurrentNode(restored.node);
      setHistory(restored.historyBefore);
      setNodeCount(restored.nodeCount);
      setStep("simulating");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(getSimulationErrorMessage(err, "逆转星轨失败，未能顺利重装这段尘封记忆。"));
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
    setSimulationSeed(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);
    setOutcome(null);
    setErrorMsg(null);
  };

  return (
    <div className="h-[100dvh] bg-[#050505] text-[#f2eee5] flex items-center justify-center relative overflow-hidden" id="app-viewport">

      {/* Main smartphone reader frame wrapper */}
      <div className="mobile-prototype w-full h-[100dvh] max-w-[390px] bg-[#050505] shadow-2xl relative flex flex-col overflow-hidden border border-[#171717] md:rounded-3xl md:h-[844px] md:my-5" id="mobile-canvas-container">
        
        {/* Universal upper cosmetic notch simulation (only visible on large screen) */}
        <div className="hidden md:flex w-full justify-center absolute top-2 z-50" id="notch-cosmetic">
          <div className="w-28 h-4.5 bg-black rounded-full border border-[#24221f] flex items-center justify-between px-3 text-[7px] text-[#69645d] font-mono">
            <span>ORACLE</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#aa9b70] animate-pulse" />
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
                  isLoadingReport={isLoading}
                  onTimeTravel={handleTimeTravel}
                />
              </motion.div>
            )}

            {step === "insight" && outcome && userData && (
              <motion.div
                key="insight-step"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                <DestinyReport
                  outcome={outcome}
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
              className="bg-[#0a0a0a] border border-[#37332d] rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl relative"
              id="error-alert-box"
            >
              <button
                id="dismiss-error-btn"
                type="button"
                onClick={() => setErrorMsg(null)}
                className="absolute top-3.5 right-3.5 p-1 rounded-full hover:bg-[#161512] text-[#77716a] hover:text-[#d7d0c5] transition-all"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-start gap-3" id="error-alert-head">
                <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400 flex-shrink-0" id="error-circle-alert">
                  <AlertCircle className="w-5 h-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[#e4ddd3]">时空命理演化警报</h3>
                  <p className="text-xs text-[#8c857c] leading-relaxed font-sans" id="error-toast-text">
                    {errorMsg}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-1" id="error-alert-footer">
                <button
                  id="error-resolve-btn"
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="flex-1 py-2 text-xs font-semibold rounded-xl border border-[#d8cba8]/60 bg-[#d2c08d] text-[#15130f] transition-all hover:bg-[#dac99a]"
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
