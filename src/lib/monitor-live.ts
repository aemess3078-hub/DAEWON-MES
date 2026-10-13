// 모니터링/키오스크 경량 폴링용 공용 유틸 (클라이언트 안전 — 서버 코드 미포함)
//
// 경량 API(/api/mes/equipment-monitor/light)는 JSON으로 응답하므로 Date 필드가
// 문자열로 직렬화된다. 기존 화면 렌더링 코드는 Date 인스턴스를 가정하므로,
// setState 전에 동일한 형태(Date 복원)로 되돌려 표시 로직을 그대로 재사용한다.

import type { EquipmentMonitorRow } from "@/lib/actions/equipment-monitor.actions"

export const MONITOR_LIGHT_PATH = "/api/mes/equipment-monitor/light"

// JSON 파싱 결과(Date가 string인 상태)를 EquipmentMonitorRow[]로 복원한다.
export function reviveEquipmentRows(rows: EquipmentMonitorRow[]): EquipmentMonitorRow[] {
  return rows.map((eq) => ({
    ...eq,
    latestEvent: eq.latestEvent
      ? {
          ...eq.latestEvent,
          startedAt: new Date(eq.latestEvent.startedAt),
          endedAt: eq.latestEvent.endedAt ? new Date(eq.latestEvent.endedAt) : null,
        }
      : null,
    recentTags: eq.recentTags.map((tag) => ({
      ...tag,
      timestamp: tag.timestamp ? new Date(tag.timestamp) : null,
    })),
  }))
}
