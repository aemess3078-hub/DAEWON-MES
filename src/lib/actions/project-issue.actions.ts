"use server"

import { prisma } from "@/lib/db/prisma"
import { ProjectIssueType, ProjectIssueSeverity, Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { getErrorMessage } from "@/lib/utils"
import { toKstDateKey } from "@/lib/date/kst"
import { PROJECT_ISSUE_BLOCKED_ORDER_STATUSES } from "@/lib/project-issue-status"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── 청운커팅 사업계획서 "프로젝트관리 > 이슈 관리" ───────────────────────────────
//
// ProjectOrder 하위에서 발생하는 문제/리스크(ProjectIssue)를 등록→담당자지정→
// 조치진행→해결 흐름으로 추적한다. 품질검사의 불량 원인분석/시정조치/재발방지와는
// 완전히 분리된 별개 도메인이다 — 품질 불량은 DefectRecord/QualityInspection 쪽
// 책임이고, 이 파일은 프로젝트 일정/업무 문제만 다룬다. 이번 PR에서는 ProjectStage와
// 직접 FK를 연결하지 않는다(Issue는 ProjectOrder 단위로만 관리, §2/§17).
// 모든 조회/등록/수정/삭제/상태변경 액션은 클라이언트가 넘긴 tenantId를 신뢰하지
// 않고 getTenantId()로 세션에서 직접 구한다.

const MENU_NAME = "이슈 관리"
const CODE_GENERATION_MAX_ATTEMPTS = 3

function revalidateProjectIssuePaths() {
  revalidatePath("/app/mes/project-issues")
  revalidatePath("/app/mes/project-progress")
}

async function assertProjectOrderOwned(tenantId: string, projectOrderId: string) {
  const projectOrder = await prisma.projectOrder.findFirst({
    where: { id: projectOrderId, tenantId },
    select: { id: true, status: true },
  })
  if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
  return projectOrder
}

// §14: ProjectOrder가 COMPLETED/CANCELLED면 Issue 신규등록/수정/시작/해결/삭제를
// 모두 차단한다 — 종료된 프로젝트의 업무이력 변조를 막기 위함이다. ON_HOLD는
// 계속 허용한다(보류 사유 자체를 Issue/Risk로 관리할 수 있으므로).
function assertProjectOrderIssueEditable(status: string) {
  if ((PROJECT_ISSUE_BLOCKED_ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new Error("완료되었거나 취소된 프로젝트의 이슈는 수정·삭제·상태변경할 수 없습니다.")
  }
}

// §16: dueDate < occurredAt 저장 차단. client + server 양쪽 검증(여기는 server쪽).
function assertIssueDateOrder(occurredAt: Date, dueDate: Date | null) {
  if (dueDate && dueDate.getTime() < occurredAt.getTime()) {
    throw new Error("목표일은 발생일보다 빠를 수 없습니다.")
  }
}

// §15: 담당자 지정 시 현재 tenant의 활성 TenantUser에 속한 Profile만 허용한다.
// 다른 tenant 사용자/비활성 사용자는 차단.
async function assertAssigneeValid(tenantId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return
  const tenantUser = await prisma.tenantUser.findFirst({
    where: { profileId: assigneeId, tenantId, isActive: true },
    select: { profileId: true },
  })
  if (!tenantUser) {
    throw new Error("담당자를 찾을 수 없습니다. 활성 상태인 담당자만 지정할 수 있습니다.")
  }
}

// ─── 번호 생성 (내부 전용, Server Action으로 export하지 않음) ───────────────────
//
// project-order.actions.ts의 generateProjectOrderNo와 동일한 원칙(prefix+findFirst
// desc). 연도는 KST 달력일 기준(§9). 동시 등록 시 unique 충돌은 createProjectIssue의
// 재시도 루프에서 방어한다. client에서 code를 전달하지 않고 서버 내부에서만 채번한다.

async function generateProjectIssueNo(tenantId: string): Promise<string> {
  const kstYear = toKstDateKey(new Date()).slice(0, 4)
  const prefix = `ISS-${kstYear}-`
  const last = await prisma.projectIssue.findFirst({
    where: { tenantId, code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  })
  const seq = last ? (parseInt(last.code.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

// ─── 조회 ───────────────────────────────────────────────────────────────────

export type ProjectIssueRow = {
  id: string
  code: string
  type: ProjectIssueType
  severity: ProjectIssueSeverity
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED"
  title: string
  occurredAt: Date
  dueDate: Date | null
  resolvedAt: Date | null
  createdAt: Date
  projectOrder: { id: string; code: string; name: string; status: string }
  customer: { id: string; name: string }
  assignee: { id: string; name: string } | null
}

const ISSUE_LIST_SELECT = {
  id: true,
  code: true,
  type: true,
  severity: true,
  status: true,
  title: true,
  occurredAt: true,
  dueDate: true,
  resolvedAt: true,
  createdAt: true,
  projectOrder: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      customer: { select: { id: true, name: true } },
    },
  },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.ProjectIssueSelect

export async function getProjectIssueList(): Promise<ProjectIssueRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const rows = await prisma.projectIssue.findMany({
    where: { tenantId },
    select: ISSUE_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  })
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    type: r.type,
    severity: r.severity,
    status: r.status,
    title: r.title,
    occurredAt: r.occurredAt,
    dueDate: r.dueDate,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    projectOrder: {
      id: r.projectOrder.id,
      code: r.projectOrder.code,
      name: r.projectOrder.name,
      status: r.projectOrder.status,
    },
    customer: r.projectOrder.customer,
    assignee: r.assignee,
  }))
}

// 프로젝트 진행현황 상세 Sheet의 "이슈" 탭 — 특정 ProjectOrder로 범위를 좁힌 목록.
export async function getProjectIssuesByProjectOrder(projectOrderId: string): Promise<ProjectIssueRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  await assertProjectOrderOwned(tenantId, projectOrderId)
  const rows = await prisma.projectIssue.findMany({
    where: { tenantId, projectOrderId },
    select: ISSUE_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  })
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    type: r.type,
    severity: r.severity,
    status: r.status,
    title: r.title,
    occurredAt: r.occurredAt,
    dueDate: r.dueDate,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    projectOrder: {
      id: r.projectOrder.id,
      code: r.projectOrder.code,
      name: r.projectOrder.name,
      status: r.projectOrder.status,
    },
    customer: r.projectOrder.customer,
    assignee: r.assignee,
  }))
}

// 프로젝트 진행현황 목록의 "미해결 이슈 수" 표시용 — 진행률 계산에는 절대 포함하지
// 않는다(§21). tenant 범위 전체를 한 번에 groupBy해서 화면에서 map으로 붙인다.
export async function getOpenProjectIssueCounts(): Promise<Record<string, number>> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const rows = await prisma.projectIssue.groupBy({
    by: ["projectOrderId"],
    where: { tenantId, status: { not: "RESOLVED" } },
    _count: { _all: true },
  })
  return Object.fromEntries(rows.map((r) => [r.projectOrderId, r._count._all]))
}

export type ProjectIssueDetail = ProjectIssueRow & {
  description: string | null
  resolution: string | null
  createdBy: { id: string; name: string }
}

export async function getProjectIssueDetail(id: string): Promise<ProjectIssueDetail> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const r = await prisma.projectIssue.findFirst({
    where: { id, tenantId },
    select: {
      ...ISSUE_LIST_SELECT,
      description: true,
      resolution: true,
      createdBy: { select: { id: true, name: true } },
    },
  })
  if (!r) throw new Error("프로젝트 이슈를 찾을 수 없습니다.")
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    severity: r.severity,
    status: r.status,
    title: r.title,
    description: r.description,
    occurredAt: r.occurredAt,
    dueDate: r.dueDate,
    resolution: r.resolution,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    projectOrder: {
      id: r.projectOrder.id,
      code: r.projectOrder.code,
      name: r.projectOrder.name,
      status: r.projectOrder.status,
    },
    customer: r.projectOrder.customer,
    assignee: r.assignee,
    createdBy: r.createdBy,
  }
}

// 등록 Dialog의 프로젝트 선택지 — 완료/취소된 프로젝트는 신규 이슈 등록이 서버에서
// 차단되므로(§10) 애초에 선택지에서 제외해 불필요한 오류를 줄인다.
export async function getProjectIssueProjectOptions() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const orders = await prisma.projectOrder.findMany({
    where: { tenantId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: {
      id: true,
      code: true,
      name: true,
      customer: { select: { name: true } },
    },
    orderBy: { code: "desc" },
  })
  return orders.map((o) => ({ id: o.id, code: o.code, name: o.name, customerName: o.customer.name }))
}

export async function getProjectIssueAssignableUsers() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const users = await prisma.tenantUser.findMany({
    where: { tenantId, isActive: true },
    select: { profileId: true, profile: { select: { name: true } } },
  })
  return users.map((u) => ({ id: u.profileId, name: u.profile.name }))
}

// ─── 등록 ───────────────────────────────────────────────────────────────────

export type CreateProjectIssueInput = {
  projectOrderId: string
  title: string
  type: ProjectIssueType
  severity: ProjectIssueSeverity
  occurredAt: Date
  assigneeId?: string | null
  dueDate?: Date | null
  description?: string | null
}

// §24: 생성은 미해결 이슈 개수를 늘리는 동작이라 ProjectOrder COMPLETED 전환 검증
// (project-order.actions.ts updateProjectOrder)과 race가 날 수 있다 — "완료 가능"
// 판정 이후 새 OPEN 이슈가 끼어들면 COMPLETED 상태에 미해결 이슈가 남는 모순이
// 생긴다. 그래서 여기서는 ProjectOrder 행을 FOR UPDATE로 잠근 뒤 상태를 확인한다
// (같은 잠금을 완료 전환 트랜잭션도 사용하므로 서로 직렬화된다). 반대로 해결
// (resolveProjectIssue)은 미해결 개수를 줄이는 동작이라 같은 잠금이 없어도 모순이
// 생기지 않으므로(최악의 경우 "완료 가능한데 일시적으로 막힘" 뿐, 재시도하면 됨)
// 잠그지 않는다 — 불필요한 과도한 lock을 피한다(§24).
export async function createProjectIssue(
  input: CreateProjectIssueInput
): Promise<{ ok: boolean; error?: string; issueId?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ISSUE", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const title = input.title.trim()
    if (!title) throw new Error("제목을 입력해 주세요.")
    if (!input.occurredAt) throw new Error("발생일을 입력해 주세요.")

    await assertAssigneeValid(tenantId, input.assigneeId)
    assertIssueDateOrder(input.occurredAt, input.dueDate ?? null)

    let lastError: unknown = null
    for (let attempt = 0; attempt < CODE_GENERATION_MAX_ATTEMPTS; attempt++) {
      const code = await generateProjectIssueNo(tenantId)
      try {
        const issue = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "ProjectOrder" WHERE id = ${input.projectOrderId} FOR UPDATE`

          const projectOrder = await tx.projectOrder.findFirst({
            where: { id: input.projectOrderId, tenantId },
            select: { status: true },
          })
          if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
          if ((PROJECT_ISSUE_BLOCKED_ORDER_STATUSES as readonly string[]).includes(projectOrder.status)) {
            throw new Error("완료되었거나 취소된 프로젝트에는 이슈를 등록할 수 없습니다.")
          }

          const created = await tx.projectIssue.create({
            data: {
              tenantId,
              projectOrderId: input.projectOrderId,
              code,
              type: input.type,
              severity: input.severity,
              title,
              description: input.description?.trim() || null,
              assigneeId: input.assigneeId || null,
              occurredAt: input.occurredAt,
              dueDate: input.dueDate ?? null,
              createdById: actor.id,
            },
          })

          await tx.auditLog.create({
            data: {
              tenantId,
              actorId: actor.id,
              actorLabel: actor.name,
              entityType: "ProjectIssue",
              entityId: created.id,
              action: "CREATE",
              afterData: {
                projectOrderId: input.projectOrderId,
                code: created.code,
                type: created.type,
                severity: created.severity,
                status: created.status,
                assigneeId: created.assigneeId,
                dueDate: created.dueDate,
              },
              menuName: MENU_NAME,
            },
          })

          return created
        })

        revalidateProjectIssuePaths()
        return { ok: true, issueId: issue.id }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          lastError = e
          continue
        }
        throw e
      }
    }
    throw lastError instanceof Error ? lastError : new Error("이슈번호 생성에 실패했습니다. 다시 시도해 주세요.")
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 수정 ───────────────────────────────────────────────────────────────────
//
// OPEN: 제목/유형/중요도/담당자/발생일/목표일/내용 모두 수정 가능.
// IN_PROGRESS: 중요도/담당자/목표일/내용만 수정 가능 — 제목/유형/발생일 변경은
// 차단한다(§11). RESOLVED: 수정 금지. 서버가 최종 검증하며 UI disabled만 믿지 않는다.

export type UpdateProjectIssueInput = {
  id: string
  title?: string
  type?: ProjectIssueType
  severity?: ProjectIssueSeverity
  assigneeId?: string | null
  occurredAt?: Date
  dueDate?: Date | null
  description?: string | null
}

export async function updateProjectIssue(
  input: UpdateProjectIssueInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ISSUE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectIssue.findFirst({ where: { id: input.id, tenantId } })
    if (!current) throw new Error("프로젝트 이슈를 찾을 수 없습니다.")
    if (current.status === "RESOLVED") throw new Error("해결완료된 이슈는 수정할 수 없습니다.")
    if (
      current.status === "IN_PROGRESS" &&
      (input.title !== undefined || input.type !== undefined || input.occurredAt !== undefined)
    ) {
      throw new Error("조치중인 이슈는 제목/유형/발생일을 수정할 수 없습니다.")
    }

    const projectOrder = await prisma.projectOrder.findFirst({
      where: { id: current.projectOrderId, tenantId },
      select: { status: true },
    })
    if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
    assertProjectOrderIssueEditable(projectOrder.status)

    await assertAssigneeValid(tenantId, input.assigneeId)

    const title = input.title?.trim()
    if (input.title !== undefined && !title) throw new Error("제목을 입력해 주세요.")

    const nextOccurredAt = input.occurredAt !== undefined ? input.occurredAt : current.occurredAt
    const nextDueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate
    assertIssueDateOrder(nextOccurredAt, nextDueDate)

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.projectIssue.updateMany({
        where: { id: current.id, tenantId, status: current.status },
        data: {
          ...(title !== undefined && { title }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.severity !== undefined && { severity: input.severity }),
          ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId || null }),
          ...(input.occurredAt !== undefined && { occurredAt: input.occurredAt }),
          ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
          ...(input.description !== undefined && { description: input.description?.trim() || null }),
        },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }
      const updated = await tx.projectIssue.findUniqueOrThrow({ where: { id: current.id } })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectIssue",
          entityId: updated.id,
          action: "UPDATE",
          beforeData: {
            title: current.title,
            type: current.type,
            severity: current.severity,
            assigneeId: current.assigneeId,
            occurredAt: current.occurredAt,
            dueDate: current.dueDate,
          },
          afterData: {
            title: updated.title,
            type: updated.type,
            severity: updated.severity,
            assigneeId: updated.assigneeId,
            occurredAt: updated.occurredAt,
            dueDate: updated.dueDate,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectIssuePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 삭제 (OPEN만) ───────────────────────────────────────────────────────────
//
// 업무 이력을 보존하기 위해 진행된(IN_PROGRESS/RESOLVED) 이슈의 hard delete는
// 허용하지 않는다(§12). 완료/취소된 프로젝트의 이슈도 삭제할 수 없다 —
// 종료된 프로젝트의 업무이력 변조 방지 원칙(§14)을 삭제에도 동일하게 적용한다.

export async function deleteProjectIssue(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ISSUE", "DELETE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectIssue.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 이슈를 찾을 수 없습니다.")
    if (current.status !== "OPEN") throw new Error("미조치 상태의 이슈만 삭제할 수 있습니다.")

    const projectOrder = await prisma.projectOrder.findFirst({
      where: { id: current.projectOrderId, tenantId },
      select: { status: true },
    })
    if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
    assertProjectOrderIssueEditable(projectOrder.status)

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.projectIssue.deleteMany({
        where: { id: current.id, tenantId, status: "OPEN" },
      })
      if (deleted.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectIssue",
          entityId: current.id,
          action: "DELETE",
          beforeData: { code: current.code, title: current.title, status: current.status },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectIssuePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 조치 시작 (OPEN → IN_PROGRESS) ──────────────────────────────────────────

export async function startProjectIssue(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ISSUE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectIssue.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 이슈를 찾을 수 없습니다.")
    if (current.status !== "OPEN") throw new Error("미조치 상태인 이슈만 조치를 시작할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const projectOrder = await tx.projectOrder.findFirst({
        where: { id: current.projectOrderId, tenantId },
        select: { status: true },
      })
      if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
      assertProjectOrderIssueEditable(projectOrder.status)

      const claimed = await tx.projectIssue.updateMany({
        where: { id: current.id, tenantId, status: "OPEN" },
        data: { status: "IN_PROGRESS" },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectIssue",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: "OPEN" },
          afterData: { status: "IN_PROGRESS" },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectIssuePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 해결 완료 (OPEN/IN_PROGRESS → RESOLVED) ─────────────────────────────────
//
// resolution 필수(§8). resolvedAt = now. lock 관련 근거는 createProjectIssue의
// 주석 참고 — 해결은 미해결 개수를 줄이는 동작이라 ProjectOrder row lock 없이도
// "COMPLETED 상태에 미해결 이슈가 남는" 모순이 생기지 않는다.

export async function resolveProjectIssue(
  id: string,
  resolution: string
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ISSUE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const trimmedResolution = resolution.trim()
    if (!trimmedResolution) throw new Error("조치내용을 입력해 주세요.")

    const current = await prisma.projectIssue.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 이슈를 찾을 수 없습니다.")
    // 정본 흐름은 OPEN → IN_PROGRESS → RESOLVED뿐이다 — OPEN에서 바로 해결 완료할
    // 수 없다(§1). 상태전이표에도 반영되어 있지만, 여기서도 명시적으로 검증한다.
    if (current.status === "RESOLVED") throw new Error("이미 해결완료된 이슈입니다.")
    if (current.status !== "IN_PROGRESS") throw new Error("조치중인 이슈만 해결 완료할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const projectOrder = await tx.projectOrder.findFirst({
        where: { id: current.projectOrderId, tenantId },
        select: { status: true },
      })
      if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
      assertProjectOrderIssueEditable(projectOrder.status)

      const resolvedAt = new Date()
      const claimed = await tx.projectIssue.updateMany({
        where: { id: current.id, tenantId, status: current.status },
        data: { status: "RESOLVED", resolution: trimmedResolution, resolvedAt },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectIssue",
          entityId: current.id,
          action: "UPDATE",
          beforeData: { status: current.status, resolution: current.resolution, resolvedAt: current.resolvedAt },
          afterData: { status: "RESOLVED", resolution: trimmedResolution, resolvedAt },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectIssuePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
