import { z } from "zod"

const optionalEmail = z
  .string()
  .max(200)
  .email("올바른 이메일 형식이 아닙니다.")
  .optional()
  .or(z.literal(""))

export const partnerFormSchema = z.object({
  code: z.string().min(1, "코드를 입력하세요").max(50),
  name: z.string().min(1, "이름을 입력하세요").max(200),
  partnerType: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"], {
    required_error: "유형을 선택하세요",
  }),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  businessNumber: z.string().max(20).optional().or(z.literal("")),
  ceoName: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  email: optionalEmail,
  email2: optionalEmail,
  address: z.string().max(300).optional().or(z.literal("")),
  contactName: z.string().max(100).optional().or(z.literal("")),
  contactPhone: z.string().max(50).optional().or(z.literal("")),
  remark: z.string().max(500).optional().or(z.literal("")),
})

export type PartnerFormValues = z.infer<typeof partnerFormSchema>
