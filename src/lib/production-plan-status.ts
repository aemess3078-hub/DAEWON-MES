/**
 * 생산계획 상태 전이 정책 (순수 모듈 — DB·React 의존 없음, 서버 액션과 화면이 같은 규칙을 쓴다)
 *
 * 상태는 실제 업무 흐름이 바꾼다.
 *   - DRAFT → CONFIRMED : 사용자가 계획을 확정(수동)
 *   - CONFIRMED → IN_PROGRESS : 작업지시가 만들어지면 자동(syncProductionPlanStatusFromWorkOrders)
 *   - IN_PROGRESS/CONFIRMED → COMPLETED : 계획 수량이 모두 작업지시에 배정되고 모든 작업지시가 완료되면 자동
 *   - DRAFT/CONFIRMED → CANCELLED : 취소 기능(cancelProductionPlan, 작업지시가 없을 때만)
 * 그래서 사용자가 직접 지정할 수 있는 상태는 초안과 확정뿐이다. 진행중·완료를 직접 지정하면 작업지시·생산실적과 어긋난다.
 *
 * 수동 전이 표
 *   DRAFT       → CONFIRMED
 *   CONFIRMED   → DRAFT       (유효한 작업지시가 없을 때만)
 *   IN_PROGRESS / COMPLETED / CANCELLED → 수동 변경 없음(수정 자체도 불가)
 */
export type PlanStatusValue = "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"

export const PLAN_STATUS_LABEL: Record<PlanStatusValue, string> = {
  DRAFT: "초안",
  CONFIRMED: "확정",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

export const MANUAL_PLAN_STATUS_TRANSITIONS: Record<PlanStatusValue, PlanStatusValue[]> = {
  DRAFT: ["CONFIRMED"],
  CONFIRMED: ["DRAFT"],
  IN_PROGRESS: [],
  COMPLETED: [],
  CANCELLED: [],
}

/** 새 생산계획을 등록할 때 고를 수 있는 상태 */
export const CREATABLE_PLAN_STATUSES: PlanStatusValue[] = ["DRAFT", "CONFIRMED"]

/** 수정할 수 있는 상태(그 외는 조회만) */
export const EDITABLE_PLAN_STATUSES: PlanStatusValue[] = ["DRAFT", "CONFIRMED"]

export const isPlanEditable = (status: PlanStatusValue) => EDITABLE_PLAN_STATUSES.includes(status)

/** 수정 화면의 상태 선택지: 현재 상태 + 수동으로 갈 수 있는 상태 */
export function selectablePlanStatuses(current: PlanStatusValue | null): PlanStatusValue[] {
  if (current === null) return CREATABLE_PLAN_STATUSES
  if (!isPlanEditable(current)) return [current]
  return [current, ...MANUAL_PLAN_STATUS_TRANSITIONS[current]]
}

export const AUTO_STATUS_GUIDE = "진행중·완료 상태는 작업지시와 POP 생산실적에 따라 자동으로 바뀝니다. 직접 지정할 수 없습니다."

export const PLAN_NOT_EDITABLE_MESSAGE = (status: PlanStatusValue) =>
  `'${PLAN_STATUS_LABEL[status]}' 상태의 생산계획은 수정할 수 없습니다. ${status === "CANCELLED" ? "취소된 계획은 이력으로만 남습니다." : "진행중·완료 계획은 작업지시와 생산실적에 연결되어 있어 변경하지 않습니다."}`

/** 새 계획 등록 시 상태 검증. 문제가 있으면 한글 사유, 없으면 null */
export function validatePlanStatusForCreate(target: PlanStatusValue): string | null {
  if (target === "CANCELLED") return "취소 상태로 생산계획을 직접 등록할 수 없습니다."
  if (!CREATABLE_PLAN_STATUSES.includes(target)) return `${AUTO_STATUS_GUIDE} 새 생산계획은 초안 또는 확정으로만 등록할 수 있습니다.`
  return null
}

/** 수정 시 상태 변경 검증. 같은 상태 유지는 항상 허용. 문제가 있으면 한글 사유, 없으면 null */
export function validatePlanStatusChange(
  current: PlanStatusValue,
  target: PlanStatusValue,
  ctx: { hasEffectiveWorkOrders: boolean }
): string | null {
  if (target === "CANCELLED") return "생산계획 취소는 취소 기능을 이용해 주세요."
  if (!isPlanEditable(current)) return PLAN_NOT_EDITABLE_MESSAGE(current)
  if (target === current) return null
  if (!MANUAL_PLAN_STATUS_TRANSITIONS[current].includes(target)) {
    if (target === "IN_PROGRESS" || target === "COMPLETED") return `${AUTO_STATUS_GUIDE} 초안 또는 확정으로만 변경할 수 있습니다.`
    return `'${PLAN_STATUS_LABEL[current]}' 상태에서 '${PLAN_STATUS_LABEL[target]}' 상태로 직접 변경할 수 없습니다.`
  }
  if (current === "CONFIRMED" && target === "DRAFT" && ctx.hasEffectiveWorkOrders) {
    return "작업지시가 있는 생산계획은 초안으로 되돌릴 수 없습니다. 작업지시를 먼저 정리해 주세요."
  }
  return null
}
