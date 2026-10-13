type PartnerTypeParam = "CUSTOMER" | "SUPPLIER" | "BOTH"

export default async function downloadPartnerTemplate(fixedType?: PartnerTypeParam) {
  const XLSX = await import("xlsx")

  const guideRow = [
    "이 행은 안내용입니다. 실제 데이터는 3행부터 입력하고, 업로드 전 이 행을 삭제하지 않아도 됩니다.",
    "", "", "", "", "", "", "", "", "", "", "", "",
  ]
  const headerRow = [
    "거래처코드 *",
    "거래처명 *",
    "거래처구분 *",
    "사업자등록번호",
    "대표자명",
    "전화번호",
    "이메일",
    "이메일2",
    "주소",
    "담당자명",
    "담당자연락처",
    "사용여부 *",
    "비고",
  ]

  const typeLabel = fixedType === "CUSTOMER" ? "고객사" : fixedType === "SUPPLIER" ? "거래처" : undefined
  const exampleRows =
    fixedType === "CUSTOMER"
      ? [
          ["CUS-001", "수출 고객사", "고객사", "", "", "", "", "", "", "", "", "Y", ""],
          ["CUS-002", "국내 고객사", "고객사", "123-45-67890", "홍길동", "02-1234-5678", "sales@example.com", "cs@example.com", "서울시 중구", "", "", "Y", ""],
          ["BP-BTH-001", "동방산업(주)", "고객사+거래처", "", "", "", "", "", "", "", "", "Y", "거래처 겸용"],
        ]
      : fixedType === "SUPPLIER"
      ? [
          ["BP-001", "메디컬 부자재", "거래처", "123-45-67890", "홍길동", "02-1234-5678", "partner@example.com", "manager@example.com", "서울시 중구", "김담당", "010-1234-5678", "Y", "원부자재 공급"],
          ["BP-002", "포장재 공급사", "거래처", "", "", "", "", "", "", "", "", "Y", ""],
          ["BP-BTH-001", "동방산업(주)", "고객사+거래처", "", "", "", "", "", "", "", "", "Y", "고객사 겸용"],
        ]
      : [
          ["BP-001", "메디컬 부자재", "거래처", "123-45-67890", "홍길동", "02-1234-5678", "partner@example.com", "manager@example.com", "서울시 중구", "김담당", "010-1234-5678", "Y", "원부자재 공급"],
          ["CUS-001", "수출 고객사", "고객사", "", "", "", "", "", "", "", "", "Y", ""],
          ["BP-BTH-001", "동방산업(주)", "고객사+거래처", "", "", "", "", "", "", "", "", "Y", "겸용"],
        ]
  const fileName = typeLabel ? `${typeLabel}관리_업로드양식.xlsx` : "거래처관리_업로드양식.xlsx"

  const ws = XLSX.utils.aoa_to_sheet([guideRow, headerRow, ...exampleRows])
  ws["!cols"] = [
    { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 18 },
    { wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 24 }, { wch: 30 },
    { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 24 },
  ]

  const guideData = [
    ["컬럼", "필수", "설명", "허용값 / 예시"],
    ["거래처코드", "필수", "고유 거래처 코드", "영문, 숫자, 하이픈, 언더스코어 / BP-001"],
    ["거래처명", "필수", "거래처 이름", "최대 200자"],
    ["거래처구분", "필수", "거래처 유형", typeLabel ? `"${typeLabel}" 또는 "고객사+거래처"(양쪽 겸용)만 입력` : "고객사, 거래처, 고객사+거래처 또는 CUSTOMER, SUPPLIER, BOTH"],
    ["사업자등록번호", "선택", "사업자등록번호", "123-45-67890 또는 1234567890"],
    ["대표자명", "선택", "대표자 이름", ""],
    ["전화번호", "선택", "대표 전화번호", ""],
    ["이메일", "선택", "대표 이메일(이메일1)", "partner@example.com"],
    ["이메일2", "선택", "추가/담당자 이메일", "manager@example.com"],
    ["주소", "선택", "주소", ""],
    ["담당자명", "선택", "담당자 이름", ""],
    ["담당자연락처", "선택", "담당자 연락처", ""],
    ["사용여부", "필수", "활성 여부", "Y = 활성, N = 비활성"],
    ["비고", "선택", "내부 참고 메모", ""],
    ["", "", "", ""],
    ["주의사항", "", "", ""],
    ["", "", "오류가 1건이라도 있으면 전체 등록이 차단됩니다.", ""],
    ["", "", "이미 등록된 거래처코드는 사용할 수 없습니다.", ""],
    ["", "", "최대 1,000행, 5MB 이하의 .xlsx 파일만 업로드할 수 있습니다.", ""],
    ["", "", "사업자번호, 전화번호, 이메일 원문은 감사로그에 저장하지 않습니다.", ""],
  ]
  const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
  wsGuide["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 52 }, { wch: 42 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "거래처업로드")
  XLSX.utils.book_append_sheet(wb, wsGuide, "작성가이드")

  XLSX.writeFile(wb, fileName)
}
