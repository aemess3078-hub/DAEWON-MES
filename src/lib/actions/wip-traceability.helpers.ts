import { Prisma, WipMovementType, WipUnitStatus } from "@prisma/client"

// pop.actions.ts 트랜잭션 내부에서만 호출되는 내부 헬퍼.
// 직접 호출되는 Server Action이 아니므로 "use server" 미사용.

export type WipTraceabilityTx = Prisma.TransactionClient
type WipUnitLookupClient = Pick<Prisma.TransactionClient, "wipUnit">

// production-progress.service.ts(생산진행 현황 집계)에서도 "활성 재공" 정의를
// 동일하게 재사용하기 위해 export한다. 값 자체는 변경하지 않음.
export const REUSABLE_WIP_STATUSES: WipUnitStatus[] = [
  WipUnitStatus.WAITING,
  WipUnitStatus.IN_PROCESS,
  WipUnitStatus.ON_HOLD,
  WipUnitStatus.OUTSOURCED,
  WipUnitStatus.IN_TRANSIT,
  WipUnitStatus.RECEIVED,
  WipUnitStatus.REWORK,
]

export async function findActiveWipUnitForWorkOrder(
  tx: WipUnitLookupClient,
  params: { tenantId: string; workOrderId: string }
) {
  return tx.wipUnit.findFirst({
    where: {
      tenantId: params.tenantId,
      workOrderId: params.workOrderId,
      parentWipUnitId: null,
      sourceProductionResultId: null,
      status: { in: REUSABLE_WIP_STATUSES },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  })
}

// 재작업/보류관리(wip-hold.actions.ts) 방어: ON_HOLD는 REUSABLE_WIP_STATUSES에 포함되어
// findActiveWipUnitForWorkOrder가 여전히 찾아내므로(생산현황/재공 집계에서 "활성 WIP"로
// 계속 표시하려는 기존 의도는 유지), WIP 상태를 실제로 전진시키는 지점마다 개별적으로
// 보류를 차단해야 한다. 중복 코드 없이 한 곳에서 관리하기 위한 공용 가드.
export function assertWipUnitNotOnHold(status: WipUnitStatus, message: string): void {
  if (status === WipUnitStatus.ON_HOLD) {
    throw new Error(message)
  }
}

export async function transitionWipUnitOnStart(
  tx: WipTraceabilityTx,
  params: {
    tenantId: string
    siteId: string | null
    workOrderId: string
    operationId: string
    workCenterId: string | null
    createdById?: string | null
  }
): Promise<void> {
  const wipUnit = await findActiveWipUnitForWorkOrder(tx, {
    tenantId: params.tenantId,
    workOrderId: params.workOrderId,
  })

  if (!wipUnit) {
    console.warn(
      `[wip-traceability] WipUnit not found for workOrderId=${params.workOrderId} on startOperation, skipping WIP sync`
    )
    return
  }

  assertWipUnitNotOnHold(
    wipUnit.status,
    "보류 중인 재공품입니다. 재작업/보류관리에서 보류를 해제한 후 작업을 시작해 주세요."
  )

  // 멱등 처리: 이미 같은 공정에서 IN_PROCESS면 추가 기록 없음
  if (
    wipUnit.status === WipUnitStatus.IN_PROCESS &&
    wipUnit.workOrderOperationId === params.operationId
  ) {
    return
  }

  await tx.wipUnit.update({
    where: { id: wipUnit.id },
    data: {
      status: WipUnitStatus.IN_PROCESS,
      workOrderOperationId: params.operationId,
      currentWorkCenterId: params.workCenterId,
    },
  })

  await tx.wipMovement.create({
    data: {
      tenantId: params.tenantId,
      siteId: params.siteId,
      wipUnitId: wipUnit.id,
      movementType: "STARTED",
      fromOperationId: null,
      toOperationId: params.operationId,
      fromWorkCenterId: null,
      toWorkCenterId: params.workCenterId,
      qty: wipUnit.qty,
      sourceType: "WorkOrderOperation",
      sourceId: params.operationId,
      note: "POP 작업시작",
      createdById: params.createdById ?? null,
    },
  })
}

export async function advanceWipUnitOnOperationComplete(
  tx: WipTraceabilityTx,
  params: {
    tenantId: string
    siteId: string | null
    workOrderId: string
    completedOperationId: string
    completedWorkCenterId: string | null
    nextOperation: {
      id: string
      routingOperation: { workCenterId: string }
    } | null
    productionResultId: string
    createdById?: string | null
  }
): Promise<void> {
  const wipUnit = await findActiveWipUnitForWorkOrder(tx, {
    tenantId: params.tenantId,
    workOrderId: params.workOrderId,
  })

  if (!wipUnit) {
    console.warn(
      `[wip-traceability] WipUnit not found for workOrderId=${params.workOrderId} on operation complete, skipping WIP sync`
    )
    return
  }

  // defense-in-depth: submitProductionResult가 이미 rootWip.status===ON_HOLD를 사전 차단하지만,
  // 이 헬퍼가 향후 다른 경로에서 호출되더라도 ON_HOLD를 WAITING/COMPLETED로 덮어쓰지 않도록 재확인한다.
  assertWipUnitNotOnHold(
    wipUnit.status,
    "보류 중인 재공품입니다. 재작업/보류관리에서 보류를 해제한 후 공정을 진행해 주세요."
  )

  const wipQty = Number(wipUnit.qty)
  if (wipQty <= 0) {
    await tx.wipUnit.update({
      where: { id: wipUnit.id },
      data: { status: WipUnitStatus.COMPLETED },
    })

    await tx.wipMovement.create({
      data: {
        tenantId: params.tenantId,
        siteId: params.siteId,
        wipUnitId: wipUnit.id,
        movementType: "COMPLETED",
        fromOperationId: params.completedOperationId,
        toOperationId: null,
        fromWorkCenterId: params.completedWorkCenterId,
        toWorkCenterId: null,
        qty: 0,
        sourceType: "ProductionResult",
        sourceId: params.productionResultId,
        note: "SCRAP 차감 후 이동 가능 수량이 0이므로 공정 이동 생략",
        createdById: params.createdById ?? null,
      },
    })
    return
  }

  if (params.nextOperation) {
    await tx.wipUnit.update({
      where: { id: wipUnit.id },
      data: {
        status: WipUnitStatus.WAITING,
        workOrderOperationId: params.nextOperation.id,
        currentWorkCenterId: params.nextOperation.routingOperation.workCenterId,
      },
    })

    await tx.wipMovement.create({
      data: {
        tenantId: params.tenantId,
        siteId: params.siteId,
        wipUnitId: wipUnit.id,
        movementType: "MOVED",
        fromOperationId: params.completedOperationId,
        toOperationId: params.nextOperation.id,
        fromWorkCenterId: params.completedWorkCenterId,
        toWorkCenterId: params.nextOperation.routingOperation.workCenterId,
        qty: wipQty,
        sourceType: "ProductionResult",
        sourceId: params.productionResultId,
        note: "공정 완료에 따른 이동",
        createdById: params.createdById ?? null,
      },
    })
    return
  }

  // 마지막 공정 완료: workOrderOperationId/currentWorkCenterId는 그대로 유지하고 status만 COMPLETED
  await tx.wipUnit.update({
    where: { id: wipUnit.id },
    data: {
      status: WipUnitStatus.COMPLETED,
    },
  })

  await tx.wipMovement.create({
    data: {
      tenantId: params.tenantId,
      siteId: params.siteId,
      wipUnitId: wipUnit.id,
      movementType: "COMPLETED",
      fromOperationId: params.completedOperationId,
      toOperationId: null,
      fromWorkCenterId: params.completedWorkCenterId,
      toWorkCenterId: null,
      qty: wipQty,
      sourceType: "ProductionResult",
      sourceId: params.productionResultId,
      note: "마지막 공정 완료",
      createdById: params.createdById ?? null,
    },
  })
}

export async function recordProductionResultQualityMovements(
  tx: WipTraceabilityTx,
  params: {
    tenantId: string
    siteId: string | null
    workOrderId: string
    operationId: string
    workCenterId: string | null
    productionResultId: string
    defectQty: number
    reworkQty: number
    createdById?: string | null
  }
): Promise<void> {
  if (params.defectQty <= 0 && params.reworkQty <= 0) return

  const wipUnit = await findActiveWipUnitForWorkOrder(tx, {
    tenantId: params.tenantId,
    workOrderId: params.workOrderId,
  })

  if (!wipUnit) {
    if (params.defectQty > 0) {
      throw new Error(
        `SCRAP 처리 대상 WipUnit을 찾을 수 없습니다. workOrderId=${params.workOrderId}`
      )
    }

    console.warn(
      `[wip-traceability] WipUnit not found for workOrderId=${params.workOrderId} on production result quality movement, skipping WIP movement sync`
    )
    return
  }

  // defense-in-depth: submitProductionResult가 이미 rootWip.status===ON_HOLD를 사전 차단하지만,
  // 이 헬퍼가 향후 다른 경로에서 호출되더라도 보류 중 WIP의 수량을 분리/차감하지 않도록 재확인한다.
  assertWipUnitNotOnHold(
    wipUnit.status,
    "보류 중인 재공품입니다. 재작업/보류관리에서 보류를 해제한 후 실적을 등록해 주세요."
  )

  const existingMovements = await tx.wipMovement.findMany({
    where: {
      tenantId: params.tenantId,
      sourceType: "ProductionResult",
      sourceId: params.productionResultId,
    },
    select: { movementType: true },
  })
  const existingMovementTypes = new Set(existingMovements.map((m) => m.movementType))
  const existingChildWipUnits = await tx.wipUnit.findMany({
    where: {
      tenantId: params.tenantId,
      parentWipUnitId: wipUnit.id,
      sourceProductionResultId: params.productionResultId,
      status: { in: [WipUnitStatus.SCRAPPED, WipUnitStatus.REWORK] },
    },
    select: { id: true, status: true },
  })
  let scrappedChildWipUnit =
    existingChildWipUnits.find((child) => child.status === WipUnitStatus.SCRAPPED) ?? null
  let reworkChildWipUnit =
    existingChildWipUnits.find((child) => child.status === WipUnitStatus.REWORK) ?? null
  const hasScrapSplit =
    existingMovementTypes.has(WipMovementType.SCRAP) || scrappedChildWipUnit !== null
  const hasReworkSplit =
    existingMovementTypes.has(WipMovementType.REWORK) || reworkChildWipUnit !== null
  const defectQtyToSeparate =
    params.defectQty > 0 && !hasScrapSplit ? params.defectQty : 0
  const reworkQtyToSeparate =
    params.reworkQty > 0 && !hasReworkSplit ? params.reworkQty : 0
  const totalSeparatedQty = defectQtyToSeparate + reworkQtyToSeparate

  if (totalSeparatedQty > 0) {
    const rootQty = Number(wipUnit.qty)
    if (!Number.isFinite(rootQty)) {
      throw new Error(`WipUnit 수량을 확인할 수 없습니다. wipUnitId=${wipUnit.id}`)
    }

    if (totalSeparatedQty > rootQty) {
      throw new Error(
        `분리 수량(${totalSeparatedQty})이 이동 가능 WIP 수량(${rootQty})을 초과합니다.`
      )
    }

    if (defectQtyToSeparate > 0) {
      scrappedChildWipUnit = await tx.wipUnit.create({
        data: {
          tenantId: wipUnit.tenantId,
          siteId: wipUnit.siteId,
          workOrderId: wipUnit.workOrderId,
          workOrderOperationId: params.operationId,
          itemId: wipUnit.itemId,
          lotId: wipUnit.lotId,
          manufacturingNo: wipUnit.manufacturingNo,
          currentWorkCenterId: params.workCenterId ?? wipUnit.currentWorkCenterId,
          currentWarehouseId: wipUnit.currentWarehouseId,
          currentLocationId: wipUnit.currentLocationId,
          outsourcingPartnerId: wipUnit.outsourcingPartnerId,
          sourceProductionResultId: params.productionResultId,
          parentWipUnitId: wipUnit.id,
          qty: defectQtyToSeparate,
          status: WipUnitStatus.SCRAPPED,
        },
      })
    }

    if (reworkQtyToSeparate > 0) {
      reworkChildWipUnit = await tx.wipUnit.create({
        data: {
          tenantId: wipUnit.tenantId,
          siteId: wipUnit.siteId,
          workOrderId: wipUnit.workOrderId,
          workOrderOperationId: params.operationId,
          itemId: wipUnit.itemId,
          lotId: wipUnit.lotId,
          manufacturingNo: wipUnit.manufacturingNo,
          currentWorkCenterId: params.workCenterId ?? wipUnit.currentWorkCenterId,
          currentWarehouseId: wipUnit.currentWarehouseId,
          currentLocationId: wipUnit.currentLocationId,
          outsourcingPartnerId: wipUnit.outsourcingPartnerId,
          sourceProductionResultId: params.productionResultId,
          parentWipUnitId: wipUnit.id,
          qty: reworkQtyToSeparate,
          status: WipUnitStatus.REWORK,
        },
      })
    }

    await tx.wipUnit.update({
      where: { id: wipUnit.id },
      data: { qty: rootQty - totalSeparatedQty },
    })
  }

  // Split children remove quality-held quantities from the root good-flow quantity.
  const movements: Prisma.WipMovementCreateManyInput[] = []

  if (params.defectQty > 0 && !existingMovementTypes.has(WipMovementType.DEFECT)) {
    movements.push({
      tenantId: params.tenantId,
      siteId: params.siteId,
      wipUnitId: wipUnit.id,
      movementType: WipMovementType.DEFECT,
      fromOperationId: params.operationId,
      toOperationId: params.operationId,
      fromWorkCenterId: params.workCenterId,
      toWorkCenterId: params.workCenterId,
      qty: params.defectQty,
      sourceType: "ProductionResult",
      sourceId: params.productionResultId,
      note: `POP 실적 등록 불량 수량 기록 (defectQty=${params.defectQty})`,
      createdById: params.createdById ?? null,
    })
  }

  if (params.reworkQty > 0 && !existingMovementTypes.has(WipMovementType.REWORK)) {
    movements.push({
      tenantId: params.tenantId,
      siteId: params.siteId,
      wipUnitId: wipUnit.id,
      movementType: WipMovementType.REWORK,
      fromOperationId: params.operationId,
      toOperationId: params.operationId,
      fromWorkCenterId: params.workCenterId,
      toWorkCenterId: params.workCenterId,
      qty: params.reworkQty,
      sourceType: "ProductionResult",
      sourceId: params.productionResultId,
      relatedWipUnitId: reworkChildWipUnit?.id ?? null,
      note: `POP 실적 등록 재작업 수량 기록 (reworkQty=${params.reworkQty})`,
      createdById: params.createdById ?? null,
    })
  }

  if (defectQtyToSeparate > 0 && scrappedChildWipUnit) {
    movements.push(
      {
        tenantId: params.tenantId,
        siteId: params.siteId,
        wipUnitId: wipUnit.id,
        relatedWipUnitId: scrappedChildWipUnit.id,
        movementType: WipMovementType.SPLIT,
        fromOperationId: params.operationId,
        toOperationId: params.operationId,
        fromWorkCenterId: params.workCenterId,
        toWorkCenterId: params.workCenterId,
        qty: defectQtyToSeparate,
        sourceType: "ProductionResult",
        sourceId: params.productionResultId,
        note: `POP 불량 수량 SCRAP 분리 (defectQty=${params.defectQty})`,
        createdById: params.createdById ?? null,
      },
      {
        tenantId: params.tenantId,
        siteId: params.siteId,
        wipUnitId: scrappedChildWipUnit.id,
        relatedWipUnitId: wipUnit.id,
        movementType: WipMovementType.SCRAP,
        fromOperationId: params.operationId,
        toOperationId: params.operationId,
        fromWorkCenterId: params.workCenterId,
        toWorkCenterId: params.workCenterId,
        qty: defectQtyToSeparate,
        sourceType: "ProductionResult",
        sourceId: params.productionResultId,
        note: `POP 불량 수량 자동 폐기 처리 (defectQty=${params.defectQty})`,
        createdById: params.createdById ?? null,
      }
    )
  }

  if (reworkQtyToSeparate > 0 && reworkChildWipUnit) {
    movements.push({
      tenantId: params.tenantId,
      siteId: params.siteId,
      wipUnitId: wipUnit.id,
      relatedWipUnitId: reworkChildWipUnit.id,
      movementType: WipMovementType.SPLIT,
      fromOperationId: params.operationId,
      toOperationId: params.operationId,
      fromWorkCenterId: params.workCenterId,
      toWorkCenterId: params.workCenterId,
      qty: reworkQtyToSeparate,
      sourceType: "ProductionResult",
      sourceId: params.productionResultId,
      note: `POP 재작업 수량 분리 (reworkQty=${params.reworkQty})`,
      createdById: params.createdById ?? null,
    })
  }

  if (movements.length > 0) {
    await tx.wipMovement.createMany({ data: movements })
  }
}
