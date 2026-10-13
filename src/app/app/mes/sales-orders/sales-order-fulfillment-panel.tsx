"use client"

import { useState, useEffect, useCallback } from "react"
import { ChevronDown, ChevronRight, PackageSearch } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { getSalesOrderFulfillmentStatus, FulfillmentRow } from "@/lib/actions/sales-order.actions"
import { formatQuantity } from "@/lib/utils"

interface Props {
  tenantId: string
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="border rounded-xl px-5 py-4 bg-card">
      <p className="text-[13px] text-muted-foreground mb-1">{label}</p>
      <p
        className={`text-[24px] font-semibold tabular-nums ${
          highlight && value > 0 ? "text-red-600" : "text-foreground"
        }`}
      >
        {formatQuantity(value)}
      </p>
    </div>
  )
}

export function SalesOrderFulfillmentPanel({ tenantId }: Props) {
  const [includeNonConfirmed, setIncludeNonConfirmed] = useState(false)
  const [rows, setRows] = useState<FulfillmentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getSalesOrderFulfillmentStatus(tenantId, includeNonConfirmed)
      setRows(data)
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, includeNonConfirmed])

  useEffect(() => {
    load()
  }, [load])

  const totalConfirmed = rows.reduce((s, r) => s + r.confirmedQty, 0)
  const totalInProduction = rows.reduce((s, r) => s + r.inProductionQty, 0)
  const shortageCount = rows.filter((r) => r.shortageQty > 0).length

  const toggleExpand = (itemId: string) => {
    setExpandedItemId((prev) => (prev === itemId ? null : itemId))
  }

  return (
    <div className="space-y-6">
      {/* 컨트롤 바 */}
      <div className="flex items-center gap-3 p-4 border rounded-xl bg-muted/30">
        <Switch
          id="include-draft"
          checked={includeNonConfirmed}
          onCheckedChange={setIncludeNonConfirmed}
        />
        <div>
          <Label htmlFor="include-draft" className="text-[14px] font-medium cursor-pointer">
            예상 수요 포함 (DRAFT 수주 포함)
          </Label>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            토글 시 확정 전 수주도 수요량에 반영됩니다
          </p>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="수주 확정 대기" value={totalConfirmed} />
        <StatCard label="생산 중" value={totalInProduction} />
        <StatCard label="자재 부족 품목" value={shortageCount} highlight />
      </div>

      {/* 메인 테이블 */}
      {isLoading ? (
        <div className="border rounded-xl py-16 text-center text-[14px] text-muted-foreground">
          데이터를 불러오는 중...
        </div>
      ) : rows.length === 0 ? (
        <div className="border rounded-xl py-16 flex flex-col items-center gap-3 text-muted-foreground">
          <PackageSearch className="h-10 w-10 opacity-30" />
          <p className="text-[15px] font-medium">모든 수주 품목의 자재가 충분합니다</p>
          <p className="text-[13px]">현재 진행 중인 수주에 대한 자재 부족이 없습니다.</p>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  품목명
                </th>
                <th className="text-right px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  총수주량
                </th>
                <th className="text-right px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  완제품재고
                </th>
                <th className="text-right px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  반제품충당
                </th>
                <th className="text-right px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  원자재충당
                </th>
                <th className="text-right px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  총충족가능
                </th>
                <th className="text-right px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  부족분
                </th>
                <th className="text-center px-4 py-3 text-[13px] font-medium text-muted-foreground">
                  자재부족
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <>
                  <tr
                    key={row.itemId}
                    className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                  >
                    {/* 품목명 */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {row.itemCode}
                        </span>
                        <span className="text-[14px] font-medium">{row.itemName}</span>
                      </div>
                    </td>

                    {/* 총수주량 */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[14px] font-medium tabular-nums">
                          {formatQuantity(row.totalOrderedQty)}
                        </span>
                        <span className="text-[12px] text-muted-foreground tabular-nums">
                          확정 {formatQuantity(row.confirmedQty)} / 생산중 {formatQuantity(row.inProductionQty)}
                        </span>
                      </div>
                    </td>

                    {/* 완제품재고 */}
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`text-[14px] font-medium tabular-nums ${
                          row.finishedGoodsStock >= row.totalOrderedQty
                            ? "text-green-700"
                            : row.finishedGoodsStock > 0
                            ? "text-amber-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatQuantity(row.finishedGoodsStock)}
                      </span>
                    </td>

                    {/* 반제품충당 */}
                    <td className="px-4 py-3 text-right">
                      {row.fromSemiFinished > 0 ? (
                        <span className="text-[14px] tabular-nums text-blue-600 font-medium">
                          {formatQuantity(row.fromSemiFinished)}
                        </span>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 원자재충당 */}
                    <td className="px-4 py-3 text-right">
                      {row.fromRawMaterial > 0 ? (
                        <span className="text-[14px] tabular-nums text-blue-600 font-medium">
                          {formatQuantity(row.fromRawMaterial)}
                        </span>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* 총충족가능 */}
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`text-[14px] font-semibold tabular-nums ${
                          row.shortageQty > 0 ? "text-amber-600" : "text-green-700"
                        }`}
                      >
                        {formatQuantity(row.totalFulfillable)}
                      </span>
                    </td>

                    {/* 부족분 */}
                    <td className="px-4 py-3 text-right">
                      {row.shortageQty > 0 ? (
                        <span className="text-[14px] font-bold tabular-nums text-red-600">
                          -{formatQuantity(row.shortageQty)}
                        </span>
                      ) : (
                        <span className="text-[13px] font-medium text-green-700">충분</span>
                      )}
                    </td>

                    {/* 자재부족 */}
                    <td className="px-4 py-3 text-center">
                      {row.materialShortages.length > 0 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[13px] text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => toggleExpand(row.itemId)}
                        >
                          {expandedItemId === row.itemId ? (
                            <ChevronDown className="h-3.5 w-3.5 mr-1" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 mr-1" />
                          )}
                          상세 보기
                        </Button>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>

                  {/* 확장 행: 부족 자재 상세 */}
                  {expandedItemId === row.itemId && row.materialShortages.length > 0 && (
                    <tr key={`${row.itemId}-expanded`} className="bg-red-50/50 border-b">
                      <td colSpan={8} className="px-4 py-0">
                        <div className="py-3 pl-6 border-l-2 border-red-300 ml-2">
                          <p className="text-[13px] font-semibold text-red-700 mb-2">
                            부족 자재 목록 — 발주 필요
                          </p>
                          <div className="border rounded-lg overflow-hidden border-red-100">
                            <table className="w-full text-[13px]">
                              <thead>
                                <tr className="bg-red-100/60 border-b border-red-100">
                                  <th className="text-left px-3 py-2 font-medium text-red-800">
                                    자재코드
                                  </th>
                                  <th className="text-left px-3 py-2 font-medium text-red-800">
                                    자재명
                                  </th>
                                  <th className="text-right px-3 py-2 font-medium text-red-800">
                                    필요수량
                                  </th>
                                  <th className="text-right px-3 py-2 font-medium text-red-800">
                                    현재재고
                                  </th>
                                  <th className="text-right px-3 py-2 font-medium text-red-800">
                                    부족분 (발주 필요)
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.materialShortages.map((ms) => (
                                  <tr
                                    key={ms.itemId}
                                    className="border-b border-red-100 last:border-b-0"
                                  >
                                    <td className="px-3 py-2">
                                      <span className="font-mono text-[12px] text-muted-foreground">
                                        {ms.itemCode}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 font-medium">{ms.itemName}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                      {formatQuantity(ms.neededQty)} {ms.uom}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                      {formatQuantity(ms.availableQty)} {ms.uom}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      <span className="font-bold tabular-nums text-red-600">
                                        -{formatQuantity(ms.shortageQty)} {ms.uom}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
