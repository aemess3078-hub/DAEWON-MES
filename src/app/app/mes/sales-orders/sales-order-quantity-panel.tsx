"use client"

import { AlertTriangle, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatQuantity } from "@/lib/utils"
import type { OrderItemQuantityView } from "@/lib/production-quantity-model"
import {
  APPROVAL_POLICY_NOTICE,
  APPROVAL_STATUS_LABEL,
  PRODUCTION_KIND_BADGE,
  SHORTAGE_DIFFERENCE_LABEL,
  STOCK_NOT_RESERVED_NOTICE,
  formatRange,
} from "@/lib/production-request-form"

const PLAN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안",
  CONFIRMED: "확정",
  IN_PROGRESS: "진행",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

function Stat({ label, value, sub, testId, tone }: { label: string; value: string; sub?: string; testId: string; tone?: "warn" | "ok" | "muted" }) {
  const color = tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-green-700" : tone === "muted" ? "text-muted-foreground" : "text-foreground"
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={`text-[15px] font-semibold tabular-nums ${color}`} data-testid={testId}>{value}</div>
      {sub ? <div className="text-[13px] text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

/** 2-A 조회 모델을 그대로 보여 주는 수량 현황. 수량을 새로 계산하지 않는다(표시용 문자열 변환만). */
export function SalesOrderQuantityPanel({ items }: { items: OrderItemQuantityView[] }) {
  const q = (v: number) => formatQuantity(v)
  const anyApprovalInfo = items.some((it) => it.lines.some((l) => l.counted && (l.extraQty > 0 || l.approval.status !== "NOT_REQUIRED")))

  return (
    <div className="space-y-3" data-testid="qty-panel">
      <div className="flex items-start gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-[13px] text-blue-800">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span data-testid="qty-no-reservation">{STOCK_NOT_RESERVED_NOTICE}</span>
      </div>

      {items.map((it) => {
        const sh = it.shortage
        const exact = sh.proposed.exact
        const review = formatRange(sh.proposed.shortageMinQty, sh.proposed.shortageMaxQty, exact, q)
        const pend = formatRange(it.pendingAllocatedReceipt.minQty, it.pendingAllocatedReceipt.maxQty, it.pendingAllocatedReceipt.exact, q)
        const codes = sh.differenceCodes.filter((c) => SHORTAGE_DIFFERENCE_LABEL[c])
        const t = (f: string) => `qty-${it.salesOrderItemId}-${f}`
        return (
          <div key={it.salesOrderItemId} className="rounded-lg border p-3 space-y-3" data-testid={`qty-item-${it.salesOrderItemId}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[14px] font-medium">{it.itemName}</span>
                <span className="ml-2 text-[13px] text-muted-foreground font-mono">{it.itemCode} · {it.uom}</span>
              </div>
              {it.shippedQtySourceMismatch && (
                <Badge variant="outline" className="text-[13px] bg-amber-50 text-amber-700 border-amber-200">출하수량 값 불일치</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Stat label="수주 수량" value={q(it.orderedQty)} testId={t("ordered")} />
              <Stat label="출하 완료 수량" value={q(it.shippedQty)} sub="확정된 출하만" testId={t("shipped")} />
              <Stat label="수주 미납 수량" value={q(it.outstandingQty)} testId={t("outstanding")} />
              <Stat label="기존 생산계획 충당" value={q(it.allocatedQty)} sub="취소 계획 제외" testId={t("allocated")} />
              <Stat label="수주 미충당 수량" value={q(it.unallocatedQty)} sub="추가로 충당 가능" testId={t("unallocated")} tone={it.unallocatedQty > 0 ? "warn" : "muted"} />
              <Stat label="미입고 충당 수량" value={pend} sub={it.pendingAllocatedReceipt.exact ? "충당했지만 입고 전" : "구간 · 확정값 아님"} testId={t("pending")} />
              <Stat label="출하 가능 완제품 재고" value={q(it.stock.shippableQty)} sub={`기존 가용재고 ${q(it.stock.legacyAvailableQty)}`} testId={t("shippable")} tone="ok" />
              <Stat label="추가 생산 검토 필요량" value={review} sub={exact ? "검토용 · 자동 적용 안 됨" : "구간 · 검토용 · 자동 적용 안 됨"} testId={t("review")} tone={sh.proposed.shortageMaxQty > 0 ? "warn" : "muted"} />
              <Stat label="여유 생산 수량" value={q(it.extraQty)} sub="기존 계획의 계획−충당" testId={t("extra")} />
              <Stat label="실제 생산계획 수량" value={q(it.plannedQty)} sub={`입고 ${q(it.receivedQty)}`} testId={t("planned")} />
            </div>

            <div className="text-[13px] text-muted-foreground" data-testid={t("legacy")}>
              기존 화면 부족수량(참고): <span className="font-medium text-foreground tabular-nums">{q(sh.legacy.shortageQty)}</span>
              {sh.legacy.shortageQty !== sh.proposed.shortageMaxQty || sh.legacy.shortageQty !== sh.proposed.shortageMinQty ? (
                <span> · 추가 생산 검토 필요량과 다릅니다. 아래 차이 원인을 확인해 주세요.</span>
              ) : (
                <span> · 추가 생산 검토 필요량과 같습니다.</span>
              )}
            </div>

            {codes.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5 text-[13px] text-muted-foreground" data-testid={t("reasons")}>
                {codes.map((c) => (
                  <li key={c} data-code={c}>{SHORTAGE_DIFFERENCE_LABEL[c]}</li>
                ))}
              </ul>
            )}

            {it.stock.competingOrderCount > 0 && (
              <div className="text-[13px] text-muted-foreground" data-testid={t("competing")}>
                같은 품목을 기다리는 다른 수주 {it.stock.competingOrderCount}건, 미납 합계 {q(it.stock.competingOutstandingQty)}
              </div>
            )}

            {it.lines.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-[1.2fr_1fr_70px_70px_70px_70px_70px_1fr] bg-muted/30 border-b text-[13px] text-muted-foreground">
                  {["계획번호", "유형", "충당", "여유", "계획", "입고", "계획 상태", "여유 승인 상태"].map((h, i) => (
                    <div key={h} className={`px-2 py-1.5 ${i >= 2 && i <= 5 ? "text-right" : ""}`}>{h}</div>
                  ))}
                </div>
                {it.lines.map((l) => (
                  <div key={l.planItemId} className="grid grid-cols-[1.2fr_1fr_70px_70px_70px_70px_70px_1fr] items-center border-b last:border-0 text-[13px]" data-testid={`qty-line-${l.planItemId}`}>
                    <div className="px-2 py-1.5 font-mono">{l.planNo}</div>
                    <div className="px-2 py-1.5">{PRODUCTION_KIND_BADGE[l.productionKind] ?? l.productionKind}</div>
                    <div className="px-2 py-1.5 text-right tabular-nums">{q(l.allocatedQty)}</div>
                    <div className="px-2 py-1.5 text-right tabular-nums">{q(l.extraQty)}</div>
                    <div className="px-2 py-1.5 text-right tabular-nums">{q(l.plannedQty)}</div>
                    <div className="px-2 py-1.5 text-right tabular-nums">{q(l.receivedQty)}</div>
                    <div className="px-2 py-1.5">{PLAN_STATUS_LABEL[l.planStatus] ?? l.planStatus}</div>
                    <div className="px-2 py-1.5" data-testid={`qty-approval-${l.planItemId}`}>
                      {l.extraQty > 0 || l.approval.status !== "NOT_REQUIRED" ? (
                        <span className={l.approval.needsAttention ? "text-amber-700 font-medium" : l.approval.approved ? "text-green-700 font-medium" : "text-muted-foreground"}>
                          {APPROVAL_STATUS_LABEL[l.approval.status] ?? l.approval.status}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {anyApprovalInfo && (
        <div className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800" data-testid="qty-approval-notice">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {APPROVAL_POLICY_NOTICE}
        </div>
      )}
    </div>
  )
}
