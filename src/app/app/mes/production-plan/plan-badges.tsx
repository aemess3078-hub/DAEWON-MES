"use client"

import { Badge } from "@/components/ui/badge"
import {
  APPROVAL_STATUS_LABEL_KO,
  PRODUCTION_KIND_LABEL_KO,
  type ProductionKindOrMixed,
} from "@/lib/production-plan-form"

const KIND_STYLE: Record<ProductionKindOrMixed, string> = {
  ORDER: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50",
  ORDER_EXTRA: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-50",
  STOCK: "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100",
  MIXED: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-50",
}

/** 생산 유형 배지 (한글 명칭, 혼합 포함) */
export function PlanKindBadge({ kind, testId }: { kind: ProductionKindOrMixed | string; testId?: string }) {
  const k = (kind in KIND_STYLE ? kind : "STOCK") as ProductionKindOrMixed
  return (
    <Badge variant="outline" className={`text-[13px] whitespace-nowrap ${KIND_STYLE[k]}`} data-testid={testId} data-kind={k}>
      {PRODUCTION_KIND_LABEL_KO[k]}
    </Badge>
  )
}

/** 여유 생산 승인 상태(저장된 값 그대로). PENDING 을 승인으로 취급하지 않는다 */
export function ApprovalText({ status, testId }: { status: string; testId?: string }) {
  const color =
    status === "APPROVED" ? "text-green-700 font-medium" : status === "PENDING" || status === "REJECTED" ? "text-amber-700 font-medium" : "text-muted-foreground"
  return (
    <span className={`text-[13px] ${color}`} data-testid={testId} data-status={status}>
      {APPROVAL_STATUS_LABEL_KO[status] ?? status}
    </span>
  )
}
