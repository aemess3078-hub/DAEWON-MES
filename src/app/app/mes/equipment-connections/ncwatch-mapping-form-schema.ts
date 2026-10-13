import { z } from "zod"

export const NO_EQUIPMENT_VALUE = "__NO_EQUIPMENT__"

export const ncwatchMappingFormSchema = z.object({
  machineName: z.string().trim().min(1, "수집 기계명을 입력하세요."),
  equipmentId: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  memo: z.string().max(500, "메모는 500자 이내로 입력하세요.").optional().nullable(),
})

export type NcwatchMappingFormValues = z.infer<typeof ncwatchMappingFormSchema>
