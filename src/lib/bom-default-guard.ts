/**
 * 기본(Default) BOM 단일성 보호 (N-03)
 *
 * 정책: 품목당 ACTIVE + isDefault 인 BOM 은 최대 1건. MRP 는 이 조건의 BOM 만 사용하고 2건 이상이면 해당 제품을 계산에서 제외한다.
 *  - 일반 BOM 변경: 새 BOM 을 기본으로 지정하면 같은 품목의 기존 ACTIVE 기본 BOM 은 isDefault 만 해제(상태는 ACTIVE 유지)
 *  - ECN 개정: 기존 기본 BOM 은 INACTIVE + isDefault 해제, 새 버전이 ACTIVE + 기본
 *  - Excel 업로드: 기존 기본 BOM 을 건드리지 않고, 결과가 중복 기본이면 거부
 *
 * DB 에 부분 유니크 인덱스가 없으므로(스키마 변경은 이 범위 밖) 같은 품목의 기본 BOM 변경은
 * Item 행 잠금(FOR NO KEY UPDATE)으로 직렬화한다. 잠금은 트랜잭션이 끝나면 풀린다.
 * FOR NO KEY UPDATE 는 BOM·작업지시 등이 Item 을 FK 로 참조하는 INSERT(FOR KEY SHARE)와 충돌하지 않는다.
 */
import { Prisma } from "@prisma/client"

export const DUPLICATE_DEFAULT_BOM_MESSAGE =
  "한 품목에 활성 기본 BOM 이 둘 이상 지정될 수 없습니다. 이미 기본 BOM 이 중복된 품목은 기존 데이터를 먼저 정리해야 합니다"

/** 같은 품목의 기본 BOM 변경을 직렬화한다. 데드락 방지를 위해 ID 를 정렬해서 잠근다. */
export async function lockItemsForBomDefault(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemIds: Array<string | null | undefined>
): Promise<void> {
  const sorted = Array.from(new Set(itemIds.filter((id): id is string => !!id))).sort()
  if (sorted.length === 0) return
  await tx.$queryRaw`
    SELECT id
    FROM "Item"
    WHERE "tenantId" = ${tenantId}
      AND id IN (${Prisma.join(sorted)})
    ORDER BY id
    FOR NO KEY UPDATE
  `
}

/**
 * 같은 품목의 다른 ACTIVE 기본 BOM 의 기본 지정만 해제한다(상태·구성·참조는 그대로).
 * 해제된 BOM 목록을 돌려준다(감사 로그용).
 */
export async function releaseOtherDefaultBoms(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemId: string,
  exceptBomId?: string
): Promise<Array<{ id: string; version: string }>> {
  const others = await tx.bOM.findMany({
    where: { tenantId, itemId, status: "ACTIVE", isDefault: true, ...(exceptBomId ? { id: { not: exceptBomId } } : {}) },
    select: { id: true, version: true },
  })
  if (others.length > 0) {
    await tx.bOM.updateMany({ where: { id: { in: others.map((b) => b.id) }, tenantId }, data: { isDefault: false } })
  }
  return others
}

/** 쓰기 직후 같은 트랜잭션 안에서 호출: 품목당 ACTIVE 기본 BOM 이 2건 이상이면 예외 → 전체 롤백 */
export async function assertSingleActiveDefaultBom(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemIds: Array<string | null | undefined>
): Promise<void> {
  const ids = Array.from(new Set(itemIds.filter((id): id is string => !!id)))
  if (ids.length === 0) return
  const rows = await tx.bOM.findMany({
    where: { tenantId, status: "ACTIVE", isDefault: true, itemId: { in: ids } },
    select: { itemId: true },
  })
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1)
  const dupIds = Array.from(counts.entries()).filter(([, n]) => n > 1).map(([id]) => id)
  if (dupIds.length === 0) return
  const items = await tx.item.findMany({ where: { tenantId, id: { in: dupIds } }, select: { code: true } })
  throw new Error(`${DUPLICATE_DEFAULT_BOM_MESSAGE}: ${items.map((i) => i.code).join(", ") || dupIds.join(", ")}`)
}
