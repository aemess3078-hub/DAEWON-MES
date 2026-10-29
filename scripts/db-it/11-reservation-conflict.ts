/**
 * 예약된 LOT 번호와 수동 LOT 등록 충돌 실제 DB 테스트 (대원정밀 테스트 환경, ZT6 접두 발주/ZT5 품목).
 *  1) 입고 화면에서 자동채번 예약  2) 다른 사용자가 LOT 관리에서 같은 번호를 수동 등록  3) 원래 사용자가 예약 번호로 입고 확정
 * 실행: DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=<로컬 *_test DB 주소> DEFAULT_TENANT_ID=<테넌트> npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/11-reservation-conflict.ts
 */
import { assertTarget, check, fixtures, loginAs, prisma, summary, TENANT_ID, uniq } from "./lib"

const act = {
  receiving: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  reservation: () => require("../../src/lib/actions/lot-reservation.actions") as typeof import("../../src/lib/actions/lot-reservation.actions"),
  lot: () => require("../../src/lib/actions/lot.actions") as typeof import("../../src/lib/actions/lot.actions"),
}
const rej = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

async function main() {
  assertTarget()
  const fx = await fixtures()
  loginAs(fx.admin)
  const supplier = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-SUP" } })
  const po = await prisma.purchaseOrder.create({
    data: { tenantId: TENANT_ID, siteId: fx.site.id, supplierId: supplier.id, orderNo: `ZT6-PO-${uniq()}`, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED", items: { create: [{ itemId: fx.rmA.id, qty: 10000, unitPrice: 10 }] } },
    include: { items: true },
  })
  const poItem = po.items[0]
  const reserve = async () => {
    const r = await act.reservation().reserveReceivingLotNumber({ purchaseOrderId: po.id, purchaseOrderItemId: poItem.id })
    if (!r.success) throw new Error(`예약 실패: ${r.message}`)
    return r
  }
  const confirm = (r: { reservationId: string; lotNo: string }, qty = 10) =>
    act.receiving().createReceivingInspection({
      purchaseOrderItemId: poItem.id, purchaseOrderId: po.id, warehouseId: fx.wRm.id, siteId: fx.site.id,
      receivedQty: qty, acceptedQty: qty, rejectedQty: 0, result: "PASS", requestId: `zt6-${uniq()}-${uniq()}`, lotNo: r.lotNo, lotReservationId: r.reservationId,
    })
  const lotRows = (lotNo: string) => prisma.lot.findMany({ where: { tenantId: TENANT_ID, lotNo } })
  const qtyOf = async (lotId: string) => Number((await prisma.inventoryBalance.aggregate({ where: { tenantId: TENANT_ID, lotId }, _sum: { qtyOnHand: true } }))._sum.qtyOnHand ?? 0)

  // ── C1~C4: 같은 품목/다른 품목으로 예약 번호를 수동 등록 → 거부되어야 하고, 원래 입고는 예약 번호로 정상 확정 ───────────
  const r1 = await reserve()
  const sameItem = await rej(() => act.lot().createLot({ itemId: fx.rmA.id, lotNo: r1.lotNo, qty: 0 }, TENANT_ID))
  check("C1", sameItem !== null && sameItem.includes("예약"), "예약 중인 번호를 같은 품목으로 수동 LOT 등록 → 예약 안내와 함께 거부", sameItem)
  const otherItem = await rej(() => act.lot().createLot({ itemId: fx.rmB.id, lotNo: r1.lotNo, qty: 0 }, TENANT_ID))
  check("C2", otherItem !== null && otherItem.includes("예약"), "예약 중인 번호를 다른 품목으로 수동 LOT 등록 → 거부", otherItem)
  check("C3", (await lotRows(r1.lotNo)).length === 0, "거부된 수동 등록은 Lot 를 만들지 않음")
  const c1 = await confirm(r1)
  const l1 = await lotRows(r1.lotNo)
  const res1 = await prisma.lotNumberReservation.findUnique({ where: { id: r1.reservationId } })
  check("C4", c1.success && l1.length === 1 && l1[0].itemId === fx.rmA.id && res1?.status === "CONSUMED" && (await qtyOf(l1[0].id)) === 10, "원래 입고는 예약 번호로 정상 확정(Lot 1개·원래 품목·재고 10·예약 CONSUMED)", { c1, n: l1.length, st: res1?.status })

  // ── C5: 만료된 예약은 수동 등록을 막지 않는다 ───────────────────────────────────────────────────────────────────
  const r2 = await reserve()
  await prisma.lotNumberReservation.update({ where: { id: r2.reservationId }, data: { expiresAt: new Date(Date.now() - 60_000) } })
  const expiredOk = await rej(() => act.lot().createLot({ itemId: fx.rmA.id, lotNo: r2.lotNo, qty: 0 }, TENANT_ID))
  check("C5", expiredOk === null && (await lotRows(r2.lotNo)).length === 1, "만료된 예약 번호는 수동 등록 가능(기존 입고 수동 경로와 같은 정책)", expiredOk)

  // ── C6: 경쟁 상태(예약 이후 Lot 가 우회 생성됨) → 예약 확정이 기존 Lot 에 합쳐지면 안 된다 ──────────────────
  const r3 = await reserve()
  const raced = await prisma.lot.create({ data: { tenantId: TENANT_ID, itemId: fx.rmA.id, lotNo: r3.lotNo, status: "ACTIVE", manufactureDate: new Date() } })
  const c3 = await confirm(r3)
  const res3 = await prisma.lotNumberReservation.findUnique({ where: { id: r3.reservationId } })
  check("C6", !c3.success && (c3.message ?? "").length > 0 && (await qtyOf(raced.id)) === 0 && res3?.status === "RESERVED", "예약 번호의 Lot 가 이미 존재하면 입고 확정은 기존 LOT 에 합치지 않고 실패(재고 0·예약 유지)", c3)

  // ── C7: 기존 중복 검증 유지 ─────────────────────────────────────────────────────────────────────────────────
  const dup = await rej(() => act.lot().createLot({ itemId: fx.rmA.id, lotNo: r1.lotNo, qty: 0 }, TENANT_ID))
  check("C7", dup !== null && dup.includes("이미 존재"), "이미 존재하는 LOT 번호 수동 등록은 기존처럼 거부", dup)

  summary("11 예약-수동등록 충돌")
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", e instanceof Error ? e.stack?.split("\n").slice(0, 6).join("\n") : e)
  process.exitCode = 1
  await prisma.$disconnect()
})
