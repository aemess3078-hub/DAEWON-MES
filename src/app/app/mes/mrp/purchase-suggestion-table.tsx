"use client"

import type { PurchaseSuggestionRow } from "@/lib/mrp/purchase-suggestion"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

export type SuggestionRowEdit = {
  selected: boolean
  /** 입력 중인 수량 문자열(검증은 생성 시) */
  qty: string
  supplierId: string | null
  /** YYYY-MM-DD 또는 빈 문자열 */
  requiredDate: string
}

/** 화면 상태 → 서버 입력 변환 시 사용하는 수량 파싱(양수만 유효) */
export function parseQty(raw: string): number | null {
  const t = raw.trim().replaceAll(",", "")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

const SUPPLIER_NOTE: Record<PurchaseSuggestionRow["supplierReason"], string | null> = {
  DEFAULT: "기본 공급업체",
  LOWEST_PRIORITY: "최우선(priority) 공급업체",
  AMBIGUOUS_PRIORITY: "최우선 공급업체가 불명확합니다. 직접 선택하세요.",
  NONE: "공급업체 미지정 — 품목관리 > 공급업체 관리에서 등록하세요.",
}

type Props = {
  rows: PurchaseSuggestionRow[]
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
              <th className="px-3 py-3 text-right whitespace-nowrap">총수요</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">입고예정</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">최대결품</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">최종부족</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">결품예정일</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">공급업체</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">단가</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">제안수량</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">목표입고일</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = edits[r.componentItemId]
              if (!e) return null
              const supplier = r.suppliers.find((s) => s.supplierId === e.supplierId) ?? null
              const price = supplier?.price ?? null
              const temporary = r.kind === "TEMPORARY_SHORTAGE"
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
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{r.uom}</td>
                  <td className="px-3 py-3 text-right">{fmt(r.qtyAvailable)}</td>
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
                  <td className="px-3 py-3 whitespace-nowrap">
                    {temporary ? (
                      <div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">
                          일시 결품
                        </span>
                        <div className="mt-1 text-[13px] text-muted-foreground">
                          납기 당김 / 긴급조달 검토
                          {r.shortageRecoveredAt && <> · {r.shortageRecoveredAt} 입고로 해소</>}
                        </div>
                      </div>
                    ) : (
                      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[13px] text-red-700">
                        최종 부족
                      </span>
                    )}
                    {r.supplierReason === "NONE" && (
                      <div className="mt-1">
                        <span className="rounded-full border px-2 py-0.5 text-[13px] text-muted-foreground">공급업체 미지정</span>
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
