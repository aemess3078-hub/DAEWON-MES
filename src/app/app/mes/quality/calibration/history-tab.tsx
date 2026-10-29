"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Download, Plus, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, DataTableColumnHeader } from "@/components/common/data-table"
import { exportCalibrationRows } from "@/lib/actions/instrument-calibration.actions"
import { CALIBRATION_RESULT_LABELS, type CalibrationResultValue } from "@/lib/instrument-calibration"
import { filterCalibrationRows, type CalibrationFilters, type CalibrationRow } from "@/lib/instrument-calibration-view"
import { downloadCalibrationWorkbook } from "./calibration-excel"
import { ResultChip, SimpleSelect, formatCost, formatDate } from "./calibration-ui"

type Props = {
  calibrations: CalibrationRow[]
  canCreate: boolean
  canUpdate: boolean
  canExport: boolean
  onRegister: () => void
  onEdit: (row: CalibrationRow) => void
  onCancel: (row: CalibrationRow) => void
  onOpenInstrument: (instrumentId: string) => void
  onNotice: (type: "success" | "error", message: string) => void
}

export function HistoryTab({ calibrations, canCreate, canUpdate, canExport, onRegister, onEdit, onCancel, onOpenInstrument, onNotice }: Props) {
  const [query, setQuery] = React.useState("")
  const [result, setResult] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [includeCancelled, setIncludeCancelled] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  const filters: CalibrationFilters = React.useMemo(
    () => ({ query, result: result as CalibrationResultValue | "", dateFrom: from || undefined, dateTo: to || undefined, includeCancelled }),
    [query, result, from, to, includeCancelled],
  )
  const completed = React.useMemo(() => calibrations.filter((c) => c.progressStatus === "COMPLETED"), [calibrations])
  const rows = React.useMemo(() => filterCalibrationRows(calibrations, filters), [calibrations, filters])
  const hasFilter = Boolean(query || result || from || to || includeCancelled)

  async function handleExport() {
    setExporting(true)
    const response = await exportCalibrationRows(filters)
    if (!response.ok) {
      setExporting(false)
      onNotice("error", response.error)
      return
    }
    await downloadCalibrationWorkbook({
      fileLabel: "계측기_검교정이력",
      sheetName: "검교정 이력",
      header: response.data.header,
      rows: response.data.rows,
    })
    setExporting(false)
    onNotice("success", `${response.data.count.toLocaleString("ko-KR")}건의 이력을 엑셀로 내려받았습니다.`)
  }

  const columns = React.useMemo<ColumnDef<CalibrationRow>[]>(
    () => [
      {
        accessorKey: "managementNo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="관리번호" />,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onOpenInstrument(row.original.instrumentId)}
            className="font-mono text-[14px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            {row.original.managementNo}
          </button>
        ),
      },
      {
        accessorKey: "instrumentName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="계측기명" />,
        cell: ({ row }) => <span className="text-[14px] font-medium">{row.original.instrumentName}</span>,
      },
      {
        id: "calibrationDate",
        // 교정일 미상(엑셀 이관) 이력은 차기교정일로 최신순을 맞춘다(표시는 '미기재(이관)').
        accessorFn: (row) => row.calibrationDate ?? row.nextCalibrationDate ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정일" />,
        cell: ({ row }) =>
          row.original.calibrationDate ? (
            <span className="whitespace-nowrap text-[14px]">{row.original.calibrationDate}</span>
          ) : (
            <span className="whitespace-nowrap text-[13px] text-muted-foreground">미기재(이관)</span>
          ),
      },
      {
        accessorKey: "agency",
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정기관" />,
        cell: ({ row }) => <span className="text-[14px]">{row.original.agency || "-"}</span>,
      },
      {
        accessorKey: "certificateNo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="성적서번호" />,
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.certificateNo || "-"}</span>,
      },
      {
        id: "result",
        accessorFn: (row) => (row.cancelled ? "CANCELLED" : (row.result ?? "UNKNOWN")),
        header: ({ column }) => <DataTableColumnHeader column={column} title="결과" />,
        cell: ({ row }) => <ResultChip result={row.original.result} cancelled={row.original.cancelled} />,
      },
      {
        id: "nextCalibrationDate",
        accessorFn: (row) => row.nextCalibrationDate ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="차기교정일" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[14px]">
            {formatDate(row.original.nextCalibrationDate)}
            {row.original.nextDateOverridden && (
              <span className="ml-1 text-[13px] text-amber-700" title={row.original.nextDateChangeReason}>
                (수정)
              </span>
            )}
          </span>
        ),
      },
      {
        id: "cost",
        accessorFn: (row) => row.cost ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="교정비용" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-[14px]">{formatCost(row.original.cost)}</span>,
      },
      {
        accessorKey: "managerName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="담당자" />,
        cell: ({ row }) => <span className="text-[14px]">{row.original.managerName || "-"}</span>,
      },
      {
        id: "flags",
        header: () => <span className="text-[13px] font-medium">구분</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1 text-[13px] text-muted-foreground">
            {row.original.isCurrent && <span className="font-medium text-green-700">현재 유효</span>}
            {row.original.source === "EXCEL_IMPORT" && <span>엑셀 이관</span>}
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <span className="text-[13px] font-medium">관리</span>,
        enableSorting: false,
        cell: ({ row }) =>
          canUpdate && !row.original.cancelled ? (
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" className="text-[14px]" onClick={() => onEdit(row.original)}>
                수정
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-[14px] text-red-600 hover:text-red-700" onClick={() => onCancel(row.original)}>
                취소
              </Button>
            </div>
          ) : (
            <span className="text-[13px] text-muted-foreground" title={row.original.cancelReason}>
              {row.original.cancelled ? "취소됨" : ""}
            </span>
          ),
      },
    ],
    [canUpdate, onCancel, onEdit, onOpenInstrument],
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
              placeholder="관리번호 · 계측기명 · 성적서번호"
              className="h-10 w-[260px] pl-9 text-[14px]"
              aria-label="이력 검색"
            />
          </div>
          <SimpleSelect
            value={result}
            onChange={setResult}
            noneLabel="결과 전체"
            placeholder="결과 전체"
            className="w-[140px]"
            options={(Object.keys(CALIBRATION_RESULT_LABELS) as CalibrationResultValue[]).map((v) => ({ value: v, label: CALIBRATION_RESULT_LABELS[v] }))}
          />
          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 w-[150px] text-[14px]" aria-label="교정일 시작" />
            <span className="text-[14px] text-muted-foreground">~</span>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 w-[150px] text-[14px]" aria-label="교정일 종료" />
          </div>
          <label className="flex items-center gap-2 text-[14px]">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(event) => setIncludeCancelled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            취소 이력 포함
          </label>
          {hasFilter && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-[14px]"
              onClick={() => {
                setQuery("")
                setResult("")
                setFrom("")
                setTo("")
                setIncludeCancelled(false)
              }}
            >
              <X className="mr-1 h-4 w-4" />
              초기화
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <Button type="button" variant="outline" onClick={handleExport} disabled={exporting} className="text-[14px]">
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "내려받는 중..." : "엑셀 다운로드"}
            </Button>
          )}
          {canCreate && (
            <Button type="button" onClick={onRegister} className="text-[14px]">
              <Plus className="mr-2 h-4 w-4" />
              교정 실적 등록
            </Button>
          )}
        </div>
      </div>

      <p className="text-[14px] text-muted-foreground">
        총 <span className="font-semibold text-foreground">{rows.length.toLocaleString("ko-KR")}</span>건
        {rows.length !== completed.length && ` (전체 ${completed.length.toLocaleString("ko-KR")}건 중)`}
        <span className="ml-2">· 엑셀에서 이관된 이력은 교정실시일·적합여부가 기재되어 있지 않아 &apos;미기재(이관)&apos;로 표시됩니다.</span>
      </p>

      <DataTable
        columns={columns}
        data={rows}
        pageSize={20}
        getRowId={(row) => row.id}
        defaultSorting={[
          { id: "managementNo", desc: false },
          { id: "calibrationDate", desc: true },
        ]}
      />
    </div>
  )
}
