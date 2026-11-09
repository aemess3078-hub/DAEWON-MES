/**
 * 번호 규칙(LOT·제조번호) 화면 접근 정책 단위 테스트 — 개발자 + 오너·관리자 허용, 그 외 거부, 메뉴 위치(이력관리).
 * 실행: npm run test:numbering-rule-access
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import Module from "node:module"
import { join } from "node:path"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
/* eslint-disable @typescript-eslint/no-require-imports */
const scope = require("../src/lib/auth/daewon-scope") as typeof import("../src/lib/auth/daewon-scope")
const dev = require("../src/lib/developer") as typeof import("../src/lib/developer")
/* eslint-enable @typescript-eslint/no-require-imports */

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

const R = "/app/mes/lot-rules"
ok(scope.isRouteAllowed(R, { loginId: "owner1", role: "OWNER" }), "A1 오너는 번호 규칙 경로 허용(대원정밀 범위 정책)")
ok(scope.isRouteAllowed(R, { loginId: "admin1", role: "ADMIN" }), "A2 관리자는 허용")
ok(scope.isRouteAllowed(R, { loginId: "test", role: "VIEWER" }), "A3 개발자 계정은 허용")
ok(!scope.isRouteAllowed(R, { loginId: "m1", role: "MANAGER" }) && !scope.isRouteAllowed(R, { loginId: "o1", role: "OPERATOR" }) && !scope.isRouteAllowed(R, { loginId: "v1", role: "VIEWER" }), "A4 매니저·작업자·조회자는 거부")
ok(!scope.isRouteAllowed(R, null) && !scope.isRouteAllowed(R, { loginId: "x" }), "A5 로그인 정보/역할이 없으면 거부")
ok(!scope.isRouteAllowed("/app/mes/features", { loginId: "owner1", role: "OWNER" }) && !scope.isRouteAllowed("/app/mes/common-codes", { loginId: "admin1", role: "ADMIN" }), "A6 다른 개발자 전용 경로(기능 관리·코드관리)는 오너·관리자에게도 계속 거부")
ok(scope.isRouteAllowed(R + "/", { loginId: "admin1", role: "ADMIN" }) && !scope.isRouteAllowed(R + "x", { loginId: "admin1", role: "ADMIN" }), "A7 경로 정규화(끝 슬래시)·접두사 오탐 없음")

const u = (loginId: string, role: "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER") => ({ loginId, role })
ok(dev.canManageNumberingRules(u("a", "OWNER")) && dev.canManageNumberingRules(u("a", "ADMIN")) && dev.canManageNumberingRules(u("test", "VIEWER")), "B1 canManageNumberingRules: 오너·관리자·개발자")
ok(!dev.canManageNumberingRules(u("a", "MANAGER")) && !dev.canManageNumberingRules(u("a", "OPERATOR")) && !dev.canManageNumberingRules(null), "B2 그 외·비로그인은 거부")

const nav = read("src/lib/nav-config.ts")
const historyBlock = nav.slice(nav.indexOf("id: 'nav-history'"), nav.indexOf("// 8. 모니터링"))
ok(historyBlock.includes("nav-lot-rules") && historyBlock.includes("parentId: 'nav-history'") && historyBlock.includes("minRole: 'ADMIN'"), "C1 번호 규칙 메뉴가 이력관리 하위로 이동(관리자 이상 노출)")
const systemBlock = nav.slice(nav.indexOf("id: 'section-system'"), nav.indexOf("];", nav.indexOf("id: 'section-system'")))
ok(!systemBlock.includes("nav-lot-rules") && systemBlock.includes("nav-features"), "C2 개발자 전용 시스템 섹션에서는 번호 규칙 제거, 기능 관리는 유지")
const actions = read("src/lib/actions/numbering-rule.actions.ts")
ok(!actions.includes("assertDeveloperOnly") && (actions.match(/assertNumberingRuleManager\(\)/g) ?? []).length === 3, "D1 번호 규칙 액션 3종은 개발자·오너·관리자 가드로 보호")
const server = read("src/lib/auth/daewon-scope.server.ts")
ok(/assertNumberingRuleManager[\s\S]*?getCurrentUser\(\)[\s\S]*?canManageNumberingRules/.test(server), "D2 서버 가드는 세션 사용자의 역할을 DB 에서 다시 확인(JWT role 비신뢰)")
ok(read("src/app/app/mes/lot-rules/page.tsx").includes("canManageNumberingRules(user)"), "D3 화면 가드도 같은 기준")

console.log(`\n${pass} passed`)
