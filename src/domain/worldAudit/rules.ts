import { currentCareerState } from "../career/careerState";
import { assertFinancialLedgerInvariants } from "../finance/ledgerMath";
import type { WorldAuditFinding, WorldRealityRule, WorldRuleContext } from "./types";

function finding(
  rule: Pick<WorldRealityRule, "id" | "category" | "domain" | "defaultSeverity">,
  context: WorldRuleContext,
  message: string,
  evidence: Record<string, unknown> = {}
): WorldAuditFinding {
  return {
    ruleId: rule.id,
    category: rule.category,
    domain: rule.domain,
    severity: rule.defaultSeverity,
    nodeIndex: context.nodeIndex,
    ageInMonths: context.ageInMonths,
    message,
    evidence
  };
}

const timelineMonotonic: WorldRealityRule = {
  id: "TIME-001",
  title: "人生时间不得倒退",
  category: "hard_invariant",
  domain: "timeline",
  defaultSeverity: "blocking",
  rationale: "后续人生节点不能发生在已经提交的前一节点之前。",
  evaluate(context) {
    const previousAge = context.previousNode?.ageInMonths ?? (
      context.previousNode ? Math.round(context.previousNode.age * 12) : undefined
    );
    if (previousAge === undefined || context.ageInMonths >= previousAge) return [];
    return [finding(this, context, "人生时间发生倒退", {
      previousAgeInMonths: previousAge,
      currentAgeInMonths: context.ageInMonths
    })];
  }
};

const endingIsTerminal: WorldRealityRule = {
  id: "ENDING-001",
  title: "生理或报告结局后不得继续普通人生",
  category: "hard_invariant",
  domain: "ending",
  defaultSeverity: "blocking",
  rationale: "结局节点是这条已提交路线的终点。",
  evaluate(context) {
    if (!context.previousNode?.isEndingNode) return [];
    return [finding(this, context, "结局节点之后仍存在人生节点", {
      previousTitle: context.previousNode.title,
      currentTitle: context.node.title
    })];
  }
};

const ledgerAgeMatchesNode: WorldRealityRule = {
  id: "FIN-TIME-001",
  title: "财务账本时间必须与节点时间一致",
  category: "hard_invariant",
  domain: "cross_domain",
  defaultSeverity: "blocking",
  rationale: "下一轮剧情和报告不能读取另一个年龄时点的账本。",
  evaluate(context) {
    const ledgerAge = context.node.financialLedger?.asOfAgeInMonths;
    if (ledgerAge === undefined || ledgerAge === context.ageInMonths) return [];
    return [finding(this, context, "财务账本时间与人生节点不一致", {
      ledgerAgeInMonths: ledgerAge,
      nodeAgeInMonths: context.ageInMonths
    })];
  }
};

const derivedFinanceAgeMatchesNode: WorldRealityRule = {
  id: "FIN-TIME-002",
  title: "派生财务快照时间必须与节点时间一致",
  category: "hard_invariant",
  domain: "cross_domain",
  defaultSeverity: "blocking",
  rationale: "兼容快照只能是当前权威账本的同时间派生视图。",
  evaluate(context) {
    const stateAge = context.node.financialState?.asOfAgeInMonths;
    if (stateAge === undefined || stateAge === context.ageInMonths) return [];
    return [finding(this, context, "派生财务快照时间与人生节点不一致", {
      financialStateAgeInMonths: stateAge,
      nodeAgeInMonths: context.ageInMonths
    })];
  }
};

const validFinancialLedger: WorldRealityRule = {
  id: "FIN-001",
  title: "权威财务账本必须满足会计与账户不变量",
  category: "hard_invariant",
  domain: "finance",
  defaultSeverity: "blocking",
  rationale: "现金、账户、债务、资产和事务标识必须保持结构合法。",
  evaluate(context) {
    const ledger = context.node.financialLedger;
    if (!ledger) return [];
    try {
      assertFinancialLedgerInvariants(ledger);
      return [];
    } catch (error) {
      return [finding(this, context, "财务账本不变量失败", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: error && typeof error === "object" && "code" in error ? error.code : undefined
      })];
    }
  }
};

const currentCareerReferenceExists: WorldRealityRule = {
  id: "CAREER-001",
  title: "当前职业状态必须引用已提交的 CareerState",
  category: "hard_invariant",
  domain: "career",
  defaultSeverity: "blocking",
  rationale: "职业身份必须有唯一权威来源。",
  evaluate(context) {
    const world = context.node.worldStateSnapshot;
    if (!world?.currentCareerStateId) return [];
    const current = currentCareerState(world);
    if (current) return [];
    return [finding(this, context, "currentCareerStateId 没有对应的 CareerState", {
      currentCareerStateId: world.currentCareerStateId,
      careerStateIds: world.careerStates?.map((state) => state.id) || []
    })];
  }
};

const employmentMirrorsCareerAuthority: WorldRealityRule = {
  id: "CAREER-002",
  title: "兼容就业状态必须镜像当前 CareerState",
  category: "hard_invariant",
  domain: "cross_domain",
  defaultSeverity: "blocking",
  rationale: "正文推断或旧快照不能成为第二个职业事实源。",
  evaluate(context) {
    const world = context.node.worldStateSnapshot;
    if (!world?.currentCareerStateId || !world.currentEmploymentStatus) return [];
    const current = currentCareerState(world);
    if (!current || current.employmentStatus === world.currentEmploymentStatus) return [];
    return [finding(this, context, "WorldState 的就业状态与当前 CareerState 冲突", {
      currentCareerStateId: current.id,
      careerEmploymentStatus: current.employmentStatus,
      worldEmploymentStatus: world.currentEmploymentStatus
    })];
  }
};

const activeCareerIncomeReferencesCurrentState: WorldRealityRule = {
  id: "CAREER-FIN-001",
  title: "活跃职业收入必须引用当前职业状态",
  category: "causal_evidence",
  domain: "cross_domain",
  defaultSeverity: "blocking",
  rationale: "离职、退休或转职后，旧职业工资不能继续机械累计。",
  evaluate(context) {
    if (context.node.financialLedgerMode !== "authoritative") return [];
    const ledger = context.node.financialLedger;
    const world = context.node.worldStateSnapshot;
    if (!ledger || !world?.currentCareerStateId) return [];
    const previousLedger = context.previousNode?.financialLedger;
    const previousWorld = context.previousNode?.worldStateSnapshot;
    const previousConflicts = new Set(
      previousLedger && previousWorld?.currentCareerStateId
        ? previousLedger.incomeSources
          .filter((source) => source.status === "active"
            && Boolean(source.linkedCareerStateId)
            && source.linkedCareerStateId !== previousWorld.currentCareerStateId)
          .map((source) => source.id)
        : []
    );
    return ledger.incomeSources
      .filter((source) => source.status === "active"
        && Boolean(source.linkedCareerStateId)
        && source.linkedCareerStateId !== world.currentCareerStateId
        && !previousConflicts.has(source.id))
      .map((source) => finding(this, context, "活跃职业收入引用了过期 CareerState", {
        incomeSourceId: source.id,
        linkedCareerStateId: source.linkedCareerStateId,
        currentCareerStateId: world.currentCareerStateId
      }));
  }
};

const blockingFinancialIssuesSurface: WorldRealityRule = {
  id: "FIN-FACT-001",
  title: "阻断性财务事实问题必须显式暴露",
  category: "causal_evidence",
  domain: "finance",
  defaultSeverity: "blocking",
  rationale: "算术闭合不能掩盖资金来源、职业收入或个人企业边界冲突。",
  evaluate(context) {
    const previousOpenIds = new Set(
      context.previousNode?.financialLedger?.unresolvedIssues
        .filter((issue) => issue.severity === "blocking" && issue.status !== "resolved")
        .map((issue) => issue.id) || []
    );
    const issues = context.node.financialLedger?.unresolvedIssues.filter(
      (issue) => issue.severity === "blocking"
        && issue.status !== "resolved"
        && !previousOpenIds.has(issue.id)
    ) || [];
    return issues.map((issue) => finding(this, context, "账本仍有未解决的阻断性事实问题", {
      issueId: issue.id,
      issueCode: issue.code,
      summary: issue.summary,
      relatedProposalIds: issue.relatedProposalIds
    }));
  }
};

const foregroundArcExists: WorldRealityRule = {
  id: "ARC-001",
  title: "前台压力 Arc 必须存在且尚未解决",
  category: "hard_invariant",
  domain: "arc",
  defaultSeverity: "blocking",
  rationale: "事件选择器不能围绕不存在或已经解决的压力主线继续生成。",
  evaluate(context) {
    const world = context.node.worldStateSnapshot;
    if (!world?.foregroundPressureArcId) return [];
    const foreground = world.pressureArcs.find((arc) => arc.id === world.foregroundPressureArcId);
    if (foreground && foreground.status !== "resolved") return [];
    return [finding(this, context, "foregroundPressureArcId 引用了不存在或已解决的 Arc", {
      foregroundPressureArcId: world.foregroundPressureArcId,
      resolvedStatus: foreground?.status
    })];
  }
};

const stateDatesNotInFuture: WorldRealityRule = {
  id: "TIME-STATE-001",
  title: "人物和 Arc 状态更新时间不得位于未来",
  category: "hard_invariant",
  domain: "cross_domain",
  defaultSeverity: "blocking",
  rationale: "当前节点不能提前拥有未来才会发生的状态。",
  evaluate(context) {
    const world = context.node.worldStateSnapshot;
    if (!world) return [];
    const results: WorldAuditFinding[] = [];
    for (const person of world.people) {
      if ((person.protagonistAgeInMonthsAtLastUpdate ?? context.ageInMonths) > context.ageInMonths) {
        results.push(finding(this, context, "人物状态更新时间晚于当前节点", {
          personId: person.id,
          protagonistAgeInMonthsAtLastUpdate: person.protagonistAgeInMonthsAtLastUpdate
        }));
      }
    }
    for (const arc of world.directionArcs) {
      if (arc.startedAtAgeInMonths > context.ageInMonths) {
        results.push(finding(this, context, "DirectionArc 开始时间晚于当前节点", {
          arcId: arc.id,
          startedAtAgeInMonths: arc.startedAtAgeInMonths
        }));
      }
    }
    for (const arc of world.pressureArcs) {
      if (arc.startedAtAgeInMonths > context.ageInMonths || arc.phaseStartedAtAgeInMonths > context.ageInMonths) {
        results.push(finding(this, context, "PressureArc 时间晚于当前节点", {
          arcId: arc.id,
          startedAtAgeInMonths: arc.startedAtAgeInMonths,
          phaseStartedAtAgeInMonths: arc.phaseStartedAtAgeInMonths
        }));
      }
    }
    return results;
  }
};

export const CORE_WORLD_REALITY_RULES: WorldRealityRule[] = [
  timelineMonotonic,
  endingIsTerminal,
  ledgerAgeMatchesNode,
  derivedFinanceAgeMatchesNode,
  validFinancialLedger,
  currentCareerReferenceExists,
  employmentMirrorsCareerAuthority,
  activeCareerIncomeReferencesCurrentState,
  blockingFinancialIssuesSurface,
  foregroundArcExists,
  stateDatesNotInFuture
];
