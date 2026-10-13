import { z } from "zod"

export const gatewayFormSchema = z.object({
  name: z.string().min(1, "게이트웨이 이름을 입력하세요").max(100),
  siteId: z.string().min(1, "공장을 선택하세요"),
  description: z.string().max(500).optional().nullable(),
})

export type GatewayFormValues = z.infer<typeof gatewayFormSchema>
