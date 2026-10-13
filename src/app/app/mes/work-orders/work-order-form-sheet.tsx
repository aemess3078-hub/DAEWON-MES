"use client"

import { useState, useEffect, useRef } from "react"
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
  FormNumberField,
  FormDateField,
} from "@/components/common/form-sheet"
import { SearchableItemCombobox } from "@/components/common/searchable-item-combobox"
import { workOrderFormSchema, WorkOrderFormValues } from "./work-order-form-schema"
import {
  createWorkOrder,
  updateWorkOrder,
  generateOrderNo,
  getBomsForItem,
  getRoutingsForItem,
  type ProductionPlanItemForWorkOrder,
  WorkOrderWithDetails,
} from "@/lib/actions/work-order.actions"
import { WorkOrderStatus } from "@prisma/client"
import { formatQuantity } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type BomOption = { id: string; version: string; isDefault: boolean }
type RoutingOption = {
  id: string
  code: string
  name: string
  version: string
  isDefault: boolean
  scope: "COMMON" | "ITEM_SPECIFIC"
  operations: {
    id: string
    seq: number
    operationCode: string
    name: string
    workCenter: { id: string; code: string; name: string }
  }[]
}

interface WorkOrderFormSheetProps {
  mode: "create" | "edit"
  workOrder?: WorkOrderWithDetails | null
  sites: { id: string; code: string; name: string; type: string }[]
  items: { id: string; code: string; name: string; itemType: string }[]
  equipments: { id: string; code: string; name: string; equipmentType: string; workCenterId: string }[]
  productionPlanItems: ProductionPlanItemForWorkOrder[]
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProductionPlanItemId?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_FORM_VALUES: WorkOrderFormValues = {
  siteId: "",
  itemId: "",
  bomId: "",
  routingId: "",
  orderNo: "",
  manufacturingNo: "",
  plannedQty: 1,
  status: WorkOrderStatus.DRAFT,
  dueDate: null,
  productionPlanItemId: null,
  operations: [],
}

const workOrderStatusOptions = [
  { label: "초안", value: WorkOrderStatus.DRAFT },
  { label: "작업대기", value: WorkOrderStatus.RELEASED },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkOrderFormSheet({
  mode,
  workOrder,
  sites,
  items,
  equipments,
  productionPlanItems,
  tenantId,
  open,
  onOpenChange,
  defaultProductionPlanItemId,
}: WorkOrderFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [boms, setBoms] = useState<BomOption[]>([])
  const [routings, setRoutings] = useState<RoutingOption[]>([])
  const [loadingBoms, setLoadingBoms] = useState(false)
  const router = useRouter()

  // 사용자가 직접 수정한 공정 계획수량 인덱스를 추적 (상단 plannedQty 변경 시 덮어쓰지 않기 위함)
  const manuallyEditedOps = useRef<Set<number>>(new Set())
  const appliedDefaultPlanItemRef = useRef<string | null>(null)

  const form = useForm<WorkOrderFormValues>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: DEFAULT_FORM_VALUES,
  })

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "operations",
  })

  // ─── create 모드 초기화 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "create" && open) {
      manuallyEditedOps.current.clear()
      appliedDefaultPlanItemRef.current = null
      form.reset(DEFAULT_FORM_VALUES)
      setBoms([])
      setRoutings([])
      generateOrderNo(tenantId).then((no) => form.setValue("orderNo", no))
    }
  }, [mode, open, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── edit 모드 초기화 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "edit" && workOrder && open) {
      // BOM/라우팅 목록 로딩 (해당 품목 기준)
      setLoadingBoms(true)
      Promise.all([
        getBomsForItem(workOrder.itemId),
        getRoutingsForItem(workOrder.itemId),
      ]).then(([newBoms, newRoutings]) => {
        setBoms(newBoms)
        setRoutings(newRoutings as RoutingOption[])
        setLoadingBoms(false)
      })

      const editOps = workOrder.operations.map((op) => ({
        routingOperationId: op.routingOperationId,
        equipmentId: op.equipmentId ?? null,
        seq: op.seq,
        plannedQty: Number(op.plannedQty),
        assignments: op.assignments.map((assignment) => ({
          equipmentId: assignment.equipmentId,
          assignedQty: Number(assignment.assignedQty),
        })),
      }))
      // edit 모드에서 기존 공정 수량은 DB 값을 유지 (수동 편집으로 취급)
      manuallyEditedOps.current.clear()
      editOps.forEach((_, i) => manuallyEditedOps.current.add(i))

      form.reset({
        siteId: workOrder.siteId,
        itemId: workOrder.itemId,
        bomId: workOrder.bomId,
        routingId: workOrder.routingId,
        orderNo: workOrder.orderNo,
        manufacturingNo: workOrder.manufacturingNo ?? "",
        plannedQty: Number(workOrder.plannedQty),
        status: workOrder.status,
        dueDate: workOrder.dueDate
          ? new Date(workOrder.dueDate).toISOString().split("T")[0]
          : null,
        productionPlanItemId: workOrder.productionPlanItemId ?? null,
        operations: editOps,
      })
    }
  }, [mode, workOrder, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 품목 변경 핸들러 (BOM/라우팅 연쇄 로딩) ────────────────────────────────

  const handleItemChange = async (itemId: string) => {
    form.setValue("productionPlanItemId", null)
    form.setValue("itemId", itemId)
    form.setValue("bomId", "")
    form.setValue("routingId", "")
    replace([])

    if (!itemId) {
      setBoms([])
      setRoutings([])
      return
    }

    setLoadingBoms(true)
    try {
      const [newBoms, newRoutings] = await Promise.all([
        getBomsForItem(itemId),
        getRoutingsForItem(itemId),
      ])
      setBoms(newBoms)
      setRoutings(newRoutings as RoutingOption[])
    } finally {
      setLoadingBoms(false)
    }
  }

  // ─── 라우팅 변경 핸들러 (Operations 자동 채움) ──────────────────────────────

  const applyRoutingOperations = (routing: RoutingOption | undefined, plannedQty: number) => {
    manuallyEditedOps.current.clear()
    if (routing?.operations && routing.operations.length > 0) {
      replace(
        routing.operations.map((op) => ({
          routingOperationId: op.id,
          equipmentId: null,
          seq: op.seq,
          plannedQty,
          assignments: [],
        }))
      )
    } else {
      replace([])
    }
  }

  const handleProductionPlanItemChange = async (productionPlanItemId: string) => {
    if (productionPlanItemId === "__none__") {
      form.setValue("productionPlanItemId", null)
      return
    }

    const planItem = productionPlanItems.find((item) => item.id === productionPlanItemId)
    if (!planItem) return

    const plannedQty = Math.max(Number(planItem.remainingQty), 1)
    form.setValue("productionPlanItemId", planItem.id)
    form.setValue("siteId", planItem.plan.siteId)
    form.setValue("itemId", planItem.itemId)
    form.setValue("plannedQty", plannedQty)
    form.setValue("bomId", planItem.bomId ?? "")
    form.setValue("routingId", "")
    replace([])

    setLoadingBoms(true)
    try {
      const [newBoms, newRoutings] = await Promise.all([
        getBomsForItem(planItem.itemId),
        getRoutingsForItem(planItem.itemId),
      ])
      const typedRoutings = newRoutings as RoutingOption[]
      setBoms(newBoms)
      setRoutings(typedRoutings)

      const routingId =
        planItem.routingId ??
        typedRoutings.find((routing) => routing.isDefault)?.id ??
        ""
      form.setValue("routingId", routingId)
      applyRoutingOperations(
        typedRoutings.find((routing) => routing.id === routingId),
        plannedQty
      )
    } finally {
      setLoadingBoms(false)
    }
  }

  useEffect(() => {
    if (mode !== "create" || !open || !defaultProductionPlanItemId) return
    if (appliedDefaultPlanItemRef.current === defaultProductionPlanItemId) return
    if (!productionPlanItems.some((item) => item.id === defaultProductionPlanItemId)) return

    appliedDefaultPlanItemRef.current = defaultProductionPlanItemId
    void handleProductionPlanItemChange(defaultProductionPlanItemId)
  }, [mode, open, defaultProductionPlanItemId, productionPlanItems]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoutingChange = (routingId: string) => {
    form.setValue("routingId", routingId)
    applyRoutingOperations(
      routings.find((r) => r.id === routingId),
      form.getValues("plannedQty") || 1
    )
  }

  // ─── 저장 핸들러 ────────────────────────────────────────────────────────────

  async function onSubmit(values: WorkOrderFormValues) {
    setIsLoading(true)
    try {
      if (mode === "create") {
        await createWorkOrder(values, tenantId)
      } else if (workOrder) {
        await updateWorkOrder(workOrder.id, values)
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

  // ─── 현재 선택된 라우팅의 공정 목록 ─────────────────────────────────────────

  const selectedRoutingId = form.watch("routingId")
  const selectedRouting = routings.find((r) => r.id === selectedRoutingId)
  const availableOperations = selectedRouting?.operations ?? []

  // ─── 상단 계획수량 변경 시 수동 편집하지 않은 공정 수량 동기화 ───────────────

  const watchedPlannedQty = form.watch("plannedQty")
  useEffect(() => {
    const qty = Number(watchedPlannedQty)
    if (!qty || fields.length === 0) return
    fields.forEach((_, index) => {
      if (!manuallyEditedOps.current.has(index)) {
        form.setValue(`operations.${index}.plannedQty`, qty)
      }
    })
  }, [watchedPlannedQty]) // eslint-disable-line react-hooks/exhaustive-deps

  const watchedOperations = form.watch("operations")

  const getOperationMeta = (index: number) => {
    const operationId = form.watch(`operations.${index}.routingOperationId`)
    const selectedOperation = availableOperations.find((op) => op.id === operationId)
    const fallbackOperation = workOrder?.operations[index]?.routingOperation

    return {
      id: operationId,
      name: selectedOperation?.name ?? fallbackOperation?.name ?? "-",
      workCenterId: selectedOperation?.workCenter?.id ?? null,
    }
  }

  const getAssignments = (index: number) =>
    form.getValues(`operations.${index}.assignments`) ?? []

  const getAssignmentTotal = (index: number) =>
    getAssignments(index).reduce(
      (sum, assignment) => sum + Number(assignment.assignedQty || 0),
      0
    )

  const getAvailableEquipmentsForOperation = (index: number) => {
    const workCenterId = getOperationMeta(index).workCenterId
    if (!workCenterId) return equipments
    return equipments.filter((equipment) => equipment.workCenterId === workCenterId)
  }

  const addAssignment = (operationIndex: number) => {
    const assignments = getAssignments(operationIndex)
    const plannedQty = Number(form.getValues(`operations.${operationIndex}.plannedQty`) || 0)
    const assignedTotal = getAssignmentTotal(operationIndex)
    const remainingQty = Math.max(plannedQty - assignedTotal, 0)

    form.setValue(
      `operations.${operationIndex}.assignments`,
      [
        ...assignments,
        {
          equipmentId: "",
          assignedQty: remainingQty > 0 ? remainingQty : 1,
        },
      ],
      { shouldDirty: true, shouldValidate: true }
    )
  }

  const removeAssignment = (operationIndex: number, assignmentIndex: number) => {
    const assignments = getAssignments(operationIndex)
    form.setValue(
      `operations.${operationIndex}.assignments`,
      assignments.filter((_, index) => index !== assignmentIndex),
      { shouldDirty: true, shouldValidate: true }
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      title={mode === "create" ? "작업지시 / 제조번호 등록" : "작업지시 / 제조번호 수정"}
      description={
        mode === "create"
          ? "새 작업지시를 등록하고 제조번호를 확인합니다."
          : "작업지시 정보와 제조번호를 확인합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          {/* 헤더 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">기본 정보</p>

            <FormField
              control={form.control}
              name="productionPlanItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>생산계획</FormLabel>
                  <Select
                    onValueChange={handleProductionPlanItemChange}
                    value={field.value ?? "__none__"}
                    disabled={mode === "edit"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="확정된 생산계획 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        생산계획 없이 등록
                      </SelectItem>
                      {productionPlanItems.map((planItem) => (
                        <SelectItem key={planItem.id} value={planItem.id}>
                          [{planItem.plan.planNo}] {planItem.item.name} · 계획 {formatQuantity(planItem.plannedQty)} / 배정 {formatQuantity(planItem.assignedQty)} / 잔여 {formatQuantity(planItem.remainingQty)} · {new Date(planItem.plan.endDate).toISOString().slice(0, 10)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormTextField
                control={form.control}
                name="orderNo"
                label="작업지시번호"
                placeholder="WO-2026-001"
              />

              <FormSelectField
                control={form.control}
                name="siteId"
                label="공장"
                placeholder="공장 선택"
                options={sites.map((s) => ({
                  label: `[${s.code}] ${s.name}`,
                  value: s.id,
                }))}
              />
            </div>

            <FormTextField
              control={form.control}
              name="manufacturingNo"
              label="제조번호"
              placeholder="미입력 시 자동 발행"
              description={
                mode === "create"
                  ? "비워두면 품목 설정에 따라 자동 발행됩니다. 직접 입력도 가능합니다."
                  : "이미 발행된 제조번호를 비우면 추적성 조회가 어려워질 수 있습니다."
              }
            />

            {/* 품목 (전체 너비) */}
            <FormField
              control={form.control}
              name="itemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>품목</FormLabel>
                  <SearchableItemCombobox
                    items={items}
                    value={field.value ?? ""}
                    onSelect={handleItemChange}
                    disabled={mode === "edit"}
                    placeholder="완제품 또는 반제품 선택"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* BOM */}
              <FormField
                control={form.control}
                name="bomId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>BOM</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? undefined}
                      disabled={!form.watch("itemId") || loadingBoms}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            loadingBoms ? "로딩 중..." : "BOM 선택"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {boms.map((bom) => (
                          <SelectItem key={bom.id} value={bom.id}>
                            {bom.version}
                            {bom.isDefault ? " (기본)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 라우팅 */}
              <FormField
                control={form.control}
                name="routingId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>라우팅</FormLabel>
                    <Select
                      onValueChange={(val) => handleRoutingChange(val)}
                      value={field.value ?? undefined}
                      disabled={!form.watch("itemId") || loadingBoms}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            loadingBoms ? "로딩 중..." : "라우팅 선택"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {routings.map((routing) => (
                          <SelectItem key={routing.id} value={routing.id}>
                            [{routing.code}] {routing.name} v{routing.version}
                            {routing.isDefault ? " (기본)" : ""}
                            {routing.scope === "COMMON" ? " · 범용" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormNumberField
                control={form.control}
                name="plannedQty"
                label="계획수량"
                placeholder="0"
                min={1}
                step={1}
              />

              <FormSelectField
                control={form.control}
                name="status"
                label="상태"
                options={workOrderStatusOptions}
              />
            </div>

            <FormDateField
              control={form.control}
              name="dueDate"
              label="납기일"
            />
          </div>

          {/* 공정 목록 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium text-foreground">공정 목록</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    routingOperationId: "",
                    equipmentId: null,
                    seq: fields.length + 1,
                    plannedQty: form.getValues("plannedQty") || 1,
                    assignments: [],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                공정 추가
              </Button>
            </div>

            {fields.length > 0 && (
              <div className="rounded-md border overflow-hidden">
                {/* 헤더 */}
                <div className="grid grid-cols-[36px_1fr_80px_40px] gap-0 bg-muted/50 px-3 py-2 text-[13px] font-medium text-muted-foreground">
                  <span>순서</span>
                  <span>공정</span>
                  <span className="text-right">계획수량</span>
                  <span></span>
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-[36px_1fr_80px_40px] gap-0 items-center px-3 py-2 border-t first:border-t-0 hover:bg-muted/20"
                  >
                    {/* 순서 */}
                    <span className="text-[13px] text-muted-foreground">
                      {field.seq}
                    </span>

                    {/* 공정 선택 */}
                    <FormField
                      control={form.control}
                      name={`operations.${index}.routingOperationId`}
                      render={({ field: f }) => (
                        <FormItem className="pr-2">
                          <Select
                            onValueChange={f.onChange}
                            value={f.value ?? undefined}
                          >
                            <SelectTrigger className="h-8 text-[13px]">
                              <SelectValue placeholder="공정 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableOperations.map((op) => (
                                <SelectItem
                                  key={op.id}
                                  value={op.id}
                                  className="text-[13px]"
                                >
                                  {op.seq}. {op.name}
                                </SelectItem>
                              ))}
                              {/* edit 모드에서 라우팅 공정 목록이 없을 때 현재 값 표시 */}
                              {availableOperations.length === 0 && f.value && (
                                <SelectItem
                                  value={f.value}
                                  className="text-[13px]"
                                >
                                  {workOrder?.operations[index]?.routingOperation.name ?? f.value}
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-[12px]" />
                        </FormItem>
                      )}
                    />

                    {/* 계획수량 */}
                    <FormField
                      control={form.control}
                      name={`operations.${index}.plannedQty`}
                      render={({ field: f }) => (
                        <FormItem className="pr-2">
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className="h-8 text-[13px] text-right"
                            value={f.value ?? ""}
                            onChange={(e) => {
                              const val = e.target.value
                              f.onChange(val === "" ? "" : parseFloat(val))
                              manuallyEditedOps.current.add(index)
                            }}
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
                라우팅을 선택하거나 공정을 직접 추가하세요.
              </div>
            )}

            {/* 설비 배정 섹션 (공정별 설비 선택) */}
            {fields.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-muted-foreground">설비별 배정</p>
                  <span className="text-[13px] text-muted-foreground">
                    배정 행이 없으면 기존 단일 설비 배정을 사용합니다.
                  </span>
                </div>

                <div className="space-y-3">
                  {fields.map((field, index) => {
                    const operation = getOperationMeta(index)
                    const operationAssignments = watchedOperations[index]?.assignments ?? []
                    const operationEquipments = getAvailableEquipmentsForOperation(index)
                    const plannedQty = Number(watchedOperations[index]?.plannedQty || 0)
                    const assignedTotal = operationAssignments.reduce(
                      (sum, assignment) => sum + Number(assignment.assignedQty || 0),
                      0
                    )
                    const difference = plannedQty - assignedTotal
                    const isBalanced =
                      operationAssignments.length === 0 ||
                      Math.abs(difference) <= 0.000001
                    const selectedEquipmentIds = operationAssignments
                      .map((assignment) => assignment.equipmentId)
                      .filter(Boolean)

                    return (
                      <div key={`assignment-${field.id}`} className="rounded-md border">
                        <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-medium">
                              {field.seq}. {operation.name}
                            </p>
                            <p className="text-[13px] text-muted-foreground">
                              배정합계 {formatQuantity(assignedTotal)} / 계획수량 {formatQuantity(plannedQty)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addAssignment(index)}
                            disabled={operationEquipments.length === 0}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            설비 추가
                          </Button>
                        </div>

                        {operationEquipments.length === 0 && (
                          <div className="px-3 py-3 text-[13px] text-muted-foreground">
                            이 작업장에 등록된 설비가 없습니다. 설비관리에서 먼저 등록하세요.
                          </div>
                        )}

                        {operationEquipments.length > 0 && (
                          <div className="grid grid-cols-[120px_1fr] items-center gap-2 px-3 py-2">
                            <span className="text-[13px] text-muted-foreground">기본 설비</span>
                            <FormField
                              control={form.control}
                              name={`operations.${index}.equipmentId`}
                              render={({ field: equipmentField }) => (
                                <FormItem>
                                  <Select
                                    onValueChange={(value) =>
                                      equipmentField.onChange(
                                        value === "__none__" ? null : value
                                      )
                                    }
                                    value={equipmentField.value ?? "__none__"}
                                    disabled={operationAssignments.length > 0}
                                  >
                                    <SelectTrigger className="h-8 text-[13px]">
                                      <SelectValue placeholder="설비 없음" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__" className="text-[13px]">
                                        설비 없음
                                      </SelectItem>
                                      {operationEquipments.map((equipment) => (
                                        <SelectItem
                                          key={equipment.id}
                                          value={equipment.id}
                                          className="text-[13px]"
                                        >
                                          [{equipment.code}] {equipment.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />
                          </div>
                        )}

                        {operationAssignments.length > 0 && (
                          <div className="divide-y">
                            {operationAssignments.map((assignment, assignmentIndex) => (
                              <div
                                key={`${field.id}-${assignmentIndex}`}
                                className="grid grid-cols-[1fr_120px_40px] items-start gap-2 px-3 py-2"
                              >
                                <FormField
                                  control={form.control}
                                  name={`operations.${index}.assignments.${assignmentIndex}.equipmentId`}
                                  render={({ field: assignmentField }) => (
                                    <FormItem>
                                      <Select
                                        onValueChange={assignmentField.onChange}
                                        value={assignmentField.value ?? undefined}
                                      >
                                        <SelectTrigger className="h-8 text-[13px]">
                                          <SelectValue placeholder="설비 선택" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {operationEquipments.map((equipment) => {
                                            const isDuplicate =
                                              selectedEquipmentIds.includes(equipment.id) &&
                                              assignmentField.value !== equipment.id
                                            return (
                                              <SelectItem
                                                key={equipment.id}
                                                value={equipment.id}
                                                disabled={isDuplicate}
                                                className="text-[13px]"
                                              >
                                                [{equipment.code}] {equipment.name}
                                              </SelectItem>
                                            )
                                          })}
                                        </SelectContent>
                                      </Select>
                                      <FormMessage className="text-[12px]" />
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={form.control}
                                  name={`operations.${index}.assignments.${assignmentIndex}.assignedQty`}
                                  render={({ field: assignmentField }) => (
                                    <FormItem>
                                      <Input
                                        type="number"
                                        min={0.000001}
                                        step={1}
                                        className="h-8 text-[13px] text-right"
                                        value={assignmentField.value ?? ""}
                                        onChange={(event) => {
                                          const value = event.target.value
                                          assignmentField.onChange(
                                            value === "" ? "" : parseFloat(value)
                                          )
                                        }}
                                      />
                                      <FormMessage className="text-[12px]" />
                                    </FormItem>
                                  )}
                                />

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => removeAssignment(index, assignmentIndex)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        {operationAssignments.length > 0 && !isBalanced && (
                          <div className="border-t px-3 py-2 text-[13px] text-amber-700">
                            {difference > 0
                              ? `배정수량이 ${formatQuantity(difference)} 부족합니다.`
                              : `배정수량이 ${formatQuantity(Math.abs(difference))} 초과되었습니다.`}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* operations 전체 에러 메시지 */}
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
