import { NextRequest, NextResponse } from "next/server"
import {
  getEquipmentMonitorLive,
  getProductionKPIs,
} from "@/lib/actions/equipment-monitor.actions"
import { requireResourcePermission, ROLE_PERMISSION_DENIED_MESSAGE } from "@/lib/auth/role-permissions"

// 실시간성이 필요한 경량 조회 — 정적 캐시 금지.
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

// 모니터링/키오스크 화면이 30초마다 호출하는 경량 조회 API.
// 화면 표시에 필요한 최소 데이터(설비 + 태그 최신값, 선택적으로 KPI)만 JSON으로 반환한다.
// router.refresh()(페이지 전체 RSC + 사이드 쿼리 재실행) 대비 Supabase egress를 크게 줄인다.
// 로그인 필수 + 설비 모니터링 읽기 권한 필요. 테넌트는 세션에서만 결정한다(/api 는 미들웨어 대상이 아니다).
export async function GET(req: NextRequest) {
  const withKpis = req.nextUrl.searchParams.get("kpis") === "1"

  try {
    await requireResourcePermission("EQUIPMENT_MONITOR", "READ")
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE })
    }
    if (message === "FORBIDDEN" || message === ROLE_PERMISSION_DENIED_MESSAGE) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: NO_STORE })
    }
    console.error("[/api/mes/equipment-monitor/light] 권한 확인 실패:", err)
    return NextResponse.json({ error: "MONITOR_FETCH_FAILED" }, { status: 500, headers: NO_STORE })
  }

  try {
    const [equipment, kpis] = await Promise.all([
      getEquipmentMonitorLive(),
      withKpis ? getProductionKPIs() : Promise.resolve(null),
    ])

    return NextResponse.json(
      withKpis ? { equipment, kpis } : { equipment },
      { headers: NO_STORE },
    )
  } catch (err) {
    console.error("[/api/mes/equipment-monitor/light] 조회 실패:", err)
    return NextResponse.json(
      { error: "MONITOR_FETCH_FAILED" },
      { status: 500, headers: NO_STORE },
    )
  }
}
