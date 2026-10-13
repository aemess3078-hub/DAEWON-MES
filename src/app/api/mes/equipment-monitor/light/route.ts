import { NextRequest, NextResponse } from "next/server"
import {
  getEquipmentMonitorLive,
  getProductionKPIs,
} from "@/lib/actions/equipment-monitor.actions"

// 실시간성이 필요한 경량 조회 — 정적 캐시 금지.
export const dynamic = "force-dynamic"

// 모니터링/키오스크 화면이 30초마다 호출하는 경량 조회 API.
// 화면 표시에 필요한 최소 데이터(설비 + 태그 최신값, 선택적으로 KPI)만 JSON으로 반환한다.
// router.refresh()(페이지 전체 RSC + 사이드 쿼리 재실행) 대비 Supabase egress를 크게 줄인다.
export async function GET(req: NextRequest) {
  const withKpis = req.nextUrl.searchParams.get("kpis") === "1"

  try {
    const [equipment, kpis] = await Promise.all([
      getEquipmentMonitorLive(),
      withKpis ? getProductionKPIs() : Promise.resolve(null),
    ])

    return NextResponse.json(
      withKpis ? { equipment, kpis } : { equipment },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    console.error("[/api/mes/equipment-monitor/light] 조회 실패:", err)
    return NextResponse.json(
      { error: "MONITOR_FETCH_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
