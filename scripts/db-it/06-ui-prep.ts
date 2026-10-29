/**
 * 5단계 6 준비: 실제 화면(브라우저) 통합 테스트용 완제품 재고를 만든다(ZT5-UI 접두어, 직접 INSERT — 같은 tenant/site/창고/품목 관계).
 * 인자 없이 실행하면 새 LOT 2개(각 100)를 만들고 JSON 한 줄로 출력한다. 세션 쿠키 값(JWT)도 출력하지 않고 브라우저 테스트가 직접 만든다.
 */
import { assertTarget, fixtures, prisma, TENANT_ID, uniq } from "./lib"

async function main() {
  assertTarget()
  const fx = await fixtures()
  const mk = async (qty: number, itemId = fx.fgA.id) => {
    const lot = await prisma.lot.create({ data: { tenantId: TENANT_ID, itemId, lotNo: `ZT5-UI-${uniq()}`, status: "ACTIVE" } })
    await prisma.inventoryBalance.create({ data: { tenantId: TENANT_ID, siteId: fx.site.id, warehouseId: fx.wFg.id, itemId, lotId: lot.id, qtyOnHand: qty, qtyAvailable: qty } })
    return lot.lotNo
  }
  const out = { a1: await mk(100), a2: await mk(100), a3: await mk(100), a4: await mk(100), b1: await mk(25, fx.fgB.id) }
  console.log("UIPREP " + JSON.stringify(out))
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-4).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
