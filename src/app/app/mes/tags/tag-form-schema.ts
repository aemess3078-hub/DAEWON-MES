import { z } from "zod"

export const TAG_DATA_TYPE_OPTIONS = [
  { label: "BOOL (논리값)",   value: "BOOL" },
  { label: "INT (정수)",      value: "INT" },
  { label: "FLOAT (실수)",    value: "FLOAT" },
  { label: "STRING (문자열)", value: "STRING" },
] as const

export const TAG_CATEGORY_OPTIONS = [
  { label: "공정 (PROCESS)",  value: "PROCESS" },
  { label: "상태 (STATUS)",   value: "STATUS" },
  { label: "알람 (ALARM)",    value: "ALARM" },
  { label: "카운터 (COUNTER)", value: "COUNTER" },
  { label: "품질 (QUALITY)",  value: "QUALITY" },
] as const

export const tagFormSchema = z.object({
  connectionId: z.string().min(1, "연결을 선택하세요"),
  tagCode:      z.string().min(1, "태그코드를 입력하세요").max(100),
  displayName:  z.string().min(1, "표시명을 입력하세요").max(200),
  dataType:     z.enum(["BOOL", "INT", "FLOAT", "STRING"], { required_error: "데이터 타입을 선택하세요" }),
  unit:         z.string().max(50).optional().nullable(),
  category:     z.enum(["PROCESS", "STATUS", "ALARM", "COUNTER", "QUALITY"], { required_error: "카테고리를 선택하세요" }),
  plcAddress:   z.string().min(1, "PLC 주소를 입력하세요").max(100),
  scaleFactor:  z.coerce.number().optional().nullable(),
  offset:       z.coerce.number().optional().nullable(),
  samplingMs:   z.coerce.number().int().min(100).default(1000),
  deadband:     z.coerce.number().optional().nullable(),
})

export type TagFormValues = z.infer<typeof tagFormSchema>
