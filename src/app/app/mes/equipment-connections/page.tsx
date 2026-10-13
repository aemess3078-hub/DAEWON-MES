import { notFound } from "next/navigation"
import {
  getConnections,
  getEquipmentsForConnection,
  getGatewaysForConnection,
  getNcwatchMappings,
} from "@/lib/actions/equipment-integration.actions"
import { EquipmentConnectionsClient } from "./equipment-connections-client"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"

export const dynamic = "force-dynamic"

export default async function EquipmentConnectionsPage() {
  const user = await getCurrentUser()
  if (!user || !isDeveloperUser(user)) notFound()
  const tenantId = user.tenantId

  const [connections, equipments, gateways, ncwatchMappings] = await Promise.all([
    getConnections(tenantId),
    getEquipmentsForConnection(tenantId),
    getGatewaysForConnection(tenantId),
    getNcwatchMappings(tenantId),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            설비 연결 설정
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            설비와 게이트웨이 간의 통신 프로토콜 및 연결 설정을 관리합니다.
          </p>
        </div>
      </div>

      <EquipmentConnectionsClient
        connections={connections}
        ncwatchMappings={ncwatchMappings}
        equipments={equipments}
        gateways={gateways}
      />
    </div>
  )
}
