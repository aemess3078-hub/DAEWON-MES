"use client"

import { useEffect, useRef, useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Printer, Trash2 } from "lucide-react"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import {
  canBulkPrintShipmentLabels,
  shipmentFormSchema,
  type ShipmentFormValues,
} from "./shipment-form-schema"
import {
  createShipment,
  getAvailableFinishedGoodsLots,
  type AvailableFinishedGoodsLot,
  type EmptyLotReason,
} from "@/lib/actions/shipment.actions"
import { BarcodeScanInput, type ParsedBarcode } from "@/components/common/barcode/barcode-scan-input"
import { BarcodePrintDialog } from "@/components/common/barcode/barcode-print-dialog"
import { formatQuantity } from "@/lib/utils"

type SalesOrderOption = {
  id: string
  orderNo: string
  customer: { name: string }
  items: {
    id: string
    itemId: string
    qty: number | string
    shippedQty: number | string
    item: {
      id: string
      code: string
      name: string
      isLotTracked: boolean
    }
  }[]
}

type WarehouseOption = { id: string; code: string; name: string }

interface ShipmentFormSheetProps {
  tenantId: string
  salesOrders: SalesOrderOption[]
  warehouses: WarehouseOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultSalesOrderId?: string
}

const DEFAULT_VALUES: ShipmentFormValues = {
  salesOrderId: "",
  plannedDate: new Date().toISOString().split("T")[0],
  warehouseId: "",
  note: "",
  items: [],
}

const EMPTY_LOT_MESSAGES: Record<EmptyLotReason, string> = {
  NO_AVAILABLE_LOT: "선택한 창고에 해당 품목의 가용 LOT가 없습니다.",
  UNASSIGNED_STOCK_ONLY: "LOT 미지정 재고만 존재합니다.",
  ALL_LOTS_DEPLETED: "모든 LOT의 가용재고가 0입니다.",
}

export function ShipmentFormSheet({
  tenantId,
  salesOrders,
  warehouses,
  open,
  onOpenChange,
  defaultSalesOrderId,
}: ShipmentFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isLotLoading, setIsLotLoading] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [availableLotsByItem, setAvailableLotsByItem] = useState<
    Record<string, AvailableFinishedGoodsLot[]>
  >({})
  const [emptyReasonByItem, setEmptyReasonByItem] = useState<
    Record<string, EmptyLotReason>
  >({})
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const router = useRouter()

  const form = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const { fields, replace, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  const selectedOrderId = form.watch("salesOrderId")
  const selectedWarehouseId = form.watch("warehouseId")
  const watchedItems = form.watch("items")
  const selectedOrder = salesOrders.find((order) => order.id === selectedOrderId)
  const hasLotTrackedItems = fields.some((item) => item.isLotTracked)
  const canBulkPrint = canBulkPrintShipmentLabels(watchedItems)
  const bulkPrintItems = fields.flatMap((field, index) => {
    const item = watchedItems[index]
    const quantity = Number(item?.qty) || 0
    if (item?.isLotTracked || quantity <= 0) return []

    const salesOrderItem = selectedOrder?.items.find(
      (row) => row.id === field.salesOrderItemId,
    )
    if (!salesOrderItem?.item.code) return []

    return [{
      itemCode: salesOrderItem.item.code,
      itemName: salesOrderItem.item.name,
      quantity,
    }]
  })
  const trackedItemIdsKey = watchedItems
    .filter((item) => item.isLotTracked)
    .map((item) => item.itemId)
    .join(",")

  useEffect(() => {
    if (!open) return

    const base = {
      ...DEFAULT_VALUES,
      plannedDate: new Date().toISOString().split("T")[0],
    }
    setAvailableLotsByItem({})
    setEmptyReasonByItem({})

    if (defaultSalesOrderId) {
      form.reset({ ...base, salesOrderId: defaultSalesOrderId })
      const order = salesOrders.find((row) => row.id === defaultSalesOrderId)
      replace(order ? toShipmentItems(order) : [])
    } else {
      form.reset(base)
      replace([])
    }
  }, [open, defaultSalesOrderId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false

    async function loadLots() {
      const trackedItemIds = form
        .getValues("items")
        .filter((item) => item.isLotTracked)
        .map((item) => item.itemId)

      if (!open || !selectedWarehouseId || trackedItemIds.length === 0) {
        setAvailableLotsByItem({})
        setEmptyReasonByItem({})
        return
      }

      setIsLotLoading(true)
      try {
        const result = await getAvailableFinishedGoodsLots(
          tenantId,
          selectedWarehouseId,
          trackedItemIds,
        )
        if (!cancelled) {
          setAvailableLotsByItem(result.lotsByItem)
          setEmptyReasonByItem(result.emptyReasonByItem)
        }
      } catch (error) {
        console.error("LOT 조회 실패:", error)
        if (!cancelled) {
          setAvailableLotsByItem({})
          setEmptyReasonByItem({})
          alert(error instanceof Error ? error.message : "LOT 조회 중 오류가 발생했습니다.")
        }
      } finally {
        if (!cancelled) setIsLotLoading(false)
      }
    }

    void loadLots()
    return () => {
      cancelled = true
    }
  }, [form, open, selectedWarehouseId, tenantId, trackedItemIdsKey])

  function toShipmentItems(order: SalesOrderOption): ShipmentFormValues["items"] {
    return order.items
      .filter((item) => Number(item.qty) - Number(item.shippedQty) > 0)
      .map((item) => {
        const remainingQty = Number(item.qty) - Number(item.shippedQty)
        return {
          salesOrderItemId: item.id,
          itemId: item.itemId,
          isLotTracked: item.item.isLotTracked,
          qty: item.item.isLotTracked ? 0 : remainingQty,
          lotAllocations: item.item.isLotTracked ? [{ lotId: "", qty: 0 }] : [],
        }
      })
  }

  function getRemainingQty(salesOrderItemId: string): number {
    const item = selectedOrder?.items.find((row) => row.id === salesOrderItemId)
    return item ? Number(item.qty) - Number(item.shippedQty) : 0
  }

  function setLotAllocations(
    itemIndex: number,
    allocations: ShipmentFormValues["items"][number]["lotAllocations"],
  ) {
    form.setValue(`items.${itemIndex}.lotAllocations`, allocations, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  function addLotAllocation(itemIndex: number) {
    const allocations = form.getValues(`items.${itemIndex}.lotAllocations`)
    setLotAllocations(itemIndex, [...allocations, { lotId: "", qty: 0 }])
  }

  function removeLotAllocation(itemIndex: number, allocationIndex: number) {
    const allocations = form.getValues(`items.${itemIndex}.lotAllocations`)
    setLotAllocations(
      itemIndex,
      allocations.filter((_, index) => index !== allocationIndex),
    )
  }

  function handleLotChange(
    itemIndex: number,
    allocationIndex: number,
    selectedLotId: string,
  ) {
    const item = form.getValues(`items.${itemIndex}`)
    const allocations = [...item.lotAllocations]
    const selectedLot = availableLotsByItem[item.itemId]?.find(
      (lot) => lot.lotId === selectedLotId,
    )
    const allocatedByOtherRows = allocations.reduce(
      (sum, allocation, index) =>
        index === allocationIndex ? sum : sum + (Number(allocation.qty) || 0),
      0,
    )
    const remainingQty = Math.max(
      0,
      getRemainingQty(item.salesOrderItemId) - allocatedByOtherRows,
    )

    allocations[allocationIndex] = {
      lotId: selectedLotId,
      qty: selectedLot
        ? Math.min(selectedLot.qtyAvailable, remainingQty)
        : 0,
    }
    setLotAllocations(itemIndex, allocations)
  }

  function handleScan(parsed: ParsedBarcode) {
    if (!selectedOrder) {
      alert("먼저 수주를 선택하세요.")
      return
    }
    const index = fields.findIndex((field) => {
      const item = selectedOrder.items.find(
        (row) => row.id === field.salesOrderItemId,
      )
      return item?.item.code === parsed.itemCode
    })
    if (index === -1) {
      alert(`품목 코드 "${parsed.itemCode}"가 현재 출하 품목 목록에 없습니다.`)
      return
    }
    setHighlightedIndex(index)
    rowRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" })
    setTimeout(() => setHighlightedIndex(null), 3000)
  }

  function handleSalesOrderChange(salesOrderId: string) {
    form.setValue("salesOrderId", salesOrderId)
    const order = salesOrders.find((row) => row.id === salesOrderId)
    replace(order ? toShipmentItems(order) : [])
    setAvailableLotsByItem({})
    setEmptyReasonByItem({})
  }

  function handleWarehouseChange(warehouseId: string) {
    form.setValue("warehouseId", warehouseId)
    replace(
      form.getValues("items").map((item) => ({
        ...item,
        lotAllocations: item.isLotTracked ? [{ lotId: "", qty: 0 }] : [],
      })),
    )
    setAvailableLotsByItem({})
    setEmptyReasonByItem({})
  }

  async function onSubmit(values: ShipmentFormValues) {
    setIsLoading(true)
    try {
      const shipmentItems = values.items.flatMap((item) => {
        const remainingQty = getRemainingQty(item.salesOrderItemId)

        if (!item.isLotTracked) {
          if (!item.qty || item.qty <= 0) {
            throw new Error("비LOT 품목의 출하수량은 0보다 커야 합니다.")
          }
          if (item.qty > remainingQty) {
            throw new Error("출하수량이 미출하수량을 초과합니다.")
          }
          return [{
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            qty: item.qty,
          }]
        }

        if (item.lotAllocations.length === 0) {
          throw new Error("LOT 관리 품목은 최소 1개의 LOT를 선택해야 합니다.")
        }
        const selectedLotIds = new Set<string>()
        let totalQty = 0
        const allocations = item.lotAllocations.map((allocation) => {
          if (selectedLotIds.has(allocation.lotId)) {
            throw new Error("동일한 LOT를 중복 선택할 수 없습니다.")
          }
          selectedLotIds.add(allocation.lotId)

          const lot = availableLotsByItem[item.itemId]?.find(
            (row) => row.lotId === allocation.lotId,
          )
          if (!lot) {
            throw new Error("선택한 LOT의 가용재고를 다시 조회하세요.")
          }
          if (allocation.qty <= 0) {
            throw new Error(`LOT(${lot.lotNo}) 출하수량은 0보다 커야 합니다.`)
          }
          if (allocation.qty > lot.qtyAvailable) {
            throw new Error(`LOT(${lot.lotNo}) 가용재고를 초과했습니다.`)
          }
          totalQty += allocation.qty
          return {
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            lotId: allocation.lotId,
            qty: allocation.qty,
          }
        })

        if (totalQty > remainingQty) {
          throw new Error("LOT 분할수량 합계가 미출하수량을 초과합니다.")
        }
        return allocations
      })

      await createShipment(tenantId, {
        salesOrderId: values.salesOrderId,
        plannedDate: new Date(values.plannedDate),
        warehouseId: values.warehouseId,
        note: values.note,
        items: shipmentItems,
      })
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("출하 등록 실패:", error)
      alert(error instanceof Error ? error.message : "출하 등록 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="출하예정 등록"
      description="완제품 LOT를 예약합니다. 실제 재고는 출하 확정 시 차감됩니다."
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">기본 정보</p>

            <FormField
              control={form.control}
              name="salesOrderId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>수주</FormLabel>
                  <Select
                    onValueChange={handleSalesOrderChange}
                    value={field.value || undefined}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="출하할 수주 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {salesOrders.map((order) => (
                        <SelectItem key={order.id} value={order.id}>
                          {order.orderNo} · {order.customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="plannedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>출하예정일</FormLabel>
                    <Input type="date" {...field} value={field.value ?? ""} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="warehouseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>출하 창고</FormLabel>
                    <Select
                      onValueChange={handleWarehouseChange}
                      value={field.value || undefined}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="출하 창고 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            [{warehouse.code}] {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>비고</FormLabel>
                  <Textarea
                    placeholder="비고 사항을 입력하세요"
                    className="h-20 resize-none"
                    {...field}
                    value={field.value ?? ""}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[15px] font-medium text-foreground">출하 품목</p>
                <p className="text-[13px] text-muted-foreground">
                  출하할 완제품 LOT와 수량을 선택하세요.
                </p>
              </div>
              {fields.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-[13px]"
                  onClick={() => setPrintOpen(true)}
                  disabled={!canBulkPrint || bulkPrintItems.length === 0}
                >
                  <Printer className="h-3.5 w-3.5" />
                  일괄 출력
                </Button>
              )}
            </div>

            {hasLotTrackedItems && (
              <p className="text-right text-[12px] text-muted-foreground">
                다중 LOT 라벨은 출하 저장 후 LOT별로 출력할 수 있습니다.
              </p>
            )}

            {selectedOrderId && fields.length > 0 && (
              <BarcodeScanInput
                onScan={handleScan}
                placeholder="품목 바코드를 스캔하면 해당 행으로 이동합니다"
              />
            )}

            {!selectedOrderId && (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                수주를 선택하면 미출하 품목이 자동으로 로딩됩니다.
              </div>
            )}

            {selectedOrderId && !selectedWarehouseId && fields.length > 0 && (
              <div className="rounded-md border border-dashed py-5 text-center text-[14px] text-muted-foreground">
                출하 창고를 선택하면 가용 완제품 LOT를 조회합니다.
              </div>
            )}

            {selectedOrderId && fields.length === 0 && (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                이번 출하에 포함된 품목이 없습니다. 수주를 다시 선택하면 전체 미출하 품목을 불러옵니다.
              </div>
            )}

            {fields.length > 0 && selectedWarehouseId && (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                <p>LOT 관리 품목은 LOT가 지정된 가용재고만 출하할 수 있습니다.</p>
                <p>
                  한 출하에는 하나의 창고만 사용할 수 있습니다. 다른 창고 재고도 필요하면
                  창고별로 출하를 나누어 등록하세요.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {fields.map((field, itemIndex) => {
                const salesOrderItem = selectedOrder?.items.find(
                  (item) => item.id === field.salesOrderItemId,
                )
                const watchedItem = watchedItems[itemIndex]
                const remainingQty = getRemainingQty(field.salesOrderItemId)
                const allocations = watchedItem?.lotAllocations ?? []
                const selectedTotal = field.isLotTracked
                  ? allocations.reduce(
                      (sum, allocation) => sum + (Number(allocation.qty) || 0),
                      0,
                    )
                  : Number(watchedItem?.qty) || 0
                const afterShipmentQty = remainingQty - selectedTotal
                const lots = availableLotsByItem[field.itemId] ?? []
                const emptyReason = emptyReasonByItem[field.itemId]

                return (
                  <div
                    key={field.id}
                    ref={(element) => { rowRefs.current[itemIndex] = element }}
                    className={`rounded-md border p-3 transition-colors duration-300 ${
                      highlightedIndex === itemIndex ? "border-green-300 bg-green-50" : ""
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[14px] font-medium">
                          [{salesOrderItem?.item.code ?? ""}] {salesOrderItem?.item.name ?? ""}
                        </p>
                        <p className="text-[13px] text-muted-foreground">
                          미출하: {formatQuantity(remainingQty)}
                        </p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="text-right text-[13px]">
                          <p>선택 합계: <span className="font-medium">{formatQuantity(selectedTotal)}</span></p>
                          <p className={afterShipmentQty < 0 ? "text-destructive" : "text-muted-foreground"}>
                            출하 후 잔량: {formatQuantity(afterShipmentQty)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-[12px] text-muted-foreground hover:text-destructive"
                          onClick={() => remove(itemIndex)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          이번 출하 제외
                        </Button>
                      </div>
                    </div>

                    {field.isLotTracked ? (
                      <div className="space-y-2">
                        {allocations.map((allocation, allocationIndex) => {
                          const selectedLot = lots.find(
                            (lot) => lot.lotId === allocation.lotId,
                          )
                          const duplicate =
                            allocation.lotId !== "" &&
                            allocations.some(
                              (row, index) =>
                                index !== allocationIndex &&
                                row.lotId === allocation.lotId,
                            )
                          const rowError =
                            duplicate
                              ? "동일한 LOT를 중복 선택할 수 없습니다."
                              : selectedLot && Number(allocation.qty) > selectedLot.qtyAvailable
                                ? "LOT 가용재고를 초과했습니다."
                                : Number(allocation.qty) <= 0
                                  ? "출하수량은 0보다 커야 합니다."
                                  : null
                          const usedLotIds = new Set(
                            allocations
                              .filter((_, index) => index !== allocationIndex)
                              .map((row) => row.lotId)
                              .filter(Boolean),
                          )

                          return (
                            <div key={`${field.id}-${allocationIndex}`} className="rounded-md bg-muted/20 p-2">
                              <div className="grid grid-cols-[minmax(190px,1fr)_110px_34px] items-start gap-2">
                                <FormField
                                  control={form.control}
                                  name={`items.${itemIndex}.lotAllocations.${allocationIndex}.lotId`}
                                  render={({ field: lotField }) => (
                                    <FormItem>
                                      <Select
                                        value={lotField.value || undefined}
                                        onValueChange={(lotId) =>
                                          handleLotChange(itemIndex, allocationIndex, lotId)
                                        }
                                        disabled={!selectedWarehouseId || isLotLoading || lots.length === 0}
                                      >
                                        <SelectTrigger className="h-9 text-[13px]">
                                          <SelectValue
                                            placeholder={
                                              !selectedWarehouseId
                                                ? "창고 선택 필요"
                                                : isLotLoading
                                                  ? "LOT 조회 중"
                                                  : lots.length === 0
                                                    ? "가용 LOT 없음"
                                                    : "LOT 선택"
                                            }
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {lots.map((lot) => (
                                            <SelectItem
                                              key={lot.lotId}
                                              value={lot.lotId}
                                              disabled={usedLotIds.has(lot.lotId)}
                                            >
                                              {lot.lotNo} · 가용 {formatQuantity(lot.qtyAvailable)}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {selectedLot && (
                                        <p className="text-[12px] text-muted-foreground">
                                          가용 {formatQuantity(selectedLot.qtyAvailable)} · {selectedLot.locationName ?? selectedLot.warehouseName}
                                        </p>
                                      )}
                                      <FormMessage className="text-[12px]" />
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={form.control}
                                  name={`items.${itemIndex}.lotAllocations.${allocationIndex}.qty`}
                                  render={({ field: qtyField }) => (
                                    <FormItem>
                                      <Input
                                        type="number"
                                        min={0}
                                        step="any"
                                        className="h-9 text-right text-[13px]"
                                        aria-label={`${salesOrderItem?.item.code ?? "품목"} LOT ${allocationIndex + 1} 출하수량`}
                                        value={qtyField.value ?? ""}
                                        onChange={(event) =>
                                          qtyField.onChange(
                                            event.target.value === ""
                                              ? 0
                                              : Number(event.target.value),
                                          )
                                        }
                                      />
                                      <FormMessage className="text-[12px]" />
                                    </FormItem>
                                  )}
                                />

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-8 text-muted-foreground hover:text-destructive"
                                  aria-label={`${allocationIndex + 1}번째 LOT 행 삭제`}
                                  onClick={() => removeLotAllocation(itemIndex, allocationIndex)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              {rowError && (
                                <p className="mt-1 text-[12px] text-destructive">{rowError}</p>
                              )}
                            </div>
                          )
                        })}

                        {lots.length === 0 && selectedWarehouseId && !isLotLoading && emptyReason && (
                          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                            {EMPTY_LOT_MESSAGES[emptyReason]}
                          </p>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-[12px]"
                          onClick={() => addLotAllocation(itemIndex)}
                          disabled={!selectedWarehouseId || lots.length === 0}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          LOT 추가
                        </Button>

                        {selectedTotal > remainingQty && (
                          <p className="text-[12px] text-destructive">
                            LOT 분할수량 합계가 미출하수량을 초과합니다.
                          </p>
                        )}
                      </div>
                    ) : (
                      <FormField
                        control={form.control}
                        name={`items.${itemIndex}.qty`}
                        render={({ field: qtyField }) => (
                          <FormItem className="max-w-[180px]">
                            <FormLabel className="text-[13px]">출하수량</FormLabel>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              className="h-9 text-right text-[13px]"
                              value={qtyField.value ?? ""}
                              onChange={(event) =>
                                qtyField.onChange(
                                  event.target.value === ""
                                    ? 0
                                    : Number(event.target.value),
                                )
                              }
                            />
                            <FormMessage className="text-[12px]" />
                            {selectedTotal > remainingQty && (
                              <p className="text-[12px] text-destructive">
                                출하수량이 미출하수량을 초과합니다.
                              </p>
                            )}
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <FormField
              control={form.control}
              name="items"
              render={({ fieldState }) => (
                <FormItem>
                  {fieldState.error?.message && (
                    <FormMessage className="text-[13px]" />
                  )}
                </FormItem>
              )}
            />
          </div>
        </div>
      </Form>

      <BarcodePrintDialog
        open={printOpen && canBulkPrint}
        onOpenChange={setPrintOpen}
        title="출하 라벨 출력"
        items={bulkPrintItems}
      />
    </FormSheet>
  )
}
