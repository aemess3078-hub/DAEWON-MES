"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/common/data-table"
import { getColumns, type DefectCorrectiveActionRow } from "./columns"
import type { DefectCorrectiveActionFilterOptions } from "@/lib/actions/defect-corrective-action.actions"
import { CorrectiveActionRegisterSheet } from "./corrective-action-register-sheet"
import { CorrectiveActionDetailSheet } from "./corrective-action-detail-sheet"

const NONE_VALUE = "__ALL__"

type FilterState = {
  from: string
  to: string
  itemId: string
  routingOperationId: string
  manufacturingNo: string
  defectCodeId: string
  assigneeId: string
  status: string
}

interface CorrectiveActionClientProps {
  initialFilter: FilterState
  rows: DefectCorrectiveActionRow[]
  filterOptions: DefectCorrectiveActionFilterOptions
}

export function CorrectiveActionClient({ initialFilter, rows, filterOptions }: CorrectiveActionClientProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [, startTransition] = useTransition()
  const [registerOpen, setRegisterOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailActionId, setDetailActionId] = useState<string | null>(null)

  function pushFilter(next: FilterState) {
    setFilter(next)
    const params = new URLSearchParams()
    params.set("from", next.from)
    params.set("to", next.to)
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.routingOperationId) params.set("routingOperationId", next.routingOperationId)
    if (next.manufacturingNo) params.set("manufacturingNo", next.manufacturingNo)
    if (next.defectCodeId) params.set("defectCodeId", next.defectCodeId)
    if (next.assigneeId) params.set("assigneeId", next.assigneeId)
    if (next.status && next.status !== "ALL") params.set("status", next.status)
    startTransition(() => router.push(`/app/mes/quality/corrective-action?${params.toString()}`))
  }

  function resetFilter() {
    pushFilter({
      from: initialFilter.from,
      to: initialFilter.to,
      itemId: "",
      routingOperationId: "",
      manufacturingNo: "",
      defectCodeId: "",
      assigneeId: "",
      status: "ALL",
    })
  }

  function handleViewDetail(row: DefectCorrectiveActionRow) {
    setDetailActionId(row.id)
    setDetailOpen(true)
  }

  const columns = getColumns(handleViewDetail)

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="text-[14px] font-medium text-foreground">조회조건</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter({ ...filter, from: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter({ ...filter, to: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">상태</Label>
            <Select value={filter.status} onValueChange={(v) => pushFilter({ ...filter, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="OPEN">등록</SelectItem>
                <SelectItem value="IN_PROGRESS">진행중</SelectItem>
                <SelectItem value="COMPLETED">완료</SelectItem>
                <SelectItem value="OVERDUE">기한초과</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">담당자</Label>
            <Select value={filter.assigneeId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, assigneeId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.assignableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">품목</Label>
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
            <Label className="text-[13px]">공정</Label>
            <Select value={filter.routingOperationId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, routingOperationId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.routingOperations.map((op) => (
                  <SelectItem key={op.id} value={op.id}>{op.routingCode} / {op.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">불량코드</Label>
            <Select value={filter.defectCodeId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, defectCodeId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.defectCodes.map((dc) => (
                  <SelectItem key={dc.id} value={dc.id}>[{dc.code}] {dc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">제조번호</Label>
            <Input
              placeholder="제조번호로 좁혀보기"
              value={filter.manufacturingNo}
              onChange={(e) => setFilter({ ...filter, manufacturingNo: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
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
          조치 목록 <span className="text-muted-foreground font-normal">({rows.length}건)</span>
        </p>
        <Button size="sm" onClick={() => setRegisterOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          조치 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchableColumns={[
          { id: "orderNo", title: "작업지시번호/제조번호" },
          { id: "itemName", title: "품목명" },
          { id: "defectCodeName", title: "불량유형" },
          { id: "actionContent", title: "조치내용" },
        ]}
      />

      <CorrectiveActionRegisterSheet
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        from={filter.from}
        to={filter.to}
        assignableUsers={filterOptions.assignableUsers}
        onSaved={() => router.refresh()}
      />

      <CorrectiveActionDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        actionId={detailActionId}
        row={rows.find((r) => r.id === detailActionId) ?? null}
        assignableUsers={filterOptions.assignableUsers}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}
