"use client"

import { useEffect, useRef, useState } from "react"
import { ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrScannerDialog } from "@/components/common/qr-scanner/qr-scanner-dialog"
import type { QrDecoderMode } from "@/components/common/qr-scanner/qr-decoder"
import type { QrScanResult } from "@/lib/qr/qr-scan-result"
import { lookupLotForShipment, type ShipmentLotLookupResult } from "@/lib/actions/shipment-lot-lookup.actions"
import type { AvailableFinishedGoodsLot } from "@/lib/actions/shipment.actions"
import type { ScannedLotPlan } from "@/lib/shipment/fg-lot-scan"
import { formatQuantity } from "@/lib/utils"

/** QR 스캔 기능 전체를 끄는 스위치(.env: NEXT_PUBLIC_QR_SCAN_DISABLED=true). 꺼도 기존 수동 LOT 선택 업무에는 영향이 없다. */
const QR_DISABLED = process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"

type Tone = "info" | "success" | "error"
type Message = { tone: Tone; text: string }

export interface FgLotQrScanProps {
  /** 이 행의 출하 품목(스캔한 LOT 의 품목이 이 품목과 같아야 한다) */
  itemId: string
  /** 화면에서 선택한 출하 창고(한 출하에는 하나의 창고만 쓴다) */
  warehouseId: string
  /** 스캔 선택을 막는 상태(창고 미선택, LOT 목록 조회 중, 등록 처리 중 등) */
  disabled?: boolean
  /** 화면이 지금 보여 주는 가용 LOT 목록에서 찾는다(수동 선택 상자와 같은 목록). 없으면 선택할 수 없다. */
  findLot: (lotId: string) => AvailableFinishedGoodsLot | undefined
  /** 이 LOT 가 이 품목 행에 이미 선택되어 있는지 */
  isLotSelected: (lotId: string) => boolean
  /**
   * 서버가 확인한 LOT 를 화면의 LOT 선택(분할 행)에 반영한다. 반영 결과를 돌려준다.
   * 반영은 "LOT 선택"뿐이다 — 출하 등록/확정은 하지 않는다.
   */
  onSelectLot: (lot: AvailableFinishedGoodsLot) => ScannedLotPlan["outcome"]
  /** 서버 조회 함수(기본: 읽기 전용 서버 액션). 점검 화면/테스트에서 가짜를 주입한다. */
  lookup?: (input: { warehouseId: string; itemId: string; lotNo: string }) => Promise<ShipmentLotLookupResult>
  /** 디코더 강제 선택(테스트·진단) */
  decoderMode?: QrDecoderMode
}

const TONE_CLASS: Record<Tone, string> = {
  info: "bg-blue-50 text-blue-900",
  success: "bg-green-50 text-green-900",
  error: "bg-amber-50 text-amber-900",
}

/**
 * 출하예정 등록 화면 품목 행의 [QR 스캔] 버튼 + 결과 안내.
 *
 * 흐름: 버튼 → 공통 카메라 QR 스캐너(검증된 LOT/WIP QR 만 전달) → WIP QR 거부 → 서버 읽기 전용 조회(lookupLotForShipment)
 *       → 화면의 가용 LOT 목록에 있는지 확인 → 기존 LOT 선택 행에 반영.
 * 이 컴포넌트는 재고/예약/출하/수주를 바꾸지 않고 출하 등록·확정도 실행하지 않는다. 실패해도 기존 입력값과 수동 선택은 그대로다.
 */
export function FgLotQrScan({ itemId, warehouseId, disabled = false, findLot, isLotSelected, onSelectLot, lookup = lookupLotForShipment, decoderMode }: FgLotQrScanProps) {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  // 조회(await)가 끝난 시점의 최신 화면 상태를 쓰기 위해 props 를 ref 로 보관한다(조회 중 사용자가 창고/입력을 바꿔도 오래된 값으로 덮어쓰지 않음)
  const latestRef = useRef({ itemId, warehouseId, findLot, isLotSelected, onSelectLot })
  latestRef.current = { itemId, warehouseId, findLot, isLotSelected, onSelectLot }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const say = (tone: Tone, text: string) => {
    if (mountedRef.current) setMessage({ tone, text })
  }

  function describe(lot: AvailableFinishedGoodsLot, found: { itemCode: string; itemName: string }): string {
    return `[${found.itemCode}] ${found.itemName} — LOT ${lot.lotNo} · ${lot.locationName ?? lot.warehouseName} · 가용 ${formatQuantity(lot.qtyAvailable)}`
  }

  async function handleScan(result: QrScanResult) {
    // 조회 중 중복 요청 방지(연속 스캔)
    if (busyRef.current) return
    if (result.kind !== "LOT") {
      say("error", "WIP QR 은 출하 화면에서 사용할 수 없습니다. 완제품 LOT 라벨의 QR 을 스캔해 주세요.")
      return
    }
    const requested = { itemId: latestRef.current.itemId, warehouseId: latestRef.current.warehouseId }
    if (!requested.warehouseId) {
      say("error", "먼저 출하 창고를 선택해 주세요.")
      return
    }
    busyRef.current = true
    setBusy(true)
    say("info", `LOT ${result.id} 를 조회하는 중입니다…`)
    try {
      const found = await lookup({ warehouseId: requested.warehouseId, itemId: requested.itemId, lotNo: result.id })
      if (!found.ok) {
        say("error", found.message)
        return
      }
      const latest = latestRef.current
      if (latest.warehouseId !== requested.warehouseId || latest.itemId !== requested.itemId) {
        say("error", "조회 중에 출하 창고 또는 품목이 바뀌어 결과를 반영하지 않았습니다. 다시 스캔해 주세요.")
        return
      }
      if (found.itemId !== latest.itemId) {
        say("error", `[${found.itemCode}] ${found.itemName} — 이 출하 품목과 다른 품목의 LOT 입니다.`)
        return
      }
      if (latest.isLotSelected(found.lotId)) {
        say("info", `이미 선택된 LOT 입니다. [${found.itemCode}] ${found.itemName} — LOT ${found.lotNo}`)
        return
      }
      const lot = latest.findLot(found.lotId)
      if (!lot) {
        say("error", `LOT ${found.lotNo} 가 현재 화면의 가용 LOT 목록에 없습니다. 출하 창고를 다시 선택해 목록을 새로 불러온 뒤 다시 스캔하거나 목록에서 직접 선택해 주세요.`)
        return
      }
      const outcome = latest.onSelectLot(lot)
      if (outcome === "ALREADY_SELECTED") {
        say("info", `이미 선택된 LOT 입니다. ${describe(lot, found)}`)
      } else {
        say("success", `선택했습니다: ${describe(lot, found)}. 출하수량을 확인·입력한 뒤 [출하예정 등록]을 눌러 주세요. QR 스캔만으로는 출하가 등록·확정되지 않습니다.`)
      }
    } catch (error) {
      console.error("출하 LOT QR 조회 실패:", error)
      say("error", "LOT 를 조회하지 못했습니다. 잠시 후 다시 시도하거나 목록에서 직접 선택해 주세요.")
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  if (QR_DISABLED) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 text-[13px]"
        onClick={() => setScannerOpen(true)}
        disabled={disabled || busy || !warehouseId}
        data-testid="shipment-qr-scan-button"
      >
        <ScanLine className="h-3.5 w-3.5" />
        {busy ? "조회 중…" : "QR 스캔"}
      </Button>

      {message && (
        <p
          className={`w-full rounded-md p-3 text-[13px] leading-relaxed ${TONE_CLASS[message.tone]}`}
          role={message.tone === "error" ? "alert" : "status"}
          data-testid="shipment-qr-message"
          data-tone={message.tone}
        >
          {message.text}
        </p>
      )}

      <QrScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(result) => void handleScan(result)}
        title="완제품 LOT QR 스캔"
        description="완제품 LOT 라벨의 QR 코드를 카메라에 비춰 주세요. 카메라를 쓸 수 없으면 닫고 목록에서 직접 선택하세요."
        decoderMode={decoderMode}
      />
    </>
  )
}
