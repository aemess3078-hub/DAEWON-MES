/**
 * 수주 상태 전이 정책 (N-18) — 서버 액션과 화면이 같은 규칙을 쓰는 순수 모듈(DB·React 의존 없음).
 *
 * 신규 등록
 *   등록 즉시 확정(NEW_SALES_ORDER_STATUS). 초안 단계 없음 — 서버(createSalesOrder)가 화면 값과 무관하게 CONFIRMED 로 저장한다.
 *   기존 초안 수주는 그대로 두고 수정 화면에서 개별 확정한다.
 * 수동 변경
 *   초안 → 확정 / 취소 · 확정 → 초안 / 취소 · 생산중 → 취소 · 출하완료 → 완료
 *   부분출하·완료·취소는 수동 변경 불가.
 *   취소·초안 복귀는 취소되지 않은 생산계획, 작업지시, 출하(예정·확정) 이력이 없을 때만 허용한다(연쇄 취소·삭제 없음).
 *   출하완료 → 완료는 전 품목이 수주 수량만큼 출하되고 열린(예정·준비) 출하가 없을 때만 허용한다.
 * 자동 변경
 *   생산중·부분출하·출하완료는 생산의뢰·출하 처리 결과로 시스템이 바꾸며 사용자가 직접 지정할 수 없다.
 * 출하
 *   확정·생산중·부분출하 수주만 출하를 등록·확정할 수 있다.
 */
export type SalesOrderStatusValue = "DRAFT" | "CONFIRMED" | "IN_PRODUCTION" | "PARTIAL_SHIPPED" | "SHIPPED" | "CLOSED" | "CANCELLED"

export const SALES_ORDER_STATUS_LABEL: Record<SalesOrderStatusValue, string> = {
  DRAFT: "초안", CONFIRMED: "확정", IN_PRODUCTION: "생산중", PARTIAL_SHIPPED: "부분출하", SHIPPED: "출하완료", CLOSED: "완료", CANCELLED: "취소",
}

/** 현재 상태에서 사용자가 직접 바꿀 수 있는 상태(현재 상태 제외) */
export const MANUAL_STATUS_TRANSITIONS: Record<SalesOrderStatusValue, SalesOrderStatusValue[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DRAFT", "CANCELLED"],
  IN_PRODUCTION: ["CANCELLED"],
  PARTIAL_SHIPPED: [],
  SHIPPED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
}

/** 수주 등록 요청에서 받아 줄 수 있는 값(구 클라이언트 호환). 저장되는 상태는 항상 NEW_SALES_ORDER_STATUS 다. */
export const CREATABLE_STATUSES: SalesOrderStatusValue[] = ["DRAFT", "CONFIRMED"]
/** 새로 등록하는 수주의 상태. 등록 즉시 확정되며 별도의 확정 작업이 없다. 기존 초안 수주는 그대로 두고 수정 화면에서 개별 확정한다. */
export const NEW_SALES_ORDER_STATUS: SalesOrderStatusValue = "CONFIRMED"

/**
 * 수주 등록 시 저장할 상태를 정한다(서버 액션 전용 정책 — 화면 값과 무관하게 항상 확정).
 * 요청에 상태가 없거나 초안·확정이면 확정으로 저장하고, 그 외(생산중·출하·완료·취소)는 등록할 수 없다.
 */
export function resolveNewSalesOrderStatus(requested?: string | null): { ok: true; status: SalesOrderStatusValue } | { ok: false; error: string } {
  if (requested !== undefined && requested !== null && !CREATABLE_STATUSES.includes(requested as SalesOrderStatusValue)) {
    return { ok: false, error: "수주는 등록 즉시 확정됩니다. 생산중·출하·완료·취소 상태로는 등록할 수 없습니다." }
  }
  return { ok: true, status: NEW_SALES_ORDER_STATUS }
}
/** 출하를 등록·확정할 수 있는 수주 상태 */
export const SHIPPABLE_STATUSES: SalesOrderStatusValue[] = ["CONFIRMED", "IN_PRODUCTION", "PARTIAL_SHIPPED"]
const TERMINAL: SalesOrderStatusValue[] = ["CLOSED", "CANCELLED"]
const DERIVED: SalesOrderStatusValue[] = ["IN_PRODUCTION", "PARTIAL_SHIPPED", "SHIPPED"]

export const isTerminalSalesOrderStatus = (s: string) => TERMINAL.includes(s as SalesOrderStatusValue)

/** 수정 화면에서 선택할 수 있는 상태: 현재 상태 + 직접 변경 가능한 상태 */
export function selectableSalesOrderStatuses(current: SalesOrderStatusValue): SalesOrderStatusValue[] {
  return [current, ...MANUAL_STATUS_TRANSITIONS[current]]
}

export type SalesOrderFollowUp = {
  activePlanNos: string[]
  workOrderNos: string[]
  /** 취소되지 않은 출하(예정·준비·출하·납품) 번호 */
  shipmentNos: string[]
  /** 열린 출하(예정·준비) 번호 */
  openShipmentNos: string[]
  /** 전 품목이 수주 수량 이상 출하됐는지 */
  fullyShipped: boolean
  hasShippedQty: boolean
}

const list = (nos: string[]) => (nos.length <= 3 ? nos.join(", ") : `${nos.slice(0, 3).join(", ")} 외 ${nos.length - 3}건`)

/** 상태 변경 요청 검증. 허용이면 null, 거부면 사용자에게 보여 줄 한글 사유를 돌려준다. */
export function validateSalesOrderStatusChange(current: SalesOrderStatusValue, target: SalesOrderStatusValue, followUp: SalesOrderFollowUp): string | null {
  if (target === current) return null
  const cur = SALES_ORDER_STATUS_LABEL[current], tgt = SALES_ORDER_STATUS_LABEL[target]
  if (TERMINAL.includes(current)) return `${cur} 수주는 상태를 변경할 수 없습니다.`
  if (DERIVED.includes(target)) return `'${tgt}' 상태는 직접 지정할 수 없습니다. 생산의뢰와 출하 처리 결과에 따라 자동으로 바뀝니다.`
  if (!MANUAL_STATUS_TRANSITIONS[current].includes(target)) {
    if (current === "PARTIAL_SHIPPED") return "부분출하 수주는 상태를 직접 변경할 수 없습니다. 남은 수량을 출하해 주세요."
    return `'${cur}' 수주를 '${tgt}' 상태로 변경할 수 없습니다.`
  }
  if (target === "CLOSED") {
    if (!followUp.fullyShipped) return "전체 수량이 출하되지 않은 수주는 완료 처리할 수 없습니다."
    if (followUp.openShipmentNos.length > 0) return `출하 예정 건(${list(followUp.openShipmentNos)})이 남아 있어 완료 처리할 수 없습니다.`
    return null
  }
  if (target === "CANCELLED" || target === "DRAFT") {
    const action = target === "CANCELLED" ? "취소" : "초안으로 되돌릴"
    const reasons: string[] = []
    if (followUp.activePlanNos.length > 0) reasons.push(`취소되지 않은 생산계획(${list(followUp.activePlanNos)})`)
    if (followUp.workOrderNos.length > 0) reasons.push(`작업지시(${list(followUp.workOrderNos)})`)
    if (followUp.shipmentNos.length > 0) reasons.push(`출하 예정·이력(${list(followUp.shipmentNos)})`)
    if (followUp.hasShippedQty && followUp.shipmentNos.length === 0) reasons.push("출하 이력")
    if (reasons.length > 0) return `${reasons.join(", ")}이(가) 남아 있어 수주를 ${action} 수 없습니다. 연결된 업무를 먼저 취소하거나 정리해 주세요.`
  }
  return null
}

// ─── 수주 품목 수정 정책 ────────────────────────────────────────────────────────
// 초안·확정 수주는 후속 업무(취소되지 않은 생산계획·작업지시·출하, 출하 수량)가 없을 때만 품목·수량을 고칠 수 있다.
// 후속 업무가 있거나 생산중·부분출하·출하완료·완료·취소 상태이면 품목은 읽기 전용이다(수주 충당·출하 수량·LOT 연결 보호).
// 서버(updateSalesOrder)와 화면이 같은 규칙을 쓴다.

/** 품목 수정이 막혀 있으면 한글 사유, 수정할 수 있으면 null */
export function salesOrderItemEditBlockReason(current: SalesOrderStatusValue, followUp: SalesOrderFollowUp): string | null {
  // 연결된 업무가 있으면 그 번호를 먼저 안내한다(생산중·부분출하 수주는 보통 이 경우)
  const parts: string[] = []
  if (followUp.activePlanNos.length > 0) parts.push(`생산계획(${list(followUp.activePlanNos)})`)
  if (followUp.workOrderNos.length > 0) parts.push(`작업지시(${list(followUp.workOrderNos)})`)
  if (followUp.shipmentNos.length > 0) parts.push(`출하(${list(followUp.shipmentNos)})`)
  if (followUp.hasShippedQty && followUp.shipmentNos.length === 0) parts.push("출하 이력")
  if (parts.length > 0) return `${parts.join(", ")}이(가) 연결되어 있어 품목·수량을 수정할 수 없습니다. 연결된 업무를 먼저 취소하거나 정리해 주세요.`
  if (current !== "DRAFT" && current !== "CONFIRMED") return `'${SALES_ORDER_STATUS_LABEL[current]}' 수주는 품목·수량을 수정할 수 없습니다.`
  return null
}

export type SalesOrderItemEditInput = {
  itemId: string
  qty: number | string
  unitPrice?: number | string | null
  deliveryDate?: Date | string | null
  note?: string | null
}

const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v))
const dateKey = (v: Date | string | null | undefined) => (v === undefined || v === null || v === "" ? null : new Date(v).toISOString().slice(0, 10))
const noteKey = (v: string | null | undefined) => (v ?? "").trim()

/** 수정 입력의 기본 검증(품목 필수·중복 금지·수량 양수). 문제가 있으면 한글 사유 */
export function validateSalesOrderItemEditInput(items: SalesOrderItemEditInput[]): string | null {
  if (items.length === 0) return "수주 품목을 1개 이상 입력해 주세요."
  const seen = new Set<string>()
  for (const it of items) {
    if (!it.itemId) return "품목을 선택해 주세요."
    if (seen.has(it.itemId)) return "같은 품목을 수주 품목에 중복으로 입력할 수 없습니다."
    seen.add(it.itemId)
    const q = num(it.qty)
    if (q === null || !Number.isFinite(q) || q <= 0) return "수주 수량은 0보다 커야 합니다."
    const p = num(it.unitPrice)
    if (p !== null && (!Number.isFinite(p) || p < 0)) return "단가는 0 이상이어야 합니다."
  }
  return null
}

/**
 * 저장된 품목과 입력 품목이 같은지(품목·수량·단가, 입력에 있는 납기·비고). 같으면 품목 수정이 아니므로
 * 수정이 막힌 수주에서도 일반 수정(비고·고객·납기 등)과 함께 그대로 통과시킨다.
 */
export function sameSalesOrderItems(
  current: { itemId: string; qty: unknown; unitPrice: unknown; deliveryDate: Date | null; note: string | null }[],
  incoming: SalesOrderItemEditInput[]
): boolean {
  if (current.length !== incoming.length) return false
  const byItem = new Map(current.map((c) => [c.itemId, c]))
  return incoming.every((n) => {
    const c = byItem.get(n.itemId)
    if (!c) return false
    if (num(c.qty) !== num(n.qty)) return false
    if (num(c.unitPrice) !== num(n.unitPrice)) return false
    if (n.deliveryDate !== undefined && dateKey(c.deliveryDate) !== dateKey(n.deliveryDate)) return false
    if (n.note !== undefined && noteKey(c.note) !== noteKey(n.note)) return false
    return true
  })
}

export const SALES_ORDER_NOT_SHIPPABLE_MESSAGE = "확정·생산중·부분출하 상태의 수주만 출하를 등록·확정할 수 있습니다."
export function salesOrderNotShippableMessage(status: string): string {
  const label = SALES_ORDER_STATUS_LABEL[status as SalesOrderStatusValue] ?? status
  return `${label} 상태의 수주에는 출하를 등록·확정할 수 없습니다. ${SALES_ORDER_NOT_SHIPPABLE_MESSAGE}`
}
