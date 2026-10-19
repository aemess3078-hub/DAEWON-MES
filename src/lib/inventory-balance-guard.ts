/**
 * InventoryBalance 유니크 충돌 분류.
 *
 * 비LOT(lotId IS NULL) 재고 행은 partial unique index
 *   InventoryBalance_tenantId_itemId_warehouseId_null_lot_key ON (tenantId, itemId, warehouseId) WHERE lotId IS NULL
 * 로 유일성이 보장된다. 입고는 (tenant, 날짜) advisory lock 으로 이미 직렬화되지만, 이 인덱스가 최후 방어선이므로
 * 어떤 이유로든 "최초 재고 행 생성" 이 겹치면 P2002 가 난다. PostgreSQL 은 오류가 난 트랜잭션을 계속할 수 없으므로
 * 호출부는 전체 트랜잭션을 롤백하고 다시 실행(두 번째에는 기존 행을 update)해야 한다.
 *
 * 재시도는 **정확히 이 충돌로 확인된 경우에만** 허용한다: 다른 모델의 P2002, LOT 재고의 4필드 unique,
 * 대상(target)을 알 수 없는 P2002, 결과 불명(연결 오류) 등은 true 가 아니다.
 *
 * Prisma 5.22 실측(PostgreSQL 18): 비LOT 충돌 meta = { modelName: "InventoryBalance", target: ["tenantId","itemId","warehouseId"] },
 * LOT 충돌 meta.target = ["tenantId","itemId","warehouseId","lotId"].
 */

import { Prisma } from "@prisma/client"

export const NULL_LOT_BALANCE_INDEX_NAME = "InventoryBalance_tenantId_itemId_warehouseId_null_lot_key"
const NULL_LOT_BALANCE_TARGET = ["tenantId", "itemId", "warehouseId"] as const

function isKnownRequestError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "PrismaClientKnownRequestError")
  )
}

export function isNullLotBalanceUniqueError(error: unknown): boolean {
  if (!isKnownRequestError(error) || error.code !== "P2002") return false
  const meta = (error.meta ?? {}) as { modelName?: unknown; target?: unknown }
  const target = meta.target

  // 인덱스 이름으로 보고되는 경우
  if (typeof target === "string") {
    return target === NULL_LOT_BALANCE_INDEX_NAME && (meta.modelName === undefined || meta.modelName === "InventoryBalance")
  }
  // 컬럼 목록으로 보고되는 경우: 모델이 InventoryBalance 이고 정확히 (tenantId, itemId, warehouseId) 일 때만
  if (Array.isArray(target) && meta.modelName === "InventoryBalance") {
    const fields = target.map(String)
    return fields.length === NULL_LOT_BALANCE_TARGET.length && NULL_LOT_BALANCE_TARGET.every((f) => fields.includes(f))
  }
  return false
}

export const NULL_LOT_BALANCE_CONTENTION_MESSAGE = "재고 행 생성이 동시에 겹쳐 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
