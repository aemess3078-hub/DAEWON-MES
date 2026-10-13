"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle, Gauge } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
import { ColumnDef } from "@tanstack/react-table"
import type {
  CapacityStats,
  CapacityRow,
  EquipmentOption,
} from "@/lib/actions/equipment-statistics.actions"
import { formatQuantity } from "@/lib/utils"

const ALL_EQUIPMENT = "__all__"

const columns: ColumnDef<CapacityRow>[] = [
  {
    accessorKey: "equipmentCode",
    header: "설비코드",
    cell: ({ row }) => (
      <span className="font-mono text-[13px]">{row.original.equipmentCode}</span>
    ),
  },
  {
    accessorKey: "equipmentName",
    header: "설비명",
    cell: ({ row }) => <span className="text-[14px]">{row.original.equipmentName}</span>,
  },
  {
    accessorKey: "totalGoodQty",
    header: "생산량",
    cell: ({ row }) => (
      <span className="text-[14px]">{formatQuantity(row.original.totalGoodQty)}</span>
    ),
  },
  {
    accessorKey: "workMinutes",
    header: "작업시간(분)",
    cell: ({ row }) => (
      <span className="text-[14px]">{row.original.workMinutes.toLocaleString()}</span>
    ),
  },
  {
    accessorKey: "actualUPH",
    header: "실UPH",
    cell: ({ row }) => {
      const v = row.original.actualUPH
      return v !== null ? (
        <span className="text-[14px] font-medium">{v.toLocaleString()}</span>
      ) : (
        <span className="text-[13px] text-muted-foreground">-</span>
      )
    },
  },
  {
    accessorKey: "stdUPH",
    header: "표준UPH",
    cell: ({ row }) => {
      const v = row.original.stdUPH
      return v !== null ? (
        <span className="text-[14px] text-muted-foreground">{v.toLocaleString()}</span>
      ) : (
        <span className="text-[13px] text-muted-foreground">-</span>
      )
    },
  },
  {
    accessorKey: "achievementRate",
    header: "달성률",
    cell: ({ row }) => {
      const rate = row.original.achievementRate
      if (rate === null) return <span className="text-[13px] text-muted-foreground">-</span>
      const color =
        rate >= 100 ? "text-emerald-700" : rate >= 80 ? "text-blue-700" : "text-red-600"
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${rate >= 100 ? "bg-emerald-500" : rate >= 80 ? "bg-blue-500" : "bg-red-500"}`}
              style={{ width: `${Math.min(rate, 100)}%` }}
            />
          </div>
          <span className={`text-[14px] font-medium ${color}`}>{rate}%</span>
        </div>
      )
    },
  },
  {
    accessorKey: "isBottleneck",
    header: "병목",
    cell: ({ row }) =>
      row.original.isBottleneck ? (
        <Badge className="bg-red-100 text-red-700 border-0 text-[12px] gap-1">
          <AlertTriangle className="h-3 w-3" />
          병목
        </Badge>
      ) : row.original.achievementRate !== null ? (
        <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[12px] gap-1">
          <CheckCircle className="h-3 w-3" />
          정상
        </Badge>
      ) : (
        <span className="text-[13px] text-muted-foreground">-</span>
      ),
  },
]

interface Props {
  data: CapacityStats
  equipmentOptions: EquipmentOption[]
}

export function CapacityClient({ data, equipmentOptions }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [from, setFrom] = useState(data.filter.from)
  const [to, setTo] = useState(data.filter.to)
  const [equipmentId, setEquipmentId] = useState(data.filter.equipmentId ?? ALL_EQUIPMENT)

  function applyFilter() {
    const params = new URLSearchParams()
    params.set("from", from)
    params.set("to", to)
    if (equipmentId && equipmentId !== ALL_EQUIPMENT) params.set("equipmentId", equipmentId)
    startTransition(() => {
      router.push(`/app/lms/statistics/capacity?${params.toString()}`)
    })
  }

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap gap-3 items-end p-4 rounded-lg border bg-card">
        <div className="space-y-1">
          <Label className="text-[13px]">시작일</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 text-[14px] w-36"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">종료일</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 text-[14px] w-36"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[13px]">설비</Label>
          <Select value={equipmentId} onValueChange={setEquipmentId}>
            <SelectTrigger className="h-8 text-[14px] w-44">
              <SelectValue placeholder="전체 설비" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_EQUIPMENT}>전체 설비</SelectItem>
              {equipmentOptions.map((eq) => (
                <SelectItem key={eq.id} value={eq.id}>
                  {eq.code} – {eq.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={applyFilter} size="sm" className="h-8">
          조회
        </Button>
      </div>

      {/* 데이터 테이블 */}
      {data.rows.length === 0 ? (
        <div className="rounded-lg border bg-card py-16 text-center">
          <Gauge className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
          <p className="text-[15px] text-muted-foreground">
            조회된 생산능력 데이터가 없습니다.
          </p>
          <p className="text-[13px] text-muted-foreground mt-1">
            기간을 변경하거나 작업실적이 있는 설비를 선택하세요.
          </p>
        </div>
      ) : (
        <DataTable columns={columns} data={data.rows} />
      )}
    </div>
  )
}
