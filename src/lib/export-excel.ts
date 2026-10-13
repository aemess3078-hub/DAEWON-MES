// 리포트(생산일보/품질리포트/설비리포트) 공용 Excel 다운로드 헬퍼.
//
// 기존 화면들(audit-log-table.tsx, bom-excel-download.ts 등)은 각자
// `const XLSX = await import("xlsx")` + `book_new`/`aoa_to_sheet`/`writeFile`
// 패턴을 반복 구현해왔다(공용 헬퍼가 없었음). 리포트 3종이 동시에 이 패턴을
// 새로 필요로 하므로 이번에 한해 작은 공용 헬퍼로 추출한다 — 기존 화면들의
// 개별 구현은 건드리지 않는다(대규모 리팩터링 금지 원칙).
//
// 클라이언트 전용(브라우저 File 다운로드) — "use server" 파일에서 import하지
// 않는다.

/** 파일명에 쓸 KST 기준 날짜 문자열(YYYYMMDD). */
export function kstDateStamp(date: Date = new Date()): string {
  return date
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
    .replace(/-/g, "")
}

/**
 * 단일 시트 Excel 파일을 즉시 다운로드한다.
 * - header: 첫 행(컬럼명)
 * - rows: 그 뒤의 데이터 행들 (문자열/숫자만 — 포맷된 표시 문자열을 그대로 넣는다)
 */
export async function downloadExcelSheet(
  filename: string,
  sheetName: string,
  header: string[],
  rows: (string | number)[][]
): Promise<void> {
  const XLSX = await import("xlsx")
  const wsData = [header, ...rows]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}
