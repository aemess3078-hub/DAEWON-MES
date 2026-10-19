/**
 * 입고 수불 거래번호(InventoryTransaction.txNo) 채번 — `RCV-YYYYMMDD-NNNN`
 *
 * 기존 문제
 *  - 트랜잭션 **밖에서** "그날 마지막 번호 + 1" 을 조회해 번호를 미리 만들었다. 같은 테넌트의 동시 입고가 같은 번호를
 *    받아 (tenantId, txNo) unique 위반 → 재시도도 같은 시점에 다시 충돌해 동시 10건 중 5건이 "입고거래번호 생성 중
 *    중복이 반복되었습니다" 로 실패했다(실제 PostgreSQL 검증).
 *
 * 정책
 *  - 형식 유지: `RCV-{KST yyyymmdd}-{4자리 이상 순번}`. 기존 번호는 변경하지 않는다.
 *  - 번호 확보를 **입고 트랜잭션 안**으로 옮기고, (tenant, 날짜) 단위 PostgreSQL transaction advisory lock 으로 직렬화한 뒤
 *    잠금 안에서 최신 번호를 다시 조회한다. 잠금은 커밋/롤백과 함께 자동 해제되므로 롤백된 입고는 번호를 소모하지 않는다.
 *  - 다음 번호 = 같은 날짜 접두어의 **숫자** 최대값 + 1 (문자열 정렬 금지: 9999 다음 10000 도 안전).
 *  - (tenantId, txNo) unique 제약은 그대로 둔다(이중 방어). 호출부의 재시도도 유지한다.
 *  - schema/migration 변경 없음. 반드시 입고(재고·수불 기록)와 같은 트랜잭션에서 호출해야 잠금이 의미를 갖는다.
 */

import { pgAdvisoryXactLock } from "./purchase-order-number.service"

export const RECEIPT_TX_SEQUENCE_DIGITS = 4

export function receiptTxPrefix(yyyymmdd: string): string {
  return `RCV-${yyyymmdd}-`
}

/** "RCV-20261019-0007" → 7. 접두어/형식이 다르면 null (문자열 정렬 금지: 항상 숫자로 변환) */
export function parseReceiptTxSequence(txNo: string, yyyymmdd: string): number | null {
  const prefix = receiptTxPrefix(yyyymmdd)
  if (typeof txNo !== "string" || !txNo.startsWith(prefix)) return null
  const suffix = txNo.slice(prefix.length)
  if (!/^\d+$/.test(suffix)) return null
  const n = Number.parseInt(suffix, 10)
  return Number.isSafeInteger(n) ? n : null
}

export function formatReceiptTxNo(yyyymmdd: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError(`입고거래 순번이 올바르지 않습니다: ${sequence}`)
  return `${receiptTxPrefix(yyyymmdd)}${String(sequence).padStart(RECEIPT_TX_SEQUENCE_DIGITS, "0")}`
}

/** 같은 (tenant, 날짜) 의 번호 발급을 직렬화하는 트랜잭션 범위 잠금 키 */
export function receiptTxLockKey(tenantId: string, yyyymmdd: string): string {
  return `RCV_TX|${tenantId}|${yyyymmdd}`
}

/** 채번에 필요한 최소 트랜잭션 표면(Prisma.TransactionClient 와 테스트 fake 모두 만족) */
export type ReceiptTxNumberTx = {
  inventoryTransaction: { findMany: (args: any) => Promise<Array<{ txNo: string }>> }
}

/**
 * 다음 입고 거래번호 1개를 확보한다. 반드시 입고(InventoryTransaction 생성)와 같은 트랜잭션(tx)에서 호출한다.
 * @param lock 테스트에서는 fake 잠금을 주입한다. 운영 기본값은 pgAdvisoryXactLock.
 */
export async function allocateReceiptTxNo(
  tx: ReceiptTxNumberTx,
  tenantId: string,
  options: { yyyymmdd: string; lock?: (tx: any, key: string) => Promise<void> }
): Promise<string> {
  const lock = options.lock ?? pgAdvisoryXactLock
  await lock(tx, receiptTxLockKey(tenantId, options.yyyymmdd))

  // 잠금 안에서 최신 번호를 다시 읽는다 (다른 트랜잭션이 커밋한 번호까지 보인다)
  const rows = await tx.inventoryTransaction.findMany({
    where: { tenantId, txNo: { startsWith: receiptTxPrefix(options.yyyymmdd) } },
    select: { txNo: true },
  })
  let max = 0
  for (const r of rows) {
    const n = parseReceiptTxSequence(r.txNo, options.yyyymmdd)
    if (n !== null && n > max) max = n
  }
  return formatReceiptTxNo(options.yyyymmdd, max + 1)
}
