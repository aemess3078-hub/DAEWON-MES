"use client"

import { Fragment, useMemo, useState, useTransition } from "react"
import { AlertTriangle, Calculator, ChevronDown, ChevronRight, ClipboardList, PackageX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { runOrderBasedMrp } from "@/lib/actions/mrp-order.actions"
import type { OrderMrpPayload } from "@/lib/services/mrp-order.service"
import type { OrderMrpMaterialView } from "@/lib/mrp/order-mrp-adapter"

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

type Kpi = { label: string; value: number; hint: string; tone?: "danger" | "warn" }

export function OrderMrpPanel() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [includeDraft, setIncludeDraft] = useState(false)
  const [payload, setPayload] = useState<OrderMrpPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [query, setQuery] = useState("")
  const [shortageOnly, setShortageOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showBomIssues, setShowBomIssues] = useState(false)
  const [showWarnings, setShowWarnings] = useState(false)

  const run = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await runOrderBasedMrp({
          from: from || null,
          to: to || null,
          includeDraft,
        })
        setPayload(result)
        setExpanded(null)
      } catch (e) {
        setPayload(null)
        setError(e instanceof Error ? e.message : "MRP 계산에 실패했습니다.")
      }
    })
  }

  const view = payload?.view ?? null

  const rows = useMemo(() => {
    if (!view) return []
    const q = query.trim().toLowerCase()
    return view.materials.filter((m) => {
      if (shortageOnly && !(m.shortageQty > 0)) return false
      if (!q) return true
      return m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    })
  }, [view, query, shortageOnly])

  const kpis: Kpi[] = view
    ? [
        {
          label: "대상 수주라인",
          value: view.kpi.demandLineCount,
          hint: "미출하 잔량이 있어 계산에 포함된 수주 라인",
        },
        {
          label: "필요 자재",
          value: view.kpi.requiredMaterialCount,
          hint: "BOM 전개 결과 소요량이 있는 자재 종류",
        },
        {
          label: "부족 자재",
          value: view.kpi.shortageMaterialCount,
          hint: "최종 예상재고가 0 미만인 자재",
          tone: view.kpi.shortageMaterialCount > 0 ? "danger" : undefined,
        },
        {
          label: "결품 발생 수주",
          value: view.kpi.shortageDemandCount,
          hint: "납기순 차감 중 1개 이상 자재가 부족해지는 수주 라인",
          tone: view.kpi.shortageDemandCount > 0 ? "danger" : undefined,
        },
        {
          label: "BOM 누락 수주",
          value: view.kpi.bomIssueLineCount,
          hint: "ACTIVE 기본 BOM 이 없거나 오류라 계산에서 제외된 수주 라인",
          tone: view.kpi.bomIssueLineCount > 0 ? "warn" : undefined,
        },
      ]
    : []

  const bomIssueLines = view?.excludedLines.filter((l) => l.isBomIssue) ?? []
  const otherExcluded = view?.excludedLines.filter((l) => !l.isBomIssue) ?? []
  const attentionWarnings = view?.warnings.filter((w) => w.severity === "WARNING") ?? []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[20px] font-semibold">수주기준 자재소요 및 결품예측</h2>
        <p className="text-[14px] text-muted-foreground mt-1">
          미출하 수주를 납기순으로 처리하며 자재 가용재고를 순차 차감해 부족 시점과 원인 수주를 확인합니다.
        </p>
      </div>

      {/* 조건 */}
      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">납기 시작일</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[170px] text-[14px]" />
          </div>
          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">납기 종료일</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[170px] text-[14px]" />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setFrom("")
              setTo("")
            }}
            disabled={!from && !to}
          >
            전체 미출하
          </Button>
          <label className="flex items-center gap-2 text-[14px] pb-2 cursor-pointer">
            <Checkbox checked={includeDraft} onCheckedChange={(v) => setIncludeDraft(v === true)} />
            임시저장(DRAFT) 수주 포함
          </label>
          <Button onClick={run} disabled={isPending} className="gap-2">
            <Calculator className="w-4 h-4" />
            {isPending ? "계산 중..." : "조회 / MRP 실행"}
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {from || to
            ? `납기 ${from || "처음"} ~ ${to || "끝"} (양끝 포함)`
            : "기간 미지정: 현재 존재하는 모든 미출하 수주"}
          {" · "}재고 기준 = 가용재고(격리/보류 LOT 제외) · 출하잔량 = 수주수량 − 출하확정수량(계획 출하는 차감하지 않음)
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-[14px] border bg-red-50 border-red-200 text-red-700">{error}</div>
      )}

      {!view && !error && (
        <div className="text-center py-12 text-muted-foreground border rounded-xl">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-[15px]">조건을 확인한 뒤 &quot;조회 / MRP 실행&quot;을 눌러 주세요.</p>
        </div>
      )}

      {view && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
                  className={`text-[28px] font-bold leading-tight ${
                    k.tone === "danger" ? "text-red-600" : k.tone === "warn" ? "text-amber-600" : ""
                  }`}
                >
                  {fmt(k.value)}
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
              className="w-[260px] text-[14px]"
            />
            <label className="flex items-center gap-2 text-[14px] cursor-pointer">
              <Checkbox checked={shortageOnly} onCheckedChange={(v) => setShortageOnly(v === true)} />
              부족자재만
            </label>
            <span className="text-[13px] text-muted-foreground ml-auto">
              {fmt(rows.length)} / {fmt(view.materials.length)}개 자재 · 계산 시각{" "}
              {new Date(payload!.calculatedAt).toLocaleString("ko-KR")}
            </span>
          </div>

          {/* 결과 테이블 */}
          {view.materials.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border rounded-xl">
              <PackageX className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-[15px]">계산 대상 자재가 없습니다.</p>
              <p className="text-[13px] mt-1">
                조건에 해당하는 미출하 수주가 없거나, 모든 수주가 BOM 문제로 제외되었습니다.
              </p>
            </div>
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
