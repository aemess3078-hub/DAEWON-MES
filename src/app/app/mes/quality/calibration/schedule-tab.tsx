"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertTriangle, CalendarClock, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, DataTableColumnHeader } from "@/components/common/data-table"
import {
  CALIBRATION_PROGRESS_LABELS,
  type CalibrationProgressValue,
  type CalibrationStateValue,
} from "@/lib/instrument-calibration"
import { filterInstrumentRows, type InstrumentRow, type KpiKey } from "@/lib/instrument-calibration-view"
import { KPI_LABELS } from "./instrument-registry-tab"
import {
  CalibrationStateChip,
  ProgressChip,
  SimpleSelect,
  formatDate,
  formatRemaining,
} from "./calibration-ui"

type Props = {
  instruments: InstrumentRow[]
  kpi: KpiKey
  onClearKpi: () => void
  canCreate: boolean
  canUpdate: boolean
  onDetail: (row: InstrumentRow) => void
  onSchedule: (row: InstrumentRow) => void
  onRegister: (row: InstrumentRow) => void
}

const STATE_FILTERS: Array<{ value: "" | CalibrationStateValue; label: string }> = [
  { value: "", label: "전체" },
  { value: "OVERDUE", label: "기한초과" },
  { value: "DUE_SOON", label: "교정임박" },
  { value: "UNREGISTERED", label: "미등록" },
  { value: "NORMAL", label: "정상" },
]

export function ScheduleTab({ instruments, kpi, onClearKpi, canCreate, canUpdate, onDetail, onSchedule, onRegister }: Props) {
  const [query, setQuery] = React.useState("")
  const [state, setState] = React.useState<"" | CalibrationStateValue>("")
  const [progress, setProgress] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")

  // 일정관리 대상: 교정이 필요하고 폐기되지 않은 계측기
  const scheduled = React.useMemo(
    () => instruments.filter((row) => row.calibrationRequired && row.usageStatus !== "DISPOSED"),
    [instruments],
  )
  const overdueCount = scheduled.filter((row) => row.calibrationState === "OVERDUE").length
  const dueSoonCount = scheduled.filter((row) => row.calibrationState === "DUE_SOON").length

  const rows = React.useMemo(
    () =>
      filterInstrumentRows(scheduled, {
        query,
        calibrationState: state,
        scheduleProgress: progress as CalibrationProgressValue | "",
        nextDateFrom: from || undefined,
        nextDateTo: to || undefined,
        kpi,
      }),
    [scheduled, query, state, progress, from, to, kpi],
  )
  const hasFilter = Boolean(query || state || progress || from || to || kpi !== "ALL")

  const columns = React.useMemo<ColumnDef<InstrumentRow>[]>(
    () => [
      {
        accessorKey: "managementNo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="관리번호" />,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 font-mono text-[14px] font-semibold">
            {row.original.calibrationState === "OVERDUE" && <AlertTriangle className="h-4 w-4 text-red-600" aria-label="교정기한초과" />}
            {row.original.managementNo}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="계측기명" />,
        cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.name}</span>,
      },
      {
        id: "lastCalibrationDate",
        accessorFn: (row) => row.lastCalibrationDate ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="최근교정일" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-[14px]">{formatDate(row.original.lastCalibrationDate)}</span>,
      },
      {
        accessorKey: "intervalLabel",
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정주기" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-[14px]">{row.original.intervalLabel}</span>,
      },
      {
        id: "nextCalibrationDate",
        accessorFn: (row) => row.nextCalibrationDate ?? "9999-99-99",
        header: ({ column }) => <DataTableColumnHeader column={column} title="차기교정일" />,
        cell: ({ row }) => (
          <span className={`whitespace-nowrap text-[14px] ${row.original.calibrationState === "OVERDUE" ? "font-semibold text-red-600" : ""}`}>
            {formatDate(row.original.nextCalibrationDate)}
          </span>
        ),
      },
      {
        id: "remainingDays",
        accessorFn: (row) => row.remainingDays ?? Number.MAX_SAFE_INTEGER,
        header: ({ column }) => <DataTableColumnHeader column={column} title="잔여일수" />,
        cell: ({ row }) => (
          <span
            className={`whitespace-nowrap text-[14px] ${
              row.original.calibrationState === "OVERDUE"
                ? "font-semibold text-red-600"
                : row.original.calibrationState === "DUE_SOON"
                  ? "font-semibold text-yellow-700"
                  : ""
            }`}
          >
            {formatRemaining(row.original.remainingDays)}
          </span>
        ),
      },
      {
        accessorKey: "calibrationState",
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정상태" />,
        cell: ({ row }) => <CalibrationStateChip state={row.original.calibrationState} />,
      },
      {
        accessorKey: "scheduleProgress",
        header: ({ column }) => <DataTableColumnHeader column={column} title="진행상태" />,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <ProgressChip status={row.original.scheduleProgress} />
            {row.original.plannedDate && <span className="text-[13px] text-muted-foreground">예정 {row.original.plannedDate}</span>}
          </div>
        ),
      },
      {
        id: "manager",
        accessorFn: (row) => row.scheduleManagerName || row.managerName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="담당자" />,
        cell: ({ row }) => <span className="text-[14px]">{row.original.scheduleManagerName || row.original.managerName || "-"}</span>,
      },
      {
        id: "actions",
        header: () => <span className="text-[13px] font-medium">관리</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="text-[14px]" onClick={() => onDetail(row.original)}>
              상세
            </Button>
            {canUpdate && (
              <Button type="button" variant="ghost" size="sm" className="text-[14px]" onClick={() => onSchedule(row.original)}>
                일정
              </Button>
            )}
            {canCreate && (
              <Button type="button" variant="ghost" size="sm" className="text-[14px]" onClick={() => onRegister(row.original)}>
                실적등록
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canCreate, canUpdate, onDetail, onSchedule, onRegister],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-[14px]">
        <CalendarClock className="h-5 w-5 text-muted-foreground" />
        <span>
          기한초과 <strong className="text-red-600">{overdueCount.toLocaleString("ko-KR")}건</strong>
        </span>
        <span className="text-muted-foreground">·</span>
        <span>
          교정임박(30일 이내) <strong className="text-yellow-700">{dueSoonCount.toLocaleString("ko-KR")}건</strong>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">기준일 오늘, 교정 대상 {scheduled.length.toLocaleString("ko-KR")}대</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="관리번호 · 계측기명 검색"
            className="h-10 w-[240px] pl-9 text-[14px]"
            aria-label="관리번호 또는 계측기명 검색"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="교정상태 필터">
          {STATE_FILTERS.map((item) => (
            <Button
              key={item.value || "all"}
              type="button"
              size="sm"
              variant={state === item.value ? "default" : "outline"}
              className="text-[14px]"
              onClick={() => setState(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <SimpleSelect
          value={progress}
          onChange={setProgress}
          noneLabel="진행상태 전체"
          placeholder="진행상태 전체"
          className="w-[150px]"
          options={(Object.keys(CALIBRATION_PROGRESS_LABELS) as CalibrationProgressValue[]).map((v) => ({
            value: v,
            label: CALIBRATION_PROGRESS_LABELS[v],
          }))}
        />
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 w-[150px] text-[14px]" aria-label="차기교정일 시작" />
          <span className="text-[14px] text-muted-foreground">~</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 w-[150px] text-[14px]" aria-label="차기교정일 종료" />
        </div>
        {hasFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-[14px]"
            onClick={() => {
              setQuery("")
              setState("")
              setProgress("")
              setFrom("")
              setTo("")
              onClearKpi()
            }}
          >
            <X className="mr-1 h-4 w-4" />
            초기화
          </Button>
        )}
      </div>

      {kpi !== "ALL" && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[14px] font-medium text-primary">
          {KPI_LABELS[kpi]} 조건 적용 중
          <button type="button" onClick={onClearKpi} aria-label="카드 조건 해제" className="rounded-full p-0.5 hover:bg-primary/20">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}

      <p className="text-[14px] text-muted-foreground">
        총 <span className="font-semibold text-foreground">{rows.length.toLocaleString("ko-KR")}</span>건
      </p>

      <DataTable
        columns={columns}
        data={rows}
        pageSize={20}
        getRowId={(row) => row.id}
        defaultSorting={[{ id: "nextCalibrationDate", desc: false }]}
        onRowClick={onDetail}
      />
    </div>
  )
}
