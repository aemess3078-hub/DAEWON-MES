"use client"

import { useRef, useState } from "react"
import { useReactToPrint } from "react-to-print"
import { Printer, Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { BarcodeLabel } from "./barcode-label"

interface BarcodePrintItem {
  itemCode: string
  itemName: string
  lotId?: string
  /** 사람이 읽는 LOT 번호 표시 전용 — 바코드 인코딩 값에는 영향을 주지 않는다. */
  lotNo?: string | null
  quantity?: number
  uom?: string
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
}

/**
 * 바코드 라벨 출력 다이얼로그
 * 한 번에 여러 라벨 출력 가능
 */
export function BarcodePrintDialog({
  open,
  onOpenChange,
  items,
  title = "바코드 라벨 출력",
  onBeforePrint,
}: BarcodePrintDialogProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `바코드_${today}`,
    pageStyle: `
      @page { size: auto; margin: 8mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `,
  })

  // 미리보기 창을 여는 시점이 아니라 실제 "인쇄" 버튼을 누른 시점에만 번호를 소모한다.
  // 브라우저/OS 인쇄창에서 사용자가 최종 취소했는지는 웹에서 판별할 수 없으므로,
  // 이 버튼 클릭 자체(이미 물리적 출력 가능성이 생긴 시점)를 기준으로 삼는다.
  async function handlePrintClick() {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      if (onBeforePrint) {
        const result = await onBeforePrint()
        if (!result.success) {
          alert(result.message)
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
          <DialogTitle className="text-[18px] font-semibold">{title}</DialogTitle>
          <p className="text-[13px] text-muted-foreground">
            총 {items.length}개 라벨 · 프린터로 출력하거나 저장할 수 있습니다
          </p>
        </DialogHeader>

        {/* 미리보기 영역 */}
        <div className="max-h-[60vh] overflow-y-auto">
          <div
            ref={printRef}
            className="flex flex-wrap gap-3 p-4 bg-gray-50 rounded-md"
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
              />
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button onClick={() => void handlePrintClick()} disabled={isPrinting}>
            <Printer className="h-4 w-4 mr-2" />
            {isPrinting ? "처리 중..." : "인쇄"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
