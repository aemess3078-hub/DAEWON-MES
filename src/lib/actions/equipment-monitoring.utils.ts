import type { Prisma } from "@prisma/client"

// 현황/분석/통계/키오스크 모니터링 화면에 노출할 설비 조건.
// 설비관리에는 등록돼 있지만 실제 연동이 없는 수동/미연동/설치예정 설비는 제외한다.
//  - status: ACTIVE/MAINTENANCE는 표시(점검중 배지는 equipment-monitor-grid.tsx가
//    담당), INACTIVE는 미표시
//  - 연동 완료 판별: 현재 실제 수집 API/워커가 있는 프로토콜은 NCWatch뿐이므로
//    활성(isActive) NcwatchEquipmentMapping 존재로만 판단한다.
//    (OPC_UA/MODBUS_TCP 등은 "설비연결설정" 화면에 입력 폼만 있고 수집 구현이
//    없어 활성 EquipmentConnection만으로는 실제 연동을 보장할 수 없다 — 해당
//    프로토콜의 수집기가 실제로 구현되면 이 조건에 추가한다.)
export function monitoringEligibleEquipmentWhere(tenantId: string): Prisma.EquipmentWhereInput {
  return {
    tenantId,
    status: { in: ["ACTIVE", "MAINTENANCE"] },
    equipmentType: { notIn: ["TOOL", "JIG", "FIXTURE"] },
    ncwatchMappings: { some: { isActive: true } },
  }
}
