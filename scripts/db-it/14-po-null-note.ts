/**
 * 발주서 note=NULL 조회 누락 수정 검증 (실제 Supabase 대원정밀 테스트 환경).
 *  - 기존 발주서는 읽기만 한다(변경 없음).
 *  - 경계 사례(NULL / "" / 일반 / OS- / [OUTSOURCING])는 롤백되는 트랜잭션 안에서 만들었다가 폐기한다 — DB 에 남지 않는다.
 * 실행: DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=<로컬 *_test DB 주소> DEFAULT_TENANT_ID=<테넌트> npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/14-po-null-note.ts
 */
import { generalPurchaseOrderWhere, isGeneralPurchaseOrder } from "../../src/lib/purchase-order-scope"
import { assertTarget, check, fixtures, prisma, summary, TENANT_ID, uniq } from "./lib"

const ROLLBACK = "__ROLLBACK__"

async function main() {
  assertTarget()
  const fx = await fixtures()
  const act = require("../../src/lib/actions/purchase-order.actions") as typeof import("../../src/lib/actions/purchase-order.actions")

  // ── 1. 실제 데이터 읽기 전용 점검 ───────────────────────────────────────────
  const all = await prisma.purchaseOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true, orderNo: true, note: true, status: true, siteId: true } })
  const expectedAll = all.filter(isGeneralPurchaseOrder).map((p) => p.id).sort()
  const listed = (await act.getPurchaseOrders(TENANT_ID)).map((p) => p.id).sort()
  const nullNoteGeneral = all.filter((p) => p.note === null && isGeneralPurchaseOrder(p))
  check("P1", JSON.stringify(listed) === JSON.stringify(expectedAll), `getPurchaseOrders: 실제 발주 ${all.length}건 중 일반 발주 ${expectedAll.length}건 모두 조회 (조회 ${listed.length}건)`)
  check("P2", nullNoteGeneral.length === 0 || nullNoteGeneral.every((p) => listed.includes(p.id)), `note=NULL 일반 발주 ${nullNoteGeneral.length}건 전부 목록에 포함`)
  check("P3", all.filter((p) => !isGeneralPurchaseOrder(p)).every((p) => !listed.includes(p.id)), "외주발주(OS- / [OUTSOURCING])는 목록에서 제외")

  const pendingStatuses = ["ORDERED", "PARTIAL_RECEIVED"]
  const expectedPending = all.filter((p) => p.siteId === fx.site.id && pendingStatuses.includes(p.status) && isGeneralPurchaseOrder(p)).map((p) => p.id).sort()
  const pending = (await act.getPendingPurchaseOrdersForReceipt(TENANT_ID, fx.site.id)).map((p) => p.id).sort()
  check("P4", JSON.stringify(pending) === JSON.stringify(expectedPending), `getPendingPurchaseOrdersForReceipt: 입고 대기 일반 발주 ${expectedPending.length}건 모두 조회 (조회 ${pending.length}건)`)
  check("P5", (await act.getPendingPurchaseOrdersForReceipt("tenant-that-does-not-exist", fx.site.id)).length === 0, "다른 tenant 로는 한 건도 조회되지 않음")

  // ── 2. 경계 사례: 롤백 트랜잭션 ─────────────────────────────────────────────
  const run = uniq()
  const base = { tenantId: TENANT_ID, siteId: fx.site.id, supplierId: fx.po.supplierId, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED" as const }
  const cases = [
    { key: "null", orderNo: `ZT7-${run}-NULL`, note: null, expect: true },
    { key: "empty", orderNo: `ZT7-${run}-EMPTY`, note: "", expect: true },
    { key: "text", orderNo: `ZT7-${run}-TEXT`, note: "긴급 납품 요청", expect: true },
    { key: "os", orderNo: `OS-ZT7-${run}`, note: null, expect: false },
    { key: "tag", orderNo: `ZT7-${run}-TAG`, note: "[OUTSOURCING] 도금\n비고", expect: false },
  ]
  let inTx: Record<string, { list: boolean; pending: boolean }> = {}
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const c of cases) await tx.purchaseOrder.create({ data: { ...base, orderNo: c.orderNo, note: c.note } })
        const where = { tenantId: TENANT_ID, orderNo: { contains: run } }
        const rowsList = await tx.purchaseOrder.findMany({ where: { ...where, ...generalPurchaseOrderWhere }, select: { orderNo: true } })
        const rowsPending = await tx.purchaseOrder.findMany({
          where: { ...where, siteId: fx.site.id, status: { in: ["ORDERED", "PARTIAL_RECEIVED"] }, ...generalPurchaseOrderWhere },
          select: { orderNo: true },
        })
        for (const c of cases) inTx[c.key] = { list: rowsList.some((r) => r.orderNo === c.orderNo), pending: rowsPending.some((r) => r.orderNo === c.orderNo) }
        throw new Error(ROLLBACK)
      },
      { timeout: 30000, maxWait: 15000 },
    )
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) throw e
  }
  for (const c of cases) {
    const r = inTx[c.key]
    check(`B-${c.key}`, r && r.list === c.expect && r.pending === c.expect, `note=${c.key === "null" ? "NULL" : c.key === "empty" ? '""' : c.key === "text" ? "일반 문자열" : c.key === "os" ? "OS- 접두어" : "[OUTSOURCING] 포함"} → 목록·입고대기 ${c.expect ? "포함" : "제외"}`)
  }
  const leftover = await prisma.purchaseOrder.count({ where: { tenantId: TENANT_ID, orderNo: { contains: run } } })
  check("B-rollback", leftover === 0, "경계 사례 발주는 롤백되어 DB 에 남지 않음")

  const after = await prisma.purchaseOrder.count({ where: { tenantId: TENANT_ID } })
  check("B-unchanged", after === all.length, `기존 발주서 건수 불변 (${all.length} → ${after})`)
  summary("po-null-note")
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", (e as Error).message.split("\n").slice(-2).join(" | "))
  process.exitCode = 1
  await prisma.$disconnect()
})
