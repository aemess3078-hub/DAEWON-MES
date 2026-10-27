"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrScannerDialog } from "@/components/common/qr-scanner/qr-scanner-dialog"
import type { QrDecoderMode } from "@/components/common/qr-scanner/qr-decoder"
import type { QrScanResult } from "@/lib/qr/qr-scan-result"
import { lookupLotForMaterialIssue, type IssueLotLookupResult } from "@/lib/actions/material-issue-lot-lookup.actions"
import type { LotStockOption } from "@/lib/actions/material-issue.actions"
import { checkScanTarget, type ApplyScannedLotOutcome, type ScanTargetMaterial } from "@/lib/material-issue/lot-scan"
import { formatQuantity } from "@/lib/utils"

/** QR 스캔 기능 전체를 끄는 스위치(.env: NEXT_PUBLIC_QR_SCAN_DISABLED=true). 꺼도 기존 수동 LOT 선택 업무에는 영향이 없다. */
const QR_DISABLED = process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"

type Tone = "info" | "success" | "error"
type Message = { tone: Tone; text: string }

export interface LotQrScanSectionProps {
  workOrderId: string
  /** 작업지시의 전체 자재(필요수량을 모두 출고한 자재 포함). 서버가 확인한 품목이 이 화면에서 선택 가능한지 판단한다. */
  materials: ScanTargetMaterial[]
  /** 스캔 선택을 막는 상태(출고 처리 중, 출고 확정 후 등) */
  disabled?: boolean
  /** 목록 제목(기존 "출고 자재 목록") — 버튼은 제목 오른쪽에 둔다. */
  title: ReactNode
  /**
   * 서버가 확인한 LOT 재고 1건을 화면의 LOT 선택(분할 행)에 반영한다. 반영 결과를 돌려준다.
   * 반영은 "LOT 선택"뿐이다 — 출고 수량은 정하지 않는다.
   */
  onSelectLot: (itemId: string, option: LotStockOption) => ApplyScannedLotOutcome
  /** 이 LOT 가 이미 선택되어 있는지(창고 무관). 창고 선택 목록을 띄우기 전에 중복을 알려 준다. */
  isLotSelected?: (itemId: string, lotId: string) => boolean
  /** 서버 조회 함수(기본: 읽기 전용 서버 액션). 점검 화면/테스트에서 가짜를 주입한다. */
  lookup?: (input: { workOrderId: string; lotNo: string }) => Promise<IssueLotLookupResult>
  /** 디코더 강제 선택(테스트·진단) */
  decoderMode?: QrDecoderMode
}

const TONE_CLASS: Record<Tone, string> = {
  info: "bg-blue-50 text-blue-900",
  success: "bg-green-50 text-green-900",
  error: "bg-amber-50 text-amber-900",
}

/**
 * 자재출고 화면의 [QR 스캔] 버튼 + 결과 안내.
 *
 * 흐름: 버튼 → 공통 카메라 QR 스캐너(검증된 LOT/WIP QR 만 전달) → WIP QR 거부 → 서버 읽기 전용 조회(lookupLotForMaterialIssue)
 *       → 화면의 자재 목록에서 선택 가능한 자재인지 확인 → 창고 후보 1건이면 바로, 여러 건이면 사용자가 선택 → 기존 LOT 선택 행에 반영.
 * 이 컴포넌트는 재고/예약/WIP/작업지시를 바꾸지 않고 출고도 실행하지 않는다. 실패해도 기존 입력값과 수동 선택은 그대로다.
 */
export function LotQrScanSection({ workOrderId, materials, disabled = false, title, onSelectLot, isLotSelected, lookup = lookupLotForMaterialIssue, decoderMode }: LotQrScanSectionProps) {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [choice, setChoice] = useState<Extract<IssueLotLookupResult, { ok: true }> | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  // 조회(await)가 끝난 시점의 최신 화면 상태를 쓰기 위해 props 를 ref 로 보관한다(조회 중 사용자가 입력을 바꿔도 오래된 값으로 덮어쓰지 않음)
  const latestRef = useRef({ materials, onSelectLot, isLotSelected })
  latestRef.current = { materials, onSelectLot, isLotSelected }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const say = (tone: Tone, text: string) => {
    if (mountedRef.current) setMessage({ tone, text })
  }

  function describe(found: Extract<IssueLotLookupResult, { ok: true }>, option: LotStockOption): string {
    return `[${found.itemCode}] ${found.itemName} — LOT ${found.lotNo} · ${option.warehouseName} · 가용 ${formatQuantity(option.qtyAvailable)} ${option.unit}`
  }

  function apply(found: Extract<IssueLotLookupResult, { ok: true }>, option: LotStockOption) {
    const outcome = latestRef.current.onSelectLot(found.itemId, option)
    if (outcome === "ALREADY_SELECTED") {
      say("info", `이미 선택된 LOT 입니다. ${describe(found, option)}`)
    } else {
      say("success", `선택했습니다: ${describe(found, option)}. 출고 수량을 확인·입력한 뒤 [출고 처리]를 눌러 주세요.`)
    }
  }

  async function handleScan(result: QrScanResult) {
    // 조회 중 중복 요청 방지(연속 스캔)
    if (busyRef.current) return
    if (result.kind !== "LOT") {
      say("error", "WIP QR 은 원자재 출고 화면에서 사용할 수 없습니다. 원자재 LOT 라벨의 QR 을 스캔해 주세요.")
      return
    }
    busyRef.current = true
    setBusy(true)
    setChoice(null)
    say("info", `LOT ${result.id} 를 조회하는 중입니다…`)
    try {
      const found = await lookup({ workOrderId, lotNo: result.id })
      if (!found.ok) {
        say("error", found.message)
        return
      }
      const target = checkScanTarget(latestRef.current.materials, found.itemId)
      if (!target.ok) {
        say("error", `[${found.itemCode}] ${found.itemName} — ${target.message}`)
        return
      }
      if (latestRef.current.isLotSelected?.(found.itemId, found.lotId)) {
        say("info", `이미 선택된 LOT 입니다. [${found.itemCode}] ${found.itemName} — LOT ${found.lotNo}`)
        return
      }
      if (found.options.length === 1) {
        apply(found, found.options[0])
      } else {
        // 같은 LOT 가 여러 창고에 있어 하나로 정할 수 없다 → 사용자가 선택(임의 선택 금지)
        if (mountedRef.current) setChoice(found)
        say("info", `LOT ${found.lotNo} 가 여러 창고에 있습니다. 출고할 창고를 선택해 주세요.`)
      }
    } catch (error) {
      console.error("LOT QR 조회 실패:", error)
      say("error", "LOT 를 조회하지 못했습니다. 잠시 후 다시 시도하거나 목록에서 직접 선택해 주세요.")
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="issue-qr-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[14px] font-medium">{title}</div>
        {!QR_DISABLED && (
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 px-4 text-[14px]"
            onClick={() => setScannerOpen(true)}
            disabled={disabled || busy}
            data-testid="issue-qr-scan-button"
          >
            <ScanLine className="h-4 w-4" />
            {busy ? "조회 중…" : "QR 스캔"}
          </Button>
        )}
      </div>

      {message && (
        <p className={`rounded-md p-3 text-[14px] leading-relaxed ${TONE_CLASS[message.tone]}`} role={message.tone === "error" ? "alert" : "status"} data-testid="issue-qr-message" data-tone={message.tone}>
          {message.text}
        </p>
      )}

      {choice && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3" data-testid="issue-qr-choice">
          <p className="text-[14px] font-medium">
            [{choice.itemCode}] {choice.itemName} · LOT {choice.lotNo}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {choice.options.map((option) => (
              <Button
                key={`${option.lotId}:${option.warehouseId}`}
                type="button"
                variant="outline"
                className="h-11 justify-start text-[14px]"
                data-testid="issue-qr-choice-option"
                onClick={() => {
                  apply(choice, option)
                  setChoice(null)
                }}
              >
                [{option.warehouseCode}] {option.warehouseName} · 가용 {formatQuantity(option.qtyAvailable)} {option.unit}
              </Button>
            ))}
            <Button type="button" variant="ghost" className="h-11 text-[14px]" onClick={() => setChoice(null)} data-testid="issue-qr-choice-cancel">
              선택 취소
            </Button>
          </div>
        </div>
      )}

      {!QR_DISABLED && (
        <QrScannerDialog
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onScan={(result) => void handleScan(result)}
          title="원자재 LOT QR 스캔"
          description="원자재 LOT 라벨의 QR 코드를 카메라에 비춰 주세요. 카메라를 쓸 수 없으면 닫고 목록에서 직접 선택하세요."
          decoderMode={decoderMode}
        />
      )}
    </div>
  )
}
