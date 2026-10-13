"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet"
import { DailyCheckRow, createDailyCheck } from "@/lib/actions/equipment-management.actions"

const schema = z.object({
  equipmentId: z.string().min(1, "설비를 선택해주세요"),
  checkDate: z.string().min(1, "점검일을 입력해주세요"),
  result: z.enum(["PASS", "FAIL", "NA"]),
  note: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: DailyCheckRow | null
  equipments: { id: string; code: string; name: string; workCenter: { name: string } }[]
  defaultEquipmentId?: string
  onSuccess: () => void
}

export function DailyCheckFormSheet({ open, onOpenChange, editingRow, equipments, defaultEquipmentId, onSuccess }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      equipmentId: "",
      checkDate: new Date().toISOString().split("T")[0],
      result: "PASS",
      note: "",
    },
  })

  useEffect(() => {
    if (editingRow) {
      form.reset({
        equipmentId: editingRow.equipmentId,
        checkDate: new Date(editingRow.checkDate).toISOString().split("T")[0],
        result: editingRow.result,
        note: editingRow.note ?? "",
      })
    } else {
      form.reset({
        equipmentId: defaultEquipmentId ?? "",
        checkDate: new Date().toISOString().split("T")[0],
        result: "PASS",
        note: "",
      })
    }
  }, [defaultEquipmentId, editingRow, form, open])

  async function onSubmit(values: FormValues) {
    await createDailyCheck({
      equipmentId: values.equipmentId,
      checkDate: new Date(values.checkDate),
      result: values.result,
      note: values.note,
    })
    onOpenChange(false)
    onSuccess()
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={editingRow ? "edit" : "create"}
      title={editingRow ? "점검 기록 수정" : "점검 등록"}
      onSubmit={form.handleSubmit(onSubmit)}
      isLoading={form.formState.isSubmitting}
    >
      <Form {...form}>
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="equipmentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>설비 *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="설비 선택" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {equipments.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id}>
                        {eq.code} — {eq.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="checkDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>점검일 *</FormLabel>
                <FormControl>
                  <input
                    type="date"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[14px] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="result"
            render={({ field }) => (
              <FormItem>
                <FormLabel>점검결과 *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="PASS">이상없음</SelectItem>
                    <SelectItem value="FAIL">이상있음</SelectItem>
                    <SelectItem value="NA">해당없음</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>비고</FormLabel>
                <FormControl>
                  <Textarea placeholder="이상 내용, 특이사항 등을 기록하세요" rows={3} {...field} />
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
