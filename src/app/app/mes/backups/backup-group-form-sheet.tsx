"use client"

import { useEffect, useMemo, useState } from "react"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  createBackupGroup,
  updateBackupGroup,
  getBackupGroupDetail,
  type BackupManagementData,
} from "@/lib/actions/backup.actions"
import { backupStatusLabel, backupTypeLabel, formatBackupDateTimeKst, sortBackupsByInsertedAtDesc } from "@/lib/actions/backup.helpers"
type PickerRow = {
  externalBackupId: string
  insertedAt: string | null
  status: string | null
  isPhysicalBackup: boolean | null
  hidden: boolean
}

interface BackupGroupFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  groupId?: string | null // edit 모드일 때만 사용
  visibleBackups: BackupManagementData["visibleBackups"]
  onSaved: () => void
}

export function BackupGroupFormSheet({ open, onOpenChange, mode, groupId, visibleBackups, onSaved }: BackupGroupFormSheetProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [extraRows, setExtraRows] = useState<PickerRow[]>([]) // edit 모드에서 이미 포함됐지만 현재 visible 목록엔 없는(숨김 등) 항목
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch("")
    if (mode === "edit" && groupId) {
      setLoading(true)
      getBackupGroupDetail(groupId)
        .then((detail) => {
          if (!detail) return
          setName(detail.name)
          setDescription(detail.description ?? "")
          const memberIds = new Set(detail.members.map((m) => m.externalBackupId))
          setSelectedIds(memberIds)
          const visibleIds = new Set(visibleBackups.map((b) => b.externalBackupId))
          setExtraRows(
            detail.members
              .filter((m) => !visibleIds.has(m.externalBackupId))
              .map((m) => ({
                externalBackupId: m.externalBackupId,
                insertedAt: m.insertedAt,
                status: m.status,
                isPhysicalBackup: m.isPhysicalBackup,
                hidden: m.hidden,
              }))
          )
        })
        .finally(() => setLoading(false))
    } else {
      setName("")
      setDescription("")
      setSelectedIds(new Set())
      setExtraRows([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, groupId])

  const allRows: PickerRow[] = useMemo(() => {
    const visibleRows: PickerRow[] = visibleBackups.map((b) => ({
      externalBackupId: b.externalBackupId,
      insertedAt: b.insertedAt,
      status: b.status,
      isPhysicalBackup: b.isPhysicalBackup,
      hidden: false,
    }))
    return sortBackupsByInsertedAtDesc([...extraRows, ...visibleRows])
  }, [visibleBackups, extraRows])

  const filteredRows = useMemo(() => {
    if (!search.trim()) return allRows
    const q = search.trim().toLowerCase()
    return allRows.filter((r) => (r.insertedAt ?? "").toLowerCase().includes(q) || (r.status ?? "").toLowerCase().includes(q))
  }, [allRows, search])

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetAndClose() {
    setName("")
    setDescription("")
    setSelectedIds(new Set())
    setExtraRows([])
    onOpenChange(false)
  }

  async function handleSubmit() {
    if (!name.trim()) {
      alert("분류명을 입력해 주세요.")
      return
    }
    if (selectedIds.size === 0) {
      alert("백업을 1개 이상 선택해 주세요.")
      return
    }
    setIsSaving(true)
    try {
      const externalBackupIds = Array.from(selectedIds)
      if (mode === "create") {
        await createBackupGroup({ name, description: description || null, externalBackupIds })
      } else if (groupId) {
        await updateBackupGroup(groupId, { name, description: description || null, externalBackupIds })
      }
      onSaved()
      resetAndClose()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={(v) => {
        if (!v) resetAndClose()
        else onOpenChange(v)
      }}
      mode={mode}
      title={mode === "create" ? "분류 만들기" : "분류 수정"}
      description="이 백업 분류는 화면에서 백업을 보기 좋게 묶기 위한 항목입니다. 실제 백업은 변경되지 않으며, 같은 백업을 여러 분류에 포함할 수 있습니다."
      isLoading={isSaving}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>분류명 *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026년 9월 정기 백업" />
        </div>
        <div className="space-y-1.5">
          <Label>설명 (선택)</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="예: 스마트공장 검수 대비 백업" />
        </div>
        <div className="space-y-1.5">
          <Label>백업 선택 * <span className="text-muted-foreground font-normal">({selectedIds.size}건 선택됨)</span></Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="백업일시/상태로 검색" className="h-9" />
          {loading ? (
            <p className="text-[13px] text-muted-foreground py-4">불러오는 중...</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-4">선택 가능한 백업이 없습니다.</p>
          ) : (
            <div className="border rounded-md max-h-64 overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1.5 px-3 w-8"></th>
                    <th className="py-1.5 px-3 font-medium">백업일시</th>
                    <th className="py-1.5 px-3 font-medium">상태</th>
                    <th className="py-1.5 px-3 font-medium">유형</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr
                      key={r.externalBackupId}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/50"
                      onClick={() => toggle(r.externalBackupId)}
                    >
                      <td className="py-1.5 px-3">
                        <input type="checkbox" checked={selectedIds.has(r.externalBackupId)} onChange={() => toggle(r.externalBackupId)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="py-1.5 px-3 whitespace-nowrap">
                        {formatBackupDateTimeKst(r.insertedAt)}
                        {r.hidden && <Badge className="ml-1.5 border-0 text-[10px] bg-slate-100 text-slate-600">숨김</Badge>}
                      </td>
                      <td className="py-1.5 px-3">{backupStatusLabel(r.status)}</td>
                      <td className="py-1.5 px-3">{backupTypeLabel(r.isPhysicalBackup)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </FormSheet>
  )
}
