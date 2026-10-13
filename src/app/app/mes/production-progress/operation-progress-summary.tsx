"use client"

import { useMemo } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

import type { ProductionProgressRow } from "@/lib/actions/production-progress.types"
import { formatPercent } from "./production-progress-client"
import { formatQuantity } from "@/lib/utils"

// ─── 공정별 진행 현황(NewMES 전용) ───────────────────────────────────────────────
//
// 정의: "현재 조회된 작업지시들이 지금 어느 공정에 위치하고 있는지"의 분포다.
// ProductionResult.goodQty를 공정별로 합산하는 화면이 아니다 — 다공정 작업지시에서
// 공정별 goodQty를 합치면 같은 제품이 중복 집계된다(생산진행 현황 전체의 핵심 원칙).
// 그래서 이 컴포넌트는 row.currentOperation 위치만 세고, ProductionResult는
// 아예 참조하지 않는다.
//
// 추가 DB 조회 0건: getOperationProgressList()/fetchProductionStats() 등 다른
// Server Action을 부르지 않는다. 상단 필터로 이미 확정된 data.rows를 그대로 다시
// 쓴다 — 그래야 기간/사업장/품목/현재공정/작업지시상태 필터, DataTable, 생산 요약,
// 이 화면이 전부 같은 기준으로 움직인다.

const WAITING_KEY = "__WAITING__"
const WAITING_LABEL = "대기"

// 기존 프로젝트에 --chart-N 같은 차트 전용 theme 변수가 없어(전체 검색으로 확인),
// 이미 화면 곳곳의 상태 배지에서 쓰는 색상 계열(blue/emerald/amber/violet/red/cyan/pink
// 600 shade)을 그대로 순환시킨다. "대기"는 실제 생산공정이 아니므로 이 팔레트에
// 섞지 않고 별도의 중립 회색으로 고정한다.
const OPERATION_COLORS = [
  "#2563eb", // blue-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#7c3aed", // violet-600
  "#dc2626", // red-600
  "#0891b2", // cyan-600
  "#db2777", // pink-600
]
const WAITING_COLOR = "#94a3b8" // slate-400

type OperationProgressEntry = {
  key: string
  operationName: string
  workOrderCount: number
  wipQty: number
  ratio: number
  isWaiting: boolean
  color: string
}

function aggregateByCurrentOperation(rows: ProductionProgressRow[]): OperationProgressEntry[] {
  const totalCount = rows.length
  const grouped = new Map<string, { operationName: string; workOrderCount: number; wipQty: number; isWaiting: boolean }>()

  for (const row of rows) {
    // currentOperation === null은 "자재출고 전"과 "판정 불가"를 구분할 수 없으므로
    // (2단계 분석 결과) 단정하지 않고 안전하게 "대기" 한 그룹으로 모은다.
    const isWaiting = row.currentOperation == null
    const operationName = row.currentOperation?.operationName ?? WAITING_LABEL
    // 서로 다른 Routing의 동일 이름 공정은 이 현황에서는 이름 기준으로 병합한다
    // (상단 "현재공정" 필터는 RoutingOperation.id 기준을 그대로 유지 — 이 파일은
    // 그 필터 동작을 건드리지 않는다).
    const key = isWaiting ? WAITING_KEY : operationName

    const existing = grouped.get(key)
    if (existing) {
      existing.workOrderCount += 1
      existing.wipQty += row.wipQty
    } else {
      grouped.set(key, { operationName, workOrderCount: 1, wipQty: row.wipQty, isWaiting })
    }
  }

  const entries = Array.from(grouped.entries()).map(([key, value], index) => ({
    key,
    operationName: value.operationName,
    workOrderCount: value.workOrderCount,
    wipQty: value.wipQty,
    ratio: totalCount > 0 ? (value.workOrderCount / totalCount) * 100 : 0,
    isWaiting: value.isWaiting,
    color: value.isWaiting ? WAITING_COLOR : OPERATION_COLORS[index % OPERATION_COLORS.length],
  }))

  entries.sort((a, b) => {
    if (a.isWaiting !== b.isWaiting) return a.isWaiting ? 1 : -1 // 대기는 항상 마지막
    if (b.workOrderCount !== a.workOrderCount) return b.workOrderCount - a.workOrderCount
    return a.operationName.localeCompare(b.operationName, "ko")
  })

  return entries
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: OperationProgressEntry }[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0].payload
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-[13px] shadow-sm">
      <p className="font-medium text-foreground">{entry.operationName}</p>
      <p className="text-muted-foreground">작업지시 {formatQuantity(entry.workOrderCount)}건</p>
      <p className="text-muted-foreground">비율 {formatPercent(entry.ratio)}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="py-12 text-center text-[14px] text-muted-foreground">
      조회 조건에 해당하는 공정 진행 데이터가 없습니다.
    </div>
  )
}

interface Props {
  rows: ProductionProgressRow[]
}

export function OperationProgressSummary({ rows }: Props) {
  const entries = useMemo(() => aggregateByCurrentOperation(rows), [rows])
  const totalCount = rows.length

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card p-4">
      <h2 className="text-[18px] font-semibold text-foreground">공정별 진행 현황</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        현재 조회된 작업지시가 어느 공정에서 진행 중인지 보여줍니다.
      </p>

      {totalCount === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* 도넛 차트 */}
          <div className="relative lg:col-span-2">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={entries}
                  dataKey="workOrderCount"
                  nameKey="operationName"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={entries.length > 1 ? 2 : 0}
                  stroke="none"
                >
                  {entries.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[22px] font-semibold tabular-nums text-foreground">
                {formatQuantity(totalCount)}
              </span>
              <span className="text-[12px] text-muted-foreground">총 작업지시</span>
            </div>
          </div>

          {/* 공정별 상세 목록 */}
          <div className="overflow-x-auto lg:col-span-3">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-[13px] font-medium text-muted-foreground">공정</th>
                  <th className="px-3 py-2 text-right text-[13px] font-medium text-muted-foreground">작업지시</th>
                  <th className="px-3 py-2 text-right text-[13px] font-medium text-muted-foreground">재공수량</th>
                  <th className="px-3 py-2 text-right text-[13px] font-medium text-muted-foreground">비율</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.key} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        {entry.operationName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatQuantity(entry.workOrderCount)}건
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatQuantity(entry.wipQty)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatPercent(entry.ratio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
