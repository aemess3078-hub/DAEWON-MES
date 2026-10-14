/**
 * 수주 기반 MRP 엔진 타입 (DB 비의존 · 순수 모듈)
 *
 * 이 파일은 Prisma / Supabase / process.env / Date.now() 를 import 하지 않는다.
 * 엔진은 입력(Input)만 받아 결과(Result)를 반환하는 결정적(deterministic) 함수다.
 *
 * 용어 정의 (결과·테스트 공통)
 *  - requirement(소요량)      : 한 수주 라인이 한 자재에 대해 요구하는 수량
 *  - balanceBefore/After      : 해당 수주 처리 직전/직후 자재 예상 잔량 (음수 허용, 0 클램프 없음)
 *  - shortage(결품)           : 해당 수주에서 requirement > 0 이고 balanceAfter < 0
 *  - shortageAtThisDemand     : min(requirement, max(0, -balanceAfter)) — 이 수주가 "새로 부족하게 만든" 수량
 *  - finalShortageQty         : max(0, -finalBalance) — 기간 종료 시점 자재 최종 부족 수량
 *  - firstShortage            : 자재별로 처음 결품이 발생한 수주 라인
 *  - shortageItemCount(결품수): 한 수주에서 결품이 발생한 자재 품목 수 (Excel "결품품목수")
 *  - cumulativeNegativeItemCount(누계): 한 수주 처리 직후 잔량이 음수인 자재 품목 수 (Excel "누계")
 */

/** 시간대 영향이 없는 날짜 문자열 "YYYY-MM-DD" (period.ts 참고) */
export type DateOnly = string

export type OrderMrpMode = "NORMAL" | "EXCEL_COMPAT"

/** 재고 공급자 종류. 엔진은 재고 "값"만 입력받으며 이 값은 결과에 그대로 기록만 한다. */
export type StockProviderType = "ACTUAL" | "EXCEL_THEORETICAL"

export type OrderMrpOrdering = "DUE_DATE" | "INPUT_ORDER"
export type OrderMrpBomExplosion = "MULTI_LEVEL" | "SINGLE_LEVEL"

// ─── Input ───────────────────────────────────────────────────────────────────

/** 수주 라인 1건 = 독립 Demand 1건. 동일 조건이라도 자동 병합하지 않는다. */
export type MrpDemandLine = {
  orderId: string
  orderNo: string
  /** 고객 PO 번호. 있으면 정렬 1차 키(납기 다음)로 orderNo 대신 사용한다. */
  customerPoNo?: string | null
  orderLineId: string
  orderLineNo?: number | null
  /** 제품 식별은 반드시 itemId(관계) / itemCode(MES Item.code). 제품명 문자열 매칭 금지 */
  itemId: string
  itemCode: string
  orderQty: number
  /** 미출하 잔량. NORMAL 모드의 수요 수량. null 이면 orderQty 사용 */
  remainingQty?: number | null
  /** date-only. null 이면 납기 미정 */
  deliveryDate: DateOnly | null
  cancelled?: boolean
  /** 출하 완료(전량) 여부 — NORMAL 에서는 completed 와 동일하게 제외 */
  completed?: boolean
  /** Excel "출고일 존재" 의미. EXCEL_COMPAT 에서만 라인 전체를 제외하는 근거로 사용 */
  shipped?: boolean
  /** 입력 순서(안정 정렬 최종 키). 없으면 배열 위치 */
  originalIndex?: number
}

/** BOM 라인. 호출자가 품목당 사용할 BOM(예: isDefault+ACTIVE) 1개의 라인만 전달한다. */
export type MrpBomLine = {
  parentItemId: string
  componentItemId: string
  componentCode: string
  /** "SEMI_FINISHED" 이면 MULTI_LEVEL 에서 하위 BOM 재귀 전개 */
  componentItemType?: string | null
  qtyPer: number
  scrapRate?: number | null
  lineNo?: number | null
}

export type MrpStockEntry = {
  componentItemId: string
  quantity: number
}

/** 확장 여지(공급업체 등). 계산에는 사용하지 않고 결과에 그대로 실어 보낸다. */
export type MrpComponentInfo = {
  name?: string | null
  uom?: string | null
  supplierId?: string | null
  supplierName?: string | null
}

/**
 * 확정 구매발주의 미입고 잔량(예정입고) 1건 (Phase 5B).
 * 호출자(어댑터)가 상태/외주/기준일 판정을 마친 "유효한" 입고만 전달한다.
 * NORMAL 모드에서만 사용되며 EXCEL_COMPAT 에서는 무시된다(+INFO 경고).
 */
export type MrpScheduledReceipt = {
  /** 입고되는 자재(BOM 구성품) */
  componentItemId: string
  /** 입고예정 수량(> 0, 미입고 잔량) */
  quantity: number
  /** 입고예정일(date-only) */
  expectedDate: DateOnly
  purchaseOrderId: string
  purchaseOrderNo: string
  purchaseOrderItemId?: string | null
  /** 동일 일자/동일 발주번호의 결정적 정렬용. 없으면 배열 위치 */
  originalIndex?: number
}

export type OrderMrpInput = {
  demands: MrpDemandLine[]
  boms: MrpBomLine[]
  stocks: MrpStockEntry[]
  componentInfo?: Record<string, MrpComponentInfo>
  /** Phase 5B 예정입고. 없거나 비어 있으면 기존 계산과 100% 동일하다. */
  scheduledReceipts?: MrpScheduledReceipt[]
}

export type OrderMrpOptions = {
  mode: OrderMrpMode
  /** 납기 시작(포함). null/undefined = 하한 없음 */
  from?: DateOnly | null
  /** 납기 종료(포함). null/undefined = 상한 없음 */
  to?: DateOnly | null
  /**
   * true(기본): from/to 가 비어 있으면 해당 방향을 무제한으로 해석한다("전체" MRP).
   * false: from 과 to 가 모두 필요하며 없으면 RangeError.
   */
  includeOpenEnded?: boolean
  /** 결과에 기록만 한다(엔진은 DB 에서 재고를 읽지 않는다). 기본: NORMAL=ACTUAL, EXCEL_COMPAT=EXCEL_THEORETICAL */
  stockProviderType?: StockProviderType
  /** 기본 DUE_DATE. INPUT_ORDER(Excel 행 순서 계산)는 EXCEL_COMPAT 에서만 허용 */
  ordering?: OrderMrpOrdering
  /** 기본: NORMAL=MULTI_LEVEL, EXCEL_COMPAT=SINGLE_LEVEL */
  bomExplosion?: OrderMrpBomExplosion
  /** 기본: NORMAL=true, EXCEL_COMPAT=false */
  applyScrapRate?: boolean
  /** 다단계 전개 최대 깊이(기본 10, 기존 MES explodeBOM 과 동일) */
  maxBomDepth?: number
  /**
   * (Phase 5E) 반제품(SEMI_FINISHED) 재고 Netting. true 이면 반제품의 가용재고(공용 pool)를 먼저 사용하고
   * **순소요만** 하위 BOM 으로 전개한다. 기본: NORMAL + MULTI_LEVEL = true, EXCEL_COMPAT = false.
   * EXCEL_COMPAT 에서 true 를 요청하면 RangeError(Excel 호환 결과 보호). SINGLE_LEVEL 은 하위 전개가 없어 항상 false.
   */
  netSemiFinished?: boolean
  /**
   * Excel "전체기간 = 오늘까지" 재현용 상한. 현재 시각은 엔진이 읽지 않으므로
   * 호출자가 명시적으로 전달한다. EXCEL_COMPAT 에서만 허용.
   */
  legacyUpperBound?: DateOnly | null
}

export type ResolvedOrderMrpOptions = {
  mode: OrderMrpMode
  from: DateOnly | null
  to: DateOnly | null
  includeOpenEnded: boolean
  stockProviderType: StockProviderType
  ordering: OrderMrpOrdering
  bomExplosion: OrderMrpBomExplosion
  applyScrapRate: boolean
  maxBomDepth: number
  legacyUpperBound: DateOnly | null
  /** (Phase 5E) 반제품 재고 Netting 적용 여부 */
  netSemiFinished: boolean
  /** 수요 수량 기준: REMAINING = remainingQty(없으면 orderQty), ORDER_QTY = orderQty */
  demandQuantityBasis: "REMAINING" | "ORDER_QTY"
  /** 납기 미정(null) 수요 정렬 위치: NORMAL=LAST, EXCEL_COMPAT=FIRST(Excel 빈 날짜=0) */
  nullDeliveryDatePlacement: "FIRST" | "LAST"
}

// ─── Output ──────────────────────────────────────────────────────────────────

export type MrpWarningCode =
  | "MISSING_BOM"
  | "INVALID_BOM_QUANTITY"
  | "BOM_CYCLE_DETECTED"
  | "BOM_DEPTH_EXCEEDED"
  | "DUPLICATE_BOM_COMPONENT"
  | "POSSIBLE_DUPLICATE_DEMAND"
  | "DUPLICATE_ORDER_LINE_ID"
  | "INVALID_DEMAND_QUANTITY"
  | "INVALID_DELIVERY_DATE"
  | "MISSING_DELIVERY_DATE"
  | "NEGATIVE_OPENING_STOCK"
  | "INVALID_STOCK_QUANTITY"
  | "INVALID_SCHEDULED_RECEIPT"
  | "SCHEDULED_RECEIPTS_IGNORED"

export type MrpWarning = {
  code: MrpWarningCode
  severity: "WARNING" | "INFO"
  message: string
  orderId?: string
  orderNo?: string
  orderLineId?: string
  itemId?: string
  itemCode?: string
  componentItemId?: string
  relatedOrderLineIds?: string[]
}

export type ExcludedReason =
  | "CANCELLED"
  | "COMPLETED"
  | "SHIPPED"
  | "NO_REMAINING_QTY"
  | "INVALID_QUANTITY"
  | "OUT_OF_PERIOD"
  | "MISSING_DELIVERY_DATE"
  | "INVALID_DELIVERY_DATE"
  | "MISSING_BOM"
  | "INVALID_BOM"

export type ExcludedOrderLine = {
  reason: ExcludedReason
  orderId: string
  orderNo: string
  orderLineId: string
  orderLineNo: number | null
  itemId: string
  itemCode: string
  deliveryDate: DateOnly | null
  orderQty: number
  remainingQty: number | null
}

export type DemandRequirementLine = {
  componentItemId: string
  componentCode: string
  requirement: number
  balanceBefore: number
  balanceAfter: number
  shortageAtThisDemand: number
  isShortage: boolean
}

/** (Phase 5E) 반제품 1건의 Netting 결과: 총 필요 → 재고 사용 → 순소요(하위 BOM 으로 전개되는 양) */
export type SemiNettingEntry = {
  componentItemId: string
  componentCode: string
  /** 총 필요량(Gross Requirement) */
  grossQty: number
  /** 공용 재고 pool 에서 사용한 수량 */
  usedQty: number
  /** 순소요(Net Requirement) = gross − used. 하위 BOM 은 이 수량만 전개한다 */
  netQty: number
}

/** (Phase 5E) 하위 자재 소요가 어느 상위(반제품/제품)의 몇 개분에서 나왔는지 */
export type NettingContribution = {
  componentItemId: string
  parentItemId: string
  /** 상위 품목의 (순)소요 수량 */
  parentQty: number
  /** 상위 1단위당 소요(스크랩 반영) */
  qtyPer: number
  requirement: number
}

export type OrderMrpDemandResult = {
  /** 처리 순서(1부터). Excel 의 수주 열 순서에 해당 */
  sequence: number
  orderId: string
  orderNo: string
  customerPoNo: string | null
  orderLineId: string
  orderLineNo: number | null
  itemId: string
  itemCode: string
  deliveryDate: DateOnly | null
  orderQty: number
  /** 계산에 사용된 수요 수량 */
  demandQty: number
  /** requirement > 0 인 자재만 (희소) */
  requirements: DemandRequirementLine[]
  /** Excel "결품품목수": requirement>0 이면서 balanceAfter<0 인 자재 수 */
  shortageItemCount: number
  /** Excel "누계": 이 수주 처리 후 balanceAfter<0 인 자재 수 */
  cumulativeNegativeItemCount: number
  /**
   * (Phase 5E) 반제품 재고를 실제로 사용한 수요에서만 채워진다(없으면 undefined = 정적 전개와 동일).
   * semiNetting: 반제품별 총 필요/사용/순소요, nettingContributions: 하위 자재 소요의 출처(상위·수량).
   */
  semiNetting?: SemiNettingEntry[]
  nettingContributions?: NettingContribution[]
}

export type MaterialMovement = {
  sequence: number
  orderLineId: string
  requirement: number
  balanceBefore: number
  balanceAfter: number
  shortageAtThisDemand: number
  isShortage: boolean
}

/**
 * 자재별 시간축 이벤트(Phase 5B). 입고예정(SCHEDULED_RECEIPT)과 소요량이 있는 수요(DEMAND)만 담는 희소 목록이며,
 * 예정입고 입력이 있을 때만 채워진다(없으면 빈 배열). 기존 movements(수요 단계 밀집 이력)는 그대로 유지된다.
 */
export type MaterialTimelineEvent = {
  type: "SCHEDULED_RECEIPT" | "DEMAND"
  date: DateOnly | null
  /** 항상 양수. 입고는 잔량 증가, 수요는 잔량 차감 */
  quantity: number
  balanceBefore: number
  balanceAfter: number
  /** DEMAND: 수요 처리 순서 */
  sequence?: number
  orderId?: string
  orderNo?: string
  orderLineId?: string
  /** SCHEDULED_RECEIPT */
  purchaseOrderId?: string
  purchaseOrderNo?: string
  purchaseOrderItemId?: string | null
  /** DEMAND 이벤트에서 balanceAfter < 0 (결품) */
  isShortage?: boolean
}

export type MaterialFirstShortage = {
  sequence: number
  orderId: string
  orderNo: string
  orderLineId: string
  deliveryDate: DateOnly | null
  requirement: number
  balanceBefore: number
  balanceAfter: number
}

export type OrderMrpMaterialResult = {
  componentItemId: string
  componentCode: string
  componentItemType: string | null
  name: string | null
  uom: string | null
  supplierId: string | null
  supplierName: string | null
  openingStock: number
  totalRequirement: number
  /** 최종 예상재고 = 마지막 수주 처리 후 잔량(순차 차감 결과, 음수 허용). 정수 수량에서는 openingStock - totalRequirement 와 같다 */
  finalBalance: number
  /** max(0, -finalBalance) */
  finalShortageQty: number
  /** 이 자재가 결품된 수주 라인 수 (requirement>0 ∧ balanceAfter<0) */
  shortageDemandCount: number
  /** 잔량이 음수였던 단계 수 (requirement 가 0 인 단계 포함) */
  negativeStepCount: number
  firstShortage: MaterialFirstShortage | null
  /** 처리된 모든 수주(처리 순서)에 대한 밀집 이동 이력 */
  movements: MaterialMovement[]
  // ── Phase 5B 추가(기존 필드 의미는 변하지 않는다) ──
  /** 계산에 반영된 예정입고 수량 합계(NORMAL + 예정입고 입력이 있을 때만 > 0) */
  scheduledReceiptQty: number
  scheduledReceiptCount: number
  /** 기간 중 한 번이라도 결품(requirement>0 ∧ balanceAfter<0)이 발생했는가. 최종 잔량이 회복돼도 true */
  hadShortage: boolean
  /** 시간축에서 가장 낮았던 잔량의 부족 크기 = max(0, -min(잔량)). 최종 부족(finalShortageQty)과 구분된다 */
  peakShortageQty: number
  /** 결품 후 예정입고로 잔량이 0 이상으로 회복된 마지막 입고일(회복이 없으면 null) */
  shortageRecoveredAt: DateOnly | null
  /** 입고/수요 이벤트 시간축(예정입고 입력이 있을 때만) */
  timeline: MaterialTimelineEvent[]
  // ── Phase 5E: 반제품 Netting 누계(반제품 자재만 값이 있다) ──
  /** 반제품 재고(공용 pool)에서 사용한 수량 합계 */
  nettedUsedQty: number
  /** 반제품 순소요 합계(= 총 필요 중 재고로 충당하지 못해 하위 BOM 으로 전개된 양) */
  nettedNetQty: number
}

export type OrderMrpSummary = {
  includedDemandCount: number
  excludedDemandCount: number
  materialCount: number
  /** finalBalance < 0 인 자재 수 */
  shortageComponentCount: number
  totalFinalShortageQty: number
  /** shortageItemCount > 0 인 수주 라인 수 (결품 발생 수주 수) */
  shortageDemandCount: number
  /** Phase 5B: 기간 중 결품이 있었지만 최종 예상재고는 0 이상인(예정입고로 회복된) 자재 수 */
  temporaryShortageComponentCount: number
  /** 전체 자재 중 가장 먼저(처리 순서 기준) 결품이 발생한 수주 */
  firstShortage:
    | (Omit<MaterialFirstShortage, "requirement" | "balanceBefore" | "balanceAfter"> & {
        materials: Array<{
          componentItemId: string
          componentCode: string
          requirement: number
          balanceBefore: number
          balanceAfter: number
        }>
      })
    | null
}

export type OrderMrpResult = {
  options: ResolvedOrderMrpOptions
  demands: OrderMrpDemandResult[]
  materials: OrderMrpMaterialResult[]
  summary: OrderMrpSummary
  excludedOrderLines: ExcludedOrderLine[]
  warnings: MrpWarning[]
}
