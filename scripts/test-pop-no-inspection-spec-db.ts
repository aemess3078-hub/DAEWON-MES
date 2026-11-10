/**
 * POP 자주검사 불량 기록 — 검사표준 없이도 저장되는지 실제 PostgreSQL 로 검증 (로컬 테스트 DB 전용)
 *
 *   DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:<port>/<name>_test \
 *   npm run test:pop-no-inspection-spec-db
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

const state = { tenantId: "" }
const MI = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _load: (r: string, ...a: unknown[]) => unknown }
const origResolve = MI._resolveFilename
MI._resolveFilename = function (request: string, ...rest: unknown[]) {
  return origResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const origLoad = MI._load
MI._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} }
  if (request === "@/lib/auth") {
    return new Proxy({ getTenantId: async () => state.tenantId }, {
      get: (t: Record<string, unknown>, p: string) => t[p] ?? (() => { throw new Error(`unexpected @/lib/auth.${String(p)}`) }),
    })
  }
  if (request === "@/lib/auth/role-permissions") return { requireResourcePermission: async () => {} }
  return origLoad.call(this, request, ...rest)
}

const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const helpers = require("../src/lib/actions/self-inspection.helpers") as typeof import("../src/lib/actions/self-inspection.helpers")
const stats = require("../src/lib/actions/defect-stats.actions") as typeof import("../src/lib/actions/defect-stats.actions")

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

async function main() {
  const tenant = await prisma.tenant.create({ data: { code: `np-${uid()}`, name: "nospec" } })
  state.tenantId = tenant.id
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "S", name: "S" } })
  const wc = await prisma.workCenter.create({ data: { siteId: site.id, code: "WC", name: "WC", kind: "ASSEMBLY" } })
  const profile = await prisma.profile.create({ data: { email: `p-${uid()}@example.invalid`, name: "작업자" } })
  const mkItem = (code: string) =>
    prisma.item.create({ data: { tenantId: tenant.id, code, name: code, itemType: "FINISHED", uom: "EA" } })
  const withSpec = await mkItem("WITH-SPEC")
  const noSpec = await mkItem("NO-SPEC")
  const routing = await prisma.routing.create({
    data: { tenantId: tenant.id, code: "RT", name: "RT", version: "1", status: "ACTIVE", scope: "COMMON" },
  })
  const rop = await prisma.routingOperation.create({
    data: { routingId: routing.id, seq: 10, operationCode: "CNC", name: "CNC", workCenterId: wc.id, standardTime: 1 },
  })
  const mkWo = async (item: { id: string }, no: string) => {
    const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: item.id, version: "1", status: "ACTIVE" } })
    const wo = await prisma.workOrder.create({
      data: { tenantId: tenant.id, siteId: site.id, itemId: item.id, bomId: bom.id, routingId: routing.id, orderNo: no, plannedQty: 100 },
    })
    return prisma.workOrderOperation.create({ data: { workOrderId: wo.id, routingOperationId: rop.id, seq: 10, plannedQty: 100 } })
  }
  const woOpWith = await mkWo(withSpec, "WO-A")
  const woOpNo = await mkWo(noSpec, "WO-B")
  // withSpec 품목에만 검사표준 등록. noSpec 품목은 없음(테넌트에는 다른 품목의 ACTIVE 표준이 있음 → 임의 연결되면 안 됨).
  const spec = await prisma.inspectionSpec.create({
    data: { tenantId: tenant.id, itemId: withSpec.id, routingOperationId: rop.id, version: "1", status: "ACTIVE" },
  })
  const d1 = await prisma.defectCode.create({ data: { tenantId: tenant.id, code: "D001", name: "치수 불량", defectCategory: "DIMENSIONAL" } })
  const d3 = await prisma.defectCode.create({ data: { tenantId: tenant.id, code: "D003", name: "스크래치", defectCategory: "VISUAL" } })
  const otherTenant = await prisma.tenant.create({ data: { code: `ot-${uid()}`, name: "other" } })
  const dOther = await prisma.defectCode.create({ data: { tenantId: otherTenant.id, code: "D001", name: "타", defectCategory: "VISUAL" } })

  const run = (woOp: { id: string }, item: { id: string }, details: { defectCodeId: string; qty: number }[]) =>
    prisma.$transaction((tx) =>
      helpers.recordSelfInspectionDefects(tx, {
        tenantId: tenant.id,
        workOrderOperationId: woOp.id,
        itemId: item.id,
        routingOperationId: rop.id,
        inspectorProfileId: profile.id,
        inspectedQty: 50,
        defectDetails: details,
      })
    )

  await t("검사표준 없는 품목: 불량 실적 저장(inspectionSpecId=null), 불량코드별 내역 저장", async () => {
    await run(woOpNo, noSpec, [{ defectCodeId: d1.id, qty: 3 }, { defectCodeId: d3.id, qty: 2 }])
    const insp = await prisma.qualityInspection.findMany({ where: { workOrderOperationId: woOpNo.id }, include: { defectRecords: true } })
    assert.equal(insp.length, 1)
    assert.equal(insp[0].inspectionSpecId, null, "다른 품목 검사표준이 연결되면 안 됨")
    assert.equal(insp[0].stage, "MID")
    assert.equal(insp[0].result, "FAIL")
    assert.equal(insp[0].defectRecords.length, 2)
    assert.equal(insp[0].defectRecords.reduce((s, r) => s + Number(r.qty), 0), 5)
    assert.ok(insp[0].defectRecords.every((r) => r.disposition === "SCRAP"))
  })

  await t("검사표준이 있는 품목: 기존대로 해당 표준에 연결", async () => {
    await run(woOpWith, withSpec, [{ defectCodeId: d1.id, qty: 1 }])
    const insp = await prisma.qualityInspection.findFirstOrThrow({ where: { workOrderOperationId: woOpWith.id } })
    assert.equal(insp.inspectionSpecId, spec.id)
  })

  await t("불량 없음(재작업만 등) → 검사 기록 없음, 오류 없음", async () => {
    const before = await prisma.qualityInspection.count()
    await run(woOpNo, noSpec, [])
    assert.equal(await prisma.qualityInspection.count(), before)
  })

  await t("타 테넌트 불량코드는 거절(롤백)", async () => {
    const before = await prisma.qualityInspection.count()
    await assert.rejects(() => run(woOpNo, noSpec, [{ defectCodeId: dOther.id, qty: 1 }]), /불량코드/)
    assert.equal(await prisma.qualityInspection.count(), before)
  })

  await t("불량통계에 검사표준 없는 불량이 반영됨", async () => {
    const r = await stats.getDefectStats({})
    const text = JSON.stringify(r)
    assert.ok(text.includes("NO-SPEC"), "NO-SPEC 품목이 통계에 포함돼야 함")
    assert.ok(text.includes("치수 불량") && text.includes("스크래치"))
  })

  console.log(`\n${pass} passed${process.exitCode ? ", with failures" : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
