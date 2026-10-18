"use client"

/**
 * 공통 LOT 스캔 다이얼로그 (Phase 11).
 * 자재출고 · 출하 · 완제품입고 · POP · LOT 추적이 같은 컴포넌트를 쓴다(카메라 코드를 화면마다 복사하지 않는다).
 *
 * 스캔 → lookupLotByQr(서버: 로그인/tenant/권한/상태 재검증) → 품목/LOT/상태/가용수량 표시.
 * 이 다이얼로그는 식별까지만 한다. "선택/사용" 버튼은 onConfirm 으로 호출 화면에 위임하며
 * 재고 차감 등 mutation 은 호출 화면의 기존 Server Action 이 수행한다.
 */

import { useCallback, useRef, useState } from "react"
import { ScanLine } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CameraQrScanner, type CameraScanFeedback } from "./camera-qr-scanner"
import { lookupLotByQr, type LotScanContext, type LotScanOk } from "@/lib/actions/lot-qr.actions"

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "사용 가능",
  QUARANTINE: "격리",
  ON_HOLD: "보류",
  CONSUMED: "소진",
  EXPIRED: "만료",
}

export interface LotScanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context?: LotScanContext
  title?: string
  confirmLabel?: string
  /** 사용 불가 LOT 이어도 "선택" 가능하게 할지(추적/조회 화면). 기본 false. */
  allowUnusable?: boolean
  continuous?: boolean
  onConfirm: (lot: LotScanOk) => void
}

export function LotScanDialog({
  open,
  onOpenChange,
  context,
  title = "LOT QR 스캔",
  confirmLabel = "이 LOT 선택",
  allowUnusable = false,
  continuous = false,
  onConfirm,
}: LotScanDialogProps) {
  const [result, setResult] = useState<LotScanOk | null>(null)
  const [feedback, setFeedback] = useState<CameraScanFeedback>(null)
  const inFlight = useRef(false)

  const handleDecoded = useCallback(
    async (raw: string) => {
      // 처리 중에 들어온 스캔은 무시한다(중복 조회/중복 선택 방지)
      if (inFlight.current) return
      inFlight.current = true
      try {
        const res = await lookupLotByQr(raw, context)
        if (!res.ok) {
          setResult(null)
          setFeedback({ ok: false, message: res.message })
          return
        }
        setResult(res)
        setFeedback(
          res.usable || allowUnusable
            ? { ok: true, message: `${res.lot.item.name} · ${res.lot.lotNo} 인식 완료` }
            : { ok: false, message: res.blockReason ?? "사용할 수 없는 LOT 입니다." },
        )
        if (continuous && (res.usable || allowUnusable)) onConfirm(res)
      } catch {
        setResult(null)
        setFeedback({ ok: false, message: "네트워크 오류로 조회하지 못했습니다. 연결을 확인한 뒤 다시 스캔해 주세요." })
      } finally {
        inFlight.current = false
      }
    },
    [allowUnusable, context, continuous, onConfirm],
  )

  const close = (next: boolean) => {
    if (!next) {
      setResult(null)
      setFeedback(null)
    }
    onOpenChange(next)
  }

  const canConfirm = Boolean(result && (result.usable || allowUnusable))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[20px]">
            <ScanLine className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>

        {/* open 이 false 면 언마운트되어 카메라 스트림이 정지된다 */}
        {open && (
          <CameraQrScanner
            onDecoded={handleDecoded}
            continuous={continuous}
            feedback={feedback}
            autoStart
          />
        )}

        {result && (
          <div
            className={`rounded-lg border p-4 text-[15px] ${
              result.usable || allowUnusable ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
            }`}
          >
            <p className="text-[13px] text-muted-foreground">{result.lot.item.code}</p>
            <p className="text-[18px] font-semibold">{result.lot.item.name}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px]">
              <dt className="text-muted-foreground">LOT</dt>
              <dd className="font-mono font-medium">{result.lot.lotNo}</dd>
              <dt className="text-muted-foreground">상태</dt>
              <dd className="font-medium">{STATUS_LABEL[result.lot.status] ?? result.lot.status}</dd>
              <dt className="text-muted-foreground">가용수량</dt>
              <dd className="font-medium">
                {result.lot.qtyAvailable.toLocaleString()} {result.lot.item.uom}
              </dd>
              {result.lot.balances.length > 0 && (
                <>
                  <dt className="text-muted-foreground">창고</dt>
                  <dd>
                    {result.lot.balances
                      .map((b) => `${b.warehouseName ?? b.warehouseCode ?? "-"}(${b.qtyAvailable.toLocaleString()})`)
                      .join(", ")}
                  </dd>
                </>
              )}
            </dl>
            {!result.usable && result.blockReason && (
              <p className="mt-2 text-[14px] font-medium text-red-700">{result.blockReason}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" className="h-11 text-[15px]" onClick={() => close(false)}>
            닫기
          </Button>
          <Button
            type="button"
            className="h-11 text-[15px]"
            disabled={!canConfirm}
            onClick={() => {
              if (result) {
                onConfirm(result)
                close(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
