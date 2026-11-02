/**
 * BOM·라우팅·검사표준·생산계획·작업지시 테스트용 기준정보 — 로컬 테스트 DB 전용(가드 통과 시에만 실행).
 *
 *  - E2E-BR- 접두사 데이터만 만든다: 품목분류 2 / 품목군 1 / 완제품 2 / 원자재 2 / 작업장 2 / 설비 2
 *  - 생성한 식별자는 인자로 받은 JSON 파일에 기록한다(스펙이 읽고, 정리 때 같은 접두사만 지운다).
 *  - 기존 시드 데이터(FAC-01, WC-MACH 등)와 사용자 데이터는 건드리지 않는다.
 *
 * 실행: ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json tests/e2e/support/seed-bomflow.ts <data.json>
 * 정리: 같은 인자 + REMOVE=1  (E2E-BR- 접두사 + 해당 품목에 걸린 계획/작업지시/BOM/라우팅/검사표준만 삭제)
 */
import * as fs from "node:fs"
import { PrismaClient } from "@prisma/client"
import { assertLocalTestDbOrExit } from "../../../scripts/helpers/local-test-db-guard"

assertLocalTestDbOrExit("e2e-bomflow", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://127.0.0.1:3130" })

const TENANT = process.env.DEFAULT_TENANT_ID as string
const P = "E2E-BR-"
const out = process.argv[2]
if (!out) throw new Error("data.json 경로 인자가 필요합니다.")
const prisma = new PrismaClient()

async function assertTestDb() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`)[0].db
  if (!db.endsWith("_test")) throw new Error(`테스트 DB 가 아닙니다: ${db}`)
  return db
}

async function remove() {
  const db = await assertTestDb()
  const items = await prisma.item.findMany({ where: { tenantId: TENANT, code: { startsWith: P } }, select: { id: true } })
  const itemIds = items.map((i) => i.id)
  const log: string[] = []
  const step = async (name: string, fn: () => Promise<{ count: number }>) => {
    try { log.push(`${name}=${(await fn()).count}`) } catch (e) { log.push(`${name}=FAIL(${(e as Error).message.split("\n").pop()?.slice(0, 80)})`); process.exitCode = 1 }
  }
  const wos = { OR: [{ tenantId: TENANT, orderNo: { startsWith: P } }, { tenantId: TENANT, itemId: { in: itemIds } }] }
  const woIds = (await prisma.workOrder.findMany({ where: wos, select: { id: true } })).map((w) => w.id)
  const qiWhere = { OR: [{ workOrderOperation: { workOrderId: { in: woIds } } }, { inspectionSpec: { itemId: { in: itemIds } } }] }
  await step("InspectionMeasurement", () => prisma.inspectionMeasurement.deleteMany({ where: { qualityInspection: qiWhere } }))
  await step("QualityInspection", () => prisma.qualityInspection.deleteMany({ where: qiWhere }))
  await step("WorkOrderOperation", () => prisma.workOrderOperation.deleteMany({ where: { workOrderId: { in: woIds } } }))
  await step("WorkOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }))
  const plans = { OR: [{ tenantId: TENANT, planNo: { startsWith: P } }, { tenantId: TENANT, items: { some: { itemId: { in: itemIds } } } }] }
  const planIds = (await prisma.productionPlan.findMany({ where: plans, select: { id: true } })).map((p) => p.id)
  await step("ProductionPlanItem", () => prisma.productionPlanItem.deleteMany({ where: { planId: { in: planIds } } }))
  await step("ProductionPlan", () => prisma.productionPlan.deleteMany({ where: { id: { in: planIds } } }))
  const specIds = (await prisma.inspectionSpec.findMany({ where: { tenantId: TENANT, OR: [{ itemId: { in: itemIds } }, { routingOperation: { routing: { code: { startsWith: P } } } }] }, select: { id: true } })).map((s) => s.id)
  await step("InspectionItem", () => prisma.inspectionItem.deleteMany({ where: { inspectionSpecId: { in: specIds } } }))
  await step("InspectionSpec", () => prisma.inspectionSpec.deleteMany({ where: { id: { in: specIds } } }))
  const ecnIds = (await prisma.engineeringChange.findMany({ where: { tenantId: TENANT, OR: [{ targetItemId: { in: itemIds } }, { ecnNo: { startsWith: P } }] }, select: { id: true } })).map((e) => e.id)
  await step("EngineeringChangeDetail", () => prisma.engineeringChangeDetail.deleteMany({ where: { engineeringChangeId: { in: ecnIds } } }))
  await step("EngineeringChange", () => prisma.engineeringChange.deleteMany({ where: { id: { in: ecnIds } } }))
  const bomIds = (await prisma.bOM.findMany({ where: { tenantId: TENANT, itemId: { in: itemIds } }, select: { id: true } })).map((b) => b.id)
  await step("BOMItem", () => prisma.bOMItem.deleteMany({ where: { bomId: { in: bomIds } } }))
  await step("BOM", () => prisma.bOM.deleteMany({ where: { id: { in: bomIds } } }))
  const routingIds = (await prisma.routing.findMany({ where: { tenantId: TENANT, code: { startsWith: P } }, select: { id: true } })).map((r) => r.id)
  await step("ItemRouting", () => prisma.itemRouting.deleteMany({ where: { OR: [{ routingId: { in: routingIds } }, { itemId: { in: itemIds } }] } }))
  await step("RoutingOperation", () => prisma.routingOperation.deleteMany({ where: { routingId: { in: routingIds } } }))
  await step("Routing", () => prisma.routing.deleteMany({ where: { id: { in: routingIds } } }))
  await step("Equipment", () => prisma.equipment.deleteMany({ where: { tenantId: TENANT, code: { startsWith: P } } }))
  await step("WorkCenter", () => prisma.workCenter.deleteMany({ where: { code: { startsWith: P }, site: { tenantId: TENANT } } }))
  await step("Item", () => prisma.item.deleteMany({ where: { id: { in: itemIds } } }))
  await step("ItemGroup", () => prisma.itemGroup.deleteMany({ where: { tenantId: TENANT, code: { startsWith: P } } }))
  await step("ItemCategory", () => prisma.itemCategory.deleteMany({ where: { tenantId: TENANT, code: { startsWith: P } } }))
  console.log(`[seed-bomflow] db=${db} removed: ${log.join(", ")}`)
}

async function create() {
  const db = await assertTestDb()
  const site = await prisma.site.findFirst({ where: { tenantId: TENANT, code: "FAC-01" } })
  if (!site) throw new Error("기준 사업장 FAC-01 이 없습니다(seed 확인).")

  const catFg = await prisma.itemCategory.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}CAT-FG` } }, update: {}, create: { tenantId: TENANT, code: `${P}CAT-FG`, name: `${P}완제품 분류`, itemType: "FINISHED" } })
  const catRm = await prisma.itemCategory.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}CAT-RM` } }, update: {}, create: { tenantId: TENANT, code: `${P}CAT-RM`, name: `${P}원자재 분류`, itemType: "RAW_MATERIAL" } })
  const grp = await prisma.itemGroup.upsert({ where: { tenantId_code: { tenantId: TENANT, code: `${P}GRP-01` } }, update: {}, create: { tenantId: TENANT, categoryId: catFg.id, code: `${P}GRP-01`, name: `${P}품목군` } })
  const mk = (code: string, name: string, itemType: "FINISHED" | "RAW_MATERIAL", categoryId: string, itemGroupId?: string) =>
    prisma.item.upsert({ where: { tenantId_code: { tenantId: TENANT, code } }, update: {}, create: { tenantId: TENANT, code, name, itemType, categoryId, itemGroupId, uom: "EA" } })
  const fg1 = await mk(`${P}FG-001`, `${P}완제품 1`, "FINISHED", catFg.id, grp.id)
  const fg2 = await mk(`${P}FG-002`, `${P}완제품 2`, "FINISHED", catFg.id, grp.id)
  const rm1 = await mk(`${P}RM-001`, `${P}원자재 1`, "RAW_MATERIAL", catRm.id)
  const rm2 = await mk(`${P}RM-002`, `${P}원자재 2`, "RAW_MATERIAL", catRm.id)

  const mkWc = async (code: string, name: string) => {
    const f = await prisma.workCenter.findFirst({ where: { siteId: site.id, code } })
    return f ?? prisma.workCenter.create({ data: { siteId: site.id, code, name } })
  }
  const wc1 = await mkWc(`${P}WC-1`, `${P}가공 공정 1`)
  const wc2 = await mkWc(`${P}WC-2`, `${P}가공 공정 2`)
  const mkEq = async (code: string, name: string, workCenterId: string) => {
    const f = await prisma.equipment.findFirst({ where: { tenantId: TENANT, code } })
    return f ?? prisma.equipment.create({ data: { tenantId: TENANT, siteId: site.id, workCenterId, code, name, equipmentType: "MACHINE" } })
  }
  const eq1 = await mkEq(`${P}EQ-1`, `${P}설비 1`, wc1.id)
  const eq2 = await mkEq(`${P}EQ-2`, `${P}설비 2`, wc2.id)

  const data = {
    createdAt: new Date().toISOString(), db, tenantId: TENANT, prefix: P,
    site: { id: site.id, code: site.code, name: site.name },
    categories: { fg: { id: catFg.id, code: catFg.code, name: catFg.name }, rm: { id: catRm.id, code: catRm.code, name: catRm.name } },
    group: { id: grp.id, code: grp.code, name: grp.name },
    items: Object.fromEntries([["fg1", fg1], ["fg2", fg2], ["rm1", rm1], ["rm2", rm2]].map(([k, v]) => [k as string, { id: (v as typeof fg1).id, code: (v as typeof fg1).code, name: (v as typeof fg1).name }])),
    workCenters: { wc1: { id: wc1.id, code: wc1.code, name: wc1.name }, wc2: { id: wc2.id, code: wc2.code, name: wc2.name } },
    equipments: { eq1: { id: eq1.id, code: eq1.code, name: eq1.name }, eq2: { id: eq2.id, code: eq2.code, name: eq2.name } },
  }
  fs.writeFileSync(out, JSON.stringify(data, null, 2), { encoding: "utf8" })
  console.log(`[seed-bomflow] db=${db} created categories=2 group=1 items=4 workCenters=2 equipments=2 -> ${out}`)
}

;(process.env.REMOVE === "1" ? remove() : create())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
