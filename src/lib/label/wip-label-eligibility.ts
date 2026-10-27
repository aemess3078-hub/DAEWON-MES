/**
 * WIP 라벨 발행 가능 조건 중 "자재출고 완료" 판정 (순수 함수, 서버 전용 사용).
 *
 * 기존 자재출고 목록(`getWorkOrdersForIssue` in material-issue.actions.ts)의 `allIssued` 와 **같은 규칙**이다:
 *   - 목록에 나오는 작업지시: status ∈ {RELEASED, IN_PROGRESS}
 *   - 자재별 필요수량 = round(BOM qtyPer × 계획수량 × (1 + scrapRate), 소수 3자리)
 *   - 자재별 기출고수량 = 해당 품목의 첫 번째 MaterialReservation.issuedQty (없으면 0)
 *   - 대기수량 = max(0, 필요 − 기출고) / allIssued = 자재가 1개 이상이고 모든 대기수량 ≤ 0
 * 화면(출고완료 행에만 [WIP 라벨] 표시)과 서버(getWipLabelTarget / checkWipLabelPrintable / recordWipLabelPrint)가
 * 같은 결과를 내야 한다 — 두 규칙이 어긋나지 않도록 테스트(scripts/test-label-types.tsx)가 실제
 * getWorkOrdersForIssue 결과와 이 함수를 같은 입력으로 비교한다. getWorkOrdersForIssue 의 목록·필요수량·allIssued 계산은
 * 이 모듈과 같은 규칙으로 유지한다(그 함수에는 이후 로그인·권한·tenant 확인만 추가되었고 계산 로직은 바뀌지 않았다).
 */

/** 자재출고 목록에 나오는 작업지시 상태(getWorkOrdersForIssue 의 where 와 동일). */
export const ISSUE_LISTED_STATUSES: readonly string[] = ["RELEASED", "IN_PROGRESS"]

export type IssueProgressInput = {
  status: string
  plannedQty: unknown
  bomItems: Array<{ componentItemId: string; qtyPer: unknown; scrapRate: unknown }>
  reservations: Array<{ itemId: string; issuedQty: unknown }>
}

export type IssueState =
  /** 모든 자재 출고 완료 (allIssued = true) */
  | "COMPLETE"
  /** 일부 자재만(또는 일부 수량만) 출고됨 */
  | "PARTIAL"
  /** 출고된 자재가 없음 */
  | "NONE"
  /** BOM 자재가 없어 출고 완료를 판정할 수 없음(allIssued = false) */
  | "NO_MATERIALS"

export type IssueProgress = {
  /** 자재출고 목록에 나오는 상태(RELEASED/IN_PROGRESS)인가 */
  listed: boolean
  materialCount: number
  issuedMaterialCount: number
  state: IssueState
}

export function computeIssueProgress(input: IssueProgressInput): IssueProgress {
  const plannedQty = Number(input.plannedQty)
  const materials = input.bomItems.map((bi) => {
    const baseQty = Number(bi.qtyPer) * plannedQty
    const requiredQty = Math.round(baseQty * (1 + Number(bi.scrapRate)) * 1000) / 1000
    const reservation = input.reservations.find((r) => r.itemId === bi.componentItemId)
    const issuedQty = reservation ? Number(reservation.issuedQty) : 0
    return { requiredQty, issuedQty, pendingQty: Math.max(0, requiredQty - issuedQty) }
  })
  const issuedMaterialCount = materials.filter((m) => m.issuedQty > 0).length
  const allIssued = materials.length > 0 && materials.every((m) => m.pendingQty <= 0)
  const state: IssueState =
    materials.length === 0 ? "NO_MATERIALS" : allIssued ? "COMPLETE" : issuedMaterialCount > 0 ? "PARTIAL" : "NONE"
  return { listed: ISSUE_LISTED_STATUSES.includes(input.status), materialCount: materials.length, issuedMaterialCount, state }
}

/** 상태별 사용자 안내(발행 차단 사유). COMPLETE 이면 null. */
export function issueStateBlockMessage(state: IssueState): string | null {
  switch (state) {
    case "COMPLETE":
      return null
    case "PARTIAL":
      return "자재출고가 일부만 완료되었습니다. 모든 자재의 출고가 완료된 후 WIP 라벨을 인쇄할 수 있습니다."
    case "NONE":
      return "자재출고가 완료되지 않았습니다. 모든 자재의 출고가 완료된 후 WIP 라벨을 인쇄할 수 있습니다."
    case "NO_MATERIALS":
      return "출고 대상 자재(BOM)가 없어 자재출고 완료를 판정할 수 없습니다. WIP 라벨을 인쇄할 수 없습니다."
  }
}
