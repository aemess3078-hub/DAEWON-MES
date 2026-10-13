"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { Pencil, Trash2, XCircle, CheckCircle2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { canCompleteMaterialReturn } from "@/lib/material-return-status"
import {
  getMaterialReturnDetail,
  deleteMaterialReturn,
  cancelMaterialReturn,
  completeMaterialReturn,
  type MaterialReturnDetail,
} from "@/lib/actions/material-return.actions"
import { RETURN_STATUS_CONFIG } from "./columns"
import { ReturnFormDialog } from "./return-form-dialog"
import { formatQuantity } from "@/lib/utils"

interface MaterialReturnDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnId: string | null
  onChanged?: () => void
}

function fmtDateTime(d: Date | string | null): string {
  return d ? format(new Date(d), "yyyy-MM-dd HH:mm") : "—"
}

export function MaterialReturnDetailSheet({ open, onOpenChange, returnId, onChanged }: MaterialReturnDetailSheetProps) {
  const role = useUserRole()
  const canOperate = role !== "VIEWER"
  const canComplete = canCompleteMaterialReturn(role)

  const [isLoading, setIsLoading] = useState(false)
  const [materialReturn, setMaterialReturn] = useState<MaterialReturnDetail | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const refetch = useCallback(() => {
    if (!returnId) return
    setIsLoading(true)
    getMaterialReturnDetail(returnId)
      .then(setMaterialReturn)
      .catch((e) => alert(e instanceof Error ? e.message : "정보를 불러오지 못했습니다."))
      .finally(() => setIsLoading(false))
  }, [returnId])

  useEffect(() => {
    if (open && returnId) {
      refetch()
    } else if (!open) {
      setMaterialReturn(null)
    }
  }, [open, returnId, refetch])

  const handleDelete = async () => {
    if (!materialReturn) return
    if (!confirm(`'${materialReturn.returnNo}' 반품 건을 삭제하시겠습니까?`)) return
    setIsPending(true)
    try {
      const result = await deleteMaterialReturn(materialReturn.id)
      if (!result.ok) {
        alert(result.error ?? "삭제 중 오류가 발생했습니다.")
        return
      }
      onChanged?.()
      onOpenChange(false)
    } finally {
      setIsPending(false)
    }
  }

  const handleCancel = async () => {
    if (!materialReturn) return
    if (!confirm(`'${materialReturn.returnNo}' 반품 건을 취소하시겠습니까?`)) return
    setIsPending(true)
    try {
      const result = await cancelMaterialReturn(materialReturn.id)
      if (!result.ok) {
        alert(result.error ?? "취소 중 오류가 발생했습니다.")
        return
      }
      refetch()
      onChanged?.()
    } finally {
      setIsPending(false)
    }
  }

  const handleComplete = async () => {
    if (!materialReturn) return
    if (!confirm(`'${materialReturn.returnNo}' 반품을 완료 처리하시겠습니까?\n완료 즉시 재고가 차감되며 이후 수정/취소할 수 없습니다.`)) return
    setIsPending(true)
    try {
      const result = await completeMaterialReturn(materialReturn.id)
      if (!result.ok) {
        alert(result.error ?? "반품완료 처리 중 오류가 발생했습니다.")
        return
      }
      refetch()
      onChanged?.()
    } finally {
      setIsPending(false)
    }
  }

  if (!returnId) return null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          {isLoading && !materialReturn ? (
            <p className="text-[14px] text-muted-foreground py-8 text-center">불러오는 중...</p>
          ) : materialReturn ? (
            <>
              <SheetHeader className="pb-6 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <SheetTitle className="text-[20px] font-semibold font-mono">{materialReturn.returnNo}</SheetTitle>
                    <p className="text-[15px] text-muted-foreground font-medium">{materialReturn.supplier.name}</p>
                  </div>
                  <Badge variant={RETURN_STATUS_CONFIG[materialReturn.status].variant} className="text-[12px] mt-1">
                    {RETURN_STATUS_CONFIG[materialReturn.status].label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-3">
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">발주</p>
                    <p className="text-[14px] font-medium font-mono">{materialReturn.purchaseOrder?.orderNo ?? "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">사업장</p>
                    <p className="text-[14px] font-medium">{materialReturn.site.name}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">반품사유</p>
                    <p className="text-[14px] font-medium">{materialReturn.reason ?? "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">등록자 / 등록일</p>
                    <p className="text-[14px] font-medium">{materialReturn.createdBy.name} · {fmtDateTime(materialReturn.createdAt)}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide">완료자 / 완료일</p>
                    <p className="text-[14px] font-medium">
                      {materialReturn.completedBy ? `${materialReturn.completedBy.name} · ${fmtDateTime(materialReturn.completedAt)}` : "—"}
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="pt-6 space-y-5">
                <div className="space-y-1.5">
                  <p className="text-[13px] font-semibold text-muted-foreground">반품 품목 ({materialReturn.items.length}건 · 총 {formatQuantity(materialReturn.totalReturnQty)})</p>
                  <div className="rounded-lg border divide-y">
                    {materialReturn.items.map((it) => (
                      <div key={it.id} className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[14px] font-medium">[{it.item.code}] {it.item.name}</p>
                          <p className="text-[14px] font-semibold tabular-nums text-red-600">-{formatQuantity(it.returnQty)} {it.item.uom}</p>
                        </div>
                        <div className="flex flex-wrap gap-x-4 text-[12px] text-muted-foreground">
                          <span>창고: {it.warehouse.name}</span>
                          {it.lot && <span>LOT: {it.lot.lotNo}</span>}
                          {it.purchaseOrderItem && <span>발주: {it.purchaseOrderItem.purchaseOrderNo}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {materialReturn.note && (
                  <div className="space-y-1.5">
                    <p className="text-[13px] font-semibold text-muted-foreground">비고</p>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2.5">
                      {materialReturn.note}
                    </p>
                  </div>
                )}

                {materialReturn.status === "COMPLETED" && (
                  <p className="text-[13px] text-muted-foreground">반품완료 건은 읽기 전용입니다. 실제 재고가 차감되었습니다.</p>
                )}
                {materialReturn.status === "CANCELLED" && (
                  <p className="text-[13px] text-muted-foreground">취소된 반품 건입니다.</p>
                )}

                {materialReturn.status === "DRAFT" && canOperate && (
                  <div className="flex items-center gap-2 pt-2 border-t">
                    {canComplete && (
                      <Button size="sm" disabled={isPending} onClick={handleComplete} className="gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        반품완료
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => setEditOpen(true)} className="gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      수정
                    </Button>
                    <Button size="sm" variant="outline" disabled={isPending} onClick={handleCancel} className="gap-1.5">
                      <XCircle className="h-3.5 w-3.5" />
                      취소
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      disabled={isPending}
                      onClick={handleDelete}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      삭제
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-[14px] text-muted-foreground py-8 text-center">반품 건을 찾을 수 없습니다.</p>
          )}
        </SheetContent>
      </Sheet>

      <ReturnFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        materialReturn={materialReturn}
        onSuccess={() => {
          setEditOpen(false)
          refetch()
          onChanged?.()
        }}
      />
    </>
  )
}
