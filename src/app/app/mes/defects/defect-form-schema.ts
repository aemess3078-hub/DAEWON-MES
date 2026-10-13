import { z } from "zod"

export const DEFECT_CATEGORY_OPTIONS = [
  { label: "치수", value: "DIMENSIONAL" },
  { label: "외관", value: "VISUAL" },
  { label: "기능", value: "FUNCTIONAL" },
  { label: "재질", value: "MATERIAL" },
] as const

export const defectCodeFormSchema = z.object({
  code: z.string().min(1, "불량코드를 입력하세요").max(50),
  name: z.string().min(1, "불량명을 입력하세요").max(100),
  defectCategory: z.enum(["DIMENSIONAL", "VISUAL", "FUNCTIONAL", "MATERIAL"], {
    required_error: "불량유형을 선택하세요",
  }),
})

export type DefectCodeFormValues = z.infer<typeof defectCodeFormSchema>
