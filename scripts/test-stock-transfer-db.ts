/**
 * 창고 간 재고이동(transferInventoryStock) — 실제 PostgreSQL 통합 검증 (로컬 테스트 DB 전용)
 *
 *   DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:<port>/<name>_test \
 *   npm run test:stock-transfer-db
 *
 * 서버 액션을 그대로 호출하고 인증/캐시만 대체한다. 테스트 DB 이외에는 아무 곳도 쓰지 않는다.
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

const state = { tenantId: "", role: "MANAGER" as string }
const ModuleInternals = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string
  _load: (request: string, ...rest: unknown[]) => unknown
}
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const originalLoad = ModuleInternals._load
const user = () => ({ id: "u1", profileId: null, tenantId: state.tenantId, role: state.role, name: "DB Test", email: "t@example.invalid" })
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} }
  if (request === "@/lib/auth") {
    return new Proxy(
      {
        getTenantId: async () => state.tenantId,
        getCurrentUser: async () => user(),
        requireRole: async () => {
          if (state.role === "VIEWER") throw new Error("forbidden")
          return user()
        },
      },
      { get: (t: Record<string, unknown>, p: string) => t[p] ?? (() => { throw new Error(`unexpected @/lib/auth.${String(p)}`) }) }
    )
  }
  if (request === "@/lib/auth/role-permissions") return { requireResourcePermission: async () => {} }
  return originalLoad.call(this, request, ...rest)
}

const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const inv = require("../src/lib/actions/inventory.actions") as typeof import("../src/lib/actions/inventory.actions")

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
const N = (v: unknown) => Number(v)
const rid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function main() {
  const tenant = await prisma.tenant.create({ data: { code: rid("trf"), name: "transfer test" } })
  const other = await prisma.tenant.create({ data: { code: rid("oth"), name: "other tenant" } })
  state.tenantId = tenant.id
  const site = await prisma.site.create({ data: { tenantId: tenant.id, code: "S", name: "Site" } })
  const mkWh = (code: string) => prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code, name: code } })
  const [whA, whB, whC] = [await mkWh("A"), await mkWh("B"), await mkWh("C")]
  const otherSite = await prisma.site.create({ data: { tenantId: other.id, code: "S", name: "OSite" } })
  const otherWh = await prisma.warehouse.create({ data: { tenantId: other.id, siteId: otherSite.id, code: "X", name: "X" } })
  const mkItem = (code: string, lot: boolean) =>
    prisma.item.create({ data: { tenantId: tenant.id, code, name: code, itemType: "RAW_MATERIAL", isLotTracked: lot, uom: "EA" } })
  const lotItem = await mkItem("LOTITEM", true)
  const plain = await mkItem("PLAIN", false)
  const lot = await prisma.lot.create({ data: { tenantId: tenant.id, itemId: lotItem.id, lotNo: rid("LOT") } })
  const mkBal = (itemId: string, warehouseId: string, lotId: string | null, onHand: number, hold = 0) =>
    prisma.inventoryBalance.create({
      data: { tenantId: tenant.id, siteId: site.id, itemId, warehouseId, lotId, qtyOnHand: onHand, qtyAvailable: onHand - hold, qtyHold: hold },
    })
  const total = async (itemId: string) =>
    N((await prisma.inventoryBalance.aggregate({ where: { tenantId: tenant.id, itemId }, _sum: { qtyOnHand: true } }))._sum.qtyOnHand ?? 0)

  const lotA = await mkBal(lotItem.id, whA.id, lot.id, 100)
  const plainA = await mkBal(plain.id, whA.id, null, 50, 10) // 보류 10

  await t("LOT 품목 이동: 출발 -30, 도착 +30, LOT 유지, 총량 동일", async () => {
    const before = await total(lotItem.id)
    const r = await inv.transferInventoryStock({ balanceId: lotA.id, toWarehouseId: whB.id, qty: 30, reason: "테스트", requestId: rid("r") })
    assert.equal(r.success, true, r.error)
    const from = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: lotA.id } })
    const to = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: tenant.id, itemId: lotItem.id, warehouseId: whB.id } })
    assert.equal(N(from.qtyOnHand), 70)
    assert.equal(N(from.qtyAvailable), 70)
    assert.equal(N(to.qtyOnHand), 30)
    assert.equal(N(to.qtyAvailable), 30)
    assert.equal(to.lotId, lot.id)
    assert.equal(await total(lotItem.id), before)
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { tenantId: tenant.id, txNo: r.txNo } })
    assert.equal(tx.txType, "TRANSFER")
    assert.equal(N(tx.qty), 30)
    assert.equal(tx.fromLocationId, whA.id)
    assert.equal(tx.toLocationId, whB.id)
    assert.equal(tx.lotId, lot.id)
    assert.match(tx.txNo, /^TRF-\d{8}-\d{4}$/)
  })

  await t("기존 도착 balance 에 누적", async () => {
    const r = await inv.transferInventoryStock({ balanceId: lotA.id, toWarehouseId: whB.id, qty: 20, reason: "추가", requestId: rid("r") })
    assert.equal(r.success, true, r.error)
    const to = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: tenant.id, itemId: lotItem.id, warehouseId: whB.id } })
    assert.equal(N(to.qtyOnHand), 50)
    assert.equal(await prisma.inventoryBalance.count({ where: { tenantId: tenant.id, itemId: lotItem.id, warehouseId: whB.id } }), 1)
    assert.equal(await total(lotItem.id), 100)
  })

  await t("비LOT 품목: 가용(40) 초과 이동 거절, 보류 보존", async () => {
    const r = await inv.transferInventoryStock({ balanceId: plainA.id, toWarehouseId: whB.id, qty: 41, reason: "초과", requestId: rid("r") })
    assert.equal(r.success, false)
    assert.match(r.error ?? "", /가용재고/)
    const ok = await inv.transferInventoryStock({ balanceId: plainA.id, toWarehouseId: whB.id, qty: 40, reason: "전량 가용", requestId: rid("r") })
    assert.equal(ok.success, true, ok.error)
    const from = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: plainA.id } })
    assert.equal(N(from.qtyOnHand), 10)
    assert.equal(N(from.qtyAvailable), 0)
    assert.equal(N(from.qtyHold), 10)
    const to = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: tenant.id, itemId: plain.id, warehouseId: whB.id } })
    assert.equal(to.lotId, null)
    assert.equal(N(to.qtyOnHand), 40)
    assert.equal(await total(plain.id), 50)
  })

  await t("중복 requestId 재전송은 재처리하지 않음", async () => {
    const requestId = rid("dup")
    const a = await inv.transferInventoryStock({ balanceId: lotA.id, toWarehouseId: whC.id, qty: 5, reason: "dup", requestId })
    const b = await inv.transferInventoryStock({ balanceId: lotA.id, toWarehouseId: whC.id, qty: 5, reason: "dup", requestId })
    assert.equal(a.success && b.success, true)
    assert.equal(b.duplicate, true)
    assert.equal(a.txNo, b.txNo)
    assert.equal(await prisma.inventoryTransaction.count({ where: { tenantId: tenant.id, refType: "STOCK_TRANSFER", refId: requestId } }), 1)
    const c = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: tenant.id, itemId: lotItem.id, warehouseId: whC.id } })
    assert.equal(N(c.qtyOnHand), 5)
  })

  await t("동시 이동 10건(각 다른 requestId): 합계 초과 불가·총량 보존", async () => {
    const src = await mkBal(lotItem.id, whB.id, (await prisma.lot.create({ data: { tenantId: tenant.id, itemId: lotItem.id, lotNo: rid("LOTC") } })).id, 25)
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        inv.transferInventoryStock({ balanceId: src.id, toWarehouseId: whC.id, qty: 10, reason: "동시", requestId: rid("cc") })
      )
    )
    const okCount = results.filter((x) => x.success).length
    assert.equal(okCount, 2, `성공 ${okCount}건 (가용 25 → 10씩 2건만 가능)`)
    const s = await prisma.inventoryBalance.findUniqueOrThrow({ where: { id: src.id } })
    assert.equal(N(s.qtyOnHand), 5)
    const dests = await prisma.inventoryBalance.findMany({ where: { tenantId: tenant.id, itemId: lotItem.id, warehouseId: whC.id, lotId: src.lotId } })
    assert.equal(dests.length, 1)
    assert.equal(N(dests[0].qtyOnHand), 20)
  })

  await t("동시 이동 시 도착 balance(비LOT) 중복 생성 없음", async () => {
    const src = await mkBal((await mkItem("PLAIN2", false)).id, whA.id, null, 100)
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => inv.transferInventoryStock({ balanceId: src.id, toWarehouseId: whC.id, qty: 5, reason: "동시", requestId: rid("pp") }))
    )
    assert.equal(rs.every((x) => x.success), true, JSON.stringify(rs.filter((x) => !x.success)))
    assert.equal(await prisma.inventoryBalance.count({ where: { tenantId: tenant.id, itemId: src.itemId, warehouseId: whC.id } }), 1)
    assert.equal(await total(src.itemId), 100)
  })

  await t("같은 창고 / 수량 0·음수 / 사유 없음 / 타 테넌트 창고 거절", async () => {
    const base = { balanceId: lotA.id, qty: 1, reason: "x", requestId: rid("v") }
    assert.equal((await inv.transferInventoryStock({ ...base, toWarehouseId: whA.id })).success, false)
    assert.equal((await inv.transferInventoryStock({ ...base, toWarehouseId: whB.id, qty: 0, requestId: rid("v") })).success, false)
    assert.equal((await inv.transferInventoryStock({ ...base, toWarehouseId: whB.id, qty: -3, requestId: rid("v") })).success, false)
    assert.equal((await inv.transferInventoryStock({ ...base, toWarehouseId: whB.id, reason: " ", requestId: rid("v") })).success, false)
    assert.equal((await inv.transferInventoryStock({ ...base, toWarehouseId: otherWh.id, requestId: rid("v") })).success, false)
  })

  await t("권한 없음(VIEWER)·타 테넌트 balance 거절", async () => {
    state.role = "VIEWER"
    const denied = await inv.transferInventoryStock({ balanceId: lotA.id, toWarehouseId: whB.id, qty: 1, reason: "x", requestId: rid("v") })
    assert.equal(denied.success, false)
    state.role = "MANAGER"
    state.tenantId = other.id
    const cross = await inv.transferInventoryStock({ balanceId: lotA.id, toWarehouseId: otherWh.id, qty: 1, reason: "x", requestId: rid("v") })
    assert.equal(cross.success, false)
    state.tenantId = tenant.id
  })

  await t("LOT 관리 품목의 LOT 미지정 재고는 이동 불가", async () => {
    const bad = await mkBal((await mkItem("LOTNULL", true)).id, whA.id, null, 10)
    const r = await inv.transferInventoryStock({ balanceId: bad.id, toWarehouseId: whB.id, qty: 1, reason: "x", requestId: rid("v") })
    assert.equal(r.success, false)
  })

  await t("원장 정합: TRANSFER 순증감 0, 전체 재고 = 수불 합계 보존", async () => {
    const txs = await prisma.inventoryTransaction.findMany({ where: { tenantId: tenant.id, txType: "TRANSFER" } })
    assert.ok(txs.length >= 10)
    const logs = await prisma.auditLog.count({ where: { tenantId: tenant.id, menuName: "재고이동" } })
    assert.equal(logs, txs.length)
    const neg = await prisma.inventoryBalance.count({ where: { tenantId: tenant.id, OR: [{ qtyOnHand: { lt: 0 } }, { qtyAvailable: { lt: 0 } }] } })
    assert.equal(neg, 0)
  })

  console.log(`\n${pass} passed${process.exitCode ? ", with failures" : ""}`)
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
