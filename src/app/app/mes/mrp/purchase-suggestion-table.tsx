"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { describeTermsViolation, validateQtyAgainstTerms } from "../../../../lib/mrp/purchase-policy"
import { parseQtyInput, rowCoveredByDraft, validateRowEdit } from "../../../../lib/mrp/purchase-row-validation"
import {
  deriveCoverageForSupplier,
  deriveForSupplier,
  type CoverageFields,
  type PolicyFields,
  type PurchaseSuggestionRow,
} from "../../../../lib/mrp/purchase-suggestion"

/**
 * 발주제안 표 — 수주기준 MRP / 생산계획 MRP 공통.
 *
 * 구조: 고정 레이아웃(table-fixed + colgroup)로 컬럼 폭을 확정하고 한 행은 항상 한 줄 높이를 유지한다.
 *  - 자재명은 말줄임(truncate) + 툴팁(title), 숫자는 우측 정렬(tabular-nums).
 *  - 화면 폭이 부족하면 표 컨테이너가 가로 스크롤한다(컬럼이 찌그러지지 않도록 min-width 고정).
 *  - 안전재고/예상재고/최대결품/MOQ/리드타임/단가 같은 상세는 행 확장 영역에서 보여 준다.
 *  - 선택된 행의 문제(수량/공급업체/구매조건/추가발주 사유)는 해당 행 바로 아래에 한 줄로 표시한다.
 */

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

export type SuggestionRowEdit = {
  selected: boolean
  /** 입력 중인 수량 문자열(검증은 생성 시) */
  qty: string
  supplierId: string | null
  /** YYYY-MM-DD 또는 빈 문자열 */
  requiredDate: string
  /** 사용자가 수량을 직접 고쳤는가(공급업체를 바꿔도 수동 수량은 덮어쓰지 않고 구매조건 위반만 경고한다) */
  qtyEdited?: boolean
  /** (Phase 6) 기존 DRAFT 로 충족된(또는 필요 없는) 품목을 알면서도 추가 발주 — 확인 + 사유 필수 */
  override?: boolean
  overrideReason?: string
}

/** 이 행이 "추가 발주 확인/사유"를 요구하는가 — 서버 검증(정책 필요량 − 기존 DRAFT ≤ 0)과 같은 기준 */
export function rowNeedsOverride(
  row: Pick<PurchaseSuggestionRow, "suppliers"> & Partial<PolicyFields> & Partial<CoverageFields>,
  supplierId: string | null
): boolean {
  if (row.draftCoverageQty === undefined || row.rawSuggestedQty === undefined) return false
  return rowCoveredByDraft(row, supplierId)
}

/** 5C 행 + (있으면) Phase 5D 정책 필드. 정책 필드가 없는 행은 5C 화면 그대로 렌더링된다. */
export type SuggestionTableRow = PurchaseSuggestionRow & Partial<PolicyFields> & Partial<CoverageFields>

function parseDateOrNull(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/** 화면 상태 → 서버 입력 변환 시 사용하는 수량 파싱(양수만 유효) */
export const parseQty = parseQtyInput

const KIND_LABEL: Record<PurchaseSuggestionRow["kind"], string> = {
  FINAL_SHORTAGE: "부족",
  SAFETY_STOCK_SHORTAGE: "안전재고 부족",
  TEMPORARY_SHORTAGE: "일시 결품",
  SAFETY_STOCK_TEMPORARY: "안전재고 일시 미달",
}

const SUPPLIER_NOTE: Record<PurchaseSuggestionRow["supplierReason"], string | null> = {
  DEFAULT: "기본 공급업체",
  LOWEST_PRIORITY: "최우선(priority) 공급업체",
  AMBIGUOUS_PRIORITY: "최우선 공급업체가 불명확합니다. 직접 선택하세요.",
  NONE: "공급업체 미지정 — 품목관리 > 공급업체 관리에서 등록하세요.",
}

type Tone = "danger" | "warn" | "ok" | "muted" | "orange"
const TONE_CLASS: Record<Tone, string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  orange: "border-orange-200 bg-orange-50 text-orange-800",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  muted: "border-border bg-muted/40 text-muted-foreground",
}

/** 행 상태 배지(한 행에 하나 — 나머지 상세는 확장 영역) */
function statusOf(r: SuggestionTableRow, covStatus: string | null, overdue: boolean): { label: string; tone: Tone } {
  const temporary = r.kind === "TEMPORARY_SHORTAGE" || r.kind === "SAFETY_STOCK_TEMPORARY"
  if (r.supplierReason === "NONE") return { label: "공급업체 없음", tone: "warn" }
  if (covStatus === "COVERED" && !temporary) return { label: "DRAFT 충족", tone: "ok" }
  if (covStatus === "PARTIAL" && !temporary) return { label: "DRAFT 일부", tone: "warn" }
  if (temporary) return { label: KIND_LABEL[r.kind], tone: "warn" }
  if (overdue) return { label: "발주일 경과", tone: "danger" }
  if (r.kind === "SAFETY_STOCK_SHORTAGE") return { label: KIND_LABEL[r.kind], tone: "orange" }
  return { label: KIND_LABEL[r.kind], tone: "danger" }
}

/** 컬럼 폭(px). 합계 + 자재 컬럼 최소폭이 표의 최소 너비가 된다. */
const COLS = { check: 44, stock: 92, req: 92, short: 92, qty: 116, supplier: 192, date: 148, status: 124, expand: 44 } as const
const MATERIAL_MIN = 240
const TABLE_MIN_WIDTH = MATERIAL_MIN + Object.values(COLS).reduce((a, b) => a + b, 0)

type Props = {
  rows: SuggestionTableRow[]
  edits: Record<string, SuggestionRowEdit>
  priceVisible: boolean
  disabled?: boolean
  onChange: (componentItemId: string, patch: Partial<SuggestionRowEdit>) => void
  onToggleAll: (selected: boolean) => void
  /** 처음부터 펼쳐 둘 행(테스트/딥링크용) */
  defaultExpandedIds?: readonly string[]
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[14px] tabular-nums">{children}</dd>
    </div>
  )
}

/** 발주제안 표(표시/편집 전용). 서버 호출 없음 — 부모가 상태와 생성 동작을 관리한다. */
export function PurchaseSuggestionTable({ rows, edits, priceVisible, disabled, onChange, onToggleAll, defaultExpandedIds }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds ?? []))
  const selectable = rows.filter((r) => edits[r.componentItemId])
  const allSelected = selectable.length > 0 && selectable.every((r) => edits[r.componentItemId].selected)
  // Phase 5D 정책 필드가 있는 결과일 때만 안전재고/예상재고/발주 필요일 상세를 보여 준다
  const policy = rows.some((r) => r.safetyStock !== undefined)
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-[14px]" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <colgroup>
            <col style={{ width: COLS.check }} />
            <col style={{ minWidth: MATERIAL_MIN }} />
            <col style={{ width: COLS.stock }} />
            <col style={{ width: COLS.req }} />
            <col style={{ width: COLS.short }} />
            <col style={{ width: COLS.qty }} />
            <col style={{ width: COLS.supplier }} />
            <col style={{ width: COLS.date }} />
            <col style={{ width: COLS.status }} />
            <col style={{ width: COLS.expand }} />
          </colgroup>
          <thead>
            <tr className="border-b bg-muted/30 text-[13px] font-semibold text-muted-foreground">
              <th className="px-3 py-3 text-center">
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allSelected}
                  disabled={disabled || selectable.length === 0}
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              </th>
              <th className="px-3 py-3 text-left whitespace-nowrap">자재</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">가용재고</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">소요량</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">부족수량</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">발주수량</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">공급업체</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">입고예정일</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">상태</th>
              <th className="px-2 py-3">
                <span className="sr-only">상세</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = edits[r.componentItemId]
              if (!e) return null
              const supplier = r.suppliers.find((s) => s.supplierId === e.supplierId) ?? null
              const price = supplier?.price ?? null
              const temporary = r.kind === "TEMPORARY_SHORTAGE" || r.kind === "SAFETY_STOCK_TEMPORARY"
              const derived =
                policy && r.rawSuggestedQty !== undefined && r.baseDate !== undefined
                  ? deriveForSupplier(
                      { rawSuggestedQty: r.rawSuggestedQty, baseDate: r.baseDate, requiredDate: parseDateOrNull(e.requiredDate) },
                      supplier
                    )
                  : null
              // Phase 6: DRAFT Coverage(미확정 발주) — 입고예정/재고가 아니라 중복 발주 방지용 별도 표시
              const cov =
                r.draftCoverageQty !== undefined && r.rawSuggestedQty !== undefined
                  ? deriveCoverageForSupplier(
                      {
                        rawSuggestedQty: r.rawSuggestedQty,
                        draftCoverageQty: r.draftCoverageQty,
                        draftCoverageBySupplier: r.draftCoverageBySupplier ?? {},
                      },
                      supplier
                    )
                  : null
              const needsOverride = cov !== null && cov.remainingRawNeed <= 0
              const qtyNumber = parseQty(e.qty)
              const termsWarning =
                policy && supplier && qtyNumber !== null
                  ? (() => {
                      const v = validateQtyAgainstTerms(qtyNumber, { moq: supplier.moq, orderMultiple: supplier.orderMultiple })
                      return v.ok ? null : describeTermsViolation(v, qtyNumber)
                    })()
                  : null
              const overdue = derived?.timing.status === "OVERDUE"
              const status = statusOf(r, cov?.status ?? null, overdue)
              // 선택된 행만 입력 문제를 알린다(선택하지 않은 행은 아직 발주 대상이 아니다)
              const issue = e.selected ? validateRowEdit(r, e) : null
              const showMsg = issue !== null || termsWarning !== null
              const open = expanded.has(r.componentItemId) || (needsOverride && e.selected)
              const shortage = r.finalShortageQty > 0 ? r.finalShortageQty : r.peakShortageQty
              const label = `${r.code} ${r.name}`
              return (
                <RowGroup key={r.componentItemId}>
                  <tr
                    className={`h-[60px] border-b ${showMsg || open ? "border-b-0" : ""} ${
                      e.selected ? "bg-primary/5" : temporary ? "bg-amber-50/30" : ""
                    }`}
                  >
                    <td className="px-3 text-center align-middle">
                      <input
                        type="checkbox"
                        aria-label={`${r.code} 선택`}
                        checked={e.selected}
                        disabled={disabled}
                        onChange={(ev) => onChange(r.componentItemId, { selected: ev.target.checked })}
                      />
                    </td>
                    <td className="px-3 align-middle">
                      <div className="truncate font-medium leading-snug" title={label}>
                        {r.name}
                      </div>
                      <div className="truncate text-[13px] leading-snug text-muted-foreground" title={`${r.code}${r.spec ? ` · ${r.spec}` : ""} · ${r.uom}`}>
                        <span className="font-mono">{r.code}</span>
                        {r.spec ? ` · ${r.spec}` : ""} · {r.uom}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 text-right align-middle tabular-nums">{fmt(r.qtyAvailable)}</td>
                    <td className="whitespace-nowrap px-3 text-right align-middle tabular-nums">{fmt(r.totalRequirement)}</td>
                    <td
                      className={`whitespace-nowrap px-3 text-right align-middle font-semibold tabular-nums ${
                        shortage > 0 ? "text-red-600" : "text-muted-foreground"
                      }`}
                    >
                      {shortage > 0 ? fmt(shortage) : "-"}
                    </td>
                    <td className="px-3 text-right align-middle">
                      <input
                        aria-label={`${r.code} 발주수량`}
                        inputMode="decimal"
                        className="h-9 w-full rounded-md border bg-background px-2 text-right text-[14px] tabular-nums"
                        value={e.qty}
                        disabled={disabled}
                        placeholder={temporary ? "0" : ""}
                        onChange={(ev) => onChange(r.componentItemId, { qty: ev.target.value })}
                      />
                    </td>
                    <td className="px-3 align-middle">
                      <select
                        aria-label={`${r.code} 공급업체`}
                        className="h-9 w-full truncate rounded-md border bg-background px-2 text-[14px]"
                        title={supplier?.supplierName ?? ""}
                        value={e.supplierId ?? ""}
                        disabled={disabled || r.suppliers.length === 0}
                        onChange={(ev) => onChange(r.componentItemId, { supplierId: ev.target.value || null })}
                      >
                        <option value="">{r.suppliers.length === 0 ? "등록된 공급업체 없음" : "공급업체 선택"}</option>
                        {r.suppliers.map((s) => (
                          <option key={s.supplierId} value={s.supplierId}>
                            {s.supplierName}
                            {s.isDefault ? " (기본)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 align-middle">
                      <input
                        type="date"
                        aria-label={`${r.code} 목표입고일`}
                        className="h-9 w-full rounded-md border bg-background px-2 text-[14px]"
                        value={e.requiredDate}
                        disabled={disabled}
                        onChange={(ev) => onChange(r.componentItemId, { requiredDate: ev.target.value })}
                      />
                    </td>
                    <td className="px-3 align-middle">
                      <span
                        className={`inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-medium ${TONE_CLASS[status.tone]}`}
                        title={status.label}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-2 text-center align-middle">
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                        aria-label={`${r.code} 상세 ${open ? "접기" : "보기"}`}
                        aria-expanded={open}
                        onClick={() => toggle(r.componentItemId)}
                      >
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>

                  {showMsg && (
                    <tr className={`border-b ${open ? "border-b-0" : ""} ${e.selected ? "bg-primary/5" : ""}`}>
                      <td />
                      <td colSpan={9} className="px-3 pb-2 text-[13px] text-red-600" role="alert">
                        {issue?.message ?? termsWarning}
                      </td>
                    </tr>
                  )}

                  {open && (
                    <tr className={`border-b ${e.selected ? "bg-primary/5" : "bg-muted/20"}`}>
                      <td />
                      <td colSpan={9} className="px-3 py-3">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                          {policy && <Detail label="안전재고">{(r.safetyStock ?? 0) > 0 ? fmt(r.safetyStock ?? 0) : "-"}</Detail>}
                          {policy && (
                            <Detail label="최저 예상재고">
                              <span className={(r.minProjectedBalance ?? 0) < 0 ? "font-medium text-red-600" : ""}>{fmt(r.minProjectedBalance ?? 0)}</span>
                            </Detail>
                          )}
                          {policy && (
                            <Detail label="최종 예상재고">
                              <span className={(r.finalBalance ?? 0) < 0 ? "font-medium text-red-600" : ""}>{fmt(r.finalBalance ?? 0)}</span>
                            </Detail>
                          )}
                          <Detail label="최대결품">
                            <span className="font-medium text-red-600">{fmt(r.peakShortageQty)}</span>
                          </Detail>
                          <Detail label="입고예정(발주중)">
                            {r.scheduledReceiptQty > 0 ? <span className="text-emerald-700">+{fmt(r.scheduledReceiptQty)}</span> : "-"}
                          </Detail>
                          <Detail label="결품예정일">
                            {r.requiredDate ?? "-"}
                            {r.firstShortageOrderNo && <span className="ml-1 font-mono text-[13px] text-muted-foreground">{r.firstShortageOrderNo}</span>}
                          </Detail>
                          {policy && supplier && (
                            <Detail label="구매조건">
                              {supplier.leadTimeDays === null ? "LT 미등록" : `LT ${fmt(supplier.leadTimeDays)}일`} · MOQ{" "}
                              {supplier.moq === null ? "없음" : fmt(supplier.moq)} · 배수{" "}
                              {supplier.orderMultiple === null ? "없음" : fmt(supplier.orderMultiple)}
                            </Detail>
                          )}
                          <Detail label="단가">
                            {!priceVisible ? (
                              "-"
                            ) : price ? (
                              `${fmt(price.unitPrice)} ${price.currency}`
                            ) : e.supplierId ? (
                              <span className="text-muted-foreground">단가 미등록</span>
                            ) : (
                              "-"
                            )}
                          </Detail>
                          {policy && (
                            <Detail label="발주 필요일">
                              {!derived || derived.timing.status === "NO_TARGET_DATE" ? (
                                "-"
                              ) : derived.timing.status === "LEAD_TIME_MISSING" ? (
                                <span className="text-amber-700">리드타임 미등록</span>
                              ) : derived.timing.status === "OVERDUE" ? (
                                <span className="text-red-600">
                                  {derived.timing.orderByDate} ({fmt(derived.timing.overdueDays)}일 경과)
                                </span>
                              ) : derived.timing.status === "DUE_TODAY" ? (
                                <span className="text-amber-700">{derived.timing.orderByDate} (오늘)</span>
                              ) : (
                                <>
                                  {derived.timing.orderByDate} <span className="text-muted-foreground">(여유 {fmt(derived.timing.daysLeft)}일)</span>
                                </>
                              )}
                            </Detail>
                          )}
                        </dl>

                        <div className="mt-3 space-y-1 text-[13px] text-muted-foreground">
                          {r.supplierReason !== "DEFAULT" && SUPPLIER_NOTE[r.supplierReason] && (!e.supplierId || r.supplierReason === "NONE" || r.supplierReason === "AMBIGUOUS_PRIORITY") && (
                            <div className="text-amber-700">{SUPPLIER_NOTE[r.supplierReason]}</div>
                          )}
                          {SUPPLIER_NOTE[r.supplierReason] && e.supplierId === r.recommendedSupplierId && r.supplierReason !== "NONE" && (
                            <div>{SUPPLIER_NOTE[r.supplierReason]}</div>
                          )}
                          {!temporary && r.peakShortageQty > r.finalShortageQty && (
                            <div>최대결품 기준 발주(최종부족 {fmt(r.finalShortageQty)})</div>
                          )}
                          {temporary && (
                            <div>
                              납기 당김 / 긴급조달 검토{r.shortageRecoveredAt && <> · {r.shortageRecoveredAt} 입고로 해소</>} · 기본 발주수량 0
                            </div>
                          )}
                          {cov && !temporary && (r.rawSuggestedQty ?? 0) > 0 ? (
                            <div>
                              MRP 정책 필요량 {fmt(r.rawSuggestedQty ?? 0)}
                              {cov.status !== "NONE" && (
                                <>
                                  {" "}
                                  / 기존 DRAFT(미확정) {fmt(r.draftCoverageQty ?? 0)} / 추가 DRAFT 필요 {fmt(cov.remainingRawNeed)}
                                </>
                              )}
                              {cov.remainingRawNeed > 0 && cov.moqApplied && <> → MOQ {fmt(cov.qtyAfterMoq)}</>}
                              {cov.remainingRawNeed > 0 && cov.multipleApplied && <> → 배수 올림 {fmt(cov.additionalQty)}</>}
                              {cov.status !== "NONE" && <span> · DRAFT 는 입고예정/재고가 아닙니다.</span>}
                            </div>
                          ) : (
                            derived &&
                            !temporary &&
                            (r.rawSuggestedQty ?? 0) > 0 && (
                              <div>
                                정책 필요량 {fmt(r.rawSuggestedQty ?? 0)}
                                {derived.moqApplied && <> → MOQ {fmt(derived.qtyAfterMoq)}</>}
                                {derived.multipleApplied && <> → 배수 올림 {fmt(derived.qty)}</>}
                              </div>
                            )
                          )}
                          {cov && cov.status === "COVERED" && !temporary && (
                            <div className="text-emerald-700">기존 DRAFT 발주로 필요량 충족 · 추가 발주 0</div>
                          )}
                          {r.draftOpenQty > 0 && (
                            <div className="text-amber-700">
                              DRAFT 발주 {fmt(r.draftOpenQty)}
                              {r.uom} 존재(미확정 · 입고예정 미반영)
                              {r.draftOrders && r.draftOrders.length > 0 && (
                                <span className="text-muted-foreground"> · {r.draftOrders.map((o) => o.orderNo).join(", ")}</span>
                              )}
                            </div>
                          )}
                          {cov && cov.otherSupplierDraftQty > 0 && e.supplierId && (
                            <div className="text-amber-700">다른 공급업체 DRAFT {fmt(cov.otherSupplierDraftQty)} 존재</div>
                          )}
                          {derived?.termsInvalid && <div className="text-red-600">구매조건 데이터 오류</div>}
                        </div>

                        {needsOverride && e.selected && (
                          <div className="mt-3 max-w-xl rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
                            <label className="flex cursor-pointer items-start gap-2 text-[13px] text-amber-900">
                              <input
                                type="checkbox"
                                aria-label={`${r.code} 추가 발주 확인`}
                                className="mt-0.5"
                                checked={e.override === true}
                                disabled={disabled}
                                onChange={(ev) => onChange(r.componentItemId, { override: ev.target.checked })}
                              />
                              <span>기존 DRAFT 로 이미 충족되었음을 알고 있으며 추가 발주합니다.</span>
                            </label>
                            <input
                              type="text"
                              aria-label={`${r.code} 추가 발주 사유`}
                              maxLength={200}
                              placeholder="추가 발주 사유(필수)"
                              className="mt-1.5 h-9 w-full rounded-md border bg-background px-2 text-[14px]"
                              value={e.overrideReason ?? ""}
                              disabled={disabled || e.override !== true}
                              onChange={(ev) => onChange(r.componentItemId, { overrideReason: ev.target.value })}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </RowGroup>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
