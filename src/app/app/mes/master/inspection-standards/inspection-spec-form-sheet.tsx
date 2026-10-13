"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { Plus, Trash2, Loader2 } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Form } from "@/components/ui/form"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FormSelectField, FormTextField } from "@/components/common/form-sheet"
import {
  createInspectionSpec,
  updateInspectionSpec,
  upsertInspectionItems,
  InspectionSpecWithItems,
} from "@/lib/actions/quality.actions"

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { label: "초안",   value: "DRAFT" },
  { label: "활성",   value: "ACTIVE" },
  { label: "비활성", value: "INACTIVE" },
] as const

const INPUT_TYPE_OPTIONS = [
  { label: "수치",   value: "NUMERIC" },
  { label: "텍스트", value: "TEXT" },
  { label: "합불",   value: "BOOLEAN" },
  { label: "선택",   value: "SELECT" },
] as const

// ─── 스키마 ───────────────────────────────────────────────────────────────────

const specFormSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  routingOperationId: z.string().min(1, "공정을 선택하세요"),
  version: z.string().min(1, "버전을 입력하세요").max(20),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"], {
    required_error: "상태를 선택하세요",
  }),
})

type SpecFormValues = z.infer<typeof specFormSchema>

// ─── 검사항목 행 타입 ─────────────────────────────────────────────────────────

interface ItemEditorRow {
  seq: number
  name: string
  inputType: string
  lowerLimit: string
  upperLimit: string
  unit: string
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface InspectionSpecFormSheetProps {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  editingSpec: InspectionSpecWithItems | null
  items: { id: string; code: string; name: string }[]
  routingOperations: {
    id: string
    name: string
    seq: number
    routingId: string
    routing: { id: string; code: string; name: string; version: string }
  }[]
}

const DEFAULT_VALUES: SpecFormValues = {
  itemId: "",
  routingOperationId: "",
  version: "v1.0",
  status: "DRAFT",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InspectionSpecFormSheet({
  tenantId,
  open,
  onOpenChange,
  editingSpec,
  items,
  routingOperations,
}: InspectionSpecFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [itemRows, setItemRows] = useState<ItemEditorRow[]>([])
  const router = useRouter()
  const isEdit = !!editingSpec

  const form = useForm<SpecFormValues>({
    resolver: zodResolver(specFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (open) {
      if (editingSpec) {
        form.reset({
          itemId: editingSpec.itemId,
          routingOperationId: editingSpec.routingOperationId,
          version: editingSpec.version,
          status: editingSpec.status,
        })
        setItemRows(
          editingSpec.inspectionItems.map((item) => ({
            seq: item.seq,
            name: item.name,
            inputType: item.inputType,
            lowerLimit: item.lowerLimit != null ? String(item.lowerLimit) : "",
            upperLimit: item.upperLimit != null ? String(item.upperLimit) : "",
            unit: item.unit ?? "",
          }))
        )
      } else {
        form.reset(DEFAULT_VALUES)
        setItemRows([])
      }
    }
  }, [open, editingSpec]) // eslint-disable-line react-hooks/exhaustive-deps

  function addItemRow() {
    const nextSeq =
      itemRows.length > 0 ? Math.max(...itemRows.map((r) => r.seq)) + 10 : 10
    setItemRows((prev) => [
      ...prev,
      { seq: nextSeq, name: "", inputType: "NUMERIC", lowerLimit: "", upperLimit: "", unit: "" },
    ])
  }

  function removeItemRow(index: number) {
    setItemRows((prev) => prev.filter((_, i) => i !== index))
  }

  function updateItemRow(
    index: number,
    field: keyof ItemEditorRow,
    value: string | number
  ) {
    setItemRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  async function onSubmit(values: SpecFormValues) {
    for (const row of itemRows) {
      if (!row.name.trim()) {
        alert("모든 검사항목에 항목명을 입력해야 합니다.")
        return
      }
    }

    const mappedItems = itemRows.map((row) => ({
      seq: Number(row.seq),
      name: row.name.trim(),
      inputType: row.inputType as "NUMERIC" | "TEXT" | "BOOLEAN" | "SELECT",
      lowerLimit: row.lowerLimit !== "" ? parseFloat(row.lowerLimit) : null,
      upperLimit: row.upperLimit !== "" ? parseFloat(row.upperLimit) : null,
      unit: row.unit.trim() !== "" ? row.unit.trim() : null,
    }))

    setIsLoading(true)
    try {
      if (isEdit) {
        await updateInspectionSpec(editingSpec!.id, {
          version: values.version,
          status: values.status,
        })
        await upsertInspectionItems(editingSpec!.id, mappedItems)
      } else {
        const created = await createInspectionSpec(
          {
            itemId: values.itemId,
            routingOperationId: values.routingOperationId,
            version: values.version,
            status: values.status,
          },
          tenantId
        )
        // 등록과 동시에 검사항목 저장
        if (itemRows.length > 0 && created?.id) {
          await upsertInspectionItems(created.id, mappedItems)
        }
      }
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-3xl overflow-y-auto flex flex-col"
      >
        <SheetHeader>
          <SheetTitle>
            {isEdit ? "검사표준 수정" : "검사표준 등록"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "검사표준 정보를 수정하고 검사항목을 관리합니다."
              : "품목·공정별 검사표준을 등록합니다. 검사항목을 함께 추가할 수 있습니다."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <div className="mt-6 flex-1 space-y-6">
            {/* 표준 메타데이터 */}
            <div className="space-y-4">
              <FormSelectField
                control={form.control}
                name="itemId"
                label="품목"
                placeholder="품목 선택"
                disabled={isEdit}
                options={items.map((item) => ({
                  label: `[${item.code}] ${item.name}`,
                  value: item.id,
                }))}
              />
              <FormSelectField
                control={form.control}
                name="routingOperationId"
                label="공정"
                placeholder="공정 선택"
                disabled={isEdit}
                options={routingOperations.map((op) => ({
                  label: `[${op.routing.code}] ${op.routing.name} / ${op.name} (seq.${op.seq})`,
                  value: op.id,
                }))}
              />
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
                placeholder="상태 선택"
                options={STATUS_OPTIONS.map((o) => ({
                  label: o.label,
                  value: o.value,
                }))}
              />
            </div>

            {/* 검사항목 섹션 — 등록/수정 모드 모두 표시 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pt-2 border-t">
                <div>
                  <h3 className="text-[15px] font-semibold">검사항목</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    {isEdit
                      ? "저장 시 기존 항목 전체가 교체됩니다."
                      : "검사항목을 미리 추가한 후 등록할 수 있습니다."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItemRow}
                  className="h-8 text-[13px]"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  항목 추가
                </Button>
              </div>

              {itemRows.length === 0 ? (
                <div className="flex items-center justify-center py-8 border rounded-lg text-[14px] text-muted-foreground">
                  검사항목이 없습니다. 항목 추가 버튼으로 추가하세요.
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-16 text-[13px]">순서</TableHead>
                        <TableHead className="text-[13px]">항목명</TableHead>
                        <TableHead className="w-28 text-[13px]">입력유형</TableHead>
                        <TableHead className="w-24 text-[13px]">하한값</TableHead>
                        <TableHead className="w-24 text-[13px]">상한값</TableHead>
                        <TableHead className="w-16 text-[13px]">단위</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemRows.map((row, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-7 text-[13px] w-14 text-center"
                              value={row.seq}
                              onChange={(e) =>
                                updateItemRow(
                                  index,
                                  "seq",
                                  parseInt(e.target.value) || 0
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-7 text-[13px]"
                              placeholder="항목명"
                              value={row.name}
                              onChange={(e) =>
                                updateItemRow(index, "name", e.target.value)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={row.inputType}
                              onValueChange={(v) =>
                                updateItemRow(index, "inputType", v)
                              }
                            >
                              <SelectTrigger className="h-7 text-[13px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {INPUT_TYPE_OPTIONS.map((o) => (
                                  <SelectItem
                                    key={o.value}
                                    value={o.value}
                                    className="text-[13px]"
                                  >
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-7 text-[13px]"
                              placeholder="—"
                              value={row.lowerLimit}
                              onChange={(e) =>
                                updateItemRow(
                                  index,
                                  "lowerLimit",
                                  e.target.value
                                )
                              }
                              disabled={row.inputType !== "NUMERIC"}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-7 text-[13px]"
                              placeholder="—"
                              value={row.upperLimit}
                              onChange={(e) =>
                                updateItemRow(
                                  index,
                                  "upperLimit",
                                  e.target.value
                                )
                              }
                              disabled={row.inputType !== "NUMERIC"}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-7 text-[13px]"
                              placeholder="mm"
                              value={row.unit}
                              onChange={(e) => updateItemRow(index, "unit", e.target.value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeItemRow(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </Form>

        <SheetFooter className="mt-8 pt-4 border-t">
          <div className="flex gap-2 w-full justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={form.handleSubmit(onSubmit)}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  저장 중...
                </>
              ) : isEdit ? (
                "저장"
              ) : (
                "등록"
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
