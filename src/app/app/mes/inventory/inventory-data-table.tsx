"use client"

import { useMemo, useState } from "react"
import { Search, AlertTriangle } from "lucide-react"
import { DataTable } from "@/components/common/data-table"
import { getGroupedInventoryColumns } from "./columns"
import type { GroupedInventoryStock } from "@/lib/actions/inventory.actions"
import { Input } from "@/components/ui/input"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { StockAdjustmentDialog } from "./stock-adjustment-dialog"
import { formatQuantity } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Site {
  id: string
  code: string
  name: string
}

// ── LOT/창고별 상세 (행 아래 inline 펼침) ──────────────────────────────────────

function InventoryDetailContent({ item }: { item: GroupedInventoryStock }) {
  const role = useUserRole()
  const canAdjust = role === "OWNER" || role === "ADMIN" || role === "MANAGER"

  // item.balances 는 이미 site/warehouse 필터 적용 후 전달된 데이터
  const unlottedRows = item.isLotTracked
    ? item.balances.filter((b) => !b.lotId && b.qtyOnHand > 0)
    : []
  const displayRows = item.isLotTracked
    ? item.balances.filter((b) => b.lotId)
    : item.balances

  return (
    <div className="border-l-2 border-blue-300 bg-blue-50/30 px-4 py-3">
      <p className="mb-2 text-[13px] font-semibold text-foreground">
        [{item.itemCode}] {item.itemName} &middot;{" "}
        {item.isLotTracked ? "LOT별 재고" : "창고별 재고"}
      </p>

      {/* LOT 미지정 경고 — LOT 관리 품목에만 표시 */}
      {unlottedRows.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-[13px] font-semibold text-amber-800">LOT 미지정 재고 있음</p>
            <p className="text-[12px] text-amber-700">
              이 품목은 LOT 관리 대상이지만 LOT가 지정되지 않은 재고가 있어 출고 대상에서 제외됩니다.
            </p>
            {unlottedRows.map((b) => (
              <p key={b.balanceId} className="mt-1 font-mono text-[12px] text-amber-700">
                [{b.warehouseCode}] {b.warehouseName} — 현재고{" "}
                {formatQuantity(b.qtyOnHand)} {item.uom}
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

      {/* 상세 테이블 */}
      {displayRows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  LOT 번호
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  창고 / 사이트
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  현재고
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  가용재고
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  보류재고
                </th>
                {canAdjust && (
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    조정
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((b) => (
                <tr key={b.balanceId} className="border-b last:border-0 hover:bg-muted/10">
                  <td className="px-3 py-2 font-mono">
                    {item.isLotTracked ? (
                      <span className="text-blue-700">{b.lotNo ?? "-"}</span>
                    ) : (
                      <span className="text-muted-foreground">LOT 미적용</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      [{b.warehouseCode}] {b.warehouseName}
                    </div>
                    <div className="text-[12px] text-muted-foreground">{b.siteName}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatQuantity(b.qtyOnHand)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      b.qtyAvailable <= 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {formatQuantity(b.qtyAvailable)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {b.qtyHold > 0 ? formatQuantity(b.qtyHold) : "-"}
                  </td>
                  {canAdjust && (
                    <td className="px-3 py-2 text-right">
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
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        unlottedRows.length === 0 && (
          <p className="py-3 text-center text-[14px] text-muted-foreground">
            재고 상세가 없습니다.
          </p>
        )
      )}
    </div>
  )
}

// ── 메인 테이블 컴포넌트 ──────────────────────────────────────────────────────

interface InventoryDataTableProps {
  data: GroupedInventoryStock[]
  sites: Site[]
}

export function InventoryDataTable({ data, sites }: InventoryDataTableProps) {
  const columns = getGroupedInventoryColumns()
  const [selectedSiteId, setSelectedSiteId] = useState<string>("all")
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("all")
  const [keyword, setKeyword] = useState("")

  // 선택된 사이트 기준으로 창고 목록 생성
  const warehouseOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const group of data) {
      for (const b of group.balances) {
        if (selectedSiteId === "all" || b.siteId === selectedSiteId) {
          seen.set(b.warehouseId, b.warehouseName)
        }
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data, selectedSiteId])

  // 사이트/창고 필터 적용 + 잔액 재계산 + 키워드 필터
  const filteredData = useMemo<GroupedInventoryStock[]>(() => {
    const kw = keyword.trim().toLowerCase()
    const result: GroupedInventoryStock[] = []

    for (const group of data) {
      const filteredBalances = group.balances.filter((b) => {
        if (selectedSiteId !== "all" && b.siteId !== selectedSiteId) return false
        if (selectedWarehouseId !== "all" && b.warehouseId !== selectedWarehouseId) return false
        return true
      })

      if (filteredBalances.length === 0) continue

      const totalQtyOnHand = filteredBalances.reduce((s, b) => s + b.qtyOnHand, 0)
      const totalQtyAvailable = filteredBalances.reduce((s, b) => s + b.qtyAvailable, 0)
      const totalQtyHold = filteredBalances.reduce((s, b) => s + b.qtyHold, 0)
      const hasUnlottedStock =
        group.isLotTracked && filteredBalances.some((b) => !b.lotId && b.qtyOnHand > 0)
      const lotIdSet = new Set(
        filteredBalances.filter((b) => b.lotId).map((b) => b.lotId!),
      )
      const warehouseIdSet = new Set(filteredBalances.map((b) => b.warehouseId))

      const filteredGroup: GroupedInventoryStock = {
        ...group,
        balances: filteredBalances,
        totalQtyOnHand,
        totalQtyAvailable,
        totalQtyHold,
        hasUnlottedStock,
        lotCount: lotIdSet.size,
        warehouseCount: warehouseIdSet.size,
      }

      if (kw.length > 0) {
        const hay = [
          filteredGroup.itemCode,
          filteredGroup.itemName,
          filteredGroup.itemSpec ?? "",
          ...filteredGroup.balances.map((b) => b.lotNo ?? ""),
          ...filteredGroup.balances.map((b) => b.warehouseName),
        ]
          .join(" ")
          .toLowerCase()
        if (!hay.includes(kw)) continue
      }

      result.push(filteredGroup)
    }

    return result
  }, [data, selectedSiteId, selectedWarehouseId, keyword])

  const filterableColumns = [
    {
      id: "itemType" as keyof GroupedInventoryStock,
      title: "품목유형",
      options: [
        { label: "원자재", value: "RAW_MATERIAL" },
        { label: "반제품", value: "SEMI_FINISHED" },
        { label: "완제품", value: "FINISHED" },
        { label: "소모품", value: "CONSUMABLE" },
      ],
    },
  ]

  function handleSiteChange(value: string) {
    setSelectedSiteId(value)
    setSelectedWarehouseId("all")
  }

  return (
    <div className="space-y-4">
      {/* 필터 툴바 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-muted-foreground">사이트</span>
          <Select value={selectedSiteId} onValueChange={handleSiteChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[14px] text-muted-foreground">창고</span>
          <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              {warehouseOptions.map((wh) => (
                <SelectItem key={wh.id} value={wh.id}>
                  {wh.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="품목코드 / 품목명 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 w-[260px] pl-9 text-[14px]"
          />
        </div>
      </div>

      {/* 품목 그룹 테이블 — 행 클릭 시 inline 펼침 */}
      <DataTable
        columns={columns}
        data={filteredData}
        filterableColumns={filterableColumns}
        expandOnRowClick
        renderExpandedRow={(row) => <InventoryDetailContent item={row} />}
      />
    </div>
  )
}
