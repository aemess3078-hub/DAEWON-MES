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
import { DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE, isCnsLotRuleAllowed } from "../src/lib/lot-numbering/lot-brand-guard"
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
  constructor(init: Record<string, { ordered: number; received?: number }>) {
    for (const [id, v] of Object.entries(init)) this.items.set(id, { ordered: v.ordered, received: v.received ?? 0 })
  }
  async receive(id: string, receivedQty: number, acceptedQty: number): Promise<{ success: boolean; message?: string }> {
    this.calls.push(id)
    if (this.throwOnce.delete(id)) throw new Error("fetch failed") // 응답 없음(처리 여부 불명)
    if (this.failOnce.delete(id)) return { success: false, message: "선택한 창고를 찾을 수 없습니다." }
    const it = this.items.get(id)!
    const remaining = it.ordered - it.received
    if (receivedQty > remaining) return { success: false, message: `입고수량은 잔여수량을 초과할 수 없습니다. 잔여수량: ${remaining}` }
    it.received += acceptedQty
    return { success: true }
  }
}

async function testReceivingBatch() {
  const { runReceivingBatch, applyReceiptToQuantities, isRowLocked } = receivingBatchModule
  const rows = [
    { purchaseOrderItemId: "A", receivedInput: 40, acceptedInput: 40 },
    { purchaseOrderItemId: "B", receivedInput: 10, acceptedInput: 10 },
    { purchaseOrderItemId: "C", receivedInput: 0, acceptedInput: 0 },
  ]
  const mk = () => new FakeReceivingServer({ A: { ordered: 100 }, B: { ordered: 50 }, C: { ordered: 20 } })
  const submitTo = (srv: FakeReceivingServer) => (r: { purchaseOrderItemId: string; receivedInput: number; acceptedInput: number }) =>
    srv.receive(r.purchaseOrderItemId, r.receivedInput, r.acceptedInput)

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

  // F4. 응답 불명(throw): 처리 여부를 알 수 없으므로 자동 재전송하지 않는다
  {
    const srv = mk()
    srv.throwOnce.add("A")
    const first = await runReceivingBatch(rows, {}, submitTo(srv))
    eq(first.statuses.A?.state, "unknown", "F4 응답 불명 기록")
    ok(isRowLocked(first.statuses.A), "F4 결과 불명 품목은 잠금")
    const again = await runReceivingBatch(rows, first.statuses, submitTo(srv))
    eq(srv.calls, ["A", "B"], "F4 불명 품목 A 는 재시도 때 서버로 보내지 않음(B 는 진행)")
    eq(again.allDone, false, "F4 불명 품목이 남아 있으면 자동으로 닫지 않음")
    const a = first.statuses.A
    ok(a !== undefined && a.state === "unknown" && a.message.includes("중복 입고"), "F4 불명 안내 문구")
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
  ok(/data\.receivedQty > lockedRemainingQty/.test(server) && /lockPurchaseOrderItemsForUpdate/.test(server), "F8 서버 입고 트랜잭션의 행 잠금 + 잔량 재검증은 변경되지 않음")
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
    eq(D(t, "ALLOWED", ""), { kind: "ERROR", message: DAEWON_LOT_RULE_NOT_CONFIGURED_MESSAGE }, `G2 ${t}/ALLOWED 미입력 → 규칙 미설정 안내`)
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

async function main() {
  await testPurchaseOrderLock()
  testUserErrors()
  testLotGuard()
  testSourceStructure()
  testUserErrorAllowlist()
  await testReceivingBatch()
  testManufacturingPolicy()
  console.log(`\nAll ${passed} assertions passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
