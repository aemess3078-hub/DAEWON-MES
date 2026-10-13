"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle2, PackageMinus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IssueFormDialog } from "./issue-form-dialog"
import {
  type WarehouseStockOption,
  type WorkOrderForIssue,
} from "@/lib/actions/material-issue.actions"
import { formatQuantity } from "@/lib/utils"

const workOrderStatusConfig: Record<string, { label: string; className: string }> = {
  RELEASED: { label: "릴리즈", className: "border-blue-200 bg-blue-100 text-blue-800" },
  IN_PROGRESS: { label: "진행중", className: "border-amber-200 bg-amber-100 text-amber-800" },
}

interface MaterialIssueTableProps {
  data: WorkOrderForIssue[]
  warehouses: WarehouseStockOption[]
  tenantId: string
  initialWorkOrderId?: string
}

export function MaterialIssueTable({
  data,
  warehouses,
  tenantId,
  initialWorkOrderId,
}: MaterialIssueTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [issuingOrder, setIssuingOrder] = useState<WorkOrderForIssue | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialWorkOrderId) return
    const workOrder = data.find((row) => row.id === initialWorkOrderId)
    if (!workOrder) {
      setContextError("전달된 작업지시가 현재 원자재 출고 대상에 없습니다.")
      return
    }
    setExpandedRows((prev) => new Set(prev).add(workOrder.id))
    if (workOrder.allIssued) {
      setContextError("전달된 작업지시는 이미 원자재 출고가 완료되었습니다.")
      return
    }
    setContextError(null)
    setIssuingOrder(workOrder)
  }, [data, initialWorkOrderId])

  function toggleExpand(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        {initialWorkOrderId && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
            <span>전달된 작업지시가 현재 원자재 출고 대상에 없습니다.</span>
            <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
              <Link href="/app/mes/material-issue">전체 보기</Link>
            </Button>
          </div>
        )}
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-[15px] text-muted-foreground">
            원자재 출고 대상 작업지시가 없습니다.
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            RELEASED 또는 IN_PROGRESS 상태의 작업지시가 표시됩니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      {initialWorkOrderId && (
        <div className={`mb-4 flex items-center justify-between rounded-lg border px-4 py-3 text-[14px] ${
          contextError
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-blue-200 bg-blue-50 text-blue-800"
        }`}>
          <span>{contextError ?? "작업지시 컨텍스트를 유지해 원자재 출고 화면을 열었습니다."}</span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/material-issue">전체 보기</Link>
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[40px_1.2fr_1fr_130px_130px_1fr_140px] border-b bg-muted/30">
          <div className="px-3 py-2.5" />
          <div className="px-3 py-2.5 text-[13px] font-medium text-muted-foreground">작업지시번호</div>
          <div className="px-3 py-2.5 text-[13px] font-medium text-muted-foreground">제조번호</div>
          <div className="px-3 py-2.5 text-right text-[13px] font-medium text-muted-foreground">계획수량</div>
          <div className="px-3 py-2.5 text-[13px] font-medium text-muted-foreground">상태</div>
          <div className="px-3 py-2.5 text-[13px] font-medium text-muted-foreground">원자재 현황</div>
          <div className="px-3 py-2.5 text-right text-[13px] font-medium text-muted-foreground">처리</div>
        </div>

        <div className="divide-y">
          {data.map((workOrder) => {
            const isExpanded = expandedRows.has(workOrder.id)
            const config = workOrderStatusConfig[workOrder.status] ?? { label: workOrder.status, className: "" }
            const pendingCount = workOrder.materials.filter((material) => material.pendingQty > 0).length

            return (
              <div key={workOrder.id}>
                <div className="grid grid-cols-[40px_1.2fr_1fr_130px_130px_1fr_140px] items-center transition-colors hover:bg-muted/20">
                  <button
                    className="flex h-full items-center justify-center px-3 py-3 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => toggleExpand(workOrder.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <div className="px-3 py-3">
                    <span className="font-mono text-[13px] font-medium">{workOrder.orderNo}</span>
                    <div className="mt-0.5 text-[13px] text-muted-foreground">
                      {workOrder.item.name}
                    </div>
                  </div>

                  <div className="px-3 py-3">
                    <span className="font-mono text-[13px] text-blue-700">
                      {workOrder.manufacturingNo ?? "-"}
                    </span>
                  </div>

                  <div className="px-3 py-3 text-right">
                    <span className="text-[14px]">{formatQuantity(workOrder.plannedQty)}</span>
                  </div>

                  <div className="px-3 py-3">
                    <Badge variant="outline" className={`text-[12px] ${config.className}`}>
                      {config.label}
                    </Badge>
                  </div>

                  <div className="px-3 py-3">
                    {workOrder.allIssued ? (
                      <span className="flex items-center gap-1 text-[12px] text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        출고완료
                      </span>
                    ) : (
                      <span className="text-[12px] text-amber-700">
                        {pendingCount}개 품목 대기
                      </span>
                    )}
                  </div>

                  <div className="flex justify-end px-3 py-3">
                    {!workOrder.allIssued && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-[13px]"
                        onClick={() => setIssuingOrder(workOrder)}
                      >
                        <PackageMinus className="h-3.5 w-3.5" />
                        출고처리
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/10 px-4 py-3">
                    {workOrder.materials.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">BOM 원자재 정보가 없습니다.</p>
                    ) : (
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b">
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">소재명</th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">규격</th>
                            <th className="w-16 px-2 py-1.5 text-left font-medium text-muted-foreground">단위</th>
                            <th className="w-24 px-2 py-1.5 text-right font-medium text-muted-foreground">필요수량</th>
                            <th className="w-24 px-2 py-1.5 text-right font-medium text-muted-foreground">출고완료</th>
                            <th className="w-24 px-2 py-1.5 text-right font-medium text-muted-foreground">잔여수량</th>
                            <th className="w-24 px-2 py-1.5 text-right font-medium text-muted-foreground">가용재고</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {workOrder.materials.map((material) => (
                            <tr key={material.itemId} className="hover:bg-muted/20">
                              <td className="px-2 py-1.5">
                                <div>{material.item.name}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  {material.item.code}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">{material.item.spec ?? "-"}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{material.item.uom}</td>
                              <td className="px-2 py-1.5 text-right">{formatQuantity(material.requiredQty)}</td>
                              <td className="px-2 py-1.5 text-right text-muted-foreground">
                                {formatQuantity(material.issuedQty)}
                              </td>
                              <td className={`px-2 py-1.5 text-right font-medium ${material.pendingQty > 0 ? "text-amber-600" : "text-green-600"}`}>
                                {formatQuantity(material.pendingQty)}
                              </td>
                              <td className={`px-2 py-1.5 text-right font-medium ${material.currentStock < material.pendingQty ? "text-red-600" : "text-slate-700"}`}>
                                {formatQuantity(material.currentStock)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <IssueFormDialog
        open={!!issuingOrder}
        onOpenChange={(open) => {
          if (!open) setIssuingOrder(null)
        }}
        workOrder={issuingOrder}
        warehouses={warehouses}
        tenantId={tenantId}
      />
    </>
  )
}
