"use client"

import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createTool, type ToolFilterOptions } from "@/lib/actions/tool.actions"

const NONE_VALUE = "__NONE__"

interface ToolFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create"
  filterOptions: ToolFilterOptions
  onSaved: () => void
}

export function ToolFormSheet({ open, onOpenChange, mode, filterOptions, onSaved }: ToolFormSheetProps) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [equipmentType, setEquipmentType] = useState<"TOOL" | "JIG" | "FIXTURE">("TOOL")
  const [siteId, setSiteId] = useState("")
  const [workCenterId, setWorkCenterId] = useState("")
  const [lifeLimit, setLifeLimit] = useState("")
  const [itemIds, setItemIds] = useState<string[]>([])
  const [addItemValue, setAddItemValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const workCentersForSite = useMemo(
    () => filterOptions.workCenters.filter((wc) => !siteId || wc.siteId === siteId),
    [filterOptions.workCenters, siteId]
  )

  const selectedItems = useMemo(
    () => itemIds.map((id) => filterOptions.items.find((i) => i.id === id)).filter((i): i is { id: string; code: string; name: string } => Boolean(i)),
    [itemIds, filterOptions.items]
  )

  function resetAndClose() {
    setCode("")
    setName("")
    setEquipmentType("TOOL")
    setSiteId("")
    setWorkCenterId("")
    setLifeLimit("")
    setItemIds([])
    setAddItemValue("")
    onOpenChange(false)
  }

  function handleAddItem(value: string) {
    if (value && !itemIds.includes(value)) {
      setItemIds([...itemIds, value])
    }
    setAddItemValue("")
  }

  function handleRemoveItem(id: string) {
    setItemIds(itemIds.filter((i) => i !== id))
  }

  async function handleSubmit() {
    if (!code.trim()) {
      alert("공구번호를 입력해 주세요.")
      return
    }
    if (!name.trim()) {
      alert("공구명을 입력해 주세요.")
      return
    }
    if (!siteId || !workCenterId) {
      alert("보관위치(사업장/작업장)를 선택해 주세요.")
      return
    }
    setIsLoading(true)
    try {
      await createTool({
        code,
        name,
        equipmentType,
        siteId,
        workCenterId,
        lifeLimit: lifeLimit || null,
        itemIds,
      })
      onSaved()
      resetAndClose()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
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
      title="공구 등록"
      description="보유 공구/치공구의 기본정보를 등록합니다."
      isLoading={isLoading}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>공구번호 *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: TOOL-001" />
          </div>
          <div className="space-y-1.5">
            <Label>유형 *</Label>
            <Select value={equipmentType} onValueChange={(v) => setEquipmentType(v as typeof equipmentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TOOL">공구</SelectItem>
                <SelectItem value="JIG">지그</SelectItem>
                <SelectItem value="FIXTURE">고정구</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>공구명 *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 드릴 지그 A형" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>사업장 *</Label>
            <Select value={siteId} onValueChange={(v) => { setSiteId(v); setWorkCenterId("") }}>
              <SelectTrigger><SelectValue placeholder="사업장 선택" /></SelectTrigger>
              <SelectContent>
                {filterOptions.sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>보관위치(작업장) *</Label>
            <Select value={workCenterId} onValueChange={setWorkCenterId} disabled={!siteId}>
              <SelectTrigger><SelectValue placeholder="작업장 선택" /></SelectTrigger>
              <SelectContent>
                {workCentersForSite.map((wc) => (
                  <SelectItem key={wc.id} value={wc.id}>{wc.code} / {wc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>수명기준 (선택)</Label>
          <Input
            type="number"
            min={1}
            value={lifeLimit}
            onChange={(e) => setLifeLimit(e.target.value)}
            placeholder="예: 100000 (사용횟수 기준, 비워두면 수명 관리 안 함)"
          />
        </div>

        <div className="space-y-1.5">
          <Label>적용품목 (선택, 여러 품목 지정 가능)</Label>
          <Select value={addItemValue} onValueChange={handleAddItem}>
            <SelectTrigger><SelectValue placeholder="품목을 선택하면 추가됩니다" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE} disabled>품목 선택</SelectItem>
              {filterOptions.items
                .filter((it) => !itemIds.includes(it.id))
                .map((it) => (
                  <SelectItem key={it.id} value={it.id}>[{it.code}] {it.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          {selectedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {selectedItems.map((it) => (
                <Badge key={it.id} variant="secondary" className="gap-1 text-[12px] font-normal">
                  {it.name}
                  <button type="button" onClick={() => handleRemoveItem(it.id)} className="ml-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </FormSheet>
  )
}
