/**
 * 최종검사 화면 양품수량(ISSUE-02) 테스트(입고 기준 수량 헬퍼 + 소스 점검). 실행: npm run test:final-inspection-good-qty
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { computeWipReceiptStatus } from "../src/lib/actions/wip-receipt.helpers"

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

type Unit = Parameters<typeof computeWipReceiptStatus>[0]["wipUnits"][number]
const ops = (n: number, goodPerOp: number, finalExtra: Partial<{ reworkQty: number }> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `op${i + 1}`,
    seq: i + 1,
    completedQty: goodPerOp,
    productionResults: [{ id: `pr${i + 1}`, goodQty: goodPerOp, reworkQty: i === n - 1 ? finalExtra.reworkQty ?? 0 : 0 }],
  }))
function root(qty: number, opId: string, status: string, movements: Unit["movements"] = []): Unit {
  return {
    id: "root",
    workOrderOperationId: opId,
    parentWipUnitId: null,
    sourceProductionResultId: null,
    qty,
    status,
    movements,
    relatedMovements: [],
  }
}

// S01 WO-2026-003: 7공정 각 양품 20 → 공정 합산 140, 최종 양품 20
{
  const operations = ops(7, 20)
  const allOpsGood = operations.reduce((s, o) => s + o.productionResults.reduce((t, r) => t + r.goodQty, 0), 0)
  const status = computeWipReceiptStatus({ operations, finishedGoodsReceipts: [{ receiptQty: 20 }], wipUnits: [root(20, "op7", "COMPLETED")] })
  ok(allOpsGood === 140, "G1 (수정 전 표시) 7공정 양품 합산 = 140")
  ok(status.completedRootQty === 20 && !status.blocked, "G2 최종 양품(입고 기준) = 20")
}

// 최종공정 미완료(진행 중) → 최종 양품 0, 공정 합산은 0 이 아님
{
  const status = computeWipReceiptStatus({ operations: ops(3, 10), finishedGoodsReceipts: [], wipUnits: [root(10, "op2", "IN_PROCESS")] })
  ok(status.completedRootQty === 0, "G3 최종공정에 도달하지 않은 수량은 최종 양품에 포함하지 않음")
}

// 재작업 보류: 최종공정 양품 7, 재작업 분리 2(보류) → 입고 기준 7, 보류 2
{
  const child: Unit = { id: "rw", workOrderOperationId: "op2", parentWipUnitId: "root", sourceProductionResultId: "pr2", qty: 2, status: "REWORK", movements: [], relatedMovements: [{ id: "m1" }] }
  const operations = ops(2, 7, { reworkQty: 2 })
  const status = computeWipReceiptStatus({ operations, finishedGoodsReceipts: [], wipUnits: [root(7, "op2", "COMPLETED"), child] })
  ok(status.completedRootQty === 7 && status.reworkHoldQty === 2, "G4 재작업 보류 수량은 최종 양품에서 제외(별도 보류)")
}

// 재작업 양품 복귀(MERGE): 복귀분은 최종공정 실적에 없지만 입고 기준에는 포함
{
  const operations = ops(2, 7)
  const status = computeWipReceiptStatus({
    operations,
    finishedGoodsReceipts: [],
    wipUnits: [root(9, "op2", "COMPLETED", [{ movementType: "MERGE", relatedWipUnitId: "rw", qty: 2, sourceType: "ReworkCompletion" }])],
  })
  ok(status.completedRootQty === 9 && !status.blocked, "G5 재작업 양품 복귀분 포함(최종공정 실적 7 + 복귀 2 = 9)")
}

const actions = read("src/lib/actions/finished-goods.actions.ts")
const table = read("src/app/app/mes/final-inspection/final-inspection-data-table.tsx")
ok(!actions.includes("totalGoodQty"), "S1 공정 전체 양품 합산(totalGoodQty) 제거")
ok(table.includes("row.original.receiptBasisQty") && !table.includes("totalGoodQty"), "S2 최종검사 '양품 수량'은 입고 기준 수량 표시")
ok(actions.includes("? status.completedRootQty") && actions.includes(": legacyFinalOperationGoodQty"), "S3 입고 기준(WIP 추적=완료 root, 레거시=최종공정 양품) 불변")
ok(actions.includes("Math.max(0, receiptBasisQty - status.totalReceiptQty)"), "S4 입고 대기 수량 계산 불변(완제품입고·출하 영향 없음)")

console.log(`\n${pass} final inspection good quantity checks passed.`)
