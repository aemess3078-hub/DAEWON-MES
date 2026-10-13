"use client"

import { useState, useEffect } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import { formatQuantity } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import {
  purchaseOrderFormSchema,
  PurchaseOrderFormValues,
} from "./purchase-order-form-schema"
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  getItemCurrentStock,
  getItemPrice,
} from "@/lib/actions/purchase-order.actions"
import { PurchaseOrderStatus } from "@prisma/client"
import type { PurchaseOrderRow } from "./columns"

// ─── Types ────────────────────────────────────────────────────────────────────

type SupplierOption = { id: string; name: string; code: string }
type ItemOption = { id: string; code: string; name: string }

interface PurchaseOrderFormSheetProps {
  mode: "create" | "edit"
  purchaseOrder?: PurchaseOrderRow | null
  tenantId: string
  siteId: string
  suppliers: SupplierOption[]
  items: ItemOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

// 발주 등록/수정 시 선택 가능한 상태 (입고 이후 상태는 자재입고관리에서 자동 관리)
const STATUS_OPTIONS: { label: string; value: PurchaseOrderStatus }[] = [
  { label: "초안",     value: "DRAFT" },
  { label: "발주완료", value: "ORDERED" },
  { label: "취소",     value: "CANCELLED" },
]

function todayString(): string {
  return new Date().toISOString().split("T")[0]
}

const DEFAULT_VALUES: PurchaseOrderFormValues = {
  supplierId: "",
  orderDate: todayString(),
  expectedDate: "",
  status: "DRAFT",
  totalAmount: undefined,
  currency: "KRW",
  note: "",
  items: [],
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PurchaseOrderFormSheet({
  mode,
  purchaseOrder,
  tenantId,
  siteId,
  suppliers,
  items,
  open,
  onOpenChange,
}: PurchaseOrderFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [stockInfo, setStockInfo] = useState<
    Record<number, { qtyOnHand: number; qtyAvailable: number }>
  >({})
  const router = useRouter()

  const form = useForm<PurchaseOrderFormValues>({
    resolver: zodResolver(purchaseOrderFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  const watchedSupplierId = form.watch("supplierId")

  // ─── create 모드 초기화 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "create" && open) {
      form.reset({ ...DEFAULT_VALUES, orderDate: todayString() })
      setStockInfo({})
    }
  }, [mode, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── edit 모드 초기화 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "edit" && purchaseOrder && open) {
      form.reset({
        supplierId: purchaseOrder.supplier.id,
        orderDate: new Date(purchaseOrder.orderDate).toISOString().split("T")[0],
        expectedDate: new Date(purchaseOrder.expectedDate).toISOString().split("T")[0],
        status: purchaseOrder.status,
        totalAmount: purchaseOrder.totalAmount ? Number(purchaseOrder.totalAmount) : undefined,
        currency: purchaseOrder.currency,
        note: "",
        items: purchaseOrder.items.map((i) => ({
          itemId: i.item.id,
          qty: Number(i.qty),
          unitPrice: Number(i.unitPrice),
          note: "",
        })),
      })
      setStockInfo({})
    }
  }, [mode, purchaseOrder, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 편집 가능 여부 ──────────────────────────────────────────────────────────

  const isItemEditDisabled =
    mode === "edit" &&
    purchaseOrder?.status !== undefined &&
    purchaseOrder.status !== "DRAFT"

  // ─── 품목 선택 핸들러 ────────────────────────────────────────────────────────

  async function handleItemChange(index: number, itemId: string) {
    if (!itemId) return
    const stock = await getItemCurrentStock(itemId, tenantId)
    setStockInfo((prev) => ({ ...prev, [index]: stock }))

    if (watchedSupplierId) {
      const price = await getItemPrice(tenantId, itemId, watchedSupplierId)
      if (price) {
        form.setValue(`items.${index}.unitPrice`, Number(price.unitPrice))
      }
    }
  }

  // ─── 공급사 변경 시 단가 자동 조회 ──────────────────────────────────────────

  async function handleSupplierChange(supplierId: string) {
    form.setValue("supplierId", supplierId)
    const currentItems = form.getValues("items")
    for (let i = 0; i < currentItems.length; i++) {
      const itemId = currentItems[i].itemId
      if (!itemId) continue
      const price = await getItemPrice(tenantId, itemId, supplierId)
      if (price) {
        form.setValue(`items.${i}.unitPrice`, Number(price.unitPrice))
      }
    }
  }

  // ─── 저장 핸들러 ────────────────────────────────────────────────────────────

  async function onSubmit(values: PurchaseOrderFormValues) {
    setIsLoading(true)
    try {
      const payload = {
        supplierId: values.supplierId,
        orderDate: new Date(values.orderDate),
        expectedDate: new Date(values.expectedDate),
        status: values.status as PurchaseOrderStatus,
        totalAmount: values.totalAmount,
        currency: values.currency,
        note: values.note,
        items: values.items.map((item) => ({
          itemId: item.itemId,
          qty: item.qty,
          unitPrice: item.unitPrice,
          note: item.note,
        })),
      }

      if (mode === "create") {
        await createPurchaseOrder(tenantId, siteId, payload)
      } else if (purchaseOrder) {
        await updatePurchaseOrder(purchaseOrder.id, payload)
      }
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("저장 실패:", error)
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      title={mode === "create" ? "발주 등록" : "발주 수정"}
      description={
        mode === "create"
          ? "새로운 발주를 등록합니다."
          : "발주 정보를 수정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          {/* 기본 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">기본 정보</p>

            {/* 공급사 */}
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>공급사</FormLabel>
                  <Select
                    onValueChange={(v) => handleSupplierChange(v)}
                    value={field.value ?? undefined}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="공급사 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          [{s.code}] {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* 발주일 */}
              <FormField
                control={form.control}
                name="orderDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>발주일</FormLabel>
                    <Input type="date" {...field} value={field.value ?? ""} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 입고예정일 */}
              <FormField
                control={form.control}
                name="expectedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>입고예정일</FormLabel>
                    <Input type="date" {...field} value={field.value ?? ""} />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* 상태 */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>상태</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 통화 */}
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>통화</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KRW">원</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="JPY">JPY</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* 총금액 */}
            <FormField
              control={form.control}
              name="totalAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>총금액 (선택)</FormLabel>
                  <MoneyInput
                    placeholder="0"
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 비고 */}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>비고</FormLabel>
                  <Textarea
                    placeholder="비고 사항을 입력하세요"
                    className="resize-none h-20"
                    {...field}
                    value={field.value ?? ""}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* 발주 품목 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-foreground">발주 품목</p>
              {!isItemEditDisabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ itemId: "", qty: 1, unitPrice: 0, note: "" })
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  품목 추가
                </Button>
              )}
            </div>

            {isItemEditDisabled && (
              <p className="text-[13px] text-muted-foreground">
                발주완료 이상 상태에서는 품목을 수정할 수 없습니다.
              </p>
            )}

            {fields.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                {/* 헤더 */}
                <div className="grid grid-cols-[1fr_60px_80px_80px_28px] gap-0 bg-muted/50 px-3 py-2 text-[12px] font-medium text-muted-foreground">
                  <span>품목</span>
                  <span className="text-right">수량</span>
                  <span className="text-right">단가</span>
                  <span className="text-right">현재고</span>
                  <span></span>
                </div>

                {fields.map((field, index) => {
                  const stock = stockInfo[index]

                  return (
                    <div
                      key={field.id}
                      className="grid grid-cols-[1fr_60px_80px_80px_28px] gap-0 items-start px-3 py-2 border-t first:border-t-0 hover:bg-muted/20"
                    >
                      {/* 품목 Select */}
                      <FormField
                        control={form.control}
                        name={`items.${index}.itemId`}
                        render={({ field: f }) => (
                          <FormItem className="pr-2">
                            <Select
                              onValueChange={(v) => {
                                f.onChange(v)
                                handleItemChange(index, v)
                              }}
                              value={f.value ?? undefined}
                              disabled={isItemEditDisabled}
                            >
                              <SelectTrigger className="h-8 text-[13px]">
                                <SelectValue placeholder="품목 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {items.map((item) => (
                                  <SelectItem
                                    key={item.id}
                                    value={item.id}
                                    className="text-[13px]"
                                  >
                                    [{item.code}] {item.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-[12px]" />
                          </FormItem>
                        )}
                      />

                      {/* 수량 */}
                      <FormField
                        control={form.control}
                        name={`items.${index}.qty`}
                        render={({ field: f }) => (
                          <FormItem className="pr-1">
                            <QuantityInput
                              maxDecimals={6}
                              allowNegative={false}
                              className="h-8 text-[13px] text-right"
                              disabled={isItemEditDisabled}
                              value={f.value}
                              onChange={f.onChange}
                            />
                            <FormMessage className="text-[12px]" />
                          </FormItem>
                        )}
                      />

                      {/* 단가 */}
                      <FormField
                        control={form.control}
                        name={`items.${index}.unitPrice`}
                        render={({ field: f }) => (
                          <FormItem className="pr-1">
                            <MoneyInput
                              placeholder="—"
                              className="h-8 text-[13px] text-right"
                              disabled={isItemEditDisabled}
                              value={f.value}
                              onChange={(v) => f.onChange(v ?? 0)}
                            />
                            <FormMessage className="text-[12px]" />
                          </FormItem>
                        )}
                      />

                      {/* 현재고 */}
                      <div className="flex items-center justify-end pr-1">
                        <span className="text-[12px] text-muted-foreground h-8 flex items-center">
                          {stock ? formatQuantity(stock.qtyOnHand) : "—"}
                        </span>
                      </div>

                      {/* 삭제 */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={isItemEditDisabled}
                        onClick={() => {
                          remove(index)
                          setStockInfo((prev) => {
                            const next: Record<number, { qtyOnHand: number; qtyAvailable: number }> = {}
                            Object.entries(prev).forEach(([k, v]) => {
                              const ki = parseInt(k)
                              if (ki < index) next[ki] = v
                              else if (ki > index) next[ki - 1] = v
                            })
                            return next
                          })
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            {fields.length === 0 && (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                품목 추가 버튼을 눌러 발주 품목을 추가하세요.
              </div>
            )}

            <FormField
              control={form.control}
              name="items"
              render={() => (
                <FormItem>
                  <FormMessage className="text-[13px]" />
                </FormItem>
              )}
            />
          </div>
        </div>
      </Form>
    </FormSheet>
  )
}
