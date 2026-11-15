/**
 * 발주제안 한 행의 화면 입력 사전 검증 (순수 모듈 — 수주기준/생산계획 MRP 가 같은 규칙을 쓴다)
 *
 * 서버(mrp-purchase-draft.service)가 모든 규칙을 다시 검증한다. 여기는 사용자가 생성 버튼을 누르기 전에
 * 해당 자재 행에 "무엇이 막혀 있는지"를 짧게 알려 주기 위한 것이며 우회 수단이 아니다.
 */

import { describeTermsViolation, validateQtyAgainstTerms } from "./purchase-policy"
import { deriveCoverageForSupplier, type PurchaseSuggestionLine } from "./purchase-suggestion"

export type RowEditInput = {
  qty: string
  supplierId: string | null
  override?: boolean
  overrideReason?: string
}

export type RowIssueCode = "QTY" | "SUPPLIER" | "SUPPLIER_INVALID" | "TERMS" | "OVERRIDE_CONFIRM" | "OVERRIDE_REASON"

export type RowIssue = { code: RowIssueCode; message: string }

/** 수량 파싱(양수만 유효, 천단위 콤마 허용) */
export function parseQtyInput(raw: string): number | null {
  const t = raw.trim().replaceAll(",", "")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 기존 DRAFT 로 필요량이 이미 충족된 행인가(서버: 정책 필요량 − 기존 DRAFT ≤ 0) */
export type ValidatableRow = Pick<PurchaseSuggestionLine, "suppliers"> &
  Partial<Pick<PurchaseSuggestionLine, "draftCoverageQty" | "draftCoverageBySupplier" | "rawSuggestedQty">>

export function rowCoveredByDraft(row: ValidatableRow, supplierId: string | null): boolean {
  // DRAFT Coverage 정보가 없는 행(구 5C 결과)은 중복 판정 대상이 아니다
  if (row.draftCoverageQty === undefined || row.rawSuggestedQty === undefined) return false
  const supplier = row.suppliers.find((s) => s.supplierId === supplierId) ?? null
  return (
    deriveCoverageForSupplier(
      { rawSuggestedQty: row.rawSuggestedQty, draftCoverageQty: row.draftCoverageQty, draftCoverageBySupplier: row.draftCoverageBySupplier ?? {} },
      supplier
    ).remainingRawNeed <= 0
  )
}

/** 선택된 행의 첫 번째 문제. 문제가 없으면 null */
export function validateRowEdit(row: ValidatableRow, edit: RowEditInput): RowIssue | null {
  const covered = rowCoveredByDraft(row, edit.supplierId)
  // 기존 DRAFT 로 이미 충족된 자재는 수량/공급업체 입력보다 먼저 "추가 발주 확인"을 요구한다(가장 중요한 사유를 먼저 알린다)
  if (covered && edit.override !== true) {
    return { code: "OVERRIDE_CONFIRM", message: "기존 DRAFT 발주로 이미 충족됨 — 추가 발주하려면 확인이 필요합니다." }
  }
  const qty = parseQtyInput(edit.qty)
  if (qty === null) return { code: "QTY", message: "발주수량을 0보다 크게 입력하세요." }
  if (!edit.supplierId) return { code: "SUPPLIER", message: "공급업체를 선택하세요." }
  const supplier = row.suppliers.find((s) => s.supplierId === edit.supplierId)
  if (!supplier) return { code: "SUPPLIER_INVALID", message: "이 자재에 등록되지 않은 공급업체입니다." }
  const violation = validateQtyAgainstTerms(qty, { moq: supplier.moq, orderMultiple: supplier.orderMultiple })
  if (!violation.ok) return { code: "TERMS", message: describeTermsViolation(violation, qty) }
  if (covered && !(edit.overrideReason ?? "").trim()) return { code: "OVERRIDE_REASON", message: "추가 발주 사유를 입력하세요." }
  return null
}
