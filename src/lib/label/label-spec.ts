/**
 * LOT QR 라벨 규격 (Brother QL-820NWB · 29×90mm 절취형 라벨).
 *
 * 순수 함수/상수만 둔다(React·DOM 비의존) — 서버/클라이언트/테스트가 같은 계산을 쓴다.
 *
 * 규격
 *  - 용지: 가로 90mm × 세로 29mm (가로 방향), 라벨 1장 = 인쇄 페이지 1개
 *  - 왼쪽: LOT QR (여백(quiet zone) 포함 정사각형)  /  오른쪽: 대원정밀·품목명·품목코드·LOT·수량·일자
 *  - QR 데이터는 `DAEWON|LOT|1|<LOT 번호>` (lib/qr/lot-qr.ts) — 수량/품명 등 변하는 값은 넣지 않는다.
 *
 * 글꼴 크기 단위는 pt(인쇄 단위)다. 화면 UI 타이포(CLAUDE.md)와 별개로 라벨 물리 크기에 맞춘다.
 * 실제 인쇄 가능 영역(프린터 비인쇄 여백)은 용지/드라이버마다 달라 현장 확인(FIELD_TEST_REQUIRED) 후 조정한다.
 */

import { encodeLotQr, encodeWipQr } from "@/lib/qr/lot-qr"

export const LABEL_WIDTH_MM = 90
export const LABEL_HEIGHT_MM = 29
/** 라벨 가장자리 안쪽 여백. */
export const LABEL_PADDING_MM = 2
/** QR 과 텍스트 사이 간격. */
export const LABEL_GAP_MM = 2
/** QR 한 변(quiet zone 포함). 18~20mm 범위에서 시작. */
export const LABEL_QR_MM_DEFAULT = 19
export const LABEL_QR_MM_MIN = 14
export const LABEL_QR_MM_MAX = 24
/** QR quiet zone(모듈 수). QR 규격 최소값은 4 모듈이다. */
export const QR_QUIET_ZONE_MODULES = 4
export const MM_TO_PT = 72 / 25.4

/** LOT_QR: LOT 번호 QR(원자재/완제품). WIP_QR: 재공(WIP) 식별값 QR. ITEM_BARCODE: 레거시 품목 바코드. */
export type LabelKind = "LOT_QR" | "WIP_QR" | "ITEM_BARCODE"

/**
 * 라벨 3종 (디자인 구분). QR 은 식별값만 담고 현재 상태는 MES 조회로 얻는다.
 *  - RAW_LOT: 원자재 LOT  → QR `DAEWON|LOT|1|<LOT 번호>`
 *  - FG_LOT : 완제품 LOT  → QR `DAEWON|LOT|1|<LOT 번호>` (원자재와 같은 LOT QR — 품목 유형은 MES 조회로 구분)
 *  - WIP    : 공정·재공 통합 → QR `DAEWON|WIP|1|<WIP 식별값>` — 최초 발행 후 모든 공정에서 재사용(출하·공정이동 전용 라벨 없음)
 */
export type LabelType = "RAW_LOT" | "WIP" | "FG_LOT"

export const LABEL_TYPE_META: Record<LabelType, { tag: string; title: string; kind: LabelKind }> = {
  RAW_LOT: { tag: "원자재", title: "원자재 LOT 라벨", kind: "LOT_QR" },
  WIP: { tag: "재공 WIP", title: "공정·재공(WIP) 통합 라벨", kind: "WIP_QR" },
  FG_LOT: { tag: "완제품", title: "완제품 LOT 라벨", kind: "LOT_QR" },
}

export type LabelData = {
  kind: LabelKind
  /** 라벨 3종 구분. 지정하지 않으면(기존 화면) 유형 표시 없이 기존 LOT 라벨 모양으로 출력한다. */
  labelType?: LabelType
  itemCode: string
  itemName: string
  /** LOT_QR: 필수. 그 외 사용하지 않는다. */
  lotNo?: string | null
  /**
   * WIP_QR: 필수. 재공 단위의 고유 식별값(변하지 않는 값). 어떤 DB 값을 쓸지는 미확정이다(제안: WipUnit.id).
   * 수량·공정·상태처럼 변하는 값은 라벨에 인쇄하지 않는다.
   */
  wipId?: string | null
  /** WIP 라벨: 제조번호(작업지시 단위, 공정이 바뀌어도 변하지 않음). */
  manufacturingNo?: string | null
  /** WIP 라벨: 작업지시번호. */
  workOrderNo?: string | null
  /** 원자재 LOT 라벨: 규격(있을 때만, 품목코드 줄에 함께 표시). */
  spec?: string | null
  /** ITEM_BARCODE(레거시): `{itemCode}|{lotId}` 바코드의 lotId. */
  lotId?: string | null
  quantity?: number | null
  uom?: string | null
  /** 표시용 일자(YYYY-MM-DD). */
  date: string
  /** 입고일 / 생산일 등. */
  dateLabel: string
  /**
   * 시험용 라벨(현장 출력/스캔 테스트). 실제 LOT/WIP 가 아니다 — lotNo(또는 WIP 라벨의 wipId)는 반드시 TEST- 임시 번호이며
   * 라벨에 "시험용" 이 표시된다. LOT 저장·재고·입출고·재공과 무관하다.
   */
  test?: boolean
}

// ─── 시험용 라벨 ─────────────────────────────────────────────────────────────

export const TEST_LOT_PREFIX = "TEST-"
export const TEST_LABEL_MARK = "시험용"
const TEST_LOT_PATTERN = /^TEST-[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** 시험용 임시 LOT 번호 형식(TEST-로 시작, 영문/숫자/.-_ 만). 실제 LOT 번호와 구분하기 위한 접두사다. */
export function isValidTestLotNo(value: unknown): value is string {
  return typeof value === "string" && TEST_LOT_PATTERN.test(value.trim())
}

/** 기본 임시 LOT 번호: TEST-YYYYMMDD-001, -002 … (한국 날짜). */
export function makeTestLotNos(count: number, date: Date = new Date()): string[] {
  const ymd = formatLabelDate(date).replace(/-/g, "")
  return Array.from({ length: Math.max(0, count) }, (_, i) => `${TEST_LOT_PREFIX}${ymd}-${String(i + 1).padStart(3, "0")}`)
}

export function clampQrMm(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return LABEL_QR_MM_DEFAULT
  return Math.min(LABEL_QR_MM_MAX, Math.max(LABEL_QR_MM_MIN, n))
}

/** 텍스트 영역 가로폭(mm). */
export function labelTextWidthMm(qrMm: number = LABEL_QR_MM_DEFAULT): number {
  return LABEL_WIDTH_MM - LABEL_PADDING_MM * 2 - qrMm - LABEL_GAP_MM
}

/** 텍스트 영역 세로 높이(mm). */
export function labelContentHeightMm(): number {
  return LABEL_HEIGHT_MM - LABEL_PADDING_MM * 2
}

// ─── 문자 폭 추정(폰트 비의존, 보수적) ──────────────────────────────────────────

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
    (code >= 0x2e80 && code <= 0x9fff) || // CJK
    (code >= 0xac00 && code <= 0xd7af) || // 한글 음절
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

/** 비례폭 글꼴 기준 문자 폭(em 단위). 실제보다 약간 크게 잡아 넘침을 막는다. */
export function charWidthEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  if (isWide(code)) return 1.0
  if (ch === " ") return 0.32
  if ("il.,:;|!'`".includes(ch)) return 0.34
  if ("()[]{}-/\\ft".includes(ch)) return 0.42
  if (ch >= "A" && ch <= "Z") return 0.72
  if (ch >= "0" && ch <= "9") return 0.62
  if ("mwMW".includes(ch)) return 0.9
  return 0.62
}

/** 고정폭(mono) 글꼴 기준 문자 폭(em). 한글 등 넓은 문자는 1em. */
export function monoCharWidthEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return isWide(code) ? 1.0 : 0.62
}

export function estimateTextWidthPt(text: string, fontPt: number, mono = false): number {
  let em = 0
  for (const ch of Array.from(text)) em += mono ? monoCharWidthEm(ch) : charWidthEm(ch)
  return em * fontPt
}

/**
 * maxWidthPt 안에 들어가도록 최대 maxLines 줄로 나눈다.
 * 공백이 있으면 공백에서, 없으면(한글/긴 코드) 글자 단위로 줄바꿈한다. mono(LOT 번호)는 항상 글자 단위로 나눈다.
 * 넘치면 마지막 줄을 말줄임(…)으로 줄이고 truncated=true 로 알린다.
 */
export function wrapText(
  text: string,
  fontPt: number,
  maxWidthPt: number,
  maxLines: number,
  mono = false,
): { lines: string[]; truncated: boolean } {
  const chars = Array.from(text.replace(/\s+/g, " ").trim())
  const widthOf = (s: string) => estimateTextWidthPt(s, fontPt, mono)
  const lines: string[] = []
  let current = ""
  let index = 0

  while (index < chars.length) {
    const ch = chars[index]
    if (current === "" && ch === " ") {
      index += 1
      continue
    }
    if (widthOf(current + ch) <= maxWidthPt) {
      current += ch
      index += 1
      continue
    }
    // 현재 줄이 가득 참 → 줄바꿈(가능하면 마지막 공백에서)
    if (lines.length === maxLines - 1) {
      // 마지막 줄: 남은 글자가 더 있으므로 말줄임
      return { lines: [...lines, ellipsize(current + chars.slice(index).join(""), widthOf, maxWidthPt)], truncated: true }
    }
    const lastSpace = current.lastIndexOf(" ")
    if (!mono && lastSpace > 0 && ch !== " ") {
      lines.push(current.slice(0, lastSpace))
      current = current.slice(lastSpace + 1)
    } else {
      lines.push(current.trimEnd())
      current = ""
    }
  }
  if (current.trim() !== "" || lines.length === 0) lines.push(current.trimEnd())
  return { lines, truncated: false }
}

function ellipsize(text: string, widthOf: (s: string) => number, maxWidthPt: number): string {
  const chars = Array.from(text.trim())
  let out = ""
  for (const ch of chars) {
    if (widthOf(out + ch + "…") > maxWidthPt) break
    out += ch
  }
  return out.trimEnd() + "…"
}

// ─── 레이아웃 계산 ───────────────────────────────────────────────────────────

export type LabelLayout = {
  kind: LabelKind
  qrMm: number
  textWidthMm: number
  companyPt: number
  name: { fontPt: number; lines: string[]; truncated: boolean }
  /** 품목코드 줄(고정폭, 1줄): 원자재=코드+규격, WIP=코드+WO, 그 외=코드. */
  codePt: number
  codeText: string
  /** 식별값 줄: LOT 라벨 `LOT <번호>`, WIP 라벨 `WIP <식별값>`. 한 줄 우선, 최후 2줄. */
  lot: { fontPt: number; lines: string[]; truncated: boolean } | null
  /** 마지막 굵은 줄: LOT 라벨 `수량 …`, WIP 라벨 `제조번호 …`. */
  last: { fontPt: number; text: string } | null
  qtyPt: number
  /** 계산상 필요한 텍스트 높이(pt)와 사용 가능 높이(pt). */
  usedHeightPt: number
  availableHeightPt: number
  fits: boolean
}

const LINE_HEIGHT = 1.15
const ROW_GAP_PT = 0.6
const COMPANY_PT = 8
const CODE_PT = 8.5
const NAME_SIZES = [11, 10, 9, 8.5, 8]
const LOT_SIZES = [10, 9, 8.5, 8, 7.5]
const LAST_SIZES = [11, 10, 9]

/** 한 줄 높이(pt). */
function lineHeightPt(fontPt: number): number {
  return fontPt * LINE_HEIGHT
}

type LayoutInput = Pick<
  LabelData,
  "kind" | "itemName" | "itemCode" | "lotNo" | "quantity" | "uom" | "wipId" | "manufacturingNo" | "workOrderNo" | "spec"
>

/** 마지막 굵은 줄 텍스트(없으면 null). */
function lastRowText(data: LayoutInput): string | null {
  if (data.kind === "WIP_QR") {
    const no = data.manufacturingNo?.trim()
    return no ? `제조번호 ${no}` : null
  }
  const qty = formatLabelQuantity(data.quantity, data.uom)
  return qty ? `수량 ${qty}` : null
}

/** 품목코드 줄 텍스트. */
function codeRowText(data: LayoutInput): string {
  const parts = [data.itemCode.trim()]
  if (data.kind === "WIP_QR") {
    const wo = data.workOrderNo?.trim()
    if (wo) parts.push(/^WO/i.test(wo) ? wo : `WO ${wo}`)
  } else if (data.spec?.trim()) {
    parts.push(data.spec.trim())
  }
  return parts.join(" · ")
}

/**
 * 29mm 높이를 넘지 않도록 품목명/식별값 글자 크기와 줄 수를 정한다.
 * 큰 글자 우선으로 조합을 시도하고, 모두 실패하면 가장 작은 글자 + 말줄임으로 폴백한다.
 * (QR 에는 식별값 전체가 들어 있으므로 텍스트 말줄임이 추적성을 해치지 않는다.)
 */
export function computeLabelLayout(data: LayoutInput, qrMmInput: number = LABEL_QR_MM_DEFAULT): LabelLayout {
  const qrMm = clampQrMm(qrMmInput)
  const isQr = data.kind !== "ITEM_BARCODE"
  // ITEM_BARCODE(레거시): 폭 전체를 쓰고 하단에 6mm 바코드 띠(+간격 2mm)를 둔다.
  const textWidthMm = isQr ? labelTextWidthMm(qrMm) : LABEL_WIDTH_MM - LABEL_PADDING_MM * 2
  const textWidthPt = textWidthMm * MM_TO_PT
  const availableHeightPt = (isQr ? labelContentHeightMm() : labelContentHeightMm() - 8) * MM_TO_PT
  const maxNameLines = isQr ? 2 : 1
  const idText = data.kind === "WIP_QR" ? `WIP ${data.wipId ?? ""}`.trim() : data.kind === "LOT_QR" ? `LOT ${data.lotNo ?? ""}`.trim() : ""

  const codeText = wrapText(codeRowText(data), CODE_PT, textWidthPt, 1, true).lines[0] ?? ""
  const lastRaw = lastRowText(data)

  let fallback: LabelLayout | null = null
  for (const namePt of NAME_SIZES) {
    const name = wrapText(data.itemName, namePt, textWidthPt, maxNameLines)
    if (name.truncated && namePt !== NAME_SIZES[NAME_SIZES.length - 1]) continue
    for (const lotPt of isQr ? LOT_SIZES : [0]) {
      let lot: LabelLayout["lot"] = null
      if (isQr) {
        // 식별값은 한 줄을 우선하고, 가장 작은 글자에서만 두 줄을 허용한다.
        const oneLine = wrapText(idText, lotPt, textWidthPt, 1, true)
        if (!oneLine.truncated) {
          lot = { fontPt: lotPt, ...oneLine }
        } else if (lotPt === LOT_SIZES[LOT_SIZES.length - 1]) {
          lot = { fontPt: lotPt, ...wrapText(idText, lotPt, textWidthPt, 2, true) }
        } else {
          continue
        }
      }
      // 마지막 줄: 한 줄에 들어가는 가장 큰 글자, 안 들어가면 말줄임.
      let last: LabelLayout["last"] = null
      if (lastRaw) {
        let chosen = LAST_SIZES[LAST_SIZES.length - 1]
        let text = wrapText(lastRaw, chosen, textWidthPt, 1).lines[0]
        for (const size of LAST_SIZES) {
          if (estimateTextWidthPt(lastRaw, size) <= textWidthPt) {
            chosen = size
            text = lastRaw
            break
          }
        }
        last = { fontPt: chosen, text }
      }
      const used =
        lineHeightPt(COMPANY_PT) +
        name.lines.length * lineHeightPt(namePt) +
        lineHeightPt(CODE_PT) +
        (lot ? lot.lines.length * lineHeightPt(lot.fontPt) : 0) +
        (last ? lineHeightPt(last.fontPt) : 0) +
        ROW_GAP_PT * (2 + (lot ? 1 : 0) + (last ? 1 : 0))
      const layout: LabelLayout = {
        kind: data.kind,
        qrMm,
        textWidthMm,
        companyPt: COMPANY_PT,
        name: { fontPt: namePt, ...name },
        codePt: CODE_PT,
        codeText,
        lot,
        last,
        qtyPt: last?.fontPt ?? LAST_SIZES[0],
        usedHeightPt: used,
        availableHeightPt,
        fits: used <= availableHeightPt,
      }
      if (layout.fits) return layout
      fallback = layout
    }
  }
  // 모든 조합이 높이를 넘으면 가장 작은 글자 조합(마지막 시도)을 쓰되 fits=false 로 알린다.
  return (
    fallback ?? {
      kind: data.kind,
      qrMm,
      textWidthMm,
      companyPt: COMPANY_PT,
      name: { fontPt: NAME_SIZES[NAME_SIZES.length - 1], ...wrapText(data.itemName, 8, textWidthPt, maxNameLines) },
      codePt: CODE_PT,
      codeText,
      lot: null,
      last: null,
      qtyPt: LAST_SIZES[0],
      usedHeightPt: availableHeightPt,
      availableHeightPt,
      fits: false,
    }
  )
}

// ─── 출력 가능 여부 · 포맷 ───────────────────────────────────────────────────

export type LabelBlock = { printable: true } | { printable: false; reason: string }

/**
 * QR 라벨 출력 가능 여부. 식별값(LOT 번호 / WIP 식별값)이 없으면 임의 QR 식별자를 만들거나 CODE128 로 대체하지 않고 사유를 알린다.
 * ITEM_BARCODE(레거시 품목 바코드)는 호출자가 명시적으로 허용한 화면(출하 일괄 등)에서만 쓴다.
 */
export function getLabelBlock(
  data: Pick<LabelData, "kind" | "itemCode" | "itemName" | "lotNo" | "test" | "labelType" | "wipId">,
): LabelBlock {
  if (!data.itemCode?.trim() || !data.itemName?.trim()) {
    return { printable: false, reason: "품목 정보가 없어 라벨을 출력할 수 없습니다." }
  }
  if (data.kind === "ITEM_BARCODE") return { printable: true }

  // 라벨 유형과 QR 종류가 어긋나면 거부(WIP 라벨에 LOT QR, LOT 라벨에 WIP QR 방지)
  if (data.labelType && LABEL_TYPE_META[data.labelType].kind !== data.kind) {
    return { printable: false, reason: `[${data.itemCode}] 라벨 유형(${LABEL_TYPE_META[data.labelType].tag})과 QR 종류가 맞지 않습니다.` }
  }

  if (data.kind === "WIP_QR") {
    if (data.test) {
      return isValidTestLotNo(data.wipId)
        ? { printable: true }
        : { printable: false, reason: `[${data.itemCode}] 시험용 WIP 식별값은 TEST- 로 시작하는 영문/숫자 임시 값이어야 합니다(예: TEST-WIP-20261027-001).` }
    }
    const wipId = data.wipId?.trim()
    if (!wipId) {
      return { printable: false, reason: `[${data.itemCode}] 재공(WIP) 식별값이 없어 QR 라벨을 출력할 수 없습니다. WIP 이 생성(자재출고 등)된 후 출력해 주세요.` }
    }
    try {
      encodeWipQr(wipId)
    } catch (error) {
      return { printable: false, reason: `[${data.itemCode}] ${error instanceof Error ? error.message : "WIP 식별값으로 QR 을 만들 수 없습니다."}` }
    }
    return { printable: true }
  }

  if (data.test) {
    return isValidTestLotNo(data.lotNo)
      ? { printable: true }
      : { printable: false, reason: `[${data.itemCode}] 시험용 LOT 번호는 TEST- 로 시작하는 영문/숫자 임시 번호여야 합니다(예: TEST-20261026-001).` }
  }
  const lotNo = data.lotNo?.trim()
  if (!lotNo) {
    return {
      printable: false,
      reason: `[${data.itemCode}] LOT 번호가 없어 QR 라벨을 출력할 수 없습니다. LOT 번호가 확정(입고 완료)된 후 출력해 주세요.`,
    }
  }
  try {
    encodeLotQr(lotNo)
  } catch (error) {
    return {
      printable: false,
      reason: `[${data.itemCode}] ${error instanceof Error ? error.message : "LOT 번호로 QR 을 만들 수 없습니다."}`,
    }
  }
  return { printable: true }
}

export function formatLabelQuantity(quantity: number | null | undefined, uom?: string | null): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) return ""
  const text = quantity.toLocaleString("ko-KR", { maximumFractionDigits: 6 })
  return uom?.trim() ? `${text} ${uom.trim()}` : text
}

/** 한국 시간 기준 YYYY-MM-DD. */
export function formatLabelDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
  return parts
}
