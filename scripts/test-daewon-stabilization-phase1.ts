/**
 * 대원정밀 MES 1차 안정화 회귀 테스트 (DB 연결 없음 — Fake/Mock + 소스 구조 검사)
 *
 *  A. 발주번호 채번 잠금: Prisma $queryRaw 의 PostgreSQL `void` 역직렬화 오류 회귀 + 동시성/테넌트 분리
 *  B. 사용자 오류 메시지: Prisma/DB 내부 정보 비노출, 업무 메시지 유지
 *  C. 대원정밀 LOT/제조번호 자동 채번 가드 유지(규칙 미확정 → fail-closed) + 수동 입력 허용
 *  D. 소스 구조: 액션 반환 계약, 클라이언트 결과 처리, 자재출고 경고 아이콘 겹침 제거, 재고 차감 로직 불변
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
  ok(/const result = await createReceivingInspection\([\s\S]*?if \(!result\.success\)/.test(rcvDialog), "D5 발주 입고 다이얼로그가 실패 결과를 무시하지 않음(성공으로 닫히던 결함 수정)")
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

async function main() {
  await testPurchaseOrderLock()
  testUserErrors()
  testLotGuard()
  testSourceStructure()
  console.log(`\nAll ${passed} assertions passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
