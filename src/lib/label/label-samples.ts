/**
 * 라벨 3종 디자인 확인용 샘플(시험용). 실제 LOT/WIP 가 아니다 — 모든 식별값이 TEST- 임시 값이고 "시험용" 이 표시된다.
 * 업무 데이터/DB 와 무관하며 출력 이력도 남기지 않는다.
 */
import { formatLabelDate, type LabelData } from "@/lib/label/label-spec"

export function buildSampleLabels(date: string = formatLabelDate()): { rawLot: LabelData; wip: LabelData; fgLot: LabelData } {
  const ymd = date.replace(/-/g, "")
  return {
    rawLot: {
      kind: "LOT_QR",
      labelType: "RAW_LOT",
      test: true,
      itemCode: "RM-STS304-0012",
      itemName: "스테인리스 봉재 STS304 Φ12",
      spec: "Φ12×3000",
      lotNo: `TEST-${ymd}-001`,
      quantity: 120,
      uom: "KG",
      date,
      dateLabel: "입고일",
    },
    wip: {
      kind: "WIP_QR",
      labelType: "WIP",
      test: true,
      itemCode: "FG-BRK-0001",
      itemName: "브라켓 어셈블리 (좌측 보강형)",
      wipId: `TEST-WIP-${ymd}-001`,
      manufacturingNo: `TEST-${ymd}-A01`,
      workOrderNo: "WO-TEST-0001",
      date,
      dateLabel: "발행일",
    },
    fgLot: {
      kind: "LOT_QR",
      labelType: "FG_LOT",
      test: true,
      itemCode: "FG-BRK-0001",
      itemName: "브라켓 어셈블리 (좌측 보강형)",
      lotNo: `TEST-${ymd}-002`,
      quantity: 500,
      uom: "EA",
      date,
      dateLabel: "생산일",
    },
  }
}
