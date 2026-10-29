/**
 * 기존 DB 에 누락된 기본 권한 행만 보완한다 (사용자관리 화면 진입과 무관, 멱등, 기존 행은 덮어쓰지 않음).
 *
 * 사용: DEFAULT_TENANT_ID=<테넌트> [ENSURE_RESOURCES=INSTRUMENT_CALIBRATION,...] npm run db:ensure-permissions
 *  - ENSURE_RESOURCES 를 생략하면 카탈로그 전체에서 누락된 행을 채운다(구축 범위 밖 리소스는 MANAGER/OPERATOR/VIEWER 에 부여하지 않음).
 *  - 확인 플래그 DAEWON_ENSURE_PERMISSIONS_CONFIRM=YES 가 없으면 아무것도 쓰지 않는다.
 * 새 리소스를 추가할 때는 permission-catalog.ts 에 기본값을 넣고 이 스크립트(또는 같은 내용의 데이터 migration)로 기존 DB 를 보완한다.
 */
import { PrismaClient } from "@prisma/client"
import { DAEWON_OUT_OF_SCOPE_RESOURCES } from "../src/lib/auth/permission-catalog"
import { ensureDefaultPermissions } from "../src/lib/auth/permission-init"

async function main() {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim()
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID 가 필요합니다.")
  if (process.env.DAEWON_ENSURE_PERMISSIONS_CONFIRM !== "YES") {
    throw new Error("DAEWON_ENSURE_PERMISSIONS_CONFIRM=YES 를 지정해야 실행합니다(대상 DB 를 확인한 뒤).")
  }
  const only = process.env.ENSURE_RESOURCES?.split(",").map((v) => v.trim()).filter(Boolean)
  const prisma = new PrismaClient()
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) throw new Error(`테넌트 ${tenantId} 를 찾을 수 없습니다.`)
    const created = await ensureDefaultPermissions(prisma, tenantId, {
      withheldFromNonAdmin: DAEWON_OUT_OF_SCOPE_RESOURCES,
      onlyResources: only && only.length > 0 ? new Set(only) : undefined,
    })
    console.log(`신규 권한 행 ${created}개 추가 (기존 행은 변경하지 않음)`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
