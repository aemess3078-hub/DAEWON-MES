"use client"

import { Fragment, useEffect, useMemo, useState, useTransition } from "react"
import { AlertTriangle, Calculator, ChevronDown, ChevronRight, ClipboardList, PackageX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { runOrderBasedMrp } from "@/lib/actions/mrp-order.actions"
import type { OrderMrpPayload } from "@/lib/services/mrp-order.service"
import type { OrderMrpMaterialView } from "@/lib/mrp/order-mrp-adapter"
import {
  isDateOnly,
  selectionFromRange,
  selectionLabel,
  selectionRange,
  toDateOnly,
  type PeriodSelection,
} from "@/lib/mrp/period"
import type { DateOnly } from "@/lib/mrp/types"
import { PeriodRequirementTable } from "./period-requirement-table"
import { PeriodSelector } from "./period-selector"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

const TABLE_HEADERS: Array<{ label: string; align?: "right" }> = [
  { label: "자재코드" },
  { label: "자재명" },
  { label: "규격" },
  { label: "단위" },
  { label: "현재고", align: "right" },
  { label: "예약재고", align: "right" },
  { label: "가용재고", align: "right" },
  { label: "총 소요량", align: "right" },
  { label: "최종 예상재고", align: "right" },
  { label: "부족수량", align: "right" },
  { label: "최초 결품일" },
  { label: "부족 유발 PO" },
  { label: "결품 수주", align: "right" },
]

type Kpi = { label: string; value: string; hint: string; tone?: "danger" | "warn" }
type ViewMode = "shortage" | "requirement"

export function OrderMrpPanel() {
  const [selection, setSelection] = useState<PeriodSelection>({ mode: "ALL" })
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [today, setToday] = useState<DateOnly | null>(null)
  const [includeDraft, setIncludeDraft] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("shortage")
  const [payload, setPayload] = useState<OrderMrpPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [query, setQuery] = useState("")
  const [poQuery, setPoQuery] = useState("")
  const [shortageOnly, setShortageOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showBomIssues, setShowBomIssues] = useState(false)
  const [showWarnings, setShowWarnings] = useState(false)

  /** 조회 실행. 상태 업데이트가 비동기이므로 실행 대상 기간/옵션을 인자로 받는다. */
  const run = (range: { from: string | null; to: string | null }, draft: boolean, mode: ViewMode) => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await runOrderBasedMrp({ from: range.from, to: range.to, includeDraft: draft })
        setPayload(result)
        setExpanded(null)
        // 새로고침/공유를 위해 현재 조건을 URL 에 반영(라우터 상태는 건드리지 않는다)
        const q = new URLSearchParams()
        if (range.from) q.set("from", range.from)
        if (range.to) q.set("to", range.to)
        if (draft) q.set("draft", "1")
        if (mode !== "shortage") q.set("view", mode)
        const qs = q.toString()
        window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""))
      } catch (e) {
        setPayload(null)
        setError(e instanceof Error ? e.message : "MRP 계산에 실패했습니다.")
      }
    })
  }

  // 마운트: 오늘(KST) 설정 + URL 조건 복원(있으면 즉시 조회)
  useEffect(() => {
    setToday(toDateOnly(new Date()))
    const q = new URLSearchParams(window.location.search)
    const qf = q.get("from")
    const qt = q.get("to")
    const f = qf && isDateOnly(qf) ? qf : null
    const t = qt && isDateOnly(qt) ? qt : null
    const draft = q.get("draft") === "1"
    const mode: ViewMode = q.get("view") === "requirement" ? "requirement" : "shortage"
    setViewMode(mode)
    setIncludeDraft(draft)
    if (f || t) {
      setSelection(selectionFromRange(f, t))
      setFrom(f ?? "")
      setTo(t ?? "")
      run({ from: f, to: t }, draft, mode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 프리셋 / 이전·다음 이동 / 전체: 선택 즉시 조회 (Excel 의 년·월·분기·반기 ▲▼ 과 동일한 즉시 재계산)
  const handleSelect = (next: PeriodSelection) => {
    const r = selectionRange(next)
    setSelection(next)
    setFrom(r.from ?? "")
    setTo(r.to ?? "")
    run(r, includeDraft, viewMode)
  }

  // 날짜 직접 입력: 상태만 갱신, "조회 / MRP 실행"으로 실행
  const handleCustomChange = (f: string, t: string) => {
    setFrom(f)
    setTo(t)
    setSelection({ mode: "CUSTOM", from: f || null, to: t || null })
  }

  const handleRun = () => {
    const f = from || null
    const t = to || null
    if (f && t && f > t) {
      setError("납기 시작일이 종료일보다 늦습니다.")
      return
    }
    setSelection(selectionFromRange(f, t))
    run({ from: f, to: t }, includeDraft, viewMode)
  }

  const changeView = (mode: ViewMode) => {
    setViewMode(mode)
    setExpanded(null)
    if (payload) {
      const q = new URLSearchParams(window.location.search)
      if (mode === "shortage") q.delete("view")
      else q.set("view", mode)
      const qs = q.toString()
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""))
    }
  }

  const view = payload?.view ?? null
  const periodActive = Boolean(view && (view.params.from || view.params.to))

  const rows = useMemo(() => {
    if (!view) return []
    const q = query.trim().toLowerCase()
    const po = poQuery.trim().toLowerCase()
    return view.materials.filter((m) => {
      if (shortageOnly && !(m.shortageQty > 0)) return false
      if (q && !(m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))) return false
      if (po && !m.steps.some((s) => s.orderNo.toLowerCase().includes(po))) return false
      return true
    })
  }, [view, query, poQuery, shortageOnly])

  const periodText = view
    ? view.params.from || view.params.to
      ? selectionLabel(selectionFromRange(view.params.from, view.params.to))
      : "전체 미출하"
    : ""

  const kpis: Kpi[] = view
    ? viewMode === "shortage"
      ? [
          { label: "대상 수주라인", value: fmt(view.kpi.demandLineCount), hint: "미출하 잔량이 있어 계산에 포함된 수주 라인" },
          { label: "필요 자재", value: fmt(view.kpi.requiredMaterialCount), hint: "BOM 전개 결과 소요량이 있는 자재 종류" },
          {
            label: "부족 자재",
            value: fmt(view.kpi.shortageMaterialCount),
            hint: "최종 예상재고가 0 미만인 자재",
            tone: view.kpi.shortageMaterialCount > 0 ? "danger" : undefined,
          },
          {
            label: "결품 발생 수주",
            value: fmt(view.kpi.shortageDemandCount),
            hint: "납기순 차감 중 1개 이상 자재가 부족해지는 수주 라인",
            tone: view.kpi.shortageDemandCount > 0 ? "danger" : undefined,
          },
          {
            label: "BOM 누락 수주",
            value: fmt(view.kpi.bomIssueLineCount),
            hint: "ACTIVE 기본 BOM 이 없거나 오류라 계산에서 제외된 수주 라인",
            tone: view.kpi.bomIssueLineCount > 0 ? "warn" : undefined,
          },
        ]
      : [
          { label: "대상 기간", value: periodText, hint: "납기 기준, 시작일·종료일 포함" },
          { label: "대상 수주라인", value: fmt(view.kpi.demandLineCount), hint: "기간 내 납기이며 미출하 잔량이 있는 라인" },
          { label: "대상 제품", value: fmt(view.kpi.productCount), hint: "대상 수주라인의 고유 제품(품목) 수" },
          { label: "필요 자재", value: fmt(view.kpi.requiredMaterialCount), hint: "기간 소요량이 있는 자재 종류" },
          {
            label: "소요 라인",
            value: fmt(view.kpi.requirementLineCount),
            hint: "수주 라인 × 자재 소요 건수 (단위가 달라 수량은 합산하지 않음)",
          },
          {
            label: "부족 자재",
            value: fmt(view.kpi.shortageMaterialCount),
            hint: "기간 종료 시점 예상재고가 0 미만인 자재",
            tone: view.kpi.shortageMaterialCount > 0 ? "danger" : undefined,
          },
        ]
    : []

  const bomIssueLines = view?.excludedLines.filter((l) => l.isBomIssue) ?? []
  const otherExcluded = view?.excludedLines.filter((l) => !l.isBomIssue) ?? []
  const attentionWarnings = view?.warnings.filter((w) => w.severity === "WARNING") ?? []

  const emptyMessage = !view
    ? ""
    : view.kpi.demandLineCount === 0
      ? periodActive
        ? "선택한 기간에 대상 수주가 없습니다."
        : "MRP 계산 대상 수주가 없습니다."
      : "계산 대상 자재가 없습니다."

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[20px] font-semibold">수주기준 자재소요 및 결품예측</h2>
        <p className="text-[14px] text-muted-foreground mt-1">
          미출하 수주를 납기순으로 처리하며 자재 가용재고를 순차 차감해 부족 시점과 원인 수주를 확인하고, 기간별 자재 소요량을
          분석합니다.
        </p>
      </div>

      {/* 조건 */}
      <div className="rounded-xl border p-4 space-y-4">
        <PeriodSelector
          selection={selection}
          today={today}
          from={from}
          to={to}
          disabled={isPending}
          onSelect={handleSelect}
          onCustomChange={handleCustomChange}
        />
        <div className="flex flex-wrap items-center gap-4 border-t pt-4">
          <label className="flex items-center gap-2 text-[14px] cursor-pointer">
            <Checkbox checked={includeDraft} onCheckedChange={(v) => setIncludeDraft(v === true)} />
            임시저장(DRAFT) 수주 포함
          </label>
          <Button onClick={handleRun} disabled={isPending} className="gap-2">
            <Calculator className="w-4 h-4" />
            {isPending ? "계산 중..." : "조회 / MRP 실행"}
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          재고 기준 = 가용재고(격리/보류 LOT 제외) · 출하잔량 = 수주수량 − 출하확정수량(계획 출하는 차감하지 않음)
          {selection.mode !== "ALL" &&
            " · 기간 MRP 는 선택 기간에 납기가 있는 수주만 차감하며, 기간 이전 납기의 미출하 수주는 재고를 선점하지 않습니다."}
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-[14px] border bg-red-50 border-red-200 text-red-700">{error}</div>
      )}

      {!view && !error && (
        <div className="text-center py-12 text-muted-foreground border rounded-xl">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-[15px]">기간을 선택하거나 &quot;조회 / MRP 실행&quot;을 눌러 주세요.</p>
        </div>
      )}

      {view && (
        <>
          {/* 보기 전환: 결품예측 / 기간 예상소요량 (같은 계산 결과, 추가 조회 없음) */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="결과 보기">
            {(
              [
                { id: "shortage", label: "결품예측", hint: "재고 대비 부족 시점과 원인 수주" },
                { id: "requirement", label: "기간 예상소요량", hint: "이 기간에 어떤 자재가 얼마나 필요한가" },
              ] as const
            ).map((t) => (
              <Button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={viewMode === t.id}
                variant={viewMode === t.id ? "default" : "outline"}
                size="sm"
                className="text-[14px]"
                title={t.hint}
                onClick={() => changeView(t.id)}
              >
                {t.label}
              </Button>
            ))}
            <span className="text-[13px] text-muted-foreground ml-2">
              {viewMode === "shortage" ? "재고 대비 부족 시점과 원인 수주" : "이 기간에 어떤 자재가 얼마나 필요한가"}
            </span>
          </div>

          {/* KPI */}
          <div className={`grid grid-cols-2 gap-4 ${viewMode === "shortage" ? "lg:grid-cols-5" : "lg:grid-cols-6"}`}>
            {kpis.map((k) => (
              <div
                key={k.label}
                className={`rounded-xl border p-4 ${
                  k.tone === "danger" ? "bg-red-50/60 border-red-200" : k.tone === "warn" ? "bg-amber-50/60 border-amber-200" : "bg-muted/30"
                }`}
                title={k.hint}
              >
                <p className="text-[13px] text-muted-foreground">{k.label}</p>
                <p
                  className={`${k.value.length > 8 ? "text-[18px]" : "text-[28px]"} font-bold leading-tight ${
                    k.tone === "danger" ? "text-red-600" : k.tone === "warn" ? "text-amber-600" : ""
                  }`}
                >
                  {k.value}
                </p>
                <p className="text-[13px] text-muted-foreground leading-snug">{k.hint}</p>
              </div>
            ))}
          </div>

          {/* BOM 누락 경고 */}
          {bomIssueLines.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-3 text-left text-[15px] font-medium text-amber-800"
                onClick={() => setShowBomIssues((v) => !v)}
              >
                <AlertTriangle className="w-4 h-4" />
                BOM 누락·오류로 계산에서 제외된 수주 {fmt(bomIssueLines.length)}건
                <span className="ml-auto text-[13px] font-normal">{showBomIssues ? "접기" : "목록 보기"}</span>
              </button>
              {showBomIssues && (
                <div className="overflow-x-auto border-t border-amber-200 bg-background rounded-b-xl">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b text-left text-[13px] text-muted-foreground">
                        <th className="px-4 py-2.5">PO(수주번호)</th>
                        <th className="px-4 py-2.5">제품코드</th>
                        <th className="px-4 py-2.5">제품명</th>
                        <th className="px-4 py-2.5">납기</th>
                        <th className="px-4 py-2.5 text-right">수주수량</th>
                        <th className="px-4 py-2.5 text-right">미출하잔량</th>
                        <th className="px-4 py-2.5">제외 이유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bomIssueLines.map((l) => (
                        <tr key={l.orderLineId} className="border-b last:border-0">
                          <td className="px-4 py-2.5 font-mono text-[13px]">{l.orderNo}</td>
                          <td className="px-4 py-2.5 font-mono text-[13px]">{l.itemCode}</td>
                          <td className="px-4 py-2.5">{l.itemName}</td>
                          <td className="px-4 py-2.5">{l.deliveryDate ?? "-"}</td>
                          <td className="px-4 py-2.5 text-right">{fmt(l.orderQty)}</td>
                          <td className="px-4 py-2.5 text-right">{l.remainingQty === null ? "-" : fmt(l.remainingQty)}</td>
                          <td className="px-4 py-2.5 text-amber-700">{l.reasonLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {(otherExcluded.length > 0 || attentionWarnings.length > 0) && (
            <div className="rounded-xl border">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-3 text-left text-[14px] font-medium"
                onClick={() => setShowWarnings((v) => !v)}
              >
                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                확인이 필요한 데이터 {fmt(otherExcluded.length + attentionWarnings.length)}건
                <span className="ml-auto text-[13px] font-normal text-muted-foreground">{showWarnings ? "접기" : "보기"}</span>
              </button>
              {showWarnings && (
                <ul className="border-t px-4 py-3 space-y-1.5 text-[14px]">
                  {otherExcluded.map((l) => (
                    <li key={"x" + l.orderLineId}>
                      <span className="font-mono text-[13px]">{l.orderNo}</span> · {l.itemCode} — {l.reasonLabel}
                    </li>
                  ))}
                  {attentionWarnings.map((w, i) => (
                    <li key={"w" + i}>{w.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 필터 */}
          <div className="flex flex-wrap items-center gap-4">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="자재 코드 / 자재명 검색"
              aria-label="자재 코드 또는 자재명 검색"
              className="w-[240px] text-[14px]"
            />
            <Input
              value={poQuery}
              onChange={(e) => setPoQuery(e.target.value)}
              placeholder="PO(수주번호) 검색"
              aria-label="PO 수주번호 검색"
              className="w-[200px] text-[14px]"
            />
            {viewMode === "shortage" && (
              <label className="flex items-center gap-2 text-[14px] cursor-pointer">
                <Checkbox checked={shortageOnly} onCheckedChange={(v) => setShortageOnly(v === true)} />
                부족자재만
              </label>
            )}
            <span className="text-[13px] text-muted-foreground ml-auto">
              {fmt(rows.length)} / {fmt(view.materials.length)}개 자재 · 계산 시각{" "}
              {new Date(payload!.calculatedAt).toLocaleString("ko-KR")}
            </span>
          </div>

          {/* 결과 */}
          {view.materials.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border rounded-xl">
              <PackageX className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-[15px]">{emptyMessage}</p>
              <p className="text-[13px] mt-1">
                {view.kpi.demandLineCount === 0
                  ? "조건에 해당하는 미출하 수주가 없거나, 모든 수주가 BOM 문제로 제외되었습니다."
                  : "대상 수주의 BOM 에 자재가 없습니다."}
              </p>
            </div>
          ) : viewMode === "requirement" ? (
            <PeriodRequirementTable
              rows={rows}
              expanded={expanded}
              onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
            />
          ) : (
            <div className="border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[14px] border-collapse">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="w-8 px-2 py-3" />
                      {TABLE_HEADERS.map((h) => (
                        <th
                          key={h.label}
                          className={`px-3 py-3 text-[13px] font-semibold text-muted-foreground whitespace-nowrap ${
                            h.align === "right" ? "text-right" : "text-left"
                          }`}
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <MaterialRows
                        key={m.componentItemId}
                        m={m}
                        open={expanded === m.componentItemId}
                        onToggle={() => setExpanded((cur) => (cur === m.componentItemId ? null : m.componentItemId))}
                      />
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={TABLE_HEADERS.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                          조건에 맞는 자재가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MaterialRows({ m, open, onToggle }: { m: OrderMrpMaterialView; open: boolean; onToggle: () => void }) {
  const short = m.shortageQty > 0
  const poText =
    m.shortageOrderNos.length === 0
      ? "-"
      : m.shortageOrderNos.length <= 2
        ? m.shortageOrderNos.join(", ")
        : `${m.shortageOrderNos.slice(0, 2).join(", ")} 외 ${m.shortageOrderNos.length - 2}건`
  return (
    <Fragment>
      <tr
        className={`border-b cursor-pointer transition-colors ${short ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-muted/10"}`}
        onClick={onToggle}
      >
        <td className="px-2 py-3 text-muted-foreground">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-3 py-3 font-mono text-[13px] whitespace-nowrap">{m.code}</td>
        <td className="px-3 py-3 font-medium">{m.name}</td>
        <td className="px-3 py-3 text-muted-foreground">{m.spec ?? "-"}</td>
        <td className="px-3 py-3 text-muted-foreground">{m.uom}</td>
        <td className="px-3 py-3 text-right">{fmt(m.qtyOnHand)}</td>
        <td className="px-3 py-3 text-right text-muted-foreground">{fmt(m.qtyHold)}</td>
        <td className="px-3 py-3 text-right">{fmt(m.qtyAvailable)}</td>
        <td className="px-3 py-3 text-right">{fmt(m.totalRequirement)}</td>
        <td className={`px-3 py-3 text-right font-semibold ${m.finalBalance < 0 ? "text-red-600" : ""}`}>
          {fmt(m.finalBalance)}
        </td>
        <td className={`px-3 py-3 text-right font-semibold ${short ? "text-red-600" : "text-muted-foreground"}`}>
          {short ? fmt(m.shortageQty) : "-"}
        </td>
        <td className="px-3 py-3 whitespace-nowrap">{m.firstShortageDate ?? "-"}</td>
        <td className="px-3 py-3">{poText}</td>
        <td className="px-3 py-3 text-right">{m.shortageDemandCount > 0 ? fmt(m.shortageDemandCount) : "-"}</td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/10">
          <td />
          <td colSpan={TABLE_HEADERS.length} className="px-3 py-4">
            <p className="text-[14px] font-medium mb-1">
              수주별 순차 차감 — {m.code} {m.name}
            </p>
            <p className="text-[13px] text-muted-foreground mb-3">
              가용재고 {fmt(m.qtyAvailable)}
              {m.qtyHold > 0 && ` (현재고 ${fmt(m.qtyOnHand)} − 예약 ${fmt(m.qtyHold)})`}
              {m.qtyExcludedByLot > 0 && ` · 격리/보류 LOT ${fmt(m.qtyExcludedByLot)} 제외`} 에서 납기순으로 차감합니다.
            </p>
            <div className="overflow-x-auto rounded-lg border bg-background">
              <table className="w-full text-[14px] border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b text-[13px] text-muted-foreground">
                    <th className="px-3 py-2 text-left">순서</th>
                    <th className="px-3 py-2 text-left">납기</th>
                    <th className="px-3 py-2 text-left">PO</th>
                    <th className="px-3 py-2 text-left">고객</th>
                    <th className="px-3 py-2 text-left">제품</th>
                    <th className="px-3 py-2 text-right">수주잔량</th>
                    <th className="px-3 py-2 text-right">해당 자재 소요</th>
                    <th className="px-3 py-2 text-right">차감 전</th>
                    <th className="px-3 py-2 text-right">차감 후</th>
                    <th className="px-3 py-2 text-left">결품</th>
                  </tr>
                </thead>
                <tbody>
                  {m.steps.map((s) => (
                    <tr key={s.orderLineId} className={`border-b last:border-0 ${s.isShortage ? "bg-red-50/50" : ""}`}>
                      <td className="px-3 py-2">{s.sequence}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.deliveryDate ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-[13px]">{s.orderNo}</td>
                      <td className="px-3 py-2">{s.customerName ?? "-"}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[13px]">{s.itemCode}</span>
                        {s.itemName !== s.itemCode && <span className="text-muted-foreground"> {s.itemName}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(s.demandQty)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.requirement)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.balanceBefore)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${s.balanceAfter < 0 ? "text-red-600" : ""}`}>
                        {fmt(s.balanceAfter)}
                      </td>
                      <td className="px-3 py-2">
                        {s.isShortage ? (
                          <span className="text-red-600 font-medium">부족 {fmt(s.shortageAtThisDemand)}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
