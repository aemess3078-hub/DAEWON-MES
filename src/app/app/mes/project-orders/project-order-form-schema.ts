import { z } from "zod"

export {
  PROJECT_ORDER_STATUS_TRANSITIONS,
  PROJECT_ORDER_CREATABLE_STATUSES,
} from "@/lib/project-order-status"

export const projectOrderFormSchema = z
  .object({
    name: z.string().min(1, "프로젝트명을 입력하세요"),
    siteId: z.string().min(1, "사업장을 선택하세요"),
    customerId: z.string().min(1, "거래처를 선택하세요"),
    ownerId: z.string().min(1, "담당자를 선택하세요"),
    status: z.enum(["DRAFT", "CONFIRMED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
    itemId: z.string().optional(),
    salesOrderId: z.string().optional(),
    plannedStartDate: z.string().optional(),
    dueDate: z.string().optional(),
    description: z.string().optional(),
  })
  .refine(
    (data) => !data.plannedStartDate || !data.dueDate || data.plannedStartDate <= data.dueDate,
    { message: "시작 예정일은 납기 예정일보다 늦을 수 없습니다.", path: ["dueDate"] }
  )

export type ProjectOrderFormValues = z.infer<typeof projectOrderFormSchema>
