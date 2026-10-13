"use client"

import { useRef, useState } from "react"
import { ScanBarcode, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export type ParsedBarcode = {
  itemCode: string
  lotId: string | null
  raw: string
}

interface BarcodeScanInputProps {
  onScan: (parsed: ParsedBarcode) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * 바코드 스캔 입력 컴포넌트
 * USB 바코드 리더가 값을 입력하고 Enter를 누르면 onScan 호출
 * 형식: "{itemCode}|{lotId}" 또는 "{itemCode}"
 */
export function BarcodeScanInput({
  onScan,
  placeholder = "바코드를 스캔하세요",
  disabled = false,
  className,
}: BarcodeScanInputProps) {
  const [value, setValue] = useState("")
  const [lastScan, setLastScan] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      e.preventDefault()
      processScan(value.trim())
    }
  }

  const processScan = (raw: string) => {
    const parts = raw.split("|")
    const parsed: ParsedBarcode = {
      itemCode: parts[0]?.trim() ?? "",
      lotId: parts[1]?.trim() ?? null,
      raw,
    }
    setLastScan(raw)
    setValue("")
    onScan(parsed)
    // 스캔 후 포커스 유지
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const clearLastScan = () => {
    setLastScan(null)
    inputRef.current?.focus()
  }

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <div className="relative">
        <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-9 font-mono text-[13px] h-9 bg-muted/30 border-dashed focus:border-solid focus:bg-background"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {lastScan && (
        <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-50 border border-green-200">
          <ScanBarcode className="h-3.5 w-3.5 text-green-600 shrink-0" />
          <span className="text-[12px] text-green-700 font-mono flex-1 truncate">{lastScan}</span>
          <button onClick={clearLastScan} className="text-green-500 hover:text-green-700">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
