// 계측기 검교정 엑셀 다운로드 (브라우저 전용). 워크북 생성은 src/lib/instrument-calibration-excel.ts

import type { ExportCell } from "@/lib/instrument-calibration-view"
import { kstDateStamp } from "@/lib/export-excel"
import { buildCalibrationWorkbook } from "@/lib/instrument-calibration-excel"

export async function downloadCalibrationWorkbook(params: {
  fileLabel: string
  sheetName: string
  header: string[]
  rows: ExportCell[][]
}): Promise<void> {
  const { XLSX, wb } = await buildCalibrationWorkbook(params)
  XLSX.writeFile(wb, `${params.fileLabel}_${kstDateStamp()}.xlsx`)
}
