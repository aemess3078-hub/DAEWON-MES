import { z } from "zod"

export const itemGroupFormSchema = z.object({
  categoryId:   z.string().min(1, "품목분류를 선택하세요"),
  code:         z.string().min(1, "품목군코드를 입력하세요").max(50),
  name:         z.string().min(1, "품목군명을 입력하세요").max(100),
  description:  z.string().max(500).optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive:     z.boolean().default(true),
})

export type ItemGroupFormValues = z.infer<typeof itemGroupFormSchema>
