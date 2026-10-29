/**
 * LOT QR → 벡터 SVG 경로. 동기 계산이라 "QR 이미지가 아직 안 만들어진 채 인쇄되는" 상황이 없다.
 * (비트맵 data URL 은 확대/축소 시 모듈 경계가 흐려지고 비동기 생성이라 빈 QR 이 출력될 수 있다.)
 *
 * 오류정정 M — 라벨 손상/오염에 어느 정도 견디면서 모듈 수를 작게(= 모듈이 커지게) 유지한다.
 * quiet zone 은 QR 규격 최소값(4모듈)을 SVG viewBox 안에 포함한다.
 */
import QRCode from "qrcode"
import { QR_QUIET_ZONE_MODULES } from "@/lib/label/label-spec"
import { encodeLotQr, encodeWipQr } from "@/lib/qr/lot-qr"

export type QrSvgData = {
  /** QR 에 인코딩된 문자열. */
  payload: string
  /** QR 버전(1~40). */
  version: number
  /** 데이터 모듈 한 변 개수(quiet zone 제외). */
  moduleCount: number
  /** quiet zone 포함 viewBox 한 변(모듈 단위). */
  viewBoxSize: number
  /** 어두운 모듈을 가로 run 단위로 그린 path d. */
  pathD: string
}

export function buildQrSvgData(payload: string, quietZone: number = QR_QUIET_ZONE_MODULES): QrSvgData {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" })
  const size = qr.modules.size
  const data = qr.modules.data
  const commands: string[] = []
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (!data[y * size + x]) {
        x += 1
        continue
      }
      const start = x
      while (x < size && data[y * size + x]) x += 1
      commands.push(`M${start + quietZone} ${y + quietZone}h${x - start}v1h-${x - start}z`)
    }
  }
  return {
    payload,
    version: qr.version,
    moduleCount: size,
    viewBoxSize: size + quietZone * 2,
    pathD: commands.join(""),
  }
}

/** 라벨용: LOT 번호 → LOT QR SVG 데이터(규격 `DAEWON|LOT|1|<lotNo>`). 잘못된 LOT 번호면 throw. */
export function buildLotQrSvgData(lotNo: string): QrSvgData {
  return buildQrSvgData(encodeLotQr(lotNo))
}

/** 라벨용: WIP 식별값 → WIP QR SVG 데이터(규격 `DAEWON|WIP|1|<식별값>`). 잘못된 값이면 throw. */
export function buildWipQrSvgData(wipId: string): QrSvgData {
  return buildQrSvgData(encodeWipQr(wipId))
}

/** 테스트/진단용: quiet zone 포함 모듈 행렬을 (scale)배 확대한 RGBA 로 만든다(jsQR 등 디코더 입력). */
export function renderQrRgba(data: QrSvgData, scale = 8): { data: Uint8ClampedArray; width: number; height: number } {
  const dim = data.viewBoxSize * scale
  const rgba = new Uint8ClampedArray(dim * dim * 4).fill(255)
  const re = /M(\d+) (\d+)h(\d+)v1h-\d+z/g
  let match: RegExpExecArray | null
  while ((match = re.exec(data.pathD)) !== null) {
    const x0 = Number(match[1])
    const y0 = Number(match[2])
    const w = Number(match[3])
    for (let py = y0 * scale; py < (y0 + 1) * scale; py++) {
      for (let px = x0 * scale; px < (x0 + w) * scale; px++) {
        const i = (py * dim + px) * 4
        rgba[i] = 0
        rgba[i + 1] = 0
        rgba[i + 2] = 0
        rgba[i + 3] = 255
      }
    }
  }
  return { data: rgba, width: dim, height: dim }
}
