/**
 * 특정 이메일 계정을 OWNER로 설정하는 초기화 스크립트
 * 실행: npx tsx scripts/set-owner.ts
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const TENANT_ID = "tenant-demo-001"
const TARGET_EMAIL = "1@1.com"

async function main() {
  console.log(`\n[1] Profile에서 ${TARGET_EMAIL} 조회 중...`)

  const profile = await prisma.profile.findUnique({ where: { email: TARGET_EMAIL } })
  if (!profile) {
    console.error(`✗ Profile에 ${TARGET_EMAIL} 계정이 없습니다.`)
    console.error("  먼저 해당 이메일로 가입신청 후 관리자 승인을 받으세요.")
    process.exit(1)
  }
  console.log(`✓ 발견: ${profile.email} (${profile.id})`)

  console.log("\n[2] Tenant 확인 중...")
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } })
  if (!tenant) {
    console.error(`✗ Tenant '${TENANT_ID}'가 DB에 없습니다. 먼저 seed를 실행하세요:`)
    console.error("  npm run db:seed (prisma/seed-daewon.ts)")
    process.exit(1)
  }
  console.log(`✓ Tenant: ${tenant.name}`)

  console.log("\n[3] TenantUser OWNER 설정 중...")
  const existing = await prisma.tenantUser.findFirst({
    where: { tenantId: TENANT_ID, profileId: profile.id },
  })

  if (existing) {
    await prisma.tenantUser.update({
      where: { id: existing.id },
      data: { role: "OWNER", isActive: true },
    })
    console.log("✓ 기존 TenantUser 업데이트 → OWNER")
  } else {
    await prisma.tenantUser.create({
      data: { tenantId: TENANT_ID, profileId: profile.id, role: "OWNER", isActive: true },
    })
    console.log("✓ TenantUser 신규 생성 → OWNER")
  }

  console.log(`\n✅ 완료! ${TARGET_EMAIL} 계정이 OWNER로 설정되었습니다.`)
  console.log("   로그인 후 /app/mes/users 에서 확인하세요.\n")
}

main()
  .catch((e) => { console.error("\n✗ 오류:", e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
