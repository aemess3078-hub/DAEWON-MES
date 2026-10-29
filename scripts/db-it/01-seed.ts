/**
 * 5단계 1: 통합 테스트 데이터 준비(ZT5 접두어, 재실행해도 중복 생성하지 않음).
 * 사용자·품목·창고·BOM·라우팅·발주·수주를 만든다. 입고/LOT/재고/작업지시/실적은 각 시나리오가 정상 업무 액션으로 만든다.
 */
import { assertTarget, check, info, prisma, summary, TENANT_ID } from "./lib"

async function main() {
  const t = assertTarget()
  info("S0", `대상 프로젝트 ${t.projectRef} / 테넌트 ${TENANT_ID}`)
  const site = await prisma.site.findFirst({ where: { tenantId: TENANT_ID }, orderBy: { createdAt: "asc" } })
  if (!site) throw new Error("Site 가 없습니다.")
  info("S1", `Site ${site.code}`)

  // 사용자(프로필+자격+테넌트 사용자). 비밀번호 로그인은 쓰지 않으므로 잠긴 자격 대신 사용할 수 없는 해시를 둔다.
  const users: Record<string, { profileId: string; loginId: string; name: string; email: string; role: string }> = {}
  for (const [key, role] of [["ADMIN", "ADMIN"], ["OPERATOR", "OPERATOR"], ["VIEWER", "VIEWER"]] as const) {
    const loginId = `zt5-${key.toLowerCase()}`
    const email = `${loginId}@zt5.test.invalid`
    let cred = await prisma.userCredential.findFirst({ where: { tenantId: TENANT_ID, loginId } })
    let profileId = cred?.profileId
    if (!profileId) {
      const profile = await prisma.profile.upsert({ where: { email }, update: {}, create: { email, name: `ZT5 ${key}` } })
      profileId = profile.id
      cred = await prisma.userCredential.create({ data: { tenantId: TENANT_ID, loginId, profileId, passwordHash: "!zt5-no-password-login", mustChangePw: false } })
    }
    const tu = await prisma.tenantUser.findFirst({ where: { tenantId: TENANT_ID, profileId } })
    if (!tu) await prisma.tenantUser.create({ data: { tenantId: TENANT_ID, profileId, role, siteId: site.id, isActive: true } })
    else if (tu.role !== role || !tu.isActive) await prisma.tenantUser.update({ where: { id: tu.id }, data: { role, isActive: true } })
    users[key] = { profileId, loginId, name: `ZT5 ${key}`, email, role }
  }
  info("S2", `테스트 사용자 ${Object.values(users).map((u) => u.loginId).join(", ")}`)

  const partner = async (code: string, name: string, partnerType: "SUPPLIER" | "CUSTOMER") =>
    (await prisma.businessPartner.findFirst({ where: { tenantId: TENANT_ID, code } })) ?? prisma.businessPartner.create({ data: { tenantId: TENANT_ID, code, name, partnerType } })
  const supplier = await partner("ZT5-SUP", "ZT5 테스트 공급사", "SUPPLIER")
  const customer = await partner("ZT5-CUS", "ZT5 테스트 고객사", "CUSTOMER")

  const warehouse = async (code: string, name: string) => {
    const w = (await prisma.warehouse.findFirst({ where: { siteId: site.id, code } })) ?? (await prisma.warehouse.create({ data: { tenantId: TENANT_ID, siteId: site.id, code, name } }))
    const loc = (await prisma.location.findFirst({ where: { warehouseId: w.id, code: `${code}-A01` } })) ?? (await prisma.location.create({ data: { warehouseId: w.id, code: `${code}-A01`, name: `${name} A01` } }))
    return { w, loc }
  }
  const whRm = await warehouse("ZT5-WH-RM", "ZT5 원자재창고")
  const whFg = await warehouse("ZT5-WH-FG", "ZT5 완제품창고")
  const whFg2 = await warehouse("ZT5-WH-FG2", "ZT5 보조완제품창고")

  const item = async (code: string, name: string, itemType: "RAW_MATERIAL" | "FINISHED", defaultWarehouseId: string) =>
    (await prisma.item.findFirst({ where: { tenantId: TENANT_ID, code } })) ??
    prisma.item.create({ data: { tenantId: TENANT_ID, code, name, itemType, uom: "EA", isLotTracked: true, defaultWarehouseId, status: "ACTIVE" } })
  const rmA = await item("ZT5-RM-A", "ZT5 원자재 A", "RAW_MATERIAL", whRm.w.id)
  const rmB = await item("ZT5-RM-B", "ZT5 원자재 B", "RAW_MATERIAL", whRm.w.id)
  const fgA = await item("ZT5-FG-A", "ZT5 완제품 A", "FINISHED", whFg.w.id)
  const fgB = await item("ZT5-FG-B", "ZT5 완제품 B", "FINISHED", whFg.w.id)

  let bom = await prisma.bOM.findFirst({ where: { tenantId: TENANT_ID, itemId: fgA.id, version: "ZT5-1" }, include: { bomItems: true } })
  if (!bom) {
    bom = await prisma.bOM.create({
      data: {
        tenantId: TENANT_ID,
        itemId: fgA.id,
        version: "ZT5-1",
        status: "ACTIVE",
        bomItems: { create: [{ componentItemId: rmA.id, seq: 10, qtyPer: 2 }, { componentItemId: rmB.id, seq: 20, qtyPer: 1 }] },
      },
      include: { bomItems: true },
    })
  }
  const workCenters = await prisma.workCenter.findMany({ where: { siteId: site.id }, orderBy: { code: "asc" }, take: 2 })
  let routing = await prisma.routing.findFirst({ where: { tenantId: TENANT_ID, code: "ZT5-RT-A" }, include: { operations: true } })
  if (!routing) {
    routing = await prisma.routing.create({
      data: {
        tenantId: TENANT_ID,
        code: "ZT5-RT-A",
        name: "ZT5 라우팅 A",
        version: "1",
        status: "ACTIVE",
        operations: {
          create: [
            { workCenterId: workCenters[0].id, seq: 10, operationCode: "ZT5-OP10", name: "ZT5 공정10" },
            { workCenterId: (workCenters[1] ?? workCenters[0]).id, seq: 20, operationCode: "ZT5-OP20", name: "ZT5 공정20" },
          ],
        },
      },
      include: { operations: true },
    })
  }
  const itemRouting = await prisma.itemRouting.findFirst({ where: { itemId: fgA.id, routingId: routing.id } })
  if (!itemRouting) await prisma.itemRouting.create({ data: { tenantId: TENANT_ID, itemId: fgA.id, routingId: routing.id, isDefault: true } })

  const poNo = "ZT5-PO-001"
  let po = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, orderNo: poNo }, include: { items: true } })
  if (!po) {
    po = await prisma.purchaseOrder.create({
      data: {
        tenantId: TENANT_ID,
        siteId: site.id,
        supplierId: supplier.id,
        orderNo: poNo,
        orderDate: new Date(),
        expectedDate: new Date(Date.now() + 7 * 86400000),
        status: "ORDERED",
        items: { create: [{ itemId: rmA.id, qty: 5000, unitPrice: 10 }, { itemId: rmB.id, qty: 5000, unitPrice: 20 }] },
      },
      include: { items: true },
    })
  }
  const soNo = "ZT5-SO-001"
  let so = await prisma.salesOrder.findFirst({ where: { tenantId: TENANT_ID, orderNo: soNo }, include: { items: true } })
  if (!so) {
    so = await prisma.salesOrder.create({
      data: {
        tenantId: TENANT_ID,
        siteId: site.id,
        customerId: customer.id,
        orderNo: soNo,
        orderDate: new Date(),
        deliveryDate: new Date(Date.now() + 14 * 86400000),
        status: "CONFIRMED",
        items: { create: [{ itemId: fgA.id, qty: 1000 }, { itemId: fgB.id, qty: 100 }] },
      },
      include: { items: true },
    })
  }
  check("S3", [rmA, rmB, fgA, fgB].every(Boolean) && bom.bomItems.length === 2 && routing.operations.length === 2 && po.items.length === 2 && so.items.length === 2, "품목 4 · BOM(2) · 라우팅(2공정) · 발주(2) · 수주(2) 준비")
  console.log(
    "IDS " +
      JSON.stringify({
        site: site.id,
        users,
        warehouses: { rm: whRm.w.id, fg: whFg.w.id, fg2: whFg2.w.id },
        locations: { rm: whRm.loc.id, fg: whFg.loc.id, fg2: whFg2.loc.id },
        items: { rmA: rmA.id, rmB: rmB.id, fgA: fgA.id, fgB: fgB.id },
        bom: bom.id,
        routing: routing.id,
        ops: routing.operations.map((o) => o.id),
        po: { id: po.id, items: po.items.map((i) => ({ id: i.id, itemId: i.itemId })) },
        so: { id: so.id, items: so.items.map((i) => ({ id: i.id, itemId: i.itemId })) },
      }),
  )
  summary("seed")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-4).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
