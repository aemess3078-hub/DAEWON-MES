"use client"

/**
 * 정방향/역방향 제조이력 추적 패널 (Phase 11 / DG-006 · DG-007).
 * 한 번의 Server Action(traceLot) 호출 결과(TraceResult DTO)를 체인 순서대로 보여준다.
 *   공급사 → 발주/입고 → 원자재 LOT → 작업지시(공정·설비·작업자·품질) → 완제품 LOT → 출하 → 고객
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { traceLot } from "@/lib/actions/lot-trace.actions"
import type { TraceDirection, TraceResult } from "@/lib/traceability/lot-trace.service"
import { formatQuantity } from "@/lib/utils"

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "활성",
  QUARANTINE: "격리",
  ON_HOLD: "보류",
  CONSUMED: "소진",
  EXPIRED: "만료",
}

const RESULT_LABEL: Record<string, string> = { PASS: "합격", FAIL: "불합격", PENDING: "대기" }

function fmtDate(value: string | null | undefined) {
  if (!value) return "-"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("ko-KR", { hour12: false })
}

function Block({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5">
      <h3 className="mb-3 flex items-center gap-2 text-[18px] font-semibold text-slate-900">
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-600">{count}</span>
        )}
      </h3>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed bg-slate-50 p-4 text-center text-[14px] text-slate-500">{children}</p>
}

export function LotTracePanel({
  lotNo,
  defaultDirection,
}: {
  lotNo: string
  defaultDirection: TraceDirection
}) {
  const [direction, setDirection] = useState<TraceDirection>(defaultDirection)
  const [trace, setTrace] = useState<TraceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (dir: TraceDirection) => {
      setLoading(true)
      setError(null)
      try {
        const res = await traceLot(lotNo, dir)
        if (!res.ok) {
          setTrace(null)
          setError(res.message)
        } else {
          setTrace(res.trace)
        }
      } catch {
        setTrace(null)
        setError("제조이력 추적 중 오류가 발생했습니다.")
      } finally {
        setLoading(false)
      }
    },
    [lotNo],
  )

  useEffect(() => {
    setDirection(defaultDirection)
    void run(defaultDirection)
  }, [lotNo, defaultDirection, run])

  const view = useMemo(() => {
    if (!trace) return null
    const nodeById = new Map(trace.nodes.map((n) => [n.id, n]))
    const incoming = (id: string, rel: string) =>
      trace.edges.filter((e) => e.to === id && e.relationship === rel).map((e) => ({ edge: e, node: nodeById.get(e.from) }))
    const outgoing = (id: string, rel: string) =>
      trace.edges.filter((e) => e.from === id && e.relationship === rel).map((e) => ({ edge: e, node: nodeById.get(e.to) }))
    return {
      rawLots: trace.lots.filter((l) => l.role === "RAW"),
      semiLots: trace.lots.filter((l) => l.role === "SEMI"),
      finishedLots: trace.lots.filter((l) => l.role === "FINISHED"),
      shipments: trace.nodes.filter((n) => n.type === "SHIPMENT"),
      incoming,
      outgoing,
    }
  }, [trace])

  const switchDirection = (dir: TraceDirection) => {
    if (dir === direction) return
    setDirection(dir)
    void run(dir)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[20px] font-semibold text-slate-900">제조이력 추적</h2>
        <Button
          type="button"
          variant={direction === "FORWARD" ? "default" : "outline"}
          className="h-10 px-3 text-[14px]"
          onClick={() => switchDirection("FORWARD")}
          disabled={loading}
        >
          <ArrowDownToLine className="mr-1.5 h-4 w-4" /> 정방향 (원자재 → 고객)
        </Button>
        <Button
          type="button"
          variant={direction === "REVERSE" ? "default" : "outline"}
          className="h-10 px-3 text-[14px]"
          onClick={() => switchDirection("REVERSE")}
          disabled={loading}
        >
          <ArrowUpFromLine className="mr-1.5 h-4 w-4" /> 역방향 (완제품 → 공급사)
        </Button>
        {loading && <span className="text-[14px] text-slate-500">추적 중…</span>}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-[14px] text-red-700">{error}</p>}

      {trace && view && (
        <>
          {trace.truncated && (
            <p className="rounded-lg bg-amber-50 p-3 text-[14px] text-amber-900">
              추적 범위가 커서 일부만 표시했습니다. 개별 LOT 로 다시 추적해 주세요.
            </p>
          )}

          <Block title="공급사 · 입고" count={view.rawLots.length}>
            {view.rawLots.length === 0 ? (
              <Empty>이 추적 범위에 원자재 LOT 가 없습니다.</Empty>
            ) : (
              <div className="space-y-2">
                {view.rawLots.map((lot) => {
                  const po = view.incoming(lot.nodeId, "RECEIVED_AS")[0]
                  const supplier = po?.node ? view.incoming(po.node.id, "SUPPLIES")[0]?.node : null
                  return (
                    <div key={lot.lotId} className="rounded-lg border p-3 text-[14px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[15px] font-semibold">{lot.lotNo}</span>
                        <span className="text-slate-600">{lot.item.code} · {lot.item.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px]">{STATUS_LABEL[lot.status] ?? lot.status}</span>
                      </div>
                      <div className="mt-1 text-slate-700">
                        {supplier ? (
                          <>공급사 <b>{supplier.label}</b> ({supplier.code})</>
                        ) : (
                          <span className="text-amber-700">공급사 정보 없음(발주 연결 입고 이력 없음)</span>
                        )}
                        {po?.node && (
                          <> · 발주 {po.node.code} · 입고 {formatQuantity(po.edge.qty ?? 0)} · {fmtDate(po.node.date)}</>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Block>

          <Block title="작업지시 · 공정 · 설비 · 작업자 · 품질" count={trace.workOrders.length}>
            {trace.workOrders.length === 0 ? (
              <Empty>연결된 작업지시가 없습니다.</Empty>
            ) : (
              <div className="space-y-4">
                {trace.workOrders.map((wo) => (
                  <div key={wo.workOrderId} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[14px]">
                      <span className="text-[16px] font-semibold">{wo.orderNo}</span>
                      {wo.manufacturingNo && <span className="font-mono text-blue-700">{wo.manufacturingNo}</span>}
                      <span className="text-slate-600">{wo.item ? `${wo.item.code} · ${wo.item.name}` : ""}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px]">{wo.status}</span>
                      {wo.plan && <span className="text-[13px] text-slate-500">생산계획 {wo.plan.planNo}</span>}
                    </div>
                    {wo.operations.length === 0 ? (
                      <p className="mt-2 text-[14px] text-amber-700">공정 이력이 없습니다.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {wo.operations.map((op) => (
                          <div key={op.seq} className="rounded-md bg-slate-50 p-3 text-[14px]">
                            <div className="flex flex-wrap items-center gap-2">
                              <b>{op.seq}. {op.name}</b>
                              <span className="text-[13px] text-slate-500">{op.status} · 완료 {formatQuantity(op.completedQty)}</span>
                              <span className="text-slate-700">
                                설비: {op.equipment.length > 0 ? op.equipment.map((e) => `${e.name}(${e.code})`).join(", ") : <span className="text-amber-700">없음</span>}
                              </span>
                            </div>
                            {op.results.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 text-slate-700">
                                {op.results.map((r, i) => (
                                  <li key={i}>
                                    실적 양품 {formatQuantity(r.goodQty)} / 불량 {formatQuantity(r.defectQty)} / 재작업 {formatQuantity(r.reworkQty)}
                                    {" · "}작업자 {r.operator?.name ?? <span className="text-amber-700">없음</span>}
                                    {r.equipment && <> · {r.equipment.name}</>}
                                    {" · "}{fmtDate(r.endedAt ?? r.startedAt)}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {op.inspections.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 text-slate-700">
                                {op.inspections.map((ins) => (
                                  <li key={ins.id}>
                                    검사 {ins.stage} · {ins.result ? RESULT_LABEL[ins.result] ?? ins.result : "미판정"} · 검사수량 {formatQuantity(ins.inspectedQty)}
                                    {" · "}{ins.inspector?.name ?? "-"} · {fmtDate(ins.inspectedAt)}
                                    {ins.attribution === "WORK_ORDER" && <span className="text-[13px] text-slate-500"> (작업지시 단위)</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Block>

          <Block title="완제품 LOT · 출하 · 고객" count={view.finishedLots.length}>
            {view.finishedLots.length === 0 && view.semiLots.length === 0 ? (
              <Empty>이 추적 범위에 완제품 LOT 가 없습니다.</Empty>
            ) : (
              <div className="space-y-2">
                {[...view.semiLots, ...view.finishedLots].map((lot) => {
                  const shipped = view.outgoing(lot.nodeId, "SHIPPED_IN")
                  return (
                    <div key={lot.lotId} className="rounded-lg border p-3 text-[14px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[15px] font-semibold">{lot.lotNo}</span>
                        <span className="text-slate-600">{lot.item.code} · {lot.item.name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px]">{STATUS_LABEL[lot.status] ?? lot.status}</span>
                      </div>
                      {shipped.length === 0 ? (
                        <p className="mt-1 text-slate-500">출하 이력 없음(미출하)</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {shipped.map(({ edge, node }) => {
                            const customer = node ? view.outgoing(node.id, "DELIVERED_TO")[0]?.node : null
                            return (
                              <li key={edge.to} className="text-slate-700">
                                출하 <b>{node?.code}</b> · {formatQuantity(edge.qty ?? 0)} · {fmtDate(node?.date)}
                                {" · "}고객 <b>{customer?.label ?? "-"}</b>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Block>

          {trace.missing.length > 0 && (
            <Block title="확인되지 않은 구간 (데이터 없음)" count={trace.missing.length}>
              <ul className="space-y-1 text-[14px] text-amber-900">
                {trace.missing.map((m, i) => (
                  <li key={`${m.code}-${m.ref}-${i}`} className="rounded-md bg-amber-50 px-3 py-2">
                    {m.message}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-slate-500">
                누락 구간은 추적 결과를 중단시키지 않고 표시만 합니다. 마스터/실적 데이터가 입력되면 자동으로 연결됩니다.
              </p>
            </Block>
          )}
        </>
      )}
    </div>
  )
}
