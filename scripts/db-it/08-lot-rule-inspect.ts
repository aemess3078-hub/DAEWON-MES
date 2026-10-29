/** LOT 자동 채번 규칙 읽기 전용 점검 (쓰기 없음): NumberingRule / NumberingSequence / 품목 LOT 정책 분포 / 기존 LOT 번호 형태. */
import { PrismaClient } from "@prisma/client"
import { loadEnv, verifyTarget } from "./env"

async function main() {
  loadEnv()
  const t = verifyTarget()
  console.log("대상:", JSON.stringify({ projectRef: t.projectRef, database: t.database, tenantId: t.tenantId }))
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } })
  try {
    const tenantId = t.tenantId
    const rules = await prisma.numberingRule.findMany({ where: { tenantId }, include: { sequences: true } })
    console.log(`NumberingRule(${tenantId}): ${rules.length}건`)
    for (const r of rules) {
      console.log(JSON.stringify({ id: r.id, type: r.type, isActive: r.isActive, updatedAt: r.updatedAt, tokens: r.tokens, sequences: r.sequences }))
    }
    const allRules = await prisma.numberingRule.count()
    console.log(`NumberingRule 전체(모든 tenant): ${allRules}건`)

    const dist = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      select "lotNumberingType"::text as lnt, "manualLotPolicy"::text as mlp, "isLotTracked" as tracked, count(*)::int as n
      from "Item" where "tenantId" = ${tenantId} group by 1,2,3 order by 4 desc`
    console.log("품목 LOT 정책 분포:", JSON.stringify(dist))

    const lotCount = await prisma.lot.count({ where: { tenantId } })
    const resCount = await prisma.lotNumberReservation.count({ where: { tenantId } })
    console.log(`Lot=${lotCount}, LotNumberReservation=${resCount}`)
    const sample = await prisma.lot.findMany({ where: { tenantId }, select: { lotNo: true, item: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 15 })
    console.log("최근 LOT 샘플:", JSON.stringify(sample.map((l) => `${l.item.code} | ${l.lotNo}`)))
    const dw = await prisma.item.findMany({ where: { tenantId, code: { startsWith: "DW-" } }, select: { code: true, name: true, itemType: true, isLotTracked: true, lotNumberingType: true, manualLotPolicy: true }, take: 10 })
    console.log("DW- 품목 샘플:", JSON.stringify(dw))
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => {
  console.error("실패:", (e as Error).message.split("\n").slice(-3).join(" | "))
  process.exit(1)
})
