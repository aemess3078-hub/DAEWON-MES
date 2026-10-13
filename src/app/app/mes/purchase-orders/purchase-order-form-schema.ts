import { z } from "zod"

export const purchaseOrderItemSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  qty: z.coerce.number().positive("수량은 0보다 커야 합니다"),
  unitPrice: z.coerce.number().nonnegative("단가는 0 이상이어야 합니다"),
  note: z.string().optional(),
})

export const purchaseOrderFormSchema = z.object({
  supplierId: z.string().min(1, "공급사를 선택하세요"),
  orderDate: z.string().min(1, "발주일을 입력하세요"),
  expectedDate: z.string().min(1, "입고예정일을 입력하세요"),
  status: z.enum(["DRAFT", "ORDERED", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]),
  totalAmount: z.coerce.number().nonnegative().optional(),
  currency: z.string().default("KRW"),
  note: z.string().optional(),
  items: z.array(purchaseOrderItemSchema).min(1, "품목을 1개 이상 추가하세요"),
})

export type PurchaseOrderFormValues = z.infer<typeof purchaseOrderFormSchema>
