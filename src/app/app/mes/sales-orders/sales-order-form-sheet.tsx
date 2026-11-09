"use client"

import { useState, useEffect } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"
import { addDays, isWithinInterval, isPast } from "date-fns"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/ui/money-input"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { salesOrderFormSchema, SalesOrderFormValues } from "./sales-order-form-schema"
import {
  createSalesOrder,
  updateSalesOrder,
  generateSalesOrderNo,
} from "@/lib/actions/sales-order.actions"
import { SalesOrderStatus } from "@prisma/client"
import type { SalesOrderRow } from "./columns"
import { NEW_SALES_ORDER_STATUS, selectableSalesOrderStatuses, type SalesOrderStatusValue } from "@/lib/sales-order-status"

// ─── Types ────────────────────────────────────────────────────────────────────

type CustomerOption = { id: string; name: string; code: string }
type ItemOption = { id: string; code: string; name: string }

interface SalesOrderFormSheetProps {
  mode: "create" | "edit"
  salesOrder?: SalesOrderRow | null
  tenantId: string
  siteId: string
  customers: CustomerOption[]
  items: ItemOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { label: string; value: SalesOrderStatus }[] = [
  { label: "초안", value: "DRAFT" },
  { label: "확정", value: "CONFIRMED" },
  { label: "생산중", value: "IN_PRODUCTION" },
  { label: "부분출하", value: "PARTIAL_SHIPPED" },
  { label: "출하완료", value: "SHIPPED" },
  { label: "완료", value: "CLOSED" },
  { label: "취소", value: "CANCELLED" },
]

function todayString(): string {
  return new Date().toISOString().split("T")[0]
}

const DEFAULT_VALUES: SalesOrderFormValues = {
  customerId: "",
  orderDate: todayString(),
  deliveryDate: "",
  // 신규 수주는 등록 즉시 확정된다(서버가 CONFIRMED 로 저장). 등록 화면에는 상태 선택이 없다.
  status: "CONFIRMED",
  totalAmount: undefined,
  currency: "KRW",
  note: "",
  items: [],
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SalesOrderFormSheet({
  mode,
  salesOrder,
  tenantId,
  siteId,
  customers,
  items,
  open,
  onOpenChange,
}: SalesOrderFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<SalesOrderFormValues>({
    resolver: zodResolver(salesOrderFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  // ─── create 모드 초기화 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "create" && open) {
      form.reset({ ...DEFAULT_VALUES, orderDate: todayString() })
      generateSalesOrderNo(tenantId).catch(console.error)
    }
  }, [mode, open, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── edit 모드 초기화 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "edit" && salesOrder && open) {
      form.reset({
        customerId: salesOrder.customer.id,
        orderDate: new Date(salesOrder.orderDate).toISOString().split("T")[0],
        deliveryDate: new Date(salesOrder.deliveryDate).toISOString().split("T")[0],
        status: salesOrder.status,
        totalAmount: salesOrder.totalAmount ? Number(salesOrder.totalAmount) : undefined,
        currency: salesOrder.currency,
        note: salesOrder.note ?? "",
        items: salesOrder.items.map((i) => ({
          itemId: (i as { itemId?: string; item?: { id: string } }).itemId
            ?? (i as { item?: { id: string } }).item?.id
            ?? "",
          qty: Number(i.qty),
          unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
          // 저장할 때 기존 품목 납기·비고가 지워지지 않도록 그대로 불러온다
          deliveryDate: i.deliveryDate ? new Date(i.deliveryDate).toISOString().split("T")[0] : "",
          note: i.note ?? "",
        })),
      })
    }
  }, [mode, salesOrder, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 납기일 경고 색상 ────────────────────────────────────────────────────────

  const deliveryDateValue = form.watch("deliveryDate")
  const isDeliverySoon = deliveryDateValue
    ? (() => {
        const d = new Date(deliveryDateValue)
        const now = new Date()
        return isWithinInterval(d, { start: now, end: addDays(now, 7) })
      })()
    : false
  const isDeliveryOverdue = deliveryDateValue ? isPast(new Date(deliveryDateValue)) : false

  // ─── CONFIRMED 이상이면 품목 편집 비활성화 ──────────────────────────────────

  const currentStatus = form.watch("status")
  // 선택할 수 있는 상태: 등록은 선택 없이 확정(자동), 수정은 현재 상태에서 직접 바꿀 수 있는 상태만(생산중·부분출하·출하완료는 처리 결과로 자동 변경). 서버가 같은 규칙을 다시 검증한다.
  const selectableStatuses: SalesOrderStatusValue[] =
    mode === "edit" && salesOrder
      ? selectableSalesOrderStatuses(salesOrder.status as SalesOrderStatusValue)
      : [NEW_SALES_ORDER_STATUS]
  const statusOptions = STATUS_OPTIONS.filter((opt) => selectableStatuses.includes(opt.value as SalesOrderStatusValue))
  const statusLocked = mode === "edit" && !!salesOrder && selectableStatuses.length <= 1
  // 품목·수량 수정: 초안·확정 수주에 생산계획·작업지시·출하가 연결되지 않았을 때만 가능(서버 updateSalesOrder 가 같은 규칙으로 다시 검증)
  const itemEditBlockedReason = mode === "edit" && salesOrder ? salesOrder.itemEditBlockedReason ?? null : null
  const isItemEditDisabled = itemEditBlockedReason !== null

  // ─── 저장 핸들러 ────────────────────────────────────────────────────────────

  async function onSubmit(values: SalesOrderFormValues) {
    setIsLoading(true)
    try {
      const payload = {
        customerId: values.customerId,
        orderDate: new Date(values.orderDate),
        deliveryDate: new Date(values.deliveryDate),
        totalAmount: values.totalAmount,
        currency: values.currency,
        note: values.note,
        items: values.items.map((item) => ({
          itemId: item.itemId,
          qty: item.qty,
          unitPrice: item.unitPrice,
          deliveryDate: item.deliveryDate ? new Date(item.deliveryDate) : undefined,
          note: item.note,
        })),
      }

      if (mode === "create") {
        // 상태는 보내지 않는다 — 서버가 CONFIRMED 로 저장한다
        await createSalesOrder(tenantId, siteId, payload)
      } else if (salesOrder) {
        const res = await updateSalesOrder(salesOrder.id, { ...payload, status: values.status as SalesOrderStatus })
        if (!res.ok) {
          // 서버가 상태 전이·후속 업무(생산계획·작업지시·출하) 때문에 거부한 사유를 그대로 안내한다
          alert(res.error ?? "저장 중 오류가 발생했습니다.")
          return
        }
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
      title={mode === "create" ? "수주 등록" : "수주 수정"}
      description={
        mode === "create"
          ? "새로운 수주를 등록합니다."
          : "수주 정보를 수정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          {/* 기본 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">기본 정보</p>

            {/* 고객사 */}
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>고객사</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <SelectTrigger>
                      <SelectValue placeholder="고객사 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          [{c.code}] {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* 수주일 */}
              <FormField
                control={form.control}
                name="orderDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>수주일</FormLabel>
                    <Input type="date" {...field} value={field.value ?? ""} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 납기일 */}
              <FormField
                control={form.control}
                name="deliveryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      납기일{" "}
                      {isDeliveryOverdue && (
                        <span className="text-red-500 text-[12px]">기한 초과</span>
                      )}
                      {!isDeliveryOverdue && isDeliverySoon && (
                        <span className="text-amber-500 text-[12px]">7일 이내</span>
                      )}
                    </FormLabel>
                    <Input
                      type="date"
                      {...field}
                      value={field.value ?? ""}
                      className={
                        isDeliveryOverdue
                          ? "border-red-400 focus-visible:ring-red-400"
                          : isDeliverySoon
                          ? "border-amber-400 focus-visible:ring-amber-400"
                          : ""
                      }
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* 상태: 수정 화면에서만 선택(기존 초안 수주의 개별 확정 경로). 등록 화면은 자동 확정이라 선택 항목이 없다. */}
              {mode === "create" ? (
                <div className="space-y-2" data-testid="so-status-auto">
                  <Label className="text-[14px] font-medium">상태</Label>
                  <div className="flex h-10 items-center gap-2 text-[14px] text-foreground">
                    <span className="font-medium">확정</span>
                    <span className="text-[13px] text-muted-foreground">등록하면 바로 확정됩니다</span>
                  </div>
                </div>
              ) : (
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
                        {statusOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {statusLocked && (
                      <p className="text-[13px] text-muted-foreground">
                        이 상태에서는 직접 변경할 수 없습니다. 생산의뢰·출하 처리 결과에 따라 자동으로 바뀝니다.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              )}

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

          {/* 품목 목록 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-foreground">수주 품목</p>
              {!isItemEditDisabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({
                      itemId: "",
                      qty: 1,
                      unitPrice: undefined,
                      deliveryDate: "",
                      note: "",
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  품목 추가
                </Button>
              )}
            </div>

            {isItemEditDisabled && (
              <p className="text-[13px] text-muted-foreground" data-testid="so-item-locked">
                {itemEditBlockedReason}
              </p>
            )}

            {fields.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                {/* 헤더 */}
                <div className="grid grid-cols-[minmax(96px,1fr)_72px_96px_36px] gap-0 bg-muted/50 px-3 py-2 text-[13px] font-medium text-muted-foreground">
                  <span>품목</span>
                  <span className="text-right">수량</span>
                  <span className="text-right">단가</span>
                  <span></span>
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-[minmax(96px,1fr)_72px_96px_36px] gap-0 items-start px-3 py-2 border-t first:border-t-0 hover:bg-muted/20"
                  >
                  {/* 품목 Select */}
                  <FormField
                    control={form.control}
                    name={`items.${index}.itemId`}
                    render={({ field: f }) => (
                      <FormItem className="min-w-0 pr-2">
                        <Select
                          onValueChange={f.onChange}
                          value={f.value ?? undefined}
                          disabled={isItemEditDisabled}
                        >
                          <SelectTrigger className="h-8 text-[13px]">
                            <SelectValue placeholder="품목 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((item) => (
                              <SelectItem key={item.id} value={item.id} className="text-[13px]">
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
                      <FormItem className="min-w-0 pr-2">
                        <QuantityInput
                          maxDecimals={6}
                          allowNegative={false}
                          className="h-8 text-right text-[14px] tabular-nums"
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
                      <FormItem className="min-w-0 pr-2">
                        <MoneyInput
                          placeholder="—"
                          className="h-8 text-right text-[14px] tabular-nums"
                          disabled={isItemEditDisabled}
                          value={f.value}
                          onChange={f.onChange}
                        />
                        <FormMessage className="text-[12px]" />
                      </FormItem>
                    )}
                  />

                  {/* 삭제 */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={isItemEditDisabled}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  </div>
                ))}
              </div>
            )}

            {fields.length === 0 && (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                품목 추가 버튼을 눌러 수주 품목을 추가하세요.
              </div>
            )}

            {/* items 전체 에러 메시지 */}
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
