"use server"

/**
 * POP 작업대기 화면의 "WIP QR 스캔으로 작업지시 찾기" 보조 조회 — 읽기 전용.
 *
 * 원칙
 *  - QR 에서 읽은 WIP 식별값은 신뢰할 수 없는 외부 입력이다. 로그인·tenant·작업장·WIP 존재·상태·작업지시를 서버가 확인한다.
 *  - 쓰기가 전혀 없다: 작업지시/공정/WIP/실적/재고를 바꾸지 않는다. 작업 시작·실적 등록은 기존 POP 액션(startOperation,
 *    submitProductionResult)이 사용자의 버튼 클릭으로만 수행한다.
 *  - 접근 기준은 기존 POP 작업대기(getPopWorkQueueRows)와 같다: POP 작업자 세션, 없으면 관리자 세션(OPERATOR 이상).
 *    POP 작업자 세션에 사업장이 있으면 기존 POP 과 같이 다른 작업장의 작업지시는 거부한다.
 *  - WIP 는 정확히 그 WipUnit 만 본다. 하위 WIP 는 다른 WIP(원본)로 바꿔 고르지 않고 안내만 한다.
 *  - 없는 WIP 와 다른 tenant 의 WIP 는 같은 응답이다(존재 여부 비노출).
 *  - WIP 라벨 발행 조건(자재출고 완료)은 쓰지 않는다 — lib/pop/wip-scan.ts 참고.
 */

import { prisma } from "@/lib/db/prisma"
import { requireRole } from "@/lib/auth"
import { getPopWorkerSession } from "@/lib/auth/pop-worker-session"
import { judgePopWipScan, popWipStatusLabel, POP_WIP_LOOKUP_MESSAGES, type PopWipLookupFailCode } from "@/lib/pop/wip-scan"

export type PopWipLookupResult =
  | {
      ok: true
      wipUnitId: string
      wipStatus: string
      wipStatusLabel: string
      wipQty: number
      manufacturingNo: string | null
      workOrderId: string
      orderNo: string
      itemCode: string
      itemName: string
      /** WIP 가 있는 현재 공정(표시용) */
      operationLabel: string | null
      /** 보류 등 작업자가 알아야 하는 상태 안내 */
      notice: string | null
    }
  | { ok: false; code: PopWipLookupFailCode; message: string }

function fail(code: PopWipLookupFailCode): PopWipLookupResult {
  return { ok: false, code, message: POP_WIP_LOOKUP_MESSAGES[code] }
}

/** 기존 POP(resolvePopAuthContext)과 같은 순서: POP 작업자 세션 → 관리자 세션(OPERATOR 이상). tenant 는 항상 세션 값이다. */
async function resolvePopReader(): Promise<{ tenantId: string; siteId: string | null } | { code: "UNAUTHORIZED" | "DENIED" }> {
  const worker = await getPopWorkerSession()
  if (worker) return { tenantId: worker.tenantId, siteId: worker.siteId }
  try {
    const user = await requireRole("OPERATOR")
    return { tenantId: user.tenantId, siteId: null }
  } catch (error) {
    return { code: error instanceof Error && error.message === "FORBIDDEN" ? "DENIED" : "UNAUTHORIZED" }
  }
}

export async function lookupWipForPop(input: { wipUnitId: string }): Promise<PopWipLookupResult> {
  const reader = await resolvePopReader()
  if ("code" in reader) return fail(reader.code)

  const wipUnitId = typeof input?.wipUnitId === "string" ? input.wipUnitId.trim() : ""
  if (!wipUnitId || wipUnitId.length > 128) return fail("INVALID")

  const wip = await prisma.wipUnit.findFirst({
    where: { id: wipUnitId, tenantId: reader.tenantId },
    select: {
      id: true,
      status: true,
      qty: true,
      manufacturingNo: true,
      parentWipUnitId: true,
      sourceProductionResultId: true,
      workOrderId: true,
      workOrderOperation: { select: { seq: true, routingOperation: { select: { name: true } } } },
      workOrder: { select: { id: true, orderNo: true, status: true, siteId: true, manufacturingNo: true, item: { select: { code: true, name: true } } } },
    },
  })
  if (!wip) return fail("WIP_NOT_FOUND")

  // 원본 WIP 개수와 작업대기에 나오는 공정 수는 판정에 필요할 때만 조회한다(읽기 전용).
  const needsCounts = Boolean(wip.workOrder) && wip.parentWipUnitId === null && wip.sourceProductionResultId === null && wip.status !== "SCRAPPED" && wip.status !== "COMPLETED"
  const [rootCount, openOperationCount] =
    needsCounts && wip.workOrderId
      ? await Promise.all([
          prisma.wipUnit.count({ where: { tenantId: reader.tenantId, workOrderId: wip.workOrderId, parentWipUnitId: null, sourceProductionResultId: null } }),
          prisma.workOrderOperation.count({ where: { workOrderId: wip.workOrderId, status: { in: ["PENDING", "IN_PROGRESS"] }, workOrder: { tenantId: reader.tenantId } } }),
        ])
      : [0, 0]

  const judgement = judgePopWipScan({
    wip: {
      status: String(wip.status),
      parentWipUnitId: wip.parentWipUnitId,
      sourceProductionResultId: wip.sourceProductionResultId,
      workOrder: wip.workOrder ? { status: String(wip.workOrder.status), siteId: wip.workOrder.siteId } : null,
    },
    rootCount,
    openOperationCount,
    workerSiteId: reader.siteId,
  })
  if (!judgement.ok) return fail(judgement.code)
  if (!wip.workOrder) return fail("NO_WORK_ORDER") // judgePopWipScan 이 이미 걸러내지만 타입 좁히기용

  return {
    ok: true,
    wipUnitId: wip.id,
    wipStatus: String(wip.status),
    wipStatusLabel: popWipStatusLabel(String(wip.status)),
    wipQty: Number(wip.qty),
    manufacturingNo: wip.manufacturingNo ?? wip.workOrder.manufacturingNo ?? null,
    workOrderId: wip.workOrder.id,
    orderNo: wip.workOrder.orderNo,
    itemCode: wip.workOrder.item.code,
    itemName: wip.workOrder.item.name,
    operationLabel: wip.workOrderOperation ? `${wip.workOrderOperation.seq}. ${wip.workOrderOperation.routingOperation.name}` : null,
    notice: judgement.notice,
  }
}
