import { z } from "zod"
import { PlanType, PlanStatus } from "@prisma/client"

export const planItemFormSchema = z.object({
  productionPlanItemId: z.string().optional().nullable(),
  salesOrderItemId: z.string().optional().nullable(),
  itemId: z.string().min(1, "품목을 선택하세요"),
  bomId: z.string().optional().nullable(),
  routingId: z.string().optional().nullable(),
  plannedQty: z.number().positive("계획수량은 양수여야 합니다"),
  note: z.string().optional().nullable(),
})

export const planFormSchema = z
  .object({
    siteId: z.string().min(1, "공장을 선택하세요"),
    planNo: z.string().min(1, "계획번호를 입력하세요"),
    planType: z.nativeEnum(PlanType),
    startDate: z.string().min(1, "시작일을 선택하세요"),
    endDate: z.string().min(1, "종료일을 선택하세요"),
    status: z.nativeEnum(PlanStatus).default(PlanStatus.DRAFT),
    note: z.string().optional().nullable(),
    items: z.array(planItemFormSchema).min(1, "품목을 최소 1개 이상 추가하세요"),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: "종료일은 시작일 이후여야 합니다",
    path: ["endDate"],
  })
  .superRefine((data, ctx) => {
    const seenItemIds = new Set<string>()

    data.items.forEach((item, index) => {
      if (!item.itemId || !seenItemIds.has(item.itemId)) {
        if (item.itemId) seenItemIds.add(item.itemId)
        return
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "동일한 품목을 생산계획에 중복으로 등록할 수 없습니다.",
        path: ["items", index, "itemId"],
      })
    })
  })

export type PlanItemFormValues = z.infer<typeof planItemFormSchema>
export type PlanFormValues = z.infer<typeof planFormSchema>
