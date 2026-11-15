/**
 * POP 작업 화면 잔여수량 표시(ISSUE-03) 단위 테스트(순수 로직 + 소스 점검). 실행: npm run test:pop-remaining-qty
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { computePopRemaining } from "../src/lib/pop/remaining-qty"

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")

const base = { status: "IN_PROGRESS", materialMaxAdditional: null as number | null }

// S02 WO-2026-004 2공정: 계획 50, 완료 20(양품 20, 불량 0), root WIP 50 → 투입 가능 50 − 20 = 30
{
  const r = computePopRemaining({ ...base, plannedQty: 50, completedQty: 20, availableWipQty: 30 })
  ok(r.effectiveRemaining === 30, "R1 S02 2공정 잔여수량 30 (이전 표시 10)")
  ok(!r.hasWipShortfall, "R2 불량 0 이면 '전공정 불량' 경고 없음")
}

// 전공정 불량 5 → root 45, 이 공정 양품 20 → 투입 가능 25 < 계획 잔여 30
{
  const r = computePopRemaining({ ...base, plannedQty: 50, completedQty: 20, availableWipQty: 25 })
  ok(r.hasWipShortfall && r.effectiveRemaining === 25, "R3 전공정 불량이 있으면 경고 유지, 잔여 25로 제한")
}

// 이 공정에서 양품 15 + 불량 5 등록 → 완료 20, root 45, 투입 가능 45 − 15 = 30 = 계획 잔여 30
{
  const r = computePopRemaining({ ...base, plannedQty: 50, completedQty: 20, availableWipQty: 30 })
  ok(!r.hasWipShortfall && r.effectiveRemaining === 30, "R4 현재 공정 불량은 '전공정 불량' 경고로 표시하지 않음")
}

// 설비배정 경로: 배정 25, 배정 완료 20, 공정 전체 투입 가능 30 → 잔여 5
{
  const r = computePopRemaining({ ...base, plannedQty: 25, completedQty: 20, availableWipQty: 30 })
  ok(!r.hasWipShortfall && r.effectiveRemaining === 5, "R5 설비배정 잔여는 배정 기준")
}

{
  const r = computePopRemaining({ ...base, plannedQty: 50, completedQty: 20, availableWipQty: 30, materialMaxAdditional: 10 })
  ok(r.effectiveRemaining === 10 && r.hasMaterialShortfall && !r.hasWipShortfall, "R6 자재 기준 생산가능량 제한 유지")
}

{
  const r = computePopRemaining({ ...base, plannedQty: 50, completedQty: 50, availableWipQty: 0, status: "COMPLETED" })
  ok(r.effectiveRemaining === 0 && !r.hasWipShortfall, "R7 완료 공정은 잔여 0, 경고 없음")
}

{
  const r = computePopRemaining({ ...base, plannedQty: 50, completedQty: 0, availableWipQty: null })
  ok(r.effectiveRemaining === 50 && !r.hasWipShortfall, "R8 WIP 추적 없는 작업지시는 계획 기준")
}

{
  const r = computePopRemaining({ ...base, plannedQty: 0.3, completedQty: 0.1, availableWipQty: 0.2 })
  ok(r.effectiveRemaining === 0.2 && !r.hasWipShortfall, "R9 소수 수량(0.3 − 0.1)도 부동소수점 오차로 경고하지 않음")
}

// 서버 실적 검증과 같은 기준인지: 서버 허용치 = min(계획 − 완료, root − 이 공정 양품)
{
  let checked = 0
  let seed = 7
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  for (let wo = 0; wo < 300; wo += 1) {
    const planned = 10 + rand(90)
    let root = planned
    for (let opSeq = 1; opSeq <= 4 && root > 0; opSeq += 1) {
      let completed = 0
      let good = 0
      while (true) {
        const serverCap = Math.min(planned - completed, root - good)
        const r = computePopRemaining({ ...base, plannedQty: planned, completedQty: completed, availableWipQty: root - good })
        assert.equal(r.effectiveRemaining, Math.max(serverCap, 0), `wo${wo} op${opSeq} completed=${completed}`)
        assert.equal(r.hasWipShortfall, root - good < planned - completed)
        checked += 1
        if (serverCap <= 0) break
        const qty = 1 + rand(Math.min(serverCap, 15))
        const defect = rand(4) === 0 ? Math.min(qty, 1 + rand(2)) : 0
        completed += qty
        good += qty - defect
        root -= defect
      }
    }
  }
  ok(checked > 1000, `R10 ${checked}단계 시뮬레이션: 화면 잔여 = 서버 실적 허용치, 경고 = 실제 불량 차감 시에만`)
}

const client = read("src/app/pop/production/[operationId]/production-client.tsx")
ok(client.includes("computePopRemaining(") && !client.includes("availableWipQty - completedQty"), "S1 POP 화면은 공용 계산을 쓰고 완료수량을 이중 차감하지 않음")
ok(client.includes("전공정 불량으로 투입 가능 수량이 감소했습니다."), "S2 실제 전공정 불량 경고 문구 유지")
const pop = read("src/lib/actions/pop.actions.ts")
ok(pop.includes("Math.max(0, Number(rootWipForDisplay.qty) - Number(goodSoFarQty ?? 0))"), "S3 서버 availableWipQty = root − 이 공정 양품(기준 불변)")
ok(pop.includes("const availableInputScaled = rootQtyScaled - goodSoFarScaled"), "S4 서버 실적 검증 기준 불변")
ok(!/prisma|\.create\(|\.update\(/.test(read("src/lib/pop/remaining-qty.ts")), "S5 잔여수량 모듈은 DB 접근이 없는 표시 전용")

console.log(`\n${pass} POP remaining quantity checks passed.`)
