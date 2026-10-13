import { z } from "zod"

export const itemPriceFormSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  partnerId: z.string().min(1, "거래처를 선택하세요"),
  priceType: z.enum(["PURCHASE", "SALES"]),
  unitPrice: z.coerce.number().nonnegative("단가는 0 이상이어야 합니다"),
  currency: z.string().default("KRW"),
  effectiveFrom: z.string().min(1, "유효 시작일을 입력하세요"),
  effectiveTo: z.string().optional(),
  note: z.string().optional(),
})

export type ItemPriceFormValues = z.infer<typeof itemPriceFormSchema>
