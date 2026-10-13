"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"

import { Form } from "@/components/ui/form"
import {
  FormSheet,
  FormTextField,
  FormSelectField,
} from "@/components/common/form-sheet"
import {
  inspectionSpecFormSchema,
  InspectionSpecFormValues,
  INSPECTION_STATUS_OPTIONS,
} from "./measurement-form-schema"
import {
  createInspectionSpec,
  updateInspectionSpec,
  InspectionSpecWithItems,
} from "@/lib/actions/quality.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecFormSheetProps {
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

const DEFAULT_VALUES: InspectionSpecFormValues = {
  itemId: "",
  routingOperationId: "",
  version: "v1.0",
  status: "DRAFT",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SpecFormSheet({
  tenantId,
  open,
  onOpenChange,
  editingSpec,
  items,
  routingOperations,
}: SpecFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<InspectionSpecFormValues>({
    resolver: zodResolver(inspectionSpecFormSchema),
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
      } else {
        form.reset(DEFAULT_VALUES)
      }
    }
  }, [open, editingSpec]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: InspectionSpecFormValues) {
    setIsLoading(true)
    try {
      if (editingSpec) {
        await updateInspectionSpec(editingSpec.id, {
          version: values.version,
          status: values.status,
        })
      } else {
        await createInspectionSpec(
          {
            itemId: values.itemId,
            routingOperationId: values.routingOperationId,
            version: values.version,
            status: values.status,
          },
          tenantId
        )
      }
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  const isEdit = !!editingSpec

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "검사기준 수정" : "검사기준 등록"}
      description="품목·공정별 검사기준(InspectionSpec)을 등록합니다."
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
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
            options={INSPECTION_STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
        </div>
      </Form>
    </FormSheet>
  )
}
