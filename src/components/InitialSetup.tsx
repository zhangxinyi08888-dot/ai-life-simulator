import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Ellipsis,
  GraduationCap,
  Heart,
  PencilLine,
  Sparkles,
} from "lucide-react";
import { UserInitialData } from "../types";

interface InitialSetupProps {
  onSubmit: (data: UserInitialData, name: string) => void;
  isLoading: boolean;
}

type SetupStep = 1 | 2 | 3;
type ThemeKey = "education" | "career" | "relationship" | "wealth" | "other";

interface ThemeOption {
  key: ThemeKey;
  label: string;
  returnTitle: string;
  returnDescription: string;
  focus: string;
  age: number;
  example: string;
  branches: [string, string, string];
  Icon: React.ComponentType<{ className?: string }>;
}

const THEMES: ThemeOption[] = [
  {
    key: "education",
    label: "升学与选择",
    returnTitle: "重写高考志愿",
    returnDescription: "回到志愿填报那天，选择真正想走的方向",
    focus: "selftruth",
    age: 18,
    example: "高考填志愿时，我因为害怕失败，放弃了真正想学的专业。",
    branches: ["坚持自己的志愿，选择真正热爱的方向", "保留稳妥选择，同时开始系统学习热爱的领域", "暂缓决定，用一年时间重新确认自己想走的路"],
    Icon: GraduationCap,
  },
  {
    key: "career",
    label: "工作与转折",
    returnTitle: "重选职业方向",
    returnDescription: "回到那次工作转折，走向另一条职业道路",
    focus: "career",
    age: 24,
    example: "第一次收到理想公司的邀请时，我因为不够自信，选择留在了熟悉但没有成长的岗位。",
    branches: ["接受新的机会，进入更有成长性的环境", "留在原岗位，但主动争取更核心的职责", "先离开既定轨道，尝试独立发展自己的能力"],
    Icon: BriefcaseBusiness,
  },
  {
    key: "relationship",
    label: "关系与遗憾",
    returnTitle: "重做情感选择",
    returnDescription: "回到关系的关键节点，重新回应或告别",
    focus: "romance",
    age: 26,
    example: "那次争吵后，我明明还在意，却因为骄傲没有说出真正想说的话。",
    branches: ["坦诚表达感受，主动修复这段关系", "尊重彼此边界，给关系一次冷静重启", "接受告别，把未说完的话变成重新生活的勇气"],
    Icon: Heart,
  },
  {
    key: "wealth",
    label: "财富与机会",
    returnTitle: "重判财富机会",
    returnDescription: "回到机会出现之前，重新判断风险与取舍",
    focus: "wealth",
    age: 30,
    example: "面对一次重要的合作机会，我因为担心失去稳定收入，最终没有迈出那一步。",
    branches: ["投入主要精力，把握这次关键机会", "保留安全边界，用小规模方式先验证方向", "放弃眼前机会，转而建立长期可持续的积累"],
    Icon: CircleDollarSign,
  },
  {
    key: "other",
    label: "其他经历",
    returnTitle: "写下我的时刻",
    returnDescription: "填写一件只属于你的回溯事件",
    focus: "innerpeace",
    age: 25,
    example: "在人生最需要做决定的时候，我习惯先满足别人的期待，后来才发现忽略了自己。",
    branches: ["第一次把自己的真实意愿放在前面", "兼顾现实与内心，重新设定可执行的边界", "暂停原来的安排，给自己一次彻底重新选择的机会"],
    Icon: Ellipsis,
  },
];

const BIRTH_TIMES = [
  ["00:00", "子时 (23:00-00:59)"],
  ["01:00", "丑时 (01:00-02:59)"],
  ["03:00", "寅时 (03:00-04:59)"],
  ["05:00", "卯时 (05:00-06:59)"],
  ["07:00", "辰时 (07:00-08:59)"],
  ["09:00", "巳时 (09:00-10:59)"],
  ["11:00", "午时 (11:00-12:59)"],
  ["13:00", "未时 (13:00-14:59)"],
  ["15:00", "申时 (15:00-16:59)"],
  ["17:00", "酉时 (17:00-18:59)"],
  ["19:00", "戌时 (19:00-20:59)"],
  ["21:00", "亥时 (21:00-22:59)"],
];

function detectAge(text: string, fallback: number) {
  const match = text.match(/(\d{1,2})\s*岁/);
  if (!match) return fallback;
  const age = Number(match[1]);
  return age >= 7 && age <= 80 ? age : fallback;
}

function Brand({ step }: { step: SetupStep }) {
  return (
    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.24em] text-[#aaa59c]">
      <span className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-[#d8c89b]" />Parallel Life</span>
      <span className="tabular-nums text-[#6f6b64]">0{step} / 03</span>
    </div>
  );
}

function PrimaryButton({ children, disabled, onClick, type = "button" }: React.PropsWithChildren<{
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}>) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="flex h-13 w-full items-center justify-center gap-2 rounded-[14px] border border-[#ded3b6]/60 bg-[#d2c08d] px-5 text-[14px] font-semibold tracking-[0.06em] text-[#15130f] shadow-[0_8px_28px_rgba(210,192,141,0.09)] transition hover:bg-[#dac99a] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

export default function InitialSetup({ onSubmit, isLoading }: InitialSetupProps) {
  const [step, setStep] = useState<SetupStep>(1);
  const [birthday, setBirthday] = useState("1998-05-15");
  const [birthtime, setBirthtime] = useState("07:00");
  const [themeKey, setThemeKey] = useState<ThemeKey>("relationship");
  const [anchorText, setAnchorText] = useState("");
  const [anchorAge, setAnchorAge] = useState(26);
  const [branchChoices, setBranchChoices] = useState<[string, string, string]>(THEMES[2].branches);
  const [anchorTextIsPreset, setAnchorTextIsPreset] = useState(false);
  const [branchChoiceIsPreset, setBranchChoiceIsPreset] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const theme = useMemo(() => THEMES.find((item) => item.key === themeKey) ?? THEMES[0], [themeKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setError("");
  }, [step]);

  const goToStory = () => {
    if (!birthday || !birthtime) {
      setError("请先补全出生日期和时辰。");
      return;
    }
    setStep(2);
  };

  const selectReturnPoint = (option: ThemeOption) => {
    setThemeKey(option.key);
    setAnchorText(option.key === "other" ? "" : option.example);
    setAnchorTextIsPreset(option.key !== "other");
    setAnchorAge(detectAge(option.example, option.age));
    setBranchChoices(option.branches);
    setBranchChoiceIsPreset([true, true, true]);
    setStep(3);
  };

  const start = () => {
    const branches = branchChoices.map((branch, index) => `${String.fromCharCode(65 + index)}. ${branch.trim()}`).join("\n");
    const situation = `【用户想重写的真实事件】\n${anchorText}\n\n【系统生成的回溯锚点】\n回到 ${anchorAge} 岁，在事件发生前重新做出选择。`;

    onSubmit({
      birthday,
      birthtime,
      gender: "未知",
      currentSituation: situation,
      isReturnToPast: true,
      targetAgeNode: `${anchorAge} 岁 · ${theme.label}`,
      milestones: [{ id: theme.key, title: theme.label, content: anchorText }],
      milestoneGaokao: theme.key === "education" ? anchorText : "",
      milestoneCareer: theme.key === "career" ? anchorText : "",
      milestoneRelationship: theme.key === "relationship" ? anchorText : "",
      milestoneOther: !["education", "career", "relationship"].includes(theme.key) ? anchorText : "",
      regressionNodeKey: theme.key,
      regressionAge: anchorAge,
      regressionSituation: situation,
      regressionChoices: branches,
      coreStoryFocus: theme.focus,
    }, "旅人");
  };

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-[#050505] text-[#f2eee5] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" id="welcome-screen">
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.section key="birth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-h-full flex-col px-6 pb-6 pt-7">
            <Brand step={step} />

            <div className="pt-16">
              <p className="mb-5 text-[11px] leading-5 tracking-[0.14em] text-[#a6a198]">它懂我的现实，但给了我一个可以重新选择的人生</p>
              <h1 className="font-serif text-[42px] font-medium leading-[1.16] tracking-[-0.04em] text-[#f4f0e8]">
                平行时空：<br />人生模拟器
              </h1>
              <div className="mt-7 h-px w-10 bg-[#bca96f]" />
              <p className="mt-6 max-w-[300px] text-[13px] leading-6 text-[#7f7b74]">
                输入出生信息，生成专属命格角色卡。<br />然后，只选择一件你最想重写的事。
              </p>
            </div>

            <div className="mt-12 overflow-hidden rounded-[18px] border border-[#37342f] bg-[#0b0b0b]">
              <label className="flex items-center gap-3 border-b border-[#2a2824] px-4 py-4">
                <CalendarDays className="h-4 w-4 text-[#b9ac86]" />
                <span className="w-16 text-[12px] text-[#aaa59c]">出生日期</span>
                <input aria-label="出生日期" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="min-w-0 flex-1 bg-transparent text-right text-[14px] text-[#f0ece4] outline-none [color-scheme:dark]" />
              </label>
              <label className="flex items-center gap-3 px-4 py-4">
                <Clock3 className="h-4 w-4 text-[#b9ac86]" />
                <span className="w-16 text-[12px] text-[#aaa59c]">出生时辰</span>
                <select aria-label="出生时辰" value={birthtime} onChange={(e) => setBirthtime(e.target.value)} className="min-w-0 flex-1 bg-[#0b0b0b] text-right text-[14px] text-[#f0ece4] outline-none">
                  {BIRTH_TIMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-auto pt-6">
              {error && <p className="mb-3 text-center text-[11px] text-[#c99486]">{error}</p>}
              <PrimaryButton onClick={goToStory}>生成我的命格角色卡 <ArrowRight className="h-4 w-4" /></PrimaryButton>
              <p className="mt-3 text-center text-[10px] tracking-[0.08em] text-[#55524d]">你的信息只用于生成本次体验</p>
            </div>
          </motion.section>
        )}

        {step === 2 && (
          <motion.section key="story" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="flex min-h-full flex-col px-6 pb-6 pt-7">
            <Brand step={step} />

            <div className="pt-8">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[#8c877e]">选择一个回溯时刻</p>
              <h2 className="mt-3 font-serif text-[32px] leading-[1.25] tracking-[-0.03em]">你最想回到，<br />哪一个时刻？</h2>
            </div>

            <div className="mt-5 rounded-[16px] border border-[#302e2a] bg-[#0a0a0a] px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] tracking-[0.12em] text-[#77736c]">你的命格角色卡</p>
                  <p className="mt-1 text-[13px] text-[#ddd7cc]">敏锐的现实观察者</p>
                </div>
                <span className="rounded-full border border-[#4a4436] px-2.5 py-1 text-[9px] tracking-[0.12em] text-[#bfb18b]">已生成</span>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-[14px] border border-[#292825] bg-[#0a0a0a]">
              {THEMES.map((option, index) => {
                const { key, returnTitle, returnDescription, age, Icon } = option;
                return (
                  <button key={key} type="button" onClick={() => selectReturnPoint(option)} className={`flex min-h-17 w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-[#15130e] ${index < THEMES.length - 1 ? "border-b border-[#292825]" : ""}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#464139] bg-[#10100f]">
                      <Icon className="h-4 w-4 text-[#b8a978]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-[#ddd7cd]">{returnTitle}</span>
                      <span className="mt-1 block truncate text-[10px] text-[#716d66]">{returnDescription}</span>
                    </span>
                    <span className="shrink-0 text-[9px] text-[#57534d]">{key === "other" ? "自定义" : `约 ${age} 岁`}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#686259]" />
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-center text-[10px] leading-5 text-[#5f5b55]">这些是系统生成的候选回溯点<br />选中后会进入下一页，你可以继续修改</p>
          </motion.section>
        )}

        {step === 3 && (
          <motion.section key="anchor" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex min-h-full flex-col px-6 pb-6 pt-7">
            <Brand step={step} />

            <div className="pt-8">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[#8c877e]">确认回溯点</p>
              <h2 className="mt-3 font-serif text-[31px] leading-[1.25] tracking-[-0.03em]">这就是你要回去的<br />时刻吗？</h2>
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-3 pb-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#6f654e] bg-[#17150f] font-serif text-[20px] text-[#d6c492]">{anchorAge}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] tracking-[0.1em] text-[#77736c]">系统推断年龄 · 可修改</p>
                  <div className="mt-1 flex items-center gap-2">
                    <input aria-label="回溯年龄" type="number" min={7} max={80} value={anchorAge} onChange={(e) => setAnchorAge(Math.max(7, Math.min(80, Number(e.target.value))))} className="w-11 bg-transparent text-[14px] text-[#ece7de] outline-none" />
                    <span className="text-[12px] text-[#77736c]">岁</span>
                    <PencilLine className="h-3 w-3 text-[#77705d]" />
                  </div>
                </div>
                <span className="rounded-full border border-[#3a362e] px-2.5 py-1 text-[9px] text-[#a59d8e]">{theme.label}</span>
              </div>
              <div className="h-px bg-[#2b2925]" />

              <label className="mt-4 block">
                <span className="flex items-center gap-2 text-[10px] tracking-[0.1em] text-[#77736c]">
                  <span>事件摘要</span>
                  <span className="text-[#5f5b55]">{anchorTextIsPreset ? "系统预置 · 可直接输入替换" : "你的输入"}</span>
                </span>
                <textarea
                  aria-label="回溯事件摘要"
                  value={anchorText}
                  onFocus={() => {
                    if (anchorTextIsPreset) {
                      setAnchorText("");
                      setAnchorTextIsPreset(false);
                    }
                  }}
                  onChange={(event) => {
                    setAnchorText(event.target.value);
                    setAnchorTextIsPreset(false);
                  }}
                  placeholder="写下你想回去重新选择的那件事……"
                  className={`mt-2 h-23 w-full resize-none rounded-[14px] border border-[#3b372f] bg-[#0b0b0a] px-4 py-3 text-[13px] leading-5 outline-none transition-colors placeholder:text-[#4f4c47] focus:border-[#5a5242] focus:text-[#e3ddd2] ${anchorTextIsPreset ? "text-[#77736c]" : "text-[#d8d2c8]"}`}
                />
              </label>
            </div>

            <div className="mt-5">
              <p className="mb-2 flex items-center gap-2 text-[10px] tracking-[0.12em] text-[#77736c]">
                <span className="uppercase tracking-[0.16em]">命运分支</span>
                <span className="text-[#5f5b55]">系统预置 · 可直接输入替换</span>
              </p>
              <div className="space-y-2">
                {branchChoices.map((branch, index) => (
                  <div key={index} className="flex min-h-13 items-center gap-3 rounded-[13px] border border-[#302e2a] bg-[#090909] px-3.5 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#514b3d] text-[10px] text-[#c2b487]">{String.fromCharCode(65 + index)}</span>
                    <textarea
                      aria-label={`命运分支 ${String.fromCharCode(65 + index)}`}
                      value={branch}
                      onFocus={() => {
                        if (branchChoiceIsPreset[index]) {
                          setBranchChoices((current) => current.map((item, choiceIndex) => choiceIndex === index ? "" : item) as [string, string, string]);
                          setBranchChoiceIsPreset((current) => current.map((isPreset, choiceIndex) => choiceIndex === index ? false : isPreset) as [boolean, boolean, boolean]);
                        }
                      }}
                      onChange={(event) => {
                        setBranchChoices((current) => current.map((item, choiceIndex) => choiceIndex === index ? event.target.value : item) as [string, string, string]);
                        setBranchChoiceIsPreset((current) => current.map((isPreset, choiceIndex) => choiceIndex === index ? false : isPreset) as [boolean, boolean, boolean]);
                      }}
                      maxLength={80}
                      placeholder="写下你的选择……"
                      className={`h-9 min-w-0 flex-1 resize-none bg-transparent text-[11px] leading-4 outline-none transition-colors placeholder:text-[#4f4c47] focus:text-[#e3ddd2] ${branchChoiceIsPreset[index] ? "text-[#77736c]" : "text-[#d8d2c8]"}`}
                    />
                    <PencilLine className="h-3 w-3 shrink-0 text-[#5f594d]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-auto pt-5">
              <div className="flex gap-2.5">
                <button type="button" onClick={() => setStep(2)} className="flex h-13 w-[112px] items-center justify-center gap-1.5 rounded-[14px] border border-[#37342f] text-[12px] text-[#9d978e] transition hover:border-[#575248] hover:text-[#d3ccc0]"><ArrowLeft className="h-3.5 w-3.5" /> 返回修改</button>
                <div className="flex-1"><PrimaryButton disabled={isLoading || !anchorText.trim() || branchChoices.some((choice) => !choice.trim())} onClick={start}>{isLoading ? "正在开启…" : "确认，从这里开始"} {!isLoading && <ArrowRight className="h-4 w-4" />}</PrimaryButton></div>
              </div>
              <p className="mt-3 text-center text-[9px] tracking-[0.08em] text-[#56534e]">确认后将用三次追问补全你的平行人生</p>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
