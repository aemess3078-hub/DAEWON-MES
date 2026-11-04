import * as React from "react"

export type FormMode = "create" | "edit" | "view"

export interface FormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: FormMode
  title: string
  description?: string
  isLoading?: boolean
  /** 저장 버튼만 비활성화(예: 입력 오류가 남아 있을 때). 취소 버튼에는 영향 없음 */
  submitDisabled?: boolean
  onSubmit?: () => void
  children: React.ReactNode
  /** 기본 sm:max-w-lg보다 넓은 폼이 필요할 때만 지정 (예: 컬럼이 많은 품목 표) */
  contentClassName?: string
}
