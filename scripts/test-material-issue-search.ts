/**
 * 자재출고 통합 검색·이력 — DB 없이 확인할 수 있는 순수 로직 단위 테스트.
 * 검색 SQL 자체(특수문자·OR/AND·기간·창고·페이지네이션)는 실제 PostgreSQL 로 검증한다: npm run test:material-issue-search-db
 * (이전에는 생성한 Prisma where 를 가짜 평가기로 돌려 "contains 가 와일드카드를 이스케이프한다"고 가정했으나, 실제 DB 에서 그렇지 않음이 확인되어 이 가정을 제거했다.)
 * 실행: npm run test:material-issue-search
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
const S = require("../src/lib/material-issue/issue-search") as typeof import("../src/lib/material-issue/issue-search")
const H = require("../src/lib/material-issue/issue-history") as typeof import("../src/lib/material-issue/issue-history")
/* eslint-enable @typescript-eslint/no-require-imports */

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

// 검색어
ok(JSON.stringify(S.parseIssueSearchTerms("  WO-001  ")) === '["WO-001"]', "P1 앞뒤 공백 제거")
ok(JSON.stringify(S.parseIssueSearchTerms("A1229   261109\t x")) === '["A1229","261109","x"]', "P2 공백(연속·탭)으로 분리")
ok(S.parseIssueSearchTerms("   ").length === 0 && S.parseIssueSearchTerms(undefined).length === 0 && S.parseIssueSearchTerms(42).length === 0, "P3 빈/비문자열 입력은 검색어 없음")
ok(JSON.stringify(S.parseIssueSearchTerms("abc ABC Abc")) === '["abc"]', "P4 대소문자만 다른 중복 검색어 제거")
ok(S.parseIssueSearchTerms(Array.from({ length: 30 }, (_, i) => `t${i}`).join(" ")).length === S.ISSUE_SEARCH_MAX_TERMS, "P5 검색어 개수 상한")
ok(JSON.stringify(S.parseIssueSearchTerms("50%_\\")) === '["50%_\\\\"]', "P6 특수문자는 검색어에서 변형·제거되지 않는다")
ok(S.normalizeIssuePage("3") === 3 && S.normalizeIssuePage(0) === 1 && S.normalizeIssuePage("x") === 1 && S.normalizeIssuePage(-5) === 1, "P7 페이지 번호 정규화")
ok(S.normalizeIssuePageSize(undefined) === 20 && S.normalizeIssuePageSize(5000) === 100, "P8 페이지 크기 기본값·상한")

// 기간(KST)
ok(S.normalizeIssueDate("2026-11-09") === "2026-11-09" && S.normalizeIssueDate("2026-02-31") === null && S.normalizeIssueDate("11/09/2026") === null && S.normalizeIssueDate(undefined) === null, "D1 날짜 형식·실제 존재 여부 검증")
const r = S.kstDayRangeUtc("2026-11-09", "2026-11-09")
ok(r.fromUtc === "2026-11-08 15:00:00.000" && r.toUtcExclusive === "2026-11-09 15:00:00.000", "D2 KST 하루 = 전날 15:00Z ≤ t < 당일 15:00Z (시작·종료일 포함)")
ok(S.kstDayRangeUtc(null, null).fromUtc === null && S.kstDayRangeUtc(null, "2026-12-31").toUtcExclusive === "2026-12-31 15:00:00.000", "D3 한쪽만 지정 가능")

// 반납 상태
ok(H.resolveReturnState("ISSUE", 5, 0) === "NORMAL" && H.resolveReturnState("ISSUE", 5, 2) === "PARTIAL_RETURNED" && H.resolveReturnState("ISSUE", 5, 5) === "FULL_RETURNED" && H.resolveReturnState("ISSUE", 5, 9) === "FULL_RETURNED" && H.resolveReturnState("RETURN", 2, 0) === "RETURN_ROW", "R1 출고 행 반납 상태(정상/일부/전량) · 반납 행 구분")
ok(H.ISSUE_HISTORY_PAGE_SIZE === 20, "R2 출고이력은 20건 단위")

// 소스 점검: LIKE/contains 를 쓰지 않고, 검색어는 파라미터로만, 이력은 읽기 전용·권한 확인
const search = read("src/lib/material-issue/issue-search.ts").replace(/\/\*[\s\S]*?\*\//g, "")
ok(!/\bcontains\s*:/.test(search) && !/\bILIKE\b|\bLIKE\b/i.test(search.replace(/\/\/.*$/gm, "")) && search.includes("strpos(lower("), "S1 검색은 LIKE/Prisma contains 가 아니라 strpos(와일드카드 없음)")
ok(!/\$queryRawUnsafe|\$executeRaw/.test(search), "S2 Unsafe/쓰기 raw 쿼리 없음 — 검색어는 바인딩 파라미터")
const hist = read("src/lib/actions/material-issue-history.actions.ts")
ok(/requireMaterialIssueReader\(clientTenantId\)/.test(hist) && !/\.(create|update|delete|upsert)(Many)?\(/.test(hist) && !/\$executeRaw/.test(hist), "S3 출고이력은 tenant·권한 확인(requireMaterialIssueReader) 후 읽기 전용")
const nav = read("src/lib/nav-config.ts")
ok(nav.includes("/app/mes/material-issue-history") && nav.includes("/app/mes/material-issue'"), "S4 메뉴에 출고이력 추가, 기존 자재출고현황 메뉴 유지")
const rp = read("src/lib/auth/role-permissions.ts")
ok(/"material-issue-history":\s*"PURCHASE_ORDER"/.test(rp) && /"material-issue":\s*"PURCHASE_ORDER"/.test(rp), "S5 출고이력 메뉴 권한은 자재출고현황과 같은 자원(PURCHASE_ORDER)")
ok(read("src/lib/auth/daewon-scope.ts").includes('"/app/mes/material-issue-history"'), "S6 대원정밀 허용 경로에 추가")

console.log(`\n${pass} passed`)
