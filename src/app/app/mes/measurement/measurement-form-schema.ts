import { z } from "zod"

export const INSPECTION_STATUS_OPTIONS = [
  { label: "초안",   value: "DRAFT" },
  { label: "활성",   value: "ACTIVE" },
  { label: "비활성", value: "INACTIVE" },
] as const

export const INSPECTION_INPUT_TYPE_OPTIONS = [
  { label: "수치",   value: "NUMERIC" },
  { label: "텍스트", value: "TEXT" },
  { label: "합불",   value: "BOOLEAN" },
  { label: "선택",   value: "SELECT" },
] as const

export const inspectionSpecFormSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  routingOperationId: z.string().min(1, "공정을 선택하세요"),
  version: z.string().min(1, "버전을 입력하세요").max(20),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"], {
    required_error: "상태를 선택하세요",
  }),
})

export type InspectionSpecFormValues = z.infer<typeof inspectionSpecFormSchema>

export const inspectionItemFormSchema = z.object({
  seq: z.number().int().positive("순서는 양수여야 합니다"),
  name: z.string().min(1, "검사항목명을 입력하세요").max(100),
  inputType: z.enum(["NUMERIC", "TEXT", "BOOLEAN", "SELECT"]),
  lowerLimit: z.number().nullable().optional(),
  upperLimit: z.number().nullable().optional(),
})

export type InspectionItemFormValues = z.infer<typeof inspectionItemFormSchema>
