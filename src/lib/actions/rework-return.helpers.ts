import { Prisma, OperationStatus, WipMovementType, WipUnitStatus } from "@prisma/client"
import { findActiveWipUnitForWorkOrder } from "@/lib/actions/wip-traceability.helpers"
import { syncProductionPlanStatusForWorkOrder } from "@/lib/production-plan-sync"

// 중간공정 재작업 종결(ISSUE-014) — completeRework 트랜잭션 안에서만 호출되는 내부 헬퍼("use server" 아님).
//
// 모델 요약: POP 는 작업지시당 "활성 root WipUnit" 1개가 공정을 따라 이동한다(findActiveWipUnitForWorkOrder).
// 불량/재작업은 SPLIT 으로 root 에서 child 로 분리되고(root.qty 감소), child 는 REWORK 로 남는다.
// 재작업 종결 시 합격 수량은 "재작업이 발생한 공정 다음 공정부터" 정상 흐름에 합류한다.
//
//  - 복귀 방식 M(merge): 활성 root 가 아직 다음 공정(N)을 끝내지 않았다 → root.qty 에 합산(같은 흐름으로 후속공정 진행).
//  - 복귀 방식 R(reopen): 활성 root 가 없다(주 생산 흐름이 이미 최종공정까지 완료) → 합격분만 담은 새 root(복귀 root)를
//    다음 공정(N)에 WAITING 으로 만들고, 이미 완료된 N~최종 공정을 재개(PENDING)한다. 기존 완료분(완제품 입고분 포함)은 그대로 둔다.
//  - 그 외(활성 root 가 이미 N 을 지나 진행 중): 주 흐름이 끝난 뒤 종결하도록 안내(데이터 변경 없음).
//
// 중복 집계 방지: 공정 completedQty 는 재작업 발생 시 이미 (양품+불량+재작업)로 집계되어 있다. 복귀는 재작업 공정의 완료수량을
// 다시 올리지 않고, 후속공정의 실적 등록으로만 수량이 집계된다(복귀 root 의 후속공정 투입 가능 수량은 복귀 시점 이후 실적만 차감).

export const REWORK_RETURN_SOURCE = {
  /** 활성 root 에 합산(방식 M) */
  MERGE: "ReworkMerge",
  /** 복귀 root 신규 생성(방식 R) */
  RETURN_ROOT: "ReworkReturn",
} as const

export type ReworkReturnTx = Prisma.TransactionClient

const EPS = 0.000001

export type ReworkReturnResult = {
  mode: "NONE" | "MERGE" | "REOPEN"
  returnedToOperationSeq: number | null
}

/**
 * 복귀 root 인지 확인한다(방식 R 로 만들어진 root 만 true). 복귀 root 의 후속공정 투입 가능 수량은
 * 해당 공정의 "복귀 root 생성 이후" 양품 실적만 차감한다(이전 흐름의 실적과 중복 차감 방지).
 */
export async function getGoodQtySoFarForRoot(
  db: Pick<Prisma.TransactionClient, "wipMovement" | "productionResult">,
  operationId: string,
  root: { id: string; createdAt: Date }
): Promise<number> {
  const returnMarker = await db.wipMovement.findFirst({
    where: { wipUnitId: root.id, movementType: WipMovementType.MERGE, sourceType: REWORK_RETURN_SOURCE.RETURN_ROOT },
    select: { id: true },
  })
  const agg = await db.productionResult.aggregate({
    where: {
      workOrderOperationId: operationId,
      ...(returnMarker ? { endedAt: { gte: root.createdAt } } : {}),
    },
    _sum: { goodQty: true },
  })
  return Number(agg._sum.goodQty ?? 0)
}

/** 중간공정(최종공정이 아닌) REWORK child 의 합격 수량을 정상 흐름으로 복귀시키고 폐기 이력을 남긴다. */
export async function completeIntermediateRework(
  tx: ReworkReturnTx,
  params: {
    child: {
      id: string
      tenantId: string
      siteId: string | null
      workOrderId: string | null
      workOrderOperationId: string
      itemId: string
      manufacturingNo: string | null
      currentWorkCenterId: string | null
      parentWipUnitId: string | null
    }
    mergedQty: number
    scrapQty: number
  }
): Promise<ReworkReturnResult> {
  const { child, mergedQty, scrapQty } = params
  if (!child.workOrderId) throw new Error("작업지시 정보를 확인할 수 없는 재작업 재공품입니다.")
  const workOrderId = child.workOrderId

  // 작업지시 단위 직렬화: 같은 작업지시의 root/공정을 동시에 바꾸는 POP 실적·다른 재작업 종결과 충돌하지 않도록 root 를 잠근다.
  await tx.$queryRaw`SELECT id FROM "WipUnit" WHERE "workOrderId" = ${workOrderId} AND "parentWipUnitId" IS NULL AND "sourceProductionResultId" IS NULL FOR UPDATE`

  const claimed = await tx.wipUnit.updateMany({
    where: { id: child.id, status: WipUnitStatus.REWORK },
    data: { status: mergedQty > 0 ? WipUnitStatus.COMPLETED : WipUnitStatus.SCRAPPED },
  })
  if (claimed.count !== 1) throw new Error("이미 처리 중이거나 종결된 REWORK WipUnit입니다.")

  const movements: Prisma.WipMovementCreateManyInput[] = []
  if (scrapQty > 0) {
    movements.push({
      tenantId: child.tenantId,
      siteId: child.siteId,
      wipUnitId: child.id,
      relatedWipUnitId: child.parentWipUnitId,
      movementType: WipMovementType.SCRAP,
      fromOperationId: child.workOrderOperationId,
      toOperationId: child.workOrderOperationId,
      fromWorkCenterId: child.currentWorkCenterId,
      toWorkCenterId: child.currentWorkCenterId,
      qty: scrapQty,
      sourceType: "ReworkCompletion",
      sourceId: child.id,
      note: `재작업 후 폐기: ${scrapQty}`,
    })
  }

  if (mergedQty <= 0) {
    if (movements.length > 0) await tx.wipMovement.createMany({ data: movements })
    return { mode: "NONE", returnedToOperationSeq: null }
  }

  const ops = await tx.workOrderOperation.findMany({
    where: { workOrderId },
    select: {
      id: true,
      seq: true,
      status: true,
      plannedQty: true,
      completedQty: true,
      routingOperation: { select: { workCenterId: true } },
      assignments: { select: { id: true, status: true, assignedQty: true, completedQty: true } },
    },
    orderBy: { seq: "asc" },
  })
  const reworkOp = ops.find((op) => op.id === child.workOrderOperationId)
  const nextOp = reworkOp ? ops.find((op) => op.seq > reworkOp.seq) : undefined
  if (!reworkOp || !nextOp) throw new Error("재작업 복귀 대상 후속 공정을 찾을 수 없습니다.")

  const activeRoot = await findActiveWipUnitForWorkOrder(tx, { tenantId: child.tenantId, workOrderId })

  if (activeRoot) {
    // ── 방식 M: 활성 root 에 합산 ─────────────────────────────────────────────
    if (activeRoot.status === WipUnitStatus.ON_HOLD) {
      throw new Error("보류 중인 재공품이 있어 재작업을 종결할 수 없습니다. 보류를 해제한 후 다시 시도해 주세요.")
    }
    if (activeRoot.status !== WipUnitStatus.WAITING && activeRoot.status !== WipUnitStatus.IN_PROCESS) {
      throw new Error("현재 재공 상태에서는 재작업을 종결할 수 없습니다. 재공 상태를 확인해 주세요.")
    }
    const activeOp = ops.find((op) => op.id === activeRoot.workOrderOperationId)
    if (!activeOp || activeOp.seq > nextOp.seq || nextOp.status === OperationStatus.COMPLETED) {
      throw new Error(
        `주 생산 흐름이 이미 복귀 공정(${nextOp.seq})을 지나 진행 중이라 재작업 합격 수량을 복귀할 수 없습니다. 주 생산 흐름이 완료된 뒤 다시 종결해 주세요.`
      )
    }
    await tx.wipUnit.update({ where: { id: activeRoot.id }, data: { qty: { increment: mergedQty } } })
    movements.push({
      tenantId: child.tenantId,
      siteId: child.siteId,
      wipUnitId: activeRoot.id,
      relatedWipUnitId: child.id,
      movementType: WipMovementType.MERGE,
      fromOperationId: child.workOrderOperationId,
      toOperationId: nextOp.id,
      fromWorkCenterId: child.currentWorkCenterId,
      toWorkCenterId: nextOp.routingOperation.workCenterId,
      qty: mergedQty,
      sourceType: REWORK_RETURN_SOURCE.MERGE,
      sourceId: child.id,
      note: `재작업 합격 복귀: ${mergedQty} (공정 ${nextOp.seq} 부터 정상 흐름 합류)`,
    })
    await tx.wipMovement.createMany({ data: movements })
    return { mode: "MERGE", returnedToOperationSeq: nextOp.seq }
  }

  // ── 방식 R: 활성 root 없음(주 흐름 완료) → 복귀 root 생성 + 후속공정 재개 ─────────────────
  const reopenOps = ops.filter((op) => op.seq >= nextOp.seq)
  for (const op of reopenOps) {
    const remaining = Number(op.plannedQty) - Number(op.completedQty)
    if (remaining + EPS < mergedQty) {
      throw new Error(
        `공정 ${op.seq} 의 잔여 계획수량(${remaining})이 복귀 수량(${mergedQty})보다 적어 후속공정을 재개할 수 없습니다.`
      )
    }
  }

  const returnRoot = await tx.wipUnit.create({
    data: {
      tenantId: child.tenantId,
      siteId: child.siteId,
      workOrderId,
      workOrderOperationId: nextOp.id,
      itemId: child.itemId,
      manufacturingNo: child.manufacturingNo,
      currentWorkCenterId: nextOp.routingOperation.workCenterId,
      qty: mergedQty,
      status: WipUnitStatus.WAITING,
    },
  })

  for (const op of reopenOps) {
    if (op.status === OperationStatus.COMPLETED) {
      await tx.workOrderOperation.update({ where: { id: op.id }, data: { status: OperationStatus.PENDING } })
    }
    for (const assignment of op.assignments) {
      const needed = Number(assignment.completedQty) + mergedQty
      const reopen = assignment.status === OperationStatus.COMPLETED
      const widen = Number(assignment.assignedQty) + EPS < needed
      if (reopen || widen) {
        await tx.workOrderOperationAssignment.update({
          where: { id: assignment.id },
          data: {
            ...(reopen ? { status: OperationStatus.PENDING } : {}),
            ...(widen ? { assignedQty: needed } : {}),
          },
        })
      }
    }
  }

  const workOrder = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true, tenantId: true } })
  if (workOrder?.status === "COMPLETED") {
    await tx.workOrder.update({ where: { id: workOrderId }, data: { status: "IN_PROGRESS" } })
    await syncProductionPlanStatusForWorkOrder(tx, workOrderId, child.tenantId)
  }

  movements.push({
    tenantId: child.tenantId,
    siteId: child.siteId,
    wipUnitId: returnRoot.id,
    relatedWipUnitId: child.id,
    movementType: WipMovementType.MERGE,
    fromOperationId: child.workOrderOperationId,
    toOperationId: nextOp.id,
    fromWorkCenterId: child.currentWorkCenterId,
    toWorkCenterId: nextOp.routingOperation.workCenterId,
    qty: mergedQty,
    sourceType: REWORK_RETURN_SOURCE.RETURN_ROOT,
    sourceId: child.id,
    note: `재작업 합격 복귀: ${mergedQty} (공정 ${nextOp.seq} 부터 후속공정 재개)`,
  })
  await tx.wipMovement.createMany({ data: movements })
  return { mode: "REOPEN", returnedToOperationSeq: nextOp.seq }
}

export type CompleteReworkCoreInput = { reworkWipUnitId: string; mergedQty: number; scrapQty: number }

/**
 * 재작업 WipUnit 종결 본체(트랜잭션 안에서 호출). 재작업/보류관리 화면(completeRework)과 외주 재외주 검사(outsourcing)가 함께 쓴다.
 * 최종공정 재작업은 완료 root 에 복귀, 중간공정 재작업은 다음 공정부터 정상 흐름에 복귀(completeIntermediateRework).
 */
export async function completeReworkInTx(tx: ReworkReturnTx, input: CompleteReworkCoreInput): Promise<void> {
  const { reworkWipUnitId, mergedQty, scrapQty } = input
  if (
    !Number.isFinite(mergedQty) ||
    !Number.isFinite(scrapQty) ||
    mergedQty < 0 ||
    scrapQty < 0 ||
    mergedQty + scrapQty <= 0
  ) {
    throw new Error("복귀 수량과 폐기 수량을 올바르게 입력하세요.")
  }

  const child = await tx.wipUnit.findUnique({
    where: { id: reworkWipUnitId },
    include: {
      parentWipUnit: {
        select: {
          id: true,
          qty: true,
          status: true,
          parentWipUnitId: true,
          workOrderOperationId: true,
          currentWorkCenterId: true,
        },
      },
      workOrderOperation: {
        select: {
          id: true,
          workOrder: {
            select: {
              operations: {
                select: { id: true, seq: true },
                orderBy: { seq: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  })
  if (
    !child ||
    child.status !== WipUnitStatus.REWORK ||
    child.parentWipUnitId == null ||
    child.sourceProductionResultId == null
  ) {
    throw new Error("처리 가능한 REWORK WipUnit을 찾을 수 없습니다.")
  }

  const existingCompletion = await tx.wipMovement.findFirst({
    where: {
      sourceType: { in: ["ReworkCompletion", "ReworkMerge", "ReworkReturn"] },
      sourceId: child.id,
    },
    select: { id: true },
  })
  if (existingCompletion) {
    throw new Error("이미 종결 처리된 REWORK WipUnit입니다.")
  }

  const childQty = Number(child.qty)
  if (Math.abs(mergedQty + scrapQty - childQty) > 0.000001) {
    throw new Error(
      `복귀 수량과 폐기 수량의 합계는 재작업 수량(${childQty})과 같아야 합니다.`
    )
  }

  const lastOperation = child.workOrderOperation.workOrder.operations[0] ?? null
  if (!lastOperation) {
    throw new Error("작업지시 공정 정보를 확인할 수 없습니다.")
  }
  if (lastOperation.id !== child.workOrderOperationId) {
    // 중간공정 재작업(ISSUE-014): 합격 수량은 재작업 발생 공정 다음 공정부터 정상 흐름에 복귀하고, 폐기 수량은 이력으로 기록한다.
    await completeIntermediateRework(tx, { child, mergedQty, scrapQty })
    return
  }

  const parent = child.parentWipUnit
  if (
    !parent ||
    parent.parentWipUnitId != null ||
    parent.status !== WipUnitStatus.COMPLETED ||
    parent.workOrderOperationId !== child.workOrderOperationId
  ) {
    throw new Error("최종공정 완료 root WipUnit에만 재작업 수량을 복귀할 수 있습니다.")
  }

  const childStatus =
    mergedQty > 0 ? WipUnitStatus.COMPLETED : WipUnitStatus.SCRAPPED
  const claimed = await tx.wipUnit.updateMany({
    where: { id: child.id, status: WipUnitStatus.REWORK },
    data: { status: childStatus },
  })
  if (claimed.count !== 1) {
    throw new Error("이미 처리 중이거나 종결된 REWORK WipUnit입니다.")
  }

  if (mergedQty > 0) {
    await tx.wipUnit.update({
      where: { id: parent.id },
      data: { qty: { increment: mergedQty } },
    })
  }

  const movements = []
  if (mergedQty > 0) {
    movements.push({
      tenantId: child.tenantId,
      siteId: child.siteId,
      wipUnitId: parent.id,
      relatedWipUnitId: child.id,
      movementType: WipMovementType.MERGE,
      fromOperationId: child.workOrderOperationId,
      toOperationId: parent.workOrderOperationId,
      fromWorkCenterId: child.currentWorkCenterId,
      toWorkCenterId: parent.currentWorkCenterId,
      qty: mergedQty,
      sourceType: "ReworkCompletion",
      sourceId: child.id,
      note: `재작업 양품 복귀: ${mergedQty}`,
    })
  }
  if (scrapQty > 0) {
    movements.push({
      tenantId: child.tenantId,
      siteId: child.siteId,
      wipUnitId: child.id,
      relatedWipUnitId: parent.id,
      movementType: WipMovementType.SCRAP,
      fromOperationId: child.workOrderOperationId,
      toOperationId: child.workOrderOperationId,
      fromWorkCenterId: child.currentWorkCenterId,
      toWorkCenterId: child.currentWorkCenterId,
      qty: scrapQty,
      sourceType: "ReworkCompletion",
      sourceId: child.id,
      note: `재작업 후 폐기: ${scrapQty}`,
    })
  }
  await tx.wipMovement.createMany({
    data: movements,
  })
}
