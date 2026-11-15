/**
 * 수주 처리 화면 다중 LOT 분할 출하(실제 DB, 서버 액션): 기존 출하예정 예약을 뺀 추가 출하 가능 수량,
 * 한 출하요청 안의 LOT 행별 수량, LOT 예약 가능 초과 거부, 예약만으로 실재고 차감이 없는지 확인한다.
 * 선행: 01-seed, 03, 04 가 같은 테스트 DB 에서 실행되어 있어야 한다(FG 재고·LOT 가 있어야 함).
 * 실행 조건은 scripts/db-it/lib.ts 의 로컬 테스트 DB 가드와 같다.
 */
import { assertTarget, check, fixtures, info, loginAs, preflight, prisma, summary, TENANT_ID } from "./lib"

const mod = {
  ship: () => require("../../src/lib/actions/shipment.actions") as typeof import("../../src/lib/actions/shipment.actions"),
  so: () => require("../../src/lib/actions/sales-order.actions") as typeof import("../../src/lib/actions/sales-order.actions"),
}
const { calculateShippableQty } = require("../../src/lib/shipment/shipment-plan-quantities") as typeof import("../../src/lib/shipment/shipment-plan-quantities")

async function main() {
  assertTarget()
  await preflight("수주 처리 다중 LOT 출하(19)")
  const fx = await fixtures()
  loginAs(fx.operator)

  const soi = fx.so.items.find((i) => i.itemId === fx.fgA.id)
  if (!soi) throw new Error("ZT5-SO-001 의 FG-A 품목이 없습니다.")

  const plannedInDb = async () => {
    const agg = await prisma.shipmentItem.aggregate({
      where: { salesOrderItemId: soi.id, shipmentOrder: { tenantId: TENANT_ID, status: "PLANNED" } },
      _sum: { qty: true },
    })
    return Number(agg._sum.qty ?? 0)
  }
  const stockLine = async () => {
    const rows = await mod.so().checkInventoryForSalesOrder(fx.so.id, TENANT_ID)
    return rows.find((r) => r.salesOrderItemId === soi.id)!
  }

  // 1. 화면 기준 수량(서버 checkInventoryForSalesOrder) 과 DB 의 PLANNED 합계가 같다
  const before = await stockLine()
  const plannedBefore = await plannedInDb()
  check("L1", before.plannedQty === plannedBefore, `수주 품목 기존 출하예정 수량 = DB PLANNED 합계(${plannedBefore})`, { screen: before.plannedQty, db: plannedBefore })
  const limitBefore = calculateShippableQty(before.orderedQty, before.shippedQty, before.plannedQty)
  check("L2", limitBefore >= 0 && limitBefore === before.orderedQty - before.shippedQty - plannedBefore, `추가 출하 가능 = 수주 − 출하완료 − 기존 출하예정(${limitBefore})`)

  // 2. 같은 창고의 가용 LOT 중 2개를 골라 LOT 행 2개(부분 수량)로 한 출하요청을 만든다
  const lotsByItem = await mod.ship().getAvailableFinishedGoodsLots(TENANT_ID, fx.wFg.id, [fx.fgA.id])
  const lots = (lotsByItem.lotsByItem[fx.fgA.id] ?? []).filter((l) => l.qtyAvailable > 0)
  if (lots.length === 0) {
    info("L3", "가용 LOT 가 없어 분할 출하 시나리오를 건너뜁니다(선행 04 실행 필요)")
    summary("sales-order-lot-split")
    return
  }
  const pick = lots.slice(0, Math.min(2, lots.length))
  const reqQty = pick.map((l) => Math.min(l.qtyAvailable, 1))
  const onHandBefore = await prisma.inventoryBalance.findMany({
    where: { tenantId: TENANT_ID, warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotId: { in: pick.map((l) => l.lotId) } },
    select: { lotId: true, qtyOnHand: true },
  })

  const r1 = await mod.ship().submitShipmentPlan(TENANT_ID, {
    salesOrderId: fx.so.id,
    plannedDate: new Date(),
    warehouseId: fx.wFg.id,
    note: "19 다중 LOT 부분 출하",
    items: pick.map((l, i) => ({ salesOrderItemId: soi.id, itemId: fx.fgA.id, lotId: l.lotId, qty: reqQty[i] })),
  })
  check("L3", r1.ok, `LOT 행 ${pick.length}개(부분 수량 ${reqQty.join(" + ")})로 출하예정 등록 성공`, r1)

  const created = await prisma.shipmentOrder.findFirst({
    where: { tenantId: TENANT_ID, salesOrderId: fx.so.id, status: "PLANNED", note: "19 다중 LOT 부분 출하" },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  })
  check(
    "L4",
    !!created && created.items.length === pick.length && created.items.every((it) => it.lotId) && new Set(created.items.map((it) => it.lotId)).size === pick.length,
    `한 출하요청 안에 LOT 별 품목 행 ${pick.length}개(서로 다른 LOT)`,
    created?.items.map((it) => ({ lot: it.lotId, qty: Number(it.qty) })),
  )

  const after = await stockLine()
  const plannedAfter = await plannedInDb()
  check("L5", plannedAfter === plannedBefore + reqQty.reduce((a, b) => a + b, 0), `예약 수량 증가 = 요청 합계(${plannedBefore} → ${plannedAfter})`)
  check("L6", after.plannedQty === plannedAfter && after.shippedQty === before.shippedQty, "화면 기준 예약 수량 갱신 · 출하완료 수량 변화 없음(부분 출하는 확정 전)")

  const onHandAfter = await prisma.inventoryBalance.findMany({
    where: { tenantId: TENANT_ID, warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotId: { in: pick.map((l) => l.lotId) } },
    select: { lotId: true, qtyOnHand: true },
  })
  const sumOnHand = (rows: typeof onHandBefore) => rows.reduce((s, r) => s + Number(r.qtyOnHand), 0)
  check("L7", sumOnHand(onHandAfter) === sumOnHand(onHandBefore), "출하예정 등록만으로 LOT 실재고 차감 없음", { before: sumOnHand(onHandBefore), after: sumOnHand(onHandAfter) })

  // 3. LOT 예약 가능 수량을 넘는 행은 거부된다(화면 검증과 서버 검증이 같은 기준)
  const lotNow = (await mod.ship().getAvailableFinishedGoodsLots(TENANT_ID, fx.wFg.id, [fx.fgA.id])).lotsByItem[fx.fgA.id] ?? []
  const target = lotNow.find((l) => l.lotId === pick[0].lotId)
  const over = await mod.ship().submitShipmentPlan(TENANT_ID, {
    salesOrderId: fx.so.id,
    plannedDate: new Date(),
    warehouseId: fx.wFg.id,
    items: [{ salesOrderItemId: soi.id, itemId: fx.fgA.id, lotId: pick[0].lotId, qty: (target?.qtyAvailable ?? 0) + 1 }],
  })
  check("L8", !over.ok && over.message.includes("예약 가능 수량"), "LOT 예약 가능 수량 초과 등록 거부(서버)", over)

  // 4. 수주 추가 출하 가능 수량을 넘는 합계는 거부된다
  const limitNow = calculateShippableQty(after.orderedQty, after.shippedQty, after.plannedQty)
  // LOT 재고가 한도보다 많을 때만 의미가 있다(한도 + 1 을 한 LOT 에 요청하면 수주 한도 초과로 거부되어야 한다)
  const bigLot = lotNow.find((l) => l.qtyAvailable > limitNow)
  if (bigLot) {
    const overLine = await mod.ship().submitShipmentPlan(TENANT_ID, {
      salesOrderId: fx.so.id,
      plannedDate: new Date(),
      warehouseId: fx.wFg.id,
      items: [{ salesOrderItemId: soi.id, itemId: fx.fgA.id, lotId: bigLot.lotId, qty: limitNow + 1 }],
    })
    check("L9", !overLine.ok && overLine.message.includes("추가 출하 가능"), `수주 추가 출하 가능(${limitNow}) 초과 요청 거부`, overLine)
  } else {
    info("L9", `LOT 재고가 추가 출하 가능(${limitNow}) 이하뿐이라 수주 한도 초과 검증은 건너뜀`)
  }

  summary("sales-order-lot-split")
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      summary("sales-order-lot-split (중단 — 여기까지의 결과)")
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
