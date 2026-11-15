"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, requireRole } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { recordAuditLog, summarizeAuditItems } from "@/lib/audit-log"
import { kstDateParts, withUniqueBusinessNumberRetry } from "@/lib/business-numbering"
import { NEW_SALES_ORDER_STATUS } from "@/lib/sales-order-status"
import { getErrorMessage } from "@/lib/utils"
import {
  SALES_ORDER_EXCEL_MAX_ROWS,
  buildSalesOrderPlan,
  findMissingSalesOrderColumns,
  parseSalesOrderExcelRows,
  type SalesOrderExcelContext,
  type SalesOrderExcelPlan,
  type SalesOrderExcelRawRow,
} from "@/lib/sales-order-excel"
import { revalidatePath } from "next/cache"
import { Prisma, type SalesOrderStatus } from "@prisma/client"

// ─── 공개 타입 ────────────────────────────────────────────────────────────────

export type SalesOrderExcelUploadInput = {
  /** 파일 헤더 이름(별표 제외) */
  headers: string[]
  rows: SalesOrderExcelRawRow[]
}

export type SalesOrderExcelCreated = {
  orderNo: string
  orderGroupId: string
  itemCount: number
}

type Db = Prisma.TransactionClient | typeof prisma

const MAX_HEADERS = 50
const MAX_CELL_TEXT = 2000

// ─── 내부 유틸 ────────────────────────────────────────────────────────────────

function validateInputShape(input: SalesOrderExcelUploadInput): string | null {
  if (!input || !Array.isArray(input.headers) || !Array.isArray(input.rows)) return "업로드 데이터 형식이 올바르지 않습니다."
  if (input.rows.length === 0) return "등록할 데이터 행이 없습니다."
  if (input.rows.length > SALES_ORDER_EXCEL_MAX_ROWS) {
    return `최대 ${SALES_ORDER_EXCEL_MAX_ROWS.toLocaleString("ko-KR")}행까지 업로드할 수 있습니다. (현재: ${input.rows.length.toLocaleString("ko-KR")}행)`
  }
  if (input.headers.length > MAX_HEADERS) return "엑셀 열 수가 너무 많습니다. 표준 양식을 사용하세요."
  const missing = findMissingSalesOrderColumns(input.headers)
  if (missing.length > 0) return `필수 열이 없습니다: ${missing.join(", ")}. 표준 양식을 사용하세요.`
  for (const r of input.rows) {
    if (!r || typeof r.rowNum !== "number" || typeof r.cells !== "object" || r.cells === null) {
      return "업로드 데이터 형식이 올바르지 않습니다."
    }
    for (const v of Object.values(r.cells)) {
      if (typeof v === "string" && v.length > MAX_CELL_TEXT) return "셀 내용이 너무 깁니다. 엑셀 내용을 확인하세요."
    }
  }
  return null
}

/** 엑셀에 나온 거래처·품목·기존 수주만 골라 읽는다(테넌트 격리). */
async function loadSalesOrderExcelContext(
  db: Db,
  tenantId: string,
  parsedCodes: { customers: string[]; items: string[]; poNos: string[] },
  dateRange: { min: string; max: string } | null,
): Promise<SalesOrderExcelContext> {
  const [partners, items] = await Promise.all([
    parsedCodes.customers.length === 0
      ? Promise.resolve([])
      : db.businessPartner.findMany({
          where: { tenantId, code: { in: parsedCodes.customers } },
          select: { id: true, code: true, name: true, status: true, partnerType: true },
        }),
    parsedCodes.items.length === 0
      ? Promise.resolve([])
      : db.item.findMany({
          where: { tenantId, code: { in: parsedCodes.items } },
          select: { id: true, code: true, name: true, status: true, itemType: true },
        }),
  ])

  const customerIds = partners.map((p) => p.id)
  // 비교 후보: (a) 엑셀에 나온 발주번호와 같은(대소문자 무시) 수주, (b) 같은 수주일 범위의 수주(발주번호 없는 수주의 내용 비교용)
  const candidateFilters: Prisma.SalesOrderWhereInput[] = parsedCodes.poNos.map((po) => ({
    customerPoNo: { equals: po, mode: "insensitive" as const },
  }))
  if (dateRange) {
    candidateFilters.push({
      orderDate: {
        gte: new Date(`${dateRange.min}T00:00:00.000Z`),
        lte: new Date(`${dateRange.max}T23:59:59.999Z`),
      },
    })
  }
  const existing =
    customerIds.length === 0 || candidateFilters.length === 0
      ? []
      : await db.salesOrder.findMany({
          where: { tenantId, customerId: { in: customerIds }, status: { not: "CANCELLED" }, OR: candidateFilters },
          select: {
            orderNo: true,
            customerId: true,
            customerPoNo: true,
            orderDate: true,
            deliveryDate: true,
            status: true,
            items: { select: { itemId: true, qty: true, item: { select: { code: true } } } },
          },
          orderBy: { createdAt: "desc" },
          take: 2000,
        })

  return {
    customers: partners.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      partnerType: p.partnerType,
    })),
    items: items.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      status: i.status,
      itemType: i.itemType,
    })),
    existingOrders: existing.map((o) => ({
      orderNo: o.orderNo,
      customerId: o.customerId,
      orderDate: o.orderDate.toISOString().slice(0, 10),
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      status: o.status,
      customerPoNo: o.customerPoNo,
      items: o.items.map((i) => ({ itemId: i.itemId, qty: Number(i.qty) })),
      itemSummary: o.items.map((i) => `${i.item.code} ×${Number(i.qty)}`).join(", "),
    })),
  }
}

/** 파싱 → 기준정보 대조 → 계획. DB 쓰기 없음. */
async function buildPlanForInput(db: Db, tenantId: string, input: SalesOrderExcelUploadInput, confirmedGroupIds: string[]): Promise<SalesOrderExcelPlan> {
  const { parsed, issues } = parseSalesOrderExcelRows(input.rows)
  const customers = Array.from(new Set(parsed.map((r) => r.customerCode).filter(Boolean)))
  const items = Array.from(new Set(parsed.map((r) => r.itemCode).filter(Boolean)))
  const validDates = parsed.flatMap((r) => (r.orderDate ? [r.orderDate] : [])).sort()
  const dateRange = validDates.length > 0 ? { min: validDates[0], max: validDates[validDates.length - 1] } : null
  const poNos = Array.from(new Set(parsed.map((r) => r.customerPoNo).filter(Boolean)))
  const ctx = await loadSalesOrderExcelContext(db, tenantId, { customers, items, poNos }, dateRange)
  return buildSalesOrderPlan(parsed, issues, ctx, confirmedGroupIds)
}

// ─── 미리보기 (DB 변경 없음) ──────────────────────────────────────────────────

export async function validateSalesOrderExcelRows(
  input: SalesOrderExcelUploadInput,
  confirmedGroupIds: string[] = [],
): Promise<{ success: true; plan: SalesOrderExcelPlan } | { success: false; error: string }> {
  try {
    const tenantId = await getTenantId()
    await requireRole("OPERATOR")
    await requireResourcePermission("SALES_ORDER", "CREATE")

    const shapeError = validateInputShape(input)
    if (shapeError) return { success: false, error: shapeError }

    const plan = await buildPlanForInput(prisma, tenantId, input, confirmedGroupIds)
    return { success: true, plan }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

// ─── 일괄 등록 (서버 재검증 후 한 트랜잭션) ──────────────────────────────────

export async function importSalesOrderExcelRows(
  input: SalesOrderExcelUploadInput,
  siteId: string,
  /** 중복 의심을 확인하고 그대로 등록하기로 한 수주그룹ID. 목록에 없는 의심 수주가 있으면 등록하지 않는다. */
  confirmedGroupIds: string[] = [],
): Promise<
  | { success: true; created: SalesOrderExcelCreated[] }
  | { success: false; error: string; plan?: SalesOrderExcelPlan }
> {
  try {
    const tenantId = await getTenantId()
    const actor = await requireRole("OPERATOR")
    await requireResourcePermission("SALES_ORDER", "CREATE")
    if (actor.tenantId !== tenantId) return { success: false, error: "접근 권한이 없습니다." }

    const shapeError = validateInputShape(input)
    if (shapeError) return { success: false, error: shapeError }

    const site = await prisma.site.findFirst({ where: { id: siteId, tenantId }, select: { id: true } })
    if (!site) return { success: false, error: "사업장 정보를 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 시도하세요." }

    const outcome = await withUniqueBusinessNumberRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            // 같은 테넌트의 엑셀 등록을 직렬화한다(중복 검사와 번호 채번의 경쟁 방지). 트랜잭션 끝에 자동 해제.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sales-order-excel:" + tenantId}))`

            // 등록 직전에 다시 검증한다(미리보기 이후 기준정보·기존 수주가 바뀌었을 수 있다)
            const plan = await buildPlanForInput(tx, tenantId, input, confirmedGroupIds)
            if (!plan.canImport) return { ok: false as const, plan }

            const { year } = kstDateParts()
            const prefix = `SO-${year}-`
            const last = await tx.salesOrder.findFirst({
              where: { tenantId, orderNo: { startsWith: prefix } },
              orderBy: { orderNo: "desc" },
              select: { orderNo: true },
            })
            let seq = last ? (parseInt(last.orderNo.split("-")[2] ?? "0", 10) || 0) : 0

            const created: SalesOrderExcelCreated[] = []
            for (const group of plan.groups) {
              seq += 1
              const orderNo = `${prefix}${String(seq).padStart(3, "0")}`
              const totalAmount = group.totalAmount ?? undefined
              const order = await tx.salesOrder.create({
                data: {
                  tenantId,
                  siteId,
                  customerId: group.customerId!,
                  orderNo,
                  orderDate: new Date(`${group.orderDate}T00:00:00.000Z`),
                  deliveryDate: new Date(`${group.deliveryDate}T00:00:00.000Z`),
                  status: NEW_SALES_ORDER_STATUS as SalesOrderStatus,
                  totalAmount,
                  currency: group.currency,
                  note: group.note || undefined,
                  customerPoNo: group.customerPoNo || null,
                  items: {
                    create: group.lines.map((l) => ({
                      itemId: l.itemId,
                      qty: l.qty,
                      unitPrice: l.unitPrice ?? undefined,
                    })),
                  },
                },
              })
              await recordAuditLog(tx, {
                tenantId,
                actor,
                entityType: "SalesOrder",
                entityId: order.id,
                action: "CREATE",
                afterData: {
                  orderNo,
                  siteId,
                  customerId: group.customerId,
                  status: NEW_SALES_ORDER_STATUS,
                  itemCount: group.lines.length,
                  source: "EXCEL_UPLOAD",
                  orderGroupId: group.groupId,
                  customerPoNo: group.customerPoNo || null,
                  duplicateConfirmed: plan.duplicates.some((d) => d.groupId === group.groupId),
                  items: summarizeAuditItems(
                    group.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice })),
                    ["itemId", "qty", "unitPrice"],
                  ),
                },
                menuName: "수주관리",
              })
              created.push({ orderNo, orderGroupId: group.groupId, itemCount: group.lines.length })
            }
            return { ok: true as const, created }
          },
          { maxWait: 10_000, timeout: 60_000 },
        ),
      { fields: ["tenantId", "orderNo"], message: "수주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." },
    )

    if (!outcome.ok) {
      return {
        success: false,
        error:
          outcome.plan.issues.length > 0
            ? `검증 오류가 ${outcome.plan.issues.length}건 있어 등록하지 않았습니다. 오류를 수정한 뒤 다시 업로드하세요.`
            : "확인하지 않은 중복 의심 수주가 있어 등록하지 않았습니다. 기존 수주를 확인하고 등록할 수주를 선택하세요.",
        plan: outcome.plan,
      }
    }

    revalidatePath("/app/mes/sales-orders")
    return { success: true, created: outcome.created }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
