"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { columns } from "./columns"
import type { EquipmentOutputRow } from "@/lib/actions/equipment-output.actions"
import { Input } from "@/components/ui/input"
import { EQUIPMENT_TYPE_LABELS } from "@/app/app/mes/master/equipment/columns"

interface Props {
  data: EquipmentOutputRow[]
}

export function EquipmentOutputDataTable({ data }: Props) {
  const [keyword, setKeyword] = useState("")

  // ── 키워드 필터 (설비코드·설비명·사이트·작업장) ──────────────────────────────
  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return data
    return data.filter((row) => {
      const hay = [
        row.equipmentCode,
        row.equipmentName,
        row.siteName,
        row.workCenterName,
      ].join(" ").toLowerCase()
      return hay.includes(kw)
    })
  }, [data, keyword])

  // ── 설비유형 facet 필터 옵션 ──────────────────────────────────────────────────
  const filterableColumns = [
    {
      id: "equipmentType" as keyof EquipmentOutputRow,
      title: "설비유형",
      options: Object.entries(EQUIPMENT_TYPE_LABELS).map(([value, label]) => ({
        label,
        value,
      })),
    },
  ]

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="설비코드 / 설비명 / 사이트 / 작업장 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 w-[280px] pl-9 text-[14px]"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        filterableColumns={filterableColumns}
      />
    </div>
  )
}
