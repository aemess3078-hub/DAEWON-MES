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
 *
 * Phase 5D
 *  - MOQ / 발주배수는 서버가 ItemSupplier 에서 다시 읽어 최종 발주수량을 재검증한다(클라이언트가 보낸 조건은 없음).
 *    수량 < MOQ 이거나 발주배수의 배수가 아니면 DRAFT 를 만들지 않는다(예외 승인 기능 없음).
 *  - 리드타임은 헤더 입고예정일을 바꾸지 않는다(입고예정일 = 목표 입고일). 리드타임은 "언제 발주해야 하는가"만 계산하며
 *    감사로그에 라인별 발주 필요일을 남기고, 발주 필요일이 지난 건수는 결과에 알린다(생성은 막지 않는다).
 *
 * Phase 6 (deps.history 가 주입된 경우 — 서버 액션은 항상 주입한다)
 *  - 중복 발주 방지: 생성 직전, 같은 트랜잭션에서 활성 DRAFT 미입고 합계(Coverage)를 다시 읽는다. 클라이언트가 보낸 값은 쓰지 않는다.
 *    정책 필요량(raw) − Coverage ≤ 0 이면(기존 DRAFT 로 충족) 생성하지 않는다. 같은 실행(run)에서 이미 만든 (품목, 공급업체)
 *    재생성도 막는다. 의도적인 추가 발주는 품목별 사유(coverageOverrides)가 있어야 하며 감사로그에 남는다.
 *  - 동시성: tenant 단위 transaction advisory lock 으로 "Coverage 읽기 → 발주 생성"을 직렬화한다(동시 10건 → 1건만 생성).
 *  - 멱등성: requestKey. 같은 (tenant, requestKey) + **같은 의미의 요청**(정규화한 라인/공급업체별 입고예정일/사이트/근거/override 사유의
 *    결정적 sha256 = requestHash)이면 새로 만들지 않고 처음 결과를 돌려준다(replayed=true).
 *    같은 키에 **다른 요청**이면 replay 하지 않고 IDEMPOTENCY_KEY_REUSE_MISMATCH 로 거부한다(쓰기 0).
 *    requestHash 는 MrpRunPurchase.result(삽입 시 기록, 불변)에 저장한다 — 별도 컬럼/migration 없음.
 *  - 근거: runId(이미 저장한 실행이력) 또는 mrp 파라미터(생성 시점에 서버가 계산해 Snapshot 을 같은 트랜잭션에서 저장).
 *    MrpRunPurchase 가 (실행, 발주, 라인 근거, override)를 연결한다. DRAFT PO 는 입고예정/재고가 아니다.
 */

import type { Prisma, PrismaClient } from "@prisma/client"
import { isDateOnly, toDateOnly } from "../mrp/period"
import { computeOrderByDate, daysBetween, describeTermsViolation, validateQtyAgainstTerms } from "../mrp/purchase-policy"
import type { DateOnly } from "../mrp/types"
import { evaluateCoverage } from "../mrp/draft-coverage"
import { canonicalJson, isSnapshotTooLarge, sha256Hex, type BuiltMrpRun } from "../mrp/mrp-run-snapshot"
import { loadSupplierPolicies } from "./item-supplier.service"
import { loadCurrentPurchasePrices, loadDraftCoverage } from "./mrp-loaders"
import { normalizeOrderMrpParams } from "./mrp-order.service"
import { isValidRequestKey, MRP_RUN_TX_OPTIONS, persistMrpRun } from "./mrp-run.service"
import { allocatePurchaseOrderNumbers, pgAdvisoryXactLock } from "./purchase-order-number.service"

export type MrpPurchaseDraftDb = Pick<
  PrismaClient,
  | "item"
  | "itemSupplier"
  | "itemPrice"
  | "inventoryBalance"
  | "site"
  | "purchaseOrder"
  | "purchaseOrderItem"
  | "mrpRun"
  | "mrpRunSuggestion"
  | "mrpRunPurchase"
  | "auditLog"
  | "$transaction"
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
  /** (Phase 6) 요청 단위 멱등 키 — 화면이 "생성" 동작마다 1개 만들고 재시도에 재사용한다 */
  requestKey?: string | null
  /** (Phase 6) 이미 저장한 실행이력에서 생성 */
  runId?: string | null
  /** (Phase 6) runId 가 없을 때 생성 시점에 서버가 MRP 를 계산해 Snapshot 으로 저장할 기준 파라미터 */
  mrp?: { from?: string | null; to?: string | null; includeDraft?: boolean } | null
  /** (Phase 6) itemId → 기존 DRAFT 가 충족한 필요량을 알면서도 추가 발주하는 사유(필수, 감사 기록) */
  coverageOverrides?: Record<string, string | null | undefined> | null
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
  /** 표준 리드타임 기준 발주 필요일이 이미 지난 라인 수(생성은 허용 — 납기협의/긴급조달 필요) */
  leadTimeOverdueLineCount: number
  /** 리드타임이 등록되지 않아 발주 필요일을 계산하지 못한 라인 수 */
  leadTimeMissingLineCount: number
}

export type DraftPoErrorCode =
  | "INVALID_INPUT"
  | "INVALID_REFERENCE"
  | "MISSING_EXPECTED_DATE"
  | "CURRENCY_MISMATCH"
  | "SUPPLIER_TERMS_VIOLATION"
  | "NO_SITE"
  | "DUPLICATE_DRAFT"
  | "DUPLICATE_RUN_LINE"
  | "OVERRIDE_REASON_REQUIRED"
  | "RUN_NOT_FOUND"
  | "IDEMPOTENCY_KEY_REUSE_MISMATCH"
  | "SNAPSHOT_FAILED"
  | "FAILED"

export const DRAFT_PO_ERROR_MESSAGES: Record<DraftPoErrorCode, string> = {
  INVALID_INPUT: "발주 수량 또는 입력값이 올바르지 않습니다.",
  INVALID_REFERENCE: "유효하지 않은 참조가 포함되어 있습니다. 품목관리 > 공급업체 관리에서 공급업체 등록 상태를 확인해 주세요.",
  MISSING_EXPECTED_DATE: "입고예정일을 확인할 수 없는 공급업체가 있습니다. 목표 입고일을 입력해 주세요.",
  CURRENCY_MISMATCH: "한 공급업체 발주에 서로 다른 통화의 단가가 섞여 있습니다. 통화별로 나누어 생성해 주세요.",
  SUPPLIER_TERMS_VIOLATION: "공급업체 구매조건(MOQ/발주배수)을 만족하지 않는 수량이 있습니다.",
  NO_SITE: "등록된 공장(사이트)이 없습니다.",
  DUPLICATE_DRAFT: "기존 DRAFT 발주로 이미 충족된 품목이 포함되어 있습니다. 의도적인 추가 발주라면 사유를 입력해 주세요.",
  DUPLICATE_RUN_LINE: "같은 MRP 실행에서 이미 발주를 생성한 품목·공급업체가 포함되어 있습니다. 의도적인 추가 발주라면 사유를 입력해 주세요.",
  OVERRIDE_REASON_REQUIRED: "추가 발주 사유를 입력해 주세요.",
  RUN_NOT_FOUND: "MRP 실행이력을 찾을 수 없습니다.",
  IDEMPOTENCY_KEY_REUSE_MISMATCH:
    "같은 요청 키로 이미 다른 내용의 요청이 처리되었습니다. 화면을 새로고침한 뒤 구매발주 목록을 확인하고 다시 시도해 주세요.",
  SNAPSHOT_FAILED: "MRP 실행 Snapshot 을 만들지 못했습니다. 조회 기간을 줄이거나 잠시 후 다시 시도해 주세요.",
  FAILED: "발주 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
}

export type DraftPoResult =
  | {
      success: true
      data: {
        orders: DraftPoCreated[]
        siteId: string
        /** (Phase 6) 이 발주들의 근거 MRP 실행이력 */
        runId?: string | null
        /** (Phase 6) 같은 requestKey 의 재전송이라 새로 만들지 않고 처음 결과를 돌려준 경우 */
        replayed?: boolean
        /** (Phase 6) 기존 DRAFT/같은 실행 중복을 사유와 함께 우회한 품목 수 */
        overrideCount?: number
      }
    }
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

export const MAX_OVERRIDE_REASON_LENGTH = 200

export type NormalizedHistoryInput = {
  requestKey: string | null
  runId: string | null
  mrp: { from: string | null; to: string | null; includeDraft: boolean } | null
  overrides: Map<string, string>
}

/** 입력 정규화(순수): 검증 + 같은 (품목, 공급업체) 중복 병합(수량 합산, 필요일은 가장 빠른 값) */
export function normalizeDraftPoInput(input: unknown):
  | { ok: true; lines: Merged[]; groupDates: Map<string, DateOnly>; siteId: string | null; history: NormalizedHistoryInput }
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

  // Phase 6 입력(요청 단위 멱등 키 / 근거 실행 / 추가 발주 사유). 값 자체의 유효성만 여기서 본다.
  let requestKey: string | null = null
  if (raw.requestKey !== undefined && raw.requestKey !== null) {
    if (!isValidRequestKey(raw.requestKey)) return { ok: false }
    requestKey = raw.requestKey
  }
  let runId: string | null = null
  if (raw.runId !== undefined && raw.runId !== null) {
    if (typeof raw.runId !== "string" || raw.runId.length === 0 || raw.runId.length > 100) return { ok: false }
    runId = raw.runId
  }
  let mrp: NormalizedHistoryInput["mrp"] = null
  if (raw.mrp !== undefined && raw.mrp !== null) {
    try {
      const n = normalizeOrderMrpParams(raw.mrp)
      mrp = { from: n.from, to: n.to, includeDraft: n.includeDraft }
    } catch {
      return { ok: false }
    }
  }
  const overrides = new Map<string, string>()
  if (raw.coverageOverrides !== undefined && raw.coverageOverrides !== null) {
    if (typeof raw.coverageOverrides !== "object") return { ok: false }
    for (const [itemId, reason] of Object.entries(raw.coverageOverrides)) {
      if (reason === undefined || reason === null) continue
      if (typeof reason !== "string") return { ok: false }
      const trimmed = reason.trim()
      if (trimmed.length > MAX_OVERRIDE_REASON_LENGTH) return { ok: false }
      overrides.set(itemId, trimmed)
    }
  }
  return { ok: true, lines: Array.from(merged.values()), groupDates, siteId, history: { requestKey, runId, mrp, overrides } }
}

/**
 * 요청의 "의미"를 나타내는 결정적 해시(순수). 요청 키, 시각, 난수는 포함하지 않는다.
 * 라인은 (품목, 공급업체) 병합·정렬 후, 공급업체별 입고예정일/사이트/근거/override 사유는 키 정렬 후 해시한다.
 */
export function computeDraftRequestHash(n: {
  lines: ReadonlyArray<{ itemId: string; supplierId: string; qty: number; requiredDate: string | null }>
  groupDates: ReadonlyMap<string, string>
  siteId: string | null
  history: NormalizedHistoryInput
}): string {
  const lines = n.lines
    .map((l) => ({ itemId: l.itemId, supplierId: l.supplierId, qty: l.qty, requiredDate: l.requiredDate }))
    .sort((a, b) => (a.itemId + "|" + a.supplierId < b.itemId + "|" + b.supplierId ? -1 : 1))
  const groupDates = Array.from(n.groupDates.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const overrides = Array.from(n.history.overrides.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return sha256Hex(
    canonicalJson({
      v: 1,
      lines,
      groupDates,
      siteId: n.siteId,
      runId: n.history.runId,
      mrp: n.history.mrp,
      overrides,
    })
  )
}

export async function createDraftPurchaseOrdersFromSuggestions(
  deps: {
    authorize: () => Promise<DraftPoActor>
    db: MrpPurchaseDraftDb
    now?: () => Date
    /** 채번/Coverage 잠금(테스트 주입). 운영 기본값 pgAdvisoryXactLock */
    lock?: (tx: any, key: string) => Promise<void>
    /**
     * (Phase 6) 중복 발주 방지 + 실행이력 연결을 켠다. 서버 액션은 항상 주입한다.
     * loadBuilt: 서버가 현재 MRP 를 계산해 Snapshot 을 만든다(runId 없이 생성할 때만 호출).
     */
    history?: {
      loadBuilt: (
        tenantId: string,
        params: { from: string | null; to: string | null; includeDraft: boolean },
        now: () => Date
      ) => Promise<BuiltMrpRun>
    }
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
  const history = deps.history ? normalized.history : null
  if (history) {
    // 서버 액션 경로: 멱등 키와 근거(실행이력 또는 MRP 파라미터)가 반드시 있어야 한다
    if (history.requestKey === null || (history.runId === null && history.mrp === null)) return fail("INVALID_INPUT")
  }
  const requestHash = history ? computeDraftRequestHash(normalized) : null
  const year = Number(toDateOnly(now).slice(0, 4))
  const today = toDateOnly(now)
  const orderDate = new Date(`${today}T00:00:00.000Z`)

  // (Phase 6) runId 없이 생성하는 경우: 트랜잭션 밖에서 서버가 현재 MRP 를 계산해 둔다(트랜잭션은 짧게 유지).
  //  - 계산 입력은 기간/DRAFT 수주 포함 여부뿐이며 결과는 클라이언트에서 받지 않는다.
  //  - Coverage 는 이 값과 무관하게 잠금 후 트랜잭션 안에서 다시 읽는다.
  let built: BuiltMrpRun | null = null
  if (deps.history && history && history.runId === null) {
    try {
      built = await deps.history.loadBuilt(tenantId, history.mrp!, deps.now ?? (() => new Date()))
    } catch (e) {
      if (!isSnapshotTooLarge(e)) console.error("[createDraftPurchaseOrdersFromSuggestions] snapshot build failed:", e)
      return fail("SNAPSHOT_FAILED")
    }
  }

  const run = () =>
    deps.db.$transaction(async (tx) => {
      const lock = deps.lock ?? pgAdvisoryXactLock
      if (history) {
        // tenant 단위 직렬화: "Coverage 읽기 → 발주 생성"이 동시에 겹치지 않게 한다(채번 잠금보다 먼저, 항상 같은 순서)
        await lock(tx, `MRP_DRAFT|${tenantId}`)
        // 멱등 재전송: 같은 requestKey 로 이미 만든 발주가 있으면 새로 만들지 않고 처음 결과를 돌려준다
        const prior = (await tx.mrpRunPurchase.findMany({
          where: { tenantId, requestKey: history.requestKey! },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })) as any[]
        if (prior.length > 0) {
          // 같은 키 + 다른 요청 → replay 금지(처음 결과를 조용히 돌려주면 이번 요청이 처리된 것으로 오해한다). 쓰기 0.
          const sameRequest = prior.every(
            (r) => typeof r.result === "object" && r.result !== null && (r.result as { requestHash?: string }).requestHash === requestHash
          )
          if (!sameRequest) throw new DraftFailure("IDEMPOTENCY_KEY_REUSE_MISMATCH")
          const priorOrders = prior.map((r) => r.result as DraftPoCreated & { siteId?: string; requestHash?: string })
          return {
            orders: priorOrders.map((o) => {
              const { siteId: _siteId, requestHash: _hash, ...rest } = o
              void _siteId
              void _hash
              return rest as DraftPoCreated
            }),
            siteId: priorOrders[0]?.siteId ?? "",
            runId: prior[0].runId as string,
            replayed: true,
            overrideCount: prior.filter((r) => r.overrideUsed === true).length,
          }
        }
        // 같은 키가 이미 "실행 저장"(발주 없음)에 쓰였다면 다른 동작에 키를 재사용한 것이다(Snapshot 저장 시 unique 충돌 방지)
        if (history.runId === null) {
          const usedRun = await tx.mrpRun.findFirst({ where: { tenantId, requestKey: history.requestKey! }, select: { id: true } })
          if (usedRun) throw new DraftFailure("IDEMPOTENCY_KEY_REUSE_MISMATCH")
        }
      }

      // 1) 품목 소유 검증
      const itemIds = Array.from(new Set(lines.map((l) => l.itemId)))
      const items = await tx.item.findMany({
        where: { tenantId, id: { in: itemIds } },
        select: { id: true, code: true, name: true, safetyStock: true },
      })
      if (items.length !== itemIds.length) throw new DraftFailure("INVALID_REFERENCE")
      const itemById = new Map(items.map((i) => [i.id, i]))

      // 2) 공급업체: ACTIVE ItemSupplier 관계 + ACTIVE SUPPLIER/BOTH 거래처인 (품목, 공급업체) 쌍만 허용
      const policies = await loadSupplierPolicies(tx, tenantId, itemIds)
      const supplierName = new Map<string, string>()
      const termsByPair = new Map<string, { moq: number | null; orderMultiple: number | null; leadTimeDays: number | null }>()
      const violations: string[] = []
      for (const l of lines) {
        const match = policies.get(l.itemId)?.suppliers.find((s) => s.supplierId === l.supplierId)
        if (!match) throw new DraftFailure("INVALID_REFERENCE")
        supplierName.set(l.supplierId, match.supplierName)
        // 구매조건은 서버가 읽은 ItemSupplier 가 기준이다(클라이언트 값 불신): 수량 ≥ MOQ, 발주배수의 배수
        const terms = { moq: match.moq, orderMultiple: match.orderMultiple, leadTimeDays: match.leadTimeDays }
        termsByPair.set(`${l.itemId}|${l.supplierId}`, terms)
        const v = validateQtyAgainstTerms(l.qty, terms)
        if (!v.ok) {
          const code = itemById.get(l.itemId)?.code ?? l.itemId
          violations.push(`${code}(${match.supplierName}): ${describeTermsViolation(v, l.qty)}`)
        }
      }
      if (violations.length > 0) {
        const shown = violations.slice(0, 3).join(" / ")
        throw new DraftFailure(
          "SUPPLIER_TERMS_VIOLATION",
          `${DRAFT_PO_ERROR_MESSAGES.SUPPLIER_TERMS_VIOLATION} ${shown}${violations.length > 3 ? ` 외 ${violations.length - 3}건` : ""}`
        )
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

      // 3-1) (Phase 6) 중복 발주 방지: 활성 DRAFT Coverage 를 잠금 안에서 다시 읽어 정책 필요량과 비교한다
      type LineGuard = {
        rawNeed: number
        coverageQty: number
        remainingRawNeed: number
        dupDraft: boolean
        dupRun: boolean
        overrideReason: string | null
      }
      const guardByPair = new Map<string, LineGuard>()
      let runIdForLinks: string | null = null
      if (history) {
        const rawNeedByItem = new Map<string, number>()
        const lineKeysOfRun = new Set<string>()
        if (history.runId !== null) {
          const runRow = await tx.mrpRun.findFirst({ where: { id: history.runId, tenantId }, select: { id: true } })
          if (!runRow) throw new DraftFailure("RUN_NOT_FOUND")
          runIdForLinks = runRow.id
          const suggestions = await tx.mrpRunSuggestion.findMany({
            where: { tenantId, runId: runRow.id, itemId: { in: itemIds } },
            select: { itemId: true, rawNeed: true },
          })
          for (const sg of suggestions) rawNeedByItem.set(sg.itemId, Number(sg.rawNeed))
          // 같은 실행에서 이미 만든 (품목, 공급업체) — 그 후 ORDERED 가 되어 Coverage 에서 빠져도 재생성을 막는다
          const prevLinks = (await tx.mrpRunPurchase.findMany({
            where: { tenantId, runId: runRow.id },
            select: { lines: true },
          })) as Array<{ lines: unknown }>
          for (const link of prevLinks) {
            if (!Array.isArray(link.lines)) continue
            for (const ln of link.lines as Array<{ itemId?: string; supplierId?: string }>) {
              if (ln && typeof ln.itemId === "string" && typeof ln.supplierId === "string") {
                lineKeysOfRun.add(`${ln.itemId}|${ln.supplierId}`)
              }
            }
          }
        } else if (built) {
          for (const r of built.suggestionRows) rawNeedByItem.set(r.itemId, r.rawNeed)
        }
        const coverage = await loadDraftCoverage(tx, tenantId, itemIds)
        const dupDraftItems: string[] = []
        const dupRunItems: string[] = []
        const reasonBlankItems: string[] = []
        for (const l of lines) {
          const pair = `${l.itemId}|${l.supplierId}`
          const code = itemById.get(l.itemId)?.code ?? l.itemId
          const rawNeed = rawNeedByItem.get(l.itemId) ?? 0
          const coverageQty = coverage.byItem.get(l.itemId)?.total ?? 0
          const ev = evaluateCoverage({ rawNeed, coverageQty, supplier: null })
          const dupDraft = ev.remainingRawNeed <= 0
          const dupRun = lineKeysOfRun.has(pair)
          let reason: string | null = null
          if (dupDraft || dupRun) {
            const given = history.overrides.get(l.itemId)
            if (given === undefined) {
              if (dupDraft) dupDraftItems.push(`${code}(필요 ${rawNeed} / 기존 DRAFT ${coverageQty})`)
              else dupRunItems.push(code)
            } else if (given === "") {
              reasonBlankItems.push(code)
            } else {
              reason = given
            }
          }
          guardByPair.set(pair, { rawNeed, coverageQty, remainingRawNeed: ev.remainingRawNeed, dupDraft, dupRun, overrideReason: reason })
        }
        if (reasonBlankItems.length > 0 || dupDraftItems.length > 0 || dupRunItems.length > 0) {
          const code: DraftPoErrorCode =
            reasonBlankItems.length > 0 ? "OVERRIDE_REASON_REQUIRED" : dupDraftItems.length > 0 ? "DUPLICATE_DRAFT" : "DUPLICATE_RUN_LINE"
          const all = reasonBlankItems.length > 0 ? reasonBlankItems : dupDraftItems.length > 0 ? dupDraftItems : dupRunItems
          const shown = all.slice(0, 3).join(", ")
          const more = all.length > 3 ? ` 외 ${all.length - 3}건` : ""
          throw new DraftFailure(code, `${DRAFT_PO_ERROR_MESSAGES[code]} ${shown}${more}`)
        }
        // 근거 Snapshot: runId 가 없으면 같은 트랜잭션에서 저장(발주와 근거가 함께 생기거나 함께 사라진다)
        if (runIdForLinks === null) {
          const saved = await persistMrpRun(tx, {
            tenantId,
            actor,
            built: built as BuiltMrpRun,
            requestKey: history.requestKey,
            source: "DRAFT_PO_CREATE",
          })
          runIdForLinks = saved.runId
        }
      }

      // 4) 단가(같은 공급업체) / 현재고(stockAtOrder) 일괄 조회
      const { prices } = await loadCurrentPurchasePrices(tx, tenantId, itemIds, Array.from(supplierName.keys()), now)
      const balances = await tx.inventoryBalance.findMany({
        where: { tenantId, itemId: { in: itemIds } },
        select: { itemId: true, qtyOnHand: true },
      })
      const stockByItem = new Map<string, number>()
      for (const b of balances) stockByItem.set(b.itemId, (stockByItem.get(b.itemId) ?? 0) + Number(b.qtyOnHand))

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
      const orderNos = await allocatePurchaseOrderNumbers(tx, tenantId, groups.length, { year, lock })
      const created: DraftPoCreated[] = []
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i]
        const orderNo = orderNos[i]
        const itemRows = g.lines.map((l) => {
          const price = prices.get(`${l.itemId}|${g.supplierId}`) ?? null
          const terms = termsByPair.get(`${l.itemId}|${g.supplierId}`)
          const target = l.requiredDate ?? g.expectedDate
          const orderBy = computeOrderByDate(target, terms?.leadTimeDays ?? null)
          const diff = orderBy ? daysBetween(today, orderBy) : null
          return {
            itemId: l.itemId,
            qty: l.qty,
            unitPrice: price?.unitPrice ?? 0,
            stockAtOrder: stockByItem.get(l.itemId) ?? 0,
            note: price ? null : "단가 미등록(MRP 발주제안)",
            priced: price !== null,
            // 감사 요약(Phase 5D): 구매조건과 필요일/발주 필요일
            moq: terms?.moq ?? null,
            orderMultiple: terms?.orderMultiple ?? null,
            leadTimeDays: terms?.leadTimeDays ?? null,
            safetyStock: Number((itemById.get(l.itemId) as { safetyStock?: unknown } | undefined)?.safetyStock ?? 0) || 0,
            requiredReceiptDate: target,
            orderByDate: orderBy,
            leadTimeOverdue: diff !== null && diff < 0,
            leadTimeMissing: terms?.leadTimeDays === null || terms?.leadTimeDays === undefined,
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
              ...(history ? { mrpRunId: runIdForLinks, requestKey: history.requestKey } : {}),
              items: itemRows.slice(0, 50).map((r) => ({
                itemId: r.itemId,
                qty: r.qty,
                unitPrice: r.unitPrice,
                priced: r.priced,
                safetyStock: r.safetyStock,
                moq: r.moq,
                orderMultiple: r.orderMultiple,
                leadTimeDays: r.leadTimeDays,
                requiredReceiptDate: r.requiredReceiptDate,
                orderByDate: r.orderByDate,
              })),
              leadTimeOverdueLineCount: itemRows.filter((r) => r.leadTimeOverdue).length,
              leadTimeMissingLineCount: itemRows.filter((r) => r.leadTimeMissing).length,
            } as Prisma.InputJsonValue,
            menuName: "MRP 발주제안",
          },
        })
        // (Phase 6) 실행이력 연결 + 라인 근거 + override 감사
        if (history && runIdForLinks) {
          const linkLines = g.lines.map((l) => {
            const gd = guardByPair.get(`${l.itemId}|${g.supplierId}`)
            const it = itemById.get(l.itemId)
            return {
              itemId: l.itemId,
              itemCode: it?.code ?? null,
              itemName: it?.name ?? null,
              supplierId: g.supplierId,
              qty: l.qty,
              requiredDate: l.requiredDate ?? g.expectedDate,
              rawNeed: gd?.rawNeed ?? 0,
              draftCoverageQty: gd?.coverageQty ?? 0,
              remainingRawNeed: gd?.remainingRawNeed ?? 0,
              duplicateDraft: gd?.dupDraft ?? false,
              duplicateRunLine: gd?.dupRun ?? false,
              overrideReason: gd?.overrideReason ?? null,
            }
          })
          const overrides = linkLines.filter((l) => l.overrideReason !== null)
          const overrideReason =
            overrides.length > 0
              ? overrides
                  .map((l) => `${l.itemCode ?? l.itemId}: ${l.overrideReason}`)
                  .join(" / ")
                  .slice(0, 1000)
              : null
          const result = {
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
            leadTimeOverdueLineCount: itemRows.filter((r) => r.leadTimeOverdue).length,
            leadTimeMissingLineCount: itemRows.filter((r) => r.leadTimeMissing).length,
            siteId: site.id,
            // 같은 키 재전송이 "같은 요청"인지 판별하는 결정적 해시(replay 시 응답에서 제외)
            requestHash,
          }
          const link = await tx.mrpRunPurchase.create({
            data: {
              tenantId,
              runId: runIdForLinks,
              purchaseOrderId: po.id,
              orderNo,
              supplierId: g.supplierId,
              supplierName: supplierName.get(g.supplierId) ?? "",
              requestKey: history.requestKey!,
              itemCount: itemRows.length,
              totalQty,
              overrideUsed: overrides.length > 0,
              overrideReason,
              lines: linkLines as unknown as Prisma.InputJsonValue,
              result: result as unknown as Prisma.InputJsonValue,
              createdById: actor.id,
              createdByName: actor.name ?? null,
            },
          })
          await tx.auditLog.create({
            data: {
              tenantId,
              actorId: actor.id,
              actorLabel: actor.name ?? null,
              entityType: "MrpRunPurchase",
              entityId: link.id,
              action: "CREATE",
              afterData: {
                kind: overrides.length > 0 ? "MRP_PURCHASE_CREATE_OVERRIDE" : "MRP_PURCHASE_CREATE",
                mrpRunId: runIdForLinks,
                purchaseOrderId: po.id,
                orderNo,
                supplierId: g.supplierId,
                requestKey: history.requestKey,
                itemCount: itemRows.length,
                totalQty,
                overrides: overrides.map((l) => ({
                  itemId: l.itemId,
                  itemCode: l.itemCode,
                  reason: l.overrideReason,
                  duplicateDraft: l.duplicateDraft,
                  duplicateRunLine: l.duplicateRunLine,
                  rawNeed: l.rawNeed,
                  draftCoverageQty: l.draftCoverageQty,
                  qty: l.qty,
                })),
              } as Prisma.InputJsonValue,
              menuName: "MRP 발주제안",
            },
          })
        }
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
          leadTimeOverdueLineCount: itemRows.filter((r) => r.leadTimeOverdue).length,
          leadTimeMissingLineCount: itemRows.filter((r) => r.leadTimeMissing).length,
        })
      }
      return {
        orders: created,
        siteId: site.id,
        ...(history
          ? {
              runId: runIdForLinks,
              replayed: false,
              overrideCount: Array.from(guardByPair.values()).filter((g) => g.overrideReason !== null).length,
            }
          : {}),
      }
    }, history ? MRP_RUN_TX_OPTIONS : undefined)

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
