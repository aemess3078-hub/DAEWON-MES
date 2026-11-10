/**
 * 외주관리 흐름(외주출고 → 외주입고 → 입고검사 → 공정완료·WIP 이동 → POP 후속공정 → 완제품입고) 실제 PostgreSQL 검증 (로컬 테스트 DB 전용)
 *
 *   DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:<port>/<name>_test \
 *   npm run test:outsourcing-flow-db
 *
 * 외주/POP/재작업/완제품입고 서버 액션을 그대로 호출하고 인증/캐시만 대체한다.
 *  S1: WO-2026-005 유형 — 품질검사 외주 100 → 차단 → 입고 → 합격 100 → 공정완료 → 포장 WIP 100 → POP 포장 → 완제품 입고
 *  S2: 일부 합격(60)·불량(10)·재외주(30) 수량 정산, 재외주 재입고 검사(합격 20·불량 5·재외주 5) 후 정상 흐름 복귀
 *  S3: 최종공정이 외주인 경우 / S4: 중복 처리·가드
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

const state = { tenantId: "", profileId: "" }
const MI = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _load: (r: string, ...a: unknown[]) => unknown }
const origResolve = MI._resolveFilename
MI._resolveFilename = function (request: string, ...rest: unknown[]) {
  return origResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const origLoad = MI._load
const user = () => ({ id: state.profileId, profileId: state.profileId, tenantId: state.tenantId, role: "OWNER", name: "DB Test", email: "t@example.invalid" })
MI._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} }
  if (request === "@/lib/auth/pop-worker-session") return { getPopWorkerSession: async () => null, setPopWorkerSessionCookie: async () => {} }
  if (request === "@/lib/auth") {
    return new Proxy(
      { getTenantId: async () => state.tenantId, getCurrentUser: async () => user(), requireRole: async () => user(), requireTenantAccess: async () => user() },
      { get: (t: Record<string, unknown>, p: string) => t[p] ?? (() => { throw new Error(`unexpected @/lib/auth.${String(p)}`) }) }
    )
  }
  if (request === "@/lib/auth/role-permissions") return { requireResourcePermission: async () => {} }
  return origLoad.call(this, request, ...rest)
}

const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const pop = require("../src/lib/actions/pop.actions") as typeof import("../src/lib/actions/pop.actions")
const os = require("../src/lib/actions/outsourcing.actions") as typeof import("../src/lib/actions/outsourcing.actions")
const fg = require("../src/lib/actions/finished-goods.actions") as typeof import("../src/lib/actions/finished-goods.actions")
const lot = require("../src/lib/actions/lot-lineage.actions") as typeof import("../src/lib/actions/lot-lineage.actions")

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
async function rejects(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return ""
}

async function main() {
  const tenant = await prisma.tenant.create({ data: { code: `os-${uid()}`, name: "outsourcing" } })
  state.tenantId = tenant.id
  const profile = await prisma.profile.create({ data: { email: `os-${uid()}@example.invalid`, name: "작업자" } })
  state.profileId = profile.id
  await prisma.tenantUser.create({ data: { tenantId: tenant.id, profileId: profile.id, role: "OPERATOR", isActive: true } as never })
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "S", name: "S" } })
  const wc = await prisma.workCenter.create({ data: { siteId: site.id, code: "WC", name: "WC", kind: "ASSEMBLY" } })
  const wh = await prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code: "FG", name: "FG" } })
  const supplier = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: "SUP", name: "외주처A", partnerType: "SUPPLIER" } })
  const mkItem = (code: string) => prisma.item.create({ data: { tenantId: tenant.id, code, name: code, itemType: "FINISHED", uom: "EA", isLotTracked: true } })
  const item = await mkItem("FG-1")
  const item2 = await mkItem("FG-2")
  const bomOf = (itemId: string) => prisma.bOM.create({ data: { tenantId: tenant.id, itemId, version: `v${++bomSeq}`, status: "ACTIVE" } })
  let ropSeq = 0
  let bomSeq = 0
  let rtSeq = 0

  async function mkWo(orderNo: string, planned: number, opNames: string[], itemRow = item) {
    const routing = await prisma.routing.create({ data: { tenantId: tenant.id, code: `RT${++rtSeq}`, name: "RT", version: "1", status: "ACTIVE", scope: "COMMON" } })
    const bom = await bomOf(itemRow.id)
    const wo = await prisma.workOrder.create({
      data: { tenantId: tenant.id, siteId: site.id, itemId: itemRow.id, bomId: bom.id, routingId: routing.id, orderNo, plannedQty: planned, status: "RELEASED", manufacturingNo: `MFG-${orderNo}` },
    })
    const ops = []
    for (let i = 0; i < opNames.length; i++) {
      const r = await prisma.routingOperation.create({ data: { routingId: routing.id, seq: (i + 1) * 10, operationCode: `OP${++ropSeq}`, name: opNames[i], workCenterId: wc.id, standardTime: 1 } })
      ops.push(await prisma.workOrderOperation.create({ data: { workOrderId: wo.id, routingOperationId: r.id, seq: (i + 1) * 10, plannedQty: planned } }))
    }
    const root = await prisma.wipUnit.create({
      data: { tenantId: tenant.id, siteId: site.id, workOrderId: wo.id, workOrderOperationId: ops[0].id, itemId: itemRow.id, qty: planned, status: "WAITING", manufacturingNo: wo.manufacturingNo, currentWorkCenterId: wc.id },
    })
    await prisma.wipMovement.create({ data: { tenantId: tenant.id, wipUnitId: root.id, movementType: "CREATED", qty: planned } })
    return { wo, ops, root }
  }
  const popRun = async (opId: string, good: number, defect = 0, rework = 0) => {
    const s = await pop.startOperation(opId)
    assert.equal(s.success, true, `start: ${s.error}`)
    return pop.submitProductionResult({ workOrderOperationId: opId, goodQty: good, defectQty: defect, reworkQty: rework, defectDetails: [] } as never)
  }
  const popSubmit = (opId: string, good: number) =>
    pop.submitProductionResult({ workOrderOperationId: opId, goodQty: good, defectQty: 0, reworkQty: 0, defectDetails: [] } as never)
  const newPo = async () => (await os.createOutsourcingOrder({ supplierId: supplier.id, outsourcingProcessName: "외주공정" })) as { id: string; orderNo: string }
  const poStatus = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status as string
  const wip = (id: string) => prisma.wipUnit.findUniqueOrThrow({ where: { id } })
  const opRows = (woId: string) => prisma.workOrderOperation.findMany({ where: { workOrderId: woId }, orderBy: { seq: "asc" } })
  const queueRow = async (opId: string) => (await pop.getPopWorkQueueRows(tenant.id)).find((r) => r.operationId === opId)
  const receiveFg = (woId: string, itemId: string, qty: number) =>
    fg.createFinishedGoodsReceiptAction({ workOrderId: woId, itemId, siteId: site.id, warehouseId: wh.id, receiptQty: qty })
  const fgRow = async (woId: string) => (await fg.getWorkOrdersForReceipt(tenant.id)).find((r) => r.id === woId)

  // ═══ S1: WO-2026-005 유형 — 품질검사(20) 외주 100 ═══════════════════════════════════════════
  const S1 = await mkWo("WO-S1", 100, ["CNC 밀링", "품질검사", "포장"])
  const po1 = await newPo()
  let rootId = ""
  await t("S1-1 CNC 밀링 완료 → 품질검사 대기 WIP 100 → 외주출고 100: WIP OUTSOURCED, 공정·작업지시 진행중, 발주 발주완료", async () => {
    assert.equal((await popRun(S1.ops[0].id, 100)).success, true)
    const root = await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: S1.wo.id, parentWipUnitId: null } })
    rootId = root.id
    assert.equal(root.status, "WAITING")
    assert.equal(root.workOrderOperationId, S1.ops[1].id)
    await os.issueWipUnitToOutsourcing({ wipUnitId: rootId, outsourcingOrderId: po1.id })
    assert.equal((await wip(rootId)).status, "OUTSOURCED")
    const ops = await opRows(S1.wo.id)
    assert.equal(ops[1].status, "IN_PROGRESS")
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: S1.wo.id } })).status, "IN_PROGRESS")
    assert.equal(await poStatus(po1.id), "ORDERED")
    const item = await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po1.id } })
    assert.equal(item.workOrderOperationId, S1.ops[1].id, "외주발주 품목은 작업지시의 특정 공정에 연결")
    assert.equal(N(item.qty), 100)
  })
  await t("S1-2 외주 진행 중: POP 작업시작·실적등록 차단, 작업 큐에 '외주 진행 중' 표시(작업불가)", async () => {
    const s = await pop.startOperation(S1.ops[1].id)
    assert.equal(s.success, false)
    assert.match(s.error ?? "", /외주 진행 중/)
    const r = await popSubmit(S1.ops[1].id, 10)
    assert.equal(r.success, false)
    const row = await queueRow(S1.ops[1].id)
    assert.equal(row?.canWork, false)
    assert.equal(row?.availabilityLabel, "외주 진행 중")
    assert.equal((await prisma.productionResult.count({ where: { workOrderOperationId: S1.ops[1].id } })), 0)
  })
  await t("S1-3 외주입고 100: WIP RECEIVED(검사대기), 발주 입고완료, 검사 대기 중에도 POP 차단", async () => {
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: rootId })
    assert.equal((await wip(rootId)).status, "RECEIVED")
    assert.equal(await poStatus(po1.id), "RECEIVED")
    const s = await pop.startOperation(S1.ops[1].id)
    assert.equal(s.success, false)
    assert.match(s.error ?? "", /검사 대기/)
    assert.equal((await queueRow(S1.ops[1].id))?.availabilityLabel, "외주 검사 대기")
    assert.match(await rejects(() => os.receiveWipUnitFromOutsourcing({ wipUnitId: rootId })), /외주 처리되지 않은|이미/, "외주입고 중복 차단")
    const item = await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: po1.id } })
    assert.equal(N(item.receivedQty), 100)
  })
  await t("S1-4 입고검사 합격 100: 품질검사 공정 완료 실적(양품 100) 반영, WIP 100 이 포장 대기로 자동 이동", async () => {
    const r = await os.inspectOutsourcedWipUnit({ wipUnitId: rootId, acceptedQty: 100, defectQty: 0, reworkQty: 0 })
    assert.equal(r.success, true)
    const w = await wip(rootId)
    assert.equal(w.status, "WAITING")
    assert.equal(N(w.qty), 100)
    assert.equal(w.workOrderOperationId, S1.ops[2].id)
    const ops = await opRows(S1.wo.id)
    assert.equal(ops[1].status, "COMPLETED")
    assert.equal(N(ops[1].completedQty), 100)
    const results = await prisma.productionResult.findMany({ where: { workOrderOperationId: S1.ops[1].id } })
    assert.equal(results.length, 1)
    assert.equal(N(results[0].goodQty), 100)
    const moved = await prisma.wipMovement.findMany({ where: { wipUnitId: rootId, movementType: "MOVED", fromOperationId: S1.ops[1].id } })
    assert.equal(moved.length, 1)
    assert.equal(moved[0].toOperationId, S1.ops[2].id)
  })
  await t("S1-5 중복 방지: 검사 재처리·완료 공정 POP 실적·재외주출고 모두 거절, 실적/이동 1건 유지", async () => {
    assert.match(await rejects(() => os.inspectOutsourcedWipUnit({ wipUnitId: rootId, acceptedQty: 100, defectQty: 0, reworkQty: 0 })), /검사대기|검사처리/)
    assert.equal((await popSubmit(S1.ops[1].id, 1)).success, false)
    assert.match(await rejects(() => os.issueWipUnitToOutsourcing({ wipUnitId: rootId, outsourcingOrderId: po1.id })), /입고완료|이미 완료된 공정/)
    assert.equal(await prisma.productionResult.count({ where: { workOrderOperationId: S1.ops[1].id } }), 1)
    assert.equal(await prisma.wipMovement.count({ where: { wipUnitId: rootId, movementType: "MOVED", fromOperationId: S1.ops[1].id } }), 1)
  })
  await t("S1-6 포장 POP 작업 가능 → 완료 → 작업지시 완료, 완제품 입고 100 (제조번호·LOT 추적)", async () => {
    const row = await queueRow(S1.ops[2].id)
    assert.equal(row?.canWork, true)
    assert.equal((await fgRow(S1.wo.id))?.pendingQty ?? 0, 0, "후속공정 완료 전에는 입고 대상 아님")
    const r = await popRun(S1.ops[2].id, 100)
    assert.equal(r.success, true, r.error)
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: S1.wo.id } })).status, "COMPLETED")
    assert.equal((await fgRow(S1.wo.id))?.pendingQty, 100)
    assert.equal((await receiveFg(S1.wo.id, item.id, 100)).ok, true)
    assert.equal((await receiveFg(S1.wo.id, item.id, 1)).ok, false)
    const lot = await prisma.finishedGoodsReceipt.findFirstOrThrow({ where: { workOrderId: S1.wo.id }, include: { lot: true } })
    assert.ok(lot.lot!.lotNo.startsWith("MFG-WO-S1"))
    assert.equal((await wip(rootId)).manufacturingNo, "MFG-WO-S1")
  })
  await t("S1-7 외주발주 목록: 입고완료 발주는 진행 중에서 제외, 전체 조회·이력 유지", async () => {
    const active = await os.getOutsourcingData({})
    assert.ok(!active.orders.some((o) => o.id === po1.id))
    const all = await os.getOutsourcingData({ scope: "all" })
    const row = all.orders.find((o) => o.id === po1.id)!
    assert.equal(row.status, "RECEIVED")
    assert.equal(row.totalReceivedQty, 100)
    assert.ok(all.wipReceivingHistory.some((h) => h.outsourcingOrderNo === po1.orderNo), "외주입고 이력 유지")
    assert.equal(active.summary.completed >= 1, true, "요약 건수는 완료 발주 포함")
  })

  await t("S1-8 LOT 이력추적 데이터: 외주 이력(반출·입고·검사완료)이 sourceType 과 함께 조회되고, 외주공정 실적에 시작·종료 시각이 있다", async () => {
    const receiptLot = await prisma.finishedGoodsReceipt.findFirstOrThrow({ where: { workOrderId: S1.wo.id }, include: { lot: true } })
    const lineage = await lot.getLotLineageByNo(receiptLot.lot!.lotNo, tenant.id)
    assert.ok(lineage, "LOT 이력추적 결과")
    const hist = lineage!.outsourcingHistory.map((h) => `${h.movementType}:${h.sourceType ?? "-"}`)
    assert.ok(hist.includes("OUTSOURCED:PurchaseOrderItem"), "외주 반출")
    assert.ok(hist.includes("RETURNED:PurchaseOrderItem"), "외주 입고")
    assert.ok(hist.includes("RELEASED:OutsourcingInspection"), "외주 검사완료(보류해제와 sourceType 으로 구분)")
    const wo = lineage!.workOrders.find((w) => w.id === S1.wo.id)!
    const op = wo.operations.find((o) => o.id === S1.ops[1].id)!
    assert.equal(op.productionResults.length, 1)
    assert.ok(op.productionResults[0].startedAt && op.productionResults[0].endedAt, "외주공정 작업시작·완료 시각 기록")
    assert.ok(new Date(op.productionResults[0].startedAt!).getTime() <= new Date(op.productionResults[0].endedAt!).getTime())
  })

  // ═══ S1b: 발주 상태 — 발주완료 / 부분입고 / 입고완료 ═══════════════════════════════════════
  await t("S1b 한 발주에 두 품목 출고: 미입고 발주완료 → 한 품목 입고 부분입고 → 전량 입고완료", async () => {
    const A = await mkWo("WO-P1", 10, ["선삭", "외주도금", "포장"], item)
    const B = await mkWo("WO-P2", 20, ["선삭", "외주도금", "포장"], item2)
    assert.equal((await popRun(A.ops[0].id, 10)).success, true)
    assert.equal((await popRun(B.ops[0].id, 20)).success, true)
    const po = await newPo()
    const rA = await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: A.wo.id, parentWipUnitId: null } })
    const rB = await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: B.wo.id, parentWipUnitId: null } })
    await os.issueWipUnitToOutsourcing({ wipUnitId: rA.id, outsourcingOrderId: po.id })
    await os.issueWipUnitToOutsourcing({ wipUnitId: rB.id, outsourcingOrderId: po.id })
    assert.equal(await poStatus(po.id), "ORDERED")
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: rA.id })
    assert.equal(await poStatus(po.id), "PARTIAL_RECEIVED")
    assert.ok((await os.getOutsourcingData({})).orders.some((o) => o.id === po.id), "부분입고는 진행 중 목록에 유지")
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: rB.id })
    assert.equal(await poStatus(po.id), "RECEIVED")
  })

  // ═══ S2: 일부 합격·불량·재외주 ═════════════════════════════════════════════════════════════
  const S2 = await mkWo("WO-S2", 100, ["CNC 밀링", "품질검사", "포장"])
  let s2Root = ""
  let reworkChild = ""
  await t("S2-1 외주 100 → 입고검사 합격 60 / 불량 10 / 재외주 30: 공정 완료 실적 정산, WIP 60 만 포장으로 이동", async () => {
    assert.equal((await popRun(S2.ops[0].id, 100)).success, true)
    s2Root = (await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: S2.wo.id, parentWipUnitId: null } })).id
    const po = await newPo()
    await os.issueWipUnitToOutsourcing({ wipUnitId: s2Root, outsourcingOrderId: po.id })
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: s2Root })
    const r = await os.inspectOutsourcedWipUnit({ wipUnitId: s2Root, acceptedQty: 60, defectQty: 10, reworkQty: 30 })
    assert.equal(r.success, true)
    reworkChild = r.createdReworkWipUnitId!
    const w = await wip(s2Root)
    assert.equal(N(w.qty), 60)
    assert.equal(w.workOrderOperationId, S2.ops[2].id)
    const result = await prisma.productionResult.findFirstOrThrow({ where: { workOrderOperationId: S2.ops[1].id } })
    assert.deepEqual([N(result.goodQty), N(result.defectQty), N(result.reworkQty)], [60, 10, 30])
    const ops = await opRows(S2.wo.id)
    assert.equal(ops[1].status, "COMPLETED")
    assert.equal(N(ops[1].completedQty), 100)
    const defect = await prisma.wipUnit.findUniqueOrThrow({ where: { id: r.createdDefectWipUnitId! } })
    assert.equal(defect.status, "SCRAPPED")
    assert.equal(N(defect.qty), 10)
    const rw = await wip(reworkChild)
    assert.equal(rw.status, "REWORK")
    assert.equal(N(rw.qty), 30)
    assert.equal(N(w.qty) + 10 + 30, 100, "수량 정산: 합격+불량+재외주 = 외주출고")
  })
  await t("S2-2 재외주 30 은 정상 후속공정(포장)에 투입되지 않는다: POP 가능 수량 60", async () => {
    assert.equal((await popRun(S2.ops[2].id, 100)).success, false)
    assert.equal((await popSubmit(S2.ops[2].id, 61)).success, false)
    const ok = await popSubmit(S2.ops[2].id, 60)
    assert.equal(ok.success, true, ok.error)
    assert.equal((await wip(s2Root)).status, "COMPLETED")
    assert.equal(N((await wip(s2Root)).qty), 60)
  })
  await t("S2-3 완제품 입고: 정상 60 만 입고 가능, 재외주 30 은 보류로 표시", async () => {
    const row = await fgRow(S2.wo.id)
    assert.equal(row?.pendingQty, 60)
    assert.equal(row?.reworkHoldQty, 30)
    assert.equal((await receiveFg(S2.wo.id, item.id, 61)).ok, false)
    assert.equal((await receiveFg(S2.wo.id, item.id, 60)).ok, true)
  })
  await t("S2-4 재외주 30 을 다시 외주출고 → 입고 → 검사(합격 20 / 불량 5 / 재외주 5): 합격 20 은 포장부터 정상 흐름 복귀", async () => {
    const po = await newPo()
    await os.issueWipUnitToOutsourcing({ wipUnitId: reworkChild, outsourcingOrderId: po.id })
    assert.equal((await wip(reworkChild)).status, "OUTSOURCED")
    assert.equal((await pop.startOperation(S2.ops[1].id)).success, false)
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: reworkChild })
    const r = await os.inspectOutsourcedWipUnit({ wipUnitId: reworkChild, acceptedQty: 20, defectQty: 5, reworkQty: 5 })
    assert.equal(r.success, true)
    // 복귀 root 20 이 포장 대기, 포장 공정 재개
    const roots = await prisma.wipUnit.findMany({ where: { workOrderId: S2.wo.id, parentWipUnitId: null } })
    assert.equal(roots.length, 2)
    const back = roots.find((x) => x.status === "WAITING")!
    assert.equal(N(back.qty), 20)
    assert.equal(back.workOrderOperationId, S2.ops[2].id)
    const ops = await opRows(S2.wo.id)
    assert.deepEqual(ops.map((o) => o.status as string), ["COMPLETED", "COMPLETED", "PENDING"])
    assert.equal(N(ops[1].completedQty), 100, "외주공정 완료수량 불변(중복 집계 없음)")
    // 남은 재외주 5 는 별도 REWORK 로 관리
    const left = await prisma.wipUnit.findMany({ where: { workOrderId: S2.wo.id, status: "REWORK" } })
    assert.equal(left.length, 1)
    assert.equal(N(left[0].qty), 5)
    assert.equal(N((await wip(reworkChild)).qty), 25)
    assert.equal((await wip(reworkChild)).status, "COMPLETED")
    assert.equal((await fgRow(S2.wo.id))?.pendingQty, 0, "복귀분은 포장 완료 전 입고 불가")
  })
  await t("S2-5 복귀 20 포장 → 입고 20, 최종 정산 입고 80 + 폐기 15 + 재외주 대기 5 = 100", async () => {
    const r = await popRun(S2.ops[2].id, 20)
    assert.equal(r.success, true, r.error)
    assert.equal((await receiveFg(S2.wo.id, item.id, 20)).ok, true)
    assert.equal((await receiveFg(S2.wo.id, item.id, 1)).ok, false)
    const received = N((await prisma.finishedGoodsReceipt.aggregate({ where: { workOrderId: S2.wo.id }, _sum: { receiptQty: true } }))._sum.receiptQty)
    const scrapped = N((await prisma.wipMovement.aggregate({ where: { movementType: "SCRAP", wipUnit: { workOrderId: S2.wo.id } }, _sum: { qty: true } }))._sum.qty)
    const pendingRework = N((await prisma.wipUnit.aggregate({ where: { workOrderId: S2.wo.id, status: "REWORK" }, _sum: { qty: true } }))._sum.qty)
    assert.equal(received, 80)
    assert.equal(scrapped, 15)
    assert.equal(pendingRework, 5)
    assert.equal(received + scrapped + pendingRework, 100)
    const bal = await prisma.inventoryBalance.aggregate({ where: { tenantId: tenant.id, itemId: item.id, lot: { lotNo: { startsWith: "MFG-WO-S2" } } }, _sum: { qtyOnHand: true } })
    assert.equal(N(bal._sum.qtyOnHand), 80)
    assert.equal(await prisma.inventoryBalance.count({ where: { tenantId: tenant.id, qtyOnHand: { lt: 0 } } }), 0)
  })

  // ═══ S3: 최종공정이 외주 ═════════════════════════════════════════════════════════════════
  const S3 = await mkWo("WO-S3", 50, ["CNC 밀링", "외주 표면처리"])
  await t("S3 최종공정 외주: 검사 합격 후 완료 WIP → 완제품 입고 대상(검사 전에는 불가)", async () => {
    assert.equal((await popRun(S3.ops[0].id, 50)).success, true)
    const root = (await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: S3.wo.id, parentWipUnitId: null } })).id
    const po = await newPo()
    await os.issueWipUnitToOutsourcing({ wipUnitId: root, outsourcingOrderId: po.id })
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: root })
    assert.equal((await receiveFg(S3.wo.id, item.id, 50)).ok, false, "검사 전 입고 불가")
    assert.equal((await os.inspectOutsourcedWipUnit({ wipUnitId: root, acceptedQty: 50, defectQty: 0, reworkQty: 0 })).success, true)
    assert.equal((await wip(root)).status, "COMPLETED")
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: S3.wo.id } })).status, "COMPLETED")
    assert.equal((await fgRow(S3.wo.id))?.pendingQty, 50)
    assert.equal((await receiveFg(S3.wo.id, item.id, 50)).ok, true)
  })

  // ═══ S4: 가드 ═══════════════════════════════════════════════════════════════════════════
  const S4 = await mkWo("WO-S4", 40, ["선삭", "외주도금", "포장"])
  await t("S4 POP 실적이 이미 있는 공정 외주출고 거절 / 합계 불일치 검사 거절 / 이중 출고 거절", async () => {
    assert.equal((await popRun(S4.ops[0].id, 40)).success, true)
    // 외주공정에 POP 일부 실적 등록 후 외주출고 시도
    assert.equal((await pop.startOperation(S4.ops[1].id)).success, true)
    assert.equal((await popSubmit(S4.ops[1].id, 10)).success, true)
    const root = (await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: S4.wo.id, parentWipUnitId: null } })).id
    const po = await newPo()
    assert.match(await rejects(() => os.issueWipUnitToOutsourcing({ wipUnitId: root, outsourcingOrderId: po.id })), /POP 생산실적/)
    assert.equal((await wip(root)).status, "IN_PROCESS")
    // 완료 후 다음 WO 로 합계 불일치 검증
    const S5 = await mkWo("WO-S5", 30, ["선삭", "외주도금", "포장"])
    assert.equal((await popRun(S5.ops[0].id, 30)).success, true)
    const r5 = (await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: S5.wo.id, parentWipUnitId: null } })).id
    await os.issueWipUnitToOutsourcing({ wipUnitId: r5, outsourcingOrderId: po.id })
    assert.match(await rejects(() => os.issueWipUnitToOutsourcing({ wipUnitId: r5, outsourcingOrderId: po.id })), /이미 외주/)
    await os.receiveWipUnitFromOutsourcing({ wipUnitId: r5 })
    assert.match(await rejects(() => os.inspectOutsourcedWipUnit({ wipUnitId: r5, acceptedQty: 20, defectQty: 5, reworkQty: 0 })), /일치/)
    assert.equal((await wip(r5)).status, "RECEIVED", "검사 실패 시 상태 불변")
    assert.equal(await prisma.productionResult.count({ where: { workOrderOperationId: S5.ops[1].id } }), 0)
    // 전량 불합격(합격 0): 공정 완료 실적은 남고 WIP 는 SCRAPPED
    const ok = await os.inspectOutsourcedWipUnit({ wipUnitId: r5, acceptedQty: 0, defectQty: 30, reworkQty: 0 })
    assert.equal(ok.success, true)
    assert.equal((await wip(r5)).status, "SCRAPPED")
    assert.equal(N((await opRows(S5.wo.id))[1].completedQty), 30)
  })

  console.log(`\n${pass} passed${process.exitCode ? ", with failures" : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
