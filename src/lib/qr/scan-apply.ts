/**
 * 스캔한 LOT 를 화면의 출고/출하 후보 목록에 적용하는 순수 계획 함수 (Phase 11).
 *
 * 화면은 이 함수의 결과대로 "선택"만 하고, 실제 검증/차감은 제출 시 기존 Server Action(DG-014 등)이 다시 한다.
 * 이미 선택된 LOT 는 중복 추가하지 않는다(카메라 연속 인식/더블 스캔 방어).
 */

export type ScanLotOption = {
  lotId: string
  lotNo: string
  warehouseId?: string
  qtyAvailable: number
}

export type ScanCandidate = {
  /** 출고 품목 id 또는 출하 행 식별자 */
  key: string
  options: ScanLotOption[]
  /** 이미 선택된 lotId 목록 */
  selectedLotIds: string[]
}

export type ScanPlan =
  | { kind: "SELECT"; key: string; option: ScanLotOption }
  | { kind: "ALREADY_SELECTED"; key: string; lotNo: string }
  | { kind: "NOT_IN_OPTIONS"; lotNo: string }

export function planLotScanSelection(lotNo: string, candidates: ScanCandidate[]): ScanPlan {
  const target = String(lotNo ?? "").trim()
  for (const candidate of candidates) {
    const matches = candidate.options.filter((o) => o.lotNo === target)
    if (matches.length === 0) continue
    if (matches.some((o) => candidate.selectedLotIds.includes(o.lotId))) {
      return { kind: "ALREADY_SELECTED", key: candidate.key, lotNo: target }
    }
    // 같은 LOT 가 여러 창고에 있으면 가용수량이 큰 쪽을 먼저 제안한다.
    const best = [...matches].sort((a, b) => b.qtyAvailable - a.qtyAvailable)[0]
    return { kind: "SELECT", key: candidate.key, option: best }
  }
  return { kind: "NOT_IN_OPTIONS", lotNo: target }
}
