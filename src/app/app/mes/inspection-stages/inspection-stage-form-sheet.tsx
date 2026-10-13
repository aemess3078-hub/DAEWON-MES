"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet"
import {
  createStagedInspection,
  updateStagedInspection,
  type InspectionStageRow,
} from "@/lib/actions/inspection-stages.actions"

const createSchema = z.object({
  workOrderOperationId: z.string().min(1, "작업지시를 선택해주세요"),
  stage: z.enum(["FIRST", "MID", "FINAL"]),
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  inspectedQty: z.coerce.number().min(1, "검사수량을 입력해주세요"),
})

const editSchema = z.object({
  stage: z.enum(["FIRST", "MID", "FINAL"]),
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  inspectedQty: z.coerce.number().min(1, "검사수량을 입력해주세요"),
  inspectedAt: z.string().min(1, "검사일시를 입력해주세요"),
})

type CreateValues = z.infer<typeof createSchema>
type EditValues = z.infer<typeof editSchema>

interface CreateProps {
  mode: "create"
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrders: any[]
  onSuccess: () => void
}

interface EditProps {
  mode: "edit"
  open: boolean
  onOpenChange: (open: boolean) => void
  inspection: InspectionStageRow
  onSuccess: () => void
}

type Props = CreateProps | EditProps

export function InspectionStageFormSheet(props: Props) {
  const { open, onOpenChange, onSuccess } = props

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      workOrderOperationId: "",
      stage: "FIRST",
      result: "PASS",
      inspectedQty: 1,
    },
  })

  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues:
      props.mode === "edit"
        ? {
            stage: props.inspection.stage,
            result: props.inspection.result ?? "PASS",
            inspectedQty: props.inspection.inspectedQty,
            inspectedAt: new Date(props.inspection.inspectedAt)
              .toISOString()
              .slice(0, 16),
          }
        : { stage: "FIRST", result: "PASS", inspectedQty: 1, inspectedAt: "" },
  })

  useEffect(() => {
    if (!open) {
      createForm.reset()
      editForm.reset()
    } else if (props.mode === "edit") {
      editForm.reset({
        stage: props.inspection.stage,
        result: props.inspection.result ?? "PASS",
        inspectedQty: props.inspection.inspectedQty,
        inspectedAt: new Date(props.inspection.inspectedAt).toISOString().slice(0, 16),
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function onCreateSubmit(values: CreateValues) {
    if (props.mode !== "create") return
    const selectedOp = props.workOrders.find((wo) => wo.id === values.workOrderOperationId)
    if (!selectedOp?.inspectionSpecs?.[0]) {
      alert("선택한 공정에 활성화된 검사표준이 없습니다.")
      return
    }
    await createStagedInspection({
      workOrderOperationId: values.workOrderOperationId,
      inspectionSpecId: selectedOp.inspectionSpecs[0].id,
      stage: values.stage,
      result: values.result,
      inspectedQty: values.inspectedQty,
    })
    onOpenChange(false)
    onSuccess()
  }

  async function onEditSubmit(values: EditValues) {
    if (props.mode !== "edit") return
    await updateStagedInspection(props.inspection.id, {
      stage: values.stage,
      result: values.result,
      inspectedQty: values.inspectedQty,
      inspectedAt: new Date(values.inspectedAt),
    })
    onOpenChange(false)
    onSuccess()
  }

  if (props.mode === "edit") {
    return (
      <FormSheet
        open={open}
        onOpenChange={onOpenChange}
        mode="edit"
        title="검사 수정"
        onSubmit={editForm.handleSubmit(onEditSubmit)}
        isLoading={editForm.formState.isSubmitting}
      >
        <Form {...editForm}>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
              {props.inspection.workOrderOperation.workOrder.orderNo} /{" "}
              {props.inspection.workOrderOperation.routingOperation.name}
            </div>

            <FormField
              control={editForm.control}
              name="stage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>검사 단계 *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="FIRST">초물검사</SelectItem>
                      <SelectItem value="MID">중간검사</SelectItem>
                      <SelectItem value="FINAL">종물검사</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={editForm.control}
              name="inspectedQty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>검사 수량 *</FormLabel>
                  <FormControl>
                    <QuantityInput
                      maxDecimals={6}
                      allowNegative={false}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={editForm.control}
              name="result"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>판정 결과 *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="PASS">합격</SelectItem>
                      <SelectItem value="FAIL">불합격</SelectItem>
                      <SelectItem value="CONDITIONAL">조건부합격</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={editForm.control}
              name="inspectedAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>검사 일시 *</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Form>
      </FormSheet>
    )
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="검사 등록"
      onSubmit={createForm.handleSubmit(onCreateSubmit)}
      isLoading={createForm.formState.isSubmitting}
    >
      <Form {...createForm}>
        <div className="space-y-4">
          <FormField
            control={createForm.control}
            name="workOrderOperationId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>작업지시 공정 *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="공정 선택" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {props.workOrders.map((wo) => (
                      <SelectItem key={wo.id} value={wo.id}>
                        {wo.workOrder.orderNo} / {wo.routingOperation.name}
                        {wo.inspectionSpecs?.length === 0 && " (검사표준 없음)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={createForm.control}
            name="stage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>검사 단계 *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="FIRST">초물검사 (공정 시작 시)</SelectItem>
                    <SelectItem value="MID">중간검사 (공정 중 샘플링)</SelectItem>
                    <SelectItem value="FINAL">종물검사 (공정 완료 시)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={createForm.control}
            name="inspectedQty"
            render={({ field }) => (
              <FormItem>
                <FormLabel>검사 수량 *</FormLabel>
                <FormControl>
                  <QuantityInput
                    maxDecimals={6}
                    allowNegative={false}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={createForm.control}
            name="result"
            render={({ field }) => (
              <FormItem>
                <FormLabel>판정 결과 *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="PASS">합격</SelectItem>
                    <SelectItem value="FAIL">불합격</SelectItem>
                    <SelectItem value="CONDITIONAL">조건부합격</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </Form>
    </FormSheet>
  )
}
