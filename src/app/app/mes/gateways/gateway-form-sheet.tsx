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
  FormTextareaField,
} from "@/components/common/form-sheet"
import { gatewayFormSchema, GatewayFormValues } from "./gateway-form-schema"
import {
  createGateway,
  updateGateway,
  EdgeGatewayRow,
} from "@/lib/actions/equipment-integration.actions"
import { GatewayApiKeyDialog } from "./gateway-api-key-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

interface GatewayFormSheetProps {
  tenantId: string
  sites: { id: string; code: string; name: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: EdgeGatewayRow | null
}

const DEFAULT_VALUES: GatewayFormValues = {
  name: "",
  siteId: "",
  description: "",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GatewayFormSheet({
  tenantId,
  sites,
  open,
  onOpenChange,
  editingRow,
}: GatewayFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const router = useRouter()

  const form = useForm<GatewayFormValues>({
    resolver: zodResolver(gatewayFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (open) {
      if (editingRow) {
        form.reset({
          name: editingRow.name,
          siteId: editingRow.siteId,
          description: editingRow.description ?? "",
        })
      } else {
        form.reset(DEFAULT_VALUES)
      }
    }
  }, [open, editingRow]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: GatewayFormValues) {
    setIsLoading(true)
    try {
      if (editingRow) {
        await updateGateway(editingRow.id, {
          name: values.name,
          description: values.description ?? null,
        })
        onOpenChange(false)
        router.refresh()
      } else {
        const result = await createGateway(
          {
            siteId: values.siteId,
            name: values.name,
            description: values.description ?? null,
          },
          tenantId
        )
        onOpenChange(false)
        setNewApiKey(result.apiKey)
        router.refresh()
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  const isEdit = !!editingRow

  return (
    <>
      <FormSheet
        open={open}
        onOpenChange={onOpenChange}
        mode={isEdit ? "edit" : "create"}
        title={isEdit ? "게이트웨이 수정" : "게이트웨이 등록"}
        description={
          isEdit
            ? "게이트웨이 정보를 수정합니다."
            : "새 Edge Gateway를 등록합니다. 등록 후 API Key가 발급됩니다."
        }
        isLoading={isLoading}
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <Form {...form}>
          <div className="space-y-4">
            <FormTextField
              control={form.control}
              name="name"
              label="게이트웨이 이름"
              placeholder="예: 본공장 게이트웨이 #1"
            />
            <FormSelectField
              control={form.control}
              name="siteId"
              label="공장"
              placeholder="공장 선택"
              disabled={isEdit}
              options={sites.map((s) => ({
                label: `${s.name} (${s.code})`,
                value: s.id,
              }))}
            />
            <FormTextareaField
              control={form.control}
              name="description"
              label="설명"
              placeholder="게이트웨이 설명 (선택)"
              rows={3}
            />
          </div>
        </Form>
      </FormSheet>

      {newApiKey && (
        <GatewayApiKeyDialog
          open={!!newApiKey}
          apiKey={newApiKey}
          onClose={() => setNewApiKey(null)}
        />
      )}
    </>
  )
}
