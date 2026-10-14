/**
 * Dry-run 요약 (순수) — 건수만 담는다. 고객명/품명/연락처 같은 실제 값은 넣지 않는다(문서/Git 안전).
 * 상세(provenance 포함)는 분석 결과 JSON 으로 별도 출력하며 Git 에 커밋하지 않는다.
 */

import { countGrades, type GradeCounts } from "./analyze"
import type { ReconcileSummary } from "./reconcile"
import type { ApprovedMasterDataset, ItemTypeName, MasterAnalysis, RawExtraction } from "./types"

export type DryRunSummary = {
  items: {
    candidates: number
    byGrade: GradeCounts
    inferredType: Record<ItemTypeName | "UNDETERMINED", number>
    byGradeAndType: Record<string, GradeCounts>
    issueHistogram: Record<string, number>
    fromSettings: number
    fromProductList: number
    orderOnly: number
    stockOnly: number
  }
  bom: {
    parents: number
    lines: number
    byGrade: GradeCounts
    lineByGrade: GradeCounts
    invalidQtyLines: number
    missingComponentLines: number
    selfReferenceLines: number
    cycleLines: number
    cycles: number
    duplicateComponentGroups: number
    duplicateComponentLines: number
    maxDepth: number
    finishedWithoutBom: number
    issueHistogram: Record<string, number>
  }
  partners: { candidates: number; customers: number; suppliers: number; both: number; nearDuplicateGroups: number; byGrade: GradeCounts; customerOccurrences: number }
  itemSuppliers: { candidates: number; byGrade: GradeCounts; distinctItems: number; distinctSuppliers: number }
  crossCheck: { stockSheetMismatches: number; sameNameDifferentCodeGroups: number; sameNameDifferentCodeItems: number }
  reconcile?: ReconcileSummary
}

function histogram(issues: Array<{ code: string }>): Record<string, number> {
  const h: Record<string, number> = {}
  issues.forEach((i) => {
    h[i.code] = (h[i.code] ?? 0) + 1
  })
  return h
}

export function summarizeAnalysis(a: MasterAnalysis, ex: RawExtraction, reconcile?: ReconcileSummary): DryRunSummary {
  const typeCounts: DryRunSummary["items"]["inferredType"] = { FINISHED: 0, SEMI_FINISHED: 0, RAW_MATERIAL: 0, CONSUMABLE: 0, UNDETERMINED: 0 }
  const byGradeAndType: Record<string, GradeCounts> = {}
  a.items.forEach((i) => {
    const t = i.proposed.itemType ?? "UNDETERMINED"
    typeCounts[t] += 1
    const bucket = (byGradeAndType[t] = byGradeAndType[t] ?? { total: 0, SAFE: 0, REVIEW: 0, REJECT: 0 })
    bucket.total += 1
    bucket[i.grade] += 1
  })
  const bomLines = a.boms.flatMap((b) => b.lines)
  const dupLines = a.duplicateComponents.reduce((s, d) => s + d.lineCount, 0)
  const lineIssues = bomLines.flatMap((l) => l.issues)
  const has = (code: string) => bomLines.filter((l) => l.issues.some((i) => i.code === code)).length
  return {
    items: {
      candidates: a.items.length,
      byGrade: countGrades(a.items),
      inferredType: typeCounts,
      byGradeAndType,
      issueHistogram: histogram(a.items.flatMap((i) => i.issues)),
      fromSettings: a.items.filter((i) => i.flags.inSettings).length,
      fromProductList: a.items.filter((i) => i.flags.isBomParent || (!i.flags.inSettings && !i.flags.orderOnly && !i.flags.stockSheetOnly)).length,
      orderOnly: a.items.filter((i) => i.flags.orderOnly).length,
      stockOnly: a.items.filter((i) => i.flags.stockSheetOnly).length,
    },
    bom: {
      parents: a.boms.length,
      lines: bomLines.length,
      byGrade: countGrades(a.boms),
      lineByGrade: countGrades(bomLines),
      invalidQtyLines: has("INVALID_QTY"),
      missingComponentLines: has("COMPONENT_NOT_FOUND") + has("COMPONENT_CODE_MISSING"),
      selfReferenceLines: has("SELF_REFERENCE"),
      cycleLines: has("BOM_CYCLE"),
      cycles: a.cycles.length,
      duplicateComponentGroups: a.duplicateComponents.length,
      duplicateComponentLines: dupLines,
      maxDepth: a.maxBomDepth,
      finishedWithoutBom: a.finishedWithoutBom.length,
      issueHistogram: histogram(lineIssues),
    },
    partners: {
      candidates: a.partners.length,
      customers: a.partners.filter((p) => p.partnerType === "CUSTOMER").length,
      suppliers: a.partners.filter((p) => p.partnerType === "SUPPLIER").length,
      both: a.partners.filter((p) => p.partnerType === "BOTH").length,
      nearDuplicateGroups: a.partnerNearDuplicates.length,
      byGrade: countGrades(a.partners),
      customerOccurrences: ex.orderRefs.customers.reduce((s, c) => s + c.count, 0),
    },
    itemSuppliers: {
      candidates: a.itemSuppliers.length,
      byGrade: countGrades(a.itemSuppliers),
      distinctItems: new Set(a.itemSuppliers.map((s) => s.itemCode)).size,
      distinctSuppliers: new Set(a.itemSuppliers.map((s) => s.supplierName)).size,
    },
    crossCheck: {
      stockSheetMismatches: a.stockSheetMismatches.length,
      sameNameDifferentCodeGroups: a.sameNameDifferentCode.length,
      sameNameDifferentCodeItems: a.sameNameDifferentCode.reduce((s, g) => s + g.codes.length, 0),
    },
    reconcile,
  }
}

/** Seed 관점 요약: 운영 정보 행은 구조상 항상 0 */
export function summarizeSeedDataset(d: ApprovedMasterDataset) {
  return {
    items: d.items.length,
    byType: d.items.reduce<Record<string, number>>((acc, i) => {
      acc[i.itemType] = (acc[i.itemType] ?? 0) + 1
      return acc
    }, {}),
    boms: d.boms.length,
    bomLines: d.boms.reduce((s, b) => s + b.lines.length, 0),
    customers: d.partners.filter((p) => p.partnerType === "CUSTOMER" || p.partnerType === "BOTH").length,
    suppliers: d.partners.filter((p) => p.partnerType === "SUPPLIER" || p.partnerType === "BOTH").length,
    itemSuppliers: d.itemSuppliers.length,
    transaction: { inventory: 0, salesOrder: 0, purchaseOrder: 0, receipt: 0, shipment: 0, productionResult: 0, wip: 0 },
    excluded: d.excluded,
  }
}
