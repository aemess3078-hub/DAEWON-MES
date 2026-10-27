"use client"

/**
 * 카메라 QR 스캔 훅 — 카메라 시작/정지, 카메라 선택, 프레임 디코딩 루프, 결과 검증, 자원 정리.
 *
 * 규칙
 *  - 결과는 QR 파서(lib/qr/qr-scan-result.ts → lot-qr.ts)로 검증한 뒤에만 onScan 으로 전달한다(성공 1회).
 *  - 성공하면 카메라를 끄고 루프를 멈춘다. 같은 QR 이 연속으로 읽혀도 onScan 은 한 번만 호출된다.
 *  - 형식이 틀린 QR(다른 접두/지원하지 않는 종류 등)은 안내만 표시하고 스캔을 유지한다.
 *  - 이 훅은 DB 조회·업무 처리를 하지 않는다. 스캔 결과만 돌려준다.
 *  - stop/언마운트/탭 숨김/오류 시 MediaStream 의 모든 track 을 stop 한다. start 는 토큰으로 오래된 비동기 완료를 무시한다
 *    (카메라 권한 대기 중 닫아도 늦게 열린 스트림을 즉시 닫는다).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { parseQrScan, type QrScanResult } from "@/lib/qr/qr-scan-result"
import {
  buildVideoConstraints,
  cameraError,
  checkCameraSupport,
  isOverconstrainedError,
  mapCameraError,
  pickPreferredBackCamera,
  readPreferredCamera,
  savePreferredCamera,
  type CameraDevice,
  type CameraErrorInfo,
} from "./camera-support"
import { createQrDecoder, type QrDecoder, type QrDecoderKind, type QrDecoderMode } from "./qr-decoder"

export type ScannerStatus = "idle" | "starting" | "scanning" | "success" | "error"

export interface UseQrCameraScannerOptions {
  /** 검증을 통과한 스캔 결과(성공 1회). */
  onScan: (result: QrScanResult) => void
  /** 디코더 강제 선택(테스트·진단). 기본 auto. */
  decoderMode?: QrDecoderMode
  /** 프레임 해석 간격(ms). 저사양 기기 보호용 — 기본 150ms(초당 약 6~7회). */
  scanIntervalMs?: number
  /** 이 시간 동안 QR 이 전혀 보이지 않으면 촬영 요령을 안내한다(ms). */
  noDetectHintMs?: number
}

const NO_QR_HINT = "QR 이 인식되지 않습니다. 밝은 곳에서 QR 전체가 사각형 안에 들어오도록 거리를 조절하고, 화면 반사를 피해 주세요."
const HIDDEN_MESSAGE = "화면이 백그라운드로 이동해 카메라를 종료했습니다. [카메라 시작]을 눌러 다시 시작하세요."

export function useQrCameraScanner({ onScan, decoderMode = "auto", scanIntervalMs = 150, noDetectHintMs = 12000 }: UseQrCameraScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<ScannerStatus>("idle")
  const [error, setError] = useState<CameraErrorInfo | null>(null)
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null)
  const [decoderKind, setDecoderKind] = useState<QrDecoderKind | null>(null)
  const [lastResult, setLastResult] = useState<QrScanResult | null>(null)

  const mountedRef = useRef(true)
  const tokenRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const decoderRef = useRef<QrDecoder | null>(null)
  const deliveredRef = useRef(false)
  const lastInvalidRef = useRef<string | null>(null)
  const onScanRef = useRef(onScan)
  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  const safe = useCallback(<T,>(setter: (value: T) => void, value: T) => {
    if (mountedRef.current) setter(value)
  }, [])

  const clearTimers = useCallback(() => {
    if (loopTimerRef.current) clearTimeout(loopTimerRef.current)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    loopTimerRef.current = null
    hintTimerRef.current = null
  }, [])

  /** 카메라 스트림과 타이머를 모두 정리한다(여러 번 호출해도 안전). */
  const releaseCamera = useCallback(() => {
    clearTimers()
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        /* 이미 종료된 track */
      }
    })
    const video = videoRef.current
    if (video) {
      try {
        video.pause()
      } catch {
        /* ignore */
      }
      video.srcObject = null
    }
  }, [clearTimers])

  const stop = useCallback(() => {
    tokenRef.current += 1
    releaseCamera()
    safe(setStatus, "idle")
  }, [releaseCamera, safe])

  const handleRaw = useCallback(
    (raw: string, token: number) => {
      if (token !== tokenRef.current || deliveredRef.current) return
      // QR 은 보였으므로 "인식 안 됨" 안내 타이머는 해제한다.
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current)
        hintTimerRef.current = null
      }
      safe(setHint, null)
      const parsed = parseQrScan(raw)
      if (!parsed.ok) {
        // 지원하지 않는 QR/일반 텍스트: 안내만 바꾸고 스캔 유지(같은 값이 반복돼도 상태를 다시 바꾸지 않는다).
        if (lastInvalidRef.current !== raw) {
          lastInvalidRef.current = raw
          safe(setInvalidMessage, parsed.message)
        }
        return
      }
      // 성공: 중복 콜백 방지 → 루프/카메라 종료 → 결과 전달(1회)
      deliveredRef.current = true
      tokenRef.current += 1
      releaseCamera()
      safe(setInvalidMessage, null)
      safe(setLastResult, parsed.result)
      safe(setStatus, "success")
      onScanRef.current(parsed.result)
    },
    [releaseCamera, safe],
  )

  const runLoop = useCallback(
    (token: number) => {
      const tick = async () => {
        if (token !== tokenRef.current) return
        const video = videoRef.current
        const decoder = decoderRef.current
        if (video && decoder && video.readyState >= 2 && video.videoWidth > 0) {
          let raw: string | null = null
          try {
            raw = await decoder.decode(video)
          } catch {
            raw = null // 프레임 하나의 해석 실패는 무시하고 다음 프레임에서 계속
          }
          if (token !== tokenRef.current) return
          if (raw) handleRaw(raw, token)
          safe(setDecoderKind, decoder.kind)
        }
        // 이전 해석이 끝난 뒤에만 다음 해석을 예약 → 디코딩이 겹치지 않는다
        if (token === tokenRef.current && !deliveredRef.current) loopTimerRef.current = setTimeout(tick, scanIntervalMs)
      }
      loopTimerRef.current = setTimeout(tick, scanIntervalMs)
    },
    [handleRaw, safe, scanIntervalMs],
  )

  const listDevices = useCallback(async (): Promise<CameraDevice[]> => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      return all.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label }))
    } catch {
      return []
    }
  }, [])

  const startInternal: (requestedDeviceId: string | null, allowBackSwitch: boolean) => Promise<void> = useCallback(
    async (requestedDeviceId: string | null, allowBackSwitch: boolean): Promise<void> => {
      tokenRef.current += 1
      const token = tokenRef.current
      releaseCamera()
      deliveredRef.current = false
      lastInvalidRef.current = null
      safe(setError, null)
      safe(setInvalidMessage, null)
      safe(setHint, null)
      safe(setLastResult, null)

      const unsupported = checkCameraSupport({
        isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
        mediaDevices: typeof navigator !== "undefined" ? navigator.mediaDevices : undefined,
      })
      if (unsupported) {
        safe(setError, unsupported)
        safe(setStatus, "error")
        return
      }

      safe(setStatus, "starting")
      let stream: MediaStream | null = null
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia(buildVideoConstraints({ deviceId: requestedDeviceId }))
        } catch (firstError) {
          // 저장해 둔/선택한 카메라가 없어졌으면(Overconstrained) 기본 카메라로 한 번만 재시도
          if (requestedDeviceId && isOverconstrainedError(firstError)) {
            savePreferredCamera(window.localStorage, null)
            stream = await navigator.mediaDevices.getUserMedia(buildVideoConstraints())
          } else {
            throw firstError
          }
        }
        // 권한 대기 중 닫기/재시작/언마운트가 있었다면 늦게 열린 스트림을 즉시 닫는다.
        if (token !== tokenRef.current || !mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const track = stream.getVideoTracks()[0]
        const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings
        const list = await listDevices()
        if (token !== tokenRef.current) return
        safe(setDevices, list)
        safe(setActiveDeviceId, settings.deviceId ?? requestedDeviceId ?? null)

        // 전면이 열렸는데 후면 카메라가 보이면 한 번만 후면으로 전환(사용자가 직접 고른 카메라에는 적용하지 않는다)
        if (allowBackSwitch && !requestedDeviceId) {
          const backId = pickPreferredBackCamera(list, { deviceId: settings.deviceId, facingMode: settings.facingMode })
          if (backId) {
            await startInternal(backId, false)
            return
          }
        }

        const video = videoRef.current
        if (!video) throw new Error("video element missing")
        video.muted = true
        video.setAttribute("playsinline", "true")
        video.srcObject = stream
        try {
          await video.play()
        } catch (playError) {
          // 재생 요청이 새 로드로 중단(AbortError)된 경우는 무시, 그 밖의 오류는 카메라 실행 실패로 처리
          if (!(playError && typeof playError === "object" && (playError as { name?: string }).name === "AbortError")) throw playError
        }
        if (token !== tokenRef.current) return

        if (!decoderRef.current) {
          try {
            decoderRef.current = await createQrDecoder(decoderMode)
          } catch {
            throw Object.assign(new Error("decoder"), { name: "DecoderLoadError" })
          }
        }
        if (token !== tokenRef.current) return
        safe(setDecoderKind, decoderRef.current.kind)
        safe(setStatus, "scanning")
        hintTimerRef.current = setTimeout(() => safe(setHint, NO_QR_HINT), noDetectHintMs)
        runLoop(token)
      } catch (caught) {
        if (token !== tokenRef.current) {
          stream?.getTracks().forEach((t) => t.stop())
          return
        }
        releaseCamera()
        const info = caught && typeof caught === "object" && (caught as { name?: string }).name === "DecoderLoadError" ? cameraError("DECODER_FAILED") : mapCameraError(caught)
        safe(setError, info)
        safe(setStatus, "error")
      }
    },
    [decoderMode, listDevices, noDetectHintMs, releaseCamera, runLoop, safe],
  )

  /** 카메라 시작. 마지막으로 선택한 카메라가 있으면 우선 사용한다. */
  const start = useCallback(async () => {
    const preferred = typeof window !== "undefined" ? readPreferredCamera(window.localStorage) : null
    await startInternal(preferred, true)
  }, [startInternal])

  /** 사용자가 카메라를 선택했을 때(선택값을 기억한다). */
  const selectDevice = useCallback(
    async (deviceId: string) => {
      savePreferredCamera(typeof window !== "undefined" ? window.localStorage : null, deviceId)
      await startInternal(deviceId, false)
    },
    [startInternal],
  )

  // 언마운트: 카메라/타이머/디코더 정리
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      tokenRef.current += 1
      releaseCamera()
      decoderRef.current?.dispose()
      decoderRef.current = null
    }
  }, [releaseCamera])

  // 탭이 숨겨지면(앱 전환/화면 꺼짐) 카메라를 끈다 — 카메라 LED 가 계속 켜져 있거나 다른 앱이 카메라를 못 쓰는 것을 방지
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && streamRef.current) {
        tokenRef.current += 1
        releaseCamera()
        safe(setStatus, "idle")
        safe(setHint, HIDDEN_MESSAGE)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [releaseCamera, safe])

  return { videoRef, status, error, invalidMessage, hint, devices, activeDeviceId, decoderKind, lastResult, start, stop, selectDevice }
}
