/**
 * 계측기 검교정관리 권한 기본값 검증 (DB 불필요)
 *  - permission-catalog.ts 가 기본 권한의 유일한 정의이고, 요구된 역할별 정책표와 일치하는가
 *  - seed / 사용자관리 화면(ensurePermissionMatrix) / 기존 DB 용 데이터 migration 이 같은 값을 쓰는가(드리프트 검사)
 *  - 초기화 함수가 멱등이고 기존 행을 덮어쓰지 않는 방식(createMany skipDuplicates)인가
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import {
  ALL_RESOURCES,
  DAEWON_OUT_OF_SCOPE_RESOURCES,
  buildDefaultPermissionRows,
  defaultActionsForResource,
  type CatalogAction,
  type CatalogRole,
} from "../src/lib/auth/permission-catalog"
import { ensureDefaultPermissions } from "../src/lib/auth/permission-init"

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8")

let passed = 0
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1
    console.log(`PASS ${passed}: ${name}`)
  })
}

const RESOURCE = "INSTRUMENT_CALIBRATION"
const sorted = (v: CatalogAction[]) => [...v].sort()

async function main() {
  await check("정책표: 계측기 검교정관리 역할별 기본 권한", () => {
    const d = defaultActionsForResource(RESOURCE)
    // 조회/등록/수정/삭제·폐기/엑셀다운로드
    assert.deepEqual(sorted(d.OWNER), sorted(["READ", "CREATE", "UPDATE", "DELETE", "APPROVE", "EXPORT"]))
    assert.deepEqual(sorted(d.ADMIN), sorted(["READ", "CREATE", "UPDATE", "DELETE", "APPROVE", "EXPORT"]))
    assert.deepEqual(sorted(d.MANAGER), sorted(["READ", "CREATE", "UPDATE", "EXPORT"])) // 삭제/폐기 없음
    assert.deepEqual(d.OPERATOR, ["READ"])
    assert.deepEqual(d.VIEWER, ["READ"])
    for (const role of ["MANAGER", "OPERATOR", "VIEWER"] as CatalogRole[]) assert.ok(!d[role].includes("DELETE"), `${role} 는 삭제/폐기 불가`)
    for (const role of ["OPERATOR", "VIEWER"] as CatalogRole[]) assert.ok(!d[role].includes("EXPORT"), `${role} 는 엑셀 다운로드 불가`)
  })

  await check("정책: 신규 리소스가 '무조건 전체 허용'이 아니다(역할별 행이 명시적으로 다르다)", () => {
    const d = defaultActionsForResource(RESOURCE)
    assert.ok(d.VIEWER.length < d.MANAGER.length && d.MANAGER.length < d.ADMIN.length)
  })

  await check("카탈로그: 중복 행 없음, 모든 행 isAllowed=true, 리소스가 ALL_RESOURCES 에 포함", () => {
    const rows = buildDefaultPermissionRows("T")
    const keys = rows.map((r) => `${r.role}|${r.resource}|${r.action}`)
    assert.equal(new Set(keys).size, keys.length)
    assert.ok(rows.every((r) => r.isAllowed))
    assert.ok(ALL_RESOURCES.includes(RESOURCE))
  })

  await check("seed 정책: 구축 범위 밖 리소스는 OWNER/ADMIN 에게만, 계측기 권한은 영향 없음", () => {
    const rows = buildDefaultPermissionRows("T", { withheldFromNonAdmin: DAEWON_OUT_OF_SCOPE_RESOURCES })
    for (const resource of Array.from(DAEWON_OUT_OF_SCOPE_RESOURCES)) {
      assert.ok(rows.filter((r) => r.resource === resource).every((r) => r.role === "OWNER" || r.role === "ADMIN"), resource)
    }
    const instrument = rows.filter((r) => r.resource === RESOURCE)
    assert.deepEqual(
      sorted(instrument.filter((r) => r.role === "MANAGER").map((r) => r.action)),
      sorted(["READ", "CREATE", "UPDATE", "EXPORT"]),
    )
  })

  await check("onlyResources: 지정한 리소스의 행만 만든다(기존 DB 보완용)", () => {
    const rows = buildDefaultPermissionRows("T", { onlyResources: new Set([RESOURCE]) })
    assert.ok(rows.length > 0 && rows.every((r) => r.resource === RESOURCE))
    assert.equal(rows.length, 6 + 6 + 4 + 1 + 1)
  })

  await check("멱등/비파괴: 초기화는 createMany(skipDuplicates:true) 한 번만 쓰고 update/delete 를 하지 않는다", async () => {
    const calls: Array<{ data: unknown[]; skipDuplicates: boolean }> = []
    const fake = {
      rolePermission: {
        async createMany(args: { data: unknown[]; skipDuplicates: true }) {
          calls.push(args)
          return { count: 3 }
        },
      },
    }
    const count = await ensureDefaultPermissions(fake, "T", { onlyResources: new Set([RESOURCE]) })
    assert.equal(count, 3)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].skipDuplicates, true)
    const source = read("src/lib/auth/permission-init.ts")
    assert.ok(!/\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(|\.upsert\(/.test(source))
  })

  await check("단일 정의: seed 와 permission.actions 는 카탈로그를 import 하고 자체 기본값을 정의하지 않는다", () => {
    const seed = read("prisma/seed-daewon.ts")
    const actions = read("src/lib/actions/permission.actions.ts")
    assert.ok(seed.includes("permission-init") && seed.includes("permission-catalog"))
    assert.ok(actions.includes("@/lib/auth/permission-catalog"))
    for (const source of [seed, actions]) {
      assert.ok(!/const (ALL_RESOURCES|MANAGER_PERMS|OPERATOR_PERMS|VIEWER_RESOURCES|MANAGER|OPERATOR)\b/.test(source), "기본값 중복 정의 금지")
    }
  })

  await check("seed: 권한 행은 skipDuplicates 경로(ensureDefaultPermissions)로만 저장한다", () => {
    const seed = read("prisma/seed-daewon.ts")
    const fn = seed.slice(seed.indexOf("async function seedRolePermissions"), seed.indexOf("async function seedFeatures"))
    assert.ok(fn.includes("ensureDefaultPermissions(prisma, TENANT_ID"))
    assert.ok(!/rolePermission\.(deleteMany|delete|update|updateMany|upsert)/.test(fn))
  })

  await check("사용자관리 화면 비의존: 권한 행 생성이 seed/마이그레이션에도 있다(ensurePermissionMatrix 는 보조 경로)", () => {
    assert.ok(fs.existsSync(path.join(root, "prisma/migrations/20261029010000_add_instrument_calibration_permissions/migration.sql")))
    assert.ok(read("package.json").includes("db:ensure-permissions"))
  })

  await check("드리프트: 기존 DB 용 데이터 migration 의 기본값이 카탈로그와 같다", () => {
    const sql = read("prisma/migrations/20261029010000_add_instrument_calibration_permissions/migration.sql")
    const pairs = Array.from(sql.matchAll(/\('(OWNER|ADMIN|MANAGER|OPERATOR|VIEWER)', '([A-Z]+)'\)/g)).map((m) => `${m[1]}|${m[2]}`)
    const expected: string[] = []
    const d = defaultActionsForResource(RESOURCE)
    for (const role of Object.keys(d) as CatalogRole[]) for (const action of d[role]) expected.push(`${role}|${action}`)
    assert.deepEqual([...pairs].sort(), expected.sort())
    assert.ok(sql.includes("ON CONFLICT") && sql.includes("DO NOTHING"))
    assert.ok(!/\b(UPDATE|DELETE)\b\s+(FROM\s+)?"?RolePermission/i.test(sql.replace(/--.*$/gm, "")), "migration 은 INSERT 만 한다")
    assert.ok(sql.includes(`'${RESOURCE}'`))
  })

  await check("서버 권한 해석: 행이 없으면 쓰기를 허용하지 않는다(role-permissions.ts 는 '행 없음 = 전체 허용'으로 바뀌지 않았다)", () => {
    const source = read("src/lib/auth/role-permissions.ts")
    const fn = source.slice(source.indexOf("export function hasResourcePermission"), source.indexOf("export async function hasCurrentUserResourcePermission"))
    assert.ok(fn.includes("snapshot.allowed.has(permissionKey(resource, action))"))
    assert.ok(fn.includes("if (!snapshot) return false"))
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
