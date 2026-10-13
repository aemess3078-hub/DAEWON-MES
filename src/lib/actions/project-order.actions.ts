"use server"

import { prisma } from "@/lib/db/prisma"
import { ProjectOrderStatus, ProjectOrderPriority, Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { getErrorMessage } from "@/lib/utils"
import { toKstDateKey } from "@/lib/date/kst"
import {
  PROJECT_ORDER_STATUS_TRANSITIONS,
  PROJECT_ORDER_CREATABLE_STATUSES,
} from "@/lib/project-order-status"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── 청운커팅 사업계획서 "영업관리 > 프로젝트 오더" ────────────────────────────────
//
// 수주(SalesOrder)와 생산실행 사이를 잇는 프로젝트 단위 업무 Header.
// 프로젝트 진행률/단계관리/이슈관리/대금관리는 이 파일의 책임이 아니다(PR #48+,
// 이슈 CRUD/상태전이는 project-issue.actions.ts). 다만 COMPLETED 전환 시 미완료
// ProjectStage/미해결 ProjectIssue 정합성 검증만은 이 파일의 updateProjectOrder가
// 계속 담당한다(PR #48 §16, PR #49 §13) — ProjectOrder.status를 쓰는 유일한
// 파일이라는 원칙을 유지하기 위함이다.
// 모든 조회/등록/수정/삭제 액션은 클라이언트가 넘긴 tenantId를 신뢰하지 않고
// getTenantId()로 세션에서 직접 구한다. 채번 함수는 client tenantId를 받는
// 공개 Server Action으로 만들지 않고 파일 내부 helper로만 둔다(§3).

const MENU_NAME = "프로젝트 오더"
const DELETABLE_STATUSES: ProjectOrderStatus[] = ["DRAFT"]
const CODE_GENERATION_MAX_ATTEMPTS = 3

function revalidateProjectOrderPaths() {
  revalidatePath("/app/mes/project-orders")
}

// ─── 조회 ───────────────────────────────────────────────────────────────────

export type ProjectOrderRow = {
  id: string
  code: string
  name: string
  siteId: string
  site: { id: string; code: string; name: string }
  priority: ProjectOrderPriority
  status: ProjectOrderStatus
  plannedStartDate: Date | null
  dueDate: Date | null
  description: string | null
  createdAt: Date
  updatedAt: Date
  customer: { id: string; code: string; name: string }
  item: { id: string; code: string; name: string } | null
  salesOrder: { id: string; orderNo: string } | null
  owner: { id: string; name: string }
}

export async function getProjectOrders(): Promise<ProjectOrderRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.projectOrder.findMany({
    where: { tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      siteId: true,
      site: { select: { id: true, code: true, name: true } },
      priority: true,
      status: true,
      plannedStartDate: true,
      dueDate: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { id: true, code: true, name: true } },
      item: { select: { id: true, code: true, name: true } },
      salesOrder: { select: { id: true, orderNo: true } },
      owner: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function getProjectOrderCustomers() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.businessPartner.findMany({
    where: { tenantId, partnerType: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

// §4: 프로젝트 오더에서 선택 가능한 품목은 완제품/반제품만 허용한다 — 원자재/소모품은
// 생산실행 대상이 아니라 프로젝트 산출물이 아니므로 제외한다. itemType은
// SearchableItemCombobox가 뱃지 표시에 쓰므로 select에 포함한다.
export async function getProjectOrderItems() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.item.findMany({
    where: { tenantId, status: "ACTIVE", itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
    select: { id: true, code: true, name: true, itemType: true },
    orderBy: { name: "asc" },
  })
}

// 등록/수정 Form의 사업장 선택지 — tenant 범위로만 스코프한다(§9).
export async function getProjectOrderSites() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export async function getProjectOrderAssignableUsers() {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const users = await prisma.tenantUser.findMany({
    where: { tenantId, isActive: true },
    select: { profileId: true, profile: { select: { name: true } } },
  })
  return users.map((u) => ({ id: u.profileId, name: u.profile.name }))
}

export type ProjectOrderSalesOrderOption = {
  id: string
  orderNo: string
  customerId: string
  customer: { id: string; code: string; name: string }
  siteId: string
  deliveryDate: Date
  items: { id: string; code: string; name: string; itemType: string }[]
}

// 연결 수주 선택지 — CANCELLED 수주는 애초에 연결 대상에서 제외한다(§2). siteId는
// 선택 시 ProjectOrder.siteId를 자동 동기화하는 데 쓰고(§10), customer는 검색
// Combobox 표시("[SO-2026-001] 거래처명")·검색(§5)에 쓴다. items는 일반 품목 조회
// (getProjectOrderItems)·assertReferencesValid와 동일하게 ACTIVE 완제품/반제품만
// 내려준다 — SalesOrder 원본 데이터 자체는 건드리지 않고 이 조회 결과에서만 걸러낸다.
export async function getProjectOrderSalesOrders(): Promise<ProjectOrderSalesOrderOption[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const orders = await prisma.salesOrder.findMany({
    where: { tenantId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      customer: { select: { id: true, code: true, name: true } },
      siteId: true,
      deliveryDate: true,
      items: {
        where: { item: { status: "ACTIVE", itemType: { in: ["FINISHED", "SEMI_FINISHED"] } } },
        select: { item: { select: { id: true, code: true, name: true, itemType: true } } },
        orderBy: { item: { code: "asc" } },
      },
    },
    orderBy: { orderNo: "desc" },
  })
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    customerId: o.customerId,
    customer: o.customer,
    siteId: o.siteId,
    deliveryDate: o.deliveryDate,
    items: o.items.map((i) => i.item),
  }))
}

// ─── 번호 생성 (내부 전용, Server Action으로 export하지 않음) ───────────────────
//
// prefix+findFirst desc 방식은 sibling 영업관리 모델들(SalesOrder/PurchaseOrder/
// Quotation)의 기존 관례를 따른 것이다. 별도 NumberingSequence 테이블은 현재
// LOT/SERIAL 채번 전용이라 이번 PR에서 새 타입을 얹어 재사용하지 않는다 — sibling
// 모델과의 일관성을 우선했다. 동시 등록 시 unique 충돌은 createProjectOrder에서
// 재시도로 방어한다. 연도는 UTC가 아니라 KST 달력일 기준으로 계산한다(§3) —
// 자정 직후 UTC 연도가 아직 안 넘어간 KST 새해에도 올바른 prefix가 나오도록.

async function generateProjectOrderNo(tenantId: string): Promise<string> {
  const kstYear = toKstDateKey(new Date()).slice(0, 4)
  const prefix = `PROJ-${kstYear}-`
  const last = await prisma.projectOrder.findFirst({
    where: { tenantId, code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  })
  const seq = last ? (parseInt(last.code.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

// ─── 참조값 검증 (§3/§4/§6/§11) ─────────────────────────────────────────────
//
// client select 목록만 믿지 않고, UI 필터와 동일한 조건(거래처 partnerType,
// 담당자 isActive+tenant 일치, 품목 status+itemType, 사업장 tenant 일치)을
// 서버에서도 매번 다시 확인한다. siteId는 이제 항상 필수로 함께 검증한다 —
// 연결 수주가 있으면 SalesOrder.siteId와 반드시 일치해야 한다(§11/§12).

async function assertReferencesValid(
  tenantId: string,
  input: {
    customerId: string
    ownerId: string
    siteId: string
    itemId?: string | null
    salesOrderId?: string | null
  }
): Promise<void> {
  const [customer, owner, site] = await Promise.all([
    prisma.businessPartner.findFirst({
      where: { id: input.customerId, tenantId, partnerType: { in: ["CUSTOMER", "BOTH"] } },
      select: { id: true },
    }),
    prisma.tenantUser.findFirst({
      where: { profileId: input.ownerId, tenantId, isActive: true },
      select: { profileId: true },
    }),
    prisma.site.findFirst({
      where: { id: input.siteId, tenantId },
      select: { id: true },
    }),
  ])
  if (!customer) throw new Error("거래처를 찾을 수 없습니다.")
  if (!owner) throw new Error("담당자를 찾을 수 없습니다. 활성 상태인 담당자만 지정할 수 있습니다.")
  if (!site) throw new Error("사업장을 찾을 수 없습니다.")

  if (input.itemId) {
    const item = await prisma.item.findFirst({
      where: { id: input.itemId, tenantId, status: "ACTIVE", itemType: { in: ["FINISHED", "SEMI_FINISHED"] } },
      select: { id: true },
    })
    if (!item) throw new Error("품목을 찾을 수 없습니다. 완제품 또는 반제품만 선택할 수 있습니다.")
  }

  if (input.salesOrderId) {
    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id: input.salesOrderId, tenantId },
      select: {
        status: true,
        customerId: true,
        siteId: true,
        items: { select: { itemId: true } },
      },
    })
    if (!salesOrder) throw new Error("연결할 수주를 찾을 수 없습니다.")
    if (salesOrder.status === "CANCELLED") throw new Error("취소된 수주는 연결할 수 없습니다.")
    if (salesOrder.customerId !== input.customerId) {
      throw new Error("연결한 수주의 거래처와 일치하지 않습니다.")
    }
    if (salesOrder.siteId !== input.siteId) {
      throw new Error("연결한 수주와 사업장이 일치하지 않습니다.")
    }
    if (input.itemId && !salesOrder.items.some((i) => i.itemId === input.itemId)) {
      throw new Error("선택한 품목이 연결된 수주의 품목 목록에 없습니다.")
    }
  }
}

function assertDateOrder(plannedStartDate: Date | null, dueDate: Date | null) {
  if (plannedStartDate && dueDate && plannedStartDate.getTime() > dueDate.getTime()) {
    throw new Error("시작 예정일은 납기 예정일보다 늦을 수 없습니다.")
  }
}

// ─── 등록 ───────────────────────────────────────────────────────────────────
//
// §9: 과거에는 siteId를 수주/로그인 사용자/tenant 단일 Site 중 하나로 자동
// 추정했고(resolveCreateSiteId), 다중 사업장 tenant에서 수주 미선택 + 사용자
// siteId 미지정이면 사용자가 고칠 방법이 없는 채로 "사업장을 결정할 수
// 없습니다" 오류가 발생했다. 이제 siteId는 Form의 필수 입력 필드이므로 그
// 추정 로직 자체를 제거했다 — client가 보낸 siteId는 assertReferencesValid가
// tenant 소속 여부(및 연결 수주가 있으면 그 siteId와 일치하는지)를 검증한다.

export type CreateProjectOrderInput = {
  name: string
  siteId: string
  customerId: string
  ownerId: string
  status: ProjectOrderStatus
  priority?: ProjectOrderPriority
  itemId?: string | null
  salesOrderId?: string | null
  plannedStartDate?: Date | null
  dueDate?: Date | null
  description?: string | null
}

export async function createProjectOrder(
  input: CreateProjectOrderInput
): Promise<{ ok: boolean; error?: string; projectOrderId?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ORDER", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const name = input.name.trim()
    if (!name) throw new Error("프로젝트명을 입력해 주세요.")

    if (!PROJECT_ORDER_CREATABLE_STATUSES.includes(input.status)) {
      throw new Error("신규 등록 시에는 초안 또는 수주확정 상태로만 시작할 수 있습니다.")
    }

    await assertReferencesValid(tenantId, input)
    assertDateOrder(input.plannedStartDate ?? null, input.dueDate ?? null)

    const siteId = input.siteId

    let lastError: unknown = null
    for (let attempt = 0; attempt < CODE_GENERATION_MAX_ATTEMPTS; attempt++) {
      const code = await generateProjectOrderNo(tenantId)
      try {
        const projectOrder = await prisma.$transaction(async (tx) => {
          const created = await tx.projectOrder.create({
            data: {
              tenantId,
              siteId,
              code,
              name,
              customerId: input.customerId,
              itemId: input.itemId || null,
              salesOrderId: input.salesOrderId || null,
              ownerId: input.ownerId,
              priority: input.priority ?? "MEDIUM",
              status: input.status,
              plannedStartDate: input.plannedStartDate ?? null,
              dueDate: input.dueDate ?? null,
              description: input.description?.trim() || null,
            },
          })

          await tx.auditLog.create({
            data: {
              tenantId,
              actorId: actor.id,
              actorLabel: actor.name,
              entityType: "ProjectOrder",
              entityId: created.id,
              action: "CREATE",
              afterData: {
                code: created.code,
                name: created.name,
                siteId: created.siteId,
                customerId: created.customerId,
                status: created.status,
                priority: created.priority,
              },
              menuName: MENU_NAME,
            },
          })

          return created
        })

        revalidateProjectOrderPaths()
        return { ok: true, projectOrderId: projectOrder.id }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          lastError = e
          continue
        }
        throw e
      }
    }
    throw lastError instanceof Error ? lastError : new Error("프로젝트 오더번호 생성에 실패했습니다. 다시 시도해 주세요.")
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 수정 ───────────────────────────────────────────────────────────────────

export type UpdateProjectOrderInput = {
  id: string
  name?: string
  siteId?: string
  customerId?: string
  ownerId?: string
  status?: ProjectOrderStatus
  priority?: ProjectOrderPriority
  itemId?: string | null
  salesOrderId?: string | null
  plannedStartDate?: Date | null
  dueDate?: Date | null
  description?: string | null
}

export async function updateProjectOrder(
  input: UpdateProjectOrderInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ORDER", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectOrder.findFirst({ where: { id: input.id, tenantId } })
    if (!current) throw new Error("프로젝트 오더를 찾을 수 없습니다.")

    const effectiveSalesOrderId =
      input.salesOrderId !== undefined ? input.salesOrderId : current.salesOrderId
    // §12: 수주 미연결이면 siteId를 자유롭게 바꿀 수 있고, 수주 연결 중이면
    // (새로 연결하는 경우 포함) siteId는 그 SalesOrder.siteId와 반드시 일치해야
    // 한다 — 이 일치 검증은 assertReferencesValid가 salesOrderId와 siteId를
    // 함께 받아 한 번에 수행한다(§11).
    const effectiveSiteId = input.siteId !== undefined ? input.siteId : current.siteId

    if (
      input.customerId ||
      input.ownerId ||
      input.itemId !== undefined ||
      input.salesOrderId !== undefined ||
      input.siteId !== undefined
    ) {
      await assertReferencesValid(tenantId, {
        customerId: input.customerId ?? current.customerId,
        ownerId: input.ownerId ?? current.ownerId,
        itemId: input.itemId !== undefined ? input.itemId : current.itemId,
        salesOrderId: effectiveSalesOrderId,
        siteId: effectiveSiteId,
      })
    }

    const nextPlannedStartDate =
      input.plannedStartDate !== undefined ? input.plannedStartDate : current.plannedStartDate
    const nextDueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate
    assertDateOrder(nextPlannedStartDate, nextDueDate)

    const name = input.name?.trim()
    if (input.name !== undefined && !name) throw new Error("프로젝트명을 입력해 주세요.")

    // 상태전이 검증(§4) — 서버가 최종 판단한다. 상태를 바꾸는 경우에만 현재
    // 상태를 조건으로 건 updateMany로 동시 변경을 방어한다(WipHold와 동일한
    // claim 패턴).
    const isStatusChange = input.status !== undefined && input.status !== current.status
    if (isStatusChange) {
      const allowed = PROJECT_ORDER_STATUS_TRANSITIONS[current.status]
      if (!allowed.includes(input.status as ProjectOrderStatus)) {
        throw new Error(
          `현재 상태(${current.status})에서 ${input.status} 상태로 변경할 수 없습니다.`
        )
      }
    }

    // updateMany(상태변경 시 concurrency guard)와 update가 같은 data 모양을 쓸 수
    // 있도록 relation connect/disconnect 대신 scalar FK 필드를 직접 대입한다 —
    // updateMany의 data는 ProjectOrderUpdateManyMutationInput이라 relation 문법을
    // 받지 않는다.
    const isCompletingOrder = isStatusChange && input.status === "COMPLETED"

    await prisma.$transaction(async (tx) => {
      // PR #48 ProjectStage 도입에 따른 보완: COMPLETED로 전환할 때 미완료 단계가
      // 있으면 차단한다 — COMPLETED 상태에서는 단계 실행 자체가 막혀 복구가
      // 어려워지기 때문이다. ProjectStage 쪽(createProjectStage/startProjectStage/
      // importProjectStagesFromRouting)과 동일하게 ProjectOrder 행을 FOR UPDATE로
      // 잠근 뒤 확인해, 단계 추가/시작과의 race를 막는다. 반대 방향(ProjectStage
      // 완료가 ProjectOrder.status를 자동 COMPLETED로 바꾸는 것)은 여전히 하지
      // 않는다 — 기존 원칙 그대로.
      //
      // PR #49 ProjectIssue 도입에 따른 보완(§13/§24): 같은 이유로 미해결
      // ProjectIssue(status !== RESOLVED)가 있으면 COMPLETED 전환을 차단한다.
      // createProjectIssue도 같은 ProjectOrder 행을 FOR UPDATE로 잠그므로 신규
      // 이슈 생성과 이 검증이 서로 직렬화된다. 반대 방향(Issue 해결이
      // ProjectOrder.status를 자동 COMPLETED로 바꾸는 것)은 하지 않는다.
      if (isCompletingOrder) {
        await tx.$queryRaw`SELECT id FROM "ProjectOrder" WHERE id = ${current.id} FOR UPDATE`

        const incompleteStage = await tx.projectStage.findFirst({
          where: { projectOrderId: current.id, tenantId, status: { not: "COMPLETED" } },
          select: { id: true },
        })
        if (incompleteStage) {
          throw new Error("미완료 프로젝트 단계가 있어 프로젝트를 완료할 수 없습니다.")
        }

        const unresolvedIssue = await tx.projectIssue.findFirst({
          where: { projectOrderId: current.id, tenantId, status: { not: "RESOLVED" } },
          select: { id: true },
        })
        if (unresolvedIssue) {
          throw new Error("미해결 프로젝트 이슈가 있어 프로젝트를 완료할 수 없습니다.")
        }
      }

      const updateData: Prisma.ProjectOrderUpdateManyMutationInput = {
        ...(name !== undefined && { name }),
        ...(input.siteId !== undefined && { siteId: input.siteId }),
        ...(input.customerId !== undefined && { customerId: input.customerId }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.itemId !== undefined && { itemId: input.itemId || null }),
        ...(input.salesOrderId !== undefined && { salesOrderId: input.salesOrderId || null }),
        ...(input.plannedStartDate !== undefined && { plannedStartDate: input.plannedStartDate }),
        ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
        ...(input.description !== undefined && { description: input.description?.trim() || null }),
      }

      let updated
      if (isStatusChange) {
        const claimed = await tx.projectOrder.updateMany({
          where: { id: current.id, tenantId, status: current.status },
          data: { ...updateData, status: input.status },
        })
        if (claimed.count !== 1) {
          throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
        }
        updated = await tx.projectOrder.findUniqueOrThrow({ where: { id: current.id } })
      } else {
        updated = await tx.projectOrder.update({ where: { id: current.id }, data: updateData })
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectOrder",
          entityId: updated.id,
          action: "UPDATE",
          beforeData: {
            name: current.name,
            siteId: current.siteId,
            customerId: current.customerId,
            ownerId: current.ownerId,
            status: current.status,
            priority: current.priority,
            itemId: current.itemId,
            salesOrderId: current.salesOrderId,
            plannedStartDate: current.plannedStartDate,
            dueDate: current.dueDate,
          },
          afterData: {
            name: updated.name,
            siteId: updated.siteId,
            customerId: updated.customerId,
            ownerId: updated.ownerId,
            status: updated.status,
            priority: updated.priority,
            itemId: updated.itemId,
            salesOrderId: updated.salesOrderId,
            plannedStartDate: updated.plannedStartDate,
            dueDate: updated.dueDate,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectOrderPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 삭제 ───────────────────────────────────────────────────────────────────
//
// 기존 SalesOrder/Quotation과 동일하게 하드 삭제이되 DRAFT 상태에서만 허용한다(§11).
// ProjectStage(PR #48)/ProjectIssue(PR #49)가 이 엔티티를 참조하므로, 참조가 있으면
// 아래에서 명시적으로 막는다. 향후 ProductionPlan/WorkOrder가 참조를 추가하면 같은
// 패턴으로 확장한다 — 별도 isDeleted 플래그는 이번에도 만들지 않는다.

export async function deleteProjectOrder(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_ORDER", "DELETE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectOrder.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
    if (!DELETABLE_STATUSES.includes(current.status)) {
      throw new Error("DRAFT 상태인 프로젝트 오더만 삭제할 수 있습니다.")
    }

    await prisma.$transaction(async (tx) => {
      // PR #48에서 ProjectStage → ProjectOrder FK가 추가됨에 따라, DB FK 오류에
      // 기대지 않고 참조 존재 여부를 먼저 명시적으로 확인해 차단한다(§1). 동시에
      // 단계가 추가되는 race를 막기 위해 ProjectOrder 행을 잠근 뒤 확인한다 —
      // project-stage.actions.ts의 createProjectStage도 같은 행을 잠그므로 서로
      // 직렬화된다.
      await tx.$queryRaw`SELECT id FROM "ProjectOrder" WHERE id = ${current.id} FOR UPDATE`

      const stageCount = await tx.projectStage.count({ where: { projectOrderId: current.id, tenantId } })
      if (stageCount > 0) {
        throw new Error("프로젝트 단계가 등록되어 있어 삭제할 수 없습니다.")
      }

      // PR #49에서 ProjectIssue → ProjectOrder FK가 추가됨에 따라 동일한 이유로
      // 먼저 명시적으로 확인한다. DRAFT 상태에서도 이슈 등록 자체는 허용되므로
      // (§14 — 등록 차단은 COMPLETED/CANCELLED만) 이 체크가 실제로 걸릴 수 있다.
      const issueCount = await tx.projectIssue.count({ where: { projectOrderId: current.id, tenantId } })
      if (issueCount > 0) {
        throw new Error("프로젝트 이슈가 등록되어 있어 삭제할 수 없습니다.")
      }

      // PR #52A에서 ProjectOrderPrice → ProjectOrder FK가 추가됨에 따라 같은 패턴으로
      // 확인한다. createProjectOrderPrice는 ProjectOrder 행을 잠그지 않으므로 이 체크가
      // 등록 race까지 막지는 못하지만, 그 경우에도 FK(RESTRICT)가 삭제를 막는다 —
      // 여기서는 정상 경로에서 raw FK 오류 대신 안내 메시지를 주는 것이 목적이다.
      const priceCount = await tx.projectOrderPrice.count({ where: { projectOrderId: current.id, tenantId } })
      if (priceCount > 0) {
        throw new Error("프로젝트 단가정보가 등록되어 있어 삭제할 수 없습니다.")
      }

      const deleted = await tx.projectOrder.deleteMany({
        where: { id: current.id, tenantId, status: { in: DELETABLE_STATUSES } },
      })
      if (deleted.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectOrder",
          entityId: current.id,
          action: "DELETE",
          beforeData: { code: current.code, name: current.name, status: current.status },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectOrderPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
