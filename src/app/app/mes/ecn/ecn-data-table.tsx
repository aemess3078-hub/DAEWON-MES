"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table/data-table"
import { getColumns } from "./columns"
import { ECNFormSheet } from "./ecn-form-sheet"
import {
  ECNWithDetails,
  deleteECN,
  submitECN,
  approveECN,
  rejectECN,
  implementECN,
} from "@/lib/actions/ecn.actions"
import type { UserRole } from "@prisma/client"

// ─── 확장 패널: 변경 이유, 비고, 상세 항목 ────────────────────────────────────

const CHANGE_TYPE_LABEL: Record<string, string> = {
  BOM: "BOM 변경", ROUTING: "라우팅 변경", BOTH: "BOM + 라우팅 변경",
}
const ACTION_TYPE_LABEL: Record<string, string> = {
  ADD: "추가", MODIFY: "수정", DELETE: "삭제",
}

function ECNExpandedPanel({ ecn }: { ecn: ECNWithDetails }) {
  return (
    <div className="px-6 py-4 space-y-5 bg-slate-50/60 border-t">
      {/* 기본 정보 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[13px]">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">변경 구분</p>
          <p className="font-medium">{CHANGE_TYPE_LABEL[ecn.changeType] ?? ecn.changeType}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">요청자</p>
          <p className="font-medium">{ecn.requester.name}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">승인자</p>
          <p className="font-medium">{ecn.approver?.name ?? "—"}</p>
        </div>
      </div>

      {/* 변경 이유 */}
      {ecn.reason && (
        <div>
          <p className="text-[12px] font-semibold text-muted-foreground mb-1">변경 이유</p>
          <p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap rounded-lg bg-white border px-3 py-2">
            {ecn.reason}
          </p>
        </div>
      )}

      {/* 비고 */}
      {ecn.note && (
        <div>
          <p className="text-[12px] font-semibold text-muted-foreground mb-1">비고</p>
          <p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap rounded-lg bg-white border px-3 py-2">
            {ecn.note}
          </p>
        </div>
      )}

      {/* 변경 항목 목록 */}
      <div>
        <p className="text-[13px] font-semibold mb-2">
          변경 항목 ({ecn.details.length}건)
        </p>
        {ecn.details.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-4 text-center border rounded-lg bg-white">
            등록된 변경 항목이 없습니다.
          </p>
        ) : (
          <div className="space-y-2">
            {ecn.details.map((d, i) => (
              <div key={d.id ?? i} className="rounded-lg border bg-white px-4 py-3 text-[13px]">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-[11px]">
                    {ACTION_TYPE_LABEL[d.actionType] ?? d.actionType}
                  </Badge>
                  <span className="font-medium">{d.changeTarget}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {d.beforeValue !== null && d.beforeValue !== undefined && (
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-0.5">변경 전</p>
                      <p className="font-mono text-[12px] bg-red-50 rounded px-2 py-1">
                        {typeof d.beforeValue === "object"
                          ? JSON.stringify(d.beforeValue, null, 2)
                          : String(d.beforeValue)}
                      </p>
                    </div>
                  )}
                  {d.afterValue !== null && d.afterValue !== undefined && (
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-0.5">변경 후</p>
                      <p className="font-mono text-[12px] bg-green-50 rounded px-2 py-1">
                        {typeof d.afterValue === "object"
                          ? JSON.stringify(d.afterValue, null, 2)
                          : String(d.afterValue)}
                      </p>
                    </div>
                  )}
                </div>
                {d.description && (
                  <p className="mt-2 text-[12px] text-muted-foreground">{d.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  ecns: ECNWithDetails[]
  items: { id: string; code: string; name: string; itemType: string }[]
  tenantId: string
  userId: string
  userRole: UserRole
  isAdmin: boolean
}

export function ECNDataTable({ ecns, items, tenantId, userId, userRole, isAdmin }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<"create" | "edit">("create")
  const [editingECN, setEditingECN] = useState<ECNWithDetails | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const canCreate = userRole !== "VIEWER"

  const handleEdit = (ecn: ECNWithDetails) => {
    setEditingECN(ecn)
    setFormMode("edit")
    setFormOpen(true)
  }

  const handleDelete = async (ecn: ECNWithDetails) => {
    if (!confirm(`'${ecn.ecnNo}' ECN을 삭제하시겠습니까?`)) return
    try {
      await deleteECN(ecn.id)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleSubmit = async (ecn: ECNWithDetails) => {
    if (!confirm(`'${ecn.ecnNo}'을 검토 제출하시겠습니까?`)) return
    try {
      await submitECN(ecn.id)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleApprove = async (ecn: ECNWithDetails) => {
    if (!confirm(`'${ecn.ecnNo}'을 승인하시겠습니까?`)) return
    try {
      await approveECN(ecn.id, userId)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleReject = async (ecn: ECNWithDetails) => {
    if (!confirm(`'${ecn.ecnNo}'을 반려하시겠습니까?`)) return
    try {
      await rejectECN(ecn.id, userId)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleImplement = async (ecn: ECNWithDetails) => {
    if (!confirm(`'${ecn.ecnNo}'을 실제 BOM/라우팅에 적용하시겠습니까?\n\n기존 ACTIVE BOM/라우팅이 INACTIVE로 변경되고 새 버전이 생성됩니다.`)) return
    try {
      await implementECN(ecn.id)
      router.refresh()
      alert("적용이 완료되었습니다.")
    } catch (e: any) {
      alert(e.message)
    }
  }

  const columns = getColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    onSubmit: handleSubmit,
    onApprove: handleApprove,
    onReject: handleReject,
    onImplement: handleImplement,
    isAdmin,
    userId,
    userRole,
  })

  return (
    <div className="space-y-4">
      {canCreate && <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditingECN(null)
            setFormMode("create")
            setFormOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          ECN 등록
        </Button>
      </div>}

      <DataTable
        columns={columns}
        data={ecns}
        getRowId={(row) => row.id}
        expandOnRowClick
        expandedRowId={expandedRowId}
        onExpandedRowIdChange={setExpandedRowId}
        renderExpandedRow={(row) => <ECNExpandedPanel ecn={row} />}
        searchableColumns={[{ id: "title" as keyof ECNWithDetails & string, title: "제목" }]}
        filterableColumns={[
          {
            id: "status" as keyof ECNWithDetails & string,
            title: "상태",
            options: [
              { label: "초안", value: "DRAFT" },
              { label: "제출됨", value: "SUBMITTED" },
              { label: "검토중", value: "REVIEWING" },
              { label: "승인됨", value: "APPROVED" },
              { label: "반려됨", value: "REJECTED" },
              { label: "적용완료", value: "IMPLEMENTED" },
              { label: "취소됨", value: "CANCELLED" },
            ],
          },
          {
            id: "changeType" as keyof ECNWithDetails & string,
            title: "변경유형",
            options: [
              { label: "BOM", value: "BOM" },
              { label: "라우팅", value: "ROUTING" },
              { label: "BOM+라우팅", value: "BOTH" },
            ],
          },
        ]}
      />

      <ECNFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        editingECN={editingECN}
        items={items}
        tenantId={tenantId}
        userId={userId}
      />
    </div>
  )
}
