/**
 * 대원정밀 MRP 프로그램(V09) 레이아웃 추출 (순수 — GridLike 입력)
 *
 * 읽는 것(Master): 설정(자재 목록) / DB(제품 목록 + 제품별 BOM 블록)
 * 식별자만 읽는 것: 수주관리대장(제품 코드 / 고객명), 재고관리대장(자재 식별 정보 — 교차 검증용)
 * 읽지 않는 것: 수량/납기/출고/재고 수량/입출고/생산 — 운영 정보는 추출하지 않는다(Phase 7 원칙).
 */

import { cleanText, inspectCode } from "./text"
import type { CodeInfo, GridLike, RawBomLine, RawCodeRef, RawExtraction, RawMaterialRow, RawNameRef, RawProduct } from "./types"

export const DAEWON_V09_LAYOUT = {
  settings: { sheet: "설정", firstRow: 11, code: 2, name: 3, spec: 4, supplier: 5, uom: 6, remark: 7 },
  db: { sheet: "DB", productNoCol: 1, productCodeCol: 2, blockFirstRow: 11, blockWidth: 5 },
  orders: { sheet: "수주관리대장", firstRow: 11, product: 3, customer: 7 },
  stock: { sheet: "재고관리대장", firstRow: 11, code: 2, name: 3, spec: 4, supplier: 5 },
} as const

/** 단위 문자열은 공백/대소문자를 보정하지 않고 원본 그대로 둔다(보정 여부는 검증 단계가 REVIEW 로 판단) */
function rawUnit(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null
  const s = String(cell)
  return s.trim().length === 0 ? null : s
}

function findSheet(sheets: readonly GridLike[], name: string): GridLike | null {
  return sheets.find((s) => s.name === name) ?? null
}

function isRowEmpty(grid: GridLike, row: number, cols: number[]): boolean {
  return cols.every((c) => {
    const v = grid.get(row, c)
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "")
  })
}

export function extractDaewonWorkbook(sheets: readonly GridLike[]): RawExtraction {
  const L = DAEWON_V09_LAYOUT
  const out: RawExtraction = {
    materials: [],
    products: [],
    bomLines: [],
    structuralIssues: [],
    orderRefs: { products: [], customers: [], rowCount: 0 },
    stockSheetMaterials: [],
  }

  // ── 설정: 자재 목록 ──
  const settings = findSheet(sheets, L.settings.sheet)
  if (settings) {
    const cols = [L.settings.code, L.settings.name, L.settings.spec, L.settings.supplier, L.settings.uom, L.settings.remark]
    for (let r = L.settings.firstRow; r <= settings.maxRow; r++) {
      if (isRowEmpty(settings, r, cols)) continue
      const row: RawMaterialRow = {
        code: inspectCode(settings.get(r, L.settings.code), settings.format?.(r, L.settings.code)),
        name: cleanText(settings.get(r, L.settings.name)),
        spec: cleanText(settings.get(r, L.settings.spec)),
        uom: rawUnit(settings.get(r, L.settings.uom)),
        supplier: cleanText(settings.get(r, L.settings.supplier)),
        remark: cleanText(settings.get(r, L.settings.remark)),
        src: { sheet: L.settings.sheet, row: r, col: L.settings.code },
      }
      out.materials.push(row)
    }
  } else {
    out.structuralIssues.push({ code: "SHEET_MISSING", message: `시트 없음: ${L.settings.sheet}`, src: { sheet: L.settings.sheet, row: 0 } })
  }

  // ── DB: 제품 목록 + BOM 블록(번호 k 의 블록 = 5k..5k+4 열: 코드, 부품명, 규격, 수량, 단위) ──
  const db = findSheet(sheets, L.db.sheet)
  if (db) {
    const seenNo = new Set<number>()
    for (let r = 1; r <= db.maxRow; r++) {
      const cellCode = db.get(r, L.db.productCodeCol)
      if (cellCode === null || cellCode === undefined || cellCode === "") continue
      const noCell = db.get(r, L.db.productNoCol)
      const product: RawProduct = {
        no: noCell,
        code: inspectCode(cellCode, db.format?.(r, L.db.productCodeCol)),
        src: { sheet: L.db.sheet, row: r, col: L.db.productCodeCol },
      }
      out.products.push(product)
      const no = typeof noCell === "number" && Number.isInteger(noCell) && noCell >= 1 ? noCell : null
      if (no === null) {
        out.structuralIssues.push({ code: "PRODUCT_NO_INVALID", message: "제품 번호가 올바르지 않아 BOM 블록 위치를 계산할 수 없습니다", src: product.src })
        continue
      }
      if (seenNo.has(no)) {
        out.structuralIssues.push({ code: "PRODUCT_NO_DUPLICATE", message: `제품 번호 ${no} 중복`, src: product.src })
        continue
      }
      seenNo.add(no)
      if (product.code.raw === null) continue
      const col = L.db.blockWidth * no
      for (let rr = L.db.blockFirstRow; rr <= db.maxRow; rr++) {
        const codeCell = db.get(rr, col)
        const nameCell = db.get(rr, col + 1)
        const specCell = db.get(rr, col + 2)
        const qtyCell = db.get(rr, col + 3)
        const unitCell = db.get(rr, col + 4)
        const allEmpty = [codeCell, nameCell, specCell, qtyCell, unitCell].every((v) => v === null || v === undefined || v === "")
        if (allEmpty) continue
        out.bomLines.push({
          parentCode: product.code.raw,
          parentSrc: product.src,
          component: inspectCode(codeCell, db.format?.(rr, col)),
          name: cleanText(nameCell),
          spec: cleanText(specCell),
          qty: qtyCell === undefined ? null : qtyCell,
          uom: rawUnit(unitCell),
          src: { sheet: L.db.sheet, row: rr, col },
        })
      }
    }
  } else {
    out.structuralIssues.push({ code: "SHEET_MISSING", message: `시트 없음: ${L.db.sheet}`, src: { sheet: L.db.sheet, row: 0 } })
  }

  // ── 수주관리대장: 식별자만(제품 코드 / 고객명). 수량·납기·출고는 읽지 않는다 ──
  const orders = findSheet(sheets, L.orders.sheet)
  if (orders) {
    const products = new Map<string, { info: CodeInfo; count: number; firstRow: number }>()
    const customers = new Map<string, RawNameRef>()
    for (let r = L.orders.firstRow; r <= orders.maxRow; r++) {
      const productCell = orders.get(r, L.orders.product)
      const customerCell = orders.get(r, L.orders.customer)
      if (isRowEmpty(orders, r, [L.orders.product, L.orders.customer])) continue
      out.orderRefs.rowCount += 1
      if (productCell !== null && productCell !== undefined && productCell !== "") {
        const info = inspectCode(productCell)
        const key = info.raw ?? ""
        const e = products.get(key)
        if (e) e.count += 1
        else products.set(key, { info, count: 1, firstRow: r })
      }
      const customer = cleanText(customerCell)
      if (customer !== null) {
        const e = customers.get(customer)
        if (e) e.count += 1
        else customers.set(customer, { name: customer, count: 1, firstRow: r })
      }
    }
    products.forEach((v) => out.orderRefs.products.push({ code: v.info, count: v.count, firstRow: v.firstRow } as RawCodeRef))
    customers.forEach((v) => out.orderRefs.customers.push(v))
  }

  // ── 재고관리대장: 자재 식별 정보만(교차 검증용). 재고 수량은 읽지 않는다 ──
  const stock = findSheet(sheets, L.stock.sheet)
  if (stock) {
    for (let r = L.stock.firstRow; r <= stock.maxRow; r++) {
      if (isRowEmpty(stock, r, [L.stock.code, L.stock.name, L.stock.spec, L.stock.supplier])) continue
      out.stockSheetMaterials.push({
        code: inspectCode(stock.get(r, L.stock.code)),
        name: cleanText(stock.get(r, L.stock.name)),
        spec: cleanText(stock.get(r, L.stock.spec)),
        supplier: cleanText(stock.get(r, L.stock.supplier)),
        src: { sheet: L.stock.sheet, row: r, col: L.stock.code },
      })
    }
  }

  return out
}
