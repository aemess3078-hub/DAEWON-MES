import { z } from "zod"
import { BOMStatus } from "@prisma/client"

export const bomItemFormSchema = z.object({
  componentItemId: z.string().min(1, "자재를 선택하세요"),
  seq: z.number().int().positive("순서는 양수여야 합니다"),
  qtyPer: z.number().positive("소요량은 양수여야 합니다"),
  scrapRate: z.number().min(0).max(1, "손실률은 0~1 사이여야 합니다"),
})

export const bomFormSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  version: z.string().min(1, "버전을 입력하세요"),
  isDefault: z.boolean().default(false),
  status: z.nativeEnum(BOMStatus).default(BOMStatus.DRAFT),
  bomItems: z.array(bomItemFormSchema).min(1, "자재를 최소 1개 이상 추가하세요"),
})

export type BOMItemFormValues = z.infer<typeof bomItemFormSchema>
export type BOMFormValues = z.infer<typeof bomFormSchema>
