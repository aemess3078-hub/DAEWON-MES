/**
 * 카메라 사용 가능 여부 · 오류 분류 · 제약조건 · 카메라 선택 휴리스틱 (순수 함수, 브라우저 객체는 인자로 받는다).
 * SSR 안전: 이 파일은 import 시점에 window/navigator 를 읽지 않는다.
 */

export type CameraErrorCode =
  /** HTTPS 또는 localhost 가 아니라 카메라 API 를 쓸 수 없음 */
  | "INSECURE_CONTEXT"
  /** 브라우저가 카메라 API(getUserMedia)를 지원하지 않음 */
  | "UNSUPPORTED"
  /** 사용 가능한 카메라가 없음 */
  | "NO_CAMERA"
  /** 카메라 권한이 거부됨 */
  | "PERMISSION_DENIED"
  /** 다른 앱/탭이 카메라를 사용 중이거나 하드웨어 오류 */
  | "CAMERA_BUSY"
  /** QR 인식 모듈을 불러오지 못함 */
  | "DECODER_FAILED"
  /** 그 밖의 카메라 실행 실패 */
  | "START_FAILED"

export type CameraErrorInfo = { code: CameraErrorCode; message: string }

export const CAMERA_ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  INSECURE_CONTEXT: "카메라는 보안 연결(HTTPS) 또는 localhost 에서만 사용할 수 있습니다. 주소가 https:// 로 시작하는지 확인해 주세요.",
  UNSUPPORTED: "이 브라우저는 카메라 스캔을 지원하지 않습니다. Chrome 또는 Edge 최신 버전을 사용해 주세요.",
  NO_CAMERA: "사용할 수 있는 카메라를 찾지 못했습니다. 카메라가 연결되어 있는지 확인해 주세요.",
  PERMISSION_DENIED: "카메라 사용 권한이 거부되었습니다. 브라우저 주소창의 카메라 설정에서 이 사이트를 허용한 뒤 다시 시도해 주세요.",
  CAMERA_BUSY: "카메라를 사용할 수 없습니다. 다른 앱이나 탭이 카메라를 사용 중인지 확인한 뒤 다시 시도해 주세요.",
  DECODER_FAILED: "QR 인식 기능을 불러오지 못했습니다. 네트워크 상태를 확인하고 화면을 새로고침해 주세요.",
  START_FAILED: "카메라를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
}

export function cameraError(code: CameraErrorCode): CameraErrorInfo {
  return { code, message: CAMERA_ERROR_MESSAGES[code] }
}

type EnvLike = { isSecureContext?: boolean; mediaDevices?: { getUserMedia?: unknown } | null | undefined }

/** 카메라 API 사용 가능 환경인지 확인한다. 가능하면 null. */
export function checkCameraSupport(env: EnvLike): CameraErrorInfo | null {
  // 보안 컨텍스트가 아니면 브라우저가 mediaDevices 자체를 제공하지 않는 경우가 많아 먼저 판정한다(HTTP 접속 안내).
  if (env.isSecureContext === false) return cameraError("INSECURE_CONTEXT")
  if (!env.mediaDevices || typeof env.mediaDevices.getUserMedia !== "function") return cameraError("UNSUPPORTED")
  return null
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) return String((error as { name: unknown }).name)
  return ""
}

/** getUserMedia 가 지정한 카메라(exact deviceId)를 찾지 못했을 때(Overconstrained). 기본 카메라로 한 번 재시도할 수 있다. */
export function isOverconstrainedError(error: unknown): boolean {
  return errorName(error) === "OverconstrainedError" || errorName(error) === "ConstraintNotSatisfiedError"
}

/** 브라우저 카메라 오류 → 사용자용 한국어 안내. */
export function mapCameraError(error: unknown): CameraErrorInfo {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return cameraError("PERMISSION_DENIED")
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return cameraError("NO_CAMERA")
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return cameraError("CAMERA_BUSY")
    case "TypeError":
      // 잘못된 제약조건 또는 비보안 환경에서 mediaDevices 가 없을 때
      return cameraError("UNSUPPORTED")
    default:
      return cameraError("START_FAILED")
  }
}

export type VideoConstraintsOptions = { deviceId?: string | null }

/**
 * 카메라 제약조건. 과도한 해상도를 피한다(저사양 태블릿): 이상 해상도 1280×720, 프레임 15~24.
 *  - deviceId 지정: 그 카메라(exact)
 *  - 미지정: 후면 카메라 우선(facingMode ideal) — 후면이 없으면(PC 웹캠 등) 브라우저가 사용 가능한 카메라로 대체한다.
 */
export function buildVideoConstraints(options: VideoConstraintsOptions = {}): MediaStreamConstraints {
  const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
  if (options.deviceId) return { audio: false, video: { ...base, deviceId: { exact: options.deviceId } } }
  return { audio: false, video: { ...base, facingMode: { ideal: "environment" } } }
}

export type CameraDevice = { deviceId: string; label: string }

const BACK_LABEL = /back|rear|environment|world|후면|뒷면|후방/i
const FRONT_LABEL = /front|user|face|selfie|전면|앞면|전방/i

export function isFrontLabel(label: string): boolean {
  return FRONT_LABEL.test(label) && !BACK_LABEL.test(label)
}

/**
 * 현재 쓰는 카메라가 전면(또는 facingMode=user)인데 후면으로 보이는 카메라가 있으면 그 deviceId 를 돌려준다.
 * (일부 모바일 브라우저가 facingMode ideal 을 무시하고 전면을 여는 경우의 보정 — 사용자가 직접 고른 카메라에는 적용하지 않는다.)
 */
export function pickPreferredBackCamera(
  devices: CameraDevice[],
  active: { deviceId?: string | null; facingMode?: string | null },
): string | null {
  const activeDevice = devices.find((d) => d.deviceId === active.deviceId)
  const activeIsFront = active.facingMode === "user" || (activeDevice ? isFrontLabel(activeDevice.label) : false)
  if (!activeIsFront) return null
  const back = devices.find((d) => d.deviceId !== active.deviceId && BACK_LABEL.test(d.label))
  return back ? back.deviceId : null
}

export const PREFERRED_CAMERA_STORAGE_KEY = "daewon:qr-camera"

/** 마지막으로 선택한 카메라(같은 기기에서 다시 열 때 유지). 저장소를 못 쓰면 무시한다. */
export function readPreferredCamera(storage?: Pick<Storage, "getItem"> | null): string | null {
  try {
    return storage?.getItem(PREFERRED_CAMERA_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function savePreferredCamera(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, deviceId: string | null): void {
  try {
    if (!storage) return
    if (deviceId) storage.setItem(PREFERRED_CAMERA_STORAGE_KEY, deviceId)
    else storage.removeItem(PREFERRED_CAMERA_STORAGE_KEY)
  } catch {
    /* 저장 실패는 무시 */
  }
}
