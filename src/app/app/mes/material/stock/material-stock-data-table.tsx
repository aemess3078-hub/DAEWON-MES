"use client"

import { useMemo, useState } from "react"
import { Search, AlertTriangle } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { getGroupedColumns } from "./columns"
import type { GroupedMaterialStock } from "@/lib/actions/inventory.actions"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { StockAdjustmentDialog } from "../../inventory/stock-adjustment-dialog"
import { StockTransferDialog } from "../../inventory/stock-transfer-dialog"
import { formatQuantity } from "@/lib/utils"
import { applyZeroStockPolicyToGroup } from "@/lib/stock-zero-policy"

function formatDate(value: string | null | undefined): string {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toISOString().slice(0, 10)
}

// ── LOT 상세 (행 아래 inline 펼침 내용) ───────────────────────────────────────

function LotDetailContent({ item }: { item: GroupedMaterialStock }) {
  const role = useUserRole()
  const canAdjust = role === "OWNER" || role === "ADMIN" || role === "MANAGER"
  // LOT 관리 품목에 한해 LOT 미지정 재고를 경고 대상으로 본다.
  const unlottedRows = item.isLotTracked
    ? item.lotBalances.filter((b) => !b.lotId && b.qtyOnHand > 0)
    : []
  const lottedRows = item.lotBalances.filter((b) => b.lotId)
  // 비LOT 품목은 lotId가 없는 것이 정상 → 창고별 재고로 그대로 표시
  const nonLotRows = item.lotBalances

  return (
    <div className="border-l-2 border-blue-300 bg-blue-50/30 px-4 py-3">
      <p className="mb-2 text-[13px] font-semibold text-foreground">
        [{item.itemCode}] {item.itemName} · {item.isLotTracked ? "LOT별 재고" : "창고별 재고"}
      </p>

      {/* LOT 미지정 경고 — LOT 관리 품목에만 표시 */}
      {unlottedRows.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-[13px] font-semibold text-amber-800">LOT 미지정 재고 있음</p>
            <p className="text-[12px] text-amber-700">
              이 품목은 LOT 관리 대상이지만 LOT가 지정되지 않은 재고가 있어 출고 대상에서 제외됩니다.
              관리자에게 재고 정리를 요청하세요.
            </p>
            {unlottedRows.map((b) => (
              <p key={b.balanceId} className="mt-1 text-[12px] text-amber-700 font-mono">
                [{b.warehouseCode}] {b.warehouseName} — 현재고 {formatQuantity(b.qtyOnHand)} {item.uom}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 비LOT 품목 안내 */}
      {!item.isLotTracked && (
        <p className="mb-2 text-[12px] text-muted-foreground">
          LOT 관리를 사용하지 않는 품목입니다. 창고별 재고만 표시됩니다.
        </p>
      )}

      {/* 재고 테이블 (LOT 관리: LOT별 / 비LOT: 창고별) */}
      {(item.isLotTracked ? lottedRows : nonLotRows).length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[700px] text-[13px]">
            <thead>
              <tr className="border-b bg-muted/30">
                {item.isLotTracked && (
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">LOT 번호</th>
                )}
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">창고 / 사이트</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">현재고</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">가용재고</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">보류재고</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">입고일</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">최근출고</th>
                {item.isLotTracked && (
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">유통기한</th>
                )}
                {canAdjust && (
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">조정</th>
                )}
              </tr>
            </thead>
            <tbody>
              {(item.isLotTracked ? lottedRows : nonLotRows).map((b) => (
                <tr key={b.balanceId} className="border-b last:border-0 hover:bg-muted/10">
                  {item.isLotTracked && (
                    <td className="px-3 py-2 font-mono text-blue-700">{b.lotNo ?? "-"}</td>
                  )}
                  <td className="px-3 py-2">
                    <div className="font-medium">[{b.warehouseCode}] {b.warehouseName}</div>
                    <div className="text-[12px] text-muted-foreground">{b.siteName}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatQuantity(b.qtyOnHand)}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${b.qtyAvailable <= 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {formatQuantity(b.qtyAvailable)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {b.qtyHold > 0 ? formatQuantity(b.qtyHold) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {formatDate(b.lastReceiptAt ?? b.manufactureDate)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {formatDate(b.lastIssueAt)}
                  </td>
                  {item.isLotTracked && (
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatDate(b.expiryDate)}
                    </td>
                  )}
                  {canAdjust && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <StockTransferDialog
                              target={{
                                balanceId: b.balanceId,
                                itemId: item.itemId,
                                itemCode: item.itemCode,
                                itemName: item.itemName,
                                uom: item.uom,
                                siteName: b.siteName,
                                warehouseId: b.warehouseId,
                                warehouseCode: b.warehouseCode,
                                warehouseName: b.warehouseName,
                                lotNo: b.lotNo,
                                qtyOnHand: b.qtyOnHand,
                                qtyAvailable: b.qtyAvailable,
                              }}
                            />
                        <StockAdjustmentDialog
                        target={{
                          balanceId: b.balanceId,
                          itemId: item.itemId,
                          itemCode: item.itemCode,
                          itemName: item.itemName,
                          uom: item.uom,
                          siteId: b.siteId,
                          siteName: b.siteName,
                          warehouseId: b.warehouseId,
                          warehouseCode: b.warehouseCode,
                          warehouseName: b.warehouseName,
                          lotId: b.lotId,
                          lotNo: b.lotNo,
                          qtyOnHand: b.qtyOnHand,
                        }}
                      />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        unlottedRows.length === 0 && (
          <p className="py-3 text-center text-[14px] text-muted-foreground">재고 상세가 없습니다.</p>
        )
      )}
    </div>
  )
}

// ── 메인 테이블 컴포넌트 ──────────────────────────────────────────────────────

interface MaterialStockDataTableProps {
  data: GroupedMaterialStock[]
}

export function MaterialStockDataTable({ data }: MaterialStockDataTableProps) {
  const columns = getGroupedColumns()
  const [keyword, setKeyword] = useState("")
  const [includeZero, setIncludeZero] = useState(false)

  // 재고 0 정책: 현재고 0인 LOT·창고 행은 기본 숨김, 합계/LOT 개수는 보이는 행 기준으로 재계산
  const visibleData = useMemo(() => {
    const result: GroupedMaterialStock[] = []
    for (const group of data) {
      const applied = applyZeroStockPolicyToGroup(group, group.lotBalances, includeZero)
      if (!applied) continue
      result.push({ ...applied.group, lotBalances: applied.rows })
    }
    return result
  }, [data, includeZero])

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (kw.length === 0) return visibleData
    return visibleData.filter((group) => {
      const hay = [
        group.itemCode,
        group.itemName,
        group.itemSpec ?? "",
        ...group.lotBalances.map((b) => b.lotNo ?? ""),
        ...group.lotBalances.map((b) => b.warehouseName),
      ].join(" ").toLowerCase()
      return hay.includes(kw)
    })
  }, [visibleData, keyword])

  const totalItems = filteredData.length
  const totalLines = filteredData.reduce((s, g) => s + g.lotBalances.length, 0)
  const lotCount = filteredData.reduce((s, g) => s + g.lotCount, 0)
  const totalOnHand = filteredData.reduce((s, g) => s + g.totalQtyOnHand, 0)
  const totalAvailable = filteredData.reduce((s, g) => s + g.totalQtyAvailable, 0)
  const unlottedBalances = filteredData.flatMap((g) =>
    g.isLotTracked ? g.lotBalances.filter((b) => !b.lotId && b.qtyOnHand > 0) : [],
  )
  const unlottedLines = unlottedBalances.length
  const unlottedOnHand = unlottedBalances.reduce((s, b) => s + b.qtyOnHand, 0)

  const filterableColumns = [
    {
      id: "itemType" as keyof GroupedMaterialStock,
      title: "품목유형",
      options: [
        { label: "원자재", value: "RAW_MATERIAL" },
        { label: "소모품", value: "CONSUMABLE" },
        { label: "반제품", value: "SEMI_FINISHED" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <SummaryCard label="원자재 품목" value={formatQuantity(totalItems)} suffix="종" />
        <SummaryCard label="재고 라인" value={formatQuantity(totalLines)} suffix="건" />
        <SummaryCard label="관리 LOT" value={formatQuantity(lotCount)} suffix="개" />
        <SummaryCard label="총 현재고" value={formatQuantity(totalOnHand)} />
        <SummaryCard label="총 가용재고" value={formatQuantity(totalAvailable)} accent />
        <SummaryCard
          label="LOT 미지정 데드재고"
          value={formatQuantity(unlottedOnHand)}
          suffix={`/ ${formatQuantity(unlottedLines)}건`}
          description="LOT 관리 품목 중 LOT 없이 남아 있어 출고/출하 대상에서 제외되는 재고"
          warn
        />
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="품목명 / 규격 / LOT 번호 / 창고 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 w-[320px] pl-9 text-[14px]"
          />
        </div>
        <label className="flex items-center gap-2 text-[14px] text-muted-foreground">
          <Checkbox
            checked={includeZero}
            onCheckedChange={(checked) => setIncludeZero(checked === true)}
          />
          재고 0 포함
        </label>
        <span className="text-[13px] text-muted-foreground">
          품목 행을 클릭하면 바로 아래에 재고 상세가 펼쳐집니다.
        </span>
      </div>

      {/* 품목 그룹화 테이블 — 행 클릭 시 inline 펼침 */}
      <DataTable
        columns={columns}
        data={filteredData}
        filterableColumns={filterableColumns}
        expandOnRowClick
        renderExpandedRow={(row) => <LotDetailContent item={row} />}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  suffix,
  description,
  accent,
  warn,
}: {
  label: string
  value: string
  suffix?: string
  description?: string
  accent?: boolean
  warn?: boolean
}) {
  const containerClass = warn
    ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    : "rounded-lg border border-border bg-card px-4 py-3"
  const labelClass = warn ? "text-[13px] text-amber-800" : "text-[13px] text-muted-foreground"
  const valueClass = warn
    ? "text-amber-800"
    : accent
      ? "text-emerald-700"
      : "text-foreground"
  return (
    <div className={containerClass}>
      <p className={labelClass}>{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${valueClass}`}>
        {value}
        {suffix ? (
          <span className={`ml-1 text-[14px] font-normal ${warn ? "text-amber-700" : "text-muted-foreground"}`}>
            {suffix}
          </span>
        ) : null}
      </p>
      {description ? (
        <p className={`mt-1 text-[12px] leading-snug ${warn ? "text-amber-700" : "text-muted-foreground"}`}>
          {description}
        </p>
      ) : null}
    </div>
  )
}
