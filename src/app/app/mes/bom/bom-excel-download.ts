import type { BomExportRow } from "@/lib/actions/bom-excel.actions"

export async function downloadBomTemplate() {
  const XLSX = await import("xlsx")

  const guideRow = [
    "이 행은 안내용입니다. 실제 데이터는 3행부터 입력하고, 업로드 전 이 행을 삭제하지 않아도 됩니다.",
    "", "", "", "", "", "", "", "",
  ]
  const headerRow = [
    "완제품코드 *", "BOM명 *", "버전 *", "사용여부 *",
    "원자재코드 *", "소요수량 *", "단위 *", "로스율", "비고",
  ]
  const exampleRows = [
    ["FG-001", "완제품A BOM", "v1", "Y", "RM-001", 2.5, "KG", 5, "주요 원자재"],
    ["FG-001", "완제품A BOM", "v1", "Y", "RM-002", 1.0, "EA", 0, ""],
    ["FG-002", "완제품B BOM", "v1", "Y", "RM-003", 3.0, "KG", 3, ""],
  ]

  const ws = XLSX.utils.aoa_to_sheet([guideRow, headerRow, ...exampleRows])
  ws["!cols"] = [
    { wch: 16 }, { wch: 20 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 24 },
  ]

  const guideData = [
    ["컬럼", "필수", "설명", "허용값 / 예시"],
    ["완제품코드", "필수", "BOM 상위 품목 코드 (완제품 또는 반제품)", "시스템에 등록된 품목코드"],
    ["BOM명", "필수", "BOM 식별용 이름 (검증·미리보기 용도, DB 미저장)", "최대 100자"],
    ["버전", "필수", "BOM 버전 — 완제품코드 + 버전 조합이 고유해야 함", "v1, 1.0, 2024-01 등"],
    ["사용여부", "필수", "BOM 활성 상태", "Y = 활성(ACTIVE)  N = 비활성(INACTIVE)"],
    ["원자재코드", "필수", "자재 품목 코드 (원자재·반제품·소모품)", "시스템에 등록된 품목코드"],
    ["소요수량", "필수", "단위 당 소요량 (0보다 큰 숫자)", "2.5, 1, 0.5 등"],
    ["단위", "필수", "자재 품목의 기준단위 — 품목 등록과 일치해야 함", "EA, KG, G, L, ML, M, CM, MM, BOX, SET"],
    ["로스율", "선택", "공정 손실률 % (0~100, 빈 값이면 0으로 저장, DB 저장 범위 0~1)", "5 = 5%  0 = 손실 없음"],
    ["비고", "선택", "참고 메모 (DB 미저장)", ""],
    ["", "", "", ""],
    ["주의사항", "", "", ""],
    ["", "", "같은 완제품코드 + 버전 조합의 행들이 하나의 BOM을 구성합니다.", ""],
    ["", "", "같은 BOM 내 BOM명과 사용여부는 모든 행에서 동일해야 합니다.", ""],
    ["", "", "같은 BOM 내 원자재코드는 중복될 수 없습니다.", ""],
    ["", "", "이미 등록된 완제품코드 + 버전 BOM은 업로드할 수 없습니다.", ""],
    ["", "", "오류가 1건이라도 있으면 전체 등록이 차단됩니다.", ""],
    ["", "", "최대 1,000행, 5MB 이하의 .xlsx 파일만 업로드할 수 있습니다.", ""],
  ]

  const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 60 }, { wch: 42 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "BOM업로드")
  XLSX.utils.book_append_sheet(wb, wsGuide, "작성가이드")

  XLSX.writeFile(wb, "BOM_업로드양식.xlsx")
}

export async function downloadBomData(rows: BomExportRow[]) {
  const XLSX = await import("xlsx")

  if (rows.length === 0) {
    alert("다운로드할 BOM 데이터가 없습니다.")
    return
  }

  const headerRow = [
    "완제품코드", "완제품명", "버전", "사용여부",
    "원자재코드", "원자재명", "소요수량", "단위", "로스율(%)",
  ]
  const dataRows = rows.map((r) => [
    r.parentCode, r.parentName, r.version, r.statusLabel,
    r.componentCode, r.componentName, r.qtyPer, r.uom, r.scrapRatePct,
  ])

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])
  ws["!cols"] = [
    { wch: 16 }, { wch: 20 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "BOM현재데이터")

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  XLSX.writeFile(wb, `BOM_현재데이터_${date}.xlsx`)
}
