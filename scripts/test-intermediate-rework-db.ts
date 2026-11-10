/**
 * ISSUE-014 — 중간공정 재작업 종결 (실제 PostgreSQL, 로컬 테스트 DB 전용)
 *
 *   DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:<port>/<name>_test \
 *   npm run test:intermediate-rework-db
 *
 * POP 서버 액션(startOperation / submitProductionResult), completeRework, 완제품입고 액션을 그대로 호출하고 인증/캐시만 대체한다.
 *  S1: CNC 선삭 → 세척 → 품질검사 → 포장 (양품 86 / 재작업 2 → 합격 2 복귀: 방식 M)
 *  S2: CNC 선삭 → 품질검사 → 포장 (품질검사 양품 90 / 재작업 10, 포장까지 완료 후 합격 6 · 폐기 4: 방식 R)
 *  S3: 활성 root 가 이미 복귀 공정을 지난 경우 종결 거절(데이터 불변) / S4: 전량 폐기 · 합계 불일치
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
const pp = require("../src/lib/actions/process-progress.actions") as typeof import("../src/lib/actions/process-progress.actions")
const fg = require("../src/lib/actions/finished-goods.actions") as typeof import("../src/lib/actions/finished-goods.actions")

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
  const tenant = await prisma.tenant.create({ data: { code: `ir-${uid()}`, name: "mid rework" } })
  state.tenantId = tenant.id
  const profile = await prisma.profile.create({ data: { email: `ir-${uid()}@example.invalid`, name: "작업자" } })
  state.profileId = profile.id
  await prisma.tenantUser.create({ data: { tenantId: tenant.id, profileId: profile.id, role: "OPERATOR", isActive: true } as never })
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "S", name: "S" } })
  const wc = await prisma.workCenter.create({ data: { siteId: site.id, code: "WC", name: "WC", kind: "ASSEMBLY" } })
  const wh = await prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code: "FG", name: "FG" } })
  const item = await prisma.item.create({ data: { tenantId: tenant.id, code: "FG-1", name: "FG-1", itemType: "FINISHED", uom: "EA", isLotTracked: true } })
  const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: item.id, version: "1", status: "ACTIVE" } })
  let ropSeq = 0
  let rtSeq = 0
  const mkRouting = () => prisma.routing.create({ data: { tenantId: tenant.id, code: `RT${++rtSeq}`, name: "RT", version: "1", status: "ACTIVE", scope: "COMMON" } })
  const mkRop = async (routingId: string, name: string, seq: number) =>
    prisma.routingOperation.create({ data: { routingId, seq, operationCode: `OP${++ropSeq}`, name, workCenterId: wc.id, standardTime: 1 } })

  /** 자재출고 완료 상태(root WIP WAITING, 첫 공정)의 작업지시를 만든다. */
  async function mkWo(orderNo: string, planned: number, opNames: string[]) {
    const routing = await mkRouting()
    const wo = await prisma.workOrder.create({
      data: { tenantId: tenant.id, siteId: site.id, itemId: item.id, bomId: bom.id, routingId: routing.id, orderNo, plannedQty: planned, status: "RELEASED", manufacturingNo: `MFG-${orderNo}` },
    })
    const ops = []
    for (let i = 0; i < opNames.length; i++) {
      const r = await mkRop(routing.id, opNames[i], (i + 1) * 10)
      ops.push(await prisma.workOrderOperation.create({ data: { workOrderId: wo.id, routingOperationId: r.id, seq: (i + 1) * 10, plannedQty: planned } }))
    }
    const root = await prisma.wipUnit.create({
      data: { tenantId: tenant.id, siteId: site.id, workOrderId: wo.id, workOrderOperationId: ops[0].id, itemId: item.id, qty: planned, status: "WAITING", manufacturingNo: wo.manufacturingNo, currentWorkCenterId: wc.id },
    })
    await prisma.wipMovement.create({ data: { tenantId: tenant.id, wipUnitId: root.id, movementType: "CREATED", qty: planned } })
    return { wo, ops, root }
  }
  const run = async (opId: string, good: number, defect = 0, rework = 0) => {
    const s = await pop.startOperation(opId)
    assert.equal(s.success, true, `start: ${s.error}`)
    return pop.submitProductionResult({ workOrderOperationId: opId, goodQty: good, defectQty: defect, reworkQty: rework, defectDetails: [] } as never)
  }
  const submitMore = (opId: string, good: number) =>
    pop.submitProductionResult({ workOrderOperationId: opId, goodQty: good, defectQty: 0, reworkQty: 0, defectDetails: [] } as never)
  const roots = (woId: string) =>
    prisma.wipUnit.findMany({ where: { workOrderId: woId, parentWipUnitId: null, sourceProductionResultId: null }, orderBy: { createdAt: "asc" } })
  const opRows = (woId: string) => prisma.workOrderOperation.findMany({ where: { workOrderId: woId }, orderBy: { seq: "asc" } })
  const receivable = async (woId: string) => (await fg.getWorkOrdersForReceipt(tenant.id)).find((r) => r.id === woId)
  const receive = (woId: string, qty: number) =>
    fg.createFinishedGoodsReceiptAction({ workOrderId: woId, itemId: item.id, siteId: site.id, warehouseId: wh.id, receiptQty: qty })
  const reworkChild = (woId: string) =>
    prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: woId, parentWipUnitId: { not: null }, status: "REWORK" } })

  // ═══ S1: CNC 선삭 → 세척 → 품질검사 → 포장, 선삭 양품 86 / 재작업 2 (방식 M) ═══════════════════
  const S1 = await mkWo("WO-S1", 88, ["CNC 선삭", "세척", "품질검사", "포장"])
  let s1Child = ""
  await t("S1-1 선삭 양품 86 / 재작업 2 등록 → 선삭 완료, root(86) 세척 대기, 재작업 child 2", async () => {
    const r = await run(S1.ops[0].id, 86, 0, 2)
    assert.equal(r.success, true, r.error)
    const [root] = await roots(S1.wo.id)
    assert.equal(N(root.qty), 86)
    assert.equal(root.status, "WAITING")
    const ops = await opRows(S1.wo.id)
    assert.equal(ops[0].status, "COMPLETED")
    assert.equal(N(ops[0].completedQty), 88)
    const child = await reworkChild(S1.wo.id)
    s1Child = child.id
    assert.equal(N(child.qty), 2)
  })
  await t("S1-2 재작업 대기 목록: 복귀 공정 = 세척, 종결 가능", async () => {
    const list = await pp.getReworkPendingList(tenant.id)
    const row = list.find((x) => x.id === s1Child)!
    assert.equal(row.canComplete, true)
    assert.equal(row.returnToOperation?.name, "세척")
  })
  await t("S1-3 재작업 종결(합격 2): root 88 로 합류, 선삭 완료수량·생산실적 불변(중복 집계 없음)", async () => {
    const res = await pp.completeRework({ reworkWipUnitId: s1Child, mergedQty: 2, scrapQty: 0 })
    assert.equal(res.ok, true, res.error)
    const all = await roots(S1.wo.id)
    assert.equal(all.length, 1, "root 는 1개 유지(중복 WIP 없음)")
    assert.equal(N(all[0].qty), 88)
    const ops = await opRows(S1.wo.id)
    assert.equal(N(ops[0].completedQty), 88)
    assert.equal(ops[0].status, "COMPLETED")
    assert.equal((await prisma.productionResult.findMany({ where: { workOrderOperationId: S1.ops[0].id } })).length, 1)
    const again = await pp.completeRework({ reworkWipUnitId: s1Child, mergedQty: 2, scrapQty: 0 })
    assert.equal(again.ok, false, "재종결 거절")
    assert.equal(N((await roots(S1.wo.id))[0].qty), 88)
  })
  await t("S1-4 합격 복귀분 포함 88 이 후속공정(세척→품질검사→포장)을 정상 진행", async () => {
    for (const op of S1.ops.slice(1)) {
      const r = await run(op.id, 88)
      assert.equal(r.success, true, `${op.seq}: ${r.error}`)
    }
    const [root] = await roots(S1.wo.id)
    assert.equal(root.status, "COMPLETED")
    assert.equal(N(root.qty), 88)
    const ops = await opRows(S1.wo.id)
    assert.deepEqual(ops.map((o) => N(o.completedQty)), [88, 88, 88, 88])
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: S1.wo.id } })).status, "COMPLETED")
  })
  await t("S1-5 모든 공정 완료 후에만 입고: 88 입고 가능, 초과·중복 거절", async () => {
    const row = await receivable(S1.wo.id)
    assert.equal(row?.pendingQty, 88)
    assert.equal(row?.reworkHoldQty, 0)
    assert.equal((await receive(S1.wo.id, 89)).ok, false)
    assert.equal((await receive(S1.wo.id, 88)).ok, true)
    assert.equal((await receive(S1.wo.id, 1)).ok, false)
  })
  await t("S1-6 추적성: 수불·재고 88 · 이동이력(REWORK/SPLIT/MERGE) 보존", async () => {
    const bal = await prisma.inventoryBalance.aggregate({
      where: { tenantId: tenant.id, itemId: item.id, lot: { lotNo: { startsWith: "MFG-WO-S1" } } },
      _sum: { qtyOnHand: true },
    })
    assert.equal(N(bal._sum.qtyOnHand), 88)
    const types = (await prisma.wipMovement.findMany({ where: { wipUnit: { workOrderId: S1.wo.id } } })).map((x) => x.movementType as string)
    for (const need of ["REWORK", "SPLIT", "MERGE", "MOVED", "COMPLETED"]) assert.ok(types.includes(need), `${need} 이력`)
    const merge = await prisma.wipMovement.findFirstOrThrow({ where: { movementType: "MERGE", sourceId: s1Child } })
    assert.equal(N(merge.qty), 2)
    assert.equal(merge.relatedWipUnitId, s1Child)
  })

  // ═══ S2: CNC 선삭 → 품질검사 → 포장, 품질검사 양품 90 / 재작업 10, 포장까지 완료 후 종결 (방식 R) ═══════════
  const S2 = await mkWo("WO-S2", 100, ["CNC 선삭", "품질검사", "포장"])
  let s2Child = ""
  await t("S2-1 선삭 100 → 품질검사 양품 90 / 재작업 10 → 포장 90 완료(WO 완료, root 90 COMPLETED)", async () => {
    assert.equal((await run(S2.ops[0].id, 100)).success, true)
    const r = await run(S2.ops[1].id, 90, 0, 10)
    assert.equal(r.success, true, r.error)
    const p = await run(S2.ops[2].id, 90)
    assert.equal(p.success, true, p.error)
    const [root] = await roots(S2.wo.id)
    assert.equal(root.status, "COMPLETED")
    assert.equal(N(root.qty), 90)
    s2Child = (await reworkChild(S2.wo.id)).id
  })
  await t("S2-2 정상 양품 90 은 재작업 종결 전에도 선입고 가능", async () => {
    assert.equal((await receivable(S2.wo.id))?.pendingQty, 90)
    assert.equal((await receive(S2.wo.id, 90)).ok, true)
  })
  await t("S2-3 재작업 종결(합격 6 · 폐기 4): 복귀 root 6 이 포장 대기, 후속공정 재개, 폐기 이력 기록", async () => {
    const res = await pp.completeRework({ reworkWipUnitId: s2Child, mergedQty: 6, scrapQty: 4 })
    assert.equal(res.ok, true, res.error)
    const all = await roots(S2.wo.id)
    assert.equal(all.length, 2)
    const ret = all.find((r) => r.status === "WAITING")!
    assert.equal(N(ret.qty), 6)
    assert.equal(ret.workOrderOperationId, S2.ops[2].id)
    const ops = await opRows(S2.wo.id)
    assert.deepEqual(ops.map((o) => o.status as string), ["COMPLETED", "COMPLETED", "PENDING"])
    assert.deepEqual(ops.map((o) => N(o.completedQty)), [100, 100, 90], "재작업 공정 완료수량 불변(중복 집계 없음)")
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: S2.wo.id } })).status, "IN_PROGRESS")
    const scrap = await prisma.wipMovement.findFirstOrThrow({ where: { movementType: "SCRAP", sourceType: "ReworkCompletion", sourceId: s2Child } })
    assert.equal(N(scrap.qty), 4)
    assert.equal((await prisma.wipUnit.findUniqueOrThrow({ where: { id: s2Child } })).status, "COMPLETED")
  })
  await t("S2-4 복귀 6 은 포장 완료 전 입고 불가(기존 입고분 이후 추가 입고 0)", async () => {
    const row = await receivable(S2.wo.id)
    assert.ok(row, "재개된 작업지시도 입고 목록에 유지")
    assert.equal(row!.pendingQty, 0)
    assert.equal((await receive(S2.wo.id, 1)).ok, false)
  })
  await t("S2-5 POP: 복귀 6 만 포장 가능(초과 7 불가), 포장 완료 시 WO 재완료", async () => {
    const s = await pop.startOperation(S2.ops[2].id)
    assert.equal(s.success, true, s.error)
    assert.equal((await submitMore(S2.ops[2].id, 7)).success, false)
    const ok = await submitMore(S2.ops[2].id, 6)
    assert.equal(ok.success, true, ok.error)
    const ops = await opRows(S2.wo.id)
    assert.equal(ops[2].status, "COMPLETED")
    assert.equal(N(ops[2].completedQty), 96)
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: S2.wo.id } })).status, "COMPLETED")
    assert.ok((await roots(S2.wo.id)).every((r) => r.status === "COMPLETED"))
    assert.equal((await submitMore(S2.ops[2].id, 1)).success, false, "완료 공정에 추가 실적 불가")
  })
  await t("S2-6 최종: 입고 합계 96 · 폐기 4 · 추가·중복 입고 불가, LOT/수불/재고 일치", async () => {
    assert.equal((await receivable(S2.wo.id))?.pendingQty, 6)
    assert.equal((await receive(S2.wo.id, 7)).ok, false)
    assert.equal((await receive(S2.wo.id, 6)).ok, true)
    assert.equal((await receive(S2.wo.id, 1)).ok, false)
    assert.equal(N((await prisma.finishedGoodsReceipt.aggregate({ where: { workOrderId: S2.wo.id }, _sum: { receiptQty: true } }))._sum.receiptQty), 96)
    const lots = await prisma.finishedGoodsReceipt.findMany({ where: { workOrderId: S2.wo.id }, select: { lotId: true } })
    assert.equal(new Set(lots.map((l) => l.lotId)).size, 2)
    const bal = await prisma.inventoryBalance.aggregate({
      where: { tenantId: tenant.id, itemId: item.id, lot: { lotNo: { startsWith: "MFG-WO-S2" } } },
      _sum: { qtyOnHand: true },
    })
    assert.equal(N(bal._sum.qtyOnHand), 96)
    const neg = await prisma.inventoryBalance.count({ where: { tenantId: tenant.id, OR: [{ qtyOnHand: { lt: 0 } }, { qtyAvailable: { lt: 0 } }] } })
    assert.equal(neg, 0)
    const sumScrap = await prisma.wipMovement.aggregate({ where: { movementType: "SCRAP", sourceId: s2Child }, _sum: { qty: true } })
    assert.equal(N(sumScrap._sum.qty), 4)
    assert.equal(96 + N(sumScrap._sum.qty), 100, "입고 + 폐기 = 재작업 전 전체 수량")
  })

  // ═══ S3: 주 흐름이 이미 복귀 공정을 지난 경우 → 거절(데이터 불변) ═══════════════════════════════
  const S3 = await mkWo("WO-S3", 50, ["CNC 선삭", "세척", "포장"])
  await t("S3 root 가 복귀 공정(세척) 이후로 진행된 경우 종결 거절 · 상태/수량 불변", async () => {
    assert.equal((await run(S3.ops[0].id, 48, 0, 2)).success, true)
    assert.equal((await run(S3.ops[1].id, 48)).success, true) // root 가 포장 대기로 이동
    const child = await reworkChild(S3.wo.id)
    const res = await pp.completeRework({ reworkWipUnitId: child.id, mergedQty: 2, scrapQty: 0 })
    assert.equal(res.ok, false)
    assert.match(res.error ?? "", /주 생산 흐름/)
    assert.equal((await prisma.wipUnit.findUniqueOrThrow({ where: { id: child.id } })).status, "REWORK")
    assert.equal(N((await roots(S3.wo.id))[0].qty), 48)
    assert.equal(await prisma.wipMovement.count({ where: { sourceId: child.id, sourceType: { in: ["ReworkMerge", "ReworkReturn", "ReworkCompletion"] } } }), 0)
  })

  // ═══ S4: 전량 폐기 · 합계 불일치 ═══════════════════════════════════════════════════════════
  const S4 = await mkWo("WO-S4", 20, ["CNC 선삭", "세척"])
  await t("S4 합계 불일치 거절 / 전량 폐기는 WIP 에서 제외·폐기 이력만 기록(root 불변)", async () => {
    assert.equal((await run(S4.ops[0].id, 18, 0, 2)).success, true)
    const child = await reworkChild(S4.wo.id)
    assert.equal((await pp.completeRework({ reworkWipUnitId: child.id, mergedQty: 1, scrapQty: 2 })).ok, false)
    const res = await pp.completeRework({ reworkWipUnitId: child.id, mergedQty: 0, scrapQty: 2 })
    assert.equal(res.ok, true, res.error)
    assert.equal((await prisma.wipUnit.findUniqueOrThrow({ where: { id: child.id } })).status, "SCRAPPED")
    assert.equal(N((await roots(S4.wo.id))[0].qty), 18)
    assert.equal(N((await prisma.wipMovement.findFirstOrThrow({ where: { movementType: "SCRAP", sourceId: child.id } })).qty), 2)
  })

  console.log(`\n${pass} passed${process.exitCode ? ", with failures" : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
