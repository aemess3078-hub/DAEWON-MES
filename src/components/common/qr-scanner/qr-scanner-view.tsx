"use client"

import { useEffect } from "react"
import { Camera, CameraOff, RefreshCw, ScanLine, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { QrScanResult } from "@/lib/qr/qr-scan-result"
import { useQrCameraScanner } from "./use-qr-camera-scanner"
import type { QrDecoderMode } from "./qr-decoder"

/* 가로 방향 + 낮은 화면(스마트폰/태블릿 가로)용 변형: [@media(orientation:landscape)_and_(max-height:520px)]
 * Tailwind 가 클래스를 찾을 수 있도록 아래 JSX 에 클래스 전체를 리터럴로 적는다(템플릿 보간 금지). */
export interface QrScannerViewProps {
  /** 검증을 통과한 스캔 결과(성공 1회). 카메라는 이미 종료된 상태로 호출된다. */
  onScan: (result: QrScanResult) => void
  /** [닫기] 버튼. 지정하지 않으면 닫기 버튼을 표시하지 않는다. */
  onClose?: () => void
  /** 마운트 즉시 카메라 시작(기본 true). 사용자가 연 화면(버튼 클릭 뒤)에서 쓴다. false 면 [카메라 시작] 버튼을 누를 때 시작. */
  autoStart?: boolean
  /** 디코더 강제 선택(테스트·진단). 기본 auto(BarcodeDetector → jsQR 폴백). */
  decoderMode?: QrDecoderMode
  className?: string
}

/**
 * 공통 카메라 QR 스캐너 화면(인라인). 카메라 영상 + 스캔 영역 표시 + 카메라 선택 + 상태/오류 안내.
 * DB 조회·업무 처리는 하지 않는다 — 인식된 QR 은 onScan 으로 전달만 한다. 언마운트하면 카메라가 해제된다.
 */
export function QrScannerView({ onScan, onClose, autoStart = true, decoderMode, className }: QrScannerViewProps) {
  const scanner = useQrCameraScanner({ onScan, decoderMode })
  const { status, error, invalidMessage, hint, devices, activeDeviceId, decoderKind } = scanner

  useEffect(() => {
    if (autoStart) void scanner.start()
    // 마운트 시 한 번만 시작한다(스캐너 훅의 start 는 안정적이지만 deps 에 넣으면 재시작될 수 있다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showVideo = status === "scanning" || status === "starting"
  const startLabel = status === "error" ? "다시 시도" : status === "success" ? "다시 스캔" : "카메라 시작"

  return (
    <div
      className={`flex w-full flex-col gap-3 [@media(orientation:landscape)_and_(max-height:520px)]:flex-row ${className ?? ""}`}
      data-testid="qr-scanner-view"
      data-status={status}
      data-decoder={decoderKind ?? ""}
      data-devices={devices.length}
    >
      {/* 카메라 영상 — 비율 유지(object-cover: 늘어남 없이 채움), 가로/세로 화면 모두 화면 안에 들어오도록 높이 제한 */}
      <div
        className={`relative aspect-[4/3] max-h-[52dvh] w-full shrink-0 overflow-hidden rounded-lg bg-black [@media(orientation:landscape)_and_(max-height:520px)]:h-[calc(100dvh-4.5rem)] [@media(orientation:landscape)_and_(max-height:520px)]:max-h-none [@media(orientation:landscape)_and_(max-height:520px)]:w-auto [@media(orientation:landscape)_and_(max-height:520px)]:max-w-[58%]`}
      >
        <video
          ref={scanner.videoRef}
          data-testid="qr-scanner-video"
          className={`h-full w-full object-cover ${showVideo ? "" : "invisible"}`}
          autoPlay
          muted
          playsInline
        />
        {status === "scanning" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            {/* 스캔 영역: 가운데 정사각형(바깥은 어둡게) + 모서리 표시 */}
            <div className="relative aspect-square w-[62%] max-w-[260px] rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-lg border-l-4 border-t-4 border-white" />
              <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-lg border-r-4 border-t-4 border-white" />
              <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-lg border-b-4 border-l-4 border-white" />
              <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-lg border-b-4 border-r-4 border-white" />
              <ScanLine className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/60" />
            </div>
          </div>
        )}
        {!showVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[15px] text-white/80">
            {status === "error" ? <CameraOff className="h-8 w-8" /> : <Camera className="h-8 w-8" />}
            <span>{status === "success" ? "QR 을 인식했습니다." : status === "error" ? "카메라를 사용할 수 없습니다." : "카메라가 꺼져 있습니다."}</span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* 상태 안내(스크린리더용 aria-live) */}
        <p className="text-[15px] font-medium text-foreground" role="status" aria-live="polite" data-testid="qr-scanner-status">
          {status === "starting" && "카메라를 시작하는 중입니다. 권한 요청이 나오면 [허용]을 눌러 주세요."}
          {status === "scanning" && "QR 코드를 사각형 안에 맞춰 주세요."}
          {status === "success" && "QR 인식 완료 — 카메라를 종료했습니다."}
          {status === "idle" && "카메라가 꺼져 있습니다. [카메라 시작]을 눌러 주세요."}
          {status === "error" && "카메라를 시작하지 못했습니다."}
        </p>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-[14px] leading-relaxed text-red-900" role="alert" data-testid="qr-scanner-error" data-code={error.code}>
            {error.message}
          </p>
        )}
        {invalidMessage && (
          <p className="rounded-md bg-amber-50 p-3 text-[14px] leading-relaxed text-amber-900" role="alert" data-testid="qr-scanner-invalid">
            {invalidMessage}
          </p>
        )}
        {hint && !error && (
          <p className="rounded-md bg-blue-50 p-3 text-[14px] leading-relaxed text-blue-900" data-testid="qr-scanner-hint">
            {hint}
          </p>
        )}

        {devices.length > 1 && (
          <label className="flex flex-col gap-1 text-[13px] font-medium text-muted-foreground">
            카메라 선택
            <select
              data-testid="qr-scanner-camera-select"
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-[15px] text-foreground"
              value={activeDeviceId ?? ""}
              onChange={(e) => void scanner.selectDevice(e.target.value)}
              disabled={status === "starting"}
            >
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `카메라 ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-auto flex flex-col gap-2 sm:flex-row">
          {(status === "idle" || status === "error" || status === "success") && (
            <Button type="button" size="lg" className="h-12 min-h-12 shrink-0 flex-1 gap-2 text-[15px]" onClick={() => void scanner.start()} data-testid="qr-scanner-start">
              <RefreshCw className="h-4 w-4" />
              {startLabel}
            </Button>
          )}
          {onClose && (
            <Button type="button" size="lg" variant="outline" className="h-12 min-h-12 shrink-0 flex-1 gap-2 text-[15px]" onClick={onClose} data-testid="qr-scanner-close">
              <X className="h-4 w-4" />
              닫기
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
