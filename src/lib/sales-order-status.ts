/**
 * 수주 상태 전이 정책 (N-18) — 서버 액션과 화면이 같은 규칙을 쓰는 순수 모듈(DB·React 의존 없음).
 *
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

/** 수주 등록 시 지정할 수 있는 상태 */
export const CREATABLE_STATUSES: SalesOrderStatusValue[] = ["DRAFT", "CONFIRMED"]
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

export const SALES_ORDER_NOT_SHIPPABLE_MESSAGE = "확정·생산중·부분출하 상태의 수주만 출하를 등록·확정할 수 있습니다."
export function salesOrderNotShippableMessage(status: string): string {
  const label = SALES_ORDER_STATUS_LABEL[status as SalesOrderStatusValue] ?? status
  return `${label} 상태의 수주에는 출하를 등록·확정할 수 없습니다. ${SALES_ORDER_NOT_SHIPPABLE_MESSAGE}`
}
