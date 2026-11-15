/**
 * 수주 처리 화면 브라우저 검증용 테스트 데이터(격리 테스트 DB 전용, 실행할 때마다 새 번호를 만든다).
 *  - 신규 LOT 관리 완제품 "ZT5 PROTECTIVE CAP" 과 LOT 재고:
 *      본창고(ZT5-WH-FG): LOT-01 181 · LOT-02 200 · LOT-03 150 · LOT-04 100
 *      보조창고(ZT5-WH-FG2): LOT-05 40        (창고 변경 검증용)
 *      원자재창고(ZT5-WH-RM): 완제품 LOT 없음   (출하 가능 LOT 없음 검증용)
 *  - 수주 ZT5-UI-SO-<번호>:
 *      수주 A: 수주 500 · 출하완료 100 · 기존 출하예정 200(LOT-02 200 을 실제 서버 액션으로 예약) → 추가 출하 가능 200
 *      같은 품목의 두 번째 수주 60 · 기존 출하예정 없음 → 추가 출하 가능 60
 * 재고 설정(입고 이력 없이 잔액만 만든다)과 출하예정 등록/출하완료 값은 테스트 조건을 맞추기 위한 것이다.
 * 실행 결과(수주 번호·ID)를 IDS 줄로 출력한다. 운영 DB 에서는 실행할 수 없다(lib.ts 가드).
 */
import { assertTarget, check, fixtures, info, loginAs, preflight, prisma, summary, TENANT_ID } from "./lib"

const mod = {
  ship: () => require("../../src/lib/actions/shipment.actions") as typeof import("../../src/lib/actions/shipment.actions"),
}

async function main() {
  assertTarget()
  await preflight("수주 처리 UI 테스트 데이터(20)")
  const fx = await fixtures()
  const stamp = Date.now().toString(36).toUpperCase()
  const customer = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-CUS" } })

  const cap = await prisma.item.create({
    data: {
      tenantId: TENANT_ID,
      code: `ZT5-CAP-${stamp}`,
      name: "ZT5 PROTECTIVE CAP",
      itemType: "FINISHED",
      uom: "EA",
      isLotTracked: true,
      defaultWarehouseId: fx.wFg.id,
      status: "ACTIVE",
    },
  })

  const makeLot = async (suffix: string, qty: number, warehouseId: string) => {
    const lot = await prisma.lot.create({
      data: { tenantId: TENANT_ID, itemId: cap.id, lotNo: `ZT5-UI-${stamp}-${suffix}`, status: "ACTIVE" },
    })
    await prisma.inventoryBalance.create({
      data: { tenantId: TENANT_ID, siteId: fx.site.id, itemId: cap.id, lotId: lot.id, warehouseId, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 },
    })
    return lot
  }
  const lot01 = await makeLot("L01", 181, fx.wFg.id)
  const lot02 = await makeLot("L02", 200, fx.wFg.id)
  const lot03 = await makeLot("L03", 150, fx.wFg.id)
  const lot04 = await makeLot("L04", 100, fx.wFg.id)
  const lot05 = await makeLot("L05", 40, fx.wFg2.id)

  // 스키마상 한 수주에 같은 품목은 한 행만 가능(SalesOrderItem @@unique(salesOrderId, itemId)).
  // 같은 품목 다른 행 검증은 같은 품목을 가진 두 번째 수주로 한다.
  const mkSo = (no: string, qty: number, shipped: number) =>
    prisma.salesOrder.create({
      data: {
        tenantId: TENANT_ID,
        siteId: fx.site.id,
        customerId: customer.id,
        orderNo: no,
        orderDate: new Date(),
        deliveryDate: new Date(Date.now() + 14 * 86400000),
        status: "CONFIRMED",
        items: { create: [{ itemId: cap.id, qty, shippedQty: shipped }] },
      },
      include: { items: true },
    })
  const soA = await mkSo(`ZT5-UI-SO-${stamp}`, 500, 100)
  const soB = await mkSo(`ZT5-UI-SO-B-${stamp}`, 60, 0)
  const so = soA
  const lineA = soA.items[0]
  const lineB = soB.items[0]

  // 기존 출하예정 200: 실제 서버 액션(등록)으로 만든다. LOT-02 200 을 모두 예약하므로 화면에서 LOT-02 는 빠진다.
  loginAs(fx.operator)
  const planned = await mod.ship().submitShipmentPlan(TENANT_ID, {
    salesOrderId: so.id,
    plannedDate: new Date(),
    warehouseId: fx.wFg.id,
    note: `UI-PLAN-200-${stamp}`,
    items: [{ salesOrderItemId: lineA.id, itemId: cap.id, lotId: lot02.id, qty: 200 }],
  })
  check("U1", planned.ok, "기존 출하예정 200(LOT-02) 실제 등록 성공", planned)

  info("IDS", JSON.stringify({
    stamp,
    itemId: cap.id,
    itemCode: cap.code,
    orderNo: so.orderNo,
    soId: so.id,
    soBNo: soB.orderNo,
    soBId: soB.id,
    lines: { A: lineA.id, B: lineB.id },
    warehouses: { fg: fx.wFg.id, fg2: fx.wFg2.id, rm: fx.wRm.id },
    lots: { L01: lot01.lotNo, L02: lot02.lotNo, L03: lot03.lotNo, L04: lot04.lotNo, L05: lot05.lotNo },
  }))
  summary("sales-order-ui-seed")
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      summary("sales-order-ui-seed (중단)")
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
