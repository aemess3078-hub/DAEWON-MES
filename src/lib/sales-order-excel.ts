// 수주 엑셀 업로드 — 파싱·검증·등록 계획 (순수 함수, DB·React 비의존)
//
// 화면(미리보기)과 서버 액션(등록 직전 재검증)이 같은 함수를 쓴다.
// 엑셀 한 파일에서 수주그룹ID 가 같은 행들은 수주 1건(품목 여러 개)이 되고, 수주그룹ID 가 다르면 별도 수주가 된다.
// 거래처·품목을 자동 생성하지 않으며, 등록 전에는 아무 것도 저장하지 않는다.

import { deriveAutoUnitPrice, getAmountMismatch, type UnitPriceRow } from "./sales-order-unit-price"

// ─── 상수 ─────────────────────────────────────────────────────────────────────

export const SALES_ORDER_EXCEL_MAX_ROWS = 1000
export const SALES_ORDER_EXCEL_MAX_BYTES = 5 * 1024 * 1024
export const SALES_ORDER_EXCEL_CURRENCIES = ["KRW", "USD", "EUR", "JPY"] as const

/** 엑셀 헤더 이름(별표 제외). 필수 열은 아래 REQUIRED 로 구분한다. */
export const SALES_ORDER_EXCEL_COLUMNS = {
  groupId: "수주그룹ID",
  customerCode: "거래처코드",
  orderDate: "수주일",
  deliveryDate: "납기일",
  itemCode: "품목코드",
  qty: "수주수량",
  unitPrice: "단가",
  totalAmount: "총금액",
  currency: "통화",
  note: "비고",
  customerPoNo: "거래처 발주번호",
} as const

export const SALES_ORDER_EXCEL_REQUIRED_COLUMNS: string[] = [
  SALES_ORDER_EXCEL_COLUMNS.groupId,
  SALES_ORDER_EXCEL_COLUMNS.customerCode,
  SALES_ORDER_EXCEL_COLUMNS.orderDate,
  SALES_ORDER_EXCEL_COLUMNS.deliveryDate,
  SALES_ORDER_EXCEL_COLUMNS.itemCode,
  SALES_ORDER_EXCEL_COLUMNS.qty,
]

const TEXT_LIMITS = { groupId: 50, code: 50, note: 500, customerPoNo: 100 } as const

// ─── 공개 타입 ────────────────────────────────────────────────────────────────

/** 클라이언트가 엑셀에서 읽어 보내는 행. cells 의 키는 별표를 뗀 헤더 이름이다. */
export type SalesOrderExcelRawRow = {
  rowNum: number
  cells: Record<string, unknown>
}

export type SalesOrderExcelIssue = {
  rowNum: number
  groupId: string | null
  column: string
  /** 등록을 막는 오류. 중복 의심은 SalesOrderDuplicateSuspect 로 따로 다룬다(사용자 확인 후 등록 가능). */
  kind: "ERROR"
  message: string
}

export type ParsedSalesOrderRow = {
  rowNum: number
  groupId: string
  customerCode: string
  orderDate: string | null
  deliveryDate: string | null
  itemCode: string
  qty: number | null
  unitPrice: number | null
  totalAmount: number | null
  currency: string
  note: string
  customerPoNo: string
}

export type SalesOrderExcelCustomerRef = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "INACTIVE"
  partnerType: "CUSTOMER" | "SUPPLIER" | "BOTH"
}

export type SalesOrderExcelItemRef = {
  id: string
  code: string
  name: string
  status: "ACTIVE" | "INACTIVE" | "DISCONTINUED"
  itemType: string
}

export type SalesOrderExcelExistingOrder = {
  orderNo: string
  customerId: string
  orderDate: string // YYYY-MM-DD
  deliveryDate: string // YYYY-MM-DD
  status: string
  /** 거래처 발주번호(없으면 null) */
  customerPoNo: string | null
  items: { itemId: string; qty: number }[]
  /** 화면 표시용 품목 요약(예: "FG-001 ×10, FG-002 ×5") */
  itemSummary?: string
}

/** 거래처 발주번호 비교 키: 앞뒤 공백 제거 + 대소문자 무시. 앞자리 0 등 문자는 그대로 둔다. 빈 값은 "". */
export function salesOrderPoKey(po: string | null | undefined): string {
  return (po ?? "").trim().toUpperCase()
}

export const CUSTOMER_PO_NO_MAX_LENGTH = 100

/** 거래처 발주번호 저장값: 앞뒤 공백만 제거하고 문자열 그대로 둔다(앞자리 0·영문 조합 보존). 비어 있으면 null. 너무 길면 Error. */
export function normalizeCustomerPoNo(po: string | null | undefined): string | null {
  const v = (po ?? "").trim()
  if (!v) return null
  if (v.length > CUSTOMER_PO_NO_MAX_LENGTH) throw new Error(`거래처 발주번호는 ${CUSTOMER_PO_NO_MAX_LENGTH}자 이하여야 합니다.`)
  return v
}

export type SalesOrderDuplicateSuspect = {
  groupId: string
  rowNum: number
  /** PO_NO: 기존 수주와 같은 거래처·발주번호 / CONTENT: 발주번호 없음 + 내용 일치 / FILE_*: 같은 파일 안 */
  basis: "PO_NO" | "CONTENT" | "FILE_PO_NO" | "FILE_CONTENT"
  message: string
  /** 비교된 기존 수주(파일 안 중복이면 null) */
  existing: SalesOrderExcelExistingOrder | null
  /** 사용자가 이 수주를 확인하고 그대로 등록하기로 했는지 */
  confirmed: boolean
}

export type SalesOrderExcelContext = {
  customers: SalesOrderExcelCustomerRef[]
  items: SalesOrderExcelItemRef[]
  existingOrders: SalesOrderExcelExistingOrder[]
}

export type SalesOrderPlanLine = {
  rowNum: number
  itemId: string
  itemCode: string
  itemName: string
  qty: number
  unitPrice: number | null
  /** INPUT: 엑셀 단가 / CALCULATED: 총금액으로 계산 / NONE: 단가 없음 */
  unitPriceSource: "INPUT" | "CALCULATED" | "NONE"
  lineAmount: number | null
}

export type SalesOrderPlanGroup = {
  groupId: string
  firstRowNum: number
  rowNums: number[]
  customerId: string | null
  customerCode: string
  customerName: string
  orderDate: string | null
  deliveryDate: string | null
  currency: string
  totalAmount: number | null
  note: string
  customerPoNo: string
  lines: SalesOrderPlanLine[]
  hasIssue: boolean
}

export type SalesOrderExcelPlan = {
  totalRows: number
  groups: SalesOrderPlanGroup[]
  issues: SalesOrderExcelIssue[]
  /** 중복 의심(차단하지 않고 사용자 확인 후 등록 가능) */
  duplicates: SalesOrderDuplicateSuspect[]
  unconfirmedDuplicateGroupIds: string[]
  summary: {
    totalRows: number
    orderCount: number
    itemCount: number
    validRows: number
    errorRows: number
    duplicateGroupCount: number
  }
  /** 오류가 없고 중복 의심이 모두 확인되어 일괄 등록할 수 있는지 */
  canImport: boolean
}

// ─── 셀 값 해석 ───────────────────────────────────────────────────────────────

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  return String(v).trim()
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function isoFromParts(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 날짜 셀 → YYYY-MM-DD. 엑셀 날짜 일련번호(숫자), YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD 문자열을 허용한다. */
export function parseSalesOrderDateCell(v: unknown): string | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1 || v > 2958465) return null
    // 엑셀 일련번호: 1900 윤년 버그 보정 포함 (25569 = 1970-01-01 의 일련번호)
    const ms = Math.round((v - 25569) * 86400 * 1000)
    return new Date(ms).toISOString().slice(0, 10)
  }
  const s = cellText(v)
  if (!s) return null
  const m = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/.exec(s)
  if (!m) return null
  if (!/[-./]/.test(s) && s.length !== 8) return null
  return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** 숫자 셀 → number. 빈 값은 null, 해석 불가는 NaN. 천 단위 쉼표는 허용한다. */
export function parseSalesOrderNumberCell(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN
  const s = cellText(v).replace(/,/g, "").replace(/\s+/g, "")
  if (!s) return null
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN
  return Number(s)
}

// ─── 1단계: 행 파싱 (형식 검증) ───────────────────────────────────────────────

/** 헤더 이름 목록에서 필수 열이 빠졌는지 확인한다. 빠진 열 이름 배열을 돌려준다. */
export function findMissingSalesOrderColumns(headers: string[]): string[] {
  const set = new Set(headers.map((h) => h.replace(/\s*\*\s*/g, "").trim()))
  return SALES_ORDER_EXCEL_REQUIRED_COLUMNS.filter((c) => !set.has(c))
}

/** 행 단위 형식 검증. 기준정보(거래처·품목) 대조는 buildSalesOrderPlan 에서 한다. */
export function parseSalesOrderExcelRows(rows: SalesOrderExcelRawRow[]): {
  parsed: ParsedSalesOrderRow[]
  issues: SalesOrderExcelIssue[]
} {
  const parsed: ParsedSalesOrderRow[] = []
  const issues: SalesOrderExcelIssue[] = []
  const C = SALES_ORDER_EXCEL_COLUMNS

  for (const row of rows) {
    const c = row.cells
    const groupId = cellText(c[C.groupId])
    const pr: ParsedSalesOrderRow = {
      rowNum: row.rowNum,
      groupId,
      customerCode: cellText(c[C.customerCode]),
      orderDate: null,
      deliveryDate: null,
      itemCode: cellText(c[C.itemCode]),
      qty: null,
      unitPrice: null,
      totalAmount: null,
      currency: cellText(c[C.currency]).toUpperCase() || "KRW",
      note: cellText(c[C.note]),
      customerPoNo: cellText(c[C.customerPoNo]),
    }
    const push = (column: string, message: string) =>
      issues.push({ rowNum: row.rowNum, groupId: groupId || null, column, kind: "ERROR", message })

    if (!groupId) push(C.groupId, "수주그룹ID를 입력하세요.")
    else if (groupId.length > TEXT_LIMITS.groupId) push(C.groupId, `수주그룹ID는 ${TEXT_LIMITS.groupId}자 이하여야 합니다.`)

    if (!pr.customerCode) push(C.customerCode, "거래처코드를 입력하세요.")
    else if (pr.customerCode.length > TEXT_LIMITS.code) push(C.customerCode, "거래처코드가 너무 깁니다.")

    if (!pr.itemCode) push(C.itemCode, "품목코드를 입력하세요.")
    else if (pr.itemCode.length > TEXT_LIMITS.code) push(C.itemCode, "품목코드가 너무 깁니다.")

    const orderRaw = c[C.orderDate]
    if (cellText(orderRaw) === "") push(C.orderDate, "수주일을 입력하세요.")
    else {
      pr.orderDate = parseSalesOrderDateCell(orderRaw)
      if (!pr.orderDate) push(C.orderDate, "수주일 형식이 올바르지 않습니다. (예: 2026-11-12)")
    }

    const deliveryRaw = c[C.deliveryDate]
    if (cellText(deliveryRaw) === "") push(C.deliveryDate, "납기일을 입력하세요.")
    else {
      pr.deliveryDate = parseSalesOrderDateCell(deliveryRaw)
      if (!pr.deliveryDate) push(C.deliveryDate, "납기일 형식이 올바르지 않습니다. (예: 2026-11-30)")
    }

    const qty = parseSalesOrderNumberCell(c[C.qty])
    if (qty === null) push(C.qty, "수주수량을 입력하세요.")
    else if (!Number.isFinite(qty)) push(C.qty, "수주수량은 숫자로 입력하세요.")
    else if (qty <= 0) push(C.qty, "수주 수량은 0보다 커야 합니다.")
    else if (Math.round(qty * 1e6) !== qty * 1e6) push(C.qty, "수주수량은 소수점 6자리까지 입력할 수 있습니다.")
    else pr.qty = qty

    const unitPrice = parseSalesOrderNumberCell(c[C.unitPrice])
    if (unitPrice !== null) {
      if (!Number.isFinite(unitPrice)) push(C.unitPrice, "단가는 숫자로 입력하세요.")
      else if (unitPrice < 0) push(C.unitPrice, "단가는 0 이상이어야 합니다.")
      else pr.unitPrice = unitPrice
    }

    const total = parseSalesOrderNumberCell(c[C.totalAmount])
    if (total !== null) {
      if (!Number.isFinite(total)) push(C.totalAmount, "총금액은 숫자로 입력하세요.")
      else if (total <= 0) push(C.totalAmount, "총금액은 0보다 커야 합니다.")
      else pr.totalAmount = total
    }

    if (!SALES_ORDER_EXCEL_CURRENCIES.includes(pr.currency as (typeof SALES_ORDER_EXCEL_CURRENCIES)[number])) {
      push(C.currency, `통화는 ${SALES_ORDER_EXCEL_CURRENCIES.join(", ")} 중에서 입력하세요.`)
    }
    if (pr.note.length > TEXT_LIMITS.note) push(C.note, `비고는 ${TEXT_LIMITS.note}자 이하여야 합니다.`)
    if (pr.customerPoNo.length > TEXT_LIMITS.customerPoNo) push(C.customerPoNo, `거래처 발주번호는 ${TEXT_LIMITS.customerPoNo}자 이하여야 합니다.`)

    parsed.push(pr)
  }
  return { parsed, issues }
}

// ─── 2단계: 수주 단위 계획 (기준정보 대조 · 단가 계산 · 중복 의심) ────────────

/** 수주 내용 지문: 같은 거래처·수주일·납기일·품목·수량이면 같은 지문이다. */
export function salesOrderFingerprint(input: {
  customerId: string
  orderDate: string
  deliveryDate: string
  lines: { itemId: string; qty: number }[]
}): string {
  const lines = [...input.lines]
    .map((l) => `${l.itemId}:${l.qty}`)
    .sort()
    .join(",")
  return `${input.customerId}|${input.orderDate}|${input.deliveryDate}|${lines}`
}

/**
 * 파싱된 행을 수주 단위로 묶어 기준정보와 대조하고 금액을 계산한다.
 * 행에 형식 오류가 있는 수주는 단가 계산·중복 검사를 건너뛴다(오류 원인부터 고치도록).
 */
export function buildSalesOrderPlan(
  parsed: ParsedSalesOrderRow[],
  parseIssues: SalesOrderExcelIssue[],
  ctx: SalesOrderExcelContext,
  /** 사용자가 중복 의심을 확인하고 그대로 등록하기로 한 수주그룹ID */
  confirmedGroupIds: string[] = [],
): SalesOrderExcelPlan {
  const C = SALES_ORDER_EXCEL_COLUMNS
  const issues: SalesOrderExcelIssue[] = [...parseIssues]
  const customerByCode = new Map(ctx.customers.map((c) => [c.code, c]))
  const itemByCode = new Map(ctx.items.map((i) => [i.code, i]))
  const rowErrorNums = new Set(parseIssues.map((i) => i.rowNum))

  // 수주그룹ID 별로 묶기 (그룹ID 가 없는 행은 형식 오류로 이미 걸렸으므로 묶지 않는다)
  const byGroup = new Map<string, ParsedSalesOrderRow[]>()
  for (const r of parsed) {
    if (!r.groupId) continue
    const list = byGroup.get(r.groupId) ?? []
    list.push(r)
    byGroup.set(r.groupId, list)
  }

  const groups: SalesOrderPlanGroup[] = []

  for (const [groupId, rows] of Array.from(byGroup.entries())) {
    const first = rows[0]
    const rowNums = rows.map((r) => r.rowNum)
    const groupIssues: SalesOrderExcelIssue[] = []
    const push = (rowNum: number, column: string, message: string, kind: "ERROR" = "ERROR") =>
      groupIssues.push({ rowNum, groupId, column, kind, message })

    // (a) 공통정보 일치: 같은 수주그룹ID 안에서 거래처·일자·통화·총금액·비고·발주번호가 서로 달라서는 안 된다.
    const commonFields: [keyof ParsedSalesOrderRow, string][] = [
      ["customerCode", C.customerCode],
      ["orderDate", C.orderDate],
      ["deliveryDate", C.deliveryDate],
      ["currency", C.currency],
      ["totalAmount", C.totalAmount],
      ["note", C.note],
      ["customerPoNo", C.customerPoNo],
    ]
    for (const [field, column] of commonFields) {
      const base = first[field]
      for (const r of rows.slice(1)) {
        const v = r[field]
        // 빈 값은 "미입력"으로 보고, 둘 다 값이 있는데 다르면 불일치로 본다. 필수 항목의 빈 값은 행 오류가 이미 잡는다.
        if (v === null || v === "" || base === null || base === "") continue
        if (v !== base) {
          push(r.rowNum, column, `같은 수주그룹ID(${groupId}) 안에서 ${column}이(가) 첫 행과 다릅니다.`)
        }
      }
    }

    // (b) 거래처 존재·사용 가능·고객사 여부 (수주 단위 — 첫 행에 표시)
    const customer = customerByCode.get(first.customerCode)
    if (first.customerCode && !customer) {
      push(first.rowNum, C.customerCode, `등록되지 않은 거래처코드입니다: ${first.customerCode}`)
    } else if (customer && customer.status !== "ACTIVE") {
      push(first.rowNum, C.customerCode, `사용 중지된 거래처입니다: ${customer.code}`)
    } else if (customer && customer.partnerType === "SUPPLIER") {
      push(first.rowNum, C.customerCode, `고객사로 등록되지 않은 거래처입니다: ${customer.code}`)
    }

    // (c) 품목별: 존재·등록 가능 여부, 같은 수주 내 중복
    const seenItems = new Set<string>()
    const lineRows: { row: ParsedSalesOrderRow; item: SalesOrderExcelItemRef }[] = []
    for (const r of rows) {
      if (!r.itemCode) continue
      const item = itemByCode.get(r.itemCode)
      if (!item) {
        push(r.rowNum, C.itemCode, `등록되지 않은 품목코드입니다: ${r.itemCode}`)
        continue
      }
      if (item.status !== "ACTIVE" || item.itemType !== "FINISHED") {
        push(r.rowNum, C.itemCode, `수주 등록 가능한 품목이 아닙니다(사용 중인 완제품만 가능): ${r.itemCode}`)
        continue
      }
      if (seenItems.has(item.id)) {
        push(r.rowNum, C.itemCode, "동일 수주에 같은 품목이 중복되었습니다. 수량을 합산하지 말고 한 행으로 정리하세요.")
        continue
      }
      seenItems.add(item.id)
      lineRows.push({ row: r, item })
    }

    // (d) 금액·단가 계산 — 형식 오류가 없는 수주만 계산한다
    const groupHasRowError = rows.some((r) => rowErrorNums.has(r.rowNum)) || groupIssues.length > 0
    const lines: SalesOrderPlanLine[] = []
    const total = first.totalAmount

    if (!groupHasRowError) {
      const unitRows: (UnitPriceRow & { rowNum: number })[] = lineRows.map(({ row }) => ({
        rowNum: row.rowNum,
        qty: row.qty ?? undefined,
        unitPrice: row.unitPrice ?? undefined,
        manual: row.unitPrice !== null,
      }))
      const autoCount = unitRows.filter((r) => !r.manual).length
      let calculatedRowNum: number | null = null

      if (total !== null && unitRows.length > 0) {
        // autoCount === 0 (모든 단가가 엑셀에 있음): 계산 없이 아래 합계 비교만 한다
        if (autoCount === 1 && unitRows.length === 1) {
          // 단일 품목: 총금액 ÷ 수량
          const r = unitRows[0]
          const calc = deriveAutoUnitPrice(total, [{ qty: r.qty, unitPrice: undefined, manual: false }])
          if (!calc) push(r.rowNum, C.totalAmount, "총금액으로 단가를 계산할 수 없습니다. 수량을 확인하세요.")
          else {
            r.unitPrice = calc.unitPrice
            calculatedRowNum = r.rowNum
          }
        } else if (autoCount === 1) {
          // 다중 품목: 다른 품목 금액이 모두 확정된 경우에만 잔여 금액으로 계산
          const calc = deriveAutoUnitPrice(total, unitRows.map((r) => ({ qty: r.qty, unitPrice: r.unitPrice, manual: r.manual })))
          if (!calc) {
            push(first.rowNum, C.totalAmount, "확정된 품목 금액 합계가 총금액을 초과합니다. 단가 또는 총금액을 확인하세요.")
          } else {
            const target = unitRows[calc.rowIndex]
            target.unitPrice = calc.unitPrice
            calculatedRowNum = target.rowNum
          }
        } else if (autoCount > 1) {
          push(first.rowNum, C.totalAmount, "여러 품목에 총금액을 임의로 나눌 수 없습니다. 단가가 빈 품목이 하나만 남도록 단가를 입력하세요.")
        }

        if (!groupIssues.some((i) => i.column === C.totalAmount)) {
          const m = getAmountMismatch(
            total,
            unitRows.map((r) => ({ qty: r.qty, unitPrice: r.unitPrice, manual: r.rowNum !== calculatedRowNum })),
            first.currency,
          )
          if (m && !m.roundingOnly) {
            push(first.rowNum, C.totalAmount, `총금액(${Math.round(total).toLocaleString("ko-KR")})과 품목 금액 합계(${Math.round(m.lineSum).toLocaleString("ko-KR")})가 일치하지 않습니다.`)
          }
        }
      }

      for (const { row, item } of lineRows) {
        const ur = unitRows.find((u) => u.rowNum === row.rowNum)
        const unitPrice = ur?.unitPrice ?? null
        const source: SalesOrderPlanLine["unitPriceSource"] = unitPrice === null ? "NONE" : row.unitPrice !== null ? "INPUT" : "CALCULATED"
        lines.push({
          rowNum: row.rowNum,
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          qty: row.qty ?? 0,
          unitPrice,
          unitPriceSource: source,
          lineAmount: unitPrice === null || row.qty === null ? null : Math.round(row.qty * unitPrice * 100) / 100,
        })
      }
    } else {
      for (const { row, item } of lineRows) {
        lines.push({
          rowNum: row.rowNum, itemId: item.id, itemCode: item.code, itemName: item.name,
          qty: row.qty ?? 0, unitPrice: row.unitPrice, unitPriceSource: row.unitPrice === null ? "NONE" : "INPUT", lineAmount: null,
        })
      }
    }

    const group: SalesOrderPlanGroup = {
      groupId,
      firstRowNum: first.rowNum,
      rowNums,
      customerId: customer?.id ?? null,
      customerCode: first.customerCode,
      customerName: customer?.name ?? "",
      orderDate: first.orderDate,
      deliveryDate: first.deliveryDate,
      currency: first.currency,
      totalAmount: total,
      note: first.note,
      customerPoNo: first.customerPoNo,
      lines,
      hasIssue: false,
    }
    issues.push(...groupIssues)
    groups.push(group)
  }

  // (e) 중복 의심 — 차단이 아니라 "사용자 확인 필요". 정상적인 반복 발주는 확인 후 등록할 수 있다.
  //  - 거래처 발주번호가 있으면: 같은 거래처 + 같은 발주번호(대소문자 무시)인 기존 수주(취소 제외)만 본다. 발주번호가 다르면 내용이 같아도 반복 발주로 보고 통과시킨다.
  //  - 발주번호가 없으면: 거래처·수주일·납기일·품목·수량이 모두 같은 기존 수주를 "중복 가능성"으로 안내한다.
  //  - 같은 파일 안에서도 같은 기준으로 서로 비교한다.
  const confirmed = new Set(confirmedGroupIds)
  const duplicates: SalesOrderDuplicateSuspect[] = []
  const activeExisting = ctx.existingOrders.filter((o) => o.status !== "CANCELLED")
  const filePo = new Map<string, string>()
  const fileFp = new Map<string, string>()
  for (const g of groups) {
    const hasError = issues.some((i) => i.groupId === g.groupId)
    if (hasError || !g.customerId || !g.orderDate || !g.deliveryDate || g.lines.length === 0) continue
    const poKey = salesOrderPoKey(g.customerPoNo)
    const push = (basis: SalesOrderDuplicateSuspect["basis"], message: string, existing: SalesOrderExcelExistingOrder | null) =>
      duplicates.push({ groupId: g.groupId, rowNum: g.firstRowNum, basis, message, existing, confirmed: confirmed.has(g.groupId) })

    if (poKey) {
      const hit = activeExisting.find((o) => o.customerId === g.customerId && salesOrderPoKey(o.customerPoNo) === poKey)
      const fileKey = `${g.customerId}|${poKey}`
      if (hit) {
        push("PO_NO", `같은 거래처의 발주번호 ${g.customerPoNo}로 이미 등록된 수주 ${hit.orderNo}가 있습니다. 분할 납품·추가 수주가 아니라면 중복 등록입니다.`, hit)
      } else if (filePo.has(fileKey)) {
        push("FILE_PO_NO", `같은 파일의 수주그룹(${filePo.get(fileKey)})이 같은 거래처·발주번호(${g.customerPoNo})를 쓰고 있습니다.`, null)
      } else {
        filePo.set(fileKey, g.groupId)
      }
      continue
    }

    const fp = salesOrderFingerprint({
      customerId: g.customerId,
      orderDate: g.orderDate,
      deliveryDate: g.deliveryDate,
      lines: g.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    })
    const hit = activeExisting.find(
      (o) => salesOrderFingerprint({ customerId: o.customerId, orderDate: o.orderDate, deliveryDate: o.deliveryDate, lines: o.items }) === fp,
    )
    if (hit) {
      push("CONTENT", `발주번호가 없는 수주입니다. 기존 수주 ${hit.orderNo}와 거래처·수주일·납기일·품목·수량이 동일하여 중복 등록일 수 있습니다.`, hit)
    } else if (fileFp.has(fp)) {
      push("FILE_CONTENT", `발주번호가 없고, 같은 파일의 수주그룹(${fileFp.get(fp)})과 내용이 동일합니다.`, null)
    } else {
      fileFp.set(fp, g.groupId)
    }
  }

  const dupGroupIds = new Set(duplicates.map((d) => d.groupId))
  for (const g of groups) {
    g.hasIssue = issues.some((i) => i.groupId === g.groupId) || dupGroupIds.has(g.groupId)
  }

  issues.sort((a, b) => a.rowNum - b.rowNum)
  const issueRowNums = new Set(issues.map((i) => i.rowNum))
  const totalRows = parsed.length
  const unconfirmedDuplicateGroupIds = duplicates.filter((d) => !d.confirmed).map((d) => d.groupId)

  return {
    totalRows,
    groups,
    issues,
    duplicates,
    unconfirmedDuplicateGroupIds,
    summary: {
      totalRows,
      orderCount: groups.length,
      itemCount: groups.reduce((s, g) => s + g.lines.length, 0),
      validRows: Math.max(0, totalRows - issueRowNums.size),
      errorRows: issueRowNums.size,
      duplicateGroupCount: duplicates.length,
    },
    canImport: issues.length === 0 && groups.length > 0 && parsed.length > 0 && unconfirmedDuplicateGroupIds.length === 0,
  }
}

/** 오류·중복 의심 내역을 다운로드용 2차원 배열로 만든다. 수식 주입을 막기 위해 = + - @ 로 시작하는 텍스트는 ' 를 붙인다. */
export function salesOrderIssueRows(issues: SalesOrderExcelIssue[], duplicates: SalesOrderDuplicateSuspect[] = []): string[][] {
  const safe = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v)
  return [
    ...issues.map((i) => [String(i.rowNum), safe(i.groupId ?? ""), "오류", safe(i.column), safe(`${i.rowNum}행: ${i.message}`)]),
    ...duplicates.map((d) => [String(d.rowNum), safe(d.groupId), "중복 의심", "수주그룹ID", safe(`${d.rowNum}행: ${d.message}`)]),
  ]
}
