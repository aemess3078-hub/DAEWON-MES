// 계측기 검교정 엑셀 워크북 생성 (브라우저/Node 공용 — 파일 저장은 호출하는 쪽이 한다)
// - 관리번호/Serial No/성적서번호는 문자열 셀로 쓴다(선행 0 보존).
// - 날짜는 엑셀 날짜 셀(yyyy-mm-dd 서식)로 쓴다. SheetJS 의 Date 변환은 로컬 timezone 영향을 받으므로
//   1899-12-30 기준 일수(serial)를 직접 계산해 넣는다.

import type { ExportCell } from "./instrument-calibration-view"

export function dateKeyToExcelSerial(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569
}

export async function buildCalibrationWorkbook(params: { sheetName: string; header: string[]; rows: ExportCell[][] }) {
  const XLSX = await import("xlsx")
  const plain: (string | number | null)[][] = params.rows.map((row) =>
    row.map((cell) => (cell !== null && typeof cell === "object" ? null : cell)),
  )
  const ws = XLSX.utils.aoa_to_sheet([params.header, ...plain])

  params.rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (cell !== null && typeof cell === "object") {
        const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex })
        ws[address] = { t: "n", v: dateKeyToExcelSerial(cell.date), z: "yyyy-mm-dd" }
      }
    })
  })

  ws["!cols"] = params.header.map((title, colIndex) => {
    const longest = Math.max(
      title.length,
      ...params.rows.map((row) => {
        const cell = row[colIndex]
        if (cell === null || cell === undefined) return 0
        return typeof cell === "object" ? 10 : String(cell).length
      }),
    )
    return { wch: Math.min(Math.max(longest + 2, 8), 40) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, params.sheetName)
  return { XLSX, wb }
}
