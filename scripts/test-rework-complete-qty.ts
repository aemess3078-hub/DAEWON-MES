import assert from "node:assert/strict"
import fs from "node:fs"
import { clampMergedInput, computeScrapQty, resolveReworkCompletion } from "../src/lib/rework-complete-qty"

// 기본값: 전체 복귀 → 폐기 0, 완료 처리 가능
assert.equal(computeScrapQty("10", 10), 0)
assert.deepEqual(resolveReworkCompletion("10", 10), { ok: true, mergedQty: 10, scrapQty: 0 })
// 일부 복귀 → 폐기 자동 계산
assert.equal(computeScrapQty("6", 10), 4)
assert.deepEqual(resolveReworkCompletion("6", 10), { ok: true, mergedQty: 6, scrapQty: 4 })
// 복귀 0 → 전량 폐기 가능
assert.deepEqual(resolveReworkCompletion("0", 10), { ok: true, mergedQty: 0, scrapQty: 10 })
// 소수 정밀도
assert.equal(computeScrapQty("0.1", 0.3), 0.2)
assert.equal(computeScrapQty("2.5", 4), 1.5)
// 빈 값/음수/초과/숫자 아님 → 제출 불가
for (const bad of ["", " ", "-1", "10.5", "abc"]) assert.equal(resolveReworkCompletion(bad, 10).ok, false, `거절: ${bad}`)
// 입력 보정: 음수 → 0, 초과 → 재작업 수량, 정상값 유지
assert.equal(clampMergedInput("-3", 10), "0")
assert.equal(clampMergedInput("11", 10), "10")
assert.equal(clampMergedInput("7", 10), "7")
assert.equal(clampMergedInput("", 10), "")
// 합계 불변식: 복귀 + 폐기 = 재작업 수량 (서버 검증 조건과 동일)
for (const merged of ["0", "1", "3.5", "9", "10"]) {
  const r = resolveReworkCompletion(merged, 10)
  assert.ok(r.ok && Math.abs(r.mergedQty + r.scrapQty - 10) < 1e-9)
}
// 팝업이 순수 함수와 읽기 전용 폐기 입력을 사용하는지, 서버 액션 호출 형태는 그대로인지
const dlg = fs.readFileSync("src/app/app/mes/rework/rework-complete-dialog.tsx", "utf8")
assert.match(dlg, /setMergedQty\(String\(itemQty\)\)/, "열릴 때 복귀 수량 기본값 = 전체 재작업 수량")
assert.match(dlg, /readOnly/, "폐기 수량 읽기 전용")
assert.match(dlg, /reworkWipUnitId: reworkItem\.id,\s*mergedQty: resolved\.mergedQty,\s*scrapQty: resolved\.scrapQty/, "completeRework 호출 형식 유지")
assert.ok(!/!scrapQty\}|!mergedQty \|\| !scrapQty/.test(dlg), "폐기 0 이어도 완료 처리 가능")
console.log("rework complete qty: passed")
