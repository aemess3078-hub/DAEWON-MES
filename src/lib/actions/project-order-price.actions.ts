"use server"

import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireRole, getTenantId } from "@/lib/auth"
import { getErrorMessage } from "@/lib/utils"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── 청운커팅 사업계획서 "영업관리 > 프로젝트 단가관리" (PR #52A) ────────────────
//
// ProjectOrder당 가격관리 레코드 1건(견적단가/수주단가/최종결정단가 snapshot +
// 최종결정단가 변경 이력)을 관리한다. 기간분석/KPI/차트는 PR #52B 범위이며 이
// 파일은 데이터 모델 + CRUD + 상세 조회만 담당한다.
//
// 핵심 설계 원칙:
//  - itemId/salesOrderId는 절대 client 입력으로 받지 않는다 — 항상 서버가
//    ProjectOrder 레코드에서 직접 읽어 채운다. 그래서 "다른 salesOrder/item을
//    조작해서 보낸다"는 공격 자체가 애초에 성립하지 않는다(입력 필드가 없으므로).
//  - quotationId만 사용자가 선택하며, 서버가 항상 tenant+customerId+itemId
//    일치를 재검증한다.
//  - quotationUnitPrice/orderUnitPrice/quantity/currency는 등록 시점 snapshot이다.
//    원본 Quotation/SalesOrderItem이 이후 수정되어도 자동 동기화하지 않는다.
//  - finalUnitPrice만 자체 원장이며 setProjectOrderPriceFinal 전용 액션으로만
//    변경한다(최초 결정 + 재결정을 한 함수가 함께 처리, §9).
//  - 모든 조회/등록/수정/삭제/결정 액션은 클라이언트가 넘긴 tenantId를 신뢰하지
//    않고 getTenantId()로 세션에서 직접 구한다.

const MENU_NAME = "프로젝트 단가관리"

function revalidateProjectOrderPricePaths() {
  revalidatePath("/app/mes/project-prices")
}

function assertPositiveQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("수량은 0보다 커야 합니다.")
  }
}

function assertNonNegativePrice(price: number | null | undefined, label: string) {
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    throw new Error(`${label}은(는) 0 이상이어야 합니다.`)
  }
}

// ─── 견적 후보 검증 (등록/수정 공용, §5/§11) ──────────────────────────────────
//
// tenant + 거래처 일치 + 품목 포함 + CANCELLED 아님을 모두 만족하는 견적만
// 후보로 인정한다. LOST/EXPIRED/SUBMITTED/NEGOTIATING/WON은 전부 허용한다 —
// CANCELLED만 "문서 자체가 무효화됨"을 의미하므로 배제한다(기존 코드베이스가
// SalesOrder/PurchaseOrder에서 CANCELLED만 배제하는 관례와 일치, §5 보고 참고).
async function findEligibleQuotation(
  tenantId: string,
  quotationId: string,
  customerId: string,
  itemId: string
) {
  return prisma.quotation.findFirst({
    where: {
      id: quotationId,
      tenantId,
      customerId,
      status: { not: "CANCELLED" },
      items: { some: { itemId } },
    },
    select: {
      id: true,
      quotationNo: true,
      currency: true,
      quotationDate: true,
      items: { where: { itemId }, select: { unitPrice: true } },
    },
  })
}

// ─── 조회 ───────────────────────────────────────────────────────────────────

export type ProjectOrderPriceRow = {
  id: string
  projectOrder: { id: string; code: string; name: string }
  customer: { id: string; name: string }
  item: { id: string; code: string; name: string; uom: string }
  quantity: number
  quotationUnitPrice: number | null
  orderUnitPrice: number | null
  finalUnitPrice: number | null
  currency: string
  status: "DRAFT" | "DECIDED"
  decidedAt: Date | null
  createdAt: Date
}

const PRICE_LIST_SELECT = {
  id: true,
  quantity: true,
  quotationUnitPrice: true,
  orderUnitPrice: true,
  finalUnitPrice: true,
  currency: true,
  status: true,
  decidedAt: true,
  createdAt: true,
  projectOrder: {
    select: {
      id: true,
      code: true,
      name: true,
      customer: { select: { id: true, name: true } },
    },
  },
  item: { select: { id: true, code: true, name: true, uom: true } },
} satisfies Prisma.ProjectOrderPriceSelect

export async function getProjectOrderPriceList(): Promise<ProjectOrderPriceRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const rows = await prisma.projectOrderPrice.findMany({
    where: { tenantId },
    select: PRICE_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  })
  return rows.map((r) => ({
    id: r.id,
    projectOrder: r.projectOrder,
    customer: r.projectOrder.customer,
    item: r.item,
    quantity: Number(r.quantity),
    quotationUnitPrice: r.quotationUnitPrice != null ? Number(r.quotationUnitPrice) : null,
    orderUnitPrice: r.orderUnitPrice != null ? Number(r.orderUnitPrice) : null,
    finalUnitPrice: r.finalUnitPrice != null ? Number(r.finalUnitPrice) : null,
    currency: r.currency,
    status: r.status,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  }))
}

export type ProjectOrderPriceRevisionRow = {
  id: string
  previousFinalUnitPrice: number | null
  newFinalUnitPrice: number
  reason: string | null
  changedBy: { id: string; name: string }
  changedAt: Date
}

export type ProjectOrderPriceDetail = ProjectOrderPriceRow & {
  site: { id: string; code: string; name: string }
  owner: { id: string; name: string }
  quotation: { id: string; quotationNo: string } | null
  salesOrder: { id: string; orderNo: string } | null
  quotationDate: Date | null
  orderDate: Date | null
  decidedBy: { id: string; name: string } | null
  decisionReason: string | null
  createdBy: { id: string; name: string }
  updatedBy: { id: string; name: string } | null
  updatedAt: Date
  revisions: ProjectOrderPriceRevisionRow[]
}

export async function getProjectOrderPriceDetail(id: string): Promise<ProjectOrderPriceDetail> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const r = await prisma.projectOrderPrice.findFirst({
    where: { id, tenantId },
    select: {
      ...PRICE_LIST_SELECT,
      quotationDate: true,
      orderDate: true,
      decisionReason: true,
      updatedAt: true,
      projectOrder: {
        select: {
          id: true,
          code: true,
          name: true,
          customer: { select: { id: true, name: true } },
          site: { select: { id: true, code: true, name: true } },
          owner: { select: { id: true, name: true } },
        },
      },
      quotation: { select: { id: true, quotationNo: true } },
      salesOrder: { select: { id: true, orderNo: true } },
      decidedBy: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      revisions: {
        select: {
          id: true,
          previousFinalUnitPrice: true,
          newFinalUnitPrice: true,
          reason: true,
          changedAt: true,
          changedBy: { select: { id: true, name: true } },
        },
        orderBy: { changedAt: "desc" },
      },
    },
  })
  if (!r) throw new Error("프로젝트 단가 정보를 찾을 수 없습니다.")

  return {
    id: r.id,
    projectOrder: r.projectOrder,
    customer: r.projectOrder.customer,
    site: r.projectOrder.site,
    owner: r.projectOrder.owner,
    item: r.item,
    quantity: Number(r.quantity),
    quotationUnitPrice: r.quotationUnitPrice != null ? Number(r.quotationUnitPrice) : null,
    orderUnitPrice: r.orderUnitPrice != null ? Number(r.orderUnitPrice) : null,
    finalUnitPrice: r.finalUnitPrice != null ? Number(r.finalUnitPrice) : null,
    currency: r.currency,
    status: r.status,
    quotation: r.quotation,
    salesOrder: r.salesOrder,
    quotationDate: r.quotationDate,
    orderDate: r.orderDate,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
    decisionReason: r.decisionReason,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    revisions: r.revisions.map((rev) => ({
      id: rev.id,
      previousFinalUnitPrice: rev.previousFinalUnitPrice != null ? Number(rev.previousFinalUnitPrice) : null,
      newFinalUnitPrice: Number(rev.newFinalUnitPrice),
      reason: rev.reason,
      changedBy: rev.changedBy,
      changedAt: rev.changedAt,
    })),
  }
}

// 등록 Dialog: 아직 단가관리 레코드가 없는(품목이 지정된) ProjectOrder 검색 후보.
export type ProjectOrderForPricingOption = {
  id: string
  code: string
  name: string
  customer: { id: string; name: string }
  item: { id: string; code: string; name: string }
}

export async function getProjectOrdersAvailableForPricing(): Promise<ProjectOrderForPricingOption[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const orders = await prisma.projectOrder.findMany({
    where: { tenantId, itemId: { not: null }, price: null },
    select: {
      id: true,
      code: true,
      name: true,
      customer: { select: { id: true, name: true } },
      item: { select: { id: true, code: true, name: true } },
    },
    orderBy: { code: "desc" },
  })
  // itemId가 not null인 행만 걸렀으므로 item은 항상 존재한다.
  return orders
    .filter((o): o is typeof o & { item: NonNullable<typeof o.item> } => o.item !== null)
    .map((o) => ({ id: o.id, code: o.code, name: o.name, customer: o.customer, item: o.item }))
}

async function listEligibleQuotations(tenantId: string, customerId: string, itemId: string) {
  const quotations = await prisma.quotation.findMany({
    where: { tenantId, customerId, status: { not: "CANCELLED" }, items: { some: { itemId } } },
    select: {
      id: true,
      quotationNo: true,
      currency: true,
      quotationDate: true,
      items: { where: { itemId }, select: { unitPrice: true } },
    },
    orderBy: { quotationDate: "desc" },
  })
  return quotations.map((q) => ({
    id: q.id,
    quotationNo: q.quotationNo,
    currency: q.currency,
    quotationDate: q.quotationDate,
    unitPrice: Number(q.items[0]?.unitPrice ?? 0),
  }))
}

// 수정 Dialog: 이미 등록된 ProjectOrderPrice의 견적 후보 재조회(기존 price 존재
// 여부와 무관하게 동작 — getProjectOrderPricingSuggestion과 달리 "미등록" 가드가
// 없다).
export async function getQuotationCandidatesForProjectOrder(
  projectOrderId: string
): Promise<Awaited<ReturnType<typeof listEligibleQuotations>>> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const projectOrder = await prisma.projectOrder.findFirst({
    where: { id: projectOrderId, tenantId },
    select: { customerId: true, itemId: true },
  })
  if (!projectOrder || !projectOrder.itemId) return []
  return listEligibleQuotations(tenantId, projectOrder.customerId, projectOrder.itemId)
}

// 등록 Dialog: 선택된 ProjectOrder 기준 견적/수주단가 제안 컨텍스트(§5/§6).
export type ProjectOrderPricingSuggestion = {
  projectOrder: {
    id: string
    code: string
    name: string
    customerId: string
    itemId: string
    salesOrderId: string | null
  }
  quotationCandidates: {
    id: string
    quotationNo: string
    currency: string
    quotationDate: Date
    unitPrice: number
  }[]
  salesOrderSuggestion: {
    salesOrderId: string
    orderNo: string
    currency: string
    orderDate: Date
    unitPrice: number | null
    qty: number
  } | null
}

export async function getProjectOrderPricingSuggestion(
  projectOrderId: string
): Promise<ProjectOrderPricingSuggestion> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()
  const projectOrder = await prisma.projectOrder.findFirst({
    where: { id: projectOrderId, tenantId },
    select: { id: true, code: true, name: true, customerId: true, itemId: true, salesOrderId: true },
  })
  if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
  if (!projectOrder.itemId) throw new Error("품목이 지정되지 않은 프로젝트는 단가를 등록할 수 없습니다.")

  const existing = await prisma.projectOrderPrice.findUnique({
    where: { projectOrderId: projectOrder.id },
    select: { id: true },
  })
  if (existing) throw new Error("이미 단가관리 레코드가 등록된 프로젝트입니다.")

  const itemId = projectOrder.itemId
  const quotations = await listEligibleQuotations(tenantId, projectOrder.customerId, itemId)

  let salesOrderSuggestion: ProjectOrderPricingSuggestion["salesOrderSuggestion"] = null
  if (projectOrder.salesOrderId) {
    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id: projectOrder.salesOrderId, tenantId },
      select: {
        id: true,
        orderNo: true,
        currency: true,
        orderDate: true,
        items: { where: { itemId }, select: { unitPrice: true, qty: true } },
      },
    })
    if (salesOrder) {
      const line = salesOrder.items[0]
      salesOrderSuggestion = {
        salesOrderId: salesOrder.id,
        orderNo: salesOrder.orderNo,
        currency: salesOrder.currency,
        orderDate: salesOrder.orderDate,
        unitPrice: line?.unitPrice != null ? Number(line.unitPrice) : null,
        qty: line ? Number(line.qty) : 0,
      }
    }
  }

  return {
    projectOrder: {
      id: projectOrder.id,
      code: projectOrder.code,
      name: projectOrder.name,
      customerId: projectOrder.customerId,
      itemId,
      salesOrderId: projectOrder.salesOrderId,
    },
    quotationCandidates: quotations,
    salesOrderSuggestion,
  }
}

// ─── 가격 snapshot 정본 결정 (등록/수정 공용) ─────────────────────────────────
//
// 코드리뷰 반영: UI의 prefill 값은 편의 기능일 뿐이고, quotationId/salesOrderId가
// 있으면 quotationUnitPrice/orderUnitPrice/currency의 정본은 항상 이 함수가 지금
// 이 순간 DB에서 다시 읽은 값이다 — client가 무엇을 보내든(설령 조작하더라도)
// 무시한다.
//  - quotationId가 있으면: QuotationItem.unitPrice/Quotation.quotationDate/
//    Quotation.currency를 그대로 snapshot한다. manualQuotationUnitPrice는 이
//    경우 완전히 무시한다(quotationId가 있는데 manual override하는 것은 금지).
//  - quotationId가 없으면: manualQuotationUnitPrice/manualQuotationDate를
//    허용한다(정식 견적 문서 없이 진행하는 프로젝트를 위한 경로).
//  - salesOrderId(ProjectOrder에서 파생, client 입력 아님)가 있으면:
//    SalesOrderItem.unitPrice/SalesOrder.orderDate/SalesOrder.currency를 그대로
//    snapshot한다. 없으면 orderUnitPrice/orderDate는 항상 null — "수주 문서
//    없이 수주단가를 임의 입력"하는 경로는 아예 만들지 않는다(manual override 불가).
//  - currency 정본: 견적/수주 둘 다 있으면 두 통화가 반드시 같아야 하고(다르면
//    차단), 하나만 있으면 그 통화를, 둘 다 없으면 fallbackCurrency(기본 KRW)를 쓴다.
// CREATE의 fallbackCurrency와 UPDATE의 manualCurrency가 동일한 표기로 저장되도록
// 공유하는 정규화 규칙(trim + uppercase) — 빈 문자열 처리(기본값 대입 vs 에러)는
// 호출부마다 다르므로 여기서는 정규화만 담당한다.
function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase()
}

async function resolvePriceSnapshot(
  tenantId: string,
  params: {
    customerId: string
    itemId: string
    quotationId: string | null
    salesOrderId: string | null
    manualQuotationUnitPrice: number | null
    manualQuotationDate: Date | null
    fallbackCurrency: string
  }
): Promise<{
  quotationUnitPrice: number | null
  quotationDate: Date | null
  orderUnitPrice: number | null
  orderDate: Date | null
  currency: string
}> {
  let quotationUnitPrice: number | null = null
  let quotationDate: Date | null = null
  let quotationCurrency: string | null = null

  if (params.quotationId) {
    const quotation = await findEligibleQuotation(tenantId, params.quotationId, params.customerId, params.itemId)
    if (!quotation) {
      throw new Error("선택한 견적을 찾을 수 없습니다. 거래처/품목이 일치하는 견적만 연결할 수 있습니다.")
    }
    const line = quotation.items[0]
    quotationUnitPrice = line ? Number(line.unitPrice) : null
    quotationDate = quotation.quotationDate
    quotationCurrency = quotation.currency
  } else {
    assertNonNegativePrice(params.manualQuotationUnitPrice, "견적단가")
    quotationUnitPrice = params.manualQuotationUnitPrice
    quotationDate = params.manualQuotationDate
  }

  let orderUnitPrice: number | null = null
  let orderDate: Date | null = null
  let orderCurrency: string | null = null
  if (params.salesOrderId) {
    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id: params.salesOrderId, tenantId },
      select: {
        orderDate: true,
        currency: true,
        items: { where: { itemId: params.itemId }, select: { unitPrice: true } },
      },
    })
    if (salesOrder) {
      const line = salesOrder.items[0]
      orderUnitPrice = line?.unitPrice != null ? Number(line.unitPrice) : null
      orderDate = salesOrder.orderDate
      orderCurrency = salesOrder.currency
    }
  }

  let currency: string
  if (quotationCurrency && orderCurrency) {
    if (quotationCurrency !== orderCurrency) {
      throw new Error(`견적과 수주의 통화가 일치하지 않습니다. (견적: ${quotationCurrency}, 수주: ${orderCurrency})`)
    }
    currency = quotationCurrency
  } else if (quotationCurrency) {
    currency = quotationCurrency
  } else if (orderCurrency) {
    currency = orderCurrency
  } else {
    currency = normalizeCurrencyCode(params.fallbackCurrency ?? "") || "KRW"
  }

  return { quotationUnitPrice, quotationDate, orderUnitPrice, orderDate, currency }
}

// ─── 등록 ───────────────────────────────────────────────────────────────────

export type CreateProjectOrderPriceInput = {
  projectOrderId: string
  quotationId?: string | null
  quantity: number
  // quotationId가 없을 때만 쓰이는 manual 값 — quotationId가 있으면 무시된다.
  manualQuotationUnitPrice?: number | null
  manualQuotationDate?: Date | null
  // quotationId도 salesOrderId(ProjectOrder 경유)도 없을 때만 쓰이는 fallback
  // 통화. 그 외에는 서버가 항상 override한다.
  currency?: string
}

export async function createProjectOrderPrice(
  input: CreateProjectOrderPriceInput
): Promise<{ ok: boolean; error?: string; projectOrderPriceId?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_PRICE", "CREATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    // §11: ProjectOrder는 tenant 소속만 신뢰한다. itemId/customerId/salesOrderId는
    // 전부 이 레코드에서 직접 읽고, 클라이언트 입력으로는 절대 받지 않는다 — 그래서
    // "다른 salesOrder/item을 조작해서 보낸다"는 시나리오 자체가 입력 스키마에 없다.
    const projectOrder = await prisma.projectOrder.findFirst({
      where: { id: input.projectOrderId, tenantId },
      select: { id: true, itemId: true, customerId: true, salesOrderId: true },
    })
    if (!projectOrder) throw new Error("프로젝트 오더를 찾을 수 없습니다.")
    if (!projectOrder.itemId) throw new Error("품목이 지정되지 않은 프로젝트는 단가를 등록할 수 없습니다.")

    const existing = await prisma.projectOrderPrice.findUnique({
      where: { projectOrderId: projectOrder.id },
      select: { id: true },
    })
    if (existing) throw new Error("이미 단가정보가 등록된 프로젝트입니다.")

    assertPositiveQuantity(input.quantity)

    const snapshot = await resolvePriceSnapshot(tenantId, {
      customerId: projectOrder.customerId,
      itemId: projectOrder.itemId,
      quotationId: input.quotationId || null,
      salesOrderId: projectOrder.salesOrderId,
      manualQuotationUnitPrice: input.quotationId ? null : input.manualQuotationUnitPrice ?? null,
      manualQuotationDate: input.quotationId ? null : input.manualQuotationDate ?? null,
      fallbackCurrency: input.currency ?? "KRW",
    })

    try {
      const created = await prisma.$transaction(async (tx) => {
        const price = await tx.projectOrderPrice.create({
          data: {
            tenantId,
            projectOrderId: projectOrder.id,
            quotationId: input.quotationId || null,
            salesOrderId: projectOrder.salesOrderId,
            itemId: projectOrder.itemId!,
            quantity: input.quantity,
            quotationUnitPrice: snapshot.quotationUnitPrice,
            orderUnitPrice: snapshot.orderUnitPrice,
            currency: snapshot.currency,
            quotationDate: snapshot.quotationDate,
            orderDate: snapshot.orderDate,
            createdById: actor.id,
          },
        })

        await tx.auditLog.create({
          data: {
            tenantId,
            actorId: actor.id,
            actorLabel: actor.name,
            entityType: "ProjectOrderPrice",
            entityId: price.id,
            action: "CREATE",
            afterData: {
              projectOrderId: price.projectOrderId,
              quotationId: price.quotationId,
              salesOrderId: price.salesOrderId,
              itemId: price.itemId,
              quantity: Number(price.quantity),
              quotationUnitPrice: price.quotationUnitPrice != null ? Number(price.quotationUnitPrice) : null,
              orderUnitPrice: price.orderUnitPrice != null ? Number(price.orderUnitPrice) : null,
              finalUnitPrice: null,
              currency: price.currency,
              status: price.status,
            },
            menuName: MENU_NAME,
          },
        })

        return price
      })

      revalidateProjectOrderPricePaths()
      return { ok: true, projectOrderPriceId: created.id }
    } catch (e) {
      // §3/§6: 사전 findUnique 체크와 실제 create 사이의 동시 등록 레이스는 DB
      // unique 제약이 최종 방어선이다. 이 INSERT가 건드리는 ProjectOrderPrice의
      // unique 제약은 projectOrderId 계열 2개뿐이다 — 단독 @unique(projectOrderId)
      // 와 @@unique([tenantId, projectOrderId]) — 다른 컬럼(quotationId/
      // salesOrderId/itemId/createdById 등)에는 unique 제약이 없으므로, 이
      // 테이블에서 발생하는 P2002는 논리적으로 "이미 등록된 프로젝트"만 의미할
      // 수 있다. 그래도 meta.target으로 한 번 더 좁혀서, 스키마가 나중에 다른
      // unique 제약을 얻더라도 이 메시지를 잘못 붙이지 않도록 방어한다.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = e.meta?.target
        const targets = Array.isArray(target) ? target : typeof target === "string" ? [target] : []
        const isProjectOrderIdConflict = targets.length === 0 || targets.some((t) => String(t).includes("projectOrderId"))
        if (isProjectOrderIdConflict) {
          return { ok: false, error: "이미 단가정보가 등록된 프로젝트입니다." }
        }
      }
      // 그 외 예상 못한 Prisma 오류는 숨기지 않고 그대로 상위로 던진다.
      throw e
    }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 수정 (DRAFT만) ───────────────────────────────────────────────────────────
//
// quotationUnitPrice/orderUnitPrice/quantity/currency는 snapshot 필드라서
// DECIDED 이후에는 아예 수정 창구를 열지 않는다 — DECIDED 이후 유일하게 바뀔 수
// 있는 값은 finalUnitPrice뿐이고, 그건 setProjectOrderPriceFinal 전용 액션이
// 담당한다(§9).
//
// 코드리뷰 반영(snapshot 불변성): CREATE 때와 달리 UPDATE는 "무엇이 실제로
// 바뀌는지"에 따라 재조회 여부가 갈린다 — quantity만 고치는 흔한 경우에
// quotationId/orderUnitPrice가 매번 원본 재조회로 갱신되면 snapshot 원장의
// 의미가 없어진다.
//  - quotationId가 (요청에 없거나) 그대로면: 기존 quotationUnitPrice/
//    quotationDate를 그대로 보존한다. manual 모드(quotationId=null)에서
//    manualQuotationUnitPrice가 이번 요청에 없으면 기존 manual 값을 절대
//    지우지 않는다(partial update).
//  - quotationId가 이번 요청에서 실제로 다른 값으로 "명시" 바뀔 때만 새
//    Quotation/QuotationItem을 검증해 새로 snapshot한다.
//  - orderUnitPrice/orderDate/salesOrderId는 UPDATE data에 절대 포함하지
//    않는다 — CREATE 시점 snapshot을 그대로 영구 보존한다. ProjectOrder.
//    salesOrderId나 SalesOrderItem.unitPrice가 이후 바뀌어도 자동 반영하지
//    않으며, 이번 PR에서 "수주정보 다시 가져오기" 기능은 만들지 않는다.
//  - currency도 quotationId가 실제로 바뀌는 경우에만 재검증/재설정한다. 그 외
//    에는 client가 무엇을 보내든 기존 저장값을 그대로 유지한다.

export type UpdateProjectOrderPriceInput = {
  id: string
  quotationId?: string | null
  quantity?: number
  manualQuotationUnitPrice?: number | null
  manualQuotationDate?: Date | null
  // quotationId도 salesOrderId(ProjectOrderPrice에 이미 저장된 snapshot)도 없는
  // "순수 manual" 상태에서만 의미가 있다 — 그 외에는 서버가 무시한다(§4/§5).
  manualCurrency?: string
}

// quotationId/salesOrderId 어느 쪽도 source로 남아있지 않은 순수 manual 상태에서만
// client가 currency를 직접 바꿀 수 있다. 미제공 시 기존 값을 유지하고, 제공됐는데
// 빈 문자열이면 차단한다. 기존 코드베이스의 currency 컬럼(Quotation/SalesOrder/
// ItemPrice 전부 자유 문자열, "KRW" 기본값)과 맞춰 대문자 정규화만 추가한다.
function resolveManualCurrency(manualCurrency: string | undefined, fallback: string): string {
  if (manualCurrency === undefined) return fallback
  const normalized = normalizeCurrencyCode(manualCurrency)
  if (!normalized) throw new Error("통화를 입력하세요.")
  return normalized
}

export async function updateProjectOrderPrice(
  input: UpdateProjectOrderPriceInput
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_PRICE", "UPDATE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectOrderPrice.findFirst({
      where: { id: input.id, tenantId },
      include: { projectOrder: { select: { customerId: true, itemId: true } } },
    })
    if (!current) throw new Error("프로젝트 단가 정보를 찾을 수 없습니다.")
    if (current.status !== "DRAFT") throw new Error("임시저장 상태의 단가만 수정할 수 있습니다.")
    if (!current.projectOrder.itemId) throw new Error("품목이 지정되지 않은 프로젝트는 단가를 수정할 수 없습니다.")

    const nextQuantity = input.quantity !== undefined ? input.quantity : Number(current.quantity)
    assertPositiveQuantity(nextQuantity)

    const currentQuotationUnitPrice = current.quotationUnitPrice != null ? Number(current.quotationUnitPrice) : null
    const nextQuotationId = input.quotationId !== undefined ? input.quotationId : current.quotationId
    const quotationIdChanging = input.quotationId !== undefined && input.quotationId !== current.quotationId

    let nextQuotationUnitPrice: number | null
    let nextQuotationDate: Date | null
    let nextCurrency: string

    if (!quotationIdChanging) {
      if (current.quotationId) {
        // 견적 연결이 그대로 유지되는 경우 — 원본을 다시 읽지 않고 기존
        // snapshot을 보존한다.
        nextQuotationUnitPrice = currentQuotationUnitPrice
        nextQuotationDate = current.quotationDate
      } else {
        // manual 모드가 그대로 유지되는 경우 — 이번 요청에 명시된 값만 반영하고,
        // 없으면(§E) 기존 manual 값을 절대 지우지 않는다.
        nextQuotationUnitPrice =
          input.manualQuotationUnitPrice !== undefined ? input.manualQuotationUnitPrice : currentQuotationUnitPrice
        nextQuotationDate = input.manualQuotationDate !== undefined ? input.manualQuotationDate : current.quotationDate
        assertNonNegativePrice(nextQuotationUnitPrice, "견적단가")
      }
      // 통화: quotationId가 그대로 연결돼 있거나, salesOrder snapshot이 남아있으면
      // (source가 있으면) currency는 그 source에 묶인 값이므로 client 입력과
      // 무관하게 유지한다. 견적도 수주도 없는 순수 manual 상태일 때만
      // manualCurrency로 명시 변경을 허용한다(§5).
      nextCurrency =
        current.quotationId || current.salesOrderId
          ? current.currency
          : resolveManualCurrency(input.manualCurrency, current.currency)
    } else if (nextQuotationId) {
      // §3.C: A→B로 명시적으로 견적이 바뀌는 경우에만 새 견적을 검증하고 새로 snapshot한다.
      const quotation = await findEligibleQuotation(tenantId, nextQuotationId, current.projectOrder.customerId, current.projectOrder.itemId)
      if (!quotation) {
        throw new Error("선택한 견적을 찾을 수 없습니다. 거래처/품목이 일치하는 견적만 연결할 수 있습니다.")
      }
      const line = quotation.items[0]
      nextQuotationUnitPrice = line ? Number(line.unitPrice) : null
      nextQuotationDate = quotation.quotationDate
      // 통화(§3): salesOrder 원본을 다시 읽지 않고, 이미 저장된 current.currency를
      // "salesOrder snapshot이 있다면 그 시점의 통화" 정본으로 취급해 비교한다.
      //  - salesOrder snapshot이 있음(A): 두 소스가 같은 통화여야 하므로 다르면
      //    차단하고, 같으면 기존 값을 그대로 유지한다(환율 변환 없음).
      //  - salesOrder snapshot이 없음(B): 새 견적이 유일한 문서 source이므로
      //    기존 currency와 달라도 그대로 새 견적 통화로 바꾼다 — 차단하지 않는다.
      if (current.salesOrderId) {
        if (quotation.currency !== current.currency) {
          throw new Error(`선택한 견적의 통화(${quotation.currency})가 기존 수주단가 통화(${current.currency})와 다릅니다.`)
        }
        nextCurrency = current.currency
      } else {
        nextCurrency = quotation.currency
      }
    } else {
      // 견적 연결 해제(A → null).
      if (input.manualQuotationUnitPrice != null) {
        assertNonNegativePrice(input.manualQuotationUnitPrice, "견적단가")
        nextQuotationUnitPrice = input.manualQuotationUnitPrice
        nextQuotationDate = input.manualQuotationDate ?? null
      } else {
        nextQuotationUnitPrice = null
        nextQuotationDate = null
      }
      // 통화(§4): salesOrder snapshot이 남아있으면(A) 그 통화에 계속 묶인다 —
      // manualCurrency가 와도 무시한다. salesOrder snapshot도 없으면(B) 순수
      // manual 상태가 되므로 manualCurrency로 명시 변경을 허용한다.
      nextCurrency = current.salesOrderId ? current.currency : resolveManualCurrency(input.manualCurrency, current.currency)
    }

    await prisma.$transaction(async (tx) => {
      const now = new Date()
      // status만으로는 "DRAFT였다가 그대로 DRAFT로 남는" 동시 수정 두 건을 구분하지
      // 못한다(둘 다 claim 조건을 통과해 버림) — current 조회 시점의 updatedAt을
      // optimistic-lock 토큰으로 함께 요구해, 그 사이 다른 요청이 먼저 갱신했다면
      // 이 updateMany가 0건을 갱신하도록 한다.
      const claimed = await tx.projectOrderPrice.updateMany({
        where: { id: current.id, tenantId, status: "DRAFT", updatedAt: current.updatedAt },
        data: {
          quotationId: nextQuotationId || null,
          quantity: nextQuantity,
          quotationUnitPrice: nextQuotationUnitPrice,
          quotationDate: nextQuotationDate,
          currency: nextCurrency,
          // orderUnitPrice/orderDate/salesOrderId는 의도적으로 여기 포함하지
          // 않는다 — CREATE 시점 snapshot을 그대로 보존한다(§3.F).
          updatedById: actor.id,
          updatedAt: now,
        },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }
      const updated = await tx.projectOrderPrice.findUniqueOrThrow({ where: { id: current.id } })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectOrderPrice",
          entityId: current.id,
          action: "UPDATE",
          beforeData: {
            quotationId: current.quotationId,
            quantity: Number(current.quantity),
            quotationUnitPrice: currentQuotationUnitPrice,
            currency: current.currency,
            status: current.status,
          },
          afterData: {
            quotationId: updated.quotationId,
            quantity: Number(updated.quantity),
            quotationUnitPrice: updated.quotationUnitPrice != null ? Number(updated.quotationUnitPrice) : null,
            currency: updated.currency,
            status: updated.status,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectOrderPricePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 삭제 (DRAFT만, §18) ──────────────────────────────────────────────────────
//
// DECIDED는 hard delete를 만들지 않는다 — 최종결정단가는 영업 실적 원장이므로
// 오등록이 아닌 이상 삭제 대상이 아니다. DRAFT 오입력만 삭제 허용.

export async function deleteProjectOrderPrice(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_PRICE", "DELETE")
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const current = await prisma.projectOrderPrice.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 단가 정보를 찾을 수 없습니다.")
    if (current.status !== "DRAFT") throw new Error("임시저장 상태의 단가만 삭제할 수 있습니다.")

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.projectOrderPrice.deleteMany({ where: { id: current.id, tenantId, status: "DRAFT" } })
      if (deleted.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectOrderPrice",
          entityId: current.id,
          action: "DELETE",
          beforeData: { projectOrderId: current.projectOrderId, status: current.status },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectOrderPricePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 최종결정단가 확정/재결정 (DRAFT → DECIDED, 또는 DECIDED 유지 + 재수정) ────
//
// §9: 최초 결정과 재결정을 한 액션이 함께 처리한다 — 상태 자체는 DRAFT->DECIDED
// 전이 1번뿐이고, 그 이후 finalUnitPrice가 다시 바뀌는 것은 상태전이가 아니라
// "DECIDED 상태 안에서의 원장 갱신"이기 때문이다. 최초 결정은 decisionReason이
// 없어도 되지만, 재결정은 MANAGER 이상 + decisionReason 필수다. 두 경우 모두
// ProjectOrderPriceRevision을 1건 남긴다(§8 — 최초 결정도 previousFinalUnitPrice
// =null인 revision 1건을 만들어 타임라인이 "언제나 최소 1건"으로 자연스럽게
// 시작하도록 한다).

export async function setProjectOrderPriceFinal(
  id: string,
  input: { finalUnitPrice: number; decisionReason?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("PROJECT_PRICE", "UPDATE")
  try {
    const actor = await requireRole("MANAGER")
    const tenantId = await getTenantId()

    const current = await prisma.projectOrderPrice.findFirst({ where: { id, tenantId } })
    if (!current) throw new Error("프로젝트 단가 정보를 찾을 수 없습니다.")

    if (!Number.isFinite(input.finalUnitPrice) || input.finalUnitPrice < 0) {
      throw new Error("최종결정단가는 0 이상이어야 합니다.")
    }

    const isRedecision = current.status === "DECIDED"
    const reason = input.decisionReason?.trim() || null
    if (isRedecision && !reason) {
      throw new Error("최종결정단가를 재수정하려면 결정사유를 입력해야 합니다.")
    }

    await prisma.$transaction(async (tx) => {
      const now = new Date()
      const previousFinalUnitPrice = current.finalUnitPrice != null ? Number(current.finalUnitPrice) : null

      // status만 조건으로 두면 DECIDED→DECIDED 재결정(상태 자체는 안 바뀜)일 때
      // 두 재결정 요청이 모두 claim에 성공해 Revision chain이 동일 previousFinalUnitPrice
      // 에서 두 갈래로 갈라질 수 있다 — updatedAt을 optimistic-lock 토큰으로 함께
      // 요구해, 최초 결정(DRAFT→DECIDED)과 재결정(DECIDED→DECIDED) 모두 동일하게
      // "그 사이 다른 요청이 먼저 갱신했으면 0건" 방어를 받는다.
      const claimed = await tx.projectOrderPrice.updateMany({
        where: { id: current.id, tenantId, status: current.status, updatedAt: current.updatedAt },
        data: {
          finalUnitPrice: input.finalUnitPrice,
          status: "DECIDED",
          decidedAt: now,
          decidedById: actor.id,
          decisionReason: reason,
          updatedById: actor.id,
          updatedAt: now,
        },
      })
      if (claimed.count !== 1) {
        throw new Error("다른 요청에 의해 상태가 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
      }

      await tx.projectOrderPriceRevision.create({
        data: {
          tenantId,
          projectOrderPriceId: current.id,
          previousFinalUnitPrice,
          newFinalUnitPrice: input.finalUnitPrice,
          reason,
          changedById: actor.id,
          changedAt: now,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "ProjectOrderPrice",
          entityId: current.id,
          action: "UPDATE",
          beforeData: {
            status: current.status,
            finalUnitPrice: previousFinalUnitPrice,
            decidedAt: current.decidedAt,
            decidedById: current.decidedById,
            decisionReason: current.decisionReason,
          },
          afterData: {
            status: "DECIDED",
            finalUnitPrice: input.finalUnitPrice,
            decidedAt: now,
            decidedById: actor.id,
            decisionReason: reason,
          },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateProjectOrderPricePaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
