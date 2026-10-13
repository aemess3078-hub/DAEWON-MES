"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { SiteRow, SiteWithLocations, deleteSite, getSiteWithLocations } from "@/lib/actions/site.actions"

type SiteType = "FACTORY" | "WAREHOUSE" | "OFFICE"
import { SiteFormSheet } from "./site-form-sheet"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MoreHorizontal, Pencil, Trash2, Plus, MapPin, List } from "lucide-react"
import { useUserRole } from "@/lib/contexts/user-role-context"

const SITE_TYPE_LABELS: Record<SiteType, string> = {
  FACTORY: "공장",
  WAREHOUSE: "창고",
  OFFICE: "사무소",
}

const SITE_TYPE_COLORS: Record<SiteType, string> = {
  FACTORY: "bg-blue-100 text-blue-800 border-blue-200",
  WAREHOUSE: "bg-amber-100 text-amber-800 border-amber-200",
  OFFICE: "bg-slate-100 text-slate-700 border-slate-200",
}

type Props = {
  data: SiteRow[]
}

export function SiteDataTable({ data }: Props) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SiteRow | null>(null)
  const [locDialogOpen, setLocDialogOpen] = useState(false)
  const [locLoading, setLocLoading] = useState(false)
  const [locData, setLocData] = useState<SiteWithLocations | null>(null)

  const handleEdit = (site: SiteRow) => {
    setEditTarget(site)
    setSheetOpen(true)
  }

  const handleDelete = async (site: SiteRow) => {
    if (!confirm(`"${site.name}" 사이트를 삭제하시겠습니까?`)) return
    try {
      await deleteSite(site.id)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleViewLocations = async (site: SiteRow) => {
    setLocData(null)
    setLocDialogOpen(true)
    setLocLoading(true)
    try {
      const result = await getSiteWithLocations(site.id)
      setLocData(result)
    } finally {
      setLocLoading(false)
    }
  }

  const columns: ColumnDef<SiteRow>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
        />
      ),
      enableSorting: false,
    },
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
      accessorKey: "type",
      header: "유형",
      cell: ({ row }) => {
        const type = row.original.type
        return (
          <Badge variant="outline" className={SITE_TYPE_COLORS[type]}>
            {SITE_TYPE_LABELS[type]}
          </Badge>
        )
      },
    },
    {
      id: "locationCount",
      header: "로케이션 수",
      cell: ({ row }) => (
        <button
          onClick={() => handleViewLocations(row.original)}
          className="flex items-center gap-1.5 text-[14px] text-primary hover:underline"
        >
          <MapPin className="h-3.5 w-3.5" />
          {row.original._count.warehouses}개
        </button>
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
            <DropdownMenuItem onClick={() => handleViewLocations(row.original)}>
              <List className="h-4 w-4 mr-2" /> 로케이션 보기
            </DropdownMenuItem>
            {canMutate && (
              <DropdownMenuItem onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4 mr-2" /> 수정
              </DropdownMenuItem>
            )}
            {canMutate && (
              <DropdownMenuItem
                onClick={() => handleDelete(row.original)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" /> 삭제
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {canMutate && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setEditTarget(null)
              setSheetOpen(true)
            }}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            사이트 등록
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[{ id: "name", title: "이름" }]}
        filterableColumns={[
          {
            id: "type",
            title: "유형",
            options: [
              { label: "공장", value: "FACTORY" },
              { label: "창고", value: "WAREHOUSE" },
              { label: "사무소", value: "OFFICE" },
            ],
          },
        ]}
      />

      <SiteFormSheet
        mode={editTarget ? "edit" : "create"}
        site={editTarget}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />

      {/* 로케이션 목록 다이얼로그 */}
      <Dialog open={locDialogOpen} onOpenChange={setLocDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[18px]">
              {locData ? `${locData.name} — 로케이션 목록` : "로케이션 목록"}
            </DialogTitle>
          </DialogHeader>

          {locLoading ? (
            <div className="py-8 text-center text-[14px] text-muted-foreground">
              불러오는 중...
            </div>
          ) : locData?.warehouses && locData.warehouses.length > 0 ? (
            <div className="mt-2 divide-y">
              {locData.warehouses.map((wh) => (
                <div key={wh.id} className="flex items-start justify-between py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[14px] font-medium text-foreground">
                      {wh.code}
                    </span>
                    <span className="text-[14px] text-muted-foreground">{wh.name}</span>
                  </div>
                  {wh.zone && (
                    <Badge variant="secondary" className="text-[13px] ml-4 shrink-0">
                      {wh.zone}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-[14px] text-muted-foreground">
              등록된 로케이션이 없습니다.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
