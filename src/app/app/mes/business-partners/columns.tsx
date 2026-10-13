"use client"

import { ColumnDef } from "@tanstack/react-table"
import { PartnerType, PartnerStatus } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { DataTableColumnHeader, DataTableRowActions } from "@/components/common/data-table"
import { BusinessPartner } from "@/lib/actions/business-partner.actions"

const partnerTypeLabels: Record<PartnerType, string> = {
  CUSTOMER: "고객사",
  SUPPLIER: "거래처",
  BOTH: "고객/거래처",
}

const partnerTypeVariant: Record<PartnerType, "default" | "secondary" | "outline"> = {
  CUSTOMER: "default",
  SUPPLIER: "secondary",
  BOTH: "outline",
}

export function getColumns(callbacks: {
  onEdit: (partner: BusinessPartner) => void
  onDelete: (partner: BusinessPartner) => void
  onViewCode: (partner: BusinessPartner) => void
}): ColumnDef<BusinessPartner>[] {
  return [
    {
      accessorKey: "code",
      header: ({ column }) => <DataTableColumnHeader column={column} title="코드" />,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => callbacks.onViewCode(row.original)}
          className="font-medium text-[14px] text-primary hover:underline underline-offset-2"
          title="클릭하여 상세 정보 보기"
        >
          {row.getValue("code")}
        </button>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="이름" />,
      cell: ({ row }) => (
        <span className="text-[14px]">{row.getValue("name")}</span>
      ),
      filterFn: (row, _colId, filterValue: string) => {
        const q = filterValue.toLowerCase()
        return (
          row.original.code.toLowerCase().includes(q) ||
          row.original.name.toLowerCase().includes(q)
        )
      },
    },
    {
      accessorKey: "partnerType",
      header: ({ column }) => <DataTableColumnHeader column={column} title="유형" />,
      cell: ({ row }) => {
        const type = row.getValue("partnerType") as PartnerType
        return (
          <Badge variant={partnerTypeVariant[type]} className="text-[13px]">
            {partnerTypeLabels[type]}
          </Badge>
        )
      },
      filterFn: (row, id, filterValues: string[]) =>
        filterValues.includes(row.getValue(id)),
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="상태" />,
      cell: ({ row }) => {
        const status = row.getValue("status") as PartnerStatus
        return (
          <Badge variant={status === "ACTIVE" ? "default" : "secondary"} className="text-[13px]">
            {status === "ACTIVE" ? "활성" : "비활성"}
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
