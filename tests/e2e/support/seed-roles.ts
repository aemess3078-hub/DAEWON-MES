/**
 * 권한 테스트용 계정/데이터 준비 — 로컬 테스트 DB 전용(가드 통과 시에만 실행).
 *
 *  - 같은 테넌트(e2e-tenant-001)에 ADMIN / MANAGER / OPERATOR / VIEWER 계정을 만든다.
 *  - 별도 테넌트(e2e-tenant-002)와 그 테넌트 전용 샘플 데이터(E2E-T2-*)를 만든다(테넌트 격리 검증용).
 *  - 비밀번호는 실행마다 무작위로 만들어 인자로 받은 env 파일에만 기록한다(저장소/출력에 남기지 않음).
 *
 * 실행: ts-node --project tsconfig.json tests/e2e/support/seed-roles.ts <roles.env 경로>
 * 삭제: 같은 인자 + REMOVE=1  (E2E 계정/테넌트2 데이터만 제거)
 */
import * as fs from "node:fs"
import * as crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { PrismaClient, type UserRole } from "@prisma/client"
import { assertLocalTestDbOrExit } from "../../../scripts/helpers/local-test-db-guard"

assertLocalTestDbOrExit("e2e-roles", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://127.0.0.1:3130" })

const T1 = process.env.DEFAULT_TENANT_ID as string
const T2 = "e2e-tenant-002"
const out = process.argv[2]
if (!out) throw new Error("roles.env 경로 인자가 필요합니다.")
if (T1 === T2) throw new Error("테넌트 ID 충돌")

const prisma = new PrismaClient()
const ROLES: { loginId: string; role: UserRole; tenantId: string; key: string }[] = [
  { loginId: "e2e-role-admin", role: "ADMIN", tenantId: T1, key: "ADMIN" },
  { loginId: "e2e-role-manager", role: "MANAGER", tenantId: T1, key: "MANAGER" },
  { loginId: "e2e-role-operator", role: "OPERATOR", tenantId: T1, key: "OPERATOR" },
  { loginId: "e2e-role-viewer", role: "VIEWER", tenantId: T1, key: "VIEWER" },
  { loginId: "e2e-t2-owner", role: "OWNER", tenantId: T2, key: "T2OWNER" },
]

async function remove() {
  for (const r of ROLES) {
    const cred = await prisma.userCredential.findUnique({ where: { tenantId_loginId: { tenantId: r.tenantId, loginId: r.loginId } } })
    if (!cred) continue
    await prisma.tenantUser.deleteMany({ where: { profileId: cred.profileId } })
    await prisma.userCredential.delete({ where: { id: cred.id } })
    await prisma.profile.deleteMany({ where: { id: cred.profileId } })
  }
  // 테넌트 2 업무 샘플(수주/발주/계획/작업지시) — 참조 순서대로 삭제
  await prisma.workOrderOperation.deleteMany({ where: { workOrder: { tenantId: T2 } } })
  await prisma.workOrder.deleteMany({ where: { tenantId: T2 } })
  await prisma.productionPlanItem.deleteMany({ where: { plan: { tenantId: T2 } } })
  await prisma.productionPlan.deleteMany({ where: { tenantId: T2 } })
  await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { tenantId: T2 } } })
  await prisma.purchaseOrder.deleteMany({ where: { tenantId: T2 } })
  await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { tenantId: T2 } } })
  await prisma.salesOrder.deleteMany({ where: { tenantId: T2 } })
  await prisma.routingOperation.deleteMany({ where: { routing: { tenantId: T2 } } })
  await prisma.routing.deleteMany({ where: { tenantId: T2 } })
  await prisma.bOMItem.deleteMany({ where: { bom: { tenantId: T2 } } })
  await prisma.bOM.deleteMany({ where: { tenantId: T2 } })
  await prisma.equipment.deleteMany({ where: { tenantId: T2 } })
  await prisma.item.deleteMany({ where: { tenantId: T2 } })
  await prisma.itemCategory.deleteMany({ where: { tenantId: T2 } })
  await prisma.warehouse.deleteMany({ where: { tenantId: T2 } })
  await prisma.workCenter.deleteMany({ where: { site: { tenantId: T2 } } })
  await prisma.businessPartner.deleteMany({ where: { tenantId: T2 } })
  await prisma.rolePermission.deleteMany({ where: { tenantId: T2 } })
  await prisma.site.deleteMany({ where: { tenantId: T2 } })
  await prisma.tenant.deleteMany({ where: { id: T2 } })
  console.log("[seed-roles] removed role accounts and tenant-2 data")
}

async function create() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`)[0].db
  if (!db.endsWith("_test")) throw new Error(`테스트 DB 가 아닙니다: ${db}`)

  await prisma.tenant.upsert({ where: { id: T2 }, update: {}, create: { id: T2, code: "E2E-TENANT-2", name: "E2E 타 테넌트" } })

  const lines: string[] = []
  for (const r of ROLES) {
    const password = `E2e!${crypto.randomBytes(9).toString("hex")}`
    const email = `${r.loginId}@daewon-mes.internal`
    const existing = await prisma.userCredential.findUnique({ where: { tenantId_loginId: { tenantId: r.tenantId, loginId: r.loginId } } })
    if (existing) {
      await prisma.userCredential.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(password, 10), isLocked: false, failCount: 0, mustChangePw: false } })
    } else {
      const profile = await prisma.profile.upsert({ where: { email }, update: {}, create: { email, name: `E2E ${r.key}` } })
      await prisma.tenantUser.create({ data: { tenantId: r.tenantId, profileId: profile.id, role: r.role, isActive: true } })
      await prisma.userCredential.create({
        data: { tenantId: r.tenantId, loginId: r.loginId, profileId: profile.id, passwordHash: await bcrypt.hash(password, 10), mustChangePw: false },
      })
    }
    lines.push(`ROLE_${r.key}_LOGIN=${r.loginId}`, `ROLE_${r.key}_PASSWORD=${password}`)
  }
  fs.writeFileSync(out, lines.join("\n") + "\n", { encoding: "utf8" })

  // ── 테넌트 2 전용 샘플 데이터 (테넌트 1 화면에 절대 보이면 안 된다)
  const site = await prisma.site.upsert({
    where: { tenantId_code: { tenantId: T2, code: "E2E-T2-SITE" } }, update: {},
    create: { tenantId: T2, code: "E2E-T2-SITE", name: "E2E-T2 타테넌트 사업장" },
  })
  await prisma.businessPartner.upsert({
    where: { tenantId_code: { tenantId: T2, code: "E2E-T2-CUS" } }, update: {},
    create: { tenantId: T2, code: "E2E-T2-CUS", name: "E2E-T2 타테넌트 고객사", partnerType: "CUSTOMER" },
  })
  await prisma.businessPartner.upsert({
    where: { tenantId_code: { tenantId: T2, code: "E2E-T2-VND" } }, update: {},
    create: { tenantId: T2, code: "E2E-T2-VND", name: "E2E-T2 타테넌트 거래처", partnerType: "SUPPLIER" },
  })
  const cat = await prisma.itemCategory.upsert({
    where: { tenantId_code: { tenantId: T2, code: "E2E-T2-CAT" } }, update: {},
    create: { tenantId: T2, code: "E2E-T2-CAT", name: "E2E-T2 타테넌트 분류", itemType: "RAW_MATERIAL" },
  })
  await prisma.item.upsert({
    where: { tenantId_code: { tenantId: T2, code: "E2E-T2-ITEM" } }, update: {},
    create: { tenantId: T2, code: "E2E-T2-ITEM", name: "E2E-T2 타테넌트 품목", itemType: "RAW_MATERIAL", categoryId: cat.id },
  })
  await prisma.warehouse.upsert({
    where: { siteId_code: { siteId: site.id, code: "E2E-T2-WH" } }, update: {},
    create: { tenantId: T2, siteId: site.id, code: "E2E-T2-WH", name: "E2E-T2 타테넌트 창고" },
  })
  const wc = await prisma.workCenter.findFirst({ where: { siteId: site.id, code: "E2E-T2-WC" } })
  const wcId = wc?.id ?? (await prisma.workCenter.create({ data: { siteId: site.id, code: "E2E-T2-WC", name: "E2E-T2 타테넌트 공정" } })).id
  const eq = await prisma.equipment.findFirst({ where: { tenantId: T2, code: "E2E-T2-EQ" } })
  if (!eq) await prisma.equipment.create({ data: { tenantId: T2, siteId: site.id, workCenterId: wcId, code: "E2E-T2-EQ", name: "E2E-T2 타테넌트 설비", equipmentType: "MACHINE" } })

  // ── 테넌트 2 업무 샘플: 수주/발주/생산계획/작업지시(진행 중) — 타 테넌트 화면에 노출되면 안 된다
  const t2Rm = await prisma.item.findFirst({ where: { tenantId: T2, code: "E2E-T2-ITEM" } })
  const t2Cus = await prisma.businessPartner.findFirst({ where: { tenantId: T2, code: "E2E-T2-CUS" } })
  const t2Vnd = await prisma.businessPartner.findFirst({ where: { tenantId: T2, code: "E2E-T2-VND" } })
  const t2Fg = await prisma.item.upsert({
    where: { tenantId_code: { tenantId: T2, code: "E2E-T2-FG" } }, update: {},
    create: { tenantId: T2, code: "E2E-T2-FG", name: "E2E-T2 타테넌트 완제품", itemType: "FINISHED", categoryId: cat.id },
  })
  if (t2Rm && t2Cus && t2Vnd) {
    let bom = await prisma.bOM.findFirst({ where: { tenantId: T2, itemId: t2Fg.id, version: "E2E-T2-V1" } })
    if (!bom) bom = await prisma.bOM.create({ data: { tenantId: T2, itemId: t2Fg.id, version: "E2E-T2-V1", status: "ACTIVE", isDefault: true, bomItems: { create: [{ componentItemId: t2Rm.id, seq: 1, qtyPer: 2, scrapRate: 0 }] } } })
    let rt = await prisma.routing.findFirst({ where: { tenantId: T2, code: "E2E-T2-RT" }, include: { operations: true } })
    if (!rt) rt = await prisma.routing.create({ data: { tenantId: T2, code: "E2E-T2-RT", name: "E2E-T2 타테넌트 라우팅", version: "1.0", status: "ACTIVE", scope: "COMMON", operations: { create: [{ seq: 1, operationCode: "E2E-T2-WC", name: "E2E-T2 타테넌트 공정", workCenterId: wcId, standardTime: 1 }] } }, include: { operations: true } })
    if (!(await prisma.salesOrder.findFirst({ where: { tenantId: T2, orderNo: "E2E-T2-SO-1" } }))) {
      await prisma.salesOrder.create({ data: { tenantId: T2, siteId: site.id, customerId: t2Cus.id, orderNo: "E2E-T2-SO-1", orderDate: new Date("2026-11-01"), deliveryDate: new Date("2026-11-30"), status: "CONFIRMED", items: { create: [{ itemId: t2Fg.id, qty: 10 }] } } })
    }
    if (!(await prisma.purchaseOrder.findFirst({ where: { tenantId: T2, orderNo: "E2E-T2-PO-1" } }))) {
      await prisma.purchaseOrder.create({ data: { tenantId: T2, siteId: site.id, supplierId: t2Vnd.id, orderNo: "E2E-T2-PO-1", orderDate: new Date("2026-11-01"), expectedDate: new Date("2026-11-15"), status: "ORDERED", items: { create: [{ itemId: t2Rm.id, qty: 5, unitPrice: 100 }] } } })
    }
    let plan = await prisma.productionPlan.findFirst({ where: { tenantId: T2, planNo: "E2E-T2-PP-1" } })
    if (!plan) plan = await prisma.productionPlan.create({ data: { tenantId: T2, siteId: site.id, planNo: "E2E-T2-PP-1", planType: "WEEKLY", status: "CONFIRMED", startDate: new Date("2026-11-02"), endDate: new Date("2026-11-06"), items: { create: [{ itemId: t2Fg.id, bomId: bom.id, routingId: rt.id, plannedQty: 10 }] } } })
    if (!(await prisma.workOrder.findFirst({ where: { tenantId: T2, orderNo: "E2E-T2-WO-1" } }))) {
      await prisma.workOrder.create({ data: { tenantId: T2, siteId: site.id, itemId: t2Fg.id, bomId: bom.id, routingId: rt.id, orderNo: "E2E-T2-WO-1", plannedQty: 10, status: "IN_PROGRESS", operations: { create: [{ routingOperationId: rt.operations[0].id, seq: 1, status: "IN_PROGRESS", plannedQty: 10 }] } } })
    }
  }
  console.log(`[seed-roles] db=${db} accounts=${ROLES.length} tenant2 data ready`)
}

;(process.env.REMOVE === "1" ? remove() : create())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
