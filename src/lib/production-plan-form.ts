/**
 * 생산계획 화면(등록·수정·목록·상세) 공통 표시·입력 규칙 — 순수 모듈 (DB·React 의존 없음)
 *
 * 서버(N-19 updatePlan, 2-A 조회 모델)가 최종 판정·계산한다. 화면은 같은 규칙으로 입력을 미리 안내하고
 * 서버가 준 값을 표시할 뿐이며, 충당·미충당·입고 같은 수량은 여기서 새로 계산하지 않는다(실제 계획 수량 = 충당 + 여유 입력의 합만 표시용으로 계산).
 */
import { formatScaledQuantity, toScaledQuantity } from "./quantity-scale"
import { EXTRA_REASON_MAX_LENGTH } from "./production-allocation"

export type ProductionKindOrMixed = "ORDER" | "ORDER_EXTRA" | "STOCK" | "MIXED"

export const PRODUCTION_KIND_LABEL_KO: Record<ProductionKindOrMixed, string> = {
  ORDER: "수주 생산",
  ORDER_EXTRA: "수주+여유 생산",
  STOCK: "재고 생산",
  MIXED: "혼합",
}

export const PRODUCTION_KIND_FILTER_OPTIONS = [
  { label: "수주 생산", value: "ORDER" },
  { label: "수주+여유 생산", value: "ORDER_EXTRA" },
  { label: "재고 생산", value: "STOCK" },
  { label: "혼합", value: "MIXED" },
]

export const APPROVAL_STATUS_LABEL_KO: Record<string, string> = {
  NOT_REQUIRED: "승인 상태 없음",
  PENDING: "승인 대기",
  APPROVED: "승인 완료",
  REJECTED: "반려",
}

export const APPROVAL_POLICY_NOTICE_KO =
  "여유 생산 승인 정책은 아직 적용되지 않습니다. 승인 상태는 저장된 값을 그대로 보여 주며, '승인 대기'는 승인 완료가 아닙니다."

export const ORDER_PLAN_REGISTRATION_GUIDE =
  "수주 생산·수주+여유 생산 계획은 수주 처리 화면의 생산의뢰에서 등록합니다(중복 충당 방지·요청 ID 보호·수주 상태 연동이 그 경로에 있습니다). 이 화면에서는 재고 생산 계획을 등록하고, 이미 만들어진 계획을 수정·조회합니다."

/** 한 계획의 줄 유형 요약: 모두 같으면 그 유형, 섞이면 MIXED, 줄이 없으면 STOCK */
export function summarizeKinds(kinds: string[]): ProductionKindOrMixed {
  const set = Array.from(new Set(kinds))
  if (set.length === 0) return "STOCK"
  if (set.length === 1) return set[0] as ProductionKindOrMixed
  return "MIXED"
}

const ZERO = BigInt(0)
const sc = (v: unknown) => (v === null || v === undefined || v === "" ? ZERO : (toScaledQuantity(typeof v === "number" ? v : String(v)) ?? null))

/** 실제 계획 수량 = 충당 + 여유 (표시용 합산, 6자리 정수 계산) */
export function sumQty(allocated: unknown, extra: unknown): number {
  const a = sc(allocated), e = sc(extra)
  return a === null || e === null ? Number.NaN : Number(formatScaledQuantity(a + e))
}

/** 계획 수량 − 충당 수량 (수정 화면 초기값 표시용, 서버 조회 모델 값이 없을 때만 사용) */
export function diffQty(planned: unknown, allocated: unknown): number {
  const p = sc(planned), a = sc(allocated)
  return p === null || a === null ? Number.NaN : Number(formatScaledQuantity(p > a ? p - a : ZERO))
}

export type LinkedRowEvaluation = {
  plannedQty: number
  kind: "ORDER" | "ORDER_EXTRA"
  errors: { alloc?: string; extra?: string; reason?: string }
}

/** 수주 연결 줄 입력 검증. maxAllocatable = 수주 수량 − 다른 계획 줄의 충당(서버 조회 모델 값, 없으면 null) */
export function evaluateLinkedRow(input: { allocatedQty: unknown; extraQty: unknown; extraReason: unknown; maxAllocatable: number | null }): LinkedRowEvaluation {
  const errors: LinkedRowEvaluation["errors"] = {}
  const alloc = sc(input.allocatedQty), extra = sc(input.extraQty)
  if (alloc === null) errors.alloc = "수주 충당 수량은 소수점 6자리 이하 숫자로 입력해 주세요."
  if (extra === null) errors.extra = "여유 생산 수량은 소수점 6자리 이하 숫자로 입력해 주세요."
  const reason = typeof input.extraReason === "string" ? input.extraReason.trim() : ""
  if (alloc !== null && alloc <= ZERO) errors.alloc = "수주 충당 수량은 0보다 커야 합니다. 수주와 무관한 생산은 재고 생산 계획으로 등록해 주세요."
  if (alloc !== null && input.maxAllocatable !== null) {
    const max = toScaledQuantity(input.maxAllocatable) ?? ZERO
    if (alloc > max) errors.alloc = `수주 충당 수량(${formatScaledQuantity(alloc)})이 이 줄에 충당할 수 있는 최대(${formatScaledQuantity(max)})를 초과합니다. 다른 계획이 이미 충당한 수량은 다시 배정할 수 없습니다.`
  }
  if (extra !== null && extra < ZERO) errors.extra = "여유 생산 수량은 0 이상이어야 합니다."
  if (extra !== null && extra > ZERO && reason.length === 0) errors.reason = "여유 생산 사유를 입력해 주세요."
  if (reason.length > EXTRA_REASON_MAX_LENGTH) errors.reason = `여유 생산 사유는 ${EXTRA_REASON_MAX_LENGTH}자 이하로 입력해 주세요.`
  const planned = sumQty(input.allocatedQty, input.extraQty)
  return { plannedQty: planned, kind: extra !== null && extra > ZERO ? "ORDER_EXTRA" : "ORDER", errors }
}
