/**
 * Phase 7A — 기준정보(Master) 이관 파이프라인 테스트 (익명 합성 workbook · DB/실제 Excel 비의존)
 *
 * 실행: npm run test:master-migration
 *
 *  MD1~MD4   Item 파싱 / 중복 / 선행 0 / 유형 추론
 *  MD5~MD12  BOM 정상 / 중복 / "." / 0·음수 / 누락 구성품 / 순환 / 자기참조 / 다단계
 *  MD13~15   고객/공급업체 중복 / BOTH 후보
 *  MD16~18   CREATE / MATCH / CONFLICT
 *  MD19~23   운영 정보(재고/수주/발주/WIP/생산) 제외
 *  MD24~25   seed 멱등 / seed 에 운영 정보 행 0
 *  PI1~PI13  Phase 7B-2 운영 import 가드 / CREATE-only / 감사 / 롤백
 *  MC1~MC12  Phase 7C 운영 Master 최종 감사(순수 함수, 읽기 전용)
 *  + 승인 결정/일괄 정책, 데이터셋 변조 검출, seed 가드, 정적 점검(운영 seed/배포 자동 실행 금지, 개인정보 산출물 gitignore)
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { analyzeMaster, partnerFoldKey } from "../src/lib/master-migration/analyze"
import {
  auditBoms,
  auditItems,
  auditItemSuppliers,
  auditPartners,
  buildReviewPack,
  compareToDataset,
  coverageAndDependencies,
  csvCell,
  masterBaseline,
  rawUsage,
  type ProdMaster,
} from "../src/lib/master-migration/audit"
import { applyMasterDataset, loadExistingSnapshot, type MasterApplyDb } from "../src/lib/master-migration/apply"
import { buildApprovedDataset, datasetCounts, validateDatasetShape } from "../src/lib/master-migration/dataset"
import { extractDaewonWorkbook } from "../src/lib/master-migration/extract"
import { reconcileCandidates, reconcileDataset, summarize } from "../src/lib/master-migration/reconcile"
import { summarizeAnalysis, summarizeSeedDataset } from "../src/lib/master-migration/report"
import { assertDevSeedTarget, assertProductionImportAllowed, isProductionImportGuardError, isSeedGuardError } from "../src/lib/master-migration/seed-guard"
import { buildSheetReport } from "../src/lib/master-migration/sheet-report"
import { inspectCode, parseQty } from "../src/lib/master-migration/text"
import type { ApprovedMasterDataset, ExistingMasterSnapshot, GridCell, GridLike, MasterDecisions } from "../src/lib/master-migration/types"
import { makeFakeDb } from "./helpers/fake-db"

let passed = 0
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}
function section(t: string) {
  console.log("\n── " + t)
}

// ═════════════════════════════════════════════════════════════════════════════
// 익명 합성 workbook
// ═════════════════════════════════════════════════════════════════════════════

class MemGrid implements GridLike {
  private cells = new Map<number, GridCell>()
  private fmt = new Map<number, string>()
  constructor(readonly name: string) {}
  set(r: number, c: number, v: GridCell, format?: string) {
    this.cells.set(r * 100000 + c, v)
    if (format) this.fmt.set(r * 100000 + c, format)
    return this
  }
  get(r: number, c: number): GridCell {
    return this.cells.get(r * 100000 + c)
  }
  format(r: number, c: number) {
    return this.fmt.get(r * 100000 + c)
  }
  get maxRow() {
    let m = 0
    this.cells.forEach((_v, k) => (m = Math.max(m, Math.floor(k / 100000))))
    return m
  }
  get maxCol() {
    let m = 0
    this.cells.forEach((_v, k) => (m = Math.max(m, k % 100000)))
    return m
  }
  get nonEmptyCount() {
    return this.cells.size
  }
}

type Mat = { code: GridCell; name?: GridCell; spec?: GridCell; supplier?: GridCell; uom?: GridCell }
type BomSpec = { no: number; product: GridCell; lines: Array<{ code: GridCell; name?: GridCell; spec?: GridCell; qty: GridCell; uom?: GridCell }> }

function workbook(opts: {
  materials: Mat[]
  boms: BomSpec[]
  orders?: Array<{ product: string; customer: string; qty?: number; due?: number }>
  stock?: Array<{ code: string; name?: string; spec?: string; supplier?: string; qty?: number }>
  extraSheets?: GridLike[]
}): GridLike[] {
  const s = new MemGrid("설정")
  opts.materials.forEach((m, i) => {
    const r = 11 + i
    s.set(r, 2, m.code)
    if (m.name !== undefined) s.set(r, 3, m.name)
    if (m.spec !== undefined) s.set(r, 4, m.spec)
    if (m.supplier !== undefined) s.set(r, 5, m.supplier)
    if (m.uom !== undefined) s.set(r, 6, m.uom)
  })
  const db = new MemGrid("DB")
  opts.boms.forEach((b, i) => {
    db.set(i + 1, 1, b.no)
    db.set(i + 1, 2, b.product)
    const col = 5 * b.no
    b.lines.forEach((l, j) => {
      const r = 11 + j
      db.set(r, col, l.code)
      if (l.name !== undefined) db.set(r, col + 1, l.name)
      if (l.spec !== undefined) db.set(r, col + 2, l.spec)
      db.set(r, col + 3, l.qty)
      if (l.uom !== undefined) db.set(r, col + 4, l.uom)
    })
  })
  const o = new MemGrid("수주관리대장")
  ;(opts.orders ?? []).forEach((x, i) => {
    const r = 11 + i
    o.set(r, 2, "ORD-" + i).set(r, 3, x.product).set(r, 4, x.qty ?? 5).set(r, 5, x.due ?? 46174).set(r, 7, x.customer)
  })
  const st = new MemGrid("재고관리대장")
  st.set(2, 8, 45296)
  ;(opts.stock ?? []).forEach((x, i) => {
    const r = 11 + i
    st.set(r, 2, x.code)
    if (x.name !== undefined) st.set(r, 3, x.name)
    if (x.spec !== undefined) st.set(r, 4, x.spec)
    if (x.supplier !== undefined) st.set(r, 5, x.supplier)
    st.set(r, 7, x.qty ?? 999).set(r, 9, 12345) // 재고 수량(이관 대상 아님)
  })
  return [s, db, o, st, ...(opts.extraSheets ?? [])]
}

const MATS: Mat[] = [
  { code: "M-001", name: "자재A", spec: "SPEC-A", supplier: "공급가", uom: "EA" },
  { code: "M-002", name: "자재B", spec: "SPEC-B", supplier: "공급나", uom: "EA" },
  { code: "M-003", name: "자재C", spec: "SPEC-C", supplier: "공급가", uom: "SET" },
]
const BASE_BOMS: BomSpec[] = [
  { no: 1, product: "P-1", lines: [{ code: "M-001", name: "자재A", spec: "SPEC-A", qty: 2, uom: "EA" }, { code: "M-002", name: "자재B", spec: "SPEC-B", qty: 1, uom: "EA" }] },
  { no: 2, product: "P-2", lines: [{ code: "M-003", name: "자재C", spec: "SPEC-C", qty: 3, uom: "SET" }, { code: "M-001", name: "자재A", spec: "SPEC-A", qty: 1, uom: "EA" }] },
]
const analyze = (sheets: GridLike[]) => {
  const ex = extractDaewonWorkbook(sheets)
  return { ex, a: analyzeMaster(ex) }
}
const item = (a: ReturnType<typeof analyzeMaster>, code: string) => a.items.find((i) => i.code === code)
const bom = (a: ReturnType<typeof analyzeMaster>, code: string) => a.boms.find((b) => b.parentCode === code)

async function main() {
  // ═══ MD1~MD4 Item ═════════════════════════════════════════════════════════
  section("MD1~MD4 Item")
  {
    const { a } = analyze(workbook({ materials: MATS, boms: BASE_BOMS }))
    eq(a.items.length, 5, "MD1 Item 후보 = 자재 3 + 제품 2")
    const m = item(a, "M-001")!
    eq([m.proposed.name, m.proposed.spec, m.proposed.uom, m.proposed.itemType, m.grade], ["자재A", "SPEC-A", "EA", "RAW_MATERIAL", "SAFE"], "MD1 자재 파싱(코드/품명/규격/단위) = SAFE")
    eq(item(a, "M-003")!.proposed.uom, "SET", "MD1 SET 단위 매핑")
    const p = item(a, "P-1")!
    eq([p.proposed.itemType, p.grade, p.issues.map((i) => i.code).sort()], ["FINISHED", "REVIEW", ["NAME_MISSING", "SPEC_MISSING", "UOM_MISSING"]], "MD1 제품은 품명/규격/단위가 Excel 에 없어 REVIEW(자동 추정 안 함)")
    eq(p.suggestions.name, "P-1", "제품 품명은 '제안'으로만 코드값 제시")
    ok(p.proposed.name === null && p.proposed.uom === null, "제안은 proposed 에 반영되지 않음")

    // MD2 중복 코드
    const dup = analyze(workbook({ materials: [...MATS, { code: "M-001", name: "자재A", spec: "SPEC-A", uom: "EA" }], boms: BASE_BOMS }))
    const d = item(dup.a, "M-001")!
    ok(d.grade === "REVIEW" && d.issues.some((i) => i.code === "DUPLICATE_CODE"), "MD2 같은 코드 중복 → REVIEW(DUPLICATE_CODE)")
    eq(dup.a.items.filter((i) => i.code === "M-001").length, 1, "중복 코드를 하나의 후보로 모으되 삭제하지 않고 REVIEW")
    const dupConflict = analyze(workbook({ materials: [...MATS, { code: "M-002", name: "다른이름", spec: "SPEC-B", uom: "EA" }], boms: BASE_BOMS }))
    ok(item(dupConflict.a, "M-002")!.issues.some((i) => i.code === "NAME_CONFLICT"), "MD2 같은 코드 다른 품명 → NAME_CONFLICT")
    // 같은 품명 다른 코드는 서로 다른 Item (코드가 정체성)
    const sameName = analyze(workbook({ materials: [...MATS, { code: "M-009", name: "자재A", spec: "SPEC-A", uom: "EA" }], boms: BASE_BOMS }))
    ok(item(sameName.a, "M-009") !== undefined && item(sameName.a, "M-001") !== undefined, "같은 품명 다른 코드는 별개 품목(품명으로 병합 안 함)")
  }
  {
    // MD3 선행 0 / 숫자 셀 / 공백 / 숨은 문자 / 전각 / 대소문자
    const hidden = "M-​004"
    const full = "Ｍ-005" // 전각 M
    const sheets = workbook({
      materials: [
        { code: "00123", name: "선행0", spec: "S", uom: "EA" },
        { code: 456, name: "숫자셀", spec: "S", uom: "EA" },
        { code: " M-100 ", name: "공백", spec: "S", uom: "EA" },
        { code: hidden, name: "숨은문자", spec: "S", uom: "EA" },
        { code: full, name: "전각", spec: "S", uom: "EA" },
        { code: "ab-1", name: "소문자", spec: "S", uom: "EA" },
        { code: "AB-1", name: "대문자", spec: "S", uom: "EA" },
      ],
      boms: [],
    })
    const { a } = analyze(sheets)
    eq(item(a, "00123")!.code, "00123", "MD3 문자열 선행 0 코드는 원본 그대로")
    eq(item(a, "00123")!.issues.map((i) => i.code), ["TYPE_UNDETERMINED"], "MD3 선행 0 문자열 코드 자체에는 코드 문제가 없음(미참조 유형 REVIEW 만)")
    const numeric = item(a, "456")!
    ok(numeric.issues.some((i) => i.code === "CODE_NUMERIC_CELL") && numeric.grade === "REVIEW", "MD3 숫자 셀 코드 → REVIEW(선행 0/지수 손실 가능)")
    ok(item(a, " M-100 ")!.issues.some((i) => i.code === "CODE_OUTER_WHITESPACE"), "MD3 앞뒤 공백 → REVIEW (코드는 trim 하지 않고 원본 유지)")
    ok(item(a, hidden)!.issues.some((i) => i.code === "CODE_HIDDEN_CHAR"), "MD3 숨은 문자 → REVIEW")
    ok(item(a, full)!.issues.some((i) => i.code === "CODE_FULLWIDTH"), "MD3 전각 문자 → REVIEW")
    ok(item(a, "ab-1")!.issues.some((i) => i.code === "CODE_NEAR_DUPLICATE") && item(a, "AB-1")!.issues.some((i) => i.code === "CODE_NEAR_DUPLICATE"), "MD3 대소문자만 다른 코드 → 근접 중복(둘 다 보존)")
    eq(inspectCode(123, "00000").diagnostics, ["NUMERIC_CELL", "LEADING_ZERO_FORMAT"], "숫자 서식(0 채움) 진단")
    // 품명을 코드로 대체하지 않는다
    const noCode = analyze(workbook({ materials: [{ code: undefined as unknown as GridCell, name: "코드없음", spec: "S", uom: "EA" }], boms: [] }))
    ok(noCode.a.items.length === 1 && noCode.a.items[0].grade === "REJECT" && noCode.a.items[0].code === "", "코드 없는 행 → REJECT (품명을 코드로 쓰지 않음)")
  }
  {
    // MD4 유형 추론: FINISHED / SEMI / RAW / 미참조 REVIEW
    const sheets = workbook({
      materials: [...MATS, { code: "M-UNUSED", name: "미사용", spec: "S", uom: "EA" }],
      boms: [
        { no: 1, product: "P-1", lines: [{ code: "P-2", qty: 1 }, { code: "M-001", qty: 2 }] },
        { no: 2, product: "P-2", lines: [{ code: "M-002", qty: 1 }] },
      ],
    })
    const { a } = analyze(sheets)
    eq(item(a, "P-1")!.proposed.itemType, "FINISHED", "MD4 최상위 제품 → FINISHED")
    eq(item(a, "P-2")!.proposed.itemType, "SEMI_FINISHED", "MD4 상위이면서 다른 BOM 의 구성품 → SEMI_FINISHED")
    eq(item(a, "M-001")!.proposed.itemType, "RAW_MATERIAL", "MD4 구성품으로만 → RAW_MATERIAL")
    const un = item(a, "M-UNUSED")!
    ok(un.proposed.itemType === null && un.grade === "REVIEW" && un.issues.some((i) => i.code === "TYPE_UNDETERMINED"), "MD4 어떤 BOM 에도 안 쓰이는 자재 → 유형 확정 불가 REVIEW")
    eq(un.suggestions.itemType, "RAW_MATERIAL", "제안만 제시(자동 확정 안 함)")
  }

  // ═══ MD5~MD12 BOM ═════════════════════════════════════════════════════════
  section("MD5~MD12 BOM")
  {
    const { a } = analyze(workbook({ materials: MATS, boms: BASE_BOMS }))
    const b = bom(a, "P-1")!
    eq([b.grade, b.lines.length, b.lines.map((l) => l.qtyPer), b.depth], ["SAFE", 2, [2, 1], 2], "MD5 정상 BOM: 줄/수량/깊이, SAFE")
    eq(b.lines.map((l) => l.seq), [1, 2], "줄 순서(seq) 보존")
    eq(a.maxBomDepth, 2, "최대 깊이 보고")
  }
  {
    // MD6 중복 구성품 — 원본 삭제 금지, 합계 후보만
    const { a } = analyze(
      workbook({ materials: MATS, boms: [{ no: 1, product: "P-1", lines: [{ code: "M-001", qty: 2 }, { code: "M-002", qty: 1 }, { code: "M-001", qty: 3 }] }] })
    )
    const b = bom(a, "P-1")!
    eq(b.lines.length, 3, "MD6 중복 구성품 줄을 삭제/병합하지 않음")
    eq(a.duplicateComponents, [{ parentCode: "P-1", componentCode: "M-001", lineCount: 2, qtys: [2, 3], sumQty: 5, rows: [11, 13] }], "MD6 중복 보고(줄별 수량 + 합계 후보 5)")
    ok(b.grade === "REVIEW" && b.lines[0].issues.some((i) => i.code === "DUPLICATE_COMPONENT"), "MD6 중복 → REVIEW(합산은 승인 필요)")
    const ds = buildApprovedDataset(a, { workbookSha256: "x", decisions: { items: { "P-1": { accept: true, name: "제품1", uom: "EA" } } } })
    eq(ds.boms.length, 0, "REVIEW BOM 은 승인 전 데이터셋에 없음")
    const ds2 = buildApprovedDataset(a, { workbookSha256: "x", decisions: { items: { "P-1": { accept: true, name: "제품1", uom: "EA" } }, boms: { "P-1": { accept: true } } } })
    eq(ds2.boms[0].lines.map((l) => l.qtyPer), [2, 1, 3], "승인 후에도 줄은 원본 그대로(자동 합산 없음)")
  }
  {
    // MD7 "." / MD8 0·음수·빈칸·문자
    const mk = (qty: GridCell) => analyze(workbook({ materials: MATS, boms: [{ no: 1, product: "P-1", lines: [{ code: "M-001", qty }, { code: "M-002", qty: 1 }] }] })).a
    const dot = mk(".")
    const l = bom(dot, "P-1")!.lines[0]
    ok(l.grade === "REJECT" && l.qtyPer === null && l.issues[0].code === "INVALID_QTY", 'MD7 "." → REJECT, 수량 null(1 로 바꾸지 않음)')
    eq(bom(dot, "P-1")!.grade, "REJECT", "MD7 REJECT 줄이 있으면 BOM 전체 REJECT(부분 BOM 방지)")
    for (const [label, v] of [["0", 0], ["음수", -1], ["빈칸", undefined], ["문자", "abc"], ["숫자 문자열", "5"]] as Array<[string, GridCell]>) {
      const r = mk(v)
      ok(bom(r, "P-1")!.lines[0].grade === "REJECT", `MD8 수량 ${label} → REJECT`)
    }
    eq(parseQty(1.5), 1.5, "소수 수량 허용")
    eq([parseQty(Number.NaN), parseQty(Number.POSITIVE_INFINITY)], [null, null], "NaN/Infinity → null")
  }
  {
    // MD9 구성품 Item 없음 / MD10 순환 / MD11 자기참조 / MD12 다단계
    const missing = analyze(workbook({ materials: MATS, boms: [{ no: 1, product: "P-1", lines: [{ code: "M-001", qty: 1 }, { code: "GHOST", qty: 1 }] }] })).a
    ok(bom(missing, "P-1")!.lines[1].issues.some((i) => i.code === "COMPONENT_NOT_FOUND") && bom(missing, "P-1")!.grade === "REJECT", "MD9 구성품 Item 없음 → REJECT")
    ok(item(missing, "GHOST") === undefined, "MD9 누락 구성품 Item 을 임의 생성하지 않음")

    const cyc = analyze(
      workbook({
        materials: MATS,
        boms: [
          { no: 1, product: "A", lines: [{ code: "B", qty: 1 }, { code: "M-001", qty: 1 }] },
          { no: 2, product: "B", lines: [{ code: "C", qty: 1 }] },
          { no: 3, product: "C", lines: [{ code: "A", qty: 1 }] },
          { no: 4, product: "OK", lines: [{ code: "M-002", qty: 1 }] },
        ],
      })
    ).a
    eq(cyc.cycles.map((c) => c.slice().sort()), [["A", "B", "C"]], "MD10 A→B→C→A 순환 검출")
    ok(["A", "B", "C"].every((p) => bom(cyc, p)!.grade === "REJECT") && bom(cyc, "OK")!.grade === "SAFE", "MD10 순환 BOM 은 REJECT, 무관한 BOM 은 영향 없음")
    eq(bom(cyc, "A")!.depth, null, "순환 BOM 깊이 = null")

    const self = analyze(workbook({ materials: MATS, boms: [{ no: 1, product: "P-1", lines: [{ code: "P-1", qty: 1 }, { code: "M-001", qty: 1 }] }] })).a
    ok(bom(self, "P-1")!.lines[0].issues.some((i) => i.code === "SELF_REFERENCE") && bom(self, "P-1")!.grade === "REJECT", "MD11 자기 자신 BOM → REJECT")

    const multi = analyze(
      workbook({
        materials: MATS,
        boms: [
          { no: 1, product: "TOP", lines: [{ code: "SEMI1", qty: 2 }] },
          { no: 2, product: "SEMI1", lines: [{ code: "SEMI2", qty: 3 }, { code: "M-001", qty: 1 }] },
          { no: 3, product: "SEMI2", lines: [{ code: "M-002", qty: 4 }] },
        ],
      })
    ).a
    eq([bom(multi, "TOP")!.depth, bom(multi, "SEMI1")!.depth, bom(multi, "SEMI2")!.depth, multi.maxBomDepth], [4, 3, 2, 4], "MD12 다단계 깊이(TOP→SEMI1→SEMI2→RAW)")
    eq([item(multi, "TOP")!.proposed.itemType, item(multi, "SEMI1")!.proposed.itemType, item(multi, "SEMI2")!.proposed.itemType], ["FINISHED", "SEMI_FINISHED", "SEMI_FINISHED"], "MD12 다단계 유형")
  }
  {
    // BOM 없는 제품 / 수주에만 있는 제품
    const { a } = analyze(
      workbook({ materials: MATS, boms: [{ no: 1, product: "P-1", lines: [] }, { no: 2, product: "P-2", lines: [{ code: "M-001", qty: 1 }] }], orders: [{ product: "P-ORDER-ONLY", customer: "고객가" }] })
    )
    ok(a.finishedWithoutBom.includes("P-1") && a.finishedWithoutBom.includes("P-ORDER-ONLY"), "BOM 없는 제품 목록(자동 BOM 생성 없음)")
    ok(item(a, "P-ORDER-ONLY")!.grade === "REVIEW" && item(a, "P-ORDER-ONLY")!.issues.some((i) => i.code === "ORDER_ONLY_PRODUCT"), "수주에만 나타나는 제품 → REVIEW(운영 정보에서 유래)")
    eq(bom(a, "P-1"), undefined, "BOM 줄이 없는 제품은 BOM 후보를 만들지 않음")
  }

  // ═══ MD13~15 거래처 ═══════════════════════════════════════════════════════
  section("MD13~MD15 Customer / Supplier / BOTH")
  {
    const { a, ex } = analyze(
      workbook({
        materials: [
          { code: "M-001", name: "자재A", spec: "S", supplier: "(주)가나", uom: "EA" },
          { code: "M-002", name: "자재B", spec: "S", supplier: "가나", uom: "EA" },
          { code: "M-003", name: "자재C", spec: "S", supplier: "다라", uom: "EA" },
        ],
        boms: BASE_BOMS,
        orders: [
          { product: "P-1", customer: "고객가" },
          { product: "P-1", customer: "고객가" },
          { product: "P-2", customer: "고객나" },
          { product: "P-2", customer: "다라" }, // 공급업체와 같은 이름
        ],
      })
    )
    const cust = a.partners.find((p) => p.name === "고객가")!
    eq([cust.partnerType, cust.occurrences, cust.code, cust.grade], ["CUSTOMER", 2, null, "REVIEW"], "MD13 같은 고객명은 하나로 집계(2회), 코드는 만들지 않음")
    ok(cust.issues.some((i) => i.code === "PARTNER_CODE_MISSING") && cust.issues.some((i) => i.code === "PARTNER_STATUS_UNKNOWN"), "코드 없음 + 현재 거래 여부 불명 → REVIEW")
    eq(a.partnerNearDuplicates.map((g) => g.names), [["(주)가나", "가나"]], "MD14 법인 표기만 다른 공급업체 근접 중복 보고(자동 병합 안 함)")
    ok(a.partners.find((p) => p.name === "(주)가나") !== undefined && a.partners.find((p) => p.name === "가나") !== undefined, "근접 중복도 별개 후보로 보존")
    const both = a.partners.find((p) => p.name === "다라")!
    eq([both.partnerType, both.roles], ["BOTH", { customer: 1, supplier: 1 }], "MD15 같은 이름이 고객/공급업체 → BOTH 후보")
    ok(both.issues.some((i) => i.code === "PARTNER_BOTH_BY_NAME"), "MD15 BOTH 는 이름만 같음 → REVIEW")
    eq(partnerFoldKey("(주) 가나"), partnerFoldKey("가나"), "법인 표기/공백 정규화 키")
    // ItemSupplier: Default 지정/LT/MOQ 추정 없음
    ok(a.itemSuppliers.every((s) => s.isDefault === false && s.grade === "REVIEW"), "ItemSupplier 는 isDefault=false, 거래처 확인 전 REVIEW")
    eq(ex.materials.length, 3, "추출 자재 3")
  }

  // ═══ MD16~18 CREATE / MATCH / CONFLICT ═════════════════════════════════════
  section("MD16~MD18 CREATE / MATCH / CONFLICT")
  {
    const { a } = analyze(workbook({ materials: MATS, boms: BASE_BOMS }))
    const decisions = { bulk: { finishedUseCodeAsName: true, finishedDefaultUom: "EA" as const, allowMissingSpec: true } }
    const ds = buildApprovedDataset(a, { workbookSha256: "h", decisions })
    eq([ds.items.length, ds.boms.length], [5, 2], "일괄 정책 승인 후 Item 5 / BOM 2")
    const emptyEx: ExistingMasterSnapshot = { items: [], boms: [], partners: [], itemSuppliers: [] }
    eq(summarize(reconcileDataset(ds, emptyEx)).ITEM, { CREATE: 5, MATCH: 0, CONFLICT: 0, REJECT: 0 }, "MD16 빈 MES → 모두 CREATE")
    const full: ExistingMasterSnapshot = {
      items: ds.items.map((i) => ({ code: i.code, name: i.name, spec: i.spec, uom: i.uom, itemType: i.itemType })),
      boms: ds.boms.map((b) => ({ itemCode: b.parentCode, version: "9", lines: b.lines.map((l) => ({ componentCode: l.componentCode, qtyPer: l.qtyPer })) })),
      partners: [],
      itemSuppliers: [],
    }
    eq(summarize(reconcileDataset(ds, full)), { ITEM: { CREATE: 0, MATCH: 5, CONFLICT: 0, REJECT: 0 }, BOM: { CREATE: 0, MATCH: 2, CONFLICT: 0, REJECT: 0 }, PARTNER: { CREATE: 0, MATCH: 0, CONFLICT: 0, REJECT: 0 }, ITEM_SUPPLIER: { CREATE: 0, MATCH: 0, CONFLICT: 0, REJECT: 0 } }, "MD17 동일 내용 → MATCH(BOM 버전이 달라도 줄이 같으면 MATCH)")
    const changed: ExistingMasterSnapshot = JSON.parse(JSON.stringify(full))
    changed.items[0].name = "다른 이름"
    changed.boms[0].lines[0].qtyPer = 99
    const r = reconcileDataset(ds, changed)
    const s = summarize(r)
    eq([s.ITEM.CONFLICT, s.BOM.CONFLICT], [1, 1], "MD18 같은 코드/다른 내용 → CONFLICT")
    eq(r.find((e) => e.class === "CONFLICT" && e.kind === "ITEM")!.diff, ["name"], "충돌 필드 보고")
    // 후보 대조: REJECT 는 REJECT
    const bad = analyze(workbook({ materials: MATS, boms: [{ no: 1, product: "P-1", lines: [{ code: "M-001", qty: "." }] }] })).a
    const cands = summarize(reconcileCandidates(bad, emptyEx))
    eq(cands.BOM, { CREATE: 0, MATCH: 0, CONFLICT: 0, REJECT: 1 }, "후보 대조: 검증 REJECT 는 REJECT")
  }

  // ═══ MD19~23 운영 정보 제외 ═════════════════════════════════════════════════
  section("MD19~MD23 운영 정보(재고/수주/발주/입출고/생산/WIP) 제외")
  {
    const extra = new MemGrid("입고관리대장")
    extra.set(11, 2, "M-001").set(11, 7, 46000).set(11, 8, 777) // 입고 이력
    const ship = new MemGrid("출고관리대장")
    ship.set(11, 2, "M-001").set(11, 8, 555)
    const sheets = workbook({
      materials: MATS,
      boms: BASE_BOMS,
      orders: [{ product: "P-1", customer: "고객가", qty: 31337, due: 46100 }],
      stock: [{ code: "M-001", name: "자재A", spec: "SPEC-A", supplier: "공급가", qty: 424242 }],
      extraSheets: [extra, ship],
    })
    const { ex, a } = analyze(sheets)
    const ds = buildApprovedDataset(a, { workbookSha256: "h", decisions: { bulk: { finishedUseCodeAsName: true, finishedDefaultUom: "EA", allowMissingSpec: true, partnerCodeRule: { customerPrefix: "C", supplierPrefix: "S", width: 3 }, acceptItemSuppliersOfAcceptedPartners: true } } })
    const text = JSON.stringify({ ds, a, ex: { orderRefs: ex.orderRefs, stock: ex.stockSheetMaterials } })
    ok(!text.includes("424242") && !text.includes("12345"), "MD19 재고 수량(재고관리대장)은 추출/분석/데이터셋 어디에도 없음")
    ok(!text.includes("31337") && !text.includes("46100"), "MD20 수주 수량/납기는 추출/분석/데이터셋 어디에도 없음")
    ok(!text.includes("777") && !text.includes("555"), "MD21 입고/출고 이력 값은 어디에도 없음")
    const dsKeys = Object.keys(ds).sort()
    eq(dsKeys, ["bomVersion", "boms", "datasetHash", "excluded", "itemSuppliers", "items", "kind", "partners", "schemaVersion", "source"], "MD22 데이터셋에는 운영 정보를 담을 키가 없음(inventory/salesOrder/purchaseOrder/wip/production 없음)")
    const tampered = { ...ds, inventory: [{ itemCode: "M-001", qty: 5 }] }
    const t = validateDatasetShape(tampered)
    ok(!t.ok, "MD23 운영 정보 키가 들어간 데이터셋은 거부")
    const bad = validateDatasetShape({ ...ds, items: ds.items.map((i, k) => (k === 0 ? { ...i, name: "변조" } : i)) })
    ok(!bad.ok && /datasetHash/.test((bad as { reason: string }).reason), "데이터셋 내용 변조 → 해시 불일치로 거부")
    ok(validateDatasetShape(ds).ok, "정상 데이터셋 통과")
    // 식별자만 읽음
    eq(Object.keys(ex.orderRefs.products[0]).sort(), ["code", "count", "firstRow"], "수주 시트에서는 식별자(제품코드/고객명)와 건수만 읽음")
    // 시트 분류: 운영 시트는 Import 후보 아님
    const report = buildSheetReport(sheets)
    const cls = (n: string) => report.find((r) => r.sheet === n)!
    eq([cls("수주관리대장").class, cls("입고관리대장").class, cls("출고관리대장").class, cls("재고관리대장").class], ["TRANSACTION", "TRANSACTION", "CALCULATION", "CURRENT_STATE"], "시트 분류: 수주/입고=TRANSACTION, 출고=CALCULATION, 재고=CURRENT_STATE")
    ok(report.filter((r) => r.prodImportCandidate).map((r) => r.sheet).sort().join() === "DB,설정", "Production Import 후보 시트는 설정/DB(Master)뿐")
    ok(cls("재고관리대장").dateRange?.max === "2024-01-05", "날짜 범위는 자료 최신성 보고용(재고관리대장 작성일자)")
  }

  // ═══ MD24~25 seed 멱등 / 운영 정보 0 ═════════════════════════════════════════
  section("MD24~MD25 seed 멱등성 / 운영 정보 행 0")
  {
    const { a } = analyze(
      workbook({
        materials: MATS,
        boms: BASE_BOMS,
        orders: [{ product: "P-1", customer: "고객가" }],
      })
    )
    const ds = buildApprovedDataset(a, {
      workbookSha256: "h",
      decisions: {
        bulk: { finishedUseCodeAsName: true, finishedDefaultUom: "EA", allowMissingSpec: true, partnerCodeRule: { customerPrefix: "C", supplierPrefix: "S", width: 3 }, acceptItemSuppliersOfAcceptedPartners: true },
      },
    })
    const seedDb = () =>
      makeFakeDb(
        { item: [], bOM: [], bOMItem: [], businessPartner: [], itemSupplier: [] },
        { uniques: { item: [["tenantId", "code"]], businessPartner: [["tenantId", "code"]], bOM: [["tenantId", "itemId", "version"]], itemSupplier: [["tenantId", "itemId", "supplierId"]] } }
      )
    const f = seedDb()
    const dry = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: true })
    eq([f.countWrites(), dry.summary.ITEM.CREATE, dry.created.items], [0, 5, 0], "dry-run: 쓰기 0건, CREATE 5 보고")
    const first = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false })
    eq(first.created, { items: 5, boms: 2, bomLines: 4, partners: 3, itemSuppliers: 3 }, "seed 1회: Item 5 / BOM 2(줄 4) / 거래처 3 / ItemSupplier 3")
    const rowsAfter = f.tables.item.length + f.tables.bOM.length + f.tables.bOMItem.length + f.tables.businessPartner.length + f.tables.itemSupplier.length
    const second = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false })
    eq(second.created, { items: 0, boms: 0, bomLines: 0, partners: 0, itemSuppliers: 0 }, "MD24 두 번째 실행: 아무것도 만들지 않음(멱등)")
    eq(f.tables.item.length + f.tables.bOM.length + f.tables.bOMItem.length + f.tables.businessPartner.length + f.tables.itemSupplier.length, rowsAfter, "MD24 행 수 불변")
    eq(second.summary.ITEM, { CREATE: 0, MATCH: 5, CONFLICT: 0, REJECT: 0 }, "MD24 두 번째는 전부 MATCH")

    // 기본값 확인: isDefault=false, LT/MOQ/배수 미설정, BOM ACTIVE/default
    const is0 = f.tables.itemSupplier[0]
    eq([is0.isDefault, is0.leadTimeDays, is0.moq, is0.orderMultiple], [false, undefined, undefined, undefined], "ItemSupplier: Default/LT/MOQ/배수를 추정해 넣지 않음")
    eq(f.tables.bOM.every((b) => b.status === "ACTIVE" && b.isDefault === true && b.version === "1"), true, "BOM: version 1 / ACTIVE / default")

    // MD25 운영 정보 모델 접근 0 / 행 0
    const touched = new Set(f.writes.map((w) => w.model))
    eq(Array.from(touched).sort(), ["bOM", "bOMItem", "businessPartner", "item", "itemSupplier"], "MD25 쓰기 대상은 Master 5개 모델뿐")
    for (const m of ["inventoryBalance", "inventoryTransaction", "salesOrder", "purchaseOrder", "workOrder", "wipUnit", "lot", "shipment"]) {
      let rows = 0
      try {
        rows = ((f.db as Record<string, { __n?: never }>)[m], (f.tables[m] ?? []).length)
      } catch {
        rows = 0
      }
      assert.equal(rows, 0, m + " 행 0")
      passed += 1
    }
    console.log("PASS MD25 재고/수주/발주/작업지시/WIP/LOT/출하 테이블 행 0 (쓰기 대상 아님)")
    eq(summarizeSeedDataset(ds).transaction, { inventory: 0, salesOrder: 0, purchaseOrder: 0, receipt: 0, shipment: 0, productionResult: 0, wip: 0 }, "seed 요약: 운영 정보 0")

    // 충돌: 같은 코드/다른 내용 → ABORT(쓰기 0), SKIP 은 충돌만 제외
    const g = seedDb()
    g.tables.item.push({ id: "x1", tenantId: "t1", code: "M-001", name: "기존과 다른 이름", spec: "SPEC-A", uom: "EA", itemType: "RAW_MATERIAL", status: "ACTIVE" })
    const abort = await applyMasterDataset(g.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false })
    ok(abort.aborted && abort.conflicts.length === 1 && g.countWrites() === 0, "충돌 시 기본 ABORT: 쓰기 0건, 충돌 보고")
    eq(g.tables.item[0].name, "기존과 다른 이름", "기존 데이터를 overwrite 하지 않음")
    const skip = await applyMasterDataset(g.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, onConflict: "SKIP" })
    ok(!skip.aborted && skip.created.items === 4 && g.tables.item.find((i) => i.code === "M-001")!.name === "기존과 다른 이름", "SKIP: 충돌 항목만 건너뛰고 나머지 생성, 충돌 항목은 그대로")

    // 다른 tenant 의 데이터는 보이지 않는다
    const h = seedDb()
    h.tables.item.push({ id: "o1", tenantId: "other", code: "M-001", name: "다른 tenant", spec: null, uom: "EA", itemType: "RAW_MATERIAL", status: "ACTIVE" })
    const snap = await loadExistingSnapshot(h.db as never, "t1")
    eq(snap.items.length, 0, "다른 tenant 의 Master 는 대조 대상이 아님")
  }

  // ═══ 승인 결정 / 일괄 정책 ════════════════════════════════════════════════════
  section("승인 결정 / 일괄 정책")
  {
    const { a } = analyze(workbook({ materials: [...MATS, { code: "M-X", name: "임시", spec: "S", uom: "ea" }], boms: BASE_BOMS }))
    const strict = buildApprovedDataset(a, { workbookSha256: "h" })
    eq(strict.items.map((i) => i.code).sort(), ["M-001", "M-002", "M-003"], "승인 없음: SAFE 자재만(제품/REVIEW 제외)")
    eq(strict.boms.length, 0, "상위 제품이 승인되지 않으면 BOM 제외(종속)")
    ok(item(a, "M-X")!.issues.some((i) => i.code === "UOM_NOT_EXACT") && item(a, "M-X")!.suggestions.uom === "EA", "'ea' 단위는 자동 보정하지 않고 제안만")
    // 개별 승인(accept=false 는 제외)
    const off = buildApprovedDataset(a, { workbookSha256: "h", decisions: { items: { "M-X": { accept: false, uom: "EA" } } } })
    ok(!off.items.some((i) => i.code === "M-X"), "accept=false 는 포함하지 않음")
    const on = buildApprovedDataset(a, { workbookSha256: "h", decisions: { items: { "M-X": { accept: true, uom: "EA", itemType: "RAW_MATERIAL" } } } })
    ok(on.items.some((i) => i.code === "M-X" && i.uom === "EA" && i.itemType === "RAW_MATERIAL"), "명시 승인 + 단위/유형 지정 시 포함")
    const incomplete = buildApprovedDataset(a, { workbookSha256: "h", decisions: { items: { "M-X": { accept: true, uom: "EA" } } } })
    ok(!incomplete.items.some((i) => i.code === "M-X"), "승인했어도 유형이 확정되지 않으면 포함하지 않음")
    const invalid = buildApprovedDataset(a, { workbookSha256: "h", decisions: { items: { "M-X": { accept: true, uom: "BAD" as never } } } })
    ok(!invalid.items.some((i) => i.code === "M-X"), "승인 값이 enum 에 없으면 포함하지 않음(재검증)")
    // 거래처 코드는 사람이 정한다
    const p = analyze(workbook({ materials: MATS, boms: BASE_BOMS })).a
    const noCode = buildApprovedDataset(p, { workbookSha256: "h", decisions: { bulk: { acceptItemSuppliersOfAcceptedPartners: true } } })
    eq([noCode.partners.length, noCode.itemSuppliers.length], [0, 0], "거래처 코드 승인이 없으면 거래처/ItemSupplier 없음(코드 임의 생성 금지)")
    const dupCode = buildApprovedDataset(p, {
      workbookSha256: "h",
      decisions: { partners: { "SUPPLIER|공급가": { accept: true, code: "V1" }, "SUPPLIER|공급나": { accept: true, code: "V1" } } },
    })
    eq(dupCode.partners.length, 1, "거래처 코드 중복 승인은 두 번째를 제외")
    // 해시 결정성
    const d1 = buildApprovedDataset(p, { workbookSha256: "h" })
    const d2 = buildApprovedDataset(p, { workbookSha256: "h" })
    eq(d1.datasetHash, d2.datasetHash, "같은 입력 → 같은 datasetHash")
    ok(/^[0-9a-f]{64}$/.test(d1.datasetHash), "datasetHash = sha256")
  }

  // ═══ MS1~MS15 Phase 7B-1 확정 정책 ═══════════════════════════════════════════
  section("MS1~MS15 Phase 7B-1 확정 정책(승인된 정책 파일 사용)")
  {
    const policy = JSON.parse(readFileSync(join(__dirname, "master-migration", "daewon-7b1.policy.json"), "utf8")) as MasterDecisions
    const sheets = workbook({
      materials: [
        { code: "M-001", name: "자재A", spec: "SPEC-A", supplier: "공급가", uom: "EA" },
        { code: "M-002", name: "자재B", spec: "SPEC-B", supplier: "공급나", uom: "EA" },
        { code: "M-003", name: "자재C", spec: "SPEC-C", supplier: "공급가", uom: "SET" },
        { code: "M-TRIM", name: "공백단위", spec: "SPEC-T", supplier: "공급다", uom: "EA " },
        { code: "M-CASE", name: "소문자단위", spec: "SPEC-K", supplier: "공급다", uom: "ea" },
        { code: "M-MIS", name: "불일치", spec: "SPEC-M", supplier: "공급나", uom: "EA" },
        { code: "M-UNUSED", name: "미참조", spec: "SPEC-U", supplier: "공급가", uom: "EA" },
      ],
      boms: [
        { no: 1, product: "P-1", lines: [{ code: "M-001", name: "자재A", spec: "SPEC-A", qty: 2, uom: "EA" }, { code: "M-TRIM", name: "공백단위", spec: "SPEC-T", qty: 1, uom: "EA" }] },
        { no: 2, product: "P-2", lines: [{ code: "M-002", name: "자재B", spec: "SPEC-B", qty: 1, uom: "EA" }, { code: "M-MIS", name: "불일치", spec: "다른 규격", qty: 1, uom: "EA" }] },
        { no: 3, product: "P-3", lines: [{ code: "M-003", name: "자재C", spec: "SPEC-C", qty: ".", uom: "SET" }] },
        { no: 4, product: "P-4", lines: [{ code: "M-CASE", name: "소문자단위", spec: "SPEC-K", qty: 1, uom: "EA" }] },
      ],
      orders: [{ product: "P-ORDER-ONLY", customer: "고객가" }, { product: "P-1", customer: "고객가" }],
    })
    const { a } = analyze(sheets)
    const ds = buildApprovedDataset(a, { workbookSha256: "h", decisions: policy })
    const codes = new Set(ds.items.map((i) => i.code))
    const find = (c: string) => ds.items.find((i) => i.code === c)

    // MS1 FINISHED placeholder
    const p1 = find("P-1")!
    eq([p1.name, p1.uom, p1.spec, p1.itemType], ["P-1", "EA", null, "FINISHED"], "MS1 FINISHED: name=code / EA / spec=null")
    eq([p1.needsMasterEnrichment, p1.placeholderFields], [true, ["name", "spec", "uom"]], "MS1 placeholder 임시값 표시(needsMasterEnrichment + 필드)")
    ok(ds.items.filter((i) => i.itemType === "FINISHED").every((i) => i.needsMasterEnrichment === true), "MS1 모든 FINISHED 가 enrichment 필요로 표시")
    ok(find("M-001")!.needsMasterEnrichment === undefined, "RAW 정상 자재는 placeholder 표시 없음")
    // MS2 공백만 문제인 단위 정규화
    const trim = find("M-TRIM")!
    eq([trim.uom, trim.normalizations], ["EA", ["UOM_TRIMMED"]], "MS2 단위 공백(EA + 공백) → EA (trim 정규화, 기록 남김)")
    ok(!codes.has("M-CASE"), "MS2 소문자 ea 는 자동 보정하지 않고 제외(대소문자 보정 미승인)")
    eq(item(a, "M-TRIM")!.uomRaw, "EA ", "원본 단위 문자열은 분석 결과에 보존")
    // MS3 불일치 RAW → REVIEW 유지 + 제외, 그 자재를 쓰는 BOM 도 제외
    ok(!codes.has("M-MIS") && item(a, "M-MIS")!.grade === "REVIEW", "MS3 BOM 규격 불일치 RAW 는 REVIEW 유지·제외(자동 수정 안 함)")
    ok(!ds.boms.some((b) => b.parentCode === "P-2"), "MS3 불일치 자재를 쓰는 BOM 은 제외")
    ok(codes.has("P-2"), "(제품 Item 자체는 FINISHED 정책으로 포함, BOM 만 제외)")
    // MS4 미참조 자재 제외
    ok(!codes.has("M-UNUSED"), "MS4 어떤 BOM 에도 쓰이지 않는 자재는 제외")
    // MS5 수주 전용 제품 제외
    ok(!codes.has("P-ORDER-ONLY"), "MS5 수주관리대장에서만 발견된 제품은 제외")
    // invalid qty BOM 제외
    ok(!ds.boms.some((b) => b.parentCode === "P-3") && ds.boms.some((b) => b.parentCode === "P-1"), "수량 . 인 BOM 은 제외, 정상 BOM 은 포함")
    eq(ds.boms.find((b) => b.parentCode === "P-1")!.lines.map((l) => l.qtyPer), [2, 1], "정상 BOM 수량 그대로")
    ok(ds.excluded.droppedDependents >= 1, "종속 제외 집계")

    // MS6/MS7 거래처 코드: 결정적 + 재생성 안정
    const custs = ds.partners.filter((p) => p.partnerType === "CUSTOMER")
    const sups = ds.partners.filter((p) => p.partnerType === "SUPPLIER")
    eq(custs.map((c) => c.code), ["CUS-001"], "MS6 고객 코드 CUS-001")
    eq(
      sups.map((s) => [s.code, s.name]).sort(),
      [["SUP-001", "공급가"], ["SUP-002", "공급나"], ["SUP-003", "공급다"]],
      "MS7 공급업체 코드는 이름순 SUP-001.."
    )
    const ds2 = buildApprovedDataset(a, { workbookSha256: "h", decisions: policy })
    eq(ds2.partners, ds.partners, "MS7 같은 입력 재생성 → 같은 코드(결정적)")
    // 매핑 고정: 이름이 정렬상 앞서는 새 공급업체가 추가돼도 기존 코드는 유지
    const map: Record<string, string> = {}
    ds.partners.forEach((p) => (map[`${p.partnerType}|${p.name}`] = p.code))
    const sheets2 = workbook({
      materials: [
        { code: "M-001", name: "자재A", spec: "SPEC-A", supplier: "공급가", uom: "EA" },
        { code: "M-002", name: "자재B", spec: "SPEC-B", supplier: "공급나", uom: "EA" },
        { code: "M-NEW", name: "신규", spec: "SPEC-N", supplier: "가가공급", uom: "EA" },
      ],
      boms: [{ no: 1, product: "P-1", lines: [{ code: "M-001", qty: 1 }, { code: "M-NEW", qty: 1 }] }],
      orders: [{ product: "P-1", customer: "고객가" }],
    })
    const a2 = analyze(sheets2).a
    const withMap = buildApprovedDataset(a2, { workbookSha256: "h", decisions: { ...policy, partnerCodeMap: map } })
    const codeOf = (d: ApprovedMasterDataset, n: string) => d.partners.find((p) => p.name === n)?.code
    eq(
      [codeOf(withMap, "공급가"), codeOf(withMap, "공급나"), codeOf(withMap, "가가공급")],
      ["SUP-001", "SUP-002", "SUP-004"],
      "MS7 매핑 고정: 기존 코드 유지, 신규 공급업체는 다음 번호(SUP-004, 번호 재사용 없음)"
    )
    const noMap = buildApprovedDataset(a2, { workbookSha256: "h", decisions: policy })
    eq(codeOf(noMap, "가가공급"), "SUP-001", "(매핑 없이 재정렬하면 번호가 밀린다 — 그래서 partner-code-map 을 유지한다)")

    // MS8/MS9 ItemSupplier
    ok(ds.itemSuppliers.every((s) => s.isDefault === false), "MS8 ItemSupplier isDefault 전부 false")
    ok(ds.itemSuppliers.every((s) => codes.has(s.itemCode)), "제외된 품목은 ItemSupplier 에서도 제외")
    ok(!ds.itemSuppliers.some((s) => s.itemCode === "M-MIS" || s.itemCode === "M-UNUSED"), "불일치/미참조 자재의 공급업체 관계 제외")
    eq(ds.itemSuppliers.map((s) => s.itemCode).sort(), ["M-001", "M-002", "M-003", "M-TRIM"], "최종 ItemSupplier = 포함된 RAW 중 공급업체가 있는 것")
    const fdb = makeFakeDb(
      { item: [], bOM: [], bOMItem: [], businessPartner: [], itemSupplier: [] },
      { uniques: { item: [["tenantId", "code"]], businessPartner: [["tenantId", "code"]], bOM: [["tenantId", "itemId", "version"]], itemSupplier: [["tenantId", "itemId", "supplierId"]] } }
    )
    const r1 = await applyMasterDataset(fdb.db as unknown as MasterApplyDb, { tenantId: "t", dataset: ds, dryRun: false })
    ok(fdb.tables.itemSupplier.every((r) => r.isDefault === false && r.leadTimeDays === undefined && r.moq === undefined && r.orderMultiple === undefined), "MS9 LT/MOQ/배수 null(미설정), Default 없음")
    // MS10 운영 정보 키 없음
    for (const key of ["inventory", "salesOrders", "purchaseOrders", "receipts", "shipments", "wip", "productionResults"]) {
      ok(!(key in ds) && !validateDatasetShape({ ...ds, [key]: [] }).ok, `MS10 데이터셋에 ${key} 키 없음/주입 시 거부`)
    }
    // MS11/MS12 첫 실행 CREATE / 두 번째 MATCH
    eq(
      [r1.summary.ITEM.CREATE, r1.summary.BOM.CREATE, r1.summary.PARTNER.CREATE, r1.summary.ITEM_SUPPLIER.CREATE],
      [ds.items.length, ds.boms.length, ds.partners.length, ds.itemSuppliers.length],
      "MS11 첫 seed: 전부 CREATE"
    )
    const r2 = await applyMasterDataset(fdb.db as unknown as MasterApplyDb, { tenantId: "t", dataset: ds, dryRun: false })
    eq(
      [r2.summary.ITEM.MATCH, r2.summary.BOM.MATCH, r2.summary.PARTNER.MATCH, r2.summary.ITEM_SUPPLIER.MATCH, r2.created.items + r2.created.boms + r2.created.partners + r2.created.itemSuppliers, r2.conflicts.length],
      [ds.items.length, ds.boms.length, ds.partners.length, ds.itemSuppliers.length, 0, 0],
      "MS12 두 번째 seed: 전부 MATCH, 생성 0, CONFLICT 0"
    )
    // MS13 충돌 시 overwrite 없음
    const cdb = makeFakeDb(
      { item: [{ id: "i1", tenantId: "t", code: "P-1", name: "다른 이름", spec: null, uom: "EA", itemType: "FINISHED", status: "ACTIVE" }], bOM: [], bOMItem: [], businessPartner: [], itemSupplier: [] },
      { uniques: { item: [["tenantId", "code"]] } }
    )
    const rc = await applyMasterDataset(cdb.db as unknown as MasterApplyDb, { tenantId: "t", dataset: ds, dryRun: false })
    ok(rc.aborted && rc.conflicts.length === 1 && cdb.countWrites() === 0 && cdb.tables.item[0].name === "다른 이름", "MS13 같은 코드/다른 name → CONFLICT 중단, overwrite 없음, 쓰기 0")

    // MS14/MS15 가드
    const g = (env: Record<string, string>) => {
      try {
        assertDevSeedTarget(env)
        return "OK"
      } catch (e) {
        return isSeedGuardError(e) ? e.message : "OTHER"
      }
    }
    const prod = { DATABASE_URL: "postgresql://u:p@db.prod.example.com:5432/postgres", DIRECT_URL: "postgresql://u:p@db.prod.example.com:6543/postgres" }
    ok(/DATABASE_URL 와 같습니다/.test(g({ ...prod, MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://x:y@db.prod.example.com:5432/other" })), "MS14 운영 DB 와 같은 호스트면 거부")
    ok(/Vercel/.test(g({ VERCEL: "1", VERCEL_ENV: "production", MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://x:y@127.0.0.1:5432/dev" })), "MS15 Vercel 에서는 거부")
    ok(g({ ...prod, MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://x:y@127.0.0.1:5432/dev" }) === "OK", "별도 개발 DB 는 허용")
  }

  // ═══ PI1~PI13 Phase 7B-2 운영 import 가드 / 적용 ═══════════════════════════════
  section("PI1~PI13 운영 Master import (가드 / CREATE-only / 감사 / 롤백)")
  {
    const policy = JSON.parse(readFileSync(join(__dirname, "master-migration", "daewon-7b1.policy.json"), "utf8")) as MasterDecisions
    const { a } = analyze(
      workbook({
        materials: MATS,
        boms: BASE_BOMS,
        orders: [{ product: "P-1", customer: "고객가" }],
      })
    )
    const ds = buildApprovedDataset(a, { workbookSha256: "h", decisions: policy })
    const counts = datasetCounts(ds)
    const expectedCounts = { ...counts }
    const base = { env: {} as Record<string, string>, apply: false, datasetHash: ds.datasetHash, expectedHash: ds.datasetHash, tenantId: "t1", expectedTenantId: "t1", counts, expectedCounts }
    const code = (over: Partial<typeof base>) => {
      try {
        assertProductionImportAllowed({ ...base, ...over })
        return "OK"
      } catch (e) {
        return isProductionImportGuardError(e) ? e.code : "OTHER"
      }
    }
    eq(code({}), "OK", "dry-run 은 승인 확인 변수 없이 가능(hash/tenant/건수는 필수)")
    eq(code({ apply: true }), "CONFIRM_REQUIRED", "PI1 apply 는 MASTER_IMPORT_CONFIRM=PRODUCTION_APPROVED 필요")
    eq(code({ apply: true, env: { MASTER_IMPORT_CONFIRM: "yes" } }), "CONFIRM_REQUIRED", "PI1 값이 정확히 PRODUCTION_APPROVED 가 아니면 거부")
    eq(code({ apply: true, env: { MASTER_IMPORT_CONFIRM: "PRODUCTION_APPROVED" } }), "OK", "PI1 승인 값이 있으면 통과")
    eq(code({ expectedHash: "0".repeat(64) }), "HASH_MISMATCH", "PI2 dataset hash 불일치 거부")
    eq(code({ expectedHash: ds.datasetHash.slice(0, 16) }), "HASH_MISMATCH", "PI2 hash prefix 만으로는 불충분(전체 일치 필요)")
    eq(code({ expectedTenantId: "other" }), "TENANT_MISMATCH", "PI3 tenant 불일치 거부")
    eq(code({ expectedCounts: { ...counts, items: counts.items + 1 } }), "COUNT_MISMATCH", "PI4 건수 불일치 거부")
    eq(code({ expectedHash: undefined }), "EXPECTATION_MISSING", "기대값이 없으면 거부")
    eq(code({ env: { VERCEL: "1" } }), "VERCEL", "Vercel 에서는 무조건 거부")

    const mk = (seed: Record<string, Array<Record<string, unknown>>> = {}) =>
      makeFakeDb(
        {
          item: [],
          bOM: [],
          bOMItem: [],
          businessPartner: [],
          itemSupplier: [],
          // 업무 테이블: 증가하면 안 된다
          salesOrder: [{ id: "so-1", tenantId: "t1" }],
          inventoryBalance: [{ id: "ib-1", tenantId: "t1" }],
          ...seed,
        } as never,
        { uniques: { item: [["tenantId", "code"]], businessPartner: [["tenantId", "code"]], bOM: [["tenantId", "itemId", "version"]], itemSupplier: [["tenantId", "itemId", "supplierId"]] } }
      )
    const expectedCreate = { items: counts.items, boms: counts.boms, partners: counts.customers + counts.suppliers, itemSuppliers: counts.itemSuppliers }
    const audit = { actorId: "actor-1", actorLabel: "소유자", source: "DAEWON_MASTER_MIGRATION" }

    // PI6 운영 정보 키가 있는 데이터셋 거부
    ok(!validateDatasetShape({ ...ds, salesOrders: [{ qty: 1 }] }).ok && !validateDatasetShape({ ...ds, inventory: [] }).ok, "PI6 운영 정보(재고/수주) 키가 있는 데이터셋 거부")

    // PI7 정상 CREATE + PI9 감사 + PI11/12/13
    const f = mk()
    const dry = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: true, createOnly: true, expectedCreate })
    ok(!dry.aborted && !dry.abortReason && dry.entries.every((e) => e.class === "CREATE") && f.countWrites() === 0, "PI7 dry-run: 전부 CREATE, 쓰기 0")
    const res = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, createOnly: true, expectedCreate, audit, now: () => new Date("2026-10-14T00:00:00Z") })
    ok(!res.aborted && res.created.items === counts.items && res.created.boms === counts.boms && res.created.bomLines === counts.bomItems, "PI7 정상 import: 건수 일치")
    eq([f.tables.item.length, f.tables.bOM.length, f.tables.bOMItem.length, f.tables.businessPartner.length, f.tables.itemSupplier.length], [counts.items, counts.boms, counts.bomItems, counts.customers + counts.suppliers, counts.itemSuppliers], "PI7 DB 행 수 = 승인 건수")
    const au = f.tables.auditLog
    ok(au.length === 1 && au[0].entityType === "MasterImport" && au[0].actorId === "actor-1" && au[0].action === "CREATE", "PI9 요약 AuditLog 1건(actor/entityType)")
    eq([au[0].afterData.source, au[0].afterData.datasetHash === ds.datasetHash, au[0].afterData.items.total, au[0].afterData.boms, au[0].afterData.bomItems, au[0].afterData.itemSuppliers, au[0].afterData.placeholderFinishedItems], ["DAEWON_MASTER_MIGRATION", true, counts.items, counts.boms, counts.bomItems, counts.itemSuppliers, counts.finished], "PI9 감사 내용(source/hash/건수/placeholder 수)")
    ok(res.auditId === au[0].id, "감사 id 반환")
    eq([f.tables.salesOrder.length, f.tables.inventoryBalance.length], [1, 1], "PI11 업무 테이블 row 증가 0")
    eq(Array.from(new Set(f.writes.map((w) => w.model))).sort(), ["auditLog", "bOM", "bOMItem", "businessPartner", "item", "itemSupplier"], "쓰기 대상은 Master 5개 + AuditLog 뿐")
    ok(f.tables.item.filter((i) => i.itemType === "FINISHED").every((i) => i.name === i.code && i.uom === "EA" && i.spec === null), "PI12 FINISHED placeholder 유지(name=code / EA / spec null)")
    eq(ds.items.filter((i) => i.needsMasterEnrichment).length, counts.finished, "PI12 needsMasterEnrichment 표시는 데이터셋/보고에 유지(DB 컬럼 없음)")
    ok(f.tables.itemSupplier.every((r) => r.isDefault === false && r.leadTimeDays === undefined && r.moq === undefined && r.orderMultiple === undefined), "PI13 ItemSupplier Default 전부 false, LT/MOQ/배수 미설정")
    // PI10 두 번째 dry-run
    const second = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: true })
    eq(
      [second.summary.ITEM.CREATE + second.summary.BOM.CREATE + second.summary.PARTNER.CREATE + second.summary.ITEM_SUPPLIER.CREATE, second.summary.ITEM.MATCH, second.summary.BOM.MATCH, second.summary.PARTNER.MATCH, second.summary.ITEM_SUPPLIER.MATCH, second.conflicts.length],
      [0, counts.items, counts.boms, counts.customers + counts.suppliers, counts.itemSuppliers, 0],
      "PI10 두 번째 dry-run: CREATE 0 / MATCH 전체 / CONFLICT 0"
    )
    // 두 번째 createOnly 는 거부(전부 MATCH)
    const again = await applyMasterDataset(f.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, createOnly: true, audit })
    ok(again.aborted && again.abortReason === "NOT_CREATE_ONLY" && f.tables.auditLog.length === 1, "createOnly: 이미 존재하는 항목이 있으면 거부(쓰기 0, 감사 추가 없음)")

    // PI5 충돌 거부
    const c = mk({ item: [{ id: "i-x", tenantId: "t1", code: "M-001", name: "다른 이름", spec: "SPEC-A", uom: "EA", itemType: "RAW_MATERIAL", status: "ACTIVE" }] })
    const rc = await applyMasterDataset(c.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, createOnly: true, expectedCreate, audit })
    ok(rc.aborted && rc.abortReason === "CONFLICT" && c.countWrites() === 0 && c.tables.item[0].name === "다른 이름", "PI5 CONFLICT → 중단(overwrite/update/삭제 없음, 쓰기 0)")
    // 기대 건수 불일치 → 쓰기 0
    const cm = mk()
    const bad = await applyMasterDataset(cm.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, createOnly: true, expectedCreate: { ...expectedCreate, items: expectedCreate.items + 1 }, audit })
    ok(bad.aborted && bad.abortReason === "COUNT_MISMATCH" && cm.countWrites() === 0, "PI4 CREATE 예정 건수가 기대와 다르면 쓰기 0")

    // PI8 중간 실패 → 전체 롤백
    const rb = mk()
    rb.failNext.auditLogAfter = 0 // 감사 기록(마지막 단계)에서 실패
    let threw = false
    try {
      await applyMasterDataset(rb.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, createOnly: true, expectedCreate, audit })
    } catch {
      threw = true
    }
    ok(threw, "PI8 중간(감사) 실패는 예외로 전파")
    eq([rb.tables.item.length, rb.tables.bOM.length, rb.tables.bOMItem.length, rb.tables.businessPartner.length, rb.tables.itemSupplier.length, rb.tables.auditLog.length], [0, 0, 0, 0, 0, 0], "PI8 전체 롤백: Item/BOM/BOMItem/거래처/ItemSupplier/감사 모두 0(부분 import 없음)")
    // 롤백 후 재시도 가능
    rb.failNext.auditLogAfter = -1
    const retry = await applyMasterDataset(rb.db as unknown as MasterApplyDb, { tenantId: "t1", dataset: ds, dryRun: false, createOnly: true, expectedCreate, audit })
    ok(!retry.aborted && rb.tables.item.length === counts.items, "롤백 후 재시도 성공")
  }

  // ═══ MC1~MC12 Phase 7C 운영 Master 최종 감사(순수 함수) ═══════════════════════════
  section("MC1~MC12 Phase 7C 최종 감사")
  {
    const policy = JSON.parse(readFileSync(join(__dirname, "master-migration", "daewon-7b1.policy.json"), "utf8")) as MasterDecisions
    const sheets = workbook({
      materials: [
        { code: "M-001", name: "자재A", spec: "SPEC-A", supplier: "공급가", uom: "EA" },
        { code: "M-002", name: "자재B", spec: "SPEC-B", supplier: "공급나", uom: "EA" },
        { code: "M-MIS", name: "불일치", spec: "SPEC-M", supplier: "공급나", uom: "EA" },
        { code: "M-UNUSED", name: "미참조", spec: "SPEC-U", supplier: "공급가", uom: "EA" },
      ],
      boms: [
        { no: 1, product: "P-1", lines: [{ code: "M-001", name: "자재A", spec: "SPEC-A", qty: 2, uom: "EA" }, { code: "M-002", name: "자재B", spec: "SPEC-B", qty: 1, uom: "EA" }] },
        { no: 2, product: "P-2", lines: [{ code: "M-002", name: "자재B", spec: "SPEC-B", qty: 1, uom: "EA" }, { code: "M-MIS", name: "불일치", spec: "다른 규격", qty: 3, uom: "EA" }] },
        { no: 3, product: "P-3", lines: [{ code: "M-001", name: "자재A", spec: "SPEC-A", qty: ".", uom: "EA" }] },
      ],
      orders: [{ product: "P-ORDER-ONLY", customer: "고객가" }],
    })
    const { a } = analyze(sheets)
    const ds = buildApprovedDataset(a, { workbookSha256: "h", decisions: policy })
    // Dataset → "운영 DB 에서 읽은" Master (id/시각 없음)
    const fromDataset = (): ProdMaster => ({
      tenantId: "t1",
      items: ds.items.map((i) => ({ code: i.code, name: i.name, spec: i.spec, uom: i.uom, itemType: i.itemType, status: "ACTIVE", tenantId: "t1" })),
      boms: ds.boms.map((b) => ({
        itemCode: b.parentCode,
        version: b.version,
        status: "ACTIVE",
        isDefault: true,
        tenantId: "t1",
        lines: b.lines.map((l) => ({ seq: l.seq, componentCode: l.componentCode, qtyPer: l.qtyPer, scrapRate: 0, componentTenantId: "t1" })),
      })),
      partners: ds.partners.map((p) => ({ code: p.code, name: p.name, partnerType: p.partnerType, status: "ACTIVE", tenantId: "t1", businessNumber: null, ceoName: null, phone: null, email: null, address: null, contactName: null, contactPhone: null })),
      itemSuppliers: ds.itemSuppliers.map((s) => ({
        itemCode: s.itemCode,
        supplierCode: s.supplierCode,
        isDefault: false,
        leadTimeDays: null,
        moq: null,
        orderMultiple: null,
        isActive: true,
        tenantId: "t1",
        itemTenantId: "t1",
        supplierTenantId: "t1",
        supplierPartnerType: "SUPPLIER",
      })),
    })
    const m = fromDataset()

    // MC1 Dataset ↔ DB
    const c = compareToDataset(m, ds)
    eq(
      [c.items.MATCH, c.items.MISMATCH + c.items.MISSING + c.items.EXTRA, c.boms.MATCH, c.bomItems.MATCH, c.partners.MATCH, c.itemSuppliers.MATCH, c.boms.MISMATCH + c.bomItems.MISMATCH + c.partners.MISMATCH + c.itemSuppliers.MISMATCH],
      [ds.items.length, 0, ds.boms.length, ds.boms.reduce((s, b) => s + b.lines.length, 0), ds.partners.length, ds.itemSuppliers.length, 0],
      "MC1 Dataset ↔ DB: 전부 MATCH, MISMATCH/MISSING/EXTRA 0"
    )
    const broken = fromDataset()
    broken.items[0].name = "변경됨"
    broken.items.pop()
    broken.items.push({ code: "X-EXTRA", name: "x", spec: null, uom: "EA", itemType: "RAW_MATERIAL", status: "ACTIVE", tenantId: "t1" })
    broken.boms[0].lines[0].qtyPer = 77
    const cb = compareToDataset(broken, ds)
    eq([cb.items.MISMATCH, cb.items.MISSING, cb.items.EXTRA, cb.bomItems.MISMATCH], [1, 1, 1, 1], "MC1 변조 탐지: MISMATCH/MISSING/EXTRA/BOMItem 불일치")

    // MC2 item count / MC7 정합
    const ia = auditItems(m)
    eq([ia.total, ia.byType.FINISHED, ia.duplicateCode, ia.codeBlank, ia.nameBlank, ia.invalidType, ia.invalidUom, ia.tenantMismatch, ia.inactive], [ds.items.length, ds.items.filter((i) => i.itemType === "FINISHED").length, 0, 0, 0, 0, 0, 0, 0], "MC2 Item 감사: 건수/중복/공백/유형/단위/tenant/비활성 0")
    eq(ia.finishedPlaceholder, ia.byType.FINISHED, "MC2 FINISHED 전부 placeholder(name=code/EA/spec null) → MASTER_ENRICHMENT_REQUIRED")
    const badItems = fromDataset()
    badItems.items.push({ ...badItems.items[0] }, { code: " ", name: "", spec: null, uom: "XX", itemType: "BAD", status: "INACTIVE", tenantId: "other" })
    const iab = auditItems(badItems)
    ok(iab.duplicateCode === 1 && iab.codeBlank === 1 && iab.nameBlank === 1 && iab.invalidType === 1 && iab.invalidUom === 1 && iab.tenantMismatch === 1 && iab.inactive === 1, "MC2 결함 탐지")

    // MC3 BOM 무결성
    const ba = auditBoms(m)
    eq([ba.boms, ba.orphanParent, ba.orphanComponent, ba.tenantMismatch, ba.qtyInvalid, ba.duplicateComponent, ba.selfReference, ba.cycles, ba.duplicateDefaultBom, ba.defaultStatusInconsistent, ba.versionInvalid, ba.allActiveDefaultV1], [ds.boms.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true], "MC3 BOM 무결성 전부 0 / 전부 ACTIVE·default·v1")
    eq(ba.maxDepth, 1, "BOM 최대 깊이 = 1(FINISHED → RAW)")
    const badBom = fromDataset()
    badBom.boms[0].lines.push({ seq: 99, componentCode: badBom.boms[0].itemCode, qtyPer: 0, scrapRate: 0, componentTenantId: "t1" })
    badBom.boms[0].lines.push({ seq: 100, componentCode: "NOPE", qtyPer: 1, scrapRate: 0, componentTenantId: null })
    badBom.boms.push({ ...badBom.boms[0], version: "2", lines: [] })
    const bab = auditBoms(badBom)
    ok(bab.selfReference === 1 && bab.qtyInvalid === 1 && bab.orphanComponent === 1 && bab.duplicateDefaultBom === 1 && bab.cycles >= 1, "MC3 결함 탐지(자기참조/수량/구성품 누락/default 중복/순환)")

    // MC4 coverage + MC5 dependency
    const cov = coverageAndDependencies(m, a)
    eq([cov.finished, cov.withBom, cov.withoutBom, cov.coveragePct], [3, 1, 2, 33.3], "MC4 BOM Coverage(FINISHED 3 중 BOM 1)")
    eq([cov.withoutBomExplained.invalidQtyBom, cov.withoutBomExplained.blockedByReviewRaw, cov.withoutBomExplained.unexplained.length], [1, 1, 0], "MC4 BOM 없는 제품 전부 설명됨(수량 오류 1 + 차단 1)")
    eq(cov.orderOnlyInProduction, 0, "수주 전용 제품은 운영 Item 에 없음(Coverage 제외)")
    eq(cov.dependency, [{ rawCode: "M-MIS", blockedBoms: 1, affectedFinished: 1, unlockedIfOnlyThisApproved: 1 }], "MC5 RAW 의존성: M-MIS 가 BOM 1개/제품 1개 차단")

    // MC6 partner / MC7 ItemSupplier
    const pa = auditPartners(m)
    eq([pa.total, pa.customer, pa.supplier, pa.duplicateCode, pa.nameBlank, pa.invalidType, pa.tenantMismatch, pa.notActive, pa.masterEnrichmentRequired], [ds.partners.length, 1, ds.partners.length - 1, 0, 0, 0, 0, 0, ds.partners.length], "MC6 거래처 감사 + 전부 MASTER_ENRICHMENT_REQUIRED")
    eq(pa.enrichmentMissing.businessNumber, ds.partners.length, "사업자번호 없음 = 오류가 아니라 보완 대상")
    const isa = auditItemSuppliers(m)
    eq([isa.total, isa.duplicateRelation, isa.missingItem, isa.missingSupplier, isa.supplierTypeInvalid, isa.tenantMismatch, isa.isDefaultTrue, isa.leadTimeSet, isa.moqSet, isa.orderMultipleSet], [ds.itemSuppliers.length, 0, 0, 0, 0, 0, 0, 0, 0, 0], "MC7 ItemSupplier 감사: 중복/누락/타입/tenant 0, Default·LT·MOQ·배수 미설정")
    const ru = rawUsage(m)
    eq([ru.raw, ru.unusedImportedRaw, ru.distribution["1"] + ru.distribution["2-4"] + ru.distribution.unused], [ds.items.filter((i) => i.itemType === "RAW_MATERIAL").length, 0, ds.items.filter((i) => i.itemType === "RAW_MATERIAL").length], "RAW 사용 분포(미사용 0)")

    // MC8 transaction zero: 감사 모듈은 업무 테이블을 읽는 유일한 경로(CLI)에서 0 과 비교 — 여기서는 CLI 가 count 만 사용함을 정적 점검(MC12)

    // MC9 audit ↔ dataset ↔ DB 건수 정합(순수 비교)
    const counts = datasetCounts(ds)
    eq(
      [ia.total, ia.byType.FINISHED, ia.byType.RAW_MATERIAL, ba.boms, ba.bomItems, pa.customer, pa.supplier, isa.total],
      [counts.items, counts.finished, counts.raw, counts.boms, counts.bomItems, counts.customers, counts.suppliers, counts.itemSuppliers],
      "MC9 감사 건수 = Dataset 건수"
    )

    // MC10 review 템플릿
    const rawBomLines = extractDaewonWorkbook(sheets).bomLines.map((l) => ({ parentCode: l.parentCode, componentCode: l.component.raw ?? "", qty: l.qty, name: l.name, spec: l.spec, uom: l.uom, row: l.src.row }))
    const pack = buildReviewPack({ master: m, analysis: a, coverage: cov, rawBomLines })
    eq(Object.keys(pack).sort(), ["bom-review-template.csv", "finished-enrichment-template.csv", "item-supplier-enrichment-template.csv", "partner-enrichment-template.csv", "raw-review-template.csv"], "MC10 보완 템플릿 5종 생성")
    const fin = pack["finished-enrichment-template.csv"].split("\r\n").filter(Boolean)
    ok(fin[0].includes("itemCode,currentName,newName,currentSpec,newSpec,currentUom,newUom,confirmed,note"), "FINISHED 템플릿 헤더")
    eq(fin.length - 1, 3, "FINISHED 템플릿 행 = FINISHED 수")
    ok(fin[1].split(",")[2] === "" && fin[1].split(",")[4] === "" && fin[1].split(",")[6] === "" && fin[1].split(",")[7] === "", "newName/newSpec/newUom/confirmed 는 비어 있음(추정 안 함)")
    ok(pack["bom-review-template.csv"].includes("INVALID_QTY") && /INVALID_QTY,[^,]*,\.,/.test(pack["bom-review-template.csv"]) && pack["bom-review-template.csv"].includes("BLOCKED_BY_RAW_REVIEW"), "BOM 템플릿: 수량 오류 줄 + 차단 줄(confirmedQty 비움)")
    ok(pack["raw-review-template.csv"].includes("M-MIS") && pack["raw-review-template.csv"].includes("M-UNUSED") && pack["raw-review-template.csv"].includes("다른 규격"), "RAW 템플릿: 불일치 + 미참조 + BOM 줄 규격 표시")
    ok(pack["partner-enrichment-template.csv"].split("\r\n").filter(Boolean).length === ds.partners.length + 1, "거래처 템플릿 행 수")
    ok(pack["item-supplier-enrichment-template.csv"].split("\r\n").filter(Boolean).length === ds.itemSuppliers.length + 1, "ItemSupplier 템플릿 행 수")
    ok(pack["item-supplier-enrichment-template.csv"].split("\r\n")[1].split(",").slice(3, 6).every((v) => v === ""), "ItemSupplier 템플릿: LT/MOQ/배수 비움")
    eq(csvCell('a,"b"'), '"a,""b"""', "CSV 이스케이프")

    // MC11 master hash 결정성
    const h1 = masterBaseline(m)
    const shuffled = fromDataset()
    shuffled.items.reverse()
    shuffled.boms.reverse()
    shuffled.boms.forEach((b) => b.lines.reverse())
    shuffled.partners.reverse()
    shuffled.itemSuppliers.reverse()
    eq(masterBaseline(shuffled).hash, h1.hash, "MC11 입력 순서가 달라도 같은 Master hash")
    const changed = fromDataset()
    changed.items[0].spec = "다른 규격"
    ok(masterBaseline(changed).hash !== h1.hash, "값이 바뀌면 hash 변경")
    ok(/^[0-9a-f]{64}$/.test(h1.hash), "hash = sha256")

    // MC12 Production write 경로 없음(정적)
    const root = join(__dirname, "..")
    const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const auditSrc = noComments(readFileSync(join(root, "src", "lib", "master-migration", "audit.ts"), "utf8"))
    ok(!/prisma|\.(create|delete|upsert|createMany|updateMany|deleteMany)\(|\.update\((?!payload)/.test(auditSrc), "MC12 audit.ts: DB/쓰기 호출 없음(순수, hash update 제외)")
    const cliSrc = noComments(readFileSync(join(root, "scripts", "master-migration.ts"), "utf8"))
    const body = cliSrc.slice(cliSrc.indexOf("async function readProductionMaster"), cliSrc.indexOf("async function main()"))
    ok(!/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(body) && !/\$executeRaw/.test(body), "MC12 audit-production: 쓰기 호출/executeRaw 없음")
    ok(!/prisma\.\$queryRawUnsafe\(`\s*(insert|update|delete|drop|alter|truncate)/i.test(cliSrc), "raw SQL 은 SELECT 만")
  }

  // ═══ 요약 / provenance ══════════════════════════════════════════════════════
  section("요약 / provenance")
  {
    const { a, ex } = analyze(workbook({ materials: MATS, boms: BASE_BOMS, orders: [{ product: "P-1", customer: "고객가" }, { product: "P-X", customer: "고객가" }] }))
    const s = summarizeAnalysis(a, ex)
    eq([s.items.candidates, s.bom.parents, s.bom.lines, s.partners.customers, s.partners.suppliers], [6, 2, 4, 1, 2], "요약: Item 6(자재3+제품2+수주전용1) / BOM 2·4줄 / 고객 1 / 공급업체 2")
    eq(s.items.orderOnly, 1, "수주 전용 제품 1")
    const json = JSON.stringify(s)
    ok(!/고객가|공급가|자재A|SPEC-A/.test(json), "요약에는 실제 값(거래처명/품명/규격)이 들어가지 않음")
    eq(item(a, "M-001")!.sources[0], { sheet: "설정", row: 11, col: 2 }, "provenance: 원본 시트/행 보존")
    eq(bom(a, "P-1")!.lines[0].src, { sheet: "DB", row: 11, col: 5 }, "provenance: BOM 줄의 시트/행/열")
    eq(item(a, "P-X")!.sources, [{ sheet: "수주관리대장", row: 12 }], "수주 전용 후보도 위치 보존")
  }

  // ═══ seed 가드 ═══════════════════════════════════════════════════════════════
  section("seed 가드 / 정적 점검")
  {
    const prodLike = { DATABASE_URL: "postgresql://u:p@aws-0-x.pooler.example.com:6543/postgres", DIRECT_URL: "postgresql://u:p@aws-0-x.pooler.example.com:5432/postgres" }
    const guard = (env: Record<string, string>) => {
      try {
        assertDevSeedTarget(env)
        return "OK"
      } catch (e) {
        return isSeedGuardError(e) ? e.message : "OTHER"
      }
    }
    ok(/MASTER_SEED_CONFIRM/.test(guard({ ...prodLike })), "확인 플래그 없으면 거부")
    ok(/MASTER_SEED_DATABASE_URL/.test(guard({ ...prodLike, MASTER_SEED_CONFIRM: "DEV_ONLY" })), "대상 DB URL 이 별도 변수로 오지 않으면 거부")
    ok(/호스트가 DATABASE_URL 와 같습니다/.test(guard({ ...prodLike, MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://x:y@aws-0-x.pooler.example.com:6543/postgres" })), "운영(기본) DB 와 같은 호스트면 거부")
    eq(guard({ ...prodLike, MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://postgres:pw@localhost:5432/dev" }), "OK", "별도 개발 DB 는 허용")
    ok(/Vercel/.test(guard({ VERCEL: "1", MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://postgres:pw@localhost:5432/dev" })), "Vercel 에서는 거부")
    ok(/NODE_ENV=production/.test(guard({ NODE_ENV: "production", MASTER_SEED_CONFIRM: "DEV_ONLY", MASTER_SEED_DATABASE_URL: "postgresql://postgres:pw@localhost:5432/dev" })), "NODE_ENV=production 에서는 거부")

    const root = join(__dirname, "..")
    const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8")
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; prisma?: { seed?: string } }
    ok(!/master-migration/.test(pkg.scripts.build ?? "") && !/master-migration/.test(pkg.scripts.postinstall ?? ""), "build/postinstall 에서 Master 도구를 실행하지 않음")
    ok(!/seed|migrate|db push/.test(read("vercel.json")), "vercel.json 에 seed/migrate/db push 없음")
    ok(!/seed-daewon-master|master-migration/.test(pkg.prisma?.seed ?? ""), "prisma db seed 에 Master 도구가 연결되어 있지 않음")
    const gi = read(".gitignore")
    ok(/\.master-migration-out\//.test(gi), "개인정보가 담길 수 있는 산출물 폴더는 gitignore")
    // 라이브러리: Prisma 런타임/@ 별칭/MRP 엔진 비의존
    const files = ["analyze", "apply", "dataset", "extract", "reconcile", "report", "seed-guard", "sheet-report", "text", "types"]
    for (const f of files) {
      const src = read("src", "lib", "master-migration", f + ".ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      ok(!/from "@\//.test(src) && !/lib\/mrp\/order-mrp-engine/.test(src), `${f}.ts: @ 별칭/MRP 엔진 비의존`)
      ok(!/from "@prisma\/client"/.test(src.replace(/import type[^\n]*\n/g, "")), `${f}.ts: Prisma 런타임 import 없음(타입만)`)
    }
    const cli = read("scripts", "master-migration.ts")
    ok(!/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(cli.replace(/applyMasterDataset\([^)]*\)/g, "")), "CLI 에 직접 쓰기 호출 없음(apply 경유만)")
  }

  console.log(`\n✅ master-migration: ${passed} checks passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
