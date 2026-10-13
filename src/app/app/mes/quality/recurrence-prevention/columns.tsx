"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatQuantity } from "@/lib/utils"
import type { DefectRecurrencePreventionRow } from "@/lib/actions/defect-recurrence-prevention.actions"

export type { DefectRecurrencePreventionRow }

export const STATUS_CONFIG: Record<
  DefectRecurrencePreventionRow["status"],
  { label: string; className: string }
> = {
  OPEN:        { label: "등록",     className: "bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "대책수행중", className: "bg-blue-100 text-blue-700" },
  VERIFYING:   { label: "검증중",   className: "bg-amber-100 text-amber-800" },
  COMPLETED:   { label: "완료",     className: "bg-green-100 text-green-800" },
}

export const VERIFICATION_RESULT_CONFIG: Record<string, { label: string; className: string }> = {
  EFFECTIVE:   { label: "유효",   className: "bg-green-100 text-green-800" },
  INEFFECTIVE: { label: "무효",   className: "bg-red-100 text-red-700" },
}

const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: "치명",
  MAJOR: "주요",
  MINOR: "경미",
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function getColumns(
  onViewDetail: (row: DefectRecurrencePreventionRow) => void
): ColumnDef<DefectRecurrencePreventionRow>[] {
  return [
    {
      accessorKey: "inspectedAt",
      header: "불량발생일",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-[13px] text-muted-foreground">
          {fmtDateTime(row.original.inspectedAt)}
        </span>
      ),
    },
    {
      id: "orderNo",
      accessorFn: (row) => `${row.orderNo} ${row.manufacturingNo ?? ""}`,
      header: "작업지시 / 제조번호",
      cell: ({ row }) => (
        <div>
          <p className="font-mono text-[13px]">{row.original.orderNo}</p>
          <p className="font-mono text-[12px] text-blue-700">{row.original.manufacturingNo ?? "-"}</p>
        </div>
      ),
    },
    {
      id: "itemName",
      accessorFn: (row) => `${row.itemCode} ${row.itemName}`,
      header: "품목",
      cell: ({ row }) => (
        <div>
          <p className="text-[14px] font-medium">{row.original.itemName}</p>
          <p className="font-mono text-[12px] text-muted-foreground">{row.original.itemCode}</p>
        </div>
      ),
    },
    {
      id: "defectCodeName",
      accessorFn: (row) => `${row.defectCode} ${row.defectCodeName}`,
      header: "불량유형 / 수량",
      cell: ({ row }) => (
        <div>
          <p className="text-[13px]">[{row.original.defectCode}] {row.original.defectCodeName}</p>
          <p className="text-[12px] text-muted-foreground">
            {formatQuantity(row.original.defectQty)} · {SEVERITY_LABEL[row.original.severity] ?? row.original.severity}
          </p>
        </div>
      ),
    },
    {
      id: "correctiveActionSummary",
      header: "관련 조치",
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground whitespace-nowrap">
          완료 {row.original.correctiveActionCompleted}/{row.original.correctiveActionTotal}건
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "preventionContent",
      header: "재발방지 대책",
      cell: ({ row }) => (
        <p className="max-w-[220px] truncate text-[13px]" title={row.original.preventionContent}>
          {row.original.preventionContent}
        </p>
      ),
    },
    {
      id: "assignee",
      accessorFn: (row) => row.assigneeName ?? "",
      header: "담당자",
      cell: ({ row }) => (
        <span className="text-[13px]">{row.original.assigneeName ?? "미지정"}</span>
      ),
    },
    {
      accessorKey: "dueDate",
      header: "목표일",
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <span className="text-[13px]">{fmtDate(row.original.dueDate)}</span>
          {row.original.overdue && (
            <Badge className="ml-1.5 bg-red-100 text-red-700 border-0 text-[11px]">기한초과</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "상태",
      cell: ({ row }) => {
        const cfg = STATUS_CONFIG[row.original.status]
        return <Badge className={`${cfg.className} border-0 text-[12px] font-medium`}>{cfg.label}</Badge>
      },
    },
    {
      id: "verificationResult",
      accessorFn: (row) => row.verificationResult ?? "",
      header: "효과성 검증",
      cell: ({ row }) => {
        const result = row.original.verificationResult
        if (!result) return <span className="text-[13px] text-muted-foreground">-</span>
        const cfg = VERIFICATION_RESULT_CONFIG[result]
        return <Badge className={`${cfg.className} border-0 text-[12px] font-medium`}>{cfg.label}</Badge>
      },
    },
    {
      id: "actions",
      header: "작업",
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => onViewDetail(row.original)}>
          상세
        </Button>
      ),
      enableSorting: false,
    },
  ]
}
