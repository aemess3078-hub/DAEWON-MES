import { z } from "zod"

export const salesOrderItemSchema = z.object({
  itemId: z.string().min(1, "품목을 선택하세요"),
  // 수량은 기본값 없이 입력받는다. 미입력(NaN)·0 이하는 저장 차단
  qty: z.coerce
    .number({ required_error: "수량을 입력하세요", invalid_type_error: "수량을 입력하세요" })
    .positive("수량은 0보다 커야 합니다"),
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
  // 거래처 발주번호: 선택. 문자열 그대로 저장(앞자리 0·영문 조합 보존)
  customerPoNo: z.string().max(100, "거래처 발주번호는 100자 이하여야 합니다").optional(),
  items: z.array(salesOrderItemSchema).min(1, "품목을 1개 이상 추가하세요"),
})

export type SalesOrderFormValues = z.infer<typeof salesOrderFormSchema>
