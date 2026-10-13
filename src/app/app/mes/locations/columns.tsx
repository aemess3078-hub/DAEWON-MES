"use client"

import { ColumnDef } from "@tanstack/react-table"
import { LocationWithSite } from "@/lib/actions/location.actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"

type GetColumnsProps = {
  onEdit: (location: LocationWithSite) => void
  onDelete: (location: LocationWithSite) => void
}

export function getColumns({ onEdit, onDelete }: GetColumnsProps): ColumnDef<LocationWithSite>[] {
  return [
    {
      accessorKey: "code",
      header: "코드",
      cell: ({ row }) => (
        <span className="font-mono text-[14px] font-medium">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "이름",
      cell: ({ row }) => (
        <span className="font-medium text-[14px]">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "zone",
      header: "상세구역",
      cell: ({ row }) => (
        <span className="text-[14px] text-muted-foreground">
          {row.original.zone ?? "—"}
        </span>
      ),
    },
    {
      id: "site",
      header: "소속 사이트",
      cell: ({ row }) => (
        <span className="text-[14px]">{row.original.site?.name ?? "—"}</span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              <Pencil className="h-4 w-4 mr-2" /> 수정
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(row.original)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" /> 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
