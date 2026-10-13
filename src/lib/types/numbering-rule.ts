export type DateFormat = "YYYY" | "YY" | "MM" | "DD" | "JULIAN" | "WEEK"
export type ContextKey = "LINE_CODE" | "PROD_CODE" | "CLIENT_CODE" | "ITEM_CODE" | "ITEM_TYPE" | "SHIFT"

export type Token =
  | { id: string; type: "DATE"; format: DateFormat }
  | { id: string; type: "FIXED"; value: string }
  | { id: string; type: "SEPARATOR"; value: string }
  | { id: string; type: "CONTEXT"; key: ContextKey; fallback?: string; codeGroupCode?: string }
  | { id: string; type: "SEQ"; digits: number }

export type NumberingRuleType = "LOT" | "SERIAL"

export const CONTEXT_KEY_LABELS: Record<ContextKey, string> = {
  LINE_CODE: "라인코드",
  PROD_CODE: "생산코드",
  CLIENT_CODE: "고객코드",
  ITEM_CODE: "품목코드",
  ITEM_TYPE: "품목유형",
  SHIFT: "교대",
}

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  YYYY: "연도(4자리)",
  YY: "연도(2자리)",
  MM: "월(2자리)",
  DD: "일(2자리)",
  JULIAN: "율리우스일",
  WEEK: "주차",
}
