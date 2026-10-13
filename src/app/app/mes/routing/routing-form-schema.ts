import { z } from "zod"
import { RoutingStatus, RoutingScope } from "@prisma/client"

export const routingOperationFormSchema = z.object({
  seq: z.number().int().positive("순서는 양수여야 합니다"),
  operationCode: z.string().min(1, "공정코드를 입력하세요"),
  name: z.string().min(1, "공정명을 입력하세요"),
  workCenterId: z.string().min(1, "작업장을 선택하세요"),
  standardTime: z.number().min(0, "표준시간은 0 이상이어야 합니다"),
})

export const routingFormSchema = z
  .object({
    code: z.string().min(1, "라우팅 코드를 입력하세요"),
    name: z.string().min(1, "라우팅 명을 입력하세요"),
    version: z.string().min(1, "버전을 입력하세요"),
    status: z.nativeEnum(RoutingStatus).default(RoutingStatus.DRAFT),
    scope: z.nativeEnum(RoutingScope).default(RoutingScope.ITEM_SPECIFIC),
    // ItemRouting 생성용 — scope=COMMON이면 무시된다.
    itemIds: z.array(z.string()).default([]),
    isDefault: z.boolean().default(false),
    operations: z.array(routingOperationFormSchema).min(1, "공정을 최소 1개 이상 추가하세요"),
  })
  .refine(
    (data) => data.scope !== RoutingScope.ITEM_SPECIFIC || data.itemIds.length > 0,
    { message: "품목 전용 라우팅은 최소 1개 이상의 품목을 선택해야 합니다", path: ["itemIds"] }
  )

export type RoutingOperationFormValues = z.infer<typeof routingOperationFormSchema>
export type RoutingFormValues = z.infer<typeof routingFormSchema>
