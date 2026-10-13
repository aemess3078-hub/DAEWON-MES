"use server"

import { prisma } from "@/lib/db/prisma"
import { QuotationStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import type { QuotationFormValues } from "@/app/app/mes/quotations/quotation-form-schema"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { generateSalesOrderNo } from "@/lib/actions/sales-order.actions"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export type QuotationWithDetails = {
  id: string
  tenantId: string
  siteId: string
  customerId: string
  quotationNo: string
  quotationDate: Date
  validUntil: Date
  status: QuotationStatus
  totalAmount: number | null
  currency: string
  note: string | null
  convertedSalesOrderId: string | null
  createdAt: Date
  updatedAt: Date
  customer: { id: string; code: string; name: string }
  site: { id: string; code: string; name: string; type: string }
  items: Array<{
    id: string
    quotationId: string
    itemId: string
    qty: number
    unitPrice: number
    note: string | null
    item: { id: string; code: string; name: string; itemType: string; uom: string }
  }>
}

function serializeQuotation(q: any): QuotationWithDetails {
  return {
    ...q,
    totalAmount: q.totalAmount ? Number(q.totalAmount) : null,
    items: q.items.map((item: any) => ({
      ...item,
      qty: Number(item.qty),
      unitPrice: Number(item.unitPrice),
    })),
  }
}

const QUOTATION_INCLUDE = {
  customer: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, code: true, name: true, type: true } },
  items: {
    include: {
      item: { select: { id: true, code: true, name: true, itemType: true, uom: true } },
    },
  },
} as const

export async function getQuotations(): Promise<QuotationWithDetails[]> {
  await assertDaewonFeatureScope()
  const results = await prisma.quotation.findMany({
    include: QUOTATION_INCLUDE,
    orderBy: { createdAt: "desc" },
  })
  return results.map(serializeQuotation)
}

export async function getQuotationById(id: string): Promise<QuotationWithDetails | null> {
  await assertDaewonFeatureScope()
  const result = await prisma.quotation.findUnique({
    where: { id },
    include: QUOTATION_INCLUDE,
  })
  return result ? serializeQuotation(result) : null
}

export async function getCustomersForQuotation() {
  await assertDaewonFeatureScope()
  return prisma.businessPartner.findMany({
    where: { partnerType: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export async function getFinishedItems() {
  await assertDaewonFeatureScope()
  return prisma.item.findMany({
    where: { itemType: { in: ["FINISHED", "SEMI_FINISHED"] }, status: "ACTIVE" },
    select: { id: true, code: true, name: true, itemType: true, uom: true },
    orderBy: { name: "asc" },
  })
}

export async function getItemPriceForCustomer(
  itemId: string,
  customerId: string
): Promise<number | null> {
  await assertDaewonFeatureScope()
  const result = await prisma.itemPrice.findFirst({
    where: {
      itemId,
      partnerId: customerId,
      priceType: "SALES",
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
    },
    orderBy: { effectiveFrom: "desc" },
  })
  return result ? Number(result.unitPrice) : null
}

async function generateQuotationNo(tenantId: string): Promise<string> {
  const { year } = kstDateParts()
  const prefix = `QT-${year}-`
  const last = await prisma.quotation.findFirst({
    where: { tenantId, quotationNo: { startsWith: prefix } },
    orderBy: { quotationNo: "desc" },
    select: { quotationNo: true },
  })
  const seq = last ? (parseInt(last.quotationNo.split("-")[2] ?? "0", 10) || 0) + 1 : 1
  return `${prefix}${String(seq).padStart(3, "0")}`
}

export async function createQuotation(data: QuotationFormValues, tenantId: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUOTATION", "CREATE")
  const quotationNo = await generateQuotationNo(tenantId)
  const totalAmount = data.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)

  const sites = await prisma.site.findMany({ where: { tenantId }, take: 1 })
  const siteId = data.siteId || sites[0]?.id

  await prisma.quotation.create({
    data: {
      tenantId,
      siteId,
      customerId: data.customerId,
      quotationNo,
      quotationDate: new Date(data.quotationDate),
      validUntil: new Date(data.validUntil),
      status: (data.status as QuotationStatus) ?? "DRAFT",
      totalAmount,
      currency: data.currency ?? "KRW",
      note: data.note,
      items: {
        create: data.items.map((item) => ({
          itemId: item.itemId,
          qty: item.qty,
          unitPrice: item.unitPrice,
          note: item.note,
        })),
      },
    },
  })
  revalidatePath("/app/mes/quotations")
}

export async function updateQuotation(id: string, data: QuotationFormValues) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUOTATION", "UPDATE")
  const current = await prisma.quotation.findUniqueOrThrow({ where: { id } })
  const lockedStatuses: QuotationStatus[] = ["WON", "LOST", "EXPIRED", "CANCELLED"]
  if (lockedStatuses.includes(current.status)) {
    throw new Error("이 상태에서는 수정할 수 없습니다")
  }

  const totalAmount = data.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0)

  await prisma.$transaction([
    prisma.quotationItem.deleteMany({ where: { quotationId: id } }),
    prisma.quotation.update({
      where: { id },
      data: {
        customerId: data.customerId,
        siteId: data.siteId,
        quotationDate: new Date(data.quotationDate),
        validUntil: new Date(data.validUntil),
        status: data.status as QuotationStatus,
        totalAmount,
        currency: data.currency ?? "KRW",
        note: data.note,
        items: {
          create: data.items.map((item) => ({
            itemId: item.itemId,
            qty: item.qty,
            unitPrice: item.unitPrice,
            note: item.note,
          })),
        },
      },
    }),
  ])
  revalidatePath("/app/mes/quotations")
}

export async function deleteQuotation(id: string) {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUOTATION", "DELETE")
  const current = await prisma.quotation.findUniqueOrThrow({ where: { id } })
  if (current.status !== "DRAFT") {
    throw new Error("초안(DRAFT) 상태의 견적만 삭제할 수 있습니다")
  }
  // PR #52A에서 ProjectOrderPrice.quotationId → Quotation FK가 ON DELETE RESTRICT로
  // 추가된다. 아래 삭제는 이미 트랜잭션이라 partial delete 위험은 없지만, raw FK
  // 오류 대신 사용자 친화적인 메시지로 막는다.
  const priceRefCount = await prisma.projectOrderPrice.count({ where: { quotationId: id } })
  if (priceRefCount > 0) {
    throw new Error("프로젝트 단가정보에서 사용 중인 견적은 삭제할 수 없습니다.")
  }
  await prisma.$transaction([
    prisma.quotationItem.deleteMany({ where: { quotationId: id } }),
    prisma.quotation.delete({ where: { id } }),
  ])
  revalidatePath("/app/mes/quotations")
}

export async function convertToSalesOrder(
  quotationId: string,
  tenantId: string
): Promise<string> {
  await assertDaewonFeatureScope()
  await requireResourcePermission("QUOTATION", "UPDATE")
  await requireResourcePermission("SALES_ORDER", "CREATE")
  const quotation = await prisma.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: { items: true },
  })

  if (quotation.status !== "WON") {
    throw new Error("수주 확정(WON) 상태의 견적만 수주로 전환할 수 있습니다")
  }
  if (quotation.convertedSalesOrderId) {
    throw new Error("이미 수주로 전환된 견적입니다")
  }

  const result = await withUniqueBusinessNumberRetry(async () => {
    const orderNo = await generateSalesOrderNo(tenantId)
    return prisma.$transaction(async (tx) => {
      const salesOrder = await tx.salesOrder.create({
        data: {
          tenantId,
          siteId: quotation.siteId,
          customerId: quotation.customerId,
          orderNo,
          orderDate: new Date(),
          deliveryDate: quotation.validUntil,
          status: "DRAFT",
          totalAmount: quotation.totalAmount,
          currency: quotation.currency,
          note: `견적 ${quotation.quotationNo}에서 전환`,
          items: {
            create: quotation.items.map((item) => ({
              itemId: item.itemId,
              qty: item.qty,
              unitPrice: item.unitPrice,
            })),
          },
        },
      })

      await tx.quotation.update({
        where: { id: quotationId },
        data: { convertedSalesOrderId: salesOrder.id },
      })

      return salesOrder
    })
  }, { fields: ["tenantId", "orderNo"], message: "수주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." })

  revalidatePath("/app/mes/quotations")
  revalidatePath("/app/mes/sales-orders")
  return result.id
}
