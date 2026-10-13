"use server"

import { prisma } from "@/lib/db/prisma"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { getErrorMessage } from "@/lib/utils"
import { validateRoutingForItem } from "@/lib/actions/routing.actions"
import { getRoutingsForItem } from "@/lib/actions/work-order.actions"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── 청운커팅 사업계획서 "프로젝트관리 > 프로젝트 진행현황" ──────────────────────────
//
// ProjectOrder 하위의 순차 단계(ProjectStage) 관리. 진행률/현재단계/지연여부는
// DB에 저장하지 않고 화면/서비스에서 계산한다(src/lib/project-stage-progress.ts).
// ProjectStage 상태변경이 ProjectOrder.status를 자동 변경하지 않는다(§16) —
// 이 파일은 ProjectOrder.status를 절대 쓰지 않는다.
// 모든 조회/등록/수정/삭제/상태변경/import 액션은 클라이언트가 넘긴 tenantId를
// 신뢰하지 않고 getTenantId()로 세션에서 직접 구한다.

const MENU_NAME = "프로젝트 진행현황"
const SEQ_STEP = 10

// §2: 완료/취소된 프로젝트는 단계 구조(추가/수정/삭제/라우팅import)를 바꿀 수 없다.
// 단계 실행(시작/완료)은 프로젝트가 IN_PROGRESS일 때만 허용한다. 이 파일은
// ProjectStage 상태변경으로 ProjectOrder.status를 절대 자동 변경하지 않는다는
// 기존 원칙을 그대로 유지한다 — 여기서 하는 일은 읽기 전용 게이트 확인뿐이다.
const STRUCTURE_BLOCKED_ORDER_STATUSES = ["COMPLETED", "CANCELLED"]

function revalidateProjectStagePaths() {
  revalidatePath("/app/mes/project-progress")
  revalidatePath("/app/mes/project-orders")
}

async function assertProjectOrderOwned(tenantId: string, projectOrderId: string) {
  const projectOrder = await prisma.projectOrder.findFirst({
    where: { id: projectOrderId, tenantId },
    select: { id: true, itemId: true, status: true },
  })
  if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
  return projectOrder
}

function assertProjectOrderStructureEditable(status: string) {
  if (STRUCTURE_BLOCKED_ORDER_STATUSES.includes(status)) {
    throw new Error("완료되었거나 취소된 프로젝트는 단계를 변경할 수 없습니다.")
  }
}

// §3: 서버 공통 날짜 검증 helper — createProjectStage/updateProjectStage 양쪽에서 사용.
function assertStageDateOrder(plannedStartDate: Date | null, dueDate: Date | null) {
  if (plannedStartDate && dueDate && plannedStartDate.getTime() > dueDate.getTime()) {
    throw new Error("계획 시작일은 계획 완료일보다 늦을 수 없습니다.")
  }
}

// ─── 조회 ───────────────────────────────────────────────────────────────────

export type ProjectStageRow = {
  id: string
  projectOrderId: string
  seq: number
  name: string
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED"
  plannedStartDate: Date | null
  dueDate: Date | null
  startedAt: Date | null
  completedAt: Date | null
  note: string | null
  sourceRoutingOperationId: string | null
}

export async function getProjectStages(projectOrderId: string): Promise<ProjectStageRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  await assertProjectOrderOwned(tenantId, projectOrderId)
  return prisma.projectStage.findMany({
    where: { tenantId, projectOrderId },
    select: {
      id: true,
      projectOrderId: true,
      seq: true,
      name: true,
      status: true,
      plannedStartDate: true,
      dueDate: true,
      startedAt: true,
      completedAt: true,
      note: true,
      sourceRoutingOperationId: true,
    },
    orderBy: { seq: "asc" },
  })
}

export type ProjectProgressRow = {
  id: string
  code: string
  name: string
  priority: "LOW" | "MEDIUM" | "HIGH"
  status: "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED"
  plannedStartDate: Date | null
  dueDate: Date | null
  customer: { id: string; name: string }
  owner: { id: string; name: string }
  stages: { seq: number; name: string; status: "PENDING" | "IN_PROGRESS" | "COMPLETED"; dueDate: Date | null }[]
}

export async function getProjectProgressList(): Promise<ProjectProgressRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.projectOrder.findMany({
    where: { tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      priority: true,
      status: true,
      plannedStartDate: true,
      dueDate: true,
      customer: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      stages: {
        select: { seq: true, name: true, status: true, dueDate: true },
        orderBy: { seq: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

export type ProjectStageDetailHeader = {
  id: string
  code: string
  name: string
  priority: "LOW" | "MEDIUM" | "HIGH"
  status: "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED"
  plannedStartDate: Date | null
  dueDate: Date | null
  itemId: string | null
  customer: { id: string; name: string }
  owner: { id: string; name: string }
}

// 프로젝트 상세 Sheet가 여닫힐 때 헤더 정보 + 단계 목록을 한 번에 가져온다.
export async function getProjectStageDetail(
  projectOrderId: string
): Promise<{ projectOrder: ProjectStageDetailHeader; stages: ProjectStageRow[] }> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const projectOrder = await prisma.projectOrder.findFirst({
    where: { id: projectOrderId, tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      priority: true,
      status: true,
      plannedStartDate: true,
      dueDate: true,
      itemId: true,
      customer: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  })
  if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")

  const stages = await prisma.projectStage.findMany({
    where: { tenantId, projectOrderId },
    select: {
      id: true,
      projectOrderId: true,
      seq: true,
      name: true,
      status: true,
      plannedStartDate: true,
      dueDate: true,
      startedAt: true,
      completedAt: true,
      note: true,
      sourceRoutingOperationId: true,
    },
    orderBy: { seq: "asc" },
  })

  return { projectOrder, stages }
}

// 라우팅 선택지 — 기존 work-order.actions.ts의 getRoutingsForItem을 그대로 재사용한다
// (ACTIVE 상태만, ITEM_SPECIFIC + COMMON, isDefault 플래그 포함) — 중복 구현하지 않음.
export async function getProjectStageRoutingOptions(projectOrderId: string) {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const projectOrder = await assertProjectOrderOwned(tenantId, projectOrderId)
  if (!projectOrder.itemId) return []
  return getRoutingsForItem(projectOrder.itemId)
}

// ─── 단계 추가 ───────────────────────────────────────────────────────────────

export type CreateProjectStageInput = {
  projectOrderId: string
  name: string
  plannedStartDate?: Date | null
  dueDate?: Date | null
  note?: string | null
}

export async function createProjectStage(
  input: CreateProjectStageInput
): Promise<{ ok: boolean; error?: string; stageId?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_STAGE", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const name = input.name.trim()
    if (!name) throw new Error("단계명을 입력해 주세요.")

    const projectOrder = await assertProjectOrderOwned(tenantId, input.projectOrderId)
    assertProjectOrderStructureEditable(projectOrder.status)
    assertStageDateOrder(input.plannedStartDate ?? null, input.dueDate ?? null)

    const created = await prisma.$transaction(async (tx) => {
      // 동시 추가 시 seq 충돌(같은 max+10 계산) 방지를 위해 ProjectOrder 행을 잠근다.
      await tx.$queryRaw`SELECT id FROM "ProjectOrder" WHERE id = ${input.projectOrderId} FOR UPDATE`

      const last = await tx.projectStage.findFirst({
        where: { projectOrderId: input.projectOrderId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      })
      const seq = (last?.seq ?? 0) + SEQ_STEP

      const stage = await tx.projectStage.create({
        data: {
          tenantId,
          projectOrderId: input.projectOrderId,
          seq,
          name,
          plannedStartDate: input.plannedStartDate ?? null,
          dueDate: input.dueDate ?? null,
          note: input.note?.trim() || null,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectStage",
          entityId: stage.id,
          action: "CREATE",
          afterData: { projectOrderId: input.projectOrderId, seq: stage.seq, name: stage.name, status: stage.status },
          menuName: MENU_NAME,
        },
      })

      return stage
    })

    revalidateProjectStagePaths()
    return { ok: true, stageId: created.id }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 단계 수정 ───────────────────────────────────────────────────────────────
//
// PENDING: 기본정보 자유 수정. IN_PROGRESS: 일정/비고만 수정 가능(name 변경 차단).
// COMPLETED: 수정 금지(§9).

export type UpdateProjectStageInput = {
  id: string
  name?: string
  plannedStartDate?: Date | null
  dueDate?: Date | null
  note?: string | null
}

export async function updateProjectStage(
  input: UpdateProjectStageInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_STAGE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectStage.findFirst({ where: { id: input.id, tenantId } })
    if (!current) throw new Error("프로젝트 단계를 찾을 수 없습니다.")
    if (current.status === "COMPLETED") throw new Error("완료된 단계는 수정할 수 없습니다.")
    if (current.status === "IN_PROGRESS" && input.name !== undefined) {
      throw new Error("진행중인 단계는 일정/비고만 수정할 수 있습니다.")
    }

    const projectOrder = await prisma.projectOrder.findFirst({
      where: { id: current.projectOrderId, tenantId },
      select: { status: true },
    })
    if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
    assertProjectOrderStructureEditable(projectOrder.status)

    const name = input.name?.trim()
    if (input.name !== undefined && !name) throw new Error("단계명을 입력해 주세요.")

    const nextPlannedStartDate =
      input.plannedStartDate !== undefined ? input.plannedStartDate : current.plannedStartDate
    const nextDueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate
    assertStageDateOrder(nextPlannedStartDate, nextDueDate)

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.projectStage.updateMany({
        where: { id: current.id, tenantId, status: current.status },
        data: {
          ...(name !== undefined && { name }),
          ...(input.plannedStartDate !== undefined && { plannedStartDate: input.plannedStartDate }),
          ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
          ...(input.note !== undefined && { note: input.note?.trim() || null }),
        },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }
      const updated = await tx.projectStage.findUniqueOrThrow({ where: { id: current.id } })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectStage",
          entityId: updated.id,
          action: "UPDATE",
          beforeData: {
            name: current.name,
            plannedStartDate: current.plannedStartDate,
            dueDate: current.dueDate,
            note: current.note,
          },
          afterData: {
            name: updated.name,
            plannedStartDate: updated.plannedStartDate,
            dueDate: updated.dueDate,
            note: updated.note,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectStagePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 단계 삭제 (PENDING만) ────────────────────────────────────────────────────

export async function deleteProjectStage(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_STAGE", "DELETE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectStage.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 단계를 찾을 수 없습니다.")
    if (current.status !== "PENDING") throw new Error("대기 상태인 단계만 삭제할 수 있습니다.")

    const projectOrder = await prisma.projectOrder.findFirst({
      where: { id: current.projectOrderId, tenantId },
      select: { status: true },
    })
    if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
    assertProjectOrderStructureEditable(projectOrder.status)

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.projectStage.deleteMany({
        where: { id: current.id, tenantId, status: "PENDING" },
      })
      if (deleted.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectStage",
          entityId: current.id,
          action: "DELETE",
          beforeData: { seq: current.seq, name: current.name, status: current.status },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectStagePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 단계 시작 (PENDING → IN_PROGRESS) ───────────────────────────────────────
//
// §7 상태전이 + §6 동시 1개 진행중 정책 + §8 순서 제약(이전 유효 단계 모두 COMPLETED)을
// 서버에서 강제한다. 같은 프로젝트의 다른 단계와의 교차검증(순서/중복진행)이 있으므로
// ProjectOrder 행을 잠가 동시 시작 요청을 직렬화한다 — WipHold/POP의 FOR UPDATE 패턴과
// 동일한 이유(두 단계를 동시에 시작하는 race를 DB 잠금으로 막는다).

export async function startProjectStage(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_STAGE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectStage.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 단계를 찾을 수 없습니다.")

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProjectOrder" WHERE id = ${current.projectOrderId} FOR UPDATE`

      const projectOrder = await tx.projectOrder.findUniqueOrThrow({
        where: { id: current.projectOrderId },
        select: { status: true },
      })
      if (projectOrder.status !== "IN_PROGRESS") {
        throw new Error("진행중 상태의 프로젝트에서만 단계를 시작할 수 있습니다.")
      }

      const fresh = await tx.projectStage.findUniqueOrThrow({ where: { id: current.id } })
      if (fresh.status !== "PENDING") throw new Error("대기 상태인 단계만 시작할 수 있습니다.")

      const [incompletePrior, inProgressOther] = await Promise.all([
        tx.projectStage.findFirst({
          where: { projectOrderId: fresh.projectOrderId, seq: { lt: fresh.seq }, status: { not: "COMPLETED" } },
          select: { id: true },
        }),
        tx.projectStage.findFirst({
          where: { projectOrderId: fresh.projectOrderId, status: "IN_PROGRESS", id: { not: fresh.id } },
          select: { id: true },
        }),
      ])
      if (incompletePrior) throw new Error("이전 단계를 먼저 완료해 주세요.")
      if (inProgressOther) throw new Error("이미 진행중인 단계가 있습니다. 먼저 완료해 주세요.")

      const claimed = await tx.projectStage.updateMany({
        where: { id: fresh.id, tenantId, status: "PENDING" },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectStage",
          entityId: fresh.id,
          action: "UPDATE",
          beforeData: { status: "PENDING", startedAt: null },
          afterData: { status: "IN_PROGRESS" },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectStagePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 단계 완료 (IN_PROGRESS → COMPLETED) ─────────────────────────────────────
//
// 완료는 형제 단계와의 교차검증이 없어(자기 자신의 상태만 확인) ProjectOrder 잠금 없이
// updateMany claim 패턴만으로 충분히 안전하다.

export async function completeProjectStage(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_STAGE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectStage.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 단계를 찾을 수 없습니다.")
    if (current.status !== "IN_PROGRESS") throw new Error("진행중인 단계만 완료할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const projectOrder = await tx.projectOrder.findFirst({
        where: { id: current.projectOrderId, tenantId },
        select: { status: true },
      })
      if (!projectOrder || projectOrder.status !== "IN_PROGRESS") {
        throw new Error("진행중 상태의 프로젝트에서만 단계를 완료할 수 있습니다.")
      }

      const claimed = await tx.projectStage.updateMany({
        where: { id: current.id, tenantId, status: "IN_PROGRESS" },
        data: { status: "COMPLETED", completedAt: new Date() },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectStage",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: "IN_PROGRESS", completedAt: null },
          afterData: { status: "COMPLETED" },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectStagePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 공정 라우팅에서 단계 가져오기 (§10, §11) ─────────────────────────────────
//
// 단계가 0건일 때만 허용, transaction으로 일괄 생성(중간 실패 시 일부만 남지 않도록).
// 중복 import 방어를 위해 ProjectOrder 행을 잠가 "0건 확인"과 "생성"을 원자적으로 묶는다.

export async function importProjectStagesFromRouting(
  projectOrderId: string,
  routingId: string
): Promise<{ ok: boolean; error?: string; importedCount?: number }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_STAGE", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const projectOrder = await assertProjectOrderOwned(tenantId, projectOrderId)
    assertProjectOrderStructureEditable(projectOrder.status)
    if (!projectOrder.itemId) throw new Error("프로젝트 오더에 품목이 지정되어 있지 않습니다.")

    await validateRoutingForItem({ tenantId, itemId: projectOrder.itemId, routingId })

    const importedCount = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProjectOrder" WHERE id = ${projectOrderId} FOR UPDATE`

      const existingCount = await tx.projectStage.count({ where: { projectOrderId } })
      if (existingCount > 0) throw new Error("기존 단계가 존재합니다.")

      const operations = await tx.routingOperation.findMany({
        where: { routingId },
        orderBy: { seq: "asc" },
        select: { id: true, seq: true, name: true },
      })
      if (operations.length === 0) throw new Error("선택한 라우팅에 등록된 공정이 없습니다.")

      await tx.projectStage.createMany({
        data: operations.map((op) => ({
          tenantId,
          projectOrderId,
          seq: op.seq,
          name: op.name,
          sourceRoutingOperationId: op.id,
        })),
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectStage",
          entityId: "BULK",
          action: "CREATE",
          afterData: {
            source: "ROUTING_IMPORT",
            projectOrderId,
            routingId,
            importedCount: operations.length,
          },
          menuName: MENU_NAME,
        },
      })

      return operations.length
    })

    revalidateProjectStagePaths()
    return { ok: true, importedCount }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
