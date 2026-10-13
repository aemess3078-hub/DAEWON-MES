"use client"

import { useEffect } from "react"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { FormTextField } from "@/components/common/form-sheet/form-fields"
import { quotationFormSchema, type QuotationFormValues } from "./quotation-form-schema"
import {
  createQuotation,
  updateQuotation,
  getItemPriceForCustomer,
  type QuotationWithDetails,
} from "@/lib/actions/quotation.actions"

const STATUS_OPTIONS_CREATE = [
  { value: "DRAFT", label: "초안" },
  { value: "SUBMITTED", label: "제출됨" },
  { value: "NEGOTIATING", label: "협상중" },
]

const STATUS_OPTIONS_EDIT = [
  ...STATUS_OPTIONS_CREATE,
  { value: "WON", label: "수주확정" },
  { value: "LOST", label: "실패" },
  { value: "EXPIRED", label: "만료" },
  { value: "CANCELLED", label: "취소" },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  quotation: QuotationWithDetails | null
  customers: { id: string; code: string; name: string }[]
  items: { id: string; code: string; name: string; itemType: string; uom: string }[]
  sites: { id: string; code: string; name: string; type: string }[]
  tenantId: string
}

export function QuotationFormSheet({
  open,
  onOpenChange,
  mode,
  quotation,
  customers,
  items,
  sites,
  tenantId,
}: Props) {
  const router = useRouter()

  const buildDefaultValues = (): QuotationFormValues => {
    if (quotation && mode === "edit") {
      return {
        siteId: quotation.siteId,
        customerId: quotation.customerId,
        quotationDate: new Date(quotation.quotationDate).toISOString().split("T")[0],
        validUntil: new Date(quotation.validUntil).toISOString().split("T")[0],
        status: quotation.status,
        currency: quotation.currency,
        note: quotation.note ?? "",
        items: quotation.items.map((i) => ({
          itemId: i.itemId,
          qty: i.qty,
          unitPrice: i.unitPrice,
          note: i.note ?? "",
        })),
      }
    }
    return {
      siteId: sites[0]?.id ?? "",
      customerId: "",
      quotationDate: new Date().toISOString().split("T")[0],
      validUntil: "",
      status: "DRAFT",
      currency: "KRW",
      note: "",
      items: [{ itemId: "", qty: 1, unitPrice: 0, note: "" }],
    }
  }

  const form = useForm<QuotationFormValues>({
    resolver: zodResolver(quotationFormSchema),
    defaultValues: buildDefaultValues(),
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })

  const watchedItems = useWatch({ control: form.control, name: "items" })

  const totalAmount = (watchedItems ?? []).reduce(
    (sum, item) => sum + (Number(item?.qty) || 0) * (Number(item?.unitPrice) || 0),
    0
  )

  // 품목 선택 시 단가 자동 조회
  const handleItemChange = async (index: number, itemId: string) => {
    form.setValue(`items.${index}.itemId`, itemId)
    const customerId = form.getValues("customerId")
    if (customerId && itemId) {
      const price = await getItemPriceForCustomer(itemId, customerId)
      if (price != null) {
        form.setValue(`items.${index}.unitPrice`, price)
      }
    }
  }

  // 고객 변경 시 품목 단가 리셋
  const handleCustomerChange = (customerId: string) => {
    form.setValue("customerId", customerId)
    const currentItems = form.getValues("items")
    currentItems.forEach((_, i) => {
      form.setValue(`items.${i}.unitPrice`, 0)
    })
  }

  useEffect(() => {
    if (open) {
      form.reset(buildDefaultValues())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quotation])

  const onSubmit = async (data: QuotationFormValues) => {
    try {
      if (mode === "create") {
        await createQuotation(data, tenantId)
      } else if (quotation) {
        await updateQuotation(quotation.id, data)
      }
      router.refresh()
      onOpenChange(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : "저장 실패")
    }
  }

  const statusOptions = mode === "edit" ? STATUS_OPTIONS_EDIT : STATUS_OPTIONS_CREATE

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      title={mode === "create" ? "견적 등록" : "견적 수정"}
      description={mode === "create" ? "새 견적서를 등록합니다" : "견적 정보를 수정합니다"}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* 헤더 필드 */}
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>고객사 *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={handleCustomerChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="고객사 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="siteId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>공장 *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="공장 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormTextField control={form.control} name="quotationDate" label="견적일 *" type="date" />
            <FormTextField control={form.control} name="validUntil" label="유효기한 *" type="date" />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>상태</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormTextField control={form.control} name="currency" label="통화" />
          </div>

          <FormTextField control={form.control} name="note" label="비고" />

          {/* 품목 목록 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">품목 목록</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ itemId: "", qty: 1, unitPrice: 0, note: "" })}
              >
                <Plus className="w-4 h-4 mr-1" />
                품목 추가
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/20">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">품목</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-24">수량</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-32">단가</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-32">금액</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => {
                    const qty = Number(watchedItems?.[index]?.qty) || 0
                    const price = Number(watchedItems?.[index]?.unitPrice) || 0
                    return (
                      <tr key={field.id} className="border-t">
                        <td className="px-3 py-2">
                          <FormField
                            control={form.control}
                            name={`items.${index}.itemId`}
                            render={({ field: f }) => (
                              <Select
                                value={f.value}
                                onValueChange={(val) => handleItemChange(index, val)}
                              >
                                <SelectTrigger className="h-8 text-[13px]">
                                  <SelectValue placeholder="품목 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                  {items.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name} ({item.uom})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            className="h-8 text-right text-[13px]"
                            {...form.register(`items.${index}.qty`, { valueAsNumber: true })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <FormField
                            control={form.control}
                            name={`items.${index}.unitPrice`}
                            render={({ field: f }) => (
                              <MoneyInput
                                className="h-8 text-right text-[13px]"
                                value={f.value}
                                onChange={f.onChange}
                              />
                            )}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          ₩{(qty * price).toLocaleString("ko-KR")}
                        </td>
                        <td className="px-3 py-2">
                          {fields.length > 1 && (
                            <button
                              type="button"
                              onClick={() => remove(index)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-muted/10 border-t">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-[13px] font-semibold">합계</td>
                    <td className="px-3 py-2 text-right font-bold text-[15px]">
                      ₩{totalAmount.toLocaleString("ko-KR")}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit">
              {mode === "create" ? "등록" : "저장"}
            </Button>
          </div>
        </form>
      </Form>
    </FormSheet>
  )
}
