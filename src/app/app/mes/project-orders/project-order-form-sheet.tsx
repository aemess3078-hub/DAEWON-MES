"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"

import { Form, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { SearchableItemCombobox, type SearchableItemOption } from "@/components/common/searchable-item-combobox"
import { SearchableSalesOrderCombobox } from "./searchable-sales-order-combobox"
import { projectOrderFormSchema, ProjectOrderFormValues } from "./project-order-form-schema"
import { createProjectOrder, updateProjectOrder } from "@/lib/actions/project-order.actions"
import {
  PROJECT_ORDER_STATUS_TRANSITIONS,
  PROJECT_ORDER_CREATABLE_STATUSES,
} from "@/lib/project-order-status"
import { ProjectOrderStatus, ProjectOrderPriority } from "@prisma/client"
import type { ProjectOrderRow } from "./columns"

// ─── Types ────────────────────────────────────────────────────────────────────

type SiteOption = { id: string; code: string; name: string }
type CustomerOption = { id: string; code: string; name: string }
type ItemOption = SearchableItemOption
type UserOption = { id: string; name: string }
type SalesOrderOption = {
  id: string
  orderNo: string
  customerId: string
  customer: { id: string; code: string; name: string }
  siteId: string
  deliveryDate: Date | string
  items: ItemOption[]
}

interface ProjectOrderFormSheetProps {
  mode: "create" | "edit"
  projectOrder?: ProjectOrderRow | null
  sites: SiteOption[]
  customers: CustomerOption[]
  items: ItemOption[]
  users: UserOption[]
  salesOrders: SalesOrderOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { label: string; value: ProjectOrderStatus }[] = [
  { label: "초안", value: "DRAFT" },
  { label: "수주확정", value: "CONFIRMED" },
  { label: "진행중", value: "IN_PROGRESS" },
  { label: "보류", value: "ON_HOLD" },
  { label: "완료", value: "COMPLETED" },
  { label: "취소", value: "CANCELLED" },
]

const PRIORITY_OPTIONS: { label: string; value: ProjectOrderPriority }[] = [
  { label: "낮음", value: "LOW" },
  { label: "보통", value: "MEDIUM" },
  { label: "높음", value: "HIGH" },
]

const DEFAULT_VALUES: ProjectOrderFormValues = {
  name: "",
  siteId: "",
  customerId: "",
  ownerId: "",
  status: "DRAFT",
  priority: "MEDIUM",
  itemId: "",
  salesOrderId: "",
  plannedStartDate: "",
  dueDate: "",
  description: "",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectOrderFormSheet({
  mode,
  projectOrder,
  sites,
  customers,
  items,
  users,
  salesOrders,
  open,
  onOpenChange,
}: ProjectOrderFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<ProjectOrderFormValues>({
    resolver: zodResolver(projectOrderFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  // ─── 상태 Select 옵션 제한 (§4) ─────────────────────────────────────────────
  // 서버가 최종 검증하지만, 클라이언트에서도 애초에 갈 수 없는 상태는 보여주지 않는다.
  // create: DRAFT/CONFIRMED만. edit: 현재 상태에서 허용된 전이만(현재 상태 자체 포함).

  const allowedStatusValues =
    mode === "create"
      ? PROJECT_ORDER_CREATABLE_STATUSES
      : PROJECT_ORDER_STATUS_TRANSITIONS[projectOrder?.status ?? "DRAFT"]
  const statusOptions = STATUS_OPTIONS.filter((opt) => allowedStatusValues.includes(opt.value))

  // ─── 연결 수주 선택지 (§6/§10) ────────────────────────────────────────────────
  // 이제 수주를 선택하면 siteId가 그 수주의 siteId로 자동 동기화되므로(연결 중에는
  // 사업장 필드가 잠긴다), 더 이상 "현재 ProjectOrder.siteId와 같은 사업장의 수주만"
  // 으로 목록을 미리 좁힐 필요가 없다 — 어떤 수주를 골라도 사업장이 함께 따라온다.
  // 취소된 수주는 getProjectOrderSalesOrders가 이미 제외했다.

  const availableSalesOrders = salesOrders

  const selectedSalesOrderId = form.watch("salesOrderId")
  const selectedSalesOrder = availableSalesOrders.find((s) => s.id === selectedSalesOrderId)
  const isSalesOrderLinked = Boolean(selectedSalesOrder)
  const itemOptions = selectedSalesOrder ? selectedSalesOrder.items : items

  // ─── create 모드 초기화 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "create" && open) {
      form.reset(DEFAULT_VALUES)
    }
  }, [mode, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── edit 모드 초기화 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === "edit" && projectOrder && open) {
      form.reset({
        name: projectOrder.name,
        siteId: projectOrder.siteId,
        customerId: projectOrder.customer.id,
        ownerId: projectOrder.owner.id,
        status: projectOrder.status,
        priority: projectOrder.priority,
        itemId: projectOrder.item?.id ?? "",
        salesOrderId: projectOrder.salesOrder?.id ?? "",
        plannedStartDate: projectOrder.plannedStartDate
          ? new Date(projectOrder.plannedStartDate).toISOString().split("T")[0]
          : "",
        dueDate: projectOrder.dueDate
          ? new Date(projectOrder.dueDate).toISOString().split("T")[0]
          : "",
        description: projectOrder.description ?? "",
      })
    }
  }, [mode, projectOrder, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 연결 수주 선택 시 거래처/사업장 고정 + 납기일 제안 + 품목 목록 제한 (§7/§10/§12) ──
  // 거래처는 연결 중에는 임의 변경 불가하도록 수주 거래처로 고정한다(서버도 동일하게
  // 검증한다). 사업장도 마찬가지로 수주의 siteId로 자동 설정되고 필드가 잠긴다(§10).
  // 품목은 연결된 수주의 품목 목록으로 제한하므로, 기존 선택이 새 목록에 없으면
  // 초기화한다. 납기일은 비어 있을 때만 제안하고 이후에는 사용자가 자유롭게 조정할
  // 수 있다 — 자동 동기화가 아니라 최초 제안일 뿐이다. 연결 해제 시에는 거래처/
  // 사업장 필드를 다시 활성화하되 마지막 값은 그대로 유지한다(사용자가 이후 자유롭게
  // 바꿀 수 있다).

  function handleSalesOrderChange(salesOrderId: string) {
    form.setValue("salesOrderId", salesOrderId)

    if (!salesOrderId) return
    const so = availableSalesOrders.find((s) => s.id === salesOrderId)
    if (!so) return

    form.setValue("customerId", so.customerId)
    form.setValue("siteId", so.siteId)
    if (!form.getValues("dueDate")) {
      form.setValue("dueDate", new Date(so.deliveryDate).toISOString().split("T")[0])
    }
    const currentItemId = form.getValues("itemId")
    if (currentItemId && !so.items.some((i) => i.id === currentItemId)) {
      form.setValue("itemId", "")
    }
  }

  // ─── 저장 핸들러 ────────────────────────────────────────────────────────────

  async function onSubmit(values: ProjectOrderFormValues) {
    setIsLoading(true)
    try {
      const payload = {
        name: values.name,
        siteId: values.siteId,
        customerId: values.customerId,
        ownerId: values.ownerId,
        status: values.status,
        priority: values.priority,
        itemId: values.itemId || null,
        salesOrderId: values.salesOrderId || null,
        plannedStartDate: values.plannedStartDate ? new Date(values.plannedStartDate) : null,
        dueDate: values.dueDate ? new Date(values.dueDate) : null,
        description: values.description || null,
      }

      const result =
        mode === "create"
          ? await createProjectOrder(payload)
          : await updateProjectOrder({ id: projectOrder!.id, ...payload })

      if (!result.ok) {
        alert(result.error ?? "저장 중 오류가 발생했습니다.")
        return
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
      title={mode === "create" ? "프로젝트 오더 등록" : "프로젝트 오더 수정"}
      description={
        mode === "create"
          ? "새로운 프로젝트 오더를 등록합니다. 오더번호는 자동으로 채번됩니다."
          : "프로젝트 오더 정보를 수정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-4">
          {/* 프로젝트명 */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>프로젝트명</FormLabel>
                <Input placeholder="프로젝트명을 입력하세요" {...field} />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 사업장 (§9/§10) — 연결 수주가 있으면 그 수주의 사업장으로 고정된다 */}
          <FormField
            control={form.control}
            name="siteId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>사업장</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value || undefined}
                  disabled={isSalesOrderLinked}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="사업장 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        [{s.code}] {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSalesOrderLinked && (
                  <p className="text-[12px] text-muted-foreground">
                    연결된 수주의 사업장으로 고정됩니다. 변경하려면 연결 수주를 먼저 해제하세요.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 거래처 */}
          <FormField
            control={form.control}
            name="customerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>거래처</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value || undefined}
                  disabled={isSalesOrderLinked}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="거래처 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        [{c.code}] {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSalesOrderLinked && (
                  <p className="text-[12px] text-muted-foreground">
                    연결된 수주의 거래처로 고정됩니다. 변경하려면 연결 수주를 먼저 해제하세요.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            {/* 담당자 */}
            <FormField
              control={form.control}
              name="ownerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>담당자</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <SelectTrigger>
                      <SelectValue placeholder="담당자 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 우선순위 */}
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>우선순위</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => (
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
          </div>

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
                    {statusOptions.map((opt) => (
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

          {/* 연결 수주 (§5/§17: 검색 가능한 Combobox) */}
          <FormField
            control={form.control}
            name="salesOrderId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>연결 수주 (선택)</FormLabel>
                <SearchableSalesOrderCombobox
                  salesOrders={availableSalesOrders}
                  value={field.value || ""}
                  onSelect={handleSalesOrderChange}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* 품목/모델 (§6/§17: 검색 가능한 Combobox, 완제품/반제품만) */}
          <FormField
            control={form.control}
            name="itemId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>품목/모델 (선택)</FormLabel>
                <SearchableItemCombobox
                  items={itemOptions}
                  value={field.value || ""}
                  onSelect={(itemId) => field.onChange(itemId)}
                  allowClear
                  placeholder="품목 선택"
                  searchPlaceholder="품목코드 또는 품목명 검색"
                />
                {isSalesOrderLinked && (
                  <p className="text-[12px] text-muted-foreground">
                    연결된 수주에 포함된 완제품/반제품만 선택할 수 있습니다.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            {/* 시작 예정일 */}
            <FormField
              control={form.control}
              name="plannedStartDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>시작 예정일 (선택)</FormLabel>
                  <Input type="date" {...field} value={field.value ?? ""} />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 납기 예정일 */}
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>납기 예정일 (선택)</FormLabel>
                  <Input type="date" {...field} value={field.value ?? ""} />
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* 설명/비고 */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>설명/비고 (선택)</FormLabel>
                <Textarea
                  placeholder="설명 또는 비고 사항을 입력하세요"
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
