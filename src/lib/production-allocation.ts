/**
 * 생산계획 품목의 생산 유형·수주 충당 수량 규칙 (순수 모듈 — DB·React 의존 없음)
 *
 *  - plannedQty   : 실제 생산 허용량(작업지시·완제품입고·MRP 기준)
 *  - allocatedQty : 이 계획 줄이 수주 품목 수량에서 가져가는 몫. 수주 품목별 합계(취소 계획 제외) ≤ 수주 수량.
 *  - 유형: STOCK(수주 연결 없음, 충당 0) / ORDER(충당 = 계획) / ORDER_EXTRA(충당 < 계획, 여유 사유 필수)
 *  - 계획 수량이 수주 수량을 넘는다는 이유만으로는 거부하지 않는다. 다른 계획이 이미 충당한 수량을 다시 배정하는 것만 거부한다.
 *  - 승인 정책(자동 승인 비율·승인 권한)은 미확정이라 여기서는 상태 값을 바꾸지 않는다(1단계).
 * SalesOrderItem.producedQty(생산실적 컬럼)는 이 규칙과 무관하다.
 */
import { formatScaledQuantity, toScaledQuantity } from "./quantity-scale"

export type ProductionKindValue = "ORDER" | "ORDER_EXTRA" | "STOCK"
export type ExtraApprovalStatusValue = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED"

export const PRODUCTION_KIND_LABEL: Record<ProductionKindValue, string> = {
  ORDER: "수주 생산",
  ORDER_EXTRA: "수주+여유 생산",
  STOCK: "재고 생산",
}

export const EXTRA_REASON_MAX_LENGTH = 500
export const EXTRA_REASON_REQUIRED_MESSAGE = "여유 생산 사유를 입력해 주세요. 계획 수량이 수주 충당 수량보다 많습니다."
export const PLAN_QTY_INVALID_MESSAGE = "계획 수량은 0보다 크고 소수점 6자리 이하여야 합니다."

export function normalizeExtraReason(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export function classifyProductionKind(args: { linked: boolean; plannedScaled: bigint; allocatedScaled: bigint }): ProductionKindValue {
  if (!args.linked) return "STOCK"
  return args.allocatedScaled === args.plannedScaled ? "ORDER" : "ORDER_EXTRA"
}

export type PlanItemUpdateInput = {
  linked: boolean
  existing: { kind: ProductionKindValue; allocatedScaled: bigint; extraReason: string | null }
  plannedQty: unknown
  /** 화면/호출자가 충당 수량을 지정하지 않으면 undefined — 기존 충당 수량을 유지(계획 수량이 더 작으면 계획 수량으로 줄임) */
  allocatedQty?: unknown
  /** undefined = 기존 사유 유지, null/빈 문자열 = 사유 없음 */
  extraReason?: unknown
}

export type PlanItemUpdateResult =
  | {
      ok: true
      plannedScaled: bigint
      allocatedScaled: bigint
      kind: ProductionKindValue
      extraReason: string | null
      /** 충당 수량이 늘었는지(늘었을 때만 수주 품목 충당 합계를 검증한다) */
      allocationIncreased: boolean
    }
  | { ok: false; error: string }

/** 생산계획 수정 한 줄의 계획 수량·충당 수량·유형·여유 사유를 정한다. 수주 수량 합계 검증은 호출자가 잠금 아래에서 한다. */
export function resolvePlanItemUpdate(input: PlanItemUpdateInput): PlanItemUpdateResult {
  const plannedScaled = toScaledQuantity(input.plannedQty)
  if (plannedScaled === null || plannedScaled <= BigInt(0)) return { ok: false, error: PLAN_QTY_INVALID_MESSAGE }

  if (!input.linked) {
    if (input.allocatedQty !== undefined && input.allocatedQty !== null) {
      const a = toScaledQuantity(input.allocatedQty)
      if (a === null || a !== BigInt(0)) return { ok: false, error: "수주 연결이 없는 재고 생산 계획에는 수주 충당 수량을 지정할 수 없습니다." }
    }
    return { ok: true, plannedScaled, allocatedScaled: BigInt(0), kind: "STOCK", extraReason: null, allocationIncreased: false }
  }

  let allocatedScaled: bigint
  if (input.allocatedQty === undefined || input.allocatedQty === null) {
    allocatedScaled = input.existing.allocatedScaled < plannedScaled ? input.existing.allocatedScaled : plannedScaled
  } else {
    const a = toScaledQuantity(input.allocatedQty)
    if (a === null || a < BigInt(0)) return { ok: false, error: "수주 충당 수량은 0 이상이고 소수점 6자리 이하여야 합니다." }
    if (a > plannedScaled) return { ok: false, error: `수주 충당 수량(${formatScaledQuantity(a)})은 계획 수량(${formatScaledQuantity(plannedScaled)})보다 클 수 없습니다.` }
    allocatedScaled = a
  }

  const kind = classifyProductionKind({ linked: true, plannedScaled, allocatedScaled })
  let extraReason: string | null = null
  if (kind === "ORDER_EXTRA") {
    extraReason = input.extraReason === undefined ? normalizeExtraReason(input.existing.extraReason) : normalizeExtraReason(input.extraReason)
    if (!extraReason) return { ok: false, error: EXTRA_REASON_REQUIRED_MESSAGE }
    if (extraReason.length > EXTRA_REASON_MAX_LENGTH) return { ok: false, error: `여유 생산 사유는 ${EXTRA_REASON_MAX_LENGTH}자 이하로 입력해 주세요.` }
  }
  return { ok: true, plannedScaled, allocatedScaled, kind, extraReason, allocationIncreased: allocatedScaled > input.existing.allocatedScaled }
}
