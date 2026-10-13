import { getEquipmentMonitorLive, getProductionKPIs } from "@/lib/actions/equipment-monitor.actions"
import { KioskClient } from "./kiosk-client"

export const dynamic = "force-dynamic"

export default async function KioskPage() {
  const [equipment, kpis] = await Promise.all([
    getEquipmentMonitorLive(),
    getProductionKPIs(),
  ])

  return <KioskClient equipment={equipment} kpis={kpis} />
}
