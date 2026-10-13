/**
 * BOM Excel Import 코어 (DB 클라이언트 주입형)
 *
 * 입력 groups 는 클라이언트(브라우저)가 보낸 값이므로 신뢰하지 않는다.
 *  1) parentItemId / componentItemId 전체를 현재 tenant 의 Item 으로 배치 1회 검증한다.
 *     요청 ID 수 ≠ tenant 소유 ID 수 이면 전체를 중단한다(부분 Import 없음, DB 쓰기 0건).
 *  2) 기존 BOM 충돌 키는 클라이언트의 key 가 아니라 서버가 조회한 Item.code 로 다시 만든다.
 *  3) 검증은 transaction 전에 수행한다. Item.tenantId 는 변경되지 않으므로(불변) 검증 후 transaction
 *     사이에 소유가 바뀌지 않고, 삭제되면 FK 오류로 transaction 전체가 롤백된다.
 *  4) M4 Default BOM 정책(decideImportDefaultFlags)은 transaction 안에서 그대로 적용한다.
 */

import type { PrismaClient } from "@prisma/client"
import { decideImportDefaultFlags } from "../bom-default-policy"

export type BomImportDb = Pick<PrismaClient, "item" | "bOM" | "auditLog" | "$transaction">

export type BomImportGroup = {
  key: string
  parentCode: string
  parentItemId: string
  version: string
  status: string
  items: Array<{ componentItemId: string; seq: number; qtyPer: number; scrapRate: number }>
}

export type BomImportResult =
  | { success: true; importedBomCount: number; importedItemCount: number; defaultAssignedCount: number }
  | { success: false; error: string }

export const IMPORT_TENANT_MISMATCH_MESSAGE =
  "유효하지 않은 참조가 포함되어 있어 가져올 수 없습니다. 업로드 파일을 다시 검증해 주세요. (IMPORT_TENANT_MISMATCH)"

export async function importBomGroups(
  deps: {
    authorize: () => Promise<{ id: string; name: string; tenantId: string }>
    db: BomImportDb
  },
  groups: readonly BomImportGroup[]
): Promise<BomImportResult> {
  const actor = await deps.authorize()
  const tenantId = actor.tenantId
  const { db } = deps

  if (!Array.isArray(groups) || groups.length === 0) return { success: false, error: "가져올 BOM이 없습니다." }

  // 1) tenant 소유 검증 (배치 1회, N+1 없음)
  const parentItemIds = groups.map((g) => g.parentItemId)
  const requestedIds = new Set<string>(parentItemIds)
  for (const g of groups) {
    if (!Array.isArray(g.items) || g.items.length === 0) {
      return { success: false, error: IMPORT_TENANT_MISMATCH_MESSAGE }
    }
    for (const it of g.items) requestedIds.add(it.componentItemId)
  }
  if (Array.from(requestedIds).some((id) => typeof id !== "string" || id.length === 0)) {
    return { success: false, error: IMPORT_TENANT_MISMATCH_MESSAGE }
  }
  const ownedItems = await db.item.findMany({
    where: { tenantId, id: { in: Array.from(requestedIds) } },
    select: { id: true, code: true },
  })
  if (ownedItems.length !== requestedIds.size) {
    return { success: false, error: IMPORT_TENANT_MISMATCH_MESSAGE }
  }
  const codeById = new Map(ownedItems.map((i) => [i.id, i.code]))

  // 2) 기존 BOM 충돌 재검증 — 키는 서버 기준(Item.code@version)
  const serverKey = (g: BomImportGroup) => `${(codeById.get(g.parentItemId) as string).toUpperCase()}@${g.version}`
  const existingBoms = await db.bOM.findMany({
    where: { tenantId, itemId: { in: parentItemIds } },
    select: { itemId: true, version: true },
  })
  const existingKeys = new Set(
    existingBoms.map((b) => `${(codeById.get(b.itemId) ?? "").toUpperCase()}@${b.version}`)
  )
  const conflicts = groups.filter((g) => existingKeys.has(serverKey(g)))
  if (conflicts.length > 0) {
    return {
      success: false,
      error: `이미 등록된 BOM이 있습니다: ${conflicts
        .map((g) => `${codeById.get(g.parentItemId)} v${g.version}`)
        .join(", ")}`,
    }
  }

  let importedItemCount = 0
  let defaultAssignedCount = 0
  const bomKeys: string[] = []

  try {
    await db.$transaction(async (tx) => {
      // MRP 는 tenant 일치 + ACTIVE + isDefault 인 BOM 만 사용한다.
      // 이미 ACTIVE Default 가 있는 품목에는 Default 를 추가로 만들지 않는다(중복 Default 방지).
      const existingDefaults = await tx.bOM.findMany({
        where: { tenantId, status: "ACTIVE", isDefault: true, itemId: { in: parentItemIds } },
        select: { itemId: true },
      })
      const defaultFlags = decideImportDefaultFlags(
        groups.map((g) => ({ key: g.key, parentItemId: g.parentItemId, status: g.status })),
        new Set(existingDefaults.map((b) => b.itemId))
      )
      for (const group of groups) {
        const isDefault = defaultFlags.get(group.key) === true
        if (isDefault) defaultAssignedCount += 1
        await tx.bOM.create({
          data: {
            tenantId,
            itemId: group.parentItemId,
            version: group.version,
            isDefault,
            status: group.status as "ACTIVE" | "INACTIVE" | "DRAFT",
            bomItems: {
              create: group.items.map((item: BomImportGroup["items"][number]) => ({
                componentItemId: item.componentItemId,
                seq: item.seq,
                qtyPer: item.qtyPer,
                scrapRate: item.scrapRate,
              })),
            },
          },
        })
        importedItemCount += group.items.length
        bomKeys.push(group.key)
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "BOM",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "EXCEL_UPLOAD",
            importedBomCount: groups.length,
            importedItemCount,
            defaultAssignedCount,
            bomKeys: bomKeys.slice(0, 20),
          },
          menuName: "BOM",
        },
      })
    })

    return { success: true, importedBomCount: groups.length, importedItemCount, defaultAssignedCount }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "BOM 등록 중 오류가 발생했습니다." }
  }
}
