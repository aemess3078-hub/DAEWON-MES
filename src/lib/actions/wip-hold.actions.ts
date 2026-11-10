"use server"

import { prisma } from "@/lib/db/prisma"
import { WipUnitStatus, WipHoldStatus, WipMovementType } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { getErrorMessage } from "@/lib/utils"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

// ─── 청운커팅 사업계획서 "재작업/보류관리" — 보류(ON_HOLD) 조회/등록/수정/해제/취소 ──────
//
// REWORK(불량 재작업, process-progress.actions.ts)와는 완전히 별개 흐름이다.
// dispositionDefects/completeRework의 책임(재작업 종결)은 이 파일에서 절대 건드리지 않는다.
//
// 보류 대상: WipUnitStatus.WAITING / IN_PROCESS 인 work order 연결 WipUnit만 허용한다.
// COMPLETED/SCRAPPED/REWORK/ON_HOLD 상태는 보류 후보에서 제외한다(§5 참고).

const HOLDABLE_STATUSES: WipUnitStatus[] = [WipUnitStatus.WAITING, WipUnitStatus.IN_PROCESS]
const MENU_NAME = "재작업/보류관리"
const REASON_MAX_LENGTH = 500

function revalidateHoldPaths() {
  revalidatePath("/app/mes/rework")
  revalidatePath("/app/mes/production/wip-inventory")
  revalidatePath("/app/mes/production-progress")
  revalidatePath("/app/mes/traceability")
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type HoldableWipRow = {
  id: string
  status: WipUnitStatus
  qty: number
  manufacturingNo: string | null
  workOrder: {
    id: string
    orderNo: string
    item: { id: string; code: string; name: string }
  }
  routingOperation: {
    name: string
    seq: number
    workCenter: { name: string } | null
  }
}

export type WipHoldRow = {
  id: string
  status: WipHoldStatus
  previousStatus: WipUnitStatus
  reason: string
  note: string | null
  heldAt: Date
  heldByName: string | null
  releasedAt: Date | null
  releasedByName: string | null
  releaseNote: string | null
  cancelledAt: Date | null
  cancelledByName: string | null
  cancelNote: string | null
  wipUnit: {
    id: string
    qty: number
    status: WipUnitStatus
    manufacturingNo: string | null
    workOrder: {
      id: string
      orderNo: string
      item: { id: string; code: string; name: string }
    } | null
    routingOperation: {
      name: string
      seq: number
      workCenter: { name: string } | null
    }
  }
}

// ─── 조회: 보류 가능한 WIP 목록 (보류 등록 다이얼로그의 대상 선택용) ───────────────────
//
// 보류 Tab은 필터를 바꿀 때마다 클라이언트 컴포넌트에서 이 조회 액션을 다시 호출한다.
// 클라이언트가 넘긴 tenantId를 신뢰하지 않기 위해(§13) 파라미터로 받지 않고 세션에서 직접 구한다.

export async function getHoldableWipUnits(): Promise<HoldableWipRow[]> {
  const tenantId = await getTenantId()
  const units = await prisma.wipUnit.findMany({
    where: {
      tenantId,
      status: { in: HOLDABLE_STATUSES },
      workOrderId: { not: null },
    },
    include: {
      workOrder: {
        select: { id: true, orderNo: true, item: { select: { id: true, code: true, name: true } } },
      },
      workOrderOperation: {
        include: { routingOperation: { include: { workCenter: { select: { name: true } } } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  })

  return units
    .filter((u): u is typeof u & { workOrder: NonNullable<typeof u.workOrder> } => u.workOrder != null)
    .map((u) => ({
      id: u.id,
      status: u.status,
      qty: Number(u.qty),
      manufacturingNo: u.manufacturingNo,
      workOrder: {
        id: u.workOrder.id,
        orderNo: u.workOrder.orderNo,
        item: u.workOrder.item,
      },
      routingOperation: {
        name: u.workOrderOperation.routingOperation.name,
        seq: u.workOrderOperation.routingOperation.seq,
        workCenter: u.workOrderOperation.routingOperation.workCenter,
      },
    }))
}

// ─── 조회: 보류 목록/이력 (기본 ACTIVE만, 필터로 해제/취소 포함 조회 가능) ─────────────

export type HoldStatusFilter = "ACTIVE" | "RELEASED" | "CANCELLED" | "ALL"

export async function getHolds(statusFilter: HoldStatusFilter = "ACTIVE"): Promise<WipHoldRow[]> {
  const tenantId = await getTenantId()
  const holds = await prisma.wipHold.findMany({
    where: {
      tenantId,
      ...(statusFilter === "ALL" ? {} : { status: statusFilter }),
    },
    include: {
      wipUnit: {
        select: {
          id: true,
          qty: true,
          status: true,
          manufacturingNo: true,
          workOrder: {
            select: { id: true, orderNo: true, item: { select: { id: true, code: true, name: true } } },
          },
          workOrderOperation: {
            select: {
              routingOperation: {
                select: { name: true, seq: true, workCenter: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { heldAt: "desc" },
  })

  return holds.map((h) => ({
    id: h.id,
    status: h.status,
    previousStatus: h.previousStatus,
    reason: h.reason,
    note: h.note,
    heldAt: h.heldAt,
    heldByName: h.heldByName,
    releasedAt: h.releasedAt,
    releasedByName: h.releasedByName,
    releaseNote: h.releaseNote,
    cancelledAt: h.cancelledAt,
    cancelledByName: h.cancelledByName,
    cancelNote: h.cancelNote,
    wipUnit: {
      id: h.wipUnit.id,
      qty: Number(h.wipUnit.qty),
      status: h.wipUnit.status,
      manufacturingNo: h.wipUnit.manufacturingNo,
      workOrder: h.wipUnit.workOrder,
      routingOperation: {
        name: h.wipUnit.workOrderOperation.routingOperation.name,
        seq: h.wipUnit.workOrderOperation.routingOperation.seq,
        workCenter: h.wipUnit.workOrderOperation.routingOperation.workCenter,
      },
    },
  }))
}

// ─── 보류 등록 ──────────────────────────────────────────────────────────────────

export type CreateHoldInput = {
  wipUnitId: string
  reason: string
  note?: string | null
}

export async function createHold(
  input: CreateHoldInput
): Promise<{ ok: boolean; error?: string; holdId?: string }> {
  await requireResourcePermission("WORK_RESULT", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const reason = input.reason?.trim() ?? ""
    if (!reason) throw new Error("보류 사유를 입력해 주세요.")
    if (reason.length > REASON_MAX_LENGTH) throw new Error(`보류 사유는 ${REASON_MAX_LENGTH}자 이내로 입력해 주세요.`)
    const note = input.note?.trim() || null

    let holdId = ""

    await prisma.$transaction(async (tx) => {
      const wipUnit = await tx.wipUnit.findFirst({
        where: { id: input.wipUnitId, tenantId, workOrderId: { not: null } },
        select: {
          id: true,
          siteId: true,
          status: true,
          qty: true,
          workOrderOperationId: true,
          currentWorkCenterId: true,
        },
      })
      if (!wipUnit) throw new Error("재공품(WIP)을 찾을 수 없습니다.")

      const previousStatus = wipUnit.status
      if (!HOLDABLE_STATUSES.includes(previousStatus)) {
        throw new Error(
          previousStatus === WipUnitStatus.ON_HOLD
            ? "이미 보류 중인 재공품입니다."
            : "정상 진행 중이거나 대기 중인 재공품만 보류할 수 있습니다."
        )
      }

      // completeRework와 동일한 동시성 방어 패턴: 조건부 updateMany 후 count로 확정.
      const claimed = await tx.wipUnit.updateMany({
        where: { id: wipUnit.id, tenantId, status: previousStatus },
        data: { status: WipUnitStatus.ON_HOLD },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      const hold = await tx.wipHold.create({
        data: {
          tenantId,
          siteId: wipUnit.siteId,
          wipUnitId: wipUnit.id,
          previousStatus,
          status: WipHoldStatus.ACTIVE,
          reason,
          note,
          heldById: actor.id,
          heldByName: actor.name,
        },
      })
      holdId = hold.id

      await tx.wipMovement.create({
        data: {
          tenantId,
          siteId: wipUnit.siteId,
          wipUnitId: wipUnit.id,
          movementType: WipMovementType.HOLD,
          fromOperationId: wipUnit.workOrderOperationId,
          toOperationId: wipUnit.workOrderOperationId,
          fromWorkCenterId: wipUnit.currentWorkCenterId,
          toWorkCenterId: wipUnit.currentWorkCenterId,
          qty: wipUnit.qty,
          sourceType: "WipHold",
          sourceId: hold.id,
          note: `보류 등록: ${reason}`,
          createdById: actor.id,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "WipHold",
          entityId: hold.id,
          action: "CREATE",
          afterData: { wipUnitId: wipUnit.id, previousStatus, reason, note },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateHoldPaths()
    return { ok: true, holdId }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 보류 수정 (사유/메모, ACTIVE 건만) ───────────────────────────────────────────

export type UpdateHoldInput = {
  holdId: string
  reason: string
  note?: string | null
}

export async function updateHold(input: UpdateHoldInput): Promise<{ ok: boolean; error?: string }> {
  await requireResourcePermission("WORK_RESULT", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const reason = input.reason?.trim() ?? ""
    if (!reason) throw new Error("보류 사유를 입력해 주세요.")
    if (reason.length > REASON_MAX_LENGTH) throw new Error(`보류 사유는 ${REASON_MAX_LENGTH}자 이내로 입력해 주세요.`)
    const note = input.note?.trim() || null

    await prisma.$transaction(async (tx) => {
      const hold = await tx.wipHold.findFirst({
        where: { id: input.holdId, tenantId },
        select: { id: true, status: true, reason: true, note: true },
      })
      if (!hold) throw new Error("보류 이력을 찾을 수 없습니다.")
      if (hold.status !== WipHoldStatus.ACTIVE) {
        // 과거 이력(RELEASED/CANCELLED)은 절대 수정하지 않는다 — 이력 보존 우선.
        throw new Error("이미 해제되었거나 취소된 보류 건은 수정할 수 없습니다.")
      }

      const before = { reason: hold.reason, note: hold.note }

      // release/cancel과 경쟁할 수 있으므로 동일한 조건부 updateMany+count 패턴으로 확정한다.
      // findFirst 이후 update(where:{id})만 쓰면, 그 사이 release/cancel이 먼저 끝난
      // RELEASED/CANCELLED 이력을 되돌아와 덮어쓸 수 있다.
      const claimed = await tx.wipHold.updateMany({
        where: { id: hold.id, tenantId, status: WipHoldStatus.ACTIVE },
        data: { reason, note },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 이미 처리되었습니다.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "WipHold",
          entityId: hold.id,
          action: "UPDATE",
          beforeData: before,
          afterData: { reason, note },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateHoldPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 보류 해제 (WIP을 previousStatus로 복원) ──────────────────────────────────────

export type ReleaseHoldInput = {
  holdId: string
  releaseNote?: string | null
}

export async function releaseHold(input: ReleaseHoldInput): Promise<{ ok: boolean; error?: string }> {
  await requireResourcePermission("WORK_RESULT", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()
    const releaseNote = input.releaseNote?.trim() || null

    await prisma.$transaction(async (tx) => {
      const hold = await tx.wipHold.findFirst({
        where: { id: input.holdId, tenantId },
        select: { id: true, wipUnitId: true, status: true, previousStatus: true },
      })
      if (!hold) throw new Error("보류 이력을 찾을 수 없습니다.")
      if (hold.status !== WipHoldStatus.ACTIVE) {
        throw new Error("이미 해제되었거나 취소된 보류 건입니다.")
      }

      const wipUnit = await tx.wipUnit.findFirst({
        where: { id: hold.wipUnitId, tenantId },
        select: {
          id: true,
          siteId: true,
          status: true,
          qty: true,
          workOrderOperationId: true,
          currentWorkCenterId: true,
        },
      })
      if (!wipUnit) throw new Error("재공품(WIP)을 찾을 수 없습니다.")
      if (wipUnit.status !== WipUnitStatus.ON_HOLD) {
        // §8: 보류 중 다른 로직에 의해 상태가 바뀐 경우 무조건 overwrite하지 않는다.
        throw new Error("재공품 상태가 보류 중이 아니어서 해제할 수 없습니다. 새로고침 후 확인해 주세요.")
      }

      const claimedHold = await tx.wipHold.updateMany({
        where: { id: hold.id, tenantId, status: WipHoldStatus.ACTIVE },
        data: {
          status: WipHoldStatus.RELEASED,
          releasedAt: new Date(),
          releasedById: actor.id,
          releasedByName: actor.name,
          releaseNote,
        },
      })
      if (claimedHold.count !== 1) {
        throw new Error("다른 요청에 의해 이미 처리되었습니다.")
      }

      const claimedWip = await tx.wipUnit.updateMany({
        where: { id: wipUnit.id, tenantId, status: WipUnitStatus.ON_HOLD },
        data: { status: hold.previousStatus },
      })
      if (claimedWip.count !== 1) {
        throw new Error("재공품 상태가 보류 중 다른 처리로 변경되어 복원할 수 없습니다.")
      }

      await tx.wipMovement.create({
        data: {
          tenantId,
          siteId: wipUnit.siteId,
          wipUnitId: wipUnit.id,
          movementType: WipMovementType.RELEASED,
          fromOperationId: wipUnit.workOrderOperationId,
          toOperationId: wipUnit.workOrderOperationId,
          fromWorkCenterId: wipUnit.currentWorkCenterId,
          toWorkCenterId: wipUnit.currentWorkCenterId,
          qty: wipUnit.qty,
          sourceType: "WipHold",
          sourceId: hold.id,
          note: releaseNote ? `보류 해제: ${releaseNote}` : "보류 해제",
          createdById: actor.id,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "WipHold",
          entityId: hold.id,
          action: "UPDATE",
          beforeData: { status: "ACTIVE" },
          afterData: { status: "RELEASED", releaseNote, restoredStatus: hold.previousStatus },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateHoldPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 보류 취소 (등록 자체를 취소 — 사업계획서 "삭제"에 대응, hard delete는 하지 않는다) ──

export type CancelHoldInput = {
  holdId: string
  cancelNote?: string | null
}

export async function cancelHold(input: CancelHoldInput): Promise<{ ok: boolean; error?: string }> {
  await requireResourcePermission("WORK_RESULT", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()
    const cancelNote = input.cancelNote?.trim() || null

    await prisma.$transaction(async (tx) => {
      const hold = await tx.wipHold.findFirst({
        where: { id: input.holdId, tenantId },
        select: { id: true, wipUnitId: true, status: true, previousStatus: true },
      })
      if (!hold) throw new Error("보류 이력을 찾을 수 없습니다.")
      if (hold.status !== WipHoldStatus.ACTIVE) {
        throw new Error("이미 해제되었거나 취소된 보류 건입니다.")
      }

      const wipUnit = await tx.wipUnit.findFirst({
        where: { id: hold.wipUnitId, tenantId },
        select: {
          id: true,
          siteId: true,
          status: true,
          qty: true,
          workOrderOperationId: true,
          currentWorkCenterId: true,
        },
      })
      if (!wipUnit) throw new Error("재공품(WIP)을 찾을 수 없습니다.")
      if (wipUnit.status !== WipUnitStatus.ON_HOLD) {
        throw new Error("재공품 상태가 보류 중이 아니어서 취소할 수 없습니다. 새로고침 후 확인해 주세요.")
      }

      const claimedHold = await tx.wipHold.updateMany({
        where: { id: hold.id, tenantId, status: WipHoldStatus.ACTIVE },
        data: {
          status: WipHoldStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: actor.id,
          cancelledByName: actor.name,
          cancelNote,
        },
      })
      if (claimedHold.count !== 1) {
        throw new Error("다른 요청에 의해 이미 처리되었습니다.")
      }

      const claimedWip = await tx.wipUnit.updateMany({
        where: { id: wipUnit.id, tenantId, status: WipUnitStatus.ON_HOLD },
        data: { status: hold.previousStatus },
      })
      if (claimedWip.count !== 1) {
        throw new Error("재공품 상태가 보류 중 다른 처리로 변경되어 복원할 수 없습니다.")
      }

      await tx.wipMovement.create({
        data: {
          tenantId,
          siteId: wipUnit.siteId,
          wipUnitId: wipUnit.id,
          movementType: WipMovementType.RELEASED,
          fromOperationId: wipUnit.workOrderOperationId,
          toOperationId: wipUnit.workOrderOperationId,
          fromWorkCenterId: wipUnit.currentWorkCenterId,
          toWorkCenterId: wipUnit.currentWorkCenterId,
          qty: wipUnit.qty,
          sourceType: "WipHold",
          sourceId: hold.id,
          note: cancelNote ? `보류 등록 취소: ${cancelNote}` : "보류 등록 취소",
          createdById: actor.id,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "WipHold",
          entityId: hold.id,
          action: "DELETE",
          beforeData: { status: "ACTIVE" },
          afterData: { status: "CANCELLED", cancelNote, restoredStatus: hold.previousStatus },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateHoldPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
