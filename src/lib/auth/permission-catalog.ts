// 역할/권한 기본값 카탈로그 (순수 모듈 — 서버 액션('use server'), seed 스크립트, 테스트에서 공용)
//
// 이 파일이 RolePermission 기본값의 "유일한 정의"이다. 이전에는 permission.actions.ts 와 prisma/seed-daewon.ts 에
// 같은 값이 복사되어 있어 새 리소스를 추가할 때 한쪽을 빠뜨릴 수 있었다.
//
// 원칙
//  - 기본값은 "행이 없으면 무조건 허용"이 아니다. 행이 저장되어 있어야 허용된다(role-permissions.ts).
//  - 행 생성은 항상 createMany({ skipDuplicates: true }) 로 한다 → 이미 저장된 설정(허용/차단)은 덮어쓰지 않고 멱등이다.
//  - 이 파일은 DB/세션에 의존하지 않으므로 import 만으로 부작용이 없다(alias(@/) 없이 상대 import 만 사용).

export type CatalogRole = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER"
export type CatalogAction = "READ" | "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "EXPORT"

export type PermissionRowInput = {
  tenantId: string
  role: CatalogRole
  resource: string
  action: CatalogAction
  isAllowed: boolean
}

export const ALL_ACTIONS: CatalogAction[] = ["READ", "CREATE", "UPDATE", "DELETE", "APPROVE", "EXPORT"]

// 실제 메뉴 기준 전체 리소스 목록
export const ALL_RESOURCES: readonly string[] = [
  // 기준정보관리
  "ITEM", "BOM", "ROUTING", "EQUIPMENT", "INSPECTION_SPEC", "WORK_STANDARD", "PARTNER_MANAGEMENT",
  // 생산관리
  "PRODUCTION_PLAN", "WORK_ORDER", "WORK_RESULT",
  "SALES_ORDER", "SHIPMENT", "QUOTATION", "COSTING",
  "PROJECT_ORDER", "PROJECT_PRICE", "PROJECT_STAGE", "PROJECT_ISSUE",
  // 재고관리
  "INVENTORY", "INVENTORY_TXN", "PURCHASE_ORDER", "ITEM_PRICE", "MRP",
  // 품질관리
  "QUALITY_INSPECTION", "DEFECT_MANAGEMENT", "ECN", "INSTRUMENT_CALIBRATION",
  // 설비점검/수리
  "EQUIPMENT_REPAIR", "EQUIPMENT_MONITOR", "EQUIPMENT_CONNECTION", "TAG_MANAGEMENT",
  // 시스템/추적성
  "LOT", "COMMON_CODE", "AUDIT_LOG", "DASHBOARD", "REPORT",
  // 사용자관리
  "USER_MANAGEMENT",
  // 기존 호환 (DB에 이미 존재)
  "APPROVAL",
]

export const MANAGER_PERMS: Record<string, CatalogAction[]> = {
  ITEM:               ["READ", "CREATE", "UPDATE"],
  BOM:                ["READ", "CREATE", "UPDATE"],
  ROUTING:            ["READ", "CREATE", "UPDATE"],
  EQUIPMENT:          ["READ", "CREATE", "UPDATE"],
  INSPECTION_SPEC:    ["READ", "CREATE", "UPDATE"],
  WORK_STANDARD:      ["READ", "CREATE", "UPDATE"],
  PARTNER_MANAGEMENT: ["READ", "CREATE", "UPDATE"],
  PRODUCTION_PLAN:    ["READ", "CREATE", "UPDATE"],
  WORK_ORDER:         ["READ", "CREATE", "UPDATE"],
  WORK_RESULT:        ["READ", "CREATE", "UPDATE", "EXPORT"],
  SALES_ORDER:        ["READ", "CREATE", "UPDATE", "DELETE"],
  SHIPMENT:           ["READ", "CREATE", "UPDATE", "DELETE"],
  QUOTATION:          ["READ", "CREATE", "UPDATE", "DELETE"],
  COSTING:            ["READ", "CREATE", "EXPORT"],
  INVENTORY:          ["READ", "CREATE", "UPDATE"],
  INVENTORY_TXN:      ["READ", "EXPORT"],
  PURCHASE_ORDER:     ["READ", "CREATE", "UPDATE"],
  ITEM_PRICE:         ["READ", "CREATE", "UPDATE"],
  MRP:                ["READ", "CREATE", "UPDATE"],
  PROJECT_ORDER:      ["READ", "CREATE", "UPDATE"],
  PROJECT_PRICE:      ["READ", "CREATE", "UPDATE"],
  PROJECT_STAGE:      ["READ", "CREATE", "UPDATE"],
  PROJECT_ISSUE:      ["READ", "CREATE", "UPDATE"],
  QUALITY_INSPECTION: ["READ", "CREATE", "UPDATE", "APPROVE"],
  DEFECT_MANAGEMENT:  ["READ", "CREATE", "UPDATE"],
  ECN:                ["READ", "CREATE", "UPDATE", "APPROVE"],
  INSTRUMENT_CALIBRATION: ["READ", "CREATE", "UPDATE", "EXPORT"],
  EQUIPMENT_REPAIR:   ["READ", "CREATE", "UPDATE", "APPROVE"],
  EQUIPMENT_MONITOR:  ["READ"],
  EQUIPMENT_CONNECTION: ["READ", "CREATE", "UPDATE"],
  TAG_MANAGEMENT:     ["READ", "CREATE", "UPDATE"],
  LOT:                ["READ", "CREATE", "UPDATE"],
  COMMON_CODE:        ["READ"],
  DASHBOARD:          ["READ"],
  AUDIT_LOG:          ["READ"],
  USER_MANAGEMENT:    ["READ"],
  APPROVAL:           ["READ", "CREATE", "APPROVE"],
  REPORT:             ["READ", "EXPORT"],
}

export const OPERATOR_PERMS: Record<string, CatalogAction[]> = {
  ITEM:               ["READ"],
  BOM:                ["READ"],
  ROUTING:            ["READ"],
  EQUIPMENT:          ["READ"],
  INSPECTION_SPEC:    ["READ"],
  WORK_STANDARD:      ["READ"],
  PARTNER_MANAGEMENT: ["READ"],
  PRODUCTION_PLAN:    ["READ"],
  WORK_ORDER:         ["READ", "UPDATE"],
  WORK_RESULT:        ["READ", "CREATE"],
  SALES_ORDER:        ["READ", "CREATE", "UPDATE"],
  SHIPMENT:           ["READ", "CREATE", "UPDATE"],
  QUOTATION:          ["READ", "CREATE", "UPDATE"],
  COSTING:            ["READ", "CREATE"],
  INVENTORY:          ["READ", "CREATE", "UPDATE"],
  INVENTORY_TXN:      ["READ"],
  PURCHASE_ORDER:     ["READ", "CREATE"],
  ITEM_PRICE:         ["READ"],
  MRP:                ["READ"],
  PROJECT_ORDER:      ["READ", "CREATE"],
  PROJECT_PRICE:      ["READ"],
  PROJECT_STAGE:      ["READ", "CREATE", "UPDATE"],
  PROJECT_ISSUE:      ["READ", "CREATE", "UPDATE"],
  QUALITY_INSPECTION: ["READ", "CREATE"],
  DEFECT_MANAGEMENT:  ["READ", "CREATE"],
  ECN:                ["READ", "CREATE"],
  INSTRUMENT_CALIBRATION: ["READ"],
  EQUIPMENT_REPAIR:   ["READ", "CREATE"],
  EQUIPMENT_MONITOR:  ["READ"],
  EQUIPMENT_CONNECTION: ["READ"],
  TAG_MANAGEMENT:     ["READ"],
  LOT:                ["READ"],
  COMMON_CODE:        ["READ"],
  DASHBOARD:          ["READ"],
  APPROVAL:           ["READ", "CREATE"],
  REPORT:             ["READ"],
}

export const VIEWER_RESOURCES: readonly string[] = [
  "ITEM", "BOM", "ROUTING", "EQUIPMENT", "INSPECTION_SPEC", "WORK_STANDARD",
  "PARTNER_MANAGEMENT",
  "PRODUCTION_PLAN", "WORK_ORDER", "WORK_RESULT",
  "SALES_ORDER", "SHIPMENT", "QUOTATION", "COSTING",
  "PROJECT_ORDER", "PROJECT_PRICE", "PROJECT_STAGE", "PROJECT_ISSUE",
  "INVENTORY", "INVENTORY_TXN", "PURCHASE_ORDER", "ITEM_PRICE", "MRP",
  "QUALITY_INSPECTION", "DEFECT_MANAGEMENT", "ECN", "INSTRUMENT_CALIBRATION",
  "EQUIPMENT_REPAIR", "LOT",
  "EQUIPMENT_MONITOR", "DASHBOARD",
  "APPROVAL", "REPORT",
]

/**
 * 대원정밀 구축 범위 밖 기능 전용 리소스(견적/원가/프로젝트/단가). seed 와 기존 DB 보완 스크립트는
 * 이 리소스를 MANAGER/OPERATOR/VIEWER 에 부여하지 않는다(OWNER/ADMIN 행은 호환을 위해 유지).
 */
export const DAEWON_OUT_OF_SCOPE_RESOURCES: ReadonlySet<string> = new Set([
  "QUOTATION", "COSTING", "PROJECT_ORDER", "PROJECT_PRICE", "PROJECT_STAGE", "PROJECT_ISSUE", "ITEM_PRICE",
])

export type BuildDefaultPermissionOptions = {
  /** 지정하면 이 리소스의 행만 만든다(기존 DB 에 신규 리소스만 보완할 때). */
  onlyResources?: ReadonlySet<string>
  /**
   * MANAGER/OPERATOR/VIEWER 에 기본 부여하지 않을 리소스(예: 구축 범위 밖 기능).
   * OWNER/ADMIN 행은 호환을 위해 항상 만든다.
   */
  withheldFromNonAdmin?: ReadonlySet<string>
}

/** 테넌트 하나의 기본 RolePermission 행 전체. createMany({ skipDuplicates: true }) 로만 저장할 것. */
export function buildDefaultPermissionRows(tenantId: string, options: BuildDefaultPermissionOptions = {}): PermissionRowInput[] {
  const withheld = options.withheldFromNonAdmin ?? new Set<string>()
  const only = options.onlyResources
  const rows: PermissionRowInput[] = []

  for (const role of ["OWNER", "ADMIN"] as const) {
    for (const resource of ALL_RESOURCES) {
      if (only && !only.has(resource)) continue
      for (const action of ALL_ACTIONS) rows.push({ tenantId, role, resource, action, isAllowed: true })
    }
  }
  for (const [resource, actions] of Object.entries(MANAGER_PERMS)) {
    if (withheld.has(resource) || (only && !only.has(resource))) continue
    for (const action of actions) rows.push({ tenantId, role: "MANAGER", resource, action, isAllowed: true })
  }
  for (const [resource, actions] of Object.entries(OPERATOR_PERMS)) {
    if (withheld.has(resource) || (only && !only.has(resource))) continue
    for (const action of actions) rows.push({ tenantId, role: "OPERATOR", resource, action, isAllowed: true })
  }
  for (const resource of VIEWER_RESOURCES) {
    if (withheld.has(resource) || (only && !only.has(resource))) continue
    rows.push({ tenantId, role: "VIEWER", resource, action: "READ", isAllowed: true })
  }
  return rows
}

/** 한 리소스의 역할별 기본 허용 액션 (정책 확인/테스트/마이그레이션 드리프트 검사용) */
export function defaultActionsForResource(resource: string): Record<CatalogRole, CatalogAction[]> {
  const rows = buildDefaultPermissionRows("-").filter((row) => row.resource === resource)
  const result: Record<CatalogRole, CatalogAction[]> = { OWNER: [], ADMIN: [], MANAGER: [], OPERATOR: [], VIEWER: [] }
  for (const row of rows) result[row.role].push(row.action)
  return result
}
