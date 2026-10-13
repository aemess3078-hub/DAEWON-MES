/**
 * 품목별 공급업체 기준정보(ItemSupplier) 서비스 (DB 클라이언트 주입형)
 *
 * Phase 5A. MRP 계산에는 아직 사용하지 않는다(Phase 5B~5D 가 사용할 기준정보 API).
 *
 * 정책
 *  - tenantId 는 authorize() 가 돌려준 인증 사용자에서만 결정한다. 클라이언트 값은 받지 않는다.
 *  - itemId / supplierId / relationId 는 모두 현재 tenant 소유인지 서버에서 검증한다.
 *    타 tenant 이거나 존재하지 않으면 구분 없이 같은 일반 오류(INVALID_REFERENCE)를 반환하고 DB write 는 0건이다.
 *  - 공급업체 자격: BusinessPartner.partnerType ∈ {SUPPLIER, BOTH} 이고 status = ACTIVE.
 *    (CUSTOMER 전용 거래처는 등록 불가. 비활성 거래처는 신규 등록/활성화/기본 지정 불가 — 반품 화면과 동일한 ACTIVE 기준)
 *  - 품목당 ACTIVE Default 는 최대 1개. DB partial unique index + 같은 transaction 안에서 기존 Default 해제 후 지정(이중 방어).
 *  - 비활성화 시 isDefault 도 함께 해제한다(비활성 관계는 Default 를 유지하지 않는다). 재활성화해도 Default 로 복원하지 않는다.
 *  - 숫자: priority 정수 0..9999(기본 100, 작을수록 우선) / leadTimeDays 정수 0..3650 또는 null /
 *    moq·orderMultiple > 0 또는 null(0 으로 "미설정"을 표현하지 않는다).
 *  - 가격은 저장하지 않는다. 현재 유효 구매단가는 ItemPrice(PURCHASE)에서 읽기 전용으로만 조회한다.
 *  - 물리 삭제는 PO/이력과 FK 가 없으므로 가능하지만 ITEM DELETE 권한이 필요하다(비활성화 권장).
 */

import type { Prisma, PrismaClient } from "@prisma/client"

export type ItemSupplierDb = Pick<
  PrismaClient,
  "item" | "businessPartner" | "itemSupplier" | "itemPrice" | "auditLog" | "$transaction"
>
type Tx = Prisma.TransactionClient

export type ItemSupplierActor = { id: string; name?: string | null; tenantId: string }

// ─── 정책 상수 / 메시지 ──────────────────────────────────────────────────────────

export const ITEM_SUPPLIER_DEFAULT_PRIORITY = 100
export const ITEM_SUPPLIER_MAX_PRIORITY = 9999
export const ITEM_SUPPLIER_MAX_LEAD_TIME_DAYS = 3650
const MAX_DECIMAL_VALUE = 1_000_000_000_000 // Decimal(18,6) 안전 상한(미만)
export const SUPPLIER_CANDIDATE_LIMIT = 20
export const MAX_POLICY_ITEM_IDS = 10_000

export type ItemSupplierErrorCode =
  | "INVALID_INPUT"
  | "INVALID_REFERENCE"
  | "SUPPLIER_NOT_ELIGIBLE"
  | "SUPPLIER_INACTIVE"
  | "DUPLICATE_SUPPLIER"
  | "CONFLICT"
  | "FAILED"

export const ITEM_SUPPLIER_ERROR_MESSAGES: Record<ItemSupplierErrorCode, string> = {
  INVALID_INPUT: "입력값이 올바르지 않습니다.",
  INVALID_REFERENCE: "유효하지 않은 참조입니다.",
  SUPPLIER_NOT_ELIGIBLE: "공급업체로 등록할 수 없는 거래처입니다. 거래처 유형이 공급업체(또는 고객·공급업체)여야 합니다.",
  SUPPLIER_INACTIVE: "비활성 상태의 거래처는 사용할 수 없습니다.",
  DUPLICATE_SUPPLIER: "이미 등록된 공급업체입니다.",
  CONFLICT: "다른 사용자가 동시에 변경했습니다. 새로고침 후 다시 시도해 주세요.",
  FAILED: "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
}

export type ItemSupplierResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; code: ItemSupplierErrorCode; error: string }

function fail(code: ItemSupplierErrorCode): { success: false; code: ItemSupplierErrorCode; error: string } {
  return { success: false, code, error: ITEM_SUPPLIER_ERROR_MESSAGES[code] }
}

// ES5 target 에서는 Error 하위 클래스의 instanceof 가 깨지므로 표식 속성으로 판별한다.
class ItemSupplierFailure extends Error {
  readonly isItemSupplierFailure = true
  constructor(readonly code: ItemSupplierErrorCode) {
    super(code)
    Object.setPrototypeOf(this, ItemSupplierFailure.prototype)
  }
}

function isItemSupplierFailure(e: unknown): e is ItemSupplierFailure {
  return typeof e === "object" && e !== null && (e as { isItemSupplierFailure?: boolean }).isItemSupplierFailure === true
}

const MENU_NAME = "품목 공급업체"

// ─── 입력 검증 (순수) ───────────────────────────────────────────────────────────

export type ItemSupplierInput = {
  supplierId: string
  isDefault?: boolean
  priority?: number | null
  leadTimeDays?: number | null
  moq?: number | null
  orderMultiple?: number | null
}

export type ItemSupplierPatch = {
  isDefault?: boolean
  priority?: number
  leadTimeDays?: number | null
  moq?: number | null
  orderMultiple?: number | null
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

export function isValidPriority(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= ITEM_SUPPLIER_MAX_PRIORITY
}

export function isValidLeadTimeDays(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= ITEM_SUPPLIER_MAX_LEAD_TIME_DAYS
}

/** > 0, 소수 6자리 이하, 상한 미만. null(미설정)은 호출부에서 먼저 처리한다. */
export function isValidPositiveDecimal(v: unknown): v is number {
  if (!isFiniteNumber(v) || !(v > 0) || !(v < MAX_DECIMAL_VALUE)) return false
  return Number(v.toFixed(6)) === v
}

type Normalized = {
  priority?: number
  leadTimeDays?: number | null
  moq?: number | null
  orderMultiple?: number | null
}

/** undefined = 변경 없음/기본값, null = 미설정(비움). 올바르지 않으면 null 반환. */
function normalizeNumbers(src: ItemSupplierPatch | ItemSupplierInput): Normalized | null {
  const out: Normalized = {}
  if (src.priority !== undefined && src.priority !== null) {
    if (!isValidPriority(src.priority)) return null
    out.priority = src.priority
  }
  if (src.leadTimeDays !== undefined) {
    if (src.leadTimeDays === null) out.leadTimeDays = null
    else if (isValidLeadTimeDays(src.leadTimeDays)) out.leadTimeDays = src.leadTimeDays
    else return null
  }
  if (src.moq !== undefined) {
    if (src.moq === null) out.moq = null
    else if (isValidPositiveDecimal(src.moq)) out.moq = src.moq
    else return null
  }
  if (src.orderMultiple !== undefined) {
    if (src.orderMultiple === null) out.orderMultiple = null
    else if (isValidPositiveDecimal(src.orderMultiple)) out.orderMultiple = src.orderMultiple
    else return null
  }
  return out
}

// ─── 조회용 타입 ────────────────────────────────────────────────────────────────

export type ItemSupplierPrice = { unitPrice: number; currency: string; effectiveFrom: string }

export type ItemSupplierView = {
  id: string
  itemId: string
  supplierId: string
  supplierCode: string
  supplierName: string
  supplierStatus: "ACTIVE" | "INACTIVE"
  supplierType: "CUSTOMER" | "SUPPLIER" | "BOTH"
  isDefault: boolean
  priority: number
  leadTimeDays: number | null
  moq: number | null
  orderMultiple: number | null
  isActive: boolean
  /** 현재 유효한 구매단가(읽기 전용, ItemPrice PURCHASE). 조회 권한이 없거나 없으면 null */
  currentPrice: ItemSupplierPrice | null
}

export type SupplierCandidate = {
  id: string
  code: string
  name: string
  partnerType: "SUPPLIER" | "BOTH"
}

/** Phase 5B~5D(MRP)가 사용하는 공급업체 정책 */
export type SupplierPolicyOption = {
  relationId: string
  supplierId: string
  supplierCode: string
  supplierName: string
  isDefault: boolean
  priority: number
  leadTimeDays: number | null
  moq: number | null
  orderMultiple: number | null
}

export type ItemSupplierPolicy = {
  itemId: string
  defaultSupplier: SupplierPolicyOption | null
  /** ACTIVE 후보 전체(기본 우선 → priority 오름차순 → 공급업체 코드) */
  suppliers: SupplierPolicyOption[]
}

const ELIGIBLE_TYPES = ["SUPPLIER", "BOTH"] as const

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toDateOnlyString(d: Date): string {
  return new Date(d).toISOString().slice(0, 10)
}

function auditSnapshot(r: {
  itemId: string
  supplierId: string
  isDefault: boolean
  priority: number
  leadTimeDays: number | null
  moq: unknown
  orderMultiple: unknown
  isActive: boolean
}) {
  return {
    itemId: r.itemId,
    supplierId: r.supplierId,
    isDefault: r.isDefault,
    priority: r.priority,
    leadTimeDays: r.leadTimeDays,
    moq: toNumberOrNull(r.moq),
    orderMultiple: toNumberOrNull(r.orderMultiple),
    isActive: r.isActive,
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
}

// ─── 공통 헬퍼 ──────────────────────────────────────────────────────────────────

async function requireOwnedItem(db: Pick<Tx, "item">, tenantId: string, itemId: unknown) {
  if (typeof itemId !== "string" || itemId.length === 0) throw new ItemSupplierFailure("INVALID_REFERENCE")
  const item = await db.item.findFirst({ where: { id: itemId, tenantId }, select: { id: true } })
  if (!item) throw new ItemSupplierFailure("INVALID_REFERENCE")
  return item
}

/** 타 tenant/없음 → INVALID_REFERENCE, CUSTOMER 전용 → SUPPLIER_NOT_ELIGIBLE, INACTIVE → SUPPLIER_INACTIVE */
async function requireEligibleSupplier(db: Pick<Tx, "businessPartner">, tenantId: string, supplierId: unknown) {
  if (typeof supplierId !== "string" || supplierId.length === 0) throw new ItemSupplierFailure("INVALID_REFERENCE")
  const partner = await db.businessPartner.findFirst({
    where: { id: supplierId, tenantId },
    select: { id: true, partnerType: true, status: true },
  })
  if (!partner) throw new ItemSupplierFailure("INVALID_REFERENCE")
  if (!(ELIGIBLE_TYPES as readonly string[]).includes(partner.partnerType)) {
    throw new ItemSupplierFailure("SUPPLIER_NOT_ELIGIBLE")
  }
  if (partner.status !== "ACTIVE") throw new ItemSupplierFailure("SUPPLIER_INACTIVE")
  return partner
}

async function requireOwnedRelation(db: Pick<Tx, "itemSupplier">, tenantId: string, id: unknown) {
  if (typeof id !== "string" || id.length === 0) throw new ItemSupplierFailure("INVALID_REFERENCE")
  const row = await db.itemSupplier.findFirst({ where: { id, tenantId } })
  if (!row) throw new ItemSupplierFailure("INVALID_REFERENCE")
  return row
}

async function writeAudit(
  tx: Pick<Tx, "auditLog">,
  actor: ItemSupplierActor,
  entityId: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  beforeData: unknown,
  afterData: unknown
) {
  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.id,
      actorLabel: actor.name ?? null,
      entityType: "ItemSupplier",
      entityId,
      action,
      ...(beforeData !== undefined ? { beforeData: beforeData as Prisma.InputJsonValue } : {}),
      ...(afterData !== undefined ? { afterData: afterData as Prisma.InputJsonValue } : {}),
      menuName: MENU_NAME,
    },
  })
}

async function run<T>(op: () => Promise<T>): Promise<ItemSupplierResult<T>> {
  try {
    return { success: true, data: await op() }
  } catch (e) {
    if (isItemSupplierFailure(e)) return fail(e.code)
    if (isUniqueViolation(e)) {
      // 동시 요청이 (item, supplier) 유일 제약 또는 Default 유일 제약과 충돌
      return fail("CONFLICT")
    }
    console.error("[item-supplier] failed:", e)
    return fail("FAILED")
  }
}

/** 같은 품목의 다른 ACTIVE Default 를 모두 해제한다(같은 transaction 안에서 호출). */
async function clearOtherDefaults(tx: Pick<Tx, "itemSupplier">, tenantId: string, itemId: string, exceptId?: string) {
  await tx.itemSupplier.updateMany({
    where: { tenantId, itemId, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isDefault: false },
  })
}

// ─── 조회 ───────────────────────────────────────────────────────────────────────

type ReadDeps = {
  authorize: () => Promise<{ tenantId: string }>
  db: ItemSupplierDb
}

/** 품목의 공급업체 관계 목록(비활성 포함). 쿼리: item 1 + itemSupplier 1 (+ itemPrice 1, includePrices 일 때) */
export async function listItemSuppliers(
  deps: ReadDeps & { includePrices?: boolean; now?: () => Date },
  itemId: string
): Promise<ItemSupplierResult<ItemSupplierView[]>> {
  const { tenantId } = await deps.authorize()
  const { db } = deps
  return run(async () => {
    await requireOwnedItem(db, tenantId, itemId)
    const rows = await db.itemSupplier.findMany({
      where: { tenantId, itemId },
      include: { supplier: { select: { id: true, code: true, name: true, partnerType: true, status: true } } },
    })

    const prices = new Map<string, ItemSupplierPrice>()
    if (deps.includePrices && rows.length > 0) {
      const now = (deps.now ?? (() => new Date()))()
      const priceRows = await db.itemPrice.findMany({
        where: {
          tenantId,
          itemId,
          priceType: "PURCHASE",
          partnerId: { in: rows.map((r) => r.supplierId) },
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
        orderBy: { effectiveFrom: "desc" },
      })
      for (const p of priceRows) {
        if (!prices.has(p.partnerId)) {
          prices.set(p.partnerId, {
            unitPrice: Number(p.unitPrice),
            currency: p.currency,
            effectiveFrom: toDateOnlyString(p.effectiveFrom),
          })
        }
      }
    }

    const views: ItemSupplierView[] = rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      supplierId: r.supplierId,
      supplierCode: r.supplier.code,
      supplierName: r.supplier.name,
      supplierStatus: r.supplier.status as ItemSupplierView["supplierStatus"],
      supplierType: r.supplier.partnerType as ItemSupplierView["supplierType"],
      isDefault: r.isDefault,
      priority: r.priority,
      leadTimeDays: r.leadTimeDays,
      moq: toNumberOrNull(r.moq),
      orderMultiple: toNumberOrNull(r.orderMultiple),
      isActive: r.isActive,
      currentPrice: prices.get(r.supplierId) ?? null,
    }))
    views.sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.priority - b.priority ||
        a.supplierCode.localeCompare(b.supplierCode)
    )
    return views
  })
}

/** 공급업체 선택 후보: 현재 tenant 의 ACTIVE SUPPLIER/BOTH 중 이 품목에 아직 없는 것(최대 20건, 코드/이름 검색) */
export async function searchSupplierCandidates(
  deps: ReadDeps,
  itemId: string,
  query: string
): Promise<ItemSupplierResult<SupplierCandidate[]>> {
  const { tenantId } = await deps.authorize()
  const { db } = deps
  return run(async () => {
    await requireOwnedItem(db, tenantId, itemId)
    const q = typeof query === "string" ? query.trim().slice(0, 100) : ""
    const registered = await db.itemSupplier.findMany({
      where: { tenantId, itemId },
      select: { supplierId: true },
    })
    const rows = await db.businessPartner.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        partnerType: { in: [...ELIGIBLE_TYPES] },
        ...(registered.length > 0 ? { id: { notIn: registered.map((r) => r.supplierId) } } : {}),
        ...(q
          ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }
          : {}),
      },
      select: { id: true, code: true, name: true, partnerType: true },
      orderBy: { name: "asc" },
      take: SUPPLIER_CANDIDATE_LIMIT,
    })
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      partnerType: r.partnerType as SupplierCandidate["partnerType"],
    }))
  })
}

// ─── 변경 ───────────────────────────────────────────────────────────────────────

type MutateDeps = {
  authorize: () => Promise<ItemSupplierActor>
  db: ItemSupplierDb
}

export async function createItemSupplier(
  deps: MutateDeps,
  itemId: string,
  input: ItemSupplierInput
): Promise<ItemSupplierResult<{ id: string }>> {
  // 권한 실패(throw)는 DB 접근 전에 발생한다
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  const numbers = normalizeNumbers(input ?? ({} as ItemSupplierInput))
  if (!numbers) return fail("INVALID_INPUT")
  if (input?.isDefault !== undefined && typeof input.isDefault !== "boolean") return fail("INVALID_INPUT")

  return run(() =>
    db.$transaction(async (tx) => {
      await requireOwnedItem(tx, tenantId, itemId)
      const supplier = await requireEligibleSupplier(tx, tenantId, input.supplierId)

      const dup = await tx.itemSupplier.findFirst({
        where: { tenantId, itemId, supplierId: supplier.id },
        select: { id: true },
      })
      if (dup) throw new ItemSupplierFailure("DUPLICATE_SUPPLIER")

      const wantDefault = input.isDefault === true
      if (wantDefault) await clearOtherDefaults(tx, tenantId, itemId)

      const data = {
        tenantId,
        itemId,
        supplierId: supplier.id,
        isDefault: wantDefault,
        isActive: true,
        priority: numbers.priority ?? ITEM_SUPPLIER_DEFAULT_PRIORITY,
        leadTimeDays: numbers.leadTimeDays ?? null,
        moq: numbers.moq ?? null,
        orderMultiple: numbers.orderMultiple ?? null,
      }
      const created = await tx.itemSupplier.create({ data })
      await writeAudit(tx, actor, created.id, "CREATE", undefined, auditSnapshot(data))
      return { id: created.id }
    })
  )
}

export async function updateItemSupplier(
  deps: MutateDeps,
  relationId: string,
  patch: ItemSupplierPatch
): Promise<ItemSupplierResult<undefined>> {
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  const numbers = normalizeNumbers(patch ?? {})
  if (!numbers) return fail("INVALID_INPUT")
  if (patch?.isDefault !== undefined && typeof patch.isDefault !== "boolean") return fail("INVALID_INPUT")

  return run(() =>
    db.$transaction(async (tx) => {
      const current = await requireOwnedRelation(tx, tenantId, relationId)

      const data: Record<string, unknown> = {}
      if (numbers.priority !== undefined) data.priority = numbers.priority
      if (numbers.leadTimeDays !== undefined) data.leadTimeDays = numbers.leadTimeDays
      if (numbers.moq !== undefined) data.moq = numbers.moq
      if (numbers.orderMultiple !== undefined) data.orderMultiple = numbers.orderMultiple

      if (patch.isDefault === true) {
        // 비활성 관계 / 비활성·부적격 거래처는 기본 공급업체가 될 수 없다
        if (!current.isActive) throw new ItemSupplierFailure("SUPPLIER_INACTIVE")
        await requireEligibleSupplier(tx, tenantId, current.supplierId)
        await clearOtherDefaults(tx, tenantId, current.itemId, current.id)
        data.isDefault = true
      } else if (patch.isDefault === false) {
        data.isDefault = false
      }

      if (Object.keys(data).length === 0) return undefined
      const result = await tx.itemSupplier.updateMany({ where: { id: current.id, tenantId }, data })
      if (result.count !== 1) throw new ItemSupplierFailure("INVALID_REFERENCE")

      await writeAudit(tx, actor, current.id, "UPDATE", auditSnapshot(current), auditSnapshot({ ...current, ...data } as typeof current))
      return undefined
    })
  )
}

/** 기본 공급업체 지정(기존 Default 는 같은 transaction 에서 해제) */
export async function setDefaultItemSupplier(deps: MutateDeps, relationId: string) {
  return updateItemSupplier(deps, relationId, { isDefault: true })
}

/** 활성/비활성 전환. 비활성화하면 Default 도 함께 해제한다. */
export async function setItemSupplierActive(
  deps: MutateDeps,
  relationId: string,
  isActive: boolean
): Promise<ItemSupplierResult<undefined>> {
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId
  if (typeof isActive !== "boolean") return fail("INVALID_INPUT")

  return run(() =>
    db.$transaction(async (tx) => {
      const current = await requireOwnedRelation(tx, tenantId, relationId)
      if (current.isActive === isActive) return undefined

      if (isActive) await requireEligibleSupplier(tx, tenantId, current.supplierId)
      const data = isActive ? { isActive: true } : { isActive: false, isDefault: false }
      const result = await tx.itemSupplier.updateMany({ where: { id: current.id, tenantId }, data })
      if (result.count !== 1) throw new ItemSupplierFailure("INVALID_REFERENCE")

      await writeAudit(tx, actor, current.id, "UPDATE", auditSnapshot(current), auditSnapshot({ ...current, ...data }))
      return undefined
    })
  )
}

/** 물리 삭제. 이력 FK 가 없어 가능하지만 비활성화를 권장한다(권한: ITEM DELETE — 액션에서 검증). */
export async function removeItemSupplier(deps: MutateDeps, relationId: string): Promise<ItemSupplierResult<undefined>> {
  const actor = await deps.authorize()
  const { db } = deps
  const tenantId = actor.tenantId

  return run(() =>
    db.$transaction(async (tx) => {
      const current = await requireOwnedRelation(tx, tenantId, relationId)
      const result = await tx.itemSupplier.deleteMany({ where: { id: current.id, tenantId } })
      if (result.count !== 1) throw new ItemSupplierFailure("INVALID_REFERENCE")
      await writeAudit(tx, actor, current.id, "DELETE", auditSnapshot(current), undefined)
      return undefined
    })
  )
}

// ─── MRP(Phase 5B~5D)용 Batch 조회 ───────────────────────────────────────────────

/**
 * 여러 품목의 공급업체 정책을 쿼리 1회로 조회한다(품목 수와 무관, N+1 없음).
 * 호출자가 이미 인증/tenant 를 확정한 경우 사용한다. ACTIVE 관계 + ACTIVE SUPPLIER/BOTH 거래처만 반환한다.
 * 관계가 없는 품목도 빈 정책({ defaultSupplier: null, suppliers: [] })으로 포함한다.
 */
export async function loadSupplierPolicies(
  db: Pick<ItemSupplierDb, "itemSupplier">,
  tenantId: string,
  itemIds: readonly string[]
): Promise<Map<string, ItemSupplierPolicy>> {
  const ids = Array.from(new Set(itemIds.filter((v) => typeof v === "string" && v.length > 0)))
  if (ids.length > MAX_POLICY_ITEM_IDS) throw new Error("TOO_MANY_ITEMS")
  const result = new Map<string, ItemSupplierPolicy>()
  for (const id of ids) result.set(id, { itemId: id, defaultSupplier: null, suppliers: [] })
  if (ids.length === 0) return result

  const rows = await db.itemSupplier.findMany({
    where: {
      tenantId,
      itemId: { in: ids },
      isActive: true,
      supplier: { tenantId, status: "ACTIVE", partnerType: { in: [...ELIGIBLE_TYPES] } },
    },
    include: { supplier: { select: { code: true, name: true } } },
  })

  for (const r of rows) {
    const policy = result.get(r.itemId)
    if (!policy) continue
    policy.suppliers.push({
      relationId: r.id,
      supplierId: r.supplierId,
      supplierCode: r.supplier.code,
      supplierName: r.supplier.name,
      isDefault: r.isDefault,
      priority: r.priority,
      leadTimeDays: r.leadTimeDays,
      moq: toNumberOrNull(r.moq),
      orderMultiple: toNumberOrNull(r.orderMultiple),
    })
  }
  for (const policy of Array.from(result.values())) {
    policy.suppliers.sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.priority - b.priority ||
        a.supplierCode.localeCompare(b.supplierCode)
    )
    policy.defaultSupplier = policy.suppliers.find((s) => s.isDefault) ?? null
  }
  return result
}

/** 인증을 포함한 Batch 조회(액션/서비스용). 권한 판단은 authorize 에서 한다. */
export async function getSupplierPoliciesForItems(
  deps: ReadDeps,
  itemIds: readonly string[]
): Promise<ItemSupplierResult<ItemSupplierPolicy[]>> {
  const { tenantId } = await deps.authorize()
  return run(async () => {
    const map = await loadSupplierPolicies(deps.db, tenantId, itemIds)
    return Array.from(map.values())
  })
}

/** 품목별 기본 공급업체만 필요한 경우(미지정 품목은 null) */
export async function getDefaultSuppliersForItems(
  db: Pick<ItemSupplierDb, "itemSupplier">,
  tenantId: string,
  itemIds: readonly string[]
): Promise<Map<string, SupplierPolicyOption | null>> {
  const policies = await loadSupplierPolicies(db, tenantId, itemIds)
  const out = new Map<string, SupplierPolicyOption | null>()
  policies.forEach((p, itemId) => out.set(itemId, p.defaultSupplier))
  return out
}
