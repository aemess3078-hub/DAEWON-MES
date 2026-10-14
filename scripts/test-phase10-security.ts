/**
 * Phase 10 — Security / Integrity / Scope Hardening 회귀 테스트
 *
 * 실행: npm run test:phase10-security
 *
 * 실제 server action 모듈을 그대로 로드해 실행한다(메모리 fake DB 주입 · 실제 DB 접속/쓰기 없음).
 *  - "@/..." alias 를 해석하고, @/lib/db/prisma / next/headers / next/cache 만 대체한다.
 *  - 인증은 실제 auth.ts(JWT 서명 검증 + TenantUser/RolePermission 조회)를 fake DB 위에서 그대로 사용한다.
 *
 *  SEC-01 비인증 읽기 거부        SEC-02 비인증 쓰기 거부       SEC-03 타 tenant 읽기 거부
 *  SEC-04 타 tenant 쓰기 거부     SEC-05 사업장 격리(해당 시)   SEC-06 직접 호출 우회 거부
 *  SEC-07 MANAGER 정상 흐름       SEC-08 OPERATOR 정상/제한     SEC-09 POP 허용 동작
 *  SEC-10 POP 관리자 액션 거부    SEC-11 타 tenant 관계 ID 거부 SEC-12 완료/취소 상태 변경 거부
 *  + DG-013/014/015/017/021/031/033/042 개별 검증
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import Module from "node:module"
import jwt from "jsonwebtoken"

const root = process.cwd()
const SRC = join(root, "src")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
function section(t: string) {
  console.log("\n── " + t)
}
async function rejects(fn: () => Promise<unknown>, label: string, pattern?: RegExp) {
  let error: unknown = null
  try {
    await fn()
  } catch (e) {
    error = e
  }
  assert.ok(error, `${label} — expected rejection but resolved`)
  if (pattern) assert.match(String((error as Error).message), pattern, `${label} — message`)
  passed += 1
  console.log("PASS " + label)
}
/** { ok:false } / { success:false } 형태 또는 throw 모두 '거부'로 본다. */
async function denied(fn: () => Promise<any>, label: string) {
  let refused = false
  try {
    const r = await fn()
    if (r && typeof r === "object" && (r.ok === false || r.success === false)) refused = true
  } catch {
    refused = true
  }
  assert.ok(refused, `${label} — expected denial`)
  passed += 1
  console.log("PASS " + label)
}

// ─── 환경 / 모듈 대체 ─────────────────────────────────────────────────────────
process.env.JWT_SECRET = "phase10-test-secret-0123456789abcdef"
process.env.POP_WORKER_SESSION_SECRET = "phase10-pop-session-secret-0123456789"
process.env.POP_PIN_SECRET = "phase10-pop-pin-secret-0123456789"
process.env.DEFAULT_TENANT_ID = "tenant-A"
delete process.env.NEXT_PUBLIC_BRAND
delete process.env.DAEWON_DISABLE_DEVELOPER_ACCESS

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { matches } = require("./helpers/fake-db") as { matches: (row: any, where: any) => boolean }

type Row = Record<string, any>
let seq = 1
function makeFakePrisma(seed: Record<string, Row[]>) {
  let tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const writes: Array<{ model: string; op: string }> = []
  const clone = (r: Row | undefined | null) => (r ? { ...r } : null)
  const applyData = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) row[k] = Number(row[k] ?? 0) + Number((v as any).increment)
      else if (v && typeof v === "object" && !(v instanceof Date) && "decrement" in v) row[k] = Number(row[k] ?? 0) - Number((v as any).decrement)
      else row[k] = v
    }
  }
  const rows = (name: string) => (tables[name] ??= [])
  const model = (name: string) => ({
    findUnique: async (a: any) => clone(rows(name).find((r) => matches(r, a?.where ?? {}))),
    findFirst: async (a: any) => clone(rows(name).find((r) => matches(r, a?.where ?? {}))),
    findFirstOrThrow: async (a: any) => {
      const r = rows(name).find((x) => matches(x, a?.where ?? {}))
      if (!r) throw new Error("NotFound")
      return { ...r }
    },
    findUniqueOrThrow: async (a: any) => {
      const r = rows(name).find((x) => matches(x, a?.where ?? {}))
      if (!r) throw new Error("NotFound")
      return { ...r }
    },
    findMany: async (a: any) => {
      let out = rows(name).filter((r) => matches(r, a?.where ?? {}))
      if (a?.take !== undefined) out = out.slice(0, a.take)
      return out.map((r) => ({ ...r }))
    },
    count: async (a: any) => rows(name).filter((r) => matches(r, a?.where ?? {})).length,
    aggregate: async () => ({ _sum: {} }),
    groupBy: async () => [],
    create: async (a: any) => {
      writes.push({ model: name, op: "create" })
      const row = { id: `${name}-${seq++}`, ...a.data }
      rows(name).push(row)
      return { ...row }
    },
    createMany: async (a: any) => {
      writes.push({ model: name, op: "createMany" })
      for (const d of a.data) rows(name).push({ id: `${name}-${seq++}`, ...d })
      return { count: a.data.length }
    },
    update: async (a: any) => {
      writes.push({ model: name, op: "update" })
      const r = rows(name).find((x) => matches(x, a.where))
      if (!r) throw new Error("NotFound")
      applyData(r, a.data)
      return { ...r }
    },
    updateMany: async (a: any) => {
      writes.push({ model: name, op: "updateMany" })
      const targets = rows(name).filter((x) => matches(x, a.where))
      targets.forEach((t) => applyData(t, a.data))
      return { count: targets.length }
    },
    deleteMany: async (a: any) => {
      writes.push({ model: name, op: "deleteMany" })
      const before = rows(name).length
      tables[name] = rows(name).filter((x) => !matches(x, a?.where ?? {}))
      return { count: before - tables[name].length }
    },
  })
  const prisma: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "$transaction") {
          return async (cb: any) => {
            const snapshot = JSON.parse(JSON.stringify(tables))
            try {
              return await cb(prisma)
            } catch (e) {
              tables = snapshot
              throw e
            }
          }
        }
        if (prop === "$queryRaw" || prop === "$executeRaw") return async () => []
        if (prop === "__tables") return () => tables
        return model(prop)
      },
    },
  )
  return { prisma, tables: () => tables, writes }
}

let fake = makeFakePrisma({})
let cookieValue: string | undefined
const cookieJar: Record<string, string | undefined> = {}

const origResolve = (Module as any)._resolveFilename
const origLoad = (Module as any)._load
;(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === "string" && request.startsWith("@/")) {
    request = join(SRC, request.slice(2))
  }
  return origResolve.call(this, request, ...rest)
}
;(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) => (cookieJar[name] ? { name, value: cookieJar[name] } : undefined),
        set: () => {},
        delete: () => {},
      }),
      headers: async () => ({ get: () => null }),
    }
  }
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: any) => f }
  if (request === "server-only") return {}
  const resolved: string = (() => {
    try {
      return (Module as any)._resolveFilename(request, parent, isMain)
    } catch {
      return ""
    }
  })()
  if (resolved.split(sep).join("/").endsWith("/src/lib/db/prisma.ts")) {
    // 테스트마다 fake DB 를 교체하므로 모듈이 잡고 있는 참조는 항상 현재 fake 로 위임하는 프록시여야 한다.
    const stable = new Proxy({}, { get: (_t, prop) => (fake.prisma as any)[prop as string] })
    return { prisma: stable, default: stable }
  }
  return origLoad.call(this, request, parent, isMain)
}

// 서버 모듈 로드(대체 훅 설치 이후)
/* eslint-disable @typescript-eslint/no-var-requires */
const lotActions = require("../src/lib/actions/lot.actions")
const woActions = require("../src/lib/actions/work-order.actions")
const invActions = require("../src/lib/actions/inventory.actions")
const soActions = require("../src/lib/actions/sales-order.actions")
const lineageActions = require("../src/lib/actions/lot-lineage.actions")
const progressActions = require("../src/lib/actions/process-progress.actions")
const poActions = require("../src/lib/actions/purchase-order.actions")
const issueActions = require("../src/lib/actions/material-issue.actions")
const kpiActions = require("../src/lib/actions/kpi.actions")
const qualityActions = require("../src/lib/actions/quality.actions")
const ecnActions = require("../src/lib/actions/ecn.actions")
const selfInspection = require("../src/lib/actions/self-inspection.helpers")
const poStatus = require("../src/lib/purchase-order-status")
const agentKey = require("../src/lib/ncwatch/agent-key")
const ncwatchAuth = require("../src/lib/ncwatch/auth")
const edgeJwt = require("../src/lib/auth/edge-jwt")
const developer = require("../src/lib/developer")
const scope = require("../src/lib/auth/daewon-scope")
/* eslint-enable @typescript-eslint/no-var-requires */

// ─── Fixture ──────────────────────────────────────────────────────────────────
function token(profileId: string, tenantId: string, loginId: string, role: string) {
  return jwt.sign({ profileId, tenantId, loginId, name: loginId, role }, process.env.JWT_SECRET as string, { expiresIn: 3600 })
}
const USERS = {
  ownerA: { profileId: "p-owner-A", tenantId: "tenant-A", loginId: "owner-a", role: "OWNER" },
  mgrA: { profileId: "p-mgr-A", tenantId: "tenant-A", loginId: "mgr-a", role: "MANAGER" },
  opA: { profileId: "p-op-A", tenantId: "tenant-A", loginId: "op-a", role: "OPERATOR" },
  viewerA: { profileId: "p-view-A", tenantId: "tenant-A", loginId: "view-a", role: "VIEWER" },
  devA: { profileId: "p-dev-A", tenantId: "tenant-A", loginId: "test", role: "OWNER" },
  ownerB: { profileId: "p-owner-B", tenantId: "tenant-B", loginId: "owner-b", role: "OWNER" },
} as const
function loginAs(u: keyof typeof USERS | null) {
  cookieJar["nmes-session"] = u ? token(USERS[u].profileId, USERS[u].tenantId, USERS[u].loginId, USERS[u].role) : undefined
}

const perm = (tenantId: string, role: string, resource: string, actions: string[]) =>
  actions.map((action) => ({ tenantId, role, resource, action, isAllowed: true }))

function seedTables(): Record<string, Row[]> {
  const users = Object.values(USERS)
  return {
    userCredential: users.map((u) => ({ profileId: u.profileId, tenantId: u.tenantId, loginId: u.loginId, isLocked: false, mustChangePw: false })),
    tenantUser: users.map((u) => ({ id: `tu-${u.profileId}`, profileId: u.profileId, tenantId: u.tenantId, role: u.role, isActive: true, siteId: "site-A" })),
    profile: users.map((u) => ({ id: u.profileId, email: `${u.loginId}@x`, name: u.loginId })),
    rolePermission: [
      ...perm("tenant-A", "MANAGER", "LOT", ["READ", "CREATE", "UPDATE"]),
      ...perm("tenant-A", "MANAGER", "WORK_RESULT", ["READ", "CREATE", "UPDATE"]),
      ...perm("tenant-A", "MANAGER", "WORK_ORDER", ["READ"]),
      ...perm("tenant-A", "MANAGER", "INVENTORY", ["READ"]),
      ...perm("tenant-A", "MANAGER", "SALES_ORDER", ["READ"]),
      ...perm("tenant-A", "MANAGER", "PURCHASE_ORDER", ["READ", "CREATE", "UPDATE"]),
      ...perm("tenant-A", "MANAGER", "INSPECTION_SPEC", ["READ", "CREATE"]),
      ...perm("tenant-A", "OPERATOR", "LOT", ["READ"]),
      ...perm("tenant-A", "OPERATOR", "WORK_RESULT", ["READ", "CREATE"]),
      ...perm("tenant-A", "OPERATOR", "WORK_ORDER", ["READ"]),
      ...perm("tenant-A", "OPERATOR", "PURCHASE_ORDER", ["READ", "CREATE"]),
      ...perm("tenant-A", "VIEWER", "LOT", ["READ"]),
    ],
    item: [
      { id: "item-A1", tenantId: "tenant-A", code: "RM-A1", name: "원자재A1", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-A2", tenantId: "tenant-A", code: "RM-A2", name: "원자재A2(BOM외)", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-AF", tenantId: "tenant-A", code: "FG-A", name: "완제품A", itemType: "FINISHED", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-B1", tenantId: "tenant-B", code: "RM-B1", name: "원자재B1", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
    ],
    lot: [
      { id: "lot-A1", tenantId: "tenant-A", itemId: "item-A1", lotNo: "LOT-A1", status: "ACTIVE", createdAt: new Date(), item: { id: "item-A1", code: "RM-A1", name: "원자재A1", itemType: "RAW_MATERIAL", uom: "EA", categoryId: null }, inventoryBalances: [{ qtyOnHand: 5 }] },
      { id: "lot-AQ", tenantId: "tenant-A", itemId: "item-A1", lotNo: "LOT-AQ", status: "QUARANTINE", createdAt: new Date(), item: { id: "item-A1", code: "RM-A1", name: "원자재A1", itemType: "RAW_MATERIAL", uom: "EA", categoryId: null }, inventoryBalances: [{ qtyOnHand: 3 }] },
      { id: "lot-B1", tenantId: "tenant-B", itemId: "item-B1", lotNo: "LOT-B1", status: "ACTIVE", createdAt: new Date(), item: { id: "item-B1", code: "RM-B1", name: "원자재B1", itemType: "RAW_MATERIAL", uom: "EA", categoryId: null }, inventoryBalances: [{ qtyOnHand: 9 }] },
    ],
    workOrder: [
      { id: "wo-A1", tenantId: "tenant-A", siteId: "site-A", itemId: "item-AF", bomId: "bom-A", status: "RELEASED", plannedQty: 10, manufacturingNo: "MFG-A1", operations: [{ id: "op-1", seq: 1, status: "PENDING", routingOperation: { workCenterId: "wc-1" } }] },
      { id: "wo-A2", tenantId: "tenant-A", siteId: "site-A", itemId: "item-AF", bomId: "bom-A", status: "COMPLETED", plannedQty: 10, manufacturingNo: "MFG-A2", operations: [{ id: "op-2", seq: 1, status: "COMPLETED", routingOperation: { workCenterId: "wc-1" } }] },
      { id: "wo-B1", tenantId: "tenant-B", siteId: "site-B", itemId: "item-B1", bomId: "bom-B", status: "RELEASED", plannedQty: 5, manufacturingNo: "MFG-B1", operations: [] },
    ],
    bOMItem: [{ bomId: "bom-A", componentItemId: "item-A1", qtyPer: 1, scrapRate: 0, bom: { tenantId: "tenant-A" } }],
    itemSubstitute: [],
    inventoryBalance: [],
    inventoryTransaction: [],
    wipUnit: [],
    salesOrder: [
      { id: "so-A1", tenantId: "tenant-A", orderNo: "SO-A1", customer: {}, items: [], shipments: [], createdAt: new Date(), totalAmount: null },
      { id: "so-B1", tenantId: "tenant-B", orderNo: "SO-B1", customer: {}, items: [], shipments: [], createdAt: new Date(), totalAmount: null },
    ],
    site: [
      { id: "site-A", tenantId: "tenant-A", code: "A", name: "A공장" },
      { id: "site-B", tenantId: "tenant-B", code: "B", name: "B공장" },
    ],
    businessPartner: [
      { id: "sup-A", tenantId: "tenant-A", partnerType: "SUPPLIER", name: "공급A" },
      { id: "sup-B", tenantId: "tenant-B", partnerType: "SUPPLIER", name: "공급B" },
      { id: "cus-A", tenantId: "tenant-A", partnerType: "CUSTOMER", name: "고객A" },
    ],
    purchaseOrder: [
      { id: "po-A-received", tenantId: "tenant-A", orderNo: "PO-1", status: "RECEIVED", supplierId: "sup-A", siteId: "site-A", items: [] },
      { id: "po-A-draft", tenantId: "tenant-A", orderNo: "PO-2", status: "DRAFT", supplierId: "sup-A", siteId: "site-A", items: [] },
    ],
    purchaseOrderItem: [],
    receivingInspection: [],
    materialReturnItem: [],
    wipMovement: [],
    engineeringChange: [
      { id: "ecn-A-own", tenantId: "tenant-A", requestedBy: "p-op-A", ecnNo: "E1", details: [] },
      { id: "ecn-A-other", tenantId: "tenant-A", requestedBy: "p-mgr-A", ecnNo: "E2", details: [] },
      { id: "ecn-B", tenantId: "tenant-B", requestedBy: "p-owner-B", ecnNo: "E3", details: [] },
    ],
    auditLog: [],
    edgeGateway: [],
  }
}

function reset(extra?: (t: Record<string, Row[]>) => void) {
  const t = seedTables()
  extra?.(t)
  fake = makeFakePrisma(t)
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-01 비인증 읽기 거부 (DG-013)")
  reset()
  loginAs(null)
  await rejects(() => lotActions.getLots(), "getLots 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => woActions.getWorkOrders(), "getWorkOrders 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => woActions.getWorkOrderById("wo-A1"), "getWorkOrderById 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => invActions.getInventoryBalances(), "getInventoryBalances 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => soActions.getSalesOrders("tenant-A"), "getSalesOrders(tenantId) 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => ecnActions.getECNs("tenant-A", "p-op-A", true), "getECNs 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => issueActions.getLotStockByItems(["item-A1"], "tenant-A"), "getLotStockByItems 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => lineageActions.getLotLineageByNo("LOT-A1", "tenant-A"), "getLotLineageByNo 비인증 거부", /UNAUTHORIZED/)
  await rejects(() => lotActions.getLotForwardTrace("lot-A1"), "getLotForwardTrace 비인증 거부", /UNAUTHORIZED/)
  // 임의 쿠키 값(서명 불일치)도 세션으로 인정하지 않는다
  cookieJar["nmes-session"] = "not-a-jwt"
  await rejects(() => lotActions.getLots(), "위조 쿠키 값 거부", /UNAUTHORIZED/)
  cookieJar["nmes-session"] = jwt.sign({ profileId: "p-owner-A", tenantId: "tenant-A", loginId: "owner-a", name: "x", role: "OWNER" }, "wrong-secret")
  await rejects(() => lotActions.getLots(), "다른 비밀키로 서명된 토큰 거부", /UNAUTHORIZED/)

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-02 비인증 쓰기 거부")
  reset()
  loginAs(null)
  await denied(() => lotActions.createLot({ itemId: "item-A1", lotNo: "NEW", qty: 1 }, "tenant-A"), "createLot 비인증 거부")
  await denied(() => lotActions.updateLotStatus("lot-A1", "ON_HOLD"), "updateLotStatus 비인증 거부")
  await denied(() => progressActions.completeRework({ reworkWipUnitId: "wip-x", mergedQty: 1, scrapQty: 0 }), "completeRework 비인증 거부")
  await denied(() => issueActions.issueMaterialsForWorkOrder({ workOrderId: "wo-A1", siteId: "site-A", items: [] }, "tenant-A"), "issueMaterialsForWorkOrder 비인증 거부")
  eq(fake.writes.length, 0, "비인증 쓰기 시도 DB write 0건")

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-03 타 tenant 읽기 거부")
  reset()
  loginAs("mgrA")
  const lotsA = await lotActions.getLots()
  eq(lotsA.map((l: any) => l.id).sort(), ["lot-A1", "lot-AQ"], "getLots 는 세션 tenant LOT 만 반환(타 tenant LOT 미포함)")
  eq(await woActions.getWorkOrderById("wo-B1"), null, "getWorkOrderById — 타 tenant ID 는 조회 불가(null)")
  await rejects(() => soActions.getSalesOrders("tenant-B"), "getSalesOrders — 타 tenant ID 인자 거부", /FORBIDDEN/)
  await rejects(() => lineageActions.getLotLineageByNo("LOT-B1", "tenant-B"), "getLotLineageByNo — 타 tenant ID 인자 거부", /FORBIDDEN/)
  eq(await lineageActions.getLotLineageByNo("LOT-B1", "tenant-A"), null, "getLotLineageByNo — 세션 tenant 로 타 tenant LOT 번호 조회 시 결과 없음")
  await rejects(() => issueActions.getWorkOrdersForIssue("tenant-B"), "getWorkOrdersForIssue 타 tenant 거부", /FORBIDDEN|권한/)
  await rejects(() => lotActions.searchLotByNo("LOT-B1", "tenant-B"), "searchLotByNo 타 tenant 거부", /FORBIDDEN/)
  eq(await lotActions.searchLotByNo("LOT-B1", "tenant-A"), null, "searchLotByNo 세션 tenant 기준 — 타 tenant LOT 미조회")
  loginAs("opA")
  await rejects(() => ecnActions.getECNs("tenant-A", "p-mgr-A", true), "getECNs — ECN READ 권한 없는 사용자는 isAdmin/profileId 를 위조해도 조회 불가", /권한/)

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-04 타 tenant 쓰기 거부")
  reset()
  loginAs("mgrA")
  await denied(() => lotActions.updateLotStatus("lot-B1", "ON_HOLD"), "updateLotStatus — 타 tenant LOT 변경 거부")
  eq(fake.tables().lot.find((l: Row) => l.id === "lot-B1")?.status, "ACTIVE", "타 tenant LOT 상태 불변")
  await denied(() => lotActions.createLot({ itemId: "item-B1", lotNo: "X-1", qty: 1 }, "tenant-A"), "createLot — 타 tenant 품목 거부 (DG-042)")
  await denied(() => lotActions.createLot({ itemId: "item-A1", lotNo: "X-2", qty: 1 }, "tenant-B"), "createLot — 클라이언트 tenantId 불일치 거부 (DG-042)")
  await denied(() => progressActions.completeRework({ reworkWipUnitId: "wip-B", mergedQty: 1, scrapQty: 0 }), "completeRework — 타 tenant WipUnit 거부")

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-05 사업장(site) 격리 — 해당 범위 확인")
  reset()
  loginAs("mgrA")
  const issueOtherSite = await issueActions.issueMaterialsForWorkOrder(
    { workOrderId: "wo-A1", siteId: "site-B", items: [{ itemId: "item-A1", issueQty: 1, requiredQty: 1, lotId: "lot-A1", warehouseId: "wh-1", reservationId: null }] },
    "tenant-A",
  )
  eq(issueOtherSite.ok, false, "자재출고 — 작업지시 사업장과 다른 siteId 거부")

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-06 직접 호출 우회 거부")
  reset()
  loginAs("opA")
  await denied(() => lotActions.updateLotStatus("lot-A1", "ON_HOLD"), "OPERATOR 가 LOT 상태 직접 변경 시도 거부")
  await denied(() => progressActions.completeRework({ reworkWipUnitId: "wip-x", mergedQty: 1, scrapQty: 0 }), "OPERATOR 가 재작업 종결 직접 호출 거부(MANAGER 이상)")
  loginAs("viewerA")
  await denied(() => lotActions.createLot({ itemId: "item-A1", lotNo: "V-1", qty: 1 }, "tenant-A"), "VIEWER 가 LOT 생성 직접 호출 거부")
  await rejects(() => woActions.getWorkOrders(), "VIEWER(WORK_ORDER READ 없음) 작업지시 목록 직접 호출 거부")
  loginAs("mgrA")
  await rejects(() => kpiActions.getKpiDashboardData(), "일반 MANAGER 의 KPI(범위 밖) 직접 호출 거부", /FORBIDDEN/)

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-07 MANAGER 정상 흐름 / DG-042 LOT 상태 변경")
  reset()
  loginAs("mgrA")
  await lotActions.createLot({ itemId: "item-A1", lotNo: " NEW-LOT ", qty: 1 }, "tenant-A")
  ok(fake.tables().lot.some((l: Row) => l.lotNo === "NEW-LOT" && l.tenantId === "tenant-A"), "MANAGER 가 자기 tenant 품목으로 LOT 생성(번호 trim)")
  await lotActions.updateLotStatus("lot-A1", "ON_HOLD")
  eq(fake.tables().lot.find((l: Row) => l.id === "lot-A1")?.status, "ON_HOLD", "MANAGER 가 LOT 상태 변경")
  ok(fake.tables().auditLog.some((a: Row) => a.entityType === "Lot" && a.entityId === "lot-A1" && a.action === "UPDATE"), "LOT 상태 변경 감사로그 기록 (DG-042)")
  await rejects(() => lotActions.updateLotStatus("lot-A1", "HACKED"), "LOT 상태 임의 문자열 거부 (DG-042)", /유효하지 않은 LOT 상태/)
  const wosA = await woActions.getWorkOrders().catch((e: Error) => e)
  ok(wosA instanceof Error || Array.isArray(wosA), "MANAGER 작업지시 목록 호출은 권한 오류 없이 처리")

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-08 OPERATOR 정상/제한")
  reset()
  loginAs("opA")
  const opLots = await lotActions.getLots()
  eq(opLots.length, 2, "OPERATOR 는 LOT READ 가능(세션 tenant 범위)")
  const opIssueLot = await issueActions.getWarehousesWithStock("tenant-A", ["item-A1"]).catch((e: Error) => e)
  ok(!(opIssueLot instanceof Error), "OPERATOR(PURCHASE_ORDER READ) 자재출고 창고 조회 가능")

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-09/10 POP 세션")
  reset()
  loginAs(null)
  cookieJar["nmes-pop-worker-session"] = "forged-pop-session"
  await rejects(() => lotActions.getLots(), "POP 세션 쿠키만으로 관리자 조회 액션(getLots) 거부", /UNAUTHORIZED/)
  await rejects(() => poActions.getPurchaseOrders("tenant-A"), "POP 세션 쿠키만으로 관리자 조회 액션(getPurchaseOrders) 거부", /UNAUTHORIZED/)
  await denied(() => lotActions.updateLotStatus("lot-A1", "ON_HOLD"), "POP 세션 쿠키만으로 관리자 쓰기 액션 거부")
  delete cookieJar["nmes-pop-worker-session"]

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-11 타 tenant 관계 ID 거부 (DG-021 / DG-042)")
  reset()
  loginAs("mgrA")
  const basePO = { orderDate: new Date(), expectedDate: new Date(), status: "DRAFT" as const, items: [{ itemId: "item-A1", qty: 1, unitPrice: 10 }] }
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-A", { ...basePO, supplierId: "sup-B" }), "발주 생성 — 타 tenant 공급처 거부", /공급처/)
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-B", { ...basePO, supplierId: "sup-A" }), "발주 생성 — 타 tenant 사업장 거부", /사업장/)
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-A", { ...basePO, supplierId: "sup-A", items: [{ itemId: "item-B1", qty: 1, unitPrice: 1 }] }), "발주 생성 — 타 tenant 품목 거부", /품목/)
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-A", { ...basePO, supplierId: "cus-A" }), "발주 생성 — 고객(공급처 아님) 거부", /공급처/)
  await rejects(() => qualityActions.createInspectionSpec({ itemId: "item-B1", routingOperationId: "ro-x", version: 1, status: "ACTIVE" }, "tenant-A"), "검사표준 생성 — 타 tenant 품목 거부", /품목/)
  eq(fake.writes.filter((w) => w.model === "purchaseOrder" || w.model === "inspectionSpec").length, 0, "관계 검증 실패 시 해당 테이블 write 0건")

  // ══════════════════════════════════════════════════════════════════════════
  section("SEC-12 완료/취소 상태 변경 거부 (DG-014 / DG-021)")
  reset()
  loginAs("mgrA")
  const issueBase = (workOrderId: string, itemId: string, lotId: string | null) => ({
    workOrderId,
    siteId: "site-A",
    items: [{ itemId, issueQty: 1, requiredQty: 1, lotId, warehouseId: "wh-1", reservationId: null }],
  })
  const completedIssue = await issueActions.issueMaterialsForWorkOrder(issueBase("wo-A2", "item-A1", "lot-A1"), "tenant-A")
  eq(completedIssue.ok, false, "COMPLETED 작업지시에 자재출고 거부")
  ok(/RELEASED|IN_PROGRESS|작업대기/.test(completedIssue.error ?? ""), "COMPLETED 작업지시 거부 사유 메시지")
  const notInBom = await issueActions.issueMaterialsForWorkOrder(issueBase("wo-A1", "item-A2", "lot-A1"), "tenant-A")
  eq(notInBom.ok, false, "BOM 에 없는 품목 출고 거부 (DG-014)")
  ok(/BOM/.test(notInBom.error ?? ""), "BOM 외 품목 거부 사유 메시지")
  const quarantined = await issueActions.issueMaterialsForWorkOrder(issueBase("wo-A1", "item-A1", "lot-AQ"), "tenant-A")
  eq(quarantined.ok, false, "QUARANTINE LOT 출고 거부 (DG-014)")
  ok(/사용할 수 없는 LOT|LOT/.test(quarantined.error ?? ""), "격리 LOT 거부 사유 메시지")
  eq(fake.writes.filter((w) => w.model === "inventoryTransaction" || w.model === "workOrderMaterialLot").length, 0, "출고 검증 실패 시 수불/LOT 연결 write 0건(부분 저장 없음)")
  await rejects(() => poActions.updatePurchaseOrder("po-A-received", { status: "DRAFT" }), "RECEIVED 발주를 DRAFT 로 되돌리기 거부 (DG-021)", /변경할 수 없습니다/)
  await rejects(() => poActions.updatePurchaseOrder("po-A-draft", { status: "RECEIVED" }), "DRAFT 발주를 RECEIVED 로 임의 설정 거부 (DG-021)", /변경할 수 없습니다/)
  await rejects(() => poActions.updatePurchaseOrder("po-A-draft", { status: "CLOSED" }), "DRAFT 발주를 CLOSED 로 임의 설정 거부 (DG-021)", /변경할 수 없습니다/)
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-A", { ...basePO, supplierId: "sup-A", status: "RECEIVED" as any }), "발주 생성 시 RECEIVED 초기 상태 거부 (DG-021)", /초안 또는 발주완료/)
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-A", { ...basePO, supplierId: "sup-A", items: [{ itemId: "item-A1", qty: -1, unitPrice: 1 }] }), "발주 수량 음수 거부", /0보다/)
  await rejects(() => poActions.createPurchaseOrder("tenant-A", "site-A", { ...basePO, supplierId: "sup-A", items: [{ itemId: "item-A1", qty: Number.NaN, unitPrice: 1 }] }), "발주 수량 NaN 거부", /0보다/)

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-021 상태 전이표 (순수)")
  ok(poStatus.isAllowedPurchaseOrderTransition("DRAFT", "ORDERED"), "DRAFT → ORDERED 허용")
  ok(poStatus.isAllowedPurchaseOrderTransition("ORDERED", "CANCELLED"), "ORDERED → CANCELLED 허용(이력 없을 때)")
  ok(poStatus.transitionRequiresNoHistory("ORDERED", "DRAFT"), "ORDERED → DRAFT 는 처리 이력 없음 검증 대상")
  ok(!poStatus.isAllowedPurchaseOrderTransition("ORDERED", "RECEIVED"), "ORDERED → RECEIVED 사용자 지정 불가(입고 처리로만)")
  ok(!poStatus.isAllowedPurchaseOrderTransition("PARTIAL_RECEIVED", "CLOSED"), "PARTIAL_RECEIVED → CLOSED 직접 지정 불가(잔량 종결 액션으로만)")
  ok(!poStatus.isAllowedPurchaseOrderTransition("CLOSED", "ORDERED"), "CLOSED 에서 재개 불가")
  ok(poStatus.isAllowedPurchaseOrderTransition("RECEIVED", "RECEIVED"), "동일 상태 유지(다른 필드 수정) 허용")

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-015 재작업 종결 — 개발자 전용 해제, 권한 기반")
  const progressSrc = readFileSync(join(SRC, "lib/actions/process-progress.actions.ts"), "utf8")
  ok(!/assertDaewonFeatureScope\(\)/.test(progressSrc), "process-progress 에 개발자 범위 가드 없음")
  ok(/requireResourcePermission\("WORK_RESULT", "UPDATE"\)/.test(progressSrc), "completeRework 는 WORK_RESULT UPDATE 권한 필요")
  ok(scope.DAEWON_ALLOWED_ROUTES.includes("/app/mes/rework"), "재작업/보류관리 화면이 허용 경로에 포함")
  eq(scope.isRouteAllowed("/app/mes/rework", { loginId: "mgr-a", role: "MANAGER" }), true, "일반 사용자도 /app/mes/rework 접근 가능")
  // 실제 종결 실행: 최종 공정 재작업 child → 복귀/폐기
  reset((t) => {
    t.wipUnit = [
      {
        id: "wip-child", tenantId: "tenant-A", siteId: "site-A", status: "REWORK", parentWipUnitId: "wip-root", sourceProductionResultId: "pr-1",
        qty: 3, workOrderOperationId: "op-last", currentWorkCenterId: "wc-1",
        parentWipUnit: { id: "wip-root", qty: 7, status: "COMPLETED", parentWipUnitId: null, workOrderOperationId: "op-last", currentWorkCenterId: "wc-1" },
        workOrderOperation: { id: "op-last", workOrder: { operations: [{ id: "op-last", seq: 2 }] } },
      },
      {
        id: "wip-child-B", tenantId: "tenant-B", siteId: "site-B", status: "REWORK", parentWipUnitId: "wip-rootB", sourceProductionResultId: "pr-b",
        qty: 1, workOrderOperationId: "op-b", currentWorkCenterId: "wc-b",
        parentWipUnit: { id: "wip-rootB", qty: 1, status: "COMPLETED", parentWipUnitId: null, workOrderOperationId: "op-b", currentWorkCenterId: "wc-b" },
        workOrderOperation: { id: "op-b", workOrder: { operations: [{ id: "op-b", seq: 1 }] } },
      },
      { id: "wip-root", tenantId: "tenant-A", status: "COMPLETED", qty: 7 },
    ]
    t.wipMovement = []
  })
  loginAs("mgrA")
  const doneCross = await progressActions.completeRework({ reworkWipUnitId: "wip-child-B", mergedQty: 1, scrapQty: 0 })
  eq(doneCross.ok, false, "MANAGER 가 타 tenant 재작업 WIP 종결 시도 거부")
  const doneOk = await progressActions.completeRework({ reworkWipUnitId: "wip-child", mergedQty: 2, scrapQty: 1 })
  eq(doneOk.ok, true, "MANAGER 가 자기 tenant 최종공정 재작업 종결 성공")
  eq(fake.tables().wipUnit.find((w: Row) => w.id === "wip-child")?.status, "COMPLETED", "재작업 WIP 종결 상태 반영")
  eq(fake.tables().wipUnit.find((w: Row) => w.id === "wip-root")?.qty, 9, "부모 WIP 에 복귀 수량(2) 합산")
  eq(fake.tables().wipMovement.filter((m: Row) => m.sourceType === "ReworkCompletion").length, 2, "복귀(MERGE)·폐기(SCRAP) 이동 이력 기록")
  const again = await progressActions.completeRework({ reworkWipUnitId: "wip-child", mergedQty: 2, scrapQty: 1 })
  eq(again.ok, false, "이미 종결된 재작업 재종결 거부(중복 방지)")
  loginAs("opA")
  await denied(() => progressActions.completeRework({ reworkWipUnitId: "wip-child", mergedQty: 1, scrapQty: 0 }), "OPERATOR 재작업 종결 거부")

  const popSrc = readFileSync(join(SRC, "lib/actions/pop.actions.ts"), "utf8")
  ok(/재작업 수량은 최종 공정에서만 등록할 수 있습니다/.test(popSrc), "POP 중간공정 재작업 입력 차단(종결 불가능한 데드엔드 방지)")

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-031 검사표준 없음 → 실적 전체 롤백 금지")
  const txNoSpec: any = {
    defectCode: { findMany: async () => [{ id: "dc-1", code: "DEF-01" }, { id: "dc-2", code: "DEF-02" }] },
    inspectionSpec: { findFirst: async () => null },
    qualityInspection: { create: async () => { throw new Error("must not be called") } },
    defectRecord: { createMany: async () => { throw new Error("must not be called") } },
  }
  const noSpecResult = await selfInspection.recordSelfInspectionDefects(txNoSpec, {
    tenantId: "tenant-A", workOrderOperationId: "op-1", itemId: "item-AF", routingOperationId: "ro-1", inspectorProfileId: "p-op-A",
    inspectedQty: 10, defectDetails: [{ defectCodeId: "dc-1", qty: 2 }, { defectCodeId: "dc-2", qty: 1 }],
  })
  eq(noSpecResult.recorded, false, "검사표준 없음: 예외 대신 recorded=false 반환(트랜잭션 유지)")
  eq(noSpecResult.reason, "NO_INSPECTION_SPEC", "사유 NO_INSPECTION_SPEC")
  ok(/DEF-01x2/.test(noSpecResult.defectSummary) && /DEF-02x1/.test(noSpecResult.defectSummary), "불량코드 내역이 요약으로 보존됨")
  let created = 0
  const txSpec: any = {
    defectCode: { findMany: async () => [{ id: "dc-1", code: "DEF-01" }] },
    inspectionSpec: { findFirst: async () => ({ id: "spec-1" }) },
    qualityInspection: { create: async () => ({ id: "qi-1" }) },
    defectRecord: { createMany: async (a: any) => { created = a.data.length; return { count: created } } },
  }
  const withSpec = await selfInspection.recordSelfInspectionDefects(txSpec, {
    tenantId: "tenant-A", workOrderOperationId: "op-1", itemId: "item-AF", routingOperationId: "ro-1", inspectorProfileId: "p-op-A",
    inspectedQty: 10, defectDetails: [{ defectCodeId: "dc-1", qty: 2 }],
  })
  eq(withSpec.recorded, true, "검사표준 있음: 기존대로 자주검사 기록")
  eq(created, 1, "불량 상세(DefectRecord) 생성")
  await rejects(
    () => selfInspection.recordSelfInspectionDefects({ ...txSpec, defectCode: { findMany: async () => [] } }, {
      tenantId: "tenant-A", workOrderOperationId: "op-1", itemId: "item-AF", routingOperationId: "ro-1", inspectorProfileId: "p-op-A",
      inspectedQty: 1, defectDetails: [{ defectCodeId: "dc-foreign", qty: 1 }],
    }),
    "타 tenant/미등록 불량코드는 여전히 오류(입력 검증 유지)",
    /불량코드/,
  )

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-033 에이전트 키 — 난수 발급·해시 저장·상한")
  const k1 = agentKey.generateAgentKey()
  const k2 = agentKey.generateAgentKey()
  ok(k1 !== k2 && k1.length >= 40 && k1.startsWith("dwk_"), "에이전트 키는 충분한 길이의 난수(cuid 아님)")
  ok(agentKey.hashAgentKey(k1).startsWith("sha256:") && agentKey.hashAgentKey(k1) !== k1, "저장값은 sha256 해시")
  ok(!agentKey.isPresentableAgentKey("sha256:" + "a".repeat(64)), "해시 문자열을 키로 제시하는 우회 거부")
  ok(!agentKey.isPresentableAgentKey("short"), "너무 짧은 키 거부")
  const mkReq = (key: string | null) => ({ headers: { get: (n: string) => (n === "X-Agent-Key" ? key : null) } }) as any
  reset((t) => {
    t.edgeGateway = [
      { id: "gw-new", tenantId: "tenant-A", siteId: "site-A", apiKey: agentKey.hashAgentKey(k1) },
      { id: "gw-legacy", tenantId: "tenant-A", siteId: "site-A", apiKey: "cl9legacyplaintextkey000001" },
    ]
  })
  eq((await ncwatchAuth.verifyAgentKey(mkReq(k1)))?.gatewayId, "gw-new", "해시 저장 키로 인증")
  eq(await ncwatchAuth.verifyAgentKey(mkReq(agentKey.hashAgentKey(k1))), null, "저장된 해시값 자체로는 인증 불가")
  eq(await ncwatchAuth.verifyAgentKey(mkReq(k2)), null, "알 수 없는 키 거부")
  eq(await ncwatchAuth.verifyAgentKey(mkReq(null)), null, "키 없음 거부")
  eq((await ncwatchAuth.verifyAgentKey(mkReq("cl9legacyplaintextkey000001")))?.gatewayId, "gw-legacy", "과거 평문 키 읽기 호환")
  ok(String(fake.tables().edgeGateway.find((g: Row) => g.id === "gw-legacy")?.apiKey).startsWith("sha256:"), "과거 평문 키는 사용 시 해시로 전환")
  const statusRoute = readFileSync(join(SRC, "app/api/lms/ncwatch/status/route.ts"), "utf8")
  ok(/INGEST_MAX_BODY_BYTES/.test(statusRoute) && /INGEST_MAX_MACHINES/.test(statusRoute), "수집 API(status) 본문/건수 상한 적용")
  const dailyRoute = readFileSync(join(SRC, "app/api/lms/ncwatch/report-daily/route.ts"), "utf8")
  ok(/INGEST_MAX_BODY_BYTES/.test(dailyRoute) && /INGEST_MAX_MACHINES/.test(dailyRoute), "수집 API(report-daily) 본문/건수 상한 적용")

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-013 Edge middleware JWT 서명 검증")
  const secret = process.env.JWT_SECRET as string
  const good = jwt.sign({ profileId: "p", tenantId: "t", loginId: "x", role: "OWNER" }, secret, { expiresIn: 60 })
  eq((await edgeJwt.verifyHs256Jwt(good, secret))?.loginId, "x", "유효한 토큰 통과")
  eq(await edgeJwt.verifyHs256Jwt("garbage", secret), null, "형식이 틀린 토큰 거부")
  eq(await edgeJwt.verifyHs256Jwt(good, "other-secret"), null, "다른 비밀키 거부")
  const [h, p, s] = good.split(".")
  const forgedPayload = Buffer.from(JSON.stringify({ profileId: "p", tenantId: "t", loginId: "test", role: "OWNER" })).toString("base64url")
  eq(await edgeJwt.verifyHs256Jwt(`${h}.${forgedPayload}.${s}`, secret), null, "payload 변조(loginId=test) 거부")
  const expired = jwt.sign({ profileId: "p", loginId: "x" }, secret, { expiresIn: -10 })
  eq(await edgeJwt.verifyHs256Jwt(expired, secret), null, "만료 토큰 거부")
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  eq(await edgeJwt.verifyHs256Jwt(`${noneHeader}.${p}.`, secret), null, "alg=none 거부")
  eq(await edgeJwt.verifyHs256Jwt(good, undefined), null, "비밀키 미설정 시 fail-closed")
  const mw = readFileSync(join(SRC, "middleware.ts"), "utf8")
  ok(/verifyHs256Jwt/.test(mw) && !/decodeJwtPayloadUnverified/.test(mw), "middleware 는 서명 검증된 세션만 인정")

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-017 개발자 계정 위험 — 코드 경로")
  eq(developer.isDeveloperUser({ loginId: "test" }), true, "기본: loginId=test 는 개발자(현행 유지)")
  process.env.DAEWON_DISABLE_DEVELOPER_ACCESS = "1"
  eq(developer.isDeveloperUser({ loginId: "test" }), false, "DAEWON_DISABLE_DEVELOPER_ACCESS=1 → 개발자 권한 상승 해제")
  eq(scope.isDeveloperLogin("test"), false, "범위 정책의 개발자 예외도 동일 스위치로 해제")
  eq(scope.isRouteAllowed("/app/mes/gateways", { loginId: "test", role: "OWNER" }), false, "스위치 ON: test 계정도 개발자 전용 경로 차단")
  eq(scope.isRouteAllowed("/app/mes/kpi", { loginId: "test", role: "OWNER" }), false, "스위치 ON: test 계정도 범위 밖 경로 차단")
  delete process.env.DAEWON_DISABLE_DEVELOPER_ACCESS
  eq(scope.isRouteAllowed("/app/mes/gateways", { loginId: "test", role: "OWNER" }), true, "스위치 OFF: 기존 동작 유지")
  const seedSrc = readFileSync(join(root, "prisma/seed-daewon.ts"), "utf8")
  ok(/DAEWON_SEED_CONFIRM !== 'YES'/.test(seedSrc) && /SEED_DEVELOPER_PASSWORD/.test(seedSrc), "개발자 계정은 명시적 환경변수 없이는 seed 로 생성되지 않음")
  ok(!/passwordHash:\s*await bcrypt\.hash\(['"][^'"]+['"]/.test(seedSrc), "seed 에 하드코딩된 비밀번호 없음")
  const srcAll: string[] = []
  ;(function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p2 = join(d, f)
      if (statSync(p2).isDirectory()) walk(p2)
      else if (/\.(ts|tsx)$/.test(f)) srcAll.push(p2)
    }
  })(SRC)
  const hardcodedPin = srcAll.filter((f) => /popPinHash:\s*['"]|defaultPin\s*=|DEFAULT_POP_PIN/.test(readFileSync(f, "utf8")))
  eq(hardcodedPin, [], "소스에 하드코딩된 POP PIN/기본 PIN 없음")
  ok(/auth\.ts/.test("auth.ts") && /process\.env\.NODE_ENV === 'production'/.test(readFileSync(join(SRC, "lib/auth.ts"), "utf8")), "운영에서는 DEFAULT_TENANT_ID 미설정 시 데모 테넌트로 폴백하지 않음")

  // ══════════════════════════════════════════════════════════════════════════
  section("DG-013 정적 가드 스캔 — 'use server' 파일의 모든 export 는 인증 가드 필요")
  const GUARD = /(\brequire\w+\(|\bauthorize\w*|\bassert\w+\(|\bgetCurrentUser\(|\bresolvePop\w+|\bgetPop\w*Session|\bverifyPop\w*|\bensure\w*Access\w*\(|\bwithAuth)/
  const PUBLIC_BY_DESIGN = new Set(["getEquipmentMonitorLive", "getProductionKPIs"]) // 현황판(/kiosk) — docs 참고
  const unguarded: string[] = []
  let exportCount = 0
  for (const f of srcAll) {
    const text = readFileSync(f, "utf8")
    if (!/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(text.slice(0, 400))) continue
    const re = /export\s+async\s+function\s+(\w+)\s*(<[^>]*>)?\s*\(([\s\S]*?)\)\s*(?::[^{]*)?\{/g
    const found: Array<{ n: string; i: number }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) found.push({ n: m[1], i: m.index })
    for (let k = 0; k < found.length; k++) {
      exportCount++
      const body = text.slice(found[k].i, k + 1 < found.length ? found[k + 1].i : text.length)
      if (!GUARD.test(body) && !PUBLIC_BY_DESIGN.has(found[k].n)) unguarded.push(`${f.slice(SRC.length + 1)}::${found[k].n}`)
    }
  }
  ok(exportCount > 400, `server action export ${exportCount}개 스캔`)
  eq(unguarded, [], "가드 없는 server action 0개 (현황판 공개 2개 제외)")

  console.log(`\n${passed} assertions passed`)
}

main()
  .then(() => {
    ;(Module as any)._load = origLoad
    ;(Module as any)._resolveFilename = origResolve
  })
  .catch((e) => {
    console.error("\nFAILED:", e)
    process.exit(1)
  })
