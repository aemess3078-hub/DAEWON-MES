/**
 * 자재출고 수량 검증과 요청 멱등 키 (N-17)
 *
 *  - 필요량 = 작업지시 계획수량 × BOM 소요량 × (1 + 손실률). 자재출고 화면이 보여 주는 값(소수 셋째 자리 반올림)과 같은 식이다.
 *    같은 구성품이 BOM 에 여러 줄이면(과거 데이터) 합산한다. 클라이언트가 보낸 requiredQty 는 신뢰하지 않는다.
 *  - 기출고량 = 수불 원장의 같은 작업지시(refType=WORK_ORDER) 품목별 ISSUE − RETURN. POP 생산가능량 계산(bom-material-sufficiency)과 같은 정의다.
 *  - 출고 가능 잔량 = max(0, 필요량 − 기출고량). 요청 합계가 잔량을 넘으면 거부한다.
 *  - 멱등 키: 요청 ID 를 수불 거래번호(InventoryTransaction.txNo, (tenantId, txNo) 고유)에 결정적으로 넣는다.
 *    같은 요청 ID 의 재전송은 DB 고유 제약과 서버의 사전 조회로 새 출고 없이 처음 결과를 돌려준다. 스키마 변경 없음.
 * 서버 전용 순수 모듈(DB·React 의존 없음).
 */
import { createHash } from "node:crypto"
import { formatScaledQuantity, toScaledQuantity } from "../quantity-scale"

export const ISSUE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export const ISSUE_REQUEST_ID_INVALID_MESSAGE = "출고 요청 정보가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요."
export const ISSUE_REQUEST_CONFLICT_MESSAGE = "같은 요청 ID 로 이미 다른 내용의 출고가 처리되었습니다. 화면을 새로고침해 출고 내역을 확인한 뒤 다시 시도해 주세요."
export const ISSUE_REQUEST_TX_NO_CONFLICT_MESSAGE = "같은 출고 요청이 동시에 처리되고 있습니다. 출고 내역을 확인한 뒤 필요한 경우 다시 시도해 주세요."

export const isValidIssueRequestId = (value: unknown): value is string => typeof value === "string" && ISSUE_REQUEST_ID_PATTERN.test(value)

/** 요청 ID 의 수불 거래번호 접두사. '~' 는 요청 ID 문자 집합에 없어 다른 요청 ID 의 접두사와 겹치지 않는다. */
export const issueRequestTxPrefix = (requestId: string) => `ISS-R-${requestId}~`
export const issueRequestTxNo = (requestId: string, index: number) => `${issueRequestTxPrefix(requestId)}${String(index + 1).padStart(3, "0")}`
export const ISSUE_TX_NOTE = "자재출고 처리"
export const issueTxNote = (requestHash: string) => `${ISSUE_TX_NOTE} [rq:${requestHash}]`
export const issueTxNoteHasHash = (note: string | null | undefined, requestHash: string) => (note ?? "").includes(`[rq:${requestHash}]`)

export type NormalizedIssueLine = { itemId: string; warehouseId: string | null; lotId: string | null; qtyScaled: bigint }

/** 요청 내용의 결정적 해시: 작업지시 + (품목, 창고, LOT, 수량) 정렬 목록. 같은 의미의 재전송만 같은 해시가 된다. */
export function hashIssueRequest(workOrderId: string, lines: NormalizedIssueLine[]): string {
  const canonical = lines
    .map((l) => [l.itemId, l.warehouseId ?? "", l.lotId ?? "", l.qtyScaled.toString()].join("|"))
    .sort()
    .join(";")
  return createHash("sha256").update(`${workOrderId};${canonical}`).digest("hex").slice(0, 32)
}

/** 필요량(소수 셋째 자리 반올림 = 화면 표시값). 잘못된 값이면 0. */
export function computeRequiredMaterialQty(qtyPer: unknown, plannedQty: unknown, scrapRate: unknown): number {
  const v = Number(qtyPer) * Number(plannedQty) * (1 + Number(scrapRate))
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : 0
}

export type BomLineForIssue = { componentItemId: string; qtyPer: unknown; scrapRate: unknown }

/** 품목별 필요량(6자리 정수). 같은 구성품 여러 줄은 합산. */
export function requiredScaledByItem(bomItems: BomLineForIssue[], plannedQty: unknown): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const b of bomItems) {
    const req = toScaledQuantity(computeRequiredMaterialQty(b.qtyPer, plannedQty, b.scrapRate)) ?? BigInt(0)
    out.set(b.componentItemId, (out.get(b.componentItemId) ?? BigInt(0)) + req)
  }
  return out
}

/** 원장 행(ISSUE/RETURN)에서 품목별 순출고량(6자리 정수). */
export function netIssuedScaledByItem(txs: Array<{ itemId: string; txType: string; qty: unknown }>): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const t of txs) {
    const dir = t.txType === "ISSUE" ? BigInt(1) : t.txType === "RETURN" ? BigInt(-1) : BigInt(0)
    if (dir === BigInt(0)) continue
    const q = toScaledQuantity(String(t.qty)) ?? BigInt(0)
    out.set(t.itemId, (out.get(t.itemId) ?? BigInt(0)) + dir * q)
  }
  return out
}

export type IssueQuantityViolation = { itemId: string; requiredScaled: bigint; issuedScaled: bigint; remainingScaled: bigint; requestedScaled: bigint }

/** 요청 합계가 출고 가능 잔량을 넘는 첫 품목. 없으면 null. */
export function findIssueQuantityViolation(
  requested: Map<string, bigint>,
  required: Map<string, bigint>,
  issued: Map<string, bigint>
): IssueQuantityViolation | null {
  for (const [itemId, requestedScaled] of Array.from(requested.entries())) {
    const requiredScaled = required.get(itemId) ?? BigInt(0)
    const issuedScaled = issued.get(itemId) ?? BigInt(0)
    const diff = requiredScaled - issuedScaled
    const remainingScaled = diff > BigInt(0) ? diff : BigInt(0)
    if (requestedScaled > remainingScaled) return { itemId, requiredScaled, issuedScaled, remainingScaled, requestedScaled }
  }
  return null
}

export function issueQuantityViolationMessage(code: string, v: IssueQuantityViolation): string {
  const f = formatScaledQuantity
  return `출고 수량 초과: ${code} — BOM 필요량 ${f(v.requiredScaled)}, 이미 출고 ${f(v.issuedScaled)}, 출고 가능 잔량 ${f(v.remainingScaled)}, 이번 요청 ${f(v.requestedScaled)}. 필요량을 넘는 추가 투입은 작업지시 수량 또는 BOM 을 조정한 뒤 출고해 주세요.`
}
