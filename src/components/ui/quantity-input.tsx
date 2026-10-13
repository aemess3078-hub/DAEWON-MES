"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import {
  sanitizeTypedValue,
  formatLiveDisplay,
  toEditableDisplay,
  TRACKED_CHAR_PATTERN,
} from "./quantity-input.helpers"

export interface QuantityInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number | string | undefined | null
  onChange: (value: number | undefined) => void
  /** 허용할 최대 소수 자릿수. Decimal(18,6) 필드 기준 기본값 6. 정수 전용 필드는 0. */
  maxDecimals?: number
  /**
   * 음수 입력 허용 여부. 기본값 false.
   * MES 수량 필드(생산/재고/투입/LOT 등) 대부분은 음수가 의미를 갖지 않는다.
   * 재고조정처럼 델타 값이 필요한 화면에서만 명시적으로 true로 켠다.
   */
  allowNegative?: boolean
}

/**
 * 공용 수량 입력 컴포넌트. 화면에는 천 단위 콤마 + 최대 maxDecimals 자리
 * 소수를 표시하지만, onChange로는 항상 raw number(또는 undefined)만 전달한다
 * — MoneyInput과 동일한 "표시 문자열 / raw 값 분리" 계약을 따른다.
 *
 * 실제 sanitize/format 로직은 quantity-input.helpers.ts에 있다(ts-node로
 * 독립 테스트하기 위해 JSX/React 의존성과 분리).
 *
 * caret 보존 기법은 MoneyInput(src/components/ui/money-input.tsx)의
 * "재포맷 전/후 자릿수 카운팅 + requestAnimationFrame" 방식을 그대로
 * 참고했다(콤마 삽입 위치만 다시 계산하면 되므로 로직 재사용). MoneyInput은
 * 정수 전용이라 숫자만 세면 되고, 이 컴포넌트는 '.'과 '-'도 함께 추적한다.
 * MoneyInput 자체는 4개 화면(가격/금액 입력)에서 이미 안정적으로 쓰이고
 * 있어 이번 작업에서 건드리지 않았다 — 공통 helper로 추출하는 리팩터링은
 * 회귀 위험 대비 이득이 크지 않다고 판단해 별도 구현으로 두었다.
 */
export const QuantityInput = React.forwardRef<HTMLInputElement, QuantityInputProps>(
  ({ value, onChange, maxDecimals = 6, allowNegative = false, onFocus, onBlur, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false)
    const [text, setText] = React.useState(() => toEditableDisplay(value, maxDecimals))

    React.useEffect(() => {
      if (!isFocused) {
        setText(toEditableDisplay(value, maxDecimals))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, maxDecimals, isFocused])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target
      const rawInput = input.value
      const cursorPos = input.selectionStart ?? rawInput.length

      const trackedBeforeCursor = rawInput
        .slice(0, cursorPos)
        .split("")
        .filter((ch) => TRACKED_CHAR_PATTERN.test(ch)).length

      const sanitized = sanitizeTypedValue(rawInput, { allowNegative, maxDecimals })
      const display = formatLiveDisplay(sanitized)

      setText(display)

      const numeric = Number(sanitized)
      onChange(sanitized === "" || sanitized === "-" || Number.isNaN(numeric) ? undefined : numeric)

      requestAnimationFrame(() => {
        let count = 0
        let pos = 0
        for (; pos < display.length && count < trackedBeforeCursor; pos++) {
          if (TRACKED_CHAR_PATTERN.test(display[pos])) count++
        }
        input.setSelectionRange(pos, pos)
      })
    }

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true)
      onFocus?.(e)
    }

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false)
      setText(toEditableDisplay(value, maxDecimals))
      onBlur?.(e)
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode={maxDecimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      />
    )
  }
)
QuantityInput.displayName = "QuantityInput"
