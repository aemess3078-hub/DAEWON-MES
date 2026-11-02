/**
 * 수주 처리 화면 생산의뢰 입력 — 클라이언트 검증·요청 키 규칙 (순수 모듈, DB·React 의존 없음)
 *
 * 서버(N-14·N-19, requestProductionFromSalesOrder)가 최종 판정한다. 여기서는 같은 규칙을 입력 단계에서 미리 안내할 뿐이며
 * 수량 계산식(미충당·부족수량 등)은 2-A 조회 모델이 준 값을 그대로 쓰고 이 모듈에서 새로 계산하지 않는다.
 *
 *  - 수주 충당 수량 > 0 이고 서버 기준 미충당 수량(unallocatedQty) 이하
 *  - 여유 생산 수량 ≥ 0, 여유가 있으면 사유 필수(500자 이하)
 *  - 실제 생산계획 수량 = 충당 + 여유, 여유가 0 이면 ORDER, 있으면 ORDER_EXTRA
 *  - 충당 수량 0 인 줄은 의뢰에 넣지 않는다(수주 없는 재고 생산은 생산계획 화면의 재고 생산 등록 경로)
 *  - 요청 ID: 같은 입력의 재시도는 같은 ID, 입력이 바뀌면 새 ID, 성공 후 다음 의뢰는 새 ID
 */
import { formatScaledQuantity, toScaledQuantity } from "./quantity-scale"
import { EXTRA_REASON_MAX_LENGTH } from "./production-allocation"

export const STOCK_PRODUCTION_GUIDE = "수주 충당이 0인 독립 재고 생산은 생산계획 화면에서 재고 생산 계획으로 등록해 주세요."

export type RequestRowInput = {
  salesOrderItemId: string
  itemId: string
  /** 서버(조회 모델)가 계산한 수주 미충당 수량 — 충당 수량의 상한 */
  unallocatedQty: number
  allocText: string
  extraText: string
  reasonText: string
}

export type RequestLine = { salesOrderItemId: string; itemId: string; qty: number; extraQty: number; extraReason: string | null }

export type RowErrors = { alloc?: string; extra?: string; reason?: string }

export type RequestRowEvaluation =
  | { ok: true; included: false }
  | { ok: true; included: true; line: RequestLine; plannedQty: string; kind: "ORDER" | "ORDER_EXTRA" }
  | { ok: false; errors: RowErrors }

const ZERO = BigInt(0)

/** 입력 문자열 → 6자리 정수. 빈 문자열은 0, 형식이 틀리면 null */
export function parseQtyText(text: string): bigint | null {
  const t = (text ?? "").trim().replace(/,/g, "")
  if (t === "") return ZERO
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null
  return toScaledQuantity(t)
}

export function evaluateRequestRow(row: RequestRowInput): RequestRowEvaluation {
  const errors: RowErrors = {}
  const alloc = parseQtyText(row.allocText)
  const extra = parseQtyText(row.extraText)
  const unalloc = toScaledQuantity(row.unallocatedQty) ?? ZERO
  if (alloc === null) errors.alloc = "수주 충당 수량은 0 이상의 숫자(소수점 6자리 이하)로 입력해 주세요."
  if (extra === null) errors.extra = "여유 생산 수량은 0 이상의 숫자(소수점 6자리 이하)로 입력해 주세요."
  if (alloc === null || extra === null) return { ok: false, errors }

  if (alloc === ZERO && extra === ZERO) return { ok: true, included: false }
  if (alloc === ZERO) {
    errors.alloc = `수주 충당 수량이 0이면 여유 생산만 의뢰할 수 없습니다. ${STOCK_PRODUCTION_GUIDE}`
    return { ok: false, errors }
  }
  if (alloc > unalloc) {
    errors.alloc = `수주 충당 수량(${formatScaledQuantity(alloc)})이 추가 충당 가능량(${formatScaledQuantity(unalloc)})을 초과합니다.`
  }
  const reason = (row.reasonText ?? "").trim()
  if (extra > ZERO && reason.length === 0) errors.reason = "여유 생산 사유를 입력해 주세요."
  if (reason.length > EXTRA_REASON_MAX_LENGTH) errors.reason = `여유 생산 사유는 ${EXTRA_REASON_MAX_LENGTH}자 이하로 입력해 주세요.`
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    included: true,
    line: {
      salesOrderItemId: row.salesOrderItemId,
      itemId: row.itemId,
      qty: Number(formatScaledQuantity(alloc)),
      extraQty: Number(formatScaledQuantity(extra)),
      extraReason: extra > ZERO ? reason : null,
    },
    plannedQty: formatScaledQuantity(alloc + extra),
    kind: extra > ZERO ? "ORDER_EXTRA" : "ORDER",
  }
}

/** 기본 충당 수량: 기존 화면과 같은 값(기존 부족수량)을 서버 기준 미충당 수량 안으로 자른 값. 신규 부족수량 계산은 적용하지 않는다 */
export function defaultAllocationText(legacyShortageQty: number, unallocatedQty: number): string {
  const s = toScaledQuantity(legacyShortageQty) ?? ZERO
  const u = toScaledQuantity(unallocatedQty) ?? ZERO
  const v = s < u ? s : u
  return v > ZERO ? formatScaledQuantity(v) : ""
}

/** 입력 내용이 같은지 판단하는 키(수주·품목별 충당·여유·사유). 빈 줄은 포함하지 않는다 */
export function buildRequestKey(salesOrderId: string, lines: RequestLine[]): string {
  const canon = lines
    .map((l) => [l.salesOrderItemId, l.itemId, formatScaledQuantity(toScaledQuantity(l.qty) ?? ZERO), formatScaledQuantity(toScaledQuantity(l.extraQty) ?? ZERO), l.extraReason ?? ""].join("|"))
    .sort()
    .join(";")
  return `${salesOrderId};${canon}`
}

/**
 * 요청 ID 보관기: 같은 입력(key)의 재시도(실패·네트워크 끊김·더블클릭)는 같은 ID 를 돌려주고,
 * 입력이 바뀌면 새 ID, 성공 후 reset() 하면 다음 의뢰는 새 ID.
 */
export function createRequestIdKeeper(generate: () => string) {
  let id: string | null = null
  let keyOfId: string | null = null
  return {
    idFor(key: string): string {
      if (id === null || keyOfId !== key) { id = generate(); keyOfId = key }
      return id
    },
    reset() { id = null; keyOfId = null },
    peek() { return { id, key: keyOfId } },
  }
}

/** 의뢰 가능한 수주 상태(서버 requestProductionFromSalesOrder 와 같은 기준: 취소·종결·출하완료 제외) */
export const PRODUCTION_REQUEST_BLOCKED_ORDER_STATUSES = ["CANCELLED", "CLOSED", "SHIPPED"] as const

/** 2-A differenceCodes 의 한글 설명 */
export const SHORTAGE_DIFFERENCE_LABEL: Record<string, string> = {
  STOCK_EXCLUDED_BY_LOT_STATUS: "격리·보류·만료·소진 LOT 의 재고는 출하 가능 재고에서 제외했습니다.",
  STOCK_BLOCKED_BY_QUALITY_GATE: "최종검사 불합격·미검사 LOT 의 재고는 출하 가능 재고에서 제외했습니다.",
  STOCK_RESERVED_BY_PLANNED_SHIPMENT: "예정(PLANNED) 출하가 예약한 수량은 출하 가능 재고에서 제외했습니다.",
  STOCK_WITHOUT_LOT_EXCLUDED: "LOT 관리 품목인데 LOT 가 지정되지 않은 재고는 출하할 수 없어 제외했습니다.",
  PENDING_ALLOCATION_NOT_IN_LEGACY: "이미 생산계획에 충당했지만 아직 입고되지 않은 수량을 반영했습니다(기존 부족수량은 반영하지 않음).",
  PENDING_ALLOCATION_RANGE: "입고된 수량이 수주 충당분인지 여유분인지 기록되어 있지 않아 구간으로 표시합니다. 확정값이 아닙니다.",
  SHIPPED_QTY_SOURCE_MISMATCH: "수주 품목의 출하수량 값과 확정된 출하 합계가 서로 다릅니다.",
  OVER_ALLOCATED_LEGACY_DATA: "생산계획 충당 합계가 수주 수량을 넘습니다(과거 데이터). 확인이 필요합니다.",
  STOCK_SHARED_WITH_OTHER_ORDERS: "같은 품목을 기다리는 다른 수주가 있습니다. 재고는 특정 수주에 예약되지 않습니다.",
}

export const STOCK_NOT_RESERVED_NOTICE = "재고 예약 기능이 없습니다. 표시된 재고는 이 수주에 확보된 수량이 아니며, 같은 품목의 다른 수주에도 똑같이 보입니다."
export const APPROVAL_POLICY_NOTICE = "여유 생산 승인 정책은 아직 적용되지 않습니다. 승인 상태는 저장된 값을 그대로 보여 주며, '승인 대기'는 승인 완료가 아닙니다."

export const APPROVAL_STATUS_LABEL: Record<string, string> = {
  NOT_REQUIRED: "승인 상태 없음",
  PENDING: "승인 대기",
  APPROVED: "승인 완료",
  REJECTED: "반려",
}

export const PRODUCTION_KIND_BADGE: Record<string, string> = {
  ORDER: "수주 생산",
  ORDER_EXTRA: "수주+여유 생산",
  STOCK: "재고 생산",
}

/** 구간 표시: 정확하면 한 값, 아니면 "최소~최대" */
export function formatRange(minQty: number, maxQty: number, exact: boolean, fmt: (v: number) => string): string {
  return exact || minQty === maxQty ? fmt(minQty) : `${fmt(minQty)}~${fmt(maxQty)}`
}
