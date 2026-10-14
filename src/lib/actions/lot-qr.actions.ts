"use server"

/**
 * LOT QR 조회 · 라벨 출력 감사 (Phase 11 / DG-004 · DG-005 · DG-026).
 *
 * 원칙
 *  - QR 스캔 결과는 untrusted input. 로그인/tenant/권한/상태를 서버가 다시 검증한다.
 *  - 이 액션은 "식별(조회)"만 한다. 재고 차감/출하 등 업무 mutation 은 기존 Server Action(DG-014 검증 포함)이 수행한다.
 *  - 다른 tenant LOT / 존재하지 않는 LOT 는 구분 없이 동일한 일반 메시지로 응답한다(tenant 존재 노출 금지).
 *  - 라벨 출력/재출력은 기존 AuditLog 로 기록한다(새 테이블 없음). AuditAction enum 에 PRINT 가 없으므로
 *    entityType="LotLabel", action="CREATE", afterData.event = "LABEL_PRINT" | "LABEL_REPRINT" 로 표현한다.
 */

import { prisma } from "@/lib/db/prisma"
import { requireReadActor } from "@/lib/auth/action-guards"
import { getPopWorkerSession } from "@/lib/auth/pop-worker-session"
import { recordAuditLog } from "@/lib/audit-log"
import { classifyScanInput, encodeLotQr, lotNoFromScan } from "@/lib/qr/lot-qr"

const GENERIC_NOT_FOUND = "LOT을 찾을 수 없거나 접근할 수 없습니다."
const SCAN_READ_RESOURCES = ["LOT", "INVENTORY", "WORK_ORDER", "WORK_RESULT", "SHIPMENT", "PURCHASE_ORDER"] as const

export type LotScanPurpose = "TRACE" | "LABEL" | "MATERIAL_ISSUE" | "SHIPMENT" | "FINISHED_RECEIPT" | "POP"

export type LotScanContext = {
  purpose?: LotScanPurpose
  /** MATERIAL_ISSUE / POP: 이 작업지시의 BOM 구성품(+대체품)인지 확인한다. */
  workOrderId?: string
  /** SHIPMENT / FINISHED_RECEIPT: 기대 품목(수주 품목 등). */
  expectedItemId?: string
}

export type LotBlockCode =
  | "STATUS_QUARANTINE"
  | "STATUS_ON_HOLD"
  | "STATUS_CONSUMED"
  | "STATUS_EXPIRED"
  | "NO_STOCK"
  | "WRONG_ITEM"
  | "NOT_BOM_COMPONENT"
  | "WORK_ORDER_NOT_FOUND"

export type LotScanOk = {
  ok: true
  lot: {
    id: string
    lotNo: string
    status: string
    manufactureDate: string | null
    expiryDate: string | null
    item: { id: string; code: string; name: string; itemType: string; uom: string; isLotTracked: boolean }
    qtyOnHand: number
    qtyAvailable: number
    balances: Array<{
      warehouseId: string
      warehouseCode: string | null
      warehouseName: string | null
      qtyOnHand: number
      qtyAvailable: number
    }>
  }
  /** 현재 purpose 기준 사용 가능 여부(최종 판단은 업무 액션이 다시 한다). */
  usable: boolean
  blockCode: LotBlockCode | null
  blockReason: string | null
}

export type LotScanFail = {
  ok: false
  code: "INVALID_QR" | "LEGACY_LABEL" | "NOT_FOUND" | "UNAUTHORIZED" | "DENIED"
  message: string
}

export type LotScanResult = LotScanOk | LotScanFail

const STATUS_BLOCK: Record<string, { code: LotBlockCode; reason: string }> = {
  QUARANTINE: { code: "STATUS_QUARANTINE", reason: "격리(QUARANTINE) 상태 LOT 입니다. 사용할 수 없습니다." },
  ON_HOLD: { code: "STATUS_ON_HOLD", reason: "보류(ON_HOLD) 상태 LOT 입니다. 사용할 수 없습니다." },
  CONSUMED: { code: "STATUS_CONSUMED", reason: "이미 소진된 LOT 입니다." },
  EXPIRED: { code: "STATUS_EXPIRED", reason: "유효기간이 만료된 LOT 입니다." },
}

function authFailure(error: unknown): LotScanFail {
  const message = error instanceof Error ? error.message : ""
  if (message === "UNAUTHORIZED") return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
  return { ok: false, code: "DENIED", message: "조회 권한이 없습니다." }
}

/**
 * QR/수동 입력으로 LOT 를 식별한다(읽기 전용).
 * 업무 규칙(상태·BOM 구성품·품목 일치)은 purpose 에 따라 "사용 가능 여부"로만 알려주며, 실제 차단은 업무 액션이 한다.
 */
export async function lookupLotByQr(raw: string, context: LotScanContext = {}): Promise<LotScanResult> {
  let actor
  try {
    actor = await requireReadActor(SCAN_READ_RESOURCES)
  } catch (error) {
    return authFailure(error)
  }
  return resolveLotScan(actor.tenantId, raw, context)
}

/**
 * POP(태블릿) 전용 진입점: POP 작업자 세션(PIN) 또는 OPERATOR 이상 사용자 세션으로 호출한다.
 * 현재 작업(공정)의 작업지시와 스캔한 LOT 의 적합성(BOM 구성품/상태/재고)만 알려준다 — 투입(mutation)은 하지 않는다.
 * 기존 업무 흐름(자재출고는 자재출고 화면에서만)을 변경하지 않는다.
 */
export async function lookupLotForPop(raw: string, workOrderOperationId: string): Promise<LotScanResult> {
  let tenantId: string
  let siteId: string | null = null
  try {
    const popSession = await getPopWorkerSession()
    if (popSession) {
      tenantId = popSession.tenantId
      siteId = popSession.siteId ?? null
    } else {
      const actor = await requireReadActor(SCAN_READ_RESOURCES)
      tenantId = actor.tenantId
    }
  } catch (error) {
    return authFailure(error)
  }

  const operation = await prisma.workOrderOperation.findFirst({
    where: { id: String(workOrderOperationId ?? "") },
    select: { id: true, workOrderId: true },
  })
  const workOrder = operation
    ? await prisma.workOrder.findFirst({
        where: { id: operation.workOrderId, tenantId },
        select: { id: true, siteId: true },
      })
    : null
  // 타 tenant/타 사업장 작업은 존재 여부를 노출하지 않는다.
  if (!workOrder || (siteId != null && workOrder.siteId != null && siteId !== workOrder.siteId)) {
    return { ok: false, code: "NOT_FOUND", message: GENERIC_NOT_FOUND }
  }
  return resolveLotScan(tenantId, raw, { purpose: "POP", workOrderId: workOrder.id })
}

async function resolveLotScan(tenantId: string, raw: string, context: LotScanContext): Promise<LotScanResult> {
  const scan = classifyScanInput(raw)
  if (scan.kind === "INVALID") return { ok: false, code: "INVALID_QR", message: scan.message }
  if (scan.kind === "LEGACY_ITEM_LOT") {
    return { ok: false, code: "LEGACY_LABEL", message: "구형 바코드 라벨입니다. LOT QR 라벨을 다시 출력해 주세요." }
  }
  const lotNo = lotNoFromScan(scan)
  if (!lotNo) return { ok: false, code: "INVALID_QR", message: "인식할 수 없는 입력입니다." }

  const lot = await prisma.lot.findFirst({ where: { tenantId, lotNo } })
  if (!lot) return { ok: false, code: "NOT_FOUND", message: GENERIC_NOT_FOUND }

  const [item, balances] = await Promise.all([
    prisma.item.findFirst({ where: { id: lot.itemId, tenantId } }),
    prisma.inventoryBalance.findMany({ where: { tenantId, lotId: lot.id } }),
  ])
  if (!item) return { ok: false, code: "NOT_FOUND", message: GENERIC_NOT_FOUND }

  const warehouseIds = Array.from(new Set(balances.map((b) => b.warehouseId)))
  const warehouses = warehouseIds.length
    ? await prisma.warehouse.findMany({ where: { tenantId, id: { in: warehouseIds } } })
    : []
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]))

  const balanceDtos = balances.map((b) => ({
    warehouseId: b.warehouseId,
    warehouseCode: warehouseById.get(b.warehouseId)?.code ?? null,
    warehouseName: warehouseById.get(b.warehouseId)?.name ?? null,
    qtyOnHand: Number(b.qtyOnHand),
    qtyAvailable: Number(b.qtyAvailable),
  }))
  const qtyOnHand = balanceDtos.reduce((s, b) => s + b.qtyOnHand, 0)
  const qtyAvailable = balanceDtos.reduce((s, b) => s + b.qtyAvailable, 0)

  // ── purpose 별 사용 가능 여부(정보 제공용) ────────────────────────────────
  let blockCode: LotBlockCode | null = null
  let blockReason: string | null = null
  const purpose = context.purpose ?? "TRACE"
  const consuming = purpose === "MATERIAL_ISSUE" || purpose === "SHIPMENT" || purpose === "POP"

  if (consuming) {
    const statusBlock = STATUS_BLOCK[String(lot.status)]
    if (statusBlock) {
      blockCode = statusBlock.code
      blockReason = statusBlock.reason
    } else if (qtyAvailable <= 0 && purpose !== "POP") {
      blockCode = "NO_STOCK"
      blockReason = "가용재고가 없는 LOT 입니다."
    }
  }

  if (!blockCode && context.expectedItemId && lot.itemId !== context.expectedItemId) {
    blockCode = "WRONG_ITEM"
    blockReason = "이 작업의 품목과 다른 LOT 입니다."
  }

  if (!blockCode && (purpose === "MATERIAL_ISSUE" || purpose === "POP") && context.workOrderId) {
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: context.workOrderId, tenantId },
      select: { id: true, bomId: true },
    })
    if (!workOrder) {
      blockCode = "WORK_ORDER_NOT_FOUND"
      blockReason = "작업지시를 찾을 수 없습니다."
    } else {
      // material-issue.actions.ts 의 서버 검증(DG-014)과 같은 기준: BOM 구성품 + 등록된 대체품.
      const bomLines = await prisma.bOMItem.findMany({
        where: { bomId: workOrder.bomId },
        select: { componentItemId: true },
      })
      const componentIds = bomLines.map((l) => l.componentItemId)
      const substitutes = componentIds.length
        ? await prisma.itemSubstitute.findMany({
            where: { itemId: { in: componentIds } },
            select: { substituteItemId: true },
          })
        : []
      const allowed = new Set<string>([...componentIds, ...substitutes.map((s) => s.substituteItemId)])
      if (!allowed.has(lot.itemId)) {
        blockCode = "NOT_BOM_COMPONENT"
        blockReason = "이 작업지시의 BOM 구성품이 아닌 LOT 입니다."
      }
    }
  }

  return {
    ok: true,
    lot: {
      id: lot.id,
      lotNo: lot.lotNo,
      status: String(lot.status),
      manufactureDate: lot.manufactureDate ? new Date(lot.manufactureDate).toISOString() : null,
      expiryDate: lot.expiryDate ? new Date(lot.expiryDate).toISOString() : null,
      item: {
        id: item.id,
        code: item.code,
        name: item.name,
        itemType: String(item.itemType),
        uom: item.uom,
        isLotTracked: Boolean(item.isLotTracked),
      },
      qtyOnHand,
      qtyAvailable,
      balances: balanceDtos,
    },
    usable: blockCode === null,
    blockCode,
    blockReason,
  }
}

// ─── 라벨 출력 / 재출력 감사 ────────────────────────────────────────────────

export type LotLabelPrintInput = {
  lotNos: string[]
  /** 재출력 사유(재출력일 때 권장). */
  reason?: string
}

export type LotLabelPrintResult =
  | {
      ok: true
      results: Array<{ lotNo: string; event: "LABEL_PRINT" | "LABEL_REPRINT"; printCount: number; qrPayload: string }>
    }
  | {
      ok: false
      code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "LOT_NOT_PERSISTED"
      message: string
      /** LOT_NOT_PERSISTED: DB 에 Lot 행이 없는(입고 미확정/실패/취소) 번호 */
      missingLotNos?: string[]
    }

const MAX_LABEL_LOTS = 50

/**
 * 라벨 출력(최초/재출력)을 AuditLog 에 남긴다. 최초/재출력은 서버가 이전 이력으로 판정한다(클라이언트 값 불신).
 * 재출력해도 LOT/QR 은 바뀌지 않는다 — 같은 lotNo 에서 항상 같은 payload 가 나온다.
 */
export async function recordLotLabelPrint(input: LotLabelPrintInput): Promise<LotLabelPrintResult> {
  let actor
  try {
    actor = await requireReadActor(SCAN_READ_RESOURCES)
  } catch (error) {
    const fail = authFailure(error)
    return { ok: false, code: fail.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "DENIED", message: fail.message }
  }
  const tenantId = actor.tenantId

  const lotNos = Array.from(new Set((input.lotNos ?? []).map((n) => String(n ?? "").trim()).filter(Boolean)))
  if (lotNos.length === 0) return { ok: false, code: "INVALID", message: "출력할 LOT 가 없습니다." }
  if (lotNos.length > MAX_LABEL_LOTS) {
    return { ok: false, code: "INVALID", message: `한 번에 ${MAX_LABEL_LOTS}건까지만 기록할 수 있습니다.` }
  }
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 200) || null : null

  const lots = await prisma.lot.findMany({ where: { tenantId, lotNo: { in: lotNos } } })
  const lotByNo = new Map(lots.map((l) => [l.lotNo, l]))
  // 라벨 출력 게이트(Phase 11): Lot 행이 영속화된 번호만 출력/재출력할 수 있다.
  // 하나라도 없으면 전부 거부하고 감사 기록도 남기지 않는다(입고 실패/취소 후 존재하지 않는 LOT QR 이 현장에 남는 것을 방지).
  const missing = lotNos.filter((n) => !lotByNo.has(n))
  if (missing.length > 0) {
    return {
      ok: false,
      code: "LOT_NOT_PERSISTED",
      message: "아직 등록되지 않았거나 존재하지 않는 LOT 입니다. 입고(또는 LOT 생성)가 완료된 후 라벨을 출력해 주세요.",
      missingLotNos: missing,
    }
  }

  const previous = await prisma.auditLog.findMany({
    where: { tenantId, entityType: "LotLabel", entityId: { in: lots.map((l) => l.id) } },
  })
  const countByLot = new Map<string, number>()
  for (const row of previous) countByLot.set(row.entityId, (countByLot.get(row.entityId) ?? 0) + 1)

  const results: Array<{ lotNo: string; event: "LABEL_PRINT" | "LABEL_REPRINT"; printCount: number; qrPayload: string }> = []
  for (const lot of lots) {
    const priorCount = countByLot.get(lot.id) ?? 0
    const event = priorCount === 0 ? "LABEL_PRINT" : "LABEL_REPRINT"
    const qrPayload = encodeLotQr(lot.lotNo)
    await recordAuditLog(prisma, {
      tenantId,
      actor,
      entityType: "LotLabel",
      entityId: lot.id,
      action: "CREATE",
      afterData: { event, lotNo: lot.lotNo, printCount: priorCount + 1, reason, qrPayload, lotStatus: String(lot.status) },
      menuName: "LOT 라벨",
    })
    results.push({ lotNo: lot.lotNo, event, printCount: priorCount + 1, qrPayload })
  }
  return { ok: true, results }
}
