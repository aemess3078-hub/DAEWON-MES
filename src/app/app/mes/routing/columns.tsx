"use client"

import { ColumnDef } from "@tanstack/react-table"
import { RoutingStatus, RoutingScope } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader } from "@/components/common/data-table"
import { DataTableRowActions } from "@/components/common/data-table"
import { RoutingWithDetails } from "@/lib/actions/routing.actions"

const routingStatusLabels: Record<RoutingStatus, string> = {
  DRAFT: "초안",
  ACTIVE: "활성",
  INACTIVE: "비활성",
}

const routingScopeLabels: Record<RoutingScope, string> = {
  COMMON: "범용",
  ITEM_SPECIFIC: "품목 전용",
}

function formatLinkedItems(routing: RoutingWithDetails): string {
  if (routing.scope === "COMMON") return "모든 품목"
  const items = routing.items ?? []
  if (items.length === 0) return "-"
  if (items.length === 1) return items[0].item.code
  return `${items[0].item.code} 외 ${items.length - 1}개`
}

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

export function getColumns(callbacks: {
  onView: (routing: RoutingWithDetails) => void
  onEdit: (routing: RoutingWithDetails) => void
  onDelete: (routing: RoutingWithDetails) => void
}): ColumnDef<RoutingWithDetails>[] {
  return [
    {
      accessorKey: "code",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="라우팅 코드" />
      ),
      cell: ({ row }) => (
        <button
          onClick={() => callbacks.onView(row.original)}
          className="font-mono text-[14px] font-medium text-primary hover:underline cursor-pointer"
        >
          {row.getValue("code")}
        </button>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="라우팅 명" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px]">{row.getValue("name")}</span>
      ),
    },
    {
      id: "scope",
      accessorFn: (row) => row.scope,
      header: "적용 범위",
      cell: ({ row }) => {
        const r = row.original
        return (
          <Badge
            variant={r.scope === "COMMON" ? "outline" : "secondary"}
            className={`text-[12px] ${r.scope === "COMMON" ? "border-blue-300 text-blue-700 bg-blue-50" : ""}`}
          >
            {routingScopeLabels[r.scope]}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "linkedItems",
      accessorFn: (row) => formatLinkedItems(row),
      header: "연결 품목",
      cell: ({ row }) => {
        const r = row.original
        if (r.scope === "COMMON") {
          return <span className="text-[14px] text-muted-foreground">모든 품목</span>
        }
        return <span className="text-[14px] font-mono">{formatLinkedItems(r)}</span>
      },
      filterFn: (row, _colId, filterValue: string) => {
        const q = filterValue.toLowerCase()
        const r = row.original
        return (
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          routingScopeLabels[r.scope].toLowerCase().includes(q) ||
          (r.items ?? []).some(
            (ir) =>
              ir.item.code.toLowerCase().includes(q) || ir.item.name.toLowerCase().includes(q)
          )
        )
      },
    },
    {
      accessorKey: "version",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="버전" />
      ),
      cell: ({ row }) => (
        <span className="text-[14px] font-mono">{row.getValue("version")}</span>
      ),
    },
    {
      id: "operationCount",
      accessorFn: (row) => row.operations.length,
      header: "공정 수",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.getValue("operationCount")}건
        </span>
      ),
    },
    {
      id: "itemType",
      accessorFn: (row) => row.items?.[0]?.item?.itemType ?? "",
      header: "품목유형",
      cell: ({ row }) => {
        const type = row.getValue("itemType") as string
        if (!type) return <span className="text-[13px] text-muted-foreground">-</span>
        return (
          <Badge variant="secondary" className="text-[13px]">
            {itemTypeLabels[type] ?? type}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="상태" />
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as RoutingStatus
        const variantMap: Record<RoutingStatus, "default" | "secondary" | "destructive"> = {
          DRAFT: "secondary",
          ACTIVE: "default",
          INACTIVE: "destructive",
        }
        return (
          <Badge variant={variantMap[status] ?? "secondary"} className="text-[13px]">
            {routingStatusLabels[status] ?? status}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={() => callbacks.onEdit(row.original)}
          onDelete={() => callbacks.onDelete(row.original)}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
