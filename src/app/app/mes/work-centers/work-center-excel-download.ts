export default async function downloadWorkCenterTemplate() {
  const XLSX = await import("xlsx")

  const guideRow = [
    "이 행은 안내용입니다. 실제 데이터는 3행부터 입력하고, 업로드 전 이 행을 삭제하지 않아도 됩니다.",
    "", "", "", "",
  ]
  const headerRow = [
    "사업장코드 *",
    "작업센터코드 *",
    "작업센터명 *",
    "작업센터유형 *",
    "비고",
  ]
  const exampleRows = [
    ["SITE-001", "WC-CNC-001", "CNC 가공", "가공", "가공 작업센터"],
    ["SITE-001", "WC-QC-001", "최종 검사", "검사", ""],
  ]

  const ws = XLSX.utils.aoa_to_sheet([guideRow, headerRow, ...exampleRows])
  ws["!cols"] = [
    { wch: 16 },
    { wch: 18 },
    { wch: 24 },
    { wch: 16 },
    { wch: 28 },
  ]

  const guideData = [
    ["컬럼", "필수", "설명", "허용값 / 예시"],
    ["사업장코드", "필수", "시스템에 등록된 사업장 코드", "SITE-001"],
    ["작업센터코드", "필수", "사업장 안에서 고유한 작업센터 코드", "한글, 영문, 숫자, 하이픈, 언더스코어 / WC-CNC-001"],
    ["작업센터명", "필수", "작업센터 또는 공정 이름", "최대 200자"],
    ["작업센터유형", "필수", "작업센터 유형", "조립, 가공, 검사, 포장, 창고 또는 ASSEMBLY, MACHINING, INSPECTION, PACKAGING, STORAGE"],
    ["비고", "선택", "업로드 검토용 메모입니다. DB에는 저장되지 않습니다.", "최대 500자"],
    ["", "", "", ""],
    ["주의사항", "", "", ""],
    ["", "", "오류가 1건이라도 있으면 전체 등록이 차단됩니다.", ""],
    ["", "", "이미 등록된 작업센터코드는 같은 사업장 안에서 다시 사용할 수 없습니다.", ""],
    ["", "", "사업장코드는 시스템에 등록된 값만 사용할 수 있습니다.", ""],
    ["", "", "최대 1,000행, 5MB 이하의 .xlsx 파일만 업로드할 수 있습니다.", ""],
    ["", "", "AuditLog에는 업로드 원문 전체를 저장하지 않고 작업센터코드 최대 20개만 기록합니다.", ""],
  ]
  const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 58 }, { wch: 62 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "공정작업장업로드")
  XLSX.utils.book_append_sheet(wb, wsGuide, "작성가이드")

  XLSX.writeFile(wb, "공정작업장_업로드양식.xlsx")
}
