/**
 * S-08(서버 액션 테넌트 격리) 재현용 "피해 테넌트(테넌트 2)" 샘플 — 로컬 테스트 DB 전용(가드 통과 시에만 실행).
 *  선행: seed-roles.ts 가 만든 테넌트2 기본 샘플(E2E-T2-* 품목/BOM/라우팅/설비, 소유자 계정).
 *  생성: ECN / 견적 / 품목 판매단가 / 문의(지원요청) / 게이트웨이·연결·태그·현재값 — 모두 E2E-T2- 접두사, 테넌트2 소유.
 *  식별자는 인자 JSON 으로 기록한다. REMOVE=1 이면 이 스크립트가 만든 행만 지운다.
 *
 * 실행: ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json tests/e2e/support/seed-s08.ts <out.json>
 */
import * as fs from "node:fs"
import { PrismaClient } from "@prisma/client"
import { assertLocalTestDbOrExit } from "../../../scripts/helpers/local-test-db-guard"

assertLocalTestDbOrExit("e2e-s08", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://127.0.0.1:3130" })

const T2 = "e2e-tenant-002"
const out = process.argv[2]
if (!out) throw new Error("출력 JSON 경로 인자가 필요합니다.")
const prisma = new PrismaClient()
const P = "E2E-T2-"

async function remove() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`)[0].db
  if (!db.endsWith("_test")) throw new Error(`테스트 DB 가 아닙니다: ${db}`)
  const log: string[] = []
  const step = async (n: string, fn: () => Promise<{ count: number }>) => { try { log.push(`${n}=${(await fn()).count}`) } catch (e) { log.push(`${n}=FAIL`); process.exitCode = 1; console.error(e) } }
  // 테넌트1 대조군(E2E-T1-) 제거
  await step("T1 TagCurrentValue", () => prisma.tagCurrentValue.deleteMany({ where: { tag: { tagCode: { startsWith: "E2E-T1-" } } } }))
  await step("T1 DataTag", () => prisma.dataTag.deleteMany({ where: { tagCode: { startsWith: "E2E-T1-" } } }))
  await step("T1 EquipmentConnection", () => prisma.equipmentConnection.deleteMany({ where: { gateway: { name: { startsWith: "E2E-T1-" } } } }))
  await step("T1 EdgeGateway", () => prisma.edgeGateway.deleteMany({ where: { name: { startsWith: "E2E-T1-" } } }))
  await step("T1 SupportRequest", () => prisma.supportRequest.deleteMany({ where: { title: { startsWith: "E2E-T1-" } } }))
  await step("T1 QuotationItem", () => prisma.quotationItem.deleteMany({ where: { quotation: { quotationNo: { startsWith: "E2E-T1-" } } } }))
  await step("T1 Quotation", () => prisma.quotation.deleteMany({ where: { quotationNo: { startsWith: "E2E-T1-" } } }))
  await step("T1 ECN", () => prisma.engineeringChange.deleteMany({ where: { ecnNo: { startsWith: "E2E-T1-" } } }))
  await step("T1 BOMItem", () => prisma.bOMItem.deleteMany({ where: { bom: { version: { startsWith: "E2E-T1-" } } } }))
  await step("T1 BOM", () => prisma.bOM.deleteMany({ where: { version: { startsWith: "E2E-T1-" } } }))
  await step("T1 Equipment", () => prisma.equipment.deleteMany({ where: { code: { startsWith: "E2E-T1-" } } }))
  await step("T1 Item", () => prisma.item.deleteMany({ where: { code: { startsWith: "E2E-T1-" } } }))
  await step("T1 Partner", () => prisma.businessPartner.deleteMany({ where: { code: { startsWith: "E2E-T1-" } } }))
  await step("T1 Category", () => prisma.itemCategory.deleteMany({ where: { code: { startsWith: "E2E-T1-" } } }))
  await step("TagCurrentValue", () => prisma.tagCurrentValue.deleteMany({ where: { tag: { connection: { gateway: { tenantId: T2 } } } } }))
  await step("DataTag", () => prisma.dataTag.deleteMany({ where: { connection: { gateway: { tenantId: T2 } } } }))
  await step("EquipmentConnection", () => prisma.equipmentConnection.deleteMany({ where: { gateway: { tenantId: T2 } } }))
  await step("EdgeGateway", () => prisma.edgeGateway.deleteMany({ where: { tenantId: T2 } }))
  await step("ItemRouting(S08)", () => prisma.itemRouting.deleteMany({ where: { tenantId: T2 } }))
  await step("WorkOrder(S08)", () => prisma.workOrder.deleteMany({ where: { tenantId: T2, orderNo: `${P}WO-2` } }))
  await step("SupportRequest", () => prisma.supportRequest.deleteMany({ where: { tenantId: T2 } }))
  await step("QuotationItem", () => prisma.quotationItem.deleteMany({ where: { quotation: { tenantId: T2 } } }))
  await step("Quotation", () => prisma.quotation.deleteMany({ where: { tenantId: T2 } }))
  await step("ItemPrice", () => prisma.itemPrice.deleteMany({ where: { tenantId: T2 } }))
  await step("EngineeringChangeDetail", () => prisma.engineeringChangeDetail.deleteMany({ where: { engineeringChange: { tenantId: T2 } } }))
  await step("EngineeringChange", () => prisma.engineeringChange.deleteMany({ where: { tenantId: T2 } }))
  console.log(`[seed-s08] db=${db} removed: ${log.join(", ")}`)
}

async function create() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`)[0].db
  if (!db.endsWith("_test")) throw new Error(`테스트 DB 가 아닙니다: ${db}`)
  const site = await prisma.site.findFirst({ where: { tenantId: T2, code: `${P}SITE` } })
  const fg = await prisma.item.findFirst({ where: { tenantId: T2, code: `${P}FG` } })
  const rm = await prisma.item.findFirst({ where: { tenantId: T2, code: `${P}ITEM` } })
  const cus = await prisma.businessPartner.findFirst({ where: { tenantId: T2, code: `${P}CUS` } })
  const eq = await prisma.equipment.findFirst({ where: { tenantId: T2, code: `${P}EQ` } })
  const owner = await prisma.userCredential.findFirst({ where: { tenantId: T2, loginId: "e2e-t2-owner" } })
  const wc = site ? await prisma.workCenter.findFirst({ where: { siteId: site.id, code: `${P}WC` } }) : null
  if (!site || !fg || !rm || !cus || !eq || !owner || !wc) throw new Error("seed-roles.ts 의 테넌트2 기본 샘플이 먼저 필요합니다.")

  const ecn = (await prisma.engineeringChange.findFirst({ where: { tenantId: T2, ecnNo: `${P}ECN-1` } })) ??
    (await prisma.engineeringChange.create({ data: { tenantId: T2, ecnNo: `${P}ECN-1`, title: `${P}설계변경 제목`, reason: `${P}변경 사유`, changeType: "BOM", targetItemId: fg.id, status: "DRAFT", requestedBy: owner.profileId } }))
  const qt = (await prisma.quotation.findFirst({ where: { tenantId: T2, quotationNo: `${P}QT-1` } })) ??
    (await prisma.quotation.create({ data: { tenantId: T2, siteId: site.id, customerId: cus.id, quotationNo: `${P}QT-1`, quotationDate: new Date("2026-11-01"), validUntil: new Date("2026-12-01"), status: "DRAFT", items: { create: [{ itemId: fg.id, qty: 3, unitPrice: 1000 }] } } }))
  if (!(await prisma.itemPrice.findFirst({ where: { tenantId: T2, itemId: fg.id, partnerId: cus.id } }))) {
    await prisma.itemPrice.create({ data: { tenantId: T2, itemId: fg.id, partnerId: cus.id, priceType: "SALES", unitPrice: 1234, effectiveFrom: new Date("2026-01-01") } })
  }
  // ecn.getCurrentRouting 은 품목의 기본(isDefault) 라우팅 연결을 조회하므로 연결 1건을 둔다
  const t2Routing = await prisma.routing.findFirst({ where: { tenantId: T2, code: `${P}RT` } })
  if (t2Routing && !(await prisma.itemRouting.findFirst({ where: { itemId: fg.id, routingId: t2Routing.id } }))) {
    await prisma.itemRouting.create({ data: { tenantId: T2, itemId: fg.id, routingId: t2Routing.id, isDefault: true } })
  }
  const sr = (await prisma.supportRequest.findFirst({ where: { tenantId: T2, title: `${P}문의` } })) ??
    (await prisma.supportRequest.create({ data: { tenantId: T2, authorId: owner.profileId, type: "OTHER", priority: "NORMAL", title: `${P}문의`, content: `${P}문의 내용(타 테넌트 비공개)` } }))
  let gw = await prisma.edgeGateway.findFirst({ where: { tenantId: T2, name: `${P}GW` } })
  if (!gw) gw = await prisma.edgeGateway.create({ data: { tenantId: T2, siteId: site.id, name: `${P}GW`, apiKey: `e2e-t2-gw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` } })
  let conn = await prisma.equipmentConnection.findFirst({ where: { gatewayId: gw.id } })
  if (!conn) conn = await prisma.equipmentConnection.create({ data: { equipmentId: eq.id, gatewayId: gw.id, protocol: "CUSTOM" } })
  let tag = await prisma.dataTag.findFirst({ where: { connectionId: conn.id, tagCode: `${P}TAG` } })
  if (!tag) tag = await prisma.dataTag.create({ data: { connectionId: conn.id, tagCode: `${P}TAG`, displayName: `${P}태그`, dataType: "INT", category: "STATUS", plcAddress: "X0" } })
  const tcv = (await prisma.tagCurrentValue.findFirst({ where: { tagId: tag.id } })) ??
    (await prisma.tagCurrentValue.create({ data: { tagId: tag.id, value: "7", timestamp: new Date() } }))

  // costing.getWorkOrdersForItem 은 COMPLETED 작업지시만 조회하므로 완료 상태 작업지시 1건을 추가한다(seed-roles 의 E2E-T2-WO-1 은 진행 중)
  const wo1 = await prisma.workOrder.findFirst({ where: { tenantId: T2, orderNo: `${P}WO-1` } })
  if (!wo1) throw new Error("seed-roles.ts 의 테넌트2 작업지시 샘플이 먼저 필요합니다.")
  const wo2 = (await prisma.workOrder.findFirst({ where: { tenantId: T2, orderNo: `${P}WO-2` } })) ??
    (await prisma.workOrder.create({ data: { tenantId: T2, siteId: site.id, itemId: fg.id, bomId: wo1.bomId, routingId: wo1.routingId, orderNo: `${P}WO-2`, plannedQty: 1, status: "COMPLETED" } }))

  // ── 대조군: 테넌트1 자기 데이터(수정 후에도 정상 조회·변경되어야 한다)
  const T1 = process.env.DEFAULT_TENANT_ID as string
  const q = "E2E-T1-"
  const site1 = await prisma.site.findFirst({ where: { tenantId: T1, code: "FAC-01" } })
  const wc1 = site1 ? await prisma.workCenter.findFirst({ where: { siteId: site1.id, code: "WC-MACH" } }) : null
  const adminCred = await prisma.userCredential.findFirst({ where: { tenantId: T1, loginId: process.env.SEED_ADMIN_LOGIN_ID } })
  if (!site1 || !wc1 || !adminCred) throw new Error("테넌트1 기본 시드(FAC-01, WC-MACH, e2e-admin)가 필요합니다.")
  const cat1 = await prisma.itemCategory.upsert({ where: { tenantId_code: { tenantId: T1, code: `${q}CAT` } }, update: {}, create: { tenantId: T1, code: `${q}CAT`, name: `${q}분류`, itemType: "FINISHED" } })
  const fg1 = await prisma.item.upsert({ where: { tenantId_code: { tenantId: T1, code: `${q}FG` } }, update: {}, create: { tenantId: T1, code: `${q}FG`, name: `${q}완제품`, itemType: "FINISHED", categoryId: cat1.id } })
  const rm1 = await prisma.item.upsert({ where: { tenantId_code: { tenantId: T1, code: `${q}RM` } }, update: {}, create: { tenantId: T1, code: `${q}RM`, name: `${q}원자재`, itemType: "RAW_MATERIAL", categoryId: cat1.id } })
  const cus1 = await prisma.businessPartner.upsert({ where: { tenantId_code: { tenantId: T1, code: `${q}CUS` } }, update: {}, create: { tenantId: T1, code: `${q}CUS`, name: `${q}고객사`, partnerType: "CUSTOMER" } })
  const bom1 = (await prisma.bOM.findFirst({ where: { tenantId: T1, itemId: fg1.id, version: `${q}V1` } })) ?? (await prisma.bOM.create({ data: { tenantId: T1, itemId: fg1.id, version: `${q}V1`, status: "ACTIVE", isDefault: true, bomItems: { create: [{ componentItemId: rm1.id, seq: 1, qtyPer: 2, scrapRate: 0 }] } } }))
  const eq1 = (await prisma.equipment.findFirst({ where: { tenantId: T1, code: `${q}EQ` } })) ?? (await prisma.equipment.create({ data: { tenantId: T1, siteId: site1.id, workCenterId: wc1.id, code: `${q}EQ`, name: `${q}설비`, equipmentType: "MACHINE" } }))
  const ecn1 = (await prisma.engineeringChange.findFirst({ where: { tenantId: T1, ecnNo: `${q}ECN-1` } })) ?? (await prisma.engineeringChange.create({ data: { tenantId: T1, ecnNo: `${q}ECN-1`, title: `${q}설계변경`, reason: `${q}사유`, changeType: "BOM", targetItemId: fg1.id, status: "DRAFT", requestedBy: adminCred.profileId } }))
  const qt1 = (await prisma.quotation.findFirst({ where: { tenantId: T1, quotationNo: `${q}QT-1` } })) ?? (await prisma.quotation.create({ data: { tenantId: T1, siteId: site1.id, customerId: cus1.id, quotationNo: `${q}QT-1`, quotationDate: new Date("2026-11-01"), validUntil: new Date("2026-12-01"), status: "DRAFT", items: { create: [{ itemId: fg1.id, qty: 1, unitPrice: 10 }] } } }))
  const sr1 = (await prisma.supportRequest.findFirst({ where: { tenantId: T1, title: `${q}문의` } })) ?? (await prisma.supportRequest.create({ data: { tenantId: T1, authorId: adminCred.profileId, type: "OTHER", priority: "NORMAL", title: `${q}문의`, content: `${q}문의 내용` } }))
  let gw1 = await prisma.edgeGateway.findFirst({ where: { tenantId: T1, name: `${q}GW` } })
  if (!gw1) gw1 = await prisma.edgeGateway.create({ data: { tenantId: T1, siteId: site1.id, name: `${q}GW`, apiKey: `e2e-t1-gw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` } })
  let conn1 = await prisma.equipmentConnection.findFirst({ where: { gatewayId: gw1.id } })
  if (!conn1) conn1 = await prisma.equipmentConnection.create({ data: { equipmentId: eq1.id, gatewayId: gw1.id, protocol: "CUSTOM" } })
  let tag1 = await prisma.dataTag.findFirst({ where: { connectionId: conn1.id, tagCode: `${q}TAG` } })
  if (!tag1) tag1 = await prisma.dataTag.create({ data: { connectionId: conn1.id, tagCode: `${q}TAG`, displayName: `${q}태그`, dataType: "INT", category: "STATUS", plcAddress: "X1" } })
  if (!(await prisma.tagCurrentValue.findFirst({ where: { tagId: tag1.id } }))) await prisma.tagCurrentValue.create({ data: { tagId: tag1.id, value: "3", timestamp: new Date() } })
  const ctl = { itemFg: fg1.id, bomVersion: bom1.version, equipmentId: eq1.id, ecnId: ecn1.id, quotationId: qt1.id, supportRequestId: sr1.id, tagId: tag1.id, customerId: cus1.id, siteId: site1.id, adminProfileId: adminCred.profileId }

  const data = {
    control: ctl,
    workOrderId: wo1.id, workOrderCompletedId: wo2.id,
    tenantId: T2, siteId: site.id, workCenterId: wc.id, itemFg: fg.id, itemRm: rm.id, customerId: cus.id, equipmentId: eq.id,
    ecnId: ecn.id, quotationId: qt.id, supportRequestId: sr.id, tagId: tag.id, tagCurrentValueId: tcv.id, ownerProfileId: owner.profileId,
  }
  fs.writeFileSync(out, JSON.stringify(data, null, 2), { encoding: "utf8" })
  console.log(`[seed-s08] db=${db} T2 fixtures ready -> ${out}`)
}

;(process.env.REMOVE === "1" ? remove() : create())
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
