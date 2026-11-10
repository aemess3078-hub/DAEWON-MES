/**
 * ISSUE-009 — 생산 유형(ORDER / ORDER_EXTRA / STOCK)별 제조번호 자동발행 실제 PostgreSQL 검증 (로컬 테스트 DB 전용)
 *
 *   DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:<port>/<name>_test \
 *   npm run test:manufacturing-no-kind-db
 *
 * generateManufacturingNo(서버 액션)를 그대로 호출하고 인증/캐시만 대체한다.
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
delete process.env.NEXT_PUBLIC_BRAND // 대원정밀 경로(번호 규칙 관리 SERIAL 규칙)

const state = { tenantId: "" }
const MI = Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string; _load: (r: string, ...a: unknown[]) => unknown }
const origResolve = MI._resolveFilename
MI._resolveFilename = function (request: string, ...rest: unknown[]) {
  return origResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const origLoad = MI._load
const user = () => ({ id: "u1", profileId: null, tenantId: state.tenantId, role: "OWNER", name: "DB Test", email: "t@example.invalid" })
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
const wo = require("../src/lib/actions/work-order.actions") as typeof import("../src/lib/actions/work-order.actions")

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
const yy = String(new Date().getFullYear()).slice(2)

const withClient = [
  { id: "1", type: "CONTEXT", key: "CLIENT_CODE", fallback: "GEN" },
  { id: "2", type: "SEPARATOR", value: "-" },
  { id: "3", type: "CONTEXT", key: "ITEM_CODE" },
  { id: "4", type: "SEPARATOR", value: "-" },
  { id: "5", type: "DATE", format: "YY" },
  { id: "6", type: "SEQ", digits: 3 },
]
const withoutClient = [
  { id: "1", type: "FIXED", value: "MFG" },
  { id: "2", type: "SEPARATOR", value: "-" },
  { id: "3", type: "DATE", format: "YY" },
  { id: "4", type: "SEQ", digits: 3 },
]

async function main() {
  const tenant = await prisma.tenant.create({ data: { code: `mf-${uid()}`, name: "mfg kind" } })
  state.tenantId = tenant.id
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "S", name: "S" } })
  const item = await prisma.item.create({ data: { tenantId: tenant.id, code: "BRK01", name: "BRK01", itemType: "FINISHED", uom: "EA" } })
  const customer = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: "ACME", name: "ACME", partnerType: "CUSTOMER" } })
  const so = await prisma.salesOrder.create({
    data: { tenantId: tenant.id, siteId: site.id, customerId: customer.id, orderNo: "SO-1", orderDate: new Date(), deliveryDate: new Date() },
  })
  const soi = await prisma.salesOrderItem.create({ data: { salesOrderId: so.id, itemId: item.id, qty: 100 } })
  let planSeq = 0
  const newPlan = () =>
    prisma.productionPlan.create({
      data: { tenantId: tenant.id, siteId: site.id, planNo: `PP-${++planSeq}`, planType: "DAILY", startDate: new Date(), endDate: new Date() },
    })
  const mkPlanItem = async (kind: "ORDER" | "ORDER_EXTRA" | "STOCK", salesOrderItemId: string | null) =>
    prisma.productionPlanItem.create({
      data: {
        planId: (await newPlan()).id,
        itemId: item.id,
        plannedQty: 10,
        productionKind: kind,
        salesOrderItemId,
        // DB CHECK: STOCK=0 / ORDER=plannedQty / ORDER_EXTRA<plannedQty + 사유
        allocatedQty: kind === "STOCK" ? 0 : kind === "ORDER" ? 10 : 8,
        extraReason: kind === "ORDER_EXTRA" ? "여유 생산" : null,
        extraApprovalStatus: kind === "ORDER_EXTRA" ? "APPROVED" : "NOT_REQUIRED",
      },
    })
  const pOrder = await mkPlanItem("ORDER", soi.id)
  const pExtra = await mkPlanItem("ORDER_EXTRA", soi.id)
  const pStock = await mkPlanItem("STOCK", null)
  // 수주생산인데 고객코드가 비어 있는 수주(DB 제약상 ORDER 는 수주 품목 연결이 필수 → 고객 정보 누락은 공백 코드로 재현)
  const blankCustomer = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: " ", name: "NOCODE", partnerType: "CUSTOMER" } })
  const so2 = await prisma.salesOrder.create({
    data: { tenantId: tenant.id, siteId: site.id, customerId: blankCustomer.id, orderNo: "SO-2", orderDate: new Date(), deliveryDate: new Date() },
  })
  const soi2 = await prisma.salesOrderItem.create({ data: { salesOrderId: so2.id, itemId: item.id, qty: 100 } })
  const pOrderNoSo = await mkPlanItem("ORDER", soi2.id)
  const setRule = async (tokens: unknown) => {
    await prisma.numberingRule.upsert({
      where: { tenantId_type: { tenantId: tenant.id, type: "SERIAL" } },
      create: { tenantId: tenant.id, type: "SERIAL", tokens: tokens as never, isActive: true },
      update: { tokens: tokens as never, isActive: true },
    })
  }
  const gen = (planItemId: string | null) => wo.generateManufacturingNo(tenant.id, item.id, 0, planItemId)

  await setRule(withClient)
  await t("수주생산(ORDER): 수주 고객코드 사용", async () => {
    assert.equal(await gen(pOrder.id), `ACME-BRK01-${yy}001`)
  })
  await t("수주+여유생산(ORDER_EXTRA): 수주 고객코드 사용", async () => {
    assert.equal(await gen(pExtra.id), `ACME-BRK01-${yy}001`)
  })
  await t("재고생산(STOCK): 고객코드 대신 STK", async () => {
    assert.equal(await gen(pStock.id), `STK-BRK01-${yy}001`)
  })
  await t("수주생산인데 수주 고객코드 누락: STK·기본값 대체 없이 오류", async () => {
    await assert.rejects(() => gen(pOrderNoSo.id), /수주생산 제조번호에 고객코드가 필요/)
  })
  await t("순번·중복 방지: 같은 접두 번호가 발행돼 있으면 다음 순번", async () => {
    const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: item.id, version: "1", status: "ACTIVE" } })
    const routing = await prisma.routing.create({ data: { tenantId: tenant.id, code: "RT", name: "RT", version: "1", status: "ACTIVE", scope: "COMMON" } })
    await prisma.workOrder.create({
      data: { tenantId: tenant.id, siteId: site.id, itemId: item.id, bomId: bom.id, routingId: routing.id, orderNo: "WO-1", plannedQty: 10, manufacturingNo: `STK-BRK01-${yy}001` },
    })
    assert.equal(await gen(pStock.id), `STK-BRK01-${yy}002`)
    assert.equal(await gen(pOrder.id), `ACME-BRK01-${yy}001`, "다른 고객코드 계열은 별도 순번")
  })
  await t("계획 연결 없는 작업지시(기존 동작 유지): 규칙 기본값 사용", async () => {
    assert.equal(await gen(null), `GEN-BRK01-${yy}001`)
  })

  await setRule(withoutClient)
  await t("고객코드 없는 규칙: 생산 유형과 무관하게 기존 규칙대로", async () => {
    assert.equal(await gen(pOrder.id), `MFG-${yy}001`)
    assert.equal(await gen(pExtra.id), `MFG-${yy}001`)
    assert.equal(await gen(pStock.id), `MFG-${yy}001`)
    assert.equal(await gen(pOrderNoSo.id), `MFG-${yy}001`, "고객코드 변수가 없으면 수주 누락도 영향 없음")
  })

  console.log(`\n${pass} passed${process.exitCode ? ", with failures" : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
