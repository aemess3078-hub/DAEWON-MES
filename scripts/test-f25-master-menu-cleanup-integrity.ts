import { readFileSync } from "fs"
import { join } from "path"

const root = process.cwd()
const navSource = readFileSync(join(root, "src/lib/nav-config.ts"), "utf8")

const pages = {
  materialStock: readFileSync(join(root, "src/app/app/mes/material/stock/page.tsx"), "utf8"),
  defects: readFileSync(join(root, "src/app/app/mes/defects/page.tsx"), "utf8"),
  equipmentStats: readFileSync(join(root, "src/app/app/mes/equipment-statistics/page.tsx"), "utf8"),
  sites: readFileSync(join(root, "src/app/app/mes/sites/page.tsx"), "utf8"),
  users: readFileSync(join(root, "src/app/app/mes/users/page.tsx"), "utf8"),
  molds: readFileSync(join(root, "src/app/app/mes/master/molds/page.tsx"), "utf8"),
  vendors: readFileSync(join(root, "src/app/app/mes/vendors/page.tsx"), "utf8"),
  items: readFileSync(join(root, "src/app/app/mes/items/page.tsx"), "utf8"),
  bom: readFileSync(join(root, "src/app/app/mes/bom/page.tsx"), "utf8"),
  equipment: readFileSync(join(root, "src/app/app/mes/master/equipment/page.tsx"), "utf8"),
  routing: readFileSync(join(root, "src/app/app/mes/routing/page.tsx"), "utf8"),
  customers: readFileSync(join(root, "src/app/app/mes/customers/page.tsx"), "utf8"),
  purchaseOrders: readFileSync(join(root, "src/app/app/mes/purchase-orders/page.tsx"), "utf8"),
  materialReceipt: readFileSync(join(root, "src/app/app/mes/material-receipt/page.tsx"), "utf8"),
  materialIssue: readFileSync(join(root, "src/app/app/mes/material-issue/page.tsx"), "utf8"),
  productionPlan: readFileSync(join(root, "src/app/app/mes/production-plan/page.tsx"), "utf8"),
  productionResults: readFileSync(join(root, "src/app/app/mes/production-results/page.tsx"), "utf8"),
  salesOrders: readFileSync(join(root, "src/app/app/mes/sales-orders/page.tsx"), "utf8"),
  shipments: readFileSync(join(root, "src/app/app/mes/shipments/page.tsx"), "utf8"),
  ecn: readFileSync(join(root, "src/app/app/mes/ecn/page.tsx"), "utf8"),
  finishedGoodsReceipt: readFileSync(join(root, "src/app/app/mes/finished-goods-receipt/page.tsx"), "utf8"),
  locations: readFileSync(join(root, "src/app/app/mes/locations/page.tsx"), "utf8"),
  equipmentOutput: readFileSync(join(root, "src/app/app/mes/production/equipment-output/page.tsx"), "utf8"),
}

type NavEntry = {
  id: string
  parentId: string | null
  label: string
  href?: string
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function findNav(id: string): NavEntry {
  const marker = `id: '${id}'`
  const start = navSource.indexOf(marker)
  if (start < 0) throw new Error(`nav item not found: ${id}`)
  const snippet = navSource.slice(start, start + 700)
  const parentMatch = snippet.match(/parentId: (null|'[^']+')/)
  const labelMatch = snippet.match(/label: '([^']+)'/)
  const hrefMatch = snippet.match(/href: '([^']+)'/)
  if (!parentMatch) throw new Error(`parentId not found: ${id}`)
  if (!labelMatch) throw new Error(`label not found: ${id}`)
  return {
    id,
    parentId: parentMatch[1] === "null" ? null : parentMatch[1].slice(1, -1),
    label: labelMatch[1],
    href: hrefMatch?.[1],
  }
}

function assertLabel(id: string, label: string) {
  const item = findNav(id)
  assert(item.label === label, `${id} label expected ${label}, got ${item.label}`)
}

function assertParent(id: string, parentId: string) {
  const item = findNav(id)
  assert(item.parentId === parentId, `${id} parentId expected ${parentId}, got ${item.parentId}`)
}

function assertHref(id: string, href: string) {
  const item = findNav(id)
  assert(item.href === href, `${id} href expected ${href}, got ${item.href}`)
}

function assertSourceIncludes(source: string, expected: string, label: string) {
  assert(source.includes(expected), `${label} missing expected text: ${expected}`)
}

function normalizeText(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}

function extractH1(source: string) {
  const match = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!match) throw new Error("h1 not found")
  return normalizeText(match[1])
}

function assertH1(source: string, expected: string, oldValue: string, label: string) {
  const actual = extractH1(source)
  assert(actual === expected, `${label} H1 expected ${expected}, got ${actual}`)
  assert(actual !== oldValue, `${label} old H1 still present: ${oldValue}`)
}

const canonicalLabels: Array<[string, string]> = [
  ["nav-items", "품목관리"],
  ["nav-item-categories", "품목분류관리"],
  ["nav-item-groups", "품목군관리"],
  ["nav-bom", "BOM관리"],
  ["nav-equipment-master", "설비관리"],
  ["nav-defects", "불량관리"],
  ["nav-routing", "라우팅관리"],
  ["nav-work-centers", "공정관리"],
  ["nav-users", "사용자관리"],
  ["nav-sites", "사업장관리"],
  ["nav-locations", "로케이션관리"],
  ["nav-customers", "고객사관리"],
  ["nav-vendors", "거래처관리"],
  ["nav-inspection-standards", "검사표준관리"],
  ["nav-mold-management", "금형·치공구관리"],
  ["nav-downtime-reasons", "비가동사유"],
  ["nav-purchase-orders", "자재발주현황"],
  ["nav-material-receipt", "자재입고현황"],
  ["nav-material-issue", "자재출고현황"],
  ["nav-material-stock", "자재재고현황"],
  ["nav-inventory", "재고현황"],
  ["nav-inventory-txns", "전체입출고내역"],
  ["nav-wip-inventory", "재공품재고"],
  ["nav-prod-equip-output", "설비별생산현황"],
  ["nav-prod-plan-output", "생산계획별생산현황"],
  ["nav-work-orders", "작업지시"],
  ["nav-production-results", "작업일지(실적)"],
  ["nav-finished-goods-receipt", "완제품입고"],
  ["nav-outsourcing", "외주관리"],
  ["nav-sales-orders", "수주등록"],
  ["nav-sales-status", "수주현황"],
  ["nav-shipments", "납품정보등록"],
  ["nav-delivery-status", "납품현황"],
  ["nav-quality", "품질관리"],
  ["nav-project-management", "PMS(프로젝트관리)"],
]

for (const [id, label] of canonicalLabels) assertLabel(id, label)

assertParent("nav-inventory", "nav-inventory-section")
assertParent("nav-material-stock", "nav-material")

const invariantHrefs: Array<[string, string]> = [
  ["nav-items", "/app/mes/items"],
  ["nav-equipment-master", "/app/mes/master/equipment"],
  ["nav-routing", "/app/mes/routing"],
  ["nav-customers", "/app/mes/customers"],
  ["nav-vendors", "/app/mes/vendors"],
  ["nav-inventory", "/app/mes/inventory"],
  ["nav-material-stock", "/app/mes/material/stock"],
  ["nav-prod-plan-output", "/app/mes/production-plan"],
  ["nav-production-results", "/app/mes/production-results"],
  ["nav-sales-orders", "/app/mes/sales-orders"],
  ["nav-shipments", "/app/mes/shipments"],
]

for (const [id, href] of invariantHrefs) assertHref(id, href)

const forbiddenNavLabels = [
  "공급처 관리",
  "구매처 관리",
  "금형/치공구 기준정보",
  "공구 수명/사용이력",
  "불량코드 관리",
  "사용자 / 권한 관리",
  "원자재 LOT 재고",
]

for (const forbidden of forbiddenNavLabels) {
  assert(!navSource.includes(`label: '${forbidden}'`), `forbidden nav label found: ${forbidden}`)
}

assertH1(pages.items, "품목관리", "품목정보", "items")
assertH1(pages.bom, "BOM관리", "BOM", "bom")
assertH1(pages.equipment, "설비관리", "설비정보", "equipment")
assertH1(pages.routing, "라우팅관리", "공정라우팅관리", "routing")
assertH1(pages.customers, "고객사관리", "고객사 관리", "customers")
assertH1(pages.purchaseOrders, "자재발주현황", "자재발주", "purchase orders")
assertH1(pages.materialReceipt, "자재입고현황", "자재입고", "material receipt")
assertH1(pages.materialIssue, "자재출고현황", "자재출고", "material issue")
assertH1(pages.productionPlan, "생산계획별생산현황", "생산계획", "production plan")
assertH1(pages.productionResults, "작업일지(실적)", "생산실적조회", "production results")
assertH1(pages.salesOrders, "수주등록", "수주관리", "sales orders")
assertH1(pages.shipments, "납품정보등록", "출하등록", "shipments")

assertH1(pages.materialStock, "자재재고현황", "원자재 LOT 재고", "material stock")
assertSourceIncludes(pages.materialStock, "원자재와 소모품의 LOT별 현재고", "material stock description")
assertH1(pages.defects, "불량관리", "불량코드 관리", "defects")
assertH1(pages.equipmentStats, "통합통계", "설비 통계분석", "equipment statistics")
assertH1(pages.sites, "사업장관리", "사이트 관리", "sites")
assertH1(pages.users, "사용자관리", "사용자 / 권한 관리", "users")
assertH1(pages.molds, "금형·치공구관리", "금형/치공구관리", "molds")
assertSourceIncludes(pages.molds, "기준정보", "molds description")
assertH1(pages.vendors, "거래처관리", "거래처 관리", "vendors")
assertSourceIncludes(pages.vendors, "원자재·부품", "vendors supplier description")
assertH1(pages.ecn, "변경관리", "변경관리 (ECN/ECO)", "ecn")
assertH1(pages.finishedGoodsReceipt, "완제품입고", "완제품 입고 관리", "finished goods receipt")
assertH1(pages.locations, "로케이션관리", "로케이션 관리", "locations")
assertH1(pages.equipmentOutput, "설비별생산현황", "설비별 생산현황", "equipment output")

assert(!navSource.includes("/app/mes/master/product-groups"), "product-groups must remain hidden from nav")
assert(!navSource.includes("/app/mes/master/mold-inventory"), "mold-inventory must remain hidden from nav")
assert(!navSource.includes("/app/mes/process-progress"), "process-progress must remain hidden from nav")
assert(!navSource.includes("/app/mes/quotations"), "quotations must remain hidden from nav")
assert(!navSource.includes("/app/mes/item-prices"), "item-prices must remain hidden from nav")
assert(!navSource.includes("/app/mes/mrp"), "mrp must remain hidden from nav")
assert(!navSource.includes("/app/mes/final-inspection"), "final-inspection must remain hidden from nav")
assert(!navSource.includes("/app/mes/measurement"), "measurement must remain hidden from nav")

console.log("F25 master menu cleanup integrity: passed")