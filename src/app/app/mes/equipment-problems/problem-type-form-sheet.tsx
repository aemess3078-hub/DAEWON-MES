"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet } from "@/components/common/form-sheet"
import {
  ProblemTypeRow,
  createProblemType,
  updateProblemType,
} from "@/lib/actions/equipment-management.actions"

const schema = z.object({
  code: z.string().min(1, "코드를 입력해주세요").max(20),
  name: z.string().min(1, "유형명을 입력해주세요"),
  category: z.string().optional(),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: ProblemTypeRow | null
  onSuccess: () => void
}

export function ProblemTypeFormSheet({ open, onOpenChange, editingRow, onSuccess }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", name: "", category: "", description: "" },
  })

  useEffect(() => {
    if (editingRow) {
      form.reset({
        code: editingRow.code,
        name: editingRow.name,
        category: editingRow.category ?? "",
        description: editingRow.description ?? "",
      })
    } else {
      form.reset({ code: "", name: "", category: "", description: "" })
    }
  }, [editingRow, open])

  async function onSubmit(values: FormValues) {
    if (editingRow) {
      await updateProblemType(editingRow.id, {
        name: values.name,
        category: values.category,
        description: values.description,
      })
    } else {
      await createProblemType({
        code: values.code,
        name: values.name,
        category: values.category,
        description: values.description,
      })
    }
    onOpenChange(false)
    onSuccess()
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={editingRow ? "edit" : "create"}
      title={editingRow ? "문제유형 수정" : "문제유형 등록"}
      onSubmit={form.handleSubmit(onSubmit)}
      isLoading={form.formState.isSubmitting}
    >
      <Form {...form}>
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>코드 *</FormLabel>
                <FormControl>
                  <Input placeholder="예: MECH-001" disabled={!!editingRow} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>문제유형명 *</FormLabel>
                <FormControl>
                  <Input placeholder="예: 기계적 마모" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>카테고리</FormLabel>
                <FormControl>
                  <Input placeholder="예: 기계, 전기, 소프트웨어" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>설명</FormLabel>
                <FormControl>
                  <Textarea placeholder="문제유형에 대한 상세 설명" rows={3} {...field} />
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
