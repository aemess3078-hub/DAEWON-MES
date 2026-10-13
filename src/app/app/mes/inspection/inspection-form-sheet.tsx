"use client"

import { useEffect, useState, useCallback } from "react"
import { useForm, useFieldArray, useWatch, type Control } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Info } from "lucide-react"

import { Form } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FormSheet,
  FormSelectField,
  FormNumberField,
} from "@/components/common/form-sheet"
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form"

import {
  inspectionFormSchema,
  InspectionFormValues,
  INSPECTION_RESULT_OPTIONS,
  DEFECT_SEVERITY_OPTIONS,
  DEFECT_DISPOSITION_OPTIONS,
} from "./inspection-form-schema"
import { Badge } from "@/components/ui/badge"
import {
  createQualityInspection,
  getInspectionSpecByOperation,
  InspectionSpecWithItems,
  InspectionItemRow,
  WorkOrderOperationForInspection,
  DefectCodeRow,
} from "@/lib/actions/quality.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

interface InspectionFormSheetProps {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrderOperations: WorkOrderOperationForInspection[]
  profiles: { id: string; displayName: string; email: string }[]
  defectCodes: DefectCodeRow[]
  defaultOperationId?: string
}

const now = () => {
  const d = new Date()
  return d.toISOString().slice(0, 16)
}

const DEFAULT_VALUES: InspectionFormValues = {
  workOrderOperationId: "",
  inspectionSpecId: "",
  inspectorId: "",
  result: null,
  inspectedQty: 1,
  inspectedAt: now(),
  measurements: [],
  defectRecords: [],
}

const INPUT_TYPE_LABEL: Record<string, string> = {
  NUMERIC: "수치",
  TEXT: "텍스트",
  BOOLEAN: "합불",
  SELECT: "선택",
}

// ─── 측정값 입력 행 ──────────────────────────────────────────────────────────
//
// SELECT(선택) 유형은 InspectionItem에 옵션 목록을 저장하는 필드가 스키마에
// 없어(사업계획서 감사 결과 확인) 자유 텍스트 입력으로 처리한다. 실제 select
// 옵션 구조가 필요하면 별도 PR에서 스키마 확장이 선행되어야 한다.
function MeasurementSampleRow({
  control,
  index,
  sampleNo,
  item,
  canRemove,
  onRemove,
}: {
  control: Control<InspectionFormValues>
  index: number
  sampleNo: number
  item: InspectionItemRow
  canRemove: boolean
  onRemove: () => void
}) {
  const numericValue = useWatch({ control, name: `measurements.${index}.numericValue` })
  const outOfSpec =
    item.inputType === "NUMERIC" &&
    typeof numericValue === "number" &&
    ((item.lowerLimit != null && numericValue < item.lowerLimit) ||
      (item.upperLimit != null && numericValue > item.upperLimit))

  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-muted-foreground w-10 shrink-0">#{sampleNo}</span>

      {item.inputType === "NUMERIC" && (
        <FormField
          control={control}
          name={`measurements.${index}.numericValue`}
          render={({ field }) => (
            <FormItem className="flex-1 space-y-0">
              <FormControl>
                <Input
                  type="number"
                  step="any"
                  placeholder="측정값"
                  className={`text-[13px] h-8 ${outOfSpec ? "border-red-400 text-red-600 focus-visible:ring-red-400" : ""}`}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))
                  }
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      {(item.inputType === "TEXT" || item.inputType === "SELECT") && (
        <FormField
          control={control}
          name={`measurements.${index}.textValue`}
          render={({ field }) => (
            <FormItem className="flex-1 space-y-0">
              <FormControl>
                <Input
                  placeholder={item.inputType === "SELECT" ? "값 입력 (옵션 정의 없음)" : "측정값"}
                  className="text-[13px] h-8"
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      {item.inputType === "BOOLEAN" && (
        <FormField
          control={control}
          name={`measurements.${index}.booleanValue`}
          render={({ field }) => (
            <FormItem className="flex-1 space-y-0">
              <Select
                value={field.value == null ? "__none__" : String(field.value)}
                onValueChange={(v) => field.onChange(v === "__none__" ? null : v === "true")}
              >
                <FormControl>
                  <SelectTrigger className="text-[13px] h-8">
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__none__" className="text-[13px] text-muted-foreground">
                    미입력
                  </SelectItem>
                  <SelectItem value="true" className="text-[13px]">
                    합격
                  </SelectItem>
                  <SelectItem value="false" className="text-[13px]">
                    불합격
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      )}

      {outOfSpec && (
        <Badge variant="destructive" className="text-[11px] shrink-0">
          규격 이탈
        </Badge>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
        onClick={onRemove}
        disabled={!canRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InspectionFormSheet({
  tenantId,
  open,
  onOpenChange,
  workOrderOperations,
  profiles,
  defectCodes,
  defaultOperationId,
}: InspectionFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadingSpec, setLoadingSpec] = useState(false)
  const [resolvedSpec, setResolvedSpec] = useState<InspectionSpecWithItems | null>(null)
  const router = useRouter()

  const form = useForm<InspectionFormValues>({
    resolver: zodResolver(inspectionFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const { fields: defectFields, append: appendDefect, remove: removeDefect } =
    useFieldArray({ control: form.control, name: "defectRecords" })

  const {
    fields: measurementFields,
    append: appendMeasurement,
    remove: removeMeasurement,
    replace: replaceMeasurements,
  } = useFieldArray({ control: form.control, name: "measurements" })

  useEffect(() => {
    if (open) {
      form.reset({ ...DEFAULT_VALUES, inspectedAt: now() })
      setResolvedSpec(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 작업지시 공정 선택 시 → 해당 공정의 활성 검사기준 자동 로드
  const handleOperationChange = useCallback(
    async (operationId: string) => {
      form.setValue("workOrderOperationId", operationId)
      form.setValue("inspectionSpecId", "")
      setResolvedSpec(null)
      replaceMeasurements([])

      if (!operationId) return

      const operation = workOrderOperations.find((op) => op.id === operationId)
      if (!operation) return

      setLoadingSpec(true)
      try {
        const spec = await getInspectionSpecByOperation(
          operation.routingOperationId,
          tenantId
        )
        if (spec) {
          form.setValue("inspectionSpecId", spec.id)
          setResolvedSpec(spec)
          // 검사항목마다 sampleNo 1을 기본 입력행으로 준비한다(비워두면 서버에서 제외됨).
          replaceMeasurements(
            spec.inspectionItems.map((item) => ({
              inspectionItemId: item.id,
              sampleNo: 1,
              numericValue: null,
              textValue: null,
              booleanValue: null,
            }))
          )
        } else {
          form.setValue("inspectionSpecId", "")
        }
      } finally {
        setLoadingSpec(false)
      }
    },
    [workOrderOperations, tenantId, form, replaceMeasurements]
  )

  useEffect(() => {
    if (!open || !defaultOperationId) return
    if (!workOrderOperations.some((operation) => operation.id === defaultOperationId)) return

    void handleOperationChange(defaultOperationId)
  }, [open, defaultOperationId, handleOperationChange, workOrderOperations])

  function addSample(inspectionItemId: string) {
    const existingSampleNos = measurementFields
      .filter((f) => f.inspectionItemId === inspectionItemId)
      .map((f) => f.sampleNo)
    const nextSampleNo = existingSampleNos.length > 0 ? Math.max(...existingSampleNos) + 1 : 1
    appendMeasurement({
      inspectionItemId,
      sampleNo: nextSampleNo,
      numericValue: null,
      textValue: null,
      booleanValue: null,
    })
  }

  function removeSample(inspectionItemId: string, index: number) {
    const sameItemCount = measurementFields.filter((f) => f.inspectionItemId === inspectionItemId).length
    if (sameItemCount <= 1) return // 항목당 최소 1행은 유지
    removeMeasurement(index)
  }

  async function onSubmit(values: InspectionFormValues) {
    setIsLoading(true)
    try {
      await createQualityInspection(
        {
          workOrderOperationId: values.workOrderOperationId,
          inspectionSpecId: values.inspectionSpecId,
          inspectorId: values.inspectorId,
          result: values.result ?? null,
          inspectedQty: values.inspectedQty,
          inspectedAt: values.inspectedAt,
          measurements: values.measurements.map((m) => ({
            inspectionItemId: m.inspectionItemId,
            sampleNo: m.sampleNo,
            numericValue: m.numericValue ?? null,
            textValue: m.textValue ?? null,
            booleanValue: m.booleanValue ?? null,
          })),
          defectRecords: values.defectRecords.map((dr) => ({
            defectCodeId: dr.defectCodeId,
            qty: dr.qty,
            severity: dr.severity,
            disposition: dr.disposition ?? null,
          })),
        },
        tenantId
      )
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="공정검사 등록"
      description="작업지시 공정에 대한 품질검사를 등록합니다."
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">

          {/* 섹션 1: 기본 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">검사 기본 정보</p>

            {/* 작업지시 공정 */}
            <FormField
              control={form.control}
              name="workOrderOperationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>작업지시 공정</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={handleOperationChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="작업지시 공정 선택" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workOrderOperations.map((op) => (
                        <SelectItem key={op.id} value={op.id} className="text-[13px]">
                          {op.workOrder.orderNo} — [{op.workOrder.item.code}]{" "}
                          {op.workOrder.manufacturingNo ? ` / ${op.workOrder.manufacturingNo}` : ""}{" "}
                          {op.workOrder.item.name} / {op.routingOperation.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 검사기준 (자동 표시) */}
            <div className="space-y-1.5">
              <Label className="text-[14px]">검사기준</Label>
              {loadingSpec ? (
                <div className="h-9 flex items-center px-3 border rounded-md bg-muted text-[13px] text-muted-foreground">
                  검사기준 조회 중...
                </div>
              ) : resolvedSpec ? (
                <div className="h-auto min-h-9 flex items-start px-3 py-2 border rounded-md bg-muted/30 text-[13px] gap-2">
                  <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      [{resolvedSpec.item.code}] {resolvedSpec.item.name} — {resolvedSpec.routingOperation.name}
                    </p>
                    <p className="text-muted-foreground text-[12px]">
                      버전 {resolvedSpec.version} · 검사항목 {resolvedSpec.inspectionItems.length}개
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-9 flex items-center px-3 border rounded-md bg-amber-50 border-amber-200 text-[13px] text-amber-700">
                  공정 선택 시 활성 검사기준이 자동 로드됩니다
                </div>
              )}
              {/* hidden field for validation */}
              <FormField
                control={form.control}
                name="inspectionSpecId"
                render={() => (
                  <FormItem className="hidden">
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* 검사자 */}
            <FormSelectField
              control={form.control}
              name="inspectorId"
              label="검사자"
              placeholder="검사자 선택"
              options={profiles.map((p) => ({
                label: `${p.displayName} (${p.email})`,
                value: p.id,
              }))}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* 검사수량 */}
              <FormNumberField
                control={form.control}
                name="inspectedQty"
                label="검사수량"
                placeholder="0"
                min={0.001}
                step={1}
              />

              {/* 검사일시 */}
              <FormField
                control={form.control}
                name="inspectedAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>검사일시</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* 판정 결과 */}
            <FormSelectField
              control={form.control}
              name="result"
              label="판정 결과 (선택)"
              placeholder="나중에 판정"
              options={INSPECTION_RESULT_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            />
          </div>

          {/* 검사항목별 측정값 입력 */}
          {resolvedSpec && resolvedSpec.inspectionItems.length > 0 && (
            <div className="pt-4 border-t space-y-3">
              <p className="text-[15px] font-medium text-foreground">검사항목별 측정값</p>
              <p className="text-[12px] text-muted-foreground">
                값을 입력하지 않은 항목은 저장 시 제외됩니다. 규격 이탈 표시는 참고용이며, 최종 판정은 저장 시 서버가 확정합니다.
              </p>
              <div className="space-y-3">
                {resolvedSpec.inspectionItems.map((item) => {
                  const rows = measurementFields
                    .map((field, index) => ({ field, index }))
                    .filter(({ field }) => field.inspectionItemId === item.id)
                    .sort((a, b) => a.field.sampleNo - b.field.sampleNo)

                  return (
                    <div key={item.id} className="border rounded-md p-3 space-y-2.5 bg-muted/10">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-foreground">
                            {item.seq}. {item.name}
                          </span>
                          <Badge variant="outline" className="text-[11px] font-normal">
                            {INPUT_TYPE_LABEL[item.inputType] ?? item.inputType}
                          </Badge>
                          {item.unit && (
                            <span className="text-[12px] text-muted-foreground">({item.unit})</span>
                          )}
                        </div>
                        {item.inputType === "NUMERIC" && (item.lowerLimit != null || item.upperLimit != null) && (
                          <span className="text-[12px] text-muted-foreground font-mono">
                            LSL {item.lowerLimit != null ? item.lowerLimit : "—"} / USL{" "}
                            {item.upperLimit != null ? item.upperLimit : "—"}
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {rows.map(({ field, index }) => (
                          <MeasurementSampleRow
                            key={field.id}
                            control={form.control}
                            index={index}
                            sampleNo={field.sampleNo}
                            item={item}
                            canRemove={rows.length > 1}
                            onRemove={() => removeSample(item.id, index)}
                          />
                        ))}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[12px]"
                        onClick={() => addSample(item.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        샘플 추가
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 섹션 2: 불량 기록 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-foreground">불량 기록 (선택)</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[13px]"
                onClick={() =>
                  appendDefect({
                    defectCodeId: "",
                    qty: 1,
                    severity: "MAJOR",
                    disposition: null,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                불량 추가
              </Button>
            </div>

            {defectFields.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-2">
                불량이 없으면 비워두세요.
              </p>
            ) : (
              <div className="space-y-3">
                {defectFields.map((field, index) => (
                  <div
                    key={field.id}
                    className="border rounded-md p-3 space-y-3 bg-muted/20"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-muted-foreground">
                        불량 #{index + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeDefect(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <FormField
                      control={form.control}
                      name={`defectRecords.${index}.defectCodeId`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormLabel className="text-[13px]">불량코드</FormLabel>
                          <Select onValueChange={f.onChange} value={f.value}>
                            <FormControl>
                              <SelectTrigger className="text-[13px]">
                                <SelectValue placeholder="불량코드 선택" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {defectCodes.map((dc) => (
                                <SelectItem key={dc.id} value={dc.id} className="text-[13px]">
                                  [{dc.code}] {dc.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name={`defectRecords.${index}.qty`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-[13px]">수량</FormLabel>
                            <FormControl>
                              <QuantityInput
                                maxDecimals={6}
                                allowNegative={false}
                                className="text-[13px]"
                                value={f.value}
                                onChange={(v) => f.onChange(v || 1)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`defectRecords.${index}.severity`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-[13px]">중요도</FormLabel>
                            <Select onValueChange={f.onChange} value={f.value}>
                              <FormControl>
                                <SelectTrigger className="text-[13px]">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {DEFECT_SEVERITY_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value} className="text-[13px]">
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`defectRecords.${index}.disposition`}
                        render={({ field: f }) => (
                          <FormItem>
                            <FormLabel className="text-[13px]">처리방법</FormLabel>
                            <Select
                              onValueChange={(v) => f.onChange(v === "__none__" ? null : v)}
                              value={f.value ?? "__none__"}
                            >
                              <FormControl>
                                <SelectTrigger className="text-[13px]">
                                  <SelectValue placeholder="선택" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-[13px] text-muted-foreground">
                                  미정
                                </SelectItem>
                                {DEFECT_DISPOSITION_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value} className="text-[13px]">
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Form>
    </FormSheet>
  )
}
