"use client"

import { useMemo, useState, useTransition } from "react"
import { Copy, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  copyEquipmentTags,
  CopyTagConflictMode,
  CopyEquipmentTagResult,
} from "@/lib/actions/equipment-integration.actions"
import { formatQuantity } from "@/lib/utils"

type ConnectionOption = {
  id: string
  protocol: string
  equipment: { id: string; code: string; name: string }
  gateway: { name: string }
  _count?: { tags: number }
}

type EquipmentOption = {
  id: string
  code: string
  name: string
  tagCount: number
  connectionCount: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: ConnectionOption[]
  onCopied: () => void
}

const CONFLICT_MODE_LABEL: Record<CopyTagConflictMode, string> = {
  SKIP: "SKIP - 기존 태그 유지",
  UPDATE: "UPDATE - 기존 태그 값 업데이트",
  REPLACE: "REPLACE - 기존 태그 삭제 후 복사",
}

function buildEquipmentOptions(connections: ConnectionOption[]): EquipmentOption[] {
  const byEquipment = new Map<string, EquipmentOption>()

  for (const connection of connections) {
    const current = byEquipment.get(connection.equipment.id)
    if (current) {
      current.connectionCount += 1
      current.tagCount += connection._count?.tags ?? 0
      continue
    }

    byEquipment.set(connection.equipment.id, {
      id: connection.equipment.id,
      code: connection.equipment.code,
      name: connection.equipment.name,
      tagCount: connection._count?.tags ?? 0,
      connectionCount: 1,
    })
  }

  return Array.from(byEquipment.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  )
}

function formatSummary(results: CopyEquipmentTagResult[]) {
  const totals = results.reduce(
    (acc, row) => ({
      added: acc.added + row.added,
      updated: acc.updated + row.updated,
      skipped: acc.skipped + row.skipped,
      deleted: acc.deleted + row.deleted,
    }),
    { added: 0, updated: 0, skipped: 0, deleted: 0 }
  )

  const lines = results.map(
    (row) =>
      `${row.equipmentName}(${row.equipmentCode}): 추가 ${row.added}, 업데이트 ${row.updated}, 건너뜀 ${row.skipped}, 삭제 ${row.deleted}`
  )

  return [
    `태그 복사가 완료되었습니다. 총 추가 ${totals.added}, 업데이트 ${totals.updated}, 건너뜀 ${totals.skipped}, 삭제 ${totals.deleted}`,
    ...lines,
  ].join("\n")
}

export function CopyTagsDialog({
  open,
  onOpenChange,
  connections,
  onCopied,
}: Props) {
  const [sourceEquipmentId, setSourceEquipmentId] = useState("")
  const [targetEquipmentIds, setTargetEquipmentIds] = useState<string[]>([])
  const [conflictMode, setConflictMode] = useState<CopyTagConflictMode>("SKIP")
  const [isPending, startTransition] = useTransition()

  const equipmentOptions = useMemo(
    () => buildEquipmentOptions(connections),
    [connections]
  )
  const targetOptions = equipmentOptions.filter(
    (equipment) => equipment.id !== sourceEquipmentId
  )

  function toggleTarget(equipmentId: string, checked: boolean) {
    setTargetEquipmentIds((current) =>
      checked
        ? Array.from(new Set([...current, equipmentId]))
        : current.filter((id) => id !== equipmentId)
    )
  }

  function handleSourceChange(equipmentId: string) {
    setSourceEquipmentId(equipmentId)
    setTargetEquipmentIds((current) => current.filter((id) => id !== equipmentId))
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        const result = await copyEquipmentTags({
          sourceEquipmentId,
          targetEquipmentIds,
          conflictMode,
        })
        alert(formatSummary(result))
        onOpenChange(false)
        onCopied()
      } catch (error) {
        alert(error instanceof Error ? error.message : "태그 복사 중 오류가 발생했습니다.")
      }
    })
  }

  const disabled =
    isPending || !sourceEquipmentId || targetEquipmentIds.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>다른 설비에서 태그 복사</DialogTitle>
          <DialogDescription>
            원본 설비에 등록된 태그를 같은 tenant의 다른 활성 설비 연결에 일괄 적용합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-[14px] font-medium">원본 설비</Label>
            <Select
              value={sourceEquipmentId}
              onValueChange={handleSourceChange}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="태그를 복사할 원본 설비 선택" />
              </SelectTrigger>
              <SelectContent>
                {equipmentOptions.map((equipment) => (
                  <SelectItem key={equipment.id} value={equipment.id}>
                    {equipment.name} ({equipment.code}) · 태그 {formatQuantity(equipment.tagCount)}개
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-[14px] font-medium">적용 대상 설비</Label>
              <span className="text-[13px] text-muted-foreground">
                {targetEquipmentIds.length}대 선택
              </span>
            </div>
            <ScrollArea className="h-56 rounded-md border">
              <div className="divide-y">
                {targetOptions.map((equipment) => {
                  const checked = targetEquipmentIds.includes(equipment.id)
                  return (
                    <label
                      key={equipment.id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={isPending}
                        onCheckedChange={(value) =>
                          toggleTarget(equipment.id, value === true)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium">
                          {equipment.name}
                        </span>
                        <span className="block text-[13px] text-muted-foreground">
                          {equipment.code} · 기존 태그 {formatQuantity(equipment.tagCount)}개
                        </span>
                      </span>
                    </label>
                  )
                })}
                {targetOptions.length === 0 && (
                  <div className="px-3 py-8 text-center text-[14px] text-muted-foreground">
                    선택 가능한 대상 설비가 없습니다.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <Label className="text-[14px] font-medium">중복 처리 방식</Label>
            <Select
              value={conflictMode}
              onValueChange={(value) =>
                setConflictMode(value as CopyTagConflictMode)
              }
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONFLICT_MODE_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={disabled}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            복사 실행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
