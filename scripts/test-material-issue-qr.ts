/**
 * 자재출고 QR 스캔 연동(4-1단계) 테스트 — 가짜 DB, 브라우저/실제 DB/로그인 없음.
 *
 *  A. LOT 선택 반영 규칙(lib/material-issue/lot-scan.ts): 빈 행 채움 · 행 추가 · 중복 방지 · 수량 불변 · 선택 가능 자재 확인
 *  B. 서버 조회(lookupLotForMaterialIssue, 가짜 Prisma): 정상 · 창고 여러 곳 · 없는 LOT · 다른 tenant · BOM 아님 · 제한 상태 · 재고 없음 · 입력 거부 · 권한 · 읽기 전용
 *  C. 수동 선택과 QR 선택의 동일성(같은 데이터 구조·같은 조회·같은 확정 서버 액션)
 *  D. 소스 구조: 기존 수동 선택/출고 처리 보존, 출고 로직 무변경, 다른 화면 미연동, QR 은 선택 기능(스위치)
 *
 * 실제 DB 의 쿼리 동작, 로그인/권한 데이터, 실제 화면 클릭, 실제 카메라는 이 테스트로 검증되지 않는다(미검증 항목).
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import { CORE_ISSUE_BASELINE_FINGERPRINTS, coreIssueFingerprints, qrCouplingViolations, readSource as readSourceLf, schemaViolations } from "./test-support/source-invariants"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const scan = require("../src/lib/material-issue/lot-scan") as typeof import("../src/lib/material-issue/lot-scan")
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
  const optA1 = { lotId: "lot-1", warehouseId: "wh-1" }
  let n = 0
  const key = () => `k${++n}`
  const original = [{ key: "r0", lotValue: "", qty: "50" }]
  const frozen = JSON.parse(JSON.stringify(original))
  const r1 = scan.applyScannedLot(original, optA1, key)
  ok(r1.outcome === "FILLED_EMPTY_ROW" && r1.splits.length === 1 && r1.splits[0].lotValue === "lot-1:wh-1" && r1.splits[0].qty === "50", "A1 빈 LOT 행에 채움 — 그 행의 기존 출고수량(50)은 그대로 유지")
  eq(original, frozen, "A2 입력 배열을 변경하지 않는다(불변)")
  const r2 = scan.applyScannedLot(r1.splits, { lotId: "lot-2", warehouseId: "wh-1" }, key)
  ok(r2.outcome === "ADDED_ROW" && r2.splits.length === 2 && r2.splits[1].qty === "" && r2.splits[1].lotValue === "lot-2:wh-1" && r2.splits[0].qty === "50", "A3 [Multi-LOT] 모든 행에 LOT 가 있으면 새 행 추가 — 수량은 비워 두고 기존 행은 그대로")
  const r3 = scan.applyScannedLot(r2.splits, optA1, key)
  ok(r3.outcome === "ALREADY_SELECTED" && r3.splits === r2.splits, "A4 [중복 방지] 같은 LOT·창고 재선택 → 변경 없음")
  const r4 = scan.applyScannedLot(r2.splits, { lotId: "lot-1", warehouseId: "wh-2" }, key)
  ok(r4.outcome === "ALREADY_SELECTED" && r4.splits.length === 2, "A5 [중복 방지] 같은 LOT 를 다른 창고로 또 선택하는 것도 거부(기존 서버의 '동일 LOT 중복' 규칙과 동일)")
  const r5 = scan.applyScannedLot([{ key: "a", lotValue: "x:y", qty: "5" }, { key: "b", lotValue: "", qty: "7" }], { lotId: "lot-9", warehouseId: "wh-1" }, key)
  ok(r5.outcome === "FILLED_EMPTY_ROW" && r5.splits[1].lotValue === "lot-9:wh-1" && r5.splits[1].qty === "7" && r5.splits[0].lotValue === "x:y", "A6 첫 번째 빈 행에만 채우고 다른 행/수량은 보존")
  ok(scan.lotSelectValue({ lotId: "L", warehouseId: "W" }) === "L:W", "A7 선택 값 형식 lotId:warehouseId (수동 선택 UI 와 동일)")
  const mats = [
    { itemId: "a", pendingQty: 50, lotManaged: true },
    { itemId: "full", pendingQty: 0, lotManaged: true },
    { itemId: "nl", pendingQty: 20, lotManaged: false },
  ]
  ok(scan.checkScanTarget(mats, "a").ok, "A8 출고 대기 중인 LOT 관리 자재는 선택 가능")
  const full = scan.checkScanTarget(mats, "full")
  ok(!full.ok && full.reason === "ALREADY_FULLY_ISSUED" && full.message.includes("이미 모두 출고"), "A9 필요수량을 모두 출고한 자재는 선택 불가 안내")
  const nl = scan.checkScanTarget(mats, "nl")
  ok(!nl.ok && nl.reason === "NOT_LOT_MANAGED", "A10 LOT 관리 품목이 아니면 선택 불가 안내(수동 입력 안내)")
  const missing = scan.checkScanTarget(mats, "zzz")
  ok(!missing.ok && missing.reason === "NOT_IN_LIST", "A11 출고 자재 목록에 없는 품목은 선택 불가 안내")
  ok(Object.values(scan.ISSUE_LOT_LOOKUP_MESSAGES).every((m) => /[가-힣]/.test(m)) && Object.keys(scan.ISSUE_LOT_LOOKUP_MESSAGES).length === 9, "A12 모든 거부 사유에 한국어 안내")

  // QR 문자열 → 화면 처리 분기(스캐너가 검증한 결과만 화면에 도달)
  const wipParsed = qrLib.parseQrScan(lotLib.encodeWipQr("wip-1"))
  const lotParsed = qrLib.parseQrScan(lotLib.encodeLotQr("LOT-A-1"))
  ok(wipParsed.ok && wipParsed.result.kind === "WIP" && lotParsed.ok && lotParsed.result.kind === "LOT", "A13 WIP QR 은 kind WIP(화면에서 거부), LOT QR 은 kind LOT(서버 조회)")
  for (const bad of ["DAEWON|LOT|9|X", "DAEWON|LOT|1|", "DAEWON|BATCH|1|X", "FOO|LOT|1|X", "HELLO"]) {
    ok(!qrLib.parseQrScan(bad).ok, `A14 잘못된 QR 은 스캐너 단계에서 거부: ${bad}`)
  }

  // ─── B. 서버 조회(가짜 Prisma) ─────────────────────────────────────────────
  type LotRow = { id: string; tenantId: string; lotNo: string; status: string; itemId: string }
  type Balance = { tenantId: string; itemId: string; lotId: string | null; warehouseId: string; qtyAvailable: number; qtyOnHand: number }
  const items: Record<string, { id: string; code: string; name: string; itemType: string; isLotTracked: boolean; uom: string }> = {
    "item-a": { id: "item-a", code: "RM-A", name: "원자재 A", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "KG" },
    "item-b": { id: "item-b", code: "RM-B", name: "원자재 B", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA" },
    "item-z": { id: "item-z", code: "RM-Z", name: "BOM 아닌 원자재", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA" },
    "item-fg": { id: "item-fg", code: "FG-1", name: "완제품", itemType: "FINISHED", isLotTracked: true, uom: "EA" },
    "item-t2": { id: "item-t2", code: "RM-T2", name: "타 tenant 자재", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA" },
  }
  const warehouses: Record<string, { id: string; code: string; name: string }> = {
    "wh-1": { id: "wh-1", code: "WH-1", name: "원자재창고" },
    "wh-2": { id: "wh-2", code: "WH-2", name: "보조창고" },
  }
  const lots: LotRow[] = [
    { id: "lot-a1", tenantId: "t1", lotNo: "LOT-A-1", status: "ACTIVE", itemId: "item-a" },
    { id: "lot-a2", tenantId: "t1", lotNo: "LOT-A-2", status: "ACTIVE", itemId: "item-a" },
    { id: "lot-nostock", tenantId: "t1", lotNo: "LOT-NOSTOCK", status: "ACTIVE", itemId: "item-a" },
    { id: "lot-quar", tenantId: "t1", lotNo: "LOT-QUAR", status: "QUARANTINE", itemId: "item-a" },
    { id: "lot-hold", tenantId: "t1", lotNo: "LOT-HOLD", status: "ON_HOLD", itemId: "item-a" },
    { id: "lot-cons", tenantId: "t1", lotNo: "LOT-CONS", status: "CONSUMED", itemId: "item-a" },
    { id: "lot-exp", tenantId: "t1", lotNo: "LOT-EXP", status: "EXPIRED", itemId: "item-a" },
    { id: "lot-notbom", tenantId: "t1", lotNo: "LOT-NOTBOM", status: "ACTIVE", itemId: "item-z" },
    { id: "lot-fg", tenantId: "t1", lotNo: "FG-LOT-1", status: "ACTIVE", itemId: "item-fg" },
    { id: "lot-b1", tenantId: "t1", lotNo: "LOT-B-1", status: "ACTIVE", itemId: "item-b" },
    // 다른 tenant: 같은 번호를 가진 별개 LOT 와 t2 전용 LOT
    { id: "lot-t2-a1", tenantId: "t2", lotNo: "LOT-A-1", status: "ACTIVE", itemId: "item-t2" },
    { id: "lot-t2-only", tenantId: "t2", lotNo: "LOT-T2-ONLY", status: "ACTIVE", itemId: "item-t2" },
  ]
  const balances: Balance[] = [
    { tenantId: "t1", itemId: "item-a", lotId: "lot-a1", warehouseId: "wh-1", qtyAvailable: 100, qtyOnHand: 100 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-a1", warehouseId: "wh-2", qtyAvailable: 0, qtyOnHand: 5 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-a2", warehouseId: "wh-1", qtyAvailable: 40, qtyOnHand: 40 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-a2", warehouseId: "wh-2", qtyAvailable: 60, qtyOnHand: 60 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-nostock", warehouseId: "wh-1", qtyAvailable: 0, qtyOnHand: 0 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-quar", warehouseId: "wh-1", qtyAvailable: 10, qtyOnHand: 10 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-hold", warehouseId: "wh-1", qtyAvailable: 10, qtyOnHand: 10 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-cons", warehouseId: "wh-1", qtyAvailable: 10, qtyOnHand: 10 },
    { tenantId: "t1", itemId: "item-a", lotId: "lot-exp", warehouseId: "wh-1", qtyAvailable: 10, qtyOnHand: 10 },
    { tenantId: "t1", itemId: "item-z", lotId: "lot-notbom", warehouseId: "wh-1", qtyAvailable: 10, qtyOnHand: 10 },
    { tenantId: "t1", itemId: "item-fg", lotId: "lot-fg", warehouseId: "wh-1", qtyAvailable: 10, qtyOnHand: 10 },
    { tenantId: "t1", itemId: "item-b", lotId: "lot-b1", warehouseId: "wh-1", qtyAvailable: 25, qtyOnHand: 25 },
    { tenantId: "t2", itemId: "item-t2", lotId: "lot-t2-a1", warehouseId: "wh-1", qtyAvailable: 9, qtyOnHand: 9 },
    { tenantId: "t2", itemId: "item-t2", lotId: "lot-t2-only", warehouseId: "wh-1", qtyAvailable: 9, qtyOnHand: 9 },
  ]
  const workOrders = [
    { id: "wo-1", tenantId: "t1", componentIds: ["item-a", "item-b"] },
    { id: "wo-t2", tenantId: "t2", componentIds: ["item-t2"] },
  ]
  const accessed: string[] = []
  const snapshot = () => JSON.stringify(balances)
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
  const fakePrisma = new Proxy(
    {
      workOrder: guard("workOrder", {
        findFirst: async (a: { where: { id: string; tenantId: string } }) => {
          const wo = workOrders.find((w) => w.id === a.where.id && w.tenantId === a.where.tenantId)
          return wo ? { id: wo.id, bom: { bomItems: wo.componentIds.map((id) => ({ componentItemId: id })) } } : null
        },
      }),
      lot: guard("lot", {
        findFirst: async (a: { where: { tenantId: string; lotNo: string } }) => {
          const lot = lots.find((l) => l.tenantId === a.where.tenantId && l.lotNo === a.where.lotNo)
          return lot ? { ...lot, item: items[lot.itemId] } : null
        },
      }),
      inventoryBalance: guard("inventoryBalance", {
        findMany: async (a: { where: { tenantId: string; itemId: { in: string[] }; lotId: { not: null }; qtyAvailable: { gt: number } } }) =>
          balances
            .filter((b) => b.tenantId === a.where.tenantId && a.where.itemId.in.includes(b.itemId) && b.lotId !== null && b.qtyAvailable > a.where.qtyAvailable.gt)
            .map((b) => ({
              ...b,
              lot: lots.find((l) => l.id === b.lotId),
              item: { uom: items[b.itemId].uom },
              warehouse: warehouses[b.warehouseId],
            }))
            .sort((x, y) => String(x.lot?.lotNo).localeCompare(String(y.lot?.lotNo))),
      }),
    },
    {
      get(target, prop) {
        if (typeof prop === "symbol" || !(prop in target)) throw new Error(`허용되지 않은 prisma 접근: ${String(prop)}`)
        return (target as Record<string, unknown>)[prop]
      },
    },
  )
  let user: { tenantId: string } | "ANON" | "DENIED" = { tenantId: "t1" }
  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("../src/lib/auth", { getTenantId: async () => "t1", getCurrentUser: async () => user, requireRole: async () => user })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async () => {
      if (user === "ANON") throw new Error("UNAUTHORIZED")
      if (user === "DENIED") throw new Error("이 기능을 사용할 권한이 없습니다.")
      return user
    },
    // 조회 접근 확인(lot-read-access)은 권한 스냅샷 1회 + hasResourcePermission 으로 판정한다
    getCurrentPermissionSnapshot: async () => (user === "ANON" ? null : { user }),
    hasResourcePermission: () => user !== "ANON" && user !== "DENIED",
  })
  const act = require("../src/lib/actions/material-issue-lot-lookup.actions") as typeof import("../src/lib/actions/material-issue-lot-lookup.actions")
  const manual = require("../src/lib/actions/material-issue.actions") as typeof import("../src/lib/actions/material-issue.actions")

  const good = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-A-1" })
  ok(good.ok && good.itemId === "item-a" && good.itemCode === "RM-A" && good.itemName === "원자재 A" && good.lotNo === "LOT-A-1" && good.options.length === 1, "B1 [정상 원자재 LOT] 품목·LOT 확인 · 출고 가능 재고 1건(가용 0 인 창고는 제외)")
  ok(good.ok && good.options[0].warehouseCode === "WH-1" && good.options[0].qtyAvailable === 100 && good.options[0].unit === "KG" && good.options[0].lotId === "lot-a1", "B2 창고·가용수량·단위·LOT id 를 기존 조회와 같은 형태로 반환")
  const multi = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-A-2" })
  ok(multi.ok && multi.options.length === 2 && multi.options.map((o) => o.warehouseId).sort().join() === "wh-1,wh-2", "B3 [복수 창고] 같은 LOT 가 두 창고에 있으면 후보를 모두 돌려주고 하나로 정하지 않는다")
  const nf = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-NOPE" })
  ok(!nf.ok && nf.code === "LOT_NOT_FOUND", "B4 [존재하지 않는 LOT] 거부")
  const other = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-T2-ONLY" })
  ok(!other.ok && other.code === "LOT_NOT_FOUND" && other.message === (nf.ok ? "" : nf.message), "B5 [다른 tenant 의 LOT] 없는 LOT 와 같은 응답(존재 여부 비노출)")
  ok(good.ok && good.lotId === "lot-a1", "B6 같은 번호(LOT-A-1)가 다른 tenant 에도 있어도 세션 tenant 의 LOT 만 조회한다")
  const notbom = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-NOTBOM" })
  const fg = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "FG-LOT-1" })
  ok(!notbom.ok && notbom.code === "NOT_BOM_MATERIAL" && !fg.ok && fg.code === "NOT_BOM_MATERIAL", "B7 [다른 품목/해당 작업지시 자재가 아닌 LOT] 거부 — 완제품 LOT 도 QR 문자열이 아니라 실제 품목(BOM)으로 판정해 거부")
  for (const [lotNo, label, code] of [["LOT-QUAR", "격리", "LOT_RESTRICTED"], ["LOT-HOLD", "보류", "LOT_RESTRICTED"], ["LOT-CONS", "소진", "LOT_RESTRICTED"], ["LOT-EXP", "만료", "LOT_EXPIRED"]] as const) {
    const r = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo })
    ok(!r.ok && r.code === code, `B8 [사용이 제한된 LOT] ${label} 상태 거부(공통 출고 적격성 규칙)`)
  }
  const nos = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-NOSTOCK" })
  ok(!nos.ok && nos.code === "NO_STOCK", "B9 [출고 가능 재고가 없는 LOT] 거부")
  const bWo = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-B-1" })
  ok(bWo.ok && bWo.itemId === "item-b" && bWo.options[0].qtyAvailable === 25, "B10 BOM 의 다른 자재(B)의 LOT 도 조회 가능 — 어느 자재 행에 반영할지는 서버가 확인한 품목으로 결정")
  const woOther = await act.lookupLotForMaterialIssue({ workOrderId: "wo-t2", lotNo: "LOT-T2-ONLY" })
  ok(!woOther.ok && woOther.code === "WORK_ORDER_NOT_FOUND", "B11 다른 tenant 의 작업지시는 존재하지 않는 것처럼 거부")
  const woNone = await act.lookupLotForMaterialIssue({ workOrderId: "nope", lotNo: "LOT-A-1" })
  const woEmpty = await act.lookupLotForMaterialIssue({ workOrderId: " ", lotNo: "LOT-A-1" })
  ok(!woNone.ok && woNone.code === "WORK_ORDER_NOT_FOUND" && !woEmpty.ok && woEmpty.code === "WORK_ORDER_NOT_FOUND", "B12 없는/빈 작업지시 거부")
  for (const bad of ["", "   ", "A\nB", "X".repeat(200)]) {
    const r = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: bad })
    ok(!r.ok && r.code === "INVALID", `B13 잘못된 LOT 번호 입력 거부: ${JSON.stringify(bad).slice(0, 14)}`)
  }
  const sneaky = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-T2-ONLY", tenantId: "t2" } as never)
  ok(!sneaky.ok && sneaky.code === "LOT_NOT_FOUND", "B14 클라이언트가 tenant 를 보내도 무시한다(세션 tenant 기준)")
  user = "ANON"
  const anon = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-A-1" })
  user = "DENIED"
  const denied = await act.lookupLotForMaterialIssue({ workOrderId: "wo-1", lotNo: "LOT-A-1" })
  user = { tenantId: "t1" }
  ok(!anon.ok && anon.code === "UNAUTHORIZED" && !denied.ok && denied.code === "DENIED", "B15 로그인·권한 확인")
  ok(snapshot() === before, "B16 [QR 스캔만으로 재고가 변경되지 않음] 조회 전후 재고 데이터 동일")
  ok(accessed.every((a) => /^(workOrder\.findFirst|lot\.findFirst|inventoryBalance\.findMany)$/.test(a)) && accessed.length > 0, `B17 읽기 전용: 접근한 DB 메서드는 findFirst/findMany 뿐(${Array.from(new Set(accessed)).join(", ")}) — 쓰기·트랜잭션 접근 시 즉시 실패하는 가드를 통과`)

  // ─── C. 수동 선택과의 동일성 ───────────────────────────────────────────────
  const manualList = (await manual.getLotStockByItems(["item-a"], "t1"))["item-a"]
  const qrOptions = (multi.ok ? multi.options : []).concat(good.ok ? good.options : [])
  ok(qrOptions.every((q) => manualList.some((m) => JSON.stringify(m) === JSON.stringify(q))), "C1 QR 조회가 돌려준 재고 후보는 수동 선택 UI 의 LOT 목록(getLotStockByItems)에 있는 항목과 완전히 같다")
  ok(!manualList.some((m) => ["lot-nostock"].includes(m.lotId)), "C2 수동 목록에도 가용재고 0 인 LOT 는 없다(같은 재고 기준)")
  const dialog = read("src/app/app/mes/material-issue/issue-form-dialog.tsx")
  ok(dialog.includes("const getLotSelectValue = (lotStock: LotStockOption) => `${lotStock.lotId}:${lotStock.warehouseId}`") && scan.lotSelectValue({ lotId: "L", warehouseId: "W" }) === "L:W", "C3 QR 가 만드는 선택 값(lotId:warehouseId)은 수동 선택 UI 가 쓰는 값과 같은 형식")
  const submitBlock = dialog.slice(dialog.indexOf("const handleSubmit = () => {"), dialog.indexOf("// ── 재고 초과 경고"))
  ok(submitBlock.includes("issueMaterialsForWorkOrder(") && submitBlock.includes("getLotSplits(material.itemId)") && !/handleScannedLot|lookupLotForMaterialIssue|LotQrScanSection|viaQr|fromQr|scanned/i.test(submitBlock), "C4 출고 확정(handleSubmit)은 입력 방식을 구분하지 않는다 — 같은 LOT 행 구조를 읽어 같은 서버 액션을 호출(QR/스캔 분기 없음)")
  const issueCoreNow = coreIssueFingerprints(readSourceLf("src/lib/actions/material-issue.actions.ts"))
  ok(qrCouplingViolations(["src/lib/actions/inventory.actions.ts", "src/lib/actions/lot.actions.ts", "src/lib/actions/lot-reservation.actions.ts", "src/lib/quantity-scale.ts"]).length === 0 && issueCoreNow.decrement === CORE_ISSUE_BASELINE_FINGERPRINTS.decrement && issueCoreNow.reservation === CORE_ISSUE_BASELINE_FINGERPRINTS.reservation && schemaViolations().length === 0, "C5 재고·LOT·예약 서버 로직은 QR 에 결합되지 않았고 재고 차감·예약 갱신 코드는 QR 작업 이전과 동일(지문) · 스키마 변경 없음 — 확정 시 서버 검증은 수동/QR 동일")

  // ─── D. 소스 구조 ──────────────────────────────────────────────────────────
  const section = read("src/app/app/mes/material-issue/lot-qr-scan-section.tsx")
  ok(dialog.includes('import { LotQrScanSection } from "./lot-qr-scan-section"') && dialog.includes("<LotQrScanSection") && dialog.includes('title="출고 자재 목록"') && dialog.includes("onSelectLot={handleScannedLot}"), "D1 [QR 스캔] 은 자재출고 처리 창의 '출고 자재 목록' 머리(기존 LOT 선택 영역 바로 위)에 연결")
  ok(dialog.includes("addLotSplit") && dialog.includes("removeLotSplit") && dialog.includes("updateLotSplitRow") && (dialog.match(/<Select/g) ?? []).length >= 2 && dialog.includes("getLotStockByItems([itemId], tenantId)"), "D2 [수동 LOT 선택 유지] LOT 행 추가/삭제/변경과 LOT 선택 상자, 기존 LOT 재고 조회가 그대로 있다")
  const handler = dialog.slice(dialog.indexOf("const handleScannedLot ="), dialog.indexOf("const handleOpen ="))
  ok(!/issueMaterialsForWorkOrder|startTransition|router\.|alert\(|setQtyMap|setWarehouseMap/.test(handler) && /setLotSplitsMap/.test(handler) && /setLotStockMap/.test(handler), "D3 [스캔 후 자동 처리 없음] 스캔 반영 함수는 LOT 선택 상태만 바꾼다 — 출고 확정/수량/창고/서버 호출/화면 이동 없음")
  ok(/qty: ""/.test(read("src/lib/material-issue/lot-scan.ts")) && !/qtyAvailable/.test(read("src/lib/material-issue/lot-scan.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "D4 스캔한 LOT 의 재고를 출고 수량으로 자동 확정하지 않는다(수량 입력은 비움/기존 입력 유지)")
  ok(section.includes('result.kind !== "LOT"') && section.indexOf('result.kind !== "LOT"') < section.indexOf("await lookup("), "D5 WIP QR 은 서버 조회 전에 거부")
  ok(section.includes("busyRef.current") && section.includes("if (busyRef.current) return") && section.includes("disabled={disabled || busy}"), "D6 [연속 스캔 중복 조회 방지] 조회 중에는 새 스캔 무시 · 버튼 비활성")
  ok(!/issueMaterialsForWorkOrder|startTransition|createFinishedGoods|prisma/.test(section) && !/getUserMedia/.test(section + dialog), "D7 연동 컴포넌트는 출고/재고/DB 를 호출하지 않고 카메라도 직접 다루지 않는다(공통 스캐너 재사용)")
  ok(section.includes("QrScannerDialog") && !/new BarcodeDetector|jsQR|jsqr/.test(section), "D8 새 스캐너를 만들지 않고 공통 QrScannerDialog 를 재사용")
  ok(section.includes('process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"') && section.includes("{!QR_DISABLED && ("), "D9 [QR 는 선택 기능] 환경 스위치로 끄면 버튼/스캐너가 사라지고 기존 업무는 그대로")
  ok(section.includes('role={message.tone === "error" ? "alert" : "status"}') && section.includes("catch (error)") && section.includes("목록에서 직접 선택"), "D10 조회 실패/오류 시 한국어 안내와 수동 선택 안내 — 예외를 삼키지 않고 화면 입력은 유지")
  ok(!/setLotSplitsMap\(\{\}\)|setQtyMap\(\{\}\)/.test(handler + section), "D11 오류 시 작성 중인 출고 데이터를 초기화하지 않는다")
  const act0 = read("src/lib/actions/material-issue-lot-lookup.actions.ts")
  ok(act0.startsWith('"use server"') && !/\.(create|update|updateMany|delete|deleteMany|upsert)\(|\$transaction|\$executeRaw|recordAuditLog|revalidate/.test(act0), "D12 서버 조회 액션은 읽기 전용(쓰기·감사·캐시 재검증 없음)")
  ok(!/tenantId:\s*string/.test(act0.slice(act0.indexOf("export async function lookupLotForMaterialIssue"), act0.indexOf("{", act0.indexOf("export async function lookupLotForMaterialIssue") + 60))) && act0.includes("getLotStockByItems(") && act0.includes("resolveLotStockReader"), "D13 tenant 를 클라이언트에서 받지 않고 세션으로 확인 · 기존 LOT 재고 조회 재사용")
  const others = ["src/app/app/mes/material-receipt", "src/app/app/mes/finished-goods-receipt", "src/app/app/mes/shipments", "src/app/app/mes/inventory", "src/app/app/mes/material", "src/app/app/mes/lot", "src/app/pop", "src/app/app/pop", "src/app/kiosk"]
  function walk(dir: string): string[] {
    const fs = require("node:fs") as typeof import("node:fs")
    return fs.readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return fs.statSync(full).isDirectory() ? walk(full) : [full]
    })
  }
  // 4-3단계: 출하 화면의 [QR 스캔]은 fg-lot-qr-scan.tsx 한 파일에만 둔다(test:shipment-fg-qr 가 그 외 출하 파일의 미연동을 따로 확인한다)
  const SHIPMENT_QR_FILE = join(process.cwd(), "src/app/app/mes/shipments/fg-lot-qr-scan.tsx")
  const offenders = others.flatMap((d) => walk(join(process.cwd(), d))).filter((f) => f !== SHIPMENT_QR_FILE && /\.(ts|tsx)$/.test(f) && /qr-scanner|QrScanner|lot-qr-scan-section/.test(readFileSync(f, "utf8")))
  ok(offenders.length === 0, "D14 입고·완제품입고·재고·LOT 관리·POP·키오스크 화면과 출하 화면(fg-lot-qr-scan.tsx 제외) 파일에는 스캐너를 직접 연결하지 않았다(POP 의 WIP QR 스캔은 공용 컴포넌트 src/components/pop 한 곳에만 있다)")
  const harness = read("src/app/label-print/scan/issue-lot/issue-lot-test-client.tsx")
  ok(!/from "@\/lib\/actions\/material-issue\.actions"[^;]*\{[^}]*(issueMaterials|getLot)/.test(harness) && !/issueMaterialsForWorkOrder|fetch\(/.test(harness), "D15 점검 화면은 출고/재고 서버 액션을 호출하지 않는다")
  // 이 단계의 변경 파일에 라벨 디자인/QR 규격이 없고, 규격 상수·QR 데이터 규격이 그대로임을 확인(이전 단계 변경은 아직 미커밋이라 HEAD diff 로는 구분할 수 없다)
  const spec = require("../src/lib/label/label-spec") as typeof import("../src/lib/label/label-spec")
  ok(spec.LABEL_WIDTH_MM === 90 && spec.LABEL_HEIGHT_MM === 29 && spec.LABEL_QR_MM_DEFAULT === 19 && lotLib.encodeLotQr("A") === "DAEWON|LOT|1|A" && lotLib.encodeWipQr("A") === "DAEWON|WIP|1|A", "D16 QR 라벨 규격(90×29mm, QR 19mm)과 QR 데이터 규격(DAEWON|LOT|1|… / DAEWON|WIP|1|…)은 그대로")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
