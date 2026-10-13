"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/common/data-table"
import { getColumns, type ToolRow } from "./columns"
import type { ToolFilterOptions } from "@/lib/actions/tool.actions"
import { ToolFormSheet } from "./tool-form-sheet"
import { ToolDetailSheet } from "./tool-detail-sheet"

const NONE_VALUE = "__ALL__"

type FilterState = {
  equipmentType: string
  status: string
  itemId: string
  workCenterId: string
}

interface ToolClientProps {
  initialFilter: FilterState
  rows: ToolRow[]
  filterOptions: ToolFilterOptions
}

export function ToolClient({ initialFilter, rows, filterOptions }: ToolClientProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [, startTransition] = useTransition()
  const [registerOpen, setRegisterOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  function pushFilter(next: FilterState) {
    setFilter(next)
    const params = new URLSearchParams()
    if (next.equipmentType && next.equipmentType !== "ALL") params.set("equipmentType", next.equipmentType)
    if (next.status && next.status !== "ALL") params.set("status", next.status)
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.workCenterId) params.set("workCenterId", next.workCenterId)
    startTransition(() => router.push(`/app/mes/equipment-tools?${params.toString()}`))
  }

  function resetFilter() {
    pushFilter({ equipmentType: "ALL", status: "ALL", itemId: "", workCenterId: "" })
  }

  function handleViewDetail(row: ToolRow) {
    setDetailId(row.id)
    setDetailOpen(true)
  }

  const columns = getColumns(handleViewDetail)

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="text-[14px] font-medium text-foreground">조회조건</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[13px]">유형</Label>
            <Select value={filter.equipmentType} onValueChange={(v) => pushFilter({ ...filter, equipmentType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="TOOL">공구</SelectItem>
                <SelectItem value="JIG">지그</SelectItem>
                <SelectItem value="FIXTURE">고정구</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">상태</Label>
            <Select value={filter.status} onValueChange={(v) => pushFilter({ ...filter, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="ACTIVE">사용가능</SelectItem>
                <SelectItem value="INACTIVE">보관중</SelectItem>
                <SelectItem value="MAINTENANCE">수리중</SelectItem>
                <SelectItem value="DISCARDED">폐기</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">적용품목</Label>
            <Select value={filter.itemId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, itemId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>[{it.code}] {it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">보관위치</Label>
            <Select value={filter.workCenterId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, workCenterId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.workCenters.map((wc) => (
                  <SelectItem key={wc.id} value={wc.id}>{wc.code} / {wc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Button variant="ghost" size="sm" onClick={resetFilter}>
            필터 초기화
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium text-foreground">
          공구 목록 <span className="text-muted-foreground font-normal">({rows.length}건)</span>
        </p>
        <Button size="sm" onClick={() => setRegisterOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          공구 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchableColumns={[
          { id: "code", title: "공구번호" },
          { id: "name", title: "공구명" },
          { id: "appliedItems", title: "적용품목" },
          { id: "workCenterName", title: "보관위치" },
        ]}
      />

      <ToolFormSheet
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        mode="create"
        filterOptions={filterOptions}
        onSaved={() => router.refresh()}
      />

      <ToolDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        toolId={detailId}
        filterOptions={filterOptions}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}
