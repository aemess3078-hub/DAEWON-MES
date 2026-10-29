/**
 * 카메라 QR 스캐너가 상위 화면에 돌려주는 "스캔 결과" 타입과 검증 (순수 함수, DOM/서버 비의존).
 *
 * 기존 QR 파서(lib/qr/lot-qr.ts 의 parseDaewonQr)를 그대로 재사용한다 — 새 QR 규격을 만들지 않는다.
 *   LOT QR: DAEWON|LOT|1|<식별값>   WIP QR: DAEWON|WIP|1|<식별값>
 *
 * 주의
 *  - 원자재 LOT 와 완제품 LOT 는 QR 형식이 같다. 이 모듈은 둘을 구분하지 않는다(kind="LOT" 로만 돌려준다).
 *    실제 원자재/완제품 구분은 호출한 업무 화면이 서버 데이터를 조회해 판단한다.
 *  - 이 모듈과 스캐너는 DB 를 조회하지 않고 업무 처리도 하지 않는다. 스캔 결과(식별값)는 신뢰할 수 없는 입력이므로
 *    호출 화면이 서버에서 tenant/권한/상태를 다시 검증해야 한다.
 *  - BATCH 등 정의되지 않은 QR 종류는 거부한다.
 */
import { parseDaewonQr, type LotQrErrorCode } from "@/lib/qr/lot-qr"

export type QrScanKind = "LOT" | "WIP"

/** 스캔 성공 결과 — 상위 컴포넌트(onScan)로 전달된다. */
export type QrScanResult = {
  /** QR 종류: LOT(원자재·완제품 공통) 또는 WIP */
  kind: QrScanKind
  /** QR 규격 버전 */
  version: number
  /** 식별값: LOT 번호 또는 WIP 식별값(디코딩된 값) */
  id: string
  /** 카메라에서 읽은 원본 QR 문자열(가공하지 않음) */
  raw: string
}

export type QrScanParse =
  | { ok: true; result: QrScanResult }
  | { ok: false; code: LotQrErrorCode; message: string; raw: string }

/** 스캐너 화면용 한국어 안내(파서의 내부 문구와 별개로, 현장 작업자가 이해하기 쉬운 표현). */
export const QR_SCAN_ERROR_MESSAGES: Record<LotQrErrorCode, string> = {
  EMPTY: "QR 에서 읽힌 값이 없습니다.",
  TOO_LONG: "QR 값이 너무 깁니다. 대원정밀 MES 라벨이 아닌 것 같습니다.",
  MALFORMED: "대원정밀 MES QR 형식이 아닙니다. LOT/WIP 라벨의 QR 을 스캔해 주세요.",
  WRONG_PREFIX: "대원정밀 MES QR 이 아닙니다. 다른 QR 코드입니다.",
  UNSUPPORTED_ENTITY: "지원하지 않는 QR 종류입니다. LOT 또는 WIP 라벨의 QR 만 사용할 수 있습니다.",
  UNSUPPORTED_VERSION: "지원하지 않는 QR 버전입니다. 라벨을 다시 출력해 주세요.",
  INVALID_IDENTIFIER: "QR 의 식별값이 올바르지 않습니다. 라벨을 확인해 주세요.",
}

/** 카메라가 읽은 문자열을 검증해 스캔 결과로 만든다. 형식이 틀리면 ok:false(스캐너는 스캔을 유지한다). */
export function parseQrScan(raw: unknown): QrScanParse {
  const text = typeof raw === "string" ? raw : ""
  const parsed = parseDaewonQr(text)
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, message: QR_SCAN_ERROR_MESSAGES[parsed.code], raw: text }
  }
  if (parsed.entity === "LOT") {
    return { ok: true, result: { kind: "LOT", version: parsed.version, id: parsed.lotNo, raw: text } }
  }
  return { ok: true, result: { kind: "WIP", version: parsed.version, id: parsed.wipId, raw: text } }
}
