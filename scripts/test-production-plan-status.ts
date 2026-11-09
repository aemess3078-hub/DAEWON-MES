/**
 * 생산계획 상태 전이 정책·생산계획 화면 입력 규칙 단위 테스트 — 순수 모듈, DB·네트워크 없음.
 * 서버·화면 통합은 tests/e2e/tc-pc-plan-status.e2e.ts, tests/e2e/tc-pc-plan-screen.e2e.ts.
 */
import assert from "node:assert/strict"
import {
  CREATABLE_PLAN_STATUSES,
  NEW_PLAN_STATUS,
  isPlanEditable,
  selectablePlanStatuses,
  validatePlanStatusChange,
  validatePlanStatusForCreate,
  type PlanStatusValue,
} from "../src/lib/production-plan-status"
import { diffQty, evaluateLinkedRow, summarizeKinds, sumQty, PRODUCTION_KIND_LABEL_KO } from "../src/lib/production-plan-form"
import { keepProductionRequestTag, stripProductionRequestTag } from "../src/lib/production-request-tag"

let passed = 0
function ok(value: unknown, label: string) { assert.ok(value, label); passed += 1; console.log(`PASS ${label}`) }

// 상태 정책
ok(CREATABLE_PLAN_STATUSES.join() === "DRAFT,CONFIRMED", "S1 등록 요청에서 받아 주는 값은 초안·확정뿐(구 클라이언트 호환)")
ok(NEW_PLAN_STATUS === "CONFIRMED", "S1b 신규 생산계획은 항상 확정으로 저장")
ok(validatePlanStatusForCreate(undefined) === null && validatePlanStatusForCreate(null) === null, "S1c 요청에 상태가 없어도 등록 허용")
ok(validatePlanStatusForCreate("DRAFT") === null && validatePlanStatusForCreate("CONFIRMED") === null, "S2 초안·확정 등록 허용")
for (const st of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as PlanStatusValue[]) ok(!!validatePlanStatusForCreate(st), `S3 ${st} 직접 등록 거부`)
ok(/자동으로 바뀝니다/.test(validatePlanStatusForCreate("IN_PROGRESS") ?? ""), "S4 거부 사유에 자동 변경 안내")
const noWo = { hasEffectiveWorkOrders: false }, wo = { hasEffectiveWorkOrders: true }
ok(validatePlanStatusChange("DRAFT", "DRAFT", noWo) === null && validatePlanStatusChange("DRAFT", "CONFIRMED", noWo) === null, "T1 초안 유지·확정 허용")
ok(validatePlanStatusChange("CONFIRMED", "CONFIRMED", noWo) === null && validatePlanStatusChange("CONFIRMED", "DRAFT", noWo) === null, "T2 확정 유지·초안 복귀 허용(작업지시 없을 때)")
ok(/작업지시가 있는/.test(validatePlanStatusChange("CONFIRMED", "DRAFT", wo) ?? ""), "T3 작업지시가 있으면 초안 복귀 거부")
for (const from of ["DRAFT", "CONFIRMED"] as PlanStatusValue[]) for (const to of ["IN_PROGRESS", "COMPLETED"] as PlanStatusValue[]) ok(!!validatePlanStatusChange(from, to, noWo), `T4 ${from}→${to} 직접 지정 거부`)
for (const from of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as PlanStatusValue[]) ok(!!validatePlanStatusChange(from, from, noWo) && !isPlanEditable(from), `T5 ${from} 는 수정 자체 불가`)
ok(!!validatePlanStatusChange("DRAFT", "CANCELLED", noWo), "T6 취소는 취소 기능으로만")
ok(selectablePlanStatuses("DRAFT").join() === "DRAFT,CONFIRMED" && selectablePlanStatuses("CONFIRMED").join() === "CONFIRMED,DRAFT" && selectablePlanStatuses(null).join() === "CONFIRMED" && selectablePlanStatuses("IN_PROGRESS").join() === "IN_PROGRESS", "T7 상태 선택지(등록 화면은 확정 하나, 수정 화면은 기존 초안 개별 확정 경로 유지)")

// 화면 입력 규칙
const ev = (o: Partial<Parameters<typeof evaluateLinkedRow>[0]>) => evaluateLinkedRow({ allocatedQty: 60, extraQty: 0, extraReason: "", maxAllocatable: 100, ...o })
ok(Object.keys(ev({}).errors).length === 0 && ev({}).kind === "ORDER" && ev({}).plannedQty === 60, "F1 충당 60·여유 0 → ORDER, 계획 60")
const e2 = ev({ extraQty: 10, extraReason: "불량 대비" })
ok(Object.keys(e2.errors).length === 0 && e2.kind === "ORDER_EXTRA" && e2.plannedQty === 70, "F2 충당 60 + 여유 10 + 사유 → ORDER_EXTRA, 계획 70")
ok(!!ev({ extraQty: 10, extraReason: "  " }).errors.reason, "F3 여유가 있는데 사유 없음")
ok(!!ev({ allocatedQty: 101 }).errors.alloc && /최대\(100\)/.test(ev({ allocatedQty: 101 }).errors.alloc ?? ""), "F4 충당 > 최대(수주 − 다른 계획 충당)")
ok(!!ev({ allocatedQty: 0 }).errors.alloc && /재고 생산/.test(ev({ allocatedQty: 0 }).errors.alloc ?? ""), "F5 충당 0 거부(재고 생산 경로 안내)")
ok(ev({ allocatedQty: 101, maxAllocatable: null }).errors.alloc === undefined, "F6 서버 맥락이 없으면 최대 검사는 서버에 맡김")
ok(!!ev({ extraQty: 1, extraReason: "가".repeat(501) }).errors.reason, "F7 사유 500자 초과")
ok(sumQty(0.1, 0.2) === 0.3 && diffQty(0.3, 0.1) === 0.2 && diffQty(10, 12) === 0, "F8 소수 수량 정확·음수 차이는 0")
ok(summarizeKinds([]) === "STOCK" && summarizeKinds(["ORDER", "ORDER"]) === "ORDER" && summarizeKinds(["ORDER", "STOCK"]) === "MIXED" && summarizeKinds(["ORDER_EXTRA"]) === "ORDER_EXTRA", "K1 유형 요약(혼합 포함)")
ok(PRODUCTION_KIND_LABEL_KO.ORDER === "수주 생산" && PRODUCTION_KIND_LABEL_KO.ORDER_EXTRA === "수주+여유 생산" && PRODUCTION_KIND_LABEL_KO.STOCK === "재고 생산" && PRODUCTION_KIND_LABEL_KO.MIXED === "혼합", "K2 한글 유형명")

// 요청 ID 태그 보존
const TAG = "[pr:abcdef0123456789abcdef:0123456789abcdef0123456789abcdef]"
ok(stripProductionRequestTag(`수주 기반 생산의뢰 (수주번호: SO-1) ${TAG}`) === "수주 기반 생산의뢰 (수주번호: SO-1)", "R1 표시용 비고에서 요청 ID 태그 제거")
ok(keepProductionRequestTag(`원래 비고 ${TAG}`, "사용자가 고친 비고") === `사용자가 고친 비고 ${TAG}`, "R2 비고를 고쳐도 기존 태그를 다시 붙임")
ok(keepProductionRequestTag(`원래 ${TAG}`, `새 비고 ${TAG}`) === `새 비고 ${TAG}`, "R3 이미 태그가 있으면 중복해서 붙이지 않음")
ok(keepProductionRequestTag(`원래 ${TAG}`, "") === TAG && keepProductionRequestTag("태그 없는 비고", "새 비고") === "새 비고" && keepProductionRequestTag(null, null) === null, "R4 빈 비고·태그 없는 계획")

console.log(`\n${passed} checks passed`)
