/**
 * QR 라벨 3종(원자재 LOT / 공정·재공 WIP / 완제품 LOT) 단위 테스트 — DB/브라우저/프린터 없음.
 *
 *  A. WIP QR 규격 · LOT/WIP QR 상호 거부 · 디코딩
 *  B. 3종 라벨 레이아웃(긴 품목명·긴 식별값·큰 수량) — 29mm 높이/폭 안
 *  C. 출력 가능 여부(식별값 없음 → 임의 QR 없음) · 시험용 WIP/LOT 규칙 · 유형/QR 불일치 거부
 *  D. 라벨 내용 규칙: WIP 라벨에는 변하는 값(수량·공정·상태) 없음, 3종 유형 칩 구분
 *  E. 인쇄 job 검증(WIP/유형/시험용)
 *  F. WIP 인쇄 요청 이력(가짜 DB): 존재·폐기·tenant, 최초/재요청 사유, 원자성, 동시 요청 직렬화(잠금 → 판정 → 기록)
 *  G. 소스 구조: 스캐너/업무 화면 미연동, 출하·공정이동 전용 라벨 없음, 기존 흐름 보존
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import jsQR from "jsqr"
import {
  CORE_ISSUE_BASELINE_FINGERPRINTS,
  RECEIVING_TX_BASELINE_FINGERPRINT,
  RECEIVING_TX_BLOCK,
  between,
  coreIssueFingerprints,
  fingerprint,
  qrCouplingViolations,
  readSource,
  schemaViolations,
  stripComments,
} from "./test-support/source-invariants"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const qr = require("../src/lib/qr/lot-qr") as typeof import("../src/lib/qr/lot-qr")
const spec = require("../src/lib/label/label-spec") as typeof import("../src/lib/label/label-spec")
const svg = require("../src/lib/qr/qr-svg") as typeof import("../src/lib/qr/qr-svg")
const jobLib = require("../src/lib/label/label-print-job") as typeof import("../src/lib/label/label-print-job")
const samples = require("../src/lib/label/label-samples") as typeof import("../src/lib/label/label-samples")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepEqual(actual, expected, label)
  passed += 1
  console.log(`PASS ${label}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

const longName = "초고강도 알루미늄 합금 6061-T6 정밀가공 브라켓 어셈블리 (좌측 하단 보강형) 대형 특수 규격품 최종 검사 완료"
const CUID = "cmk3x9q2a0001abcd1234wxyz" // WipUnit.id(cuid) 형태

async function main() {
  const { BarcodeLabel } = await import("../src/components/common/barcode/barcode-label")

  // ─── A. WIP QR ──────────────────────────────────────────────────────────
  eq(qr.encodeWipQr(CUID), `DAEWON|WIP|1|${CUID}`, "A1 WIP QR 형식 DAEWON|WIP|1|<식별값>")
  eq(qr.encodeWipQr(CUID), qr.encodeWipQr(CUID), "A2 같은 WIP → 같은 QR(재발행해도 불변)")
  const parsedWip = qr.parseWipQr(qr.encodeWipQr(CUID))
  ok(parsedWip.ok && parsedWip.wipId === CUID, "A3 WIP QR 왕복 파싱")
  ok(qr.parseWipQr(qr.encodeWipQr("TEST-WIP 1/2")).ok && (qr.parseWipQr(qr.encodeWipQr("TEST-WIP 1/2")) as { wipId: string }).wipId === "TEST-WIP 1/2", "A4 특수문자 식별값 인코딩 왕복")
  assert.throws(() => qr.encodeWipQr(""), /WIP/)
  assert.throws(() => qr.encodeWipQr("a\nb"), /WIP/)
  assert.throws(() => qr.encodeWipQr("x".repeat(qr.QR_MAX_IDENTIFIER_LENGTH + 1)), /WIP/)
  ok(true, "A5 빈 값/제어문자/초과 길이는 WIP QR 생성 거부")
  const lotRes = qr.parseLotQr(qr.encodeWipQr(CUID))
  ok(!lotRes.ok && lotRes.code === "UNSUPPORTED_ENTITY", "A6 LOT 스캔 파서는 WIP QR 을 LOT 으로 오인하지 않는다")
  const wipRes = qr.parseWipQr(qr.encodeLotQr("CNS-RM-1"))
  ok(!wipRes.ok && wipRes.code === "UNSUPPORTED_ENTITY", "A7 WIP 파서는 LOT QR 을 WIP 으로 오인하지 않는다")
  ok(qr.classifyScanInput(qr.encodeWipQr(CUID)).kind === "INVALID", "A8 기존 스캔 분류(classifyScanInput)는 변경 없이 WIP QR 을 LOT 입력으로 받지 않는다")
  const d1 = qr.parseDaewonQr(qr.encodeLotQr("L-1"))
  const d2 = qr.parseDaewonQr(qr.encodeWipQr(CUID))
  ok(d1.ok && d1.entity === "LOT" && d2.ok && d2.entity === "WIP", "A9 parseDaewonQr 로 LOT/WIP QR 종류 구분")
  ok(!qr.parseDaewonQr("DAEWON|BATCH|1|x").ok && !qr.parseDaewonQr("HELLO").ok, "A10 정의되지 않은 종류(BATCH 등)는 거부 — 공정이동 전용 QR 없음")
  ok(!qr.parseWipQr("DAEWON|WIP|2|x").ok, "A11 지원하지 않는 버전 거부")
  for (const id of [CUID, "TEST-WIP-20261027-001", "x".repeat(qr.QR_MAX_IDENTIFIER_LENGTH)]) {
    const data = svg.buildWipQrSvgData(id)
    const img = svg.renderQrRgba(data, 8)
    const decoded = jsQR(img.data, img.width, img.height)
    const p = qr.parseDaewonQr(decoded?.data)
    ok(decoded?.data === qr.encodeWipQr(id) && p.ok && p.entity === "WIP", `A12 WIP QR 디코딩 → 식별: ${id.slice(0, 24)}`)
    if (id.length <= 64) ok(spec.LABEL_QR_MM_DEFAULT / data.viewBoxSize >= 0.4, `A13 WIP QR 모듈 ≥ 0.4mm (v${data.version})`)
  }

  // ─── B. 레이아웃 ────────────────────────────────────────────────────────
  const raw = { kind: "LOT_QR" as const, itemCode: "RM-STS304-0012", itemName: longName, spec: "Φ12×3000 열처리 SUS304 규격 아주 긴 규격 문자열", lotNo: "CNS-RM-20261027-001", quantity: 1234567.123456, uom: "KG" }
  const wip = { kind: "WIP_QR" as const, itemCode: "FG-BRK-0001", itemName: longName, wipId: CUID, manufacturingNo: "26A01-000123-REWORK-SHIFT-A", workOrderNo: "WO-2026-000123" }
  const fg = { kind: "LOT_QR" as const, itemCode: "FG-BRK-0001", itemName: longName, lotNo: "FG-20261027-0007", quantity: 500, uom: "EA" }
  for (const [name, d] of [["원자재", raw], ["WIP", wip], ["완제품", fg]] as const) {
    const l = spec.computeLabelLayout(d)
    ok(l.fits, `B1 ${name}: 긴 입력도 29mm 높이 안(${l.usedHeightPt.toFixed(1)}/${l.availableHeightPt.toFixed(1)}pt)`)
    ok(l.name.lines.length <= 2 && l.name.lines.every((x) => spec.estimateTextWidthPt(x, l.name.fontPt) <= l.textWidthMm * spec.MM_TO_PT), `B2 ${name}: 품목명 2줄 이내 · 폭 이내`)
    ok(spec.estimateTextWidthPt(l.codeText, l.codePt, true) <= l.textWidthMm * spec.MM_TO_PT, `B3 ${name}: 품목코드 줄 폭 이내`)
    if (l.last) ok(spec.estimateTextWidthPt(l.last.text, l.last.fontPt) <= l.textWidthMm * spec.MM_TO_PT, `B4 ${name}: 마지막 줄 폭 이내`)
  }
  const wl = spec.computeLabelLayout(wip)
  ok(wl.lot?.lines[0].startsWith("WIP ") && wl.last?.text.startsWith("제조번호 ") && wl.codeText.includes("WO-2026-000123"), "B5 WIP 라벨: 식별값 줄 · 제조번호 줄 · 품목코드+WO 줄")
  const rl = spec.computeLabelLayout({ ...raw, spec: "Φ12×3000", itemName: "스테인리스 봉재" })
  ok(rl.codeText === "RM-STS304-0012 · Φ12×3000" && rl.last?.text === "수량 1,234,567.123456 KG", "B6 원자재 라벨: 품목코드+규격 · 수량")
  const shortWip = spec.computeLabelLayout({ ...wip, itemName: "브라켓", manufacturingNo: "26A01-1" })
  ok(shortWip.fits && shortWip.name.fontPt === 11, "B7 짧은 품목명은 11pt 유지")
  const noMfg = spec.computeLabelLayout({ ...wip, manufacturingNo: null })
  ok(noMfg.last === null && noMfg.fits, "B8 제조번호가 없으면 해당 줄 생략(임의 값 없음)")

  // ─── C. 출력 가능 여부 ──────────────────────────────────────────────────
  const base = { itemCode: "A-1", itemName: "품목" }
  ok(!spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "WIP", wipId: "" }).printable, "C1 WIP 식별값이 없으면 출력 불가(임의 QR 없음)")
  ok(!spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "WIP", wipId: null }).printable, "C2 wipId null 도 출력 불가")
  ok(spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "WIP", wipId: CUID }).printable, "C3 WIP 식별값이 있으면 출력 가능")
  ok(!spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "WIP", wipId: "a\nb" }).printable, "C4 QR 로 만들 수 없는 식별값은 출력 불가")
  ok(!spec.getLabelBlock({ ...base, kind: "LOT_QR", labelType: "WIP", lotNo: "L-1" }).printable, "C5 WIP 유형에 LOT QR 은 거부(유형/QR 불일치)")
  ok(!spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "RAW_LOT", wipId: CUID }).printable, "C6 LOT 유형에 WIP QR 은 거부")
  ok(spec.getLabelBlock({ ...base, kind: "LOT_QR", labelType: "FG_LOT", lotNo: "FG-1" }).printable && !spec.getLabelBlock({ ...base, kind: "LOT_QR", labelType: "RAW_LOT", lotNo: "" }).printable, "C7 원자재/완제품 LOT 라벨은 LOT 번호가 있어야 출력")
  ok(spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "WIP", test: true, wipId: "TEST-WIP-20261027-001" }).printable, "C8 시험용 WIP 식별값(TEST-…) 출력 가능")
  ok(!spec.getLabelBlock({ ...base, kind: "WIP_QR", labelType: "WIP", test: true, wipId: CUID }).printable, "C9 시험용 WIP 라벨에 실제 식별값은 거부")
  ok(Object.keys(spec.LABEL_TYPE_META).length === 3 && !("SHIPMENT" in spec.LABEL_TYPE_META) && !("MOVE" in spec.LABEL_TYPE_META), "C10 라벨 유형은 3종뿐(출하·공정이동 전용 라벨 없음)")

  // ─── D. 렌더링 · 라벨 내용 ──────────────────────────────────────────────
  const s = samples.buildSampleLabels("2026-10-27")
  const htmlRaw = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: s.rawLot }))
  const htmlWip = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: s.wip }))
  const htmlFg = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: s.fgLot }))
  ok(htmlRaw.includes('data-label-type="RAW_LOT"') && htmlRaw.includes("원자재") && htmlRaw.includes("Φ12×3000") && htmlRaw.includes("120 KG"), "D1 원자재 라벨: 유형 칩 · 규격 · 수량")
  ok(htmlWip.includes('data-label-type="WIP"') && htmlWip.includes("재공 WIP") && htmlWip.includes("제조번호 TEST-20261027-A01") && htmlWip.includes("WO-TEST-0001"), "D2 WIP 라벨: 유형 칩 · 제조번호 · 작업지시번호")
  ok(htmlFg.includes('data-label-type="FG_LOT"') && htmlFg.includes("완제품") && htmlFg.includes("500 EA") && htmlFg.includes("생산일"), "D3 완제품 라벨: 유형 칩 · 수량 · 생산일")
  ok(htmlRaw.includes("data-qr-payload=\"DAEWON|LOT|1|TEST-20261027-001\"") && htmlFg.includes("data-qr-payload=\"DAEWON|LOT|1|TEST-20261027-002\"") && htmlWip.includes("data-qr-payload=\"DAEWON|WIP|1|TEST-WIP-20261027-001\""), "D4 QR: 원자재/완제품 = LOT QR, WIP = WIP QR (식별값만)")
  ok(!/수량|KG|EA|공정|상태|WAITING|IN_PROCESS/.test(htmlWip.replace(/<svg[\s\S]*?<\/svg>/g, "")), "D5 WIP 라벨에는 변하는 값(수량·공정·상태)을 인쇄하지 않는다 — 모든 공정에서 재사용")
  ok(!htmlWip.includes("data-label-barcode") && !htmlRaw.includes("data-label-barcode") && !htmlFg.includes("data-label-barcode"), "D6 3종 모두 CODE128 없음")
  ok([htmlRaw, htmlWip, htmlFg].every((h) => h.includes("시험용") && h.includes("width:90mm") && h.includes("height:29mm")), "D7 샘플은 시험용 표시 · 90×29mm")
  const typeless = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: { kind: "LOT_QR", itemCode: "A", itemName: "B", lotNo: "L-1", quantity: 1, uom: "EA", date: "2026-10-27", dateLabel: "입고일" } }))
  ok(!typeless.includes("data-label-type") && typeless.includes("수량 1 EA"), "D8 유형 미지정(기존 화면) 라벨은 유형 칩 없이 기존 모양 유지")
  const blockedWip = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: { kind: "WIP_QR", labelType: "WIP", itemCode: "A", itemName: "B", wipId: null, date: "x", dateLabel: "발행일" } }))
  ok(blockedWip.includes("출력 불가") && !blockedWip.includes("data-qr-payload"), "D9 WIP 식별값 없는 라벨은 QR 없이 출력 불가 표시")
  ok(Object.values(s).every((l) => spec.getLabelBlock(l).printable), "D10 샘플 3종은 모두 시험용 값으로 출력 가능")
  ok(new Set(Object.values(s).map((l) => l.lotNo ?? l.wipId)).size === 3 && Object.values(s).every((l) => /^TEST-/.test(String(l.lotNo ?? l.wipId))), "D11 샘플 식별값은 모두 TEST- 임시 값 · 서로 다름")

  // ─── E. 인쇄 job ────────────────────────────────────────────────────────
  const jl = jobLib.sanitizeLabel(s.wip)
  ok(jl?.kind === "WIP_QR" && jl.wipId === "TEST-WIP-20261027-001" && jl.labelType === "WIP" && jl.manufacturingNo === "TEST-20261027-A01" && jl.workOrderNo === "WO-TEST-0001" && jl.test === true, "E1 job: WIP 라벨 필드 보존")
  ok(jobLib.sanitizeLabel(s.rawLot)?.spec === "Φ12×3000" && jobLib.sanitizeLabel(s.fgLot)?.labelType === "FG_LOT", "E2 job: 원자재 규격/완제품 유형 보존")
  ok(jobLib.sanitizeLabel({ ...s.wip, wipId: "" }) === null, "E3 job: WIP_QR 인데 식별값 없으면 거부")
  ok(jobLib.sanitizeLabel({ ...s.wip, wipId: CUID }) === null, "E4 job: 시험용 WIP 에 실제 식별값 거부(위조 방지)")
  ok(jobLib.sanitizeLabel({ ...s.wip, labelType: "FG_LOT" }) === null && jobLib.sanitizeLabel({ ...s.rawLot, labelType: "WIP" }) === null, "E5 job: 유형/QR 종류 불일치 거부")
  ok(jobLib.sanitizeLabel({ ...s.wip, labelType: "SHIPMENT" })?.labelType === undefined, "E6 job: 정의되지 않은 유형(출하 등)은 유형 없는 라벨로 취급되어 전용 라벨이 되지 못한다")
  ok(jobLib.sanitizeLabel({ ...s.wip, test: undefined, wipId: CUID })?.wipId === CUID, "E7 job: 실제 WIP 식별값 라벨(시험용 아님) 허용")

  // ─── F. WIP 인쇄 요청 이력 — 서버 게이트 · 원자성 · 동시성 (가짜 DB) ─────────────
  // 가짜 DB 는 PostgreSQL 의 다음 성질만 흉내 낸다: 트랜잭션 커밋 전 쓰기는 다른 트랜잭션에 보이지 않음(READ COMMITTED),
  // `SELECT … FOR UPDATE` 는 같은 행을 쥔 다른 트랜잭션이 끝날 때까지 대기, 커밋/롤백 때 잠금 해제.
  // 실제 PostgreSQL 의 잠금 의미·타임아웃·교착 처리는 이 테스트로 검증되지 않는다(보고서 참조).
  type Unit = {
    id: string
    tenantId: string
    status: string
    manufacturingNo: string | null
    workOrderId?: string
    parentWipUnitId?: string | null
    sourceProductionResultId?: string | null
    item?: { code: string; name: string }
  }
  type WorkOrder = {
    id: string
    tenantId: string
    orderNo: string
    manufacturingNo: string | null
    status: string
    plannedQty: number
    dueDate: null
    item: { id: string; code: string; name: string }
    site: { id: string; name: string }
    bom: { bomItems: Array<{ componentItemId: string; qtyPer: number; scrapRate: number; seq: number; componentItem: { id: string; code: string; name: string; uom: string; spec: string | null; isLotTracked: boolean; itemType: string } }> }
    materialReservations: Array<{ id: string; itemId: string; issuedQty: number }>
  }
  // 작업지시 fixture: BOM 은 [품목, qtyPer, scrapRate], 예약은 [품목, 기출고수량]
  const mkWo = (id: string, tenantId: string, status: string, bom: Array<[string, number, number]>, reservations: Array<[string, number]>, orderNo: string, manufacturingNo: string | null = null): WorkOrder => ({
    id,
    tenantId,
    orderNo,
    manufacturingNo,
    status,
    plannedQty: 10,
    dueDate: null,
    item: { id: "item-fg", code: "FG", name: "제품" },
    site: { id: "site-1", name: "본사" },
    bom: { bomItems: bom.map(([itemId, qtyPer, scrapRate], seq) => ({ componentItemId: itemId, qtyPer, scrapRate, seq, componentItem: { id: itemId, code: itemId, name: itemId, uom: "EA", spec: null, isLotTracked: false, itemType: "RAW_MATERIAL" } })) },
    materialReservations: reservations.map(([itemId, issuedQty], i) => ({ id: `res-${id}-${i}`, itemId, issuedQty })),
  })
  const BOM_AB: Array<[string, number, number]> = [["A", 2, 0.1], ["B", 1, 0]]
  const FULL: Array<[string, number]> = [["A", 22], ["B", 10]]
  type Audit = { tenantId: string; entityType: string; entityId: string; action: string; afterData: Record<string, unknown> }
  const delay = () => new Promise<void>((resolve) => setImmediate(resolve))
  const fake = {
    units: [] as Unit[],
    audits: [] as Audit[],
    workOrders: [] as WorkOrder[],
    lockEnabled: true,
    failOnWriteNo: 0, // N 번째 감사 쓰기에서 오류 주입(0 = 끔)
    writeNo: 0,
    holders: new Map<string, number>(), // id → 잠금을 쥔 tx 번호
    waiters: new Map<string, Array<() => void>>(),
    activeTx: 0,
    maxActiveTx: 0,
    txSeq: 0,
    ops: [] as string[],
    user: { tenantId: "t1", name: "작업자" } as { tenantId: string; name: string } | "ANON" | "DENIED",
    reset() {
      this.units = [
        { id: "wip-1", tenantId: "t1", status: "IN_PROCESS", manufacturingNo: "26A01-1" },
        { id: "wip-2", tenantId: "t1", status: "WAITING", manufacturingNo: null },
        { id: "wip-scrap", tenantId: "t1", status: "SCRAPPED", manufacturingNo: "26A01-9" },
        { id: "wip-other", tenantId: "t2", status: "IN_PROCESS", manufacturingNo: "X" },
        ...["a", "b", "c", "d", "e", "f"].map((k) => ({ id: `wip-${k}`, tenantId: "t1", status: "IN_PROCESS", manufacturingNo: null })),
      ]
      this.workOrders = [
        mkWo("wo-1", "t1", "IN_PROGRESS", BOM_AB, FULL, "WO-0001", "26A01-WO"),
        mkWo("wo-2", "t1", "IN_PROGRESS", BOM_AB, FULL, "WO-0002"),
        mkWo("wo-3", "t1", "IN_PROGRESS", BOM_AB, FULL, "WO-0003"),
        mkWo("wo-4", "t1", "IN_PROGRESS", BOM_AB, FULL, "WO-0004"),
        mkWo("wo-5", "t1", "IN_PROGRESS", BOM_AB, FULL, "WO-0005"),
        mkWo("wo-ok", "t1", "IN_PROGRESS", BOM_AB, FULL, "WO-OK"),
        mkWo("wo-d", "t1", "RELEASED", BOM_AB, FULL, "WO-D"),
        mkWo("wo-dup", "t1", "IN_PROGRESS", BOM_AB, [["A", 22], ["A", 0], ["B", 10]], "WO-DUP"),
        mkWo("wo-p", "t1", "IN_PROGRESS", BOM_AB, [["A", 22], ["B", 4]], "WO-P"),
        mkWo("wo-q", "t1", "IN_PROGRESS", BOM_AB, [["A", 21.9], ["B", 10]], "WO-Q"),
        mkWo("wo-n", "t1", "IN_PROGRESS", BOM_AB, [], "WO-N"),
        mkWo("wo-z", "t1", "IN_PROGRESS", [], [], "WO-Z"),
        mkWo("wo-c", "t1", "COMPLETED", BOM_AB, FULL, "WO-C"),
        mkWo("wo-plan", "t1", "PLANNED", BOM_AB, FULL, "WO-PLAN"),
        mkWo("wo-other", "t2", "IN_PROGRESS", BOM_AB, FULL, "WO-X"),
      ]
      this.units.push(
        { id: "wip-root-1", tenantId: "t1", status: "IN_PROCESS", manufacturingNo: "26A01-ROOT", workOrderId: "wo-1", item: { code: "FG-ROOT", name: "루트 제품" } },
        { id: "wip-child-1", tenantId: "t1", status: "REWORK", manufacturingNo: "26A01-ROOT", workOrderId: "wo-1", parentWipUnitId: "wip-root-1", item: { code: "FG-ROOT", name: "루트 제품" } },
        { id: "wip-sp-1", tenantId: "t1", status: "SCRAPPED", manufacturingNo: "26A01-ROOT", workOrderId: "wo-1", sourceProductionResultId: "pr-1", item: { code: "FG-ROOT", name: "루트 제품" } },
        { id: "wip-root-2", tenantId: "t1", status: "WAITING", manufacturingNo: null, workOrderId: "wo-5", item: { code: "FG-2", name: "제품2" } },
        { id: "wip-dup-a", tenantId: "t1", status: "WAITING", manufacturingNo: null, workOrderId: "wo-3", item: { code: "FG-3", name: "제품3" } },
        { id: "wip-dup-b", tenantId: "t1", status: "WAITING", manufacturingNo: null, workOrderId: "wo-3", item: { code: "FG-3", name: "제품3" } },
        { id: "wip-root-4", tenantId: "t1", status: "SCRAPPED", manufacturingNo: null, workOrderId: "wo-4", item: { code: "FG-4", name: "제품4" } },
      )
      // 기본 WIP(wip-1, wip-a …)은 출고 완료된 작업지시 wo-ok 에 속한다.
      this.units = this.units.map((u) => (u.workOrderId !== undefined || u.tenantId !== "t1" ? u : { ...u, workOrderId: "wo-ok" }))
      this.audits = []
      this.lockEnabled = true
      this.failOnWriteNo = 0
      this.writeNo = 0
      this.holders.clear()
      this.waiters.clear()
      this.activeTx = 0
      this.maxActiveTx = 0
      this.ops = []
    },
    async acquire(id: string, tx: number) {
      while (this.holders.has(id) && this.holders.get(id) !== tx) {
        await new Promise<void>((resolve) => {
          const list = this.waiters.get(id) ?? []
          list.push(resolve)
          this.waiters.set(id, list)
        })
      }
      this.holders.set(id, tx)
    },
    release(tx: number) {
      for (const [id, holder] of Array.from(this.holders.entries())) {
        if (holder === tx) {
          this.holders.delete(id)
          const list = this.waiters.get(id) ?? []
          this.waiters.delete(id)
          list.forEach((wake) => wake())
        }
      }
    },
    client(pending: Audit[] | null, txNo: number | null) {
      const self = this
      return {
        wipUnit: {
          findMany: async (a: { where: { tenantId: string; id?: { in: string[] }; workOrderId?: string } }) => {
            if (a.where.id) {
              const ids = a.where.id.in
              return self.units.filter((u) => u.tenantId === a.where.tenantId && ids.includes(u.id))
            }
            // 작업지시의 원본(루트) WipUnit: parentWipUnitId/sourceProductionResultId 가 없는 행
            return self.units
              .filter((u) => u.tenantId === a.where.tenantId && u.workOrderId === a.where.workOrderId && (u.parentWipUnitId ?? null) === null && (u.sourceProductionResultId ?? null) === null)
              .map((u) => ({ ...u, item: u.item ?? { code: "X", name: "Y" } }))
          },
        },
        workOrder: {
          findFirst: async (a: { where: { id: string; tenantId: string } }) =>
            self.workOrders.find((w) => w.id === a.where.id && w.tenantId === a.where.tenantId) ?? null,
          findMany: async (a: { where: { tenantId: string; id?: { in: string[] }; status?: { in: string[] } } }) => {
            if (txNo !== null) self.ops.push(`tx${txNo}:read-workorder`)
            return self.workOrders.filter(
              (w) => w.tenantId === a.where.tenantId && (a.where.id ? a.where.id.in.includes(w.id) : true) && (a.where.status ? a.where.status.in.includes(w.status) : true),
            )
          },
        },
        inventoryBalance: { findMany: async () => [] },
        auditLog: {
          findMany: async (a: { where: { tenantId: string; entityType: string; entityId: { in: string[] } } }) => {
            // 읽기와 쓰기 사이에 다른 요청이 끼어들 틈을 만든다(잠금이 없으면 중복 판정이 실제로 발생한다).
            await delay()
            await delay()
            if (txNo !== null) self.ops.push(`tx${txNo}:read-history`)
            return self.audits.filter((x) => x.tenantId === a.where.tenantId && x.entityType === a.where.entityType && a.where.entityId.in.includes(x.entityId))
          },
        },
        $executeRaw: async () => 0,
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join("?")
          if (!/FOR UPDATE/.test(sql) || !/"WipUnit"/.test(sql)) throw new Error("unexpected raw query: " + sql)
          const [id, tenantId] = values as [string, string]
          const unit = self.units.find((u) => u.id === id && u.tenantId === tenantId)
          if (!unit) return []
          if (self.lockEnabled && txNo !== null) await self.acquire(id, txNo)
          if (txNo !== null) self.ops.push(`tx${txNo}:lock:${id}`)
          return [{ id }]
        },
        async __push(row: Audit) {
          await delay() // 쓰기 지연(읽기와 쓰기 사이의 틈을 현실적으로 넓힌다)
          await delay()
          self.writeNo += 1
          if (self.failOnWriteNo && self.writeNo === self.failOnWriteNo) throw new Error("injected write failure")
          if (txNo !== null) self.ops.push(`tx${txNo}:write:${row.entityId}`)
          if (pending) pending.push(row)
          else self.audits.push(row)
        },
      }
    },
  }
  const fakePrisma = {
    ...fake.client(null, null),
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
      const txNo = ++fake.txSeq
      const pending: Audit[] = []
      fake.activeTx += 1
      fake.maxActiveTx = Math.max(fake.maxActiveTx, fake.activeTx)
      try {
        const result = await fn(fake.client(pending, txNo))
        fake.audits.push(...pending) // 커밋: 이제서야 다른 트랜잭션에 보인다
        return result
      } finally {
        fake.activeTx -= 1
        fake.release(txNo) // 커밋/롤백 모두 잠금 해제
      }
    },
  }
  function inject(modulePath: string, exports: Record<string, unknown>) {
    const filename = require.resolve(modulePath)
    const mod = new Module(filename)
    mod.filename = filename
    mod.loaded = true
    mod.exports = exports
    require.cache[filename] = mod
  }
  inject("../src/lib/db/prisma", { prisma: fakePrisma })
  inject("../src/lib/audit-log", {
    recordAuditLog: async (db: { __push: (row: Audit) => Promise<void> }, p: Audit) =>
      db.__push({ tenantId: p.tenantId, entityType: p.entityType, entityId: p.entityId, action: p.action, afterData: p.afterData }),
  })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async () => {
      if (fake.user === "ANON") throw new Error("UNAUTHORIZED")
      if (fake.user === "DENIED") throw new Error("이 기능을 사용할 권한이 없습니다.")
      return fake.user
    },
  })
  const act = require("../src/lib/actions/wip-label.actions") as typeof import("../src/lib/actions/wip-label.actions")
  const countFor = (id: string) => fake.audits.filter((a) => a.entityId === id).length
  const quiet = console.error
  fake.reset()

  // 시나리오 1·2·3: 최초 / 사유 없는 재요청 / 사유 있는 재요청 (순차)
  const c0 = await act.checkWipLabelPrintable({ wipUnitIds: ["nope"] })
  ok(!c0.ok && c0.code === "WIP_NOT_FOUND", "F1 존재하지 않는 WIP 은 요청 불가")
  const c1 = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-other"] })
  ok(!c1.ok && c1.code === "WIP_NOT_FOUND", "F2 다른 tenant WIP 은 존재 여부를 구분 없이 거부")
  const c2 = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-scrap"] })
  ok(!c2.ok && c2.code === "WIP_SCRAPPED", "F3 폐기(SCRAPPED) WIP 은 요청 불가")
  const r0 = await act.recordWipLabelPrint({ wipUnitIds: ["wip-1", "nope"] })
  ok(!r0.ok && r0.code === "WIP_NOT_FOUND" && fake.audits.length === 0, "F4 하나라도 없으면 전부 거부 · 이력 없음")
  const rOther = await act.recordWipLabelPrint({ wipUnitIds: ["wip-other"] })
  ok(!rOther.ok && rOther.code === "WIP_NOT_FOUND" && !fake.ops.some((o) => o.includes("wip-other")), "F4b 다른 tenant WIP 은 잠그지도 기록하지도 않는다")
  const c3 = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-1", "wip-2"] })
  ok(c3.ok && c3.reissueWipIds.length === 0, "F5 사전 확인: 최초 요청 · 재요청 아님")
  const first = await act.recordWipLabelPrint({ wipUnitIds: ["wip-1", "wip-2"], context: "시험" })
  ok(first.ok && first.results.every((r) => r.event === "WIP_LABEL_ISSUE" && r.issueCount === 1), "F6 [시나리오1] 최초 요청 → WIP_LABEL_ISSUE(횟수 1)")
  ok(fake.audits.length === 2 && fake.audits.every((a) => a.entityType === "WipLabel" && a.action === "CREATE"), "F7 AuditLog(WipLabel/CREATE) 기록")
  eq(first.ok ? first.results[0].qrPayload : "", "DAEWON|WIP|1|wip-1", "F8 [시나리오8] QR payload = 기존 WIP 표준 DAEWON|WIP|1|<식별값>")
  ok(fake.audits[0].afterData.manufacturingNo === "26A01-1" && !("qty" in fake.audits[0].afterData) && !("status" in fake.audits[0].afterData), "F9 이력에도 변하는 값(수량·상태)을 남기지 않는다")
  ok(fake.audits[0].afterData.meaning === "PRINT_REQUEST", "F9b 이력의 의미는 '인쇄 요청'(실제 출력 완료 아님)으로 표기")
  const c4 = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-1"] })
  ok(c4.ok && c4.reissueWipIds.includes("wip-1"), "F10 요청 이력이 있는 WIP 은 사전 확인에서 재요청으로 판정")
  const nr = await act.recordWipLabelPrint({ wipUnitIds: ["wip-1"] })
  ok(!nr.ok && nr.code === "REASON_REQUIRED" && countFor("wip-1") === 1, "F11 [시나리오2] 사유 없는 재요청 → 거부 · 이력 증가 없음")
  const re = await act.recordWipLabelPrint({ wipUnitIds: ["wip-1"], reason: " 이전 인쇄 취소 " })
  ok(re.ok && re.results[0].event === "WIP_LABEL_REISSUE" && re.results[0].issueCount === 2 && fake.audits[2].afterData.reason === "이전 인쇄 취소", "F12 [시나리오3] 사유 입력 재요청 → WIP_LABEL_REISSUE(횟수 2) · 사유 기록")
  eq(re.ok ? re.results[0].qrPayload : "x", first.ok ? first.results[0].qrPayload : "y", "F13 재요청해도 QR 불변")
  ok(!(await act.checkWipLabelPrintable({ wipUnitIds: Array.from({ length: 51 }, (_, i) => `w${i}`) })).ok && !(await act.checkWipLabelPrintable({ wipUnitIds: [] })).ok, "F14 51건 초과/빈 요청 거부")
  fake.user = "ANON"
  const anon = await act.recordWipLabelPrint({ wipUnitIds: ["wip-1"], reason: "x" })
  ok(!anon.ok && anon.code === "UNAUTHORIZED", "F15 비로그인 거부")
  fake.user = "DENIED"
  const den = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-1"] })
  ok(!den.ok && den.code === "DENIED", "F16 권한 없음 거부")
  fake.user = { tenantId: "t1", name: "작업자" }
  const sc = await act.recordWipLabelPrint({ wipUnitIds: ["wip-scrap"] })
  ok(!sc.ok && sc.code === "WIP_SCRAPPED" && countFor("wip-scrap") === 0, "F16b 폐기 WIP 은 기록 없이 거부")

  // 잠금 → 판정 → 기록 순서 (같은 트랜잭션)
  fake.reset()
  await act.recordWipLabelPrint({ wipUnitIds: ["wip-b", "wip-a"] })
  const order = fake.ops.filter((o) => o.startsWith("tx"))
  const iLastLock = Math.max(...order.map((o, i) => (o.includes(":lock:") ? i : -1)))
  const iRead = order.findIndex((o) => o.includes("read-history"))
  const iFirstWrite = order.findIndex((o) => o.includes(":write:"))
  ok(order[0].includes(":lock:wip-a") && order[1].includes(":lock:wip-b") && iLastLock < iRead && iRead < iFirstWrite, "F17 순서: 잠금(id 정렬) → 잠금 이후 이력 조회·판정 → 같은 트랜잭션에서 기록")

  // 시나리오 4: 같은 WIP 최초 요청 동시 2건 (사유 없음)
  fake.reset()
  const [p1, p2] = await Promise.all([act.recordWipLabelPrint({ wipUnitIds: ["wip-c"] }), act.recordWipLabelPrint({ wipUnitIds: ["wip-c"] })])
  const okCount = [p1, p2].filter((r) => r.ok).length
  const needReason = [p1, p2].filter((r) => !r.ok && r.code === "REASON_REQUIRED").length
  ok(okCount === 1 && needReason === 1 && countFor("wip-c") === 1, "F18 [시나리오4] 같은 WIP 동시 최초 요청 2건 → 최초 1건만 기록, 나머지는 재요청 사유 요구")
  ok(fake.audits[0].afterData.event === "WIP_LABEL_ISSUE" && fake.audits[0].afterData.issueCount === 1, "F19 기록된 1건은 WIP_LABEL_ISSUE(횟수 1)")
  // 사유를 함께 보낸 동시 요청 2건 → 최초(1) + 재요청(2), 중복/역전 없음
  fake.reset()
  const [q1, q2] = await Promise.all([act.recordWipLabelPrint({ wipUnitIds: ["wip-d"], reason: "동시" }), act.recordWipLabelPrint({ wipUnitIds: ["wip-d"], reason: "동시" })])
  const evs = fake.audits.map((a) => `${a.afterData.event}:${a.afterData.issueCount}`).sort()
  ok(q1.ok && q2.ok && evs.join() === "WIP_LABEL_ISSUE:1,WIP_LABEL_REISSUE:2", `F20 사유 포함 동시 2건 → ISSUE:1 + REISSUE:2 (${evs.join(" ")})`)
  ok(fake.audits.find((a) => a.afterData.event === "WIP_LABEL_ISSUE")!.afterData.reason === null, "F21 최초 요청에는 사유를 기록하지 않는다")

  // 시나리오 5: 이미 요청된 WIP 에 동시 재요청 3건 → 횟수가 중복/역전 없이 2,3,4
  fake.reset()
  await act.recordWipLabelPrint({ wipUnitIds: ["wip-e"] })
  const rs = await Promise.all([1, 2, 3].map((n) => act.recordWipLabelPrint({ wipUnitIds: ["wip-e"], reason: `재요청${n}` })))
  const counts = fake.audits.map((a) => a.afterData.issueCount as number)
  ok(rs.every((r) => r.ok) && counts.join() === "1,2,3,4", `F22 [시나리오5] 동시 재요청 3건 → 횟수 ${counts.join(",")} (중복·역전 없음, 커밋 순서대로 증가)`)
  ok(fake.audits.filter((a) => a.afterData.event === "WIP_LABEL_ISSUE").length === 1 && fake.audits.filter((a) => a.afterData.event === "WIP_LABEL_REISSUE").length === 3, "F23 최초 1건 + 재요청 3건")
  const noReasonConcurrent = await Promise.all([act.recordWipLabelPrint({ wipUnitIds: ["wip-e"] }), act.recordWipLabelPrint({ wipUnitIds: ["wip-e"] })])
  ok(noReasonConcurrent.every((r) => !r.ok && r.code === "REASON_REQUIRED") && countFor("wip-e") === 4, "F24 동시 재요청도 사유가 없으면 모두 거부")

  // 시나리오 6: 서로 다른 WIP 동시 요청 — 서로 기다리지 않고 각각 최초
  fake.reset()
  const diff = await Promise.all(["wip-a", "wip-b", "wip-c", "wip-d"].map((id) => act.recordWipLabelPrint({ wipUnitIds: [id] })))
  ok(diff.every((r) => r.ok && r.results[0].issueCount === 1) && fake.audits.length === 4, "F25 [시나리오6] 서로 다른 WIP 4건 동시 → 각각 최초 1건씩")
  ok(fake.maxActiveTx === 4, `F26 서로 다른 WIP 은 직렬화되지 않는다(동시 활성 트랜잭션 최대 ${fake.maxActiveTx})`)

  // 겹치는 다중 WIP 요청: 교착 없이 완료, 각 WIP 최초는 정확히 1번
  fake.reset()
  const overlap = await Promise.all([
    act.recordWipLabelPrint({ wipUnitIds: ["wip-a", "wip-b"], reason: "r" }),
    act.recordWipLabelPrint({ wipUnitIds: ["wip-b", "wip-a"], reason: "r" }),
    act.recordWipLabelPrint({ wipUnitIds: ["wip-a", "wip-b", "wip-c"], reason: "r" }),
  ])
  const issuesOf = (id: string) => fake.audits.filter((a) => a.entityId === id && a.afterData.event === "WIP_LABEL_ISSUE").length
  ok(overlap.every((r) => r.ok) && issuesOf("wip-a") === 1 && issuesOf("wip-b") === 1 && issuesOf("wip-c") === 1, "F27 겹치는 다중 WIP 동시 요청: 교착 없이 완료 · WIP 별 최초는 정확히 1건")
  ok([1, 2, 3].join() === fake.audits.filter((a) => a.entityId === "wip-a").map((a) => a.afterData.issueCount).join(), "F28 WIP 별 횟수 1,2,3 순서대로(역전 없음)")

  // 대조 실험: 잠금을 끄면(=기존 구조) 같은 동시 요청에서 최초가 중복 기록된다 → 위 테스트가 경쟁을 실제로 잡는다
  fake.reset()
  fake.lockEnabled = false
  await Promise.all([act.recordWipLabelPrint({ wipUnitIds: ["wip-f"] }), act.recordWipLabelPrint({ wipUnitIds: ["wip-f"] })])
  ok(issuesOf("wip-f") === 2, `F29 대조: 잠금이 없으면 최초 요청이 ${issuesOf("wip-f")}건 중복 기록된다(테스트가 경쟁을 재현함)`)

  // 원자성: 다중 WIP 중 한 건의 기록이 실패하면 전부 롤백, 잠금은 풀려 다음 요청이 진행된다
  fake.reset()
  fake.failOnWriteNo = 2
  console.error = () => {}
  const failed = await act.recordWipLabelPrint({ wipUnitIds: ["wip-a", "wip-b"] })
  console.error = quiet
  ok(!failed.ok && failed.code === "FAILED" && fake.audits.length === 0, "F30 기록 중 오류 → 전부 롤백(이력 0건) · 사용자용 실패 메시지")
  ok(!failed.ok && !/transaction|prisma|injected/i.test(failed.message), "F31 실패 메시지에 내부 오류 문구를 노출하지 않는다")
  fake.failOnWriteNo = 0
  const after = await act.recordWipLabelPrint({ wipUnitIds: ["wip-a", "wip-b"] })
  ok(after.ok && fake.audits.length === 2 && fake.holders.size === 0, "F32 롤백 후 잠금이 해제되어 이후 요청이 정상 처리(최초로 기록)")
  ok(after.ok && after.results.every((r) => r.event === "WIP_LABEL_ISSUE" && r.issueCount === 1), "F33 실패한 시도는 이력을 남기지 않았으므로 다음 요청이 최초로 기록")

  // ─── H. 2단계 업무 화면 연동: 라벨 대상 조회 · 유형 표시 · 발행 연결 ───────────────
  // H-1) 원자재(입고)/완제품(완제품입고) 유형 표시
  const itemsLib = require("../src/lib/label/label-items") as typeof import("../src/lib/label/label-items")
  const recvPlan = itemsLib.buildReceiptLabelPlan([{ itemCode: "RM-1", itemName: "원자재A", uom: "KG", isLotTracked: true, lotNo: "L-100", receivedQty: 10, acceptedQty: 10 }])
  ok(recvPlan.items[0].labelType === "RAW_LOT" && recvPlan.candidates[0].labelType === "RAW_LOT", "H1 입고 라벨 대상/시험용 후보는 원자재(RAW_LOT) 유형")
  const recvChip = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: { kind: "LOT_QR", labelType: recvPlan.items[0].labelType, itemCode: "RM-1", itemName: "원자재A", lotNo: "L-100", quantity: 10, uom: "KG", date: "2026-10-27", dateLabel: "입고일" } }))
  ok(recvChip.includes('data-label-type="RAW_LOT"') && recvChip.includes("data-qr-payload=\"DAEWON|LOT|1|L-100\"") && recvChip.includes("10 KG"), "H2 입고 라벨: 원자재 칩 · 기존 LOT QR · 입고 수량")
  const issuePlan2 = itemsLib.buildIssueLabelPlan([{ itemId: "i1", itemCode: "RM-1", itemName: "원자재A", uom: "KG", lotManaged: true }], { i1: [{ lotValue: "k", qty: "5" }] }, () => ({ key: "k", lotNo: "L-1" }))
  ok(issuePlan2.items[0].labelType === undefined, "H3 출고 LOT 라벨은 유형 미지정(기존 모양 유지)")
  const recvSrc2 = read("src/app/app/mes/material-receipt/receiving-form-dialog.tsx")
  const fgSrc = read("src/app/app/mes/finished-goods-receipt/receipt-dialog.tsx")
  ok(recvSrc2.includes("labelType: l.labelType") && fgSrc.includes('labelType: "FG_LOT"'), "H4 자재입고=원자재 유형, 완제품입고=완제품 유형을 라벨 창에 전달")
  ok(recvSrc2.includes("printBlockedReason") && recvSrc2.includes("setConfirmedLabels(plan)") && recvSrc2.indexOf("runReceivingBatch(") < recvSrc2.indexOf("setConfirmedLabels(plan)"), "H5 자재입고: 입고 확정(runReceivingBatch 성공) 이후에만 실제 라벨 · 그 전은 미리보기")
  ok(fgSrc.includes("createFinishedGoodsReceiptAction(") && fgSrc.indexOf("createFinishedGoodsReceiptAction(") < fgSrc.indexOf("setReceivedLotNo(res.lotNo)") && fgSrc.includes("lotNo: receivedLotNo ?? undefined"), "H6 완제품입고: 입고 성공 응답의 서버 LOT 번호만 사용(번호 생성 없음)")
  ok(!/lotNo:\s*(`|"|')/.test(fgSrc.replace(/lotNo: receivedLotNo \?\? undefined/g, "")) && !/generate|Math\.random/.test(fgSrc.slice(fgSrc.indexOf("<BarcodePrintDialog"))), "H7 완제품 라벨에 LOT 번호를 만들어 넣지 않는다")

  // H-2) WIP 라벨 대상 조회(getWipLabelTarget) — 가짜 DB
  fake.reset()
  const t1 = await act.getWipLabelTarget({ workOrderId: "wo-1" })
  ok(t1.ok && t1.target.wipUnitId === "wip-root-1" && t1.target.itemCode === "FG-ROOT" && t1.target.itemName === "루트 제품" && t1.target.manufacturingNo === "26A01-ROOT" && t1.target.workOrderNo === "WO-0001", "H8 WIP 라벨 대상: 작업지시의 원본(루트) WipUnit 의 id·품목·제조번호·작업지시번호를 서버가 조회(자식 WIP 제외)")
  const t2 = await act.getWipLabelTarget({ workOrderId: "wo-2" })
  ok(!t2.ok && t2.code === "NO_WIP" && t2.message.includes("자재출고가 완료되어"), "H9 WIP 이 없으면(자재출고 미완료/미생성) 발행 차단 + 안내 — WIP 을 만들지 않는다")
  const t3 = await act.getWipLabelTarget({ workOrderId: "wo-3" })
  ok(!t3.ok && t3.code === "AMBIGUOUS", "H10 원본 WIP 이 여러 건이면 임의로 고르지 않고 차단")
  const t4 = await act.getWipLabelTarget({ workOrderId: "wo-4" })
  ok(!t4.ok && t4.code === "WIP_SCRAPPED", "H11 폐기된 WIP 은 대상이 아니다")
  const t5 = await act.getWipLabelTarget({ workOrderId: "wo-other" })
  const t5b = await act.getWipLabelTarget({ workOrderId: "nope" })
  const t5c = await act.getWipLabelTarget({ workOrderId: "  " })
  ok(!t5.ok && t5.code === "WORK_ORDER_NOT_FOUND" && !t5b.ok && t5b.code === "WORK_ORDER_NOT_FOUND" && !t5c.ok && t5c.code === "INVALID", "H12 다른 tenant/없는 작업지시는 구분 없이 거부 · 빈 입력 거부")
  fake.user = "ANON"
  const t6 = await act.getWipLabelTarget({ workOrderId: "wo-1" })
  fake.user = "DENIED"
  const t6b = await act.getWipLabelTarget({ workOrderId: "wo-1" })
  fake.user = { tenantId: "t1", name: "작업자" }
  ok(!t6.ok && t6.code === "UNAUTHORIZED" && !t6b.ok && t6b.code === "DENIED", "H13 로그인/권한 필요")
  ok(fake.audits.length === 0 && fake.writeNo === 0, "H14 대상 조회는 읽기 전용(이력/쓰기 없음)")

  // H-3) 조회 → 최초 인쇄 요청 → 사유 없는 재요청 거부 → 사유 재요청 (서버 로직 재사용), QR 규격 유지
  if (t1.ok) {
    const id = t1.target.wipUnitId
    const f1 = await act.recordWipLabelPrint({ wipUnitIds: [id], context: "WIP 라벨 WO-0001" })
    ok(f1.ok && f1.results[0].event === "WIP_LABEL_ISSUE" && f1.results[0].qrPayload === `DAEWON|WIP|1|${id}`, "H15 최초 요청 → WIP_LABEL_ISSUE · QR = DAEWON|WIP|1|<WipUnit.id>")
    const f2 = await act.recordWipLabelPrint({ wipUnitIds: [id] })
    ok(!f2.ok && f2.code === "REASON_REQUIRED" && f2.message.includes("사유"), "H16 두 번째 요청은 사유 없이 거부(재발행 사유 요구)")
    const f3 = await act.recordWipLabelPrint({ wipUnitIds: [id], reason: "이전 인쇄 취소" })
    ok(f3.ok && f3.results[0].event === "WIP_LABEL_REISSUE" && f3.results[0].issueCount === 2, "H17 사유 입력 시 WIP_LABEL_REISSUE")
    const both = await Promise.all([act.recordWipLabelPrint({ wipUnitIds: ["wip-root-2"] }), act.recordWipLabelPrint({ wipUnitIds: ["wip-root-2"] })])
    ok(both.filter((r) => r.ok).length === 1 && fake.audits.filter((a) => a.entityId === "wip-root-2").length === 1, "H18 동일 WIP 동시 발행 방지 유지")
    const wipHtml = renderToStaticMarkup(
      React.createElement(BarcodeLabel, {
        data: { kind: "WIP_QR", labelType: "WIP", itemCode: t1.target.itemCode, itemName: t1.target.itemName, wipId: id, manufacturingNo: t1.target.manufacturingNo, workOrderNo: t1.target.workOrderNo, date: "2026-10-27", dateLabel: "발행일" },
      }),
    )
    ok(wipHtml.includes('data-label-type="WIP"') && wipHtml.includes(`data-qr-payload="DAEWON|WIP|1|${id}"`) && wipHtml.includes("제조번호 26A01-ROOT") && wipHtml.includes("WO-0001"), "H19 조회된 값으로 WIP 라벨 렌더: 유형 칩 · WIP QR · 제조번호 · 작업지시")
    const img2 = svg.renderQrRgba(svg.buildWipQrSvgData(id), 8)
    const dec2 = qr.parseDaewonQr(jsQR(img2.data, img2.width, img2.height)?.data)
    ok(dec2.ok && dec2.entity === "WIP" && dec2.wipId === id, "H20 WIP QR 디코딩 → WipUnit.id 식별")
  }

  // H-4) 화면 연결 구조
  const btn = read("src/app/app/mes/material-issue/wip-label-button.tsx")
  const table = read("src/app/app/mes/material-issue/material-issue-table.tsx")
  ok(btn.includes("getWipLabelTarget({ workOrderId })") && btn.includes('labelType: "WIP"') && btn.includes("wipId: target.wipUnitId") && btn.includes("<BarcodePrintDialog"), "H21 WIP 버튼: 서버 조회 결과(WipUnit.id)로 기존 공통 라벨 창을 연다")
  ok(!/prisma|createWip|wipUnit\.create|generate|채번\(/.test(btn.replace("WIP 이 생성", "")) && !btn.includes("window.print") && !btn.includes("setTimeout"), "H22 WIP 버튼은 WIP 생성/채번/자동 인쇄를 하지 않는다(사용자 버튼 → 라벨 창 → [인쇄])")
  ok(table.includes("workOrder.allIssued && <WipLabelButton") && table.includes('import { WipLabelButton } from "./wip-label-button"'), "H23 WIP 버튼 위치: 자재출고 목록의 '출고완료'(allIssued) 작업지시 행 — 완료되지 않은 작업지시에는 없다")
  ok(!/dialog/i.test(btn.slice(0, 0)) && btn.includes("onClick={() => void handleClick()}"), "H24 라벨 창은 사용자 클릭으로만 열린다")
  const printedSrc = read("src/components/common/barcode/barcode-print-dialog.tsx")
  ok(printedSrc.includes("checkWipLabelPrintable") && printedSrc.includes("recordWipLabelPrint") && printedSrc.includes("setReprintRequired(true)"), "H25 재발행 사유 입력·서버 판정 흐름은 공통 라벨 창(기존) 그대로 사용")
  const allSrc = ["src/app/app/mes/material-issue/wip-label-button.tsx", "src/components/common/barcode/barcode-print-dialog.tsx", "src/app/label-print/label-print-client.tsx", "src/lib/actions/wip-label.actions.ts"].map(read).join("\n")
  ok(!/192\.168|ipp:\/\/|:9100|BrotherSDK|printerIp/i.test(allSrc), "H26 프린터 IP 직접 출력/자동 선택 기능 없음(브라우저 인쇄만)")
  const noScan = ["src/app/app/mes/material-issue/wip-label-button.tsx", "src/lib/actions/wip-label.actions.ts"].map(read).join("\n")
  ok(!/jsqr|camera|getUserMedia|BarcodeScanInput/i.test(noScan), "H27 카메라/스캐너 코드 없음(이번 단계 범위 밖)")
  // 출하·POP·WIP 이동·완제품입고·LOT 서버 로직이 QR/WIP 라벨 모듈에 결합되지 않았고(QR 은 선택적 편의기능), DB 스키마에 라벨/QR 전용 모델이 없다.
  // (예전에는 git diff HEAD 로 "변경 없음"을 확인했다 — 커밋 후에도, .git 없는 환경에서도 같은 목적을 내용으로 검사한다.)
  const businessModules = ["src/app/app/mes/shipments", "src/app/pop", "src/app/app/pop", "src/lib/actions/pop.actions.ts", "src/lib/actions/process-progress.actions.ts", "src/lib/actions/outsourcing.actions.ts", "src/lib/actions/wip-traceability.helpers.ts", "src/lib/actions/finished-goods.actions.ts", "src/lib/actions/lot.actions.ts"]
  // 4-2단계 예외: POP 작업지시 선택 화면 두 곳(관리자 작업대기·현장 태블릿)의 WIP QR 스캔 연결 파일뿐(POP 서버 액션·WIP 이동 헬퍼·그 밖의 현장 POP 파일은 계속 QR 에 결합되지 않는다)
  const POP_QR_UI_FILES = ["src/app/app/pop/work-queue/work-queue-client.tsx", "src/app/pop/work-select/work-select-client.tsx"]
  // 4-3단계 예외: 출하예정 등록 화면의 완제품 LOT QR 스캔 연결 파일 두 개뿐(출하 서버 액션·출하 목록/확정 화면·스키마는 계속 QR 에 결합되지 않는다 — test:shipment-fg-qr 가 따로 확인)
  const SHIPMENT_QR_UI_FILES = ["src/app/app/mes/shipments/fg-lot-qr-scan.tsx", "src/app/app/mes/shipments/shipment-form-sheet.tsx"]
  const coupledBusiness = qrCouplingViolations(businessModules, [...POP_QR_UI_FILES, ...SHIPMENT_QR_UI_FILES])
  ok(coupledBusiness.length === 0 && !/wip-label|material-issue|qr-scan/.test(stripComments(readSource("src/lib/actions/lot-label.actions.ts"))) && schemaViolations().length === 0, `H28 출하·POP·WIP 생성/이동·완제품입고/LOT 서버 로직은 QR/WIP 라벨 모듈에 결합되지 않았고 스키마에 라벨/QR 전용 모델이 없다(결합: ${coupledBusiness.join(", ") || "없음"})`)

  // ─── I. WIP 라벨 발행 조건 통일: 자재출고 완료만 허용 (서버 검증) ─────────────────────
  const elig = require("../src/lib/label/wip-label-eligibility") as typeof import("../src/lib/label/wip-label-eligibility")

  // I-1) 순수 판정 규칙
  const bomAB = [
    { componentItemId: "A", qtyPer: 2, scrapRate: 0.1 },
    { componentItemId: "B", qtyPer: 1, scrapRate: 0 },
  ]
  const prog = (reservations: Array<{ itemId: string; issuedQty: number }>, status = "IN_PROGRESS", bom = bomAB) =>
    elig.computeIssueProgress({ status, plannedQty: 10, bomItems: bom, reservations })
  ok(prog([{ itemId: "A", issuedQty: 22 }, { itemId: "B", issuedQty: 10 }]).state === "COMPLETE", "I1 모든 자재 필요수량(스크랩 포함, 22/10) 출고 → COMPLETE")
  ok(prog([{ itemId: "A", issuedQty: 22 }, { itemId: "B", issuedQty: 4 }]).state === "PARTIAL", "I2 일부 자재만 일부 수량 출고 → PARTIAL")
  ok(prog([{ itemId: "A", issuedQty: 21.9 }, { itemId: "B", issuedQty: 10 }]).state === "PARTIAL", "I3 필요수량보다 조금이라도 모자라면 PARTIAL")
  ok(prog([{ itemId: "A", issuedQty: 22 }]).state === "PARTIAL", "I4 일부 자재가 출고 전이면 PARTIAL")
  ok(prog([]).state === "NONE" && prog([{ itemId: "A", issuedQty: 0 }]).state === "NONE", "I5 출고 내역이 없으면 NONE")
  ok(prog([], "IN_PROGRESS", []).state === "NO_MATERIALS", "I6 BOM 자재가 없으면 NO_MATERIALS(완료 판정 불가 — 기존 allIssued 도 false)")
  ok(prog([{ itemId: "A", issuedQty: 30 }, { itemId: "B", issuedQty: 10 }]).state === "COMPLETE", "I7 초과 출고도 완료(대기수량 ≤ 0)")
  ok(prog([{ itemId: "A", issuedQty: 22 }, { itemId: "A", issuedQty: 0 }, { itemId: "B", issuedQty: 10 }]).state === "COMPLETE", "I8 같은 품목 예약이 여러 건이면 첫 번째 예약만 본다(기존 목록과 동일)")
  ok(prog([], "COMPLETED").listed === false && prog([], "RELEASED").listed && prog([], "IN_PROGRESS").listed && !prog([], "CANCELLED").listed, "I9 목록 대상 상태는 RELEASED/IN_PROGRESS 만")

  // I-2) 실제 getWorkOrdersForIssue(allIssued)와 같은 입력에서 같은 결과 (수정하지 않은 기존 로직과의 동등성)
  fake.reset()
  let issueActions: typeof import("../src/lib/actions/material-issue.actions") | null = null
  try {
    inject("../src/lib/auth", { getTenantId: async () => "t1", getCurrentUser: async () => fake.user, requireRole: async () => fake.user })
    issueActions = require("../src/lib/actions/material-issue.actions") as typeof import("../src/lib/actions/material-issue.actions")
  } catch (error) {
    console.log("  (material-issue.actions 를 테스트 환경에서 불러오지 못함 — 동등성 비교 생략:", String(error).slice(0, 80), ")")
  }
  if (issueActions) {
    const listed = await issueActions.getWorkOrdersForIssue("t1")
    const expectedIds = fake.workOrders.filter((w) => w.tenantId === "t1" && ["RELEASED", "IN_PROGRESS"].includes(w.status)).map((w) => w.id).sort()
    ok(listed.map((w) => w.id).sort().join() === expectedIds.join(), "I10 기존 자재출고 목록의 대상 상태 필터와 ISSUE_LISTED_STATUSES 가 일치")
    const mismatches = listed.filter((w) => {
      const src = fake.workOrders.find((x) => x.id === w.id)!
      const p = elig.computeIssueProgress({ status: src.status, plannedQty: src.plannedQty, bomItems: src.bom.bomItems, reservations: src.materialReservations })
      return (p.state === "COMPLETE") !== w.allIssued
    })
    ok(mismatches.length === 0 && listed.some((w) => w.allIssued) && listed.some((w) => !w.allIssued), `I11 실제 getWorkOrdersForIssue.allIssued 와 서버 판정이 모든 작업지시(${listed.length}건)에서 일치(완료·미완료 포함)`)
  }

  // I-3) 세 함수가 같은 조건으로 판정 (check / record / target)
  fake.reset()
  const unitFor = (id: string, workOrderId: string, extra: Partial<Unit> = {}) => fake.units.push({ id, tenantId: "t1", status: "IN_PROCESS", manufacturingNo: null, workOrderId, item: { code: "FG", name: "제품" }, ...extra })
  unitFor("wip-p", "wo-p")
  unitFor("wip-n", "wo-n")
  unitFor("wip-q", "wo-q")
  unitFor("wip-z", "wo-z")
  unitFor("wip-c2", "wo-c")
  unitFor("wip-rel", "wo-d")
  unitFor("wip-nowo", "", { workOrderId: undefined })
  unitFor("wip-xwo", "wo-other")
  unitFor("wip-ok-child", "wo-ok", { parentWipUnitId: "wip-1" })
  unitFor("wip-ok-src", "wo-ok", { sourceProductionResultId: "pr-9" })
  const woIdOf = (wipId: string) => fake.units.find((u) => u.id === wipId)?.workOrderId ?? ""
  const triple = async (wipId: string) => {
    const t = await act.getWipLabelTarget({ workOrderId: woIdOf(wipId) })
    const c = await act.checkWipLabelPrintable({ wipUnitIds: [wipId] })
    const r = await act.recordWipLabelPrint({ wipUnitIds: [wipId], reason: "사유" })
    return { t, c, r }
  }
  const same = (x: { ok: boolean; code?: string; message?: string }, y: { ok: boolean; code?: string; message?: string }) => x.ok === y.ok && x.code === y.code && x.message === y.message
  // 완료 상태 두 가지(IN_PROGRESS / RELEASED) 정상 발행
  for (const [wip, label] of [["wip-1", "출고 완료(IN_PROGRESS)"], ["wip-rel", "출고 완료(RELEASED)"]] as const) {
    if (wip === "wip-1") {
      const wt = await act.getWipLabelTarget({ workOrderId: "wo-1" }) // wo-1 의 대상은 wip-root-1
      ok(wt.ok, `I12 ${label}: getWipLabelTarget 허용`)
    } else {
      const { t, c, r } = await triple(wip)

      ok(t.ok && c.ok && r.ok, `I12 ${label}: 대상 조회·사전 확인·이력 기록 모두 허용`)
    }
  }
  const cc1 = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-root-1"] })
  const r1 = await act.recordWipLabelPrint({ wipUnitIds: ["wip-root-1"] })
  ok(cc1.ok && r1.ok && r1.results[0].event === "WIP_LABEL_ISSUE", "I13 [출고 완료 WIP 정상 발행] 사전 확인 통과 → 최초 요청 WIP_LABEL_ISSUE")
  const blocks: Array<[string, string, string]> = [
    ["wip-p", "ISSUE_INCOMPLETE", "일부만 완료"],
    ["wip-q", "ISSUE_INCOMPLETE", "일부만 완료"],
    ["wip-n", "ISSUE_INCOMPLETE", "완료되지 않았습니다"],
    ["wip-z", "ISSUE_INCOMPLETE", "BOM"],
    ["wip-c2", "WIP_NOT_ELIGIBLE", "작업지시 상태"],
    ["wip-nowo", "WIP_NOT_ELIGIBLE", "작업지시와 연결되지"],
    ["wip-xwo", "WIP_NOT_ELIGIBLE", "작업지시를 찾을 수 없어"],
    ["wip-ok-child", "WIP_NOT_ELIGIBLE", "하위 WIP"],
    ["wip-ok-src", "WIP_NOT_ELIGIBLE", "하위 WIP"],
  ]
  const auditsBefore = fake.audits.length
  for (const [wip, code, text] of blocks) {
    const { c, r } = await triple(wip)
    const t = woIdOf(wip) && !["wip-ok-child", "wip-ok-src", "wip-nowo", "wip-xwo"].includes(wip) ? await act.getWipLabelTarget({ workOrderId: woIdOf(wip) }) : null
    const sameCheckRecord = !c.ok && !r.ok && same(c, r) && c.code === code && c.message.includes(text)
    // target 은 루트가 1건일 때만 판정 도달(하위 WIP/작업지시 없음은 대상 조회 단계에서 걸러짐)
    const sameTarget = t === null || (!t.ok && t.code === code && t.message === (c as { message?: string }).message)
    ok(sameCheckRecord && sameTarget, `I14 ${wip}: ${code} — check/record${t ? "/target" : ""} 가 같은 코드·같은 메시지로 차단("${text}")`)
  }
  ok(fake.audits.length === auditsBefore, "I15 차단된 요청은 감사 이력을 하나도 남기지 않는다")

  // 최초 발행과 재발행 모두 동일한 조건: 이미 이력이 있는 WIP 도 출고 상태가 바뀌어 미완료면 재발행 차단
  fake.audits.push({ tenantId: "t1", entityType: "WipLabel", entityId: "wip-p", action: "CREATE", afterData: { event: "WIP_LABEL_ISSUE", issueCount: 1 } })
  const rp = await act.recordWipLabelPrint({ wipUnitIds: ["wip-p"], reason: "재발행 사유" })
  const cp = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-p"] })
  ok(!rp.ok && rp.code === "ISSUE_INCOMPLETE" && !cp.ok && cp.code === "ISSUE_INCOMPLETE" && fake.audits.filter((a) => a.entityId === "wip-p").length === 1, "I16 [일부 출고 WIP 차단] 이력이 있는 WIP 의 재발행도 같은 조건으로 차단(사유가 있어도)")

  // 사전 확인 이후 상태가 바뀌면 기록 시점에 다시 막는다(최종 감사 이력 기록 시점 확인)
  fake.reset()
  const ck = await act.checkWipLabelPrintable({ wipUnitIds: ["wip-a"] })
  fake.workOrders.find((w) => w.id === "wo-ok")!.materialReservations = [{ id: "r-a", itemId: "A", issuedQty: 5 }, { id: "r-b", itemId: "B", issuedQty: 10 }]
  const rk = await act.recordWipLabelPrint({ wipUnitIds: ["wip-a"] })
  ok(ck.ok && !rk.ok && rk.code === "ISSUE_INCOMPLETE" && fake.audits.length === 0, "I17 사전 확인 통과 후 출고 상태가 바뀌면(출고 취소/수정 등) 기록 시점에 다시 차단 · 이력 없음")

  // 잠금 순서: WipUnit 잠금 → 작업지시 상태 읽기 → 이력 조회 → 기록 (잠금 이후 최신 상태로 판정, 새 잠금 없음)
  fake.reset()
  await act.recordWipLabelPrint({ wipUnitIds: ["wip-b", "wip-a"] })
  const o2 = fake.ops.filter((x) => x.startsWith("tx"))
  const lastLock = Math.max(...o2.map((x, i) => (x.includes(":lock:") ? i : -1)))
  const readWo = o2.findIndex((x) => x.includes("read-workorder"))
  const readHist = o2.findIndex((x) => x.includes("read-history"))
  const firstWrite = o2.findIndex((x) => x.includes(":write:"))
  ok(lastLock < readWo && readWo < readHist && readHist < firstWrite, "I18 순서: WipUnit 행 잠금(정렬) → 작업지시 출고 상태 확인 → 이력 판정 → 기록(모두 같은 트랜잭션)")
  ok(o2.filter((x) => x.includes(":lock:")).every((x) => /:lock:wip-/.test(x)), "I19 잠그는 대상은 WipUnit 행뿐(작업지시/예약 행은 잠그지 않는다 → 자재출고 트랜잭션과 새 교착 없음)")
  const actSrc = read("src/lib/actions/wip-label.actions.ts")
  const eligFn = actSrc.slice(actSrc.indexOf("async function findIneligible"), actSrc.indexOf("/** 읽기 전용 사전 확인"))
  ok(!/\$queryRaw|\$executeRaw|FOR UPDATE|FOR SHARE|FOR NO KEY/.test(eligFn), "I20 발행 조건 확인(findIneligible)은 읽기 전용 — 잠금/쓰기 없음")
  ok((actSrc.match(/findIneligible\(/g) ?? []).length === 4 && actSrc.includes("findIneligible(tx,") && actSrc.includes("findIneligible(prisma, tenantId, units)") && actSrc.includes("findIneligible(prisma, tenantId, [root])"), "I21 세 함수(check/record/target)가 같은 findIneligible 을 사용한다")

  // 동시 발행 방지 유지 + 출고 완료 WIP 에서만
  fake.reset()
  const [dd1, dd2] = await Promise.all([act.recordWipLabelPrint({ wipUnitIds: ["wip-c"] }), act.recordWipLabelPrint({ wipUnitIds: ["wip-c"] })])
  ok([dd1, dd2].filter((r) => r.ok).length === 1 && fake.audits.filter((a) => a.entityId === "wip-c").length === 1, "I22 [WIP 동시 발행 방지] 출고 완료 WIP 의 동시 최초 요청은 여전히 1건만 기록")
  const reiss = await act.recordWipLabelPrint({ wipUnitIds: ["wip-c"] })
  const reiss2 = await act.recordWipLabelPrint({ wipUnitIds: ["wip-c"], reason: "취소" })
  ok(!reiss.ok && reiss.code === "REASON_REQUIRED" && reiss2.ok && reiss2.results[0].event === "WIP_LABEL_REISSUE", "I23 [WIP 최초·재발행] 사유 없는 재발행 거부 · 사유 있는 재발행 허용(출고 완료 조건 하에서)")
  const mixed = await act.recordWipLabelPrint({ wipUnitIds: ["wip-a", "wip-p"] })
  ok(!mixed.ok && fake.audits.every((a) => a.entityId !== "wip-a"), "I24 여러 WIP 중 하나라도 조건 미충족이면 전부 거부(부분 기록 없음)")

  // 화면 연동 구조: 출고완료 행 버튼 + 서버 재검증
  const tbl = read("src/app/app/mes/material-issue/material-issue-table.tsx")
  ok(tbl.includes("workOrder.allIssued && <WipLabelButton") && actSrc.includes("computeIssueProgress"), "I25 화면(출고완료 행에만 버튼)과 서버(computeIssueProgress)가 같은 기준 — 화면 값은 서버가 신뢰하지 않고 재검증")
  const issueCoreNow = coreIssueFingerprints(readSource("src/lib/actions/material-issue.actions.ts"))
  ok(qrCouplingViolations(["src/lib/actions/pop.actions.ts", "src/lib/actions/wip-traceability.helpers.ts", "src/lib/actions/outsourcing.actions.ts", "src/lib/actions/process-progress.actions.ts"]).length === 0 && issueCoreNow.wipCreate === CORE_ISSUE_BASELINE_FINGERPRINTS.wipCreate && issueCoreNow.wipReuse === CORE_ISSUE_BASELINE_FINGERPRINTS.wipReuse && schemaViolations().length === 0, "I26 WIP 생성(재사용/신규 생성 코드는 QR 작업 이전과 동일)·이동/분할·POP 로직은 QR/WIP 라벨에 결합되지 않았고 스키마 변경이 없다 (자재출고 액션의 LOT 적격성 검사 추가는 test:lot-issue-eligibility 에서 검증)")

  // ─── J. 서버 자동 생성 LOT 라벨 연결 (입고 응답의 확정 LOT) ─────────────────────────
  const rcvAct = read("src/lib/actions/receiving.actions.ts")
  const rcvDlg = read("src/app/app/mes/material-receipt/receiving-form-dialog.tsx")
  ok(rcvAct.includes("lotNo?: string }") && rcvAct.includes("const committed: { lotNo: string | null } = { lotNo: null }") && rcvAct.includes("committed.lotNo = null"), "J1 입고 응답 타입에 lotNo 추가 · 시도마다 초기화")
  const iAudit = rcvAct.indexOf('menuName: "자재입고"')
  const iSet = rcvAct.indexOf("committed.lotNo = resolvedLotNo")
  const iBreak = rcvAct.indexOf("      break", iSet)
  ok(iAudit > 0 && iAudit < iSet && iSet < iBreak, "J2 확정 LOT 는 트랜잭션의 모든 쓰기(재고·수불·감사) 뒤에 기록 — 중간 실패 시 값이 남지 않는다")
  const tail = rcvAct.slice(rcvAct.indexOf("safeRevalidate("))
  ok(tail.includes("prisma.lot.findFirst") && tail.includes("lotNo: committed.lotNo") && tail.includes("itemId: purchaseOrderItem.itemId") && tail.includes("isLotTracked && committed.lotNo"), "J3 커밋 뒤 DB 에서 (tenant, lotNo, 품목) Lot 행을 다시 확인한 번호만 반환 · LOT 관리 품목만")
  ok(/try \{[\s\S]*prisma\.lot\.findFirst[\s\S]*\} catch/.test(tail) && tail.includes("return confirmedLotNo ? { success: true, lotNo: confirmedLotNo } : { success: true }"), "J4 확인 실패가 입고 결과를 뒤집지 않는다(lotNo 없이 성공 반환)")
  const replayCount = (t: string) => (t.match(/return \{ success: true, replayed: true \}/g) ?? []).length
  ok(replayCount(rcvAct) === 3, "J5 재전송(replay) 응답은 QR 작업 이전과 같은 3곳 그대로(lotNo 없음 — 이번 호출에서 새로 확정한 LOT 가 아니므로)")
  // J6: 입고 확정 트랜잭션 본문(재고·검수·발주 수량·감사 기록)은 QR 작업 이전 코드와 동일(지문 비교)하고, 변경은 응답 타입의 lotNo 필드와 최종 return 뿐이다.
  const rcvTx = between(readSource("src/lib/actions/receiving.actions.ts"), RECEIVING_TX_BLOCK[0], RECEIVING_TX_BLOCK[1])
  ok(rcvTx !== null && fingerprint(rcvTx) === RECEIVING_TX_BASELINE_FINGERPRINT && /type ReceivingResult = \{[^}]*replayed\?: boolean; lotNo\?: string \}/.test(rcvAct) && rcvAct.includes("return confirmedLotNo ? { success: true, lotNo: confirmedLotNo } : { success: true }"), "J6 입고 확정 트랜잭션 본문은 QR 작업 이전과 동일(지문) — 변경은 응답의 lotNo 필드와 최종 return 뿐")
  // J7: LOT 채번 규칙/예약 모듈은 QR/라벨에 결합되지 않았고, 입고 액션의 채번 호출 지점 수도 그대로다.
  const tokenCount = (text: string, token: string) => text.split(token).length - 1
  ok(tokenCount(rcvAct, "generateCnsMaterialReceiptLotNo") === 0 && tokenCount(rcvAct, "computeNextMaterialReceiptLotNo") === 3 && qrCouplingViolations(["src/lib/lot-numbering", "src/lib/actions/lot-reservation.actions.ts"]).length === 0, "J7 LOT 채번 규칙/예약 로직은 QR/라벨에 결합되지 않았고 입고 액션의 채번 호출 지점도 그대로다")
  ok(rcvDlg.includes("serverLotNosRef.current[ins.purchaseOrderItemId] = response.lotNo") && rcvDlg.includes("response.success && response.lotNo") && rcvDlg.includes("serverLotNosRef.current[ins.purchaseOrderItemId] ?? ins.lotNo"), "J8 화면: 서버가 확인해 돌려준 LOT 를 우선, 없으면 화면에 입력·예약된 번호(수동 입력 LOT 유지)")
  ok(!/Math\.random|generateLot/.test(rcvDlg), "J9 화면에서 LOT 번호를 만들지 않는다(서버 응답 값만 보관)")
  const allDoneBranch = rcvDlg.slice(rcvDlg.indexOf("if (outcome.allDone)"), rcvDlg.indexOf("if (outcome.stoppedAt)"))
  ok(allDoneBranch.includes("setConfirmedLabels(plan)") && rcvDlg.split("setConfirmedLabels(plan)").length === 2, "J10 라벨 창(확정 후 인쇄)은 모든 품목 입고 성공(allDone) 분기에서만 열린다 — 입고 실패 시 열리지 않음")

  // 입고 일괄 처리 결과와 라벨 대상 (실제 receiving-batch 모듈 + 라벨 계획)
  const batch = require("../src/lib/receiving-batch") as typeof import("../src/lib/receiving-batch")
  const rows = [
    { purchaseOrderItemId: "poi-manual", receivedInput: 5, acceptedInput: 5, requestId: "r1" },
    { purchaseOrderItemId: "poi-auto", receivedInput: 3, acceptedInput: 3, requestId: "r2" },
  ]
  const serverLots: Record<string, string> = {}
  const okRun = await batch.runReceivingBatch(rows, {}, async (row) => {
    const res: { success: boolean; lotNo?: string } = row.purchaseOrderItemId === "poi-auto" ? { success: true, lotNo: "AUTO-20261027-001" } : { success: true }
    if (res.success && res.lotNo) serverLots[row.purchaseOrderItemId] = res.lotNo
    return res
  })
  const lotPlan = itemsLib.buildReceiptLabelPlan([
    { itemCode: "M-1", itemName: "수동 LOT 품목", uom: "KG", isLotTracked: true, lotNo: "SUP-LOT-77", receivedQty: 5, acceptedQty: 5 }, // 수동 입력 → 서버 응답에 lotNo 없음
    { itemCode: "A-1", itemName: "자동 LOT 품목", uom: "EA", isLotTracked: true, lotNo: serverLots["poi-auto"] ?? "", receivedQty: 3, acceptedQty: 3 }, // 화면 입력 없음 → 서버 확정 번호
  ])
  ok(okRun.allDone && lotPlan.items.map((l) => l.lotNo).join() === "SUP-LOT-77,AUTO-20261027-001" && lotPlan.items.every((l) => l.labelType === "RAW_LOT") && lotPlan.notices.length === 0, "J11 [수동 LOT + 서버 자동 생성 LOT] 두 품목 모두 원자재 LOT 라벨 대상 — 서버 번호는 서버 응답에서만 온다")
  const failRun = await batch.runReceivingBatch(rows, {}, async (row) => (row.purchaseOrderItemId === "poi-auto" ? { success: false, outcome: "FAILED" as const, message: "오류" } : { success: true }))
  ok(!failRun.allDone && failRun.stoppedAt === "poi-auto", "J12 [입고 실패 시 출력 차단] 한 품목이라도 실패하면 allDone=false → 라벨 창을 열지 않는다")
  const unknownRun = await batch.runReceivingBatch(rows, {}, async (row) => {
    if (row.purchaseOrderItemId === "poi-auto") throw new Error("network")
    return { success: true }
  })
  ok(!unknownRun.allDone, "J13 결과 불명(통신 오류)도 라벨 창을 열지 않는다")
  const noServerLot = itemsLib.buildReceiptLabelPlan([{ itemCode: "A-1", itemName: "자동 LOT 품목", uom: "EA", isLotTracked: true, lotNo: "", receivedQty: 3, acceptedQty: 3 }])
  ok(noServerLot.items.length === 0 && noServerLot.notices.length === 1, "J14 서버가 LOT 를 돌려주지 못하면(재전송 등) 번호를 추측하지 않고 라벨 대상에서 제외 + 사유 안내")
  ok(!lotPlan.items.some((l) => /^TEST-/.test(l.lotNo)), "J15 실제 라벨에 시험용/임의 번호가 섞이지 않는다")

  // ─── G. 소스 구조 · 범위 ────────────────────────────────────────────────
  const act0 = read("src/lib/actions/wip-label.actions.ts")
  ok(act0.startsWith('"use server"') && !/\.(create|update|delete|upsert)\(/.test(act0.replace(/recordAuditLog\(tx/g, "")), "G1 WIP 라벨 액션은 읽기 + AuditLog 기록만(WipUnit/재고/LOT 변경 없음)")
  const rec = act0.slice(act0.indexOf("export async function recordWipLabelPrint"))
  ok(rec.includes("prisma.$transaction(") && /FOR UPDATE/.test(rec) && rec.includes('"WipUnit"') && rec.includes('"tenantId"'), "G1b 기록은 prisma.$transaction + WipUnit tenant 행 FOR UPDATE(저장소 관례 pop.actions.ts 와 동일)")
  ok(rec.indexOf("FOR UPDATE") < rec.indexOf("requestCounts(tx") && rec.indexOf("requestCounts(tx") < rec.indexOf("recordAuditLog(tx"), "G1c 잠금 → 잠금 이후 이력 조회 → 같은 트랜잭션 기록 순서")
  ok(rec.includes("sortedIds") && rec.includes("[...ids].sort()") && !/recordAuditLog\(prisma/.test(act0) && !/requestCounts\(prisma/.test(rec), "G1d id 정렬 잠금(교착 방지) · 트랜잭션 밖 prisma 로 판정/기록하지 않는다")
  ok(!/\$executeRawUnsafe|\$queryRawUnsafe/.test(act0), "G1e 원시 쿼리는 모두 파라미터 바인딩(Unsafe 호출 없음)")
  const userTexts = act0 + read("src/components/common/barcode/barcode-print-dialog.tsx")
  const misleading = (userTexts.match(/(출력|인쇄|발행)\s*(이\s*|가\s*)?완료/g) ?? []).length
  const negated = (userTexts.match(/출력 완료는 아닙니다|출력 완료 여부|실제 출력 완료가 아님|출력 완료 횟수가 아님|출력 완료 확인/g) ?? []).length
  ok(misleading === negated, `G1f '출력 완료' 표현은 "아니다"는 부정/설명 문맥에서만 쓴다(전체 ${misleading}, 부정 ${negated})`)
  ok(read("src/components/common/barcode/barcode-print-dialog.tsx").includes("인쇄 요청") && act0.includes("인쇄 요청 이력"), "G1g 이력의 의미는 '인쇄 요청 이력'으로 정의·안내")
  const dlg = read("src/components/common/barcode/barcode-print-dialog.tsx")
  ok(dlg.includes("checkWipLabelPrintable") && dlg.includes("recordWipLabelPrint") && dlg.indexOf("checkWipLabelPrintable") < dlg.indexOf("recordWipLabelPrint"), "G2 다이얼로그: WIP 발행 전 사전 확인 → 감사 기록 순서")
  const testBranch = dlg.slice(dlg.indexOf("if (testMode) {"), dlg.indexOf("// 1) 읽기 전용 사전 확인"))
  ok(!testBranch.includes("recordWipLabelPrint") && !testBranch.includes("checkWipLabelPrintable") && !testBranch.includes("recordLotLabelPrint"), "G3 시험용 분기는 감사/영속화 검증을 호출하지 않는다(기존 규칙 유지)")
  const issueDlgSrc = read("src/app/app/mes/material-issue/issue-form-dialog.tsx")
  const shipSrc = read("src/app/app/mes/shipments/shipment-form-sheet.tsx")
  ok(!issueDlgSrc.includes("wipId") && !issueDlgSrc.includes("wip-label.actions") && !shipSrc.includes("labelType") && !shipSrc.includes("wip-label"), "G4 출고 처리 창/출하 화면은 WIP·유형 연동이 없다(기존 그대로)")
  const wipScreens = ["src/app/pop/production/[operationId]/production-client.tsx", "src/app/app/pop/work-queue/work-queue-client.tsx"]
  ok(wipScreens.every((f) => !read(f).includes("wip-label") && !read(f).includes("label-print")), "G5 POP/공정 화면 미연동 · 스캐너 코드 추가 없음")
  const bsi = read("src/components/common/barcode/barcode-scan-input.tsx")
  ok(!bsi.includes("parseWipQr") && !bsi.includes("parseDaewonQr"), "G6 스캐너(BarcodeScanInput)는 변경하지 않았다")
  ok(!/SHIPMENT_LABEL|PROCESS_MOVE|MOVE_LABEL|BATCH/.test(read("src/lib/label/label-spec.ts") + read("src/lib/qr/lot-qr.ts").replace("BATCH", "")), "G7 출하·공정이동 전용 라벨/QR 종류가 정의되어 있지 않다")
  const page = read("src/app/label-print/samples/label-samples-client.tsx")
  ok(!page.includes("lot-label.actions") && !page.includes("wip-label.actions") && page.includes("buildSampleLabels"), "G8 샘플 페이지는 서버 액션/DB 를 쓰지 않는다")
  ok(read("src/lib/actions/receiving.actions.ts") === read("src/lib/actions/receiving.actions.ts") && !read("src/lib/actions/receiving.actions.ts").includes("label"), "G9 입고/재고 서버 로직은 라벨 모듈에 의존하지 않는다")

  // 기존 LOT 라벨 이력/서버 로직은 WIP 라벨·자재출고와 분리된 채 유지(내용 기반 검사 — Git 상태와 무관)
  ok(qrCouplingViolations(["src/lib/actions/lot.actions.ts", "src/lib/actions/finished-goods.actions.ts"]).length === 0 && !/wip-label|material-issue|qr-scan/.test(stripComments(readSource("src/lib/actions/lot-label.actions.ts"))) && schemaViolations().length === 0, "G10 LOT 라벨 액션은 WIP 라벨·자재출고와 분리되어 있고, 완제품/LOT 서버 로직은 QR 모듈에 결합되지 않았으며, 스키마에 라벨/QR 전용 모델이 없다(입고 서버는 응답 필드 추가만 — J6, 출고 액션은 LOT 적격성 검사만 추가 — test:lot-issue-eligibility)")
  const lotDialogPart = read("src/components/common/barcode/barcode-print-dialog.tsx")
  ok(lotDialogPart.includes("recordLotLabelPrint({ lotNos, reason: effectiveReprint ? reason.trim() : undefined, purpose, context })"), "G11 LOT 라벨 이력 호출(사유 전달 방식)은 기존과 동일")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
