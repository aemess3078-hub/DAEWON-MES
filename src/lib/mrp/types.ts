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

export type OrderMrpInput = {
  demands: MrpDemandLine[]
  boms: MrpBomLine[]
  stocks: MrpStockEntry[]
  componentInfo?: Record<string, MrpComponentInfo>
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
