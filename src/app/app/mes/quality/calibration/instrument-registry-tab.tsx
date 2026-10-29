"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertTriangle, Download, FileSpreadsheet, Plus, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, DataTableColumnHeader } from "@/components/common/data-table"
import { exportInstrumentRows } from "@/lib/actions/instrument-calibration.actions"
import {
  CALIBRATION_STATE_LABELS,
  USAGE_STATUS_LABELS,
  type CalibrationStateValue,
  type InstrumentUsageStatusValue,
} from "@/lib/instrument-calibration"
import { filterInstrumentRows, type InstrumentFilters, type InstrumentRow, type KpiKey } from "@/lib/instrument-calibration-view"
import { downloadCalibrationWorkbook } from "./calibration-excel"
import {
  CalibrationStateChip,
  SimpleSelect,
  UsageStatusChip,
  formatDate,
} from "./calibration-ui"

export const KPI_LABELS: Record<KpiKey, string> = {
  ALL: "전체 계측기",
  USABLE: "사용가능 계측기",
  DUE_SOON: "교정임박 계측기",
  OVERDUE: "교정기한초과 계측기",
  INACTIVE: "사용중지·폐기 계측기",
}

type Props = {
  instruments: InstrumentRow[]
  kpi: KpiKey
  onClearKpi: () => void
  categories: string[]
  departments: string[]
  canCreate: boolean
  canUpdate: boolean
  canExport: boolean
  onCreate: () => void
  onImport: () => void
  onDetail: (row: InstrumentRow) => void
  onEdit: (row: InstrumentRow) => void
  onNotice: (type: "success" | "error", message: string) => void
}

export function InstrumentRegistryTab({
  instruments,
  kpi,
  onClearKpi,
  categories,
  departments,
  canCreate,
  canUpdate,
  canExport,
  onCreate,
  onImport,
  onDetail,
  onEdit,
  onNotice,
}: Props) {
  const [query, setQuery] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [department, setDepartment] = React.useState("")
  const [usageStatus, setUsageStatus] = React.useState("")
  const [calibrationState, setCalibrationState] = React.useState("")
  const [exporting, setExporting] = React.useState(false)

  const filters: InstrumentFilters = React.useMemo(
    () => ({
      query,
      category,
      department,
      usageStatus: usageStatus as InstrumentUsageStatusValue | "",
      calibrationState: calibrationState as CalibrationStateValue | "",
      kpi,
    }),
    [query, category, department, usageStatus, calibrationState, kpi],
  )
  const rows = React.useMemo(() => filterInstrumentRows(instruments, filters), [instruments, filters])
  const hasFilter = Boolean(query || category || department || usageStatus || calibrationState || kpi !== "ALL")

  function resetFilters() {
    setQuery("")
    setCategory("")
    setDepartment("")
    setUsageStatus("")
    setCalibrationState("")
    onClearKpi()
  }

  async function handleExport() {
    setExporting(true)
    const response = await exportInstrumentRows(filters)
    if (!response.ok) {
      setExporting(false)
      onNotice("error", response.error)
      return
    }
    await downloadCalibrationWorkbook({
      fileLabel: "계측기_검교정현황",
      sheetName: "계측기 검교정 현황",
      header: response.data.header,
      rows: response.data.rows,
    })
    setExporting(false)
    onNotice("success", `${response.data.count.toLocaleString("ko-KR")}건을 엑셀로 내려받았습니다.`)
  }

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
        accessorKey: "specification",
        header: ({ column }) => <DataTableColumnHeader column={column} title="규격" />,
        cell: ({ row }) => <span className="text-[14px]">{row.original.specification || "-"}</span>,
      },
      {
        accessorKey: "serialNo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Serial No" />,
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.serialNo || "-"}</span>,
      },
      {
        accessorKey: "manufacturer",
        header: ({ column }) => <DataTableColumnHeader column={column} title="제조사" />,
        cell: ({ row }) => <span className="text-[14px]">{row.original.manufacturer || "-"}</span>,
      },
      {
        accessorKey: "intervalLabel",
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정주기" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-[14px]">{row.original.intervalLabel}</span>,
      },
      {
        accessorKey: "department",
        header: ({ column }) => <DataTableColumnHeader column={column} title="사용부서" />,
        cell: ({ row }) => (
          <span className="text-[14px]">{[row.original.department, row.original.location].filter(Boolean).join(" / ") || "-"}</span>
        ),
      },
      {
        id: "lastCalibrationDate",
        accessorFn: (row) => row.lastCalibrationDate ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="최근교정일" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-[14px]">{formatDate(row.original.lastCalibrationDate)}</span>,
      },
      {
        id: "nextCalibrationDate",
        accessorFn: (row) => row.nextCalibrationDate ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="차기교정일" />,
        cell: ({ row }) => (
          <span
            className={`whitespace-nowrap text-[14px] ${row.original.calibrationState === "OVERDUE" ? "font-semibold text-red-600" : ""}`}
          >
            {formatDate(row.original.nextCalibrationDate)}
          </span>
        ),
      },
      {
        accessorKey: "calibrationState",
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정상태" />,
        cell: ({ row }) => <CalibrationStateChip state={row.original.calibrationState} />,
      },
      {
        accessorKey: "usageStatus",
        header: ({ column }) => <DataTableColumnHeader column={column} title="사용상태" />,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <UsageStatusChip status={row.original.usageStatus} />
            {row.original.usageStatus === "AVAILABLE" && !row.original.usable && (
              <span className="text-[13px] text-red-600">사용불가 사유 있음</span>
            )}
          </div>
        ),
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
              <Button type="button" variant="ghost" size="sm" className="text-[14px]" onClick={() => onEdit(row.original)}>
                수정
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canUpdate, onDetail, onEdit],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          <SimpleSelect
            value={category}
            onChange={setCategory}
            noneLabel="분류 전체"
            placeholder="분류 전체"
            className="w-[150px]"
            options={categories.map((item) => ({ value: item, label: item }))}
          />
          <SimpleSelect
            value={department}
            onChange={setDepartment}
            noneLabel="사용부서 전체"
            placeholder="사용부서 전체"
            className="w-[160px]"
            options={departments.map((item) => ({ value: item, label: item }))}
          />
          <SimpleSelect
            value={usageStatus}
            onChange={setUsageStatus}
            noneLabel="사용상태 전체"
            placeholder="사용상태 전체"
            className="w-[150px]"
            options={(Object.keys(USAGE_STATUS_LABELS) as InstrumentUsageStatusValue[]).map((v) => ({ value: v, label: USAGE_STATUS_LABELS[v] }))}
          />
          <SimpleSelect
            value={calibrationState}
            onChange={setCalibrationState}
            noneLabel="교정상태 전체"
            placeholder="교정상태 전체"
            className="w-[150px]"
            options={(Object.keys(CALIBRATION_STATE_LABELS) as CalibrationStateValue[]).map((v) => ({ value: v, label: CALIBRATION_STATE_LABELS[v] }))}
          />
          {hasFilter && (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters} className="text-[14px]">
              <X className="mr-1 h-4 w-4" />
              초기화
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <Button type="button" variant="outline" onClick={handleExport} disabled={exporting} className="text-[14px]">
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "내려받는 중..." : "엑셀 다운로드"}
            </Button>
          )}
          {canCreate && (
            <Button type="button" variant="outline" onClick={onImport} className="text-[14px]">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              엑셀 이관
            </Button>
          )}
          {canCreate && (
            <Button type="button" onClick={onCreate} className="text-[14px]">
              <Plus className="mr-2 h-4 w-4" />
              계측기 등록
            </Button>
          )}
        </div>
      </div>

      {kpi !== "ALL" && (
        <div className="flex items-center gap-2 text-[14px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
            {KPI_LABELS[kpi]} 조건 적용 중
            <button type="button" onClick={onClearKpi} aria-label="카드 조건 해제" className="rounded-full p-0.5 hover:bg-primary/20">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}

      <p className="text-[14px] text-muted-foreground">
        총 <span className="font-semibold text-foreground">{rows.length.toLocaleString("ko-KR")}</span>건
        {rows.length !== instruments.length && ` (전체 ${instruments.length.toLocaleString("ko-KR")}건 중)`}
      </p>

      <DataTable columns={columns} data={rows} pageSize={20} getRowId={(row) => row.id} onRowClick={onDetail} />
    </div>
  )
}
