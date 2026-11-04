/**
 * 수주~출하 통합 테스트용 기준정보 — 로컬 테스트 DB 전용(가드 통과 시에만 실행).
 *
 *  - E2E-OS- 접두사 데이터만 만든다: 고객사·공급사·품목분류·완제품 1·원자재 2·공급업체 정책·작업장 2·설비 2
 *    ACTIVE 기본 BOM 1건(원자재1×2 + 원자재2×3) · 2공정 기본 라우팅 · 검사표준(1공정 초물/2공정 종물) · POP 작업자(테스트 전용 PIN)
 *  - 제조번호·LOT 번호는 채번 규칙을 쓰지 않고 스펙이 로컬 시험값을 직접 입력한다.
 *  - 생성한 식별자와 테스트 전용 PIN 은 인자로 받은 JSON 파일(저장소 밖이 아닌 test-results/, 미커밋)에만 기록한다.
 *  - 기존 시드(FAC-01, WH-RAW/WIP/FG, 사용자)는 건드리지 않는다.
 *
 * 실행: ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json tests/e2e/support/seed-o2s.ts <data.json>
 * 정리: 같은 인자 + REMOVE=1  → 업무 거래 테이블(수주~출하·재고·LOT)을 비우고 E2E-OS- 마스터와 테스트 작업자를 삭제한다.
 *       (이 DB 의 업무 거래 테이블은 시작 시 비어 있는 로컬 테스트 DB 이므로 TRUNCATE 로 되돌린다. 마스터 행 수는 전후 비교로 출력한다.)
 */
import * as fs from "node:fs"
import * as crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
import { assertLocalTestDbOrExit } from "../../../scripts/helpers/local-test-db-guard"
import { preparePopPinForStorage } from "../../../src/lib/auth/pop-pin"

assertLocalTestDbOrExit("e2e-o2s", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://127.0.0.1:3130" })

const TENANT = process.env.DEFAULT_TENANT_ID as string
const P = "E2E-OS-"
const out = process.argv[2]
if (!out) throw new Error("data.json 경로 인자가 필요합니다.")
const prisma = new PrismaClient()

async function assertTestDb() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`)[0].db
  if (!db.endsWith("_test")) throw new Error(`테스트 DB 가 아닙니다: ${db}`)
  return db
}

// 업무 거래 테이블(참조 방향상 자식 → 부모 순서는 TRUNCATE ... CASCADE 가 처리). 마스터(Item/BOM/Routing 등)는 포함하지 않는다.
const TXN_TABLES = [
  "ShipmentItem", "ShipmentOrder", "SalesOrderItem", "SalesOrder",
  "MrpRunPurchase", "MrpRunSuggestion", "MrpRun",
  "ReceivingRequest", "ReceivingInspection", "MaterialReturnItem", "MaterialReturn", "PurchaseOrderItem", "PurchaseOrder",
  "FinishedGoodsReceipt", "ProductionResult", "WipUnitMaterialLot", "WipMovement", "WipHold", "WipUnit",
  "WorkOrderMaterialLot", "MaterialReservation", "MaterialConsumption", "WorkOrderOperationAssignment", "WorkOrderOperation", "WorkOrder",
  "ProductionPlanItem", "ProductionPlan",
  "InspectionMeasurement", "DefectRecord", "QualityInspection",
  "LotGenealogy", "LotNumberReservation", "InventoryTransaction", "InventoryBalance", "Lot",
]
const MASTER_COUNT_TABLES = ["Item", "BOM", "BOMItem", "Routing", "RoutingOperation", "WorkCenter", "Equipment", "BusinessPartner", "Warehouse", "Location", "Site", "TenantUser", "UserCredential", "Profile", "DefectCode", "InspectionSpec"]

async function masterCounts() {
  const o: Record<string, number> = {}
  for (const t of MASTER_COUNT_TABLES) o[t] = Number((await prisma.$queryRawUnsafe<{ c: bigint }[]>(`select count(*) c from "${t}"`))[0].c)
  return o
}

async function remove() {
  const db = await assertTestDb()
  const before = await masterCounts()
  const log: string[] = []
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { const r = await fn(); log.push(`${name}=${typeof r === "object" && r && "count" in r ? (r as { count: number }).count : "ok"}`) } catch (e) { log.push(`${name}=FAIL(${(e as Error).message.split("\n").pop()?.slice(0, 80)})`); process.exitCode = 1 }
  }
  await step("TRUNCATE(업무거래)", () => prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TXN_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`))
  const items = await prisma.item.findMany({ where: { tenantId: TENANT, code: { startsWith: P } }, select: { id: true } })
  const itemIds = items.map((i) => i.id)
  const specIds = (await prisma.inspectionSpec.findMany({ where: { tenantId: TENANT, itemId: { in: itemIds } }, select: { id: true } })).map((s) => s.id)
  await step("InspectionItem", () => prisma.inspectionItem.deleteMany({ where: { inspectionSpecId: { in: specIds } } }))
  await step("InspectionSpec", () => prisma.inspectionSpec.deleteMany({ where: { id: { in: specIds } } }))
  const bomIds = (await prisma.bOM.findMany({ where: { tenantId: TENANT, itemId: { in: itemIds } }, select: { id: true } })).map((b) => b.id)
  await step("BOMItem", () => prisma.bOMItem.deleteMany({ where: { bomId: { in: bomIds } } }))
  await step("BOM", () => prisma.bOM.deleteMany({ where: { id: { in: bomIds } } }))
  const routingIds = (await prisma.routing.findMany({ where: { tenantId: TENANT, code: { startsWith: P } }, select: { id: true } })).map((r) => r.id)
  await step("ItemRouting", () => prisma.itemRouting.deleteMany({ where: { OR: [{ routingId: { in: routingIds } }, { itemId: { in: itemIds } }] } }))
  await step("RoutingOperation", () => prisma.routingOperation.deleteMany({ where: { routingId: { in: routingIds } } }))
  await step("Routing", () => prisma.routing.deleteMany({ where: { id: { in: routingIds } } }))
  await step("ItemSupplier", () => prisma.itemSupplier.deleteMany({ where: { tenantId: TENANT, itemId: { in: itemIds } } }))
  await step("ItemPrice", () => prisma.itemPrice.deleteMany({ where: { tenantId: TENANT, itemId: { in: itemIds } } }))
  await step("Equipment", () => prisma.equipment.deleteMany({ where: { tenantId: TENANT, code: { startsWith: P } } }))
  await step("WorkCenter", () => prisma.workCenter.deleteMany({ where: { code: { startsWith: P }, site: { tenantId: TENANT } } }))
  await step("Item", () => prisma.item.deleteMany({ where: { id: { in: itemIds } } }))
  await step("ItemCategory", () => prisma.itemCategory.deleteMany({ where: { tenantId: TENANT, code: { startsWith: P } } }))
  await step("BusinessPartner", () => prisma.businessPartner.deleteMany({ where: { tenantId: TENANT, code: { startsWith: P } } }))
  const workerCred = await prisma.userCredential.findUnique({ where: { tenantId_loginId: { tenantId: TENANT, loginId: `${P.toLowerCase()}worker` } } })
  if (workerCred) {
    await step("TenantUser(작업자)", () => prisma.tenantUser.deleteMany({ where: { profileId: workerCred.profileId } }))
    await step("UserCredential(작업자)", () => prisma.userCredential.delete({ where: { id: workerCred.id } }))
    await step("Profile(작업자)", () => prisma.profile.deleteMany({ where: { id: workerCred.profileId } }))
  }
  const after = await masterCounts()
  const diff = Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => `${k}:${before[k]}→${after[k]}`)
  console.log(`[seed-o2s] db=${db} removed: ${log.join(", ")} | 마스터 행 수 변화: ${diff.join(", ") || "없음"}`)
}

async function create() {
  const db = await assertTestDb()
  const site = await prisma.site.findFirst({ where: { tenantId: TENANT, code: "FAC-01" } })
  if (!site) throw new Error("기준 사업장 FAC-01 이 없습니다(seed 확인).")
  const whs = await prisma.warehouse.findMany({ where: { tenantId: TENANT, siteId: site.id, code: { in: ["WH-RAW", "WH-WIP", "WH-FG"] } } })
  const wh = (code: string) => {
    const w = whs.find((x) => x.code === code)
    if (!w) throw new Error(`창고 ${code} 가 없습니다(seed 확인).`)
    return { id: w.id, code: w.code, name: w.name }
  }

  const cus = await prisma.businessPartner.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}CUS-001` } }, update: {}, create: { tenantId: TENANT, code: `${P}CUS-001`, name: `${P}고객사`, partnerType: "CUSTOMER" } })
  const sup = await prisma.businessPartner.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}VND-001` } }, update: {}, create: { tenantId: TENANT, code: `${P}VND-001`, name: `${P}공급사`, partnerType: "SUPPLIER" } })

  const catFg = await prisma.itemCategory.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}CAT-FG` } }, update: {}, create: { tenantId: TENANT, code: `${P}CAT-FG`, name: `${P}완제품 분류`, itemType: "FINISHED" } })
  const catRm = await prisma.itemCategory.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}CAT-RM` } }, update: {}, create: { tenantId: TENANT, code: `${P}CAT-RM`, name: `${P}원자재 분류`, itemType: "RAW_MATERIAL" } })
  const mk = (code: string, name: string, itemType: "FINISHED" | "RAW_MATERIAL", categoryId: string) =>
    prisma.item.upsert({ where: { tenantId_code: { tenantId: TENANT, code } }, update: {}, create: { tenantId: TENANT, code, name, itemType, categoryId, uom: "EA", isLotTracked: true } })
  const fg = await mk(`${P}FG-001`, `${P}완제품`, "FINISHED", catFg.id)
  const rm1 = await mk(`${P}RM-001`, `${P}원자재 1`, "RAW_MATERIAL", catRm.id)
  const rm2 = await mk(`${P}RM-002`, `${P}원자재 2`, "RAW_MATERIAL", catRm.id)

  for (const [it, price] of [[rm1, 100], [rm2, 250]] as const) {
    await prisma.itemSupplier.upsert({
      where: { tenantId_itemId_supplierId: { tenantId: TENANT, itemId: it.id, supplierId: sup.id } }, update: {},
      create: { tenantId: TENANT, itemId: it.id, supplierId: sup.id, isDefault: true, priority: 1, leadTimeDays: 7, isActive: true },
    })
    if (!(await prisma.itemPrice.findFirst({ where: { tenantId: TENANT, itemId: it.id, partnerId: sup.id, priceType: "PURCHASE" } }))) {
      await prisma.itemPrice.create({ data: { tenantId: TENANT, itemId: it.id, partnerId: sup.id, priceType: "PURCHASE", unitPrice: price, effectiveFrom: new Date("2026-01-01") } })
    }
  }

  const mkWc = async (code: string, name: string) => (await prisma.workCenter.findFirst({ where: { siteId: site.id, code } })) ?? prisma.workCenter.create({ data: { siteId: site.id, code, name } })
  const wc1 = await mkWc(`${P}WC-1`, `${P}가공`)
  const wc2 = await mkWc(`${P}WC-2`, `${P}검사포장`)
  const mkEq = async (code: string, name: string, workCenterId: string) =>
    (await prisma.equipment.findFirst({ where: { tenantId: TENANT, code } })) ?? prisma.equipment.create({ data: { tenantId: TENANT, siteId: site.id, workCenterId, code, name, equipmentType: "MACHINE" } })
  const eq1 = await mkEq(`${P}EQ-1`, `${P}설비 1`, wc1.id)
  const eq2 = await mkEq(`${P}EQ-2`, `${P}설비 2`, wc2.id)

  // ACTIVE 기본 BOM 1건
  let bom = await prisma.bOM.findFirst({ where: { tenantId: TENANT, itemId: fg.id, version: "1.0" } })
  if (!bom) {
    bom = await prisma.bOM.create({
      data: { tenantId: TENANT, itemId: fg.id, version: "1.0", status: "ACTIVE", isDefault: true, bomItems: { create: [{ componentItemId: rm1.id, seq: 1, qtyPer: 2, scrapRate: 0 }, { componentItemId: rm2.id, seq: 2, qtyPer: 3, scrapRate: 0 }] } },
    })
  }
  // 2공정 기본 라우팅(품목 전용)
  let routing = await prisma.routing.findFirst({ where: { tenantId: TENANT, code: `${P}RT-001` }, include: { operations: { orderBy: { seq: "asc" } } } })
  if (!routing) {
    routing = await prisma.routing.create({
      data: {
        tenantId: TENANT, code: `${P}RT-001`, name: `${P}라우팅`, version: "1.0", status: "ACTIVE", scope: "ITEM_SPECIFIC",
        operations: { create: [{ workCenterId: wc1.id, seq: 1, operationCode: `${P}OP10`, name: "가공", standardTime: 5 }, { workCenterId: wc2.id, seq: 2, operationCode: `${P}OP20`, name: "검사·포장", standardTime: 3 }] },
      },
      include: { operations: { orderBy: { seq: "asc" } } },
    })
    await prisma.itemRouting.create({ data: { tenantId: TENANT, itemId: fg.id, routingId: routing.id, isDefault: true } })
  }
  const [op1, op2] = routing.operations
  // 검사표준: 1공정(초·중물) / 2공정(종물 = 출하·입고 게이트)
  const mkSpec = async (routingOperationId: string, version: string, name: string) => {
    const found = await prisma.inspectionSpec.findFirst({ where: { tenantId: TENANT, itemId: fg.id, routingOperationId, version } })
    if (found) return found
    return prisma.inspectionSpec.create({
      data: { tenantId: TENANT, itemId: fg.id, routingOperationId, version, status: "ACTIVE", inspectionItems: { create: [{ seq: 1, name, inputType: "NUMERIC", lowerLimit: 9.95, upperLimit: 10.05, unit: "mm" }] } },
    })
  }
  const spec1 = await mkSpec(op1.id, "OS-1", "외경")
  const spec2 = await mkSpec(op2.id, "OS-2", "최종 외경")

  // 불량코드(시드 DIM-001 사용)
  const defect = await prisma.defectCode.findFirst({ where: { tenantId: TENANT, code: "DIM-001" } })
  if (!defect) throw new Error("불량코드 DIM-001 이 없습니다(seed 확인).")

  // POP 작업자(테스트 전용): 웹 로그인 불필요, PIN 만 사용. PIN 은 실행마다 무작위(4자리)이며 충돌 시 재시도.
  const loginId = `${P.toLowerCase()}worker`
  const email = `${loginId}@daewon-mes.internal`
  const prev = await prisma.userCredential.findUnique({ where: { tenantId_loginId: { tenantId: TENANT, loginId } } })
  let pin = ""
  if (prev) {
    await prisma.tenantUser.deleteMany({ where: { profileId: prev.profileId } })
    await prisma.userCredential.delete({ where: { id: prev.id } })
  }
  const profile = await prisma.profile.upsert({ where: { email }, update: {}, create: { email, name: `${P}POP 작업자` } })
  const tenantUser = await prisma.tenantUser.create({ data: { tenantId: TENANT, profileId: profile.id, role: "OPERATOR", siteId: site.id, isActive: true } })
  for (let i = 0; i < 20 && !pin; i++) {
    const cand = String(crypto.randomInt(1000, 10000))
    const stored = await preparePopPinForStorage(TENANT, cand)
    const clash = await prisma.userCredential.findFirst({ where: { tenantId: TENANT, popPinFingerprint: stored.popPinFingerprint } })
    if (clash) continue
    await prisma.userCredential.create({
      data: {
        tenantId: TENANT, loginId, profileId: profile.id, passwordHash: await bcrypt.hash(crypto.randomBytes(12).toString("hex"), 10), mustChangePw: false,
        popPinHash: stored.popPinHash, popPinFingerprint: stored.popPinFingerprint, popPinSetAt: stored.popPinSetAt,
      },
    })
    pin = cand
  }
  if (!pin) throw new Error("사용 가능한 PIN 을 찾지 못했습니다.")

  const short = (x: { id: string; code: string; name: string }) => ({ id: x.id, code: x.code, name: x.name })
  const data = {
    createdAt: new Date().toISOString(), db, tenantId: TENANT, prefix: P,
    site: short(site), warehouses: { raw: wh("WH-RAW"), wip: wh("WH-WIP"), fg: wh("WH-FG") },
    customer: short(cus), supplier: short(sup),
    items: { fg: short(fg), rm1: short(rm1), rm2: short(rm2) },
    bom: { id: bom.id, version: bom.version }, routing: { id: routing.id, code: routing.code, ops: [op1.id, op2.id] },
    workCenters: { wc1: short(wc1), wc2: short(wc2) }, equipments: { eq1: short(eq1), eq2: short(eq2) },
    specs: { op1: spec1.id, op2: spec2.id }, defectCode: { id: defect.id, code: defect.code },
    worker: { loginId, profileId: profile.id, tenantUserId: tenantUser.id, pin },
  }
  fs.writeFileSync(out, JSON.stringify(data, null, 2), { encoding: "utf8" })
  console.log(`[seed-o2s] db=${db} created: 고객/공급사 2, 품목 3, BOM 1, 라우팅 1(2공정), 검사표준 2, 작업장 2, 설비 2, POP 작업자 1 -> ${out}`)
}

;(process.env.REMOVE === "1" ? remove() : create())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
