"use client"

import { useState, useEffect } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FormSheet,
  FormTextField,
  FormSelectField,
  FormSwitchField,
} from "@/components/common/form-sheet"
import { bomFormSchema, BOMFormValues } from "./bom-form-schema"
import { createBom, updateBom } from "@/lib/actions/bom.actions"
import { BOMStatus } from "@prisma/client"

interface ParentItem {
  id: string
  code: string
  name: string
  itemType: string
}

interface ComponentItem {
  id: string
  code: string
  name: string
  itemType: string
  uom: string
}

interface BomFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  defaultValues?: Partial<BOMFormValues>
  bomId?: string
  parentItems: ParentItem[]
  componentItems: ComponentItem[]
  tenantId: string
}

const DEFAULT_FORM_VALUES: BOMFormValues = {
  itemId: "",
  version: "v1.0",
  isDefault: false,
  status: BOMStatus.DRAFT,
  bomItems: [],
}

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

export function BomFormSheet({
  open,
  onOpenChange,
  mode,
  defaultValues,
  bomId,
  parentItems,
  componentItems,
  tenantId,
}: BomFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<BOMFormValues>({
    resolver: zodResolver(bomFormSchema),
    defaultValues: defaultValues ?? DEFAULT_FORM_VALUES,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "bomItems",
  })

  useEffect(() => {
    if (open) {
      form.reset(defaultValues ?? DEFAULT_FORM_VALUES)
    }
  }, [open, defaultValues, form])

  async function onSubmit(values: BOMFormValues) {
    setIsLoading(true)
    try {
      const payload = {
        itemId: values.itemId,
        version: values.version,
        isDefault: values.isDefault,
        status: values.status,
        bomItems: values.bomItems.map((bi) => ({
          componentItemId: bi.componentItemId,
          seq: bi.seq,
          qtyPer: bi.qtyPer,
          scrapRate: 0,  // 손실률은 항상 0으로 저장
        })),
      }

      if (mode === "create") {
        await createBom(payload, tenantId)
      } else if (bomId) {
        await updateBom(bomId, payload)
      }
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("저장 실패:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddItem = () => {
    const nextSeq = fields.length + 1
    append({
      componentItemId: "",
      seq: nextSeq,
      qtyPer: 1,
      scrapRate: 0,  // 손실률은 항상 0으로 유지
    })
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      title={mode === "create" ? "BOM 등록" : "BOM 수정"}
      description={
        mode === "create"
          ? "새로운 BOM을 등록합니다."
          : "BOM 정보를 수정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          {/* BOM 헤더 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">BOM 정보</p>

            <FormSelectField
              control={form.control}
              name="itemId"
              label="대상 품목"
              placeholder="완제품 또는 반제품 선택"
              options={parentItems.map((item) => ({
                label: `[${item.code}] ${item.name} (${itemTypeLabels[item.itemType] ?? item.itemType})`,
                value: item.id,
              }))}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormTextField
                control={form.control}
                name="version"
                label="버전"
                placeholder="예: v1.0"
              />
              <FormSelectField
                control={form.control}
                name="status"
                label="상태"
                options={[
                  { label: "초안", value: BOMStatus.DRAFT },
                  { label: "활성", value: BOMStatus.ACTIVE },
                  { label: "비활성", value: BOMStatus.INACTIVE },
                ]}
              />
            </div>

            <FormSwitchField
              control={form.control}
              name="isDefault"
              label="기본 BOM"
              description="이 BOM을 해당 품목의 기본 BOM으로 설정합니다."
            />
          </div>

          {/* BOM 자재 목록 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-foreground">자재 목록</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItem}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                자재 추가
              </Button>
            </div>

            {/* 자재 테이블 헤더 */}
            {fields.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-[40px_1fr_80px_40px] gap-0 bg-muted/50 px-3 py-2 text-[13px] font-medium text-muted-foreground">
                  <span>순서</span>
                  <span>자재</span>
                  <span className="text-right">소요량</span>
                  <span></span>
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-[40px_1fr_80px_40px] gap-0 items-center px-3 py-2 border-t first:border-t-0 hover:bg-muted/20"
                  >
                    {/* 순서 */}
                    <span className="text-[13px] text-muted-foreground">
                      {index + 1}
                    </span>

                    {/* 자재 선택 */}
                    <FormField
                      control={form.control}
                      name={`bomItems.${index}.componentItemId`}
                      render={({ field: f }) => (
                        <FormItem className="pr-2">
                          <Select
                            onValueChange={f.onChange}
                            value={f.value ?? undefined}
                          >
                            <SelectTrigger className="h-8 text-[13px]">
                              <SelectValue placeholder="자재 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {componentItems.map((item) => (
                                <SelectItem
                                  key={item.id}
                                  value={item.id}
                                  className="text-[13px]"
                                >
                                  [{item.code}] {item.name} ({item.uom})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-[12px]" />
                        </FormItem>
                      )}
                    />

                    {/* 소요량 */}
                    <FormField
                      control={form.control}
                      name={`bomItems.${index}.qtyPer`}
                      render={({ field: f }) => (
                        <FormItem className="pr-2">
                          <Input
                            type="number"
                            min={0}
                            step={0.001}
                            className="h-8 text-[13px] text-right"
                            value={f.value ?? ""}
                            onChange={(e) => {
                              const val = e.target.value
                              f.onChange(val === "" ? "" : parseFloat(val))
                            }}
                          />
                          <FormMessage className="text-[12px]" />
                        </FormItem>
                      )}
                    />

                    {/* 삭제 버튼 */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
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
                자재를 추가하세요.
              </div>
            )}

            {/* 자재 목록 전체 에러 메시지 */}
            <FormField
              control={form.control}
              name="bomItems"
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
