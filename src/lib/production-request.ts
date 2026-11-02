/**
 * 수주 생산의뢰 수량 검증과 요청 멱등 키 (N-14)
 *
 *  - 생산의뢰 가능 잔량 = 수주 품목 수량 − (취소되지 않은 생산계획에 연결된 계획 수량 합계). 잔량 안의 부분 의뢰는 허용하고 초과는 거부한다.
 *    취소(CANCELLED)된 계획은 합계에서 빠지므로 재의뢰할 수 있고, 취소된 계획·이력은 그대로 남는다.
 *  - 멱등 키: 요청 ID 와 요청 내용 해시를 생산계획 비고에 `[pr:<id>:<hash>]` 로 남긴다(스키마 변경 없음).
 *    같은 ID·같은 내용의 재전송은 새 계획 없이 처음 결과를 돌려주고, 같은 ID 에 다른 내용이면 거부한다.
 * 서버 전용 순수 모듈(DB·React 의존 없음).
 */
import { createHash } from "node:crypto"
import { formatScaledQuantity, toScaledQuantity } from "./quantity-scale"

export const PRODUCTION_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export const PRODUCTION_REQUEST_ID_INVALID_MESSAGE = "생산의뢰 요청 정보가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요."
export const PRODUCTION_REQUEST_CONFLICT_MESSAGE = "같은 요청 ID 로 이미 다른 내용의 생산의뢰가 처리되었습니다. 생산계획 목록을 확인한 뒤 다시 시도해 주세요."
export const PRODUCTION_REQUEST_TERMINAL_ORDER_MESSAGE = "취소·종결되었거나 출하가 완료된 수주는 생산의뢰할 수 없습니다."

export const isValidProductionRequestId = (v: unknown): v is string => typeof v === "string" && PRODUCTION_REQUEST_ID_PATTERN.test(v)

export type NormalizedRequestLine = { salesOrderItemId: string; itemId: string; qtyScaled: bigint }

export const productionRequestTag = (requestId: string, hash: string) => `[pr:${requestId}:${hash}]`
export const productionRequestTagPrefix = (requestId: string) => `[pr:${requestId}:`

export function hashProductionRequest(salesOrderId: string, lines: NormalizedRequestLine[]): string {
  const canonical = lines.map((l) => [l.salesOrderItemId, l.itemId, l.qtyScaled.toString()].join("|")).sort().join(";")
  return createHash("sha256").update(`${salesOrderId};${canonical}`).digest("hex").slice(0, 32)
}

/** 요청 라인 정규화·검증: 수량은 0 초과·소수 6자리 이하, 같은 수주 품목/품목이 두 줄이면 거부. 오류 문구 또는 정규화된 라인을 돌려준다. */
export function normalizeRequestLines(lines: Array<{ salesOrderItemId: string; itemId: string; qty: number }>): { ok: true; lines: NormalizedRequestLine[] } | { ok: false; error: string } {
  const out: NormalizedRequestLine[] = []
  const seenSoi = new Set<string>(), seenItem = new Set<string>()
  for (const l of lines) {
    if (typeof l?.salesOrderItemId !== "string" || typeof l?.itemId !== "string") return { ok: false, error: "생산의뢰 품목 정보가 올바르지 않습니다." }
    const qtyScaled = toScaledQuantity(l.qty)
    if (qtyScaled === null || qtyScaled <= BigInt(0)) return { ok: false, error: "생산의뢰 수량은 0보다 크고 소수점 6자리 이하여야 합니다." }
    if (seenSoi.has(l.salesOrderItemId)) return { ok: false, error: "같은 수주 품목을 한 번에 두 줄 이상 의뢰할 수 없습니다. 수량을 합쳐서 한 줄로 요청해 주세요." }
    if (seenItem.has(l.itemId)) return { ok: false, error: "같은 품목은 한 생산계획에 한 줄만 등록할 수 있습니다. 수량을 합치거나 나누어 요청해 주세요." }
    seenSoi.add(l.salesOrderItemId); seenItem.add(l.itemId)
    out.push({ salesOrderItemId: l.salesOrderItemId, itemId: l.itemId, qtyScaled })
  }
  return { ok: true, lines: out }
}

export type RequestViolation = { salesOrderItemId: string; orderedScaled: bigint; requestedBeforeScaled: bigint; remainingScaled: bigint; requestScaled: bigint }

/** 요청 수량이 의뢰 가능 잔량을 넘는 첫 수주 품목. 없으면 null. */
export function findProductionRequestViolation(
  lines: NormalizedRequestLine[],
  ordered: Map<string, bigint>,
  alreadyRequested: Map<string, bigint>
): RequestViolation | null {
  for (const l of lines) {
    const orderedScaled = ordered.get(l.salesOrderItemId) ?? BigInt(0)
    const requestedBeforeScaled = alreadyRequested.get(l.salesOrderItemId) ?? BigInt(0)
    const diff = orderedScaled - requestedBeforeScaled
    const remainingScaled = diff > BigInt(0) ? diff : BigInt(0)
    if (l.qtyScaled > remainingScaled) return { salesOrderItemId: l.salesOrderItemId, orderedScaled, requestedBeforeScaled, remainingScaled, requestScaled: l.qtyScaled }
  }
  return null
}

export function productionRequestViolationMessage(itemCode: string, v: RequestViolation): string {
  const f = formatScaledQuantity
  return `생산의뢰 수량 초과: ${itemCode} — 수주 수량 ${f(v.orderedScaled)}, 이미 의뢰 ${f(v.requestedBeforeScaled)}, 가능 잔량 ${f(v.remainingScaled)}, 요청 ${f(v.requestScaled)}. 이미 의뢰한 생산계획을 확인하고, 필요하면 해당 계획을 취소한 뒤 다시 요청해 주세요.`
}
