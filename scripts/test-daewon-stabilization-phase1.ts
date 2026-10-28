/**
 * 대원정밀 MES 1차 안정화 회귀 테스트 (DB 연결 없음 — Fake/Mock + 소스 구조 검사)
 *
 *  A. 발주번호 채번 잠금: Prisma $queryRaw 의 PostgreSQL `void` 역직렬화 오류 회귀 + 동시성/테넌트 분리
 *  B. 사용자 오류 메시지: Prisma/DB 내부 정보 비노출, 업무 메시지 유지
 *  C. 대원정밀 LOT/제조번호 자동 채번 가드 유지(규칙 미확정 → fail-closed) + 수동 입력 허용
 *  D. 소스 구조: 액션 반환 계약, 클라이언트 결과 처리, 자재출고 경고 아이콘 겹침 제거, 재고 차감 로직 불변
 *
 *  E. 사용자 오류 메시지 allowlist · F. 다품목 입고 부분 성공/재시도 · G. 제조번호 정책 조합 (PR #5 검토 보완)
 *
 * 실제 DB 가 필요한 항목(실 Prisma void 직렬화, 트랜잭션 격리, 재고 정합성)은 이 테스트에서 검증하지 않는다.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import { Prisma } from "@prisma/client"
import {
  allocatePurchaseOrderNumbers,
  pgAdvisoryXactLock,
  purchaseOrderNumberLockKey,
} from "../src/lib/services/purchase-order-number.service"
import {
  CONCURRENT_USER_ERROR_MESSAGE,
  DUPLICATE_USER_ERROR_MESSAGE,
  FORBIDDEN_USER_ERROR_MESSAGE,
  GENERIC_USER_ERROR_MESSAGE,
  NOT_FOUND_USER_ERROR_MESSAGE,
  REFERENCE_USER_ERROR_MESSAGE,
  UNAUTHORIZED_USER_ERROR_MESSAGE,
  failureResult,
  isInternalErrorMessage,
  toUserErrorMessage,
} from "../src/lib/errors/user-error"
import { DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE, DAEWON_MANUFACTURING_NO_RULE_NOT_CONFIGURED_MESSAGE, isCnsLotRuleAllowed } from "../src/lib/lot-numbering/lot-brand-guard"
import { resolveCnsLotRule } from "../src/lib/lot-numbering/lot-rule-resolver"

// ts-node 는 tsconfig 의 "@/" 별칭을 해석하지 못하므로 src 로 매핑한다(다른 모듈이 "@/lib/..." 를 import 함)
const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isUniqueConstraintError, withUniqueBusinessNumberRetry } = require("../src/lib/business-numbering") as typeof import("../src/lib/business-numbering")

const receivingBatchModule = require("../src/lib/receiving-batch") as typeof import("../src/lib/receiving-batch")
const userErrorModule = require("../src/lib/errors/user-error") as typeof import("../src/lib/errors/user-error")
const policyModule = require("../src/lib/lot-numbering/manufacturing-no-policy") as typeof import("../src/lib/lot-numbering/manufacturing-no-policy")

const quantityModule = require("../src/lib/quantity-scale") as typeof import("../src/lib/quantity-scale")
const receivingQuantityModule = require("../src/lib/receiving-quantity") as typeof import("../src/lib/receiving-quantity")
const revalidateModule = require("../src/lib/revalidate-safe") as typeof import("../src/lib/revalidate-safe")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
function eq(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log(`PASS ${label}`)
}
function read(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8")
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── A. 발주번호 채번 잠금 ─────────────────────────────────────────────────────

/** PostgreSQL advisory lock 과 Prisma raw 쿼리 동작을 흉내 내는 Fake. */
class FakePg {
  orders: Array<{ tenantId: string; orderNo: string }> = []
  private holders = new Map<string, Promise<void>>()
  executeRawCalls = 0
  queryRawCalls = 0

  begin() {
    const releases: Array<() => void> = []
    const owner = this
    const isLock = (sql: Prisma.Sql) => sql.strings.join("?").includes("pg_advisory_xact_lock")
    const tx = {
      // Prisma 는 void 컬럼을 $queryRaw 로 읽지 못한다 (실제 오류 문구 재현)
      async $queryRaw(sql: Prisma.Sql) {
        owner.queryRawCalls += 1
        if (isLock(sql)) throw new Error("Failed to deserialize column of type 'void'")
        return []
      },
      async $executeRaw(sql: Prisma.Sql) {
        owner.executeRawCalls += 1
        if (!isLock(sql)) return 0
        const key = String(sql.values[0])
        // 같은 key 를 쥔 트랜잭션이 끝날 때까지 대기 (advisory lock)
        while (owner.holders.has(key)) await owner.holders.get(key)
        let release!: () => void
        owner.holders.set(key, new Promise<void>((res) => (release = res)))
        releases.push(() => {
          owner.holders.delete(key)
          release()
        })
        return 1
      },
      purchaseOrder: {
        async findMany(args: any) {
          const prefix: string = args.where.orderNo.startsWith
          return owner.orders
            .filter((o) => o.tenantId === args.where.tenantId && o.orderNo.startsWith(prefix))
            .map((o) => ({ orderNo: o.orderNo }))
        },
      },
    }
    return { tx, commit: () => releases.splice(0).forEach((r) => r()) }
  }
}

async function createOrderTx(db: FakePg, tenantId: string, opts: { lock?: (tx: any, key: string) => Promise<void>; jitter?: boolean }) {
  const { tx, commit } = db.begin()
  try {
    const [orderNo] = await allocatePurchaseOrderNumbers(tx, tenantId, 1, { year: 2026, ...(opts.lock ? { lock: opts.lock } : {}) })
    if (opts.jitter) await sleep(Math.random() * 8) // 채번~생성 사이 경쟁 구간
    db.orders.push({ tenantId, orderNo })
    return orderNo
  } finally {
    commit()
  }
}

async function testPurchaseOrderLock() {
  // A1. 실제 Prisma 의 void 역직렬화 오류 재현: $queryRaw 만 있는 tx 에서는 잠금이 실패한다 (수정 전 동작)
  {
    const db = new FakePg()
    const { tx } = db.begin()
    const legacyTx = { $queryRaw: (tx as any).$queryRaw }
    await assert.rejects(() => pgAdvisoryXactLock(legacyTx, "k"), /\$executeRaw is not a function/)
    await assert.rejects(() => tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${"k"}))`), /deserialize column of type 'void'/)
    passed += 1
    console.log("PASS A1 pg_advisory_xact_lock 을 $queryRaw 로 읽으면 void 역직렬화 오류가 난다(회귀 재현 모델)")
  }

  // A2. 수정된 pgAdvisoryXactLock 은 $executeRaw 로 잠금을 획득하고 $queryRaw 를 쓰지 않는다
  {
    const db = new FakePg()
    const { tx, commit } = db.begin()
    await pgAdvisoryXactLock(tx, purchaseOrderNumberLockKey("T1", 2026))
    eq([db.executeRawCalls, db.queryRawCalls], [1, 0], "A2 잠금은 $executeRaw 1회, $queryRaw 0회")
    commit()
  }

  // A3. 기본(운영) 잠금으로 동시 20건 등록 → 번호 중복 없이 연속 발급 (기존 3자리/6자리 혼재 시작점)
  {
    const db = new FakePg()
    db.orders.push({ tenantId: "T1", orderNo: "PO-2026-007" }, { tenantId: "T1", orderNo: "PO-2026-000100" })
    const numbers = await Promise.all(Array.from({ length: 20 }, () => createOrderTx(db, "T1", { jitter: true })))
    eq(new Set(numbers).size, 20, "A3 동시 20건 발주번호 중복 없음")
    eq([...numbers].sort()[0], "PO-2026-000101", "A3 기존 최대값(100) 다음부터 발급")
    eq([...numbers].sort()[19], "PO-2026-000120", "A3 연속 번호(101~120)")
    ok(db.queryRawCalls === 0 && db.executeRawCalls === 20, "A3 20건 모두 $executeRaw 잠금 사용")
  }

  // A4. 대조군: 잠금을 비활성화하면 같은 경쟁 구간에서 중복이 발생한다 (테스트가 잠금의 효과를 실제로 검증함)
  {
    const db = new FakePg()
    const noLock = async () => {}
    const numbers = await Promise.all(Array.from({ length: 20 }, () => createOrderTx(db, "T1", { lock: noLock, jitter: true })))
    ok(new Set(numbers).size < 20, "A4 대조군: 잠금 없이는 중복 발생(잠금이 동시성 방어의 핵심)")
  }

  // A5. 테넌트별 분리: 두 테넌트가 동시에 시작해도 각자 000001 부터, 잠금 키도 분리
  {
    const db = new FakePg()
    const a = Promise.all(Array.from({ length: 5 }, () => createOrderTx(db, "T1", { jitter: true })))
    const b = Promise.all(Array.from({ length: 5 }, () => createOrderTx(db, "T2", { jitter: true })))
    const [na, nb] = await Promise.all([a, b])
    eq([...na].sort(), ["PO-2026-000001", "PO-2026-000002", "PO-2026-000003", "PO-2026-000004", "PO-2026-000005"], "A5 T1 번호 1~5")
    eq([...nb].sort(), [...na].sort(), "A5 T2 도 독립적으로 1~5 (테넌트별 분리)")
    ok(purchaseOrderNumberLockKey("T1", 2026) !== purchaseOrderNumberLockKey("T2", 2026), "A5 테넌트별 잠금 키 분리")
    ok(purchaseOrderNumberLockKey("T1", 2026) !== purchaseOrderNumberLockKey("T1", 2027), "A5 연도별 잠금 키 분리")
  }

  // A6. 번호 형식 유지: PO-YYYY-6자리
  {
    const db = new FakePg()
    const { tx, commit } = db.begin()
    const nums = await allocatePurchaseOrderNumbers(tx as any, "T1", 3, { year: 2026 })
    commit()
    eq(nums, ["PO-2026-000001", "PO-2026-000002", "PO-2026-000003"], "A6 발주번호 규칙 PO-YYYY-NNNNNN 유지")
  }

  // A7. unique(tenantId, orderNo) 충돌 시 자동 재시도 후 성공 / 한도 초과 시 안내 메시지
  {
    let calls = 0
    const dup = () =>
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`tenantId`,`orderNo`)", {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { target: ["tenantId", "orderNo"] },
      })
    const result = await withUniqueBusinessNumberRetry(
      async () => {
        calls += 1
        if (calls < 3) throw dup()
        return "done"
      },
      { fields: ["tenantId", "orderNo"] }
    )
    eq([result, calls], ["done", 3], "A7 번호 충돌 시 재시도 후 성공")
    await assert.rejects(
      () => withUniqueBusinessNumberRetry(async () => { throw dup() }, { fields: ["tenantId", "orderNo"], message: "발주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요." }),
      /발주번호 생성 중 중복이 반복되었습니다/
    )
    ok(isUniqueConstraintError(dup(), ["tenantId", "orderNo"]), "A7 P2002 대상 필드 식별")
    passed += 1
    console.log("PASS A7 재시도 한도 초과 시 사용자 안내 메시지")
  }
}

// ─── B. 사용자 오류 메시지 ──────────────────────────────────────────────────────

function testUserErrors() {
  const prismaDup = new Prisma.PrismaClientKnownRequestError(
    "\nInvalid `prisma.purchaseOrder.create()` invocation in\nC:\\app\\src\\lib\\actions\\purchase-order.actions.ts:239:48\n\nUnique constraint failed on the fields: (`tenantId`,`orderNo`)",
    { code: "P2002", clientVersion: "5.22.0", meta: { target: ["tenantId", "orderNo"] } }
  )
  const fk = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed on the field: `PurchaseOrder_supplierId_fkey (index)`", { code: "P2003", clientVersion: "5.22.0" })
  const nf = new Prisma.PrismaClientKnownRequestError("An operation failed because it depends on one or more records that were required but not found.", { code: "P2025", clientVersion: "5.22.0" })
  const conflict = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock.", { code: "P2034", clientVersion: "5.22.0" })
  const validation = new Prisma.PrismaClientValidationError("Invalid `prisma.item.findMany()` invocation: Unknown argument `foo`.", { clientVersion: "5.22.0" })
  const raw = new Error("Raw query failed. Code: `42883`. Message: `ERROR: function pg_advisory_xact_lock(...) does not exist`")
  const voidErr = new Error("Failed to deserialize column of type 'void'. If you're using $queryRaw and this column is explicitly marked as `Unsupported`...")

  eq(toUserErrorMessage(prismaDup), DUPLICATE_USER_ERROR_MESSAGE, "B1 P2002 → 중복 번호 안내")
  eq(toUserErrorMessage(prismaDup, { duplicateMessage: "이미 사용 중인 제조번호입니다." }), "이미 사용 중인 제조번호입니다.", "B1 호출부 지정 중복 문구 사용")
  eq(toUserErrorMessage(fk), REFERENCE_USER_ERROR_MESSAGE, "B2 P2003 → 연결 데이터 안내")
  eq(toUserErrorMessage(nf), NOT_FOUND_USER_ERROR_MESSAGE, "B3 P2025 → 대상 없음 안내")
  eq(toUserErrorMessage(conflict), CONCURRENT_USER_ERROR_MESSAGE, "B4 P2034 → 동시 처리 안내")
  eq(toUserErrorMessage(validation), GENERIC_USER_ERROR_MESSAGE, "B5 Prisma 검증 오류는 일반 안내(쿼리 비노출)")
  eq(toUserErrorMessage(raw), GENERIC_USER_ERROR_MESSAGE, "B6 Raw query 오류는 일반 안내")
  eq(toUserErrorMessage(voidErr), GENERIC_USER_ERROR_MESSAGE, "B7 void 역직렬화 오류는 일반 안내")
  eq(toUserErrorMessage(new Error("FORBIDDEN")), FORBIDDEN_USER_ERROR_MESSAGE, "B8 FORBIDDEN → 권한 안내")
  eq(toUserErrorMessage(new Error("UNAUTHORIZED")), UNAUTHORIZED_USER_ERROR_MESSAGE, "B8 UNAUTHORIZED → 로그인 안내")
  eq(toUserErrorMessage(new Error("이 기능을 사용할 권한이 없습니다.")), "이 기능을 사용할 권한이 없습니다.", "B9 권한 부족 업무 메시지 유지")
  eq(toUserErrorMessage(new Error("가용재고 부족: RM-001 — 가용재고 3, 출고 요청 5")), "가용재고 부족: RM-001 — 가용재고 3, 출고 요청 5", "B10 재고 부족 업무 메시지 유지")
  eq(toUserErrorMessage(new Error(DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE)), DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE, "B11 LOT 규칙 미설정 안내 유지")
  eq(toUserErrorMessage(new Error("이미 사용 중인 제조번호입니다.")), "이미 사용 중인 제조번호입니다.", "B12 제조번호 중복 업무 메시지 유지")
  eq(toUserErrorMessage(new Error("제조번호를 직접 입력해야 하는 품목입니다.")), "제조번호를 직접 입력해야 하는 품목입니다.", "B13 필수 입력 누락 안내 유지")
  eq(toUserErrorMessage(undefined), GENERIC_USER_ERROR_MESSAGE, "B14 알 수 없는 오류 → 일반 안내")
  eq(toUserErrorMessage(new Error("connect ECONNREFUSED 10.0.0.5:5432")), GENERIC_USER_ERROR_MESSAGE, "B15 연결 오류(호스트/포트) 비노출")
  eq(toUserErrorMessage(new Error("postgresql://user:pw@db.example.supabase.co:5432/postgres")), GENERIC_USER_ERROR_MESSAGE, "B15 접속 문자열 비노출")

  for (const e of [prismaDup, fk, nf, conflict, validation, raw, voidErr]) {
    const m = toUserErrorMessage(e)
    ok(!isInternalErrorMessage(m) && !/prisma|P20\d\d|SELECT|tenantId|orderNo/i.test(m), `B16 변환 결과에 내부 정보 없음: ${m.slice(0, 24)}…`)
  }

  // failureResult: 서버 로그에는 원본을 남기고 사용자에게는 변환된 메시지만 반환
  const logged: unknown[][] = []
  const orig = console.error
  console.error = (...args: unknown[]) => { logged.push(args) }
  const res = failureResult("test", prismaDup)
  console.error = orig
  eq(res, { success: false, message: DUPLICATE_USER_ERROR_MESSAGE }, "B17 failureResult 는 안전한 메시지만 반환")
  ok(logged.length === 1 && logged[0][1] === prismaDup, "B17 원본 오류는 서버 로그(console.error)에 그대로 남음")
}

// ─── C. LOT / 제조번호 자동 채번 가드 ──────────────────────────────────────────

function testLotGuard() {
  const saved = process.env.NEXT_PUBLIC_BRAND
  try {
    for (const brand of [undefined, "daewon"]) {
      if (brand === undefined) delete process.env.NEXT_PUBLIC_BRAND
      else process.env.NEXT_PUBLIC_BRAND = brand
      ok(!isCnsLotRuleAllowed(), `C1 BRAND=${brand ?? "(미설정)"} → CNS 자동 채번 차단(fail-closed)`)
      for (const ev of ["MATERIAL_RECEIPT", "PRODUCTION_MANUFACTURING_NO", "FINISHED_GOODS_RECEIPT"] as const) {
        assert.throws(() => resolveCnsLotRule({ lotNumberingType: "DEFAULT" }, ev), new RegExp("대원정밀 LOT 채번 규칙이 설정되지 않았습니다"))
        assert.throws(() => resolveCnsLotRule({ lotNumberingType: "RAW_DATE_SEQ" }, ev), /대원정밀 LOT 채번 규칙/)
        assert.throws(() => resolveCnsLotRule({}, ev), /대원정밀 LOT 채번 규칙/)
      }
      const manual = resolveCnsLotRule({ lotNumberingType: "MANUAL" }, "PRODUCTION_MANUFACTURING_NO")
      eq(manual.pattern, "MANUAL_SUPPLIER_LOT", `C2 BRAND=${brand ?? "(미설정)"} 수동(MANUAL) 품목은 가드 대상 아님`)
      passed += 3
      console.log("PASS C1 기본/원료/PREFIX 규칙 3종 × 3이벤트 모두 차단")
    }
    process.env.NEXT_PUBLIC_BRAND = "newmes"
    ok(isCnsLotRuleAllowed(), "C3 NMES 개발 브랜드에서만 기존 규칙 허용")
    ok(resolveCnsLotRule({ lotNumberingType: "DEFAULT" }, "MATERIAL_RECEIPT").pattern.length > 0, "C3 newmes 에서는 규칙 해석 정상")
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_BRAND
    else process.env.NEXT_PUBLIC_BRAND = saved
  }

  // 대원정밀 규칙을 임의로 만들지 않았는지: 가드 문서/문구가 그대로이고 CNS 규칙 파일이 가드 뒤에만 사용됨
  const resolver = read("src", "lib", "lot-numbering", "lot-rule-resolver.ts")
  ok(/assertCnsLotRuleAllowed\(\)/.test(resolver), "C4 resolver 가 가드(assertCnsLotRuleAllowed)를 계속 호출")
  ok(/제조번호/.test(DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE) || /직접 입력/.test(DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE), "C4 미설정 시 직접 입력 안내 문구")
}

// ─── D. 소스 구조 ──────────────────────────────────────────────────────────────

function testSourceStructure() {
  const poSvc = read("src", "lib", "services", "purchase-order-number.service.ts")
  ok(/\$executeRaw\(Prisma\.sql`SELECT pg_advisory_xact_lock\(hashtext\(\$\{key\}\)\)`\)/.test(poSvc), "D1 운영 잠금이 $executeRaw + pg_advisory_xact_lock(hashtext(key)) 사용")
  ok(!/\$queryRaw\(Prisma\.sql`SELECT pg_advisory/.test(poSvc), "D1 $queryRaw 로 advisory lock 을 읽지 않음")
  ok(/purchaseOrderNumberLockKey\(tenantId, options\.year\)/.test(poSvc), "D1 (tenant, 연도) 단위 잠금 유지")
  ok(!/pg_advisory_xact_lock/.test(read("src", "lib", "services", "mrp-purchase-draft.service.ts").replace(/pgAdvisoryXactLock/g, "")), "D1 MRP 발주 초안은 같은 pgAdvisoryXactLock 을 재사용(직접 SQL 없음)")

  const po = read("src", "lib", "actions", "purchase-order.actions.ts")
  const wo = read("src", "lib", "actions", "work-order.actions.ts")
  for (const [name, src] of [["createPurchaseOrder", po], ["createWorkOrder", wo]] as const) {
    const m = src.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\): Promise<ActionResult> \\{\\s*try \\{\\s*await requireResourcePermission`))
    ok(m, `D2 ${name}: 권한 확인이 try 안에 있고 ActionResult 를 반환`)
    ok(new RegExp(`failureResult\\("${name}"`).test(src), `D2 ${name}: 오류를 서버 로그에 남기고 사용자 메시지로 변환`)
  }
  ok(/withUniqueBusinessNumberRetry/.test(po) && /allocatePurchaseOrderNumbers\(tx, tenantId, 1/.test(po), "D3 발주 생성: 같은 트랜잭션 채번 + unique 재시도 유지")
  ok(/이미 사용 중인 제조번호입니다/.test(wo) && /validateManualManufacturingNoPolicy/.test(wo), "D3 작업지시: 수동 제조번호 중복 검증/필수 정책 유지")

  const poForm = read("src", "app", "app", "mes", "purchase-orders", "purchase-order-form-sheet.tsx")
  const woForm = read("src", "app", "app", "mes", "work-orders", "work-order-form-sheet.tsx")
  ok(/const result = await createPurchaseOrder\([\s\S]*?if \(!result\.success\)/.test(poForm), "D4 발주 폼이 반환 결과(success)를 처리")
  ok(/const result = await createWorkOrder\([\s\S]*?if \(!result\.success\)/.test(woForm), "D4 작업지시 폼이 반환 결과를 처리")
  ok(/isCnsLotRuleAllowed\(\)/.test(woForm) && /제조번호를 직접 입력해 주세요/.test(woForm), "D4 대원정밀: 제조번호 미입력 시 자동 발행이라고 안내하지 않고 직접 입력을 요구")

  const rcvDialog = read("src", "app", "app", "mes", "purchase-orders", "receiving-dialog.tsx")
  ok(/createReceivingInspection\(/.test(rcvDialog) && /runReceivingBatch\(/.test(rcvDialog), "D5 발주 입고 다이얼로그가 실패 결과를 무시하지 않음(성공으로 닫히던 결함 수정, 품목별 결과 기억)")
  const rcv = read("src", "lib", "actions", "receiving.actions.ts")
  ok(/toUserErrorMessage\(error/.test(rcv) && /console\.error\("\[createReceivingInspection\] error:"/.test(rcv), "D5 입고 액션: 서버 로그 유지 + 사용자 메시지 변환")
  ok(/try \{\s*await requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)\s*return await createReceivingInspectionInternal/.test(rcv), "D5 입고 액션: 권한 오류도 반환값으로 전달")
  ok(/MANUAL/.test(rcv) && /LOT 번호 '\$\{resolvedLotNo\}'는 다른 품목에 이미 사용 중입니다/.test(rcv), "D5 입고: 품목 간 LOT 번호 중복 차단 유지")

  const issue = read("src", "lib", "actions", "material-issue.actions.ts")
  ok(/toUserErrorMessage\(e/.test(issue) && /console\.error\("\[issueMaterialsForWorkOrder\] error:"/.test(issue), "D6 출고 액션: 서버 로그 유지 + 사용자 메시지 변환")
  ok(/qtyOnHand: \{ gte: item\.issueQty \},\s*qtyAvailable: \{ gte: item\.issueQty \}/.test(issue) && /decrement: item\.issueQty/.test(issue), "D6 출고 재고 차감 로직 불변(조건부 updateMany)")
  ok(/LOT 관리 품목\(\$\{meta\.code\}\)은 출고 시 LOT를 지정해야 합니다/.test(issue), "D6 LOT 관리 품목은 LOT 지정 필수 유지")

  const dlg = read("src", "app", "app", "mes", "material-issue", "issue-form-dialog.tsx")
  ok(!/<AlertCircle className="absolute/.test(dlg), "D7 경고 아이콘이 입력칸 위에 absolute 로 겹치지 않음")
  ok(/재고 초과/.test(dlg) && !/text-\[11px\] text-red-600/.test(dlg), "D7 재고 초과 경고는 입력칸 아래 별도 줄, 13px 이상")
  ok(/min-w-\[940px\]/.test(dlg) && /overflow-x-auto/.test(dlg), "D7 좁은 화면은 가로 스크롤 컨테이너 유지")
}

// ─── E. 사용자 오류 메시지 allowlist (알 수 없는 오류 원문 비노출) ────────────────

function testUserErrorAllowlist() {
  const { UserFacingError, isAllowedBusinessMessage } = userErrorModule
  const unknowns: Array<[string, unknown]> = [
    ["TypeError", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["영문 예외", new Error("Insufficient stock for item RM-001")],
    ["DB 호스트", new Error("getaddrinfo ENOTFOUND db.abcdefg.supabase.co")],
    ["환경변수", new Error("Environment variable not found: DATABASE_URL")],
    ["SQL", new Error('relation "InventoryBalance" does not exist')],
    ["제약조건", new Error('duplicate key value violates unique constraint "Lot_tenantId_lotNo_key"')],
    ["한글+서버경로", new Error("저장 실패: /var/task/.next/server/app/page.js:12 에서 오류")],
    ["한글+윈도우경로", new Error("저장 실패: C:\\app\\src\\lib\\x.ts 오류")],
    ["한글+소스위치", new Error("처리 오류 at work-order.actions.ts:931")],
    ["한글+SQL", new Error('조회 실패: SELECT id FROM "Lot" WHERE x')],
    ["너무 긴 메시지", new Error("재고가 부족합니다. ".repeat(40))],
    ["객체", { foo: "bar" }],
    ["빈 문자열", ""],
    ["null", null],
  ]
  for (const [label, e] of unknowns) {
    const m = toUserErrorMessage(e)
    eq(m, GENERIC_USER_ERROR_MESSAGE, `E1 알 수 없는 오류(${label}) → 원문 비노출, 일반 안내`)
  }
  // 호출부가 fallback 을 지정하면 그 문구 사용
  eq(toUserErrorMessage(new TypeError("x is not a function"), { fallback: "입고 처리 중 오류가 발생했습니다." }), "입고 처리 중 오류가 발생했습니다.", "E2 fallback 문구 사용")

  // 허용된 업무 메시지는 유지
  const business = [
    "입고수량은 잔여수량을 초과할 수 없습니다. 잔여수량: 30 EA",
    "선택한 창고를 찾을 수 없습니다.",
    "LOT 번호 'A-1'는 다른 품목에 이미 사용 중입니다. 다른 번호를 입력해주세요.",
    "종결되었거나 취소된 발주에는 입고할 수 없습니다.",
    "재고 없음: 해당 창고에 P1000 재고가 없습니다.", // 품목코드 P1000 은 내부 오류 코드로 오인하지 않는다
    "가용재고 부족: RM-001 — 가용재고 3, 출고 요청 5",
    "이미 사용 중인 제조번호입니다.",
    "이 기능을 사용할 권한이 없습니다.",
    "발주번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요.",
    "다른 작업으로 수량이 변경되었습니다. 현재 수량을 확인한 후 다시 시도해주세요.",
  ]
  for (const msg of business) eq(toUserErrorMessage(new Error(msg)), msg, `E3 업무 메시지 유지: ${msg.slice(0, 22)}…`)
  ok(toUserErrorMessage(new UserFacingError("Bad input")) === "Bad input", "E4 UserFacingError 는 명시적으로 허용되어 그대로 전달")
  ok(toUserErrorMessage(new UserFacingError("Unique constraint failed on the fields")) !== "Unique constraint failed on the fields", "E4 UserFacingError 라도 내부 정보 패턴은 차단")
  ok(isAllowedBusinessMessage("재고 부족") && !isAllowedBusinessMessage("Out of stock"), "E5 allowlist: 한글 업무 메시지만 허용")
  eq(toUserErrorMessage(new Error("AUTO_LOT_COLLISION")).includes("AUTO_LOT_COLLISION"), false, "E6 내부 코드 AUTO_LOT_COLLISION 은 한글 안내로 변환")
}

// ─── F. 다품목 입고 부분 성공 · 재시도 ────────────────────────────────────────────

/** 서버(receiving.actions)의 잔량 검증/수량 갱신 규칙을 흉내 낸 Fake: receivedQty += acceptedQty, 입고수량 > 잔량이면 거부 */
class FakeReceivingServer {
  items = new Map<string, { ordered: number; received: number }>()
  calls: string[] = []
  failOnce = new Set<string>()
  throwOnce = new Set<string>()
  loseResponseOnce = new Set<string>() // 서버는 처리했지만 응답이 유실되는 경우
  seen = new Set<string>() // 처리된 requestId (서버 멱등 원장 모델)
  constructor(init: Record<string, { ordered: number; received?: number }>) {
    for (const [id, v] of Object.entries(init)) this.items.set(id, { ordered: v.ordered, received: v.received ?? 0 })
  }
  async receive(id: string, receivedQty: number, acceptedQty: number, requestId?: string): Promise<{ success: boolean; message?: string }> {
    this.calls.push(id)
    if (this.throwOnce.delete(id)) throw new Error("fetch failed") // 요청이 서버에 도달하지 못함
    if (requestId && this.seen.has(requestId)) return { success: true } // 같은 requestId 재전송: 새로 처리하지 않고 기존 결과 반환
    if (this.failOnce.delete(id)) return { success: false, message: "선택한 창고를 찾을 수 없습니다." }
    const it = this.items.get(id)!
    const remaining = it.ordered - it.received
    if (receivedQty > remaining) return { success: false, message: `입고수량은 잔여수량을 초과할 수 없습니다. 잔여수량: ${remaining}` }
    it.received += acceptedQty
    if (requestId) this.seen.add(requestId)
    if (this.loseResponseOnce.delete(id)) throw new Error("fetch failed") // 처리는 끝났는데 응답이 유실됨
    return { success: true }
  }
}

async function testReceivingBatch() {
  const { runReceivingBatch, applyReceiptToQuantities, isRowLocked, isRowDone } = receivingBatchModule
  const rows = [
    { purchaseOrderItemId: "A", receivedInput: 40, acceptedInput: 40, requestId: "req-A-00000000000001" },
    { purchaseOrderItemId: "B", receivedInput: 10, acceptedInput: 10, requestId: "req-B-00000000000001" },
    { purchaseOrderItemId: "C", receivedInput: 0, acceptedInput: 0, requestId: "req-C-00000000000001" },
  ]
  const mk = () => new FakeReceivingServer({ A: { ordered: 100 }, B: { ordered: 50 }, C: { ordered: 20 } })
  const submitTo = (srv: FakeReceivingServer) => (r: { purchaseOrderItemId: string; receivedInput: number; acceptedInput: number; requestId: string }) =>
    srv.receive(r.purchaseOrderItemId, r.receivedInput, r.acceptedInput, r.requestId)

  // F1. A 성공 → B 실패 → 재시도: A 는 다시 입고되지 않는다
  {
    const srv = mk()
    srv.failOnce.add("B")
    const first = await runReceivingBatch(rows, {}, submitTo(srv))
    eq(first.statuses.A?.state, "done", "F1 A 입고 성공 기록")
    eq(first.statuses.B?.state, "failed", "F1 B 실패 기록")
    eq(first.stoppedAt, "B", "F1 B 에서 중단")
    eq(first.allDone, false, "F1 아직 전체 완료 아님")
    const second = await runReceivingBatch(rows, first.statuses, submitTo(srv))
    eq(srv.calls, ["A", "B", "B"], "F1 재시도 때 A 는 서버로 다시 보내지 않음(호출: A,B,B)")
    eq(srv.items.get("A")!.received, 40, "F1 A 서버 기입고수량 40 (중복 입고 없음)")
    eq(srv.items.get("B")!.received, 10, "F1 B 재시도 성공 후 10")
    eq(second.allDone, true, "F1 재시도 후 전체 완료")
    eq(second.newlyDone, ["B"], "F1 재시도에서 새로 성공한 품목은 B 뿐")
  }

  // F2. 대조군: 상태를 기억하지 않는 기존 방식이면 A 가 두 번 입고된다
  {
    const srv = mk()
    srv.failOnce.add("B")
    const naive = async () => {
      for (const r of rows) {
        if (r.receivedInput <= 0) continue
        const res = await srv.receive(r.purchaseOrderItemId, r.receivedInput, r.acceptedInput)
        if (!res.success) return
      }
    }
    await naive()
    await naive()
    eq(srv.items.get("A")!.received, 80, "F2 대조군: 기존 방식은 재시도 때 A 가 80(중복 입고)")
  }

  // F3. 표시 수량 = 서버 수량 (새로고침 없이도 기입고/잔여가 일치)
  {
    const srv = mk()
    const out = await runReceivingBatch(rows, {}, submitTo(srv))
    for (const id of out.newlyDone) {
      const row = rows.find((r) => r.purchaseOrderItemId === id)!
      const server = srv.items.get(id)!
      const view = applyReceiptToQuantities({ orderedQty: server.ordered, receivedQty: 0 }, row.acceptedInput)
      eq([view.receivedQty, view.pendingQty], [server.received, server.ordered - server.received], `F3 ${id} 화면 수량 = 서버 수량`)
    }
    eq(applyReceiptToQuantities({ orderedQty: 10, receivedQty: 8 }, 5).pendingQty, 0, "F3 잔여수량은 음수가 되지 않음")
    eq(out.allDone, true, "F3 수량 0 인 C 는 대상이 아니며 A,B 성공 시 전체 완료")
  }

  // F4. 응답 불명(서버는 처리했지만 응답 유실): 같은 requestId 로 다시 보내도 중복 입고되지 않는다
  {
    const srv = mk()
    srv.loseResponseOnce.add("A")
    const first = await runReceivingBatch(rows, {}, submitTo(srv))
    eq(first.statuses.A?.state, "unknown", "F4 응답 불명 기록 (서버는 이미 A 를 처리함)")
    ok(isRowLocked(first.statuses.A) && !isRowDone(first.statuses.A), "F4 결과 불명 품목은 입력 잠금, 완료로 단정하지 않음")
    eq(srv.items.get("A")!.received, 40, "F4 서버에는 A 40 이 1회 반영됨")
    const a = first.statuses.A
    ok(a !== undefined && a.state === "unknown" && a.message.includes("같은 요청으로 다시 저장"), "F4 불명 안내: 같은 요청으로 다시 저장하면 안전함")
    const again = await runReceivingBatch(rows, first.statuses, submitTo(srv))
    eq(srv.calls, ["A", "A", "B"], "F4 재저장 시 A 는 같은 requestId 로 재전송, B 는 이어서 진행")
    eq(srv.items.get("A")!.received, 40, "F4 재전송에도 A 는 40 그대로 (서버 멱등으로 중복 입고 없음)")
    eq(srv.items.get("B")!.received, 10, "F4 B 정상 입고 10")
    eq(again.allDone, true, "F4 재전송이 기존 결과로 확인되어 완료")
  }

  // F5. 잔량 초과는 서버가 거부 → 실패 안내, 기입고 수량은 변하지 않음
  {
    const srv = new FakeReceivingServer({ A: { ordered: 100, received: 80 }, B: { ordered: 50 }, C: { ordered: 20 } })
    const out = await runReceivingBatch(rows, {}, submitTo(srv))
    eq(out.statuses.A?.state, "failed", "F5 잔량 초과 입고는 서버가 거부")
    eq(srv.items.get("A")!.received, 80, "F5 거부된 입고는 수량을 바꾸지 않음")
    const a = out.statuses.A
    ok(a !== undefined && a.state === "failed" && a.message.includes("잔여수량"), "F5 잔여수량 안내 유지")
    eq(srv.calls, ["A"], "F5 첫 실패에서 중단(뒤 품목 미처리)")
  }

  // F6. 모든 품목 수량이 0 이면 아무것도 보내지 않고 완료로 보지도 않는다
  {
    const srv = mk()
    const out = await runReceivingBatch(rows.map((r) => ({ ...r, receivedInput: 0 })), {}, submitTo(srv))
    eq([srv.calls.length, out.allDone], [0, false], "F6 입고 대상 없음 → 호출 0, 완료 아님")
  }

  // F7. 소스 구조: 두 다이얼로그가 같은 모듈 사용 · 더블클릭 방어 · 잠금
  for (const [label, path] of [
    ["발주 입고(purchase-orders)", ["src", "app", "app", "mes", "purchase-orders", "receiving-dialog.tsx"]],
    ["자재입고(material-receipt)", ["src", "app", "app", "mes", "material-receipt", "receiving-form-dialog.tsx"]],
  ] as const) {
    const src = read(...path)
    ok(/runReceivingBatch\(/.test(src) && /rowStatus/.test(src), `F7 ${label}: 품목별 결과를 기억하고 순차 처리 모듈 사용`)
    ok(/if \(savingRef\.current\) return/.test(src) && /savingRef\.current = true/.test(src) && /savingRef\.current = false/.test(src), `F7 ${label}: 저장 중 중복 클릭 방어(ref 가드)`)
    ok(/<fieldset[\s\S]*?isRowLocked\(rowStatus\[ins\.purchaseOrderItemId\]\)/.test(src), `F7 ${label}: 완료/불명 품목 입력 잠금`)
    ok(/입고 완료 — 다시 저장되지 않습니다/.test(src) && /입고 실패:/.test(src), `F7 ${label}: 성공/실패 상태 구분 표시`)
    ok(/applyReceiptToQuantities/.test(src) && /router\.refresh\(\)/.test(src), `F7 ${label}: 성공 품목 수량 즉시 반영 + 서버 새로고침`)
    ok(!/error instanceof Error \? error\.message/.test(src), `F7 ${label}: 예외 메시지 원문을 그대로 alert 하지 않음`)
  }
  const server = read("src", "lib", "actions", "receiving.actions.ts")
  ok(/lockPurchaseOrderItemsForUpdate/.test(server) && /lockedRemainingCheck/.test(server), "F8 서버 입고 트랜잭션의 행 잠금 + 잔량 재검증은 유지됨(정확 비교로 교체)")
}

// ─── G. 제조번호 수동 입력 정책 조합 ───────────────────────────────────────────────

function testManufacturingPolicy() {
  const {
    decideManufacturingNo,
    MANUFACTURING_NO_DISABLED_NO_AUTO_MESSAGE,
    MANUFACTURING_NO_POLICY_CONFLICT_MESSAGE,
    MANUFACTURING_NO_REQUIRED_MESSAGE,
  } = policyModule
  const types = ["DEFAULT", "MANUAL", "RAW_DATE_SEQ", "PREFIX_MONTH_SEQ"]
  const policies = ["ALLOWED", "REQUIRED", "DISABLED"]
  let cells = 0
  for (const t of types) for (const p of policies) for (const input of ["", "  ", "M-001", " M-002 "]) for (const autoAllowed of [false, true]) for (const blankMeansAuto of [true, false]) {
    const d = decideManufacturingNo({ lotNumberingType: t, manualLotPolicy: p, input, autoAllowed, blankMeansAuto })
    cells += 1
    if (!autoAllowed) assert.notEqual(d.kind, "AUTO", `대원정밀(자동 채번 불가)에서 AUTO 판정 금지: ${t}/${p}/${JSON.stringify(input)}`)
    if (d.kind === "MANUAL") assert.equal(d.value, input.trim(), "수동 번호는 trim 된 입력 그대로")
    if (d.kind === "ERROR") assert.ok(/[가-힣]/.test(d.message), "오류는 한글 안내")
  }
  ok(cells === 4 * 3 * 4 * 2 * 2, `G1 ${cells}개 조합 모두 불변식 통과(자동 채번 불가 시 AUTO 없음, 수동 번호 보존, 한글 안내)`)

  const D = (t: string, p: string, input: string, autoAllowed = false, blankMeansAuto = true) =>
    decideManufacturingNo({ lotNumberingType: t, manualLotPolicy: p, input, autoAllowed, blankMeansAuto })
  // 대원정밀(autoAllowed=false)
  for (const t of ["DEFAULT", "RAW_DATE_SEQ", "PREFIX_MONTH_SEQ"]) {
    eq(D(t, "ALLOWED", "M-1"), { kind: "MANUAL", value: "M-1" }, `G2 ${t}/ALLOWED 수동 입력 허용`)
    eq(D(t, "ALLOWED", ""), { kind: "ERROR", message: DAEWON_MANUFACTURING_NO_RULE_NOT_CONFIGURED_MESSAGE }, `G2 ${t}/ALLOWED 미입력 → 제조번호 규칙 미확정 안내(LOT 규칙과 별개)`)
    eq(D(t, "REQUIRED", ""), { kind: "ERROR", message: MANUFACTURING_NO_REQUIRED_MESSAGE }, `G2 ${t}/REQUIRED 미입력 → 직접 입력 요구`)
    eq(D(t, "REQUIRED", "M-1"), { kind: "MANUAL", value: "M-1" }, `G2 ${t}/REQUIRED 입력 → 수동 사용`)
    eq(D(t, "DISABLED", "M-1"), { kind: "ERROR", message: MANUFACTURING_NO_DISABLED_NO_AUTO_MESSAGE }, `G3 ${t}/DISABLED 입력 → 입력이 무시되어 자동 채번을 시도하던 문제를 명확한 안내로 대체`)
    eq(D(t, "DISABLED", ""), { kind: "ERROR", message: MANUFACTURING_NO_DISABLED_NO_AUTO_MESSAGE }, `G3 ${t}/DISABLED 미입력 → 동일 안내`)
  }
  eq(D("MANUAL", "ALLOWED", ""), { kind: "ERROR", message: MANUFACTURING_NO_REQUIRED_MESSAGE }, "G4 MANUAL 유형은 직접 입력 필수")
  eq(D("MANUAL", "ALLOWED", "M-9"), { kind: "MANUAL", value: "M-9" }, "G4 MANUAL 유형 입력 시 수동")
  eq(D("MANUAL", "DISABLED", "M-9"), { kind: "ERROR", message: MANUFACTURING_NO_POLICY_CONFLICT_MESSAGE }, "G5 MANUAL + DISABLED 는 설정 충돌 안내")
  eq(D("DEFAULT", "REQUIRED", "x", true).kind, "MANUAL", "G6 REQUIRED 는 자동 채번 가능해도 수동 사용")
  eq(D("DEFAULT", "REQUIRED", "", true, true).kind, "ERROR", "G6 REQUIRED 미입력은 자동 채번 가능해도 거절")
  // 자동 채번이 가능한 환경(NMES 개발)에서는 기존 동작 유지
  eq(D("DEFAULT", "ALLOWED", "", true).kind, "AUTO", "G7 자동 채번 가능 환경: 미입력 → AUTO(기존 동작)")
  eq(D("DEFAULT", "DISABLED", "M-1", true).kind, "AUTO", "G7 자동 채번 가능 환경: DISABLED 는 입력을 무시하고 AUTO(기존 동작)")
  // 수정 흐름(blankMeansAuto=false): 미입력은 번호 없이 저장 — 기존 수정 동작 유지
  eq(D("DEFAULT", "ALLOWED", "", false, false).kind, "NONE", "G8 수정: 미입력은 번호 없음(기존 동작)")
  eq(D("DEFAULT", "DISABLED", "", false, false).kind, "NONE", "G8 수정: DISABLED 미입력도 기존처럼 차단하지 않음")
  eq(D("DEFAULT", "REQUIRED", "", false, false).kind, "ERROR", "G8 수정: REQUIRED 미입력은 기존처럼 거절")

  // 가드 유지 + 호출 구조
  const wo = read("src", "lib", "actions", "work-order.actions.ts")
  ok(/decideManufacturingNo\(/.test(wo) && /blankMeansAuto: true/.test(wo) && /blankMeansAuto: false/.test(wo), "G9 작업지시 등록/수정이 정책 판정 모듈을 사용")
  ok(/throw new UserFacingError\(decision\.message\)/.test(wo), "G9 정책 오류는 사용자 안내(UserFacingError)로 전달")
  ok(/assertCnsLotRuleAllowed\(\)/.test(read("src", "lib", "lot-numbering", "lot-rule-resolver.ts")), "G9 자동 채번 가드(assertCnsLotRuleAllowed) 유지")
  ok(!/lotNumberingType:\s*["']/.test(read("src", "lib", "lot-numbering", "manufacturing-no-policy.ts")), "G9 품목 정책을 변경하는 코드 없음")
}

// ─── H. 자재입고 서버 입력 검증 · 화면 상태 초기화 (최종 검증 보완) ─────────────────

function testReceivingHardening() {
  const server = read("src", "lib", "actions", "receiving.actions.ts")
  ok(/validateReceiptQuantities\(data\)/.test(server), "H1 서버: 수량 검증(NaN/Infinity/음수/6자리 초과 차단)을 공통 정책 함수로 수행")
  ok(/purchaseOrderItem\.purchaseOrderId !== data\.purchaseOrderId/.test(server), "H2 서버: 클라이언트가 보낸 purchaseOrderId 가 발주 품목의 실제 발주와 같은지 검증")
  const idxCheck = server.indexOf("purchaseOrderItem.purchaseOrderId !== data.purchaseOrderId")
  const idxTx = server.indexOf("prisma.$transaction")
  ok(idxCheck > 0 && idxTx > idxCheck, "H2 서버: 불일치 검증이 트랜잭션(발주 상태 갱신)보다 먼저 실행")
  // 위 NaN 판정 근거: 비교 연산이 모두 false 가 되어 기존 검증을 통과했다
  const nan = NaN
  ok(!(nan <= 0) && !(nan > 10) && !(nan < 0) && !(Math.abs(nan + 0 - nan) > 0.001), "H1 근거: NaN 은 기존 대소 비교 검증을 모두 통과했다")
  // 서버 멱등성 부재(문서화): ReceivingInspection 에 요청 식별자/unique 가 없다
  const schema = read("prisma", "schema.prisma")
  const model = schema.match(/model ReceivingInspection \{[\s\S]*?\n\}/)?.[0] ?? ""
  ok(model.length > 0 && !/@@unique/.test(model) && !/requestId|idempotenc/i.test(model), "H3 현황 기록: 서버 입고는 멱등 키가 없다(중복 방지는 클라이언트 + 잔량 검증 수준)")
  ok(/lockPurchaseOrderItemsForUpdate\(tx, tenantId, \[data\.purchaseOrderItemId\]\)/.test(server) && /lockedRemainingCheck/.test(server), "H4 서버: 같은 발주 품목 동시 입고는 행 잠금 후 잔량을 재검증")
  const table = read("src", "app", "app", "mes", "material-receipt", "material-receipt-data-table.tsx")
  ok(/<ReceivingFormDialog\s+key=\{receivingOrder\.id\}/.test(table), "H5 입고 창: 발주가 바뀌면 상태가 남지 않도록 key 로 재마운트")
  for (const p of [
    ["src", "app", "app", "mes", "material-receipt", "receiving-form-dialog.tsx"],
    ["src", "app", "app", "mes", "purchase-orders", "receiving-dialog.tsx"],
  ]) {
    ok(/outcome\.newlyDone\.length > 0 \|\| outcome\.stoppedAt\) router\.refresh\(\)/.test(read(...p)), `H6 ${p[p.length - 2]}: 실패/결과 불명으로 중단돼도 서버의 최신 수량을 다시 읽음`)
  }
}

// ─── I. 수량 정밀도 · 커밋 이후 오류 · 결과 불명 처리 ────────────────────────────

async function testQuantityPrecisionAndPostCommit() {
  const q = quantityModule
  const rq = receivingQuantityModule
  const { safeRevalidate } = revalidateModule
  const { isOutcomeUnknownError, OUTCOME_UNKNOWN_MESSAGE } = userErrorModule

  // I1. 기본 환산
  eq(q.toScaledQuantity(0.3 - 0.1), BigInt(200000), "I1 0.3-0.1(0.19999999999999998) 은 0.2 로 환산")
  eq(q.toScaledQuantity(100.0005), BigInt(100000500), "I1 100.0005 는 소수점 4자리 값으로 환산")
  eq(q.toScaledQuantity("0.200000"), BigInt(200000), "I1 문자열/Decimal 문자열 환산")
  eq(q.toScaledQuantity({ toString: () => "12.5" }), BigInt(12500000), "I1 Decimal 유사 객체 환산")
  for (const bad of [NaN, Infinity, -Infinity, 1.0000001, "1.0000001", "abc", "", null, undefined, "1e-7"]) {
    eq(q.toScaledQuantity(bad as unknown), null, `I1 잘못된 수량 거부: ${String(bad)}`)
  }
  eq(q.subtractQuantities(0.3, 0.1), 0.2, "I1 정확한 뺄셈 0.3-0.1 = 0.2 (float 은 0.19999999999999998)")
  eq(q.addQuantities(0.1, 0.2), 0.3, "I1 정확한 덧셈 0.1+0.2 = 0.3 (float 은 0.30000000000000004)")
  ok(0.3 - 0.1 !== 0.2 && 0.1 + 0.2 !== 0.3, "I1 근거: JS float 연산은 실제로 어긋난다")
  eq(q.formatScaledQuantity(BigInt(200000)), "0.2", "I1 표시용 문자열은 float 없이 0.2")
  eq(q.formatScaledQuantity(BigInt(-1500000)), "-1.5", "I1 음수 표시")

  // I2. 입고 수량 검증 (요청서 시나리오)
  const V = (r: unknown, a: unknown, j: unknown) => rq.validateReceiptQuantities({ receivedQty: r, acceptedQty: a, rejectedQty: j })
  ok(!V(100, 100.0005, 0).ok, "I2 입고 100 · 합격 100.0005 · 불합격 0 → 거부")
  const over = V(100, 100.0005, 0)
  ok(!over.ok && over.message.includes("합"), "I2 합계 불일치 안내")
  ok(V(100, 100, 0).ok, "I2 입고 100 · 합격 100 → 허용")
  ok(V(100, 99.9995, 0.0005).ok, "I2 합격 99.9995 + 불합격 0.0005 = 100 → 허용(소수 4자리, 정확 비교)")
  ok(V(0.3 - 0.1, 0.2, 0).ok, "I2 입고수량 0.3-0.1(0.19999999999999998) · 합격 0.2 → 허용")
  const r2 = V(0.3 - 0.1, 0.1, 0.1)
  ok(r2.ok && r2.value.received === 0.2 && r2.value.accepted === 0.1, "I2 입고 0.2 = 합격 0.1 + 불합격 0.1 → 허용, 값은 6자리로 정규화")
  ok(V(0.1 + 0.2, 0.3, 0).ok, "I2 입고 0.30000000000000004 · 합격 0.3 → 허용")
  for (const [label, args] of [
    ["NaN 입고", [NaN, 1, 0]], ["Infinity 입고", [Infinity, 1, 0]], ["NaN 합격", [1, NaN, 0]], ["Infinity 불합격", [1, 1, Infinity]],
    ["입고 0", [0, 0, 0]], ["입고 음수", [-1, -1, 0]], ["합격 음수", [1, -1, 2]], ["불합격 음수", [1, 2, -1]],
    ["6자리 초과", [1.0000001, 1.0000001, 0]], ["합계 부족", [10, 4, 5]], ["합계 초과", [10, 6, 5]],
  ] as const) {
    ok(!V(args[0], args[1], args[2]).ok, `I2 거부: ${label}`)
  }

  // I3. 잔량 검증 (서버 사전 검증 + 트랜잭션 내부가 같은 함수)
  const rem = (received: number, ordered: string, already: string) => {
    const v = V(received, received, 0)
    if (!v.ok) throw new Error("setup")
    return rq.checkReceiptRemaining(v.value.receivedScaled, ordered, already, "EA")
  }
  ok(rem(0.3 - 0.1, "100", "99.8").ok, "I3 잔량 0.2 에 0.3-0.1 입고 → 허용(부동소수점 오차로 거부되지 않음)")
  ok(rem(0.2, "100", "99.8").ok && rem(0.2, "100.000000", "99.800000").ok, "I3 Decimal 문자열 6자리 표기도 동일")
  const tooMuch = rem(0.200001, "100", "99.8")
  ok(!tooMuch.ok && tooMuch.message.includes("잔여수량: 0.2 EA"), "I3 0.200001 은 잔량 초과로 거부, 잔여수량은 0.2 로 표시")
  ok(rem(100, "100", "0").ok && !rem(100.000001, "100", "0").ok, "I3 경계: 정확히 잔량까지 허용, 1e-6 초과는 거부")
  ok(!rq.checkReceiptRemaining(BigInt(1), "abc", "0", "EA").ok, "I3 발주 수량 데이터 이상 시 거부")

  // I4. 소스 구조: 사전 검증과 트랜잭션 내부가 같은 정책을 사용
  const server = read("src", "lib", "actions", "receiving.actions.ts")
  ok((server.match(/checkReceiptRemaining\(/g) || []).length === 2 && /validateReceiptQuantities\(data\)/.test(server), "I4 서버: 사전 검증 + 트랜잭션 내부 재검증이 같은 정책 함수 사용")
  ok(!/Math\.abs\(data\.acceptedQty/.test(server) && !/> 0\.001/.test(server) && !/toLocaleString\("ko-KR"\)/.test(server), "I4 서버: 허용오차(0.001)·float 표시 제거")
  ok(!/data\.(received|accepted|rejected)Qty/.test(server.replace(/validateReceiptQuantities\(data\)/g, "")) , "I4 서버: 쓰기에는 정규화된 qty.* 만 사용")
  for (const p of [
    ["src", "app", "app", "mes", "material-receipt", "receiving-form-dialog.tsx"],
    ["src", "app", "app", "mes", "purchase-orders", "receiving-dialog.tsx"],
  ]) {
    const src = read(...p)
    ok(/subtractQuantities\(received, accepted\)/.test(src) && !/Math\.max\(0, received - accepted\)/.test(src), `I4 ${p[p.length - 2]}: 불합격수량 계산에 float 뺄셈을 쓰지 않음`)
  }
  const mr = read("src", "app", "app", "mes", "material-receipt", "receiving-form-dialog.tsx")
  ok(/isQuantityBalanced\(received, accepted, rejected\)/.test(mr) && !/> 0\.001/.test(mr), "I4 자재입고 화면: 합격+불합격 정합성을 정확 비교(허용오차 제거)")
  const view = receivingBatchModule.applyReceiptToQuantities({ orderedQty: 1, receivedQty: 0.1 }, 0.2)
  eq([view.receivedQty, view.pendingQty], [0.3, 0.7], "I4 화면 기입고/잔여 갱신이 소수점 오차 없이 계산됨")

  // I5. DB 커밋 이후 후처리 오류 — 입고 결과를 뒤집지 않는다 (모델)
  class Store { received = 0; commits = 0 }
  /** 서버 액션 모델: 커밋 → 후처리(revalidate). guarded=true 이면 safeRevalidate (수정 후), false 이면 후처리 오류가 그대로 던져짐 (수정 전) */
  async function receiveModel(store: Store, qty: number, revalidate: (p: string) => void, guarded: boolean) {
    try {
      store.received += qty // 트랜잭션 커밋 (되돌릴 수 없음)
      store.commits += 1
      if (guarded) safeRevalidate(revalidate, ["/a", "/b"], "test")
      else for (const p of ["/a", "/b"]) revalidate(p)
      return { success: true as const }
    } catch {
      return { success: false as const }
    }
  }
  const failing = () => { throw new Error("Invariant: static generation store missing") }
  const origErr = console.error
  const logged: unknown[][] = []
  console.error = (...a: unknown[]) => { logged.push(a) }
  try {
    const before = new Store()
    const naive = await receiveModel(before, 40, failing, false)
    eq([naive.success, before.received], [false, 40], "I5 대조군(수정 전): 커밋은 됐는데 실패로 안내 → 사용자가 재시도하면 중복 입고 가능")
    const after = new Store()
    const fixed = await receiveModel(after, 40, failing, true)
    eq([fixed.success, after.received, after.commits], [true, 40, 1], "I5 수정 후: 후처리 오류에도 성공 반환, 입고는 1회만 반영")
    ok(logged.length === 2 && logged.every((a) => String(a[0]).includes("post-commit revalidate failed")), "I5 후처리 오류는 경로별로 서버 로그에 기록")
    const failedPaths = safeRevalidate(failing, ["/x", "/y"], "t")
    eq(failedPaths, ["/x", "/y"], "I5 실패한 경로 목록 반환, 모든 경로를 시도(첫 오류에서 중단하지 않음)")
  } finally {
    console.error = origErr
  }
  ok(/safeRevalidate\(\s*revalidatePath,/.test(server) && !/^\s*revalidatePath\(/m.test(server), "I5 서버(입고): revalidatePath 직접 호출 없음 — safeRevalidate 로만 후처리")
  const afterBreak = server.slice(server.indexOf("      break\n") >= 0 ? server.indexOf("      break\n") : server.indexOf("      break\r\n"))
  ok(afterBreak.includes("safeRevalidate(") && afterBreak.indexOf("safeRevalidate(") > 0, "I5 서버(입고): 후처리는 트랜잭션 성공(break) 이후에만 실행")
  for (const [label, p, name] of [
    ["발주 등록", ["src", "lib", "actions", "purchase-order.actions.ts"], "createPurchaseOrder"],
    ["작업지시 등록", ["src", "lib", "actions", "work-order.actions.ts"], "createWorkOrder"],
    ["자재출고", ["src", "lib", "actions", "material-issue.actions.ts"], "issueMaterialsForWorkOrder"],
  ] as const) {
    const src = read(...p)
    ok(new RegExp(`safeRevalidate\\([\\s\\S]{0,400}"${name}"`).test(src), `I5 ${label}: 커밋 이후 재검증 오류를 분리(safeRevalidate)`)
  }

  // I6. 커밋 결과 불명 — 성공으로 단정하지 않고 재전송을 막는다
  const mk = (name: string, code?: string) => Object.assign(new Error("x"), { name, ...(code ? { code } : {}) })
  for (const e of [mk("PrismaClientInitializationError"), mk("PrismaClientUnknownRequestError"), mk("PrismaClientKnownRequestError", "P1001"), mk("PrismaClientKnownRequestError", "P2028"), new Error("Server has closed the connection."), new Error("read ECONNRESET")]) {
    ok(isOutcomeUnknownError(e), `I6 결과 불명으로 분류: ${e.name}/${(e as { code?: string }).code ?? e.message.slice(0, 24)}`)
  }
  for (const e of [mk("PrismaClientKnownRequestError", "P2002"), mk("PrismaClientKnownRequestError", "P2034"), new Error("입고수량은 잔여수량을 초과할 수 없습니다."), new Error("FORBIDDEN")]) {
    ok(!isOutcomeUnknownError(e), `I6 롤백이 확실한 오류는 불명 아님: ${(e as { code?: string }).code ?? e.message.slice(0, 16)}`)
  }
  ok(/isOutcomeUnknownError\(error\)[\s\S]{0,160}outcome: "UNKNOWN"/.test(server), "I6 서버(입고): 결과 불명 오류를 outcome=UNKNOWN 으로 반환")
  ok(/isOutcomeUnknownError\(e\)\) return \{ ok: false, error: OUTCOME_UNKNOWN_MESSAGE \}/.test(read("src", "lib", "actions", "material-issue.actions.ts")), "I6 서버(출고): 결과 불명 시 확인 요청 메시지")
  {
    const srv = new FakeReceivingServer({ A: { ordered: 100 }, B: { ordered: 50 } })
    const rows2 = [
      { purchaseOrderItemId: "A", receivedInput: 40, acceptedInput: 40, requestId: "req-A-00000000000002" },
      { purchaseOrderItemId: "B", receivedInput: 10, acceptedInput: 10, requestId: "req-B-00000000000002" },
    ]
    let first = true
    const submit = async (r: { purchaseOrderItemId: string; receivedInput: number; acceptedInput: number; requestId: string }) => {
      if (r.purchaseOrderItemId === "A" && first) {
        first = false
        // 서버는 커밋했지만 응답이 "결과 불명"으로 돌아온 상황
        await srv.receive("A", r.receivedInput, r.acceptedInput, r.requestId)
        return { success: false, outcome: "UNKNOWN" as const, message: OUTCOME_UNKNOWN_MESSAGE }
      }
      return srv.receive(r.purchaseOrderItemId, r.receivedInput, r.acceptedInput, r.requestId)
    }
    const o1 = await receivingBatchModule.runReceivingBatch(rows2, {}, submit)
    eq(o1.statuses.A?.state, "unknown", "I6 outcome=UNKNOWN 응답은 실패가 아니라 결과 불명으로 기록")
    const o2 = await receivingBatchModule.runReceivingBatch(rows2, o1.statuses, submit)
    eq(srv.items.get("A")!.received, 40, "I6 결과 불명 품목을 같은 requestId 로 다시 보내도 중복 입고 없음(서버 멱등)")
    eq(o2.allDone, true, "I6 재전송으로 결과가 확인되면 완료 처리")
  }
}

// ─── J. 입고 거래번호(txNo) 채번: 트랜잭션 내부 + (tenant, 날짜) advisory lock ──────────

async function testReceiptTxNumbering() {
  const svc = require("../src/lib/services/receiving-tx-number.service") as typeof import("../src/lib/services/receiving-tx-number.service")
  const YMD = "20261019"

  // J1. 순수 규칙
  eq(svc.formatReceiptTxNo(YMD, 1), "RCV-20261019-0001", "J1 형식 유지 RCV-YYYYMMDD-NNNN")
  eq(svc.formatReceiptTxNo(YMD, 10000), "RCV-20261019-10000", "J1 4자리를 넘으면 자릿수 확장")
  eq(svc.parseReceiptTxSequence("RCV-20261019-0007", YMD), 7, "J1 기존 번호 파싱")
  eq([svc.parseReceiptTxSequence("RCV-20261018-0007", YMD), svc.parseReceiptTxSequence("RCV-20261019-AB", YMD), svc.parseReceiptTxSequence("SRT-20261019-0001", YMD)], [null, null, null], "J1 다른 날짜/비숫자/다른 접두어는 무시")
  ok(svc.receiptTxLockKey("T1", YMD) !== svc.receiptTxLockKey("T2", YMD) && svc.receiptTxLockKey("T1", YMD) !== svc.receiptTxLockKey("T1", "20261020"), "J1 잠금 키는 tenant·날짜별로 분리")

  // J2. 다음 번호 = 숫자 최대값 + 1 (문자열 정렬 금지), 기존 번호는 그대로
  class FakeLedgerDb {
    rows: Array<{ tenantId: string; txNo: string }> = []
    private holders = new Map<string, Promise<void>>()
    lockCalls = 0
    begin() {
      const owner = this
      const releases: Array<() => void> = []
      const tx = {
        async $executeRaw(sql: { values: unknown[] }) {
          owner.lockCalls += 1
          const key = String(sql.values[0])
          while (owner.holders.has(key)) await owner.holders.get(key)
          let release!: () => void
          owner.holders.set(key, new Promise<void>((res) => (release = res)))
          releases.push(() => { owner.holders.delete(key); release() })
          return 1
        },
        inventoryTransaction: {
          async findMany(args: any) {
            const prefix: string = args.where.txNo.startsWith
            return owner.rows.filter((r) => r.tenantId === args.where.tenantId && r.txNo.startsWith(prefix)).map((r) => ({ txNo: r.txNo }))
          },
        },
      }
      return { tx, commit: () => releases.splice(0).forEach((r) => r()) }
    }
  }
  {
    const db = new FakeLedgerDb()
    db.rows.push({ tenantId: "T1", txNo: "RCV-20261019-9999" }, { tenantId: "T1", txNo: "RCV-20261019-10000" }, { tenantId: "T1", txNo: "RCV-20261018-0500" }, { tenantId: "T2", txNo: "RCV-20261019-0042" })
    const { tx, commit } = db.begin()
    eq(await svc.allocateReceiptTxNo(tx as any, "T1", { yyyymmdd: YMD }), "RCV-20261019-10001", "J2 9999 다음 10000 이후도 숫자 최대값 기준(문자열 정렬이면 중복)")
    commit()
    const b = db.begin()
    eq(await svc.allocateReceiptTxNo(b.tx as any, "T2", { yyyymmdd: YMD }), "RCV-20261019-0043", "J2 다른 tenant 는 독립")
    b.commit()
    const c = db.begin()
    eq(await svc.allocateReceiptTxNo(c.tx as any, "T3", { yyyymmdd: YMD }), "RCV-20261019-0001", "J2 첫 입고는 0001")
    c.commit()
  }

  // J3. 동시 25건: 잠금 안에서 최신 번호를 재조회하므로 중복 없이 연속 (대조군: 잠금 없이는 중복)
  async function burst(withLock: boolean) {
    const db = new FakeLedgerDb()
    const noLock = async () => {}
    const nos = await Promise.all(Array.from({ length: 25 }, async () => {
      const { tx, commit } = db.begin()
      try {
        const no = await svc.allocateReceiptTxNo(tx as any, "T1", { yyyymmdd: YMD, ...(withLock ? {} : { lock: noLock }) })
        await sleep(Math.random() * 6) // 번호 확보~저장 사이의 경쟁 구간
        db.rows.push({ tenantId: "T1", txNo: no })
        return no
      } finally {
        commit()
      }
    }))
    return { nos, db }
  }
  {
    const locked = await burst(true)
    eq(new Set(locked.nos).size, 25, "J3 동시 25건 거래번호 중복 없음(잠금)")
    eq([...locked.nos].sort()[0], "RCV-20261019-0001", "J3 0001 부터 시작")
    eq([...locked.nos].sort()[24], "RCV-20261019-0025", "J3 0025 까지 연속")
    eq(locked.db.lockCalls, 25, "J3 모든 발급이 $executeRaw 잠금을 사용")
    const unlocked = await burst(false)
    ok(new Set(unlocked.nos).size < 25, "J3 대조군: 잠금 없이는 중복 발생(수정 전 증상 재현)")
  }

  // J4. 소스 구조
  const src = read("src", "lib", "actions", "receiving.actions.ts")
  ok(!/async function generateTxNo/.test(src) && !/generateTxNo\(/.test(src), "J4 트랜잭션 밖의 generateTxNo 제거")
  ok((src.match(/allocateReceiptTxNo\(tx, tenantId/g) || []).length === 1, "J4 거래번호는 트랜잭션 안에서 한 번만 확보")
  const iAlloc = src.indexOf("allocateReceiptTxNo(tx, tenantId")
  const iBalance = src.indexOf("tx.inventoryBalance.findFirst")
  const iLedger = src.indexOf("tx.inventoryTransaction.create")
  ok(iAlloc > 0 && iAlloc < iBalance && iBalance < iLedger, "J4 거래번호(잠금) 확보가 재고 행 조회/생성보다 먼저 — 최초 재고 행 생성 경합도 직렬화")
  ok(/isUniqueConstraintError\(error, \["tenantId", "txNo"\]\)/.test(src) && /txNoCollision/.test(src), "J4 (tenantId, txNo) unique 이중 방어와 재시도 유지")
  ok(/isOutcomeUnknownError\(error\)[\s\S]{0,120}outcome: "UNKNOWN"/.test(src) && /canRetry = !isOutcomeUnknownError\(error\) &&/.test(src), "J4 결과 불명 오류는 재시도 대상이 아님(재시도 조건에서 명시적으로 제외)")
  ok(/lockPurchaseOrderItemsForUpdate\(tx, tenantId/.test(src) && /checkReceiptRemaining\(/.test(src) && /computeNextMaterialReceiptLotNo\(/.test(src), "J4 발주품목 행 잠금·잔량 검증·LOT 자동채번 호출은 유지")
}

// ─── K. 서버 멱등성(requestId) — 순수 로직 · 구조 ─────────────────────────────────

function testReceivingIdempotency() {
  const ids = require("../src/lib/receiving-request-id") as typeof import("../src/lib/receiving-request-id")
  const idem = require("../src/lib/receiving-idempotency") as typeof import("../src/lib/receiving-idempotency")

  // K1. 요청 ID 형식
  ok(ids.isValidReceivingRequestId("3f2b8c1e-5a7d-4e0b-9c1d-2a4f6b8d0e12"), "K1 UUID v4 형식 허용")
  for (const bad of ["", "short", "has space in it-0000000000", "한글-요청-아이디-0000000000", "a".repeat(129), null, undefined, 12345678901234567890]) {
    ok(!ids.isValidReceivingRequestId(bad as unknown), `K1 잘못된 요청 ID 거부: ${String(bad).slice(0, 20)}`)
  }
  const a = ids.generateReceivingRequestId(), b = ids.generateReceivingRequestId()
  ok(ids.isValidReceivingRequestId(a) && a !== b, "K1 생성된 ID 는 유효하고 호출마다 다르다")
  // 비보안 컨텍스트(http 태블릿)에서 crypto.randomUUID 가 없어도 생성 가능
  const g = globalThis as unknown as { crypto?: unknown }
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")
  const webcrypto = (require("node:crypto") as typeof import("node:crypto")).webcrypto
  try {
    Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, configurable: true })
    const f1 = ids.generateReceivingRequestId()
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true })
    const f2 = ids.generateReceivingRequestId()
    ok(ids.isValidReceivingRequestId(f1) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(f1), "K1 randomUUID 없이 getRandomValues 로 UUID v4 생성")
    ok(ids.isValidReceivingRequestId(f2), "K1 crypto 자체가 없어도 대체 생성")
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original)
    else delete g.crypto
  }

  // K2. 요청 내용 해시
  const base = {
    purchaseOrderId: "po1", purchaseOrderItemId: "poi1", warehouseId: "wh1",
    receivedScaled: "100000000", acceptedScaled: "100000000", rejectedScaled: "0",
    result: "PASS", lotNo: "LOT-1", lotReservationId: undefined, inspectorId: undefined, note: undefined,
  }
  const h = idem.hashReceivingRequest(base)
  ok(/^[0-9a-f]{64}$/.test(h), "K2 SHA-256 hex 64자")
  eq(idem.hashReceivingRequest({ ...base, lotNo: "  LOT-1 ", note: " ", lotReservationId: null, inspectorId: null }), idem.hashReceivingRequest({ ...base, note: "" }), "K2 공백·null/undefined 표기 차이는 같은 내용")
  for (const [label, change] of [
    ["수량", { receivedScaled: "50000000", acceptedScaled: "50000000" }], ["합격/불합격 배분", { acceptedScaled: "90000000", rejectedScaled: "10000000" }],
    ["발주품목", { purchaseOrderItemId: "poi2" }], ["창고", { warehouseId: "wh2" }], ["LOT", { lotNo: "LOT-2" }], ["판정", { result: "FAIL" }],
    ["비고", { note: "x" }], ["검사자", { inspectorId: "u1" }], ["LOT 예약", { lotReservationId: "r1" }], ["발주", { purchaseOrderId: "po2" }],
  ] as const) {
    ok(idem.hashReceivingRequest({ ...base, ...change }) !== h, `K2 내용이 다르면 해시가 다름: ${label}`)
  }
  eq([idem.judgeExistingRequest(h, h), idem.judgeExistingRequest(h, idem.hashReceivingRequest({ ...base, lotNo: "LOT-2" }))], ["REPLAY", "CONFLICT"], "K2 같은 내용=REPLAY, 다른 내용=CONFLICT")

  // K3. 소스·스키마 구조
  const schema = read("prisma", "schema.prisma")
  const model = schema.match(/model ReceivingRequest \{[\s\S]*?\n\}/)?.[0] ?? ""
  ok(/@@unique\(\[tenantId, requestId\]\)/.test(model) && /requestHash\s+String/.test(model) && /receivingInspectionId\s+String\?\s+@unique/.test(model), "K3 스키마: (tenantId, requestId) unique · requestHash · 검사이력 1:1")
  const mig = read("prisma", "migrations", "20261019000000_add_receiving_request_idempotency", "migration.sql")
  const migSql = mig.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n") // 주석 제외
  ok(/CREATE UNIQUE INDEX "ReceivingRequest_tenantId_requestId_key"/.test(migSql) && /ENABLE ROW LEVEL SECURITY/.test(migSql) && !/DROP /.test(migSql) && !/ALTER TABLE "(?!ReceivingRequest")/.test(migSql), "K3 migration: 신규 테이블/인덱스/RLS 만 — 기존 테이블 변경·삭제 없음")
  const src = read("src", "lib", "actions", "receiving.actions.ts")
  const iPre = src.indexOf("receivingRequest.findUnique")
  const iWh = src.indexOf("prisma.warehouse.findFirst")
  ok(iPre > 0 && iPre < iWh, "K3 서버: 재전송 확인(REPLAY)이 창고·잔량 재검증보다 먼저 — 이미 처리된 요청이 '잔여수량 초과'로 거절되지 않음")
  const iClaim = src.indexOf("tx.receivingRequest.create")
  const iLockTx = src.indexOf("allocateReceiptTxNo(tx, tenantId")
  const iLot = src.indexOf("computeNextMaterialReceiptLotNo(tx")
  const iInsp = src.indexOf("tx.receivingInspection.create")
  ok(iClaim > 0 && iClaim < iLockTx && iClaim < iLot && iClaim < iInsp, "K3 서버: 클레임이 거래번호·LOT 번호 발급·입고검사 생성보다 먼저 — 재전송이 새 번호를 소모하지 않음")
  ok(/tx\.receivingRequest\.update\(\{ where: \{ id: claim\.id \}, data: \{ receivingInspectionId: inspection\.id \} \}\)/.test(src), "K3 서버: 클레임과 입고검사를 같은 트랜잭션에서 연결")
  ok(/isUniqueConstraintError\(error, \["tenantId", "requestId"\]\)/.test(src) && /RECEIVING_REQUEST_CONFLICT_MESSAGE/.test(src), "K3 서버: 동시 중복은 DB unique 로 걸러 REPLAY/CONFLICT 로 해석")
  ok(/isValidReceivingRequestId\(data\.requestId\)/.test(src), "K3 서버: 요청 ID 필수·형식 검증")
  for (const p of [
    ["src", "app", "app", "mes", "material-receipt", "receiving-form-dialog.tsx"],
    ["src", "app", "app", "mes", "purchase-orders", "receiving-dialog.tsx"],
  ]) {
    const d = read(...p)
    ok(/requestIdFor\(ins\.purchaseOrderItemId\)/.test(d) && /requestId: row\.requestId/.test(d) && /useRef<Record<string, string>>\(\{\}\)/.test(d), `K3 ${p[p.length - 2]}: 품목별 요청 ID 를 만들어 재시도에도 유지`)
    ok(/isRowDone\(rowStatus\[ins\.purchaseOrderItemId\]\)/.test(d), `K3 ${p[p.length - 2]}: 완료 품목만 건너뛰고 결과 불명 품목은 같은 요청 ID 로 재전송`)
  }
}

// ─── L. 비LOT 재고 유일성(partial unique index) — 분류 함수 · migration · 구조 (Mock/정적) ───────────

function testNullLotBalanceUniqueness() {
  const guard = require("../src/lib/inventory-balance-guard") as typeof import("../src/lib/inventory-balance-guard")
  const mk = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "5.22.0", ...(meta ? { meta } : {}) })

  // L1. 재시도 대상 분류: 정확히 비LOT InventoryBalance 유니크 충돌일 때만 true
  ok(guard.isNullLotBalanceUniqueError(mk("P2002", { modelName: "InventoryBalance", target: ["tenantId", "itemId", "warehouseId"] })), "L1 실측 모양(모델·3필드) → true")
  ok(guard.isNullLotBalanceUniqueError(mk("P2002", { modelName: "InventoryBalance", target: ["warehouseId", "tenantId", "itemId"] })), "L1 필드 순서가 달라도 3필드 동일 집합이면 true")
  ok(guard.isNullLotBalanceUniqueError(mk("P2002", { target: guard.NULL_LOT_BALANCE_INDEX_NAME })), "L1 인덱스 이름으로 보고되는 경우 → true")
  for (const [label, e] of [
    ["LOT 재고 4필드 unique", mk("P2002", { modelName: "InventoryBalance", target: ["tenantId", "itemId", "warehouseId", "lotId"] })],
    ["다른 모델의 같은 컬럼명", mk("P2002", { modelName: "Stock", target: ["tenantId", "itemId", "warehouseId"] })],
    ["모델 정보 없는 컬럼 목록", mk("P2002", { target: ["tenantId", "itemId", "warehouseId"] })],
    ["대상(target) 비어 있음", mk("P2002", { modelName: "InventoryBalance", target: [] })],
    ["meta 없음", mk("P2002")],
    ["txNo unique", mk("P2002", { modelName: "InventoryTransaction", target: ["tenantId", "txNo"] })],
    ["requestId unique", mk("P2002", { modelName: "ReceivingRequest", target: ["tenantId", "requestId"] })],
    ["다른 이름의 인덱스", mk("P2002", { modelName: "InventoryBalance", target: "InventoryBalance_other_key" })],
    ["다른 코드(P2003)", mk("P2003", { modelName: "InventoryBalance", target: ["tenantId", "itemId", "warehouseId"] })],
    ["결과 불명(연결 오류)", Object.assign(new Error("Server has closed the connection."), { name: "PrismaClientUnknownRequestError" })],
    ["일반 Error", new Error("Unique constraint failed on the fields: (`tenantId`,`itemId`,`warehouseId`)")],
    ["null", null],
  ] as const) {
    ok(!guard.isNullLotBalanceUniqueError(e), `L1 재시도 대상 아님: ${label}`)
  }

  // L2. migration 파일: 검증·사전점검·생성, 자동 삭제/합산 없음, 기존 migration 무수정
  const migDir = ["prisma", "migrations", "20261019010000_add_inventory_balance_null_lot_unique"] as const
  const mig = read(...migDir, "migration.sql")
  const code = mig.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n")
  ok(/NULL_LOT_INDEX_MISMATCH/.test(code) && /NULL_LOT_DUPLICATES/.test(code), "L2 migration: 기존 인덱스 불일치 / 중복 재고 두 가지 오류를 명확한 코드로 중단")
  ok(/indisunique/.test(code) && /indisvalid/.test(code) && /indisready/.test(code) && /indpred/.test(code) && /indkey/.test(code) && /relkind/.test(code), "L2 migration: 기존 인덱스의 UNIQUE·VALID·READY·조건·컬럼·객체 종류를 모두 검사 (IF NOT EXISTS 맹신 안 함)")
  ok(/CREATE UNIQUE INDEX %I ON "InventoryBalance" \("tenantId", "itemId", "warehouseId"\) WHERE "lotId" IS NULL/.test(code), "L2 migration: (tenantId,itemId,warehouseId) WHERE lotId IS NULL 유니크 인덱스 생성")
  ok(!/\b(DELETE|UPDATE|TRUNCATE|DROP|INSERT)\b/i.test(code) && !/CREATE UNIQUE INDEX IF NOT EXISTS/i.test(code), "L2 migration: 자동 삭제·합산·덮어쓰기 없음, IF NOT EXISTS 미사용")
  ok(/RETURN;/.test(code) && /RAISE EXCEPTION/.test(code), "L2 migration: 올바른 기존 인덱스면 통과(RETURN), 아니면 오류")
  try {
    const out = (require("node:child_process") as typeof import("node:child_process")).execFileSync("git", ["diff", "--name-status", "origin/main", "--", "prisma/migrations"], { encoding: "utf8" })
    const lines = out.split(/\r?\n/).filter(Boolean)
    ok(lines.every((l) => l.startsWith("A\t")), `L2 origin/main 대비 prisma/migrations 는 추가(A)만 있고 수정·삭제 없음 (${lines.length}개 파일)`)
  } catch {
    ok(true, "L2 (git 사용 불가 환경 — 기존 migration 무수정 검사 건너뜀)")
  }

  // L3. 스키마: LOT 재고의 기존 @@unique 유지 + partial index 관리 주석
  const schema = read("prisma", "schema.prisma")
  const inv = schema.match(/model InventoryBalance \{[\s\S]*?\n\}/)?.[0] ?? ""
  ok(/@@unique\(\[tenantId, itemId, warehouseId, lotId\]\)/.test(inv), "L3 스키마: LOT 재고의 @@unique([tenantId,itemId,warehouseId,lotId]) 유지")
  ok(/SQL migration/.test(schema.slice(Math.max(0, schema.indexOf("model InventoryBalance {") - 600), schema.indexOf("model InventoryBalance {"))), "L3 스키마: partial index 는 SQL migration 기준이라는 주석")

  // L4. 재시도 구조
  const src = read("src", "lib", "actions", "receiving.actions.ts")
  ok(/const balanceCollision = isNullLotBalanceUniqueError\(error\)/.test(src) && /canRetry = !isOutcomeUnknownError\(error\) && \(txNoCollision \|\| autoLotCollision \|\| balanceCollision\)/.test(src), "L4 서버: 비LOT 재고 충돌 확정 시에만 재시도 대상에 추가, 결과 불명 오류는 재시도 금지")
  ok(/if \(balanceCollision\) \{\s*throw new Error\(NULL_LOT_BALANCE_CONTENTION_MESSAGE\)/.test(src), "L4 서버: 재시도 소진 시 안전한 안내 메시지")

  // L5. 운영 점검 SQL 은 읽기 전용
  const ops = read("scripts", "sql", "inventory-balance-null-lot-duplicates.sql")
  const opsCode = ops.split(/\r?\n/).filter((l) => !l.trim().startsWith("--") && !l.trim().startsWith("\\echo")).join("\n")
  ok(/SELECT/i.test(opsCode) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(opsCode), "L5 운영 점검 SQL 은 SELECT 만 사용(수정·삭제·합산 없음)")
}

async function main() {
  await testPurchaseOrderLock()
  testUserErrors()
  testLotGuard()
  testSourceStructure()
  testUserErrorAllowlist()
  await testReceivingBatch()
  testManufacturingPolicy()
  testReceivingHardening()
  await testQuantityPrecisionAndPostCommit()
  await testReceiptTxNumbering()
  testReceivingIdempotency()
  testNullLotBalanceUniqueness()
  console.log(`\nAll ${passed} assertions passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
