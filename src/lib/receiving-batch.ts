/**
 * 여러 품목 순차 입고(자재입고/발주 입고 다이얼로그 공통)의 부분 성공 처리.
 *
 * 문제: A 품목 입고 성공 → B 품목 실패 시 창이 열린 채로 남고, 같은 입력값으로 다시 저장하면 A 가 한 번 더 입고된다.
 * 해결: 품목(purchaseOrderItemId)별 처리 결과를 기억하고, 이미 확정된 품목은 재시도 때 건너뛴다.
 *
 *  - done    : 서버가 성공을 응답함 → 재처리 금지(입력 잠금)
 *  - failed  : 서버가 실패를 응답함(트랜잭션 롤백) → 수정 후 재시도 가능
 *  - unknown : 응답을 받지 못함(네트워크/서버 예외) → 서버에서 처리됐는지 알 수 없으므로 자동 재처리 금지.
 *              입고 내역을 새로고침해 확인한 뒤 다시 시도해야 한다.
 *
 * 서버 입고 트랜잭션과 재고 계산은 변경하지 않는다. 이 모듈은 순수 함수만 가진다(React/DB 의존 없음).
 */

import { toUserErrorMessage } from "@/lib/errors/user-error"
import { RECEIVING_UNKNOWN_MESSAGE } from "@/lib/receiving-request-id"
import { addQuantities, subtractQuantities } from "@/lib/quantity-scale"

export type RowReceiptStatus =
  | { state: "done" }
  | { state: "failed"; message: string }
  | { state: "unknown"; message: string }

export type RowStatusMap = Record<string, RowReceiptStatus>

// 서버 멱등성(requestId)이 있으므로 결과 불명 품목은 같은 요청 ID 로 다시 저장해도 중복 입고되지 않는다
export const UNKNOWN_RECEIPT_MESSAGE = RECEIVING_UNKNOWN_MESSAGE

/** 서버에서 처리가 확정된 품목 — 다시 보내지 않는다 */
export function isRowDone(status: RowReceiptStatus | undefined): boolean {
  return status?.state === "done"
}

/** 입력을 잠그는 품목(완료 + 결과 불명). 결과 불명 품목은 같은 내용·같은 요청 ID 로만 다시 저장할 수 있다. */
export function isRowLocked(status: RowReceiptStatus | undefined): boolean {
  return status?.state === "done" || status?.state === "unknown"
}

/** 서버(receiving.actions)는 합격수량만큼 PurchaseOrderItem.receivedQty 를 증가시킨다. 화면 표시를 같은 규칙으로 맞춘다. */
export function applyReceiptToQuantities(
  row: { orderedQty: number; receivedQty: number },
  acceptedQty: number
): { receivedQty: number; pendingQty: number } {
  // 소수점 6자리 정수로 정확히 계산한다 (0.1 + 0.2 같은 부동소수점 오차가 화면 수량에 섞이지 않도록)
  const add = Number.isFinite(acceptedQty) && acceptedQty > 0 ? acceptedQty : 0
  const receivedQty = addQuantities(row.receivedQty, add) ?? row.receivedQty
  const pending = subtractQuantities(row.orderedQty, receivedQty)
  return { receivedQty, pendingQty: pending === null ? 0 : Math.max(0, pending) }
}

/** requestId: 하나의 입고 작업에 대해 재시도에도 유지되는 서버 멱등 키 */
export type BatchRow = { purchaseOrderItemId: string; receivedInput: number; acceptedInput: number; requestId: string }

export type BatchOutcome = {
  statuses: RowStatusMap
  /** 이번 호출에서 새로 성공한 품목 id */
  newlyDone: string[]
  /** 이번 호출에서 처음 실패(또는 결과 불명)한 품목 id — 순차 처리는 여기서 중단된다 */
  stoppedAt: string | null
  /** 입고 대상(수량>0) 품목이 모두 done 인가 */
  allDone: boolean
}

/**
 * 입고 대상 품목을 순차 처리한다.
 * @param rows   화면의 품목 목록(수량 0 이하 품목은 대상이 아님)
 * @param prev   이전 시도의 품목별 결과
 * @param submit 서버 액션 호출(품목 1건). `{success:false}` 는 실패 응답, throw 는 결과 불명.
 */
export async function runReceivingBatch(
  rows: BatchRow[],
  prev: RowStatusMap,
  submit: (row: BatchRow) => Promise<{ success: boolean; message?: string; outcome?: "FAILED" | "UNKNOWN" }>
): Promise<BatchOutcome> {
  const statuses: RowStatusMap = { ...prev }
  const newlyDone: string[] = []
  let stoppedAt: string | null = null

  for (const row of rows) {
    if (row.receivedInput <= 0) continue
    // 이미 성공한 품목만 건너뛴다. 결과 불명 품목은 같은 requestId 로 다시 보내도 서버가 중복 없이 처리한다.
    if (isRowDone(statuses[row.purchaseOrderItemId])) continue
    try {
      const result = await submit(row)
      if (result.success) {
        statuses[row.purchaseOrderItemId] = { state: "done" }
        newlyDone.push(row.purchaseOrderItemId)
      } else if (result.outcome === "UNKNOWN") {
        // 서버가 "DB 반영 여부를 알 수 없음"으로 응답 — 성공/실패로 단정하지 않는다(같은 요청 ID 로 재전송하면 서버가 판별)
        statuses[row.purchaseOrderItemId] = { state: "unknown", message: result.message ?? RECEIVING_UNKNOWN_MESSAGE }
        stoppedAt = row.purchaseOrderItemId
        break
      } else {
        statuses[row.purchaseOrderItemId] = {
          state: "failed",
          message: result.message ?? "저장 중 오류가 발생했습니다.",
        }
        stoppedAt = row.purchaseOrderItemId
        break
      }
    } catch (error) {
      console.error("입고 처리 응답 오류:", error)
      statuses[row.purchaseOrderItemId] = { state: "unknown", message: UNKNOWN_RECEIPT_MESSAGE }
      stoppedAt = row.purchaseOrderItemId
      break
    }
  }

  const targets = rows.filter((r) => r.receivedInput > 0)
  const allDone = targets.length > 0 && targets.every((r) => statuses[r.purchaseOrderItemId]?.state === "done")
  return { statuses, newlyDone, stoppedAt, allDone }
}

/** 사용자에게 보여줄 실패 안내(품목 라벨 + 안전한 메시지) */
export function describeBatchFailure(label: string, status: RowReceiptStatus | undefined): string {
  if (!status || status.state === "done") return ""
  return `${label}\n${toUserErrorMessage(status.message)}`
}
