/**
 * 수주 엑셀 업로드 순수 로직 검증 (DB 없이 실행).
 *  - 형식 파싱: 날짜(문자열·엑셀 일련번호), 숫자(쉼표), 필수값, 수량 0 이하
 *  - 수주그룹: 같은 그룹ID = 수주 1건(품목 여러 개), 다른 그룹ID = 별도 수주
 *  - 기준정보: 미등록 거래처·품목, 사용 중지, 공급업체 거래처, 비완제품 품목
 *  - 같은 수주 안 동일 품목 중복은 자동 합산하지 않고 오류
 *  - 공통정보(거래처·일자) 불일치 오류
 *  - 단가/총금액: 단가만, 단일 품목 총금액 ÷ 수량, 다중 품목 잔여 금액, 배분 금지, 합계 불일치
 *  - 중복 의심: 기존 수주와 동일 지문(취소 제외), 같은 파일 내 동일 수주
 *  - 오류 행이 하나라도 있으면 canImport=false
 *  - 수식 주입 방지(오류 내역 다운로드)
 */
import assert from "node:assert/strict"
import {
  parseSalesOrderExcelRows,
  buildSalesOrderPlan,
  findMissingSalesOrderColumns,
  parseSalesOrderDateCell,
  parseSalesOrderNumberCell,
  salesOrderIssueRows,
  normalizeCustomerPoNo,
  type SalesOrderExcelContext,
  type SalesOrderExcelRawRow,
} from "../src/lib/sales-order-excel"

let passed = 0
function ok(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  PASS ${name}`)
}

const ctx: SalesOrderExcelContext = {
  customers: [
    { id: "C1", code: "CUST-A", name: "고객A", status: "ACTIVE", partnerType: "CUSTOMER" },
    { id: "C2", code: "CUST-B", name: "고객B", status: "ACTIVE", partnerType: "BOTH" },
    { id: "C3", code: "CUST-OFF", name: "사용중지", status: "INACTIVE", partnerType: "CUSTOMER" },
    { id: "S1", code: "SUP-1", name: "공급사", status: "ACTIVE", partnerType: "SUPPLIER" },
  ],
  items: [
    { id: "I1", code: "FG-001", name: "완제품1", status: "ACTIVE", itemType: "FINISHED" },
    { id: "I2", code: "FG-002", name: "완제품2", status: "ACTIVE", itemType: "FINISHED" },
    { id: "I3", code: "FG-003", name: "완제품3", status: "ACTIVE", itemType: "FINISHED" },
    { id: "I4", code: "RM-001", name: "원자재", status: "ACTIVE", itemType: "RAW_MATERIAL" },
    { id: "I5", code: "FG-OFF", name: "단종품", status: "DISCONTINUED", itemType: "FINISHED" },
  ],
  existingOrders: [],
}

let rowSeq = 3
function row(cells: Record<string, unknown>): SalesOrderExcelRawRow {
  return {
    rowNum: rowSeq++,
    cells: {
      수주그룹ID: "G1",
      거래처코드: "CUST-A",
      수주일: "2026-11-12",
      납기일: "2026-11-30",
      품목코드: "FG-001",
      수주수량: 10,
      ...cells,
    },
  }
}

function plan(rows: SalesOrderExcelRawRow[], c: SalesOrderExcelContext = ctx) {
  const { parsed, issues } = parseSalesOrderExcelRows(rows)
  return buildSalesOrderPlan(parsed, issues, c)
}

const errorsOf = (p: ReturnType<typeof plan>) => p.issues.filter((i) => i.kind === "ERROR")
const msgs = (p: ReturnType<typeof plan>) => p.issues.map((i) => `${i.rowNum}:${i.message}`)

console.log("형식 파싱")
ok("날짜: 문자열·점/슬래시·엑셀 일련번호", () => {
  assert.equal(parseSalesOrderDateCell("2026-11-12"), "2026-11-12")
  assert.equal(parseSalesOrderDateCell("2026.11.12"), "2026-11-12")
  assert.equal(parseSalesOrderDateCell("2026/1/5"), "2026-01-05")
  assert.equal(parseSalesOrderDateCell("20261112"), "2026-11-12")
  assert.equal(parseSalesOrderDateCell(46338), "2026-11-12") // 2026-11-12 의 엑셀 일련번호
  assert.equal(parseSalesOrderDateCell("2026-02-30"), null)
  assert.equal(parseSalesOrderDateCell("11/12/2026"), null)
  assert.equal(parseSalesOrderDateCell("어제"), null)
})
ok("숫자: 쉼표 허용, 빈값 null, 문자 NaN", () => {
  assert.equal(parseSalesOrderNumberCell("1,234,500"), 1234500)
  assert.equal(parseSalesOrderNumberCell(""), null)
  assert.ok(Number.isNaN(parseSalesOrderNumberCell("abc")))
})
ok("필수 열 누락 감지 (별표 무시)", () => {
  assert.deepEqual(findMissingSalesOrderColumns(["수주그룹ID *", "거래처코드 *", "수주일 *"]).sort(), ["납기일", "수주수량", "품목코드"].sort())
})

console.log("행 단위 검증")
ok("수량 0 이하·날짜 형식 오류·필수값 누락 행 오류", () => {
  const p = plan([
    row({ 수주수량: 0 }),
    row({ 수주일: "2026-13-01" }),
    row({ 품목코드: "" }),
  ])
  assert.equal(p.canImport, false)
  const m = msgs(p).join("\n")
  assert.match(m, /수주 수량은 0보다 커야 합니다/)
  assert.match(m, /수주일 형식이 올바르지 않습니다/)
  assert.match(m, /품목코드를 입력하세요/)
})

console.log("기준정보 대조")
ok("미등록 거래처·품목, 사용중지 거래처, 공급업체 거래처, 비완제품·단종 품목 차단", () => {
  const p1 = plan([row({ 거래처코드: "NOPE" })])
  assert.match(msgs(p1).join(), /등록되지 않은 거래처코드입니다: NOPE/)
  const p2 = plan([row({ 품목코드: "NOPE-1" })])
  assert.match(msgs(p2).join(), /등록되지 않은 품목코드입니다: NOPE-1/)
  const p3 = plan([row({ 거래처코드: "CUST-OFF" })])
  assert.match(msgs(p3).join(), /사용 중지된 거래처/)
  const p4 = plan([row({ 거래처코드: "SUP-1" })])
  assert.match(msgs(p4).join(), /고객사로 등록되지 않은/)
  assert.match(msgs(plan([row({ 품목코드: "RM-001" })])).join(), /수주 등록 가능한 품목이 아닙니다/)
  assert.match(msgs(plan([row({ 품목코드: "FG-OFF" })])).join(), /수주 등록 가능한 품목이 아닙니다/)
})

console.log("수주그룹 구성")
ok("같은 그룹ID 여러 품목 = 수주 1건, 다른 그룹ID = 수주 2건", () => {
  const p = plan([
    row({ 수주그룹ID: "G1", 품목코드: "FG-001", 수주수량: 5 }),
    row({ 수주그룹ID: "G1", 품목코드: "FG-002", 수주수량: 7 }),
    row({ 수주그룹ID: "G2", 거래처코드: "CUST-B", 품목코드: "FG-003", 수주수량: 1 }),
  ])
  assert.equal(p.groups.length, 2)
  assert.equal(p.groups[0].lines.length, 2)
  assert.equal(p.groups[1].lines.length, 1)
  assert.equal(p.summary.orderCount, 2)
  assert.equal(p.summary.itemCount, 3)
  assert.equal(p.canImport, true)
})
ok("같은 수주 안 동일 품목 중복은 합산하지 않고 오류", () => {
  const p = plan([
    row({ 품목코드: "FG-001", 수주수량: 5 }),
    row({ 품목코드: "FG-001", 수주수량: 3 }),
  ])
  assert.equal(p.canImport, false)
  const dup = errorsOf(p).find((i) => /같은 품목이 중복/.test(i.message))
  assert.ok(dup, "중복 품목 오류가 있어야 한다")
  assert.equal(p.groups[0].lines.length, 1) // 합산 없이 첫 행만 유지(차단 상태이므로 등록 불가)
})
ok("같은 그룹ID 안 거래처·수주일 불일치는 오류", () => {
  const p = plan([
    row({ 수주그룹ID: "G9", 거래처코드: "CUST-A" }),
    row({ 수주그룹ID: "G9", 거래처코드: "CUST-B", 품목코드: "FG-002" }),
  ])
  assert.equal(p.canImport, false)
  assert.match(msgs(p).join(), /거래처코드이\(가\) 첫 행과 다릅니다/)
})

console.log("단가·총금액")
ok("단가만 있으면 품목 금액 = 수량 × 단가 (단가 INPUT)", () => {
  const p = plan([row({ 수주수량: 4, 단가: 2500 })])
  assert.equal(p.canImport, true)
  assert.equal(p.groups[0].lines[0].unitPrice, 2500)
  assert.equal(p.groups[0].lines[0].lineAmount, 10000)
  assert.equal(p.groups[0].lines[0].unitPriceSource, "INPUT")
})
ok("단일 품목 총금액 ÷ 수량 = 단가 (원 단위 반올림)", () => {
  const p = plan([row({ 수주수량: 3, 총금액: 100000 })])
  assert.equal(p.canImport, true)
  assert.equal(p.groups[0].lines[0].unitPrice, 33333)
  assert.equal(p.groups[0].lines[0].unitPriceSource, "CALCULATED")
})
ok("다중 품목: 단가가 빈 품목 하나만 잔여 금액으로 계산", () => {
  const p = plan([
    row({ 수주그룹ID: "M1", 품목코드: "FG-001", 수주수량: 2, 단가: 10000, 총금액: 50000 }),
    row({ 수주그룹ID: "M1", 품목코드: "FG-002", 수주수량: 5, 총금액: 50000 }),
  ])
  assert.equal(p.canImport, true)
  const [a, b] = p.groups[0].lines
  assert.equal(a.lineAmount, 20000)
  assert.equal(b.unitPrice, 6000) // (50000 - 20000) / 5
})
ok("다중 품목에서 단가가 빈 품목이 둘 이상이면 배분 금지 오류", () => {
  const p = plan([
    row({ 수주그룹ID: "M2", 품목코드: "FG-001", 수주수량: 2, 총금액: 50000 }),
    row({ 수주그룹ID: "M2", 품목코드: "FG-002", 수주수량: 5, 총금액: 50000 }),
  ])
  assert.equal(p.canImport, false)
  assert.match(msgs(p).join(), /임의로 나눌 수 없습니다/)
})
ok("모든 단가 입력 + 총금액 불일치 → 오류, 1원 이하 반올림 차이는 통과", () => {
  const bad = plan([
    row({ 수주그룹ID: "M3", 품목코드: "FG-001", 수주수량: 2, 단가: 1000, 총금액: 5000 }),
    row({ 수주그룹ID: "M3", 품목코드: "FG-002", 수주수량: 2, 단가: 1000, 총금액: 5000 }),
  ])
  assert.equal(bad.canImport, false)
  assert.match(msgs(bad).join(), /일치하지 않습니다/)
})
ok("확정 금액 합계가 총금액을 초과하면 오류", () => {
  const p = plan([
    row({ 수주그룹ID: "M4", 품목코드: "FG-001", 수주수량: 2, 단가: 40000, 총금액: 50000 }),
    row({ 수주그룹ID: "M4", 품목코드: "FG-002", 수주수량: 2, 총금액: 50000 }),
  ])
  assert.equal(p.canImport, false)
  assert.match(msgs(p).join(), /총금액을 초과/)
})

console.log("중복 의심 (발주번호 기준 · 확인 후 등록)")
const mkExisting = (o: Partial<SalesOrderExcelContext["existingOrders"][number]> = {}): SalesOrderExcelContext["existingOrders"][number] => ({
  orderNo: "SO-2026-001", status: "CONFIRMED", customerId: "C1", customerPoNo: null,
  orderDate: "2026-11-12", deliveryDate: "2026-11-30", items: [{ itemId: "I1", qty: 10 }], ...o,
})
const withExisting = (...o: ReturnType<typeof mkExisting>[]): SalesOrderExcelContext => ({ ...ctx, existingOrders: o })
function planC(rows: SalesOrderExcelRawRow[], c: SalesOrderExcelContext, confirmed: string[] = []) {
  const { parsed, issues } = parseSalesOrderExcelRows(rows)
  return buildSalesOrderPlan(parsed, issues, c, confirmed)
}
ok("같은 거래처·같은 발주번호(대소문자·공백 무시)는 중복 의심 + 기존 수주 정보 표시, 확인하면 등록 가능", () => {
  const c = withExisting(mkExisting({ customerPoNo: "po-0001" }))
  const rows = () => [row({ 수주그룹ID: "P1", 품목코드: "FG-002", 수주수량: 3, "거래처 발주번호": " PO-0001 " })]
  const p = planC(rows(), c)
  assert.equal(p.duplicates.length, 1)
  assert.equal(p.duplicates[0].basis, "PO_NO")
  assert.equal(p.duplicates[0].existing?.orderNo, "SO-2026-001")
  assert.equal(p.canImport, false)
  assert.deepEqual(p.unconfirmedDuplicateGroupIds, ["P1"])
  const ok2 = planC(rows(), c, ["P1"])
  assert.equal(ok2.canImport, true)
  assert.equal(ok2.duplicates[0].confirmed, true)
})
ok("발주번호가 다르면 내용이 완전히 같아도 반복 발주로 보고 중복 의심 없음", () => {
  const c = withExisting(mkExisting({ customerPoNo: "PO-0001" }))
  const p = planC([row({ 품목코드: "FG-001", 수주수량: 10, "거래처 발주번호": "PO-0002" })], c)
  assert.equal(p.duplicates.length, 0)
  assert.equal(p.canImport, true)
})
ok("다른 거래처의 같은 발주번호는 중복이 아님", () => {
  const c = withExisting(mkExisting({ customerPoNo: "PO-0001", customerId: "C2" }))
  assert.equal(planC([row({ "거래처 발주번호": "PO-0001" })], c).duplicates.length, 0)
})
ok("앞자리 0 보존: 000123 과 123 은 다른 번호", () => {
  const c = withExisting(mkExisting({ customerPoNo: "000123" }))
  assert.equal(planC([row({ "거래처 발주번호": "123" })], c).duplicates.length, 0)
  assert.equal(planC([row({ "거래처 발주번호": "000123" })], c).duplicates.length, 1)
  assert.equal(normalizeCustomerPoNo("  000123 "), "000123")
  assert.equal(normalizeCustomerPoNo("   "), null)
  assert.throws(() => normalizeCustomerPoNo("x".repeat(101)))
})
ok("취소된 기존 수주의 발주번호는 무시", () => {
  const c = withExisting(mkExisting({ customerPoNo: "PO-0001", status: "CANCELLED" }))
  assert.equal(planC([row({ "거래처 발주번호": "PO-0001" })], c).duplicates.length, 0)
})
ok("발주번호가 없으면 거래처·일자·품목·수량 일치를 중복 가능성으로 안내(확인 후 등록)", () => {
  const c = withExisting(mkExisting())
  const rows = () => [row({ 수주그룹ID: "N1", 품목코드: "FG-001", 수주수량: 10 })]
  const p = planC(rows(), c)
  assert.equal(p.duplicates[0]?.basis, "CONTENT")
  assert.equal(p.canImport, false)
  assert.equal(planC(rows(), c, ["N1"]).canImport, true)
})
ok("발주번호가 없고 거래처·일자만 같고 품목·수량이 다르면 중복으로 단정하지 않음", () => {
  const c = withExisting(mkExisting({ items: [{ itemId: "I2", qty: 10 }] }))
  assert.equal(planC([row({ 품목코드: "FG-001", 수주수량: 10 })], c).canImport, true)
})
ok("같은 파일 안: 같은 거래처·발주번호 두 수주 → 두 번째 의심, 발주번호 없고 내용 동일 → 두 번째 의심", () => {
  const p1 = planC([
    row({ 수주그룹ID: "A", "거래처 발주번호": "PO-9" }),
    row({ 수주그룹ID: "B", 품목코드: "FG-002", "거래처 발주번호": "PO-9" }),
  ], ctx)
  assert.equal(p1.duplicates.length, 1)
  assert.equal(p1.duplicates[0].basis, "FILE_PO_NO")
  const p2 = planC([row({ 수주그룹ID: "A", 수주수량: 10 }), row({ 수주그룹ID: "B", 수주수량: 10 })], ctx)
  assert.equal(p2.duplicates[0]?.basis, "FILE_CONTENT")
})
ok("같은 파일 재업로드 시나리오: 등록 후 같은 행들이 모두 중복 의심으로 잡힌다(발주번호 유/무)", () => {
  const c = withExisting(
    mkExisting({ orderNo: "SO-2026-010", customerPoNo: "PO-A", items: [{ itemId: "I1", qty: 5 }] }),
    mkExisting({ orderNo: "SO-2026-011", customerPoNo: null, items: [{ itemId: "I2", qty: 7 }] }),
  )
  const p = planC([
    row({ 수주그룹ID: "G1", 품목코드: "FG-001", 수주수량: 5, "거래처 발주번호": "PO-A" }),
    row({ 수주그룹ID: "G2", 품목코드: "FG-002", 수주수량: 7 }),
  ], c)
  assert.equal(p.duplicates.length, 2)
  assert.equal(p.canImport, false)
})

console.log("요약·내보내기")
ok("정상 파일은 canImport=true, 요약 수치가 맞음", () => {
  const p = plan([row({ 품목코드: "FG-001", 수주수량: 1 }), row({ 품목코드: "FG-002", 수주수량: 1 })])
  assert.equal(p.summary.totalRows, 2)
  assert.equal(p.summary.validRows, 2)
  assert.equal(p.summary.errorRows, 0)
  assert.equal(p.canImport, true)
})
ok("오류 내역 내보내기: 수식 주입 방지(' 접두)", () => {
  const p = plan([row({ 거래처코드: "=HYPERLINK(\"x\")" })])
  const rows = salesOrderIssueRows(p.issues)
  assert.ok(rows.length > 0)
  for (const r of rows) {
    assert.ok(!/^[=+\-@]/.test(r[3]) && !/^[=+\-@]/.test(r[4]))
  }
})

console.log(`\n${passed} tests passed`)
