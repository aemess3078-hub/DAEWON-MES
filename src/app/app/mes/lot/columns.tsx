"use client"

import { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { MoreHorizontal, ScanLine } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LotWithDetails } from "@/lib/actions/lot.actions"
import { formatQuantity } from "@/lib/utils"

// ─── 상태 레이블 ─────────────────────────────────────────────────────────────

const LOT_STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  ACTIVE:     { label: "활성",   className: "bg-green-100 text-green-800" },
  QUARANTINE: { label: "격리",   className: "bg-amber-100 text-amber-800" },
  ON_HOLD:    { label: "보류",   className: "bg-blue-100 text-blue-800" },
  CONSUMED:   { label: "소진",   className: "bg-slate-100 text-slate-600" },
  EXPIRED:    { label: "만료",   className: "bg-red-100 text-red-800" },
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  RAW_MATERIAL:  "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED:      "완제품",
  CONSUMABLE:    "소모품",
}

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────────

type ColumnActions = {
  onStatusChange: (lot: LotWithDetails, status: string) => void
}

export function getColumns({ onStatusChange }: ColumnActions): ColumnDef<LotWithDetails>[] {
  return [
    {
      accessorKey: "lotNo",
      header: "LOT번호",
      cell: ({ row }) => (
        <span className="font-mono font-medium text-[14px]">
          {row.original.lotNo}
        </span>
      ),
    },
    {
      accessorKey: "item.code",
      id: "itemCode",
      header: "품목코드",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] text-muted-foreground">
          {row.original.item.code}
        </span>
      ),
    },
    {
      accessorKey: "item.name",
      id: "itemName",
      header: "품목명",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.item.name}</span>
      ),
    },
    {
      accessorKey: "item.itemType",
      id: "itemType",
      header: "품목유형",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {ITEM_TYPE_LABELS[row.original.item.itemType] ?? row.original.item.itemType}
        </span>
      ),
      filterFn: (row, _, filterValue: string[]) => {
        if (!filterValue?.length) return true
        return filterValue.includes(row.original.item.itemType)
      },
    },
    {
      accessorKey: "item.uom",
      id: "uom",
      header: "UOM",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {row.original.item.uom}
        </span>
      ),
    },
    {
      accessorKey: "qty",
      header: () => <div className="text-right">재고수량</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-[14px]">
          {formatQuantity(Number(row.original.qty))}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = LOT_STATUS_CONFIG[row.original.status]
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${
              cfg?.className ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {cfg?.label ?? row.original.status}
          </span>
        )
      },
      filterFn: (row, _, filterValue: string[]) => {
        if (!filterValue?.length) return true
        return filterValue.includes(row.original.status)
      },
    },
    {
      accessorKey: "manufactureDate",
      header: "제조일",
      cell: ({ row }) => {
        const d = row.original.manufactureDate
        return (
          <span className="text-[13px] text-muted-foreground">
            {d ? format(new Date(d), "yyyy-MM-dd") : "—"}
          </span>
        )
      },
    },
    {
      accessorKey: "expiryDate",
      header: "유효기한",
      cell: ({ row }) => {
        const d = row.original.expiryDate
        if (!d) return <span className="text-[13px] text-muted-foreground">—</span>
        const expired = new Date(d) < new Date()
        return (
          <span
            className={`text-[13px] font-medium ${
              expired ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {format(new Date(d), "yyyy-MM-dd")}
          </span>
        )
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const lot = row.original
        return (
          <div className="flex items-center justify-end gap-1">
            <Link href={`/app/mes/traceability?lotNo=${lot.lotNo}`}>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[13px] text-blue-600 hover:text-blue-700">
                <ScanLine className="h-3.5 w-3.5 mr-1" />
                추적
              </Button>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">메뉴</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel className="text-[13px]">상태 변경</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {Object.entries(LOT_STATUS_CONFIG)
                  .filter(([key]) => key !== lot.status)
                  .map(([key, cfg]) => (
                    <DropdownMenuItem
                      key={key}
                      className="text-[13px]"
                      onClick={() => onStatusChange(lot, key)}
                    >
                      {cfg.label}으로 변경
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]
}
