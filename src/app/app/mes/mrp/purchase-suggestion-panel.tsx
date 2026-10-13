"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Loader2, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createDraftPurchaseOrdersFromMrpSuggestions,
  getPurchaseSuggestions,
} from "@/lib/actions/mrp-purchase-suggestion.actions"
import type { PurchaseSuggestionRow } from "@/lib/mrp/purchase-suggestion"
import type { DraftPoCreated } from "@/lib/services/mrp-purchase-draft.service"
import type { PurchaseSuggestionPayload } from "@/lib/services/mrp-purchase-suggestion.service"
import { parseQty, PurchaseSuggestionTable, type SuggestionRowEdit } from "./purchase-suggestion-table"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

type Props = {
  params: { from: string | null; to: string | null; includeDraft: boolean }
  /** 상위 MRP 가 다시 계산될 때 함께 재조회하기 위한 키 */
  refreshKey: string
}

type GroupPreview = {
  supplierId: string
  supplierName: string
  lines: Array<{ row: PurchaseSuggestionRow; qty: number; requiredDate: string }>
  defaultDate: string | null
  /** 같은 통화 단가가 모두 있을 때의 예상금액(통화별 구분) */
  amounts: Array<{ currency: string; amount: number }>
  mixedCurrency: boolean
  unpricedCount: number
}

export function PurchaseSuggestionPanel({ params, refreshKey }: Props) {
  const [payload, setPayload] = useState<PurchaseSuggestionPayload | null>(null)
  const [edits, setEdits] = useState<Record<string, SuggestionRowEdit>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [groupDates, setGroupDates] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<DraftPoCreated[] | null>(null)
  const [onlyFinal, setOnlyFinal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getPurchaseSuggestions(params)
      setPayload(res)
      const next: Record<string, SuggestionRowEdit> = {}
      for (const r of res.rows) {
        next[r.componentItemId] = {
          selected: false,
          qty: r.suggestedQty > 0 ? String(r.suggestedQty) : "",
          supplierId: r.recommendedSupplierId,
          requiredDate: r.requiredDate ?? "",
        }
      }
      setEdits(next)
      setGroupDates({})
    } catch (e) {
      setPayload(null)
      setError(e instanceof Error ? e.message : "발주제안을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.from, params.to, params.includeDraft, refreshKey])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () => (payload ? payload.rows.filter((r) => !onlyFinal || r.kind === "FINAL_SHORTAGE") : []),
    [payload, onlyFinal]
  )

  const patch = (id: string, p: Partial<SuggestionRowEdit>) =>
    setEdits((cur) => ({ ...cur, [id]: { ...cur[id], ...p } }))

  const toggleAll = (selected: boolean) =>
    setEdits((cur) => {
      const next = { ...cur }
      for (const r of rows) next[r.componentItemId] = { ...next[r.componentItemId], selected }
      return next
    })

  const selectRecommended = () =>
    setEdits((cur) => {
      const next = { ...cur }
      for (const r of payload?.rows ?? []) {
        const e = next[r.componentItemId]
        const eligible = r.kind === "FINAL_SHORTAGE" && e.supplierId !== null && parseQty(e.qty) !== null
        next[r.componentItemId] = { ...e, selected: eligible }
      }
      return next
    })

  // ── 선택 검증 / 공급업체 그룹 미리보기 ──
  const selectedRows = (payload?.rows ?? []).filter((r) => edits[r.componentItemId]?.selected)
  const blockers: string[] = []
  const groups = new Map<string, GroupPreview>()
  for (const r of selectedRows) {
    const e = edits[r.componentItemId]
    const qty = parseQty(e.qty)
    if (qty === null) {
      blockers.push(`${r.code}: 제안수량은 0보다 커야 합니다.`)
      continue
    }
    if (!e.supplierId) {
      blockers.push(`${r.code}: 공급업체를 선택해 주세요.`)
      continue
    }
    const supplier = r.suppliers.find((s) => s.supplierId === e.supplierId)
    if (!supplier) {
      blockers.push(`${r.code}: 선택한 공급업체가 이 품목에 등록되어 있지 않습니다.`)
      continue
    }
    let g = groups.get(supplier.supplierId)
    if (!g) {
      g = { supplierId: supplier.supplierId, supplierName: supplier.supplierName, lines: [], defaultDate: null, amounts: [], mixedCurrency: false, unpricedCount: 0 }
      groups.set(supplier.supplierId, g)
    }
    g.lines.push({ row: r, qty, requiredDate: e.requiredDate })
    if (e.requiredDate && (g.defaultDate === null || e.requiredDate < g.defaultDate)) g.defaultDate = e.requiredDate
    if (supplier.price) {
      const existing = g.amounts.find((a) => a.currency === supplier.price!.currency)
      if (existing) existing.amount += qty * supplier.price.unitPrice
      else g.amounts.push({ currency: supplier.price.currency, amount: qty * supplier.price.unitPrice })
    } else {
      g.unpricedCount += 1
    }
  }
  groups.forEach((g) => {
    g.mixedCurrency = g.amounts.length > 1
  })
  const groupList = Array.from(groups.values()).sort((a, b) => (a.supplierName < b.supplierName ? -1 : 1))
  const effectiveDate = (g: GroupPreview) => groupDates[g.supplierId] ?? g.defaultDate ?? ""
  const dateMissing = groupList.some((g) => !effectiveDate(g))
  const mixed = groupList.some((g) => g.mixedCurrency)
  const canCreate = selectedRows.length > 0 && blockers.length === 0 && !dateMissing && !mixed && payload?.site != null

  async function submit() {
    if (!payload || !canCreate) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await createDraftPurchaseOrdersFromMrpSuggestions({
        lines: groupList.flatMap((g) =>
          g.lines.map((l) => ({
            itemId: l.row.componentItemId,
            supplierId: g.supplierId,
            qty: l.qty,
            requiredDate: l.requiredDate || null,
          }))
        ),
        groupExpectedDates: Object.fromEntries(groupList.map((g) => [g.supplierId, effectiveDate(g)])),
        siteId: payload.site?.id ?? null,
      })
      if (!res.success) {
        setCreateError(res.error)
        return
      }
      setCreated(res.data.orders)
      setDialogOpen(false)
      await load()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "발주 생성 중 오류가 발생했습니다.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      {created && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex items-center gap-2 text-[15px] font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            구매발주 {created.length}건을 DRAFT 상태로 생성했습니다. 확인 후 발주확정해 주세요.
          </div>
          <ul className="mt-2 space-y-1 text-[14px]">
            {created.map((o) => (
              <li key={o.orderNo}>
                <span className="font-mono text-[13px]">{o.orderNo}</span> · {o.supplierName} · {o.itemCount}품목 · 입고예정{" "}
                {o.expectedDate}
                {o.unpricedCount > 0 && <span className="text-amber-700"> · 단가 미등록 {o.unpricedCount}건(0으로 저장됨)</span>}
              </li>
            ))}
          </ul>
          <Link href="/app/mes/purchase-orders" className="mt-2 inline-block text-[14px] text-primary underline">
            자재발주현황에서 확인
          </Link>
          <p className="mt-2 text-[13px] text-muted-foreground">
            DRAFT 발주는 아직 입고예정에 반영되지 않습니다. 발주확정(발주완료) 후 MRP 입고예정으로 계산됩니다.
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-muted/20 px-4 py-3 text-[14px] space-y-1">
        <p>
          <strong>제안수량</strong>은 &quot;목표입고일(결품예정일)까지 도착한다는 전제에서 전 기간 결품을 막는 최소 추가 공급량&quot;(최대결품)입니다.
          기존 확정 발주의 입고예정은 이미 반영되어 중복 공급되지 않습니다. 현재 MRP 기준이며 생성 시점의 재고/수주 변동은 자동 반영되지 않습니다.
        </p>
        <p className="text-[13px] text-muted-foreground">
          MOQ·발주배수·안전재고·리드타임은 아직 적용하지 않습니다. 구매발주는 DRAFT 로만 생성되며 자동 발주확정되지 않습니다.
          일시 결품 자재는 새 발주 대신 기존 발주 납기 당김/긴급조달을 먼저 검토하세요.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{error}</div>}

      {loading && !payload && (
        <div className="flex items-center justify-center gap-2 rounded-xl border py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          발주제안 계산 중...
        </div>
      )}

      {payload && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: "최종 부족", value: payload.summary.finalShortageCount, tone: payload.summary.finalShortageCount > 0 ? "danger" : "" },
              { label: "일시 결품(검토)", value: payload.summary.temporaryShortageCount, tone: payload.summary.temporaryShortageCount > 0 ? "warn" : "" },
              { label: "공급업체 미지정", value: payload.summary.noSupplierCount, tone: payload.summary.noSupplierCount > 0 ? "warn" : "" },
              { label: "공급업체 불명확", value: payload.summary.ambiguousSupplierCount, tone: payload.summary.ambiguousSupplierCount > 0 ? "warn" : "" },
              { label: "선택", value: selectedRows.length, tone: "" },
            ].map((k) => (
              <div
                key={k.label}
                className={`rounded-xl border p-4 ${k.tone === "danger" ? "bg-red-50/60 border-red-200" : k.tone === "warn" ? "bg-amber-50/60 border-amber-200" : "bg-muted/30"}`}
              >
                <p className="text-[13px] text-muted-foreground">{k.label}</p>
                <p className={`text-[28px] font-bold leading-tight ${k.tone === "danger" ? "text-red-600" : k.tone === "warn" ? "text-amber-600" : ""}`}>
                  {fmt(k.value)}
                </p>
              </div>
            ))}
          </div>

          {payload.overdueReceiptCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-[14px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                입고예정일이 지난 미입고 발주 {fmt(payload.overdueReceiptCount)}건은 입고예정에 반영되지 않았습니다. 해당 발주의 입고예정일을 수정하거나
                잔량을 종결한 뒤 다시 확인하면 제안 수량이 달라질 수 있습니다.
              </p>
            </div>
          )}

          {!payload.site && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
              등록된 공장(사이트)이 없어 구매발주를 생성할 수 없습니다.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[14px]">
              <input type="checkbox" checked={onlyFinal} onChange={(e) => setOnlyFinal(e.target.checked)} />
              최종 부족만 보기
            </label>
            <Button variant="outline" size="sm" className="text-[14px]" onClick={selectRecommended} disabled={creating}>
              공급업체가 정해진 최종 부족 모두 선택
            </Button>
            <Button variant="ghost" size="sm" className="text-[14px]" onClick={() => toggleAll(false)} disabled={creating}>
              선택 해제
            </Button>
            <span className="ml-auto text-[13px] text-muted-foreground">
              기준일 {payload.baseDate} · 계산 시각 {new Date(payload.calculatedAt).toLocaleString("ko-KR")}
              {payload.site && <> · 공장 {payload.site.name}</>}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border py-12 text-center text-muted-foreground">
              <p className="text-[15px]">구매 제안이 필요한 자재가 없습니다.</p>
              <p className="mt-1 text-[13px]">예정입고를 반영해도 결품이 발생하는 자재가 없습니다.</p>
            </div>
          ) : (
            <PurchaseSuggestionTable
              rows={rows}
              edits={edits}
              priceVisible={payload.priceVisible}
              disabled={creating}
              onChange={patch}
              onToggleAll={toggleAll}
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setCreateError(null)
                setDialogOpen(true)
              }}
              disabled={selectedRows.length === 0 || creating}
              className="gap-2"
            >
              <ShoppingCart className="h-4 w-4" />
              선택 항목 구매발주(DRAFT) 생성
            </Button>
            {blockers.length > 0 && <span className="text-[13px] text-amber-700">{blockers[0]}{blockers.length > 1 && ` 외 ${blockers.length - 1}건`}</span>}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => !creating && setDialogOpen(v)}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle className="text-[18px]">구매발주(DRAFT) 생성 확인</DialogTitle>
            <DialogDescription className="text-[14px]">
              공급업체별로 구매발주 1건씩 생성합니다. 구매발주는 DRAFT 상태로 생성되며 자동 발주확정되지 않습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[420px] space-y-4 overflow-y-auto">
            {groupList.map((g) => (
              <div key={g.supplierId} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[15px] font-semibold">{g.supplierName}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {g.lines.length}품목 ·{" "}
                    {g.mixedCurrency ? (
                      <span className="text-red-600">통화가 섞여 있어 생성할 수 없습니다</span>
                    ) : g.amounts.length === 1 ? (
                      <>
                        예상금액 {fmt(g.amounts[0].amount)} {g.amounts[0].currency}
                        {g.unpricedCount > 0 && ` + 단가 미등록 ${g.unpricedCount}건`}
                      </>
                    ) : (
                      <>단가 미등록 {g.unpricedCount}건</>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
                  <label htmlFor={"gd-" + g.supplierId}>입고예정일(헤더)</label>
                  <input
                    id={"gd-" + g.supplierId}
                    type="date"
                    className="h-9 rounded-md border bg-background px-2 text-[14px]"
                    value={effectiveDate(g)}
                    onChange={(e) => setGroupDates((cur) => ({ ...cur, [g.supplierId]: e.target.value }))}
                  />
                  <span className="text-[13px] text-muted-foreground">
                    기본값은 선택 품목 중 가장 빠른 목표입고일(보수적)이며, 발주서는 헤더 날짜 1개만 지원합니다.
                  </span>
                </div>
                <table className="mt-2 w-full border-collapse text-[14px]">
                  <thead>
                    <tr className="border-b text-left text-[13px] text-muted-foreground">
                      <th className="py-1.5">품목</th>
                      <th className="py-1.5 text-right">수량</th>
                      <th className="py-1.5 text-right">목표입고일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.row.componentItemId} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className="font-mono text-[13px]">{l.row.code}</span> {l.row.name}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {fmt(l.qty)}
                          {l.row.uom}
                        </td>
                        <td className="py-1.5 text-right">{l.requiredDate || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <p className="text-[13px] text-muted-foreground">
            제안수량은 현재 MRP 기준이며, 생성 시점의 재고/수주 변동은 자동 반영되지 않습니다. 같은 부족에 대해 다시 생성하면 중복 발주될 수 있으니
            DRAFT 발주 존재 여부를 확인하세요.
          </p>
          {dateMissing && <p className="text-[14px] text-destructive">입고예정일을 입력하지 않은 공급업체가 있습니다.</p>}
          {createError && <p className="text-[14px] text-destructive">{createError}</p>}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              취소
            </Button>
            <Button onClick={submit} disabled={!canCreate || creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              DRAFT 발주 {groupList.length}건 생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
