"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import type { WipUnit } from "@prisma/client"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  lockLotForShare,
  lockWorkOrderForUpdate,
  withQuantityTransactionRetry,
} from "@/lib/quantity-concurrency"
import { requireMaterialIssueReader, resolveLotStockReader } from "@/lib/material-issue/lot-read-access"
import { recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { OUTCOME_UNKNOWN_MESSAGE, isOutcomeUnknownError, toUserErrorMessage } from "@/lib/errors/user-error"
import { safeRevalidate } from "@/lib/revalidate-safe"
import { toScaledQuantity, QUANTITY_SCALE } from "@/lib/quantity-scale"
import { evaluateLotIssueEligibility, lotIssueBlockedMessage } from "@/lib/material-issue/lot-eligibility"

const RESERVATION_MISMATCH_MESSAGE = "자재예약 정보가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요."

// ─── Types ────────────────────────────────────────────────────────────────────

export type MaterialRequirement = {
  itemId: string
  item: { id: string; code: string; name: string; uom: string; spec: string | null; isLotTracked: boolean; itemType: string }
  requiredQty: number
  issuedQty: number
  pendingQty: number
  currentStock: number        // 전체 창고 합산 가용재고
  reservationId: string | null
}

export type LotStockOption = {
  lotId: string
  lotNo: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  qtyAvailable: number
  unit: string
  /** 출고 제한 사유(격리·보류·소진·만료·유효기간 경과). 없으면 출고 가능. 화면은 제한 LOT 를 선택 불가로 표시한다. */
  issueBlockReason?: string | null
  /** 제한 사유의 짧은 표시(예: "격리") */
  issueBlockLabel?: string | null
}

export type WorkOrderForIssue = {
  id: string
  orderNo: string
  status: string
  plannedQty: number
  dueDate: Date | null
  manufacturingNo: string | null
  item: { id: string; code: string; name: string }
  site: { id: string; name: string }
  materials: MaterialRequirement[]
  allIssued: boolean
}

export type WarehouseStockOption = {
  id: string
  code: string
  name: string
  itemStocks: Record<string, number>   // itemId → qtyAvailable
}

function generateMaterialIssueTxNo(index: number): string {
  const now = new Date()
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "")
  const hhmmssSSS = now.toISOString().slice(11, 23).replace(/[:.]/g, "")
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0")
  return `ISS-${yyyymmdd}-${hhmmssSSS}-${String(index + 1).padStart(3, "0")}-${random}`
}

export type IssueMaterialInput = {
  workOrderId: string
  siteId: string
  warehouseId?: string
  items: {
    itemId: string
    warehouseId?: string
    lotId?: string | null      // LOT 관리 품목 단일 LOT (backward compat)
    lots?: { lotId: string; warehouseId: string; quantity: number }[]  // 다중 LOT 분할 출고
    issueQty: number           // lots 사용 시 합계와 일치해야 함
    requiredQty: number
    reservationId: string | null
  }[]
}

// 수량 정밀도(소수점 6자리) 환산은 공통 유틸 @/lib/quantity-scale 사용

// ─── 자재출고 대상 WorkOrder 조회 ─────────────────────────────────────────────

export async function getWorkOrdersForIssue(
  clientTenantId: string
): Promise<WorkOrderForIssue[]> {
  // 로그인 · 자재출고 조회 권한 · tenant 확인. tenant 는 세션 값만 쓰고 클라이언트가 보낸 값은 일치 여부 확인에만 쓴다.
  const { tenantId } = await requireMaterialIssueReader(clientTenantId)
  const workOrders = await prisma.workOrder.findMany({
    where: {
      tenantId,
      status: { in: ["RELEASED", "IN_PROGRESS"] },
    },
    include: {
      item: { select: { id: true, code: true, name: true } },
      site: { select: { id: true, name: true } },
      bom: {
        include: {
          bomItems: {
            include: {
              componentItem: {
                select: { id: true, code: true, name: true, uom: true, spec: true, isLotTracked: true, itemType: true },
              },
            },
            orderBy: { seq: "asc" },
          },
        },
      },
      materialReservations: true,
    },
    orderBy: [{ dueDate: "asc" }, { orderNo: "asc" }],
  })

  // 전체 필요 품목 ID 수집 → 재고 일괄 조회
  const allItemIdSet = new Set(
    workOrders.flatMap((wo) => wo.bom.bomItems.map((bi) => bi.componentItemId))
  )
  const allItemIds = Array.from(allItemIdSet)

  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId, itemId: { in: allItemIds } },
    select: { itemId: true, qtyAvailable: true },
  })

  const stockMap = new Map<string, number>()
  for (const b of balances) {
    stockMap.set(
      b.itemId,
      (stockMap.get(b.itemId) ?? 0) + Number(b.qtyAvailable)
    )
  }

  return workOrders.map((wo) => {
    const plannedQty = Number(wo.plannedQty)

    const materials: MaterialRequirement[] = wo.bom.bomItems.map((bi) => {
      const baseQty = Number(bi.qtyPer) * plannedQty
      const requiredQty = Math.round(baseQty * (1 + Number(bi.scrapRate)) * 1000) / 1000
      const reservation = wo.materialReservations.find(
        (r) => r.itemId === bi.componentItemId
      )
      const issuedQty = reservation ? Number(reservation.issuedQty) : 0

      return {
        itemId: bi.componentItemId,
        item: bi.componentItem,
        requiredQty,
        issuedQty,
        pendingQty: Math.max(0, requiredQty - issuedQty),
        currentStock: stockMap.get(bi.componentItemId) ?? 0,
        reservationId: reservation?.id ?? null,
      }
    })

    return {
      id: wo.id,
      orderNo: wo.orderNo,
      status: wo.status,
      plannedQty,
      dueDate: wo.dueDate,
      manufacturingNo: wo.manufacturingNo,
      item: wo.item,
      site: wo.site,
      materials,
      allIssued: materials.length > 0 && materials.every((m) => m.pendingQty <= 0),
    }
  })
}

// ─── 창고 목록 (재고 포함) ─────────────────────────────────────────────────────

export async function getWarehousesWithStock(
  clientTenantId: string,
  itemIds: string[]
): Promise<WarehouseStockOption[]> {
  // getWorkOrdersForIssue 와 같은 로그인·권한·tenant 확인
  const { tenantId } = await requireMaterialIssueReader(clientTenantId)
  if (!Array.isArray(itemIds)) throw new Error("잘못된 요청입니다.")
  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })

  if (itemIds.length === 0) {
    return warehouses.map((wh) => ({ ...wh, itemStocks: {} }))
  }

  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId, warehouseId: { in: warehouses.map((wh) => wh.id) }, itemId: { in: itemIds } },
    select: { warehouseId: true, itemId: true, qtyAvailable: true },
  })

  return warehouses.map((wh) => {
    const itemStocks: Record<string, number> = {}
    for (const b of balances.filter((b) => b.warehouseId === wh.id)) {
      itemStocks[b.itemId] = (itemStocks[b.itemId] ?? 0) + Number(b.qtyAvailable)
    }
    return { ...wh, itemStocks }
  })
}

// ─── LOT별 재고 조회 (품목 기준, 보관 창고 포함) ───────────────────────────

export async function getLotStockByItems(
  itemIds: string[],
  tenantId: string
): Promise<Record<string, LotStockOption[]>> {
  // 로그인 · LOT 재고 조회 권한 확인. tenant 는 세션 값만 사용하고, 클라이언트가 보낸 tenantId 가 다르면 조회하지 않는다
  // (거부 시 빈 목록 — 화면은 기존처럼 "선택 가능한 LOT 없음"으로 표시하고 어떤 재고 정보도 노출하지 않는다).
  const reader = await resolveLotStockReader()
  if ("code" in reader || reader.tenantId !== tenantId) return {}
  if (!Array.isArray(itemIds)) return {}
  itemIds = itemIds.filter((id): id is string => typeof id === "string")
  if (itemIds.length === 0) return {}

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      tenantId: reader.tenantId,
      itemId: { in: itemIds },
      lotId: { not: null },
      qtyAvailable: { gt: 0 },
    },
    include: {
      lot: { select: { id: true, lotNo: true, status: true, expiryDate: true } },
      item: { select: { uom: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ lot: { lotNo: "asc" } }, { warehouse: { name: "asc" } }],
  })

  const result: Record<string, LotStockOption[]> = {}
  for (const b of balances) {
    if (!b.lot || Number(b.qtyAvailable) <= 0) continue
    if (!result[b.itemId]) result[b.itemId] = []
    // 출고 적격성(LOT 상태·유효기간): 출고 확정 서버 액션·QR 조회와 같은 공통 규칙. 제한 LOT 도 목록에 남기되 사유를 붙여 선택 불가로 표시한다.
    const eligibility = evaluateLotIssueEligibility({ status: b.lot.status, expiryDate: b.lot.expiryDate })
    result[b.itemId].push({
      lotId: b.lot.id,
      lotNo: b.lot.lotNo,
      warehouseId: b.warehouse.id,
      warehouseCode: b.warehouse.code,
      warehouseName: b.warehouse.name,
      qtyAvailable: Number(b.qtyAvailable),
      unit: b.item.uom,
      issueBlockReason: eligibility.eligible ? null : eligibility.message,
      issueBlockLabel: eligibility.eligible ? null : eligibility.label,
    })
  }
  return result
}

// ─── 자재출고 처리 ─────────────────────────────────────────────────────────────

export async function issueMaterialsForWorkOrder(
  data: IssueMaterialInput,
  tenantId: string
): Promise<{ ok: boolean; error?: string }> {
  let actor: Awaited<ReturnType<typeof requireRole>>
  try {
    await requireResourcePermission("PURCHASE_ORDER", "CREATE")
    actor = await requireRole("OPERATOR")
  } catch (e) {
    // 서버 액션이 throw 한 메시지는 프로덕션에서 지워지므로 반환값으로 권한 안내를 전달한다
    return { ok: false, error: toUserErrorMessage(e) }
  }
  if (actor.tenantId !== tenantId) return { ok: false, error: toUserErrorMessage("FORBIDDEN") }
  const activeItems = data.items.filter((i) => i.issueQty > 0)
  if (activeItems.length === 0)
    return { ok: false, error: "출고 수량을 입력하세요." }
  if (activeItems.some((item) => !Number.isFinite(item.issueQty))) {
    return { ok: false, error: "출고 수량이 올바르지 않습니다." }
  }

  // ── 다중 LOT 검증 (트랜잭션 전) ─────────────────────────────────────────────
  for (const item of activeItems) {
    if (!item.lots || item.lots.length === 0) continue
    const lotIds = item.lots.map((l) => l.lotId)
    if (new Set(lotIds).size !== lotIds.length) {
      return { ok: false, error: "동일 LOT가 중복 선택되었습니다." }
    }
    const issueQtyScaled = toScaledQuantity(item.issueQty)
    if (issueQtyScaled === null || issueQtyScaled <= BigInt(0)) {
      return { ok: false, error: "출고 수량이 올바르지 않습니다." }
    }
    let sumQtyScaled = BigInt(0)
    for (const lot of item.lots) {
      if (!lot.warehouseId) {
        return { ok: false, error: "LOT 출고 창고가 누락되었습니다." }
      }
      const lotQtyScaled = toScaledQuantity(lot.quantity)
      if (lotQtyScaled === null || lotQtyScaled <= BigInt(0)) {
        return { ok: false, error: "LOT별 출고 수량은 0보다 커야 합니다." }
      }
      sumQtyScaled += lotQtyScaled
    }
    if (sumQtyScaled !== issueQtyScaled) {
      const sumQty = Number(sumQtyScaled) / QUANTITY_SCALE
      return {
        ok: false,
        error: `LOT 수량 합계(${sumQty})가 출고수량(${item.issueQty})과 일치하지 않습니다.`,
      }
    }
  }

  // ── 다중 LOT 항목을 LOT별 단일 항목으로 전개 ───────────────────────────────
  type ExpandedItem = {
    itemId: string
    warehouseId?: string
    lotId: string | null
    issueQty: number
    requiredQty: number
    reservationId: string | null
  }
  const expandedItems: ExpandedItem[] = activeItems.flatMap((item) => {
    if (item.lots && item.lots.length > 0) {
      return item.lots.map((lot) => ({
        itemId: item.itemId,
        warehouseId: lot.warehouseId,
        lotId: lot.lotId,
        issueQty: lot.quantity,
        requiredQty: item.requiredQty,
        reservationId: item.reservationId,
      }))
    }
    return [{
      itemId: item.itemId,
      warehouseId: item.warehouseId,
      lotId: item.lotId ?? null,
      issueQty: item.issueQty,
      requiredQty: item.requiredQty,
      reservationId: item.reservationId,
    }]
  })

  // LOT 관리 여부 일괄 조회 (트랜잭션 외부 — 읽기 전용)
  const uniqueItemIds = Array.from(new Set(expandedItems.map((i) => i.itemId)))
  const itemRecords = await prisma.item.findMany({
    where: { id: { in: uniqueItemIds } },
    select: { id: true, code: true, uom: true, isLotTracked: true },
  })
  const itemMetaMap = new Map(itemRecords.map((r) => [r.id, r]))

  // 작업지시 정보 조회 (제조번호 + WipUnit 생성용 컨텍스트)
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: data.workOrderId },
    select: {
      id: true,
      tenantId: true,
      siteId: true,
      itemId: true,
      plannedQty: true,
      manufacturingNo: true,
      bom: { select: { bomItems: { select: { componentItemId: true } } } },
      operations: {
        select: {
          id: true,
          seq: true,
          status: true,
          routingOperation: {
            select: { workCenterId: true },
          },
        },
        orderBy: { seq: "asc" },
      },
    },
  })

  if (!workOrder || workOrder.tenantId !== tenantId) {
    return { ok: false, error: "작업지시를 찾을 수 없습니다." }
  }

  // 이 작업지시에 출고할 수 있는 자재(BOM 구성품)인지 서버에서 확인한다. 수동/QR 선택 모두 같은 검증이다.
  // 자재출고 화면과 QR 조회는 처음부터 BOM 구성품만 보여 주므로 정상 업무는 영향이 없다(대체자재 ItemSubstitute 는 출고 로직에서 쓰이지 않는다).
  const bomComponentIds = new Set(workOrder.bom.bomItems.map((b) => b.componentItemId))
  const notInBom = uniqueItemIds.filter((id) => !bomComponentIds.has(id))
  if (notInBom.length > 0) {
    const names = notInBom.map((id) => itemMetaMap.get(id)?.code ?? id).join(", ")
    return { ok: false, error: `출고 불가: ${names} 품목은 이 작업지시의 BOM 구성품이 아닙니다.` }
  }

  // 요청에 포함된 자재예약 ID 가 이 작업지시·해당 품목의 예약인지 확인한다(쓰기 전). 예약 ID 가 없는 요청은 기존대로 처리한다.
  // 예약은 작업지시에 속하고 작업지시는 위에서 tenant 를 확인했으므로, 작업지시가 일치하면 tenant 도 일치한다.
  // 없는 예약 / 다른 작업지시·다른 tenant 의 예약 / 다른 품목의 예약은 같은 오류로 응답한다(다른 데이터의 존재 여부를 드러내지 않음).
  const reservationIds = Array.from(new Set(activeItems.map((i) => i.reservationId).filter((id): id is string => !!id)))
  if (reservationIds.length > 0) {
    const reservations = await prisma.materialReservation.findMany({
      where: { id: { in: reservationIds } },
      select: { id: true, workOrderId: true, itemId: true },
    })
    const reservationMap = new Map(reservations.map((r) => [r.id, r]))
    const invalid = activeItems.some((i) => {
      if (!i.reservationId) return false
      const r = reservationMap.get(i.reservationId)
      return !r || r.workOrderId !== data.workOrderId || r.itemId !== i.itemId
    })
    if (invalid) return { ok: false, error: RESERVATION_MISMATCH_MESSAGE }
  }

  const firstOperation = workOrder?.operations[0] ?? null
  if (workOrder && !firstOperation) {
    console.warn(
      `[material-issue] WorkOrder ${data.workOrderId} has no operations; skipping WipUnit creation.`
    )
  }

  // txNo 사전 생성 (트랜잭션 외부) — count 기반 채번은 동시요청에서 unique 충돌이 쉬워
  // timestamp + random suffix를 사용한다. 업무 정합성은 아래 transaction이 보장한다.
  const txNos = expandedItems.map((_, index) => generateMaterialIssueTxNo(index))

  try {
    await withQuantityTransactionRetry(() => prisma.$transaction(async (tx) => {
      await lockWorkOrderForUpdate(tx, tenantId, data.workOrderId)

      // LOT 행 공유 잠금(FOR SHARE)은 요청 순서와 무관하게 LOT ID 오름차순으로 한 번에 잡는다(항상 같은 순서).
      // 이후 루프의 상태 확인은 이미 잠긴 LOT 를 읽기만 한다. 공유 잠금끼리는 충돌하지 않고, 잠금을 기다리는 쪽(LOT 상태 변경)은
      // 다른 잠금을 쥐지 않는 단일 UPDATE 라 이 순서로 새 교착 경로가 생기지 않는다.
      const lotIdsToLock = Array.from(
        new Set(expandedItems.filter((i) => itemMetaMap.get(i.itemId)?.isLotTracked && i.lotId).map((i) => i.lotId as string))
      ).sort()
      for (const lockLotId of lotIdsToLock) {
        await lockLotForShare(tx, tenantId, lockLotId)
      }

      // ── 0. WipUnit 중복/차단 검증 (자재 루프 진입 전) ─────────────────────
      //  - 같은 작업지시의 원본 WipUnit (parent/sourceProductionResult 없음)
      //    중 비-terminal 상태가 있으면 재사용한다.
      //    재사용 대상: WAITING/IN_PROCESS/ON_HOLD/OUTSOURCED/IN_TRANSIT/RECEIVED/REWORK
      //  - terminal(COMPLETED/SCRAPPED) 원본만 있으면 잘못된 추가출고로
      //    판단하여 즉시 에러 (트랜잭션 전체 롤백)
      //  - 두 조회 모두 비면 신규 생성을 허용한다.
      let wipUnit: WipUnit | null = null
      if (workOrder) {
        wipUnit = await tx.wipUnit.findFirst({
          where: {
            workOrderId: data.workOrderId,
            parentWipUnitId: null,
            sourceProductionResultId: null,
            status: {
              in: [
                "WAITING",
                "IN_PROCESS",
                "ON_HOLD",
                "OUTSOURCED",
                "IN_TRANSIT",
                "RECEIVED",
                "REWORK",
              ],
            },
          },
        })
        if (!wipUnit) {
          const blockedOriginal = await tx.wipUnit.findFirst({
            where: {
              workOrderId: data.workOrderId,
              parentWipUnitId: null,
              sourceProductionResultId: null,
              status: { in: ["COMPLETED", "SCRAPPED"] },
            },
            select: { id: true, status: true },
          })
          if (blockedOriginal) {
            throw new Error(
              "이미 완료 또는 폐기된 작업지시에는 추가 자재출고로 WIP를 생성할 수 없습니다."
            )
          }
        }
      }

      let firstTxId: string | null = null

      for (let i = 0; i < expandedItems.length; i++) {
        const item = expandedItems[i]
        const txNo = txNos[i]
        const meta = itemMetaMap.get(item.itemId)
        let warehouseId = item.warehouseId ?? data.warehouseId
        if (!meta?.isLotTracked && !warehouseId) {
          throw new Error(
            `출고 창고 미선택: ${meta?.code ?? item.itemId} 품목의 출고 창고를 선택하세요.`
          )
        }

        // ── LOT 결정 ──────────────────────────────────────────────────────────
        let lotId: string | null = null
        let balance:
          | Awaited<ReturnType<typeof tx.inventoryBalance.findFirst>>
          | null = null
        if (meta?.isLotTracked) {
          if (!item.lotId) {
            throw new Error(
              `LOT 관리 품목(${meta.code})은 출고 시 LOT를 지정해야 합니다.`
            )
          }
          lotId = item.lotId
          // 출고 적격성(LOT 상태·유효기간) — 수동/QR 선택과 같은 공통 규칙으로, 트랜잭션 안에서 DB 의 최신 값을 다시 확인한다.
          // 이 LOT 는 트랜잭션 시작 시 이미 공유 잠금(FOR SHARE)되어 있어, 이 트랜잭션이 끝날 때까지 LOT 상태 변경(UPDATE)이 끼어들지 못한다
          // (잠금 대기 후에는 최신 커밋 값을 읽는다). 공유 잠금끼리는 충돌하지 않아 동시 출고는 서로 막지 않는다.
          // 거부되면 예외로 트랜잭션 전체가 롤백되어 재고·예약·WIP 변경이 남지 않는다. LOT 행이 없으면 기존처럼 아래 재고 조회에서 "재고 없음" 처리.
          const lotState = await tx.lot.findFirst({ where: { id: lotId, tenantId }, select: { lotNo: true, status: true, expiryDate: true } })
          if (lotState) {
            const eligibility = evaluateLotIssueEligibility(lotState)
            if (!eligibility.eligible) throw new Error(lotIssueBlockedMessage(lotState.lotNo, eligibility))
          }
          if (warehouseId) {
            balance = await tx.inventoryBalance.findFirst({
              where: {
                tenantId,
                itemId: item.itemId,
                lotId,
                warehouseId,
              },
            })
          } else {
            balance = await tx.inventoryBalance.findFirst({
              where: {
                tenantId,
                itemId: item.itemId,
                lotId,
                qtyAvailable: { gte: item.issueQty },
              },
              orderBy: { qtyAvailable: "desc" },
            })
            warehouseId = balance?.warehouseId
          }
        }
        // 비LOT 품목: lotId = null (partial unique index가 단일 row를 보장)

        // ── 1. InventoryBalance 조회 (lotId 포함) ────────────────────────────
        if (!meta?.isLotTracked) {
          balance = await tx.inventoryBalance.findFirst({
            where: {
              tenantId,
              warehouseId,
              itemId: item.itemId,
              lotId: null,
            },
          })
        }

        if (!balance) {
          const lotInfo = lotId ? ` LOT(${item.lotId})` : ""
          throw new Error(
            `재고 없음: 해당 창고에 ${meta?.code ?? item.itemId}${lotInfo} 재고가 없습니다.`
          )
        }

        const resolvedWarehouseId = balance.warehouseId
        const availableQty = Number(balance.qtyAvailable)
        if (availableQty < item.issueQty) {
          const lotInfo = lotId ? ` LOT(${item.lotId})` : ""
          throw new Error(
            `가용재고 부족: ${meta?.code ?? item.itemId}${lotInfo} — 가용재고 ${availableQty}, 출고 요청 ${item.issueQty}`
          )
        }
        const newQty = Number(balance.qtyOnHand) - item.issueQty
        if (newQty < 0) {
          const lotInfo = lotId ? ` LOT(${item.lotId})` : ""
          throw new Error(
            `재고 부족: ${meta?.code ?? item.itemId}${lotInfo} — 현재 재고 ${Number(balance.qtyOnHand)}, 출고 요청 ${item.issueQty}`
          )
        }

        // ── 2. InventoryTransaction 기록 (lotId 포함) ────────────────────────
        const inventoryTx = await tx.inventoryTransaction.create({
          data: {
            tenantId,
            itemId: item.itemId,
            lotId,
            fromLocationId: resolvedWarehouseId,
            txNo,
            txType: "ISSUE",
            qty: item.issueQty,
            refType: "WORK_ORDER",
            refId: data.workOrderId,
            note: "자재출고 처리",
            txAt: new Date(),
          },
        })

        if (!firstTxId) firstTxId = inventoryTx.id

        // ── 2-0. WipUnit 지연 생성 + WipMovement CREATED 1회 기록 ────────────
        //        - active WipUnit이 없고 첫 공정이 존재할 때만 생성
        //        - 첫 InventoryTransaction.id를 sourceId로 사용
        //        - 한 번 생성되면 wipUnit이 채워져 이후 루프에서 재진입하지 않음
        if (!wipUnit && firstOperation && workOrder) {
          wipUnit = await tx.wipUnit.create({
            data: {
              tenantId,
              siteId: workOrder.siteId,
              workOrderId: data.workOrderId,
              workOrderOperationId: firstOperation.id,
              itemId: workOrder.itemId,
              manufacturingNo: workOrder.manufacturingNo,
              currentWorkCenterId: firstOperation.routingOperation.workCenterId,
              qty: workOrder.plannedQty,
              status: "WAITING",
            },
          })
          await tx.wipMovement.create({
            data: {
              tenantId,
              siteId: workOrder.siteId,
              wipUnitId: wipUnit.id,
              movementType: "CREATED",
              toOperationId: firstOperation.id,
              toWorkCenterId: firstOperation.routingOperation.workCenterId,
              qty: workOrder.plannedQty,
              sourceType: "MATERIAL_ISSUE",
              sourceId: firstTxId,
              note: "자재출고로 WIP 생성",
            },
          })
        }

        // ── 2-1. WorkOrderMaterialLot (의료기기 추적성: 제조번호↔원자재 LOT)
        //        LOT 관리 품목 + LOT 지정된 경우에만 기록
        //        WipUnit이 존재하면 같은 트랜잭션에서 WipUnitMaterialLot 연결
        if (lotId) {
          const lotRecord = await tx.lot.findUnique({
            where: { id: lotId },
            select: { lotNo: true },
          })
          if (lotRecord) {
            const createdMaterialLot = await tx.workOrderMaterialLot.create({
              data: {
                tenantId,
                workOrderId: data.workOrderId,
                manufacturingNo: workOrder?.manufacturingNo ?? null,
                materialItemId: item.itemId,
                materialLotNo: lotRecord.lotNo,
                qty: item.issueQty,
                unit: meta?.uom ?? null,
                issuedAt: new Date(),
                inventoryTransactionId: inventoryTx.id,
              },
            })

            if (wipUnit) {
              await tx.wipUnitMaterialLot.create({
                data: {
                  tenantId,
                  wipUnitId: wipUnit.id,
                  workOrderMaterialLotId: createdMaterialLot.id,
                  materialItemId: item.itemId,
                  materialLotId: lotId,
                  materialLotNo: lotRecord.lotNo,
                  qty: item.issueQty,
                  unit: meta?.uom ?? null,
                },
              })
            }
          }
        }

        // ── 3. InventoryBalance 차감 ─────────────────────────────────────────
        const decremented = await tx.inventoryBalance.updateMany({
          where: {
            id: balance.id,
            tenantId,
            qtyOnHand: { gte: item.issueQty },
            qtyAvailable: { gte: item.issueQty },
          },
          data: {
            qtyOnHand: { decrement: item.issueQty },
            qtyAvailable: { decrement: item.issueQty },
          },
        })
        if (decremented.count !== 1) {
          const lotInfo = lotId ? ` LOT(${item.lotId})` : ""
          throw new Error(
            `가용재고 부족: ${meta?.code ?? item.itemId}${lotInfo} — 다른 작업으로 재고가 변경되었습니다. 현재 재고를 확인한 후 다시 시도해주세요.`
          )
        }

        // ── 4. MaterialReservation 갱신 ──────────────────────────────────────
        if (item.reservationId) {
          const res = await tx.materialReservation.findUnique({
            where: { id: item.reservationId },
          })
          // 트랜잭션 안에서도 소속 재확인(사전 확인 이후 예약이 바뀐/삭제된 경우) — 위반 시 예외로 전체 롤백
          if (!res || res.workOrderId !== data.workOrderId || res.itemId !== item.itemId) {
            throw new Error(RESERVATION_MISMATCH_MESSAGE)
          }
          if (res) {
            const newIssuedQty = Number(res.issuedQty) + item.issueQty
            await tx.materialReservation.update({
              where: { id: item.reservationId },
              data: {
                issuedQty: newIssuedQty,
                status:
                  newIssuedQty >= Number(res.requiredQty)
                    ? "FULFILLED"
                    : "PARTIAL",
              },
            })
          }
        } else {
          const existing = await tx.materialReservation.findFirst({
            where: { workOrderId: data.workOrderId, itemId: item.itemId },
          })
          if (existing) {
            const newIssuedQty = Number(existing.issuedQty) + item.issueQty
            await tx.materialReservation.update({
              where: { id: existing.id },
              data: {
                issuedQty: newIssuedQty,
                status:
                  newIssuedQty >= Number(existing.requiredQty)
                    ? "FULFILLED"
                    : "PARTIAL",
              },
            })
          } else {
            await tx.materialReservation.create({
              data: {
                workOrderId: data.workOrderId,
                itemId: item.itemId,
                requiredQty: item.requiredQty,
                reservedQty: 0,
                issuedQty: item.issueQty,
                status:
                  item.issueQty >= item.requiredQty ? "FULFILLED" : "PARTIAL",
              },
            })
          }
        }
      }
      await recordAuditLog(tx, {
        tenantId,
        actor,
        entityType: "MaterialIssue",
        entityId: firstTxId ?? data.workOrderId,
        action: "CREATE",
        afterData: {
          workOrderId: data.workOrderId,
          siteId: data.siteId,
          transactionId: firstTxId,
          itemCount: expandedItems.length,
          items: summarizeAuditItems(expandedItems, ["itemId", "warehouseId", "lotId", "issueQty", "reservationId"]),
        },
        menuName: "자재출고",
      })
    }))

    // 커밋 이후 캐시 재검증 오류가 출고 결과를 실패로 뒤집어 중복 출고를 유발하지 않도록 분리
    safeRevalidate(
      revalidatePath,
      [
        "/app/mes/material-issue",
        "/app/mes/inventory",
        "/app/mes/material/stock",
        "/app/mes/inventory-transactions",
        "/app/mes/manufacturing-traceability",
        "/app/mes/production/wip-inventory",
      ],
      "issueMaterialsForWorkOrder"
    )
    return { ok: true }
  } catch (e) {
    console.error("[issueMaterialsForWorkOrder] error:", e)
    // DB 연결/응답 오류는 커밋 여부를 알 수 없다 — 실패로 단정하지 않고 확인을 요청한다
    if (isOutcomeUnknownError(e)) return { ok: false, error: OUTCOME_UNKNOWN_MESSAGE }
    return {
      ok: false,
      error: toUserErrorMessage(e, { fallback: "자재출고 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }),
    }
  }
}
