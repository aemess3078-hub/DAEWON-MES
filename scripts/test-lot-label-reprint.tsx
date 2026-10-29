/**
 * LOT/Serial 관리 [라벨 출력](등록된 LOT 라벨 재출력) 단위 테스트 — DB/브라우저/프린터 없음.
 *
 *  A. 순수 로직(lib/label/lot-label-reprint.ts): 라벨 유형 · 입고 건 기준 수량/일자 · 입고 이력 없음 · 맥락 문구
 *  B. 라벨 렌더링: QR 값은 LOT 번호에서만 만들어진다(재출력·수량·일자와 무관) · 일자가 없으면 표시하지 않는다
 *  C. 소스 구조: 읽기 전용 서버 액션(쓰기 없음) · 기존 출력 기능 재사용(새 출력 시스템 없음) · 기존 입고 라벨 흐름 유지 · 스키마 불변
 *
 * 실제 DB 의 조회·감사 기록, 실제 화면은 이 테스트로 검증되지 않는다(scripts/db-it/16, 17 이 검증한다).
 */
import assert from "node:assert/strict"
import { join } from "node:path"
import Module from "node:module"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readSource, schemaViolations, stripComments } from "./test-support/source-invariants"

const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

const lib = require("../src/lib/label/lot-label-reprint") as typeof import("../src/lib/label/lot-label-reprint")
const qr = require("../src/lib/qr/lot-qr") as typeof import("../src/lib/qr/lot-qr")

let passed = 0
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log(`PASS ${label}`)
}

async function main() {
  const { BarcodeLabel } = await import("../src/components/common/barcode/barcode-label")

  const rawLot = { lotNo: "26A01-1", itemCode: "RM-001", itemName: "SS400 환봉", itemType: "RAW_MATERIAL", uom: "KG", spec: "Ø120" }
  const fgLot = { lotNo: "FG-20261026-001", itemCode: "FG-001", itemName: "호퍼 가공품", itemType: "FINISHED", uom: "EA", spec: "DW-49" }
  const purchase = { key: "tx1", txNo: "TX-1", qty: 100, at: "2026-10-26T01:30:00.000Z", kind: "PURCHASE" as const, refNo: "PO-001" }
  const purchase2 = { key: "tx2", txNo: "TX-2", qty: 40, at: "2026-10-27T15:30:00.000Z", kind: "PURCHASE" as const, refNo: "PO-002" } // KST 로는 10-28
  const production = { key: "tx3", txNo: "TX-3", qty: 25, at: "2026-10-26T03:00:00.000Z", kind: "PRODUCTION" as const, refNo: "WO-2026-001" }

  // ─── A. 순수 로직 ──────────────────────────────────────────────────────────
  ok(lib.labelTypeForItemType("RAW_MATERIAL") === "RAW_LOT" && lib.labelTypeForItemType("FINISHED") === "FG_LOT" && lib.labelTypeForItemType("SEMI_FINISHED") === undefined && lib.labelTypeForItemType("CONSUMABLE") === undefined, "A1 품목 유형 → 라벨 유형: 원자재=RAW_LOT, 완제품=FG_LOT, 그 외는 유형 칩 없는 기존 LOT 라벨")
  ok(lib.receiptKindForRef("PURCHASE_ORDER") === "PURCHASE" && lib.receiptKindForRef("WORK_ORDER") === "PRODUCTION" && lib.receiptKindForRef(null) === "OTHER" && lib.dateLabelForKind("PURCHASE") === "입고일" && lib.dateLabelForKind("PRODUCTION") === "생산일", "A2 입고 근거 구분: 발주=입고일, 작업지시(생산)=생산일 — 입고 시점 라벨과 같은 문구")
  const a3 = lib.buildReprintLabelItem(rawLot, purchase)
  ok(a3.lotNo === "26A01-1" && a3.quantity === 100 && a3.uom === "KG" && a3.date === "2026-10-26" && a3.dateLabel === "입고일" && a3.labelType === "RAW_LOT" && a3.spec === "Ø120", "A3 원자재: 선택한 입고 건의 수량(100)·입고일(KST)·유형·규격이 라벨 항목이 된다")
  ok(lib.buildReprintLabelItem(rawLot, purchase2).date === "2026-10-28" && lib.buildReprintLabelItem(rawLot, purchase2).quantity === 40, "A4 입고 이력이 여러 건이면 선택한 건의 값을 쓴다(UTC 15:30 → 한국 날짜 다음 날) — 다른 건의 값이 섞이지 않는다")
  const a5 = lib.buildReprintLabelItem(fgLot, production)
  ok(a5.labelType === "FG_LOT" && a5.dateLabel === "생산일" && a5.quantity === 25 && a5.spec === null, "A5 완제품: 생산일 문구 · FG_LOT · 규격은 원자재 라벨에만")
  const a6 = lib.buildReprintLabelItem(rawLot, null)
  ok(a6.lotNo === "26A01-1" && !("quantity" in a6) && !("uom" in a6) && a6.date === "" && a6.dateLabel === "", "A6 입고 이력이 없으면 수량·단위·일자를 만들지 않는다(현재 재고·등록일로 대체하지 않음)")
  ok(lib.describeReceipt(purchase, "KG") === "2026-10-26 · 100 KG · 발주 PO-001" && lib.describeReceipt(production, "EA") === "2026-10-26 · 25 EA · 작업지시 WO-2026-001" && lib.describeReceipt({ ...purchase, refNo: null }, "KG") === "2026-10-26 · 100 KG", "A7 입고 건 설명 문구(일자 · 수량 · 발주/작업지시 번호)")
  ok(lib.buildReprintContext(rawLot, purchase).startsWith("LOT관리 라벨 출력 · 2026-10-26") && lib.buildReprintContext(rawLot, null).includes("수량·일자 없음") && lib.buildReprintContext(rawLot, { ...purchase, refNo: "P".repeat(300) }).length <= 100, "A8 감사 기록 맥락 문구(100자 이내, 어떤 입고 건 기준인지 포함)")

  // ─── B. 라벨 렌더링 ────────────────────────────────────────────────────────
  const render = (item: ReturnType<typeof lib.buildReprintLabelItem>, reprint: boolean) =>
    renderToStaticMarkup(
      React.createElement(BarcodeLabel, {
        data: { kind: "LOT_QR", labelType: item.labelType, itemCode: item.itemCode, itemName: item.itemName, lotNo: item.lotNo, spec: item.spec ?? null, quantity: item.quantity ?? null, uom: item.uom ?? null, date: item.date, dateLabel: item.dateLabel },
        reprint,
      }),
    )
  const payloadOf = (html: string) => /data-qr-payload="([^"]*)"/.exec(html)?.[1]
  const first = render(a3, false)
  const again = render(a3, true)
  const noReceipt = render(a6, true)
  ok(payloadOf(first) === qr.encodeLotQr("26A01-1") && payloadOf(first) === "DAEWON|LOT|1|26A01-1", "B1 라벨 QR 은 DAEWON|LOT|1|<LOT번호> 형식이고 LOT 번호에서만 만들어진다")
  ok(payloadOf(first) === payloadOf(again) && payloadOf(first) === payloadOf(noReceipt), "B2 같은 LOT 를 재출력·수량/일자 없이 출력해도 QR 값은 동일")
  ok(!first.includes("재출력") && again.includes("재출력"), "B3 재출력 라벨에만 '재출력' 표시")
  ok(first.includes("수량 100 KG") && first.includes("입고일 2026-10-26") && !noReceipt.includes("수량") && !noReceipt.includes("입고일") && !noReceipt.includes("생산일"), "B4 입고 건이 있으면 수량·입고일 표시, 없으면 둘 다 표시하지 않는다(임의 값 없음)")
  ok(payloadOf(render(a5, false)) === "DAEWON|LOT|1|FG-20261026-001" && render(a5, false).includes("생산일 2026-10-26") && render(a5, false).includes("수량 25 EA"), "B5 완제품 LOT 라벨도 같은 QR 형식 + 생산일·수량")

  // 인쇄 페이지로 가는 경로(작업 저장 → 불러오기)에서도 날짜가 비어 있으면 비어 있고, 출력 당일로 바뀌지 않는다.
  const jobLib = require("../src/lib/label/label-print-job") as typeof import("../src/lib/label/label-print-job")
  const spec = require("../src/lib/label/label-spec") as typeof import("../src/lib/label/label-spec")
  const mem = new Map<string, string>()
  const storage = { get length() { return mem.size }, key: (i: number) => Array.from(mem.keys())[i] ?? null, getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
  const toLabel = (item: ReturnType<typeof lib.buildReprintLabelItem>) => ({ kind: "LOT_QR" as const, labelType: item.labelType, itemCode: item.itemCode, itemName: item.itemName, lotNo: item.lotNo, spec: item.spec ?? null, quantity: item.quantity ?? null, uom: item.uom ?? null, date: item.date, dateLabel: item.dateLabel })
  const jobNone = jobLib.loadLabelJob(storage, jobLib.saveLabelJob(storage, [toLabel(a6)], true) as string)
  ok(jobNone?.labels[0].date === "" && jobNone.labels[0].quantity === null && !renderToStaticMarkup(React.createElement(BarcodeLabel, { data: jobNone.labels[0] })).includes(spec.formatLabelDate()) && !renderToStaticMarkup(React.createElement(BarcodeLabel, { data: jobNone.labels[0] })).includes("일자"), "B6 [날짜 누락] 입고 이력이 없는 LOT 의 인쇄 job 은 날짜가 빈 값 그대로이고 인쇄 페이지에서도 출력 당일·'일자' 문구로 대체되지 않는다")
  const jobSel = jobLib.loadLabelJob(storage, jobLib.saveLabelJob(storage, [toLabel(lib.buildReprintLabelItem(rawLot, purchase2))], false) as string)
  const selHtml = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: jobSel!.labels[0] }))
  ok(jobSel?.labels[0].date === "2026-10-28" && jobSel.labels[0].quantity === 40 && selHtml.includes("입고일 2026-10-28") && selHtml.includes("수량 40 KG") && !selHtml.includes("수량 100"), "B7 [선택한 입고 건] 인쇄 job 을 거쳐도 선택한 건의 날짜(2026-10-28)·수량(40)이 그대로 표시되고 다른 입고 건의 값은 섞이지 않는다")
  const fgSel = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: toLabel(lib.buildReprintLabelItem(fgLot, { ...production, at: "2026-10-26T14:59:59.000Z" })) }))
  const fgNext = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: toLabel(lib.buildReprintLabelItem(fgLot, { ...production, at: "2026-10-26T15:00:00.000Z" })) }))
  ok(fgSel.includes("생산일 2026-10-26") && fgNext.includes("생산일 2026-10-27") && fgSel.includes("완제품"), "B8 날짜는 한국 시간 기준 날짜 경계(UTC 14:59:59 → 10-26, 15:00:00 → 10-27)에서 정확하고 완제품 라벨 형식(유형 칩 '완제품'·생산일)을 유지한다")
  const rawHtml = renderToStaticMarkup(React.createElement(BarcodeLabel, { data: toLabel(a3) }))
  ok(rawHtml.includes("원자재") && rawHtml.includes("입고일 2026-10-26") && rawHtml.includes("ZT") === false && rawHtml.includes("RM-001 · Ø120") && rawHtml.includes("LOT 26A01-1"), "B9 원자재 라벨 형식 유지: 유형 칩 '원자재' · 품목코드+규격 줄 · LOT 줄 · 수량 · 입고일")

  // ─── C. 소스 구조 ──────────────────────────────────────────────────────────
  const act = stripComments(readSource("src/lib/actions/lot-label-reprint.actions.ts"))
  ok(act.trimStart().startsWith('"use server"') || readSource("src/lib/actions/lot-label-reprint.actions.ts").startsWith('"use server"'), "C1 서버 액션 파일(use server)")
  ok(!/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$transaction|\$executeRaw|\$queryRaw|recordAuditLog|revalidate|generateNumber|generateLotNo/.test(act), "C2 조회 액션은 읽기 전용 — 쓰기·트랜잭션·감사·재검증·채번 호출 없음")
  ok(act.includes("requireLotReader()") && /where:\s*\{\s*id:\s*lotId,\s*tenantId\s*\}/.test(act) && !/tenant/i.test(/getLotLabelSource\(input: \{([^}]*)\}\)/.exec(act)?.[1] ?? "tenant"), "C3 로그인·LOT 화면 권한을 확인하고 tenant 는 세션 값으로만 조회(클라이언트 tenantId 를 받지 않음)")
  ok(/txType:\s*"RECEIPT"/.test(act) && !/inventoryBalance|qtyOnHand|createdAt/.test(act), "C4 라벨 수량·일자는 입고(RECEIPT) 수불에서만 가져온다 — 현재 재고(InventoryBalance)·LOT 등록일을 쓰지 않는다")
  const dlg = stripComments(readSource("src/app/app/mes/lot/lot-label-reprint-dialog.tsx"))
  ok(dlg.includes("BarcodePrintDialog") && dlg.includes("checkLotLabelPrintable") && dlg.includes("getLotLabelSource") && !/recordLotLabelPrint|saveLabelJob|window\.open|label-print/.test(dlg), "C5 기존 BarcodePrintDialog 를 재사용하고 인쇄 요청·감사·인쇄 페이지 이동은 그 안의 기존 로직이 한다(새 출력 시스템 없음)")
  ok(!/createReceiving|issueMaterials|createFinishedGoods|updateLotStatus|prisma/.test(dlg + stripComments(readSource("src/lib/label/lot-label-reprint.ts"))), "C6 입고·출고·완제품입고·LOT 상태 변경·DB 를 호출하지 않는다")
  const cols = readSource("src/app/app/mes/lot/columns.tsx")
  ok(cols.includes('data-testid="lot-label-print-button"') && cols.includes("라벨 출력") && cols.includes("onPrintLabel(lot)") && cols.includes("updateLotStatus") === false && cols.includes("onStatusChange(lot, key)"), "C7 LOT 행마다 [라벨 출력] 버튼이 있고 기존 상태 변경·추적 동작은 그대로")
  const table = readSource("src/app/app/mes/lot/lot-data-table.tsx")
  ok(table.includes("<LotLabelReprintDialog") && table.includes("updateLotStatus(lot.id, status)") && table.includes("<LotFormSheet"), "C8 LOT 관리 화면에 라벨 창이 연결되고 기존 LOT 등록·상태 변경 흐름은 유지")
  const recv = readSource("src/app/app/mes/material-receipt/receiving-form-dialog.tsx")
  const fg = readSource("src/app/app/mes/finished-goods-receipt/receipt-dialog.tsx")
  ok(recv.includes("<BarcodePrintDialog") && recv.includes("onBeforePrint") && fg.includes('labelType: "FG_LOT"') && !/date:\s/.test(recv.slice(recv.indexOf("items={labelPlan.items.map"), recv.indexOf("items={labelPlan.items.map") + 400)), "C9 기존 원자재 입고·완제품 입고의 라벨 출력 호출은 그대로이고(출력 당일 일자 기본값 유지) 새 date 항목을 쓰지 않는다")
  const printDlg = readSource("src/components/common/barcode/barcode-print-dialog.tsx")
  ok(printDlg.includes("date: item.date ?? today") && printDlg.includes("checkLotLabelPrintable({ lotNos, purpose })") && printDlg.includes("recordLotLabelPrint({ lotNos, reason: effectiveReprint ? reason.trim() : undefined, purpose, context })"), "C10 BarcodePrintDialog 의 최초/재출력 판정·감사 기록 호출은 그대로이고 date 는 선택 항목(기본값 출력 당일)")
  ok(schemaViolations().length === 0 && !/prisma\/schema/.test(act), "C11 Prisma 스키마·마이그레이션 변경 없음(라벨/QR 전용 모델 없음)")
  const labelActions = readSource("src/lib/actions/lot-label.actions.ts")
  ok(labelActions.includes('priorCount === 0 ? "LABEL_PRINT" : "LABEL_REPRINT"') && labelActions.includes("entityType: \"LotLabel\""), "C12 최초=LABEL_PRINT, 이후=LABEL_REPRINT(사유 필수)를 기존 AuditLog 이력으로 판정하는 서버 로직은 변경 없음")

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
