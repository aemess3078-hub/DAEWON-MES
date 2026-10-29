/** 5단계 0: 실제 DB 연결 대상·스키마·기존 데이터 읽기 전용 점검. 쓰기 없음. */
import { PrismaClient } from "@prisma/client"
import { loadEnv, verifyTarget } from "./env"

async function main() {
  loadEnv()
  const t = verifyTarget()
  console.log("대상:", JSON.stringify({ ...t, consistent: true }))
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } })
  try {
    const [info] = await prisma.$queryRaw<Array<{ db: string; schema: string; version: string; user: string }>>`select current_database() as db, current_schema() as schema, version() as version, current_user as user`
    console.log("연결:", JSON.stringify(info))
    const mig = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`select migration_name, finished_at, rolled_back_at from _prisma_migrations order by started_at`
    console.log(`_prisma_migrations: ${mig.length}건, 미완료 ${mig.filter((m) => !m.finished_at || m.rolled_back_at).length}건, 마지막 ${mig.at(-1)?.migration_name}`)
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`
    console.log(`public 테이블 ${tables.length}개`)
    const counts: Array<[string, number]> = []
    for (const { table_name } of tables) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*)::bigint as n from "public"."${table_name.replace(/"/g, "")}"`)
      const n = Number(rows[0].n)
      if (n > 0) counts.push([table_name, n])
    }
    console.log("비어 있지 않은 테이블:", counts.map(([k, v]) => `${k}=${v}`).join(", "))
    const tenants = await prisma.$queryRaw<Array<Record<string, unknown>>>`select id, name from "Tenant"`
    console.log("Tenant:", JSON.stringify(tenants))
  } finally {
    await prisma.$disconnect()
  }
}
if (require.main === module) {
  main().catch((e) => {
    console.error("실패:", (e as Error).message.split("\n").slice(-3).join(" | "))
    process.exit(1)
  })
}
