"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Factory, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatQuantity } from "@/lib/utils"
import { generateReceivingRequestId } from "@/lib/receiving-request-id"
import { requestProductionFromSalesOrder } from "@/lib/actions/sales-order.actions"
import type { OrderItemQuantityView } from "@/lib/production-quantity-model"
import {
  PRODUCTION_REQUEST_BLOCKED_ORDER_STATUSES,
  STOCK_PRODUCTION_GUIDE,
  buildRequestKey,
  createRequestIdKeeper,
  defaultAllocationText,
  evaluateRequestRow,
  type RequestLine,
} from "@/lib/production-request-form"

type RowState = { alloc: string; extra: string; reason: string }

interface Props {
  salesOrderId: string
  orderStatus: string
  tenantId: string
  siteId: string
  items: OrderItemQuantityView[]
  canRequest: boolean
  /** 의뢰 성공 후 화면 수량을 서버 값으로 다시 읽는다 */
  onRequested: () => Promise<void>
}

const NETWORK_UNKNOWN_MESSAGE =
  "응답을 확인하지 못했습니다. 같은 입력으로 다시 누르면 서버가 중복 없이 처리합니다(이미 처리된 경우 그대로 완료로 표시됩니다)."

export function SalesOrderProductionRequestForm({ salesOrderId, orderStatus, tenantId, siteId, items, canRequest, onRequested }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ planNo: string; replayed: boolean } | null>(null)
  const keeper = useRef(createRequestIdKeeper(generateReceivingRequestId)).current
  const inFlight = useRef(false)

  // 서버 수량(items)이 바뀔 때마다 기본값을 다시 채운다: 기본 충당 = 기존 부족수량을 서버 기준 미충당 수량 안으로 자른 값
  useEffect(() => {
    const next: Record<string, RowState> = {}
    for (const it of items) next[it.salesOrderItemId] = { alloc: defaultAllocationText(it.shortage.legacy.shortageQty, it.unallocatedQty), extra: "", reason: "" }
    setRows(next)
  }, [items])

  const blocked = (PRODUCTION_REQUEST_BLOCKED_ORDER_STATUSES as readonly string[]).includes(orderStatus)
  const requestable = items.filter((it) => it.unallocatedQty > 0)

  const evaluations = useMemo(
    () =>
      requestable.map((it) => {
        const r = rows[it.salesOrderItemId] ?? { alloc: "", extra: "", reason: "" }
        return {
          it,
          r,
          ev: evaluateRequestRow({ salesOrderItemId: it.salesOrderItemId, itemId: it.itemId, unallocatedQty: it.unallocatedQty, allocText: r.alloc, extraText: r.extra, reasonText: r.reason }),
        }
      }),
    [requestable, rows]
  )

  const included = evaluations.filter((e) => e.ev.ok && e.ev.included)
  const hasError = evaluations.some((e) => !e.ev.ok)
  const canSubmit = canRequest && !blocked && !busy && !hasError && included.length > 0

  const setField = (id: string, field: keyof RowState, value: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { alloc: "", extra: "", reason: "" }), [field]: value } }))
    setServerError(null)
    setSuccess(null)
  }

  const submit = async () => {
    if (inFlight.current || !canSubmit) return // 더블클릭: 처리 중에는 두 번째 호출을 만들지 않는다
    const lines: RequestLine[] = []
    for (const e of evaluations) if (e.ev.ok && e.ev.included) lines.push(e.ev.line)
    // 같은 입력의 재시도(더블클릭·네트워크 재시도)는 같은 요청 ID, 입력이 바뀌면 새 요청 ID
    const requestId = keeper.idFor(buildRequestKey(salesOrderId, lines))
    inFlight.current = true
    setBusy(true)
    setServerError(null)
    setSuccess(null)
    try {
      const res = await requestProductionFromSalesOrder(
        salesOrderId,
        lines.map((l) => ({ salesOrderItemId: l.salesOrderItemId, itemId: l.itemId, qty: l.qty, extraQty: l.extraQty, extraReason: l.extraReason })),
        tenantId,
        siteId,
        requestId
      )
      if (!res.ok) {
        setServerError(res.error ?? "생산의뢰 중 오류가 발생했습니다.")
        return
      }
      keeper.reset() // 성공 후 다시 의뢰할 때는 새 요청 ID
      setSuccess({ planNo: res.planNo ?? "", replayed: !!res.replayed })
      await onRequested()
    } catch {
      setServerError(NETWORK_UNKNOWN_MESSAGE) // 요청 ID 는 유지한다
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3" data-testid="pr-form">
      <div className="flex items-center gap-2">
        <Factory className="h-4 w-4 text-amber-700" />
        <span className="text-[14px] font-medium text-amber-900">생산의뢰</span>
        <Badge variant="outline" className="text-[13px] bg-amber-100 text-amber-700 border-amber-200">
          수주 충당 + 여유 생산
        </Badge>
      </div>
      <div className="text-[13px] text-amber-800">
        수주 충당 수량과 여유 생산 수량을 직접 입력합니다. 실제 생산계획 수량은 둘의 합이며, 생산계획(초안)이 생성되고 수주 상태가 <strong>생산중</strong>으로 변경됩니다.
        기본 충당 수량은 기존 부족수량(참고값)을 추가 충당 가능량 안으로 맞춘 값이며, 추가 생산 검토 필요량은 자동으로 적용되지 않습니다.
      </div>

      {!canRequest && (
        <div className="rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground" data-testid="pr-no-permission">
          생산의뢰 권한(수주 수정 + 생산계획 등록)이 없어 수량만 조회할 수 있습니다.
        </div>
      )}
      {blocked && (
        <div className="rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground" data-testid="pr-blocked">
          취소·종결되었거나 출하가 완료된 수주는 생산의뢰할 수 없습니다.
        </div>
      )}

      {!blocked && requestable.length === 0 && (
        <div className="text-[13px] text-muted-foreground" data-testid="pr-all-allocated">
          모든 품목이 이미 생산계획에 충당되어 추가로 충당할 수량이 없습니다. 수주보다 더 생산해야 한다면 생산계획 화면에서 기존 계획의 여유 생산을 조정하거나 재고 생산 계획을 등록해 주세요.
        </div>
      )}

      {!blocked &&
        evaluations.map(({ it, r, ev }) => {
          const errors = !ev.ok ? ev.errors : {}
          const touched = r.alloc.trim() !== "" || r.extra.trim() !== "" || r.reason.trim() !== ""
          const plan = ev.ok && ev.included ? ev : null
          const id = it.salesOrderItemId
          return (
            <div key={id} className="rounded-md border bg-white p-3 space-y-2" data-testid={`pr-row-${id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-medium">
                  {it.itemName} <span className="text-[13px] text-muted-foreground font-mono">{it.itemCode} · {it.uom}</span>
                </span>
                <span className="text-[13px] text-muted-foreground">
                  수주 {formatQuantity(it.orderedQty)} · 기존 충당 {formatQuantity(it.allocatedQty)} ·{" "}
                  <span className="font-medium text-foreground" data-testid={`pr-max-${id}`}>추가 충당 가능 {formatQuantity(it.unallocatedQty)}</span>
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr] gap-3">
                <label className="space-y-1">
                  <span className="text-[13px] text-muted-foreground">수주 충당 수량 ({it.uom})</span>
                  <Input
                    inputMode="decimal"
                    className="text-[14px]"
                    value={r.alloc}
                    placeholder="0"
                    disabled={busy || !canRequest}
                    onChange={(e) => setField(id, "alloc", e.target.value)}
                    data-testid={`pr-alloc-${id}`}
                    aria-invalid={!!errors.alloc}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[13px] text-muted-foreground">여유 생산 수량 ({it.uom})</span>
                  <Input
                    inputMode="decimal"
                    className="text-[14px]"
                    value={r.extra}
                    placeholder="0"
                    disabled={busy || !canRequest}
                    onChange={(e) => setField(id, "extra", e.target.value)}
                    data-testid={`pr-extra-${id}`}
                    aria-invalid={!!errors.extra}
                  />
                </label>
                <div className="space-y-1">
                  <span className="text-[13px] text-muted-foreground">실제 생산계획 수량 · 유형</span>
                  <div className="flex items-center gap-2 h-9">
                    <span className="text-[15px] font-semibold tabular-nums" data-testid={`pr-planned-${id}`}>
                      {plan ? formatQuantity(plan.plannedQty) : "—"}
                    </span>
                    {plan && (
                      <Badge variant="outline" className="text-[13px]" data-testid={`pr-kind-${id}`}>
                        {plan.kind === "ORDER_EXTRA" ? "수주+여유 생산 (ORDER_EXTRA)" : "수주 생산 (ORDER)"}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {r.extra.trim() !== "" && r.extra.trim() !== "0" && (
                <label className="block space-y-1">
                  <span className="text-[13px] text-muted-foreground">여유 생산 사유 (필수)</span>
                  <Input
                    className="text-[14px]"
                    value={r.reason}
                    maxLength={500}
                    placeholder="예: 가공 불량 대비"
                    disabled={busy || !canRequest}
                    onChange={(e) => setField(id, "reason", e.target.value)}
                    data-testid={`pr-reason-${id}`}
                    aria-invalid={!!errors.reason}
                  />
                </label>
              )}
              {touched && (errors.alloc || errors.extra || errors.reason) && (
                <ul className="text-[13px] text-red-600 space-y-0.5" data-testid={`pr-errors-${id}`}>
                  {[errors.alloc, errors.extra, errors.reason].filter(Boolean).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}

      {!blocked && requestable.length > 0 && (
        <p className="text-[13px] text-muted-foreground">{STOCK_PRODUCTION_GUIDE}{" "}
          <Link href="/app/mes/production-plan" className="underline">생산계획 화면</Link>
        </p>
      )}

      {serverError && (
        <div role="alert" className="flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[13px] text-red-700" data-testid="pr-error">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {serverError}
        </div>
      )}
      {success && (
        <div role="status" className="flex items-start gap-1.5 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-[13px] text-green-800" data-testid="pr-success">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            생산계획 <strong data-testid="pr-success-planno">{success.planNo}</strong> 이(가) {success.replayed ? "이미 생성되어 있습니다(중복 생성 없음)." : "생성되었습니다."}{" "}
            <Link href={`/app/mes/production-plan?salesOrderId=${encodeURIComponent(salesOrderId)}`} className="underline">생산계획 보기</Link>
          </span>
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-amber-400 text-amber-900 hover:bg-amber-100"
        onClick={submit}
        disabled={!canSubmit}
        data-testid="pr-submit"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Factory className="h-3.5 w-3.5" />}
        생산의뢰 생성
      </Button>
    </div>
  )
}
