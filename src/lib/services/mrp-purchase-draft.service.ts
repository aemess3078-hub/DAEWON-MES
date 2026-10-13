/**
 * 발주제안 → 공급업체별 DRAFT 구매발주 생성 (DB 클라이언트 주입형) — Phase 5C
 *
 * 보안/정합성
 *  - tenantId 는 authorize() 가 돌려준 인증 사용자에서만 결정한다. 클라이언트 값은 받지 않는다.
 *  - 서버는 화면 결과를 신뢰하지 않는다. 모든 itemId/supplierId/siteId 를 현재 tenant 소유로 다시 검증하고,
 *    (품목, 공급업체) 쌍이 ACTIVE ItemSupplier 관계 + ACTIVE SUPPLIER/BOTH 거래처인지 확인한다.
 *    타 tenant/미등록은 구분 없이 같은 일반 오류(존재 여부 비노출) + DB write 0건.
 *  - 단가는 클라이언트가 보내지 않는다. 서버가 같은 공급업체의 현재 ItemPrice(PURCHASE)를 조회해 쓴다.
 *    단가가 없으면 0 으로 저장하고 품목 비고에 "단가 미등록"을 남긴다(기존 발주 폼도 0 이상 허용).
 *    합계금액은 모든 라인에 단가가 있을 때만 저장한다(미등록 라인이 있으면 null).
 *  - 상태는 항상 DRAFT. 자동 발주확정/전송 없음. DRAFT 는 MRP 예정입고에 포함되지 않는다(Phase 5B 정책).
 *  - 공급업체별 PO 1건. 전체를 하나의 트랜잭션으로 생성하고 하나라도 실패하면 전체 롤백(부분 생성 없음).
 *  - 헤더 expectedDate = 사용자가 확인한 공급업체 그룹 날짜, 없으면 그룹 라인 필요일 중 가장 빠른 날짜(보수적).
 *    임의 "오늘 + N일"은 사용하지 않는다. 날짜가 없으면 생성하지 않고 입력을 요구한다.
 *  - 발주번호는 purchase-order-number.service 로 같은 트랜잭션에서 연속 확보한다(advisory lock + 숫자 최대값).
 */

import type { Prisma, PrismaClient } from "@prisma/client"
import { isDateOnly, toDateOnly } from "../mrp/period"
import type { DateOnly } from "../mrp/types"
import { loadSupplierPolicies } from "./item-supplier.service"
import { loadCurrentPurchasePrices } from "./mrp-loaders"
import { allocatePurchaseOrderNumbers, pgAdvisoryXactLock } from "./purchase-order-number.service"

export type MrpPurchaseDraftDb = Pick<
  PrismaClient,
  "item" | "itemSupplier" | "itemPrice" | "inventoryBalance" | "site" | "purchaseOrder" | "auditLog" | "$transaction"
>

export type DraftPoActor = { id: string; name?: string | null; tenantId: string }

export type DraftPoLineInput = {
  itemId: string
  supplierId: string
  qty: number
  /** 이 라인의 필요 입고일(결품예정일). 없으면 그룹 날짜가 필요하다 */
  requiredDate?: string | null
}

export type DraftPoInput = {
  lines: DraftPoLineInput[]
  /** supplierId → 사용자가 확인/수정한 헤더 입고예정일 */
  groupExpectedDates?: Record<string, string | null | undefined>
  /** 생략하면 현재 tenant 의 이름순 첫 사이트 */
  siteId?: string | null
}

export type DraftPoCreated = {
  purchaseOrderId: string
  orderNo: string
  supplierId: string
  supplierName: string
  expectedDate: DateOnly
  itemCount: number
  totalQty: number
  /** 모든 라인에 단가가 있을 때만 값이 있다 */
  totalAmount: number | null
  currency: string
  unpricedCount: number
}

export type DraftPoErrorCode =
  | "INVALID_INPUT"
  | "INVALID_REFERENCE"
  | "MISSING_EXPECTED_DATE"
  | "CURRENCY_MISMATCH"
  | "NO_SITE"
  | "FAILED"

export const DRAFT_PO_ERROR_MESSAGES: Record<DraftPoErrorCode, string> = {
  INVALID_INPUT: "발주 수량 또는 입력값이 올바르지 않습니다.",
  INVALID_REFERENCE: "유효하지 않은 참조가 포함되어 있습니다. 품목관리 > 공급업체 관리에서 공급업체 등록 상태를 확인해 주세요.",
  MISSING_EXPECTED_DATE: "입고예정일을 확인할 수 없는 공급업체가 있습니다. 목표 입고일을 입력해 주세요.",
  CURRENCY_MISMATCH: "한 공급업체 발주에 서로 다른 통화의 단가가 섞여 있습니다. 통화별로 나누어 생성해 주세요.",
  NO_SITE: "등록된 공장(사이트)이 없습니다.",
  FAILED: "발주 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
}

export type DraftPoResult =
  | { success: true; data: { orders: DraftPoCreated[]; siteId: string } }
  | { success: false; code: DraftPoErrorCode; error: string }

export const MAX_DRAFT_PO_LINES = 500
const MAX_QTY = 1_000_000_000_000
const MAX_ATTEMPTS = 3
const NOTE = "MRP 발주제안(수주기준)으로 생성된 초안입니다. 단가와 입고예정일을 확인한 뒤 발주확정하세요."

class DraftFailure extends Error {
  readonly isDraftFailure = true
  constructor(readonly code: DraftPoErrorCode, readonly detail?: string) {
    super(code)
    Object.setPrototypeOf(this, DraftFailure.prototype)
  }
}
const isDraftFailure = (e: unknown): e is DraftFailure =>
  typeof e === "object" && e !== null && (e as { isDraftFailure?: boolean }).isDraftFailure === true
const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"

function fail(code: DraftPoErrorCode, detail?: string): DraftPoResult {
  return { success: false, code, error: detail ?? DRAFT_PO_ERROR_MESSAGES[code] }
}

function validQty(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < MAX_QTY && Number(v.toFixed(6)) === v
}

type Merged = { itemId: string; supplierId: string; qty: number; requiredDate: DateOnly | null }

/** 입력 정규화(순수): 검증 + 같은 (품목, 공급업체) 중복 병합(수량 합산, 필요일은 가장 빠른 값) */
export function normalizeDraftPoInput(input: unknown):
  | { ok: true; lines: Merged[]; groupDates: Map<string, DateOnly>; siteId: string | null }
  | { ok: false } {
  if (typeof input !== "object" || input === null) return { ok: false }
  const raw = input as DraftPoInput
  if (!Array.isArray(raw.lines) || raw.lines.length === 0 || raw.lines.length > MAX_DRAFT_PO_LINES) return { ok: false }
  const merged = new Map<string, Merged>()
  for (const l of raw.lines) {
    if (typeof l !== "object" || l === null) return { ok: false }
    if (typeof l.itemId !== "string" || l.itemId.length === 0) return { ok: false }
    if (typeof l.supplierId !== "string" || l.supplierId.length === 0) return { ok: false }
    if (!validQty(l.qty)) return { ok: false }
    let required: DateOnly | null = null
    if (l.requiredDate !== undefined && l.requiredDate !== null && l.requiredDate !== "") {
      if (!isDateOnly(l.requiredDate)) return { ok: false }
      required = l.requiredDate
    }
    const key = `${l.itemId}|${l.supplierId}`
    const existing = merged.get(key)
    if (existing) {
      existing.qty = Math.round((existing.qty + l.qty) * 1e6) / 1e6
      if (required !== null && (existing.requiredDate === null || required < existing.requiredDate)) existing.requiredDate = required
    } else {
      merged.set(key, { itemId: l.itemId, supplierId: l.supplierId, qty: l.qty, requiredDate: required })
    }
  }
  const groupDates = new Map<string, DateOnly>()
  if (raw.groupExpectedDates !== undefined && raw.groupExpectedDates !== null) {
    if (typeof raw.groupExpectedDates !== "object") return { ok: false }
    for (const [supplierId, value] of Object.entries(raw.groupExpectedDates)) {
      if (value === undefined || value === null || value === "") continue
      if (typeof value !== "string" || !isDateOnly(value)) return { ok: false }
      groupDates.set(supplierId, value)
    }
  }
  const siteId = typeof raw.siteId === "string" && raw.siteId.length > 0 ? raw.siteId : null
  if (raw.siteId !== undefined && raw.siteId !== null && typeof raw.siteId !== "string") return { ok: false }
  return { ok: true, lines: Array.from(merged.values()), groupDates, siteId }
}

export async function createDraftPurchaseOrdersFromSuggestions(
  deps: {
    authorize: () => Promise<DraftPoActor>
    db: MrpPurchaseDraftDb
    now?: () => Date
    /** 채번 잠금(테스트 주입). 운영 기본값 pgAdvisoryXactLock */
    lock?: (tx: any, key: string) => Promise<void>
  },
  input: DraftPoInput
): Promise<DraftPoResult> {
  // 권한 실패(throw)는 DB 접근 전에 발생한다
  const actor = await deps.authorize()
  const tenantId = actor.tenantId
  const now = (deps.now ?? (() => new Date()))()

  const normalized = normalizeDraftPoInput(input)
  if (!normalized.ok) return fail("INVALID_INPUT")
  const { lines, groupDates } = normalized
  const year = Number(toDateOnly(now).slice(0, 4))
  const orderDate = new Date(`${toDateOnly(now)}T00:00:00.000Z`)

  const run = () =>
    deps.db.$transaction(async (tx) => {
      // 1) 품목 소유 검증
      const itemIds = Array.from(new Set(lines.map((l) => l.itemId)))
      const items = await tx.item.findMany({
        where: { tenantId, id: { in: itemIds } },
        select: { id: true, code: true, name: true },
      })
      if (items.length !== itemIds.length) throw new DraftFailure("INVALID_REFERENCE")

      // 2) 공급업체: ACTIVE ItemSupplier 관계 + ACTIVE SUPPLIER/BOTH 거래처인 (품목, 공급업체) 쌍만 허용
      const policies = await loadSupplierPolicies(tx, tenantId, itemIds)
      const supplierName = new Map<string, string>()
      for (const l of lines) {
        const match = policies.get(l.itemId)?.suppliers.find((s) => s.supplierId === l.supplierId)
        if (!match) throw new DraftFailure("INVALID_REFERENCE")
        supplierName.set(l.supplierId, match.supplierName)
      }

      // 3) 사이트(tenant 소유)
      let site: { id: string } | null
      if (normalized.siteId) {
        site = await tx.site.findFirst({ where: { id: normalized.siteId, tenantId }, select: { id: true } })
        if (!site) throw new DraftFailure("INVALID_REFERENCE")
      } else {
        site = await tx.site.findFirst({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true } })
        if (!site) throw new DraftFailure("NO_SITE")
      }

      // 4) 단가(같은 공급업체) / 현재고(stockAtOrder) 일괄 조회
      const { prices } = await loadCurrentPurchasePrices(tx, tenantId, itemIds, Array.from(supplierName.keys()), now)
      const balances = await tx.inventoryBalance.findMany({
        where: { tenantId, itemId: { in: itemIds } },
        select: { itemId: true, qtyOnHand: true },
      })
      const stockByItem = new Map<string, number>()
      for (const b of balances) stockByItem.set(b.itemId, (stockByItem.get(b.itemId) ?? 0) + Number(b.qtyOnHand))
      const itemById = new Map(items.map((i) => [i.id, i]))

      // 5) 공급업체별 그룹 + 입고예정일/통화 확정
      type Group = { supplierId: string; lines: Merged[]; expectedDate: DateOnly; currency: string }
      const bySupplier = new Map<string, Merged[]>()
      for (const l of lines) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), l])
      const groups: Group[] = []
      const supplierIdsSorted = Array.from(bySupplier.keys()).sort((a, b) =>
        (supplierName.get(a) ?? a) < (supplierName.get(b) ?? b) ? -1 : (supplierName.get(a) ?? a) > (supplierName.get(b) ?? b) ? 1 : a < b ? -1 : 1
      )
      for (const supplierId of supplierIdsSorted) {
        const groupLines = (bySupplier.get(supplierId) ?? []).sort((a, b) => {
          const ca = itemById.get(a.itemId)?.code ?? a.itemId
          const cb = itemById.get(b.itemId)?.code ?? b.itemId
          return ca < cb ? -1 : ca > cb ? 1 : 0
        })
        let expected: DateOnly | null = groupDates.get(supplierId) ?? null
        if (expected === null) {
          for (const l of groupLines) if (l.requiredDate !== null && (expected === null || l.requiredDate < expected)) expected = l.requiredDate
        }
        if (expected === null) throw new DraftFailure("MISSING_EXPECTED_DATE")
        const currencies = new Set<string>()
        for (const l of groupLines) {
          const p = prices.get(`${l.itemId}|${supplierId}`)
          if (p) currencies.add(p.currency)
        }
        if (currencies.size > 1) throw new DraftFailure("CURRENCY_MISMATCH")
        groups.push({ supplierId, lines: groupLines, expectedDate: expected, currency: currencies.size === 1 ? Array.from(currencies)[0] : "KRW" })
      }

      // 6) 발주번호 연속 확보(같은 트랜잭션) → 생성 → 감사
      const orderNos = await allocatePurchaseOrderNumbers(tx, tenantId, groups.length, { year, lock: deps.lock ?? pgAdvisoryXactLock })
      const created: DraftPoCreated[] = []
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]
        const orderNo = orderNos[i]
        const itemRows = g.lines.map((l) => {
          const price = prices.get(`${l.itemId}|${g.supplierId}`) ?? null
          return {
            itemId: l.itemId,
            qty: l.qty,
            unitPrice: price?.unitPrice ?? 0,
            stockAtOrder: stockByItem.get(l.itemId) ?? 0,
            note: price ? null : "단가 미등록(MRP 발주제안)",
            priced: price !== null,
          }
        })
        const unpricedCount = itemRows.filter((r) => !r.priced).length
        const totalQty = Math.round(itemRows.reduce((s, r) => s + r.qty, 0) * 1e6) / 1e6
        const totalAmount =
          unpricedCount === 0 ? Math.round(itemRows.reduce((s, r) => s + r.qty * r.unitPrice, 0) * 100) / 100 : null

        const po = await tx.purchaseOrder.create({
          data: {
            tenantId,
            siteId: site.id,
            supplierId: g.supplierId,
            orderNo,
            orderDate,
            expectedDate: new Date(`${g.expectedDate}T00:00:00.000Z`),
            status: "DRAFT",
            totalAmount,
            currency: g.currency,
            note: NOTE,
            items: {
              create: itemRows.map((r) => ({
                itemId: r.itemId,
                qty: r.qty,
                unitPrice: r.unitPrice,
                stockAtOrder: r.stockAtOrder,
                note: r.note,
              })),
            },
          },
        })
        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name ?? null,
            entityType: "PurchaseOrder",
            entityId: po.id,
            action: "CREATE",
            afterData: {
              source: "MRP_PURCHASE_SUGGESTION",
              orderNo,
              status: "DRAFT",
              siteId: site.id,
              supplierId: g.supplierId,
              expectedDate: g.expectedDate,
              itemCount: itemRows.length,
              totalQty,
              totalAmount,
              currency: g.currency,
              unpricedCount,
              items: itemRows.slice(0, 50).map((r) => ({ itemId: r.itemId, qty: r.qty, unitPrice: r.unitPrice, priced: r.priced })),
            } as Prisma.InputJsonValue,
            menuName: "MRP 발주제안",
          },
        })
        created.push({
          purchaseOrderId: po.id,
          orderNo,
          supplierId: g.supplierId,
          supplierName: supplierName.get(g.supplierId) ?? "",
          expectedDate: g.expectedDate,
          itemCount: itemRows.length,
          totalQty,
          totalAmount,
          currency: g.currency,
          unpricedCount,
        })
      }
      return { orders: created, siteId: site.id }
    })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return { success: true, data: await run() }
    } catch (e) {
      if (isDraftFailure(e)) return fail(e.code, e.detail)
      // (tenantId, orderNo) unique 충돌: 번호를 다시 확보해 재시도(전체 롤백됨)
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS - 1) continue
      console.error("[createDraftPurchaseOrdersFromSuggestions] failed:", e)
      return fail("FAILED")
    }
  }
  return fail("FAILED")
}
