import { z } from "zod"

export const shipmentLotAllocationSchema = z.object({
  lotId: z.string().min(1, "완제품 LOT를 선택하세요."),
  qty: z.coerce.number().positive("출하수량은 0보다 커야 합니다."),
})

export const shipmentItemSchema = z.object({
  salesOrderItemId: z.string().min(1, "수주 품목을 선택하세요."),
  itemId: z.string().min(1),
  isLotTracked: z.boolean(),
  qty: z.coerce.number().nonnegative().optional(),
  lotAllocations: z.array(shipmentLotAllocationSchema),
}).superRefine((item, ctx) => {
  if (item.isLotTracked) {
    if (item.lotAllocations.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lotAllocations"],
        message: "최소 1개의 LOT와 출하수량을 입력하세요.",
      })
    }

    const selectedLotIds = new Set<string>()
    item.lotAllocations.forEach((allocation, index) => {
      if (allocation.lotId && selectedLotIds.has(allocation.lotId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lotAllocations", index, "lotId"],
          message: "동일한 LOT를 중복 선택할 수 없습니다.",
        })
      }
      selectedLotIds.add(allocation.lotId)
    })
    return
  }

  if (!item.qty || item.qty <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["qty"],
      message: "출하수량은 0보다 커야 합니다.",
    })
  }
})

export const shipmentFormSchema = z.object({
  salesOrderId: z.string().min(1, "수주를 선택하세요."),
  plannedDate: z.string().min(1, "출하예정일을 입력하세요."),
  warehouseId: z.string().min(1, "출하 창고를 선택하세요."),
  note: z.string().optional(),
  items: z.array(shipmentItemSchema).min(1, "실제 출하 품목을 1개 이상 선택하세요."),
})

export type ShipmentFormValues = z.infer<typeof shipmentFormSchema>

export function canBulkPrintShipmentLabels(
  items: Array<{ isLotTracked: boolean; qty?: number }>,
) {
  return (
    items.length > 0 &&
    items.every((item) => !item.isLotTracked) &&
    items.some((item) => Number(item.qty) > 0)
  )
}
