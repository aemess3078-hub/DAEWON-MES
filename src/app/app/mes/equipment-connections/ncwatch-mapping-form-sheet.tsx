"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"

import { Form } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import {
  FormSelectField,
  FormSheet,
  FormSwitchField,
  FormTextareaField,
} from "@/components/common/form-sheet"
import {
  NO_EQUIPMENT_VALUE,
  ncwatchMappingFormSchema,
  type NcwatchMappingFormValues,
} from "./ncwatch-mapping-form-schema"
import {
  type NcwatchMappingRow,
  upsertNcwatchMapping,
} from "@/lib/actions/equipment-integration.actions"

type EquipmentOption = {
  id: string
  code: string
  name: string
  workCenter: { name: string }
}

interface NcwatchMappingFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: NcwatchMappingRow | null
  equipments: EquipmentOption[]
  machineNames: string[]
}

const DEFAULT_VALUES: NcwatchMappingFormValues = {
  machineName: "",
  equipmentId: NO_EQUIPMENT_VALUE,
  isActive: true,
  memo: "",
}

export function NcwatchMappingFormSheet({
  open,
  onOpenChange,
  editingRow,
  equipments,
  machineNames,
}: NcwatchMappingFormSheetProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const datalistId = useMemo(
    () => `ncwatch-machine-names-${editingRow?.id ?? "new"}`,
    [editingRow?.id]
  )

  const form = useForm<NcwatchMappingFormValues>({
    resolver: zodResolver(ncwatchMappingFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!open) return
    if (editingRow) {
      form.reset({
        machineName: editingRow.machineName,
        equipmentId: editingRow.equipmentId ?? NO_EQUIPMENT_VALUE,
        isActive: editingRow.isActive,
        memo: editingRow.memo ?? "",
      })
    } else {
      form.reset(DEFAULT_VALUES)
    }
  }, [open, editingRow, form])

  async function onSubmit(values: NcwatchMappingFormValues) {
    setIsLoading(true)
    try {
      await upsertNcwatchMapping({
        id: editingRow?.id,
        machineName: values.machineName,
        equipmentId:
          values.equipmentId && values.equipmentId !== NO_EQUIPMENT_VALUE
            ? values.equipmentId
            : null,
        isActive: values.isActive,
        memo: values.memo,
      })
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "NCWatch 매핑 저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  const isEdit = Boolean(editingRow?.id)

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "NCWatch 매핑 수정" : "NCWatch 매핑 등록"}
      description="NCWatch Agent의 수집 기계명을 MES 설비 ID에 연결합니다."
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="machineName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>수집 기계명</FormLabel>
                <FormControl>
                  <Input
                    list={datalistId}
                    placeholder="예: CNC-01"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <datalist id={datalistId}>
                  {machineNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormSelectField
            control={form.control}
            name="equipmentId"
            label="MES 설비"
            placeholder="MES 설비 선택"
            options={[
              { label: "미매핑", value: NO_EQUIPMENT_VALUE },
              ...equipments.map((equipment) => ({
                label: `${equipment.name} (${equipment.code}) - ${equipment.workCenter.name}`,
                value: equipment.id,
              })),
            ]}
          />

          <FormSwitchField
            control={form.control}
            name="isActive"
            label="사용 여부"
            description="비활성 상태에서는 수신 데이터가 staging에 남고 MES native 변환 대상에서 제외됩니다."
          />

          <FormTextareaField
            control={form.control}
            name="memo"
            label="메모"
            placeholder="현장 NCWatch 표시명, 장비 위치 등"
            rows={3}
          />
        </div>
      </Form>
    </FormSheet>
  )
}
