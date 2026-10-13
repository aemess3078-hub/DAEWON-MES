"use client"

type Props = {
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  maxLength?: number
}

export function PopNumberPad({
  value,
  onChange,
  onComplete,
  maxLength = 4,
}: Props) {
  const handlePress = (key: string) => {
    if (key === "C") {
      onChange("")
      return
    }
    if (key === "confirm") {
      onComplete?.(value)
      return
    }
    if (value.length < maxLength) {
      const next = value + key
      onChange(next)
      if (next.length === maxLength) onComplete?.(next)
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "confirm"]

  return (
    <div className="space-y-3">
      {/* PIN 표시 */}
      <div className="flex justify-center gap-3 mb-4">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full transition-colors ${
              i < value.length ? "bg-slate-800" : "bg-slate-300"
            }`}
          />
        ))}
      </div>
      {/* 키패드 */}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => handlePress(key)}
            className={`h-16 text-xl font-bold rounded-2xl transition-all active:scale-95 ${
              key === "confirm"
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : key === "C"
                ? "bg-red-100 text-red-600 hover:bg-red-200 border border-red-200"
                : "bg-white border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-800"
            }`}
          >
            {key === "confirm" ? "확인" : key}
          </button>
        ))}
      </div>
    </div>
  )
}
