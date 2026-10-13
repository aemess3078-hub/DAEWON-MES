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
import { defectCodeFormSchema, DefectCodeFormValues, DEFECT_CATEGORY_OPTIONS } from "./defect-form-schema"
import { createDefectCode, updateDefectCode, DefectCodeRow } from "@/lib/actions/quality.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

interface DefectFormSheetProps {
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: DefectCodeRow | null
}

const DEFAULT_VALUES: DefectCodeFormValues = {
  code: "",
  name: "",
  defectCategory: "DIMENSIONAL",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DefectFormSheet({
  tenantId,
  open,
  onOpenChange,
  editingRow,
}: DefectFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<DefectCodeFormValues>({
    resolver: zodResolver(defectCodeFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (open) {
      if (editingRow) {
        form.reset({
          code: editingRow.code,
          name: editingRow.name,
          defectCategory: editingRow.defectCategory,
        })
      } else {
        form.reset(DEFAULT_VALUES)
      }
    }
  }, [open, editingRow]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: DefectCodeFormValues) {
    setIsLoading(true)
    try {
      if (editingRow) {
        await updateDefectCode(editingRow.id, {
          name: values.name,
          defectCategory: values.defectCategory,
        })
      } else {
        await createDefectCode(
          {
            code: values.code,
            name: values.name,
            defectCategory: values.defectCategory,
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

  const isEdit = !!editingRow

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "불량코드 수정" : "불량코드 등록"}
      description={isEdit ? "불량코드 정보를 수정합니다." : "새로운 불량코드를 등록합니다."}
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-4">
          <FormTextField
            control={form.control}
            name="code"
            label="불량코드"
            placeholder="예: DC-001"
            disabled={isEdit}
          />
          <FormTextField
            control={form.control}
            name="name"
            label="불량명"
            placeholder="예: 치수 불량"
          />
          <FormSelectField
            control={form.control}
            name="defectCategory"
            label="불량유형"
            placeholder="불량유형 선택"
            options={DEFECT_CATEGORY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
          />
        </div>
      </Form>
    </FormSheet>
  )
}
