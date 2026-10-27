"use client"

import { useEffect, useRef, useState } from "react"
import { ScanLine, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QrScannerDialog } from "@/components/common/qr-scanner/qr-scanner-dialog"
import type { QrDecoderMode } from "@/components/common/qr-scanner/qr-decoder"
import type { QrScanResult } from "@/lib/qr/qr-scan-result"
import { lookupWipForPop, type PopWipLookupResult } from "@/lib/actions/pop-wip-lookup.actions"

/** QR 스캔 기능 전체를 끄는 스위치(.env: NEXT_PUBLIC_QR_SCAN_DISABLED=true). 꺼도 기존 POP 업무에는 영향이 없다. */
const QR_DISABLED = process.env.NEXT_PUBLIC_QR_SCAN_DISABLED === "true"

type Tone = "info" | "success" | "error"
type Message = { tone: Tone; text: string }

export type PopWipFound = Extract<PopWipLookupResult, { ok: true }>

/** 관리자 웹 작업대기(admin)와 현장 태블릿 POP(field)의 표시 크기·다음 행동 안내만 다르다. 조회·판정·동작은 같다. */
export type PopWipQrVariant = "admin" | "field"

export interface PopWipQrScanProps {
  /** 이 화면의 작업지시 목록에 있는 작업지시 ID 들. 목록에 없으면 표시할 수 없다고 안내한다(이 화면에서 선택할 수 있는 작업지시만 인정). */
  workOrderIdsInList: ReadonlySet<string>
  /** QR 로 지금 표시 중인 작업지시(없으면 null) */
  selected: PopWipFound | null
  /** 서버가 확인한 WIP 의 작업지시를 목록에 표시한다. 작업을 시작하거나 공정을 바꾸거나 화면을 이동하지 않는다. */
  onSelect: (found: PopWipFound) => void
  /** QR 검색 해제(전체 목록으로 복귀) */
  onClear: () => void
  /** 서버 조회 함수(기본: 읽기 전용 서버 액션). 점검 화면/테스트에서 가짜를 주입한다. */
  lookup?: (input: { wipUnitId: string }) => Promise<PopWipLookupResult>
  /** 디코더 강제 선택(테스트·진단) */
  decoderMode?: QrDecoderMode
  variant?: PopWipQrVariant
}

const TONE_CLASS: Record<Tone, string> = {
  info: "bg-blue-50 text-blue-900",
  success: "bg-green-50 text-green-900",
  error: "bg-amber-50 text-amber-900",
}

// 클래스는 Tailwind 가 소스에서 그대로 찾을 수 있도록 리터럴로 적는다.
const VARIANT_CLASS: Record<PopWipQrVariant, { button: string; chip: string; message: string; clear: string }> = {
  admin: {
    button: "h-11 gap-2 px-4 text-[15px]",
    chip: "text-[14px]",
    message: "text-[14px]",
    clear: "h-8 gap-1 px-2 text-[14px]",
  },
  // 현장 태블릿: 장갑을 끼고도 누를 수 있는 큰 버튼과 큰 글씨
  field: {
    button: "h-14 gap-2 px-6 text-[18px]",
    chip: "text-[17px]",
    message: "text-[17px]",
    clear: "h-11 gap-1 px-3 text-[16px]",
  },
}

const NEXT_STEP_HINT: Record<PopWipQrVariant, string> = {
  admin: "공정을 확인한 뒤 [작업시작] 또는 [실적등록]을 직접 눌러 주세요.",
  field: "표시된 작업지시 카드를 직접 눌러 작업 화면으로 이동해 주세요.",
}

/**
 * POP 의 [WIP QR 스캔] 버튼 + 결과 안내 (관리자 작업대기 / 현장 태블릿 작업지시 선택 공용).
 *
 * 흐름: 버튼 → 공통 카메라 QR 스캐너(검증된 LOT/WIP QR 만 전달) → LOT QR 거부 → 서버 읽기 전용 조회(lookupWipForPop)
 *       → 그 WIP 의 작업지시가 이 화면의 목록에 있으면 목록에 그 작업지시만 표시.
 * 작업자는 표시된 작업지시를 기존 방식으로 직접 선택·진행해야 한다 — 이 컴포넌트는 어떤 업무 처리도 호출하지 않고 화면도 이동하지 않는다.
 * 카메라가 없거나 인식에 실패해도 기존 목록·검색·수동 선택은 그대로 쓸 수 있다.
 */
export function PopWipQrScan({ workOrderIdsInList, selected, onSelect, onClear, lookup = lookupWipForPop, decoderMode, variant = "admin" }: PopWipQrScanProps) {
  const [scannerOpen, setScannerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  // 조회(await)가 끝난 시점의 최신 목록을 쓰기 위해 ref 로 보관한다
  const latestRef = useRef({ workOrderIdsInList, onSelect })
  latestRef.current = { workOrderIdsInList, onSelect }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const say = (tone: Tone, text: string) => {
    if (mountedRef.current) setMessage({ tone, text })
  }

  async function handleScan(result: QrScanResult) {
    // 조회 중 중복 요청 방지(연속 스캔)
    if (busyRef.current) return
    if (result.kind !== "WIP") {
      say("error", "LOT QR 은 POP 작업지시 선택에 사용할 수 없습니다. 공정·재공(WIP) 라벨의 QR 을 스캔해 주세요.")
      return
    }
    busyRef.current = true
    setBusy(true)
    say("info", "WIP 를 조회하는 중입니다…")
    try {
      const found = await lookup({ wipUnitId: result.id })
      if (!found.ok) {
        say("error", found.message)
        return
      }
      if (!latestRef.current.workOrderIdsInList.has(found.workOrderId)) {
        say("error", `작업지시 ${found.orderNo} 가 현재 작업 목록에 없습니다. 화면을 새로고침한 뒤 다시 시도하거나 목록에서 직접 선택해 주세요.`)
        return
      }
      latestRef.current.onSelect(found)
      say("success", `작업지시 ${found.orderNo} 를 목록에 표시했습니다. ${NEXT_STEP_HINT[variant]} QR 스캔만으로는 작업이 시작되지 않습니다.${found.notice ? ` ${found.notice}` : ""}`)
    } catch (error) {
      console.error("WIP QR 조회 실패:", error)
      say("error", "WIP 를 조회하지 못했습니다. 잠시 후 다시 시도하거나 목록에서 직접 선택해 주세요.")
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }

  if (QR_DISABLED) return null

  const css = VARIANT_CLASS[variant]
  return (
    <div className="space-y-2" data-testid="pop-wip-qr-section">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className={css.button} onClick={() => setScannerOpen(true)} disabled={busy} data-testid="pop-wip-qr-button">
          <ScanLine className="h-4 w-4" />
          {busy ? "조회 중…" : "WIP QR 스캔"}
        </Button>
        {selected && (
          <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900 ${css.chip}`} data-testid="pop-wip-qr-selected">
            <span className="font-mono font-semibold">{selected.orderNo}</span>
            <span>
              [{selected.itemCode}] {selected.itemName}
            </span>
            {selected.manufacturingNo && <span className="font-mono">제조번호 {selected.manufacturingNo}</span>}
            <span>
              WIP {selected.wipStatusLabel}
              {selected.operationLabel ? ` · ${selected.operationLabel}` : ""}
            </span>
            <Button type="button" variant="ghost" size="sm" className={css.clear} onClick={onClear} data-testid="pop-wip-qr-clear">
              <X className="h-4 w-4" />
              QR 검색 해제
            </Button>
          </div>
        )}
      </div>

      {message && (
        <p className={`rounded-md p-3 leading-relaxed ${css.message} ${TONE_CLASS[message.tone]}`} role={message.tone === "error" ? "alert" : "status"} data-testid="pop-wip-qr-message" data-tone={message.tone}>
          {message.text}
        </p>
      )}

      <QrScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(result) => void handleScan(result)}
        title="WIP QR 스캔"
        description="공정·재공(WIP) 라벨의 QR 코드를 카메라에 비춰 주세요. 카메라를 쓸 수 없으면 닫고 목록에서 직접 선택하세요."
        decoderMode={decoderMode}
      />
    </div>
  )
}
