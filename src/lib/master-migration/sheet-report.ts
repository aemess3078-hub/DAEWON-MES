/**
 * Workbook 시트 분류 보고 (순수)
 *
 * 날짜 범위는 "자료가 얼마나 오래됐는가"를 보고하는 용도로만 쓴다.
 * 최신 날짜가 최근이라고 해서 운영 정보를 이관하지 않는다(현재 유효한지 알 수 없다).
 */

import type { GridLike } from "./types"

export type SheetClass = "MASTER" | "TRANSACTION" | "CURRENT_STATE" | "CALCULATION" | "REFERENCE_ONLY" | "UNCLASSIFIED"

type Probe =
  | { label: string; kind: "cell"; row: number; col: number }
  | { label: string; kind: "col"; col: number; fromRow: number }
  | { label: string; kind: "row"; row: number; fromCol: number }

type Policy = {
  role: string
  class: SheetClass
  /** 사용 행 수를 세는 기준(데이터 시작 행, 판단 열) */
  rows: { firstRow: number; cols: number[] }
  phase7Use: string
  seedUse: string
  prodImportCandidate: boolean
  probes: Probe[]
}

export const SHEET_POLICY: Record<string, Policy> = {
  Help: {
    role: "사용 설명/안내문",
    class: "REFERENCE_ONLY",
    rows: { firstRow: 1, cols: [2] },
    phase7Use: "사용 안 함",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [{ label: "A2(시스템 값)", kind: "cell", row: 2, col: 1 }],
  },
  수주관리대장: {
    role: "수주 입력대장(관리번호/제품/수량/납기/고객)",
    class: "TRANSACTION",
    rows: { firstRow: 11, cols: [2, 3] },
    phase7Use: "식별자(제품 코드/고객명)만 REVIEW 후보로 참조. 수주 자체는 이관 안 함",
    seedUse: "사용 안 함(데모 수주는 가상으로 별도 생성)",
    prodImportCandidate: false,
    probes: [{ label: "납기", kind: "col", col: 5, fromRow: 11 }],
  },
  입고관리대장: {
    role: "자재 입고 입력대장(헤더만 존재)",
    class: "TRANSACTION",
    rows: { firstRow: 11, cols: [2, 7, 8] },
    phase7Use: "사용 안 함",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [{ label: "입고일자", kind: "col", col: 7, fromRow: 11 }],
  },
  출고관리대장: {
    role: "일자별 출고(소요) 관리대장 — 수주 기반 계산 결과",
    class: "CALCULATION",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "사용 안 함(자재 목록은 설정 시트가 원천)",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [{ label: "출고일자(머리글)", kind: "row", row: 9, fromCol: 8 }],
  },
  출고예정소요량: {
    role: "수주 라인 × 자재 소요량 계산 결과",
    class: "CALCULATION",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "MRP 회귀검증(Golden) 자료로만 사용",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [{ label: "납기일(머리글)", kind: "row", row: 9, fromCol: 8 }],
  },
  재고관리대장: {
    role: "자재별 재고 현황(입고/출고/재고/예정/부족) + 자재 목록 사본",
    class: "CURRENT_STATE",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "식별 정보(코드/품명/규격/거래처)를 설정 시트와 교차 검증하는 용도만. 수량 이관 안 함",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [{ label: "작성일자", kind: "cell", row: 2, col: 8 }],
  },
  "예상소요량(기간)": {
    role: "기간별 예상 소요 계산 결과",
    class: "CALCULATION",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "사용 안 함",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [
      { label: "시작일", kind: "cell", row: 4, col: 5 },
      { label: "종료일", kind: "cell", row: 5, col: 5 },
    ],
  },
  "예상소요량(품목)": {
    role: "품목별 예상 소요 계산 결과",
    class: "CALCULATION",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "사용 안 함",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [],
  },
  MRP작성: {
    role: "MRP 계산 결과(소요량/예상재고/결품)",
    class: "CALCULATION",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "MRP 회귀검증(Golden) 자료로만 사용",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [
      { label: "작성일자", kind: "cell", row: 2, col: 8 },
      { label: "시작일", kind: "cell", row: 5, col: 8 },
      { label: "종료일", kind: "cell", row: 6, col: 8 },
    ],
  },
  BOM작성: {
    role: "BOM 편집 작업 영역(현재 편집 중인 1개 제품) + 저장 제품 목록",
    class: "REFERENCE_ONLY",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "사용 안 함(저장된 BOM 은 DB 시트가 원천)",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [],
  },
  설정: {
    role: "사용 부품 설정(자재 코드/품명/규격/거래처/단위) — 자재 마스터",
    class: "MASTER",
    rows: { firstRow: 11, cols: [2] },
    phase7Use: "Item(자재), 공급업체 후보, ItemSupplier 후보의 원천",
    seedUse: "Master seed 원천(검증 통과분만)",
    prodImportCandidate: true,
    probes: [],
  },
  SETT: {
    role: "프로그램 내부 설정(기간 선택값 등)",
    class: "REFERENCE_ONLY",
    rows: { firstRow: 1, cols: [1] },
    phase7Use: "사용 안 함",
    seedUse: "사용 안 함",
    prodImportCandidate: false,
    probes: [
      { label: "기준일(A2)", kind: "cell", row: 2, col: 1 },
      { label: "시작일", kind: "cell", row: 7, col: 2 },
      { label: "종료일", kind: "cell", row: 7, col: 3 },
    ],
  },
  DB: {
    role: "제품 목록 + 제품별 BOM 저장소(번호 k 의 블록 = 5k..5k+4 열)",
    class: "MASTER",
    rows: { firstRow: 1, cols: [2] },
    phase7Use: "제품(FINISHED 후보)과 BOM 의 원천",
    seedUse: "Master seed 원천(검증 통과분만)",
    prodImportCandidate: true,
    probes: [],
  },
}

export type SheetReportRow = {
  sheet: string
  role: string
  class: SheetClass
  usedRows: number
  maxRow: number
  maxCol: number
  nonEmptyCells: number
  headers: string[]
  dateRange: { min: string; max: string; samples: number } | null
  dateProbes: Array<{ label: string; min: string; max: string; samples: number }>
  phase7Use: string
  seedUse: string
  prodImportCandidate: boolean
}

const SERIAL_MIN = 36526 // 2000-01-01
const SERIAL_MAX = 62000 // ≈ 2069

function serialToDate(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10)
}

function isDateSerial(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= SERIAL_MIN && v <= SERIAL_MAX && Math.floor(v) === v
}

function collect(grid: GridLike, p: Probe): number[] {
  const out: number[] = []
  if (p.kind === "cell") {
    const v = grid.get(p.row, p.col)
    if (isDateSerial(v)) out.push(v)
  } else if (p.kind === "col") {
    for (let r = p.fromRow; r <= grid.maxRow; r++) {
      const v = grid.get(r, p.col)
      if (isDateSerial(v)) out.push(v)
    }
  } else {
    for (let c = p.fromCol; c <= grid.maxCol; c++) {
      const v = grid.get(p.row, c)
      if (isDateSerial(v)) out.push(v)
    }
  }
  return out
}

export function buildSheetReport(sheets: readonly GridLike[]): SheetReportRow[] {
  return sheets.map((g) => {
    const policy = SHEET_POLICY[g.name]
    const rowsCfg = policy?.rows ?? { firstRow: 1, cols: [2] }
    let usedRows = 0
    for (let r = rowsCfg.firstRow; r <= g.maxRow; r++) {
      if (rowsCfg.cols.some((c) => g.get(r, c) !== null && g.get(r, c) !== undefined && g.get(r, c) !== "")) usedRows += 1
    }
    const headers: string[] = []
    for (let c = 1; c <= Math.min(g.maxCol, 14); c++) {
      const v = g.get(9, c)
      if (typeof v === "string" && v.trim() !== "") headers.push(v.trim().replace(/\s+/g, " "))
    }
    const dateProbes: SheetReportRow["dateProbes"] = []
    const all: number[] = []
    ;(policy?.probes ?? []).forEach((p) => {
      const values = collect(g, p)
      if (values.length === 0) return
      all.push(...values)
      dateProbes.push({ label: p.label, min: serialToDate(Math.min(...values)), max: serialToDate(Math.max(...values)), samples: values.length })
    })
    return {
      sheet: g.name,
      role: policy?.role ?? "미분류 시트",
      class: policy?.class ?? "UNCLASSIFIED",
      usedRows,
      maxRow: g.maxRow,
      maxCol: g.maxCol,
      nonEmptyCells: g.nonEmptyCount,
      headers,
      dateRange: all.length > 0 ? { min: serialToDate(Math.min(...all)), max: serialToDate(Math.max(...all)), samples: all.length } : null,
      dateProbes,
      phase7Use: policy?.phase7Use ?? "미분류 — 사용 안 함",
      seedUse: policy?.seedUse ?? "사용 안 함",
      prodImportCandidate: policy?.prodImportCandidate ?? false,
    }
  })
}
