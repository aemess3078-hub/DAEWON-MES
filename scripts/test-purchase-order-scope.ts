/**
 * 일반 발주 조회 범위(note=NULL 포함, 외주발주 제외) 테스트 — DB 접속 없음.
 * 실행: npm run test:purchase-order-scope
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { generalPurchaseOrderWhere, isGeneralPurchaseOrder } from "../src/lib/purchase-order-scope"

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}

ok(isGeneralPurchaseOrder({ orderNo: "PO-2026-000001", note: null }), "note=NULL → 일반 발주 포함")
ok(isGeneralPurchaseOrder({ orderNo: "PO-2026-000001", note: "" }), 'note="" → 일반 발주 포함')
ok(isGeneralPurchaseOrder({ orderNo: "PO-2026-000001", note: "긴급 납품" }), "일반 비고 문자열 → 포함")
ok(!isGeneralPurchaseOrder({ orderNo: "PO-2026-000001", note: "[OUTSOURCING] 도금" }), "[OUTSOURCING] note → 제외")
ok(!isGeneralPurchaseOrder({ orderNo: "PO-2026-000001", note: "앞 메모\n[OUTSOURCING] 도금" }), "note 중간의 [OUTSOURCING] → 제외")
ok(!isGeneralPurchaseOrder({ orderNo: "OS-2026-000001", note: null }), "OS- 접두어(note=NULL) → 제외")

// where 절 구조: note 가 NULL 인 경우를 명시적으로 허용해야 한다(NOT contains 만으로는 NULL 행이 사라진다).
const where = JSON.stringify(generalPurchaseOrderWhere)
ok(where.includes('"note":null') && where.includes("[OUTSOURCING]") && where.includes("OS-"), "where 절이 note NULL 허용 + 외주 제외 조건을 모두 포함")

// 두 조회 함수가 공통 조건을 쓰고, note 에 NOT contains 만 쓰는 옛 패턴이 없어야 한다.
const src = readFileSync(join(__dirname, "..", "src", "lib", "actions", "purchase-order.actions.ts"), "utf8")
ok((src.match(/\.\.\.generalPurchaseOrderWhere/g) ?? []).length === 2, "getPurchaseOrders / getPendingPurchaseOrdersForReceipt 모두 공통 조건 사용")
ok(!/NOT:\s*\[[^\]]*note:\s*\{\s*contains/.test(src), "NULL 을 누락시키는 옛 NOT-contains 패턴 없음")
ok(/getPendingPurchaseOrdersForReceipt\(tenantId: string, siteId: string\)[\s\S]*?tenantId,\s*\n\s*siteId,/.test(src), "입고 대기 조회는 tenant·site 한정 유지")

console.log(`\n${passed} passed`)
