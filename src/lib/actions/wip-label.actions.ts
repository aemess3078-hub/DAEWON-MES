"use server"

/**
 * WIP(공정·재공 통합) 라벨 인쇄 요청 이력 · 게이트. LOT 라벨(lot-label.actions.ts)과 같은 구조를 재사용하되,
 * WIP 은 "최초 요청 / 재요청" 판정과 기록을 한 트랜잭션에서 직렬화한다.
 *
 * 이력의 의미
 *  - 여기에 남는 이력은 "라벨 인쇄 요청 이력"이다. 브라우저는 실제 프린터 출력 완료 여부를 알 수 없으므로
 *    인쇄창에서 취소하거나 프린터 오류가 나도 이력은 남는다(출력 완료 확인 기능은 범위 밖).
 *  - 그래서 이미 요청 이력이 있는 WIP 의 두 번째 요청부터는 사유(이전 인쇄 취소·실패, 분실·훼손 등)를 받아 재요청으로 기록한다.
 *  - event 이름(WIP_LABEL_ISSUE / WIP_LABEL_REISSUE)은 유지한다: 최초 요청 / 재요청.
 *
 * 동시성
 *  - recordWipLabelPrint 는 하나의 Prisma 트랜잭션 안에서
 *    ① WipUnit 행을 id 정렬 순서로 SELECT … FOR UPDATE 로 잠그고(저장소 관례: pop.actions.ts 와 동일)
 *    ② 잠금 이후의 최신 이력을 조회해 최초/재요청을 판정하고 ③ 같은 트랜잭션에서 AuditLog 를 기록한다.
 *    같은 WIP 의 동시 요청은 잠금에서 직렬화되어 한 건만 최초(횟수 1)가 되고 나머지는 재요청 사유를 요구받는다.
 *    서로 다른 WIP 은 서로 다른 행을 잠그므로 서로 기다리지 않는다.
 *  - checkWipLabelPrintable 은 화면용 읽기 전용 사전 확인(잠금 없음)이며 권위 있는 판정은 recordWipLabelPrint 가 한다.
 *
 * 그 밖의 규칙
 *  - 출하·공정이동 전용 라벨은 없다 — 공정이 바뀌어도 같은 라벨/QR 을 쓴다(현재 공정·수량·상태는 MES 조회).
 *  - 읽기 + AuditLog 기록만 한다(WipUnit/재고/LOT 변경 없음). 새 테이블/스키마 변경 없음.
 *    entityType="WipLabel", action="CREATE".
 *  - 폐기(SCRAPPED)된 WIP 은 요청할 수 없다.
 *  - WIP 식별값으로 어떤 값을 쓸지는 미확정이다(현재 WipUnit.id 사용).
 *  - 발행 가능 조건(세 함수 모두 같은 findIneligible 을 쓴다 — 화면의 상태값은 신뢰하지 않는다):
 *      원본(루트) WipUnit(자식·분할·불량·재작업 WIP 제외) · 폐기 아님 · 작업지시가 자재출고 목록 상태(RELEASED/IN_PROGRESS) ·
 *      **자재출고 완료**(모든 BOM 자재의 기출고 ≥ 필요수량, 기존 getWorkOrdersForIssue.allIssued 와 같은 규칙).
 *    일부 출고/출고 미완료/BOM 없음은 최초·재발행 모두 차단한다. recordWipLabelPrint 는 WipUnit 행 잠금 이후 같은 트랜잭션에서
 *    다시 확인한다(잠금 순서: WipUnit 만 잠그고 작업지시/예약은 잠금 없이 읽기만 → 자재출고 트랜잭션(작업지시 잠금 → WipUnit)과 교착 없음).
 *  - getWipLabelTarget: 작업지시 → 라벨 대상 WIP(루트 WipUnit) 조회. 라벨에 찍히는 품목/제조번호/작업지시번호는 모두 이 서버 조회에서
 *    오며 화면이 넘긴 값을 쓰지 않는다. WIP 신규 생성/채번은 하지 않는다(자재출고가 만든 WipUnit 만 대상).
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { encodeWipQr } from "@/lib/qr/lot-qr"
import { computeIssueProgress, issueStateBlockMessage, ISSUE_LISTED_STATUSES } from "@/lib/label/wip-label-eligibility"
import type { CurrentUser } from "@/lib/auth"

const MAX_LABEL_WIPS = 50
const READ_RESOURCES = ["WORK_ORDER", "LOT", "INVENTORY", "PURCHASE_ORDER"] as const
/** 트랜잭션 제한: 잠금 대기는 짧게(업무 트랜잭션과 겹쳐도 몇 초 안에 포기하고 재시도 안내). */
const LOCK_TIMEOUT_MS = 5000
const TX_OPTIONS = { maxWait: 5000, timeout: 15000 } as const

export type WipLabelCheckResult =
  | {
      ok: true
      /** 이미 인쇄 요청 이력이 있는 WIP — 재요청 사유가 필요하다. */
      reissueWipIds: string[]
    }
  | {
      ok: false
      code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "WIP_NOT_FOUND" | "WIP_SCRAPPED" | EligibilityCode
      message: string
      missingWipIds?: string[]
    }

/** WIP_NOT_ELIGIBLE: 하위 WIP/작업지시 없음/작업지시 상태. ISSUE_INCOMPLETE: 자재출고 일부·미완료·BOM 없음. */
type EligibilityCode = "WIP_NOT_ELIGIBLE" | "ISSUE_INCOMPLETE"

export type WipLabelRecordResult =
  | {
      ok: true
      results: Array<{ wipId: string; event: "WIP_LABEL_ISSUE" | "WIP_LABEL_REISSUE"; issueCount: number; qrPayload: string }>
    }
  | {
      ok: false
      code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "WIP_NOT_FOUND" | "WIP_SCRAPPED" | EligibilityCode | "REASON_REQUIRED" | "FAILED"
      message: string
      missingWipIds?: string[]
      reissueWipIds?: string[]
    }

type Failure = { code: "UNAUTHORIZED" | "DENIED"; message: string }

async function resolveActor(): Promise<{ actor: CurrentUser } | Failure> {
  let denied = false
  for (const resource of READ_RESOURCES) {
    try {
      const actor = await requireResourcePermission(resource, "READ")
      return { actor }
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        return { code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
      }
      denied = true
    }
  }
  return denied ? { code: "DENIED", message: "라벨을 출력할 권한이 없습니다." } : { code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
}

function normalizeIds(input: unknown): string[] {
  const list = Array.isArray(input) ? input : []
  return Array.from(new Set(list.map((n) => String(n ?? "").trim()).filter(Boolean)))
}

const NOT_FOUND_MESSAGE = "재공(WIP)을 찾을 수 없습니다. WIP 이 생성(자재출고 등)된 후 라벨을 출력해 주세요."
const SCRAPPED_MESSAGE = "폐기(SCRAPPED)된 재공은 라벨 인쇄를 요청할 수 없습니다."
const REASON_REQUIRED_MESSAGE =
  "이미 라벨 인쇄가 요청된 재공입니다(WIP 라벨은 모든 공정에서 재사용합니다). 이전 인쇄가 취소·실패했거나 라벨을 다시 만들어야 하면 사유를 입력해 주세요."
const FAILED_MESSAGE = "라벨 인쇄 요청 이력을 기록하지 못했습니다. 잠시 후 다시 시도해 주세요."

type DbClient = Pick<Prisma.TransactionClient, "wipUnit" | "auditLog" | "workOrder">

type UnitRow = {
  id: string
  status: unknown
  manufacturingNo: string | null
  workOrderId: string | null
  parentWipUnitId: string | null
  sourceProductionResultId: string | null
}

async function loadUnits(db: DbClient, tenantId: string, ids: string[]) {
  const units: UnitRow[] = await db.wipUnit.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, status: true, manufacturingNo: true, workOrderId: true, parentWipUnitId: true, sourceProductionResultId: true },
  })
  const byId = new Map(units.map((u) => [u.id, u]))
  return { units, missing: ids.filter((id) => !byId.has(id)) }
}

/**
 * 발행 가능 조건 확인(세 함수 공통). 첫 번째로 걸리는 사유를 돌려주고, 모두 통과하면 null.
 * 읽기만 한다(잠금 없음) — 호출 위치가 잠금 이후(recordWipLabelPrint)여도 새 잠금 순서를 만들지 않는다.
 */
async function findIneligible(
  db: DbClient,
  tenantId: string,
  units: UnitRow[],
): Promise<{ code: EligibilityCode; message: string } | null> {
  for (const unit of units) {
    if (unit.parentWipUnitId || unit.sourceProductionResultId) {
      return { code: "WIP_NOT_ELIGIBLE", message: "분할·불량·재작업으로 생긴 하위 WIP 은 이번 단계의 라벨 대상이 아닙니다(작업지시의 원본 WIP 만 발행합니다)." }
    }
  }
  if (units.some((u) => !u.workOrderId)) {
    return { code: "WIP_NOT_ELIGIBLE", message: "작업지시와 연결되지 않은 WIP 은 라벨을 발행할 수 없습니다." }
  }
  const workOrderIds = Array.from(new Set(units.map((u) => u.workOrderId as string)))
  const workOrders = await db.workOrder.findMany({
    where: { tenantId, id: { in: workOrderIds } },
    select: {
      id: true,
      status: true,
      plannedQty: true,
      bom: { select: { bomItems: { select: { componentItemId: true, qtyPer: true, scrapRate: true } } } },
      materialReservations: { select: { itemId: true, issuedQty: true } },
    },
  })
  const byId = new Map(workOrders.map((w) => [w.id, w]))
  for (const unit of units) {
    const workOrder = byId.get(unit.workOrderId as string)
    if (!workOrder) return { code: "WIP_NOT_ELIGIBLE", message: "작업지시를 찾을 수 없어 WIP 라벨을 발행할 수 없습니다." }
    const progress = computeIssueProgress({
      status: String(workOrder.status),
      plannedQty: workOrder.plannedQty,
      bomItems: workOrder.bom.bomItems,
      reservations: workOrder.materialReservations,
    })
    if (!progress.listed) {
      return {
        code: "WIP_NOT_ELIGIBLE",
        message: `현재 작업지시 상태(${String(workOrder.status)})에서는 WIP 라벨을 발행할 수 없습니다(자재출고 목록 대상: ${ISSUE_LISTED_STATUSES.join(", ")}).`,
      }
    }
    const blocked = issueStateBlockMessage(progress.state)
    if (blocked) return { code: "ISSUE_INCOMPLETE", message: blocked }
  }
  return null
}

async function requestCounts(db: DbClient, tenantId: string, ids: string[]) {
  const previous = await db.auditLog.findMany({
    where: { tenantId, entityType: "WipLabel", entityId: { in: ids } },
    select: { entityId: true },
  })
  const counts = new Map<string, number>()
  for (const row of previous) counts.set(row.entityId, (counts.get(row.entityId) ?? 0) + 1)
  return counts
}

/** 읽기 전용 사전 확인(잠금 없음): WIP 존재/폐기 여부, 이미 요청 이력이 있는 WIP(재요청 사유 필요). 권위 있는 판정은 recordWipLabelPrint. */
export async function checkWipLabelPrintable(input: { wipUnitIds: string[] }): Promise<WipLabelCheckResult> {
  const resolved = await resolveActor()
  if (!("actor" in resolved)) return { ok: false, ...resolved }
  const tenantId = resolved.actor.tenantId

  const ids = normalizeIds(input?.wipUnitIds)
  if (ids.length === 0) return { ok: false, code: "INVALID", message: "출력할 WIP 이 없습니다." }
  if (ids.length > MAX_LABEL_WIPS) return { ok: false, code: "INVALID", message: `한 번에 ${MAX_LABEL_WIPS}건까지만 출력할 수 있습니다.` }

  const { units, missing } = await loadUnits(prisma, tenantId, ids)
  // 다른 tenant 의 WIP 도 존재 여부를 구분하지 않고 같은 메시지로 거부한다.
  if (missing.length > 0) return { ok: false, code: "WIP_NOT_FOUND", message: NOT_FOUND_MESSAGE, missingWipIds: missing }
  if (units.some((u) => String(u.status) === "SCRAPPED")) return { ok: false, code: "WIP_SCRAPPED", message: SCRAPPED_MESSAGE }
  const ineligible = await findIneligible(prisma, tenantId, units)
  if (ineligible) return { ok: false, ...ineligible }

  const counts = await requestCounts(prisma, tenantId, units.map((u) => u.id))
  return { ok: true, reissueWipIds: units.filter((u) => (counts.get(u.id) ?? 0) > 0).map((u) => u.id) }
}

/**
 * WIP 라벨 인쇄 요청(최초/재요청)을 AuditLog 에 남긴다. 같은 WIP 는 항상 같은 QR payload 를 만든다(재요청해도 QR 불변).
 * 하나라도 없거나 폐기되었거나, 재요청인데 사유가 없으면 아무것도 기록하지 않는다(전부 또는 전무).
 *
 * 판정과 기록은 WipUnit 행 잠금을 쥔 채 같은 트랜잭션에서 수행한다 — 파일 상단 "동시성" 참고.
 */
export async function recordWipLabelPrint(input: {
  wipUnitIds: string[]
  reason?: string
  context?: string
}): Promise<WipLabelRecordResult> {
  const resolved = await resolveActor()
  if (!("actor" in resolved)) return { ok: false, ...resolved }
  const { actor } = resolved
  const tenantId = actor.tenantId

  const ids = normalizeIds(input?.wipUnitIds)
  if (ids.length === 0) return { ok: false, code: "INVALID", message: "출력할 WIP 이 없습니다." }
  if (ids.length > MAX_LABEL_WIPS) return { ok: false, code: "INVALID", message: `한 번에 ${MAX_LABEL_WIPS}건까지만 기록할 수 있습니다.` }
  const reason = typeof input?.reason === "string" ? input.reason.trim().slice(0, 200) || null : null
  const context = typeof input?.context === "string" ? input.context.trim().slice(0, 100) || null : null
  // 잠금 순서를 고정해 서로 겹치는 요청끼리 교착(deadlock)이 생기지 않게 한다.
  const sortedIds = [...ids].sort()

  try {
    return await prisma.$transaction(async (tx): Promise<WipLabelRecordResult> => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}, true)`

      // ① 잠금: tenant 소유 WipUnit 행만 FOR UPDATE (다른 tenant/없는 id 는 잠기지 않고 missing 으로 남는다)
      const lockedIds = new Set<string>()
      for (const id of sortedIds) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "WipUnit" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
        `
        if (rows.length > 0) lockedIds.add(id)
      }
      const missing = sortedIds.filter((id) => !lockedIds.has(id))
      if (missing.length > 0) return { ok: false, code: "WIP_NOT_FOUND", message: NOT_FOUND_MESSAGE, missingWipIds: missing }

      // ② 잠금 이후의 최신 상태/이력으로 판정(다른 트랜잭션이 먼저 커밋한 요청 이력이 여기서 보인다)
      const { units } = await loadUnits(tx, tenantId, sortedIds)
      if (units.some((u) => String(u.status) === "SCRAPPED")) return { ok: false, code: "WIP_SCRAPPED", message: SCRAPPED_MESSAGE }
      // 이력 기록 직전에도 같은 발행 조건을 다시 확인한다(사전 확인 이후 상태가 바뀌었을 수 있다 — 화면/사전 확인을 신뢰하지 않는다).
      const ineligible = await findIneligible(tx, tenantId, units)
      if (ineligible) return { ok: false, ...ineligible }

      const counts = await requestCounts(tx, tenantId, units.map((u) => u.id))
      const reissueWipIds = units.filter((u) => (counts.get(u.id) ?? 0) > 0).map((u) => u.id)
      if (reissueWipIds.length > 0 && !reason) {
        return { ok: false, code: "REASON_REQUIRED", message: REASON_REQUIRED_MESSAGE, reissueWipIds }
      }

      // ③ 같은 트랜잭션에서 기록 — 횟수는 잠금 하에서 읽은 이전 횟수 + 1 이라 중복/역전이 없다.
      const results: Array<{ wipId: string; event: "WIP_LABEL_ISSUE" | "WIP_LABEL_REISSUE"; issueCount: number; qrPayload: string }> = []
      for (const unit of units) {
        const prior = counts.get(unit.id) ?? 0
        const event = prior === 0 ? "WIP_LABEL_ISSUE" : "WIP_LABEL_REISSUE"
        const qrPayload = encodeWipQr(unit.id)
        await recordAuditLog(tx, {
          tenantId,
          actor,
          entityType: "WipLabel",
          entityId: unit.id,
          action: "CREATE",
          afterData: {
            event,
            wipId: unit.id,
            manufacturingNo: unit.manufacturingNo ?? null,
            // 인쇄 "요청" 횟수다(실제 출력 완료 횟수가 아님).
            issueCount: prior + 1,
            reason: prior === 0 ? null : reason,
            context,
            qrPayload,
            labelSpec: "QL-820NWB 29x90mm",
            meaning: "PRINT_REQUEST",
          },
          menuName: "WIP 라벨",
        })
        results.push({ wipId: unit.id, event, issueCount: prior + 1, qrPayload })
      }
      return { ok: true, results }
    }, TX_OPTIONS)
  } catch (error) {
    // 잠금 시간 초과/교착/연결 오류 등 — 이력은 롤백되어 남지 않는다. 원문은 서버 로그에만 남긴다.
    console.error("[recordWipLabelPrint] transaction failed:", error)
    return { ok: false, code: "FAILED", message: FAILED_MESSAGE }
  }
}

export type WipLabelTarget = {
  /** 라벨 QR 에 담기는 식별값(= 기존 WipUnit.id). */
  wipUnitId: string
  itemCode: string
  itemName: string
  manufacturingNo: string | null
  workOrderNo: string
}

export type WipLabelTargetResult =
  | { ok: true; target: WipLabelTarget }
  | { ok: false; code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "WORK_ORDER_NOT_FOUND" | "NO_WIP" | "AMBIGUOUS" | "WIP_SCRAPPED" | EligibilityCode; message: string }

const NO_WIP_MESSAGE =
  "아직 WIP 이 생성되지 않았습니다. 자재출고가 완료되어 WIP 이 생성된 후 WIP 라벨을 인쇄할 수 있습니다."
const AMBIGUOUS_MESSAGE =
  "이 작업지시에 라벨 대상 WIP 을 하나로 특정할 수 없습니다(원본 WIP 이 여러 건). 안전을 위해 라벨을 발행하지 않습니다. 관리자에게 문의해 주세요."

/**
 * 작업지시의 라벨 대상 WIP 조회(읽기 전용). 자재출고(material-issue.actions)가 만드는 "원본(루트) WipUnit" —
 * parentWipUnitId 와 sourceProductionResultId 가 모두 없는 행 — 만 대상이다(분할·불량·재작업 자식 WIP 은 대상이 아님).
 * 정확히 1건일 때만 대상을 돌려주고, 0건이면 NO_WIP, 2건 이상이면 임의로 고르지 않고 AMBIGUOUS 로 차단한다.
 */
export async function getWipLabelTarget(input: { workOrderId: string }): Promise<WipLabelTargetResult> {
  const resolved = await resolveActor()
  if (!("actor" in resolved)) return { ok: false, ...resolved }
  const tenantId = resolved.actor.tenantId

  const workOrderId = typeof input?.workOrderId === "string" ? input.workOrderId.trim() : ""
  if (!workOrderId) return { ok: false, code: "INVALID", message: "작업지시가 지정되지 않았습니다." }

  // tenant 소유 작업지시만(다른 tenant 의 작업지시는 존재 여부를 구분하지 않는다)
  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { id: true, orderNo: true, manufacturingNo: true },
  })
  if (!workOrder) return { ok: false, code: "WORK_ORDER_NOT_FOUND", message: "작업지시를 찾을 수 없습니다." }

  const roots = await prisma.wipUnit.findMany({
    where: { tenantId, workOrderId, parentWipUnitId: null, sourceProductionResultId: null },
    select: {
      id: true,
      status: true,
      manufacturingNo: true,
      workOrderId: true,
      parentWipUnitId: true,
      sourceProductionResultId: true,
      item: { select: { code: true, name: true } },
    },
  })
  if (roots.length === 0) return { ok: false, code: "NO_WIP", message: NO_WIP_MESSAGE }
  if (roots.length > 1) return { ok: false, code: "AMBIGUOUS", message: AMBIGUOUS_MESSAGE }

  const root = roots[0]
  if (String(root.status) === "SCRAPPED") return { ok: false, code: "WIP_SCRAPPED", message: SCRAPPED_MESSAGE }
  // check/record 와 같은 발행 조건(자재출고 완료 등)을 서버에서 판정한다.
  const ineligible = await findIneligible(prisma, tenantId, [root])
  if (ineligible) return { ok: false, ...ineligible }
  return {
    ok: true,
    target: {
      wipUnitId: root.id,
      itemCode: root.item.code,
      itemName: root.item.name,
      manufacturingNo: root.manufacturingNo ?? workOrder.manufacturingNo ?? null,
      workOrderNo: workOrder.orderNo,
    },
  }
}
