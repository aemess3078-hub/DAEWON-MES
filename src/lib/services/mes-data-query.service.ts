import { prisma } from "@/lib/db/prisma"

export async function getProductionSummary(tenantId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [totalWO, activeWO, completedWO, todayResults, recentWorkOrders] = await Promise.all([
    prisma.workOrder.count({ where: { tenantId } }),
    prisma.workOrder.count({ where: { tenantId, status: "IN_PROGRESS" } }),
    prisma.workOrder.count({ where: { tenantId, status: "COMPLETED" } }),
    prisma.productionResult.findMany({
      where: {
        workOrderOperation: { workOrder: { tenantId } },
        startedAt: { gte: today },
      },
      select: { goodQty: true, defectQty: true, reworkQty: true },
    }),
    prisma.workOrder.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        orderNo: true,
        status: true,
        plannedQty: true,
        dueDate: true,
        item: { select: { code: true, name: true } },
      },
    }),
  ])

  const todayGood = todayResults.reduce((s, r) => s + Number(r.goodQty), 0)
  const todayDefect = todayResults.reduce((s, r) => s + Number(r.defectQty), 0)
  const yieldRate =
    todayGood + todayDefect > 0
      ? ((todayGood / (todayGood + todayDefect)) * 100).toFixed(1) + "%"
      : "데이터 없음"

  return {
    집계: { 총작업지시: totalWO, 진행중: activeWO, 완료: completedWO, 오늘양품: todayGood, 오늘불량: todayDefect, 양품률: yieldRate },
    최근작업지시: recentWorkOrders.map((w) => ({
      작업지시번호: w.orderNo,
      품목코드: w.item.code,
      품목명: w.item.name,
      상태: w.status,
      계획수량: Number(w.plannedQty),
      납기일: w.dueDate,
    })),
  }
}

export async function getInventorySummary(tenantId: string) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { tenantId },
    include: {
      item: { select: { code: true, name: true, itemType: true, uom: true } },
      warehouse: { select: { name: true, code: true } },
    },
  })

  // 품목별 합산 (같은 품목이 여러 로케이션에 있을 수 있음)
  const byItem = new Map<string, {
    itemCode: string; itemName: string; itemType: string; uom: string
    qtyOnHand: number; qtyAvailable: number; qtyHold: number
    locations: string[]
  }>()

  for (const b of balances) {
    const key = b.itemId
    if (!byItem.has(key)) {
      byItem.set(key, {
        itemCode: b.item.code,
        itemName: b.item.name,
        itemType: b.item.itemType,
        uom: b.item.uom,
        qtyOnHand: 0,
        qtyAvailable: 0,
        qtyHold: 0,
        locations: [],
      })
    }
    const entry = byItem.get(key)!
    entry.qtyOnHand += Number(b.qtyOnHand)
    entry.qtyAvailable += Number(b.qtyAvailable)
    entry.qtyHold += Number(b.qtyHold)
    if (b.warehouse?.name) entry.locations.push(b.warehouse.name)
  }

  const items = Array.from(byItem.values())
  const lowStock = items.filter((i) => i.qtyAvailable < 10)

  return {
    집계: {
      총품목수: items.length,
      부족재고품목수: lowStock.length,
    },
    품목별재고: items.map((i) => ({
      품목코드: i.itemCode,
      품목명: i.itemName,
      유형: i.itemType,
      단위: i.uom,
      현재고: i.qtyOnHand,
      가용재고: i.qtyAvailable,
      보류재고: i.qtyHold,
      로케이션: i.locations.join(", "),
    })),
    부족재고: lowStock.map((i) => ({
      품목코드: i.itemCode,
      품목명: i.itemName,
      가용재고: i.qtyAvailable,
    })),
  }
}

export async function getSalesOrderSummary(tenantId: string) {
  const sevenDaysLater = new Date()
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)

  const [total, confirmed, inProd, shipped, urgent, recentOrders] = await Promise.all([
    prisma.salesOrder.count({ where: { tenantId } }),
    prisma.salesOrder.count({ where: { tenantId, status: "CONFIRMED" } }),
    prisma.salesOrder.count({ where: { tenantId, status: "IN_PRODUCTION" } }),
    prisma.salesOrder.count({ where: { tenantId, status: "SHIPPED" } }),
    prisma.salesOrder.count({
      where: {
        tenantId,
        deliveryDate: { lte: sevenDaysLater },
        status: { notIn: ["SHIPPED", "CLOSED", "CANCELLED"] },
      },
    }),
    prisma.salesOrder.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        orderNo: true,
        status: true,
        deliveryDate: true,
        customer: { select: { name: true } },
        items: {
          select: {
            item: { select: { code: true, name: true } },
            qty: true,
            shippedQty: true,
          },
        },
      },
    }),
  ])

  return {
    집계: { 총수주: total, 확정: confirmed, 생산중: inProd, 출하완료: shipped, 납기임박7일내: urgent },
    최근수주: recentOrders.map((o) => ({
      수주번호: o.orderNo,
      고객사: o.customer?.name ?? "-",
      상태: o.status,
      납기일: o.deliveryDate,
      품목: o.items.map((i) => `${i.item.name}(${Number(i.qty)}개, 출하:${Number(i.shippedQty)}개)`).join(", "),
    })),
  }
}

export async function getEquipmentSummary(tenantId: string) {
  const equipments = await prisma.equipment.findMany({
    where: { tenantId },
    select: { code: true, name: true, status: true, equipmentType: true },
  })

  const statusCounts = equipments.reduce(
    (acc, eq) => {
      acc[eq.status] = (acc[eq.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return {
    집계: { 총설비수: equipments.length, 상태별: statusCounts },
    설비목록: equipments.map((e) => ({
      설비코드: e.code,
      설비명: e.name,
      유형: e.equipmentType,
      상태: e.status,
    })),
  }
}

export async function getQualitySummary(tenantId: string) {
  const [totalInspections, passCount, failCount, recentFails] = await Promise.all([
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } } },
    }),
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, result: "PASS" },
    }),
    prisma.qualityInspection.count({
      where: { workOrderOperation: { workOrder: { tenantId } }, result: "FAIL" },
    }),
    prisma.qualityInspection.findMany({
      where: { workOrderOperation: { workOrder: { tenantId } }, result: "FAIL" },
      orderBy: { inspectedAt: "desc" },
      take: 10,
      select: {
        inspectedAt: true,
        workOrderOperation: {
          select: {
            workOrder: { select: { orderNo: true, item: { select: { name: true } } } },
          },
        },
        defectRecords: {
          select: {
            qty: true,
            severity: true,
            defectCode: { select: { code: true, name: true } },
          },
        },
      },
    }),
  ])

  return {
    집계: { 총검사: totalInspections, 합격: passCount, 불합격: failCount },
    최근불합격: recentFails.map((f) => ({
      검사일시: f.inspectedAt,
      작업지시번호: f.workOrderOperation?.workOrder?.orderNo ?? "-",
      품목명: f.workOrderOperation?.workOrder?.item?.name ?? "-",
      불량내역: f.defectRecords.map((d) => ({
        불량코드: d.defectCode.code,
        불량명: d.defectCode.name,
        수량: Number(d.qty),
        심각도: d.severity,
      })),
    })),
  }
}
