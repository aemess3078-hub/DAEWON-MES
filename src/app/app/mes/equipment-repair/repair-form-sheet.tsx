"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormSheet } from "@/components/common/form-sheet"
import { AttachmentSection } from "@/components/common/attachments/attachment-section"
import {
  RepairRequestRow,
  ProblemTypeRow,
  createRepairRequest,
  updateRepairRequest,
} from "@/lib/actions/equipment-management.actions"

const schema = z.object({
  equipmentId: z.string().min(1, "설비를 선택해주세요"),
  problemTypeId: z.string().optional(),
  title: z.string().min(1, "제목을 입력해주세요"),
  description: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  assignedTo: z.string().optional(),
  note: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: RepairRequestRow | null
  equipments: { id: string; code: string; name: string; workCenter: { name: string } }[]
  profiles: { id: string; name: string }[]
  problemTypes: ProblemTypeRow[]
  defaultEquipmentId?: string
}

export function RepairRepairFormSheet({ open, onOpenChange, editingRow, equipments, profiles, problemTypes, defaultEquipmentId }: Props) {
  const router = useRouter()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      equipmentId: "",
      problemTypeId: "",
      title: "",
      description: "",
      priority: "MEDIUM",
      assignedTo: "",
      note: "",
    },
  })

  useEffect(() => {
    if (editingRow) {
      form.reset({
        equipmentId: editingRow.equipmentId,
        problemTypeId: editingRow.problemTypeId ?? "",
        title: editingRow.title,
        description: editingRow.description ?? "",
        priority: editingRow.priority,
        assignedTo: editingRow.assignedTo ?? "",
        note: editingRow.note ?? "",
      })
    } else {
      form.reset({ equipmentId: defaultEquipmentId ?? "", problemTypeId: "", title: "", description: "", priority: "MEDIUM", assignedTo: "", note: "" })
    }
  }, [defaultEquipmentId, editingRow, form, open])

  async function onSubmit(values: FormValues) {
    if (editingRow) {
      await updateRepairRequest(editingRow.id, {
        title: values.title,
        description: values.description,
        priority: values.priority,
        problemTypeId: values.problemTypeId || undefined,
        assignedTo: values.assignedTo || undefined,
        note: values.note,
      })
    } else {
      await createRepairRequest({
        equipmentId: values.equipmentId,
        problemTypeId: values.problemTypeId || undefined,
        title: values.title,
        description: values.description,
        priority: values.priority,
      })
    }
    onOpenChange(false)
    router.refresh()
  }

  const PRIORITY_OPTIONS = [
    { value: "LOW", label: "낮음" },
    { value: "MEDIUM", label: "보통" },
    { value: "HIGH", label: "높음" },
    { value: "CRITICAL", label: "긴급" },
  ]

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={editingRow ? "edit" : "create"}
      title={editingRow ? "수리요청 수정" : "수리 요청"}
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
                <Select onValueChange={field.onChange} value={field.value} disabled={!!editingRow}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="설비 선택" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {equipments.map((eq) => (
                      <SelectItem key={eq.id} value={eq.id}>
                        {eq.code} — {eq.name} ({eq.workCenter.name})
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
            name="problemTypeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>문제유형</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="문제유형 선택 (선택사항)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {problemTypes.map((pt) => (
                      <SelectItem key={pt.id} value={pt.id}>
                        {pt.code} — {pt.name}
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
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>제목 *</FormLabel>
                <FormControl>
                  <Input placeholder="이상 현상을 간략히 입력하세요" {...field} />
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
                <FormLabel>상세 설명</FormLabel>
                <FormControl>
                  <Textarea placeholder="발생 상황, 증상 등을 자세히 설명해주세요" rows={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>우선순위</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
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

          <FormField
            control={form.control}
            name="assignedTo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>담당자</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="담당자 선택 (선택사항)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {editingRow && (
            <AttachmentSection entityType="EQUIPMENT_REPAIR_REQUEST" entityId={editingRow.id} />
          )}

          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>비고</FormLabel>
                <FormControl>
                  <Textarea placeholder="추가 메모" rows={2} {...field} />
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
