"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type EquipmentConnectionRow,
  type NcwatchMappingRow,
} from "@/lib/actions/equipment-integration.actions"
import { ConnectionDataTable } from "./connection-data-table"
import { NcwatchMappingDataTable } from "./ncwatch-mapping-data-table"

type EquipmentOption = {
  id: string
  code: string
  name: string
  workCenter: { name: string }
}

type GatewayOption = { id: string; name: string; status: string }

interface EquipmentConnectionsClientProps {
  connections: EquipmentConnectionRow[]
  ncwatchMappings: NcwatchMappingRow[]
  equipments: EquipmentOption[]
  gateways: GatewayOption[]
}

export function EquipmentConnectionsClient({
  connections,
  ncwatchMappings,
  equipments,
  gateways,
}: EquipmentConnectionsClientProps) {
  return (
    <Tabs defaultValue="general" className="space-y-4">
      <TabsList>
        <TabsTrigger value="general">일반 연결 / Modbus</TabsTrigger>
        <TabsTrigger value="ncwatch">NCWatch Agent 매핑</TabsTrigger>
      </TabsList>
      <TabsContent value="general" className="mt-0">
        <ConnectionDataTable
          data={connections}
          equipments={equipments}
          gateways={gateways}
        />
      </TabsContent>
      <TabsContent value="ncwatch" className="mt-0">
        <NcwatchMappingDataTable data={ncwatchMappings} equipments={equipments} />
      </TabsContent>
    </Tabs>
  )
}
