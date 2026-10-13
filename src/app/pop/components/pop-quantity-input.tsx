"use client"

import { useEffect, useState } from "react"

type Props = {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  /** 빠른 증가 버튼 단위. 기본 [1, 10, 100] */
  steps?: number[]
  className?: string
}

const DEFAULT_STEPS = [1, 10, 100]

export function PopQuantityInput({
  label,
  value,
  onChange,
  min = 0,
  steps = DEFAULT_STEPS,
  className,
}: Props) {
  // 직접입력 필드용 로컬 텍스트 상태 (포커스 중에는 외부 value로 덮어쓰지 않음)
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])

  const clamp = (v: number) => (v < min ? min : v)
  const adjust = (delta: number) => onChange(clamp(value + delta))
  const reset = () => onChange(min)

  const handleInput = (raw: string) => {
    setText(raw)
    if (raw === "") return
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= min) {
      onChange(parsed)
    }
  }

  const handleBlur = () => {
    setFocused(false)
    const parsed = Number(text)
    if (text === "" || !Number.isFinite(parsed) || parsed < min) {
      onChange(min)
      setText(String(min))
    } else {
      onChange(parsed)
      setText(String(parsed))
    }
  }

  // 빠른 단위 버튼: 증가는 steps 전체, 감소는 10 이하 단위만(실수로 큰 차감 방지)
  const plusSteps = steps
  const minusSteps = steps.filter((s) => s <= 10).sort((a, b) => b - a)

  const minusBtn =
    "h-14 min-w-[3.75rem] px-3 text-lg font-bold rounded-xl border-2 border-slate-300 text-slate-600 hover:border-slate-500 hover:bg-slate-100 active:scale-95 transition-all"
  const plusBtn =
    "h-14 min-w-[3.75rem] px-3 text-lg font-bold rounded-xl border-2 border-blue-300 text-blue-700 hover:border-blue-500 hover:bg-blue-50 active:scale-95 transition-all"
  // +100(이상)은 가장 큰 단위를 눈에 띄게 강조
  const plusBtnEmphasis =
    "h-14 min-w-[4.25rem] px-3 text-lg font-extrabold rounded-xl border-2 border-emerald-400 bg-emerald-50 text-emerald-700 hover:border-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all"

  const maxStep = Math.max(...plusSteps)

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {/* 라벨 + 직접입력 + 초기화 */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 font-semibold text-slate-700">{label}</span>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={handleBlur}
          aria-label={`${label} 수량 직접입력`}
          className="h-14 w-32 rounded-xl border-2 border-slate-300 text-center text-3xl font-bold tabular-nums text-slate-800 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={reset}
          className="ml-auto h-10 px-3 text-sm font-medium text-slate-400 hover:text-slate-700 transition-colors"
        >
          초기화
        </button>
      </div>

      {/* 빠른 입력 버튼 */}
      <div className="flex flex-wrap items-center gap-2 pl-[5.75rem]">
        {minusSteps.map((s) => (
          <button
            key={`minus-${s}`}
            type="button"
            className={minusBtn}
            onClick={() => adjust(-s)}
            aria-label={`${label} ${s} 감소`}
          >
            −{s}
          </button>
        ))}
        {plusSteps.map((s) => (
          <button
            key={`plus-${s}`}
            type="button"
            className={s === maxStep && maxStep >= 100 ? plusBtnEmphasis : plusBtn}
            onClick={() => adjust(s)}
            aria-label={`${label} ${s} 증가`}
          >
            +{s}
          </button>
        ))}
      </div>
    </div>
  )
}
