// 생산계획 상태 동기화 헬퍼 (작업지시/POP 실적 처리 트랜잭션에서 호출).
//
// 이전에는 production-plan.actions.ts('use server') 안에 있어서, 이 함수만 import 하는 POP 페이지에
// 해당 모듈의 모든 export 가 서버 액션으로 함께 등록(비로그인 호출 표면 확대)되었다.
// 'use server' 가 없는 일반 서버 모듈로 분리해 클라이언트에서 호출 가능한 엔드포인트가 되지 않게 한다.
import { PlanStatus, Prisma } from "@prisma/client"
import { evaluateProductionPlanWorkOrderCompletion } from "@/lib/production-plan-workorder-integrity"

type ProductionPlanSyncTx = Prisma.TransactionClient

const FINAL_PLAN_STATUSES: PlanStatus[] = ["COMPLETED", "CANCELLED"]

export async function syncProductionPlanStatusFromWorkOrders(
  tx: ProductionPlanSyncTx,
  productionPlanId: string,
  tenantId?: string
) {
  const plan = await tx.productionPlan.findFirst({
    where: {
      id: productionPlanId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          id: true,
          plannedQty: true,
          workOrders: {
            select: { id: true, status: true, plannedQty: true },
          },
        },
      },
    },
  })

  if (!plan || FINAL_PLAN_STATUSES.includes(plan.status)) return

  const completion = evaluateProductionPlanWorkOrderCompletion(plan.items)

  if (completion.shouldComplete && ["CONFIRMED", "IN_PROGRESS"].includes(plan.status)) {
    await tx.productionPlan.update({
      where: { id: plan.id },
      data: { status: "COMPLETED" },
    })
    return
  }

  if (completion.hasEffectiveWorkOrders && plan.status === "CONFIRMED") {
    await tx.productionPlan.update({
      where: { id: plan.id },
      data: { status: "IN_PROGRESS" },
    })
  }
}

export async function syncProductionPlanStatusForWorkOrder(
  tx: ProductionPlanSyncTx,
  workOrderId: string,
  tenantId?: string
) {
  const workOrder = await tx.workOrder.findFirst({
    where: {
      id: workOrderId,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      productionPlanItem: {
        select: { planId: true },
      },
    },
  })

  const productionPlanId = workOrder?.productionPlanItem?.planId
  if (!productionPlanId) return

  await syncProductionPlanStatusFromWorkOrders(tx, productionPlanId, tenantId)
}
