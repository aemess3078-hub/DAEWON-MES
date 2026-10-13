"use client"

import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EyeOff } from "lucide-react"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { getBackupGroupDetail, deleteBackupGroup, hideBackup, type BackupGroupDetail, type BackupManagementData } from "@/lib/actions/backup.actions"
import { backupStatusLabel, backupTypeLabel, formatBackupDateTimeKst } from "@/lib/actions/backup.helpers"
import { BackupGroupFormSheet } from "./backup-group-form-sheet"

function statusBadgeClass(status: string | null): string {
  if (status === "COMPLETED") return "bg-green-100 text-green-800"
  if (status === "FAILED") return "bg-red-100 text-red-700"
  if (status === "PENDING") return "bg-blue-100 text-blue-700"
  return "bg-slate-100 text-slate-700"
}

interface BackupGroupDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string | null
  visibleBackups: BackupManagementData["visibleBackups"]
  onChanged: () => void
}

export function BackupGroupDetailSheet({ open, onOpenChange, groupId, visibleBackups, onChanged }: BackupGroupDetailSheetProps) {
  const role = useUserRole()
  const canMutate = role !== "VIEWER"

  const [detail, setDetail] = useState<BackupGroupDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    if (!open || !groupId) return
    setLoading(true)
    getBackupGroupDetail(groupId)
      .then(setDetail)
      .finally(() => setLoading(false))
  }, [open, groupId])

  if (!open || !groupId) return null

  async function handleDeleteGroup() {
    if (!confirm("이 백업 분류를 삭제하시겠습니까? 분류만 삭제되며 실제 백업은 삭제되지 않습니다.")) return
    const res = await deleteBackupGroup(groupId!)
    if (!res.ok) {
      alert(res.error ?? "삭제 중 오류가 발생했습니다.")
      return
    }
    onChanged()
    onOpenChange(false)
  }

  async function handleHideMember(externalBackupId: string) {
    if (!confirm("이 백업을 화면 목록에서 숨기시겠습니까? 실제 백업은 삭제되지 않습니다.")) return
    const res = await hideBackup(externalBackupId)
    if (!res.ok) {
      alert(res.error ?? "처리 중 오류가 발생했습니다.")
      return
    }
    const refreshed = await getBackupGroupDetail(groupId!)
    setDetail(refreshed)
    onChanged()
  }

  function handleEditSaved() {
    onChanged()
    onOpenChange(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>백업 분류 상세</SheetTitle>
            <SheetDescription>백업 분류에 포함된 백업 목록을 확인합니다. 실제 백업은 변경되지 않습니다.</SheetDescription>
          </SheetHeader>

          {loading && <p className="text-[14px] text-muted-foreground pt-4">불러오는 중...</p>}

          {!loading && detail && (
            <div className="space-y-5 pt-4">
              <div>
                <p className="text-[13px] text-muted-foreground">분류명</p>
                <p className="text-[16px] font-medium">{detail.name}</p>
              </div>
              {detail.description && (
                <div>
                  <p className="text-[13px] text-muted-foreground">설명</p>
                  <p className="text-[14px]">{detail.description}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-muted-foreground">
                  포함 백업 ({detail.members.length}건)
                </p>
                {detail.members.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">포함된 백업이 없습니다.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.members.map((m) => (
                      <li key={m.externalBackupId} className="flex items-center justify-between gap-2 text-[13px] border-b last:border-0 pb-1.5 last:pb-0">
                        <div className="min-w-0">
                          <p className="whitespace-nowrap">
                            {m.insertedAt ? formatBackupDateTimeKst(m.insertedAt) : <span className="text-muted-foreground">확인 불가(현재 목록에 없음)</span>}
                            {m.hidden && <Badge className="ml-1.5 border-0 text-[10px] bg-slate-100 text-slate-600">숨김</Badge>}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            <Badge className={`mr-1.5 border-0 text-[10px] ${statusBadgeClass(m.status)}`}>{backupStatusLabel(m.status)}</Badge>
                            {backupTypeLabel(m.isPhysicalBackup)}
                          </p>
                        </div>
                        {canMutate && !m.hidden && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-600 hover:bg-slate-50 shrink-0" onClick={() => handleHideMember(m.externalBackupId)} title="목록에서 숨기기">
                            <EyeOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="text-[12px] text-muted-foreground">
                등록: {detail.createdByName} · 최종수정: {detail.updatedByName} ({formatBackupDateTimeKst(detail.updatedAt)})
              </div>
            </div>
          )}

          <SheetFooter className="pt-4 flex-row justify-between sm:justify-between">
            {canMutate ? (
              <div className="flex gap-2">
                <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={handleDeleteGroup}>분류 삭제</Button>
                <Button variant="outline" onClick={() => setEditOpen(true)}>수정</Button>
              </div>
            ) : (
              <div />
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <BackupGroupFormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        groupId={groupId}
        visibleBackups={visibleBackups}
        onSaved={handleEditSaved}
      />
    </>
  )
}
