"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import type { CostHistoryItem } from "@/lib/services/costing.service"

interface Props {
  history: CostHistoryItem[]
}

export function CostHistoryChart({ history }: Props) {
  // recharts용 데이터 변환
  const dateMap = new Map<string, { date: string; standard?: number; actual?: number }>()

  for (const h of history) {
    const date = new Date(h.calculatedAt).toLocaleDateString("ko-KR")
    if (!dateMap.has(date)) dateMap.set(date, { date })
    const entry = dateMap.get(date)!
    if (h.costType === "STANDARD") entry.standard = h.totalCost
    if (h.costType === "ACTUAL") entry.actual = h.totalCost
  }

  const data = Array.from(dateMap.values()).reverse()

  return (
    <div className="border rounded-xl p-5 shadow-sm">
      <h2 className="text-[18px] font-semibold mb-1">원가 추이</h2>
      <p className="text-[13px] text-muted-foreground mb-4">총 원가 변화 추이 (단위: 원)</p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis
            tickFormatter={(v: number) => `\u20A9${(v / 1000).toFixed(0)}K`}
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(value) => {
              const num = typeof value === "number" ? value : Number(value ?? 0)
              return [`\u20A9${Math.round(num).toLocaleString("ko-KR")}`, ""]
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="standard"
            name="표준원가"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="actual"
            name="실제원가"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
