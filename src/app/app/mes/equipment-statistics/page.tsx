import {
  getEquipmentStatisticsData,
  getEquipmentOptions,
} from "@/lib/actions/equipment-statistics.actions"
import { EquipmentStatisticsClient } from "./equipment-statistics-client"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{
    from?: string
    to?: string
    equipmentId?: string
  }>
}

export default async function EquipmentStatisticsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}

  const [data, equipmentOptions] = await Promise.all([
    getEquipmentStatisticsData({
      from: params.from?.trim() || undefined,
      to: params.to?.trim() || undefined,
      equipmentId: params.equipmentId?.trim() || undefined,
    }),
    getEquipmentOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          통합통계
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          생산량·에러·비가동 시간·작업시간 통계를 한 화면에서 분석합니다.
        </p>
      </div>

      <EquipmentStatisticsClient data={data} equipmentOptions={equipmentOptions} />
    </div>
  )
}
