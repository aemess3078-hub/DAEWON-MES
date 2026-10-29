// 기본 RolePermission 행 보완 (seed 스크립트 / 기존 DB 보완 스크립트 / 사용자관리 화면 공용)
//
// - 항상 createMany({ skipDuplicates: true }) → 멱등. 이미 저장된 행(허용/차단 모두)은 건드리지 않는다.
// - 사용자관리 화면 진입과 무관하게 호출할 수 있다(seed, `npm run db:ensure-permissions`).
// - 순수 모듈(alias 없음) — ts-node 스크립트에서도 import 가능.

import { buildDefaultPermissionRows, type BuildDefaultPermissionOptions } from "./permission-catalog"

type PermissionWriter = {
  rolePermission: {
    createMany(args: { data: ReturnType<typeof buildDefaultPermissionRows>; skipDuplicates: true }): Promise<{ count: number }>
  }
}

/** 테넌트의 누락된 기본 권한 행만 추가한다. 새로 만들어진 행 수를 돌려준다. */
export async function ensureDefaultPermissions(
  db: PermissionWriter,
  tenantId: string,
  options: BuildDefaultPermissionOptions = {},
): Promise<number> {
  const result = await db.rolePermission.createMany({
    data: buildDefaultPermissionRows(tenantId, options),
    skipDuplicates: true,
  })
  return result.count
}
