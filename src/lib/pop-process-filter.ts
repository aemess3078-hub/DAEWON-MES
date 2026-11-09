/**
 * POP 공정별 조회 · 통합 검색 순수 로직 (표시 전용 — DB/React 의존 없음).
 *
 * 이 모듈은 이미 서버가 권한·테넌트·사이트 범위로 걸러 내려 준 목록을 화면에서 다시 좁혀 보여 줄 뿐이다.
 * 작업 가능 여부(자재출고 완료·선행 공정 완료·설비배정·수량 검증)는 서버(startOperation / submitProductionResult / getOperationDetail)가
 * 요청 시점에 다시 검증하므로, 공정 선택이나 검색으로는 어떤 검증도 우회되지 않는다.
 *
 * 원형: CNS 메디칼 POP(work-select 의 '공정별 조회', work-queue 의 통합 검색). 대원정밀에는 CNS 전용 LOT 검색(pop-lot-search)을
 * 가져오지 않고, 요청된 6개 항목(작업지시번호·제조번호·품목코드·품목명·공정명·설비명) 검색만 둔다.
 */

export const POP_OPEN_STATUSES = ["IN_PROGRESS", "PENDING"] as const

export function displayProcessName(processName: string): string {
  return processName.includes("후처리") ? "후처리공정" : processName
}

/** 공백으로 나눈 검색어 전부(AND)가, 대소문자 구분 없이 주어진 항목 중 하나 이상에 부분 일치하는가. 빈 검색어는 항상 true. */
export function matchesPopKeyword(fields: ReadonlyArray<string | null | undefined>, keyword: string): boolean {
  const terms = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = fields.map((f) => (f ?? "").toLowerCase())
  return terms.every((term) => haystack.some((field) => field.includes(term)))
}

// ─── 작업선택(/pop/work-select): 작업지시 카드 ─────────────────────────────────

export type PopOperationLite = {
  id: string
  seq: number
  status: string
  routingOperation: { name: string } | null
  equipment: { name: string } | null
  assignments: { id: string; status: string; equipment: { name: string } | null }[]
}

export type PopWorkOrderLite = {
  id: string
  orderNo: string
  manufacturingNo?: string | null
  item: { name: string; code: string } | null
  operations: PopOperationLite[]
}

export type PopStatusFilter = "ALL" | "IN_PROGRESS" | "PENDING"

export const ALL_PROCESSES = "ALL"

const isOpen = (op: PopOperationLite) => op.status === "IN_PROGRESS" || op.status === "PENDING"
const opProcessName = (op: PopOperationLite) => (op.routingOperation?.name ? displayProcessName(op.routingOperation.name) : null)

export function openOperations(wo: PopWorkOrderLite): PopOperationLite[] {
  return wo.operations.filter(isOpen)
}

/** 기존 카드 클릭 동작과 같은 기본 대상: 진행중/대기 중인 첫 번째 공정. */
export function firstOpenOperation(wo: PopWorkOrderLite): PopOperationLite | undefined {
  return wo.operations.find(isOpen)
}

/**
 * 카드가 가리킬 공정. 공정을 선택했다면 그 공정의 진행중/대기 공정(진행중 우선), 전체이면 기존과 같은 첫 번째 공정.
 * 선택한 공정에 해당하는 열린 공정이 없으면 undefined.
 */
export function targetOperation(wo: PopWorkOrderLite, process: string): PopOperationLite | undefined {
  if (process === ALL_PROCESSES) return firstOpenOperation(wo)
  const matches = wo.operations.filter((op) => isOpen(op) && opProcessName(op) === process)
  return matches.find((op) => op.status === "IN_PROGRESS") ?? matches[0]
}

/** 설비배정 작업이면 진행중/대기 중인 첫 배정을 함께 열어 준다(기존 카드 클릭과 동일 규칙). */
export function targetAssignmentId(op: PopOperationLite): string | null {
  return op.assignments?.find((a) => a.status === "IN_PROGRESS" || a.status === "PENDING")?.id ?? null
}

/** 선택한 공정의 작업 화면 주소. 서버(getOperationDetail)가 접근·작업 가능 여부를 다시 검증한다. */
export function operationHref(op: PopOperationLite): string {
  const assignmentId = targetAssignmentId(op)
  return `/pop/production/${op.id}${assignmentId ? `?assignmentId=${assignmentId}` : ""}`
}

export type PopProcessOption = { name: string; total: number; inProgress: number; pending: number }

/** 등록된 공정정보(라우팅 공정명) 기준 선택지: 진행중/대기 공정이 있는 공정만, 공정 순서(seq) 순. */
export function getProcessOptions(workOrders: PopWorkOrderLite[]): PopProcessOption[] {
  const map = new Map<string, PopProcessOption & { minSeq: number }>()
  for (const wo of workOrders) {
    for (const op of openOperations(wo)) {
      const name = opProcessName(op)
      if (!name) continue
      const entry = map.get(name) ?? { name, total: 0, inProgress: 0, pending: 0, minSeq: op.seq }
      entry.total += 1
      if (op.status === "IN_PROGRESS") entry.inProgress += 1
      else entry.pending += 1
      entry.minSeq = Math.min(entry.minSeq, op.seq)
      map.set(name, entry)
    }
  }
  return Array.from(map.values())
    .sort((a, b) => a.minSeq - b.minSeq || a.name.localeCompare(b.name, "ko"))
    .map(({ minSeq: _minSeq, ...rest }) => rest)
}

/** 설비명(공정 설비 + 배정 설비). */
function equipmentNames(ops: PopOperationLite[]): string[] {
  return ops.flatMap((op) => [op.equipment?.name, ...(op.assignments ?? []).map((a) => a.equipment?.name)]).filter((n): n is string => !!n)
}

/**
 * 작업지시 카드 필터: 공정 · 작업 상태 · 검색어를 모두 만족(AND)해야 한다.
 * 공정을 선택하면 그 공정의 진행중/대기 공정이 있는 작업지시만 남고, 상태·공정명·설비명은 그 공정 기준으로 판정한다.
 * 전체 공정이면 상태는 카드가 가리키는 기본(첫 열린) 공정 기준, 공정명·설비명 검색은 작업지시의 모든 공정을 대상으로 한다.
 */
export function filterWorkOrders<T extends PopWorkOrderLite>(
  workOrders: T[],
  opts: { process: string; status: PopStatusFilter; keyword: string },
): T[] {
  return workOrders.filter((wo) => {
    const target = targetOperation(wo, opts.process)
    if (opts.process !== ALL_PROCESSES && !target) return false
    if (opts.status !== "ALL" && target?.status !== opts.status) return false
    const scoped = opts.process === ALL_PROCESSES ? wo.operations : target ? [target] : []
    return matchesPopKeyword(
      [
        wo.orderNo,
        wo.manufacturingNo,
        wo.item?.code,
        wo.item?.name,
        ...scoped.map((op) => (op.routingOperation?.name ? displayProcessName(op.routingOperation.name) : null)),
        ...equipmentNames(scoped),
      ],
      opts.keyword,
    )
  })
}

// ─── 작업대기(/app/pop/work-queue): 공정 단위 행 ──────────────────────────────

export type PopQueueRowLite = {
  orderNo: string
  manufacturingNo: string | null
  itemCode: string
  itemName: string
  processName: string
  equipmentName: string | null
  status: string
  canWork: boolean
}

export type PopQueueFilter = "ALL" | "PENDING" | "IN_PROGRESS" | "AVAILABLE" | "BLOCKED"

/** 작업대기 행 필터: 상태 · 공정 · 검색어 AND. canWork 는 서버가 계산한 값을 그대로 쓴다. */
export function filterQueueRows<T extends PopQueueRowLite>(
  rows: T[],
  opts: { status: PopQueueFilter; process: string; keyword: string },
): T[] {
  return rows.filter((row) => {
    const matchesStatus =
      opts.status === "ALL" ||
      (opts.status === "PENDING" && row.status === "PENDING") ||
      (opts.status === "IN_PROGRESS" && row.status === "IN_PROGRESS") ||
      (opts.status === "AVAILABLE" && row.canWork) ||
      (opts.status === "BLOCKED" && !row.canWork)
    if (!matchesStatus) return false
    if (opts.process !== ALL_PROCESSES && displayProcessName(row.processName) !== opts.process) return false
    return matchesPopKeyword(
      [row.orderNo, row.manufacturingNo, row.itemCode, row.itemName, row.equipmentName, displayProcessName(row.processName)],
      opts.keyword,
    )
  })
}

export type PopQueueProcessSummary = { name: string; total: number; available: number; inProgress: number; pending: number }

/** 공정별 작업가능·진행중·대기 건수(작업가능은 서버 계산값 canWork 기준, 진행중/대기는 공정 작업 상태 기준). */
export function summarizeQueueByProcess(rows: PopQueueRowLite[]): PopQueueProcessSummary[] {
  const map = new Map<string, PopQueueProcessSummary>()
  for (const row of rows) {
    const name = displayProcessName(row.processName)
    const entry = map.get(name) ?? { name, total: 0, available: 0, inProgress: 0, pending: 0 }
    entry.total += 1
    if (row.canWork) entry.available += 1
    if (row.status === "IN_PROGRESS") entry.inProgress += 1
    else if (row.status === "PENDING") entry.pending += 1
    map.set(name, entry)
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ko"))
}
