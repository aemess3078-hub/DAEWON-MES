/**
 * 수주 엑셀 업로드로 만든 수주가 기존 생산의뢰·상태 변경·출하예정(다중 LOT) 흐름에서 정상 처리되는지 검증
 * (격리 테스트 DB 전용, lib.ts 가드). 선행: 01-seed.ts (ZT5 고객·완제품·BOM·라우팅).
 *  I1 엑셀 등록: 같은 수주에 완제품 2개(BOM 있는 A, 출하용 B) + 발주번호
 *  I2 수주 충족 현황(checkInventoryForSalesOrder)에 품목·수량이 정상 반영
 *  I3 생산의뢰: 엑셀 수주 → 생산계획 생성, 수주 품목에 연결
 *  I4 상태 변경 가드: 활성 생산계획이 있으면 취소 거부(엑셀 수주도 같은 규칙)
 *  I5 다중 LOT 출하예정: 서로 다른 LOT 2개 한 번에 등록, 예정 수량·추가 출하 가능 수량 정합
 *  I6 한도 초과 출하 요청 거부, 엑셀 발주번호는 그대로 유지
 */
import { randomUUID } from "node:crypto"
import { assertTarget, check, fixtures, loginAs, preflight, prisma, summary, TENANT_ID } from "./lib"

const mod = {
  so: () => require("../../src/lib/actions/sales-order.actions") as typeof import("../../src/lib/actions/sales-order.actions"),
  ex: () => require("../../src/lib/actions/sales-order-excel.actions") as typeof import("../../src/lib/actions/sales-order-excel.actions"),
  ship: () => require("../../src/lib/actions/shipment.actions") as typeof import("../../src/lib/actions/shipment.actions"),
  lib: () => require("../../src/lib/sales-order-excel") as typeof import("../../src/lib/sales-order-excel"),
}

async function main() {
  assertTarget()
  await preflight("수주 엑셀 통합 연계(23)")
  const fx = await fixtures()
  loginAs(fx.operator)
  const stamp = Date.now().toString(36).toUpperCase()
  const { SALES_ORDER_EXCEL_COLUMNS: COL } = mod.lib()
  const headers = Object.values(COL) as string[]
  const customer = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-CUS" } })
  const po = `ZT8-${stamp}`

  // I1 엑셀 등록
  let rn = 3
  const row = (item: string, qty: number, extra: Record<string, unknown> = {}) => ({
    rowNum: rn++,
    cells: { [COL.groupId]: `X-${stamp}`, [COL.customerCode]: customer.code, [COL.orderDate]: "2026-11-13", [COL.deliveryDate]: "2026-12-20", [COL.itemCode]: item, [COL.qty]: qty, [COL.customerPoNo]: po, ...extra },
  })
  const file = { headers, rows: [row(fx.fgA.code, 100, { [COL.unitPrice]: 1200 }), row(fx.fgB.code, 50, { [COL.unitPrice]: 800 })] }
  const imp = await mod.ex().importSalesOrderExcelRows(file, fx.site.id)
  check("I1a", imp.success && imp.created.length === 1, "엑셀로 수주 1건(완제품 2개) 등록", imp)
  const order = await prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, customerPoNo: po }, include: { items: true } })
  const lineA = order.items.find((i) => i.itemId === fx.fgA.id)!
  const lineB = order.items.find((i) => i.itemId === fx.fgB.id)!
  check("I1b", order.status === "CONFIRMED" && order.items.length === 2 && Number(lineA.qty) === 100 && Number(lineB.qty) === 50, "확정 상태·품목 2개·수량 저장", order.status)

  // I2 수주 충족 현황
  const rows = await mod.so().checkInventoryForSalesOrder(order.id, TENANT_ID)
  const rowA = rows.find((r) => r.itemCode === fx.fgA.code)
  const rowB = rows.find((r) => r.itemCode === fx.fgB.code)
  check("I2", rows.length === 2 && rowA?.orderedQty === 100 && rowB?.orderedQty === 50 && rowB?.shippedQty === 0, "수주 충족 현황 조회에 품목·수량 정상 반영", rows.map((r) => ({ c: r.itemCode, o: r.orderedQty, s: r.shippedQty })))

  // I3 생산의뢰 (생산계획 등록 권한이 있는 관리자 계정)
  loginAs(fx.admin)
  const req = await mod.so().requestProductionFromSalesOrder(order.id, [{ salesOrderItemId: lineA.id, itemId: fx.fgA.id, qty: 100 }], TENANT_ID, fx.site.id, randomUUID())
  check("I3a", req.ok && !!req.planNo, "엑셀 수주에서 생산의뢰 성공(생산계획 생성)", req)
  const planItem = await prisma.productionPlanItem.findFirst({ where: { salesOrderItemId: lineA.id }, include: { plan: true } })
  check("I3b", !!planItem && planItem.plan.status !== "CANCELLED" && Number(planItem.plannedQty ?? 0) === 100, "생산계획 품목이 수주 품목에 연결되고 수량 100", planItem && { plan: planItem.plan.planNo, qty: Number(planItem.plannedQty ?? 0) })

  // I4 상태 변경 가드
  const cancel = await mod.so().updateSalesOrder(order.id, { status: "CANCELLED" })
  check("I4a", !cancel.ok && !!cancel.error, "활성 생산계획이 있는 엑셀 수주는 취소 거부(기존 규칙 동일 적용)", cancel)
  const edit = await mod.so().updateSalesOrder(order.id, { note: "엑셀 수주 비고 수정" })
  check("I4b", edit.ok, "비고 등 일반 수정은 허용", edit)

  // I5 다중 LOT 출하예정 (완제품 B)
  const mkLot = async (suffix: string, qty: number) => {
    const lot = await prisma.lot.create({ data: { tenantId: TENANT_ID, itemId: fx.fgB.id, lotNo: `ZT8-${stamp}-${suffix}`, status: "ACTIVE" } })
    await prisma.inventoryBalance.create({ data: { tenantId: TENANT_ID, siteId: fx.site.id, itemId: fx.fgB.id, lotId: lot.id, warehouseId: fx.wFg.id, qtyOnHand: qty, qtyAvailable: qty, qtyHold: 0 } })
    return lot
  }
  const lotA = await mkLot("A", 30)
  const lotB = await mkLot("B", 40)
  const submit = (lines: { lotId: string; qty: number }[]) =>
    mod.ship().submitShipmentPlan(TENANT_ID, {
      salesOrderId: order.id, plannedDate: new Date(), warehouseId: fx.wFg.id, note: `23-${stamp}`,
      items: lines.map((l) => ({ salesOrderItemId: lineB.id, itemId: fx.fgB.id, lotId: l.lotId, qty: l.qty })),
    })
  const s1 = await submit([{ lotId: lotA.id, qty: 30 }, { lotId: lotB.id, qty: 15 }])
  check("I5a", s1.ok, "서로 다른 LOT 2개(30 + 15)를 한 출하요청으로 등록", s1)
  const shipRow = await prisma.shipmentOrder.findFirst({ where: { tenantId: TENANT_ID, salesOrderId: order.id }, include: { items: true } })
  check("I5b", !!shipRow && shipRow.items.length === 2 && shipRow.items.reduce((s, i) => s + Number(i.qty), 0) === 45, "출하요청 1건 · LOT 행 2개 · 합계 45", shipRow?.items.map((i) => Number(i.qty)))
  const after = (await mod.so().checkInventoryForSalesOrder(order.id, TENANT_ID)).find((r) => r.itemCode === fx.fgB.code)
  check("I5c", after?.plannedQty === 45 && (after.orderedQty - after.shippedQty - after.plannedQty) === 5, "출하예정 45 반영 → 추가 출하 가능 5 (정합)", after && { planned: after.plannedQty })

  // I6 한도 초과 거부 + 발주번호 유지
  const over = await submit([{ lotId: lotB.id, qty: 10 }])
  check("I6a", !over.ok, "추가 출하 가능(5)을 넘는 요청(10)은 LOT 재고가 있어도 거부", over)
  const final = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })
  check("I6b", final.customerPoNo === po, "엑셀로 저장한 발주번호가 후속 처리 뒤에도 유지")

  summary("수주 엑셀 통합 연계(23)")
  await prisma.$disconnect()
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.stack : e); process.exit(1) })
