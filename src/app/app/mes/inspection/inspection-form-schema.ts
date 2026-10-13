import { z } from "zod"

export const INSPECTION_RESULT_OPTIONS = [
  { label: "합격 (PASS)",       value: "PASS" },
  { label: "불합격 (FAIL)",     value: "FAIL" },
  { label: "조건부 (CONDITIONAL)", value: "CONDITIONAL" },
] as const

export const DEFECT_SEVERITY_OPTIONS = [
  { label: "치명",   value: "CRITICAL" },
  { label: "주요",   value: "MAJOR" },
  { label: "경미",   value: "MINOR" },
] as const

export const DEFECT_DISPOSITION_OPTIONS = [
  { label: "폐기",     value: "SCRAP" },
  { label: "재작업",   value: "REWORK" },
  { label: "허용",     value: "ACCEPT" },
  { label: "현상유지", value: "USE_AS_IS" },
] as const

export const defectRecordSchema = z.object({
  defectCodeId: z.string().min(1, "불량코드를 선택하세요"),
  qty: z.number().positive("수량은 양수여야 합니다"),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]),
  disposition: z.enum(["SCRAP", "REWORK", "ACCEPT", "USE_AS_IS"]).nullable().optional(),
})

// 검사항목 1개 × sampleNo 1개 = 측정값 1행. 값이 전부 비어 있으면
// 서버(quality.actions.ts validateMeasurements)에서 조용히 제외된다.
export const measurementSchema = z.object({
  inspectionItemId: z.string().min(1),
  sampleNo: z.number().int().min(1),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().nullable().optional(),
  booleanValue: z.boolean().nullable().optional(),
})

export const inspectionFormSchema = z.object({
  workOrderOperationId: z.string().min(1, "작업지시 공정을 선택하세요"),
  inspectionSpecId: z.string().min(1, "검사기준이 없습니다. 해당 공정의 활성 검사기준을 먼저 등록하세요."),
  inspectorId: z.string().min(1, "검사자를 선택하세요"),
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]).nullable().optional(),
  inspectedQty: z.number().positive("검사수량은 양수여야 합니다"),
  inspectedAt: z.string().min(1, "검사일시를 입력하세요"),
  measurements: z.array(measurementSchema),
  defectRecords: z.array(defectRecordSchema),
})

export type DefectRecordFormValues = z.infer<typeof defectRecordSchema>
export type MeasurementFormValues = z.infer<typeof measurementSchema>
export type InspectionFormValues = z.infer<typeof inspectionFormSchema>
