"use client"

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  AlertTriangle,
  Calculator,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  PackageX,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { runMrpSimulation, searchSimulationProducts } from "@/lib/actions/mrp-simulation.actions"
import type { SimulationPayload, SimulationProductSearchResult } from "@/lib/services/mrp-simulation.service"
import type { SimulationMaterialView } from "@/lib/mrp/simulation-adapter"

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })

type Row = { key: string; itemId: string; code: string; name: string; uom: string; qtyText: string }

const BOM_STATE_LABEL = { OK: "기본 BOM 있음", MISSING: "기본 BOM 없음", MULTIPLE: "기본 BOM 중복" } as const

const HEADERS: Array<{ label: string; align?: "right" }> = [
  { label: "자재코드" },
  { label: "자재명" },
  { label: "규격" },
  { label: "단위" },
  { label: "가상 총소요량", align: "right" },
  { label: "현재고", align: "right" },
  { label: "예약재고", align: "right" },
  { label: "가용재고", align: "right" },
  { label: "예상재고", align: "right" },
  { label: "부족수량", align: "right" },
]

function parseQty(text: string): number | null {
  const t = text.trim().replace(/,/g, "")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function SimulationPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [payload, setPayload] = useState<SimulationPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // 제품 검색
  const [searchText, setSearchText] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResult, setSearchResult] = useState<SimulationProductSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const searchSeq = useRef(0)

  // 결과 필터
  const [query, setQuery] = useState("")
  const [shortageOnly, setShortageOnly] = useState(false)
  const [productFilter, setProductFilter] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showExcluded, setShowExcluded] = useState(true)

  // 디바운스 검색 (서버에서 tenant·생산 대상 품목으로 한정, 최대 20건)
  useEffect(() => {
    if (!searchOpen) return
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await searchSimulationProducts(searchText)
        if (seq === searchSeq.current) setSearchResult(r)
      } catch {
        if (seq === searchSeq.current) setSearchResult({ items: [], hasAnyProduct: true })
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [searchText, searchOpen])

  const addProduct = (p: SimulationProductSearchResult["items"][number]) => {
    setNotice(null)
    if (rows.some((r) => r.itemId === p.id)) {
      setNotice(`${p.code} 은(는) 이미 추가된 제품입니다. 수량을 수정해 주세요.`)
      return
    }
    setRows((prev) => [...prev, { key: p.id, itemId: p.id, code: p.code, name: p.name, uom: p.uom, qtyText: "" }])
    setSearchText("")
    setSearchOpen(false)
  }

  const rowErrors = rows.map((r) => {
    const q = parseQty(r.qtyText)
    return q === null || !(q > 0) ? "0보다 큰 수량을 입력하세요" : null
  })
  const canRun = rows.length > 0 && rowErrors.every((e) => e === null) && !isPending

  const run = () => {
    if (!canRun) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await runMrpSimulation({
          items: rows.map((r) => ({ itemId: r.itemId, qty: parseQty(r.qtyText) as number })),
        })
        setPayload(result)
        setExpanded(null)
      } catch (e) {
        setPayload(null)
        setError(e instanceof Error ? e.message : "시뮬레이션에 실패했습니다.")
      }
    })
  }

  const reset = () => {
    setRows([])
    setPayload(null)
    setError(null)
    setNotice(null)
    setQuery("")
    setShortageOnly(false)
    setProductFilter("")
    setExpanded(null)
    setSearchText("")
    setSearchOpen(false)
  }

  const view = payload?.view ?? null

  const filtered = useMemo(() => {
    if (!view) return []
    const q = query.trim().toLowerCase()
    return view.materials.filter((m) => {
      if (shortageOnly && !(m.shortageQty > 0)) return false
      if (q && !(m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))) return false
      if (productFilter && !m.sources.some((s) => s.simId === productFilter)) return false
      return true
    })
  }, [view, query, shortageOnly, productFilter])

  const bomIssues = view?.excluded.filter((e) => e.isBomIssue) ?? []
  const otherExcluded = view?.excluded.filter((e) => !e.isBomIssue) ?? []
  const hasSemi = view?.materials.some((m) => m.itemType === "SEMI_FINISHED") ?? false

  const kpis = view
    ? [
        { label: "시뮬레이션 제품", value: fmt(view.kpi.productCount), hint: "계산에 포함된 제품 수(같은 제품은 합산)" },
        { label: "필요 자재", value: fmt(view.kpi.requiredMaterialCount), hint: "BOM 전개 결과 소요량이 있는 자재 종류" },
        {
          label: "부족 자재",
          value: fmt(view.kpi.shortageMaterialCount),
          hint: "가용재고로 충당할 수 없는 자재",
          tone: view.kpi.shortageMaterialCount > 0 ? "danger" : undefined,
        },
        {
          label: "BOM 오류 제품",
          value: fmt(view.kpi.bomIssueProductCount),
          hint: "기본 BOM 이 없거나 오류라 계산에서 제외된 제품",
          tone: view.kpi.bomIssueProductCount > 0 ? "warn" : undefined,
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[20px] font-semibold">품목별 예상소요 시뮬레이션</h2>
        <p className="text-[14px] text-muted-foreground mt-1">
          실제 수주나 재고를 변경하지 않고, 선택한 제품을 생산할 때 필요한 자재와 부족 수량을 계산합니다.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-[14px] text-sky-900">
        <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          이 화면은 <b>가상 계산</b>입니다. 수주·생산계획·작업지시·재고 예약·발주가 생성되거나 변경되지 않습니다. 현재 실제
          수주의 자재 수요는 포함하지 않으며, 재고는 현재 가용재고를 사용합니다.
        </p>
      </div>

      {/* 입력 */}
      <div className="rounded-xl border p-4 space-y-4">
        <div className="relative max-w-xl">
          <label htmlFor="sim-product-search" className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
            제품 추가 (제품코드 또는 제품명 검색)
          </label>
          <div className="flex gap-2">
            <Input
              id="sim-product-search"
              value={searchText}
              placeholder="예: FG-001"
              className="text-[14px]"
              autoComplete="off"
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setSearchText(e.target.value)
                setSearchOpen(true)
              }}
            />
            <Button type="button" variant="outline" className="gap-1.5 shrink-0" onClick={() => setSearchOpen((v) => !v)}>
              <Plus className="w-4 h-4" />
              제품 추가
            </Button>
          </div>
          {searchOpen && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border bg-background shadow-md max-h-72 overflow-y-auto">
              {searching && !searchResult && <p className="px-3 py-3 text-[14px] text-muted-foreground">검색 중...</p>}
              {searchResult && searchResult.items.length === 0 && (
                <div className="px-3 py-3 text-[14px] text-muted-foreground">
                  {searchResult.hasAnyProduct ? (
                    "검색 결과가 없습니다."
                  ) : (
                    <>
                      등록된 생산 품목이 없습니다.
                      <br />
                      <span className="text-[13px]">품목/BOM 등록 후 시뮬레이션할 수 있습니다.</span>
                    </>
                  )}
                </div>
              )}
              {searchResult?.items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover:bg-muted/40 border-b last:border-0 flex items-center gap-3"
                  onClick={() => addProduct(p)}
                >
                  <span className="font-mono text-[13px]">{p.code}</span>
                  <span className="text-[14px] flex-1 truncate">{p.name}</span>
                  <span
                    className={`text-[13px] ${p.bomState === "OK" ? "text-muted-foreground" : "text-amber-700"}`}
                  >
                    {BOM_STATE_LABEL[p.bomState]}
                  </span>
                </button>
              ))}
            </div>
          )}
          {notice && <p className="text-[13px] text-amber-700 mt-1.5">{notice}</p>}
        </div>

        {rows.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">시뮬레이션할 제품을 추가해 주세요.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[14px] border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b text-[13px] text-muted-foreground">
                  <th className="px-3 py-2.5 text-left">제품코드</th>
                  <th className="px-3 py-2.5 text-left">제품명</th>
                  <th className="px-3 py-2.5 text-right">예상 생산수량</th>
                  <th className="px-3 py-2.5 text-left">단위</th>
                  <th className="px-3 py-2.5 w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-[13px]">{r.code}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={r.qtyText}
                          aria-label={`${r.code} 예상 생산수량`}
                          className="w-[140px] text-right text-[14px]"
                          onChange={(e) =>
                            setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, qtyText: e.target.value } : x)))
                          }
                        />
                        {r.qtyText !== "" && rowErrors[i] && (
                          <span className="text-[13px] text-red-600 mt-1">{rowErrors[i]}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.uom}</td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${r.code} 삭제`}
                        onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={!canRun} className="gap-2">
            <Calculator className="w-4 h-4" />
            {isPending ? "계산 중..." : "시뮬레이션 실행"}
          </Button>
          <Button variant="outline" onClick={reset} disabled={isPending} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            초기화
          </Button>
        </div>
      </div>

      {error && <div className="px-4 py-3 rounded-lg text-[14px] border bg-red-50 border-red-200 text-red-700">{error}</div>}

      {view && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((k) => (
              <div
                key={k.label}
                title={k.hint}
                className={`rounded-xl border p-4 ${
                  k.tone === "danger" ? "bg-red-50/60 border-red-200" : k.tone === "warn" ? "bg-amber-50/60 border-amber-200" : "bg-muted/30"
                }`}
              >
                <p className="text-[13px] text-muted-foreground">{k.label}</p>
                <p
                  className={`text-[28px] font-bold leading-tight ${
                    k.tone === "danger" ? "text-red-600" : k.tone === "warn" ? "text-amber-600" : ""
                  }`}
                >
                  {k.value}
                </p>
                <p className="text-[13px] text-muted-foreground leading-snug">{k.hint}</p>
              </div>
            ))}
          </div>

          {view.excluded.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-3 text-left text-[15px] font-medium text-amber-800"
                onClick={() => setShowExcluded((v) => !v)}
              >
                <AlertTriangle className="w-4 h-4" />
                계산에서 제외된 제품 {fmt(view.excluded.length)}건
                {bomIssues.length > 0 && ` (BOM 오류 ${fmt(bomIssues.length)}건)`}
                <span className="ml-auto text-[13px] font-normal">{showExcluded ? "접기" : "목록 보기"}</span>
              </button>
              {showExcluded && (
                <div className="overflow-x-auto border-t border-amber-200 bg-background rounded-b-xl">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b text-left text-[13px] text-muted-foreground">
                        <th className="px-4 py-2.5">제품코드</th>
                        <th className="px-4 py-2.5">제품명</th>
                        <th className="px-4 py-2.5 text-right">입력수량</th>
                        <th className="px-4 py-2.5">오류 유형</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...bomIssues, ...otherExcluded].map((e, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-4 py-2.5 font-mono text-[13px]">{e.code}</td>
                          <td className="px-4 py-2.5">{e.name}</td>
                          <td className="px-4 py-2.5 text-right">{e.inputQty === null ? "-" : fmt(e.inputQty)}</td>
                          <td className="px-4 py-2.5 text-amber-700">{e.reasonLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {view.warnings.length > 0 && (
            <ul className="rounded-xl border px-4 py-3 space-y-1 text-[13px] text-muted-foreground">
              {view.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}

          {view.materials.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border rounded-xl">
              <PackageX className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-[15px]">계산할 수 있는 제품이 없습니다.</p>
              <p className="text-[13px] mt-1">제외된 제품의 BOM 을 확인한 뒤 다시 실행해 주세요.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="자재 코드 / 자재명 검색"
                  aria-label="자재 코드 또는 자재명 검색"
                  className="w-[240px] text-[14px]"
                />
                <select
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                  aria-label="제품 필터"
                  className="h-10 rounded-md border border-input bg-background px-3 text-[14px]"
                >
                  <option value="">전체 제품</option>
                  {view.products.map((p) => (
                    <option key={p.simId} value={p.simId}>
                      {p.code} ({fmt(p.qty)} {p.uom})
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-[14px] cursor-pointer">
                  <Checkbox checked={shortageOnly} onCheckedChange={(v) => setShortageOnly(v === true)} />
                  부족자재만
                </label>
                <span className="text-[13px] text-muted-foreground ml-auto">
                  {fmt(filtered.length)} / {fmt(view.materials.length)}개 자재 · 계산 시각{" "}
                  {new Date(payload!.calculatedAt).toLocaleString("ko-KR")}
                </span>
              </div>

              <div className="border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="w-8 px-2 py-3" />
                        {HEADERS.map((h) => (
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
                      {filtered.map((m) => (
                        <MaterialRow
                          key={m.componentItemId}
                          m={m}
                          open={expanded === m.componentItemId}
                          onToggle={() => setExpanded((cur) => (cur === m.componentItemId ? null : m.componentItemId))}
                        />
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={HEADERS.length + 1} className="px-4 py-8 text-center text-muted-foreground">
                            조건에 맞는 자재가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {hasSemi && (
                <p className="text-[13px] text-muted-foreground">
                  반제품(SEMI_FINISHED)의 재고는 하위 자재 소요에서 차감하지 않습니다. 반제품 행의 가용재고는 참고 정보입니다.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function MaterialRow({ m, open, onToggle }: { m: SimulationMaterialView; open: boolean; onToggle: () => void }) {
  const short = m.shortageQty > 0
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
        <td className="px-3 py-3 text-right font-semibold">{fmt(m.totalRequirement)}</td>
        <td className="px-3 py-3 text-right">{fmt(m.qtyOnHand)}</td>
        <td className="px-3 py-3 text-right text-muted-foreground">{fmt(m.qtyHold)}</td>
        <td className="px-3 py-3 text-right">{fmt(m.qtyAvailable)}</td>
        <td className={`px-3 py-3 text-right font-semibold ${m.expectedBalance < 0 ? "text-red-600" : ""}`}>
          {fmt(m.expectedBalance)}
        </td>
        <td className={`px-3 py-3 text-right font-semibold ${short ? "text-red-600" : "text-muted-foreground"}`}>
          {short ? fmt(m.shortageQty) : "-"}
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/10">
          <td />
          <td colSpan={HEADERS.length} className="px-3 py-4">
            <p className="text-[14px] font-medium mb-1">
              소요 근거 — {m.code} {m.name}
            </p>
            <p className="text-[13px] text-muted-foreground mb-3">
              가용재고 {fmt(m.qtyAvailable)}
              {m.qtyHold > 0 && ` (현재고 ${fmt(m.qtyOnHand)} − 예약 ${fmt(m.qtyHold)})`}
              {m.qtyExcludedByLot > 0 && ` · 격리/보류 LOT ${fmt(m.qtyExcludedByLot)} 제외`}
            </p>
            <div className="overflow-x-auto rounded-lg border bg-background">
              <table className="w-full text-[14px] border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b text-[13px] text-muted-foreground">
                    <th className="px-3 py-2 text-left">제품코드</th>
                    <th className="px-3 py-2 text-left">제품명</th>
                    <th className="px-3 py-2 text-right">예상 생산수량</th>
                    <th className="px-3 py-2 text-right">제품당 소요(BOM 전개 합산)</th>
                    <th className="px-3 py-2 text-right">자재 소요</th>
                  </tr>
                </thead>
                <tbody>
                  {m.sources.map((s) => (
                    <tr key={s.simId} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-[13px]">{s.itemCode}</td>
                      <td className="px-3 py-2">{s.itemName}</td>
                      <td className="px-3 py-2 text-right">{fmt(s.productQty)}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{fmt(s.bomQtyPerUnit)}</td>
                      <td className="px-3 py-2 text-right font-medium">{fmt(s.requirement)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/20">
                    <td colSpan={4} className="px-3 py-2 text-right text-[13px] text-muted-foreground">
                      합계
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {fmt(m.totalRequirement)} {m.uom}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
