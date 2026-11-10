/**
 * 대원정밀(daewon-001) 불량코드 7종 시드 — 멱등.
 *
 *   node scripts/seed-daewon-defect-codes.js            # dry-run (기본, DB 쓰기 없음)
 *   node scripts/seed-daewon-defect-codes.js --apply    # 없는 코드만 생성
 *
 * - 대상 테넌트는 code === TENANT_CODE 한 곳뿐이다(다른 테넌트는 읽지도 쓰지도 않는다).
 * - 같은 (tenantId, code)가 이미 있으면 건드리지 않는다(이름/유형도 덮어쓰지 않음).
 * - 삭제·수정은 하지 않는다. 생성만 한다.
 */
const { PrismaClient } = require("@prisma/client")

const TENANT_CODE = "daewon-001"
const CODES = [
  { code: "D001", name: "치수 불량", defectCategory: "DIMENSIONAL" },
  { code: "D002", name: "가공 누락", defectCategory: "FUNCTIONAL" },
  { code: "D003", name: "스크래치", defectCategory: "VISUAL" },
  { code: "D004", name: "버(Burr) 미제거", defectCategory: "VISUAL" },
  { code: "D005", name: "홀 위치 불량", defectCategory: "DIMENSIONAL" },
  { code: "D006", name: "표면 조도 불량", defectCategory: "VISUAL" },
  { code: "D007", name: "소재 불량", defectCategory: "MATERIAL" },
]

async function main() {
  const apply = process.argv.includes("--apply")
  const prisma = new PrismaClient()
  try {
    const host = (process.env.DATABASE_URL || "").match(/@([^:/?]+)/)?.[1] ?? "?"
    console.log(`mode=${apply ? "APPLY" : "DRY-RUN"} host=${host} tenant=${TENANT_CODE}`)
    const tenants = await prisma.tenant.findMany({ where: { code: TENANT_CODE }, select: { id: true, code: true } })
    if (tenants.length !== 1) throw new Error(`테넌트 ${TENANT_CODE} 가 정확히 1건이 아님(${tenants.length})`)
    const tenantId = tenants[0].id

    const existing = await prisma.defectCode.findMany({ where: { tenantId, code: { in: CODES.map((c) => c.code) } } })
    const have = new Map(existing.map((e) => [e.code, e]))
    const toCreate = CODES.filter((c) => !have.has(c.code))
    for (const c of CODES) {
      const e = have.get(c.code)
      console.log(`${c.code} ${e ? `이미 존재 → 유지 (${e.name}/${e.defectCategory})` : "생성 대상"}`)
    }
    if (apply && toCreate.length > 0) {
      const r = await prisma.defectCode.createMany({
        data: toCreate.map((c) => ({ tenantId, ...c })),
        skipDuplicates: true,
      })
      console.log(`created=${r.count}`)
    } else {
      console.log(apply ? "created=0" : `would create=${toCreate.length}`)
    }
    const after = await prisma.defectCode.findMany({
      where: { tenantId, code: { in: CODES.map((c) => c.code) } },
      orderBy: { code: "asc" },
      select: { code: true, name: true, defectCategory: true },
    })
    console.log(`조회 결과 ${after.length}/${CODES.length}건`)
    for (const a of after) console.log(`  ${a.code} | ${a.name} | ${a.defectCategory}`)
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => {
  console.error("FAILED:", e.message)
  process.exit(1)
})
