import { z } from "zod"

export const salesOrderItemSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  qty: z.coerce.number().positive("수량은 0보다 커야 합니다"),
  unitPrice: z.coerce.number().nonnegative().optional(),
  deliveryDate: z.string().optional(),
  note: z.string().optional(),
})

export const salesOrderFormSchema = z.object({
  customerId: z.string().min(1, "고객사를 선택하세요"),
  orderDate: z.string().min(1, "수주일을 입력하세요"),
  deliveryDate: z.string().min(1, "납기일을 입력하세요"),
  status: z.enum([
    "DRAFT",
    "CONFIRMED",
    "IN_PRODUCTION",
    "PARTIAL_SHIPPED",
    "SHIPPED",
    "CLOSED",
    "CANCELLED",
  ]),
  totalAmount: z.coerce.number().nonnegative().optional(),
  currency: z.string().default("KRW"),
  note: z.string().optional(),
  items: z.array(salesOrderItemSchema).min(1, "품목을 1개 이상 추가하세요"),
})

export type SalesOrderFormValues = z.infer<typeof salesOrderFormSchema>
