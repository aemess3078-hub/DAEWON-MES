import type { RoutingExportRow } from "@/lib/actions/routing-excel.actions"

export async function downloadRoutingTemplate() {
  const XLSX = await import("xlsx")

  const guideRow = [
    "이 행은 안내용입니다. 실제 데이터는 3행부터 입력하고, 업로드 전 이 행을 삭제하지 않아도 됩니다.",
    "", "", "", "", "", "", "", "", "",
  ]
  const headerRow = [
    "품목코드 *", "라우팅코드 *", "라우팅명 *", "버전 *", "사용여부 *",
    "공정순서 *", "공정코드 *", "공정명", "표준시간(분)", "비고",
  ]
  const exampleRows = [
    ["FG-001", "RT-FG001-v1", "완제품A 공정", "v1", "Y", 10, "WC-ASM", "조립 공정", 30, ""],
    ["FG-001", "RT-FG001-v1", "완제품A 공정", "v1", "Y", 20, "WC-INS", "검사 공정", 15, ""],
    ["FG-002", "RT-FG002-v1", "완제품B 공정", "v1", "Y", 10, "WC-MAC", "가공 공정", 45, ""],
  ]

  const ws = XLSX.utils.aoa_to_sheet([guideRow, headerRow, ...exampleRows])
  ws["!cols"] = [
    { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 },
  ]

  const guideData = [
    ["컬럼", "필수", "설명", "허용값 / 예시"],
    ["품목코드", "필수", "라우팅 대상 품목 코드 (완제품 또는 반제품)", "시스템에 등록된 품목코드"],
    ["라우팅코드", "필수", "라우팅 고유 코드 — tenant 기준 중복 불가", "RT-FG001-v1, R001 등"],
    ["라우팅명", "필수", "라우팅 이름", "최대 200자"],
    ["버전", "필수", "라우팅 버전", "v1, 1.0, 2024-01 등"],
    ["사용여부", "필수", "라우팅 활성 상태", "Y = 활성(ACTIVE)  N = 비활성(INACTIVE)"],
    ["공정순서", "필수", "공정 실행 순서 (0보다 큰 정수, 같은 라우팅 내 중복 불가)", "10, 20, 30 등"],
    ["공정코드", "필수", "작업장 코드 — 시스템에 등록된 작업장 코드와 일치해야 함", "시스템에 등록된 작업장 코드"],
    ["공정명", "선택", "공정 이름 (빈 값이면 작업장 이름으로 자동 설정)", "조립 공정, 검사 공정 등"],
    ["표준시간(분)", "선택", "공정 표준 소요 시간(분, 0 이상, 빈 값이면 0)", "30, 15, 45.5 등"],
    ["비고", "선택", "참고 메모 (DB 미저장)", ""],
    ["", "", "", ""],
    ["주의사항", "", "", ""],
    ["", "", "같은 라우팅코드의 행들이 하나의 라우팅을 구성합니다.", ""],
    ["", "", "같은 라우팅 내 품목코드·라우팅명·버전·사용여부는 모든 행에서 동일해야 합니다.", ""],
    ["", "", "같은 라우팅 내 공정순서는 중복될 수 없습니다.", ""],
    ["", "", "이미 등록된 라우팅코드는 업로드할 수 없습니다.", ""],
    ["", "", "오류가 1건이라도 있으면 전체 등록이 차단됩니다.", ""],
    ["", "", "최대 1,000행, 5MB 이하의 .xlsx 파일만 업로드할 수 있습니다.", ""],
  ]

  const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 62 }, { wch: 42 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "라우팅업로드")
  XLSX.utils.book_append_sheet(wb, wsGuide, "작성가이드")

  XLSX.writeFile(wb, "라우팅_업로드양식.xlsx")
}

export async function downloadRoutingData(rows: RoutingExportRow[]) {
  const XLSX = await import("xlsx")

  if (rows.length === 0) {
    alert("다운로드할 라우팅 데이터가 없습니다.")
    return
  }

  const headerRow = [
    "품목코드", "품목명", "라우팅코드", "라우팅명", "버전", "사용여부",
    "공정순서", "공정코드", "공정명", "작업장코드", "작업장명", "표준시간(분)",
  ]
  const dataRows = rows.map((r) => [
    r.itemCode, r.itemName, r.routingCode, r.routingName, r.version, r.statusLabel,
    r.seq, r.operationCode, r.operationName, r.workCenterCode, r.workCenterName, r.standardTime,
  ])

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])
  ws["!cols"] = [
    { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "라우팅현재데이터")

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  XLSX.writeFile(wb, `라우팅_현재데이터_${date}.xlsx`)
}
