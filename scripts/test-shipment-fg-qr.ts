/**
 * 완제품 출하 QR 연동(4-3단계) 테스트 — 가짜 DB, 브라우저/실제 DB/로그인 없음.
 *
 *  A. LOT 선택 반영 규칙(lib/shipment/fg-lot-scan.ts): 빈 행 채움 · 행 추가 · 중복 방지 · 입력 수량 보존 · 비LOT 품목
 *  B. 서버 조회(lookupLotForShipment, 가짜 Prisma + 실제 getAvailableFinishedGoodsLots/품질 출하 제한):
 *     정상 · 품목 일치 · 수동 목록과 동일 · 원자재/다른 품목/없는 LOT/다른 tenant · 제한 상태 · 품질 제한 · 재고 없음 · 예약 · 다른 창고 · 입력 거부 · 권한 · 읽기 전용
 *  C. 소스 구조: 기존 수동 선택/출하 등록·확정·삭제 코드 무변경(지문), QR 전용 출하 경로 없음, 선택적 기능(스위치), 다른 화면 미연동
 *
 * 실제 DB 의 쿼리 동작, 로그인/권한 데이터, 실제 화면 클릭, 실제 카메라는 이 테스트로 검증되지 않는다(미검증 항목).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import { between, fingerprint, listFiles, qrCouplingViolations, readSource, schemaViolations, stripComments } from "./test-support/source-invariants"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const scan = require("../src/lib/shipment/fg-lot-scan") as typeof import("../src/lib/shipment/fg-lot-scan")
const qrLib = require("../src/lib/qr/qr-scan-result") as typeof import("../src/lib/qr/qr-scan-result")
const lotLib = require("../src/lib/qr/lot-qr") as typeof import("../src/lib/qr/lot-qr")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

async function main() {
  // ─── A. 반영 규칙 ──────────────────────────────────────────────────────────
  const original = [{ lotId: "", qty: 0 }]
  const frozen = JSON.parse(JSON.stringify(original))
  const p1 = scan.planScannedFgLot(original, "lot-1")
  ok(p1.outcome === "FILLED_EMPTY_ROW" && p1.rowIndex === 0 && p1.preserveQty === null, "A1 [정상] LOT 가 비어 있는 첫 행에 채운다")
  eq(original, frozen, "A2 입력 배열을 변경하지 않는다(불변)")
  const p2 = scan.planScannedFgLot([{ lotId: "lot-1", qty: 30 }], "lot-2")
  ok(p2.outcome === "ADDED_ROW" && p2.rowIndex === 1 && p2.preserveQty === null, "A3 [Multi-LOT] 모든 행에 LOT 가 있으면 새 행을 추가 — 기존 행은 그대로")
  const p3 = scan.planScannedFgLot([{ lotId: "lot-1", qty: 30 }, { lotId: "lot-2", qty: 5 }], "lot-1")
  ok(p3.outcome === "ALREADY_SELECTED" && p3.rowIndex === 0, "A4 [중복 방지] 이미 선택된 LOT 는 변경 없음(두 번째 행이어도 동일)")
  const p4 = scan.planScannedFgLot([{ lotId: "lot-1", qty: 30 }, { lotId: "", qty: 7 }], "lot-9")
  ok(p4.outcome === "FILLED_EMPTY_ROW" && p4.rowIndex === 1 && p4.preserveQty === 7, "A5 [수량 보존] LOT 가 비어 있고 사용자가 수량(7)을 이미 입력한 행은 그 수량을 보존하도록 알린다")
  const p5 = scan.planScannedFgLot([], "lot-1")
  ok(p5.outcome === "ADDED_ROW" && p5.rowIndex === 0, "A6 행이 하나도 없으면 새 행")
  ok(scan.checkFgScanTarget({ itemId: "i", isLotTracked: true }).ok, "A7 LOT 관리 품목 행은 QR 선택 대상")
  const nl = scan.checkFgScanTarget({ itemId: "i", isLotTracked: false })
  ok(!nl.ok && nl.message.includes("LOT 관리 품목이 아니어서"), "A8 [비LOT 품목] LOT 선택 대상이 아니라고 안내(수량 직접 입력)")
  ok(!scan.checkFgScanTarget(null).ok, "A9 품목 행을 확인할 수 없으면 거부")
  ok(Object.values(scan.SHIPMENT_LOT_LOOKUP_MESSAGES).every((m) => /[가-힣]/.test(m)) && Object.keys(scan.SHIPMENT_LOT_LOOKUP_MESSAGES).length === 12, "A10 모든 거부 사유에 한국어 안내")
  const wipParsed = qrLib.parseQrScan(lotLib.encodeWipQr("wip-1"))
  const lotParsed = qrLib.parseQrScan(lotLib.encodeLotQr("FG-LOT-1"))
  ok(wipParsed.ok && wipParsed.result.kind === "WIP" && lotParsed.ok && lotParsed.result.kind === "LOT" && lotParsed.result.id === "FG-LOT-1", "A11 [WIP QR] kind WIP(화면에서 거부), LOT QR 은 kind LOT(서버 조회) — 완제품 LOT QR 은 원자재 LOT QR 과 같은 규격")
  for (const bad of ["DAEWON|LOT|9|X", "DAEWON|LOT|1|", "DAEWON|BATCH|1|X", "DAEWON|SHIPMENT|1|X", "FOO|LOT|1|X", "HELLO"]) {
    ok(!qrLib.parseQrScan(bad).ok, `A12 [잘못된 QR] 스캐너 단계에서 거부: ${bad}`)
  }

  // ─── B. 서버 조회(가짜 Prisma) ─────────────────────────────────────────────
  type Item = { id: string; code: string; name: string; itemType: string; isLotTracked: boolean }
  const items: Record<string, Item> = {
    "fg-a": { id: "fg-a", code: "FG-A", name: "완제품 A", itemType: "FINISHED", isLotTracked: true },
    "fg-b": { id: "fg-b", code: "FG-B", name: "완제품 B", itemType: "FINISHED", isLotTracked: true },
    "rm-a": { id: "rm-a", code: "RM-A", name: "원자재 A", itemType: "RAW_MATERIAL", isLotTracked: true },
    "cons-a": { id: "cons-a", code: "CS-A", name: "소모품 A", itemType: "CONSUMABLE", isLotTracked: true },
    "semi-a": { id: "semi-a", code: "SM-A", name: "반제품 A", itemType: "SEMI_FINISHED", isLotTracked: true },
    "fg-t2": { id: "fg-t2", code: "FG-T2", name: "타 tenant 완제품", itemType: "FINISHED", isLotTracked: true },
  }
  const warehouses: Record<string, { id: string; tenantId: string; siteId: string; name: string }> = {
    "wh-1": { id: "wh-1", tenantId: "t1", siteId: "s1", name: "완제품창고" },
    "wh-2": { id: "wh-2", tenantId: "t1", siteId: "s1", name: "보조창고" },
    "wh-t2": { id: "wh-t2", tenantId: "t2", siteId: "s2", name: "타 tenant 창고" },
  }
  type LotRow = { id: string; tenantId: string; lotNo: string; status: string; itemId: string }
  const lots: LotRow[] = [
    { id: "lot-1", tenantId: "t1", lotNo: "FG-LOT-1", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-2", tenantId: "t1", lotNo: "FG-LOT-2", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-part", tenantId: "t1", lotNo: "FG-LOT-PART", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-res", tenantId: "t1", lotNo: "FG-LOT-RES", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-nostock", tenantId: "t1", lotNo: "FG-LOT-NOSTOCK", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-nobal", tenantId: "t1", lotNo: "FG-LOT-NOBAL", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-wh2", tenantId: "t1", lotNo: "FG-LOT-WH2", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-quar", tenantId: "t1", lotNo: "FG-LOT-QUAR", status: "QUARANTINE", itemId: "fg-a" },
    { id: "lot-hold", tenantId: "t1", lotNo: "FG-LOT-HOLD", status: "ON_HOLD", itemId: "fg-a" },
    { id: "lot-cons", tenantId: "t1", lotNo: "FG-LOT-CONS", status: "CONSUMED", itemId: "fg-a" },
    { id: "lot-exp", tenantId: "t1", lotNo: "FG-LOT-EXP", status: "EXPIRED", itemId: "fg-a" },
    { id: "lot-qfail", tenantId: "t1", lotNo: "FG-LOT-QFAIL", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-qpend", tenantId: "t1", lotNo: "FG-LOT-QPEND", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-qpass", tenantId: "t1", lotNo: "FG-LOT-QPASS", status: "ACTIVE", itemId: "fg-a" },
    { id: "lot-b1", tenantId: "t1", lotNo: "FG-B-1", status: "ACTIVE", itemId: "fg-b" },
    { id: "lot-rm", tenantId: "t1", lotNo: "RM-LOT-1", status: "ACTIVE", itemId: "rm-a" },
    { id: "lot-cs", tenantId: "t1", lotNo: "CS-LOT-1", status: "ACTIVE", itemId: "cons-a" },
    { id: "lot-semi", tenantId: "t1", lotNo: "SM-LOT-1", status: "ACTIVE", itemId: "semi-a" },
    // 다른 tenant: 같은 번호를 가진 별개 LOT 와 t2 전용 LOT
    { id: "lot-t2-1", tenantId: "t2", lotNo: "FG-LOT-1", status: "ACTIVE", itemId: "fg-t2" },
    { id: "lot-t2-only", tenantId: "t2", lotNo: "FG-T2-ONLY", status: "ACTIVE", itemId: "fg-t2" },
  ]
  type Balance = { id: string; tenantId: string; siteId: string; itemId: string; lotId: string | null; warehouseId: string; qtyAvailable: number; qtyOnHand: number }
  let seq = 0
  const bal = (itemId: string, lotId: string | null, warehouseId: string, qty: number, tenantId = "t1"): Balance => ({
    id: `bal-${++seq}`,
    tenantId,
    siteId: warehouses[warehouseId].siteId,
    itemId,
    lotId,
    warehouseId,
    qtyAvailable: qty,
    qtyOnHand: qty,
  })
  const balances: Balance[] = [
    bal("fg-a", "lot-1", "wh-1", 100),
    bal("fg-a", "lot-1", "wh-2", 0),
    bal("fg-a", "lot-2", "wh-1", 40),
    bal("fg-a", "lot-part", "wh-1", 50),
    bal("fg-a", "lot-res", "wh-1", 20),
    bal("fg-a", "lot-nostock", "wh-1", 0),
    bal("fg-a", "lot-wh2", "wh-2", 15),
    bal("fg-a", "lot-quar", "wh-1", 10),
    bal("fg-a", "lot-hold", "wh-1", 10),
    bal("fg-a", "lot-cons", "wh-1", 10),
    bal("fg-a", "lot-exp", "wh-1", 10),
    bal("fg-a", "lot-qfail", "wh-1", 10),
    bal("fg-a", "lot-qpend", "wh-1", 10),
    bal("fg-a", "lot-qpass", "wh-1", 10),
    bal("fg-b", "lot-b1", "wh-1", 25),
    bal("rm-a", "lot-rm", "wh-1", 99),
    bal("cons-a", "lot-cs", "wh-1", 9),
    bal("semi-a", "lot-semi", "wh-1", 9),
    bal("fg-t2", "lot-t2-1", "wh-t2", 9, "t2"),
    bal("fg-t2", "lot-t2-only", "wh-t2", 9, "t2"),
  ]
  // 출하예정(PLANNED) 예약: lot-part 20, lot-res 20(전량)
  const plannedItems = [
    { itemId: "fg-a", lotId: "lot-part", qty: 20, tenantId: "t1", warehouseId: "wh-1", siteId: "s1", status: "PLANNED" },
    { itemId: "fg-a", lotId: "lot-res", qty: 20, tenantId: "t1", warehouseId: "wh-1", siteId: "s1", status: "PLANNED" },
  ]
  // 생산입고(품질 출하 제한 판정용)
  const receipts = [
    { tenantId: "t1", lotId: "lot-qfail", workOrderId: "wo-qfail", warehouseId: "wh-1", siteId: "s1", receiptAt: new Date("2026-01-01"), location: { id: "loc-1", name: "A-01" } },
    { tenantId: "t1", lotId: "lot-qpend", workOrderId: "wo-qpend", warehouseId: "wh-1", siteId: "s1", receiptAt: new Date("2026-01-01"), location: null },
    { tenantId: "t1", lotId: "lot-qpass", workOrderId: "wo-qpass", warehouseId: "wh-1", siteId: "s1", receiptAt: new Date("2026-01-01"), location: null },
    { tenantId: "t1", lotId: "lot-1", workOrderId: "wo-nospec", warehouseId: "wh-1", siteId: "s1", receiptAt: new Date("2026-01-01"), location: { id: "loc-2", name: "B-07" } },
  ]
  const workOrders: Record<string, { itemId: string; specId: string | null; inspections: Array<{ id: string; inspectionSpecId: string; stage: string; result: string | null; inspectedAt: Date; lotId: string | null }> }> = {
    "wo-qfail": { itemId: "fg-a", specId: "spec-1", inspections: [{ id: "i1", inspectionSpecId: "spec-1", stage: "FINAL", result: "FAIL", inspectedAt: new Date("2026-01-02"), lotId: "lot-qfail" }] },
    "wo-qpend": { itemId: "fg-a", specId: "spec-1", inspections: [] },
    "wo-qpass": { itemId: "fg-a", specId: "spec-1", inspections: [{ id: "i2", inspectionSpecId: "spec-1", stage: "FINAL", result: "PASS", inspectedAt: new Date("2026-01-02"), lotId: "lot-qpass" }] },
    "wo-nospec": { itemId: "fg-a", specId: null, inspections: [] },
  }

  const accessed: string[] = []
  const snapshot = () => JSON.stringify({ balances, plannedItems, lots, receipts })
  const before = snapshot()
  // 허용된 읽기 메서드만 노출 — 쓰기/트랜잭션/원시 쿼리에 접근하면 즉시 실패한다.
  const guard = <T extends object>(name: string, methods: T): T =>
    new Proxy(methods, {
      get(target, prop) {
        if (typeof prop === "symbol" || !(prop in target)) throw new Error(`쓰기/허용되지 않은 접근: ${name}.${String(prop)}`)
        accessed.push(`${name}.${prop}`)
        return (target as Record<string, unknown>)[prop]
      },
    })
  type BalanceWhere = {
    tenantId: string
    siteId?: string
    warehouseId?: string | { not: string }
    itemId?: string | { in: string[] }
    lotId?: string | { not: null }
    qtyAvailable?: { gt: number }
    lot?: { status: string }
  }
  const matchesBalance = (b: Balance, w: BalanceWhere) => {
    if (b.tenantId !== w.tenantId) return false
    if (w.siteId && b.siteId !== w.siteId) return false
    if (typeof w.warehouseId === "string" && b.warehouseId !== w.warehouseId) return false
    if (w.warehouseId && typeof w.warehouseId === "object" && b.warehouseId === w.warehouseId.not) return false
    if (typeof w.itemId === "string" && b.itemId !== w.itemId) return false
    if (w.itemId && typeof w.itemId === "object" && !w.itemId.in.includes(b.itemId)) return false
    if (typeof w.lotId === "string" && b.lotId !== w.lotId) return false
    if (w.lotId && typeof w.lotId === "object" && b.lotId === null) return false
    if (w.qtyAvailable && !(b.qtyAvailable > w.qtyAvailable.gt)) return false
    if (w.lot && lots.find((l) => l.id === b.lotId)?.status !== w.lot.status) return false
    return true
  }
  const fakePrisma = new Proxy(
    {
      warehouse: guard("warehouse", {
        findFirst: async (a: { where: { id: string; tenantId: string } }) => {
          const w = warehouses[a.where.id]
          return w && w.tenantId === a.where.tenantId ? { id: w.id, siteId: w.siteId } : null
        },
      }),
      lot: guard("lot", {
        findFirst: async (a: { where: { tenantId: string; lotNo: string } }) => {
          const lot = lots.find((l) => l.tenantId === a.where.tenantId && l.lotNo === a.where.lotNo)
          return lot ? { ...lot, item: items[lot.itemId] } : null
        },
      }),
      inventoryBalance: guard("inventoryBalance", {
        findMany: async (a: { where: BalanceWhere }) =>
          balances
            .filter((b) => matchesBalance(b, a.where))
            .map((b) => ({
              ...b,
              warehouse: { id: b.warehouseId, name: warehouses[b.warehouseId].name },
              lot: lots.find((l) => l.id === b.lotId) ?? null,
            }))
            .sort((x, y) => String(x.lot?.lotNo).localeCompare(String(y.lot?.lotNo))),
        findFirst: async (a: { where: BalanceWhere }) => balances.find((b) => matchesBalance(b, a.where)) ?? null,
      }),
      shipmentItem: guard("shipmentItem", {
        groupBy: async (a: { where: { shipmentOrder: { tenantId: string; warehouseId: string; siteId: string; status: string }; itemId: { in: string[] } } }) => {
          const rows = plannedItems.filter((r) => r.tenantId === a.where.shipmentOrder.tenantId && r.warehouseId === a.where.shipmentOrder.warehouseId && r.status === a.where.shipmentOrder.status && a.where.itemId.in.includes(r.itemId))
          const byLot = new Map<string, number>()
          for (const r of rows) byLot.set(r.lotId, (byLot.get(r.lotId) ?? 0) + r.qty)
          return Array.from(byLot).map(([lotId, qty]) => ({ itemId: rows.find((r) => r.lotId === lotId)!.itemId, lotId, _sum: { qty } }))
        },
      }),
      finishedGoodsReceipt: guard("finishedGoodsReceipt", {
        findMany: async (a: { where: { tenantId: string; lotId: string | { in: string[] }; warehouseId?: string } }) =>
          receipts
            .filter((r) => r.tenantId === a.where.tenantId && (typeof a.where.lotId === "string" ? r.lotId === a.where.lotId : a.where.lotId.in.includes(r.lotId)) && (!a.where.warehouseId || r.warehouseId === a.where.warehouseId))
            .map((r) => ({ lotId: r.lotId, workOrderId: r.workOrderId, location: r.location, receiptAt: r.receiptAt })),
      }),
      workOrder: guard("workOrder", {
        findFirst: async (a: { where: { id: string; tenantId: string } }) => {
          const wo = workOrders[a.where.id]
          if (!wo) return null
          return { itemId: wo.itemId, operations: [{ id: "op-final", routingOperationId: `rop-${a.where.id}`, qualityInspections: wo.inspections }] }
        },
      }),
      inspectionSpec: guard("inspectionSpec", {
        // 검사 규격은 작업지시의 마지막 공정(routingOperationId = rop-<작업지시>)별로 있다
        findFirst: async (a: { where: { routingOperationId: string } }) => {
          const wo = workOrders[a.where.routingOperationId.replace(/^rop-/, "")]
          return wo?.specId ? { id: wo.specId } : null
        },
      }),
    },
    {
      get(target, prop) {
        if (typeof prop === "symbol" || !(prop in target)) throw new Error(`허용되지 않은 prisma 접근: ${String(prop)}`)
        return (target as Record<string, unknown>)[prop]
      },
    },
  )

  type TestUser = { tenantId: string; role: string } | "ANON" | "FORBIDDEN"
  let user: TestUser = { tenantId: "t1", role: "OPERATOR" }
  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("../src/lib/auth", {
    getTenantId: async () => "t1",
    getCurrentUser: async () => (user === "ANON" || user === "FORBIDDEN" ? null : user),
    requireRole: async () => {
      if (user === "ANON") throw new Error("UNAUTHORIZED")
      if (user === "FORBIDDEN") throw new Error("FORBIDDEN")
      return user
    },
  })
  inject("../src/lib/auth/role-permissions", { requireResourcePermission: async () => user })
  const act = require("../src/lib/actions/shipment-lot-lookup.actions") as typeof import("../src/lib/actions/shipment-lot-lookup.actions")
  const manual = require("../src/lib/actions/shipment.actions") as typeof import("../src/lib/actions/shipment.actions")
  const look = (lotNo: string, extra: { warehouseId?: string; itemId?: string } = {}) =>
    act.lookupLotForShipment({ warehouseId: extra.warehouseId ?? "wh-1", itemId: extra.itemId ?? "fg-a", lotNo })

  const good = await look("FG-LOT-1")
  ok(good.ok && good.itemId === "fg-a" && good.itemCode === "FG-A" && good.itemName === "완제품 A" && good.lotNo === "FG-LOT-1" && good.lotId === "lot-1", "B1 [정상 완제품 LOT QR] 품목·LOT 확인")
  ok(good.ok && good.lot.qtyAvailable === 100 && good.lot.warehouseId === "wh-1" && good.lot.locationName === "B-07", "B2 [품목 일치·창고·위치·가용수량] 출하 창고의 가용수량과 입고 위치를 수동 목록과 같은 형태로 반환(가용 0 인 다른 창고 재고는 제외)")
  const manualList = (await manual.getAvailableFinishedGoodsLots("t1", "wh-1", ["fg-a"])).lotsByItem["fg-a"]
  ok(good.ok && manualList.some((m) => JSON.stringify(m) === JSON.stringify(good.lot)), "B3 [수동 선택과 동일] QR 조회가 돌려준 LOT 행은 수동 선택 목록(getAvailableFinishedGoodsLots)의 같은 LOT 행과 완전히 같다")
  const part = await look("FG-LOT-PART")
  ok(part.ok && part.lot.qtyAvailable === 30 && manualList.find((m) => m.lotId === "lot-part")?.qtyAvailable === 30, "B4 [예약 반영] 출하예정 예약(20)을 뺀 가용(30) — 수동 목록과 같은 계산")
  const res = await look("FG-LOT-RES")
  ok(!res.ok && res.code === "NO_STOCK" && !manualList.some((m) => m.lotId === "lot-res"), "B5 [출하 가능 재고 없음] 전량 예약된 LOT 는 거부 — 수동 목록에도 없다")
  const two = await look("FG-LOT-2")
  ok(good.ok && two.ok && two.lotId === "lot-2" && two.lot.qtyAvailable === 40 && good.lotId !== two.lotId, "B6 [Multi-LOT] 서로 다른 LOT 를 연속 조회하면 각각 확인된다(서버는 반영 위치를 정하지 않음)")
  const again = await look("FG-LOT-1")
  ok(again.ok && JSON.stringify(again) === JSON.stringify(good), "B7 [중복 스캔] 같은 LOT 를 다시 조회해도 같은 결과(조회는 부작용이 없다 — 중복 선택 방지는 화면)")
  const nf = await look("FG-LOT-NOPE")
  ok(!nf.ok && nf.code === "LOT_NOT_FOUND", "B8 [존재하지 않는 LOT] 거부")
  const other = await look("FG-T2-ONLY")
  ok(!other.ok && other.code === "LOT_NOT_FOUND" && other.message === (nf.ok ? "" : nf.message), "B9 [다른 tenant 의 LOT] 없는 LOT 와 같은 응답(존재 여부 비노출)")
  ok(good.ok && good.lotId === "lot-1", "B10 같은 번호(FG-LOT-1)가 다른 tenant 에도 있어도 세션 tenant 의 LOT 만 조회한다")
  const rm = await look("RM-LOT-1")
  const cs = await look("CS-LOT-1")
  ok(!rm.ok && rm.code === "NOT_FINISHED_GOODS" && !cs.ok && cs.code === "NOT_FINISHED_GOODS", "B11 [원자재 LOT] 원자재·소모품 LOT 는 QR 문자열이 아니라 실제 품목으로 판정해 거부")
  const semi = await look("SM-LOT-1")
  ok(!semi.ok && semi.code === "ITEM_MISMATCH", "B12 [다른 품목 LOT] 반제품 LOT 는 이 출하 품목이 아니므로 거부")
  const wrongItem = await look("FG-B-1")
  ok(!wrongItem.ok && wrongItem.code === "ITEM_MISMATCH" && wrongItem.message.includes("다른 품목"), "B13 [다른 품목 LOT] 다른 완제품(FG-B)의 LOT 는 출하 품목(FG-A) 행에 선택할 수 없다")
  const rightItem = await look("FG-B-1", { itemId: "fg-b" })
  ok(rightItem.ok && rightItem.itemCode === "FG-B" && rightItem.lot.qtyAvailable === 25, "B14 같은 LOT 도 그 품목의 행에서는 선택 가능 — 어느 품목인지는 서버가 확인한 품목으로 결정")
  for (const [lotNo, label] of [["FG-LOT-QUAR", "격리"], ["FG-LOT-HOLD", "보류"], ["FG-LOT-CONS", "소진"], ["FG-LOT-EXP", "만료"]] as const) {
    const r = await look(lotNo)
    ok(!r.ok && r.code === "LOT_RESTRICTED", `B15 [출하 불가 LOT] ${label} 상태 거부(수동 목록·등록과 같은 ACTIVE 만 규칙)`)
  }
  const qfail = await look("FG-LOT-QFAIL")
  const qpend = await look("FG-LOT-QPEND")
  const qpass = await look("FG-LOT-QPASS")
  ok(!qfail.ok && qfail.code === "QUALITY_HOLD" && qfail.message.includes("불합격") && !qpend.ok && qpend.code === "QUALITY_HOLD" && qpend.message.includes("최종검사를 완료") && qpass.ok, "B16 [품질 출하 제한] 최종검사 불합격·미검사 LOT 는 출하예정 등록(createShipment)과 같은 기존 규칙으로 거부, 합격 LOT 는 통과")
  const nostock = await look("FG-LOT-NOSTOCK")
  const nobal = await look("FG-LOT-NOBAL")
  ok(!nostock.ok && nostock.code === "NO_STOCK" && !nobal.ok && nobal.code === "NO_STOCK", "B17 [재고 없는 LOT] 가용 0 이거나 재고 행이 없는 LOT 거부")
  const wh2 = await look("FG-LOT-WH2")
  ok(!wh2.ok && wh2.code === "OTHER_WAREHOUSE" && wh2.message.includes("다른 창고"), "B18 [다른 창고 LOT] 선택한 출하 창고(wh-1)가 아닌 창고(wh-2)의 재고만 있는 LOT 는 자동 전환 없이 거부")
  const wh2ok = await look("FG-LOT-WH2", { warehouseId: "wh-2" })
  ok(wh2ok.ok && wh2ok.lot.warehouseId === "wh-2", "B19 출하 창고를 그 창고(wh-2)로 선택하면 같은 LOT 가 선택 가능")
  const whT2 = await look("FG-LOT-1", { warehouseId: "wh-t2" })
  const whNone = await look("FG-LOT-1", { warehouseId: "nope" })
  const whEmpty = await look("FG-LOT-1", { warehouseId: " " })
  ok(!whT2.ok && whT2.code === "WAREHOUSE_NOT_FOUND" && !whNone.ok && whNone.code === "WAREHOUSE_NOT_FOUND" && !whEmpty.ok && whEmpty.code === "WAREHOUSE_NOT_FOUND", "B20 다른 tenant/없는/빈 창고는 존재하지 않는 것처럼 거부")
  const itemEmpty = await look("FG-LOT-1", { itemId: " " })
  ok(!itemEmpty.ok && itemEmpty.code === "ITEM_MISMATCH", "B21 품목이 비어 있으면 거부")
  for (const bad of ["", "   ", "A\nB", "X".repeat(200)]) {
    const r = await look(bad)
    ok(!r.ok && r.code === "INVALID", `B22 [잘못된 LOT 번호] 입력 거부: ${JSON.stringify(bad).slice(0, 14)}`)
  }
  const sneaky = await act.lookupLotForShipment({ warehouseId: "wh-1", itemId: "fg-a", lotNo: "FG-T2-ONLY", tenantId: "t2" } as never)
  ok(!sneaky.ok && sneaky.code === "LOT_NOT_FOUND", "B23 클라이언트가 tenant 를 보내도 무시한다(세션 tenant 기준)")
  user = "ANON"
  const anon = await look("FG-LOT-1")
  user = "FORBIDDEN"
  const denied = await look("FG-LOT-1")
  user = { tenantId: "t1", role: "VIEWER" }
  const viewer = await look("FG-LOT-1")
  user = { tenantId: "t1", role: "OPERATOR" }
  ok(!anon.ok && anon.code === "UNAUTHORIZED" && !denied.ok && denied.code === "DENIED" && viewer.ok, "B24 로그인·권한 확인(수동 목록과 같은 기준: 비로그인/권한 부족 거부, 조회 권한 사용자는 가능)")
  ok(snapshot() === before, "B25 [QR 스캔만으로 재고·예약이 변경되지 않음] 조회 전후 재고/예약/LOT/입고 데이터 동일")
  ok(accessed.length > 0 && accessed.every((a) => /^[a-zA-Z]+\.(findFirst|findMany|groupBy)$/.test(a)), `B26 읽기 전용: 접근한 DB 메서드는 findFirst/findMany/groupBy 뿐(${Array.from(new Set(accessed)).join(", ")}) — 쓰기·트랜잭션 접근 시 즉시 실패하는 가드를 통과`)
  ok(scan.SHIPMENT_LOT_LOOKUP_MESSAGES.OTHER_WAREHOUSE.includes("다른 창고") && !JSON.stringify(Object.values(scan.SHIPMENT_LOT_LOOKUP_MESSAGES)).includes("t2"), "B27 거부 안내문에 내부 식별자/다른 tenant 정보가 없다")

  // ─── C. 소스 구조 ──────────────────────────────────────────────────────────
  const sheet = readSource("src/app/app/mes/shipments/shipment-form-sheet.tsx")
  const section = readSource("src/app/app/mes/shipments/fg-lot-qr-scan.tsx")
  const lookupSrc = readSource("src/lib/actions/shipment-lot-lookup.actions.ts")
  const actions = readSource("src/lib/actions/shipment.actions.ts")

  // C1 기존 수동 선택/등록/확정/삭제 코드는 QR 작업 이전과 동일(지문)
  const block = (src: string, from: string, to: string | null) => src.slice(src.indexOf(from), to === null ? src.length : src.indexOf(to))
  const FP = {
    available: "67037726927f87b5",
    create: "133b60f6cef5c101",
    confirm: "444c3e01f3878259",
    delete: "6b607dff06f95f6e",
    schema: "ffc372fca1b87ff7",
    handleLotChange: "94f14ed1784010c9",
    onSubmit: "622bbefe737a8d32",
    lotLoadAndReset: "7fe9b6546006dc54",
    salesOrderAndWarehouse: "c796b348656a01bf",
    manualSelect: "d3ae4cbabab0d738",
  }
  eq(fingerprint(block(actions, "export async function getAvailableFinishedGoodsLots(", "export async function generateShipmentNo(")), FP.available, "C1a 수동 LOT 목록 조회(getAvailableFinishedGoodsLots)는 QR 작업 이전과 동일")
  eq(fingerprint(block(actions, "export async function createShipment(", "export async function confirmShipment(")), FP.create, "C1b 출하예정 등록(createShipment: LOT·재고·예약·품질 검증)은 QR 작업 이전과 동일")
  eq(fingerprint(block(actions, "export async function confirmShipment(", "export async function deleteShipment(")), FP.confirm, "C1c 출하 확정(confirmShipment: 재고 차감·수불·수주 반영)은 QR 작업 이전과 동일")
  eq(fingerprint(block(actions, "export async function deleteShipment(", null)), FP.delete, "C1d 출하 삭제는 QR 작업 이전과 동일")
  eq(fingerprint(readSource("src/app/app/mes/shipments/shipment-form-schema.ts")), FP.schema, "C1e 출하 폼 검증 스키마(LOT 중복 금지·수량 검증)는 QR 작업 이전과 동일")
  eq(fingerprint(block(sheet, "  function handleLotChange(", "  function handleScannedLot(")), FP.handleLotChange, "C1f 수동 LOT 선택 처리(handleLotChange — 수량 제안 포함)는 QR 작업 이전과 동일")
  eq(fingerprint(block(sheet, "  async function onSubmit(", "  return (\n    <FormSheet")), FP.onSubmit, "C1g 등록 제출(onSubmit: LOT·수량 검증 후 createShipment)은 QR 작업 이전과 동일 — QR/수동 구분 없음")
  eq(fingerprint(block(sheet, "  function toShipmentItems(", "  function handleLotChange(")), FP.lotLoadAndReset, "C1h 수주 품목 로딩·LOT 분할 행 추가/삭제는 QR 작업 이전과 동일")
  eq(fingerprint(block(sheet, "  function handleSalesOrderChange(", "  async function onSubmit(")), FP.salesOrderAndWarehouse, "C1i 수주/창고 변경 시 LOT 선택 초기화 동작은 QR 작업 이전과 동일")
  const manualSelectBlock = block(
    sheet,
    "                                <FormField\n                                  control={form.control}\n                                  name={`items.${itemIndex}.lotAllocations.${allocationIndex}.lotId`}",
    "                                <FormField\n                                  control={form.control}\n                                  name={`items.${itemIndex}.lotAllocations.${allocationIndex}.qty`}",
  )
  eq(fingerprint(manualSelectBlock), FP.manualSelect, "C1j 수동 LOT 선택 상자(Select)는 QR 작업 이전과 동일")

  // C2 스캔 반영 함수는 선택만 한다
  const handler = block(sheet, "  function handleScannedLot(", "  function handleScan(")
  const handlerCode = stripComments(handler)
  ok(/handleLotChange\(itemIndex, plan\.rowIndex, scanned\.lotId\)/.test(handlerCode) && /planScannedFgLot\(/.test(handlerCode), "C2a QR 선택은 수동 선택과 같은 handleLotChange 를 거친다(결과 동일)")
  ok(!/createShipment|confirmShipment|deleteShipment|router\.|alert\(|replace\(|remove\(|reset\(|handleSubmit|onSubmit|fetch\(/.test(handlerCode), "C2b [스캔 후 자동 처리 없음] 스캔 반영 함수는 LOT 선택 상태만 바꾼다 — 출하 등록/확정/삭제·화면 이동·행 초기화 없음")
  ok(!/\.qty`?,\s*(scanned|lot)\.qtyAvailable|qtyAvailable/.test(handlerCode), "C2c 스캔한 LOT 의 재고를 출하 수량으로 직접 확정하지 않는다(수량 제안은 기존 handleLotChange 의 규칙 그대로)")
  ok(sheet.includes('import { FgLotQrScan } from "./fg-lot-qr-scan"') && (sheet.match(/<FgLotQrScan/g) ?? []).length === 1 && sheet.includes("onSelectLot={(lot) => handleScannedLot(itemIndex, lot)}") && sheet.includes("LOT 추가"), "C2d [QR 스캔] 은 LOT 관리 품목 행의 'LOT 추가' 옆(기존 LOT 선택 영역)에 1곳 연결")

  // C3 연동 컴포넌트
  const sectionCode = stripComments(section)
  ok(section.startsWith('"use client"') && section.includes("QrScannerDialog") && !/new BarcodeDetector|jsQR|jsqr|getUserMedia/.test(sectionCode), "C3a 새 스캐너를 만들지 않고 공통 QrScannerDialog 를 재사용(카메라 직접 제어 없음)")
  ok(section.includes('result.kind !== "LOT"') && section.indexOf('result.kind !== "LOT"') < section.indexOf("await lookup("), "C3b WIP QR 은 서버 조회 전에 거부")
  ok(section.includes("busyRef.current") && section.includes("if (busyRef.current) return") && section.includes("disabled || busy"), "C3c [연속 스캔 중복 조회 방지] 조회 중에는 새 스캔 무시 · 버튼 비활성")
  ok(section.includes('process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"') && section.includes("if (QR_DISABLED) return null"), "C3d [QR 는 선택 기능] 환경 스위치로 끄면 버튼/스캐너가 사라지고 기존 업무는 그대로")
  ok(section.includes('role={message.tone === "error" ? "alert" : "status"}') && section.includes("catch (error)") && section.includes("목록에서 직접 선택"), "C3e 조회 실패/오류 시 한국어 안내와 수동 선택 안내 — 예외를 삼키지 않고 화면 입력은 유지")
  ok(!/createShipment|confirmShipment|deleteShipment|getAvailableFinishedGoodsLots|prisma|startTransition|useRouter|router\./.test(sectionCode), "C3f 연동 컴포넌트는 출하 등록/확정/재고/DB 를 호출하지 않고 화면도 이동하지 않는다")
  ok(section.includes("latest.warehouseId !== requested.warehouseId") && section.includes("latest.itemId !== requested.itemId"), "C3g 조회 중 출하 창고/품목이 바뀌면 오래된 결과를 반영하지 않는다")
  ok(section.includes("latest.isLotSelected(found.lotId)") && section.includes("latest.findLot(found.lotId)") && section.indexOf("latest.isLotSelected") < section.indexOf("latest.onSelectLot"), "C3h 이미 선택된 LOT 와 화면 목록에 없는 LOT 는 반영하지 않는다")
  ok(!/setLotAllocations|setValue|replace\(|reset\(/.test(sectionCode), "C3i 컴포넌트는 폼 상태를 직접 바꾸지 않는다(부모의 onSelectLot 으로만 반영)")

  // C3j 서버 요청의 종류: QR 조회(읽기 전용 Server Action)는 허용, 등록·확정·재고 변경 액션은 QR 코드 경로에 없다
  //  - Server Action 은 읽기 전용 조회라도 POST 로 전달되므로 "POST 없음"이 아니라 "어떤 액션을 부를 수 있는가"를 소스로 확인한다.
  const actionImports = (src: string) => Array.from(src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/actions\/([\w.-]+)"/g)).flatMap((m) => m[1].split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type ")).map((n) => `${m[2]}:${n}`))
  eq(actionImports(section), ["shipment-lot-lookup.actions:lookupLotForShipment"], "C3j 스캔 컴포넌트가 호출할 수 있는 Server Action 은 읽기 전용 조회(lookupLotForShipment) 하나뿐 — 출하 등록·확정·삭제·재고 액션을 import 하지 않는다")
  eq(actionImports(sheet), ["shipment.actions:createShipment", "shipment.actions:getAvailableFinishedGoodsLots"], "C3k 출하 시트가 import 하는 Server Action 은 QR 작업 이전과 같다(등록·수동 LOT 목록) — QR 용으로 추가된 액션 import 없음")
  ok(!/createShipment|confirmShipment|deleteShipment|lookupLotForShipment/.test(stripComments(handler)), "C3l handleScannedLot 은 어떤 Server Action 도 직접 호출하지 않는다")

  // C3m 실제 react-hook-form 의 동작 가정 확인: handleScannedLot 이 쓰는 호출 순서(getValues → setValue(배열 행 추가) → getValues → setValue(행 수량))가
  //     렌더 중에도 즉시 반영된다 — 같은 코드가 실제 ShipmentFormSheet 에서 handleLotChange 가 새 행을 읽을 수 있는 전제.
  {
    const React = require("react") as typeof import("react")
    const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server")
    const { useForm } = require("react-hook-form") as typeof import("react-hook-form")
    type V = { items: Array<{ lotAllocations: Array<{ lotId: string; qty: number }> }> }
    let observed: { lenAfterAppend: number; newRowLot: string; preservedQty: number; firstRow: string } | null = null
    const Probe = () => {
      const form = useForm<V>({ defaultValues: { items: [{ lotAllocations: [{ lotId: "lot-1", qty: 30 }] }] } })
      // DOM 없이(서버 렌더) 마운트 이후 상태를 흉내 낸다: 마운트 전 getValues 는 defaultValues 를 돌려주므로, 내부 mount 플래그만 켠다.
      ;(form.control as unknown as { _state: { mount: boolean } })._state.mount = true
      const allocations = form.getValues("items.0.lotAllocations")
      const plan = scan.planScannedFgLot(allocations, "lot-2")
      form.setValue("items.0.lotAllocations", [...allocations, { lotId: "", qty: 0 }], { shouldDirty: true })
      const afterAppend = form.getValues("items.0.lotAllocations")
      const item = form.getValues("items.0")
      form.setValue("items.0.lotAllocations", item.lotAllocations.map((row, i) => (i === plan.rowIndex ? { lotId: "lot-2", qty: 40 } : row)))
      form.setValue(`items.0.lotAllocations.${plan.rowIndex}.qty`, 7)
      observed = { lenAfterAppend: afterAppend.length, newRowLot: form.getValues(`items.0.lotAllocations.${plan.rowIndex}.lotId`), preservedQty: form.getValues(`items.0.lotAllocations.${plan.rowIndex}.qty`), firstRow: JSON.stringify(form.getValues("items.0.lotAllocations.0")) }
      return null
    }
    renderToStaticMarkup(React.createElement(Probe))
    eq(observed, { lenAfterAppend: 2, newRowLot: "lot-2", preservedQty: 7, firstRow: JSON.stringify({ lotId: "lot-1", qty: 30 }) }, "C3m 실제 react-hook-form: 행 추가 직후 getValues 가 새 행을 보고, 행 단위 setValue 가 다른 행(lot-1 / 30)을 건드리지 않는다")
  }

  // C4 서버 조회 액션
  const lookupCode = stripComments(lookupSrc)
  ok(lookupSrc.startsWith('"use server"') && !/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$transaction|\$executeRaw|\$queryRaw|recordAuditLog|revalidate/.test(lookupCode), "C4a 서버 조회 액션은 읽기 전용(쓰기·감사·캐시 재검증 없음)")
  const signature = lookupSrc.slice(lookupSrc.indexOf("export async function lookupLotForShipment"), lookupSrc.indexOf("{", lookupSrc.indexOf("export async function lookupLotForShipment") + 70))
  ok(!/tenantId/.test(signature) && lookupCode.includes('requireRole("VIEWER")') && lookupCode.includes("getAvailableFinishedGoodsLots(") && lookupCode.includes("assertLotQualityReleaseAllowed(prisma"), "C4b tenant 를 클라이언트에서 받지 않고 세션으로 확인 · 수동 목록과 같은 권한/재고 조회 · 기존 품질 출하 제한 재사용")
  ok((lookupCode.match(/export (async )?(function|const|class)/g) ?? []).length === 1 && /^export async function lookupLotForShipment/m.test(lookupCode), "C4c 'use server' 파일은 비동기 함수 1개만 내보낸다")
  ok(!/resolveLotStockReader|lot-read-access|material-issue/.test(lookupCode), "C4d 자재출고 모듈에 의존하지 않는다(출하 전용 조회)")

  // C5 범위: QR 전용 출하 경로·다른 화면 결합 없음
  ok(qrCouplingViolations(["src/lib/actions/shipment.actions.ts", "src/lib/actions/finished-goods.actions.ts", "src/lib/actions/finished-goods-lot.helpers.ts", "src/lib/actions/inventory.actions.ts", "src/lib/actions/lot.actions.ts", "src/lib/actions/quality-release-gate.helpers.ts", "src/lib/quantity-concurrency.ts", "src/app/app/mes/shipments/shipment-data-table.tsx", "src/app/app/mes/shipments/shipment-form-schema.ts", "src/app/app/mes/shipments/columns.tsx", "src/app/app/mes/shipments/page.tsx"]).length === 0, "C5a 출하 서버 로직·재고·LOT·품질·출하 목록/확정 화면은 QR 모듈에 결합되지 않았다")
  const shipmentsFiles = listFiles("src/app/app/mes/shipments").filter((f) => /\.(ts|tsx)$/.test(f))
  const scannerUsers = shipmentsFiles.filter((f) => /qr-scanner|QrScanner|use-qr-camera-scanner/.test(readSource(f)))
  eq(scannerUsers, ["src/app/app/mes/shipments/fg-lot-qr-scan.tsx"], "C5b 출하 화면에서 스캐너를 쓰는 파일은 fg-lot-qr-scan.tsx 하나뿐")
  ok(!shipmentsFiles.some((f) => /shipment-qr|qr-ship|confirm-qr/i.test(f) || /SHIPMENT_QR|ship-confirm-qr|qr-ship|confirmShipmentByQr|shipByQr/i.test(readSource(f))) && !/DAEWON\|(SHIPMENT|FG|FINISHED)/.test(read("src/lib/qr/lot-qr.ts") + read("src/lib/qr/qr-scan-result.ts")), "C5c QR 전용 출하 처리 경로나 새 QR 규격(SHIPMENT/FG)이 없다")
  ok(lotLib.encodeLotQr("A") === "DAEWON|LOT|1|A" && lotLib.encodeWipQr("A") === "DAEWON|WIP|1|A" && lotLib.encodeLotQr("FG-LOT-1") === "DAEWON|LOT|1|FG-LOT-1", "C5d QR 데이터 규격(DAEWON|LOT|1|… / DAEWON|WIP|1|…)은 그대로 — 원자재/완제품 LOT QR 은 같은 규격")
  ok(schemaViolations().length === 0 && !/shipment.*qr|qr.*shipment/i.test(read("prisma/schema.prisma")), "C5e 스키마 변경 없음(라벨/QR 전용 모델 없음)")
  const popAndIssue = [...listFiles("src/app/pop"), ...listFiles("src/app/app/pop"), ...listFiles("src/app/app/mes/material-issue"), "src/components/pop/pop-wip-qr-scan.tsx"]
  ok(popAndIssue.every((f) => !/fg-lot-scan|shipment-lot-lookup|fg-lot-qr-scan/.test(readSource(f))), "C5f POP·자재출고 화면은 출하 QR 모듈을 참조하지 않는다(서로 독립)")
  ok(!/pointer-events|\bfixed\b/.test(sectionCode) && section.includes("text-[13px]") && !/text-\[(10|11|12)px\]/.test(section), "C5g 새 UI 글자 크기는 13px 이상(프로젝트 타이포그래피 기준)")
  void between

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
