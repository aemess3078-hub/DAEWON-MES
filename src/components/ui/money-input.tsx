import * as React from "react"
import { Input } from "@/components/ui/input"

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number | undefined | null
  onChange: (value: number | undefined) => void
}

function formatDigits(digitsOnly: string): string {
  return digitsOnly === "" ? "" : Number(digitsOnly).toLocaleString("ko-KR")
}

/** 원화 금액 입력 필드. 소수점 없이 정수만 다루며 입력 중에도 천 단위 쉼표를 표시한다. */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, ...props }, ref) => {
    const displayValue =
      value === undefined || value === null || Number.isNaN(value) ? "" : Number(value).toLocaleString("ko-KR")

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target
      const raw = input.value
      const cursorPos = input.selectionStart ?? raw.length
      const digitsBeforeCursor = raw.slice(0, cursorPos).replace(/[^0-9]/g, "").length
      const digitsOnly = raw.replace(/[^0-9]/g, "")

      onChange(digitsOnly === "" ? undefined : Number(digitsOnly))

      const formatted = formatDigits(digitsOnly)
      requestAnimationFrame(() => {
        let count = 0
        let pos = 0
        for (; pos < formatted.length && count < digitsBeforeCursor; pos++) {
          if (/[0-9]/.test(formatted[pos])) count++
        }
        input.setSelectionRange(pos, pos)
      })
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={displayValue}
        onChange={handleChange}
        {...props}
      />
    )
  }
)
MoneyInput.displayName = "MoneyInput"
