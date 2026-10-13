import { z } from "zod"
import { WorkOrderStatus } from "@prisma/client"

export const workOrderOperationFormSchema = z.object({
  routingOperationId: z.string().min(1, "공정을 선택하세요"),
  equipmentId: z.string().optional().nullable(),
  seq: z.number().int().positive(),
  plannedQty: z.number().positive("계획수량은 양수여야 합니다"),
  assignments: z
    .array(
      z.object({
        equipmentId: z.string().min(1, "설비를 선택하세요"),
        assignedQty: z.number().positive("배정수량은 0보다 커야 합니다."),
      })
    )
    .optional()
    .default([]),
})

export const workOrderFormSchema = z.object({
  siteId: z.string().min(1, "공장을 선택하세요"),
  itemId: z.string().min(1, "품목을 선택하세요"),
  bomId: z.string().min(1, "BOM을 선택하세요"),
  routingId: z.string().min(1, "라우팅을 선택하세요"),
  orderNo: z.string().min(1, "작업지시번호를 입력하세요"),
  manufacturingNo: z.string().optional().nullable(),
  plannedQty: z.number().positive("계획수량은 양수여야 합니다"),
  status: z.nativeEnum(WorkOrderStatus).default(WorkOrderStatus.DRAFT),
  dueDate: z.string().optional().nullable(),
  productionPlanItemId: z.string().optional().nullable(),
  operations: z.array(workOrderOperationFormSchema).min(1, "공정을 최소 1개 이상 추가하세요"),
})

export type WorkOrderOperationFormValues = z.infer<typeof workOrderOperationFormSchema>
export type WorkOrderFormValues = z.infer<typeof workOrderFormSchema>
