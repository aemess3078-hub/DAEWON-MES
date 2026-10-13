import fs from "fs"
import path from "path"

const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8")
}

function assertIncludes(relativePath: string, expected: string, description: string) {
  const source = read(relativePath)
  if (!source.includes(expected)) {
    throw new Error(`${description} 누락: ${relativePath} 에서 ${expected} 를 찾지 못했습니다.`)
  }
}

function assertRegex(relativePath: string, pattern: RegExp, description: string) {
  const source = read(relativePath)
  if (!pattern.test(source)) {
    throw new Error(`${description} 누락: ${relativePath} 이(가) ${pattern} 와 일치하지 않습니다.`)
  }
}

const checks: Array<() => void> = [
  () => assertIncludes(
    "src/app/app/mes/sales-orders/sales-order-process-dialog.tsx",
    "/app/mes/production-plan?salesOrderId=",
    "수주 생산의뢰 후 생산계획 컨텍스트 이동"
  ),
  () => assertIncludes(
    "src/app/app/mes/sales-orders/sales-order-process-dialog.tsx",
    "/app/mes/shipments?salesOrderId=",
    "수주 출하요청 후 출하 컨텍스트 이동"
  ),
  () => assertIncludes(
    "src/app/app/mes/production-plan/page.tsx",
    "searchParams: Promise<{ salesOrderId?: string }>",
    "생산계획 salesOrderId 수신"
  ),
  () => assertIncludes(
    "src/app/app/mes/production-plan/plan-data-table.tsx",
    "salesOrderItem?.salesOrder.id === initialSalesOrderId",
    "생산계획 수주 기반 필터"
  ),
  () => assertIncludes(
    "src/app/app/mes/production-plan/columns.tsx",
    "/app/mes/work-orders?productionPlanId=",
    "생산계획에서 작업지시로 ID 전달"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/page.tsx",
    "productionPlanItemId?: string",
    "작업지시 생산계획/계획품목 컨텍스트 수신"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/work-order-data-table.tsx",
    "setFormMode(\"create\")",
    "작업지시 컨텍스트 기반 생성 폼 자동 열기"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/work-order-form-sheet.tsx",
    "void handleProductionPlanItemChange(defaultProductionPlanItemId)",
    "작업지시 폼 계획품목 자동 선택"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/columns.tsx",
    "/app/mes/material-issue?workOrderId=",
    "작업지시에서 자재출고로 ID 전달"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/columns.tsx",
    "/app/mes/inspection?operationId=",
    "작업지시에서 검사로 공정 ID 전달"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/columns.tsx",
    "/app/mes/finished-goods-receipt?workOrderId=",
    "작업지시에서 완제품 입고로 ID 전달"
  ),
  () => assertIncludes(
    "src/app/app/mes/work-orders/columns.tsx",
    "/pop/production/${encodeURIComponent(currentOperation.id)}",
    "작업지시에서 POP로 공정 ID 전달"
  ),
  () => assertIncludes(
    "src/app/app/mes/material-issue/material-issue-table.tsx",
    "setIssuingOrder(workOrder)",
    "자재출고 작업지시 자동 선택"
  ),
  () => assertIncludes(
    "src/app/app/mes/inspection/inspection-form-sheet.tsx",
    "void handleOperationChange(defaultOperationId)",
    "검사 공정 자동 선택 및 검사기준 로드"
  ),
  () => assertIncludes(
    "src/app/app/mes/finished-goods-receipt/finished-goods-data-table.tsx",
    "setReceiptTarget(workOrder)",
    "완제품 입고 작업지시 자동 선택"
  ),
  () => assertIncludes(
    "src/app/app/mes/shipments/shipment-data-table.tsx",
    "setPreselectedOrderId(order.id)",
    "출하 수주 자동 선택"
  ),
  () => assertIncludes(
    "src/app/app/mes/traceability/page.tsx",
    "where: { id: params.lotId, tenantId }",
    "LOT 추적 lotId tenant-scoped 해석"
  ),
  () => assertIncludes(
    "src/app/app/mes/master/equipment/columns.tsx",
    "/app/mes/equipment-repair?equipmentId=",
    "설비에서 수리요청으로 ID 전달"
  ),
  () => assertIncludes(
    "src/app/app/mes/master/equipment/columns.tsx",
    "/app/mes/equipment-check?equipmentId=",
    "설비에서 점검등록으로 ID 전달"
  ),
]

for (const check of checks) {
  check()
}

console.log(`✅ next-work navigation contract checks passed (${checks.length} checks)`)
