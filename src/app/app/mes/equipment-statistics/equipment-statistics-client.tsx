"use client"

import { useState, useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  BarChart2,
  AlertTriangle,
  Clock,
  Timer,
  Zap,
  Activity,
  Wifi,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  EquipmentStatisticsData,
  EquipmentOption,
  ProductionStats,
  ErrorStats,
  DowntimeStats,
  WorkTimeStats,
  AvailabilityStats,
} from "@/lib/actions/equipment-statistics.actions"
import { formatQuantity } from "@/lib/utils"

// ─── Column definitions ───────────────────────────────────────────────────────

const productionColumns: ColumnDef<ProductionStats["rows"][number]>[] = [
  { accessorKey: "date", header: "날짜", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.date}</span> },
  { accessorKey: "equipmentCode", header: "설비코드", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.equipmentCode}</span> },
  { accessorKey: "equipmentName", header: "설비명", cell: ({ row }) => <span className="text-[14px]">{row.original.equipmentName}</span> },
  { accessorKey: "goodQty", header: "양품 수량", cell: ({ row }) => <span className="text-[14px]">{formatQuantity(row.original.goodQty)}</span> },
  { accessorKey: "defectQty", header: "불량 수량", cell: ({ row }) => <span className="text-[14px] text-red-600">{formatQuantity(row.original.defectQty)}</span> },
]

const errorColumns: ColumnDef<ErrorStats["rows"][number]>[] = [
  { accessorKey: "equipmentCode", header: "설비코드", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.equipmentCode}</span> },
  { accessorKey: "equipmentName", header: "설비명", cell: ({ row }) => <span className="text-[14px]">{row.original.equipmentName}</span> },
  {
    accessorKey: "alarmCount", header: "알람",
    cell: ({ row }) => (
      <Badge className="bg-red-100 text-red-700 border-0 text-[12px]">{formatQuantity(row.original.alarmCount)}</Badge>
    ),
  },
  {
    accessorKey: "warningCount", header: "경고",
    cell: ({ row }) => (
      <Badge className="bg-amber-100 text-amber-700 border-0 text-[12px]">{formatQuantity(row.original.warningCount)}</Badge>
    ),
  },
]

const downtimeColumns: ColumnDef<DowntimeStats["rows"][number]>[] = [
  { accessorKey: "equipmentCode", header: "설비코드", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.equipmentCode}</span> },
  { accessorKey: "equipmentName", header: "설비명", cell: ({ row }) => <span className="text-[14px]">{row.original.equipmentName}</span> },
  { accessorKey: "stopMinutes", header: "정지 (분)", cell: ({ row }) => <span className="text-[14px]">{row.original.stopMinutes.toLocaleString()}</span> },
  { accessorKey: "maintenanceMinutes", header: "보전 (분)", cell: ({ row }) => <span className="text-[14px]">{row.original.maintenanceMinutes.toLocaleString()}</span> },
  { accessorKey: "total", header: "합계 (분)", cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.total.toLocaleString()}</span> },
]

const workTimeColumns: ColumnDef<WorkTimeStats["rows"][number]>[] = [
  { accessorKey: "date", header: "날짜", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.date}</span> },
  { accessorKey: "equipmentCode", header: "설비코드", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.equipmentCode}</span> },
  { accessorKey: "equipmentName", header: "설비명", cell: ({ row }) => <span className="text-[14px]">{row.original.equipmentName}</span> },
  { accessorKey: "hours", header: "작업시간 (h)", cell: ({ row }) => <span className="text-[14px]">{row.original.hours.toLocaleString()}</span> },
  { accessorKey: "goodQty", header: "양품 수량", cell: ({ row }) => <span className="text-[14px]">{formatQuantity(row.original.goodQty)}</span> },
]

const availabilityColumns: ColumnDef<AvailabilityStats["rows"][number]>[] = [
  { accessorKey: "code", header: "설비코드", cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.code}</span> },
  { accessorKey: "name", header: "설비명", cell: ({ row }) => <span className="text-[14px]">{row.original.name}</span> },
  { accessorKey: "runMinutes", header: "가동시간 (분)", cell: ({ row }) => <span className="text-[14px]">{row.original.runMinutes.toLocaleString()}</span> },
  {
    accessorKey: "rate", header: "가동률",
    cell: ({ row }) => {
      const r = row.original.rate
      if (r === null) return <span className="text-[13px] text-muted-foreground">-</span>
      const pct = Math.round(r * 1000) / 10
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="text-[14px] font-medium">{pct}%</span>
        </div>
      )
    },
  },
]

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-16 text-center text-muted-foreground">
      <BarChart2 className="mx-auto h-10 w-10 mb-3 opacity-30" />
      <p className="text-[15px]">{label} 데이터가 없습니다.</p>
      <p className="text-[13px] mt-1">기간이나 설비 조건을 변경해 보세요.</p>
    </div>
  )
}

// ─── Power unavailable ────────────────────────────────────────────────────────

function PowerUnavailable() {
  return (
    <div className="py-16 text-center">
      <Wifi className="mx-auto h-10 w-10 mb-3 text-slate-300" />
      <p className="text-[15px] font-medium text-muted-foreground">전력 데이터 연동 필요</p>
      <p className="text-[13px] mt-1 text-muted-foreground">
        전력 측정 태그가 설정되지 않았습니다. 설비 연결 설정에서 전력 태그를 등록하세요.
      </p>
    </div>
  )
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  iconBg,
  label,
  value,
  sub,
  unavailable,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value?: string | number
  sub?: string
  unavailable?: boolean
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
      <div className={`p-2 ${iconBg} rounded-lg shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[13px] text-muted-foreground truncate">{label}</p>
        {unavailable ? (
          <p className="text-[13px] text-muted-foreground mt-0.5">연동 필요</p>
        ) : (
          <>
            <p className="text-[20px] font-semibold leading-tight">{value}</p>
            {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  data: EquipmentStatisticsData
  equipmentOptions: EquipmentOption[]
}

export function EquipmentStatisticsClient({ data, equipmentOptions }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  const [from, setFrom] = useState(data.filter.from)
  const [to, setTo] = useState(data.filter.to)
  const [equipmentId, setEquipmentId] = useState(data.filter.equipmentId ?? "__all__")

  function handleApply() {
    const params = new URLSearchParams()
    params.set("from", from)
    params.set("to", to)
    if (equipmentId && equipmentId !== "__all__") params.set("equipmentId", equipmentId)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const { production, errors, downtime, workTime, availability } = data

  const avgAvailability =
    availability.avgRate !== null
      ? `${Math.round(availability.avgRate * 1000) / 10}%`
      : "-"

  const defectRateStr =
    production.defectRate !== null
      ? `${Math.round(production.defectRate * 1000) / 10}%`
      : "-"

  const downtimeHrs =
    downtime.totalMinutes > 0 ? `${Math.round(downtime.totalMinutes / 60 * 10) / 10}h` : "0h"

  const workTimeStr =
    workTime.totalHours !== null ? `${workTime.totalHours}h` : "-"

  return (
    <>
      {/* Filter bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-[14px] h-9 w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-[14px] h-9 w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">설비</Label>
            <Select value={equipmentId} onValueChange={setEquipmentId}>
              <SelectTrigger className="text-[14px] h-9 w-52">
                <SelectValue placeholder="전체 설비" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-[14px]">전체 설비</SelectItem>
                {equipmentOptions.map((eq) => (
                  <SelectItem key={eq.id} value={eq.id} className="text-[14px]">
                    {eq.code} – {eq.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={handleApply} className="h-9">
            조회
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          icon={<BarChart2 className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-50"
          label="총 생산량"
          value={formatQuantity(production.totalGoodQty)}
          sub={`불량률 ${defectRateStr}`}
        />
        <SummaryCard
          icon={<Activity className="h-5 w-5 text-green-600" />}
          iconBg="bg-green-50"
          label="평균 가동률"
          value={avgAvailability}
          sub={`설비 ${formatQuantity(availability.equipmentCount)}대`}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          iconBg="bg-red-50"
          label="에러 발생"
          value={formatQuantity(errors.total)}
          sub={`알람 ${formatQuantity(errors.alarmCount)} / 경고 ${formatQuantity(errors.warningCount)}`}
        />
        <SummaryCard
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-50"
          label="비가동 시간"
          value={downtimeHrs}
          sub={`${formatQuantity(downtime.eventCount)}건`}
        />
        <SummaryCard
          icon={<Timer className="h-5 w-5 text-violet-600" />}
          iconBg="bg-violet-50"
          label="작업 시간"
          value={workTimeStr}
          sub={workTime.resultCount > 0 ? `${formatQuantity(workTime.resultCount)}건` : undefined}
        />
        <SummaryCard
          icon={<Zap className="h-5 w-5 text-slate-400" />}
          iconBg="bg-slate-50"
          label="전력사용량"
          unavailable
        />
      </div>

      {/* Detail tabs */}
      <div className="rounded-lg border bg-card">
        <Tabs defaultValue="production">
          <div className="px-4 pt-4 border-b">
            <TabsList className="h-9">
              <TabsTrigger value="production" className="text-[13px]">생산량</TabsTrigger>
              <TabsTrigger value="availability" className="text-[13px]">가동률</TabsTrigger>
              <TabsTrigger value="errors" className="text-[13px]">에러</TabsTrigger>
              <TabsTrigger value="downtime" className="text-[13px]">비가동</TabsTrigger>
              <TabsTrigger value="worktime" className="text-[13px]">작업시간</TabsTrigger>
              <TabsTrigger value="power" className="text-[13px]">전력</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="production" className="p-0">
            {production.rows.length === 0 ? (
              <EmptyState label="생산량" />
            ) : (
              <DataTable columns={productionColumns} data={production.rows} />
            )}
          </TabsContent>

          <TabsContent value="availability" className="p-0">
            {availability.rows.length === 0 ? (
              <EmptyState label="설비 가동률" />
            ) : (
              <DataTable columns={availabilityColumns} data={availability.rows} />
            )}
          </TabsContent>

          <TabsContent value="errors" className="p-0">
            {errors.rows.length === 0 ? (
              <EmptyState label="에러" />
            ) : (
              <DataTable columns={errorColumns} data={errors.rows} />
            )}
          </TabsContent>

          <TabsContent value="downtime" className="p-0">
            {downtime.rows.length === 0 ? (
              <EmptyState label="비가동" />
            ) : (
              <DataTable columns={downtimeColumns} data={downtime.rows} />
            )}
          </TabsContent>

          <TabsContent value="worktime" className="p-0">
            {workTime.rows.length === 0 ? (
              <EmptyState label="작업시간" />
            ) : (
              <DataTable columns={workTimeColumns} data={workTime.rows} />
            )}
          </TabsContent>

          <TabsContent value="power" className="p-4">
            <PowerUnavailable />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
