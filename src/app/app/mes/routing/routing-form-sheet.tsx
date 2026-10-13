"use client"

import { useState, useEffect, useMemo } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Check, ChevronsUpDown, X } from "lucide-react"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
import { cn } from "@/lib/utils"
import { routingFormSchema, RoutingFormValues } from "./routing-form-schema"
import { createRouting, updateRouting, RoutingWithDetails } from "@/lib/actions/routing.actions"
import { RoutingStatus, RoutingScope } from "@prisma/client"

interface WorkCenter {
  id: string
  code: string
  name: string
}

interface ItemOption {
  id: string
  code: string
  name: string
  itemType: string
}

interface RoutingFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  routing?: RoutingWithDetails | null
  items: ItemOption[]
  workCenters: WorkCenter[]
  tenantId: string
}

const DEFAULT_FORM_VALUES: RoutingFormValues = {
  code: "",
  name: "",
  version: "1.0",
  status: RoutingStatus.DRAFT,
  scope: RoutingScope.ITEM_SPECIFIC,
  itemIds: [],
  isDefault: false,
  operations: [],
}

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

export function RoutingFormSheet({
  open,
  onOpenChange,
  mode,
  routing,
  items,
  workCenters,
  tenantId,
}: RoutingFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [itemPickerOpen, setItemPickerOpen] = useState(false)
  const [itemSearch, setItemSearch] = useState("")
  const router = useRouter()

  const form = useForm<RoutingFormValues>({
    resolver: zodResolver(routingFormSchema),
    defaultValues: DEFAULT_FORM_VALUES,
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "operations",
  })

  useEffect(() => {
    if (mode === "edit" && routing && open) {
      const linkedItemIds = routing.items?.map((ir) => ir.itemId) ?? []
      const isDefault = routing.items?.some((ir) => ir.isDefault) ?? false
      form.reset({
        code: routing.code,
        name: routing.name,
        version: routing.version,
        status: routing.status,
        scope: routing.scope,
        itemIds: linkedItemIds,
        isDefault,
        operations: routing.operations.map((op) => ({
          seq: op.seq,
          operationCode: op.operationCode,
          name: op.name,
          workCenterId: op.workCenterId,
          standardTime: Number(op.standardTime),
        })),
      })
    }
    if (mode === "create" && open) {
      form.reset(DEFAULT_FORM_VALUES)
    }
  }, [mode, routing, open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: RoutingFormValues) {
    setIsLoading(true)
    try {
      const payload = {
        code: values.code,
        name: values.name,
        version: values.version,
        status: values.status,
        scope: values.scope,
        itemIds: values.scope === RoutingScope.COMMON ? [] : values.itemIds,
        isDefault: values.scope === RoutingScope.COMMON ? false : values.isDefault,
        operations: values.operations.map((op) => ({
          seq: op.seq,
          operationCode: op.operationCode,
          name: op.name,
          workCenterId: op.workCenterId,
          standardTime: op.standardTime,
        })),
      }

      if (mode === "create") {
        await createRouting(payload, tenantId)
      } else if (routing) {
        await updateRouting(routing.id, payload)
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

  const handleAddOperation = () => {
    const nextSeq = fields.length + 1
    append({
      seq: nextSeq,
      operationCode: "",
      name: "",
      workCenterId: "",
      standardTime: 0,
    })
  }

  const scope = form.watch("scope")
  const selectedItemIds = form.watch("itemIds")

  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.includes(item.id)),
    [items, selectedItemIds]
  )

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
    )
  }, [items, itemSearch])

  function toggleItemSelected(itemId: string) {
    const current = form.getValues("itemIds")
    if (current.includes(itemId)) {
      form.setValue(
        "itemIds",
        current.filter((id) => id !== itemId),
        { shouldValidate: true }
      )
    } else {
      form.setValue("itemIds", [...current, itemId], { shouldValidate: true })
    }
  }

  function removeSelectedItem(itemId: string) {
    form.setValue(
      "itemIds",
      form.getValues("itemIds").filter((id) => id !== itemId),
      { shouldValidate: true }
    )
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      title={mode === "create" ? "라우팅 등록" : "라우팅 수정"}
      description={
        mode === "create"
          ? "새로운 공정 라우팅을 등록합니다."
          : "공정 라우팅 정보를 수정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          {/* 라우팅 기본 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">라우팅 정보</p>

            <div className="grid grid-cols-2 gap-4">
              <FormTextField
                control={form.control}
                name="code"
                label="라우팅 코드"
                placeholder="예: RTG-ASSY-001"
              />
              <FormTextField
                control={form.control}
                name="version"
                label="버전"
                placeholder="예: 1.0"
              />
            </div>

            <FormTextField
              control={form.control}
              name="name"
              label="라우팅 명"
              placeholder="예: 조립 공정 A"
            />

            <FormSelectField
              control={form.control}
              name="status"
              label="상태"
              options={[
                { label: "초안", value: RoutingStatus.DRAFT },
                { label: "활성", value: RoutingStatus.ACTIVE },
                { label: "비활성", value: RoutingStatus.INACTIVE },
              ]}
            />
          </div>

          {/* 라우팅 적용 범위 */}
          <div className="space-y-3 pt-4 border-t">
            <p className="text-[15px] font-medium text-foreground">라우팅 적용 범위</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => form.setValue("scope", RoutingScope.COMMON, { shouldValidate: true })}
                className={cn(
                  "text-left rounded-lg border-2 p-3 space-y-1 transition-colors",
                  scope === RoutingScope.COMMON
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                      scope === RoutingScope.COMMON ? "border-primary" : "border-muted-foreground/40"
                    )}
                  >
                    {scope === RoutingScope.COMMON && (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="text-[14px] font-medium">범용 라우팅</span>
                </div>
                <p className="text-[12px] text-muted-foreground pl-6">
                  모든 완제품·반제품에서 선택할 수 있습니다.
                </p>
              </button>

              <button
                type="button"
                onClick={() => form.setValue("scope", RoutingScope.ITEM_SPECIFIC, { shouldValidate: true })}
                className={cn(
                  "text-left rounded-lg border-2 p-3 space-y-1 transition-colors",
                  scope === RoutingScope.ITEM_SPECIFIC
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
                      scope === RoutingScope.ITEM_SPECIFIC ? "border-primary" : "border-muted-foreground/40"
                    )}
                  >
                    {scope === RoutingScope.ITEM_SPECIFIC && (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="text-[14px] font-medium">품목 전용 라우팅</span>
                </div>
                <p className="text-[12px] text-muted-foreground pl-6">
                  연결된 품목에서만 선택할 수 있습니다.
                </p>
              </button>
            </div>

            {scope === RoutingScope.COMMON && (
              <p className="text-[12px] text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                이 라우팅은 품목 연결 없이 모든 완제품·반제품의 생산계획 및 작업지시에서 선택할 수 있습니다.
              </p>
            )}
          </div>

          {/* 품목 연결 정보 — 품목 전용일 때만 표시 */}
          {scope === RoutingScope.ITEM_SPECIFIC && (
            <div className="space-y-4 pt-4 border-t">
              <p className="text-[15px] font-medium text-foreground">품목 연결</p>

              <FormField
                control={form.control}
                name="itemIds"
                render={() => (
                  <FormItem>
                    <FormLabel className="text-[13px]">
                      대상 품목 <span className="text-destructive">*</span>
                    </FormLabel>
                    <Popover open={itemPickerOpen} onOpenChange={setItemPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between h-9 text-[13px] font-normal"
                        >
                          {selectedItems.length > 0
                            ? `${selectedItems.length}개 품목 선택됨`
                            : "완제품 또는 반제품 검색"}
                          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <div className="p-2 border-b">
                          <Input
                            placeholder="품목코드 또는 품목명 검색"
                            value={itemSearch}
                            onChange={(e) => setItemSearch(e.target.value)}
                            className="h-8 text-[13px]"
                          />
                        </div>
                        <div className="max-h-64 overflow-y-auto p-1">
                          {filteredItems.length === 0 && (
                            <p className="text-[13px] text-muted-foreground text-center py-4">
                              검색 결과가 없습니다.
                            </p>
                          )}
                          {filteredItems.map((item) => {
                            const checked = selectedItemIds.includes(item.id)
                            return (
                              <div
                                key={item.id}
                                role="button"
                                onClick={() => toggleItemSelected(item.id)}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer text-[13px]"
                              >
                                <Checkbox checked={checked} onCheckedChange={() => toggleItemSelected(item.id)} />
                                <span className="font-mono text-muted-foreground">[{item.code}]</span>
                                <span className="flex-1 truncate">{item.name}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {itemTypeLabels[item.itemType] ?? item.itemType}
                                </span>
                                {checked && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                              </div>
                            )
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <FormMessage className="text-[12px]" />
                  </FormItem>
                )}
              />

              {selectedItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedItems.map((item) => (
                    <Badge key={item.id} variant="secondary" className="text-[12px] gap-1 pr-1">
                      [{item.code}] {item.name}
                      <button
                        type="button"
                        onClick={() => removeSelectedItem(item.id)}
                        className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <FormSwitchField
                control={form.control}
                name="isDefault"
                label="기본 라우팅"
                description="선택된 품목의 기본 라우팅으로 설정합니다."
              />
            </div>
          )}

          {/* 공정 목록 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-foreground">공정 목록</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddOperation}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                공정 추가
              </Button>
            </div>

            {fields.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-[36px_1fr_140px_72px_36px] gap-0 bg-muted/50 px-3 py-2 text-[13px] font-medium text-muted-foreground">
                  <span>순서</span>
                  <span>공정 선택</span>
                  <span>작업장</span>
                  <span className="text-right">표준시간(분)</span>
                  <span></span>
                </div>

                {fields.map((field, index) => {
                  const selectedWc = workCenters.find(
                    (wc) => wc.id === form.watch(`operations.${index}.workCenterId`)
                  )
                  return (
                    <div
                      key={field.id}
                      className="grid grid-cols-[36px_1fr_140px_72px_36px] gap-0 items-center px-3 py-2 border-t first:border-t-0 hover:bg-muted/20"
                    >
                      {/* 순서 */}
                      <span className="text-[13px] text-muted-foreground">
                        {index + 1}
                      </span>

                      {/* 공정 선택 — workCenterId 선택 시 operationCode/name 자동 채움 */}
                      <FormField
                        control={form.control}
                        name={`operations.${index}.workCenterId`}
                        render={({ field: f }) => (
                          <FormItem className="pr-2">
                            <Select
                              onValueChange={(val) => {
                                const wc = workCenters.find((w) => w.id === val)
                                if (wc) {
                                  f.onChange(val)
                                  form.setValue(`operations.${index}.operationCode`, wc.code)
                                  form.setValue(`operations.${index}.name`, wc.name)
                                }
                              }}
                              value={f.value ?? undefined}
                            >
                              <SelectTrigger className="h-8 text-[13px]">
                                <SelectValue placeholder="공정 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {workCenters.map((wc) => (
                                  <SelectItem
                                    key={wc.id}
                                    value={wc.id}
                                    className="text-[13px]"
                                  >
                                    [{wc.code}] {wc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-[12px]" />
                          </FormItem>
                        )}
                      />

                      {/* 작업장명 (자동 표시) */}
                      <div className="pr-2 text-[13px] text-muted-foreground truncate">
                        {selectedWc ? selectedWc.name : <span className="text-muted-foreground/40">—</span>}
                      </div>

                      {/* 표준시간 */}
                      <FormField
                        control={form.control}
                        name={`operations.${index}.standardTime`}
                        render={({ field: f }) => (
                          <FormItem className="pr-2">
                            <Input
                              type="number"
                              min={0}
                              step={0.1}
                              className="h-8 text-[13px] text-right"
                              value={f.value ?? ""}
                              onChange={(e) => {
                                const val = e.target.value
                                f.onChange(val === "" ? 0 : parseFloat(val))
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
                  )
                })}
              </div>
            )}

            {fields.length === 0 && (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                공정을 추가하세요.
              </div>
            )}

            {/* 공정 목록 전체 에러 메시지 */}
            <FormField
              control={form.control}
              name="operations"
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
