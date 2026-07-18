export type ChangeRiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export interface ChangeRiskProfile {
  level: ChangeRiskLevel;
  label: string;
  examples: string[];
  requiredLayers: Array<"L0" | "L1" | "L2" | "L3" | "L4" | "L5">;
  realBrowserRequired: boolean;
}

export const CHANGE_RISK_PROFILES: Record<ChangeRiskLevel, ChangeRiskProfile> = {
  R0: {
    level: "R0",
    label: "纯展示修改",
    examples: ["样式", "排版", "不涉及状态的静态文案"],
    requiredLayers: ["L0"],
    realBrowserRequired: false
  },
  R1: {
    level: "R1",
    label: "局部确定性规则",
    examples: ["单个计算函数", "局部事件资格", "单个 validator"],
    requiredLayers: ["L0", "L1", "L2"],
    realBrowserRequired: false
  },
  R2: {
    level: "R2",
    label: "单领域状态修改",
    examples: ["财务账本", "职业状态", "人物关系", "健康或 Arc 生命周期"],
    requiredLayers: ["L0", "L1", "L2", "L3", "L4"],
    realBrowserRequired: false
  },
  R3: {
    level: "R3",
    label: "跨领域或公共链路修改",
    examples: ["模型输出合同", "时间推进", "事件选择器", "权威状态结构"],
    requiredLayers: ["L0", "L1", "L2", "L3", "L4"],
    realBrowserRequired: false
  },
  R4: {
    level: "R4",
    label: "架构切换或发布",
    examples: ["权威状态切换生产", "结局系统重构", "发布候选版本"],
    requiredLayers: ["L0", "L1", "L2", "L3", "L4", "L5"],
    realBrowserRequired: true
  }
};

export function requiredTestLayers(level: ChangeRiskLevel): ChangeRiskProfile {
  return CHANGE_RISK_PROFILES[level];
}
