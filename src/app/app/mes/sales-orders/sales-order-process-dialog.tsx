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
import { Input } from "@/components/ui/input"
import { Loader2, PackageMinus, Factory, CheckCircle2, AlertTriangle, Info, Plus, Trash2 } from "lucide-react"
import { formatQuantity } from "@/lib/utils"
import { calculateShippableQty } from "@/lib/shipment/shipment-plan-quantities"
import {
  checkSalesOrderLotLine,
  suggestLotQty,
  type SalesOrderLotLineCheck,
} from "@/lib/shipment/sales-order-lot-lines"
import {
  checkInventoryForSalesOrder,
  type ItemStockStatus,
} from "@/lib/actions/sales-order.actions"
import { getSalesOrderProductionQuantities } from "@/lib/actions/production-quantity.actions"
import type { OrderItemQuantityView } from "@/lib/production-quantity-model"
import {
  submitShipmentPlan,
  getAvailableFinishedGoodsLots,
  getWarehouses,
  type AvailableFinishedGoodsLot,
} from "@/lib/actions/shipment.actions"
import type { SalesOrderRow } from "./columns"
import { SalesOrderQuantityPanel } from "./sales-order-quantity-panel"
import { SalesOrderProductionRequestForm } from "./sales-order-production-request-form"

/** LOT 관리 품목의 LOT 분할 행 한 줄(LOT 선택 + 출하 수량) */
type LotRow = { lotId: string; qty: number }
const EMPTY_LOT_ROW: LotRow = { lotId: "", qty: 0 }

/**
 * 화면 출하 가능 수량 = min(추가 출하 가능, 전체 가용재고).
 * 추가 출하 가능 = 수주 − 출하완료 − 기존 출하예정(서버 createShipment 와 같은 식).
 * ItemStockStatus.shippableQty 는 기존 출하예정을 빼지 않으므로(다른 업무도 사용) 이 화면에서는 쓰지 않는다.
 */
function lineShippableOf(s: ItemStockStatus): number {
  return Math.min(calculateShippableQty(s.orderedQty, s.shippedQty, s.plannedQty), s.availableStock)
}

interface SalesOrderProcessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  salesOrder: SalesOrderRow | null
  tenantId: string
  siteId: string
  /** 수주 조회 + 생산계획 조회 권한(생산 수량 조회 모델 사용 조건) */
  canViewQuantities?: boolean
  /** 수주 수정 + 생산계획 등록 권한(생산의뢰 조건) */
  canRequestProduction?: boolean
}

export function SalesOrderProcessDialog({
  open,
  onOpenChange,
  salesOrder,
  tenantId,
  siteId,
  canViewQuantities = false,
  canRequestProduction = false,
}: SalesOrderProcessDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [stockStatus, setStockStatus] = useState<ItemStockStatus[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([])
  const [warehouseId, setWarehouseId] = useState("")
  /** 품목(수주 품목 id)별 LOT 분할 행. 키가 없으면 빈 행 1개로 본다. */
  const [lotRows, setLotRows] = useState<Record<string, LotRow[]>>({})
  /** 제출 버튼을 한 번 눌렀는지: 입력 전의 빈 행에도 행 오류를 보여 줄 때 쓴다 */
  const [lotSubmitAttempted, setLotSubmitAttempted] = useState(false)
  const [availableLots, setAvailableLots] = useState<Record<string, AvailableFinishedGoodsLot[]>>({})
  const [lotsLoading, setLotsLoading] = useState(false)
  const [shipmentError, setShipmentError] = useState<string | null>(null)
  // 2-A 생산 수량 조회 모델(서버 계산 결과를 그대로 표시)
  const [quantities, setQuantities] = useState<OrderItemQuantityView[] | null>(null)
  const [quantityError, setQuantityError] = useState<string | null>(null)
  const [orderStatusNow, setOrderStatusNow] = useState<string>("")

  const loadQuantities = async (salesOrderId: string) => {
    if (!canViewQuantities) {
      setQuantities(null)
      setQuantityError("생산 수량 현황은 수주 조회와 생산계획 조회 권한이 모두 있어야 볼 수 있습니다. 권한은 임의로 완화하지 않았습니다.")
      return
    }
    try {
      const res = await getSalesOrderProductionQuantities(salesOrderId)
      if (!res) {
        setQuantities(null)
        setQuantityError("생산 수량 현황을 찾을 수 없습니다.")
        return
      }
      setQuantities(res.items)
      setOrderStatusNow(res.orderStatus)
      setQuantityError(null)
    } catch (e) {
      setQuantities(null)
      setQuantityError(e instanceof Error ? e.message : "생산 수량 현황을 조회하지 못했습니다.")
    }
  }

  /** 생산의뢰 성공 후: 서버 수량을 다시 읽고 수주 목록(상태)도 갱신 */
  const reloadAfterRequest = async () => {
    if (!salesOrder) return
    const stock = await checkInventoryForSalesOrder(salesOrder.id, tenantId)
    setStockStatus(stock)
    await loadQuantities(salesOrder.id)
    router.refresh()
  }

  // 다이얼로그 오픈 시 재고 + 창고 목록 로드, 기본 창고 자동 선택
  useEffect(() => {
    if (!open || !salesOrder) return
    setQuantities(null)
    setQuantityError(null)
    setOrderStatusNow(salesOrder.status)
    setLoading(true)
    setWarehouseId("")
    setLotRows({}); setLotSubmitAttempted(false)
    setAvailableLots({})
    setShipmentError(null)
    void loadQuantities(salesOrder.id)
    Promise.all([
      checkInventoryForSalesOrder(salesOrder.id, tenantId),
      getWarehouses(tenantId),
    ]).then(([stock, whs]) => {
      setStockStatus(stock)
      setWarehouses(whs)
      // 출하 가능한 첫 번째 품목의 defaultWarehouseId를 자동 선택
      const shippable = stock.filter((s) => lineShippableOf(s) > 0)
      const defaultWhId = shippable.find((s) => s.defaultWarehouseId)?.defaultWarehouseId ?? null
      if (defaultWhId && whs.some((wh) => wh.id === defaultWhId)) {
        setWarehouseId(defaultWhId)
      }
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadQuantities 는 canViewQuantities 외에 의존하지 않는다
  }, [open, salesOrder, tenantId, canViewQuantities])

  // 창고 변경 시 LOT 목록 로드 (LOT 관리 품목만)
  useEffect(() => {
    if (!open || !warehouseId) {
      setAvailableLots({})
      setLotRows({}); setLotSubmitAttempted(false)
      return
    }
    const lotTrackedIds = stockStatus
      .filter((s) => lineShippableOf(s) > 0 && s.isLotTracked)
      .map((s) => s.itemId)
    if (lotTrackedIds.length === 0) return

    let cancelled = false
    setLotsLoading(true)
    setLotRows({}); setLotSubmitAttempted(false)
    setShipmentError(null)
    getAvailableFinishedGoodsLots(tenantId, warehouseId, lotTrackedIds)
      .then((result) => { if (!cancelled) setAvailableLots(result.lotsByItem) })
      .catch(() => { if (!cancelled) setAvailableLots({}) })
      .finally(() => { if (!cancelled) setLotsLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stockStatus를 deps에 포함하면 초기 로드 시 무한 재호출 위험. warehouseId 변경 시에만 LOT 목록을 새로 불러오는 것이 의도된 동작
  }, [open, warehouseId, tenantId])

  if (!salesOrder) return null

  /** 수주 품목의 추가 출하 가능 수량 = 수주 − 출하완료 − 기존 출하예정 (서버 createShipment 와 같은 식) */
  const lineLimitOf = (s: ItemStockStatus) =>
    calculateShippableQty(s.orderedQty, s.shippedQty, s.plannedQty)
  /** 출하요청 가능 품목: 추가 출하 가능 수량과 전체 가용재고 중 작은 값이 0보다 큰 품목 */
  const shippableItems = stockStatus.filter((s) => Math.min(lineLimitOf(s), s.availableStock) > 0)
  const shortageItems = stockStatus.filter((s) => s.shortageQty > 0) // 기존 계산(참고) — "모든 품목 출하 완료" 안내 판단에만 사용
  const allFulfilled = stockStatus.length > 0 && stockStatus.every((s) => s.shortageQty === 0)
  const lotTrackedShippable = shippableItems.filter((s) => s.isLotTracked)

  const getRows = (salesOrderItemId: string): LotRow[] => lotRows[salesOrderItemId] ?? [EMPTY_LOT_ROW]

  /** LOT 분할 행 검증(행·품목 차단 사유) — 순수 함수는 lib/shipment/sales-order-lot-lines 에 있다 */
  const checkLotLine = (s: ItemStockStatus): SalesOrderLotLineCheck =>
    checkSalesOrderLotLine({
      rows: getRows(s.salesOrderItemId),
      lots: availableLots[s.itemId] ?? [],
      limit: lineLimitOf(s),
      uom: s.uom,
      formatQty: formatQuantity,
    })

  const lotChecks = lotTrackedShippable.map((s) => ({ item: s, check: checkLotLine(s) }))
  /** 잘못된 값(행 오류·합계 초과)이 있으면 제출 버튼을 비활성화한다 */
  const firstInvalid = lotChecks.find((c) => c.check.invalid)
  /** 미완성(LOT 미선택 행 등)은 버튼을 눌렀을 때 입력 완료를 요구한다 */
  const firstIncomplete = lotChecks.find((c) => c.check.incomplete)
  const canShip =
    !!warehouseId &&
    !lotsLoading &&
    shippableItems.length > 0 &&
    !firstInvalid

  let blockReason: string | null = null
  if (!warehouseId) blockReason = "출하 창고를 선택하세요."
  else if (lotsLoading) blockReason = "LOT 목록을 조회하는 중입니다."
  else if (firstInvalid) blockReason = `[${firstInvalid.item.itemCode}] ${firstInvalid.check.error}`
  else if (lotSubmitAttempted && firstIncomplete) blockReason = `[${firstIncomplete.item.itemCode}] ${firstIncomplete.check.error}`

  const handleWarehouseChange = (id: string) => {
    setWarehouseId(id)
    setShipmentError(null)
  }

  const setRows = (salesOrderItemId: string, rows: LotRow[]) => {
    setLotRows((prev) => ({ ...prev, [salesOrderItemId]: rows }))
    setShipmentError(null)
  }

  /** LOT 선택: 다른 행이 쓰고 남은 추가 출하 가능 수량 안에서 LOT 예약 가능 수량만큼 자동 채움(수정 가능) */
  const handleLotPick = (s: ItemStockStatus, index: number, lotId: string) => {
    const rows = getRows(s.salesOrderItemId)
    const lot = (availableLots[s.itemId] ?? []).find((l) => l.lotId === lotId)
    const otherRowsQty = rows.reduce((sum, row, i) => (i === index ? sum : sum + (row.qty || 0)), 0)
    const qty = lot
      ? suggestLotQty({ lotQtyAvailable: lot.qtyAvailable, limit: lineLimitOf(s), otherRowsQty })
      : 0
    setRows(s.salesOrderItemId, rows.map((row, i) => (i === index ? { lotId, qty } : row)))
  }

  const handleLotQtyChange = (s: ItemStockStatus, index: number, qty: number) => {
    const rows = getRows(s.salesOrderItemId)
    setRows(s.salesOrderItemId, rows.map((row, i) => (i === index ? { ...row, qty } : row)))
  }

  const handleAddLotRow = (s: ItemStockStatus) => {
    setRows(s.salesOrderItemId, [...getRows(s.salesOrderItemId), EMPTY_LOT_ROW])
  }

  const handleRemoveLotRow = (s: ItemStockStatus, index: number) => {
    setRows(s.salesOrderItemId, getRows(s.salesOrderItemId).filter((_, i) => i !== index))
  }

  /** 서버 createShipment 입력: 비LOT 품목은 기존 방식, LOT 품목은 LOT 행마다 한 줄 */
  const buildShipmentItems = () =>
    shippableItems.flatMap((s) => {
      if (!s.isLotTracked) {
        return [{
          salesOrderItemId: s.salesOrderItemId,
          itemId: s.itemId,
          qty: Math.min(lineLimitOf(s), s.availableStock),
        }]
      }
      return getRows(s.salesOrderItemId)
        .filter((row) => row.lotId && row.qty > 0)
        .map((row) => ({
          salesOrderItemId: s.salesOrderItemId,
          itemId: s.itemId,
          lotId: row.lotId,
          qty: row.qty,
        }))
    })

  const handleShipment = () => {
    if (!canShip) return
    // 입력이 끝나지 않은 LOT 행이 있으면 등록하지 않고 행 오류를 드러낸다
    if (firstIncomplete) {
      setLotSubmitAttempted(true)
      return
    }
    setShipmentError(null)
    startTransition(async () => {
      const shipmentItems = buildShipmentItems()
      try {
        const result = await submitShipmentPlan(tenantId, {
          salesOrderId: salesOrder.id,
          plannedDate: new Date(),
          warehouseId,
          items: shipmentItems,
        })
        if (!result.ok) {
          setShipmentError(result.message)
          return
        }
        router.refresh()
        onOpenChange(false)
        router.push(`/app/mes/shipments?salesOrderId=${encodeURIComponent(salesOrder.id)}`)
      } catch (e) {
        setShipmentError(e instanceof Error ? e.message : "출하요청 생성 중 오류가 발생했습니다.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
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
            <div className="text-[14px] font-medium">품목별 재고 현황 <span className="text-[13px] font-normal text-muted-foreground">(기존 계산 · 출하요청 기준 · 참고)</span></div>
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
                      {lineShippableOf(s) > 0 ? formatQuantity(lineShippableOf(s)) : "—"}
                    </div>
                    <div className={`py-2.5 px-3 text-[14px] text-right font-medium ${s.shortageQty > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {s.shortageQty > 0 ? formatQuantity(s.shortageQty) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 생산 수량 현황 (2-A 조회 모델) */}
          <div className="space-y-2">
            <div className="text-[14px] font-medium">생산 수량 현황 <span className="text-[13px] font-normal text-muted-foreground">(서버 계산 · 수주 충당 / 실제 생산계획 구분)</span></div>
            {loading ? null : quantityError ? (
              <div className="flex items-start gap-1.5 rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground" data-testid="qty-error">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                {quantityError}
              </div>
            ) : quantities ? (
              <SalesOrderQuantityPanel items={quantities} />
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                생산 수량 조회 중...
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
                  <Label className="text-[14px]">LOT 선택 · 출하 수량</Label>
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
                      {lotChecks.map(({ item, check }) => {
                        const lots = availableLots[item.itemId] ?? []
                        const rows = getRows(item.salesOrderItemId)
                        const addDisabled =
                          lots.length === 0 ||
                          lots.every((lot) => rows.some((row) => row.lotId === lot.lotId))
                        /** 등록 후 잔여는 실제 출하요청 수량(유효 행 합계) 기준 */
                        const remainingAfter = item.remainingQty - check.validTotal

                        return (
                          <div key={item.salesOrderItemId} className="rounded-md border bg-white p-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-medium">{item.itemName}</span>
                              <span className="text-[12px] text-muted-foreground font-mono">{item.itemCode}</span>
                            </div>

                            {lots.length === 0 && (
                              <div className="flex items-center gap-1.5 text-[13px] text-red-600">
                                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                선택한 창고에 출하 가능한 LOT가 없습니다. 다른 창고를 선택하거나 출하등록 화면을 이용하세요.
                              </div>
                            )}

                            {rows.length > 0 && (
                              <div className="space-y-1.5">
                                <div className="grid grid-cols-[minmax(0,1fr)_120px_32px] gap-2 text-[12px] text-muted-foreground">
                                  <span>LOT 선택</span>
                                  <span className="text-right">출하 수량 ({item.uom})</span>
                                  <span />
                                </div>
                                {rows.map((row, index) => {
                                  const selectedLot = lots.find((l) => l.lotId === row.lotId)
                                  const usedByOthers = new Set(
                                    rows.filter((_, i) => i !== index).map((r) => r.lotId).filter(Boolean),
                                  )
                                  // 행을 막 추가했거나 아직 입력하지 않은 빈 행에는 오류를 보여 주지 않는다(제출 시도 후에는 표시)
                                  const rowTouched = lotSubmitAttempted || row.lotId !== "" || row.qty !== 0
                                  const rowError = rowTouched ? check.rowErrors[index] : null
                                  return (
                                    <div key={`${item.salesOrderItemId}-${index}`} className="space-y-1">
                                      <div className="grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-2">
                                        <Select
                                          value={row.lotId || undefined}
                                          onValueChange={(lotId) => handleLotPick(item, index, lotId)}
                                        >
                                          <SelectTrigger className="text-[13px] h-8">
                                            <SelectValue placeholder="LOT 선택" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {lots.map((lot) => (
                                              <SelectItem
                                                key={lot.lotId}
                                                value={lot.lotId}
                                                disabled={usedByOthers.has(lot.lotId)}
                                                className="text-[13px]"
                                              >
                                                <span className="font-mono">{lot.lotNo}</span>
                                                <span className="ml-2 text-muted-foreground">
                                                  · 예약 가능 {formatQuantity(lot.qtyAvailable)} {item.uom}
                                                  {lot.locationName ? ` · ${lot.locationName}` : ""}
                                                </span>
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <Input
                                          type="number"
                                          min={0}
                                          step="any"
                                          className="h-8 text-right text-[13px]"
                                          aria-label={`${item.itemCode} LOT ${index + 1} 출하 수량`}
                                          value={row.qty === 0 ? "" : row.qty}
                                          onChange={(e) =>
                                            handleLotQtyChange(item, index, e.target.value === "" ? 0 : Number(e.target.value))
                                          }
                                        />
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                          aria-label={`${index + 1}번째 LOT 행 삭제`}
                                          onClick={() => handleRemoveLotRow(item, index)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                      {selectedLot && (
                                        <p className="text-[12px] text-muted-foreground">
                                          LOT 재고 {formatQuantity(selectedLot.qtyStock)} · 기존 출하예정 예약 {formatQuantity(selectedLot.qtyReserved)} · 예약 가능 {formatQuantity(selectedLot.qtyAvailable)}
                                        </p>
                                      )}
                                      {rowError && (
                                        <p className="text-[12px] text-red-600">{rowError}</p>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 text-[13px]"
                              onClick={() => handleAddLotRow(item)}
                              disabled={addDisabled}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              LOT 추가
                            </Button>

                            {/* 수량 합계 */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-[13px] sm:grid-cols-6">
                              <div>
                                <div className="text-[12px] text-muted-foreground">수주 잔여</div>
                                <div className="font-medium">{formatQuantity(item.remainingQty)} {item.uom}</div>
                              </div>
                              <div>
                                <div className="text-[12px] text-muted-foreground">기존 출하예정</div>
                                <div className="font-medium">{formatQuantity(item.plannedQty)} {item.uom}</div>
                              </div>
                              <div>
                                <div className="text-[12px] text-muted-foreground">추가 출하 가능</div>
                                <div className="font-medium">{formatQuantity(check.limit)} {item.uom}</div>
                              </div>
                              <div>
                                <div className="text-[12px] text-muted-foreground" title="입력한 모든 LOT 행 수량의 합(잘못된 행 포함)">입력 합계</div>
                                <div className={`font-medium ${check.total > check.limit ? "text-red-600" : ""}`}>
                                  {formatQuantity(check.total)} {item.uom}
                                </div>
                              </div>
                              <div>
                                <div className="text-[12px] text-muted-foreground" title="오류 없는 행만 합산한 실제 출하요청 수량">출하요청 수량</div>
                                <div className="font-medium">
                                  {formatQuantity(check.validTotal)} {item.uom}
                                </div>
                              </div>
                              <div>
                                <div className="text-[12px] text-muted-foreground">등록 후 수주 잔여</div>
                                <div className={`font-medium ${remainingAfter < 0 ? "text-red-600" : ""}`}>
                                  {formatQuantity(remainingAfter)} {item.uom}
                                </div>
                              </div>
                            </div>

                            {/* 상태: 잘못된 값은 빨간 오류, 입력 미완료는 제출 시도 전까지 중립 안내 */}
                            {check.invalid || (lotSubmitAttempted && check.incomplete) ? (
                              <div className={`flex items-center gap-1.5 text-[13px] ${check.invalid ? "text-red-600" : "text-amber-700"}`}>
                                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                                {check.error}
                              </div>
                            ) : check.incomplete ? (
                              <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                                LOT를 추가하고 LOT와 출하 수량을 입력하세요.
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-[13px] text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                                출하 가능
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
                {blockReason && (
                  <p className="text-[13px] text-amber-700">{blockReason}</p>
                )}
              </div>
            </div>
          )}

          {/* 생산의뢰 입력 (수주 충당 + 여유 생산) */}
          {!loading && quantities && (
            <SalesOrderProductionRequestForm
              salesOrderId={salesOrder.id}
              orderStatus={orderStatusNow || salesOrder.status}
              tenantId={tenantId}
              siteId={siteId}
              items={quantities}
              canRequest={canRequestProduction}
              onRequested={reloadAfterRequest}
            />
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
