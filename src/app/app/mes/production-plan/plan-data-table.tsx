"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { PlanFormSheet } from "./plan-form-sheet"
import { PlanDetailSheet } from "./plan-detail-sheet"
import { cancelProductionPlan, deletePlan, PlanWithDetails } from "@/lib/actions/production-plan.actions"
import type { ResourcePermissionFlags } from "@/lib/auth/role-permissions"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

interface PlanDataTableProps {
  data: PlanWithDetails[]
  sites: { id: string; code: string; name: string; type: string }[]
  items: { id: string; code: string; name: string; itemType: string }[]
  tenantId: string
  permissions: ResourcePermissionFlags
  initialSalesOrderId?: string
}

export function PlanDataTable({ data, sites, items, tenantId, permissions, initialSalesOrderId }: PlanDataTableProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit">("create")
  const [editingPlan, setEditingPlan] = useState<PlanWithDetails | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailPlan, setDetailPlan] = useState<PlanWithDetails | null>(null)
  const [cancelPlanTarget, setCancelPlanTarget] = useState<PlanWithDetails | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const visibleData = useMemo(() => {
    if (!initialSalesOrderId) return data
    return data.filter((plan) =>
      plan.items.some((item) => item.salesOrderItem?.salesOrder.id === initialSalesOrderId)
    )
  }, [data, initialSalesOrderId])
  const contextSalesOrderNo = useMemo(() => {
    if (!initialSalesOrderId) return null
    for (const plan of visibleData) {
      const linkedItem = plan.items.find(
        (item) => item.salesOrderItem?.salesOrder.id === initialSalesOrderId
      )
      if (linkedItem?.salesOrderItem?.salesOrder.orderNo) {
        return linkedItem.salesOrderItem.salesOrder.orderNo
      }
    }
    return null
  }, [initialSalesOrderId, visibleData])

  const handleEdit = (plan: PlanWithDetails) => {
    setEditingPlan(plan)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleDelete = async (plan: PlanWithDetails) => {
    if (plan.status !== "DRAFT") {
      alert(
        `'${plan.status}' 상태의 생산계획은 삭제할 수 없습니다.\nDRAFT 상태만 삭제 가능합니다.`
      )
      return
    }

    if (!confirm(`'${plan.planNo}' 생산계획을 삭제하시겠습니까?`)) return

    try {
      await deletePlan(plan.id)
      router.refresh()
    } catch (error) {
      console.error("삭제 실패:", error)
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const handleViewDetail = (plan: PlanWithDetails) => {
    setDetailPlan(plan)
    setDetailOpen(true)
  }

  const handleOpenCancel = (plan: PlanWithDetails) => {
    setCancelPlanTarget(plan)
    setCancelReason("")
    setCancelError(null)
  }

  const handleCancelPlan = async () => {
    if (!cancelPlanTarget) return
    const reason = cancelReason.trim()
    if (!reason) {
      setCancelError("취소사유를 입력하세요.")
      return
    }
    setCancelSubmitting(true)
    setCancelError(null)
    try {
      await cancelProductionPlan(cancelPlanTarget.id, reason)
      setCancelPlanTarget(null)
      setCancelReason("")
      router.refresh()
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "생산계획 취소 중 오류가 발생했습니다.")
    } finally {
      setCancelSubmitting(false)
    }
  }

  const columns = getColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onCancel: handleOpenCancel,
    onViewDetail: handleViewDetail,
    canUpdate: permissions.canUpdate,
    canDelete: permissions.canDelete,
  })

  const filterableColumns = [
    {
      id: "status" as keyof PlanWithDetails,
      title: "상태",
      options: [
        { label: "초안", value: "DRAFT" },
        { label: "확정", value: "CONFIRMED" },
        { label: "진행중", value: "IN_PROGRESS" },
        { label: "완료", value: "COMPLETED" },
        { label: "취소", value: "CANCELLED" },
      ],
    },
    {
      id: "planType" as keyof PlanWithDetails,
      title: "계획유형",
      options: [
        { label: "일간", value: "DAILY" },
        { label: "주간", value: "WEEKLY" },
        { label: "월간", value: "MONTHLY" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {permissions.canCreate && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setEditingPlan(null)
              setFormMode("create")
              setFormOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            생산계획 등록
          </Button>
        </div>
      )}

      {initialSalesOrderId && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[14px] text-blue-800">
          <span>
            {contextSalesOrderNo
              ? `${contextSalesOrderNo} 수주에서 연결된 생산계획 ${visibleData.length}건을 표시합니다.`
              : "전달된 수주와 연결된 생산계획을 찾지 못했습니다."}
          </span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/production-plan">전체 보기</Link>
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={visibleData}
        searchableColumns={[
          { id: "planNo" as keyof PlanWithDetails, title: "계획번호 검색..." },
        ]}
        filterableColumns={filterableColumns}
      />

      <PlanFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        plan={editingPlan}
        sites={sites}
        items={items}
        tenantId={tenantId}
      />


      <Dialog open={cancelPlanTarget != null} onOpenChange={(open) => { if (!open && !cancelSubmitting) setCancelPlanTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>생산계획 취소</DialogTitle>
            <DialogDescription>
              {cancelPlanTarget ? `'${cancelPlanTarget.planNo}' 생산계획을 취소합니다. 취소사유는 AuditLog에 기록됩니다.` : "생산계획을 취소합니다."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="취소사유를 입력하세요."
              disabled={cancelSubmitting}
            />
            {cancelError ? <p className="text-[13px] text-red-600">{cancelError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelPlanTarget(null)} disabled={cancelSubmitting}>닫기</Button>
            <Button variant="destructive" onClick={handleCancelPlan} disabled={cancelSubmitting}>
              {cancelSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              취소 확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlanDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        plan={detailPlan}
      />
    </div>
  )
}
