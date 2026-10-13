import { getEquipmentsForLMS } from "@/lib/actions/equipment-management.actions"
import {
  getParameterRows,
  getParameterPageSummary,
} from "@/lib/actions/tag-current-value.actions"
import { ParametersClient } from "./parameters-client"

export const dynamic = "force-dynamic"

export default async function ParametersPage() {
  const [equipments, summary, rows] = await Promise.all([
    getEquipmentsForLMS(),
    getParameterPageSummary(),
    getParameterRows(),
  ])

  // 클라이언트에 필요한 필드만 추출 (직렬화 안전)
  const equipmentOptions = equipments.map((eq) => ({
    id: eq.id,
    code: eq.code,
    name: eq.name,
    workCenterName: eq.workCenter.name,
  }))

  return (
    <ParametersClient
      equipments={equipmentOptions}
      summary={summary}
      initialRows={rows}
    />
  )
}
