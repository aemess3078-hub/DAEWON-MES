/**
 * 원자재 LOT 출고 검증 통일 테스트 — 메모리 가짜 DB(트랜잭션 롤백 모사), 실제 DB/브라우저 없음.
 *
 *  A. 공통 규칙(lot-eligibility): 상태 · 유효기간(한국 날짜, 당일까지) · 알 수 없는 상태 · 문구
 *  B. 수동 선택 목록(getLotStockByItems): 제한 LOT 에 사유 표시
 *  C. 세 경로 일치: 수동 목록 · QR 조회 · 출고 확정(issueMaterialsForWorkOrder)이 같은 LOT 를 같은 사유로 제한
 *  D. 출고 확정: 정상 출고 · 제한 LOT 거부(변경 없음) · 선택 후 상태 변경 · 선택 후 다른 사용자의 재고 사용 · Multi-LOT · 롤백
 *  E. 기존 업무 회귀: 비LOT 품목 · WIP 1회 생성/재사용 · 예약 갱신 · 소스 구조(재고 차감/수량/WIP 로직 불변)
 *
 * 실제 PostgreSQL 의 트랜잭션 격리/잠금, 실제 데이터 분포, 실제 화면 클릭은 이 테스트로 검증되지 않는다(미검증 항목).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import { CORE_ISSUE_BASELINE_FINGERPRINTS, between, coreIssueFingerprints, qrCouplingViolations, schemaViolations } from "./test-support/source-invariants"

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
async function main() {
  // ─── A. 공통 규칙 ──────────────────────────────────────────────────────────
  const now = new Date("2026-10-27T03:00:00Z") // KST 2026-10-27 12:00
  const e = (status: unknown, expiryDate?: Date | string | null, at: Date = now) => elig.evaluateLotIssueEligibility({ status, expiryDate }, at)
  ok(e("ACTIVE").eligible, "A1 ACTIVE · 유효기간 없음 → 출고 가능(유효기간을 관리하지 않는 LOT 는 영향 없음)")
  ok(e("ACTIVE", null).eligible && e("ACTIVE", undefined).eligible, "A2 유효기간 null/undefined 도 허용")
  for (const [status, code, label] of [["QUARANTINE", "LOT_RESTRICTED", "격리"], ["ON_HOLD", "LOT_RESTRICTED", "보류"], ["CONSUMED", "LOT_RESTRICTED", "소진"], ["EXPIRED", "LOT_EXPIRED", "만료"]] as const) {
    const r = e(status)
    ok(!r.eligible && r.code === code && r.label === label && /[가-힣]/.test(r.message) && r.message.includes(status), `A3 ${status}(${label}) → 제한 ${code} · 사유 문구`)
  }
  ok(!e("ARCHIVED").eligible && !e("").eligible && !e(null).eligible && !e("active").eligible, "A4 정의되지 않은 상태값(대소문자 다른 값 포함)은 임의로 허용하지 않고 차단")
  ok(e("ACTIVE", "2026-10-28").eligible && e("ACTIVE", new Date("2099-12-31T00:00:00Z")).eligible, "A5 유효기간이 미래면 출고 가능")
  ok(e("ACTIVE", "2026-10-27").eligible && e("ACTIVE", new Date("2026-10-27T00:00:00Z")).eligible, "A6 유효기간 당일(한국 날짜)까지는 출고 가능")
  const past = e("ACTIVE", "2026-10-26")
  ok(!past.eligible && past.code === "LOT_EXPIRED" && past.label === "유효기간 경과" && past.message.includes("2026-10-26"), "A7 유효기간이 지난 ACTIVE LOT → 제한(만료일 표시)")
  // 한국 날짜 경계: 만료일 2026-10-26(UTC 00:00 = KST 09:00)
  const expiry = new Date("2026-10-26T00:00:00Z")
  ok(e("ACTIVE", expiry, new Date("2026-10-26T14:59:59Z")).eligible && !e("ACTIVE", expiry, new Date("2026-10-26T15:00:00Z")).eligible, "A8 한국 시간 자정(UTC 15:00)을 기준으로 유효기간 다음 날부터 제한")
  ok(e("ACTIVE", "not-a-date").eligible, "A9 해석할 수 없는 유효기간 값은 '유효기간 없음'으로 취급(기존 정상 업무를 막지 않는다)")
  ok(!e("QUARANTINE", "2099-01-01").eligible && !e("CONSUMED", null).eligible, "A10 상태 제한은 유효기간과 무관하게 적용")
  ok(elig.lotIssueBlockedMessage("LOT-1", past as never).startsWith("LOT LOT-1 출고 불가:"), "A11 확정 서버 액션용 오류 문구에 LOT 번호 포함")

  // ─── 가짜 DB ──────────────────────────────────────────────────────────────
  type Row = Record<string, unknown> & { id?: string }
  const state: Record<string, Row[]> = {}
  const resetState = () => {
    const d = (s: string) => new Date(s)
    state.items = [
      { id: "item-a", code: "RM-A", name: "원자재 A", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "KG" },
      { id: "item-b", code: "RM-B", name: "원자재 B", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA" },
      { id: "item-n", code: "RM-N", name: "비LOT 원자재", itemType: "RAW_MATERIAL", isLotTracked: false, uom: "EA" },
    ]
    state.warehouses = [{ id: "wh-1", code: "WH-1", name: "원자재창고" }, { id: "wh-2", code: "WH-2", name: "보조창고" }]
    const lot = (id: string, itemId: string, status: string, expiryDate: Date | null = null) => ({ id, tenantId: "t1", lotNo: id.toUpperCase(), itemId, status, expiryDate })
    state.lots = [
      lot("lot-ok", "item-a", "ACTIVE"),
      lot("lot-ok2", "item-a", "ACTIVE"),
      lot("lot-quar", "item-a", "QUARANTINE"),
      lot("lot-hold", "item-a", "ON_HOLD"),
      lot("lot-cons", "item-a", "CONSUMED"),
      lot("lot-exp", "item-a", "EXPIRED"),
      lot("lot-pastexp", "item-a", "ACTIVE", d("2020-01-01T00:00:00Z")),
      lot("lot-futexp", "item-a", "ACTIVE", d("2099-12-31T00:00:00Z")),
      lot("lot-b1", "item-b", "ACTIVE"),
    ]
    state.balances = [
      ...state.lots.map((l, i) => ({ id: `bal-${l.id}`, tenantId: "t1", itemId: l.itemId, lotId: l.id, warehouseId: "wh-1", qtyOnHand: 100, qtyAvailable: 100, _i: i })),
      { id: "bal-n", tenantId: "t1", itemId: "item-n", lotId: null, warehouseId: "wh-1", qtyOnHand: 50, qtyAvailable: 50 },
    ]
    state.workOrders = [
      {
        id: "wo-1",
        tenantId: "t1",
        siteId: "s1",
        itemId: "item-fg",
        plannedQty: 10,
        manufacturingNo: "26A01",
        componentIds: ["item-a", "item-b", "item-n"],
        operations: [{ id: "op-1", seq: 1, status: "PENDING", routingOperation: { workCenterId: "wc-1" } }],
      },
    ]
    for (const t of ["invTx", "woMaterialLots", "wipUnits", "wipUnitMaterialLots", "wipMovements", "reservations", "audits"]) state[t] = []
  }
  let seq = 0
  const nid = (p: string) => `${p}-${++seq}`
  let beforeDecrementHook: (() => void) | null = null
  let externalCommit: (() => void) | null = null
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
  const txClient = () => ({
    $queryRaw: async () => [],
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
      findFirst: async (a: { where: Record<string, unknown> }) => state.lots.find((l) => matches(l, a.where)) ?? null,
      findUnique: async (a: { where: { id: string } }) => state.lots.find((l) => l.id === a.where.id) ?? null,
    },
    inventoryBalance: {
      findFirst: async (a: { where: Record<string, unknown> }) => state.balances.find((b) => matches(b, a.where)) ?? null,
      updateMany: async (a: { where: Record<string, unknown>; data: { qtyOnHand: { decrement: number }; qtyAvailable: { decrement: number } } }) => {
        beforeDecrementHook?.()
        const row = state.balances.find((b) => matches(b, a.where))
        if (!row) return { count: 0 }
        row.qtyOnHand = Number(row.qtyOnHand) - a.data.qtyOnHand.decrement
        row.qtyAvailable = Number(row.qtyAvailable) - a.data.qtyAvailable.decrement
        return { count: 1 }
      },
    },
    inventoryTransaction: { create: async (a: { data: Row }) => { const row = { id: nid("itx"), ...a.data }; state.invTx.push(row); return row } },
    workOrderMaterialLot: { create: async (a: { data: Row }) => { const row = { id: nid("wml"), ...a.data }; state.woMaterialLots.push(row); return row } },
    wipUnitMaterialLot: { create: async (a: { data: Row }) => void state.wipUnitMaterialLots.push({ id: nid("wuml"), ...a.data }) },
    materialReservation: {
      findUnique: async (a: { where: { id: string } }) => state.reservations.find((r) => r.id === a.where.id) ?? null,
      findFirst: async (a: { where: Record<string, unknown> }) => state.reservations.find((r) => matches(r, a.where)) ?? null,
      update: async (a: { where: { id: string }; data: Row }) => void Object.assign(state.reservations.find((r) => r.id === a.where.id)!, a.data),
      create: async (a: { data: Row }) => void state.reservations.push({ id: nid("res"), ...a.data }),
    },
    __audit: (row: Row) => void state.audits.push(row),
  })
  const fakePrisma = {
    ...txClient(),
    item: { findMany: async (a: { where: { id: { in: string[] } } }) => state.items.filter((i) => a.where.id.in.includes(String(i.id))) },
    workOrder: {
      findUnique: async (a: { where: { id: string } }) => {
        const wo = state.workOrders.find((w) => w.id === a.where.id)
        return wo ? { ...wo, bom: { bomItems: (wo.componentIds as string[]).map((c) => ({ componentItemId: c })) } } : null
      },
      findFirst: async (a: { where: { id: string; tenantId: string } }) => {
        const wo = state.workOrders.find((w) => w.id === a.where.id && w.tenantId === a.where.tenantId)
        return wo ? { id: wo.id, bom: { bomItems: (wo.componentIds as string[]).map((c) => ({ componentItemId: c })) } } : null
      },
    },
    lot: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        const l = state.lots.find((x) => matches(x, a.where))
        return l ? { ...l, item: state.items.find((i) => i.id === l.itemId) } : null
      },
    },
    inventoryBalance: {
      findMany: async (a: { where: { tenantId: string; itemId: { in: string[] }; lotId: { not: null }; qtyAvailable: { gt: number } } }) =>
        state.balances
          .filter((b) => b.tenantId === a.where.tenantId && a.where.itemId.in.includes(String(b.itemId)) && b.lotId !== null && Number(b.qtyAvailable) > a.where.qtyAvailable.gt)
          .map((b) => ({ ...b, lot: state.lots.find((l) => l.id === b.lotId), item: { uom: state.items.find((i) => i.id === b.itemId)?.uom }, warehouse: state.warehouses.find((w) => w.id === b.warehouseId) }))
          .sort((x, y) => String((x.lot as Row).lotNo).localeCompare(String((y.lot as Row).lotNo))),
    },
    // 롤백 모사: 트랜잭션이 예외로 끝나면 시작 시점 상태로 되돌린다(PostgreSQL 의 원자성)
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
      const snapshot = structuredClone(state)
      try {
        return await fn(txClient())
      } catch (error) {
        for (const key of Object.keys(snapshot)) state[key] = snapshot[key]
        // 다른 사용자의 트랜잭션은 이미 커밋된 상태이므로 롤백 후에도 그 변경은 남는다
        externalCommit?.()
        externalCommit = null
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
  const actor = { tenantId: "t1", id: "user-1", name: "작업자", profileId: "p1" }
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("../src/lib/auth", { getTenantId: async () => "t1", getCurrentUser: async () => actor, requireRole: async () => actor })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async () => actor,
    getCurrentPermissionSnapshot: async () => ({ user: actor }),
    hasResourcePermission: () => true,
  })
  inject("../src/lib/audit-log", {
    recordAuditLog: async (db: { __audit: (r: Row) => void }, p: Row) => db.__audit({ entityType: p.entityType, action: p.action, tenantId: p.tenantId }),
    summarizeAuditItems: (items: unknown) => items,
  })
  const issue = require("../src/lib/actions/material-issue.actions") as typeof import("../src/lib/actions/material-issue.actions")
  const lookup = require("../src/lib/actions/material-issue-lot-lookup.actions") as typeof import("../src/lib/actions/material-issue-lot-lookup.actions")
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
  const request = (lots: Array<{ lotId: string; warehouseId?: string; quantity: number }>, itemId = "item-a") => ({
    workOrderId: "wo-1",
    siteId: "s1",
    items: [{ itemId, issueQty: lots.reduce((s, l) => s + l.quantity, 0), lots: lots.map((l) => ({ warehouseId: "wh-1", ...l })), requiredQty: 60, reservationId: null }],
  })
  const bal = (id: string) => Number(state.balances.find((b) => b.id === id)!.qtyAvailable)

  // ─── B. 수동 선택 목록 ─────────────────────────────────────────────────────
  resetState()
  const list = (await issue.getLotStockByItems(["item-a"], "t1"))["item-a"]
  const byLot = (id: string) => list.find((o) => o.lotId === id)!
  ok(list.length === 8 && byLot("lot-ok").issueBlockReason === null && byLot("lot-futexp").issueBlockReason === null, "B1 정상 LOT(유효기간 미래 포함)는 출고 가능(사유 없음)")
  ok(byLot("lot-quar").issueBlockLabel === "격리" && byLot("lot-hold").issueBlockLabel === "보류" && byLot("lot-cons").issueBlockLabel === "소진" && byLot("lot-exp").issueBlockLabel === "만료" && byLot("lot-pastexp").issueBlockLabel === "유효기간 경과", "B2 [수동 목록] 격리·보류·소진·만료·유효기간 경과 LOT 에 사유 라벨")
  ok(list.every((o) => o.qtyAvailable > 0 && o.warehouseCode === "WH-1" && o.unit === "KG"), "B3 기존 필드(창고·가용수량·단위)는 그대로, 가용재고 0 은 목록에 없음")
  state.balances.find((b) => b.id === "bal-lot-ok2")!.qtyAvailable = 0
  ok(!(await issue.getLotStockByItems(["item-a"], "t1"))["item-a"].some((o) => o.lotId === "lot-ok2"), "B4 가용재고 0 인 LOT 는 목록에서 제외(기존 규칙 유지)")

  // ─── C. 세 경로 일치 + D. 출고 확정 ────────────────────────────────────────
  const restricted = [
    ["lot-quar", "LOT_RESTRICTED", "격리"],
    ["lot-hold", "LOT_RESTRICTED", "보류"],
    ["lot-cons", "LOT_RESTRICTED", "소진"],
    ["lot-exp", "LOT_EXPIRED", "만료"],
    ["lot-pastexp", "LOT_EXPIRED", "유효기간 경과"],
  ] as const
  for (const [lotId, code, label] of restricted) {
    resetState()
    const lotNo = lotId.toUpperCase()
    const manualOpt = (await issue.getLotStockByItems(["item-a"], "t1"))["item-a"].find((o) => o.lotId === lotId)!
    const qr = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo })
    const before = snap()
    const res = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId, quantity: 10 }]), "t1"))
    ok(manualOpt.issueBlockLabel === label && !qr.ok && qr.code === code && qr.message === manualOpt.issueBlockReason && !res.ok && String(res.error).includes(manualOpt.issueBlockReason as string) && String(res.error).includes(lotNo), `C1 [${label}] 수동 목록 = QR 조회 = 출고 확정이 같은 LOT 를 같은 사유로 제한`)
    ok(snap() === before && state.invTx.length === 0 && state.wipUnits.length === 0 && state.reservations.length === 0 && state.audits.length === 0 && bal(`bal-${lotId}`) === 100, `D1 [${label}] 거부된 출고는 재고·수불·예약·WIP·감사 이력을 하나도 남기지 않는다`)
  }

  // 정상 LOT 수동 출고
  resetState()
  const okRes = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }]), "t1"))
  ok(okRes.ok && bal("bal-lot-ok") === 70 && state.invTx.length === 1 && state.invTx[0].qty === 30 && state.invTx[0].lotId === "lot-ok", "D2 [정상 LOT 수동 출고] 재고 차감 · 수불 1건")
  ok(state.wipUnits.length === 1 && state.wipUnits[0].status === "WAITING" && state.wipMovements.length === 1 && state.woMaterialLots.length === 1 && state.wipUnitMaterialLots.length === 1 && state.audits.length === 1, "D3 WIP 1건 생성(CREATED 이동) · 자재 LOT 연결 · 감사 이력 1건 — 기존 업무 그대로")
  ok(state.reservations.length === 1 && state.reservations[0].issuedQty === 30 && state.reservations[0].status === "PARTIAL", "D4 자재예약 갱신(출고 30 / 필요 60 → PARTIAL)")
  const manualState = JSON.stringify({ bal: bal("bal-lot-ok"), itx: state.invTx.length, wip: state.wipUnits.length, res: state.reservations.map((r) => [r.issuedQty, r.status]) })

  // 정상 LOT QR 선택 후 출고: 조회 결과의 후보로 같은 서버 액션을 호출 → 수동과 같은 결과
  resetState()
  const qrFound = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  const qrRes = qrFound.ok ? await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: qrFound.options[0].lotId, warehouseId: qrFound.options[0].warehouseId, quantity: 30 }]), "t1")) : { ok: false }
  const qrState = JSON.stringify({ bal: bal("bal-lot-ok"), itx: state.invTx.length, wip: state.wipUnits.length, res: state.reservations.map((r) => [r.issuedQty, r.status]) })
  ok(qrFound.ok && qrRes.ok && qrState === manualState, "D5 [정상 LOT QR 선택 후 출고] 수동 출고와 업무 처리 결과가 동일(QR 전용 처리 없음)")
  const futureOk = qrFound.ok
  resetState()
  const futRes = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-futexp", quantity: 5 }]), "t1"))
  ok(futureOk && futRes.ok, "D6 유효기간이 미래인 정상 LOT 는 계속 출고 가능")

  // 선택 후 출고 전에 LOT 상태가 바뀐 경우 / 유효기간이 지난 경우
  resetState()
  const selected = await lookup.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-OK" })
  state.lots.find((l) => l.id === "lot-ok")!.status = "QUARANTINE" // 다른 사용자가 LOT 관리에서 격리 처리
  const before8 = snap()
  const r8 = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  ok(selected.ok && !r8.ok && String(r8.error).includes("격리") && snap() === before8, "D7 [선택 후 출고 전에 LOT 상태가 변경] 출고 확정에서 DB 최신 상태로 다시 검증해 거부 · 변경 없음")
  resetState()
  state.lots.find((l) => l.id === "lot-ok")!.expiryDate = new Date("2020-01-01T00:00:00Z")
  const r8b = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 10 }]), "t1"))
  ok(!r8b.ok && String(r8b.error).includes("유효기간") && state.invTx.length === 0, "D8 선택 후 유효기간이 지난 경우도 확정에서 거부")

  // 가용재고 부족 / 선택 후 다른 사용자가 재고를 출고한 경우
  resetState()
  const r7 = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 150 }]), "t1"))
  ok(!r7.ok && String(r7.error).includes("가용재고 부족") && state.invTx.length === 0 && bal("bal-lot-ok") === 100, "D9 [가용재고 부족] 출고 차단 · 변경 없음(기존 검증 유지)")
  resetState()
  state.balances.find((b) => b.id === "bal-lot-ok")!.qtyAvailable = 10
  state.balances.find((b) => b.id === "bal-lot-ok")!.qtyOnHand = 10 // 선택 후 다른 사용자가 90 을 출고함
  const r9 = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }]), "t1"))
  ok(!r9.ok && String(r9.error).includes("가용재고 부족") && state.invTx.length === 0 && state.wipUnits.length === 0, "D10 [선택 후 다른 사용자가 재고를 출고] 확정 시 최신 재고로 거부")
  resetState()
  const competitor = () => {
    state.balances.find((b) => b.id === "bal-lot-ok")!.qtyAvailable = 5
    state.balances.find((b) => b.id === "bal-lot-ok")!.qtyOnHand = 5
  }
  beforeDecrementHook = () => {
    // 조회와 차감 사이에 다른 트랜잭션이 재고를 가져간 경우(경쟁): 차감 조건(gte) 불충족 → 실패
    competitor()
    externalCommit = competitor
    beforeDecrementHook = null
  }
  const before10 = snap()
  const r10 = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }]), "t1"))
  beforeDecrementHook = null
  ok(!r10.ok && String(r10.error).includes("다른 작업으로 재고가 변경") && state.invTx.length === 0 && state.wipUnits.length === 0 && state.reservations.length === 0 && state.audits.length === 0 && bal("bal-lot-ok") === 5 && snap() !== before10, "D11 조회~차감 사이의 동시 재고 사용: 차감 조건 불충족으로 실패하고 이미 쓴 수불/WIP 까지 전부 롤백(재고는 경쟁 상대가 바꾼 값만 남음)")

  // Multi-LOT
  resetState()
  const multi = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }, { lotId: "lot-futexp", quantity: 20 }]), "t1"))
  ok(multi.ok && bal("bal-lot-ok") === 70 && bal("bal-lot-futexp") === 80 && state.invTx.length === 2 && state.woMaterialLots.length === 2 && state.wipUnits.length === 1 && state.wipUnitMaterialLots.length === 2 && state.reservations[0].issuedQty === 50, "D12 [Multi-LOT 출고] LOT 별 수량대로 차감 · 수불/자재LOT 2건 · WIP 1건 · 예약 합산 50")
  resetState()
  const before12 = snap()
  const multiBad = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok", quantity: 30 }, { lotId: "lot-quar", quantity: 20 }]), "t1"))
  ok(!multiBad.ok && String(multiBad.error).includes("LOT-QUAR") && snap() === before12 && bal("bal-lot-ok") === 100 && state.wipUnits.length === 0 && state.invTx.length === 0, "D13 Multi-LOT 중 하나만 제한 LOT 여도 요청 전체 거부 — 앞선 LOT 의 차감/WIP/수불까지 롤백")
  resetState()
  const multiBad2 = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-quar", quantity: 20 }, { lotId: "lot-ok", quantity: 30 }]), "t1"))
  ok(!multiBad2.ok && snap() === JSON.stringify(state) && state.invTx.length === 0, "D14 제한 LOT 가 첫 번째여도 동일")

  // E. 기존 업무 회귀
  resetState()
  const mixed = await silence(() =>
    issue.issueMaterialsForWorkOrder(
      {
        workOrderId: "wo-1",
        siteId: "s1",
        items: [
          { itemId: "item-a", issueQty: 10, lots: [{ lotId: "lot-ok", warehouseId: "wh-1", quantity: 10 }], requiredQty: 20, reservationId: null },
          { itemId: "item-n", issueQty: 7, warehouseId: "wh-1", requiredQty: 7, reservationId: null },
        ],
      },
      "t1",
    ),
  )
  ok(mixed.ok && bal("bal-lot-ok") === 90 && Number(state.balances.find((b) => b.id === "bal-n")!.qtyAvailable) === 43 && state.wipUnits.length === 1, "E1 [회귀] LOT 품목 + 비LOT 품목 동시 출고 정상(비LOT 품목은 LOT 규칙 영향 없음)")
  const second = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-ok2", quantity: 5 }]), "t1"))
  ok(second.ok && state.wipUnits.length === 1 && state.wipMovements.length === 1, "E2 두 번째 출고는 기존 WIP 을 재사용(WIP 새로 만들지 않음)")
  resetState()
  const noLot = await silence(() => issue.issueMaterialsForWorkOrder({ workOrderId: "wo-1", siteId: "s1", items: [{ itemId: "item-a", issueQty: 5, requiredQty: 5, reservationId: null }] }, "t1"))
  ok(!noLot.ok && String(noLot.error).includes("LOT를 지정"), "E3 LOT 관리 품목에 LOT 를 지정하지 않으면 기존대로 거부")
  resetState()
  const missingLot = await silence(() => issue.issueMaterialsForWorkOrder(request([{ lotId: "lot-nope", quantity: 5 }]), "t1"))
  ok(!missingLot.ok && String(missingLot.error).includes("재고 없음"), "E4 없는 LOT 는 기존처럼 '재고 없음' 으로 거부(새 오류 경로 없음)")

  // 소스 구조
  const src = read("src/lib/actions/material-issue.actions.ts")
  const dlg = read("src/app/app/mes/material-issue/issue-form-dialog.tsx")
  const lk = read("src/lib/actions/material-issue-lot-lookup.actions.ts")
  ok(src.includes("evaluateLotIssueEligibility") && lk.includes("evaluateLotIssueEligibility") && !/ISSUABLE_LOT_STATUSES/.test(lk + read("src/lib/material-issue/lot-scan.ts")), "E5 수동 목록·QR 조회·출고 확정이 같은 공통 함수를 쓰고, QR 전용 상태 목록은 없다")
  ok(!/qr|scan/i.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")) , "E6 출고 확정 서버 액션에는 QR/스캔 분기가 없다(QR 여부를 출고 허용 조건으로 쓰지 않음)")
  // E7: 재고 차감·수량 검증·수불·WIP 생성/재사용·예약 갱신 코드는 QR 작업 이전 코드와 동일(정규화한 코드 블록의 지문 비교)
  const coreNow = coreIssueFingerprints(src)
  const coreChanged = Object.keys(CORE_ISSUE_BASELINE_FINGERPRINTS).filter((k) => coreNow[k] !== CORE_ISSUE_BASELINE_FINGERPRINTS[k])
  ok(coreChanged.length === 0, `E7 출고 서버 액션의 재고 차감·수량 계산·수불·WIP 생성/재사용·예약 갱신 코드 7개 블록은 QR 작업 이전과 동일${coreChanged.length ? " — 변경됨: " + coreChanged.join(", ") : ""}`)
  // E8: 적격성 확인(잠금 + LOT 상태 확인)에 추가된 코드 자체에는 재고 차감/수량 계산이 없다
  const addedEligibility = [between(src, "const lotIdsToLock", "// ── 0. WipUnit"), between(src, "const lotState = await tx.lot.findFirst", "if (warehouseId) {")]
  ok(addedEligibility.every((block) => block !== null && !/decrement|updateMany|qtyOnHand|issueQty\s*[-+*/]=/.test(block)), "E8 적격성 확인(LOT 잠금·상태 재확인) 코드에는 재고 차감/수량 계산이 없다")
  ok(dlg.includes("disabled={Boolean(lotStock.issueBlockReason)}") && dlg.includes("if (lot?.issueBlockReason)") && dlg.includes("<Select") && dlg.includes("addLotSplit"), "E9 수동 선택 UI: 제한 LOT 는 사유와 함께 선택 불가 표시 · 확정 전 안내, 기존 수동 선택/행 추가 그대로")
  ok(read("src/app/app/mes/material-issue/lot-qr-scan-section.tsx").includes('process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"'), "E10 [QR 비활성화] 스위치를 켜도 수동 출고 경로는 같은 서버 액션 — D2/D3 의 수동 출고가 QR 없이 완료됨")
  ok(qrCouplingViolations(["src/lib/actions/inventory.actions.ts", "src/lib/actions/lot.actions.ts"]).length === 0 && schemaViolations().length === 0, "E11 스키마·재고관리·LOT 관리 서버 로직은 QR/출고 모듈에 결합되지 않았고 스키마 변경이 없다")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
