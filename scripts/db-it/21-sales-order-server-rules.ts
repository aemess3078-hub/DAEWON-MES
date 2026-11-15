/**
 * 수주 처리 다중 LOT 출하 — 미실행이던 서버 규칙 검증(실제 DB, 실제 서버 액션).
 *  S1 서로 다른 LOT 2개를 한 출하요청에 등록(한 출하 안에 LOT 별 행)
 *  S2 기존 출하예정 예약이 있는 상태에서 추가 등록(수주 500 − 출하 100 − 예약 200 = 추가 200)
 *  S3 수주 한도 초과(L9): 추가 출하 가능을 넘는 요청은 LOT 재고가 충분해도 거부
 *  S4 선택한 창고에 출하 가능 LOT 가 없는 경우: 목록 비움 + 등록 거부
 *  S5 같은 품목의 다른 수주(= 같은 품목 다른 행): 예약·한도가 수주 품목별로 분리된다
 * 모든 수주·LOT 는 실행마다 새 번호로 만든다(격리 테스트 DB 전용, lib.ts 가드 적용).
 */
import { assertTarget, check, fixtures, info, loginAs, preflight, prisma, summary, TENANT_ID } from "./lib"

const mod = {
  ship: () => require("../../src/lib/actions/shipment.actions") as typeof import("../../src/lib/actions/shipment.actions"),
  so: () => require("../../src/lib/actions/sales-order.actions") as typeof import("../../src/lib/actions/sales-order.actions"),
}
const { calculateShippableQty } = require("../../src/lib/shipment/shipment-plan-quantities") as typeof import("../../src/lib/shipment/shipment-plan-quantities")

async function main() {
  assertTarget()
  await preflight("수주 처리 서버 규칙(21)")
  const fx = await fixtures()
  loginAs(fx.operator)
  const stamp = Date.now().toString(36).toUpperCase()

  const item = await prisma.item.create({
    data: { tenantId: TENANT_ID, code: `ZT5-SRV-${stamp}`, name: "ZT5 SERVER RULE ITEM", itemType: "FINISHED", uom: "EA", isLotTracked: true, defaultWarehouseId: fx.wFg.id, status: "ACTIVE" },
  })
  const mkLot = async (suffix: string, qty: number, warehouseId: string, itemId = item.id) => {
    const lot = await prisma.lot.create({ data: { tenantId: TENANT_ID, itemId, lotNo: `ZT5-SRV-${stamp}-${suffix}`, status: "ACTIVE" } })
    await prisma.inventoryBalance.create({ data: { tenantId: TENANT_ID, siteId: fx.site.id, itemId, lotId: lot.id, warehouseId, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
    return lot
  }
  const lotA = await mkLot("A", 60, fx.wFg.id)
  const lotB = await mkLot("B", 50, fx.wFg.id)
  const lotC = await mkLot("C", 40, fx.wFg.id)
  const lotD = await mkLot("D", 300, fx.wFg.id)

  const mkSo = async (no: string, qty: number, shipped: number) => {
    const customer = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-CUS" } })
    const so = await prisma.salesOrder.create({
      data: {
        tenantId: TENANT_ID, siteId: fx.site.id, customerId: customer.id, orderNo: no, orderDate: new Date(),
        deliveryDate: new Date(Date.now() + 14 * 86400000), status: "CONFIRMED",
        items: { create: [{ itemId: item.id, qty, shippedQty: shipped }] },
      },
      include: { items: true },
    })
    return { so, line: so.items[0] }
  }
  const plannedOf = async (soId: string) => {
    const rows = await mod.so().checkInventoryForSalesOrder(soId, TENANT_ID)
    return rows[0]
  }
  const req = (soId: string, lines: Array<{ salesOrderItemId: string; lotId: string; qty: number }>, warehouseId = fx.wFg.id) =>
    mod.ship().submitShipmentPlan(TENANT_ID, {
      salesOrderId: soId,
      plannedDate: new Date(),
      warehouseId,
      note: `21-${stamp}`,
      items: lines.map((l) => ({ salesOrderItemId: l.salesOrderItemId, itemId: item.id, lotId: l.lotId, qty: l.qty })),
    })

  // S1: 서로 다른 LOT 2개를 한 출하요청으로
  const A = await mkSo(`ZT5-SRV-S-${stamp}`, 100, 0)
  const s1 = await req(A.so.id, [
    { salesOrderItemId: A.line.id, lotId: lotA.id, qty: 30 },
    { salesOrderItemId: A.line.id, lotId: lotB.id, qty: 20 },
  ])
  check("S1a", s1.ok, "서로 다른 LOT 2개(30 + 20)를 한 출하요청으로 등록", s1)
  const s1Ship = await prisma.shipmentOrder.findFirst({ where: { tenantId: TENANT_ID, salesOrderId: A.so.id }, include: { items: true } })
  check("S1b", !!s1Ship && s1Ship.items.length === 2 && new Set(s1Ship.items.map((i) => i.lotId)).size === 2 && s1Ship.items.reduce((s, i) => s + Number(i.qty), 0) === 50, "출하요청 1건 안에 LOT 행 2개 · 합계 50", s1Ship?.items.map((i) => ({ lot: i.lotId, qty: Number(i.qty) })))

  // S2: 기존 예약(50)이 있는 상태에서 추가 등록 — 추가 출하 가능 = 100 − 0 − 50 = 50 → 40 은 허용
  const before2 = await plannedOf(A.so.id)
  check("S2a", before2.plannedQty === 50 && calculateShippableQty(before2.orderedQty, before2.shippedQty, before2.plannedQty) === 50, "기존 출하예정 50 반영 → 추가 출하 가능 50", before2)
  const s2 = await req(A.so.id, [{ salesOrderItemId: A.line.id, lotId: lotC.id, qty: 40 }])
  check("S2b", s2.ok, "기존 예약 50 이 있어도 추가 40 등록 성공(합계 90 ≤ 100)", s2)

  // S3 (L9): 추가 출하 가능 10 남음. LOT A 는 30 가능하므로 LOT 재고는 충분 → 수주 한도로만 거부되어야 한다
  const s3 = await req(A.so.id, [{ salesOrderItemId: A.line.id, lotId: lotA.id, qty: 11 }])
  check("L9", !s3.ok && s3.message.includes("추가 출하 가능 수량은 10개"), "수주 한도 초과(추가 출하 가능 10 < 요청 11) 서버 거부 — LOT 재고는 충분", s3)
  const s3ok = await req(A.so.id, [{ salesOrderItemId: A.line.id, lotId: lotA.id, qty: 10 }])
  check("L9b", s3ok.ok, "한도 안(10)은 등록 성공 → 수주 한도가 정확히 경계에서 맞는다", s3ok)
  const after3 = await plannedOf(A.so.id)
  check("L9c", after3.plannedQty === 100 && calculateShippableQty(after3.orderedQty, after3.shippedQty, after3.plannedQty) === 0, "예약 100 · 추가 출하 가능 0 · 실재고는 변화 없음(다음 단계에서 확인)")

  // S4: 출하 가능 LOT 가 없는 창고(원자재창고)
  const emptyWh = await mod.ship().getAvailableFinishedGoodsLots(TENANT_ID, fx.wRm.id, [item.id])
  check("S4a", (emptyWh.lotsByItem[item.id] ?? []).length === 0 && !!emptyWh.emptyReasonByItem[item.id], "원자재창고: 출하 가능 LOT 목록 비어 있음 · 사유 코드 제공", emptyWh.emptyReasonByItem)
  const B = await mkSo(`ZT5-SRV-S2-${stamp}`, 50, 0)
  const s4 = await req(B.so.id, [{ salesOrderItemId: B.line.id, lotId: lotD.id, qty: 5 }], fx.wRm.id)
  check("S4b", !s4.ok, "LOT 가 없는 창고로 등록 시도 → 서버 거부", s4)

  // S5: 같은 품목의 다른 수주 행 — 예약·한도는 수주 품목별로 분리
  const C = await mkSo(`ZT5-SRV-S3-${stamp}`, 100, 0)
  const s5 = await req(C.so.id, [{ salesOrderItemId: C.line.id, lotId: lotD.id, qty: 25 }])
  check("S5a", s5.ok, "같은 품목의 다른 수주(수주 100)는 수주 A 의 예약(100)과 무관하게 25 등록 성공", s5)
  const aNow = await plannedOf(A.so.id)
  const cNow = await plannedOf(C.so.id)
  check("S5b", aNow.plannedQty === 100 && cNow.plannedQty === 25, `수주별 예약 분리: A=${aNow.plannedQty}, C=${cNow.plannedQty}`)

  // S6: 기존 출하예정 200 과 출하 100 이 있는 수주(사용자 예시)의 추가 출하 가능 = 200
  const U = await mkSo(`ZT5-SRV-U-${stamp}`, 500, 100)
  const u1 = await req(U.so.id, [{ salesOrderItemId: U.line.id, lotId: lotD.id, qty: 200 }])
  check("S6a", u1.ok, "수주 500 · 출하 100 · 기존 예약 0 에서 200 등록 성공", u1)
  const uNow = await plannedOf(U.so.id)
  const uLimit = calculateShippableQty(uNow.orderedQty, uNow.shippedQty, uNow.plannedQty)
  check("S6b", uNow.plannedQty === 200 && uLimit === 200, `예시 조건(500/100/예약200): 추가 출하 가능 = ${uLimit} (기대 200)`, uNow)
  const u2 = await req(U.so.id, [{ salesOrderItemId: U.line.id, lotId: lotD.id, qty: 201 }])
  check("S6c", !u2.ok, "추가 201 은 서버에서 거부(한도 200 + 1)", u2)

  info("DONE", `테스트 품목 ${item.code} · 수주 ${A.so.orderNo}/${B.so.orderNo}/${C.so.orderNo}/${U.so.orderNo}`)
  summary("sales-order-server-rules")
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      summary("sales-order-server-rules (중단)")
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
