/**
 * LOT QR 표준 (Phase 11 / DG-004 · DG-005 · DG-026).
 *
 * 형식:  DAEWON|LOT|<version>|<identifier>
 *   - identifier = Lot.lotNo 를 encodeURIComponent 한 값 (tenant 내 unique · 생성 후 변경되지 않는 식별자)
 *
 * 원칙
 *  - QR 에는 변하는 값(수량·상태·품명·공급사·검사결과·작업자)을 넣지 않는다. 식별자만 담는다.
 *  - QR 은 위조 방지 수단이 아니다 — 스캔 결과는 untrusted input 이며 서버가 tenant/권한/상태를 다시 검증한다.
 *  - QR 스캔만으로 업무 mutation 을 하지 않는다(식별 → 업무 버튼은 별도 Server Action).
 *  - 같은 LOT 는 항상 같은 payload(결정적)를 만든다 — 재출력해도 QR 이 바뀌지 않는다.
 *
 * 이 파일은 'use server' 파일이 아니며 서버/클라이언트 양쪽에서 import 한다(부수효과 없음).
 */

export const QR_PREFIX = "DAEWON"
export const QR_ENTITY_LOT = "LOT"
export const QR_VERSION_LOT = 1
/** 스캔 입력 전체 길이 상한(악의적/오인식 입력 차단). */
export const QR_MAX_INPUT_LENGTH = 256
/** 디코딩된 LOT 식별자 길이 상한. */
export const QR_MAX_IDENTIFIER_LENGTH = 128

const SUPPORTED_ENTITIES = new Set<string>([QR_ENTITY_LOT])
const SUPPORTED_VERSIONS: Record<string, readonly number[]> = { [QR_ENTITY_LOT]: [QR_VERSION_LOT] }

export type LotQrErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "MALFORMED"
  | "WRONG_PREFIX"
  | "UNSUPPORTED_ENTITY"
  | "UNSUPPORTED_VERSION"
  | "INVALID_IDENTIFIER"

export type LotQrParseResult =
  | { ok: true; entity: "LOT"; version: number; lotNo: string; source: "QR" }
  | { ok: false; code: LotQrErrorCode; message: string }

const ERROR_MESSAGES: Record<LotQrErrorCode, string> = {
  EMPTY: "스캔된 값이 없습니다.",
  TOO_LONG: "스캔된 값이 너무 깁니다.",
  MALFORMED: "인식할 수 없는 QR 형식입니다.",
  WRONG_PREFIX: "대원정밀 MES QR 이 아닙니다.",
  UNSUPPORTED_ENTITY: "LOT QR 이 아닙니다.",
  UNSUPPORTED_VERSION: "지원하지 않는 QR 버전입니다. 라벨을 다시 출력해 주세요.",
  INVALID_IDENTIFIER: "QR 의 LOT 식별자가 올바르지 않습니다.",
}

function fail(code: LotQrErrorCode): LotQrParseResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] }
}

// 제어문자(탭/개행 포함)는 식별자로 허용하지 않는다.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** 제조 현장 LOT 번호를 QR payload 로 만든다. 결정적(같은 LOT → 같은 문자열). */
export function encodeLotQr(lotNo: string): string {
  const id = String(lotNo ?? "").trim()
  if (!id) throw new Error("LOT 번호가 비어 있어 QR 을 만들 수 없습니다.")
  if (id.length > QR_MAX_IDENTIFIER_LENGTH || CONTROL_CHARS.test(id)) {
    throw new Error("LOT 번호가 QR 로 만들 수 없는 형식입니다.")
  }
  return `${QR_PREFIX}|${QR_ENTITY_LOT}|${QR_VERSION_LOT}|${encodeURIComponent(id)}`
}

/** 대원정밀 규격 QR 만 엄격히 파싱한다(수동입력/레거시 처리는 classifyScanInput). */
export function parseLotQr(raw: unknown): LotQrParseResult {
  if (typeof raw !== "string") return fail("MALFORMED")
  const input = raw.trim()
  if (!input) return fail("EMPTY")
  if (input.length > QR_MAX_INPUT_LENGTH) return fail("TOO_LONG")

  const parts = input.split("|")
  if (parts.length !== 4) {
    // DAEWON 접두는 맞는데 구조가 틀린 경우와 접두 자체가 다른 경우를 구분한다.
    return parts[0] === QR_PREFIX ? fail("MALFORMED") : parts.length === 1 ? fail("MALFORMED") : fail("WRONG_PREFIX")
  }
  const [prefix, entity, versionText, identifier] = parts
  if (prefix !== QR_PREFIX) return fail("WRONG_PREFIX")
  if (!SUPPORTED_ENTITIES.has(entity)) return fail("UNSUPPORTED_ENTITY")
  if (!/^[0-9]{1,3}$/.test(versionText)) return fail("MALFORMED")
  const version = Number(versionText)
  if (!SUPPORTED_VERSIONS[entity].includes(version)) return fail("UNSUPPORTED_VERSION")
  if (!identifier) return fail("INVALID_IDENTIFIER")

  let decoded: string
  try {
    decoded = decodeURIComponent(identifier)
  } catch {
    return fail("INVALID_IDENTIFIER")
  }
  decoded = decoded.trim()
  if (!decoded || decoded.length > QR_MAX_IDENTIFIER_LENGTH || CONTROL_CHARS.test(decoded)) {
    return fail("INVALID_IDENTIFIER")
  }
  return { ok: true, entity: "LOT", version, lotNo: decoded, source: "QR" }
}

// ─── 스캔 입력 분류(QR / 수동 LOT 번호 / 레거시 바코드) ────────────────────────

export type ScanInput =
  | { kind: "LOT_QR"; lotNo: string; raw: string }
  /** 작업자가 LOT 번호를 직접 입력/스캔한 평문(접두 없음). 서버 조회로 LOT 인지 확정한다. */
  | { kind: "MANUAL_TEXT"; text: string; raw: string }
  /** 기존 라벨 `{itemCode}|{lotId}` 형식. 품목 행 강조 용도로만 쓰이며 LOT 확정에 쓰지 않는다. */
  | { kind: "LEGACY_ITEM_LOT"; itemCode: string; lotId: string; raw: string }
  | { kind: "INVALID"; code: LotQrErrorCode; message: string; raw: string }

const MANUAL_TEXT = /^[^\s|][^|]{0,127}$/

/**
 * 모든 화면이 공통으로 쓰는 단일 진입점. 화면마다 파싱 로직을 복사하지 않는다.
 *  - `DAEWON|...` → 엄격 QR 파싱(실패하면 INVALID)
 *  - `A|B`(접두 불일치) → 레거시 itemCode|lotId 바코드로 해석(LOT 확정 불가)
 *  - 구분자 없는 평문 → 수동 입력 LOT/품목코드
 */
export function classifyScanInput(raw: unknown): ScanInput {
  const text = typeof raw === "string" ? raw : ""
  const input = text.trim()
  if (!input) return { kind: "INVALID", code: "EMPTY", message: ERROR_MESSAGES.EMPTY, raw: text }
  if (input.length > QR_MAX_INPUT_LENGTH) {
    return { kind: "INVALID", code: "TOO_LONG", message: ERROR_MESSAGES.TOO_LONG, raw: text.slice(0, 32) }
  }

  if (input.startsWith(`${QR_PREFIX}|`)) {
    const parsed = parseLotQr(input)
    return parsed.ok
      ? { kind: "LOT_QR", lotNo: parsed.lotNo, raw: input }
      : { kind: "INVALID", code: parsed.code, message: parsed.message, raw: input }
  }

  if (input.includes("|")) {
    const parts = input.split("|").map((p) => p.trim())
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { kind: "LEGACY_ITEM_LOT", itemCode: parts[0], lotId: parts[1], raw: input }
    }
    return { kind: "INVALID", code: "WRONG_PREFIX", message: ERROR_MESSAGES.WRONG_PREFIX, raw: input }
  }

  if (CONTROL_CHARS.test(input) || !MANUAL_TEXT.test(input)) {
    return { kind: "INVALID", code: "MALFORMED", message: ERROR_MESSAGES.MALFORMED, raw: input }
  }
  return { kind: "MANUAL_TEXT", text: input, raw: input }
}

/** 서버 조회용: 입력 분류 결과에서 LOT 번호 후보만 꺼낸다(LOT 이 아니면 null). */
export function lotNoFromScan(scan: ScanInput): string | null {
  if (scan.kind === "LOT_QR") return scan.lotNo
  if (scan.kind === "MANUAL_TEXT") return scan.text
  return null
}
