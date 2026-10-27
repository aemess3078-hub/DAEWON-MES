"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { QrScanResult } from "@/lib/qr/qr-scan-result"
import { QrScannerView } from "./qr-scanner-view"
import type { QrDecoderMode } from "./qr-decoder"

export interface QrScannerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 검증을 통과한 스캔 결과(성공 1회). */
  onScan: (result: QrScanResult) => void
  title?: string
  description?: string
  /** true(기본)면 스캔 성공 직후 창을 닫는다(카메라는 이미 종료됨). */
  closeOnScan?: boolean
  decoderMode?: QrDecoderMode
}

/**
 * 레이아웃 규칙(서로 겹치지 않는 두 조건)
 *  - FULL: 폭 639px 이하(스마트폰·세로 태블릿) 또는 높이 520px 이하(가로로 눕힌 스마트폰/태블릿) → 전체 화면
 *  - DESK: 폭 640px 이상이면서 높이 521px 이상 → 중앙 대화상자
 * 전체 화면에서 기본 grid 는 남는 높이를 행 사이로 늘려 버튼이 찌그러지므로 위에서부터 쌓는 flex column 으로 바꾼다.
 */
// 클래스는 Tailwind 가 소스에서 그대로 찾을 수 있도록 전부 리터럴로 적는다(템플릿 보간 금지).
// 전체 화면 조건은 두 가지를 같은 값으로 각각 적는다: 폭 639px 이하(max-sm:) / 높이 520px 이하(가로로 눕힌 기기).
const CONTENT_CLASS = [
  "max-w-none gap-3 overflow-y-auto",
  "max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:p-3 max-sm:flex max-sm:flex-col max-sm:justify-start max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-top-0 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-top-0",
  "[@media(max-height:520px)]:left-0 [@media(max-height:520px)]:top-0 [@media(max-height:520px)]:h-[100dvh] [@media(max-height:520px)]:max-h-[100dvh] [@media(max-height:520px)]:w-screen [@media(max-height:520px)]:translate-x-0 [@media(max-height:520px)]:translate-y-0 [@media(max-height:520px)]:rounded-none [@media(max-height:520px)]:p-3 [@media(max-height:520px)]:flex [@media(max-height:520px)]:flex-col [@media(max-height:520px)]:justify-start [@media(max-height:520px)]:data-[state=open]:slide-in-from-left-0 [@media(max-height:520px)]:data-[state=open]:slide-in-from-top-0 [@media(max-height:520px)]:data-[state=closed]:slide-out-to-left-0 [@media(max-height:520px)]:data-[state=closed]:slide-out-to-top-0",
  "[@media(min-width:640px)_and_(min-height:521px)]:max-h-[92dvh] [@media(min-width:640px)_and_(min-height:521px)]:max-w-xl",
].join(" ")

/**
 * 공통 카메라 QR 스캐너 대화상자. 열릴 때만 스캐너를 마운트하므로 닫으면(또는 화면 이동/언마운트) 카메라가 해제된다.
 * 업무 화면은 onScan 에서 스캔 결과를 받아 서버 조회·업무 처리를 직접 한다(이 컴포넌트는 하지 않는다).
 */
export function QrScannerDialog({ open, onOpenChange, onScan, title = "QR 스캔", description = "라벨의 QR 코드를 카메라에 비춰 주세요.", closeOnScan = true, decoderMode }: QrScannerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-[14px] [@media(max-height:520px)]:sr-only">{description}</DialogDescription>
        </DialogHeader>
        {open && (
          <QrScannerView
            decoderMode={decoderMode}
            onScan={(result) => {
              onScan(result)
              if (closeOnScan) onOpenChange(false)
            }}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
