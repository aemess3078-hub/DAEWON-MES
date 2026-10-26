/**
 * 화면(자재입고/자재출고)의 입력 상태 → LOT QR 라벨 대상 목록 변환 (순수 함수).
 *
 * 원칙
 *  - LOT 번호가 있는 항목만 QR 라벨이 된다. LOT 이 없는 품목에 임의 QR/LOT 번호를 만들지 않는다.
 *  - 라벨이 되지 못한 항목은 조용히 사라지지 않고 notices(사유)로 사용자에게 알린다.
 *  - 수량은 화면에서 사용자가 입력한 실제 값(LOT 분할행별 수량)을 그대로 쓴다. 합산/배분/반올림하지 않는다.
 */

export type LabelItem = {
  itemCode: string
  itemName: string
  lotNo: string
  quantity: number
  uom: string
  dateLabel: string
}

/** 화면에 있는 출력 후보 한 줄(LOT 유무와 무관). 시험용 라벨(임시 TEST- 번호)을 만드는 재료로만 쓴다. */
export type TestLabelCandidate = {
  itemCode: string
  itemName: string
  quantity: number
  uom: string
  dateLabel: string
}

export type LabelPlan = {
  /** 실제 LOT 번호가 있는 라벨(실제 업무용). */
  items: LabelItem[]
  /** 라벨이 되지 못한 항목의 사유. */
  notices: string[]
  /** 화면의 모든 출력 후보 — 시험용 라벨 전용. 실제 LOT 번호는 들어 있지 않다. */
  candidates: TestLabelCandidate[]
}

const tag = (code: string, name: string) => `[${code}] ${name}`

export const NOT_LOT_TRACKED_NOTICE =
  "LOT 관리 품목이 아니어서 LOT QR 라벨 대상이 아닙니다(품목 마스터의 'LOT 관리' 설정은 관리자가 결정합니다)."

// ─── 자재입고 ────────────────────────────────────────────────────────────────

export type ReceiptLabelSource = {
  itemCode: string
  itemName: string
  uom: string
  isLotTracked: boolean
  lotNo: string
  /** 금회 입고수량 */
  receivedQty: number
  /** 합격수량(재고에 반영되는 수량). 라벨 수량으로 우선 사용. */
  acceptedQty: number
}

export function buildReceiptLabelPlan(rows: ReceiptLabelSource[], opts: { dateLabel?: string } = {}): LabelPlan {
  const dateLabel = opts.dateLabel ?? "입고일"
  const items: LabelItem[] = []
  const notices: string[] = []
  const candidates: TestLabelCandidate[] = []
  for (const row of rows) {
    if (!(row.receivedQty > 0)) continue
    candidates.push({
      itemCode: row.itemCode,
      itemName: row.itemName,
      quantity: row.acceptedQty > 0 ? row.acceptedQty : row.receivedQty,
      uom: row.uom,
      dateLabel,
    })
    if (!row.isLotTracked) {
      notices.push(`${tag(row.itemCode, row.itemName)}: ${NOT_LOT_TRACKED_NOTICE}`)
      continue
    }
    const lotNo = row.lotNo.trim()
    if (!lotNo) {
      notices.push(`${tag(row.itemCode, row.itemName)}: LOT 번호가 아직 정해지지 않아 라벨을 만들 수 없습니다. LOT 번호를 직접 입력(또는 자동채번)한 뒤 확인해 주세요.`)
      continue
    }
    items.push({
      itemCode: row.itemCode,
      itemName: row.itemName,
      lotNo,
      quantity: row.acceptedQty > 0 ? row.acceptedQty : row.receivedQty,
      uom: row.uom,
      dateLabel,
    })
  }
  return { items, notices, candidates }
}

// ─── 자재출고 ────────────────────────────────────────────────────────────────

export type IssueLabelMaterial = {
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  /** 화면의 isLotManaged(item) 결과 (LOT 추적 품목 또는 반제품). */
  lotManaged: boolean
  /** 비LOT 품목의 출고수량(시험용 라벨 후보 수량). LOT 관리 품목은 분할행 수량을 쓴다. */
  issueQty?: number
}

export type IssueLabelSplit = {
  /** 선택한 LOT 행("lotId:warehouseId") — 비어 있으면 LOT 미선택 */
  lotValue: string
  qty: string
}

export type IssueLabelLot = { key: string; lotNo: string }

/**
 * 선택한 원자재 LOT 별로 라벨 1장씩. LOT 분할 출고는 분할행마다 그 행의 출고수량으로 1장이 된다.
 * @param splitsByItem itemId → 분할행
 * @param lotByKey itemId → (lotValue → LOT)
 */
export function buildIssueLabelPlan(
  materials: IssueLabelMaterial[],
  splitsByItem: Record<string, IssueLabelSplit[]>,
  lotByKey: (itemId: string, lotValue: string) => IssueLabelLot | null,
  opts: { dateLabel?: string } = {},
): LabelPlan {
  const dateLabel = opts.dateLabel ?? "출고일"
  const items: LabelItem[] = []
  const notices: string[] = []
  const candidates: TestLabelCandidate[] = []
  const candidate = (material: IssueLabelMaterial, quantity: number) =>
    candidates.push({ itemCode: material.itemCode, itemName: material.itemName, quantity, uom: material.uom, dateLabel })
  for (const material of materials) {
    const label = tag(material.itemCode, material.itemName)
    if (!material.lotManaged) {
      if (Number(material.issueQty) > 0) candidate(material, Number(material.issueQty))
      notices.push(`${label}: ${NOT_LOT_TRACKED_NOTICE}`)
      continue
    }
    const rows = (splitsByItem[material.itemId] ?? []).filter((row) => Number(row.qty) > 0)
    if (rows.length === 0) {
      notices.push(`${label}: 출고할 LOT 와 수량을 입력하면 LOT 별 QR 라벨이 만들어집니다.`)
      continue
    }
    for (const row of rows) {
      candidate(material, Number(row.qty))
      const lot = row.lotValue ? lotByKey(material.itemId, row.lotValue) : null
      if (!lot) {
        notices.push(`${label}: 수량(${row.qty})이 입력된 행에 LOT 가 선택되지 않았습니다. LOT 를 선택하면 라벨이 만들어집니다.`)
        continue
      }
      items.push({
        itemCode: material.itemCode,
        itemName: material.itemName,
        lotNo: lot.lotNo,
        quantity: Number(row.qty),
        uom: material.uom,
        dateLabel,
      })
    }
  }
  return { items, notices, candidates }
}
