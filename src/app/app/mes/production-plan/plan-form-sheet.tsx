"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Info, Lock, Plus, ShoppingCart, Trash2 } from "lucide-react"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FormSheet,
  FormTextField,
  FormSelectField,
} from "@/components/common/form-sheet"
import { SearchableItemCombobox } from "@/components/common/searchable-item-combobox"
import { planFormSchema, PlanFormValues } from "./plan-form-schema"
import { PlanKindBadge, ApprovalText } from "./plan-badges"
import {
  createPlan,
  updatePlan,
  generatePlanNo,
  getBomsForPlanItem,
  getRoutingsForPlanItem,
  PlanWithDetails,
} from "@/lib/actions/production-plan.actions"
import { PlanType, PlanStatus } from "@prisma/client"
import type { PlanQuantityView } from "@/lib/production-quantity-model"
import {
  AUTO_STATUS_GUIDE,
  PLAN_STATUS_LABEL,
  isPlanEditable,
  selectablePlanStatuses,
  type PlanStatusValue,
} from "@/lib/production-plan-status"
import {
  APPROVAL_POLICY_NOTICE_KO,
  ORDER_PLAN_REGISTRATION_GUIDE,
  PRODUCTION_KIND_LABEL_KO,
  diffQty,
  evaluateLinkedRow,
  sumQty,
} from "@/lib/production-plan-form"
import { formatQuantity } from "@/lib/utils"
import { stripProductionRequestTag } from "@/lib/production-request-tag"

// ─── Types ────────────────────────────────────────────────────────────────────

type BomOption = { id: string; version: string; isDefault: boolean }
type RoutingOption = {
  id: string
  code: string
  name: string
  version: string
  isDefault: boolean
  scope: "COMMON" | "ITEM_SPECIFIC"
}

// 자동선택 규칙: 이미 선택된 routingId가 새 후보 목록에 있으면 유지 → 품목전용 기본 라우팅이
// 정확히 1개면 그것 → 그 외 선택 가능 라우팅이 정확히 1개면 그것 → 그 외에는 사용자가 직접 선택.
// 범용 라우팅은 후보가 여러 개일 수 있으므로 절대 자동 기본값으로 지정하지 않는다.
function resolveAutoSelectedRoutingId(
  routings: RoutingOption[],
  currentRoutingId: string | null
): string | null {
  if (currentRoutingId && routings.some((r) => r.id === currentRoutingId)) {
    return currentRoutingId
  }
  const defaultItemSpecific = routings.filter((r) => r.scope === "ITEM_SPECIFIC" && r.isDefault)
  if (defaultItemSpecific.length === 1) return defaultItemSpecific[0].id
  if (routings.length === 1) return routings[0].id
  return null
}

interface PlanFormSheetProps {
  mode: "create" | "edit"
  plan?: PlanWithDetails | null
  sites: { id: string; code: string; name: string; type: string }[]
  items: { id: string; code: string; name: string; itemType: string }[]
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 2-A 조회 모델(수정 중인 계획의 줄별 수주 맥락). 없으면 서버 검증에만 의존한다 */
  quantities?: PlanQuantityView | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const planTypeOptions = [
  { label: "일간", value: PlanType.DAILY },
  { label: "주간", value: PlanType.WEEKLY },
  { label: "월간", value: PlanType.MONTHLY },
]

const DEFAULT_ITEM = {
  productionPlanItemId: null,
  salesOrderItemId: null,
  itemId: "",
  bomId: null,
  routingId: null,
  plannedQty: 1,
  allocatedQty: null,
  extraQty: null,
  extraReason: "",
  note: "",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlanFormSheet({
  mode,
  plan,
  sites,
  items,
  tenantId,
  open,
  onOpenChange,
  quantities = null,
}: PlanFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [showRowErrors, setShowRowErrors] = useState(false)
  const [rowBoms, setRowBoms] = useState<Record<number, BomOption[]>>({})
  const [rowRoutings, setRowRoutings] = useState<Record<number, RoutingOption[]>>({})
  const router = useRouter()

  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: {
      siteId: "",
      planNo: "",
      planType: PlanType.WEEKLY,
      startDate: "",
      endDate: "",
      status: PlanStatus.DRAFT,
      note: "",
      items: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  })
  const watchedItems = useWatch({ control: form.control, name: "items" }) ?? []

  const lineByItemId = useMemo(() => {
    const m = new Map<string, NonNullable<PlanQuantityView["lines"]>[number]>()
    for (const l of quantities?.lines ?? []) m.set(l.planItemId, l)
    return m
  }, [quantities])

  const currentStatus = (mode === "edit" && plan ? plan.status : null) as PlanStatusValue | null
  const statusOptions = selectablePlanStatuses(currentStatus).map((s) => ({ label: PLAN_STATUS_LABEL[s], value: s as PlanStatus }))
  const locked = mode === "edit" && plan ? !isPlanEditable(plan.status as PlanStatusValue) : false

  // ─── create 모드 초기화 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "create" && open) {
      setServerError(null)
      setShowRowErrors(false)
      generatePlanNo(tenantId, PlanType.WEEKLY).then((no) => {
        form.reset({
          siteId: "",
          planNo: no,
          planType: PlanType.WEEKLY,
          startDate: "",
          endDate: "",
          status: PlanStatus.DRAFT,
          note: "",
          items: [],
        })
      })
      setRowBoms({})
      setRowRoutings({})
    }
  }, [mode, open, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── edit 모드 초기화 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "edit" && plan && open) {
      setServerError(null)
      setShowRowErrors(false)
      form.reset({
        siteId: plan.siteId,
        planNo: plan.planNo,
        planType: plan.planType,
        startDate: new Date(plan.startDate).toISOString().split("T")[0],
        endDate: new Date(plan.endDate).toISOString().split("T")[0],
        status: plan.status,
        note: stripProductionRequestTag(plan.note),
        items: plan.items.map((item) => {
          const linked = item.salesOrderItemId != null
          return {
            productionPlanItemId: item.id,
            salesOrderItemId: item.salesOrderItemId,
            itemId: item.itemId,
            bomId: item.bomId ?? null,
            routingId: item.routingId ?? null,
            plannedQty: Number(item.plannedQty),
            allocatedQty: linked ? Number(item.allocatedQty) : null,
            extraQty: linked ? (lineByItemId.get(item.id)?.extraQty ?? diffQty(item.plannedQty, item.allocatedQty)) : null,
            extraReason: item.extraReason ?? "",
            note: item.note ?? "",
          }
        }),
      })

      // 각 행의 BOM/라우팅 로딩 — 기존 routingId가 새 후보 목록에서 여전히 유효하면 유지, 아니면 자동선택 규칙 적용
      plan.items.forEach(async (item, index) => {
        const [boms, routings] = await Promise.all([
          getBomsForPlanItem(item.itemId),
          getRoutingsForPlanItem(item.itemId) as Promise<RoutingOption[]>,
        ])
        setRowBoms((prev) => ({ ...prev, [index]: boms }))
        setRowRoutings((prev) => ({ ...prev, [index]: routings }))
        const resolved = resolveAutoSelectedRoutingId(routings, item.routingId ?? null)
        if (resolved !== (item.routingId ?? null)) {
          form.setValue(`items.${index}.routingId`, resolved)
        }
      })
    }
  }, [mode, plan, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 계획유형 변경 시 planNo 자동 갱신 ──────────────────────────────────────

  const handlePlanTypeChange = async (planType: PlanType) => {
    form.setValue("planType", planType)
    if (mode === "create") {
      const newNo = await generatePlanNo(tenantId, planType)
      form.setValue("planNo", newNo)
    }
  }

  // ─── 행별 품목 변경 핸들러 ───────────────────────────────────────────────────

  const handleItemChangeForRow = async (index: number, itemId: string) => {
    form.setValue(`items.${index}.itemId`, itemId)
    form.setValue(`items.${index}.bomId`, null)
    form.setValue(`items.${index}.routingId`, null)

    if (!itemId) {
      setRowBoms((prev) => ({ ...prev, [index]: [] }))
      setRowRoutings((prev) => ({ ...prev, [index]: [] }))
      return
    }

    const [boms, routings] = await Promise.all([
      getBomsForPlanItem(itemId),
      getRoutingsForPlanItem(itemId) as Promise<RoutingOption[]>,
    ])
    setRowBoms((prev) => ({ ...prev, [index]: boms }))
    setRowRoutings((prev) => ({ ...prev, [index]: routings }))
    // 품목이 방금 바뀌었으므로 이전 routingId는 무의미 — 자동선택 규칙(2·3번)만 적용
    form.setValue(`items.${index}.routingId`, resolveAutoSelectedRoutingId(routings, null))
  }

  // ─── 수주 연결 줄: 충당·여유 입력 → 실제 계획 수량 ───────────────────────────

  const setLinkedQty = (index: number, field: "allocatedQty" | "extraQty", value: number | undefined) => {
    form.setValue(`items.${index}.${field}`, value ?? 0, { shouldDirty: true })
    const row = form.getValues(`items.${index}`)
    const planned = sumQty(field === "allocatedQty" ? (value ?? 0) : row.allocatedQty, field === "extraQty" ? (value ?? 0) : row.extraQty)
    form.setValue(`items.${index}.plannedQty`, Number.isNaN(planned) ? 0 : planned, { shouldDirty: true })
    setServerError(null)
  }

  /** 수주 연결 줄별 입력 검증(서버 N-19 규칙의 미리보기). 최대 충당 = 수주 수량 − 다른 계획 줄의 충당(서버 조회 모델 값) */
  const rowEvaluations = watchedItems.map((row, index) => {
    if (!row?.salesOrderItemId) return null
    const line = row.productionPlanItemId ? lineByItemId.get(row.productionPlanItemId) : undefined
    const max = line?.order ? Number((line.order.orderedQty - line.order.allocatedByOtherLinesQty).toFixed(6)) : null
    return evaluateLinkedRow({ allocatedQty: row.allocatedQty, extraQty: row.extraQty, extraReason: row.extraReason, maxAllocatable: max })
  })
  const hasRowErrors = rowEvaluations.some((e) => e && Object.keys(e.errors).length > 0)

  // ─── 저장 핸들러 ────────────────────────────────────────────────────────────

  async function onSubmit(values: PlanFormValues) {
    if (hasRowErrors) {
      setShowRowErrors(true)
      return
    }
    setIsLoading(true)
    setServerError(null)
    try {
      const payload = {
        ...values,
        items: values.items.map((it) =>
          it.salesOrderItemId
            ? {
                ...it,
                plannedQty: sumQty(it.allocatedQty, it.extraQty),
                allocatedQty: it.allocatedQty ?? 0,
                extraReason: (it.extraQty ?? 0) > 0 ? (it.extraReason ?? "").trim() : null,
                extraQty: undefined,
              }
            : { ...it, allocatedQty: undefined, extraQty: undefined, extraReason: undefined }
        ),
      }
      if (mode === "create") {
        await createPlan(payload as never, tenantId)
      } else if (plan) {
        await updatePlan(plan.id, payload as never)
      }
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("저장 실패:", error)
      setServerError(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
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
      title={mode === "create" ? "생산계획 등록" : "생산계획 수정"}
      description={
        mode === "create"
          ? "재고 생산 계획을 등록합니다."
          : "수주 충당 수량·여유 생산 수량·여유 사유를 구분해 수정합니다."
      }
      isLoading={isLoading}
      submitDisabled={locked}
      onSubmit={form.handleSubmit(onSubmit)}
      contentClassName="sm:max-w-3xl"
    >
      <Form {...form}>
        <fieldset disabled={locked} className="min-w-0 space-y-6">
          {locked && (
            <div className="flex items-start gap-1.5 rounded-md bg-muted px-3 py-2 text-[14px] text-muted-foreground" data-testid="pf-locked">
              <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{plan ? `'${PLAN_STATUS_LABEL[plan.status as PlanStatusValue]}' 상태의 생산계획은 수정할 수 없습니다. ${AUTO_STATUS_GUIDE}` : ""}</span>
            </div>
          )}

          {mode === "create" && (
            <div className="space-y-3" data-testid="pf-kind-guide">
              <p className="text-[15px] font-medium text-foreground">생산 유형</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-md border-2 border-primary bg-primary/5 px-3 py-2" data-testid="pf-kind-stock">
                  <div className="text-[14px] font-medium">재고 생산 (선택됨)</div>
                  <div className="text-[13px] text-muted-foreground">수주 연결 없음 · 충당 0 · 계획 수량 직접 입력</div>
                </div>
                <div className="rounded-md border border-dashed px-3 py-2 opacity-70" data-testid="pf-kind-order">
                  <div className="text-[14px] font-medium">{PRODUCTION_KIND_LABEL_KO.ORDER}</div>
                  <div className="text-[13px] text-muted-foreground">수주 처리 화면의 생산의뢰에서 등록</div>
                </div>
                <div className="rounded-md border border-dashed px-3 py-2 opacity-70" data-testid="pf-kind-extra">
                  <div className="text-[14px] font-medium">{PRODUCTION_KIND_LABEL_KO.ORDER_EXTRA}</div>
                  <div className="text-[13px] text-muted-foreground">충당 + 여유 + 사유, 수주 처리 화면에서 등록</div>
                </div>
              </div>
              <div className="flex items-start gap-1.5 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-[13px] text-blue-800">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {ORDER_PLAN_REGISTRATION_GUIDE}{" "}
                  <Link href="/app/mes/sales-orders" className="underline font-medium">수주 처리 화면으로 이동</Link>
                </span>
              </div>
            </div>
          )}

          {/* 헤더 정보 */}
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">기본 정보</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 계획번호 */}
              <FormTextField
                control={form.control}
                name="planNo"
                label="계획번호"
                placeholder="PP-2026-W13"
              />

              {/* 공장 */}
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

              {/* 계획유형 */}
              <FormField
                control={form.control}
                name="planType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>계획유형</FormLabel>
                    <Select
                      onValueChange={(val) => handlePlanTypeChange(val as PlanType)}
                      value={field.value ?? undefined}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="계획유형 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {planTypeOptions.map((opt) => (
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

              {/* 상태: 직접 고를 수 있는 값은 초안·확정뿐 (진행중·완료는 작업지시·POP 실적이 바꾼다) */}
              <div className="space-y-1" data-testid="pf-status">
                <FormSelectField
                  control={form.control}
                  name="status"
                  label="상태"
                  options={statusOptions}
                />
                <p className="text-[13px] text-muted-foreground" data-testid="pf-status-guide">{AUTO_STATUS_GUIDE}</p>
              </div>

              {/* 시작일 */}
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>시작일</FormLabel>
                    <Input
                      type="date"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 종료일 */}
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>종료일</FormLabel>
                    <Input
                      type="date"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                    />
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
                  <FormLabel>비고 · 생산 목적</FormLabel>
                  <Textarea
                    placeholder="비고 또는 생산 목적 입력 (예: 안전재고 확보)"
                    rows={2}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* 품목 목록 */}
          <div className="pt-4 border-t space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[15px] font-medium text-foreground">품목 목록</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ ...DEFAULT_ITEM })}
                data-testid="pf-add-item"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {mode === "create" ? "품목 추가" : "재고 생산 품목 추가"}
              </Button>
            </div>

            {fields.map((field, index) => {
              const row = watchedItems[index]
              const currentItemId = row?.itemId ?? ""
              const linked = Boolean(row?.salesOrderItemId)
              const savedLine = row?.productionPlanItemId ? lineByItemId.get(row.productionPlanItemId) : undefined
              const savedItem = plan?.items.find((p) => p.id === row?.productionPlanItemId)
              const effectiveWos = (savedItem?.workOrders ?? []).filter((w) => w.status !== "CANCELLED")
              const rowLocked = effectiveWos.length > 0
              const ev = rowEvaluations[index]
              const errs = ev?.errors ?? {}
              const selectedInOtherRows = new Set(
                watchedItems
                  .filter((_, rowIndex) => rowIndex !== index)
                  .map((item) => item?.itemId)
                  .filter((itemId): itemId is string => Boolean(itemId))
              )
              const bomsForRow = rowBoms[index] ?? []
              const routingsForRow = rowRoutings[index] ?? []
              const so = savedItem?.salesOrderItem?.salesOrder
              const kind = linked ? (ev?.kind ?? "ORDER") : "STOCK"
              const approvalStatus = savedLine?.approval.status ?? savedItem?.extraApprovalStatus ?? "NOT_REQUIRED"

              return (
                <div key={field.id} className="rounded-lg border p-3 space-y-3" data-testid={`pf-item-${index}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlanKindBadge kind={kind} testId={`pf-kind-${index}`} />
                      {linked && so && (
                        <span className="inline-flex items-center gap-1 text-[13px] text-blue-700" data-testid={`pf-order-${index}`}>
                          <ShoppingCart className="h-3.5 w-3.5" />
                          <span className="font-mono">{so.orderNo}</span>
                          <span className="text-muted-foreground">{so.customer.name}</span>
                        </span>
                      )}
                      {!linked && <span className="text-[13px] text-muted-foreground">수주 연결 없음 · 충당 0</span>}
                    </div>
                    {/* 수주 연결 줄과 작업지시가 있는 줄은 삭제할 수 없다(서버도 같은 규칙) */}
                    {!linked && !rowLocked && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(index)}
                        aria-label="품목 삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* 품목 */}
                    <div className="space-y-1 sm:col-span-3">
                      <span className="text-[13px] text-muted-foreground">품목</span>
                      <FormField
                        control={form.control}
                        name={`items.${index}.itemId`}
                        render={({ field: f }) => (
                          <FormItem>
                            <SearchableItemCombobox
                              items={items}
                              value={f.value ?? ""}
                              disabled={linked}
                              disabledItemIds={selectedInOtherRows}
                              onSelect={(itemId) => handleItemChangeForRow(index, itemId)}
                              triggerClassName="h-9 w-full min-w-0 px-2 text-[14px]"
                            />
                            <FormMessage className="text-[13px]" />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* BOM */}
                    <div className="space-y-1">
                      <span className="text-[13px] text-muted-foreground">BOM</span>
                      <FormField
                        control={form.control}
                        name={`items.${index}.bomId`}
                        render={({ field: f }) => (
                          <FormItem>
                            <Select
                              onValueChange={(val) => f.onChange(val === "__none__" ? null : val)}
                              value={f.value ?? "__none__"}
                              disabled={!currentItemId}
                            >
                              <SelectTrigger className="h-9 text-[14px]">
                                <SelectValue placeholder="BOM 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-[14px]">선택 안함</SelectItem>
                                {bomsForRow.map((bom) => (
                                  <SelectItem key={bom.id} value={bom.id} className="text-[14px]">
                                    {bom.version}
                                    {bom.isDefault ? " (기본)" : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-[13px]" />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* 라우팅 — 추천(품목전용 기본) / 품목전용 / 범용 3그룹으로 표시 */}
                    <div className="space-y-1 sm:col-span-2">
                      <span className="text-[13px] text-muted-foreground">라우팅</span>
                      <FormField
                        control={form.control}
                        name={`items.${index}.routingId`}
                        render={({ field: f }) => {
                          const recommended = routingsForRow.filter((r) => r.scope === "ITEM_SPECIFIC" && r.isDefault)
                          const itemSpecific = routingsForRow.filter((r) => r.scope === "ITEM_SPECIFIC" && !r.isDefault)
                          const common = routingsForRow.filter((r) => r.scope === "COMMON")
                          return (
                            <FormItem>
                              <Select
                                onValueChange={(val) => f.onChange(val === "__none__" ? null : val)}
                                value={f.value ?? "__none__"}
                                disabled={!currentItemId}
                              >
                                <SelectTrigger className="h-9 text-[14px]">
                                  <SelectValue placeholder="라우팅 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__" className="text-[14px]">선택 안함</SelectItem>
                                  {recommended.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-[13px]">추천 라우팅</SelectLabel>
                                      {recommended.map((routing) => (
                                        <SelectItem key={routing.id} value={routing.id} className="text-[14px]">
                                          [{routing.code}] {routing.name} v{routing.version} (기본)
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                  {itemSpecific.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-[13px]">품목 전용 라우팅</SelectLabel>
                                      {itemSpecific.map((routing) => (
                                        <SelectItem key={routing.id} value={routing.id} className="text-[14px]">
                                          [{routing.code}] {routing.name} v{routing.version}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                  {common.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-[13px]">범용 라우팅</SelectLabel>
                                      {common.map((routing) => (
                                        <SelectItem key={routing.id} value={routing.id} className="text-[14px]">
                                          [{routing.code}] {routing.name} v{routing.version}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  )}
                                </SelectContent>
                              </Select>
                              <FormMessage className="text-[13px]" />
                            </FormItem>
                          )
                        }}
                      />
                    </div>
                  </div>

                  {/* 수량 */}
                  {linked ? (
                    <div className="rounded-md bg-muted/40 p-3 space-y-3">
                      {savedLine?.order && (
                        <div className="text-[13px] text-muted-foreground" data-testid={`pf-order-qty-${index}`}>
                          수주 수량 {formatQuantity(savedLine.order.orderedQty)} · 다른 계획이 충당 {formatQuantity(savedLine.order.allocatedByOtherLinesQty)} ·{" "}
                          <span className="font-medium text-foreground" data-testid={`pf-max-${index}`}>
                            이 줄에 충당 가능한 최대 {formatQuantity(Number((savedLine.order.orderedQty - savedLine.order.allocatedByOtherLinesQty).toFixed(6)))}
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="space-y-1 block">
                          <span className="text-[13px] text-muted-foreground">수주 충당 수량</span>
                          <QuantityInput
                            maxDecimals={6}
                            allowNegative={false}
                            className="h-9 text-[14px] text-right"
                            value={row?.allocatedQty ?? undefined}
                            onChange={(v) => setLinkedQty(index, "allocatedQty", v)}
                            disabled={rowLocked}
                            data-testid={`pf-alloc-${index}`}
                            aria-invalid={!!errs.alloc}
                          />
                        </label>
                        <label className="space-y-1 block">
                          <span className="text-[13px] text-muted-foreground">여유 생산 수량</span>
                          <QuantityInput
                            maxDecimals={6}
                            allowNegative={false}
                            className="h-9 text-[14px] text-right"
                            value={row?.extraQty ?? undefined}
                            onChange={(v) => setLinkedQty(index, "extraQty", v)}
                            disabled={rowLocked}
                            data-testid={`pf-extra-${index}`}
                            aria-invalid={!!errs.extra}
                          />
                        </label>
                        <div className="space-y-1">
                          <span className="text-[13px] text-muted-foreground">실제 계획 수량 (충당 + 여유)</span>
                          <div className="h-9 flex items-center justify-end text-[15px] font-semibold tabular-nums" data-testid={`pf-planned-${index}`}>
                            {Number.isNaN(ev?.plannedQty ?? Number.NaN) ? "—" : formatQuantity(ev!.plannedQty)}
                          </div>
                        </div>
                      </div>
                      {(row?.extraQty ?? 0) > 0 && (
                        <label className="block space-y-1">
                          <span className="text-[13px] text-muted-foreground">여유 생산 사유 (필수)</span>
                          <Input
                            className="h-9 text-[14px]"
                            value={row?.extraReason ?? ""}
                            maxLength={500}
                            placeholder="예: 가공 불량 대비"
                            disabled={rowLocked}
                            onChange={(e) => {
                              form.setValue(`items.${index}.extraReason`, e.target.value, { shouldDirty: true })
                              setServerError(null)
                            }}
                            data-testid={`pf-reason-${index}`}
                            aria-invalid={!!errs.reason}
                          />
                        </label>
                      )}
                      {showRowErrors && (errs.alloc || errs.extra || errs.reason) && (
                        <ul className="text-[13px] text-red-600 space-y-0.5" data-testid={`pf-errors-${index}`}>
                          {[errs.alloc, errs.extra, errs.reason].filter(Boolean).map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      )}
                      {(row?.extraQty ?? 0) > 0 || approvalStatus !== "NOT_REQUIRED" ? (
                        <div className="text-[13px]" data-testid={`pf-approval-${index}`}>
                          여유 승인 상태: <ApprovalText status={approvalStatus} />
                        </div>
                      ) : null}
                      {rowLocked && (
                        <div className="flex items-start gap-1.5 text-[13px] text-muted-foreground" data-testid={`pf-lock-${index}`}>
                          <Lock className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          작업지시({effectiveWos.map((w) => w.orderNo).join(", ")})가 있어 생산 유형과 수주 충당 수량은 변경할 수 없습니다.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <FormField
                        control={form.control}
                        name={`items.${index}.plannedQty`}
                        render={({ field: f }) => (
                          <FormItem>
                            <span className="text-[13px] text-muted-foreground">재고 생산 계획 수량</span>
                            <QuantityInput
                              maxDecimals={6}
                              allowNegative={false}
                              className="h-9 text-[14px] text-right"
                              value={f.value}
                              onChange={f.onChange}
                              data-testid={`pf-planned-input-${index}`}
                            />
                            <FormMessage className="text-[13px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.note`}
                        render={({ field: f }) => (
                          <FormItem className="sm:col-span-2">
                            <span className="text-[13px] text-muted-foreground">비고 · 생산 목적</span>
                            <Input
                              className="h-9 text-[14px]"
                              placeholder="예: 안전재고 확보"
                              value={f.value ?? ""}
                              onChange={f.onChange}
                              data-testid={`pf-note-${index}`}
                            />
                            <FormMessage className="text-[13px]" />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                  {linked && (
                    <FormField
                      control={form.control}
                      name={`items.${index}.note`}
                      render={({ field: f }) => (
                        <FormItem>
                          <span className="text-[13px] text-muted-foreground">비고</span>
                          <Input className="h-9 text-[14px]" placeholder="비고" value={f.value ?? ""} onChange={f.onChange} />
                          <FormMessage className="text-[13px]" />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )
            })}

            {fields.length === 0 && (
              <div className="rounded-md border border-dashed py-8 text-center text-[14px] text-muted-foreground">
                {mode === "create" ? "품목 추가 버튼을 눌러 재고 생산 품목을 추가하세요." : "품목 추가 버튼을 눌러 계획 품목을 추가하세요."}
              </div>
            )}

            {/* 품목 배열 자체의 오류(예: 최소 1개 필요)만 표시한다.
                행 단위 오류 객체를 FormMessage에 넘기면 "undefined"가 렌더링될 수 있다. */}
            {typeof form.formState.errors.items?.message === "string" && (
              <p className="text-[13px] font-medium text-destructive">
                {form.formState.errors.items.message}
              </p>
            )}

            {watchedItems.some((r) => r?.salesOrderItemId) && (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] text-amber-800" data-testid="pf-approval-notice">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                {APPROVAL_POLICY_NOTICE_KO}
              </div>
            )}
          </div>

          {serverError && (
            <div role="alert" className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[14px] text-red-700" data-testid="pf-server-error">
              {serverError}
            </div>
          )}
        </fieldset>
      </Form>
    </FormSheet>
  )
}
