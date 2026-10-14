"use client"

/**
 * 태블릿/PC 카메라 QR 스캐너 (Phase 11 / DG-005).
 *
 * - 후면 카메라 우선(facingMode: environment), 카메라 목록 선택, 시작/정지
 * - 디코더: 브라우저 BarcodeDetector(있으면) → 없으면 jsQR(동적 import) 폴백
 * - 같은 QR 연속 인식 디바운스(createScanDebouncer), 처리 중 재스캔 무시, 연속 스캔 옵션
 * - 수동 코드입력 폴백(카메라 없음/권한 거부/HTTP 환경)
 * - 정지/언마운트/탭 비활성 시 MediaStream track 을 반드시 stop 한다(카메라 LED 꺼짐)
 *
 * 이 컴포넌트는 "인식된 문자열"만 전달한다. 파싱은 lib/qr/lot-qr.ts, 검증은 서버 액션이 한다.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, CameraOff, CheckCircle2, Keyboard, RefreshCw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createScanDebouncer, DEFAULT_SCAN_DEBOUNCE_MS } from "@/lib/qr/scan-guard"

type DetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type DetectorCtor = {
  new (opts?: { formats?: string[] }): DetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

export type CameraScanFeedback = { ok: boolean; message: string } | null

export interface CameraQrScannerProps {
  /** 인식된 원문. Promise 를 반환하면 처리가 끝날 때까지 추가 스캔을 무시한다. */
  onDecoded: (raw: string) => void | Promise<void>
  /** true 면 성공 후에도 카메라를 유지한다(여러 LOT 연속 스캔). 기본 false(1건 인식 후 정지). */
  continuous?: boolean
  debounceMs?: number
  /** 마지막 처리 결과(성공/오류 문구)를 부모가 내려주면 카메라 아래에 표시한다. */
  feedback?: CameraScanFeedback
  autoStart?: boolean
  className?: string
}

const SCAN_INTERVAL_MS = 160
const MAX_DECODE_WIDTH = 720

export function CameraQrScanner({
  onDecoded,
  continuous = false,
  debounceMs = DEFAULT_SCAN_DEBOUNCE_MS,
  feedback = null,
  autoStart = false,
  className,
}: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const detectorRef = useRef<DetectorLike | null>(null)
  const jsQrRef = useRef<((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null>(null)
  const debouncerRef = useRef(createScanDebouncer(debounceMs))
  const onDecodedRef = useRef(onDecoded)
  const continuousRef = useRef(continuous)
  const decodingRef = useRef(false)

  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>("")
  const [manual, setManual] = useState("")
  const [flash, setFlash] = useState<"ok" | "fail" | null>(null)

  useEffect(() => {
    onDecodedRef.current = onDecoded
  }, [onDecoded])
  useEffect(() => {
    continuousRef.current = continuous
  }, [continuous])
  useEffect(() => {
    debouncerRef.current = createScanDebouncer(debounceMs)
  }, [debounceMs])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    const video = videoRef.current
    if (video) {
      try {
        video.pause()
      } catch {
        /* noop */
      }
      video.srcObject = null
    }
    setStatus("idle")
  }, [])

  const handleRaw = useCallback(
    async (raw: string) => {
      const debouncer = debouncerRef.current
      if (!debouncer.accept(raw, Date.now())) return
      debouncer.begin()
      decodingRef.current = true
      try {
        setFlash("ok")
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(60)
        if (!continuousRef.current) stop()
        await onDecodedRef.current(raw)
      } catch {
        setFlash("fail")
      } finally {
        debouncer.end()
        decodingRef.current = false
        setTimeout(() => setFlash(null), 600)
      }
    },
    [stop],
  )

  const tick = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || decodingRef.current) return
    try {
      if (detectorRef.current) {
        const found = await detectorRef.current.detect(video)
        const value = found.find((f) => f.rawValue)?.rawValue
        if (value) void handleRaw(value)
        return
      }
      if (jsQrRef.current) {
        const scale = Math.min(1, MAX_DECODE_WIDTH / (video.videoWidth || MAX_DECODE_WIDTH))
        const w = Math.max(1, Math.floor((video.videoWidth || 640) * scale))
        const h = Math.max(1, Math.floor((video.videoHeight || 480) * scale))
        const canvas = (canvasRef.current ??= document.createElement("canvas"))
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(video, 0, 0, w, h)
        const image = ctx.getImageData(0, 0, w, h)
        const result = jsQrRef.current(image.data, w, h)
        if (result?.data) void handleRaw(result.data)
      }
    } catch {
      /* 프레임 단위 디코딩 오류는 무시하고 다음 프레임에서 재시도 */
    }
  }, [handleRaw])

  const start = useCallback(
    async (preferredDeviceId?: string) => {
      setError(null)
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("error")
        setError("이 브라우저에서는 카메라를 사용할 수 없습니다. 아래에 코드를 직접 입력해 주세요.")
        return
      }
      if (!window.isSecureContext) {
        setStatus("error")
        setError("카메라는 HTTPS 환경에서만 사용할 수 있습니다. 아래에 코드를 직접 입력해 주세요.")
        return
      }
      stop()
      setStatus("starting")
      try {
        const id = preferredDeviceId ?? deviceId
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: id
            ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          return
        }
        video.srcObject = stream
        video.setAttribute("playsinline", "true")
        await video.play()

        // 목록은 권한 허용 이후에야 라벨이 채워진다.
        try {
          const all = await navigator.mediaDevices.enumerateDevices()
          setDevices(all.filter((d) => d.kind === "videoinput"))
          const active = stream.getVideoTracks()[0]?.getSettings().deviceId
          if (active) setDeviceId(active)
        } catch {
          /* 목록을 못 읽어도 스캔은 계속한다 */
        }

        // 디코더 선택
        detectorRef.current = null
        jsQrRef.current = null
        const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
        if (Ctor) {
          try {
            const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"]
            if (formats.includes("qr_code")) detectorRef.current = new Ctor({ formats: ["qr_code"] })
          } catch {
            detectorRef.current = null
          }
        }
        if (!detectorRef.current) {
          const mod = await import("jsqr")
          const jsQR = (mod.default ?? mod) as unknown as (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null
          jsQrRef.current = jsQR
        }

        debouncerRef.current.reset()
        timerRef.current = setInterval(() => void tick(), SCAN_INTERVAL_MS)
        setStatus("scanning")
      } catch (e) {
        stop()
        const name = e instanceof DOMException ? e.name : ""
        setStatus("error")
        setError(
          name === "NotAllowedError"
            ? "카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용하거나 코드를 직접 입력해 주세요."
            : name === "NotFoundError"
              ? "사용 가능한 카메라가 없습니다. 코드를 직접 입력해 주세요."
              : "카메라를 시작하지 못했습니다. 다른 앱이 카메라를 사용 중인지 확인해 주세요.",
        )
      }
    },
    [deviceId, stop, tick],
  )

  // 언마운트/탭 숨김 시 카메라 해제
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      stop()
    }
  }, [stop])

  useEffect(() => {
    if (autoStart) void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitManual = () => {
    const value = manual.trim()
    if (!value) return
    setManual("")
    void handleRaw(value)
  }

  const scanning = status === "scanning"

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div
        className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl border-2 bg-black transition-colors ${
          flash === "ok" ? "border-green-500" : flash === "fail" ? "border-red-500" : "border-slate-300"
        }`}
      >
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/80 p-4 text-center text-white">
            {status === "starting" ? (
              <p className="text-[15px]">카메라를 시작하는 중…</p>
            ) : (
              <>
                <CameraOff className="h-8 w-8 opacity-80" />
                <p className="text-[15px]">카메라가 꺼져 있습니다</p>
              </>
            )}
          </div>
        )}
        {scanning && (
          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" aria-hidden />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {scanning ? (
          <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" onClick={stop}>
            <CameraOff className="mr-2 h-4 w-4" /> 카메라 끄기
          </Button>
        ) : (
          <Button type="button" className="h-11 px-4 text-[15px]" onClick={() => void start()} disabled={status === "starting"}>
            <Camera className="mr-2 h-4 w-4" /> 카메라 켜기
          </Button>
        )}
        {devices.length > 1 && (
          <select
            aria-label="카메라 선택"
            className="h-11 rounded-md border bg-white px-3 text-[14px]"
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value)
              void start(e.target.value)
            }}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `카메라 ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        {status === "error" && (
          <Button type="button" variant="ghost" className="h-11 text-[14px]" onClick={() => void start()}>
            <RefreshCw className="mr-2 h-4 w-4" /> 다시 시도
          </Button>
        )}
      </div>

      {error && <p className="rounded-md bg-amber-50 p-3 text-[14px] text-amber-900">{error}</p>}

      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-md p-3 text-[14px] ${
            feedback.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"
          }`}
        >
          {feedback.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <Keyboard className="h-3.5 w-3.5" /> 코드 직접 입력
        </p>
        <div className="flex gap-2">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submitManual()
              }
            }}
            placeholder="LOT 번호 또는 QR 문자열"
            className="h-11 font-mono text-[15px]"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="button" variant="secondary" className="h-11 px-4 text-[15px]" onClick={submitManual}>
            확인
          </Button>
        </div>
      </div>
    </div>
  )
}
