"use client"

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import type { DailyProductionTrendPoint } from "@/lib/actions/production-progress.types"
import { formatQuantity } from "@/lib/utils"

// ─── 일별 생산실적 추이(NewMES 전용) ─────────────────────────────────────────────
//
// point.outputQty를 그대로 그린다 — 이 컴포넌트에서 생산실적을 다시 계산하지 않는다.
// getDailyProductionTrend()가 이미 "작업지시별 최종공정 ProductionResult.goodQty를
// KST 날짜별로 합산"한 Dense Series(조회기간의 모든 날짜, 실적 없는 날짜는 0)를
// 반환하므로, 여기서는 필터링/재집계/재정렬을 하지 않는다. Server Action이 생산실적의
// 유일한 정본이다.
//
// operationId(현재공정) 필터는 backend 설계상 이 데이터에 적용되지 않는다(스냅샷
// 필터 vs 이벤트 시계열의 의미 차이) — 카드 보조문구로 명시해 사용자 오해를 막는다.

function formatAxisDate(dateKey: string): string {
  const [, month, day] = dateKey.split("-")
  return `${Number(month)}/${Number(day)}`
}

function formatTooltipDate(dateKey: string): string {
  return dateKey.replaceAll("-", ".")
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: DailyProductionTrendPoint }[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-[13px] shadow-sm">
      <p className="font-medium text-foreground">{formatTooltipDate(point.date)}</p>
      <p className="text-muted-foreground">생산실적 {formatQuantity(point.outputQty)}</p>
    </div>
  )
}

interface Props {
  data: DailyProductionTrendPoint[]
}

export function DailyProductionTrendChart({ data }: Props) {
  const hasAnyOutput = data.some((point) => point.outputQty > 0)

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card p-4">
      <h2 className="text-[18px] font-semibold text-foreground">일별 생산실적 추이</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        조회기간 동안 최종공정에서 생산된 양품 실적입니다.
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground/80">
        최종공정 양품 기준 · 현재공정 필터는 적용되지 않습니다.
      </p>

      {data.length === 0 ? (
        // 정상 Server Action은 유효한 기간이면 Dense Series라 여기 도달하지 않는다.
        // 방어적으로만 처리한다.
        <p className="py-12 text-center text-[14px] text-muted-foreground">
          조회할 생산실적 데이터가 없습니다.
        </p>
      ) : (
        <>
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.4} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatAxisDate}
                  interval="preserveStartEnd"
                  minTickGap={24}
                  fontSize={12}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  width={64}
                  fontSize={12}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(value: number) => formatQuantity(value)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="outputQty"
                  name="생산실적"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!hasAnyOutput && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              조회기간에 생산실적이 없습니다.
            </p>
          )}
        </>
      )}
    </div>
  )
}
