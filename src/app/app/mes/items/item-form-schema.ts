import { z } from "zod"

export const itemFormSchema = z.object({
  code:            z.string().min(1, "품목코드를 입력하세요").max(50),
  name:            z.string().min(1, "품목명을 입력하세요").max(200),
  categoryId:      z.string().min(1, "품목분류를 선택하세요"),
  itemGroupId:     z.string().nullable().optional(),
  uom:             z.string({ required_error: "단위를 선택하세요" }).min(1),
  spec:            z.string().nullable().optional(),
  isLotTracked:    z.boolean().default(false),
  isSerialTracked: z.boolean().default(false),
  lotNumberingType: z.enum(["DEFAULT", "MANUAL", "RAW_DATE_SEQ", "PREFIX_MONTH_SEQ"]).default("DEFAULT"),
  lotPrefix:      z.string().nullable().optional(),
  manualLotPolicy: z.enum(["ALLOWED", "REQUIRED", "DISABLED"]).default("ALLOWED"),
  status:          z.enum(["ACTIVE", "INACTIVE", "DISCONTINUED"]).default("ACTIVE"),
  defaultWarehouseId: z.string().nullable().optional(),
  // MRP 발주제안에서 유지할 최소 가용재고(목표 하한). 0 이상, 소수 6자리까지
  safetyStock: z.coerce
    .number({ invalid_type_error: "안전재고는 숫자로 입력하세요" })
    .min(0, "안전재고는 0 이상이어야 합니다")
    .lt(1_000_000_000_000, "안전재고가 너무 큽니다")
    .default(0),
})

export type ItemFormValues = z.infer<typeof itemFormSchema>
