/**
 * 카메라 프레임 → QR 문자열 디코더 (브라우저 전용 코드. SSR 에서는 import 만 되고 실행되지 않는다).
 *
 * 선택: 브라우저 BarcodeDetector(있으면, 네이티브라 빠르고 저전력) + jsQR(항상 가능한 폴백, 이미 프로젝트 의존성).
 *  - BarcodeDetector 는 Android Chrome 에서는 대체로 지원되지만 Windows 데스크톱 Chrome/Edge·일부 키오스크 브라우저에서는 없다.
 *    그래서 BarcodeDetector 만으로는 구성하지 않는다. 기능 확인(qr_code 지원)에 실패하거나 실행 중 오류가 나면 jsQR 로 영구 전환한다.
 *  - jsQR 은 필요할 때만 동적 import 한다(스캐너를 열기 전에는 번들/실행 비용 없음).
 *  - 저사양 기기를 위해 프레임을 긴 변 최대 640px 로 줄여서 해석한다.
 */

export type QrDecoderKind = "native" | "jsqr"
export type QrDecoderMode = "auto" | "native" | "jsqr"

export interface QrDecoder {
  readonly kind: QrDecoderKind
  /** 현재 프레임에서 QR 문자열을 찾는다. 없으면 null. 동시에 두 번 호출하지 않는다(호출자가 순차 호출). */
  decode(video: HTMLVideoElement): Promise<string | null>
  dispose(): void
}

type DetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>> }
type DetectorCtor = {
  new (options?: { formats?: string[] }): DetectorLike
  getSupportedFormats?: () => Promise<string[]>
}
type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null

export const MAX_DECODE_SIDE = 640

/** 프레임 크기를 긴 변 maxSide 이하로 줄인 크기(비율 유지). */
export function fitDecodeSize(width: number, height: number, maxSide: number = MAX_DECODE_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function loadJsQr(): Promise<JsQr> {
  const mod = (await import("jsqr")) as unknown as { default?: JsQr } & JsQr
  const fn = (typeof mod.default === "function" ? mod.default : mod) as JsQr
  if (typeof fn !== "function") throw new Error("jsQR 모듈을 불러오지 못했습니다")
  return fn
}

function createJsQrDecoder(jsQR: JsQr): QrDecoder {
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  return {
    kind: "jsqr",
    async decode(video) {
      const size = fitDecodeSize(video.videoWidth, video.videoHeight)
      if (size.width === 0) return null
      if (!canvas) {
        canvas = document.createElement("canvas")
        ctx = canvas.getContext("2d", { willReadFrequently: true })
      }
      if (!ctx) return null
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width
        canvas.height = size.height
      }
      ctx.drawImage(video, 0, 0, size.width, size.height)
      const image = ctx.getImageData(0, 0, size.width, size.height)
      // 라벨은 흰 바탕 검은 QR — 반전 시도는 하지 않아 CPU 를 아낀다.
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })
      return code?.data ?? null
    },
    dispose() {
      canvas = null
      ctx = null
    },
  }
}

async function createNativeDecoder(): Promise<QrDecoder | null> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
  if (typeof Ctor !== "function") return null
  try {
    const formats = typeof Ctor.getSupportedFormats === "function" ? await Ctor.getSupportedFormats() : ["qr_code"]
    if (!formats.includes("qr_code")) return null
    const detector = new Ctor({ formats: ["qr_code"] })
    return {
      kind: "native",
      async decode(video) {
        const found = await detector.detect(video)
        return found.find((f) => typeof f.rawValue === "string" && f.rawValue !== "")?.rawValue ?? null
      },
      dispose() {},
    }
  } catch {
    return null
  }
}

/**
 * 디코더를 만든다. mode "auto": 네이티브 가능하면 네이티브(실행 중 오류 시 jsQR 로 영구 전환), 아니면 jsQR.
 * mode "native"/"jsqr" 는 테스트·진단용 강제 선택(native 불가 시 jsqr 로 대체).
 */
export async function createQrDecoder(mode: QrDecoderMode = "auto"): Promise<QrDecoder> {
  const native = mode === "jsqr" ? null : await createNativeDecoder()
  if (!native) return createJsQrDecoder(await loadJsQr())

  let fallback: QrDecoder | null = null
  const decoder: QrDecoder = {
    get kind(): QrDecoderKind {
      return fallback ? "jsqr" : "native"
    },
    async decode(video) {
      if (fallback) return fallback.decode(video)
      try {
        return await native.decode(video)
      } catch {
        // 일부 기기에서 detect 가 실행 중 실패(코덱/권한/구현 오류) → jsQR 로 전환해 계속 스캔한다.
        fallback = createJsQrDecoder(await loadJsQr())
        return fallback.decode(video)
      }
    },
    dispose() {
      native.dispose()
      fallback?.dispose()
    },
  }
  return decoder
}
