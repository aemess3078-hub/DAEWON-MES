"use client"

import { useRef, useState } from "react"
import { Camera, ScanBarcode, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { classifyScanInput, encodeLotQr } from "@/lib/qr/lot-qr"
import { LotScanDialog } from "./lot-scan-dialog"
import type { LotScanContext } from "@/lib/actions/lot-qr.actions"

export type ParsedBarcode = {
  /** 레거시 `{itemCode}|{lotId}` 바코드/수동 입력 평문의 품목코드. LOT QR 이면 빈 문자열. */
  itemCode: string
  lotId: string | null
  raw: string
  /** Phase 11: LOT QR(DAEWON|LOT|1|…) 또는 수동 입력한 LOT 번호 후보. 서버/후보목록에서 확정한다. */
  lotNo?: string | null
  kind?: "LOT_QR" | "MANUAL_TEXT" | "LEGACY_ITEM_LOT"
}

interface BarcodeScanInputProps {
  onScan: (parsed: ParsedBarcode) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** 지정하면 태블릿 카메라 스캔 버튼이 표시된다(서버 조회 컨텍스트). */
  cameraContext?: LotScanContext
}

/**
 * 바코드/QR 스캔 입력 컴포넌트
 *  - USB 키보드 웨지 스캐너: 값 입력 후 Enter
 *  - 태블릿 카메라: cameraContext 지정 시 카메라 버튼(공통 LotScanDialog)
 * 파싱은 중앙 파서(lib/qr/lot-qr.ts)만 사용한다. 스캔은 식별일 뿐 mutation 을 일으키지 않는다.
 */
export function BarcodeScanInput({
  onScan,
  placeholder = "바코드 또는 LOT QR 을 스캔하세요",
  disabled = false,
  className,
  cameraContext,
}: BarcodeScanInputProps) {
  const [value, setValue] = useState("")
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      e.preventDefault()
      processScan(value.trim())
    }
  }

  const processScan = (raw: string) => {
    const scan = classifyScanInput(raw)
    setValue("")
    if (scan.kind === "INVALID") {
      setLastScan(null)
      setError(scan.message)
      setTimeout(() => inputRef.current?.focus(), 50)
      return
    }
    setError(null)
    setLastScan(scan.raw)
    if (scan.kind === "LOT_QR") {
      onScan({ itemCode: "", lotId: null, raw: scan.raw, lotNo: scan.lotNo, kind: "LOT_QR" })
    } else if (scan.kind === "LEGACY_ITEM_LOT") {
      onScan({ itemCode: scan.itemCode, lotId: scan.lotId, raw: scan.raw, lotNo: null, kind: "LEGACY_ITEM_LOT" })
    } else {
      onScan({ itemCode: scan.text, lotId: null, raw: scan.raw, lotNo: scan.text, kind: "MANUAL_TEXT" })
    }
    // 스캔 후 포커스 유지
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const clearLastScan = () => {
    setLastScan(null)
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="h-10 border-dashed bg-muted/30 pl-9 font-mono text-[14px] focus:border-solid focus:bg-background"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        {cameraContext && (
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 px-3 text-[14px]"
            disabled={disabled}
            onClick={() => setCameraOpen(true)}
          >
            <Camera className="mr-1.5 h-4 w-4" /> 카메라
          </Button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5">
          <span className="flex-1 text-[13px] text-red-700">{error}</span>
          <button type="button" onClick={clearLastScan} className="text-red-500 hover:text-red-700" aria-label="닫기">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {lastScan && !error && (
        <div className="flex items-center gap-2 rounded border border-green-200 bg-green-50 px-2 py-1.5">
          <ScanBarcode className="h-3.5 w-3.5 shrink-0 text-green-600" />
          <span className="flex-1 truncate font-mono text-[13px] text-green-700">{lastScan}</span>
          <button type="button" onClick={clearLastScan} className="text-green-500 hover:text-green-700" aria-label="닫기">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {cameraContext && (
        <LotScanDialog
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          context={cameraContext}
          title="LOT QR 카메라 스캔"
          onConfirm={(res) => {
            const payload = encodeLotQr(res.lot.lotNo)
            setError(null)
            setLastScan(payload)
            onScan({
              itemCode: res.lot.item.code,
              lotId: res.lot.id,
              raw: payload,
              lotNo: res.lot.lotNo,
              kind: "LOT_QR",
            })
          }}
        />
      )}
    </div>
  )
}
