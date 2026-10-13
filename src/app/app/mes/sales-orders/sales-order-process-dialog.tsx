"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Loader2, PackageMinus, Factory, CheckCircle2, AlertTriangle, Info } from "lucide-react"
import { formatQuantity } from "@/lib/utils"
import {
  checkInventoryForSalesOrder,
  requestProductionFromSalesOrder,
  type ItemStockStatus,
} from "@/lib/actions/sales-order.actions"
import {
  createShipment,
  getAvailableFinishedGoodsLots,
  getWarehouses,
  type AvailableFinishedGoodsLot,
} from "@/lib/actions/shipment.actions"
import type { SalesOrderRow } from "./columns"

interface SalesOrderProcessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  salesOrder: SalesOrderRow | null
  tenantId: string
  siteId: string
}

export function SalesOrderProcessDialog({
  open,
  onOpenChange,
  salesOrder,
  tenantId,
  siteId,
}: SalesOrderProcessDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [stockStatus, setStockStatus] = useState<ItemStockStatus[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([])
  const [warehouseId, setWarehouseId] = useState("")
  const [lotSelections, setLotSelections] = useState<Record<string, string>>({})
  const [availableLots, setAvailableLots] = useState<Record<string, AvailableFinishedGoodsLot[]>>({})
  const [lotsLoading, setLotsLoading] = useState(false)
  const [shipmentError, setShipmentError] = useState<string | null>(null)

  // 다이얼로그 오픈 시 재고 + 창고 목록 로드, 기본 창고 자동 선택
  useEffect(() => {
    if (!open || !salesOrder) return
    setLoading(true)
    setWarehouseId("")
    setLotSelections({})
    setAvailableLots({})
    setShipmentError(null)
    Promise.all([
      checkInventoryForSalesOrder(salesOrder.id, tenantId),
      getWarehouses(tenantId),
    ]).then(([stock, whs]) => {
      setStockStatus(stock)
      setWarehouses(whs)
      // 출하 가능한 첫 번째 품목의 defaultWarehouseId를 자동 선택
      const shippable = stock.filter((s) => s.shippableQty > 0)
      const defaultWhId = shippable.find((s) => s.defaultWarehouseId)?.defaultWarehouseId ?? null
      if (defaultWhId && whs.some((wh) => wh.id === defaultWhId)) {
        setWarehouseId(defaultWhId)
      }
      setLoading(false)
    })
  }, [open, salesOrder, tenantId])

  // 창고 변경 시 LOT 목록 로드 (LOT 관리 품목만)
  useEffect(() => {
    if (!open || !warehouseId) {
      setAvailableLots({})
      setLotSelections({})
      return
    }
    const lotTrackedIds = stockStatus
      .filter((s) => s.shippableQty > 0 && s.isLotTracked)
      .map((s) => s.itemId)
    if (lotTrackedIds.length === 0) return

    let cancelled = false
    setLotsLoading(true)
    setLotSelections({})
    setShipmentError(null)
    getAvailableFinishedGoodsLots(tenantId, warehouseId, lotTrackedIds)
      .then((result) => { if (!cancelled) setAvailableLots(result.lotsByItem) })
      .catch(() => { if (!cancelled) setAvailableLots({}) })
      .finally(() => { if (!cancelled) setLotsLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stockStatus를 deps에 포함하면 초기 로드 시 무한 재호출 위험. warehouseId 변경 시에만 LOT 목록을 새로 불러오는 것이 의도된 동작
  }, [open, warehouseId, tenantId])

  if (!salesOrder) return null

  const shippableItems = stockStatus.filter((s) => s.shippableQty > 0)
  const shortageItems = stockStatus.filter((s) => s.shortageQty > 0)
  const allFulfilled = stockStatus.length > 0 && stockStatus.every((s) => s.shortageQty === 0)
  const lotTrackedShippable = shippableItems.filter((s) => s.isLotTracked)
  const allLotsSelected = lotTrackedShippable.every((s) => !!lotSelections[s.itemId])
  const canShip = !!warehouseId && allLotsSelected

  const handleWarehouseChange = (id: string) => {
    setWarehouseId(id)
    setShipmentError(null)
  }

  const handleLotChange = (itemId: string, lotId: string) => {
    setLotSelections((prev) => ({ ...prev, [itemId]: lotId }))
    setShipmentError(null)
  }

  const handleShipment = () => {
    if (!canShip) return
    setShipmentError(null)
    startTransition(async () => {
      const shipmentItems = shippableItems.map((item) => ({
        salesOrderItemId: item.salesOrderItemId,
        itemId: item.itemId,
        qty: item.shippableQty,
        ...(item.isLotTracked ? { lotId: lotSelections[item.itemId] } : {}),
      }))
      try {
        await createShipment(tenantId, {
          salesOrderId: salesOrder.id,
          plannedDate: new Date(),
          warehouseId,
          items: shipmentItems,
        })
        router.refresh()
        onOpenChange(false)
        router.push(`/app/mes/shipments?salesOrderId=${encodeURIComponent(salesOrder.id)}`)
      } catch (e) {
        setShipmentError(e instanceof Error ? e.message : "출하요청 생성 중 오류가 발생했습니다.")
      }
    })
  }

  const handleProduction = () => {
    startTransition(async () => {
      const res = await requestProductionFromSalesOrder(
        salesOrder.id,
        shortageItems.map((s) => ({
          salesOrderItemId: s.salesOrderItemId,
          itemId: s.itemId,
          qty: s.shortageQty,
        })),
        tenantId,
        siteId
      )
      if (!res.ok) {
        alert(res.error ?? "오류가 발생했습니다.")
        return
      }
      alert(`생산계획 ${res.planNo} 이(가) 생성되었습니다.`)
      router.refresh()
      onOpenChange(false)
      router.push(`/app/mes/production-plan?salesOrderId=${encodeURIComponent(salesOrder.id)}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">수주 처리</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2 max-h-[70vh] overflow-y-auto">
          {/* 수주 정보 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <div className="text-[13px] text-muted-foreground">수주</div>
            <div className="text-[15px] font-medium">
              {salesOrder.orderNo}{" "}
              <span className="text-muted-foreground font-normal text-[14px]">
                — {salesOrder.customer.name}
              </span>
            </div>
            <div className="text-[13px] text-muted-foreground">
              납기일: {new Date(salesOrder.deliveryDate).toLocaleDateString("ko-KR")}
            </div>
          </div>

          {/* 재고 현황 테이블 */}
          <div className="space-y-2">
            <div className="text-[14px] font-medium">품목별 재고 현황</div>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[14px]">재고 조회 중...</span>
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-[1fr_80px_80px_80px_80px_80px_80px] bg-muted/30 border-b">
                  {["품목명", "수주수량", "출하완료", "잔여수량", "가용재고", "출하가능", "부족수량"].map((h) => (
                    <div key={h} className="py-2 px-3 text-[13px] font-medium text-muted-foreground text-right first:text-left">
                      {h}
                    </div>
                  ))}
                </div>
                {stockStatus.map((s) => (
                  <div
                    key={s.salesOrderItemId}
                    className="grid grid-cols-[1fr_80px_80px_80px_80px_80px_80px] items-center border-b last:border-0 hover:bg-muted/10"
                  >
                    <div className="py-2.5 px-3">
                      <div className="text-[14px] font-medium">{s.itemName}</div>
                      <div className="text-[12px] text-muted-foreground font-mono">
                        {s.itemCode} · {s.uom}
                        {s.isLotTracked && (
                          <span className="ml-1 text-blue-600">· LOT</span>
                        )}
                      </div>
                    </div>
                    <div className="py-2.5 px-3 text-[14px] text-right">{formatQuantity(s.orderedQty)}</div>
                    <div className="py-2.5 px-3 text-[14px] text-right text-muted-foreground">{formatQuantity(s.shippedQty)}</div>
                    <div className="py-2.5 px-3 text-[14px] text-right font-medium">{formatQuantity(s.remainingQty)}</div>
                    <div className={`py-2.5 px-3 text-[14px] text-right font-medium ${s.availableStock < s.remainingQty ? "text-amber-600" : "text-green-700"}`}>
                      {formatQuantity(s.availableStock)}
                    </div>
                    <div className="py-2.5 px-3 text-[14px] text-right text-green-700 font-medium">
                      {s.shippableQty > 0 ? formatQuantity(s.shippableQty) : "—"}
                    </div>
                    <div className={`py-2.5 px-3 text-[14px] text-right font-medium ${s.shortageQty > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {s.shortageQty > 0 ? formatQuantity(s.shortageQty) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 출하요청 생성 */}
          {!loading && shippableItems.length > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-[14px] font-medium text-green-800">
                  {allFulfilled ? "전체 출하 가능" : "일부 출하 가능"}
                </span>
                <Badge variant="outline" className="text-[12px] bg-green-100 text-green-700 border-green-200">
                  {shippableItems.length}개 품목
                </Badge>
              </div>

              {/* 출하 창고 선택 */}
              <div className="space-y-1.5">
                <Label className="text-[14px]">출하 창고</Label>
                <Select value={warehouseId} onValueChange={handleWarehouseChange}>
                  <SelectTrigger className="text-[14px] max-w-xs">
                    <SelectValue placeholder="창고 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id} className="text-[14px]">
                        [{wh.code}] {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* LOT 관리 품목 — LOT 선택 */}
              {lotTrackedShippable.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-[14px]">LOT 선택</Label>
                  {!warehouseId ? (
                    <div className="flex items-center gap-1.5 text-[13px] text-amber-700">
                      <Info className="h-3.5 w-3.5 flex-shrink-0" />
                      출하 창고를 먼저 선택하면 LOT 목록이 표시됩니다.
                    </div>
                  ) : lotsLoading ? (
                    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      LOT 목록 조회 중...
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {lotTrackedShippable.map((item) => {
                        const lots = availableLots[item.itemId] ?? []
                        const selectedLotId = lotSelections[item.itemId] ?? ""
                        const selectedLot = lots.find((l) => l.lotId === selectedLotId)
                        const isInsufficient = selectedLot && selectedLot.qtyAvailable < item.shippableQty

                        return (
                          <div key={item.itemId} className="rounded-md border bg-white p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-medium">{item.itemName}</span>
                              <span className="text-[12px] text-muted-foreground">
                                출하 수량: {formatQuantity(item.shippableQty)} {item.uom}
                              </span>
                            </div>

                            {lots.length === 0 ? (
                              <div className="flex items-center gap-1.5 text-[13px] text-red-600">
                                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                선택한 창고에 출하 가능한 LOT가 없습니다. 다른 창고를 선택하거나 출하등록 화면을 이용하세요.
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Select value={selectedLotId} onValueChange={(v) => handleLotChange(item.itemId, v)}>
                                  <SelectTrigger className="text-[13px] h-8 flex-1">
                                    <SelectValue placeholder="LOT 선택" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {lots.map((lot) => (
                                      <SelectItem key={lot.lotId} value={lot.lotId} className="text-[13px]">
                                        <span className="font-mono">{lot.lotNo}</span>
                                        <span className="ml-2 text-muted-foreground">
                                          · 가용 {formatQuantity(lot.qtyAvailable)} {item.uom}
                                          {lot.locationName ? ` · ${lot.locationName}` : ""}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {selectedLot && (
                                  <span className={`text-[12px] whitespace-nowrap ${isInsufficient ? "text-red-600" : "text-green-700"}`}>
                                    가용 {formatQuantity(selectedLot.qtyAvailable)}
                                    {isInsufficient && " (부족)"}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 오류 메시지 */}
              {shipmentError && (
                <div className="flex items-start gap-1.5 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[13px] text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  {shipmentError}
                </div>
              )}

              {/* 버튼 및 안내 */}
              <div className="space-y-1.5">
                <Button
                  size="sm"
                  className="gap-1.5 bg-green-700 hover:bg-green-800"
                  onClick={handleShipment}
                  disabled={isPending || !canShip}
                >
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageMinus className="h-3.5 w-3.5" />}
                  출하요청 생성
                </Button>
                {!warehouseId && (
                  <p className="text-[13px] text-amber-700">출하 창고를 선택하세요.</p>
                )}
                {warehouseId && !allLotsSelected && lotTrackedShippable.length > 0 && (
                  <p className="text-[13px] text-amber-700">LOT 관리 품목의 LOT를 모두 선택해야 출하요청을 생성할 수 있습니다.</p>
                )}
              </div>
            </div>
          )}

          {/* 생산의뢰 생성 */}
          {!loading && shortageItems.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-[14px] font-medium text-amber-800">재고 부족 — 생산의뢰 필요</span>
                <Badge variant="outline" className="text-[12px] bg-amber-100 text-amber-700 border-amber-200">
                  {shortageItems.length}개 품목
                </Badge>
              </div>
              <div className="text-[13px] text-amber-700">
                부족 수량에 대한 생산계획(DRAFT)이 생성되고, 수주 상태가 <strong>생산중</strong>으로 변경됩니다.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-400 text-amber-800 hover:bg-amber-100"
                onClick={handleProduction}
                disabled={isPending}
              >
                <Factory className="h-3.5 w-3.5" />
                생산의뢰 생성
              </Button>
            </div>
          )}

          {/* 처리 완료 */}
          {!loading && stockStatus.length > 0 && shippableItems.length === 0 && shortageItems.length === 0 && (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-[14px] text-muted-foreground">모든 품목이 출하 완료되었습니다.</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
