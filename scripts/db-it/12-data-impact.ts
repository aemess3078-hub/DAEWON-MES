/**
 * 테스트가 대원정밀 DB 의 기존(비 ZT) 데이터에 영향을 주지 않았는지 읽기 전용 점검. 쓰기 없음.
 * 실행: DAEWON_DB_IT_CONFIRM=aquqetajewvhyirmewfy npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/12-data-impact.ts
 */
import { assertTarget, prisma, TENANT_ID } from "./lib"

// 사용자가 번호 규칙을 저장한 시각(2026-10-28T01:22:40Z) 이후 — 이번 작업의 모든 DB 접근은 그 뒤에 이뤄졌다.
const SINCE = new Date("2026-10-28T01:23:00Z")
const ORIGINAL_RULE = {
  id: "cmvqxbacc000310mye6hfn5se",
  updatedAt: "2026-10-28T01:22:40.030Z",
  tokens: [
    { id: "9ozitrcf", key: "ITEM_CODE", type: "CONTEXT" },
    { id: "q4cc5apx", type: "DATE", format: "YY" },
    { id: "i3lrwwyz", type: "DATE", format: "MM" },
    { id: "o984hvr4", type: "SEPARATOR", value: "-" },
    { id: "myaaa8uc", type: "SEQ", digits: 3 },
  ],
}

async function q<T = Record<string, unknown>>(label: string, sql: string, ...params: unknown[]): Promise<T[]> {
  try {
    return await prisma.$queryRawUnsafe<T[]>(sql, ...params)
  } catch (e) {
    console.log(`  (${label}: 조회 불가 — ${(e as Error).message.split("\n").slice(-1)[0].slice(0, 100)})`)
    return []
  }
}

async function main() {
  assertTarget()
  console.log(`기준 시각: ${SINCE.toISOString()} 이후 변경 점검`)

  const rule = await prisma.numberingRule.findMany({ where: { tenantId: TENANT_ID } })
  const r = rule[0]
  console.log(`NumberingRule: ${rule.length}건, 원본 유지=${rule.length === 1 && r.id === ORIGINAL_RULE.id && r.updatedAt.toISOString() === ORIGINAL_RULE.updatedAt && JSON.stringify(r.tokens) === JSON.stringify(ORIGINAL_RULE.tokens) && r.isActive}, NumberingSequence=${await prisma.numberingSequence.count()}건`)

  const nonZtItems = await q<{ n: number }>("items", `select count(*)::int n from "Item" where "tenantId"=$1 and code not like 'ZT%'`, TENANT_ID)
  const ztItems = await q<{ n: number }>("zt items", `select count(*)::int n from "Item" where "tenantId"=$1 and code like 'ZT%'`, TENANT_ID)
  console.log(`Item: 비ZT ${nonZtItems[0]?.n}개 (기존 427 기대), ZT ${ztItems[0]?.n}개`)
  console.log("비ZT Item 중 기준 시각 이후 수정:", JSON.stringify(await q("item upd", `select code, "updatedAt" from "Item" where "tenantId"=$1 and code not like 'ZT%' and "updatedAt" >= $2 limit 10`, TENANT_ID, SINCE)))

  console.log("BOM 기준 시각 이후 수정/생성:", JSON.stringify(await q("bom", `select b.version, i.code item, b."isDefault", b."updatedAt" from "BOM" b join "Item" i on i.id=b."itemId" where b."tenantId"=$1 and b."updatedAt" >= $2`, TENANT_ID, SINCE)))
  console.log("ZT5 완제품 Default BOM 수:", JSON.stringify(await q("bom default", `select count(*)::int n from "BOM" b join "Item" i on i.id=b."itemId" where b."tenantId"=$1 and i.code='ZT5-FG-A' and b."isDefault"`, TENANT_ID)))
  console.log("비ZT 품목의 BOM 라인 변경:", JSON.stringify(await q("bomitem", `select count(*)::int n from "BOMItem" bi join "BOM" b on b.id=bi."bomId" join "Item" i on i.id=b."itemId" where b."tenantId"=$1 and i.code not like 'ZT%' and b."updatedAt" >= $2`, TENANT_ID, SINCE)))

  console.log("기준 시각 이후 생성된 Lot 중 비ZT 품목:", JSON.stringify(await q("lot", `select l."lotNo", i.code from "Lot" l join "Item" i on i.id=l."itemId" where l."tenantId"=$1 and l."createdAt" >= $2 and i.code not like 'ZT%'`, TENANT_ID, SINCE)))
  console.log("비ZT 품목 재고 행 기준 시각 이후 수정:", JSON.stringify(await q("inv", `select i.code, ib."updatedAt" from "InventoryBalance" ib join "Item" i on i.id=ib."itemId" where ib."tenantId"=$1 and i.code not like 'ZT%' and ib."updatedAt" >= $2 limit 10`, TENANT_ID, SINCE)))
  console.log("비ZT 품목 수불 기준 시각 이후:", JSON.stringify(await q("tx", `select count(*)::int n from "InventoryTransaction" t join "Item" i on i.id=t."itemId" where t."tenantId"=$1 and i.code not like 'ZT%' and t."txAt" >= $2`, TENANT_ID, SINCE)))
  console.log("LotNumberReservation(상태별, DW 번호):", JSON.stringify(await q("res", `select status::text, count(*)::int n, count(*) filter (where "lotNo" like 'DW-%')::int dw from "LotNumberReservation" where "tenantId"=$1 group by 1`, TENANT_ID)))

  console.log("기준 시각 이후 생성된 발주서:", JSON.stringify(await q("po", `select po."orderNo", po.status::text, (select string_agg(i.code || ':' || poi.qty::text, ',') from "PurchaseOrderItem" poi join "Item" i on i.id=poi."itemId" where poi."purchaseOrderId"=po.id) lines from "PurchaseOrder" po where po."tenantId"=$1 and po."createdAt" >= $2 order by po."createdAt"`, TENANT_ID, SINCE)))
  console.log("기준 시각 이후 생성된 생산계획:", JSON.stringify(await q("plan", `select "planNo", status::text from "ProductionPlan" where "tenantId"=$1 and "createdAt" >= $2`, TENANT_ID, SINCE)))
  console.log("기준 시각 이후 생성된 작업지시 — 비ZT 품목:", JSON.stringify(await q("wo", `select count(*)::int n from "WorkOrder" w join "Item" i on i.id=w."itemId" where w."tenantId"=$1 and w."createdAt" >= $2 and i.code not like 'ZT%'`, TENANT_ID, SINCE)), "(ZT 품목 작업지시의 WO-yyyy-nnn 번호는 시스템 채번이라 접두어가 없다)")
  console.log("설비 수집 데이터 최근 수신(삭제·중단 여부 참고):", JSON.stringify(await q("ncw", `select count(*)::int n, max("startedAt") last from "EquipmentEvent"`)))
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", (e as Error).message.split("\n").slice(-2).join(" | "))
  process.exitCode = 1
  await prisma.$disconnect()
})
