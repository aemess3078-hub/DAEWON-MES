/**
 * 출하예정 등록(예약) 수량 계산 — 화면(출하 시트)과 서버(createShipment)가 같은 식을 쓴다.
 *
 * - 수주 품목 추가 출하 가능 = 수주수량 − 출하완료 − 기존 출하예정(PLANNED 출하의 예약 수량)
 * - LOT 예약 가능 수량     = LOT 재고(가용) − 기존 출하예정 예약(같은 창고·품목·LOT 의 PLANNED 출하)
 *
 * 출하예정 등록은 실제 재고를 바꾸지 않는다(예약만). 실제 차감은 출하 확정에서만 한 번 일어난다.
 * 이 모듈은 "use server" 가 아니므로 클라이언트 컴포넌트와 서버 액션 양쪽에서 import 할 수 있다.
 */

/** 업무 규칙 위반(사용자에게 그대로 보여 줘도 되는 한국어 메시지). 그 밖의 오류는 서버 로그에만 남긴다. */
export class ShipmentPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShipmentPlanError"
  }
}

/** 예상하지 못한 서버 오류일 때 화면에 보여 주는 문구(DB/경로 등 내부 정보 없음). */
export const SHIPMENT_PLAN_SYSTEM_ERROR_MESSAGE =
  "출하예정 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."

/** 수주 품목의 추가 출하 가능 수량(음수 방지). */
export function calculateShippableQty(
  orderQty: number,
  shippedQty: number,
  plannedQty: number,
): number {
  return Math.max(0, orderQty - shippedQty - plannedQty)
}

/** LOT 의 예약 가능 수량(음수 방지). */
export function calculateReservableLotQty(
  stockQty: number,
  reservedQty: number,
): number {
  return Math.max(0, stockQty - reservedQty)
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

/** LOT 예약 가능 수량 초과 */
export function lotReservableExceededMessage(input: {
  lotNo: string
  requestedQty: number
  reservableQty: number
}): string {
  return [
    "출하예정 등록 불가",
    `선택한 LOT(${input.lotNo})의 예약 가능 수량은 ${fmt(input.reservableQty)}개입니다.`,
    `요청 수량 ${fmt(input.requestedQty)} / 예약 가능 수량 ${fmt(input.reservableQty)} / 출하 수량을 확인해 주세요.`,
  ].join("\n")
}

/** 수주 품목 추가 출하 가능 수량 초과 (또는 0) */
export function orderShippableExceededMessage(input: {
  itemCode: string
  orderQty: number
  shippedQty: number
  plannedQty: number
  requestedQty: number
  shippableQty: number
}): string {
  if (input.shippableQty <= 0) {
    return [
      "출하예정 등록 불가",
      `[${input.itemCode}] 추가 출하 가능 수량이 없습니다.`,
      `수주 ${fmt(input.orderQty)} − 출하완료 ${fmt(input.shippedQty)} − 기존 출하예정 ${fmt(input.plannedQty)} = 0`,
      "기존 출하예정을 확인해 주세요.",
    ].join("\n")
  }
  return [
    "출하예정 등록 불가",
    `[${input.itemCode}] 추가 출하 가능 수량은 ${fmt(input.shippableQty)}개입니다.`,
    `수주 ${fmt(input.orderQty)} / 출하완료 ${fmt(input.shippedQty)} / 기존 출하예정 ${fmt(input.plannedQty)} / 요청 수량 ${fmt(input.requestedQty)}`,
    "출하 수량을 확인해 주세요.",
  ].join("\n")
}

/** 비LOT 품목: 선택 창고 재고의 예약 가능 수량 초과 */
export function stockReservableExceededMessage(input: {
  itemCode: string
  requestedQty: number
  reservableQty: number
}): string {
  return [
    "출하예정 등록 불가",
    `[${input.itemCode}] 선택한 창고의 예약 가능 수량은 ${fmt(input.reservableQty)}개입니다.`,
    `요청 수량 ${fmt(input.requestedQty)} / 예약 가능 수량 ${fmt(input.reservableQty)} / 출하 수량을 확인해 주세요.`,
  ].join("\n")
}
