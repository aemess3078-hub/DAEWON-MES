/** 자재 출고이력 공용 상수·순수 함수(Server Action 파일은 async 함수만 내보낼 수 있어 분리). */

export const ISSUE_HISTORY_PAGE_SIZE = 20

export type MaterialIssueHistoryKind = "ISSUE" | "RETURN"
/** 출고 행의 반납 상태. 반납 행은 항상 "RETURN_ROW". */
export type MaterialIssueHistoryState = "NORMAL" | "PARTIAL_RETURNED" | "FULL_RETURNED" | "RETURN_ROW"

export const ISSUE_HISTORY_STATE_LABEL: Record<MaterialIssueHistoryState, string> = {
  NORMAL: "정상 출고",
  PARTIAL_RETURNED: "일부 반납",
  FULL_RETURNED: "전량 반납",
  RETURN_ROW: "반납",
}

export function resolveReturnState(kind: MaterialIssueHistoryKind, qty: number, returnedQty: number): MaterialIssueHistoryState {
  if (kind === "RETURN") return "RETURN_ROW"
  if (returnedQty <= 0) return "NORMAL"
  return returnedQty >= qty ? "FULL_RETURNED" : "PARTIAL_RETURNED"
}
