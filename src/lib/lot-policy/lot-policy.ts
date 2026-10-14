/**
 * LOT 추적 정책 분류기 (Phase 11 / DG-001) — 순수 함수. DB 접근/쓰기 없음.
 *
 * 기본 방향(확정 정책)
 *  - 생산에 투입되는 RAW → LOT 추적(공급사 역추적)
 *  - 고객에게 출하되는 FINISHED → LOT 추적
 *  - SEMI_FINISHED(WIP) → 물리 식별 필요성이 있을 때만(자동으로 켜지 않는다 → REVIEW_REQUIRED)
 *  - 비생산/참조 품목, 실제로 LOT 추적이 불필요한 품목 → NOT_REQUIRED
 *  - 공정마다 새 LOT/QR 을 만들지 않는다(DB 공정이력과 물리 QR 은 별개)
 *
 * 이 모듈은 "제안"만 계산한다. Production Item.isLotTracked 일괄 수정은 별도 승인 후 수행한다.
 */

export type LotPolicyLevel = "REQUIRED" | "RECOMMENDED" | "OPTIONAL" | "NOT_REQUIRED" | "REVIEW_REQUIRED"

export type LotPolicyItemFacts = {
  id: string
  code: string
  name: string
  itemType: string
  status: string
  isLotTracked: boolean
  /** 이 품목을 완제품(BOM parent)으로 갖는 BOM 이 있다 */
  isBomParent: boolean
  /** 이 품목이 어떤 BOM 의 구성품이다 */
  isBomComponent: boolean
  /** 수주/출하 라인에 사용된 적이 있다 */
  hasSalesUsage: boolean
  /** 발주 라인에 사용된 적이 있다 */
  hasPurchaseUsage: boolean
  /** 재고 잔액 행이 있다 */
  hasInventory: boolean
}

export type LotPolicyProposal = {
  id: string
  code: string
  name: string
  itemType: string
  currentLotTracked: boolean
  isBomParent: boolean
  isBomComponent: boolean
  level: LotPolicyLevel
  /** true=LOT 추적 제안 / false=불필요 / null=사람이 판단 */
  recommendedLotTracked: boolean | null
  /** 현재 값과 제안이 다르면 변경 제안 */
  change: "ENABLE_PROPOSED" | "DISABLE_PROPOSED" | "KEEP" | "REVIEW"
  reason: string
}

export function classifyLotPolicy(facts: LotPolicyItemFacts): LotPolicyProposal {
  let level: LotPolicyLevel
  let reason: string

  if (facts.status !== "ACTIVE") {
    if (facts.hasInventory) {
      level = "REVIEW_REQUIRED"
      reason = "비활성/단종 품목이나 재고 잔액이 있어 처리 방침 확인 필요"
    } else {
      level = "NOT_REQUIRED"
      reason = "비활성/단종 품목"
    }
  } else if (facts.itemType === "FINISHED") {
    if (facts.hasSalesUsage || facts.isBomParent) {
      level = "REQUIRED"
      reason = facts.hasSalesUsage
        ? "고객 출하 완제품 — 출하/클레임 시 완제품 LOT 역추적 필수"
        : "BOM 으로 생산하는 완제품 — 완제품 LOT 필수"
    } else {
      level = "RECOMMENDED"
      reason = "완제품이나 BOM/수주 이력이 없음 — 출하 대비 LOT 추적 권장"
    }
  } else if (facts.itemType === "RAW_MATERIAL") {
    if (facts.isBomComponent) {
      level = "REQUIRED"
      reason = "생산 투입 원자재 — 입고 LOT·공급사까지 역추적 필수"
    } else if (facts.hasPurchaseUsage || facts.hasInventory) {
      level = "RECOMMENDED"
      reason = "BOM 구성품은 아니나 구매/재고 이력이 있음 — LOT 추적 권장"
    } else {
      level = "OPTIONAL"
      reason = "BOM/구매/재고 이력 없음 — 필요 시 지정"
    }
  } else if (facts.itemType === "SEMI_FINISHED") {
    level = "REVIEW_REQUIRED"
    reason = "반제품(WIP) — 공정간 이력은 WorkOrder/WIP 로 유지. 혼입·외주이동 등 물리 식별 필요 시에만 LOT/QR 지정"
  } else if (facts.itemType === "CONSUMABLE") {
    if (facts.isBomComponent) {
      level = "REVIEW_REQUIRED"
      reason = "BOM 에 투입되는 소모품 — 추적 필요 여부 확인"
    } else {
      level = "NOT_REQUIRED"
      reason = "비생산/소모 품목"
    }
  } else {
    level = "REVIEW_REQUIRED"
    reason = `알 수 없는 품목유형(${facts.itemType}) — 확인 필요`
  }

  const recommended: boolean | null =
    level === "REQUIRED" || level === "RECOMMENDED" ? true : level === "REVIEW_REQUIRED" ? null : false

  let change: LotPolicyProposal["change"]
  if (recommended === null) change = "REVIEW"
  else if (recommended && !facts.isLotTracked) change = "ENABLE_PROPOSED"
  else if (!recommended && facts.isLotTracked) change = "DISABLE_PROPOSED"
  else change = "KEEP"

  return {
    id: facts.id,
    code: facts.code,
    name: facts.name,
    itemType: facts.itemType,
    currentLotTracked: facts.isLotTracked,
    isBomParent: facts.isBomParent,
    isBomComponent: facts.isBomComponent,
    level,
    recommendedLotTracked: recommended,
    change,
    reason,
  }
}

export type LotPolicySummary = {
  total: number
  byLevel: Record<LotPolicyLevel, number>
  byTypeAndLevel: Record<string, Record<LotPolicyLevel, number>>
  changes: Record<LotPolicyProposal["change"], number>
}

const LEVELS: LotPolicyLevel[] = ["REQUIRED", "RECOMMENDED", "OPTIONAL", "NOT_REQUIRED", "REVIEW_REQUIRED"]
const emptyLevels = (): Record<LotPolicyLevel, number> =>
  LEVELS.reduce((acc, l) => ({ ...acc, [l]: 0 }), {} as Record<LotPolicyLevel, number>)

export function summarizeLotPolicy(proposals: LotPolicyProposal[]): LotPolicySummary {
  const byLevel = emptyLevels()
  const byTypeAndLevel: Record<string, Record<LotPolicyLevel, number>> = {}
  const changes: LotPolicySummary["changes"] = { ENABLE_PROPOSED: 0, DISABLE_PROPOSED: 0, KEEP: 0, REVIEW: 0 }
  for (const p of proposals) {
    byLevel[p.level] += 1
    byTypeAndLevel[p.itemType] ??= emptyLevels()
    byTypeAndLevel[p.itemType][p.level] += 1
    changes[p.change] += 1
  }
  return { total: proposals.length, byLevel, byTypeAndLevel, changes }
}
