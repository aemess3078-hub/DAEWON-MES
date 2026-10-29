import type { LabelType } from "@/lib/label/label-spec"
import { formatLabelDate, formatLabelQuantity } from "@/lib/label/label-spec"

/**
 * LOT 관리 화면의 [라벨 출력](이미 등록된 LOT 의 라벨 재출력) 순수 로직 — 서버/DOM 비의존.
 *
 * 라벨의 LOT 번호·품목은 서버에 저장된 값이고, 수량·일자는 "현재 재고"가 아니라 그 LOT 의 원본 입고(RECEIPT 수불) 1건에서 가져온다.
 * 원본 입고를 확인할 수 없으면(입고 이력이 없는 수동 등록 LOT 등) 수량·일자를 만들어 넣지 않고 비워 둔다.
 */

export type LotLabelReceiptKind = "PURCHASE" | "PRODUCTION" | "OTHER"

/** 한 LOT 의 입고(RECEIPT 수불) 1건 — 라벨 수량·일자의 근거. */
export type LotLabelReceipt = {
  /** 수불 id (선택 키) */
  key: string
  txNo: string
  qty: number
  /** 입고 시각(ISO) */
  at: string
  kind: LotLabelReceiptKind
  /** 발주번호 / 작업지시번호(있을 때) */
  refNo: string | null
}

export type LotLabelLot = {
  lotNo: string
  itemCode: string
  itemName: string
  itemType: string
  uom: string
  spec: string | null
}

/** 반환 라벨 항목(BarcodePrintDialog 의 items 와 같은 모양). date 가 빈 문자열이면 라벨에 일자를 표시하지 않는다. */
export type ReprintLabelItem = {
  labelType?: LabelType
  itemCode: string
  itemName: string
  lotNo: string
  spec?: string | null
  quantity?: number
  uom?: string
  dateLabel: string
  date: string
}

/** 품목 유형 → 라벨 유형. 원자재=RAW_LOT, 완제품=FG_LOT, 그 외(반제품·소모품)는 유형 칩 없이 기존 LOT 라벨 모양. */
export function labelTypeForItemType(itemType: string): LabelType | undefined {
  if (itemType === "RAW_MATERIAL") return "RAW_LOT"
  if (itemType === "FINISHED") return "FG_LOT"
  return undefined
}

export function receiptKindForRef(refType: string | null | undefined): LotLabelReceiptKind {
  if (refType === "PURCHASE_ORDER") return "PURCHASE"
  if (refType === "WORK_ORDER") return "PRODUCTION"
  return "OTHER"
}

/** 입고 라벨(원자재 "입고일")·생산 라벨(완제품 "생산일")과 같은 문구. */
export function dateLabelForKind(kind: LotLabelReceiptKind): string {
  return kind === "PRODUCTION" ? "생산일" : "입고일"
}

/** 선택 목록에 보여 줄 입고 건 설명: `2026-10-26 · 100 EA · 발주 PO-001`. */
export function describeReceipt(receipt: LotLabelReceipt, uom: string): string {
  const parts = [formatLabelDate(new Date(receipt.at)), formatLabelQuantity(receipt.qty, uom)]
  if (receipt.refNo) parts.push(`${receipt.kind === "PRODUCTION" ? "작업지시" : "발주"} ${receipt.refNo}`)
  return parts.join(" · ")
}

/**
 * 재출력 라벨 항목. receipt 가 null 이면 수량·일자 없이 LOT 식별 정보(QR·LOT 번호·품목)만 담는다.
 * 현재 재고(InventoryBalance)나 LOT 등록일(createdAt)은 어디에서도 쓰지 않는다.
 */
export function buildReprintLabelItem(lot: LotLabelLot, receipt: LotLabelReceipt | null): ReprintLabelItem {
  const labelType = labelTypeForItemType(lot.itemType)
  return {
    ...(labelType ? { labelType } : {}),
    itemCode: lot.itemCode,
    itemName: lot.itemName,
    lotNo: lot.lotNo,
    spec: labelType === "RAW_LOT" ? lot.spec : null,
    ...(receipt ? { quantity: receipt.qty, uom: lot.uom } : {}),
    dateLabel: receipt ? dateLabelForKind(receipt.kind) : "",
    date: receipt ? formatLabelDate(new Date(receipt.at)) : "",
  }
}

/** 감사 기록에 남길 출력 맥락(100자 이내). */
export function buildReprintContext(lot: Pick<LotLabelLot, "uom">, receipt: LotLabelReceipt | null): string {
  if (!receipt) return "LOT관리 라벨 출력 · 수량·일자 없음"
  return `LOT관리 라벨 출력 · ${describeReceipt(receipt, lot.uom)}`.slice(0, 100)
}
