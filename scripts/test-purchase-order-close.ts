/**
 * Phase 5B — 구매발주 미입고 잔량 종결 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:purchase-order-close
 *
 *  C1 PARTIAL_RECEIVED 100/80 종결 → CLOSED, 수량 보존     C2 ORDERED 100/0 종결 정책
 *  C3 RECEIVED 종결 거부     C4 CANCELLED/DRAFT 거부(+CLOSED 재실행 안내)
 *  C5 타 tenant 발주 → 실패, write 0      C6 권한 없음 → DB 접근 0      C7 감사로그
 *  + 외주발주 거부, 잔량 0 거부, 동시 변경(CONFLICT), 잠금 후 재조회, 감사 실패 롤백, 사유 길이, 입고 가드(정적)
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  closePurchaseOrderRemainder,
  MAX_CLOSE_REASON_LENGTH,
  PURCHASE_ORDER_CLOSE_MESSAGES,
  type PurchaseOrderCloseDb,
} from "../src/lib/services/purchase-order-close.service"

let passed = 0
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}
function section(t: string) {
  console.log("\n── " + t)
}

type Row = Record<string, any>

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond !== null && typeof cond === "object" && "in" in (cond as object)) return (cond as any).in.includes(row[k])
    return row[k] === cond
  })
}

function makeDb(pos: Row[]) {
  const tables: { purchaseOrder: Row[]; auditLog: Row[] } = {
    purchaseOrder: pos.map((p) => ({ ...p, items: p.items.map((i: Row) => ({ ...i })) })) as Row[],
    auditLog: [],
  }
  const reads: string[] = []
  const writes: Array<{ model: string; op: string; data?: Row; where?: Row }> = []
  const failNext = { audit: false, updateCount0: false }
  let hook: (() => void) | null = null
  const model = {
    findFirst: async (a: { where: Row }) => {
      reads.push("purchaseOrder.findFirst")
      const r = tables.purchaseOrder.find((p) => matches(p, a.where))
      return r ? JSON.parse(JSON.stringify(r)) : null
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      writes.push({ model: "purchaseOrder", op: "updateMany", data: a.data, where: a.where })
      if (failNext.updateCount0) return { count: 0 }
      const targets = tables.purchaseOrder.filter((p) => matches(p, a.where))
      targets.forEach((t) => Object.assign(t, a.data))
      return { count: targets.length }
    },
  }
  const audit = {
    create: async (a: { data: Row }) => {
      writes.push({ model: "auditLog", op: "create", data: a.data })
      if (failNext.audit) throw new Error("audit failure")
      tables.auditLog.push(a.data)
      return a.data
    },
  }
  const db: any = {
    purchaseOrder: model,
    auditLog: audit,
    $transaction: async (cb: (tx: any) => Promise<unknown>) => {
      const snapshot = JSON.parse(JSON.stringify(tables.purchaseOrder))
      try {
        return await cb(db)
      } catch (e) {
        tables.purchaseOrder = snapshot
        throw e
      }
    },
  }
  return { db: db as PurchaseOrderCloseDb, tables, reads, writes, failNext, setHook: (h: () => void) => (hook = h), runHook: () => hook?.() }
}

const T = "tenant-1"
const actor = { id: "u1", name: "담당자", tenantId: T }
const authorize = async () => actor
function po(id: string, over: Partial<{ status: string; tenantId: string; orderNo: string; note: string | null; items: Row[] }> = {}) {
  return {
    id,
    tenantId: over.tenantId ?? T,
    orderNo: over.orderNo ?? "PO-" + id,
    status: over.status ?? "PARTIAL_RECEIVED",
    note: over.note ?? null,
    items: over.items ?? [
      { id: "i-" + id, itemId: "R1", qty: 100, receivedQty: 80, workOrderOperationId: null, item: { code: "R1" } },
    ],
  }
}

async function main() {
  section("C1 PARTIAL_RECEIVED 100/80 → CLOSED, 수량은 보존")
  {
    const f = makeDb([po("a")])
    const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "a", "공급사 납품 불가")
    ok(r.success, "C1 성공")
    if (r.success) {
      eq([r.data.orderedQty, r.data.receivedQty, r.data.remainingQty, r.data.previousStatus], [100, 80, 20, "PARTIAL_RECEIVED"], "C1 요약: 주문 100 / 입고 80 / 종결 잔량 20")
    }
    const row = f.tables.purchaseOrder[0]
    eq(row.status, "CLOSED", "C1 status CLOSED")
    eq([row.items[0].qty, row.items[0].receivedQty], [100, 80], "C1 발주수량/입고수량 그대로 보존(100/80)")
    eq(row.note, null, "C1 발주 note 는 변경하지 않음(외주 표식 오염 방지)")
    eq(f.writes.map((w) => w.model + "." + w.op), ["purchaseOrder.updateMany", "auditLog.create"], "C1 쓰기는 상태 변경 + 감사로그뿐")
    eq((f.writes[0].data as Row), { status: "CLOSED" }, "C1 갱신 데이터는 status 만")
    ok(!JSON.stringify(f.writes[0]).includes("receivedQty"), "C1 수량 필드를 건드리지 않음")
  }

  section("C2 ORDERED 100/0 종결 (미입고 100 종결 허용)")
  {
    const f = makeDb([po("b", { status: "ORDERED", items: [{ id: "i-b", itemId: "R1", qty: 100, receivedQty: 0, workOrderOperationId: null, item: { code: "R1" } }] })])
    const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "b")
    ok(r.success && r.data.remainingQty === 100, "C2 ORDERED 종결: 잔량 100")
    eq(f.tables.purchaseOrder[0].status, "CLOSED", "C2 CLOSED")
  }

  section("C3 RECEIVED / 잔량 0 → 거부")
  {
    const f = makeDb([po("c", { status: "RECEIVED", items: [{ id: "i-c", itemId: "R1", qty: 100, receivedQty: 100, workOrderOperationId: null, item: { code: "R1" } }] })])
    const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "c")
    ok(!r.success && r.code === "INVALID_STATUS", "C3 RECEIVED 거부")
    eq([f.writes.length, f.tables.purchaseOrder[0].status], [0, "RECEIVED"], "C3 write 0, 상태 불변")
    // 상태는 ORDERED 인데 잔량이 없는 이상 데이터
    const g = makeDb([po("c2", { status: "ORDERED", items: [{ id: "i", itemId: "R1", qty: 10, receivedQty: 10, workOrderOperationId: null, item: { code: "R1" } }] })])
    const r2 = await closePurchaseOrderRemainder({ authorize, db: g.db }, "c2")
    ok(!r2.success && r2.code === "NOTHING_TO_CLOSE" && g.writes.length === 0, "C3 잔량 0 → NOTHING_TO_CLOSE, write 0")
    // 입고 > 발주 이상 데이터는 음수 잔량을 만들지 않고 종결 대상도 아님
    const h = makeDb([po("c3", { items: [{ id: "i", itemId: "R1", qty: 10, receivedQty: 15, workOrderOperationId: null, item: { code: "R1" } }] })])
    const r3 = await closePurchaseOrderRemainder({ authorize, db: h.db }, "c3")
    ok(!r3.success && r3.code === "NOTHING_TO_CLOSE", "C3 입고 > 발주: 잔량 0 으로 처리(음수 잔량 없음)")
  }

  section("C4 CANCELLED / DRAFT 거부, CLOSED 재실행은 안내")
  {
    for (const [status, code] of [["CANCELLED", "INVALID_STATUS"], ["DRAFT", "INVALID_STATUS"], ["CLOSED", "ALREADY_CLOSED"]] as const) {
      const f = makeDb([po("d", { status })])
      const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "d")
      ok(!r.success && r.code === code, `C4 ${status} → ${code}`)
      eq([f.writes.length, f.tables.purchaseOrder[0].status], [0, status], `C4 ${status} write 0 / 상태 불변`)
    }
    const f = makeDb([po("d", { status: "DRAFT" })])
    const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "d")
    ok(!r.success && /삭제하거나 취소/.test(r.error), "C4 DRAFT 안내 문구(삭제/취소 사용)")
    const g = makeDb([po("d", { status: "CLOSED" })])
    const again = await closePurchaseOrderRemainder({ authorize, db: g.db }, "d")
    ok(!again.success && again.error === PURCHASE_ORDER_CLOSE_MESSAGES.ALREADY_CLOSED, "C4 CLOSED 재실행: 이미 종결 안내(변경 없음)")
  }

  section("C5 타 tenant 발주 → 실패, write 0 (존재 여부 비노출)")
  {
    const f = makeDb([po("x", { tenantId: "tenant-2" })])
    const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "x")
    const none = await closePurchaseOrderRemainder({ authorize, db: f.db }, "no-such-id")
    ok(!r.success && r.code === "INVALID_REFERENCE", "C5 타 tenant → INVALID_REFERENCE")
    ok(!none.success && none.code === "INVALID_REFERENCE" && none.error === (r as any).error, "C5 미존재와 동일한 응답")
    eq([f.writes.length, f.tables.purchaseOrder[0].status], [0, "PARTIAL_RECEIVED"], "C5 write 0, 타 tenant 발주 불변")
    ok(f.reads.length > 0, "C5 조회는 tenant 조건으로만 수행")
  }

  section("C6 권한 없음 → DB 접근 0")
  {
    const f = makeDb([po("a")])
    await assert.rejects(
      () => closePurchaseOrderRemainder({ authorize: async () => { throw new Error("이 기능을 사용할 권한이 없습니다.") }, db: f.db }, "a"),
      /권한/
    )
    passed += 1
    eq([f.reads.length, f.writes.length], [0, 0], "C6 DB read/write 0")
  }

  section("C7 감사로그")
  {
    const f = makeDb([po("a")])
    await closePurchaseOrderRemainder({ authorize, db: f.db }, "a", "  납품 불가  ")
    const log = f.tables.auditLog[0]
    eq([log.tenantId, log.actorId, log.entityType, log.entityId, log.action, log.menuName], [T, "u1", "PurchaseOrder", "a", "UPDATE", "발주관리"], "C7 감사 대상/행위자/메뉴")
    eq(log.beforeData, { status: "PARTIAL_RECEIVED" }, "C7 이전 상태")
    eq(
      [log.afterData.status, log.afterData.closeType, log.afterData.orderedQty, log.afterData.receivedQty, log.afterData.remainingQty, log.afterData.reason],
      ["CLOSED", "REMAINDER_CLOSED", 100, 80, 20, "납품 불가"],
      "C7 이후 상태 / 주문·입고·잔량 / 사유(trim)"
    )
    eq(log.afterData.items[0], { itemId: "R1", itemCode: "R1", qty: 100, receivedQty: 80, remainingQty: 20 }, "C7 품목별 잔량")
  }

  section("외주발주 / 입력 검증 / 동시성 / 원자성")
  {
    for (const [label, over] of [
      ["OS- 번호", { orderNo: "OS-20261001-0001", status: "ORDERED" }],
      ["[OUTSOURCING] note", { note: "[OUTSOURCING] 도금", status: "ORDERED" }],
      [
        "공정 연결 품목",
        { status: "ORDERED", items: [{ id: "i", itemId: "R1", qty: 10, receivedQty: 0, workOrderOperationId: "op-1", item: { code: "R1" } }] },
      ],
    ] as const) {
      const f = makeDb([po("o", over as any)])
      const r = await closePurchaseOrderRemainder({ authorize, db: f.db }, "o")
      ok(!r.success && r.code === "OUTSOURCING_ORDER" && f.writes.length === 0, `외주발주(${label}) 종결 거부, write 0`)
    }

    const f = makeDb([po("a")])
    const long = await closePurchaseOrderRemainder({ authorize, db: f.db }, "a", "가".repeat(MAX_CLOSE_REASON_LENGTH + 1))
    ok(!long.success && long.code === "INVALID_INPUT" && f.reads.length === 0, "사유 길이 초과 → DB 접근 전 거부")
    const badId = await closePurchaseOrderRemainder({ authorize, db: f.db }, "")
    ok(!badId.success && badId.code === "INVALID_REFERENCE", "빈 발주 ID 거부")

    // 동시 변경: 조건부 갱신이 0건이면 CONFLICT(상태를 덮어쓰지 않음)
    const c = makeDb([po("a")])
    c.failNext.updateCount0 = true
    const conflict = await closePurchaseOrderRemainder({ authorize, db: c.db }, "a")
    ok(!conflict.success && conflict.code === "CONFLICT", "동시 변경 → CONFLICT")
    eq(c.tables.auditLog.length, 0, "CONFLICT 시 감사로그 없음")
    eq((c.writes[0].where as Row).status, { in: ["ORDERED", "PARTIAL_RECEIVED"] }, "상태 조건부 갱신(ORDERED/PARTIAL_RECEIVED 일 때만)")

    // 잠금: 입고와 같은 품목 행 잠금 후 다시 읽어 수량을 확정
    const l = makeDb([po("a")])
    let lockedIds: string[] = []
    const r = await closePurchaseOrderRemainder(
      {
        authorize,
        db: l.db,
        lockItems: async (_tx, tenantId, ids) => {
          lockedIds = ids
          eq(tenantId, T, "잠금 tenant")
          // 잠금 직전에 다른 트랜잭션이 입고를 반영한 상황(80 → 95)
          l.tables.purchaseOrder[0].items[0].receivedQty = 95
        },
      },
      "a"
    )
    ok(r.success && r.data.remainingQty === 5, "잠금 후 재조회: 최신 입고 반영(잔량 5)")
    eq(lockedIds, ["i-a"], "품목 행 잠금 대상")
    eq(l.reads.length, 2, "잠금 전 1회 + 잠금 후 1회 조회")

    // 원자성: 감사로그 실패 시 상태 변경도 롤백
    const a = makeDb([po("a")])
    a.failNext.audit = true
    const fail = await closePurchaseOrderRemainder({ authorize, db: a.db }, "a")
    ok(!fail.success && fail.code === "FAILED", "감사 실패 → FAILED(원문 오류 비노출)")
    eq(a.tables.purchaseOrder[0].status, "PARTIAL_RECEIVED", "감사 실패 시 상태 롤백")
  }

  section("정적 점검: 액션 권한 / 입고 가드 / 수량 비변경 / schema")
  {
    const root = join(__dirname, "..")
    const actions = readFileSync(join(root, "src", "lib", "actions", "purchase-order.actions.ts"), "utf8")
    const closeFn = actions.slice(actions.indexOf("export async function closePurchaseOrderRemainder"))
    ok(/requireResourcePermission\("PURCHASE_ORDER", "UPDATE"\)/.test(closeFn), "액션: PURCHASE_ORDER UPDATE 권한")
    ok(/lockItems:\s*\(tx, tenantId, ids\) => lockPurchaseOrderItemsForUpdate/.test(closeFn), "액션: 입고와 같은 품목 행 잠금 사용")
    ok(!/export async function closePurchaseOrderRemainder\([^)]*tenantId/.test(actions), "액션 시그니처에 tenantId 없음")
    const service = readFileSync(join(root, "src", "lib", "services", "purchase-order-close.service.ts"), "utf8")
    ok(!/purchaseOrderItem\.(update|updateMany|delete)/.test(service), "서비스: 발주 품목 수량을 수정하지 않음")
    ok(/data: \{ status: "CLOSED" \}/.test(service) && (service.match(/\.updateMany\(/g) ?? []).length === 1, "서비스: 갱신 데이터는 status=CLOSED 뿐(note/수량 미변경)")
    const receiving = readFileSync(join(root, "src", "lib", "actions", "receiving.actions.ts"), "utf8")
    ok(
      (receiving.match(/종결되었거나 취소된 발주에는 입고할 수 없습니다/g) ?? []).length === 2,
      "입고: CLOSED/CANCELLED 발주 입고 차단(사전 검증 + 잠금 후 재검증)"
    )
    const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8")
    ok(/enum PurchaseOrderStatus \{[^}]*CLOSED[^}]*\}/.test(schema.replace(/\r/g, "")), "기존 CLOSED 상태 사용(schema 변경 없음)")
  }

  console.log(`\n✅ purchase-order-close: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
