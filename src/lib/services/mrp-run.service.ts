/**
 * MRP 실행이력 / Snapshot 서비스 (DB 클라이언트 주입형) — Phase 6
 *
 *   저장: 서버가 MRP 를 (다시) 계산 → 불변 Snapshot + 요약 + 제안 행 → MrpRun / MrpRunSuggestion (+ AuditLog)
 *   조회: 목록(요약 컬럼만, 페이지네이션) / 상세(저장된 Snapshot 값을 그대로 — 재계산하지 않는다)
 *
 * 보안/정합성
 *  - tenantId 는 authorize() 가 돌려준 인증 사용자에서만 결정한다. 클라이언트가 보낸 Snapshot/결과/tenantId 는 받지 않는다.
 *    (서버가 입력 파라미터(기간/DRAFT 수주 포함 여부)만으로 다시 계산해 저장한다.)
 *  - Snapshot 은 읽기 전용이다. UPDATE/DELETE 기능을 제공하지 않으며 DB trigger 도 수정을 거부한다.
 *  - 다른 tenant 의 run id 는 존재하지 않는 것과 같게 응답한다(존재 여부 비노출).
 *  - 일반 GET/SSR 조회는 어떤 행도 만들지 않는다. 저장은 명시적 save 요청과 DRAFT 발주 생성 시점에만 일어난다.
 *  - 단가는 Snapshot 에 넣지 않는다(가격 조회 권한 분리).
 */

import type { Prisma, PrismaClient } from "@prisma/client"
import {
  buildMrpRunSnapshot,
  isSnapshotTooLarge,
  type BuiltMrpRun,
  type MrpRunSnapshot,
} from "../mrp/mrp-run-snapshot"
import { toDateOnly } from "../mrp/period"
import { normalizeOrderMrpParams } from "./mrp-order.service"
import { computePurchaseSuggestions, type PurchaseSuggestionDb } from "./mrp-purchase-suggestion.service"

export type MrpRunDb = PurchaseSuggestionDb &
  Pick<PrismaClient, "mrpRun" | "mrpRunSuggestion" | "mrpRunPurchase" | "auditLog" | "$transaction">

export type MrpRunActor = { id: string; name?: string | null; tenantId: string }

export type MrpRunErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "TOO_LARGE" | "IDEMPOTENCY_KEY_REUSE_MISMATCH" | "FAILED"

export const MRP_RUN_ERROR_MESSAGES: Record<MrpRunErrorCode, string> = {
  INVALID_INPUT: "요청 값이 올바르지 않습니다.",
  NOT_FOUND: "MRP 실행이력을 찾을 수 없습니다.",
  TOO_LARGE: "MRP 결과가 너무 커서 저장할 수 없습니다. 조회 기간을 줄여 다시 시도해 주세요.",
  IDEMPOTENCY_KEY_REUSE_MISMATCH: "같은 요청 키로 이미 다른 내용의 요청이 처리되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  FAILED: "MRP 실행이력을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
}

const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/
export function isValidRequestKey(v: unknown): v is string {
  return typeof v === "string" && REQUEST_KEY_RE.test(v)
}

const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"

export const MRP_RUN_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const

export type MrpRunListItem = {
  id: string
  runType: string
  mode: string
  status: string
  baseDate: string
  fromDate: string | null
  toDate: string | null
  includeDraft: boolean
  demandLineCount: number
  materialCount: number
  shortageMaterialCount: number
  purchaseNeededCount: number
  warningCount: number
  purchaseOrderCount: number
  createdByName: string | null
  createdAt: string
}

export type MrpRunPurchaseView = {
  id: string
  purchaseOrderId: string | null
  orderNo: string
  supplierId: string
  supplierName: string
  /** 연결된 구매발주의 "현재" 상태. 구매발주가 삭제되었으면 DELETED */
  currentStatus: string
  itemCount: number
  totalQty: number
  overrideUsed: boolean
  overrideReason: string | null
  lines: unknown
  createdByName: string | null
  createdAt: string
}

export type MrpRunDetail = {
  run: MrpRunListItem & { snapshotVersion: number; sourceHash: string; resultHash: string }
  /** 저장 당시 계산 결과(표시용 값). 이후 재계산하지 않는다 */
  snapshot: MrpRunSnapshot
  purchases: MrpRunPurchaseView[]
}

const dateOnlyOrNull = (d: unknown): string | null => (d instanceof Date ? toDateOnly(d) : typeof d === "string" ? d.slice(0, 10) : null)

function toListItem(row: any, purchaseOrderCount: number): MrpRunListItem {
  return {
    id: row.id,
    runType: row.runType,
    mode: row.mode,
    status: row.status,
    baseDate: dateOnlyOrNull(row.baseDate) ?? "",
    fromDate: dateOnlyOrNull(row.fromDate),
    toDate: dateOnlyOrNull(row.toDate),
    includeDraft: row.includeDraft === true,
    demandLineCount: row.demandLineCount,
    materialCount: row.materialCount,
    shortageMaterialCount: row.shortageMaterialCount,
    purchaseNeededCount: row.purchaseNeededCount,
    warningCount: row.warningCount,
    purchaseOrderCount,
    createdByName: row.createdByName ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }
}

const dateAt = (d: string | null) => (d ? new Date(`${d}T00:00:00.000Z`) : null)

/**
 * Snapshot 행 저장(트랜잭션 안에서 호출). MrpRun + MrpRunSuggestion + AuditLog.
 * DRAFT 발주 생성 시 같은 트랜잭션에서 호출되어 "PO 와 근거 Snapshot 이 함께 생기거나 함께 사라진다".
 */
export async function persistMrpRun(
  tx: Pick<PrismaClient, "mrpRun" | "mrpRunSuggestion" | "auditLog">,
  args: {
    tenantId: string
    actor: MrpRunActor
    built: BuiltMrpRun
    requestKey: string | null
    source: "SAVE" | "DRAFT_PO_CREATE"
  }
): Promise<{ runId: string; createdAt: string }> {
  const { tenantId, actor, built, requestKey } = args
  const run = await tx.mrpRun.create({
    data: {
      tenantId,
      runType: "ORDER_MRP",
      mode: "NORMAL",
      status: "SAVED",
      baseDate: dateAt(built.columns.baseDate) as Date,
      fromDate: dateAt(built.columns.fromDate),
      toDate: dateAt(built.columns.toDate),
      includeDraft: built.columns.includeDraft,
      includeScheduledReceipts: true,
      semiFinishedNetting: true,
      demandLineCount: built.columns.demandLineCount,
      materialCount: built.columns.materialCount,
      shortageMaterialCount: built.columns.shortageMaterialCount,
      purchaseNeededCount: built.columns.purchaseNeededCount,
      warningCount: built.columns.warningCount,
      snapshotVersion: built.snapshot.version,
      snapshot: built.snapshot as unknown as Prisma.InputJsonValue,
      sourceHash: built.sourceHash,
      resultHash: built.resultHash,
      requestKey,
      createdById: actor.id,
      createdByName: actor.name ?? null,
    },
  })
  if (built.suggestionRows.length > 0) {
    await tx.mrpRunSuggestion.createMany({
      data: built.suggestionRows.map((r) => ({
        tenantId,
        runId: run.id,
        itemId: r.itemId,
        itemCode: r.itemCode,
        itemName: r.itemName,
        kind: r.kind,
        rawNeed: r.rawNeed,
        suggestedQty: r.suggestedQty,
        draftCoverageQty: r.draftCoverageQty,
        additionalQty: r.additionalQty,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        targetReceiptDate: dateAt(r.targetReceiptDate),
        orderByDate: dateAt(r.orderByDate),
        payload: r.payload as unknown as Prisma.InputJsonValue,
      })),
    })
  }
  await tx.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name ?? null,
      entityType: "MrpRun",
      entityId: run.id,
      action: "CREATE",
      afterData: {
        source: args.source,
        runType: "ORDER_MRP",
        mode: "NORMAL",
        baseDate: built.columns.baseDate,
        from: built.columns.fromDate,
        to: built.columns.toDate,
        includeDraft: built.columns.includeDraft,
        demandLineCount: built.columns.demandLineCount,
        materialCount: built.columns.materialCount,
        shortageMaterialCount: built.columns.shortageMaterialCount,
        purchaseNeededCount: built.columns.purchaseNeededCount,
        warningCount: built.columns.warningCount,
        sourceHash: built.sourceHash,
        resultHash: built.resultHash,
        snapshotBytes: built.byteSize,
        compacted: built.snapshot.compacted,
        requestKey,
      } as Prisma.InputJsonValue,
      menuName: "MRP 실행이력",
    },
  })
  const createdAt = run.createdAt instanceof Date ? run.createdAt.toISOString() : String(run.createdAt)
  return { runId: run.id, createdAt }
}

/** 서버 계산 → Snapshot 빌드(저장 전). 클라이언트 결과를 받지 않는다. */
export async function buildRunFromCurrentMrp(
  db: PurchaseSuggestionDb,
  tenantId: string,
  params: { from: string | null; to: string | null; includeDraft: boolean },
  now: () => Date
): Promise<BuiltMrpRun> {
  const computed = await computePurchaseSuggestions(db, tenantId, params, { now, includePrices: false })
  return buildMrpRunSnapshot({
    view: computed.view,
    rows: computed.payload.rows,
    baseDate: computed.payload.baseDate ?? toDateOnly(computed.calculatedAt),
    generatedAt: computed.calculatedAt,
  })
}

export type SaveMrpRunResult =
  | {
      success: true
      data: {
        runId: string
        createdAt: string
        /** 같은 requestKey 의 재전송 → 새로 만들지 않고 기존 결과를 돌려줌 */
        replayed: boolean
        summary: MrpRunListItem
      }
    }
  | { success: false; code: MrpRunErrorCode; error: string }

function failRun(code: MrpRunErrorCode): { success: false; code: MrpRunErrorCode; error: string } {
  return { success: false, code, error: MRP_RUN_ERROR_MESSAGES[code] }
}

/** 명시적 "MRP 실행 저장". */
export async function saveMrpRun(
  deps: { authorize: () => Promise<MrpRunActor>; db: MrpRunDb; now?: () => Date },
  rawInput: unknown
): Promise<SaveMrpRunResult> {
  // 권한 실패(throw)는 DB 접근 전에 발생한다
  const actor = await deps.authorize()
  const tenantId = actor.tenantId
  const now = deps.now ?? (() => new Date())

  let params: { from: string | null; to: string | null; includeDraft: boolean }
  let requestKey: string | null = null
  try {
    const n = normalizeOrderMrpParams(rawInput)
    params = { from: n.from, to: n.to, includeDraft: n.includeDraft }
    const rk = (typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>).requestKey : undefined) as unknown
    if (rk !== undefined && rk !== null) {
      if (!isValidRequestKey(rk)) return failRun("INVALID_INPUT")
      requestKey = rk
    }
  } catch {
    return failRun("INVALID_INPUT")
  }

  const replay = async (): Promise<SaveMrpRunResult | null> => {
    if (requestKey === null) return null
    const existing = await deps.db.mrpRun.findFirst({ where: { tenantId, requestKey } })
    if (!existing) return null
    // 같은 키 + 다른 요청(기간/DRAFT 수주 포함 여부) → replay 하지 않고 거부(쓰기 0)
    const ex = existing as { fromDate?: Date | null; toDate?: Date | null; includeDraft?: boolean }
    const same =
      dateOnlyOrNull(ex.fromDate ?? null) === params.from &&
      dateOnlyOrNull(ex.toDate ?? null) === params.to &&
      (ex.includeDraft === true) === params.includeDraft
    if (!same) return failRun("IDEMPOTENCY_KEY_REUSE_MISMATCH")
    const purchases = await deps.db.mrpRunPurchase.findMany({ where: { tenantId, runId: existing.id }, select: { runId: true } })
    return {
      success: true,
      data: { runId: existing.id, createdAt: toListItem(existing, 0).createdAt, replayed: true, summary: toListItem(existing, purchases.length) },
    }
  }

  try {
    const replayed = await replay()
    if (replayed) return replayed

    const built = await buildRunFromCurrentMrp(deps.db, tenantId, params, now)
    const saved = await deps.db.$transaction(
      (tx) => persistMrpRun(tx as any, { tenantId, actor, built, requestKey, source: "SAVE" }),
      MRP_RUN_TX_OPTIONS
    )
    const summary: MrpRunListItem = {
      id: saved.runId,
      runType: "ORDER_MRP",
      mode: "NORMAL",
      status: "SAVED",
      baseDate: built.columns.baseDate,
      fromDate: built.columns.fromDate,
      toDate: built.columns.toDate,
      includeDraft: built.columns.includeDraft,
      demandLineCount: built.columns.demandLineCount,
      materialCount: built.columns.materialCount,
      shortageMaterialCount: built.columns.shortageMaterialCount,
      purchaseNeededCount: built.columns.purchaseNeededCount,
      warningCount: built.columns.warningCount,
      purchaseOrderCount: 0,
      createdByName: actor.name ?? null,
      createdAt: saved.createdAt,
    }
    return { success: true, data: { runId: saved.runId, createdAt: saved.createdAt, replayed: false, summary } }
  } catch (e) {
    if (isSnapshotTooLarge(e)) return failRun("TOO_LARGE")
    if (isUniqueViolation(e)) {
      // 같은 requestKey 의 동시 요청: 먼저 저장된 행을 돌려준다(중복 저장 없음)
      try {
        const replayed = await replay()
        if (replayed) return replayed
      } catch {
        // fallthrough
      }
    }
    console.error("[saveMrpRun] failed:", e)
    return failRun("FAILED")
  }
}

export const MRP_RUN_PAGE_SIZE_DEFAULT = 20
export const MRP_RUN_PAGE_SIZE_MAX = 100

export type MrpRunListResult = {
  items: MrpRunListItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const LIST_SELECT = {
  id: true,
  runType: true,
  mode: true,
  status: true,
  baseDate: true,
  fromDate: true,
  toDate: true,
  includeDraft: true,
  demandLineCount: true,
  materialCount: true,
  shortageMaterialCount: true,
  purchaseNeededCount: true,
  warningCount: true,
  createdByName: true,
  createdAt: true,
} as const

/** 실행이력 목록: 요약 컬럼만 조회(Snapshot JSON 은 읽지 않는다). 쿼리 수는 페이지 크기와 무관(3회). */
export async function listMrpRuns(
  deps: { authorize: () => Promise<{ tenantId: string }>; db: Pick<MrpRunDb, "mrpRun" | "mrpRunPurchase"> },
  rawInput?: { page?: unknown; pageSize?: unknown } | null
): Promise<MrpRunListResult> {
  const user = await deps.authorize()
  const tenantId = user.tenantId
  const toInt = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
    return Number.isInteger(n) && n >= 1 ? n : fallback
  }
  const pageSize = Math.min(MRP_RUN_PAGE_SIZE_MAX, toInt(rawInput?.pageSize, MRP_RUN_PAGE_SIZE_DEFAULT))
  const requestedPage = toInt(rawInput?.page, 1)

  const total = await deps.db.mrpRun.count({ where: { tenantId } })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const rows = (await deps.db.mrpRun.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: LIST_SELECT,
  })) as any[]
  const counts = new Map<string, number>()
  if (rows.length > 0) {
    const purchases = await deps.db.mrpRunPurchase.findMany({
      where: { tenantId, runId: { in: rows.map((r) => r.id) } },
      select: { runId: true },
    })
    for (const p of purchases) counts.set(p.runId, (counts.get(p.runId) ?? 0) + 1)
  }
  return {
    items: rows.map((r) => toListItem(r, counts.get(r.id) ?? 0)),
    page,
    pageSize,
    total,
    totalPages,
  }
}

export type MrpRunDetailResult =
  | { success: true; data: MrpRunDetail }
  | { success: false; code: MrpRunErrorCode; error: string }

/** 실행이력 상세: tenant + id 로 조회. 없거나 다른 tenant 이면 동일한 NOT_FOUND. */
export async function getMrpRunDetail(
  deps: { authorize: () => Promise<{ tenantId: string }>; db: Pick<MrpRunDb, "mrpRun" | "mrpRunPurchase"> },
  runId: unknown
): Promise<MrpRunDetailResult> {
  const user = await deps.authorize()
  if (typeof runId !== "string" || runId.length === 0 || runId.length > 100) return failRun("NOT_FOUND")
  const row = (await deps.db.mrpRun.findFirst({ where: { id: runId, tenantId: user.tenantId } })) as any
  if (!row) return failRun("NOT_FOUND")
  const purchases = (await deps.db.mrpRunPurchase.findMany({
    where: { tenantId: user.tenantId, runId: row.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { purchaseOrder: { select: { status: true } } },
  })) as any[]
  return {
    success: true,
    data: {
      run: {
        ...toListItem(row, purchases.length),
        snapshotVersion: row.snapshotVersion,
        sourceHash: row.sourceHash,
        resultHash: row.resultHash,
      },
      snapshot: row.snapshot as MrpRunSnapshot,
      purchases: purchases.map(
        (p): MrpRunPurchaseView => ({
          id: p.id,
          purchaseOrderId: p.purchaseOrderId ?? null,
          orderNo: p.orderNo,
          supplierId: p.supplierId,
          supplierName: p.supplierName,
          currentStatus: p.purchaseOrderId && p.purchaseOrder ? String(p.purchaseOrder.status) : "DELETED",
          itemCount: p.itemCount,
          totalQty: Number(p.totalQty),
          overrideUsed: p.overrideUsed === true,
          overrideReason: p.overrideReason ?? null,
          lines: p.lines,
          createdByName: p.createdByName ?? null,
          createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
        })
      ),
    },
  }
}
