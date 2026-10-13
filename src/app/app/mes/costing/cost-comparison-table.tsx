"use client"

import type { CostComparison } from "@/lib/services/costing.service"

const fmt = (n: number | null | undefined) =>
  n != null ? `\u20A9${Math.round(n).toLocaleString("ko-KR")}` : "-"

const fmtRate = (n: number | null | undefined) => {
  if (n == null) return "-"
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

function DiffCell({ value, rate }: { value: number | null; rate: number | null }) {
  if (value == null) return <td className="px-4 py-3 text-center text-muted-foreground">-</td>
  const isOver = value > 0
  const isZero = value === 0
  return (
    <td className={`px-4 py-3 text-right font-medium ${
      isZero ? "text-foreground" : isOver ? "text-red-600" : "text-emerald-600"
    }`}>
      <div>{fmt(value)}</div>
      <div className="text-[12px] opacity-80">{fmtRate(rate)}</div>
    </td>
  )
}

interface Props {
  comparison: CostComparison
}

const ROWS: { key: keyof NonNullable<CostComparison["standard"]>; label: string; rateKey: "material" | "labor" | "overhead" | "total" }[] = [
  { key: "materialCost", label: "자재비", rateKey: "material" },
  { key: "laborCost", label: "노무비", rateKey: "labor" },
  { key: "overheadCost", label: "경비", rateKey: "overhead" },
  { key: "totalCost", label: "합계", rateKey: "total" },
]

export function CostComparisonTable({ comparison }: Props) {
  const { standard, actual, diff, diffRate } = comparison

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 bg-muted/20 border-b">
        <h2 className="text-[18px] font-semibold">원가 비교</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          표준원가(BOM 기준) vs 실제원가(실적 기준)
        </p>
      </div>
      <table className="w-full text-[14px] border-collapse">
        <thead>
          <tr className="bg-muted/10 border-b">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-[12px] uppercase w-28">항목</th>
            <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[12px] uppercase">표준원가</th>
            <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[12px] uppercase">실제원가</th>
            <th className="text-right px-4 py-3 font-semibold text-muted-foreground text-[12px] uppercase">차이 / 차이율</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const isTotal = row.key === "totalCost"
            return (
              <tr key={row.key} className={`border-b last:border-0 ${isTotal ? "bg-muted/5 font-bold" : ""}`}>
                <td className="px-4 py-3 text-muted-foreground">{row.label}</td>
                <td className="px-4 py-3 text-right">
                  {standard ? fmt(standard[row.key]) : <span className="text-muted-foreground text-[12px]">계산 필요</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {actual ? fmt(actual[row.key]) : <span className="text-muted-foreground text-[12px]">계산 필요</span>}
                </td>
                <DiffCell value={diff?.[row.key] ?? null} rate={diffRate?.[row.rateKey] ?? null} />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
