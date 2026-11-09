import type { Prisma } from "@prisma/client"

/**
 * 자재출고현황 통합 검색 (순수 함수 — DB/React 의존 없음).
 *
 * 검색 대상 6개 항목: 출고번호(출고 수불번호), 작업지시번호, 제조번호, 품목코드, 품목명, LOT 번호.
 *  - 검색어는 앞뒤 공백을 지우고 공백으로 나눈다. 나뉜 검색어끼리는 AND, 한 검색어 안에서 6개 항목은 OR.
 *  - 대소문자 구분 없는 부분 일치(Prisma contains + mode: insensitive). Prisma 가 LIKE 와일드카드(% _ \)를 문자 그대로 이스케이프하므로
 *    특수문자는 모두 일반 문자열로 검색된다(SQL 문자열 연결을 쓰지 않는다).
 *  - 출고번호·LOT 번호는 작업지시와 다형 참조(InventoryTransaction.refType/refId)로만 이어져 있어, 호출 측이 검색어별로 일치한 작업지시 id 를 먼저 구해 넘긴다.
 *    (조인 대신 id 집합으로 걸러 작업지시 행이 중복되지 않는다.)
 */

export const ISSUE_SEARCH_MAX_TERMS = 8
export const ISSUE_SEARCH_MAX_TERM_LENGTH = 100
export const ISSUE_SEARCH_MAX_QUERY_LENGTH = 300
export const ISSUE_PAGE_SIZE_DEFAULT = 20
export const ISSUE_PAGE_SIZE_MAX = 100

/** 앞뒤 공백 제거 → 공백 분리 → 중복(대소문자 무시) 제거 → 길이·개수 제한. 빈 입력은 빈 배열. */
export function parseIssueSearchTerms(raw: unknown): string[] {
  if (typeof raw !== "string") return []
  const trimmed = raw.trim().slice(0, ISSUE_SEARCH_MAX_QUERY_LENGTH)
  if (!trimmed) return []
  const seen = new Set<string>()
  const terms: string[] = []
  for (const part of trimmed.split(/\s+/)) {
    const term = part.slice(0, ISSUE_SEARCH_MAX_TERM_LENGTH)
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length >= ISSUE_SEARCH_MAX_TERMS) break
  }
  return terms
}

export function normalizeIssuePage(raw: unknown): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100000) : 1
}

export function normalizeIssuePageSize(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return ISSUE_PAGE_SIZE_DEFAULT
  return Math.min(n, ISSUE_PAGE_SIZE_MAX)
}

const ci = (term: string) => ({ contains: term, mode: "insensitive" as const })

/** 검색어 하나에 대한 작업지시 직접 항목(작업지시번호·제조번호·품목코드·품목명) 조건. */
function directTermConditions(term: string): Prisma.WorkOrderWhereInput[] {
  return [
    { orderNo: ci(term) },
    { manufacturingNo: ci(term) },
    // 품목: 생산 품목 + 화면에 보이는 BOM 원자재 품목
    { item: { is: { OR: [{ code: ci(term) }, { name: ci(term) }] } } },
    { bom: { is: { bomItems: { some: { componentItem: { is: { OR: [{ code: ci(term) }, { name: ci(term) }] } } } } } } },
  ]
}

/**
 * 검색 조건(기존 tenant·상태 범위는 호출 측이 AND 로 결합). 검색어가 없으면 null(조건 없음).
 * @param issueMatchedIds 검색어(소문자) → 그 검색어가 출고번호 또는 LOT 번호에 일치하는 작업지시 id 목록
 */
export function buildIssueSearchWhere(
  terms: string[],
  issueMatchedIds: ReadonlyMap<string, readonly string[]>,
): Prisma.WorkOrderWhereInput | null {
  if (terms.length === 0) return null
  return {
    AND: terms.map((term) => {
      const ids = issueMatchedIds.get(term.toLowerCase()) ?? []
      const conditions = directTermConditions(term)
      if (ids.length > 0) conditions.push({ id: { in: [...ids] } })
      return { OR: conditions }
    }),
  }
}

/** 출고번호·LOT 번호 일치 작업지시 조회용 InventoryTransaction 조건(출고 수불만, 작업지시 참조만). */
export function buildIssueTxSearchWhere(tenantId: string, term: string): Prisma.InventoryTransactionWhereInput {
  return {
    tenantId,
    txType: "ISSUE",
    refType: "WORK_ORDER",
    refId: { not: null },
    OR: [{ txNo: ci(term) }, { lot: { is: { lotNo: ci(term) } } }],
  }
}
