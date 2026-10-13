"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Plus } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { EquipmentFormSheet } from "./equipment-form-sheet"
import {
  deleteEquipment,
  type EquipmentWithDetails,
} from "@/lib/actions/equipment.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

type Site        = { id: string; code: string; name: string }
type WorkCenter  = { id: string; code: string; name: string; siteId: string }

interface Props {
  data:        EquipmentWithDetails[]
  sites:       Site[]
  workCenters: WorkCenter[]
}

export function EquipmentDataTable({ data, sites, workCenters }: Props) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"
  const [keyword,    setKeyword]    = useState("")
  const [siteId,     setSiteId]     = useState("all")
  const [sheetOpen,  setSheetOpen]  = useState(false)
  const [editTarget, setEditTarget] = useState<EquipmentWithDetails | null>(null)

  // ── 필터 ────────────────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return data.filter((eq) => {
      if (siteId !== "all" && eq.siteId !== siteId) return false
      if (kw.length > 0) {
        const hay = [
          eq.code, eq.name,
          eq.site.name, eq.workCenter.name,
        ].join(" ").toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [data, keyword, siteId])

  // ── 핸들러 ──────────────────────────────────────────────────────────────────
  const handleEdit = (eq: EquipmentWithDetails) => {
    setEditTarget(eq)
    setSheetOpen(true)
  }

  const handleDelete = async (eq: EquipmentWithDetails) => {
    if (!confirm(`"${eq.name}" 설비를 삭제하시겠습니까?\n연결된 이력이 있으면 삭제되지 않습니다.`)) return
    try {
      await deleteEquipment(eq.id)
      router.refresh()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const allColumns = getColumns({ onEdit: handleEdit, onDelete: handleDelete })
  const columns = canMutate ? allColumns : allColumns.filter((c) => c.id !== "actions")

  // ── 필터 옵션 ────────────────────────────────────────────────────────────────
  const filterableColumns = [
    {
      id: "equipmentType" as keyof EquipmentWithDetails,
      title: "설비유형",
      options: [
        { label: "기계",     value: "MACHINE" },
        { label: "공구",     value: "TOOL" },
        { label: "지그",     value: "JIG" },
        { label: "고정구",   value: "FIXTURE" },
        { label: "이송장비", value: "VEHICLE" },
      ],
    },
    {
      id: "status" as keyof EquipmentWithDetails,
      title: "상태",
      options: [
        { label: "가동",     value: "ACTIVE" },
        { label: "미사용",   value: "INACTIVE" },
        { label: "유지보수", value: "MAINTENANCE" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="설비코드 / 설비명 / 사이트 / 작업장 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="h-9 w-[280px] pl-9 text-[14px]"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[14px] text-muted-foreground">사이트</span>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {canMutate && (
          <Button
            size="sm"
            onClick={() => { setEditTarget(null); setSheetOpen(true) }}
          >
            <Plus className="h-4 w-4 mr-2" />
            설비 등록
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        filterableColumns={filterableColumns}
      />

      <EquipmentFormSheet
        mode={editTarget ? "edit" : "create"}
        equipment={editTarget}
        sites={sites}
        workCenters={workCenters}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open)
          if (!open) setEditTarget(null)
        }}
      />
    </div>
  )
}
