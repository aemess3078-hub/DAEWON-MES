import * as fs from "node:fs"
import { join } from "node:path"
import { register } from "tsconfig-paths"
import { chromium, expect } from "@playwright/test"
import { BOMStatus, ItemType, PartnerType, PlanStatus, RoutingScope, RoutingStatus, ShipmentStatus, SiteType, UOM, WorkCenterKind, WorkOrderStatus } from "@prisma/client"

register({ baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } })

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = join(process.cwd(), file)
    if (!fs.existsSync(path)) continue
    for (const raw of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      const idx = line.indexOf("=")
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      if (process.env[key]) continue
      let value = line.slice(idx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      process.env[key] = value
    }
  }
}

loadLocalEnv()
const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const { hashPassword } = require("../src/lib/password") as typeof import("../src/lib/password")

const BASE_URL = process.env.F22_SMOKE_BASE_URL ?? "http://localhost:3000"
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? "tenant-demo-001"
const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
const BROWSER_EXECUTABLE = process.env.F22_SMOKE_BROWSER ?? (fs.existsSync(DEFAULT_CHROME_PATH) ? DEFAULT_CHROME_PATH : undefined)
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const prefix = `F22SMOKE-${suffix}`
const password = `F22Smoke!${suffix.slice(-5)}1`
const loginId = `f22smoke-${suffix}`.toLowerCase()

const ids: Record<string, string[]> = {
  productionResult: [],
  finishedGoodsReceipt: [],
  shipmentItem: [],
  shipmentOrder: [],
  workOrderOperation: [],
  workOrder: [],
  productionPlanItem: [],
  productionPlan: [],
  salesOrderItem: [],
  salesOrder: [],
  routingOperation: [],
  routing: [],
  bom: [],
  location: [],
  warehouse: [],
  workCenter: [],
  item: [],
  businessPartner: [],
  userCredential: [],
  tenantUser: [],
  profile: [],
}

async function cleanup() {
  await prisma.loginHistory.deleteMany({ where: { loginId } })
  await prisma.productionResult.deleteMany({ where: { id: { in: ids.productionResult } } })
  await prisma.finishedGoodsReceipt.deleteMany({ where: { id: { in: ids.finishedGoodsReceipt } } })
  await prisma.shipmentItem.deleteMany({ where: { id: { in: ids.shipmentItem } } })
  await prisma.shipmentOrder.deleteMany({ where: { id: { in: ids.shipmentOrder } } })
  await prisma.workOrderOperation.deleteMany({ where: { id: { in: ids.workOrderOperation } } })
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.workOrder } } })
  await prisma.productionPlanItem.deleteMany({ where: { id: { in: ids.productionPlanItem } } })
  await prisma.productionPlan.deleteMany({ where: { id: { in: ids.productionPlan } } })
  await prisma.salesOrderItem.deleteMany({ where: { id: { in: ids.salesOrderItem } } })
  await prisma.salesOrder.deleteMany({ where: { id: { in: ids.salesOrder } } })
  await prisma.routingOperation.deleteMany({ where: { id: { in: ids.routingOperation } } })
  await prisma.routing.deleteMany({ where: { id: { in: ids.routing } } })
  await prisma.bOM.deleteMany({ where: { id: { in: ids.bom } } })
  await prisma.location.deleteMany({ where: { id: { in: ids.location } } })
  await prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouse } } })
  await prisma.workCenter.deleteMany({ where: { id: { in: ids.workCenter } } })
  await prisma.item.deleteMany({ where: { id: { in: ids.item } } })
  await prisma.businessPartner.deleteMany({ where: { id: { in: ids.businessPartner } } })
  await prisma.userCredential.deleteMany({ where: { id: { in: ids.userCredential } } })
  await prisma.tenantUser.deleteMany({ where: { id: { in: ids.tenantUser } } })
  await prisma.profile.deleteMany({ where: { id: { in: ids.profile } } })
}

async function createFixture() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: DEFAULT_TENANT_ID } })
  const site = await prisma.site.findFirst({ where: { tenantId: tenant.id } }) ?? await prisma.site.create({ data: { tenantId: tenant.id, code: `${prefix}-SITE`, name: "F22 Smoke Site", type: SiteType.FACTORY } })
  if (site.code.startsWith(prefix)) ids.site?.push?.(site.id)

  const profile = await prisma.profile.create({ data: { email: `${loginId}@example.invalid`, name: "F22 Smoke Owner" } })
  ids.profile.push(profile.id)
  const tenantUser = await prisma.tenantUser.create({ data: { tenantId: tenant.id, profileId: profile.id, siteId: site.id, role: "OWNER" } })
  ids.tenantUser.push(tenantUser.id)
  const credential = await prisma.userCredential.create({ data: { tenantId: tenant.id, profileId: profile.id, loginId, passwordHash: await hashPassword(password), mustChangePw: false } })
  ids.userCredential.push(credential.id)

  const customer = await prisma.businessPartner.create({ data: { tenantId: tenant.id, code: `${prefix}-CUST`, name: "F22 Smoke Customer", partnerType: PartnerType.CUSTOMER } })
  ids.businessPartner.push(customer.id)
  const item = await prisma.item.create({ data: { tenantId: tenant.id, code: `${prefix}-FG`, name: "F22 Smoke Item", itemType: ItemType.FINISHED, uom: UOM.EA } })
  ids.item.push(item.id)
  const workCenter = await prisma.workCenter.create({ data: { siteId: site.id, code: `${prefix}-WC`, name: "F22 Smoke WC", kind: WorkCenterKind.ASSEMBLY } })
  ids.workCenter.push(workCenter.id)
  const routing = await prisma.routing.create({ data: { tenantId: tenant.id, code: `${prefix}-RT`, name: "F22 Smoke Routing", version: "1", status: RoutingStatus.ACTIVE, scope: RoutingScope.COMMON } })
  ids.routing.push(routing.id)
  const routingOperation = await prisma.routingOperation.create({ data: { routingId: routing.id, workCenterId: workCenter.id, seq: 10, operationCode: `${prefix}-OP10`, name: "Final" } })
  ids.routingOperation.push(routingOperation.id)
  const bom = await prisma.bOM.create({ data: { tenantId: tenant.id, itemId: item.id, version: "1", status: BOMStatus.ACTIVE, isDefault: true } })
  ids.bom.push(bom.id)
  const warehouse = await prisma.warehouse.create({ data: { tenantId: tenant.id, siteId: site.id, code: `${prefix}-WH`, name: "F22 Smoke WH" } })
  ids.warehouse.push(warehouse.id)
  const location = await prisma.location.create({ data: { warehouseId: warehouse.id, code: `${prefix}-LOC`, name: "F22 Smoke LOC" } })
  ids.location.push(location.id)

  async function salesOrder(label: string, qty: number, shippedQty: number) {
    const so = await prisma.salesOrder.create({
      data: {
        tenantId: tenant.id,
        siteId: site.id,
        customerId: customer.id,
        orderNo: `${prefix}-${label}-SO`,
        orderDate: new Date("2026-09-20T00:00:00+09:00"),
        deliveryDate: new Date("2026-09-27T00:00:00+09:00"),
        status: "IN_PRODUCTION",
        items: { create: { itemId: item.id, qty, shippedQty, deliveryDate: new Date("2026-09-27T00:00:00+09:00") } },
      },
      include: { items: true },
    })
    ids.salesOrder.push(so.id)
    ids.salesOrderItem.push(so.items[0].id)
    return so
  }

  const progressSo = await salesOrder("PROGRESS", 20, 5)
  const progressPlan = await prisma.productionPlan.create({ data: { tenantId: tenant.id, siteId: site.id, planNo: `${prefix}-BLOCKED-PLAN`, planType: "DAILY", startDate: new Date("2026-09-25T00:00:00+09:00"), endDate: new Date("2026-09-30T00:00:00+09:00"), status: PlanStatus.CONFIRMED, items: { create: { itemId: item.id, bomId: bom.id, routingId: routing.id, plannedQty: 20, salesOrderItemId: progressSo.items[0].id } } }, include: { items: true } })
  ids.productionPlan.push(progressPlan.id); ids.productionPlanItem.push(progressPlan.items[0].id)
  const wo = await prisma.workOrder.create({ data: { tenantId: tenant.id, siteId: site.id, itemId: item.id, bomId: bom.id, routingId: routing.id, productionPlanItemId: progressPlan.items[0].id, orderNo: `${prefix}-WO`, plannedQty: 20, status: WorkOrderStatus.IN_PROGRESS, dueDate: new Date("2026-09-30T00:00:00+09:00"), operations: { create: { routingOperationId: routingOperation.id, seq: 10, plannedQty: 20, completedQty: 8, status: "IN_PROGRESS" } } }, include: { operations: true } })
  ids.workOrder.push(wo.id); ids.workOrderOperation.push(...wo.operations.map((row) => row.id))
  const result = await prisma.productionResult.create({ data: { workOrderOperationId: wo.operations[0].id, goodQty: 8, startedAt: new Date("2026-09-26T00:00:00+09:00") } })
  ids.productionResult.push(result.id)
  const receipt = await prisma.finishedGoodsReceipt.create({ data: { tenantId: tenant.id, siteId: site.id, workOrderId: wo.id, itemId: item.id, warehouseId: warehouse.id, locationId: location.id, receiptQty: 3 } })
  ids.finishedGoodsReceipt.push(receipt.id)
  const shipment = await prisma.shipmentOrder.create({ data: { tenantId: tenant.id, siteId: site.id, salesOrderId: progressSo.id, shipmentNo: `${prefix}-SHIP`, status: ShipmentStatus.PLANNED, plannedDate: new Date("2026-09-30T00:00:00+09:00"), items: { create: { salesOrderItemId: progressSo.items[0].id, itemId: item.id, qty: 4 } } }, include: { items: true } })
  ids.shipmentOrder.push(shipment.id); ids.shipmentItem.push(shipment.items[0].id)

  const cancelSo = await salesOrder("CANCEL", 10, 0)
  const cancelPlan = await prisma.productionPlan.create({ data: { tenantId: tenant.id, siteId: site.id, planNo: `${prefix}-CANCEL-PLAN`, planType: "DAILY", startDate: new Date("2026-09-25T00:00:00+09:00"), endDate: new Date("2026-09-30T00:00:00+09:00"), status: PlanStatus.CONFIRMED, items: { create: { itemId: item.id, bomId: bom.id, routingId: routing.id, plannedQty: 10, salesOrderItemId: cancelSo.items[0].id } } }, include: { items: true } })
  ids.productionPlan.push(cancelPlan.id); ids.productionPlanItem.push(cancelPlan.items[0].id)

  return { progressSo, progressPlan, cancelSo, cancelPlan }
}

async function main() {
  const fixture = await createFixture()
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_EXECUTABLE })
  const page = await browser.newPage()
  async function waitForSalesOrderStatus(salesOrderId: string, expected: string) {
    for (let i = 0; i < 20; i++) {
      const row = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, select: { status: true } })
      if (row?.status === expected) return
      await page.waitForTimeout(500)
    }
    const row = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, select: { status: true } })
    throw new Error(`SalesOrder status did not become ${expected}; actual=${row?.status}`)
  }
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" })
    await page.getByRole("button", { name: /시스템모드/ }).click()
    await page.fill("#loginId", loginId)
    await page.fill("#password", password)
    await page.getByRole("button", { name: /로그인/ }).click()
    await page.waitForURL(/\/app/, { timeout: 15000 })

    await page.goto(`${BASE_URL}/app/mes/sales-orders`, { waitUntil: "networkidle" })
    await page.getByText(fixture.progressSo.orderNo).click()
    await expect(page.getByText("생산·출하 진행상황")).toBeVisible()
    for (const text of ["수주수량", "생산계획", "작업지시", "생산실적", "완제품입고", "출하", "잔량", "고객 납기일", "납기 경과"]) {
      await expect(page.getByText(text).first()).toBeVisible()
    }
    await expect(page.getByText(fixture.progressPlan.planNo).first()).toBeVisible()
    await expect(page.getByText(fixture.progressSo.orderNo).first()).toBeVisible()

    await page.goto(`${BASE_URL}/app/mes/production-plan?salesOrderId=${fixture.progressSo.id}`, { waitUntil: "networkidle" })
    await expect(page.getByText(fixture.progressPlan.planNo)).toBeVisible()
    await expect(page.getByText("2026-09-27").first()).toBeVisible()
    const blockedRow = page.locator("tr", { hasText: fixture.progressPlan.planNo })
    await blockedRow.getByRole("button", { name: "메뉴 열기" }).click()
    await page.getByRole("menuitem", { name: /수정/ }).click()
    const editDialog = page.getByRole("dialog", { name: /생산계획 수정/ })
    await expect(editDialog).toBeVisible()
    await editDialog.getByRole("combobox").filter({ hasText: "확정" }).first().click()
    await expect(page.getByRole("option", { name: "취소" })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await page.goto(`${BASE_URL}/app/mes/production-plan?salesOrderId=${fixture.progressSo.id}`, { waitUntil: "networkidle" })
    await expect(page.getByText(fixture.progressPlan.planNo)).toBeVisible()
    const blockedRowAfterEditCheck = page.locator("tr", { hasText: fixture.progressPlan.planNo })
    await blockedRowAfterEditCheck.getByRole("button", { name: "메뉴 열기" }).click()
    await page.getByRole("menuitem", { name: /취소/ }).click()
    await page.getByRole("button", { name: "취소 확정" }).click()
    await expect(page.getByText("취소사유를 입력하세요.")).toBeVisible()
    await page.locator("textarea").fill("work order block smoke")
    await page.getByRole("button", { name: "취소 확정" }).click()
    await expect(page.getByText("연결된 작업지시가 있습니다")).toBeVisible()
    await page.keyboard.press("Escape")

    await page.goto(`${BASE_URL}/app/mes/production-plan?salesOrderId=${fixture.cancelSo.id}`, { waitUntil: "networkidle" })
    await expect(page.getByText(fixture.cancelPlan.planNo)).toBeVisible()
    const cancelRow = page.locator("tr", { hasText: fixture.cancelPlan.planNo })
    await cancelRow.getByRole("button", { name: "메뉴 열기" }).click()
    await page.getByRole("menuitem", { name: /취소/ }).click()
    await page.getByRole("button", { name: "취소 확정" }).click()
    await expect(page.getByText("취소사유를 입력하세요.")).toBeVisible()
    await page.locator("textarea").fill("normal cancel smoke")
    await page.getByRole("button", { name: "취소 확정" }).click()
    await waitForSalesOrderStatus(fixture.cancelSo.id, "CONFIRMED")

    await page.goto(`${BASE_URL}/app/mes/sales-orders`, { waitUntil: "networkidle" })
    await expect(page.locator("tr", { hasText: fixture.cancelSo.orderNo }).getByText("확정")).toBeVisible({ timeout: 15000 })
    await page.getByText(fixture.cancelSo.orderNo).click()
    await expect(page.getByText("확정").first()).toBeVisible({ timeout: 15000 })
  } finally {
    await browser.close()
  }
}

main()
  .then(async () => {
    console.log("F22 browser smoke passed")
  })
  .catch(async (error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
  })
