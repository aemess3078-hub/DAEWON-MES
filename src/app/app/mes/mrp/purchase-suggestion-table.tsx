"use client"

import { describeTermsViolation, validateQtyAgainstTerms } from "../../../../lib/mrp/purchase-policy"
import {
  deriveCoverageForSupplier,
  deriveForSupplier,
  type CoverageFields,
  type PolicyFields,
  type PurchaseSuggestionRow,
} from "../../../../lib/mrp/purchase-suggestion"

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
  const supplier = row.suppliers.find((s) => s.supplierId === supplierId) ?? null
  return (
    deriveCoverageForSupplier(
      { rawSuggestedQty: row.rawSuggestedQty, draftCoverageQty: row.draftCoverageQty, draftCoverageBySupplier: row.draftCoverageBySupplier ?? {} },
      supplier
    ).remainingRawNeed <= 0
  )
}

/** 5C 행 + (있으면) Phase 5D 정책 필드. 정책 필드가 없는 행은 5C 화면 그대로 렌더링된다. */
export type SuggestionTableRow = PurchaseSuggestionRow & Partial<PolicyFields> & Partial<CoverageFields>

function parseDateOrNull(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function parseQtyLocal(raw: string): number | null {
  const t = raw.trim().replaceAll(",", "")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 화면 상태 → 서버 입력 변환 시 사용하는 수량 파싱(양수만 유효) */
export function parseQty(raw: string): number | null {
  const t = raw.trim().replaceAll(",", "")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

const KIND_LABEL: Record<PurchaseSuggestionRow["kind"], string> = {
  FINAL_SHORTAGE: "최종 부족",
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

type Props = {
  rows: SuggestionTableRow[]
  edits: Record<string, SuggestionRowEdit>
  priceVisible: boolean
  disabled?: boolean
  onChange: (componentItemId: string, patch: Partial<SuggestionRowEdit>) => void
  onToggleAll: (selected: boolean) => void
}

/** 발주제안 표(표시/편집 전용). 서버 호출 없음 — 부모가 상태와 생성 동작을 관리한다. */
export function PurchaseSuggestionTable({ rows, edits, priceVisible, disabled, onChange, onToggleAll }: Props) {
  const selectable = rows.filter((r) => edits[r.componentItemId])
  const allSelected = selectable.length > 0 && selectable.every((r) => edits[r.componentItemId].selected)
  // Phase 5D 정책 필드가 있는 결과일 때만 안전재고/최저·최종 예상/발주 필요일 컬럼을 보여 준다
  const policy = rows.some((r) => r.safetyStock !== undefined)

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b text-[13px] font-semibold text-muted-foreground">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allSelected}
                  disabled={disabled || selectable.length === 0}
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              </th>
              <th className="px-3 py-3 text-left whitespace-nowrap">자재코드</th>
              <th className="px-3 py-3 text-left">자재명</th>
              <th className="px-3 py-3 text-left">단위</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">가용재고</th>
              {policy && <th className="px-3 py-3 text-right whitespace-nowrap">안전재고</th>}
              {policy && <th className="px-3 py-3 text-right whitespace-nowrap">최저 예상</th>}
              {policy && <th className="px-3 py-3 text-right whitespace-nowrap">최종 예상</th>}
              <th className="px-3 py-3 text-right whitespace-nowrap">총수요</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">입고예정</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">최대결품</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">최종부족</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">결품예정일</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">공급업체</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">단가</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">제안수량</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">목표입고일</th>
              {policy && <th className="px-3 py-3 text-left whitespace-nowrap">발주 필요일</th>}
              <th className="px-3 py-3 text-left whitespace-nowrap">상태</th>
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
              const qtyNumber = parseQtyLocal(e.qty)
              const termsWarning =
                policy && supplier && qtyNumber !== null
                  ? (() => {
                      const v = validateQtyAgainstTerms(qtyNumber, { moq: supplier.moq, orderMultiple: supplier.orderMultiple })
                      return v.ok ? null : describeTermsViolation(v, qtyNumber)
                    })()
                  : null
              return (
                <tr
                  key={r.componentItemId}
                  className={`border-b align-top ${e.selected ? "bg-primary/5" : temporary ? "bg-amber-50/30" : ""}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`${r.code} 선택`}
                      checked={e.selected}
                      disabled={disabled}
                      onChange={(ev) => onChange(r.componentItemId, { selected: ev.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-3 font-mono text-[13px] whitespace-nowrap">{r.code}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{r.name}</div>
                    {r.spec && <div className="text-[13px] text-muted-foreground">{r.spec}</div>}
                    {r.draftOpenQty > 0 && (
                      <div className="text-[13px] text-amber-700">
                        DRAFT 발주 {fmt(r.draftOpenQty)}
                        {r.uom} 존재(미확정 · 입고예정 미반영)
                        {r.draftOrders && r.draftOrders.length > 0 && (
                          <span className="text-muted-foreground"> · {r.draftOrders.map((o) => o.orderNo).join(", ")}</span>
                        )}
                      </div>
                    )}
                    {cov && cov.otherSupplierDraftQty > 0 && e.supplierId && (
                      <div className="text-[13px] text-amber-700">다른 공급업체 DRAFT {fmt(cov.otherSupplierDraftQty)} 존재</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{r.uom}</td>
                  <td className="px-3 py-3 text-right">{fmt(r.qtyAvailable)}</td>
                  {policy && (
                    <td className="px-3 py-3 text-right">
                      {(r.safetyStock ?? 0) > 0 ? fmt(r.safetyStock ?? 0) : <span className="text-muted-foreground">-</span>}
                    </td>
                  )}
                  {policy && (
                    <td className={`px-3 py-3 text-right ${(r.minProjectedBalance ?? 0) < 0 ? "text-red-600 font-medium" : ""}`}>
                      {fmt(r.minProjectedBalance ?? 0)}
                    </td>
                  )}
                  {policy && (
                    <td className={`px-3 py-3 text-right ${(r.finalBalance ?? 0) < 0 ? "text-red-600 font-medium" : ""}`}>
                      {fmt(r.finalBalance ?? 0)}
                    </td>
                  )}
                  <td className="px-3 py-3 text-right">{fmt(r.totalRequirement)}</td>
                  <td className="px-3 py-3 text-right">
                    {r.scheduledReceiptQty > 0 ? (
                      <span className="text-emerald-700">+{fmt(r.scheduledReceiptQty)}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-red-600 font-medium">{fmt(r.peakShortageQty)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${r.finalShortageQty > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                    {r.finalShortageQty > 0 ? fmt(r.finalShortageQty) : "-"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {r.requiredDate ?? <span className="text-muted-foreground">-</span>}
                    {r.firstShortageOrderNo && (
                      <div className="font-mono text-[13px] text-muted-foreground">{r.firstShortageOrderNo}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 min-w-[200px]">
                    <select
                      aria-label={`${r.code} 공급업체`}
                      className="h-9 w-full rounded-md border bg-background px-2 text-[14px]"
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
                    {SUPPLIER_NOTE[r.supplierReason] && e.supplierId === r.recommendedSupplierId && r.supplierReason !== "NONE" ? (
                      <div className="mt-1 text-[13px] text-muted-foreground">{SUPPLIER_NOTE[r.supplierReason]}</div>
                    ) : null}
                    {(r.supplierReason === "NONE" || (r.supplierReason === "AMBIGUOUS_PRIORITY" && !e.supplierId)) && (
                      <div className="mt-1 text-[13px] text-amber-700">{SUPPLIER_NOTE[r.supplierReason]}</div>
                    )}
                    {policy && supplier && (
                      <div className="mt-1 text-[13px] text-muted-foreground">
                        {supplier.leadTimeDays === null ? "리드타임 미등록" : `LT ${fmt(supplier.leadTimeDays)}일`} · MOQ{" "}
                        {supplier.moq === null ? "없음" : fmt(supplier.moq)} · 배수{" "}
                        {supplier.orderMultiple === null ? "없음" : fmt(supplier.orderMultiple)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {!priceVisible ? (
                      <span className="text-muted-foreground">-</span>
                    ) : price ? (
                      <span>
                        {fmt(price.unitPrice)} {price.currency}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{e.supplierId ? "단가 미등록" : "-"}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <input
                      aria-label={`${r.code} 제안수량`}
                      inputMode="decimal"
                      className="h-9 w-[110px] rounded-md border bg-background px-2 text-right text-[14px]"
                      value={e.qty}
                      disabled={disabled}
                      placeholder={temporary ? "0" : ""}
                      onChange={(ev) => onChange(r.componentItemId, { qty: ev.target.value })}
                    />
                    {temporary && (
                      <div className="mt-1 text-[13px] text-muted-foreground">기본 0 (필요 시 직접 입력)</div>
                    )}
                    {!temporary && r.peakShortageQty > r.finalShortageQty && (
                      <div className="mt-1 text-[13px] text-muted-foreground">
                        최대결품 기준(최종부족 {fmt(r.finalShortageQty)})
                      </div>
                    )}
                    {cov && !temporary && (r.rawSuggestedQty ?? 0) > 0 ? (
                      <div className="mt-1 text-[13px] text-muted-foreground">
                        MRP 정책 필요량 {fmt(r.rawSuggestedQty ?? 0)}
                        {cov.status !== "NONE" && (
                          <>
                            {" "}
                            / 기존 DRAFT(미확정) {fmt(r.draftCoverageQty ?? 0)} / 추가 DRAFT 필요 {fmt(cov.remainingRawNeed)}
                          </>
                        )}
                        {cov.remainingRawNeed > 0 && cov.moqApplied && <> → MOQ {fmt(cov.qtyAfterMoq)}</>}
                        {cov.remainingRawNeed > 0 && cov.multipleApplied && <> → 배수 올림 {fmt(cov.additionalQty)}</>}
                        {cov.status !== "NONE" && <div>DRAFT 는 입고예정/재고가 아닙니다.</div>}
                      </div>
                    ) : (
                      derived &&
                      !temporary &&
                      (r.rawSuggestedQty ?? 0) > 0 && (
                        <div className="mt-1 text-[13px] text-muted-foreground">
                          정책 필요량 {fmt(r.rawSuggestedQty ?? 0)}
                          {derived.moqApplied && <> → MOQ {fmt(derived.qtyAfterMoq)}</>}
                          {derived.multipleApplied && <> → 배수 올림 {fmt(derived.qty)}</>}
                        </div>
                      )
                    )}
                    {cov && cov.status === "COVERED" && !temporary && (
                      <div className="mt-1 text-[13px] text-emerald-700">기존 DRAFT 발주로 제안량 충족 · 추가 발주 0</div>
                    )}
                    {needsOverride && e.selected && (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2">
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
                    {derived?.termsInvalid && <div className="mt-1 text-[13px] text-red-600">구매조건 데이터 오류</div>}
                    {termsWarning && <div className="mt-1 text-[13px] text-red-600">{termsWarning}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="date"
                      aria-label={`${r.code} 목표입고일`}
                      className="h-9 w-[150px] rounded-md border bg-background px-2 text-[14px]"
                      value={e.requiredDate}
                      disabled={disabled}
                      onChange={(ev) => onChange(r.componentItemId, { requiredDate: ev.target.value })}
                    />
                  </td>
                  {policy && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      {!derived || derived.timing.status === "NO_TARGET_DATE" ? (
                        <span className="text-muted-foreground">-</span>
                      ) : derived.timing.status === "LEAD_TIME_MISSING" ? (
                        <span className="text-amber-700">리드타임 미등록</span>
                      ) : derived.timing.status === "OVERDUE" ? (
                        <div>
                          {derived.timing.orderByDate}
                          <div className="text-[13px] text-red-600">
                            발주 필요일 {fmt(derived.timing.overdueDays)}일 경과 · 긴급조달/납기협의
                          </div>
                        </div>
                      ) : derived.timing.status === "DUE_TODAY" ? (
                        <div>
                          {derived.timing.orderByDate}
                          <div className="text-[13px] text-amber-700">오늘 발주 필요</div>
                        </div>
                      ) : (
                        <div>
                          {derived.timing.orderByDate}
                          <div className="text-[13px] text-muted-foreground">여유 {fmt(derived.timing.daysLeft)}일</div>
                        </div>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-3 whitespace-nowrap">
                    {temporary ? (
                      <div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">
                          {KIND_LABEL[r.kind]}
                        </span>
                        <div className="mt-1 text-[13px] text-muted-foreground">
                          납기 당김 / 긴급조달 검토
                          {r.shortageRecoveredAt && <> · {r.shortageRecoveredAt} 입고로 해소</>}
                        </div>
                      </div>
                    ) : r.kind === "SAFETY_STOCK_SHORTAGE" ? (
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[13px] text-orange-800">
                        {KIND_LABEL[r.kind]}
                      </span>
                    ) : (
                      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[13px] text-red-700">
                        {KIND_LABEL[r.kind]}
                      </span>
                    )}
                    {derived?.timing.status === "OVERDUE" && !temporary && (
                      <div className="mt-1">
                        <span className="rounded-full border border-red-200 px-2 py-0.5 text-[13px] text-red-700">발주 필요일 경과</span>
                      </div>
                    )}
                    {derived?.timing.status === "LEAD_TIME_MISSING" && !temporary && e.supplierId && (
                      <div className="mt-1">
                        <span className="rounded-full border px-2 py-0.5 text-[13px] text-muted-foreground">리드타임 미등록</span>
                      </div>
                    )}
                    {r.supplierReason === "NONE" && (
                      <div className="mt-1">
                        <span className="rounded-full border px-2 py-0.5 text-[13px] text-muted-foreground">공급업체 미지정</span>
                      </div>
                    )}
                    {cov && cov.status === "COVERED" && !temporary && (
                      <div className="mt-1">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[13px] text-emerald-800">
                          기존 DRAFT 충족
                        </span>
                      </div>
                    )}
                    {cov && cov.status === "PARTIAL" && !temporary && (
                      <div className="mt-1">
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">
                          기존 DRAFT 일부 충족
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
