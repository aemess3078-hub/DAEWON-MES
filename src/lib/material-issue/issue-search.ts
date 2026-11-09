import { Prisma } from "@prisma/client"

/**
 * 자재출고 통합 검색 (자재출고현황 · 자재출고이력 공용).
 *
 * 검색 대상: 출고번호(출고 수불번호), 작업지시번호, 제조번호, 품목코드, 품목명, LOT 번호.
 *  - 검색어는 앞뒤 공백을 지우고 공백으로 나눈다. 나뉜 검색어끼리는 AND, 한 검색어 안에서 대상 항목끼리는 OR.
 *  - 대소문자 구분 없는 부분 일치.
 *
 * 특수문자 처리(중요): 실제 PostgreSQL 에서 확인한 결과 Prisma `contains` 는 `%` `_` `\` 를 이스케이프하지 않는다
 * (`contains: "%"` 가 모든 행에 일치하고 `_` 가 한 글자 와일드카드로 동작하며, 백슬래시 이스케이프도 기대대로 동작하지 않는다).
 * 그래서 LIKE 를 쓰지 않고 `strpos(lower(열), lower(검색어)) > 0` 로 비교한다 — strpos 에는 와일드카드·이스케이프 개념이 없어
 * 검색어는 항상 일반 문자열이며, 검색어는 바인딩 파라미터로만 전달된다(SQL 문자열에 이어 붙이지 않는다).
 *
 * 순수 SQL 조각 + 조회 함수만 둔다. 인증은 호출하는 Server Action 이 한다.
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

// ─── SQL 조각 ──────────────────────────────────────────────────────────────

/** 열(식별자 SQL)에 검색어가 들어 있는가(대소문자 무시, 와일드카드 없음). NULL 은 빈 문자열로 본다. */
function contains(column: Prisma.Sql, term: string): Prisma.Sql {
  return Prisma.sql`strpos(lower(COALESCE(${column}, '')), lower(${term})) > 0`
}

/** 검색어마다 (항목 OR) 조건을 만들고 서로 AND 로 묶는다. 검색어가 없으면 TRUE. */
function allTerms(terms: string[], perTerm: (term: string) => Prisma.Sql): Prisma.Sql {
  if (terms.length === 0) return Prisma.sql`TRUE`
  return Prisma.join(terms.map((term) => Prisma.sql`(${perTerm(term)})`), " AND ")
}

type RawDb = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> }

// ─── 자재출고현황: 작업지시 검색 ───────────────────────────────────────────────

function workOrderTermSql(term: string): Prisma.Sql {
  return Prisma.sql`
    ${contains(Prisma.sql`wo."orderNo"`, term)}
    OR ${contains(Prisma.sql`wo."manufacturingNo"`, term)}
    OR EXISTS (
      SELECT 1 FROM "Item" i
      WHERE i."id" = wo."itemId" AND (${contains(Prisma.sql`i."code"`, term)} OR ${contains(Prisma.sql`i."name"`, term)})
    )
    OR EXISTS (
      SELECT 1 FROM "BOMItem" bi JOIN "Item" ci ON ci."id" = bi."componentItemId"
      WHERE bi."bomId" = wo."bomId" AND (${contains(Prisma.sql`ci."code"`, term)} OR ${contains(Prisma.sql`ci."name"`, term)})
    )
    OR EXISTS (
      SELECT 1 FROM "InventoryTransaction" tx LEFT JOIN "Lot" l ON l."id" = tx."lotId"
      WHERE tx."tenantId" = wo."tenantId" AND tx."refType" = 'WORK_ORDER' AND tx."refId" = wo."id" AND tx."txType"::text = 'ISSUE'
        AND (${contains(Prisma.sql`tx."txNo"`, term)} OR ${contains(Prisma.sql`l."lotNo"`, term)})
    )`
}

function workOrderWhereSql(tenantId: string, statuses: readonly string[], terms: string[]): Prisma.Sql {
  return Prisma.sql`
    wo."tenantId" = ${tenantId}
    AND wo."status"::text IN (${Prisma.join([...statuses])})
    AND ${allTerms(terms, workOrderTermSql)}`
}

/**
 * 검색 조건에 맞는 작업지시 id 한 페이지(기존 정렬: 납기 오름차순 → 작업지시번호) + 같은 조건의 전체 건수.
 * 작업지시 한 행당 한 번만 나온다(출고 수불·BOM 은 EXISTS 로만 걸러 조인 중복이 없다).
 */
export async function findIssueWorkOrderPage(
  db: RawDb,
  params: { tenantId: string; statuses: readonly string[]; terms: string[]; page: number; pageSize: number },
): Promise<{ ids: string[]; total: number; page: number; totalPages: number }> {
  const where = workOrderWhereSql(params.tenantId, params.statuses, params.terms)
  const countRows = await db.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT COUNT(*)::int AS total FROM "WorkOrder" wo WHERE ${where}`)
  const total = Number(countRows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))
  const page = Math.min(params.page, totalPages)
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT wo."id" FROM "WorkOrder" wo
    WHERE ${where}
    ORDER BY wo."dueDate" ASC, wo."orderNo" ASC
    LIMIT ${params.pageSize} OFFSET ${(page - 1) * params.pageSize}`)
  return { ids: rows.map((r) => r.id), total, page, totalPages }
}

// ─── 자재출고이력: 출고 수불 검색 ──────────────────────────────────────────────

export type IssueHistoryFilter = {
  tenantId: string
  terms: string[]
  /** 조회 시작·끝 시각(UTC, 끝은 포함하지 않음). 날짜 문자열 → 한국(KST) 하루 단위 변환은 kstDayRangeUtc. */
  fromUtc?: string | null
  toUtcExclusive?: string | null
  warehouseId?: string | null
  page: number
  pageSize: number
}

function historyTermSql(term: string): Prisma.Sql {
  return Prisma.sql`
    ${contains(Prisma.sql`tx."txNo"`, term)}
    OR ${contains(Prisma.sql`wo."orderNo"`, term)}
    OR ${contains(Prisma.sql`wo."manufacturingNo"`, term)}
    OR ${contains(Prisma.sql`it."code"`, term)}
    OR ${contains(Prisma.sql`it."name"`, term)}
    OR ${contains(Prisma.sql`l."lotNo"`, term)}`
}

const HISTORY_FROM = Prisma.sql`
  "InventoryTransaction" tx
  JOIN "WorkOrder" wo ON wo."id" = tx."refId" AND wo."tenantId" = tx."tenantId"
  JOIN "Item" it ON it."id" = tx."itemId"
  LEFT JOIN "Lot" l ON l."id" = tx."lotId"`

function historyWhereSql(f: IssueHistoryFilter): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`tx."tenantId" = ${f.tenantId}`,
    Prisma.sql`tx."refType" = 'WORK_ORDER'`,
    // 출고(ISSUE)와 작업지시 반납(RETURN)만. 입고·이동·조정·공급사 반품은 제외.
    Prisma.sql`tx."txType"::text IN ('ISSUE', 'RETURN')`,
  ]
  if (f.fromUtc) conds.push(Prisma.sql`tx."txAt" >= ${f.fromUtc}::timestamp`)
  if (f.toUtcExclusive) conds.push(Prisma.sql`tx."txAt" < ${f.toUtcExclusive}::timestamp`)
  // 출고는 출고창고(from), 반납은 반납창고(to)
  if (f.warehouseId) {
    conds.push(Prisma.sql`(CASE WHEN tx."txType"::text = 'ISSUE' THEN tx."fromLocationId" ELSE tx."toLocationId" END) = ${f.warehouseId}`)
  }
  conds.push(allTerms(f.terms, historyTermSql))
  return Prisma.join(conds.map((c) => Prisma.sql`(${c})`), " AND ")
}

/** 출고이력 한 페이지(최신 출고순)의 수불 id + 같은 조건의 전체 건수. */
export async function findIssueHistoryPage(
  db: RawDb,
  f: IssueHistoryFilter,
): Promise<{ ids: string[]; total: number; page: number; totalPages: number }> {
  const where = historyWhereSql(f)
  const countRows = await db.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT COUNT(*)::int AS total FROM ${HISTORY_FROM} WHERE ${where}`)
  const total = Number(countRows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))
  const page = Math.min(f.page, totalPages)
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT tx."id" FROM ${HISTORY_FROM}
    WHERE ${where}
    ORDER BY tx."txAt" DESC, tx."txNo" DESC
    LIMIT ${f.pageSize} OFFSET ${(page - 1) * f.pageSize}`)
  return { ids: rows.map((r) => r.id), total, page, totalPages }
}

// ─── 기간(KST) ─────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function isRealDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** "YYYY-MM-DD" 형식의 올바른 날짜만 통과(아니면 null — 필터 없음). */
export function normalizeIssueDate(raw: unknown): string | null {
  return typeof raw === "string" && isRealDate(raw.trim()) ? raw.trim() : null
}

const toTimestampText = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "")

/**
 * 기간 필터: 시작일·종료일은 모두 포함(한국 시간 하루 단위). 수불 시각은 UTC 로 저장되므로
 * 시작일 00:00 KST ≤ txAt < 종료일 다음날 00:00 KST 로 변환한다.
 */
export function kstDayRangeUtc(from: string | null, to: string | null): { fromUtc: string | null; toUtcExclusive: string | null } {
  const fromUtc = from ? toTimestampText(new Date(`${from}T00:00:00+09:00`)) : null
  let toUtcExclusive: string | null = null
  if (to) {
    const end = new Date(`${to}T00:00:00+09:00`)
    end.setUTCDate(end.getUTCDate() + 1)
    toUtcExclusive = toTimestampText(end)
  }
  return { fromUtc, toUtcExclusive }
}
