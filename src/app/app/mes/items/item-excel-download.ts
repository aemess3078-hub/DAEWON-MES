export default async function downloadItemTemplate() {
  const XLSX = await import("xlsx")

  const guideRow = [
    "※ 이 행은 안내용입니다. 데이터 입력 시 삭제하세요.",
    "", "", "", "", "", "", "",
  ]
  const headerRow = [
    "품목코드 *",
    "품목명 *",
    "품목분류코드 *",
    "품목군코드",
    "규격",
    "단위 *",
    "LOT관리여부 *",
    "사용여부",
  ]
  const exRow1 = ["ITEM-001", "의료용 마스크", "FIN-001", "GRP-001", "KF94", "EA", "Y", "Y"]
  const exRow2 = ["RM-001",   "부직포 원단",   "RAW-001", "",        "100g/m2", "M", "N", "Y"]

  const wsData = [guideRow, headerRow, exRow1, exRow2]
  const ws     = XLSX.utils.aoa_to_sheet(wsData)

  ws["!cols"] = [
    { wch: 16 }, { wch: 24 }, { wch: 16 },
    { wch: 14 }, { wch: 16 }, { wch: 8  },
    { wch: 14 }, { wch: 10 },
  ]

  const guideData = [
    ["항목",          "필수", "설명",                                         "허용값 / 예시"],
    ["품목코드",      "필수", "고유한 품목 식별 코드",                          "한글/영문/숫자/하이픈/언더스코어, 최대 50자"],
    ["품목명",        "필수", "품목의 이름",                                    "최대 200자"],
    ["품목분류코드",  "필수", "시스템에 등록된 품목분류 코드",                   "시스템 품목분류 코드 확인 후 입력"],
    ["품목군코드",    "선택", "품목군 코드 (품목분류에 속한 군)",                 "시스템 품목군 코드 / 빈칸 가능"],
    ["규격",          "선택", "품목의 규격 또는 스펙 설명",                      "예) KF94, 100g/m2"],
    ["단위",          "필수", "수량 단위",                                      "EA, KG, G, L, ML, M, CM, MM, BOX, SET"],
    ["LOT관리여부",   "필수", "LOT 단위 추적 여부",                             "Y 또는 N"],
    ["사용여부",      "선택", "품목 활성화 여부 (기본값 Y=활성)",                "Y = 활성, N = 비활성"],
    ["", "", "", ""],
    ["주의사항",      "",    "",                                               ""],
    ["",              "",    "1. 파일 내 품목코드는 중복될 수 없습니다.",       ""],
    ["",              "",    "2. 이미 등록된 품목코드는 사용할 수 없습니다.",   ""],
    ["",              "",    "3. 품목분류/품목군 코드는 시스템 등록값만 허용.", ""],
    ["",              "",    "4. 오류가 하나라도 있으면 전체 등록 불가합니다.", ""],
    ["",              "",    "5. 최대 1,000행까지 업로드 가능합니다.",         ""],
  ]
  const wsGuide  = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 50 }, { wch: 40 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws,      "품목업로드")
  XLSX.utils.book_append_sheet(wb, wsGuide, "작성가이드")

  XLSX.writeFile(wb, "품목정보_업로드양식.xlsx")
}
