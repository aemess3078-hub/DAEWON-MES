import { z } from "zod"

const quotationItemSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  qty: z.coerce.number().positive("수량은 0보다 커야 합니다"),
  unitPrice: z.coerce.number().min(0, "단가는 0 이상이어야 합니다"),
  note: z.string().optional(),
})

export const quotationFormSchema = z.object({
  siteId: z.string().min(1, "공장을 선택하세요"),
  customerId: z.string().min(1, "고객사를 선택하세요"),
  quotationDate: z.string().min(1, "견적일을 입력하세요"),
  validUntil: z.string().min(1, "유효기한을 입력하세요"),
  status: z.string().default("DRAFT"),
  currency: z.string().default("KRW"),
  note: z.string().optional(),
  items: z.array(quotationItemSchema).min(1, "최소 1개 품목이 필요합니다"),
})

export type QuotationFormValues = z.infer<typeof quotationFormSchema>
export type QuotationItemFormValues = z.infer<typeof quotationItemSchema>
