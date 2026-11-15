/**
 * 수주 처리 화면 — LOT 분할 출하 행 검증(순수 함수, 서버/DOM 비의존).
 *
 * 한 수주 품목에 LOT 행을 여러 개 두고 LOT별 출하 수량을 정한다.
 * - 입력 합계(total): 사용자가 입력한 모든 행의 수량 합. 잘못된 행도 포함한다.
 * - 출하요청 수량(validTotal): 오류 없는 행의 수량 합. 모든 행이 유효할 때만 실제 등록 수량과 같다.
 * - 빈 행(LOT 미선택)은 "미완성"이고, 값이 잘못된 행과 수량 한도 초과는 "오류"다.
 * 서버 createShipment 는 같은 한도를 트랜잭션 안에서 다시 검사한다(이 모듈은 화면용 사전 검사).
 */

export type SalesOrderLotRow = { lotId: string; qty: number }

export type SalesOrderLotOption = {
  lotId: string
  lotNo: string
  /** LOT 예약 가능 수량(기존 출하예정 예약 차감 후) */
  qtyAvailable: number
}

export type SalesOrderLotLineCheck = {
  /** 행별 문구(정상 행은 null). 빈 행은 "LOT를 선택하세요." 를 담지만 화면은 입력 뒤/제출 시도 뒤에만 보여 준다. */
  rowErrors: (string | null)[]
  /** LOT 를 고르지 않은 행 */
  rowEmpty: boolean[]
  /** 입력 합계: 모든 행 수량의 합(잘못된 행 포함) */
  total: number
  /** 출하요청 수량: 오류 없는 행의 수량 합 */
  validTotal: number
  /** 추가 출하 가능 수량 한도 */
  limit: number
  /** 미완성(빈 행이 있거나 행이 없음). 제출 시 입력 완료를 요구한다. */
  incomplete: boolean
  /** 잘못된 값이 있음(행 오류 또는 합계 한도 초과). 제출 버튼을 비활성화한다. */
  invalid: boolean
  /** 품목 단위 사유(미완성·오류 공통). 없으면 null */
  error: string | null
}

/** 한 품목의 LOT 행을 검증한다. uom 은 사유 문구에 붙일 단위다. */
export function checkSalesOrderLotLine(input: {
  rows: SalesOrderLotRow[]
  lots: SalesOrderLotOption[]
  limit: number
  uom: string
  formatQty?: (value: number) => string
}): SalesOrderLotLineCheck {
  const format = input.formatQty ?? ((value: number) => String(value))
  const { rows, lots, limit, uom } = input
  let total = 0
  let validTotal = 0
  let hasRowError = false

  const rowEmpty = rows.map((row) => !row.lotId)
  const rowErrors = rows.map((row, index) => {
    const qty = Number.isFinite(row.qty) ? row.qty : 0
    total += qty
    const lot = lots.find((l) => l.lotId === row.lotId)
    if (!row.lotId || !lot) {
      return "LOT를 선택하세요."
    }
    if (rows.some((other, otherIndex) => otherIndex < index && other.lotId === row.lotId)) {
      hasRowError = true
      return "동일한 LOT를 중복 선택할 수 없습니다."
    }
    if (!(qty > 0)) {
      hasRowError = true
      return "출하 수량은 0보다 커야 합니다."
    }
    if (qty > lot.qtyAvailable) {
      hasRowError = true
      return `LOT 예약 가능 수량(${format(lot.qtyAvailable)} ${uom})을 초과했습니다.`
    }
    validTotal += qty
    return null
  })

  const incomplete = rows.length === 0 || rowEmpty.some(Boolean)
  const overLimit = total > limit
  const invalid = hasRowError || overLimit

  let error: string | null = null
  // 잘못된 값이 미완성보다 먼저 보이도록 한다(행 자체 문구는 행마다 따로 표시된다)
  if (rows.length === 0) error = "LOT를 1개 이상 추가하세요."
  else if (hasRowError) error = "LOT 행의 입력 오류를 수정하세요."
  else if (overLimit) error = `추가 출하 가능 수량(${format(limit)} ${uom})을 초과했습니다.`
  else if (incomplete) error = "LOT를 선택하세요."

  return { rowErrors, rowEmpty, total, validTotal, limit, incomplete, invalid, error }
}

/** LOT 선택 시 자동으로 채울 수량: LOT 예약 가능 수량과 다른 행을 뺀 남은 한도 중 작은 값 */
export function suggestLotQty(input: {
  lotQtyAvailable: number
  limit: number
  otherRowsQty: number
}): number {
  const left = Math.max(0, input.limit - input.otherRowsQty)
  return Math.max(0, Math.min(input.lotQtyAvailable, left))
}
