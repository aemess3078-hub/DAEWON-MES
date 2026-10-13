"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Trash2, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

import {
  CodeGroupWithCodes,
  createCodeGroup,
  updateCodeGroup,
  deleteCodeGroup,
} from "@/lib/actions/common-code.actions"

type Props = {
  groups: CodeGroupWithCodes[]
  selectedGroupId: string | null
  onSelect: (id: string) => void
  tenantId: string
}

type GroupFormState = {
  groupCode: string
  groupName: string
  description: string
}

const EMPTY_FORM: GroupFormState = {
  groupCode: "",
  groupName: "",
  description: "",
}

export function CodeGroupList({ groups, selectedGroupId, onSelect, tenantId }: Props) {
  const router = useRouter()
  const [showDialog, setShowDialog] = useState(false)
  const [editingGroup, setEditingGroup] = useState<CodeGroupWithCodes | null>(null)
  const [form, setForm] = useState<GroupFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  function openCreate() {
    setEditingGroup(null)
    setForm(EMPTY_FORM)
    setShowDialog(true)
  }

  function openEdit(group: CodeGroupWithCodes) {
    setEditingGroup(group)
    setForm({
      groupCode: group.groupCode,
      groupName: group.groupName,
      description: group.description ?? "",
    })
    setShowDialog(true)
  }

  async function handleSave() {
    if (!form.groupCode.trim() || !form.groupName.trim()) return
    setSaving(true)
    try {
      const payload = {
        groupCode: form.groupCode.trim(),
        groupName: form.groupName.trim(),
        description: form.description.trim() || null,
      }
      if (editingGroup) {
        await updateCodeGroup(editingGroup.id, payload)
      } else {
        await createCodeGroup(payload, tenantId)
      }
      setShowDialog(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("이 코드 그룹을 삭제하시겠습니까?\n하위 코드도 모두 삭제됩니다.")) return
    try {
      await deleteCodeGroup(id)
      router.refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  return (
    <>
      <div className="flex flex-col h-full border rounded-lg bg-background">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <span className="text-[14px] font-semibold">코드 그룹</span>
          <Button size="sm" variant="outline" className="h-7 text-[13px]" onClick={openCreate}>
            <Plus className="h-3 w-3 mr-1" />
            추가
          </Button>
        </div>

        {/* 그룹 목록 */}
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && (
            <div className="flex items-center justify-center h-20 text-[13px] text-muted-foreground">
              등록된 그룹이 없습니다
            </div>
          )}
          {groups.map((group) => (
            <div
              key={group.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(group.id)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(group.id)}
              onMouseEnter={() => setHoveredId(group.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b last:border-0 transition-colors",
                "hover:bg-muted/50",
                selectedGroupId === group.id && "bg-muted"
              )}
            >
              {/* 텍스트 영역 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-mono text-[12px] text-muted-foreground leading-none">
                    {group.groupCode}
                  </span>
                  {group.isSystem && (
                    <Badge variant="secondary" className="text-[11px] px-1 py-0 h-4">
                      시스템
                    </Badge>
                  )}
                  {!group.isActive && (
                    <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 text-muted-foreground">
                      비활성
                    </Badge>
                  )}
                </div>
                <div className="text-[13px] font-medium truncate">{group.groupName}</div>
                <div className="text-[12px] text-muted-foreground">{group.codes.length}개 코드</div>
              </div>

              {/* 액션 버튼 */}
              <div
                className={cn(
                  "flex gap-0.5 shrink-0 transition-opacity",
                  hoveredId === group.id ? "opacity-100" : "opacity-0"
                )}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(group)
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                {!group.isSystem && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(group.id)
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 그룹 추가/수정 Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[18px]">
              {editingGroup ? "코드 그룹 수정" : "코드 그룹 추가"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[14px]">
                그룹 코드 <span className="text-destructive">*</span>
              </Label>
              <Input
                className="text-[14px]"
                placeholder="예: ITEM_TYPE"
                value={form.groupCode}
                onChange={(e) => setForm((f) => ({ ...f, groupCode: e.target.value }))}
                disabled={!!editingGroup}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">
                그룹명 <span className="text-destructive">*</span>
              </Label>
              <Input
                className="text-[14px]"
                placeholder="예: 품목 유형"
                value={form.groupName}
                onChange={(e) => setForm((f) => ({ ...f, groupName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">설명</Label>
              <Textarea
                className="text-[14px] resize-none"
                placeholder="그룹에 대한 설명을 입력하세요"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              취소
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.groupCode.trim() || !form.groupName.trim()}
            >
              {saving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
