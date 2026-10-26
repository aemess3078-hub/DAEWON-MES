/**
 * 대원정밀 QR 라벨 출력(Brother QL-820NWB · 29×90mm) 회귀 테스트 — DB/브라우저/프린터 연결 없음.
 *
 *  A. LOT QR 데이터 표준(DAEWON|LOT|1|<lotNo>) · 결정성 · 변하는 값 비포함
 *  B. QR 생성 + 디코딩(jsQR) → LOT 식별, quiet zone, 모듈 크기
 *  C. 29×90mm 레이아웃 계산: 긴 품목명/긴 LOT/큰 수량이 높이·폭을 넘지 않는다
 *  D. LOT 번호 없는 라벨은 출력 불가(임의 QR 식별자/CODE128 대체 없음)
 *  E. 라벨 전용 인쇄 job 전달(검증·만료·저장소 오류)
 *  F. 서버 게이트/감사(가짜 Prisma): 영속화 확인, 최초/재출력, 재출력 사유, tenant 격리, 권한
 *  G. 라벨 렌더링(react-dom/server): 90×29mm, QR 경로, 긴 이름
 *  H. 소스 구조: 라벨 전용 @page CSS, iframe 인쇄 제거, 기존 입고/재고 로직·안정화 기능 불변
 *
 * 실제 Brother 프린터 출력, Android Print Service 용지 처리, 실물 스캔은 현장 검증 대상이다.
 * 브라우저 인쇄 레이아웃(실제 Chrome PDF)은 scripts/test-qr-label-browser.ts 가 별도로 검증한다.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Module from "node:module"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import jsQR from "jsqr"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const { encodeLotQr, parseLotQr, classifyScanInput, QR_MAX_IDENTIFIER_LENGTH } =
  require("../src/lib/qr/lot-qr") as typeof import("../src/lib/qr/lot-qr")
const spec = require("../src/lib/label/label-spec") as typeof import("../src/lib/label/label-spec")
const qrSvg = require("../src/lib/qr/qr-svg") as typeof import("../src/lib/qr/qr-svg")
const jobLib = require("../src/lib/label/label-print-job") as typeof import("../src/lib/label/label-print-job")

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

const LOTS = [
  "CNS-RM-20261026-001",
  "A1",
  "FG-20261026-0007",
  "대원-원자재-20261026-001", // 한글
  "LOT 01/02#A+B&C%D", // 공백/특수문자(URL 인코딩 대상)
  "X".repeat(QR_MAX_IDENTIFIER_LENGTH), // 상한
]

async function main() {
  // ─── A. QR 데이터 표준 ──────────────────────────────────────────────────
  eq(encodeLotQr("CNS-RM-20261026-001"), "DAEWON|LOT|1|CNS-RM-20261026-001", "A1 QR 표준 형식 DAEWON|LOT|1|<lotNo>")
  eq(encodeLotQr("CNS-RM-20261026-001"), encodeLotQr("CNS-RM-20261026-001"), "A2 같은 LOT → 항상 같은 payload(재출력해도 QR 불변)")
  eq(encodeLotQr("A B/C"), "DAEWON|LOT|1|A%20B%2FC", "A3 특수문자는 인코딩된 LOT 번호로 들어간다")
  for (const lot of LOTS) {
    const parsed = parseLotQr(encodeLotQr(lot))
    ok(parsed.ok && parsed.lotNo === lot, `A4 왕복 파싱: ${lot.slice(0, 24)}`)
  }
  assert.throws(() => encodeLotQr(""), /LOT/)
  assert.throws(() => encodeLotQr("   "), /LOT/)
  assert.throws(() => encodeLotQr("A\nB"), /LOT/)
  assert.throws(() => encodeLotQr("X".repeat(QR_MAX_IDENTIFIER_LENGTH + 1)), /LOT/)
  ok(true, "A5 빈 LOT/제어문자/초과 길이는 QR 생성 거부")
  ok(!/수량|qty|품명|name/i.test(encodeLotQr("CNS-RM-1")), "A6 QR 에 수량/품명 등 변하는 값을 넣지 않는다")
  ok(classifyScanInput("DAEWON|LOT|1|CNS-RM-1").kind === "LOT_QR", "A7 스캔 분류: LOT QR")
  ok(classifyScanInput("CODE|LOT1").kind === "LEGACY_ITEM_LOT", "A8 스캔 분류: 구형 바코드는 LOT 확정에 쓰지 않는다")

  // ─── B. QR 생성 + 디코딩 ────────────────────────────────────────────────
  for (const lot of LOTS) {
    const data = qrSvg.buildLotQrSvgData(lot)
    eq(data.payload, encodeLotQr(lot), `B1 QR payload 일치: ${lot.slice(0, 20)}`)
    const img = qrSvg.renderQrRgba(data, 8)
    const decoded = jsQR(img.data, img.width, img.height)
    ok(decoded !== null, `B2 QR 디코딩 성공: ${lot.slice(0, 20)}`)
    eq(decoded?.data, data.payload, `B3 디코딩 결과 = payload: ${lot.slice(0, 20)}`)
    const parsed = parseLotQr(decoded?.data)
    ok(parsed.ok && parsed.lotNo === lot, `B4 스캔한 QR 에서 LOT 식별: ${lot.slice(0, 20)}`)
    ok(data.viewBoxSize - data.moduleCount === spec.QR_QUIET_ZONE_MODULES * 2, `B5 quiet zone ${spec.QR_QUIET_ZONE_MODULES}모듈 확보`)
    // 19mm(quiet zone 포함) 기준 모듈 크기 — 안드로이드 카메라 판독에 0.4mm 이상 권장
    const moduleMm = spec.LABEL_QR_MM_DEFAULT / data.viewBoxSize
    // 현실적인 LOT 번호(≤64자)는 0.4mm 이상. 128자 상한(비현실적)은 0.35mm 이상이면 디코딩은 되지만 현장 확인 대상이다.
    const minMm = lot.length <= 64 ? 0.4 : 0.35
    ok(moduleMm >= minMm, `B6 모듈 크기 ${moduleMm.toFixed(2)}mm ≥ ${minMm}mm (v${data.version}): ${lot.slice(0, 20)}`)
  }
  // 오염/축소 내성: 50% 해상도(스케일 4)와 상하반전 없는 일반 스케일에서도 판독
  {
    const data = qrSvg.buildLotQrSvgData("CNS-RM-20261026-001")
    const small = qrSvg.renderQrRgba(data, 3)
    ok(jsQR(small.data, small.width, small.height)?.data === data.payload, "B7 저해상도(3px/모듈)에서도 디코딩")
  }

  // ─── C. 레이아웃 ────────────────────────────────────────────────────────
  const baseItem = { kind: "LOT_QR" as const, itemCode: "CNS-0001", itemName: "브라켓", lotNo: "CNS-RM-20261026-001", quantity: 1000, uom: "EA" }
  const base = spec.computeLabelLayout(baseItem)
  ok(base.fits, "C1 기본 라벨은 29mm 높이 안에 들어간다")
  ok(base.name.lines.length === 1 && !base.name.truncated, "C2 짧은 품목명은 1줄")
  eq(spec.labelTextWidthMm() + spec.LABEL_QR_MM_DEFAULT + spec.LABEL_GAP_MM + spec.LABEL_PADDING_MM * 2, spec.LABEL_WIDTH_MM, "C3 QR + 텍스트 + 여백 = 90mm")
  ok(spec.LABEL_QR_MM_DEFAULT + spec.LABEL_PADDING_MM * 2 <= spec.LABEL_HEIGHT_MM, "C4 QR(19mm) + 위아래 여백 ≤ 29mm")

  const longName = "초고강도 알루미늄 합금 6061-T6 정밀가공 브라켓 어셈블리 (좌측 하단 보강형) 대형 특수 규격품 최종 검사 완료"
  const long = spec.computeLabelLayout({ ...baseItem, itemName: longName })
  ok(long.name.lines.length <= 2, "C5 긴 품목명은 최대 2줄")
  ok(long.fits, "C6 긴 품목명도 높이를 넘지 않는다")
  ok(long.name.lines.every((l) => spec.estimateTextWidthPt(l, long.name.fontPt) <= long.textWidthMm * spec.MM_TO_PT), "C7 품목명 각 줄이 텍스트 폭을 넘지 않는다")
  ok(long.name.truncated ? long.name.lines[long.name.lines.length - 1].endsWith("…") : true, "C8 잘릴 때는 말줄임(…) 표시")

  const wild = spec.computeLabelLayout({ ...baseItem, itemName: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" })
  ok(wild.name.lines.length <= 2 && wild.fits, "C9 공백 없는 긴 영문 품목명도 2줄 이내 · 높이 이내")

  const longLot = spec.computeLabelLayout({ ...baseItem, lotNo: "CNS-RM-20261026-001-REWORK-LINE02-SHIFT-A-BATCH-000123-EXTRA" })
  ok(longLot.lot !== null && longLot.lot.lines.length <= 2 && longLot.fits, "C10 긴 LOT 번호는 글자 축소/2줄 이내로 높이를 넘지 않는다")
  ok(longLot.lot!.lines.every((l) => spec.estimateTextWidthPt(l, longLot.lot!.fontPt, true) <= longLot.textWidthMm * spec.MM_TO_PT), "C11 LOT 줄이 텍스트 폭을 넘지 않는다")
  ok(
    longLot.lot!.lines.length === 2 && !longLot.lot!.truncated && longLot.lot!.lines[0].startsWith("LOT ") && longLot.lot!.lines.join("").replace("LOT ", "") === "CNS-RM-20261026-001-REWORK-LINE02-SHIFT-A-BATCH-000123-EXTRA",
    "C11b 긴 LOT(59자)는 말줄임 없이 글자 단위 2줄로 전체 표시",
  )
  const maxLot = spec.computeLabelLayout({ ...baseItem, itemName: longName, lotNo: "X".repeat(QR_MAX_IDENTIFIER_LENGTH) })
  ok(maxLot.lot!.lines.length <= 2, "C12 LOT 128자 상한도 2줄 이내(전체 값은 QR 에 있다)")
  ok(maxLot.usedHeightPt <= maxLot.availableHeightPt + 0.01 || !maxLot.fits, "C13 높이 초과 시 fits=false 로 정직하게 알린다")

  ok(spec.formatLabelQuantity(1234567.123456, "KG") === "1,234,567.123456 KG", "C14 수량 서식(소수 6자리)")
  ok(spec.formatLabelQuantity(null) === "", "C15 수량 없음")
  eq(spec.clampQrMm(100), spec.LABEL_QR_MM_MAX, "C16 QR 크기 상한 클램프")
  eq(spec.clampQrMm("abc"), spec.LABEL_QR_MM_DEFAULT, "C17 QR 크기 잘못된 값 → 기본값")
  ok(/^\d{4}-\d{2}-\d{2}$/.test(spec.formatLabelDate(new Date("2026-10-26T15:30:00Z"))) && spec.formatLabelDate(new Date("2026-10-26T15:30:00Z")) === "2026-10-27", "C18 날짜는 한국시간 YYYY-MM-DD")

  const barcode = spec.computeLabelLayout({ kind: "ITEM_BARCODE", itemCode: "P-1", itemName: longName, quantity: 3, uom: "EA" })
  ok(barcode.fits && barcode.name.lines.length === 1, "C19 품목 바코드 라벨(레거시) 1줄 이름 + 높이 이내")

  // ─── D. LOT 없는 라벨 ───────────────────────────────────────────────────
  const noLot = spec.getLabelBlock({ kind: "LOT_QR", itemCode: "CNS-0001", itemName: "브라켓", lotNo: "" })
  ok(!noLot.printable && noLot.reason.includes("LOT 번호가 없어"), "D1 LOT 번호가 없으면 출력 불가 사유를 안내")
  ok(!spec.getLabelBlock({ kind: "LOT_QR", itemCode: "A", itemName: "B", lotNo: undefined }).printable, "D2 lotNo 미지정도 출력 불가")
  ok(!spec.getLabelBlock({ kind: "LOT_QR", itemCode: "A", itemName: "B", lotNo: "A\nB" }).printable, "D3 QR 로 만들 수 없는 LOT 번호는 출력 불가")
  ok(spec.getLabelBlock({ kind: "LOT_QR", itemCode: "A", itemName: "B", lotNo: "L1" }).printable, "D4 LOT 번호가 있으면 출력 가능")
  ok(spec.getLabelBlock({ kind: "ITEM_BARCODE", itemCode: "A", itemName: "B" }).printable, "D5 레거시 품목 바코드는 호출자가 명시적으로 선택한 경우에만 존재")
  const blockedHtml = renderToStaticMarkup(
    React.createElement((await import("../src/components/common/barcode/barcode-label")).BarcodeLabel, {
      data: { kind: "LOT_QR", itemCode: "CNS-0001", itemName: "브라켓", lotNo: null, date: "2026-10-26", dateLabel: "입고일" },
    }),
  )
  ok(blockedHtml.includes("출력 불가") && !blockedHtml.includes("data-qr-payload") && !blockedHtml.includes("data-label-barcode"), "D6 LOT 없는 라벨은 QR/CODE128 을 만들지 않는다")

  // ─── E. 인쇄 job ────────────────────────────────────────────────────────
  class MemStorage {
    private m = new Map<string, string>()
    get length() { return this.m.size }
    key(i: number) { return Array.from(this.m.keys())[i] ?? null }
    getItem(k: string) { return this.m.get(k) ?? null }
    setItem(k: string, v: string) { this.m.set(k, v) }
    removeItem(k: string) { this.m.delete(k) }
  }
  const labelA = { kind: "LOT_QR" as const, itemCode: "CNS-0001", itemName: "브라켓", lotNo: "CNS-RM-1", quantity: 5, uom: "EA", date: "2026-10-26", dateLabel: "입고일" }
  const store = new MemStorage()
  const now = 1_800_000_000_000
  const id = jobLib.saveLabelJob(store, [labelA, { ...labelA, lotNo: "CNS-RM-2" }], false, now)
  ok(jobLib.isValidLabelJobId(id), "E1 job id 생성")
  const job = jobLib.loadLabelJob(store, id!, now + 1000)
  ok(job && job.labels.length === 2 && job.labels[1].lotNo === "CNS-RM-2" && job.reprint === false, "E2 job 저장/로드")
  ok(jobLib.loadLabelJob(store, id!, now + jobLib.LABEL_JOB_TTL_MS + 1) === null, "E3 만료된 job 은 무시")
  ok(jobLib.loadLabelJob(store, "../../etc", now) === null && jobLib.loadLabelJob(store, "zz", now) === null, "E4 잘못된 job id 거부")
  ok(jobLib.parseLabelJob("{not json", now) === null, "E5 깨진 JSON 거부")
  ok(jobLib.parseLabelJob(JSON.stringify({ v: 1, createdAt: now, labels: [{ kind: "LOT_QR", itemCode: "A", itemName: "B" }] }), now) === null, "E6 LOT_QR 인데 lotNo 없는 job 거부")
  ok(jobLib.parseLabelJob(JSON.stringify({ v: 1, createdAt: now, labels: [] }), now) === null, "E7 빈 job 거부")
  ok(
    jobLib.parseLabelJob(JSON.stringify({ v: 1, createdAt: now, labels: Array.from({ length: jobLib.LABEL_JOB_MAX_LABELS + 1 }, () => labelA) }), now) === null,
    "E8 라벨 수 상한 초과 거부",
  )
  const sanitized = jobLib.sanitizeLabel({ ...labelA, itemName: "N".repeat(500), extra: "<script>" })
  ok(sanitized !== null && sanitized.itemName.length === 200 && !("extra" in sanitized), "E9 길이 제한 · 알 수 없는 필드 제거")
  store.setItem(jobLib.LABEL_JOB_PREFIX + "0".repeat(24), "stale")
  jobLib.pruneExpiredLabelJobs(store, now + 5)
  ok(store.getItem(jobLib.LABEL_JOB_PREFIX + "0".repeat(24)) === null && store.getItem(jobLib.LABEL_JOB_PREFIX + id) !== null, "E10 만료/깨진 job 만 정리")
  const brokenStore = { ...store, length: 0, key: () => null, getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error("quota") } }
  ok(jobLib.saveLabelJob(brokenStore as never, [labelA], false, now) === null, "E11 저장소 오류(비공개 모드 등)는 null 로 알린다")
  eq(jobLib.labelPrintUrl("a".repeat(24)), `/label-print?job=${"a".repeat(24)}`, "E12 인쇄 URL")

  // ─── F. 서버 게이트/감사 (가짜 Prisma) ──────────────────────────────────
  type LotRow = { id: string; tenantId: string; lotNo: string; status: string }
  type AuditRow = { tenantId: string; entityType: string; entityId: string; action: string; afterData: Record<string, unknown> }
  const lotsDb: LotRow[] = [
    { id: "lot-1", tenantId: "t1", lotNo: "CNS-RM-1", status: "ACTIVE" },
    { id: "lot-2", tenantId: "t1", lotNo: "FG-1", status: "ACTIVE" },
    { id: "lot-x", tenantId: "t2", lotNo: "OTHER-1", status: "ACTIVE" },
  ]
  const auditDb: AuditRow[] = []
  let currentUser: { tenantId: string; name: string } | "ANON" | "DENIED" = { tenantId: "t1", name: "작업자" }
  const fakePrisma = {
    lot: {
      findMany: async (args: { where: { tenantId: string; lotNo: { in: string[] } } }) =>
        lotsDb.filter((l) => l.tenantId === args.where.tenantId && args.where.lotNo.in.includes(l.lotNo)),
    },
    auditLog: {
      findMany: async (args: { where: { tenantId: string; entityType: string; entityId: { in: string[] } } }) =>
        auditDb.filter((a) => a.tenantId === args.where.tenantId && a.entityType === args.where.entityType && args.where.entityId.in.includes(a.entityId)),
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
    recordAuditLog: async (_db: unknown, p: { tenantId: string; entityType: string; entityId: string; action: string; afterData: Record<string, unknown> }) => {
      auditDb.push({ tenantId: p.tenantId, entityType: p.entityType, entityId: p.entityId, action: p.action, afterData: p.afterData })
    },
  })
  inject("../src/lib/auth/role-permissions", {
    requireResourcePermission: async () => {
      if (currentUser === "ANON") throw new Error("UNAUTHORIZED")
      if (currentUser === "DENIED") throw new Error("이 기능을 사용할 권한이 없습니다.")
      return currentUser
    },
  })
  const actions = require("../src/lib/actions/lot-label.actions") as typeof import("../src/lib/actions/lot-label.actions")

  const notPersisted = await actions.checkLotLabelPrintable({ lotNos: ["CNS-RM-NEW"] })
  ok(!notPersisted.ok && notPersisted.code === "LOT_NOT_PERSISTED", "F1 Lot 행이 없으면(입고 미확정) 출력 불가")
  const auditBefore = auditDb.length
  const rec0 = await actions.recordLotLabelPrint({ lotNos: ["CNS-RM-NEW"] })
  ok(!rec0.ok && rec0.code === "LOT_NOT_PERSISTED" && auditDb.length === auditBefore, "F2 영속화 안 된 LOT 는 감사 기록도 남기지 않는다")
  const mixed = await actions.recordLotLabelPrint({ lotNos: ["CNS-RM-1", "CNS-RM-NEW"] })
  ok(!mixed.ok && auditDb.length === auditBefore, "F3 하나라도 미영속이면 전부 거부(부분 기록 없음)")

  const chk1 = await actions.checkLotLabelPrintable({ lotNos: ["CNS-RM-1"] })
  ok(chk1.ok && chk1.reprintLotNos.length === 0, "F4 사전 확인: 최초 출력 가능 · 재출력 아님")
  const first = await actions.recordLotLabelPrint({ lotNos: ["CNS-RM-1", "FG-1"] })
  ok(first.ok && first.results.every((r) => r.event === "LABEL_PRINT" && r.printCount === 1), "F5 최초 출력 → LABEL_PRINT")
  ok(auditDb.length === 2 && auditDb.every((a) => a.entityType === "LotLabel" && a.action === "CREATE"), "F6 AuditLog(LotLabel/CREATE)로 기록")
  eq(first.ok ? first.results[0].qrPayload : "", "DAEWON|LOT|1|CNS-RM-1", "F7 감사 기록의 QR payload 가 표준과 같다")

  const chk2 = await actions.checkLotLabelPrintable({ lotNos: ["CNS-RM-1"] })
  ok(chk2.ok && chk2.reprintLotNos.includes("CNS-RM-1"), "F8 이전 출력 이력이 있으면 사전 확인이 재출력으로 판정")
  const noReason = await actions.recordLotLabelPrint({ lotNos: ["CNS-RM-1"] })
  ok(!noReason.ok && noReason.code === "REASON_REQUIRED" && auditDb.length === 2, "F9 재출력은 사유가 없으면 거부 · 기록 없음")
  const reprint = await actions.recordLotLabelPrint({ lotNos: ["CNS-RM-1"], reason: "  라벨 훼손  " })
  ok(reprint.ok && reprint.results[0].event === "LABEL_REPRINT" && reprint.results[0].printCount === 2, "F10 사유 입력 시 LABEL_REPRINT")
  ok(auditDb[2].afterData.reason === "라벨 훼손", "F11 재출력 사유가 감사 기록에 저장")
  eq(reprint.ok ? reprint.results[0].qrPayload : "", first.ok ? first.results[0].qrPayload : "x", "F12 재출력해도 QR payload 불변")

  const crossTenant = await actions.checkLotLabelPrintable({ lotNos: ["OTHER-1"] })
  ok(!crossTenant.ok && crossTenant.code === "LOT_NOT_PERSISTED", "F13 다른 tenant LOT 는 존재 여부를 구분 없이 거부")
  const tooMany = await actions.checkLotLabelPrintable({ lotNos: Array.from({ length: 51 }, (_, i) => `L${i}`) })
  ok(!tooMany.ok && tooMany.code === "INVALID", "F14 한 번에 50건 초과 거부")
  const emptyReq = await actions.checkLotLabelPrintable({ lotNos: [] })
  ok(!emptyReq.ok && emptyReq.code === "INVALID", "F15 빈 요청 거부")
  currentUser = "ANON"
  const anon = await actions.recordLotLabelPrint({ lotNos: ["CNS-RM-1"], reason: "x" })
  ok(!anon.ok && anon.code === "UNAUTHORIZED", "F16 비로그인 거부")
  currentUser = "DENIED"
  const denied = await actions.checkLotLabelPrintable({ lotNos: ["CNS-RM-1"] })
  ok(!denied.ok && denied.code === "DENIED", "F17 권한 없음 거부")
  currentUser = { tenantId: "t1", name: "작업자" }

  // ─── G. 라벨 렌더링 ─────────────────────────────────────────────────────
  const { BarcodeLabel } = await import("../src/components/common/barcode/barcode-label")
  const html = renderToStaticMarkup(
    React.createElement(BarcodeLabel, {
      data: { kind: "LOT_QR", itemCode: "CNS-0001", itemName: longName, lotNo: "CNS-RM-20261026-001", quantity: 1000, uom: "EA", date: "2026-10-26", dateLabel: "입고일" },
    }),
  )
  ok(html.includes("width:90mm") && html.includes("height:29mm"), "G1 라벨 면 90mm × 29mm")
  ok(html.includes('data-label-state="ready"') && html.includes('data-qr-payload="DAEWON|LOT|1|CNS-RM-20261026-001"'), "G2 QR 이 동기 렌더(빈 QR 없음) · payload 표준")
  ok(/<path d="M\d+ \d+h\d+v1h-\d+z/.test(html), "G3 QR 모듈 경로가 실제로 그려진다")
  ok(html.includes("대원정밀") && html.includes("CNS-0001") && html.includes("CNS-RM-20261026-001") && html.includes("1,000 EA") && html.includes("입고일 2026-10-26"), "G4 대원정밀·품목코드·LOT·수량·일자 표시")
  ok(!html.includes("data-label-barcode"), "G5 LOT QR 라벨에는 CODE128 이 없다")
  const reprintHtml = renderToStaticMarkup(
    React.createElement(BarcodeLabel, {
      reprint: true,
      data: { kind: "LOT_QR", itemCode: "A", itemName: "B", lotNo: "L1", date: "2026-10-26", dateLabel: "입고일" },
    }),
  )
  ok(reprintHtml.includes("재출력"), "G6 재출력 표시")
  ok(!html.includes("width:24mm") && html.includes("width:19mm"), "G7 QR 한 변 19mm(18~20mm 범위)")

  // ─── H. 소스 구조 · 회귀 ────────────────────────────────────────────────
  const printClient = read("src/app/label-print/label-print-client.tsx")
  ok(/@page \{ size: \$\{pageW\}mm \$\{pageH\}mm; margin: 0; \}/.test(printClient), "H1 @page 크기 지정 · 여백 0")
  ok(printClient.includes("const pageW = rotate ? LABEL_HEIGHT_MM : LABEL_WIDTH_MM") && printClient.includes("const pageH = rotate ? LABEL_WIDTH_MM : LABEL_HEIGHT_MM"), "H2 기본 가로 90×29, 회전 시 29×90")
  ok(/break-after: page/.test(printClient) && /:last-child \{ break-after: auto/.test(printClient), "H3 라벨 1장당 1페이지 · 마지막 빈 페이지 방지")
  ok(/lp-noprint \{ display: none !important/.test(printClient), "H4 인쇄 시 툴바·안내 숨김")
  ok(/overflow: visible !important/.test(printClient), "H5 globals.css 의 body overflow:hidden 을 인쇄 때 해제")
  ok(printClient.includes('data-label-state') && printClient.includes('"pending"'), "H6 QR 렌더 완료(pending 없음) 확인 후에만 인쇄")
  ok(printClient.includes("fonts?.ready") && printClient.includes("requestAnimationFrame"), "H7 폰트 로딩·페인트 후 인쇄")
  ok(!existsLabelPrintUnderApp(), "H8 /label-print 는 /app 레이아웃(메뉴·헤더) 밖에 있다")

  const dialog = read("src/components/common/barcode/barcode-print-dialog.tsx")
  ok(!dialog.includes("react-to-print") && !dialog.includes("useReactToPrint"), "H9 숨은 iframe 인쇄(react-to-print) 제거")
  ok(dialog.includes('window.open("", "_blank")') && dialog.indexOf("window.open") < dialog.indexOf("await checkLotLabelPrintable"), "H10 팝업 차단 방지: await 이전에 동기적으로 창을 연다")
  const iCheck = dialog.indexOf("await checkLotLabelPrintable")
  const iSave = dialog.indexOf("saveLabelJob(window.localStorage")
  const iBefore = dialog.indexOf("await onBeforePrint()")
  const iAudit = dialog.indexOf("await recordLotLabelPrint")
  const iNav = dialog.indexOf("printWindow.location.href")
  ok(iCheck > 0 && iCheck < iSave && iSave < iBefore && iBefore < iAudit && iAudit < iNav, "H11 순서: 영속화 확인 → job 저장 → onBeforePrint → 감사 기록 → 인쇄 페이지")
  ok(dialog.includes("재출력 사유") && dialog.includes("onBeforePrint") && dialog.includes("printBlockedReason"), "H12 재출력 사유 · onBeforePrint · 출력 차단 사유 유지")
  ok(/reprint && !reason\.trim\(\)/.test(dialog), "H13 재출력 모드는 사유 없이 인쇄 불가")

  const label = read("src/components/common/barcode/barcode-label.tsx")
  ok(!/Math\.random|crypto/.test(label), "H14 임의 QR 식별자를 만들지 않는다")

  const receiving = read("src/app/app/mes/material-receipt/receiving-form-dialog.tsx")
  ok(receiving.includes("runReceivingBatch") && receiving.includes("requestIdFor(ins.purchaseOrderItemId)") && receiving.includes("createReceivingInspection({"), "H15 입고 확정 호출(멱등 requestId · 배치) 유지")
  ok(receiving.includes("onBeforePrint={isConfirmedPrint ? undefined : handleBeforePrint}") && receiving.includes("markLotReservationPrinted"), "H16 기존 onBeforePrint(채번 예약 인쇄 표시) 유지")
  ok(receiving.includes("printBlockedReason") && receiving.includes("setConfirmedLabels(labels)"), "H17 입고 확정(영속화) 후에만 인쇄 · 확정 후 라벨 단계")
  const fg = read("src/app/app/mes/finished-goods-receipt/receipt-dialog.tsx")
  ok(fg.includes("createFinishedGoodsReceiptAction(") && fg.includes("setReceivedLotNo(res.lotNo)") && fg.includes("lotNo: receivedLotNo ?? undefined"), "H18 완제품 입고 후 서버가 발번한 LOT 로 라벨 출력")
  ok(read("src/app/app/mes/material-issue/issue-form-dialog.tsx").includes("legacyItemBarcode") && read("src/app/app/mes/shipments/shipment-form-sheet.tsx").includes("legacyItemBarcode"), "H19 출하/자재출고의 기존 품목 바코드 라벨은 명시적 옵션으로 유지")

  // 입고·재고·LOT 서버 로직은 이 작업에서 수정하지 않는다(안정화 PR #5 기능 보존)
  const receivingAction = read("src/lib/actions/receiving.actions.ts")
  ok(/requestId/.test(receivingAction) && /pg_advisory_xact_lock|advisory/i.test(receivingAction), "H20 입고 서버 액션: 멱등 requestId · advisory lock 유지")
  ok(!receivingAction.includes("lot-label.actions") && !read("src/lib/actions/lot.actions.ts").includes("lot-label.actions"), "H21 입고/LOT 서버 액션은 라벨 모듈에 의존하지 않는다")
  const labelAction = read("src/lib/actions/lot-label.actions.ts")
  ok(/prisma\.(lot|auditLog)\.(findMany)/.test(labelAction) && !/\.(create|update|delete|upsert)\(/.test(labelAction.replace(/recordAuditLog\(prisma/g, "")), "H22 라벨 액션은 읽기 + AuditLog 기록만 한다(재고/LOT 변경 없음)")
  ok(labelAction.startsWith('"use server"'), "H23 라벨 액션은 server action 파일")

  console.log(`\n${passed} checks passed`)
}

function existsLabelPrintUnderApp(): boolean {
  try {
    readFileSync(join(process.cwd(), "src/app/app/label-print/page.tsx"), "utf8")
    return true
  } catch {
    return false
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
