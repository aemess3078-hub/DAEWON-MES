/**
 * POP 작업대기 화면의 "WIP QR 로 작업지시 찾기" 판정 (순수 함수, 서버/DOM 비의존).
 *
 * POP 은 작업지시(공정) 단위로 동작한다 — 작업 시작·실적 등록 때 WIP 이동은 작업지시의 "원본(루트) WIP" 에 자동 반영되고,
 * 작업자가 WIP 를 고르지 않는다. 그래서 WIP QR 은 "그 WIP 가 속한 작업지시를 찾아 목록에 표시"하는 용도로만 쓴다.
 * 스캔은 작업을 시작하거나 공정을 이동하지 않는다.
 *
 * 주의: WIP 라벨 발행 조건(자재출고 완료 등, wip-label-eligibility.ts)을 여기서 재사용하지 않는다.
 * 라벨이 이미 붙은 WIP 는 후속 공정에서도 같은 QR 로 찾을 수 있어야 하며, 실제 작업 가능 여부는 기존 POP 의 검증이 정한다.
 */

export type PopWipLookupFailCode =
  | "UNAUTHORIZED"
  | "DENIED"
  | "INVALID"
  | "WIP_NOT_FOUND"
  | "WIP_SCRAPPED"
  | "WIP_COMPLETED"
  | "NO_WORK_ORDER"
  | "SITE_MISMATCH"
  | "CHILD_WIP"
  | "AMBIGUOUS_ROOT"
  | "WORK_ORDER_CLOSED"
  | "NOT_IN_QUEUE"

export const POP_WIP_LOOKUP_MESSAGES: Record<PopWipLookupFailCode, string> = {
  UNAUTHORIZED: "로그인이 필요합니다.",
  DENIED: "작업지시를 조회할 권한이 없습니다.",
  INVALID: "QR 의 WIP 식별값이 올바르지 않습니다. 라벨을 확인하거나 목록에서 직접 선택해 주세요.",
  WIP_NOT_FOUND: "등록되지 않은 WIP 이거나 이 화면에서 조회할 수 없는 WIP 입니다. 라벨을 확인하거나 목록에서 직접 선택해 주세요.",
  WIP_SCRAPPED: "폐기된 WIP 입니다. 이 라벨로는 작업지시를 선택할 수 없습니다.",
  WIP_COMPLETED: "모든 공정이 종결된 WIP 입니다. 진행할 작업이 없어 작업지시를 선택할 수 없습니다.",
  NO_WORK_ORDER: "작업지시와 연결되지 않은 WIP 입니다. 목록에서 직접 선택해 주세요.",
  SITE_MISMATCH: "해당 작업장의 작업만 처리할 수 있습니다. 다른 작업장의 WIP 입니다.",
  CHILD_WIP:
    "분할·불량·재작업으로 생긴 하위 WIP 의 QR 입니다. POP 작업은 작업지시의 원본 WIP 기준으로 처리되어 이 WIP 를 직접 특정할 수 없습니다. 작업지시 목록에서 직접 선택해 주세요.",
  AMBIGUOUS_ROOT:
    "이 작업지시에 원본 WIP 이 여러 건 있어 작업 대상을 하나로 특정할 수 없습니다. 임의로 선택하지 않습니다. 목록에서 직접 선택하고 관리자에게 문의해 주세요.",
  WORK_ORDER_CLOSED: "종료되었거나 취소된 작업지시의 WIP 입니다. 작업대기 목록에 표시할 수 없습니다.",
  NOT_IN_QUEUE: "이 작업지시에는 현재 작업대기 목록에 표시할 공정(대기·진행중)이 없습니다.",
}

const WIP_STATUS_LABELS: Record<string, string> = {
  WAITING: "대기",
  IN_PROCESS: "공정 진행중",
  ON_HOLD: "보류",
  OUTSOURCED: "외주 진행중",
  IN_TRANSIT: "이동중",
  RECEIVED: "입고(검사 대기)",
  COMPLETED: "종결",
  SCRAPPED: "폐기",
  REWORK: "재작업",
}

export function popWipStatusLabel(status: string): string {
  return WIP_STATUS_LABELS[status] ?? status
}

/** 목록 표시는 허용하지만 작업자가 알아야 하는 상태 안내(작업 가능 여부는 기존 POP 검증이 결정한다). */
function statusNotice(status: string): string | null {
  switch (status) {
    case "ON_HOLD":
      return "이 WIP 는 보류 중입니다. 보류를 해제하기 전에는 작업을 시작할 수 없습니다."
    case "OUTSOURCED":
    case "IN_TRANSIT":
    case "RECEIVED":
      return `이 WIP 는 현재 '${popWipStatusLabel(status)}' 상태입니다. 작업 가능 여부는 기존 POP 의 검증에 따릅니다.`
    case "REWORK":
      return "이 WIP 는 재작업 상태입니다. 작업 가능 여부는 기존 POP 의 검증에 따릅니다."
    default:
      return null
  }
}

export type PopWipFacts = {
  status: string
  parentWipUnitId: string | null
  sourceProductionResultId: string | null
  workOrder: { status: string; siteId: string | null } | null
}

export type PopWipJudgement = { ok: true; notice: string | null } | { ok: false; code: PopWipLookupFailCode }

/** 작업지시가 POP 작업대기 목록에서 빠지는 상태(getPopWorkQueueRows 의 notIn 조건과 같다). */
export const POP_QUEUE_EXCLUDED_WORK_ORDER_STATUSES: readonly string[] = ["COMPLETED", "CANCELLED"]

/**
 * 조회한 WIP 로 작업지시를 목록에 표시해도 되는지 판정한다.
 * @param rootCount 이 작업지시의 원본(루트) WIP 개수
 * @param openOperationCount 이 작업지시의 대기·진행중 공정 개수(작업대기 목록에 나오는 공정)
 * @param workerSiteId POP 작업자 세션의 사업장(관리자 세션이면 null)
 */
export function judgePopWipScan(input: { wip: PopWipFacts; rootCount: number; openOperationCount: number; workerSiteId: string | null }): PopWipJudgement {
  const { wip } = input
  if (wip.status === "SCRAPPED") return { ok: false, code: "WIP_SCRAPPED" }
  // 하위 WIP(분할·불량·재작업)는 POP 이 처리하는 대상(원본 WIP)이 아니다 — 다른 WIP 를 대신 고르지 않고 안내한다.
  if (wip.parentWipUnitId !== null || wip.sourceProductionResultId !== null) return { ok: false, code: "CHILD_WIP" }
  if (!wip.workOrder) return { ok: false, code: "NO_WORK_ORDER" }
  if (wip.status === "COMPLETED") return { ok: false, code: "WIP_COMPLETED" }
  // 기존 POP 의 작업장 검증(assertPopSessionSiteMatch)과 같은 기준
  if (input.workerSiteId != null && wip.workOrder.siteId != null && input.workerSiteId !== wip.workOrder.siteId) {
    return { ok: false, code: "SITE_MISMATCH" }
  }
  if (POP_QUEUE_EXCLUDED_WORK_ORDER_STATUSES.includes(wip.workOrder.status)) return { ok: false, code: "WORK_ORDER_CLOSED" }
  if (input.rootCount > 1) return { ok: false, code: "AMBIGUOUS_ROOT" }
  if (input.openOperationCount <= 0) return { ok: false, code: "NOT_IN_QUEUE" }
  return { ok: true, notice: statusNotice(wip.status) }
}
