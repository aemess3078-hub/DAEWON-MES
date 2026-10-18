"use client"

import { useRef, useState } from "react"
import { useReactToPrint } from "react-to-print"
import { Printer } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BarcodeLabel } from "./barcode-label"
import { recordLotLabelPrint } from "@/lib/actions/lot-qr.actions"

interface BarcodePrintItem {
  itemCode: string
  itemName: string
  lotId?: string
  /** LOT 번호 — 지정하면 LOT QR 라벨로 출력되고, 출력 시 감사 기록(LABEL_PRINT/LABEL_REPRINT)이 남는다. */
  lotNo?: string | null
  quantity?: number
  uom?: string
  /** 입고일/생산일 문구 선택 */
  dateLabel?: string
}

interface BarcodePrintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: BarcodePrintItem[]
  title?: string
  /**
   * 실제 "인쇄" 버튼을 눌렀을 때 handlePrint 실행 전에 호출된다(다이얼로그를 여는 시점이 아님).
   * 실패하면 인쇄를 실행하지 않고 message를 사용자에게 보여준다.
   * 지정하지 않으면 기존처럼 바로 인쇄한다(예약이 필요 없는 비LOT/수동 LOT 라벨 등).
   */
  onBeforePrint?: () => Promise<{ success: true } | { success: false; message: string }>
  /** 재출력 모드: 사유 입력을 요구하고 라벨에 "재출력"을 표시한다. LOT 번호/QR 은 바뀌지 않는다. */
  reprint?: boolean
  /**
   * 지정하면 미리보기만 가능하고 실제 인쇄는 막는다(예: LOT 가 아직 DB 에 영속화되지 않은 입고 확정 전).
   * 서버(recordLotLabelPrint)도 Lot 행이 없으면 출력 기록을 거부한다 — 이 값은 UI 안내용 1차 게이트다.
   */
  printBlockedReason?: string
  /** 라벨 폭(mm). 기본 62mm. 실제 용지 규격은 현장 확인 후 조정(FIELD_TEST_REQUIRED). */
  labelWidthMm?: number
  qrSizeMm?: number
}

/**
 * 바코드/QR 라벨 출력 다이얼로그 (브라우저 인쇄 — 프린터 제조사 SDK 비종속)
 * 한 번에 여러 라벨 출력 가능
 */
export function BarcodePrintDialog({
  open,
  onOpenChange,
  items,
  title = "바코드 라벨 출력",
  onBeforePrint,
  reprint = false,
  printBlockedReason,
  labelWidthMm = 62,
  qrSizeMm = 22,
}: BarcodePrintDialogProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const [reason, setReason] = useState("")
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `바코드_${today}`,
    pageStyle: `
      @page { size: auto; margin: 4mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `,
  })

  // 미리보기 창을 여는 시점이 아니라 실제 "인쇄" 버튼을 누른 시점에만 번호를 소모하고 감사 기록을 남긴다.
  // 브라우저/OS 인쇄창에서 사용자가 최종 취소했는지는 웹에서 판별할 수 없으므로,
  // 이 버튼 클릭 자체(이미 물리적 출력 가능성이 생긴 시점)를 기준으로 삼는다.
  async function handlePrintClick() {
    if (isPrinting || printBlockedReason) return
    if (reprint && !reason.trim()) {
      alert("재출력 사유를 입력해 주세요.")
      return
    }
    setIsPrinting(true)
    try {
      if (onBeforePrint) {
        const result = await onBeforePrint()
        if (!result.success) {
          alert(result.message)
          return
        }
      }
      const lotNos = items.map((i) => i.lotNo?.trim()).filter((n): n is string => Boolean(n))
      if (lotNos.length > 0) {
        const audit = await recordLotLabelPrint({ lotNos, reason: reprint ? reason.trim() : undefined })
        if (!audit.ok) {
          alert(audit.message)
          return
        }
      }
      handlePrint()
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold">
            {title}
            {reprint ? " (재출력)" : ""}
          </DialogTitle>
          <p className="text-[13px] text-muted-foreground">
            총 {items.length}개 라벨 · 프린터로 출력하거나 저장할 수 있습니다
            {reprint ? " · 재출력해도 LOT 번호와 QR 은 변경되지 않습니다" : ""}
          </p>
        </DialogHeader>

        {printBlockedReason && (
          <p className="rounded-md bg-amber-50 p-3 text-[14px] text-amber-900">{printBlockedReason}</p>
        )}

        {reprint && (
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-muted-foreground" htmlFor="label-reprint-reason">
              재출력 사유
            </label>
            <Input
              id="label-reprint-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 라벨 훼손/오염, 부착 위치 변경"
              className="h-10 text-[14px]"
              maxLength={200}
            />
          </div>
        )}

        {/* 미리보기 영역 */}
        <div className="max-h-[60vh] overflow-y-auto">
          <div
            ref={printRef}
            className="flex flex-wrap gap-3 rounded-md bg-gray-50 p-4"
            style={
              {
                "--label-width": `${labelWidthMm}mm`,
                "--label-qr-size": `${qrSizeMm}mm`,
              } as React.CSSProperties
            }
          >
            {items.map((item, i) => (
              <BarcodeLabel
                key={i}
                itemCode={item.itemCode}
                itemName={item.itemName}
                lotId={item.lotId}
                lotNo={item.lotNo}
                quantity={item.quantity}
                uom={item.uom}
                date={today}
                dateLabel={item.dateLabel}
                reprint={reprint}
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button onClick={() => void handlePrintClick()} disabled={isPrinting || Boolean(printBlockedReason)}>
            <Printer className="mr-2 h-4 w-4" />
            {isPrinting ? "처리 중..." : reprint ? "재출력" : "인쇄"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
