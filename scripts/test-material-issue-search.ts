/**
 * 자재출고현황 통합 검색 조건 단위 테스트 — DB 없이, 생성된 Prisma where 를 작은 평가기로 실행해 의미(OR/AND/부분일치/와일드카드)를 검증한다.
 * 실행: npm run test:material-issue-search
 */
import assert from "node:assert/strict"
import {
  buildIssueSearchWhere,
  buildIssueTxSearchWhere,
  normalizeIssuePage,
  normalizeIssuePageSize,
  parseIssueSearchTerms,
  ISSUE_SEARCH_MAX_TERMS,
} from "../src/lib/material-issue/issue-search"

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}

// ─── Prisma where 평가기(테스트에 쓰이는 연산자만) ─────────────────────────────
type Rec = Record<string, unknown>
function matchField(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object") {
    const c = cond as Rec
    if ("contains" in c) {
      // Prisma contains 는 % _ 를 문자 그대로 취급한다 → 단순 부분 문자열 비교
      if (typeof value !== "string") return false
      const a = c.mode === "insensitive" ? value.toLowerCase() : value
      const b = c.mode === "insensitive" ? String(c.contains).toLowerCase() : String(c.contains)
      return a.includes(b)
    }
    if ("in" in c) return (c.in as unknown[]).includes(value)
    if ("not" in c) return value !== c.not
  }
  return value === cond
}
function evalWhere(rec: Rec, where: Rec): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Rec[]).every((w) => evalWhere(rec, w))
    if (key === "OR") return (cond as Rec[]).some((w) => evalWhere(rec, w))
    const c = cond as Rec
    if (c && typeof c === "object" && "is" in c) {
      const rel = rec[key] as Rec | undefined
      return !!rel && evalWhere(rel, c.is as Rec)
    }
    if (c && typeof c === "object" && "some" in c) {
      const list = (rec[key] as Rec[] | undefined) ?? []
      return list.some((r) => evalWhere(r, c.some as Rec))
    }
    return matchField(rec[key], cond)
  })
}

type Wo = { id: string; orderNo: string; manufacturingNo: string | null; item: { code: string; name: string }; bom: { bomItems: { componentItem: { code: string; name: string } }[] } }
const wo = (id: string, orderNo: string, mfg: string | null, code: string, name: string, comps: [string, string][] = []): Wo => ({
  id, orderNo, manufacturingNo: mfg, item: { code, name }, bom: { bomItems: comps.map(([c, n]) => ({ componentItem: { code: c, name: n } })) },
})
const rows: Wo[] = [
  wo("1", "WO-2026-001", "A1229-26", "FG-BRK", "브라켓", [["RM-SUS", "스테인리스 봉재"]]),
  wo("2", "WO-2026-002", "261109-01", "FG-AXL", "액슬 샤프트", [["RM-STL", "탄소강"]]),
  wo("3", "WO-2026-003", null, "FG-100%", "퍼센트_품목", []),
  wo("4", "WO-2026-004", "A1229-27", "FG-PIN", "핀", [["RM-SUS", "스테인리스 봉재"]]),
]
// 출고 수불(출고번호·LOT)로 일치한 작업지시 id — 호출 측이 구해 넘기는 값
const txIndex = [
  { woId: "1", txNo: "ISS-0001", lotNo: "LOT-001" },
  { woId: "2", txNo: "ISS-0002", lotNo: "LOT-002" },
  { woId: "4", txNo: "ISS-0003", lotNo: "LOT-001" },
]
function search(q: string, extra?: (w: Wo) => boolean): string[] {
  const terms = parseIssueSearchTerms(q)
  const idMap = new Map<string, string[]>()
  for (const t of terms) {
    const lower = t.toLowerCase()
    idMap.set(lower, Array.from(new Set(txIndex.filter((x) => x.txNo.toLowerCase().includes(lower) || x.lotNo.toLowerCase().includes(lower)).map((x) => x.woId))))
  }
  const where = buildIssueSearchWhere(terms, idMap)
  return rows.filter((r) => (where ? evalWhere(r as unknown as Rec, where as Rec) : true) && (extra ? extra(r) : true)).map((r) => r.id)
}

// ─── 검색어 파싱 ──────────────────────────────────────────────────────────
ok(JSON.stringify(parseIssueSearchTerms("  WO-001  ")) === '["WO-001"]', "P1 앞뒤 공백 제거")
ok(JSON.stringify(parseIssueSearchTerms("A1229   261109\t x")) === '["A1229","261109","x"]', "P2 공백(연속·탭)으로 분리")
ok(parseIssueSearchTerms("   ").length === 0 && parseIssueSearchTerms(undefined).length === 0 && parseIssueSearchTerms(42).length === 0, "P3 빈/비문자열 입력은 검색어 없음")
ok(JSON.stringify(parseIssueSearchTerms("abc ABC Abc")) === '["abc"]', "P4 대소문자만 다른 중복 검색어 제거")
ok(parseIssueSearchTerms(Array.from({ length: 30 }, (_, i) => `t${i}`).join(" ")).length === ISSUE_SEARCH_MAX_TERMS, "P5 검색어 개수 상한")
ok(normalizeIssuePage("3") === 3 && normalizeIssuePage(0) === 1 && normalizeIssuePage("x") === 1 && normalizeIssuePage(-5) === 1, "P6 페이지 번호 정규화")
ok(normalizeIssuePageSize(undefined) === 20 && normalizeIssuePageSize(5000) === 100, "P7 페이지 크기 기본값·상한")
ok(buildIssueSearchWhere([], new Map()) === null, "P8 빈 검색어는 조건 없음(기존 필터만)")

// ─── 검색 의미 ────────────────────────────────────────────────────────────
ok(search("WO-2026-001").join() === "1", "S1 작업지시번호 부분 일치")
ok(search("wo-2026-00").join() === "1,2,3,4", "S2 대소문자 구분 없음 · 부분 일치")
ok(search("a1229").join() === "1,4", "S3 제조번호 일치")
ok(search("fg-axl").join() === "2", "S4 품목코드 일치")
ok(search("브라켓").join() === "1", "S5 품목명 일치")
ok(search("봉재").join() === "1,4", "S6 BOM 원자재 품목명 일치")
ok(search("ISS-0002").join() === "2", "S7 출고번호 일치")
ok(search("LOT-001").join() === "1,4", "S8 LOT 번호 일치(출고 수불 기준)")
ok(search("A1229 261109").join() === "", "S9 다중 검색어는 AND — 서로 다른 작업지시의 값이면 결과 없음")
ok(search("A1229 LOT-001").join() === "1,4", "S10 다중 검색어 AND — 제조번호 + LOT")
ok(search("A1229 ISS-0003").join() === "4", "S11 제조번호 + 출고번호 AND")
ok(search("a1229 -27").join() === "4", "S12 검색어마다 6개 항목 중 하나 이상 일치하면 됨")
ok(search("WO-2026-001 LOT-001 브라켓").join() === "1", "S13 항목이 서로 다른 3개 검색어 AND")
ok(search("").join() === "1,2,3,4" && search("   ").join() === "1,2,3,4", "S14 빈 검색어는 전체")
ok(search("zzzz").join() === "", "S15 일치 없음")
// 와일드카드는 문자 그대로
ok(search("%").join() === "3", "W1 % 는 와일드카드가 아니라 문자 — '%' 가 든 품목만")
ok(search("_").join() === "3", "W2 _ 는 문자 그대로 — '_' 가 든 품목만")
ok(search("FG-1_0").join() === "", "W3 _ 가 한 글자 와일드카드로 동작하지 않음")
ok(search("'; DROP TABLE").join() === "" && search("\\").join() === "", "W4 따옴표·역슬래시 등은 일반 문자열")
// 기존 필터와 AND
ok(search("WO-2026", (r) => r.id !== "2").join() === "1,3,4", "F1 기존 필터(예: 상태)와 AND 로 결합")
ok(search("LOT-001", (r) => r.id === "4").join() === "4", "F2 LOT + 기존 필터 → 둘 다 만족하는 행만")
// 중복 행 없음
ok(new Set(search("봉재 LOT-001")).size === search("봉재 LOT-001").length, "D1 여러 항목·여러 BOM 행에 일치해도 작업지시 행은 한 번만")
ok(search("rm-sus").join() === "1,4", "D2 BOM 원자재 품목코드 일치")

// ─── 출고 수불 조회 조건 ──────────────────────────────────────────────────
const txWhere = buildIssueTxSearchWhere("tenant-1", "iss%") as Rec
ok(txWhere.tenantId === "tenant-1" && txWhere.txType === "ISSUE" && txWhere.refType === "WORK_ORDER", "T1 수불 조회는 tenant·출고(ISSUE)·작업지시 참조로 제한")
ok(JSON.stringify(txWhere.OR).includes('"txNo"') && JSON.stringify(txWhere.OR).includes('"lotNo"') && JSON.stringify(txWhere.OR).includes("insensitive"), "T2 출고번호·LOT 번호를 대소문자 무시로 검색")

console.log(`\n${pass} passed`)
