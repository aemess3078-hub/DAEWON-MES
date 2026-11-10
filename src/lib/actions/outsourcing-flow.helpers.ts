import { Prisma, OperationStatus } from "@prisma/client"
import { advanceWipUnitOnOperationComplete } from "@/lib/actions/wip-traceability.helpers"
import { syncProductionPlanStatusForWorkOrder } from "@/lib/production-plan-sync"

// 외주관리(outsourcing.actions.ts) 트랜잭션 안에서만 호출되는 내부 헬퍼("use server" 아님).
//
// 외주 흐름: 외주출고(WIP OUTSOURCED) → 외주입고(WIP RECEIVED, 검사 대기) → 입고검사(합격/불량/재외주)
//   - 외주 진행/검사 대기 중에는 POP 작업시작·실적등록이 막힌다(operation-status-integrity).
//   - 입고검사 합격 수량은 해당 외주공정의 완료 실적(ProductionResult)으로 반영하고 공정을 완료한 뒤,
//     합격 WIP 를 다음 공정(WAITING)으로 자동 이동한다. 최종공정이면 COMPLETED → 완제품 입고 대상.
//   - 불량은 SCRAPPED child, 재외주는 REWORK child(정상 후속공정에 투입되지 않음)로 분리된다.

export type OutsourcingFlowTx = Prisma.TransactionClient

const EPS = 0.000001

/**
 * 외주발주 상태를 품목별 입고 수량으로 다시 계산한다.
 *  - 입고 0 → ORDERED(발주완료) / 일부 입고 → PARTIAL_RECEIVED(부분입고) / 모든 품목 전량 입고 → RECEIVED(입고완료)
 * DRAFT·CLOSED·CANCELLED 는 건드리지 않는다. 품목이 아직 없으면(출고 전 발주) 상태를 바꾸지 않는다.
 */
export async function syncOutsourcingOrderStatus(tx: OutsourcingFlowTx, purchaseOrderId: string): Promise<void> {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, status: true, items: { select: { qty: true, receivedQty: true } } },
  })
  if (!order || order.items.length === 0) return
  if (order.status === "DRAFT" || order.status === "CLOSED" || order.status === "CANCELLED") return

  const anyReceived = order.items.some((i) => Number(i.receivedQty) > EPS)
  const allReceived = order.items.every((i) => Number(i.receivedQty) + EPS >= Number(i.qty))
  const next = !anyReceived ? "ORDERED" : allReceived ? "RECEIVED" : "PARTIAL_RECEIVED"
  if (next !== order.status) {
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: next } })
  }
}

/**
 * 외주 입고검사 결과를 외주공정의 완료 실적으로 반영한다(root 재공 기준).
 *  1) ProductionResult(양품=합격, 불량, 재외주=재작업 수량) 생성 → 공정 completedQty 반영(중복 집계 없음: POP 는 이 공정에서 막혀 있다)
 *  2) 공정 COMPLETED, 모든 공정 완료 시 작업지시 COMPLETED
 *  3) 합격 수량이 있으면 root 재공을 다음 공정 WAITING 으로 이동(최종공정이면 COMPLETED)
 * 호출 전에 root 재공은 합격 수량(qty)·IN_PROCESS 로 갱신되어 있어야 한다(합격 0 이면 SCRAPPED 라 이동 생략).
 */
export async function completeOutsourcedOperationOnInspection(
  tx: OutsourcingFlowTx,
  params: {
    tenantId: string
    siteId: string | null
    workOrderId: string
    workOrderOperationId: string
    acceptedQty: number
    defectQty: number
    reworkQty: number
    startedAt: Date | null
    operatorProfileId: string | null
  },
): Promise<{ productionResultId: string; nextOperationSeq: number | null }> {
  const total = params.acceptedQty + params.defectQty + params.reworkQty

  const op = await tx.workOrderOperation.findUnique({
    where: { id: params.workOrderOperationId },
    select: {
      id: true,
      seq: true,
      status: true,
      startedAt: true,
      plannedQty: true,
      completedQty: true,
      routingOperation: { select: { workCenterId: true } },
    },
  })
  if (!op) throw new Error("외주공정을 찾을 수 없습니다.")
  if (op.status === OperationStatus.COMPLETED) {
    throw new Error("이미 완료된 공정입니다. 외주검사 결과를 중복 반영할 수 없습니다.")
  }
  const newCompleted = Number(op.completedQty) + total
  if (newCompleted - Number(op.plannedQty) > EPS) {
    throw new Error(
      `공정 잔여 계획수량(${Math.max(0, Number(op.plannedQty) - Number(op.completedQty))})을 초과하는 외주검사 수량(${total})입니다.`,
    )
  }

  const result = await tx.productionResult.create({
    data: {
      workOrderOperationId: op.id,
      goodQty: params.acceptedQty,
      defectQty: params.defectQty,
      reworkQty: params.reworkQty,
      startedAt: params.startedAt ?? new Date(),
      endedAt: new Date(),
      operatorId: params.operatorProfileId,
    },
  })

  await tx.workOrderOperation.update({
    where: { id: op.id },
    data: {
      completedQty: newCompleted,
      status: OperationStatus.COMPLETED,
      ...(op.startedAt ? {} : { startedAt: params.startedAt ?? new Date() }),
    },
  })
  await tx.workOrderOperationAssignment.updateMany({
    where: { workOrderOperationId: op.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
    data: { status: OperationStatus.COMPLETED },
  })

  const allOps = await tx.workOrderOperation.findMany({
    where: { workOrderId: params.workOrderId },
    select: { id: true, seq: true, status: true, routingOperation: { select: { workCenterId: true } } },
    orderBy: { seq: "asc" },
  })
  if (allOps.every((candidate) => candidate.status === OperationStatus.COMPLETED)) {
    await tx.workOrder.update({ where: { id: params.workOrderId }, data: { status: "COMPLETED" } })
    await syncProductionPlanStatusForWorkOrder(tx, params.workOrderId, params.tenantId)
  }

  const nextOp = allOps.find((candidate) => candidate.seq > op.seq) ?? null
  if (params.acceptedQty > EPS) {
    await advanceWipUnitOnOperationComplete(tx, {
      tenantId: params.tenantId,
      siteId: params.siteId,
      workOrderId: params.workOrderId,
      completedOperationId: op.id,
      completedWorkCenterId: op.routingOperation.workCenterId,
      nextOperation: nextOp ? { id: nextOp.id, routingOperation: { workCenterId: nextOp.routingOperation.workCenterId } } : null,
      productionResultId: result.id,
    })
  }
  return { productionResultId: result.id, nextOperationSeq: nextOp?.seq ?? null }
}
