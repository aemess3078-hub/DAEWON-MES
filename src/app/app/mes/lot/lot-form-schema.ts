import { z } from "zod"

export const lotFormSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  lotNo: z.string().min(1, "LOT번호를 입력하세요"),
  qty: z.number().positive("수량은 양수여야 합니다"),
  manufactureDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
})

export type LotFormValues = z.infer<typeof lotFormSchema>

export const lotRuleFormSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  prefix: z.string().optional().nullable(),
  dateFormat: z.string().optional().nullable(),
  seqLength: z.number().int().min(3).max(8).default(4),
})

export type LotRuleFormValues = z.infer<typeof lotRuleFormSchema>
