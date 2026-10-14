/**
 * Daewon 기준정보(Master) 이관 파이프라인 — 공용 타입 (순수, DB/Prisma/파일 비의존)
 *
 *   workbook(저장된 셀 값만) → extract → validate/classify → reconcile(기존 MES 대비) → approved dataset → seed / import
 *
 * 원칙: Excel 은 Master 출처 + MRP 회귀 자료로만 쓴다. 재고/수주/발주/입출고/생산/WIP 같은 운영 정보는 이관/seed 하지 않는다.
 */

/** 시트 접근 추상화: 실제 workbook(xlsx) 과 테스트용 익명 grid 가 같은 인터페이스를 쓴다. 행/열은 1부터. */
export type GridCell = string | number | boolean | null | undefined

export interface GridLike {
  readonly name: string
  readonly maxRow: number
  readonly maxCol: number
  /** 값이 있는 셀 수 */
  readonly nonEmptyCount: number
  get(row: number, col: number): GridCell
  /** 셀 표시 형식(있으면). 숫자 서식 코드(예: "00000") 판단용 */
  format?(row: number, col: number): string | undefined
}

export type SrcRef = { sheet: string; row: number; col?: number }

export type Grade = "SAFE" | "REVIEW" | "REJECT"

export type Issue = { code: string; grade: "REVIEW" | "REJECT"; message: string }

/** 식별자(코드) 셀 검사 결과. raw 는 원본을 훼손하지 않은 문자열이다. */
export type CodeInfo = {
  /** 원본 값(문자열). 비어 있으면 null */
  raw: string | null
  /** 숫자 셀이었는가(선행 0 / 지수 표기 손실 위험) */
  numericCell: boolean
  /** 진단 코드 */
  diagnostics: string[]
  /** 근접 중복 판정용 키(NFKC + 공백 정규화 + 대문자). 식별자로 쓰지 않는다 */
  foldKey: string | null
}

export type ItemTypeName = "FINISHED" | "SEMI_FINISHED" | "RAW_MATERIAL" | "CONSUMABLE"
export type UomName = "EA" | "KG" | "G" | "L" | "ML" | "M" | "CM" | "MM" | "BOX" | "SET"
export type PartnerTypeName = "CUSTOMER" | "SUPPLIER" | "BOTH"

// ─── 추출(Extraction) ──────────────────────────────────────────────────────────

export type RawMaterialRow = {
  code: CodeInfo
  name: string | null
  spec: string | null
  uom: string | null
  supplier: string | null
  remark: string | null
  src: SrcRef
}

export type RawProduct = {
  /** 제품 목록 번호(DB 시트 A열) — BOM 블록 위치를 결정한다 */
  no: unknown
  code: CodeInfo
  src: SrcRef
}

export type RawBomLine = {
  parentCode: string
  parentSrc: SrcRef
  component: CodeInfo
  name: string | null
  spec: string | null
  qty: unknown
  uom: string | null
  src: SrcRef
}

export type RawNameRef = { name: string; count: number; firstRow: number }

export type RawCodeRef = { code: CodeInfo; count: number; firstRow: number }

export type RawExtraction = {
  materials: RawMaterialRow[]
  products: RawProduct[]
  bomLines: RawBomLine[]
  /** 제품 목록에는 있으나 BOM 블록 위치를 계산할 수 없는 제품 번호 등 */
  structuralIssues: Array<{ code: string; message: string; src: SrcRef }>
  /** 수주관리대장에서 읽은 "식별자만"(제품 코드/고객명). 수량/납기/출고는 읽어도 저장하지 않는다 */
  orderRefs: { products: RawCodeRef[]; customers: RawNameRef[]; rowCount: number }
  /** 재고관리대장의 자재 식별 정보(설정 시트와의 교차 검증 전용) */
  stockSheetMaterials: Array<{ code: CodeInfo; name: string | null; spec: string | null; supplier: string | null; src: SrcRef }>
}

// ─── 분류(Analysis) ────────────────────────────────────────────────────────────

export type ItemCandidate = {
  key: string
  code: string
  proposed: { name: string | null; spec: string | null; uom: string | null; itemType: ItemTypeName | null }
  /** 확정하지 못한 속성에 대한 "제안값"(승인 전에는 사용하지 않는다) */
  suggestions: { name?: string; uom?: string; itemType?: ItemTypeName }
  flags: { inSettings: boolean; isBomParent: boolean; isBomComponent: boolean; orderOnly: boolean; stockSheetOnly: boolean }
  typeBasis: string
  grade: Grade
  issues: Issue[]
  sources: SrcRef[]
}

export type BomLineCandidate = {
  seq: number
  componentCode: string
  qtyPer: number | null
  qtyRaw: unknown
  uom: string | null
  grade: Grade
  issues: Issue[]
  src: SrcRef
}

export type BomCandidate = {
  parentCode: string
  lines: BomLineCandidate[]
  grade: Grade
  issues: Issue[]
  /** 이 제품 기준 BOM 최대 깊이(자기 단계 포함 1 = 직접 구성품만). 순환이면 null */
  depth: number | null
  src: SrcRef
}

export type DuplicateComponentReport = {
  parentCode: string
  componentCode: string
  lineCount: number
  qtys: Array<number | null>
  sumQty: number | null
  rows: number[]
}

export type PartnerCandidate = {
  /** 이름 기준 식별(코드가 Excel 에 없다) */
  name: string
  partnerType: PartnerTypeName
  /** Excel 에 코드가 없으므로 항상 null — 승인 단계에서 사람이 지정한다 */
  code: string | null
  occurrences: number
  roles: { customer: number; supplier: number }
  grade: Grade
  issues: Issue[]
  firstRow: number
  sources: SrcRef[]
}

export type ItemSupplierCandidate = {
  itemCode: string
  supplierName: string
  isDefault: false
  grade: Grade
  issues: Issue[]
  src: SrcRef
}

export type MasterAnalysis = {
  items: ItemCandidate[]
  boms: BomCandidate[]
  duplicateComponents: DuplicateComponentReport[]
  partners: PartnerCandidate[]
  partnerNearDuplicates: Array<{ foldKey: string; names: string[] }>
  itemSuppliers: ItemSupplierCandidate[]
  /** BOM 이 없는 FINISHED 후보(자동 생성 금지 → REVIEW) */
  finishedWithoutBom: string[]
  cycles: string[][]
  maxBomDepth: number
  /** 같은 품명이 서로 다른 코드에 쓰인 그룹(정보용: 품명으로 병합하지 않는다) */
  sameNameDifferentCode: Array<{ name: string; codes: string[] }>
  /** 재고관리대장과 설정 시트 사이의 식별 정보 불일치 건수 */
  stockSheetMismatches: Array<{ code: string; fields: string[] }>
}

// ─── 기존 MES 대비(Reconcile) / 데이터셋 ───────────────────────────────────────

export type ReconcileClass = "CREATE" | "MATCH" | "CONFLICT" | "REJECT"

export type ExistingMasterSnapshot = {
  items: Array<{ code: string; name: string; spec: string | null; uom: string; itemType: string; status?: string }>
  boms: Array<{ itemCode: string; version: string; status?: string; isDefault?: boolean; lines: Array<{ componentCode: string; qtyPer: number }> }>
  partners: Array<{ code: string; name: string; partnerType: string }>
  itemSuppliers: Array<{ itemCode: string; supplierCode: string }>
}

export type DatasetItem = { code: string; name: string; spec: string | null; uom: UomName; itemType: ItemTypeName; provenance: SrcRef[] }
export type DatasetBom = {
  parentCode: string
  version: string
  lines: Array<{ seq: number; componentCode: string; qtyPer: number }>
  provenance: SrcRef
}
export type DatasetPartner = { code: string; name: string; partnerType: PartnerTypeName }
export type DatasetItemSupplier = { itemCode: string; supplierCode: string; isDefault: false }

export type ApprovedMasterDataset = {
  schemaVersion: 1
  kind: "DAEWON_MASTER_DATASET"
  /** 출처(경로/파일명은 넣지 않는다. 해시만) */
  source: { workbookSha256: string; layout: "DAEWON_MRP_V09" }
  bomVersion: string
  items: DatasetItem[]
  boms: DatasetBom[]
  partners: DatasetPartner[]
  itemSuppliers: DatasetItemSupplier[]
  /** 승인되지 않아 제외된 항목 수(사유별) — 데이터셋에 포함되지 않는다 */
  excluded: { review: number; reject: number; droppedDependents: number }
  datasetHash: string
}

/**
 * 승인 결정(사람이 작성). REVIEW 항목을 포함시키려면 명시적으로 accept=true 여야 한다(false/없음 = 제외).
 * bulk 는 "사람이 한 번 정한 정책"을 같은 종류의 REVIEW 항목에 일괄 적용하는 명시적 승인이다(자동 추정이 아니다).
 */
export type MasterDecisions = {
  items?: Record<string, { accept: boolean; name?: string; spec?: string | null; uom?: UomName; itemType?: ItemTypeName }>
  boms?: Record<string, { accept: boolean }>
  /** key = `${partnerType}|${name}` */
  partners?: Record<string, { accept: boolean; code: string; partnerType?: PartnerTypeName }>
  itemSuppliers?: Record<string, { accept: boolean }>
  bulk?: {
    /** BOM 상위 제품(FINISHED)의 품명이 없을 때 제품코드를 품명으로 쓴다 */
    finishedUseCodeAsName?: boolean
    /** BOM 상위 제품(FINISHED)의 단위가 없을 때 쓸 단위 */
    finishedDefaultUom?: UomName
    /** 규격이 없는 품목도 허용(규격 null) */
    allowMissingSpec?: boolean
    /** 거래처 코드 생성 규칙(이름순 일련번호). 규칙을 승인한 경우에만 코드가 만들어진다 */
    partnerCodeRule?: { customerPrefix: string; supplierPrefix: string; width: number }
    /** 승인된 거래처를 사용하는 ItemSupplier 후보를 모두 포함(isDefault=false 유지) */
    acceptItemSuppliersOfAcceptedPartners?: boolean
    /** 위 정책으로 승인 가능한 REVIEW 이유가 아닌 항목(BOM REVIEW 줄 등)은 포함하지 않는다 */
    acceptBomsWithoutRejectedLines?: boolean
  }
}
