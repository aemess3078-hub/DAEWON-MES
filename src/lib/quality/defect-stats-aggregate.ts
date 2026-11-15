import { Prisma, type PrismaClient, type InspectionStage } from "@prisma/client"

/**
 * 불량분석 집계(요약·일자별·불량유형별·품목별·공정별)를 DB 에서 직접 계산한다.
 * 상세 목록(rows)의 건수 제한과 무관하게 필터 조건에 맞는 "전체" 검사기록을 집계한다.
 * 필터(기간·단계·품목·공정·제조번호·tenant)는 모두 WHERE 절에 적용되며, 기록을 앱 메모리로 가져오지 않는다.
 */
export type DefectAggFilter = {
  tenantId: string
  from: Date
  toExclusive: Date
  stage?: InspectionStage
  routingOperationId?: string
  itemId?: string
  manufacturingNo?: string
}

export type DefectAggregates = {
  summary: { inspectionCount: number; inspectedQty: number; passQty: number; failQty: number; defectQty: number }
  daily: Array<{ date: string; inspectedQty: number; defectQty: number }>
  byType: Array<{ defectCodeId: string; code: string; name: string; category: string; qty: number }>
  byItem: Array<{ itemId: string; code: string; name: string; inspectedQty: number; defectQty: number }>
  byOperation: Array<{ routingOperationId: string; name: string; seq: number; inspectedQty: number; defectQty: number }>
}

export async function aggregateDefectStats(
  db: Pick<PrismaClient, "$queryRaw">,
  f: DefectAggFilter
): Promise<DefectAggregates> {
  const filters = Prisma.sql`
    wo."tenantId" = ${f.tenantId}
    AND qi."inspectedAt" >= ${f.from} AND qi."inspectedAt" < ${f.toExclusive}
    ${f.stage ? Prisma.sql`AND qi."stage" = ${f.stage}::"InspectionStage"` : Prisma.empty}
    ${f.routingOperationId ? Prisma.sql`AND wop."routingOperationId" = ${f.routingOperationId}` : Prisma.empty}
    ${f.itemId ? Prisma.sql`AND wo."itemId" = ${f.itemId}` : Prisma.empty}
    ${f.manufacturingNo ? Prisma.sql`AND wo."manufacturingNo" = ${f.manufacturingNo}` : Prisma.empty}`
  // 검사 1건당 불량수량(DefectRecord 합)을 한 번만 계산한 뒤 여러 축으로 묶는다.
  const base = Prisma.sql`
    SELECT qi.id, qi."inspectedAt", qi.result::text AS result, qi."inspectedQty"::float8 AS qty,
           wo."itemId" AS item_id, wop."routingOperationId" AS op_id,
           COALESCE((SELECT SUM(dr.qty) FROM "DefectRecord" dr WHERE dr."qualityInspectionId" = qi.id), 0)::float8 AS defect
    FROM "QualityInspection" qi
    JOIN "WorkOrderOperation" wop ON wop.id = qi."workOrderOperationId"
    JOIN "WorkOrder" wo ON wo.id = wop."workOrderId"
    WHERE ${filters}`

  const [summary, daily, byType, byItem, byOperation] = await Promise.all([
    db.$queryRaw<Array<{ n: number; qty: number; pass_qty: number; fail_qty: number; defect: number }>>`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(qty), 0)::float8 AS qty,
             COALESCE(SUM(CASE WHEN result = 'PASS' THEN qty END), 0)::float8 AS pass_qty,
             COALESCE(SUM(CASE WHEN result = 'FAIL' THEN qty END), 0)::float8 AS fail_qty,
             COALESCE(SUM(defect), 0)::float8 AS defect
      FROM (${base}) f`,
    db.$queryRaw<Array<{ d: string; qty: number; defect: number }>>`
      SELECT to_char("inspectedAt" + interval '9 hours', 'YYYY-MM-DD') AS d, SUM(qty)::float8 AS qty, SUM(defect)::float8 AS defect
      FROM (${base}) f GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<Array<{ id: string; code: string; name: string; category: string; qty: number }>>`
      SELECT dc.id, dc.code, dc.name, dc."defectCategory"::text AS category, SUM(dr.qty)::float8 AS qty
      FROM "DefectRecord" dr
      JOIN "DefectCode" dc ON dc.id = dr."defectCodeId"
      WHERE dr."qualityInspectionId" IN (SELECT id FROM (${base}) f)
      GROUP BY dc.id, dc.code, dc.name, dc."defectCategory"`,
    db.$queryRaw<Array<{ id: string; code: string; name: string; qty: number; defect: number }>>`
      SELECT i.id, i.code, i.name, SUM(f.qty)::float8 AS qty, SUM(f.defect)::float8 AS defect
      FROM (${base}) f JOIN "Item" i ON i.id = f.item_id GROUP BY i.id, i.code, i.name`,
    db.$queryRaw<Array<{ id: string; name: string; seq: number; qty: number; defect: number }>>`
      SELECT ro.id, ro.name, ro.seq, SUM(f.qty)::float8 AS qty, SUM(f.defect)::float8 AS defect
      FROM (${base}) f JOIN "RoutingOperation" ro ON ro.id = f.op_id GROUP BY ro.id, ro.name, ro.seq`,
  ])

  const s = summary[0]
  return {
    summary: { inspectionCount: s?.n ?? 0, inspectedQty: s?.qty ?? 0, passQty: s?.pass_qty ?? 0, failQty: s?.fail_qty ?? 0, defectQty: s?.defect ?? 0 },
    daily: daily.map((r) => ({ date: r.d, inspectedQty: r.qty, defectQty: r.defect })),
    byType: byType.map((r) => ({ defectCodeId: r.id, code: r.code, name: r.name, category: r.category, qty: r.qty })),
    byItem: byItem.map((r) => ({ itemId: r.id, code: r.code, name: r.name, inspectedQty: r.qty, defectQty: r.defect })),
    byOperation: byOperation.map((r) => ({ routingOperationId: r.id, name: r.name, seq: Number(r.seq), inspectedQty: r.qty, defectQty: r.defect })),
  }
}
