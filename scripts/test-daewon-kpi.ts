import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DAEWON_KPI_TARGETS,
  calcAchievementRate,
  calcImprovementRate,
  calcOnTimeRate,
  calcPpm,
  calcUph,
  dateKeyDiffDays,
  evaluateDeliveryLine,
  evaluateKpi,
  summarizeDelivery,
  summarizeProduction,
  validHours,
  type DeliveryLineInput,
  type ProductionFact,
  UPH_BASIS_OPERATION_SEQ,
} from "../src/lib/kpi/daewon-kpi"
import { DAEWON_ALLOWED_ROUTES, isRouteAllowed } from "../src/lib/auth/daewon-scope"

let passed = 0
function ok(cond: unknown, msg: string) {
  assert.ok(cond, msg)
  passed += 1
}
function near(a: number | null, b: number, msg: string, eps = 1e-6) {
  assert.ok(a != null && Math.abs(a - b) < eps, `${msg} (got ${a}, want ${b})`)
  passed += 1
}

// ── 기준값/목표값 (사업계획서 원본) ──
ok(DAEWON_KPI_TARGETS.uph.baseline === 39 && DAEWON_KPI_TARGETS.uph.target === 44.7, "UPH 기준/목표")
ok(DAEWON_KPI_TARGETS.ppm.baseline === 2897 && DAEWON_KPI_TARGETS.ppm.target === 2681, "PPM 기준/목표")
ok(DAEWON_KPI_TARGETS.onTime.baseline === 90 && DAEWON_KPI_TARGETS.onTime.target === 95.4, "납기준수율 기준/목표")
ok(Object.keys(DAEWON_KPI_TARGETS).length === 3, "KPI 는 3종만 (작업공수 제외)")

// ── 개선율 / 달성률 ──
near(calcImprovementRate(44.7, 39, "INCREASE"), (5.7 / 39) * 100, "증가 지표 개선율")
near(calcImprovementRate(2681, 2897, "DECREASE"), (216 / 2897) * 100, "감소 지표 개선율")
near(calcImprovementRate(3000, 2897, "DECREASE"), (-103 / 2897) * 100, "감소 지표 악화는 음수")
near(calcAchievementRate(44.7, 39, 44.7), 100, "목표 달성률 100")
near(calcAchievementRate(50.4, 39, 44.7), 200, "100% 초과 값 유지")
near(calcAchievementRate(2681, 2897, 2681), 100, "감소 지표 달성률 동일 식")
near(calcAchievementRate(2789, 2897, 2681), 50, "감소 지표 50%")
ok(calcAchievementRate(40, 5, 5) === null, "분모 0 → 계산 불가")
ok(calcImprovementRate(null, 39, "INCREASE") === null, "실적 없음 → 계산 불가")
ok(calcImprovementRate(10, 0, "INCREASE") === null, "기준 0 → 계산 불가")
ok(evaluateKpi("uph", null).status === "NO_DATA", "실적 없음 → NO_DATA")
ok(evaluateKpi("uph", 40).status === "NOT_ACHIEVED", "미달")
ok(evaluateKpi("uph", 44.7).status === "ACHIEVED", "달성")
ok(evaluateKpi("uph", 46).status === "EXCEEDED", "초과 달성")
ok(evaluateKpi("ppm", 2000).status === "EXCEEDED", "PPM 낮을수록 초과 달성")
ok(evaluateKpi("ppm", 3500).status === "NOT_ACHIEVED", "PPM 높으면 미달")
ok(evaluateKpi("onTime", 100).status === "EXCEEDED", "납기준수율 100% 초과 달성")

// ── UPH / PPM 기본식 ──
ok(calcUph(100, 0) === null && calcUph(100, -1) === null, "작업시간 0 이하 → null")
near(calcUph(90, 2), 45, "UPH = 양품/시간")
ok(calcPpm(0, 0) === null, "총수량 0 → null")
near(calcPpm(3, 1000), 3000, "PPM = 불량/(양품+불량)×1e6")
ok(calcOnTimeRate(0, 0) === null, "분모 0 → null")
near(calcOnTimeRate(3, 4), 75, "납기준수율")
ok(validHours(null, new Date()) === null, "시작 없음 → null")
ok(validHours(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")) === null, "0시간 → null")
near(validHours(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T01:30:00Z")), 1.5, "1.5h")

// ── 생산실적 집계 ──
function mk(o: Partial<ProductionFact>): ProductionFact {
  return {
  id: "r1", dateKey: "2026-11-01", orderNo: "WO-1", itemId: "i1", itemCode: "A", itemName: "품목A",
  processId: "p1", processName: "절단", equipmentId: "e1", equipmentName: "설비1",
  goodQty: 0, defectQty: 0, reworkQty: 0, hours: null, ...o,
  }
}
{
  const facts: ProductionFact[] = [
    mk({ id: "a", goodQty: 90, defectQty: 10, hours: 2 }),
    mk({ id: "a", goodQty: 90, defectQty: 10, hours: 2 }), // 중복 → 제외
    mk({ id: "b", goodQty: 100, defectQty: 0, hours: null }), // 시간 없음 → UPH 제외, PPM 포함
    mk({ id: "c", dateKey: "2026-12-02", itemId: "i2", itemCode: "B", itemName: "품목B", processId: "p2", processName: "연마", equipmentId: null, equipmentName: null, goodQty: 60, defectQty: 0, reworkQty: 5, hours: 1 }),
  ]
  const s = summarizeProduction(facts, "day")
  ok(s.resultCount === 3 && s.duplicateSkipped === 1, "중복 생산실적 제거")
  near(s.uph.goodQty, 150, "UPH 분자는 시간이 있는 실적만")
  near(s.uph.hours, 3, "UPH 분모")
  near(s.uph.value, 50, "UPH 합계")
  ok(s.uph.excludedCount === 1, "시간 미기록 실적 제외 건수")
  near(s.ppm.goodQty, 250, "PPM 양품 합")
  near(s.ppm.defectQty, 10, "PPM 불량 합(재작업 제외)")
  near(s.ppm.value, (10 / 260) * 1_000_000, "PPM 값")
  ok(s.ppm.reworkQty === 5, "재작업은 별도 표시")
  ok(s.uph.byProcess.length === 2 && s.uph.byItem.length === 2, "공정·품목별 집계")
  ok(s.uph.byEquipment.some((r) => r.key === "__none__"), "설비 미지정 구분")
  ok(s.uph.trend.length === 2 && s.uph.trend[0].bucket === "2026-11-01", "일별 추이")
  const m = summarizeProduction(facts, "month")
  ok(m.uph.trend.map((t) => t.bucket).join() === "2026-11,2026-12", "월별 추이")
  near(m.uph.trend[0].value, 45, "월별 값은 월 합계 재계산")
  // 상세 합계와 요약 일치
  near(s.uph.byProcess.reduce((x, r) => x + r.goodQty, 0), s.uph.goodQty, "공정별 합 = 요약")
  // 기준공정(uphBasis) 지정 시 UPH 는 기준공정 실적만 사용 — PPM 은 전체 공정 유지
  {
    const b = summarizeProduction([
      mk({ id: "h1", goodQty: 90, defectQty: 10, hours: 2, uphBasis: true }),
      mk({ id: "h2", goodQty: 90, defectQty: 0, hours: 2, uphBasis: true }),
      mk({ id: "p1", goodQty: 500, defectQty: 5, hours: 2, uphBasis: false }),
      mk({ id: "h3", goodQty: 30, defectQty: 0, hours: null, uphBasis: true }),
    ], "day")
    near(b.uph.value, 45, "기준공정만 UPH 계산 (180/4h)")
    ok(b.uph.validCount === 2 && b.uph.excludedCount === 1, "기준공정 중 시간 미기록만 제외")
    near(b.ppm.totalQty, 90 + 10 + 90 + 505 + 30, "PPM 은 전 공정 기준")
    ok(UPH_BASIS_OPERATION_SEQ === 10, "기준공정 순서 10")
  }
  near(s.ppm.byItem.reduce((x, r) => x + r.defectQty, 0), s.ppm.defectQty, "품목별 불량 합 = 요약")
  const empty = summarizeProduction([], "day")
  ok(empty.uph.value === null && empty.ppm.value === null, "실적 없음 → 데이터 없음(0 아님)")
}

// ── 납기준수율 ──
function line(o: Partial<DeliveryLineInput>): DeliveryLineInput {
  return {
  salesOrderItemId: "s1", orderNo: "SO-1", customerId: "c1", customerName: "고객1",
  itemId: "i1", itemCode: "A", itemName: "품목A", orderedQty: 100, dueKey: "2026-11-10", shipments: [], ...o,
  }
}
const TODAY = "2026-11-15"
ok(dateKeyDiffDays("2026-11-10", "2026-11-15") === 5 && dateKeyDiffDays("2026-02-28", "2026-03-01") === 1, "일수 차이")
ok(evaluateDeliveryLine(line({ dueKey: "2026-11-15" }), TODAY) === null, "납기 당일 미도래 제외")
ok(evaluateDeliveryLine(line({ dueKey: "2026-11-20" }), TODAY) === null, "납기 미도래 제외(미납품)")
ok(evaluateDeliveryLine(line({ dueKey: "2026-11-20", shipments: [{ id: "x", dateKey: "2026-11-12", qty: 100 }] }), TODAY) === null, "납기 미도래는 선출하여도 분모 제외")
{
  const r = evaluateDeliveryLine(line({ shipments: [{ id: "x", dateKey: "2026-11-10", qty: 100 }] }), TODAY)
  ok(r?.onTime === true && r.delayDays === 0, "납기 당일 완료 = 준수")
  const late = evaluateDeliveryLine(line({ shipments: [{ id: "x", dateKey: "2026-11-13", qty: 100 }] }), TODAY)
  ok(late?.state === "LATE_COMPLETED" && late.delayDays === 3, "지연 완료 3일")
  const open = evaluateDeliveryLine(line({}), TODAY)
  ok(open?.state === "LATE_OPEN" && open.delayDays === 5 && !open.onTime, "납기 경과 미납품은 미준수")
  // 분할 출하: 납기까지 일부만 → 최종 충족일이 납기 이후면 지연
  const split = evaluateDeliveryLine(line({ shipments: [{ id: "a", dateKey: "2026-11-09", qty: 60 }, { id: "b", dateKey: "2026-11-12", qty: 40 }] }), TODAY)
  ok(split?.state === "LATE_COMPLETED" && split.completedKey === "2026-11-12" && split.delayDays === 2, "분할 출하 — 납기 후 충족은 지연")
  const splitOk = evaluateDeliveryLine(line({ shipments: [{ id: "a", dateKey: "2026-11-08", qty: 60 }, { id: "b", dateKey: "2026-11-10", qty: 40 }] }), TODAY)
  ok(splitOk?.onTime === true, "분할 출하 — 납기 내 전량 충족은 준수")
  const partialOnly = evaluateDeliveryLine(line({ shipments: [{ id: "a", dateKey: "2026-11-08", qty: 60 }] }), TODAY)
  ok(partialOnly?.state === "LATE_OPEN" && partialOnly.shippedQty === 60, "일부만 출하하고 납기 경과 → 미준수")
  const dup = evaluateDeliveryLine(line({ shipments: [{ id: "a", dateKey: "2026-11-08", qty: 60 }, { id: "a", dateKey: "2026-11-08", qty: 60 }] }), TODAY)
  ok(dup?.shippedQty === 60, "동일 출하행 중복 집계 방지")
}
{
  const s = summarizeDelivery(
    [
      line({ salesOrderItemId: "1", shipments: [{ id: "x1", dateKey: "2026-11-09", qty: 100 }] }),
      line({ salesOrderItemId: "2", customerId: "c2", customerName: "고객2", itemId: "i2", itemName: "품목B", shipments: [{ id: "x2", dateKey: "2026-11-12", qty: 100 }] }),
      line({ salesOrderItemId: "3", dueKey: "2026-11-20" }), // 미도래 제외
      line({ salesOrderItemId: "4", dueKey: "2026-10-31" }), // 미납품 미준수
    ],
    TODAY,
    "month",
  )
  ok(s.dueCount === 3 && s.onTimeCount === 1 && s.lateCount === 2, "도래 3건 중 1건 준수")
  near(s.value, (1 / 3) * 100, "납기준수율 값")
  ok(s.lateOpenCount === 1 && s.lateCompletedCount === 1, "지연 구분")
  ok(s.byCustomer.length === 2, "거래처별 집계")
  ok(s.byCustomer.reduce((x, r) => x + r.dueCount, 0) === s.dueCount, "거래처별 합 = 요약")
  ok(s.lateRows[0].delayDays >= s.lateRows[1].delayDays, "지연 내역 지연일수 내림차순")
  ok(s.trend.length === 2, "월별 추이(10월·11월)")
  ok(summarizeDelivery([], TODAY, "day").value === null, "납기 도래 건 없음 → 데이터 없음")
}

// ── 메뉴 / 라우트 / 권한 ──
const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), "utf8")
const nav = read("src/lib/nav-config.ts")
const visible = nav.slice(0, nav.indexOf("export const DAEWON_HIDDEN_NAV"))
const hidden = nav.slice(nav.indexOf("export const DAEWON_HIDDEN_NAV"))
ok(/id: 'nav-kpi-dashboard', parentId: 'section-monitoring', label: 'KPI 대시보드'/.test(visible), "모니터링 하위 KPI 대시보드 메뉴")
ok(!hidden.includes("nav-kpi-dashboard"), "KPI 대시보드가 숨김 목록에 없음")
ok(DAEWON_ALLOWED_ROUTES.includes("/app/mes/kpi"), "KPI 라우트 허용 목록 포함")
ok(isRouteAllowed("/app/mes/kpi", { loginId: "user1", role: "OPERATOR" }), "일반 사용자 KPI 라우트 접근 허용")
const perm = read("src/lib/auth/role-permissions.ts")
ok(/kpi: "DASHBOARD"/.test(perm), "KPI 는 DASHBOARD 권한에 매핑")
const actions = read("src/lib/actions/daewon-kpi.actions.ts")
ok(actions.includes("assertKpiAccess()") && actions.includes('canReadMenuCode(snapshot, "kpi")'), "서버 액션 권한 가드")
ok(!actions.includes("assertDaewonFeatureScope"), "개발자 전용 가드 제거")
ok(actions.includes("kstDateRangeToUtcBounds") && actions.includes("toKstDateKey"), "KST 기준 처리")
ok(actions.includes("tenantId"), "테넌트 격리 유지")
ok(actions.includes('status: { notIn: ["CANCELLED", "DRAFT"] }'), "취소·미확정 수주 제외")

console.log(`Daewon KPI: ${passed} passed, 0 failed`)
