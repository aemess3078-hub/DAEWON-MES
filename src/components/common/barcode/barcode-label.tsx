"use client"

import { useEffect, useRef, useState } from "react"
import JsBarcode from "jsbarcode"
import QRCode from "qrcode"
import { encodeLotQr } from "@/lib/qr/lot-qr"

interface BarcodeLabelProps {
  itemCode: string
  itemName: string
  lotId?: string
  /**
   * LOT 번호. 지정하면 LOT QR(DAEWON|LOT|1|<lotNo>)을 출력한다(Phase 11).
   * QR 에는 LOT 식별자만 들어가며 수량·상태·품명 등 변하는 값은 사람이 읽는 텍스트로만 표시한다.
   */
  lotNo?: string | null
  quantity?: number
  uom?: string
  date?: string
  /** 날짜 라벨(입고일/생산일 등). 기본 "일자". */
  dateLabel?: string
  companyName?: string
  /** 재출력 라벨 표시(LOT 번호/QR 은 최초 출력과 동일하다). */
  reprint?: boolean
  className?: string
}

/**
 * 라벨 규격은 코드에 고정하지 않는다 — CSS 변수(mm)로 조정한다. (실제 프린터/용지 확정은 FIELD_TEST_REQUIRED)
 *   --label-width   (기본 62mm)
 *   --label-qr-size (기본 22mm)
 */
export function BarcodeLabel({
  itemCode,
  itemName,
  lotId,
  lotNo,
  quantity,
  uom,
  date,
  dateLabel = "일자",
  companyName = "대원정밀",
  reprint = false,
  className,
}: BarcodeLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const trimmedLotNo = lotNo?.trim() || null
  const useQr = Boolean(trimmedLotNo)
  // 레거시(비LOT 품목): 품목코드 CODE128 유지
  const barcodeValue = lotId ? `${itemCode}|${lotId}` : itemCode

  const qrPayload = (() => {
    if (!trimmedLotNo) return null
    try {
      return encodeLotQr(trimmedLotNo)
    } catch {
      return null
    }
  })()

  useEffect(() => {
    if (!qrPayload) {
      setQrUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", margin: 1, width: 320 })
      .then((url) => {
        if (!cancelled) setQrUrl(url)
      })
      .catch((e) => console.error("QR 생성 오류:", e))
    return () => {
      cancelled = true
    }
  }, [qrPayload])

  useEffect(() => {
    if (useQr || !svgRef.current) return
    try {
      JsBarcode(svgRef.current, barcodeValue, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: false,
        margin: 0,
      })
    } catch (e) {
      console.error("바코드 생성 오류:", e)
    }
  }, [barcodeValue, useQr])

  return (
    <div
      className={`select-none rounded-md border bg-white p-3 text-center ${className ?? ""}`}
      style={{ width: "var(--label-width, 62mm)", breakInside: "avoid" }}
    >
      <p className="flex items-center justify-between text-[12px] font-semibold text-gray-700">
        <span>{companyName}</span>
        {reprint && <span className="rounded border border-gray-400 px-1 text-[11px]">재출력</span>}
      </p>
      <p className="mt-1 line-clamp-2 text-[14px] font-bold leading-tight text-gray-900">{itemName}</p>
      <p className="mb-1 text-[12px] text-gray-600">{itemCode}</p>

      {useQr ? (
        <div className="flex items-center justify-center">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrUrl}
              alt={`LOT QR ${trimmedLotNo}`}
              style={{ width: "var(--label-qr-size, 22mm)", height: "var(--label-qr-size, 22mm)" }}
            />
          ) : (
            <div style={{ width: "var(--label-qr-size, 22mm)", height: "var(--label-qr-size, 22mm)" }} />
          )}
        </div>
      ) : (
        <>
          <svg ref={svgRef} className="w-full" />
          <p className="mt-0.5 font-mono text-[11px] text-gray-500">{barcodeValue}</p>
        </>
      )}

      <div className="mt-1.5 space-y-0.5 border-t border-gray-200 pt-1.5 text-[12px] text-gray-700">
        {trimmedLotNo && (
          <p>
            LOT <span className="font-mono text-[14px] font-bold">{trimmedLotNo}</span>
          </p>
        )}
        {!trimmedLotNo && lotId && (
          <p>
            LOT <span className="font-mono font-medium">{lotId}</span>
          </p>
        )}
        <p className="flex flex-wrap justify-center gap-x-3">
          {quantity !== undefined && (
            <span>
              수량 <span className="font-semibold">{quantity.toLocaleString()} {uom}</span>
            </span>
          )}
          {date && (
            <span>
              {dateLabel} {date}
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
