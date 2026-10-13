"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, AlertCircle, RefreshCw, TrendingDown } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/common/data-table"
import {
  ProductionResultWithDetails,
} from "@/lib/actions/production-result.actions"
import { getColumns } from "./columns"
import { formatQuantity } from "@/lib/utils"

interface ProductionResultDataTableProps {
  data: ProductionResultWithDetails[]
}

export function ProductionResultDataTable({
  data,
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
