/**
 * Phase 11 — LOT / QR 제조이력 추적 회귀 테스트
 *
 * 실행: npm run test:phase11-lot-qr
 *
 * 실제 서버 모듈(QR 파서, Trace 서비스, lookup/label/trace Server Action)을 메모리 fake DB 위에서 그대로 실행한다.
 * 실제 DB 접속/쓰기 없음. 인증은 Phase 10 과 같이 실제 auth 코드가 fake DB 위에서 동작한다.
 *
 *  QR-01..09      QR payload / 파서
 *  SCAN-01..10    스캔 조회 보안·상태·중복
 *  TRACE-R01..08  원자재 계보
 *  TRACE-F01..08  완제품 계보
 *  TRACE-01..08   정/역방향 · 부분출하 · 불량 · 검사표준 없음 · 설비/공정 없음
 *  PROP-*         속성(property) 테스트
 *  PERF-*         쿼리 수 / 실행시간(N+1 없음)
 */
import assert from "node:assert/strict"
import { join, sep } from "node:path"
import Module from "node:module"
import jwt from "jsonwebtoken"

const root = process.cwd()
const SRC = join(root, "src")

let passed = 0
const ok = (value: unknown, label: string) => {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}
const eq = <T,>(actual: T, expected: T, label: string) => {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
const section = (t: string) => console.log("\n── " + t)

// ─── 환경 / 모듈 대체 ─────────────────────────────────────────────────────────
process.env.JWT_SECRET = "phase11-test-secret-0123456789abcdef"
process.env.POP_WORKER_SESSION_SECRET = "phase11-pop-session-secret-0123456789"
process.env.DEFAULT_TENANT_ID = "tenant-A"
delete process.env.NEXT_PUBLIC_BRAND
delete process.env.DAEWON_DISABLE_DEVELOPER_ACCESS

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { matches } = require("./helpers/fake-db") as { matches: (row: any, where: any) => boolean }

type Row = Record<string, any>
let seq = 1
function makeFake(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const reads: Array<{ model: string; op: string }> = []
  const writes: Array<{ model: string; op: string }> = []
  const rows = (name: string) => (tables[name] ??= [])
  const model = (name: string) => ({
    findUnique: async (a: any) => {
      reads.push({ model: name, op: "findUnique" })
      const r = rows(name).find((x) => matches(x, a?.where ?? {}))
      return r ? { ...r } : null
    },
    findFirst: async (a: any) => {
      reads.push({ model: name, op: "findFirst" })
      const r = rows(name).find((x) => matches(x, a?.where ?? {}))
      return r ? { ...r } : null
    },
    findMany: async (a: any) => {
      reads.push({ model: name, op: "findMany" })
      let out = rows(name).filter((x) => matches(x, a?.where ?? {}))
      if (a?.take !== undefined) out = out.slice(0, a.take)
      return out.map((r) => ({ ...r }))
    },
    count: async (a: any) => rows(name).filter((x) => matches(x, a?.where ?? {})).length,
    create: async (a: any) => {
      writes.push({ model: name, op: "create" })
      const row = { id: `${name}-${seq++}`, createdAt: new Date("2026-10-01T00:00:00Z"), ...a.data }
      rows(name).push(row)
      return { ...row }
    },
    update: async (a: any) => {
      writes.push({ model: name, op: "update" })
      const r = rows(name).find((x) => matches(x, a.where))
      if (!r) throw new Error("NotFound")
      Object.assign(r, a.data)
      return { ...r }
    },
    updateMany: async (a: any) => {
      writes.push({ model: name, op: "updateMany" })
      const t = rows(name).filter((x) => matches(x, a.where))
      t.forEach((r) => Object.assign(r, a.data))
      return { count: t.length }
    },
    aggregate: async () => ({ _sum: {} }),
  })
  const prisma: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "$transaction") return async (cb: any) => cb(prisma)
        if (prop === "$queryRaw" || prop === "$executeRaw") return async () => []
        return model(prop)
      },
    },
  )
  return { prisma, tables, reads, writes }
}

let fake = makeFake({})
const cookieJar: Record<string, string | undefined> = {}

const origResolve = (Module as any)._resolveFilename
const origLoad = (Module as any)._load
;(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (typeof request === "string" && request.startsWith("@/")) request = join(SRC, request.slice(2))
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
    const stable = new Proxy({}, { get: (_t, prop) => (fake.prisma as any)[prop as string] })
    return { prisma: stable, default: stable }
  }
  return origLoad.call(this, request, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const qr = require("../src/lib/qr/lot-qr")
const guard = require("../src/lib/qr/scan-guard")
const apply = require("../src/lib/qr/scan-apply")
const traceService = require("../src/lib/traceability/lot-trace.service")
const lotPolicy = require("../src/lib/lot-policy/lot-policy")
const qrActions = require("../src/lib/actions/lot-qr.actions")
const traceActions = require("../src/lib/actions/lot-trace.actions")
const issueActions = require("../src/lib/actions/material-issue.actions")
/* eslint-enable @typescript-eslint/no-var-requires */

// ─── Fixture ──────────────────────────────────────────────────────────────────
const token = (profileId: string, tenantId: string, loginId: string, role: string) =>
  jwt.sign({ profileId, tenantId, loginId, name: loginId, role }, process.env.JWT_SECRET as string, { expiresIn: 3600 })
const USERS = {
  ownerA: { profileId: "p-owner-A", tenantId: "tenant-A", loginId: "owner-a", role: "OWNER" },
  mgrA: { profileId: "p-mgr-A", tenantId: "tenant-A", loginId: "mgr-a", role: "MANAGER" },
  opA: { profileId: "p-op-A", tenantId: "tenant-A", loginId: "op-a", role: "OPERATOR" },
  viewerA: { profileId: "p-view-A", tenantId: "tenant-A", loginId: "view-a", role: "VIEWER" },
  ownerB: { profileId: "p-owner-B", tenantId: "tenant-B", loginId: "owner-b", role: "OWNER" },
} as const
function loginAs(u: keyof typeof USERS | null) {
  cookieJar["nmes-session"] = u ? token(USERS[u].profileId, USERS[u].tenantId, USERS[u].loginId, USERS[u].role) : undefined
}
const perm = (tenantId: string, role: string, resource: string, actions: string[]) =>
  actions.map((action) => ({ tenantId, role, resource, action, isAllowed: true }))

const D = (s: string) => new Date(s)

function seedTables(): Record<string, Row[]> {
  const users = Object.values(USERS)
  const lot = (id: string, lotNo: string, itemId: string, status = "ACTIVE", tenantId = "tenant-A") => ({
    id, tenantId, itemId, lotNo, status, createdAt: D("2026-09-01T00:00:00Z"), manufactureDate: null, expiryDate: null,
  })
  return {
    userCredential: users.map((u) => ({ profileId: u.profileId, tenantId: u.tenantId, loginId: u.loginId, isLocked: false, mustChangePw: false })),
    tenantUser: users.map((u) => ({ id: `tu-${u.profileId}`, profileId: u.profileId, tenantId: u.tenantId, role: u.role, isActive: true, siteId: "site-A" })),
    profile: [
      ...users.map((u) => ({ id: u.profileId, email: `${u.loginId}@x`, name: u.loginId })),
      { id: "p-worker-1", email: "w1@x", name: "작업자김" },
      { id: "p-insp-1", email: "i1@x", name: "검사원박" },
    ],
    rolePermission: [
      ...perm("tenant-A", "MANAGER", "LOT", ["READ", "CREATE", "UPDATE"]),
      ...perm("tenant-A", "MANAGER", "SHIPMENT", ["READ"]),
      ...perm("tenant-A", "OPERATOR", "LOT", ["READ"]),
      ...perm("tenant-A", "OPERATOR", "WORK_ORDER", ["READ"]),
      ...perm("tenant-A", "VIEWER", "LOT", ["READ"]),
    ],
    item: [
      { id: "item-R1", tenantId: "tenant-A", code: "RM-1", name: "원자재1", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-R2", tenantId: "tenant-A", code: "RM-2", name: "원자재2", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-R3", tenantId: "tenant-A", code: "RM-3", name: "원자재3", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-F1", tenantId: "tenant-A", code: "FG-1", name: "완제품1", itemType: "FINISHED", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-X", tenantId: "tenant-A", code: "RM-X", name: "BOM외자재", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
      { id: "item-B1", tenantId: "tenant-B", code: "RM-B1", name: "B사자재", itemType: "RAW_MATERIAL", isLotTracked: true, uom: "EA", status: "ACTIVE" },
    ],
    lot: [
      lot("lot-R1", "LOT-R1", "item-R1"),
      lot("lot-R2", "LOT-R2", "item-R2"),
      lot("lot-R3", "LOT-R3", "item-R3"),
      lot("lot-F1", "LOT-F1", "item-F1"),
      lot("lot-F2", "LOT-F2", "item-F1"),
      lot("lot-F3", "LOT-F3", "item-F1"),
      lot("lot-HOLD", "LOT-HOLD", "item-R1", "ON_HOLD"),
      lot("lot-QUAR", "LOT-QUAR", "item-R1", "QUARANTINE"),
      lot("lot-CONS", "LOT-CONS", "item-R1", "CONSUMED"),
      lot("lot-EXP", "LOT-EXP", "item-R1", "EXPIRED"),
      lot("lot-X", "LOT-X", "item-X"),
      lot("lot-R9", "LOT-R9", "item-R1"), // 입고(공급사) 이력이 없는 원자재 LOT
      lot("lot-AONLY", "LOT-A-ONLY", "item-R1"),
      // tenant-B: 같은 lotNo 문자열을 가진 다른 tenant 의 LOT
      lot("lotB-R1", "LOT-R1", "item-B1", "ACTIVE", "tenant-B"),
      lot("lotB-F1", "LOT-BF1", "item-B1", "ACTIVE", "tenant-B"),
    ],
    inventoryBalance: [
      { id: "bal-R1", tenantId: "tenant-A", lotId: "lot-R1", itemId: "item-R1", warehouseId: "wh-A", siteId: "site-A", qtyOnHand: 50, qtyAvailable: 50, qtyHold: 0 },
      { id: "bal-R2", tenantId: "tenant-A", lotId: "lot-R2", itemId: "item-R2", warehouseId: "wh-A", siteId: "site-A", qtyOnHand: 0, qtyAvailable: 0, qtyHold: 0 },
      { id: "bal-HOLD", tenantId: "tenant-A", lotId: "lot-HOLD", itemId: "item-R1", warehouseId: "wh-A", siteId: "site-A", qtyOnHand: 7, qtyAvailable: 7, qtyHold: 0 },
      { id: "bal-X", tenantId: "tenant-A", lotId: "lot-X", itemId: "item-X", warehouseId: "wh-A", siteId: "site-A", qtyOnHand: 9, qtyAvailable: 9, qtyHold: 0 },
      { id: "bal-F1", tenantId: "tenant-A", lotId: "lot-F1", itemId: "item-F1", warehouseId: "wh-A", siteId: "site-A", qtyOnHand: 0, qtyAvailable: 0, qtyHold: 0 },
      { id: "bal-AONLY", tenantId: "tenant-A", lotId: "lot-AONLY", itemId: "item-R1", warehouseId: "wh-A", siteId: "site-A", qtyOnHand: 4, qtyAvailable: 4, qtyHold: 0 },
    ],
    warehouse: [{ id: "wh-A", tenantId: "tenant-A", siteId: "site-A", code: "WH-RAW", name: "원자재창고" }],
    businessPartner: [
      { id: "sup-1", tenantId: "tenant-A", code: "S-001", name: "공급사1", partnerType: "SUPPLIER" },
      { id: "sup-2", tenantId: "tenant-A", code: "S-002", name: "공급사2", partnerType: "SUPPLIER" },
      { id: "cus-1", tenantId: "tenant-A", code: "C-001", name: "고객1", partnerType: "CUSTOMER" },
      { id: "cus-2", tenantId: "tenant-A", code: "C-002", name: "고객2", partnerType: "CUSTOMER" },
      { id: "supB", tenantId: "tenant-B", code: "S-B", name: "B공급사", partnerType: "SUPPLIER" },
    ],
    purchaseOrder: [
      { id: "po-1", tenantId: "tenant-A", orderNo: "PO-1", supplierId: "sup-1", status: "RECEIVED", orderDate: D("2026-08-20T00:00:00Z") },
      { id: "po-2", tenantId: "tenant-A", orderNo: "PO-2", supplierId: "sup-2", status: "RECEIVED", orderDate: D("2026-08-21T00:00:00Z") },
      { id: "poB-1", tenantId: "tenant-B", orderNo: "PO-B1", supplierId: "supB", status: "RECEIVED", orderDate: D("2026-08-22T00:00:00Z") },
    ],
    inventoryTransaction: [
      // 입고(RECEIPT, PURCHASE_ORDER) — R1 100개(공급사1), R2 40(공급사2), R3 30(공급사1)
      { id: "tx-r1", tenantId: "tenant-A", itemId: "item-R1", lotId: "lot-R1", txNo: "TX-R1", txType: "RECEIPT", qty: 100, refType: "PURCHASE_ORDER", refId: "po-1", txAt: D("2026-09-01T00:00:00Z") },
      { id: "tx-r2", tenantId: "tenant-A", itemId: "item-R2", lotId: "lot-R2", txNo: "TX-R2", txType: "RECEIPT", qty: 40, refType: "PURCHASE_ORDER", refId: "po-2", txAt: D("2026-09-01T00:00:00Z") },
      { id: "tx-r3", tenantId: "tenant-A", itemId: "item-R3", lotId: "lot-R3", txNo: "TX-R3", txType: "RECEIPT", qty: 30, refType: "PURCHASE_ORDER", refId: "po-1", txAt: D("2026-09-01T00:00:00Z") },
      // 출고(ISSUE, WORK_ORDER): WO-1 ← R1 30, R2 40, R3 30 / WO-2 ← R1 20
      { id: "tx-i1", tenantId: "tenant-A", itemId: "item-R1", lotId: "lot-R1", txNo: "TX-I1", txType: "ISSUE", qty: 30, refType: "WORK_ORDER", refId: "wo-1", txAt: D("2026-09-05T00:00:00Z") },
      { id: "tx-i2", tenantId: "tenant-A", itemId: "item-R2", lotId: "lot-R2", txNo: "TX-I2", txType: "ISSUE", qty: 40, refType: "WORK_ORDER", refId: "wo-1", txAt: D("2026-09-05T00:00:00Z") },
      { id: "tx-i3", tenantId: "tenant-A", itemId: "item-R3", lotId: "lot-R3", txNo: "TX-I3", txType: "ISSUE", qty: 30, refType: "WORK_ORDER", refId: "wo-1", txAt: D("2026-09-05T00:00:00Z") },
      { id: "tx-i4", tenantId: "tenant-A", itemId: "item-R1", lotId: "lot-R1", txNo: "TX-I4", txType: "ISSUE", qty: 20, refType: "WORK_ORDER", refId: "wo-2", txAt: D("2026-09-08T00:00:00Z") },
      // 완제품 입고
      { id: "tx-f1", tenantId: "tenant-A", itemId: "item-F1", lotId: "lot-F1", txNo: "TX-F1", txType: "RECEIPT", qty: 10, refType: "WORK_ORDER", refId: "wo-1", txAt: D("2026-09-10T00:00:00Z") },
      // tenant-B 의 같은 lotNo(LOT-R1) 입고
      { id: "txB-r1", tenantId: "tenant-B", itemId: "item-B1", lotId: "lotB-R1", txNo: "TXB-R1", txType: "RECEIPT", qty: 5, refType: "PURCHASE_ORDER", refId: "poB-1", txAt: D("2026-09-01T00:00:00Z") },
    ],
    workOrder: [
      { id: "wo-1", tenantId: "tenant-A", orderNo: "WO-1", manufacturingNo: "MFG-1", itemId: "item-F1", plannedQty: 25, status: "COMPLETED", productionPlanItemId: "ppi-1", createdAt: D("2026-09-04T00:00:00Z"), bomId: "bom-1" },
      { id: "wo-2", tenantId: "tenant-A", orderNo: "WO-2", manufacturingNo: "MFG-2", itemId: "item-F1", plannedQty: 8, status: "COMPLETED", productionPlanItemId: null, createdAt: D("2026-09-07T00:00:00Z"), bomId: "bom-1" },
      { id: "woB-1", tenantId: "tenant-B", orderNo: "WO-B1", manufacturingNo: "MFG-B1", itemId: "item-B1", plannedQty: 5, status: "COMPLETED", productionPlanItemId: null, createdAt: D("2026-09-07T00:00:00Z"), bomId: "bomB" },
    ],
    bOM: [{ id: "bom-1", tenantId: "tenant-A" }],
    bOMItem: [
      { id: "bi-1", bomId: "bom-1", componentItemId: "item-R1", qtyPer: 1, scrapRate: 0 },
      { id: "bi-2", bomId: "bom-1", componentItemId: "item-R2", qtyPer: 1, scrapRate: 0 },
      { id: "bi-3", bomId: "bom-1", componentItemId: "item-R3", qtyPer: 1, scrapRate: 0 },
    ],
    itemSubstitute: [],
    productionPlanItem: [{ id: "ppi-1", planId: "plan-1", itemId: "item-F1" }],
    productionPlan: [{ id: "plan-1", tenantId: "tenant-A", planNo: "PLAN-1", status: "CONFIRMED", startDate: D("2026-09-01T00:00:00Z") }],
    workOrderMaterialLot: [
      { id: "woml-1", tenantId: "tenant-A", workOrderId: "wo-1", materialItemId: "item-R1", materialLotNo: "LOT-R1", qty: 30, inventoryTransactionId: "tx-i1", issuedAt: D("2026-09-05T00:00:00Z") },
      { id: "woml-2", tenantId: "tenant-A", workOrderId: "wo-1", materialItemId: "item-R2", materialLotNo: "LOT-R2", qty: 40, inventoryTransactionId: "tx-i2", issuedAt: D("2026-09-05T00:00:00Z") },
      { id: "woml-3", tenantId: "tenant-A", workOrderId: "wo-1", materialItemId: "item-R3", materialLotNo: "LOT-R3", qty: 30, inventoryTransactionId: "tx-i3", issuedAt: D("2026-09-05T00:00:00Z") },
      { id: "woml-4", tenantId: "tenant-A", workOrderId: "wo-2", materialItemId: "item-R1", materialLotNo: "LOT-R1", qty: 20, inventoryTransactionId: "tx-i4", issuedAt: D("2026-09-08T00:00:00Z") },
      // tenant-B 도 같은 lotNo 문자열을 투입했다 — tenant-A 추적에 섞이면 안 된다.
      { id: "womlB-1", tenantId: "tenant-B", workOrderId: "woB-1", materialItemId: "item-B1", materialLotNo: "LOT-R1", qty: 5, inventoryTransactionId: "txB-r1", issuedAt: D("2026-09-07T00:00:00Z") },
    ],
    finishedGoodsReceipt: [
      // WO-1 은 완제품 LOT 2개(F1 10, F2 15), WO-2 는 F3 8
      { id: "fgr-1", tenantId: "tenant-A", workOrderId: "wo-1", itemId: "item-F1", lotId: "lot-F1", receiptQty: 10, receiptAt: D("2026-09-10T00:00:00Z") },
      { id: "fgr-2", tenantId: "tenant-A", workOrderId: "wo-1", itemId: "item-F1", lotId: "lot-F2", receiptQty: 15, receiptAt: D("2026-09-11T00:00:00Z") },
      { id: "fgr-3", tenantId: "tenant-A", workOrderId: "wo-2", itemId: "item-F1", lotId: "lot-F3", receiptQty: 8, receiptAt: D("2026-09-12T00:00:00Z") },
    ],
    lotGenealogy: [
      // 다른 tenant LOT 로 향하는 genealogy — 추적에 포함되면 안 된다.
      { id: "gen-x", parentLotId: "lot-R1", childLotId: "lotB-F1", relationType: "INPUT", qty: 1 },
    ],
    shipmentOrder: [
      { id: "sh-1", tenantId: "tenant-A", shipmentNo: "SH-1", salesOrderId: "so-1", status: "SHIPPED", plannedDate: D("2026-09-15T00:00:00Z"), shippedDate: D("2026-09-15T00:00:00Z") },
      { id: "sh-2", tenantId: "tenant-A", shipmentNo: "SH-2", salesOrderId: "so-2", status: "SHIPPED", plannedDate: D("2026-09-16T00:00:00Z"), shippedDate: D("2026-09-16T00:00:00Z") },
    ],
    shipmentItem: [
      // SH-1: F1 4(부분출하) + F2 15 → 여러 완제품 LOT 를 한 출하에 / SH-2: F1 6 → 한 LOT 를 여러 출하에
      { id: "si-1", shipmentOrderId: "sh-1", salesOrderItemId: "soi-1", itemId: "item-F1", lotId: "lot-F1", qty: 4 },
      { id: "si-2", shipmentOrderId: "sh-1", salesOrderItemId: "soi-1", itemId: "item-F1", lotId: "lot-F2", qty: 15 },
      { id: "si-3", shipmentOrderId: "sh-2", salesOrderItemId: "soi-2", itemId: "item-F1", lotId: "lot-F1", qty: 6 },
    ],
    salesOrder: [
      { id: "so-1", tenantId: "tenant-A", orderNo: "SO-1", customerId: "cus-1" },
      { id: "so-2", tenantId: "tenant-A", orderNo: "SO-2", customerId: "cus-2" },
    ],
    workOrderOperation: [
      { id: "op-1a", workOrderId: "wo-1", routingOperationId: "rop-1", equipmentId: "eq-1", seq: 1, status: "COMPLETED", completedQty: 25 },
      { id: "op-1b", workOrderId: "wo-1", routingOperationId: "rop-2", equipmentId: null, seq: 2, status: "COMPLETED", completedQty: 25 },
      // WO-2 는 공정 이력 없음(TRACE-08)
    ],
    routingOperation: [
      { id: "rop-1", routingId: "r-1", workCenterId: "wc-1", seq: 1, name: "절단" },
      { id: "rop-2", routingId: "r-1", workCenterId: "wc-2", seq: 2, name: "도장" },
    ],
    workOrderOperationAssignment: [],
    equipment: [{ id: "eq-1", tenantId: "tenant-A", code: "EQ-1", name: "절단기1" }],
    productionResult: [
      { id: "pr-1", workOrderOperationId: "op-1a", workOrderOperationAssignmentId: null, goodQty: 23, defectQty: 2, reworkQty: 0, startedAt: D("2026-09-06T00:00:00Z"), endedAt: D("2026-09-06T05:00:00Z"), operatorId: "p-worker-1" },
      { id: "pr-2", workOrderOperationId: "op-1b", workOrderOperationAssignmentId: null, goodQty: 25, defectQty: 0, reworkQty: 0, startedAt: D("2026-09-07T00:00:00Z"), endedAt: D("2026-09-07T05:00:00Z"), operatorId: null },
    ],
    qualityInspection: [
      { id: "qi-1", workOrderOperationId: "op-1a", inspectionSpecId: "spec-1", inspectorId: "p-insp-1", stage: "FINAL", result: "PASS", inspectedQty: 25, inspectedAt: D("2026-09-09T00:00:00Z"), lotId: "lot-F1" },
    ],
    auditLog: [],
  }
}
function reset(extra?: (t: Record<string, Row[]>) => void) {
  const t = seedTables()
  extra?.(t)
  fake = makeFake(t)
}
const asDb = () => traceService.traceLotDb(fake.prisma)
const tenantAIds = () => {
  const t = fake.tables
  const ids = new Set<string>()
  for (const [name, rows] of Object.entries(t)) {
    if (["lot", "workOrder", "purchaseOrder", "businessPartner", "shipmentOrder", "item", "productionPlan"].includes(name)) {
      rows.filter((r) => r.tenantId === "tenant-A").forEach((r) => ids.add(r.id))
    }
  }
  return ids
}

async function trace(lotId: string, direction: "FORWARD" | "REVERSE" | "BOTH", tenant = "tenant-A") {
  return traceService.traceFromLots(asDb(), tenant, [lotId], direction)
}
const hasEdge = (t: any, from: string, to: string, rel: string) =>
  t.edges.some((e: any) => e.from === from && e.to === to && e.relationship === rel)
const nodeIds = (t: any) => t.nodes.map((n: any) => n.id)

async function main() {
  // ══════════════════════════════════════════════════════════════════════════
  section("QR-01..09 QR payload / 파서")
  {
    const payload = qr.encodeLotQr("CNS-20261014-001")
    eq(payload, "DAEWON|LOT|1|CNS-20261014-001", "QR-01a payload 형식 DAEWON|LOT|1|<lotNo>")
    const parsed = qr.parseLotQr(payload)
    ok(parsed.ok && parsed.lotNo === "CNS-20261014-001" && parsed.version === 1 && parsed.entity === "LOT", "QR-01 valid LOT payload parse")
    eq(qr.parseLotQr("EVIL|LOT|1|X").code, "WRONG_PREFIX", "QR-02 invalid prefix reject")
    eq(qr.parseLotQr("DAEWON|LOT|2|X").code, "UNSUPPORTED_VERSION", "QR-03 invalid version reject")
    eq(qr.parseLotQr("DAEWON|LOT|x|X").code, "MALFORMED", "QR-03b 비숫자 version reject")
    eq(
      ["", "   ", "DAEWON", "DAEWON|LOT|1", "DAEWON|LOT|1|a|b", "DAEWON|LOT|1|", "DAEWON|LOT|1|%E0%A4%A"].map((x) => qr.parseLotQr(x).ok),
      [false, false, false, false, false, false, false],
      "QR-04 malformed reject",
    )
    eq(qr.parseLotQr("DAEWON|LOT|1|" + "A".repeat(300)).code, "TOO_LONG", "QR-05 excessive length reject")
    eq(qr.parseLotQr("DAEWON|SHIPMENT|1|SH-1").code, "UNSUPPORTED_ENTITY", "QR-06 other entity reject")
    eq(qr.encodeLotQr("LOT-R1"), qr.encodeLotQr("  LOT-R1 "), "QR-07 same LOT encode deterministic (공백 정규화)")
    ok(/^DAEWON\|LOT\|1\|[A-Za-z0-9%._~!*'()-]+$/.test(qr.encodeLotQr("A/B 한글#1")), "QR-07b 특수문자/한글도 안전하게 인코딩")
    eq(qr.parseLotQr(qr.encodeLotQr("A/B 한글#1|x")).lotNo, "A/B 한글#1|x", "QR-07c 구분자 포함 LOT 번호 왕복")

    // QR-09: mutable 정보 비포함 — payload 는 lotNo 외 어떤 값도 담지 않는다.
    const lotRow = { lotNo: "LOT-R1", status: "ACTIVE", qty: 100, itemName: "원자재1", supplier: "공급사1" }
    const p = qr.encodeLotQr(lotRow.lotNo)
    ok(!p.includes("ACTIVE") && !p.includes("100") && !p.includes("원자재") && !p.includes("공급사"), "QR-09 mutable LOT data not embedded")
    eq(p.split("|").length, 4, "QR-09b payload 는 4 필드(prefix|entity|version|id)")

    // 분류기
    eq(qr.classifyScanInput(payload).kind, "LOT_QR", "QR-10 classify LOT_QR")
    eq(qr.classifyScanInput("LOT-R1").kind, "MANUAL_TEXT", "QR-10b classify 수동 LOT 번호")
    eq(qr.classifyScanInput("RM-1|cuid123").kind, "LEGACY_ITEM_LOT", "QR-10c classify 레거시 itemCode|lotId")
    eq(qr.classifyScanInput("DAEWON|LOT|9|X").kind, "INVALID", "QR-10d DAEWON 접두 + 잘못된 버전 → INVALID(레거시로 오인 금지)")
    eq(qr.classifyScanInput("a|b|c").kind, "INVALID", "QR-10e 알 수 없는 다중 구분자 → INVALID")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("POLICY LOT 정책 분류(순수 · DB 변경 없음)")
  {
    const base = { id: "i", code: "C", name: "N", status: "ACTIVE", isLotTracked: false, isBomParent: false, isBomComponent: false, hasSalesUsage: false, hasPurchaseUsage: false, hasInventory: false }
    const c = (o: Record<string, unknown>) => lotPolicy.classifyLotPolicy({ ...base, ...o })
    eq(c({ itemType: "RAW_MATERIAL", isBomComponent: true }).level, "REQUIRED", "POLICY-01 BOM 투입 RAW → REQUIRED")
    eq(c({ itemType: "RAW_MATERIAL", isBomComponent: true }).change, "ENABLE_PROPOSED", "POLICY-01b 현재 false → ENABLE_PROPOSED(제안일 뿐 적용 안 함)")
    eq(c({ itemType: "FINISHED", hasSalesUsage: true }).level, "REQUIRED", "POLICY-02 출하 FINISHED → REQUIRED")
    eq(c({ itemType: "FINISHED", isBomParent: true }).level, "REQUIRED", "POLICY-02b BOM 생산 FINISHED → REQUIRED")
    eq(c({ itemType: "SEMI_FINISHED", isBomParent: true, isBomComponent: true }).level, "REVIEW_REQUIRED", "POLICY-03 WIP 는 자동 지정하지 않고 REVIEW_REQUIRED")
    eq(c({ itemType: "CONSUMABLE" }).level, "NOT_REQUIRED", "POLICY-04 비생산/소모 → NOT_REQUIRED")
    eq(c({ itemType: "RAW_MATERIAL" }).level, "OPTIONAL", "POLICY-05 이력 없는 RAW → OPTIONAL")
    eq(c({ itemType: "RAW_MATERIAL", status: "INACTIVE" }).level, "NOT_REQUIRED", "POLICY-06 비활성 → NOT_REQUIRED")
    const sum = lotPolicy.summarizeLotPolicy([c({ itemType: "RAW_MATERIAL", isBomComponent: true }), c({ itemType: "CONSUMABLE" })])
    eq(sum.total, 2, "POLICY-07 요약 집계")
    // 정책 모듈은 DB 접근 코드가 없다.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require("node:fs").readFileSync(require("node:path").join(SRC, "lib/lot-policy/lot-policy.ts"), "utf8")
    ok(!/prisma|\$executeRaw|\.update\(|\.create\(|\.delete\(/.test(src), "POLICY-08 정책 분류기에 DB 쓰기/접근 코드 없음")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("SCAN-01..10 스캔 조회 보안 · 상태 · 중복")
  reset()
  loginAs(null)
  {
    const r = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"))
    ok(r.ok === false && r.code === "UNAUTHORIZED", "SCAN-01 unauthenticated lookup denied")
    const t = await traceActions.traceLot("LOT-R1", "FORWARD")
    ok(t.ok === false && t.code === "UNAUTHORIZED", "SCAN-01b unauthenticated trace denied")
    const p = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-R1"] })
    ok(p.ok === false, "SCAN-01c unauthenticated label audit denied")
    eq(fake.writes.length, 0, "SCAN-01d 비인증 요청 DB write 0")
  }

  loginAs("mgrA")
  fake.reads.length = 0
  {
    const ok1 = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"))
    ok(ok1.ok && ok1.lot.item.code === "RM-1" && ok1.lot.qtyAvailable === 50 && ok1.usable, "SCAN-09 정상 스캔 → 품목/LOT/가용수량/사용가능")
  }
  loginAs("opA")
  {
    const r = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"), { purpose: "MATERIAL_ISSUE", workOrderId: "wo-1" })
    ok(r.ok && r.usable, "SCAN-09b OPERATOR 허용 스캔(작업지시 BOM 구성품)")
  }
  loginAs("ownerB")
  {
    const cross = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-A-ONLY"))
    const missingLot = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-DOES-NOT-EXIST"))
    ok(cross.ok === false && cross.code === "NOT_FOUND", "SCAN-02 cross tenant denied")
    eq(cross.message, missingLot.message, "SCAN-02b 타 tenant LOT 와 없는 LOT 의 응답이 동일(존재 노출 없음)")
    ok(!JSON.stringify(cross).includes("tenant") && !JSON.stringify(cross).includes("원자재"), "SCAN-02c 응답에 타사 정보 없음")
    const sameNo = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"))
    ok(sameNo.ok && sameNo.lot.id === "lotB-R1", "SCAN-02d 같은 lotNo 라도 세션 tenant 의 LOT 만 해석")
    const traceCross = await traceActions.traceLot("LOT-A-ONLY", "BOTH")
    ok(traceCross.ok === false && traceCross.code === "NOT_FOUND", "SCAN-02e cross tenant trace denied")
    const shipCross = await traceActions.traceShipment("SH-1")
    ok(shipCross.ok === false, "SCAN-02f cross tenant shipment trace denied")
  }
  loginAs("mgrA")
  {
    for (const bad of ["", "garbage|||", "DAEWON|LOT|1|", "x".repeat(400)]) {
      const r = await qrActions.lookupLotByQr(bad)
      ok(r.ok === false, `SCAN-03 invalid QR denied (${JSON.stringify(bad.slice(0, 16))})`)
    }
    const none = await qrActions.lookupLotByQr(qr.encodeLotQr("NO-SUCH"))
    ok(none.ok === false && none.code === "NOT_FOUND", "SCAN-03b 없는 LOT NOT_FOUND")
    const legacy = await qrActions.lookupLotByQr("RM-1|lot-R1")
    ok(legacy.ok === false && legacy.code === "LEGACY_LABEL", "SCAN-03c 레거시 라벨은 LOT 확정에 사용하지 않음")

    const exp = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-EXP"), { purpose: "MATERIAL_ISSUE" })
    ok(exp.ok && !exp.usable && exp.blockCode === "STATUS_EXPIRED", "SCAN-04 만료(비사용) LOT 출고 차단")
    const hold = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-HOLD"), { purpose: "MATERIAL_ISSUE" })
    const quar = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-QUAR"), { purpose: "SHIPMENT" })
    ok(hold.ok && !hold.usable && hold.blockCode === "STATUS_ON_HOLD", "SCAN-05 ON_HOLD LOT 출고 차단")
    ok(quar.ok && !quar.usable && quar.blockCode === "STATUS_QUARANTINE", "SCAN-05b QUARANTINE LOT 출하 차단")
    const holdTrace = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-HOLD"), { purpose: "TRACE" })
    ok(holdTrace.ok && holdTrace.usable, "SCAN-05c 추적/조회 목적은 보류 LOT 도 조회 가능(식별)")
    const cons = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-CONS"), { purpose: "MATERIAL_ISSUE" })
    ok(cons.ok && !cons.usable && cons.blockCode === "STATUS_CONSUMED", "SCAN-06 소진 LOT 추가 출고 차단")
    const depleted = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R2"), { purpose: "MATERIAL_ISSUE" })
    ok(depleted.ok && !depleted.usable && depleted.blockCode === "NO_STOCK", "SCAN-06b 가용재고 0 LOT 차단")

    const wrong = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"), { purpose: "SHIPMENT", expectedItemId: "item-F1" })
    ok(wrong.ok && !wrong.usable && wrong.blockCode === "WRONG_ITEM", "SCAN-07 wrong item denied")
    const notBom = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-X"), { purpose: "MATERIAL_ISSUE", workOrderId: "wo-1" })
    ok(notBom.ok && !notBom.usable && notBom.blockCode === "NOT_BOM_COMPONENT", "SCAN-07b BOM 구성품 아님")
    const otherTenantWo = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"), { purpose: "MATERIAL_ISSUE", workOrderId: "woB-1" })
    ok(otherTenantWo.ok && !otherTenantWo.usable && otherTenantWo.blockCode === "WORK_ORDER_NOT_FOUND", "SCAN-07c 타 tenant 작업지시 컨텍스트 거부")
  }

  // SCAN-08 / SCAN-10: 스캔은 mutation 이 아니다 · 중복 스캔
  reset()
  loginAs("opA")
  {
    for (let i = 0; i < 5; i += 1) await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"), { purpose: "MATERIAL_ISSUE", workOrderId: "wo-1" })
    eq(fake.writes.length, 0, "SCAN-08 같은 QR 5회 연속 스캔 → DB write 0 (중복 mutation 없음)")
    const deb = guard.createScanDebouncer(2000)
    const accepted = [0, 100, 200, 1900, 2100].map((t) => deb.accept("DAEWON|LOT|1|LOT-R1", t))
    eq(accepted, [true, false, false, false, true], "SCAN-08b 연속 인식 디바운스(2초)")
    deb.begin()
    eq(deb.accept("DAEWON|LOT|1|OTHER", 9999), false, "SCAN-08c 처리 중 재스캔 무시")
    deb.end()
    eq(deb.accept("DAEWON|LOT|1|OTHER", 10000), true, "SCAN-08d 처리 완료 후 다른 QR 허용")
    const cand = [{ key: "item-R1", options: [{ lotId: "lot-R1", lotNo: "LOT-R1", warehouseId: "wh-A", qtyAvailable: 50 }], selectedLotIds: [] as string[] }]
    const first = apply.planLotScanSelection("LOT-R1", cand)
    eq(first.kind, "SELECT", "SCAN-08e 첫 스캔은 선택")
    cand[0].selectedLotIds.push("lot-R1")
    eq(apply.planLotScanSelection("LOT-R1", cand).kind, "ALREADY_SELECTED", "SCAN-08f 이미 선택된 LOT 재스캔은 중복 추가 안 함")
    eq(apply.planLotScanSelection("LOT-NOPE", cand).kind, "NOT_IN_OPTIONS", "SCAN-08g 후보에 없는 LOT")
  }
  loginAs("viewerA")
  {
    const before = fake.writes.length
    let refused = false
    try {
      const r = await issueActions.issueMaterialsForWorkOrder(
        { workOrderId: "wo-1", siteId: "site-A", items: [{ itemId: "item-R1", issueQty: 1, lots: [{ lotId: "lot-R1", warehouseId: "wh-A", quantity: 1 }] }] },
        "tenant-A",
      )
      refused = r?.ok === false
    } catch {
      refused = true
    }
    ok(refused, "SCAN-10 권한 없는 사용자는 스캔 후에도 자재출고 mutation 불가")
    eq(fake.writes.filter((w) => w.model !== "auditLog").length, before, "SCAN-10b 거부된 mutation DB write 0")
  }

  section("POP-01..04 POP 스캔 적합성 확인(식별만)")
  reset()
  loginAs(null)
  {
    const r = await qrActions.lookupLotForPop(qr.encodeLotQr("LOT-R1"), "op-1a")
    ok(r.ok === false && r.code === "UNAUTHORIZED", "POP-01 비인증 POP 조회 거부")
  }
  loginAs("opA")
  {
    const r = await qrActions.lookupLotForPop(qr.encodeLotQr("LOT-R1"), "op-1a")
    ok(r.ok && r.usable, "POP-02 작업 BOM 구성품 LOT 는 적합")
    const wrong = await qrActions.lookupLotForPop(qr.encodeLotQr("LOT-X"), "op-1a")
    ok(wrong.ok && !wrong.usable && wrong.blockCode === "NOT_BOM_COMPONENT", "POP-03 BOM 구성품이 아닌 LOT 는 부적합")
    const before = fake.writes.length
    await qrActions.lookupLotForPop(qr.encodeLotQr("LOT-R1"), "op-1a")
    eq(fake.writes.length, before, "POP-03b POP 스캔은 DB write 0 (투입 mutation 없음)")
  }
  loginAs("ownerB")
  {
    const r = await qrActions.lookupLotForPop(qr.encodeLotQr("LOT-R1"), "op-1a")
    ok(r.ok === false && r.code === "NOT_FOUND", "POP-04 타 tenant 작업(공정) 컨텍스트 거부")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("TRACE-R01..08 원자재 계보")
  reset()
  {
    const t = await trace("lot-R1", "FORWARD")
    ok(t && hasEdge(t, "PURCHASE_ORDER:po-1", "LOT:lot-R1", "RECEIVED_AS"), "TRACE-R01 Receiving → Raw LOT 연결(PO)")
    const recv = t.edges.find((e: any) => e.from === "PURCHASE_ORDER:po-1" && e.to === "LOT:lot-R1")
    eq(recv.qty, 100, "TRACE-R01b 입고수량 100")
    ok(hasEdge(t, "SUPPLIER:sup-1", "PURCHASE_ORDER:po-1", "SUPPLIES"), "TRACE-R01c PO → 공급사 연결")
    loginAs("mgrA")
    const look = await qrActions.lookupLotByQr(qr.encodeLotQr("LOT-R1"))
    ok(look.ok && look.lot.qtyOnHand === 50 && look.lot.balances.length === 1, "TRACE-R02 Raw LOT → Inventory 연결")
    ok(hasEdge(t, "LOT:lot-R1", "WORK_ORDER:wo-1", "CONSUMED_BY") && hasEdge(t, "LOT:lot-R1", "WORK_ORDER:wo-2", "CONSUMED_BY"), "TRACE-R03 Raw LOT → Material Issue → WorkOrder")
    ok(nodeIds(t).includes("WORK_ORDER:wo-1"), "TRACE-R04 Material Issue → WorkOrder 노드")
    const consumed = t.edges.filter((e: any) => e.from === "LOT:lot-R1" && e.relationship === "CONSUMED_BY")
    eq(consumed.map((e: any) => e.to).sort(), ["WORK_ORDER:wo-1", "WORK_ORDER:wo-2"], "TRACE-R05 한 Raw LOT → 여러 WorkOrder")
    const rev = await trace("lot-F1", "REVERSE")
    eq(
      rev.lots.filter((l: any) => l.role === "RAW").map((l: any) => l.lotNo).sort(),
      ["LOT-R1", "LOT-R2", "LOT-R3"],
      "TRACE-R06 한 WorkOrder → 여러 Raw LOT",
    )
    const issued = consumed.reduce((s: number, e: any) => s + e.qty, 0)
    eq(issued, 50, "TRACE-R07 부분 소진: R1 투입 합계 30+20")
    eq(100 - issued, 50, "TRACE-R07b 입고 100 − 투입 50 = 현재고 50 (LOT 잔량 일치)")
    const bal = fake.tables.inventoryBalance.find((b) => b.lotId === "lot-R1")
    eq(Number(bal?.qtyOnHand), 100 - issued, "TRACE-R08 LOT 잔량 = 입고 − 투입(보존 법칙)")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("TRACE-F01..08 완제품 계보")
  {
    const t = await trace("lot-F1", "REVERSE")
    ok(hasEdge(t, "WORK_ORDER:wo-1", "LOT:lot-F1", "PRODUCED"), "TRACE-F01/F02 WorkOrder → Finished Receipt → Finished LOT")
    eq(t.edges.find((e: any) => e.from === "WORK_ORDER:wo-1" && e.to === "LOT:lot-F1").qty, 10, "TRACE-F02b 완제품입고 수량")
    ok(nodeIds(t).includes("WORK_ORDER:wo-1"), "TRACE-F03 Finished LOT → WorkOrder")
    ok(["LOT:lot-R1", "LOT:lot-R2", "LOT:lot-R3"].every((id) => nodeIds(t).includes(id)), "TRACE-F04 Finished LOT → 사용 Raw LOT")
    const fwd = await trace("lot-R2", "FORWARD")
    ok(hasEdge(fwd, "WORK_ORDER:wo-1", "LOT:lot-F1", "PRODUCED") && hasEdge(fwd, "WORK_ORDER:wo-1", "LOT:lot-F2", "PRODUCED"), "TRACE-F05 한 WorkOrder 에서 복수 Finished LOT")
    const f1Shipped = fwd.edges.filter((e: any) => e.from === "LOT:lot-F1" && e.relationship === "SHIPPED_IN")
    eq(f1Shipped.map((e: any) => e.qty).sort(), [4, 6], "TRACE-F06 Finished LOT 부분 출하(4 + 6)")
    eq(f1Shipped.reduce((s: number, e: any) => s + e.qty, 0) <= 10, true, "TRACE-F06b 출하 합계 ≤ 입고수량")
    const sh1In = fwd.edges.filter((e: any) => e.to === "SHIPMENT:sh-1" && e.relationship === "SHIPPED_IN").map((e: any) => e.from).sort()
    eq(sh1In, ["LOT:lot-F1", "LOT:lot-F2"], "TRACE-F07 여러 Finished LOT → 한 Shipment")
    eq(f1Shipped.map((e: any) => e.to).sort(), ["SHIPMENT:sh-1", "SHIPMENT:sh-2"], "TRACE-F08 한 Finished LOT → 여러 Shipment")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("TRACE-01..08 정/역방향 · 부분출하 · 불량 · 검사표준 없음 · 데이터 없음")
  loginAs("mgrA")
  {
    const fwd = await traceActions.traceRawLot("LOT-R1")
    ok(fwd.ok, "TRACE-01a traceRawLot ok")
    const t = fwd.trace
    const chain =
      hasEdge(t, "SUPPLIER:sup-1", "PURCHASE_ORDER:po-1", "SUPPLIES") &&
      hasEdge(t, "PURCHASE_ORDER:po-1", "LOT:lot-R1", "RECEIVED_AS") &&
      hasEdge(t, "LOT:lot-R1", "WORK_ORDER:wo-1", "CONSUMED_BY") &&
      hasEdge(t, "WORK_ORDER:wo-1", "LOT:lot-F1", "PRODUCED") &&
      hasEdge(t, "LOT:lot-F1", "SHIPMENT:sh-1", "SHIPPED_IN") &&
      hasEdge(t, "SHIPMENT:sh-1", "CUSTOMER:cus-1", "DELIVERED_TO")
    ok(chain, "TRACE-01 RAW LOT → Supplier → WO → Finished LOT → Shipment → Customer = FULL")
    ok(hasEdge(t, "SHIPMENT:sh-2", "CUSTOMER:cus-2", "DELIVERED_TO"), "TRACE-01b 부분출하된 다른 고객까지 연결")
    ok(t.workOrders.some((w: any) => w.operations.some((o: any) => o.equipment.some((e: any) => e.code === "EQ-1"))), "TRACE-01c 설비 연결")
    ok(t.workOrders.some((w: any) => w.operations.some((o: any) => o.results.some((r: any) => r.operator?.name === "작업자김"))), "TRACE-01d 작업자 연결")
    ok(t.workOrders.some((w: any) => w.operations.some((o: any) => o.inspections.some((i: any) => i.result === "PASS" && i.attribution === "LOT"))), "TRACE-01e 품질검사(LOT 귀속) 연결")

    const ship = await traceActions.traceShipment("SH-1")
    ok(ship.ok, "TRACE-02a traceShipment ok")
    const s = ship.trace
    const rev =
      hasEdge(s, "SHIPMENT:sh-1", "CUSTOMER:cus-1", "DELIVERED_TO") &&
      hasEdge(s, "LOT:lot-F1", "SHIPMENT:sh-1", "SHIPPED_IN") &&
      hasEdge(s, "WORK_ORDER:wo-1", "LOT:lot-F1", "PRODUCED") &&
      hasEdge(s, "LOT:lot-R1", "WORK_ORDER:wo-1", "CONSUMED_BY") &&
      hasEdge(s, "PURCHASE_ORDER:po-1", "LOT:lot-R1", "RECEIVED_AS") &&
      hasEdge(s, "SUPPLIER:sup-1", "PURCHASE_ORDER:po-1", "SUPPLIES") &&
      hasEdge(s, "SUPPLIER:sup-2", "PURCHASE_ORDER:po-2", "SUPPLIES")
    ok(rev, "TRACE-02 Customer Shipment → Finished LOT → WO → Raw LOT → Supplier = FULL")

    const fin = await traceActions.traceFinishedLot("LOT-F1")
    ok(fin.ok && fin.trace.lots.filter((l: any) => l.role === "RAW").length === 3, "TRACE-03 RAW LOT 여러 개 → Finished LOT 하나")
    const raw1 = await traceActions.traceRawLot("LOT-R1")
    eq(raw1.trace.lots.filter((l: any) => l.role === "FINISHED").map((l: any) => l.lotNo).sort(), ["LOT-F1", "LOT-F2", "LOT-F3"], "TRACE-04 RAW LOT 하나 → Finished LOT 여러 개")
    ok(hasEdge(raw1.trace, "LOT:lot-F1", "SHIPMENT:sh-1", "SHIPPED_IN") && hasEdge(raw1.trace, "LOT:lot-F1", "SHIPMENT:sh-2", "SHIPPED_IN"), "TRACE-05 부분출하(동일 LOT 가 두 출하에)")
    const defectWo = t.workOrders.find((w: any) => w.orderNo === "WO-1")
    ok(defectWo.operations.some((o: any) => o.results.some((r: any) => r.defectQty === 2)), "TRACE-06 불량이 포함된 WorkOrder 실적 표시")
    const wo2 = raw1.trace.workOrders.find((w: any) => w.orderNo === "WO-2")
    ok(wo2 && wo2.operations.length === 0, "TRACE-08 공정/설비 없는 작업지시도 Trace 유지")
    ok(raw1.trace.missing.some((m: any) => m.code === "ROUTING" && m.ref === "WO-2"), "TRACE-08b 공정 이력 없음이 known missing 으로 표현")
  }
  // TRACE-07 InspectionSpec 없는 실적: 검사 이력 없이도 실적/Trace 가 깨지지 않고 롤백 없이 known missing
  reset((t) => {
    t.qualityInspection = []
  })
  loginAs("mgrA")
  {
    const r = await traceActions.traceFinishedLot("LOT-F1")
    ok(r.ok, "TRACE-07 InspectionSpec 없는 실적 — Trace 성공")
    ok(r.trace.missing.some((m: any) => m.code === "INSPECTION" && m.ref === "WO-1"), "TRACE-07b 검사 이력 없음은 known missing(오류 아님)")
    ok(r.trace.workOrders.find((w: any) => w.orderNo === "WO-1").operations.some((o: any) => o.results.length > 0), "TRACE-07c 생산실적은 그대로 표시")
  }
  // 공급사 없는 원자재 LOT / 설비·작업자 없는 경우
  reset()
  loginAs("mgrA")
  {
    const r = await traceActions.traceRawLot("LOT-R9")
    ok(r.ok && r.trace.missing.some((m: any) => m.code === "SUPPLIER" && m.ref === "LOT-R9"), "TRACE-08c 입고 이력 없는 원자재 LOT → 공급사 known missing")
    const noEquip = await traceActions.traceFinishedLot("LOT-F3")
    ok(noEquip.ok && noEquip.trace.missing.some((m: any) => m.code === "ROUTING"), "TRACE-08d 설비/공정 마스터 없음 표현(MASTER_DATA_REQUIRED)")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("PROP 속성 테스트")
  reset()
  {
    const starts = ["lot-R1", "lot-R2", "lot-F1", "lot-F2", "lot-F3", "lot-R9"]
    const A = tenantAIds()
    let tenantLeak = 0
    let danglingEdge = 0
    for (const s of starts) {
      for (const dir of ["FORWARD", "REVERSE", "BOTH"] as const) {
        const t = await trace(s, dir)
        const ids = new Set(nodeIds(t))
        for (const n of t.nodes) {
          if (!A.has(n.refId)) tenantLeak += 1
        }
        for (const e of t.edges) if (!ids.has(e.from) || !ids.has(e.to)) danglingEdge += 1
      }
    }
    eq(tenantLeak, 0, "PROP-01 다른 tenant node 가 trace 에 포함되지 않는다(같은 lotNo/교차 genealogy 포함)")
    eq(danglingEdge, 0, "PROP-02 모든 edge 의 양끝 node 가 존재한다")
    const a = JSON.stringify(await trace("lot-R1", "BOTH"))
    const b = JSON.stringify(await trace("lot-R1", "BOTH"))
    eq(a, b, "PROP-03 같은 입력 → 같은 trace 결과(결정적)")
  }
  // cycle: R1 ↔ F1 genealogy 순환이 있어도 종료
  reset((t) => {
    t.lotGenealogy.push(
      { id: "gen-c1", parentLotId: "lot-F1", childLotId: "lot-R1", relationType: "INPUT", qty: 1 },
      { id: "gen-c2", parentLotId: "lot-R1", childLotId: "lot-F1", relationType: "INPUT", qty: 1 },
    )
  })
  {
    const t0 = Date.now()
    const t = await trace("lot-R1", "BOTH")
    ok(t && Date.now() - t0 < 2000, "PROP-04 genealogy cycle 에도 무한루프 없이 종료")
    eq(new Set(nodeIds(t)).size, nodeIds(t).length, "PROP-04b 중복 node 없음")
  }
  reset()
  {
    const t = await trace("lot-R1", "BOTH")
    const sumFromEdges = t.edges.filter((e: any) => e.from === "LOT:lot-R1" && e.relationship === "CONSUMED_BY").reduce((s: number, e: any) => s + e.qty, 0)
    const sumFromRows = fake.tables.workOrderMaterialLot.filter((m) => m.tenantId === "tenant-A" && m.materialLotNo === "LOT-R1").reduce((s, m) => s + m.qty, 0)
    eq(sumFromEdges, sumFromRows, "PROP-05 MaterialIssue 중복이 없으면 raw 수량도 중복 집계되지 않는다(BOTH 방향 중복 경로에서도)")

    const snap = JSON.stringify([fake.tables.finishedGoodsReceipt, fake.tables.shipmentItem, fake.tables.workOrderMaterialLot, fake.tables.lotGenealogy, fake.tables.inventoryBalance])
    fake.writes.length = 0
    await trace("lot-F1", "BOTH")
    eq(fake.writes.length, 0, "PROP-06 추적은 DB write 0")
    eq(JSON.stringify([fake.tables.finishedGoodsReceipt, fake.tables.shipmentItem, fake.tables.workOrderMaterialLot, fake.tables.lotGenealogy, fake.tables.inventoryBalance]), snap, "PROP-06b 출하/추적이 생산수량·계보를 바꾸지 않는다")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("QR-08 / Reprint 감사 · 계보 불변")
  reset()
  loginAs("mgrA")
  {
    const lotsBefore = fake.tables.lot.length
    const genBefore = JSON.stringify([fake.tables.workOrderMaterialLot, fake.tables.finishedGoodsReceipt, fake.tables.lotGenealogy])
    const first = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-R1"] })
    const second = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-R1"], reason: "라벨 훼손" })
    ok(first.ok && first.results[0].event === "LABEL_PRINT" && first.results[0].printCount === 1, "REPRINT-01 최초 출력은 LABEL_PRINT")
    ok(second.ok && second.results[0].event === "LABEL_REPRINT" && second.results[0].printCount === 2, "REPRINT-02 재출력은 서버가 LABEL_REPRINT 로 판정(횟수 2)")
    eq(first.results[0].qrPayload, second.results[0].qrPayload, "QR-08 reprint same QR (payload 동일)")
    eq(fake.tables.lot.length, lotsBefore, "QR-08b 재출력은 새 LOT 을 만들지 않는다")
    eq(JSON.stringify([fake.tables.workOrderMaterialLot, fake.tables.finishedGoodsReceipt, fake.tables.lotGenealogy]), genBefore, "PROP-07 reprint 는 genealogy 를 변경하지 않는다")
    const audits = fake.tables.auditLog.filter((a) => a.entityType === "LotLabel")
    eq(audits.length, 2, "REPRINT-03 감사 로그 2건(최초+재출력)")
    ok(audits[1].afterData.event === "LABEL_REPRINT" && audits[1].afterData.reason === "라벨 훼손" && audits[1].actorId === "p-mgr-A", "REPRINT-04 감사: actor/사유/event")
    const auditsBefore = fake.tables.auditLog.length
    const other = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-A-ONLY", "NO-SUCH"] })
    ok(other.ok === false && other.code === "LOT_NOT_PERSISTED" && other.missingLotNos.includes("NO-SUCH"), "REPRINT-05 존재하지 않는 LOT 가 섞이면 전부 거부")
    eq(fake.tables.auditLog.length, auditsBefore, "REPRINT-05b 거부 시 감사 기록도 남기지 않음(all-or-nothing)")
  }
  loginAs("ownerB")
  {
    const r = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-A-ONLY"] })
    ok(r.ok === false && r.code === "LOT_NOT_PERSISTED", "REPRINT-06 타 tenant LOT 라벨 출력/감사 불가")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("LABEL-01..04 입고 라벨 출력 persistence 게이트")
  reset()
  loginAs("ownerA")
  {
    // LABEL-01: Lot 생성 실패(입고 트랜잭션 실패) → 실제 print action 불가
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const receiving = require("../src/lib/actions/receiving.actions")
    const lotsBefore = fake.tables.lot.length
    const failed = await receiving.createReceivingInspection({
      purchaseOrderItemId: "poi-none",
      purchaseOrderId: "po-1",
      warehouseId: "wh-missing",
      siteId: "site-A",
      receivedQty: 5,
      acceptedQty: 5,
      rejectedQty: 0,
      result: "PASS",
      lotNo: "LOT-NEW-001",
    })
    ok(failed.success === false && !failed.lotNo, "LABEL-01a 입고 실패 응답에는 확정 lotNo 가 없다")
    eq(fake.tables.lot.length, lotsBefore, "LABEL-01b 입고 실패 시 Lot 행 미생성")
    const auditsBefore = fake.tables.auditLog.length
    const blocked = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-NEW-001"] })
    ok(blocked.ok === false && blocked.code === "LOT_NOT_PERSISTED", "LABEL-01 Lot 생성 실패 → 실제 print action 불가")
    eq(fake.tables.auditLog.length, auditsBefore, "LABEL-01c 차단된 출력은 감사 기록 없음")
  }
  {
    // LABEL-02: Lot 생성 성공 → print 가능
    fake.tables.lot.push({ id: "lot-NEW", tenantId: "tenant-A", itemId: "item-R1", lotNo: "LOT-NEW-001", status: "ACTIVE", createdAt: new Date() })
    const printed = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-NEW-001"] })
    ok(printed.ok && printed.results[0].event === "LABEL_PRINT" && printed.results[0].qrPayload === "DAEWON|LOT|1|LOT-NEW-001", "LABEL-02 Lot 영속화 후 print 가능(QR=lotNo 유지)")
    // LABEL-03: reprint → 동일 QR
    const again = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-NEW-001"], reason: "훼손" })
    ok(again.ok && again.results[0].event === "LABEL_REPRINT" && again.results[0].qrPayload === printed.results[0].qrPayload, "LABEL-03 reprint → 동일 QR")
    eq(fake.tables.lot.filter((l) => l.lotNo === "LOT-NEW-001").length, 1, "LABEL-03b 재출력은 LOT 을 중복 생성하지 않음")
  }
  {
    // LABEL-04: 취소/존재하지 않는 LOT → print/reprint 차단
    const cancelled = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-CANCELLED-RECEIPT"] })
    ok(cancelled.ok === false && cancelled.code === "LOT_NOT_PERSISTED", "LABEL-04 취소된 입고(Lot 없음) print 차단")
    const mixed = await qrActions.recordLotLabelPrint({ lotNos: ["LOT-NEW-001", "LOT-CANCELLED-RECEIPT"], reason: "x" })
    ok(mixed.ok === false, "LABEL-04b reprint 에도 미존재 LOT 가 섞이면 차단")
  }
  {
    // UI 1차 게이트(소스 검사): 입고 확정 전에는 미리보기만, 확정 후 서버가 돌려준 lotNo 로만 출력
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsx = require("node:fs")
    const dlg = fsx.readFileSync(join(SRC, "app/app/mes/material-receipt/receiving-form-dialog.tsx"), "utf8")
    ok(/printBlockedReason=/.test(dlg) && /confirmedLabels/.test(dlg), "LABEL-05 입고 화면: 확정 전 print 차단 + 확정 후 라벨 목록 사용")
    ok(!/markLotReservationPrinted/.test(dlg) && !/onBeforePrint/.test(dlg), "LABEL-05b 입고 확정 전 예약 번호를 '출력됨'으로 소모하지 않는다")
    const recv = fsx.readFileSync(join(SRC, "lib/actions/receiving.actions.ts"), "utf8")
    ok(/lot\.findFirst\(\{ where: \{ tenantId, lotNo: committed\.lotNo \}/.test(recv), "LABEL-05c 서버는 Lot 행 영속화를 DB 에서 재확인한 lotNo 만 반환")
  }

  // ══════════════════════════════════════════════════════════════════════════
  section("PERF 쿼리 수 / 실행시간 (N+1 없음)")
  function bulkFixture(n: number) {
    const t = seedTables()
    t.lot = t.lot.filter((l) => l.tenantId === "tenant-B")
    t.workOrderMaterialLot = []
    t.finishedGoodsReceipt = []
    t.shipmentItem = []
    t.shipmentOrder = []
    t.inventoryTransaction = []
    t.purchaseOrder = [{ id: "po-1", tenantId: "tenant-A", orderNo: "PO-1", supplierId: "sup-1", status: "RECEIVED", orderDate: D("2026-08-20T00:00:00Z") }]
    t.workOrder = []
    t.workOrderOperation = []
    t.productionResult = []
    t.qualityInspection = []
    t.lotGenealogy = []
    for (let i = 0; i < n; i += 1) {
      t.lot.push({ id: `rl-${i}`, tenantId: "tenant-A", itemId: "item-R1", lotNo: `RAW-${i}`, status: "ACTIVE", createdAt: D("2026-09-01T00:00:00Z") })
      t.inventoryTransaction.push({ id: `rx-${i}`, tenantId: "tenant-A", itemId: "item-R1", lotId: `rl-${i}`, txNo: `RX-${i}`, txType: "RECEIPT", qty: 100, refType: "PURCHASE_ORDER", refId: "po-1", txAt: D("2026-09-01T00:00:00Z") })
    }
    for (let i = 0; i < n; i += 1) {
      t.workOrder.push({ id: `bw-${i}`, tenantId: "tenant-A", orderNo: `BW-${i}`, manufacturingNo: `BM-${i}`, itemId: "item-F1", plannedQty: 10, status: "COMPLETED", productionPlanItemId: null, createdAt: D("2026-09-04T00:00:00Z") })
      t.lot.push({ id: `fl-${i}`, tenantId: "tenant-A", itemId: "item-F1", lotNo: `FIN-${i}`, status: "ACTIVE", createdAt: D("2026-09-10T00:00:00Z") })
      t.finishedGoodsReceipt.push({ id: `bf-${i}`, tenantId: "tenant-A", workOrderId: `bw-${i}`, itemId: "item-F1", lotId: `fl-${i}`, receiptQty: 10, receiptAt: D("2026-09-10T00:00:00Z") })
      t.workOrderOperation.push({ id: `bo-${i}`, workOrderId: `bw-${i}`, routingOperationId: "rop-1", equipmentId: "eq-1", seq: 1, status: "COMPLETED", completedQty: 10 })
      t.productionResult.push({ id: `bp-${i}`, workOrderOperationId: `bo-${i}`, goodQty: 10, defectQty: 0, reworkQty: 0, operatorId: "p-worker-1" })
      t.shipmentOrder.push({ id: `bs-${i}`, tenantId: "tenant-A", shipmentNo: `BSH-${i}`, salesOrderId: "so-1", status: "SHIPPED", plannedDate: D("2026-09-15T00:00:00Z"), shippedDate: D("2026-09-15T00:00:00Z") })
      t.shipmentItem.push({ id: `bsi-${i}`, shipmentOrderId: `bs-${i}`, salesOrderItemId: "soi-1", itemId: "item-F1", lotId: `fl-${i}`, qty: 10 })
      for (let k = 0; k < 5; k += 1) {
        const raw = (i + k) % n
        t.workOrderMaterialLot.push({ id: `bm-${i}-${k}`, tenantId: "tenant-A", workOrderId: `bw-${i}`, materialItemId: "item-R1", materialLotNo: `RAW-${raw}`, qty: 2, inventoryTransactionId: null, issuedAt: D("2026-09-05T00:00:00Z") })
      }
    }
    return t
  }
  const counts: Record<string, number> = {}
  for (const n of [10, 100]) {
    fake = makeFake(bulkFixture(n))
    fake.reads.length = 0
    const startIds = Array.from({ length: n }, (_v, i) => `fl-${i}`)
    const t0 = Date.now()
    const result = await traceService.traceFromLots(asDb(), "tenant-A", startIds, "REVERSE")
    const ms = Date.now() - t0
    counts[String(n)] = fake.reads.length
    console.log(`  PERF fixture N=${n}: lots=${result.lots.length} workOrders=${result.workOrders.length} issues=${n * 5} shipments=${result.nodes.filter((x: any) => x.type === "SHIPMENT").length} queries=${fake.reads.length} time=${ms}ms`)
    ok(result.workOrders.length === n && result.lots.filter((l: any) => l.role === "RAW").length === n, `PERF-01 N=${n} 전체 계보 조회 정확성`)
  }
  eq(counts["10"], counts["100"], "PERF-02 쿼리 수가 데이터 규모(N)와 무관 — N+1 없음")
  ok(counts["100"] <= 40, `PERF-03 쿼리 수 상한(≤40) — 실제 ${counts["100"]}`)

  console.log(`\nPhase 11 LOT/QR 회귀 테스트: ${passed} assertions PASS`)
}

main().catch((e) => {
  console.error("\nFAIL", e)
  process.exit(1)
})
