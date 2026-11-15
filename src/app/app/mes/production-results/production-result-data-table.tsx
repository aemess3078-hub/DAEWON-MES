"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, AlertCircle, RefreshCw, TrendingDown } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/common/data-table"
import {
  ProductionResultWithDetails,
} from "@/lib/actions/production-result.actions"
import { getColumns } from "./columns"
import { formatQuantity } from "@/lib/utils"

export type ProductionResultPeriod = {
  mode: string // "7" | "30" | "90" | "all" | "custom"
  from: string
  to: string
  limit: number
  truncated: boolean
}

interface ProductionResultDataTableProps {
  data: ProductionResultWithDetails[]
  period: ProductionResultPeriod
}

const PRESETS: Array<{ key: string; label: string }> = [
  { key: "7", label: "최근 7일" },
  { key: "30", label: "최근 30일" },
  { key: "90", label: "최근 3개월" },
  { key: "all", label: "전체" },
]

export function ProductionResultDataTable({
  data,
  period,
}: ProductionResultDataTableProps) {
  const [orderNoFilter, setOrderNoFilter] = useState("")

  const filteredData = useMemo(() => {
    if (!orderNoFilter.trim()) return data
    const keyword = orderNoFilter.trim().toLowerCase()
    return data.filter((r) =>
      r.workOrderOperation.workOrder.orderNo.toLowerCase().includes(keyword)
    )
  }, [data, orderNoFilter])

  const filteredSummary = useMemo(() => {
    const totalGoodQty = filteredData.reduce((sum, r) => sum + r.goodQty, 0)
    const totalDefectQty = filteredData.reduce((sum, r) => sum + r.defectQty, 0)
    const totalReworkQty = filteredData.reduce((sum, r) => sum + r.reworkQty, 0)
    const totalProcessed = totalGoodQty + totalDefectQty + totalReworkQty
    const defectRate = totalProcessed > 0 ? (totalDefectQty / totalProcessed) * 100 : 0
    return { totalGoodQty, totalDefectQty, totalReworkQty, defectRate }
  }, [filteredData])

  const columns = getColumns()

  return (
    <div className="space-y-6">
      {/* 조회 기간 */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={`?range=${p.key}`}
            className={`rounded-md border px-3 py-1.5 text-[14px] transition-colors ${
              period.mode === p.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </Link>
        ))}
        <form method="get" className="flex items-center gap-2 pl-2">
          <input type="date" name="from" defaultValue={period.mode === "all" ? "" : period.from} required className="h-9 rounded-md border bg-background px-2 text-[14px]" aria-label="조회 시작일" />
          <span className="text-[14px] text-muted-foreground">~</span>
          <input type="date" name="to" defaultValue={period.mode === "all" ? "" : period.to} required className="h-9 rounded-md border bg-background px-2 text-[14px]" aria-label="조회 종료일" />
          <button type="submit" className="h-9 rounded-md border px-3 text-[14px] hover:bg-muted">기간 조회</button>
        </form>
        <span className="text-[13px] text-muted-foreground">
          {period.mode === "all" ? "전체 기간" : `${period.from} ~ ${period.to}`} · 실적 {formatQuantity(data.length)}건
        </span>
      </div>
      {period.truncated && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-900">
          실적이 많아 최신 {formatQuantity(period.limit)}건만 표시했습니다. 아래 합계는 표시된 건수 기준이므로, 기간을 좁혀 조회해 주세요.
        </p>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] text-muted-foreground">총 양품수량</p>
                <p className="text-[24px] font-semibold text-green-700 mt-1 leading-none">
                  {formatQuantity(filteredSummary.totalGoodQty)}
                </p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] text-muted-foreground">총 불량수량</p>
                <p
                  className={`text-[24px] font-semibold mt-1 leading-none ${
                    filteredSummary.totalDefectQty > 0
                      ? "text-red-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatQuantity(filteredSummary.totalDefectQty)}
                </p>
              </div>
              <AlertCircle
                className={`h-5 w-5 mt-0.5 ${
                  filteredSummary.totalDefectQty > 0
                    ? "text-red-500"
                    : "text-muted-foreground"
                }`}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] text-muted-foreground">총 재작업수량</p>
                <p
                  className={`text-[24px] font-semibold mt-1 leading-none ${
                    filteredSummary.totalReworkQty > 0
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {formatQuantity(filteredSummary.totalReworkQty)}
                </p>
              </div>
              <RefreshCw
                className={`h-5 w-5 mt-0.5 ${
                  filteredSummary.totalReworkQty > 0
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }`}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] text-muted-foreground">불량률</p>
                <p
                  className={`text-[24px] font-semibold mt-1 leading-none ${
                    filteredSummary.defectRate >= 5
                      ? "text-red-600"
                      : filteredSummary.defectRate > 0
                        ? "text-amber-600"
                        : "text-muted-foreground"
                  }`}
                >
                  {filteredSummary.defectRate.toFixed(1)}
                  <span className="text-[16px] font-normal ml-0.5">%</span>
                </p>
              </div>
              <TrendingDown
                className={`h-5 w-5 mt-0.5 ${
                  filteredSummary.defectRate >= 5
                    ? "text-red-500"
                    : filteredSummary.defectRate > 0
                      ? "text-amber-500"
                      : "text-muted-foreground"
                }`}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 필터 영역 */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="작업지시번호 검색..."
          value={orderNoFilter}
          onChange={(e) => setOrderNoFilter(e.target.value)}
          className="h-8 w-[200px] lg:w-[280px] text-[14px]"
        />
        {orderNoFilter && (
          <button
            onClick={() => setOrderNoFilter("")}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            초기화
          </button>
        )}
      </div>

      {/* 테이블 */}
      <DataTable
        columns={columns}
        data={filteredData}
        pageSize={20}
      />
    </div>
  )
}
