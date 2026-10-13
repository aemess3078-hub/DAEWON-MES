"use server"

import { WipMovementType, WorkOrderStatus } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { buildProductionProgressRow } from "@/lib/actions/production-progress.service"
import {
  buildKstDateKeyRange,
  isValidKstDateKey,
  kstDateKeyToNextUtcStart,
  kstDateKeyToUtcStart,
  kstDateRangeToUtcBounds,
  toKstDateKey,
} from "@/lib/date/kst"
import type {
  DailyProductionTrendPoint,
  ProductionProgressData,
  ProductionProgressFilter,
  ProductionProgressFilterOptions,
  ProductionProgressOperationInput,
  ProductionProgressRow,
  ProductionProgressSummary,
  ProductionProgressWipInput,
  ProductionProgressWipMovementInput,
  ProductionProgressWorkOrderInput,
} from "@/lib/actions/production-progress.types"

// ─── 생산진행 현황(NewMES 전용) — DB 조회 Server Action ─────────────────────────
//
// 역할: Prisma 조회 → ProductionProgressWorkOrderInput 매핑 → buildProductionProgressRow()
// 호출 → ProductionProgressRow[] 반환. 계획수량/생산실적/진행률/현재공정/재공수량 계산은
// 전부 production-progress.service.ts(2단계에서 확정)에 위임하며, 이 파일에서 다시
// 계산하지 않는다(정본이 두 개가 되는 것을 방지).
//
// "use server" 규칙(docs/server-actions-rules.md): 이 파일이 export하는 것은
// async function만 허용된다. 브랜드 가드(assertNewMesBrand)는 비-export 헬퍼로
// 파일 내부에만 존재한다.

// ─── NewMES 전용 기능 보호 ────────────────────────────────────────────────────
//
// 이 저장소(NMES.git)는 NewMES와 CNS Medical이 동일 코드베이스를 공유하며,
// 배포 브랜드는 기존 관례인 NEXT_PUBLIC_BRAND 환경변수로만 구분된다
// (src/app/layout.tsx, src/components/brand-logo.tsx 참고 — 두 곳 모두 서버에서
// process.env.NEXT_PUBLIC_BRAND를 직접 읽는다. NEXT_PUBLIC_ 접두사는 클라이언트에도
// 노출된다는 의미일 뿐, 서버 코드에서 읽는 것을 막지 않는다).
// 이 화면은 NewMES 전용이므로 두 Server Action 진입 시점에 동일한 값을 재사용해
// CNS 배포(NEXT_PUBLIC_BRAND가 "newmes"가 아님)에서는 데이터를 반환하지 않는다.
// 새 환경변수나 별도 브랜드 판정 모듈은 추가하지 않았다 — 프로젝트에 Server Action
// 레벨의 기존 브랜드 가드 패턴이 없어(레포 전체에 NEXT_PUBLIC_BRAND 참조가 위 2곳뿐),
// requireRole()의 throw 스타일(`throw new Error('FORBIDDEN')`)을 그대로 따르는
// 최소한의 로컬 guard 함수로 구현했다.
function assertNewMesBrand(): void {
  if (process.env.NEXT_PUBLIC_BRAND !== "newmes") {
    throw new Error("이 기능은 NewMES 전용입니다.")
  }
}

// ─── 목록/KPI 조회 ────────────────────────────────────────────────────────────

export async function getProductionProgressData(
  filter?: ProductionProgressFilter
): Promise<ProductionProgressData> {
  assertNewMesBrand()
  const tenantId = await getTenantId()
  const referenceDate = new Date()
  const appliedFilter: ProductionProgressFilter = filter ?? {}
  const createdAtFilter = resolveOptionalKstRange(appliedFilter.from, appliedFilter.to)

  // ── Query 1: WorkOrder + Item + Operation + Assignment + ProductionResult ──
  // 기간 기준은 WorkOrder.createdAt만 사용한다(§기간 조회 기준 — 아래 주석 참고).
  const workOrders = await prisma.workOrder.findMany({
    where: {
      tenantId,
      ...(appliedFilter.siteId ? { siteId: appliedFilter.siteId } : {}),
      ...(appliedFilter.itemId ? { itemId: appliedFilter.itemId } : {}),
      ...(appliedFilter.workOrderStatus ? { status: appliedFilter.workOrderStatus } : {}),
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    select: {
      id: true,
      orderNo: true,
      itemId: true,
      plannedQty: true,
      status: true,
      dueDate: true,
      createdAt: true,
      item: { select: { code: true, name: true, uom: true } },
      operations: {
        select: {
          id: true,
          seq: true,
          status: true,
          plannedQty: true,
          completedQty: true,
          equipment: { select: { name: true } },
          routingOperation: { select: { id: true, name: true } },
          assignments: {
            select: { equipment: { select: { name: true } } },
          },
          productionResults: {
            select: { goodQty: true, startedAt: true },
          },
        },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  const workOrderIds = workOrders.map((workOrder) => workOrder.id)

  // ── Query 2: WipUnit (재공수량 / 현재공정 판정용) ──────────────────────────
  // service의 현재공정 fallback·COMPLETED root 판정을 위해 상태로 미리 자르지 않고
  // 작업지시에 속한 WipUnit 전체를 가져온다(필터링은 service 내부에서 수행).
  const wipUnits = workOrderIds.length
    ? await prisma.wipUnit.findMany({
        where: { tenantId, workOrderId: { in: workOrderIds } },
        select: {
          id: true,
          workOrderId: true,
          qty: true,
          status: true,
          parentWipUnitId: true,
          sourceProductionResultId: true,
          workOrderOperationId: true,
          updatedAt: true,
          createdAt: true,
        },
      })
    : []

  // ── Query 3: WipMovement(STARTED만) — 시작일 계산용 ────────────────────────
  // WipMovement에는 workOrderId가 직접 없으므로 wipUnit relation을 통해 연결한다.
  const startedMovements = workOrderIds.length
    ? await prisma.wipMovement.findMany({
        where: {
          tenantId,
          movementType: WipMovementType.STARTED,
          wipUnit: { workOrderId: { in: workOrderIds } },
        },
        select: {
          createdAt: true,
          wipUnit: { select: { workOrderId: true } },
        },
      })
    : []

  // ── DB 결과 → service 입력 DTO로 그룹핑 ────────────────────────────────────
  const wipUnitsByWorkOrder = new Map<string, ProductionProgressWipInput[]>()
  for (const unit of wipUnits) {
    if (!unit.workOrderId) continue
    const list = wipUnitsByWorkOrder.get(unit.workOrderId) ?? []
    list.push({
      id: unit.id,
      qty: Number(unit.qty),
      status: unit.status,
      parentWipUnitId: unit.parentWipUnitId,
      sourceProductionResultId: unit.sourceProductionResultId,
      workOrderOperationId: unit.workOrderOperationId,
      updatedAt: unit.updatedAt,
      createdAt: unit.createdAt,
    })
    wipUnitsByWorkOrder.set(unit.workOrderId, list)
  }

  const startedMovementsByWorkOrder = new Map<string, ProductionProgressWipMovementInput[]>()
  for (const movement of startedMovements) {
    const workOrderId = movement.wipUnit.workOrderId
    if (!workOrderId) continue
    const list = startedMovementsByWorkOrder.get(workOrderId) ?? []
    list.push({ movementType: WipMovementType.STARTED, createdAt: movement.createdAt })
    startedMovementsByWorkOrder.set(workOrderId, list)
  }

  // ── Row 생성 (계산은 전부 buildProductionProgressRow에 위임) ────────────────
  const rows: ProductionProgressRow[] = []
  for (const workOrder of workOrders) {
    const operations: ProductionProgressOperationInput[] = workOrder.operations.map((op) => ({
      id: op.id,
      seq: op.seq,
      status: op.status,
      plannedQty: Number(op.plannedQty),
      completedQty: Number(op.completedQty),
      operationName: op.routingOperation.name,
      routingOperationId: op.routingOperation.id,
      equipmentName: op.equipment?.name ?? null,
      assignments: op.assignments.map((assignment) => ({
        equipmentName: assignment.equipment.name,
      })),
      productionResults: op.productionResults.map((result) => ({
        goodQty: Number(result.goodQty),
        startedAt: result.startedAt,
      })),
    }))

    const mapped: ProductionProgressWorkOrderInput = {
      id: workOrder.id,
      orderNo: workOrder.orderNo,
      itemId: workOrder.itemId,
      itemCode: workOrder.item.code,
      itemName: workOrder.item.name,
      itemUom: workOrder.item.uom,
      plannedQty: Number(workOrder.plannedQty),
      status: workOrder.status,
      dueDate: workOrder.dueDate,
      operations,
      wipUnits: wipUnitsByWorkOrder.get(workOrder.id) ?? [],
      wipMovements: startedMovementsByWorkOrder.get(workOrder.id) ?? [],
    }

    const row = buildProductionProgressRow(mapped, referenceDate)

    // 공정 필터: "현재공정이 해당 공정인 작업지시"만 남긴다(routing 포함 여부 아님).
    // currentOperation은 WorkOrderOperation.id 단위라 작업지시 간 재사용이 안 되므로,
    // 이번에 매핑해 둔 operations에서 같은 id를 찾아 RoutingOperation.id로 비교한다.
    if (appliedFilter.operationId) {
      const currentOperationRecord = row.currentOperation
        ? operations.find((op) => op.id === row.currentOperation!.operationId)
        : null
      if (currentOperationRecord?.routingOperationId !== appliedFilter.operationId) {
        continue
      }
    }

    rows.push(row)
  }

  // 정렬 3순위(createdAt DESC)는 Row 타입에 없는 원본 WorkOrder.createdAt이 필요하므로
  // Row 확정 계약을 건드리지 않기 위해 별도 map으로만 들고 있다가 정렬에만 사용한다.
  const createdAtByWorkOrderId = new Map(
    workOrders.map((workOrder) => [workOrder.id, workOrder.createdAt])
  )
  sortProductionProgressRows(rows, createdAtByWorkOrderId)

  return {
    summary: summarizeProductionProgressRows(rows),
    rows,
    appliedFilter,
  }
}

// ─── 필터 옵션 조회 ────────────────────────────────────────────────────────────

export async function getProductionProgressFilterOptions(): Promise<ProductionProgressFilterOptions> {
  assertNewMesBrand()
  const tenantId = await getTenantId()

  const [sites, items, operationRows] = await Promise.all([
    prisma.site.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({
      where: { tenantId, workOrders: { some: {} } },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.workOrderOperation.findMany({
      where: { workOrder: { tenantId } },
      select: {
        routingOperation: { select: { id: true, name: true } },
      },
    }),
  ])

  // routingOperation은 여러 작업지시에서 중복 사용되므로 id 기준으로 중복 제거한다.
  // (Prisma distinct + relation orderBy 조합의 불확실성을 피하기 위해 메모리에서 처리)
  const operationMap = new Map<string, { id: string; name: string }>()
  for (const row of operationRows) {
    operationMap.set(row.routingOperation.id, row.routingOperation)
  }
  const operations = Array.from(operationMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  )

  return {
    sites,
    items,
    operations,
    workOrderStatuses: Object.values(WorkOrderStatus),
  }
}

// ─── 일별 생산실적 추이 조회 ─────────────────────────────────────────────────────
//
// 정의(6단계에서 확정, 변경 금지): 작업지시별 최종공정(WorkOrderOperation 중 seq
// 최댓값 — wip-receipt.helpers.ts의 finalOperation과 동일 정의)에서, 해당 KST
// 달력일에 등록된 ProductionResult.goodQty 합계. 전 공정 goodQty를 합치지 않는다
// (같은 제품이 공정을 이동할 때마다 중복 계상되므로).
//
// production-progress.service.ts의 computeProductionOutputQty()는 "현재 시점
// 스냅샷" 값이고 이 함수는 "날짜별 시계열"이라 개념이 달라 재사용하지 않는다
// (service 쪽 로직도 이 파일도 서로 건드리지 않았다).
//
// 필터 해석이 getProductionProgressData()와 다른 점(모두 의도된 것):
//   - from/to: WorkOrder.createdAt이 아니라 ProductionResult.startedAt 기준
//     (작업지시 생성일이 조회기간 이전이어도, 그 기간에 실제 생산된 실적은 포함되어야 함)
//   - operationId: 무시한다. "현재공정"은 스냅샷(지금 어디 있는가) 필터이고, 이 함수는
//     "과거 특정 날짜에 최종공정에서 얼마가 나왔는가"라는 이벤트 데이터라 의미가 다르다.
//     오류를 내지 않고 조용히 무시한다(호출부가 실수로 넘겨도 안전).
//   - workOrderStatus: 필터를 걸면 "현재 상태가 그 값인 작업지시들의 과거 실적 이력"이
//     된다. WorkOrderStatus 변경 이력이 DB에 없어 과거 시점 상태를 복원할 수 없으므로
//     현재 상태 기준으로만 해석한다.
export async function getDailyProductionTrend(
  filter?: ProductionProgressFilter
): Promise<DailyProductionTrendPoint[]> {
  assertNewMesBrand()
  const tenantId = await getTenantId()
  const { from, to, fromUtc, toExclusiveUtc } = validateDailyTrendRange(filter ?? {})

  const dateKeys = buildKstDateKeyRange(from, to)
  // to는 inclusive이므로, "to의 다음 날 KST 00:00"을 exclusive upper bound로 사용한다.

  // ── Query 1: 기간 내 ProductionResult 후보 ─────────────────────────────────
  const results = await prisma.productionResult.findMany({
    where: {
      startedAt: { gte: fromUtc, lt: toExclusiveUtc },
      workOrderOperation: {
        workOrder: {
          tenantId,
          ...(filter?.siteId ? { siteId: filter.siteId } : {}),
          ...(filter?.itemId ? { itemId: filter.itemId } : {}),
          ...(filter?.workOrderStatus ? { status: filter.workOrderStatus } : {}),
        },
      },
    },
    select: {
      goodQty: true,
      startedAt: true,
      workOrderOperationId: true,
      workOrderOperation: {
        select: { workOrderId: true },
      },
    },
  })

  // 실적 후보가 없으면 Query 2를 실행하지 않는다 — 그래도 반환은 빈 배열이 아니라
  // 조회기간 전체를 0으로 채운 dense series여야 한다.
  if (results.length === 0) {
    return dateKeys.map((date) => ({ date, outputQty: 0 }))
  }

  // ── Query 2: 위 결과에 실제로 등장한 작업지시들의 최종공정만 조회 ──────────────
  const workOrderIds = Array.from(
    new Set(results.map((result) => result.workOrderOperation.workOrderId))
  )
  const workOrders = await prisma.workOrder.findMany({
    where: { tenantId, id: { in: workOrderIds } },
    select: {
      id: true,
      operations: {
        orderBy: { seq: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  })
  const finalOperationIdByWorkOrderId = new Map(
    workOrders.map((workOrder) => [workOrder.id, workOrder.operations[0]?.id ?? null])
  )

  // ── 최종공정 실적만 남기고 KST 날짜별 goodQty 합산 ──────────────────────────
  const outputByDateKey = new Map<string, number>()
  for (const result of results) {
    const finalOperationId = finalOperationIdByWorkOrderId.get(
      result.workOrderOperation.workOrderId
    )
    if (!finalOperationId || result.workOrderOperationId !== finalOperationId) continue
    if (!result.startedAt) continue // Query1의 range 조건상 실제로는 발생하지 않음(타입 방어용)

    const dateKey = toKstDateKey(result.startedAt)
    outputByDateKey.set(dateKey, (outputByDateKey.get(dateKey) ?? 0) + Number(result.goodQty))
  }

  return dateKeys.map((date) => ({ date, outputQty: outputByDateKey.get(date) ?? 0 }))
}

// ─── 내부 헬퍼 (비-export — "use server" 파일은 async function만 export 가능) ─────

// ─── 정렬 ─────────────────────────────────────────────────────────────────────
// 1) DELAYED → WARNING → NORMAL
// 2) dueDate ASC (null은 뒤)
// 3) createdAt DESC
// UI 요구가 아직 확정되지 않았으므로 이 이상 복잡하게 만들지 않되, 결과는 결정적이어야 한다.

const HEALTH_SORT_RANK: Record<ProductionProgressRow["healthStatus"], number> = {
  DELAYED: 0,
  WARNING: 1,
  NORMAL: 2,
}

function compareDueDateAsc(a: Date | null, b: Date | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // null은 뒤로
  if (b == null) return -1
  return a.getTime() - b.getTime()
}

function sortProductionProgressRows(
  rows: ProductionProgressRow[],
  createdAtByWorkOrderId: Map<string, Date>
): void {
  rows.sort((a, b) => {
    const healthDiff = HEALTH_SORT_RANK[a.healthStatus] - HEALTH_SORT_RANK[b.healthStatus]
    if (healthDiff !== 0) return healthDiff

    const dueDiff = compareDueDateAsc(a.dueDate, b.dueDate)
    if (dueDiff !== 0) return dueDiff

    const createdAtA = createdAtByWorkOrderId.get(a.workOrderId)?.getTime() ?? 0
    const createdAtB = createdAtByWorkOrderId.get(b.workOrderId)?.getTime() ?? 0
    return createdAtB - createdAtA
  })
}

// ─── KPI 요약 ──────────────────────────────────────────────────────────────────
// 계획수량/생산실적은 Row에 이미 확정된 값(§생산실적 규칙 — 공정 goodQty 재합산 금지)을
// 그대로 합산한다. 전체 진행률은 "개별 진행률의 평균"이 아니라 총 실적/총 계획수량 비율이다
// (작업지시 규모가 다르면 단순 평균은 왜곡되므로).

function summarizeProductionProgressRows(
  rows: ProductionProgressRow[]
): ProductionProgressSummary {
  let totalPlannedQty = 0
  let totalProductionOutputQty = 0
  let normalCount = 0
  let warningCount = 0
  let delayedCount = 0

  for (const row of rows) {
    totalPlannedQty += row.plannedQty
    totalProductionOutputQty += row.productionOutputQty
    if (row.healthStatus === "NORMAL") normalCount += 1
    else if (row.healthStatus === "WARNING") warningCount += 1
    else delayedCount += 1
  }

  const uoms = Array.from(new Set(rows.map((row) => row.itemUom)))
  const isMixedUom = uoms.length > 1
  const overallProgressRate =
    !isMixedUom && totalPlannedQty > 0
      ? Math.min(100, Math.max(0, (totalProductionOutputQty / totalPlannedQty) * 100))
      : 0

  return {
    totalWorkOrders: rows.length,
    totalPlannedQty,
    totalProductionOutputQty,
    uom: isMixedUom ? null : (uoms[0] ?? null),
    isMixedUom,
    overallProgressRate,
    normalCount,
    warningCount,
    delayedCount,
  }
}

// ─── 일별 생산실적 추이 필터 검증 ────────────────────────────────────────────────
// UI는 이미 올바른 값을 보내지만, Server Action은 직접 호출될 수도 있으므로
// production-progress-client.tsx의 기존 from>to 검증과 동일한 기준을 서버에도 둔다.

function resolveOptionalKstRange(
  from?: string,
  to?: string
): { gte?: Date; lt?: Date } | null {
  if (!from && !to) return null
  if (from && !isValidKstDateKey(from)) {
    throw new Error("조회 시작일이 올바르지 않습니다. YYYY-MM-DD 형식의 실제 KST 날짜를 입력해 주세요.")
  }
  if (to && !isValidKstDateKey(to)) {
    throw new Error("조회 종료일이 올바르지 않습니다. YYYY-MM-DD 형식의 실제 KST 날짜를 입력해 주세요.")
  }
  if (from && to && from > to) {
    throw new Error("시작일이 종료일보다 늦을 수 없습니다.")
  }
  return {
    ...(from ? { gte: kstDateKeyToUtcStart(from) } : {}),
    ...(to ? { lt: kstDateKeyToNextUtcStart(to) } : {}),
  }
}

function validateDailyTrendRange(filter: ProductionProgressFilter): {
  from: string
  to: string
  fromUtc: Date
  toExclusiveUtc: Date
} {
  const { from, to } = filter
  if (!from || !to) {
    throw new Error("조회 기간(시작일, 종료일)을 입력해 주세요.")
  }
  const { fromDate, toExclusiveDate } = kstDateRangeToUtcBounds(from, to)
  return { from, to, fromUtc: fromDate, toExclusiveUtc: toExclusiveDate }
}
