"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  CALIBRATION_PROGRESS_LABELS,
  CALIBRATION_RESULT_LABELS,
  CALIBRATION_STATE_LABELS,
  USAGE_STATUS_LABELS,
  type CalibrationProgressValue,
  type CalibrationResultValue,
  type CalibrationStateValue,
  type InstrumentUsageStatusValue,
} from "@/lib/instrument-calibration"

// ─── 상태 칩 ──────────────────────────────────────────────────────────────────
// 정상: 녹색 / 임박: 노란색 / 초과: 빨간색 / 미등록: 회색 (요구사항)

const CHIP = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium whitespace-nowrap"

const STATE_CLASS: Record<CalibrationStateValue, string> = {
  NORMAL: "bg-green-100 text-green-800",
  DUE_SOON: "bg-yellow-100 text-yellow-800",
  OVERDUE: "bg-red-100 text-red-700",
  UNREGISTERED: "bg-slate-100 text-slate-600",
  EXEMPT: "bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200",
}

export function CalibrationStateChip({ state }: { state: CalibrationStateValue }) {
  return <span className={cn(CHIP, STATE_CLASS[state])}>{CALIBRATION_STATE_LABELS[state]}</span>
}

const USAGE_CLASS: Record<InstrumentUsageStatusValue, string> = {
  AVAILABLE: "bg-blue-50 text-blue-700",
  SUSPENDED: "bg-orange-100 text-orange-800",
  ON_HOLD: "bg-purple-100 text-purple-700",
  DISPOSED: "bg-slate-200 text-slate-600",
}

export function UsageStatusChip({ status }: { status: InstrumentUsageStatusValue }) {
  return <span className={cn(CHIP, USAGE_CLASS[status])}>{USAGE_STATUS_LABELS[status]}</span>
}

export function ResultChip({ result, cancelled }: { result: CalibrationResultValue | null; cancelled?: boolean }) {
  if (cancelled) return <span className={cn(CHIP, "bg-slate-200 text-slate-600")}>취소</span>
  if (!result) return <span className={cn(CHIP, "bg-slate-100 text-slate-600")}>미확인(이관)</span>
  return (
    <span className={cn(CHIP, result === "PASS" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700")}>
      {CALIBRATION_RESULT_LABELS[result]}
    </span>
  )
}

const PROGRESS_CLASS: Record<CalibrationProgressValue, string> = {
  SCHEDULED: "bg-slate-100 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-800",
}

export function ProgressChip({ status }: { status: CalibrationProgressValue }) {
  return <span className={cn(CHIP, PROGRESS_CLASS[status])}>{CALIBRATION_PROGRESS_LABELS[status]}</span>
}

// ─── 날짜/숫자 표기 ───────────────────────────────────────────────────────────

/** "YYYY-MM-DD" 그대로 표기한다(앱 전역 날짜 표기와 통일). 없으면 "-" */
export function formatDate(value: string | null | undefined): string {
  return value ?? "-"
}

export function formatRemaining(days: number | null): string {
  if (days === null) return "-"
  if (days < 0) return `D+${Math.abs(days)} 초과`
  if (days === 0) return "D-Day"
  return `D-${days}`
}

export function formatCost(value: number | null): string {
  return value === null ? "-" : `${value.toLocaleString("ko-KR")}원`
}

// ─── 안내 배너 ────────────────────────────────────────────────────────────────

export type Notice = { type: "success" | "error"; message: string }

export function NoticeBanner({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  if (!notice) return null
  const isError = notice.type === "error"
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-[14px]",
        isError ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800",
      )}
    >
      {isError ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
      <p className="flex-1 break-words">{notice.message}</p>
      <button type="button" onClick={onClose} aria-label="닫기" className="rounded p-0.5 opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── 폼 보조 ──────────────────────────────────────────────────────────────────

export function Field({
  label,
  required,
  hint,
  children,
  className,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[14px] font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export const NONE_VALUE = "__none__"

/** Radix Select 는 빈 문자열 값을 허용하지 않으므로 "전체/미지정"을 NONE_VALUE 로 표현한다. */
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder,
  noneLabel,
  disabled,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  noneLabel?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <Select
      value={value === "" ? (noneLabel ? NONE_VALUE : undefined) : value}
      onValueChange={(next) => onChange(next === NONE_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-10 text-[14px]", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE_VALUE}>{noneLabel}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── 사유 입력 확인 다이얼로그 ────────────────────────────────────────────────

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  placeholder,
  destructive,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  placeholder?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = React.useState("")
  React.useEffect(() => {
    if (open) setReason("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-[18px]">{title}</DialogTitle>
          <DialogDescription className="text-[14px]">{description}</DialogDescription>
        </DialogHeader>
        <Field label="사유" required>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            placeholder={placeholder ?? "사유를 입력해 주세요."}
            className="min-h-[88px]"
          />
        </Field>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            닫기
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending || reason.trim().length === 0}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "처리 중..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
