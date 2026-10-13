"use client"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getLotLineageByNo, type LotLineageResult } from "@/lib/actions/lot-lineage.actions"
import { formatQuantity } from "@/lib/utils"

type Lineage = NonNullable<LotLineageResult>

type TraceabilityClientProps = {
  initialLotNo?: string
  tenantId: string
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "활성", className: "bg-green-100 text-green-800" },
  QUARANTINE: { label: "격리", className: "bg-amber-100 text-amber-800" },
  ON_HOLD: { label: "보류", className: "bg-blue-100 text-blue-800" },
  CONSUMED: { label: "소진", className: "bg-slate-100 text-slate-600" },
  EXPIRED: { label: "만료", className: "bg-red-100 text-red-800" },
}

const RESULT_CONFIG: Record<string, { label: string; className: string }> = {
  PASS: { label: "합격", className: "bg-green-100 text-green-800" },
  FAIL: { label: "불합격", className: "bg-red-100 text-red-800" },
  PENDING: { label: "대기", className: "bg-slate-100 text-slate-700" },
}

const SHIPMENT_STATUS: Record<string, string> = {
  PLANNED: "예약",
  SHIPPED: "실출하",
  DELIVERED: "납품완료",
  CANCELLED: "취소",
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5">
      <h3 className="mb-3 text-[18px] font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  )
}

function Empty({ children = "연결된 생산이력을 확인할 수 없습니다." }: { children?: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed bg-slate-50 p-5 text-center text-[14px] text-slate-500">{children}</p>
}

function Badge({ children, className = "bg-slate-100 text-slate-700" }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${className}`}>{children}</span>
}

function LotSummary({ lineage }: { lineage: Lineage }) {
  const status = STATUS_CONFIG[lineage.lot.status]
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
      <p className="mb-2 text-[13px] font-semibold text-blue-700">기준 LOT</p>
      <div className="flex flex-wrap items-center gap-3 text-[14px]">
        <span className="font-mono text-[18px] font-bold text-blue-950">{lineage.lot.lotNo}</span>
        <span className="font-medium text-blue-900">{lineage.lot.item.name}</span>
        <span className="text-blue-800">{lineage.lot.item.code}</span>
        <Badge className={status?.className}>{status?.label ?? lineage.lot.status}</Badge>
        {!lineage.lot.isTraceTarget && <Badge className="bg-amber-100 text-amber-800">LOT 추적 대상 아님</Badge>}
      </div>
      <div className="mt-3 grid gap-3 text-[14px] sm:grid-cols-3">
        <div>현재고 <b>{formatQuantity(lineage.inventory.qtyOnHand)}</b></div>
        <div>가용재고 <b>{formatQuantity(lineage.inventory.qtyAvailable)}</b></div>
        <div>품목유형 <b>{lineage.lot.item.itemType}</b></div>
      </div>
    </div>
  )
}

export function TraceabilityClient({ initialLotNo, tenantId }: TraceabilityClientProps) {
  const [query, setQuery] = useState(initialLotNo ?? "")
  const [lineage, setLineage] = useState<Lineage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasAnyProductionLink = useMemo(() => Boolean(
    lineage && (
      lineage.materialIssues.length > 0 ||
      lineage.parentLots.length > 0 ||
      lineage.childLots.length > 0 ||
      lineage.workOrders.length > 0 ||
      lineage.receipts.length > 0 ||
      lineage.shipments.length > 0 ||
      lineage.outsourcingHistory.length > 0 ||
      lineage.inspections.length > 0
    ),
  ), [lineage])

  const handleSearch = async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setLineage(null)
    try {
      const result = await getLotLineageByNo(q, tenantId)
      if (!result) {
        setError(`'${q}' LOT를 찾을 수 없습니다.`)
        return
      }
      setLineage(result)
    } catch (e) {
      console.error(e)
      setError("추적 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialLotNo) void handleSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white p-6">
        <p className="mb-4 text-[15px] font-medium text-foreground">LOT 번호로 추적</p>
        <div className="flex gap-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="LOT 번호 입력"
            className="flex-1 text-[14px]"
          />
          <Button onClick={handleSearch} disabled={loading || !query.trim()} className="shrink-0 gap-2">
            <Search className="h-4 w-4" />
            {loading ? "추적 중..." : "추적"}
          </Button>
        </div>
        {error && <p className="mt-3 text-[14px] text-red-500">{error}</p>}
      </div>

      {lineage && <LotSummary lineage={lineage} />}

      {lineage && !hasAnyProductionLink && (
        <Empty>연결된 생산이력을 확인할 수 없습니다. LOT 번호/일자/품목명으로 생산이력을 추정 연결하지 않습니다.</Empty>
      )}

      {lineage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="원자재/상위 LOT">
            {lineage.parentLots.length === 0 ? <Empty /> : (
              <div className="space-y-2">
                {lineage.parentLots.map((lot) => (
                  <div key={lot.id} className="rounded-lg border p-3 text-[14px]">
                    <div className="font-mono font-semibold">{lot.lotNo}</div>
                    <div className="text-slate-600">{lot.item.code} · {lot.item.name} · {formatQuantity(lot.qty)} · {lot.relationType}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="하위/산출 LOT">
            {lineage.childLots.length === 0 ? <Empty /> : (
              <div className="space-y-2">
                {lineage.childLots.map((lot) => (
                  <div key={lot.id} className="rounded-lg border p-3 text-[14px]">
                    <div className="font-mono font-semibold">{lot.lotNo}</div>
                    <div className="text-slate-600">{lot.item.code} · {lot.item.name} · {formatQuantity(lot.qty)} · {lot.relationType}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="이 LOT가 투입된 작업지시">
            {lineage.materialIssues.length === 0 ? <Empty /> : (
              <div className="space-y-2">
                {lineage.materialIssues.map((issue) => (
                  <div key={issue.id} className="rounded-lg border p-3 text-[14px]">
                    <div className="font-semibold">{issue.workOrder.orderNo} {issue.workOrder.manufacturingNo && `· ${issue.workOrder.manufacturingNo}`}</div>
                    <div className="text-slate-600">투입 {formatQuantity(issue.qty)} {issue.materialItem.uom} · {issue.materialItem.code} · {new Date(issue.issuedAt).toLocaleString()}</div>
                    {issue.transaction && <div className="text-[13px] text-slate-500">재고거래 {issue.transaction.txNo} · {issue.transaction.txType}</div>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="입고/출하">
            {lineage.receipts.length === 0 && lineage.shipments.length === 0 ? <Empty /> : (
              <div className="space-y-3 text-[14px]">
                {lineage.receipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-lg border border-green-200 bg-green-50 p-3">
                    <b>입고</b> {formatQuantity(receipt.receiptQty)} · {receipt.workOrder.orderNo} · {receipt.warehouse.name}/{receipt.location.name} · {new Date(receipt.receiptAt).toLocaleString()}
                  </div>
                ))}
                {lineage.shipments.map((shipment) => (
                  <div key={shipment.id} className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                    <b>출하</b> {formatQuantity(shipment.qty)} · {shipment.shipmentOrder.shipmentNo} · {SHIPMENT_STATUS[shipment.shipmentOrder.status] ?? shipment.shipmentOrder.status} · {shipment.shipmentOrder.salesOrder.orderNo}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="외주 이력">
            {lineage.outsourcingHistory.length === 0 ? <Empty /> : (
              <div className="space-y-2">
                {lineage.outsourcingHistory.map((movement) => (
                  <div key={movement.id} className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-[14px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{movement.movementType}</b>
                      {movement.purchaseOrder && <Badge>{movement.purchaseOrder.orderNo}</Badge>}
                      <span className="text-slate-700">{movement.partner?.name ?? "외주처 미지정"}</span>
                    </div>
                    <div className="mt-1 text-[13px] text-slate-600">
                      {movement.workOrder?.orderNo ?? "-"} · {movement.operation.seq}. {movement.operation.name} · {formatQuantity(movement.qty)} · {new Date(movement.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {lineage && (
        <Section title="작업지시 / 공정 / 생산실적">
          {lineage.workOrders.length === 0 ? <Empty /> : (
            <div className="space-y-4">
              {lineage.workOrders.map((workOrder) => (
                <div key={workOrder.id} className="rounded-lg border p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[14px]">
                    <b className="text-[15px]">{workOrder.orderNo}</b>
                    {workOrder.manufacturingNo && <Badge>{workOrder.manufacturingNo}</Badge>}
                    <span className="text-slate-600">{workOrder.item.code} · {workOrder.item.name}</span>
                  </div>
                  <div className="space-y-2">
                    {workOrder.operations.map((operation) => (
                      <div key={operation.id} className="rounded-lg bg-slate-50 p-3 text-[14px]">
                        <div className="font-medium">{operation.seq}. {operation.routingOperation.name} · {operation.routingOperation.workCenter.name}</div>
                        {operation.productionResults.length === 0 ? (
                          <div className="mt-1 text-[13px] text-slate-500">생산실적 없음</div>
                        ) : operation.productionResults.map((result) => (
                          <div key={result.id} className="mt-1 text-[13px] text-slate-600">
                            양품 {formatQuantity(result.goodQty)} · 불량 {formatQuantity(result.defectQty)} · 작업자 {result.operator?.name ?? "미지정"} · 설비 {result.equipment?.name ?? "미지정"}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {lineage && (
        <Section title="검사 / 측정 / 불량 / CAPA">
          {lineage.inspections.length === 0 && lineage.legacyWorkOrderInspections.length === 0 ? <Empty /> : (
            <div className="space-y-3">
              {lineage.inspections.map((inspection) => {
                const result = inspection.result ? RESULT_CONFIG[inspection.result] : null
                return (
                  <div key={inspection.id} className="rounded-lg border p-4 text-[14px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{inspection.stage}</b>
                      {inspection.result && <Badge className={result?.className}>{result?.label ?? inspection.result}</Badge>}
                      <span className="text-slate-600">{inspection.workOrder.orderNo} · {inspection.operation.name} · 검사자 {inspection.inspector.name}</span>
                    </div>
                    {inspection.measurements.length > 0 && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {inspection.measurements.map((m) => (
                          <div key={m.id} className="rounded bg-slate-50 px-3 py-2 text-[13px]">
                            {m.itemName}: {m.numericValue ?? m.textValue ?? String(m.booleanValue)} {m.unit ?? ""} {m.judgement && `· ${m.judgement}`}
                          </div>
                        ))}
                      </div>
                    )}
                    {inspection.defects.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {inspection.defects.map((defect) => (
                          <div key={defect.id} className="rounded border border-red-100 bg-red-50 p-3 text-[13px] text-red-900">
                            불량 {defect.defectCode.code} · {defect.defectCode.name} · {formatQuantity(defect.qty)}
                            {defect.causeAnalysis && <div>원인분석: {defect.causeAnalysis.rootCause}</div>}
                            {defect.correctiveActions.map((a) => <div key={a.id}>시정조치: {a.status} · {a.actionContent}</div>)}
                            {defect.recurrencePreventions.map((p) => <div key={p.id}>재발방지: {p.status} · {p.preventionContent}</div>)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {lineage.legacyWorkOrderInspections.map((inspection) => (
                <div key={inspection.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[14px]">
                  <b>{inspection.stage}</b> · {inspection.result ?? "미판정"} · {inspection.workOrder.orderNo} · {inspection.operation.name}
                  <div className="text-[13px] text-amber-700">이 검사는 LOT 직접 귀속 전의 작업지시 기준 이력입니다.</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {!lineage && !loading && !error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <Search className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-[15px] text-slate-500">LOT 번호를 입력하고 추적 버튼을 클릭하세요.</p>
          <p className="mt-1 text-[13px] text-slate-400">원자재 투입, 작업지시, 공정/실적, 검사, 입고, 출하를 LOT FK 기준으로 조회합니다.</p>
        </div>
      )}
    </div>
  )
}
