"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import {
  ColumnDef,
  ExpandedState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ChevronDown, ChevronUp, Search } from "lucide-react"
import { format } from "date-fns"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { WipInventoryRow } from "@/lib/actions/work-order.actions"
import {
  getColumns,
  RECEIPT_STATUS_CONFIG,
  UNIT_TYPE_CONFIG,
  WIP_STATUS_CONFIG,
} from "./columns"
import { formatQuantity } from "@/lib/utils"

interface WipInventoryDataTableProps {
  data: WipInventoryRow[]
}

const STATUS_OPTIONS = [
  { label: "전체", value: "" },
  { label: "대기", value: "WAITING" },
  { label: "진행중", value: "IN_PROCESS" },
  { label: "재작업 보류", value: "REWORK" },
  { label: "완료", value: "COMPLETED" },
  { label: "폐기", value: "SCRAPPED" },
]

export function WipInventoryDataTable({ data }: WipInventoryDataTableProps) {
  const [keyword, setKeyword] = useState("")
  const [startDateFrom, setStartDateFrom] = useState("")
  const [startDateTo, setStartDateTo] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [sorting, setSorting] = useState<SortingState>([])
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const fromTime = startDateFrom ? new Date(`${startDateFrom}T00:00:00`).getTime() : null
    const toTime = startDateTo ? new Date(`${startDateTo}T23:59:59`).getTime() : null

    return data.filter((row) => {
      if (statusFilter && row.wipStatus !== statusFilter) return false
      const createdTime = new Date(row.workOrder.createdAt).getTime()
      if (fromTime !== null && createdTime < fromTime) return false
      if (toTime !== null && createdTime > toTime) return false

      if (kw) {
        const haystack = [
          row.workOrder.orderNo,
          row.workOrder.manufacturingNo ?? "",
          row.workOrder.item.code,
          row.workOrder.item.name,
          row.operation.routingOperation.operationCode,
          row.operation.routingOperation.name,
          row.currentWorkCenter?.name ?? row.operation.routingOperation.workCenter.name,
          row.currentWarehouse?.name ?? "",
          row.currentLocation?.name ?? "",
          UNIT_TYPE_CONFIG[row.unitType].label,
        ]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(kw)) return false
      }

      return true
    })
  }, [data, keyword, startDateFrom, startDateTo, statusFilter])

  const baseColumns = useMemo(() => getColumns(), [])
  const allColumns = useMemo<ColumnDef<WipInventoryRow>[]>(
    () => [
      ...baseColumns,
      {
        id: "_expand",
        header: () => null,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              row.toggleExpanded()
            }}
          >
            {row.getIsExpanded() ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        ),
      },
    ],
    [baseColumns]
  )
  const table = useReactTable({
    data: filteredData,
    columns: allColumns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="작업지시 / 제조번호 / 품목 / 재공 구분 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="h-10 w-[380px] pl-9 text-[14px]"
          />
        </div>
        <DateFilter label="지시일 시작" value={startDateFrom} onChange={setStartDateFrom} />
        <DateFilter label="지시일 종료" value={startDateTo} onChange={setStartDateTo} />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setStatusFilter(option.value)}
            className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              statusFilter === option.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow className={row.getIsExpanded() ? "bg-muted/20 hover:bg-muted/20" : undefined}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() ? (
                    <TableRow className="bg-muted/10 hover:bg-muted/10">
                      <TableCell colSpan={allColumns.length} className="px-4 py-4">
                        <ExpandedDetail row={row.original} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-28 text-center text-[15px] text-muted-foreground">
                  조건에 해당하는 재공품이 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          총 {formatQuantity(filteredData.length)}개 재공품
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            이전
          </Button>
          <span className="text-[13px] text-muted-foreground">
            {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}
          </span>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            다음
          </Button>
        </div>
      </div>
    </div>
  )
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[13px] text-muted-foreground">{label}</span>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-[150px] text-[14px]"
      />
    </label>
  )
}

function ExpandedDetail({ row }: { row: WipInventoryRow }) {
  const unitConfig = UNIT_TYPE_CONFIG[row.unitType]
  const statusConfig = WIP_STATUS_CONFIG[row.wipStatus]
  const receiptConfig = RECEIPT_STATUS_CONFIG[row.receiptStatus]

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      <DetailCard title="재공 계보">
        <DetailRow label="구분" value={unitConfig.label} />
        <DetailRow label="관리번호" value={row.id.slice(-12)} mono />
        <DetailRow label="수량" value={`${formatQuantity(row.qty)} ${row.workOrder.item.uom}`} accent="sky" />
        {row.parentWipUnit ? (
          <DetailRow label="원 재공품" value={`${formatQuantity(row.parentWipUnit.qty)} ${row.workOrder.item.uom}`} />
        ) : null}
      </DetailCard>

      <DetailCard title="상태 / 발생 근거">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">재공 상태</span>
          <Badge variant="outline" className={`text-[13px] ${statusConfig.className}`}>
            {statusConfig.label}
          </Badge>
        </div>
        {row.sourceProductionResult ? (
          <>
            <DetailRow label="불량 발생" value={formatQuantity(row.sourceProductionResult.defectQty)} />
            <DetailRow label="재작업 발생" value={formatQuantity(row.sourceProductionResult.reworkQty)} />
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">완제품 입고 대상인 정상 재공품입니다.</p>
        )}
      </DetailCard>

      <DetailCard title="공정 / 현재 위치">
        <DetailRow label="공정" value={`${row.operation.seq}. ${row.operation.routingOperation.name}`} />
        <DetailRow
          label="작업장"
          value={row.currentWorkCenter?.name ?? row.operation.routingOperation.workCenter.name}
        />
        <DetailRow label="창고" value={row.currentWarehouse?.name ?? "-"} />
        <DetailRow label="위치" value={row.currentLocation?.name ?? "-"} />
      </DetailCard>

      <DetailCard title="입고 / 최근 이력">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">판정</span>
          <Badge variant="outline" className={`text-[13px] ${receiptConfig.className}`}>
            {receiptConfig.label}
          </Badge>
        </div>
        {row.unitType === "ROOT" ? (
          <>
            <DetailRow label="완료 재공" value={formatQuantity(row.completedFinalRootQty)} />
            <DetailRow label="이미 입고" value={formatQuantity(row.totalReceiptQty)} />
            <DetailRow label="입고 가능" value={formatQuantity(row.availableReceiptQty)} accent="emerald" />
          </>
        ) : null}
        {row.latestMovement ? (
          <DetailRow
            label="최근 이동"
            value={`${row.latestMovement.movementType} · ${format(new Date(row.latestMovement.createdAt), "yyyy-MM-dd HH:mm")}`}
          />
        ) : null}
        {row.receiptBlockedReason ? (
          <p className="text-[13px] leading-snug text-amber-700">{row.receiptBlockedReason}</p>
        ) : null}
      </DetailCard>
    </div>
  )
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-background p-3">
      <p className="text-[13px] font-semibold text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function DetailRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  accent?: "sky" | "emerald"
}) {
  const accentClass =
    accent === "sky" ? "text-sky-700" : accent === "emerald" ? "text-emerald-700" : "text-foreground"
  return (
    <div className="flex items-start justify-between gap-2 text-[13px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${mono ? "font-mono" : ""} ${accentClass}`}>
        {value}
      </span>
    </div>
  )
}
