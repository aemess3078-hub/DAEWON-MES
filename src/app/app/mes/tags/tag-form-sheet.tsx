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
  FormNumberField,
} from "@/components/common/form-sheet"
import {
  tagFormSchema,
  TagFormValues,
  TAG_DATA_TYPE_OPTIONS,
  TAG_CATEGORY_OPTIONS,
} from "./tag-form-schema"
import {
  createTag,
  updateTag,
  DataTagRow,
} from "@/lib/actions/equipment-integration.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

interface TagFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: DataTagRow | null
  connections: {
    id: string
    protocol: string
    equipment: { id: string; code: string; name: string }
    gateway: { name: string }
    _count?: { tags: number }
  }[]
}

const DEFAULT_VALUES: TagFormValues = {
  connectionId: "",
  tagCode:      "",
  displayName:  "",
  dataType:     "FLOAT",
  unit:         "",
  category:     "PROCESS",
  plcAddress:   "",
  scaleFactor:  null,
  offset:       null,
  samplingMs:   1000,
  deadband:     null,
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TagFormSheet({
  open,
  onOpenChange,
  editingRow,
  connections,
}: TagFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<TagFormValues>({
    resolver: zodResolver(tagFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (open) {
      if (editingRow) {
        form.reset({
          connectionId: editingRow.connectionId,
          tagCode:      editingRow.tagCode,
          displayName:  editingRow.displayName,
          dataType:     editingRow.dataType,
          unit:         editingRow.unit ?? "",
          category:     editingRow.category,
          plcAddress:   editingRow.plcAddress,
          scaleFactor:  editingRow.scaleFactor ? Number(editingRow.scaleFactor) : null,
          offset:       editingRow.offset ? Number(editingRow.offset) : null,
          samplingMs:   editingRow.samplingMs,
          deadband:     editingRow.deadband ? Number(editingRow.deadband) : null,
        })
      } else {
        form.reset(DEFAULT_VALUES)
      }
    }
  }, [open, editingRow]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: TagFormValues) {
    setIsLoading(true)
    try {
      if (editingRow) {
        await updateTag(editingRow.id, {
          displayName: values.displayName,
          dataType:    values.dataType,
          unit:        values.unit || null,
          category:    values.category,
          plcAddress:  values.plcAddress,
          scaleFactor: values.scaleFactor ?? null,
          offset:      values.offset ?? null,
          samplingMs:  values.samplingMs,
          deadband:    values.deadband ?? null,
        })
      } else {
        await createTag({
          connectionId: values.connectionId,
          tagCode:      values.tagCode,
          displayName:  values.displayName,
          dataType:     values.dataType,
          unit:         values.unit || null,
          category:     values.category,
          plcAddress:   values.plcAddress,
          scaleFactor:  values.scaleFactor ?? null,
          offset:       values.offset ?? null,
          samplingMs:   values.samplingMs,
          deadband:     values.deadband ?? null,
        })
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
      title={isEdit ? "태그 수정" : "태그 등록"}
      description={
        isEdit
          ? "태그 정보를 수정합니다."
          : "설비 연결에 대한 데이터 수집 태그를 등록합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-4">
          <FormSelectField
            control={form.control}
            name="connectionId"
            label="연결 (설비 — 게이트웨이)"
            placeholder="연결 선택"
            disabled={isEdit}
            options={connections.map((c) => ({
              label: `${c.equipment.name} (${c.equipment.code}) → ${c.gateway.name} [${c.protocol}]`,
              value: c.id,
            }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormTextField
              control={form.control}
              name="tagCode"
              label="태그코드"
              placeholder="예: TEMP_001"
              disabled={isEdit}
            />
            <FormTextField
              control={form.control}
              name="displayName"
              label="표시명"
              placeholder="예: 온도 센서 #1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormSelectField
              control={form.control}
              name="dataType"
              label="데이터 타입"
              placeholder="타입 선택"
              options={TAG_DATA_TYPE_OPTIONS.map((o) => ({
                label: o.label,
                value: o.value,
              }))}
            />
            <FormSelectField
              control={form.control}
              name="category"
              label="카테고리"
              placeholder="카테고리 선택"
              options={TAG_CATEGORY_OPTIONS.map((o) => ({
                label: o.label,
                value: o.value,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormTextField
              control={form.control}
              name="plcAddress"
              label="PLC 주소"
              placeholder="예: D100, MW200"
            />
            <FormTextField
              control={form.control}
              name="unit"
              label="단위"
              placeholder="예: °C, rpm, bar"
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <p className="text-[13px] font-medium text-muted-foreground">스케일링 및 수집 설정</p>
            <div className="grid grid-cols-2 gap-3">
              <FormNumberField
                control={form.control}
                name="scaleFactor"
                label="Scale Factor"
                placeholder="예: 0.1"
                step={0.000001}
              />
              <FormNumberField
                control={form.control}
                name="offset"
                label="Offset"
                placeholder="예: 0.0"
                step={0.000001}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormNumberField
                control={form.control}
                name="samplingMs"
                label="수집 주기 (ms)"
                placeholder="1000"
                min={100}
              />
              <FormNumberField
                control={form.control}
                name="deadband"
                label="Deadband"
                placeholder="예: 0.5"
                step={0.000001}
              />
            </div>
          </div>
        </div>
      </Form>
    </FormSheet>
  )
}
