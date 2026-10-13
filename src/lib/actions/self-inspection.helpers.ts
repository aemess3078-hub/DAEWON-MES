import { InspectionResult, InspectionStage, Prisma } from "@prisma/client"

// pop.actions.ts 트랜잭션 내부에서만 호출되는 내부 헬퍼.
// 직접 호출되는 Server Action이 아니므로 "use server" 미사용.
//
// POP 작업모드에서 입력한 불량(자주검사 결과)을 QualityInspection + DefectRecord로
// 자동 기록해 불량통계(자주검사) 화면에 반영한다.

export type SelfInspectionTx = Prisma.TransactionClient

export type SelfInspectionDefectDetail = {
  defectCodeId: string
  qty: number
}

/**
 * POP 자주검사용 InspectionSpec을 조회한다.
 * 1) 해당 (품목 + 공정) 정확 매칭 ACTIVE 스펙
 * 2) 해당 품목의 ACTIVE 스펙(공정 무관)
 * 3) 테넌트의 임의 ACTIVE 스펙
 * 모두 없으면 null. (호출부에서 명확한 에러 처리)
 */
async function resolveSelfInspectionSpecId(
  tx: SelfInspectionTx,
  params: { tenantId: string; itemId: string; routingOperationId: string }
): Promise<string | null> {
  const exact = await tx.inspectionSpec.findFirst({
    where: {
      tenantId: params.tenantId,
      itemId: params.itemId,
      routingOperationId: params.routingOperationId,
      status: "ACTIVE",
    },
    orderBy: { version: "desc" },
    select: { id: true },
  })
  if (exact) return exact.id

  const byItem = await tx.inspectionSpec.findFirst({
    where: {
      tenantId: params.tenantId,
      itemId: params.itemId,
      status: "ACTIVE",
    },
    orderBy: [{ updatedAt: "desc" }, { version: "desc" }],
    select: { id: true },
  })
  if (byItem) return byItem.id

  const anySpec = await tx.inspectionSpec.findFirst({
    where: { tenantId: params.tenantId, status: "ACTIVE" },
    orderBy: [{ updatedAt: "desc" }, { version: "desc" }],
    select: { id: true },
  })
  return anySpec?.id ?? null
}

/**
 * POP 불량 입력을 자주검사(QualityInspection) + 불량내역(DefectRecord)으로 기록한다.
 * defectDetails 합계 = defectQty 검증은 호출부(submitProductionResult)에서 이미 수행된 전제.
 */
export async function recordSelfInspectionDefects(
  tx: SelfInspectionTx,
  params: {
    tenantId: string
    workOrderOperationId: string
    itemId: string
    routingOperationId: string
    inspectorProfileId: string
    inspectedQty: number
    defectDetails: SelfInspectionDefectDetail[]
  }
): Promise<void> {
  if (params.defectDetails.length === 0) return

  // 불량코드 테넌트 소속 검증
  const codeIds = params.defectDetails.map((d) => d.defectCodeId)
  const validCodes = await tx.defectCode.findMany({
    where: { tenantId: params.tenantId, id: { in: codeIds } },
    select: { id: true },
  })
  const validCodeIds = new Set(validCodes.map((c) => c.id))
  const invalid = codeIds.find((id) => !validCodeIds.has(id))
  if (invalid) {
    throw new Error("선택한 불량코드를 찾을 수 없습니다. 불량관리에서 등록된 코드를 사용해 주세요.")
  }

  const inspectionSpecId = await resolveSelfInspectionSpecId(tx, {
    tenantId: params.tenantId,
    itemId: params.itemId,
    routingOperationId: params.routingOperationId,
  })
  if (!inspectionSpecId) {
    throw new Error(
      "POP 자주검사를 위한 검사표준이 없습니다. 검사표준관리에서 해당 품목의 검사표준을 먼저 등록해 주세요."
    )
  }

  const inspection = await tx.qualityInspection.create({
    data: {
      workOrderOperationId: params.workOrderOperationId,
      inspectionSpecId,
      inspectorId: params.inspectorProfileId,
      stage: InspectionStage.MID,
      result: InspectionResult.FAIL,
      inspectedQty: params.inspectedQty,
    },
  })

  await tx.defectRecord.createMany({
    data: params.defectDetails.map((d) => ({
      qualityInspectionId: inspection.id,
      defectCodeId: d.defectCodeId,
      qty: d.qty,
      // POP 불량은 자동 폐기(SCRAP) 처리되므로 처분 구분도 SCRAP로 기록
      disposition: "SCRAP" as const,
    })),
  })
}
