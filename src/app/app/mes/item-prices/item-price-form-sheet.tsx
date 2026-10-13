"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { itemPriceFormSchema, ItemPriceFormValues } from "./item-price-form-schema"
import {
  createItemPrice,
  updateItemPrice,
} from "@/lib/actions/item-price.actions"
import type { ItemPriceRow } from "./columns"

// ─── Types ────────────────────────────────────────────────────────────────────

type PartnerOption = { id: string; name: string; code: string }
type ItemOption = { id: string; code: string; name: string }

interface ItemPriceFormSheetProps {
  mode: "create" | "edit"
  itemPrice?: ItemPriceRow | null
  tenantId: string
  partners: PartnerOption[]
  items: ItemOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().split("T")[0]
}

const DEFAULT_VALUES: ItemPriceFormValues = {
  itemId: "",
  partnerId: "",
  priceType: "PURCHASE",
  unitPrice: 0,
  currency: "KRW",
  effectiveFrom: todayString(),
  effectiveTo: "",
  note: "",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ItemPriceFormSheet({
  mode,
  itemPrice,
  tenantId,
  partners,
  items,
  open,
  onOpenChange,
}: ItemPriceFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<ItemPriceFormValues>({
    resolver: zodResolver(itemPriceFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  // ─── create 초기화 ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "create" && open) {
      form.reset({ ...DEFAULT_VALUES, effectiveFrom: todayString() })
    }
  }, [mode, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── edit 초기화 ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "edit" && itemPrice && open) {
      form.reset({
        itemId: itemPrice.item.id,
        partnerId: itemPrice.partner.id,
        priceType: itemPrice.priceType as "PURCHASE" | "SALES",
        unitPrice: Number(itemPrice.unitPrice),
        currency: itemPrice.currency,
        effectiveFrom: new Date(itemPrice.effectiveFrom).toISOString().split("T")[0],
        effectiveTo: itemPrice.effectiveTo
          ? new Date(itemPrice.effectiveTo).toISOString().split("T")[0]
          : "",
        note: itemPrice.note ?? "",
      })
    }
  }, [mode, itemPrice, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 저장 핸들러 ────────────────────────────────────────────────────────────

  async function onSubmit(values: ItemPriceFormValues) {
    setIsLoading(true)
    try {
      if (mode === "create") {
        await createItemPrice(tenantId, {
          itemId: values.itemId,
          partnerId: values.partnerId,
          priceType: values.priceType,
          unitPrice: values.unitPrice,
          currency: values.currency,
          effectiveFrom: new Date(values.effectiveFrom),
          effectiveTo: values.effectiveTo ? new Date(values.effectiveTo) : undefined,
          note: values.note,
        })
      } else if (itemPrice) {
        await updateItemPrice(itemPrice.id, {
          unitPrice: values.unitPrice,
          currency: values.currency,
          effectiveFrom: new Date(values.effectiveFrom),
          effectiveTo: values.effectiveTo ? new Date(values.effectiveTo) : null,
          note: values.note,
        })
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
      title={mode === "create" ? "단가 등록" : "단가 수정"}
      description={
        mode === "create"
          ? "품목별 거래처 단가를 등록합니다."
          : "단가 정보를 수정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-4">
          {/* 품목 */}
          <FormField
            control={form.control}
            name="itemId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>품목</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? undefined}
                  disabled={mode === "edit"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="품목 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        [{item.code}] {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 거래처 */}
          <FormField
            control={form.control}
            name="partnerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>거래처</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? undefined}
                  disabled={mode === "edit"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="거래처 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {partners.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        [{p.code}] {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 유형 */}
          <FormField
            control={form.control}
            name="priceType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>단가 유형</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={mode === "edit"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PURCHASE">구매 (PURCHASE)</SelectItem>
                    <SelectItem value="SALES">판매 (SALES)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            {/* 단가 */}
            <FormField
              control={form.control}
              name="unitPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>단가</FormLabel>
                  <MoneyInput
                    value={field.value}
                    onChange={(v) => field.onChange(v ?? 0)}
                  />
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
                      <SelectItem value="KRW">KRW</SelectItem>
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

          <div className="grid grid-cols-2 gap-4">
            {/* 유효 시작 */}
            <FormField
              control={form.control}
              name="effectiveFrom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>유효 시작일</FormLabel>
                  <Input type="date" {...field} value={field.value ?? ""} />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 유효 종료 */}
            <FormField
              control={form.control}
              name="effectiveTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>유효 종료일 (선택)</FormLabel>
                  <Input type="date" {...field} value={field.value ?? ""} />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

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
      </Form>
    </FormSheet>
  )
}
