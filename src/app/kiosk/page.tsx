import { redirect } from "next/navigation"
import { getEquipmentMonitorLive, getProductionKPIs } from "@/lib/actions/equipment-monitor.actions"
import { requireResourcePermission, ROLE_PERMISSION_DENIED_MESSAGE } from "@/lib/auth/role-permissions"
import { KioskClient } from "./kiosk-client"

export const dynamic = "force-dynamic"

// 현황판도 로그인 + 설비 모니터링 읽기 권한이 필요하다(/kiosk 는 미들웨어 대상이 아니므로 페이지에서 직접 확인).
// 현황판 TV 는 조회 전용 계정으로 로그인해 둔다.
export default async function KioskPage() {
  try {
    await requireResourcePermission("EQUIPMENT_MONITOR", "READ")
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    if (message === "UNAUTHORIZED") redirect("/login")
    if (message === "FORBIDDEN" || message === ROLE_PERMISSION_DENIED_MESSAGE) {
      return (
        <div className="flex min-h-screen items-center justify-center text-base text-slate-300">
          현황판을 볼 수 있는 권한이 없습니다.
        </div>
      )
    }
    throw err
  }

  const [equipment, kpis] = await Promise.all([
    getEquipmentMonitorLive(),
    getProductionKPIs(),
  ])

  return <KioskClient equipment={equipment} kpis={kpis} />
}
