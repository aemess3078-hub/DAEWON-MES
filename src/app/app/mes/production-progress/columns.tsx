"use client"

import { ColumnDef } from "@tanstack/react-table"
import { WipUnitStatus } from "@prisma/client"
import { format } from "date-fns"

import { DataTableColumnHeader } from "@/components/common/data-table"
import { Badge } from "@/components/ui/badge"
import type { ProductionProgressRow } from "@/lib/actions/production-progress.types"
import { formatQuantity } from "@/lib/utils"

// ─── 생산진행 현황 DataTable 컬럼 정의 (NewMES 전용) ─────────────────────────────
//
// 값 재계산 금지: 이 파일은 ProductionProgressRow의 값을 그대로 표시만 한다.
// (예: 생산실적을 공정별로 다시 합산하거나, 재공수량을 계획수량-생산실적으로
//  다시 계산하는 코드는 여기 존재하면 안 된다 — production-progress.service.ts가 정본.)

// 실제 currentOperation.wipStatus로 전달될 수 있는 값은 REUSABLE_WIP_STATUSES(7개) +
// COMPLETED뿐이다(service의 resolveCurrentOperation 참고). SCRAPPED는 도달하지 않는다.
const WIP_STATUS_LABELS: Partial<Record<WipUnitStatus, string>> = {
  WAITING: "대기",
  IN_PROCESS: "작업중",
  ON_HOLD: "보류",
  OUTSOURCED: "외주중",
  IN_TRANSIT: "이동중",
  RECEIVED: "외주입고",
  COMPLETED: "완료",
  REWORK: "재작업",
}

type DisplayStatus = { label: string; className: string; barClassName: string }

// 표시 우선순위: WorkOrder 자체가 COMPLETED면 "완료"를 healthStatus(NORMAL)보다 우선 표시한다.
// (service는 완료된 작업지시를 항상 NORMAL로 계산하지만, 화면에서는 "완료"가 더 명확하다.
//  계산 로직 변경이 아니라 표시 우선순위만 다르게 하는 것.)
// barClassName은 진행률 바 색상 — healthStatus/workOrderStatus와 별개의 임계값을 새로 만들지
// 않고 이 배지와 같은 판정을 그대로 재사용한다(배지는 초록인데 바는 빨간 식의 불일치 방지).
function resolveDisplayStatus(row: ProductionProgressRow): DisplayStatus {
  if (row.workOrderStatus === "COMPLETED") {
    return {
      label: "완료",
      className: "border-zinc-200 bg-zinc-50 text-zinc-700",
      barClassName: "bg-zinc-400",
    }
  }
  if (row.healthStatus === "DELAYED") {
    return {
      label: "지연",
      className: "border-red-200 bg-red-50 text-red-700",
      barClassName: "bg-red-500",
    }
  }
  if (row.healthStatus === "WARNING") {
    return {
      label: "주의",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      barClassName: "bg-amber-500",
    }
  }
  return {
    label: "정상",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    barClassName: "bg-emerald-500",
  }
}

function formatEquipmentNames(names: string[]): string {
  if (names.length === 0) return "-"
  if (names.length <= 2) return names.join(", ")
  return `${names[0]} 외 ${names.length - 1}대`
}

function formatProgressRate(rate: number): string {
  const rounded = Math.round(rate * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

function formatDate(date: Date | null): string {
  if (!date) return "-"
  return format(new Date(date), "yyyy-MM-dd")
}

export function getColumns(): ColumnDef<ProductionProgressRow>[] {
  return [
    {
      accessorKey: "orderNo",
      header: ({ column }) => <DataTableColumnHeader column={column} title="작업지시번호" />,
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium text-primary">
          {row.original.orderNo || "-"}
        </span>
      ),
    },
    {
      id: "item",
      accessorFn: (row) => row.itemName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="품목" />,
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <p className="text-[14px] font-medium text-foreground">{row.original.itemName}</p>
          <p className="font-mono text-[13px] text-muted-foreground">{row.original.itemCode}</p>
        </div>
      ),
    },
    {
      id: "currentOperation",
      accessorFn: (row) => row.currentOperation?.operationName ?? "",
      header: ({ column }) => <DataTableColumnHeader column={column} title="현재공정" />,
      cell: ({ row }) => {
        const current = row.original.currentOperation
        if (!current) {
          // 자재출고 전 / 판정 불가 두 경우를 Row만으로 구분할 수 없으므로
          // 안전하게 "대기"로만 표시한다(§26 — phase/reason 필드 추가 후 구체화 예정).
          return <span className="text-[13px] text-muted-foreground">대기</span>
        }
        const wipLabel = current.wipStatus ? WIP_STATUS_LABELS[current.wipStatus] : null
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] text-foreground">{current.operationName}</span>
            {wipLabel && (
              <Badge
                variant="outline"
                className="border-slate-200 bg-slate-50 px-1.5 py-0 text-[11px] text-slate-600"
              >
                {wipLabel}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "plannedQty",
      header: ({ column }) => <DataTableColumnHeader column={column} title="계획수량" />,
      cell: ({ row }) => (
        <span className="block text-right text-[14px] tabular-nums text-foreground">
          {formatQuantity(row.original.plannedQty)} {row.original.itemUom}
        </span>
      ),
    },
    {
      accessorKey: "productionOutputQty",
      header: ({ column }) => <DataTableColumnHeader column={column} title="생산실적" />,
      cell: ({ row }) => (
        <span className="block text-right text-[14px] tabular-nums text-foreground">
          {formatQuantity(row.original.productionOutputQty)} {row.original.itemUom}
        </span>
      ),
    },
    {
      accessorKey: "progressRate",
      header: ({ column }) => <DataTableColumnHeader column={column} title="생산 달성률" />,
      cell: ({ row }) => {
        const rate = row.original.progressRate
        const display = resolveDisplayStatus(row.original)
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${display.barClassName}`}
                style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-foreground">
              {formatProgressRate(rate)}
            </span>
          </div>
        )
      },
    },
    {
      id: "status",
      accessorFn: (row) => row.healthStatus,
      header: ({ column }) => <DataTableColumnHeader column={column} title="진행상태" />,
      cell: ({ row }) => {
        const display = resolveDisplayStatus(row.original)
        return (
          <Badge variant="outline" className={`text-[12px] ${display.className}`}>
            {display.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: "wipQty",
      header: ({ column }) => <DataTableColumnHeader column={column} title="재공수량" />,
      cell: ({ row }) => (
        <span className="block text-right text-[14px] tabular-nums text-foreground">
          {formatQuantity(row.original.wipQty)} {row.original.itemUom}
        </span>
      ),
    },
    {
      id: "equipmentNames",
      accessorFn: (row) => row.equipmentNames.join(", "),
      header: ({ column }) => <DataTableColumnHeader column={column} title="배정설비" />,
      cell: ({ row }) => (
        <span className="text-[13px] text-foreground">
          {formatEquipmentNames(row.original.equipmentNames)}
        </span>
      ),
    },
    {
      id: "startedAt",
      accessorFn: (row) => (row.startedAt ? new Date(row.startedAt).getTime() : 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="시작일" />,
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {formatDate(row.original.startedAt)}
        </span>
      ),
    },
    {
      id: "dueDate",
      accessorFn: (row) => (row.dueDate ? new Date(row.dueDate).getTime() : 0),
      header: ({ column }) => <DataTableColumnHeader column={column} title="완료예정일" />,
      cell: ({ row }) => (
        <span className="text-[13px] text-muted-foreground">
          {formatDate(row.original.dueDate)}
        </span>
      ),
    },
  ]
}
