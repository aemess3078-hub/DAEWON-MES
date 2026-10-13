"use server"

import { getTenantId, requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { Prisma, PartnerType, PartnerStatus } from "@prisma/client"
import { requireResourcePermission } from "@/lib/auth/role-permissions"

export type BusinessPartner = {
  id: string
  tenantId: string
  code: string
  name: string
  partnerType: PartnerType
  status: PartnerStatus
  businessNumber: string | null
  ceoName: string | null
  phone: string | null
  email: string | null
  email2: string | null
  address: string | null
  contactName: string | null
  contactPhone: string | null
  remark: string | null
}

export type BusinessPartnerFormValues = {
  code: string
  name: string
  partnerType: PartnerType
  status: PartnerStatus
  businessNumber?: string | null
  ceoName?: string | null
  phone?: string | null
  email?: string | null
  email2?: string | null
  address?: string | null
  contactName?: string | null
  contactPhone?: string | null
  remark?: string | null
}

// 빈 문자열은 null로 저장 (선택 필드)
function nz(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

const PARTNER_DETAIL_FIELDS = [
  "businessNumber",
  "ceoName",
  "phone",
  "email",
  "email2",
  "address",
  "contactName",
  "contactPhone",
  "remark",
] as const

function partnerDetailData(data: BusinessPartnerFormValues) {
  const result: Record<string, string | null> = {}
  for (const field of PARTNER_DETAIL_FIELDS) {
    result[field] = nz(data[field])
  }
  return result
}

export async function getBusinessPartners(type?: "CUSTOMER" | "SUPPLIER"): Promise<BusinessPartner[]> {
  const tenantId = await getTenantId()
  const where: Prisma.BusinessPartnerWhereInput = { tenantId }
  if (type === "CUSTOMER") {
    where.partnerType = { in: [PartnerType.CUSTOMER, PartnerType.BOTH] }
  } else if (type === "SUPPLIER") {
    where.partnerType = { in: [PartnerType.SUPPLIER, PartnerType.BOTH] }
  }

  return prisma.businessPartner.findMany({ where, orderBy: { code: "asc" } })
}

export async function createBusinessPartner(_tenantId: string, data: BusinessPartnerFormValues): Promise<BusinessPartner> {
  await requireResourcePermission("PARTNER_MANAGEMENT", "CREATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const existing = await prisma.businessPartner.findFirst({
    where: { tenantId, code: data.code },
  })
  if (existing) throw new Error("DUPLICATE_CODE")

  const partner = await prisma.businessPartner.create({
    data: { tenantId, code: data.code, name: data.name, partnerType: data.partnerType, status: data.status, ...partnerDetailData(data) },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "BusinessPartner",
      entityId: partner.id,
      action: "CREATE",
      afterData: { code: partner.code, name: partner.name, partnerType: partner.partnerType, status: partner.status },
      menuName: "거래처 관리",
    },
  }).catch(() => {})
  return partner
}

export async function updateBusinessPartner(id: string, data: BusinessPartnerFormValues): Promise<BusinessPartner> {
  await requireResourcePermission("PARTNER_MANAGEMENT", "UPDATE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.businessPartner.findFirst({ where: { id, tenantId } })
  if (!owned) throw new Error("NOT_FOUND")

  const duplicate = await prisma.businessPartner.findFirst({
    where: { tenantId, code: data.code, NOT: { id } },
  })
  if (duplicate) throw new Error("DUPLICATE_CODE")

  const updated = await prisma.businessPartner.update({
    where: { id },
    data: { code: data.code, name: data.name, partnerType: data.partnerType, status: data.status, ...partnerDetailData(data) },
  })
  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "BusinessPartner",
      entityId: id,
      action: "UPDATE",
      beforeData: { code: owned.code, name: owned.name, partnerType: owned.partnerType, status: owned.status },
      afterData: { code: data.code, name: data.name, partnerType: data.partnerType, status: data.status },
      menuName: "거래처 관리",
    },
  }).catch(() => {})
  return updated
}

export async function deleteBusinessPartner(id: string): Promise<void> {
  await requireResourcePermission("PARTNER_MANAGEMENT", "DELETE")
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()
  const owned = await prisma.businessPartner.findFirst({ where: { id, tenantId } })
  await prisma.businessPartner.deleteMany({ where: { id, tenantId } })
  if (owned) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "BusinessPartner",
        entityId: id,
        action: "DELETE",
        beforeData: { code: owned.code, name: owned.name, partnerType: owned.partnerType, status: owned.status },
        menuName: "거래처 관리",
      },
    }).catch(() => {})
  }
}
