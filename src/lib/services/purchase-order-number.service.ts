/**
 * 구매발주(PurchaseOrder) 채번 (Phase 5C)
 *
 * 기존 문제
 *  - `PO-YYYY-###`(3자리) + 문자열 desc 정렬: 1,000번째 발주에서 "PO-2026-999" 가 "PO-2026-1000" 보다 크다고 판단되어
 *    같은 번호를 반복 생성 → 연 1,000건째부터 발주 생성 불가.
 *  - MRP 발주는 `PO-MRP-${Date.now()}` 로 순번 체계와 분리.
 *
 * 정책
 *  - 형식: `PO-{YYYY}-{6자리 이상 순번}` 예) PO-2026-000101. 연도는 KST 달력 연도.
 *  - 기존 3/4/6자리 번호와 공존한다(기존 번호는 변경하지 않는다). 다음 번호 = (같은 연도 접두어의 **숫자** 최대값) + 1.
 *    문자열 정렬에 의존하지 않는다(숫자로 파싱). 접두어는 같아도 숫자가 아닌 접미어(예: PO-2026-ABC)는 무시한다.
 *  - 동시성: 같은 (tenant, 연도)의 채번을 PostgreSQL transaction advisory lock 으로 직렬화한 뒤 최대값을 읽는다
 *    (잠금은 트랜잭션 종료 시 자동 해제). 이중 방어로 (tenantId, orderNo) unique 제약이 남아 있고 호출부가 재시도한다.
 *  - 한 트랜잭션에서 N개 번호를 연속 확보한다(count). 번호는 tenant 별로 독립이다(unique 가 tenant 범위).
 *  - schema 추가 없음. 반드시 "번호 확보 + PurchaseOrder 생성"을 같은 트랜잭션에서 수행해야 잠금이 의미를 갖는다.
 */

import { Prisma } from "@prisma/client"

export const PURCHASE_ORDER_SEQUENCE_DIGITS = 6
export const MAX_PURCHASE_ORDER_NUMBERS_PER_CALL = 100

export function purchaseOrderPrefix(year: number): string {
  return `PO-${year}-`
}

/** "PO-2026-000101" → 101, "PO-2026-001" → 1, 접두어/형식이 다르면 null (문자열 정렬 금지: 항상 숫자로 변환) */
export function parsePurchaseOrderSequence(orderNo: string, year: number): number | null {
  const prefix = purchaseOrderPrefix(year)
  if (typeof orderNo !== "string" || !orderNo.startsWith(prefix)) return null
  const suffix = orderNo.slice(prefix.length)
  if (!/^\d+$/.test(suffix)) return null
  const n = Number.parseInt(suffix, 10)
  return Number.isSafeInteger(n) ? n : null
}

export function formatPurchaseOrderNo(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError(`발주 순번이 올바르지 않습니다: ${sequence}`)
  return `${purchaseOrderPrefix(year)}${String(sequence).padStart(PURCHASE_ORDER_SEQUENCE_DIGITS, "0")}`
}

/** 채번에 필요한 최소 트랜잭션 표면(Prisma.TransactionClient 와 테스트 fake 모두 만족) */
export type PurchaseOrderNumberTx = {
  purchaseOrder: { findMany: (args: any) => Promise<Array<{ orderNo: string }>> }
}

/** 같은 (tenant, 연도) 채번을 직렬화하는 트랜잭션 범위 잠금 키 */
export function purchaseOrderNumberLockKey(tenantId: string, year: number): string {
  return `PO_NO|${tenantId}|${year}`
}

/**
 * 운영용 잠금: pg_advisory_xact_lock(hashtext(key)). 트랜잭션이 끝나면 자동 해제된다.
 *
 * pg_advisory_xact_lock 은 반환 타입이 PostgreSQL `void` 이다. `$queryRaw` 로 실행하면 Prisma 가
 * 결과 컬럼(void)을 역직렬화하지 못해 "Failed to deserialize column of type 'void'" 로 실패한다.
 * 결과 행을 읽지 않는 `$executeRaw` 로 실행한다(잠금은 동일하게 획득되고 트랜잭션 종료까지 유지된다).
 */
export async function pgAdvisoryXactLock(tx: any, key: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`)
}

/**
 * 연속된 발주번호 count 개를 확보한다. 반드시 PurchaseOrder 생성과 같은 트랜잭션(tx)에서 호출한다.
 * @param lock 테스트에서는 fake 잠금을 주입한다. 운영 기본값은 pgAdvisoryXactLock.
 */
export async function allocatePurchaseOrderNumbers(
  tx: PurchaseOrderNumberTx,
  tenantId: string,
  count: number,
  options: { year: number; lock?: (tx: any, key: string) => Promise<void> }
): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PURCHASE_ORDER_NUMBERS_PER_CALL) {
    throw new RangeError(`발주번호 채번 개수가 올바르지 않습니다: ${count}`)
  }
  const lock = options.lock ?? pgAdvisoryXactLock
  await lock(tx, purchaseOrderNumberLockKey(tenantId, options.year))

  const rows = await tx.purchaseOrder.findMany({
    where: { tenantId, orderNo: { startsWith: purchaseOrderPrefix(options.year) } },
    select: { orderNo: true },
  })
  let max = 0
  for (const r of rows) {
    const n = parsePurchaseOrderSequence(r.orderNo, options.year)
    if (n !== null && n > max) max = n
  }
  return Array.from({ length: count }, (_, i) => formatPurchaseOrderNo(options.year, max + 1 + i))
}
