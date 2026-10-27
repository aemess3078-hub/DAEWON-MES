/**
 * 자재출고 보안·정합성 테스트(4-1.6단계) — 메모리 가짜 DB. 실제 PostgreSQL/브라우저 없음.
 *
 *  A. getLotStockByItems / lookupLotForMaterialIssue: 비로그인 · 권한 없음 · tenant 위조 차단, 정상 사용자 유지
 *  B. issueMaterialsForWorkOrder: 작업지시 BOM 구성품 소속 검증(수동/QR 동일), 대체자재·예외 출고 분석
 *  C. LOT 상태 변경 ↔ 출고 동시성: LOT 행 공유 잠금(FOR SHARE) 모델 — 잠금 순서, 대기, 커밋 순서별 결과
 *  D. 유효기간 당일/다음 날 판정, 회귀(수동/QR/Multi-LOT/WIP/예약/롤백/QR 비활성)
 *
 * 가짜 DB 의 "행 잠금"은 PostgreSQL 잠금 규칙(FOR SHARE 보유 중에는 같은 행의 UPDATE 가 대기)을 흉내 낸 모델이다.
 * 실제 PostgreSQL 의 잠금 대기/격리 수준 동작은 이 테스트로 증명되지 않는다(미검증 항목으로 보고).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const elig = require("../src/lib/material-issue/lot-eligibility") as typeof import("../src/lib/material-issue/lot-eligibility")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
function execGit(command: string): string {
  const { execSync } = require("node:child_process") as typeof import("node:child_process")
  return execSync(command, { encoding: "utf8" }).trim()
}

async function main() {
  type Row = Record<string, unknown> & { id?: string }
  const state: Record<string, Row[]> = {}
  const auth: { mode: "ok" | "anon"; tenantId: string; allowed: Set<string> } = { mode: "ok", tenantId: "t1", allowed: new Set() }
  const ALL = ["INVENTORY", "LOT", "WORK_ORDER", "PURCHASE_ORDER"].flatMap((r) => [`${r}:READ`, `${r}:CREATE`, `${r}:UPDATE`])
  const setAuth = (mode: "ok" | "anon", tenantId = "t1", allowed: string[] = ALL) => {
    auth.mode = mode
    auth.tenantId = tenantId
    auth.allowed = new Set(allowed)
  }
  const counters = { balanceFindMany: 0, workOrderFindMany: 0, warehouseFindMany: 0, permissionSnapshots: 0 }
  let rawQueryCount = 0
  const ops: string[] = []

  const resetState = () => {
    const lot = (id: string, itemId: string, status = "ACTIVE", expiryDate: Date | null = null) => ({ id, tenantId: "t1", lotNo: id.toUpperCase(), itemId, status, expiryDate })
    state.items = [
      { id: "item-a", code: "RM-A", name: "원자재 A", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "KG" },
      { id: "item-b", code: "RM-B", name: "원자재 B", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA" },
      { id: "item-n", code: "RM-N", name: "비LOT 원자재", itemType: "RAW_MATERIAL", isLotTracked: false, uom: "EA" },
      { id: "item-z", code: "RM-Z", name: "BOM 밖 원자재", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "KG" },
      { id: "item-zn", code: "RM-ZN", name: "BOM 밖 비LOT", itemType: "RAW_MATERIAL", isLotTracked: false, uom: "EA" },
      { id: "item-sub", code: "RM-SUB", name: "A 의 대체자재", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "KG" },
    ]
    state.itemSubstitutes = [{ id: "sub-1", itemId: "item-a", substituteItemId: "item-sub", priority: 1 }]
    state.warehouses = [
      { id: "wh-1", code: "WH-1", name: "원자재창고", tenantId: "t1", siteId: "s1" },
      { id: "wh-t2", code: "WH-T2", name: "다른 tenant 창고", tenantId: "t2", siteId: "s1" },
    ]
    const today = elig.kstDateString(new Date())
    const yesterday = elig.kstDateString(new Date(Date.now() - 24 * 3600 * 1000))
    const tomorrow = elig.kstDateString(new Date(Date.now() + 24 * 3600 * 1000))
    state.lots = [
      lot("lot-ok", "item-a"),
      lot("lot-ok2", "item-a"),
      lot("lot-b1", "item-b"),
      lot("lot-z", "item-z"),
      lot("lot-sub", "item-sub"),
      lot("lot-today", "item-a", "ACTIVE", new Date(`${today}T00:00:00Z`)),
      lot("lot-yesterday", "item-a", "ACTIVE", new Date(`${yesterday}T00:00:00Z`)),
      lot("lot-tomorrow", "item-a", "ACTIVE", new Date(`${tomorrow}T00:00:00Z`)),
      { id: "lot-t2", tenantId: "t2", lotNo: "LOT-T2", itemId: "item-a", status: "ACTIVE", expiryDate: null },
    ]
    state.balances = [
      ...state.lots.map((l) => ({ id: `bal-${l.id}`, tenantId: l.tenantId, itemId: l.itemId, lotId: l.id, warehouseId: "wh-1", qtyOnHand: 100, qtyAvailable: 100 })),
      { id: "bal-n", tenantId: "t1", itemId: "item-n", lotId: null, warehouseId: "wh-1", qtyOnHand: 50, qtyAvailable: 50 },
      { id: "bal-zn", tenantId: "t1", itemId: "item-zn", lotId: null, warehouseId: "wh-1", qtyOnHand: 50, qtyAvailable: 50 },
    ]
    state.workOrders = [
      {
        id: "wo-1",
        tenantId: "t1",
        siteId: "s1",
        itemId: "item-fg",
        plannedQty: 10,
        manufacturingNo: "26A01",
        status: "RELEASED",
        orderNo: "WO-1",
        dueDate: null,
        componentIds: ["item-a", "item-b", "item-n"],
        operations: [{ id: "op-1", seq: 1, status: "PENDING", routingOperation: { workCenterId: "wc-1" } }],
      },
      {
        id: "wo-2",
        tenantId: "t1",
        siteId: "s1",
        itemId: "item-fg",
        plannedQty: 5,
        manufacturingNo: "26A02",
        status: "IN_PROGRESS",
        orderNo: "WO-2",
        dueDate: null,
        componentIds: ["item-a", "item-b", "item-n"],
        operations: [{ id: "op-2", seq: 1, status: "PENDING", routingOperation: { workCenterId: "wc-1" } }],
      },
      {
        id: "wo-t2",
        tenantId: "t2",
        siteId: "s9",
        itemId: "item-fg",
        plannedQty: 3,
        manufacturingNo: "26T201",
        status: "RELEASED",
        orderNo: "WO-T2",
        dueDate: null,
        componentIds: ["item-a"],
        operations: [{ id: "op-t2", seq: 1, status: "PENDING", routingOperation: { workCenterId: "wc-9" } }],
      },
    ]
    for (const t of ["invTx", "woMaterialLots", "wipUnits", "wipUnitMaterialLots", "wipMovements", "reservations", "audits"]) state[t] = []
  }

  let seq = 0
  const nid = (p: string) => `${p}-${++seq}`
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const rv = row[k]
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const o = v as Record<string, unknown>
        if ("in" in o) return (o.in as unknown[]).includes(rv)
        if ("gte" in o) return Number(rv) >= Number(o.gte)
        if ("gt" in o) return Number(rv) > Number(o.gt)
        if ("not" in o) return rv !== o.not
      }
      return rv === v
    })

  // 행 잠금 모델: 열린 트랜잭션이 FOR SHARE 로 잡은 LOT 행의 UPDATE 는 트랜잭션이 끝날 때까지 대기한다
  type Tx = { held: Set<string> }
  const openTxs = new Set<Tx>()
  const waiters: Array<{ lotId: string; resume: () => void }> = []
  let beforeLockHook: ((lotId: string) => void) | null = null
  let afterLockHook: ((lotId: string) => void) | null = null
  let readDelayMs = 0 // 잠금 후 읽기 사이에 다른 요청이 진행될 시간을 주어 끼어들기를 결정적으로 재현한다
  const releaseLocks = (tx: Tx) => {
    openTxs.delete(tx)
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (tx.held.has(waiters[i].lotId) && !Array.from(openTxs).some((o) => o.held.has(waiters[i].lotId))) waiters.splice(i, 1)[0].resume()
    }
  }

  const txClient = (tx: Tx) => ({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      rawQueryCount += 1
      // LOT 채번의 순번 조회(Prisma.sql 객체로 호출됨): 오늘 이 접두사의 최대 순번이 2 라고 가정한다
      if (!Array.isArray(strings)) return [{ maxSeq: 2 }]
      const sql = strings.join("?")
      if (sql.includes('FROM "Lot"') && sql.includes("FOR SHARE")) {
        const lotId = String(values[0])
        beforeLockHook?.(lotId)
        tx.held.add(lotId)
        ops.push(`lock:${lotId}`)
        afterLockHook?.(lotId)
      }
      return []
    },
    wipUnit: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        const w = a.where
        return state.wipUnits.find((u) => u.workOrderId === w.workOrderId && (u.parentWipUnitId ?? null) === null && (u.sourceProductionResultId ?? null) === null && (w.status as { in: string[] }).in.includes(String(u.status))) ?? null
      },
      create: async (a: { data: Row }) => {
        const row = { id: nid("wip"), parentWipUnitId: null, sourceProductionResultId: null, ...a.data }
        state.wipUnits.push(row)
        return row
      },
    },
    wipMovement: { create: async (a: { data: Row }) => void state.wipMovements.push({ id: nid("mv"), ...a.data }) },
    lot: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        if (typeof a.where.id === "string") ops.push(`read:${a.where.id}`)
        if (readDelayMs > 0) await new Promise<void>((r) => setTimeout(r, readDelayMs))
        return state.lots.find((l) => matches(l, a.where)) ?? null
      },
      findUnique: async (a: { where: { id: string } }) => state.lots.find((l) => l.id === a.where.id) ?? null,
    },
    inventoryBalance: {
      findFirst: async (a: { where: Record<string, unknown> }) => state.balances.find((b) => matches(b, a.where)) ?? null,
      updateMany: async (a: { where: Record<string, unknown>; data: { qtyOnHand: { decrement: number }; qtyAvailable: { decrement: number } } }) => {
        const row = state.balances.find((b) => matches(b, a.where))
        if (!row) return { count: 0 }
        row.qtyOnHand = Number(row.qtyOnHand) - a.data.qtyOnHand.decrement
        row.qtyAvailable = Number(row.qtyAvailable) - a.data.qtyAvailable.decrement
        return { count: 1 }
      },
    },
    inventoryTransaction: { create: async (a: { data: Row }) => { ops.push("issue-write"); const row = { id: nid("itx"), ...a.data }; state.invTx.push(row); return row } },
    workOrderMaterialLot: { create: async (a: { data: Row }) => { const row = { id: nid("wml"), ...a.data }; state.woMaterialLots.push(row); return row } },
    wipUnitMaterialLot: { create: async (a: { data: Row }) => void state.wipUnitMaterialLots.push({ id: nid("wuml"), ...a.data }) },
    materialReservation: {
      findUnique: async (a: { where: { id: string } }) => state.reservations.find((r) => r.id === a.where.id) ?? null,
      findFirst: async (a: { where: Record<string, unknown> }) => state.reservations.find((r) => matches(r, a.where)) ?? null,
      findMany: async (a: { where: Record<string, unknown> }) => state.reservations.filter((r) => matches(r, a.where)),
      update: async (a: { where: { id: string }; data: Row }) => void Object.assign(state.reservations.find((r) => r.id === a.where.id)!, a.data),
      create: async (a: { data: Row }) => void state.reservations.push({ id: nid("res"), ...a.data }),
    },
    __audit: (row: Row) => void state.audits.push(row),
  })
  const bomOf = (wo: Row) => ({ bomItems: (wo.componentIds as string[]).map((c) => ({ componentItemId: c })) })
  const fakePrisma = {
    ...txClient({ held: new Set() }),
    item: { findMany: async (a: { where: { id: { in: string[] } } }) => state.items.filter((i) => a.where.id.in.includes(String(i.id))) },
    warehouse: {
      findMany: async (a: { where: { tenantId: string; siteId?: string } }) => {
        counters.warehouseFindMany += 1
        return state.warehouses.filter((w) => w.tenantId === a.where.tenantId && (!a.where.siteId || w.siteId === a.where.siteId))
      },
    },
    workOrder: {
      findMany: async (a: { where: { tenantId: string; status: { in: string[] } } }) => {
        counters.workOrderFindMany += 1
        return state.workOrders
          .filter((w) => w.tenantId === a.where.tenantId && a.where.status.in.includes(String(w.status)))
          .map((w) => ({
            ...w,
            item: { id: "item-fg", code: "FG", name: "완제품" },
            site: { id: w.siteId, name: "공장" },
            bom: {
              bomItems: (w.componentIds as string[]).map((c, i) => ({
                componentItemId: c,
                seq: i + 1,
                qtyPer: 2,
                scrapRate: 0,
                componentItem: state.items.find((it) => it.id === c),
              })),
            },
            materialReservations: state.reservations.filter((r) => r.workOrderId === w.id),
          }))
      },
      findUnique: async (a: { where: { id: string } }) => {
        const wo = state.workOrders.find((w) => w.id === a.where.id)
        return wo ? { ...wo, bom: bomOf(wo) } : null
      },
      findFirst: async (a: { where: { id: string; tenantId: string } }) => {
        const wo = state.workOrders.find((w) => w.id === a.where.id && w.tenantId === a.where.tenantId)
        return wo ? { id: wo.id, bom: bomOf(wo) } : null
      },
    },
    lot: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        const l = state.lots.find((x) => matches(x, a.where))
        return l ? { ...l, item: state.items.find((i) => i.id === l.itemId) } : null
      },
      update: async (a: { where: { id: string }; data: Row }) => {
        // 다른 트랜잭션이 이 LOT 행을 FOR SHARE 로 잡고 있으면 끝날 때까지 대기(행 잠금 모델)
        if (Array.from(openTxs).some((t) => t.held.has(a.where.id))) {
          ops.push(`update-wait:${a.where.id}`)
          await new Promise<void>((resume) => waiters.push({ lotId: a.where.id, resume }))
        }
        const l = state.lots.find((x) => x.id === a.where.id)!
        Object.assign(l, a.data)
        ops.push(`update-applied:${a.where.id}`)
        return l
      },
    },
    inventoryBalance: {
      findMany: async (a: { where: { tenantId: string; itemId: { in: string[] }; lotId?: { not: null }; qtyAvailable?: { gt: number }; warehouseId?: { in: string[] } } }) => {
        counters.balanceFindMany += 1
        if (!a.where.lotId) {
          // 자재출고 목록의 품목별 재고 합계 / 창고별 재고 조회
          return state.balances.filter(
            (b) => b.tenantId === a.where.tenantId && a.where.itemId.in.includes(String(b.itemId)) && (!a.where.warehouseId || a.where.warehouseId.in.includes(String(b.warehouseId))),
          )
        }
        const gt = a.where.qtyAvailable?.gt ?? 0
        return state.balances
          .filter((b) => b.tenantId === a.where.tenantId && a.where.itemId.in.includes(String(b.itemId)) && b.lotId !== null && Number(b.qtyAvailable) > gt)
          .map((b) => ({ ...b, lot: state.lots.find((l) => l.id === b.lotId), item: { uom: state.items.find((i) => i.id === b.itemId)?.uom }, warehouse: state.warehouses.find((w) => w.id === b.warehouseId) }))
          .sort((x, y) => String((x.lot as Row).lotNo).localeCompare(String((y.lot as Row).lotNo)))
      },
    },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
      const snapshot = structuredClone(state)
      const tx: Tx = { held: new Set() }
      openTxs.add(tx)
      try {
        const result = await fn(txClient(tx))
        releaseLocks(tx)
        return result
      } catch (error) {
        for (const key of Object.keys(snapshot)) state[key] = snapshot[key]
        releaseLocks(tx)
        throw error
      }
    },
  }
  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  const actor = () => ({ tenantId: auth.tenantId, id: "user-1", name: "작업자", profileId: "p1" })
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("next/cache", { revalidatePath: () => {} })
  inject("../src/lib/auth", {
    getTenantId: async () => auth.tenantId,
    getCurrentUser: async () => (auth.mode === "anon" ? null : actor()),
    requireRole: async () => {
      if (auth.mode === "anon") throw new Error("UNAUTHORIZED")
      return actor()
    },
  })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async (resource: string, action: string) => {
      if (auth.mode === "anon") throw new Error("UNAUTHORIZED")
      if (!auth.allowed.has(`${resource}:${action}`)) throw new Error("이 기능을 사용할 권한이 없습니다.")
      return actor()
    },
    // lot-read-access 는 권한 스냅샷을 한 번만 만들고 hasResourcePermission 으로 여러 READ 권한을 판정한다
    getCurrentPermissionSnapshot: async () => {
      counters.permissionSnapshots += 1
      return auth.mode === "anon" ? null : { user: actor() }
    },
    hasResourcePermission: (_snapshot: unknown, resource: string, action: string) => auth.allowed.has(`${resource}:${action}`),
  })
  inject("../src/lib/audit-log", {
    recordAuditLog: async (db: { __audit: (r: Row) => void }, p: Row) => db.__audit({ entityType: p.entityType, action: p.action, tenantId: p.tenantId }),
    summarizeAuditItems: (items: unknown) => items,
  })
  const issue = require("../src/lib/actions/material-issue.actions") as typeof import("../src/lib/actions/material-issue.actions")
  const lookup = require("../src/lib/actions/material-issue-lot-lookup.actions") as typeof import("../src/lib/actions/material-issue-lot-lookup.actions")
  const lotActions = require("../src/lib/actions/lot.actions") as typeof import("../src/lib/actions/lot.actions")

  const quiet = console.error
  const warn = console.warn
  const silence = <T,>(fn: () => Promise<T>) => {
    console.error = () => {}
    console.warn = () => {}
    return fn().finally(() => {
      console.error = quiet
      console.warn = warn
    })
  }
  const snap = () => JSON.stringify(state)
  const request = (lots: Array<{ lotId: string; quantity: number }>, itemId = "item-a") => ({
    workOrderId: "wo-1",
    siteId: "s1",
    items: [{ itemId, issueQty: lots.reduce((s, l) => s + l.quantity, 0), lots: lots.map((l) => ({ warehouseId: "wh-1", ...l })), requiredQty: 60, reservationId: null }],
  })
  const bal = (id: string) => Number(state.balances.find((b) => b.id === id)!.qtyAvailable)
  const noChange = () => state.invTx.length === 0 && state.wipUnits.length === 0 && state.reservations.length === 0 && state.audits.length === 0 && state.woMaterialLots.length === 0

  // ═══ A. 조회 인증·권한·tenant ═══════════════════════════════════════════════
  resetState()
  setAuth("ok")
  counters.balanceFindMany = 0
  const normal = await issue.getLotStockByItems(["item-a"], "t1")
  ok((normal["item-a"] ?? []).length >= 4 && normal["item-a"].every((o) => o.lotId !== "lot-t2") && counters.balanceFindMany === 1, "A1 [정상 사용자] 로그인·권한·tenant 가 맞으면 기존처럼 LOT 재고 조회(다른 tenant LOT 는 포함되지 않음)")

  setAuth("anon")
  counters.balanceFindMany = 0
  const anon = await issue.getLotStockByItems(["item-a"], "t1")
  ok(Object.keys(anon).length === 0 && counters.balanceFindMany === 0, "A2 [비로그인] 빈 결과 · 재고 조회 쿼리 자체를 실행하지 않음")

  setAuth("ok", "t1", [])
  counters.balanceFindMany = 0
  const denied = await issue.getLotStockByItems(["item-a"], "t1")
  ok(Object.keys(denied).length === 0 && counters.balanceFindMany === 0, "A3 [권한 없는 사용자] 빈 결과 · 쿼리 미실행")
  setAuth("ok", "t1", ["PURCHASE_ORDER:CREATE", "PURCHASE_ORDER:UPDATE"])
  ok(Object.keys(await issue.getLotStockByItems(["item-a"], "t1")).length === 0, "A3b 조회(READ) 권한이 없으면 생성/수정 권한만으로는 조회 불가")

  setAuth("ok", "t1")
  counters.balanceFindMany = 0
  const spoof1 = await issue.getLotStockByItems(["item-a"], "t2")
  setAuth("ok", "t2")
  const spoof2 = await issue.getLotStockByItems(["item-a"], "t1")
  ok(Object.keys(spoof1).length === 0 && Object.keys(spoof2).length === 0 && counters.balanceFindMany === 0, "A4 [tenant 위조] 세션 tenant 와 다른 tenantId 를 보내면 거부 — 다른 tenant 재고 조회 불가(쿼리 미실행)")
  setAuth("ok", "t2")
  const t2own = await issue.getLotStockByItems(["item-a"], "t2")
  ok((t2own["item-a"] ?? []).length === 1 && t2own["item-a"][0].lotId === "lot-t2", "A4b 세션 tenant 와 같은 tenantId 로는 자기 tenant LOT 만 조회")

  setAuth("ok", "t1", ["INVENTORY:READ"])
  ok(((await issue.getLotStockByItems(["item-a"], "t1"))["item-a"] ?? []).length > 0, "A5 재고(INVENTORY) 조회 권한만 있어도 조회 가능(QR 조회와 같은 기준 — 자재출고 메뉴 사용자 포함)")
  setAuth("ok", "t1", ["PURCHASE_ORDER:READ"])
  ok(((await issue.getLotStockByItems(["item-a"], "t1"))["item-a"] ?? []).length > 0, "A5b 자재출고 메뉴 권한(PURCHASE_ORDER)으로 기존 화면 조회 유지")
  setAuth("ok")
  ok(Object.keys(await issue.getLotStockByItems(null as never, "t1")).length === 0 && Object.keys(await issue.getLotStockByItems([], "t1")).length === 0 && Object.keys(await issue.getLotStockByItems([1, null] as never, "t1")).length === 0, "A6 잘못된 itemIds(null/빈 배열/문자열 아님)는 빈 결과")

  setAuth("anon")
  const lkAnon = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  setAuth("ok", "t1", [])
  const lkDenied = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  setAuth("ok")
  const lkOk = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  ok(!lkAnon.ok && lkAnon.code === "UNAUTHORIZED" && !lkDenied.ok && lkDenied.code === "DENIED" && lkOk.ok, "A7 QR 조회도 같은 기준: 비로그인 UNAUTHORIZED · 권한 없음 DENIED · 정상 성공")
  setAuth("ok", "t2")
  const lkT2 = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  ok(!lkT2.ok && lkT2.code === "WORK_ORDER_NOT_FOUND", "A8 다른 tenant 사용자는 작업지시/LOT 를 찾지 못한다")

  setAuth("anon")
  resetState()
  const issueAnon = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  setAuth("ok", "t2")
  const issueSpoof = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  setAuth("ok", "t1", ["PURCHASE_ORDER:READ"])
  const issueDenied = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  ok(!issueAnon.ok && !issueSpoof.ok && !issueDenied.ok && noChange(), "A9 출고 확정: 비로그인 · tenant 불일치 · 생성 권한 없음은 기존대로 거부되고 변경 없음")
  setAuth("ok")

  const issueSrc = read("src/lib/actions/material-issue.actions.ts")
  const lookupSrc = read("src/lib/actions/material-issue-lot-lookup.actions.ts")
  const stockFn = issueSrc.slice(issueSrc.indexOf("export async function getLotStockByItems"), issueSrc.indexOf("// ─── 자재출고 처리"))
  ok(stockFn.includes("resolveLotStockReader()") && stockFn.includes("reader.tenantId !== tenantId") && stockFn.includes("tenantId: reader.tenantId") && !/where:\s*\{\s*tenantId,/.test(stockFn), "A10 소스: 조회 쿼리는 세션 tenant 로만 실행하고 클라이언트 tenantId 는 비교에만 쓴다")
  ok(lookupSrc.includes("resolveLotStockReader()") && !lookupSrc.includes("READ_RESOURCES") && read("src/lib/material-issue/lot-read-access.ts").includes("LOT_STOCK_READ_RESOURCES"), "A11 QR 조회와 수동 목록이 같은 접근 확인 함수(lot-read-access)를 쓴다")
  ok(!read("src/lib/material-issue/lot-read-access.ts").startsWith('"use server"'), "A12 접근 확인 모듈은 서버 액션이 아니다(클라이언트가 직접 호출 불가)")

  // ═══ B. BOM 구성품 소속 ═════════════════════════════════════════════════════
  resetState()
  setAuth("ok")
  const bomOk = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 20 }]), "t1"))
  ok(bomOk.ok && bal("bal-lot-ok") === 80 && state.invTx.length === 1 && state.wipUnits.length === 1, "B1 [정상 BOM 자재 출고] 기존과 동일하게 출고")
  resetState()
  const before = snap()
  const notBom = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-z", quantity: 10 }], "item-z"), "t1"))
  ok(!notBom.ok && String(notBom.error).includes("BOM 구성품이 아닙니다") && String(notBom.error).includes("RM-Z") && snap() === before && noChange() && bal("bal-lot-z") === 100, "B2 [BOM 에 없는 자재 출고 거부] 사유 안내 · 재고/수불/예약/WIP 변경 없음")
  const mixed = await silence(() =>
    issue.issueMaterialsForWorkOrder(
      {
        workOrderId: "wo-1",
        siteId: "s1",
        items: [
          { itemId: "item-a", issueQty: 10, lots: [{ lotId: "lot-ok", warehouseId: "wh-1", quantity: 10 }], requiredQty: 20, reservationId: null },
          { itemId: "item-z", issueQty: 5, lots: [{ lotId: "lot-z", warehouseId: "wh-1", quantity: 5 }], requiredQty: 5, reservationId: null },
        ],
      },
      "t1",
    ),
  )
  ok(!mixed.ok && snap() === before && noChange() && bal("bal-lot-ok") === 100, "B3 BOM 자재와 BOM 밖 자재가 섞인 요청은 전체 거부 — BOM 자재 쪽도 출고되지 않는다")
  const nonLotNotBom = await silence(() => issue.issueMaterialsForWorkOrder({ workOrderId: "wo-1", siteId: "s1", items: [{ itemId: "item-zn", issueQty: 5, warehouseId: "wh-1", requiredQty: 5, reservationId: null }] }, "t1"))
  ok(!nonLotNotBom.ok && noChange() && Number(state.balances.find((b) => b.id === "bal-zn")!.qtyAvailable) === 50, "B4 LOT 관리가 아닌 품목도 BOM 밖이면 거부")
  const nonLotBom = await silence(() => issue.issueMaterialsForWorkOrder({ workOrderId: "wo-1", siteId: "s1", items: [{ itemId: "item-n", issueQty: 7, warehouseId: "wh-1", requiredQty: 7, reservationId: null }] }, "t1"))
  ok(nonLotBom.ok && Number(state.balances.find((b) => b.id === "bal-n")!.qtyAvailable) === 43, "B5 BOM 구성품인 비LOT 품목은 기존대로 출고")
  resetState()
  const subst = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-sub", quantity: 10 }], "item-sub"), "t1"))
  ok(!subst.ok && noChange(), "B6 [대체자재] ItemSubstitute 에 등록된 대체품이라도 BOM 구성품이 아니면 거부 — 현재 출고 로직/화면은 대체자재를 지원하지 않는다(아래 B7 근거)")
  const dialogSrc = read("src/app/app/mes/material-issue/issue-form-dialog.tsx")
  ok(!/substitute/i.test(stripComments(issueSrc + lookupSrc + dialogSrc)) && read("src/lib/actions/reference-check.server.ts").includes("itemSubstitute"), "B7 근거: 자재출고 화면·출고 액션·QR 조회 어디에도 대체자재 처리가 없고, ItemSubstitute 는 삭제 참조 확인(reference-check)에서만 쓰인다 → 기존에 허용되던 대체자재 출고 방식이 없다")
  const qrNotBom = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-Z" })
  ok(!qrNotBom.ok && qrNotBom.code === "NOT_BOM_MATERIAL", "B8 QR 조회도 같은 BOM 기준으로 거부(수동=QR)")
  const qrBom = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  resetState()
  const qrIssue = qrBom.ok ? await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: qrBom.options[0].lotId, quantity: 20 }]), "t1")) : { ok: false }
  ok(qrBom.ok && qrIssue.ok && bal("bal-lot-ok") === 80, "B9 [정상 QR 출고] QR 로 고른 BOM LOT 도 같은 서버 액션·검증으로 출고")
  ok(issueSrc.indexOf("bomComponentIds") > issueSrc.indexOf("workOrder.tenantId !== tenantId") && issueSrc.indexOf("bomComponentIds") < issueSrc.indexOf("withQuantityTransactionRetry(() =>"), "B10 BOM 검증은 트랜잭션 시작 전(쓰기 전)에 수행된다 — 거부 시 쓰기가 전혀 없다")

  // ═══ C. LOT 상태 변경 ↔ 출고 동시성 ═══════════════════════════════════════
  resetState()
  ops.length = 0
  const mkMulti = request([{ lotId: "lot-ok", quantity: 10 }, { lotId: "lot-ok2", quantity: 10 }])
  const multi = await silence(() => issue.issueMaterialsForWorkOrder(mkMulti, "t1"))
  const iLockOk = ops.indexOf("lock:lot-ok")
  const iReadOk = ops.indexOf("read:lot-ok")
  const iLockOk2 = ops.indexOf("lock:lot-ok2")
  const iReadOk2 = ops.indexOf("read:lot-ok2")
  ok(multi.ok && iLockOk >= 0 && iLockOk < iReadOk && iLockOk2 >= 0 && iLockOk2 < iReadOk2, "C1 [잠금 순서] 각 LOT 는 공유 잠금(FOR SHARE)을 먼저 잡은 뒤 상태를 읽는다(Multi-LOT 포함)")

  // 격리가 잠금 전에 커밋 → 출고 거부
  resetState()
  ops.length = 0
  beforeLockHook = (lotId) => {
    if (lotId === "lot-ok") state.lots.find((l) => l.id === "lot-ok")!.status = "QUARANTINE" // 다른 사용자의 격리 처리가 이미 커밋됨
    beforeLockHook = null
  }
  const before11 = snap()
  const raceA = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  beforeLockHook = null
  state.lots.find((l) => l.id === "lot-ok")!.status = "QUARANTINE"
  ok(!raceA.ok && String(raceA.error).includes("격리") && noChange() && bal("bal-lot-ok") === 100 && before11 !== "", "C2 [격리 먼저 커밋 → 출고] 최신 상태로 거부 · 변경 없음")

  // 출고가 잠금을 잡은 뒤 격리 요청 → 격리는 출고 커밋까지 대기, 출고는 성공(출고가 먼저)
  resetState()
  ops.length = 0
  let quarantine: Promise<unknown> | null = null
  let quarantineDoneAt = ""
  readDelayMs = 30
  afterLockHook = (lotId) => {
    if (lotId !== "lot-ok") return
    afterLockHook = null
    quarantine = lotActions.updateLotStatus("lot-ok", "QUARANTINE").then(() => void (quarantineDoneAt = `issueDone=${state.invTx.length}`))
  }
  const raceB = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }]), "t1"))
  await quarantine
  readDelayMs = 0
  ok(raceB.ok && ops.indexOf("update-wait:lot-ok") >= 0 && ops.indexOf("issue-write") >= 0 && ops.indexOf("update-wait:lot-ok") < ops.indexOf("issue-write") && ops.indexOf("issue-write") < ops.indexOf("update-applied:lot-ok"), "C3 [출고가 먼저 잠금] 같은 LOT 의 상태 변경(UPDATE)은 출고 트랜잭션이 끝날 때까지 대기한다 — 읽은 뒤 값이 바뀌어 통과하는 구간이 없다")
  ok(state.lots.find((l) => l.id === "lot-ok")!.status === "QUARANTINE" && bal("bal-lot-ok") === 70 && quarantineDoneAt === "issueDone=1", "C4 출고는 정상 완료(재고 차감 · 수불 1건), 그 뒤 격리가 반영된다 — 두 요청 결과가 직렬화되어 일관적")
  const after = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  ok(!after.ok && String(after.error).includes("격리"), "C5 [LOT 상태 변경 후 출고] 격리가 반영된 뒤의 다음 출고는 거부")

  // 출고 실패(재고 부족)여도 잠금이 풀리고 대기 중이던 상태 변경이 진행된다(잠금 누수 없음)
  resetState()
  ops.length = 0
  let hold: Promise<unknown> | null = null
  readDelayMs = 30
  afterLockHook = (lotId) => {
    if (lotId !== "lot-ok") return
    afterLockHook = null
    hold = lotActions.updateLotStatus("lot-ok", "ON_HOLD")
  }
  const failing = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 500 }]), "t1"))
  await hold
  readDelayMs = 0
  ok(!failing.ok && String(failing.error).includes("가용재고 부족") && openTxs.size === 0 && waiters.length === 0 && state.lots.find((l) => l.id === "lot-ok")!.status === "ON_HOLD" && noChange(), "C6 [재고 부족 롤백] 거부된 출고도 잠금을 해제해 대기 중인 상태 변경이 진행되고, 출고 변경은 남지 않는다")

  // 동시 출고끼리는 서로 막지 않는다(공유 잠금)
  resetState()
  const concurrent = await Promise.all([
    silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }]), "t1")),
    silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }]), "t1")),
  ])
  ok(concurrent.every((r) => r.ok) && bal("bal-lot-ok") === 40 && openTxs.size === 0 && waiters.length === 0, "C7 같은 LOT 에 대한 동시 출고 2건은 공유 잠금이라 서로 대기/교착 없이 모두 처리된다(재고 차감은 기존 guarded 차감 그대로)")
  const lockSrc = read("src/lib/quantity-concurrency.ts")
  const lockFn = lockSrc.slice(lockSrc.indexOf("export async function lockLotForShare"), lockSrc.indexOf("export async function lockWorkOrderOperationForUpdate"))
  ok(/SELECT id\s+FROM "Lot"/.test(lockFn) && lockFn.includes('"tenantId" = ${tenantId}') && lockFn.includes("FOR SHARE") && !/status/.test(stripComments(lockFn)), "C8 소스: 잠금은 tenant 로 한정한 id 만 읽는 SELECT … FOR SHARE (enum 컬럼을 raw 로 읽지 않음)")
  const lotSrc = read("src/lib/actions/lot.actions.ts")
  const updateFn = lotSrc.slice(lotSrc.indexOf("export async function updateLotStatus"), lotSrc.indexOf("// ─── LOT 번호 자동 생성"))
  ok(execGit("git diff --name-only HEAD -- src/lib/actions/lot.actions.ts") === "" && !updateFn.includes("$transaction") && (updateFn.match(/prisma\.lot\.update\(/g) ?? []).length === 1, "C9 LOT 상태 변경 액션은 수정하지 않았다 — 단일 UPDATE 문 1개(자기 행 잠금만 잡고 다른 잠금을 기다리지 않아 교착 불가)")
  ok(issueSrc.indexOf("await lockLotForShare(tx, tenantId, lockLotId)") > issueSrc.indexOf("await lockWorkOrderForUpdate(tx, tenantId, data.workOrderId)") && issueSrc.indexOf("await lockLotForShare(tx, tenantId, lockLotId)") < issueSrc.indexOf("tx.wipUnit.findFirst") && issueSrc.indexOf("tx.wipUnit.findFirst") < issueSrc.indexOf("tx.inventoryBalance.updateMany") && issueSrc.includes(".sort()") && !issueSrc.includes("await lockLotForShare(tx, tenantId, lotId)"), "C10 소스: 잠금 순서 = 작업지시 FOR UPDATE → LOT FOR SHARE(LOT ID 정렬, 루프 전 일괄) → WIP 확인 → 재고 차감")

  // ═══ D. 유효기간 · 회귀 ═══════════════════════════════════════════════════
  const dec = (d: string, at: string) => elig.evaluateLotIssueEligibility({ status: "ACTIVE", expiryDate: d }, new Date(at))
  ok(dec("2026-10-27", "2026-10-27T14:59:59Z").eligible && !dec("2026-10-27", "2026-10-27T15:00:00Z").eligible, "D1 [규칙] 유효기간 2026-10-27: 한국 10-27 23:59 까지 가능, 10-28 00:00 부터 불가")
  ok(dec("2026-10-27", "2026-10-26T15:00:00Z").eligible && dec("2026-10-27", "2026-10-27T03:00:00Z").eligible && !dec("2026-10-27", "2026-10-28T03:00:00Z").eligible, "D2 [규칙] 한국 날짜 10-27(오전 0시/정오) 출고 가능 · 10-28 출고 불가")
  resetState()
  const lotsToday = (await issue.getLotStockByItems(["item-a"], "t1"))["item-a"]
  const info = (id: string) => lotsToday.find((o) => o.lotId === id)!
  ok(info("lot-today").issueBlockReason === null && info("lot-tomorrow").issueBlockReason === null && info("lot-yesterday").issueBlockLabel === "유효기간 경과", "D3 [실제 경로] 유효기간이 오늘인 LOT 는 목록에서 출고 가능, 어제 만료는 제한")
  const todayIssue = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-today", quantity: 10 }]), "t1"))
  const yesterdayIssue = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-yesterday", quantity: 10 }]), "t1"))
  ok(todayIssue.ok && !yesterdayIssue.ok && String(yesterdayIssue.error).includes("유효기간") && bal("bal-lot-yesterday") === 100, "D4 [실제 경로] 유효기간 당일 LOT 출고 성공, 다음 날(어제 만료) LOT 출고 거부")
  const nullExpiry = elig.evaluateLotIssueEligibility({ status: "ACTIVE", expiryDate: null })
  ok(nullExpiry.eligible, "D5 유효기간이 비어 있으면 제한 없음")
  const colSrc = read("src/app/app/mes/lot/columns.tsx")
  ok(colSrc.includes("kstDateString(new Date(d)) < kstDateString(new Date())") && !colSrc.includes("new Date(d) < new Date()"), "D6 LOT 관리 화면의 만료(붉은색) 표시 기준을 서버 정책(한국 날짜, 당일까지 유효)과 일치시켰다 — 표시만 변경")
  ok(execGit("git diff --name-only HEAD -- src/lib/actions/lot.actions.ts src/app/app/mes/lot") === "src/app/app/mes/lot/columns.tsx", "D7 LOT 관리 쪽 변경은 표시 기준 1곳뿐(상태 관리 정책 등 다른 LOT 관리 로직 변경 없음)")

  // 회귀
  resetState()
  const reg = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }, { lotId: "lot-ok2", quantity: 20 }]), "t1"))
  ok(reg.ok && bal("bal-lot-ok") === 70 && bal("bal-lot-ok2") === 80 && state.invTx.length === 2 && state.woMaterialLots.length === 2 && state.wipUnits.length === 1 && state.wipUnitMaterialLots.length === 2 && state.wipMovements.length === 1 && state.reservations.length === 1 && state.reservations[0].issuedQty === 50 && state.reservations[0].status === "PARTIAL" && state.audits.length === 1, "D8 [Multi-LOT 출고 · WIP 생성 · 예약 갱신 회귀] 차감 · 수불 2 · 자재LOT 2 · WIP 1 · 예약 50/PARTIAL · 감사 1")
  const again = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 5 }]), "t1"))
  ok(again.ok && state.wipUnits.length === 1 && state.reservations[0].issuedQty === 55, "D9 추가 출고는 기존 WIP 재사용 · 예약 누적")
  resetState()
  const insufficient = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }, { lotId: "lot-ok2", quantity: 500 }]), "t1"))
  ok(!insufficient.ok && String(insufficient.error).includes("가용재고 부족") && noChange() && bal("bal-lot-ok") === 100, "D10 [재고 부족 시 롤백] 앞선 LOT 의 차감·수불·WIP 까지 모두 롤백")
  const flag = read("src/app/app/mes/material-issue/lot-qr-scan-section.tsx")
  resetState()
  const manual = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  ok(flag.includes('process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"') && manual.ok && !/qr|scan/i.test(stripComments(issueSrc)), "D11 [QR 비활성] 스위치를 꺼도(수동 경로 = 같은 서버 액션) 수동 출고 정상, 출고 액션에는 QR 분기가 없다")
  ok(execGit("git diff --name-only HEAD -- prisma") === "", "D12 DB 스키마 변경 없음")
  const diffLines = execGit("git diff -U0 HEAD -- src/lib/actions/material-issue.actions.ts").split("\n")
  const addedText = diffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n")
  ok(!/decrement|issueQty\s*[-+*/]=|qtyOnHand|wipUnit\.create|materialReservation\.(create|update)/.test(addedText), "D13 출고 액션에 추가된 코드에는 재고 차감·수량 계산·WIP 생성·예약 생성/갱신 변경이 없다(인증·BOM·예약 소속 조회·잠금만)")

  // ═══ F. 자재출고 조회 액션 인증(getWorkOrdersForIssue / getWarehousesWithStock) ═══════════
  const rejection = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  const DENIED_MSG = "이 기능을 사용할 권한이 없습니다."
  resetState()
  setAuth("ok")
  counters.workOrderFindMany = 0
  counters.warehouseFindMany = 0
  const list1 = await issue.getWorkOrdersForIssue("t1")
  const wh1 = await issue.getWarehousesWithStock("t1", ["item-a", "item-b"])
  ok(list1.length === 2 && list1.map((w) => w.id).sort().join() === "wo-1,wo-2" && list1[0].materials.length === 3 && wh1.length === 1 && Number(wh1[0].itemStocks["item-a"]) > 0, "F1 [정상 로그인 사용자] 자재출고 목록과 창고별 재고를 기존처럼 조회(자기 tenant 의 작업지시만)")
  ok(list1.every((w) => w.materials.every((m) => m.currentStock <= 1000)) && Number(wh1[0].itemStocks["item-a"]) === 500, "F1b 재고 합계는 자기 tenant 의 LOT 만 합산(다른 tenant LOT 재고 제외: 500 = 100×5 LOT)")

  setAuth("anon")
  counters.workOrderFindMany = 0
  counters.warehouseFindMany = 0
  const anonA = await rejection(() => issue.getWorkOrdersForIssue("t1"))
  const anonB = await rejection(() => issue.getWarehousesWithStock("t1", ["item-a"]))
  ok(anonA === "UNAUTHORIZED" && anonB === "UNAUTHORIZED" && counters.workOrderFindMany === 0 && counters.warehouseFindMany === 0 && counters.balanceFindMany >= 0, "F2 [비로그인] 두 조회 모두 UNAUTHORIZED 오류 — DB 조회 미실행(빈 목록으로 위장하지 않음)")

  setAuth("ok", "t1", ["INVENTORY:READ", "LOT:READ", "WORK_ORDER:READ"])
  counters.workOrderFindMany = 0
  counters.warehouseFindMany = 0
  const denyA = await rejection(() => issue.getWorkOrdersForIssue("t1"))
  const denyB = await rejection(() => issue.getWarehousesWithStock("t1", ["item-a"]))
  ok(denyA === DENIED_MSG && denyB === DENIED_MSG && counters.workOrderFindMany === 0 && counters.warehouseFindMany === 0, "F3 [권한 없는 사용자] 자재출고(PURCHASE_ORDER) 조회 권한이 없으면 다른 READ 권한이 있어도 권한 오류 — 조회 미실행")

  setAuth("ok", "t1")
  counters.workOrderFindMany = 0
  counters.warehouseFindMany = 0
  const spoofA = await rejection(() => issue.getWorkOrdersForIssue("t2"))
  const spoofB = await rejection(() => issue.getWarehousesWithStock("t2", ["item-a"]))
  setAuth("ok", "t2")
  const spoofC = await rejection(() => issue.getWorkOrdersForIssue("t1"))
  ok(spoofA === DENIED_MSG && spoofB === DENIED_MSG && spoofC === DENIED_MSG && counters.workOrderFindMany === 0 && counters.warehouseFindMany === 0, "F4 [다른 tenant 조회] 세션과 다른 tenantId 는 권한 없음과 같은 오류 문구로 거부 — 다른 tenant 데이터의 존재 여부 비노출 · 조회 미실행")
  const t2List = await issue.getWorkOrdersForIssue("t2")
  ok(t2List.length === 1 && t2List[0].id === "wo-t2", "F4b 세션 tenant 와 같은 tenantId 로는 자기 tenant 데이터만 조회")
  setAuth("ok")
  state.workOrders = state.workOrders.filter((w) => w.tenantId !== "t1")
  const emptyList = await issue.getWorkOrdersForIssue("t1")
  ok(Array.isArray(emptyList) && emptyList.length === 0, "F5 인증 실패(오류)와 조회 결과 없음(빈 배열)은 구분된다")
  resetState()
  ok((await rejection(() => issue.getWarehousesWithStock("t1", null as never))) === "잘못된 요청입니다." && (await issue.getWarehousesWithStock("t1", [])).length === 1, "F6 잘못된 itemIds 는 오류, 빈 배열은 창고 목록만 반환(기존 동작)")
  const woFn = issueSrc.slice(issueSrc.indexOf("export async function getWorkOrdersForIssue"), issueSrc.indexOf("// ─── 창고 목록"))
  const whFn = issueSrc.slice(issueSrc.indexOf("export async function getWarehousesWithStock"), issueSrc.indexOf("// ─── LOT별 재고 조회"))
  ok((woFn.match(/clientTenantId/g) ?? []).length === 2 && (whFn.match(/clientTenantId/g) ?? []).length === 2 && woFn.includes("requireMaterialIssueReader(clientTenantId)") && whFn.includes("requireMaterialIssueReader(clientTenantId)"), "F7 소스: 클라이언트 tenantId 는 인증 확인에만 쓰이고(선언 + 확인 호출 각 1회) 조회 쿼리는 세션 tenant 를 쓴다")
  const layoutSrc = read("src/app/app/layout.tsx")
  ok(layoutSrc.includes("canReadPath") && layoutSrc.includes("redirect('/login')") && execGit("git diff --name-only HEAD -- src/app/app/mes/material-issue/page.tsx") === "", "F8 호출처는 자재출고 페이지(서버 컴포넌트) 하나뿐이며 페이지·layout 의 로그인/메뉴 권한 확인은 그대로 — POP·키오스크 경로의 호출 없음")
  ok(!/getWorkOrdersForIssue|getWarehousesWithStock/.test(read("src/app/pop/work-select/page.tsx") + read("src/lib/actions/pop.actions.ts")), "F9 POP 경로는 이 조회 액션을 쓰지 않는다(별도 인증 체계 영향 없음)")

  // ═══ G. 자재예약 ID 소속 검증 ═════════════════════════════════════════════
  const seedReservations = () => {
    const r = (id: string, workOrderId: string, itemId: string, requiredQty: number) => ({ id, workOrderId, itemId, requiredQty, reservedQty: 0, issuedQty: 0, status: "PENDING" })
    state.reservations = [r("res-a1", "wo-1", "item-a", 60), r("res-b1", "wo-1", "item-b", 20), r("res-a-wo2", "wo-2", "item-a", 30), r("res-a-t2", "wo-t2", "item-a", 6)]
  }
  const reqRes = (lots: Array<{ lotId: string; quantity: number }>, reservationId: string | null, itemId = "item-a") => {
    const base = request(lots, itemId)
    return { ...base, items: [{ ...base.items[0], reservationId }] }
  }
  const resOf = (id: string) => state.reservations.find((x) => x.id === id)!
  const MISMATCH = "자재예약 정보가 올바르지 않습니다."
  resetState()
  seedReservations()
  const g1 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], "res-a1"), "t1"))
  ok(g1.ok && resOf("res-a1").issuedQty === 30 && resOf("res-a1").status === "PARTIAL" && state.reservations.length === 4 && resOf("res-b1").issuedQty === 0 && bal("bal-lot-ok") === 70, "G1 [정상 예약 ID 출고] 해당 예약만 갱신(30/PARTIAL) · 새 예약 없음 · 재고 차감")
  resetState()
  seedReservations()
  const gBefore = snap()
  const g2 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], "res-a-wo2"), "t1"))
  ok(!g2.ok && String(g2.error).includes(MISMATCH) && snap() === gBefore, "G2 [다른 작업지시의 예약 ID] 거부 — 재고·예약·수불·WIP·감사 변경 없음(상태 전체 동일)")
  const g3 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], "res-b1"), "t1"))
  ok(!g3.ok && String(g3.error).includes(MISMATCH) && snap() === gBefore, "G3 [다른 품목의 예약 ID] 같은 작업지시여도 품목이 다르면 거부 · 변경 없음")
  const g4 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], "res-a-t2"), "t1"))
  const g5 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], "res-nope"), "t1"))
  ok(!g4.ok && !g5.ok && g4.error === g5.error && snap() === gBefore, "G4 [다른 tenant 의 예약 ID] 없는 예약 ID 와 완전히 같은 응답(존재 여부 비노출) · 변경 없음")
  const g6 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], null), "t1"))
  ok(g6.ok && state.reservations.length === 4 && resOf("res-a1").issuedQty === 30 && resOf("res-a-wo2").issuedQty === 0, "G6 [예약 ID 없는 출고] 기존대로 같은 작업지시·품목의 기존 예약을 찾아 갱신(중복 생성 없음)")
  resetState()
  const g7 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], null), "t1"))
  ok(g7.ok && state.reservations.length === 1 && state.reservations[0].workOrderId === "wo-1" && state.reservations[0].itemId === "item-a" && state.reservations[0].issuedQty === 30, "G7 [예약 ID 없고 예약도 없는 BOM 자재] 기존대로 예약을 새로 만든다(정상 업무 유지)")
  resetState()
  seedReservations()
  const g8 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }, { lotId: "lot-ok2", quantity: 20 }], "res-a1"), "t1"))
  ok(g8.ok && resOf("res-a1").issuedQty === 50 && state.invTx.length === 2 && state.wipUnits.length === 1, "G8 [Multi-LOT + 정상 예약 ID] 두 LOT 출고량이 같은 예약에 누적(50)")
  resetState()
  seedReservations()
  const mixedBase = request([{ lotId: "lot-ok", quantity: 10 }])
  const mixedReq = {
    ...mixedBase,
    items: [
      { ...mixedBase.items[0], reservationId: "res-a1" },
      { itemId: "item-b", issueQty: 5, lots: [{ lotId: "lot-b1", warehouseId: "wh-1", quantity: 5 }], requiredQty: 20, reservationId: "res-a1" }, // item-b 에 item-a 의 예약
    ],
  }
  const gMixedBefore = snap()
  const g9 = await silence(() => issue.issueMaterialsForWorkOrder(mixedReq, "t1"))
  ok(!g9.ok && snap() === gMixedBefore && bal("bal-lot-ok") === 100 && bal("bal-lot-b1") === 100, "G9 여러 자재 중 하나라도 예약이 맞지 않으면 요청 전체 거부 — 올바른 자재 쪽도 출고되지 않는다")
  resetState()
  seedReservations()
  beforeLockHook = (lotId) => {
    if (lotId === "lot-ok") resOf("res-a1").workOrderId = "wo-2" // 사전 확인 이후 예약이 다른 작업지시로 바뀐 경우
    beforeLockHook = null
  }
  const g10 = await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: "lot-ok", quantity: 30 }], "res-a1"), "t1"))
  beforeLockHook = null
  ok(!g10.ok && String(g10.error).includes(MISMATCH) && state.invTx.length === 0 && state.wipUnits.length === 0 && state.woMaterialLots.length === 0 && state.audits.length === 0 && bal("bal-lot-ok") === 100 && resOf("res-a1").issuedQty === 0, "G10 [사전 확인 후 예약이 바뀐 경우] 트랜잭션 안의 재확인에서 거부되고 이미 쓴 수불·WIP·재고 차감까지 롤백")
  resetState()
  seedReservations()
  const qrFound2 = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  const g11 = qrFound2.ok ? await silence(() => issue.issueMaterialsForWorkOrder(reqRes([{ lotId: qrFound2.options[0].lotId, quantity: 25 }], "res-a1"), "t1")) : { ok: false }
  ok(qrFound2.ok && g11.ok && resOf("res-a1").issuedQty === 25 && bal("bal-lot-ok") === 75, "G11 [QR 로 고른 LOT + 예약 ID] 수동 선택과 같은 서버 검증·처리로 출고")
  const preStart = issueSrc.indexOf("const reservationIds = Array.from")
  const preEnd = issueSrc.indexOf("// txNo 사전 생성")
  const preBlock = issueSrc.slice(preStart, preEnd)
  ok(preStart > issueSrc.indexOf("bomComponentIds") && preStart < issueSrc.indexOf("withQuantityTransactionRetry(() =>") && !/\.(create|update|updateMany|delete)\(/.test(preBlock) && issueSrc.includes("if (!res || res.workOrderId !== data.workOrderId || res.itemId !== item.itemId)"), "G12 소스: 예약 소속 검증은 쓰기 전(읽기만)에 하고, 트랜잭션 안에서 한 번 더 확인한다")
  const resDiffRemoved = execGit("git diff -U0 HEAD -- src/lib/actions/material-issue.actions.ts").split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---") && /materialReservation|reservation/i.test(l))
  ok(resDiffRemoved.length === 0 && issueSrc.includes("await tx.materialReservation.create({") && issueSrc.includes("const existing = await tx.materialReservation.findFirst"), "G13 기존 예약 생성/갱신 코드는 삭제·수정하지 않았다(검증 추가만)")

  // ═══ H. Multi-LOT 잠금 순서 ═══════════════════════════════════════════════
  const lockOps = () => ops.filter((o) => o.startsWith("lock:"))
  const summary = () => JSON.stringify({ bal: ["bal-lot-ok", "bal-lot-ok2", "bal-lot-b1"].map(bal), tx: state.invTx.map((t) => `${String(t.lotId)}:${String(t.qty)}`).sort(), wip: state.wipUnits.length, res: state.reservations.map((x) => [x.workOrderId, x.itemId, x.issuedQty, x.status]) })
  resetState()
  ops.length = 0
  const hForward = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }, { lotId: "lot-ok2", quantity: 20 }]), "t1"))
  const forwardLocks = lockOps().join()
  const forwardSummary = summary()
  resetState()
  ops.length = 0
  const hReverse = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok2", quantity: 20 }, { lotId: "lot-ok", quantity: 30 }]), "t1"))
  const reverseLocks = lockOps().join()
  const firstRead = ops.findIndex((o) => o.startsWith("read:"))
  ok(hForward.ok && hReverse.ok && forwardLocks === "lock:lot-ok,lock:lot-ok2" && reverseLocks === forwardLocks && ops.slice(0, firstRead).filter((o) => o.startsWith("lock:")).length === 2, "H1 [역순 Multi-LOT] 요청 순서(ok2, ok)와 무관하게 LOT ID 오름차순으로 모든 잠금을 첫 상태 읽기 전에 잡는다")
  ok(summary() === forwardSummary, "H2 정순/역순 요청의 결과(LOT별 재고·수불·WIP·예약)가 동일 — 재고 차감 계산은 변하지 않았다")
  resetState()
  ops.length = 0
  const mixedOrder = {
    workOrderId: "wo-1",
    siteId: "s1",
    items: [
      { itemId: "item-b", issueQty: 5, lots: [{ lotId: "lot-b1", warehouseId: "wh-1", quantity: 5 }], requiredQty: 20, reservationId: null },
      { itemId: "item-a", issueQty: 20, lots: [{ lotId: "lot-ok2", warehouseId: "wh-1", quantity: 10 }, { lotId: "lot-ok", warehouseId: "wh-1", quantity: 10 }], requiredQty: 40, reservationId: null },
      { itemId: "item-n", issueQty: 3, warehouseId: "wh-1", requiredQty: 3, reservationId: null },
    ],
  }
  const hMixed = await silence(() => issue.issueMaterialsForWorkOrder(mixedOrder, "t1"))
  ok(hMixed.ok && lockOps().join() === "lock:lot-b1,lock:lot-ok,lock:lot-ok2" && !lockOps().some((o) => o.includes("item-n")), "H3 여러 자재 혼합 요청도 전체 LOT 를 ID 순으로 한 번씩만 잠그고 비LOT 품목은 LOT 잠금을 쓰지 않는다")
  // 역순 요청 중 마지막 잠금 직후 다른 사용자가 첫 번째 LOT 를 격리 → 상태 변경은 출고 끝까지 대기
  resetState()
  ops.length = 0
  readDelayMs = 30
  let hQuarantine: Promise<unknown> | null = null
  afterLockHook = (lotId) => {
    if (lotId !== "lot-ok2") return // 정렬상 마지막 잠금(= 이 시점에 두 LOT 모두 잠긴 상태)
    afterLockHook = null
    hQuarantine = lotActions.updateLotStatus("lot-ok", "QUARANTINE")
  }
  const hRace = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok2", quantity: 20 }, { lotId: "lot-ok", quantity: 30 }]), "t1"))
  await hQuarantine
  readDelayMs = 0
  const iWait = ops.indexOf("update-wait:lot-ok")
  ok(hRace.ok && iWait >= 0 && iWait < ops.indexOf("issue-write") && ops.indexOf("issue-write") < ops.indexOf("update-applied:lot-ok") && state.lots.find((l) => l.id === "lot-ok")!.status === "QUARANTINE" && bal("bal-lot-ok") === 70 && bal("bal-lot-ok2") === 80, "H4 [역순 Multi-LOT 중 LOT 격리 요청] 격리는 출고가 끝날 때까지 대기 → 출고 완료 후 격리 반영(결과 직렬화)")
  // 서로 다른 작업지시가 같은 LOT 들을 반대 순서로 동시에 출고
  resetState()
  ops.length = 0
  const wo2 = (lots: Array<{ lotId: string; quantity: number }>) => ({ ...request(lots), workOrderId: "wo-2" })
  const hBoth = await Promise.all([
    silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }, { lotId: "lot-ok2", quantity: 10 }]), "t1")),
    silence(() => issue.issueMaterialsForWorkOrder(wo2([{ lotId: "lot-ok2", quantity: 10 }, { lotId: "lot-ok", quantity: 10 }]), "t1")),
  ])
  ok(hBoth.every((r) => r.ok) && bal("bal-lot-ok") === 80 && bal("bal-lot-ok2") === 80 && openTxs.size === 0 && waiters.length === 0 && state.wipUnits.length === 2, "H5 [모델] 서로 다른 작업지시가 같은 LOT 를 반대 순서로 동시 출고해도 공유 잠금은 서로 대기하지 않고 모두 완료 — 실제 PostgreSQL 에서의 교착 부재는 검증되지 않음")
  ok(issueSrc.includes("deadlock") === false && read("src/lib/quantity-concurrency.ts").includes('message.includes("deadlock detected")'), "H6 소스: 교착 발생 시(재고 행 잠금 순서는 기존 그대로) 기존 withQuantityTransactionRetry 가 감지해 재시도한다 — 새로 추가한 재시도/타임아웃 없음")
  const lockBlock = issueSrc.slice(issueSrc.indexOf("const lotIdsToLock"), issueSrc.indexOf("// ── 0. WipUnit"))
  ok(lockBlock.includes(".sort()") && lockBlock.includes("new Set(") && /for \(const lockLotId of lotIdsToLock\)/.test(lockBlock), "H7 소스: 잠금 대상은 중복 제거 후 정렬된 목록을 순서대로 한 번씩만 잠근다")

  // ═══ I. 입고 관련 서버 액션(getWarehousesForSite / generateReceivingLotNo) 인증 ═══════════
  const receiving = require("../src/lib/actions/receiving.actions") as typeof import("../src/lib/actions/receiving.actions")
  resetState()
  setAuth("ok")
  counters.warehouseFindMany = 0
  const whOk = await receiving.getWarehousesForSite("s1")
  ok(whOk.length === 1 && whOk[0].id === "wh-1" && counters.warehouseFindMany === 1, "I1 [정상 사용자] 자재입고 화면의 창고 목록 조회 유지(자기 tenant·해당 사이트 창고만)")
  setAuth("anon")
  counters.warehouseFindMany = 0
  const whAnon = await receiving.getWarehousesForSite("s1")
  setAuth("ok", "t1", ["INVENTORY:READ", "LOT:READ", "PURCHASE_ORDER:CREATE"])
  const whDenied = await receiving.getWarehousesForSite("s1")
  ok(whAnon.length === 0 && whDenied.length === 0 && counters.warehouseFindMany === 0, "I2 [비로그인 · 조회 권한 없음] 빈 목록 — 창고 조회 쿼리 미실행")
  setAuth("ok", "t2")
  const whT2 = await receiving.getWarehousesForSite("s1")
  ok(whT2.length === 1 && whT2[0].id === "wh-t2", "I3 [tenant 격리] 같은 사이트 id 라도 세션 tenant 의 창고만 반환 — 클라이언트가 tenant 를 지정할 수 없다")
  setAuth("ok")
  ok((await receiving.getWarehousesForSite(null as never)).length === 0 && (await receiving.getWarehousesForSite("")).length === 0, "I4 잘못된 siteId 는 빈 목록")

  setAuth("anon")
  const lotAnon = await rejection(() => receiving.generateReceivingLotNo("t1", {}))
  setAuth("ok", "t1", ["PURCHASE_ORDER:READ"])
  const lotDenied = await rejection(() => receiving.generateReceivingLotNo("t1", {}))
  setAuth("ok", "t1")
  const rawBefore = rawQueryCount
  const lotSpoof = await rejection(() => receiving.generateReceivingLotNo("t2", {}))
  const rawAfterSpoof = rawQueryCount
  // 대원정밀은 LOT 채번 규칙 확정 전까지 자동 채번을 막는다(기존 정책: NEXT_PUBLIC_BRAND=newmes 일 때만 허용). 인증을 통과하면 이 정책 오류가 나야 한다.
  const lotRuleBlocked = await rejection(() => receiving.generateReceivingLotNo("t1", {}))
  const previousBrand = process.env.NEXT_PUBLIC_BRAND
  process.env.NEXT_PUBLIC_BRAND = "newmes"
  let lotNormal = ""
  try {
    lotNormal = await receiving.generateReceivingLotNo("t1", { lotNumberingType: "RAW_DATE_SEQ" })
  } finally {
    if (previousBrand === undefined) delete process.env.NEXT_PUBLIC_BRAND
    else process.env.NEXT_PUBLIC_BRAND = previousBrand
  }
  ok(lotAnon === "UNAUTHORIZED" && lotDenied === DENIED_MSG && lotSpoof === DENIED_MSG && rawAfterSpoof === rawBefore, "I5 [LOT 채번] 비로그인 UNAUTHORIZED · 생성 권한 없음/다른 tenant 요청은 권한 오류 — 채번 조회 미실행")
  ok(typeof lotNormal === "string" && lotNormal.length > 0 && rawQueryCount > rawAfterSpoof && String(lotRuleBlocked).includes("LOT 채번 규칙"), "I6 [LOT 채번] 정상 사용자(입고 생성 권한 + 같은 tenant)는 인증을 통과해 기존 채번 로직까지 도달한다(대원정밀 규칙 미확정 정책은 그대로 적용, 허용 브랜드에서는 번호 생성)")
  const recvSrc = read("src/lib/actions/receiving.actions.ts")
  ok(!/\bgetTenantId\b/.test(stripComments(recvSrc)) && recvSrc.indexOf("getWarehousesForSite") < recvSrc.indexOf('requireResourcePermission("PURCHASE_ORDER", "READ")') && recvSrc.includes('requireResourcePermission("PURCHASE_ORDER", "CREATE")'), "I7 소스: 입고 액션에서 개발용 대체값을 쓰는 getTenantId 를 더 이상 쓰지 않는다")
  ok(execGit("git diff --name-only HEAD -- src/app/app/mes/purchase-orders/receiving-dialog.tsx") === "" && /getWarehousesForSite\(siteId\)/.test(read("src/app/app/mes/purchase-orders/receiving-dialog.tsx")) && /getWarehousesForSite\(siteId\)/.test(read("src/app/app/mes/material-receipt/receiving-form-dialog.tsx")), "I8 두 호출 화면(자재입고 · 발주 입고)의 호출 방식은 변경 없음(시그니처 유지)")
  ok(execGit("git grep -l --untracked generateReceivingLotNo -- src").split("\n").map((f) => f.trim()).filter((f) => f && f !== "src/lib/actions/receiving.actions.ts").length === 0, "I9 generateReceivingLotNo 는 다른 화면/액션에서 호출되지 않는다(호출처 영향 없음)")

  // ═══ J. 개발용 QR 테스트 페이지 접근 제한 ═════════════════════════════════
  const devPages = require("../src/lib/dev-pages") as typeof import("../src/lib/dev-pages")
  ok(devPages.isQrDevPagesEnabled({ NODE_ENV: "development" }) && devPages.isQrDevPagesEnabled({ NODE_ENV: "test" }) && devPages.isQrDevPagesEnabled({}), "J1 개발 환경(next dev 등)에서는 항상 허용")
  ok(!devPages.isQrDevPagesEnabled({ NODE_ENV: "production" }) && !devPages.isQrDevPagesEnabled({ NODE_ENV: "production", ENABLE_QR_DEV_PAGES: "false" }), "J2 운영 환경은 기본 차단")
  ok(devPages.isQrDevPagesEnabled({ NODE_ENV: "production", ENABLE_QR_DEV_PAGES: "true" }) && !devPages.isQrDevPagesEnabled({ NODE_ENV: "production", ENABLE_QR_DEV_PAGES: "1" }) && !devPages.isQrDevPagesEnabled({ NODE_ENV: "production", ENABLE_QR_DEV_PAGES: "TRUE" }), "J3 production build 테스트는 서버 환경변수 ENABLE_QR_DEV_PAGES=true 로만 허용(정확히 'true' 일 때만)")
  for (const p of ["src/app/label-print/samples/page.tsx", "src/app/label-print/scan/page.tsx", "src/app/label-print/scan/issue-lot/page.tsx"]) {
    const s = read(p)
    ok(s.includes("if (!isQrDevPagesEnabled()) notFound()") && s.includes('export const dynamic = "force-dynamic"') && !s.includes("NEXT_PUBLIC_"), `J4 ${p}: 요청 시점 환경변수로 게이트(404) · 빌드 시점에 굳지 않음 · NEXT_PUBLIC 미사용`)
  }
  const realPrint = read("src/app/label-print/page.tsx")
  ok(!realPrint.includes("dev-pages") && execGit("git diff --name-only HEAD -- src/app/label-print/page.tsx src/app/label-print/label-print-client.tsx src/middleware.ts") === "", "J5 실제 라벨 출력 경로(/label-print)와 미들웨어는 변경하지 않았다 — 접근 제한은 점검 페이지 3개에만 적용")
  ok(!read("src/lib/dev-pages.ts").includes("process.env.NEXT_PUBLIC") && !/ENABLE_QR_DEV_PAGES/.test(read("src/components/common/qr-scanner/qr-scanner-dialog.tsx") + read("src/app/app/mes/material-issue/lot-qr-scan-section.tsx")), "J6 업무 화면(자재출고 QR 스캔 · 스캐너 컴포넌트)은 이 환경변수와 무관 — 실제 업무에서 QR 기능은 그대로 동작")

  // ═══ K. 문구 · 권한 조회 성능 ═══════════════════════════════════════════
  const dlg = read("src/app/app/mes/material-issue/issue-form-dialog.tsx")
  ok(!dlg.includes("현재 출고 가능한 LOT만 표시됩니다") && dlg.includes("격리·보류·소진·만료 LOT는 목록에 표시되지만 선택할 수 없습니다") && dlg.includes('text-[13px] text-amber-700" data-testid="issue-lot-blocked-note"'), "K1 수동 LOT 선택 안내 문구가 실제 동작(제한 LOT 는 표시되되 선택 불가)과 일치 · 새 안내 글자 크기 13px")
  ok(!read("src/lib/label/wip-label-eligibility.ts").includes("material-issue.actions.ts 는 수정하지 않았다") && !read("docs/DAEWON-QR-MATERIAL-ISSUE.md").includes("확정 시 검사하지 않는다"), "K2 오래된 주석/문서 문구 정리")
  resetState()
  setAuth("ok", "t1", ["PURCHASE_ORDER:READ"]) // 앞쪽 자원(INVENTORY/LOT/WORK_ORDER)에는 권한이 없는 사용자
  counters.permissionSnapshots = 0
  const lotList = await issue.getLotStockByItems(["item-a"], "t1")
  ok((lotList["item-a"] ?? []).length > 0 && counters.permissionSnapshots === 1, "K3 [권한 조회] 여러 READ 권한을 확인해도 권한 스냅샷은 1회만 만든다(이전에는 자원마다 새로 조회) — 판정 결과·tenant 검증은 동일")
  setAuth("ok", "t1", [])
  counters.permissionSnapshots = 0
  ok(Object.keys(await issue.getLotStockByItems(["item-a"], "t1")).length === 0 && counters.permissionSnapshots === 1, "K4 권한이 없으면 같은 1회 조회로 거부")
  setAuth("ok")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
