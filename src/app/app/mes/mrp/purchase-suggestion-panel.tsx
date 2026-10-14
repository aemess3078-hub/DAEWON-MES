"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Loader2, Save, ShoppingCart } from "lucide-react"
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
import { saveOrderMrpRun } from "@/lib/actions/mrp-run.actions"
import { describeTermsViolation, validateQtyAgainstTerms } from "@/lib/mrp/purchase-policy"
import {
  AUTO_SUGGEST_KINDS,
  deriveCoverageForSupplier,
  deriveForSupplier,
  type PurchaseSuggestionLine,
} from "@/lib/mrp/purchase-suggestion"
import type { DraftPoCreated } from "@/lib/services/mrp-purchase-draft.service"
import type { PurchaseSuggestionPayload } from "@/lib/services/mrp-purchase-suggestion.service"
import { parseQty, PurchaseSuggestionTable, type SuggestionRowEdit } from "./purchase-suggestion-table"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

/** 요청 단위 멱등 키: 같은 동작(더블클릭/재시도)은 같은 키를 쓰고, 새 동작은 새 키를 쓴다 */
function newRequestKey(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    if (c && typeof c.randomUUID === "function") return c.randomUUID()
  } catch {
    // fallthrough
  }
  return "rk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)
}

type Props = {
  params: { from: string | null; to: string | null; includeDraft: boolean }
  /** 상위 MRP 가 다시 계산될 때 함께 재조회하기 위한 키 */
  refreshKey: string
}

type GroupPreview = {
  supplierId: string
  supplierName: string
  lines: Array<{
    row: PurchaseSuggestionLine
    qty: number
    requiredDate: string
    orderByDate: string | null
    timing: "OK" | "DUE_TODAY" | "OVERDUE" | "LEAD_TIME_MISSING" | "NO_TARGET_DATE"
    overdueDays: number
  }>
  defaultDate: string | null
  /** 같은 통화 단가가 모두 있을 때의 예상금액(통화별 구분) — 구매조건(MOQ/배수) 적용 후 수량 기준 */
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
  const [createdReplayed, setCreatedReplayed] = useState(false)
  const [onlyFinal, setOnlyFinal] = useState(false)
  // Phase 6: 실행 저장 / 중복 방지 / 멱등
  const [savedRun, setSavedRun] = useState<{ id: string; createdAt: string; replayed: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 같은 계산 결과에 대한 저장 요청은 같은 키 → 더블클릭/재전송이 Snapshot 을 중복 생성하지 않는다
  const saveKeyRef = useRef<string>(newRequestKey())
  // 발주 생성 요청 키: 다이얼로그를 열 때마다 새로 만들고 실패 후 재시도에는 재사용한다
  const createKeyRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getPurchaseSuggestions(params)
      setPayload(res)
      const next: Record<string, SuggestionRowEdit> = {}
      for (const r of res.rows) {
        // Phase 6: 기본 수량은 기존 DRAFT 를 뺀 "추가 DRAFT 제안량"(MRP 제안 suggestedQty 와 다를 수 있다)
        const defaultQty = r.additionalQty ?? r.suggestedQty
        next[r.componentItemId] = {
          selected: false,
          qty: defaultQty > 0 ? String(defaultQty) : "",
          supplierId: r.recommendedSupplierId,
          requiredDate: r.requiredDate ?? "",
        }
      }
      setEdits(next)
      setGroupDates({})
      // 새 계산 결과 → 이전 저장 실행/키는 이 화면의 근거가 아니다
      setSavedRun(null)
      setSaveError(null)
      saveKeyRef.current = newRequestKey()
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
    setEdits((cur) => {
      const prev = cur[id]
      if (!prev) return cur
      const next: SuggestionRowEdit = { ...prev, ...p }
      // 사용자가 수량 칸을 직접 고치면 이후 공급업체를 바꿔도 덮어쓰지 않는다
      if (p.qty !== undefined) next.qtyEdited = true
      if (p.supplierId !== undefined && p.supplierId !== prev.supplierId && !next.qtyEdited) {
        const row = payload?.rows.find((r) => r.componentItemId === id)
        if (row) {
          const supplier = row.suppliers.find((s) => s.supplierId === p.supplierId) ?? null
          if (row.draftCoverageQty !== undefined) {
            // Phase 6: 기존 DRAFT 를 먼저 빼고 남은 필요량에 선택 공급업체의 MOQ/배수를 적용
            const cov = deriveCoverageForSupplier(row, supplier)
            next.qty = cov.additionalQty > 0 ? String(cov.additionalQty) : ""
          } else {
            const derived = deriveForSupplier(row, supplier)
            next.qty = derived.qty > 0 ? String(derived.qty) : ""
          }
        }
      }
      return { ...cur, [id]: next }
    })

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
        const eligible = AUTO_SUGGEST_KINDS.includes(r.kind) && e.supplierId !== null && parseQty(e.qty) !== null
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
    // 구매조건 사전 점검(서버가 최종 재검증한다): 수량 ≥ MOQ, 발주배수의 배수
    const violation = validateQtyAgainstTerms(qty, { moq: supplier.moq, orderMultiple: supplier.orderMultiple })
    if (!violation.ok) {
      blockers.push(`${r.code}(${supplier.supplierName}): ${describeTermsViolation(violation, qty)}`)
      continue
    }
    // Phase 6: 기존 DRAFT 로 충족된(추가 필요량 0) 품목은 확인 + 사유가 있어야만 추가 발주할 수 있다(서버도 같은 기준으로 재검증)
    const needsOverride =
      r.draftCoverageQty !== undefined && deriveCoverageForSupplier(r, supplier).remainingRawNeed <= 0
    if (needsOverride) {
      if (e.override !== true) {
        blockers.push(`${r.code}: 기존 DRAFT 로 이미 충족된 품목입니다. 추가 발주하려면 확인과 사유를 입력해 주세요.`)
        continue
      }
      if (!(e.overrideReason ?? "").trim()) {
        blockers.push(`${r.code}: 추가 발주 사유를 입력해 주세요.`)
        continue
      }
    }
    const derived = deriveForSupplier({ ...r, requiredDate: e.requiredDate || null }, supplier)
    let g = groups.get(supplier.supplierId)
    if (!g) {
      g = { supplierId: supplier.supplierId, supplierName: supplier.supplierName, lines: [], defaultDate: null, amounts: [], mixedCurrency: false, unpricedCount: 0 }
      groups.set(supplier.supplierId, g)
    }
    g.lines.push({
      row: r,
      qty,
      requiredDate: e.requiredDate,
      orderByDate:
        derived.timing.status === "OK" || derived.timing.status === "DUE_TODAY" || derived.timing.status === "OVERDUE"
          ? derived.timing.orderByDate
          : null,
      timing: derived.timing.status,
      overdueDays: derived.timing.status === "OVERDUE" ? derived.timing.overdueDays : 0,
    })
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
  const overdueLines = groupList.flatMap((g) => g.lines.filter((l) => l.timing === "OVERDUE"))
  const maxOverdueDays = overdueLines.reduce((m, l) => Math.max(m, l.overdueDays), 0)
  const leadTimeMissingLines = groupList.flatMap((g) => g.lines.filter((l) => l.timing === "LEAD_TIME_MISSING"))

  async function saveRun() {
    if (!payload || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await saveOrderMrpRun({
        from: params.from,
        to: params.to,
        includeDraft: params.includeDraft,
        requestKey: saveKeyRef.current,
      })
      if (!res.success) {
        setSaveError(res.error)
        if (res.code === "IDEMPOTENCY_KEY_REUSE_MISMATCH") saveKeyRef.current = newRequestKey()
        return
      }
      setSavedRun({ id: res.data.runId, createdAt: res.data.createdAt, replayed: res.data.replayed })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "MRP 실행을 저장하지 못했습니다.")
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!payload || !canCreate || creating) return
    setCreating(true)
    setCreateError(null)
    if (createKeyRef.current === null) createKeyRef.current = newRequestKey()
    try {
      const coverageOverrides: Record<string, string> = {}
      for (const g of groupList) {
        for (const l of g.lines) {
          const e = edits[l.row.componentItemId]
          if (e?.override === true && (e.overrideReason ?? "").trim()) {
            coverageOverrides[l.row.componentItemId] = (e.overrideReason ?? "").trim()
          }
        }
      }
      const res = await createDraftPurchaseOrdersFromMrpSuggestions({
        requestKey: createKeyRef.current,
        // 저장한 실행이 있으면 그 실행에서, 없으면 서버가 생성 시점에 MRP 를 계산해 Snapshot 으로 저장한다
        ...(savedRun ? { runId: savedRun.id } : { mrp: { from: params.from, to: params.to, includeDraft: params.includeDraft } }),
        coverageOverrides,
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
        // 같은 키에 다른 내용이 이미 처리된 경우: 키를 버리고 새로 시작한다(화면 새로고침 후 재시도)
        if (res.code === "IDEMPOTENCY_KEY_REUSE_MISMATCH") createKeyRef.current = null
        return
      }
      setCreated(res.data.orders)
      setCreatedReplayed(res.data.replayed === true)
      createKeyRef.current = null
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
                {o.leadTimeOverdueLineCount > 0 && (
                  <span className="text-red-700"> · 발주 필요일 경과 {o.leadTimeOverdueLineCount}건(납기협의/긴급조달 필요)</span>
                )}
                {o.leadTimeMissingLineCount > 0 && (
                  <span className="text-muted-foreground"> · 리드타임 미등록 {o.leadTimeMissingLineCount}건</span>
                )}
              </li>
            ))}
          </ul>
          <Link href="/app/mes/purchase-orders" className="mt-2 inline-block text-[14px] text-primary underline">
            자재발주현황에서 확인
          </Link>
          <p className="mt-2 text-[13px] text-muted-foreground">
            DRAFT 발주는 아직 입고예정에 반영되지 않습니다. 발주확정(발주완료) 후 MRP 입고예정으로 계산됩니다.
            {createdReplayed && " 같은 요청이 이미 처리되어 중복 생성 없이 처음 결과를 표시했습니다."}
          </p>
        </div>
      )}

      <div className="rounded-xl border bg-muted/20 px-4 py-3 text-[14px] space-y-1">
        <p>
          <strong>제안수량</strong>은 &quot;목표입고일(결품예정일)까지 도착한다는 전제에서 전 기간 결품을 막는 최소 추가 공급량&quot;(최대결품)입니다.
          기존 확정 발주의 입고예정은 이미 반영되어 중복 공급되지 않습니다. 현재 MRP 기준이며 생성 시점의 재고/수주 변동은 자동 반영되지 않습니다.
        </p>
        <p className="text-[13px] text-muted-foreground">
          <strong>안전재고</strong>는 물리 재고를 차감하지 않고 예상 잔량이 유지해야 할 목표 하한으로만 쓰입니다. 제안수량은 선택한 공급업체의
          구매조건(MOQ → 발주배수 올림)을 적용하며, 공급업체를 바꾸면 해당 공급업체의 MOQ·배수·리드타임·단가로 다시 계산됩니다.
          발주 필요일은 목표 입고일에서 리드타임(달력일)을 뺀 값이며 입고예정일(헤더)을 바꾸지 않습니다.
          구매발주는 DRAFT 로만 생성되며 자동 발주확정되지 않습니다. 일시 결품·일시 미달 자재는 새 발주 대신 기존 발주 납기 당김/긴급조달을 먼저 검토하세요.
        </p>
        <p className="text-[13px] text-muted-foreground">
          <strong>기존 DRAFT 발주(미확정)</strong>는 확정 공급이 아니므로 재고·입고예정·예상잔량에 더하지 않고, 중복 발주를 막기 위해 필요량에서만 따로 뺍니다
          (MRP 정책 필요량 − 기존 DRAFT = 추가 DRAFT 필요량, 그 다음 공급업체 MOQ/배수 적용). 기존 DRAFT 로 충족된 품목은 확인과 사유 없이는 추가 발주할 수 없습니다.
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "최종 부족", value: payload.summary.finalShortageCount, tone: payload.summary.finalShortageCount > 0 ? "danger" : "" },
              {
                label: "안전재고 부족",
                value: payload.rows.filter((r) => r.kind === "SAFETY_STOCK_SHORTAGE").length,
                tone: payload.rows.some((r) => r.kind === "SAFETY_STOCK_SHORTAGE") ? "warn" : "",
              },
              {
                label: "일시 결품·미달(검토)",
                value: payload.rows.filter((r) => !AUTO_SUGGEST_KINDS.includes(r.kind)).length,
                tone: payload.rows.some((r) => !AUTO_SUGGEST_KINDS.includes(r.kind)) ? "warn" : "",
              },
              {
                label: "공급업체 미지정·불명확",
                value: payload.summary.noSupplierCount + payload.summary.ambiguousSupplierCount,
                tone: payload.summary.noSupplierCount + payload.summary.ambiguousSupplierCount > 0 ? "warn" : "",
              },
              { label: "발주 필요일 경과", value: payload.policySummary.orderOverdueCount, tone: payload.policySummary.orderOverdueCount > 0 ? "danger" : "" },
              { label: "리드타임 미등록", value: payload.policySummary.leadTimeMissingCount, tone: payload.policySummary.leadTimeMissingCount > 0 ? "warn" : "" },
              {
                label: "기존 DRAFT로 충족",
                value: payload.coverageSummary?.coveredCount ?? 0,
                tone: "",
              },
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
            <Button variant="outline" size="sm" className="gap-1.5 text-[14px]" onClick={() => void saveRun()} disabled={saving || creating}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              MRP 실행 저장
            </Button>
            <span className="ml-auto text-[13px] text-muted-foreground">
              기준일 {payload.baseDate} · 계산 시각 {new Date(payload.calculatedAt).toLocaleString("ko-KR")}
              {payload.site && <> · 공장 {payload.site.name}</>}
            </span>
          </div>

          {saveError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">{saveError}</div>}
          {savedRun && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[14px] text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {savedRun.replayed ? "이미 저장된 실행입니다." : "현재 MRP 결과를 실행이력으로 저장했습니다."} 실행이력 탭에서 저장된 값을 확인할 수 있고,
                이 화면에서 만드는 DRAFT 구매발주는 이 실행에 연결됩니다.
              </p>
            </div>
          )}

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
                createKeyRef.current = newRequestKey()
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
                      <th className="py-1.5 text-right">발주 필요일</th>
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
                        <td className={`py-1.5 text-right ${l.timing === "OVERDUE" ? "text-red-600" : ""}`}>
                          {l.timing === "LEAD_TIME_MISSING"
                            ? "리드타임 미등록"
                            : l.orderByDate
                              ? l.orderByDate + (l.timing === "OVERDUE" ? ` (${fmt(l.overdueDays)}일 경과)` : l.timing === "DUE_TODAY" ? " (오늘)" : "")
                              : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <p className="text-[13px] text-muted-foreground">
            제안수량은 현재 MRP 기준입니다. 생성 시점에 서버가 기존 DRAFT 발주 수량을 다시 확인해 이미 충족된 품목의 중복 발주를 막고,
            이 발주의 근거(MRP 실행 Snapshot)를 실행이력에 함께 저장합니다.
          </p>
          {overdueLines.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                표준 리드타임 기준 발주 필요일이 최대 {fmt(maxOverdueDays)}일 경과한 품목이 {fmt(overdueLines.length)}건 있습니다.
                공급업체 납기협의 또는 긴급조달이 필요합니다. (생성은 가능합니다)
              </p>
            </div>
          )}
          {leadTimeMissingLines.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              리드타임이 등록되지 않은 품목 {fmt(leadTimeMissingLines.length)}건은 발주 필요일을 계산하지 못했습니다(품목관리 &gt; 공급업체 관리에서 등록).
            </p>
          )}
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
