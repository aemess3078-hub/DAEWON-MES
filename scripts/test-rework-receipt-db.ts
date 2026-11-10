/**
 * ISSUE-013 — 재작업 발생 시 완제품 입고 (실제 PostgreSQL, 로컬 테스트 DB 전용)
 *
 *   DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:<port>/<name>_test \
 *   npm run test:rework-receipt-db
 *
 * 서버 액션(getWorkOrdersForReceipt / createFinishedGoodsReceiptAction / completeRework)을 그대로 호출하고 인증/캐시만 대체한다.
 * 시나리오: 계획 100 / 양품 90 / 재작업 10 → 90 입고 → 재작업 종결(양품 6 · 폐기 4) → 6 추가 입고 → 합계 96.
 */
import assert from "node:assert/strict"
import { join } from "node:path"
import Module from "node:module"

const url = process.env.DATABASE_URL ?? ""
const m = url.match(/^postgres(?:ql)?:\/\/[^@]*@([^:/]+):(\d+)\/([^?]+)/)
if (process.env.DAEWON_TEST_DB_CONFIRM !== "YES_LOCAL_TEST_DB" || !m || !["127.0.0.1", "localhost"].includes(m[1]) || !/_test$/.test(m[3])) {
  console.error("ABORT: 로컬 테스트 DB(127.0.0.1/localhost 의 *_test)가 확인되지 않아 실행하지 않습니다.")
  process.exit(2)
}

const state = { tenantId: "", profileId: null as string | null }
const MI = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _load: (r: string, ...a: unknown[]) => unknown }
const origResolve = MI._resolveFilename
MI._resolveFilename = function (request: string, ...rest: unknown[]) {
  return origResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const origLoad = MI._load
const user = () => ({ id: state.profileId ?? "u1", profileId: state.profileId, tenantId: state.tenantId, role: "OWNER", name: "DB Test", email: "t@example.invalid" })
MI._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} }
  if (request === "@/lib/auth") {
    return new Proxy(
      {
        getTenantId: async () => state.tenantId,
        getCurrentUser: async () => user(),
        requireRole: async () => user(),
        requireTenantAccess: async () => user(),
      },
      { get: (t: Record<string, unknown>, p: string) => t[p] ?? (() => { throw new Error(`unexpected @/lib/auth.${String(p)}`) }) }
    )
  }
  if (request === "@/lib/auth/role-permissions") return { requireResourcePermission: async () => {} }
  return origLoad.call(this, request, ...rest)
}

const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const fg = require("../src/lib/actions/finished-goods.actions") as typeof import("../src/lib/actions/finished-goods.actions")
const pp = require("../src/lib/actions/process-progress.actions") as typeof import("../src/lib/actions/process-progress.actions")

let pass = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    pass++
    console.log(`PASS ${name}`)
  } catch (e) {
    console.error(`FAIL ${name}:`, e instanceof Error ? e.message : e)
    process.exitCode = 1
  }
}
const uid = () => Math.random().toString(36).slice(2, 8)
const N = (v: unknown) => Number(v)

async function main() {
  const tenant = await prisma.tenant.create({ data: { code: `rw-${uid()}`, name: "rework receipt" } })
  state.tenantId = tenant.id
  state.profileId = (await prisma.profile.create({ data: { email: `rw-${uid()}@example.invalid`, name: "DB Test" } })).id
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "S", name: "S" } })
  const wc = await prisma.workCenter.create({ data: { siteId: site.id, code: "WC", name: "WC", kind: "ASSEMBLY" } })
  const wh = await prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code: "FG", name: "FG" } })
  const item = await prisma.item.create({
    data: { tenantId: tenant.id, code: "FG-1", name: "FG-1", itemType: "FINISHED", uom: "EA", isLotTracked: true },
  })
  const routing = await prisma.routing.create({
    data: { tenantId: tenant.id, code: "RT", name: "RT", version: "1", status: "ACTIVE", scope: "COMMON" },
  })
  const rop = [10, 20].map((seq) => ({ seq }))
  const ropRows = await Promise.all(
    rop.map((r) =>
      prisma.routingOperation.create({
        data: { routingId: routing.id, seq: r.seq, operationCode: `OP${r.seq}`, name: `OP${r.seq}`, workCenterId: wc.id, standardTime: 1 },
      })
    )
  )
  const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: item.id, version: "1", status: "ACTIVE" } })

  /** reworkAtFinal: 재작업 child 가 최종공정에 있는 정상 케이스 / false 면 중간공정(seq10)에 있는 케이스 */
  async function mkWorkOrder(orderNo: string, mfgNo: string, reworkAtFinal: boolean) {
    const wo = await prisma.workOrder.create({
      data: {
        tenantId: tenant.id, siteId: site.id, itemId: item.id, bomId: bom.id, routingId: routing.id,
        orderNo, plannedQty: 100, status: "COMPLETED", manufacturingNo: mfgNo,
      },
    })
    const op10 = await prisma.workOrderOperation.create({
      data: { workOrderId: wo.id, routingOperationId: ropRows[0].id, seq: 10, plannedQty: 100, completedQty: reworkAtFinal ? 100 : 90, status: "COMPLETED" },
    })
    const op20 = await prisma.workOrderOperation.create({
      data: { workOrderId: wo.id, routingOperationId: ropRows[1].id, seq: 20, plannedQty: 100, completedQty: 90, status: "COMPLETED" },
    })
    const reworkOp = reworkAtFinal ? op20 : op10
    await prisma.productionResult.create({ data: { workOrderOperationId: op10.id, goodQty: reworkAtFinal ? 100 : 90, defectQty: 0, reworkQty: reworkAtFinal ? 0 : 10 } })
    const finalResult = await prisma.productionResult.create({ data: { workOrderOperationId: op20.id, goodQty: 90, defectQty: 0, reworkQty: reworkAtFinal ? 10 : 0 } })
    const reworkResult = reworkAtFinal ? finalResult : await prisma.productionResult.findFirstOrThrow({ where: { workOrderOperationId: op10.id } })
    const root = await prisma.wipUnit.create({
      data: { tenantId: tenant.id, siteId: site.id, workOrderId: wo.id, workOrderOperationId: op20.id, itemId: item.id, qty: 90, status: "COMPLETED", manufacturingNo: mfgNo },
    })
    const child = await prisma.wipUnit.create({
      data: {
        tenantId: tenant.id, siteId: site.id, workOrderId: wo.id, workOrderOperationId: reworkOp.id, itemId: item.id, qty: 10,
        status: "REWORK", parentWipUnitId: root.id, sourceProductionResultId: reworkResult.id, manufacturingNo: mfgNo,
      },
    })
    await prisma.wipMovement.createMany({
      data: [
        { tenantId: tenant.id, wipUnitId: root.id, relatedWipUnitId: child.id, movementType: "REWORK", qty: 10 },
        { tenantId: tenant.id, wipUnitId: root.id, relatedWipUnitId: child.id, movementType: "SPLIT", qty: 10 },
      ],
    })
    return { wo, root, child }
  }
  const listRow = async (woId: string) => (await fg.getWorkOrdersForReceipt(tenant.id)).find((r) => r.id === woId)!
  const receive = (woId: string, qty: number) =>
    fg.createFinishedGoodsReceiptAction({ workOrderId: woId, itemId: item.id, siteId: site.id, warehouseId: wh.id, receiptQty: qty })

  // ── 시나리오 A: 최종공정 재작업(계획 100 / 양품 90 / 재작업 10) ──────────────────────────
  const A = await mkWorkOrder("WO-A", "MFG-A", true)

  await t("A1 재작업 10 이 있어도 정상 양품 90 은 입고 가능(전체 차단 없음) · 재작업 10 별도 보류 표시", async () => {
    const r = await listRow(A.wo.id)
    assert.equal(r.receiptBlockedReason, null)
    assert.equal(r.pendingQty, 90)
    assert.equal(r.reworkHoldQty, 10)
  })
  await t("A2 최초 양품 90 입고 성공", async () => {
    const res = await receive(A.wo.id, 90)
    assert.equal(res.ok, true, res.error)
  })
  await t("A3 재작업 10 은 입고 보류 — 추가 입고 시도(1) 거절, 중복 입고 방지", async () => {
    const r = await listRow(A.wo.id)
    assert.equal(r.pendingQty, 0)
    assert.equal(r.reworkHoldQty, 10)
    const again = await receive(A.wo.id, 1)
    assert.equal(again.ok, false)
    const dup = await receive(A.wo.id, 90)
    assert.equal(dup.ok, false)
    assert.equal(N((await prisma.finishedGoodsReceipt.aggregate({ where: { workOrderId: A.wo.id }, _sum: { receiptQty: true } }))._sum.receiptQty), 90)
  })
  await t("A4 90 초과 입고 요청(100) 거절", async () => {
    const res = await receive(A.wo.id, 100)
    assert.equal(res.ok, false)
  })
  await t("A5 재작업 종결: 양품 복귀 6 · 폐기 4", async () => {
    const res = await pp.completeRework({ reworkWipUnitId: A.child.id, mergedQty: 6, scrapQty: 4 })
    assert.equal(res.ok, true, res.error)
    const root = await prisma.wipUnit.findUniqueOrThrow({ where: { id: A.root.id } })
    assert.equal(N(root.qty), 96)
    const mv = await prisma.wipMovement.findMany({ where: { sourceType: "ReworkCompletion", sourceId: A.child.id } })
    assert.deepEqual(mv.map((x) => `${x.movementType}:${N(x.qty)}`).sort(), ["MERGE:6", "SCRAP:4"])
    const again = await pp.completeRework({ reworkWipUnitId: A.child.id, mergedQty: 6, scrapQty: 4 })
    assert.equal(again.ok, false, "이미 종결된 재작업 재처리 방지")
  })
  await t("A6 복귀 양품 6 은 추가 입고 가능, 폐기 4 는 입고 대상 아님", async () => {
    const r = await listRow(A.wo.id)
    assert.equal(r.receiptBlockedReason, null, "복귀분이 '완료수량 비정합'으로 막히면 안 됨")
    assert.equal(r.pendingQty, 6)
    assert.equal(r.reworkHoldQty, 0)
    const over = await receive(A.wo.id, 7)
    assert.equal(over.ok, false)
    const ok = await receive(A.wo.id, 6)
    assert.equal(ok.ok, true, ok.error)
  })
  await t("A7 최종: 입고 합계 96 · 폐기 4 · 이후 추가 입고 불가", async () => {
    assert.equal(N((await prisma.finishedGoodsReceipt.aggregate({ where: { workOrderId: A.wo.id }, _sum: { receiptQty: true } }))._sum.receiptQty), 96)
    assert.equal((await receive(A.wo.id, 1)).ok, false)
    const r = await listRow(A.wo.id)
    assert.equal(r.pendingQty, 0)
    const scrapped = await prisma.wipMovement.aggregate({ where: { movementType: "SCRAP", sourceId: A.child.id }, _sum: { qty: true } })
    assert.equal(N(scrapped._sum.qty), 4)
  })
  await t("A8 LOT 추적성: 회차별 LOT 분리, 수불·재고 합계 96 일치, WipUnit.lotId 는 최초 LOT", async () => {
    const receipts = await prisma.finishedGoodsReceipt.findMany({ where: { workOrderId: A.wo.id }, include: { lot: true }, orderBy: { receiptAt: "asc" } })
    assert.equal(receipts.length, 2)
    assert.ok(receipts.every((r) => r.lotId && r.lot))
    assert.notEqual(receipts[0].lotId, receipts[1].lotId)
    assert.ok(receipts[0].lot!.lotNo.startsWith("MFG-A") && receipts[1].lot!.lotNo.startsWith("MFG-A"))
    const txs = await prisma.inventoryTransaction.findMany({ where: { tenantId: tenant.id, refType: "WORK_ORDER", refId: A.wo.id, txType: "RECEIPT" } })
    assert.deepEqual(txs.map((x) => N(x.qty)).sort((a, b) => a - b), [6, 90])
    const bal = await prisma.inventoryBalance.aggregate({ where: { tenantId: tenant.id, itemId: item.id }, _sum: { qtyOnHand: true } })
    assert.equal(N(bal._sum.qtyOnHand), 96)
    const root = await prisma.wipUnit.findUniqueOrThrow({ where: { id: A.root.id } })
    assert.equal(root.lotId, receipts[0].lotId)
  })

  // ── 시나리오 B: 중간공정 재작업(현재 범위 밖 — 별도 개선) ─────────────────────────────────
  const B = await mkWorkOrder("WO-B", "MFG-B", false)
  await t("B1 중간공정 재작업이 있어도 완료 root 90 은 입고 가능, 재작업 10 은 보류", async () => {
    const r = await listRow(B.wo.id)
    assert.equal(r.receiptBlockedReason, null)
    assert.equal(r.pendingQty, 90)
    assert.equal(r.reworkHoldQty, 10)
    assert.equal((await receive(B.wo.id, 90)).ok, true)
  })
  await t("B2 중간공정 재작업 종결(ISSUE-014): 합격 6 은 다음(최종) 공정부터 복귀 root 로 재개, 폐기 4 는 이력만", async () => {
    const res = await pp.completeRework({ reworkWipUnitId: B.child.id, mergedQty: 6, scrapQty: 4 })
    assert.equal(res.ok, true, res.error)
    const roots = await prisma.wipUnit.findMany({ where: { workOrderId: B.wo.id, parentWipUnitId: null, sourceProductionResultId: null } })
    assert.equal(roots.length, 2)
    assert.equal(N(roots.find((r) => r.status === "WAITING")!.qty), 6)
    // 복귀분은 최종공정 완료 전이라 입고 대상이 아니다(기존 입고 90 이후 추가 입고 불가).
    const row = await listRow(B.wo.id)
    assert.equal(row.pendingQty, 0)
    assert.equal((await receive(B.wo.id, 1)).ok, false)
  })

  // ── 시나리오 C: 기존 보류 조건 유지(판별 불가 레거시 재작업은 계속 차단) ──────────────────────
  await t("C1 재작업 child 연결이 없는 레거시 reworkQty 는 기존대로 전체 차단", async () => {
    const wo = await prisma.workOrder.create({
      data: { tenantId: tenant.id, siteId: site.id, itemId: item.id, bomId: bom.id, routingId: routing.id, orderNo: "WO-C", plannedQty: 100, status: "COMPLETED", manufacturingNo: "MFG-C" },
    })
    const op = await prisma.workOrderOperation.create({ data: { workOrderId: wo.id, routingOperationId: ropRows[1].id, seq: 20, plannedQty: 100, completedQty: 90, status: "COMPLETED" } })
    await prisma.productionResult.create({ data: { workOrderOperationId: op.id, goodQty: 90, defectQty: 0, reworkQty: 10 } })
    await prisma.wipUnit.create({ data: { tenantId: tenant.id, siteId: site.id, workOrderId: wo.id, workOrderOperationId: op.id, itemId: item.id, qty: 90, status: "COMPLETED" } })
    const r = await listRow(wo.id)
    assert.ok(r.receiptBlockedReason)
    assert.equal(r.pendingQty, 0)
    assert.equal((await receive(wo.id, 10)).ok, false)
  })

  console.log(`\n${pass} passed${process.exitCode ? ", with failures" : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
