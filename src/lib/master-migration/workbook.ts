/**
 * Workbook 읽기 (CLI 전용 — 앱 번들에서 import 하지 않는다)
 *
 *  - 저장된 셀 값만 읽는다. 매크로(VBA)는 실행/해석하지 않는다(xlsx 라이브러리는 vbaProject.bin 을 값으로만 보관).
 *  - 원본 파일은 수정하지 않는다. 읽기 전용 Buffer 만 사용한다.
 */

import { createHash } from "node:crypto"
import * as XLSX from "xlsx"
import type { GridCell, GridLike } from "./types"

class SheetGrid implements GridLike {
  readonly name: string
  readonly maxRow: number
  readonly maxCol: number
  readonly nonEmptyCount: number
  private readonly cells = new Map<number, { v: GridCell; z?: string }>()

  constructor(name: string, ws: XLSX.WorkSheet) {
    this.name = name
    let maxRow = 0
    let maxCol = 0
    let n = 0
    Object.keys(ws).forEach((key) => {
      if (key.charAt(0) === "!") return
      const cell = ws[key] as XLSX.CellObject
      if (cell.v === undefined || cell.v === null || cell.v === "") return
      const addr = XLSX.utils.decode_cell(key)
      const r = addr.r + 1
      const c = addr.c + 1
      const v = cell.v as GridCell
      this.cells.set(r * 100000 + c, { v, z: typeof cell.z === "string" ? cell.z : undefined })
      if (r > maxRow) maxRow = r
      if (c > maxCol) maxCol = c
      n += 1
    })
    this.maxRow = maxRow
    this.maxCol = maxCol
    this.nonEmptyCount = n
  }

  get(row: number, col: number): GridCell {
    return this.cells.get(row * 100000 + col)?.v
  }

  format(row: number, col: number): string | undefined {
    return this.cells.get(row * 100000 + col)?.z
  }
}

export function readWorkbookGrids(buffer: Buffer): { sheets: GridLike[]; sha256: string; sheetNames: string[] } {
  const sha256 = createHash("sha256").update(buffer).digest("hex")
  // bookVBA:false → 매크로 바이너리를 읽지 않는다. 수식은 읽지 않고 저장된 값만 사용한다.
  const wb = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellDates: false, cellNF: true, bookVBA: false })
  const sheets = wb.SheetNames.map((name) => new SheetGrid(name, wb.Sheets[name]))
  return { sheets, sha256, sheetNames: wb.SheetNames }
}
